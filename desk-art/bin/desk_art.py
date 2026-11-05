#!/usr/bin/env python3
"""desk-art helper, version 0.1.1.

Files pictures made by image generators that are already installed and signed
in on this Mac (Codex, the Antigravity CLI, the Gemini app) into one inbox
folder, with a manifest line for every picture. No API keys, no network code of
its own, no screen control. Standard library only (Python 3.9 syntax).

Run as:  /usr/bin/python3 bin/desk_art.py <subcommand> [flags]
Subcommands: status, codex, agy, ingest, wait-new, clip-image.  See --help.

Every call prints EXACTLY ONE JSON object on stdout (ASCII, single line).
Diagnostics go to stderr. Exit codes:
  0 ok;  2 handled failure ({"ok":false,"code":"<kebab>","error":"<text>"});
  3 usage error (code "usage");  1 unexpected exception (code "internal").
A prompt, a token or an environment value is never printed.

Test overrides (production uses the defaults): DESK_ART_HOME (the home used for
containment checks and for every default below; a value that is / or has fewer than
three path parts is refused), DESK_ART_INBOX, DESK_ART_CODEX, DESK_ART_CODEX_HOME,
DESK_ART_AGY, DESK_ART_GEMINI_HOME, DESK_ART_CACHE, DESK_ART_OSASCRIPT,
DESK_ART_APPS (the folder that holds the .app bundles) and DESK_ART_PS (the ps
program). A binary override replaces the search completely. Codex's own CODEX_HOME
is honoured when DESK_ART_CODEX_HOME is not set.
"""

import argparse
import collections
import errno
import fcntl
import hashlib
import io
import json
import math
import os
import re
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import threading
import time
import traceback
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

VERSION = "0.1.1"

# ---------------------------------------------------------------------------
# Limits and fixed texts
# ---------------------------------------------------------------------------

MAX_PROMPT_CHARS = 8000
MAX_PROMPT_BYTES = MAX_PROMPT_CHARS * 4          # UTF-8 never needs more per character
MAX_REFS = 6
MAX_REF_BYTES = 20 * 1024 * 1024
MAX_IMAGE_BYTES = 40 * 1024 * 1024
MAX_INGEST_FILES = 16
MAX_NOTE_CHARS = 300
MANIFEST_PROMPT_CHARS = 4000
MAX_REF_ROOTS = 20
MAX_FILED_PICTURES = 16                           # one call files at most this many pictures ...
MAX_FILED_BYTES = 200 * 1024 * 1024               # ... and at most this many bytes in all
MAX_MESSAGE_CHARS = 2000                          # an agent's last words, as handed to the caller
MAX_JSON_INT_DIGITS = 30                          # longer integers in a generator's JSON are not converted
MAX_ENVELOPE_FAILURES = 300                       # '{' places tried in agy's output before giving up looking
USAGE_FIELDS = ("input_tokens", "cached_input_tokens", "cache_write_input_tokens", "output_tokens",
                "reasoning_output_tokens")        # the token counts Codex reports; nothing else is passed on

DEFAULT_TIMEOUT = 480.0
MIN_TIMEOUT = 30.0
MAX_TIMEOUT = 540.0
DEFAULT_WAIT_TIMEOUT = 120.0
MIN_WAIT_TIMEOUT = 1.0
MAX_MIN_COUNT = 8
MAX_SETTLE = 30.0
PROBE_TIMEOUT = 10.0                              # version / login / ps / sips probes
CLIPBOARD_TIMEOUT = 20.0

PIPE_CAP = 4 * 1024 * 1024                        # stdout and stderr of a child, each
PIPE_JOIN_SEC = 2.0
KILL_GRACE_SEC = 5.0                              # SIGTERM first, SIGKILL after this
QUIET_SEC = 1.0                                   # a file untouched this long is finished
QUIET_MAX_WAIT_SEC = 10.0
POLL_SEC = 1.0                                    # wait-new polling interval
MAX_SCANNED_FILES = 50000

LABEL_RE = re.compile(r"[a-z0-9][a-z0-9_-]{0,39}")
MODEL_RE = re.compile(r"[A-Za-z0-9._:-]{1,64}")
SAFE_ID_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,99}")
JOB_ID_FORMAT = "%Y%m%dT%H%M%S"

IMAGE_EXTS = (".png", ".jpg", ".jpeg", ".webp")
FILE_EXT = {"png": "png", "jpeg": "jpg", "webp": "webp"}
PARTIAL_SUFFIXES = (".crdownload", ".download", ".part", ".tmp")
BACKENDS = ("codex", "agy", "gemini-app", "other")
CLIP_BACKENDS = ("gemini-app", "other")

CODEX_BUNDLES = (
    "ChatGPT.app/Contents/Resources/codex-cli/bin/codex",
    "Codex.app/Contents/Resources/codex-cli/bin/codex",
)
AGY_INSTALL_LINE = "curl -fsSL https://antigravity.google/cli/install.sh | bash"

# Keys that would make a tool bill an API key instead of using the desktop sign-in.
SCRUBBED_ENV = ("OPENAI_API_KEY", "CODEX_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY")
# Beyond those four, a generator never needs the owner's other secrets: these names are dropped as well.
SECRET_ENV_PREFIXES = ("AWS_", "AZURE_", "GCP_", "GOOGLE_", "GEMINI_", "OPENAI_", "ANTHROPIC_", "GITHUB_",
                       "GH_", "GITLAB_", "NPM_", "HF_", "HUGGINGFACE_", "SLACK_")
SECRET_ENV_WORDS = ("TOKEN", "SECRET", "PASSWORD", "PASSWD", "CREDENTIAL", "PRIVATE_KEY", "API_KEY", "ACCESS_KEY")

# Codex features that are switched off on every run. VERIFIED 4 Nov 2026 (codex-cli 0.164.0-alpha.11.1): with
# exactly this set a picture run with two attached references worked (1254x1254), a probe for the web said it
# could not, a probe that wrote a file failed (read-only sandbox), and the computer-use, browser, app and
# plugin tools were gone. Codex can still READ files and run read-only commands through its built-in code tool,
# and picture making depends on that: never switch off code_mode_host, skill_search or image_generation.
# Codex stops with "Unknown feature flag" for a name it no longer has, so a Codex update that renames one of
# these makes runs fail loudly instead of running unrestricted.
CODEX_DISABLED_FEATURES = (
    "shell_tool", "unified_exec", "unified_exec_tty", "computer_use", "browser_use", "browser_use_external",
    "browser_use_full_cdp_access", "in_app_browser", "view_image", "apps", "plugins", "multi_agent", "goals",
    "sleep_tool")
CODEX_HARDEN_ARGS = [arg for name in CODEX_DISABLED_FEATURES for arg in ("--disable", name)] \
    + ["-c", 'web_search="disabled"']

CODEX_WRAPPER = (
    "You are making artwork with your built-in image generation tool. Make exactly the "
    "image(s) described in REQUEST, using only that tool. If reference images are attached, "
    "keep the same character, outfit and art style unless REQUEST says otherwise. Do not run "
    "commands, do not read, list or open any file (the attached reference pictures are already "
    "in front of you), do not write or edit files, do not browse the web. When the image(s) are "
    "made, reply with one short sentence.\n\nREQUEST:\n"
)

# Where a reference picture may come from unless the caller names other folders (the TS layer passes the
# owner's "Folders pictures may be sent from" setting as repeated --ref-root).
DEFAULT_REF_ROOTS = ("~/Desktop/JJKgame.md", "~/Desktop/JJK Game images", "~/Desktop/Character reworks",
                     "~/Desktop/JJK_worktrees")

AGY_WRAPPER = (
    "Use only your image generation tool to make exactly the image(s) described in REQUEST. "
    "If REFERENCES are listed, view them first and keep the same character, outfit and art "
    "style unless REQUEST says otherwise. Do not run terminal commands and do not edit "
    "project files. If you can, also save a copy of each finished image into the ./out "
    "folder of the current directory. When done, reply with one short sentence.\n\nREQUEST:\n"
)

FAILURE_CODES = {
    "status": ("usage", "bad-input", "internal"),
    "codex": ("usage", "bad-input", "inbox-unsafe", "codex-not-found", "codex-not-logged-in",
              "codex-failed", "codex-timeout", "codex-no-images", "internal"),
    "agy": ("usage", "bad-input", "inbox-unsafe", "agy-not-installed", "agy-failed", "agy-timeout",
            "agy-no-images", "internal"),
    "ingest": ("usage", "bad-input", "inbox-unsafe", "internal"),
    "wait-new": ("usage", "bad-input", "timeout", "internal"),
    "clip-image": ("usage", "bad-input", "inbox-unsafe", "no-image-on-clipboard", "osascript-failed",
                   "not-an-image", "internal"),
}

Ref = collections.namedtuple("Ref", "name path fmt dev ino")             # a checked reference, not yet copied
Staged = collections.namedtuple("Staged", "name path fmt sha256 size")    # its private copy given to a generator
Picture = collections.namedtuple("Picture", "path source size mtime fmt width height sha256")
Job = collections.namedtuple("Job", "job_id dir work")
ProcResult = collections.namedtuple("ProcResult", "returncode stdout stderr timed_out error")


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------

class Failure(Exception):
    """A handled failure. It becomes {"ok":false,"code":...,"error":...} and exit code 2."""

    def __init__(self, code: str, error: str, **extra: Any) -> None:
        Exception.__init__(self, error)
        self.code = code
        self.error = error
        self.extra = extra

    def to_result(self) -> Dict[str, Any]:
        result = {"ok": False, "code": self.code, "error": self.error}
        result.update(self.extra)
        return result


class UsageError(Exception):
    def __init__(self, message: str, usage: str) -> None:
        Exception.__init__(self, message)
        self.message = message
        self.usage = usage


class HelpShown(Exception):
    def __init__(self, prog: str, text: str) -> None:
        Exception.__init__(self, prog)
        self.prog = prog
        self.text = text


# ---------------------------------------------------------------------------
# Environment, paths and the containment rule
# ---------------------------------------------------------------------------

def env_value(name: str) -> Optional[str]:
    value = os.environ.get(name)
    return value if value else None


def log(message: str) -> None:
    """Diagnostics to stderr. Callers never pass a prompt, a token or an environment value."""
    try:
        sys.stderr.write("desk-art: %s\n" % message)
        sys.stderr.flush()
    except (OSError, ValueError):
        pass


def one_line(text: Any, limit: int) -> str:
    return " ".join(str(text).split())[:limit]


def home_dir() -> str:
    given = env_value("DESK_ART_HOME")
    if given is None:
        return os.path.expanduser("~")
    parts = [part for part in os.path.normpath(given).split(os.sep) if part]
    if not os.path.isabs(given) or len(parts) < 3:
        # The override exists for tests. Set to / or to the parent of a real home it would switch the
        # "inside home, not hidden" rule off, so only a folder at least three levels deep is believed.
        raise Failure("bad-input", "DESK_ART_HOME (a setting for tests only) must be an absolute folder path "
                                   "with at least three parts, for example /Users/name/test-home")
    return given


