// Views.swift: the light on screen. Two small windows per display:
//   * the pill panel draws everything (Clawd, the words, the clock) and ignores the mouse completely, so a click
//     anywhere on the pill (yours, or one Claude makes) goes straight to the app underneath;
//   * the button panel is only as big as the pause/resume button's hit area, takes clicks, and exists only
//     while a button is shown.

import AppKit

// MARK: - Sizes (points)

let pillWidth: CGFloat = 386
let pillHeight: CGFloat = 60
/// Room left of the pill for its glow, and above and below it.
let glowMargin: CGFloat = 14
let edgeMargin: CGFloat = 8
/// The whole view: the pill plus its glow room (at most 400 x 76).
let viewSize = NSSize(width: glowMargin + pillWidth, height: pillHeight + 2 * edgeMargin)
let pillRect = NSRect(x: glowMargin, y: edgeMargin, width: pillWidth, height: pillHeight)
let spritePad: CGFloat = 14
let spriteScale: CGFloat = 3
let spriteBox = NSSize(width: 15 * spriteScale, height: 12 * spriteScale)
/// The round button is 34 pt wide and sits 14 pt in from the screen edge; its panel (the hit area) is 40 x 40.
let buttonDisc: CGFloat = 34
let buttonHit: CGFloat = 40
let buttonInset: CGFloat = 14
let buttonHitRect = NSRect(x: viewSize.width - buttonInset - buttonDisc / 2 - buttonHit / 2,
                           y: (viewSize.height - buttonHit) / 2, width: buttonHit, height: buttonHit)

/// The words the pill shows while the pointer is on the button. The pause sentence is too long for one line, so it
/// carries its own line break (after "screen"): the second line is "until you resume", never a lone word.
let pauseHoverLines = ["Pause: Claude cannot use your screen", "until you resume"]
let pauseHoverText = pauseHoverLines.joined(separator: " ")
let resumeHoverText = "Resume: let Claude use your screen again"

/// A press that follows an accepted one by less than this many seconds is a double-click (or an impatient second try),
/// not a change of mind, and does nothing: a double-click on PAUSE must not pause Claude and then let it carry on.
let pressGuard = 1.0
/// How long the "could not save" words stay in the detail line, in seconds.
let noticeLength = 3.0

func elapsedText(_ ms: Double) -> String {
    // Clamped (to a billion seconds) so a silly time in a file cannot overflow the whole-number conversion and crash.
    let seconds = ms.isNaN ? 0 : min(max(ms / 1000, 0), 1e9)
    let total = Int(seconds)
    let h = total / 3600, m = (total % 3600) / 60, s = total % 60
    return h > 0 ? String(format: "%d:%02d:%02d", h, m, s) : String(format: "%d:%02d", m, s)
}

