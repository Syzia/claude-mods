"""Tests for the Screen Light program: what it shows, which windows it makes, how its button writes the pause file,
and what its pictures are. They drive the built program through its test modes (--decide, --inspect, --press-test,
--hold-test, --crab-ascii, --pose, --older-test, --clock-test, --snapshot).

Build the app first (./app/build.sh), then, from the mod's folder:  python3 -B -m unittest discover -s app
Each test works in a throwaway folder. Nothing is shown on screen and nothing outside the folder is touched.
"""

import json
import os
import struct
import subprocess
import tempfile
import time
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
BIN = os.path.join(HERE, "Screen Light.app", "Contents", "MacOS", "ScreenLight")
NOW = 1_800_000_000_000

# The sleeping crab's Z, as the first four rows (art rows -3 to 0) of any of its pictures.
THE_Z = ["..........WWWWW",
         ".............WW",
         "...........WW..",
         "..........WWWWW"]


def run(*args, timeout=30):
    """Runs the program with these arguments and returns what it printed (fails if it did not exit cleanly)."""
    done = subprocess.run([BIN] + [str(a) for a in args], capture_output=True, text=True, timeout=timeout)
    if done.returncode != 0:
        raise AssertionError("%s failed: %s" % (args, done.stderr))
    return done.stdout


def session(**over):
    """A session that has full control right now, with the fields overridden."""
    base = {"v": 1, "session": "a", "mode": "screen", "busy": False,
            "since": NOW - 30_000, "last": NOW - 1_000, "beat": NOW - 1_000, "pause": 1}
    base.update(over)
    return base


def pause_file(paused=True, at=NOW - 5_000, by="light"):
    return {"v": 1, "paused": paused, "at": at, "by": by}


def decide(files, now=NOW, pause=None):
    """Asks the program what the light shows for these state files (name -> dict or raw text).
    `pause` is None (no pause file given), a dict, or raw text or bytes for the pause file."""
    with tempfile.TemporaryDirectory() as folder:
        state = os.path.join(folder, "state")
        os.mkdir(state)
        for name, body in files.items():
            with open(os.path.join(state, name), "w", encoding="utf-8") as handle:
                handle.write(body if isinstance(body, str) else json.dumps(body))
        args = ["--decide", state, "--now", now]
        if pause is not None:
            path = os.path.join(folder, "pause.json")
            if isinstance(pause, bytes):
                with open(path, "wb") as handle:
                    handle.write(pause)
            else:
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write(pause if isinstance(pause, str) else json.dumps(pause))
            args += ["--pause-file", path]
        return json.loads(run(*args))


def png_size(path):
    with open(path, "rb") as handle:
        head = handle.read(24)
    assert head[:8] == b"\x89PNG\r\n\x1a\n", "not a PNG"
    return struct.unpack(">II", head[16:24])


def inspect(look):
    return json.loads(run("--inspect", look))


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

    def test_the_answer_has_exactly_the_documented_fields_in_sorted_order(self):
        with tempfile.TemporaryDirectory() as folder:
            out = run("--decide", folder, "--now", NOW)
        keys = [k for k, _ in json.loads(out, object_pairs_hook=list)]
        self.assertEqual(keys, ["button", "detail", "look", "since", "title", "working"])


