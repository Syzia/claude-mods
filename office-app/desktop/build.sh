#!/bin/bash
# Builds "Agent Office.app" (a window of its own for the 3D office) into
# ~/Applications, or into the folder given as the first argument.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
OFFICE="$(cd "$HERE/.." && pwd)"
OUT="${1:-$HOME/Applications}"
APP="$OUT/Agent Office.app"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$OUT"

echo "Drawing the icon…"
swiftc -swift-version 5 -O "$HERE/icon.swift" -o "$WORK/make-icon"
"$WORK/make-icon" "$WORK/icon-1024.png"
ICONSET="$WORK/AgentOffice.iconset"
mkdir "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z "$s" "$s" "$WORK/icon-1024.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z "$d" "$d" "$WORK/icon-1024.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$WORK/AgentOffice.icns"

echo "Building the app…"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -swift-version 5 -O -target "$(uname -m)-apple-macos13.0" "$HERE/main.swift" \
  -o "$APP/Contents/MacOS/AgentOffice" -framework AppKit -framework WebKit
cp "$WORK/AgentOffice.icns" "$APP/Contents/Resources/AgentOffice.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Agent Office</string>
  <key>CFBundleDisplayName</key><string>Agent Office</string>
  <key>CFBundleIdentifier</key><string>local.claude-mods.agent-office</string>
  <key>CFBundleExecutable</key><string>AgentOffice</string>
  <key>CFBundleIconFile</key><string>AgentOffice</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.simulation-games</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>AgentOfficeDir</key><string>$OFFICE</string>
</dict>
</plist>
PLIST
codesign --force --deep -s - "$APP" >/dev/null 2>&1
touch "$APP"
echo "Built: $APP"
