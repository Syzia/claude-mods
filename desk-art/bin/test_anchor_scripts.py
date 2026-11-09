#!/usr/bin/env python3
"""Tests for skills/anchor/scripts/anchor_set.py (the set builder of the desk-art:anchor skill, version 0.2.0).

Everything runs in the temporary "home" of test_desk_art.py (the Sandbox): the pictures are made by hand or with
Pillow, a set is only ever written inside that home, and no real generator is started. The scripts are run as
programs (`python -I -B anchor_set.py ...`). Tests that start `build` use a Python that has Pillow (ComfyUI's, found
the way the script finds it); tests that load the script into this very process need Pillow in the interpreter that
runs the tests, so they skip themselves on the system Python.

Run from the mod folder:
    /usr/bin/python3 -B -m unittest discover -s bin -p 'test_*.py'       (the in-process tests skip)
    "$PY" -B -m unittest discover -s bin -p 'test_anchor*.py'            (PY = ComfyUI's Python; nothing skips)
"""

import ast
import contextlib
import hashlib
import importlib.util
import io
import json
import os
import re
import stat
import struct
import subprocess
import sys
import unittest
import warnings
import zlib
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import desk_art  # noqa: E402
from anchor_test_support import PLAIN_PYTHON, PNG_SIGNATURE, banded_png, png_grey, png_palette, png_rgb  # noqa: E402
from anchor_test_support import png_chunk, png_rgba, png_with_chunks, pillow_here, pillow_python  # noqa: E402
from anchor_test_support import write_set  # noqa: E402
from test_desk_art import Result, SandboxCase, WRAPPER_TEXT, MANIFEST_KEYS, png_bytes  # noqa: E402
from test_desk_art import replace_by_another_picture, rewrite_in_place  # noqa: E402

SCRIPT = os.path.normpath(os.path.join(HERE, "..", "skills", "anchor", "scripts", "anchor_set.py"))
HELPER_FILE = os.path.join(HERE, "desk_art.py")
PIL_PYTHON = pillow_python()
needs_pillow_python = unittest.skipUnless(PIL_PYTHON, "no Python with Pillow and numpy was found")
needs_pillow_here = unittest.skipUnless(pillow_here(), "this Python has no Pillow or numpy (the system Python)")

KEEP = "round lenses dark olive green; suit muted beige; shoes dark brown"
UPLOADS = ("Every picture in this set is uploaded to OpenAI (codex_image) or Google (agy_image) each time the set "
           "is used.")
NEXT = ("Look at every stored picture with the Read tool, show the owner the sheet, and wait for a yes before the "
        "first picture is made.")
PREVIEW_NEXT = ("This was a preview: no set was made and the name is still free. Look at every preview picture with "
                "the Read tool, zoom in on the parts the keep line will name (anchor_look.py zoom), write the keep "
                "line, then run the same description again without --preview.")
HIDDEN_CHUNKS = (b"tEXt", b"iTXt", b"zTXt", b"eXIf", b"iCCP", b"pHYs")
SMALL_EXIF = bytes.fromhex("4d4d002a00000008" "0000" "00000000")        # MM, 42, offset 8, no entries, no next block


# ---------------------------------------------------------------------------
# Small helpers shared by the tests
# ---------------------------------------------------------------------------

def sha_of(data):
    return hashlib.sha256(data).hexdigest()


def read_bytes(path):
    with open(path, "rb") as handle:
        return handle.read()


def png_chunks(data):
    """The chunk types of a PNG file, in order."""
    assert data.startswith(PNG_SIGNATURE), "not a PNG"
    found, position = [], len(PNG_SIGNATURE)
    while position < len(data):
        length = struct.unpack(">I", data[position:position + 4])[0]
        found.append(data[position + 4:position + 8])
        position += 12 + length
    return found


def tree_snapshot(root):
    """{relative path: description} of every entry under root, links not followed. For a folder only its kind and
    mode are kept: adding a file to a folder changes the folder's own time and size."""
    found = {}
    for folder, dirs, names in os.walk(root):
        for name in dirs + names:
            path = os.path.join(folder, name)
            info = os.lstat(path)
            relative = os.path.relpath(path, root)
            if stat.S_ISDIR(info.st_mode):
                found[relative] = ("dir", stat.S_IMODE(info.st_mode))
            elif stat.S_ISLNK(info.st_mode):
                found[relative] = ("link", os.readlink(path))
            else:
                found[relative] = ("file", info.st_size, info.st_mtime_ns, stat.S_IMODE(info.st_mode))
    return found


def png_grey16(width, height, pixel, transparent_grey=None):
    """Bytes of a 16-bit grey PNG (colour type 0, bit depth 16); pixel(x, y) -> 0..65535. With `transparent_grey`, a
    tRNS chunk makes that 16-bit value transparent (a colour key). The support module has the 8-bit kinds only."""
    rows = [b"\x00" + b"".join(struct.pack(">H", pixel(x, y)) for x in range(width)) for y in range(height)]
    chunks = [png_chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 16, 0, 0, 0, 0))]
    if transparent_grey is not None:
        chunks.append(png_chunk(b"tRNS", struct.pack(">H", transparent_grey)))
    chunks.append(png_chunk(b"IDAT", zlib.compress(b"".join(rows))))
    chunks.append(png_chunk(b"IEND", b""))
    return PNG_SIGNATURE + b"".join(chunks)