@unittest.skipUnless(os.path.exists(BIN), "build the app first: app/build.sh")
class PauseDecisionTests(unittest.TestCase):
    def test_paused_is_shown_even_when_nobody_holds_the_screen(self):
        d = decide({}, pause=pause_file(True, at=NOW - 5_000))
        self.assertEqual(d["look"], "paused")
        self.assertEqual(d["title"], "Screen control is paused")
        self.assertEqual(d["detail"], "Claude cannot use your screen until you resume")
        self.assertEqual(d["since"], NOW - 5_000)  # the clock counts from the file's "at"
        self.assertFalse(d["working"])

    def test_paused_wins_over_a_live_session_and_over_a_note(self):
        self.assertEqual(decide({"a.json": session()}, pause=pause_file(True))["look"], "paused")
        ended = session(mode="idle", ended=NOW - 500)
        self.assertEqual(decide({"a.json": ended}, pause=pause_file(True))["look"], "paused")

    def test_an_older_session_that_holds_control_makes_the_paused_look_say_so(self):
        usual = "Claude cannot use your screen until you resume"
        older = "An older Claude session may ignore this pause"
        # A file from a mod older than the pause has no "pause" field: that session would go on using the screen.
        for mode in ("screen", "app"):
            files = {"a.json": {k: v for k, v in session(mode=mode).items() if k != "pause"}}
            d = decide(files, pause=pause_file(True))
            self.assertEqual((d["look"], d["button"], d["title"], d["detail"]), ("paused", "resume", "Screen control is paused", older))
        # one that obeys leaves the usual words, and so does a mix where only one is old
        self.assertEqual(decide({"a.json": session()}, pause=pause_file(True))["detail"], usual)
        mixed = {"a.json": session(), "b.json": {k: v for k, v in session(session="b").items() if k != "pause"}}
        self.assertEqual(decide(mixed, pause=pause_file(True))["detail"], older)

    def test_an_older_session_is_only_a_warning_while_it_is_live_and_holds_control(self):
        usual = "Claude cannot use your screen until you resume"
        old = lambda **over: {k: v for k, v in session(**over).items() if k != "pause"}
        # not holding anything, or not heard from for more than 20 s: nothing to warn about
        self.assertEqual(decide({"a.json": old(mode="idle")}, pause=pause_file(True))["detail"], usual)
        self.assertEqual(decide({"a.json": old(beat=NOW - 21_000)}, pause=pause_file(True))["detail"], usual)
        self.assertEqual(decide({"a.json": old(beat=NOW - 19_000)}, pause=pause_file(True))["detail"],
                         "An older Claude session may ignore this pause")
        # not paused: the warning does not exist (the light shows its ordinary looks)
        self.assertEqual(decide({"a.json": old()})["look"], "screen")

    def test_the_older_session_warning_also_shows_when_the_pause_file_cannot_be_read(self):
        old = {k: v for k, v in session().items() if k != "pause"}
        d = decide({"a.json": old}, pause="{ not json")
        self.assertEqual((d["look"], d["detail"]), ("paused", "An older Claude session may ignore this pause"))

    def test_only_a_pause_field_of_one_or_more_counts_as_obeying(self):
        older = "An older Claude session may ignore this pause"
        for value, warns in ((1, False), (2, False), (0, True), (True, True), ("yes", True), (None, True)):
            d = decide({"a.json": session(pause=value)}, pause=pause_file(True))
            self.assertEqual(d["detail"] == older, warns, "pause=%r" % (value,))

    def test_a_paused_file_with_no_time_still_pauses(self):
        d = decide({}, pause='{"v":1,"paused":true}')
        self.assertEqual((d["look"], d["since"]), ("paused", 0))

    def test_no_pause_file_or_a_missing_one_means_not_paused(self):
        self.assertEqual(decide({"a.json": session()})["look"], "screen")
        done = subprocess.run([BIN, "--decide", "/nonexistent/state", "--pause-file", "/nonexistent/pause.json",
                               "--now", str(NOW)], capture_output=True, text=True, timeout=30)
        self.assertEqual(json.loads(done.stdout)["look"], "hidden")

    def test_a_pause_file_that_cannot_be_trusted_counts_as_paused(self):
        bad = ["", "[]", "null", '"paused"', "garbage", '{"paused":"yes"}', '{"paused":1}', '{"paused":null}',
               '{"v":1}', '{"paused": ', "{}"]
        for text in bad:
            d = decide({"a.json": session()}, pause=text)
            self.assertEqual(d["look"], "paused", "pause file %r" % text)
            self.assertEqual(d["button"], "resume", "pause file %r" % text)
            self.assertGreater(d["since"], 1_000_000_000_000, "since is the file's own time for %r" % text)

    def test_a_pause_file_the_mod_would_read_differently_counts_as_paused(self):
        # The mod reads this file with JavaScript's JSON.parse. Where that and this program could disagree, the
        # light stops Claude too, so the light never shows "not paused" for a file the mod refuses (or the reverse).
        cases = {
            "a byte order mark": b'\xef\xbb\xbf{"v":1,"paused":false,"at":1}',
            "two answers, resume last": b'{"v":1,"paused":true,"paused":false,"at":1}',
            "two answers, pause last": b'{"v":1,"paused":false,"paused":true,"at":1}',
            "a byte that is not UTF-8": b'{"v":1,"paused":false,"by":"\xff"}',
            "UTF-16 text": '{"v":1,"paused":false,"at":1}'.encode("utf-16"),
            "a stray NUL byte": b'{"v":1,"paused":false}\x00',
        }
        for what, raw in cases.items():
            d = decide({"a.json": session()}, pause=raw)
            self.assertEqual((d["look"], d["button"]), ("paused", "resume"), what)

    def test_ordinary_pause_files_are_still_read(self):
        # The same checks must not trip over a file that is fine: spaces, a final newline, accents, and the word
        # "paused" as a VALUE (only a second "paused" KEY counts).
        at = NOW - 500
        for text in ('{"v":1,"paused":false,"at":%d,"by":"command"}' % at,
                     '  {"paused" : false, "at": %d}\n' % at,
                     '{"v":1,"paused":false,"at":%d,"by":"paused"}' % at,
                     '{"v":1,"paused":false,"at":%d,"by":"café"}' % at):
            self.assertEqual(decide({}, pause=text)["look"], "resumed", text)
        d = decide({}, pause='{"v":1,"paused":true,"at":%d,"by":"paused"}' % at)
        self.assertEqual((d["look"], d["since"]), ("paused", at))

    def test_an_explicit_resume_is_a_green_note_for_three_seconds(self):
        d = decide({}, pause=pause_file(False, at=NOW - 1_000))
        self.assertEqual(d["look"], "resumed")
        self.assertEqual(d["title"], "Screen control is back on")
        self.assertEqual(d["detail"], "Tell Claude to carry on")
        self.assertEqual(decide({}, pause=pause_file(False, at=NOW - 2_900))["look"], "resumed")
        self.assertEqual(decide({}, pause=pause_file(False, at=NOW - 3_500))["look"], "hidden")

    def test_a_resume_with_no_time_is_not_a_note(self):
        self.assertEqual(decide({}, pause='{"v":1,"paused":false}')["look"], "hidden")

    def test_the_resumed_note_gives_way_to_a_live_session(self):
        d = decide({"a.json": session()}, pause=pause_file(False, at=NOW - 500))
        self.assertEqual((d["look"], d["button"]), ("screen", "pause"))

    def test_the_more_recent_of_the_two_notes_wins(self):
        older_back = decide({"a.json": session(mode="idle", ended=NOW - 500)}, pause=pause_file(False, at=NOW - 2_000))
        self.assertEqual(older_back["look"], "done")
        older_end = decide({"a.json": session(mode="idle", ended=NOW - 2_000)}, pause=pause_file(False, at=NOW - 500))
        self.assertEqual(older_end["look"], "resumed")

    def test_which_look_has_which_button(self):
        cases = [(decide({"a.json": session()}), "screen", "pause"),
                 (decide({"a.json": session(mode="app", app="Gemini")}), "app", "pause"),
                 (decide({"a.json": session(mode="idle", ended=NOW - 500)}), "done", "none"),
                 (decide({}, pause=pause_file(True)), "paused", "resume"),
                 (decide({}, pause=pause_file(False, at=NOW - 500)), "resumed", "none"),
                 (decide({}), "hidden", "none")]
        for d, look, button in cases:
            self.assertEqual((d["look"], d["button"]), (look, button))

    def test_the_program_reads_a_pause_file_it_wrote_itself(self):
        with tempfile.TemporaryDirectory() as folder:
            run("--press-test", "--dir", folder)  # ends with "not paused", written just now
            path = os.path.join(folder, "pause.json")
            with open(path, encoding="utf-8") as handle:
                at = json.load(handle)["at"]
            d = json.loads(run("--decide", folder, "--pause-file", path, "--now", at + 500))
            self.assertEqual(d["look"], "resumed")

    def test_a_half_written_pause_file_is_trusted_for_two_seconds_but_not_on_a_cold_start(self):
        with tempfile.TemporaryDirectory() as folder:
            got = json.loads(run("--hold-test", folder))
        self.assertEqual(got, {"cold": "unknown", "good": "resumed", "early": "resumed", "late": "resumed",
                               "expired": "unknown", "healed": "paused"})


