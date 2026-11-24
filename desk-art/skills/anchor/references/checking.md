# Checking a result

Use this after a picture comes back from a set. The rule behind all of it: compare with the set, never with the last picture. Look first, measure second, and say plainly which was which. In the commands below `S`, `PY`, `INBOX` and `<ROOT FLAGS>` are set up as in "Set up the commands" in SKILL.md.

## 1. The receipt

The result must show `References sent to ...` and `Anchor set <name> sent to ...` with the roles you meant; the manifest row has an `anchor` key. If the line is missing, the call did not use the set: say so and do not count the picture as evidence.

The second line looks like this: `Anchor set nanami-final-v1 sent to OpenAI: picture 1 identity (9f2c0a1b); 1 extra picture after the set. Words version 2.` The eight characters in brackets are each picture's short fingerprint. They must match the `sha8` that `build` or `show` printed for that picture.

## 2. Look

Open the result and the first anchor with the Read tool (the first anchor is the set's picture 1; `show` prints its `path`). What to check, by kind of set:

- identity: eye colour and size, hair, marks such as a scar, glasses, every colour in the keep line, outline darkness, shading, anything added.
- place: every object's place, size and angle; nothing added, removed or turned toward the camera; saturation not much above the room's.
- hour: only the light changed; not too vivid.
- style: nothing copied from the style pictures' subjects; the same softness and colour strength.

If the generator seems to have mixed up which picture is which, remember that Codex sees its pictures only in order, with no file names. Add ONE plain sentence to the next prompt saying what each numbered picture shows (see "The prompt after the anchor" in `classes.md`) and note that run as its own try.

## 3. Show the owner

Make the `beside` picture (with `--zoom` on the head, or on the part that drifted) and send the file.

```bash
"$PY" -I -B "$S/anchor_look.py" beside --inbox "$INBOX" <ROOT FLAGS> NAME RESULT --zoom 0.30,0.00,0.70,0.25
```

`RESULT` is the full path of the picture the tool filed. `--zoom` takes four fractions of the picture from 0 to 1 (left, top, right, bottom), each side at least 0.05; a second row then shows that same part cut from the anchor and from the result. The answer's `file` is the new picture (open it with the Read tool, and send it to the owner with the SendUserFile tool if you have it, otherwise give the path).

Open with ONE plain sentence: "Biggest difference: the shoes came back orange." Numbers go to the owner only if asked, and never as a pass or fail.

## 4. Measure

```bash
"$PY" -I -B "$S/anchor_look.py" measure --inbox "$INBOX" <ROOT FLAGS> NAME RESULT --key "#FF00FF"
```

`measure` prints numbers for you. They flag; they never accept a picture. Say plainly what was measured and what was only looked at. The numbers are not calibrated: the first live runs set them (`proof-protocol.md`). There is no limit yet, so never say a picture "passed".

Which checks run depends on the set. For the sentence you say to the owner, use plain words ("the suit's colours are close; the shoes are furthest away"), never the short names below.

| Check | It runs when | What it compares | How to read it |
|---|---|---|---|
| `backdrop` | the set has an `identity` picture and you gave `--key` | the four corners of the result with the flat backdrop colour | `corners` (top-left, top-right, bottom-left, bottom-right) and `max` are colour distances: 0 is exactly the key colour, and a bigger number is a backdrop further from flat |
| `colour` | the same | the figure in the result with the figure in the first `identity` picture, both cut into a grid of 4 columns by 8 rows | `median` and `p90` (all but the worst tenth of the cells are below it): smaller is closer. `worst` lists the three cells that differ most, each with `de`, the size of the difference. Its `part` is a guide by height: `head` is the top quarter of the figure, `body` the next three eighths, `legs` the next quarter and `feet` the bottom eighth. Zoom on that part to see what changed |
| `scene` | the set has a `style`, `light`, `place` or `room` picture | the strength of the colours (`saturation`) and the lightness (`brightness`) of the result, against the `style` and `light` pictures, or against the `place` picture when there are none | `delta` is the result minus that reference: a positive `saturation` means the result is more vivid than the reference. The game's own day backgrounds average about 0.29 saturation and 0.54 brightness |
| `lineup` | the set has a `place` picture | how well the edges in the result line up with the edges in the `place` picture | `r` is near 1 when the lines match and near 0 when they have nothing in common. The two shapes must agree within 3 percent, or the whole `measure` stops (see the note about shapes below the table) |

- Without `--key`, `backdrop` and `colour` are listed under `skipped`, with the reason `give --key (the flat backdrop colour) to measure the backdrop and the colour`. If nothing could run, `measure` stops with `bad-input` and says why: then say "nothing was measured".
- If the result's shape differs from the `place` picture's by more than 3 percent (a 1672 by 941 result is fine; a 1536 by 1024 one is not), `lineup` cannot run. It belongs to the same command, so the whole `measure` stops with `bad-input` and prints no numbers at all, `scene` included. Then either say "nothing was measured", or cut a 16 by 9 copy of the result with `zoom` (for 1536 by 1024: `0,0.078,1,0.922`), run `measure` on that copy, and say plainly that the measured picture is a cropped copy.
- `--skip-top F` (a number from 0 to 0.5) leaves out the top part of the figure when the head was meant to change. Do not use it when the head holds colours the keep line names (for example the lenses of glasses).
- A result with see-through parts is laid on the key colour (white when no key was given) before it is measured, and the answer says `flattened`.

## 5. The project's checkers

Use them only when they know the subject; otherwise say "nothing was measured". Run from `/Users/hunterjolly/Desktop/JJK_worktrees/final_art`, and give `--out` a new, empty folder that is not inside the game folders (tell the owner where it is):

- `tools/py_art.sh .claude/skills/face-consistency/scripts/face_check.py <picture> --character <name> --out <new folder>` (eight women: nobara, maki, mei_mei, utahime, shoko, miwa, momo, mai)
- `tools/py_art.sh .claude/skills/art-style-consistency/scripts/style_check.py <picture> --class sprite|portrait|background|fg|icon|prop|ui --character <name> --out <new folder>` (17 people)

`style_prompt.py lock --class C --target nano-banana` writes the style words and anchor pictures that can seed a `style` set. The body skill is paused: not used unless the owner asks. If a script is missing, say so.

## 6. The drift ladder

> Compare with the set, never with the last picture.
>
> First slip: run once more, same version, with one sentence about the slip in the prompt, in positive words.
>
> The same slip twice: the set is at fault. Make the next version (a closer crop, a sharper keep line) and ask the owner for a yes.
>
> A face or a mark words cannot fix: the project's fix routes, or change route once (Antigravity and Gemini stayed closer in colour than Codex on full-body edits; Codex gave the cleaner backdrop).
>
> A place: re-crop the view to an exact 16:9 and never order an object turned.
>
> Style drifting (grey outline, glow, airbrush): add or replace the style picture; pixel repairs belong to the project's style fix routes.
>
> Third run, or any refusal: stop. Show the best two with what you saw. Offer the game's pixel fixes, a hand redraw, or accepting it. Never reword a refusal.

## 7. Promotion

A picture the owner approves becomes an anchor only as a NEW set built from the exact file the owner chose, with `owner_said` (their words), and never as the only picture of the set. An hour set is exactly this, once.
