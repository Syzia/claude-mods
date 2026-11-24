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
- **Hover** wakes him up, he waves, and a bar comes out under him to type in (see "Asking him things").
- **Stroke** him (move the pointer back and forth over him) and he gets hearts. **Shake** him while carrying him and he gets dizzy.
- **Right-click** opens his menu:
  - the list of chats and what each is doing; picking one opens it
  - Ask the crab…: puts the cursor in his bar
  - Wardrobe: a hat (top hat, cap, beanie, crown, party hat, Santa hat, cowboy hat, wizard hat, chef hat), something round his neck (gold chain, chain with a medallion, bow tie, scarf) and sunglasses
  - Dream up ideas: on to begin with (see "Dreams")
  - Size: Small, Medium or Large
  - Sounds: a chime when a turn finishes, a chat needs you, or a turn fails (off to begin with)
  - Wander when idle: now and then he scuttles a little way along and back (on to begin with)
  - Hide for an hour
  - Quit Crab Buddy

## Asking him things

The bar under him has a text field and three buttons.

- **Return**, or the orange arrow, asks him. He answers in a speech bubble, in a sentence or three. "Continue in a chat" in the bubble opens a new Claude chat with your question typed in.
- **⌘Return**, or the pencil, skips him and starts a new Claude chat with what you typed.
- **The eye** lets him read your screen for the question. It is off until you click it, and he only ever looks when you ask with it on. For an answer in the bubble he reads the *text* on your screen, not the pictures. "Continue in a chat" and the pencil attach the screenshot itself, so the chat sees everything.

He cannot think by himself: an open Claude chat does it for him, with Claude Haiku on your own account. With no chat open he says so. A screenshot is taken by the Claude app (which is what has your permission to see the screen), kept in `~/.claude/crab-buddy/shots/` and deleted after an hour.

## His feelings

Beyond what his chats are doing: hearts when stroked, dizzy when shaken, sweat and set brows when a turn has run over two minutes, tapping feet when you have left a question unanswered for 45 seconds, a yawn before he dozes off, a hum while he wanders, and a look into the distance while he works out an answer.

## Dreams

A few seconds after he falls asleep a thought cloud grows over his head and plays a little scene: a fish, crabs hopping a fence, code writing itself, a rocket.

With "Dream up ideas" on, a nap of two and a half minutes is also when he thinks about the chat you were last in: one short idea about it, such as a next step or something you may have missed. The cloud shows a light bulb, and he tells you the idea the next time you hover over him, with a button to start a chat about it. Each idea is one small request to Claude Haiku that sends the last few messages of that chat. He has at most one every 45 minutes and six a day.

## Commands

- `/crab` adds him to the chat you type it in. It also puts him on the desktop if he is not there, and ends a "hide for an hour".
- `/crab-away` (or `/crab away`) takes him out of that chat. If no other chat is using him he leaves the desktop too.

## How it works

The mod has two parts.

- `hooks/register.tsx` runs inside each Claude chat. It writes one small file per chat to `~/.claude/crab-buddy/sessions/` saying what the chat is doing: the chat's latest prompt (cut to 60 characters), its folder's name and its state. Every two seconds it also looks in `~/.claude/crab-buddy/asks/` for something the crab was asked, and writes the answer to `~/.claude/crab-buddy/answers/`. Nothing leaves your Mac except those questions and dreams, which go to Claude like any other message of yours.
- `overlay/` is the crab: a small Mac app that reads those files and draws him. `CrabBuddy.swift` is the crab and his states, `Wardrobe.swift` what he wears, `Feelings.swift` and `Dream.swift` what their names say, `Ask.swift` the bar and the bubble, `Extras.swift` what ties them to him. The mod builds it by itself the first time, into `~/.claude/crab-buddy/Crab Buddy.app`, and again whenever `overlay/VERSION` changes. Building needs the Mac's Command Line Tools: if it fails, run `xcode-select --install` in Terminal, then type `/crab`.

His settings (size, sounds, wander, wardrobe, where he sits) are kept by macOS under the name `local.crabbuddy.overlay`.

## Changing him

After editing a file in `overlay/`, raise the number in `overlay/VERSION` so every chat rebuilds him, or run `overlay/build.sh` yourself and then `/crab`.

To try a state by hand without touching your real chats, start a second crab on a folder of your own:

```bash
CRAB_BUDDY_DIR=/tmp/crab-test CRAB_BUDDY_FRONT=none ~/.claude/crab-buddy/Crab\ Buddy.app/Contents/MacOS/CrabBuddy
```

Then write a file such as `/tmp/crab-test/sessions/a.json` holding `{"state":"waiting","label":"Needs your OK","kind":"permission","updated":<now in milliseconds>}`.

`CRAB_BUDDY_SHOW` on that second crab forces something to look at: a feeling (`love`, `dizzy`, `strained`, `impatient`, `yawn`, `humming`, `thinking`), `bar` for the ask bar, or `say:some words` for a speech bubble.

Checks: `claude plugin validate .` and `claude plugin test .` (eight tests: what the mod writes for each kind of turn, and how it answers a question, a screen question and a dream).