@unittest.skipUnless(os.path.exists(BIN), "build the app first: app/build.sh")
class WindowTests(unittest.TestCase):
    def test_a_look_with_a_button_has_a_click_through_pill_and_a_small_button_panel(self):
        for look in ("screen", "app", "paused"):
            panels = {p["kind"]: p for p in inspect(look)}
            self.assertEqual(sorted(panels), ["button", "pill"], look)
            pill, button = panels["pill"], panels["button"]
            self.assertTrue(pill["ignoresMouseEvents"], look)
            self.assertFalse(button["ignoresMouseEvents"], look)
            self.assertEqual(pill["level"], button["level"], look)
            self.assertEqual(pill["level"], 1000, look)  # the screen-saver level
            for p in (pill, button):
                self.assertFalse(p["canBecomeKey"], look)
                self.assertFalse(p["canBecomeMain"], look)
                self.assertTrue(p["isFloatingPanel"], look)
                self.assertIn("canJoinAllSpaces", p["collectionBehavior"], look)
                self.assertIn("fullScreenAuxiliary", p["collectionBehavior"], look)
            self.assertEqual(pill["collectionBehavior"], button["collectionBehavior"], look)

    def test_the_button_panel_lies_over_the_right_end_of_the_pill(self):
        for look in ("screen", "app", "paused"):
            panels = {p["kind"]: p["frame"] for p in inspect(look)}
            pill, button = panels["pill"], panels["button"]
            self.assertEqual((button["w"], button["h"]), (40, 40))
            self.assertLessEqual(pill["w"], 400)
            self.assertLessEqual(pill["h"], 76)
            self.assertGreaterEqual(button["x"], pill["x"] + pill["w"] / 2)
            self.assertLessEqual(button["x"] + button["w"], pill["x"] + pill["w"])
            self.assertGreaterEqual(button["y"], pill["y"])
            self.assertLessEqual(button["y"] + button["h"], pill["y"] + pill["h"])
            # The 34 pt disc is 14 pt in from the screen edge and centred up and down.
            self.assertEqual(pill["x"] + pill["w"] - (button["x"] + button["w"] / 2 + 17), 14)
            self.assertEqual(button["y"] + button["h"] / 2, pill["y"] + pill["h"] / 2)

    def test_window_origins_are_whole_points(self):
        for look in ("screen", "app", "paused", "done", "resumed"):
            for p in inspect(look):
                for key in ("x", "y", "w", "h"):
                    self.assertEqual(p["frame"][key], int(p["frame"][key]), (look, p["kind"], key))

    def test_looks_without_a_button_have_no_button_panel(self):
        for look in ("done", "resumed"):
            kinds = [p["kind"] for p in inspect(look)]
            self.assertEqual(kinds, ["pill"], look)
        self.assertEqual(inspect("hidden"), [])
        self.assertTrue(inspect("done")[0]["ignoresMouseEvents"])


