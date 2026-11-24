import AppKit

// `CrabBuddy --ocr picture` prints the text in a picture and leaves: the mod uses it to
// read a screenshot for a question about the screen.
if let flag = CommandLine.arguments.firstIndex(of: "--ocr"), CommandLine.arguments.count > flag + 1 {
    print(readText(inImageAt: CommandLine.arguments[flag + 1]))
    exit(0)
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)   // no Dock icon

// An Edit menu nobody sees, so cut, copy, paste and undo work in the ask bar.
let mainMenu = NSMenu()
let editItem = mainMenu.addItem(withTitle: "Edit", action: nil, keyEquivalent: "")
let edit = NSMenu(title: "Edit")
edit.addItem(withTitle: "Undo", action: Selector(("undo:")), keyEquivalent: "z")
edit.addItem(withTitle: "Redo", action: Selector(("redo:")), keyEquivalent: "Z")
edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
editItem.submenu = edit
app.mainMenu = mainMenu

let delegate = AppDelegate()
app.delegate = delegate
app.run()
