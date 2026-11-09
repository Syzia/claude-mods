#!/usr/bin/env python3
"""Tests for desk_art.py. Everything runs against fakes in a temporary "home":
fake codex, agy, osascript and ps programs, a fake Codex home and a fake Gemini home.
No real generator, clipboard, screen or network is touched.

Run from the mod folder:
    /usr/bin/python3 -m unittest discover -s bin -p 'test_*.py' -v
Set TMPDIR to choose where the temporary folders are made.
"""

import argparse
import contextlib
import fcntl
import hashlib
import io
import json
import os
import re
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import zlib
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import desk_art  # noqa: E402

HELPER = os.path.join(HERE, "desk_art.py")
PYTHON = sys.executable
HAS_SIPS = os.path.exists("/usr/bin/sips")
SUBCOMMANDS = ["status", "codex", "agy", "ingest", "wait-new", "clip-image"]
MANIFEST_KEYS = ["ts", "backend", "label", "jobId", "file", "sha256", "bytes", "width", "height",
                 "format", "source", "threadId", "conversationId", "model", "promptSha256",
                 "prompt", "refs", "note"]
RECORD_KEYS = ["path", "sha256", "bytes", "width", "height", "format", "source", "duplicate"]
# The switches that were run for real on 4 Nov 2026, written out here on purpose: a typo in the helper must not
# be copied into its own test.
HARDEN_ARGS = ["--disable", "shell_tool", "--disable", "unified_exec", "--disable", "unified_exec_tty",
               "--disable", "computer_use", "--disable", "browser_use", "--disable", "browser_use_external",
               "--disable", "browser_use_full_cdp_access", "--disable", "in_app_browser", "--disable", "view_image",
               "--disable", "apps", "--disable", "plugins", "--disable", "multi_agent", "--disable", "goals",
               "--disable", "sleep_tool", "-c", 'web_search="disabled"']
DEFAULT_ROOT_NAMES = ["Desktop/JJKgame.md", "Desktop/JJK Game images", "Desktop/Character reworks",
                      "Desktop/JJK_worktrees"]
# The wrapper text agreed in the fix spec, written out here so that changing it in the helper needs a decision.
WRAPPER_TEXT = (
    "You are making artwork with your built-in image generation tool. Make exactly the image(s) described in "
    "REQUEST, using only that tool. If reference images are attached, keep the same character, outfit and art "
    "style unless REQUEST says otherwise. Do not run commands, do not read, list or open any file (the attached "
    "reference pictures are already in front of you), do not write or edit files, do not browse the web. When the "
    "image(s) are made, reply with one short sentence.\n\nREQUEST:\n")
TID = "01a1a4e9-eb1d-7f83-a5dc-1bebc5509d13"
DONE_EVENTS = [{"type": "turn.started"},
               {"type": "item.completed", "item": {"id": "i", "type": "agent_message", "text": "Done."}},
               {"type": "turn.completed", "usage": {"input_tokens": 1}}]


def codex_argv(work, *image_paths):
    """The exact argument list the helper must give codex (without the program name)."""
    argv = ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-C", work] + HARDEN_ARGS
    for path in image_paths:
        argv += ["-i", path]
    return argv + ["--", "-"]


# ---------------------------------------------------------------------------
# Hand-built picture files
# ---------------------------------------------------------------------------

def png_bytes(width=4, height=3, color=(200, 30, 30)):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + bytes(color) * width for _ in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw))
            + chunk(b"IEND", b""))


def jpeg_bytes(width=5, height=4, marker=0xC0, padding=0):
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    extra = b"\xff\xe1" + struct.pack(">H", padding + 2) + b"x" * padding if padding else b""
    sof = bytes([0xFF, marker]) + struct.pack(">HBHHB", 11, 8, height, width, 1) + b"\x01\x11\x00"
    return b"\xff\xd8" + app0 + extra + sof + b"\xff\xd9"


def riff(kind, payload):
    chunk = kind + struct.pack("<I", len(payload)) + payload + (b"\x00" if len(payload) % 2 else b"")
    return b"RIFF" + struct.pack("<I", 4 + len(chunk)) + b"WEBP" + chunk


def webp_vp8x(width, height):
    payload = b"\x00\x00\x00\x00" + (width - 1).to_bytes(3, "little") + (height - 1).to_bytes(3, "little")
    return riff(b"VP8X", payload)


def webp_vp8l(width, height):
    bits = (width - 1) | ((height - 1) << 14)
    return riff(b"VP8L", b"\x2f" + bits.to_bytes(4, "little") + b"\x00" * 8)


def webp_vp8(width, height):
    return riff(b"VP8 ", b"\x00\x00\x00" + b"\x9d\x01\x2a" + struct.pack("<HH", width, height))


# ---------------------------------------------------------------------------
# Fake programs (written into the sandbox; behaviour chosen by FAKE_* variables)
# ---------------------------------------------------------------------------

FAKE_CODEX = r'''#!/usr/bin/python3
# Fake codex for the desk-art tests. FAKE_CODEX_MODE picks the behaviour.
import hashlib, json, os, random, signal, struct, subprocess, sys, time, uuid, zlib

args = sys.argv[1:]
mode = os.environ.get("FAKE_CODEX_MODE", "one")
log_path = os.environ.get("FAKE_CODEX_LOG")
codex_home = os.environ.get("CODEX_HOME") or os.environ.get("DESK_ART_CODEX_HOME", "")   # like the real codex
FEATURES = ["shell_tool", "unified_exec", "unified_exec_tty", "computer_use", "browser_use", "browser_use_external",
            "browser_use_full_cdp_access", "in_app_browser", "view_image", "apps", "plugins", "multi_agent", "goals",
            "sleep_tool", "code_mode_host", "skill_search", "image_generation", "fast_mode"]


def record(entry):
    if log_path:
        with open(log_path, "a") as handle:
            handle.write(json.dumps(entry) + "\n")


def png():
    color = bytes(random.randrange(256) for _ in range(3))
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + color * 4 for _ in range(4))
    header = struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def say(event):
    sys.stdout.write(json.dumps(event) + "\n")
    sys.stdout.flush()


def write_images(folder, names, step=0.2):
    os.makedirs(folder, exist_ok=True)
    now = time.time()
    for number, name in enumerate(names):
        path = os.path.join(folder, name)
        with open(path, "wb") as handle:
            handle.write(png())
        stamp = now - 1.6 + number * step    # finished (older than 1 s) but made during this run
        os.utime(path, (stamp, stamp))


if args[:1] == ["--version"]:
    record({"call": "version", "env_names": sorted(os.environ)})
    print("codex-cli 0.164.0-alpha.11.1")
    sys.exit(0)

if args[:2] == ["features", "list"]:
    record({"call": "features", "env_names": sorted(os.environ)})
    shown = os.environ.get("FAKE_CODEX_FEATURES", "all")
    if shown == "fail":
        sys.stderr.write("error: cannot list features\n")
        sys.exit(1)
    for name in ([] if shown == "empty" else FEATURES):
        if shown == "missing" and name in ("goals", "sleep_tool"):
            continue
        print("%-40s stable             true" % name)
    sys.exit(0)

if args[:2] == ["login", "status"]:
    record({"call": "login", "env_names": sorted(os.environ)})
    where = os.environ.get("FAKE_CODEX_LOGIN", "stderr")
    if mode == "loggedout":
        sys.stderr.write("Not logged in\n")
        sys.exit(1)
    text = "hello there\n" if where == "garbage" else "Logged in using ChatGPT\n"
    (sys.stdout if where == "stdout" else sys.stderr).write(text)
    sys.exit(0)

if args[:1] != ["exec"]:
    sys.stderr.write("unexpected command\n")
    sys.exit(64)

# Parse like clap does: -i/--image is greedy, "--" ends the options.
rest = args[1:]
valued = {"-s", "-C", "-m", "-c", "-o", "--disable"}
workdir = None
images = []
positional = []
index = 0
while index < len(rest):
    token = rest[index]
    if token == "--":
        positional.extend(rest[index + 1:])
        break
    if token in ("-i", "--image"):
        index += 1
        while index < len(rest) and not rest[index].startswith("-"):
            images.append(rest[index])
            index += 1
        continue
    if token in valued:
        if token == "-C":
            workdir = rest[index + 1]
        index += 2
        continue
    if token.startswith("-"):
        index += 1
        continue
    positional.append(token)
    index += 1

if positional == ["-"] or not positional:
    prompt = sys.stdin.read()
else:
    prompt = positional[0]
def describe(path):
    try:
        with open(path, "rb") as handle:
            data = handle.read()
        return {"path": path, "sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data),
                "mode": oct(os.stat(path).st_mode & 0o777), "dir_mode": oct(os.stat(os.path.dirname(path)).st_mode & 0o777)}
    except OSError as exc:
        return {"path": path, "error": str(exc)}


record({"call": "exec", "argv": args, "cwd": os.getcwd(), "workdir": workdir, "images": images,
        "image_info": [describe(image) for image in images], "env_names": sorted(os.environ),
        "positional": positional, "prompt": prompt,
        "has_api_key": any(name in os.environ for name in ("OPENAI_API_KEY", "CODEX_API_KEY"))})
if not prompt.strip():
    sys.stderr.write("Error: no prompt provided\n")
    sys.exit(2)
for image in images:
    if not os.path.isfile(image):
        sys.stderr.write("Error: No such file: %s\n" % image)
        sys.exit(2)

if mode == "silentfail":
    sys.stderr.write("fatal: the model is unavailable right now\n")
    sys.exit(3)
if mode == "unknownflag":
    sys.stderr.write("Error: Unknown feature flag: shell_tool\n")
    sys.exit(1)
if mode == "bigstderr":
    sys.stderr.write("".join("progress %05d\n" % n for n in range(12000)) + "FATAL: the real reason is at the end\n")
    sys.exit(3)

thread = str(uuid.uuid4())
if mode == "noise":
    sys.stdout.write("Loading plugins...\n[1;32mready[0m\n")
if mode == "hostile":                               # a line nested far too deep, and one with a huge integer
    sys.stdout.write("[" * 300000 + "\n" + '{"type": "x", "n": ' + "9" * 1500000 + "}\n")
if mode != "nothread":
    say({"type": "thread.started", "thread_id": thread})
say({"type": "turn.started"})

if mode in ("timeout", "stubborn", "timeout-picture"):
    if mode == "timeout-picture":
        write_images(os.path.join(codex_home, "generated_images", thread), ["exec-before-the-stop.png"])
    if mode == "stubborn":
        signal.signal(signal.SIGTERM, signal.SIG_IGN)       # the child inherits "ignore"
    child = subprocess.Popen(["/bin/sleep", "300"])
    pid_file = os.environ.get("FAKE_CODEX_PIDS")
    if pid_file:
        with open(pid_file, "w") as handle:
            handle.write("%d %d" % (os.getpid(), child.pid))
    time.sleep(300)
    sys.exit(0)

if mode == "refusal":
    say({"type": "item.completed", "item": {"id": "item_0", "type": "agent_message",
                                             "text": "I can't make that picture."}})
    say({"type": "turn.completed", "usage": {"input_tokens": 10, "output_tokens": 2}})
    sys.exit(0)

if mode == "error":
    say({"type": "error", "message": "stream disconnected before completion"})
    say({"type": "turn.failed", "error": {"message": "stream disconnected before completion"}})
    sys.exit(1)

if mode in ("transient", "transient-noimage"):
    say({"type": "error", "message": "Reconnecting... 1/5"})

if mode == "wrongthread":
    write_images(os.path.join(codex_home, "generated_images", "other-" + thread), ["exec-new.png"])
elif mode == "nothread":
    write_images(os.path.join(codex_home, "generated_images", "loose"), ["exec-nothread.png"])
elif mode == "stray":                                # a parallel run leaves its picture while this one works
    write_images(os.path.join(codex_home, "generated_images", "someone-else"), ["exec-stray.png"])
    write_images(os.path.join(codex_home, "generated_images", thread), ["exec-own.png"])
elif mode == "many":
    write_images(os.path.join(codex_home, "generated_images", thread), ["exec-%02d.png" % n for n in range(20)], 0.01)
elif mode == "failafter":
    write_images(os.path.join(codex_home, "generated_images", thread), ["exec-made-then-failed.png"])
    say({"type": "error", "message": "stream disconnected before completion"})
    say({"type": "turn.failed", "error": {"message": "stream disconnected before completion"}})
    sys.exit(1)
elif mode == "transient-noimage":
    pass                                                    # a finished turn, a retry notice, and no picture
elif mode == "two":
    write_images(os.path.join(codex_home, "generated_images", thread), ["exec-zzz.png", "exec-aaa.png"])
else:
    write_images(os.path.join(codex_home, "generated_images", thread), ["exec-%s.png" % uuid.uuid4()])

say({"type": "item.completed", "item": {"id": "item_0", "type": "agent_message", "text": "I will make it."}})
say({"type": "item.completed", "item": {"id": "item_1", "type": "agent_message",
                                         "text": "W" * 3000 if mode == "bigmessage" else "Done."}})
usage = {"input_tokens": 100, "cached_input_tokens": 50, "output_tokens": 7, "reasoning_output_tokens": 3}
if mode == "oddusage":
    usage.update({"note": "x" * 5000, "nested": {"a": [1, 2]}, "flag": True, "output_tokens": "seven"})
say({"type": "turn.completed", "usage": usage})
'''

FAKE_AGY = r'''#!/usr/bin/python3
# Fake agy for the desk-art tests. FAKE_AGY_MODE picks the behaviour.
import hashlib, json, os, random, struct, subprocess, sys, time, uuid, zlib

args = sys.argv[1:]
mode = os.environ.get("FAKE_AGY_MODE", "workdir")
log_path = os.environ.get("FAKE_AGY_LOG")
gemini = os.environ.get("DESK_ART_GEMINI_HOME", "")


def record(entry):
    if log_path:
        with open(log_path, "a") as handle:
            handle.write(json.dumps(entry) + "\n")


def png():
    color = bytes(random.randrange(256) for _ in range(3))
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + color * 4 for _ in range(4))
    header = struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def jpeg():
    app0 = b"\xff\xe0" + struct.pack(">H", 16) + b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof = b"\xff\xc0" + struct.pack(">HBHHB", 11, 8, 4, 5, 1) + b"\x01\x11\x00"
    return b"\xff\xd8" + app0 + sof + b"\xff\xd9" + bytes([random.randrange(256)])


def put(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(data)
    stamp = time.time() - 10
    os.utime(path, (stamp, stamp))


if args[:1] == ["--version"]:
    print("agy 0.9.9-fake")
    sys.exit(0)

model = prompt = output_format = None
index = 0
while index < len(args):
    if args[index] == "--output-format":
        output_format = args[index + 1]
        index += 2
    elif args[index] == "--model":
        model = args[index + 1]
        index += 2
    elif args[index] == "-p":
        prompt = args[index + 1]
        index += 2
    else:
        sys.stderr.write("unknown flag: %s\n" % args[index])
        sys.exit(2)
def sha(path):
    with open(path, "rb") as handle:
        return hashlib.sha256(handle.read()).hexdigest()


ref_names = sorted(os.listdir("refs")) if os.path.isdir("refs") else []
record({"argv": args, "cwd": os.getcwd(), "prompt": prompt, "model": model, "format": output_format,
        "refs": ref_names, "ref_sha256": [sha(os.path.join("refs", name)) for name in ref_names],
        "ref_modes": [oct(os.stat(os.path.join("refs", name)).st_mode & 0o777) for name in ref_names],
        "env_names": sorted(os.environ),
        "has_api_key": any(name in os.environ for name in ("GEMINI_API_KEY", "GOOGLE_API_KEY"))})

conversation = "conv-" + uuid.uuid4().hex[:8]
brain = os.path.join(gemini, "antigravity-cli", "brain", conversation)           # where agy 1.5.0 really writes
app_brain = os.path.join(gemini, "antigravity", "brain", conversation)             # the desktop app's folder
envelope = {"conversation_id": conversation, "status": "success", "response": "Made it.",
            "usage": {"input_tokens": 5}}
if os.environ.get("FAKE_AGY_NOID"):
    del envelope["conversation_id"]

if mode == "exit1":
    sys.stderr.write("boom: not signed in\n")
    sys.exit(1)
if mode == "timeout":
    child = subprocess.Popen(["/bin/sleep", "300"])
    pid_file = os.environ.get("FAKE_AGY_PIDS")
    if pid_file:
        with open(pid_file, "w") as handle:
            handle.write("%d %d" % (os.getpid(), child.pid))
    time.sleep(300)
if mode == "statuserror":
    envelope["status"] = "ERROR"
    envelope["response"] = "quota exceeded for this week"
if mode == "workdir":
    put("out/pic.png", png())
if mode == "brain":
    put(os.path.join(brain, "generated_%d.jpg" % (time.time() * 1000)), jpeg())
if mode == "appbrain":
    put(os.path.join(app_brain, "generated_%d.jpg" % (time.time() * 1000)), jpeg())
if mode in ("copyref", "copyref-only"):                  # the real agent copies the reference into its own folder
    for name in ref_names:
        with open(os.path.join("refs", name), "rb") as source:
            put(os.path.join(brain, "ref_copy_%d%s" % (time.time() * 1000, os.path.splitext(name)[1])), source.read())
if mode == "copyref":
    put(os.path.join(brain, "result_%d.jpg" % (time.time() * 1000)), jpeg())
if mode == "viewlog":                    # agy 1.5.0 also logs every picture it was shown, re-encoded, under .system_generated
    for number, name in enumerate(ref_names):
        put(os.path.join(brain, ".system_generated", "logs", "media", "step_%d_media_0.jpg" % (number + 2)), jpeg())
    put(os.path.join(brain, "result_%d.jpg" % (time.time() * 1000)), jpeg())
if mode == "both":
    data = png()
    put("out/pic.png", data)
    put(os.path.join(brain, "pic_%d.png" % (time.time() * 1000)), data)
if mode == "cli":
    put(os.path.join(gemini, "antigravity-cli", "settings.json"), b'{"secret": "SETTINGS-MARKER"}')
    put(os.path.join(gemini, "antigravity-cli", "cache", "preview.png"), png())
if mode == "none":
    sys.stderr.write("notice: a tool call needed approval and was denied in headless mode\n")
if mode == "stranger" or os.environ.get("FAKE_AGY_ALSO_STRANGER"):    # the desktop app saves a picture meanwhile
    put(os.path.join(gemini, "antigravity", "brain", "owners-own-chat", "sketch_%d.png" % (time.time() * 1000)), png())
    put(os.path.join(gemini, "antigravity-cli", "brain", "another-run", "other_%d.png" % (time.time() * 1000)), png())
if mode == "many":
    for number in range(20):
        put("out/pic%02d.png" % number, png())
if mode == "bigreply":
    envelope["response"] = "R" * 5000
    put("out/pic.png", png())
if mode == "deepjson":                             # nested far too deep, around a real envelope
    sys.stdout.write("[" * 300000 + "\n")
    put("out/pic.png", png())

text = json.dumps(envelope)
if mode == "noise":
    put("out/pic.png", png())
    text = "Starting agent...\n" + text + "\nbye\n"
sys.stdout.write(text + "\n")
'''

FAKE_OSASCRIPT = r'''#!/usr/bin/python3
# Fake osascript: writes FAKE_CLIP_FILE to the path given as the last argument.
import os, shutil, sys

args = sys.argv[1:]
script = " ".join(args[i + 1] for i, token in enumerate(args) if token == "-e" and i + 1 < len(args))
target = args[-1]
mode = os.environ.get("FAKE_CLIP_MODE", "png")
source = os.environ.get("FAKE_CLIP_FILE", "")
if mode == "png" and "PNGf" in script:
    shutil.copyfile(source, target)
    sys.exit(0)
if mode == "tiff" and "TIFF" in script:
    shutil.copyfile(source, target)
    sys.exit(0)
if mode == "garbage" and "PNGf" in script:
    with open(target, "wb") as handle:
        handle.write(b"this is not a picture")
    sys.exit(0)
sys.stderr.write("execution error: Can't make some data into the expected type. (-1700)\n")
sys.exit(1)
'''

FAKE_PS = r'''#!/usr/bin/python3
import os
print("COMM")
for line in os.environ.get("FAKE_PS_LINES", "").split("\n"):
    if line:
        print(line)
'''

# A codex that does exactly what the JSON script named by FC_SCRIPT says: pictures to write (a path under the codex
# home, how old they look in seconds, a colour seed), event lines to print, text for stderr, an exit code. Used where a
# test needs the exact events and files of one run (which pictures count as a run's own).
SCRIPTED_CODEX = r'''#!/usr/bin/python3
import json, os, struct, sys, time, zlib

args = sys.argv[1:]
script = json.load(open(os.environ["FC_SCRIPT"])) if os.environ.get("FC_SCRIPT") else {}
home = os.environ.get("CODEX_HOME") or os.environ.get("DESK_ART_CODEX_HOME") or os.path.expanduser("~/.codex")


def png(seed):
    color = bytes([(seed * 37) % 256, (seed * 91 + 5) % 256, (seed * 13 + 77) % 256])

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + color * 4 for _ in range(4))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


if args[:1] == ["--version"]:
    print("codex-cli scripted")
    sys.exit(0)
if args[:2] == ["login", "status"]:
    sys.stderr.write("Logged in using ChatGPT\n")
    sys.exit(0)
sys.stdin.read()
for item in script.get("files", []):
    path = os.path.join(home, item["path"])
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as handle:
        handle.write(png(item.get("seed", 0)))
    stamp = time.time() - item.get("age", 1.2)
    os.utime(path, (stamp, stamp))
for line in script.get("lines", []):
    sys.stdout.write(json.dumps(line) + "\n")
    sys.stdout.flush()
if script.get("stderr"):
    sys.stderr.write(script["stderr"])
sys.exit(script.get("exit", 0))
'''


# ---------------------------------------------------------------------------
# Sandbox: a temporary "home" with fake programs
# ---------------------------------------------------------------------------

class Result(object):
    def __init__(self, code, data, out, err):
        self.code = code
        self.data = data
        self.out = out
        self.err = err


class Sandbox(object):
    def __init__(self):
        self.root = os.path.realpath(tempfile.mkdtemp(prefix="deskart-"))
        self.home = self.make_dir("home")
        self.inbox = os.path.join(self.home, "Desktop", "art inbox")
        self.codex_home = self.make_dir("home", ".codex")
        self.gemini_home = self.make_dir("home", ".gemini")
        self.cache = os.path.join(self.home, "Library", "Caches", "desk-art")
        self.apps = self.make_dir("apps")
        self.tools = self.make_dir("tools")
        self.outside = self.make_dir("outside")
        self.art = os.path.join(self.home, "Desktop", "JJKgame.md")        # the first of the default reference folders
        self.codex = self.script("codex", FAKE_CODEX)
        self.scripted_codex = self.script("codex-scripted", SCRIPTED_CODEX)
        self.agy = self.script("agy", FAKE_AGY)
        self.osascript = self.script("osascript", FAKE_OSASCRIPT)
        self.ps = self.script("ps", FAKE_PS)
        self.codex_log = os.path.join(self.root, "codex-calls.jsonl")
        self.agy_log = os.path.join(self.root, "agy-calls.jsonl")

    def close(self):
        shutil.rmtree(self.root, ignore_errors=True)

    def make_dir(self, *parts):
        path = os.path.join(self.root, *parts)
        os.makedirs(path, exist_ok=True)
        return path

    def script(self, name, source):
        path = os.path.join(self.tools, name)
        with open(path, "w") as handle:
            handle.write(source)
        os.chmod(path, 0o755)
        return path

    def env(self, **extra):
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("DESK_ART_", "FAKE_")) and key not in desk_art.SCRUBBED_ENV
               and key != "CODEX_HOME"}
        env.update({
            "DESK_ART_HOME": self.home, "DESK_ART_INBOX": self.inbox, "DESK_ART_CODEX": self.codex,
            "DESK_ART_CODEX_HOME": self.codex_home, "DESK_ART_AGY": self.agy,
            "DESK_ART_GEMINI_HOME": self.gemini_home, "DESK_ART_CACHE": self.cache,
            "DESK_ART_OSASCRIPT": self.osascript, "DESK_ART_APPS": self.apps, "DESK_ART_PS": self.ps,
            "FAKE_CODEX_LOG": self.codex_log, "FAKE_AGY_LOG": self.agy_log})
        env.update(extra)
        return env

    def write_png(self, path, width=4, height=3, color=(200, 30, 30), age=10):
        return self.write_file(path, png_bytes(width, height, color), age)

    def write_file(self, path, data, age=10):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as handle:
            handle.write(data)
        stamp = time.time() - age
        os.utime(path, (stamp, stamp))
        return path

    def manifest(self):
        path = os.path.join(self.inbox, "manifest.jsonl")
        if not os.path.exists(path):
            return []
        with open(path, encoding="utf-8") as handle:
            return [json.loads(line) for line in handle.read().split("\n") if line.strip()]

    def calls(self, log_path, kind=None):
        if not os.path.exists(log_path):
            return []
        with open(log_path) as handle:
            entries = [json.loads(line) for line in handle if line.strip()]
        return [e for e in entries if kind is None or e.get("call") == kind]

    def filed_files(self):
        found = []
        for folder, _, names in os.walk(self.inbox):
            found.extend(os.path.join(folder, n) for n in names if n != "manifest.jsonl")
        return sorted(found)


