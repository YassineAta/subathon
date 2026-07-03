// Verify Kick Pusher WS: connection + subscribe protocol
const KEY = '32cbd69e4b950bf97679';
const chatroomId = process.argv[2] || '2';
const url = `wss://ws-us2.pusher.com/app/${KEY}?protocol=7&client=js&version=8.4.0&flash=false`;
const ws = new WebSocket(url);
let events = 0;
ws.onopen = () => console.log('WS_OPEN');
ws.onmessage = (ev) => {
  const raw = typeof ev.data === 'string' ? ev.data : ev.data.toString();
  const m = JSON.parse(raw);
  if (m.event === 'pusher:connection_established') {
    console.log('CONNECTION_ESTABLISHED', String(m.data).slice(0, 120));
    ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: `chatrooms.${chatroomId}.v2` } }));
  } else if (m.event === 'pusher_internal:subscription_succeeded') {
    console.log('SUBSCRIPTION_SUCCEEDED channel=' + m.channel);
  } else if (m.event === 'pusher:error') {
    console.log('PUSHER_ERROR', JSON.stringify(m.data));
  } else {
    events++;
    if (events <= 5) console.log('EVT', m.event, String(m.data).slice(0, 120));
  }
};
ws.onerror = (e) => console.log('WS_ERR', e.message || e.type);
ws.onclose = (e) => { console.log('WS_CLOSE', e.code); process.exit(0); };
setTimeout(() => { console.log('DONE events_seen=' + events); process.exit(0); }, 12000);
