// Screen Light: a small light on the right edge of every screen that shows when Claude has control of the Mac,
// with a button that pauses Claude's screen control. The screen-light mod writes one little state file per
// Claude session and one pause file; this program reads them and draws the light. The light itself is
// click-through, so a click (yours, or one Claude makes) always goes to the app underneath; only the small
// round button takes clicks.
//
// The program runs in one of these ways:
//   ScreenLight [--dir ROOT]             show the light for real (reads ROOT/state and ROOT/pause.json;
//                                        ROOT is ~/.claude/screen-light; with --dir there is no single-instance check)
//   ScreenLight --demo                   show a short tour of the looks, then quit
//   ScreenLight --decide STATE_DIR [--pause-file FILE] [--now MS]   print what the light would show, then quit
//   ScreenLight --snapshot OUT.png [all|sheet|hover|text|screen|app|done|paused|resumed]   draw pictures, then quit
//   ScreenLight --inspect LOOK | --press-test --dir DIR | --hold-test DIR | --crab-ascii NAME | --pose LOOK PHASE
//   ScreenLight --older-test V T V T | --clock-test MS ...   test helpers (see Pictures.swift)
// Files: Model.swift (decisions, pause file), Crab.swift (Clawd), Views.swift (windows), Pictures.swift (pictures, tests).

import AppKit
import Foundation

let args = CommandLine.arguments

if let dir = value(after: "--decide") {
    let now = value(after: "--now").flatMap(Double.init) ?? nowMs()
    let pause = PauseReader(path: value(after: "--pause-file")).read(now: now)
    let d = decide(StateReader(dir: dir).read(), pause: pause, now: now)
    let out: [String: Any] = ["look": d.look.rawValue, "title": d.title, "detail": d.detail,
                              "since": d.since, "working": d.working, "button": d.button.rawValue]
    let data = (try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])) ?? Data()
    print(String(data: data, encoding: .utf8) ?? "{}")
    exit(0)
}

if let path = value(after: "--snapshot") {
    let which = value(after: "--snapshot", offset: 2) ?? "all"
    do { try snapshot(which, to: path) } catch { fail("snapshot failed: \(error)") }
    print("wrote \(path)")
    exit(0)
}

if let name = value(after: "--inspect") { runInspect(name) }
if let dir = value(after: "--hold-test") { runHoldTest(dir: dir) }
if let name = value(after: "--crab-ascii") { runAscii(name) }
if let name = value(after: "--pose") { runPose(look: name, phase: value(after: "--pose", offset: 2) ?? "0") }
if args.contains("--older-test") { runOlderTest() }
if args.contains("--clock-test") { runClockTest() }
if args.contains("--press-test") {
    guard let dir = value(after: "--dir") else { fail("--press-test needs --dir DIR") }
    runPressTest(dir: dir)
}

let application = NSApplication.shared
application.setActivationPolicy(.accessory)

/// Asks every light in `others` to quit and waits a moment for it; a light that does not listen is made to stop.
/// True when they are all gone.
func quitLights(_ others: [NSRunningApplication]) -> Bool {
    func gone(_ other: NSRunningApplication) -> Bool {
        other.isTerminated || (kill(other.processIdentifier, 0) != 0 && errno == ESRCH)
    }
    func wait(upTo seconds: Double) {
        let end = Date().addingTimeInterval(seconds)
        while Date() < end && !others.allSatisfy(gone) { RunLoop.current.run(until: Date().addingTimeInterval(0.1)) }
    }
    for other in others { other.terminate() }
    wait(upTo: 3)
    for other in others where !gone(other) { other.forceTerminate() }
    wait(upTo: 1)
    return others.allSatisfy(gone)
}

let controller: Controller
if args.contains("--demo") {
    let started = nowMs()
    controller = Controller {
        let seconds = (nowMs() - started) / 1000
        if seconds > 17.5 { DispatchQueue.main.async { NSApp.terminate(nil) } }
        return demoDecision(elapsed: seconds, started: started)
    }
} else {
    let given = value(after: "--dir")
    if given == nil, let id = Bundle.main.bundleIdentifier {
        let me = ProcessInfo.processInfo.processIdentifier
        let others = NSRunningApplication.runningApplications(withBundleIdentifier: id).filter { $0.processIdentifier != me }
        if !others.isEmpty {
            // One light is enough. But a light left over from an OLDER build (an update was installed while it was up)
            // goes on showing the old look with no pause button, so it is asked to quit and this one takes its place.
            func milliseconds(_ date: Date?) -> Double? { date.map { $0.timeIntervalSince1970 * 1000 } }
            let mine = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
            let built = Bundle.main.executableURL.flatMap {
                (try? FileManager.default.attributesOfItem(atPath: $0.path))?[.modificationDate] as? Date
            }
            let allOlder = others.allSatisfy { other in
                let version = other.bundleURL.flatMap { Bundle(url: $0)?.infoDictionary?["CFBundleShortVersionString"] as? String }
                return isOlderBuild(otherVersion: version, otherLaunched: milliseconds(other.launchDate),
                                    myVersion: mine, myBuilt: milliseconds(built))
            }
            if !(allOlder && quitLights(others)) { exit(0) }  // already running: one light is enough
        }
    }
    let root = given ?? NSString(string: "~/.claude/screen-light").expandingTildeInPath
    let stateDir = value(after: "--state-dir") ?? (root as NSString).appendingPathComponent("state")
    let pausePath = value(after: "--pause-file") ?? (root as NSString).appendingPathComponent("pause.json")
    let reader = StateReader(dir: stateDir)
    reader.tidy()
    let pauseReader = PauseReader(path: pausePath)
    controller = Controller {
        let now = nowMs()
        return decide(reader.read(), pause: pauseReader.read(now: now), now: now)
    }
    controller.writer = { PauseFile.write(paused: $0, by: "light", to: pausePath) }
}
// Without this macOS would slow the timers of a program that shows nothing for a while (App Nap), and the light
// could come up seconds late. This keeps them on time; the Mac can still go to sleep as usual.
let stayAwake = ProcessInfo.processInfo.beginActivity(options: [.userInitiatedAllowingIdleSystemSleep],
                                                      reason: "Watching for Claude taking control of the Mac")
controller.start()
application.run()
withExtendedLifetime(stayAwake) {}
