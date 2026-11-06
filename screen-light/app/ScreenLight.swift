// Screen Light: a small light on the right edge of the main screen that shows when Claude has
// control of the Mac. The screen-light mod writes one little state file per Claude session; this
// program reads them and draws one pill. The whole window is click-through, so a click (yours or
// Claude's) always goes to the app underneath and the light can never be pressed by mistake.
//
// The program runs in one of four ways:
//   ScreenLight                          show the light for real (reads ~/.claude/screen-light/state)
//   ScreenLight --demo                   show a 13-second tour of the three looks, then quit
//   ScreenLight --decide DIR [--now MS]  print what the light would show for the files in DIR, then quit
//   ScreenLight --snapshot OUT.png [screen|app|done|all]   draw the looks to a picture, then quit
//
// The state file the mod writes (all times are milliseconds since 1970):
//   { "v": 1, "session": "...", "mode": "screen" | "app" | "idle", "busy": true, "app": "Gemini",
//     "what": "Opens the + menu", "since": 1, "last": 2, "beat": 3, "ended": 4, "reason": "released" }

import AppKit
import Foundation

// MARK: - What the light decides to show (pure functions; tested through --decide)

/// A session that has not written for this long is treated as gone (Claude closed or crashed).
let beatTimeout = 20_000.0
/// How long the green "gave control back" note stays up.
let toastLength = 4_500.0
/// After a call finishes the light still counts as "working" for this long.
let busyWindow = 8_000.0
/// With nothing to show for this long the program quits; the mod starts it again when it is needed.
let quitAfterIdle = 20.0 * 60.0

struct Session {
    var id = ""
    var mode = "idle"
    var busy = false
    var app: String?
    var what: String?
    var since = 0.0
    var last = 0.0
    var beat = 0.0
    var ended: Double?
    var reason: String?
}

enum Look: String {
    case hidden, screen, app, done
}

struct Decision {
    var look = Look.hidden
    var title = ""
    var detail = ""
    var since = 0.0
    var working = false
}

/// One line of plain text: control characters become spaces, runs of spaces collapse, long text is cut.
func clean(_ value: Any?, max: Int) -> String? {
    guard let raw = value as? String else { return nil }
    var spaced = ""
    for scalar in raw.unicodeScalars {
        if scalar.value < 32 || scalar.value == 127 {
            spaced.append(" ")
        } else {
            spaced.unicodeScalars.append(scalar)
        }
    }
    let text = spaced.split(separator: " ", omittingEmptySubsequences: true).joined(separator: " ")
    if text.isEmpty { return nil }
    return text.count > max ? String(text.prefix(max)) + "…" : text
}

func number(_ value: Any?) -> Double? {
    guard let n = value as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
    return n.doubleValue
}

func parse(_ data: Data, fallbackId: String) -> Session? {
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    var s = Session()
    s.id = clean(object["session"], max: 80) ?? fallbackId
    let mode = (object["mode"] as? String) ?? "idle"
    s.mode = (mode == "screen" || mode == "app") ? mode : "idle"
    s.busy = (object["busy"] as? Bool) ?? false
    s.app = clean(object["app"], max: 40)
    s.what = clean(object["what"], max: 90)
    s.since = number(object["since"]) ?? 0
    s.last = number(object["last"]) ?? 0
    s.beat = number(object["beat"]) ?? 0
    s.ended = number(object["ended"])
    s.reason = clean(object["reason"], max: 20)
    return s
}

