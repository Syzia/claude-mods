// How the crab feels beyond what his chats are doing: he loves being stroked, gets dizzy
// when shaken, strains through a long turn, grows impatient while you keep him waiting,
// yawns before he dozes off, hums on a walk, and thinks when you ask him something.
import AppKit

enum Feeling { case none, love, dizzy, strained, impatient, yawn, humming, thinking }

extension GlyphLayer {
    var tint: CGColor? {
        get { fill.fillColor }
        set { fill.fillColor = newValue }
    }
}

final class Feelings {
    private(set) var now = Feeling.none
    private var since = 0.0
    private var until = 0.0          // when a passing feeling (love, dizzy, yawn) ends
    private var petTravel = 0.0
    private var lastMouse: NSPoint?
    private var shakes = 0, lastShake = 0.0, wasHeld = false
    private var runningFor = 0.0, calmFor = 0.0, awakeFor = 0.0, hasYawned = false
    private var layers: [GlyphLayer] = []

    private static let pink = CGColor(srgbRed: 1.0, green: 0.45, blue: 0.60, alpha: 1)
    private static let yellow = CGColor(srgbRed: 1.0, green: 0.85, blue: 0.42, alpha: 1)
    private static let blue = CGColor(srgbRed: 0.55, green: 0.82, blue: 1.0, alpha: 1)
    private static let white = CGColor(srgbRed: 0.96, green: 0.95, blue: 0.99, alpha: 1)

    func attach(to root: CALayer, pixelScale: CGFloat) {
        for _ in 0..<3 {
            let glyph = GlyphLayer(color: .white, pixelScale: pixelScale)
            layers.append(glyph)
            root.addSublayer(glyph)
        }
    }

    private func pass(_ feeling: Feeling, for seconds: Double, at t: Double) {
        if now != feeling { since = t }
        now = feeling
        until = t + seconds
    }

    /// For trying a feeling by hand (CRAB_BUDDY_SHOW): holds it for a minute.
    func force(_ name: String, at t: Double) {
        let named: [String: Feeling] = ["love": .love, "dizzy": .dizzy, "strained": .strained, "impatient": .impatient,
                                        "yawn": .yawn, "humming": .humming, "thinking": .thinking]
        if let feeling = named[name] { pass(feeling, for: 60, at: t) }
    }

    /// A feeling never talks over the moods that matter more: needing you, a failure, a finish, being carried.
    private func isShown(_ v: CrabView) -> Bool {
        now != .none && v.wAlert < 0.5 && v.wSad < 0.5 && v.wHappy < 0.5 && v.wHeld < 0.5
    }

    func step(_ dt: Double, _ v: CrabView, isThinking: Bool) {
        let t = v.t

        // stroking: the pointer moving back and forth over him
        let mouse = NSEvent.mouseLocation
        if v.isHovering, !v.isHeld, let last = lastMouse { petTravel += Double(hypot(mouse.x - last.x, mouse.y - last.y)) }
        lastMouse = mouse
        petTravel *= exp(-dt * 0.9)
        if petTravel > 240 { petTravel = 0; pass(.love, for: 3.2, at: t) }

        // shaking: carried quickly one way and then the other, several times
        if v.isHeld {
            let way = v.dragSpeed > 350 ? 1.0 : v.dragSpeed < -350 ? -1.0 : 0
            if way != 0, way != lastShake { shakes += 1; lastShake = way }
        } else {
            if wasHeld, shakes >= 5 { pass(.dizzy, for: 3.4, at: t) }
            shakes = 0; lastShake = 0
        }
        wasHeld = v.isHeld

        let mood = v.status.mood
        runningFor = mood == .running ? runningFor + dt : 0
        calmFor = mood == .calm ? calmFor + dt : 0
        if mood == .awake { awakeFor += dt } else { awakeFor = 0; hasYawned = false }
        if mood == .awake, awakeFor > 68, !hasYawned, !v.isHovering { hasYawned = true; pass(.yawn, for: 2.6, at: t) }

        if t >= until {   // no passing feeling: the one his situation gives him, if any
            let lasting: Feeling = isThinking ? .thinking : calmFor > 45 ? .impatient
                : runningFor > 120 ? .strained : v.wWalk > 0.5 ? .humming : .none
            if lasting != now { since = t }
            now = lasting
        }
    }

