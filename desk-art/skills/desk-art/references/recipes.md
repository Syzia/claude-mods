# Recipes: prompts that worked on real jobs

Written on 6 Nov 2026 from two real jobs. Read it before a background or an expression change. Every recipe says what was sent, what came back and how it was judged. The scope rule in SKILL.md still applies: plain game art only, and nothing goes into the game folder without the owner's say.

## 1. A new background, from the game's own brief

The job: the Courtyard's vending machine, close up (item 3 of "New rooms and interactions" in `docs/STILL_TO_DO.md`). The game already holds the picture the owner chose (`game/images/bg/vending_close.png`), so the new pictures could be compared with a real one.

**Where the brief lives**
- The batch row in `tools/art/batches.json` (the row with `id` "60"): `words`, `frame`, `light` and three yes/no `check` lines.
- The exact text the game's own route sent is stored inside every picture it made. ComfyUI keeps it in the PNG text chunk `prompt` (JSON; with Pillow: `Image.open(path).info["prompt"]`). The node `GeminiImage2Node` holds `prompt`, `model`, `seed`, `aspect_ratio` and `resolution`. For the vending machine that was model `gemini-3-pro-image-preview` (Nano Banana Pro), 16:9, 2K (2752x1536), seeds 6202 and 6203 for versions A and B, no reference pictures. The owner picked B on 3 Nov 2026. The pictures are in `~/Desktop/JJK Game images/ui2/approved/`.
- The game then makes the picture 1920x1080: `tools/install_bg.py` crops to exactly 16:9 if the render is off-ratio, then enlarges with Catmull-Rom. That tool writes into `game/images/bg`, so ask the owner first.
- The game's own route costs about $0.16 a render, two renders per picture (`tools/art/batches.json`).

**What was sent**
1. Words only: the full 1,609-character prompt, unchanged, ending "Output a 16:9 picture." to `codex_image` and `agy_image`, twice each (the game paints two versions too).
2. Words and style pictures: the same prompt with two of the game's day backgrounds attached (`game/images/bg/courtyard.png` and `classroom.png`) and this paragraph before "No people, no animals, no text, no logos.": `THE STYLE: the two attached pictures are existing backgrounds from this same game. Match their painting style, their soft muted colour and saturation, their lighting and their level of detail exactly. Do not copy their composition or what is in them.`

**What came back**

| | Time | Size | Colour (saturation / brightness) | Machine's left edge | Notes |
|---|---|---|---|---|---|
| The game's pick (paid route) | | 2752x1536, 1920x1080 in the game | 0.20 / 0.56 | 54%, just right of the panel | the calmest under the panel |
| Codex, words only (2 runs) | 43 s, 50 s | 1672x941 PNG | 0.37 to 0.38 / 0.57 to 0.67 | 57% to 58% | far more vivid than the game's look; a forest or a window view; trees and sky seen through the machine's glass |
| Codex, with style pictures | 49 s | 1672x941 PNG | 0.30 / 0.53 | 63% | on the game's look; plain timber wall; blank cans |
| Antigravity, words only | 160 s for 3 drafts, 95 s | 1376x768 JPEG | 0.22 to 0.26 / 0.55 to 0.59 | 62% to 69% | close to the game's colour; a draft with a forest, one with a price "¥150" on the display |
| Antigravity, with style pictures | 288 s for 2 drafts | 1376x768 JPEG | 0.25 to 0.28 / 0.39 to 0.53 | 69% | on the game's look; the first draft showed forest through a gap above the wall, the refined one did not |
| Codex, style pictures and a "fixes" paragraph (2 runs) | 52 s, 47 s | 1672x941 PNG | 0.36 and 0.33 / 0.51 and 0.52 | 65% to 66% | the named faults are gone; looks more like a render than a painting; not judged |

The game's own 12 daytime backgrounds average saturation 0.294 (give or take 0.049) and brightness 0.54 (give or take 0.08). The menu panel covers x 60 to 1020 of the 1920x1080 screen (3% to 53% of the width) and y 96 to about 850: that is in the game's code (`game/room_spots.rpy`, screen `spot_vend_menu`: `xpos 60`, `ypos 96`, `xsize 960`), not in the batch note, whose "x 110 to 1150" is older. The machine must stand to the right of 53% and the area under the panel must be calm. Always read the real screen code for a panel's place and size, and draw a stand-in panel on each candidate before judging it. A first round of judging that used the batch note's numbers wrongly marked down pictures whose machine stands at 54% to 60%.

**The recipe**
1. Take the brief from the batch row, or from the PNG text chunk of an existing picture, and send it unchanged.
2. Attach two existing daytime backgrounds as style pictures (they must be inside the allowed folders) and add the STYLE paragraph. Without them Codex came out much too vivid and both routes added things the brief did not ask for.
3. Make two pictures per route.
4. Look at every picture a call returns: Antigravity may return several drafts. With references it also logged the pictures it was shown; since 0.1.4 those are not filed as results.
5. Check the row's yes/no lines. Zoom on the machine front for letters, numbers and logos (the check says every can and panel is blank).
6. Show the owner the candidates beside the game's own picture, and ask before anything is installed.

