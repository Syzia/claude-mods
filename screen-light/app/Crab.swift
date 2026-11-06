// Crab.swift: Clawd, the little pixel-art crab at the left of the light.
//
// The crab is never drawn from typed-out pictures. A pose is a small description (CrabFrame: eyes, legs, arms,
// window, shift, floating Z), `parts` turns it into rectangles on a 15 x 12 grid, and `drawCrab` paints those
// rectangles with anti-aliasing off so every art pixel stays a hard square. The sprite is drawn at 3 pt per
// art pixel (45 x 36 pt) in the light and at 6 pt on the review sheet.

import AppKit

// MARK: - Colours

/// A colour from 0xRRGGBB, in the sRGB colour space.
func srgb(_ hex: UInt32, alpha: CGFloat = 1) -> NSColor {
    NSColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

/// The colour each look glows in (these are the accents the light has always used, plus red for paused).
func accent(_ look: Look) -> NSColor {
    switch look {
    case .screen: return srgb(0xFF7A38)
    case .app: return srgb(0x52A8FF)
    case .done, .resumed: return srgb(0x4DD680)
    case .paused: return srgb(0xFF5C6C)
    case .hidden: return NSColor.gray
    }
}

// MARK: - Parts and poses

/// What a rectangle is made of. The raw value is the letter used in --crab-ascii.
enum Ink: Character {
    case body = "O"      // Clawd's salmon, #D77757
    case dark = "K"      // eyes, #17171B
    case white = "W"     // the Z, #F1EDE6
    case accent = "A"    // the look's colour (window dots)
    case glass = "-"     // the inside of the small window, #0F0F12
    case edge = "#"      // the window's outline, white at 70%
    case ground = "_"    // the line under the legs, the look's colour at 35%
}

/// A rectangle on the 15 x 12 art grid (inclusive of x ..< x + w, y ..< y + h; y grows downward).
struct Part {
    var x: Int, y: Int, w: Int, h: Int
    var ink: Ink
    var alpha: CGFloat = 1
}

enum Eyes { case tall, blink, happy, sleep, left, right }
enum Legs { case a, b, short }
enum Arm { case rest, up, high }

struct CrabFrame: Equatable {
    var eyes = Eyes.tall
    var legs = Legs.a
    var leftArm = Arm.rest
    var rightArm = Arm.rest
    /// Peeking over a small window: it hides the crab's lower half, so no legs and no ground line.
    var window = false
    /// The whole crab sits this many art pixels lower (asleep).
    var dy = 0
    var ground = true
    /// Where the sleeping crab's Z is in its round, 0 ..< 1 (see `zAlpha`); nil for no Z.
    var z: Double?
}

private func armRow(_ arm: Arm) -> Int {
    switch arm {
    case .rest: return 4
    case .up: return 3
    case .high: return 2
    }
}

/// The rectangles of a pose, back to front.
func parts(_ f: CrabFrame) -> [Part] {
    var out: [Part] = []
    let dy = f.dy
    if f.ground && !f.window { out.append(Part(x: 2, y: 9, w: 11, h: 1, ink: .ground)) }
    if !f.window {
        let xs = f.legs == .b ? [4, 6, 8, 10] : [3, 5, 9, 11]
        for x in xs { out.append(Part(x: x, y: 7 + dy, w: 1, h: f.legs == .short ? 1 : 2, ink: .body)) }
    }
    out.append(Part(x: 1, y: armRow(f.leftArm) + dy, w: 2, h: 2, ink: .body))
    out.append(Part(x: 12, y: armRow(f.rightArm) + dy, w: 2, h: 2, ink: .body))
    out.append(Part(x: 3, y: 1 + dy, w: 9, h: 6, ink: .body))

    let ey = 2 + dy
    switch f.eyes {
    case .tall, .left, .right:
        let xs = f.eyes == .left ? [4, 8] : (f.eyes == .right ? [6, 10] : [5, 9])
        for x in xs { out.append(Part(x: x, y: ey, w: 1, h: 2, ink: .dark)) }
    case .blink:
        for x in [5, 9] { out.append(Part(x: x, y: ey + 1, w: 1, h: 1, ink: .dark)) }
    case .happy:
        for x in [5, 9] { out.append(Part(x: x, y: ey, w: 1, h: 1, ink: .dark)) }
        for x in [4, 6, 8, 10] { out.append(Part(x: x, y: ey + 1, w: 1, h: 1, ink: .dark)) }
    case .sleep:
        for x in [4, 8] { out.append(Part(x: x, y: ey + 1, w: 3, h: 1, ink: .dark)) }
    }

    if f.window {
        out.append(Part(x: 0, y: 6, w: 15, h: 5, ink: .glass))
        out.append(Part(x: 0, y: 6, w: 15, h: 1, ink: .edge))
        out.append(Part(x: 0, y: 10, w: 15, h: 1, ink: .edge))
        out.append(Part(x: 0, y: 7, w: 1, h: 3, ink: .edge))
        out.append(Part(x: 14, y: 7, w: 1, h: 3, ink: .edge))
        for x in [2, 4, 6] { out.append(Part(x: x, y: 7, w: 1, h: 1, ink: .accent)) }
    }

    if let p = f.z {
        // A small Z above the crab's right shoulder: 5 wide, 4 tall, with a two-pixel-thick diagonal that steps two
        // columns, so it reads as a Z (a thin 3 x 3 or 4 x 4 one reads as a capital I with serifs):
        //     WWWWW      x 10..14
        //     ...WW
        //     .WW..
        //     WWWWW
        // It has room for one place only: with its bottom bar on row 0 an empty row (1) lies between it and the
        // sleeping head (whose top row is 2), and with its top bar on row -3 an empty row (-4) lies between it and
        // the pill's top edge, which is 4 rows above the sprite. So it does not rise: it fades in and out where it is,
        // and never touches the crab or the edge of the pill.
        let a = zAlpha(p)
        for (x, y, w) in [(10, -3, 5), (13, -2, 2), (11, -1, 2), (10, 0, 5)] {
            out.append(Part(x: x, y: y, w: w, h: 1, ink: .white, alpha: a))
        }
    }
    return out
}

/// Where in its 1.6 s round the sleeping crab's Z is, 0 ..< 1, for any clock reading (even a negative one).
func zCycle(_ phase: Double) -> Double {
    guard phase.isFinite else { return 0 }
    let rest = phase.truncatingRemainder(dividingBy: 1.6)
    return (rest < 0 ? rest + 1.6 : rest) / 1.6
}

/// How strongly the Z shows at a point of its round: it comes in over the first sixth, then fades out.
func zAlpha(_ p: Double) -> CGFloat {
    let at = min(max(p, 0), 1)
    return CGFloat(min(at / 0.15, 1) * (1 - at))
}

private func color(of ink: Ink, accent: NSColor) -> NSColor {
    switch ink {
    case .body: return srgb(0xD77757)
    case .dark: return srgb(0x17171B)
    case .white: return srgb(0xF1EDE6)
    case .accent: return accent
    case .glass: return srgb(0x0F0F12)
    case .edge: return srgb(0xF1EDE6, alpha: 0.7)
    case .ground: return accent.withAlphaComponent(0.35)
    }
}

/// Paints a pose. `origin` is the bottom-left corner of the 15 x 12 grid; keep it (and `scale`) whole numbers.
func drawCrab(_ frame: CrabFrame, accent: NSColor, scale: CGFloat, origin: NSPoint, in cg: CGContext) {
    cg.saveGState()
    cg.setShouldAntialias(false)
    cg.setBlendMode(.normal)
    for part in parts(frame) {
        let base = color(of: part.ink, accent: accent)
        cg.setFillColor(base.withAlphaComponent(base.alphaComponent * part.alpha).cgColor)
        cg.fill(CGRect(x: origin.x + CGFloat(part.x) * scale,
                       y: origin.y + CGFloat(12 - part.y - part.h) * scale,
                       width: CGFloat(part.w) * scale, height: CGFloat(part.h) * scale))
    }
    cg.restoreGState()
}

/// The pose as text, one letter per art pixel (rows from y = 0, or from the highest part when a Z floats above).
func asciiPicture(_ f: CrabFrame) -> [String] {
    let all = parts(f)
    let top = min(0, all.map { $0.y }.min() ?? 0)
    var rows = [[Character]](repeating: [Character](repeating: ".", count: 15), count: 12 - top)
    for part in all {
        for y in part.y ..< part.y + part.h {
            for x in part.x ..< part.x + part.w where x >= 0 && x < 15 { rows[y - top][x] = part.ink.rawValue }
        }
    }
    return rows.map { String($0) }
}

// MARK: - Which pose, when

/// Frame clock: `phase` is seconds on a clock that only moves forward. One scuttle step is 0.16 s.
private func step(_ phase: Double, _ length: Double, _ count: Int) -> Int {
    let n = (phase / length).rounded(.down)
    // Always 0 ..< count: a clock reading before 2001 is negative, and a silly one must not overflow the conversion.
    guard n.isFinite, abs(n) < 1e15 else { return 0 }
    return ((Int(n) % count) + count) % count
}

private func blinking(_ phase: Double) -> Bool {
    phase.truncatingRemainder(dividingBy: 3.4) >= 3.28
}

/// The pose for a look at a moment. `still` (Reduce Motion, or a picture of one frame) shows the resting pose.
func crabFrame(look: Look, working: Bool, phase: Double, still: Bool) -> CrabFrame {
    var f = CrabFrame()
    switch look {
    case .hidden:
        break
    case .screen:
        if working && !still {
            // Walks on the spot, sideways: legs A, legs B with the left arm up, legs A, legs B with the right arm up.
            switch step(phase, 0.16, 4) {
            case 1: f.legs = .b; f.leftArm = .up
            case 3: f.legs = .b; f.rightArm = .up
            default: break
            }
        } else if !still && blinking(phase) {
            f.eyes = .blink
        }
    case .app:
        f.window = true
        f.ground = false
        if working && !still {
            f.eyes = [Eyes.tall, .left, .tall, .right][step(phase, 0.5, 4)]
            if step(phase, 0.32, 2) == 0 { f.leftArm = .up } else { f.rightArm = .up }
        } else if !still && blinking(phase) {
            f.eyes = .blink
        }
    case .done, .resumed:
        f.eyes = .happy
        f.ground = false
        // The right arm waves: high, up, down, up (0.2 s each), a swing of two art pixels. Reduce Motion: up, still.
        f.rightArm = still ? .up : [Arm.high, .up, .rest, .up][step(phase, 0.2, 4)]
    case .paused:
        f.eyes = .sleep
        f.legs = .short
        f.dy = 1
        f.z = still ? 0.15 : zCycle(phase)
    }
    return f
}

/// How strongly the soft glow behind the crab shines.
func glowAlpha(look: Look, working: Bool, phase: Double, still: Bool) -> CGFloat {
    switch look {
    case .screen, .app:
        let lo = working ? 0.18 : 0.12
        let hi = working ? 0.38 : 0.24
        let period = working ? 1.1 : 2.8
        if still { return CGFloat((lo + hi) / 2) }
        let wave = 0.5 - 0.5 * cos(2 * Double.pi * phase.truncatingRemainder(dividingBy: period) / period)
        return CGFloat(lo + (hi - lo) * wave)
    case .done, .resumed, .paused:
        return 0.22
    case .hidden:
        return 0
    }
}
