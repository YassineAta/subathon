'use strict';
// Kick Subathon Timer — zero-dependency local server (Node >= 22)
// Overlay:  http://127.0.0.1:4025/overlay   (OBS browser source)
// Control:  http://127.0.0.1:4025/

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

if (typeof WebSocket === 'undefined' || typeof fetch === 'undefined') {
  console.error('\nThis needs Node.js 22 or newer. Run start.bat to auto-install,');
  console.error('or manually: winget install -e --id OpenJS.NodeJS.LTS\n');
  process.exit(1);
}

const PORT = 4025;
const STATE_FILE = path.join(__dirname, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PUSHER_KEY = '32cbd69e4b950bf97679';
const PUSHER_URL = `wss://ws-us2.pusher.com/app/${PUSHER_KEY}?protocol=7&client=js&version=8.4.0&flash=false`;

// ---------- state ----------
const defaultState = {
  channelSlug: 'louay_cherni',
  chatroomId: 35425945,
  status: 'idle', // idle | running | paused | ended
  endsAt: null, // epoch ms, only meaningful while running
  remainingMs: 0, // authoritative while idle/paused
  startedAt: null,
  subCount: 0,
  totalMinutesFromSubs: 0,
  minutesPerSub: 15,
  capMinutes: 0, // 0 = no cap on remaining time
  acceptWhenEnded: false, // subs after 00:00:00 restart the timer
  log: [],
};
let state = { ...defaultState };
try {
  const loaded = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  state = { ...defaultState, ...loaded };
} catch {}
// If the timer expired while the server was off, wall clock still counted.
if (state.status === 'running' && (!state.endsAt || state.endsAt <= Date.now())) {
  state.status = 'ended';
  state.endsAt = null;
  state.remainingMs = 0;
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = STATE_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
      fs.renameSync(tmp, STATE_FILE);
    } catch (e) {
      console.error('save failed:', e.message);
    }
  }, 200);
}

function log(text) {
  state.log.push({ t: Date.now(), m: text });
  if (state.log.length > 300) state.log = state.log.slice(-300);
  console.log(new Date().toLocaleTimeString(), '|', text);
}

// ---------- timer core ----------
function remainingNow() {
  if (state.status === 'running') return Math.max(0, state.endsAt - Date.now());
  return Math.max(0, state.remainingMs || 0);
}

function applyCap(ms) {
  return state.capMinutes > 0 ? Math.min(ms, state.capMinutes * 60000) : ms;
}

function endTimer(reason) {
  state.status = 'ended';
  state.endsAt = null;
  state.remainingMs = 0;
  log(`Timer ended (${reason})`);
}

// Add (or remove, ms<0) time. Handles every status.
function addMs(ms) {
  const rem = applyCap(Math.max(0, remainingNow() + ms));
  if (state.status === 'running') {
    state.endsAt = Date.now() + rem;
    if (rem === 0) endTimer('time removed');
  } else if (state.status === 'ended') {
    if (rem > 0) {
      state.status = 'running';
      state.endsAt = Date.now() + rem;
      log('Timer restarted by added time');
    }
  } else {
    state.remainingMs = rem; // idle or paused
  }
}

// ---------- sub handling ----------
const recentKeys = new Map(); // dedupe key -> ts
function isDupe(key) {
  const now = Date.now();
  for (const [k, t] of recentKeys) if (now - t > 8000) recentKeys.delete(k);
  if (recentKeys.has(key)) return true;
  recentKeys.set(key, now);
  return false;
}

