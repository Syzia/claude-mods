"""Pictures to look at, and numbers, for desk-art anchor sets (desk-art 0.2.0).

Run it as  <python> -I -B anchor_look.py <command> ...  with ComfyUI's Python (it has Pillow and numpy):

  anchor_look.py sheet   [--inbox DIR] NAME
  anchor_look.py beside  [--inbox DIR] [--ref-root DIR]... NAME RESULT [--zoom X0,Y0,X1,Y1]
  anchor_look.py zoom    [--inbox DIR] [--ref-root DIR]... PATH X0,Y0,X1,Y1
  anchor_look.py measure [--inbox DIR] [--ref-root DIR]... NAME RESULT [--key "#RRGGBB"] [--skip-top F]

sheet, beside and zoom each make ONE picture for the eyes of the owner and of Claude. measure prints numbers only:
it never says that a picture is good or bad. Every call prints exactly one JSON line (ASCII) on standard output;
diagnostics go to standard error. Exit codes: 0 ok, 2 handled failure, 3 usage error, 1 unexpected error.

The only thing this script writes is a new picture in <cache>/anchor-looks/, under a new name each time. It never
changes a picture it reads, never deletes anything and never overwrites anything. It loads the desk-art helper next to
this skill by file path, so there is one rule book, and it uses only the small part of it that reads and checks.
"""

import sys

sys.dont_write_bytecode = True

import argparse  # noqa: E402
import collections  # noqa: E402
import hashlib  # noqa: E402
import importlib.util  # noqa: E402
import io  # noqa: E402
import json  # noqa: E402
import math  # noqa: E402
import os  # noqa: E402
import re  # noqa: E402
import secrets  # noqa: E402
import stat  # noqa: E402
import time  # noqa: E402
import traceback  # noqa: E402
import warnings  # noqa: E402
from typing import Any, Dict, List, Optional, Tuple  # noqa: E402

HELPER_MISSING = "the desk-art helper next to this skill is missing or older than 0.2.0"

# ---------------------------------------------------------------------------
# The numbers of the pictures (all of them are fixed by the contract, so a test can check a size)
# ---------------------------------------------------------------------------

LOOKS_FOLDER = "anchor-looks"
BACKGROUND = (40, 40, 40)
WHITE = (255, 255, 255)
GREY = (128, 128, 128)
MARGIN = 16
GAP = 16
LABEL_BAND = 28
LABEL_TOP = 6                       # text starts this far below the top of its band
ROW_GAP = 8
FONT_SIZE = 14
FOOTER_LINE = 16                    # three lines of 14 px text fill the 48 px footer
FOOTER_HEIGHT = 48
SHEET_TILE_HEIGHT = 360
SHEET_MIN_WIDTH = 720
SHEET_HEIGHT = MARGIN + LABEL_BAND + SHEET_TILE_HEIGHT + ROW_GAP + FOOTER_HEIGHT + MARGIN            # 476
BESIDE_HEIGHT = 720
BESIDE_ZOOM_HEIGHT = 360
ZOOM_HEIGHT = 720
MAX_TILE_WIDTH = 4096
MAX_PIXELS = 40000000
MAX_SIDE = 20000                    # the limit of a set's own pictures; a longer side makes the resize table huge
MIN_REGION_SIDE = 0.05
SIDE_SLACK = 1e-9                   # 0.15 - 0.10 is 0.04999999999999999 in floating point: a side of 0.05 must pass
CELL_COLUMNS = 4
CELL_ROWS = 8
FIGURE_DISTANCE = 60                # a pixel further than this from the backdrop colour is part of the figure
FIGURE_MIN_PIXELS = 2000
FIGURE_MIN_LINE = 3
LINEUP_SIZE = (192, 108)
LINEUP_ASPECT_SLACK = 0.03
SCENE_WIDTH = 256
SHEET_UPLOAD_LINE = "These pictures go to OpenAI or Google every time the set is used."
SHEET_NOTE = "Show this file to the owner (send it with the SendUserFile tool if you have it, otherwise give the path)."
MEASURE_NOTE = "Numbers only. They never accept or refuse a picture: look at it too."
NO_KEY_REASON = "give --key (the flat backdrop colour) to measure the backdrop and the colour"
NO_IDENTITY_REASON = "the set has no identity picture"
SCOPE_REFUSAL = (
    '%s mentions "%s". The scope rule keeps swimwear, bikini, underwear, towel, bath, onsen, sauna, pool and beach '
    "pictures, lingerie-style pyjamas and 'Ask for a pose' pictures out of anchor sets, and the builder cannot tell "
    "this one from those, so it stopped. Stop and tell the owner once; do not look for another way in.")
REGION_WORDS = ("must be four plain numbers like 0.30,0.00,0.70,0.25: left, top, right and bottom as parts of the "
                "picture from 0 to 1, with left before right, top before bottom and each side at least 0.05")
NUMBER_RE = re.compile(r"[0-9]+(\.[0-9]+)?")
KEY_RE = re.compile(r"#[0-9A-Fa-f]{6}")

Pillow = collections.namedtuple("Pillow", "Image ImageDraw ImageFont ImageOps")
Loaded = collections.namedtuple("Loaded", "real data size")                # a picture file read once: path, bytes, size


class PictureProblem(Exception):
    """A picture that cannot be decoded. `pixels` is its number of pixels when it is over the size limit, `side` is
    its longest side when that is over the side limit, and `keyed` is true for a 16-bit grey picture that has a
    transparent colour."""

    def __init__(self, pixels: int = 0, side: int = 0, keyed: bool = False) -> None:
        Exception.__init__(self, "unreadable picture")
        self.pixels = pixels
        self.side = side
        self.keyed = keyed


class NameTaken(Exception):
    """A new file name was taken twice in a row (only a bug or a very unlucky draw gets here)."""


# ---------------------------------------------------------------------------
# The helper: one rule book, loaded by file path
# ---------------------------------------------------------------------------

def load_helper() -> Any:
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.normpath(os.path.join(here, "..", "..", "..", "bin", "desk_art.py"))
    spec = importlib.util.spec_from_file_location("desk_art_helper", path)
    module = importlib.util.module_from_spec(spec)
    sys.modules["desk_art_helper"] = module
    spec.loader.exec_module(module)
    if not hasattr(module, "ANCHOR_FORMAT"):
        raise ImportError(HELPER_MISSING)
    return module


HELPER = None


