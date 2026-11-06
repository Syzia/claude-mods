# Antigravity route (the `agy` command)

State: VERIFIED on this Mac on 5 Nov 2026 (agy 1.5.0). It made flat test pictures, also from a reference picture. Not tested yet: real character sprites, what it does when it refuses, and its limits.

`agy` is Google's official command-line program for Antigravity. It was installed on this Mac on 5 Nov 2026 (the program only: see "How it was installed here"). The `agy_image` tool was built from Google's public docs (read on 4 Nov 2026), and the first real runs on 5 Nov 2026 settled where `agy` saves its pictures. Anything still not seen is marked "unknown" or "not tested" below.

Tool: `agy_image`. The loop, the prompt recipe and the failure table are in `../SKILL.md`.

Every picture uses your own Google plan allowance, which is limited and which desk-art cannot see. Do not batch runs.

## What is known and what is not

| Question | Answer |
|---|---|
| Can it run without a window? | Yes, per the docs: `agy -p "your text"`. |
| Can the command make pictures at all? | Yes. Seen on 5 Nov 2026 with agy 1.5.0: it made a 1024x1024 JPEG on request, twice. Google's own docs say nothing about pictures. |
| Where does it save a picture? | Seen on 5 Nov 2026: `~/.gemini/antigravity-cli/brain/<conversation id>/<name>_<number>.jpg`, and the agent names the file in its reply. The desktop app uses `~/.gemini/antigravity/brain/` the same way. See "How the helper finds the pictures". |
| How does it sign in? | In the browser, with a personal Google account. The sign-in is kept in the macOS keychain. There is no API key. The docs say one sign-in is shared by the local Antigravity programs. On this Mac `agy` ran straight after the install, with no separate sign-in step. |
| What are the limits? | Weekly. Pro and Ultra plans also refresh every five hours. The docs give no numbers, and desk-art cannot see how much is left. |
| What if the agent needs approval? | Without a window, a request for approval is refused quietly. The exit code is still 0, and a notice goes to the error output. The helper never turns approvals off. In the two test runs nothing was refused: the agent used its picture tool. |
| Is there a read-only mode? | desk-art sets no read-only or sandbox switch on `agy`. None was verified. So keep every prompt to a description of a picture, and never ask `agy` to open, read or change a file. |

## How it was installed here (5 Nov 2026)

The owner said yes in the chat, and Claude installed the program only, without Google's installer:

1. It read Google's manifest (`https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/darwin_arm64.json`): version 1.5.0, a package at `storage.googleapis.com/antigravity-public/...`, and a SHA-512 fingerprint.
2. It downloaded that package (`cli_mac_arm64.tar.gz`, 61,387,232 bytes) and checked that its SHA-512 matched the manifest.
3. It listed the package: one file, `antigravity`. It took only that file out, and checked it without running it: a 64-bit Mac program, signed by `Developer ID Application: Google LLC (EQHXZ8M8AV)`, the same publisher as the Gemini and Antigravity apps on this Mac, and the signature is valid.
4. It copied the file to `~/.local/bin/agy`. `agy --version` prints `1.5.0`.
5. It did NOT run Google's installer, so the installer's last step (`agy install`) was not run, and no shell settings were changed (the shell files were checked afterwards).

`~/.local/bin` may not be on your command path, so plain `agy` may not be found in Terminal; use `~/.local/bin/agy`. The desk-art helper finds it by that path on its own.

## Steps for you (once)

You decide whether to install `agy`. Run Google's line below yourself, or tell Claude an explicit yes in the chat first (Claude can do the program-only install above instead). Without that yes, Claude does not install it. The desk-art helper never installs anything.

### What the installer does

Google's installer (`https://antigravity.google/cli/install.sh`) was read as text on 4 Nov 2026. It was not run. This is what it does:

- It downloads a small description file (a "manifest") for your kind of Mac. The file comes from a Google Cloud Run address, `https://antigravity-cli-auto-updater-974169037036.us-central1.run.app/manifests/<platform>.json`. That address is not on antigravity.google.
- It downloads the program package named in that file.
- It checks the package's SHA-512 fingerprint against the one in the same file. There is no signature check.
- It writes the program to `~/.local/bin/agy`.
- It removes the macOS quarantine flag from the program. (macOS normally puts that flag on downloaded programs, and it triggers a safety check the first time you open one.)
- It creates a working folder, `~/.cache/antigravity/staging/`.
- It does not ask for your password (no sudo). The script itself sends nothing except the request for the file for your platform's name.
- The script itself does not edit your shell settings. But its last step always runs `agy install`, and it prints "Configuring shell environment...". That step may change your shell settings (the settings Terminal loads when it starts, such as the list of folders it looks in for programs). Google does not say exactly what it changes. If that step fails, the installer ignores the failure.

That is what the script said when it was read on 4 Nov 2026. The line below downloads the script and runs it at once, so it runs whatever the address serves when you press Return. Google can change the script at any time.

The installer takes no options you need. Type the line exactly as shown. It stops at once if you add an option it does not know.

### The steps

1. Open Terminal (the app named Terminal, in Applications, Utilities).
2. Copy this line, paste it into Terminal, and press Return:

   ```
   curl -fsSL https://antigravity.google/cli/install.sh | bash
   ```

3. Wait for it to finish. Near the end it prints "Configuring shell environment...". That is the `agy install` step described above.
4. Close the Terminal window and open a new one, so any shell changes load.
5. Check that it is there. Type `agy --version` and press Return. You should see a version number. If Terminal says "command not found", try `~/.local/bin/agy --version`. If that works, the program is installed, but your command path (the list of folders Terminal looks in for programs) does not include it. You can still use it by its full path. The desk-art helper finds it at `~/.local/bin/agy` on its own.
6. Sign in. Start `agy` from an empty folder. That is only where it starts, not a lock, so do not type any request into it:
   1. Type `mkdir -p ~/agy_signin` and press Return.
   2. Type `cd ~/agy_signin` and press Return.
   3. Type `agy` (or `~/.local/bin/agy`, if step 5 showed that plain `agy` is not found) and press Return.
   4. It should open a page in your browser where you sign in with your personal Google account. If the Antigravity desktop app is already signed in, the docs say `agy` may not ask. Follow what the screen says.
   5. If it asks you to trust or allow a folder, allow only this empty one. Do not type any request into it.
   6. When you are signed in, close the Terminal window. You can delete the `agy_signin` folder afterwards.
7. In Claude, type `/desk-art`. The `agy` line should say FOUND.
8. Ask Claude to run the first-run test below.

## First-run test (Claude does this with the owner watching)

The goal is to find out, with a harmless picture, whether the command can make pictures. It was run on this Mac on 5 Nov 2026 and passed (see "First-run results"). Run it again on another Mac, or after an update of `agy`.

Before the test, ask the owner to close the Antigravity app and to make no other request in Antigravity until the test is done. The helper may have to find the picture by comparing folders (see below), and a picture made by other Antigravity activity at the same time could be filed by mistake.

1. Call `status`. Check that `agy` is found. If not, stop and give the owner the steps above.
2. Call `agy_image` with the label `agy-smoke-01`, no references, and this prompt: `A flat pure magenta square with one white triangle in the middle. No text.`
3. Read the result:
   - A picture comes back. Open it with the Read tool. The test passes only if the picture is a magenta square with ONE white triangle. Anything else (a different picture, two triangles, another colour) means the helper filed something that is not this run's picture, or `agy` did not follow the prompt. Tell the owner and STOP. If the result says `Matched by comparing folders`, take extra care. If it passes, the route works. Then try one more run, with label `agy-smoke-02`, using that first picture (its full path from the result, which is in the inbox, so it is allowed) in `refs` and the prompt `Same picture, but the triangle is blue. No text.` This shows whether `agy` can see references. The reference is uploaded to Google, which the owner has agreed to by asking for this test. Write both results in "First-run results" below.
   - `agy-no-images`. Show the owner the agent's words. The message may also carry a notice that `agy` printed on its error output. The command may not be able to make pictures, or it may have needed an approval that the windowless mode refuses. Say so plainly and STOP. Do not try other ways in.
   - `agy-failed`. Show the error words. Likely causes: not signed in, a limit, a wrong model name. Stop and tell the owner.
   - `agy-timeout`. Stop and tell the owner.