@unittest.skipUnless(os.path.exists(BIN), "build the app first: app/build.sh")
class PressTests(unittest.TestCase):
    def play(self, folder, steps, *more):
        """Plays press-test steps; returns what they printed (JSON lines as dicts, other lines as text)."""
        lines = run("--press-test", "--dir", folder, "--steps", steps, *more).strip().splitlines()
        return [json.loads(line) if line.startswith("{") else line for line in lines]

    def test_pressing_the_button_toggles_the_pause_file(self):
        with tempfile.TemporaryDirectory() as folder:
            before = time.time() * 1000
            lines = run("--press-test", "--dir", folder).strip().splitlines()  # two deliberate presses
            after = time.time() * 1000
            self.assertEqual(len(lines), 2)
            first, second = json.loads(lines[0]), json.loads(lines[1])
            self.assertEqual((first["v"], first["paused"], first["by"]), (1, True, "light"))
            self.assertEqual((second["v"], second["paused"], second["by"]), (1, False, "light"))
            for written in (first, second):
                self.assertTrue(before - 1_000 <= written["at"] <= after + 1_000)
            self.assertLessEqual(first["at"], second["at"])
            # A write is a temporary file renamed over the real one, so nothing else is left behind.
            self.assertEqual(os.listdir(folder), ["pause.json"])

    def test_a_double_click_on_pause_does_not_go_on_to_resume(self):
        # After the first press the same spot is the Resume button; a second press right behind it must change nothing.
        with tempfile.TemporaryDirectory() as folder:
            got = self.play(folder, "press file wait:0.2 press file wait:0.2 press file")
            self.assertEqual([g["paused"] for g in got], [True, True, True])
            self.assertEqual(got[0], got[1])  # nothing was written: same file, same time
            self.assertEqual(got[0], got[2])

    def test_the_second_click_of_a_double_click_is_ignored_whatever_the_gap(self):
        # A press that carries click count 2 is never a press, even when the clock says plenty of time has passed.
        with tempfile.TemporaryDirectory() as folder:
            got = self.play(folder, "press file wait:5 press2 file")
            self.assertEqual([g["paused"] for g in got], [True, True])
            self.assertEqual(got[0], got[1])

    def test_a_deliberate_second_press_a_moment_later_still_resumes(self):
        with tempfile.TemporaryDirectory() as folder:
            # 0.9 s after the first press is too soon; an ignored press does not push the time back, so 0.2 s later
            # (1.1 s after the first) the next press counts.
            got = self.play(folder, "press file wait:0.9 press file wait:0.2 press file")
            self.assertEqual([g["paused"] for g in got], [True, True, False])

    def test_dragging_out_of_the_button_and_back_in_before_letting_go_is_still_a_press(self):
        with tempfile.TemporaryDirectory() as folder:
            got = self.play(folder, "dragback file")
            self.assertEqual([g["paused"] for g in got], [True])

    def test_letting_go_outside_the_button_is_not_a_press(self):
        with tempfile.TemporaryDirectory() as folder:
            self.assertEqual(run("--press-test", "--dir", folder, "--release-outside").strip(), "no file")
            self.assertEqual(os.listdir(folder), [])

    def test_a_pause_that_could_not_be_saved_changes_nothing_and_says_so_for_a_moment(self):
        with tempfile.TemporaryDirectory() as folder:
            before, after, later, gone = self.play(folder, "shown press shown wait:2 shown wait:2 shown", "--fail")
            plain = "Hands off the mouse and keyboard"
            note = "Could not pause. Type /screen-light pause"
            self.assertEqual(before, {"button": "pause", "detail": plain, "look": "screen"})
            self.assertEqual(after, {"button": "pause", "detail": note, "look": "screen"})  # the button stays as it was
            self.assertEqual(later["detail"], note)  # still there 2 s on
            self.assertEqual(gone["detail"], plain)  # gone after 4 s
            self.assertEqual(os.listdir(folder), [])  # and nothing was written

    def test_a_resume_that_could_not_be_saved_says_so_too(self):
        with tempfile.TemporaryDirectory() as folder:
            with open(os.path.join(folder, "pause.json"), "w", encoding="utf-8") as handle:
                json.dump(pause_file(True, at=int(time.time() * 1000) - 1_000), handle)
            before, after = self.play(folder, "shown press shown", "--fail")
            self.assertEqual((before["look"], before["button"]), ("paused", "resume"))
            self.assertEqual((after["look"], after["button"]), ("paused", "resume"))
            self.assertEqual(after["detail"], "Could not resume. Type /screen-light resume")

    def test_a_press_that_failed_can_be_tried_again_at_once(self):
        # Only a press that changed the file starts the double-click guard; a failed one does not.
        with tempfile.TemporaryDirectory() as folder:
            got = self.play(folder, "press press shown", "--fail")
            self.assertEqual(got[0]["detail"], "Could not pause. Type /screen-light pause")


