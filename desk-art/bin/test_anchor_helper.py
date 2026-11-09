#!/usr/bin/env python3
"""Tests for the anchor-set part of desk_art.py (version 0.2.0). Everything runs against the fakes of
test_desk_art.py in a temporary "home": a fake codex, a fake agy, no real generator, no network. Sets are written by
write_set (anchor_test_support.py), the way the set builder would write them.

Run from the mod folder:
    /usr/bin/python3 -B -m unittest discover -s bin -p 'test_anchor_helper.py' -v
These tests need no Pillow, so they run on the system Python and on ComfyUI's Python alike.
"""

import ast
import copy
import hashlib
import json
import os
import random
import stat
import sys
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import desk_art  # noqa: E402
from anchor_test_support import card_bytes, comfy_pythons_on_disk, pillow_python, png_rgb, write_set  # noqa: E402
from test_desk_art import SandboxCase, WRAPPER_TEXT, MANIFEST_KEYS, codex_argv, jpeg_bytes  # noqa: E402
from test_desk_art import png_bytes, replace_by_another_picture, rewrite_in_place  # noqa: E402

# The agy wrapper, written out here so that changing it in the helper needs a decision (like WRAPPER_TEXT for Codex).
AGY_WRAPPER_TEXT = (
    "Use only your image generation tool to make exactly the image(s) described in REQUEST. If REFERENCES are listed, "
    "view them first and keep the same character, outfit and art style unless REQUEST says otherwise. Do not run "
    "terminal commands and do not edit project files. If you can, also save a copy of each finished image into the "
    "./out folder of the current directory. When done, reply with one short sentence.\n\nREQUEST:\n")

# The words of section 3.4 of the contract, written out as literals. A change to one word needs a decision.
GOLDEN_FIGURE = "\n".join([
    "REQUEST says otherwise for the reference pictures. They are numbered in the order they are attached or listed. "
    "Each has one job, given below: use each picture for that job only and take nothing else from it.",
    "Picture 1 (identity): the character to keep. Keep the face, hair, eyes, outfit, colours, body proportions and "
    "drawing style exactly as drawn in it. Change only what the request below asks to change.",
    "Keep exactly: round lenses dark olive green; suit muted beige; tie mustard yellow with dark spots; "
    "shoes dark brown."])

GOLDEN_CLOSEUP = "\n".join([
    "REQUEST says otherwise for the reference pictures. They are numbered in the order they are attached or listed. "
    "Each has one job, given below: use each picture for that job only and take nothing else from it.",
    "Picture 1 (place): the exact view to paint. Paint this same view again: the same objects, in the same places, "
    "at the same sizes and angles, from the same camera position. Do not move, turn, add or remove an object. "
    "Change only what the request below asks to change.",
    "Picture 2 (room): the whole room that picture 1 is cut from. Take the painting style, the colours, the "
    "materials and the daylight from it, and keep every object of picture 1 looking as it does here.",
    "Keep exactly: red vending machine at the right; dark timber wall; grey paving slabs.",
    "Picture 3 is extra: the request below says how to use it."])

GOLDEN_HOUR = "\n".join([
    "REQUEST says otherwise for the reference pictures. They are numbered in the order they are attached or listed. "
    "Each has one job, given below: use each picture for that job only and take nothing else from it.",
    "Picture 1 (place): the exact view to paint. Paint this same view again: the same objects, in the same places, "
    "at the same sizes and angles, from the same camera position. Do not move, turn, add or remove an object. "
    "Change only what the request below asks to change.",
    "Picture 2 (light): copy only its light and the colour of its light, for this hour of the day. Only the light "
    "changes: keep every object of picture 1 where it is, and do not copy what this picture shows."])

GOLDEN_STYLE = "\n".join([
    "REQUEST says otherwise for the reference pictures. They are numbered in the order they are attached or listed. "
    "Each has one job, given below: use each picture for that job only and take nothing else from it.",
    "Picture 1 (style): copy only how it is drawn: the painting style, the colours and how strong they are, the "
    "lighting, the line weight, the shading and the level of detail. Do not copy what it shows: not its subject, "
    "objects, clothes, pose, composition or backdrop.",
    "Picture 2 (style): copy only how it is drawn: the painting style, the colours and how strong they are, the "
    "lighting, the line weight, the shading and the level of detail. Do not copy what it shows: not its subject, "
    "objects, clothes, pose, composition or backdrop.",
    "Keep exactly: soft muted colour; hand painted look.",
    "Pictures 3 and 4 are extra: the request below says how to use them."])

GOLDEN_EXTRAS_LINE = "Pictures 2 to 4 are extra: the request below says how to use them."

KEEP_FIGURE = "round lenses dark olive green; suit muted beige; tie mustard yellow with dark spots; shoes dark brown"
KEEP_CLOSEUP = "red vending machine at the right; dark timber wall; grey paving slabs"
H1_TEXT = ("anchor must be the name of a saved anchor set: 1 to 40 characters, lower-case letters, digits, '_' or '-', "
           "starting with a letter or a digit")
LINK_HINT = "delete or rename that link, then try again"
REPAIR_HINT = "Save the set again under the next version name with the desk-art:anchor skill; do not edit a saved set."
CHANGED_HINT = "Save a new version of the set with the desk-art:anchor skill; do not edit a saved set."
NO_CODEX = {"DESK_ART_CODEX": "/nonexistent/codex", "DESK_ART_AGY": "/nonexistent/agy"}

# The rows both name tests use (the engine's tests hold the same rows as a literal of their own).
ANCHOR_NAME_TABLE_ACCEPTED = ["a", "0", "9lives", "nanami-final-v1", "a_b-c", "x" * 40]
ANCHOR_NAME_TABLE_REFUSED = ["", "-x", "_x", "Bad Name", "has space", "a/b", "../x", ".hidden", "x" * 41, "A",
                             "caf" + chr(0xE9), "a.b", "a\n", " a", "a "]

ALLOWED_IMPORTS = {"argparse", "collections", "errno", "fcntl", "hashlib", "io", "json", "math", "os", "re", "secrets",
                   "shutil", "signal", "stat", "subprocess", "sys", "threading", "time", "traceback", "unicodedata",
                   "typing"}

# The beginnings of the closed list of reasons a card can be refused for (R1 to R17 of the contract).
CARD_REASONS = (
    "it is bigger than 64 KB", "it is damaged", "it is not a JSON object",
    "it has a part desk-art does not know (", "it has no ", "format must be 1", "name must be the folder name",
    "made must look like", "keep must be plain ASCII text", "note must be plain ASCII text",
    "owner_said must be plain ASCII text", "members must be a list of 1 to 3 pictures",
    "a set holds at most 1 identity, 2 style, 1 place, 1 room and 1 light pictures",
    "a room or light picture needs a place picture in the set", 'keep or note mentions "',
    "a set cannot hold both a room picture and a light picture")
PICTURE_REASONS = (
    "it is not an object", "it has a part desk-art does not know (", "it has no ",
    "file must look like 01_identity.png",
    "the number in file must be its place in the list", "the role must be the word in file",
    "the fingerprint must be 64 characters: digits and the letters a to f",
    "size must be two whole numbers from 1 to 20000", "source must be a path and a fingerprint",
    "prep must be plain ASCII text of at most 200 characters",
    "provenance must be one of owner, supplied, generated")

CARD_FOLDER = "card-v1"


def closed_reason(reason):
    """True when `reason` is one of the closed reasons, with the key or number filled in."""
    if reason.startswith("picture "):
        number, _, why = reason[len("picture "):].partition(": ")
        return number in ("1", "2", "3") and why.startswith(PICTURE_REASONS)
    return reason.startswith(CARD_REASONS)


def tree_snapshot(root):
    """(relative path, size, mtime_ns, mode) of every entry under root, links not followed."""
    found = []
    for folder, dirs, names in os.walk(root):
        for name in dirs + names:
            path = os.path.join(folder, name)
            info = os.lstat(path)
            found.append((os.path.relpath(path, root), info.st_size, info.st_mtime_ns, stat.S_IMODE(info.st_mode)))
    return sorted(found)


def good_card(roles=("identity",), name=CARD_FOLDER):
    """A card that passes every rule, with made-up fingerprints (nothing reads the pictures it names)."""
    members = []
    for number, role in enumerate(roles, start=1):
        members.append({
            "file": "%02d_%s.png" % (number, role), "role": role, "sha256": ("%08x" % (number * 2654435)) * 8,
            "size": [64, 48], "source": {"path": "/Users/someone/art/%s.png" % role, "sha256": "ab" * 32},
            "prep": "flatten on #FF00FF", "provenance": "owner"})
    return {"format": 1, "name": name, "made": "2026-11-09T14:02:11Z", "keep": "round lenses dark olive green",
            "note": "a note about it", "owner_said": "yes, use it", "members": members}


