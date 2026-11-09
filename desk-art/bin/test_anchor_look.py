#!/usr/bin/env python3
"""Tests for skills/anchor/scripts/anchor_look.py (desk-art 0.2.0): the commands sheet, beside, zoom and measure.

Everything runs in a temporary "home" (the Sandbox of test_desk_art.py): no real inbox, no real cache, no generator,
no network. Sets are written by write_set (anchor_test_support.py), the way the set builder would write them, so
these tests do not depend on anchor_set.py.

Run from the mod folder, on ComfyUI's Python (it has Pillow and numpy):
    "$PY" -B -m unittest discover -s bin -p 'test_anchor_look.py' -v
On the system Python the tests that START the script run it on ComfyUI's Python (found by anchor_test_support), and
the tests that load the script in this very process skip themselves.
"""

import collections
import colorsys
import contextlib
import errno
import importlib.util
import io
import json
import os
import random
import re
import stat
import struct
import subprocess
import sys
import unittest
import zlib
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import desk_art  # noqa: E402
from anchor_test_support import PLAIN_PYTHON, PNG_SIGNATURE, banded_png, pillow_here, pillow_python  # noqa: E402
from anchor_test_support import png_chunk, png_rgb, png_rgba, png_with_chunks, write_set  # noqa: E402
from test_desk_art import Result, SandboxCase  # noqa: E402

SCRIPT = os.path.normpath(os.path.join(HERE, "..", "skills", "anchor", "scripts", "anchor_look.py"))
PIL_PYTHON = pillow_python()
NEEDS_PILLOW = unittest.skipUnless(PIL_PYTHON, "needs a Python that has Pillow and numpy (ComfyUI's)")
NEEDS_PILLOW_HERE = unittest.skipUnless(pillow_here(), "needs Pillow and numpy in the interpreter that runs the tests")

SCRIPT_CODES = ("usage", "bad-input", "inbox-unsafe", "set-exists", "set-not-found", "set-damaged", "needs-pillow",
                "internal")
SHEET_NOTE = "Show this file to the owner (send it with the SendUserFile tool if you have it, otherwise give the path)."
SHEET_UPLOAD_LINE = "These pictures go to OpenAI or Google every time the set is used."
MEASURE_NOTE = "Numbers only. They never accept or refuse a picture: look at it too."
NO_KEY_REASON = "give --key (the flat backdrop colour) to measure the backdrop and the colour"
NO_IDENTITY_REASON = "the set has no identity picture"
HELPER_MISSING = "the desk-art helper next to this skill is missing or older than 0.2.0"
KEY = "#FF00FF"
MAGENTA = (255, 0, 255)
BACKGROUND = (40, 40, 40)
GREY = (128, 128, 128)
BANDS = ((200, 30, 30), (30, 200, 30), (30, 30, 200))
FIGURE_BOX = (0.3, 0.1, 0.7, 0.9)          # the figure of banded pictures: wide margins, so the corners are backdrop
PARTS = {0: "head", 1: "head", 2: "body", 3: "body", 4: "body", 5: "legs", 6: "legs", 7: "feet"}

# Runs several command lines through run_cli in ONE program (the tables of refusals would take minutes otherwise).
DRIVER = (
    "import importlib.util, json, sys\n"
    "spec = importlib.util.spec_from_file_location('anchor_look_driver', sys.argv[1])\n"
    "module = importlib.util.module_from_spec(spec)\n"
    "spec.loader.exec_module(module)\n"
    "rows = []\n"
    "for argv in json.loads(sys.argv[2]):\n"
    "    code, result = module.run_cli(argv)\n"
    "    rows.append([code, result])\n"
    "print(json.dumps(rows))\n")

# The same, in a program where numpy cannot be imported (only measure needs it).
NO_NUMPY_DRIVER = "import sys\nsys.modules['numpy'] = None\n" + DRIVER

# Reads pixels and the lowest and highest value of a few boxes of a picture, with Pillow, in its own program.
SAMPLE_CODE = (
    "import json, sys\n"
    "from PIL import Image\n"
    "image = Image.open(sys.argv[1]).convert('RGB')\n"
    "points = [list(image.getpixel(tuple(point))) for point in json.loads(sys.argv[2])]\n"
    "boxes = [[list(pair) for pair in image.crop(tuple(box)).getextrema()] for box in json.loads(sys.argv[3])]\n"
    "print(json.dumps({'size': list(image.size), 'pixels': points, 'extrema': boxes}))\n")


def figure(bands=BANDS, key=MAGENTA, width=128, height=256):
    """A figure of three bands on a flat backdrop, with corners that are all backdrop."""
    return banded_png(width, height, key=key, bands=bands, box=FIGURE_BOX)


def png_dimensions(path):
    with open(path, "rb") as handle:
        head = handle.read(24)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG: %s" % path
    return struct.unpack(">II", head[16:24])


def sample(path, points=(), boxes=()):
    """{'size': [w, h], 'pixels': [[r, g, b], ...], 'extrema': [[[min, max] per channel], ...]} of a picture."""
    done = subprocess.run([PIL_PYTHON, "-I", "-B", "-c", SAMPLE_CODE, path, json.dumps(list(points)),
                           json.dumps(list(boxes))], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                          stderr=subprocess.PIPE, timeout=120)
    if done.returncode != 0:
        raise AssertionError("could not read %s: %s" % (path, done.stderr.decode("utf-8", "replace")))
    return json.loads(done.stdout.decode("utf-8"))


def lab_of(rgb):
    """CIE Lab (D65) of an sRGB colour, written out separately from the script (plain Python, the CIE kappa form)."""
    def linear(value):
        value = value / 255.0
        return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4

    r, g, b = [linear(value) for value in rgb]
    x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * b
    y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b
    z = 0.0193339 * r + 0.1191920 * g + 0.9503041 * b

    def f(t):
        return t ** (1.0 / 3.0) if t > 216.0 / 24389.0 else (24389.0 / 27.0 * t + 16.0) / 116.0

    fx, fy, fz = f(x / 0.95047), f(y / 1.0), f(z / 1.08883)
    return 116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)


def lab_distance(one, other):
    return sum((a - b) ** 2 for a, b in zip(lab_of(one), lab_of(other))) ** 0.5


def saturation_brightness(rgb):
    _, saturation, value = colorsys.rgb_to_hsv(*[channel / 255.0 for channel in rgb])
    return saturation, value