func decide(_ sessions: [Session], now: Double) -> Decision {
    let live = sessions.filter { now - $0.beat <= beatTimeout }
    let active = live.filter { $0.mode == "screen" || $0.mode == "app" }
    // Full-screen control outranks working in the background; then the most recent call wins.
    let best = active.max { a, b in
        let ra = a.mode == "screen" ? 1 : 0
        let rb = b.mode == "screen" ? 1 : 0
        return ra != rb ? ra < rb : a.last < b.last
    }
    if let s = best {
        let working = s.busy || now - s.last <= busyWindow
        if s.mode == "screen" {
            return Decision(look: .screen, title: "Claude has your screen",
                            detail: s.what ?? "Hands off the mouse and keyboard", since: s.since, working: working)
        }
        let title = s.app.map { "Claude is in \($0)" } ?? "Claude is working in the background"
        return Decision(look: .app, title: title, detail: s.what ?? "You can keep using your Mac",
                        since: s.since, working: working)
    }
    let finished = live.filter { s in
        guard let ended = s.ended, ended > 0 else { return false }
        return now - ended <= toastLength
    }
    if let s = finished.max(by: { ($0.ended ?? 0) < ($1.ended ?? 0) }) {
        let why: String
        switch s.reason {
        case "stopped": why = "You stopped Claude"
        case "turn-ended": why = "Claude finished"
        default: why = "Claude let go of the screen"
        }
        return Decision(look: .done, title: "Claude gave control back", detail: why, since: 0, working: false)
    }
    return Decision()
}

/// Reads every *.json in the state folder. A file caught half-written keeps the last good copy.
final class StateReader {
    let dir: String
    private var cache: [String: (mtime: Double, session: Session)] = [:]

    init(dir: String) { self.dir = dir }

    func read() -> [Session] {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir) else { return [] }
        var out: [Session] = []
        var seen = Set<String>()
        for name in names where name.hasSuffix(".json") {
            seen.insert(name)
            let path = (dir as NSString).appendingPathComponent(name)
            let attrs = try? fm.attributesOfItem(atPath: path)
            let mtime = (attrs?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0
            if let known = cache[name], known.mtime == mtime {
                out.append(known.session)
            } else if let data = fm.contents(atPath: path), let s = parse(data, fallbackId: name) {
                cache[name] = (mtime, s)
                out.append(s)
            } else if let known = cache[name] {
                out.append(known.session)
            }
        }
        cache = cache.filter { seen.contains($0.key) }
        return out
    }

    /// Old files from sessions that ended long ago are tidied away.
    func tidy(olderThan days: Double = 1) {
        let fm = FileManager.default
        guard let names = try? fm.contentsOfDirectory(atPath: dir) else { return }
        for name in names where name.hasSuffix(".json") {
            let path = (dir as NSString).appendingPathComponent(name)
            if let date = (try? fm.attributesOfItem(atPath: path))?[.modificationDate] as? Date,
               Date().timeIntervalSince(date) > days * 86_400 {
                try? fm.removeItem(atPath: path)
            }
        }
    }
}

func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

// MARK: - Drawing

let pillWidth: CGFloat = 330
let pillHeight: CGFloat = 66
let glowMargin: CGFloat = 14
let viewSize = NSSize(width: glowMargin + pillWidth, height: pillHeight + 2 * 12)

func accent(_ look: Look) -> NSColor {
    switch look {
    case .screen: return NSColor(calibratedRed: 1.00, green: 0.48, blue: 0.22, alpha: 1)
    case .app: return NSColor(calibratedRed: 0.32, green: 0.66, blue: 1.00, alpha: 1)
    case .done: return NSColor(calibratedRed: 0.30, green: 0.84, blue: 0.50, alpha: 1)
    case .hidden: return NSColor.gray
    }
}

/// A rectangle with rounded corners on its left side only: the light grows out of the screen edge.
func leftRounded(_ r: NSRect, radius: CGFloat) -> NSBezierPath {
    let p = NSBezierPath()
    p.move(to: NSPoint(x: r.maxX, y: r.minY))
    p.line(to: NSPoint(x: r.minX + radius, y: r.minY))
    p.appendArc(withCenter: NSPoint(x: r.minX + radius, y: r.minY + radius), radius: radius,
                startAngle: 270, endAngle: 180, clockwise: true)
    p.line(to: NSPoint(x: r.minX, y: r.maxY - radius))
    p.appendArc(withCenter: NSPoint(x: r.minX + radius, y: r.maxY - radius), radius: radius,
                startAngle: 180, endAngle: 90, clockwise: true)
    p.line(to: NSPoint(x: r.maxX, y: r.maxY))
    p.close()
    return p
}