class SandboxCase(unittest.TestCase):
    def setUp(self):
        self.sb = Sandbox()
        self.addCleanup(self.sb.close)

    def cli(self, *args, **options):
        """Run the helper as a program. Always checks the one-JSON-object-on-stdout rule."""
        stdin = options.get("stdin")
        if isinstance(stdin, str):
            stdin = stdin.encode("utf-8")
        env = self.sb.env()
        env.update(options.get("env") or {})
        done = subprocess.run([PYTHON, HELPER] + [str(a) for a in args], input=stdin,
                              stdin=None if stdin is not None else subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env,
                              timeout=options.get("timeout", 120))
        out = done.stdout.decode("utf-8")
        err = done.stderr.decode("utf-8", "replace")
        self.assertTrue(out.endswith("\n") and out.count("\n") == 1, "stdout is not one line: %r" % out[:300])
        self.assertTrue(out.isascii(), "stdout is not plain ASCII JSON")
        data = json.loads(out)
        self.assertIsInstance(data, dict)
        self.assertIn("ok", data)
        if data["ok"] is False and args and str(args[0]) in desk_art.FAILURE_CODES:
            self.assertIn(data["code"], desk_art.FAILURE_CODES[str(args[0])], out)    # the --help table is true
        return Result(done.returncode, data, out, err)

    def inproc(self, *args, **options):
        """Run run_cli inside this process with the sandbox environment. Returns (code, result)."""
        env = self.sb.env()
        env.update(options.pop("env", None) or {})
        stdin = options.pop("stdin", b"")
        captured = options.pop("capture", None)          # a StringIO that receives what the helper printed on stderr
        if isinstance(stdin, str):
            stdin = stdin.encode("utf-8")
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.dict(os.environ, env, clear=True))
            stack.enter_context(mock.patch.object(desk_art, "read_stdin_bytes", lambda limit: stdin))
            stack.enter_context(contextlib.redirect_stderr(captured if captured is not None else io.StringIO()))
            for name, value in options.items():
                stack.enter_context(mock.patch.object(desk_art, name, value))
            return desk_art.run_cli([str(a) for a in args])

    def root_args(self, roots="home"):
        """--ref-root flags. "home" allows the whole sandbox home (the location rule still applies); None sends
        none, so the helper's default folders are in force."""
        if roots == "home":
            roots = [self.sb.home]
        return [part for root in roots or () for part in ("--ref-root", root)]

    def codex(self, prompt="a plain test picture", label="hero", extra=(), env=None, roots="home", **options):
        return self.cli("codex", "--label", label, "--prompt-stdin", *self.root_args(roots), *extra,
                        stdin=prompt, env=env, **options)

    def agy(self, prompt="a plain test picture", label="hero", extra=(), env=None, roots="home", **options):
        return self.cli("agy", "--label", label, "--prompt-stdin", *self.root_args(roots), *extra,
                        stdin=prompt, env=env, **options)

    def assert_failure(self, result, code, exit_code=2):
        self.assertEqual(result.code, exit_code, result.out)
        self.assertIs(result.data["ok"], False)
        self.assertEqual(result.data["code"], code, result.out)

    def assert_alive_not(self, pid, seconds=4.0):
        deadline = time.time() + seconds
        while time.time() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            time.sleep(0.05)
        os.kill(pid, signal.SIGKILL)
        self.fail("process %d is still running" % pid)


# ---------------------------------------------------------------------------
# Picture headers
# ---------------------------------------------------------------------------