    func adjust(_ pose: inout Pose, _ hop: inout Double, _ lean: inout Double, _ v: CrabView) {
        guard isShown(v) else { return }
        let t = v.t, age = t - since
        switch now {
        case .love:
            pose.eyes = .happy; pose.mouth = .grin; pose.feeling = "love"
            lean += 0.9 * sin(t * 11)
            pose.armL += 0.25; pose.armR += 0.25
        case .dizzy:
            pose.eyes = .dizzy; pose.mouth = .open
            lean += 1.6 * sin(t * 5.5)
            pose.armL = 0.1 + 0.3 * sin(t * 5.5); pose.armR = 0.1 - 0.3 * sin(t * 5.5)
        case .strained:
            pose.feeling = "strained"
        case .impatient:   // looks at you and taps his feet
            pose.mouth = .line
            pose.lookX = v.lookX; pose.lookY = v.lookY
            if t.truncatingRemainder(dividingBy: 1.6) < 0.8 { pose.scuttle = max(pose.scuttle, 0.55) }
        case .yawn:
            let wide = sin(clamp(age / 2.6, 0, 1) * Double.pi)
            pose.eyes = .sleepy
            if wide > 0.35 { pose.feeling = "yawn" }
            pose.armL += 0.7 * wide; pose.armR += 0.7 * wide
            pose.sy += 0.05 * wide
            pose.sx = 1 - (pose.sy - 1) * 0.7
        case .humming:
            pose.eyes = .happy; pose.mouth = .smile
        case .thinking:    // looks up and away, one claw tucked in
            pose.eyes = .open; pose.eyeOpen = 1
            pose.lookX = 1; pose.lookY = -1
            pose.mouth = .line
            pose.armR = 0.15; pose.openR = 0.1
        case .none:
            break
        }
    }

    func render(_ v: CrabView, hop: Double) {
        let t = v.t, age = t - since, unit = v.unit
        var used = 0
        func place(_ rows: [String], x: Double, y: Double, alpha: Double, color: CGColor) {
            guard used < layers.count else { return }
            let glyph = layers[used]
            used += 1
            glyph.tint = color
            glyph.show(rows, unit: unit)
            glyph.position = v.art(x, y, 1, Double(rows.count)).origin
            glyph.opacity = Float(clamp(alpha, 0, 1))
        }

        if isShown(v) {
            switch now {
            case .love:
                let heart = [".#.#.", "#####", "#####", ".###.", "..#.."]
                for i in 0..<3 {
                    let life = ((age + Double(i) * 0.45) / 1.5).truncatingRemainder(dividingBy: 1)
                    place(heart, x: 17 + Double(i) * 8 + sin(life * 6 + Double(i)) * 1.5, y: 19 - 14 * life - hop * 0.5,
                          alpha: sin(life * Double.pi), color: Self.pink)
                }
            case .dizzy:
                let star = [".#.", "###", ".#."]
                for i in 0..<3 {
                    let turn = t * 4 + Double(i) * 2.094
                    place(star, x: 26.5 + 10 * cos(turn), y: 16 + 2.5 * sin(turn), alpha: 0.65 + 0.35 * sin(turn), color: Self.yellow)
                }
            case .strained:
                let drop = [".#.", ".#.", "###", "###", ".#."]
                for i in 0..<2 {
                    let life = ((t + Double(i) * 0.6) / 1.2).truncatingRemainder(dividingBy: 1)
                    let side = i == 0 ? -1.0 : 1.0
                    place(drop, x: 26.5 + side * (14 + 7 * life), y: 22 - 6 * life + 10 * life * life, alpha: 1 - life, color: Self.blue)
                }
            case .impatient, .thinking:
                let lit = Int(age * 2.5) % 4
                for i in 0..<3 { place(["##", "##"], x: 41 + Double(i) * 4, y: 17 - (i < lit ? 1 : 0), alpha: i < lit ? 1 : 0.3, color: Self.white) }
            case .humming:
                let note = ["..##", "..#.", "..#.", "###.", "###."]
                for i in 0..<2 {
                    let life = ((age + Double(i) * 0.7) / 1.6).truncatingRemainder(dividingBy: 1)
                    place(note, x: 40 + 5 * life + Double(i) * 4, y: 21 - 12 * life, alpha: sin(life * Double.pi), color: Self.white)
                }
            case .yawn, .none:
                break
            }
        }
        for glyph in layers[used...] { glyph.opacity = 0 }
    }
}
