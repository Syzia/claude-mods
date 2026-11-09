# Kinds of job: where the art is, what to send, what to watch for

Status: every kind of set below is UNVERIFIED. Until a row in the Results table of `proof-protocol.md` says PASS for a kind, tell the owner "not yet proven" when you offer a set of that kind, and keep it optional.

A kind is only a recipe name used in this file: `figure`, `head`, `place`, `hour` and `style`. It is never stored in a set and the scripts never see it. A set is one to three pictures, each with one role. For each kind this file gives the files to use, the exact `build` description (fill in the parts in angle brackets and the crop numbers), the keep line, the prompt that goes after the anchor, and the traps. Read the scope rule in SKILL.md first: plain game art only.

| The job | The kind |
|---|---|
| A new picture of a whole character with one change (a smile, for example; the result is a redraw of the whole figure) | `figure` |
| A new head or expression, to be joined to the existing body | `head` |
| A close-up of one part of a room | `place` |
| Another hour of the day for a close-up that already exists | `hour` |
| A new background or icon in the game's own look | `style` |

## Where the owner's art is

Checked 9 Nov 2026. Folders move and art gets redrawn, so confirm that a path exists before you use it (list the folder, then open the picture with the Read tool). "RGBA" below means the picture has see-through parts.

- Arc 1 Final sprites: `~/Desktop/Character reworks/Arc 1 Final/<Name>.png` (RGBA, about 938x1677; 39 files, for example `Nanami.png`, `Gojo.png`, `Kaito_Jujutsu_High.png`). Expression crops: `.../Arc 1 Final/Expressions/<Name>/`.
- The game's installed sprites: `~/Desktop/JJKgame.md/game/images/char/<who>_<mood>.png` (RGBA 760x1400). Do not use anything in `game/images/char/outfits/` or `game/images/char/romance_poses/` (the builder refuses them).
- Backgrounds: `~/Desktop/JJKgame.md/game/images/bg/<stem>.png` (1920x1080). The owner's approved 2K renders (better for crops): `~/Desktop/JJK Game images/ui2/approved/` (for example 2752x1536; the picture's own brief is in its PNG text chunk `prompt`). `game/layout/pictures.json` names the render for each picture; revision 1 pictures and `game/images/bg/standin/` are not anchors. (A text chunk is a note stored inside the picture file.)
- Icons: `~/Desktop/JJKgame.md/game/images/icons/ic_*.png` (96x96, white line plus one pastel accent; not the bath, pool, swim, sauna or onsen icons); the owner's new direction is `~/Desktop/Character reworks/UI icons and items/Rework 2026-10-26/Style study 02.png` (decided by the owner; ask which).
- Read `~/Desktop/Character reworks/README_ARC_1_FINAL_ISSUES_2026-10-26.md` before using a Final as an anchor: some Finals are poor anchors (both Kaitos, Todo, a stern Nanami neutral).

## The kinds

Each description below goes to `build` as the text between `<<'JSON'` and `JSON` (see "The command forms" in SKILL.md). Run it with `--preview` first, zoom in, write the keep line, then run it for real.

### 1. figure (identity, one picture)

The Final art flattened onto a flat key colour, same size. (A key colour is the flat colour put behind a cut-out figure.)

```json
{"name": "nanami-final-v1",
 "keep": "round lenses dark olive green; suit muted beige; tie mustard yellow with dark spots; shoes dark brown",
 "pictures": [
   {"role": "identity", "source": "~/Desktop/Character reworks/Arc 1 Final/Nanami.png", "key": "#FF00FF"}
 ]}
```

- Key colour: green `#00FF00` unless the person wears green, then magenta `#FF00FF` (magenta for Maki, Sana, Kaito and Nanami's green lenses); never grey or white (the game's keyer refuses them).
- Prompt after: the one change, `One character, standing, whole body from head to feet inside the frame with space around him. Flat pure magenta (#FF00FF) background, no gradient, no shadow on the ground, nothing else in the picture. Tall portrait, 9:16. No text, no logo, no watermark.`
- Traps: a generator redraws colours (6 Nov: brighter lenses, orange shoes), so name the colours that matter in the keep line, from a zoomed crop. A whole-body picture is a redraw, not a drop-in expression (see `head`).