class HeaderTests(unittest.TestCase):
    def setUp(self):
        self.dir = os.path.realpath(tempfile.mkdtemp(prefix="deskart-hdr-"))
        self.addCleanup(shutil.rmtree, self.dir, True)

    def file(self, name, data):
        path = os.path.join(self.dir, name)
        with open(path, "wb") as handle:
            handle.write(data)
        return path

    def test_png(self):
        self.assertEqual(desk_art.read_image_header(self.file("a.png", png_bytes(7, 5))), ("png", 7, 5))

    def test_jpeg(self):
        self.assertEqual(desk_art.read_image_header(self.file("a.jpg", jpeg_bytes(123, 45))), ("jpeg", 123, 45))

    def test_jpeg_skips_a_long_segment_before_the_frame_header(self):
        data = jpeg_bytes(640, 480, padding=60000)
        self.assertEqual(desk_art.read_image_header(self.file("big.jpg", data)), ("jpeg", 640, 480))

    def test_jpeg_progressive_frame_marker(self):
        data = jpeg_bytes(31, 17, marker=0xC2)
        self.assertEqual(desk_art.read_image_header(self.file("p.jpg", data)), ("jpeg", 31, 17))

    def test_webp_extended_lossless_and_lossy(self):
        self.assertEqual(desk_art.read_image_header(self.file("x.webp", webp_vp8x(640, 480))), ("webp", 640, 480))
        self.assertEqual(desk_art.read_image_header(self.file("l.webp", webp_vp8l(33, 17))), ("webp", 33, 17))
        self.assertEqual(desk_art.read_image_header(self.file("y.webp", webp_vp8(100, 60))), ("webp", 100, 60))

    def test_detect_format_looks_at_magic_bytes_only(self):
        self.assertEqual(desk_art.detect_format(png_bytes()[:16]), "png")
        self.assertEqual(desk_art.detect_format(b"\xff\xd8\xff\xe0"), "jpeg")
        self.assertEqual(desk_art.detect_format(webp_vp8(1, 1)[:16]), "webp")
        self.assertIsNone(desk_art.detect_format(b"GIF89a"))
        self.assertIsNone(desk_art.detect_format(b"RIFF\x00\x00\x00\x00WAVE"))
        self.assertIsNone(desk_art.detect_format(b""))

    def test_text_file_with_a_picture_name_is_rejected(self):
        with self.assertRaises(desk_art.Failure) as caught:
            desk_art.read_image_header(self.file("fake.png", b"just some words in a file"))
        self.assertEqual(caught.exception.code, "not-an-image")

    def test_broken_header_is_rejected_after_the_sips_fallback_fails(self):
        with self.assertRaises(desk_art.Failure) as caught:
            desk_art.read_image_header(self.file("broken.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 30))
        self.assertEqual(caught.exception.code, "not-an-image")

    @unittest.skipUnless(HAS_SIPS, "needs /usr/bin/sips")
    def test_sips_is_the_fallback_when_our_own_parsing_fails(self):
        path = self.file("real.png", png_bytes(9, 6))
        with mock.patch.dict(desk_art.SIZE_READERS, {"png": lambda handle: None}):
            self.assertEqual(desk_art.read_image_header(path), ("png", 9, 6))


class LocationTests(unittest.TestCase):
    def test_location_rules(self):
        home = "/Users/someone"
        self.assertIsNone(desk_art.location_problem("/Users/someone/Desktop/a.png", home))
        self.assertIsNone(desk_art.location_problem("/Users/someone/a.png", home))
        for bad in ("/etc/passwd", "/Users/someone", "/Users/someone2/a.png", "/Users/someone/.ssh/id.png",
                    "/Users/someone/.codex/x.png", "/Users/someone/Library/Caches/x.png",
                    "/Users/someone/library/x.png"):
            self.assertIsNotNone(desk_art.location_problem(bad, home), bad)

    def test_secret_file_names(self):
        for bad in (".env", ".ENV", ".env.local", ".envrc", "prod.env", "auth.json", "Auth.JSON",
                    "login.keychain", "x.keychain-db"):
            self.assertTrue(desk_art.secret_file_name(bad), bad)
        for fine in ("environment.png", "env.png", "dev.png", "sprite.png", "author.json", "myenv", "a.png"):
            self.assertFalse(desk_art.secret_file_name(fine), fine)

    def test_secret_file_names_are_compared_the_way_the_file_system_compares_them(self):
        """APFS ignores case and Unicode forms, so look-alike spellings name the same file (SEC-6)."""
        for bad in ("auth.j\u017fon",                 # long s: casefolds to s, lower() leaves it alone
                    "AUTH.J\u017fON", "\uff41\uff55\uff54\uff48.json",        # full-width letters
                    "login.\u212aeychain",           # Kelvin sign is a k
                    "x.\u212aeychain-db", ".\uff25\uff2e\uff36", "prod.\uff45nv"):
            self.assertTrue(desk_art.secret_file_name(bad), bad.encode("unicode_escape"))
        for fine in ("\u017fprite.png", "auth\u017f.png", "\u212aaito.png", "author.j\u017fon", "caf\u00e9.png"):
            self.assertFalse(desk_art.secret_file_name(fine), fine.encode("unicode_escape"))


# (A class of its own because it needs the sandbox; it sits next to the pure name tests above.)
class LookAlikeSecretTests(SandboxCase):
    def test_a_look_alike_of_auth_json_is_refused_before_it_is_opened(self):
        path = self.sb.write_png(os.path.join(self.sb.home, "Desktop", "project", "auth.j\u017fon"))
        opened = []
        real_open = open

        def spy(target, *args, **kwargs):
            opened.append(str(target))
            return real_open(target, *args, **kwargs)
        for argv in (["codex", "--label", "x", "--prompt-stdin", "--ref", path, "--ref-root", self.sb.home],
                     ["ingest", "--label", "x", "--backend", "other", "--file", path, "--ref-root", self.sb.home],
                     ["codex", "--label", "x", "--prompt-file", path]):
            with mock.patch("builtins.open", spy):
                code, result = self.inproc(*argv, stdin=b"p")
            self.assertEqual((code, result["code"]), (2, "bad-input"), argv)
            self.assertIn("secrets or sign-in", result["error"])
        self.assertEqual([p for p in opened if os.path.basename(p).startswith("auth.")], [])


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

class ValidationTests(SandboxCase):
    """Validation happens before any program is looked for, so a missing codex proves a pass."""

    def validate(self, prompt="ok", label="hero", extra=(), env=None):
        missing = os.path.join(self.sb.root, "no-such-codex")
        merged = {"DESK_ART_CODEX": missing}
        merged.update(env or {})
        return self.codex(prompt, label, extra, env=merged)

    def test_valid_labels_pass(self):
        for label in ("a", "char_01", "0-start", "x" * 40):
            self.assert_failure(self.validate(label=label), "codex-not-found")

    def test_invalid_labels_fail(self):
        for label in ("", "Hero", "-dash", "_under", "x" * 41, "has space", "dot.dot", "a\n"):
            self.assert_failure(self.validate(label=label), "bad-input")

    def test_prompt_rules(self):
        self.assert_failure(self.validate(prompt=""), "bad-input")
        self.assert_failure(self.validate(prompt="   \n\t "), "bad-input")
        self.assert_failure(self.validate(prompt="has a \x00 nul"), "bad-input")
        self.assert_failure(self.validate(prompt="x" * 8001), "bad-input")
        self.assert_failure(self.validate(prompt="x" * 8000), "codex-not-found")
        self.assert_failure(self.validate(prompt=" \n padded \n "), "codex-not-found")
        self.assert_failure(self.validate(prompt="\u00e9" * 8000), "codex-not-found")

    def test_prompt_must_be_utf8(self):
        result = self.cli("codex", "--label", "x", "--prompt-stdin", stdin=b"\xff\xfe bad bytes",
                          env={"DESK_ART_CODEX": os.path.join(self.sb.root, "none")})
        self.assert_failure(result, "bad-input")

    def test_prompt_file_inside_home_is_read(self):
        path = os.path.join(self.sb.home, "prompt.txt")
        with open(path, "w") as handle:
            handle.write("from a file")
        result = self.cli("codex", "--label", "x", "--prompt-file", path,
                          env={"DESK_ART_CODEX": os.path.join(self.sb.root, "none")})
        self.assert_failure(result, "codex-not-found")

    def test_prompt_file_outside_home_or_hidden_is_refused(self):
        outside = os.path.join(self.sb.outside, "p.txt")
        hidden = os.path.join(self.sb.home, ".codex", "auth.json")
        for path in (outside, hidden):
            with open(path, "w") as handle:
                handle.write("not a prompt")
            result = self.cli("codex", "--label", "x", "--prompt-file", path)
            self.assert_failure(result, "bad-input")
            self.assertNotIn("not a prompt", result.out + result.err)

    def test_exactly_one_prompt_source(self):
        path = os.path.join(self.sb.home, "p.txt")
        with open(path, "w") as handle:
            handle.write("x")
        self.assert_failure(self.cli("codex", "--label", "x", stdin=b""), "usage", 3)
        both = self.cli("codex", "--label", "x", "--prompt-file", path, "--prompt-stdin", stdin=b"y")
        self.assert_failure(both, "usage", 3)

    def test_timeout_range(self):
        for bad in ("29", "541", "abc", "nan", "inf", ""):
            self.assert_failure(self.validate(extra=("--timeout", bad)), "bad-input")
        for good in ("30", "540", "120.5"):
            self.assert_failure(self.validate(extra=("--timeout", good)), "codex-not-found")

    def test_model_pattern(self):
        for bad in ("has space", "a;b", "x" * 65, "$(id)"):
            self.assert_failure(self.agy(extra=("--model", bad)), "bad-input")
        for dashed in ("-x", "-", "--dangerously-skip-permissions", "--model=x"):     # never lands next to --model
            result = self.agy(extra=("--model", dashed))
            self.assert_failure(result, "bad-input")
            self.assertEqual(self.sb.calls(self.sb.agy_log), [], dashed)               # agy was never started
            self.assertIn("must not start with '-'", result.data["error"])
        gone = {"DESK_ART_AGY": os.path.join(self.sb.root, "no-agy")}
        self.assert_failure(self.agy(extra=("--model", "gemini-3.1-pro:high"), env=gone), "agy-not-installed")

    def test_reference_rules(self):
        home = self.sb.home
        good_png = self.sb.write_png(os.path.join(home, "Pictures", "a.png"))
        good_jpg = self.sb.write_file(os.path.join(home, "Pictures", "b.jpg"), jpeg_bytes())
        good_webp = self.sb.write_file(os.path.join(home, "Pictures", "c.webp"), webp_vp8x(8, 8))
        for ref in (good_png, good_jpg, good_webp):
            self.assert_failure(self.validate(extra=("--ref", ref)), "codex-not-found")
        text = self.sb.write_file(os.path.join(home, "Pictures", "text.png"), b"not really a picture")
        hidden = self.sb.write_png(os.path.join(home, ".ssh", "key.png"))
        library = self.sb.write_png(os.path.join(home, "Library", "Mail", "x.png"))
        outside = self.sb.write_png(os.path.join(self.sb.outside, "o.png"))
        folder = os.path.join(home, "Pictures")
        big = os.path.join(home, "Pictures", "big.png")
        with open(big, "wb") as handle:
            handle.write(png_bytes())
            handle.truncate(21 * 1024 * 1024)
        link_out = os.path.join(home, "Pictures", "link-out.png")
        os.symlink(outside, link_out)
        link_hidden = os.path.join(home, "Pictures", "link-hidden.png")
        os.symlink(hidden, link_hidden)
        link_ok = os.path.join(home, "Pictures", "link-ok.png")
        os.symlink(good_png, link_ok)
        missing = os.path.join(home, "Pictures", "missing.png")
        for bad in (text, hidden, library, outside, folder, big, link_out, link_hidden, missing):
            result = self.validate(extra=("--ref", bad))
            self.assert_failure(result, "bad-input")
        self.assert_failure(self.validate(extra=("--ref", link_ok)), "codex-not-found")

    def spy_on_open(self):
        """Returns (opened, spy): every path handed to open() is appended to `opened`."""
        opened = []
        real_open = open

        def spy(path, *args, **kwargs):
            opened.append(str(path))
            return real_open(path, *args, **kwargs)
        return opened, spy

    def test_links_that_lead_into_hidden_folders_are_refused_and_nothing_behind_them_is_opened(self):
        """A picture-named link, a link to a folder, a chain of links, and a link to a sign-in file."""
        home = self.sb.home
        hidden = self.sb.write_png(os.path.join(home, ".ssh", "key.png"))
        marker = os.path.join(home, ".codex", "auth.json")
        with open(marker, "w") as handle:
            handle.write("SECRET-MARKER")
        pictures = os.path.join(home, "Pictures")
        os.makedirs(pictures)
        folder_link = os.path.join(pictures, "linkdir")
        os.symlink(os.path.join(home, ".ssh"), folder_link)
        hop2, hop1 = os.path.join(pictures, "hop2.png"), os.path.join(pictures, "hop1.png")
        os.symlink(hidden, hop2)
        os.symlink(hop2, hop1)
        sign_in = os.path.join(pictures, "looks-like-a-picture.png")
        os.symlink(marker, sign_in)
        opened, spy = self.spy_on_open()
        for bad in (os.path.join(folder_link, "key.png"), hop1, sign_in):
            for argv in (["codex", "--label", "x", "--prompt-stdin", "--ref", bad, "--ref-root", home],
                         ["agy", "--label", "x", "--prompt-stdin", "--ref", bad, "--ref-root", home],
                         ["codex", "--label", "x", "--prompt-file", bad]):
                with mock.patch("builtins.open", spy):
                    code, result = self.inproc(*argv, stdin=b"p")
                self.assertEqual((code, result["code"]), (2, "bad-input"), argv)
                self.assertNotIn("SECRET-MARKER", json.dumps(result))
        self.assertEqual([p for p in opened if ".ssh" in p or "auth.json" in p], [])

    def test_secret_file_names_are_refused_before_a_single_byte_is_read(self):
        """.env files, auth.json and keychain files, even in a normal folder and with a real PNG body."""
        home = self.sb.home
        opened, spy = self.spy_on_open()
        names = (".env", ".ENV", ".env.local", ".envrc", "prod.env", "auth.json", "login.keychain-db")
        for name in names:
            path = self.sb.write_png(os.path.join(home, "Desktop", "project", name))
            for argv in (["codex", "--label", "x", "--prompt-stdin", "--ref", path, "--ref-root", home],
                         ["ingest", "--label", "x", "--backend", "other", "--file", path, "--ref-root", home],
                         ["codex", "--label", "x", "--prompt-file", path]):
                with mock.patch("builtins.open", spy):
                    code, result = self.inproc(*argv, stdin=b"p")
                self.assertEqual((code, result["code"]), (2, "bad-input"), (name, argv))
                self.assertIn("secrets or sign-in", result["error"])
        # a picture-named link that points at a .env file is refused by the name it leads to
        env_file = os.path.join(home, "Desktop", "project", ".env")
        disguise = os.path.join(home, "Desktop", "cute.png")
        os.symlink(env_file, disguise)
        with mock.patch("builtins.open", spy):
            code, result = self.inproc("codex", "--label", "x", "--prompt-stdin", "--ref", disguise,
                                       "--ref-root", home, stdin=b"p")
        self.assertEqual((code, result["code"]), (2, "bad-input"))
        self.assertEqual([p for p in opened if os.path.basename(p) in names or p == disguise], [])
        # names that merely contain the letters are fine
        fine = self.sb.write_png(os.path.join(home, "Desktop", "environment.png"))
        self.assert_failure(self.validate(extra=("--ref", fine)), "codex-not-found")

    def test_at_most_six_references(self):
        refs = [self.sb.write_png(os.path.join(self.sb.home, "r%d.png" % n), color=(n, n, n)) for n in range(7)]
        six = [part for ref in refs[:6] for part in ("--ref", ref)]
        seven = [part for ref in refs for part in ("--ref", ref)]
        self.assert_failure(self.validate(extra=six), "codex-not-found")
        self.assert_failure(self.validate(extra=seven), "bad-input")

    def test_inbox_must_be_safe_and_is_not_created_when_unsafe(self):
        link = os.path.join(self.sb.home, "Desktop", "linkbox")
        os.makedirs(os.path.dirname(link), exist_ok=True)
        os.symlink(self.sb.outside, link)
        cases = [os.path.join(self.sb.outside, "inbox"), os.path.join(self.sb.home, ".hidden", "inbox"),
                 os.path.join(self.sb.home, "Library", "inbox"), os.path.join(link, "inbox"), "/etc/desk-art-inbox"]
        for inbox in cases:
            result = self.cli("codex", "--inbox", inbox, "--label", "x", "--prompt-stdin", stdin="p")
            self.assert_failure(result, "inbox-unsafe")
            self.assertFalse(os.path.exists(inbox), inbox)
        self.assertEqual(os.listdir(self.sb.outside), [])

    def test_inbox_flag_beats_the_environment_and_tilde_is_expanded(self):
        result = self.cli("status", "--inbox", "~/Desktop/chosen")
        self.assertEqual(result.data["inbox"]["path"], os.path.join(self.sb.home, "Desktop", "chosen"))
        self.assertEqual(self.cli("status").data["inbox"]["path"], self.sb.inbox)


# ---------------------------------------------------------------------------
# Filing: destination names, manifest, duplicates
# ---------------------------------------------------------------------------

class FilingTests(SandboxCase):
    def ingest(self, *files, **options):
        args = ["ingest", "--label", options.get("label", "hero"), "--backend", options.get("backend", "other")]
        for path in files:
            args += ["--file", path]
        args += self.root_args() + list(options.get("extra", ()))
        return self.cli(*args, stdin=options.get("stdin"))

    def make_sources(self, count=1):
        paths = []
        for number in range(count):
            paths.append(self.sb.write_png(os.path.join(self.sb.home, "Downloads", "src%d.png" % number),
                                           color=(number * 40, 10, 10)))
        return paths

    def test_destination_name_and_record(self):
        (source,) = self.make_sources()
        result = self.ingest(source, label="char_01", backend="codex")
        self.assertEqual(result.code, 0, result.out)
        (image,) = result.data["images"]
        self.assertEqual(list(image.keys()), RECORD_KEYS)
        sha = desk_art.sha256_file(source)
        day = time.strftime("%Y-%m-%d")
        self.assertEqual(image["path"], os.path.join(self.sb.inbox, day, "char_01_codex_01_%s.png" % sha[:8]))
        self.assertTrue(os.path.isfile(image["path"]))
        self.assertEqual((image["width"], image["height"], image["format"], image["duplicate"]), (4, 3, "png", False))
        self.assertEqual(image["bytes"], os.path.getsize(source))
        self.assertEqual(image["source"], source)
        self.assertEqual(image["sha256"], sha)
        self.assertEqual(desk_art.sha256_file(image["path"]), sha)
        self.assertTrue(os.path.exists(source))                       # the source is never touched

    def test_jpeg_gets_the_jpg_extension_and_webp_keeps_its_own(self):
        jpg = self.sb.write_file(os.path.join(self.sb.home, "Downloads", "a.jpeg"), jpeg_bytes(11, 12))
        webp = self.sb.write_file(os.path.join(self.sb.home, "Downloads", "b.webp"), webp_vp8x(21, 22))
        result = self.ingest(jpg, webp)
        names = sorted(os.path.basename(i["path"]) for i in result.data["images"])
        self.assertTrue(names[0].endswith(".jpg") and names[1].endswith(".webp"), names)
        formats = {i["format"]: (i["width"], i["height"]) for i in result.data["images"]}
        self.assertEqual(formats, {"jpeg": (11, 12), "webp": (21, 22)})

    def test_numbers_follow_source_mtime_not_name_or_argument_order(self):
        older = self.sb.write_png(os.path.join(self.sb.home, "Downloads", "zzz.png"), color=(1, 1, 1), age=100)
        newer = self.sb.write_png(os.path.join(self.sb.home, "Downloads", "aaa.png"), color=(2, 2, 2), age=50)
        result = self.ingest(newer, older)
        by_source = {i["source"]: os.path.basename(i["path"]) for i in result.data["images"]}
        self.assertIn("_other_01_", by_source[older])
        self.assertIn("_other_02_", by_source[newer])
        self.assertEqual([i["source"] for i in result.data["images"]], [older, newer])

    def test_manifest_line(self):
        (source,) = self.make_sources()
        prompt = "p" * 5000
        result = self.ingest(source, backend="gemini-app", stdin=prompt,
                             extra=["--prompt-stdin", "--note", "kept the second one"])
        self.assertEqual(result.code, 0, result.out)
        (entry,) = self.sb.manifest()
        self.assertEqual(list(entry.keys()), MANIFEST_KEYS)
        self.assertRegex(entry["ts"], r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
        self.assertRegex(entry["jobId"], r"^\d{8}T\d{6}-[0-9a-f]{6}$")
        self.assertEqual(entry["jobId"], result.data["jobId"])
        self.assertEqual(entry["backend"], "gemini-app")
        self.assertEqual(entry["label"], "hero")
        self.assertEqual(entry["file"], os.path.relpath(result.data["images"][0]["path"], self.sb.inbox))
        self.assertEqual((entry["width"], entry["height"], entry["format"]), (4, 3, "png"))
        self.assertEqual(entry["source"], source)
        self.assertEqual(entry["promptSha256"], desk_art.sha256_text(prompt))
        self.assertEqual(entry["prompt"], prompt[:4000])
        self.assertEqual(entry["refs"], [])
        self.assertEqual(entry["note"], "kept the second one")
        for key in ("threadId", "conversationId", "model"):
            self.assertIsNone(entry[key])

    def test_manifest_without_prompt_has_nulls(self):
        (source,) = self.make_sources()
        self.ingest(source)
        (entry,) = self.sb.manifest()
        self.assertIsNone(entry["prompt"])
        self.assertIsNone(entry["promptSha256"])
        self.assertIsNone(entry["note"])

    def test_the_same_picture_is_filed_once(self):
        (source,) = self.make_sources()
        first = self.ingest(source)
        second = self.ingest(source, label="other_label")
        self.assertFalse(first.data["images"][0]["duplicate"])
        self.assertTrue(second.data["images"][0]["duplicate"])
        self.assertEqual(first.data["images"][0]["path"], second.data["images"][0]["path"])
        self.assertEqual(len(self.sb.manifest()), 1)
        self.assertEqual(len(self.sb.filed_files()), 1)

    def test_a_copy_with_another_name_is_still_a_duplicate(self):
        (source,) = self.make_sources()
        twin = os.path.join(self.sb.home, "Downloads", "twin.png")
        shutil.copyfile(source, twin)
        result = self.ingest(source, twin)
        flags = sorted(i["duplicate"] for i in result.data["images"])
        self.assertEqual(flags, [False, True])
        self.assertEqual(len(self.sb.manifest()), 1)

    def test_a_picture_deleted_from_the_inbox_is_filed_again(self):
        (source,) = self.make_sources()
        first = self.ingest(source)
        os.remove(first.data["images"][0]["path"])
        second = self.ingest(source)
        self.assertFalse(second.data["images"][0]["duplicate"])
        self.assertTrue(os.path.isfile(second.data["images"][0]["path"]))
        self.assertEqual(len(self.sb.manifest()), 2)

    def test_a_different_file_with_the_destination_name_is_never_overwritten(self):
        (source,) = self.make_sources()
        sha = desk_art.sha256_file(source)
        folder = os.path.join(self.sb.inbox, time.strftime("%Y-%m-%d"))
        blocker = os.path.join(folder, "hero_other_01_%s.png" % sha[:8])
        self.sb.write_file(blocker, b"someone else's file")
        result = self.ingest(source)
        path = result.data["images"][0]["path"]
        self.assertNotEqual(path, blocker)
        with open(blocker, "rb") as handle:
            self.assertEqual(handle.read(), b"someone else's file")
        self.assertEqual(desk_art.sha256_file(path), sha)

    def test_a_source_name_with_spaces_and_unusual_characters(self):
        name = "Screenshot 2026-11-04 at 3.45\u202fPM \u2014 caf\u00e9 (1).png"
        source = self.sb.write_png(os.path.join(self.sb.home, "Desktop", name))
        result = self.ingest(source, label="shot")
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["images"][0]["source"], source)
        self.assertEqual(self.sb.manifest()[0]["source"], source)

    def test_a_prompt_of_8000_four_byte_characters_is_kept_whole(self):
        (source,) = self.make_sources()
        prompt = "\U0001f600" * 8000
        result = self.ingest(source, stdin=prompt, extra=["--prompt-stdin"])
        self.assertEqual(result.code, 0, result.out)
        entry = self.sb.manifest()[0]
        self.assertEqual(entry["prompt"], prompt[:4000])
        self.assertEqual(entry["promptSha256"], desk_art.sha256_text(prompt))

    def test_no_temp_files_are_left_behind(self):
        self.ingest(*self.make_sources(3))
        self.assertEqual([n for n in self.sb.filed_files() if n.endswith(".tmp")], [])

    def test_manifest_with_a_torn_last_line_still_works(self):
        os.makedirs(self.sb.inbox)
        with open(os.path.join(self.sb.inbox, "manifest.jsonl"), "w") as handle:
            handle.write('{"not": "complete"}\nthis is not json\n{"sha256": "abc"')
        self.ingest(*self.make_sources(1))
        with open(os.path.join(self.sb.inbox, "manifest.jsonl")) as handle:
            lines = handle.read().split("\n")
        self.assertEqual(lines[-1], "")
        self.assertEqual(json.loads(lines[-2])["label"], "hero")

    def test_a_manifest_line_nested_too_deeply_for_json_is_skipped(self):
        os.makedirs(self.sb.inbox)
        with open(os.path.join(self.sb.inbox, "manifest.jsonl"), "w") as handle:
            handle.write("[" * 200000 + "\n")
        result = self.ingest(*self.make_sources(1))
        self.assertEqual(result.code, 0, result.out)

    def test_a_day_folder_that_is_a_link_leading_elsewhere_is_refused(self):
        (source,) = self.make_sources()
        os.makedirs(self.sb.inbox)
        os.symlink(self.sb.outside, os.path.join(self.sb.inbox, time.strftime("%Y-%m-%d")))
        result = self.ingest(source)
        self.assert_failure(result, "inbox-unsafe")
        self.assertEqual(os.listdir(self.sb.outside), [])                  # nothing was written through the link

    def test_a_manifest_that_is_a_link_is_refused_and_its_target_is_left_alone(self):
        (source,) = self.make_sources()
        target = os.path.join(self.sb.outside, "elsewhere.txt")
        with open(target, "w") as handle:
            handle.write("keep me\n")
        os.makedirs(self.sb.inbox)
        os.symlink(target, os.path.join(self.sb.inbox, "manifest.jsonl"))
        result = self.ingest(source)
        self.assert_failure(result, "inbox-unsafe")
        with open(target) as handle:
            self.assertEqual(handle.read(), "keep me\n")
        self.assertEqual(self.sb.filed_files(), [])

    def test_a_link_planted_at_the_destination_name_is_neither_read_nor_replaced_through(self):
        (source,) = self.make_sources()
        sha = desk_art.sha256_file(source)
        folder = os.path.join(self.sb.inbox, time.strftime("%Y-%m-%d"))
        os.makedirs(folder)
        victim = os.path.join(self.sb.outside, "victim.txt")
        with open(victim, "w") as handle:
            handle.write("not yours")
        planted = os.path.join(folder, "hero_other_01_%s.png" % sha[:8])
        os.symlink(victim, planted)
        hashed = []
        real_hash = desk_art.sha256_file

        def spy(path):
            hashed.append(path)
            return real_hash(path)
        code, result = self.inproc("ingest", "--inbox", self.sb.inbox, "--label", "hero", "--backend", "other",
                                   "--file", source, sha256_file=spy)
        self.assertEqual(code, 0, result)
        self.assertNotIn(planted, hashed)                                  # the link was never read through
        with open(victim) as handle:
            self.assertEqual(handle.read(), "not yours")
        filed = result["images"][0]["path"]
        self.assertEqual(os.path.basename(filed), "hero_other_01_%s-2.png" % sha[:8])
        self.assertTrue(os.path.islink(planted))

    def test_a_copy_that_differs_from_what_was_hashed_is_refused(self):
        (source,) = self.make_sources()
        real_copy = shutil.copyfile

        def corrupting_copy(src, dst, *args, **kwargs):
            real_copy(src, dst)
            with open(dst, "r+b") as handle:                               # same size, other content
                handle.seek(-1, os.SEEK_END)
                last = handle.read(1)
                handle.seek(-1, os.SEEK_END)
                handle.write(b"\x01" if last != b"\x01" else b"\x02")
            return dst
        with mock.patch.object(shutil, "copyfile", corrupting_copy):
            code, result = self.inproc("ingest", "--inbox", self.sb.inbox, "--label", "hero", "--backend", "other",
                                       "--file", source)
        self.assertEqual((code, result["code"]), (2, "bad-input"))
        self.assertIn("changed while it was being copied", result["error"])
        self.assertEqual(self.sb.manifest(), [])
        self.assertEqual(self.sb.filed_files(), [])                        # and the temp copy is gone too

    def test_filing_waits_while_someone_else_holds_the_manifest_lock(self):
        """Deterministic: this test holds the lock itself, so a helper that filed anyway would be caught every time."""
        (source,) = self.make_sources()
        os.makedirs(self.sb.inbox)
        handle = os.open(os.path.join(self.sb.inbox, "manifest.jsonl"), os.O_RDWR | os.O_CREAT, 0o644)
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            proc = subprocess.Popen([PYTHON, HELPER, "ingest", "--label", "lock", "--backend", "other",
                                     "--file", source], env=self.sb.env(), stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE)
            time.sleep(1.5)
            waited = proc.poll() is None
            nothing_filed = self.sb.filed_files() == []
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)
            os.close(handle)
        out, _ = proc.communicate(timeout=30)
        self.assertTrue(waited, "the helper finished while another process held the manifest lock")
        self.assertTrue(nothing_filed, "a picture was filed while another process held the manifest lock")
        self.assertIs(json.loads(out)["ok"], True)
        self.assertEqual(len(self.sb.manifest()), 1)

    def test_the_day_folder_is_local_time_while_job_ids_and_stamps_are_utc(self):
        """Two zones on opposite sides of the date line: one of them is always on another date than UTC, so a
        helper that mixed the clocks up would be caught at any hour of the day."""
        (source,) = self.make_sources()
        for zone in ("Pacific/Kiritimati", "Pacific/Pago_Pago"):                      # UTC+14 and UTC-11
            inbox = os.path.join(self.sb.home, "Desktop", "box-" + zone.replace("/", "_"))
            result = self.cli("ingest", "--inbox", inbox, "--label", "tz", "--backend", "other", "--file", source,
                              *self.root_args(), env={"TZ": zone})
            self.assertEqual(result.code, 0, result.out)
            try:
                with mock.patch.dict(os.environ, {"TZ": zone}):
                    time.tzset()
                    local_day = time.strftime("%Y-%m-%d")
            finally:
                time.tzset()
            utc_day = time.strftime("%Y-%m-%d", time.gmtime())
            filed_day = os.path.basename(os.path.dirname(result.data["images"][0]["path"]))
            self.assertEqual(filed_day, local_day, zone)
            with open(os.path.join(inbox, "manifest.jsonl")) as handle:
                entry = json.loads(handle.readline())
            self.assertEqual(entry["ts"][:10], utc_day, zone)
            self.assertEqual(result.data["jobId"][:8], utc_day.replace("-", ""), zone)

    def test_two_processes_filing_the_same_picture_make_one_file(self):
        """A smoke test of a real race. The lock itself is pinned by the deterministic test above."""
        (source,) = self.make_sources()
        command = [PYTHON, HELPER, "ingest", "--label", "race", "--backend", "other", "--file", source]
        first = subprocess.Popen(command, env=self.sb.env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        second = subprocess.Popen(command, env=self.sb.env(), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        flags = []
        for proc in (first, second):
            out, _ = proc.communicate(timeout=60)
            flags.append(json.loads(out)["images"][0]["duplicate"])
        self.assertEqual(sorted(flags), [False, True])
        self.assertEqual(len(self.sb.manifest()), 1)

    def test_files_over_40_mb_are_refused(self):
        big = os.path.join(self.sb.home, "Downloads", "huge.png")
        os.makedirs(os.path.dirname(big))
        with open(big, "wb") as handle:
            handle.write(png_bytes())
            handle.truncate(41 * 1024 * 1024)
        self.assert_failure(self.ingest(big), "bad-input")

    def test_a_file_still_being_written_is_waited_for(self):
        path = os.path.join(self.sb.root, "growing.png")
        data = png_bytes(8, 8)
        with open(path, "wb") as handle:
            handle.write(data[:30])
        started = time.time()

        def finish():
            with open(path, "ab") as handle:
                for offset in range(30, len(data), 20):
                    time.sleep(0.15)
                    handle.write(data[offset:offset + 20])
                    handle.flush()
        writer = threading.Thread(target=finish)
        writer.start()
        with mock.patch.object(desk_art, "QUIET_SEC", 0.5):
            picture = desk_art.load_picture(path)
        writer.join()
        self.assertEqual(picture.size, len(data))
        self.assertGreater(time.time() - started, 0.15 * ((len(data) - 30) // 20))

    def test_waiting_for_a_file_gives_up_after_the_limit(self):
        path = self.sb.write_png(os.path.join(self.sb.root, "fresh.png"), age=0)
        started = time.time()
        with mock.patch.object(desk_art, "QUIET_SEC", 30.0), mock.patch.object(desk_art, "QUIET_MAX_WAIT_SEC", 0.6):
            desk_art.wait_until_quiet(path)
        self.assertLess(time.time() - started, 3.0)


# ---------------------------------------------------------------------------
# Codex
# ---------------------------------------------------------------------------

class CodexTests(SandboxCase):
    def exec_call(self):
        calls = self.sb.calls(self.sb.codex_log, "exec")
        self.assertEqual(len(calls), 1)
        return calls[0]

    def test_one_image(self):
        prompt = "a girl with short black hair, full body, flat green background"
        result = self.codex(prompt, label="hero")
        self.assertEqual(result.code, 0, result.out + result.err)
        data = result.data
        self.assertEqual(data["backend"], "codex")
        self.assertRegex(data["jobId"], r"^\d{8}T\d{6}-[0-9a-f]{6}$")
        self.assertRegex(data["threadId"], r"^[0-9a-f-]{36}$")
        self.assertEqual(data["finalMessage"], "Done.")
        self.assertEqual(data["usage"]["output_tokens"], 7)
        self.assertEqual(data["matchedBy"], "thread-folder")
        self.assertEqual(data["refsSent"], [])
        self.assertNotIn("skipped", data)
        self.assertIsInstance(data["elapsedSec"], float)
        (image,) = data["images"]
        self.assertEqual(list(image.keys()), RECORD_KEYS)
        self.assertTrue(image["path"].startswith(self.sb.inbox + os.sep))
        self.assertTrue(os.path.isfile(image["path"]))
        self.assertRegex(os.path.basename(image["path"]), r"^hero_codex_01_[0-9a-f]{8}\.png$")
        self.assertTrue(image["source"].startswith(os.path.join(self.sb.codex_home, "generated_images", data["threadId"])))
        (entry,) = self.sb.manifest()
        self.assertEqual(entry["backend"], "codex")
        self.assertEqual(entry["threadId"], data["threadId"])
        self.assertEqual(entry["prompt"], prompt)
        self.assertEqual(entry["promptSha256"], desk_art.sha256_text(prompt))
        self.assertEqual(entry["jobId"], data["jobId"])
        self.assertFalse(os.path.exists(os.path.join(self.sb.cache, "jobs", data["jobId"])))   # cleaned up
        self.assertTrue(os.path.exists(image["source"]))                                      # source kept

    def test_the_verified_argument_arrangement(self):
        """The forms settled by real runs on 4 Nov 2026: the hardening switches after -C, a repeated -i for each
        reference, then the prompt on stdin (`--` then `-`)."""
        base = ["/bin/codex", "exec", "--json", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-C", "/w"]
        self.assertEqual(desk_art.build_codex_argv("/bin/codex", "/w", []), base + HARDEN_ARGS + ["--", "-"])
        self.assertEqual(desk_art.build_codex_argv("/bin/codex", "/w", ["/x/a.png", "/x/b.png"]),
                         base + HARDEN_ARGS + ["-i", "/x/a.png", "-i", "/x/b.png", "--", "-"])

    def test_the_event_lines_of_a_real_run_are_understood(self):
        real = "\n".join([
            '{"type":"thread.started","thread_id":"01a1a514-7ac2-7742-91ce-ff2b6ce0ba8a"}',
            '{"type":"turn.started"}',
            '{"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"I\u2019ll use the reference image."}}',
            '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Done\u2014the circle is blue."}}',
            '{"type":"turn.completed","usage":{"input_tokens":60993,"cached_input_tokens":53504,'
            '"cache_write_input_tokens":0,"output_tokens":454,"reasoning_output_tokens":146}}'])
        events = desk_art.parse_codex_events(real.encode("utf-8"))
        self.assertEqual(events["thread_id"], "01a1a514-7ac2-7742-91ce-ff2b6ce0ba8a")
        self.assertEqual(events["message"], "Done\u2014the circle is blue.")
        self.assertEqual(events["usage"]["output_tokens"], 454)
        self.assertTrue(events["completed"])
        self.assertIsNone(events["error"])

    def test_agy_command_line(self):
        self.assertEqual(desk_art.build_agy_argv("/bin/agy", None, "P"), ["/bin/agy", "--output-format", "json", "-p", "P"])
        self.assertEqual(desk_art.build_agy_argv("/bin/agy", "m1", "P"),
                         ["/bin/agy", "--output-format", "json", "--model", "m1", "-p", "P"])

    def test_exact_command_line_stdin_and_folder(self):
        prompt = "make it blue"
        data = self.codex(prompt).data
        call = self.exec_call()
        work = os.path.join(self.sb.cache, "jobs", data["jobId"], "work")
        self.assertEqual(call["argv"], codex_argv(work))
        self.assertEqual(call["prompt"], desk_art.CODEX_WRAPPER + prompt)
        self.assertTrue(call["prompt"].startswith("You are making artwork with your built-in image generation tool."))
        self.assertTrue(call["prompt"].endswith("\n\nREQUEST:\nmake it blue"))
        self.assertEqual(call["cwd"], work)
        self.assertEqual(call["positional"], ["-"])
        self.assertEqual(call["images"], [])

    def test_no_dangerous_flags_and_no_api_keys(self):
        self.codex(env={"OPENAI_API_KEY": "sk-test", "CODEX_API_KEY": "ck-test"})
        call = self.exec_call()
        joined = " ".join(call["argv"])
        for banned in ("dangerously", "danger-full-access", "approve-for-me"):
            self.assertNotIn(banned, joined)
        self.assertFalse(call["has_api_key"])

    def test_every_hardening_switch_comes_in_order_before_the_first_image(self):
        one = self.sb.write_png(os.path.join(self.sb.home, "Pictures", "one.png"), color=(1, 2, 3))
        two = self.sb.write_png(os.path.join(self.sb.home, "Pictures", "two.png"), color=(3, 2, 1))
        self.codex(extra=("--ref", one, "--ref", two))
        argv = self.exec_call()["argv"]
        start = argv.index("-C") + 2                                   # right after the work folder ...
        self.assertEqual(argv[start:start + len(HARDEN_ARGS)], HARDEN_ARGS)
        first_image = argv.index("-i")                                 # ... and before the first -i
        self.assertEqual(first_image, start + len(HARDEN_ARGS))
        self.assertEqual(argv[first_image::2][:2], ["-i", "-i"])
        self.assertEqual(argv[-2:], ["--", "-"])
        self.assertEqual(argv[:7], ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "-C"])
        # the same list, switch by switch: what is switched off, and what must stay on
        switched_off = [argv[i + 1] for i, token in enumerate(argv) if token == "--disable"]
        self.assertEqual(switched_off, ["shell_tool", "unified_exec", "unified_exec_tty", "computer_use", "browser_use",
                                        "browser_use_external", "browser_use_full_cdp_access", "in_app_browser",
                                        "view_image", "apps", "plugins", "multi_agent", "goals", "sleep_tool"])
        for needed in ("code_mode_host", "skill_search", "image_generation"):
            self.assertNotIn(needed, argv)                              # picture making depends on these
        self.assertEqual([argv[i + 1] for i, token in enumerate(argv) if token == "-c"], ['web_search="disabled"'])

    def test_none_of_the_forbidden_flags_are_ever_given(self):
        one = self.sb.write_png(os.path.join(self.sb.home, "Pictures", "one.png"))
        self.codex(extra=("--ref", one))
        argv = self.exec_call()["argv"]
        for token in argv:
            for banned in ("dangerously", "danger-full-access", "approve-for-me", "bypass", "full-auto", "--enable",
                           "workspace-write", "--search", "--yolo"):
                self.assertNotIn(banned, token)
        self.assertEqual(argv.count("-s"), 1)
        self.assertEqual(argv[argv.index("-s") + 1], "read-only")
        for source in (desk_art.build_codex_argv("/bin/codex", "/w", []),
                       desk_art.build_codex_argv("/bin/codex", "/w", ["/x/a.png"])):
            self.assertEqual(source[1:9], ["exec", "--json", "--ephemeral", "--skip-git-repo-check", "-s", "read-only",
                                           "-C", "/w"])

    def test_the_wrapper_asks_for_pictures_only(self):
        self.assertEqual(desk_art.CODEX_WRAPPER, WRAPPER_TEXT)
        self.assertNotIn("image viewer", desk_art.CODEX_WRAPPER)       # the viewer tool is switched off
        self.assertNotIn("look at them first", desk_art.CODEX_WRAPPER)
        self.assertTrue(desk_art.CODEX_WRAPPER.isascii())

    def test_a_switch_that_codex_no_longer_knows_fails_loudly_and_says_what_to_do(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "unknownflag"})
        self.assert_failure(result, "codex-failed")
        self.assertIn("Unknown feature flag", result.data["error"])
        self.assertIn("desk-art needs an update", result.data["hint"])
        self.assertEqual(self.sb.manifest(), [])

    def test_the_error_text_is_the_end_of_a_long_stderr(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "bigstderr"})
        self.assert_failure(result, "codex-failed")
        self.assertIn("FATAL: the real reason is at the end", result.data["error"])
        self.assertLessEqual(len(result.data["error"]), 400)
        self.assertNotIn("progress 00000", result.data["error"])

    def test_tail_text_folds_white_space_first_and_keeps_the_end(self):
        data = b"word1 word2   word3\n\n  word4\tword5"
        folded = "word1 word2 word3 word4 word5"
        self.assertEqual(desk_art.tail_text(data, 400), folded)
        self.assertEqual(desk_art.tail_text(data, 11), folded[-11:])
        self.assertEqual(desk_art.tail_text(b"", 400), "")
        self.assertEqual(desk_art.tail_text(("noise " * 1000 + "THE END").encode()), ("noise " * 1000 + "THE END")[-400:])

    def test_the_codex_home_variable_is_honoured_when_there_is_no_test_override(self):
        elsewhere = self.sb.make_dir("elsewhere-codex-home")
        result = self.codex(env={"DESK_ART_CODEX_HOME": "", "CODEX_HOME": elsewhere})
        self.assertEqual(result.code, 0, result.out)
        (image,) = result.data["images"]
        self.assertTrue(image["source"].startswith(os.path.join(elsewhere, "generated_images")), image["source"])
        self.assertFalse(os.path.isdir(os.path.join(self.sb.codex_home, "generated_images")))
        self.assertEqual(result.data["matchedBy"], "thread-folder")

    def test_codex_home_is_chosen_in_a_fixed_order_and_ingest_follows_it(self):
        with mock.patch.dict(os.environ, {"DESK_ART_HOME": self.sb.home}, clear=True):
            self.assertEqual(desk_art.codex_home(), os.path.join(self.sb.home, ".codex"))
            os.environ["CODEX_HOME"] = "/somewhere/else/codex"
            self.assertEqual(desk_art.codex_home(), "/somewhere/else/codex")
            os.environ["DESK_ART_CODEX_HOME"] = "/the/test/override"
            self.assertEqual(desk_art.codex_home(), "/the/test/override")           # the test override wins
            os.environ["DESK_ART_CODEX_HOME"] = ""
            self.assertEqual(desk_art.codex_home(), "/somewhere/else/codex")         # empty means not set
        elsewhere = self.sb.make_dir("elsewhere-codex-home")
        picture = self.sb.write_png(os.path.join(elsewhere, "generated_images", "t1", "exec-1.png"), color=(5, 6, 7))
        with mock.patch.dict(os.environ, self.sb.env(DESK_ART_CODEX_HOME="", CODEX_HOME=elsewhere), clear=True):
            self.assertEqual(desk_art.ingest_sources()[0], os.path.join(elsewhere, "generated_images"))
        result = self.cli("ingest", "--label", "pic", "--backend", "codex", "--file", picture,
                          env={"DESK_ART_CODEX_HOME": "", "CODEX_HOME": elsewhere})
        self.assertEqual(result.code, 0, result.out)                 # a picture outside home, in codex's own folder

    def test_references_are_attached_with_dash_i_and_the_prompt_stays_on_stdin(self):
        """Codex is given private copies (ref1.png, ref2.jpg), never the caller's own paths."""
        one = self.sb.write_png(os.path.join(self.sb.home, "Pictures", "one.png"), color=(1, 2, 3))
        two = self.sb.write_file(os.path.join(self.sb.home, "Pictures", "two.jpg"), jpeg_bytes())
        data = self.codex("same character, new pose", extra=("--ref", one, "--ref", two)).data
        call = self.exec_call()
        work = os.path.join(self.sb.cache, "jobs", data["jobId"], "work")
        staged = [os.path.join(work, "refs", "ref1.png"), os.path.join(work, "refs", "ref2.jpg")]
        self.assertEqual(call["argv"], codex_argv(work, *staged))
        self.assertEqual(call["images"], staged)
        self.assertEqual(call["positional"], ["-"])
        self.assertTrue(call["prompt"].endswith("same character, new pose"))
        shas = [desk_art.sha256_file(one), desk_art.sha256_file(two)]
        self.assertEqual([info["sha256"] for info in call["image_info"]], shas)         # the very bytes that were checked
        (entry,) = self.sb.manifest()
        self.assertEqual(entry["refs"], [{"name": "one.png", "sha256": shas[0]}, {"name": "two.jpg", "sha256": shas[1]}])
        self.assertEqual(desk_art.sha256_file(one), shas[0])                              # the originals are not modified
        self.assertEqual(data["refsSent"], [{"name": "one.png", "sha8": shas[0][:8], "bytes": os.path.getsize(one)},
                                            {"name": "two.jpg", "sha8": shas[1][:8], "bytes": os.path.getsize(two)}])

    def test_a_symlinked_reference_is_staged_from_the_file_it_leads_to(self):
        real = self.sb.write_png(os.path.join(self.sb.home, "Pictures", "real.png"))
        link = os.path.join(self.sb.home, "Pictures", "link.png")
        os.symlink(real, link)
        data = self.codex(extra=("--ref", link)).data
        work = os.path.join(self.sb.cache, "jobs", data["jobId"], "work")
        call = self.exec_call()
        self.assertEqual(call["images"], [os.path.join(work, "refs", "ref1.png")])
        self.assertEqual(call["image_info"][0]["sha256"], desk_art.sha256_file(real))
        self.assertEqual(self.sb.manifest()[0]["refs"][0]["name"], "link.png")             # the name the caller used

    def test_two_images_numbered_by_file_time(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "two"})
        self.assertEqual(result.code, 0, result.out)
        images = result.data["images"]
        self.assertEqual(len(images), 2)
        self.assertIn("_codex_01_", images[0]["path"])
        self.assertIn("_codex_02_", images[1]["path"])
        self.assertTrue(images[0]["source"].endswith("exec-zzz.png"))     # older file gets 01
        self.assertTrue(images[1]["source"].endswith("exec-aaa.png"))
        self.assertEqual(len(self.sb.manifest()), 2)

    def test_refusal_returns_the_agents_words(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "refusal"})
        self.assert_failure(result, "codex-no-images")
        self.assertEqual(result.data["finalMessage"], "I can't make that picture.")
        self.assertRegex(result.data["threadId"], r"^[0-9a-f-]{36}$")
        self.assertTrue(os.path.isdir(result.data["jobDir"]))             # kept on failure, and reported
        self.assertEqual(self.sb.manifest(), [])

    def test_error_event(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "error"})
        self.assert_failure(result, "codex-failed")
        self.assertIn("stream disconnected before completion", result.data["error"])
        self.assertTrue(os.path.isdir(result.data["jobDir"]))

    def test_error_text_is_cut_to_400_characters(self):
        events = desk_art.parse_codex_events(json.dumps({"type": "error", "message": "x" * 900}).encode())
        self.assertEqual(len(events["error"]), 400)

    def test_a_transient_error_event_followed_by_a_finished_turn_is_a_success(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "transient"})
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(len(result.data["images"]), 1)

    def test_a_retry_notice_is_kept_in_the_message_when_codex_finishes_without_a_picture(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "transient-noimage"})
        self.assert_failure(result, "codex-no-images")
        self.assertIn("Reconnecting... 1/5", result.data["error"])
        self.assertEqual(result.data["finalMessage"], "Done.")

    def test_nonzero_exit_without_events_reports_stderr(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "silentfail"})
        self.assert_failure(result, "codex-failed")
        self.assertIn("the model is unavailable", result.data["error"])

    def test_lines_that_are_not_json_are_ignored(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "noise"})
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["finalMessage"], "Done.")

    def test_not_logged_in_never_starts_a_run(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "loggedout"})
        self.assert_failure(result, "codex-not-logged-in")
        self.assertIn("ChatGPT app", result.data["hint"])
        self.assertEqual(self.sb.calls(self.sb.codex_log, "exec"), [])

    def test_login_text_on_stdout_or_stderr_both_count(self):
        for stream in ("stdout", "stderr"):
            result = self.codex(env={"FAKE_CODEX_LOGIN": stream})
            self.assertEqual(result.code, 0, stream)

    def test_unreadable_login_text_does_not_block_a_run(self):
        result = self.codex(env={"FAKE_CODEX_LOGIN": "garbage"})
        self.assertEqual(result.code, 0, result.out)

    def test_binary_missing(self):
        result = self.codex(env={"DESK_ART_CODEX": os.path.join(self.sb.root, "nowhere")})
        self.assert_failure(result, "codex-not-found")

    def test_binary_is_found_in_an_app_bundle_when_not_on_the_path(self):
        bundle = os.path.join(self.sb.apps, "ChatGPT.app", "Contents", "Resources", "codex-cli", "bin")
        os.makedirs(bundle)
        shutil.copyfile(self.sb.codex, os.path.join(bundle, "codex"))
        os.chmod(os.path.join(bundle, "codex"), 0o755)
        env = self.sb.env()
        del env["DESK_ART_CODEX"]
        env["PATH"] = "/usr/bin:/bin"
        with mock.patch.dict(os.environ, env, clear=True):
            self.assertEqual(desk_art.find_codex(), os.path.join(bundle, "codex"))

    def test_old_pictures_and_other_folders_are_not_taken_when_the_threads_own_folder_is_empty(self):
        """The run named its thread, so only that folder counts. A picture that appeared in another folder during
        the run (here 'other-<thread>') belongs to somebody else, and an old one was never this run's."""
        self.sb.write_png(os.path.join(self.sb.codex_home, "generated_images", "old-thread", "exec-old.png"),
                          color=(9, 9, 9), age=3600)
        result = self.codex(env={"FAKE_CODEX_MODE": "wrongthread"})
        self.assert_failure(result, "codex-no-images")
        self.assertEqual(result.data["finalMessage"], "Done.")
        self.assertRegex(result.data["threadId"], r"^[0-9a-f-]{36}$")
        self.assertEqual(self.sb.manifest(), [])
        self.assertEqual(self.sb.filed_files(), [])

    def test_a_run_that_never_named_its_thread_is_matched_by_comparing_folders(self):
        old = self.sb.write_png(os.path.join(self.sb.codex_home, "generated_images", "old-thread", "exec-old.png"),
                                color=(9, 9, 9), age=3600)
        result = self.codex(env={"FAKE_CODEX_MODE": "nothread"})
        self.assertEqual(result.code, 0, result.out)
        self.assertIsNone(result.data["threadId"])
        self.assertEqual(result.data["matchedBy"], "folder-diff")
        (image,) = result.data["images"]
        self.assertTrue(image["source"].endswith(os.path.join("loose", "exec-nothread.png")))
        self.assertNotEqual(image["source"], old)

    def test_a_picture_a_parallel_run_leaves_during_this_run_is_not_taken(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "stray"})
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["matchedBy"], "thread-folder")
        (image,) = result.data["images"]
        self.assertTrue(image["source"].endswith(os.path.join(result.data["threadId"], "exec-own.png")))
        self.assertEqual(len(self.sb.manifest()), 1)

    def test_ingesting_a_copy_of_a_codex_picture_is_marked_as_a_duplicate(self):
        first = self.codex().data["images"][0]
        shutil.copyfile(first["source"], first["source"] + ".copy.png")
        os.utime(first["source"] + ".copy.png", (time.time() - 20, time.time() - 20))
        listing = self.cli("ingest", "--label", "hero", "--backend", "codex", "--file", first["source"] + ".copy.png")
        self.assertTrue(listing.data["images"][0]["duplicate"])

    def test_timeout_stops_the_whole_process_group(self):
        pids = os.path.join(self.sb.root, "pids")
        code, result = self.inproc(
            "codex", "--inbox", self.sb.inbox, "--label", "slow", "--prompt-stdin", "--timeout", "1",
            stdin="a prompt", env={"FAKE_CODEX_MODE": "timeout", "FAKE_CODEX_PIDS": pids},
            MIN_TIMEOUT=1.0, KILL_GRACE_SEC=3.0)
        self.assertEqual((code, result["code"]), (2, "codex-timeout"))
        self.assertTrue(os.path.isdir(result["jobDir"]))
        folder = os.path.join(self.sb.codex_home, "generated_images", result["threadId"])
        self.assertEqual((result["threadFolder"], result["madePictures"]), (folder, []))
        self.assertIn("no picture had appeared", result["hint"])
        with open(pids) as handle:
            leader, child = [int(n) for n in handle.read().split()]
        self.assert_alive_not(leader)
        self.assert_alive_not(child)

    def test_a_timeout_points_at_the_pictures_codex_made_before_it_was_stopped(self):
        code, result = self.inproc(
            "codex", "--inbox", self.sb.inbox, "--label", "slow", "--prompt-stdin", "--timeout", "1",
            stdin="a prompt", env={"FAKE_CODEX_MODE": "timeout-picture"}, MIN_TIMEOUT=1.0, KILL_GRACE_SEC=3.0)
        self.assertEqual((code, result["code"]), (2, "codex-timeout"))
        folder = os.path.join(self.sb.codex_home, "generated_images", result["threadId"])
        self.assertEqual(result["threadFolder"], folder)
        self.assertEqual(result["madePictures"], [os.path.join(folder, "exec-before-the-stop.png")])
        self.assertIn("ingest", result["hint"])
        self.assertIn(folder, result["hint"])
        self.assertEqual(self.sb.manifest(), [])                                    # listed, never filed on its own

    def test_a_timeout_without_a_thread_says_to_ask_the_owner_before_listing_the_shared_folder(self):
        events = {"thread_id": None, "message": None, "usage": None, "error": None, "completed": False}
        stopped = desk_art.ProcResult(None, b"", b"", True, None)
        failure = desk_art.codex_problem(stopped, events, 540.0, os.path.join(self.sb.codex_home, "generated_images"),
                                         {"jobId": "j"})
        self.assertEqual(failure.code, "codex-timeout")
        self.assertNotIn("threadFolder", failure.extra)
        self.assertNotIn("madePictures", failure.extra)
        self.assertIn("ask the owner before you list that folder", failure.extra["hint"])
        self.assertEqual(failure.extra["jobId"], "j")

    def test_a_failed_run_points_at_the_pictures_it_made_before_it_failed(self):
        """A finished picture may already exist, so running again would only spend the allowance twice."""
        result = self.codex(env={"FAKE_CODEX_MODE": "failafter"})
        self.assert_failure(result, "codex-failed")
        self.assertIn("stream disconnected", result.data["error"])
        folder = os.path.join(self.sb.codex_home, "generated_images", result.data["threadId"])
        made = os.path.join(folder, "exec-made-then-failed.png")
        self.assertEqual((result.data["threadFolder"], result.data["madePictures"]), (folder, [made]))
        self.assertIn("ingest", result.data["hint"])
        self.assertEqual(self.sb.manifest(), [])                                    # listed, never filed on its own
        filed = self.cli("ingest", "--label", "saved", "--backend", "codex", "--file", made)   # the hint is true
        self.assertEqual(filed.code, 0, filed.out)

    def test_a_failure_before_any_thread_has_no_thread_folder(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "silentfail"})
        self.assert_failure(result, "codex-failed")
        self.assertNotIn("threadFolder", result.data)
        self.assertNotIn("madePictures", result.data)
        self.assertIsNone(result.data["threadId"])

    def test_a_process_that_ignores_sigterm_is_killed(self):
        pids = os.path.join(self.sb.root, "pids")
        started = time.time()
        code, result = self.inproc(
            "codex", "--inbox", self.sb.inbox, "--label", "slow", "--prompt-stdin", "--timeout", "1",
            stdin="a prompt", env={"FAKE_CODEX_MODE": "stubborn", "FAKE_CODEX_PIDS": pids},
            MIN_TIMEOUT=1.0, KILL_GRACE_SEC=1.0)
        self.assertEqual(result["code"], "codex-timeout")
        self.assertLess(time.time() - started, 20)
        with open(pids) as handle:
            leader, child = [int(n) for n in handle.read().split()]
        self.assert_alive_not(leader)
        self.assert_alive_not(child)

    def test_stopping_the_helper_stops_codex(self):
        pids = os.path.join(self.sb.root, "pids")
        env = self.sb.env(FAKE_CODEX_MODE="timeout", FAKE_CODEX_PIDS=pids)
        prompt_file = os.path.join(self.sb.root, "prompt.txt")
        with open(prompt_file, "w") as handle:
            handle.write("a prompt")
        with open(prompt_file, "rb") as stdin_handle:
            helper = subprocess.Popen([PYTHON, HELPER, "codex", "--label", "slow", "--prompt-stdin"], env=env,
                                      stdin=stdin_handle, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        deadline = time.time() + 30
        while not os.path.exists(pids) and time.time() < deadline:
            time.sleep(0.1)
        self.assertTrue(os.path.exists(pids))
        time.sleep(0.3)
        helper.send_signal(signal.SIGTERM)
        out, _ = helper.communicate(timeout=30)
        self.assertEqual(helper.returncode, 1)
        self.assertEqual(json.loads(out)["code"], "internal")
        with open(pids) as handle:
            leader, child = [int(n) for n in handle.read().split()]
        self.assert_alive_not(leader)
        self.assert_alive_not(child)

    def test_prompt_never_appears_in_output(self):
        secret = "SECRET-PROMPT-WORDS-98765"
        for mode in ("one", "refusal", "error", "loggedout"):
            result = self.codex(secret, env={"FAKE_CODEX_MODE": mode})
            self.assertNotIn(secret, result.out + result.err, mode)
        bad = self.cli("codex", "--label", "Bad Label", "--prompt-stdin", stdin=secret)
        self.assertNotIn(secret, bad.out + bad.err)
        for mode in ("one", "none", "exit1", "statuserror"):
            result = self.agy(secret, env={"FAKE_AGY_MODE": "workdir" if mode == "one" else mode})
            self.assertNotIn(secret, result.out + result.err, mode)
        stray = self.cli("codex", "--label", "a", "--prompt-stdin", "stray-word", stdin=secret)
        self.assertNotIn(secret, stray.out + stray.err)

    def test_prompt_never_appears_when_something_unexpected_goes_wrong(self):
        """The traceback goes to stderr; it holds source lines and the error text, never the prompt."""
        secret = "SECRET-PROMPT-WORDS-24680"

        def boom(*args, **kwargs):
            raise RuntimeError("something odd")
        for command in ("codex", "agy"):
            for target in ("make_job", "run_process", "file_images"):
                captured = io.StringIO()
                code, result = self.inproc(command, "--inbox", self.sb.inbox, "--label", "a", "--prompt-stdin",
                                           stdin=secret, capture=captured, **{target: boom})
                self.assertEqual((code, result["code"]), (1, "internal"), (command, target))
                self.assertIn("Traceback", captured.getvalue())                     # it really was printed
                self.assertNotIn(secret, json.dumps(result) + captured.getvalue(), (command, target))


# ---------------------------------------------------------------------------
# Antigravity CLI (against a fake only)
# ---------------------------------------------------------------------------

class AgyTests(SandboxCase):
    def call(self):
        calls = self.sb.calls(self.sb.agy_log)
        self.assertEqual(len(calls), 1)
        return calls[0]

    def test_success_through_the_work_folder(self):
        prompt = "a boy in a school uniform, flat green background"
        result = self.agy(prompt, label="boy")
        self.assertEqual(result.code, 0, result.out + result.err)
        data = result.data
        self.assertEqual((data["backend"], data["agentStatus"], data["finalMessage"]), ("agy", "success", "Made it."))
        self.assertRegex(data["conversationId"], r"^conv-[0-9a-f]{8}$")
        (image,) = data["images"]
        self.assertRegex(os.path.basename(image["path"]), r"^boy_agy_01_[0-9a-f]{8}\.png$")
        self.assertIn(os.path.join("work", "out", "pic.png"), image["source"])
        (entry,) = self.sb.manifest()
        self.assertEqual((entry["backend"], entry["conversationId"], entry["prompt"]),
                         ("agy", data["conversationId"], prompt))
        self.assertFalse(os.path.exists(os.path.join(self.sb.cache, "jobs", data["jobId"])))

    def test_command_line_prompt_and_folder(self):
        data = self.agy("make it red").data
        call = self.call()
        work = os.path.join(self.sb.cache, "jobs", data["jobId"], "work")
        self.assertEqual(call["argv"][:3], ["--output-format", "json", "-p"])
        self.assertEqual(len(call["argv"]), 4)
        self.assertEqual(call["prompt"], desk_art.AGY_WRAPPER + "make it red")
        self.assertEqual(call["cwd"], work)
        self.assertFalse(call["has_api_key"])
        self.assertNotIn("dangerously", " ".join(call["argv"][:3]))

    def test_model_and_references(self):
        one = self.sb.write_png(os.path.join(self.sb.home, "Pictures", "one.png"), color=(5, 5, 5))
        two = self.sb.write_file(os.path.join(self.sb.home, "Pictures", "two.jpg"), jpeg_bytes())
        result = self.agy("same girl, new outfit", extra=("--model", "gemini-3-pro", "--ref", one, "--ref", two),
                          env={"GEMINI_API_KEY": "key", "GOOGLE_API_KEY": "key"})
        self.assertEqual(result.code, 0, result.out)
        call = self.call()
        self.assertEqual(call["argv"][:5], ["--output-format", "json", "--model", "gemini-3-pro", "-p"])
        self.assertEqual(call["model"], "gemini-3-pro")
        self.assertEqual(call["refs"], ["ref1.png", "ref2.jpg"])
        self.assertTrue(call["prompt"].endswith("same girl, new outfit\n\nREFERENCES:\n./refs/ref1.png\n./refs/ref2.jpg"))
        self.assertFalse(call["has_api_key"])
        (entry,) = self.sb.manifest()
        self.assertEqual(entry["model"], "gemini-3-pro")
        self.assertEqual([r["name"] for r in entry["refs"]], ["one.png", "two.jpg"])
        self.assertEqual(len(result.data["images"]), 1)          # the copied references are not results
        self.assertTrue(os.path.exists(one))

    def test_success_through_the_brain_folder(self):
        result = self.agy(env={"FAKE_AGY_MODE": "brain"})
        self.assertEqual(result.code, 0, result.out)
        (image,) = result.data["images"]
        self.assertEqual(image["format"], "jpeg")
        self.assertIn(os.path.join("antigravity-cli", "brain", result.data["conversationId"]), image["source"])
        self.assertTrue(image["path"].endswith(".jpg"))
        self.assertEqual(result.data["matchedBy"], "conversation-folder")

    def test_a_copy_of_a_reference_the_agent_left_in_its_folder_is_not_a_result(self):
        ref = self.sb.write_png(os.path.join(self.sb.home, "Pictures", "ref.png"), color=(9, 9, 9))
        result = self.agy(extra=("--ref", ref), env={"FAKE_AGY_MODE": "copyref"})
        self.assertEqual(result.code, 0, result.out)
        (image,) = result.data["images"]                                  # the new picture only
        self.assertTrue(image["path"].endswith(".jpg"))
        self.assertEqual(len(self.sb.manifest()), 1)

    def test_the_agents_log_copy_of_a_reference_is_not_a_result(self):
        ref = self.sb.write_png(os.path.join(self.sb.home, "Pictures", "ref.png"), color=(9, 9, 9))
        result = self.agy(extra=("--ref", ref), env={"FAKE_AGY_MODE": "viewlog"})
        self.assertEqual(result.code, 0, result.out)
        (image,) = result.data["images"]                                  # the real picture only, not the logged copy
        self.assertNotIn(".system_generated", image["source"])
        self.assertTrue(image["path"].endswith(".jpg"))
        self.assertEqual(len(self.sb.manifest()), 1)

    def test_a_run_that_only_copied_its_reference_made_nothing(self):
        ref = self.sb.write_png(os.path.join(self.sb.home, "Pictures", "ref.png"), color=(9, 9, 9))
        result = self.agy(extra=("--ref", ref), env={"FAKE_AGY_MODE": "copyref-only"})
        self.assert_failure(result, "agy-no-images")
        self.assertEqual(self.sb.manifest(), [])

    def test_success_through_the_desktop_apps_brain_folder_too(self):
        result = self.agy(env={"FAKE_AGY_MODE": "appbrain"})
        self.assertEqual(result.code, 0, result.out)
        (image,) = result.data["images"]
        self.assertIn(os.path.join("antigravity", "brain", result.data["conversationId"]), image["source"])
        self.assertEqual(result.data["matchedBy"], "conversation-folder")

    def test_the_same_picture_in_two_places_is_filed_once(self):
        result = self.agy(env={"FAKE_AGY_MODE": "both"})
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(len(result.data["images"]), 1)
        self.assertEqual(len(self.sb.manifest()), 1)

    def test_old_pictures_in_the_brain_folder_are_ignored(self):
        old = os.path.join(self.sb.gemini_home, "antigravity", "brain", "old-chat", "earlier_1700000000000.png")
        self.sb.write_png(old, color=(7, 7, 7), age=86400)
        result = self.agy(env={"FAKE_AGY_MODE": "none"})
        self.assert_failure(result, "agy-no-images")

    def test_only_picture_files_in_the_cli_folder_count_and_settings_are_never_opened(self):
        opened = []
        real_open = open

        def spy(path, *args, **kwargs):
            opened.append(str(path))
            return real_open(path, *args, **kwargs)
        with mock.patch("builtins.open", spy):
            code, result = self.inproc("agy", "--inbox", self.sb.inbox, "--label", "cli", "--prompt-stdin",
                                       stdin="x", env={"FAKE_AGY_MODE": "cli", "FAKE_AGY_NOID": "1"})
        self.assertEqual(code, 0, result)
        self.assertEqual(len(result["images"]), 1)
        self.assertTrue(result["images"][0]["source"].endswith(os.path.join("antigravity-cli", "cache", "preview.png")))
        self.assertTrue(os.path.exists(os.path.join(self.sb.gemini_home, "antigravity-cli", "settings.json")))
        self.assertEqual([p for p in opened if p.endswith("settings.json")], [])

    def test_no_images(self):
        result = self.agy(env={"FAKE_AGY_MODE": "none"})
        self.assert_failure(result, "agy-no-images")
        self.assertEqual(result.data["finalMessage"], "Made it.")
        self.assertIn("denied in headless mode", result.data["error"])
        self.assertTrue(os.path.isdir(result.data["jobDir"]))

    def test_error_status_in_the_envelope(self):
        result = self.agy(env={"FAKE_AGY_MODE": "statuserror"})
        self.assert_failure(result, "agy-failed")
        self.assertIn("quota exceeded", result.data["error"])

    def test_nonzero_exit(self):
        result = self.agy(env={"FAKE_AGY_MODE": "exit1"})
        self.assert_failure(result, "agy-failed")
        self.assertIn("not signed in", result.data["error"])

    def test_text_around_the_json_envelope(self):
        result = self.agy(env={"FAKE_AGY_MODE": "noise"})
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["finalMessage"], "Made it.")

    def test_not_installed_says_how_to_install_but_installs_nothing(self):
        result = self.agy(env={"DESK_ART_AGY": os.path.join(self.sb.root, "none")})
        self.assert_failure(result, "agy-not-installed")
        self.assertIn("curl -fsSL https://antigravity.google/cli/install.sh | bash", result.data["error"])
        self.assertEqual(self.sb.calls(self.sb.agy_log), [])
        self.assertFalse(os.path.exists(os.path.join(self.sb.cache, "jobs")))

    def test_the_install_text_says_only_what_is_known_about_the_installer(self):
        """The installer's last step runs `agy install`; what that changes is not documented (contract CORRECTIONS 2)."""
        gone = {"DESK_ART_AGY": os.path.join(self.sb.root, "none")}
        error = self.agy(env=gone).data["error"]
        note = " ".join(self.cli("status", env=gone).data["notes"])
        for text in (error, note):
            self.assertIn("agy install", text)
            self.assertIn("Google does not say", text)
            self.assertIn("explicit yes", text)
            self.assertNotIn("installer edits", text)
            self.assertNotIn("--skip", text)
            self.assertNotIn("only the binary", text)
        self.assertLess(len(error), 400)                       # the TS layer shows 400 characters of it

    def test_timeout(self):
        pids = os.path.join(self.sb.root, "agy-pids")
        code, result = self.inproc("agy", "--inbox", self.sb.inbox, "--label", "slow", "--prompt-stdin",
                                   "--timeout", "1", stdin="x",
                                   env={"FAKE_AGY_MODE": "timeout", "FAKE_AGY_PIDS": pids},
                                   MIN_TIMEOUT=1.0, KILL_GRACE_SEC=3.0)
        self.assertEqual((code, result["code"]), (2, "agy-timeout"))
        with open(pids) as handle:
            leader, child = [int(n) for n in handle.read().split()]
        self.assert_alive_not(leader)
        self.assert_alive_not(child)

    def test_envelope_parsing(self):
        parse = desk_art.parse_agy_envelope
        self.assertEqual(parse('{"status": "ok", "usage": {"a": 1}}'), {"status": "ok", "usage": {"a": 1}})
        self.assertEqual(parse('hello {not json} \n{"status": "ok", "x": {"y": 2}}\nbye')["x"], {"y": 2})
        self.assertEqual(parse('{"n": 1}\n{"n": 2}')["n"], 2)
        self.assertIsNone(parse("no json here"))
        self.assertIsNone(parse(""))

    def test_envelope_parsing_survives_hostile_text_and_stays_fast(self):
        parse = desk_art.parse_agy_envelope
        self.assertIsNone(parse("[" * 300000))                                  # too deep for the JSON reader
        self.assertEqual(parse("[" * 300000 + '\n{"status": "ok"}')["status"], "ok")
        self.assertEqual(parse('{"n": ' + "9" * 600000 + '}')["n"], 0)          # a huge integer is not converted
        started = time.time()
        self.assertIsNone(parse('{"a":' * 100000))                              # 100000 places that fail one by one
        self.assertLess(time.time() - started, 2.5)

    def test_matched_by_says_where_the_pictures_were_found(self):
        self.assertEqual(self.agy(env={"FAKE_AGY_MODE": "workdir"}).data["matchedBy"], "work-folder")
        self.assertEqual(self.agy(env={"FAKE_AGY_MODE": "brain"}).data["matchedBy"], "conversation-folder")
        wide = self.agy(env={"FAKE_AGY_MODE": "workdir", "FAKE_AGY_NOID": "1"}).data
        self.assertEqual(wide["matchedBy"], "folder-diff")
        self.assertIsNone(wide["conversationId"])

    def test_with_a_conversation_id_a_picture_saved_for_the_owner_meanwhile_is_not_taken(self):
        """The Antigravity app may be saving pictures into brain/ at the same time (agy-union-diff-desktop-app)."""
        result = self.agy(env={"FAKE_AGY_MODE": "stranger"})
        self.assert_failure(result, "agy-no-images")
        self.assertIn("work folder or its conversation folder", result.data["error"])
        self.assertEqual(self.sb.manifest(), [])
        mixed = self.agy(env={"FAKE_AGY_MODE": "workdir", "FAKE_AGY_ALSO_STRANGER": "1"})
        self.assertEqual(mixed.code, 0, mixed.out)
        (image,) = mixed.data["images"]
        self.assertIn(os.path.join("work", "out", "pic.png"), image["source"])
        self.assertEqual(mixed.data["matchedBy"], "work-folder")

    def test_without_a_conversation_id_the_wide_comparison_is_used_and_says_so(self):
        result = self.agy(env={"FAKE_AGY_MODE": "stranger", "FAKE_AGY_NOID": "1"})
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["matchedBy"], "folder-diff")
        self.assertIn("owners-own-chat", result.data["images"][0]["source"])
        empty = self.agy(env={"FAKE_AGY_MODE": "none", "FAKE_AGY_NOID": "1"})
        self.assert_failure(empty, "agy-no-images")
        self.assertIn("in the folders compared", empty.data["error"])

    def test_a_line_nested_too_deep_before_the_envelope_does_not_stop_a_run(self):
        result = self.agy(env={"FAKE_AGY_MODE": "deepjson"})
        self.assertEqual(result.code, 0, result.out[:300])
        self.assertEqual((len(result.data["images"]), result.data["finalMessage"]), (1, "Made it."))

    def test_a_long_reply_is_cut_to_2000_characters(self):
        result = self.agy(env={"FAKE_AGY_MODE": "bigreply"})
        self.assertEqual(result.code, 0, result.out[:300])
        self.assertEqual(result.data["finalMessage"], "R" * 2000)

    def test_one_call_files_at_most_sixteen_pictures_and_the_rest_can_be_filed_later(self):
        result = self.agy(env={"FAKE_AGY_MODE": "many"})
        self.assertEqual(result.code, 0, result.out[:300])
        self.assertEqual(len(result.data["images"]), 16)
        self.assertEqual(result.data["skipped"], 4)
        self.assertIn("16", result.data["skippedHint"])
        self.assertIn("ingest", result.data["skippedHint"])
        self.assertEqual(len(self.sb.manifest()), 16)
        self.assertTrue(os.path.isdir(result.data["jobDir"]))                    # kept, because pictures are left in it
        leftovers = sorted(os.path.join(result.data["jobDir"], "work", "out", "pic%02d.png" % n) for n in range(16, 20))
        for path in leftovers:
            self.assertTrue(os.path.isfile(path), path)
        later = self.cli("ingest", "--label", "rest", "--backend", "agy", *sum((["--file", p] for p in leftovers), []))
        self.assertEqual(later.code, 0, later.out)
        self.assertEqual(len(later.data["images"]), 4)

    def test_references_are_private_copies_that_are_deleted_after_the_run(self):
        one = self.sb.write_png(os.path.join(self.sb.home, "Pictures", "kaito, one.png"), color=(5, 5, 5))
        two = self.sb.write_file(os.path.join(self.sb.home, "Pictures", "two.jpg"), jpeg_bytes())
        result = self.agy(extra=("--ref", one, "--ref", two), env={"FAKE_AGY_MODE": "none"})
        self.assert_failure(result, "agy-no-images")
        call = self.call()
        shas = [desk_art.sha256_file(one), desk_art.sha256_file(two)]
        self.assertEqual((call["refs"], call["ref_sha256"], call["ref_modes"]),
                         (["ref1.png", "ref2.jpg"], shas, ["0o600", "0o600"]))
        self.assertTrue(call["prompt"].endswith("REFERENCES:\n./refs/ref1.png\n./refs/ref2.jpg"))
        self.assertEqual(result.data["refsSent"], [{"name": "kaito, one.png", "sha8": shas[0][:8], "bytes": os.path.getsize(one)},
                                                   {"name": "two.jpg", "sha8": shas[1][:8], "bytes": os.path.getsize(two)}])
        self.assertTrue(os.path.isdir(result.data["jobDir"]))                    # the failed run's folder stays ...
        self.assertTrue(os.path.isdir(os.path.join(result.data["jobDir"], "work")))
        self.assertFalse(os.path.exists(os.path.join(result.data["jobDir"], "work", "refs")))      # ... without the copies