def load_look():
    """The script loaded as a module in THIS process (a new copy each time, so no state is shared between tests)."""
    spec = importlib.util.spec_from_file_location("anchor_look_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def pattern(seed, width=192, height=108):
    """A grid of random rectangles on a dark base: a picture with plenty of edges (rows of (r, g, b))."""
    rng = random.Random(seed)
    grid = [[(30, 30, 30)] * width for _ in range(height)]
    for _ in range(70):
        x0, y0 = rng.randrange(0, width - 8), rng.randrange(0, height - 8)
        x1, y1 = min(width, x0 + rng.randrange(6, 60)), min(height, y0 + rng.randrange(6, 40))
        colour = (rng.randrange(256), rng.randrange(256), rng.randrange(256))
        for y in range(y0, y1):
            for x in range(x0, x1):
                grid[y][x] = colour
    return grid


def png_16bit(width, height, color_type, row, extra=()):
    """Bytes of a 16-bit PNG (the builders of anchor_test_support make 8-bit pictures only). `row` is the bytes of one
    row of pixels, two bytes to a value, big-endian, and every row is the same; `extra` are (type, data) chunks that
    go before the pixels."""
    header = struct.pack(">IIBBBBB", width, height, 16, color_type, 0, 0, 0)
    chunks = [png_chunk(b"IHDR", header)] + [png_chunk(kind, data) for kind, data in extra]
    chunks += [png_chunk(b"IDAT", zlib.compress((b"\x00" + row) * height)), png_chunk(b"IEND", b"")]
    return PNG_SIGNATURE + b"".join(chunks)


def grey16_blocks(values, block=10, height=10, key=None):
    """A 16-bit grey picture of flat blocks, one `block` pixels wide for each value. With `key`, that value is the
    transparent colour (a tRNS chunk)."""
    row = b"".join(struct.pack(">H", value) * block for value in values)
    extra = [] if key is None else [(b"tRNS", struct.pack(">H", key))]
    return png_16bit(block * len(values), height, 0, row, extra)


def without_sizes(card):
    """card_edit for write_set: a card that leaves out the optional size of every picture (the builder writes it, a
    hand-made card may not), so that a picture longer than the card rules allow still loads."""
    for member in card["members"]:
        member.pop("size", None)


Anchor = collections.namedtuple("Anchor", "name made keep")          # the parts of a set that a sheet's footer uses


class Spy(object):
    """A picture that notes the size of every resize it is asked for, and does it."""

    def __init__(self, image):
        self.image = image
        self.size = image.size
        self.resized = []

    def resize(self, size, resample):
        self.resized.append(size)
        return self.image.resize(size, resample)

    def convert(self, mode):
        return self.image.convert(mode)


class LookCase(SandboxCase):
    """Runs the script as a program on Pillow's Python, with the sandbox's home, inbox and cache."""

    def run_script(self, args, python=None, env=None):
        environment = self.sb.env()
        environment.update(env or {})
        done = subprocess.run([python or PIL_PYTHON, "-I", "-B", SCRIPT] + [str(arg) for arg in args],
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              env=environment, timeout=300)
        out = done.stdout.decode("utf-8")
        err = done.stderr.decode("utf-8", "replace")
        self.assertTrue(out.endswith("\n") and out.count("\n") == 1, "stdout is not one line: %r" % out[:300])
        self.assertTrue(out.isascii(), "stdout is not plain ASCII")
        data = json.loads(out)
        self.assertIsInstance(data, dict)
        if data["ok"]:
            self.assertEqual(done.returncode, 0, out)
            self.assertEqual(err, "", "standard error is not empty on success")
        else:
            self.assertIn(data["code"], SCRIPT_CODES, out)
            self.assertEqual(done.returncode, {"usage": 3, "internal": 1}.get(data["code"], 2), out)
        return Result(done.returncode, data, out, err)

    def run_many(self, argvs, env=None, driver=DRIVER):
        """The results of several command lines, each run through run_cli of the script (one program for all)."""
        environment = self.sb.env()
        environment.update(env or {})
        done = subprocess.run([PIL_PYTHON, "-I", "-B", "-c", driver, SCRIPT, json.dumps(argvs)],
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              env=environment, timeout=600)
        self.assertEqual(done.returncode, 0, done.stderr.decode("utf-8", "replace")[-2000:])
        rows = json.loads(done.stdout.decode("utf-8"))
        self.assertEqual(len(rows), len(argvs))
        return [Result(code, data, json.dumps(data), "") for code, data in rows]

    def inbox_args(self):
        return ["--inbox", self.sb.inbox]

    def make_set(self, name, members, **options):
        return write_set(self.sb, name, members, **options)

    def art_file(self, name, data):
        return self.sb.write_file(os.path.join(self.sb.art, name), data)

    def looks(self):
        return os.path.join(self.sb.cache, "anchor-looks")

    def looks_files(self):
        folder = self.looks()
        return sorted(os.listdir(folder)) if os.path.isdir(folder) else []

    def assert_refused(self, result, code="bad-input", fragment=None):
        self.assertEqual(result.data["ok"], False, result.out)
        self.assertEqual(result.data["code"], code, result.out)
        if fragment is not None:
            self.assertIn(fragment, result.data["error"], result.out)

    def tree(self):
        """Every entry under the sandbox home: folders by mode, files by size, modification time and mode."""
        found = {}
        for folder, dirs, names in os.walk(self.sb.home):
            for name in dirs + names:
                path = os.path.join(folder, name)
                info = os.lstat(path)
                relative = os.path.relpath(path, self.sb.home)
                if stat.S_ISLNK(info.st_mode):
                    found[relative] = ("link", os.readlink(path))
                elif stat.S_ISDIR(info.st_mode):
                    found[relative] = ("dir", stat.S_IMODE(info.st_mode))
                else:
                    found[relative] = ("file", info.st_size, info.st_mtime_ns, stat.S_IMODE(info.st_mode))
        return found

    def assert_only_looks_added(self, before, after):
        """Nothing that was there has changed, and the only new entries are the looks folder, the files in it and the
        parent folders of the cache path that did not exist yet."""
        cache = os.path.relpath(self.sb.cache, self.sb.home)
        parts = cache.split(os.sep)
        parents = set(os.sep.join(parts[:index]) for index in range(1, len(parts) + 1))
        looks = os.path.join(cache, "anchor-looks")
        for path, value in before.items():
            self.assertEqual(after.get(path), value, "changed or removed: %s" % path)
        for path in set(after) - set(before):
            self.assertTrue(path in parents or path == looks or path.startswith(looks + os.sep),
                            "a new entry outside the looks folder: %s" % path)


# ---------------------------------------------------------------------------
# sheet, beside, zoom: the pictures
# ---------------------------------------------------------------------------

@NEEDS_PILLOW
class PictureTests(LookCase):
    def test_sheet_is_one_png_in_the_cache_with_the_pinned_size(self):
        self.make_set("pair-v1", [{"role": "identity", "png": png_rgb(100, 200, (30, 60, 90))},
                                  {"role": "style", "png": png_rgb(200, 100, (90, 60, 30))}], keep="blue suit")
        result = self.run_script(["sheet"] + self.inbox_args() + ["pair-v1"])
        self.assertEqual(result.code, 0, result.out)
        data = result.data
        self.assertEqual(list(data), ["ok", "command", "file", "size", "note"])
        self.assertEqual(data["command"], "sheet")
        self.assertEqual(data["note"], SHEET_NOTE)
        path = data["file"]
        self.assertEqual(os.path.dirname(path), self.looks())
        self.assertRegex(os.path.basename(path), r"^pair-v1-sheet-[0-9]{8}T[0-9]{6}-[0-9a-f]{4}\.png$")
        self.assertEqual(stat.S_IMODE(os.stat(path).st_mode), 0o600)
        # tiles of 100x200 and 200x100 become 180x360 and 720x360: 32 + 180 + 720 + 16 wide, 476 high
        self.assertEqual(png_dimensions(path), (948, 476))
        self.assertEqual(data["size"], [948, 476])
        # the tiles are left-aligned from x = 16 with a gap of 16, in the order of the set, below a 28 px band
        found = sample(path, points=[(16 + 90, 44 + 180), (16 + 180 + 16 + 360, 44 + 180), (3, 3), (940, 470)],
                       boxes=[(16, 16, 100, 44), (212, 16, 296, 44), (16, 412, 700, 426), (16, 428, 700, 442),
                              (16, 444, 700, 458)])
        self.assertEqual(found["pixels"][0], [30, 60, 90])
        self.assertEqual(found["pixels"][1], [90, 60, 30])
        self.assertEqual(found["pixels"][2], list(BACKGROUND))
        self.assertEqual(found["pixels"][3], list(BACKGROUND))
        for extrema in found["extrema"]:               # a label above each tile and three lines of text below them
            self.assertNotEqual(extrema, [[40, 40], [40, 40], [40, 40]])
        self.assertEqual(stat.S_IMODE(os.stat(self.looks()).st_mode), 0o700)

    def test_a_tile_is_as_wide_as_round_of_its_scaled_width(self):
        # 64x112 scaled to 360 high is 205.7 wide: 206 (round), not 205 (cut off)
        self.make_set("odd-v1", [{"role": "identity", "png": png_rgb(64, 112, (30, 60, 90))}])
        result = self.run_script(["sheet"] + self.inbox_args() + ["odd-v1"])
        self.assertEqual(result.code, 0, result.out)
        found = sample(result.data["file"], points=[(16 + 205, 44 + 180), (16 + 206, 44 + 180)])
        self.assertEqual(found["pixels"], [[30, 60, 90], list(BACKGROUND)])

    def test_a_three_picture_sheet_keeps_the_order_and_the_widths(self):
        self.make_set("three-v1", [{"role": "style", "png": png_rgb(100, 100, (200, 40, 40))},
                                   {"role": "place", "png": png_rgb(160, 90, (40, 200, 40))},
                                   {"role": "light", "png": png_rgb(160, 90, (40, 40, 200))}])
        result = self.run_script(["sheet"] + self.inbox_args() + ["three-v1"])
        self.assertEqual(result.code, 0, result.out)
        # 360 + 640 + 640 wide tiles: 32 + 1640 + 32
        self.assertEqual(result.data["size"], [1704, 476])
        self.assertEqual(png_dimensions(result.data["file"]), (1704, 476))
        found = sample(result.data["file"], points=[(16 + 180, 224), (16 + 360 + 16 + 320, 224),
                                                    (16 + 360 + 16 + 640 + 16 + 320, 224)],
                       boxes=[(0, 0, 1704, 16), (0, 466, 1704, 476)])
        self.assertEqual(found["pixels"], [[200, 40, 40], [40, 200, 40], [40, 40, 200]])
        for extrema in found["extrema"]:                 # the top and bottom margins are plain background
            self.assertEqual(extrema, [[40, 40], [40, 40], [40, 40]])

    def test_beside_sizes(self):
        self.make_set("fig-v1", [{"role": "identity", "png": png_rgb(100, 200, (10, 20, 30))}])
        result_path = self.art_file("r.png", png_rgb(150, 300, (30, 20, 10)))
        base = ["beside"] + self.inbox_args() + ["fig-v1", result_path]
        plain = self.run_script(base)
        self.assertEqual(plain.code, 0, plain.out)
        self.assertEqual(list(plain.data), ["ok", "command", "file", "size"])
        self.assertEqual(plain.data["size"], [32 + 360 + 16 + 360, 16 + 28 + 720 + 16])
        self.assertEqual(png_dimensions(plain.data["file"]), (768, 780))
        self.assertRegex(os.path.basename(plain.data["file"]), r"^fig-v1-beside-[0-9]{8}T[0-9]{6}-[0-9a-f]{4}\.png$")
        self.assertEqual(stat.S_IMODE(os.stat(plain.data["file"]).st_mode), 0o600)
        found = sample(plain.data["file"], points=[(16 + 180, 44 + 360), (16 + 360 + 16 + 180, 44 + 360)],
                       boxes=[(16, 16, 120, 44), (392, 16, 450, 44)])
        self.assertEqual(found["pixels"], [[10, 20, 30], [30, 20, 10]])
        for extrema in found["extrema"]:               # ANCHOR 1 (identity) and RESULT
            self.assertNotEqual(extrema, [[40, 40], [40, 40], [40, 40]])
        zoomed = self.run_script(base + ["--zoom", "0.25,0,0.75,0.2"])
        self.assertEqual(zoomed.code, 0, zoomed.out)
        self.assertEqual(zoomed.data["size"], [768, 780 + 8 + 28 + 360])
        self.assertEqual(png_dimensions(zoomed.data["file"]), (768, 1176))
        # the zoom row shows the same part of each picture, left-aligned under it; the crop (50x40) is wider than
        # its column, so it is scaled down to the column's width (360 x 288) and centred in its 360 px band
        found = sample(zoomed.data["file"], points=[(16 + 180, 800 + 180), (16 + 360 + 16 + 180, 800 + 180),
                                                    (16 + 180, 800 + 5)],
                       boxes=[(16, 800, 16 + 360, 800 + 36), (16, 772, 120, 800), (392, 772, 480, 800)])
        self.assertEqual(found["pixels"][:2], [[10, 20, 30], [30, 20, 10]])
        self.assertEqual(found["pixels"][2], list(BACKGROUND))                       # above the centred crop
        self.assertEqual(found["extrema"][0], [[40, 40], [40, 40], [40, 40]])
        for extrema in found["extrema"][1:]:           # ANCHOR 1 zoom and RESULT zoom
            self.assertNotEqual(extrema, [[40, 40], [40, 40], [40, 40]])

    def test_a_wide_picture_is_scaled_down_to_4096_and_centred(self):
        self.make_set("wide-v1", [{"role": "style", "png": png_rgb(4000, 100, (50, 60, 70))}])
        result_path = self.art_file("w.png", png_rgb(4000, 100, (70, 60, 50)))
        result = self.run_script(["beside"] + self.inbox_args() + ["wide-v1", result_path])
        self.assertEqual(result.code, 0, result.out)
        # 4000x100 at height 720 would be 28800 wide: 4096 wide and 102 high instead, centred in the 720 px band
        self.assertEqual(result.data["size"], [32 + 4096 + 16 + 4096, 780])
        found = sample(result.data["file"], points=[(16 + 2000, 44 + 360), (16 + 2000, 44 + 10)])
        self.assertEqual(found["pixels"][0], [50, 60, 70])
        self.assertEqual(found["pixels"][1], list(BACKGROUND))
        sheet = self.run_script(["sheet"] + self.inbox_args() + ["wide-v1"])
        self.assertEqual(sheet.data["size"], [32 + 4096, 476])

    def test_beside_lays_a_transparent_result_on_grey(self):
        self.make_set("fig-v1", [{"role": "identity", "png": png_rgb(100, 200, (10, 20, 30))}])
        result_path = self.art_file("t.png", png_rgba(100, 200, (50, 50, 50, 0)))
        result = self.run_script(["beside"] + self.inbox_args() + ["fig-v1", result_path])
        self.assertEqual(result.code, 0, result.out)
        found = sample(result.data["file"], points=[(16 + 360 + 16 + 180, 44 + 360)])
        self.assertEqual(found["pixels"], [list(GREY)])

    def test_zoom_sizes_and_sources(self):
        picture = self.art_file("z.png", png_rgb(200, 400, lambda x, y: (200, 30, 30) if y >= 200 else (30, 30, 200)))
        base = ["zoom"] + self.inbox_args()
        lower = self.run_script(base + [picture, "0,0.5,1,1"])
        self.assertEqual(lower.code, 0, lower.out)
        self.assertEqual(list(lower.data), ["ok", "command", "file", "of", "region", "size"])
        self.assertEqual(lower.data["of"], picture)
        self.assertEqual(lower.data["region"], [0.0, 0.5, 1.0, 1.0])
        self.assertEqual(lower.data["size"], [720, 720])                    # a 200x200 region scaled to 720 high
        self.assertEqual(png_dimensions(lower.data["file"]), (720, 720))
        self.assertEqual(os.path.dirname(lower.data["file"]), self.looks())
        self.assertRegex(os.path.basename(lower.data["file"]), r"^look-zoom-[0-9]{8}T[0-9]{6}-[0-9a-f]{4}\.png$")
        self.assertEqual(stat.S_IMODE(os.stat(lower.data["file"]).st_mode), 0o600)
        self.assertEqual(sample(lower.data["file"], points=[(360, 360), (3, 3)])["pixels"],
                         [[200, 30, 30], [200, 30, 30]])
        middle = self.run_script(base + [picture, "0.25,0.25,0.75,0.5"])    # a 100x100 region
        self.assertEqual(middle.data["size"], [720, 720])
        self.assertEqual(middle.data["region"], [0.25, 0.25, 0.75, 0.5])
        left = self.run_script(base + [picture, "0,0,0.5,1"])               # 100x400 scaled to 720 high
        self.assertEqual(left.data["size"], [180, 720])
        self.assertEqual(png_dimensions(left.data["file"]), (180, 720))
        self.assertEqual(sample(left.data["file"], points=[(90, 100), (90, 600)])["pixels"],
                         [[30, 30, 200], [200, 30, 30]])
        # a very wide region is scaled down to 4096 px wide
        wide = self.art_file("wide.png", png_rgb(4000, 100, (10, 120, 10)))
        scaled = self.run_script(base + [wide, "0,0,1,1"])
        self.assertEqual(scaled.data["size"], [4096, 102])
        # the same command reads a picture of the cache (a preview), a stored set picture and a picture of the inbox
        os.makedirs(self.looks(), exist_ok=True)
        preview = self.sb.write_file(os.path.join(self.looks(), "smoke-v1-preview1-20261109T120000-ab12.png"),
                                     png_rgb(64, 64, (1, 2, 3)))
        folder = self.make_set("keep-v1", [{"role": "identity", "png": png_rgb(80, 160, (9, 8, 7))}])
        stored = os.path.join(folder, "01_identity.png")
        filed = self.sb.write_file(os.path.join(self.sb.inbox, "2026-11-09", "p.png"), png_rgb(64, 64, (4, 5, 6)))
        for path in (preview, stored, filed):
            again = self.run_script(base + [path, "0,0,1,1"])
            self.assertEqual(again.code, 0, again.out)
            self.assertEqual(again.data["of"], path)
        # a transparent picture is laid on grey (128, 128, 128)
        glass = self.art_file("glass.png", png_rgba(64, 64, (255, 0, 0, 0)))
        flat = self.run_script(base + [glass, "0,0,1,1"])
        self.assertEqual(sample(flat.data["file"], points=[(10, 10)])["pixels"], [list(GREY)])

    def test_zoom_turns_a_picture_upright_by_its_orientation(self):
        # an eXIf block with orientation 6 (the picture is lying on its side): 40x20 stored, 20x40 upright
        exif = b"MM\x00*\x00\x00\x00\x08" + b"\x00\x01" + b"\x01\x12\x00\x03\x00\x00\x00\x01\x00\x06\x00\x00" \
            + b"\x00\x00\x00\x00"
        lying = self.art_file("lying.png", png_with_chunks(png_rgb(40, 20, (10, 100, 10)), [(b"eXIf", exif)]))
        result = self.run_script(["zoom"] + self.inbox_args() + [lying, "0,0,1,1"])
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["size"], [360, 720])

    def test_a_corrupt_hidden_chunk_prints_nothing_on_standard_error(self):
        # junk in the chunk: Pillow refuses the picture; a chunk cut short: Pillow only warns ("Corrupt EXIF data"),
        # and the warning must not reach standard error either
        junk = self.art_file("junk.png", png_with_chunks(png_rgb(40, 20, (10, 100, 10)),
                                                         [(b"eXIf", b"junk-exif-bytes")]))
        result = self.run_script(["zoom"] + self.inbox_args() + [junk, "0,0,1,1"])
        self.assert_refused(result, "bad-input", "is not a readable PNG, JPEG or WEBP picture")
        self.assertEqual(result.err, "")
        self.assertEqual(self.looks_files(), [])
        cut = b"MM\x00*\x00\x00\x00\x08\x00\x01\x01\x12"
        short = self.art_file("short.png", png_with_chunks(figure(), [(b"eXIf", cut)]))
        for argv in (["zoom", short, "0,0,1,1"], ["sheet", "fig-v1"], ["beside", "fig-v1", short],
                     ["measure", "fig-v1", short, "--key", KEY]):
            self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
            result = self.run_script([argv[0]] + self.inbox_args() + argv[1:])
            self.assertEqual(result.code, 0, result.out)
            self.assertEqual(result.err, "")

    def test_a_jpeg_result_is_read(self):
        jpeg = os.path.join(self.sb.art, "j.jpg")
        os.makedirs(self.sb.art, exist_ok=True)
        code = ("import sys\nfrom PIL import Image\n"
                "Image.new('RGB', (60, 90), (200, 100, 50)).save(sys.argv[1], format='JPEG', quality=95)\n")
        subprocess.run([PIL_PYTHON, "-I", "-B", "-c", code, jpeg], check=True, timeout=120)
        result = self.run_script(["zoom"] + self.inbox_args() + [jpeg, "0,0,1,1"])
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["size"], [480, 720])

    def test_two_calls_make_two_files_and_nothing_else_changes(self):
        self.make_set("twice-v1", [{"role": "identity", "png": figure()}])
        picture = self.art_file("r.png", figure())
        before = self.tree()
        first = self.run_script(["sheet"] + self.inbox_args() + ["twice-v1"])
        second = self.run_script(["sheet"] + self.inbox_args() + ["twice-v1"])
        third = self.run_script(["beside"] + self.inbox_args() + ["twice-v1", picture])
        files = [first.data["file"], second.data["file"], third.data["file"]]
        self.assertEqual(len(set(files)), 3)
        self.assertEqual(len(self.looks_files()), 3)
        self.assert_only_looks_added(before, self.tree())

    def test_a_one_picture_sheet_keeps_its_footer(self):
        name = "n" * 37 + "-v1"                                            # 40 characters
        self.assertEqual(len(name), 40)
        self.make_set(name, [{"role": "identity", "png": png_rgb(100, 200, (30, 60, 90))}],
                      keep="round lenses dark olive green; suit muted beige; tie mustard yellow with dark spots; "
                           "shoes dark brown")
        result = self.run_script(["sheet"] + self.inbox_args() + [name])
        self.assertEqual(result.code, 0, result.out)
        # the commonest set is one narrow figure: the sheet is still 720 wide, not 32 + 180
        self.assertEqual(result.data["size"], [720, 476])
        self.assertEqual(png_dimensions(result.data["file"]), (720, 476))
        footer = (0, 412, 720, 460)
        margin = (704, 412, 720, 460)
        found = sample(result.data["file"], boxes=[footer, margin])
        self.assertNotEqual(found["extrema"][0], [[40, 40], [40, 40], [40, 40]])           # the text is there
        self.assertEqual(found["extrema"][1], [[40, 40], [40, 40], [40, 40]])              # and stays inside the margin
        long_keep = ("blue suit; " * 40)[:300]                                      # the longest keep line there is
        self.assertEqual(len(long_keep), 300)
        self.make_set("longer-v1", [{"role": "identity", "png": png_rgb(100, 200, (30, 60, 90))}], keep=long_keep)
        longer = self.run_script(["sheet"] + self.inbox_args() + ["longer-v1"])
        self.assertEqual(longer.data["size"], [720, 476])
        found = sample(longer.data["file"], boxes=[footer, margin, (0, 428, 704, 444)])
        self.assertEqual(found["extrema"][1], [[40, 40], [40, 40], [40, 40]])
        self.assertNotEqual(found["extrema"][2], [[40, 40], [40, 40], [40, 40]])           # a keep line is drawn

    def test_a_set_without_a_keep_line_says_none(self):
        # the words themselves are pinned by WordsTests and InProcessTests.test_the_sheet_draws_the_pinned_footer_lines
        self.make_set("nokeep-v1", [{"role": "identity", "png": png_rgb(100, 200, (30, 60, 90))}], keep="")
        result = self.run_script(["sheet"] + self.inbox_args() + ["nokeep-v1"])
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(result.data["size"], [720, 476])

    def test_a_16_bit_grey_picture_is_drawn_as_grey_and_not_as_white(self):
        # Pillow turns every 16-bit grey value above 255 into white. The script keeps the high byte of each value,
        # the way Pillow already reads 16-bit colour pictures (40000, 20000, 10000 are 156, 78, 39).
        values = [0, 256, 32768, 40000, 65535]
        wanted = [[0, 0, 0], [1, 1, 1], [128, 128, 128], [156, 156, 156], [255, 255, 255]]
        grey = self.art_file("grey16.png", grey16_blocks(values))                     # five blocks of 10 x 10 px
        zoomed = self.run_script(["zoom"] + self.inbox_args() + [grey, "0,0,1,1"])
        self.assertEqual(zoomed.code, 0, zoomed.out)
        self.assertEqual(zoomed.data["size"], [3600, 720])
        found = sample(zoomed.data["file"], points=[(720 * index + 360, 360) for index in range(5)])
        self.assertEqual(found["pixels"], wanted)
        # beside: the result is the right-hand column (a 360 px column of the figure and a 16 px gap before it)
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        beside = self.run_script(["beside"] + self.inbox_args() + ["fig-v1", grey])
        self.assertEqual(beside.code, 0, beside.out)
        left = 16 + 360 + 16
        found = sample(beside.data["file"], points=[(left + 720 * index + 360, 44 + 360) for index in range(5)])
        self.assertEqual(found["pixels"], wanted)
        # sheet: a picture of the set (a hand-made set may hold one; the builder stores 8-bit pictures)
        self.make_set("deep-v1", [{"role": "identity", "png": png_16bit(100, 200, 0, struct.pack(">H", 32768) * 100)}])
        sheet = self.run_script(["sheet"] + self.inbox_args() + ["deep-v1"])
        self.assertEqual(sheet.code, 0, sheet.out)
        self.assertEqual(sample(sheet.data["file"], points=[(16 + 90, 44 + 180)])["pixels"], [[128, 128, 128]])
        # a 16-bit picture in colour was already right, and stays so
        colour = self.art_file("rgb16.png", png_16bit(8, 8, 2, struct.pack(">HHH", 40000, 20000, 10000) * 8))
        again = self.run_script(["zoom"] + self.inbox_args() + [colour, "0,0,1,1"])
        self.assertEqual(sample(again.data["file"], points=[(360, 360)])["pixels"], [[156, 78, 39]])


