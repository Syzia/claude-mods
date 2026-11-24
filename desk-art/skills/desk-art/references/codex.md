# Codex route

State: VERIFIED on this Mac on 4 Nov 2026, including a real run with the safety switches below and two reference pictures.

Use this route first. It makes pictures with the image tool built into Codex, the assistant that comes with the ChatGPT Mac app. It uses your ChatGPT sign-in, and desk-art supplies no API key. (If Codex itself were signed in with an API key, `/desk-art` would show NOT READY.)

Tool: `codex_image`. The loop, the prompt recipe and the failure table are in `../SKILL.md`.

Every picture uses your own ChatGPT plan allowance, which is limited and which desk-art cannot see. Do not batch runs.

## How it works

1. Claude calls `codex_image` with a prompt, a label and, for an edit, reference pictures.
2. The mod runs its helper program, `bin/desk_art.py`, with the Python that comes with macOS.
3. The helper checks that Codex is signed in. If it is not, the run stops with `codex-not-logged-in`.
4. The helper makes a work folder for this job under `~/Library/Caches/desk-art/jobs/` and starts Codex there. If there are reference pictures, it first copies each checked one into `work/refs/` under a plain name (see "Reference pictures").
5. It starts Codex without a window (the `codex exec` command), in read-only mode, with the safety switches listed below. Your prompt is wrapped in a short instruction. The instruction tells Codex to use only its built-in picture tool, to keep the same character, outfit and art style as any attached reference unless the request says otherwise, not to run commands, not to read, list or open any file (the reference pictures are already in front of it), not to write or edit files and not to browse the web. That instruction is a request. It is the read-only mode and the switches that limit Codex.
6. Codex makes the picture and saves it in its own folder, `~/.codex/generated_images/<thread id>/`.
7. The helper copies each new picture into the inbox, adds a line to `manifest.jsonl`, and gives Claude the paths. It does not move or delete Codex's copy.
8. If the run worked, the helper deletes its work folder (it keeps it only when more pictures came out than one call may file). If the run failed, it keeps the folder so the problem can be looked at. Reference copies are deleted either way.

## How Codex is held back

In this order:

1. Codex runs in read-only mode. Read-only means it cannot change files and cannot use the network. It can still read files and run read-only commands through its built-in code tool. Picture making needs that tool.
2. desk-art switches off Codex's browser, computer-use, web, app, plugin, sub-agent, goals and image-viewer tools, and its terminal tool. This was checked on this Mac on 4 Nov 2026. With Codex's default settings, a request to read `/etc/hosts` worked. With the switches below, a test of the web failed, a test of writing a file failed (the read-only mode blocked it), a test of reaching the network from its code tool failed (the name lookup failed), and a file read still worked.
3. So prompts must only describe pictures. Never ask Codex to look at a file.
4. The wrapper text is a request, not a lock.

Codex starts in a work folder of its own (empty, apart from the copies of the reference pictures). That is only where it starts. It is not a safety wall: Codex can still read files elsewhere on the Mac.

The switches, as the helper passes them (`--disable <name>`):

| Switch | What it turns off |
|---|---|
| `shell_tool`, `unified_exec`, `unified_exec_tty` | the shell and terminal tools |
| `computer_use` | the tool that can drive the Mac's screen |
| `browser_use`, `browser_use_external`, `browser_use_full_cdp_access`, `in_app_browser` | the browser tools |
| `view_image` | the image viewer, which can open any file path |
| `apps`, `plugins` | app and plugin tools |
| `multi_agent` | sub-agents |
| `goals` | goals |
| `sleep_tool` | the sleep (wait) tool |
| `-c web_search="disabled"` | the live web search tool |

Three features stay on because picture making breaks without them: `code_mode_host`, `skill_search` and `image_generation`. This was tried: turning off `code_mode_host` or `skill_search` stops image generation from working.

Codex refuses a switch name it does not know (`Error: Unknown feature flag: <name>`, and it stops). So if an update to the ChatGPT app renames one of these switches, runs fail with `Unknown feature flag` instead of running without the limit. If you see that, tell Claude: desk-art needs an update. `/desk-art` shows `Codex hardening: NOT OK (missing: <names>)` when it can see the problem first. `Codex hardening: unknown` means the check could not run.

## What was checked on 4 Nov 2026

These facts were seen on this Mac. They are not guesses.

