# Kick Subathon Timer — louay_cherni

Counts Kick subs + gifted subs automatically and adds time to a countdown shown in OBS.
Big hours-left countdown, tiny `ENDS SAT 04/07 04:32` line under it.

## Option A — Hosted (easiest, no server)

OBS → Sources → **Browser** → URL **`https://fieryaaa.github.io/subathon/`**, size **900 × 280**.
**Important:** in the browser source settings, UNCHECK “Shutdown source when not visible”, or subs get missed while the scene is hidden.

The page itself connects to Kick chat, counts subs, and keeps its state in OBS (survives OBS restarts — wall clock keeps counting while OBS is closed). Control it by typing in your own Kick chat (only the broadcaster and moderators are obeyed):

| Command | Effect |
|---|---|
| `!timer start 120` | fresh start with 120 min (resets sub count) |
| `!timer add 30` / `!timer remove 10` | manual time adjust |
| `!timer set 90` | set remaining to exactly 90 min |
| `!timer rate 10` | change minutes per sub (default 15) |
| `!timer pause` / `!timer resume` | freeze / unfreeze |
| `!timer end` | end it now |

Keyboard fallback (right-click the source → Interact): `P` pause/resume, `+` / `−` = ±5 min.

URL params: `?size=120` bigger · `?subs=1` show sub count · `?ends=0` hide end date · `?rate=20` starting sub value · `?admins=name1,name2` extra allowed commanders · `?demo=1` style preview · `?channel=slug&chatroom=ID` other channel.

Note: subs are only counted while the overlay is open somewhere (OBS running). If OBS was closed when subs happened, add them with `!timer add`.

## Option B — Local server (control panel UI)

1. Double-click **start.bat** (keep the window open; auto-restarts on crash).
2. Control panel opens at **http://127.0.0.1:4025/** — set initial minutes, press **START**.
3. OBS → Browser source → `http://127.0.0.1:4025/overlay`, size **900 × 280**.

Same rules, but with a full panel: rate, cap, pause, exact set, simulate buttons, event log.
State in `state.json`. Overlay params: `?size=120` · `?subs=1` · `?ends=0` · `?demo=1`.

Use ONE option at a time (they keep separate states).

## Diagnostics
- `node test-pusher.js 35425945` — raw Kick chat connection test.
- Kick blocks non-browser HTTP: to look up a chatroom ID for another channel, open `https://kick.com/api/v2/channels/CHANNELNAME` in a normal browser and read `"chatroom":{"id":…}`. (louay_cherni = channel `35714276`, chatroom `35425945`.)