@unittest.skipUnless(os.path.exists(BIN), "build the app first: app/build.sh")
class CrabTests(unittest.TestCase):
    def picture(self, name):
        return run("--crab-ascii", name).splitlines()

    def pose(self, look, phase, *flags):
        return run("--pose", look, phase, *flags).splitlines()

    @staticmethod
    def right_arm_top(rows):
        # Column 12 is only ever the right arm (the body ends at column 11).
        return min(r for r, row in enumerate(rows) if row[12] == "O")

    def test_the_standing_crab_is_the_one_in_the_art_spec(self):
        rows = self.picture("standing")
        self.assertEqual(rows[:9], [
            "...............",
            "...OOOOOOOOO...",
            "...OOKOOOKOO...",
            "...OOKOOOKOO...",
            ".OOOOOOOOOOOOO.",
            ".OOOOOOOOOOOOO.",
            "...OOOOOOOOO...",
            "...O.O...O.O...",
            "...O.O...O.O...",
        ])
        self.assertEqual(rows[9], "..___________..")  # the ground line, y 9, x 2..12
        self.assertEqual(rows[10:], ["...............", "..............."])

    def test_the_poses_that_should_be_symmetric_are(self):
        # The crab itself is symmetric; the window's three title-bar dots sit on the left, so only the rows
        # above the window (rows 0..5) are compared for the peeking poses.
        for name in ("hold-1", "hold-2-blink", "still-screen"):
            for row in self.picture(name):
                self.assertEqual(row, row[::-1], name)
        for name in ("peek-hold-1", "peek-hold-2-blink", "still-app"):
            for row in self.picture(name)[:6]:
                self.assertEqual(row, row[::-1], name)

    def test_the_window_the_crab_peeks_over(self):
        rows = self.picture("peek-hold-1")
        self.assertEqual(rows[6], "#" * 15)
        self.assertEqual(rows[7], "#-A-A-A-------#")  # title bar: three dots in the accent
        self.assertEqual(rows[8], "#" + "-" * 13 + "#")
        self.assertEqual(rows[9], "#" + "-" * 13 + "#")
        self.assertEqual(rows[10], "#" * 15)
        self.assertEqual(rows[1:6], ["...OOOOOOOOO...", "...OOKOOOKOO...", "...OOKOOOKOO...",
                                     ".OOOOOOOOOOOOO.", ".OOOOOOOOOOOOO."])  # body, eyes, arm stubs above it

    def test_happy_and_asleep_faces(self):
        happy = self.picture("happy-1")
        self.assertEqual(happy[2][3:12], "OOKOOOKOO"[:9])  # ^ ^ : points at x 5 and x 9
        self.assertEqual(happy[3][3:12], "OKOKOKOKO")      # and feet at x 4, 6, 8, 10
        asleep = self.picture("asleep-1")
        self.assertIn("...OKKKOKKKO...", asleep)             # closed dashes, x 4..6 and x 8..10
        self.assertEqual(sum(1 for row in asleep if row.startswith("...O.O...O.O")), 1)  # legs one pixel tall
        self.assertTrue(any("W" in row for row in asleep))   # the floating Z
        self.assertFalse(any("W" in row for row in self.picture("hold-1")))

    def test_the_sleeping_z_is_drawn_as_a_z_with_clear_rows_around_it(self):
        # 5 wide, 4 tall, a thick diagonal (a thin 3 x 3 or 4 x 4 one reads as a capital I). Its rows are -3..0: row 1
        # is empty above the head (whose top row is 2), and row -4 (under the pill's top edge) is empty too.
        for name in ("asleep-1", "asleep-2", "asleep-3", "still-asleep"):
            rows = self.picture(name)
            self.assertEqual(rows[:4], THE_Z, name)
            self.assertEqual(rows[4], "." * 15, name)
            self.assertEqual(rows[5], "...OOOOOOOOO...", name)

    def test_the_z_never_touches_the_crab_or_the_top_of_the_pill_at_any_moment(self):
        for phase in (0, 0.1, 0.4, 0.8, 1.2, 1.59, 2.5, -0.7):
            rows = self.pose("paused", phase)
            top = 12 - len(rows)  # the art row of the first line (the rows above row 0 are listed first)
            z = [(r, c) for r, row in enumerate(rows) for c, ch in enumerate(row) if ch == "W"]
            self.assertTrue(z, phase)
            for r, c in z:
                self.assertTrue(-3 <= r + top <= 0, (phase, r + top))
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < len(rows) and 0 <= cc < 15:
                        self.assertNotIn(rows[rr][cc], "O#-_K", (phase, r, c))

    def test_the_happy_crab_waves_its_right_arm_through_four_steps(self):
        steps = [self.right_arm_top(self.pose("done", p)) for p in (0.1, 0.3, 0.5, 0.7, 0.9)]
        self.assertEqual(steps, [2, 3, 4, 3, 2])  # high, up, down, up, and round again
        self.assertEqual(self.right_arm_top(self.pose("resumed", 0.5)), 4)
        # Reduce Motion: the arm is up, and stays there.
        for phase in (0.1, 0.5):
            self.assertEqual(self.right_arm_top(self.pose("done", phase, "--still")), 3)

    def test_the_pictures_are_taken_at_flattering_moments(self):
        self.assertEqual(self.picture("snapshot-screen"), self.picture("standing"))  # legs A, arms down
        self.assertIn("...OOKOOOKOO...", self.picture("snapshot-app"))              # looking straight ahead
        self.assertEqual(self.right_arm_top(self.picture("snapshot-done")), 2)       # the arm is high
        self.assertEqual(self.picture("snapshot-paused")[:4], THE_Z)

    def test_odd_clock_readings_do_not_crash_the_crab(self):
        # Before 2001 the clock the crab reads is negative; a silly one must not overflow either.
        for phase in ("-5", "-1e9", "1e300", "-1e300"):
            for look in ("screen", "app", "done", "paused"):
                self.assertGreaterEqual(len(self.pose(look, phase, "--working")), 12, (look, phase))

    def test_the_list_names_every_frame_of_the_sheet(self):
        names = run("--crab-ascii", "list").split()
        for wanted in ("scuttle-1", "scuttle-4", "hold-1", "hold-2-blink", "peek-work-4", "peek-hold-2-blink",
                       "happy-1", "happy-4", "asleep-1", "asleep-3", "still-asleep"):
            self.assertIn(wanted, names)


