// Talking to the crab: a little bar under him to type into, a speech bubble over him for
// what he says, and the files through which a Claude chat does his thinking for him.
//
// He cannot think by himself. A question is written to ~/.claude/crab-buddy/asks; the
// crab-buddy mod inside an open Claude chat picks it up, asks Claude (reading the screen
// first when you let him), and writes what came back to ~/.claude/crab-buddy/answers.
import AppKit

/// A borderless panel that can still take the keyboard, without bringing this app to the front.
final class KeyPanel: NSPanel {
    override var canBecomeKey: Bool { true }
}

func floatingPanel(_ panel: NSPanel) {
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.level = .floating
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
    panel.hidesOnDeactivate = false
    panel.alphaValue = 0
}

func symbol(_ name: String, size: CGFloat = 13) -> NSImage? {
    NSImage(systemSymbolName: name, accessibilityDescription: nil)?
        .withSymbolConfiguration(NSImage.SymbolConfiguration(pointSize: size, weight: .medium))
}

let crabOrange = NSColor(srgbRed: 0.94, green: 0.56, blue: 0.42, alpha: 1)

// MARK: - The bar

final class AskBar: NSObject, NSTextFieldDelegate {
    static let size = NSSize(width: 262, height: 32)
    let panel: KeyPanel
    private let field = NSTextField()
    private let eye = NSButton(), chat = NSButton(), send = NSButton()

    /// Whether he may read the screen for the next question.
    var looksAtScreen = false { didSet { refreshEye() } }
    var onAsk: ((String, Bool) -> Void)?
    var onChat: ((String, Bool) -> Void)?

    var isEditing: Bool { panel.isKeyWindow && field.currentEditor() != nil }
    var hasText: Bool { !field.stringValue.trimmingCharacters(in: .whitespaces).isEmpty }

