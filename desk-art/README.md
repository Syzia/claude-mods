# desk-art

Version 0.2.0

desk-art is a Claude Code mod. It lets Claude make character art with image programs that are already on your Mac and already signed in. You do not need an API key: each program uses your own sign-in. It does not use web-browser generators such as Grok in a browser.

Every picture it makes is copied into one folder (the inbox), with a note about how it was made.

You do not run desk-art yourself. You ask Claude, in plain words. For example:

- "Use desk-art to make a smiling version of this sprite." (Give the picture's path. It must be in one of the folders listed under "Reference pictures" below.)
- "Make a night-time shrine background with desk-art."
- "Make an icon for a talisman item."
- "Keep Nanami looking like his Arc 1 Final art with desk-art." (Claude offers a saved reference set and waits for your yes; see "Anchor sets" below. It is optional: a one-off edit with a reference picture needs no set.)
- "Is desk-art ready?"

Claude writes the prompt, runs the generator, looks at every picture, and asks you which ones to keep. Then, with your yes, it hands the ones you keep to the game's own tools for cutting out and cleaning. For a new sprite that is `tools/keysprite.py --edge new` (see `docs/ASSET_PIPELINE.md` in the game folder, section "The cut-out's edge: new sprites only"). It puts the finished sprite into `game/images/char`, so Claude asks you before it runs it. `tools/arc1_cut.py` is only for the Arc 1 Final art.

Every picture uses your own ChatGPT or Google plan allowance, which is limited and which desk-art cannot see. So ask for one picture at a time.

## Where the pictures go

The default inbox is:

```
~/Desktop/JJK Game images/desk_art_inbox
```

You can open it in Finder like any other folder. It is outside the game folder on purpose, so these pictures do not get added to the game's git history by accident.

Inside it:

- One folder per day, named like `2026-11-04`.
- Pictures named `label_route_number_fingerprint.png`. For example: `gojo-smile-v1_codex_01_3fa9c2d1.png`.
- One notes file, `manifest.jsonl`. It has one line per picture: the time, the route, your label, the prompt (the first 4000 characters), the names of any reference pictures, the size, and a fingerprint (sha256). The line for a picture made with an anchor set also records the set's name and the job of each of its pictures.
- A folder called `anchors`, made the first time an anchor set is saved (see "Anchor sets" below). It holds one folder per set: the set's saved pictures and its file `anchor.json`. These are copies kept for reuse, not new pictures, so `/desk-art` does not count them as pictures filed.

Nothing is overwritten. If the same picture arrives twice, it is filed once. One call files at most 16 pictures and 200 MB; if more come out, the result says how many were left unfiled. desk-art never moves or deletes an original. Codex keeps its own copy in its own folder.

To use a different folder, change the mod's setting called "Art inbox folder". It is one of the mod's settings in Claude's config menu. The folder must be inside your home folder, not inside a hidden folder at the top of it (such as `~/.config`), and not inside `~/Library`.

## The three routes

| Route | State | What it needs |
|---|---|---|
| Codex, inside the ChatGPT app | VERIFIED on this Mac, 4 Nov 2026. Codex ran without a window, signed in with ChatGPT, and made a picture file. Its safety switches (see "How it keeps your things safe") were checked with a real run too. | The ChatGPT app, signed in. |
| Antigravity command (`agy`) | VERIFIED on this Mac, 5 Nov 2026 (agy 1.5.0). It made flat test pictures, also from a reference picture, in roughly 40 to 100 seconds. Not tested: real character sprites, what it does when it refuses, and its limits. | Nothing here: it is installed, and it ran with no separate sign-in. |
| Gemini Mac app | TESTED on this Mac, 5 Nov 2026 (Gemini app 1.138.0.1315): it works, but only with full-screen Computer use and you at the Mac. The app has no scripting door, so it needs screen control. Claude opened the app, started a new chat, chose "Create images" and got the test picture (one white triangle on flat magenta, 1024×1024) in about 12 seconds. It got the picture out two ways: copying it (right-click the picture and choose Copy Image, or press the copy icon that shows when the mouse is over it), which gives a lossless PNG and is the better way, and the download icon, which gives a JPEG. Those buttons need a real mouse, so the background tools alone cannot press them. A reference picture works too: Claude attached one through the "+" menu and the file picker, and the new picture was an exact edit of it. Tall 9:16 pictures work too (768×1376). The game's cut-out tool cut Gemini's flat green and magenta test pictures cleanly (checked without installing anything). A real sprite (Nanami, with a copy of the game's own sprite as the reference, one change: a smile, 9:16, on magenta) worked too: Gemini kept the character, outfit, pose and size and gave a warm closed-mouth smile on a flat magenta backdrop with no mark. The owner copied it out by hand once, because my own clicks had stopped working. The game's cut-out tool run on it (nothing installed) left a faint lilac-pink rim with its new edge, and the old edge looked cleaner on that figure. | Computer use turned on in the Claude app, the Gemini app signed in, you at the Mac while Claude has full-screen control, and no other app's window (such as ChatGPT) on top of Gemini. |

Use Codex first: it has the most runs behind it. Antigravity works too, with fewer runs so far. The Gemini app comes last: it works, but only with full-screen Computer use and you at the Mac.

The pictures use your own sign-in, so they count against that plan's allowance. Nobody knows the size of those limits yet.

## One-time steps

### Codex (ready now)

1. Open the ChatGPT app and make sure you are signed in.
2. In Claude, type `/desk-art`. Look for the Codex line. It should say READY. Look for `Codex hardening: OK` as well.
3. Ask Claude for a picture. A picture can take a while (the limit is 8 minutes). While it works, a short status line shows `desk-art: codex_image running`. When pictures are filed, a small notice says how many, for example `desk-art: 1 picture filed`.

### Antigravity (ready now on this Mac)

It was installed on 5 Nov 2026 (the program only) and works. Type `/desk-art`: the `agy` line should say FOUND. Then ask Claude for a picture with Antigravity.

On another Mac:

1. Read `skills/desk-art/references/antigravity.md`. It has every step.
2. Install `agy`. The installer's last step runs `agy install`, which may change your shell settings (the settings Terminal loads when it starts). Google does not say exactly what it changes. So you decide: run the installer yourself, or tell Claude an explicit yes first. The reference file says what the installer does.
3. Sign in with your personal Google account.
4. Ask Claude to run the first-run test. If the command cannot make pictures, Claude will say so and stop.

### Gemini app (needs screen control)

1. You need macOS 14 or later and a Claude Pro, Max or Ultra plan. Team and Enterprise plans do not have Computer use. It is a research preview. The Gemini app itself needs macOS 15 or later, and it must be signed in with your Google account.
2. Update the Claude app, then quit it and open it again.
3. Open Settings in the Claude app, then "This computer", then "System". (If there is no "This computer", look under "Capabilities".) Under "Computer use", turn on "Enable computer use".
4. macOS then needs Accessibility and Screen Recording allowed for the Claude app. Accessibility lets the Claude app click and type for you. Screen Recording lets it see your screen. The Settings page shows each one and opens System Settings when one is denied. Turn the Claude app on there, for each one. You can turn both off again later in System Settings, under Privacy & Security.
5. Close or hide anything private on your screen. Computer use works from screenshots of the screen, which go to Claude.
6. Start a new Claude session. This is needed: on 5 Nov 2026 a session that was already open when Computer use was turned on had no Computer use tools, and a new session had them.
7. Ask Claude for a Gemini picture. When it asks to use the Gemini app, choose "Allow for this session" for that app only.
8. The full playbook is in `skills/desk-art/references/gemini-computer-use.md`. The first practice run was done on 5 Nov 2026 and worked: the playbook's "UI notes" say exactly how. To get the picture out, Claude needs full-screen control for a minute or two, so be at the Mac. It takes over the mouse and keyboard, and it hides your other apps' windows for a while (they come back from the Dock). Close anything that floats over other windows first, such as a ChatGPT chat bar: while one is on top of Gemini, Claude is not allowed to click.

## Reference pictures

When you ask for a change to an existing sprite, Claude gives the generator that sprite as a reference picture. Every reference picture is uploaded: to OpenAI for Codex, to Google for `agy` and the Gemini app.

So desk-art only sends pictures from folders that are allowed. By default these are:

- `~/Desktop/JJKgame.md` (the game folder)
- `~/Desktop/JJK Game images`
- `~/Desktop/Character reworks`
- `~/Desktop/JJK_worktrees`
- the inbox, and the cache folder `~/Library/Caches/desk-art`. These two are always allowed.

To change the four game folders, change the mod's setting called "Folders pictures may be sent from". (It sits next to "Art inbox folder" in the mod's settings.) Put a vertical bar (|) between folders. Start each folder with `/` or `~/`, and use at most 20 folders. Leave it empty to use the four game folders above. If any folder is written wrongly, desk-art ignores the whole setting and uses the four game folders. A folder inside a hidden folder or `~/Library` does not help: those places are always refused.

If Claude tries to send a picture from anywhere else, desk-art refuses it and says:

```
<what> <path> is not in a folder desk-art may send from. Allowed: <the folders>. Copy the picture into one of those folders, or change the mod's "Folders pictures may be sent from" setting.
```

To use a one-off picture, with your say:

1. Put the picture in your Downloads folder.
2. Tell Claude it may use it.
3. Claude files a copy into the inbox with its `ingest` tool, and sends the copy in the inbox. (The inbox is always allowed.)

`ingest` can read from the same folders, and also from `~/Downloads` and the folders where Codex, the Antigravity app and the Antigravity command keep their own pictures (`~/.codex/generated_images/`, `~/.gemini/antigravity/brain/` and `~/.gemini/antigravity-cli/brain/`).

Every result from a generator run that used references lists the ones that were sent, for example `References sent to OpenAI: sprite.png (3fa9c2d1)`, so you can check.

## Anchor sets: keeping pictures the same

An anchor set is a small saved set of reference pictures (one to three) that Claude sends with every picture of the same thing, to help the pictures stay alike (this is not yet proven: see "What it cannot do" below). Each picture in a set has one job: the character to keep, a look to copy, the exact view to paint, the room that view is cut from, or the light of an hour. Sets are optional: Claude offers one when you ask to keep something looking the same across several pictures, and waits for your yes. A quick one-off edit with a reference picture needs no set. When you say yes, Claude first looks at the prepared pictures and zooms in on the parts that must not change, writes those colours and parts down (the "keep" line), saves the set once, shows it to you, and waits for your yes again. After that it asks the generator for pictures "with the set": the same pictures, in the same order, with the same words, every time. Before it sends anything, the mod checks that no saved picture has changed, and every result lists exactly what was sent.

You do not run anything yourself. Ask in plain words, for example "Keep Nanami looking like his Arc 1 Final art" or "Make the evening version of the vending machine close-up". Claude uses the `desk-art:anchor` skill. After this update, start a new Claude session: tools and skills are given to a session when it starts. (`/reload-plugins` may be enough in an open session, but that has not been tried for a new tool argument; if Claude says `unknown argument "anchor"`, start a new session.)

Where sets live: in a folder called `anchors` inside the art inbox, one folder per set (for example `anchors/nanami-final-v1/`), holding the pictures and a small file, `anchor.json`. A set is never changed: a change is a new version (`-v2`). desk-art never deletes a set. To remove one, delete its folder in Finder.

What it cannot do: the generator still draws the picture. The same words given to Codex twice scored 6.2 on one run and 7.4 on the other on 6 Nov 2026 (blind scores from 0 to 10, the mean of two AI judges; the table is in `skills/desk-art/references/model-comparison.md`). A set keeps the inputs steady; it does not make the picture the same. This feature is UNVERIFIED: the first real test (about three Codex pictures, one at a time, each with your yes) has not been run. Until it has, Claude says "not yet proven" when it offers a set.

### What to know before you trust it

- UNVERIFIED: no real run has yet compared a saved set with doing the same job by hand. A set is meant to reduce drift (a picture wandering away from the original), not to remove it, because the same words scored 6.2 on one run and 7.4 on another; if the test fails, sets stay optional for that kind of picture.
- The first sentence of the fixed words tells the generator to use each picture for its one job only. It is meant to stop a "look to copy" picture from lending its subject to the new picture, but no run has shown that it does (only backgrounds were tried as looks to copy), so a character picture is not supported as a look to copy.
- Stored pictures are plain, with nothing see-through: a see-through picture is first flattened onto a flat background colour, and a colour profile (a note that says how to read the colours) is left out, which is right for your art because your art has none. How Codex, Antigravity and the Gemini app treat see-through parts of a reference picture is not documented.
- A set holds three pictures at most, and one call carries six in all (the set plus any extra pictures). Up to three pictures in a call is the range that has been tried (only 1 of 111 earlier jobs used three); four to six are untested, and Codex documents no maximum.
- Antigravity's default picture model may be a "Lite" one, which Google says is not built for several reference pictures, so use a set of one character picture there. In the Gemini app pick the Pro or Flash model, not Flash-Lite; that route is done by hand and sits outside every automatic check.
- The fingerprint check is for accidents: it stops a changed, swapped or missing picture, but it cannot stop Claude, which can run programs, from saving a new set whose fingerprints match, so sets are only as honest as the session that made them. The inbox's notes file (manifest.jsonl) records which set each picture used and the fingerprint of that set's `anchor.json`; a picture counts as made by a generator only if its exact fingerprint is found in that file, so a generated picture that was re-saved or edited is not recognised as generated.
- The keep line is free text. The set builder checks only that it is plain keyboard text (no accents or symbols) on one line, at most 300 characters, and free of the words the scope rule keeps out; Claude keeps the scope rule and writes no names in it.
- The scope guard is an accident guard, not a lock. The set builder refuses file paths and words that look like the pictures the scope rule keeps out (including backgrounds and icons named for a pool, a bath or a sauna), but it reads names and words, not what a picture shows, so the scope rule stays Claude's job, and there is no "pose" kind of reference.
- The measuring step prints numbers only, and no limits have been set for them yet; the first real runs will set them. Numbers point at what to look at; they never accept a picture.
- The folder setting reaches the skill's programs only through Claude. The set builder and the program that makes pictures to look at cannot read the mod's settings, so Claude hands them your "Folders pictures may be sent from" list, and they can only narrow the game's four standard art folders. A folder you added outside those four is ignored; a picture from anywhere else goes in through the Downloads way, with your yes.
- The set programs run in the terminal, not through the mod's own tools, so Claude Code may ask you to allow them the first few times. The mod's own tools never ask.
- Tools and skills are given to a session when it starts, so a session that began before this update refuses `anchor` (`unknown argument "anchor"`) and does not have the anchor skill. Claude can then offer a new session, or the by-hand way, which sends the same pictures without the automatic check.
- The mod deletes nothing, so sets pile up; you remove one by deleting its folder in Finder. A set keeps its own copy of the original, so after you redraw an original (the Arc 1 Final art was redrawn on 20 and 26 Oct 2026) the set still holds the old picture: when Claude shows a set it says so, and it offers a new version.
- Codex's picture model is not settled: its docs say gpt-image-2, and an OpenAI note of 8 Sep 2026 says Images 2.5 is rolling out to Codex. Repeat the test after a ChatGPT app update.
- A whole-body redraw is not a drop-in expression, because the game's expression sprites are one body with a different head. Making only a new head and joining it to the body with the game's own tool (`tools/arc1_final.py compose`) is untried for faces made by a generator.

## The /desk-art command

| Type | What you get |
|---|---|
| `/desk-art` or `/desk-art status` | A short report. Is each route ready? Is Codex's safety setting `Codex hardening: OK`? Where is the inbox, and how many pictures are in it? Which folders may pictures be sent from? |
| `/desk-art setup` | The numbered one-time steps for each route. |
| `/desk-art help` | The list of tools and the usual loop. |

Any other word gets a short reminder of these three.

## What it will not do

- It makes the game's plain art: clothed character sprites, expressions, outfits, backgrounds, items, icons and UI. It is not used for sexualised art of anyone. It is never used for swimwear, bikini, underwear, towel, bath, onsen, sauna, pool or beach pictures, lingerie-style pyjamas or "Ask for a pose" pictures of Nobara, Maki, Mai, Miwa or Momo (school students in the story, 16 and 17 in the source), and never for the pose-ladder sets of any character. When unsure, Claude asks you first. If a job drifts there, Claude stops and says so once. It does not suggest a way around it. The tools cannot check this. Claude checks it, because Claude writes every prompt.
- An anchor set never holds a swimwear, bikini, underwear, towel, bath, onsen, sauna, pool or beach picture, a lingerie-style pyjama picture or an "Ask for a pose" picture of Nobara, Maki, Mai, Miwa or Momo, and there is no "pose" kind of reference. The set builder refuses file names and folders that look like those. It is an accident guard, not a lock: Claude still keeps the scope rule.
- It does not control your screen by itself. It has no mouse or keyboard code. For the Gemini app, Claude uses the Computer use feature built into the Claude app, if you turn it on. That has its own permission screens.
- It does not supply an API key. It never asks for one and never stores one. Each program uses your own sign-in, and key-like settings are removed from the programs desk-art starts (see "How it keeps your things safe").
- It does not use private app doors. It does not read Codex's or Antigravity's sign-in files, tokens or settings. Antigravity has a private helper called `agentapi`. It is locked, and desk-art does not use it.
- It does not use web-browser generators.
- It does not clean pictures or cut out backgrounds. The game's own tools do that after filing, and Claude asks you before it puts anything into the game folder.
- It does not install anything. Installing `agy` is your decision: you run the installer yourself, or you tell Claude an explicit yes first.

## How it keeps your things safe

- It writes only to the inbox and to a cache folder, `~/Library/Caches/desk-art`.
- It never changes or deletes a file it reads from, including your reference pictures.
- It copies only real pictures (PNG, JPEG or WEBP). A file it is given is opened first only to check its first bytes for a real picture, and a file named like a secrets or sign-in file (such as `.env` or `auth.json`) is refused before it is opened. It refuses files inside hidden folders at the top of your home folder and inside `~/Library`. The only exceptions are its own cache folder, and the picture folders that Codex and Antigravity keep for their own results (those two only when Claude files a picture with `ingest`).
- It sends a reference picture only from the allowed folders (see "Reference pictures"). It copies each reference into the run's private work folder, checks the copy again, and gives the generator that copy. These copies are deleted after every run.
- Anchor sets are stored inside the inbox (`anchors/`), which is always an allowed folder. Each stored picture is a copy of one named file from a folder pictures may be sent from, or from the inbox or the cache (the set builder honours your "Folders pictures may be sent from" setting but can only narrow it to the game's four standard art folders; a picture from anywhere else goes in through the Downloads way first), saved as a plain PNG with no hidden data such as notes or a colour profile. Before every send the mod copies the set's pictures into the run's private work folder like any other reference and refuses the run if a copy no longer matches the fingerprint saved with the set.
- The helper program only reads sets. The only program that writes a set is the skill's set builder, which Claude runs in the terminal, not through the mod's own tools: it writes only inside `anchors/<name>/`, never writes through a link, never overwrites or deletes anything, writes `anchor.json` last, and refuses a folder that is not the art inbox. (It does read the picture files you name, inside the allowed folders, like the tools do.) Its pictures for you to look at (previews, contact sheets, zooms, a result beside the set) go to `~/Library/Caches/desk-art/anchor-looks/`, each under a new name. Because that part runs in the terminal and not through the mod's own tools, Claude Code may ask you to allow it the first few times.
- Codex is held back in this order:
  1. Codex runs in read-only mode. Read-only means it cannot change files and cannot use the network. It can still read files and run read-only commands through its built-in code tool (picture making needs that tool).
  2. desk-art switches off Codex's browser, computer-use, web, app, plugin, sub-agent, goals and image-viewer tools, and its terminal tool. Checked on 4 Nov 2026: a test of the web failed, a test of writing a file failed, and reading a file still worked.
  3. So prompts must only describe pictures. Claude never asks Codex to look at a file.
  4. desk-art puts a short instruction in front of every prompt. It tells Codex to use only the picture tool and to leave files alone. That text is a request, not a lock.

  Codex starts in a work folder of its own (empty, apart from the copies of your reference pictures), but that is only where it starts. It is not a wall: Codex can still read files elsewhere on your Mac.
- Codex refuses a switch name it does not know. If an update to the ChatGPT app renames one of those switches, a run fails with `Unknown feature flag`. That is on purpose: it stops instead of running without the limit. If you see it, tell Claude. desk-art needs an update. `/desk-art` shows `Codex hardening: NOT OK` when it notices first.
- It never uses Codex's switches that skip the safety checks (no `--dangerously-bypass-approvals-and-sandbox`, no `--approve-for-me`, no full-access mode).
- It removes key and secret-like settings (names such as `OPENAI_API_KEY`, `GITHUB_TOKEN` or `SSH_AUTH_SOCK`) from the environment of the generator programs it starts (Codex and `agy`), so the desktop sign-in is the one used.
- It makes no network calls of its own. The generator programs make theirs.
- It reads the clipboard only when Claude asks for the clipboard picture (`clip_image`). It never writes to the clipboard. (In the Gemini app route, the app's own copy button puts the picture on your clipboard, replacing what was there.)
- Claude Code does not ask you before a desk-art tool runs, because the mod answers the call itself. This was seen live on 4 Nov 2026: the status check and a picture run went through with no question. So the limits above, and Claude's own check of the scope rule, are what protect you. Claude's instructions say to ask you which pictures to keep before anything goes to the game.

## What leaves your Mac

desk-art itself sends nothing anywhere. The generator programs do. Codex sends your prompt and every reference picture to OpenAI. `agy` and the Gemini app send them to Google. With Computer use, screenshots of your screen go to Claude. Only pictures from the allowed folders (see "Reference pictures") can be sent as references. Do not put a picture in those folders that you would not want those companies to see. Every picture in an anchor set is uploaded each time the set is used.

## Where it lives

It is installed for every Claude session, the same way as Agent Office. The folder is `~/claude-mods/desk-art`, and the list that holds it is called `hunter-mods` (the file `~/claude-mods/.claude-plugin/marketplace.json`). To change the mod, edit that folder, then type `/reload-plugins` in Claude (or start a new session). Its two settings ("Art inbox folder" and "Folders pictures may be sent from") are optional: until you set them, the defaults described in this file are used. To change them, type `/plugin configure desk-art@hunter-mods` in Claude.

## Remove it

1. Close any Claude sessions that are using it.
2. In Terminal, type `claude plugin uninstall desk-art@hunter-mods` and press Return.
3. Delete the `desk-art` mod folder (the folder that holds this README), and the `desk-art` entry in `~/claude-mods/.claude-plugin/marketplace.json`.
4. Start a new Claude session.

Installing the mod added one line to your Claude plugin list. The mod itself does not install a background program or store a login. Three things are left behind on purpose. Your pictures stay in the inbox until you delete them, and so do your saved anchor sets (the `anchors` folder inside the inbox). A cache folder, `~/Library/Caches/desk-art`, may hold work folders from failed runs, and you can delete it any time. It also holds the pictures made for you to look at (`anchor-looks`). Copies of reference pictures in it are deleted after every run, but other job files stay. Codex keeps its own copy of every picture it made in `~/.codex/generated_images/`, and desk-art never deletes from it.

## Troubleshooting

| What you see | What to do |
|---|---|
| Claude says it has no desk-art tools, or `/desk-art` is not a command. | The mod is not loaded. Start a new Claude session. If it is still missing, type `claude plugin list` in Terminal: `desk-art@hunter-mods` should say enabled. If it says disabled, type `claude plugin enable desk-art@hunter-mods`. |
| macOS asks if the Claude app can use your Desktop or Downloads folder, or a `bad-input` message says desk-art cannot create or read a folder. | The default inbox is on your Desktop, and Downloads is where Gemini pictures are looked for. Allow it, or pick another folder in the "Art inbox folder" setting. When the inbox was first made on the Desktop on 4 Nov 2026, macOS did not ask, but another Mac setup might. |
| `codex-not-logged-in` | Open the ChatGPT app (Codex), sign in, then type `/desk-art`. |
| `codex-not-found` | The ChatGPT app is not where the mod looks. Install or update it, open it once, then type `/desk-art`. |
| `Unknown feature flag` in a `codex-failed` message, or `Codex hardening: NOT OK` in `/desk-art`. | An update to the ChatGPT app changed one of the Codex switches that desk-art needs. Tell Claude. desk-art needs an update. Do not ask Claude to work around it. |
| `codex-no-images` or `agy-no-images` | The generator answered with words instead of a picture. Claude shows you the words. Read them. If they say "quota" or "429", Google's image allowance is used up for now: wait about 15 minutes and try again, one job at a time. Claude will not work around a refusal. |
| `codex-failed` or `agy-failed` | Claude shows you the error words. A limit message means wait and try later. For Codex, a finished picture may already exist: the message lists `Thread folder` and `Pictures already made`. Claude looks there before it runs again. |
| `codex-timeout` or `agy-timeout` | The run took longer than the time limit (8 minutes by default). For Codex, pictures made before the stop are listed under `Pictures already made`, and Claude can file them with `ingest`. Otherwise try a simpler prompt. |
| `bad-input` with "is not in a folder desk-art may send from" | The picture is outside the allowed folders. See "Reference pictures": copy it into one of them, use the Downloads way, or change the "Folders pictures may be sent from" setting. |
| `bad-input` with "unknown argument" | Claude used a name that the tool does not have. The message lists the names it takes. Ask Claude to try again. |
| `bad-input` with "anchor set ... was not found" | The name does not match a saved set. Ask Claude to list the saved sets. Nothing was sent. |
| `bad-input` with "is not the picture that was saved" | A picture in a set changed after it was saved (nothing is allowed to change them). Nothing was sent. Ask Claude to save a new version of the set. |
| `bad-input` with "is missing or is not a plain picture file" | A picture of a set is gone, or is no longer a picture (it was emptied or replaced). Nothing was sent. Ask Claude to save a new version of the set. |
| `bad-input` with `unknown argument "anchor"` | This Claude session started before desk-art 0.2.0. Start a new session, or ask Claude for the by-hand way (it sends the same pictures without the automatic check). |
| `inbox-unsafe` | The inbox folder is not allowed. Pick a folder inside your home folder, not inside a hidden folder at the top of it, and not in `~/Library`. If the message says the anchors folder, an anchor set or its `anchor.json` "is a link", something in the inbox is a shortcut that points somewhere else instead of a real folder or file. The inbox itself is fine: delete or rename that link in Finder, then ask again. Nothing was sent. |
| `agy-not-installed` | Follow `skills/desk-art/references/antigravity.md`. |
| `/desk-art` says Codex is logged in with an API key. | Tell Claude. This mod is built for the ChatGPT sign-in, and an API key would bill that key. |
| `no-image-on-clipboard`, `osascript-failed` or `not-an-image` (Gemini app route) | The copy did not work, or the clipboard picture is not usable. Copy it again, or ask Claude to save the picture to a file instead. (In the Gemini app, the "Copy response" button under a picture copies the words only, so it always gives `no-image-on-clipboard`. The right way is to right-click the picture itself and choose Copy Image, or to press its copy icon when that shows: tested 5 Nov 2026.) |
| The result says "Matched by comparing folders". | The helper could not tie the picture to that run's own folder. Look at the picture and check that it is the one you asked for. |
| The picture is the wrong shape. | The generator may not follow the shape exactly. Ask again and say the shape in the prompt. |
| You cannot find a picture. | Type `/desk-art` to see the inbox path. Look in the folder for today's date. Search `manifest.jsonl` for your label. |
| A message that says `helper failed` | Paste the whole message to Claude. It is a problem with the helper program, not with your pictures. If it says the answer was cut, look in the inbox: the pictures may still be filed. |

## Changes in 0.2.0

- New: anchor sets and a second skill, `desk-art:anchor`. A set is one to three saved reference pictures with one job each (the character to keep, a look to copy, the exact view, its room, the light of an hour). `codex_image` and `agy_image` take an optional `anchor` (the set's name): the mod sends the set's pictures first, in order, with the same words every time, refuses to start if a saved picture changed, and writes the set into the notes file (manifest.jsonl) and into the result. The skill is offered only when you ask to keep something the same, previews and zooms before it saves a set (so the "keep" line is written after looking), builds sets from your own art, shows them to you, checks results against them and has a fixed answer for drift. It is UNVERIFIED until the test in `skills/anchor/references/proof-protocol.md` has been run.
- Nothing changes for a call without `anchor`: the same words, the same pictures, the same notes.
- `/desk-art` no longer counts the saved sets' pictures as pictures filed, and `/desk-art help` mentions anchors.
- The helper program's own version number said 0.1.1 although the mod was 0.1.6; it now matches the mod, and a test keeps them equal.
- Start a new Claude session to get the new argument and the new skill (`/reload-plugins` may do for an open one, but that is untried for a new tool argument).

## Changes in 0.1.6

- A new page, `skills/desk-art/references/model-comparison.md`: a blind comparison of the routes on three backgrounds from your own approved set and on three sprites (an expression change, an outfit change and face close-ups), with the scores, the limits that showed up and the exact prompts. The short answer: Codex first for backgrounds and for full-body edits of a sprite; for faces, one Codex run and one Antigravity run and keep the closer one; leave Antigravity's `model` out. `SKILL.md` carries that as a routing list.
- New notes on Antigravity's limits: it can run out of image quota (HTTP 429; wait about 15 minutes), a big agent model can take over 5 minutes, and a run can time out. The troubleshooting table says so.

## Changes in 0.1.5

- A new page, `skills/desk-art/references/recipes.md`: the prompts that worked on two real jobs (a new background from the game's own brief, with and without style pictures, and an expression change on a sprite), what came back from each route, how the results were judged blind, and the tips that job taught. Claude reads it before a background or an expression change.
- The route table in `SKILL.md` now says Codex and Antigravity made a real sprite and a real background on 6 Nov 2026.

## Changes in 0.1.4

- Antigravity's own log of the pictures it was shown is no longer filed as a result. When it is given reference pictures it keeps a re-encoded copy of each one in a hidden `.system_generated` folder inside its conversation folder, and the old check, which only compared exact bytes, let those copies through. Found on 6 Nov 2026, when two copies of the game's Courtyard and Classroom pictures were filed beside the real results.

## Changes in 0.1.3

- The Gemini app route was tested on 5 and 6 Nov 2026 (with Claude's screen control and the owner at the Mac): it makes pictures, takes a reference picture, makes the tall 9:16 shape, and the picture comes out with right-click, "Copy Image", then `clip_image`. The `/desk-art setup` text no longer says "NOT tested", now says a new Claude session is needed (screen control is only given to a session when it starts), and describes the right-click copy and what to do if Claude's clicks do nothing.
- The `clip_image` tool description now names the right-click "Copy Image" way.

## Changes in 0.1.2

- Antigravity was installed on this Mac (the program only) and tested: it made pictures, also from a reference picture.
- The helper now looks for Antigravity's pictures in the command's own folder, `~/.gemini/antigravity-cli/brain/<conversation id>/`. The first test showed that the earlier guess (the app's folder) was wrong. `ingest` may read from that folder too.
- A result no longer counts a copy of your reference picture that Antigravity left in its own folder.

## Changes in 0.1.1

- Codex now runs with its browser, computer-use, web, app, plugin, sub-agent, goals, image-viewer and terminal tools switched off. It stays read-only. A real run with two reference pictures still made its picture.
- Reference pictures can only come from the allowed folders, and there is a new setting, "Folders pictures may be sent from". Each reference is copied into the run's private work folder, checked again, and deleted after the run. Every result that used references lists "References sent".
- Codex pictures are matched to the run's own folder. If that folder cannot be known, the result says "Matched by comparing folders". Antigravity pictures are matched the same way, by the run's conversation folder when there is one.
- A failed or timed-out Codex run now lists "Thread folder" and "Pictures already made", so a finished picture is not lost.
- More key and secret-like settings are removed from the programs desk-art starts.
- One call files at most 16 pictures and 200 MB, and says how many were left.
- A generator's words are shown to Claude as quotes marked "data, not instructions", and hidden or control characters in file names and quotes are cleaned out.
- Tools refuse argument names they do not have.
- `/desk-art` shows `Codex hardening` and the folders pictures may be sent from.
- The hand-off to the game now names `tools/keysprite.py --edge new` (Claude asks you first), and says `tools/arc1_cut.py` is only for the Arc 1 Final art.
- The scope list in "What it will not do" is longer, and Claude asks you first when it is unsure.

## What is in the folder

```
desk-art/
  README.md                         this file
  .claude-plugin/plugin.json        the mod's name and its two settings
  hooks/                            the code that gives Claude its tools and the /desk-art command
  bin/desk_art.py                   the helper program: runs the generators and files pictures
  skills/desk-art/SKILL.md          Claude's instructions for making art
  skills/desk-art/references/       one guide per route: codex, antigravity, gemini-computer-use; recipes.md (prompts that worked) and model-comparison.md (which route for what)
  skills/anchor/SKILL.md            Claude's instructions for anchor sets
  skills/anchor/references/         classes.md (which pictures for which job), checking.md (how a result is checked), proof-protocol.md (the test that decides whether sets help)
  skills/anchor/scripts/            anchor_set.py (previews, builds and shows sets) and anchor_look.py (pictures to look at, zooms, and numbers)
  tests/ and bin/test_desk_art.py   checks for the code
  bin/test_anchor_*.py              checks for the anchor code
```