def card_rows():
    """(label, bytes of a broken card, how its refusal must begin). One row for each kind of damage."""
    rows = []

    def add(label, expected, edit=None, raw=None, roles=("identity",)):
        if raw is None:
            card = good_card(roles)
            if edit is not None:
                edit(card)
            raw = card_bytes(card)
        rows.append((label, raw, expected))

    def member(change):
        return lambda card: card["members"][0].update(change)

    def drop_member_key(key):
        return lambda card: card["members"][0].pop(key)
    good = card_bytes(good_card())
    add("65,537 bytes", "it is bigger than 64 KB", raw=good + b" " * (65537 - len(good)))
    for label, raw in (("open brace", b"{"), ("empty file", b""), ("bytes ff fe", b"\xff\xfe"),
                       ("utf-16", good.decode("ascii").encode("utf-16")),
                       ("utf-32", good.decode("ascii").encode("utf-32")),
                       ("byte-order mark", b"\xef\xbb\xbf" + good), ("key given twice", b'{"format": 1, "format": 1}')):
        add(label, "it is damaged", raw=raw)
    for label, raw in (("list", b"[]"), ("null", b"null"), ("number", b"3"), ("string", b'"card"')):
        add(label, "it is not a JSON object", raw=raw)
    add("unknown top-level key", "it has a part desk-art does not know (extra)", lambda card: card.update(extra=1))
    for key in ("format", "name", "made", "keep", "members"):
        add("no " + key, "it has no " + key, lambda card, key=key: card.pop(key))
    for value in (2, "1", True, 1.0):
        add("format %r" % (value,), "format must be 1", lambda card, value=value: card.update(format=value))
    add("name", "name must be the folder name", lambda card: card.update(name="other-v1"))
    add("name not a string", "name must be the folder name", lambda card: card.update(name=5))
    arabic = "".join(chr(0x660 + int(char)) if char.isdigit() else char for char in "2026-11-09T14:02:11Z")
    for label, value in (("date only", "2026-11-09"), ("no Z", "2026-11-09T14:02:11"), ("Arabic-Indic digits", arabic),
                         ("trailing newline", "2026-11-09T14:02:11Z\n"), ("not a string", 5)):
        add("made " + label, "made must look like", lambda card, value=value: card.update(made=value))
    for label, value in (("newline", "a\nb"), ("accent", "caf" + chr(0xE9)), ("301 characters", "x" * 301),
                         ("not a string", 5)):
        add("keep " + label, "keep must be plain ASCII text", lambda card, value=value: card.update(keep=value))
    for label, value in (("2 characters", "ab"), ("201 characters", "x" * 201), ("newline", "ab\ncd"),
                         ("not a string", 5), ("null", None)):
        add("note " + label, "note must be plain ASCII text", lambda card, value=value: card.update(note=value))
    add("owner_said 2 characters", "owner_said must be plain ASCII text", lambda card: card.update(owner_said="ab"))
    add("keep names the pool", 'keep or note mentions "pool"', lambda card: card.update(keep="the pool picture"))
    add("note names the onsen", 'keep or note mentions "onsen"', lambda card: card.update(note="Onsen outfits"))
    add("keep names a swim run together", 'keep or note mentions "swim"', lambda card: card.update(keep="MakiSwimwear"))
    add("note names a bath after a digit", 'keep or note mentions "bath"', lambda card: card.update(note="room 2bath"))
    add("no members", "members must be a list of 1 to 3 pictures", lambda card: card.update(members=[]))
    add("four members", "members must be a list of 1 to 3 pictures",
        lambda card: card.update(members=card["members"] * 4))
    add("members a dict", "members must be a list of 1 to 3 pictures", lambda card: card.update(members={}))
    add("member not an object", "picture 1: it is not an object", lambda card: card.update(members=[5]))
    add("member unknown key", "picture 1: it has a part desk-art does not know (x)", member({"x": 1}))
    for key in ("file", "role", "sha256"):
        add("member without " + key, "picture 1: it has no " + key, drop_member_key(key))
    for value in ("../x.png", "a/b.png", "01_identity.jpg", "01_Identity.png"):
        add("file " + value, "picture 1: file must look like 01_identity.png", member({"file": value}))
    add("file number", "picture 1: the number in file must be its place in the list",
        member({"file": "02_identity.png"}))
    add("role not the word in file", "picture 1: the role must be the word in file",
        member({"file": "01_style.png", "role": "identity"}))
    for value in ("pose", "Identity", 5):
        add("role %r" % (value,), "picture 1: the role must be the word in file", member({"role": value}))
    for label, value in (("capitals", "AB" * 32), ("63 characters", "ab" * 31 + "a")):
        add("sha256 " + label, "picture 1: the fingerprint must be 64 characters", member({"sha256": value}))
    for label, value in (("floats", [64.0, 48.0]), ("bools", [True, True]), ("zero", [0, 5]),
                         ("three numbers", [1, 2, 3])):
        add("size " + label, "picture 1: size must be two whole numbers from 1 to 20000", member({"size": value}))
    add("source without sha256", "picture 1: source must be a path and a fingerprint",
        member({"source": {"path": "/x/y.png"}}))
    add("prep not ASCII", "picture 1: prep must be plain ASCII text of at most 200 characters",
        member({"prep": "flatten on " + chr(0xE9)}))
    add("provenance robot", "picture 1: provenance must be one of owner, supplied, generated",
        member({"provenance": "robot"}))
    for label, roles in (("two identity", ("identity", "identity")), ("two place", ("place", "place")),
                         ("three style", ("style", "style", "style"))):
        add(label, "a set holds at most 1 identity, 2 style, 1 place, 1 room and 1 light pictures", roles=roles)
    for roles in (("room",), ("light",)):
        add("%s without place" % roles[0], "a room or light picture needs a place picture in the set", roles=roles)
    add("room and light together", "a set cannot hold both a room picture and a light picture",
        roles=("place", "room", "light"))
    return rows


class AnchorMixin(SandboxCase):
    """Helpers for tests about anchor sets."""

    KEEP = "round lenses dark olive green; suit muted beige"
    COLOURS = [(200, 30, 30), (30, 200, 30), (30, 30, 200)]

    def member_png(self, index):
        colour = self.COLOURS[index % len(self.COLOURS)]
        return png_rgb(8, 6, lambda x, y: colour)

    def make(self, name="nanami-final-v1", roles=("identity",), keep=KEEP, **kw):
        """Write a set with one flat picture of its own colour for each role. Returns (folder, [sha256 of each])."""
        members = [{"role": role, "png": self.member_png(index)} for index, role in enumerate(roles)]
        folder = write_set(self.sb, name, members, keep=keep, **kw)
        return folder, [hashlib.sha256(member["png"]).hexdigest() for member in members]

    def anchored(self, name, extras=(), prompt="One change only: a warm smile.", command="codex", env=None,
                 label="hero", roots="home"):
        flags = [flag for path in extras for flag in ("--ref", path)]
        return self.cli(command, "--label", label, "--prompt-stdin", "--anchor", name, *self.root_args(roots), *flags,
                        stdin=prompt, env=env)

    def extra_picture(self, name="extra.png", color=(9, 9, 9)):
        return self.sb.write_png(os.path.join(self.sb.art, name), color=color)

    def exec_call(self):
        calls = self.sb.calls(self.sb.codex_log, "exec")
        self.assertEqual(len(calls), 1)
        return calls[0]

    def agy_call(self):
        calls = self.sb.calls(self.sb.agy_log)
        self.assertEqual(len(calls), 1)
        return calls[0]

    def work_of(self, data):
        return os.path.join(self.sb.cache, "jobs", data["jobId"], "work")

    def card_sha(self, folder):
        with open(os.path.join(folder, "anchor.json"), "rb") as handle:
            return hashlib.sha256(handle.read()).hexdigest()

    def assert_clean(self):
        """No generator was started, no job folder is left and nothing was filed."""
        self.assertEqual(self.sb.calls(self.sb.codex_log, "exec"), [])
        self.assertEqual(self.sb.calls(self.sb.agy_log), [])
        jobs = os.path.join(self.sb.cache, "jobs")
        self.assertEqual(os.listdir(jobs) if os.path.isdir(jobs) else [], [])
        self.assertEqual(self.sb.manifest(), [])

    def assert_nothing_started(self, result):
        self.assertEqual(result.code, 2, result.out)
        self.assert_clean()

    def assert_refused(self, result, words, code="bad-input"):
        """A refusal before anything started, in plain words ending with 'Nothing was sent.'."""
        self.assert_nothing_started(result)
        self.assertEqual(result.data["code"], code, result.out)
        self.assertIn(words, result.data["error"])
        self.assertTrue(result.data["error"].endswith("Nothing was sent."), result.data["error"])

    def assert_refused_inproc(self, outcome, words, code="bad-input"):
        exit_code, data = outcome
        self.assertEqual((exit_code, data["code"]), (2, code), data)
        self.assertIn(words, data["error"])
        self.assertTrue(data["error"].endswith("Nothing was sent."), data["error"])
        self.assert_clean()


# ---------------------------------------------------------------------------
# The words
# ---------------------------------------------------------------------------