def get_helper() -> Any:
    """Load the helper once per process and keep it in HELPER. Tests reach the loaded module through this
    function (to patch one of its functions) without touching the test process's own `desk_art` import."""
    global HELPER
    if HELPER is None:
        HELPER = load_helper()
    return HELPER


# ---------------------------------------------------------------------------
# Which Python has the picture tools, and what to say when this one does not
# ---------------------------------------------------------------------------

def find_comfy_python(helper: Any) -> Tuple[Optional[str], Optional[str]]:
    """LOOK for ComfyUI's Python and run nothing. Returns (path, None), or (None, the reason it was not found).
    The order: JJK_ART_PYTHON, then JJK_COMFY_ROOT, then the plain folder of the install folder, then every other
    folder there in sorted order. The REAL home is used (never DESK_ART_HOME): ComfyUI does not move with it."""
    given = os.environ.get("JJK_ART_PYTHON")
    if given:
        path = os.path.expanduser(given)
        if helper.is_executable(path):
            return path, None
        return None, "JJK_ART_PYTHON is set to %s, which is not a program" % given
    tail = ("standalone-env", "bin", "python")
    base = os.path.join(os.path.expanduser("~"), "ComfyUI-Installs")
    candidates = []  # type: List[str]
    root = os.environ.get("JJK_COMFY_ROOT")
    if root:
        candidates.append(os.path.join(os.path.expanduser(root), *tail))
    candidates.append(os.path.join(base, "ComfyUI", *tail))
    try:
        names = sorted(name for name in os.listdir(base) if not name.startswith("."))
    except OSError:
        names = []
    candidates.extend(os.path.join(base, name, *tail) for name in names)
    for path in candidates:
        if helper.is_executable(path):
            return path, None
    return None, "ComfyUI's Python was not found under %s" % base


def shown_script_path() -> str:
    path = os.path.abspath(__file__)
    return path if re.fullmatch(r"[A-Za-z0-9_./-]+", path) else '"%s"' % path


def needs_pillow(helper: Any, command: str) -> Any:
    """The refusal for a Python without Pillow or numpy, with the Python to use instead when it can be found."""
    path, reason = find_comfy_python(helper)
    if path is not None:
        return helper.Failure(
            "needs-pillow", "This command needs the picture tools that come with ComfyUI's Python, and this Python "
            "does not have them. Run it with ComfyUI's Python: \"%s\" -I -B %s %s ..."
            % (path, shown_script_path(), command))
    return helper.Failure(
        # the reason is a sentence of its own ("ComfyUI's Python was not found under ..."), so it is said once
        "needs-pillow", "This command needs the picture tools that come with ComfyUI's Python, which this Python does "
        "not have. %s. Nothing was installed. Ask the owner where ComfyUI is installed, or set JJK_ART_PYTHON to its "
        "Python." % reason)


def import_pillow(helper: Any, command: str) -> Any:
    try:
        from PIL import Image, ImageDraw, ImageFont, ImageOps
    except Exception:
        raise needs_pillow(helper, command)
    warnings.simplefilter("ignore")            # a damaged chunk makes Pillow print a warning; only JSON may be printed
    return Pillow(Image, ImageDraw, ImageFont, ImageOps)


def import_numpy(helper: Any, command: str) -> Any:
    try:
        import numpy
    except Exception:
        raise needs_pillow(helper, command)
    return numpy


# ---------------------------------------------------------------------------
# Rule I: the inbox
# ---------------------------------------------------------------------------

def script_inbox(helper: Any, raw: Optional[str]) -> str:
    # helper.checked_inbox_path raises Failure("inbox-unsafe") for a folder outside home, hidden or inside ~/Library
    real = helper.checked_inbox_path(raw or helper.default_inbox())
    is_default = (real == helper.real_path(helper.default_inbox()))
    notes = os.path.join(real, "manifest.jsonl")
    if not is_default and not (os.path.lexists(notes) and stat.S_ISREG(os.lstat(notes).st_mode)):
        raise helper.Failure(
            "inbox-unsafe", "That folder is not the art inbox: it is not the default inbox and it has no "
            "manifest.jsonl (the notes file desk-art keeps in its inbox). Use the folder that the desk-art status tool "
            "shows after 'Art inbox:'. If that folder is new and holds no pictures yet, file one picture into it "
            "first (the ingest tool), then try again.")
    return real


# ---------------------------------------------------------------------------
# --ref-root can only narrow what may be read
# ---------------------------------------------------------------------------

def inside_or_equal(real: str, folder: str) -> bool:
    return real == folder or real.startswith(folder.rstrip(os.sep) + os.sep)


def narrowed_roots(helper: Any, given: Optional[List[str]], inbox: str) -> Tuple[List[str], List[str]]:
    """The folders a picture may be read from, and the --ref-root folders that were ignored. With no --ref-root these
    are the four standard art folders, the inbox and the cache. With some, they are the folders that lie in one of
    the standard folders or in the inbox, plus the inbox and the cache, and never the standard folders themselves."""
    if not given:
        return helper.ref_sources(None, inbox), []
    helper.configured_roots(given)               # the shape rules: / or ~/ first, no control character, at most 20
    standard = [helper.real_path(folder) for folder in helper.DEFAULT_REF_ROOTS] + [os.path.realpath(inbox)]
    cache = os.path.realpath(helper.cache_dir())
    counted = []  # type: List[str]
    ignored = []  # type: List[str]
    for raw in dict.fromkeys(given):
        real = helper.real_path(raw)
        if real == cache:
            continue                             # always allowed anyway: skipped without a word
        if any(inside_or_equal(real, folder) for folder in standard):
            counted.append(helper.abs_path(raw))
        else:
            ignored.append(raw)
    roots = list(dict.fromkeys(counted + [inbox, helper.abs_path(helper.cache_dir())]))
    return roots, ignored


# ---------------------------------------------------------------------------
# Rule S: a picture the script is asked to look at
# ---------------------------------------------------------------------------

def scope_guard(helper: Any, given: str) -> None:
    """The scope rule, before the file is opened or even looked for (a walk over the path that opens nothing)."""
    word = helper.anchor_scope_path_word(given)
    if word is not None:
        raise helper.Failure("bad-input", SCOPE_REFUSAL % ("the path %s" % given, word))
    real = helper.real_path(given)
    word = helper.anchor_scope_path_word(real)
    if word is not None:
        raise helper.Failure("bad-input", SCOPE_REFUSAL % ("the real path %s" % real, word))


