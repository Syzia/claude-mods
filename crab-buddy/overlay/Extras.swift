// Everything the crab does beyond showing what his chats are up to: his feelings, his
// dreams, the bar you ask him things in, the bubble he answers in, and his wardrobe.
// CrabView owns one of these and calls into it at a handful of points.
import AppKit
import Vision

extension Settings {
    /// Whether he may use a nap to think up an idea about your latest chat.
    static var dreamsIdeas: Bool {
        get { defaults.object(forKey: "dreamIdeas") == nil ? true : defaults.bool(forKey: "dreamIdeas") }
        set { defaults.set(newValue, forKey: "dreamIdeas") }
    }
    /// An idea he has dreamt up and not told you yet.
    static var idea: String? {
        get { defaults.string(forKey: "idea") }
        set { defaults.set(newValue, forKey: "idea") }
    }

    /// At most one idea every 45 minutes and six a day: each one is a small request to Claude.
    static var mayDream: Bool {
        let now = Date().timeIntervalSince1970
        guard now - defaults.double(forKey: "dreamAt") > 45 * 60 else { return false }
        return defaults.string(forKey: "dreamDay") != today || defaults.integer(forKey: "dreamCount") < 6
    }

    static func noteDream() {
        let count = defaults.string(forKey: "dreamDay") == today ? defaults.integer(forKey: "dreamCount") : 0
        defaults.set(today, forKey: "dreamDay")
        defaults.set(count + 1, forKey: "dreamCount")
        defaults.set(Date().timeIntervalSince1970, forKey: "dreamAt")
    }

    private static var today: String {
        let format = DateFormatter()
        format.dateFormat = "yyyy-MM-dd"
        return format.string(from: Date())
    }
}

final class Extras: NSObject {
    let feelings = Feelings()
    let dream = DreamCloud()
    private let service = AskService()
    private lazy var bar = makeBar()
    private lazy var bubble = Bubble()
    private weak var view: CrabView?
    private var waiting: Asked?
    private var arePanelsAttached = false
    private var barLinger = 0.0, barAlpha = 0.0, bubbleAlpha = 0.0
    private var bubbleUntil = 0.0
    private var sincePoll = 0.0, sinceSweep = 590.0
    private var thinkingDots = -1
    private var didDemo = false
    // What he wears and whether he has an idea, looked up a few times a second rather than every frame.
    private var worn = (hat: Settings.hat, neck: Settings.neck, glasses: Settings.glasses)
    private var idea = Settings.idea

    var dreamAlpha: Double { dream.alpha }

    /// True while nothing here needs a fresh frame.
    var isQuiet: Bool { feelings.now == .none && barAlpha < 0.01 && bubbleAlpha < 0.01 && waiting == nil }

    func attach(to root: CALayer, pixelScale: CGFloat) {
        dream.attach(to: root)
        feelings.attach(to: root, pixelScale: pixelScale)
    }

    private func makeBar() -> AskBar {
        let bar = AskBar()
        bar.onAsk = { [weak self] words, wantsScreen in self?.ask(words, wantsScreen: wantsScreen) }
        bar.onChat = { [weak self] words, wantsScreen in self?.startChat(words, wantsScreen: wantsScreen) }
        return bar
    }

    // MARK: every frame

