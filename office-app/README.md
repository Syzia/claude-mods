# Agent Office

A little 3D tycoon office where your Claude agents work, take breaks, earn pay
and spend it. It runs on your Mac and fills itself from your Claude sessions
through the `agent-office` mod.

## Open it

**Agent Office** is an app of its own, in your Applications folder (open it
from Launchpad, Spotlight or the Dock like any app). It starts the office's
little server by itself, shows the office in its own window, and shuts the
server down when you quit. Ways to open it:

1. Open **Agent Office** from Launchpad or Spotlight (right-click its Dock
   icon, then Options, then Keep in Dock to pin it).
2. In Claude, type `/office-3d`.
3. In Claude's Office panel, click **🏢 Open the 3D office**.

Prefer a browser tab? Double-click **Open Office.command** in this folder
instead: a Terminal window runs the server and the office opens in your
browser. Close that Terminal window to shut it.

Your money, furniture and outfits are kept in `save.json` here, whichever way
you open the office.

To rebuild the app after changing `desktop/main.swift`, run
`desktop/build.sh`. Its log is `~/Library/Logs/AgentOffice.log`.

The first time, a session that was already open needs `/reload-plugins` (or a
new session) before its agents show up. Until a session is writing, a pretend
team (Demo Co.) works in the office so it is never empty.

## The look

A night city in the rain, built in `public/js/scenery/`: layered megatowers
full of lit windows and vertical neon signs, roof gardens, a sea of city lights
to the horizon with glowing smokestacks, a building-sized video advert and other
billboards (every brand invented), a floating holographic koi, flying cars with
headlight beams, cars on the road, lamp posts whose light cones catch the rain,
a wet street that reflects the city, a moon, drifting clouds, sweeping
searchlights and, now and then, soft lightning far off in the clouds with a quiet
rumble. Tilt the camera up (right-drag) to look over the city to the sky. Inside, dark floors, neon-trimmed walls and a
coloured light in each room. 🔊 in the top bar turns the sound on or off: rain
and a low synth pad, a blip for each new hire, a cash chime for finished work,
a fanfare for parties and an alarm past 95%.

## In Claude

- `/office` opens the side panel; `/office-3d` opens this app.
- `/office-report` sums up the team's day (hires, finished work, tasks, steps,
  usage); `/office-report yesterday` or `/office-report 2026-10-20` for another day.
- The status line at the bottom of Claude shows who is working, who is on a
  break, and your usage.
- Sounds in Claude (a chime when an agent finishes, a fanfare when the plan is
  done, an alarm past 95%) can be turned off in the config menu under Sounds.

## Moving around

- **Drag** to slide the camera, **right-drag** to turn it, **scroll** to zoom.
- **W A S D** or the arrow keys slide too; **Q / E** turn.
- **Click someone** to see their card: task, what they are doing right now,
  recent steps and wallet. **Double-click** or 🎥 to follow them.
- The room buttons at the bottom jump to a room; 🧭 shows the whole office.

## What happens in the office

- A new agent walks in from the street, Remi at reception waves, they get a
  briefing at Claude's desk, then sit down in their department: Engineering,
  Research Lab, Strategy Room, Ops Center or Remote Hub. Agents started
  together sit in the same desk pod; three or more start with a kickoff in
  the Meeting Room.
- While working they type with a bubble showing their current step, and now
  and then walk over to pair with a teammate or grab a coffee.
- When they finish they hand their report to Claude, get paid, then take a
  break: coffee, couch, beanbag naps, ping-pong and foosball (with a partner),
  arcade, books, treadmill, water-cooler chats, whiteboard sketches, or the
  Style Shop if they can afford something new.
- Claude takes a coffee break while waiting for you, and hurries back when
  you send a message.
- Rooms open by themselves the first time they are needed.
- **Pizza party:** when every task on a plan is checked off, a party table
  with pizza and balloons appears in the break room, the company gets a $250
  bonus, and everyone gathers to eat, chat and cheer for about a minute.
  Anyone still working grabs a quick slice and goes back to their desk.

## The power meter

The meter on the wall outside the Lead Office (and ⚡ in the top bar) shows
your real Claude usage: this 5-hour session and this week. It turns amber at
80%. Past 95% (your stop rule) the alarm light flashes, the lights flicker,
the top bar pulses red and a banner says it is time to wrap up. Claude itself
also pops up a warning, once per window. With only the demo running, the
meter shows pretend numbers, marked "(pretend)".

## Money

- The company earns for every step, every finished agent, every task checked
  off the plan and every turn. Workers earn a wage into their own wallet.
- **🔨 Build** opens the shop: pick something, move the mouse to place it
  (green fits, red does not), **R** turns it, click to buy. Click something you
  bought to move it or sell it back for half. Bigger items unlock as the office
  ranks up, and the Game Room can be bought outright.
- **👕 Customise** on someone's card opens their wardrobe. They pay from their
  own wallet, or tick "The company pays" to gift it. Once they own something,
  wearing it again is free. On breaks they sometimes go shopping by themselves.

## For tinkering

- `npm test` checks the walking routes, the money rules and the feed reader.
- The mod writes one snapshot per session to `~/claude-mods/office-feed/`.
- In the browser console, `office.advance(60)` fast-forwards a minute.
