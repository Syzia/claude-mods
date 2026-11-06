#!/bin/bash
# Builds "Screen Light.app" beside this script from every .swift file in this folder.
# Needs the Mac's Command Line Tools (they give you swiftc). Safe to run again: it replaces the old app.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
# main.swift holds the start-up code; the other files hold the rest. An unmatched glob gives an empty list, not an error.
shopt -s nullglob
sources=("$here"/*.swift)
if [ "${#sources[@]}" -eq 0 ]; then
  echo "no Swift files found in $here" >&2
  exit 1
fi
mkdir -p "$tmp/Screen Light.app/Contents/MacOS"
cp "$here/Info.plist" "$tmp/Screen Light.app/Contents/Info.plist"
# The target is set on purpose: the Mac may have newer build tools than its own system, and a program built for a
# newer system than the one running is refused by "open" (error -10825).
swiftc -swift-version 5 -O -target "$(uname -m)-apple-macos13.0" -o "$tmp/Screen Light.app/Contents/MacOS/ScreenLight" "${sources[@]}" -framework AppKit
codesign --force --sign - "$tmp/Screen Light.app" >/dev/null 2>&1 || true
rm -rf "$here/Screen Light.app"
mv "$tmp/Screen Light.app" "$here/Screen Light.app"
# A light that is already running THIS app keeps running the old build (opening an app that is already up only
# brings the old one forward). It is only a view and the mod starts it again, so stop it. Only a light that runs from
# this very file is stopped, never one from another copy of the app.
mine="$here/Screen Light.app/Contents/MacOS/ScreenLight"
for pid in $(pgrep -x ScreenLight 2>/dev/null || true); do
  if [ "$(ps -o comm= -p "$pid" 2>/dev/null || true)" = "$mine" ]; then kill "$pid" 2>/dev/null || true; fi
done
echo "built $here/Screen Light.app"
