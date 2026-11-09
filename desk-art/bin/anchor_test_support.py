"""Shared pieces for the anchor-set tests. This is not a test file: test_anchor_helper.py, test_anchor_scripts.py and
test_anchor_look.py import it by name.

Everything here uses the standard library only, so it also works on the system Python (which has no Pillow).
Pictures are built by hand with struct and zlib. Nothing here starts a generator or touches the network, and a set
is only ever written inside the Sandbox of test_desk_art.py (a temporary home).
"""

import hashlib
import json
import os
import struct
import subprocess
import sys
import zlib

PLAIN_PYTHON = "/usr/bin/python3"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"

_NOT_LOOKED = object()
_pillow_python_answer = _NOT_LOOKED
_pillow_here_answer = None


# ---------------------------------------------------------------------------
# Which Python has Pillow and numpy
# ---------------------------------------------------------------------------

def _imports_pillow(python):
    """True when `python` can import PIL and numpy under -I -B (run once, nothing else is done)."""
    if not (os.path.isfile(python) and os.access(python, os.X_OK)):
        return False
    try:
        done = subprocess.run([python, "-I", "-B", "-c", "import PIL, numpy"], stdin=subprocess.DEVNULL,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=120)
    except (OSError, subprocess.SubprocessError):
        return False
    return done.returncode == 0


def _comfy_python_paths():
    """<folder>/standalone-env/bin/python for every folder of ~/ComfyUI-Installs, in sorted order (folders that start
    with a dot are left out). The REAL home (HOME), never DESK_ART_HOME. No ComfyUI folder name is written here, and
    whether each file exists is not looked at."""
    base = os.path.join(os.path.expanduser("~"), "ComfyUI-Installs")
    try:
        folders = sorted(name for name in os.listdir(base) if not name.startswith("."))
    except OSError:
        folders = []
    return [os.path.join(base, folder, "standalone-env", "bin", "python") for folder in folders]


def comfy_pythons_on_disk():
    """The ones of those that are executable files: ComfyUI's own Python, as installed in ~/ComfyUI-Installs. A test
    uses this to tell 'there is no ComfyUI here' from 'ComfyUI is here and no Pillow Python was found'."""
    return [path for path in _comfy_python_paths() if os.path.isfile(path) and os.access(path, os.X_OK)]


def _pillow_candidates():
    """The Pythons to try, in order: the two test/owner variables, the search ComfyUI's Python is found by (the
    REAL home, never DESK_ART_HOME), then this interpreter. No ComfyUI folder name is written here: every folder
    of the install folder is tried in sorted order."""
    found = []
    for name in ("DESK_ART_TEST_PIL_PYTHON", "JJK_ART_PYTHON"):
        value = os.environ.get(name)
        if value:
            found.append(os.path.expanduser(value))
    root = os.environ.get("JJK_COMFY_ROOT")
    if root:
        found.append(os.path.join(os.path.expanduser(root), "standalone-env", "bin", "python"))
    found.extend(_comfy_python_paths())
    found.append(sys.executable)
    return found


def pillow_python():
    """Path of a Python that imports PIL and numpy under `-I -B`, or None. The answer is cached. For tests that START
    A SUBPROCESS (a script run as a program). A test that loads a script in this very process must use
    pillow_here() instead: this function finds ComfyUI's Python even when the tests themselves run on the system
    Python."""
    global _pillow_python_answer
    if _pillow_python_answer is _NOT_LOOKED:
        _pillow_python_answer = None
        for candidate in _pillow_candidates():
            if _imports_pillow(candidate):
                _pillow_python_answer = candidate
                break
    return _pillow_python_answer


def pillow_here():
    """True when PIL and numpy import in THIS interpreter (the one running the tests). Cached. Every IN-PROCESS script
    test (one that loads a script as a module and calls run_cli) uses @unittest.skipUnless(pillow_here(), ...), so
    the system Python (no Pillow) skips it instead of failing."""
    global _pillow_here_answer
    if _pillow_here_answer is None:
        try:
            import PIL  # noqa: F401
            import numpy  # noqa: F401
            _pillow_here_answer = True
        except Exception:
            _pillow_here_answer = False
    return _pillow_here_answer


# ---------------------------------------------------------------------------
# Pictures built by hand (8-bit PNG files)
# ---------------------------------------------------------------------------

def png_chunk(kind, data):
    """One PNG chunk: length, type, data, CRC."""
    body = kind + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def _png_file(width, height, color_type, rows, before_data=()):
    """IHDR, the `before_data` chunks (type, data), one IDAT made of `rows`, IEND."""
    header = struct.pack(">IIBBBBB", width, height, 8, color_type, 0, 0, 0)
    chunks = [png_chunk(b"IHDR", header)] + [png_chunk(kind, data) for kind, data in before_data]
    chunks.append(png_chunk(b"IDAT", zlib.compress(b"".join(rows))))
    chunks.append(png_chunk(b"IEND", b""))
    return PNG_SIGNATURE + b"".join(chunks)


def _pixels(pixel):
    """pixel is a function (x, y) -> value; a plain value stands for a picture of one colour (faster to build)."""
    return pixel if callable(pixel) else (lambda x, y: pixel)


def png_rgb(width, height, pixel):
    """Bytes of an 8-bit RGB PNG (colour type 2); pixel(x, y) -> (r, g, b). Pure standard library."""
    get = _pixels(pixel)
    rows = [b"\x00" + b"".join(bytes(get(x, y)) for x in range(width)) for y in range(height)]
    return _png_file(width, height, 2, rows)


def png_rgba(width, height, pixel):
    """Bytes of an 8-bit RGBA PNG (colour type 6); pixel(x, y) -> (r, g, b, a)."""
    get = _pixels(pixel)
    rows = [b"\x00" + b"".join(bytes(get(x, y)) for x in range(width)) for y in range(height)]
    return _png_file(width, height, 6, rows)


