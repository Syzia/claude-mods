import CoreGraphics
import Foundation
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as? [[String: Any]] ?? []
for w in list where (w[kCGWindowOwnerName as String] as? String) == "ScreenLight" || (w[kCGWindowOwnerName as String] as? String) == "Screen Light" {
    print("owner:", w[kCGWindowOwnerName as String] ?? "", "layer:", w[kCGWindowLayer as String] ?? "", "alpha:", w[kCGWindowAlpha as String] ?? "", "bounds:", w[kCGWindowBounds as String] ?? "", "sharing:", w[kCGWindowSharingState as String] ?? "")
}
