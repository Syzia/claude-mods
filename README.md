# Hunter's mods

This folder holds the Claude Code mods you use. A mod is an add-on that changes what Claude can do or show. Claude Code reads them straight from here (the list is called `hunter-mods`), so do not move or rename this folder.

| Folder | What it is |
|---|---|
| `agent-office` | The tycoon office panel, the status line, the sounds and the daily report |
| `office-app` | The 3D office window that shows what `agent-office` sends it. Open it with `Open Office.command`. Your office's money, furniture and outfits are in `office-app/save.json` |
| `office-feed` | One small file per session that `agent-office` writes for the 3D office while you work |
| `desk-art` | Makes game art with Codex, Antigravity and the Gemini app, with no API keys |
| `.claude-plugin` | The list that tells Claude Code which mods are here |

## The history: your backup of the mods

Since 6 Nov 2026 this folder keeps a history. Each saved step of each mod is kept, so a bad edit or a deleted file can be undone. The history lives in a hidden folder called `.git` inside this one, on this Mac only. If the Mac itself were lost, the history would go with it. A private copy on GitHub would cover that. It is not set up.

Kept in the history: the code and sounds of every mod, `office-app/save.json`, and these notes.
Not kept: `office-feed` (the live snapshots hold task text and paths), `node_modules` (`npm install` brings it back) and the type files that Claude Code lays into a mod's folder itself.

When Claude changes a mod here, it saves a new step afterwards. The versions are marked: `agent-office-v0.3.1` and `desk-art-v0.1.3`.

To look at it, type these in Terminal:
1. The steps so far: `git -C ~/claude-mods log --oneline`
2. What has changed since the last step: `git -C ~/claude-mods status --short`
3. Get one file back as it was at the last step: `git -C ~/claude-mods restore desk-art/README.md`

For anything bigger, such as going back to an older version of a whole mod, ask Claude.