- The Codex program is at `/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex`. The ChatGPT app's bundle id is `com.openai.codex`. The version text is `codex-cli 0.164.0-alpha.11.1`.
- The helper also looks for `codex` on the normal command path and in `/Applications/Codex.app/Contents/Resources/codex-cli/bin/codex`.
- `codex login status` printed `Logged in using ChatGPT`. That is a ChatGPT sign-in, not an API key. (It prints this on its error output, not its normal output, so the helper reads both.)
- Codex keeps that login in `~/.codex/auth.json`. desk-art never reads, copies, hashes or prints that file. Neither should Claude.
- This command worked first: `codex exec --json --ephemeral --skip-git-repo-check -s read-only -C <work folder> "<prompt>"`. The helper's command now adds the safety switches, the references and `-- -`, and sends the prompt on Codex's input.
- When Codex's input is left open, it says `Reading additional input from stdin...` on its error output. The helper sends the prompt on that input and then closes it. All four real runs on 4 Nov 2026 printed nothing on the error output.
- Codex prints one small JSON event per line: `thread.started`, `turn.started`, `item.completed` (the agent's message), `turn.completed` (with token counts). No picture bytes are inside them.
- A request for a "small square" gave a 1254x1254 PNG of 1.1 MB. Codex saved it at `~/.codex/generated_images/<thread id>/exec-<uuid>.png`, even though `--ephemeral` was on. So Codex keeps its own copy of every picture it makes.
- The picture tool is Codex's `image_generation` feature. It is marked stable and is on.
- Four real runs were made through the helper on 4 Nov 2026, before the safety switches were added. Each exited normally and printed nothing on the error output. With no reference picture: one 1254x1254 PNG (1.1 MB) in about 30 seconds. With one reference picture: one 1254x1254 PNG in about 40 seconds. With two reference pictures: one 1254x1254 PNG in about 42 seconds. A request for a tall 9:16 picture: one 941x1672 PNG (1.0 MB, a true 9:16 shape) in about 23 seconds. A real game sprite may take longer.
- After the safety switches were added, a real run with two attached reference pictures and exactly the switch list above still made a 1254x1254 picture.

## Not checked yet

- How well a real character comes out in a tall 9:16 picture. The shape itself works (941x1672), but every test picture was a flat colour shape. Check width and height on every result.
- Several pictures in one run.
- How faithfully Codex keeps a real game character the same when you give it a sprite as a reference. The command with a reference works (see below). How good the likeness is has not been measured on real sprites. Look at every result.
- How much of your ChatGPT allowance a picture uses. The helper cannot see how much is left.

## Reference pictures

Put the pictures in `refs` (up to 6, full paths, real PNG, JPEG or WEBP, 20 MB or less).

Every reference picture is uploaded to OpenAI. So a reference must sit in a folder desk-art may send from. By default those are:

- `~/Desktop/JJKgame.md`
- `~/Desktop/JJK Game images`
- `~/Desktop/Character reworks`
- `~/Desktop/JJK_worktrees`
- the inbox, and the cache folder `~/Library/Caches/desk-art` (always allowed)

The mod's setting "Folders pictures may be sent from" changes the four game folders (a vertical bar between folders; empty means the game's art folders above). The mod gives the helper each folder of the setting as `--ref-root`; with none given, the helper uses the four above. The rule that a picture must be inside your home folder, not in a hidden folder at the top of it and not in `~/Library`, still applies to every picture. A picture outside the allowed folders is refused with `bad-input` and this message: `<what> <path> is not in a folder desk-art may send from. Allowed: <the folders>. Copy the picture into one of those folders, or change the mod's "Folders pictures may be sent from" setting.`

To use a one-off picture, with the owner's say: the owner puts it in `~/Downloads`, Claude files it with `ingest` (`backend` `other`), and the filed copy in the inbox is used as the reference. `ingest` itself reads from the same folders, and also from `~/Downloads` and the generator picture folders (`~/.codex/generated_images/`, `~/.gemini/antigravity/brain/` and `~/.gemini/antigravity-cli/brain/`).

Every result from a run that used references lists `References sent to OpenAI: <name> (<fingerprint>), ...`, so you can check what went.

How the helper attaches them. Codex's `-i` option splits a value at commas, and a file could be swapped after it was checked. So the helper does this for each reference:

1. It opens the real file (a link is followed to the real file first) and checks that it is still the file it checked.
2. It reads the bytes (20 MB at most) and checks the picture header on those bytes.
3. It writes a copy into the job's private work folder under a name of its own choosing (`work/refs/ref1.png`, `ref2.jpg`, and so on), which the owner alone can read.
4. It hands Codex the path of that copy, not the original.

The manifest records the original file's name and the fingerprint of the copied bytes. The original is only read. It is never changed, moved or deleted. The copies are deleted after every run, even a failed one.

The `-i` option can swallow text placed after it. So the helper does not put the prompt on the command line. It sends the prompt on Codex's input instead (the command ends with `-- -`, which means "read the request from input").

The exact arrangement of `-i` and the prompt on Codex's input was checked with real runs on 4 Nov 2026, with no reference, one reference and two references, using `codex-cli 0.164.0-alpha.11.1`. With one reference (a flat green square with one white circle), the new picture came back with the same green background and a blue circle, as asked. With two references (a green square with a white circle, and a magenta square with a white triangle), the request asked for the first one's background colour and the second one's shape, and the picture came back green with a white triangle. The requests alone could not have made those results, so the references were attached and used.

