# Kick Subathon Timer — louay_cherni

Counts Kick subs + gifted subs automatically and adds time to a countdown shown in OBS.
Big hours-left countdown, tiny `ENDS SAT 04/07 04:32` line under it.

## Option A — Hosted (easiest, no server)

OBS → Sources → **Browser** → URL **`https://yassineata.github.io/subathon/`**, size **900 × 280**.
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
| `!timer ping` | connection test — overlay flashes `CHAT OK ✓` |
| `!timer color 53fc18` | timer color (hex) · `!timer color reset` back to default |
| `!timer stroke 000000 3` | outline hex + width px · `!timer stroke 2` width only · `!timer stroke off` |

Keyboard fallback (right-click the source → Interact): `P` pause/resume, `+` / `−` = ±5 min.

URL params: `?size=120` bigger · `?subs=1` show sub count · `?ends=0` hide end date · `?rate=20` starting sub value · `?admins=name1,name2` extra allowed commanders · `?demo=1` style preview · `?channel=slug&chatroom=ID` other channel · `?color=53fc18` timer hex · `?stroke=000000&strokew=3` outline hex + px (chat commands override params) · `?bg=00b140` solid background for chroma key / browser preview (default: transparent — OBS shows whatever is behind it).

Note: subs are only counted while the overlay is open somewhere (OBS running). If OBS was closed when subs happened, add them with `!timer add`.

## Option B — Local server (control panel UI)

Fresh PC (no Node, no git needed):
1. Download **https://github.com/YassineAta/subathon/archive/refs/heads/main.zip** and extract it anywhere.
2. Double-click **start.bat** — it runs a preflight and fixes whatever is missing:
   app files (re-downloads from GitHub if deleted) → Node.js (auto-installs, accept the admin prompt) → stuck old instance on port 4025 (stops it) → updates (git installs). Then it starts the timer and opens the control panel. Keep the window open while streaming; it auto-restarts on crash.
3. OBS → Browser source → `http://127.0.0.1:4025/overlay`, size **900 × 280**.

Already connected to kick.com/louay_cherni out of the box. Full panel: rate, cap, pause, exact set, custom **± minutes** slot, **timer color + stroke hex** (live preview strip, applies mid-stream without touching OBS), simulate buttons, **live chat feed**, event log. State in `state.json`.
Overlay params: `?size=120` · `?subs=1` · `?ends=0` · `?demo=1` · `?bg=00b140` solid bg for chroma key / browser preview (color/stroke come from the panel, not the URL).

### Pre-stream check (local panel, ~30 s)
1. Dot top-right is **green** — server is subscribed to the Kick chatroom.
2. Type anything in your own Kick chat → it appears in **LIVE CHAT** within ~2 s. Sub events arrive on that exact same connection, so chat visible = subs visible.
3. **Simulate 1 sub** → overlay pulses `+15 MIN`, countdown jumps, log shows `[test] … → +15 min`.
4. If the connection ever drops mid-stream, the overlay shows a small red `CHAT RECONNECTING` and recovers by itself; real sub events that Kick delivers after reconnect are counted normally.

Command-line equivalent:
```
git clone https://github.com/YassineAta/subathon
cd subathon
start.bat
```
Manual Node install if you ever need it: `winget install -e --id OpenJS.NodeJS.LTS`

Use ONE option at a time (A and B keep separate states).

## Caching — why it won't bite mid-stream
- The local overlay/panel are served with `Cache-Control: no-store` — OBS always loads the current files, never a stale copy.
- The timer itself never depends on any browser cache: local version keeps state in `state.json` on disk (atomic writes); hosted version keeps it in OBS's own storage.
- If a browser source ever looks frozen: right-click it → **Refresh cache of current page**.
- Hosted version only: after a code update is pushed, GitHub Pages can serve the previous version for ~10 min.

## Diagnostics
- `node test-pusher.js 35425945` — raw Kick chat connection test.
- Kick blocks non-browser HTTP: to look up a chatroom ID for another channel, open `https://kick.com/api/v2/channels/CHANNELNAME` in a normal browser and read `"chatroom":{"id":…}`. (louay_cherni = channel `35714276`, chatroom `35425945`.)
