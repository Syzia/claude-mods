# Hunter's mods

This folder holds the Claude Code mods you use. A mod is an add-on that changes what Claude can do or show. Claude Code reads them straight from here (the list is called `hunter-mods`), so do not move or rename this folder.

| Folder | What it is |
|---|---|
| `agent-office` | The tycoon office panel, the status line, the sounds and the daily report |
| `office-app` | The 3D office window that shows what `agent-office` sends it. Open it with `Open Office.command`. Your office's money, furniture and outfits are in `office-app/save.json` |
| `office-feed` | One small file per session that `agent-office` writes for the 3D office while you work |
| `desk-art` | Makes game art with Codex, Antigravity and the Gemini app, with no API keys |
| `screen-light` | A small light on the right edge of your screen that shows when Claude has control of your Mac, with Clawd the crab and a pause button that stops Claude from using your screen until you resume. Try it with `/screen-light demo` |
| `.claude-plugin` | The list that tells Claude Code which mods are here |

## The history: your backup of the mods

Since 6 Nov 2026 this folder keeps a history. Each saved step of each mod is kept, so a bad edit or a deleted file can be undone. The history lives in a hidden folder called `.git` inside this one.

A private copy is on GitHub, in your account: https://github.com/Syzia/claude-mods. Only you can see it. So losing this Mac would not lose the mods.

Kept in the history and on GitHub: the code and sounds of every mod, `office-app/save.json` (your office's money, furniture and outfits), and these notes.
Not kept: `office-feed` (the live snapshots hold task text and paths), `node_modules` (`npm install` brings it back) and the type files that Claude Code lays into a mod's folder itself.

When Claude changes a mod here, it saves a new step and sends it to GitHub. The office's save is only backed up when a step is saved, not while you play. The versions are marked: `agent-office-v0.3.1`, `desk-art-v0.1.6` and `screen-light-v0.2.1`.

To look at it, type these in Terminal:
1. The steps so far: `git -C ~/claude-mods log --oneline`
2. What has changed since the last step: `git -C ~/claude-mods status --short`
3. Get one file back as it was at the last step: `git -C ~/claude-mods restore desk-art/README.md`

For anything bigger, such as going back to an older version of a whole mod, ask Claude.

## If you ever need the mods on a new Mac

Tried on 6 Nov 2026 in a throwaway home folder: `agent-office` and `desk-art` installed from the GitHub copy and showed as enabled. (`screen-light` was added the same day and has not been through that restore test.)

1. Install GitHub's `gh` program (https://cli.github.com), then sign in with `gh auth login` and `gh auth setup-git`.
2. Download the mods. Keep this exact place and name, because `agent-office` writes into it: `git clone https://github.com/Syzia/claude-mods ~/claude-mods`
3. Tell Claude Code where they are: `claude plugin marketplace add ~/claude-mods`
4. Install each mod: `claude plugin install agent-office@hunter-mods --scope user`, `claude plugin install desk-art@hunter-mods --scope user` and `claude plugin install screen-light@hunter-mods --scope user`. It may say some settings are "not yet set". They are optional, and the defaults work.
5. Start a new Claude session. The screen light builds its small program by itself the first time (this needs the Mac's Command Line Tools: if a build fails, run `xcode-select --install` in Terminal, then type `/screen-light build` in Claude). For the 3D office, install Node.js (https://nodejs.org), then double-click `office-app/Open Office.command`. The first run installs its 3D library by itself.