func symbol(_ look: Look, color: NSColor) -> NSImage? {
    let names: [String]
    switch look {
    case .screen: names = ["cursorarrow.click.2", "cursorarrow.rays", "cursorarrow"]
    case .app: names = ["macwindow", "app.dashed"]
    case .done: names = ["checkmark", "checkmark.circle.fill"]
    case .hidden: names = []
    }
    let size = NSImage.SymbolConfiguration(pointSize: 17, weight: .semibold)
    let config = size.applying(NSImage.SymbolConfiguration(paletteColors: [color]))
    for name in names {
        if let image = NSImage(systemSymbolName: name, accessibilityDescription: nil)?.withSymbolConfiguration(config) {
            return image
        }
    }
    return nil
}

func elapsedText(_ ms: Double) -> String {
    let total = max(0, Int(ms / 1000))
    let h = total / 3600, m = (total % 3600) / 60, s = total % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
}

final class LightView: NSView {
    var decision = Decision()
    /// Seconds on a clock that only moves forward; the pulsing ring reads its phase from it.
    var phase = 0.0
    /// The time the clock label counts from, in milliseconds.
    var clockNow = nowMs()
    /// No moving ring (the person asked for less motion, or this is a picture).
    var still = false

    override var isFlipped: Bool { false }

    override func draw(_ dirtyRect: NSRect) {
        guard decision.look != .hidden, let context = NSGraphicsContext.current else { return }
        let color = accent(decision.look)
        let pill = NSRect(x: glowMargin, y: 12, width: pillWidth, height: pillHeight)
        let shape = leftRounded(pill, radius: 18)

        // The glow and the body.
        context.saveGraphicsState()
        let glow = NSShadow()
        glow.shadowColor = color.withAlphaComponent(decision.look == .done ? 0.35 : 0.6)
        glow.shadowBlurRadius = 14
        glow.shadowOffset = .zero
        glow.set()
        NSColor(calibratedWhite: 0.085, alpha: 0.96).setFill()
        shape.fill()
        context.restoreGraphicsState()
        color.withAlphaComponent(0.6).setStroke()
        shape.lineWidth = 1.2
        shape.stroke()

        // The pulsing ring, the soft disc and the symbol.
        let center = NSPoint(x: pill.minX + 36, y: pill.midY)
        if decision.look != .done {
            let period = decision.working ? 1.1 : 2.8
            let t = still ? 0.45 : (phase.truncatingRemainder(dividingBy: period)) / period
            let radius = 17 + 9 * CGFloat(t)
            color.withAlphaComponent((decision.working ? 0.6 : 0.3) * CGFloat(1 - t)).setStroke()
            let ring = NSBezierPath(ovalIn: NSRect(x: center.x - radius, y: center.y - radius,
                                                   width: 2 * radius, height: 2 * radius))
            ring.lineWidth = 2
            ring.stroke()
        }
        color.withAlphaComponent(0.2).setFill()
        NSBezierPath(ovalIn: NSRect(x: center.x - 17, y: center.y - 17, width: 34, height: 34)).fill()
        if let image = symbol(decision.look, color: color) {
            let size = image.size
            image.draw(in: NSRect(x: center.x - size.width / 2, y: center.y - size.height / 2,
                                  width: size.width, height: size.height))
        }

        // The words.
        let left = pill.minX + 68
        let right = pill.maxX - 16
        let clock = (decision.look == .done || decision.since <= 0) ? "" : elapsedText(clockNow - decision.since)
        let clockWidth: CGFloat = clock.isEmpty ? 0 : 46
        let line = NSMutableParagraphStyle()
        line.lineBreakMode = .byTruncatingTail
        let titleAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 15, weight: .semibold),
            .foregroundColor: NSColor.white,
            .paragraphStyle: line,
        ]
        let detailAttrs: [NSAttributedString.Key: Any] = [
            .font: NSFont.systemFont(ofSize: 12.5, weight: .regular),
            .foregroundColor: NSColor(calibratedWhite: 1, alpha: 0.66),
            .paragraphStyle: line,
        ]
        let options: NSString.DrawingOptions = [.usesLineFragmentOrigin, .truncatesLastVisibleLine]
        (decision.title as NSString).draw(
            with: NSRect(x: left, y: pill.midY + 1, width: right - left - clockWidth, height: 20),
            options: options, attributes: titleAttrs)
        (decision.detail as NSString).draw(
            with: NSRect(x: left, y: pill.midY - 21, width: right - left, height: 18),
            options: options, attributes: detailAttrs)
        if !clock.isEmpty {
            let right_ = NSMutableParagraphStyle()
            right_.alignment = .right
            let clockAttrs: [NSAttributedString.Key: Any] = [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 12.5, weight: .medium),
                .foregroundColor: color,
                .paragraphStyle: right_,
            ]
            (clock as NSString).draw(
                with: NSRect(x: right - clockWidth, y: pill.midY + 2, width: clockWidth, height: 18),
                options: options, attributes: clockAttrs)
        }
    }
}

