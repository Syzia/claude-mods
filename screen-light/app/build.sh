#!/bin/bash
# Builds "Screen Light.app" beside this script from ScreenLight.swift.
# Needs the Mac's Command Line Tools (they give you swiftc). Safe to run again: it replaces the old app.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$tmp/Screen Light.app/Contents/MacOS"
cp "$here/Info.plist" "$tmp/Screen Light.app/Contents/Info.plist"
# The target is set on purpose: the Mac may have newer build tools than its own system, and a program built for a
# newer system than the one running is refused by "open" (error -10825).
swiftc -swift-version 5 -O -target "$(uname -m)-apple-macos13.0" -o "$tmp/Screen Light.app/Contents/MacOS/ScreenLight" "$here/ScreenLight.swift" -framework AppKit
codesign --force --sign - "$tmp/Screen Light.app" >/dev/null 2>&1 || true
rm -rf "$here/Screen Light.app"
mv "$tmp/Screen Light.app" "$here/Screen Light.app"
echo "built $here/Screen Light.app"
