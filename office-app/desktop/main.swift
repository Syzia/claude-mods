// Agent Office: a window of its own for the 3D office.
//
// Starts the office's local server (node server.mjs) unless one is already
// running, shows the office in a WebKit view, and stops the server on quit if
// it started it. Where the office lives comes from Info.plist (AgentOfficeDir).
// A log goes to ~/Library/Logs/AgentOffice.log.

import AppKit
import WebKit

let port = ProcessInfo.processInfo.environment["OFFICE_PORT"] ?? "4747"
let officeURL = URL(string: "http://127.0.0.1:\(port)/")!
let pingURL = URL(string: "http://127.0.0.1:\(port)/api/ping")!

func log(_ text: String) {
    let line = "\(ISO8601DateFormatter().string(from: Date())) \(text)\n"
    let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Logs/AgentOffice.log")
    if let handle = try? FileHandle(forWritingTo: url) {
        handle.seekToEndOfFile()
        handle.write(line.data(using: .utf8)!)
        try? handle.close()
    } else {
        try? line.write(to: url, atomically: true, encoding: .utf8)
    }
}

/// Whether an office server answers on the port.
func officeIsUp() -> Bool {
    var request = URLRequest(url: pingURL)
    request.timeoutInterval = 0.8
    let done = DispatchSemaphore(value: 0)
    var up = false
    URLSession.shared.dataTask(with: request) { data, _, _ in
        if let data, String(decoding: data, as: UTF8.self).contains("agent-office-3d") { up = true }
        done.signal()
    }.resume()
    _ = done.wait(timeout: .now() + 1.2)
    return up
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var server: Process?
    var status: NSTextField!

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenu()
        buildWindow()
        NSApp.activate(ignoringOtherApps: true)
        DispatchQueue.global().async { self.startOffice() }
    }

    func buildWindow() {
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered,
            defer: false
        )
        window.title = "Agent Office"
        window.titlebarAppearsTransparent = true
        window.minSize = NSSize(width: 760, height: 520)
        window.center()
        window.setFrameAutosaveName("AgentOfficeWindow")
        window.delegate = self
        window.backgroundColor = NSColor(red: 0.75, green: 0.88, blue: 0.96, alpha: 1)

        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "developerExtrasEnabled")
        config.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: window.contentView!.bounds, configuration: config)
        web.autoresizingMask = [.width, .height]
        web.navigationDelegate = self
        web.isHidden = true
        window.contentView!.addSubview(web)

        status = NSTextField(labelWithString: "🏢  Opening the office…")
        status.font = NSFont.systemFont(ofSize: 20, weight: .semibold)
        status.alignment = .center
        status.frame = NSRect(x: 0, y: window.contentView!.bounds.midY - 20, width: window.contentView!.bounds.width, height: 40)
        status.autoresizingMask = [.width, .minYMargin, .maxYMargin]
        window.contentView!.addSubview(status)
        window.makeKeyAndOrderFront(nil)
    }

    func buildMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "About Agent Office", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "Hide Agent Office", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        appMenu.addItem(withTitle: "Quit Agent Office", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let viewItem = NSMenuItem()
        main.addItem(viewItem)
        let viewMenu = NSMenu(title: "View")
        viewMenu.addItem(withTitle: "Reload", action: #selector(reload), keyEquivalent: "r")
        viewMenu.addItem(withTitle: "Enter Full Screen", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f").keyEquivalentModifierMask = [.command, .control]
        viewItem.submenu = viewMenu

        let windowItem = NSMenuItem()
        main.addItem(windowItem)
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.miniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Close", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        windowItem.submenu = windowMenu
        NSApp.mainMenu = main
        NSApp.windowsMenu = windowMenu
    }

    @objc func reload() {
        web.reload()
    }

    /// Uses a running office, or starts one with the user's own shell (so `node` is found as in Terminal).
    func startOffice() {
        if officeIsUp() {
            log("office already running on \(port)")
        } else {
            let dir = Bundle.main.object(forInfoDictionaryKey: "AgentOfficeDir") as? String
                ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("claude-mods/office-app").path
            guard FileManager.default.fileExists(atPath: dir + "/server.mjs") else {
                fail("The office files are missing from \(dir).")
                return
            }
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/bin/zsh")
            // The shell appends the server's output to the log (>> opens it for appending, so lines never collide).
            let script = "{ [ -d node_modules/three ] || npm install --no-audit --no-fund; } >> \"$HOME/Library/Logs/AgentOffice.log\" 2>&1; exec node server.mjs >> \"$HOME/Library/Logs/AgentOffice.log\" 2>&1"
            process.arguments = ["-lc", script]
            process.currentDirectoryURL = URL(fileURLWithPath: dir)
            var env = ProcessInfo.processInfo.environment
            env["OFFICE_PORT"] = port
            process.environment = env
            do {
                try process.run()
                server = process
                log("started the office server (pid \(process.processIdentifier)) in \(dir)")
            } catch {
                fail("Could not start the office server: \(error.localizedDescription). Is Node.js installed?")
                return
            }
            var waited = 0.0
            while !officeIsUp() {
                Thread.sleep(forTimeInterval: 0.3)
                waited += 0.3
                if waited > 60 || !(server?.isRunning ?? false) {
                    fail("The office server did not start. See ~/Library/Logs/AgentOffice.log.")
                    return
                }
            }
        }
        DispatchQueue.main.async {
            self.web.load(URLRequest(url: officeURL))
        }
    }

    func fail(_ message: String) {
        log("error: \(message)")
        DispatchQueue.main.async {
            self.status.stringValue = "😕  \(message)"
            self.status.font = NSFont.systemFont(ofSize: 15, weight: .medium)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        status.isHidden = true
        web.isHidden = false
        window.makeFirstResponder(web)
        log("office loaded")
        // A health check for the log: how many people are on the floor after a few seconds.
        DispatchQueue.main.asyncAfter(deadline: .now() + 4) {
            webView.evaluateJavaScript("JSON.stringify({ people: window.office?.world?.people?.size ?? null, rooms: window.office?.office?.rooms?.length ?? null })") { result, error in
                log("office check: \(result ?? "none") \(error.map { "error: \($0.localizedDescription)" } ?? "")")
            }
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail("The office page failed to load: \(error.localizedDescription)")
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail("The office page failed to load: \(error.localizedDescription)")
    }

    /// Links inside the office (none yet) open in the default browser, not in this window.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = action.request.url, url.host != "127.0.0.1", action.navigationType == .linkActivated {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        if let server, server.isRunning {
            log("stopping the office server")
            server.terminate()
        }
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