# ---------------------------------------------------------------------------
# ingest
# ---------------------------------------------------------------------------

class IngestTests(SandboxCase):
    def ingest(self, *files, **options):
        args = ["ingest", "--label", "pic", "--backend", options.get("backend", "codex")]
        for path in files:
            args += ["--file", path]
        return self.cli(*args, *self.root_args(), *options.get("extra", ()))

    def test_files_from_home_are_accepted(self):
        path = self.sb.write_png(os.path.join(self.sb.home, "Desktop", "from-gemini.png"))
        result = self.ingest(path, backend="gemini-app")
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(len(result.data["images"]), 1)

    def test_the_two_generator_folders_are_allowed_sources(self):
        codex_file = self.sb.write_png(os.path.join(self.sb.codex_home, "generated_images", "t1", "exec-1.png"),
                                       color=(1, 2, 3))
        brain_file = self.sb.write_file(os.path.join(self.sb.gemini_home, "antigravity", "brain", "c1", "x_1.jpg"),
                                        jpeg_bytes())
        cli_brain_file = self.sb.write_file(os.path.join(self.sb.gemini_home, "antigravity-cli", "brain", "c2", "x_2.jpg"),
                                            jpeg_bytes(width=7))
        result = self.ingest(codex_file, brain_file, cli_brain_file)
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(sorted(i["format"] for i in result.data["images"]), ["jpeg", "jpeg", "png"])

    def test_other_files_in_hidden_folders_are_refused_and_never_opened(self):
        auth = os.path.join(self.sb.codex_home, "auth.json")
        with open(auth, "w") as handle:
            handle.write('{"token": "AUTH-MARKER"}')
        cli_png = self.sb.write_png(os.path.join(self.sb.gemini_home, "antigravity-cli", "x.png"))
        config_png = self.sb.write_png(os.path.join(self.sb.gemini_home, "config", "x.png"), color=(8, 8, 8))
        sibling = self.sb.write_png(os.path.join(self.sb.codex_home, "other", "x.png"), color=(4, 4, 4))
        escape = os.path.join(self.sb.codex_home, "generated_images", "..", "auth.json")
        link = os.path.join(self.sb.codex_home, "generated_images", "link.png")
        os.makedirs(os.path.dirname(link), exist_ok=True)
        os.symlink(auth, link)
        opened = []
        real_open = open

        def spy(path, *args, **kwargs):
            opened.append(str(path))
            return real_open(path, *args, **kwargs)
        for bad in (auth, cli_png, config_png, sibling, escape, link):
            with mock.patch("builtins.open", spy):
                code, result = self.inproc("ingest", "--inbox", self.sb.inbox, "--label", "pic",
                                           "--backend", "codex", "--file", bad)
            self.assertEqual((code, result["code"]), (2, "bad-input"), bad)
            self.assertNotIn("AUTH-MARKER", json.dumps(result))
        self.assertEqual([p for p in opened if "auth.json" in p], [])
        self.assertEqual(self.sb.manifest(), [])

    def test_unsafe_or_unusable_files_are_refused(self):
        outside = self.sb.write_png(os.path.join(self.sb.outside, "o.png"))
        library = self.sb.write_png(os.path.join(self.sb.home, "Library", "Caches", "x.png"))
        hidden = self.sb.write_png(os.path.join(self.sb.home, ".config", "x.png"))
        text = self.sb.write_file(os.path.join(self.sb.home, "Desktop", "t.png"), b"hello")
        folder = os.path.join(self.sb.home, "Desktop")
        missing = os.path.join(self.sb.home, "Desktop", "missing.png")
        link = os.path.join(self.sb.home, "Desktop", "link.png")
        os.symlink(outside, link)
        for bad in (outside, library, hidden, text, folder, missing, link):
            self.assert_failure(self.ingest(bad), "bad-input")

    def test_links_into_hidden_folders_are_never_sources_not_even_inside_the_allowed_folders(self):
        hidden = self.sb.write_png(os.path.join(self.sb.home, ".ssh", "key.png"), color=(1, 1, 1))
        generated = os.path.join(self.sb.codex_home, "generated_images")
        os.makedirs(generated)
        os.symlink(hidden, os.path.join(generated, "linked.png"))                      # a file link
        os.symlink(os.path.join(self.sb.home, ".ssh"), os.path.join(generated, "thread-link"))   # a folder link
        desktop_link = os.path.join(self.sb.home, "Desktop", "dirlink")
        os.makedirs(os.path.dirname(desktop_link), exist_ok=True)
        os.symlink(os.path.join(self.sb.home, ".ssh"), desktop_link)
        for bad in (os.path.join(generated, "linked.png"), os.path.join(generated, "thread-link", "key.png"),
                    os.path.join(desktop_link, "key.png")):
            self.assert_failure(self.ingest(bad), "bad-input")
        self.assertEqual(self.sb.manifest(), [])

    def test_one_bad_file_fails_the_whole_call_and_nothing_is_filed(self):
        good = self.sb.write_png(os.path.join(self.sb.home, "Desktop", "good.png"))
        bad = self.sb.write_file(os.path.join(self.sb.home, "Desktop", "bad.png"), b"not a picture")
        result = self.ingest(good, bad)
        self.assert_failure(result, "bad-input")
        self.assertIn("bad.png", result.data["error"])
        self.assertEqual(self.sb.manifest(), [])
        self.assertEqual(self.sb.filed_files(), [])

    def test_count_limits(self):
        paths = [self.sb.write_png(os.path.join(self.sb.home, "Desktop", "p%d.png" % n), color=(n, 0, 0))
                 for n in range(17)]
        self.assertEqual(self.ingest(*paths[:16]).code, 0)
        self.assert_failure(self.ingest(*paths), "bad-input")
        self.assert_failure(self.cli("ingest", "--label", "pic", "--backend", "codex"), "usage", 3)

    def test_note_and_backend_rules(self):
        path = self.sb.write_png(os.path.join(self.sb.home, "Desktop", "n.png"))
        self.assert_failure(self.ingest(path, extra=("--note", "n" * 301)), "bad-input")
        self.assertEqual(self.ingest(path, extra=("--note", "n" * 300)).code, 0)
        self.assert_failure(self.ingest(path, backend="midjourney"), "usage", 3)
        for backend in ("codex", "agy", "gemini-app", "other"):
            self.assertEqual(self.ingest(path, backend=backend).code, 0)

    def test_prompt_is_recorded_when_given(self):
        path = self.sb.write_png(os.path.join(self.sb.home, "Desktop", "pp.png"))
        result = self.cli("ingest", "--label", "pic", "--backend", "gemini-app", "--file", path,
                          "--prompt-stdin", *self.root_args(), stdin="what I typed into the app")
        self.assertEqual(result.code, 0, result.out)
        (entry,) = self.sb.manifest()
        self.assertEqual(entry["prompt"], "what I typed into the app")
        self.assertNotIn("what I typed", result.out + result.err)