def megapixel_text(pixels: int) -> str:
    text = "%.1f" % (math.ceil(pixels / 100000.0) / 10.0)
    return text[:-2] if text.endswith(".0") else text


def too_big(helper: Any, what: str, given: str, pixels: int) -> Any:
    return helper.Failure("bad-input", "%s %s is %s megapixels, and the limit is 40"
                          % (what, given, megapixel_text(pixels)))


def too_long(helper: Any, what: str, given: str, side: int) -> Any:
    return helper.Failure("bad-input", "%s %s has a side of %d pixels, and the limit is %d"
                          % (what, given, side, MAX_SIDE))


def read_picture(helper: Any, given: str, what: str, roots: List[str]) -> Any:
    """One picture file, read once: the scope guard, the helper's location, secret-name and folder rules, then a read
    pinned to the checked file (same device and inode, at most 20 MB). Nothing is decoded here."""
    scope_guard(helper, given)
    real, info = helper.resolve_input_file(given, what, helper.cache_folder(), roots)
    if info.st_size > helper.MAX_REF_BYTES:
        raise helper.Failure("bad-input", "%s %s is bigger than 20 MB" % (what, given))
    try:
        with helper.open_regular(real) as handle:
            fmt = helper.detect_format(handle.read(16))
    except OSError as exc:
        raise helper.Failure("bad-input", "%s %s could not be read: %s" % (what, given, exc.strerror or exc))
    if fmt is None:
        raise helper.Failure("bad-input", "%s %s is not a PNG, JPEG or WEBP picture" % (what, given))
    ref = helper.Ref(os.path.basename(given), real, fmt, info.st_dev, info.st_ino)
    data = helper.read_ref_bytes(ref)
    size = helper.SIZE_READERS[fmt](io.BytesIO(data))
    if size is None:
        raise helper.Failure("bad-input", "%s %s is not a readable PNG, JPEG or WEBP picture" % (what, given))
    if size[0] * size[1] > MAX_PIXELS:
        raise too_big(helper, what, given, size[0] * size[1])
    if max(size) > MAX_SIDE:
        raise too_long(helper, what, given, max(size))
    return Loaded(real, data, size)


def eight_bit_grey(picture: Any) -> Any:
    """A 16-bit grey picture (Pillow reads it as mode I;16 and would turn every value above 255 into white) as an
    8-bit grey one: the high byte of each value, the way Pillow already reads 16-bit colour pictures."""
    return picture.point(lambda value: value * (1.0 / 256.0)).convert("L")


def decode_rgba(pil: Any, data: bytes) -> Any:
    """The picture in these bytes as an upright RGBA image. Raises PictureProblem for anything Pillow cannot read."""
    over = side = 0
    keyed = False
    try:
        picture = pil.Image.open(io.BytesIO(data))
        pixels = picture.size[0] * picture.size[1]
        if pixels > MAX_PIXELS:
            over = pixels
        elif max(picture.size) > MAX_SIDE:
            side = max(picture.size)
        else:
            picture = pil.ImageOps.exif_transpose(picture)
            if picture.mode.startswith("I"):
                if "transparency" in picture.info:        # one 16-bit value cannot be made see-through in 8 bits
                    keyed = True
                else:
                    picture = eight_bit_grey(picture)
            if not keyed:
                picture = picture.convert("RGBA")
                picture.load()
    except Exception:                              # OSError, ValueError, SyntaxError, EOFError, zlib errors, bombs ...
        raise PictureProblem()
    if over or side or keyed:
        raise PictureProblem(over, side, keyed)
    return picture


def decode_result(helper: Any, pil: Any, loaded: Any, what: str, given: str) -> Any:
    try:
        return decode_rgba(pil, loaded.data)
    except PictureProblem as problem:
        if problem.pixels:
            raise too_big(helper, what, given, problem.pixels)
        if problem.side:
            raise too_long(helper, what, given, problem.side)
        if problem.keyed:
            raise helper.Failure("bad-input", "%s %s is a 16-bit grey picture with a transparent colour, which cannot "
                                              "be used: save it as an ordinary 8-bit PNG first" % (what, given))
        raise helper.Failure("bad-input", "%s %s is not a readable PNG, JPEG or WEBP picture" % (what, given))


def has_alpha(picture: Any) -> bool:
    return picture.getchannel("A").getextrema()[0] < 255


def flatten(pil: Any, picture: Any, colour: Tuple[int, int, int]) -> Any:
    """An RGBA picture laid on a flat colour, as RGB."""
    base = pil.Image.new("RGBA", picture.size, tuple(colour) + (255,))
    return pil.Image.alpha_composite(base, picture).convert("RGB")


def lanczos(pil: Any) -> Any:
    return getattr(pil.Image, "Resampling", pil.Image).LANCZOS


def box_filter(pil: Any) -> Any:
    return getattr(pil.Image, "Resampling", pil.Image).BOX


# ---------------------------------------------------------------------------
# Rule N: numbers typed on the command line
# ---------------------------------------------------------------------------

def parse_fraction(text: str) -> Optional[float]:
    """Plain digits with an optional fraction ("0.25"), else None: no sign, exponent, underscore, nan or inf."""
    if NUMBER_RE.fullmatch(text) is None:
        return None
    return float(text)


def parse_region(helper: Any, text: str, name: str) -> Tuple[float, float, float, float]:
    parts = text.split(",")
    values = [parse_fraction(part) for part in parts] if len(parts) == 4 else []
    if len(values) != 4 or any(value is None for value in values):
        raise helper.Failure("bad-input", "%s %s" % (name, REGION_WORDS))
    x0, y0, x1, y1 = values
    # A positive test: anything that is not a clean number inside the limits is refused.
    if not (0.0 <= x0 < x1 <= 1.0 and 0.0 <= y0 < y1 <= 1.0
            and x1 - x0 >= MIN_REGION_SIDE - SIDE_SLACK and y1 - y0 >= MIN_REGION_SIDE - SIDE_SLACK):
        raise helper.Failure("bad-input", "%s %s" % (name, REGION_WORDS))
    return x0, y0, x1, y1


def parse_skip_top(helper: Any, text: Optional[str]) -> float:
    if text is None:
        return 0.0
    value = parse_fraction(text)
    if not (value is not None and 0.0 <= value <= 0.5):
        raise helper.Failure("bad-input", "--skip-top must be a plain number from 0 to 0.5, for example 0.25")
    return value


