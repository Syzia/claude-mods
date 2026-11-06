# desk-art

Version 0.1.6

desk-art is a Claude Code mod. It lets Claude make character art with image programs that are already on your Mac and already signed in. You do not need an API key: each program uses your own sign-in. It does not use web-browser generators such as Grok in a browser.

Every picture it makes is copied into one folder (the inbox), with a note about how it was made.

You do not run desk-art yourself. You ask Claude, in plain words. For example:

- "Use desk-art to make a smiling version of this sprite." (Give the picture's path. It must be in one of the folders listed under "Reference pictures" below.)
- "Make a night-time shrine background with desk-art."
- "Make an icon for a talisman item."
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
- One notes file, `manifest.jsonl`. It has one line per picture: the time, the route, your label, the prompt (the first 4000 characters), the names of any reference pictures, the size, and a fingerprint (sha256).

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

## The /desk-art command

| Type | What you get |
|---|---|
| `/desk-art` or `/desk-art status` | A short report. Is each route ready? Is Codex's safety setting `Codex hardening: OK`? Where is the inbox, and how many pictures are in it? Which folders may pictures be sent from? |
| `/desk-art setup` | The numbered one-time steps for each route. |
| `/desk-art help` | The list of tools and the usual loop. |

Any other word gets a short reminder of these three.

## What it will not do

- It makes the game's plain art: clothed character sprites, expressions, outfits, backgrounds, items, icons and UI. It is not used for sexualised art of anyone. It is never used for swimwear, bikini, underwear, towel, bath, onsen, sauna, pool or beach pictures, lingerie-style pyjamas or "Ask for a pose" pictures of Nobara, Maki, Mai, Miwa or Momo (school students in the story, 16 and 17 in the source), and never for the pose-ladder sets of any character. When unsure, Claude asks you first. If a job drifts there, Claude stops and says so once. It does not suggest a way around it. The tools cannot check this. Claude checks it, because Claude writes every prompt.
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

desk-art itself sends nothing anywhere. The generator programs do. Codex sends your prompt and every reference picture to OpenAI. `agy` and the Gemini app send them to Google. With Computer use, screenshots of your screen go to Claude. Only pictures from the allowed folders (see "Reference pictures") can be sent as references. Do not put a picture in those folders that you would not want those companies to see.

## Where it lives

It is installed for every Claude session, the same way as Agent Office. The folder is `~/claude-mods/desk-art`, and the list that holds it is called `hunter-mods` (the file `~/claude-mods/.claude-plugin/marketplace.json`). To change the mod, edit that folder, then type `/reload-plugins` in Claude (or start a new session). Its two settings ("Art inbox folder" and "Folders pictures may be sent from") are optional: until you set them, the defaults described in this file are used. To change them, type `/plugin configure desk-art@hunter-mods` in Claude.

## Remove it

1. Close any Claude sessions that are using it.
2. In Terminal, type `claude plugin uninstall desk-art@hunter-mods` and press Return.
3. Delete the `desk-art` mod folder (the folder that holds this README), and the `desk-art` entry in `~/claude-mods/.claude-plugin/marketplace.json`.
4. Start a new Claude session.

Installing the mod added one line to your Claude plugin list. The mod itself does not install a background program or store a login. Three things are left behind on purpose. Your pictures stay in the inbox until you delete them. A cache folder, `~/Library/Caches/desk-art`, may hold work folders from failed runs, and you can delete it any time. Copies of reference pictures in it are deleted after every run, but other job files stay. Codex keeps its own copy of every picture it made in `~/.codex/generated_images/`, and desk-art never deletes from it.

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
| `inbox-unsafe` | The inbox folder is not allowed. Pick a folder inside your home folder, not inside a hidden folder at the top of it, and not in `~/Library`. |
| `agy-not-installed` | Follow `skills/desk-art/references/antigravity.md`. |
| `/desk-art` says Codex is logged in with an API key. | Tell Claude. This mod is built for the ChatGPT sign-in, and an API key would bill that key. |
| `no-image-on-clipboard`, `osascript-failed` or `not-an-image` (Gemini app route) | The copy did not work, or the clipboard picture is not usable. Copy it again, or ask Claude to save the picture to a file instead. (In the Gemini app, the "Copy response" button under a picture copies the words only, so it always gives `no-image-on-clipboard`. The right way is to right-click the picture itself and choose Copy Image, or to press its copy icon when that shows: tested 5 Nov 2026.) |
| The result says "Matched by comparing folders". | The helper could not tie the picture to that run's own folder. Look at the picture and check that it is the one you asked for. |
| The picture is the wrong shape. | The generator may not follow the shape exactly. Ask again and say the shape in the prompt. |
| You cannot find a picture. | Type `/desk-art` to see the inbox path. Look in the folder for today's date. Search `manifest.jsonl` for your label. |
| A message that says `helper failed` | Paste the whole message to Claude. It is a problem with the helper program, not with your pictures. If it says the answer was cut, look in the inbox: the pictures may still be filed. |

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
  tests/ and bin/test_desk_art.py   checks for the code
```
