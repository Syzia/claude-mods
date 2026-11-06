// Model.swift: what the light decides to show. Pure functions and file readers, no windows.
// Everything here is tested through the program's --decide mode (see test_screen_light.py).
//
// The state file the mod writes for every Claude session (all times are milliseconds since 1970):
//   { "v": 1, "session": "...", "mode": "screen" | "app" | "idle", "busy": true, "app": "Gemini",
//     "what": "Opens the + menu", "since": 1, "last": 2, "beat": 3, "ended": 4, "reason": "released" }
//
// The pause file (one for the whole Mac, written by the light's button and by the /screen-light command):
//   { "v": 1, "paused": true, "at": 1793938000000, "by": "light" | "command" }
//   missing = not paused; "paused": false = not paused; "paused": true = paused;
//   unreadable, not JSON, not an object or no true/false "paused" = treated as PAUSED (when in doubt, stop).

import Foundation

// MARK: - Timing

/// A session that has not written for this long is treated as gone (Claude closed or crashed).
let beatTimeout = 20_000.0
/// How long the green "gave control back" note stays up.
let toastLength = 4_500.0
/// How long the green "screen control is back on" note stays up after a resume.
let resumedLength = 3_000.0
/// After a call finishes the light still counts as "working" for this long.
let busyWindow = 8_000.0
/// With nothing to show for this long the program quits; the mod starts it again when it is needed.
let quitAfterIdle = 20.0 * 60.0
/// A pause file caught half-written keeps its last good value for this long, then counts as paused.
let pauseHold = 2_000.0

// MARK: - The facts

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
    case hidden, screen, app, done, paused, resumed
}

enum ButtonKind: String {
    case none, pause, resume
}

