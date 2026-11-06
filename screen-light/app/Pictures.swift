// Pictures.swift: everything for looking at the light without showing it, and the tour.
//   --snapshot OUT.png all|sheet|hover|text|screen|app|done|paused|resumed   draw pictures (in-process, no permission)
//   --inspect LOOK                      print the windows that would be made for a look (nothing is shown)
//   --press-test --dir DIR [--steps "press file wait:2 press file"] [--fail]
//                                       press the button through the real view and print what happened (see runPressTest)
//   --hold-test DIR                     print how the pause reader treats a half-written file
//   --crab-ascii NAME|list              print a crab pose as letters (also snapshot-LOOK: the pose of that picture)
//   --pose LOOK PHASE [--working] [--still]   print the pose for a look at any moment of the clock as letters
//   --older-test V T V T                would this program take over from a running light? (see runOlderTest)
//   --clock-test MS ...                 print the clock label for each number
//   --demo                              a short tour of the looks (see demoDecision)

import AppKit
import Foundation

// MARK: - What each look shows in a picture

func sample(_ look: Look) -> Decision {
    switch look {
    case .screen:
        return Decision(look: .screen, title: "Claude has your screen", detail: "Clicks the Send button",
                        since: 1, working: true, button: .pause)
    case .app:
        return Decision(look: .app, title: "Claude is in Gemini", detail: "Opens the + menu in the prompt box",
                        since: 1, working: true, button: .pause)
    case .done:
        return Decision(look: .done, title: "Claude gave control back", detail: "Claude finished",
                        since: 0, working: false)
    case .paused:
        return Decision(look: .paused, title: "Screen control is paused",
                        detail: "Claude cannot use your screen until you resume", since: 1, working: false,
                        button: .resume)
    case .resumed:
        return Decision(look: .resumed, title: "Screen control is back on", detail: "Tell Claude to carry on",
                        since: 0, working: false)
    case .hidden:
        return Decision()
    }
}

/// The tour: screen, app, paused, resumed, done, then it quits. The clock counts from the start of each part.
func demoDecision(elapsed seconds: Double, started: Double) -> Decision {
    var d: Decision
    switch seconds {
    case ..<3.5: d = sample(.screen); d.since = started
    case ..<7: d = sample(.app); d.since = started
    case ..<10.5: d = sample(.paused); d.since = started + 7_000
    case ..<13.5: d = sample(.resumed)
    case ..<16.5: d = sample(.done)
    default: d = Decision()
    }
    return d
}

// MARK: - Pictures

/// A frame is drawn at a fixed phase and a fixed clock label ("0:42") so pictures are the same every time. The phase is
/// early in every cycle: the working crab stands on legs A with its arms down (the silhouette of the art spec), the
/// peeking crab looks straight ahead, the happy crab has its arm high. The sleeping crab's Z fades in over the first
/// sixth of its round, so its picture is taken a little later, when the Z is at its brightest.
func snapshotPhase(for look: Look) -> Double { look == .paused ? 0.3 : 0.05 }
let snapshotClock = 42_001.0

private func renderPNG(width: Int, height: Int, to path: String, draw: (NSGraphicsContext) -> Void) throws {
    let scale = 2
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
    draw(graphics)
    NSGraphicsContext.restoreGraphicsState()
    guard let png = rep.representation(using: .png, properties: [:]) else {
        throw NSError(domain: "ScreenLight", code: 2, userInfo: [NSLocalizedDescriptionKey: "no png"])
    }
    try png.write(to: URL(fileURLWithPath: path))
}

/// One light as it appears on screen: the pill, and the button drawn where the button panel would be.
/// `hover` shows the pointer over the button; `decision` and `clock` let a picture use worst-case words.
private func drawLight(_ look: Look, graphics: NSGraphicsContext, origin: NSPoint, hover: Bool = false,
                       decision: Decision? = nil, clock: Double = snapshotClock) {
    let d = decision ?? sample(look)
    let view = LightView(frame: NSRect(origin: .zero, size: viewSize))
    view.decision = d
    view.phase = snapshotPhase(for: look)
    view.clockNow = clock
    view.hovering = hover
    graphics.cgContext.saveGState()
    graphics.cgContext.translateBy(x: origin.x, y: origin.y)
    view.draw(view.bounds)
    drawButton(kind: d.button, hover: hover, pressed: false, center: NSPoint(x: buttonHitRect.midX, y: buttonHitRect.midY))
    graphics.cgContext.restoreGState()
}

/// What a stacked picture shows in each row.
private struct Row {
    var look: Look
    var hover = false
    var decision: Decision?
    var clock = snapshotClock
}