def with_pillow(code, *args):
    """Run a few lines of Python with Pillow in ComfyUI's Python (a separate process) and return what it printed as
    parsed JSON. Used to look at stored pictures and to make JPEG files."""
    done = subprocess.run([PIL_PYTHON, "-I", "-B", "-c", code] + [str(arg) for arg in args], stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    if done.returncode != 0:
        raise AssertionError("the Pillow helper failed: %s" % done.stderr.decode("utf-8", "replace"))
    return json.loads(done.stdout.decode("utf-8"))


def pixels_of(path, *points):
    """The RGB values at the given (x, y) points of a picture, and the picture's size: ([[r, g, b], ...], [w, h])."""
    code = ("import json, sys\nfrom PIL import Image\nimg = Image.open(sys.argv[1]).convert('RGB')\n"
            "print(json.dumps([[list(img.getpixel(tuple(p))) for p in json.loads(sys.argv[2])], list(img.size)]))")
    return with_pillow(code, path, json.dumps([list(point) for point in points]))


def real_jpeg(path, size=(90, 70), color=(40, 90, 200)):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    code = "import sys\nfrom PIL import Image\nImage.new('RGB', (int(sys.argv[2]), int(sys.argv[3])), (%d, %d, %d))" \
           ".save(sys.argv[1], format='JPEG')\nprint('1')" % color
    with_pillow(code, path, size[0], size[1])
    return path


def load_script():
    """The script as a module of this process (for the tests that patch one of its functions)."""
    spec = importlib.util.spec_from_file_location("anchor_set_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ScriptCase(SandboxCase):
    """A sandbox plus ways to run anchor_set.py as a program or inside this process."""

    # --- running the script ---------------------------------------------------------------------------------

    def run_script(self, args, stdin=None, python=None, env=None):
        """anchor_set.py as a program. Always checks the contract: ONE line of ASCII JSON on standard output, standard
        error empty on success, and an exit code that agrees with "ok"."""
        full_env = self.sb.env()
        full_env.update(env or {})
        if isinstance(stdin, str):
            stdin = stdin.encode("utf-8")
        done = subprocess.run([python or PLAIN_PYTHON, "-I", "-B", SCRIPT] + [str(arg) for arg in args], input=stdin,
                              stdin=None if stdin is not None else subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, env=full_env, timeout=300)
        out = done.stdout.decode("utf-8")
        err = done.stderr.decode("utf-8", "replace")
        self.assertTrue(out.endswith("\n") and out.count("\n") == 1, "stdout is not one line: %r" % out[:300])
        self.assertTrue(out.isascii(), "stdout is not plain ASCII JSON")
        data = json.loads(out)
        self.assertIsInstance(data, dict)
        self.assertIn("ok", data)
        self.assertEqual(done.returncode == 0, data["ok"] is True, out[:600])
        if data["ok"]:
            self.assertEqual(err, "", "standard error is not empty on success")
        return Result(done.returncode, data, out, err)

    def build(self, description, *flags, preview=False, inbox=True, env=None):
        """`build` on a Python with Pillow. `description` is a dict (or bytes for a raw input)."""
        args = ["build"] + (["--preview"] if preview else []) + (["--inbox", self.sb.inbox] if inbox else [])
        stdin = description if isinstance(description, (bytes, str)) else json.dumps(description)
        return self.run_script(args + list(flags), stdin=stdin, python=PIL_PYTHON, env=env)

    def run_inprocess(self, module, argv, stdin_bytes=None):
        """module.run_cli inside this process, in the sandbox environment, with Pillow's warnings kept in a box."""
        with contextlib.ExitStack() as stack:
            stack.enter_context(mock.patch.dict(os.environ, self.sb.env(), clear=True))
            stack.enter_context(warnings.catch_warnings())
            return module.run_cli([str(arg) for arg in argv], stdin_bytes)

    # --- making sources and descriptions --------------------------------------------------------------------

    def art_path(self, *parts):
        return os.path.join(self.sb.art, *parts)

    def source(self, name, data=None, folder=None):
        """A picture file in the first default art folder; returns its path."""
        path = os.path.join(folder or self.sb.art, name)
        self.sb.write_file(path, data if data is not None else png_bytes(80, 80, (30, 90, 160)))
        return path

    def figure(self, name="fig-v1", source=None, **extra):
        """A description of a one-picture set (an identity picture on a flat colour)."""
        item = {"role": "identity", "source": source or self.source("fig.png", png_rgba(
            80, 80, lambda x, y: (200, 30, 30, 0) if x < 6 and y < 6 else (200, 30, 30, 255))), "key": "#FF00FF"}
        description = {"name": name, "keep": KEEP, "pictures": [item]}
        description.update(extra)
        return description

    def close_up(self, name="closeup-v1", **extra):
        """A description of a close-up: a 16:9 crop (place) and its whole room (room), from one 320x180 picture."""
        room = self.source("room.png", banded_png(320, 180, key=(10, 20, 30), box=(0.1, 0.1, 0.9, 0.9)))
        description = {"name": name, "keep": "red vending machine at the right",
                       "pictures": [{"role": "place", "source": room, "crop": [80, 45, 240, 135], "size": [320, 180]},
                                    {"role": "room", "source": room}]}
        description.update(extra)
        return description

    def set_folder(self, name):
        return os.path.join(self.sb.inbox, "anchors", name)

    def card_of(self, name):
        return json.loads(read_bytes(os.path.join(self.set_folder(name), "anchor.json")).decode("ascii"))

    def make_inbox(self, with_notes=True):
        os.makedirs(self.sb.inbox, exist_ok=True)
        if with_notes:
            notes = os.path.join(self.sb.inbox, "manifest.jsonl")
            if not os.path.exists(notes):
                with open(notes, "wb"):
                    pass
        return self.sb.inbox

    def add_note(self, png, backend, extra=None):
        """A row for these picture bytes in the inbox's notes file (as if a generator, or `ingest`, had filed them)."""
        row = {"ts": "2026-11-09T01:00:00Z", "backend": backend, "label": "x", "sha256": sha_of(png)}
        row.update(extra or {})
        self.make_inbox()
        with open(os.path.join(self.sb.inbox, "manifest.jsonl"), "ab") as handle:
            handle.write(json.dumps(row).encode("ascii") + b"\n")

    def inbox_picture(self, name, data):
        """A picture inside the inbox (a day folder), as a generator's result would be."""
        self.make_inbox()
        path = os.path.join(self.sb.inbox, "2026-11-09", name)
        self.sb.write_file(path, data)
        return path

    def assert_refused(self, result, fragment, code="bad-input"):
        self.assertEqual(result.code, 2, result.out)
        self.assertEqual(result.data["code"], code, result.out)
        self.assertIn(fragment, result.data["error"])

    def assert_nothing_saved(self):
        self.assertFalse(os.path.lexists(os.path.join(self.sb.inbox, "anchors")), "a refused build left a set folder")

    def needs_a_disk_that_ignores_case(self, folder, name):
        """Skip the test on a disk that tells upper and lower case apart (then `name` spelled in capitals is another
        folder, and the spelling tests have nothing to find). `folder` holds a sub-folder or file called `name`."""
        loud = name.upper()
        self.assertNotEqual(loud, name)
        if not os.path.exists(os.path.join(folder, loud)):
            self.skipTest("this disk tells upper and lower case apart")
        return loud

    def assert_note_says(self, note, before, fragment):
        """`sourceNote` is a refusal cut to 200 characters, and the picture's path comes before the reason in it.
        `before` is the text in front of `fragment`. A long temporary folder can push the fragment past the cut, so
        what is asked for is the first 200 characters of `before + fragment` (all of it when it fits)."""
        want = before + fragment
        if len(want) >= 200:
            self.assertEqual(note[:200], want[:200])
        else:
            self.assertTrue(note.startswith(want), note)


# ---------------------------------------------------------------------------
# build: what is stored
# ---------------------------------------------------------------------------

@needs_pillow_python
class BuildStoredTests(ScriptCase):
    def test_build_a_figure_flattened_on_the_key(self):
        description = self.figure()
        result = self.build(description)
        self.assertEqual(result.code, 0, result.out)
        folder = self.set_folder("fig-v1")
        self.assertEqual(sorted(os.listdir(folder)), ["01_identity.png", "anchor.json"])
        stored = read_bytes(os.path.join(folder, "01_identity.png"))
        self.assertEqual(stored[25], 2)                                  # PNG colour type 2: RGB, no alpha channel
        pixels, size = pixels_of(os.path.join(folder, "01_identity.png"), (0, 0), (5, 5), (40, 40))
        self.assertEqual(pixels, [[255, 0, 255], [255, 0, 255], [200, 30, 30]])
        self.assertEqual(size, [80, 80])
        raw = read_bytes(os.path.join(folder, "anchor.json"))
        card = desk_art.parse_anchor_card(raw, "fig-v1")                 # the helper accepts the card as it is
        member = card["members"][0]
        self.assertEqual(member["sha256"], sha_of(stored))
        source = description["pictures"][0]["source"]
        self.assertEqual(member["source"], {"path": os.path.realpath(source), "sha256": sha_of(read_bytes(source))})
        self.assertEqual(member["prep"], "flatten on #FF00FF")
        self.assertEqual(member["provenance"], "owner")
        self.assertEqual(member["size"], [80, 80])
        self.assertEqual(list(card), ["format", "name", "made", "keep", "members"])           # the key order of 2.1
        self.assertEqual(list(member), ["file", "role", "sha256", "size", "source", "prep", "provenance"])
        self.assertTrue(raw.endswith(b"\n") and raw.decode("ascii") == json.dumps(card, ensure_ascii=True, indent=2)
                        + "\n")
        self.assertEqual(stat.S_IMODE(os.stat(folder).st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(os.stat(os.path.dirname(folder)).st_mode), 0o700)
        for name in os.listdir(folder):
            self.assertEqual(stat.S_IMODE(os.stat(os.path.join(folder, name)).st_mode), 0o600, name)
        answer = result.data
        stored_set = desk_art.load_anchor(self.sb.inbox, "fig-v1")
        self.assertEqual(answer["block"], desk_art.anchor_block(stored_set, 0))
        self.assertEqual(answer["inbox"], self.sb.inbox)
        self.assertEqual(answer["dir"], folder)
        self.assertEqual(answer["keep"], KEEP)
        self.assertEqual((answer["note"], answer["ownerSaid"], answer["wordsVersion"]), (None, None, "1"))
        self.assertEqual((answer["uploads"], answer["next"]), (UPLOADS, NEXT))
        self.assertNotIn("ignoredRoots", answer)
        self.assertEqual(answer["pictures"], [{
            "n": 1, "role": "identity", "file": "01_identity.png", "path": os.path.join(folder, "01_identity.png"),
            "size": [80, 80], "bytes": len(stored), "sha8": sha_of(stored)[:8], "sha256": sha_of(stored),
            "source": os.path.realpath(source), "prep": "flatten on #FF00FF", "provenance": "owner"}])
        self.assertEqual(list(answer)[:6], ["ok", "command", "set", "inbox", "dir", "pictures"])

    def test_build_a_close_up_and_its_room(self):
        room = self.source("big.png", png_bytes(1920, 1080, (120, 90, 60)))
        description = {"name": "courtyard-vending-v1", "keep": "red vending machine at the right",
                       "pictures": [{"role": "place", "source": room, "crop": [480, 270, 1440, 810],
                                     "size": [1672, 941]}, {"role": "room", "source": room}]}
        result = self.build(description)
        self.assertEqual(result.code, 0, result.out)
        card = self.card_of("courtyard-vending-v1")
        self.assertEqual([item["role"] for item in card["members"]], ["place", "room"])
        self.assertEqual([item["file"] for item in card["members"]], ["01_place.png", "02_room.png"])
        self.assertEqual([item["size"] for item in card["members"]], [[1672, 941], [1920, 1080]])
        self.assertEqual([item["prep"] for item in card["members"]], ["crop 480,270,1440,810; size 1672x941", ""])
        folder = self.set_folder("courtyard-vending-v1")
        self.assertEqual(sorted(os.listdir(folder)), ["01_place.png", "02_room.png", "anchor.json"])
        _, size = pixels_of(os.path.join(folder, "01_place.png"), (0, 0))
        self.assertEqual(size, [1672, 941])
        self.assertEqual([item["n"] for item in result.data["pictures"]], [1, 2])
        loaded = desk_art.load_anchor(self.sb.inbox, "courtyard-vending-v1")
        self.assertEqual(result.data["block"], desk_art.anchor_block(loaded, 0))
        self.assertIn("Picture 2 (room): the whole room that picture 1 is cut from.", result.data["block"])

    def test_a_place_must_be_16_9(self):
        room = self.source("room.png", png_bytes(1000, 800, (120, 90, 60)))
        description = {"name": "bad-v1", "pictures": [{"role": "place", "source": room, "crop": [0, 0, 800, 600]}]}
        result = self.build(description)
        self.assert_refused(result, "16:9")
        self.assert_nothing_saved()
        ok = {"name": "ok-v1", "pictures": [{"role": "place", "source": room, "crop": [0, 0, 800, 450]}]}
        self.assertEqual(self.build(ok).code, 0)                          # exactly 16:9 is fine, no size needed
        near = {"name": "near-v1", "pictures": [{"role": "place", "source": room, "crop": [0, 0, 800, 454]}]}
        self.assertEqual(self.build(near).code, 0)                        # within 1 percent
        far = {"name": "far-v1", "pictures": [{"role": "place", "source": room, "crop": [0, 0, 800, 470]}]}
        self.assert_refused(self.build(far), "16:9")

    def test_a_size_that_would_stretch_is_refused(self):
        room = self.source("room.png", png_bytes(1200, 800, (120, 90, 60)))
        description = {"name": "bad-v1", "pictures": [
            {"role": "identity", "source": room, "crop": [0, 0, 1000, 500], "size": [800, 800]}]}
        result = self.build(description)
        self.assert_refused(result, "stretch")
        self.assert_nothing_saved()
        same_shape = {"name": "ok-v1", "pictures": [
            {"role": "identity", "source": room, "crop": [0, 0, 1000, 500], "size": [400, 200]}]}
        self.assertEqual(self.build(same_shape).code, 0)
        self.assertEqual(self.card_of("ok-v1")["members"][0]["prep"], "crop 0,0,1000,500; size 400x200")

    def test_a_transparent_source_needs_a_key(self):
        """Transparency is judged by the alpha channel and never by the picture mode."""
        corner = lambda x, y: x < 8 and y < 8                              # noqa: E731
        sources = {
            "rgba": png_rgba(80, 80, lambda x, y: (10, 20, 30, 0 if corner(x, y) else 255)),
            "palette with tRNS": png_palette(80, 80, [(255, 0, 0), (0, 255, 0)], transparent_index=0,
                                              pixel=lambda x, y: 0 if corner(x, y) else 1),
            "grey with a tRNS colour key": png_grey(80, 80, lambda x, y: 0 if corner(x, y) else 200,
                                                     transparent_grey=0)}
        for label, data in sources.items():
            with self.subTest(label):
                path = self.source("t.png", data)
                result = self.build({"name": "t-v1", "pictures": [{"role": "identity", "source": path}]})
                self.assert_refused(result, "transparent")
                self.assertIn("key", result.data["error"])
                self.assert_nothing_saved()
        accepted = {
            "opaque rgba": png_rgba(80, 80, lambda x, y: (10, 20, 30, 255)),
            "palette without tRNS": png_palette(80, 80, [(255, 0, 0), (0, 255, 0)], pixel=lambda x, y: (x + y) % 2)}
        for number, (label, data) in enumerate(accepted.items(), start=1):
            with self.subTest(label):
                path = self.source("o%d.png" % number, data)
                result = self.build({"name": "open%d-v1" % number, "pictures": [{"role": "identity", "source": path}]})
                self.assertEqual(result.code, 0, result.out)
                self.assertEqual(self.card_of("open%d-v1" % number)["members"][0]["prep"], "")
        with self.subTest("a crop wholly in the opaque part"):
            path = self.source("c.png", sources["rgba"])
            description = {"name": "cropped-v1", "pictures": [
                {"role": "identity", "source": path, "crop": [8, 8, 80, 80], "key": "#00FF00"}]}
            result = self.build(description)
            self.assertEqual(result.code, 0, result.out)
            self.assertEqual(self.card_of("cropped-v1")["members"][0]["prep"], "crop 8,8,80,80")   # key not recorded
        with self.subTest("the transparent pixel of a palette picture becomes the key colour"):
            path = self.source("p.png", sources["palette with tRNS"])
            description = {"name": "keyed-v1", "pictures": [{"role": "identity", "source": path, "key": "#123456"}]}
            self.assertEqual(self.build(description).code, 0)
            stored = os.path.join(self.set_folder("keyed-v1"), "01_identity.png")
            pixels, _ = pixels_of(stored, (0, 0), (40, 40))
            self.assertEqual(pixels, [[0x12, 0x34, 0x56], [0, 255, 0]])
            self.assertEqual(self.card_of("keyed-v1")["members"][0]["prep"], "flatten on #123456")
        with self.subTest("a lower-case key is written in capitals"):
            path = self.source("l.png", sources["rgba"])
            self.assertEqual(self.build({"name": "lower-v1", "pictures": [
                {"role": "identity", "source": path, "key": "#ff00ff"}]}).code, 0)
            self.assertEqual(self.card_of("lower-v1")["members"][0]["prep"], "flatten on #FF00FF")

    def test_a_set_is_never_overwritten(self):
        description = self.figure("same-v1")
        self.assertEqual(self.build(description).code, 0)
        folder = self.set_folder("same-v1")
        before = {name: read_bytes(os.path.join(folder, name)) for name in os.listdir(folder)}
        other = self.source("other.png", png_bytes(70, 70, (1, 2, 3)))
        again = dict(description, pictures=[{"role": "identity", "source": other}])
        result = self.build(again)
        self.assert_refused(result, "already exists", code="set-exists")
        preview = self.build(again, preview=True)
        self.assert_refused(preview, "already exists", code="set-exists")       # a preview refuses a used name too
        after = {name: read_bytes(os.path.join(folder, name)) for name in os.listdir(folder)}
        self.assertEqual(before, after)

    def test_name_rules(self):
        path = self.source("n.png")
        for name in ("nanami", "Nanami-v1", "a-v0", "a-v1000", "a" * 36 + "-v999", "a" * 38 + "-v1", "a/b-v1", "..-v1",
                     "-a-v1"):
            with self.subTest(name):
                result = self.build({"name": name, "pictures": [{"role": "identity", "source": path}]})
                self.assert_refused(result, "name must look like")
        self.assert_nothing_saved()
        for name in ("a-v1", "x_y-z-v12", "a" * 35 + "-v999", "0-v999"):
            with self.subTest(name):
                result = self.build({"name": name, "pictures": [{"role": "identity", "source": path}]})
                self.assertEqual(result.code, 0, result.out)
        self.assertEqual(len("a" * 35 + "-v999"), 40)

    def test_png_metadata_is_dropped(self):
        plain = png_rgb(80, 80, (40, 60, 80))
        sources = {
            "a ComfyUI picture with its workflow text": png_with_chunks(plain, [(b"tEXt", b"prompt\0secret workflow")]),
            "a colour profile": png_with_chunks(plain, [(b"iCCP", b"test\0\0" + zlib.compress(b"profile" * 40))]),
            "a valid EXIF block": png_with_chunks(plain, [(b"eXIf", SMALL_EXIF)]),
            "a physical size": png_with_chunks(plain, [(b"pHYs", struct.pack(">IIB", 2835, 2835, 1))]),
            "a damaged EXIF block": png_with_chunks(plain, [(b"eXIf", b"junk-exif-bytes")]),
            "a transparent picture with a colour profile, flattened": png_with_chunks(
                png_rgba(80, 80, lambda x, y: (40, 60, 80, 0 if x < 5 else 255)),
                [(b"iCCP", b"test\0\0" + zlib.compress(b"profile" * 40)), (b"tEXt", b"prompt\0secret")])}
        for number, (label, data) in enumerate(sources.items(), start=1):
            with self.subTest(label):
                path = self.source("m%d.png" % number, data)
                name = "meta%d-v1" % number
                picture = {"role": "identity", "source": path, "key": "#FF00FF"}
                result = self.build({"name": name, "pictures": [picture]})
                self.assertEqual(result.err, "")                           # Pillow's warnings stay silent
                if not result.data["ok"]:
                    self.assertIn("damaged", label)                        # only a damaged block may be refused ...
                    self.assertEqual(result.data["code"], "bad-input", result.out)      # ... and never as "internal"
                    continue
                stored = read_bytes(os.path.join(self.set_folder(name), "01_identity.png"))
                kinds = png_chunks(stored)
                for hidden in HIDDEN_CHUNKS:
                    self.assertNotIn(hidden, kinds, label)
                self.assertEqual(set(kinds), {b"IHDR", b"IDAT", b"IEND"}, label)
                self.assertNotIn(b"secret", stored)

    def test_a_webp_source_and_a_turned_picture(self):
        webp = self.source("w.webp", b"placeholder")                  # makes the folder; Pillow writes the picture
        with_pillow("import sys\nfrom PIL import Image\nImage.new('RGB', (70, 66), (4, 5, 6)).save(sys.argv[1], "
                    "format='WEBP', lossless=True)\nprint(1)", webp)
        result = self.build({"name": "web-v1", "pictures": [{"role": "identity", "source": webp}]})
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["pictures"][0]["size"], [70, 66])
        stored = read_bytes(os.path.join(self.set_folder("web-v1"), "01_identity.png"))
        self.assertTrue(stored.startswith(PNG_SIGNATURE))
        # a picture that a camera or tool marked "turn me" is stored the right way up (EXIF orientation 6)
        turn = bytes.fromhex("4d4d002a00000008" "0001" "01120003" "00000001" "00060000" "00000000")
        path = self.source("turned.png", png_with_chunks(png_rgb(80, 64, (1, 2, 3)), [(b"eXIf", turn)]))
        result = self.build({"name": "turn-v1", "pictures": [{"role": "identity", "source": path}]})
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["pictures"][0]["size"], [64, 80])
        self.assertEqual(self.card_of("turn-v1")["members"][0]["size"], [64, 80])

    def test_the_note_and_the_owners_words_are_kept(self):
        description = self.figure("note-v1", note="Nanami, Arc 1 Final art on flat magenta",
                                  owner_said="yes, use this")
        result = self.build(description)
        self.assertEqual(result.code, 0, result.out)
        card = self.card_of("note-v1")
        self.assertEqual(list(card), ["format", "name", "made", "keep", "note", "owner_said", "members"])
        said = ("Nanami, Arc 1 Final art on flat magenta", "yes, use this")
        self.assertEqual((card["note"], card["owner_said"]), said)
        self.assertEqual((result.data["note"], result.data["ownerSaid"]),
                         ("Nanami, Arc 1 Final art on flat magenta", "yes, use this"))
        self.assertRegex(card["made"], r"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$")
        # the words sent to a generator never carry the note, the owner's words or a path
        self.assertNotIn("Nanami", result.data["block"])
        self.assertNotIn("yes, use this", result.data["block"])
        self.assertNotIn(self.sb.home, result.data["block"])

    def test_a_damaged_exif_block_in_a_jpeg_stays_silent(self):
        path = real_jpeg(self.art_path("exif.jpg"), size=(80, 70))
        data = read_bytes(path)
        broken = b"Exif\x00\x00" + bytes.fromhex("4d4d002a00000008" "0001" "0112")        # a block that stops short
        segment = b"\xff\xe1" + struct.pack(">H", len(broken) + 2) + broken
        self.sb.write_file(path, data[:2] + segment + data[2:])
        result = self.build({"name": "exif-v1", "pictures": [{"role": "identity", "source": path}]})
        self.assertEqual(result.code, 0, result.out)                       # run_script proves standard error is empty
        self.assertEqual(result.err, "")
        stored = read_bytes(os.path.join(self.set_folder("exif-v1"), "01_identity.png"))
        self.assertEqual(set(png_chunks(stored)), {b"IHDR", b"IDAT", b"IEND"})

    def test_other_formats_become_png(self):
        path = real_jpeg(self.art_path("photo.jpg"), size=(90, 70))
        result = self.build({"name": "photo-v1", "pictures": [{"role": "identity", "source": path}]})
        self.assertEqual(result.code, 0, result.out)
        stored = read_bytes(os.path.join(self.set_folder("photo-v1"), "01_identity.png"))
        self.assertTrue(stored.startswith(PNG_SIGNATURE))
        self.assertEqual(result.data["pictures"][0]["size"], [90, 70])
        self.assertEqual(self.card_of("photo-v1")["members"][0]["size"], [90, 70])
        pixels, size = pixels_of(os.path.join(self.set_folder("photo-v1"), "01_identity.png"), (10, 10))
        self.assertEqual(size, [90, 70])
        self.assertTrue(all(abs(got - want) <= 6 for got, want in zip(pixels[0], (40, 90, 200))), pixels)

    def test_a_16_bit_grey_picture_is_stored_right(self):
        """Pillow turns every 16-bit grey value above 255 into white; the builder scales the picture down first."""
        keyed = self.source("deepkey.png", png_grey16(256, 64, lambda x, y: x * 256, transparent_grey=0))
        refused = self.build({"name": "deepkey-v1", "pictures": [{"role": "identity", "source": keyed}]})
        self.assert_refused(refused, "16-bit grey picture with a transparent colour")
        self.assert_nothing_saved()                                 # a colour key cannot be scaled exactly: refused
        path = self.source("deep.png", png_grey16(256, 64, lambda x, y: x * 256))
        result = self.build({"name": "deep-v1", "pictures": [{"role": "identity", "source": path}]})
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.err, "")
        points = [(0, 0), (1, 0), (64, 0), (128, 0), (192, 0), (254, 0), (255, 0)]
        pixels, size = pixels_of(os.path.join(self.set_folder("deep-v1"), "01_identity.png"), *points)
        self.assertEqual(size, [256, 64])
        self.assertEqual(pixels, [[x, x, x] for x, _ in points])    # 0, 1, 64 ... 255 and not 0, 255, 255 ... 255
        self.assertEqual(self.card_of("deep-v1")["members"][0]["size"], [256, 64])


# ---------------------------------------------------------------------------
# build: what is refused (and nothing is written)
# ---------------------------------------------------------------------------

def header_only_png(width, height):
    """A PNG whose header claims a large size and whose picture data is empty: a decoder must not be started on it."""
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)
    return (PNG_SIGNATURE + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(b"")) + chunk(b"IEND", b""))