@unittest.skipUnless(os.path.exists(BIN), "build the app first: app/build.sh")
class NumberTests(unittest.TestCase):
    def test_the_clock_text_survives_silly_numbers(self):
        got = run("--clock-test", "0", "-5000", "999", "61000", "3661000", "1e22", "inf", "-inf", "nan").splitlines()
        # A huge time is capped at a billion seconds (before, 1e22 made the program crash while drawing the clock).
        self.assertEqual(got, ["0:00", "0:00", "0:00", "1:01", "1:01:01", "277777:46:40", "277777:46:40", "0:00", "0:00"])


@unittest.skipUnless(os.path.exists(BIN), "build the app first: app/build.sh")
class UpdateTests(unittest.TestCase):
    def takes_over(self, other_version, other_started, my_version, my_built):
        return run("--older-test", other_version, other_started, my_version, my_built).strip() == "true"

    def test_a_light_from_an_older_version_is_replaced(self):
        self.assertTrue(self.takes_over("0.1.1", "-", "0.2.0", "-"))
        self.assertTrue(self.takes_over("0.9.0", "-", "0.10.0", "-"))  # numbers, not text
        self.assertTrue(self.takes_over("0.1.1", 5000, "0.2.0", 1000))  # the version decides, not the times

    def test_a_light_of_the_same_version_started_before_this_build_is_replaced(self):
        # An update replaced the app on disk while the old light was still up: same numbers, older program.
        self.assertTrue(self.takes_over("0.2.0", 1000, "0.2.0", 2000))

    def test_a_newer_equal_or_unknown_light_is_left_alone(self):
        self.assertFalse(self.takes_over("0.2.0", 3000, "0.2.0", 2000))  # started after this build was made
        self.assertFalse(self.takes_over("0.3.0", 1000, "0.2.0", 2000))  # a newer version, however it was started
        self.assertFalse(self.takes_over("0.2.0", "-", "0.2.0", "-"))
        self.assertFalse(self.takes_over("-", "-", "0.2.0", "-"))
        self.assertFalse(self.takes_over("junk", "-", "0.2.0", "-"))