private func rows(for which: String) -> [Row] {
    switch which {
    case "hover":
        // The pointer over the button: the words explain what it does.
        return [Row(look: .screen, hover: true), Row(look: .paused, hover: true)]
    case "text":
        // Worst-case words: a long app name with a long clock, the no-name title, a very long detail line, the
        // note that shows when a press could not be saved, and the warning about a session older than the pause.
        var a = sample(.app)
        a.title = "Claude is in Adobe Photoshop 2025"
        a.detail = "Opens the File menu and chooses Export As"
        var b = sample(.app)
        b.title = "Claude is working in the background"
        b.detail = "You can keep using your Mac"
        var c = sample(.screen)
        c.detail = String(repeating: "Types the prompt now. ", count: 4)
        var d = sample(.paused)
        d.detail = "Could not resume. Type /screen-light resume"
        var e = sample(.paused)
        e.detail = olderSessionDetail
        return [Row(look: .app, decision: a, clock: 5_025_001), Row(look: .app, decision: b),
                Row(look: .screen, decision: c, clock: 5_025_001), Row(look: .paused, decision: d),
                Row(look: .paused, decision: e)]
    case "all":
        return [.screen, .app, .done, .paused, .resumed].map { Row(look: $0) }
    default:
        if let one = Look(rawValue: which), one != .hidden { return [Row(look: one)] }
        return [.screen, .app, .done, .paused, .resumed].map { Row(look: $0) }
    }
}

/// The size in points of a picture of `count` stacked looks (the PNG is twice this).
let lookRowHeight = 100
let lookPictureWidth = 700
let sheetWidth = 800
let sheetHeight = 656

func snapshot(_ which: String, to path: String) throws {
    if which == "sheet" {
        try renderPNG(width: sheetWidth, height: sheetHeight, to: path) { drawSheet(width: sheetWidth, height: sheetHeight, $0) }
        return
    }
    let stack = rows(for: which)
    let width = lookPictureWidth, height = lookRowHeight * stack.count
    try renderPNG(width: width, height: height, to: path) { graphics in
        // A made-up desktop behind the lights, so the picture shows how they sit on a screen.
        let desktop = NSGradient(colors: [NSColor(calibratedRed: 0.17, green: 0.2, blue: 0.32, alpha: 1),
                                          NSColor(calibratedRed: 0.52, green: 0.38, blue: 0.5, alpha: 1)])
        desktop?.draw(in: NSRect(x: 0, y: 0, width: width, height: height), angle: 30)
        NSColor(calibratedWhite: 1, alpha: 0.10).setFill()
        NSBezierPath(roundedRect: NSRect(x: 40, y: 20, width: 380, height: height - 40), xRadius: 10, yRadius: 10).fill()
        for (index, item) in stack.enumerated() {
            let row = stack.count - 1 - index
            drawLight(item.look, graphics: graphics,
                      origin: NSPoint(x: CGFloat(width) - viewSize.width,
                                      y: CGFloat(row * lookRowHeight) + (CGFloat(lookRowHeight) - viewSize.height) / 2),
                      hover: item.hover, decision: item.decision, clock: item.clock)
        }
    }
}

// MARK: - The contact sheet

struct SheetItem {
    var name: String
    var look: Look
    var crab: CrabFrame?
    var button: (kind: ButtonKind, hover: Bool, pressed: Bool)?
    /// The name as typed after --crab-ascii.
    var slug: String { name.lowercased().replacingOccurrences(of: " ", with: "-") }
}