def expand(path: str) -> str:
    if path == "~":
        return home_dir()
    if path.startswith("~/"):
        return os.path.join(home_dir(), path[2:])
    return path


def abs_path(path: str) -> str:
    return os.path.abspath(expand(path))


def real_path(path: str) -> str:
    return os.path.realpath(abs_path(path))


def codex_home() -> str:
    given = env_value("DESK_ART_CODEX_HOME") or env_value("CODEX_HOME")    # Codex itself reads CODEX_HOME
    return abs_path(given or os.path.join(home_dir(), ".codex"))


def gemini_home() -> str:
    return abs_path(env_value("DESK_ART_GEMINI_HOME") or os.path.join(home_dir(), ".gemini"))


def cache_dir() -> str:
    default = os.path.join(home_dir(), "Library", "Caches", "desk-art")
    return abs_path(env_value("DESK_ART_CACHE") or default)


def apps_dir() -> str:
    return env_value("DESK_ART_APPS") or "/Applications"


def default_inbox() -> str:
    return env_value("DESK_ART_INBOX") or os.path.join(
        home_dir(), "Desktop", "JJK Game images", "desk_art_inbox")


def location_problem(real: str, home: str) -> Optional[str]:
    """Why a real path is off limits, or None. Inside home, not hidden, not ~/Library."""
    prefix = home.rstrip(os.sep) + os.sep
    if not real.startswith(prefix):
        return "it is not inside your home folder"
    first = real[len(prefix):].split(os.sep, 1)[0]
    if first.startswith("."):
        return "it is inside a hidden folder (%s)" % first
    if first.lower() == "library":
        return "it is inside ~/Library"
    return None


def path_problem(real: str, extra_allowed: Tuple[str, ...] = ()) -> Optional[str]:
    problem = location_problem(real, os.path.realpath(home_dir()))
    if problem is None:
        return None
    for allowed in extra_allowed:
        if real.startswith(allowed.rstrip(os.sep) + os.sep):
            return None
    return problem


def secret_file_name(name: str) -> bool:
    """File names that hold secrets or sign-ins wherever they sit (safety rule 1): .env files,
    auth.json and keychain files. Checked before any file is opened, so not even a few bytes are read.
    The name is compared the way the Mac's file system compares it (APFS ignores case and Unicode
    forms), so a look-alike such as auth.j\u017fon (long s) is the same file."""
    lowered = unicodedata.normalize("NFKC", name).casefold()
    return (lowered == "auth.json" or lowered.startswith(".env") or lowered.endswith(".env")
            or lowered.endswith((".keychain", ".keychain-db")))


def inside_any(real: str, roots: List[str]) -> bool:
    return any(real.startswith(os.path.realpath(root).rstrip(os.sep) + os.sep) for root in roots)


def resolve_input_file(given: str, what: str, extra_allowed: Tuple[str, ...] = (),
                       roots: Optional[List[str]] = None) -> Tuple[str, os.stat_result]:
    """The real path and stat of an input file. The location rule and the secret-name rule come first, so a
    file that is never allowed is not told to "copy it into an allowed folder". With roots, the real path
    must also lie inside one of those folders."""
    real = real_path(given)
    problem = path_problem(real, extra_allowed)
    if problem:
        raise Failure("bad-input", "%s %s is not allowed: %s" % (what, given, problem))
    if secret_file_name(os.path.basename(given.rstrip(os.sep))) or secret_file_name(os.path.basename(real)):
        raise Failure("bad-input", "%s %s is not allowed: it looks like a secrets or sign-in file" % (what, given))
    if roots is not None and not inside_any(real, roots):
        raise Failure(
            "bad-input", "%s %s is not in a folder desk-art may send from. Allowed: %s. Copy the picture into "
            "one of those folders, or change the mod's \"Folders pictures may be sent from\" setting."
            % (what, given, ", ".join(roots)))
    try:
        info = os.stat(real)
    except OSError:
        raise Failure("bad-input", "%s %s was not found" % (what, given))
    if not stat.S_ISREG(info.st_mode):
        raise Failure("bad-input", "%s %s is not a regular file" % (what, given))
    return real, info


def checked_inbox_path(raw: str) -> str:
    real = real_path(raw)
    problem = path_problem(real)
    if problem:
        raise Failure(
            "inbox-unsafe", "the inbox folder %s is not allowed: %s" % (raw, problem),
            hint="use a folder inside your home folder, outside ~/Library and hidden folders")
    return real


def prepare_inbox(raw: Optional[str]) -> str:
    """The real inbox path, created. Checked before and after creating it."""
    real = checked_inbox_path(raw or default_inbox())
    try:
        os.makedirs(real, exist_ok=True)
    except OSError as exc:
        raise Failure("bad-input", "cannot create the inbox folder: %s" % (exc.strerror or exc))
    if checked_inbox_path(real) != real:
        raise Failure("inbox-unsafe", "the inbox folder changed while it was being created")
    return real


# ---------------------------------------------------------------------------
# Where pictures may come from
# ---------------------------------------------------------------------------

def configured_roots(given: Optional[List[str]]) -> List[str]:
    """The --ref-root folders, or the defaults, as absolute paths."""
    chosen = []  # type: List[str]
    for raw in given or DEFAULT_REF_ROOTS:
        if not raw.startswith(("/", "~/")) or any(ord(char) < 32 or ord(char) == 127 for char in raw):
            raise Failure("bad-input", "--ref-root must be a folder path that starts with / or ~/ and has "
                                       "no control characters")
        chosen.append(abs_path(raw))
    chosen = list(dict.fromkeys(chosen))
    if len(chosen) > MAX_REF_ROOTS:
        raise Failure("bad-input", "at most %d --ref-root folders are allowed" % MAX_REF_ROOTS)
    return chosen


def ref_sources(given: Optional[List[str]], inbox: Optional[str]) -> List[str]:
    """Folders a reference picture may come from: the chosen roots, the inbox (when it is usable) and the cache."""
    return list(dict.fromkeys(configured_roots(given) + ([inbox] if inbox else []) + [abs_path(cache_dir())]))


def generator_folders() -> List[str]:
    """Where Codex, the Antigravity app and the Antigravity CLI keep their own pictures (inside hidden folders of
    home). The CLI's folder was seen on 5 Nov 2026 (agy 1.5.0): antigravity-cli/brain/<conversation id>/."""
    return [os.path.join(codex_home(), "generated_images"),
            os.path.join(gemini_home(), "antigravity", "brain"),
            os.path.join(gemini_home(), "antigravity-cli", "brain")]


def ingest_roots(given: Optional[List[str]], inbox: str) -> List[str]:
    """Folders `ingest` may take pictures from: the reference folders, Downloads and the generators' own."""
    return list(dict.fromkeys(ref_sources(given, inbox) + [abs_path("~/Downloads")] + generator_folders()))


def cache_folder() -> Tuple[str, ...]:
    """The cache's real path, allowed as a source although it sits in ~/Library where the location rule says no."""
    return (os.path.realpath(cache_dir()),)


# ---------------------------------------------------------------------------
# Input validation (the authoritative rules)
# ---------------------------------------------------------------------------

def check_label(value: str) -> str:
    if not LABEL_RE.fullmatch(value):
        raise Failure(
            "bad-input", "label must be 1 to 40 characters: lower-case letters, digits, '_' "
            "or '-', starting with a letter or a digit")
    return value


