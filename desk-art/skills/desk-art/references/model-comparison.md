# Which route for what: a blind comparison (6 Nov 2026)

The owner asked: try them all, pick the best for backgrounds, then for characters and faces. This page holds what was tested, the scores, the limits that showed up and the exact prompts, so a later session can repeat or extend it. Read `recipes.md` for prompts that worked on single jobs.

## The short answer

| Job | First choice | Why | Watch for |
|---|---|---|---|
| Backgrounds | Codex, two runs | Highest average (6.98 against the owner's paid route 6.32 and Antigravity 6.20), about 50 s, 1672x941 PNG, rich detail | Often too glossy and vivid for the game's muted look: add two of the game's backgrounds as style pictures. It lost to Antigravity on one of the three briefs |
| Full-body edits of a sprite (expression, outfit) | Codex, with a sentence that names the colours to keep | Average 7.5 against 5.5 for Antigravity; almost exactly #FF00FF backdrop, so it cuts out far cleaner | It redraws the whole body and can drift colours (lenses, tie); check against the sprite |
| Faces (head and shoulders) | Codex and Antigravity, one run each, keep the one that looks more like the sprite | Close to a tie (Codex 6.96, Antigravity 6.4); each won one character | Codex changed eye colour on Ijichi; Antigravity changed the jacket colour on Nanami |
| Antigravity's `model` argument | Leave it out | No model beat the default in a repeatable way; Gemini 4 Argon was the slowest and most washed out | Opus 5.5 was best on one brief and worst on another |

The Gemini Mac app was only tried on one sprite (Nanami's smile, 6.75); it needs Claude's Computer use and the owner at the Mac. ForgeGUI was not tried (it spends credits).

## What was tested

- Backgrounds: three briefs taken from the owner's own approved set (`~/Desktop/JJK Game images/ui2/approved/`): the vending machine close-up, a bakery interior (`ui2_bakery_a`) and a Kawasaki street with a small cinema (`ui2_kawasaki_b`). The exact prompt the paid route used (stored in each picture's PNG text chunk `prompt`) was sent unchanged, so the owner's approved picture (Nano Banana Pro, 2K) was the benchmark. Codex twice, Antigravity once or twice, plus Antigravity with other agent models.
- Characters: three of the game's sprites (Nanami, Gojo, Ijichi) from copies in the inbox: an expression change (Gojo surprised, Nanami smiling), an outfit change (Ijichi in a plain grey cardigan) and a head-and-shoulders portrait (Nanami, Ijichi). One prompt per task, the same for every route.
- Judging: independent AI judges who saw the pictures under neutral names, in a fixed size, blind to the source, with strict effort limits. For backgrounds, a brief-and-defects checker and an art director who also saw three of the game's own backgrounds. For characters, a likeness-and-instruction judge and a quality-and-readiness judge who saw the reference. Scores run 0 to 10 and are means of the two judges. The AI judges disagree with each other and with the owner's taste: treat them as a second opinion.

## Backgrounds (mean of the judges)

| Brief | Codex A, B | The owner's paid-route pick | Antigravity default | Other Antigravity agents |
|---|---|---|---|---|
| Vending machine close-up | 7.1, 7.1 | 6.6 | 6.5, 6.6 | |
| Bakery interior | 7.75, 7.4 | 7.1 | 5.55 | Opus 4.85 |
| Kawasaki street | 6.45, 6.0 | 5.25 | 6.5 | Opus 7.05, Sonnet 6.4, Flash 6.2, Argon 5.35 |
| Average of the three | 6.98 | 6.32 | 6.20 | |

The scores in each row come from one round of judging with that row's whole set of candidates, so compare within a row. Speeds: Codex 34 to 60 s a picture. Antigravity 68 to 330 s, sometimes several drafts in one call; Argon timed out once at 540 s.

## Characters and faces (mean of the judges)

| Task | Codex A, B | Antigravity default | Others |
|---|---|---|---|
| Gojo, surprised mouth | 8.45, 8.0 | 5.25 | Flash 5.6; Argon timed out |
| Ijichi, grey cardigan | 8.45, 6.8 | 5.45 (backdrop off-colour) | |
| Nanami, smile | 6.45 plain; 6.2 and 7.4 with a colour sentence | 5.9 | Gemini app 6.75 |
| Nanami, face | 7.7, 7.1 | 5.0 | |
| Ijichi, face | 6.85, 6.2 | 7.8 | |

What the judges and the measurements found:
- Codex's backdrop is almost exactly #FF00FF (for example 252, 3, 250). The Google routes came back paler and noisier (253, 16 to 38, 252), once a dull orchid (227, 56, 215). With the game's new cut-out edge, Codex left 7 to 214 flagged edge pixels (up to 0.05%) and Antigravity 880 to 3,945 (0.3% to 1.4%).
- Pixel closeness to the sprite (lower is closer): Antigravity and the Gemini app re-render almost the same picture (Gojo 2.1 to 2.2, Nanami 3.8 to 4.2); Codex redraws more (7.7, and 14.2 for Nanami, 9.2 to 10.9 with a colour sentence). The judges still preferred Codex's crisp finish on Gojo and Ijichi; for Nanami the colour drift (bright green lenses, yellow tie) cost it points.
- Antigravity's pictures are softer and grainier JPEGs. On Gojo it gave a wide yawning mouth instead of the small round one that was asked for.
- The same prompt gave very different pictures on two runs (Nanami with a colour sentence: 6.2 and 7.4). Make at least two.
- Naming the colours to keep ("the round lenses a dark olive green, the suit a muted beige, the shirt dark blue, the tie mustard yellow with dark spots, the shoes dark brown") helped Codex but did not fix it.

## Limits seen

- Antigravity ran out of image quota (HTTP 429 RESOURCE_EXHAUSTED) after about 16 pictures in two hours with three runs at once; it worked again about 15 minutes later. Run Antigravity one or two jobs at a time.
- Tool calls from Claude run one after another. To run several generators at once, start the helper directly in the background (`bin/desk_art.py codex|agy --label L --prompt-stdin --ref ...`, one process each, up to four Codex and three Antigravity at a time worked).
- Starting a separate Claude session (needed for the Gemini app) is not possible from a remote message: it needs a message typed in the desktop app.

## Not tested

- The Gemini app on backgrounds and on faces. To do it: start a session from the desktop app, with you at the Mac, and run the prompts below in the Gemini app one new chat each (16:9 for backgrounds, 9:16 for the tall pictures, Square for faces), with the references from the inbox (`ref-gojo`, `ref-ijichi`, `nanami-neutral-ref`), copy each out with right-click, Copy Image, and file it with `clip_image`.
- ForgeGUI (credits), Codex's own model settings, more characters, a second sample per cell.

## The prompts

Character tasks (full-body tasks end "Tall portrait, 9:16"; faces end "Square picture, 1:1"):

- Gojo: `The same character as the attached reference picture: same face, white spiky hair, the black blindfold, the high-collared dark navy uniform, his hands in his pockets, and the same art style. One change only: a surprised expression, his mouth open in a small round shape. One character, standing, whole body from head to feet inside the frame with space around him. Flat pure magenta (#FF00FF) background, no gradient, no shadow on the ground, nothing else in the picture. Tall portrait, 9:16. No text, no logo, no watermark.`
- Ijichi outfit: `The same character as the attached reference picture: same face, black hair, thin black-rimmed glasses, the wristwatch, and the same pose with one hand on the other wrist, and the same art style. One change only: his clothes. Instead of the black suit, white shirt and black tie he wears a plain grey cardigan over a white shirt, dark trousers and the same black shoes. One character, standing, whole body from head to feet inside the frame with space around him. Flat pure magenta (#FF00FF) background, no gradient, no shadow on the ground, nothing else in the picture. Tall portrait, 9:16. No text, no logo, no watermark.`
- Nanami face: `A close-up portrait of the same character as the attached reference picture: head and shoulders only, the face filling most of the picture, looking at the viewer with a neutral expression. Same face, short blond hair, round glasses with green lenses, and the same art style, wearing the same beige suit, blue shirt and spotted tie. Flat pure magenta (#FF00FF) background, no gradient, nothing else in the picture. Square picture, 1:1. No text, no logo, no watermark.`
- Ijichi face: the same, with `Same face, black hair, thin black-rimmed glasses` and `wearing the same black suit, white shirt and black tie`.
- Nanami smile: in `recipes.md`; the colour sentence is inserted before "One change only": `Keep every colour exactly as in the reference picture: the round lenses a dark olive green, the suit a muted beige, the shirt dark blue, the tie mustard yellow with dark spots, the shoes dark brown.`

Backgrounds: the vending machine prompt is in `recipes.md`. The bakery and street prompts are the stored prompts of `ui2_bakery_a_00002_.png` and `ui2_kawasaki_b_00001_.png` in the approved folder (1,565 and 1,525 characters, each ending "Output a 16:9 picture."); read them with Pillow from the PNG text chunk `prompt`: the `GeminiImage2Node` whose `SaveImage` has the picture's `filename_prefix`.
