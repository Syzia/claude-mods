// What the crab dreams: once he has been asleep a few seconds a thought cloud grows
// above his head and plays little scenes. When he has dreamt up an idea for you, the
// cloud shows a light bulb until you come and wake him.
import AppKit

final class DreamCloud {
    static let w = 34, h = 24
    private let canvas = Canvas(w: w, h: h)
    private let layer = CALayer()
    private let puffs = [CALayer(), CALayer()]
    private var sleptFor = 0.0
    private var lastFrame = -1
    private(set) var alpha = 0.0
    var hasIdea = false

    private static let white = rgb(0xF6F3FB), shade = rgb(0xDCD6EC), edge = rgb(0x4B3F63)
    private static let ink: [Character: UInt32] = [
        "o": rgb(0xD97757), "O": rgb(0xB8593D), "k": rgb(0x2A1F33), "b": rgb(0x7FB6F2), "B": rgb(0x4A7BE0),
        "y": rgb(0xF6C445), "Y": rgb(0xE09A1F), "r": rgb(0xE0453C), "g": rgb(0x48B06F), "n": rgb(0x8B5A2B),
        "w": rgb(0xFFFFFF), "s": rgb(0xA9A3B8), "K": rgb(0x6C6777),
    ]

    /// How long he has been fast asleep, in seconds.
    var asleepFor: Double { sleptFor }

    func attach(to root: CALayer) {
        for puff in puffs {
            puff.backgroundColor = CGColor(srgbRed: 0.96, green: 0.95, blue: 0.98, alpha: 1)
            puff.borderColor = CGColor(srgbRed: 0.29, green: 0.25, blue: 0.39, alpha: 1)
            puff.opacity = 0
            root.addSublayer(puff)
        }
        layer.magnificationFilter = .nearest
        layer.contentsGravity = .resize
        layer.opacity = 0
        root.addSublayer(layer)
    }

    func step(_ dt: Double, _ v: CrabView) {
        sleptFor = v.wSleep > 0.95 ? sleptFor + dt : 0
        let target = sleptFor > 5 ? 1.0 : 0.0
        alpha += (target - alpha) * (1 - exp(-dt * (target > 0 ? 2 : 9)))
    }

    func render(_ v: CrabView) {
        layer.opacity = Float(alpha)
        guard alpha > 0.01 else { puffs.forEach { $0.opacity = 0 }; return }

        let frame = Int(v.t * 12)   // a dream needs no more than twelve pictures a second
        if frame != lastFrame {
            lastFrame = frame
            draw(v.t)
            layer.contents = canvas.image()
        }
        let drift = CGFloat(sin(v.t * 0.9)) * 1.5
        layer.frame = v.art(26, -8, Double(Self.w), Double(Self.h)).offsetBy(dx: 0, dy: drift)

        // two little puffs lead from his head up to the cloud, one after the other
        let spots: [(Double, Double, Double)] = [(40, 20.5, 2.5), (42.5, 16, 4)]
        for (i, puff) in puffs.enumerated() {
            let rect = v.art(spots[i].0, spots[i].1, spots[i].2, spots[i].2).offsetBy(dx: 0, dy: drift * CGFloat(i + 1) / 3)
            puff.frame = rect
            puff.cornerRadius = rect.width / 2
            puff.borderWidth = max(1, v.unit * 0.5)
            puff.opacity = Float(clamp(alpha * 2 - Double(i) * 0.5, 0, 1))
        }
    }

    private func dot(_ x: Int, _ y: Int, _ color: UInt32) { canvas.dot(x, y, color, on: 1) }

    private func sprite(_ rows: [String], _ x: Int, _ y: Int) {
        for (r, row) in rows.enumerated() {
            for (i, ch) in row.enumerated() {
                if let color = Self.ink[ch] { dot(x + i, y + r, color) }
            }
        }
    }