    override init() {
        panel = KeyPanel(contentRect: NSRect(origin: .zero, size: Self.size),
                         styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        floatingPanel(panel)
        panel.hasShadow = true

        let root = NSView(frame: NSRect(origin: .zero, size: Self.size))
        root.wantsLayer = true
        root.layer?.backgroundColor = CGColor(gray: 0.13, alpha: 0.97)
        root.layer?.cornerRadius = Self.size.height / 2
        root.layer?.borderWidth = 1
        root.layer?.borderColor = CGColor(gray: 1, alpha: 0.16)
        panel.contentView = root

        let width = Self.size.width
        add(eye, to: root, x: 8, tip: "", action: #selector(toggleEye))
        add(chat, to: root, x: width - 58, tip: "Start a new Claude chat with this (⌘↩)", action: #selector(startChat))
        add(send, to: root, x: width - 32, tip: "Ask the crab (↩)", action: #selector(ask))
        chat.image = symbol("square.and.pencil")
        chat.contentTintColor = NSColor(white: 1, alpha: 0.7)
        send.image = symbol("arrow.up.circle.fill", size: 17)
        send.contentTintColor = crabOrange
        refreshEye()

        field.frame = NSRect(x: 36, y: 7, width: width - 36 - 62, height: 18)
        field.isBordered = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.font = .systemFont(ofSize: 12.5)
        field.textColor = .white
        field.cell?.usesSingleLineMode = true
        field.cell?.isScrollable = true
        field.placeholderAttributedString = NSAttributedString(string: "Ask me, or start a chat", attributes: [
            .foregroundColor: NSColor(white: 1, alpha: 0.42), .font: NSFont.systemFont(ofSize: 12.5),
        ])
        field.delegate = self
        root.addSubview(field)
    }

    private func add(_ button: NSButton, to root: NSView, x: CGFloat, tip: String, action: Selector) {
        button.frame = NSRect(x: x, y: 4, width: 24, height: 24)
        button.isBordered = false
        button.imagePosition = .imageOnly
        button.toolTip = tip
        button.target = self
        button.action = action
        root.addSubview(button)
    }

    private func refreshEye() {
        eye.image = symbol(looksAtScreen ? "eye.fill" : "eye.slash")
        eye.contentTintColor = looksAtScreen ? crabOrange : NSColor(white: 1, alpha: 0.5)
        eye.toolTip = looksAtScreen ? "He will read your screen for this question. Click to stop."
            : "Let him read what is on your screen for this question"
    }

    func focus() {
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(field)
    }

    func clear() {
        field.stringValue = ""
        panel.makeFirstResponder(nil)
    }

    @objc private func toggleEye() { looksAtScreen.toggle() }

    @objc private func ask() {
        guard hasText else { focus(); return }
        let text = field.stringValue
        clear()
        onAsk?(text, looksAtScreen)
    }

    @objc private func startChat() {
        let text = field.stringValue
        clear()
        onChat?(text, looksAtScreen)
    }

    func controlTextDidBeginEditing(_ note: Notification) {
        (field.currentEditor() as? NSTextView)?.insertionPointColor = .white
    }

    func control(_ control: NSControl, textView: NSTextView, doCommandBy command: Selector) -> Bool {
        if command == #selector(NSResponder.insertNewline(_:)) {
            if NSApp.currentEvent?.modifierFlags.contains(.command) == true { startChat() } else { ask() }
            return true
        }
        if command == #selector(NSResponder.cancelOperation(_:)) {
            clear()
            return true
        }
        return false
    }
}

// MARK: - The speech bubble

final class BubbleView: NSView {
    static let tail: CGFloat = 8
    private let shape = CAShapeLayer()

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        shape.fillColor = CGColor(srgbRed: 1.0, green: 0.975, blue: 0.945, alpha: 1)
        shape.strokeColor = CGColor(srgbRed: 0.29, green: 0.12, blue: 0.08, alpha: 1)
        shape.lineWidth = 1.5
        shape.lineJoin = .round
        layer?.addSublayer(shape)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func layout() {
        super.layout()
        let body = bounds.insetBy(dx: 1, dy: 1)
        let bottom = body.minY + Self.tail, radius: CGFloat = 11
        let path = CGMutablePath()
        path.move(to: CGPoint(x: body.minX + radius, y: bottom))
        path.addLine(to: CGPoint(x: body.midX - 7, y: bottom))
        path.addLine(to: CGPoint(x: body.midX, y: body.minY))        // the tail, pointing at him
        path.addLine(to: CGPoint(x: body.midX + 7, y: bottom))
        path.addArc(tangent1End: CGPoint(x: body.maxX, y: bottom), tangent2End: CGPoint(x: body.maxX, y: body.maxY), radius: radius)
        path.addArc(tangent1End: CGPoint(x: body.maxX, y: body.maxY), tangent2End: CGPoint(x: body.minX, y: body.maxY), radius: radius)
        path.addArc(tangent1End: CGPoint(x: body.minX, y: body.maxY), tangent2End: CGPoint(x: body.minX, y: bottom), radius: radius)
        path.addArc(tangent1End: CGPoint(x: body.minX, y: bottom), tangent2End: CGPoint(x: body.maxX, y: bottom), radius: radius)
        path.closeSubpath()
        shape.frame = bounds
        shape.path = path
    }
}

final class Bubble: NSObject {
    static let width: CGFloat = 256
    let panel: NSPanel
    private let box = BubbleView(frame: .zero)
    private let label = NSTextField(wrappingLabelWithString: "")
    private let action = NSButton(), close = NSButton()
    private var onAction: (() -> Void)?
    private(set) var isShown = false
    private(set) var text = ""

    override init() {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: Self.width, height: 60),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        floatingPanel(panel)
        panel.hasShadow = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.contentView = box

        label.font = .systemFont(ofSize: 12.5)
        label.textColor = NSColor(srgbRed: 0.16, green: 0.08, blue: 0.07, alpha: 1)
        label.isSelectable = true
        label.maximumNumberOfLines = 12
        box.addSubview(label)

        action.isBordered = false
        action.target = self
        action.action = #selector(act)
        box.addSubview(action)

        close.isBordered = false
        close.image = symbol("xmark", size: 9)
        close.contentTintColor = NSColor(srgbRed: 0.29, green: 0.12, blue: 0.08, alpha: 0.55)
        close.target = self
        close.action = #selector(dismiss)
        box.addSubview(close)
    }

    /// Shows what he says; `button` adds one thing to do about it.
    func show(_ words: String, button: String? = nil, onAction: (() -> Void)? = nil) {
        text = words.count > 520 ? String(words.prefix(519)) + "…" : words
        self.onAction = onAction
        label.stringValue = text
        let textWidth = Self.width - 40
        let textHeight = ceil(label.attributedStringValue.boundingRect(
            with: NSSize(width: textWidth, height: 600), options: [.usesLineFragmentOrigin, .usesFontLeading]).height) + 2
        let buttonHeight: CGFloat = button == nil ? 0 : 24
        let height = 11 + textHeight + buttonHeight + 10 + BubbleView.tail
        panel.setContentSize(NSSize(width: Self.width, height: height))
        label.frame = NSRect(x: 15, y: BubbleView.tail + 10 + buttonHeight, width: textWidth, height: textHeight)
        close.frame = NSRect(x: Self.width - 23, y: height - 22, width: 16, height: 16)
        action.isHidden = button == nil
        if let button = button {
            action.attributedTitle = NSAttributedString(string: button + "  ↗", attributes: [
                .foregroundColor: NSColor(srgbRed: 0.78, green: 0.36, blue: 0.20, alpha: 1),
                .font: NSFont.systemFont(ofSize: 12, weight: .semibold),
            ])
            action.sizeToFit()
            action.frame.origin = NSPoint(x: 15, y: BubbleView.tail + 9)
        }
        box.needsLayout = true
        isShown = true
        panel.orderFront(nil)
    }

    func hide() {
        isShown = false
        onAction = nil
    }

    @objc private func act() {
        let run = onAction
        hide()
        run?()
    }

    @objc private func dismiss() { hide() }
}

// MARK: - The files

/// One thing asked of a Claude chat, and what is known of its fate.
struct Asked {
    enum Kind: String { case ask, shot, dream }
    let id: String
    let kind: Kind
    let question: String
    let wantsScreen: Bool
    let since: Date
}

struct Answer {
    let isOK: Bool
    let text: String
    let shot: String?   // the screenshot that was read, when there was one
}

final class AskService {
    private let asks = baseDir.appendingPathComponent("asks")
    private let answers = baseDir.appendingPathComponent("answers")
    private let shots = baseDir.appendingPathComponent("shots")
    private let files = FileManager.default