function onSubs(username, count, kind, skipDedupe) {
  count = Math.max(1, count | 0);
  if (!skipDedupe) {
    const key = kind === 'gift' ? `g:${username}:${count}` : `s:${String(username).toLowerCase()}`;
    if (isDupe(key)) return;
  }
  if (state.status === 'idle') {
    log(`Sub from ${username} ignored (timer not started)`);
    save();
    broadcast();
    return;
  }
  if (state.status === 'ended' && !state.acceptWhenEnded) {
    log(`Sub from ${username} ignored (timer already ended)`);
    save();
    broadcast();
    return;
  }
  const mins = state.minutesPerSub * count;
  state.subCount += count;
  state.totalMinutesFromSubs += mins;
  addMs(mins * 60000);
  const label =
    kind === 'gift'
      ? `${username} gifted ${count} sub${count > 1 ? 's' : ''} → +${mins} min`
      : kind === 'sim'
        ? `[test] ${username} → +${mins} min`
        : `${username} subscribed → +${mins} min`;
  log(label);
  save();
  broadcast({ burst: { username, count, minutes: mins } });
}

// ---------- Kick (Pusher) connection ----------
let kws = null;
let kickStatus = 'off'; // off | connecting | connected
let wsGen = 0;
let lastActivity = 0;
let lastChatAt = null;
let backoff = 1000;
let reconnectTimer = null;
const unknownLogged = new Map();

const IGNORED_EVENTS = new Set([
  'App\\Events\\ChatMessageEvent',
  'App\\Events\\MessageDeletedEvent',
  'App\\Events\\UserBannedEvent',
  'App\\Events\\UserUnbannedEvent',
  'App\\Events\\PinnedMessageCreatedEvent',
  'App\\Events\\PinnedMessageDeletedEvent',
  'App\\Events\\PollUpdateEvent',
  'App\\Events\\PollDeleteEvent',
  'App\\Events\\ChatroomUpdatedEvent',
  'App\\Events\\ChatroomClearEvent',
  'App\\Events\\StreamHostEvent',
  'App\\Events\\GiftsLeaderboardUpdated',
  'pusher_internal:subscription_succeeded',
  'pusher:pong',
  'pusher:ping',
]);

function kickConnect() {
  clearTimeout(reconnectTimer);
  if (!state.chatroomId) {
    kickStatus = 'off';
    return;
  }
  const gen = ++wsGen;
  try {
    if (kws) {
      kws.onclose = null;
      kws.onmessage = null;
      kws.close();
    }
  } catch {}
  kickStatus = 'connecting';
  broadcast();
  kws = new WebSocket(PUSHER_URL);
  kws.onopen = () => {
    lastActivity = Date.now();
  };
  kws.onmessage = (ev) => {
    if (gen !== wsGen) return;
    lastActivity = Date.now();
    const raw = typeof ev.data === 'string' ? ev.data : ev.data.toString();
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    handleKickEvent(msg);
  };
  kws.onclose = () => {
    if (gen !== wsGen) return;
    kickStatus = 'off';
    broadcast();
    scheduleReconnect();
  };
  kws.onerror = () => {};
}

function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  log(`Kick connection lost — retrying in ${Math.round(backoff / 1000)}s`);
  reconnectTimer = setTimeout(kickConnect, backoff);
  backoff = Math.min(backoff * 2, 30000);
}