// MARK: - The windows (one light on every connected display)

final class Slot {
    let panel: NSPanel
    let view = LightView(frame: NSRect(origin: .zero, size: viewSize))
    var shown = false
    var moving = false

    init(still: Bool) {
        panel = NSPanel(contentRect: NSRect(origin: .zero, size: viewSize),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = "Screen Light"
        panel.isFloatingPanel = true
        panel.level = .screenSaver
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.contentView = view
        view.still = still
    }
}

final class Controller: NSObject {
    let provider: () -> Decision
    let reducedMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
    var slots: [UInt32: Slot] = [:]
    var quietSince = Date()
    var stateTimer: Timer?
    var drawTimer: Timer?

    init(provider: @escaping () -> Decision) {
        self.provider = provider
        super.init()
    }

    func start() {
        stateTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.tick() }
        tick()
    }

    private func displayId(_ screen: NSScreen) -> UInt32 {
        (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
    }

    /// One slot per connected display: new displays get one, unplugged displays lose theirs.
    private func sync() -> [(Slot, NSScreen)] {
        var live: [(Slot, NSScreen)] = []
        var keep = Set<UInt32>()
        for screen in NSScreen.screens {
            let key = displayId(screen)
            keep.insert(key)
            if slots[key] == nil { slots[key] = Slot(still: reducedMotion) }
            if let slot = slots[key] { live.append((slot, screen)) }
        }
        for (key, slot) in Array(slots) where !keep.contains(key) {
            slot.panel.orderOut(nil)
            slots[key] = nil
        }
        return live
    }

    /// Where the light rests on a display (flush with the right edge, a little above the middle) and where it waits.
    private func frames(_ screen: NSScreen) -> (on: NSRect, off: NSRect) {
        let area = screen.visibleFrame
        let y = area.midY + area.height * 0.16 - viewSize.height / 2
        return (NSRect(x: area.maxX - viewSize.width, y: y, width: viewSize.width, height: viewSize.height),
                NSRect(x: area.maxX + 24, y: y, width: viewSize.width, height: viewSize.height))
    }

    private func tick() {
        let d = provider()
        let pairs = sync()
        if d.look == .hidden {
            for (slot, screen) in pairs { hide(slot, screen) }
            if Date().timeIntervalSince(quietSince) > quitAfterIdle { NSApp.terminate(nil) }
        } else {
            quietSince = Date()
            // Something may have hidden the program (another program hiding apps); put it back.
            if NSApp.isHidden { NSApp.unhide(nil) }
            let now = nowMs()
            for (slot, screen) in pairs {
                slot.view.decision = d
                slot.view.clockNow = now
                show(slot, screen)
                if !slot.panel.isVisible { slot.panel.orderFrontRegardless() }
                let on = frames(screen).on
                if !slot.moving,
                   abs(slot.panel.frame.origin.x - on.origin.x) > 1 || abs(slot.panel.frame.origin.y - on.origin.y) > 1 {
                    slot.panel.setFrame(on, display: true)
                }
                slot.view.needsDisplay = true
            }
        }
        updateDrawTimer()
    }

    /// The ring and the clock move, so while any light is up they are redrawn about 24 times a second.
    private func updateDrawTimer() {
        let any = slots.values.contains { $0.shown }
        if any && drawTimer == nil && !reducedMotion {
            drawTimer = Timer.scheduledTimer(withTimeInterval: 1.0 / 24.0, repeats: true) { [weak self] _ in
                guard let self = self else { return }
                let now = nowMs()
                for slot in self.slots.values where slot.shown {
                    slot.view.phase = Date().timeIntervalSinceReferenceDate
                    slot.view.clockNow = now
                    slot.view.needsDisplay = true
                }
            }
        } else if !any, let timer = drawTimer {
            timer.invalidate()
            drawTimer = nil
        }
    }

    private func show(_ slot: Slot, _ screen: NSScreen) {
        if slot.shown { return }
        slot.shown = true
        let f = frames(screen)
        slot.panel.setFrame(reducedMotion ? f.on : f.off, display: false)
        slot.panel.alphaValue = reducedMotion ? 1 : 0
        slot.panel.orderFrontRegardless()
        if reducedMotion { return }
        slot.moving = true
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.35
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            slot.panel.animator().setFrame(f.on, display: true)
            slot.panel.animator().alphaValue = 1
        }, completionHandler: { slot.moving = false })
    }

    private func hide(_ slot: Slot, _ screen: NSScreen) {
        if !slot.shown { return }
        slot.shown = false
        if reducedMotion {
            slot.panel.orderOut(nil)
            return
        }
        slot.moving = true
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.3
            slot.panel.animator().setFrame(self.frames(screen).off, display: true)
            slot.panel.animator().alphaValue = 0
        }, completionHandler: {
            if !slot.shown { slot.panel.orderOut(nil) }
            slot.moving = false
        })
    }
}