def check_model(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    # A leading "-" is refused on top of the pattern: the slug goes right after --model in agy's
    # argument list, where "--dangerously-skip-permissions" (which the pattern allows) must never land.
    if not MODEL_RE.fullmatch(value) or value.startswith("-"):
        raise Failure("bad-input", "model must be 1 to 64 characters from A-Z a-z 0-9 . _ : - "
                                   "(and must not start with '-')")
    return value


def check_note(value: Optional[str]) -> Optional[str]:
    if value is None:
        return None
    if len(value) > MAX_NOTE_CHARS:
        raise Failure("bad-input", "note must be at most %d characters" % MAX_NOTE_CHARS)
    return value


def check_number(value: Optional[str], name: str, low: float, high: float, default: float,
                 whole: bool = False) -> float:
    if value is None:
        return default
    try:
        number = int(value) if whole else float(value)
    except ValueError:
        raise Failure("bad-input", "%s must be a %s" % (name, "whole number" if whole else "number"))
    if not math.isfinite(number) or number < low or number > high:
        raise Failure("bad-input", "%s must be between %s and %s" % (name, low, high))
    return number


def read_stdin_bytes(limit: int) -> bytes:
    stream = getattr(sys.stdin, "buffer", None)           # sys.stdin is None when fd 0 was closed
    if stream is None:
        raise Failure("bad-input", "standard input is not available, so the prompt cannot be read")
    try:
        return stream.read(limit)
    except (OSError, ValueError) as exc:
        raise Failure("bad-input", "the prompt could not be read from standard input: %s"
                      % one_line(getattr(exc, "strerror", None) or exc, 100))


def decode_prompt(data: bytes) -> str:
    if len(data) > MAX_PROMPT_BYTES:
        raise Failure("bad-input", "the prompt is longer than %d characters" % MAX_PROMPT_CHARS)
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        raise Failure("bad-input", "the prompt is not valid UTF-8")
    if "\x00" in text:
        raise Failure("bad-input", "the prompt contains a NUL character")
    text = text.strip()
    if not text:
        raise Failure("bad-input", "the prompt is empty")
    if len(text) > MAX_PROMPT_CHARS:
        raise Failure("bad-input", "the prompt is longer than %d characters" % MAX_PROMPT_CHARS)
    return text


def open_regular(path: str) -> Any:
    """Open a file for reading without following a link at the end of the path and without waiting on a pipe
    that was swapped in after the checks (O_NONBLOCK); anything that is not a regular file is refused. The
    OSError is for the caller to turn into its own failure."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    fd = os.open(path, flags)
    try:
        if not stat.S_ISREG(os.fstat(fd).st_mode):
            raise OSError(errno.EINVAL, "not a regular file")
        return os.fdopen(fd, "rb")
    except BaseException:
        os.close(fd)
        raise


def read_prompt(args: argparse.Namespace, required: bool) -> Optional[str]:
    """The prompt text from --prompt-stdin or --prompt-file (a file inside home, like a reference)."""
    if args.prompt_stdin:
        return decode_prompt(read_stdin_bytes(MAX_PROMPT_BYTES + 1))
    if args.prompt_file:
        real, info = resolve_input_file(args.prompt_file, "prompt file")
        if info.st_size > MAX_PROMPT_BYTES:
            raise Failure("bad-input", "the prompt file is longer than %d characters" % MAX_PROMPT_CHARS)
        try:
            with open_regular(real) as handle:
                return decode_prompt(handle.read(MAX_PROMPT_BYTES + 1))
        except OSError as exc:
            raise Failure("bad-input", "the prompt file could not be read: %s" % (exc.strerror or exc))
    if required:
        raise Failure("bad-input", "a prompt is required (--prompt-file or --prompt-stdin)")
    return None


def check_refs(given: List[str], roots: List[str]) -> List[Ref]:
    """Check the --ref files early, before any program is looked for. They are checked again, byte for
    byte, when stage_refs copies them."""
    if len(given) > MAX_REFS:
        raise Failure("bad-input", "at most %d reference pictures are allowed" % MAX_REFS)
    refs = []
    for path in given:
        real, info = resolve_input_file(path, "reference", cache_folder(), roots)
        if info.st_size > MAX_REF_BYTES:
            raise Failure("bad-input", "reference %s is bigger than 20 MB" % path)
        try:
            with open_regular(real) as handle:
                fmt = detect_format(handle.read(16))
        except OSError as exc:
            raise Failure("bad-input", "reference %s could not be read: %s" % (path, exc.strerror or exc))
        if fmt is None:
            raise Failure("bad-input", "reference %s is not a PNG, JPEG or WEBP picture" % path)
        try:
            read_image_header(real)                  # the signature alone is not enough: the header must read too
        except Failure:
            raise Failure("bad-input", "reference %s is not a readable PNG, JPEG or WEBP picture" % path)
        refs.append(Ref(os.path.basename(path), real, fmt, info.st_dev, info.st_ino))
    return refs


# ---------------------------------------------------------------------------
# Running other programs
# ---------------------------------------------------------------------------

class Capture:
    def __init__(self, cap: int) -> None:
        self.cap = cap
        self.data = bytearray()

    def add(self, chunk: bytes) -> None:
        room = self.cap - len(self.data)
        if room > 0:
            self.data += chunk[:room]


def pump(pipe: Any, capture: Capture) -> None:
    try:
        while True:
            line = pipe.readline(65536)
            if not line:
                return
            capture.add(line)
    except (OSError, ValueError):
        return


def feed(pipe: Any, data: bytes) -> None:
    """Write data to a child's stdin and always close the pipe, even when the child stopped reading."""
    try:
        try:
            pipe.write(data)
        finally:
            pipe.close()
    except (OSError, ValueError):
        pass


def secret_env_name(name: str) -> bool:
    upper = name.upper()
    return (upper == "SSH_AUTH_SOCK" or upper.startswith(SECRET_ENV_PREFIXES)
            or any(word in upper for word in SECRET_ENV_WORDS))


def child_env() -> Dict[str, str]:
    """The environment for a child tool: no API keys, so the desktop sign-in is used, and none of the owner's
    other credentials (cloud, git, npm and chat tokens, the ssh agent). CODEX_HOME and ordinary names stay."""
    env = dict(os.environ)
    for name in SCRUBBED_ENV:
        env.pop(name, None)
    return {name: value for name, value in env.items() if not secret_env_name(name)}


def signal_group(pgid: int, sig: int) -> bool:
    try:
        os.killpg(pgid, sig)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def stop_group(proc: "subprocess.Popen") -> None:
    """SIGTERM the whole process group, SIGKILL whatever is left after the grace period."""
    pgid = proc.pid
    if signal_group(pgid, signal.SIGTERM):
        deadline = time.monotonic() + KILL_GRACE_SEC
        while time.monotonic() < deadline:
            proc.poll()                      # reaps the leader once it has exited
            if not signal_group(pgid, 0):
                return
            time.sleep(0.05)
        signal_group(pgid, signal.SIGKILL)
    try:
        proc.wait(timeout=KILL_GRACE_SEC)
    except subprocess.TimeoutExpired:
        pass


def run_process(argv: List[str], timeout: float, cwd: Optional[str] = None,
                stdin_bytes: Optional[bytes] = None,
                env: Optional[Dict[str, str]] = None) -> ProcResult:
    """Run argv (a list, never a shell string) in its own process group.

    stdin is /dev/null unless stdin_bytes is given. stdout and stderr are captured
    up to PIPE_CAP each. On timeout, or if this helper is interrupted, the whole
    process group is stopped. Unless env is given, the child gets this helper's own
    environment without API keys (child_env), whichever program it is.
    """
    if env is None:
        env = child_env()
    try:
        proc = subprocess.Popen(
            argv, cwd=cwd, env=env, start_new_session=True,
            stdin=subprocess.PIPE if stdin_bytes is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as exc:
        return ProcResult(None, b"", b"", False, "%s: %s" % (type(exc).__name__, exc.strerror or exc))
    out, err = Capture(PIPE_CAP), Capture(PIPE_CAP)
    threads = [threading.Thread(target=pump, args=(proc.stdout, out), daemon=True),
               threading.Thread(target=pump, args=(proc.stderr, err), daemon=True)]
    if stdin_bytes is not None:
        threads.append(threading.Thread(target=feed, args=(proc.stdin, stdin_bytes), daemon=True))
    for thread in threads:
        thread.start()
    timed_out = False
    try:
        try:
            proc.wait(timeout=timeout)
        except subprocess.TimeoutExpired:
            timed_out = True
    finally:
        if timed_out or proc.poll() is None:
            stop_group(proc)
        for thread in threads:
            thread.join(PIPE_JOIN_SEC)
        if any(thread.is_alive() for thread in threads):
            signal_group(proc.pid, signal.SIGKILL)   # a leftover child still holds a pipe
            for thread in threads:
                thread.join(1.0)
        for pipe, thread in ((proc.stdout, threads[0]), (proc.stderr, threads[1])):
            if not thread.is_alive():
                pipe.close()
    return ProcResult(proc.returncode, bytes(out.data), bytes(err.data), timed_out, None)


def is_executable(path: str) -> bool:
    return os.path.isfile(path) and os.access(path, os.X_OK)


def first_line(data: bytes) -> str:
    lines = data.decode("utf-8", "replace").strip().splitlines()
    return lines[0].strip() if lines else ""


# ---------------------------------------------------------------------------
# Pictures: magic bytes and size
# ---------------------------------------------------------------------------

def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open_regular(path) as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def detect_format(head: bytes) -> Optional[str]:
    """png, jpeg or webp from the first bytes, else None."""
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if head.startswith(b"\xff\xd8\xff"):
        return "jpeg"
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "webp"
    return None


def png_size(handle: Any) -> Optional[Tuple[int, int]]:
    handle.seek(0)
    head = handle.read(24)
    if len(head) < 24 or head[12:16] != b"IHDR":
        return None
    width = int.from_bytes(head[16:20], "big")
    height = int.from_bytes(head[20:24], "big")
    return (width, height) if width and height else None


JPEG_SOF_MARKERS = frozenset(range(0xC0, 0xD0)) - {0xC4, 0xC8, 0xCC}


def jpeg_size(handle: Any) -> Optional[Tuple[int, int]]:
    handle.seek(2)
    for _ in range(4096):
        byte = handle.read(1)
        if not byte:
            return None
        if byte != b"\xff":
            continue
        marker = handle.read(1)
        while marker == b"\xff":
            marker = handle.read(1)
        if not marker:
            return None
        code = marker[0]
        if code in (0x00, 0x01) or 0xD0 <= code <= 0xD8:
            continue                                    # no length field
        if code in (0xD9, 0xDA):
            return None                                 # end or scan, and no frame header seen
        length = int.from_bytes(handle.read(2), "big")
        if length < 2:
            return None
        if code in JPEG_SOF_MARKERS:
            body = handle.read(5)
            if len(body) < 5:
                return None
            height = int.from_bytes(body[1:3], "big")
            width = int.from_bytes(body[3:5], "big")
            return (width, height) if width and height else None
        handle.seek(length - 2, 1)
    return None


def webp_size(handle: Any) -> Optional[Tuple[int, int]]:
    handle.seek(0)
    head = handle.read(30)
    kind = head[12:16]
    if kind == b"VP8 " and len(head) >= 30 and head[23:26] == b"\x9d\x01\x2a":
        width = int.from_bytes(head[26:28], "little") & 0x3FFF
        height = int.from_bytes(head[28:30], "little") & 0x3FFF
    elif kind == b"VP8L" and len(head) >= 25 and head[20] == 0x2F:
        bits = int.from_bytes(head[21:25], "little")
        width = (bits & 0x3FFF) + 1
        height = ((bits >> 14) & 0x3FFF) + 1
    elif kind == b"VP8X" and len(head) >= 30:
        width = 1 + int.from_bytes(head[24:27], "little")
        height = 1 + int.from_bytes(head[27:30], "little")
    else:
        return None
    return (width, height) if width and height else None


SIZE_READERS = {"png": png_size, "jpeg": jpeg_size, "webp": webp_size}


def sips_size(path: str) -> Optional[Tuple[int, int]]:
    sips = shutil.which("sips") or "/usr/bin/sips"
    result = run_process([sips, "-g", "pixelWidth", "-g", "pixelHeight", path], PROBE_TIMEOUT)
    if result.error or result.timed_out or result.returncode != 0:
        return None
    text = result.stdout.decode("utf-8", "replace")
    width = re.search(r"pixelWidth:\s*(\d+)", text)
    height = re.search(r"pixelHeight:\s*(\d+)", text)
    if not width or not height or int(width.group(1)) == 0 or int(height.group(1)) == 0:
        return None
    return int(width.group(1)), int(height.group(1))


def read_image_header(path: str) -> Tuple[str, int, int]:
    try:
        handle = open_regular(path)
    except OSError:
        raise Failure("not-an-image", "the file cannot be read")
    with handle:
        fmt = detect_format(handle.read(16))
        if fmt is None:
            raise Failure("not-an-image", "not a PNG, JPEG or WEBP picture")
        size = SIZE_READERS[fmt](handle)
    if size is None:
        size = sips_size(path)
    if size is None:
        raise Failure("not-an-image", "the picture size could not be read")
    return fmt, size[0], size[1]


def wait_until_quiet(path: str) -> None:
    """Wait (up to QUIET_MAX_WAIT_SEC) until nothing has written to the file for QUIET_SEC."""
    deadline = time.monotonic() + QUIET_MAX_WAIT_SEC
    while True:
        try:
            age = time.time() - os.stat(path).st_mtime
        except OSError:
            return
        if age >= QUIET_SEC or age < -1.0 or time.monotonic() >= deadline:
            return
        time.sleep(min(0.2, max(QUIET_SEC - age, 0.05)))


def load_picture(path: str) -> Picture:
    wait_until_quiet(path)
    try:
        info = os.stat(path)
    except OSError:
        raise Failure("not-an-image", "the file cannot be read")
    if not stat.S_ISREG(info.st_mode):
        raise Failure("not-an-image", "not a regular file")
    if info.st_size > MAX_IMAGE_BYTES:
        raise Failure("not-an-image", "bigger than 40 MB")
    fmt, width, height = read_image_header(path)
    try:
        digest = sha256_file(path)
    except OSError:
        raise Failure("not-an-image", "the file cannot be read")
    return Picture(path, path, info.st_size, info.st_mtime, fmt, width, height, digest)


def load_candidates(paths: List[str]) -> List[Picture]:
    pictures = []
    for path in paths:
        try:
            pictures.append(load_picture(path))
        except (Failure, OSError):
            continue
    return pictures


# ---------------------------------------------------------------------------
# Snapshot and diff of folders (how new pictures are found)
# ---------------------------------------------------------------------------

def safe_id(value: Any) -> Optional[str]:
    """A thread or conversation id that is safe to use as a folder name, else None."""
    if isinstance(value, str) and SAFE_ID_RE.fullmatch(value):
        return value
    return None


def list_image_files(root: str, max_depth: int) -> Dict[str, Tuple[int, int]]:
    """{path: (mtime_ns, size)} of regular files with a picture extension under root.

    Only stat() is used, and only files named like pictures are ever listed, so
    settings or token files that sit in the same tree are never opened.
    """
    found = {}  # type: Dict[str, Tuple[int, int]]
    if not os.path.isdir(root):
        return found
    root_depth = root.rstrip(os.sep).count(os.sep)
    for folder, dirs, names in os.walk(root, followlinks=False):
        if folder.rstrip(os.sep).count(os.sep) - root_depth >= max_depth:
            dirs[:] = []
        for name in names:
            if os.path.splitext(name)[1].lower() not in IMAGE_EXTS:
                continue
            path = os.path.join(folder, name)
            try:
                info = os.lstat(path)
            except OSError:
                continue
            if stat.S_ISREG(info.st_mode):
                found[path] = (info.st_mtime_ns, info.st_size)
            if len(found) >= MAX_SCANNED_FILES:
                return found
    return found


def snapshot(roots: List[Tuple[str, int]]) -> Dict[str, Tuple[int, int]]:
    merged = {}  # type: Dict[str, Tuple[int, int]]
    for root, depth in roots:
        merged.update(list_image_files(root, depth))
    return merged


def changed_since(before: Dict[str, Tuple[int, int]], after: Dict[str, Tuple[int, int]],
                  min_mtime: Optional[float] = None) -> List[str]:
    chosen = []
    for path, signature in after.items():
        if before.get(path) == signature:
            continue
        if min_mtime is not None and signature[0] / 1e9 < min_mtime:
            continue
        chosen.append((signature[0], path))
    return [path for _, path in sorted(chosen)]


# ---------------------------------------------------------------------------
# Filing into the inbox
# ---------------------------------------------------------------------------

class Manifest:
    """<inbox>/manifest.jsonl, held under an exclusive lock while one call files pictures."""

    def __init__(self, inbox: str) -> None:
        self.path = os.path.join(inbox, "manifest.jsonl")
        self.handle = None  # type: Any

    def __enter__(self) -> "Manifest":
        # O_NOFOLLOW: a manifest.jsonl that is a link would make this read and append to some other file.
        try:
            fd = os.open(self.path, os.O_RDWR | os.O_APPEND | os.O_CREAT | os.O_NOFOLLOW, 0o644)
        except OSError as exc:
            if exc.errno == errno.ELOOP:
                raise Failure("inbox-unsafe", "manifest.jsonl in the inbox is a link, so it was not used",
                              hint="delete or rename that link, then try again")
            raise
        self.handle = os.fdopen(fd, "a+b")
        fcntl.flock(self.handle.fileno(), fcntl.LOCK_EX)
        return self

    def __exit__(self, *unused: Any) -> None:
        try:
            fcntl.flock(self.handle.fileno(), fcntl.LOCK_UN)
        finally:
            self.handle.close()

    def entries(self) -> List[Dict[str, Any]]:
        self.handle.seek(0)
        found = []
        for line in self.handle.read().decode("utf-8", "replace").split("\n"):
            try:
                item = json.loads(line) if line.strip() else None
            except (ValueError, RecursionError):               # a damaged or hostile line is skipped
                continue
            if isinstance(item, dict):
                found.append(item)
        return found

    def append(self, entry: Dict[str, Any]) -> None:
        size = self.handle.seek(0, os.SEEK_END)
        lead = b""
        if size > 0:
            self.handle.seek(size - 1)
            lead = b"" if self.handle.read(1) == b"\n" else b"\n"
        line = json.dumps(entry, ensure_ascii=True, separators=(",", ":"))
        self.handle.write(lead + line.encode("ascii") + b"\n")
        self.handle.flush()
        os.fsync(self.handle.fileno())


def utc_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def new_job_id() -> str:
    return time.strftime(JOB_ID_FORMAT, time.gmtime()) + "-" + secrets.token_hex(3)


def find_filed(inbox: str, entries: List[Dict[str, Any]], sha: str) -> Optional[str]:
    for entry in reversed(entries):
        relative = entry.get("file")
        if entry.get("sha256") != sha or not isinstance(relative, str):
            continue
        if os.path.isabs(relative) or ".." in relative.split("/"):
            continue
        path = os.path.join(inbox, relative)
        if os.path.isfile(path) and not os.path.islink(path):
            return path
    return None


def copy_into_folder(picture: Picture, folder: str, base: str) -> str:
    """Copy through a temp name, then rename. Never overwrites a different file, and never writes
    through a link: a day folder that is a link leading elsewhere is refused (safety rule 6)."""
    try:
        os.makedirs(folder, exist_ok=True)
    except OSError as exc:
        raise Failure("bad-input", "cannot create the inbox day folder: %s" % (exc.strerror or exc))
    if os.path.realpath(folder) != folder:
        raise Failure("inbox-unsafe", "the inbox day folder %s is a link that leads elsewhere" % folder,
                      hint="delete or rename that link, then try again")
    extension = FILE_EXT[picture.fmt]
    dest = os.path.join(folder, "%s.%s" % (base, extension))
    number = 1
    # a link is never read through (it could point at any file), so it counts as "a different file"
    while os.path.lexists(dest) and (os.path.islink(dest) or sha256_file(dest) != picture.sha256):
        number += 1
        dest = os.path.join(folder, "%s-%d.%s" % (base, number, extension))
    if os.path.lexists(dest):
        return dest                                       # the same picture is already there
    temp = os.path.join(folder, ".incoming-%s.tmp" % secrets.token_hex(4))
    try:
        shutil.copyfile(picture.path, temp)
        if os.path.getsize(temp) != picture.size or sha256_file(temp) != picture.sha256:
            raise Failure("bad-input", "a picture changed while it was being copied")
        os.replace(temp, dest)
    finally:
        if os.path.exists(temp):
            os.remove(temp)
    return dest


def image_record(path: str, picture: Picture, duplicate: bool) -> Dict[str, Any]:
    return {"path": path, "sha256": picture.sha256, "bytes": picture.size,
            "width": picture.width, "height": picture.height, "format": picture.fmt,
            "source": picture.source, "duplicate": duplicate}


def manifest_entry(inbox: str, dest: str, picture: Picture, backend: str, label: str,
                   job_id: str, provenance: Dict[str, Any]) -> Dict[str, Any]:
    prompt = provenance.get("prompt")
    return {
        "ts": utc_iso(), "backend": backend, "label": label, "jobId": job_id,
        "file": os.path.relpath(dest, inbox).replace(os.sep, "/"),
        "sha256": picture.sha256, "bytes": picture.size, "width": picture.width,
        "height": picture.height, "format": picture.fmt, "source": picture.source,
        "threadId": provenance.get("threadId"),
        "conversationId": provenance.get("conversationId"),
        "model": provenance.get("model"),
        "promptSha256": sha256_text(prompt) if prompt else None,
        "prompt": prompt[:MANIFEST_PROMPT_CHARS] if prompt else None,
        "refs": [{"name": ref.name, "sha256": ref.sha256} for ref in provenance.get("refs") or []],
        "note": provenance.get("note"),
    }


def within_caps(ordered: List[Picture]) -> Tuple[List[Picture], int]:
    """The first pictures that fit one call's limits, and how many are left over."""
    kept = []  # type: List[Picture]
    total = 0
    for picture in ordered:
        if len(kept) >= MAX_FILED_PICTURES or total + picture.size > MAX_FILED_BYTES:
            break
        kept.append(picture)
        total += picture.size
    return kept, len(ordered) - len(kept)


def skipped_fields(skipped: int, job: Optional[Job] = None, folder: Optional[str] = None) -> Dict[str, Any]:
    """Words for the pictures one call did not file, and the job folder that stays for them. `folder` is where a
    generator that keeps its own pictures (Codex) left the rest."""
    if skipped <= 0:
        return {}
    where = "in %s" % folder if folder else "where the generator left them"
    fields = {"skipped": skipped,
              "skippedHint": "%d more picture(s) were not filed: one call files at most %d pictures and %d MB. They "
                             "are still %s: `ingest` can file them from there in smaller groups."
                             % (skipped, MAX_FILED_PICTURES, MAX_FILED_BYTES // (1024 * 1024), where)}  # type: Dict[str, Any]
    if folder:
        fields["threadFolder"] = folder
    if job is not None:
        fields["jobDir"] = job.dir
    return fields


def file_images(inbox: str, pictures: List[Picture], backend: str, label: str, job_id: str,
                provenance: Dict[str, Any]) -> Tuple[List[Dict[str, Any]], int]:
    """File pictures into <inbox>/<day>/ and the manifest. The one filing routine for every command.

    Pictures are numbered 01, 02, ... in order of their source mtime. A sha256 that
    is already filed (or filed earlier in this call) is not copied again. One call files at most
    MAX_FILED_PICTURES pictures and MAX_FILED_BYTES bytes; the records and the number left over come back.
    """
    ordered, skipped = within_caps(sorted(pictures, key=lambda picture: (picture.mtime, picture.path)))
    folder = os.path.join(inbox, time.strftime("%Y-%m-%d"))
    records = []
    placed = {}  # type: Dict[str, str]
    with Manifest(inbox) as manifest:
        entries = manifest.entries()
        for number, picture in enumerate(ordered, start=1):
            known = placed.get(picture.sha256) or find_filed(inbox, entries, picture.sha256)
            if known:
                records.append(image_record(known, picture, True))
                continue
            base = "%s_%s_%02d_%s" % (label, backend, number, picture.sha256[:8])
            dest = copy_into_folder(picture, folder, base)
            manifest.append(manifest_entry(inbox, dest, picture, backend, label, job_id, provenance))
            placed[picture.sha256] = dest
            records.append(image_record(dest, picture, False))
    return records, skipped


# ---------------------------------------------------------------------------
# Job folders (the working area of one generator run)
# ---------------------------------------------------------------------------

def make_job() -> Job:
    job_id = new_job_id()
    root = os.path.join(cache_dir(), "jobs", job_id)
    work = os.path.join(root, "work")
    try:
        os.makedirs(work, mode=0o700)
        os.chmod(root, 0o700)
    except OSError as exc:
        raise Failure("bad-input", "cannot create the job folder: %s" % (exc.strerror or exc))
    return Job(job_id, root, work)


def drop_job(job: Job) -> None:
    shutil.rmtree(job.dir, ignore_errors=True)


def tail_text(data: bytes, limit: int = 400) -> str:
    """The last `limit` characters of a program's output, white space folded (an error is usually at the end)."""
    return " ".join(data.decode("utf-8", "replace").split())[-limit:]


# ---------------------------------------------------------------------------
# Reference pictures: private copies for the generators
# ---------------------------------------------------------------------------

def read_ref_bytes(ref: Ref) -> bytes:
    """The bytes of a checked reference, read from the very file that was checked: opened without following a
    link at the end of the path, and the same device and inode as at the check. O_NONBLOCK so that a pipe
    swapped in after the check cannot hold the helper."""
    flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
    try:
        fd = os.open(ref.path, flags)
    except OSError as exc:
        raise Failure("bad-input", "reference %s could not be opened (it may have been replaced): %s"
                      % (ref.name, exc.strerror or exc))
    with os.fdopen(fd, "rb") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or (info.st_dev, info.st_ino) != (ref.dev, ref.ino):
            raise Failure("bad-input", "reference %s changed after it was checked, so it was not used" % ref.name)
        data = handle.read(MAX_REF_BYTES + 1)
    if len(data) > MAX_REF_BYTES:
        raise Failure("bad-input", "reference %s is bigger than 20 MB" % ref.name)
    return data


def write_private_file(path: str, data: bytes) -> None:
    """Create path (it must not exist yet), readable by this user only, and write data into it."""
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)


def stage_one(ref: Ref, base: str) -> Staged:
    data = read_ref_bytes(ref)
    fmt = detect_format(data[:16])
    if fmt is None:
        raise Failure("bad-input", "reference %s is not a PNG, JPEG or WEBP picture" % ref.name)
    size = SIZE_READERS[fmt](io.BytesIO(data))
    target = "%s.%s" % (base, FILE_EXT[fmt])
    try:
        write_private_file(target, data)
    except OSError as exc:
        raise Failure("bad-input", "reference %s could not be copied: %s" % (ref.name, exc.strerror or exc))
    if size is None and sips_size(target) is None:           # the same second chance read_image_header gives
        os.remove(target)
        raise Failure("bad-input", "reference %s is not a readable PNG, JPEG or WEBP picture" % ref.name)
    return Staged(ref.name, target, fmt, hashlib.sha256(data).hexdigest(), len(data))


def stage_refs(job: Job, refs: List[Ref]) -> List[Staged]:
    """Private copies of the checked references: <work>/refs/ref1.png, ref2.jpg, ... Names are chosen here
    (Codex's public source says it splits an -i value at commas), the files are mode 0600, and the bytes are
    checked and hashed after they were read. The generators get these copies and never the caller's path, so a
    swap between the check and the read cannot change what is sent."""
    staged = []  # type: List[Staged]
    try:
        if refs:
            os.makedirs(os.path.join(job.work, "refs"), mode=0o700, exist_ok=True)
        for number, ref in enumerate(refs, start=1):
            staged.append(stage_one(ref, os.path.join(job.work, "refs", "ref%d" % number)))
    except Failure:
        drop_job(job)                                        # nothing has run yet, so there is nothing to keep
        raise
    return staged


def drop_staged_refs(job: Job) -> None:
    """Reference copies are private pictures: they never outlive the run, even when the job folder is kept."""
    shutil.rmtree(os.path.join(job.work, "refs"), ignore_errors=True)


def refs_sent(staged: List[Staged]) -> List[Dict[str, Any]]:
    """What was handed to the generator, as the caller may show it to the owner."""
    return [{"name": ref.name, "sha8": ref.sha256[:8], "bytes": ref.size} for ref in staged]


# ---------------------------------------------------------------------------
# Codex
# ---------------------------------------------------------------------------

def find_codex() -> Optional[str]:
    override = env_value("DESK_ART_CODEX")
    if override:
        path = abs_path(override)
        return path if is_executable(path) else None
    found = shutil.which("codex")
    if found:
        return found
    for bundle in CODEX_BUNDLES:
        path = os.path.join(apps_dir(), bundle)
        if is_executable(path):
            return path
    return None


def codex_login_state(codex: str) -> Tuple[Optional[bool], str]:
    """(logged in: True, False, or None when unknown; a short plain detail).

    Only the program's own words are read, never a login file. VERIFIED 4 Nov 2026:
    `codex login status` prints "Logged in using ChatGPT" on STDERR (stdout is empty),
    so both streams are read.
    """
    result = run_process([codex, "login", "status"], PROBE_TIMEOUT, env=child_env())
    if result.error or result.timed_out:
        return None, "could not run 'codex login status'"
    text = (result.stdout + b"\n" + result.stderr).decode("utf-8", "replace").lower()
    if re.search(r"not\s+logged\s+in", text):
        return False, "not logged in: open the ChatGPT app (Codex) and sign in"
    if re.search(r"logged\s+in", text):
        if "chatgpt" in text:
            return True, "logged in using ChatGPT"
        if "api key" in text:
            return True, "logged in using an API key (not the ChatGPT sign-in)"
        return True, "logged in"
    return None, "could not read the login status"


def bounded_int(text: str) -> int:
    """Python 3.9 converts an integer with millions of digits in quadratic time (minutes); a generator's JSON
    has no such number, so a long one is read as 0."""
    return int(text) if len(text) <= MAX_JSON_INT_DIGITS else 0


def loads_child_json(text: str) -> Any:
    """json.loads for text a generator printed: damaged, too deeply nested or absurdly numeric text gives None."""
    try:
        return json.loads(text, parse_int=bounded_int)
    except (ValueError, RecursionError):
        return None


def build_codex_argv(codex: str, work: str, ref_paths: List[str]) -> List[str]:
    """The codex exec command line. The prompt itself travels on stdin.

    PROMPT PLACEMENT, settled by two real runs on 4 Nov 2026 (codex-cli 0.164.0-alpha.11.1):
    `-i/--image <FILE>...` is greedy, so a positional prompt after it would be taken for a
    picture. The prompt therefore goes on stdin: `--` ends the options and `-` is the
    documented "read the instructions from stdin" marker (see `codex exec --help`).
      text only:        codex exec --json --ephemeral --skip-git-repo-check -s read-only -C W -- -
      with a reference: codex exec --json --ephemeral --skip-git-repo-check -s read-only -C W -i REF -- -
    Both runs exited 0 with an empty stderr and made one 1254x1254 PNG. In the run with a
    reference the new picture kept the reference's green background, so the reference was
    really attached. Events seen: thread.started, turn.started, item.completed
    (agent_message, twice: the plan, then the last word), turn.completed with usage; none
    carry picture data. Never add --dangerously-bypass-approvals-and-sandbox,
    --approve-for-me or -s danger-full-access.

    The CODEX_HARDEN_ARGS sit between -C and the first -i. A run with them and two attached
    references (repeated -i) exited 0 and made one 1254x1254 PNG on 4 Nov 2026.
    """
    argv = [codex, "exec", "--json", "--ephemeral", "--skip-git-repo-check",
            "-s", "read-only", "-C", work] + CODEX_HARDEN_ARGS
    for path in ref_paths:
        argv += ["-i", path]
    return argv + ["--", "-"]


def known_usage(value: Any) -> Optional[Dict[str, int]]:
    """Only the token counts Codex is known to report, and only whole numbers."""
    if not isinstance(value, dict):
        return None
    kept = {name: value[name] for name in USAGE_FIELDS
            if isinstance(value.get(name), int) and not isinstance(value.get(name), bool)}
    return kept or None


def parse_codex_events(stdout: bytes) -> Dict[str, Any]:
    found = {"thread_id": None, "message": None, "usage": None, "error": None,
             "completed": False}  # type: Dict[str, Any]
    for raw in stdout.splitlines():
        event = loads_child_json(raw.decode("utf-8", "replace"))
        if not isinstance(event, dict):
            continue
        kind = event.get("type")
        if kind == "thread.started":
            found["thread_id"] = safe_id(event.get("thread_id"))
        elif kind == "item.completed":
            item = event.get("item")
            if isinstance(item, dict) and item.get("type") == "agent_message" \
                    and isinstance(item.get("text"), str):
                found["message"] = item["text"].strip()[:MAX_MESSAGE_CHARS]
        elif kind == "turn.completed":
            found["completed"] = True
            found["usage"] = known_usage(event.get("usage"))
        elif kind == "error":
            found["error"] = one_line(event.get("message", ""), 400)
        elif kind == "turn.failed":
            error = event.get("error")
            message = error.get("message") if isinstance(error, dict) else error
            found["error"] = one_line(message or "", 400)
    return found


def collect_codex_files(root: str, thread_id: Optional[str], before: Dict[str, Tuple[int, int]],
                        start: float) -> Tuple[List[str], str]:
    """(picture files, how they were matched to this run).

    A run that reported its thread is matched by that thread's own folder alone: an empty folder means it
    made nothing, whatever a parallel run left in other folders. Only a run that never reported a thread falls
    back to comparing the whole pictures folder before and after.
    """
    if thread_id:
        return sorted(list_image_files(os.path.join(root, thread_id), 2)), "thread-folder"
    return changed_since(before, list_image_files(root, 3), start - 2.0), "folder-diff"


UNKNOWN_FEATURE_HINT = ("Codex does not know one of the switches desk-art turns off, so a Codex update probably "
                        "renamed it. desk-art needs an update: tell the owner.")


def thread_folder_fields(root: str, thread_id: Optional[str]) -> Dict[str, Any]:
    """Where this run's own pictures are, for a run that stopped. They are listed here, never filed on their own."""
    if not thread_id:
        return {}
    folder = os.path.join(root, thread_id)
    made = sorted(list_image_files(folder, 2))
    fields = {"threadFolder": folder, "madePictures": made}  # type: Dict[str, Any]
    if made:
        fields["hint"] = ("Codex had already made %d picture(s) when it stopped. They are in %s: `ingest` can "
                          "file them from that folder only. Look at them before you run again."
                          % (len(made), folder))
    return fields


def codex_problem(result: ProcResult, events: Dict[str, Any], timeout: float, root: str,
                  kept: Dict[str, Any]) -> Optional[Failure]:
    """The Failure for a run that did not finish well, or None. `kept` goes into every one of them."""
    if result.error:
        return Failure("codex-failed", "could not start codex: %s" % one_line(result.error, 300), **kept)
    thread_id = events["thread_id"]
    fields = dict(kept, **thread_folder_fields(root, thread_id))
    if result.timed_out:
        fields.setdefault("hint", (
            "no picture had appeared in Codex's own folder when it was stopped" if thread_id else
            "Codex never said which conversation it was in, so its pictures cannot be told from older ones in %s: "
            "ask the owner before you list that folder" % root))
        return Failure("codex-timeout", "codex did not finish within %d seconds and was stopped" % int(timeout),
                       **fields)
    if result.returncode != 0 or (events["error"] and not events["completed"]):
        message = events["error"] or tail_text(result.stderr) \
            or "codex exited with status %s" % result.returncode
        if "unknown feature flag" in message.lower():           # what Codex prints for a switch it no longer has
            fields["hint"] = UNKNOWN_FEATURE_HINT
        return Failure("codex-failed", one_line(message, 400), **fields)
    return None


def cmd_codex(args: argparse.Namespace) -> Dict[str, Any]:
    label = check_label(args.label)
    prompt = read_prompt(args, required=True)
    inbox = prepare_inbox(args.inbox)
    refs = check_refs(args.ref or [], ref_sources(args.ref_root, inbox))
    timeout = check_number(args.timeout, "--timeout", MIN_TIMEOUT, MAX_TIMEOUT, DEFAULT_TIMEOUT)
    began = time.time()
    codex = find_codex()
    if not codex:
        raise Failure(
            "codex-not-found", "the codex program was not found",
            hint="install or open the ChatGPT app (it contains Codex), then try again")
    if codex_login_state(codex)[0] is False:
        raise Failure("codex-not-logged-in", "Codex is not signed in on this Mac",
                      hint="open the ChatGPT app (Codex) and sign in")
    job = make_job()
    try:
        staged = stage_refs(job, refs)
        if any("," in item.path for item in staged):           # Codex reads a comma in an -i value as two paths
            drop_job(job)
            raise Failure("bad-input", "the folder desk-art works in has a comma in its path, and Codex would read "
                                       "that as two picture paths, so the references would not be attached. "
                                       "Nothing was run.")
        root = os.path.join(codex_home(), "generated_images")
        before = list_image_files(root, 3)
        start = time.time()
        log("running codex exec (job %s)" % job.job_id)
        result = run_process(
            build_codex_argv(codex, job.work, [ref.path for ref in staged]), max(1.0, timeout - (start - began)),
            cwd=job.work, stdin_bytes=(CODEX_WRAPPER + prompt).encode("utf-8"), env=child_env())
        events = parse_codex_events(result.stdout)
        elapsed = round(time.time() - start, 1)
        thread_id = events["thread_id"]
        kept = {"jobId": job.job_id, "jobDir": job.dir, "threadId": thread_id,
                "refsSent": [] if result.error else refs_sent(staged)}
        problem = codex_problem(result, events, timeout, root, kept)
        if problem:
            raise problem
        files, matched_by = collect_codex_files(root, thread_id, before, start)
        pictures = without_references(load_candidates(files), staged)
        if not pictures:
            # An error event followed by a finished turn is not a failure (Codex can print retry notices),
            # but when no picture came out the reason must not be lost.
            reported = " (codex also reported: %s)" % events["error"] if events["error"] else ""
            raise Failure(
                "codex-no-images", "codex finished but made no picture" + reported,
                finalMessage=events["message"], **kept)
        provenance = {"threadId": thread_id, "prompt": prompt, "refs": staged}
        images, skipped = file_images(inbox, pictures, "codex", label, job.job_id, provenance)
        answer = {"ok": True, "backend": "codex", "jobId": job.job_id, "threadId": thread_id,
                  "finalMessage": events["message"], "elapsedSec": elapsed, "images": images,
                  "usage": events["usage"], "refsSent": refs_sent(staged), "matchedBy": matched_by}
        answer.update(skipped_fields(skipped, job, os.path.join(root, thread_id) if thread_id else None))
        if not skipped:
            drop_job(job)
        return answer
    finally:
        drop_staged_refs(job)


# ---------------------------------------------------------------------------
# Antigravity CLI (agy). NOT installed on the machine this was written on.
# Everything marked GUESS below comes from the public docs read on 4 Nov 2026
# and was tested only against a fake program.
# ---------------------------------------------------------------------------

def find_agy() -> Optional[str]:
    override = env_value("DESK_ART_AGY")
    if override:
        path = abs_path(override)
        return path if is_executable(path) else None
    found = shutil.which("agy")
    if found:
        return found
    path = os.path.join(home_dir(), ".local", "bin", "agy")
    return path if is_executable(path) else None


def build_agy_argv(agy: str, model: Optional[str], prompt: str) -> List[str]:
    # GUESS (public docs, not run here): `-p/--print/--prompt` takes the prompt as its value
    # and `--output-format json` prints one envelope with conversation_id, status, response.
    # Never add --dangerously-skip-permissions.
    argv = [agy, "--output-format", "json"]
    if model:
        argv += ["--model", model]
    return argv + ["-p", prompt]


def parse_agy_envelope(text: str) -> Optional[Dict[str, Any]]:
    """The whole output as one JSON object, else the last top-level {...} block in it."""
    text = text.strip()
    whole = loads_child_json(text)
    if isinstance(whole, dict):
        return whole
    decoder = json.JSONDecoder(parse_int=bounded_int)
    last = None
    failures = 0
    position = text.find("{")
    while position != -1 and failures < MAX_ENVELOPE_FAILURES:    # a bound: 4 MB of nested braces took 43 s
        try:
            value, end = decoder.raw_decode(text, position)
        except (ValueError, RecursionError):
            failures += 1
            position = text.find("{", position + 1)
            continue
        if isinstance(value, dict):
            last = value
        position = text.find("{", end)
    return last


def agy_roots(work: str) -> List[Tuple[str, int]]:
    # VERIFIED 5 Nov 2026 (agy 1.5.0): the CLI saves a finished picture as
    # ~/.gemini/antigravity-cli/brain/<conversation id>/<name>_<epoch-ms>.jpg (a 1024x1024 JPEG for a "square"
    # request) and names the file in its reply. The desktop app does the same in ~/.gemini/antigravity/brain/.
    # Without a conversation id the work folder and those two trees are compared before and after the run.
    # Only files named like pictures are listed, so antigravity-cli/ settings are never opened.
    gem = gemini_home()
    return [(work, 6), (os.path.join(gem, "antigravity", "brain"), 4),
            (os.path.join(gem, "antigravity-cli"), 4)]


def agy_conversation_folders(conversation: str) -> List[str]:
    """Where a conversation's pictures can be: the CLI's own folder first (seen 5 Nov 2026), then the app's."""
    return [os.path.join(gemini_home(), "antigravity-cli", "brain", conversation),
            os.path.join(gemini_home(), "antigravity", "brain", conversation)]


def agy_new_files(job: Job, conversation: Optional[str], before: Dict[str, Tuple[int, int]]) -> List[str]:
    """Files that are new or changed since the snapshot and can belong to this run. When the run named its
    conversation, only the work folder and that conversation's own folder count: the Antigravity app may be
    saving pictures for the owner at the same time. Without an id the wide folders are compared (agy_roots).
    The copied references are not results."""
    if conversation:
        roots = [(job.work, 6)] + [(folder, 4) for folder in agy_conversation_folders(conversation)]
    else:
        roots = agy_roots(job.work)
    refs_dir = os.path.join(job.work, "refs") + os.sep
    return [path for path in changed_since(before, snapshot(roots)) if not path.startswith(refs_dir)]


def agy_matched_by(conversation: Optional[str], pictures: List[Picture]) -> str:
    if not conversation:
        return "folder-diff"
    own = tuple(folder + os.sep for folder in agy_conversation_folders(conversation))
    return "conversation-folder" if any(picture.path.startswith(own) for picture in pictures) else "work-folder"


def agy_problem(result: ProcResult, status: Optional[str], message: Optional[str], timeout: float,
                kept: Dict[str, Any]) -> Optional[Failure]:
    """The Failure for a run that did not finish well, or None. `kept` goes into every one of them."""
    if result.error:
        return Failure("agy-failed", "could not start agy: %s" % one_line(result.error, 300), **kept)
    if result.timed_out:
        return Failure("agy-timeout", "agy did not finish within %d seconds and was stopped" % int(timeout), **kept)
    said_error = bool(status and re.search("error", status, re.I))
    if result.returncode != 0 or said_error:
        text = message if said_error and message \
            else tail_text(result.stderr) or "agy exited with status %s" % result.returncode
        return Failure("agy-failed", one_line(text, 400), **kept)
    return None


def cmd_agy(args: argparse.Namespace) -> Dict[str, Any]:
    label = check_label(args.label)
    prompt = read_prompt(args, required=True)
    inbox = prepare_inbox(args.inbox)
    model = check_model(args.model)
    refs = check_refs(args.ref or [], ref_sources(args.ref_root, inbox))
    timeout = check_number(args.timeout, "--timeout", MIN_TIMEOUT, MAX_TIMEOUT, DEFAULT_TIMEOUT)
    agy = find_agy()
    if not agy:
        raise Failure(
            "agy-not-installed",
            "agy (the Antigravity CLI) is not installed. Nothing was installed. The installer's last "
            "step runs `agy install`, which may change your shell settings (Google does not say "
            "exactly what it changes), so the owner should run it themselves or give an explicit "
            "yes in chat. Install line: " + AGY_INSTALL_LINE,
            hint="see skills/desk-art/references/antigravity.md")
    job = make_job()
    try:
        staged = stage_refs(job, refs)
        os.makedirs(os.path.join(job.work, "out"), exist_ok=True)
        before = snapshot(agy_roots(job.work))
        full_prompt = AGY_WRAPPER + prompt
        if staged:
            full_prompt += "\n\nREFERENCES:\n" + "\n".join("./refs/" + os.path.basename(ref.path) for ref in staged)
        start = time.time()
        log("running agy (job %s)" % job.job_id)
        result = run_process(build_agy_argv(agy, model, full_prompt), timeout, cwd=job.work, env=child_env())
        elapsed = round(time.time() - start, 1)
        envelope = parse_agy_envelope(result.stdout.decode("utf-8", "replace")) or {}
        conversation = safe_id(envelope.get("conversation_id"))
        status = envelope.get("status") if isinstance(envelope.get("status"), str) else None
        reply = envelope.get("response")
        message = reply.strip() if isinstance(reply, str) else (json.dumps(reply) if reply else None)
        message = message[:MAX_MESSAGE_CHARS] if message else message
        kept = {"jobId": job.job_id, "jobDir": job.dir, "conversationId": conversation,
                "refsSent": [] if result.error else refs_sent(staged)}
        problem = agy_problem(result, status, message, timeout, kept)
        if problem:
            raise problem
        pictures = without_references(one_per_content(load_candidates(agy_new_files(job, conversation, before))), staged)
        if not pictures:
            notice = tail_text(result.stderr, 300)
            searched = "in its work folder or its conversation folder" if conversation else "in the folders compared"
            raise Failure(
                "agy-no-images", "agy finished but no picture file was found %s%s"
                % (searched, " (agy said on stderr: %s)" % notice if notice else ""),
                finalMessage=message, **kept)
        provenance = {"conversationId": conversation, "model": model, "prompt": prompt, "refs": staged}
        images, skipped = file_images(inbox, pictures, "agy", label, job.job_id, provenance)
        answer = {"ok": True, "backend": "agy", "jobId": job.job_id, "conversationId": conversation,
                  "agentStatus": status, "finalMessage": message, "elapsedSec": elapsed, "images": images,
                  "refsSent": refs_sent(staged), "matchedBy": agy_matched_by(conversation, pictures)}
        answer.update(skipped_fields(skipped, job))
        if not skipped:
            drop_job(job)
        return answer
    finally:
        drop_staged_refs(job)


def one_per_content(pictures: List[Picture]) -> List[Picture]:
    seen = set()
    kept = []
    for picture in pictures:
        if picture.sha256 not in seen:
            seen.add(picture.sha256)
            kept.append(picture)
    return kept


def without_references(pictures: List[Picture], staged: List[Staged]) -> List[Picture]:
    """A generator may copy a reference picture into its own folder to look at it (Antigravity does, seen
    5 Nov 2026). A copy that is byte for byte a reference is the owner's own picture, not a result."""
    sent = {ref.sha256 for ref in staged}
    return [picture for picture in pictures if picture.sha256 not in sent]


# ---------------------------------------------------------------------------
# ingest
# ---------------------------------------------------------------------------

def ingest_sources() -> Tuple[str, ...]:
    """Real paths of the two folders where generators keep their own output (inside hidden folders of home)."""
    return tuple(os.path.realpath(folder) for folder in generator_folders())


def cmd_ingest(args: argparse.Namespace) -> Dict[str, Any]:
    label = check_label(args.label)
    prompt = read_prompt(args, required=False)
    note = check_note(args.note)
    given = args.file or []
    if not 1 <= len(given) <= MAX_INGEST_FILES:
        raise Failure("bad-input", "give between 1 and %d files with --file" % MAX_INGEST_FILES)
    inbox = prepare_inbox(args.inbox)
    roots = ingest_roots(args.ref_root, inbox)
    pictures = []
    for path in given:                                    # check every file before filing any
        real, _ = resolve_input_file(path, "file", ingest_sources() + cache_folder(), roots)
        try:
            pictures.append(load_picture(real))
        except Failure as failure:
            raise Failure("bad-input", "file %s: %s" % (path, failure.error))
    job_id = new_job_id()
    provenance = {"prompt": prompt, "note": note}
    images, skipped = file_images(inbox, pictures, args.backend, label, job_id, provenance)
    answer = {"ok": True, "jobId": job_id, "images": images}
    answer.update(skipped_fields(skipped))
    return answer


# ---------------------------------------------------------------------------
# wait-new
# ---------------------------------------------------------------------------

def check_watch_dir(raw: Optional[str]) -> str:
    real = real_path(raw or "~/Downloads")
    problem = path_problem(real)
    if problem:
        raise Failure("bad-input", "folder %s is not allowed: %s" % (raw or "~/Downloads", problem))
    if not os.path.isdir(real):
        raise Failure("bad-input", "folder %s does not exist" % (raw or "~/Downloads"))
    return real


def parse_exts(raw: Optional[str]) -> Tuple[str, ...]:
    if raw is None:
        return IMAGE_EXTS
    chosen = []
    for part in raw.split(","):
        ext = "." + part.strip().lower().lstrip(".")
        if ext not in IMAGE_EXTS:
            raise Failure("bad-input", "--ext may only list png, jpg, jpeg, webp")
        chosen.append(ext)
    return tuple(chosen)


def is_watch_candidate(name: str, exts: Tuple[str, ...]) -> bool:
    lowered = name.lower()
    if lowered.startswith(".") or lowered.endswith(PARTIAL_SUFFIXES):
        return False
    return os.path.splitext(lowered)[1] in exts


def scan_ready(folder: str, since: float, exts: Tuple[str, ...], settle: float,
               seen: Dict[str, Tuple[int, float]]) -> List[Dict[str, Any]]:
    ready = []
    now = time.monotonic()
    try:
        entries = list(os.scandir(folder))
    except OSError as exc:
        raise Failure("bad-input", "cannot read %s: %s" % (folder, exc.strerror or exc))
    for entry in entries:
        if not is_watch_candidate(entry.name, exts):
            continue
        try:
            info = entry.stat(follow_symlinks=False)
        except OSError:
            continue
        if not stat.S_ISREG(info.st_mode) or info.st_mtime < since:
            continue
        previous = seen.get(entry.path)
        if previous is None or previous[0] != info.st_size:
            seen[entry.path] = (info.st_size, now)
            previous = seen[entry.path]
        untouched = max(now - previous[1], time.time() - info.st_mtime)
        if untouched >= settle:
            ready.append({"path": entry.path, "bytes": info.st_size, "mtime": info.st_mtime})
    return sorted(ready, key=lambda item: (item["mtime"], item["path"]))


def cmd_wait_new(args: argparse.Namespace) -> Dict[str, Any]:
    folder = check_watch_dir(args.dir)
    since = check_number(args.since, "--since", 0.0, 1e12, 0.0)
    timeout = check_number(args.timeout, "--timeout", MIN_WAIT_TIMEOUT, MAX_TIMEOUT, DEFAULT_WAIT_TIMEOUT)
    min_count = int(check_number(args.min_count, "--min-count", 1, MAX_MIN_COUNT, 1, whole=True))
    settle = check_number(args.settle, "--settle", 0.0, MAX_SETTLE, 2.0)
    exts = parse_exts(args.ext)
    started = time.monotonic()
    seen = {}  # type: Dict[str, Tuple[int, float]]
    while True:
        ready = scan_ready(folder, since, exts, settle, seen)
        waited = round(time.monotonic() - started, 1)
        if len(ready) >= min_count:
            return {"ok": True, "files": ready, "waitedSec": waited}
        remaining = timeout - (time.monotonic() - started)
        if remaining <= 0:
            raise Failure("timeout", "%d of %d new picture file(s) were ready after %d seconds"
                          % (len(ready), min_count, int(timeout)), files=ready, waitedSec=waited)
        time.sleep(min(POLL_SEC, remaining))


# ---------------------------------------------------------------------------
# clip-image
# ---------------------------------------------------------------------------

def clipboard_script(kind: str) -> List[str]:
    """AppleScript lines that write the clipboard as PNG data (kind PNGf) or TIFF to a file."""
    clip_class = "\u00abclass %s\u00bb" % kind
    return [
        "on run argv",
        "set theData to (the clipboard as %s)" % clip_class,
        "set theFile to open for access (POSIX file (item 1 of argv)) with write permission",
        "try",
        "set eof theFile to 0",
        "write theData to theFile",
        "close access theFile",
        "on error errText number errNumber",
        "try",
        "close access theFile",
        "end try",
        "error errText number errNumber",
        "end try",
        "end run",
    ]


def run_clipboard_script(osascript: str, kind: str, out_path: str) -> ProcResult:
    argv = [osascript]
    for line in clipboard_script(kind):
        argv += ["-e", line]
    return run_process(argv + [out_path], CLIPBOARD_TIMEOUT)


def clipboard_picture(osascript: str, folder: str) -> Tuple[Optional[str], str]:
    png_path = os.path.join(folder, "clip.png")
    first = run_clipboard_script(osascript, "PNGf", png_path)
    if first.error:
        raise Failure("osascript-failed", "could not run osascript: %s" % one_line(first.error, 200))
    if first.returncode == 0 and os.path.isfile(png_path) and os.path.getsize(png_path) > 0:
        return png_path, ""
    tiff_path = os.path.join(folder, "clip.tiff")
    second = run_clipboard_script(osascript, "TIFF", tiff_path)
    if second.returncode == 0 and os.path.isfile(tiff_path) and os.path.getsize(tiff_path) > 0:
        converted = os.path.join(folder, "clip-from-tiff.png")
        sips = shutil.which("sips") or "/usr/bin/sips"
        made = run_process([sips, "-s", "format", "png", tiff_path, "--out", converted], PROBE_TIMEOUT)
        if made.returncode == 0 and os.path.isfile(converted) and os.path.getsize(converted) > 0:
            return converted, ""
    return None, tail_text(second.stderr, 200)


def cmd_clip_image(args: argparse.Namespace) -> Dict[str, Any]:
    label = check_label(args.label)
    prompt = read_prompt(args, required=False)
    note = check_note(args.note)
    inbox = prepare_inbox(args.inbox)
    osascript = abs_path(env_value("DESK_ART_OSASCRIPT") or "/usr/bin/osascript")
    job_id = new_job_id()
    folder = os.path.join(cache_dir(), "clip", job_id)
    try:
        os.makedirs(folder, mode=0o700)
    except OSError as exc:
        raise Failure("bad-input", "cannot create the temporary folder: %s" % (exc.strerror or exc))
    try:
        path, reason = clipboard_picture(osascript, folder)
        if path is None:
            raise Failure("no-image-on-clipboard", "there is no picture on the clipboard"
                          + (" (%s)" % reason if reason else ""),
                          hint="copy the picture in the app first, then run this again")
        try:
            picture = load_picture(path)._replace(source="clipboard")
        except Failure as failure:
            raise Failure("not-an-image", "the clipboard picture is not usable: %s" % failure.error)
        provenance = {"prompt": prompt, "note": note}
        images, _ = file_images(inbox, [picture], args.backend, label, job_id, provenance)
    finally:
        shutil.rmtree(folder, ignore_errors=True)
    return {"ok": True, "jobId": job_id, "images": images}


# ---------------------------------------------------------------------------
# status
# ---------------------------------------------------------------------------

def count_inbox_images(inbox: str) -> int:
    return len(list_image_files(inbox, 3))


def inbox_status(raw: Optional[str], notes: List[str]) -> Dict[str, Any]:
    shown = raw or default_inbox()
    real = real_path(shown)
    problem = path_problem(real)
    if problem:
        notes.append("The inbox folder %s is not allowed: %s. Pick a folder inside your home "
                     "folder, outside ~/Library and hidden folders." % (shown, problem))
        return {"path": real, "exists": False, "imageCount": 0, "usable": False, "problem": problem}
    exists = os.path.isdir(real)
    if not exists:
        notes.append("The inbox folder does not exist yet. It is created the first time a picture is filed.")
    return {"path": real, "exists": exists, "imageCount": count_inbox_images(real) if exists else 0,
            "usable": True, "problem": None}


def codex_hardening(codex: str) -> Dict[str, Any]:
    """Whether this Codex still has every switch desk-art turns off: {"ok": true|false|null, "missing": [...]}.
    `codex features list` prints one feature per line, name first; null means the list could not be read."""
    listing = run_process([codex, "features", "list"], PROBE_TIMEOUT, env=child_env())
    if listing.error or listing.timed_out or listing.returncode != 0:
        return {"ok": None, "missing": []}
    names = {line.split()[0] for line in listing.stdout.decode("utf-8", "replace").splitlines() if line.split()}
    if not names:
        return {"ok": None, "missing": []}
    missing = [name for name in CODEX_DISABLED_FEATURES if name not in names]
    return {"ok": not missing, "missing": missing}


def codex_status(notes: List[str]) -> Dict[str, Any]:
    codex = find_codex()
    if not codex:
        notes.append("Codex was not found. It comes with the ChatGPT app: install or open that app.")
        return {"found": False, "path": None, "version": None, "loggedIn": None,
                "detail": "codex was not found", "hardening": {"ok": None, "missing": []}}
    version = run_process([codex, "--version"], PROBE_TIMEOUT, env=child_env())
    text = first_line(version.stdout) or first_line(version.stderr)
    state, detail = codex_login_state(codex)
    if state is False:
        notes.append("Codex is not signed in. Open the ChatGPT app (Codex) and sign in.")
    hardening = codex_hardening(codex)
    if hardening["ok"] is False:
        notes.append("This Codex no longer has these switches that desk-art turns off: %s. A Codex update "
                     "probably renamed them, so codex runs will fail until desk-art is updated."
                     % ", ".join(hardening["missing"]))
    return {"found": True, "path": codex, "version": text or None, "loggedIn": state, "detail": detail,
            "hardening": hardening}


def agy_status(notes: List[str]) -> Dict[str, Any]:
    agy = find_agy()
    if not agy:
        notes.append("agy (the Antigravity CLI) is not installed. This helper never installs it. The "
                     "installer's last step runs `agy install`, which may change your shell settings "
                     "(Google does not say exactly what it changes), so the owner should run it "
                     "themselves or give an explicit yes in chat. Install line: " + AGY_INSTALL_LINE)
        return {"found": False, "path": None, "version": None, "detail": "agy is not installed"}
    version = run_process([agy, "--version"], PROBE_TIMEOUT, env=child_env())
    text = first_line(version.stdout) or first_line(version.stderr)
    detail = "found (not tested here: whether the CLI can make pictures is unverified)"
    return {"found": True, "path": agy, "version": text or None, "detail": detail}


def list_process_commands() -> List[str]:
    ps = env_value("DESK_ART_PS") or shutil.which("ps") or "/bin/ps"
    result = run_process([ps, "-axo", "comm"], PROBE_TIMEOUT)
    if result.error or result.timed_out or result.returncode != 0:
        return []
    return result.stdout.decode("utf-8", "replace").splitlines()


def app_state(name: str, commands: List[str]) -> Dict[str, bool]:
    marker = "/%s.app/Contents/MacOS/" % name
    return {"installed": os.path.isdir(os.path.join(apps_dir(), name + ".app")),
            "running": any(marker in line for line in commands)}


def cmd_status(args: argparse.Namespace) -> Dict[str, Any]:
    notes = []  # type: List[str]
    inbox = inbox_status(args.inbox, notes)
    codex = codex_status(notes)
    agy = agy_status(notes)
    commands = list_process_commands()
    gemini = app_state("Gemini", commands)
    if gemini["installed"]:
        notes.append("The Gemini app has no scripting door: it can only be used through Claude's "
                     "Computer use (screen control), which must be turned on in the Claude app.")
    return {"ok": True, "inbox": inbox, "codex": codex, "agy": agy,
            "antigravityApp": app_state("Antigravity", commands), "geminiApp": gemini,
            "refRoots": ref_sources(args.ref_root, inbox["path"] if inbox["usable"] else None), "notes": notes}


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

class JsonParser(argparse.ArgumentParser):
    """argparse that raises instead of printing and exiting, so the one JSON object stays the only output."""

    def error(self, message: str) -> Any:
        raise UsageError(message, self.format_usage().strip())

    def exit(self, status: int = 0, message: Optional[str] = None) -> Any:
        raise UsageError(message or "the command line could not be used", self.format_usage().strip())

    def print_help(self, file: Any = None) -> None:
        raise HelpShown(self.prog, self.format_help())


def add_prompt_source(parser: argparse.ArgumentParser, required: bool) -> None:
    group = parser.add_mutually_exclusive_group(required=required)
    group.add_argument("--prompt-file", metavar="FILE",
                       help="read the prompt from this UTF-8 file (it must be inside your home folder)")
    group.add_argument("--prompt-stdin", action="store_true",
                       help="read the prompt from standard input")


def add_ref_root(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--ref-root", action="append", metavar="DIR",
        help="a folder pictures may be sent from (repeat, up to %d; start with / or ~/). Default: the game's art "
             "folders. The inbox and the cache are always allowed too" % MAX_REF_ROOTS)


def build_parser() -> argparse.ArgumentParser:
    parser = JsonParser(
        prog="desk_art.py", allow_abbrev=False,
        description="desk-art helper %s. Files pictures made by image generators that are already "
                    "signed in on this Mac. Every call prints exactly one JSON object." % VERSION)
    commands = parser.add_subparsers(dest="command", metavar="<subcommand>", required=True)
    common = JsonParser(add_help=False, allow_abbrev=False)
    common.add_argument(
        "--inbox", metavar="DIR",
        help="inbox folder (default: env DESK_ART_INBOX, else ~/Desktop/JJK Game images/desk_art_inbox)")

    def add(name: str, summary: str) -> argparse.ArgumentParser:
        epilog = ("Failure codes (the \"code\" field): %s. Exit codes: 0 ok, 2 handled failure, "
                  "3 usage error, 1 unexpected error." % ", ".join(FAILURE_CODES[name]))
        return commands.add_parser(name, parents=[common], allow_abbrev=False,
                                   help=summary, description=summary, epilog=epilog)

    status = add("status", "Report what is ready: inbox, Codex, the agy CLI, the Antigravity and Gemini apps, "
                           "and the folders pictures may be sent from.")
    add_ref_root(status)

    codex = add("codex", "Make pictures with Codex (codex exec with its built-in image tool) "
                         "and file them in the inbox.")
    codex.add_argument("--label", required=True, metavar="L",
                       help="short name for the files: a-z 0-9 _ -, 1 to 40 characters")
    add_prompt_source(codex, True)
    codex.add_argument("--ref", action="append", metavar="PATH",
                       help="reference picture (repeat up to 6 times; PNG, JPEG or WEBP, at most 20 MB)")
    add_ref_root(codex)
    codex.add_argument("--timeout", metavar="SEC", help="seconds to wait, 30 to 540 (default 480)")

    agy = add("agy", "Make pictures with the Antigravity CLI (agy -p) and file them in the inbox. "
                     "Written from the public docs; not tested against a real agy.")
    agy.add_argument("--label", required=True, metavar="L",
                     help="short name for the files: a-z 0-9 _ -, 1 to 40 characters")
    add_prompt_source(agy, True)
    agy.add_argument("--model", metavar="SLUG", help="model slug as listed by `agy models`")
    agy.add_argument("--ref", action="append", metavar="PATH",
                     help="reference picture (repeat up to 6 times; PNG, JPEG or WEBP, at most 20 MB)")
    add_ref_root(agy)
    agy.add_argument("--timeout", metavar="SEC", help="seconds to wait, 30 to 540 (default 480)")

    ingest = add("ingest", "File existing picture files into the inbox with provenance. Files may also come "
                           "from ~/Downloads and the generators' own folders.")
    ingest.add_argument("--label", required=True, metavar="L",
                        help="short name for the files: a-z 0-9 _ -, 1 to 40 characters")
    ingest.add_argument("--backend", required=True, choices=BACKENDS, help="which generator made them")
    ingest.add_argument("--file", action="append", required=True, metavar="PATH",
                        help="picture file to file (repeat, 1 to 16 times)")
    add_ref_root(ingest)
    add_prompt_source(ingest, False)
    ingest.add_argument("--note", metavar="TEXT", help="free note kept in the manifest (at most 300 characters)")

    wait = add("wait-new", "Wait until new picture files appear in a folder and stop changing. "
                           "It files nothing (--inbox is accepted and not used).")
    wait.add_argument("--dir", metavar="DIR", help="folder to watch (default ~/Downloads)")
    wait.add_argument("--since", required=True, metavar="EPOCH",
                      help="only files modified at or after this epoch time (seconds)")
    wait.add_argument("--timeout", metavar="SEC", help="seconds to wait, 1 to 540 (default 120)")
    wait.add_argument("--min-count", metavar="N", help="how many files to wait for, 1 to 8 (default 1)")
    wait.add_argument("--settle", metavar="SEC",
                      help="seconds a file's size must stay the same, 0 to 30 (default 2.0)")
    wait.add_argument("--ext", metavar="LIST", help="extensions to watch (default png,jpg,jpeg,webp)")

    clip = add("clip-image", "File the picture that is on the clipboard into the inbox.")
    clip.add_argument("--label", required=True, metavar="L",
                      help="short name for the file: a-z 0-9 _ -, 1 to 40 characters")
    clip.add_argument("--backend", choices=CLIP_BACKENDS, default="gemini-app",
                      help="which generator made it (default gemini-app)")
    add_prompt_source(clip, False)
    clip.add_argument("--note", metavar="TEXT", help="free note kept in the manifest (at most 300 characters)")
    return parser


COMMANDS = {"status": cmd_status, "codex": cmd_codex, "agy": cmd_agy, "ingest": cmd_ingest,
            "wait-new": cmd_wait_new, "clip-image": cmd_clip_image}


VALUE_FLAGS = frozenset([
    "--inbox", "--label", "--prompt-file", "--ref", "--ref-root", "--timeout", "--model", "--backend",
    "--file", "--note", "--dir", "--since", "--min-count", "--settle", "--ext"])
SWITCH_FLAGS = frozenset(["--prompt-stdin", "--help", "-h"])


def glue_dash_values(argv: List[str]) -> List[str]:
    """argparse would take a value like "-5" or "-x" for a flag. Join it to its flag with "="
    so it reaches the validators and is reported as a bad value, not as a usage error."""
    glued = []  # type: List[str]
    index = 0
    while index < len(argv):
        token = argv[index]
        following = argv[index + 1] if index + 1 < len(argv) else ""
        if token in VALUE_FLAGS and len(following) > 1 and following.startswith("-") \
                and following not in VALUE_FLAGS and following not in SWITCH_FLAGS:
            glued.append(token + "=" + following)
            index += 2
        else:
            glued.append(token)
            index += 1
    return glued


def help_result(shown: HelpShown) -> Dict[str, Any]:
    usage = shown.text.split("\n\n", 1)[0]
    flags = []  # type: List[str]
    for flag in re.findall(r"--[a-z][a-z-]*", usage):
        if flag not in flags:
            flags.append(flag)
    parts = shown.prog.split()
    command = parts[1] if len(parts) > 1 else None
    codes = list(FAILURE_CODES[command]) if command else sorted({c for cs in FAILURE_CODES.values() for c in cs})
    return {"ok": True, "command": command, "help": shown.text, "flags": flags, "codes": codes}


def run_cli(argv: List[str]) -> Tuple[int, Dict[str, Any]]:
    try:
        args = build_parser().parse_args(glue_dash_values(argv))
        return 0, COMMANDS[args.command](args)
    except HelpShown as shown:
        return 0, help_result(shown)
    except UsageError as usage:
        return 3, {"ok": False, "code": "usage", "error": usage.message, "usage": usage.usage}
    except Failure as failure:
        return 2, failure.to_result()
    except KeyboardInterrupt:
        return 1, {"ok": False, "code": "internal", "error": "Interrupted: stopped by a signal"}
    except Exception as exc:                                  # unexpected: report, never crash silently
        log("unexpected error\n" + traceback.format_exc())
        return 1, {"ok": False, "code": "internal",
                   "error": one_line("%s: %s" % (type(exc).__name__, exc), 300)}


def silence_stdout() -> None:
    """Point fd 1 at /dev/null once the reader has gone away (or stdout never existed), so Python's own
    flush at exit cannot fail too and turn the planned exit code into 120."""
    try:
        fd = sys.stdout.fileno()
        devnull = os.open(os.devnull, os.O_WRONLY)
        os.dup2(devnull, fd)
        os.close(devnull)
    except (OSError, ValueError, AttributeError):
        pass


def emit(result: Dict[str, Any]) -> None:
    """The only thing ever written to stdout: one ASCII JSON line."""
    line = json.dumps(result, ensure_ascii=True, separators=(",", ":"), default=str)
    try:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()
    except (OSError, ValueError, AttributeError):
        silence_stdout()


def raise_interrupt(signum: int, frame: Any) -> None:
    raise KeyboardInterrupt()


def main() -> int:
    for stopper in (signal.SIGTERM, signal.SIGHUP):           # so a stopped helper stops its child too
        signal.signal(stopper, raise_interrupt)
    code, result = run_cli(sys.argv[1:])
    emit(result)
    return code


if __name__ == "__main__":
    sys.exit(main())
