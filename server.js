// Ludo online server: rooms of 2-4 players, server rolls the dice and validates every move.
const http = require('http');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const E = require('./engine.js');

const PORT = process.env.PORT || 8080;
const TURN_MS = 25000;       // auto-play if a human is idle this long
const rooms = new Map();

const server = http.createServer((req, res) => { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('Ludo server OK\n'); });
const wss = new WebSocketServer({ server });

const rnd = () => crypto.randomInt(0, 1e9) / 1e9;
const send = (ws, o) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); };
function makeCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let c; do { c = ''; for (let i = 0; i < 4; i++) c += a[crypto.randomInt(0, a.length)]; } while (rooms.has(c)); return c; }

function lobbyInfo(r) {
  return { t: 'lobby', code: r.code, host: r.host, started: !!r.state,
    players: r.seats.map(p => p && { name: p.name, color: p.color, kind: p.kind, connected: !!p.ws || p.kind === 'bot' }) };
}
function broadcast(r, o) { r.seats.forEach(p => p && p.ws && send(p.ws, o)); }
function pushLobby(r) { r.seats.forEach((p, i) => p && p.ws && send(p.ws, Object.assign(lobbyInfo(r), { you: i }))); }

function stateSeatOfRoomSeat(r, color) { return r.state.players.findIndex(p => p.color === color); }

function schedule(r) {
  clearTimeout(r.timer);
  const s = r.state; if (!s || s.over) return;
  const pl = s.players[s.turn];
  const rs = r.seats.find(p => p && p.color === pl.color);
  const isBot = !rs || rs.kind === 'bot' || !rs.ws;
  const delay = isBot ? 900 : TURN_MS;
  r.timer = setTimeout(() => autoStep(r), delay);
}
function autoStep(r) {
  const s = r.state; if (!s || s.over) return;
  const rs = r.seats.find(p => p && p.color === s.players[s.turn].color);
  const isBot = !rs || rs.kind === 'bot' || !rs.ws;
  let ev = [];
  if (s.phase === 'roll') E.applyRoll(s, E.rollDie(rnd), ev);
  else E.applyMove(s, E.chooseMove(s, isBot ? 'normal' : 'easy', rnd), ev);
  broadcast(r, { t: 'ev', events: ev, state: s });
  schedule(r);
}

function seatOf(ws) { const r = rooms.get(ws.room); if (!r) return []; return [r, r.seats.findIndex(p => p && p.ws === ws)]; }

wss.on('connection', ws => {
  ws.isAlive = true; ws.on('pong', () => ws.isAlive = true);
  ws.on('message', raw => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'create') {
      const code = makeCode(); const color = E.PREF[0];
      const r = { code, host: 0, seats: [{ name: String(m.name || 'Player').slice(0, 12), color, kind: 'human', ws }], state: null, timer: null };
      rooms.set(code, r); ws.room = code; pushLobby(r); return;
    }
    if (m.t === 'join') {
      const r = rooms.get(String(m.code || '').toUpperCase());
      if (!r) return send(ws, { t: 'error', msg: 'Room not found' });
      if (r.state) return send(ws, { t: 'error', msg: 'Game already started' });
      if (r.seats.length >= 4) return send(ws, { t: 'error', msg: 'Room is full' });
      const color = E.PREF[r.seats.length];
      r.seats.push({ name: String(m.name || 'Player').slice(0, 12), color, kind: 'human', ws }); ws.room = r.code; pushLobby(r); return;
    }
    const [r, si] = seatOf(ws); if (!r || si < 0) return;
    if (m.t === 'start' && si === r.host && !r.state) {
      let n = Math.max(2, Math.min(4, +m.total || r.seats.length)); n = Math.max(n, r.seats.length);
      while (r.seats.length < n) { const c = E.PREF[r.seats.length]; r.seats.push({ name: 'Bot ' + E.COLORS[c], color: c, kind: 'bot', ws: null }); }
      r.state = E.newGame(r.seats.map(p => ({ color: p.color, name: p.name, kind: p.kind })));
      pushLobby(r); broadcast(r, { t: 'start', state: r.state }); schedule(r); return;
    }
    if (m.t === 'emote') { if (['😂','😡','👏','😈'].includes(m.e)) broadcast(r, { t: 'emote', color: r.seats[si].color, e: m.e }); return; }
    const s = r.state; if (!s || s.over) return;
    const mine = r.seats[si]; if (s.players[s.turn].color !== mine.color) return;
    let ev = [];
    if (m.t === 'roll' && s.phase === 'roll') E.applyRoll(s, E.rollDie(rnd), ev);
    else if (m.t === 'move' && s.phase === 'move') E.applyMove(s, m.i | 0, ev);
    else return;
    broadcast(r, { t: 'ev', events: ev, state: s }); schedule(r);
  });
  ws.on('close', () => {
    const r = rooms.get(ws.room); if (!r) return;
    const si = r.seats.findIndex(p => p && p.ws === ws); if (si < 0) return;
    if (!r.state) { // lobby: remove seat, re-colour the rest
      r.seats.splice(si, 1);
      if (!r.seats.length) { rooms.delete(r.code); return; }
      r.seats.forEach((p, i) => p.color = E.PREF[i]); r.host = 0;
    } else { r.seats[si].ws = null; r.seats[si].kind = 'bot'; r.seats[si].name += ' (bot)';
      if (!r.seats.some(p => p && p.ws)) { clearTimeout(r.timer); rooms.delete(r.code); return; } }
    pushLobby(r); if (r.state) schedule(r);
  });
});
setInterval(() => wss.clients.forEach(ws => { if (!ws.isAlive) return ws.terminate(); ws.isAlive = false; ws.ping(); }), 30000);
server.listen(PORT, () => console.log('Ludo server on', PORT));