@unittest.skipUnless(os.path.exists(BIN), "build the app first: app/build.sh")
class PictureTests(unittest.TestCase):
    def snap(self, folder, which):
        out = os.path.join(folder, "%s.png" % which)
        done = subprocess.run([BIN, "--snapshot", out, which], capture_output=True, text=True, timeout=60)
        self.assertEqual(done.returncode, 0, done.stderr)
        return out

    def test_snapshots_have_the_documented_sizes(self):
        # Points times two: the lights are 700 pt wide and 100 pt tall each; the sheet is 800 x 656 pt.
        sizes = {"all": (1400, 1000), "sheet": (1600, 1312), "hover": (1400, 400), "text": (1400, 1000),
                 "screen": (1400, 200), "app": (1400, 200), "done": (1400, 200), "paused": (1400, 200),
                 "resumed": (1400, 200)}
        with tempfile.TemporaryDirectory() as folder:
            for which, size in sizes.items():
                self.assertEqual(png_size(self.snap(folder, which)), size, which)

    def test_snapshot_without_a_look_draws_them_all(self):
        with tempfile.TemporaryDirectory() as folder:
            out = os.path.join(folder, "x.png")
            run("--snapshot", out)
            self.assertEqual(png_size(out), (1400, 1000))

    def test_pictures_are_the_same_every_time(self):
        with tempfile.TemporaryDirectory() as folder:
            first = self.snap(folder, "all")
            with open(first, "rb") as handle:
                one = handle.read()
            second = self.snap(folder, "all")
            with open(second, "rb") as handle:
                two = handle.read()
            self.assertEqual(one, two)


if __name__ == "__main__":
    unittest.main()
