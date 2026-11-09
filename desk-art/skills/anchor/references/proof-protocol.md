# The live proof for anchor sets

Status: NOT RUN (9 Nov 2026)

## Purpose

This is the test that decides whether a saved anchor set is better than the plain way of working (one reference picture in `refs`, one change per run). Nothing in it has been run yet, and none of it runs by itself: it starts only when the owner says go, and every picture in it needs its own yes. Until a row of the Results table says PASS for a kind of set, the README and the skill say UNVERIFIED for that kind.

## The protocol

Why: nothing yet shows that a set beats the manual practice it replaces. The same prompt given to Codex twice scored 6.2 and 7.4 (blind scores from 0 to 10, the mean of two AI judges; see the desk-art skill's `references/model-comparison.md`), so one run proves nothing. Rules: one picture at a time, each with the owner's yes, said in plain words ("This is one ChatGPT picture. Go?"); stop at 98 percent of any usage window; never paid extra usage; numbers flag and never accept a picture.

P0 (free, no picture): re-measure the Nanami smile pictures of 6 Nov with `measure` against a set made from the game's sprite flattened on magenta (the set of P1 below). They are in the inbox; their labels in `manifest.jsonl` are `nanami-smile-codex` (plain), `nanami-smile-codex-lock-a` and `nanami-smile-codex-lock-b` (with the colour sentence), `nanami-smile-agy` and `nanami-smile-gemini`; the sprite's copy is `nanami-neutral-ref`. Write the numbers in the Results table first, so the ruler is known before the new pictures exist.

P1 (Codex, three pictures): the set `nanami-sprite-v1` = the game's `game/images/char/nanami_neutral.png` (760x1400) flattened on `#FF00FF`, one `identity` picture, keep `round lenses dark olive green; suit muted beige; tie mustard yellow; shoes dark brown`. Arm C (control, same day, 1 picture): `refs` = the original transparent sprite, no `anchor`, the prompt of 6 Nov with the colour sentence added. Arm A (2 pictures): the same prompt with the colour sentence, `anchor: "nanami-sprite-v1"`, no `refs`. Judge: `measure` with `--key "#FF00FF"` (colour: median, p90, worst cells; backdrop; add `--skip-top` only for a big head change, never for this smile because the lenses are in the head), and look. Provisional PASS: both A pictures have a colour p90 at least 2.0 below the control's, their worst cells are not the feet or the head, the largest backdrop corner distance is at most 30, and the smile looks right and the character the same. If only one A picture is better, or the difference is under 2.0, make a third A picture before judging. If A is not better: stop, report the numbers and keep figure sets optional; then run one more pair to learn which half mattered: arm F = the flattened sprite as a plain `refs` picture with no `anchor`.

P2 (Codex, two pictures; only if the owner wants anchors for backgrounds): the set `bg-style-v1` = `game/images/bg/courtyard.png` and `classroom.png` as two `style` pictures; the vending-machine brief of 6 Nov (item 3 of "New rooms and interactions"; the prompt is in `recipes.md` and the PNG text chunk of the approved picture) with no hand-written STYLE paragraph. Baselines: words only, saturation 0.367 and 0.378; with the hand-written style paragraph, 0.295; the game's day rooms average 0.294 give or take 0.049 (brightness 0.54 give or take 0.08). Provisional PASS: both pictures have saturation from 0.245 to 0.345 and brightness from 0.46 to 0.62, look like paintings, and add nothing the brief did not ask for.

P3 (only if the owner wants places and hours): one close-up and its evening version made from sets, compared with the hand-run pictures of 6 Nov by `measure` (`lineup`). This tests repeatability, not gain; those two already worked by hand. If a P3 picture mixes up which picture is which, the likeliest cause is that Codex gets no file names, only the order of its attached pictures (see "The prompt after the anchor" in `classes.md`): try ONE plain sentence in the prompt saying what each numbered picture shows, and record that as its own arm.

Optional arm (only if a style or identity set copies the wrong subject): call the identity picture the "edit target" in a one-off prompt (the wording of Codex's own sample image skill) and compare. Repeat the protocol after any ChatGPT app update, because Codex's image model is unsettled.

Record: add a row to the Results table for every picture (date, arm, label, the numbers, what you saw, verdict). Until a row says PASS for a kind of set, the README and the skill say UNVERIFIED for that kind. A FAIL is reported to the owner and that kind stays optional.

## Notes for running it

- Make every set with the steps in SKILL.md (preview, zoom, keep line, build, sheet, the owner's yes). Building a set also needs the owner's yes.
- `recipes.md` is `skills/desk-art/references/recipes.md`.
- The set for P0 and P1, as a `build` description (its keep line is the protocol's own; still run the preview first and look at it):

```json
{"name": "nanami-sprite-v1",
 "keep": "round lenses dark olive green; suit muted beige; tie mustard yellow; shoes dark brown",
 "pictures": [
   {"role": "identity", "source": "~/Desktop/JJKgame.md/game/images/char/nanami_neutral.png", "key": "#FF00FF"}
 ]}
```

- P0 measures a picture that is already in the inbox. Find its path in `manifest.jsonl` by its label, then run (`S`, `PY`, `INBOX` and `<ROOT FLAGS>` are set up as in SKILL.md):

```bash
"$PY" -I -B "$S/anchor_look.py" measure --inbox "$INBOX" <ROOT FLAGS> nanami-sprite-v1 "<path of the picture>" --key "#FF00FF"
```

- In P1, `median`, `p90` and the worst cells come from the colour check of `measure`: how far the figure's colours are from the anchor's, cell by cell. `p90` leaves out the worst tenth of the cells. Smaller is closer.
- Write what `measure` printed into the Results table as it is. It prints numbers only, and these first rows set the ruler.

## Results

| Date | Arm | Label | Numbers | Seen | Verdict |
|---|---|---|---|---|---|