# ---------------------------------------------------------------------------
# wait-new
# ---------------------------------------------------------------------------

class WaitNewTests(SandboxCase):
    def setUp(self):
        SandboxCase.setUp(self)
        self.downloads = self.sb.make_dir("home", "Downloads")

    def wait(self, since, *extra, **options):
        return self.cli("wait-new", "--dir", self.downloads, "--since", since, *extra, **options)

    def test_a_ready_file_is_returned(self):
        path = self.sb.write_png(os.path.join(self.downloads, "gemini.png"), age=10)
        result = self.wait(time.time() - 60, "--timeout", "20")
        self.assertEqual(result.code, 0, result.out)
        (found,) = result.data["files"]
        self.assertEqual(found["path"], path)
        self.assertEqual(found["bytes"], os.path.getsize(path))
        self.assertAlmostEqual(found["mtime"], os.path.getmtime(path), places=2)
        self.assertIsInstance(result.data["waitedSec"], float)

    def test_default_folder_is_downloads(self):
        self.sb.write_png(os.path.join(self.downloads, "x.png"))
        result = self.cli("wait-new", "--since", time.time() - 60, "--timeout", "20")
        self.assertEqual(result.code, 0, result.out)

    def test_timeout_with_nothing_new(self):
        started = time.time()
        result = self.wait(time.time(), "--timeout", "2")
        self.assert_failure(result, "timeout")
        self.assertEqual(result.data["files"], [])
        self.assertGreaterEqual(time.time() - started, 2.0)
        self.assertGreaterEqual(result.data["waitedSec"], 2.0)

    def test_old_files_and_non_pictures_are_ignored(self):
        since = time.time() - 30
        self.sb.write_png(os.path.join(self.downloads, "old.png"), age=3600)
        self.sb.write_file(os.path.join(self.downloads, "notes.txt"), b"x", age=10)
        self.sb.write_file(os.path.join(self.downloads, "doc.pdf"), b"x", age=10)
        os.makedirs(os.path.join(self.downloads, "folder.png"))
        result = self.wait(since, "--timeout", "2")
        self.assert_failure(result, "timeout")
        self.assertEqual(result.data["files"], [])

    def test_partial_downloads_and_hidden_files_are_ignored(self):
        since = time.time() - 30
        for name in (".hidden.png", "pic.png.crdownload", "pic2.png.download", "pic3.png.part",
                     "pic4.png.tmp", "pic5.crdownload", ".DS_Store"):
            self.sb.write_png(os.path.join(self.downloads, name), age=10)
        result = self.wait(since, "--timeout", "2")
        self.assert_failure(result, "timeout")
        self.assertEqual(result.data["files"], [])

    def test_min_count(self):
        since = time.time() - 60
        self.sb.write_png(os.path.join(self.downloads, "a.png"), age=10)
        result = self.wait(since, "--min-count", "2", "--timeout", "2")
        self.assert_failure(result, "timeout")
        self.assertEqual(len(result.data["files"]), 1)
        self.sb.write_png(os.path.join(self.downloads, "b.jpg"), age=9)
        result = self.wait(since, "--min-count", "2", "--timeout", "20")
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual([os.path.basename(f["path"]) for f in result.data["files"]], ["a.png", "b.jpg"])

    def test_ext_filter(self):
        since = time.time() - 60
        self.sb.write_png(os.path.join(self.downloads, "a.png"))
        self.sb.write_file(os.path.join(self.downloads, "b.webp"), webp_vp8x(2, 2))
        result = self.wait(since, "--ext", "webp", "--timeout", "20")
        self.assertEqual([os.path.basename(f["path"]) for f in result.data["files"]], ["b.webp"])
        self.assert_failure(self.wait(since, "--ext", "gif"), "bad-input")

    def test_the_extension_list_and_the_file_names_are_compared_without_regard_to_case(self):
        self.sb.write_png(os.path.join(self.downloads, "a.PNG"))
        result = self.wait(time.time() - 60, "--ext", "PNG,Jpg", "--timeout", "20")
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual([os.path.basename(f["path"]) for f in result.data["files"]], ["a.PNG"])

    def test_a_file_that_keeps_growing_is_not_ready_until_it_stops(self):
        since = time.time() - 5
        path = os.path.join(self.downloads, "slow.png")
        with open(path, "wb") as handle:
            handle.write(b"x" * 10)

        def grow():
            with open(path, "ab") as handle:
                for _ in range(8):
                    time.sleep(0.4)
                    handle.write(b"y" * 10)
                    handle.flush()
        writer = threading.Thread(target=grow)
        started = time.time()
        writer.start()
        result = self.wait(since, "--settle", "1.5", "--timeout", "30")
        writer.join()
        self.assertEqual(result.code, 0, result.out)
        growth_took = 8 * 0.4
        self.assertGreaterEqual(time.time() - started, growth_took)
        self.assertEqual(result.data["files"][0]["bytes"], 90)

    def test_folder_rules(self):
        self.assert_failure(self.cli("wait-new", "--dir", self.sb.outside, "--since", "0"), "bad-input")
        self.assert_failure(self.cli("wait-new", "--dir", os.path.join(self.sb.home, ".ssh"), "--since", "0"), "bad-input")
        self.assert_failure(self.cli("wait-new", "--dir", os.path.join(self.sb.home, "nope"), "--since", "0"), "bad-input")

    def test_a_folder_link_into_a_hidden_folder_is_refused_and_linked_pictures_are_not_listed(self):
        hidden = os.path.join(self.sb.home, ".ssh")
        secret_png = self.sb.write_png(os.path.join(hidden, "k.png"))
        link = os.path.join(self.sb.home, "dl-link")
        os.symlink(hidden, link)
        self.assert_failure(self.cli("wait-new", "--dir", link, "--since", "0"), "bad-input")
        os.symlink(secret_png, os.path.join(self.downloads, "innocent.png"))        # a picture-named file link
        os.symlink(hidden, os.path.join(self.downloads, "folder.png"))              # a picture-named folder link
        result = self.wait(0, "--timeout", "2", "--settle", "0")
        self.assert_failure(result, "timeout")
        self.assertEqual(result.data["files"], [])

    def test_number_rules(self):
        for flag, value in (("--timeout", "0.5"), ("--timeout", "541"), ("--min-count", "0"), ("--min-count", "9"),
                            ("--min-count", "1.5"), ("--settle", "-1"), ("--settle", "31"), ("--since", "abc"),
                            ("--since", "-5")):
            self.assert_failure(self.cli("wait-new", "--dir", self.downloads, "--since", "1", flag, value),
                                "bad-input")

    def test_since_is_required(self):
        self.assert_failure(self.cli("wait-new", "--dir", self.downloads), "usage", 3)

    def test_it_files_nothing(self):
        self.sb.write_png(os.path.join(self.downloads, "a.png"))
        self.wait(time.time() - 60, "--timeout", "20")
        self.assertFalse(os.path.exists(self.sb.inbox))


# ---------------------------------------------------------------------------
# clip-image (only ever with a fake osascript)
# ---------------------------------------------------------------------------