def parse_key(helper: Any, text: Optional[str]) -> Tuple[Optional[str], Optional[Tuple[int, int, int]]]:
    if text is None:
        return None, None
    if KEY_RE.fullmatch(text) is None:
        raise helper.Failure("bad-input", "--key must look like #FF00FF: a hash sign and six digits or letters a to f")
    return "#" + text[1:].upper(), (int(text[1:3], 16), int(text[3:5], 16), int(text[5:7], 16))


# ---------------------------------------------------------------------------
# Rule L: the looks folder, the only place this script writes
# ---------------------------------------------------------------------------

def check_looks(helper: Any) -> str:
    """The looks folder path. Refuses a link that leads elsewhere. Makes nothing."""
    looks = os.path.join(helper.cache_dir(), LOOKS_FOLDER)
    expected = os.path.join(os.path.realpath(helper.cache_dir()), LOOKS_FOLDER)
    if os.path.lexists(looks) and os.path.realpath(looks) != expected:
        raise helper.Failure("inbox-unsafe", "the anchor-looks folder is a link that leads elsewhere",
                             hint="delete or rename that link, then try again")
    return looks


def write_look(helper: Any, first: str, kind: str, picture: Any) -> str:
    """Write a picture to a new file in the looks folder and return its path. The file goes straight to its final
    name and is never replaced: when the name is taken it is made again once with a new random part."""
    looks = check_looks(helper)
    buffer = io.BytesIO()
    picture.save(buffer, format="PNG", compress_level=6)
    data = buffer.getvalue()
    try:
        os.makedirs(looks, mode=0o700, exist_ok=True)
    except OSError as exc:
        raise helper.Failure("inbox-unsafe", "the anchor-looks folder could not be made: %s" % (exc.strerror or exc))
    check_looks(helper)
    stamp = time.strftime("%Y%m%dT%H%M%S", time.gmtime())
    for _ in range(2):
        path = os.path.join(looks, "%s-%s-%s-%s.png" % (first, kind, stamp, secrets.token_hex(2)))
        try:
            helper.write_private_file(path, data)
        except FileExistsError:
            continue
        return path
    raise NameTaken("the name of a new picture was already taken twice")


# ---------------------------------------------------------------------------
# Sets: load, verify, read every picture once
# ---------------------------------------------------------------------------

def without_sent(text: str) -> str:
    """A refusal of the helper, worded for a command that sends nothing (the helper's own words end with a sentence
    that says nothing was sent). The same rule as the set builder's."""
    return re.sub(r"\s*Nothing was sent\.\s*$", "", text)


def open_set(helper: Any, inbox: str, name: str) -> Any:
    """The set `name` (the helper's checks, with this script's codes): a name that does not fit is bad-input, a set
    that is not saved is set-not-found, a set that cannot be used is set-damaged, a link is inbox-unsafe."""
    helper.check_anchor_name(name)
    anchors = helper.anchors_root(inbox)
    if not os.path.isdir(os.path.join(anchors, name)):
        names = helper.saved_anchor_names(inbox)
        if names:
            more = " and %d more" % (len(names) - 10) if len(names) > 10 else ""
            hint = "Saved sets: %s%s." % (", ".join(names[:10]), more)
        else:
            hint = "No anchor sets are saved yet. Save one with the desk-art:anchor skill."
        raise helper.Failure("set-not-found", "anchor set %s was not found in %s" % (name, anchors), hint=hint)
    try:
        return helper.load_anchor(inbox, name)
    except helper.Failure as failure:
        code = "set-damaged" if failure.code == "bad-input" else failure.code
        raise helper.Failure(code, without_sent(failure.error), **failure.extra)


def damaged(helper: Any, anchor: Any, member: Any, why: str) -> Any:
    return helper.Failure("set-damaged", "anchor set %s: picture %d (%s) %s. Do not use this set; save a new version."
                          % (anchor.name, member.pos, member.role, why))


def verified_members(helper: Any, anchor: Any) -> List[Tuple[Any, bytes]]:
    """Every picture of the set, read ONCE (no second open, so a file swapped afterwards is never drawn) and compared
    with the fingerprint in the card."""
    found = []  # type: List[Tuple[Any, bytes]]
    for member in anchor.members:
        try:
            with helper.open_regular(member.path) as handle:
                data = handle.read(helper.MAX_REF_BYTES + 1)
        except OSError:
            raise damaged(helper, anchor, member, "cannot be read")
        if len(data) > helper.MAX_REF_BYTES:
            raise damaged(helper, anchor, member, "is bigger than 20 MB")
        sha = hashlib.sha256(data).hexdigest()
        if sha != member.sha256:
            raise damaged(helper, anchor, member, "is not the picture that was saved (saved %s, found %s)"
                          % (member.sha256[:8], sha[:8]))
        found.append((member, data))
    return found


def decode_member(helper: Any, pil: Any, anchor: Any, member: Any, data: bytes) -> Any:
    try:
        return decode_rgba(pil, data)
    except PictureProblem:
        raise damaged(helper, anchor, member, "cannot be read as a picture")


# ---------------------------------------------------------------------------
# Drawing helpers
# ---------------------------------------------------------------------------

def scaled_size(width: int, height: int, band: int, limit: int = MAX_TILE_WIDTH) -> Tuple[int, int]:
    """The size of a picture scaled to `band` high; one that would be wider than `limit` is scaled down to `limit`
    wide instead (aspect kept)."""
    new_width = max(1, int(round(width * band / float(height))))
    new_height = band
    if new_width > limit:
        new_height = max(1, int(round(band * limit / float(new_width))))
        new_width = limit
    return new_width, new_height


def scale_to(pil: Any, picture: Any, size: Tuple[int, int]) -> Any:
    return picture.resize(size, lanczos(pil))


def region_box(size: Tuple[int, int], region: Tuple[float, float, float, float]) -> Tuple[int, int, int, int]:
    """The pixel box of a region given as fractions of a picture: at least one pixel each way, inside the picture."""
    width, height = size
    left = min(int(math.floor(region[0] * width + 0.5)), width - 1)
    top = min(int(math.floor(region[1] * height + 0.5)), height - 1)
    right = min(max(int(math.floor(region[2] * width + 0.5)), left + 1), width)
    bottom = min(max(int(math.floor(region[3] * height + 0.5)), top + 1), height)
    return left, top, right, bottom


def load_font(pil: Any) -> Any:
    try:
        return pil.ImageFont.load_default(size=FONT_SIZE)
    except (TypeError, OSError):
        return pil.ImageFont.load_default()


