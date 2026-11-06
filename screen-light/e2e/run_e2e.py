#!/usr/bin/env python3
"""End-to-end check of the screen-light mod, the light program and the pause, with no model and no real computer use.

Run it from anywhere: python3 e2e/run_e2e.py   (needs the `claude` command, python3 and the built light program;
the light is on your screen for a few seconds, and any light that is up is closed first, the mod starts it again).

Each step is a fresh headless `claude -p "/<command>"` run (slash commands need no model). A helper plugin (sl-e2e) makes a
tool call through the engine's real tool pipeline to a FAKE computer-use MCP server, so the screen-light hook, the state
files, the pause file and the light program are all exercised for real. Everything lives in a throwaway folder
(SCREEN_LIGHT_DIR), never your own ~/.claude/screen-light.

The engine reserves the server name "computer-use" (a headless run cannot have a fake one of that name), so the fake server is
called "fakecu" and the mod under test is a COPY of this mod whose two tool-name patterns also accept "fakecu". That is the
only difference from the real mod; the copy is made fresh at the start and deleted at the end.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REAL = os.path.dirname(HERE)
WORK = tempfile.mkdtemp(prefix="sl-e2e-")
MOD = WORK + "/mod-copy"
APP = MOD + "/app/Screen Light.app/Contents/MacOS/ScreenLight"
PFX = "mcp__fakecu__"
WININFO = WORK + "/wininfo"
ROOT = WORK + "/root"
LOG = WORK + "/fake.log"

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS  " if ok else "FAIL  ") + name + (("  -> " + detail) if detail and not ok else ""))
    sys.stdout.flush()


def write_cfg(slow):
    cfg = {"mcpServers": {"fakecu": {"command": "python3", "args": [HERE + "/fake_computer_use.py"],
                                    "env": {"FAKE_LOG": LOG, "FAKE_SLOW_SECONDS": str(slow)}}}}
    path = WORK + "/cfg.json"
    with open(path, "w") as handle:
        json.dump(cfg, handle)
    return path


def claude(prompt, slow=0, wait=True):
    cmd = ["claude", "-p", prompt, "--plugin-dir", MOD, "--plugin-dir", HERE + "/sl-e2e", "--mcp-config", write_cfg(slow),
           "--strict-mcp-config", "--allowedTools", PFX + "*", "--no-session-persistence",
           "--output-format", "text"]
    env = dict(os.environ, SCREEN_LIGHT_DIR=ROOT)
    proc = subprocess.Popen(cmd, cwd=WORK, env=env, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, text=True)
    if not wait:
        return proc
    out, _ = proc.communicate(timeout=180)
    return out


def call(tool, args, slow=0, wait=True):
    return claude("/sl-e2e %s%s %s" % (PFX, tool, json.dumps(args)), slow=slow, wait=wait)


def fake_calls():
    if not os.path.exists(LOG):
        return []
    with open(LOG) as handle:
        return [json.loads(line) for line in handle if line.strip()]


def state_files():
    folder = ROOT + "/state"
    out = {}
    if os.path.isdir(folder):
        for name in os.listdir(folder):
            if name.endswith(".json"):
                try:
                    with open(os.path.join(folder, name)) as handle:
                        out[name] = json.load(handle)
                except ValueError:
                    out[name] = "unparseable"
    return out


def decide():
    cmd = [APP, "--decide", ROOT + "/state", "--pause-file", ROOT + "/pause.json"]
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
    try:
        return json.loads(done.stdout)
    except ValueError:
        return {"error": done.stdout + done.stderr}


def windows():
    done = subprocess.run([WININFO], capture_output=True, text=True, timeout=30)
    return [line for line in done.stdout.splitlines() if line.startswith("owner:")]


def pause_file():
    path = ROOT + "/pause.json"
    if not os.path.exists(path):
        return None
    with open(path) as handle:
        text = handle.read()
    try:
        return json.loads(text)
    except ValueError:
        return text


def make_copy():
    """A fresh copy of the mod (code and built program only) whose tool-name patterns also accept the fake server."""
    shutil.rmtree(MOD, ignore_errors=True)
    os.makedirs(MOD)
    for name in ("hooks", ".claude-plugin", "app"):
        shutil.copytree(REAL + "/" + name, MOD + "/" + name, ignore=shutil.ignore_patterns("types", "__pycache__", "*.py", "*.swift"))
    path = MOD + "/hooks/light.ts"
    text = open(path).read()
    patched = text.replace("computer-use|remote-devices", "computer-use|remote-devices|fakecu")
    check("0 the copy accepts the fake server's tool names", patched.count("|fakecu") == 2 and text.count("computer-use|remote-devices") == 2,
          "expected 2 patterns, found %d" % text.count("computer-use|remote-devices"))
    with open(path, "w") as handle:
        handle.write(patched)
    # the copy must carry the program and the build script as they are now
    check("0 the copy has the built light program", os.path.exists(APP), APP)


def build_wininfo():
    """The small window lister (wininfo.swift) is built into the throwaway folder: it says what windows the light has on screen."""
    arch = subprocess.run(["uname", "-m"], capture_output=True, text=True).stdout.strip()
    done = subprocess.run(["swiftc", "-O", "-target", arch + "-apple-macos13.0", "-o", WININFO, HERE + "/wininfo.swift"],
                          capture_output=True, text=True, timeout=240)
    check("0 the window lister builds", done.returncode == 0 and os.path.exists(WININFO), done.stderr[-300:])


def main():
    if not os.path.exists(REAL + "/app/Screen Light.app/Contents/MacOS/ScreenLight"):
        print("The light program is not built. Run app/build.sh first.")
        return 2
    make_copy()
    build_wininfo()
    subprocess.run(["pkill", "-x", "ScreenLight"])
    time.sleep(0.5)
    shutil.rmtree(ROOT, ignore_errors=True)
    os.makedirs(ROOT + "/state")
    if os.path.exists(LOG):
        os.remove(LOG)

    # A. A normal call runs, lights the light while it is running, and shows up in the state file.
    proc = call("app_screenshot", {"app": "com.google.GeminiMacOS", "action_summary": "Looks at the Gemini window"}, slow=9, wait=False)
    time.sleep(6)
    files = state_files()
    live = [v for v in files.values() if isinstance(v, dict) and v.get("mode") == "app"]
    check("A1 a running call writes a state file in app mode", len(live) == 1 and live[0].get("busy") is True and live[0].get("app") == "Gemini", json.dumps(files))
    check("A2 the call's description is shown", bool(live) and live[0].get("what") == "Looks at the Gemini window", json.dumps(live))
    d = decide()
    check("A3 the light decides 'app' with a pause button", d.get("look") == "app" and d.get("button") == "pause", json.dumps(d))
    check("A4 the light program is up with a window", len(windows()) >= 1, json.dumps(windows()))
    out, _ = proc.communicate(timeout=120)
    check("A5 the call ran and its answer came back untouched", "Captured window_id 1" in out and len(fake_calls()) == 1, out[-300:])

    # B. Pause by command: the next call is refused, the fake tool never runs, and the light shows paused.
    out = claude("/screen-light pause")
    check("B1 /screen-light pause replies", "Paused." in out, out[-200:])
    pf = pause_file()
    check("B2 the pause file says paused by the command", isinstance(pf, dict) and pf.get("paused") is True and pf.get("by") == "command", json.dumps(pf))
    before = len(fake_calls())
    out = call("app_click", {"app": "com.google.GeminiMacOS", "action_summary": "Should be refused"})
    check("B3 a call while paused is refused with the pause text", "Screen control is paused" in out, out[-300:])
    check("B4 the refused call never ran", len(fake_calls()) == before, json.dumps(fake_calls()[before:]))
    d = decide()
    check("B5 the light decides 'paused' with a resume button", d.get("look") == "paused" and d.get("button") == "resume", json.dumps(d))
    time.sleep(1.0)
    check("B6 the paused light has a window on screen", len(windows()) >= 1, json.dumps(windows()))
    for tool, args in (("computer_batch", {"actions": [{"action": "left_click"}]}), ("request_full_control", {}), ("request_access", {"apps": ["x"], "reason": "t"}), ("list_apps", {})):
        before = len(fake_calls())
        out = call(tool, args)
        check("B7 %s is refused while paused" % tool, "Screen control is paused" in out and len(fake_calls()) == before, out[-200:])

    # C. Letting go is always allowed.
    before = len(fake_calls())
    out = call("app_release", {"app": "com.google.GeminiMacOS"})
    check("C1 app_release still runs while paused", len(fake_calls()) == before + 1 and "Released" in out, out[-200:])
    before = len(fake_calls())
    out = call("release_full_control", {})
    check("C2 release_full_control still runs while paused", len(fake_calls()) == before + 1, out[-200:])

    # D. Resume by command: calls run again.
    out = claude("/screen-light resume")
    check("D1 /screen-light resume replies", "Resumed." in out, out[-200:])
    before = len(fake_calls())
    out = call("app_click", {"app": "com.google.GeminiMacOS", "action_summary": "Runs again"})
    check("D2 a call after resume runs", len(fake_calls()) == before + 1 and "AXPress" in out, out[-200:])
    d = decide()
    check("D3 the light shows the resumed toast or nothing, not paused", d.get("look") in ("resumed", "hidden", "app"), json.dumps(d))

    # E. A broken pause file stops Claude (fail closed) and a resume heals it.
    with open(ROOT + "/pause.json", "w") as handle:
        handle.write("{ this is not json")
    before = len(fake_calls())
    out = call("app_click", {"app": "com.google.GeminiMacOS"})
    check("E1 an unreadable pause file refuses with the check-failed text", "could not be checked" in out and len(fake_calls()) == before, out[-300:])
    d = decide()
    check("E2 the light treats the unreadable file as paused", d.get("look") == "paused", json.dumps(d))
    out = claude("/screen-light resume")
    check("E3 resume heals the file", "Resumed." in out and isinstance(pause_file(), dict) and pause_file().get("paused") is False, out[-200:] + json.dumps(pause_file()))

    # F. The button's own write path (the program's press test) stops Claude through the mod.
    done = subprocess.run([APP, "--press-test", "--dir", ROOT], capture_output=True, text=True, timeout=60)
    lines = [l for l in done.stdout.splitlines() if l.strip().startswith("{")]
    check("F1 the press test prints the toggled file twice", len(lines) == 2, done.stdout + done.stderr)
    # the press test ends by pressing twice: paused then resumed. Press once more by writing what the button writes.
    with open(ROOT + "/pause.json", "w") as handle:
        json.dump({"v": 1, "paused": True, "at": int(time.time() * 1000), "by": "light"}, handle)
    before = len(fake_calls())
    out = call("app_click", {"app": "com.google.GeminiMacOS"})
    check("F2 a pause written the way the button writes it refuses a call", "Screen control is paused" in out and len(fake_calls()) == before, out[-300:])
    out = claude("/screen-light resume")
    check("F3 resume after a button pause works", "Resumed." in out, out[-200:])

    subprocess.run(["pkill", "-x", "ScreenLight"])
    shutil.rmtree(WORK, ignore_errors=True)
    failed = [r for r in results if not r[1]]
    print("\n%d checks, %d failed" % (len(results), len(failed)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