    private func draw(_ t: Double) {
        canvas.clear()
        let blobs: [(Double, Double, Double)] = [(9, 13, 6), (16, 9, 7), (24, 10, 7), (27, 15, 5.5), (12, 16, 5.5), (20, 16, 6.5)]
        canvas.fill(id: 1, x0: 0, y0: 0, x1: Double(Self.w), y1: Double(Self.h),
                    sdf: { x, y in blobs.map { (($0.0 - x) * ($0.0 - x) + ($0.1 - y) * ($0.1 - y)).squareRoot() - $0.2 }.min() ?? 1 },
                    color: { _, y in y > 19 ? Self.shade : Self.white })
        canvas.finish(outline: Self.edge, seam: Self.edge)

        if hasIdea { bulb(t); return }
        let s = t.truncatingRemainder(dividingBy: 8)
        switch Int(t / 8) % 4 {
        case 0: fish(s)
        case 1: fence(s)
        case 2: code(s)
        default: rocket(s)
        }
    }

    /// A fish swims by.
    private func fish(_ s: Double) {
        for x in 6...28 { dot(x, sin(Double(x) * 0.8 + s * 2.5) > 0 ? 17 : 18, Self.ink["b"]!) }
        let x = 4 + Int(s / 8 * 26), y = 10 + Int((sin(s * 2) * 1.5).rounded())
        sprite(Int(s * 5) % 2 == 0 ? ["O..oo.", "OOoooo", "O..oo."] : [".O.oo.", "OOoooo", ".O.oo."], x, y)
        dot(x + 4, y + 1, Self.ink["k"]!)
        for i in 0..<2 {
            let rise = (s * 0.7 + Double(i) * 0.5).truncatingRemainder(dividingBy: 1)
            dot(x + 7 + i, y - Int(rise * 5), Self.ink["b"]!)
        }
    }

    /// Little crabs hop over a fence, one after another: counting them.
    private func fence(_ s: Double) {
        for x in 6...28 { dot(x, 18, Self.ink["g"]!) }
        sprite(["n.n", "nnn", "n.n", "nnn", "n.n"], 16, 13)
        let u = (s / 2).truncatingRemainder(dividingBy: 1)
        sprite(["o.o", "ooo", "O.O"], 7 + Int(u * 19), 15 - Int((sin(u * Double.pi) * 7).rounded()))
    }

    /// Lines of code write themselves, then pass.
    private func code(_ s: Double) {
        let lengths = [9, 13, 7, 11]
        for (i, length) in lengths.enumerated() {
            let typed = Int(clamp(s * 7 - Double(i) * 7, 0, Double(length)))
            for x in 0..<typed where x != 3 && x != 8 { dot(8 + x + (i == 1 || i == 2 ? 2 : 0), 8 + i * 3, Self.ink[i % 2 == 0 ? "o" : "K"]!) }
        }
        if s > 5.2 { sprite(["....g", "...gg", "g.gg.", "ggg..", ".g..."], 23, 12) }
    }

    /// A rocket climbs past the stars.
    private func rocket(_ s: Double) {
        for (i, star) in [(8, 9), (14, 6), (26, 8), (22, 14), (10, 16), (28, 16)].enumerated() where Int(s * 3 + Double(i)) % 3 != 0 {
            dot(star.0, star.1, Self.ink["Y"]!)
        }
        let u = s / 8
        let x = 6 + Int(u * 20), y = 16 - Int(u * 11)
        sprite([".r.", "rwr", "sss", "s.s"], x, y)
        sprite(Int(s * 8) % 2 == 0 ? [".y.", ".Y."] : ["y.y", ".y."], x, y + 4)
    }

    /// He has thought of something.
    private func bulb(_ t: Double) {
        sprite([".yyy.", "yywyy", "yyyyy", "yyyyy", ".yyy.", ".KKK.", ".sss."], 15, 8)
        if Int(t * 3) % 2 == 0 {
            for ray in [(17, 5), (11, 8), (23, 8), (10, 12), (24, 12)] { dot(ray.0, ray.1, Self.ink["Y"]!) }
        } else {
            for ray in [(17, 6), (12, 7), (22, 7), (11, 11), (23, 11)] { dot(ray.0, ray.1, Self.ink["y"]!) }
        }
    }
}