    func step(_ dt: Double, _ v: CrabView) {
        view = v
        let isAnswering = waiting.map { $0.kind != .dream } ?? false
        if !didDemo, let demo = environment["CRAB_BUDDY_SHOW"] {   // for trying things by hand: a feeling's name, "bar", or "say:words"
            didDemo = true
            if demo == "bar" { barLinger = 600 } else if demo.hasPrefix("say:") { say(String(demo.dropFirst(4)), button: "Continue in a chat") } else { feelings.force(demo, at: v.t) }
        }
        feelings.step(dt, v, isThinking: isAnswering)
        dream.step(dt, v)
        dream.hasIdea = idea != nil

        guard let window = v.window, window.isVisible else { return }
        if !arePanelsAttached {
            arePanelsAttached = true
            window.addChildWindow(bar.panel, ordered: .above)
            window.addChildWindow(bubble.panel, ordered: .above)
            bar.panel.orderOut(nil)
            bubble.panel.orderOut(nil)
        }
        let mouse = NSEvent.mouseLocation
        let screen = (window.screen ?? NSScreen.main)?.visibleFrame ?? window.frame

        // the bar comes out while the pointer is on him or on it, and stays while you type
        let isOverBar = barAlpha > 0.5 && bar.panel.frame.insetBy(dx: -8, dy: -10).contains(mouse)
        if (v.isHovering && !v.isHeld) || isOverBar || bar.isEditing || bar.hasText { barLinger = max(barLinger, 0.9) } else { barLinger = max(0, barLinger - dt) }
        let wantsBar = barLinger > 0 && !isAnswering
        barAlpha += ((wantsBar ? 1 : 0) - barAlpha) * (1 - exp(-dt * 12))
        if barAlpha > 0.02 {
            let size = AskBar.size
            let y = window.frame.minY + (v.wPill > 0.3 ? -size.height - 2 : 1)
            bar.panel.setFrameOrigin(NSPoint(x: min(max(window.frame.midX - size.width / 2, screen.minX + 4), screen.maxX - size.width - 4),
                                             y: max(y, screen.minY + 4)))
            if !bar.panel.isVisible { bar.panel.orderFront(nil) }
            bar.panel.alphaValue = CGFloat(barAlpha)
        } else if bar.panel.isVisible {
            bar.panel.orderOut(nil)
        }

        // an idea he dreamt up is told the next time you come to him
        if v.isHovering, waiting == nil, !bubble.isShown, let idea = idea {
            Settings.idea = nil
            self.idea = nil
            say("While I slept I had an idea:\n\(idea)", button: "Start a chat") { openNewChat(with: idea) }
        }

        // the bubble
        if isAnswering {
            let dots = Int(v.t * 2.5) % 4
            if dots != thinkingDots {
                thinkingDots = dots
                bubble.show((waiting?.wantsScreen == true ? "Reading your screen" : "Thinking") + String(repeating: ".", count: dots))
            }
        } else if bubble.isShown, v.t > bubbleUntil, !bubble.panel.frame.contains(mouse) {
            bubble.hide()
        }
        bubbleAlpha += ((bubble.isShown ? 1 : 0) - bubbleAlpha) * (1 - exp(-dt * 12))
        if bubbleAlpha > 0.02 {
            let size = bubble.panel.frame.size
            let y = window.frame.minY + CrabView.pillSpace + CGFloat(CrabView.artH - 12) * v.unit
            bubble.panel.setFrameOrigin(NSPoint(x: min(max(window.frame.midX - size.width / 2, screen.minX + 4), screen.maxX - size.width - 4),
                                                y: min(y, screen.maxY - size.height - 4)))
            if !bubble.panel.isVisible { bubble.panel.orderFront(nil) }
            bubble.panel.alphaValue = CGFloat(bubbleAlpha)
        } else if bubble.panel.isVisible {
            bubble.panel.orderOut(nil)
        }

        sincePoll += dt
        if sincePoll >= 0.3 {
            sincePoll = 0
            poll(v)
        }
        sinceSweep += dt
        if sinceSweep >= 600 {
            sinceSweep = 0
            service.sweep()
        }
    }

    func adjust(_ pose: inout Pose, _ hop: inout Double, _ lean: inout Double, _ v: CrabView) {
        feelings.adjust(&pose, &hop, &lean, v)
        pose.hat = worn.hat
        pose.neck = worn.neck
        pose.glasses = worn.glasses
    }

    func render(_ v: CrabView, hop: Double) {
        dream.render(v)
        feelings.render(v, hop: hop)
    }

    // MARK: asking

    private func say(_ words: String, button: String? = nil, onAction: (() -> Void)? = nil) {
        thinkingDots = -1
        bubble.show(words, button: button, onAction: onAction)
        bubbleUntil = (view?.t ?? 0) + min(45, 9 + Double(words.count) * 0.09)
    }

    private func ask(_ words: String, wantsScreen: Bool) {
        if let old = waiting { service.forget(old) }
        thinkingDots = -1
        waiting = service.send(.ask, question: words, wantsScreen: wantsScreen)
    }

    /// A new chat in the Claude app. With the eye open it first needs a picture of the screen, which a chat takes.
    private func startChat(_ words: String, wantsScreen: Bool) {
        guard wantsScreen else { openNewChat(with: words); return }
        if let old = waiting { service.forget(old) }
        thinkingDots = -1
        waiting = service.send(.shot, question: words, wantsScreen: true)
    }