class AnchorWordsTests(AnchorMixin):
    def load(self, name):
        return desk_art.load_anchor(self.sb.inbox, name)

    def test_the_constants_are_the_contract(self):
        self.assertEqual(desk_art.ANCHOR_ROLES, ("identity", "style", "place", "room", "light"))
        self.assertEqual(desk_art.ANCHOR_ROLE_LIMITS, {"identity": 1, "style": 2, "place": 1, "room": 1, "light": 1})
        self.assertEqual(desk_art.ANCHOR_ROLE_LIMITS["identity"], 1)
        self.assertEqual(desk_art.ANCHOR_CARD_KEYS, ("format", "name", "made", "keep", "note", "owner_said", "members"))
        self.assertEqual(desk_art.ANCHOR_MEMBER_KEYS,
                         ("file", "role", "sha256", "size", "source", "prep", "provenance"))
        self.assertEqual(desk_art.ANCHOR_PROVENANCE, ("owner", "supplied", "generated"))
        self.assertEqual(desk_art.ANCHOR_SCOPE_WORDS,
                         ("swim", "bikini", "underwear", "lingerie", "towel", "bath", "onsen", "sauna", "pool", "beach",
                          "pyjama", "pajama", "romance pose", "ask for a pose", "pose ladder", "outfits"))
        self.assertEqual(desk_art.ANCHOR_WORDS_VERSION, "1")
        self.assertEqual(desk_art.ANCHOR_NOW_MAKE, "\n\nNOW MAKE:\n")
        self.assertEqual((desk_art.ANCHOR_FORMAT, desk_art.ANCHOR_DIR_NAME, desk_art.ANCHOR_CARD_NAME),
                         (1, "anchors", "anchor.json"))
        self.assertEqual((desk_art.ANCHOR_CARD_MAX_BYTES, desk_art.ANCHOR_MAX_MEMBERS, desk_art.ANCHOR_KEEP_MAX,
                          desk_art.ANCHOR_NOTE_MAX), (65536, 3, 300, 200))
        self.assertEqual(desk_art.ANCHOR_FILE_RE.pattern, r"0[1-3]_(identity|style|place|room|light)\.png")
        self.assertEqual(desk_art.ANCHOR_MADE_RE.pattern, r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z")
        self.assertEqual(desk_art.ANCHOR_SHA_RE.pattern, r"[0-9a-f]{64}")
        for role in desk_art.ANCHOR_ROLES:
            self.assertNotIn("pose", role)
        self.assertEqual(sorted(desk_art.ANCHOR_ROLE_TEXT), sorted(desk_art.ANCHOR_ROLES))
        for text in [desk_art.ANCHOR_INTRO, desk_art.ANCHOR_NOW_MAKE] + list(desk_art.ANCHOR_ROLE_TEXT.values()) \
                + list(desk_art.ANCHOR_SCOPE_WORDS):
            self.assertTrue(text.isascii(), text)
        self.assertEqual(desk_art.AnchorSet._fields[-1], "card_sha256")
        self.assertEqual(desk_art.AnchorSet._fields,
                         ("name", "dir", "keep", "note", "made", "owner_said", "members", "card_sha256"))
        self.assertEqual(desk_art.AnchorMember._fields, ("pos", "role", "file", "path", "sha256", "size"))
        self.assertTrue(issubclass(desk_art.AnchorCardProblem, Exception))
        self.assertEqual(desk_art.AnchorCardProblem("x y").reason, "x y")

    def test_golden_blocks(self):
        self.make("fig-v1", roles=("identity",), keep=KEEP_FIGURE)
        self.assertEqual(desk_art.anchor_block(self.load("fig-v1"), 0), GOLDEN_FIGURE)
        self.assertEqual(desk_art.anchor_block(self.load("fig-v1")), GOLDEN_FIGURE)         # extra defaults to 0
        self.make("closeup-v1", roles=("place", "room"), keep=KEEP_CLOSEUP)
        self.assertEqual(desk_art.anchor_block(self.load("closeup-v1"), 1), GOLDEN_CLOSEUP)
        self.make("hour-v1", roles=("place", "light"), keep="")
        self.assertEqual(desk_art.anchor_block(self.load("hour-v1"), 0), GOLDEN_HOUR)
        self.make("style-v1", roles=("style", "style"), keep="soft muted colour; hand painted look")
        self.assertEqual(desk_art.anchor_block(self.load("style-v1"), 2), GOLDEN_STYLE)
        self.make("one-v1", roles=("identity",), keep=KEEP_FIGURE)
        last = desk_art.anchor_block(self.load("one-v1"), 3).split("\n")[-1]
        self.assertEqual(last, GOLDEN_EXTRAS_LINE)

    def test_the_place_picture_is_named_by_its_position(self):
        self.make("third-v1", roles=("style", "place", "room"), keep="")
        lines = desk_art.anchor_block(self.load("third-v1"), 0).split("\n")
        self.assertTrue(lines[3].startswith("Picture 3 (room): the whole room that picture 2 is cut from."), lines[3])
        self.assertIn("keep every object of picture 2 looking as it does here.", lines[3])
        self.make("light-v1", roles=("light", "place"), keep="")
        lines = desk_art.anchor_block(self.load("light-v1"), 0).split("\n")
        self.assertTrue(lines[1].startswith("Picture 1 (light): copy only its light"), lines[1])
        self.assertIn("keep every object of picture 2 where it is", lines[1])
        for line in lines:
            self.assertNotIn("{place}", line)

    def test_the_block_is_short_ascii_and_never_names_the_set(self):
        name = "zebra-hidden-set-v1"
        keep = ("red wall; blue door; " * 20)[:300]
        members = [{"role": "place", "png": self.member_png(0), "prep": "crop 1,2,3,4; zebra-prep-text",
                    "source": {"path": "/Users/x/Original-zebra-source.png", "sha256": "cd" * 32}},
                   {"role": "style", "png": self.member_png(1)}, {"role": "style", "png": self.member_png(2)}]
        write_set(self.sb, name, members, keep=keep, note="zebra-note-text", owner_said="zebra-owner-words")
        anchor = self.load(name)
        self.assertEqual(len(anchor.keep), 300)
        block = desk_art.anchor_block(anchor, 3)
        self.assertTrue(block.isascii())
        self.assertLessEqual(len(block), 2000)
        self.assertIn(keep.strip().rstrip("."), block)
        for secret in (name, "zebra", "01_place.png", "02_style.png", "anchor.json", "Original-zebra-source",
                       "/Users/x", "cdcdcdcd"):
            self.assertNotIn(secret, block)
        self.assertEqual(block.count("\n"), 3 + 1 + 1)                      # intro, 3 pictures, keep, extras line

    def test_keep_is_normalised(self):
        for keep in ("a; b.", "a; b", "a; b...", "  a; b.  "):
            self.make("keep-v1", roles=("identity",), keep=keep)
            lines = desk_art.anchor_block(self.load("keep-v1"), 0).split("\n")
            self.assertEqual(len(lines), 3, keep)
            self.assertEqual(lines[2], "Keep exactly: a; b.", keep)
        for keep in (".", "   ", "", "...", " . "):
            self.make("keep-v1", roles=("identity",), keep=keep)
            lines = desk_art.anchor_block(self.load("keep-v1"), 0).split("\n")
            self.assertEqual(len(lines), 2, repr(keep))
            self.assertFalse(any(line.startswith("Keep exactly") for line in lines), repr(keep))

    def test_request_is_block_then_now_make_then_prompt(self):
        self.make("req-v1", roles=("place", "room"), keep=KEEP_CLOSEUP)
        anchor = self.load("req-v1")
        for extra in (0, 1, 3):
            self.assertEqual(desk_art.anchor_request(anchor, extra, "P"),
                             desk_art.anchor_block(anchor, extra) + "\n\nNOW MAKE:\n" + "P")
        prompt = "  a prompt with {place} and\nnewlines  "
        self.assertTrue(desk_art.anchor_request(anchor, 0, prompt).endswith("\n\nNOW MAKE:\n" + prompt))   # unchanged

    def test_an_answer_and_a_manifest_part_for_a_set(self):
        folder, shas = self.make("parts-v1", roles=("identity", "place"), keep="red")
        anchor = self.load("parts-v1")
        words = hashlib.sha256(desk_art.anchor_block(anchor, 2).encode("ascii")).hexdigest()
        self.assertEqual(desk_art.anchor_answer(anchor, 2), {
            "name": "parts-v1", "wordsVersion": "1", "wordsSha256": words, "cardSha256": self.card_sha(folder),
            "pictures": [{"n": 1, "role": "identity", "name": "parts-v1/01_identity.png", "sha8": shas[0][:8]},
                         {"n": 2, "role": "place", "name": "parts-v1/02_place.png", "sha8": shas[1][:8]}],
            "extra": 2})
        self.assertEqual(desk_art.anchor_manifest(anchor, 2), {
            "name": "parts-v1", "wordsVersion": "1", "wordsSha256": words, "cardSha256": self.card_sha(folder),
            "roles": ["identity", "place"], "extra": 2})
        self.assertEqual(list(desk_art.anchor_answer(anchor, 0).keys()),
                         ["name", "wordsVersion", "wordsSha256", "cardSha256", "pictures", "extra"])
        self.assertEqual(list(desk_art.anchor_manifest(anchor, 0).keys()),
                         ["name", "wordsVersion", "wordsSha256", "cardSha256", "roles", "extra"])

    def test_pieces_that_name_the_pictures(self):
        self.make("names-v1", roles=("place", "room"), keep="red")
        anchor = self.load("names-v1")
        self.assertEqual(desk_art.anchor_ref_paths(anchor), [member.path for member in anchor.members])
        self.assertEqual([os.path.basename(path) for path in desk_art.anchor_ref_paths(anchor)],
                         ["01_place.png", "02_room.png"])
        checked = [desk_art.Ref("a", "/x/a", "png", 1, 1), desk_art.Ref("b", "/x/b", "png", 1, 2),
                   desk_art.Ref("extra.png", "/x/e", "png", 1, 3)]
        named = desk_art.name_anchor_refs(anchor, checked)
        self.assertEqual([ref.name for ref in named], ["names-v1/01_place.png", "names-v1/02_room.png", "extra.png"])
        self.assertEqual([ref[1:] for ref in named], [ref[1:] for ref in checked])         # only the names changed
        staged = [desk_art.Staged("n", "/w/refs/ref1.png", "png", "aa" * 32, 1),
                  desk_art.Staged("n", "/w/refs/ref2.png", "png", "bb" * 32, 1),
                  desk_art.Staged("n", "/w/refs/ref3.jpg", "jpeg", "cc" * 32, 1)]
        self.assertEqual(desk_art.agy_reference_lines(staged, None),
                         ["./refs/ref1.png", "./refs/ref2.png", "./refs/ref3.jpg"])
        self.assertEqual(desk_art.agy_reference_lines(staged, anchor),
                         ["./refs/ref1.png (picture 1, place)", "./refs/ref2.png (picture 2, room)",
                          "./refs/ref3.jpg (picture 3, extra)"])
        self.assertEqual(desk_art.agy_reference_lines([], anchor), [])

    def test_load_anchor_gives_the_card_as_a_set(self):
        folder, shas = self.make("load-v1", roles=("identity", "style"), keep="red wall")
        anchor = self.load("load-v1")
        self.assertEqual((anchor.name, anchor.dir, anchor.keep, anchor.note, anchor.made, anchor.owner_said),
                         ("load-v1", folder, "red wall", None, "2026-11-09T12:00:00Z", None))
        self.assertEqual(anchor.card_sha256, self.card_sha(folder))
        self.assertEqual([(m.pos, m.role, m.file, m.sha256, m.size) for m in anchor.members],
                         [(1, "identity", "01_identity.png", shas[0], (8, 6)),
                          (2, "style", "02_style.png", shas[1], (8, 6))])
        self.assertEqual([m.path for m in anchor.members],
                         [os.path.join(folder, "01_identity.png"), os.path.join(folder, "02_style.png")])
        write_set(self.sb, "load-v1", [{"role": "identity", "png": self.member_png(0)}], keep="x", note="a note",
                  owner_said="their words")
        again = self.load("load-v1")
        self.assertEqual((again.note, again.owner_said), ("a note", "their words"))

    def test_saved_anchor_names(self):
        self.assertEqual(desk_art.saved_anchor_names(self.sb.inbox), [])                 # no inbox at all
        for name in ("zeta-v1", "alpha-v1", "mid-v2"):
            self.make(name)
        write_set(self.sb, "Upper-v1", [{"role": "identity", "png": self.member_png(0)}])   # a name that is no label
        os.makedirs(os.path.join(self.sb.inbox, "anchors", "unfinished-v1"))                   # no card
        os.makedirs(os.path.join(self.sb.inbox, "anchors", "carddir-v1", "anchor.json"))      # a card that is a folder
        with open(os.path.join(self.sb.inbox, "anchors", "afile-v1"), "w") as handle:           # not a folder
            handle.write("x")
        anchors = os.path.join(self.sb.inbox, "anchors")
        os.symlink(os.path.join(anchors, "alpha-v1"), os.path.join(anchors, "link-v1"))
        self.assertEqual(desk_art.saved_anchor_names(self.sb.inbox), ["alpha-v1", "mid-v2", "zeta-v1"])
        for number in range(110):
            self.make("many%03d-v1" % number)
        names = desk_art.saved_anchor_names(self.sb.inbox)
        self.assertEqual(len(names), 100)
        self.assertEqual(names, sorted(names))
        self.assertEqual(names[0], "alpha-v1")


# ---------------------------------------------------------------------------
# Codex runs
# ---------------------------------------------------------------------------

class AnchorCodexTests(AnchorMixin):
    def test_codex_without_anchor_is_unchanged(self):
        """The golden case: a call without --anchor gives Codex what it always got."""
        one = self.extra_picture("one.png", color=(5, 5, 5))
        two = self.sb.write_file(os.path.join(self.sb.art, "two.jpg"), jpeg_bytes())
        prompt = "One change only: a warm smile."
        result = self.codex(prompt, extra=("--ref", one, "--ref", two))
        self.assertEqual(result.code, 0, result.out + result.err)
        call = self.exec_call()
        work = self.work_of(result.data)
        refs = os.path.join(work, "refs")
        self.assertEqual(call["argv"], codex_argv(work, os.path.join(refs, "ref1.png"), os.path.join(refs, "ref2.jpg")))
        self.assertEqual(call["prompt"], WRAPPER_TEXT + prompt)
        self.assertEqual(call["positional"], ["-"])
        shas = [desk_art.sha256_file(one), desk_art.sha256_file(two)]
        self.assertEqual(result.data["refsSent"], [
            {"name": "one.png", "sha8": shas[0][:8], "bytes": os.path.getsize(one)},
            {"name": "two.jpg", "sha8": shas[1][:8], "bytes": os.path.getsize(two)}])
        self.assertNotIn("anchor", result.data)
        self.assertEqual(list(result.data.keys()), ["ok", "backend", "jobId", "threadId", "finalMessage", "elapsedSec",
                                                    "images", "usage", "refsSent", "matchedBy"])
        (row,) = self.sb.manifest()
        self.assertEqual(list(row.keys()), MANIFEST_KEYS)
        self.assertEqual(row["refs"], [{"name": "one.png", "sha256": shas[0]}, {"name": "two.jpg", "sha256": shas[1]}])
        self.assertEqual(row["prompt"], prompt)

    def test_a_call_without_anchor_ignores_the_anchors_folder(self):
        self.make("fine-v1")
        os.makedirs(os.path.join(self.sb.inbox, "anchors", "half-v1"))
        with open(os.path.join(self.sb.inbox, "anchors", "odd-v1"), "w") as handle:
            handle.write("not a folder")
        before = tree_snapshot(os.path.join(self.sb.inbox, "anchors"))
        result = self.codex("plain prompt")
        self.assertEqual(result.code, 0, result.out)
        self.assertEqual(self.exec_call()["prompt"], WRAPPER_TEXT + "plain prompt")
        self.assertNotIn("anchor", result.data)
        self.assertEqual(list(self.sb.manifest()[0].keys()), MANIFEST_KEYS)
        self.assertEqual(tree_snapshot(os.path.join(self.sb.inbox, "anchors")), before)

    def test_codex_sends_the_set_first_in_order_then_the_extras_with_the_exact_words(self):
        name = "courtyard-vending-v1"
        folder, shas = self.make(name, roles=("place", "room"), keep=KEEP_CLOSEUP)
        extra = self.extra_picture()
        prompt = "The same view, 16:9. No people, no animals, no text, no logos."
        result = self.anchored(name, extras=[extra], prompt=prompt)
        self.assertEqual(result.code, 0, result.out + result.err)
        call = self.exec_call()
        refs = os.path.join(self.work_of(result.data), "refs")
        self.assertEqual(call["images"], [os.path.join(refs, "ref1.png"), os.path.join(refs, "ref2.png"),
                                          os.path.join(refs, "ref3.png")])
        self.assertEqual([info["sha256"] for info in call["image_info"]], shas + [desk_art.sha256_file(extra)])
        anchor = desk_art.load_anchor(self.sb.inbox, name)
        self.assertEqual(call["prompt"], WRAPPER_TEXT + desk_art.anchor_request(anchor, 1, prompt))
        self.assertEqual(call["prompt"], WRAPPER_TEXT + GOLDEN_CLOSEUP + "\n\nNOW MAKE:\n" + prompt)
        self.assertEqual(call["argv"], codex_argv(self.work_of(result.data), *call["images"]))
        words = hashlib.sha256(GOLDEN_CLOSEUP.encode("ascii")).hexdigest()
        self.assertEqual(result.data["anchor"], {
            "name": name, "wordsVersion": "1", "wordsSha256": words, "cardSha256": self.card_sha(folder),
            "pictures": [{"n": 1, "role": "place", "name": name + "/01_place.png", "sha8": shas[0][:8]},
                         {"n": 2, "role": "room", "name": name + "/02_room.png", "sha8": shas[1][:8]}],
            "extra": 1})
        self.assertEqual(list(result.data["anchor"].keys()),
                         ["name", "wordsVersion", "wordsSha256", "cardSha256", "pictures", "extra"])
        self.assertEqual(list(result.data.keys())[-2:], ["matchedBy", "anchor"])         # last key, before any skipped*
        self.assertEqual([ref["name"] for ref in result.data["refsSent"]],
                         [name + "/01_place.png", name + "/02_room.png", "extra.png"])
        self.assertEqual([ref["sha8"] for ref in result.data["refsSent"]],
                         [sha[:8] for sha in shas] + [desk_art.sha256_file(extra)[:8]])

    def test_codex_manifest_row_has_the_anchor_key_last(self):
        name = "courtyard-vending-v1"
        folder, shas = self.make(name, roles=("place", "room"), keep=KEEP_CLOSEUP)
        extra = self.extra_picture()
        prompt = "The same view, 16:9."
        self.assertEqual(self.anchored(name, extras=[extra], prompt=prompt).code, 0)
        (row,) = self.sb.manifest()
        self.assertEqual(list(row.keys()), MANIFEST_KEYS + ["anchor"])
        self.assertEqual(row["anchor"], {
            "name": name, "wordsVersion": "1",
            "wordsSha256": hashlib.sha256(GOLDEN_CLOSEUP.encode("ascii")).hexdigest(),
            "cardSha256": self.card_sha(folder), "roles": ["place", "room"], "extra": 1})
        self.assertEqual(row["prompt"], prompt)                                 # the caller's words only
        self.assertEqual(row["promptSha256"], desk_art.sha256_text(prompt))
        self.assertEqual(row["refs"], [{"name": name + "/01_place.png", "sha256": shas[0]},
                                       {"name": name + "/02_room.png", "sha256": shas[1]},
                                       {"name": "extra.png", "sha256": desk_art.sha256_file(extra)}])
        self.assertEqual(row["backend"], "codex")

    def test_a_set_alone_needs_no_refs(self):
        name = "alone-v1"
        self.make(name, roles=("identity",), keep=KEEP_FIGURE)
        result = self.anchored(name, prompt="One change only: a warm, relaxed smile.")
        self.assertEqual(result.code, 0, result.out + result.err)
        self.assertEqual(result.data["anchor"]["extra"], 0)
        self.assertEqual(self.exec_call()["prompt"],
                         WRAPPER_TEXT + GOLDEN_FIGURE + "\n\nNOW MAKE:\n" + "One change only: a warm, relaxed smile.")
        self.assertNotIn("extra:", self.exec_call()["prompt"])
        self.assertEqual(len(self.exec_call()["images"]), 1)
        self.assertEqual(self.sb.manifest()[0]["anchor"]["extra"], 0)

    def test_a_call_may_carry_six_pictures_in_all(self):
        self.make("three-v1", roles=("place", "room", "style"), keep="red")
        self.make("one-v1", roles=("identity",))
        extras = [self.extra_picture("e%d.png" % number, color=(number, 9, 9)) for number in range(1, 4)]
        too_many = self.anchored("three-v1", extras=extras + [extras[0]])
        self.assert_refused(too_many, "anchor set three-v1 holds 3 pictures, so you can add at most 3 more reference "
                                      "pictures (you gave 4).")
        single = self.anchored("one-v1", extras=[extras[0]] * 6)
        self.assert_refused(single, "anchor set one-v1 holds 1 picture, so you can add at most 5 more reference "
                                    "pictures (you gave 6).")
        self.assertIn("holds 1 picture,", single.data["error"])
        self.assertNotIn("hint", single.data)
        result = self.anchored("three-v1", extras=extras)                       # 3 + 3 = 6 in all
        self.assertEqual(result.code, 0, result.out + result.err)
        call = self.exec_call()
        self.assertEqual(len(call["images"]), 6)
        self.assertEqual(result.data["anchor"]["extra"], 3)
        self.assertTrue(call["prompt"].endswith("Pictures 4 to 6 are extra: the request below says how to use them."
                                                "\n\nNOW MAKE:\nOne change only: a warm smile."))
        fine = self.anchored("one-v1", extras=[extras[0]] * 5)                  # 1 + 5 = 6 in all
        self.assertEqual(fine.code, 0, fine.out)
        self.assertEqual(len(self.sb.calls(self.sb.codex_log, "exec")), 2)

    def test_the_agy_count_rule_is_the_same(self):
        self.make("three-v1", roles=("place", "room", "style"), keep="red")
        extra = self.extra_picture()
        refused = self.anchored("three-v1", extras=[extra] * 4, command="agy")
        self.assert_refused(refused, "holds 3 pictures, so you can add at most 3 more reference pictures (you gave 4)")
        fine = self.anchored("three-v1", extras=[extra] * 3, command="agy")
        self.assertEqual(fine.code, 0, fine.out)

    def test_extras_keep_their_own_folder_rule(self):
        name = "folders-v1"
        self.make(name, roles=("identity",))
        inside = self.extra_picture("inside.png")
        outside = self.sb.write_png(os.path.join(self.sb.home, "Pictures", "elsewhere.png"))
        refused = self.anchored(name, extras=[outside], roots=[self.sb.art])
        self.assert_nothing_started(refused)
        self.assertEqual(refused.data["code"], "bad-input")
        self.assertIn("is not in a folder desk-art may send from", refused.data["error"])
        fine = self.anchored(name, extras=[inside], roots=[self.sb.art])       # the set itself sits in the inbox
        self.assertEqual(fine.code, 0, fine.out)
        self.assertEqual(len(self.exec_call()["images"]), 2)

    def test_failure_after_staging_reports_the_anchor(self):
        name = "fail-v1"
        folder, shas = self.make(name, roles=("identity", "style"), keep="red")
        extra = self.extra_picture()
        result = self.anchored(name, extras=[extra], env={"FAKE_CODEX_MODE": "refusal"})
        self.assertEqual((result.code, result.data["code"]), (2, "codex-no-images"), result.out)
        self.assertEqual(result.data["anchor"], {
            "name": name, "wordsVersion": "1",
            "wordsSha256": desk_art.sha256_text(desk_art.anchor_block(desk_art.load_anchor(self.sb.inbox, name), 1)),
            "cardSha256": self.card_sha(folder),
            "pictures": [{"n": 1, "role": "identity", "name": name + "/01_identity.png", "sha8": shas[0][:8]},
                         {"n": 2, "role": "style", "name": name + "/02_style.png", "sha8": shas[1][:8]}],
            "extra": 1})
        self.assertEqual([ref["name"] for ref in result.data["refsSent"]],
                         [name + "/01_identity.png", name + "/02_style.png", "extra.png"])
        self.assertEqual(self.sb.manifest(), [])
        failed = self.anchored(name, env={"FAKE_CODEX_MODE": "error"})
        self.assertEqual((failed.code, failed.data["code"]), (2, "codex-failed"), failed.out)
        self.assertEqual(failed.data["anchor"]["extra"], 0)
        self.assertEqual(len(failed.data["anchor"]["pictures"]), 2)

    def test_a_run_that_never_started_carries_no_anchor(self):
        self.make("early-v1")
        early = self.anchored("early-v1", env=dict(NO_CODEX))
        self.assertEqual((early.code, early.data["code"]), (2, "codex-not-found"), early.out)
        self.assertNotIn("anchor", early.data)
        self.assertNotIn("refsSent", early.data)
        agy = self.anchored("early-v1", command="agy", env=dict(NO_CODEX))
        self.assertEqual((agy.code, agy.data["code"]), (2, "agy-not-installed"), agy.out)
        self.assertNotIn("anchor", agy.data)

    def test_a_generator_that_cannot_start_leaves_the_anchor_out_of_the_failure(self):
        """The program is found, the pictures are copied, and then the program does not start (its first line names
        an interpreter that is not there). Nothing was sent, so the failure lists no pictures and no set: the owner
        must not be told that a set was sent when it was not. A program that starts and fails does list the set."""
        name = "nostart-v1"
        self.make(name, roles=("identity", "style"))
        broken = self.sb.script("broken-generator", "#!/nonexistent/interpreter\nexit 0\n")
        extra = self.extra_picture()
        for command, code, words in (("codex", "codex-failed", "could not start codex"),
                                     ("agy", "agy-failed", "could not start agy")):
            with self.subTest(command):
                result = self.anchored(name, extras=[extra], command=command,
                                       env={"DESK_ART_CODEX": broken, "DESK_ART_AGY": broken})
                self.assertEqual((result.code, result.data["code"]), (2, code), result.out)
                self.assertTrue(result.data["error"].startswith(words), result.data["error"])
                self.assertEqual(result.data["refsSent"], [])
                self.assertNotIn("anchor", result.data)
                self.assertTrue(os.path.isdir(os.path.join(result.data["jobDir"], "work")))       # kept for a look
                self.assertFalse(os.path.exists(os.path.join(result.data["jobDir"], "work", "refs")))
                self.assertEqual(self.sb.manifest(), [])
        started = self.anchored(name, extras=[extra], env={"FAKE_CODEX_MODE": "error"})
        self.assertEqual((started.data["code"], started.data["anchor"]["name"]), ("codex-failed", name))
        self.assertEqual(len(started.data["refsSent"]), 3)


# ---------------------------------------------------------------------------
# Antigravity (agy) runs
# ---------------------------------------------------------------------------

class AnchorAgyTests(AnchorMixin):
    def test_agy_without_anchor_is_unchanged(self):
        one = self.extra_picture("one.png", color=(5, 5, 5))
        two = self.sb.write_file(os.path.join(self.sb.art, "two.jpg"), jpeg_bytes())
        prompt = "same girl, new outfit"
        result = self.agy(prompt, extra=("--ref", one, "--ref", two))
        self.assertEqual(result.code, 0, result.out + result.err)
        call = self.agy_call()
        listed = "\n\nREFERENCES:\n./refs/ref1.png\n./refs/ref2.jpg"
        self.assertEqual(call["prompt"], AGY_WRAPPER_TEXT + prompt + listed)
        self.assertEqual(call["prompt"], desk_art.AGY_WRAPPER + prompt + listed)
        self.assertEqual(call["argv"][:3], ["--output-format", "json", "-p"])
        self.assertEqual(len(call["argv"]), 4)
        self.assertEqual(call["refs"], ["ref1.png", "ref2.jpg"])
        self.assertNotIn("anchor", result.data)
        self.assertEqual(list(result.data.keys()), ["ok", "backend", "jobId", "conversationId", "agentStatus",
                                                    "finalMessage", "elapsedSec", "images", "refsSent", "matchedBy"])
        (row,) = self.sb.manifest()
        self.assertEqual(list(row.keys()), MANIFEST_KEYS)
        plain = self.agy("no references at all")
        self.assertEqual(plain.code, 0, plain.out)
        self.assertEqual(self.sb.calls(self.sb.agy_log)[-1]["prompt"], AGY_WRAPPER_TEXT + "no references at all")

    def test_agy_sends_the_set_with_role_notes(self):
        name = "courtyard-vending-v1"
        folder, shas = self.make(name, roles=("place", "room"), keep=KEEP_CLOSEUP)
        extra = self.sb.write_file(os.path.join(self.sb.art, "extra.jpg"), jpeg_bytes())
        prompt = "The same view, 16:9."
        result = self.anchored(name, extras=[extra], prompt=prompt, command="agy")
        self.assertEqual(result.code, 0, result.out + result.err)
        call = self.agy_call()
        anchor = desk_art.load_anchor(self.sb.inbox, name)
        self.assertEqual(call["prompt"], desk_art.AGY_WRAPPER + desk_art.anchor_request(anchor, 1, prompt)
                         + "\n\nREFERENCES:\n./refs/ref1.png (picture 1, place)\n./refs/ref2.png (picture 2, room)"
                           "\n./refs/ref3.jpg (picture 3, extra)")
        self.assertEqual(call["prompt"], AGY_WRAPPER_TEXT + GOLDEN_CLOSEUP + "\n\nNOW MAKE:\n" + prompt
                         + "\n\nREFERENCES:\n./refs/ref1.png (picture 1, place)\n./refs/ref2.png (picture 2, room)"
                           "\n./refs/ref3.jpg (picture 3, extra)")
        self.assertEqual(call["ref_sha256"], shas + [desk_art.sha256_file(extra)])
        self.assertEqual(call["refs"], ["ref1.png", "ref2.png", "ref3.jpg"])
        self.assertEqual(result.data["anchor"]["name"], name)
        self.assertEqual(result.data["anchor"]["extra"], 1)
        self.assertEqual(result.data["anchor"]["cardSha256"], self.card_sha(folder))
        self.assertEqual(list(result.data.keys())[-2:], ["matchedBy", "anchor"])
        (row,) = self.sb.manifest()
        self.assertEqual(list(row.keys()), MANIFEST_KEYS + ["anchor"])
        self.assertEqual(row["anchor"]["roles"], ["place", "room"])
        self.assertEqual(row["prompt"], prompt)
        self.assertEqual([ref["name"] for ref in row["refs"]],
                         [name + "/01_place.png", name + "/02_room.png", "extra.jpg"])

    def test_agy_sends_a_set_with_a_model_and_without_extras(self):
        self.make("solo-v1", roles=("identity",), keep=KEEP_FIGURE)
        result = self.cli("agy", "--label", "hero", "--prompt-stdin", "--model", "gemini-3-pro", "--anchor", "solo-v1",
                          *self.root_args(), stdin="One change only: a warm smile.")
        self.assertEqual(result.code, 0, result.out + result.err)
        call = self.agy_call()
        self.assertEqual(call["model"], "gemini-3-pro")
        self.assertEqual(call["prompt"], AGY_WRAPPER_TEXT + GOLDEN_FIGURE
                         + "\n\nNOW MAKE:\nOne change only: a warm smile."
                         + "\n\nREFERENCES:\n./refs/ref1.png (picture 1, identity)")

    def test_agy_refuses_a_changed_picture(self):
        name = "changed-v1"
        folder, shas = self.make(name, roles=("identity", "style"))
        with open(os.path.join(folder, "02_style.png"), "wb") as handle:
            handle.write(png_bytes(8, 6, (1, 2, 3)))
        result = self.anchored(name, command="agy")
        self.assert_refused(result, "anchor set changed-v1: picture 2 (style) is not the picture that was saved "
                                    "(saved ")
        self.assertIn(shas[1][:8], result.data["error"])
        self.assertIn("The set was changed after it was saved.", result.data["error"])
        self.assertEqual(result.data["hint"], "Save a new version of the set with the desk-art:anchor skill; "
                                              "do not edit a saved set.")

    def test_agy_failure_after_staging_reports_the_anchor(self):
        name = "fail-v1"
        folder, shas = self.make(name, roles=("identity", "style"), keep="red")
        extra = self.extra_picture()
        result = self.anchored(name, extras=[extra], command="agy", env={"FAKE_AGY_MODE": "none"})
        self.assertEqual((result.code, result.data["code"]), (2, "agy-no-images"), result.out)
        anchor = desk_art.load_anchor(self.sb.inbox, name)
        self.assertEqual(result.data["anchor"], {
            "name": name, "wordsVersion": "1", "wordsSha256": desk_art.sha256_text(desk_art.anchor_block(anchor, 1)),
            "cardSha256": self.card_sha(folder),
            "pictures": [{"n": 1, "role": "identity", "name": name + "/01_identity.png", "sha8": shas[0][:8]},
                         {"n": 2, "role": "style", "name": name + "/02_style.png", "sha8": shas[1][:8]}],
            "extra": 1})
        self.assertEqual([ref["name"] for ref in result.data["refsSent"]],
                         [name + "/01_identity.png", name + "/02_style.png", "extra.png"])
        work = os.path.join(result.data["jobDir"], "work")
        self.assertTrue(os.path.isdir(work))                                   # kept for a look ...
        self.assertFalse(os.path.exists(os.path.join(work, "refs")))           # ... without the picture copies
        self.assertEqual(self.sb.manifest(), [])


# ---------------------------------------------------------------------------
# Refusals: nothing is started
# ---------------------------------------------------------------------------

class AnchorRefusalTests(AnchorMixin):
    def test_bad_names_are_refused_first(self):
        names = ["Bad Name", "../x", "a/b", "x" * 41, "-x", ""]
        for command in ("codex", "agy"):
            for name in names:
                with self.subTest(command=command, name=name):
                    result = self.anchored(name, command=command, env=dict(NO_CODEX))         # not codex-not-found
                    self.assertEqual((result.code, result.data["code"]), (2, "bad-input"), result.out)
                    self.assertEqual(result.data["error"], H1_TEXT)
                    self.assertNotIn("hint", result.data)
                    self.assert_clean()
        # the name is judged before the prompt is read
        done = self.cli("codex", "--label", "x", "--anchor", "Bad Name", "--prompt-stdin", stdin=b"")
        self.assertEqual(done.data["error"], H1_TEXT)

    def test_a_missing_set_lists_the_saved_ones(self):
        none = self.anchored("nanami-final-v1")
        anchors = os.path.join(self.sb.inbox, "anchors")
        self.assert_refused(none, "anchor set nanami-final-v1 was not found in %s." % anchors)
        self.assertEqual(none.data["hint"], "No anchor sets are saved yet. Save one with the desk-art:anchor skill.")
        for name in ("b-v2", "a-v1"):
            self.make(name)
        os.makedirs(os.path.join(self.sb.inbox, "anchors", "half-v1"))                   # unfinished: not listed
        two = self.anchored("nanami-final-v1", command="agy")
        self.assert_refused(two, "was not found in")
        self.assertEqual(two.data["hint"], "Saved sets: a-v1, b-v2.")
        for number in range(1, 13):
            self.make("s%02d-v1" % number)
        many = self.anchored("nanami-final-v1")
        self.assertEqual(many.data["hint"], "Saved sets: a-v1, b-v2, s01-v1, s02-v1, s03-v1, s04-v1, s05-v1, s06-v1, "
                                            "s07-v1, s08-v1 and 4 more.")
        self.assertEqual(many.data["code"], "bad-input")

    def test_a_changed_picture_is_refused_after_staging(self):
        name = "nanami-final-v1"
        folder, shas = self.make(name, roles=("identity",))
        replacement = png_bytes(8, 6, (9, 9, 9))
        with open(os.path.join(folder, "01_identity.png"), "wb") as handle:
            handle.write(replacement)
        result = self.anchored(name)
        self.assert_refused(result, "anchor set nanami-final-v1: picture 1 (identity) is not the picture that was "
                                    "saved (saved %s, found %s). The set was changed after it was saved."
                            % (shas[0][:8], hashlib.sha256(replacement).hexdigest()[:8]))
        self.assertEqual(result.data["hint"], "Save a new version of the set with the desk-art:anchor skill; "
                                              "do not edit a saved set.")
        self.assertIn("picture 1 (identity) is not the picture that was saved (saved ", result.data["error"])
        self.assertTrue(os.path.isdir(os.path.join(self.sb.cache, "jobs")))        # made for a moment, then dropped

    def swapped(self, name, swap, command="codex"):
        """Run in this process; swap(path of picture 1) happens between checking the pictures and copying them."""
        member = os.path.join(self.sb.inbox, "anchors", name, "01_identity.png")
        finder = "find_" + command
        real_find = getattr(desk_art, finder)

        def swap_then_find():
            swap(member)
            return real_find()
        return self.inproc(command, "--inbox", self.sb.inbox, "--label", "x", "--prompt-stdin", "--anchor", name,
                           "--ref-root", self.sb.home, stdin="p", **{finder: swap_then_find})

    def test_a_picture_swapped_between_the_check_and_the_copy_is_caught(self):
        for command in ("codex", "agy"):
            name = "swap-%s-v1" % command
            self.make(name, roles=("identity",))
            same_file = self.swapped(name, rewrite_in_place(png_bytes(8, 6, (9, 9, 9))), command)       # same inode
            self.assert_refused_inproc(same_file, "anchor set %s: picture 1 (identity) is not the picture that was "
                                                  "saved (saved " % name)
            other = "other-%s-v1" % command
            self.make(other, roles=("identity",))
            new_file = self.swapped(other, replace_by_another_picture, command)                         # new inode
            exit_code, data = new_file
            self.assertEqual((exit_code, data["code"]), (2, "bad-input"), data)
            self.assertIn("changed after it was checked, so it was not used", data["error"])
            self.assertNotIn("is not the picture that was saved", data["error"])
            self.assert_clean()

    def test_links_are_refused(self):
        name = "links-v1"
        folder, shas = self.make(name, roles=("identity",))
        elsewhere = self.sb.make_dir("elsewhere")
        # a member file that is a link
        member = os.path.join(folder, "01_identity.png")
        os.rename(member, os.path.join(elsewhere, "01_identity.png"))
        os.symlink(os.path.join(elsewhere, "01_identity.png"), member)
        self.assert_refused(self.anchored(name), "anchor set links-v1: picture 1 (identity) is missing or is not a "
                                                 "plain picture file.")
        self.assertEqual(self.anchored(name).data["hint"], REPAIR_HINT)
        # anchor.json that is a link
        os.remove(member)
        os.rename(os.path.join(elsewhere, "01_identity.png"), member)
        card = os.path.join(folder, "anchor.json")
        os.rename(card, os.path.join(elsewhere, "anchor.json"))
        os.symlink(os.path.join(elsewhere, "anchor.json"), card)
        result = self.anchored(name)
        self.assert_refused(result, "anchor set links-v1: anchor.json is a link, so it was not used.", "inbox-unsafe")
        self.assertEqual(result.data["hint"], LINK_HINT)
        os.remove(card)
        os.rename(os.path.join(elsewhere, "anchor.json"), card)
        # the set folder that is a link
        moved = os.path.join(elsewhere, "set-folder")
        os.rename(folder, moved)
        os.symlink(moved, folder)
        result = self.anchored(name)
        self.assert_refused(result, "anchor set links-v1 is a link that leads elsewhere, so it was not used.",
                            "inbox-unsafe")
        self.assertEqual(result.data["hint"], LINK_HINT)
        os.remove(folder)
        os.rename(moved, folder)
        # the anchors folder that is a link
        anchors = os.path.join(self.sb.inbox, "anchors")
        moved = os.path.join(elsewhere, "anchors")
        os.rename(anchors, moved)
        os.symlink(moved, anchors)
        result = self.anchored(name)
        self.assert_refused(result, "the anchors folder %s is a link that leads elsewhere, so it was not used."
                            % anchors, "inbox-unsafe")
        self.assertEqual(result.data["hint"], LINK_HINT)
        os.remove(anchors)
        os.rename(moved, anchors)
        self.assertEqual(self.anchored(name).code, 0)                           # all put back: the set works again

    def test_a_card_that_is_missing_or_not_a_file(self):
        name = "nocard-v1"
        folder, _ = self.make(name)
        card = os.path.join(folder, "anchor.json")
        os.remove(card)
        result = self.anchored(name)
        self.assert_refused(result, "anchor set nocard-v1 has no anchor.json, so it is not a finished set.")
        self.assertEqual(result.data["hint"], "Save the set again under the next version name with the desk-art:anchor "
                                              "skill.")
        os.mkdir(card)                                                          # a folder where the card should be
        self.assert_refused(self.anchored(name), "has no anchor.json, so it is not a finished set.")
        os.rmdir(card)
        os.symlink(os.path.join(self.sb.root, "nowhere"), card)                 # a link to nothing is still a link
        self.assert_refused(self.anchored(name), "anchor.json is a link, so it was not used.", "inbox-unsafe")

    def test_a_picture_that_is_too_big_or_gone_is_refused(self):
        name = "gone-v1"
        folder, _ = self.make(name, roles=("identity", "style"))
        picture = os.path.join(folder, "02_style.png")
        with open(picture, "r+b") as handle:
            handle.truncate(desk_art.MAX_REF_BYTES + 1)
        self.assert_refused(self.anchored(name), "picture 2 (style) is missing or is not a plain picture file.")
        os.remove(picture)
        self.assert_refused(self.anchored(name), "picture 2 (style) is missing or is not a plain picture file.")

    def refuse_picture_inproc(self, name, command, number, role):
        """Run the call in this process and check the refusal in the set's own words (no long path, no 'reference')."""
        outcome = self.inproc(command, "--inbox", self.sb.inbox, "--label", "x", "--prompt-stdin", "--anchor", name,
                              "--ref-root", self.sb.home, stdin="p")
        self.assert_refused_inproc(outcome, "anchor set %s: picture %d (%s) is missing or is not a plain picture file."
                                   % (name, number, role))
        self.assertEqual(outcome[1]["hint"], REPAIR_HINT)
        self.assertNotIn("reference", outcome[1]["error"])
        self.assertNotIn(self.sb.inbox, outcome[1]["error"])

    def test_a_picture_that_is_no_longer_a_picture_is_refused_in_the_sets_words(self):
        """A picture that was emptied, replaced by text or by bytes that are no picture, cut inside its first bytes, or
        locked is refused with the set's name, the picture's number and the hint. Before, the answer was the long
        'reference <path> is not a PNG, JPEG or WEBP picture' text of check_refs, with no hint and no set."""
        good = png_bytes(8, 6, (1, 2, 3))
        noise = bytes(random.Random(20261109).randrange(256) for _ in range(300))
        self.assertIsNone(desk_art.detect_format(noise))
        rows = [("emptied", b""), ("a text file", b"This used to be a picture.\n"), ("300 random bytes", noise),
                ("only the PNG signature", good[:8]), ("cut inside the header", good[:20]),
                ("only a JPEG signature", b"\xff\xd8\xff")]
        for command in ("codex", "agy"):
            name = "dead-%s-v1" % command
            folder, _ = self.make(name, roles=("identity", "style"))
            for number, role in ((1, "identity"), (2, "style")):
                picture = os.path.join(folder, "%02d_%s.png" % (number, role))
                with open(picture, "rb") as handle:
                    saved = handle.read()
                for label, data in rows:
                    with self.subTest(command=command, picture=number, damage=label):
                        with open(picture, "wb") as handle:
                            handle.write(data)
                        self.refuse_picture_inproc(name, command, number, role)
                with open(picture, "wb") as handle:                              # put it back
                    handle.write(saved)
        if os.geteuid() != 0:                                   # (root can read a locked file: nothing to see)
            folder, _ = self.make("locked-v1", roles=("identity",))
            picture = os.path.join(folder, "01_identity.png")
            os.chmod(picture, 0)
            self.addCleanup(os.chmod, picture, 0o600)
            self.refuse_picture_inproc("locked-v1", "codex", 1, "identity")
        for command in ("codex", "agy"):                        # nothing started above; with the pictures back it works
            self.assertEqual(self.anchored("dead-%s-v1" % command, command=command).code, 0, command)

    def test_a_picture_cut_after_its_header_or_replaced_by_a_picture_keeps_the_older_words(self):
        """The check above reads the first bytes only. A picture that still starts like a picture is caught later, by
        its fingerprint, in the words for a changed picture."""
        good = png_bytes(8, 6, (1, 2, 3))
        for command in ("codex", "agy"):
            name = "cut-%s-v1" % command
            folder, shas = self.make(name, roles=("identity",))
            picture = os.path.join(folder, "01_identity.png")
            for label, data in (("cut after the header", good[:40]), ("another picture", png_bytes(8, 6, (9, 9, 9)))):
                with self.subTest(command=command, damage=label):
                    with open(picture, "wb") as handle:
                        handle.write(data)
                    self.assertTrue(desk_art.anchor_picture_usable(picture))
                    outcome = self.inproc(command, "--inbox", self.sb.inbox, "--label", "x", "--prompt-stdin",
                                          "--anchor", name, "--ref-root", self.sb.home, stdin="p")
                    self.assert_refused_inproc(outcome, "anchor set %s: picture 1 (identity) is not the picture that "
                                                        "was saved (saved %s, found %s)."
                                               % (name, shas[0][:8], hashlib.sha256(data).hexdigest()[:8]))
                    self.assertEqual(outcome[1]["hint"], CHANGED_HINT)

    def test_anchor_picture_usable(self):
        folder = self.sb.make_dir("usable")
        good = png_bytes(8, 6, (1, 2, 3))
        jpeg = jpeg_bytes()
        rows = [("a PNG", good, True), ("a JPEG", jpeg, True), ("a PNG cut after its header", good[:40], True),
                ("nothing", b"", False), ("text", b"hello", False), ("the PNG signature only", good[:8], False),
                ("a PNG cut inside the header", good[:20], False), ("a JPEG signature only", b"\xff\xd8\xff", False)]
        for label, data, expected in rows:
            with self.subTest(label):
                path = self.sb.write_file(os.path.join(folder, "p.bin"), data)
                self.assertIs(desk_art.anchor_picture_usable(path), expected)
        self.assertIs(desk_art.anchor_picture_usable(os.path.join(folder, "missing.png")), False)
        self.assertIs(desk_art.anchor_picture_usable(folder), False)                       # a folder is not a picture
        link = os.path.join(folder, "link.png")
        os.symlink(self.sb.write_file(os.path.join(folder, "real.png"), good), link)
        self.assertIs(desk_art.anchor_picture_usable(link), False)                         # a link is never followed

    def test_the_card_rules(self):
        folder, _ = self.make(CARD_FOLDER, roles=("identity", "style", "place"))
        card = os.path.join(folder, "anchor.json")
        rows = card_rows()
        self.assertGreater(len(rows), 60)
        for label, raw, expected in rows:
            with self.subTest(label):
                with open(card, "wb") as handle:
                    handle.write(raw)
                outcome = self.inproc("codex", "--label", "x", "--prompt-stdin", "--anchor", CARD_FOLDER, stdin="p")
                self.assert_refused_inproc(outcome, "anchor set %s: anchor.json is not usable: %s"
                                           % (CARD_FOLDER, expected))
                self.assertEqual(outcome[1]["hint"], REPAIR_HINT)

    def test_hostile_json_is_a_refusal_not_a_crash(self):
        folder, _ = self.make(CARD_FOLDER)
        card = os.path.join(folder, "anchor.json")
        good = good_card()
        text = json.dumps(good)
        hostile = {"30,000 nested brackets": b"[" * 30000,
                   "12,000 nested objects": b'{"a":' * 12000,
                   "a 20,000-digit format": text.replace('"format": 1', '"format": ' + "9" * 20000).encode("ascii"),
                   "a 20,000-digit size": text.replace("[64, 48]", "[" + "9" * 20000 + ", 48]").encode("ascii")}
        for label, raw in hostile.items():
            with self.subTest(label):
                self.assertLess(len(raw), 64 * 1024)
                with open(card, "wb") as handle:
                    handle.write(raw)
                result = self.anchored(CARD_FOLDER)
                self.assertEqual((result.code, result.data["code"]), (2, "bad-input"), result.out[:300])
                self.assertIn("anchor.json is not usable", result.data["error"])
                self.assertEqual(result.err, "")                                 # no traceback

    def test_parse_anchor_card_gives_only_the_closed_reasons(self):
        rows = card_rows()
        for label, raw, expected in rows:
            with self.subTest(label):
                with self.assertRaises(desk_art.AnchorCardProblem) as caught:
                    desk_art.parse_anchor_card(raw, CARD_FOLDER)
                self.assertTrue(caught.exception.reason.startswith(expected), (caught.exception.reason, expected))
                self.assertTrue(closed_reason(caught.exception.reason), caught.exception.reason)
        good = card_bytes(good_card())
        parsed = desk_art.parse_anchor_card(good, CARD_FOLDER)
        self.assertEqual(parsed, good_card())
        generator = random.Random(20261109)
        samples = [b"", b"\xff\xfe", b"{}", b"[]", b"null", b"\x00" * 50]
        for _ in range(150):
            samples.append(bytes(generator.randrange(256) for _ in range(generator.randrange(1, 200))))
        for _ in range(150):                                       # a good card with a few bytes changed or cut
            data = bytearray(good)
            for _ in range(generator.randrange(1, 4)):
                data[generator.randrange(len(data))] = generator.randrange(256)
            if generator.random() < 0.2:
                data = data[:generator.randrange(len(data) + 1)]
            samples.append(bytes(data))
        junk = [None, True, False, 0, -1, 1, 1.5, "", "x", "x" * 400, [], {}, [1], {"a": 1}, "\n", "caf" + chr(0xE9)]
        for _ in range(300):                                       # a good card with a part replaced by something odd
            card = copy.deepcopy(good_card(generator.choice([("identity",), ("place", "room"), ("style", "style")])))
            target = card if generator.random() < 0.5 else card["members"][0]
            key = generator.choice(sorted(target))
            target[key] = generator.choice(junk)
            samples.append(card_bytes(card))
        for raw in samples:
            try:
                result = desk_art.parse_anchor_card(raw, CARD_FOLDER)
            except desk_art.AnchorCardProblem as problem:
                self.assertTrue(closed_reason(problem.reason), (problem.reason, raw[:80]))
            else:
                self.assertIsInstance(result, dict)

    def test_the_set_cannot_widen_the_allowed_folders(self):
        for value in ("../x.png", "/etc/hosts", "a/b.png", "./01_identity.png", "..\\x.png", "~/01_identity.png",
                      "01_identity.png/../../x", "01_identity.png\n", "01_identity.png ", "/01_identity.png",
                      "sub/../01_identity.png"):
            with self.subTest(value):
                card = good_card()
                card["members"][0]["file"] = value
                with self.assertRaises(desk_art.AnchorCardProblem) as caught:
                    desk_art.parse_anchor_card(card_bytes(card), CARD_FOLDER)
                self.assertTrue(caught.exception.reason.startswith("picture 1: file must look like"), value)
        name = "wide-v1"
        self.make(name, roles=("identity", "style"))
        result = self.anchored(name, roots=[self.sb.outside])                    # a folder that holds nothing of ours
        self.assertEqual(result.code, 0, result.out + result.err)                # the inbox is always allowed
        self.assertEqual(len(self.exec_call()["images"]), 2)


# ---------------------------------------------------------------------------
# The rest: status, snapshots, version, flags, scope words, fingerprints
# ---------------------------------------------------------------------------

class AnchorMiscTests(AnchorMixin):
    def test_status_leaves_the_anchors_folder_out_of_the_picture_count(self):
        self.sb.write_png(os.path.join(self.sb.inbox, "2026-11-09", "a.png"))
        self.sb.write_png(os.path.join(self.sb.inbox, "2026-11-09", "b.png"), color=(1, 1, 1))
        self.make("two-v1", roles=("identity", "style"))
        self.assertEqual(desk_art.count_inbox_images(self.sb.inbox), 2)
        data = self.cli("status").data
        self.assertEqual(data["inbox"]["imageCount"], 2)
        self.assertEqual(data["inbox"]["exists"], True)
        self.assertEqual(list(data.keys()), ["ok", "inbox", "codex", "agy", "antigravityApp", "geminiApp", "refRoots",
                                             "notes"])                         # no key added

    def test_the_helper_never_writes_under_anchors(self):
        name = "still-v1"
        folder, _ = self.make(name, roles=("place", "room"))
        anchors = os.path.join(self.sb.inbox, "anchors")
        extra = self.extra_picture()
        before = tree_snapshot(anchors)
        self.assertGreater(len(before), 3)
        ok = self.anchored(name, extras=[extra])
        self.assertEqual(ok.code, 0, ok.out)
        self.assertEqual(tree_snapshot(anchors), before)
        too_many = self.anchored(name, extras=[extra] * 5)
        self.assertEqual(too_many.code, 2)
        self.assertEqual(tree_snapshot(anchors), before)
        failed = self.anchored(name, env={"FAKE_CODEX_MODE": "refusal"}, command="codex")
        self.assertEqual(failed.data["code"], "codex-no-images")
        self.assertEqual(tree_snapshot(anchors), before)
        with open(os.path.join(folder, "02_room.png"), "wb") as handle:        # the owner changes a picture by hand
            handle.write(png_bytes(8, 6, (9, 9, 9)))
        changed = tree_snapshot(anchors)
        self.assertNotEqual(changed, before)
        refused = self.anchored(name, command="agy")
        self.assertEqual(refused.code, 2)
        self.assertEqual(tree_snapshot(anchors), changed)
        agy = self.anchored("nanami-final-v1", command="agy")                   # a name that is not saved
        self.assertEqual(agy.code, 2)
        self.assertEqual(tree_snapshot(anchors), changed)

    def test_helper_version_matches_the_plugin(self):
        self.assertEqual(desk_art.VERSION, "0.2.0")
        with open(os.path.join(HERE, "..", ".claude-plugin", "plugin.json"), encoding="utf-8") as handle:
            self.assertEqual(json.load(handle)["version"], desk_art.VERSION)
        top = self.cli("--help").data
        self.assertIn("desk-art helper %s." % desk_art.VERSION, " ".join(top["help"].split()))
        with open(os.path.join(HERE, "desk_art.py"), encoding="utf-8") as handle:
            lines = handle.read().split("\n")
        self.assertEqual(lines[1], '"""desk-art helper, version 0.2.0.')
        self.assertIn("codex and agy also take --anchor NAME (a saved anchor set in <inbox>/anchors).", lines[:15])

    def test_codex_and_agy_list_anchor_in_their_help_and_nothing_else_does(self):
        for name in ("status", "codex", "agy", "ingest", "wait-new", "clip-image"):
            data = self.cli(name, "--help").data
            if name in ("codex", "agy"):
                self.assertIn("--anchor", data["flags"], name)
                self.assertIn("a saved anchor set in <inbox>/anchors/NAME", " ".join(data["help"].split()))
            else:
                self.assertNotIn("--anchor", data["flags"], name)
        self.assertIn("--anchor", desk_art.VALUE_FLAGS)
        self.assertEqual(self.cli("codex", "--help").data["codes"], list(desk_art.FAILURE_CODES["codex"]))
        self.assertEqual(self.cli("agy", "--help").data["codes"], list(desk_art.FAILURE_CODES["agy"]))
        for name in ("status", "ingest", "wait-new", "clip-image"):
            refused = self.cli(name, "--anchor", "x-v1")
            self.assertEqual((refused.code, refused.data["code"]), (3, "usage"), name)

    def test_a_dash_value_for_anchor_is_a_bad_name_not_a_usage_error(self):
        result = self.cli("codex", "--label", "x", "--prompt-stdin", "--anchor", "-x", stdin="p")
        self.assertEqual((result.code, result.data["code"], result.data["error"]), (2, "bad-input", H1_TEXT))
        self.assertEqual(desk_art.glue_dash_values(["--anchor", "-x"]), ["--anchor=-x"])

    def test_the_helper_imports_only_the_standard_library(self):
        with open(os.path.join(HERE, "desk_art.py"), encoding="utf-8") as handle:
            tree = ast.parse(handle.read())
        modules = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                modules.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                modules.add((node.module or "").split(".")[0])
        self.assertTrue(modules)
        self.assertEqual(modules - ALLOWED_IMPORTS, set())

    def test_scope_words(self):
        refused = [("Onsen outfits", "onsen"), ("Swimwear outfits", "swim"), ("Pyjamas", "pyjama"),
                   ("Outfits cleaned 2026-10-27", "outfits"), ("romance_poses", "romance pose"),
                   ("Ask for a pose", "ask for a pose"), ("Pose-Ladder", "pose ladder"),
                   ("game/images/char/outfits/x.png", "outfits"), ("maki_swim.png", "swim"),
                   ("ic_place_pool.png", "pool"), ("SWIMWEAR", "swim"),
                   ("".join(chr(0xFF00 + ord(char) - 0x20) for char in "onsen"), "onsen"), ("bath-house", "bath"),
                   ("Poolside", "pool"), ("Bathroom", "bath"), ("a  towel", "towel"), ("two\tbikini\nnow", "bikini"),
                   ("the beach house", "beach"), ("Lingerie", "lingerie"), ("underwear_test", "underwear"),
                   ("sauna room", "sauna"), ("Pajama day", "pajama"), ("ask  for-a_pose", "ask for a pose")]
        # The dashes the Mac types for a hyphen (hyphen, non-breaking hyphen, figure dash, en dash, em dash, bar) and
        # the minus sign: one space, like "-" is.
        dashes = [chr(code) for code in range(0x2010, 0x2016)] + [chr(0x2212)]
        refused += [("Pose%sLadder" % dash, "pose ladder") for dash in dashes]
        refused += [("ask%sfor%sa%spose" % ((chr(0x2013),) * 3), "ask for a pose"),
                    ("Romance%sPose" % chr(0x2212), "romance pose"), ("Swim%swear" % chr(0x2014), "swim")]
        # Invisible format characters (soft hyphen, zero-width space and joiner, word joiner, byte-order mark) that a
        # copy and paste leaves in a name are dropped, so they cannot split a word.
        refused += [("sw%sim.png" % chr(0xAD), "swim"), ("Sw%sim.png" % chr(0x200B), "swim"),
                    (chr(0xFEFF) + "bikini", "bikini"), ("on%ssen" % chr(0x2060), "onsen"),
                    ("ba%sth" % chr(0x200D), "bath"), ("Pose-%sLadder" % chr(0x200B), "pose ladder")]
        # Names run together in CamelCase, or with a digit in front, count word by word. The last two are caught as
        # they stand: splitting "BATHtub" after "BAT" must not lose the word that the plain reading finds.
        refused += [("MakiSwimwear.png", "swim"), ("NobaraBikini.png", "bikini"), ("makiBath.png", "bath"),
                    ("NanamiTowel.png", "towel"), ("NobaraOnsen2.png", "onsen"), ("01swim.png", "swim"),
                    ("NobaraSwimwear.png", "swim"), ("MakiBikini.png", "bikini"), ("NobaraTowel.png", "towel"),
                    ("MiwaPool.png", "pool"), ("MAKIBikini.png", "bikini"), ("AskForAPose", "ask for a pose"),
                    ("PoseLadder", "pose ladder"), ("RomancePoses", "romance pose"), ("xSwim", "swim"),
                    ("BATHtub", "bath"), ("POOLside", "pool")]
        for text, word in refused:
            with self.subTest(text):
                self.assertEqual(desk_art.anchor_scope_word(text), word)
        accepted = ["consent form", "carpool lane", "sabbath", "nanami-final", "courtyard-vending", "classroom",
                    KEEP_FIGURE, KEEP_CLOSEUP, "soft muted colour; hand painted look",
                    "Nanami, Arc 1 Final art on flat magenta", "", "pose", "composition", "purpose", "outfit",
                    "Consent.png", "Carpool", "Sabbath", "Classroom", "Courtyard-Vending-v1", "Nanami2Final",
                    "NanamiSmile.png", "ArcOneFinalNormal.png", "YouTube", "1920x1080", "16-9", "#FF00FF",
                    "Pose%sOne" % chr(0x2013), "Ex%sample" % chr(0xAD)]
        for text in accepted:
            with self.subTest(text):
                self.assertIsNone(desk_art.anchor_scope_word(text))
        for text, word in refused:
            with self.subTest("path " + text):
                self.assertEqual(desk_art.anchor_scope_path_word("/elsewhere/" + text), word)
        beach_home = os.path.join(self.sb.root, "x", "beach")
        with mock.patch.dict(os.environ, {"DESK_ART_HOME": beach_home}):
            self.assertIsNone(desk_art.anchor_scope_path_word("~/Desktop/Character reworks/Arc 1 Final/Nanami.png"))
            self.assertIsNone(desk_art.anchor_scope_path_word(beach_home + "/Desktop/Character reworks/Nanami.png"))
            self.assertIsNone(desk_art.anchor_scope_path_word(beach_home))
            self.assertEqual(desk_art.anchor_scope_path_word("~/Desktop/Swimwear outfits/x.png"), "swim")
            self.assertEqual(desk_art.anchor_scope_path_word(os.path.join(self.sb.outside, "beach-pics", "x.png")),
                             "beach")                                          # outside home: the path is used whole
            self.assertEqual(desk_art.anchor_scope_path_word("/elsewhere/beach/x.png"), "beach")
        with mock.patch.dict(os.environ, {"DESK_ART_HOME": self.sb.home}):
            self.assertIsNone(desk_art.anchor_scope_path_word("~/Desktop/Character reworks/Arc 1 Final/Nanami.png"))

    def test_the_dashes_that_read_as_spaces(self):
        self.assertEqual([hex(ord(char)) for char in desk_art.ANCHOR_DASHES],
                         ["0x2010", "0x2011", "0x2012", "0x2013", "0x2014", "0x2015", "0x2212"])
        run = "a - b_c" + desk_art.ANCHOR_DASHES + "d  e"
        self.assertEqual(desk_art.ANCHOR_SEPARATORS_RE.sub(" ", run), "a b c d e")

    def test_comfy_pythons_on_disk_are_the_executable_ones_in_sorted_order(self):
        """The helper of the test-run's own alarm (below): it must see the folders the Python search sees."""
        home = self.sb.make_dir("elsewhere-home")
        for folder, mode in (("Zed", 0o755), ("alpha", 0o755), ("beta", 0o644), (".hidden", 0o755)):
            python = os.path.join(home, "ComfyUI-Installs", folder, "standalone-env", "bin", "python")
            os.makedirs(os.path.dirname(python))
            self.sb.write_file(python, b"#!/bin/sh\n")
            os.chmod(python, mode)
        os.makedirs(os.path.join(home, "ComfyUI-Installs", "empty"))
        with mock.patch.dict(os.environ, {"HOME": home}):
            found = comfy_pythons_on_disk()
        tail = os.path.join("standalone-env", "bin", "python")
        self.assertEqual(found, [os.path.join(home, "ComfyUI-Installs", folder, tail) for folder in ("Zed", "alpha")])
        with mock.patch.dict(os.environ, {"HOME": os.path.join(home, "nothing-here")}):
            self.assertEqual(comfy_pythons_on_disk(), [])

    def test_a_python_with_pillow_is_found_where_comfyui_is_installed(self):
        """Without one, test_anchor_scripts.py and test_anchor_look.py skip most of their tests and the run still says
        OK (81 of 151 were skipped that way when no Python was found). This is the alarm: where ComfyUI's own Python is
        installed, a Python that imports Pillow and numpy must be found."""
        installed = comfy_pythons_on_disk()
        if not installed:
            self.skipTest("no ComfyUI Python under ~/ComfyUI-Installs on this Mac, so the search has nothing to find")
        found = pillow_python()
        self.assertIsNotNone(found, "ComfyUI is installed (%s) but no Python that imports Pillow and numpy was found, "
                                    "so the script tests are being skipped" % installed[0])
        self.assertTrue(os.path.isfile(found) and os.access(found, os.X_OK), found)

    def test_the_card_fingerprint_is_recorded(self):
        name = "finger-v1"
        folder, _ = self.make(name, note="the first note")
        first_card = self.card_sha(folder)
        self.assertEqual(desk_art.load_anchor(self.sb.inbox, name).card_sha256, first_card)
        first = self.anchored(name)
        self.make(name, note="the second note")                                  # same pictures, another note
        second = self.anchored(name)
        self.assertEqual((first.code, second.code), (0, 0), first.out + second.out)
        self.assertEqual(first.data["anchor"]["cardSha256"], first_card)
        self.assertNotEqual(first.data["anchor"]["cardSha256"], second.data["anchor"]["cardSha256"])
        self.assertEqual(second.data["anchor"]["cardSha256"], self.card_sha(folder))
        rows = self.sb.manifest()
        self.assertEqual([row["anchor"]["cardSha256"] for row in rows],
                         [first.data["anchor"]["cardSha256"], second.data["anchor"]["cardSha256"]])
        self.assertEqual(first.data["anchor"]["wordsSha256"], second.data["anchor"]["wordsSha256"])   # same words

    def test_check_anchor_name_table(self):
        for value in ANCHOR_NAME_TABLE_ACCEPTED:
            self.assertEqual(desk_art.check_anchor_name(value), value)
        for value in ANCHOR_NAME_TABLE_REFUSED:
            with self.subTest(repr(value)):
                with self.assertRaises(desk_art.Failure) as caught:
                    desk_art.check_anchor_name(value)
                self.assertEqual((caught.exception.code, caught.exception.error), ("bad-input", H1_TEXT))
                self.assertNotIn("hint", caught.exception.extra)

    def test_a_name_the_helper_accepts_is_also_a_label(self):
        for value in ANCHOR_NAME_TABLE_ACCEPTED + ANCHOR_NAME_TABLE_REFUSED:
            accepted = desk_art.LABEL_RE.fullmatch(value) is not None
            self.assertEqual(accepted, value in ANCHOR_NAME_TABLE_ACCEPTED, repr(value))


if __name__ == "__main__":
    unittest.main()