@needs_pillow_python
class BuildRefusalTests(ScriptCase):
    def test_the_description_rules(self):
        ok = self.source("ok.png")
        quoted = json.dumps(ok)

        def pic(**more):
            return dict({"role": "identity", "source": ok}, **more)

        def desc(**more):
            return dict({"name": "x-v1", "pictures": [pic()]}, **more)

        def raw(crop=None, size=None):
            parts = '"role":"identity","source":%s' % quoted
            parts += ',"crop":%s' % crop if crop else ""
            parts += ',"size":%s' % size if size else ""
            return '{"name":"x-v1","pictures":[{%s}]}' % parts
        good = json.dumps(desc()).encode("utf-8")
        ascii_only = "plain ASCII text"
        rows = [
            ("empty input", b"", "empty"),
            ("65,537 bytes", good + b" " * (65537 - len(good)), "64 KB"),
            ("not JSON", b"not json", "not valid JSON"),
            ("a JSON list", b"[]", "must be a JSON object"),
            ("30,000 nested brackets", b"[" * 30000, "not valid JSON"),
            ("not UTF-8", b"\xff\xfe{}", "UTF-8"),
            ("a key twice", b'{"name":"x-v1","name":"y-v1","pictures":[]}', "not valid JSON"),
            ("an unknown top-level key", desc(extra=1),
             "the description has a part the set builder does not know (extra)"),
            ("an unknown picture key", desc(pictures=[pic(extra=1)]),
             "picture 1 has a part the set builder does not know (extra)"),
            ("no name", {"pictures": [pic()]}, "has no name"),
            ("no pictures", {"name": "x-v1"}, "has no pictures"),
            ("0 pictures", desc(pictures=[]), "1 to 3 pictures"),
            ("4 pictures", desc(pictures=[pic(role="style")] * 4), "1 to 3 pictures"),
            ("pictures not a list", desc(pictures={}), "1 to 3 pictures"),
            ("a picture that is not an object", desc(pictures=[5]), "must be an object"),
            ("no role", desc(pictures=[{"source": ok}]), "has no role"),
            ("an invalid role", desc(pictures=[pic(role="pose")]), "role must be one of"),
            ("a role in capitals", desc(pictures=[pic(role="Identity")]), "role must be one of"),
            ("no source", desc(pictures=[{"role": "identity"}]), "has no source"),
            ("two identity pictures", desc(pictures=[pic(), pic()]), "a set holds at most"),
            ("two place pictures", desc(pictures=[pic(role="place"), pic(role="place")]), "a set holds at most"),
            ("three style pictures", desc(pictures=[pic(role="style")] * 3), "a set holds at most"),
            ("a room without a place", desc(pictures=[pic(role="room")]), "needs a place picture"),
            ("a light without a place", desc(pictures=[pic(role="light")]), "needs a place picture"),
            ("a place, a room and a light", desc(pictures=[pic(role="place"), pic(role="room"), pic(role="light")]),
             "cannot hold both a room picture and a light picture"),
            ("keep with a new line", desc(keep="a\nb"), "keep must be " + ascii_only),
            ("keep with an accented letter", desc(keep="caf" + chr(0xE9)), "keep must be " + ascii_only),
            ("keep of 301 characters", desc(keep="x" * 301), "keep must be " + ascii_only),
            ("keep not a string", desc(keep=5), "keep must be " + ascii_only),
            ("note of 2 characters", desc(note="ab"), "note must be " + ascii_only),
            ("note of 201 characters", desc(note="x" * 201), "note must be " + ascii_only),
            ("note null", desc(note=None), "note must be " + ascii_only),
            ("owner_said of 2 characters", desc(owner_said="ab"), "owner_said must be " + ascii_only),
            ("a crop that runs backwards", desc(pictures=[pic(crop=[70, 0, 5, 70])]), "crop must be"),
            ("a crop outside the source", desc(pictures=[pic(crop=[0, 0, 100, 100])]), "crop must be"),
            ("a crop of three numbers", desc(pictures=[pic(crop=[0, 0, 70])]), "crop must be"),
            ("a crop smaller than 64", desc(pictures=[pic(crop=[0, 0, 63, 63])]), "crop must be"),
            ("a crop too narrow", desc(pictures=[pic(crop=[0, 0, 63, 70])]), "crop must be"),
            ("a crop too low", desc(pictures=[pic(crop=[0, 0, 70, 63])]), "crop must be"),
            ("a crop that starts too far down", desc(pictures=[pic(crop=[0, 20, 70, 90])]), "crop must be"),
            ("a negative crop start", desc(pictures=[pic(crop=[-1, 0, 70, 70])]), "crop must be"),
            ("a crop with a float", raw(crop="[0.0,0,70,70]"), "crop must be"),
            ("a crop with a bool", raw(crop="[true,0,70,70]"), "crop must be"),
            ("a crop with NaN", raw(crop="[0,0,NaN,70]"), "not valid JSON"),
            ("a size with Infinity", raw(size="[Infinity,100]"), "not valid JSON"),
            ("a size with -Infinity", raw(size="[-Infinity,100]"), "not valid JSON"),
            ("a number of 31 digits", raw(size="[1%s,100]" % ("0" * 30)),
             "a number in the description has more than 30 digits"),
            ("a crop number of 41 digits", raw(crop="[0,0,%d,100]" % 10 ** 40),
             "a number in the description has more than 30 digits"),
            ("a size of 63", desc(pictures=[pic(size=[63, 63])]), "size must be"),
            ("a size of 4097", desc(pictures=[pic(size=[4097, 4097])]), "size must be"),
            ("a size of one number", desc(pictures=[pic(size=[100])]), "size must be"),
            ("a size with a bool", raw(size="[true,100]"), "size must be"),
            ("a key of 3 digits", desc(pictures=[pic(key="#FFF")]), "key must be"),
            ("a key that is a word", desc(pictures=[pic(key="magenta")]), "key must be"),
            ("a key without the hash", desc(pictures=[pic(key="FF00FF")]), "key must be"),
            ("a source that is a list", desc(pictures=[pic(source=[ok])]), "source must be"),
            ("a source that is relative", desc(pictures=[pic(source="ok.png")]), "source must be"),
            ("a source with a NUL", desc(pictures=[pic(source=ok + "\x00x")]), "source must be"),
            ("a source with a lone surrogate", desc(pictures=[pic(source=ok + chr(0xD800))]), "source must be"),
            ("a source that is empty", desc(pictures=[pic(source="")]), "source must be")]
        for label, stuff, fragment in rows:
            with self.subTest(label):
                result = self.build(stuff if isinstance(stuff, bytes) else
                                    stuff if isinstance(stuff, str) else json.dumps(stuff))
                self.assert_refused(result, fragment)
                self.assertEqual(result.err, "")
                self.assert_nothing_saved()
        self.assertFalse(os.path.exists(os.path.join(self.sb.cache, "anchor-looks")))

    def test_sources_are_judged_like_references(self):
        home = self.sb.home
        outside = self.sb.write_file(os.path.join(self.sb.outside, "real.png"), png_bytes(80, 80))
        link = os.path.join(self.sb.art, "link.png")
        os.makedirs(self.sb.art, exist_ok=True)
        os.symlink(outside, link)
        folder = os.path.join(self.sb.art, "folder.png")
        os.makedirs(folder)
        big = PNG_SIGNATURE + b"\0" * (20 * 1024 * 1024 + 1 - len(PNG_SIGNATURE))
        rows = [
            ("/etc/hosts", "/etc/hosts", "is not allowed: it is not inside your home folder"),
            ("a hidden folder", self.sb.write_file(os.path.join(home, ".hidden", "x.png"), png_bytes(80, 80)),
             "inside a hidden folder"),
            ("the Library", self.sb.write_file(os.path.join(home, "Library", "x.png"), png_bytes(80, 80)),
             "inside ~/Library"),
            ("auth.json", self.source("auth.json", png_bytes(80, 80)), "looks like a secrets or sign-in file"),
            (".env.png", self.source(".env.png", png_bytes(80, 80)), "looks like a secrets or sign-in file"),
            ("a link to a file outside the home", link, "not inside your home folder"),
            ("a folder", folder, "is not a regular file"),
            ("a text file named x.png", self.source("x.png", b"just some words"), "not a PNG, JPEG or WEBP"),
            ("a file over 20 MB", self.source("big.png", big), "20 MB"),
            ("outside the standard folders", self.source("e.png", folder=os.path.join(home, "Pictures")),
             "is not in a folder desk-art may send from"),
            ("41 megapixels", self.source("mega.png", header_only_png(8200, 5000)),
             "is 41 megapixels, and the limit is 40"),
            ("40.005 megapixels never reads as 40", self.source("over.png", header_only_png(8001, 5000)),
             "is 40.1 megapixels, and the limit is 40"),
            ("a header of 3600 megapixels", self.source("huge.png", header_only_png(60000, 60000)), "megapixels"),
            ("a header that is cut short", self.source("cut.png", PNG_SIGNATURE + b"\0\0\0\x0dIHDR"),
             "not a readable PNG, JPEG or WEBP picture"),
            ("a name with a new line", self.source("bad\nname.png"), "cannot be recorded in the card"),
            ("a file that is not there", os.path.join(self.sb.art, "nothing.png"), "was not found")]
        for label, path, fragment in rows:
            with self.subTest(label):
                result = self.build({"name": "src-v1", "pictures": [{"role": "identity", "source": path}]})
                self.assert_refused(result, fragment)
                self.assertTrue(result.data["error"].startswith("picture 1") or "picture 1:" in result.data["error"],
                                result.data["error"])
                self.assertEqual(result.err, "")
                self.assert_nothing_saved()

    def test_restricted_words_are_refused_before_a_file_is_opened(self):
        fine = self.source("fine.png")
        base = self.sb.art
        rows = [
            ("Onsen outfits", os.path.join(base, "Onsen outfits", "x.png"), "onsen"),
            ("Swimwear outfits", os.path.join(base, "Swimwear outfits", "x.png"), "swim"),
            ("Pyjamas", os.path.join(base, "Pyjamas", "x.png"), "pyjama"),
            ("Outfits cleaned 2026-10-27", os.path.join(base, "Outfits cleaned 2026-10-27", "x.png"), "outfits"),
            ("romance_poses", os.path.join(base, "romance_poses", "x.png"), "romance pose"),
            ("Ask for a pose", os.path.join(base, "Ask for a pose", "x.png"), "ask for a pose"),
            ("char/outfits", os.path.join(base, "char", "outfits", "x.png"), "outfits"),
            ("maki_swim.png", os.path.join(base, "maki_swim.png"), "swim"),
            ("ic_place_pool.png", os.path.join(base, "ic_place_pool.png"), "pool"),
            ("a fullwidth spelling of onsen", os.path.join(base, "".join(chr(0xFF00 + ord(c) - 0x20) for c in "onsen"),
                                                            "x.png"), "onsen"),
            ("SWIMWEAR in capitals", os.path.join(base, "SWIMWEAR", "x.png"), "swim"),
            ("a link name", os.path.join(base, "Bath-house", "x.png"), "bath")]
        for label, path, word in rows:
            with self.subTest(label):
                result = self.build({"name": "scope-v1", "pictures": [{"role": "identity", "source": path}]})
                self.assert_refused(result, "scope rule")
                self.assertIn('mentions "%s"' % word, result.data["error"])
                self.assertNotIn("was not found", result.data["error"])      # the file was never looked for
                self.assertIn("Stop and tell the owner once; do not look for another way in.", result.data["error"])
        # the path as written and the real path are both judged: a harmless link to a restricted place, and a
        # restricted-looking link to a harmless file
        harmless = self.source("harmless.png", png_bytes(80, 80, (7, 7, 7)))
        hidden_target = self.source("real.png", png_bytes(80, 80, (8, 8, 8)),
                                    folder=os.path.join(base, "Onsen outfits"))
        os.symlink(harmless, os.path.join(base, "swimlink.png"))
        os.symlink(hidden_target, os.path.join(base, "innocent.png"))
        for label, link, kind, word in (("a link with a restricted name", "swimlink.png", "the path ", "swim"),
                                        ("a link into a restricted folder", "innocent.png", "the real path ", "onsen")):
            with self.subTest(label):
                result = self.build({"name": "scope-v1", "pictures": [
                    {"role": "identity", "source": os.path.join(base, link)}]})
                self.assert_refused(result, "scope rule")
                self.assertTrue(result.data["error"].startswith(kind), result.data["error"])
                self.assertIn('mentions "%s"' % word, result.data["error"])
        for label, extra in (("the keep line", {"keep": "a red bikini top"}), ("the name", {"name": "pool-v1"}),
                             ("the note", {"note": "next to the towel rack"})):
            with self.subTest(label):
                description = {"name": "scope-v1", "pictures": [{"role": "identity", "source": fine}]}
                description.update(extra)
                result = self.build(description)
                self.assert_refused(result, "scope rule")
                self.assertTrue(result.data["error"].startswith(label), result.data["error"])
        self.assert_nothing_saved()
        # the wording of the "outfits" refusal does not say that outfits are banned
        result = self.build({"name": "scope-v1", "pictures": [
            {"role": "identity", "source": os.path.join(base, "Outfits cleaned 2026-10-27", "x.png")}]})
        self.assertIn('mentions "outfits"', result.data["error"])
        self.assertIn("cannot tell this one from those", result.data["error"])
        fixed = result.data["error"].split("The scope rule", 1)[1]
        self.assertNotIn("outfits", fixed.lower())
        # harmless names reach the next check
        for path in (os.path.join(base, "consent forms", "x.png"), os.path.join(base, "carpool-lane.png")):
            with self.subTest(path):
                result = self.build({"name": "fine-v1", "pictures": [{"role": "identity", "source": path}]})
                self.assert_refused(result, "was not found")

    def test_a_home_folder_named_like_a_restricted_word_is_not_a_hit(self):
        beach = os.path.join(self.sb.root, "x", "beach")
        env = {"DESK_ART_HOME": beach, "DESK_ART_INBOX": os.path.join(beach, "Desktop", "art inbox"),
               "DESK_ART_CACHE": os.path.join(beach, "Library", "Caches", "desk-art")}
        room = self.sb.write_file(os.path.join(beach, "Desktop", "JJKgame.md", "room.png"), png_bytes(80, 80))
        result = self.build({"name": "room-v1", "pictures": [{"role": "identity", "source": room}]}, inbox=False,
                            env=env)
        self.assertEqual(result.code, 0, result.out)
        self.assertTrue(os.path.isdir(os.path.join(beach, "Desktop", "art inbox", "anchors", "room-v1")))
        outside_home = self.sb.write_file(os.path.join(self.sb.root, "x", "beach", "elsewhere", "y.png"),
                                          png_bytes(80, 80))
        self.assertTrue(os.path.exists(outside_home))


# ---------------------------------------------------------------------------
# build: where a picture came from, and who has to say yes
# ---------------------------------------------------------------------------

