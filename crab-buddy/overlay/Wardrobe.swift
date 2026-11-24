// What the crab wears: hats, things round his neck, glasses. Each is a little pixel
// drawing laid over the finished crab, so it carries its own dark outline.
import AppKit

enum Wardrobe {
    struct Hat {
        let key: String
        let name: String
        let dx: Int            // column of the drawing's left edge, from the middle of his face
        let rows: [String]     // bottom row sits on the outline of his shell
    }

    static let palette: [Character: UInt32] = [
        "o": rgb(0x2B1310),
        "k": rgb(0x1E1B1F), "K": rgb(0x45414C), "G": rgb(0x6C6777),
        "w": rgb(0xFFFFFF), "W": rgb(0xD5D9E2),
        "r": rgb(0xE0453C), "R": rgb(0xA82A27),
        "y": rgb(0xF6C445), "Y": rgb(0xC98F22),
        "b": rgb(0x4A7BE0), "B": rgb(0x2F56A8),
        "p": rgb(0x8B5CF0), "P": rgb(0x6238B8),
        "n": rgb(0xA36B33), "N": rgb(0x6E4520),
        "c": rgb(0x8DE6F5), "e": rgb(0xF58CA8), "g": rgb(0x48B06F),
    ]

    static let hats: [Hat] = [
        Hat(key: "tophat", name: "Top hat", dx: -6, rows: [
            "..oooooooo..",
            "..oGKKKKKo..",
            "..oGKKKKKo..",
            "..oGKKKKKo..",
            "..orrrrrro..",
            "oooKKKKKKooo",
            "oGKKKKKKKKKo",
            "oooooooooooo",
        ]),
        Hat(key: "cap", name: "Cap", dx: -6, rows: [
            "...oooooo.....",
            "..obbbbbbo....",
            ".obcbbbbbbo...",
            ".obbbbbbbboooo",
            ".oBBBBBBBBbbbo",
            ".ooooooooooooo",
        ]),
        Hat(key: "beanie", name: "Beanie", dx: -6, rows: [
            "....owwo....",
            "....owwo....",
            "...orrrro...",
            "..orrrrrro..",
            ".orrRrrRrro.",
            ".oWwWwWwWwo.",
            ".oooooooooo.",
        ]),
        Hat(key: "crown", name: "Crown", dx: -5, rows: [
            ".o..oo..o.",
            "oyooyyooyo",
            "oyyyyyyyyo",
            "oyryccyryo",
            "oYYYYYYYYo",
            "oooooooooo",
        ]),
        Hat(key: "party", name: "Party hat", dx: -6, rows: [
            ".....ee.....",
            ".....ee.....",
            "....oppo....",
            "....oyyo....",
            "...oppppo...",
            "...oyyyyo...",
            "..oppppppo..",
            "..oyyyyyyo..",
            ".oooooooooo.",
        ]),
        Hat(key: "santa", name: "Santa hat", dx: -5, rows: [
            "...oooo.....",
            "..orrrroo...",
            ".orrrrrrroo.",
            ".orrRrrrrowo",
            "owwwwwwwwooo",
            "oWwwwwwwWo..",
            "oooooooooo..",
        ]),
        Hat(key: "cowboy", name: "Cowboy hat", dx: -7, rows: [
            "....oooooo....",
            "...onnnnnno...",
            "...onnnnnno...",
            "o..oNNNNNNo..o",
            "onnnnnnnnnnnno",
            ".oooooooooooo.",
        ]),
        Hat(key: "wizard", name: "Wizard hat", dx: -6, rows: [
            "......oo....",
            ".....obbo...",
            "....obbbo...",
            "....obybo...",
            "...obbbbbo..",
            "...obbbybo..",
            "..obybbbbbo.",
            "oooBBBBBBooo",
            "obbbbbbbbbbo",
            "oooooooooooo",
        ]),
        Hat(key: "chef", name: "Chef hat", dx: -6, rows: [
            "..oooooooo..",
            ".owwwwwwwwo.",
            "owwwwwwwwwwo",
            "owwWwwwwWwwo",
            ".owwWwwWwwo.",
            "..owwwwwwo..",
            "..oWWWWWWo..",
            "..oooooooo..",
        ]),
    ]

    static let necks: [(key: String, name: String)] = [
        ("chain", "Gold chain"), ("pendant", "Chain with a medallion"), ("bowtie", "Bow tie"), ("scarf", "Scarf"),
    ]
    static let glasses: [(key: String, name: String)] = [("shades", "Sunglasses")]
}

extension Settings {
    static var hat: String {
        get { defaults.string(forKey: "hat") ?? "" }
        set { defaults.set(newValue, forKey: "hat") }
    }
    static var neck: String {
        get { defaults.string(forKey: "neck") ?? "" }
        set { defaults.set(newValue, forKey: "neck") }
    }
    static var glasses: String {
        get { defaults.string(forKey: "glasses") ?? "" }
        set { defaults.set(newValue, forKey: "glasses") }
    }
}