/// How much of a sentence is its bold lead-in ("Pause:"): up to and including the first colon, or 0.
func boldLength(_ text: String) -> Int {
    let colon = (text as NSString).range(of: ":")
    return colon.location == NSNotFound ? 0 : colon.upperBound
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

// MARK: - Text that fits

func textWidth(_ text: String, _ font: NSFont) -> CGFloat {
    ceil((text as NSString).size(withAttributes: [.font: font]).width)
}

/// The biggest size from `from` down to `to` (in half points) at which the text fits; `to` if none does.
func fittedFont(_ text: String, weight: NSFont.Weight, from: CGFloat, to: CGFloat, width: CGFloat) -> NSFont {
    var size = from
    while size > to && textWidth(text, .systemFont(ofSize: size, weight: weight)) > width { size -= 0.5 }
    return .systemFont(ofSize: size, weight: weight)
}

// MARK: - The button (drawing shared by its window and the pictures)

/// The round pause / resume button centred on `center`. `scale` only enlarges it for the review sheet.
func drawButton(kind: ButtonKind, hover: Bool, pressed: Bool, center: NSPoint, scale: CGFloat = 1) {
    guard kind != .none, let cg = NSGraphicsContext.current?.cgContext else { return }
    cg.saveGState()
    cg.translateBy(x: center.x, y: center.y)
    cg.scaleBy(x: scale, y: scale)
    let fill: NSColor
    if kind == .pause {
        fill = NSColor(calibratedWhite: 1, alpha: pressed ? 0.32 : (hover ? 0.22 : 0.12))
    } else {
        let red = accent(.paused)
        if pressed {
            fill = red.blended(withFraction: 0.25, of: .black) ?? red
        } else if hover {
            fill = red.blended(withFraction: 0.22, of: .white) ?? red
        } else {
            fill = red
        }
    }
    fill.setFill()
    NSBezierPath(ovalIn: NSRect(x: -buttonDisc / 2, y: -buttonDisc / 2, width: buttonDisc, height: buttonDisc)).fill()
    NSColor.white.setFill()
    NSColor.white.setStroke()
    if kind == .pause {
        for x: CGFloat in [-6, 2] {
            NSBezierPath(roundedRect: NSRect(x: x, y: -7, width: 4, height: 14), xRadius: 1.2, yRadius: 1.2).fill()
        }
    } else {
        // The triangle's weight is in its flat side, so it sits a little right of the middle to look centred.
        let play = NSBezierPath()
        play.move(to: NSPoint(x: -4, y: -7))
        play.line(to: NSPoint(x: -4, y: 7))
        play.line(to: NSPoint(x: 8, y: 0))
        play.close()
        play.lineJoinStyle = .round
        play.lineWidth = 1.6
        play.fill()
        play.stroke()
    }
    cg.restoreGState()
}

// MARK: - The pill

final class LightView: NSView {
    var decision = Decision()
    /// Seconds on a clock that only moves forward; the crab and its glow read their frame from it.
    var phase = 0.0
    /// The time the clock label counts from, in milliseconds.
    var clockNow = nowMs()
    /// No motion (the person asked for less motion).
    var still = false
    /// The pointer is over the button: the words explain it.
    var hovering = false

    override var isFlipped: Bool { false }

    /// The sentence that explains the button while the pointer is on it, in the lines it is meant to be drawn in.
    private var hoverLines: [String]? {
        guard hovering else { return nil }
        switch decision.button {
        case .pause: return pauseHoverLines
        case .resume: return [resumeHoverText]
        case .none: return nil
        }
    }

    override func draw(_ dirtyRect: NSRect) {
        guard decision.look != .hidden, let context = NSGraphicsContext.current else { return }
        let look = decision.look
        let color = accent(look)
        let shape = leftRounded(pillRect, radius: 18)

        // The glow and the body.
        context.saveGraphicsState()
        let glow = NSShadow()
        glow.shadowColor = color.withAlphaComponent(look == .done || look == .resumed ? 0.35 : 0.6)
        glow.shadowBlurRadius = 10
        glow.shadowOffset = .zero
        glow.set()
        NSColor(calibratedWhite: 0.085, alpha: 0.96).setFill()
        shape.fill()
        context.restoreGraphicsState()
        color.withAlphaComponent(0.6).setStroke()
        shape.lineWidth = 1.2
        shape.stroke()

        // The soft light behind Clawd, kept inside the pill.
        let origin = NSPoint(x: pillRect.minX + spritePad, y: pillRect.midY - spriteBox.height / 2)
        let center = NSPoint(x: origin.x + spriteBox.width / 2, y: origin.y + spriteBox.height / 2)
        let alpha = glowAlpha(look: look, working: decision.working, phase: phase, still: still)
        context.saveGraphicsState()
        shape.addClip()
        NSGradient(colors: [color.withAlphaComponent(alpha), color.withAlphaComponent(0)])?
            .draw(fromCenter: center, radius: 0, toCenter: center, radius: 30, options: [])
        context.restoreGraphicsState()

        // Clawd.
        drawCrab(crabFrame(look: look, working: decision.working, phase: phase, still: still),
                 accent: color, scale: spriteScale, origin: origin, in: context.cgContext)

        drawWords(color: color)
    }

    /// A hover sentence that is too long for the detail line takes both lines of the pill, one entry of `lines` each.
    private func drawHoverLines(_ lines: [String], left: CGFloat, width: CGFloat, mid: CGFloat) {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byTruncatingTail
        let options: NSString.DrawingOptions = [.usesLineFragmentOrigin, .truncatesLastVisibleLine]
        for (index, text) in lines.prefix(2).enumerated() {
            let font = fittedFont(text, weight: .regular, from: 12.5, to: 11, width: width)
            let styled = NSMutableAttributedString(string: text, attributes: [
                .font: font, .foregroundColor: NSColor(calibratedWhite: 1, alpha: 0.9), .paragraphStyle: paragraph])
            let bold = boldLength(text)
            if bold > 0 {
                styled.addAttributes([.font: NSFont.systemFont(ofSize: font.pointSize, weight: .semibold),
                                      .foregroundColor: NSColor.white], range: NSRange(location: 0, length: bold))
            }
            styled.draw(with: NSRect(x: left, y: (mid - (index == 0 ? 1 : 16)).rounded(), width: width, height: 16),
                        options: options)
        }
    }

    private func drawWords(color: NSColor) {
        let left = pillRect.minX + spritePad + spriteBox.width + 12
        let right = decision.button == .none ? pillRect.maxX - 20 : pillRect.maxX - buttonInset - buttonDisc - 10
        let width = right - left
        let mid = pillRect.midY
        let line = NSMutableParagraphStyle()
        line.lineBreakMode = .byTruncatingTail
        let options: NSString.DrawingOptions = [.usesLineFragmentOrigin, .truncatesLastVisibleLine]

        var detail = decision.detail
        var clock = (decision.look == .done || decision.look == .resumed || decision.since <= 0)
            ? "" : elapsedText(clockNow - decision.since)
        var detailBold = 0
        if let lines = hoverLines {
            clock = ""
            let sentence = lines.joined(separator: " ")
            detailBold = boldLength(sentence)
            let one = fittedFont(sentence, weight: .regular, from: 12.5, to: 11, width: width)
            if lines.count > 1 && textWidth(sentence, one) > width {
                drawHoverLines(lines, left: left, width: width, mid: mid)
                return
            }
            detail = sentence
        }

        // The clock sits at the right end of the title line. When the title would have to shrink to share that line
        // (a long app name), the clock moves to the detail line instead, so the title keeps the whole width.
        let clockFont = NSFont.monospacedDigitSystemFont(ofSize: 12.5, weight: .medium)
        let clockWidth = clock.isEmpty ? 0 : textWidth(clock, clockFont) + 2
        let titleFull = textWidth(decision.title, .systemFont(ofSize: 15, weight: .semibold))
        let clockOnTitle = !clock.isEmpty && titleFull <= width - clockWidth - 8
        let clockOnDetail = !clock.isEmpty && !clockOnTitle
        if !clock.isEmpty {
            let right_ = NSMutableParagraphStyle()
            right_.alignment = .right
            (clock as NSString).draw(
                with: NSRect(x: right - clockWidth, y: clockOnTitle ? mid - 3.5 : mid - 21, width: clockWidth, height: 18),
                options: options, attributes: [.font: clockFont, .foregroundColor: color, .paragraphStyle: right_])
        }

        // The title shrinks a little (never below 12 pt) rather than lose letters.
        let titleRoom = clockOnTitle ? width - clockWidth - 8 : width
        let titleFont = fittedFont(decision.title, weight: .semibold, from: 15, to: 12, width: titleRoom)
        (decision.title as NSString).draw(
            with: NSRect(x: left, y: mid - 2, width: titleRoom + 1, height: 20), options: options,
            attributes: [.font: titleFont, .foregroundColor: NSColor.white, .paragraphStyle: line])

        // The detail line (it may shrink a little too, then it ends in "...").
        let detailRoom = clockOnDetail ? width - clockWidth - 8 : width
        let detailFont = fittedFont(detail, weight: .regular, from: 12.5, to: 11, width: detailRoom)
        let dim = NSColor(calibratedWhite: 1, alpha: 0.66)
        if detailBold > 0 {
            let text = NSMutableAttributedString(string: detail, attributes: [
                .font: detailFont, .foregroundColor: NSColor(calibratedWhite: 1, alpha: 0.9), .paragraphStyle: line])
            text.addAttributes([.font: NSFont.systemFont(ofSize: detailFont.pointSize, weight: .semibold),
                                .foregroundColor: NSColor.white], range: NSRange(location: 0, length: detailBold))
            text.draw(with: NSRect(x: left, y: mid - 21, width: detailRoom, height: 18), options: options)
        } else {
            (detail as NSString).draw(
                with: NSRect(x: left, y: mid - 21, width: detailRoom, height: 18), options: options,
                attributes: [.font: detailFont, .foregroundColor: dim, .paragraphStyle: line])
        }
    }
}

// MARK: - The button's own window

final class ButtonView: NSView {
    var kind = ButtonKind.pause {
        didSet { if kind != oldValue { needsDisplay = true } }
    }
    private(set) var hovering = false
    /// The mouse went down on the button as a first click (so a press is in progress, even while the pointer is dragged out).
    private var armed = false
    /// The press is armed and the pointer is inside the button right now (the button is drawn pressed).
    private var pressed = false
    var onHover: ((Bool) -> Void)?
    var onPress: (() -> Void)?

    override var isFlipped: Bool { false }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for area in trackingAreas { removeTrackingArea(area) }
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.activeAlways, .mouseEnteredAndExited, .inVisibleRect],
                                       owner: self, userInfo: nil))
    }

    /// The pointer is gone or the button is hiding: forget hover and any half-finished press.
    func reset() {
        armed = false
        pressed = false
        setHover(false)
        needsDisplay = true
    }

    private func setHover(_ inside: Bool) {
        if hovering == inside { return }
        hovering = inside
        needsDisplay = true
        onHover?(inside)
    }

    private func inside(_ event: NSEvent) -> Bool { bounds.contains(convert(event.locationInWindow, from: nil)) }

    override func mouseEntered(with event: NSEvent) { setHover(true) }
    override func mouseExited(with event: NSEvent) { setHover(false) }

    /// Only a first click starts a press: the second click of a double-click lands on the button that has just turned
    /// into Resume, and must not be taken for a Resume.
    override func mouseDown(with event: NSEvent) {
        armed = event.clickCount <= 1
        pressed = armed
        needsDisplay = true
    }

    override func mouseDragged(with event: NSEvent) {
        let now = armed && inside(event)
        if pressed != now {
            pressed = now
            needsDisplay = true
        }
    }

    /// A press counts when the mouse goes down inside the button and comes up inside it, as a first click.
    override func mouseUp(with event: NSEvent) {
        let counts = armed && inside(event) && event.clickCount <= 1
        armed = false
        pressed = false
        needsDisplay = true
        if counts { onPress?() }
    }

    override func draw(_ dirtyRect: NSRect) {
        drawButton(kind: kind, hover: hovering, pressed: pressed, center: NSPoint(x: bounds.midX, y: bounds.midY))
    }

    override func isAccessibilityElement() -> Bool { true }
    override func accessibilityRole() -> NSAccessibility.Role? { .button }
    override func accessibilityLabel() -> String? {
        kind == .resume ? "Resume screen control" : "Pause screen control"
    }
    override func accessibilityPerformPress() -> Bool {
        onPress?()
        return true
    }
}