// MARK: - Pictures (--snapshot) and the tour (--demo)

func sample(_ look: Look) -> Decision {
    switch look {
    case .screen:
        return Decision(look: .screen, title: "Claude has your screen", detail: "Clicks the Send button",
                        since: 1, working: true)
    case .app:
        return Decision(look: .app, title: "Claude is in Gemini", detail: "Opens the + menu in the prompt box",
                        since: 1, working: true)
    case .done:
        return Decision(look: .done, title: "Claude gave control back", detail: "Claude finished", since: 0, working: false)
    case .hidden:
        return Decision()
    }
}

func snapshot(_ which: String, to path: String) throws {
    let looks: [Look] = which == "all" ? [.screen, .app, .done] : [Look(rawValue: which) ?? .screen]
    let scale = 2
    let width = 700, rowHeight = 120
    let height = rowHeight * looks.count
    guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width * scale, pixelsHigh: height * scale,
                                     bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                     colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else {
        throw NSError(domain: "ScreenLight", code: 1, userInfo: [NSLocalizedDescriptionKey: "no bitmap"])
    }
    // The size in points goes on before the drawing context is made, so the context draws at 2x.
    rep.size = NSSize(width: width, height: height)
    guard let graphics = NSGraphicsContext(bitmapImageRep: rep) else {
        throw NSError(domain: "ScreenLight", code: 3, userInfo: [NSLocalizedDescriptionKey: "no context"])
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    // A made-up desktop behind the lights, so the picture shows how they sit on a screen.
    let desktop = NSGradient(colors: [NSColor(calibratedRed: 0.17, green: 0.2, blue: 0.32, alpha: 1),
                                      NSColor(calibratedRed: 0.52, green: 0.38, blue: 0.5, alpha: 1)])
    desktop?.draw(in: NSRect(x: 0, y: 0, width: width, height: height), angle: 30)
    NSColor(calibratedWhite: 1, alpha: 0.10).setFill()
    NSBezierPath(roundedRect: NSRect(x: 40, y: 20, width: 380, height: height - 40), xRadius: 10, yRadius: 10).fill()
    for (index, look) in looks.enumerated() {
        let view = LightView(frame: NSRect(origin: .zero, size: viewSize))
        view.decision = sample(look)
        view.still = true
        view.clockNow = 42_000 + 1
        view.decision.since = look == .done ? 0 : 1
        let row = looks.count - 1 - index
        graphics.cgContext.saveGState()
        graphics.cgContext.translateBy(x: CGFloat(width) - viewSize.width,
                                       y: CGFloat(row * rowHeight) + (CGFloat(rowHeight) - viewSize.height) / 2)
        view.draw(view.bounds)
        graphics.cgContext.restoreGState()
    }
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "ScreenLight", code: 2, userInfo: [NSLocalizedDescriptionKey: "no png"])
    }
    try png.write(to: URL(fileURLWithPath: path))
}

