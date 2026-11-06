"""Tests for what the Screen Light shows, run through the built program's --decide mode.

Build the app first (./build.sh), then:  python3 -B -m unittest discover -s app   (from the mod's folder)
Each test writes a few state files into a throwaway folder, asks the program what it would show at a
fixed time, and checks the answer. Nothing is drawn and nothing outside the throwaway folder is touched.
"""

import json
import os
import struct
import subprocess
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, "Screen Light.app", "Contents", "MacOS", "ScreenLight")
NOW = 1_800_000_000_000


def session(**over):
    """A session that has full control right now, with the fields overridden."""
    base = {"v": 1, "session": "a", "mode": "screen", "busy": False,
            "since": NOW - 30_000, "last": NOW - 1_000, "beat": NOW - 1_000}
    base.update(over)
    return base


def decide(files, now=NOW):
    """Asks the program what the light shows for these state files (name -> dict or raw text)."""
    with tempfile.TemporaryDirectory() as folder:
        for name, body in files.items():
            with open(os.path.join(folder, name), "w", encoding="utf-8") as handle:
                handle.write(body if isinstance(body, str) else json.dumps(body))
        done = subprocess.run([BIN, "--decide", folder, "--now", str(now)],
                              capture_output=True, text=True, timeout=30)
        if done.returncode != 0:
            raise AssertionError("--decide failed: %s" % done.stderr)
        return json.loads(done.stdout)


@unittest.skipUnless(os.path.exists(BIN), "build the app first: app/build.sh")
class DecideTests(unittest.TestCase):
    def test_nothing_to_show_with_no_files(self):
        self.assertEqual(decide({})["look"], "hidden")

    def test_a_folder_that_is_not_there_shows_nothing(self):
        done = subprocess.run([BIN, "--decide", "/nonexistent/screen-light", "--now", str(NOW)],
                              capture_output=True, text=True, timeout=30)
        self.assertEqual(json.loads(done.stdout)["look"], "hidden")

    def test_full_screen_control(self):
        d = decide({"a.json": session()})
        self.assertEqual(d["look"], "screen")
        self.assertEqual(d["title"], "Claude has your screen")
        self.assertEqual(d["detail"], "Hands off the mouse and keyboard")
        self.assertEqual(d["since"], NOW - 30_000)

    def test_what_claude_is_doing_replaces_the_default_line(self):
        d = decide({"a.json": session(what="Clicks the Send button")})
        self.assertEqual(d["detail"], "Clicks the Send button")

    def test_background_control_names_the_app(self):
        d = decide({"a.json": session(mode="app", app="Gemini")})
        self.assertEqual(d["look"], "app")
        self.assertEqual(d["title"], "Claude is in Gemini")
        self.assertEqual(d["detail"], "You can keep using your Mac")

    def test_background_control_without_an_app_name(self):
        d = decide({"a.json": session(mode="app")})
        self.assertEqual(d["title"], "Claude is working in the background")

    def test_idle_and_unknown_modes_show_nothing(self):
        self.assertEqual(decide({"a.json": session(mode="idle")})["look"], "hidden")
        self.assertEqual(decide({"a.json": session(mode="root")})["look"], "hidden")

    def test_a_session_that_stopped_writing_is_gone(self):
        self.assertEqual(decide({"a.json": session(beat=NOW - 19_000)})["look"], "screen")
        self.assertEqual(decide({"a.json": session(beat=NOW - 21_000)})["look"], "hidden")

    def test_full_screen_outranks_the_background_even_when_older(self):
        files = {"a.json": session(session="a", mode="screen", last=NOW - 9_000),
                 "b.json": session(session="b", mode="app", app="Gemini", last=NOW - 100)}
        self.assertEqual(decide(files)["look"], "screen")

    def test_the_latest_background_session_wins(self):
        files = {"a.json": session(session="a", mode="app", app="Safari", last=NOW - 5_000),
                 "b.json": session(session="b", mode="app", app="Gemini", last=NOW - 500)}
        self.assertEqual(decide(files)["title"], "Claude is in Gemini")

    def test_working_means_busy_or_a_recent_call(self):
        self.assertTrue(decide({"a.json": session(busy=True, last=NOW - 60_000)})["working"])
        self.assertTrue(decide({"a.json": session(last=NOW - 7_000)})["working"])
        self.assertFalse(decide({"a.json": session(last=NOW - 9_000)})["working"])

    def test_the_gave_back_note_and_its_reasons(self):
        why = {"released": "Claude let go of the screen", "turn-ended": "Claude finished",
               "stopped": "You stopped Claude"}
        for reason, line in why.items():
            d = decide({"a.json": session(mode="idle", ended=NOW - 1_000, reason=reason)})
            self.assertEqual(d["look"], "done")
            self.assertEqual(d["title"], "Claude gave control back")
            self.assertEqual(d["detail"], line)

    def test_the_gave_back_note_goes_away(self):
        self.assertEqual(decide({"a.json": session(mode="idle", ended=NOW - 4_000)})["look"], "done")
        self.assertEqual(decide({"a.json": session(mode="idle", ended=NOW - 5_000)})["look"], "hidden")

    def test_the_gave_back_note_gives_way_to_a_live_session(self):
        files = {"a.json": session(session="a", mode="idle", ended=NOW - 500),
                 "b.json": session(session="b", mode="app", app="Gemini")}
        self.assertEqual(decide(files)["look"], "app")

    def test_bad_files_are_ignored(self):
        files = {"a.json": session(),
                 "b.json": "{ not json",
                 "c.json": "[1, 2, 3]",
                 "d.json": "",
                 "notes.txt": json.dumps(session(session="x", mode="app"))}
        self.assertEqual(decide(files)["look"], "screen")

    def test_words_are_made_plain_and_short(self):
        d = decide({"a.json": session(what="Types\nthe\tprompt   now\u0007")})
        self.assertEqual(d["detail"], "Types the prompt now")
        d = decide({"a.json": session(what="x" * 200)})
        self.assertEqual(len(d["detail"]), 91)
        self.assertTrue(d["detail"].endswith("…"))

    def test_numbers_must_be_numbers(self):
        d = decide({"a.json": session(since="1", last=NOW - 100, beat=NOW - 100)})
        self.assertEqual(d["since"], 0)
        d = decide({"a.json": session(since=True)})
        self.assertEqual(d["since"], 0)


@unittest.skipUnless(os.path.exists(BIN), "build the app first: app/build.sh")
class PictureTests(unittest.TestCase):
    def test_snapshot_writes_a_png_of_the_expected_size(self):
        with tempfile.TemporaryDirectory() as folder:
            out = os.path.join(folder, "looks.png")
            done = subprocess.run([BIN, "--snapshot", out, "all"], capture_output=True, text=True, timeout=60)
            self.assertEqual(done.returncode, 0, done.stderr)
            with open(out, "rb") as handle:
                head = handle.read(24)
            self.assertEqual(head[:8], b"\x89PNG\r\n\x1a\n")
            width, height = struct.unpack(">II", head[16:24])
            self.assertEqual((width, height), (1400, 720))


if __name__ == "__main__":
    unittest.main()