class ClipImageTests(SandboxCase):
    def clip(self, mode, source, *extra, **options):
        env = {"FAKE_CLIP_MODE": mode, "FAKE_CLIP_FILE": source}
        env.update(options.get("env") or {})
        return self.cli("clip-image", "--label", "clip", *extra, env=env, stdin=options.get("stdin"))

    def test_png_on_the_clipboard(self):
        source = self.sb.write_png(os.path.join(self.sb.root, "clipboard.png"), 6, 5, color=(9, 8, 7))
        result = self.clip("png", source, "--note", "from Gemini, second try")
        self.assertEqual(result.code, 0, result.out + result.err)
        (image,) = result.data["images"]
        self.assertEqual((image["format"], image["width"], image["height"], image["source"]), ("png", 6, 5, "clipboard"))
        self.assertRegex(os.path.basename(image["path"]), r"^clip_gemini-app_01_[0-9a-f]{8}\.png$")
        (entry,) = self.sb.manifest()
        self.assertEqual((entry["backend"], entry["note"]), ("gemini-app", "from Gemini, second try"))
        self.assertFalse(os.path.exists(os.path.join(self.sb.cache, "clip", result.data["jobId"])))

    @unittest.skipUnless(HAS_SIPS, "needs /usr/bin/sips")
    def test_tiff_fallback_is_converted_to_png(self):
        png = self.sb.write_png(os.path.join(self.sb.root, "src.png"), 7, 3, color=(50, 60, 70))
        tiff = os.path.join(self.sb.root, "src.tiff")
        made = subprocess.run(["/usr/bin/sips", "-s", "format", "tiff", png, "--out", tiff],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(made.returncode, 0)
        result = self.clip("tiff", tiff, "--backend", "other")
        self.assertEqual(result.code, 0, result.out + result.err)
        (image,) = result.data["images"]
        self.assertEqual((image["format"], image["width"], image["height"]), ("png", 7, 3))
        self.assertIn("_other_01_", image["path"])

    @unittest.skipUnless(HAS_SIPS, "needs /usr/bin/sips")
    def test_a_failed_osascript_that_left_a_partial_file_is_not_trusted(self):
        """The exit status counts: the half-written PNG is ignored and the TIFF route is tried."""
        png = self.sb.write_png(os.path.join(self.sb.root, "c.png"), 6, 5)
        tiff = os.path.join(self.sb.root, "c.tiff")
        made = subprocess.run(["/usr/bin/sips", "-s", "format", "tiff", png, "--out", tiff],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertEqual(made.returncode, 0)
        fake = self.sb.script("osascript-partial", (
            '#!/usr/bin/python3\n'
            'import os, shutil, sys\n'
            'args = sys.argv[1:]\n'
            'target = args[-1]\n'
            'script = " ".join(args[i + 1] for i, token in enumerate(args) if token == "-e" and i + 1 < len(args))\n'
            'if "PNGf" in script:\n'
            '    with open(target, "wb") as handle:\n'
            '        handle.write(b"\\x89PNG\\r\\n\\x1a\\nBROKEN")\n'
            '    sys.stderr.write("boom")\n'
            '    sys.exit(1)\n'
            'shutil.copyfile(os.environ["SRC_TIFF"], target)\n'))
        result = self.cli("clip-image", "--label", "clip", env={"DESK_ART_OSASCRIPT": fake, "SRC_TIFF": tiff})
        self.assertEqual(result.code, 0, result.out)
        (image,) = result.data["images"]
        self.assertEqual((image["format"], image["width"], image["height"]), ("png", 6, 5))

    def test_nothing_on_the_clipboard(self):
        result = self.clip("none", os.path.join(self.sb.root, "unused"))
        self.assert_failure(result, "no-image-on-clipboard")
        self.assertIn("-1700", result.data["error"])
        self.assertEqual(self.sb.manifest(), [])
        self.assertEqual(os.listdir(os.path.join(self.sb.cache, "clip")), [])       # temp folder removed

    def test_a_clipboard_file_that_is_not_a_picture(self):
        result = self.clip("garbage", os.path.join(self.sb.root, "unused"))
        self.assert_failure(result, "not-an-image")
        self.assertEqual(self.sb.manifest(), [])

    def test_osascript_that_cannot_run(self):
        result = self.clip("png", "x", env={"DESK_ART_OSASCRIPT": os.path.join(self.sb.root, "missing")})
        self.assert_failure(result, "osascript-failed")

    def test_script_text_and_arguments(self):
        lines = desk_art.clipboard_script("PNGf")
        self.assertIn("\u00abclass PNGf\u00bb", " ".join(lines))
        self.assertIn("\u00abclass TIFF\u00bb", " ".join(desk_art.clipboard_script("TIFF")))
        self.assertTrue(lines[0].startswith("on run argv") and lines[-1] == "end run")

    def test_same_clipboard_picture_twice_is_a_duplicate(self):
        source = self.sb.write_png(os.path.join(self.sb.root, "clipboard.png"))
        self.clip("png", source)
        again = self.clip("png", source)
        self.assertTrue(again.data["images"][0]["duplicate"])
        self.assertEqual(len(self.sb.manifest()), 1)

    def test_label_and_backend_rules(self):
        source = self.sb.write_png(os.path.join(self.sb.root, "clipboard.png"))
        self.assert_failure(self.cli("clip-image", "--label", "Bad Label", env={"FAKE_CLIP_FILE": source}), "bad-input")
        self.assert_failure(self.cli("clip-image", "--label", "ok", "--backend", "codex"), "usage", 3)


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

class StatusTests(SandboxCase):
    NOTHING = {"DESK_ART_CODEX": "/nonexistent/codex", "DESK_ART_AGY": "/nonexistent/agy"}

    def test_everything_missing(self):
        result = self.cli("status", env=dict(self.NOTHING))
        self.assertEqual(result.code, 0, result.out)
        data = result.data
        self.assertEqual(data["inbox"], {"path": self.sb.inbox, "exists": False, "imageCount": 0,
                                         "usable": True, "problem": None})
        self.assertEqual(data["codex"], {"found": False, "path": None, "version": None, "loggedIn": None,
                                         "detail": "codex was not found", "hardening": {"ok": None, "missing": []}})
        self.assertEqual(data["agy"]["found"], False)
        self.assertEqual(data["antigravityApp"], {"installed": False, "running": False})
        self.assertEqual(data["geminiApp"], {"installed": False, "running": False})
        text = " ".join(data["notes"])
        self.assertIn("curl -fsSL https://antigravity.google/cli/install.sh | bash", text)
        self.assertIn("ChatGPT app", text)
        self.assertEqual(list(data.keys()), ["ok", "inbox", "codex", "agy", "antigravityApp", "geminiApp",
                                             "refRoots", "notes"])
        self.assertEqual(data["refRoots"], [os.path.join(self.sb.home, name) for name in DEFAULT_ROOT_NAMES]
                         + [self.sb.inbox, self.sb.cache])
        self.assertFalse(os.path.exists(self.sb.inbox))                       # status creates nothing
        self.assertFalse(os.path.exists(self.sb.cache))

    def test_with_fakes(self):
        self.sb.write_png(os.path.join(self.sb.inbox, "2026-11-04", "a.png"))
        self.sb.write_png(os.path.join(self.sb.inbox, "2026-11-04", "b.png"), color=(1, 1, 1))
        os.makedirs(os.path.join(self.sb.apps, "Gemini.app"))
        os.makedirs(os.path.join(self.sb.apps, "Antigravity.app"))
        lines = "/sbin/launchd\n%s/Gemini.app/Contents/MacOS/Gemini\n/usr/bin/other" % self.sb.apps
        data = self.cli("status", env={"FAKE_PS_LINES": lines}).data
        self.assertEqual(data["inbox"], {"path": self.sb.inbox, "exists": True, "imageCount": 2,
                                         "usable": True, "problem": None})
        self.assertEqual(data["codex"], {"found": True, "path": self.sb.codex, "version": "codex-cli 0.164.0-alpha.11.1",
                                         "loggedIn": True, "detail": "logged in using ChatGPT",
                                         "hardening": {"ok": True, "missing": []}})
        self.assertEqual((data["agy"]["found"], data["agy"]["path"], data["agy"]["version"]),
                         (True, self.sb.agy, "agy 0.9.9-fake"))
        self.assertEqual(data["geminiApp"], {"installed": True, "running": True})
        self.assertEqual(data["antigravityApp"], {"installed": True, "running": False})
        self.assertTrue(any("Computer use" in n for n in data["notes"]))

    def test_hardening_says_whether_this_codex_still_has_every_switch_desk_art_turns_off(self):
        whole = self.cli("status").data
        self.assertEqual(whole["codex"]["hardening"], {"ok": True, "missing": []})
        self.assertFalse(any("switches" in note for note in whole["notes"]))
        short = self.cli("status", env={"FAKE_CODEX_FEATURES": "missing"}).data
        self.assertEqual(short["codex"]["hardening"], {"ok": False, "missing": ["goals", "sleep_tool"]})
        (note,) = [n for n in short["notes"] if "switches" in n]
        self.assertIn("goals, sleep_tool", note)
        self.assertIn("desk-art is updated", note)
        for broken in ("fail", "empty"):                                   # the list could not be read: unknown
            data = self.cli("status", env={"FAKE_CODEX_FEATURES": broken}).data
            self.assertEqual(data["codex"]["hardening"], {"ok": None, "missing": []}, broken)
            self.assertEqual(data["codex"]["found"], True)

    def test_hardening_reads_the_first_word_of_each_line(self):
        listing = ("shell_tool    stable  true\n\nunified_exec_tty   removed   false\n   apps  stable true\nplugins\n"
                   "x" * 10 + "\n")
        done = desk_art.ProcResult(0, listing.encode(), b"", False, None)
        with mock.patch.object(desk_art, "run_process", lambda *args, **kwargs: done):
            result = desk_art.codex_hardening("/bin/codex")
        self.assertFalse(result["ok"])
        self.assertEqual(result["missing"], ["unified_exec", "computer_use", "browser_use", "browser_use_external",
                                             "browser_use_full_cdp_access", "in_app_browser", "view_image",
                                             "multi_agent", "goals", "sleep_tool"])

    def test_the_effective_reference_folders_are_listed(self):
        picked = self.cli("status", "--ref-root", "~/Pictures", "--ref-root", self.sb.outside).data
        self.assertEqual(picked["refRoots"], [os.path.join(self.sb.home, "Pictures"), self.sb.outside,
                                              self.sb.inbox, self.sb.cache])
        unsafe = self.cli("status", "--inbox", self.sb.outside, "--ref-root", "~/Pictures").data
        self.assertEqual(unsafe["refRoots"], [os.path.join(self.sb.home, "Pictures"), self.sb.cache])   # no unusable inbox
        self.assert_failure(self.cli("status", "--ref-root", "relative/folder"), "bad-input")

    def test_logged_out_and_unreadable_login(self):
        out = self.cli("status", env={"FAKE_CODEX_MODE": "loggedout"}).data["codex"]
        self.assertEqual((out["found"], out["loggedIn"]), (True, False))
        self.assertIn("sign in", out["detail"])
        unknown = self.cli("status", env={"FAKE_CODEX_LOGIN": "garbage"}).data["codex"]
        self.assertIsNone(unknown["loggedIn"])

    def test_unsafe_inbox_is_reported_not_walked(self):
        data = self.cli("status", "--inbox", self.sb.outside).data
        self.assertEqual(data["inbox"]["exists"], False)
        self.assertEqual(data["inbox"]["usable"], False)
        self.assertTrue(data["inbox"]["problem"])
        self.assertTrue(any("not allowed" in n for n in data["notes"]))

    def test_process_listing_matches_the_app_folder_only(self):
        commands = ["/Applications/Gemini.app/Contents/MacOS/Gemini", "/Users/x/Gemini.app/Contents/Helpers/y"]
        self.assertTrue(desk_art.app_state("Gemini", commands)["running"])
        self.assertFalse(desk_art.app_state("Gemini", commands[1:])["running"])
        self.assertFalse(desk_art.app_state("Antigravity", commands)["running"])


# ---------------------------------------------------------------------------
# The command line as a whole
# ---------------------------------------------------------------------------

class CommandLineTests(SandboxCase):
    def test_help_is_one_json_object_for_every_subcommand(self):
        top = self.cli("--help")
        self.assertEqual((top.code, top.data["ok"], top.data["command"]), (0, True, None))
        for name in SUBCOMMANDS:
            result = self.cli(name, "--help")
            self.assertEqual(result.code, 0, name)
            self.assertIs(result.data["ok"], True)
            self.assertEqual(result.data["command"], name)
            self.assertIn("usage: desk_art.py %s" % name, result.data["help"])
            self.assertIn("--inbox", result.data["flags"])

    def test_help_lists_the_failure_codes_each_subcommand_can_return(self):
        expected = {"status": ["bad-input", "internal"], "codex": ["codex-not-found", "codex-not-logged-in", "codex-failed",
                                                       "codex-timeout", "codex-no-images", "inbox-unsafe"],
                    "agy": ["agy-not-installed", "agy-failed", "agy-timeout", "agy-no-images"],
                    "ingest": ["bad-input", "inbox-unsafe"], "wait-new": ["timeout", "bad-input"],
                    "clip-image": ["no-image-on-clipboard", "osascript-failed", "not-an-image"]}
        for name, codes in expected.items():
            data = self.cli(name, "--help").data
            self.assertIn("usage", data["codes"])
            for code in codes:
                self.assertIn(code, data["codes"], name)
            self.assertIn("Failure codes", " ".join(data["help"].split()))
        self.assertIn("agy-no-images", self.cli("--help").data["codes"])

    def test_flags_listed_by_help(self):
        flags = {name: self.cli(name, "--help").data["flags"] for name in SUBCOMMANDS}
        self.assertEqual(flags["status"], ["--inbox", "--ref-root"])
        self.assertEqual(flags["codex"], ["--inbox", "--label", "--prompt-file", "--prompt-stdin", "--anchor", "--ref",
                                          "--ref-root", "--timeout"])
        self.assertEqual(flags["agy"], ["--inbox", "--label", "--prompt-file", "--prompt-stdin", "--model", "--anchor",
                                        "--ref", "--ref-root", "--timeout"])
        self.assertEqual(flags["ingest"], ["--inbox", "--label", "--backend", "--file", "--ref-root",
                                           "--prompt-file", "--prompt-stdin", "--note"])
        self.assertEqual(flags["wait-new"], ["--inbox", "--dir", "--since", "--timeout", "--min-count", "--settle", "--ext"])
        self.assertEqual(flags["clip-image"], ["--inbox", "--label", "--backend", "--prompt-file", "--prompt-stdin", "--note"])

    def test_usage_errors_print_one_json_object_and_exit_3(self):
        cases = [[], ["bogus"], ["--bogus"], ["status", "--bogus"], ["codex", "--bogus"],
                 ["codex", "--label"], ["agy"], ["ingest"], ["wait-new"], ["clip-image"],
                 ["codex", "--label", "x", "--prompt-stdin", "--lab", "y"]]
        for argv in cases:
            result = self.cli(*argv)
            self.assert_failure(result, "usage", 3)
            self.assertIn("usage: desk_art.py", result.data["usage"])
            self.assertEqual(result.err, "", argv)                     # argparse printed nothing itself

    def test_values_that_start_with_a_dash_are_values_not_flags(self):
        path = self.sb.write_png(os.path.join(self.sb.home, "Desktop", "d.png"))
        ok = self.cli("ingest", "--label", "pic", "--backend", "other", "--file", path, "--note", "-x",
                      *self.root_args())
        self.assertEqual(ok.code, 0, ok.out)
        self.assertEqual(self.sb.manifest()[0]["note"], "-x")
        self.assert_failure(self.cli("codex", "--label", "-dash", "--prompt-stdin", stdin="p"), "bad-input")
        self.assert_failure(self.cli("wait-new", "--since", "-5"), "bad-input")
        self.assertEqual(desk_art.glue_dash_values(["--ref", "--ref", "x", "--prompt-stdin", "-h"]),
                         ["--ref", "--ref", "x", "--prompt-stdin", "-h"])
        self.assertEqual(desk_art.glue_dash_values(["--note", "-"]), ["--note", "-"])

    def test_dash_value_table_matches_the_parser(self):
        parser = desk_art.build_parser()
        subparsers = [a for a in parser._actions if isinstance(a, argparse._SubParsersAction)][0]
        values, switches = set(), set()
        for sub in subparsers.choices.values():
            for action in sub._actions:
                for option in action.option_strings:
                    if option.startswith("--"):
                        (switches if action.nargs == 0 else values).add(option)
        self.assertEqual(values, set(desk_art.VALUE_FLAGS))
        self.assertEqual(switches, set(f for f in desk_art.SWITCH_FLAGS if f.startswith("--")))

    def test_prefix_abbreviations_are_not_accepted(self):
        result = self.cli("status", "--inb", self.sb.inbox)
        self.assert_failure(result, "usage", 3)

    def test_every_subcommand_prints_one_object_on_failure_and_on_success(self):
        source = self.sb.write_png(os.path.join(self.sb.home, "Desktop", "s.png"))
        os.makedirs(os.path.join(self.sb.home, "Downloads"), exist_ok=True)
        self.sb.write_png(os.path.join(self.sb.home, "Downloads", "d.png"))
        clip_png = self.sb.write_png(os.path.join(self.sb.root, "c.png"))
        runs = [
            (["status"], 0), (["codex", "--label", "a", "--prompt-stdin"], 0),
            (["agy", "--label", "a", "--prompt-stdin"], 0),
            (["ingest", "--label", "a", "--backend", "other", "--file", source, "--ref-root", self.sb.home], 0),
            (["wait-new", "--since", "0", "--timeout", "20"], 0),
            (["clip-image", "--label", "a"], 0),
            (["codex", "--label", "A", "--prompt-stdin"], 2), (["agy", "--label", "A", "--prompt-stdin"], 2),
            (["ingest", "--label", "a", "--backend", "other", "--file", "/etc/hosts"], 2),
            (["wait-new", "--since", "0", "--dir", "/etc"], 2),
            (["clip-image", "--label", "A"], 2),
        ]
        for argv, expected in runs:
            result = self.cli(*argv, stdin="a prompt", env={"FAKE_CLIP_FILE": clip_png})
            self.assertEqual(result.code, expected, "%s -> %s" % (argv, result.out))

    def test_unexpected_exception_is_reported_as_internal_with_exit_1(self):
        def boom(args):
            raise RuntimeError("something odd")
        with mock.patch.dict(desk_art.COMMANDS, {"status": boom}):
            with contextlib.redirect_stderr(io.StringIO()):
                code, result = desk_art.run_cli(["status"])
        self.assertEqual(code, 1)
        self.assertEqual(result, {"ok": False, "code": "internal", "error": "RuntimeError: something odd"})

    def test_an_unexpected_exception_in_any_subcommand_still_gives_one_json_object_through_main(self):
        """Through main(), the real entry point: one ASCII JSON line on stdout, the traceback on stderr, exit 1."""
        def boom(args):
            raise RuntimeError("something odd \u00e9")
        runs = {"status": ["status"], "codex": ["codex", "--label", "a", "--prompt-stdin"],
                "agy": ["agy", "--label", "a", "--prompt-stdin"],
                "ingest": ["ingest", "--label", "a", "--backend", "other", "--file", "/x"],
                "wait-new": ["wait-new", "--since", "0"], "clip-image": ["clip-image", "--label", "a"]}
        for name, argv in runs.items():
            out, err = io.StringIO(), io.StringIO()
            with mock.patch.dict(desk_art.COMMANDS, {name: boom}), mock.patch.object(sys, "argv", ["desk_art.py"] + argv), \
                    contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), mock.patch.object(signal, "signal"):
                code = desk_art.main()
            self.assertEqual(code, 1, name)
            self.assertTrue(out.getvalue().endswith("\n") and out.getvalue().count("\n") == 1 and out.getvalue().isascii(), name)
            data = json.loads(out.getvalue())
            self.assertEqual((data["ok"], data["code"]), (False, "internal"), name)
            self.assertIn("Traceback", err.getvalue())
            self.assertNotIn("Traceback", out.getvalue())

    def test_closed_standard_input_is_a_handled_failure(self):
        done = subprocess.run([PYTHON, HELPER, "codex", "--label", "x", "--prompt-stdin"], stdin=subprocess.DEVNULL,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.sb.env(), timeout=60,
                              preexec_fn=lambda: os.close(0))
        out = done.stdout.decode()
        self.assertEqual(out.count("\n"), 1, out)
        data = json.loads(out)
        self.assertEqual((done.returncode, data["ok"], data["code"]), (2, False, "bad-input"), out)

    def test_a_reader_that_went_away_does_not_change_the_exit_code(self):
        """Python would otherwise exit with 120 when its final flush hits the broken pipe."""
        downloads = self.sb.make_dir("home", "Downloads")
        proc = subprocess.Popen([PYTHON, HELPER, "wait-new", "--dir", downloads, "--since", "0", "--timeout", "1"],
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.sb.env())
        proc.stdout.close()                                    # nobody reads the answer
        err = proc.stderr.read()
        proc.wait(timeout=60)
        proc.stderr.close()
        self.assertEqual(proc.returncode, 2)                   # the planned "timeout" exit code, not 120
        self.assertNotIn(b"Traceback", err)
        self.assertNotIn(b"Exception ignored", err)

    def test_emit_survives_a_stdout_that_is_missing_or_broken(self):
        class Broken(object):
            def write(self, text):
                raise BrokenPipeError(32, "Broken pipe")

            def flush(self):
                raise BrokenPipeError(32, "Broken pipe")

            def fileno(self):
                raise OSError("no descriptor")                 # so this test never touches a real descriptor
        with mock.patch.object(sys, "stdout", None):
            desk_art.emit({"ok": True})
        with mock.patch.object(sys, "stdout", Broken()):
            desk_art.emit({"ok": True})

    def test_main_prints_exactly_one_line_and_returns_the_exit_code(self):
        captured = io.StringIO()
        with mock.patch.object(sys, "argv", ["desk_art.py", "bogus"]), contextlib.redirect_stdout(captured), \
                mock.patch.object(signal, "signal"):
            code = desk_art.main()
        self.assertEqual(code, 3)
        self.assertEqual(captured.getvalue().count("\n"), 1)
        self.assertEqual(json.loads(captured.getvalue())["code"], "usage")

    def test_non_ascii_text_stays_ascii_on_stdout(self):
        emitted = io.StringIO()
        with contextlib.redirect_stdout(emitted):
            desk_art.emit({"ok": True, "text": "caf\u00e9 \u2028 \U0001f600"})
        self.assertTrue(emitted.getvalue().isascii())
        self.assertEqual(emitted.getvalue().count("\n"), 1)
        self.assertEqual(json.loads(emitted.getvalue())["text"], "caf\u00e9 \u2028 \U0001f600")


# ---------------------------------------------------------------------------
# The process runner
# ---------------------------------------------------------------------------

class ProcessRunnerTests(unittest.TestCase):
    def test_captures_both_streams_and_the_exit_code(self):
        script = "import sys; sys.stdout.write('out'); sys.stderr.write('err'); sys.exit(7)"
        done = desk_art.run_process([PYTHON, "-c", script], 30)
        self.assertEqual((done.returncode, done.stdout, done.stderr, done.timed_out, done.error), (7, b"out", b"err", False, None))

    def test_stdin_is_devnull_unless_given(self):
        script = "import sys; sys.stdout.write(repr(sys.stdin.read()))"
        self.assertEqual(desk_art.run_process([PYTHON, "-c", script], 30).stdout, b"''")
        self.assertEqual(desk_art.run_process([PYTHON, "-c", script], 30, stdin_bytes=b"hi").stdout, b"'hi'")

    def test_output_is_capped_and_drained(self):
        script = "import sys; sys.stdout.write('x' * (5 * 1024 * 1024)); sys.stdout.flush(); sys.stderr.write('e' * 100)"
        done = desk_art.run_process([PYTHON, "-c", script], 60)
        self.assertEqual(done.returncode, 0)
        self.assertEqual(len(done.stdout), desk_art.PIPE_CAP)
        self.assertEqual(len(done.stderr), 100)

    def test_a_program_that_cannot_start_reports_an_error(self):
        done = desk_art.run_process(["/nonexistent/program"], 5)
        self.assertIsNone(done.returncode)
        self.assertIn("FileNotFoundError", done.error)

    def test_arguments_are_never_interpreted_by_a_shell(self):
        script = "import sys; sys.stdout.write(sys.argv[1])"
        tricky = "a; echo hacked $(id) `id` > /dev/null && *"
        self.assertEqual(desk_art.run_process([PYTHON, "-c", script, tricky], 30).stdout.decode(), tricky)

    def test_the_child_environment_is_passed_through(self):
        script = "import os, sys; sys.stdout.write(os.environ.get('DESK_ART_PROBE', '-'))"
        done = desk_art.run_process([PYTHON, "-c", script], 30, env=dict(os.environ, DESK_ART_PROBE="seen"))
        self.assertEqual(done.stdout, b"seen")

    def test_api_keys_are_removed_from_the_child_environment(self):
        with mock.patch.dict(os.environ, {"OPENAI_API_KEY": "a", "CODEX_API_KEY": "b", "GEMINI_API_KEY": "c",
                                          "GOOGLE_API_KEY": "d", "KEEP_ME": "yes"}):
            env = desk_art.child_env()
        for name in ("OPENAI_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY"):
            self.assertNotIn(name, env)
        self.assertEqual(env["KEEP_ME"], "yes")

    def test_api_keys_and_other_credentials_are_removed_unless_an_environment_is_given(self):
        """Every program the helper starts (ps, sips, osascript too), not only the generators. Only an ordinary
        name passes through (the longer lists of names are in ChildEnvironmentTests)."""
        names = ("OPENAI_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "GITHUB_TOKEN",
                 "SSH_AUTH_SOCK", "KEEP_ME")
        script = "import os, sys; sys.stdout.write(','.join(n for n in %r if n in os.environ))" % (names,)
        with mock.patch.dict(os.environ, {name: "x" for name in names}):
            self.assertEqual(desk_art.run_process([PYTHON, "-c", script], 30).stdout, b"KEEP_ME")
            explicit = desk_art.run_process([PYTHON, "-c", script], 30, env=dict(os.environ))
        self.assertEqual(explicit.stdout.decode(), ",".join(names))          # an explicit environment is respected

    def test_feed_closes_the_pipe_even_when_the_write_fails(self):
        class Pipe(object):
            closed = False

            def write(self, data):
                raise BrokenPipeError(32, "Broken pipe")

            def close(self):
                self.closed = True
        pipe = Pipe()
        desk_art.feed(pipe, b"x")
        self.assertTrue(pipe.closed)

    def test_a_child_that_never_reads_a_large_input_does_not_hold_the_helper(self):
        started = time.time()
        done = desk_art.run_process([PYTHON, "-c", "pass"], 30, stdin_bytes=b"x" * 2000000)
        self.assertEqual(done.returncode, 0)
        self.assertLess(time.time() - started, 10)

    def test_timeout_stops_the_program_and_its_children(self):
        script = ("import subprocess, sys, time; c = subprocess.Popen(['/bin/sleep', '300']); "
                  "sys.stdout.write(str(c.pid)); sys.stdout.flush(); time.sleep(300)")
        with mock.patch.object(desk_art, "KILL_GRACE_SEC", 3.0):
            started = time.time()
            done = desk_art.run_process([PYTHON, "-c", script], 1)
        self.assertTrue(done.timed_out)
        self.assertLess(time.time() - started, 15)
        child = int(done.stdout)
        deadline = time.time() + 4
        while time.time() < deadline:
            try:
                os.kill(child, 0)
            except ProcessLookupError:
                return
            time.sleep(0.05)
        os.kill(child, signal.SIGKILL)
        self.fail("the child process survived the timeout")

    def test_a_program_that_ignores_sigterm_and_let_go_of_its_pipes_is_still_killed(self):
        """Nothing holds the pipes open here, so only the SIGKILL that follows the grace period can stop it."""
        script = ("import os, signal, sys, time\n"
                  "signal.signal(signal.SIGTERM, signal.SIG_IGN)\n"
                  "sys.stdout.write(str(os.getpid())); sys.stdout.flush()\n"
                  "os.close(1); os.close(2)\n"
                  "time.sleep(300)\n")
        with mock.patch.object(desk_art, "KILL_GRACE_SEC", 1.0):
            done = desk_art.run_process([PYTHON, "-c", script], 1)
        self.assertTrue(done.timed_out)
        pid = int(done.stdout)
        deadline = time.time() + 3
        while time.time() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            time.sleep(0.05)
        os.kill(pid, signal.SIGKILL)
        self.fail("the process ignored SIGTERM and was never sent SIGKILL")


# ---------------------------------------------------------------------------
# What the generator programs may inherit
# ---------------------------------------------------------------------------

REMOVED_NAMES = [
    "OPENAI_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY",              # the four billing keys
    "SSH_AUTH_SOCK", "AWS_ACCESS_KEY_ID", "AWS_PROFILE", "AZURE_CLIENT_ID", "GCP_PROJECT", "GOOGLE_CLOUD_PROJECT",
    "GEMINI_MODEL", "OPENAI_ORG_ID", "ANTHROPIC_BASE_URL", "GITHUB_REPOSITORY", "GH_HOST", "GITLAB_CI",
    "NPM_CONFIG_REGISTRY", "HF_HOME", "HUGGINGFACE_HUB_CACHE", "SLACK_WEBHOOK",       # the prefixes
    "MY_TOKEN", "TOKEN", "db_password", "SomeSecretThing", "THE_PASSWD", "X_CREDENTIALS", "SIGNING_PRIVATE_KEY",
    "STRIPE_API_KEY", "S3_ACCESS_KEY_ID", "aws_session_token", "Github_Thing"]            # the words, any case
KEPT_NAMES = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "CODEX_HOME",
              "DESK_ART_HOME", "DESK_ART_CODEX_HOME", "XDG_CONFIG_HOME", "HTTPS_PROXY", "NO_PROXY", "SSL_CERT_FILE",
              "NODE_EXTRA_CA_CERTS", "KEEP_ME", "GHOSTTY_RESOURCES_DIR", "AWSOME", "KEYBOARD", "PRIVATE_NOTES"]