function handleKickEvent(msg) {
  const name = msg.event || '';
  let data = msg.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = {};
    }
  }
  data = data || {};

  if (name === 'pusher:connection_established') {
    kws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${state.chatroomId}.v2` } }));
    return;
  }
  if (name === 'pusher:ping') {
    kws.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
    return;
  }
  if (name === 'pusher_internal:subscription_succeeded') {
    kickStatus = 'connected';
    backoff = 1000;
    log(`Connected to Kick chat (chatroom ${state.chatroomId})`);
    save();
    broadcast();
    return;
  }
  if (name === 'pusher:error') {
    log(`Kick/Pusher error: ${JSON.stringify(data).slice(0, 160)}`);
    return;
  }

  if (name === 'App\\Events\\ChatMessageEvent') {
    lastChatAt = Date.now();
    return;
  }
  if (name === 'App\\Events\\SubscriptionEvent') {
    onSubs(data.username || 'someone', 1, 'sub');
    return;
  }
  if (name === 'App\\Events\\GiftedSubscriptionsEvent') {
    const names = Array.isArray(data.gifted_usernames) ? data.gifted_usernames : [];
    const gifter = data.gifter_username || 'someone';
    const key = `g:${gifter}:${names.slice().sort().join(',') || names.length}`;
    if (isDupe(key)) return;
    onSubs(gifter, names.length || 1, 'gift', true);
    return;
  }

  // Unknown event discovery: surface new event types (e.g. Kicks/donations)
  // in the panel log, max once per 10 min per event type.
  if (!IGNORED_EVENTS.has(name) && name) {
    const last = unknownLogged.get(name) || 0;
    if (Date.now() - last > 600000) {
      unknownLogged.set(name, Date.now());
      log(`Kick event seen: ${name} ${JSON.stringify(data).slice(0, 140)}`);
      save();
      broadcast();
    }
  }
}

// Keepalive: ping if quiet 60s, force reconnect if dead 3 min.
setInterval(() => {
  if (!kws || kws.readyState !== 1) return;
  const quiet = Date.now() - lastActivity;
  if (quiet > 180000) {
    try {
      kws.close();
    } catch {}
  } else if (quiet > 60000) {
    try {
      kws.send(JSON.stringify({ event: 'pusher:ping', data: {} }));
    } catch {}
  }
}, 30000);

// ---------- SSE ----------
const clients = new Set();

function publicState(extra) {
  return {
    status: state.status,
    remainingMs: remainingNow(),
    endsAt: state.status === 'running' ? state.endsAt : null,
    subCount: state.subCount,
    totalMinutesFromSubs: state.totalMinutesFromSubs,
    minutesPerSub: state.minutesPerSub,
    capMinutes: state.capMinutes,
    acceptWhenEnded: state.acceptWhenEnded,
    channelSlug: state.channelSlug,
    chatroomId: state.chatroomId,
    startedAt: state.startedAt,
    kick: kickStatus,
    lastChatAt,
    serverNow: Date.now(),
    log: state.log.slice(-40),
    ...extra,
  };
}

function broadcast(extra) {
  const payload = `data: ${JSON.stringify(publicState(extra))}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {}
  }
}

// Tick: detect natural end + periodic refresh.
let tickN = 0;
setInterval(() => {
  if (state.status === 'running' && state.endsAt <= Date.now()) {
    endTimer('countdown reached zero');
    save();
    broadcast();
  }
  if (++tickN % 5 === 0) broadcast();
  if (tickN % 15 === 0) for (const res of clients) {
    try {
      res.write(':ka\n\n');
    } catch {}
  }
}, 1000);