**How the results were judged (6 Nov 2026, blind)**

Three independent AI judges saw the pictures under neutral names, at the same size, with a stand-in for the real menu panel drawn on: a brief checker (the words and the three yes/no lines), a defect hunter (text, geometry, reflections, dirt) and an art director (fit with three of the game's own backgrounds, and as a backdrop behind the panel). Scores run 0 to 10.

| | Brief | Defects | Art director |
|---|---|---|---|
| Codex, words only, run B | 8.4 | 5.2 | 7.8 |
| Codex, words only, run A | 7.9 | 7.0 (first round) | 6.5 |
| Codex + style pictures | 7.4 | 5.7 | 6.9 |
| Antigravity, words only, final draft | 6.8 | 7.4 | 5.3 |
| The game's pick (paid route) | 6.5 | 8.3 | 5.0 |
| Antigravity + style pictures, first draft | 6.0 | 6.9 | 5.6 |
| Antigravity, words only, run B | 5.9 | 7.3 (first round) | 6.7 |
| Antigravity + style pictures, refined | 4.3 | 6.5 | 3.4 |

What it says
- The game's pick is the cleanest and the calmest under the panel, but the judges found it dim (flat overcast light, the machine close against the panel's edge) where the brief asks for a bright clear afternoon.
- Codex's pictures were preferred on the brief and the look, and each had a named fault: run B's glass reads as a see-through window onto mountains (serious); run A has a window view behind the panel; with the style pictures there were weeds in every paving joint and two fused cans on the top shelf.
- The style pictures matched the game's colour (saturation 0.30 against the game's 0.29) but the judges found the result flatter, and Antigravity's refined draft too dark and busy.
- Antigravity's first two drafts of a run were its worst (a forest on the left, a "¥150" price on the display); its last draft was its best.
- The judges disagree with each other, and the owner's taste may differ from all of them. Report the scores with their reasons and let the owner choose.

**A tuned try.** One more Codex run with the style pictures and a paragraph that names the faults to avoid, placed before "No people, no animals, no text, no logos.": `THE FIXES, from a review of earlier tries: the machine's glass front shows only the cans and bottles on a softly lit white back panel; no sky, trees, mountains or any landscape is visible through the glass or reflected in it. The paving slabs are clean, with no grass or weeds in the joints. Every can stands clear of its neighbours; none overlaps another. The timber wall is plain boards from the eaves down to the paving, with no window and no opening in it.` Both pictures did exactly that, with a clean machine and wall, but looked more like a render than a painting (saturation 0.33 to 0.36, heavy wood grain, busier under the panel than the game's pick). They were not judged.

**Judging tips from this job**
- Give the judges the real panel geometry from the game's code. The first round used the batch note's older numbers and marked down pictures that were fine.
- Give a defect hunter an effort limit: one ran for 40 minutes without finishing its first picture. A lean one with a limit of about 25 tool calls finished in 6 minutes.
- Judge every candidate in one round so the scores can be compared.

## 2. An expression change on an existing sprite

The job: Nanami's smile, from `game/images/char/nanami_neutral.png` (RGBA, 760x1400, transparent). A copy was filed into the inbox first and sent as the one reference.

**The prompt, unchanged, to all three routes**: `The same character as the attached reference picture: same face, hair, glasses, suit, tie, the object in his hand, and the same art style. One change only: a warm, relaxed smile. One character, standing, whole body from head to feet inside the frame with space around him. Flat pure magenta (#FF00FF) background, no gradient, no shadow on the ground, nothing else in the picture. Tall portrait, 9:16. No text, no logo, no watermark.`

**What came back**
- Codex: 48 s, 941x1672 PNG, backdrop (252, 4, 250), almost exactly #FF00FF. The cleanest cut-out with `--edge new`. It redraws colours more (brighter green lenses, orange shoes, a warmer suit, a broader smile).
- Antigravity: 117 s, 768x1376 JPEG, backdrop (253, 16, 252). Closest to the sprite. The game's new edge leaves a pink fringe on it.
- Gemini app (needs Computer use and the owner at the Mac, see `gemini-computer-use.md`): 768x1376 PNG, backdrop (253, 27, 250), almost the same picture as Antigravity's. The same pink fringe.
- The old edge looks cleaner on the two Google pictures; the new edge looks cleaner on Codex's. A JPEG must be turned into a PNG before the game's cut-out tools read it.
- The game's expression sprites are one body with different heads (`nanami_happy` and `nanami_neutral` differ only in the head), so a whole-body picture from any generator is a redraw, not a drop-in expression.

## 3. Looking at a result

- Open every picture with the Read tool. For a machine, a sign or a shelf, enlarge the part that should hold no text and look for letters, numbers and price tags.
- Measure against the game's own pictures where you can: saturation and brightness (HSV mean) against the daytime backgrounds, and how busy the part behind a menu is (mean edge strength).
- When two or more pictures compete, give them neutral names and the same size and let independent judges score them without knowing the source: one for the brief's own checks, one for defects, one for fit with the game's look.
- Ask before installing. Installing is the owner's go: `tools/install_bg.py` for a background, `tools/keysprite.py --edge new` for a sprite.