// MARK: - The windows (one light on every connected display)

/// A panel that never takes focus. Both of the light's windows are this.
final class LightPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

func makePanel(title: String, size: NSSize, interactive: Bool) -> LightPanel {
    let panel = LightPanel(contentRect: NSRect(origin: .zero, size: size),
                           styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
    panel.title = title
    panel.isFloatingPanel = true
    panel.level = .screenSaver
    panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
    panel.isOpaque = false
    panel.backgroundColor = .clear
    panel.hasShadow = false
    panel.ignoresMouseEvents = !interactive
    panel.hidesOnDeactivate = false
    panel.isReleasedWhenClosed = false
    return panel
}

/// Where the light rests on a display (flush with the right edge, a little above the middle) and where it waits.
/// Origins are whole points so the pixel-art stays sharp.
func lightFrames(in area: NSRect) -> (on: NSRect, off: NSRect) {
    let y = (area.midY + area.height * 0.16 - viewSize.height / 2).rounded()
    return (NSRect(x: (area.maxX - viewSize.width).rounded(), y: y, width: viewSize.width, height: viewSize.height),
            NSRect(x: (area.maxX + 24).rounded(), y: y, width: viewSize.width, height: viewSize.height))
}

/// The button panel's frame for a given pill frame (it follows the pill everywhere).
func buttonFrame(for pill: NSRect) -> NSRect {
    NSRect(x: pill.minX + buttonHitRect.minX, y: pill.minY + buttonHitRect.minY, width: buttonHit, height: buttonHit)
}

final class Slot {
    let pill: LightPanel
    let button: LightPanel
    let view = LightView(frame: NSRect(origin: .zero, size: viewSize))
    let buttonView = ButtonView(frame: NSRect(origin: .zero, size: NSSize(width: buttonHit, height: buttonHit)))
    var shown = false
    var buttonShown = false
    var moving = false
    var onPress: ((ButtonKind) -> Void)?

    init(still: Bool) {
        pill = makePanel(title: "Screen Light", size: viewSize, interactive: false)
        button = makePanel(title: "Screen Light button", size: NSSize(width: buttonHit, height: buttonHit),
                           interactive: true)
        pill.contentView = view
        button.contentView = buttonView
        view.still = still
        buttonView.onHover = { [weak self] inside in
            self?.view.hovering = inside
            self?.view.needsDisplay = true
        }
        buttonView.onPress = { [weak self] in
            guard let self = self else { return }
            self.onPress?(self.buttonView.kind)
        }
    }
}

final class Controller: NSObject {
    let provider: () -> Decision
    /// Writes the pause file (true: paused) and says whether it worked. nil in the tour, where a press does nothing.
    var writer: ((Bool) -> Bool)?
    /// The time in milliseconds that the press guard and the "could not save" note go by (a test moves it by hand).
    var clock: () -> Double = { nowMs() }
    let reducedMotion: Bool
    /// Builds everything but never shows a window (--press-test).
    var headless = false
    var slots: [UInt32: Slot] = [:]
    var current = Decision()
    var quietSince = Date()
    var stateTimer: Timer?
    var drawTimer: Timer?
    /// When the last press that changed the pause file was accepted.
    private var lastToggle = -Double.infinity
    /// Words for the detail line after a pause or resume that could not be saved, and when they go.
    private var notice: (text: String, until: Double)?

    init(reducedMotion: Bool = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
         provider: @escaping () -> Decision) {
        self.reducedMotion = reducedMotion
        self.provider = provider
        super.init()
    }

    func start() {
        stateTimer = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in self?.tick() }
        tick()
    }

    func makeSlot() -> Slot {
        let slot = Slot(still: reducedMotion)
        slot.onPress = { [weak self] kind in self?.press(kind) }
        return slot
    }

    /// A press of PAUSE writes "paused"; a press of RESUME writes "not paused". The look changes at once.
    /// A press that comes less than `pressGuard` seconds after the last accepted one is ignored (a double-click).
    /// If the file cannot be saved nothing changes, the button stays as it was, and the words say so for a moment.
    func press(_ kind: ButtonKind) {
        guard let writer = writer, kind != .none else { return }
        let moment = clock()
        if moment - lastToggle < pressGuard * 1000 { return }
        if writer(kind == .pause) {
            lastToggle = moment
        } else {
            let words = kind == .pause ? "Could not pause. Type /screen-light pause"
                                       : "Could not resume. Type /screen-light resume"
            notice = (words, moment + noticeLength * 1000)
        }
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
            if slots[key] == nil { slots[key] = makeSlot() }
            if let slot = slots[key] { live.append((slot, screen)) }
        }
        for (key, slot) in Array(slots) where !keep.contains(key) {
            slot.buttonView.reset()
            slot.button.orderOut(nil)
            slot.pill.orderOut(nil)
            slots[key] = nil
        }
        return live
    }

    func tick() {
        var d = provider()
        if let note = notice {
            if clock() < note.until && d.look != .hidden { d.detail = note.text } else { notice = nil }
        }
        current = d
        if headless {
            for slot in slots.values {
                slot.view.decision = d
                if d.button != .none { slot.buttonView.kind = d.button }
            }
            return
        }
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
                if d.button != .none { slot.buttonView.kind = d.button }
                show(slot, screen, withButton: d.button != .none)
                if !slot.pill.isVisible { slot.pill.orderFrontRegardless() }
                if !slot.moving {
                    let on = lightFrames(in: screen.visibleFrame).on
                    if abs(slot.pill.frame.origin.x - on.origin.x) > 0.5 || abs(slot.pill.frame.origin.y - on.origin.y) > 0.5 {
                        slot.pill.setFrame(on, display: true)
                    }
                    settleButton(slot, wanted: d.button, pill: on)
                }
                slot.view.hovering = slot.buttonShown && slot.buttonView.hovering
                slot.view.needsDisplay = true
            }
        }
        updateDrawTimer()
    }

    /// The button panel exists only while a button is shown, and sits exactly over the button's spot.
    private func settleButton(_ slot: Slot, wanted: ButtonKind, pill: NSRect) {
        if wanted == .none {
            if slot.buttonShown {
                slot.buttonShown = false
                slot.buttonView.reset()
                slot.button.ignoresMouseEvents = true
                slot.button.orderOut(nil)
            }
            return
        }
        let target = buttonFrame(for: pill)
        if !slot.buttonShown {
            slot.buttonShown = true
            slot.button.ignoresMouseEvents = false
            slot.button.alphaValue = 1
            slot.button.setFrame(target, display: true)
            slot.button.orderFrontRegardless()
        } else {
            if abs(slot.button.frame.origin.x - target.origin.x) > 0.5 || abs(slot.button.frame.origin.y - target.origin.y) > 0.5 {
                slot.button.setFrame(target, display: true)
            }
            if !slot.button.isVisible { slot.button.orderFrontRegardless() }
        }
    }

    /// The crab and the clock move, so while any light is up they are redrawn about 24 times a second.
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

    private func show(_ slot: Slot, _ screen: NSScreen, withButton: Bool) {
        if slot.shown { return }
        slot.shown = true
        let f = lightFrames(in: screen.visibleFrame)
        let start = reducedMotion ? f.on : f.off
        slot.pill.setFrame(start, display: false)
        slot.pill.alphaValue = reducedMotion ? 1 : 0
        slot.pill.orderFrontRegardless()
        if withButton {
            slot.buttonShown = true
            // While the light slides in, its button waits off to the side (on the next display, if there is one), so it
            // takes no clicks yet: it starts click-through and is switched on when the slide ends.
            slot.button.ignoresMouseEvents = !reducedMotion
            slot.button.setFrame(buttonFrame(for: start), display: false)
            slot.button.alphaValue = reducedMotion ? 1 : 0
            slot.button.orderFrontRegardless()
        }
        if reducedMotion { return }
        slot.moving = true
        // Both windows move in the same animation, so the button never drifts off the pill.
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.35
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            slot.pill.animator().setFrame(f.on, display: true)
            slot.pill.animator().alphaValue = 1
            if withButton {
                slot.button.animator().setFrame(buttonFrame(for: f.on), display: true)
                slot.button.animator().alphaValue = 1
            }
        }, completionHandler: {
            slot.moving = false
            if slot.shown && slot.buttonShown { slot.button.ignoresMouseEvents = false }
        })
    }

    private func hide(_ slot: Slot, _ screen: NSScreen) {
        if !slot.shown { return }
        slot.shown = false
        slot.buttonView.reset()
        slot.button.ignoresMouseEvents = true
        let off = lightFrames(in: screen.visibleFrame).off
        func finish() {
            if !slot.shown {
                slot.pill.orderOut(nil)
                slot.button.orderOut(nil)
                slot.buttonShown = false
            }
        }
        if reducedMotion {
            finish()
            return
        }
        slot.moving = true
        NSAnimationContext.runAnimationGroup({ context in
            context.duration = 0.3
            slot.pill.animator().setFrame(off, display: true)
            slot.pill.animator().alphaValue = 0
            if slot.buttonShown {
                slot.button.animator().setFrame(buttonFrame(for: off), display: true)
                slot.button.animator().alphaValue = 0
            }
        }, completionHandler: {
            finish()
            slot.moving = false
        })
    }
}