    /// Writes the request. `chat` names the one chat that should answer, else any may.
    func send(_ kind: Asked.Kind, question: String, wantsScreen: Bool, chat: String? = nil) -> Asked {
        let asked = Asked(id: UUID().uuidString.lowercased(), kind: kind, question: question, wantsScreen: wantsScreen, since: Date())
        var body: [String: Any] = [
            "id": asked.id, "kind": kind.rawValue, "question": question, "screen": wantsScreen,
            "asked": Date().timeIntervalSince1970 * 1000,
        ]
        if let chat = chat { body["for"] = chat }
        try? files.createDirectory(at: asks, withIntermediateDirectories: true)
        if let data = try? JSONSerialization.data(withJSONObject: body) {
            try? data.write(to: asks.appendingPathComponent("\(asked.id).json"), options: .atomic)
        }
        return asked
    }

    /// Whether some chat has taken the request on.
    func isClaimed(_ asked: Asked) -> Bool {
        files.fileExists(atPath: asks.appendingPathComponent("\(asked.id).claim").path)
    }

    func answer(to asked: Asked) -> Answer? {
        guard let data = try? Data(contentsOf: answers.appendingPathComponent("\(asked.id).json")),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return Answer(isOK: obj["ok"] as? Bool ?? false, text: obj["text"] as? String ?? "", shot: obj["shot"] as? String)
    }

    func forget(_ asked: Asked) {
        for url in [asks.appendingPathComponent("\(asked.id).json"), asks.appendingPathComponent("\(asked.id).claim"),
                    answers.appendingPathComponent("\(asked.id).json")] {
            try? files.removeItem(at: url)
        }
    }

    /// Clears out what is over an hour old, screenshots included.
    func sweep() {
        for folder in [asks, answers, shots] {
            let items = (try? files.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
            for item in items {
                let changed = (try? item.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate ?? Date()
                if Date().timeIntervalSince(changed) > 3600 { try? files.removeItem(at: item) }
            }
        }
    }
}

/// Opens a new chat in the Claude app with the words typed in and, when given, a file attached.
func openNewChat(with words: String, file: String? = nil) {
    guard var link = URLComponents(string: "claude://code/new") else { return }
    var items: [URLQueryItem] = []
    let text = words.trimmingCharacters(in: .whitespacesAndNewlines)
    if !text.isEmpty { items.append(URLQueryItem(name: "q", value: String(text.prefix(4000)))) }
    if let file = file { items.append(URLQueryItem(name: "file", value: file)) }
    link.queryItems = items.isEmpty ? nil : items
    if let url = link.url { NSWorkspace.shared.open(url) }
}