class ChildEnvironmentTests(SandboxCase):
    def test_secret_looking_names_are_removed_and_ordinary_ones_stay(self):
        with mock.patch.dict(os.environ, {name: "x" for name in REMOVED_NAMES + KEPT_NAMES}, clear=True):
            env = desk_art.child_env()
        self.assertEqual(sorted(set(REMOVED_NAMES) & set(env)), [])
        self.assertEqual(sorted(set(KEPT_NAMES) - set(env)), [])

    def test_the_name_rule_itself(self):
        for name in REMOVED_NAMES:
            self.assertTrue(desk_art.secret_env_name(name), name)
        for name in KEPT_NAMES:
            self.assertFalse(desk_art.secret_env_name(name), name)

    def test_programs_started_without_an_explicit_environment_get_the_cleaned_one(self):
        script = "import os, sys; sys.stdout.write(','.join(sorted(n for n in %r if n in os.environ)))" % (
            ["GITHUB_TOKEN", "SSH_AUTH_SOCK", "AWS_PROFILE", "OPENAI_API_KEY", "KEEP_ME", "CODEX_HOME"],)
        wanted = {"GITHUB_TOKEN": "t", "SSH_AUTH_SOCK": "/tmp/agent", "AWS_PROFILE": "p", "OPENAI_API_KEY": "k",
                  "KEEP_ME": "y", "CODEX_HOME": "/somewhere"}
        with mock.patch.dict(os.environ, wanted):
            self.assertEqual(desk_art.run_process([PYTHON, "-c", script], 30).stdout, b"CODEX_HOME,KEEP_ME")

    def test_the_generators_never_see_the_owners_other_credentials(self):
        secrets = {name: "must-not-arrive" for name in REMOVED_NAMES}
        secrets["CODEX_HOME"] = self.sb.codex_home                       # Codex's own setting is not a secret
        secrets["KEEP_ME"] = "arrives"
        self.codex(env=dict(secrets, DESK_ART_CODEX_HOME=""))
        self.agy(env=dict(secrets, FAKE_AGY_MODE="workdir"))
        self.assertEqual(self.cli("status", env=dict(secrets, DESK_ART_CODEX_HOME="")).code, 0)
        everything = self.sb.calls(self.sb.codex_log) + self.sb.calls(self.sb.agy_log)
        # login status, exec, features list and --version for codex; the run for agy
        self.assertEqual(sorted(call.get("call", "agy") for call in everything),
                         ["agy", "exec", "features", "login", "login", "version"])
        for call in everything:
            self.assertEqual(sorted(set(REMOVED_NAMES) & set(call["env_names"])), [], call)
            self.assertIn("KEEP_ME", call["env_names"])
            self.assertIn("PATH", call["env_names"])
        for call in self.sb.calls(self.sb.codex_log):
            self.assertIn("CODEX_HOME", call["env_names"])
        self.assertFalse(any(call.get("has_api_key") for call in everything))


# ---------------------------------------------------------------------------
# Which pictures count as a codex run's own
# ---------------------------------------------------------------------------

class CodexCollectionTests(SandboxCase):
    """Each test names the mistake it would catch. The fake here does exactly what a script says (SCRIPTED_CODEX)."""

    def scripted(self, script, env=None):
        path = os.path.join(self.sb.root, "script.json")
        with open(path, "w") as handle:
            json.dump(script, handle)
        merged = {"DESK_ART_CODEX": self.sb.scripted_codex, "FC_SCRIPT": path}
        merged.update(env or {})
        return self.codex("a prompt", env=merged)

    def test_with_a_known_thread_only_its_own_folder_is_filed(self):
        """A picture that a parallel run left in another folder while this one worked belongs to that run."""
        lines = [{"type": "thread.started", "thread_id": TID}] + DONE_EVENTS
        result = self.scripted({"lines": lines, "files": [
            {"path": "generated_images/%s/exec-a.png" % TID, "seed": 1},
            {"path": "generated_images/someone-else/exec-b.png", "seed": 2, "age": 1.1}]})
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual([os.path.basename(i["source"]) for i in result.data["images"]], ["exec-a.png"])
        self.assertEqual(result.data["matchedBy"], "thread-folder")

    def test_a_known_thread_with_an_empty_folder_files_nothing_whatever_else_appeared(self):
        """What a refusal looks like. The other run's picture must not be filed under this run's name."""
        lines = [{"type": "thread.started", "thread_id": TID}] + DONE_EVENTS
        result = self.scripted({"lines": lines, "files": [
            {"path": "generated_images/someone-else/exec-b.png", "seed": 2, "age": 1.1}]})
        self.assert_failure(result, "codex-no-images")
        self.assertEqual(result.data["finalMessage"], "Done.")
        self.assertEqual(result.data["threadId"], TID)
        self.assertEqual(self.sb.manifest(), [])

    def test_a_replaced_file_with_a_fresh_time_counts_as_changed_when_there_is_no_thread_id(self):
        """The old and the new state are compared by time and size, not by name."""
        self.sb.write_png(os.path.join(self.sb.codex_home, "generated_images", "old", "exec-old.png"),
                          color=(9, 9, 9), age=3600)
        result = self.scripted({"lines": DONE_EVENTS, "files": [
            {"path": "generated_images/old/exec-old.png", "seed": 6}]})
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["matchedBy"], "folder-diff")

    def test_a_replaced_file_that_keeps_an_old_time_is_not_collected(self):
        """Even when it changed, a picture that looks older than this run cannot be this run's."""
        self.sb.write_png(os.path.join(self.sb.codex_home, "generated_images", "old", "exec-old.png"),
                          color=(9, 9, 9), age=3600)
        result = self.scripted({"lines": DONE_EVENTS, "files": [
            {"path": "generated_images/old/exec-old.png", "seed": 6, "age": 3000}]})
        self.assert_failure(result, "codex-no-images")

    def test_a_thread_id_that_climbs_out_of_the_folder_is_not_used(self):
        outside = self.sb.write_png(os.path.join(self.sb.home, "x", "private.png"), color=(1, 1, 1))
        lines = [{"type": "thread.started", "thread_id": "../../x"}] + DONE_EVENTS
        result = self.scripted({"lines": lines, "files": [{"path": "generated_images/zzz/exec-a.png", "seed": 3}]})
        self.assertEqual(result.code, 0, result.out)
        sources = [os.path.realpath(image["source"]) for image in result.data["images"]]
        self.assertNotIn(os.path.realpath(outside), sources)
        self.assertEqual([os.path.basename(path) for path in sources], ["exec-a.png"])
        self.assertIsNone(result.data["threadId"])
        self.assertEqual(self.sb.manifest()[0]["threadId"], None)

    def test_turn_failed_alone_is_reported_with_its_message(self):
        lines = [{"type": "thread.started", "thread_id": TID},
                 {"type": "turn.failed", "error": {"message": "quota used up"}}]
        result = self.scripted({"lines": lines, "exit": 0})
        self.assert_failure(result, "codex-failed")
        self.assertIn("quota used up", result.data["error"])

    def test_the_picture_search_stops_three_folders_down(self):
        root = os.path.join(self.sb.root, "snap")
        for depth in range(6):
            self.sb.write_png(os.path.join(root, *(["d"] * depth + ["x%d.png" % depth])), color=(depth, 0, 0))
        found = sorted(os.path.relpath(path, root).count(os.sep) for path in desk_art.list_image_files(root, 3))
        self.assertEqual(found, [0, 1, 2, 3])

    def test_only_files_that_are_new_or_changed_are_picked_from_a_snapshot(self):
        before = {"/a.png": (10, 5), "/b.png": (20, 5)}
        after = {"/a.png": (10, 5), "/b.png": (21, 5), "/c.png": (30, 7), "/d.png": (5, 7)}
        self.assertEqual(desk_art.changed_since(before, after), ["/d.png", "/b.png", "/c.png"])       # by time
        self.assertEqual(desk_art.changed_since(before, after, 25e-9), ["/c.png"])                      # too old: out


# ---------------------------------------------------------------------------
# Reference pictures are copied before they are sent (SEC-1)
# ---------------------------------------------------------------------------

def replace_by_another_picture(path):
    """A new file under the old name: another inode."""
    other = path + ".other"
    with open(other, "wb") as handle:
        handle.write(png_bytes(color=(9, 9, 9)))
    os.replace(other, path)


def rewrite_in_place(data):
    def rewrite(path):
        with open(path, "r+b") as handle:                    # the same file: the same inode
            handle.truncate(0)
            handle.write(data)
    return rewrite


class ReferenceCopyTests(unittest.TestCase):
    def test_without_references_drops_only_byte_identical_copies(self):
        keep = desk_art.Picture("/a", "/a", 1, 1.0, "png", 1, 1, "aa" * 32)
        copy = desk_art.Picture("/b", "/b", 1, 1.0, "png", 1, 1, "bb" * 32)
        staged = [desk_art.Staged("r.png", "/s/ref1.png", "png", "bb" * 32, 1)]
        self.assertEqual(desk_art.without_references([keep, copy], staged), [keep])
        self.assertEqual(desk_art.without_references([keep, copy], []), [keep, copy])


class AgentLogTests(unittest.TestCase):
    def test_only_a_path_inside_a_system_generated_folder_is_the_agents_own_log(self):
        log = os.path.join("g", "brain", "c1", ".system_generated", "logs", "media", "step_2_media_0.jpg")
        self.assertTrue(desk_art.is_agent_log(log))
        self.assertFalse(desk_art.is_agent_log(os.path.join("g", "brain", "c1", "vending_machine_1.jpg")))
        self.assertFalse(desk_art.is_agent_log(os.path.join("g", "brain", "c1", "my.system_generated.jpg")))


class OpenRegularTests(unittest.TestCase):
    """Files named by the owner or by a generator are opened without waiting on a pipe that was swapped in after
    the checks, without following a link, and only if they are regular files."""

    def setUp(self):
        self.dir = os.path.realpath(tempfile.mkdtemp(prefix="deskart-open-"))
        self.addCleanup(shutil.rmtree, self.dir, True)

    def test_a_pipe_is_refused_at_once_and_a_link_or_folder_is_not_opened(self):
        def too_slow(signum, frame):
            raise AssertionError("the helper waited on a pipe")
        previous = signal.signal(signal.SIGALRM, too_slow)
        signal.alarm(10)                                 # a hang fails this test instead of freezing the suite
        try:
            fifo = os.path.join(self.dir, "swapped.png")
            os.mkfifo(fifo)
            with self.assertRaises(OSError):
                desk_art.open_regular(fifo)
            with self.assertRaises(desk_art.Failure):
                desk_art.read_image_header(fifo)
            with self.assertRaises(desk_art.Failure):
                desk_art.load_picture(fifo)
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, previous)
        real = os.path.join(self.dir, "real.png")
        with open(real, "wb") as handle:
            handle.write(png_bytes(2, 2, (1, 2, 3)))
        link = os.path.join(self.dir, "link.png")
        os.symlink(real, link)
        with self.assertRaises(OSError):
            desk_art.open_regular(link)
        with self.assertRaises(OSError):
            desk_art.open_regular(self.dir)              # a folder is not a regular file
        with desk_art.open_regular(real) as handle:
            self.assertEqual(handle.read(4), b"\x89PNG")
        self.assertEqual(desk_art.read_image_header(real)[0], "png")


class ReferenceStagingTests(SandboxCase):
    """Every reference is copied into the job's private folder under a name the helper chooses, and the generator
    gets the copy. Codex splits an -i value at commas, and reads the path some time after it was checked."""

    def exec_call(self):
        calls = self.sb.calls(self.sb.codex_log, "exec")
        self.assertEqual(len(calls), 1)
        return calls[0]

    def work_of(self, data):
        return os.path.join(self.sb.cache, "jobs", data["jobId"], "work")

    def picture(self, *parts, **options):
        return self.sb.write_png(os.path.join(self.sb.home, *parts), **options)

    def swapped_run(self, ref, swap, command="codex"):
        """Run a job in this process. swap(ref) happens between checking the references and copying them."""
        name = "find_" + command
        real_find = getattr(desk_art, name)

        def swap_then_find():
            swap(ref)
            return real_find()
        return self.inproc(command, "--inbox", self.sb.inbox, "--label", "x", "--prompt-stdin", "--ref", ref,
                           "--ref-root", self.sb.home, stdin="p", **{name: swap_then_find})

    def assert_refused_and_nothing_started(self, code, result, words):
        self.assertEqual((code, result["code"]), (2, "bad-input"), result)
        self.assertIn(words, result["error"])
        self.assertEqual(self.sb.calls(self.sb.codex_log, "exec"), [])
        self.assertEqual(self.sb.calls(self.sb.agy_log), [])
        self.assertEqual(os.listdir(os.path.join(self.sb.cache, "jobs")), [])        # the job folder was dropped
        self.assertEqual(self.sb.manifest(), [])

    def test_a_reference_path_with_a_comma_and_spaces_arrives_as_a_staged_path(self):
        ref = self.picture("Pictures", "kaito, front view.png", color=(1, 2, 3))
        data = self.codex(extra=("--ref", ref)).data
        call = self.exec_call()
        self.assertEqual(call["images"], [os.path.join(self.work_of(data), "refs", "ref1.png")])
        self.assertTrue(all("," not in token for token in call["argv"]), call["argv"])
        self.assertEqual(call["image_info"][0]["sha256"], desk_art.sha256_file(ref))
        self.assertEqual(self.sb.manifest()[0]["refs"][0]["name"], "kaito, front view.png")   # the name the caller used

    def test_a_reference_name_with_unusual_characters_is_listed_as_plain_ascii(self):
        name = "kaito%s %s front, 1.png" % (chr(0xe9), chr(0x2014))
        ref = self.picture("Pictures", name)
        result = self.codex(extra=("--ref", ref))                       # cli() insists on one line of ASCII
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["refsSent"][0]["name"], name)
        self.assertEqual(self.sb.manifest()[0]["refs"][0]["name"], name)

    def test_a_comma_in_the_work_folder_path_stops_a_codex_run_before_it_starts(self):
        ref = self.picture("Pictures", "a.png")
        cache = os.path.join(self.sb.home, "Library", "Caches", "desk,art")
        result = self.codex(extra=("--ref", ref), env={"DESK_ART_CACHE": cache})
        self.assert_failure(result, "bad-input")
        self.assertIn("comma", result.data["error"])
        self.assertEqual(self.sb.calls(self.sb.codex_log, "exec"), [])                 # codex never started
        self.assertEqual(os.listdir(os.path.join(cache, "jobs")), [])                  # and nothing was left behind
        self.assertEqual(self.sb.manifest(), [])

    def test_a_decoy_path_with_a_comma_cannot_reach_a_file_that_was_never_checked(self):
        """<folder>/x,<absolute path of a private picture> is one real path, but Codex would read it as two."""
        private = self.picture("Library", "Messages", "private.png", color=(7, 7, 7))
        decoy = os.path.join(self.sb.art, "x,") + private
        self.sb.write_png(decoy, color=(4, 4, 4))
        data = self.codex(extra=("--ref", decoy)).data
        call = self.exec_call()
        self.assertEqual(call["images"], [os.path.join(self.work_of(data), "refs", "ref1.png")])
        self.assertNotIn(private, " ".join(call["argv"]))
        self.assertEqual(call["image_info"][0]["sha256"], desk_art.sha256_file(decoy))

    def test_copies_are_private_files_with_names_the_helper_chose(self):
        png = self.picture("Pictures", "a b, c.png")
        jpg = self.sb.write_file(os.path.join(self.sb.home, "Pictures", "x.jpeg"), jpeg_bytes())
        webp = self.sb.write_file(os.path.join(self.sb.home, "Pictures", "-y.webp"), webp_vp8x(8, 8))
        data = self.codex(extra=("--ref", png, "--ref", jpg, "--ref", webp)).data
        call = self.exec_call()
        refs = os.path.join(self.work_of(data), "refs")
        self.assertEqual(call["images"], [os.path.join(refs, name) for name in ("ref1.png", "ref2.jpg", "ref3.webp")])
        self.assertEqual([info["mode"] for info in call["image_info"]], ["0o600"] * 3)
        self.assertEqual({info["dir_mode"] for info in call["image_info"]}, {"0o700"})
        self.assertEqual([r["name"] for r in self.sb.manifest()[0]["refs"]], ["a b, c.png", "x.jpeg", "-y.webp"])

    def test_a_file_already_sitting_at_a_staged_name_is_refused_and_never_written_through(self):
        ref = self.picture("Pictures", "ref.png")
        victim = os.path.join(self.sb.root, "victim.txt")
        with open(victim, "w") as handle:
            handle.write("not yours")
        with mock.patch.dict(os.environ, self.sb.env(), clear=True):
            refs = desk_art.check_refs([ref], [self.sb.home])
            for plant in ("regular file", "link"):
                job = desk_art.make_job()
                folder = os.path.join(job.work, "refs")
                os.makedirs(folder)
                if plant == "link":
                    os.symlink(victim, os.path.join(folder, "ref1.png"))
                else:
                    with open(os.path.join(folder, "ref1.png"), "wb") as handle:
                        handle.write(b"stale" * 100000)
                with self.assertRaises(desk_art.Failure) as caught:
                    desk_art.stage_refs(job, refs)
                self.assertEqual(caught.exception.code, "bad-input", plant)
                self.assertIn("could not be copied", caught.exception.error)
                self.assertFalse(os.path.exists(job.dir))                  # nothing had run, so nothing is kept
        with open(victim) as handle:
            self.assertEqual(handle.read(), "not yours")

    def test_a_reference_replaced_by_another_file_after_the_check_is_refused(self):
        ref = self.picture("Pictures", "ref.png", color=(1, 2, 3))
        code, result = self.swapped_run(ref, replace_by_another_picture)
        self.assert_refused_and_nothing_started(code, result, "changed after it was checked")

    def test_a_reference_replaced_by_a_link_after_the_check_is_refused_and_not_followed(self):
        secret = self.picture(".ssh", "key.png", color=(7, 7, 7))
        ref = self.picture("Pictures", "ref.png", color=(1, 2, 3))

        def swap_for_a_link(path):
            os.remove(path)
            os.symlink(secret, path)
        code, result = self.swapped_run(ref, swap_for_a_link)
        self.assert_refused_and_nothing_started(code, result, "could not be opened")
        with open(secret, "rb") as handle:
            secret_bytes = handle.read()
        for folder, _, names in os.walk(self.sb.cache):
            for name in names:
                with open(os.path.join(folder, name), "rb") as handle:
                    self.assertNotEqual(handle.read(), secret_bytes)

    def test_a_reference_replaced_by_a_pipe_after_the_check_is_refused_without_waiting_for_it(self):
        ref = self.picture("Pictures", "ref.png", color=(1, 2, 3))

        def swap_for_a_pipe(path):
            os.remove(path)
            os.mkfifo(path)

        def give_up(signum, frame):
            raise AssertionError("the helper is waiting for a pipe that nobody writes to")
        previous = signal.signal(signal.SIGALRM, give_up)
        signal.alarm(20)
        try:
            code, result = self.swapped_run(ref, swap_for_a_pipe)
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, previous)
        self.assert_refused_and_nothing_started(code, result, "changed after it was checked")

    def test_what_is_sent_is_what_was_hashed_when_a_file_is_rewritten_in_place(self):
        ref = self.picture("Pictures", "ref.png", color=(1, 2, 3))
        newer = png_bytes(8, 8, (9, 9, 9))
        code, result = self.swapped_run(ref, rewrite_in_place(newer))
        self.assertEqual(code, 0, result)
        sha = desk_art.sha256_file(ref)                              # the file now holds the newer picture
        self.assertEqual(sha, hashlib.sha256(newer).hexdigest())
        self.assertEqual(self.exec_call()["image_info"][0]["sha256"], sha)         # Codex saw exactly these bytes
        self.assertEqual(self.sb.manifest()[0]["refs"], [{"name": "ref.png", "sha256": sha}])
        self.assertEqual(result["refsSent"], [{"name": "ref.png", "sha8": sha[:8], "bytes": len(newer)}])

    def test_the_bytes_are_checked_again_after_they_are_read(self):
        cases = {
            "is not a PNG, JPEG or WEBP picture": b"just words, no picture here",
            "is not a readable PNG, JPEG or WEBP picture": b"\x89PNG\r\n\x1a\n" + b"only text after the signature",
        }
        for words, data in cases.items():
            ref = self.picture("Pictures", "ref%d.png" % len(words), color=(len(words), 0, 0))
            code, result = self.swapped_run(ref, rewrite_in_place(data))
            self.assert_refused_and_nothing_started(code, result, words)
        grown = self.picture("Pictures", "grown.png", color=(5, 5, 5))

        def grow(path):
            with open(path, "r+b") as handle:
                handle.truncate(21 * 1024 * 1024)
        code, result = self.swapped_run(grown, grow)
        self.assert_refused_and_nothing_started(code, result, "bigger than 20 MB")

    def test_agy_copies_what_it_reads_too(self):
        ref = self.picture("Pictures", "ref.png", color=(1, 2, 3))
        code, result = self.swapped_run(ref, replace_by_another_picture, command="agy")
        self.assert_refused_and_nothing_started(code, result, "changed after it was checked")

    def test_a_file_that_only_starts_like_a_picture_is_refused_before_anything_is_started(self):
        signatures = {"png": b"\x89PNG\r\n\x1a\n" + b"this is only text after the signature",
                      "jpeg": b"\xff\xd8\xff" + b"this is only text after the signature",
                      "webp": b"RIFFabcdWEBP" + b"this is only text after the signature"}
        gone = {"DESK_ART_CODEX": "/nonexistent/codex", "DESK_ART_AGY": "/nonexistent/agy"}
        for kind, data in signatures.items():
            path = self.sb.write_file(os.path.join(self.sb.home, "Pictures", kind + "-signature.png"), data)
            for command in (self.codex, self.agy):
                result = command(extra=("--ref", path), env=dict(gone))
                self.assert_failure(result, "bad-input")                  # not codex-not-found: refused first
                self.assertIn("is not a readable PNG, JPEG or WEBP picture", result.data["error"], kind)

    def test_reference_copies_never_outlive_a_run(self):
        ref = self.picture("Pictures", "ref.png")
        ok = self.codex(extra=("--ref", ref)).data
        self.assertFalse(os.path.exists(os.path.join(self.sb.cache, "jobs", ok["jobId"])))      # all of it is gone
        refused = self.codex(extra=("--ref", ref), env={"FAKE_CODEX_MODE": "refusal"})
        self.assert_failure(refused, "codex-no-images")
        self.assertTrue(os.path.isdir(os.path.join(refused.data["jobDir"], "work")))             # kept for a look ...
        self.assertFalse(os.path.exists(os.path.join(refused.data["jobDir"], "work", "refs")))   # ... without the copies
        failed = self.codex(extra=("--ref", ref), env={"FAKE_CODEX_MODE": "error"})
        self.assert_failure(failed, "codex-failed")
        self.assertFalse(os.path.exists(os.path.join(failed.data["jobDir"], "work", "refs")))

    def test_reference_copies_are_deleted_even_when_something_unexpected_goes_wrong(self):
        ref = self.picture("Pictures", "ref.png")

        def boom(*args, **kwargs):
            raise RuntimeError("something odd")
        for command, target in (("codex", "build_codex_argv"), ("agy", "build_agy_argv")):
            before = set(os.listdir(os.path.join(self.sb.cache, "jobs"))) if os.path.isdir(
                os.path.join(self.sb.cache, "jobs")) else set()
            code, result = self.inproc(command, "--inbox", self.sb.inbox, "--label", "x", "--prompt-stdin", "--ref", ref,
                                       "--ref-root", self.sb.home, stdin="p", **{target: boom})
            self.assertEqual((code, result["code"]), (1, "internal"), command)
            (job,) = set(os.listdir(os.path.join(self.sb.cache, "jobs"))) - before
            self.assertTrue(os.path.isdir(os.path.join(self.sb.cache, "jobs", job, "work")))
            self.assertFalse(os.path.exists(os.path.join(self.sb.cache, "jobs", job, "work", "refs")), command)

    def test_references_sent_are_listed_for_a_failed_run_too(self):
        ref = self.picture("Pictures", "kaito, one.png", color=(1, 2, 3))
        sha = desk_art.sha256_file(ref)
        expected = [{"name": "kaito, one.png", "sha8": sha[:8], "bytes": os.path.getsize(ref)}]
        for mode in ("refusal", "error", "silentfail"):
            result = self.codex(extra=("--ref", ref), env={"FAKE_CODEX_MODE": mode})
            self.assertIs(result.data["ok"], False)
            self.assertEqual(result.data["refsSent"], expected, mode)
        early = self.codex(extra=("--ref", ref), env={"DESK_ART_CODEX": "/nonexistent/codex"})
        self.assert_failure(early, "codex-not-found")
        self.assertNotIn("refsSent", early.data)                      # nothing had been copied or sent yet