@needs_pillow_python
class ProvenanceTests(ScriptCase):
    def pair(self, name, inbox_picture, owner_source=None, owner_said=None, preview=False, order=("style", "identity")):
        """A description of an inbox picture (style) and the owner's own picture (identity)."""
        own = owner_source or self.source("own.png", png_bytes(80, 80, (5, 6, 7)))
        pictures = {"style": {"role": "style", "source": inbox_picture},
                    "identity": {"role": "identity", "source": own}}
        description = {"name": name, "pictures": [pictures[role] for role in order]}
        if owner_said:
            description["owner_said"] = owner_said
        return self.build(description, preview=preview)

    def test_inbox_and_generated_pictures_need_the_owners_say(self):
        made = png_bytes(80, 80, (111, 2, 3))
        path = self.inbox_picture("hero_codex_01_aaaaaaaa.png", made)
        self.add_note(made, "codex")
        # (a) a picture a generator made needs the owner's say
        result = self.pair("gen-v1", path)
        self.assert_refused(result, "needs the owner's say")
        self.assertIn("picture 1 is a generated picture, not the owner's own art", result.data["error"])
        self.assertIn("Ask the owner, then put their words in owner_said.", result.data["error"])
        # ... with it, and with a picture of the owner's own art, the set is made (c)
        result = self.pair("gen-v2", path, owner_said="yes, use the last one")
        self.assertEqual(result.code, 0, result.out)
        card = self.card_of("gen-v2")
        self.assertEqual([item["provenance"] for item in card["members"]], ["generated", "owner"])
        self.assertEqual(card["owner_said"], "yes, use the last one")
        self.assertEqual(result.data["ownerSaid"], "yes, use the last one")
        # (b) a set made only of generated pictures is refused even with the owner's say
        alone = {"name": "gen-v3", "owner_said": "yes, use it", "pictures": [{"role": "identity", "source": path}]}
        self.assert_refused(self.build(alone), "own art")
        # (g) a generated picture copied into a game folder is still generated
        copy = self.source("copy.png", made)
        result = self.pair("gen-v4", copy)
        self.assert_refused(result, "needs the owner's say")
        # (h) a picture whose bytes match a row with backend "other", in a game folder, is the owner's own
        theirs = png_bytes(80, 80, (9, 9, 9))
        self.add_note(theirs, "other")
        result = self.pair("own-v1", self.source("theirs.png", theirs))
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual([item["provenance"] for item in self.card_of("own-v1")["members"]], ["owner", "owner"])
        self.assertNotIn("owner_said", self.card_of("own-v1"))

    def test_supplied_and_unnoted_pictures(self):
        supplied = png_bytes(80, 80, (33, 44, 55))
        path = self.inbox_picture("painting.png", supplied)
        self.add_note(supplied, "other")
        # (d) a picture the owner supplied (backend other) in the inbox needs the owner's say; it is not "generated"
        result = self.build({"name": "sup-v1", "pictures": [{"role": "identity", "source": path}]})
        self.assert_refused(result, "needs the owner's say")
        self.assertIn("is a supplied picture", result.data["error"])
        result = self.build({"name": "sup-v2", "owner_said": "yes, this is my painting",
                             "pictures": [{"role": "identity", "source": path}]})
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(self.card_of("sup-v2")["members"][0]["provenance"], "supplied")
        # (e) an inbox picture with no row is treated as generated
        lone = self.inbox_picture("lone.png", png_bytes(80, 80, (77, 1, 1)))
        result = self.pair("lone-v1", lone, owner_said="yes, use it")
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(self.card_of("lone-v1")["members"][0]["provenance"], "generated")
        alone = self.build({"name": "lone-v2", "owner_said": "yes, use it",
                            "pictures": [{"role": "identity", "source": lone}]})
        self.assert_refused(alone, "own art")

    def test_a_picture_inside_another_set_is_not_a_source(self):
        write_set(self.sb, "other-v1", [{"role": "identity", "png": png_bytes(80, 80, (1, 2, 3))}])
        inside = os.path.join(self.set_folder("other-v1"), "01_identity.png")
        result = self.build({"name": "copy-v1", "owner_said": "yes, use it",
                             "pictures": [{"role": "identity", "source": inside}]})
        self.assert_refused(result, "another anchor set")
        self.assertFalse(os.path.exists(self.set_folder("copy-v1")))

    def test_another_sets_picture_is_refused_whatever_the_case_of_its_folders(self):
        """The Mac's disk ignores case, so Anchors/ is anchors/: the refusal must not depend on the spelling."""
        write_set(self.sb, "other-v1", [{"role": "identity", "png": png_bytes(80, 80, (1, 2, 3))}])
        loud = self.needs_a_disk_that_ignores_case(self.sb.inbox, "anchors")
        for label, parts in (("the anchors folder", (loud, "other-v1", "01_identity.png")),
                             ("the set folder", ("anchors", "OTHER-V1", "01_identity.png")),
                             ("the file", ("anchors", "other-v1", "01_IDENTITY.PNG")),
                             ("all three", (loud, "OTHER-V1", "01_IDENTITY.PNG"))):
            for preview in (True, False):
                with self.subTest("%s, preview %s" % (label, preview)):
                    description = {"name": "copy-v1", "owner_said": "yes, use it", "pictures": [
                        {"role": "identity", "source": os.path.join(self.sb.inbox, *parts)}]}
                    self.assert_refused(self.build(description, preview=preview), "another anchor set")
        self.assertEqual(os.listdir(os.path.join(self.sb.inbox, "anchors")), ["other-v1"])      # no copy was made

    def test_inbox_pictures_need_the_owners_say_whatever_the_case_of_the_folder(self):
        """An inbox inside the game's art folder (the real default sits in "JJK Game images"): a picture there is the
        inbox's, made by a generator or supplied, however its path is spelled, and never counts as the owner's own."""
        inbox = os.path.join(self.sb.art, "desk_art_inbox")
        env = {"DESK_ART_INBOX": inbox}
        supplied = png_bytes(80, 80, (33, 44, 55))
        plain = self.sb.write_file(os.path.join(inbox, "2026-11-09", "norow.png"), png_bytes(80, 80, (111, 2, 3)))
        painting = self.sb.write_file(os.path.join(inbox, "2026-11-09", "painting.png"), supplied)
        row = {"ts": "2026-11-09T01:00:00Z", "backend": "other", "label": "x", "sha256": sha_of(supplied)}
        with open(os.path.join(inbox, "manifest.jsonl"), "wb") as handle:
            handle.write(json.dumps(row).encode("ascii") + b"\n")
        loud = self.needs_a_disk_that_ignores_case(self.sb.art, "desk_art_inbox")
        own = self.source("own.png", png_bytes(80, 80, (5, 6, 7)))
        for label, path, kind in (("a picture with no note", plain, "generated"),
                                  ("a picture the owner supplied", painting, "supplied")):
            for spelling in (path, path.replace("/desk_art_inbox/", "/%s/" % loud)):
                with self.subTest("%s, %s" % (label, os.path.basename(os.path.dirname(os.path.dirname(spelling))))):
                    alone = {"name": "inb-v1", "pictures": [{"role": "identity", "source": spelling}]}
                    result = self.build(alone, inbox=False, env=env, preview=True)
                    self.assert_refused(result, "needs the owner's say")
                    self.assertIn("is a %s picture" % kind, result.data["error"])
                    pair = {"name": "inb-v1", "owner_said": "yes, use it", "pictures": [
                        {"role": "style", "source": spelling}, {"role": "identity", "source": own}]}
                    result = self.build(pair, inbox=False, env=env, preview=True)
                    self.assertEqual(result.code, 0, result.out)
                    self.assertEqual([item["provenance"] for item in result.data["pictures"]], [kind, "owner"])

    def test_the_manifest_tail_is_capped_and_hostile_lines_are_skipped(self):
        made = png_bytes(80, 80, (101, 102, 103))
        path = self.inbox_picture("tail.png", made)
        row = json.dumps({"ts": "x", "backend": "other", "label": "t", "sha256": sha_of(made)}).encode("ascii") + b"\n"

        def filler(count):
            return b"".join(json.dumps({"ts": "x", "backend": "codex", "label": "f", "sha256": "%064x" % number,
                                        "prompt": "p" * 130}).encode("ascii") + b"\n" for number in range(count))

        def provenance(**flags):
            result = self.pair("tail-v1", path, owner_said="yes, use it", preview=True)
            self.assertEqual(result.code, 0, result.out)
            return result.data["pictures"][0]["provenance"]
        notes = os.path.join(self.sb.inbox, "manifest.jsonl")
        # (a) a notes file of more than 4 MB: only its last 4 MB is searched
        block = filler(20000)
        self.assertGreater(len(block) * 2, 4 * 1024 * 1024)
        with open(notes, "wb") as handle:
            handle.write(row + block + block)
        self.assertEqual(provenance(), "generated")                  # the row lies in the first megabyte: not seen
        with open(notes, "wb") as handle:
            handle.write(block + block + row)
        self.assertEqual(provenance(), "supplied")                   # the same row in the last megabyte: seen
        # (b) hostile lines are skipped and the valid row after them is found
        hostile = [b"[1, 2, 3]", b'"a bare string"', b"[" * 40000, b'{"sha256":"abc","n":' + b"9" * 5000 + b"}",
                   b"\xff\xfe\xfd not utf-8 \xff", json.dumps({"sha256": 12345, "backend": "other"}).encode("ascii"),
                   b"", b"{not json at all"]
        with open(notes, "wb") as handle:
            handle.write(b"\n".join(hostile) + b"\n" + row)
        self.assertEqual(provenance(), "supplied")
        # (c) a notes file that is a link, a folder or unreadable is no rows, and nothing breaks
        os.remove(notes)
        elsewhere = os.path.join(self.sb.root, "elsewhere.jsonl")
        with open(elsewhere, "wb") as handle:
            handle.write(row)
        os.symlink(elsewhere, notes)
        self.assertEqual(provenance(), "generated")
        os.remove(notes)
        os.mkdir(notes)
        self.assertEqual(provenance(), "generated")
        os.rmdir(notes)
        with open(notes, "wb") as handle:
            handle.write(row)
        if os.geteuid() != 0:                                        # the super-user can read any file
            os.chmod(notes, 0)
            try:
                self.assertEqual(provenance(), "generated")
            finally:
                os.chmod(notes, 0o600)
        # the newest row for a picture wins
        later = json.dumps({"ts": "y", "backend": "codex", "label": "t", "sha256": sha_of(made)}).encode("ascii")
        with open(notes, "wb") as handle:
            handle.write(row + later + b"\n")
        self.assertEqual(provenance(), "generated")


# ---------------------------------------------------------------------------
# build: the inbox, links, the folders pictures may be read from
# ---------------------------------------------------------------------------

@needs_pillow_python
class InboxTests(ScriptCase):
    def test_the_inbox_rule(self):
        description = self.figure("fig-v1")
        stray = os.path.join(self.sb.home, "Desktop", "stray inbox")
        inside_game = os.path.join(self.sb.art, "somewhere")
        os.makedirs(stray)
        os.makedirs(inside_game)
        for label, folder in (("a folder that is not the inbox", stray), ("a folder inside the game", inside_game)):
            with self.subTest(label):
                result = self.run_script(["build", "--inbox", folder], stdin=json.dumps(description), python=PIL_PYTHON)
                self.assert_refused(result, "not the art inbox", code="inbox-unsafe")
                self.assertIn("ingest", result.data["error"])
                self.assertEqual(os.listdir(folder), [])
        with self.subTest("/etc"):
            result = self.run_script(["build", "--inbox", "/etc"], stdin=json.dumps(description), python=PIL_PYTHON)
            self.assertEqual((result.code, result.data["code"]), (2, "inbox-unsafe"))
        for command in ("list", "show", "words"):
            with self.subTest(command):
                tail = ["x-v1"] if command != "list" else []
                result = self.run_script([command, "--inbox", stray] + tail)
                self.assert_refused(result, "not the art inbox", code="inbox-unsafe")
        # a non-default folder that has a notes file is accepted, and build says which inbox it used
        other = os.path.join(self.sb.home, "Desktop", "other inbox")
        os.makedirs(other)
        with open(os.path.join(other, "manifest.jsonl"), "wb"):
            pass
        result = self.run_script(["build", "--inbox", other], stdin=json.dumps(description), python=PIL_PYTHON)
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["inbox"], other)
        self.assertTrue(os.path.isdir(os.path.join(other, "anchors", "fig-v1")))
        self.assertFalse(os.path.exists(self.sb.inbox))
        # a call WITHOUT --inbox makes the set in the default inbox (this is why the skill always passes --inbox)
        result = self.build(description, inbox=False)
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["inbox"], self.sb.inbox)
        self.assertTrue(os.path.isdir(os.path.join(self.sb.inbox, "anchors", "fig-v1")))

    def test_a_missing_default_inbox_is_made_by_build_only(self):
        self.assertFalse(os.path.exists(self.sb.inbox))
        for command in (["list"], ["show", "x-v1"], ["words", "x-v1"]):
            result = self.run_script(command)
            self.assertFalse(os.path.exists(self.sb.inbox), command)
            if command == ["list"]:
                self.assertEqual((result.code, result.data["count"], result.data["sets"]), (0, 0, []))
                self.assertEqual(result.data["inbox"], self.sb.inbox)
            else:
                self.assert_refused(result, "was not found", code="set-not-found")
                self.assertIn("No anchor sets are saved yet.", result.data["hint"])
        preview = self.build(self.figure("fig-v1"), preview=True)
        self.assertEqual(preview.code, 0, preview.out)
        self.assertFalse(os.path.exists(self.sb.inbox))                  # a preview does not make the inbox
        result = self.build(self.figure("fig-v1"))
        self.assertEqual(result.code, 0, result.out)
        self.assertTrue(os.path.isdir(os.path.join(self.sb.inbox, "anchors", "fig-v1")))

    def test_links_are_refused(self):
        elsewhere = os.path.join(self.sb.root, "elsewhere")
        os.makedirs(elsewhere)
        os.makedirs(self.sb.inbox)
        anchors = os.path.join(self.sb.inbox, "anchors")
        os.symlink(elsewhere, anchors)
        for label, result in (("build", self.build(self.figure("link-v1"))),
                              ("preview", self.build(self.figure("link-v1"), preview=True)),
                              ("list", self.run_script(["list", "--inbox", self.sb.inbox]))):
            with self.subTest(label):
                self.assertEqual((result.code, result.data["code"]), (2, "inbox-unsafe"), result.out)
                self.assertIn("link", result.data["error"])
        self.assertEqual(os.listdir(elsewhere), [])
        # a link where the new set folder would be
        os.remove(anchors)
        os.makedirs(anchors)
        os.symlink(elsewhere, os.path.join(anchors, "link-v2"))
        result = self.build(self.figure("link-v2"))
        self.assertEqual(result.code, 2, result.out)
        self.assertIn(result.data["code"], ("set-exists", "inbox-unsafe"))
        self.assertEqual(os.listdir(elsewhere), [])
        listed = self.run_script(["list", "--inbox", self.sb.inbox])
        self.assertEqual(listed.data["sets"], [])                        # a link is skipped without a word

    def test_a_link_in_place_of_the_looks_folder_is_refused(self):
        """Rule L: a preview goes only into the real anchor-looks folder of the cache, never through a link."""
        elsewhere = os.path.join(self.sb.root, "elsewhere")
        os.makedirs(elsewhere)
        os.makedirs(self.sb.cache)
        os.symlink(elsewhere, os.path.join(self.sb.cache, "anchor-looks"))
        for description in (self.figure("lnk-v1"), self.close_up("lnk-v2")):
            result = self.build(description, preview=True)
            self.assertEqual((result.code, result.data.get("code")), (2, "inbox-unsafe"), result.out)
            self.assertIn("anchor-looks folder is a link that leads elsewhere", result.data["error"])
            self.assertEqual(os.listdir(elsewhere), [])                  # nothing was written through the link
        self.assert_nothing_saved()

    def test_ref_root_only_narrows(self):
        first = self.source("a.png", png_bytes(80, 80, (1, 1, 1)))
        second = self.source("b.png", png_bytes(80, 80, (2, 2, 2)),
                             folder=os.path.join(self.sb.home, "Desktop", "JJK Game images"))
        sub = os.path.join(self.sb.art, "sub")
        third = self.source("c.png", png_bytes(80, 80, (3, 3, 3)), folder=sub)
        elsewhere = os.path.join(self.sb.home, "Documents", "Elsewhere")
        os.makedirs(elsewhere)
        counter = [0]

        def build(path, *roots, preview=True):
            counter[0] += 1
            description = {"name": "r%d-v1" % counter[0], "pictures": [{"role": "identity", "source": path}]}
            flags = [part for root in roots for part in ("--ref-root", root)]
            return self.build(description, *flags, preview=preview)
        refused = "is not in a folder desk-art may send from"
        # (a) no --ref-root: both standard folders work
        self.assertEqual(build(first).code, 0)
        self.assertEqual(build(second).code, 0)
        # (b) --ref-root narrows to one standard folder
        self.assertEqual(build(first, self.sb.art).code, 0)
        self.assert_refused(build(second, self.sb.art), refused)
        # (c) a sub-folder narrows further
        self.assertEqual(build(third, sub).code, 0)
        self.assert_refused(build(first, sub), refused)
        # (d) a folder outside the standard ones is ignored, and the standard folders are NOT a fallback
        self.assert_refused(build(first, elsewhere), refused)
        shown = self.build(self.figure("shown-v1", source=first), preview=False)
        self.assertEqual(shown.code, 0, shown.out)
        listed = self.run_script(["show", "shown-v1", "--inbox", self.sb.inbox, "--ref-root", elsewhere])
        self.assertEqual(listed.code, 0, listed.out)
        self.assertEqual(listed.data["ignoredRoots"], [elsewhere])
        # (e) one that counts and one that is ignored: the counted one works
        both = build(first, self.sb.art, elsewhere)
        self.assertEqual(both.code, 0, both.out)
        self.assertEqual(both.data["ignoredRoots"], [elsewhere])
        # (f) the cache folder is skipped without a word
        cache = self.sb.cache
        quiet = build(first, self.sb.art, cache)
        self.assertEqual(quiet.code, 0, quiet.out)
        self.assertNotIn("ignoredRoots", quiet.data)
        # (g) a malformed folder is a refusal
        self.assert_refused(build(first, "relative/path"), "--ref-root must be a folder path")
        # (h) the inbox and the cache stay allowed in every case: a preview picture (in the cache) as a source
        made = self.build(self.figure("cache-v1", source=first), preview=True)
        in_cache = made.data["pictures"][0]["preview"]
        pair = {"name": "cached-v1", "owner_said": "yes, use it", "pictures": [
            {"role": "identity", "source": third}, {"role": "style", "source": in_cache}]}
        result = self.build(pair, "--ref-root", sub, preview=True)
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual([item["provenance"] for item in result.data["pictures"]], ["owner", "generated"])
        # (i) show obeys the same narrowing for its look at the original: it is "missing" and never read
        wide = self.run_script(["show", "shown-v1", "--inbox", self.sb.inbox])
        self.assertEqual(wide.data["pictures"][0]["sourceState"], "same")
        narrow = self.run_script(["show", "shown-v1", "--inbox", self.sb.inbox, "--ref-root", sub])
        self.assertEqual(narrow.code, 0, narrow.out)
        self.assertEqual(narrow.data["pictures"][0]["sourceState"], "missing")
        self.assert_note_says(narrow.data["pictures"][0]["sourceNote"], "source of picture 1 %s " % first, refused)
        self.assertTrue(narrow.data["matches"])
        # (j) a --ref-root equal to the inbox counts and is not reported as ignored
        same = self.run_script(["show", "shown-v1", "--inbox", self.sb.inbox, "--ref-root", self.sb.inbox])
        self.assertNotIn("ignoredRoots", same.data)
        self.assertEqual(same.data["pictures"][0]["sourceState"], "missing")
        # at most 20 folders may be named
        many = [part for number in range(21) for part in ("--ref-root", os.path.join(sub, "f%d" % number))]
        self.assert_refused(self.run_script(["show", "shown-v1", "--inbox", self.sb.inbox] + many),
                            "at most 20 --ref-root folders")
        # a --ref-root is also checked by `show` for its shape
        self.assert_refused(self.run_script(["show", "shown-v1", "--inbox", self.sb.inbox, "--ref-root", "no"]),
                            "--ref-root must be a folder path")

    def test_a_ref_root_in_another_case_is_ignored_and_never_counted(self):
        """--ref-root can only narrow. A folder counts only when it is one of the allowed folders in its exact
        spelling (on a disk that tells upper and lower case apart another spelling is another folder, and counting it
        would widen what may be read)."""
        desktop = os.path.dirname(self.sb.art)
        path = self.source("a.png", png_bytes(80, 80, (1, 1, 1)))
        loud = self.needs_a_disk_that_ignores_case(desktop, os.path.basename(self.sb.art))
        odd_root = os.path.join(desktop, loud)
        odd_path = os.path.join(odd_root, "a.png")
        description = {"name": "odd-v1", "pictures": [{"role": "identity", "source": odd_path}]}
        refused = self.build(description, "--ref-root", odd_root, preview=True)
        self.assert_refused(refused, "is not in a folder desk-art may send from")
        shown = self.build(self.figure("shown-v1", source=path))
        self.assertEqual(shown.code, 0, shown.out)
        listed = self.run_script(["show", "shown-v1", "--inbox", self.sb.inbox, "--ref-root", odd_root])
        self.assertEqual(listed.code, 0, listed.out)
        self.assertEqual(listed.data["ignoredRoots"], [odd_root])
        self.assertEqual(listed.data["pictures"][0]["sourceState"], "missing")      # nothing was counted, nothing read


