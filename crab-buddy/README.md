# Crab Buddy

A little pixel crab that floats on your desktop, above your other windows. He shows what your Claude chats are doing and takes you to the right chat when you click him.

## What he shows

| He is | It means | The pill under him says |
|---|---|---|
| Bobbing, tapping his legs, snapping his claws | A chat is working | What it is doing, such as "Thinking…", "Editing" or "Running a command" |
| Hopping with both claws up and a "!" over his head | A chat is waiting on you and you have not looked yet | "Needs your OK", "Has a question" or "Plan ready for you" |
| Calm, with an amber dot | A chat is waiting on you and you have seen it | "Waiting for you" |
| Jumping, grinning, with sparkles | A turn finished | "Done" |
| Slumped, with crossed-out eyes | A turn ended in an error | "Hit an error" |
| Standing still for a moment | You stopped a turn | "Stopped" |
| Awake, blinking, watching your pointer | Nothing has happened for a little while | nothing |
| Asleep, with z's drifting up | Nothing has happened for 90 seconds | nothing |

When several chats are busy the pill shows the most pressing one and a count, such as "Editing +2".

He counts a wait as seen once the Claude app is in front (or, for a chat in a terminal, the terminal), or once you click him. After you have seen a permission prompt he goes back to "Working", because he cannot tell the moment you answer it.

## What you can do with him

- **Click** opens the chat he is showing. For a chat in the Claude desktop app that is the chat itself; for any other it is the app.
- **Drag** carries him somewhere else. He dangles while carried and remembers where you put him.
- **Hover** wakes him up and he waves.
- **Right-click** opens his menu:
  - the list of chats and what each is doing; picking one opens it
  - Size: Small, Medium or Large
  - Sounds: a chime when a turn finishes, a chat needs you, or a turn fails (off to begin with)
  - Wander when idle: now and then he scuttles a little way along and back (on to begin with)
  - Hide for an hour
  - Quit Crab Buddy

## Commands

- `/crab` adds him to the chat you type it in. It also puts him on the desktop if he is not there, and ends a "hide for an hour".
- `/crab-away` (or `/crab away`) takes him out of that chat. If no other chat is using him he leaves the desktop too.

## How it works

The mod has two parts.

- `hooks/register.tsx` runs inside each Claude chat. It writes one small file per chat to `~/.claude/crab-buddy/sessions/` saying what the chat is doing. The file holds the chat's latest prompt (cut to 60 characters), its folder's name and its state. Nothing is sent anywhere.
- `overlay/CrabBuddy.swift` is the crab: a small Mac app that reads those files and draws him. The mod builds it by itself the first time, into `~/.claude/crab-buddy/Crab Buddy.app`, and again whenever `overlay/VERSION` changes. Building needs the Mac's Command Line Tools: if it fails, run `xcode-select --install` in Terminal, then type `/crab`.

His settings (size, sounds, wander, where he sits) are kept by macOS under the name `local.crabbuddy.overlay`.

## Changing him

After editing `overlay/CrabBuddy.swift`, raise the number in `overlay/VERSION` so every chat rebuilds him, or run `overlay/build.sh` yourself and then `/crab`.

To try a state by hand without touching your real chats, start a second crab on a folder of your own:

```bash
CRAB_BUDDY_DIR=/tmp/crab-test CRAB_BUDDY_FRONT=none ~/.claude/crab-buddy/Crab\ Buddy.app/Contents/MacOS/CrabBuddy
```

Then write a file such as `/tmp/crab-test/sessions/a.json` holding `{"state":"waiting","label":"Needs your OK","kind":"permission","updated":<now in milliseconds>}`.

Checks: `claude plugin validate .` and `claude plugin test .` (four tests of what the mod writes for each kind of turn).