# ---------------------------------------------------------------------------
# Folders pictures may be sent from (ADV-1)
# ---------------------------------------------------------------------------

class ReferenceFolderTests(SandboxCase):
    """Every reference goes to OpenAI or Google, so only pictures in a short list of folders can be sent."""

    GONE = {"DESK_ART_CODEX": "/nonexistent/codex", "DESK_ART_AGY": "/nonexistent/agy"}

    def verdict(self, path, *roots, **options):
        """(exit code, result) of a job whose programs are missing: 'not found' proves the picture was accepted."""
        args = [options.get("command", "codex"), "--inbox", self.sb.inbox, "--label", "x", "--prompt-stdin",
                "--ref", path]
        for root in roots:
            args += ["--ref-root", root]
        return self.inproc(*args, stdin="p", env=dict(self.GONE))

    def accepted(self, path, *roots):
        code, result = self.verdict(path, *roots)
        self.assertEqual((code, result["code"]), (2, "codex-not-found"), (path, result))

    def refused(self, path, *roots):
        code, result = self.verdict(path, *roots)
        self.assertEqual((code, result["code"]), (2, "bad-input"), (path, result))
        self.assertIn("is not in a folder desk-art may send from", result["error"])
        return result["error"]

    def home_path(self, *parts):
        return os.path.join(self.sb.home, *parts)

    def test_without_a_setting_only_the_games_art_folders_the_inbox_and_the_cache_are_allowed(self):
        for path in (self.home_path("Desktop", "JJKgame.md", "a.png"), self.home_path("Desktop", "JJK Game images", "b.png"),
                     self.home_path("Desktop", "Character reworks", "c.png"),
                     self.home_path("Desktop", "JJK_worktrees", "branch", "deep", "d.png"),
                     os.path.join(self.sb.inbox, "2026-11-04", "e.png"),
                     os.path.join(self.sb.cache, "jobs", "x", "work", "f.png")):
            self.sb.write_png(path)
            self.accepted(path)
        for path in (self.home_path("Pictures", "p.png"), self.home_path("Desktop", "p.png"),
                     self.home_path("Downloads", "p.png"), self.home_path("Documents", "p.png"),
                     self.home_path("Desktop", "JJKgame.md-old", "p.png"),            # starts like an allowed folder
                     self.home_path("Desktop", "JJK Game images 2", "p.png")):
            self.sb.write_png(path)
            self.refused(path)

    def test_the_refusal_names_the_allowed_folders_and_how_to_change_them(self):
        path = self.sb.write_png(self.home_path("Pictures", "kaito.png"))
        allowed = [self.home_path(name) for name in DEFAULT_ROOT_NAMES] + [self.sb.inbox, self.sb.cache]
        self.assertEqual(self.refused(path), (
            "reference %s is not in a folder desk-art may send from. Allowed: %s. Copy the picture into one of those "
            "folders, or change the mod's \"Folders pictures may be sent from\" setting." % (path, ", ".join(allowed))))

    def test_agy_follows_the_same_rule(self):
        outside = self.sb.write_png(self.home_path("Pictures", "kaito.png"))
        inside = self.sb.write_png(self.home_path("Desktop", "JJKgame.md", "kaito.png"))
        code, result = self.verdict(outside, command="agy")
        self.assertEqual((code, result["code"]), (2, "bad-input"))
        self.assertIn("Allowed:", result["error"])
        code, result = self.verdict(inside, command="agy")
        self.assertEqual((code, result["code"]), (2, "agy-not-installed"))

    def test_chosen_folders_replace_the_defaults_but_the_inbox_and_the_cache_always_stay(self):
        mine = self.sb.write_png(self.home_path("Pictures", "mine.png"))
        art = self.sb.write_png(self.home_path("Desktop", "JJKgame.md", "art.png"))
        other = self.sb.write_png(self.home_path("Sketches", "other.png"))
        inbox_one = self.sb.write_png(os.path.join(self.sb.inbox, "i.png"))
        cache_one = self.sb.write_png(os.path.join(self.sb.cache, "c.png"))
        for roots in (["~/Pictures"], [self.home_path("Pictures")], [self.home_path("Pictures") + "/"],
                      ["~/Pictures", "~/Sketches"]):
            self.accepted(mine, *roots)
            self.accepted(inbox_one, *roots)
            self.accepted(cache_one, *roots)
            self.refused(art, *roots)                                   # the defaults are replaced, not added to
        self.accepted(other, "~/Pictures", "~/Sketches")
        self.refused(other, "~/Pictures")

    def test_a_link_inside_an_allowed_folder_that_leads_outside_it_is_refused(self):
        outside = self.sb.write_png(self.home_path("Pictures", "private.png"))
        link = self.home_path("Desktop", "JJKgame.md", "innocent.png")
        os.makedirs(os.path.dirname(link))
        os.symlink(outside, link)
        self.refused(link)

    def test_the_other_rules_still_apply_inside_an_allowed_folder(self):
        hidden = self.sb.write_png(self.home_path(".ssh", "key.png"))
        library = self.sb.write_png(self.home_path("Library", "Mail", "x.png"))
        secret = self.sb.write_png(self.home_path("Desktop", "JJKgame.md", ".env"))
        beyond = self.sb.write_png(os.path.join(self.sb.outside, "o.png"))
        for path, words in ((hidden, "hidden folder"), (library, "~/Library"), (secret, "secrets or sign-in"),
                            (beyond, "not inside your home folder")):
            code, result = self.verdict(path, self.sb.home, self.sb.outside, "/")
            self.assertEqual((code, result["code"]), (2, "bad-input"), path)
            self.assertIn(words, result["error"])
            self.assertNotIn("Copy the picture into one of those folders", result["error"])     # no false way out

    def test_the_folder_list_itself_is_checked(self):
        picture = self.sb.write_png(self.home_path("Pictures", "mine.png"))
        for bad in (["relative/folder"], ["Pictures"], ["~other/x"], ["/a\nb"], ["/a\x00b"], [""]):
            code, result = self.verdict(picture, *bad)
            self.assertEqual((code, result["code"]), (2, "bad-input"), bad)
            self.assertIn("--ref-root", result["error"])
        too_many = ["~/Folder%d" % number for number in range(21)]
        code, result = self.verdict(picture, *too_many)
        self.assertEqual((code, result["code"]), (2, "bad-input"))
        self.assertIn("at most 20", result["error"])
        code, result = self.verdict(picture, *too_many[:20])            # twenty is fine: only the picture is refused
        self.assertIn("is not in a folder desk-art may send from", result["error"])

    def test_ingest_takes_pictures_from_downloads_and_the_generators_own_folders_without_any_setting(self):
        sources = [self.sb.write_png(self.home_path("Downloads", "d.png"), color=(1, 1, 1)),
                   self.sb.write_png(os.path.join(self.sb.codex_home, "generated_images", "t1", "exec-1.png"),
                                     color=(2, 2, 2)),
                   self.sb.write_file(os.path.join(self.sb.gemini_home, "antigravity", "brain", "c1", "x_1.jpg"),
                                      jpeg_bytes()),
                   self.sb.write_file(os.path.join(self.sb.gemini_home, "antigravity-cli", "brain", "c2", "x_2.jpg"),
                                      jpeg_bytes(width=7)),
                   self.sb.write_png(self.home_path("Desktop", "JJKgame.md", "a.png"), color=(3, 3, 3)),
                   self.sb.write_png(os.path.join(self.sb.inbox, "i.png"), color=(4, 4, 4)),
                   self.sb.write_png(os.path.join(self.sb.cache, "jobs", "x", "work", "out", "c.png"), color=(5, 5, 5))]
        for path in sources:
            result = self.cli("ingest", "--label", "pic", "--backend", "other", "--file", path)
            self.assertEqual(result.code, 0, (path, result.out))

    def test_ingest_refuses_a_private_picture_elsewhere_and_names_the_folders(self):
        private = self.sb.write_png(self.home_path("Pictures", "private.png"))
        desktop = self.sb.write_png(self.home_path("Desktop", "screenshot.png"), color=(8, 8, 8))
        allowed = ([self.home_path(name) for name in DEFAULT_ROOT_NAMES] + [self.sb.inbox, self.sb.cache,
                   self.home_path("Downloads"), os.path.join(self.sb.codex_home, "generated_images"),
                   os.path.join(self.sb.gemini_home, "antigravity", "brain"),
                   os.path.join(self.sb.gemini_home, "antigravity-cli", "brain")])
        for path in (private, desktop):
            result = self.cli("ingest", "--label", "pic", "--backend", "other", "--file", path)
            self.assert_failure(result, "bad-input")
            self.assertEqual(result.data["error"], (
                "file %s is not in a folder desk-art may send from. Allowed: %s. Copy the picture into one of those "
                "folders, or change the mod's \"Folders pictures may be sent from\" setting." % (path, ", ".join(allowed))))
        self.assertEqual((self.sb.manifest(), self.sb.filed_files()), ([], []))      # nothing slipped through

    def test_the_folder_rule_is_checked_before_a_picture_is_opened(self):
        private = self.sb.write_png(self.home_path("Pictures", "private.png"))
        opened = []
        real_open = open

        def spy(target, *args, **kwargs):
            opened.append(str(target))
            return real_open(target, *args, **kwargs)
        for argv in (["codex", "--label", "x", "--prompt-stdin", "--ref", private],
                     ["agy", "--label", "x", "--prompt-stdin", "--ref", private],
                     ["ingest", "--label", "x", "--backend", "other", "--file", private]):
            with mock.patch("builtins.open", spy):
                code, result = self.inproc(*argv, stdin=b"p")
            self.assertEqual((code, result["code"]), (2, "bad-input"), argv)
        self.assertEqual([p for p in opened if p == private], [])


# ---------------------------------------------------------------------------
# What a generator may hand back
# ---------------------------------------------------------------------------

class ChildOutputTests(SandboxCase):
    def test_a_line_nested_too_deep_and_a_huge_integer_do_not_stop_a_codex_run(self):
        started = time.time()
        result = self.codex(env={"FAKE_CODEX_MODE": "hostile"})
        self.assertEqual(result.code, 0, result.out[:300])
        self.assertEqual((len(result.data["images"]), result.data["finalMessage"]), (1, "Done."))
        self.assertLess(time.time() - started, 30)

    def test_child_json_is_read_defensively(self):
        loads = desk_art.loads_child_json
        self.assertEqual(loads('{"a": [1, 2.5, "x"], "b": null}'), {"a": [1, 2.5, "x"], "b": None})
        self.assertIsNone(loads("not json"))
        self.assertIsNone(loads(""))
        self.assertIsNone(loads("[" * 300000))                                  # RecursionError becomes None
        self.assertEqual(loads('{"n": %s}' % ("9" * 30))["n"], int("9" * 30))     # up to 30 digits it is a number
        self.assertEqual(loads('{"n": %s}' % ("9" * 31))["n"], 0)                 # beyond that it is not converted
        started = time.time()
        self.assertEqual(loads('{"n": ' + "9" * 600000 + "}"), {"n": 0})
        self.assertLess(time.time() - started, 1.0)                               # plain json.loads takes seconds

    def test_a_long_final_message_is_cut_to_2000_characters(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "bigmessage"})
        self.assertEqual(result.code, 0, result.out[:300])
        self.assertEqual(result.data["finalMessage"], "W" * 2000)
        events = desk_art.parse_codex_events(json.dumps(
            {"type": "item.completed", "item": {"type": "agent_message", "text": "  " + "x" * 2100 + "  "}}).encode())
        self.assertEqual(events["message"], "x" * 2000)

    def test_only_the_known_whole_number_token_counts_are_passed_on(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "oddusage"})
        self.assertEqual(result.code, 0, result.out[:300])
        self.assertEqual(result.data["usage"], {"input_tokens": 100, "cached_input_tokens": 50,
                                                "reasoning_output_tokens": 3})        # "seven", True, text and dicts: out
        known = desk_art.known_usage
        self.assertIsNone(known(None))
        self.assertIsNone(known([1, 2]))
        self.assertIsNone(known({"note": "x", "output_tokens": 1.5, "input_tokens": True}))
        self.assertEqual(known({"cache_write_input_tokens": 0, "output_tokens": 454, "other": 1}),
                         {"cache_write_input_tokens": 0, "output_tokens": 454})

    def test_one_call_files_at_most_sixteen_pictures_and_the_rest_can_be_filed_later(self):
        result = self.codex(env={"FAKE_CODEX_MODE": "many"})
        self.assertEqual(result.code, 0, result.out[:300])
        self.assertEqual(len(result.data["images"]), 16)
        self.assertEqual(result.data["skipped"], 4)
        self.assertIn("16", result.data["skippedHint"])
        self.assertIn("ingest", result.data["skippedHint"])
        self.assertTrue(result.data["threadFolder"].endswith(result.data["threadId"]))          # where the rest is
        self.assertIn(result.data["threadFolder"], result.data["skippedHint"])
        self.assertEqual(len(self.sb.manifest()), 16)
        self.assertTrue(os.path.isdir(result.data["jobDir"]))
        folder = os.path.join(self.sb.codex_home, "generated_images", result.data["threadId"])
        filed = {image["source"] for image in result.data["images"]}
        left = sorted(os.path.join(folder, name) for name in os.listdir(folder) if os.path.join(folder, name) not in filed)
        self.assertEqual([os.path.basename(path) for path in left], ["exec-%02d.png" % n for n in range(16, 20)])
        later = self.cli("ingest", "--label", "rest", "--backend", "codex", *sum((["--file", p] for p in left), []))
        self.assertEqual(later.code, 0, later.out)
        self.assertEqual([image["duplicate"] for image in later.data["images"]], [False] * 4)

    def test_a_call_also_stops_at_200_megabytes(self):
        def picture(number, size):
            return desk_art.Picture("/p/%d.png" % number, "/p/%d.png" % number, size, float(number), "png", 1, 1,
                                    "%064x" % number)
        mb = 1024 * 1024
        kept, left = desk_art.within_caps([picture(n, 60 * mb) for n in range(5)])
        self.assertEqual((len(kept), left), (3, 2))                              # 180 MB; a fourth would be 240
        kept, left = desk_art.within_caps([picture(n, 50 * mb) for n in range(4)])
        self.assertEqual((len(kept), left), (4, 0))                              # exactly 200 MB fits
        kept, left = desk_art.within_caps([picture(n, 10) for n in range(20)])
        self.assertEqual((len(kept), left), (16, 4))
        self.assertEqual(desk_art.within_caps([]), ([], 0))
        self.assertEqual(desk_art.skipped_fields(0), {})
        self.assertEqual(sorted(desk_art.skipped_fields(2)), ["skipped", "skippedHint"])
        self.assertEqual(desk_art.skipped_fields(2, desk_art.Job("j", "/jobs/j", "/jobs/j/work"))["jobDir"], "/jobs/j")

    def test_ingest_reports_what_it_left_out_when_the_bytes_run_out(self):
        paths = [self.sb.write_png(os.path.join(self.sb.home, "Downloads", "p%d.png" % n), color=(n, 9, 9))
                 for n in range(3)]
        size = os.path.getsize(paths[0])
        code, result = self.inproc("ingest", "--inbox", self.sb.inbox, "--label", "pic", "--backend", "other",
                                   *sum((["--file", p] for p in paths), []), MAX_FILED_BYTES=2 * size + 1)
        self.assertEqual(code, 0, result)
        self.assertEqual((len(result["images"]), result["skipped"]), (2, 1))
        self.assertNotIn("jobDir", result)
        self.assertEqual(len(self.sb.manifest()), 2)


# ---------------------------------------------------------------------------
# The test-only home override (SEC-5)
# ---------------------------------------------------------------------------

class HomeOverrideTests(SandboxCase):
    COMMANDS = {"status": ["status"], "codex": ["codex", "--label", "x", "--prompt-stdin"],
                "ingest": ["ingest", "--label", "x", "--backend", "other", "--file", "/x"],
                "wait-new": ["wait-new", "--since", "0"], "clip-image": ["clip-image", "--label", "x"]}

    def test_a_test_home_that_would_switch_the_rules_off_is_refused_by_every_subcommand(self):
        for home in ("/", "//", "/Users", "/Users/someone", "/a/b/..", "/tmp/..", "relative/dir/here", "~/x/y/z"):
            for name, argv in self.COMMANDS.items():
                code, result = self.inproc(*argv, stdin="p", env={"DESK_ART_HOME": home})
                self.assertEqual((code, result["code"]), (2, "bad-input"), (home, name))
                self.assertIn("DESK_ART_HOME", result["error"])
                self.assertIn("at least three parts", result["error"])

    def test_it_is_refused_through_the_program_too(self):
        result = self.cli("status", env={"DESK_ART_HOME": "/"})
        self.assert_failure(result, "bad-input")
        self.assertIn("DESK_ART_HOME", result.data["error"])

    def test_a_folder_three_levels_deep_is_believed(self):
        self.assertEqual(self.cli("status", env={"DESK_ART_HOME": "/Users/someone/test-home"}).code, 0)
        self.assertEqual(self.cli("status").code, 0)                       # and so is the sandbox home

    def test_the_real_home_is_used_when_nothing_is_set_whatever_its_depth(self):
        with mock.patch.dict(os.environ, {"HOME": "/Users/someone"}, clear=True):
            self.assertEqual(desk_art.home_dir(), "/Users/someone")


if __name__ == "__main__":
    unittest.main()
