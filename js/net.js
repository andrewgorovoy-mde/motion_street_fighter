'use strict';
/* =========================================================================
   SKYBREAK — online play transport (two laptops, peer-to-peer over WebRTC).
   The host's game is the source of truth: it simulates both fighters and sends
   ~30 state snapshots a second. The guest sends its inputs and draws what the
   host sends. Matchmaking uses the free PeerJS cloud with a 5-letter room code.
   ========================================================================= */
const Net = {
  role: null, peer: null, conn: null, code: '', connected: false, active: false,
  meReady: false, themReady: false, themCh: null,
  lastIn: { mx: 0, my: 0, guard: false, charge: false }, snap: null, snapNew: false,
  sendT: 0, inT: 0, onStatus: null, onMsg: null,
};
const PEER_PREFIX = 'skybreak-v2-';

function peerOpts() {
  const o = { debug: 1, config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:stun.cloudflare.com:3478' }] } };
  if (window.SKY_PEER) Object.assign(o, window.SKY_PEER);   // optional: your own PeerJS / TURN servers
  return o;
}
function netCode() { const A = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 5; i++) s += A[(Math.random() * A.length) | 0]; return s; }
function netStatus(kind, msg) { Net.onStatus && Net.onStatus(kind, msg); }

function netHost() {
  netClose();
  if (!window.Peer) { netStatus('error', 'The online play library didn’t load. Check your internet connection and reload.'); return; }
  Net.role = 'host'; Net.code = netCode();
  netStatus('opening', 'Opening a room…');
  Net.peer = new Peer(PEER_PREFIX + Net.code, peerOpts());
  Net.peer.on('open', () => netStatus('waiting', ''));
  Net.peer.on('connection', c => {
    if (Net.conn && Net.conn.open) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 400); }); return; }
    netWire(c);
  });
  Net.peer.on('error', e => {
    if (e.type === 'unavailable-id') { netHost(); return; }
    netStatus('error', `Couldn’t open a room (${e.type || e.message}).`);
  });
  Net.peer.on('disconnected', () => { try { if (!Net.peer.destroyed) Net.peer.reconnect(); } catch (e) { /* ignore */ } });
}

function netJoin(code) {
  netClose();
  if (!window.Peer) { netStatus('error', 'The online play library didn’t load. Check your internet connection and reload.'); return; }
  Net.role = 'guest'; Net.code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  netStatus('opening', `Looking for room ${Net.code}…`);
  Net.peer = new Peer(undefined, peerOpts());
  Net.peer.on('open', () => netWire(Net.peer.connect(PEER_PREFIX + Net.code, { reliable: true, serialization: 'json' })));
  Net.peer.on('error', e => netStatus('error', e.type === 'peer-unavailable'
    ? `No room called ${Net.code}. Check the code, and make sure the host still has the game open.`
    : `Couldn’t connect (${e.type || e.message}).`));
  setTimeout(() => { if (Net.role === 'guest' && !Net.connected && Net.peer) netStatus('error', 'Still can’t reach the host. Some school or office networks block direct connections between laptops. Try a home network or a phone hotspot.'); }, 15000);
}

function netWire(c) {
  Net.conn = c;
  c.on('open', () => { Net.connected = true; netStatus('connected', ''); Net.onMsg && Net.onMsg({ t: '_open' }); });
  c.on('data', d => { if (d && d.t) Net.onMsg && Net.onMsg(d); });
  c.on('close', () => {
    const was = Net.connected;
    Net.connected = false; Net.meReady = Net.themReady = false;
    if (was) { netStatus('closed', 'Your rival disconnected.'); Net.onMsg && Net.onMsg({ t: '_closed' }); }
  });
  c.on('error', () => { /* surfaced through close */ });
}
function netSend(o) { if (Net.conn && Net.conn.open) { try { Net.conn.send(o); } catch (e) { /* dropped */ } } }
function netClose() {
  try { Net.conn && Net.conn.close(); } catch (e) { /* ignore */ }
  try { Net.peer && Net.peer.destroy(); } catch (e) { /* ignore */ }
  Object.assign(Net, { peer: null, conn: null, connected: false, active: false, meReady: false, themReady: false, role: null, snap: null, themCh: null });
}