/// Every pose and animation frame of the crab (found with the same function the light uses), then the buttons.
func sheetRows() -> [[SheetItem]] {
    func crab(_ name: String, _ look: Look, working: Bool = true, phase: Double, still: Bool = false) -> SheetItem {
        SheetItem(name: name, look: look, crab: crabFrame(look: look, working: working, phase: phase, still: still),
                  button: nil)
    }
    func button(_ name: String, _ kind: ButtonKind, hover: Bool, pressed: Bool) -> SheetItem {
        SheetItem(name: name, look: kind == .resume ? .paused : .screen, crab: nil, button: (kind, hover, pressed))
    }
    let scuttle = (0..<4).map { crab("scuttle \($0 + 1)", .screen, phase: Double($0) * 0.16 + 0.08) }
    // The wave has four steps of 0.2 s (high, up, down, up); the Z's round is 1.6 s (it is brightest at 0.24 s).
    let wave = (0..<4).map { crab("happy \($0 + 1)", .done, phase: Double($0) * 0.2 + 0.1) }
    return [
        scuttle + [crab("hold 1", .screen, working: false, phase: 1.0),
                   crab("hold 2 blink", .screen, working: false, phase: 3.34)],
        [crab("peek-work 1", .app, phase: 0.2), crab("peek-work 2", .app, phase: 0.55),
         crab("peek-work 3", .app, phase: 1.1), crab("peek-work 4", .app, phase: 1.55),
         crab("peek-hold 1", .app, working: false, phase: 1.0),
         crab("peek-hold 2 blink", .app, working: false, phase: 3.34)],
        wave + [crab("asleep 1", .paused, working: false, phase: 0.24),
                crab("asleep 2", .paused, working: false, phase: 0.8)],
        [crab("asleep 3", .paused, working: false, phase: 1.36),
         crab("still screen", .screen, phase: 0, still: true), crab("still app", .app, phase: 0, still: true),
         crab("still done", .done, phase: 0, still: true), crab("still asleep", .paused, phase: 0, still: true)],
        [button("pause", .pause, hover: false, pressed: false), button("pause hover", .pause, hover: true, pressed: false),
         button("pause pressed", .pause, hover: true, pressed: true),
         button("resume", .resume, hover: false, pressed: false), button("resume hover", .resume, hover: true, pressed: false),
         button("resume pressed", .resume, hover: true, pressed: true)],
    ]
}

private func drawSheet(width: Int, height: Int, _ graphics: NSGraphicsContext) {
    let top = 44.0, cellW = 128.0, cellH = 120.0, pad = 16.0
    let h = CGFloat(height)
    srgb(0x15151A).setFill()
    NSBezierPath.fill(NSRect(x: 0, y: 0, width: width, height: height))
    ("Clawd: every pose and animation frame (6 pt per art pixel). Last row: the buttons (normal, hover, pressed)."
        as NSString).draw(at: NSPoint(x: pad, y: h - 30), withAttributes: [
            .font: NSFont.systemFont(ofSize: 13, weight: .semibold), .foregroundColor: NSColor(calibratedWhite: 1, alpha: 0.9)])
    let label: [NSAttributedString.Key: Any] = [
        .font: NSFont.monospacedSystemFont(ofSize: 10, weight: .regular),
        .foregroundColor: NSColor(calibratedWhite: 1, alpha: 0.62)]
    for (r, row) in sheetRows().enumerated() {
        for (c, item) in row.enumerated() {
            let outer = NSRect(x: pad + CGFloat(c) * cellW, y: h - top - CGFloat(r + 1) * cellH, width: cellW, height: cellH)
            let cell = outer.insetBy(dx: 4, dy: 4)
            srgb(0x202027).setFill()
            NSBezierPath(roundedRect: cell, xRadius: 6, yRadius: 6).fill()
            if let frame = item.crab {
                let origin = NSPoint(x: cell.minX + 15, y: cell.minY + 16)
                srgb(0xFFFFFF, alpha: 0.07).setStroke()
                NSBezierPath(rect: NSRect(x: origin.x, y: origin.y, width: 90, height: 72)).stroke()
                drawCrab(frame, accent: accent(item.look), scale: 6, origin: origin, in: graphics.cgContext)
            } else if let b = item.button {
                drawButton(kind: b.kind, hover: b.hover, pressed: b.pressed,
                           center: NSPoint(x: cell.midX, y: cell.minY + 54), scale: 1.8)
            }
            (item.name as NSString).draw(at: NSPoint(x: cell.minX + 6, y: cell.minY + 3), withAttributes: label)
        }
    }
}

// MARK: - --crab-ascii and --pose

func runAscii(_ name: String) -> Never {
    let items = sheetRows().flatMap { $0 }.filter { $0.crab != nil }
    if name == "list" {
        for item in items { print(item.slug) }
        exit(0)
    }
    // "snapshot-LOOK" is the pose the picture of that look is taken in.
    if name.hasPrefix("snapshot-"), let look = Look(rawValue: String(name.dropFirst("snapshot-".count))), look != .hidden {
        let frame = crabFrame(look: look, working: sample(look).working, phase: snapshotPhase(for: look), still: false)
        for row in asciiPicture(frame) { print(row) }
        exit(0)
    }
    // "standing" is the neutral standing crab of the art spec.
    let wanted = name == "standing" ? "hold-1" : name
    guard let item = items.first(where: { $0.slug == wanted }), let frame = item.crab else {
        fail("no such pose: \(name) (try --crab-ascii list)")
    }
    for row in asciiPicture(frame) { print(row) }
    exit(0)
}

