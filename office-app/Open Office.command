#!/bin/bash
# Double-click to open the 3D Agent Office. Starts the local server if it is
# not running yet, then opens the office in your browser.
cd "$(dirname "$0")" || exit 1
PORT="${OFFICE_PORT:-4747}"
URL="http://127.0.0.1:$PORT"

if curl -s --max-time 1 "$URL/api/ping" | grep -q agent-office-3d; then
  open "$URL"
  exit 0
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is needed to run the office: https://nodejs.org"
  read -r -p "Press Enter to close."
  exit 1
fi

if [ ! -d node_modules/three ]; then
  echo "First run: installing the 3D library…"
  npm install --no-audit --no-fund || exit 1
fi

node server.mjs &
SERVER=$!
for _ in 1 2 3 4 5 6 7 8 9 10; do
  curl -s --max-time 1 "$URL/api/ping" >/dev/null && break
  sleep 0.3
done
open "$URL"
wait "$SERVER"