4. If `agy` cannot make pictures, say that to the owner in one sentence, and offer the Codex route. The Gemini app route is the other option.

Leave the `model` argument empty. If the owner wants a particular model, ask them to type `agy models` in Terminal and read you a name from the list.

## Reference pictures

Every reference picture is uploaded to Google. So a reference must sit in a folder desk-art may send from. By default those are:

- `~/Desktop/JJKgame.md`
- `~/Desktop/JJK Game images`
- `~/Desktop/Character reworks`
- `~/Desktop/JJK_worktrees`
- the inbox, and the cache folder `~/Library/Caches/desk-art` (always allowed)

The mod's setting "Folders pictures may be sent from" changes the four game folders (a vertical bar between folders; empty means the game's art folders).

A picture outside them is refused with `bad-input` and this message: `<what> <path> is not in a folder desk-art may send from. Allowed: <the folders>. Copy the picture into one of those folders, or change the mod's "Folders pictures may be sent from" setting.`

To use a one-off picture, with the owner's say: the owner puts it in `~/Downloads`, Claude files it with `ingest` (`backend` `other`), and the filed copy in the inbox is the reference. `ingest` itself reads from the same folders, and also from `~/Downloads` and the generator picture folders (`~/.codex/generated_images/`, `~/.gemini/antigravity/brain/` and `~/.gemini/antigravity-cli/brain/`). The rest is the same as for Codex: see `codex.md`, section "Reference pictures".

The helper copies each checked reference into the run's private work folder (`work/refs/ref1.png`, `ref2.jpg`, and so on), checks the copy's bytes again, and lists those copies in the prompt. The original is never changed. The copies are deleted after every run, even a failed one. Every result that used references lists `References sent to Google: <name> (<fingerprint>), ...`.

## What the helper runs

It runs `agy --output-format json -p "<prompt>"` from a fresh work folder of its own (adding `--model <name>` if you asked for one). The prompt also asks `agy` to save a copy of each finished picture in an `out` folder inside the work folder, if it can. It reads the JSON answer (`conversation_id`, `status`, `response`).

### How the helper finds the pictures

It takes a snapshot of the folders before the run and a second look after, and keeps only the files that are new or changed and really are pictures. It checks only files whose names end like a picture (png, jpg, jpeg or webp). Every other file there, settings included, is left alone and never opened. The command's folder was a guess until the first run on 5 Nov 2026, which is why the helper is built to compare folders when it has to.

- When the JSON answer gives a conversation id (it did in both test runs), only these places are searched: the run's work folder (without the copied references) and that conversation's folder, `~/.gemini/antigravity-cli/brain/<conversation id>/` (where the command saved its pictures in the test runs) or the app's `~/.gemini/antigravity/brain/<conversation id>/`.
- Only when the answer has no conversation id does the helper search wide: it compares all of `~/.gemini/antigravity/brain/` and `~/.gemini/antigravity-cli/` before and after. The result then says `Matched by comparing folders, not by this run's own folder: check that this is your picture.`

A wide search can pick up a picture that other Antigravity activity made during the run, and file it by mistake. So close the Antigravity app, and make no other Antigravity request, while a run is going. Look at every picture, and check it against what you asked for.

Antigravity's agent copies a reference picture into its own folder to look at it (seen on 5 Nov 2026). The helper ignores any picture that is byte for byte one of the references that were sent, so such a copy is never counted as a result.

The helper never passes `--dangerously-skip-permissions` or any other `--dangerously-*` flag. It never reads Antigravity's settings or sign-in (`~/.gemini/antigravity-cli/settings.json`, `~/.gemini/config/`, the keychain). It removes key and secret-like settings (names such as `GEMINI_API_KEY`, `GOOGLE_API_KEY` or `SSH_AUTH_SOCK`) from the environment of the `agy` it starts.