/// The pose a look has at any moment of the clock, as letters (for tests that sweep the clock).
func runPose(look name: String, phase text: String) -> Never {
    guard let look = Look(rawValue: name), let phase = Double(text) else { fail("--pose LOOK PHASE [--working] [--still]") }
    let flags = CommandLine.arguments
    let frame = crabFrame(look: look, working: flags.contains("--working"), phase: phase, still: flags.contains("--still"))
    for row in asciiPicture(frame) { print(row) }
    exit(0)
}

// MARK: - --inspect

private func describe(_ panel: NSPanel, kind: String) -> [String: Any] {
    let f = panel.frame
    let table: [(NSWindow.CollectionBehavior, String)] = [
        (.canJoinAllSpaces, "canJoinAllSpaces"), (.moveToActiveSpace, "moveToActiveSpace"), (.managed, "managed"),
        (.transient, "transient"), (.stationary, "stationary"), (.participatesInCycle, "participatesInCycle"),
        (.ignoresCycle, "ignoresCycle"), (.fullScreenPrimary, "fullScreenPrimary"),
        (.fullScreenAuxiliary, "fullScreenAuxiliary"), (.fullScreenNone, "fullScreenNone")]
    let behavior = panel.collectionBehavior
    return ["kind": kind,
            "frame": ["x": f.origin.x, "y": f.origin.y, "w": f.size.width, "h": f.size.height],
            "level": panel.level.rawValue,
            "ignoresMouseEvents": panel.ignoresMouseEvents,
            "canBecomeKey": panel.canBecomeKey,
            "canBecomeMain": panel.canBecomeMain,
            "isFloatingPanel": panel.isFloatingPanel,
            "collectionBehavior": table.filter { behavior.contains($0.0) }.map { $0.1 }]
}

/// The windows the light would make on the first display for a look. They are made, measured and dropped:
/// nothing is ordered front, so nothing appears.
func runInspect(_ name: String) -> Never {
    guard let look = Look(rawValue: name) else { fail("unknown look: \(name)") }
    _ = NSApplication.shared
    let area = NSScreen.screens.first?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 875)
    var out: [[String: Any]] = []
    if look != .hidden {
        let slot = Slot(still: true)
        let on = lightFrames(in: area).on
        slot.pill.setFrame(on, display: false)
        out.append(describe(slot.pill, kind: "pill"))
        if sample(look).button != .none {
            slot.button.setFrame(buttonFrame(for: on), display: false)
            out.append(describe(slot.button, kind: "button"))
        }
    }
    let data = (try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])) ?? Data()
    print(String(data: data, encoding: .utf8) ?? "[]")
    exit(0)
}

// MARK: - --press-test and --hold-test

private func mouseEvent(_ type: NSEvent.EventType, at point: NSPoint, in view: NSView, clicks: Int) -> NSEvent {
    guard let event = NSEvent.mouseEvent(
        with: type, location: view.convert(point, to: nil), modifierFlags: [],
        timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: view.window?.windowNumber ?? 0, context: nil,
        eventNumber: 0, clickCount: clicks, pressure: type == .leftMouseUp ? 0 : 1) else { fail("could not make a mouse event") }
    return event
}