// ---------- HTTP ----------
function readBody(req) {
  return new Promise((resolve, reject) => {
    let buf = '';
    req.on('data', (c) => {
      buf += c;
      if (buf.length > 100000) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveFile(res, name) {
  fs.readFile(path.join(PUBLIC_DIR, name), (err, buf) => {
    if (err) {
      res.writeHead(404);
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (req.method === 'GET') {
    if (p === '/' || p === '/control') return serveFile(res, 'control.html');
    if (p === '/overlay') return serveFile(res, 'overlay.html');
    if (p === '/api/state') return sendJson(res, 200, publicState());
    if (p === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      res.write(`data: ${JSON.stringify(publicState())}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    res.writeHead(404);
    return res.end('not found');
  }

  if (req.method !== 'POST') {
    res.writeHead(405);
    return res.end();
  }

  let body;
  try {
    body = await readBody(req);
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }

  const num = (v, lo, hi) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null;
  };

  try {
    switch (p) {
      case '/api/start': {
        const mins = num(body.minutes, 0.1, 100000);
        if (mins === null) return sendJson(res, 400, { error: 'minutes required' });
        state.status = 'running';
        state.startedAt = Date.now();
        state.endsAt = Date.now() + mins * 60000;
        state.remainingMs = 0;
        state.subCount = 0;
        state.totalMinutesFromSubs = 0;
        log(`Subathon started with ${mins} min`);
        break;
      }
      case '/api/pause': {
        if (state.status === 'running') {
          state.remainingMs = remainingNow();
          state.status = 'paused';
          state.endsAt = null;
          log('Timer paused');
        }
        break;
      }
      case '/api/resume': {
        if (state.status === 'paused') {
          state.status = 'running';
          state.endsAt = Date.now() + state.remainingMs;
          state.remainingMs = 0;
          log('Timer resumed');
        }
        break;
      }
      case '/api/adjust': {
        const mins = num(body.minutes, -100000, 100000);
        if (mins === null || mins === 0) return sendJson(res, 400, { error: 'minutes required' });
        addMs(mins * 60000);
        log(`Manual time: ${mins > 0 ? '+' : ''}${mins} min`);
        break;
      }
      case '/api/set': {
        const mins = num(body.minutes, 0, 100000);
        if (mins === null) return sendJson(res, 400, { error: 'minutes required' });
        if (state.status === 'running' || state.status === 'ended') {
          if (mins === 0) {
            endTimer('set to zero');
          } else {
            state.status = 'running';
            state.endsAt = Date.now() + mins * 60000;
            state.remainingMs = 0;
          }
        } else {
          state.remainingMs = mins * 60000;
        }
        log(`Remaining time set to ${mins} min`);
        break;
      }
      case '/api/end': {
        endTimer('ended manually');
        break;
      }
      case '/api/reset': {
        state.status = 'idle';
        state.endsAt = null;
        state.remainingMs = 0;
        state.startedAt = null;
        state.subCount = 0;
        state.totalMinutesFromSubs = 0;
        log('Timer reset');
        break;
      }
      case '/api/config': {
        if (body.minutesPerSub !== undefined) {
          const v = num(body.minutesPerSub, 0, 1440);
          if (v !== null && v !== state.minutesPerSub) {
            state.minutesPerSub = v;
            log(`Sub value set to ${v} min`);
          }
        }
        if (body.capMinutes !== undefined) {
          const v = num(body.capMinutes, 0, 1000000);
          if (v !== null && v !== state.capMinutes) {
            state.capMinutes = v;
            log(v > 0 ? `Max remaining capped at ${v} min` : 'Time cap removed');
          }
        }
        if (body.acceptWhenEnded !== undefined) {
          state.acceptWhenEnded = !!body.acceptWhenEnded;
        }
        if (body.channelSlug !== undefined) {
          state.channelSlug = String(body.channelSlug).trim().toLowerCase();
        }
        if (body.chatroomId !== undefined) {
          const v = num(body.chatroomId, 1, 1e12);
          if (v !== null && v !== state.chatroomId) {
            state.chatroomId = Math.round(v);
            log(`Chatroom id set to ${state.chatroomId} — connecting…`);
            backoff = 1000;
            save();
            kickConnect();
          }
        }
        break;
      }
      case '/api/simulate': {
        const count = num(body.count, 1, 500) || 1;
        onSubs('test_' + Math.random().toString(36).slice(2, 6), count, 'sim', true);
        return sendJson(res, 200, { ok: true });
      }
      default:
        return sendJson(res, 404, { error: 'unknown endpoint' });
    }
    save();
    broadcast();
    return sendJson(res, 200, { ok: true });
  } catch (e) {
    return sendJson(res, 500, { error: e.message });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use — is the timer already running?`);
    console.error('Close the other window, or edit PORT in server.js.\n');
    process.exit(1);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('');
  console.log('  Subathon Timer running');
  console.log(`  Overlay (add to OBS):  http://127.0.0.1:${PORT}/overlay`);
  console.log(`  Control panel:         http://127.0.0.1:${PORT}/`);
  console.log('');
  if (state.chatroomId) kickConnect();
  else console.log('  No Kick channel configured yet — open the control panel to set it up.');
  if (process.argv.includes('--open')) exec(`start "" "http://127.0.0.1:${PORT}/"`);
});

process.on('SIGINT', () => {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {}
  process.exit(0);
});