### 2. head (identity, UNVERIFIED)

A head crop of the Final for expression jobs: add `"crop":[x0,y0,x1,y1]` around the head. The result is a new head only; it is joined to the body with the game's `tools/arc1_final.py compose` (in the game's worktree; unverified for generator-made faces).

```json
{"name": "nanami-head-v1",
 "keep": "<the colours and parts of the head that must not change>",
 "pictures": [
   {"role": "identity", "source": "~/Desktop/Character reworks/Arc 1 Final/Nanami.png", "crop": [x0, y0, x1, y1], "key": "#FF00FF"}
 ]}
```

- Say plainly that a whole-body redraw is not a drop-in expression (`nanami_happy` and `nanami_neutral` differ only in the head).
- Nothing goes into the game folder without the owner's say, so ask before you run the game's joining tool.

### 3. place (a close-up)

TWO pictures, the exact view and its room. The crop must be exactly 16:9.

```json
{"name": "courtyard-vending-v1",
 "keep": "red vending machine at the right; dark timber wall; grey paving slabs",
 "pictures": [
   {"role": "place", "source": "<the approved render>", "crop": [x0, y0, x1, y1], "size": [1672, 941]},
   {"role": "room", "source": "<the approved render>"}
 ]}
```

- The owner's rules (6 Nov): copy the object as it is in its room; fill the screen; no empty half for a menu; no invented furniture; never order a turned object to face the camera; name each object's real colour from a zoomed crop in the keep line; take a menu's place and size from the real screen code (`game/room_spots.rpy`), not from a batch note.
- Prompt after: `The same view, 16:9. No people, no animals, no text, no logos.` plus the one change.

### 4. hour (another time of day of a close-up that exists)

TWO pictures, the approved day close-up (`place`, from the inbox, so provenance `generated` and `owner_said` are needed) and the room's own picture at that hour (`light`, the game's art). Provenance means where a picture came from: a picture a generator made counts as `generated`, which is why the owner's say is needed.

```json
{"name": "courtyard-vending-evening-v1",
 "keep": "<the colours and parts that must not change>",
 "owner_said": "<the owner's yes, in their words>",
 "pictures": [
   {"role": "place", "source": "<the approved day close-up, the copy in the inbox>"},
   {"role": "light", "source": "<the room's own picture at that hour>"}
 ]}
```

- Only hours the room has; `_lit` only for rooms the game lists; outdoor nights say the moon is full or not in view.
- Never for the bathhouse, onsen, pool, sauna or beach rooms. The builder refuses their folder and file names but cannot see what a picture shows, so check the name and the picture yourself; if it is one of those rooms, stop and tell the owner once.
- Prompt after: the hour in words (`The evening version: low warm sunlight, long shadows.`) and `16:9. No people, no animals, no text, no logos.`
- Watch for colours running too vivid (+0.19 saturation seen on 6 Nov): check it with `measure`.

### 5. style (a new place or icon in the game's look)

One or two `style` pictures that are the game's own typical pictures, unchanged (for a background: two current day backgrounds such as `game/images/bg/courtyard.png` and `classroom.png`).

```json
{"name": "bg-style-v1",
 "keep": "soft muted colour; hand painted look",
 "pictures": [
   {"role": "style", "source": "~/Desktop/JJKgame.md/game/images/bg/courtyard.png"},
   {"role": "style", "source": "~/Desktop/JJKgame.md/game/images/bg/classroom.png"}
 ]}
```

- A character picture as a style picture is untested: avoid it. No run has shown that the set's words stop a style picture's subject from being copied (only background-for-background style pictures were ever tried), so look for copied objects.
- Not the bath, pool, swim, sauna or onsen backgrounds or icons.
- Prompt after: the brief itself.

## What happened on each route

Copy of the evidence so far. Empty cells and "not tried" mean nobody has tried it.

