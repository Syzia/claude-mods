#!/usr/bin/env python3
"""A fake 'computer-use' MCP server for end-to-end tests of the screen-light mod.

It speaks just enough MCP over stdio (JSON lines) to be called by `claude -p`. Its tools look like the real ones
(names and answer shapes were taken from real sessions) but do nothing to the Mac. Every call that actually RUNS is
appended to the file named by FAKE_LOG, so a test can prove that a refused call never ran. A call may be slowed with
the environment variable FAKE_SLOW_SECONDS (applied to app_screenshot and computer_batch) so a test can look at the
light while a call is in flight.
"""
import json
import os
import sys
import time

LOG = os.environ.get("FAKE_LOG", "")
SLOW = float(os.environ.get("FAKE_SLOW_SECONDS", "0") or 0)

TOOLS = {
    "request_access": ("Ask for access to apps", {"apps": {"type": "array", "items": {"type": "string"}}, "reason": {"type": "string"}}),
    "request_full_control": ("Ask for full-screen control", {}),
    "release_full_control": ("Give full-screen control back", {}),
    "list_apps": ("List apps", {}),
    "app_click": ("Click in an app", {"app": {"type": "string"}, "element_index": {"type": "integer"}, "action_summary": {"type": "string"}}),
    "app_screenshot": ("Look at an app", {"app": {"type": "string"}, "action_summary": {"type": "string"}}),
    "app_release": ("Let go of an app", {"app": {"type": "string"}}),
    "computer_batch": ("Full-screen actions", {"actions": {"type": "array", "items": {"type": "object"}}}),
}


def schema(props):
    return {"type": "object", "properties": props, "additionalProperties": True}


def answer(name, args):
    if name == "request_access":
        return json.dumps({"granted": [{"bundleId": "com.google.GeminiMacOS", "displayName": "Gemini", "grantedAt": 1, "tier": "full"}], "denied": []})
    if name == "request_full_control":
        return "Full-screen control is already available; it does not need to be approved again."
    if name == "release_full_control":
        return "Released full-screen control. The display overlay is off."
    if name == "list_apps":
        return json.dumps({"apps": [{"bundleId": "com.google.GeminiMacOS", "displayName": "Gemini", "isRunning": True, "pid": 1}]})
    if name == "app_click":
        return "ok (AXPress on AXButton 'Attach')"
    if name == "app_screenshot":
        return "Captured window_id 1. (fake, no image)"
    if name == "app_release":
        return "Released %s." % args.get("app", "the app")
    if name == "computer_batch":
        return "[1/1] screenshot: fake, no image"
    return "ok"


def send(obj):
    sys.stdout.write(json.dumps(obj) + "\n")
    sys.stdout.flush()


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        method = msg.get("method")
        mid = msg.get("id")
        if method == "initialize":
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "protocolVersion": msg.get("params", {}).get("protocolVersion", "2024-11-05"),
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "fake-computer-use", "version": "0.0.1"}}})
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [
                {"name": n, "description": d, "inputSchema": schema(p)} for n, (d, p) in TOOLS.items()]}})
        elif method == "tools/call":
            params = msg.get("params", {})
            name = params.get("name", "")
            args = params.get("arguments") or {}
            if LOG:
                with open(LOG, "a") as handle:
                    handle.write(json.dumps({"tool": name, "args": args, "at": time.time()}) + "\n")
            if SLOW and name in ("app_screenshot", "computer_batch"):
                time.sleep(SLOW)
            send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": answer(name, args)}], "isError": False}})
        elif mid is not None:
            send({"jsonrpc": "2.0", "id": mid, "result": {}})


if __name__ == "__main__":
    main()