## The locked helper (`agentapi`)

Antigravity has a private helper program inside `~/.gemini/antigravity/bin/` called `agentapi`. It is locked. When it was tried on 4 Nov 2026 it answered `missing CSRF token`. desk-art does not use it. Nobody should look for or copy that token. desk-art does not try to get around the lock.

## What is untested

- Real character sprites (only flat test shapes so far).
- What the agent does when a picture is refused, and the words it uses.
- What the installer's last step, `agy install`, changes (it was not run here).
- The `--model` option, and how `agy` behaves on a very long run.
- That the JSON answer's `status` field has the values the helper expects (only `conversation_id` and `response` were seen working).
- The weekly limit, and how many pictures it allows.
- That no read-only or sandbox switch is needed. None is set by desk-art.

## First-run results

Date: 5 Nov 2026. `agy` version: 1.5.0. Model: the default (no `model` argument).

Test 1 (no reference). Prompt: `A flat pure magenta square with one white triangle in the middle. No text.` A 1024x1024 JPEG came back: a flat magenta square with ONE white triangle. PASS. The helper first looked only in the desktop app's folder and said `agy-no-images`; the picture was in `~/.gemini/antigravity-cli/brain/<conversation id>/magenta_square_white_triangle_<number>.jpg`. The helper was fixed to look in the command's folder, and that picture was filed with `ingest`.

Test 2 (the test 1 picture as a reference). Prompt: `Same picture as the reference, but the triangle is blue instead of white. Keep the flat magenta background. No text.` A 1024x1024 JPEG came back after 96 seconds: the same magenta square, the triangle in the same place and shape, now blue. PASS: the reference was seen and used. Matched by the conversation folder. The agent had also copied the reference into its own folder; the helper now ignores such copies.

Test 3 (6 Nov 2026, a real background, text only). The game's own 1,609-character brief for the vending machine close-up, 16:9, no reference. Run A filed three 1376x768 JPEGs after 160 seconds: the agent drew a picture, drew it again and again about 30 seconds apart, and its reply named the third as its result (the first had a forest on the left, the second a price on the display, the third was clean). Run B filed one picture after 95 seconds. So one call can make several pictures: look at all of them.

Test 4 (6 Nov 2026, the same brief with two style references: the game's Courtyard and Classroom backgrounds). Four pictures were filed after 288 seconds, but two of them were 1920x1080 JPEGs from `.system_generated/logs/media/step_2_media_0.jpg` and `step_3_media_0.jpg` in the conversation's folder. That is the agent's own log of the pictures it was shown, re-encoded, so it is not byte-identical to the references and the old check let it through. Fixed in 0.1.4: nothing under `.system_generated` counts as a result. The other two were real: its first version and a refined second one (the better one). With references the pictures matched the game's own look much more closely than the text-only runs did.

Test 5 (6 Nov 2026, limits). After about 16 pictures in two hours, with three Antigravity runs going at once, one run answered "Image generation could not be completed because the image generation model quota is currently exhausted (HTTP 429 RESOURCE_EXHAUSTED)" and the helper said `agy-no-images`; a second run failed the same way. Both worked when retried one at a time about 15 minutes later. So: run Antigravity one or two jobs at a time, and when it says 429, wait and retry.

Test 6 (6 Nov 2026, the models). `agy models` lists gemini-4-argon-{low,medium,high}, gemini-3.8-flash-{low,medium,high}, claude-opus-5-5-{low,medium,high}, claude-sonnet-5-5-{low,medium,high} and gpt-oss-120b-medium. The `model` argument picks the AGENT, not the image tool. Times for one picture: Flash high 77 s, Sonnet high 80 s, Opus high 68 s to 452 s, Argon high 327 s for two drafts and once a time-out at 540 s with no picture. Blind scores on the same briefs: no model beat the default in a repeatable way (Opus scored best on a street but worst on a bakery); Argon was the slowest and the most washed out. Leave `model` out.

Add new first-run results here, with the date and the `agy` version.
