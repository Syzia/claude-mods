// Crab Buddy: a pixel crab that floats above your desktop.
// It reads the status files the crab-buddy mod writes to ~/.claude/crab-buddy/sessions,
// works along while Claude is working, waves when a chat needs you, celebrates when a
// turn ends, slumps when one fails, dozes off when nothing is happening, and opens the
// chat in question when clicked.
//
// The crab is not a fixed sprite sheet: every frame is drawn from shapes into a small
// pixel buffer (with shading and an automatic outline), so every motion is continuous.
import AppKit

let claudeBundleID = "com.anthropic.claudefordesktop"
/// Apps a chat without a desktop session id may be running in.
let terminalBundleIDs: Set<String> = [
    "com.apple.Terminal", "com.googlecode.iterm2", "dev.warp.Warp-Stable", "com.mitchellh.ghostty",
    "net.kovidgoyal.kitty", "org.alacritty", "com.microsoft.VSCode", "dev.zed.Zed",
]
// For trying the crab out by hand: CRAB_BUDDY_DIR points it at another folder of status
// files, CRAB_BUDDY_FRONT stands in for the app in front.
let environment = ProcessInfo.processInfo.environment
let baseDir = environment["CRAB_BUDDY_DIR"].map { URL(fileURLWithPath: $0) }
    ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".claude/crab-buddy")
let sessionsDir = baseDir.appendingPathComponent("sessions")
let showSignal = baseDir.appendingPathComponent("show")   // the mod's /crab touches this to end a "hide for an hour"

let staleAfter: TimeInterval = 20 * 60   // a "running" file older than this no longer counts
let awakeFor: TimeInterval = 90          // stays awake this long after the last activity

// MARK: - Status

/// What the crab shows, least to most pressing. `calm` is a chat waiting on you that you have already seen.
enum Mood: Int { case asleep, awake, stopped, done, failed, calm, running, alert }

struct Chat {
    let id: String
    let mood: Mood
    let label: String
    let title: String
    let folder: String
    let host: String?        // the desktop app's id for the chat, when it runs there
    let updated: TimeInterval

    var name: String {
        let text = title.isEmpty ? (folder.isEmpty ? "Chat" : folder) : title
        return text.count > 36 ? String(text.prefix(35)) + "…" : text
    }
}

struct Status {
    var mood = Mood.asleep
    var label = ""
    var chats: [Chat] = []
    var focus: Chat?         // the chat a click opens
}

/// Chat id -> the `updated` stamp of the wait the person has already seen.
var seenWaiting: [String: TimeInterval] = [:]

func readStatus(frontApp: String?) -> Status {
    let now = Date().timeIntervalSince1970
    var chats: [Chat] = []
    let files = (try? FileManager.default.contentsOfDirectory(at: sessionsDir, includingPropertiesForKeys: nil)) ?? []
    for file in files where file.pathExtension == "json" {
        guard let data = try? Data(contentsOf: file),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let state = obj["state"] as? String,
              let updatedMs = obj["updated"] as? Double else { continue }
        let id = file.deletingPathExtension().lastPathComponent
        let updated = updatedMs / 1000
        let age = now - updated
        if age > 24 * 3600 { try? FileManager.default.removeItem(at: file); continue }
        // a chat whose process is gone can not be doing anything, whatever its file says
        if let pid = obj["pid"] as? Int, pid > 1, kill(pid_t(pid), 0) != 0, errno == ESRCH {
            try? FileManager.default.removeItem(at: file); continue
        }
        if state == "away" || state == "gone" { continue }   // a chat the crab left, or one that ended

        let host = (obj["host"] as? String).flatMap { $0.range(of: "^local_[A-Za-z0-9-]{1,64}$", options: .regularExpression) != nil ? $0 : nil }
        var label = obj["label"] as? String ?? ""
        var mood = age < awakeFor ? Mood.awake : Mood.asleep
        switch state {
        case "running" where age < staleAfter:
            mood = .running
            if label.isEmpty { label = "Working" }
        case "waiting" where age < 12 * 3600:
            // looking at the app the chat lives in counts as having seen it
            if seenWaiting[id] != updated, let front = frontApp,
               front == claudeBundleID || (host == nil && terminalBundleIDs.contains(front)) {
                seenWaiting[id] = updated
            }
            if seenWaiting[id] != updated {
                mood = .alert
                if label.isEmpty { label = "Needs you" }
            } else if obj["kind"] as? String == "permission" {
                mood = .running; label = "Working"   // you were there to answer; the tool is running
            } else {
                mood = .calm; label = "Waiting for you"
            }
        case "done" where age < 6: mood = .done; label = "Done"
        case "failed" where age < 10:
            mood = .failed
            if label.isEmpty { label = "Hit an error" }
        case "stopped" where age < 4: mood = .stopped; label = "Stopped"
        default: label = ""
        }
        chats.append(Chat(id: id, mood: mood, label: label, title: obj["title"] as? String ?? "",
                          folder: obj["folder"] as? String ?? "", host: host, updated: updated))
    }
    chats.sort { ($0.mood.rawValue, $0.updated) > ($1.mood.rawValue, $1.updated) }
    seenWaiting = seenWaiting.filter { entry in chats.contains { $0.id == entry.key } }

    var status = Status(chats: chats, focus: chats.first)
    guard let top = chats.first else { return status }
    status.mood = top.mood
    status.label = top.label
    let busy = chats.filter { $0.mood.rawValue >= Mood.calm.rawValue }.count
    if top.mood.rawValue >= Mood.calm.rawValue && busy > 1 { status.label += " +\(busy - 1)" }
    return status
}

// MARK: - Settings

enum Settings {
    static let defaults = UserDefaults.standard
    static let sizes: [(key: String, name: String, unit: CGFloat)] = [("small", "Small", 2), ("medium", "Medium", 2.5), ("large", "Large", 3.5)]

    static var size: String {
        get { defaults.string(forKey: "size") ?? "medium" }
        set { defaults.set(newValue, forKey: "size"); knownUnit = nil }
    }
    /// Asked for many times a frame, so looked up once.
    static var unit: CGFloat {
        if let unit = knownUnit { return unit }
        let unit = sizes.first { $0.key == size }?.unit ?? 2.5
        knownUnit = unit
        return unit
    }
    static var knownUnit: CGFloat?
    static var hasSounds: Bool {
        get { defaults.bool(forKey: "sounds") }
        set { defaults.set(newValue, forKey: "sounds") }
    }
    static var wanders: Bool {
        get { defaults.object(forKey: "wander") == nil ? true : defaults.bool(forKey: "wander") }
        set { defaults.set(newValue, forKey: "wander") }
    }
    static var hiddenUntil: TimeInterval {
        get { defaults.double(forKey: "hiddenUntil") }
        set { defaults.set(newValue, forKey: "hiddenUntil") }
    }
    /// Where the crab lives: the middle of the bottom edge of its window.
    static var anchor: NSPoint? {
        get {
            if let saved = defaults.string(forKey: "anchor") { return NSPointFromString(saved) }
            if let old = defaults.string(forKey: "origin") {   // the first versions saved a 200pt window's corner
                let point = NSPointFromString(old)
                return NSPoint(x: point.x + 100, y: point.y)
            }
            return nil
        }
        set { if let point = newValue { defaults.set(NSStringFromPoint(point), forKey: "anchor") } }
    }
}

