#!/bin/sh
# Builds Crab Buddy.app into ~/.claude/crab-buddy from the Swift files beside this script.
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
OUT="$HOME/.claude/crab-buddy/Crab Buddy.app"
mkdir -p "$OUT/Contents/MacOS" "$HOME/.claude/crab-buddy/sessions"
swiftc -O -target arm64-apple-macos13.0 -o "$OUT/Contents/MacOS/CrabBuddy" "$HERE"/*.swift -framework AppKit -framework Vision
cat > "$OUT/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Crab Buddy</string>
  <key>CFBundleIdentifier</key><string>local.crabbuddy.overlay</string>
  <key>CFBundleExecutable</key><string>CrabBuddy</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST
codesign --force -s - "$OUT" >/dev/null 2>&1 || true
cp "$HERE/VERSION" "$HOME/.claude/crab-buddy/version"
# stop the old crab so the next launch is the one just built
pkill -x CrabBuddy 2>/dev/null || true
# The first time a new build reads text out of a picture, macOS takes most of a minute
# to get ready. Do that now, in the background, on any picture that is always there.
ICON="/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/GenericDocumentIcon.icns"
[ -f "$ICON" ] && ("$OUT/Contents/MacOS/CrabBuddy" --ocr "$ICON" >/dev/null 2>&1 &)
echo "$OUT"