extension Canvas {
    /// Paints one pixel whatever is under it.
    func put(_ x: Int, _ y: Int, _ color: UInt32) {
        guard x >= 0, x < w, y >= 0, y < h else { return }
        px[y * w + x] = color
    }
}

/// Draws what lies over the finished crab: the marks of a feeling, then what he wears.
func drawExtras(_ c: Canvas, _ p: Pose, fx: Int, top: Int, faceRow: Int) {
    let ink = Paint.eye

    // feelings
    switch p.feeling {
    case "strained":   // set brows
        for (dx, dy) in [(-7, -4), (-6, -4), (-5, -3), (4, -3), (5, -4), (6, -4)] { c.dot(fx + dx, faceRow + dy, ink, on: bodyPart) }
    case "love":       // a deeper blush
        for dx in [-10, -9, -8, 7, 8, 9] { c.dot(fx + dx, faceRow + 2, Paint.blush, on: bodyPart) }
        for dx in [-10, 9] { c.dot(fx + dx, faceRow + 3, Paint.blush, on: bodyPart) }
    case "yawn":       // a wide mouth
        for dy in 3...6 {
            for dx in -2...1 where !((dy == 3 || dy == 6) && (dx == -2 || dx == 1)) {
                c.dot(fx + dx, faceRow + dy, dy >= 5 && (dx == -1 || dx == 0) ? Paint.tongue : ink, on: bodyPart)
            }
        }
    default:
        break
    }

    // round his neck
    let gold = Wardrobe.palette["y"]!, darkGold = Wardrobe.palette["Y"]!
    let chain: [(Int, Int)] = [(-9, 4), (-8, 4), (-7, 5), (-6, 5), (-5, 6), (-4, 6), (-3, 7), (-2, 7), (-1, 7),
                               (0, 7), (1, 7), (2, 7), (3, 6), (4, 6), (5, 5), (6, 5), (7, 4), (8, 4)]
    switch p.neck {
    case "chain", "pendant":
        for (i, link) in chain.enumerated() { c.dot(fx + link.0, faceRow + link.1, i % 2 == 0 ? gold : darkGold, on: bodyPart) }
        if p.neck == "pendant" {
            for (dx, dy, color) in [(-1, 8, gold), (0, 8, darkGold), (-1, 9, darkGold), (0, 9, gold)] { c.put(fx + dx, faceRow + dy, color) }
            for (dx, dy) in [(-2, 8), (1, 8), (-2, 9), (1, 9), (-1, 10), (0, 10)] { c.put(fx + dx, faceRow + dy, Wardrobe.palette["o"]!) }
        }
    case "bowtie":
        let red = Wardrobe.palette["r"]!, darkRed = Wardrobe.palette["R"]!
        for (dy, row) in ["rr..rr", "rrRRrr", "rr..rr"].enumerated() {
            for (i, ch) in row.enumerated() where ch != "." { c.dot(fx - 3 + i, faceRow + 6 + dy, ch == "r" ? red : darkRed, on: bodyPart) }
        }
    case "scarf":
        let red = Wardrobe.palette["r"]!, white = Wardrobe.palette["w"]!, edge = Wardrobe.palette["o"]!
        for dx in -13...12 {
            for dy in 6...7 { c.dot(fx + dx, faceRow + dy, ((dx + 40) / 2) % 2 == 0 ? red : white, on: bodyPart) }
        }
        for dy in 8...11 {   // the end that hangs down
            c.put(fx + 4, faceRow + dy, edge); c.put(fx + 8, faceRow + dy, edge)
            for dx in 5...7 { c.put(fx + dx, faceRow + dy, (dy / 2) % 2 == 0 ? red : white) }
        }
        for dx in 4...8 { c.put(fx + dx, faceRow + 12, edge) }
    default:
        break
    }

    // glasses, over the eyes
    if p.glasses == "shades" {
        let lens = Wardrobe.palette["k"]!
        for dy in -2...1 {
            for dx in -9...8 where dy == -2 || (dx >= -9 && dx <= -4) || (dx >= 3 && dx <= 8) {
                c.dot(fx + dx, faceRow + dy, lens, on: bodyPart)
            }
        }
        for dx in [-13, -12, -11, -10, 9, 10, 11, 12] { c.dot(fx + dx, faceRow - 2, lens, on: bodyPart) }
        c.dot(fx - 8, faceRow - 1, Wardrobe.palette["G"]!, on: bodyPart)
        c.dot(fx + 4, faceRow - 1, Wardrobe.palette["G"]!, on: bodyPart)
    }

    // a hat, sitting on the outline of his shell
    if let hat = Wardrobe.hats.first(where: { $0.key == p.hat }) {
        let y0 = top - hat.rows.count
        for (r, row) in hat.rows.enumerated() {
            for (i, ch) in row.enumerated() {
                if let color = Wardrobe.palette[ch] { c.put(fx + hat.dx + i, y0 + r, color) }
            }
        }
    }
}