struct Decision {
    var look = Look.hidden
    var title = ""
    var detail = ""
    var since = 0.0
    var working = false
    var button = ButtonKind.none
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

/// A real JSON true or false (not 1, not "yes").
func boolean(_ value: Any?) -> Bool? {
    guard let n = value as? NSNumber, CFGetTypeID(n) == CFBooleanGetTypeID() else { return nil }
    return n.boolValue
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

func nowMs() -> Double { Date().timeIntervalSince1970 * 1000 }

// MARK: - The pause file

enum PauseState: Equatable {
    /// No pause file: not paused.
    case none
    /// "paused": false, written at this time: not paused.
    case resumed(at: Double)
    /// "paused": true, written at this time: paused.
    case paused(at: Double)
    /// The file is there but cannot be trusted: paused. `since` is the file's own modification time (or 0).
    case unknown(since: Double)

    var isPaused: Bool {
        switch self {
        case .paused, .unknown: return true
        case .none, .resumed: return false
        }
    }

    var name: String {
        switch self {
        case .none: return "none"
        case .resumed: return "resumed"
        case .paused: return "paused"
        case .unknown: return "unknown"
        }
    }
}

private let pausedKey = try! NSRegularExpression(pattern: "\"paused\"\\s*:")

/// nil means "this is not a valid pause file". The mod reads the same file with JavaScript's JSON.parse, so this is as
/// strict as that: a file it would read differently or refuse is not trusted here either (when in doubt, stop):
///   * a byte order mark, a NUL byte (UTF-16 text has them) or bytes that are not UTF-8;
///   * two "paused" keys (JSON.parse keeps the last one, Foundation the first, so nobody can say which is meant).
func parsePause(_ data: Data) -> PauseState? {
    if data.starts(with: [0xEF, 0xBB, 0xBF]) || data.contains(0) { return nil }
    guard let text = String(data: data, encoding: .utf8),
          pausedKey.numberOfMatches(in: text, range: NSRange(location: 0, length: (text as NSString).length)) <= 1,
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let paused = boolean(object["paused"]) else { return nil }
    let at = number(object["at"]) ?? 0
    return paused ? .paused(at: at) : .resumed(at: at)
}

/// Reads the pause file. A bad file keeps the last good answer for `pauseHold` (the mod's writes are not
/// atomic, so a read can catch one half-written); after that, or on a cold start, a bad file means paused.
final class PauseReader {
    let path: String?
    private var lastGood: PauseState?
    private var badSince: Double?

    init(path: String?) { self.path = path }

    func read(now: Double = nowMs()) -> PauseState {
        guard let path = path else { return .none }
        let fm = FileManager.default
        var isFolder: ObjCBool = false
        guard fm.fileExists(atPath: path, isDirectory: &isFolder) else {
            remember(.none)
            return .none
        }
        if !isFolder.boolValue, let data = fm.contents(atPath: path), let state = parsePause(data) {
            remember(state)
            return state
        }
        let start = badSince ?? now
        badSince = start
        if let good = lastGood, now - start <= pauseHold { return good }
        let modified = (try? fm.attributesOfItem(atPath: path))?[.modificationDate] as? Date
        return .unknown(since: (modified?.timeIntervalSince1970 ?? 0) * 1000)
    }

    private func remember(_ state: PauseState) {
        lastGood = state
        badSince = nil
    }
}

enum PauseFile {
    static func text(paused: Bool, at: Double, by: String) -> String {
        "{\"v\":1,\"paused\":\(paused ? "true" : "false"),\"at\":\(Int64(at)),\"by\":\"\(by)\"}"
    }

    /// Writes the pause file atomically: a temporary file in the same folder, then a rename over the real one.
    static func write(paused: Bool, by: String, to path: String, at: Double = nowMs()) -> Bool {
        let fm = FileManager.default
        var folder = (path as NSString).deletingLastPathComponent
        if folder.isEmpty { folder = "." }
        let temporary = (folder as NSString).appendingPathComponent(".pause-\(getpid())-\(Int64(at)).tmp")
        do {
            try fm.createDirectory(atPath: folder, withIntermediateDirectories: true)
            try Data(text(paused: paused, at: at, by: by).utf8).write(to: URL(fileURLWithPath: temporary))
            if rename(temporary, path) != 0 {
                try? fm.removeItem(atPath: temporary)
                return false
            }
            return true
        } catch {
            try? fm.removeItem(atPath: temporary)
            return false
        }
    }
}

// MARK: - What the light shows

private func pausedDecision(since: Double) -> Decision {
    Decision(look: .paused, title: "Screen control is paused",
             detail: "Claude cannot use your screen until you resume", since: since, working: false, button: .resume)
}

func decide(_ sessions: [Session], pause: PauseState = .none, now: Double) -> Decision {
    // 1. Paused (or not sure): always shown, whether or not anyone holds the screen.
    switch pause {
    case .paused(let at): return pausedDecision(since: at)
    case .unknown(let since): return pausedDecision(since: since)
    case .none, .resumed: break
    }

    let live = sessions.filter { now - $0.beat <= beatTimeout }
    let active = live.filter { $0.mode == "screen" || $0.mode == "app" }
    // 2. Full-screen control outranks working in the background; then the most recent call wins.
    let best = active.max { a, b in
        let ra = a.mode == "screen" ? 1 : 0
        let rb = b.mode == "screen" ? 1 : 0
        return ra != rb ? ra < rb : a.last < b.last
    }
    if let s = best {
        let working = s.busy || now - s.last <= busyWindow
        if s.mode == "screen" {
            return Decision(look: .screen, title: "Claude has your screen",
                            detail: s.what ?? "Hands off the mouse and keyboard", since: s.since, working: working,
                            button: .pause)
        }
        let title = s.app.map { "Claude is in \($0)" } ?? "Claude is working in the background"
        return Decision(look: .app, title: title, detail: s.what ?? "You can keep using your Mac",
                        since: s.since, working: working, button: .pause)
    }

    // 3 and 4. The two notes, each for a few seconds; when both are up the more recent one wins.
    var backAt: Double?
    if case .resumed(let at) = pause, at > 0, at <= now + 60_000, now - at <= resumedLength { backAt = at }
    let finished = live.filter { s in
        guard let ended = s.ended, ended > 0 else { return false }
        return now - ended <= toastLength
    }
    let last = finished.max(by: { ($0.ended ?? 0) < ($1.ended ?? 0) })
    if let back = backAt, back >= (last?.ended ?? 0) {
        return Decision(look: .resumed, title: "Screen control is back on", detail: "Tell Claude to carry on",
                        since: 0, working: false)
    }
    if let s = last {
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

// MARK: - Taking over from an older light

/// Dotted version numbers compared as numbers ("0.10.0" is newer than "0.9.0"): -1, 0 or 1; nil if either is not one.
func compareVersions(_ a: String, _ b: String) -> Int? {
    func numbers(_ text: String) -> [Int]? {
        let pieces = text.split(separator: ".", omittingEmptySubsequences: false).map { Int($0) }
        if pieces.isEmpty || pieces.contains(where: { $0 == nil }) { return nil }
        return pieces.compactMap { $0 }
    }
    guard let x = numbers(a), let y = numbers(b) else { return nil }
    for i in 0 ..< max(x.count, y.count) {
        let l = i < x.count ? x[i] : 0, r = i < y.count ? y[i] : 0
        if l != r { return l < r ? -1 : 1 }
    }
    return 0
}

/// Is a light that is already running an OLDER build than this program, so this one should take its place? An update
/// can be installed while the old light is still up, and the old light would go on showing the old look without the
/// pause button. Judged by version number first; when the numbers are equal or unreadable, by whether it was started
/// before this program was built (times in ms since 1970). Never true for a newer or an unknown light.
func isOlderBuild(otherVersion: String?, otherLaunched: Double?, myVersion: String?, myBuilt: Double?) -> Bool {
    if let a = otherVersion, let b = myVersion, let order = compareVersions(a, b), order != 0 { return order < 0 }
    guard let launched = otherLaunched, let built = myBuilt else { return false }
    return launched < built
}

// MARK: - Command line helpers

/// The word after a flag (`offset` 1), or further along (`offset` 2 is the word after that).
func value(after flag: String, offset: Int = 1) -> String? {
    let args = CommandLine.arguments
    guard let i = args.firstIndex(of: flag), i + offset < args.count else { return nil }
    return args[i + offset]
}

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