// MARK: - Start

func value(after flag: String) -> String? {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
    return args[i + 1]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}

let args = CommandLine.arguments
let defaultStateDir = NSString(string: "~/.claude/screen-light/state").expandingTildeInPath

if let dir = value(after: "--decide") {
    let now = value(after: "--now").flatMap(Double.init) ?? nowMs()
    let d = decide(StateReader(dir: dir).read(), now: now)
    let out: [String: Any] = ["look": d.look.rawValue, "title": d.title, "detail": d.detail,
                              "since": d.since, "working": d.working]
    let data = (try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])) ?? Data()
    print(String(data: data, encoding: .utf8) ?? "{}")
    exit(0)
}

if let path = value(after: "--snapshot") {
    let which = args.last.flatMap { ["screen", "app", "done", "all"].contains($0) ? $0 : nil } ?? "all"
    do { try snapshot(which, to: path) } catch { fail("snapshot failed: \(error)") }
    print("wrote \(path)")
    exit(0)
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)

let controller: Controller
if args.contains("--demo") {
    let started = nowMs()
    controller = Controller {
        let seconds = (nowMs() - started) / 1000
        var d: Decision
        switch seconds {
        case ..<4: d = sample(.screen)
        case ..<8: d = sample(.app)
        case ..<12.5: d = sample(.done)
        default: d = Decision()
        }
        if d.look == .screen || d.look == .app { d.since = started }
        if seconds > 13.5 { DispatchQueue.main.async { NSApp.terminate(nil) } }
        return d
    }
} else {
    let me = ProcessInfo.processInfo.processIdentifier
    if let id = Bundle.main.bundleIdentifier,
       !NSRunningApplication.runningApplications(withBundleIdentifier: id).filter({ $0.processIdentifier != me }).isEmpty {
        exit(0)  // already running: one light is enough
    }
    let reader = StateReader(dir: value(after: "--state-dir") ?? defaultStateDir)
    reader.tidy()
    controller = Controller { decide(reader.read(), now: nowMs()) }
}
// Without this macOS would slow the timers of a program that shows nothing for a while (App Nap), and the light
// could come up seconds late. This keeps them on time; the Mac can still go to sleep as usual.
let stayAwake = ProcessInfo.processInfo.beginActivity(options: [.userInitiatedAllowingIdleSystemSleep],
                                                      reason: "Watching for Claude taking control of the Mac")
controller.start()
application.run()
withExtendedLifetime(stayAwake) {}