# ---------------------------------------------------------------------------
# The rules every picture and every number obeys
# ---------------------------------------------------------------------------

@NEEDS_PILLOW
class RuleTests(LookCase):
    def test_a_link_in_place_of_the_looks_folder_is_refused(self):
        self.make_set("linked-v1", [{"role": "identity", "png": figure()}])
        elsewhere = self.sb.make_dir("elsewhere")
        os.makedirs(self.sb.cache)
        os.symlink(elsewhere, self.looks())
        result = self.run_script(["sheet"] + self.inbox_args() + ["linked-v1"])
        self.assert_refused(result, "inbox-unsafe", "the anchor-looks folder is a link that leads elsewhere")
        self.assertEqual(os.listdir(elsewhere), [])
        picture = self.art_file("r.png", figure())
        for argv in (["beside", "linked-v1", picture], ["zoom", picture, "0,0,1,1"],
                     ["measure", "linked-v1", picture, "--key", KEY]):
            again = self.run_script([argv[0]] + self.inbox_args() + argv[1:])
            self.assert_refused(again, "inbox-unsafe", "the anchor-looks folder is a link")
        self.assertEqual(os.listdir(elsewhere), [])

    def test_the_result_follows_the_picture_rules(self):
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        docs = self.sb.write_file(os.path.join(self.sb.home, "Documents", "r.png"), figure())
        secret = self.art_file("auth.json", figure())
        outside = self.sb.write_file(os.path.join(self.sb.outside, "elsewhere.png"), figure())
        os.symlink(outside, os.path.join(self.sb.art, "link.png"))
        os.makedirs(os.path.join(self.sb.art, "dir.png"))
        words = self.art_file("x.png", b"this is not a picture")
        rows = [(docs, "is not in a folder desk-art may send from"),
                (secret, "looks like a secrets or sign-in file"),
                (os.path.join(self.sb.art, "link.png"), "is not inside your home folder"),
                (os.path.join(self.sb.art, "dir.png"), "is not a regular file"),
                (words, "is not a PNG, JPEG or WEBP picture"),
                (os.path.join(self.sb.art, "missing.png"), "was not found")]
        argvs = []
        for path, _ in rows:
            argvs.append(["beside"] + self.inbox_args() + ["fig-v1", path])
            argvs.append(["measure"] + self.inbox_args() + ["fig-v1", path, "--key", KEY])
        for index, outcome in enumerate(self.run_many(argvs)):
            fragment = rows[index // 2][1]
            self.assert_refused(outcome, "bad-input", fragment)
            self.assertTrue(outcome.data["error"].startswith("result "), outcome.out)
        self.assertEqual(self.looks_files(), [])
        self.assertFalse(os.path.exists(self.looks()))

    def test_the_scope_guard_judges_a_result_before_the_file_is_opened(self):
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        swim = os.path.join(self.sb.art, "Swimwear outfits", "r.png")           # never made: refused by its words
        named = os.path.join(self.sb.art, "maki_swim.png")
        for path in (swim, named):
            for command in ("beside", "measure"):
                tail = ["--key", KEY] if command == "measure" else []
                outcome = self.run_script([command] + self.inbox_args() + ["fig-v1", path] + tail)
                self.assert_refused(outcome, "bad-input", "scope rule")
                self.assertTrue(outcome.data["error"].startswith("the path %s mentions" % path), outcome.out)
                self.assertIn('mentions "swim"', outcome.data["error"])
                self.assertNotIn("was not found", outcome.data["error"])
        zoomed = self.run_script(["zoom"] + self.inbox_args() + [swim, "0,0,1,1"])
        self.assert_refused(zoomed, "bad-input", "scope rule")
        self.assertFalse(os.path.exists(os.path.dirname(swim)))
        self.assertEqual(self.looks_files(), [])
        # harmless words pass the guard and reach the next check
        harmless = self.run_script(["zoom"] + self.inbox_args() + [os.path.join(self.sb.art, "consent forms", "a.png"),
                                                                    "0,0,1,1"])
        self.assert_refused(harmless, "bad-input", "was not found")

    def test_the_scope_guard_judges_the_real_path_of_a_link_too(self):
        # the path as written and the real path are both judged: a harmless name that leads into a restricted
        # folder, and a restricted name that leads to a harmless file
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        hidden = self.sb.write_file(os.path.join(self.sb.art, "Swimwear outfits", "x.png"), figure())
        harmless = self.art_file("harmless.png", figure())
        innocent = os.path.join(self.sb.art, "innocent.png")
        named = os.path.join(self.sb.art, "swimlink.png")
        os.symlink(hidden, innocent)
        os.symlink(harmless, named)
        starts = [("the real path %s mentions" % hidden), ("the path %s mentions" % named)]
        argvs = []
        for path in (innocent, named):
            argvs.append(["zoom"] + self.inbox_args() + [path, "0,0,1,1"])
            argvs.append(["beside"] + self.inbox_args() + ["fig-v1", path])
            argvs.append(["measure"] + self.inbox_args() + ["fig-v1", path, "--key", KEY])
        for index, outcome in enumerate(self.run_many(argvs)):
            self.assert_refused(outcome, "bad-input", "scope rule")
            self.assertTrue(outcome.data["error"].startswith(starts[index // 3]), outcome.out)
            self.assertIn('mentions "swim"', outcome.data["error"])
            self.assertNotIn("was not found", outcome.data["error"])
        self.assertFalse(os.path.exists(self.looks()), "something was written by a refused call")

    def test_a_home_folder_named_like_a_scope_word_does_not_trip_the_guard(self):
        beach_home = os.path.join(self.sb.root, "x", "beach")
        os.makedirs(os.path.join(beach_home, "Desktop", "JJKgame.md"))
        inbox = os.path.join(beach_home, "Desktop", "art inbox")
        picture = self.sb.write_file(os.path.join(beach_home, "Desktop", "JJKgame.md", "a.png"), figure())
        env = {"DESK_ART_HOME": beach_home, "DESK_ART_INBOX": inbox,
               "DESK_ART_CACHE": os.path.join(beach_home, "Library", "Caches", "desk-art")}
        result = self.run_script(["zoom", picture, "0,0,1,1"], env=env)
        self.assertEqual(result.code, 0, result.out)

    def test_ref_root_only_narrows(self):
        picture = figure()
        art = self.art_file("a.png", picture)
        other = self.sb.write_file(os.path.join(self.sb.home, "Desktop", "JJK Game images", "b.png"), picture)
        docs_folder = os.path.join(self.sb.home, "Documents")
        docs = self.sb.write_file(os.path.join(docs_folder, "c.png"), picture)
        sub = self.sb.write_file(os.path.join(self.sb.art, "sub", "s.png"), picture)
        filed = self.sb.write_file(os.path.join(self.sb.inbox, "2026-11-09", "f.png"), picture)
        os.makedirs(self.looks())
        cached = self.sb.write_file(os.path.join(self.looks(), "k-sheet-20261109T120000-ab12.png"), picture)
        refused = "is not in a folder desk-art may send from"

        def zoom(path, *roots):
            argv = ["zoom"] + self.inbox_args()
            for root in roots:
                argv += ["--ref-root", root]
            return self.run_script(argv + [path, "0,0,1,1"])

        # (a) no --ref-root: the standard folders, the inbox and the cache; a folder outside them is refused
        for path in (art, other, filed, cached):
            self.assertEqual(zoom(path).code, 0, path)
        self.assert_refused(zoom(docs), "bad-input", refused)
        self.assertNotIn("ignoredRoots", zoom(art).data)
        # (b) one standard folder: only that one, plus the inbox and the cache
        self.assertEqual(zoom(art, self.sb.art).code, 0)
        self.assert_refused(zoom(other, self.sb.art), "bad-input", refused)
        for path in (filed, cached):
            self.assertEqual(zoom(path, self.sb.art).code, 0, path)
        # (c) a folder inside a standard folder narrows further
        self.assertEqual(zoom(sub, os.path.join(self.sb.art, "sub")).code, 0)
        self.assert_refused(zoom(art, os.path.join(self.sb.art, "sub")), "bad-input", refused)
        # (d) a folder that is not in the standard ones is ignored and named, and the standard folders are no fallback
        outcome = zoom(filed, docs_folder)
        self.assertEqual(outcome.code, 0, outcome.out)
        self.assertEqual(outcome.data["ignoredRoots"], [docs_folder])
        self.assert_refused(zoom(art, docs_folder), "bad-input", refused)
        self.assert_refused(zoom(docs, docs_folder), "bad-input", refused)
        # (e) one that counts and one that is ignored: the counted one works
        outcome = zoom(art, docs_folder, self.sb.art)
        self.assertEqual(outcome.code, 0, outcome.out)
        self.assertEqual(outcome.data["ignoredRoots"], [docs_folder])
        # (f) the cache as a --ref-root is skipped without a word
        outcome = zoom(cached, self.sb.cache)
        self.assertEqual(outcome.code, 0, outcome.out)
        self.assertNotIn("ignoredRoots", outcome.data)
        self.assert_refused(zoom(art, self.sb.cache), "bad-input", refused)
        # (g) a folder that does not start with / or ~/ is refused
        self.assert_refused(zoom(art, "relative/path"), "bad-input", "--ref-root must be a folder path")
        # (h) the inbox as a --ref-root counts and is not ignored
        outcome = zoom(filed, self.sb.inbox)
        self.assertEqual(outcome.code, 0, outcome.out)
        self.assertNotIn("ignoredRoots", outcome.data)
        self.assert_refused(zoom(art, self.sb.inbox), "bad-input", refused)
        # (i) a ~/ folder is read against the home folder
        self.assertEqual(zoom(art, "~/Desktop/JJKgame.md").code, 0)
        # (j) beside and measure narrow the result in the same way, and name what they ignored
        self.make_set("fig-v1", [{"role": "identity", "png": picture}])
        argv = ["beside"] + self.inbox_args() + ["--ref-root", self.sb.art, "fig-v1", other]
        self.assert_refused(self.run_script(argv), "bad-input", refused)
        argv = ["measure"] + self.inbox_args() + ["--ref-root", docs_folder, "--ref-root", self.sb.art, "fig-v1", art,
                                                  "--key", KEY]
        outcome = self.run_script(argv)
        self.assertEqual(outcome.code, 0, outcome.out)
        self.assertEqual(outcome.data["ignoredRoots"], [docs_folder])
        argv = ["beside"] + self.inbox_args() + ["--ref-root", docs_folder, "--ref-root", self.sb.art, "fig-v1", art]
        outcome = self.run_script(argv)
        self.assertEqual(outcome.data["ignoredRoots"], [docs_folder])

    def test_zoom_refusals_and_nothing_else_changes(self):
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        docs = self.sb.write_file(os.path.join(self.sb.home, "Documents", "r.png"), figure())
        secret = self.art_file("auth.json", figure())
        words = self.art_file("x.png", b"this is not a picture")
        os.makedirs(os.path.join(self.sb.art, "dir.png"))
        header = struct.pack(">IIBBBBB", 8200, 5000, 8, 2, 0, 0, 0)               # a 41-megapixel header
        big = (b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR" + header
               + struct.pack(">I", zlib.crc32(b"IHDR" + header) & 0xFFFFFFFF))
        huge = self.art_file("huge.png", big + b"\x00" * 40)
        rows = [(docs, "is not in a folder desk-art may send from"),
                (secret, "looks like a secrets or sign-in file"),
                (words, "is not a PNG, JPEG or WEBP picture"),
                (os.path.join(self.sb.art, "dir.png"), "is not a regular file"),
                (huge, "41 megapixels"),
                (os.path.join(self.sb.art, "Swimwear outfits", "r.png"), "scope rule")]
        before = self.tree()
        outcomes = self.run_many([["zoom"] + self.inbox_args() + [path, "0,0,1,1"] for path, _ in rows])
        for outcome, (path, fragment) in zip(outcomes, rows):
            self.assert_refused(outcome, "bad-input", fragment)
            self.assertTrue(outcome.data["error"].startswith(("picture ", "the path ")), outcome.out)
        self.assertEqual(self.tree(), before)
        # two calls make two different files, and nothing else changes
        good = self.art_file("ok.png", figure())
        before = self.tree()
        first = self.run_script(["zoom"] + self.inbox_args() + [good, "0,0,1,1"])
        second = self.run_script(["zoom"] + self.inbox_args() + [good, "0,0,1,1"])
        self.assertNotEqual(first.data["file"], second.data["file"])
        self.assertEqual(len(self.looks_files()), 2)
        self.assert_only_looks_added(before, self.tree())

    def test_a_picture_with_a_very_long_side_is_refused_before_it_is_resized(self):
        # a thin picture is far under the 40 megapixel limit, but resizing it takes a table that grows with its long
        # side (gigabytes for 40 million pixels in a row), so a side is held to the 20000 px of a set's own pictures
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        tall = self.art_file("tall.png", png_rgb(1, 20001, (10, 20, 30)))
        wide = self.art_file("wide.png", png_rgb(20001, 1, (10, 20, 30)))
        argvs = []
        for path in (tall, wide):
            argvs.append(["zoom"] + self.inbox_args() + [path, "0,0,1,1"])
            argvs.append(["beside"] + self.inbox_args() + ["fig-v1", path])
            argvs.append(["measure"] + self.inbox_args() + ["fig-v1", path, "--key", KEY])
        for index, outcome in enumerate(self.run_many(argvs)):
            path = (tall, wide)[index // 3]
            what = "picture" if index % 3 == 0 else "result"
            self.assert_refused(outcome, "bad-input")
            self.assertEqual(outcome.data["error"], "%s %s has a side of 20001 pixels, and the limit is 20000"
                             % (what, path), outcome.out)
        self.assertFalse(os.path.exists(self.looks()), "something was written by a refused call")
        # it is refused when the picture is read, before the set is even looked for (the header says the size)
        for command in ("beside", "measure"):
            outcome = self.run_script([command] + self.inbox_args() + ["nothere-v1", tall]
                                      + (["--key", KEY] if command == "measure" else []))
            self.assert_refused(outcome, "bad-input", "result %s has a side of 20001 pixels" % tall)
        # a side of exactly 20000 px is still looked at (the other side is one pixel)
        tall = self.art_file("tall.png", png_rgb(1, 20000, (10, 20, 30)))
        wide = self.art_file("wide.png", png_rgb(20000, 1, (10, 20, 30)))
        outcomes = self.run_many([["zoom"] + self.inbox_args() + [tall, "0,0,1,1"],
                                  ["zoom"] + self.inbox_args() + [wide, "0,0,1,1"],
                                  ["beside"] + self.inbox_args() + ["fig-v1", tall]])
        for outcome in outcomes:
            self.assertEqual(outcome.code, 0, outcome.out)
        self.assertEqual([outcomes[0].data["size"], outcomes[1].data["size"]], [[1, 720], [4096, 1]])

    def test_a_picture_of_a_set_with_a_very_long_side_is_damaged(self):
        # the card rules stop a builder's set at 20000 px, and a hand-made card without sizes is stopped here
        picture = self.art_file("r.png", figure())
        self.make_set("long-v1", [{"role": "identity", "png": png_rgb(1, 20001, (10, 20, 30))}],
                      card_edit=without_sizes)
        argvs = [["sheet"] + self.inbox_args() + ["long-v1"], ["beside"] + self.inbox_args() + ["long-v1", picture],
                 ["measure"] + self.inbox_args() + ["long-v1", picture, "--key", KEY]]
        for outcome in self.run_many(argvs):
            self.assert_refused(outcome, "set-damaged", "picture 1 (identity) cannot be read as a picture")
        self.assertFalse(os.path.exists(self.looks()))

    def test_a_16_bit_grey_picture_with_a_transparent_colour_is_refused(self):
        # one 16-bit value cannot be made see-through in 8 bits, and a wrong picture is worse than none (the set
        # builder refuses such a picture too); the same picture without the transparent colour is drawn
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        keyed = self.art_file("keyed16.png", grey16_blocks([0, 32768, 40000, 65535], key=40000))
        argvs = [["zoom"] + self.inbox_args() + [keyed, "0,0,1,1"], ["beside"] + self.inbox_args() + ["fig-v1", keyed],
                 ["measure"] + self.inbox_args() + ["fig-v1", keyed, "--key", KEY]]
        words = ("is a 16-bit grey picture with a transparent colour, which cannot be used: save it as an ordinary "
                 "8-bit PNG first")
        for index, outcome in enumerate(self.run_many(argvs)):
            self.assert_refused(outcome, "bad-input")
            self.assertEqual(outcome.data["error"], "%s %s %s" % ("picture" if index == 0 else "result", keyed, words))
        self.assertFalse(os.path.exists(self.looks()), "something was written by a refused call")
        self.make_set("keyed-v1", [{"role": "identity", "png": grey16_blocks([0, 32768, 40000, 65535], key=40000)}])
        outcome = self.run_script(["sheet"] + self.inbox_args() + ["keyed-v1"])
        self.assert_refused(outcome, "set-damaged", "picture 1 (identity) cannot be read as a picture")
        plain = self.art_file("plain16.png", grey16_blocks([0, 32768, 40000, 65535]))
        outcome = self.run_script(["zoom"] + self.inbox_args() + [plain, "0,0,1,1"])
        self.assertEqual(outcome.code, 0, outcome.out)

    def test_non_finite_numbers_are_refused(self):
        picture = self.art_file("r.png", figure())
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        bad = ["nan", "NaN", "inf", "-inf", "infinity", "-0.1", "+0.5", "1e-1", "1e0", "1_0", ".5", "5.", "0x1",
               "1.2", "2", "0.5.0", "", " 0.5", "0.5 ", "0.5\n", chr(0x662), "9" * 400]
        zoom_argvs, zoom_rows, beside_argvs, skip_argvs = [], [], [], []
        for value in bad:
            for region in ("%s,0,1,1" % value, "0,0,1,%s" % value):
                zoom_rows.append(region)
                zoom_argvs.append(["zoom"] + self.inbox_args() + [picture, region])
                beside_argvs.append(["beside"] + self.inbox_args() + ["fig-v1", picture, "--zoom", region])
                beside_argvs.append(["beside"] + self.inbox_args() + ["fig-v1", picture, "--zoom=" + region])
            skip_argvs.append(["measure"] + self.inbox_args() + ["fig-v1", picture, "--key", KEY, "--skip-top", value])
            skip_argvs.append(["measure"] + self.inbox_args()
                              + ["fig-v1", picture, "--key", KEY, "--skip-top=" + value])
        for outcome, region in zip(self.run_many(zoom_argvs), zoom_rows):
            if region.startswith("-"):
                # a positional value that starts with a dash cannot be glued to a flag: a usage refusal
                self.assertEqual((outcome.code, outcome.data["code"]), (3, "usage"), (region, outcome.out))
            else:
                self.assert_refused(outcome, "bad-input", "the region must be four plain numbers")
        for outcome in self.run_many(beside_argvs):
            self.assert_refused(outcome, "bad-input", "--zoom must be four plain numbers")
        for outcome in self.run_many(skip_argvs):
            self.assert_refused(outcome, "bad-input", "--skip-top must be a plain number from 0 to 0.5")
        # a region of the wrong shape, a side that is too short, and a reversed region
        shapes = ["0,0,1", "0,0,1,1,1", "", "a,b,c,d", "0.5,0,0.4,1", "0,0.5,1,0.4", "0,0,0.04,1", "0,0,1,0.04",
                  "0.5,0,0.5,1", "0,0,0,1", "1,0,1,1", "0, 0,1,1", "0,0,1,1 ", "1.2,0,2,1"]
        for outcome in self.run_many([["zoom"] + self.inbox_args() + [picture, region] for region in shapes]):
            self.assert_refused(outcome, "bad-input", "the region must be four plain numbers")
        beside_shapes = []
        for region in shapes:                                                   # beside --zoom, in both spellings
            beside_shapes.append(["beside"] + self.inbox_args() + ["fig-v1", picture, "--zoom", region])
            beside_shapes.append(["beside"] + self.inbox_args() + ["fig-v1", picture, "--zoom=" + region])
        for outcome in self.run_many(beside_shapes):
            self.assert_refused(outcome, "bad-input", "--zoom must be four plain numbers")
        self.assertFalse(os.path.exists(self.looks()), "something was written by a refused call")
        # values right next to the limits are accepted: a side of 0.05 (also 0.15 - 0.10 in floating point), the
        # whole picture, and a skip of 0 and of 0.5
        good = [["zoom"] + self.inbox_args() + [picture, region]
                for region in ("0,0,0.05,1", "0.1,0,0.15,1", "0,0,1,0.05", "0.95,0.95,1,1", "0,0,1,1", "00.5,0,1,1")]
        good += [["measure"] + self.inbox_args() + ["fig-v1", picture, "--key", KEY, "--skip-top", value]
                 for value in ("0", "0.0", "0.5", "0.25")]
        good += [["beside"] + self.inbox_args() + ["fig-v1", picture, "--zoom", "0.1,0,0.15,1"]]
        for outcome in self.run_many(good):
            self.assertEqual(outcome.code, 0, outcome.out)

    def test_the_key_is_a_hash_sign_and_six_hex_digits(self):
        picture = self.art_file("r.png", figure())
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        bad = ["#FFF", "magenta", "FF00FF", "#GG00FF", "#FF00FF ", " #FF00FF", "#FF00FFF", "-x", "-#FF00FF", "", "#",
               "#FF00F\n", "#" + chr(0xFF) * 6]
        argvs = []
        for key in bad:
            argvs.append(["measure"] + self.inbox_args() + ["fig-v1", picture, "--key", key])
            argvs.append(["measure"] + self.inbox_args() + ["fig-v1", picture, "--key=" + key])
        for outcome in self.run_many(argvs):
            self.assert_refused(outcome, "bad-input", "--key must look like #FF00FF")
        for key in ("#FF00FF", "#ff00ff", "#Ff00fF"):
            outcome = self.run_script(["measure"] + self.inbox_args() + ["fig-v1", picture, "--key", key])
            self.assertEqual(outcome.code, 0, outcome.out)
            self.assertEqual([item["key"] for item in outcome.data["checks"] if item["name"] == "backdrop"], [KEY])

    def test_a_damaged_set_is_refused(self):
        folder = self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        picture = self.art_file("r.png", figure())
        with open(os.path.join(folder, "01_identity.png"), "wb") as handle:        # changed after it was saved
            handle.write(figure(bands=((1, 2, 3), (4, 5, 6), (7, 8, 9))))
        for argv in (["sheet", "fig-v1"], ["beside", "fig-v1", picture], ["measure", "fig-v1", picture, "--key", KEY]):
            outcome = self.run_script([argv[0]] + self.inbox_args() + argv[1:])
            self.assert_refused(outcome, "set-damaged",
                                "picture 1 (identity) is not the picture that was saved (saved ")
            self.assertIn("Do not use this set; save a new version.", outcome.data["error"])
        self.assertFalse(os.path.exists(self.looks()))
        # every picture of the set is checked, also the ones that are not drawn (beside shows only the first)
        folder = self.make_set("pair-v1", [{"role": "identity", "png": figure()},
                                           {"role": "style", "png": png_rgb(64, 64, (120, 130, 140))}])
        with open(os.path.join(folder, "02_style.png"), "wb") as handle:
            handle.write(png_rgb(64, 64, (121, 130, 140)))
        for argv in (["sheet", "pair-v1"], ["beside", "pair-v1", picture],
                     ["measure", "pair-v1", picture, "--key", KEY]):
            outcome = self.run_script([argv[0]] + self.inbox_args() + argv[1:])
            self.assert_refused(outcome, "set-damaged",
                                "picture 2 (style) is not the picture that was saved (saved ")
            self.assertRegex(outcome.data["error"], r"saved [0-9a-f]{8}, found [0-9a-f]{8}\)")
        # zoom reads no set: the changed picture is still a picture it may magnify
        again = self.run_script(["zoom"] + self.inbox_args() + [os.path.join(folder, "01_identity.png"), "0,0,1,1"])
        self.assertEqual(again.code, 0, again.out)
        # a set that is not saved says so and names the sets that are
        for argv in (["sheet", "nothere-v1"], ["beside", "nothere-v1", picture],
                     ["measure", "nothere-v1", picture, "--key", KEY]):
            outcome = self.run_script([argv[0]] + self.inbox_args() + argv[1:])
            self.assert_refused(outcome, "set-not-found", "anchor set nothere-v1 was not found in ")
            self.assertEqual(outcome.data["hint"], "Saved sets: fig-v1, pair-v1.")
        # a bad name is a plain refusal
        outcome = self.run_script(["sheet"] + self.inbox_args() + ["Bad Name"])
        self.assert_refused(outcome, "bad-input", "anchor must be the name of a saved anchor set")

    def test_an_empty_inbox_says_that_no_set_is_saved(self):
        outcome = self.run_script(["sheet"] + self.inbox_args() + ["nothere-v1"])
        self.assert_refused(outcome, "set-not-found")
        self.assertEqual(outcome.data["hint"], "No anchor sets are saved yet. Save one with the desk-art:anchor skill.")
        self.assertFalse(os.path.exists(self.sb.inbox))                              # nothing is made to look

    def test_a_set_that_cannot_be_used_is_damaged_and_a_link_is_unsafe(self):
        picture = self.art_file("r.png", figure())
        folder = self.make_set("nocard-v1", [{"role": "identity", "png": figure()}])
        os.remove(os.path.join(folder, "anchor.json"))
        outcome = self.run_script(["sheet"] + self.inbox_args() + ["nocard-v1"])
        self.assert_refused(outcome, "set-damaged", "has no anchor.json")
        folder = self.make_set("badcard-v1", [{"role": "identity", "png": figure()}],
                               card_edit=lambda card: b"{ not json")
        outcome = self.run_script(["beside"] + self.inbox_args() + ["badcard-v1", picture])
        self.assert_refused(outcome, "set-damaged", "anchor.json is not usable")
        # a member that fits its fingerprint but is not a picture
        self.make_set("notpic-v1", [{"role": "identity", "png": b"this is not a picture at all"}])
        outcome = self.run_script(["sheet"] + self.inbox_args() + ["notpic-v1"])
        self.assert_refused(outcome, "set-damaged", "picture 1 (identity) cannot be read as a picture")
        # a set folder that is a link leading elsewhere
        real = self.make_set("real-v1", [{"role": "identity", "png": figure()}])
        os.symlink(real, os.path.join(self.sb.inbox, "anchors", "link-v1"))
        outcome = self.run_script(["sheet"] + self.inbox_args() + ["link-v1"])
        self.assert_refused(outcome, "inbox-unsafe", "is a link that leads elsewhere")
        # the inbox rule: a folder that is not the default inbox needs the notes file
        elsewhere = os.path.join(self.sb.home, "Desktop", "not-an-inbox")
        os.makedirs(elsewhere)
        outcome = self.run_script(["sheet", "--inbox", elsewhere, "real-v1"])
        self.assert_refused(outcome, "inbox-unsafe", "not the art inbox")
        outcome = self.run_script(["sheet", "--inbox", "/etc", "real-v1"])
        self.assert_refused(outcome, "inbox-unsafe")
        outcome = self.run_script(["sheet", "--inbox", elsewhere + "-x/../not-an-inbox", "real-v1"])
        self.assert_refused(outcome, "inbox-unsafe", "not the art inbox")
        self.sb.write_file(os.path.join(elsewhere, "manifest.jsonl"), b"")
        outcome = self.run_script(["sheet", "--inbox", elsewhere, "real-v1"])
        self.assert_refused(outcome, "set-not-found")

    def test_a_refusal_about_a_set_does_not_say_that_nothing_was_sent(self):
        # these commands only look: the helper's sentence "Nothing was sent." (it is true of a call that could send)
        # is left off every refusal about a set, the way the set builder leaves it off
        picture = self.art_file("r.png", figure())
        anchors = os.path.join(self.sb.inbox, "anchors")
        folder = self.make_set("nocard-v1", [{"role": "identity", "png": figure()}])
        os.remove(os.path.join(folder, "anchor.json"))
        self.make_set("badcard-v1", [{"role": "identity", "png": figure()}], card_edit=lambda card: b"{ not json")
        folder = self.make_set("gone-v1", [{"role": "identity", "png": figure()}])
        os.remove(os.path.join(folder, "01_identity.png"))
        real = self.make_set("real-v1", [{"role": "identity", "png": figure()}])
        os.symlink(real, os.path.join(anchors, "link-v1"))
        rows = [("nothere-v1", "set-not-found", "anchor set nothere-v1 was not found in %s" % anchors),
                ("nocard-v1", "set-damaged", "anchor set nocard-v1 has no anchor.json, so it is not a finished set."),
                ("badcard-v1", "set-damaged", "anchor set badcard-v1: anchor.json is not usable: it is damaged "
                                              "(it cannot be read as a card)."),
                ("gone-v1", "set-damaged", "anchor set gone-v1: picture 1 (identity) is missing or is not a plain "
                                           "picture file."),
                ("link-v1", "inbox-unsafe", "anchor set link-v1 is a link that leads elsewhere, so it was not used.")]
        argvs = []
        for name, _, _ in rows:
            argvs.append(["sheet"] + self.inbox_args() + [name])
            argvs.append(["beside"] + self.inbox_args() + [name, picture])
            argvs.append(["measure"] + self.inbox_args() + [name, picture, "--key", KEY])
        for index, outcome in enumerate(self.run_many(argvs)):
            _, code, words = rows[index // 3]
            self.assert_refused(outcome, code)
            self.assertEqual(outcome.data["error"], words, outcome.out)
            self.assertNotIn("Nothing was sent", outcome.out)
            self.assertIn("hint", outcome.data)                                # the helper's advice is kept
        self.assertFalse(os.path.exists(self.looks()))

    def test_only_measure_needs_numpy(self):
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        picture = self.art_file("r.png", figure())
        base = self.inbox_args()
        outcomes = self.run_many([["sheet"] + base + ["fig-v1"], ["beside"] + base + ["fig-v1", picture],
                                  ["zoom"] + base + [picture, "0,0,1,1"],
                                  ["measure"] + base + ["fig-v1", picture, "--key", KEY]], driver=NO_NUMPY_DRIVER)
        for outcome in outcomes[:3]:
            self.assertTrue(outcome.data["ok"], outcome.out)
        self.assert_refused(outcomes[3], "needs-pillow", "ComfyUI")
        self.assertNotIn("hint", outcomes[3].data)

    def test_usage_errors_help_and_exit_codes(self):
        for argv in ([], ["frobnicate"], ["sheet"], ["sheet", "a-v1", "b-v1"], ["zoom", "x"], ["beside", "a-v1"],
                     ["measure", "a-v1"], ["sheet", "a-v1", "--force"], ["sheet", "a-v1", "--also-allow", "x"],
                     ["sheet", "a-v1", "--inb", "x"], ["zoom", "x", "0,0,1,1", "--key", KEY],
                     ["sheet", "a-v1", "--ref-root", "/x"], ["beside", "a-v1", "r", "--key", KEY],
                     ["measure", "a-v1", "r", "--zoom", "0,0,1,1"]):
            outcome = self.run_script(argv)
            self.assertEqual((outcome.code, outcome.data["code"]), (3, "usage"), (argv, outcome.out))
            self.assertIn("usage", outcome.data)
        outcome = self.run_script(["--help"])
        self.assertEqual((outcome.code, outcome.data["ok"], outcome.data["command"]), (0, True, None))
        self.assertIn("help", outcome.data)
        for command in ("sheet", "beside", "zoom", "measure"):
            outcome = self.run_script([command, "--help"])
            self.assertEqual((outcome.code, outcome.data["ok"], outcome.data["command"]), (0, True, command))
            self.assertIn("--inbox", outcome.data["help"])
        self.assertIn("--zoom", self.run_script(["beside", "--help"]).data["help"])
        self.assertIn("--skip-top", self.run_script(["measure", "--help"]).data["help"])
        self.assertNotIn("--ref-root", self.run_script(["sheet", "--help"]).data["help"])
        # a value that starts with a dash is glued to its flag, so it is a bad value and not a usage error
        outcome = self.run_script(["sheet", "--inbox", "-x", "a-v1"])
        self.assertEqual(outcome.code, 2, outcome.out)
        self.assertEqual(outcome.data["code"], "inbox-unsafe")

    def test_needs_pillow_message(self):
        picture = self.art_file("r.png", figure())
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        argvs = (["sheet", "fig-v1"], ["beside", "fig-v1", picture], ["zoom", picture, "0,0,1,1"],
                 ["measure", "fig-v1", picture, "--key", KEY])
        for argv in argvs:
            # the Python it names is the one that was asked for (the tests were given it, so this does not depend on
            # where ComfyUI is on this Mac)
            outcome = self.run_script([argv[0]] + self.inbox_args() + argv[1:], python=PLAIN_PYTHON,
                                      env={"JJK_ART_PYTHON": PIL_PYTHON})
            self.assert_refused(outcome, "needs-pillow", "ComfyUI")
            self.assertNotIn("hint", outcome.data)
            self.assertIn('Run it with ComfyUI\'s Python: "%s" -I -B ' % PIL_PYTHON, outcome.data["error"])
            self.assertRegex(outcome.data["error"], r"anchor_look\.py\"? %s \.\.\." % argv[0])
        self.assertFalse(os.path.exists(self.looks()))
        # when ComfyUI's Python cannot be found the message says so and that nothing was installed
        fake_home = self.sb.make_dir("fakehome")
        outcome = self.run_script(["sheet"] + self.inbox_args() + ["fig-v1"], python=PLAIN_PYTHON,
                                  env={"HOME": fake_home, "JJK_ART_PYTHON": "", "JJK_COMFY_ROOT": ""})
        self.assert_refused(outcome, "needs-pillow", "ComfyUI's Python was not found")
        self.assertIn("Nothing was installed.", outcome.data["error"])
        # the sentence is said once, and reads as one (the set script says exactly the same words)
        self.assertEqual(outcome.data["error"].count("ComfyUI's Python was not found"), 1)
        self.assertEqual(outcome.data["error"],
                         "This command needs the picture tools that come with ComfyUI's Python, which this Python does "
                         "not have. ComfyUI's Python was not found under %s. Nothing was installed. Ask the owner "
                         "where ComfyUI is installed, or set JJK_ART_PYTHON to its Python."
                         % os.path.join(fake_home, "ComfyUI-Installs"))
        outcome = self.run_script(["sheet"] + self.inbox_args() + ["fig-v1"], python=PLAIN_PYTHON,
                                  env={"JJK_ART_PYTHON": "/nonexistent/python"})
        self.assert_refused(outcome, "needs-pillow", "JJK_ART_PYTHON is set to /nonexistent/python")
        # help and usage errors do not need Pillow
        self.assertEqual(self.run_script(["--help"], python=PLAIN_PYTHON).code, 0)
        self.assertEqual(self.run_script(["sheet"], python=PLAIN_PYTHON).code, 3)


# ---------------------------------------------------------------------------
# measure: numbers only
# ---------------------------------------------------------------------------

@NEEDS_PILLOW
class MeasureTests(LookCase):
    def measure(self, name, path, *extra):
        return self.run_script(["measure"] + self.inbox_args() + [name, path] + list(extra))

    def check(self, outcome, name):
        self.assertEqual(outcome.code, 0, outcome.out)
        found = [item for item in outcome.data["checks"] if item["name"] == name]
        self.assertEqual(len(found), 1, outcome.out)
        return found[0]

    def test_measure_backdrop(self):
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        same = self.art_file("same.png", figure())
        outcome = self.measure("fig-v1", same, "--key", KEY)
        self.assertEqual(outcome.code, 0, outcome.out)
        self.assertEqual(list(outcome.data), ["ok", "command", "set", "result", "checks", "skipped", "note"])
        self.assertEqual(outcome.data["set"], "fig-v1")
        self.assertEqual(outcome.data["result"], {"path": same, "size": [128, 256]})
        backdrop = self.check(outcome, "backdrop")
        self.assertEqual(list(backdrop), ["name", "key", "corners", "max"])
        self.assertEqual(backdrop, {"name": "backdrop", "key": KEY, "corners": [0.0, 0.0, 0.0, 0.0], "max": 0.0})
        self.assertEqual([item["name"] for item in outcome.data["checks"]], ["backdrop", "colour"])
        self.assertEqual(outcome.data["skipped"], [])
        # a backdrop that is five steps of red away from the key colour in every corner (the key may be written in
        # lower case on the command line; the answer repeats it in capitals)
        near = self.art_file("near.png", figure(key=(250, 0, 255)))
        backdrop = self.check(self.measure("fig-v1", near, "--key", "#ff00ff"), "backdrop")
        self.assertEqual(backdrop["key"], KEY)
        self.assertEqual(backdrop["corners"], [5.0, 5.0, 5.0, 5.0])
        self.assertEqual(backdrop["max"], 5.0)

        def one_corner(x, y):
            if 8 <= x < 32 and 8 <= y < 32:
                return (205, 0, 255)                        # 50 away from the key, so it is not part of the figure
            return MAGENTA if not (38 <= x < 90 and 26 <= y < 230) else (200, 30, 30)

        corner = self.art_file("corner.png", png_rgb(128, 256, one_corner))
        backdrop = self.check(self.measure("fig-v1", corner, "--key", KEY), "backdrop")
        self.assertEqual(backdrop["corners"], [50.0, 0.0, 0.0, 0.0])
        self.assertEqual(backdrop["max"], 50.0)
        tiny = self.art_file("tiny.png", png_rgb(31, 64, MAGENTA))
        self.assert_refused(self.measure("fig-v1", tiny, "--key", KEY), "bad-input", "smaller than 32 px")

    def test_measure_colour_finds_a_recoloured_part(self):
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        yellow = (200, 200, 30)
        recoloured = self.art_file("last.png", figure(bands=(BANDS[0], BANDS[1], yellow)))
        outcome = self.measure("fig-v1", recoloured, "--key", KEY)
        colour = self.check(outcome, "colour")
        self.assertEqual(list(colour), ["name", "against", "cells_used", "median", "p90", "worst"])
        self.assertEqual(colour["against"], "01_identity.png")
        self.assertEqual(colour["cells_used"], 32)
        self.assertEqual(len(colour["worst"]), 3)
        self.assertGreaterEqual(colour["worst"][0]["row"], 5)
        expected = lab_distance(BANDS[2], yellow)
        self.assertAlmostEqual(colour["worst"][0]["de"], expected, delta=0.2)
        # four cells tie in every row of the last band: the three that are listed are the first in reading order
        self.assertEqual([(item["row"], item["col"]) for item in colour["worst"]], [(6, 0), (6, 1), (6, 2)])
        for item in colour["worst"]:
            self.assertEqual(list(item), ["row", "col", "part", "de"])
            self.assertEqual(item["part"], PARTS[item["row"]])
        self.assertEqual([item["de"] for item in colour["worst"]], sorted((item["de"] for item in colour["worst"]),
                                                                          reverse=True))
        self.assertGreater(colour["p90"], 0.0)
        self.assertGreater(colour["p90"], colour["median"])
        # the same picture: no difference at all
        same = self.art_file("same.png", figure())
        colour = self.check(self.measure("fig-v1", same, "--key", KEY), "colour")
        self.assertEqual((colour["median"], colour["p90"]), (0.0, 0.0))
        self.assertEqual([item["de"] for item in colour["worst"]], [0.0, 0.0, 0.0])
        # a change in the top band only: --skip-top 0.5 leaves the top half out, so it is not seen
        head = self.art_file("head.png", figure(bands=(yellow, BANDS[1], BANDS[2])))
        seen = self.check(self.measure("fig-v1", head, "--key", KEY), "colour")
        self.assertLessEqual(seen["worst"][0]["row"], 2)
        self.assertGreater(seen["worst"][0]["de"], 50.0)
        skipped = self.check(self.measure("fig-v1", head, "--key", KEY, "--skip-top", "0.5"), "colour")
        self.assertEqual((skipped["median"], skipped["p90"]), (0.0, 0.0))
        self.assertEqual(skipped["worst"][0]["de"], 0.0)
        # a result that is all backdrop has no figure
        empty = self.art_file("empty.png", png_rgb(128, 256, MAGENTA))
        self.assert_refused(self.measure("fig-v1", empty, "--key", KEY), "bad-input", "no figure was found")
        # a picture with a figure of a different size is compared part by part (a grid of 4 by 8 over the figure)
        small = self.art_file("small.png", figure(width=64, height=128))
        colour = self.check(self.measure("fig-v1", small, "--key", KEY), "colour")
        self.assertEqual(colour["cells_used"], 32)
        self.assertEqual(colour["median"], 0.0)
        self.assertLess(colour["worst"][0]["de"], 10.0)         # only a cell between two bands differs, a little

    def test_the_colour_distance_is_the_lab_distance_of_the_cell_colours(self):
        # a figure of one colour on both sides: the distance is that of the two colours, wherever the cells are
        self.make_set("fig-v1", [{"role": "identity", "png": figure(bands=((120, 60, 30),) * 3)}])
        for colour in ((120, 60, 30), (121, 60, 30), (90, 90, 90), (250, 250, 20)):
            path = self.art_file("c.png", figure(bands=(colour,) * 3))
            found = self.check(self.measure("fig-v1", path, "--key", KEY), "colour")
            expected = lab_distance((120, 60, 30), colour)
            self.assertAlmostEqual(found["median"], expected, delta=0.1)
            self.assertAlmostEqual(found["p90"], expected, delta=0.1)
            self.assertAlmostEqual(found["worst"][0]["de"], expected, delta=0.1)

    def test_measure_scene(self):
        def flat_set(name, members):
            self.make_set(name, [{"role": role, "png": png_rgb(160, 90, colour)} for role, colour in members])
            return name

        result_colour = (50, 150, 200)
        result = self.art_file("scene.png", png_rgb(160, 90, result_colour))
        style_a, style_b = (200, 100, 0), (100, 50, 25)
        place, light, room = (90, 120, 60), (240, 180, 90), (60, 60, 160)

        def near(value, expected):
            self.assertAlmostEqual(value[0], expected[0], delta=0.006)
            self.assertAlmostEqual(value[1], expected[1], delta=0.006)

        # two style pictures: the reference is their mean
        outcome = self.measure(flat_set("styles-v1", [("style", style_a), ("style", style_b)]), result)
        scene = self.check(outcome, "scene")
        self.assertEqual(list(scene), ["name", "result", "members", "reference", "delta"])
        near((scene["result"]["saturation"], scene["result"]["brightness"]), saturation_brightness(result_colour))
        self.assertEqual([(item["n"], item["role"]) for item in scene["members"]], [(1, "style"), (2, "style")])
        near((scene["members"][0]["saturation"], scene["members"][0]["brightness"]), saturation_brightness(style_a))
        near((scene["members"][1]["saturation"], scene["members"][1]["brightness"]), saturation_brightness(style_b))
        mean = [(a + b) / 2.0 for a, b in zip(saturation_brightness(style_a), saturation_brightness(style_b))]
        self.assertEqual(scene["reference"]["from"], "style")
        near((scene["reference"]["saturation"], scene["reference"]["brightness"]), mean)
        self.assertEqual(scene["delta"], {"saturation": round(scene["result"]["saturation"]
                                                              - scene["reference"]["saturation"], 3),
                                          "brightness": round(scene["result"]["brightness"]
                                                              - scene["reference"]["brightness"], 3)})
        self.assertEqual([item["name"] for item in outcome.data["checks"]], ["scene"])
        # a place with an hour: the reference is the hour (its light), not the place
        scene = self.check(self.measure(flat_set("hour-v1", [("place", place), ("light", light)]), result), "scene")
        self.assertEqual(scene["reference"]["from"], "light")
        near((scene["reference"]["saturation"], scene["reference"]["brightness"]), saturation_brightness(light))
        self.assertEqual([item["role"] for item in scene["members"]], ["place", "light"])
        # a place and its room: the reference is the place
        scene = self.check(self.measure(flat_set("room-v1", [("place", place), ("room", room)]), result), "scene")
        self.assertEqual(scene["reference"]["from"], "place")
        near((scene["reference"]["saturation"], scene["reference"]["brightness"]), saturation_brightness(place))
        self.assertEqual([item["role"] for item in scene["members"]], ["place", "room"])
        # a style, a place and an hour: the reference is the mean of the style and the hour
        scene = self.check(self.measure(flat_set("all-v1", [("style", style_a), ("place", place), ("light", light)]),
                                        result), "scene")
        self.assertEqual(scene["reference"]["from"], "style")
        mean = [(a + b) / 2.0 for a, b in zip(saturation_brightness(style_a), saturation_brightness(light))]
        near((scene["reference"]["saturation"], scene["reference"]["brightness"]), mean)
        self.assertEqual(len(scene["members"]), 3)

    def test_measure_lineup(self):
        grid = pattern(5)
        width, height = 192, 108
        self.make_set("view-v1", [{"role": "place", "png": png_rgb(width, height, lambda x, y: grid[y][x])}])

        def lineup(name, png):
            path = self.art_file(name, png)
            outcome = self.measure("view-v1", path)
            self.assertEqual(outcome.code, 0, outcome.out)
            self.assertEqual([item["name"] for item in outcome.data["checks"]], ["scene", "lineup"])
            found = self.check(outcome, "lineup")
            self.assertEqual(list(found), ["name", "against", "r"])
            self.assertEqual(found["against"], "01_place.png")
            return found["r"]

        self.assertGreaterEqual(lineup("same.png", png_rgb(width, height, lambda x, y: grid[y][x])), 0.999)
        bigger = png_rgb(2 * width, 2 * height, lambda x, y: grid[y // 2][x // 2])
        self.assertGreaterEqual(lineup("bigger.png", bigger), 0.99)
        self.assertLess(lineup("shifted.png", png_rgb(width, height, lambda x, y: grid[y][(x - 12) % width])), 0.9)
        rng = random.Random(11)
        noise = [[(rng.randrange(256), rng.randrange(256), rng.randrange(256)) for _ in range(width)]
                 for _ in range(height)]
        self.assertLess(lineup("noise.png", png_rgb(width, height, lambda x, y: noise[y][x])), 0.3)
        self.assertEqual(lineup("flat.png", png_rgb(width, height, (90, 90, 90))), 0.0)
        # a result with another shape cannot be lined up
        square = self.art_file("square.png", png_rgb(108, 108, lambda x, y: grid[y][x]))
        outcome = self.measure("view-v1", square)
        self.assert_refused(outcome, "bad-input",
                            "cannot line up: the result is 1.00 wide for every 1 high and the view is 1.78")
        # a shape within 3 percent is accepted
        near_shape = self.art_file("near.png", png_rgb(188, 108, lambda x, y: grid[y][min(x, width - 1)]))
        self.assertEqual(self.measure("view-v1", near_shape).code, 0)

    def test_measure_says_numbers_only(self):
        grid = pattern(9, 320, 180)
        result_png = png_rgb(320, 180, lambda x, y: (200, 30, 30) if 100 <= x < 220 and 20 <= y < 160 else MAGENTA)
        result = self.art_file("r.png", result_png)
        self.make_set("both-v1", [{"role": "identity", "png": figure()},
                                  {"role": "place", "png": png_rgb(160, 90, lambda x, y: grid[y][x])}])
        for extra, ran in (([], ["scene", "lineup"]), (["--key", KEY], ["backdrop", "colour", "scene", "lineup"])):
            outcome = self.measure("both-v1", result, *extra)
            self.assertEqual(outcome.code, 0, outcome.out)
            self.assertEqual([item["name"] for item in outcome.data["checks"]], ran)
            self.assertEqual(outcome.data["note"], MEASURE_NOTE)
            shown = json.loads(outcome.out)
            shown["result"].pop("path")
            shown.pop("set")
            text = json.dumps(shown).lower()
            for word in ("pass", "fail", "verdict", "good", "bad"):
                self.assertNotIn(word, text)
        # without --key the backdrop and the colour are listed as skipped, with the reason, and the rest runs
        outcome = self.measure("both-v1", result)
        self.assertEqual(outcome.data["skipped"], [{"name": "backdrop", "why": NO_KEY_REASON},
                                                   {"name": "colour", "why": NO_KEY_REASON}])
        self.assertEqual(self.measure("both-v1", result, "--key", KEY).data["skipped"], [])
        # a set that is only a figure has nothing to measure without --key: the first reason is the answer
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        outcome = self.measure("fig-v1", self.art_file("same.png", figure()))
        self.assert_refused(outcome, "bad-input")
        self.assertEqual(outcome.data["error"], NO_KEY_REASON)
        # a set with no figure and a --key: backdrop and colour are skipped for that reason, the rest runs
        self.make_set("view-v1", [{"role": "place", "png": png_rgb(160, 90, (100, 100, 100))}])
        outcome = self.measure("view-v1", self.art_file("view.png", png_rgb(160, 90, (110, 100, 90))), "--key", KEY)
        self.assertEqual(outcome.code, 0, outcome.out)
        self.assertEqual(outcome.data["skipped"], [{"name": "backdrop", "why": NO_IDENTITY_REASON},
                                                   {"name": "colour", "why": NO_IDENTITY_REASON}])
        self.assertEqual([item["name"] for item in outcome.data["checks"]], ["scene", "lineup"])

    def test_measure_lays_a_transparent_result_on_the_key_or_on_white(self):
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])

        def figure_on_glass(x, y):
            return (200, 30, 30, 255) if 38 <= x < 90 and 26 <= y < 230 else (0, 0, 0, 0)

        glass = self.art_file("glass.png", png_rgba(128, 256, figure_on_glass))
        outcome = self.measure("fig-v1", glass, "--key", KEY)
        self.assertEqual(outcome.code, 0, outcome.out)
        self.assertIs(outcome.data["result"]["flattened"], True)
        self.assertEqual(self.check(outcome, "backdrop")["corners"], [0.0, 0.0, 0.0, 0.0])
        solid = self.art_file("solid.png", png_rgba(128, 256, (200, 30, 30, 255)))
        outcome = self.measure("fig-v1", solid, "--key", KEY)
        self.assertNotIn("flattened", outcome.data["result"])
        self.make_set("style-v1", [{"role": "style", "png": png_rgb(64, 64, (100, 100, 100))}])
        clear = self.art_file("clear.png", png_rgba(64, 64, (10, 20, 30, 0)))
        outcome = self.measure("style-v1", clear)                    # no key: laid on white
        self.assertIs(outcome.data["result"]["flattened"], True)
        self.assertEqual(self.check(outcome, "scene")["result"], {"saturation": 0.0, "brightness": 1.0})

    def test_measure_works_on_a_big_result_and_a_jpeg(self):
        self.make_set("fig-v1", [{"role": "identity", "png": figure()}])
        jpeg = os.path.join(self.sb.art, "m.jpg")
        os.makedirs(self.sb.art, exist_ok=True)
        code = ("import sys\nfrom PIL import Image, ImageDraw\n"
                "image = Image.new('RGB', (512, 1024), (255, 0, 255))\n"
                "ImageDraw.Draw(image).rectangle((150, 100, 360, 920), fill=(200, 30, 30))\n"
                "image.save(sys.argv[1], format='JPEG', quality=95)\n")
        subprocess.run([PIL_PYTHON, "-I", "-B", "-c", code, jpeg], check=True, timeout=120)
        outcome = self.measure("fig-v1", jpeg, "--key", KEY)
        self.assertEqual(outcome.code, 0, outcome.out)
        self.assertLess(self.check(outcome, "backdrop")["max"], 12.0)
        self.assertGreaterEqual(self.check(outcome, "colour")["cells_used"], 28)

    def test_measure_reads_a_16_bit_grey_result_as_grey_and_not_as_white(self):
        # 32768 of 65535 is a middle grey (128 of 255), so brightness is 0.502; white would be 1.0
        self.make_set("style-v1", [{"role": "style", "png": png_rgb(64, 64, (100, 100, 100))}])
        result = self.art_file("grey16.png", png_16bit(32, 32, 0, struct.pack(">H", 32768) * 32))
        scene = self.check(self.measure("style-v1", result), "scene")
        self.assertEqual(scene["result"], {"saturation": 0.0, "brightness": 0.502})


# ---------------------------------------------------------------------------
# What the script's text must never contain
# ---------------------------------------------------------------------------

class ScriptTextTests(unittest.TestCase):
    FORBIDDEN = ("socket", "urllib", "http.client", "requests", "subprocess", "os.system", "os.popen", "os.exec",
                 "os.spawn", "os.fork", "ctypes", "shutil", "rmtree", "os.remove", "os.unlink", "os.rmdir", "eval(",
                 "exec(", "__import__")
    NEVER = ("run_process", "sips_size", "read_image_header", "check_refs", "load_picture", "load_candidates",
             "stage_refs", "stage_one", "drop_job", "drop_staged_refs", "make_job", "copy_into_folder", "file_images",
             "find_codex", "find_agy", "child_env", "list_process_commands")

    @classmethod
    def setUpClass(cls):
        with open(SCRIPT, encoding="utf-8") as handle:
            cls.text = handle.read()

    def test_the_script_has_no_forbidden_code(self):
        for word in self.FORBIDDEN:
            self.assertNotIn(word, self.text)
        marker = "sys.dont_write_bytecode = True"
        self.assertEqual(self.text.count("dont_write_bytecode"), 1)
        self.assertEqual(self.text.count(marker), 1)
        self.assertLess(self.text.index(marker), self.text.index("def load_helper"))
        self.assertLess(self.text.index("import sys"), self.text.index(marker))
        # PIL and numpy are imported inside functions only
        found = [line for line in self.text.splitlines() if re.match(r"\s*(import|from)\s+(PIL|numpy)\b", line)]
        self.assertTrue(found)
        for line in found:
            self.assertTrue(line.startswith(" "), "a module-level import: %r" % line)
        # every picture is decoded from bytes that were read and hashed, never from a path
        opens = [line for line in self.text.splitlines() if "Image.open(" in line]
        self.assertTrue(opens)
        for line in opens:
            self.assertIn("io.BytesIO(", line)

    def test_it_uses_only_the_reading_part_of_the_helper_and_every_name_exists(self):
        names = sorted(set(re.findall(r"helper\.([A-Za-z_][A-Za-z0-9_]*)", self.text)))
        self.assertTrue(names)
        for name in names:
            self.assertNotIn(name, self.NEVER)
            self.assertFalse(name.startswith(("cmd_", "codex_", "agy_", "clipboard_")), name)
            self.assertTrue(hasattr(desk_art, name), "the helper has no %s" % name)

    def test_it_writes_only_through_the_looks_folder(self):
        lines = self.text.splitlines()
        makers = [line for line in lines if "os.makedirs(" in line]
        self.assertEqual(len(makers), 1)
        self.assertIn("looks", makers[0])
        for word in ("os.rename", "os.replace", "os.mkdir", "os.symlink", "os.link(", "os.chmod", "os.truncate",
                     "os.utime", "os.open(", "os.write", "os.fdopen", "os.fsync", "tempfile"):
            self.assertNotIn(word, self.text)
        self.assertIsNone(re.search(r"(?<![\w.])open\(", self.text), "a plain open( call")
        self.assertEqual(self.text.count("helper.write_private_file("), 1)
        for line in lines:
            if ".save(" in line:
                self.assertIn("buffer", line)                       # a picture is encoded in memory first
            if ".write(" in line:
                self.assertTrue("sys.stdout.write(" in line or "sys.stderr.write(" in line, line)

    def test_plain_ascii_python_39_and_the_house_style(self):
        self.assertEqual(len(re.findall(r"[^\x00-\x7F]", self.text)), 0)
        for number, line in enumerate(self.text.splitlines(), start=1):
            self.assertLessEqual(len(line), 120, "line %d is longer than 120 characters" % number)
        for word in ("removeprefix", "removesuffix", "also-allow", "--force"):
            self.assertNotIn(word, self.text)
        self.assertIsNone(re.search(r"\b(list|dict|tuple|set)\[", self.text), "a list[...] style type")
        self.assertIsNone(re.search(r"^\s*match\s", self.text, re.M))
        import ast
        ast.parse(self.text, feature_version=(3, 9))

    def test_no_line_invites_a_forbidden_picture(self):
        # the scope check of the contract: the one word that the scope rule forbids a picture of may only appear in
        # the lines that forbid it
        leftover = [line for line in self.text.splitlines() if re.search(r"\bpose\b", line, re.I)
                    and not re.search(r"ask for a pose|pose[- ]ladder|romance pose|no .?pose|clothes, pose, composition"
                                      r"|pose, composition", line, re.I)]
        self.assertEqual(leftover, [])

    def test_the_flags_that_take_a_value_are_glued_when_they_start_with_a_dash(self):
        match = re.search(r"VALUE_FLAGS = frozenset\(\[(.*?)\]\)", self.text, re.S)
        self.assertIsNotNone(match)
        flags = re.findall(r'"(--[a-z-]+)"', match.group(1))
        self.assertEqual(sorted(flags), ["--inbox", "--key", "--ref-root", "--skip-top", "--zoom"])


# ---------------------------------------------------------------------------
# The words the owner reads on a sheet (they need no Pillow: a sheet's footer is chosen before anything is drawn)
# ---------------------------------------------------------------------------

class WordsTests(unittest.TestCase):
    def test_the_upload_sentence_is_the_contract_sentence(self):
        self.assertEqual(load_look().SHEET_UPLOAD_LINE, SHEET_UPLOAD_LINE)

    def test_the_footer_has_three_lines_and_says_none_without_a_keep_line(self):
        look = load_look()
        made = "2026-11-09T12:00:00Z"
        self.assertEqual(look.footer_lines(Anchor("pair-v1", made, "blue suit")),
                         ["set pair-v1   made 2026-11-09T12:00:00Z", "KEEP: blue suit", SHEET_UPLOAD_LINE])
        for keep in ("", "   "):                                    # nothing, or only spaces, is no keep line
            self.assertEqual(look.footer_lines(Anchor("pair-v1", made, keep)),
                             ["set pair-v1   made 2026-11-09T12:00:00Z", "KEEP: (none)", SHEET_UPLOAD_LINE])
        self.assertEqual(look.footer_lines(Anchor("pair-v1", made, "  round lenses  "))[1], "KEEP: round lenses")


# ---------------------------------------------------------------------------
# Tests that load the script in this very process (they need Pillow and numpy in the interpreter running the tests)
# ---------------------------------------------------------------------------

@NEEDS_PILLOW_HERE
class InProcessTests(LookCase):
    def environment(self):
        return mock.patch.dict(os.environ, self.sb.env(), clear=True)

    def test_each_member_is_opened_once(self):
        folder = self.make_set("once-v1", [{"role": "identity", "png": figure()},
                                           {"role": "style", "png": png_rgb(64, 64, (120, 130, 140))}])
        result_path = self.art_file("r.png", figure())
        paths = [os.path.join(folder, "01_identity.png"), os.path.join(folder, "02_style.png")]
        look = load_look()
        helper = look.get_helper()
        real_open = helper.open_regular
        opened = collections.Counter()

        def counting(path):
            opened[path] += 1
            return real_open(path)

        argvs = [["sheet"] + self.inbox_args() + ["once-v1"],
                 ["beside"] + self.inbox_args() + ["once-v1", result_path],
                 ["measure"] + self.inbox_args() + ["once-v1", result_path, "--key", KEY]]
        with self.environment(), mock.patch.object(helper, "open_regular", counting):
            for argv in argvs:
                opened.clear()
                code, result = look.run_cli(argv)
                self.assertEqual(code, 0, result)
                for path in paths:
                    self.assertEqual(opened[path], 1, "%s opened %d times by %s" % (path, opened[path], argv[0]))

    def swap_after_first_open(self, helper, path, new_bytes):
        """A replacement for open_regular that, right after the first open of `path`, puts another picture in its
        place (a new file under the same name, so the open handle still leads to the old bytes). Returns it and the
        counter of opens."""
        real_open = helper.open_regular
        opened = collections.Counter()

        def swapping(target):
            handle = real_open(target)
            opened[target] += 1
            if target == path and opened[target] == 1:
                replacement = path + ".swap"
                with open(replacement, "wb") as out:
                    out.write(new_bytes)
                os.replace(replacement, path)
            return handle
        return swapping, opened

    def test_a_member_swapped_after_it_was_read_is_never_drawn(self):
        from PIL import Image
        folder = self.make_set("swap-v1", [{"role": "identity", "png": figure()}])
        member = os.path.join(folder, "01_identity.png")
        result_path = self.art_file("r.png", figure())
        look = load_look()
        helper = look.get_helper()
        swapping, opened = self.swap_after_first_open(helper, member, png_rgb(128, 256, (0, 0, 0)))
        with self.environment(), mock.patch.object(helper, "open_regular", swapping):
            code, result = look.run_cli(["sheet"] + self.inbox_args() + ["swap-v1"])
        self.assertEqual(code, 0, result)
        self.assertEqual(opened[member], 1)                           # never opened a second time
        with open(member, "rb") as handle:
            self.assertEqual(handle.read(), png_rgb(128, 256, (0, 0, 0)))        # the swap did happen
        drawn = Image.open(result["file"]).convert("RGB")
        self.assertEqual(drawn.getpixel((16 + 90, 44 + 180)), BANDS[1])          # the old figure's middle band
        # measure: the figure that was read is compared (the same picture, so there is no difference), and a black
        # picture would have no figure at all
        folder = self.make_set("swap-v2", [{"role": "identity", "png": figure()}])
        member = os.path.join(folder, "01_identity.png")
        swapping, opened = self.swap_after_first_open(helper, member, png_rgb(128, 256, (0, 0, 0)))
        with self.environment(), mock.patch.object(helper, "open_regular", swapping):
            code, result = look.run_cli(["measure"] + self.inbox_args() + ["swap-v2", result_path, "--key", KEY])
        self.assertEqual(code, 0, result)
        self.assertEqual([item for item in result["checks"] if item["name"] == "colour"][0]["median"], 0.0)
        self.assertEqual(opened[member], 1)

    def test_a_result_swapped_between_the_check_and_the_read_is_refused(self):
        picture = self.art_file("swap.png", png_rgb(64, 64, (10, 120, 10)))
        look = load_look()
        helper = look.get_helper()
        real_detect = helper.detect_format

        def replaced(head):
            temporary = picture + ".swap"
            with open(temporary, "wb") as out:
                out.write(png_rgb(64, 64, (200, 0, 0)))
            os.replace(temporary, picture)                            # a new file (a new inode) under the same name
            return real_detect(head)

        with self.environment(), mock.patch.object(helper, "detect_format", replaced):
            code, result = look.run_cli(["zoom"] + self.inbox_args() + [picture, "0,0,1,1"])
        self.assertEqual(code, 2, result)
        self.assertEqual(result["code"], "bad-input")
        self.assertIn("changed after it was checked", result["error"])
        self.assertEqual(self.looks_files(), [])
        # the same file rewritten IN PLACE keeps its inode: the new bytes are what is read, and what is drawn
        from PIL import Image
        picture = self.art_file("inplace.png", png_rgb(64, 64, (10, 120, 10)))

        def rewritten(head):
            with open(picture, "r+b") as out:
                out.write(png_rgb(64, 64, (200, 0, 0)))
            return real_detect(head)

        with self.environment(), mock.patch.object(helper, "detect_format", rewritten):
            code, result = look.run_cli(["zoom"] + self.inbox_args() + [picture, "0,0,1,1"])
        self.assertEqual(code, 0, result)
        self.assertEqual(Image.open(result["file"]).convert("RGB").getpixel((10, 10)), (200, 0, 0))

    def test_a_name_collision_is_retried_once_and_never_overwrites(self):
        self.make_set("retry-v1", [{"role": "identity", "png": png_rgb(100, 200, (30, 60, 90))}])
        look = load_look()
        helper = look.get_helper()
        real_write = helper.write_private_file
        calls = []

        def first_collides(path, data):
            calls.append(path)
            if len(calls) == 1:
                raise FileExistsError(errno.EEXIST, "File exists", path)
            real_write(path, data)

        with self.environment(), mock.patch.object(helper, "write_private_file", first_collides):
            code, result = look.run_cli(["sheet"] + self.inbox_args() + ["retry-v1"])
        self.assertEqual(code, 0, result)
        self.assertEqual(len(calls), 2)
        self.assertNotEqual(calls[0], calls[1])
        self.assertEqual(self.looks_files(), [os.path.basename(result["file"])])
        self.assertEqual(os.path.basename(result["file"]), os.path.basename(calls[1]))
        # a name that is really taken (made by the real write function) is never replaced: the second try is used
        os.remove(result["file"])
        taken = os.path.join(self.looks(), "retry-v1-sheet-20261109T000000-aaaa.png")
        with open(taken, "wb") as handle:
            handle.write(b"keep me")
        tokens = iter(["aaaa", "bbbb"])
        with self.environment(), mock.patch.object(look.time, "strftime", return_value="20261109T000000"), \
                mock.patch.object(look.secrets, "token_hex", lambda size: next(tokens)):
            code, result = look.run_cli(["sheet"] + self.inbox_args() + ["retry-v1"])
        self.assertEqual(code, 0, result)
        self.assertTrue(result["file"].endswith("retry-v1-sheet-20261109T000000-bbbb.png"), result["file"])
        with open(taken, "rb") as handle:
            self.assertEqual(handle.read(), b"keep me")
        # two collisions in a row are an internal error, and nothing is written
        for path in self.looks_files():
            os.remove(os.path.join(self.looks(), path))

        def always_collides(path, data):
            raise FileExistsError(errno.EEXIST, "File exists", path)

        stderr = io.StringIO()
        with self.environment(), mock.patch.object(helper, "write_private_file", always_collides), \
                contextlib.redirect_stderr(stderr):
            code, result = look.run_cli(["sheet"] + self.inbox_args() + ["retry-v1"])
        self.assertEqual(code, 1)
        self.assertEqual((result["ok"], result["code"]), (False, "internal"))
        self.assertEqual(self.looks_files(), [])

    def test_run_cli_never_raises_and_the_helper_may_be_missing(self):
        self.make_set("boom-v1", [{"role": "identity", "png": png_rgb(100, 200, (30, 60, 90))}])
        look = load_look()
        stderr = io.StringIO()
        with self.environment(), mock.patch.object(look, "write_look", side_effect=RuntimeError("boom")), \
                contextlib.redirect_stderr(stderr):
            code, result = look.run_cli(["sheet"] + self.inbox_args() + ["boom-v1"], b"standard input is not read")
        self.assertEqual(code, 1)
        self.assertEqual((result["ok"], result["code"]), (False, "internal"))
        self.assertIn("boom", result["error"])
        self.assertIn("RuntimeError", stderr.getvalue())
        missing = load_look()
        with mock.patch.object(missing, "load_helper", side_effect=ImportError("gone")):
            code, result = missing.run_cli(["sheet", "x-v1"])
        self.assertEqual((code, result), (1, {"ok": False, "code": "internal", "error": HELPER_MISSING}))
        self.assertTrue(hasattr(load_look().get_helper(), "ANCHOR_FORMAT"))

    def test_the_lab_conversion_matches_known_colours(self):
        import numpy
        look = load_look()
        known = [((255, 255, 255), (100.0, 0.0, 0.0)), ((0, 0, 0), (0.0, 0.0, 0.0)),
                 ((255, 0, 0), (53.2408, 80.0925, 67.2032)), ((0, 255, 0), (87.7347, -86.1827, 83.1793)),
                 ((0, 0, 255), (32.2970, 79.1875, -107.8602)), ((128, 128, 128), (53.585, 0.0, 0.0))]
        found = look.srgb_to_lab(numpy, [colour for colour, _ in known])
        for row, (_, expected) in zip(found, known):
            for value, wanted in zip(row, expected):
                self.assertAlmostEqual(float(value), wanted, delta=0.01)
        for colour in ((200, 30, 30), (17, 99, 201), (250, 240, 10)):
            for value, wanted in zip(look.srgb_to_lab(numpy, [colour])[0], lab_of(colour)):
                self.assertAlmostEqual(float(value), wanted, delta=1e-6)

    def test_a_footer_line_is_cut_with_three_dots_to_fit(self):
        from PIL import Image, ImageDraw, ImageFont, ImageOps
        look = load_look()
        pil = look.Pillow(Image, ImageDraw, ImageFont, ImageOps)
        font = look.load_font(pil)
        draw = ImageDraw.Draw(Image.new("RGB", (10, 10)))
        self.assertEqual(look.fit_text(draw, font, "short", 300), "short")
        text = "KEEP: " + "word " * 80
        fitted = look.fit_text(draw, font, text, 300)
        self.assertTrue(fitted.endswith("..."))
        self.assertLessEqual(look.text_width(draw, font, fitted), 300)
        self.assertGreater(len(fitted), 10)
        # one more letter would not have fitted
        longer = text[:len(fitted) - 3 + 1] + "..."
        self.assertGreater(look.text_width(draw, font, longer), 300)

    def test_the_sheet_draws_the_pinned_footer_lines(self):
        # what the sheet hands to the drawing, line by line (the words cannot be read back out of the picture)
        self.make_set("pair-v1", [{"role": "identity", "png": png_rgb(100, 200, (30, 60, 90))}], keep="blue suit")
        self.make_set("nokeep-v1", [{"role": "identity", "png": png_rgb(100, 200, (30, 60, 90))}], keep="")
        look = load_look()
        real_fit = look.fit_text
        drawn = []

        def recording(draw, font, text, limit):
            drawn.append(text)
            return real_fit(draw, font, text, limit)

        with self.environment(), mock.patch.object(look, "fit_text", recording):
            for name in ("pair-v1", "nokeep-v1"):
                del drawn[:]
                code, result = look.run_cli(["sheet"] + self.inbox_args() + [name])
                self.assertEqual(code, 0, result)
                keep = "blue suit" if name == "pair-v1" else "(none)"
                self.assertEqual(drawn, ["set %s   made 2026-11-09T12:00:00Z" % name, "KEEP: %s" % keep,
                                         SHEET_UPLOAD_LINE])

    def test_a_narrow_picture_is_measured_as_it_is_and_a_wide_one_is_shrunk(self):
        # a picture wider than 256 px is shrunk to 256 wide; a narrower one is never blown up to 256 (a very thin one
        # would need gigabytes), and its numbers are those of the picture itself
        import numpy
        from PIL import Image, ImageDraw, ImageFont, ImageOps
        look = load_look()
        pil = look.Pillow(Image, ImageDraw, ImageFont, ImageOps)

        def own_numbers(image):
            hsv = numpy.asarray(image.convert("HSV"), dtype=numpy.float64)
            return float(hsv[:, :, 1].mean()) / 255.0, float(hsv[:, :, 2].mean()) / 255.0

        grid = pattern(3, 100, 40)
        narrow = Image.new("RGB", (100, 40))
        narrow.putdata([grid[y][x] for y in range(40) for x in range(100)])
        spy = Spy(narrow)
        found = look.saturation_brightness(pil, numpy, spy)
        self.assertEqual(spy.resized, [])
        for value, wanted in zip(found, own_numbers(narrow)):
            self.assertAlmostEqual(value, wanted, places=9)
        for size, resized in (((256, 30), []), ((257, 30), [(256, 30)]), ((512, 100), [(256, 50)]),
                              ((1000, 3), [(256, 1)])):
            spy = Spy(Image.new("RGB", size, (200, 100, 50)))
            look.saturation_brightness(pil, numpy, spy)
            self.assertEqual(spy.resized, resized, size)
        # a thin picture is measured at its own size, not at 256 wide
        thin = Image.new("RGB", (3, 20000), (200, 100, 50))
        spy = Spy(thin)
        for value, wanted in zip(look.saturation_brightness(pil, numpy, spy), own_numbers(thin)):
            self.assertAlmostEqual(value, wanted, places=9)
        self.assertEqual(spy.resized, [])

    def test_the_decoder_refuses_a_side_over_20000_pixels(self):
        from PIL import Image, ImageDraw, ImageFont, ImageOps
        look = load_look()
        pil = look.Pillow(Image, ImageDraw, ImageFont, ImageOps)
        for size in ((1, 20001), (20001, 1)):
            with self.assertRaises(look.PictureProblem) as caught:
                look.decode_rgba(pil, png_rgb(size[0], size[1], (1, 2, 3)))
            problem = caught.exception
            self.assertEqual((problem.pixels, problem.side, problem.keyed), (0, 20001, False))
        self.assertEqual(look.decode_rgba(pil, png_rgb(1, 20000, (1, 2, 3))).size, (1, 20000))

    def test_the_decoder_keeps_the_high_byte_of_a_16_bit_grey_and_refuses_its_transparent_colour(self):
        from PIL import Image, ImageDraw, ImageFont, ImageOps
        look = load_look()
        pil = look.Pillow(Image, ImageDraw, ImageFont, ImageOps)
        grey = look.decode_rgba(pil, grey16_blocks([0, 255, 256, 32768, 65535], block=2, height=2))
        self.assertEqual(grey.mode, "RGBA")
        self.assertEqual([grey.getpixel((2 * index, 0)) for index in range(5)],
                         [(0, 0, 0, 255), (0, 0, 0, 255), (1, 1, 1, 255), (128, 128, 128, 255), (255, 255, 255, 255)])
        with self.assertRaises(look.PictureProblem) as caught:
            look.decode_rgba(pil, grey16_blocks([0, 32768], key=32768))
        problem = caught.exception
        self.assertEqual((problem.pixels, problem.side, problem.keyed), (0, 0, True))
        # a 16-bit picture in colour and an ordinary 8-bit one with a see-through part are read as before
        colour = look.decode_rgba(pil, png_16bit(2, 2, 2, struct.pack(">HHH", 40000, 20000, 10000) * 2))
        self.assertEqual(colour.getpixel((0, 0)), (156, 78, 39, 255))
        self.assertEqual(look.decode_rgba(pil, png_rgba(2, 2, (1, 2, 3, 4))).getpixel((1, 1)), (1, 2, 3, 4))

    def test_sizes_follow_the_contract(self):
        look = load_look()
        self.assertEqual(look.SHEET_UPLOAD_LINE, SHEET_UPLOAD_LINE)
        self.assertEqual(look.SHEET_HEIGHT, 476)
        self.assertEqual(look.scaled_size(100, 200, 360), (180, 360))
        self.assertEqual(look.scaled_size(200, 100, 360), (720, 360))
        self.assertEqual(look.scaled_size(4000, 100, 720), (4096, 102))
        self.assertEqual(look.scaled_size(1, 20000, 360), (1, 360))
        self.assertEqual(look.region_box((200, 400), (0.0, 0.5, 1.0, 1.0)), (0, 200, 200, 400))
        left, top, right, bottom = look.region_box((10, 10), (0.96, 0.96, 1.0, 1.0))
        self.assertTrue(0 <= left < right <= 10 and 0 <= top < bottom <= 10)


if __name__ == "__main__":
    unittest.main()