def text_width(draw: Any, font: Any, text: str) -> float:
    return draw.textlength(text, font=font)


def fit_text(draw: Any, font: Any, text: str, limit: float) -> str:
    """The text as it is when it fits in `limit` pixels, else cut and finished with three dots so that it fits."""
    if text_width(draw, font, text) <= limit:
        return text
    low, high = 0, len(text)
    while low < high:
        middle = (low + high + 1) // 2
        if text_width(draw, font, text[:middle] + "...") <= limit:
            low = middle
        else:
            high = middle - 1
    return text[:low] + "..."


def put_centred(canvas: Any, picture: Any, x: int, band_top: int, band_height: int) -> None:
    canvas.paste(picture, (x, band_top + (band_height - picture.size[1]) // 2))


# ---------------------------------------------------------------------------
# sheet
# ---------------------------------------------------------------------------

def footer_lines(anchor: Any) -> List[str]:
    """The three lines of text under the tiles of a sheet: the set, the keep line and the upload sentence."""
    keep = anchor.keep.strip()
    return ["set %s   made %s" % (anchor.name, anchor.made), "KEEP: %s" % (keep if keep else "(none)"),
            SHEET_UPLOAD_LINE]


def do_sheet(helper: Any, args: argparse.Namespace) -> Dict[str, Any]:
    pil = import_pillow(helper, "sheet")
    inbox = script_inbox(helper, args.inbox)
    check_looks(helper)
    anchor = open_set(helper, inbox, args.name)
    tiles = []  # type: List[Tuple[Any, Any]]
    for member, data in verified_members(helper, anchor):
        picture = decode_member(helper, pil, anchor, member, data).convert("RGB")
        tiles.append((member, scale_to(pil, picture, scaled_size(picture.size[0], picture.size[1], SHEET_TILE_HEIGHT))))
    inner = sum(tile.size[0] for _, tile in tiles) + GAP * (len(tiles) - 1)
    width = max(SHEET_MIN_WIDTH, 2 * MARGIN + inner)
    canvas = pil.Image.new("RGB", (width, SHEET_HEIGHT), BACKGROUND)
    draw = pil.ImageDraw.Draw(canvas)
    font = load_font(pil)
    x = MARGIN
    for member, tile in tiles:
        draw.text((x, MARGIN + LABEL_TOP), "%d  %s" % (member.pos, member.role), fill=WHITE, font=font)
        put_centred(canvas, tile, x, MARGIN + LABEL_BAND, SHEET_TILE_HEIGHT)
        x += tile.size[0] + GAP
    footer = MARGIN + LABEL_BAND + SHEET_TILE_HEIGHT + ROW_GAP
    for index, line in enumerate(footer_lines(anchor)):
        draw.text((MARGIN, footer + FOOTER_LINE * index), fit_text(draw, font, line, width - 2 * MARGIN - 1),
                  fill=WHITE, font=font)
    path = write_look(helper, anchor.name, "sheet", canvas)
    return {"ok": True, "command": "sheet", "file": path, "size": [width, SHEET_HEIGHT], "note": SHEET_NOTE}


# ---------------------------------------------------------------------------
# beside
# ---------------------------------------------------------------------------

def do_beside(helper: Any, args: argparse.Namespace) -> Dict[str, Any]:
    pil = import_pillow(helper, "beside")
    region = parse_region(helper, args.zoom, "--zoom") if args.zoom is not None else None
    inbox = script_inbox(helper, args.inbox)
    check_looks(helper)
    roots, ignored = narrowed_roots(helper, args.ref_root, inbox)
    loaded = read_picture(helper, args.result, "result", roots)
    anchor = open_set(helper, inbox, args.name)
    members = verified_members(helper, anchor)
    first, first_data = members[0]
    left_full = decode_member(helper, pil, anchor, first, first_data).convert("RGB")
    right_full = flatten(pil, decode_result(helper, pil, loaded, "result", args.result), GREY)
    columns = []  # type: List[Tuple[Any, Any, str]]
    for picture, label in ((left_full, "ANCHOR 1 (%s)" % first.role), (right_full, "RESULT")):
        size = scaled_size(picture.size[0], picture.size[1], BESIDE_HEIGHT)
        columns.append((scale_to(pil, picture, size), picture, label))
    left_width, right_width = columns[0][0].size[0], columns[1][0].size[0]
    width = 2 * MARGIN + left_width + GAP + right_width
    height = MARGIN + LABEL_BAND + BESIDE_HEIGHT + MARGIN
    if region is not None:
        height = MARGIN + LABEL_BAND + BESIDE_HEIGHT + ROW_GAP + LABEL_BAND + BESIDE_ZOOM_HEIGHT + MARGIN
    canvas = pil.Image.new("RGB", (width, height), BACKGROUND)
    draw = pil.ImageDraw.Draw(canvas)
    font = load_font(pil)
    xs = [MARGIN, MARGIN + left_width + GAP]
    top_band = MARGIN + LABEL_BAND
    for x, (scaled, _, label) in zip(xs, columns):
        draw.text((x, MARGIN + LABEL_TOP), label, fill=WHITE, font=font)
        put_centred(canvas, scaled, x, top_band, BESIDE_HEIGHT)
    if region is not None:
        zoom_label = top_band + BESIDE_HEIGHT + ROW_GAP
        zoom_band = zoom_label + LABEL_BAND
        for x, column_width, (_, full, label) in zip(xs, (left_width, right_width), columns):
            crop = full.crop(region_box(full.size, region))
            new_width, new_height = scaled_size(crop.size[0], crop.size[1], BESIDE_ZOOM_HEIGHT)
            if new_width > column_width:
                new_height = max(1, int(round(new_height * column_width / float(new_width))))
                new_width = column_width
            text = "ANCHOR 1 zoom" if label.startswith("ANCHOR") else "RESULT zoom"
            draw.text((x, zoom_label + LABEL_TOP), text, fill=WHITE, font=font)
            put_centred(canvas, scale_to(pil, crop, (new_width, new_height)), x, zoom_band, BESIDE_ZOOM_HEIGHT)
    path = write_look(helper, anchor.name, "beside", canvas)
    answer = {"ok": True, "command": "beside", "file": path, "size": [width, height]}  # type: Dict[str, Any]
    if ignored:
        answer["ignoredRoots"] = ignored
    return answer


# ---------------------------------------------------------------------------
# zoom
# ---------------------------------------------------------------------------

def do_zoom(helper: Any, args: argparse.Namespace) -> Dict[str, Any]:
    pil = import_pillow(helper, "zoom")
    region = parse_region(helper, args.region, "the region")
    inbox = script_inbox(helper, args.inbox)
    check_looks(helper)
    roots, ignored = narrowed_roots(helper, args.ref_root, inbox)
    loaded = read_picture(helper, args.path, "picture", roots)
    picture = decode_result(helper, pil, loaded, "picture", args.path)
    crop = picture.crop(region_box(picture.size, region))
    size = scaled_size(crop.size[0], crop.size[1], ZOOM_HEIGHT)
    out = scale_to(pil, flatten(pil, crop, GREY), size)
    path = write_look(helper, "look", "zoom", out)
    answer = {"ok": True, "command": "zoom", "file": path, "of": loaded.real, "region": list(region),
              "size": [size[0], size[1]]}  # type: Dict[str, Any]
    if ignored:
        answer["ignoredRoots"] = ignored
    return answer


# ---------------------------------------------------------------------------
# measure: numbers only
# ---------------------------------------------------------------------------

def srgb_to_lab(np: Any, colours: Any) -> Any:
    """CIE Lab (D65, white 0.95047 1.0 1.08883) of an (n, 3) array of sRGB colours with values from 0 to 255."""
    c = np.asarray(colours, dtype=np.float64) / 255.0
    linear = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    matrix = np.array([[0.4124564, 0.3575761, 0.1804375],
                       [0.2126729, 0.7151522, 0.0721750],
                       [0.0193339, 0.1191920, 0.9503041]])
    t = linear.dot(matrix.T) / np.array([0.95047, 1.0, 1.08883])
    edge = 6.0 / 29.0
    f = np.where(t > edge ** 3, np.cbrt(t), t / (3.0 * edge ** 2) + 4.0 / 29.0)
    return np.stack([116.0 * f[:, 1] - 16.0, 500.0 * (f[:, 0] - f[:, 1]), 200.0 * (f[:, 1] - f[:, 2])], axis=1)


def figure_mask(np: Any, rgb: Any, key: Tuple[int, int, int]) -> Any:
    """True where a pixel is further than FIGURE_DISTANCE (Euclidean, in RGB) from the backdrop colour. Worked on
    strips of rows so that a big picture does not need a big temporary array."""
    mask = np.zeros(rgb.shape[:2], dtype=bool)
    key_array = np.array(key, dtype=np.int32)
    for top in range(0, rgb.shape[0], 256):
        diff = rgb[top:top + 256].astype(np.int32) - key_array
        mask[top:top + 256] = (diff * diff).sum(axis=2) > FIGURE_DISTANCE * FIGURE_DISTANCE
    return mask


def figure_box(helper: Any, np: Any, mask: Any, key_text: str, skip_top: float) -> Tuple[int, int, int, int]:
    """(top, bottom, left, right) of the figure: rows and columns with fewer than 3 figure pixels are ignored, and the
    top `skip_top` of the box is dropped."""
    rows = np.flatnonzero(mask.sum(axis=1) >= FIGURE_MIN_LINE)
    columns = np.flatnonzero(mask.sum(axis=0) >= FIGURE_MIN_LINE)
    if int(mask.sum()) < FIGURE_MIN_PIXELS or rows.size == 0 or columns.size == 0:
        raise helper.Failure("bad-input", "no figure was found: the picture is almost all backdrop (key %s)" % key_text)
    top, bottom, left, right = int(rows[0]), int(rows[-1]) + 1, int(columns[0]), int(columns[-1]) + 1
    return top + int(round(skip_top * (bottom - top))), bottom, left, right


def grid_bounds(np: Any, box: Tuple[int, int, int, int]) -> Tuple[Any, Any]:
    top, bottom, left, right = box
    return (np.linspace(0, bottom - top, CELL_ROWS + 1).round().astype(int),
            np.linspace(0, right - left, CELL_COLUMNS + 1).round().astype(int))


def cell_colour(np: Any, rgb: Any, mask: Any, y0: int, y1: int, x0: int, x1: int) -> Any:
    """The mean colour of the figure pixels of a cell, or None when fewer than half of its pixels are figure."""
    block = mask[y0:y1, x0:x1]
    if block.size == 0 or int(block.sum()) * 2 < block.size:
        return None
    return rgb[y0:y1, x0:x1][block].astype(np.float64).mean(axis=0)


def part_of(row: int) -> str:
    return "head" if row < 2 else "body" if row < 5 else "legs" if row < 7 else "feet"


def measure_backdrop(helper: Any, np: Any, rgb: Any, key: Tuple[int, int, int], key_text: str) -> Dict[str, Any]:
    height, width = rgb.shape[:2]
    if width < 32 or height < 32:
        raise helper.Failure("bad-input", "the result is smaller than 32 px on a side, too small to measure its "
                                          "corners")
    corners = []  # type: List[float]
    for x, y in ((8, 8), (width - 32, 8), (8, height - 32), (width - 32, height - 32)):
        mean = rgb[y:y + 24, x:x + 24].reshape(-1, 3).astype(np.float64).mean(axis=0)
        corners.append(round(float(np.sqrt(((mean - np.array(key, dtype=np.float64)) ** 2).sum())), 1))
    return {"name": "backdrop", "key": key_text, "corners": corners, "max": max(corners)}


def measure_colour(helper: Any, np: Any, anchor_rgb: Any, result_rgb: Any, key: Tuple[int, int, int], key_text: str,
                   skip_top: float, against: str) -> Dict[str, Any]:
    pictures = []  # type: List[Tuple[Any, Any, Tuple[int, int, int, int], Any, Any]]
    for rgb in (anchor_rgb, result_rgb):
        mask = figure_mask(np, rgb, key)
        box = figure_box(helper, np, mask, key_text, skip_top)
        rows, columns = grid_bounds(np, box)
        pictures.append((rgb, mask, box, rows, columns))
    first = []  # type: List[Any]
    second = []  # type: List[Any]
    places = []  # type: List[Tuple[int, int]]
    for row in range(CELL_ROWS):
        for column in range(CELL_COLUMNS):
            colours = []
            for rgb, mask, box, rows, columns in pictures:
                colours.append(cell_colour(np, rgb, mask, box[0] + int(rows[row]), box[0] + int(rows[row + 1]),
                                           box[2] + int(columns[column]), box[2] + int(columns[column + 1])))
            if colours[0] is not None and colours[1] is not None:
                first.append(colours[0])
                second.append(colours[1])
                places.append((row, column))
    if not places:
        raise helper.Failure("bad-input", "no part of the figure could be compared: the figure in the result and the "
                                          "figure in the anchor have no part in common")
    distances = np.sqrt(((srgb_to_lab(np, np.array(first)) - srgb_to_lab(np, np.array(second))) ** 2).sum(axis=1))
    order = sorted(range(len(places)), key=lambda index: (-float(distances[index]), places[index]))[:3]
    return {"name": "colour", "against": against, "cells_used": len(places),
            "median": round(float(np.median(distances)), 1), "p90": round(float(np.percentile(distances, 90)), 1),
            "worst": [{"row": places[index][0], "col": places[index][1], "part": part_of(places[index][0]),
                       "de": round(float(distances[index]), 1)} for index in order]}


def saturation_brightness(pil: Any, np: Any, rgb_image: Any) -> Tuple[float, float]:
    """Mean saturation and brightness (0 to 1). A picture wider than 256 px is shrunk to 256 wide first; a narrower
    one is measured as it is, never blown up (a very thin picture would need gigabytes)."""
    width, height = rgb_image.size
    small = rgb_image
    if width > SCENE_WIDTH:
        small = rgb_image.resize((SCENE_WIDTH, max(1, int(round(height * SCENE_WIDTH / float(width))))),
                                 box_filter(pil))
    hsv = np.asarray(small.convert("HSV"), dtype=np.float64)
    return float(hsv[:, :, 1].mean()) / 255.0, float(hsv[:, :, 2].mean()) / 255.0


def measure_scene(pil: Any, np: Any, result_rgb: Any, members: List[Tuple[Any, Any]]) -> Dict[str, Any]:
    result = saturation_brightness(pil, np, result_rgb)
    listed = []  # type: List[Dict[str, Any]]
    values = {}  # type: Dict[str, List[Tuple[float, float]]]
    for member, rgb_image in members:
        found = saturation_brightness(pil, np, rgb_image)
        values.setdefault(member.role, []).append(found)
        listed.append({"n": member.pos, "role": member.role, "saturation": round(found[0], 3),
                       "brightness": round(found[1], 3)})
    source = "style" if "style" in values else "light" if "light" in values else "place"
    pool = values.get("style", []) + values.get("light", []) if source != "place" else values["place"]
    reference = (sum(item[0] for item in pool) / len(pool), sum(item[1] for item in pool) / len(pool))
    saturation, brightness = round(result[0], 3), round(result[1], 3)
    ref_saturation, ref_brightness = round(reference[0], 3), round(reference[1], 3)
    return {"name": "scene", "result": {"saturation": saturation, "brightness": brightness}, "members": listed,
            "reference": {"from": source, "saturation": ref_saturation, "brightness": ref_brightness},
            "delta": {"saturation": round(saturation - ref_saturation, 3),
                      "brightness": round(brightness - ref_brightness, 3)}}


def edge_map(pil: Any, np: Any, rgb_image: Any) -> Any:
    grey = np.asarray(rgb_image.convert("L").resize(LINEUP_SIZE, box_filter(pil)), dtype=np.float64)
    across = np.abs(np.diff(grey, axis=1))[:-1, :]
    down = np.abs(np.diff(grey, axis=0))[:, :-1]
    return (across + down).ravel()


def measure_lineup(helper: Any, pil: Any, np: Any, result_rgb: Any, place_rgb: Any, against: str) -> Dict[str, Any]:
    wide = result_rgb.size[0] / float(result_rgb.size[1])
    view = place_rgb.size[0] / float(place_rgb.size[1])
    if not (abs(wide - view) <= LINEUP_ASPECT_SLACK * view):
        raise helper.Failure("bad-input", "cannot line up: the result is %.2f wide for every 1 high and the view is "
                                          "%.2f" % (wide, view))
    mine, theirs = edge_map(pil, np, result_rgb), edge_map(pil, np, place_rgb)
    if float(mine.std()) == 0.0 or float(theirs.std()) == 0.0:
        r = 0.0
    else:
        r = float(np.corrcoef(mine, theirs)[0, 1])
        r = r if math.isfinite(r) else 0.0
    return {"name": "lineup", "against": against, "r": round(r, 3)}


def do_measure(helper: Any, args: argparse.Namespace) -> Dict[str, Any]:
    pil = import_pillow(helper, "measure")
    np = import_numpy(helper, "measure")
    skip_top = parse_skip_top(helper, args.skip_top)
    key_text, key = parse_key(helper, args.key)
    inbox = script_inbox(helper, args.inbox)
    check_looks(helper)
    roots, ignored = narrowed_roots(helper, args.ref_root, inbox)
    loaded = read_picture(helper, args.result, "result", roots)
    anchor = open_set(helper, inbox, args.name)
    members = verified_members(helper, anchor)
    identity = next((member for member, _ in members if member.role == "identity"), None)
    roles = [member.role for member, _ in members]
    run = []  # type: List[str]
    skipped = []  # type: List[Dict[str, str]]
    if identity is not None and key is not None:
        run += ["backdrop", "colour"]
    elif identity is not None or key is not None:
        why = NO_KEY_REASON if identity is not None else NO_IDENTITY_REASON
        skipped += [{"name": "backdrop", "why": why}, {"name": "colour", "why": why}]
    if any(role in ("style", "light", "place", "room") for role in roles):
        run.append("scene")
    if "place" in roles:
        run.append("lineup")
    if not run:
        raise helper.Failure("bad-input", skipped[0]["why"] if skipped else "nothing in this set can be measured")
    rgba = decode_result(helper, pil, loaded, "result", args.result)
    flattened = has_alpha(rgba)
    result_rgb = flatten(pil, rgba, key if key is not None else (255, 255, 255)) if flattened else rgba.convert("RGB")
    decoded = {}  # type: Dict[int, Any]
    data_of = dict((member.pos, data) for member, data in members)
    for member, _ in members:
        decoded[member.pos] = decode_member(helper, pil, anchor, member, data_of[member.pos]).convert("RGB")
    checks = []  # type: List[Dict[str, Any]]
    if "backdrop" in run:
        checks.append(measure_backdrop(helper, np, np.asarray(result_rgb), key, key_text))
    if "colour" in run:
        checks.append(measure_colour(helper, np, np.asarray(decoded[identity.pos]), np.asarray(result_rgb), key,
                                     key_text, skip_top, identity.file))
    if "scene" in run:
        scene_members = [(member, decoded[member.pos]) for member, _ in members
                         if member.role in ("style", "light", "place", "room")]
        checks.append(measure_scene(pil, np, result_rgb, scene_members))
    if "lineup" in run:
        place = next(member for member, _ in members if member.role == "place")
        checks.append(measure_lineup(helper, pil, np, result_rgb, decoded[place.pos], place.file))
    entry = {"path": loaded.real, "size": [result_rgb.size[0], result_rgb.size[1]]}  # type: Dict[str, Any]
    if flattened:
        entry["flattened"] = True
    answer = {"ok": True, "command": "measure", "set": anchor.name, "result": entry, "checks": checks,
              "skipped": skipped, "note": MEASURE_NOTE}  # type: Dict[str, Any]
    if ignored:
        answer["ignoredRoots"] = ignored
    return answer


# ---------------------------------------------------------------------------
# Command line
# ---------------------------------------------------------------------------

VALUE_FLAGS = frozenset(["--inbox", "--ref-root", "--zoom", "--key", "--skip-top"])
SWITCH_FLAGS = frozenset(["--help", "-h"])


def glue_dash_values(argv: List[str]) -> List[str]:
    """argparse would take a value like "-0.1,0,1,1" for a flag of its own. Join it to its flag with "=" so that it
    reaches the number rules and is refused as a bad value, not as a usage error."""
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


def build_parser(helper: Any) -> argparse.ArgumentParser:
    parser = helper.JsonParser(
        prog="anchor_look.py", allow_abbrev=False,
        description="Pictures to look at, and numbers, for desk-art anchor sets. Every call prints exactly one JSON "
                    "object. Run it with ComfyUI's Python: <python> -I -B anchor_look.py <command> ...")
    commands = parser.add_subparsers(dest="command", metavar="<command>", required=True)
    inbox = helper.JsonParser(add_help=False, allow_abbrev=False)
    inbox.add_argument("--inbox", metavar="DIR", help="the art inbox (the folder the desk-art status tool shows after "
                                                      "'Art inbox:'); default: the built-in default inbox")
    roots = helper.JsonParser(add_help=False, allow_abbrev=False)
    roots.add_argument("--ref-root", action="append", metavar="DIR",
                       help="a folder pictures may be read from (repeat, up to 20; start with / or ~/). It can only "
                            "narrow the standard art folders; the inbox and the cache are always allowed")

    def add(name: str, summary: str, parents: List[Any]) -> argparse.ArgumentParser:
        return commands.add_parser(name, parents=parents, allow_abbrev=False, help=summary, description=summary)

    sheet = add("sheet", "Make one picture of a saved set for the owner to look at: its pictures in order, the keep "
                         "line and the upload sentence.", [inbox])
    sheet.add_argument("name", metavar="NAME", help="the saved set")
    beside = add("beside", "Make one picture with a result next to the set's first picture, and optionally the same "
                           "part of each below.", [inbox, roots])
    beside.add_argument("name", metavar="NAME", help="the saved set")
    beside.add_argument("result", metavar="RESULT", help="the picture to look at")
    beside.add_argument("--zoom", metavar="X0,Y0,X1,Y1",
                        help="four fractions of the picture (left, top, right, bottom, each side at least 0.05)")
    zoom = add("zoom", "Cut one region out of any allowed picture and enlarge it. No set is needed.", [inbox, roots])
    zoom.add_argument("path", metavar="PATH", help="the picture")
    zoom.add_argument("region", metavar="X0,Y0,X1,Y1",
                      help="four fractions of the picture (left, top, right, bottom, each side at least 0.05)")
    measure = add("measure", "Print numbers (never a verdict) that compare a result with a saved set.", [inbox, roots])
    measure.add_argument("name", metavar="NAME", help="the saved set")
    measure.add_argument("result", metavar="RESULT", help="the picture to measure")
    measure.add_argument("--key", metavar="#RRGGBB", help="the flat backdrop colour (quote it in the shell)")
    measure.add_argument("--skip-top", metavar="F", help="leave out the top F of the figure, from 0 to 0.5")
    return parser


COMMANDS = {"sheet": do_sheet, "beside": do_beside, "zoom": do_zoom, "measure": do_measure}


def help_result(shown: Any) -> Dict[str, Any]:
    parts = shown.prog.split()
    return {"ok": True, "command": parts[1] if len(parts) > 1 else None, "help": shown.text}


def run_cli(argv: List[str], stdin_bytes: Optional[bytes] = None) -> Tuple[int, Dict[str, Any]]:
    """Parse and run one command. It never raises. None of these commands reads standard input; `stdin_bytes` exists
    so that every script of this skill can be called the same way."""
    try:
        helper = get_helper()
    except Exception:
        return 1, {"ok": False, "code": "internal", "error": HELPER_MISSING}
    try:
        args = build_parser(helper).parse_args(glue_dash_values(list(argv)))
        return 0, COMMANDS[args.command](helper, args)
    except helper.HelpShown as shown:
        return 0, help_result(shown)
    except helper.UsageError as usage:
        return 3, {"ok": False, "code": "usage", "error": usage.message, "usage": usage.usage}
    except helper.Failure as failure:
        return 2, failure.to_result()
    except KeyboardInterrupt:
        return 1, {"ok": False, "code": "internal", "error": "Interrupted: stopped by a signal"}
    except Exception as exc:                                 # unexpected: report it, never crash silently
        try:
            sys.stderr.write("anchor_look: unexpected error\n" + traceback.format_exc())
            sys.stderr.flush()
        except (OSError, ValueError):
            pass
        return 1, {"ok": False, "code": "internal", "error": helper.one_line("%s: %s" % (type(exc).__name__, exc), 300)}


def emit_plain(result: Dict[str, Any]) -> None:
    """The way to print the answer when the helper could not be loaded (it has the real one)."""
    try:
        sys.stdout.write(json.dumps(result, ensure_ascii=True, separators=(",", ":"), default=str) + "\n")
        sys.stdout.flush()
    except (OSError, ValueError, AttributeError):
        pass


def main() -> int:
    code, result = run_cli(sys.argv[1:])
    try:
        emit = get_helper().emit
    except Exception:
        emit = emit_plain
    emit(result)
    return code


if __name__ == "__main__":
    sys.exit(main())