Anchored runs (0.2.0). When `anchor` is given, the helper reads the saved set and sends its pictures first. Codex's standard input is then the wrapper (its text is unchanged), then the anchor block (the fixed words about each picture; since 0.2.1 it starts "This REQUEST says otherwise", the answer to the wrapper's "unless REQUEST says otherwise"), then `NOW MAKE:` and the prompt. The set's pictures are `-i` copies in their saved order, then any extra pictures from `refs`. Codex is handed only the pictures, in that order, and no file names, so "Picture 2 (room)" relies on Codex matching "the second picture" to the second attachment. Whether the block stops a style picture's subject from being copied is not verified.

## Where files land

1. Codex writes the picture in its own folder: `~/.codex/generated_images/<thread id>/exec-<uuid>.png`. This is Codex's doing. It happens with every run. (If you set the `CODEX_HOME` environment variable, Codex and the helper use that folder instead of `~/.codex`.)
2. The helper copies it into the inbox as `<inbox>/<date>/<label>_codex_<number>_<fingerprint>.png`, and adds a line to `<inbox>/manifest.jsonl`.
3. Codex's copy stays where it is. Each picture is about 1 MB, so that folder grows. desk-art never deletes from it.

The helper takes pictures only from the folder of this run's own thread. If the thread's folder is empty, the run ends with `codex-no-images` and shows the agent's words. Only when the helper never learned the thread id does it compare Codex's whole picture folder before and after the run. The result then says `Matched by comparing folders, not by this run's own folder: check that this is your picture.`, so look at the picture with extra care.

If a run ends in `codex-failed` or `codex-timeout`, a picture may already have been made. The failure lists the `Thread folder` and the `Pictures already made` in it, and `ingest` can file them from that folder only. The helper does not file them by itself. If the thread is not known, ask the owner before you list the shared `~/.codex/generated_images/` folder, because it holds the pictures of every run. For `codex-failed`, a finished picture may already exist, so do not just run again.

If a run ends in `internal` or `helper failed` after Codex made a picture, the picture may still be in Codex's folder. But those failures do not say which thread it was, so ask the owner before you list the shared `~/.codex/generated_images/` folder. `ingest` accepts that folder as a source.

## Limits and quota

- Time: 480 seconds by default. You can ask for 30 to 540.
- References: 6 at most, 20 MB each.
- Prompt: 1 to 8000 characters.
- Filing: at most 16 pictures and 200 MB per call.
- Quota: pictures use your ChatGPT sign-in, so they count against your ChatGPT plan. The size of that allowance is not known here. If a run fails with words about a limit, wait and try later.
- Make one picture at a time and look at it before asking for the next.

## What the helper never does with Codex

- It never uses `--dangerously-bypass-approvals-and-sandbox`, `--approve-for-me` or `-s danger-full-access`.
- It never opens, copies or prints `~/.codex/auth.json`.
- It removes key and secret-like settings (names such as `OPENAI_API_KEY`, `GITHUB_TOKEN` or `SSH_AUTH_SOCK`) from the environment of the Codex it starts, so a key left in your shell settings is never picked up by mistake. Ordinary settings stay.
- It never makes network calls of its own. Codex makes its own.

If `/desk-art` ever says Codex is logged in with an API key instead of ChatGPT, it shows NOT READY. Tell Claude. This mod is built for the ChatGPT sign-in, and an API key would bill that key.

## Errors and fixes

| Code | Likely reason | Fix |
|---|---|---|
| `codex-not-found` | The ChatGPT app (or a Codex app) is not where the helper looks. | Install or update the ChatGPT app, open it once, then run `/desk-art`. |
| `codex-not-logged-in` | Codex is signed out. | Open the ChatGPT app (Codex) and sign in. Run `/desk-art` again. |
| `codex-no-images` | Codex answered with words, not a picture. It may have refused or asked a question. | Read the agent's words in the message. Answer a question. Do not work around a refusal. |
| `codex-failed` | Codex stopped with an error. A finished picture may already exist. | Read the error text. Check `Pictures already made` in the message before you run again. A limit message means wait. A sign-in message means sign in again. `Unknown feature flag` means a Codex update changed a switch name: tell the owner that desk-art needs an update. |
| `codex-timeout` | No result in time. | The message lists the `Thread folder` and `Pictures already made`. `ingest` can file them, from that folder only. If the thread is unknown, ask the owner before you list `~/.codex/generated_images/`. Otherwise try again once with a simpler prompt or fewer references. |
| `bad-input` ("is not in a folder desk-art may send from") | A reference is outside the allowed folders. | See "Reference pictures". |

A quick manual check you can run yourself in Terminal (the app named Terminal, in Applications, Utilities). It only asks Codex whether you are signed in:

```
/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex login status
```

You should see `Logged in using ChatGPT`.