| Kind | Codex | Antigravity | Gemini app |
|---|---|---|---|
| figure | 6 Nov, plain reference (no set): kept the character, redrew colours (brighter lenses, orange shoes); a sentence naming the colours cut the colour distance from 14.2 to 9.2-10.9. Set: UNVERIFIED | 6 Nov, plain reference: stayed closest in colour (3.8) but a paler backdrop, returns JPEG. Set: UNVERIFIED | 6 Nov, plain reference: closest in colour (4.2), by hand only. Set: UNVERIFIED |
| head | not tried | not tried | not tried |
| place | worked by hand, 6 Nov: the exact crop first, the room second; colour within 0.06-0.08 of the rooms | not tried | not tried |
| hour | worked by hand, 6 Nov (owner's memory note `desk-art-location-picks`): 17 hour pictures were made, one for each hour a room has, and each was judged to line up with its day picture by eye, not by a measurement; one (the Library's lit picture) was run twice; colour ran vivid, up to about +0.19 saturation | not tried | not tried |
| style | worked by hand, 6 Nov: saturation 0.37 down to 0.30 with two game backgrounds | 6 Nov: looked closer to the game but scored lowest (4.3 and 3.4), 288 s | not tried |

## Key colours and keep lines

**Key colour.** A Final or an installed sprite is a cut-out with see-through parts around the figure, so it needs a `key`: the flat colour that goes behind it. Pick the colour the person does not wear: green `#00FF00` for most, magenta `#FF00FF` for anyone who wears green. Never grey or white. Write the colour in quotes, and use the same colour in the prompt's backdrop sentence. A set stores each picture without see-through parts and without a colour profile (it keeps plain, standard colours, which is right for the owner's art). How Codex, Antigravity and the Gemini app treat see-through parts in a reference picture is not documented, so flatten first.

**Keep line.** It holds colours and parts that you can see in a zoomed crop. Zoom first (`anchor_look.py zoom`), then write what you saw. Plain ASCII, one line, 300 characters at most.

- Good, a figure: `round lenses dark olive green; suit muted beige; tie mustard yellow with dark spots; shoes dark brown`
- Good, a close-up: `red vending machine at the right; dark timber wall; grey paving slabs`
- Good, a style: `soft muted colour; hand painted look`
- Not good: a list of faults (`fix the mouth, less angry, move the arm`). Say what the finished picture looks like instead.
- Not good: a name of a person or of the series.
- Not good: a word the scope rule keeps out (the builder refuses it), a letter with an accent, a curly quote, or more than 300 characters.

## The prompt after the anchor

The set's words already say what each picture is for. The prompt says only what to make: the one change, the shape, the backdrop, and no text, no logo, no watermark. It does not repeat what the words say (that a picture is the character to keep, or the exact view to paint), name a file or a path, name a person or the series, list faults, or order an object turned toward the camera. Say what you want in positive words, and say once what must be left out.

One exception to "no names". Codex gets no file names, only its pictures in order, so the words' "Picture 2 (room)" relies on the model matching "the second picture" to the second one it was given. If a run shows the generator mixing up which picture is which, the next step is ONE plain sentence in the prompt saying what each numbered picture SHOWS (the Codex prompts that worked by hand did exactly this: "the second reference picture is the whole lounge at night"), not more role words. Antigravity is told each picture's name and number, so it is not affected in the same way.

## What is still unproven

- Whether a set beats the plain way (one reference picture in `refs`). The live proof in `proof-protocol.md` has not been run.
- Whether the set's first sentence stops a style picture's subject from being copied (see `style`).
- How many pictures help. Of 111 earlier jobs, one used three reference pictures. Up to three in a call is the tested range; four to six are untested.
- Antigravity's default picture model may be a "Lite" one, which Google says is not built for several reference pictures: use one identity picture there. In the Gemini app pick Pro or Flash, not Flash-Lite. The Gemini app route is by hand and outside every automatic check.
- Whether a head made by a generator joins the game's body cleanly (`head`).
- Codex's picture model is still changing (the docs name one model and OpenAI's note of 8 Sep 2026 says a newer one is rolling out), so repeat the proof after a ChatGPT app update.