// MARK: - Pixel canvas

func rgb(_ hex: UInt32) -> UInt32 {   // 0xRRGGBB -> the canvas's in-memory RGBA
    let r = (hex >> 16) & 0xff, g = (hex >> 8) & 0xff, b = hex & 0xff
    return 0xFF00_0000 | (b << 16) | (g << 8) | r
}

func clamp(_ v: Double, _ lo: Double, _ hi: Double) -> Double { min(hi, max(lo, v)) }
func mix(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

func sdRoundRect(_ x: Double, _ y: Double, _ cx: Double, _ cy: Double, _ hw: Double, _ hh: Double, _ r: Double) -> Double {
    let qx = abs(x - cx) - (hw - r), qy = abs(y - cy) - (hh - r)
    let ox = max(qx, 0), oy = max(qy, 0)
    return (ox * ox + oy * oy).squareRoot() + min(max(qx, qy), 0) - r
}

func sdCapsule(_ x: Double, _ y: Double, _ ax: Double, _ ay: Double, _ bx: Double, _ by: Double, _ r: Double) -> Double {
    let pax = x - ax, pay = y - ay, bax = bx - ax, bay = by - ay
    let len2 = bax * bax + bay * bay
    let h = len2 > 0 ? clamp((pax * bax + pay * bay) / len2, 0, 1) : 0
    let dx = pax - bax * h, dy = pay - bay * h
    return (dx * dx + dy * dy).squareRoot() - r
}

final class Canvas {
    let w: Int, h: Int
    var px: [UInt32]
    var ids: [UInt8]   // which part owns each pixel; 0 is empty, higher is nearer the viewer

    init(w: Int, h: Int) {
        self.w = w; self.h = h
        px = [UInt32](repeating: 0, count: w * h)
        ids = [UInt8](repeating: 0, count: w * h)
    }

    func clear() {
        for i in 0..<(w * h) { px[i] = 0; ids[i] = 0 }
    }

    /// Fills every pixel whose centre lies inside the shape.
    func fill(id: UInt8, x0: Double, y0: Double, x1: Double, y1: Double,
              sdf: (Double, Double) -> Double, color: (Double, Double) -> UInt32) {
        let xa = max(0, Int(x0.rounded(.down))), xb = min(w - 1, Int(x1.rounded(.up)))
        let ya = max(0, Int(y0.rounded(.down))), yb = min(h - 1, Int(y1.rounded(.up)))
        guard xa <= xb, ya <= yb else { return }
        for y in ya...yb {
            for x in xa...xb {
                let fx = Double(x) + 0.5, fy = Double(y) + 0.5
                if sdf(fx, fy) <= 0 {
                    px[y * w + x] = color(fx, fy)
                    ids[y * w + x] = id
                }
            }
        }
    }

    /// Draws a dark outline around the silhouette and a seam where a nearer part overlaps a farther one.
    func finish(outline: UInt32, seam: UInt32) {
        var out = px
        for y in 0..<h {
            for x in 0..<w {
                let i = y * w + x
                let me = ids[i]
                let left = x > 0 ? ids[i - 1] : 0, right = x < w - 1 ? ids[i + 1] : 0
                let up = y > 0 ? ids[i - w] : 0, down = y < h - 1 ? ids[i + w] : 0
                if me == 0 {
                    if left != 0 || right != 0 || up != 0 || down != 0 { out[i] = outline }
                } else if left > me || right > me || up > me || down > me {
                    out[i] = seam
                }
            }
        }
        px = out
    }

    /// Paints one pixel, but only on top of the given part.
    func dot(_ x: Int, _ y: Int, _ color: UInt32, on part: UInt8) {
        guard x >= 0, x < w, y >= 0, y < h, ids[y * w + x] == part else { return }
        px[y * w + x] = color
    }

    func image() -> CGImage? {
        px.withUnsafeMutableBytes { raw -> CGImage? in
            guard let ctx = CGContext(data: raw.baseAddress, width: w, height: h, bitsPerComponent: 8,
                                      bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
            return ctx.makeImage()
        }
    }
}

// MARK: - The crab

enum Mouth { case line, smile, open, grin, frown }
enum Eyes { case open, happy, sleepy, dizzy }

struct Pose {
    var sx = 1.0, sy = 1.0            // squash and stretch of the body
    var armL = 0.5, armR = 0.5        // arm angles, radians above horizontal
    var openL = 0.3, openR = 0.3      // how far each pincer is open, 0...1
    var eyes = Eyes.open
    var eyeOpen = 1.0
    var lookX = 0, lookY = 0
    var legPhase = 0.0, scuttle = 0.0, air = 0.0
    var dangle = 0.0                  // 1 while picked up: the legs hang
    var mouth = Mouth.smile
    var hat = "", neck = "", glasses = ""   // what he wears
    var feeling = ""                       // a feeling that marks his face
}

enum Paint {
    static let outline = rgb(0x4A1F14)
    static let base = rgb(0xD97757)
    static let light = rgb(0xF0A07E)
    static let glint = rgb(0xFBD3BC)
    static let shade = rgb(0xB8593D)
    static let deep = rgb(0x8F3F2A)
    static let eye = rgb(0x2A1511)
    static let white = rgb(0xFFFFFF)
    static let blush = rgb(0xEC6A5E)
    static let tongue = rgb(0xF7A192)
}

let legPart: UInt8 = 1, armPart: UInt8 = 2, bodyPart: UInt8 = 3, clawPart: UInt8 = 4

func renderCrab(_ c: Canvas, _ p: Pose) {
    c.clear()
    let cx = 28.0, ground = 46.0
    let hw = 13.0 * p.sx, hh = 8.5 * p.sy
    let by = ground - 4.0 - hh   // body centre; the feet stay planted while the body squashes

    // legs, three a side, splayed outwards (hanging straight down while picked up)
    for side in [-1.0, 1.0] {
        for i in 0..<3 {
            let n = Double(i)
            let phase = p.legPhase + n * 2.094 + (side > 0 ? Double.pi : 0)
            let swing = sin(phase) * 1.3 * p.scuttle
            let lift = max(0, cos(phase)) * 1.7 * p.scuttle
            let hipX = cx + side * (5.5 + n * 3.0), hipY = by + hh - 1.5
            let footX = mix(cx + side * (8.0 + n * 3.6 + p.air) + swing, hipX + side * 0.6 + sin(phase) * 0.9, p.dangle)
            let footY = mix(ground - 0.6 - lift - 1.8 * p.air, hipY + 5.2, p.dangle)
            c.fill(id: legPart, x0: min(hipX, footX) - 2, y0: hipY - 2, x1: max(hipX, footX) + 2, y1: footY + 2,
                   sdf: { sdCapsule($0, $1, hipX, hipY, footX, footY, 1.0) },
                   color: { _, y in y > footY - 1.2 ? Paint.deep : Paint.shade })
        }
    }

    // arms and claws
    var claws: [(x: Double, y: Double, dx: Double, dy: Double, open: Double)] = []
    for side in [-1.0, 1.0] {
        let angle = side < 0 ? p.armL : p.armR
        let open = side < 0 ? p.openL : p.openR
        let sx = cx + side * (hw - 1.5), sy = by - 0.5
        let dx = side * cos(angle), dy = -sin(angle)
        let clawX = sx + dx * 8.5, clawY = sy + dy * 8.5
        c.fill(id: armPart, x0: min(sx, clawX) - 3, y0: min(sy, clawY) - 3, x1: max(sx, clawX) + 3, y1: max(sy, clawY) + 3,
               sdf: { sdCapsule($0, $1, sx, sy, clawX - dx * 2, clawY - dy * 2, 1.5) },
               color: { _, _ in Paint.shade })
        // the pincer opens up and inwards, towards the space above the head
        let wedge = angle + 0.55
        claws.append((clawX, clawY, side * cos(wedge), -sin(wedge), open))
    }

    // body
    c.fill(id: bodyPart, x0: cx - hw - 1, y0: by - hh - 1, x1: cx + hw + 1, y1: by + hh + 1,
           sdf: { sdRoundRect($0, $1, cx, by, hw, hh, min(6.0, hh - 0.5)) },
           color: { x, y in
               let t = (y - by) / hh * 0.85 + (x - cx) / hw * 0.22
               return t < -0.5 ? Paint.light : t > 0.52 ? Paint.shade : Paint.base
           })

    for claw in claws {
        let r = 4.3
        let cosHalf = cos(0.2 + 0.55 * claw.open)
        c.fill(id: clawPart, x0: claw.x - r - 1, y0: claw.y - r - 1, x1: claw.x + r + 1, y1: claw.y + r + 1,
               sdf: { x, y in
                   let vx = x - claw.x, vy = y - claw.y
                   let d = (vx * vx + vy * vy).squareRoot()
                   if d > 1.1 && (vx * claw.dx + vy * claw.dy) / d > cosHalf { return 1 }   // the gap of the pincer
                   return d - r
               },
               color: { x, y in
                   let t = (y - claw.y) / r * 0.85 + (x - claw.x) / r * 0.22
                   return t < -0.42 ? Paint.light : t > 0.45 ? Paint.shade : Paint.base
               })
    }

    c.finish(outline: Paint.outline, seam: Paint.deep)

    // the face sits on whole pixels so it never smears while the body moves
    let fx = Int(cx.rounded())
    let faceRow = Int((by - 0.5).rounded())
    let ey = faceRow + p.lookY
    let top = Int((by - hh).rounded())

    // a glint on the shell
    c.dot(fx - 9, top + 3, Paint.glint, on: bodyPart)
    c.dot(fx - 8, top + 2, Paint.glint, on: bodyPart)
    c.dot(fx - 7, top + 2, Paint.glint, on: bodyPart)
    c.dot(fx - 5, top + 2, Paint.glint, on: bodyPart)

    for eyeCol in [fx - 6, fx + 5] {
        switch p.eyes {
        case .happy:
            for (dx, dy) in [(-2, 1), (-1, 0), (0, -1), (1, 0), (2, 1)] { c.dot(eyeCol + dx, faceRow + dy, Paint.eye, on: bodyPart) }
        case .sleepy:
            for (dx, dy) in [(-2, 0), (-1, 1), (0, 1), (1, 1), (2, 0)] { c.dot(eyeCol + dx, faceRow + dy, Paint.eye, on: bodyPart) }
        case .dizzy:
            for (dx, dy) in [(-1, -1), (1, -1), (0, 0), (-1, 1), (1, 1)] { c.dot(eyeCol + dx, faceRow + dy, Paint.eye, on: bodyPart) }
        case .open:
            let half = Int((2.0 * p.eyeOpen).rounded())
            let col = eyeCol + p.lookX
            for dy in -half...half {
                for dx in -1...1 where !(half == 2 && abs(dy) == 2 && dx != 0) {
                    c.dot(col + dx, ey + dy, Paint.eye, on: bodyPart)
                }
            }
            if half >= 1 { c.dot(col - 1, ey - 1, Paint.white, on: bodyPart) }
        }
    }

    // cheeks
    for x in [fx - 9, fx - 8, fx + 7, fx + 8] { c.dot(x, faceRow + 3, Paint.blush, on: bodyPart) }

    let my = faceRow + 4
    switch p.mouth {
    case .line:
        c.dot(fx - 1, my, Paint.eye, on: bodyPart); c.dot(fx, my, Paint.eye, on: bodyPart)
    case .smile:
        for (dx, dy) in [(-2, 0), (-1, 1), (0, 1), (1, 0)] { c.dot(fx + dx, my + dy, Paint.eye, on: bodyPart) }
    case .frown:
        for (dx, dy) in [(-2, 1), (-1, 0), (0, 0), (1, 1)] { c.dot(fx + dx, my + dy, Paint.eye, on: bodyPart) }
    case .open:
        for (dx, dy) in [(-1, 0), (0, 0), (-1, 1), (0, 1)] { c.dot(fx + dx, my + dy, Paint.eye, on: bodyPart) }
    case .grin:
        for dx in -2...1 { c.dot(fx + dx, my, Paint.eye, on: bodyPart) }
        c.dot(fx - 1, my + 1, Paint.tongue, on: bodyPart); c.dot(fx, my + 1, Paint.tongue, on: bodyPart)
    }

    drawExtras(c, p, fx: fx, top: top, faceRow: faceRow)
}

// MARK: - Layers

/// A few pixels of pixel art (a "z", a sparkle, a "!") with a dark drop shadow so it reads on any wallpaper.
final class GlyphLayer: CALayer {
    let shadow = CAShapeLayer(), fill = CAShapeLayer()
    var shown = ""

    init(color: NSColor, pixelScale: CGFloat) {
        super.init()
        shadow.fillColor = CGColor(srgbRed: 0.16, green: 0.08, blue: 0.06, alpha: 0.85)
        fill.fillColor = color.cgColor
        for part in [shadow, fill] {
            part.contentsScale = pixelScale
            addSublayer(part)
        }
        opacity = 0
    }

    override init(layer: Any) { super.init(layer: layer) }
    required init?(coder: NSCoder) { fatalError("not used") }

    func show(_ rows: [String], unit: CGFloat) {
        let key = rows.joined(separator: "/") + "@\(unit)"
        guard key != shown else { return }
        shown = key
        let path = CGMutablePath()
        for (r, row) in rows.enumerated() {
            for (c, ch) in row.enumerated() where ch == "#" {
                path.addRect(CGRect(x: CGFloat(c) * unit, y: CGFloat(rows.count - 1 - r) * unit, width: unit, height: unit))
            }
        }
        fill.path = path
        shadow.path = path
        shadow.position = CGPoint(x: 0.6 * unit, y: -0.6 * unit)
    }
}

enum PillIcon { case none, dots, check, cross, bang, wait, stop }

// MARK: - View

final class CrabView: NSView {
    static let artW = 56, artH = 50
    static let pillSpace: CGFloat = 34   // room under the crab for the status pill

    /// The window a crab of this size needs: room for the pill below and a hop above.
    static func windowSize(unit: CGFloat) -> NSSize {
        NSSize(width: max(CGFloat(artW) * unit + 30, 216), height: (pillSpace + CGFloat(artH + 9) * unit).rounded(.up))
    }

    let canvas = Canvas(w: artW, h: artH)
    let extras = Extras()   // feelings, dreams, the ask bar, his wardrobe

    var status = Status() {
        didSet {
            guard status.mood != oldValue.mood else { return }
            switch status.mood {
            case .done: doneStart = t; play("Glass")
            case .alert: play("Ping")
            case .failed: sadStart = t; play("Basso")
            case .running: squashV += 2.4   // perks up
            default: break
            }
        }
    }

    /// Where the crab lives; it wanders around this and comes back to it.
    var home: NSPoint = .zero

    var t = 0.0
    var wWork = 0.0, wHappy = 0.0, wSleep = 1.0, wHover = 0.0, wAlert = 0.0, wSad = 0.0
    var wHeld = 0.0, wWalk = 0.0, wPill = 0.0
    var doneStart = -100.0, sadStart = -100.0
    var squash = 0.0, squashV = 0.0   // a little spring, poked by clicks
    var swing = 0.0, swingV = 0.0     // how far he swings while carried
    var dragSpeed = 0.0
    var legPhase = 0.0
    var lookX = 0, lookY = 0
    var isHovering = false, isHeld = false
    var pillIcon = PillIcon.none
    var pillLabel = ""
    var walkTarget: CGFloat?
    var nextWalkAt = 14.0

    var downScreenPoint: NSPoint = .zero
    var downOrigin: NSPoint = .zero
    var lastDragX: CGFloat = 0
    var lastDragAt = 0.0

    /// Points per art pixel, snapped so one art pixel is a whole number of screen pixels.
    var unit: CGFloat { (Settings.unit * backing).rounded() / backing }
    var backing: CGFloat { window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2 }

    var spriteRect: NSRect {
        let size = NSSize(width: CGFloat(Self.artW) * unit, height: CGFloat(Self.artH) * unit)
        return NSRect(origin: NSPoint(x: (bounds.width - size.width) / 2, y: Self.pillSpace), size: size)
    }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: spriteRect.insetBy(dx: 8, dy: 0),
                                       options: [.mouseEnteredAndExited, .activeAlways], owner: self))
    }

    override func mouseEntered(with event: NSEvent) { isHovering = true }
    override func mouseExited(with event: NSEvent) { isHovering = false }

    func play(_ sound: String) {
        if Settings.hasSounds { NSSound(named: sound)?.play() }
    }

    // MARK: animation

    /// How often the crab needs a new frame: every screen refresh while it is busy or
    /// changing, less often while it only breathes.
    var frameInterval: Double {
        let weights = [wWork, wHappy, wHover, wAlert, wSad, wHeld, wWalk, wPill]
        let isSettled = weights.allSatisfy { $0 < 0.01 } && abs(squash) < 0.004 && abs(swing) < 0.004
        guard isSettled, extras.isQuiet else { return 0 }
        return wSleep > 0.99 ? 1.0 / 20 : wSleep < 0.01 ? 1.0 / 30 : 0
    }

    func step(_ dt: Double) {
        t += dt
        let quick = 1 - exp(-dt * 7)
        let mood = status.mood
        wWork += ((mood == .running ? 1 : 0) - wWork) * quick
        wHappy += ((mood == .done ? 1 : 0) - wHappy) * quick
        wAlert += ((mood == .alert ? 1 : 0) - wAlert) * quick
        wSad += ((mood == .failed ? 1 : 0) - wSad) * quick
        wHover += ((isHovering ? 1 : 0) - wHover) * quick
        wHeld += ((isHeld ? 1 : 0) - wHeld) * (1 - exp(-dt * 12))
        wSleep += (((mood == .asleep && !isHovering && !isHeld) ? 1 : 0) - wSleep) * (1 - exp(-dt * 3))

        switch mood {
        case .running: pillIcon = .dots; pillLabel = status.label
        case .alert: pillIcon = .bang; pillLabel = status.label
        case .calm: pillIcon = .wait; pillLabel = status.label
        case .done: pillIcon = .check; pillLabel = "Done"
        case .failed: pillIcon = .cross; pillLabel = status.label
        case .stopped: pillIcon = .stop; pillLabel = "Stopped"
        case .awake, .asleep: break   // hovering brings out the ask bar instead
        }
        let showsPill = mood.rawValue >= Mood.stopped.rawValue
        wPill += ((showsPill ? 1 : 0) - wPill) * (1 - exp(-dt * 10))

        squashV += (-260 * squash - 16 * squashV) * dt
        squash += squashV * dt
        // carried: he swings behind the pointer, then settles
        let swingTarget = isHeld ? clamp(-dragSpeed * 0.0035, -0.4, 0.4) : 0
        swingV += (90 * (swingTarget - swing) - 9 * swingV) * dt
        swing += swingV * dt
        dragSpeed *= exp(-dt * 6)
        legPhase += dt * 13

        watchPointer()
        wander(dt)
        extras.step(dt, self)
        render()
    }

    /// The eyes follow the pointer while he has nothing else to look at.
    func watchPointer() {
        guard let window = window else { return }
        let mouse = NSEvent.mouseLocation
        let centre = NSPoint(x: window.frame.minX + spriteRect.midX, y: window.frame.minY + spriteRect.midY)
        let dx = Double(mouse.x - centre.x), dy = Double(mouse.y - centre.y)
        let far = (dx * dx + dy * dy).squareRoot()
        guard far > 36 else { lookX = 0; lookY = 0; return }
        lookX = dx > far * 0.38 ? 1 : dx < -far * 0.38 ? -1 : 0
        lookY = dy > far * 0.5 ? -1 : dy < -far * 0.5 ? 1 : 0
    }

    /// Now and then, with nothing to do, he scuttles a little way along and back.
    func wander(_ dt: Double) {
        guard let window = window else { return }
        let isFree = Settings.wanders && status.mood == .awake && !isHovering && !isHeld
        if !isFree { walkTarget = nil; nextWalkAt = max(nextWalkAt, t + 8) }
        if isFree, walkTarget == nil, t > nextWalkAt, let screen = window.screen ?? NSScreen.main {
            let margin = (window.frame.width - spriteRect.width) / 2
            let reach = CGFloat.random(in: 40...110) * (Bool.random() ? 1 : -1)
            let lo = screen.visibleFrame.minX - margin, hi = screen.visibleFrame.maxX - window.frame.width + margin
            walkTarget = min(max(home.x - window.frame.width / 2 + reach, lo), max(lo, hi))
        }
        if let target = walkTarget {
            let x = window.frame.origin.x
            let stride = CGFloat(34 * dt)
            if abs(target - x) <= stride {
                window.setFrameOrigin(NSPoint(x: target, y: window.frame.origin.y))
                walkTarget = nil
                nextWalkAt = t + Double.random(in: 18...40)
            } else {
                window.setFrameOrigin(NSPoint(x: x + (target > x ? stride : -stride), y: window.frame.origin.y))
            }
        }
        wWalk += ((walkTarget != nil ? 1 : 0) - wWalk) * (1 - exp(-dt * 9))
    }

    func currentPose() -> (pose: Pose, hop: Double, lean: Double) {
        let tau = Double.pi * 2
        let since = t - doneStart
        let fade = exp(-since * 0.45)
        let happyHop = 8.0 * abs(sin(since * Double.pi * 1.6)) * fade
        let workBob = 1.2 * (0.5 - 0.5 * cos(t * tau * 2.2))
        // needing you: bursts of four quick hops, then a breath
        let burst = t.truncatingRemainder(dividingBy: 2.6)
        let alertHop = burst < 1.4 ? 3.2 * abs(sin(burst * Double.pi / 0.35)) : 0
        let walkBob = 0.6 * abs(sin(legPhase))
        let hop = wWork * workBob + wHappy * happyHop + wAlert * alertHop + wWalk * walkBob
        let shake = 0.9 * sin(t * tau * 7) * exp(-(t - sadStart) * 1.6)
        let lean = wWork * 0.8 * sin(t * tau * 1.1) + wSad * shake

        var pose = Pose()
        let breath = (0.018 + 0.022 * wSleep) * sin(t * tau * 0.28)
        let crouch = -0.13 * exp(-happyHop * happyHop / 1.5) * fade * wHappy
        let stretch = 0.09 * (happyHop / 8) * wHappy + 0.05 * (alertHop / 3.2) * wAlert + 0.06 * wHeld
        let slump = -0.06 * wSad
        pose.sy = clamp(1 + breath + wWork * 0.03 * sin(t * tau * 2.2) + crouch + stretch + slump + squash, 0.7, 1.3)
        pose.sx = 1 - (pose.sy - 1) * 0.7

        func arm(_ side: Double) -> Double {
            let flip = side > 0 ? Double.pi : 0
            let awake = 0.5 + 0.07 * sin(t * 1.4 + flip * 0.5)
            let asleep = -0.8 + 0.04 * sin(t * tau * 0.28)
            let working = 0.8 + 0.45 * sin(t * tau * 2.2 + flip)
            let happy = 1.3 + 0.18 * sin(since * tau * 3 + flip * 0.5)
            let alert = 1.25 + 0.3 * sin(t * tau * 3.2 + flip * 0.3)
            let held = 1.0 + 0.4 * sin(t * tau * 4.5 + flip)
            let angle = awake + wSleep * (asleep - awake) + wWork * (working - awake) + wHappy * (happy - awake)
                + wAlert * (alert - awake) + wSad * (-0.55 - awake) + wHeld * (held - awake)
            return clamp(angle, -1.0, 1.55)
        }
        func pincer(_ side: Double) -> Double {
            let flip = side > 0 ? Double.pi : 0
            let snapping = 0.5 + 0.5 * sin(t * tau * 4.4 + flip)
            let open = 0.3 + wSleep * (0.05 - 0.3) + wWork * (snapping - 0.3) + wHappy * (0.85 - 0.3)
                + wAlert * (0.9 - 0.3) + wSad * (0.1 - 0.3) + wHeld * (snapping - 0.3)
            return clamp(open, 0, 1)
        }
        pose.armL = arm(-1); pose.armR = arm(1)
        pose.openL = pincer(-1); pose.openR = pincer(1)

        // hovering: a wave with the right claw
        let wave = wHover * (1 - wWork) * (1 - wHappy) * (1 - wAlert) * (1 - wHeld)
        pose.armR += wave * ((1.15 + 0.3 * sin(t * tau * 2.4)) - pose.armR)
        pose.openR += wave * ((0.5 + 0.5 * sin(t * tau * 4.8)) - pose.openR)

        let blinkAt = t.truncatingRemainder(dividingBy: 3.4)
        let blink = blinkAt < 0.16 ? sin(blinkAt / 0.16 * Double.pi) : 0
        pose.eyeOpen = (1 - blink) * (1 - min(1, wSleep / 0.5))
        if wHeld > 0.5 || wAlert > 0.5 {
            pose.eyeOpen = 1   // wide eyed
            pose.mouth = .open
        } else if wSad > 0.5 {
            pose.eyes = .dizzy
            pose.mouth = .frown
        } else if wWork > 0.5 {
            pose.lookX = Int(clamp((sin(t * 1.7) * 1.4).rounded(), -1, 1))   // eyes follow the work
            pose.lookY = 1
            pose.mouth = sin(t * tau * 2.2) > 0.3 ? .open : .line
        } else if wHappy > 0.5 {
            pose.eyes = .happy
            pose.mouth = .grin
        } else if wSleep > 0.5 {
            pose.eyes = .sleepy
            pose.mouth = .line
        } else {
            pose.lookX = lookX
            pose.lookY = lookY
            pose.mouth = wHover > 0.5 ? .grin : .smile
        }

        pose.legPhase = legPhase
        pose.scuttle = max(wWork, wWalk, wHeld * 0.6)
        pose.air = min(1, happyHop / 3) * wHappy
        pose.dangle = wHeld
        var feltHop = hop, feltLean = lean
        extras.adjust(&pose, &feltHop, &feltLean, self)
        return (pose, feltHop, feltLean)
    }

    // MARK: layers
    // Everything on screen is a layer the GPU composites, so a frame costs almost nothing.

    let shadowA = CALayer(), shadowB = CALayer()
    let spriteLayer = CALayer()
    var lastPixels: [UInt32] = []
    var zLayers: [GlyphLayer] = []
    var sparkLayers: [GlyphLayer] = []
    var bangLayer: GlyphLayer!
    let pill = CALayer()
    let pillText = CATextLayer()
    var dots: [CALayer] = []
    let mark = CAShapeLayer()
    var shownLabel = "\u{0}"
    var shownIcon = PillIcon.none
    let pillHeight: CGFloat = 23
    let pillFont = NSFont.systemFont(ofSize: 11.5, weight: .medium)

    static let orange = CGColor(srgbRed: 0.94, green: 0.60, blue: 0.47, alpha: 1)
    static let green = CGColor(srgbRed: 0.36, green: 0.82, blue: 0.54, alpha: 1)
    static let red = CGColor(srgbRed: 0.96, green: 0.42, blue: 0.40, alpha: 1)
    static let amber = CGColor(srgbRed: 1.0, green: 0.72, blue: 0.22, alpha: 1)
    static let grey = CGColor(gray: 0.62, alpha: 1)

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        guard let root = layer else { return }
        let pixelScale = NSScreen.main?.backingScaleFactor ?? 2

        for shadow in [shadowA, shadowB] {
            shadow.backgroundColor = CGColor(gray: 0, alpha: 0.2)
            root.addSublayer(shadow)
        }
        spriteLayer.magnificationFilter = .nearest
        spriteLayer.contentsGravity = .resize
        root.addSublayer(spriteLayer)

        for _ in 0..<3 {
            let z = GlyphLayer(color: NSColor(srgbRed: 0.93, green: 0.91, blue: 0.96, alpha: 1), pixelScale: pixelScale)
            zLayers.append(z); root.addSublayer(z)
        }
        for _ in 0..<6 {
            let spark = GlyphLayer(color: NSColor(srgbRed: 1, green: 0.85, blue: 0.42, alpha: 1), pixelScale: pixelScale)
            sparkLayers.append(spark); root.addSublayer(spark)
        }
        bangLayer = GlyphLayer(color: NSColor(srgbRed: 1.0, green: 0.72, blue: 0.22, alpha: 1), pixelScale: pixelScale)
        root.addSublayer(bangLayer)
        extras.attach(to: root, pixelScale: pixelScale)

        pill.anchorPoint = .zero
        pill.backgroundColor = CGColor(gray: 0.11, alpha: 0.94)
        pill.borderWidth = 1
        pill.cornerRadius = pillHeight / 2
        pill.opacity = 0
        root.addSublayer(pill)

        pillText.font = pillFont
        pillText.fontSize = 11.5
        pillText.foregroundColor = CGColor(gray: 1, alpha: 1)
        pillText.contentsScale = pixelScale
        pillText.anchorPoint = .zero
        pill.addSublayer(pillText)

        for _ in 0..<3 {
            let dot = CALayer()
            dot.bounds = CGRect(x: 0, y: 0, width: 4, height: 4)
            dot.cornerRadius = 2
            dot.backgroundColor = Self.orange
            dots.append(dot); pill.addSublayer(dot)
        }

        mark.lineWidth = 2
        mark.lineCap = .round
        mark.lineJoin = .round
        mark.contentsScale = pixelScale
        pill.addSublayer(mark)
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    /// A rectangle given in art pixels (y down), in view coordinates.
    func art(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> NSRect {
        let o = spriteRect.origin
        return NSRect(x: o.x + CGFloat(x) * unit, y: o.y + (CGFloat(Self.artH) - CGFloat(y + h)) * unit,
                      width: CGFloat(w) * unit, height: CGFloat(h) * unit)
    }

    func render() {
        let (pose, hop, lean) = currentPose()
        let dx = (CGFloat(lean) * unit * backing).rounded() / backing
        let dy = ((CGFloat(hop) * unit + CGFloat(wHeld) * 6) * backing).rounded() / backing

        CATransaction.begin()
        CATransaction.setDisableActions(true)

        // shadow on the ground, shrinking as the crab leaves it and gone while he is carried
        let shadowHalf = 15.0 * (1 - min(hop, 9) / 24)
        shadowA.frame = art(28 - shadowHalf, 46.4, shadowHalf * 2, 1).offsetBy(dx: dx, dy: 0)
        shadowB.frame = art(28 - shadowHalf + 2, 47.4, shadowHalf * 2 - 4, 1).offsetBy(dx: dx, dy: 0)
        shadowA.opacity = Float(1 - wHeld)
        shadowB.opacity = Float(1 - wHeld)

        renderCrab(canvas, pose)
        if canvas.px != lastPixels {   // most frames only move the sprite; the pixels change less often
            lastPixels = canvas.px
            spriteLayer.contents = canvas.image()
        }
        let rect = spriteRect.offsetBy(dx: dx, dy: dy)
        spriteLayer.bounds = CGRect(origin: .zero, size: rect.size)
        spriteLayer.position = CGPoint(x: rect.midX, y: rect.midY)
        spriteLayer.setAffineTransform(CGAffineTransform(rotationAngle: CGFloat(swing)))

        // zzz drifting up while asleep
        let asleep = clamp((wSleep - 0.6) / 0.4, 0, 1) * (1 - extras.dreamAlpha)   // a dream takes their place
        let smallZ = ["###", ".#.", "###"]
        let mediumZ = ["####", "..#.", ".#..", "####"]
        let largeZ = ["#####", "...#.", "..#..", ".#...", "#####"]
        for (k, z) in zLayers.enumerated() {
            guard asleep > 0.01 else { z.opacity = 0; continue }
            let life = (t / 3.6 + Double(k) / 3).truncatingRemainder(dividingBy: 1)
            let rows = life < 0.3 ? smallZ : life < 0.62 ? mediumZ : largeZ
            z.show(rows, unit: unit)
            z.position = art(40 + 9 * life + sin(life * 9 + Double(k)) * 1.2, 21 - 17 * life, 1, Double(rows.count)).origin
            z.opacity = Float(min(1, life * 5) * min(1, (1 - life) * 3) * asleep)
        }

        // sparkles when a turn finishes
        let since = t - doneStart
        let smallStar = [".#.", "###", ".#."]
        let bigStar = ["..#..", "..#..", "#####", "..#..", "..#.."]
        let spots: [(Double, Double)] = [(6, 15), (47, 12), (26, 5), (13, 6), (44, 24), (3, 27)]
        for (i, spark) in sparkLayers.enumerated() {
            let life = (since - Double(i) * 0.22).truncatingRemainder(dividingBy: 1.5) / 0.75
            guard wHappy > 0.01, since > Double(i) * 0.22, life >= 0, life < 1 else { spark.opacity = 0; continue }
            let isBig = life > 0.25 && life < 0.7
            let rows = isBig ? bigStar : smallStar
            spark.show(rows, unit: unit)
            spark.position = art(spots[i].0 - (isBig ? 2 : 1), spots[i].1 - (isBig ? 2 : 1) - hop * 0.4, 1, Double(rows.count)).origin
            spark.opacity = Float(sin(life * Double.pi) * wHappy)
        }

        // a "!" over his head while a chat needs you
        if wAlert > 0.01 {
            let rows = ["##", "##", "##", "##", "..", "##"]
            bangLayer.show(rows, unit: unit)
            bangLayer.position = art(27, 9 - hop * 0.6 - sin(t * 6) * 0.6, 1, Double(rows.count)).origin
            bangLayer.opacity = Float(wAlert)
        } else {
            bangLayer.opacity = 0
        }

        // the status pill under the crab
        pill.opacity = Float(wPill)
        if wPill > 0.01 {
            if pillLabel != shownLabel || pillIcon != shownIcon { layoutPill() }
            pill.position = CGPoint(x: ((bounds.width - pill.bounds.width) / 2 * backing).rounded() / backing,
                                    y: 5 - CGFloat(1 - wPill) * 5)
            for (i, dot) in dots.enumerated() {   // three dots, bouncing in a wave
                let bounce = max(0, sin(t * Double.pi * 2 * 1.3 - Double(i) * 0.8))
                dot.position = CGPoint(x: 14 + CGFloat(i) * 6, y: pillHeight / 2 - 2.5 + CGFloat(bounce) * 5)
            }
            mark.opacity = pillIcon == .bang ? Float(0.65 + 0.35 * sin(t * 7)) : 1
        }

        extras.render(self, hop: hop)

        CATransaction.commit()
    }

    func layoutPill() {
        shownLabel = pillLabel
        shownIcon = pillIcon
        let label = pillLabel.count > 26 ? String(pillLabel.prefix(25)) + "…" : pillLabel
        let textSize = (label as NSString).size(withAttributes: [.font: pillFont])
        let iconWidth: CGFloat = pillIcon == .none ? 0 : pillIcon == .dots ? 22 : 17
        pill.bounds = CGRect(x: 0, y: 0, width: (textSize.width + iconWidth + 23).rounded(.up), height: pillHeight)
        pill.borderColor = pillIcon == .bang ? Self.amber.copy(alpha: 0.75) : CGColor(gray: 1, alpha: 0.14)
        pillText.string = label
        pillText.bounds = CGRect(x: 0, y: 0, width: textSize.width.rounded(.up) + 2, height: textSize.height.rounded(.up))
        pillText.position = CGPoint(x: 11 + iconWidth, y: ((pillHeight - textSize.height) / 2).rounded())
        dots.forEach { $0.isHidden = pillIcon != .dots }

        let mid = pillHeight / 2, x: CGFloat = 16
        let path = CGMutablePath()
        var color = Self.grey, isFilled = false
        switch pillIcon {
        case .check:
            path.move(to: CGPoint(x: x - 4.5, y: mid)); path.addLine(to: CGPoint(x: x - 1.5, y: mid - 3.5))
            path.addLine(to: CGPoint(x: x + 5, y: mid + 4))
            color = Self.green
        case .cross:
            path.move(to: CGPoint(x: x - 3.5, y: mid - 3.5)); path.addLine(to: CGPoint(x: x + 3.5, y: mid + 3.5))
            path.move(to: CGPoint(x: x - 3.5, y: mid + 3.5)); path.addLine(to: CGPoint(x: x + 3.5, y: mid - 3.5))
            color = Self.red
        case .bang:
            path.move(to: CGPoint(x: x, y: mid + 5)); path.addLine(to: CGPoint(x: x, y: mid - 0.5))
            path.move(to: CGPoint(x: x, y: mid - 4.6)); path.addLine(to: CGPoint(x: x, y: mid - 4.5))
            color = Self.amber
        case .wait:
            path.addEllipse(in: CGRect(x: x - 3.5, y: mid - 3.5, width: 7, height: 7))
            color = Self.amber; isFilled = true
        case .stop:
            path.addRoundedRect(in: CGRect(x: x - 3.5, y: mid - 3.5, width: 7, height: 7), cornerWidth: 1.5, cornerHeight: 1.5)
            isFilled = true
        case .none, .dots:
            break
        }
        mark.path = path
        mark.fillColor = isFilled ? color : nil
        mark.strokeColor = isFilled ? nil : color
    }

    // MARK: mouse: click opens the chat, drag carries the crab

    override func mouseDown(with event: NSEvent) {
        downScreenPoint = NSEvent.mouseLocation
        downOrigin = window?.frame.origin ?? .zero
        lastDragX = downScreenPoint.x
        lastDragAt = CACurrentMediaTime()
        isHeld = false
        squashV = -3.2   // a squish under the pointer
    }

    override func mouseDragged(with event: NSEvent) {
        let now = NSEvent.mouseLocation
        let dx = now.x - downScreenPoint.x, dy = now.y - downScreenPoint.y
        if abs(dx) + abs(dy) > 3 { isHeld = true }
        guard isHeld else { return }
        let at = CACurrentMediaTime()
        if at > lastDragAt { dragSpeed = mix(dragSpeed, Double(now.x - lastDragX) / (at - lastDragAt), 0.35) }
        lastDragX = now.x; lastDragAt = at
        walkTarget = nil
        window?.setFrameOrigin(NSPoint(x: downOrigin.x + dx, y: downOrigin.y + dy))
    }

    override func mouseUp(with event: NSEvent) {
        if isHeld {
            isHeld = false
            squashV = -3.6   // lands with a squash
            if let frame = window?.frame {
                home = NSPoint(x: frame.midX, y: frame.minY)
                Settings.anchor = home
            }
        } else {
            open(status.focus)
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        let menu = NSMenu()
        menu.autoenablesItems = false

        if !status.chats.isEmpty {
            let header = menu.addItem(withTitle: "Chats", action: nil, keyEquivalent: "")
            header.isEnabled = false
            for (index, chat) in status.chats.prefix(12).enumerated() {
                let item = menu.addItem(withTitle: "", action: #selector(menuChat(_:)), keyEquivalent: "")
                item.target = self
                item.tag = index
                let (dot, text): (NSColor, String) = {
                    switch chat.mood {
                    case .alert: return (.systemOrange, chat.label)
                    case .calm: return (.systemOrange, "Waiting for you")
                    case .running: return (NSColor(cgColor: Self.orange) ?? .systemOrange, chat.label)
                    case .failed: return (.systemRed, chat.label)
                    case .done: return (.systemGreen, "Done")
                    case .stopped: return (.systemGray, "Stopped")
                    case .awake, .asleep: return (.tertiaryLabelColor, "Idle")
                    }
                }()
                let title = NSMutableAttributedString(string: "● ", attributes: [.foregroundColor: dot, .font: NSFont.menuFont(ofSize: 0)])
                title.append(NSAttributedString(string: chat.name, attributes: [.font: NSFont.menuFont(ofSize: 0)]))
                title.append(NSAttributedString(string: "   \(text)", attributes: [.foregroundColor: NSColor.secondaryLabelColor, .font: NSFont.menuFont(ofSize: 0)]))
                item.attributedTitle = title
            }
            menu.addItem(.separator())
        }

        menu.addItem(withTitle: "Open Claude", action: #selector(menuOpen), keyEquivalent: "").target = self
        menu.addItem(.separator())

        extras.addMenuItems(menu)
        menu.addItem(.separator())

        let sizeItem = menu.addItem(withTitle: "Size", action: nil, keyEquivalent: "")
        let sizes = NSMenu()
        for (index, size) in Settings.sizes.enumerated() {
            let item = sizes.addItem(withTitle: size.name, action: #selector(menuSize(_:)), keyEquivalent: "")
            item.target = self
            item.tag = index
            item.state = Settings.size == size.key ? .on : .off
        }
        sizeItem.submenu = sizes

        let sounds = menu.addItem(withTitle: "Sounds", action: #selector(menuSounds), keyEquivalent: "")
        sounds.target = self
        sounds.state = Settings.hasSounds ? .on : .off
        let wanders = menu.addItem(withTitle: "Wander when idle", action: #selector(menuWander), keyEquivalent: "")
        wanders.target = self
        wanders.state = Settings.wanders ? .on : .off

        menu.addItem(withTitle: "Hide for an hour", action: #selector(menuHide), keyEquivalent: "").target = self
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Crab Buddy", action: #selector(menuQuit), keyEquivalent: "").target = self
        NSMenu.popUpContextMenu(menu, with: event, for: self)
    }

    @objc func menuChat(_ item: NSMenuItem) {
        if status.chats.indices.contains(item.tag) { open(status.chats[item.tag]) }
    }
    @objc func menuOpen() { open(nil) }
    @objc func menuSize(_ item: NSMenuItem) {
        Settings.size = Settings.sizes[item.tag].key
        (NSApp.delegate as? AppDelegate)?.applySize()
    }
    @objc func menuSounds() {
        Settings.hasSounds.toggle()
        play("Glass")   // what "on" sounds like
    }
    @objc func menuWander() { Settings.wanders.toggle() }
    @objc func menuHide() { (NSApp.delegate as? AppDelegate)?.hide(for: 3600) }
    @objc func menuQuit() { NSApp.terminate(nil) }

    /// Opens the given chat in the Claude app when it lives there, else just the app.
    func open(_ chat: Chat?) {
        for waiting in status.chats where waiting.mood == .alert && (chat == nil || waiting.id == chat?.id) {
            seenWaiting[waiting.id] = waiting.updated   // a click means you have seen it
        }
        if let host = chat?.host, var link = URLComponents(string: "claude://code/continue") {
            link.queryItems = [URLQueryItem(name: "session", value: host)]
            if let url = link.url, NSWorkspace.shared.open(url) { return }
        }
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: claudeBundleID) else { return }
        let config = NSWorkspace.OpenConfiguration()
        config.activates = true
        NSWorkspace.shared.openApplication(at: url, configuration: config)
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate {
    var panel: NSPanel!
    var crab: CrabView!
    var lastFrame = CACurrentMediaTime()
    var sincePoll = 1.0
    var sinceDraw = 0.0

    func applicationDidFinishLaunching(_ note: Notification) {
        let size = CrabView.windowSize(unit: Settings.unit)
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        var anchor = NSPoint(x: screen.maxX - size.width / 2 - 24, y: screen.minY + 24)
        if let saved = Settings.anchor, NSScreen.screens.contains(where: { $0.frame.insetBy(dx: -40, dy: -40).contains(saved) }) {
            anchor = saved
        }

        panel = NSPanel(contentRect: NSRect(x: anchor.x - size.width / 2, y: anchor.y, width: size.width, height: size.height),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.hidesOnDeactivate = false
        panel.isMovable = false

        crab = CrabView(frame: NSRect(origin: .zero, size: size))
        crab.home = anchor
        panel.contentView = crab
        crab.step(0)
        if Date().timeIntervalSince1970 >= Settings.hiddenUntil { panel.orderFrontRegardless() }

        let timer = Timer(timeInterval: 1.0 / 60.0, repeats: true) { [weak self] _ in self?.frame() }
        RunLoop.main.add(timer, forMode: .common)   // keeps animating while dragged or while a menu is up
    }

    /// Resizes the window for the chosen size, keeping the crab's feet where they are.
    func applySize() {
        let size = CrabView.windowSize(unit: Settings.unit)
        let frame = panel.frame
        panel.setFrame(NSRect(x: frame.midX - size.width / 2, y: frame.minY, width: size.width, height: size.height), display: true)
        crab.frame = NSRect(origin: .zero, size: size)
        crab.updateTrackingAreas()
        crab.home = NSPoint(x: panel.frame.midX, y: panel.frame.minY)
        Settings.anchor = crab.home
    }

    func hide(for seconds: TimeInterval) {
        Settings.hiddenUntil = Date().timeIntervalSince1970 + seconds
        try? FileManager.default.removeItem(at: showSignal)
        panel.orderOut(nil)
    }

    func frame() {
        let now = CACurrentMediaTime()
        let dt = min(now - lastFrame, 0.05)
        lastFrame = now
        sincePoll += dt

        if !panel.isVisible {   // hidden for an hour: wake for /crab or when the hour is up
            guard sincePoll >= 1 else { return }
            sincePoll = 0
            let isAsked = FileManager.default.fileExists(atPath: showSignal.path)
            guard isAsked || Date().timeIntervalSince1970 >= Settings.hiddenUntil else { return }
            Settings.hiddenUntil = 0
            panel.orderFrontRegardless()
        }

        if sincePoll >= 0.25 {
            sincePoll = 0
            try? FileManager.default.removeItem(at: showSignal)
            crab.status = readStatus(frontApp: environment["CRAB_BUDDY_FRONT"] ?? NSWorkspace.shared.frontmostApplication?.bundleIdentifier)
        }
        sinceDraw += dt
        if sinceDraw + 0.004 >= crab.frameInterval {
            crab.step(sinceDraw)
            sinceDraw = 0
        }
    }
}