    private func poll(_ v: CrabView) {
        worn = (Settings.hat, Settings.neck, Settings.glasses)
        idea = Settings.idea
        if let asked = waiting {
            let age = Date().timeIntervalSince(asked.since)
            if let answer = service.answer(to: asked) {
                waiting = nil
                service.forget(asked)
                switch asked.kind {
                case .ask where answer.isOK:
                    say(answer.text, button: "Continue in a chat") { openNewChat(with: asked.question, file: answer.shot) }
                case .ask:
                    say(answer.text.isEmpty ? "I couldn't work that out. Ask me again?" : answer.text)
                case .shot:
                    bubble.hide()
                    openNewChat(with: asked.question, file: answer.shot)
                case .dream:
                    if answer.isOK, !answer.text.isEmpty { Settings.idea = answer.text }
                }
            } else if age > 9, !service.isClaimed(asked) {   // no chat is listening
                waiting = nil
                service.forget(asked)
                if asked.kind != .dream {
                    say("I need an open Claude chat to think with. Open one, or restart a chat that was open before I learned to talk, and ask me again.")
                }
            } else if age > 90 {
                waiting = nil
                service.forget(asked)
                if asked.kind != .dream { say("That took too long. Ask me again?") }
            }
        }

        // a long nap is a chance to think about the chat you were last in
        if waiting == nil, Settings.dreamsIdeas, Settings.idea == nil, dream.asleepFor > 150, Settings.mayDream,
           let latest = v.status.chats.max(by: { $0.updated < $1.updated }) {
            Settings.noteDream()
            waiting = service.send(.dream, question: "", wantsScreen: false, chat: latest.id)
        }
    }

    // MARK: his menu

    func addMenuItems(_ menu: NSMenu) {
        menu.addItem(withTitle: "Ask the crab…", action: #selector(menuAsk), keyEquivalent: "").target = self

        let wardrobe = NSMenu()
        func shelf(_ title: String, _ choices: [(key: String, name: String)], worn: String, _ action: Selector) {
            let item = wardrobe.addItem(withTitle: title, action: nil, keyEquivalent: "")
            let sub = NSMenu()
            for choice in [(key: "", name: "None")] + choices {
                let entry = sub.addItem(withTitle: choice.name, action: action, keyEquivalent: "")
                entry.target = self
                entry.representedObject = choice.key
                entry.state = worn == choice.key ? .on : .off
            }
            item.submenu = sub
        }
        shelf("Hat", Wardrobe.hats.map { (key: $0.key, name: $0.name) }, worn: Settings.hat, #selector(menuHat(_:)))
        shelf("Round his neck", Wardrobe.necks, worn: Settings.neck, #selector(menuNeck(_:)))
        shelf("Glasses", Wardrobe.glasses, worn: Settings.glasses, #selector(menuGlasses(_:)))
        menu.addItem(withTitle: "Wardrobe", action: nil, keyEquivalent: "").submenu = wardrobe

        let ideas = menu.addItem(withTitle: "Dream up ideas", action: #selector(menuIdeas), keyEquivalent: "")
        ideas.target = self
        ideas.state = Settings.dreamsIdeas ? .on : .off
    }

    @objc private func menuAsk() {
        barLinger = 8
        barAlpha = 1
        bar.panel.alphaValue = 1
        bar.focus()
    }
    @objc private func menuHat(_ item: NSMenuItem) { Settings.hat = item.representedObject as? String ?? "" }
    @objc private func menuNeck(_ item: NSMenuItem) { Settings.neck = item.representedObject as? String ?? "" }
    @objc private func menuGlasses(_ item: NSMenuItem) { Settings.glasses = item.representedObject as? String ?? "" }
    @objc private func menuIdeas() { Settings.dreamsIdeas.toggle() }
}

/// The text in a picture, top to bottom: how the mod has him "read" a screenshot (`CrabBuddy --ocr file`).
func readText(inImageAt path: String) -> String {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    guard (try? VNImageRequestHandler(url: URL(fileURLWithPath: path)).perform([request])) != nil else { return "" }
    let lines = (request.results ?? []).sorted {
        abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.008 ? $0.boundingBox.midY > $1.boundingBox.midY : $0.boundingBox.minX < $1.boundingBox.minX
    }
    return lines.compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")
}