# ---------------------------------------------------------------------------
# build --preview
# ---------------------------------------------------------------------------

@needs_pillow_python
class PreviewTests(ScriptCase):
    def test_build_preview_makes_no_set(self):
        looks = os.path.join(self.sb.cache, "anchor-looks")
        for description in (self.figure("pv-v1"), self.close_up("pv-v2")):
            name = description["name"]
            result = self.build(description, preview=True)
            self.assertEqual(result.code, 0, result.out)
            data = result.data
            self.assertIs(data["preview"], True)
            self.assertNotIn("dir", data)
            self.assertEqual(data["inbox"], self.sb.inbox)
            self.assertEqual(data["next"], PREVIEW_NEXT)
            self.assertEqual(list(data)[:4], ["ok", "command", "preview", "set"])
            for number, picture in enumerate(data["pictures"], start=1):
                self.assertNotIn("path", picture)
                path = picture["preview"]
                self.assertEqual(os.path.dirname(path), looks)
                self.assertRegex(os.path.basename(path),
                                 r"^%s-preview%d-[0-9]{8}T[0-9]{6}-[0-9a-f]{4}\.png$" % (name, number))
                self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
                self.assertTrue(read_bytes(path).startswith(PNG_SIGNATURE))
                self.assertEqual(sha_of(read_bytes(path)), picture["sha256"])
                self.assertEqual(picture["bytes"], len(read_bytes(path)))
            self.assertFalse(os.path.exists(os.path.join(self.sb.inbox, "anchors")))
            self.assertFalse(os.path.exists(self.sb.inbox))                   # not even a missing inbox is made
        # the block of a preview is the block of the saved set: the words do not change between the two
        description = self.close_up("pv-v3")
        preview = self.build(description, preview=True)
        real = self.build(description)
        self.assertEqual(real.code, 0, real.out)
        self.assertEqual(preview.data["block"], real.data["block"])
        # ... and the stored pictures are the preview pictures, byte for byte
        self.assertEqual([item["sha256"] for item in preview.data["pictures"]],
                         [sha_of(read_bytes(item["path"])) for item in real.data["pictures"]])
        self.assertEqual([item["sha256"] for item in preview.data["pictures"]],
                         [item["sha256"] for item in real.data["pictures"]])
        self.assertEqual([item["prep"] for item in preview.data["pictures"]],
                         [item["prep"] for item in real.data["pictures"]])
        # a name that is used is refused by a preview too, and two previews do not replace each other
        self.assert_refused(self.build(description, preview=True), "already exists", code="set-exists")
        again = self.build(self.figure("pv-v4"), preview=True)
        twice = self.build(self.figure("pv-v4"), preview=True)
        paths = {item["preview"] for run in (again, twice) for item in run.data["pictures"]}
        self.assertEqual(len(paths), 2)
        self.assertTrue(all(os.path.exists(path) for path in paths))

    def test_a_preview_refuses_what_the_real_build_refuses(self):
        room = self.source("room.png", png_bytes(400, 300, (4, 5, 6)))
        transparent = self.source("t.png", png_rgba(80, 80, lambda x, y: (1, 2, 3, 0 if x < 5 else 255)))
        rows = [
            ("a restricted word in the keep line", {"name": "p-v1", "keep": "a bikini", "pictures": [
                {"role": "identity", "source": room}]}, "scope rule"),
            ("a transparent source without a key", {"name": "p-v2", "pictures": [
                {"role": "identity", "source": transparent}]}, "transparent"),
            ("a place that is not 16:9", {"name": "p-v3", "pictures": [
                {"role": "place", "source": room, "crop": [0, 0, 300, 300]}]}, "16:9")]
        for label, description, fragment in rows:
            with self.subTest(label):
                preview = self.build(description, preview=True)
                real = self.build(description)
                self.assert_refused(preview, fragment)
                self.assertEqual(preview.data, real.data)                   # the very same refusal
        self.assertFalse(os.path.exists(os.path.join(self.sb.cache, "anchor-looks")))


# ---------------------------------------------------------------------------
# list, show and words (they need no Pillow, so they run on the system Python)
# ---------------------------------------------------------------------------