def png_grey(width, height, pixel, transparent_grey=None):
    """Bytes of an 8-bit grey PNG (colour type 0); pixel(x, y) -> 0..255. With `transparent_grey`, a tRNS chunk makes
    that grey value fully transparent (a colour key). An addition to the contract's list, for the 'grey picture
    with a tRNS colour key' row of the set builder's tests."""
    get = _pixels(pixel)
    rows = [b"\x00" + bytes(get(x, y) for x in range(width)) for y in range(height)]
    before = [] if transparent_grey is None else [(b"tRNS", struct.pack(">H", transparent_grey))]
    return _png_file(width, height, 0, rows, before)


def png_palette(width, height, palette, transparent_index=None, pixel=None):
    """Bytes of an 8-bit palette PNG (colour type 3, a PLTE chunk). `palette`: list of (r, g, b). `pixel(x, y)` gives
    a palette index (default: always 0). With `transparent_index`, a tRNS chunk makes that index fully transparent
    (alpha 0) and every other index opaque (alpha 255). Pure standard library."""
    get = _pixels(0 if pixel is None else pixel)
    rows = [b"\x00" + bytes(get(x, y) for x in range(width)) for y in range(height)]
    before = [(b"PLTE", b"".join(bytes(color) for color in palette))]
    if transparent_index is not None:
        before.append((b"tRNS", bytes(0 if index == transparent_index else 255 for index in range(len(palette)))))
    return _png_file(width, height, 3, rows, before)


def png_with_chunks(png, chunks):
    """`png` (bytes) with extra chunks inserted right after IHDR; `chunks` is a list of (type, data) with `type` four
    bytes, for example (b"tEXt", b"prompt\\0secret workflow"), (b"iCCP", name + b"\\0\\0" + zlib.compress(profile)),
    (b"eXIf", exif_bytes), (b"pHYs", ...). Each chunk gets its length and CRC. Pure standard library."""
    assert png.startswith(PNG_SIGNATURE), "not a PNG"
    header_end = len(PNG_SIGNATURE) + 12 + struct.unpack(">I", png[8:12])[0]       # length + type + data + CRC
    return png[:header_end] + b"".join(png_chunk(kind, data) for kind, data in chunks) + png[header_end:]


def banded_png(width=64, height=128, key=(255, 0, 255), bands=((200, 30, 30), (30, 200, 30), (30, 30, 200)),
               box=(0.25, 0.05, 0.75, 0.95)):
    """A 'figure' on a flat backdrop: the rectangle `box` (fractions of width and height) is split into equal
    horizontal bands of the given colours, everything else is `key`."""
    left, top = int(round(box[0] * width)), int(round(box[1] * height))
    right, bottom = int(round(box[2] * width)), int(round(box[3] * height))

    def pixel(x, y):
        if left <= x < right and top <= y < bottom:
            return bands[(y - top) * len(bands) // (bottom - top)]
        return key
    return png_rgb(width, height, pixel)


# ---------------------------------------------------------------------------
# Sets written the way the builder would write them
# ---------------------------------------------------------------------------

def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def card_bytes(card):
    """json.dumps(card, ensure_ascii=True, indent=2) + newline, as bytes (what the builder writes)."""
    return (json.dumps(card, ensure_ascii=True, indent=2) + "\n").encode("ascii")


def _write_private(path, data):
    """A new file, mode 0600. An older file (or link) at that name is removed first, so nothing is written
    through it."""
    if os.path.lexists(path):
        os.remove(path)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as handle:
        handle.write(data)
    os.chmod(path, 0o600)


def write_set(sb, name, members, keep="", note=None, made="2026-11-09T12:00:00Z", owner_said=None, card_edit=None):
    """Write <sb.inbox>/anchors/<name>/ the way the builder would: folders 0700, files 0600, pictures NN_role.png,
    anchor.json last. `members`: list of dicts {"role": str, "png": bytes, optional "provenance" (default "owner"),
    "source" (dict path+sha256 or None), "prep" (str or None)}. The card carries sha256 and size computed from the
    bytes. `card_edit`, if given, is called with the card dict before it is written (tests use it to make bad
    cards); it may change the dict in place, return another dict, or return bytes to be written as the card as they
    are. A set written twice under one name is rewritten (a convenience of the tests; the builder never does that).
    Returns the set folder."""
    root = os.path.join(sb.inbox, "anchors")
    folder = os.path.join(root, name)
    os.makedirs(folder, exist_ok=True)
    os.chmod(root, 0o700)
    os.chmod(folder, 0o700)
    listed = []
    for number, member in enumerate(members, start=1):
        data = member["png"]
        file_name = "%02d_%s.png" % (number, member["role"])
        _write_private(os.path.join(folder, file_name), data)
        item = {"file": file_name, "role": member["role"], "sha256": sha256_bytes(data)}
        if data.startswith(PNG_SIGNATURE) and len(data) >= 24:
            item["size"] = list(struct.unpack(">II", data[16:24]))
        if member.get("source") is not None:
            item["source"] = member["source"]
        if member.get("prep") is not None:
            item["prep"] = member["prep"]
        item["provenance"] = member.get("provenance", "owner")
        listed.append(item)
    card = {"format": 1, "name": name, "made": made, "keep": keep}
    if note is not None:
        card["note"] = note
    if owner_said is not None:
        card["owner_said"] = owner_said
    card["members"] = listed
    raw = None
    if card_edit is not None:
        edited = card_edit(card)
        if isinstance(edited, bytes):
            raw = edited
        elif edited is not None:
            card = edited
    _write_private(os.path.join(folder, "anchor.json"), card_bytes(card) if raw is None else raw)
    return folder