/// Builds the controller with a made-up live full-screen session, shows nothing, and plays steps against the real
/// button view. The steps come from `--steps "a b c"` (default `press file wait:2 press file`: two deliberate presses,
/// the file printed after each; `--release-outside` stands for `outside file`). A step is one of:
///   press        a click in the middle of the button
///   press2       the second click of a double-click (the mouse-up carries click count 2)
///   outside      mouse down in the middle of the button, mouse up outside it (which is no press)
///   dragback     mouse down on the button, dragged out and back in, mouse up inside (which is a press)
///   wait:SECS    move the controller's clock on (no real waiting)
///   file         print the pause file as it is now ("no file" when there is none)
///   shown        print what the light now shows: {"button", "detail", "look"}
/// `--fail` makes saving the pause file fail every time.
func runPressTest(dir: String) -> Never {
    _ = NSApplication.shared
    let flags = CommandLine.arguments
    let pausePath = (dir as NSString).appendingPathComponent("pause.json")
    let reader = PauseReader(path: pausePath)
    let controller = Controller(reducedMotion: true) {
        let now = nowMs()
        var s = Session()
        s.id = "press-test"
        s.mode = "screen"
        s.busy = true
        s.since = now
        s.last = now
        s.beat = now
        return decide([s], pause: reader.read(now: now), now: now)
    }
    var moment = nowMs()
    controller.clock = { moment }
    let failing = flags.contains("--fail")
    controller.writer = { failing ? false : PauseFile.write(paused: $0, by: "light", to: pausePath) }
    controller.headless = true
    let slot = controller.makeSlot()
    controller.slots[0] = slot
    controller.tick()
    let view = slot.buttonView
    let middle = NSPoint(x: view.bounds.midX, y: view.bounds.midY)
    func click(clicks: Int, releasedAt point: NSPoint) {
        view.mouseDown(with: mouseEvent(.leftMouseDown, at: middle, in: view, clicks: clicks))
        view.mouseUp(with: mouseEvent(.leftMouseUp, at: point, in: view, clicks: clicks))
    }
    let fallback = flags.contains("--release-outside") ? "outside file" : "press file wait:2 press file"
    for step in (value(after: "--steps") ?? fallback).split(separator: " ").map(String.init) {
        switch step {
        case "press": click(clicks: 1, releasedAt: middle)
        case "press2": click(clicks: 2, releasedAt: middle)
        case "outside": click(clicks: 1, releasedAt: NSPoint(x: -60, y: -60))
        case "dragback":
            // Down on the button, dragged out of it and back in, up inside: still a press, like any button.
            let away = NSPoint(x: -60, y: -60)
            view.mouseDown(with: mouseEvent(.leftMouseDown, at: middle, in: view, clicks: 1))
            view.mouseDragged(with: mouseEvent(.leftMouseDragged, at: away, in: view, clicks: 1))
            view.mouseDragged(with: mouseEvent(.leftMouseDragged, at: middle, in: view, clicks: 1))
            view.mouseUp(with: mouseEvent(.leftMouseUp, at: middle, in: view, clicks: 1))
        case "file": print((try? String(contentsOfFile: pausePath, encoding: .utf8)) ?? "no file")
        case "shown":
            let now = controller.current
            let out: [String: Any] = ["button": now.button.rawValue, "detail": now.detail, "look": now.look.rawValue]
            let data = (try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])) ?? Data()
            print(String(data: data, encoding: .utf8) ?? "{}")
        default:
            guard step.hasPrefix("wait:"), let seconds = Double(step.dropFirst("wait:".count)) else {
                fail("unknown step: \(step)")
            }
            moment += seconds * 1000
            controller.tick()
        }
    }
    exit(0)
}

/// How the pause reader treats a bad file: paused at once on a cold start, but the last good answer is kept
/// for two seconds when the file turns bad while the program is running.
func runHoldTest(dir: String) -> Never {
    try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
    let path = (dir as NSString).appendingPathComponent("pause.json")
    func put(_ text: String) { try? text.write(toFile: path, atomically: false, encoding: .utf8) }
    put("{ \"paused\": ")
    let cold = PauseReader(path: path).read(now: 0).name
    put(PauseFile.text(paused: false, at: 1, by: "command"))
    let reader = PauseReader(path: path)
    let good = reader.read(now: 0).name
    put("{ \"paused\": ")
    let early = reader.read(now: 100).name
    let late = reader.read(now: 1_900).name
    let expired = reader.read(now: 2_200).name
    put(PauseFile.text(paused: true, at: 2, by: "command"))
    let healed = reader.read(now: 2_300).name
    let out: [String: Any] = ["cold": cold, "good": good, "early": early, "late": late, "expired": expired,
                              "healed": healed]
    let data = (try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])) ?? Data()
    print(String(data: data, encoding: .utf8) ?? "{}")
    exit(0)
}

// MARK: - --older-test and --clock-test

/// `--older-test OTHER_VERSION OTHER_STARTED_MS MY_VERSION MY_BUILT_MS` ("-" for unknown): prints true when this program
/// would ask the light that is already running to quit and take its place (see `isOlderBuild`).
func runOlderTest() -> Never {
    func word(_ offset: Int) -> String? {
        let w = value(after: "--older-test", offset: offset)
        return (w == nil || w == "-") ? nil : w
    }
    let older = isOlderBuild(otherVersion: word(1), otherLaunched: word(2).flatMap(Double.init),
                             myVersion: word(3), myBuilt: word(4).flatMap(Double.init))
    print(older ? "true" : "false")
    exit(0)
}

/// `--clock-test MS ...`: the clock label for each number of milliseconds, one per line.
func runClockTest() -> Never {
    let all = CommandLine.arguments
    if let at = all.firstIndex(of: "--clock-test") {
        for word in all[(at + 1)...] { print(elapsedText(Double(word) ?? .nan)) }
    }
    exit(0)
}