def plain_python_has_pillow():
    done = subprocess.run([PLAIN_PYTHON, "-I", "-B", "-c", "import PIL"], stdin=subprocess.DEVNULL,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return done.returncode == 0


class ReadOnlyCommandTests(ScriptCase):
    def two_pictures(self, name, first="place", second="room"):
        return write_set(self.sb, name, [{"role": first, "png": png_bytes(96, 54, (10, 20, 30))},
                                         {"role": second, "png": png_bytes(96, 54, (30, 20, 10))}],
                         keep="red vending machine at the right")

    @needs_pillow_python
    def test_list_show_words(self):
        figure, closeup = self.figure("fig-v1"), self.close_up("closeup-v1")
        self.assertEqual(self.build(figure).code, 0)
        self.assertEqual(self.build(closeup).code, 0)
        three = self.close_up("three-v1")
        three["pictures"].append({"role": "style", "source": self.source("style.png", png_bytes(70, 70, (8, 8, 8)))})
        self.assertEqual(self.build(three).code, 0)
        listed = self.run_script(["list", "--inbox", self.sb.inbox])
        self.assertEqual(listed.code, 0, listed.out)
        self.assertEqual(list(listed.data), ["ok", "command", "inbox", "count", "sets"])
        self.assertEqual([item["name"] for item in listed.data["sets"]], ["closeup-v1", "fig-v1", "three-v1"])
        self.assertEqual(listed.data["count"], 3)
        entry = listed.data["sets"][0]
        card = self.card_of("closeup-v1")
        self.assertEqual(entry, {
            "name": "closeup-v1", "state": "ready", "made": card["made"],
            "pictures": [{"n": 1, "role": "place", "size": [320, 180]}, {"n": 2, "role": "room", "size": [320, 180]}],
            "keep": "red vending machine at the right", "provenance": ["owner"]})
        self.assertEqual(list(entry), ["name", "state", "made", "pictures", "keep", "provenance"])
        # show
        shown = self.run_script(["show", "--inbox", self.sb.inbox, "closeup-v1"])
        self.assertEqual(shown.code, 0, shown.out)
        data = shown.data
        folder = self.set_folder("closeup-v1")
        self.assertEqual(list(data), ["ok", "command", "set", "dir", "made", "keep", "note", "ownerSaid", "matches",
                                      "cardSha256", "sourcesChanged", "pictures", "wordsVersion", "block", "uploads",
                                      "text"])
        self.assertEqual((data["set"], data["dir"], data["matches"], data["sourcesChanged"]),
                         ("closeup-v1", folder, True, False))
        self.assertEqual(data["cardSha256"], sha_of(read_bytes(os.path.join(folder, "anchor.json"))))
        anchor = desk_art.load_anchor(self.sb.inbox, "closeup-v1")
        self.assertEqual(data["block"], desk_art.anchor_block(anchor, 0))
        self.assertEqual((data["uploads"], data["wordsVersion"], data["note"], data["ownerSaid"]),
                         (UPLOADS, "1", None, None))
        self.assertTrue(data["text"].strip())
        self.assertNotIn("sha", data["text"].lower())                            # plain words for the owner
        self.assertEqual(list(data["pictures"][0]), ["n", "role", "file", "path", "size", "bytes", "sha8", "matches",
                                                       "provenance", "source", "sourceState"])
        for number, picture in enumerate(data["pictures"], start=1):
            member = card["members"][number - 1]
            self.assertEqual((picture["n"], picture["role"], picture["file"]), (number, member["role"], member["file"]))
            self.assertEqual((picture["sha8"], picture["matches"], picture["sourceState"], picture["provenance"]),
                             (member["sha256"][:8], True, "same", "owner"))
            self.assertEqual(picture["source"], member["source"]["path"])
            self.assertEqual(picture["bytes"], os.path.getsize(os.path.join(folder, member["file"])))
            self.assertTrue(os.path.isabs(picture["path"]) and os.path.exists(picture["path"]))
        # words
        request = "The same view, 16:9. No people, no animals, no text."
        words = self.run_script(["words", "--inbox", self.sb.inbox, "closeup-v1", "--extra", "1", "--prompt-stdin"],
                                stdin=request)
        self.assertEqual(words.code, 0, words.out)
        self.assertEqual(list(words.data), ["ok", "command", "set", "refs", "extra", "wordsVersion", "wordsSha256",
                                            "block", "prompt", "promptChars"])
        self.assertEqual(words.data["refs"], [member.path for member in anchor.members])
        self.assertTrue(all(os.path.isabs(path) and os.path.isfile(path) for path in words.data["refs"]))
        self.assertEqual(words.data["prompt"], desk_art.anchor_request(anchor, 1, request))
        self.assertEqual(words.data["promptChars"], len(words.data["prompt"]))
        self.assertEqual(words.data["block"], desk_art.anchor_block(anchor, 1))
        self.assertEqual(words.data["wordsSha256"], desk_art.sha256_text(desk_art.anchor_block(anchor, 1)))
        plain = self.run_script(["words", "--inbox", self.sb.inbox, "closeup-v1"])
        self.assertNotIn("prompt", plain.data)
        self.assertNotIn("promptChars", plain.data)
        self.assertEqual(plain.data["extra"], 0)
        # the call limit: a set of three pictures and at most three more
        self.assertEqual(self.run_script(["words", "--inbox", self.sb.inbox, "three-v1", "--extra", "3"]).code, 0)
        for extra in ("4", "5"):
            result = self.run_script(["words", "--inbox", self.sb.inbox, "three-v1", "--extra", extra])
            self.assert_refused(result, "at most 3 more")
        for extra in ("6", "-1", "x", "1.5", "", "00000"):
            with self.subTest(extra):
                result = self.run_script(["words", "--inbox", self.sb.inbox, "closeup-v1", "--extra", extra])
                self.assert_refused(result, "extra must be a whole number from 0 to 5")
        # a request that makes the whole prompt longer than 8000 characters
        long_request = "x" * 7800
        result = self.run_script(["words", "--inbox", self.sb.inbox, "closeup-v1", "--prompt-stdin"],
                                 stdin=long_request)
        self.assert_refused(result, "longer than 8000 characters")
        result = self.run_script(["words", "--inbox", self.sb.inbox, "closeup-v1", "--prompt-stdin"], stdin="")
        self.assert_refused(result, "prompt is empty")
        # a changed picture: show and words both stop, naming the picture
        changed = os.path.join(folder, "02_room.png")
        os.chmod(changed, 0o600)
        with open(changed, "r+b") as handle:
            handle.seek(-20, os.SEEK_END)
            handle.write(b"changed!!!")
        for command in (["show"], ["words"]):
            result = self.run_script(command + ["--inbox", self.sb.inbox, "closeup-v1"])
            self.assert_refused(result, "picture 2 (room) is not the picture that was saved", code="set-damaged")
            self.assertIn("Do not use this set; save a new version.", result.data["error"])
            self.assertNotIn("Nothing was sent", result.data["error"])
            self.assertEqual([item["matches"] for item in result.data["pictures"]], [True, False])
            self.assertIn("foundSha8", result.data["pictures"][1])
        # and the other sets are still fine
        self.assertEqual(self.run_script(["show", "--inbox", self.sb.inbox, "fig-v1"]).code, 0)
        listed = self.run_script(["list", "--inbox", self.sb.inbox])
        self.assertEqual(listed.data["sets"][0]["state"], "ready")           # list never hashes pictures

    def test_read_only_commands_run_on_the_system_python(self):
        self.two_pictures("closeup-v1")
        python = self.run_script(["python"])
        if python.data["ok"]:
            self.assertEqual(list(python.data), ["ok", "command", "python"])
            self.assertTrue(os.path.isfile(python.data["python"]) and os.access(python.data["python"], os.X_OK))
        else:
            self.assertEqual((python.code, python.data["code"]), (2, "needs-pillow"))
        for command in (["list", "--inbox", self.sb.inbox], ["show", "--inbox", self.sb.inbox, "closeup-v1"],
                        ["words", "--inbox", self.sb.inbox, "closeup-v1", "--extra", "2"]):
            with self.subTest(command[0]):
                result = self.run_script(command)
                self.assertEqual(result.code, 0, result.out)
        if plain_python_has_pillow():
            self.skipTest("the system Python has Pillow here, so build does not need ComfyUI's Python")
        description = json.dumps(self.figure("fig-v1"))
        for flags in ([], ["--preview"]):
            result = self.run_script(["build"] + flags + ["--inbox", self.sb.inbox], stdin=description)
            self.assertEqual((result.code, result.data["code"]), (2, "needs-pillow"), result.out)
            self.assertIn("ComfyUI", result.data["error"])
            self.assertNotIn("hint", result.data)
        self.assertFalse(os.path.exists(self.set_folder("fig-v1")))

    def test_read_only_commands_change_nothing(self):
        self.two_pictures("closeup-v1")
        write_set(self.sb, "half-v1", [{"role": "identity", "png": png_bytes(80, 80)}],
                  card_edit=lambda card: b"{")
        os.remove(os.path.join(self.set_folder("half-v1"), "anchor.json"))
        before = tree_snapshot(self.sb.root)
        for command in (["python"], ["list", "--inbox", self.sb.inbox],
                        ["show", "--inbox", self.sb.inbox, "closeup-v1"],
                        ["words", "--inbox", self.sb.inbox, "closeup-v1", "--extra", "1", "--prompt-stdin"],
                        ["show", "--inbox", self.sb.inbox, "nothing-v1"], ["list", "--inbox", self.sb.inbox]):
            self.run_script(command, stdin="A request.")
        self.assertEqual(tree_snapshot(self.sb.root), before)

    def test_the_list_says_what_each_folder_is(self):
        self.two_pictures("good-v1")
        write_set(self.sb, "half-v1", [{"role": "identity", "png": png_bytes(80, 80)}])
        os.remove(os.path.join(self.set_folder("half-v1"), "anchor.json"))
        write_set(self.sb, "odd-v1", [{"role": "identity", "png": png_bytes(80, 80)}],
                  card_edit=lambda card: card.update(extra=1))
        write_set(self.sb, "gone-v1", [{"role": "identity", "png": png_bytes(80, 80)}])
        os.remove(os.path.join(self.set_folder("gone-v1"), "01_identity.png"))
        write_set(self.sb, "linked-v1", [{"role": "identity", "png": png_bytes(80, 80)}])
        card = os.path.join(self.set_folder("linked-v1"), "anchor.json")
        os.rename(card, card + ".real")
        os.symlink(card + ".real", card)
        os.makedirs(os.path.join(self.set_folder("Not A Label")))                # skipped: not a label
        os.symlink(self.set_folder("good-v1"), os.path.join(self.sb.inbox, "anchors", "alias-v1"))   # skipped: a link
        with open(os.path.join(self.sb.inbox, "anchors", "afile-v1"), "wb"):
            pass                                                                 # skipped: not a folder
        listed = self.run_script(["list", "--inbox", self.sb.inbox])
        states = {item["name"]: item for item in listed.data["sets"]}
        self.assertEqual(sorted(states), ["gone-v1", "good-v1", "half-v1", "linked-v1", "odd-v1"])
        self.assertEqual(listed.data["count"], 5)
        self.assertEqual(states["good-v1"]["state"], "ready")
        self.assertEqual((states["half-v1"]["state"], states["half-v1"]["problem"]), ("unfinished", "no anchor.json"))
        self.assertEqual((states["odd-v1"]["state"], states["odd-v1"]["problem"]),
                         ("damaged", "it has a part desk-art does not know (extra)"))
        self.assertEqual((states["linked-v1"]["state"], states["linked-v1"]["problem"]),
                         ("damaged", "anchor.json is a link"))
        self.assertEqual(states["gone-v1"]["state"], "damaged")
        self.assertIn("picture 1 (identity) is missing", states["gone-v1"]["problem"])
        # a damaged or cardless set is refused by show and words with the codes of the contract
        for name, code in (("half-v1", "set-damaged"), ("odd-v1", "set-damaged"), ("gone-v1", "set-damaged"),
                           ("nothing-v1", "set-not-found")):
            for command in ("show", "words"):
                with self.subTest(name + " " + command):
                    result = self.run_script([command, "--inbox", self.sb.inbox, name])
                    self.assertEqual((result.code, result.data["code"]), (2, code), result.out)
                    self.assertNotIn("Nothing was sent", result.data["error"])
        result = self.run_script(["show", "--inbox", self.sb.inbox, "linked-v1"])
        self.assertEqual((result.code, result.data["code"]), (2, "inbox-unsafe"))
        missing = self.run_script(["show", "--inbox", self.sb.inbox, "nothing-v1"])
        self.assertIn("anchor set nothing-v1 was not found in %s" % os.path.join(self.sb.inbox, "anchors"),
                      missing.data["error"])
        self.assertIn("Saved sets: ", missing.data["hint"])
        bad = self.run_script(["show", "--inbox", self.sb.inbox, "Bad Name"])
        self.assertEqual((bad.code, bad.data["code"]), (2, "bad-input"))
        self.assertIn("anchor must be the name of a saved anchor set", bad.data["error"])

    def test_a_card_without_sizes_and_the_words_limits(self):
        write_set(self.sb, "nosize-v1", [{"role": "identity", "png": b"this is not a picture, only bytes"}])
        shown = self.run_script(["show", "--inbox", self.sb.inbox, "nosize-v1"])
        self.assertEqual(shown.code, 0, shown.out)
        self.assertIsNone(shown.data["pictures"][0]["size"])
        self.assertIn("size not recorded", shown.data["text"])
        listed = self.run_script(["list", "--inbox", self.sb.inbox])
        self.assertEqual(listed.data["sets"][0]["pictures"], [{"n": 1, "role": "identity", "size": None}])
        # one picture and five more is six in all: allowed; the words say which pictures are extra
        words = self.run_script(["words", "--inbox", self.sb.inbox, "nosize-v1", "--extra", "5"])
        self.assertEqual(words.code, 0, words.out)
        self.assertTrue(words.data["block"].endswith(
            "Pictures 2 to 6 are extra: the request below says how to use them."))
        # a request of more than 8000 characters (or bytes that are not text) is refused
        for label, stdin, fragment in (("too long", b"x" * 40000, "longer than 8000 characters"),
                                       ("not text", b"\xff\xfe\xfd", "not valid UTF-8"),
                                       ("a NUL", b"a\x00b", "NUL")):
            with self.subTest(label):
                result = self.run_script(["words", "--inbox", self.sb.inbox, "nosize-v1", "--prompt-stdin"],
                                         stdin=stdin)
                self.assert_refused(result, fragment)

    def test_a_missing_set_names_the_saved_ones(self):
        missing = self.run_script(["show", "--inbox", self.sb.inbox, "nothing-v1"])
        anchors = os.path.join(self.sb.inbox, "anchors")
        self.assert_refused(missing, "anchor set nothing-v1 was not found in %s" % anchors, code="set-not-found")
        self.assertEqual(missing.data["hint"], "No anchor sets are saved yet. Save one with the desk-art:anchor skill.")
        for name in ("b-v1", "a-v1"):
            write_set(self.sb, name, [{"role": "identity", "png": png_bytes(64, 64)}])
        missing = self.run_script(["words", "--inbox", self.sb.inbox, "nothing-v1"])
        self.assertEqual(missing.data["hint"], "Saved sets: a-v1, b-v1.")
        for number in range(10):
            write_set(self.sb, "c%02d-v1" % number, [{"role": "identity", "png": png_bytes(64, 64)}])
        missing = self.run_script(["show", "--inbox", self.sb.inbox, "nothing-v1"])
        self.assertEqual(missing.data["hint"], "Saved sets: a-v1, b-v1, c00-v1, c01-v1, c02-v1, c03-v1, c04-v1, "
                                               "c05-v1, c06-v1, c07-v1 and 2 more.")

    def test_the_list_names_at_most_100_sets(self):
        for number in range(100):
            write_set(self.sb, "set%03d-v1" % number, [{"role": "identity", "png": png_bytes(64, 64)}])
        listed = self.run_script(["list", "--inbox", self.sb.inbox])
        self.assertEqual(listed.code, 0, listed.out)
        self.assertEqual(list(listed.data), ["ok", "command", "inbox", "count", "sets"])      # 100 fit: nothing is cut
        for number in range(100, 105):
            write_set(self.sb, "set%03d-v1" % number, [{"role": "identity", "png": png_bytes(64, 64)}])
        listed = self.run_script(["list", "--inbox", self.sb.inbox])
        self.assertEqual(listed.code, 0, listed.out)
        names = [item["name"] for item in listed.data["sets"]]
        self.assertEqual((listed.data["count"], len(names)), (100, 100))
        self.assertEqual(names, sorted(names))
        self.assertEqual(names[0], "set000-v1")
        self.assertEqual(names[-1], "set099-v1")
        # the five that were left out are counted, so the number of sets shown is not mistaken for the total
        self.assertEqual(list(listed.data), ["ok", "command", "inbox", "count", "sets", "more", "note"])
        self.assertEqual(listed.data["more"], 5)
        self.assertEqual(listed.data["note"], "Only the first 100 sets (by name) are listed; 5 more are saved. Use "
                                              "show with a name to look at one of them.")
        # the hint of a missing set cannot count past 100 either, and says so
        missing = self.run_script(["show", "--inbox", self.sb.inbox, "nothing-v1"])
        self.assertEqual(missing.data["hint"], "Saved sets: " + ", ".join("set%03d-v1" % number for number in range(10))
                         + " and at least 90 more.")

    def test_a_linked_anchors_folder_is_never_called_empty(self):
        """list said the anchors folder is a link; show and words must say it too, for any name they are given."""
        write_set(self.sb, "good-v1", [{"role": "identity", "png": png_bytes(80, 80)}])
        anchors = os.path.join(self.sb.inbox, "anchors")
        moved = os.path.join(self.sb.root, "moved-anchors")
        os.rename(anchors, moved)
        os.symlink(moved, anchors)
        for label in ("a link to a folder that holds sets", "a link that leads nowhere"):
            if label == "a link that leads nowhere":
                os.rename(moved, moved + ".gone")
            for argv in (["list"], ["show", "good-v1"], ["show", "nothere-v1"], ["words", "good-v1"],
                         ["words", "nothere-v1"]):
                with self.subTest("%s: %s" % (label, " ".join(argv))):
                    result = self.run_script(argv[:1] + ["--inbox", self.sb.inbox] + argv[1:])
                    self.assertEqual((result.code, result.data.get("code")), (2, "inbox-unsafe"), result.out)
                    self.assertIn("the anchors folder %s is a link that leads elsewhere" % anchors,
                                  result.data["error"])
                    self.assertEqual(result.data["hint"], "delete or rename that link, then try again")
                    self.assertNotIn("No anchor sets are saved yet", result.out)
        # a name that is not a name stays a bad value, whatever the folder is
        bad = self.run_script(["show", "--inbox", self.sb.inbox, "Bad Name"])
        self.assertEqual((bad.code, bad.data["code"]), (2, "bad-input"))

    def test_a_source_path_the_system_cannot_name_is_a_missing_original(self):
        """A character no file name can hold (a lone surrogate, which a hand-made card can carry) is a missing
        original, not a crash."""
        stored = png_bytes(80, 80, (31, 91, 161))
        odd = os.path.join(self.sb.art, "a" + chr(0xD800) + "b.png")
        write_set(self.sb, "odd-v1", [{"role": "identity", "png": stored, "source": {"path": odd, "sha256": "0" * 64}}])
        listed = self.run_script(["list", "--inbox", self.sb.inbox])
        self.assertEqual(listed.data["sets"][0]["state"], "ready")
        result = self.run_script(["show", "--inbox", self.sb.inbox, "odd-v1"])           # also proves stderr is empty
        self.assertEqual(result.code, 0, result.out)
        picture = result.data["pictures"][0]
        self.assertEqual((picture["sourceState"], result.data["sourcesChanged"], result.data["matches"]),
                         ("missing", False, True))
        self.assertIn("source of picture 1", picture["sourceNote"])
        self.assertIn("missing or cannot be read", result.data["text"])

    def test_show_reports_whether_the_original_changed(self):
        original = png_bytes(80, 80, (30, 90, 160))
        path = self.source("fig.png", original)
        stored = png_bytes(80, 80, (31, 91, 161))
        record = {"path": path, "sha256": sha_of(original)}
        write_set(self.sb, "fig-v1", [{"role": "identity", "png": stored, "source": record, "prep": ""}], keep="blue")
        write_set(self.sb, "bare-v1", [{"role": "identity", "png": stored}])
        before_set = tree_snapshot(self.set_folder("fig-v1"))

        def show(name="fig-v1"):
            result = self.run_script(["show", "--inbox", self.sb.inbox, name])
            self.assertEqual(result.code, 0, result.out)
            return result.data
        data = show()
        self.assertEqual((data["pictures"][0]["sourceState"], data["sourcesChanged"]), ("same", False))
        self.assertNotIn("sourceNote", data["pictures"][0])
        # the original is redrawn: the set still matches (it holds its own copy) and says so
        redrawn = png_bytes(80, 80, (200, 50, 50))
        self.sb.write_file(path, redrawn)
        data = show()
        self.assertTrue(data["matches"])
        self.assertEqual((data["pictures"][0]["sourceState"], data["sourcesChanged"]), ("changed", True))
        self.assertIn("changed after this set was made", data["pictures"][0]["sourceNote"])
        self.assertIn("fig.png", data["text"])
        self.assertIn("was changed after this set was made", data["text"])
        # the original is gone
        os.remove(path)
        data = show()
        self.assertEqual((data["pictures"][0]["sourceState"], data["sourcesChanged"]), ("missing", False))
        self.assert_note_says(data["pictures"][0]["sourceNote"], "source of picture 1 %s " % path, "was not found")
        self.assertLessEqual(len(data["pictures"][0]["sourceNote"]), 200)
        self.assertIn("missing or cannot be read", data["text"])
        # a set whose card has no source record
        data = show("bare-v1")
        self.assertEqual(data["pictures"][0]["sourceState"], "unknown")
        self.assertIsNone(data["pictures"][0]["source"])
        # a card that points at a restricted place is "missing" and the place is never looked at
        restricted = os.path.join(self.sb.art, "Swimwear outfits", "x.png")
        write_set(self.sb, "odd-v1", [{"role": "identity", "png": stored, "source": {
            "path": restricted, "sha256": "0" * 64}}])
        data = show("odd-v1")
        self.assertEqual(data["pictures"][0]["sourceState"], "missing")
        self.assert_note_says(data["pictures"][0]["sourceNote"], 'the path %s mentions "swim". The ' % restricted,
                              "scope rule")
        self.assertEqual(tree_snapshot(self.set_folder("fig-v1")), before_set)       # the set itself is never touched


# ---------------------------------------------------------------------------
# build changes only what it should
# ---------------------------------------------------------------------------

@needs_pillow_python
class WriteScopeTests(ScriptCase):
    def test_nothing_is_changed_or_deleted(self):
        preview_description = self.close_up("pv-v1")
        real_description = self.close_up("real-v1")
        fresh_description = self.figure("fresh-v1")
        fresh_inbox = os.path.join(self.sb.home, "Desktop", "fresh inbox")
        self.make_inbox()
        # a preview: the only new paths are the files directly inside <cache>/anchor-looks/, that folder and the
        # parent folders of the cache path that did not exist yet
        before = tree_snapshot(self.sb.root)
        preview = self.build(preview_description, preview=True)
        self.assertEqual(preview.code, 0, preview.out)
        after = tree_snapshot(self.sb.root)
        looks = os.path.join(os.path.relpath(self.sb.cache, self.sb.root), "anchor-looks")
        parts = looks.split(os.sep)
        folders = {os.sep.join(parts[:count]) for count in range(1, len(parts) + 1)}
        new = set(after) - set(before)
        self.assertTrue(new)
        for path in new:
            self.assertTrue(path in folders or os.path.dirname(path) == looks, path)
        self.assertEqual(sum(os.path.dirname(path) == looks for path in new), 2)
        self.assertTrue(all(after[path] == before[path] for path in before))
        self.assertFalse(os.path.exists(os.path.join(self.sb.inbox, "anchors")))
        # a build: the only new paths are anchors/ and what is inside it
        before = after
        result = self.build(real_description)
        self.assertEqual(result.code, 0, result.out)
        after = tree_snapshot(self.sb.root)
        anchors = os.path.relpath(os.path.join(self.sb.inbox, "anchors"), self.sb.root)
        new = set(after) - set(before)
        self.assertEqual(len(new), 5)                          # anchors/, the set folder, two pictures and the card
        for path in new:
            self.assertTrue(path == anchors or path.startswith(anchors + os.sep), path)
        self.assertTrue(all(after[path] == before[path] for path in before))
        # a build into an inbox that is missing makes the inbox and nothing else outside it
        before = after
        result = self.run_script(["build"], stdin=json.dumps(fresh_description), python=PIL_PYTHON,
                                 env={"DESK_ART_INBOX": fresh_inbox})
        self.assertEqual(result.code, 0, result.out)
        after = tree_snapshot(self.sb.root)
        fresh = os.path.relpath(fresh_inbox, self.sb.root)
        for path in set(after) - set(before):
            self.assertTrue(path == fresh or path.startswith(fresh + os.sep), path)
        self.assertTrue(all(after[path] == before[path] for path in before))

    def test_the_description_is_read_once_and_the_sources_are_only_read(self):
        description = self.close_up("once-v1")
        sources = {item["source"] for item in description["pictures"]}
        before = {path: (read_bytes(path), os.stat(path).st_mtime_ns) for path in sources}
        self.assertEqual(self.build(description).code, 0)
        self.assertEqual({path: (read_bytes(path), os.stat(path).st_mtime_ns) for path in sources}, before)


# ---------------------------------------------------------------------------
# Tests that load the script into this very process (they need Pillow here)
# ---------------------------------------------------------------------------

@needs_pillow_here
class InProcessTests(ScriptCase):
    def setUp(self):
        ScriptCase.setUp(self)
        self.module = load_script()

    def go(self, argv, stdin=None):
        if isinstance(stdin, (dict, list)):
            stdin = json.dumps(stdin)
        if isinstance(stdin, str):
            stdin = stdin.encode("utf-8")
        return self.run_inprocess(self.module, argv, stdin)

    def test_the_card_is_written_last_and_a_cardless_folder_is_ignored(self):
        description = self.close_up("half-v1")
        with mock.patch.object(self.module, "write_card", side_effect=OSError(28, "No space left on device")):
            code, result = self.go(["build", "--inbox", self.sb.inbox], description)
        self.assertEqual((code, result["code"]), (2, "set-damaged"), result)
        folder = self.set_folder("half-v1")
        self.assertIn("The folder %s was left without a finished card; it is ignored. Use the next version name."
                      % folder, result["error"])
        self.assertEqual(sorted(os.listdir(folder)), ["01_place.png", "02_room.png"])         # no card, no .part
        code, listed = self.go(["list", "--inbox", self.sb.inbox])
        self.assertEqual(listed["sets"], [{"name": "half-v1", "state": "unfinished", "problem": "no anchor.json"}])
        helper_says = self.cli("codex", "--label", "x", "--prompt-stdin", "--anchor", "half-v1", *self.root_args(),
                               stdin="A request.")
        self.assert_failure(helper_says, "bad-input")
        self.assertIn("anchor set half-v1 has no anchor.json, so it is not a finished set. Nothing was sent.",
                      helper_says.data["error"])
        code, again = self.go(["build", "--inbox", self.sb.inbox], description)
        self.assertEqual((code, again["code"]), (2, "set-exists"))
        self.assertEqual(sorted(os.listdir(folder)), ["01_place.png", "02_room.png"])

    def test_a_picture_that_cannot_be_written_leaves_no_card_either(self):
        real = self.module.get_helper().write_private_file
        calls = []

        def failing(path, data):
            calls.append(path)
            if len(calls) == 2:
                raise OSError(5, "Input/output error")
            return real(path, data)
        with mock.patch.object(self.module.get_helper(), "write_private_file", failing):
            code, result = self.go(["build", "--inbox", self.sb.inbox], self.close_up("io-v1"))
        self.assertEqual((code, result["code"]), (2, "set-damaged"), result)
        self.assertEqual(sorted(os.listdir(self.set_folder("io-v1"))), ["01_place.png"])
        self.assertFalse(os.path.exists(os.path.join(self.set_folder("io-v1"), "anchor.json")))

    def test_a_source_swapped_between_the_check_and_the_read_is_refused(self):
        original = png_bytes(80, 80, (30, 30, 30))
        source = self.source("swap.png", original)
        helper = self.module.get_helper()
        real_detect = helper.detect_format

        def swapping(swap):
            def detect(head):
                swap(source)                          # Rule S calls detect_format between the check and the read
                return real_detect(head)
            return detect
        description = {"name": "swap-v1", "pictures": [{"role": "identity", "source": source}]}
        with mock.patch.object(helper, "detect_format", swapping(replace_by_another_picture)):
            code, result = self.go(["build", "--inbox", self.sb.inbox], description)       # a new inode under the name
        self.assertEqual((code, result["code"]), (2, "bad-input"), result)
        self.assertIn("changed after it was checked", result["error"])
        self.assert_nothing_saved()
        newer = png_bytes(80, 80, (200, 100, 50))
        self.sb.write_file(source, original)
        description["name"] = "swap-v2"
        with mock.patch.object(helper, "detect_format", swapping(rewrite_in_place(newer))):
            code, result = self.go(["build", "--inbox", self.sb.inbox], description)       # the same inode, new bytes
        self.assertEqual(code, 0, result)
        card = self.card_of("swap-v2")
        self.assertEqual(card["members"][0]["source"]["sha256"], sha_of(newer))           # never of the old file
        pixels, _ = pixels_of(os.path.join(self.set_folder("swap-v2"), "01_identity.png"), (5, 5))
        self.assertEqual(pixels, [[200, 100, 50]])

    def test_run_cli_takes_its_input_from_stdin_bytes(self):
        trap = io.TextIOWrapper(io.BytesIO(b"THIS MUST NOT BE READ"))
        with mock.patch.object(sys, "stdin", trap):
            code, result = self.go(["build", "--inbox", self.sb.inbox], self.figure("cli-v1"))
            self.assertEqual(code, 0, result)
            code, words = self.go(["words", "--inbox", self.sb.inbox, "cli-v1", "--prompt-stdin"], b"The request.")
        self.assertEqual(code, 0, words)
        anchor = desk_art.load_anchor(self.sb.inbox, "cli-v1")
        self.assertEqual(words["prompt"], desk_art.anchor_request(anchor, 0, "The request."))
        self.assertEqual(trap.buffer.tell(), 0)
        # without stdin_bytes the real standard input is read; an empty one is an empty description
        with mock.patch.object(sys, "stdin", io.TextIOWrapper(io.BytesIO(b""))):
            code, result = self.go(["build", "--inbox", self.sb.inbox])
        self.assertEqual((code, result["code"]), (2, "bad-input"))
        self.assertIn("empty", result["error"])
        with mock.patch.object(sys, "stdin", io.TextIOWrapper(io.BytesIO(json.dumps(self.figure("cli-v2")).encode()))):
            code, result = self.go(["build", "--inbox", self.sb.inbox])
        self.assertEqual(code, 0, result)

    def test_a_name_collision_in_a_preview_is_retried_once_and_never_overwrites(self):
        helper = self.module.get_helper()
        real = helper.write_private_file
        calls = []

        def once(path, data):
            calls.append(path)
            if len(calls) == 1:
                raise FileExistsError(17, "File exists")
            return real(path, data)
        description = self.close_up("coll-v1")
        with mock.patch.object(helper, "write_private_file", once):
            code, result = self.go(["build", "--preview", "--inbox", self.sb.inbox], description)
        self.assertEqual(code, 0, result)
        self.assertEqual(len(calls), 3)                                    # the first name collided, then two pictures
        self.assertEqual(len(set(calls)), 3)
        looks = os.path.join(self.sb.cache, "anchor-looks")
        self.assertEqual(len(os.listdir(looks)), 2)

        def always(path, data):
            raise FileExistsError(17, "File exists")
        description["name"] = "coll-v2"
        with mock.patch.object(helper, "write_private_file", always):
            code, result = self.go(["build", "--preview", "--inbox", self.sb.inbox], description)
        self.assertEqual((code, result["code"]), (1, "internal"), result)
        self.assertEqual(len(os.listdir(looks)), 2)                        # nothing was written, nothing replaced

    def test_a_race_for_the_name_is_set_exists(self):
        description = self.figure("race-v1")
        os.makedirs(os.path.join(self.sb.inbox, "anchors"))                  # so that only the set folder is made
        with mock.patch.object(self.module.os, "mkdir", side_effect=FileExistsError(17, "File exists")):
            code, result = self.go(["build", "--inbox", self.sb.inbox], description)
        self.assertEqual((code, result["code"]), (2, "set-exists"), result)
        self.assertIn("already exists", result["error"])
        self.assertEqual(os.listdir(os.path.join(self.sb.inbox, "anchors")), [])

    def test_a_competitor_who_made_the_folder_first_wins(self):
        """The mkdir of the set folder is the real guard against two builders: when the other one has already made
        the folder, this build stops and writes nothing into it (a mkdir that accepts an existing folder would not)."""
        anchors = os.path.join(self.sb.inbox, "anchors")
        os.makedirs(anchors)
        target = os.path.join(anchors, "race-v2")
        real_mkdir = os.mkdir

        def competitor(path, *more):
            if path == target:
                real_mkdir(path, *more)                                      # the other builder got here a moment ago
                raise FileExistsError(17, "File exists", path)
            return real_mkdir(path, *more)
        with mock.patch.object(self.module.os, "mkdir", competitor):
            code, result = self.go(["build", "--inbox", self.sb.inbox], self.figure("race-v2"))
        self.assertEqual((code, result.get("code")), (2, "set-exists"), result)
        self.assertIn("already exists", result["error"])
        self.assertEqual(os.listdir(target), [])                             # the competitor's folder was left alone

    def test_the_card_arrives_by_rename_only(self):
        """The card is written whole under a .part name and then renamed, so a card that stops half way is never
        taken for a finished one: when the rename fails the folder has no anchor.json."""
        def failing(source, target):
            raise OSError(5, "Input/output error")
        with mock.patch.object(self.module.os, "rename", failing):
            code, result = self.go(["build", "--inbox", self.sb.inbox], self.close_up("part-v1"))
        self.assertEqual((code, result.get("code")), (2, "set-damaged"), result)
        folder = self.set_folder("part-v1")
        self.assertEqual(sorted(os.listdir(folder)), ["01_place.png", "02_room.png", "anchor.json.part"])
        card = desk_art.parse_anchor_card(read_bytes(os.path.join(folder, "anchor.json.part")), "part-v1")
        self.assertEqual([item["role"] for item in card["members"]], ["place", "room"])        # whole, but not final
        code, listed = self.go(["list", "--inbox", self.sb.inbox])
        self.assertEqual(listed["sets"], [{"name": "part-v1", "state": "unfinished", "problem": "no anchor.json"}])

    def test_a_short_write_is_caught_by_the_read_back(self):
        """Each picture is read back and compared with the bytes that were meant to be written."""
        helper = self.module.get_helper()
        real = helper.write_private_file

        def short(path, data):
            real(path, data[:-5])                                            # five bytes too few reach the disk
        with mock.patch.object(helper, "write_private_file", short):
            code, result = self.go(["build", "--inbox", self.sb.inbox], self.close_up("short-v1"))
        self.assertEqual((code, result.get("code")), (2, "set-damaged"), result)
        self.assertIn("01_place.png was not written as it should be", result["error"])
        self.assertIn("left without a finished card", result["error"])
        folder = self.set_folder("short-v1")
        self.assertEqual(os.listdir(folder), ["01_place.png"])               # it stopped at the first bad picture
        self.assertFalse(os.path.exists(os.path.join(folder, "anchor.json")))

    def test_an_unexpected_error_is_internal_with_exit_code_1(self):
        helper = self.module.get_helper()
        with mock.patch.object(helper, "anchor_scope_word", side_effect=RuntimeError("a bug")):
            with contextlib.redirect_stderr(io.StringIO()) as noise:
                code, result = self.go(["build", "--inbox", self.sb.inbox], self.figure("bug-v1"))
        self.assertEqual((code, result["ok"], result["code"]), (1, False, "internal"))
        self.assertIn("RuntimeError", result["error"])
        self.assertIn("a bug", noise.getvalue())                           # the trace goes to standard error
        self.assert_nothing_saved()

    def test_a_missing_or_old_helper_is_an_internal_error(self):
        wanted = "the desk-art helper next to this skill is missing or older than 0.2.0"
        missing = load_script()                                      # a fresh module: nothing cached yet
        with mock.patch.object(missing, "load_helper", side_effect=FileNotFoundError("gone")):
            code, result = self.run_inprocess(missing, ["list"])
        self.assertEqual((code, result["ok"], result["code"], result["error"]), (1, False, "internal", wanted))
        old = load_script()
        too_old = type(sys)("old_helper")                            # a module without ANCHOR_FORMAT
        with mock.patch.object(old, "load_helper", return_value=too_old):
            code, result = self.run_inprocess(old, ["list"])
        self.assertEqual((code, result["code"], result["error"]), (1, "internal", wanted))
        self.assertIsNone(old.HELPER)                                # a helper that failed is not kept


# ---------------------------------------------------------------------------
# The command line: usage, help, exit codes, which Python
# ---------------------------------------------------------------------------

class CommandLineTests(ScriptCase):
    def test_stdout_is_one_ascii_json_line_and_exit_codes_are_the_contract(self):
        usage = [["build", "extra"], ["python", "extra"], ["build", "--preview=1"], [], ["nosuchcommand"], ["show"],
                 ["words"], ["list", "extra"], ["python", "--inbox", "x"], ["build", "--bogus"],
                 ["words", "x-v1", "--extra"], ["show", "--ref-root"], ["list", "--ref-root", "/tmp"]]
        for argv in usage:
            with self.subTest(argv):
                result = self.run_script(argv)               # run_script checks one ASCII line and the exit code
                self.assertEqual((result.code, result.data["code"]), (3, "usage"), result.out)
                self.assertIn("usage", result.data)
                self.assertTrue(result.data["error"])
        for argv, command in ((["--help"], None), (["-h"], None), (["build", "--help"], "build"),
                              (["python", "-h"], "python"), (["list", "--help"], "list"), (["show", "-h"], "show"),
                              (["words", "--help"], "words")):
            with self.subTest(argv):
                result = self.run_script(argv)
                self.assertEqual(result.code, 0, result.out)
                self.assertEqual((result.data["ok"], result.data["command"]), (True, command))
                self.assertIn("usage", result.data["help"])
        self.assertEqual(list(self.run_script(["build", "--help"]).data), ["ok", "command", "help"])
        # a value that starts with a dash is a bad value, not a usage error (it is glued to its flag)
        for argv in (["words", "--inbox", self.sb.inbox, "x-v1", "--extra", "-1"],
                     ["show", "--inbox", self.sb.inbox, "x-v1", "--ref-root", "-x"],
                     ["show", "--inbox", "-x", "x-v1"], ["list", "--inbox", "-x"]):
            with self.subTest(argv):
                result = self.run_script(argv)
                self.assertEqual((result.code, result.data["code"] in ("bad-input", "inbox-unsafe")), (2, True),
                                 result.out)
        # a refusal is exit code 2; "internal" (1) is for bugs only
        result = self.run_script(["show", "--inbox", self.sb.inbox, "nothing-v1"])
        self.assertEqual((result.code, result.data["code"]), (2, "set-not-found"))
        self.assertNotEqual(result.data["code"], "internal")

    def test_a_failure_code_is_always_one_of_the_closed_list(self):
        closed = {"usage", "bad-input", "inbox-unsafe", "set-exists", "set-not-found", "set-damaged", "needs-pillow",
                  "internal"}
        self.two_sets()
        for argv in (["show", "--inbox", self.sb.inbox, "Bad Name"], ["show", "--inbox", self.sb.inbox, "nothing-v1"],
                     ["list", "--inbox", "/etc"], ["words", "--inbox", self.sb.inbox, "a-v1", "--extra", "9"],
                     ["show", "--inbox", self.sb.inbox, "damaged-v1"]):
            result = self.run_script(argv)
            self.assertFalse(result.data["ok"])
            self.assertIn(result.data["code"], closed)

    def two_sets(self):
        write_set(self.sb, "a-v1", [{"role": "identity", "png": png_bytes(80, 80)}])
        write_set(self.sb, "damaged-v1", [{"role": "identity", "png": png_bytes(80, 80)}], card_edit=lambda card: b"{")


class PythonCommandTests(ScriptCase):
    """`python` looks for ComfyUI's Python and runs nothing. The tests give it a made-up home with empty programs."""

    def setUp(self):
        ScriptCase.setUp(self)
        self.home = os.path.join(self.sb.root, "madeuphome")
        os.makedirs(self.home)

    def program(self, folder, name="python", mode=0o755):
        path = os.path.join(self.home, "ComfyUI-Installs", folder, "standalone-env", "bin", name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb"):
            pass
        os.chmod(path, mode)
        return path

    def python(self, **env):
        settings = {"HOME": self.home, "JJK_ART_PYTHON": "", "JJK_COMFY_ROOT": ""}
        settings.update(env)
        return self.run_script(["python"], env=settings)

    def test_python_command(self):
        # (a) two installs: the first in sorted order
        self.program("ComfyUI (2)")
        first = self.program("ComfyUI (1)")
        answer = self.python()
        self.assertEqual(answer.code, 0, answer.out)
        self.assertEqual(answer.data, {"ok": True, "command": "python", "python": first})
        # (b) a plain ComfyUI folder wins
        plain = self.program("ComfyUI")
        self.assertEqual(self.python().data["python"], plain)
        # (c) JJK_COMFY_ROOT names an install outright
        second_root = os.path.join(self.home, "ComfyUI-Installs", "ComfyUI (2)")
        self.assertEqual(self.python(JJK_COMFY_ROOT=second_root).data["python"],
                         os.path.join(second_root, "standalone-env", "bin", "python"))
        # (c2) a JJK_COMFY_ROOT that holds no program is not an answer: the search goes on
        empty_root = os.path.join(self.home, "not-an-install")
        os.makedirs(empty_root)
        self.assertEqual(self.python(JJK_COMFY_ROOT=empty_root).data["python"], plain)
        # (d) JJK_ART_PYTHON names a program: that one, whatever the tree holds
        mine = os.path.join(self.home, "my-python")
        with open(mine, "wb"):
            pass
        os.chmod(mine, 0o755)
        self.assertEqual(self.python(JJK_ART_PYTHON=mine).data["python"], mine)
        self.assertEqual(self.python(JJK_ART_PYTHON="~/my-python").data["python"], mine)
        # (e) JJK_ART_PYTHON names something that is not a program: a refusal that says so, with no fall-through
        not_a_program = os.path.join(self.home, "notes.txt")
        with open(not_a_program, "wb"):
            pass
        os.chmod(not_a_program, 0o644)
        refused = self.python(JJK_ART_PYTHON=not_a_program)
        self.assertEqual((refused.code, refused.data["code"]), (2, "needs-pillow"))
        self.assertIn("JJK_ART_PYTHON is set to %s, which is not a program" % not_a_program, refused.data["error"])
        self.assertIn("Nothing was installed. Ask the owner where ComfyUI is installed, or set JJK_ART_PYTHON to its "
                      "Python.", refused.data["error"])
        self.assertNotIn("Pillow", refused.data["error"])
        self.assertNotIn("hint", refused.data)

    def test_python_command_without_an_install(self):
        base = os.path.join(self.home, "ComfyUI-Installs")
        os.makedirs(base)
        # (f) an empty install folder
        result = self.python()
        self.assertEqual((result.code, result.data["code"]), (2, "needs-pillow"))
        self.assertIn("ComfyUI's Python was not found under %s" % base, result.data["error"])
        self.assertIn("Nothing was installed. Ask the owner where ComfyUI is installed, or set JJK_ART_PYTHON to its "
                      "Python.", result.data["error"])
        self.assertNotIn("Pillow", result.data["error"])
        # (g) an entry that starts with a dot is skipped
        self.program(".hidden")
        self.program("not a program", name="python3", mode=0o755)
        result = self.python()
        self.assertEqual((result.code, result.data["code"]), (2, "needs-pillow"))
        # a program that is not executable does not count
        self.program("ComfyUI (3)", mode=0o644)
        self.assertEqual(self.python().code, 2)
        # no install folder at all
        shutil_free_home = os.path.join(self.sb.root, "emptyhome")
        os.makedirs(shutil_free_home)
        result = self.run_script(["python"], env={"HOME": shutil_free_home, "JJK_ART_PYTHON": "", "JJK_COMFY_ROOT": ""})
        self.assertIn("was not found under %s" % os.path.join(shutil_free_home, "ComfyUI-Installs"),
                      result.data["error"])

    def test_python_command_changes_nothing_and_build_names_the_same_python(self):
        found = self.program("ComfyUI (1)")
        before = tree_snapshot(self.sb.root)
        answer = self.python()
        self.assertEqual(tree_snapshot(self.sb.root), before)
        if plain_python_has_pillow():
            self.skipTest("the system Python has Pillow here, so build does not need ComfyUI's Python")
        settings = {"HOME": self.home, "JJK_ART_PYTHON": "", "JJK_COMFY_ROOT": ""}
        for flags in ([], ["--preview"]):
            result = self.run_script(["build"] + flags + ["--inbox", self.sb.inbox], stdin="{}", env=settings)
            self.assertEqual((result.code, result.data["code"]), (2, "needs-pillow"), result.out)
            self.assertIn('Run it with ComfyUI\'s Python: "%s" -I -B %s build ...' % (answer.data["python"], SCRIPT),
                          result.data["error"])
            self.assertIn(found, result.data["error"])
        # when ComfyUI's Python cannot be found the build says so, and still mentions ComfyUI
        emptier = os.path.join(self.sb.root, "emptyhome")
        os.makedirs(emptier)
        result = self.run_script(["build"], stdin="{}", env={"HOME": emptier, "JJK_ART_PYTHON": "",
                                                              "JJK_COMFY_ROOT": ""})
        self.assertEqual((result.code, result.data["code"]), (2, "needs-pillow"))
        self.assertIn("ComfyUI's Python was not found", result.data["error"])
        self.assertIn("Nothing was installed.", result.data["error"])
        # the sentence is said once, and reads as one (the reason is not wrapped in brackets after a first telling)
        start = ("This command needs the picture tools that come with ComfyUI's Python, which this Python does not "
                 "have. ")
        end = " Nothing was installed. Ask the owner where ComfyUI is installed, or set JJK_ART_PYTHON to its Python."
        self.assertEqual(result.data["error"], start + "ComfyUI's Python was not found under %s." % os.path.join(
            emptier, "ComfyUI-Installs") + end)
        self.assertEqual(result.data["error"].count("ComfyUI's Python was not found"), 1)
        # the other reason reads the same way
        not_a_program = os.path.join(self.home, "notes.txt")
        with open(not_a_program, "wb"):
            pass
        os.chmod(not_a_program, 0o644)
        result = self.run_script(["build"], stdin="{}", env={"HOME": emptier, "JJK_ART_PYTHON": not_a_program,
                                                              "JJK_COMFY_ROOT": ""})
        self.assertEqual((result.code, result.data["code"]), (2, "needs-pillow"))
        self.assertEqual(result.data["error"], start + "JJK_ART_PYTHON is set to %s, which is not a program." %
                         not_a_program + end)


# ---------------------------------------------------------------------------
# Small functions of the script, called directly (they need no Pillow, so they also run on the system Python)
# ---------------------------------------------------------------------------

class FunctionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.module = load_script()

    def test_the_two_containment_tests(self):
        exact, loose = self.module.inside_or_equal, self.module.inside_in_any_case
        folder = "/h/Desk/inbox/anchors"
        for path in (folder, folder + "/a-v1/01_identity.png"):
            self.assertTrue(exact(path, folder) and exact(path, folder + "/"), path)
            self.assertTrue(loose(path, folder) and loose(path, folder + "/"), path)
        # a different spelling of the same folder: the exact test is for places that ALLOW something (it keeps a
        # --ref-root narrow), the other one is for places that REFUSE something
        for path in ("/h/Desk/inbox/Anchors/a-v1/x.png", "/h/Desk/inbox/ANCHORS", "/H/DESK/INBOX/ANCHORS/X.PNG"):
            self.assertFalse(exact(path, folder), path)
            self.assertTrue(loose(path, folder), path)
        for path in ("/h/Desk/inbox/anchors2/a.png", "/h/Desk/inbox/anchor", "/h/Desk/inbox", "/elsewhere/anchors",
                     "/h/Desk/inbox/anchors-v1.png"):
            self.assertFalse(exact(path, folder), path)
            self.assertFalse(loose(path, folder), path)
        # an e with an accent, as one character or as a letter and a mark, is one name on a Mac
        composed, decomposed = "/h/caf" + chr(0xE9), "/h/cafe" + chr(0x301)
        self.assertFalse(exact(decomposed + "/x.png", composed))
        self.assertTrue(loose(decomposed + "/x.png", composed))
        self.assertTrue(loose(composed + "/x.png", decomposed))

    def test_megapixels_are_rounded_up_so_a_picture_over_the_limit_never_reads_as_40(self):
        for pixels, want in ((40000001, "40.1"), (40005000, "40.1"), (40100000, "40.1"), (40100001, "40.2"),
                             (41000000, "41"), (3600000000, "3600"), (40200000, "40.2")):
            self.assertEqual(self.module.megapixel_text(pixels), want, pixels)

    def test_a_path_with_a_lone_surrogate_cannot_be_named(self):
        self.assertTrue(self.module.can_be_named("/Users/x/Desktop/room.png"))
        self.assertFalse(self.module.can_be_named("/Users/x/Desktop/a" + chr(0xD800) + ".png"))


# ---------------------------------------------------------------------------
# The text of the script
# ---------------------------------------------------------------------------

class StaticTests(unittest.TestCase):
    FORBIDDEN = ("socket", "urllib", "http.client", "requests", "subprocess", "os.system", "os.popen", "os.exec",
                 "os.spawn", "os.fork", "ctypes", "shutil", "rmtree", "os.remove", "os.unlink", "os.rmdir", "eval(",
                 "exec(", "__import__")
    NEVER = {"run_process", "sips_size", "read_image_header", "check_refs", "load_picture", "load_candidates",
             "stage_refs", "stage_one", "drop_job", "drop_staged_refs", "make_job", "copy_into_folder", "file_images",
             "find_codex", "find_agy", "child_env", "list_process_commands"}
    NEVER_PREFIXES = ("cmd_", "codex_", "agy_", "clipboard_")

    @classmethod
    def setUpClass(cls):
        with open(SCRIPT, "rb") as handle:
            cls.raw = handle.read()
        cls.text = cls.raw.decode("ascii")                           # it is plain ASCII, or this fails
        cls.tree = ast.parse(cls.text)

    def test_the_script_has_no_forbidden_code(self):
        for word in self.FORBIDDEN:
            self.assertNotIn(word, self.text, "the script text holds %r" % word)
        self.assertNotIn("--force", self.text)
        self.assertNotIn("also-allow", self.text)
        self.assertNotIn("ComfyUI (", self.text)                     # no ComfyUI folder name as the only way to find it
        lines = [number for number, line in enumerate(self.text.splitlines(), start=1) if "dont_write_bytecode" in line]
        self.assertEqual(len(lines), 1)
        body = [node for node in self.tree.body if not (isinstance(node, ast.Expr)
                                                        and isinstance(getattr(node, "value", None), ast.Constant))]
        self.assertIsInstance(body[0], ast.Import)
        self.assertEqual([alias.name for alias in body[0].names], ["sys"])
        flag = body[1]
        self.assertIsInstance(flag, ast.Assign)
        self.assertEqual(ast.unparse(flag) if hasattr(ast, "unparse") else "sys.dont_write_bytecode = True",
                         "sys.dont_write_bytecode = True")
        self.assertLess(self.text.index("sys.dont_write_bytecode = True"), self.text.index("desk_art.py"))
        self.assertLess(self.text.index("sys.dont_write_bytecode = True"), self.text.index("def load_helper"))

    def imports(self):
        found = []

        def visit(node, inside):
            for child in ast.iter_child_nodes(node):
                now = inside or isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda))
                if isinstance(child, ast.Import):
                    found.extend((alias.name, now) for alias in child.names)
                elif isinstance(child, ast.ImportFrom):
                    found.append((child.module or "", now))
                visit(child, now)
        visit(self.tree, False)
        return found

    def test_pillow_is_imported_only_inside_functions_and_numpy_not_at_all(self):
        found = self.imports()
        pillow = [(name, inside) for name, inside in found if name.split(".")[0] == "PIL"]
        self.assertTrue(pillow)
        self.assertTrue(all(inside for _, inside in pillow), pillow)
        self.assertFalse([name for name, _ in found if name.split(".")[0] == "numpy"])
        for name, inside in found:
            if not inside:
                self.assertIn(name.split(".")[0], {"sys", "argparse", "hashlib", "importlib", "io", "json", "os", "re",
                                                   "secrets", "stat", "time", "traceback", "unicodedata", "warnings",
                                                   "typing"}, name)

    def test_every_picture_is_decoded_from_bytes_that_were_read(self):
        opens = [line for line in self.text.splitlines() if "Image.open(" in line]
        self.assertTrue(opens)
        for line in opens:
            self.assertIn("io.BytesIO(", line)
        self.assertIn("warnings.simplefilter(\"ignore\")", self.text)

    def test_the_helper_names_the_script_uses(self):
        names = sorted(set(re.findall(r"\bhelper\.([A-Za-z_][A-Za-z0-9_]*)", self.text)))
        self.assertTrue(names)
        spec = importlib.util.spec_from_file_location("desk_art_for_names", HELPER_FILE)
        real = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(real)
        for name in names:
            self.assertNotIn(name, self.NEVER, name)
            self.assertFalse(name.startswith(self.NEVER_PREFIXES), name)
            self.assertTrue(hasattr(real, name), "the helper has no %s any more" % name)

    def test_nothing_in_the_script_invites_a_restricted_picture(self):
        allowed = re.compile(r"ask for a pose|pose[- ]ladder|romance pose|no .?pose|clothes, pose, composition|"
                             r"pose, composition", re.IGNORECASE)
        for number, line in enumerate(self.text.splitlines(), start=1):
            if re.search(r"\bpose\b", line, re.IGNORECASE):
                self.assertRegex(line, allowed, "line %d" % number)
        self.assertNotRegex(self.text, r"(?i)\bpose\b.*role|role.*\bpose\b")

    def test_lines_are_at_most_120_characters_and_python_39_syntax(self):
        for number, line in enumerate(self.text.splitlines(), start=1):
            self.assertLessEqual(len(line), 120, "line %d is too long" % number)
        for node in ast.walk(self.tree):
            self.assertNotIsInstance(node, getattr(ast, "Match", ()), "match is not Python 3.9 syntax")


