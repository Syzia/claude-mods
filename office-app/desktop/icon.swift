// Draws the Agent Office icon: a rounded sky tile, a lawn, the office building, a little ⚡.
// Usage: make-icon <out.png>   (1024 × 1024)

import AppKit

let size: CGFloat = 1024
let out = CommandLine.arguments.dropFirst().first ?? "icon-1024.png"
let image = NSImage(size: NSSize(width: size, height: size))
image.lockFocus()

let tile = NSBezierPath(roundedRect: NSRect(x: 100, y: 100, width: 824, height: 824), xRadius: 185, yRadius: 185)
NSGraphicsContext.current?.saveGraphicsState()
let shadow = NSShadow()
shadow.shadowBlurRadius = 28
shadow.shadowOffset = NSSize(width: 0, height: -12)
shadow.shadowColor = NSColor.black.withAlphaComponent(0.28)
shadow.set()
NSGradient(colors: [NSColor(red: 0.55, green: 0.80, blue: 0.97, alpha: 1), NSColor(red: 0.85, green: 0.94, blue: 1.0, alpha: 1)])!
    .draw(in: tile, angle: 90)
NSGraphicsContext.current?.restoreGraphicsState()

tile.addClip()
NSColor(red: 0.55, green: 0.78, blue: 0.47, alpha: 1).setFill()
NSRect(x: 100, y: 100, width: 824, height: 250).fill()
NSColor(red: 0.47, green: 0.70, blue: 0.40, alpha: 1).setFill()
NSRect(x: 100, y: 330, width: 824, height: 20).fill()

func draw(_ text: String, size points: CGFloat, at point: NSPoint) {
    let font = NSFont(name: "Apple Color Emoji", size: points) ?? NSFont.systemFont(ofSize: points)
    let string = NSAttributedString(string: text, attributes: [.font: font])
    let bounds = string.size()
    string.draw(at: NSPoint(x: point.x - bounds.width / 2, y: point.y - bounds.height / 2))
}

draw("🏢", size: 520, at: NSPoint(x: 512, y: 520))
draw("⚡", size: 190, at: NSPoint(x: 760, y: 760))
image.unlockFocus()

guard let tiff = image.tiffRepresentation, let bitmap = NSBitmapImageRep(data: tiff), let png = bitmap.representation(using: .png, properties: [:]) else {
    fatalError("could not draw the icon")
}
try png.write(to: URL(fileURLWithPath: out))