# ---------------------------------------------------------------------------
# The whole way, without a generator
# ---------------------------------------------------------------------------

@needs_pillow_python
class AnchorSmokeTests(ScriptCase):
    def test_end_to_end_without_a_generator(self):
        description = self.close_up("closeup-v1")
        preview = self.build(description, preview=True)
        self.assertEqual(preview.code, 0, preview.out)
        built = self.build(description)
        self.assertEqual(built.code, 0, built.out)
        shown = self.run_script(["show", "--inbox", self.sb.inbox, "closeup-v1"])
        self.assertEqual((shown.code, shown.data["matches"]), (0, True))
        request = "The same view, 16:9. No people, no animals, no text, no logos."
        words = self.run_script(["words", "--inbox", self.sb.inbox, "closeup-v1", "--extra", "1", "--prompt-stdin"],
                                stdin=request)
        self.assertEqual(words.code, 0, words.out)
        extra = self.source("extra.png", png_bytes(90, 90, (9, 99, 199)))
        # the helper's own command against the FAKE Codex: nothing real is started, nothing leaves the sandbox
        result = self.cli("codex", "--label", "closeup", "--prompt-stdin", "--anchor", "closeup-v1", *self.root_args(),
                          "--ref", extra, stdin=request)
        self.assertEqual(result.code, 0, result.out)
        card = self.card_of("closeup-v1")
        place_sha, room_sha = (member["sha256"] for member in card["members"])
        self.assertNotEqual(place_sha, room_sha)
        calls = self.sb.calls(self.sb.codex_log, "exec")
        self.assertEqual(len(calls), 1)
        call = calls[0]
        self.assertEqual(len(call["images"]), 3)
        self.assertEqual([info["sha256"] for info in call["image_info"]],
                         [place_sha, room_sha, sha_of(read_bytes(extra))])
        self.assertEqual(call["prompt"], WRAPPER_TEXT + words.data["prompt"])
        self.assertEqual(self.sb.calls(self.sb.agy_log), [])
        rows = self.sb.manifest()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(list(row), MANIFEST_KEYS + ["anchor"])
        self.assertEqual(row["anchor"], {
            "name": "closeup-v1", "wordsVersion": "1", "wordsSha256": words.data["wordsSha256"],
            "cardSha256": shown.data["cardSha256"], "roles": ["place", "room"], "extra": 1})
        self.assertEqual(row["prompt"], request)
        self.assertEqual([item["name"] for item in row["refs"]],
                         ["closeup-v1/01_place.png", "closeup-v1/02_room.png", "extra.png"])
        self.assertEqual(result.data["anchor"]["pictures"][0], {
            "n": 1, "role": "place", "name": "closeup-v1/01_place.png", "sha8": place_sha[:8]})
        # the words the helper sent are the words `words` printed, and `show` printed the set's own words
        self.assertTrue(words.data["prompt"].startswith(shown.data["block"]))
        self.assertIn("Picture 3 is extra", words.data["prompt"])
        # the stored set was not touched by any of it
        again = self.run_script(["show", "--inbox", self.sb.inbox, "closeup-v1"])
        self.assertEqual(again.data["cardSha256"], shown.data["cardSha256"])
        self.assertTrue(again.data["matches"])


if __name__ == "__main__":
    unittest.main()
