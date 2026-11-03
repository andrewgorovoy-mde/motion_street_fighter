'use strict';
/* =========================================================================
   SKYBREAK — game: state, combat, moves, AI, cutscenes, input, HUD, menus
   ========================================================================= */
const $ = s => document.querySelector(s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const DISPLAY = '"Bungee", Impact, "Arial Black", sans-serif';
const UIF = '"Chakra Petch", "Arial Narrow", sans-serif';

const WORLD = { w: 2400, ground: 1120, top: 60 };
const cfg = { diff: 'normal', training: false, track: 'fast', move: 'auto', stage: 0, music: -1, sens: 1, bodySens: 1, hints: true };
const DIFF = {
  easy:   { think: [0.7, 1.2],   block: 0.2, vanish: 0.12, aggr: 0.45, dmg: 0.55, spec: 0.5 },
  normal: { think: [0.42, 0.78], block: 0.4, vanish: 0.3, aggr: 0.75, dmg: 0.8, spec: 0.75 },
  hard:   { think: [0.22, 0.45], block: 0.6, vanish: 0.55, aggr: 1, dmg: 1.05, spec: 1 },
};

/* ---------------- canvas ---------------- */
const cv = $('#game'), ctx = cv.getContext('2d');
function resize() {
  R2.DPR = Math.min(window.devicePixelRatio || 1, 2); R2.W = innerWidth; R2.H = innerHeight;
  cv.width = Math.round(R2.W * R2.DPR); cv.height = Math.round(R2.H * R2.DPR);
  buildStage(STAGES[cfg.stage]);
}
addEventListener('resize', resize);
const W = () => R2.W, H = () => R2.H;

/* ---------------- state ---------------- */
let mode = 'menu', inputMode = 'keys', selIdx = 0;
let P = null, E = null;
let time = 0, gameT = 0, clockT = 99, introT = 0, koT = 0, slowmo = 0, shake = 0, impactT = 0, koWin = false, timeout = false;
let proj = [], beams = [], ents = [], parts = [], timers = [], banners = [], texts = [], ghosts = [];
let cine = null;
const camera = { x: 1200, y: 800, z: 0.6 };
const keys = {};
const stats = {};
const AI = { think: 0, guardT: 0, chargeT: 0, burst: 0, wantD: 380, yOff: 0 };
const pad = { connected: false, x: 0, y: 0, pressed: new Set(), lastT: 0, url: null };

const other = f => (f === P ? E : P);
const fsize = f => f.ch.size * 1.08 * (1 + f.form * 0.04);
const center = f => ({ x: f.x, y: f.y - 38 * fsize(f) });
function handPos(f, joint = 'fh', pose) { const p = POSES[pose || f.pose] || POSES.idle, S = fsize(f); return { x: f.x + f.face * p[joint][0] * S, y: f.y + p[joint][1] * S }; }
function aimAng(from, o) { const c = center(o); return Math.atan2(c.y - from.y, c.x - from.x); }
function later(t, fn) { timers.push({ t, fn }); }
function addEnt(e) { e.t = 0; ents.push(e); return e; }
let projSeq = 0;
const NETG = () => Net.active && Net.role === 'guest';
const NETH = () => Net.active && Net.role === 'host';
const whoOf = f => (f === P) === (Net.role !== 'guest') ? 'h' : 'g';          // 'h' = host's fighter
const byWho = w => (w === 'h') === (Net.role !== 'guest') ? P : E;
function spawnProj(o) { if (NETG()) return; proj.push(Object.assign({ id: ++projSeq, life: 2.5, r: 12, dmg: 3, kind: 'blast', speed: 0, t: 0 }, o)); }
function note(msg, ms = 1700) { const el = $('#toast'); el.textContent = msg; el.hidden = false; clearTimeout(note._t); note._t = setTimeout(() => el.hidden = true, ms); }
function banner(text, col, side) {
  banners.push({ text, col, side, t: 0 });
  if (NETH()) netSend({ t: 'bn', text, col, side: side === 'left' ? 'right' : side === 'right' ? 'left' : side });
}
function fnote(f, msg) { if (f === P) note(msg); else if (NETH() && f === E) netSend({ t: 'note', msg }); }
function addText(txt, col, size, x, y, world = false) { texts.push({ txt, col, size, x, y, world, t: 0 }); if (texts.length > 14) texts.shift(); }
function addParts(x, y, n, col, speed = 400, life = 0.5, size = 4) {
  for (let i = 0; i < n; i++) { const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random()); parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, col, size: size * (0.5 + Math.random()) }); }
}
const auraCol = f => f.ch.c.aura[f.form];
const aura2Col = f => f.ch.c.aura2[f.form];

function makeFighter(ch, x, face, cpu) {
  return { ch, x, y: WORLD.ground - 320, vx: 0, vy: 0, face, hp: 100, ki: 40, surge: 0, form: 0,
    state: 'idle', st: 0, castPose: 'castF', pj: clonePose('idle'), pose: 'idle', punchAlt: false, combo: 0, lastMelee: -9, queued: 0,
    guard: false, charging: false, armor: false, cpu, hidden: false, flash: 0, inX: 0, inY: 0, inGuard: false, inCharge: false,
    blastCD: 0, tilt: 0, koRot: 0, auraT: 0, burn: 0, slow: 0, frozen: 0, phase: 0, reflect: 0, dome: 0, exposed: 0, invuln: 0,
    tpCD: 0, lastPunchT: -9, chargeHold: 0, trapped: 0, shakeX: 0, dashHit: false };
}
const canAct = f => mode === 'fight' && !cine && (f.state === 'idle' || f.state === 'punch') && f.frozen <= 0 && f.trapped <= 0;

/* ---------------- fight lifecycle ---------------- */
function startFight(o = {}) {
  const ch = CHARS[selIdx];
  const others = CHARS.filter((_, i) => i !== selIdx);
  const ech = o.eIdx !== undefined ? CHARS[o.eIdx] : others[(Math.random() * others.length) | 0];
  Net.active = !!o.net;
  const right = !!o.guestSide;
  P = makeFighter(ch, right ? 1700 : 700, right ? -1 : 1, false);
  E = makeFighter(ech, right ? 700 : 1700, right ? 1 : -1, !Net.active);
  if (cfg.training && !Net.active) E.ki = 0;
  if (o.stage !== undefined) cfg.stage = o.stage;
  Net.snap = null; Net.lastIn = { mx: 0, my: 0, guard: false, charge: false };
  proj = []; beams = []; ents = []; parts = []; timers = []; banners = []; texts = []; ghosts = [];
  Object.assign(stats, { punches: 0, landed: 0, specials: 0, blocked: 0, dealt: 0, taken: 0, best: 0, perfect: 0, forms: 0 });
  Object.assign(AI, { think: 1, guardT: 0, chargeT: 0, burst: 0 });
  clockT = 99; gameT = 0; slowmo = 0; shake = 0; impactT = 0; timeout = false;
  camera.x = 1200; camera.y = 820; camera.z = H() / 900;
  buildStage(STAGES[cfg.stage]);
  trackSetBinds(ch);
  Track.events.length = 0;
  setupHud();
  ['#menu', '#result', '#setup'].forEach(s => $(s).hidden = true);
  $('#hud').hidden = true; $('#tray').hidden = true;
  $('#pip').hidden = inputMode !== 'cam'; $('#pip').classList.remove('big');
  if (Music.idx !== (cfg.music >= 0 ? cfg.music : STAGES[cfg.stage].track) && Snd.ac) musicPlay(cfg.music >= 0 ? cfg.music : STAGES[cfg.stage].track);
  Music.intensity = 0.6;
  mode = 'vs'; cine = { type: 'vs', t: 0, dur: 2.8 };
  sfx.cutin();
}
function endFight(win, how) {
  if (NETH()) netSend({ t: 'end', hw: win, to: timeout, hh: Math.round(P.hp), gh: Math.round(E.hp), gt: Math.round(gameT) });
  mode = 'over';
  $('#resKicker').textContent = how;
  $('#resTitle').textContent = win ? `${P.ch.name} wins` : `${E.ch.name} wins`;
  const acc = stats.punches ? Math.round(100 * stats.landed / stats.punches) : 0;
  const rows = [[stats.punches, 'Punches & blasts'], [acc + '%', 'Hit rate'], [stats.specials, 'Specials'], [stats.best, 'Best combo'],
    [stats.perfect, 'Perfect vanishes'], [FORM_NAMES[P.form], 'Highest form'], [Math.round(stats.dealt), 'Damage dealt'], [Math.round(stats.taken), 'Damage taken']];
  $('#resStats').innerHTML = rows.map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
  $('#result').hidden = false; $('#btnAgain').focus();
  Music.intensity = 0.4;
}

/* ---------------- damage ---------------- */
function hit(t, src, dmg, o = {}) {
  if (NETG() || !t || t.state === 'ko' || t.hidden || t.phase > 0 || t.invuln > 0 || mode !== 'fight') return false;
  const c = center(t);
  if (t.dome > 0 && o.kind !== 'pierce') { dmg *= 0.15; addParts(c.x, c.y, 6, '#ffe08a', 300, 0.3, 3); }
  dmg *= (0.85 + 0.3 * src.ch.stats.power) * FORM_MULT[src.form].dmg;
  dmg *= t.ch.stats.defense * FORM_MULT[t.form].def;
  if (src.cpu) dmg *= DIFF[cfg.diff].dmg;
  if (t.exposed > 0) dmg *= 1.3;
  const blocked = t.guard && t.frozen <= 0;
  if (blocked) {
    dmg *= o.kind === 'beam' ? 0.35 : o.kind === 'heavy' ? 0.5 : o.kind === 'pierce' ? 0.6 : 0.2;
    t.vx += Math.sign(o.kx || src.face) * 160;
    addParts(c.x - t.face * 20, c.y - 10, 6, '#cfe8ff', 300, 0.25, 3);
    if (!o.quiet) sfx.block();
    if (t === P) stats.blocked++;
  } else {
    const bedrock = t.ch.id === 'gorran' && (o.kind === 'melee' || o.kind === 'blast') && dmg < 7;
    if (!t.armor && !bedrock && t.frozen <= 0) { t.state = 'hurt'; t.st = o.stun ?? 0.3; t.vx = o.kx || 0; t.vy = o.ky || 0; t.charging = false; t.guard = false; }
    t.flash = 0.12;
    addParts(c.x, c.y, o.kind === 'heavy' ? 24 : 10, '#fff3c0', o.kind === 'heavy' ? 750 : 450, 0.35, 4);
    shake = Math.max(shake, o.kind === 'heavy' ? 0.6 : 0.18);
    if (o.kind === 'heavy' && !o.quiet) impactT = 0.07;
    // passives
    if (src.ch.id === 'ember' && o.el === 'fire') t.burn = 2;
    if (src.ch.id === 'mira' && o.special) t.slow = Math.max(t.slow, 1.4);
    if (src.ch.id === 'vex') { const s = Math.min(t.ki, dmg * 0.6); t.ki -= s; src.ki = Math.min(100, src.ki + s); }
  }
  t.hp = Math.max(0, t.hp - dmg);
  src.ki = Math.min(100, src.ki + dmg * 0.5); t.ki = Math.min(100, t.ki + dmg * 0.3);
  src.surge = Math.min(100, src.surge + dmg * 1.1); t.surge = Math.min(100, t.surge + dmg * 1.3);
  if (src === P) stats.dealt += dmg; else stats.taken += dmg;
  if (dmg >= 2 && !o.quiet) addText(String(Math.round(dmg)), blocked ? '#9fb6c8' : (dmg > 12 ? '#ffd23a' : '#ffffff'), dmg > 12 ? 1 : 0.6, c.x + rand(-20, 20), c.y - 50, true);
  if (cfg.training && t === E && t.hp < 5) t.hp = 100;
  if (NETH()) netSend({ t: 'fx', x: Math.round(c.x), y: Math.round(c.y), d: Math.round(dmg * 10) / 10, bl: blocked ? 1 : 0, hv: o.kind === 'heavy' ? 1 : 0, q: o.quiet ? 1 : 0, tw: whoOf(t) });
  if (t.hp <= 0) knockout(t, src);
  return !blocked;
}
function knockout(t, src) {
  t.state = 'ko'; t.vx = src.face * 650; t.vy = -520; t.hidden = false; t.guard = t.charging = false; t.frozen = 0; t.trapped = 0;
  mode = 'ko'; koT = 3.2; slowmo = 1.6; shake = 0.9; impactT = 0.12; koWin = t === E;
  banner('K.O.!', '#ff4f6d', 'center'); sfx.ko();
  if (NETH()) netSend({ t: 'ko', who: whoOf(t) });
}

/* ---------------- teleports ---------------- */
function snapshot(f) { const pj = {}; for (const k of JOINTS) pj[k] = [...f.pj[k]]; return { x: f.x, y: f.y, face: f.face, size: fsize(f), tilt: f.tilt, pj }; }
function threatened(f) {
  const o = other(f), c = center(f);
  if (proj.some(p => p.owner === o && Math.hypot(p.x - c.x, p.y - c.y) < 320 && ((c.x - p.x) * p.vx + (c.y - p.y) * p.vy) > 0)) return true;
  if (beams.some(b => b.owner === o && b.ox !== undefined && segDist(c.x, c.y, b.ox, b.oy, b.ox + Math.cos(b.ang) * b.len, b.oy + Math.sin(b.ang) * b.len) < b.w + 80)) return true;
  if (o.state === 'punch' && Math.abs(o.x - f.x) < 190 && Math.abs(o.y - f.y) < 130) return true;
  if (ents.some(e => e.danger && e.owner === o && e.danger(e, f))) return true;
  return false;
}
function tpCost(f, base) { return f.ch.id === 'kaze' ? 0 : base; }
function teleport(f, x, y) {
  ghosts.push({ s: snapshot(f), col: auraCol(f), t: 0 });
  const ox = f.x, oy = f.y;
  f.x = clamp(x, 100, WORLD.w - 100); f.y = clamp(y, WORLD.top + 160, WORLD.ground - 70 * f.ch.size);
  f.invuln = 0.22; f.vx *= 0.2; f.vy *= 0.2;
  fxStreak(ox, oy - 40, f.x, f.y - 40, auraCol(f));
  sfx.zip();
  if (NETH()) netSend({ t: 'tp', who: whoOf(f), x1: Math.round(ox), y1: Math.round(oy), x2: Math.round(f.x), y2: Math.round(f.y) });
}
function fxStreak(x1, y1, x2, y2, col) { addEnt({ dur: 0.25, draw: (e, c) => { c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = 1 - e.t / e.dur; c.strokeStyle = col; c.lineWidth = 14 * (1 - e.t / e.dur); c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); c.restore(); } }); }
function teleOk(f, cost) {
  if (mode !== 'fight' || cine || f.tpCD > 0 || f.frozen > 0 || f.trapped > 0 || f.state === 'cast' || f.state === 'dash' || f.state === 'ko') return false;
  if (f.ki < cost) { fnote(f, `Teleporting needs ${cost} ki`); return false; }
  return true;
}
function doVanish(f) {
  const o = other(f), cost = tpCost(f, f.state === 'hurt' ? 22 : 12);
  if (!teleOk(f, cost)) return;
  f.ki -= cost; f.tpCD = 0.45;
  const perfect = threatened(f);
  const dir = Math.sign(f.x - o.x) || 1;
  let nx = f.x + dir * rand(320, 440);
  if (nx < 140 || nx > WORLD.w - 140) nx = o.x - dir * 360;
  f.state = 'idle'; f.st = 0;
  teleport(f, nx, clamp(o.y + rand(-220, 140), 200, WORLD.ground - 90));
  if (perfect) {
    f.ki = Math.min(100, f.ki + 15); f.surge = Math.min(100, f.surge + 12); o.exposed = 1.1;
    slowmo = Math.max(slowmo, 0.45); sfx.perfect();
    addText('PERFECT VANISH', '#8affd6', 1.1, W() / 2, H() * 0.3);
    if (NETH()) netSend({ t: 'txt', txt: 'PERFECT VANISH', col: '#8affd6', size: 1.1 });
    if (f === P) stats.perfect++;
  }
}
function doRush(f) {
  const o = other(f), cost = tpCost(f, 15);
  if (!teleOk(f, cost) || f.state === 'hurt') return;
  f.ki -= cost; f.tpCD = 0.5;
  const side = Math.sign(f.x - o.x) || -1;
  teleport(f, o.x + side * 100 * fsize(o), o.y);
  f.face = o.x >= f.x ? 1 : -1; f.state = 'idle'; f.lastPunchT = time;
  speedLines = 0.3;
  later(0.04, () => doPunch(f, o, true));
}
function doBlink(f, dx, dy) {
  const cost = tpCost(f, 8);
  if (!teleOk(f, cost) || f.state === 'hurt') return;
  f.ki -= cost; f.tpCD = 0.35;
  teleport(f, f.x + dx * 330, f.y + dy * 300);
}
let speedLines = 0;

/* ---------------- basic attacks ---------------- */
function doPunch(f, o, free = false) {
  if (f.state === 'punch' && f.st < 0.1) { f.queued = Math.min(2, f.queued + 1); return; }
  if (!(f.state === 'idle') || f.guard || f.frozen > 0 || f.trapped > 0 || mode !== 'fight' || cine) return;
  f.charging = false; f.lastPunchT = time;
  if (f === P) stats.punches++;
  f.punchAlt = !f.punchAlt; f.state = 'punch'; f.st = 0.13;
  const reach = 135 * fsize(f) + 40 * fsize(o);
  if (free || (Math.abs(o.x - f.x) < reach && Math.abs(o.y - f.y) < 115 && o.state !== 'ko')) {
    f.vx += f.face * 170;
    later(0.035, () => {
      if (f.state === 'ko') return;
      if (Math.abs(o.x - f.x) < reach + 30 && Math.abs(o.y - f.y) < 130) {
        f.combo = (time - f.lastMelee < 0.7) ? f.combo + 1 : 1; f.lastMelee = time;
        const heavy = f.combo >= 5;
        const stun = f.ch.id === 'raiko' && f.combo % 3 === 0 ? 0.7 : heavy ? 0.55 : 0.28;
        const landed = hit(o, f, heavy ? 9 : 4.5, { kind: heavy ? 'heavy' : 'melee', kx: f.face * (heavy ? 1000 : 240), ky: heavy ? -300 : 0, stun });
        if (heavy) f.combo = 0;
        if (f === P && landed) { stats.landed++; stats.best = Math.max(stats.best, f.combo || 5); }
        if (landed) { sfx.punch(heavy); if (f.combo >= 2 && f === P) addText(`${f.combo} HIT`, '#ffd23a', 0.7, W() / 2, H() * 0.66); }
      } else sfx.swing();
    });
  } else {
    if (f.ki >= 2 && f.blastCD <= 0) {
      f.ki -= 2; f.blastCD = 0.08;
      const h = handPos(f, f.punchAlt ? 'bh' : 'fh', f.punchAlt ? 'punchB' : 'punchF');
      const shots = f.ch.id === 'torque' ? [-0.06, 0.06] : [0];
      for (const off of shots) {
        const a = aimAng(h, o) + off;
        spawnProj({ type: f.ch.id === 'torque' ? 'laser' : 'blast', x: h.x, y: h.y, vx: Math.cos(a) * 1200, vy: Math.sin(a) * 1200, r: 12, dmg: 3, owner: f, life: 2, col: auraCol(f), kind: 'blast', el: f.ch.element.toLowerCase() === 'fire' ? 'fire' : '' });
      }
      f.ch.id === 'torque' ? sfx.laser() : sfx.blast();
    } else { sfx.swing(); if (f === P && f.ki < 2) note('Out of ki. Drop your fists to charge.'); }
  }
}

function startCast(f, pose, dur) { f.state = 'cast'; f.st = dur; f.castPose = pose; f.armor = true; f.vx *= 0.2; f.vy *= 0.2; f.guard = false; f.charging = false; }
function addBeam(f, o, opt) {
  if (NETG()) { hum(opt.dur, opt.low ? 60 : 110, 0.1); return; }
  if (f.state === 'ko') return;
  const h = handPos(f, 'fh', 'castF');
  beams.push(Object.assign({ owner: f, target: o, ang: aimAng(h, o), len: 0, t: 0, tick: 0, maxLen: 2800, track: 0.5, kind: 'beam' }, opt));
  hum(opt.dur, opt.low ? 60 : 110, 0.1);
}
function tick(e, key, every, dt) { e[key] = (e[key] ?? 0) - dt; if (e[key] <= 0) { e[key] = every; return true; } return false; }
const inside = (f, x, y, r) => { const c = center(f); return Math.hypot(c.x - x, c.y - y) < r; };

/* ---------------- special moves ---------------- */
const MOVES = {
  /* Raiko */
  lance(f, o) { startCast(f, 'castF', 1.15); later(0.2, () => addBeam(f, o, { w: 24, dur: 0.85, dps: 36, col: '#ffe45a', col2: '#7fd0ff', track: 0.55, style: 'electric', special: true })); },
  flashstep(f, o) {
    const behind = o.x - o.face * 110;
    teleport(f, behind, o.y); f.face = o.x >= f.x ? 1 : -1;
    for (const [i, dt] of [[0, 0.06], [1, 0.22]]) later(dt, () => { if (f.state === 'ko') return; f.state = 'punch'; f.st = 0.13; f.punchAlt = !!i; if (Math.abs(o.x - f.x) < 220) hit(o, f, 7, { kind: 'melee', kx: f.face * 300, stun: 0.35, special: true }); sfx.punch(i === 1); });
  },
  storm(f, o) {
    startCast(f, 'castUp', 1.8);
    for (let i = 0; i < 6; i++) later(0.4 + i * 0.22, () => {
      const x = o.x + rand(-25, 25), y = o.y;
      addEnt({ dur: 0.2, draw: (e, c) => { c.strokeStyle = '#ffe45a'; c.lineWidth = 4; c.globalAlpha = 0.8; c.beginPath(); c.arc(x, y - 30, 70 * (1 - e.t / e.dur) + 20, 0, Math.PI * 2); c.stroke(); c.globalAlpha = 1; } });
      later(0.2, () => {
        addEnt({ dur: 0.3, draw: (e, c) => { c.globalAlpha = 1 - e.t / e.dur; bolt(c, x + rand(-30, 30), camTop() - 60, x, WORLD.ground, '#ffe45a', '#7fd0ff', 9, 70, 14); c.globalAlpha = 1; } });
        sfx.bolt(); shake = Math.max(shake, 0.3);
        if (Math.abs(o.x - x) < 80) hit(o, f, 8, { kind: 'beam', ky: 260, stun: 0.35, special: true });
      });
    });
  },
  raijin(f, o) {
    startCast(f, 'castUp', 2.4); sfx.bolt();
    const segs = []; const start = { x: f.x - f.face * 300, y: camTop() + 40 };
    for (let i = 0; i < 22; i++) segs.push({ x: start.x, y: start.y });
    addEnt({ dur: 2.8, owner: f, segs, hx: start.x, hy: start.y, ang: Math.atan2(o.y - start.y, o.x - start.x),
      danger: (e, t) => Math.hypot(e.hx - t.x, e.hy - t.y) < 260,
      update(e, dt) {
        const c = center(o), want = Math.atan2(c.y - e.hy, c.x - e.hx);
        let da = want - e.ang; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
        e.ang += clamp(da, -3 * dt, 3 * dt);
        e.hx += Math.cos(e.ang) * 1150 * dt; e.hy += Math.sin(e.ang) * 1150 * dt;
        e.segs.unshift({ x: e.hx, y: e.hy }); e.segs.length = 22;
        if (Math.hypot(c.x - e.hx, c.y - e.hy) < 110 && tick(e, 'hk', 0.22, dt)) { hit(o, f, 7, { kind: 'beam', kx: Math.cos(e.ang) * 500, ky: Math.sin(e.ang) * 500, stun: 0.3, special: true }); sfx.bolt(); }
      },
      draw(e, c) {
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = e.segs.length - 1; i > 0; i -= 2) { const s = e.segs[i], k = 1 - i / e.segs.length; glowOrb(c, s.x, s.y, 14 + k * 26, '#7fd0ff'); }
        for (let i = 0; i < e.segs.length - 3; i += 3) bolt(c, e.segs[i].x, e.segs[i].y, e.segs[i + 3].x, e.segs[i + 3].y, '#ffe45a', '#7fd0ff', 5, 18, 3);
        c.translate(e.hx, e.hy); c.rotate(e.ang);
        c.fillStyle = '#fff6c0'; c.beginPath(); c.moveTo(70, 0); c.lineTo(-10, -34); c.lineTo(-30, -60); c.lineTo(-24, -20); c.lineTo(-40, 0); c.lineTo(-24, 20); c.lineTo(-30, 60); c.lineTo(-10, 34); c.closePath(); c.fill();
        glowOrb(c, 20, -12, 8, '#7fd0ff');
        c.restore();
      } });
  },
  /* Ember */
  volley(f, o) {
    startCast(f, 'castF', 0.75);
    for (let i = 0; i < 7; i++) later(0.08 + i * 0.06, () => {
      if (f.state === 'ko') return;
      const h = handPos(f, 'fh', 'castF'), a = aimAng(h, o) + (i - 3) * 0.13;
      spawnProj({ type: 'fire', x: h.x, y: h.y, vx: Math.cos(a) * 820, vy: Math.sin(a) * 820, r: 16, dmg: 4.5, owner: f, life: 2.2, homing: 1.4, speed: 820, col: '#ff7a2a', kind: 'melee', el: 'fire', special: true });
      sfx.blast();
    });
  },
  flamewall(f, o) {
    startCast(f, 'castF', 0.45); sfx.fire();
    const x = f.x + f.face * 140, y = f.y - 40;
    addEnt({ dur: 3, owner: f, x, y,
      update(e, dt) {
        for (const p of proj) if (p.owner !== f && Math.abs(p.x - e.x) < 40 && Math.abs(p.y - e.y) < 200) { p.dead = true; addParts(p.x, p.y, 6, '#ff9a2a', 300, 0.3, 4); }
        if (inside(o, e.x, e.y, 60) || (Math.abs(o.x - e.x) < 50 && Math.abs(center(o).y - e.y) < 200)) { if (tick(e, 'hk', 0.25, dt)) hit(o, f, 3, { kind: 'blast', el: 'fire', kx: Math.sign(o.x - e.x) * 300, stun: 0.15, special: true, quiet: true }); }
        if (Math.random() < 0.8) parts.push({ x: e.x + rand(-30, 30), y: e.y + rand(-180, 180), vx: rand(-20, 20), vy: -rand(120, 300), life: 0.6, max: 0.6, col: Math.random() < 0.5 ? '#ff6a2a' : '#ffd04a', size: 9 });
      },
      draw(e, c) {
        const k = Math.min(1, e.t / 0.2) * Math.min(1, (e.dur - e.t) / 0.3);
        c.save(); c.globalCompositeOperation = 'lighter';
        const g = c.createLinearGradient(e.x - 50, 0, e.x + 50, 0); g.addColorStop(0, 'rgba(255,90,20,0)'); g.addColorStop(0.5, `rgba(255,140,40,${0.55 * k})`); g.addColorStop(1, 'rgba(255,90,20,0)');
        c.fillStyle = g; c.fillRect(e.x - 50, e.y - 210, 100, 420);
        c.restore();
      } });
  },
  phoenix(f, o) {
    startCast(f, 'castSpread', 0.35);
    later(0.35, () => {
      if (f.state === 'ko') return;
      const a = aimAng(center(f), o);
      f.state = 'dash'; f.st = 0.7; f.hidden = true; f.armor = true; f.dashHit = false;
      f.vx = Math.cos(a) * 2100; f.vy = Math.sin(a) * 2100; sfx.whoosh(); sfx.fire();
    });
  },
  solarcore(f, o) {
    startCast(f, 'castUp', 2.2); sfx.fire();
    addEnt({ dur: 4.2, owner: f, x: f.x, y: f.y - 200, r: 10, phase: 'grow',
      danger: (e, t) => e.phase === 'fly' && Math.hypot(e.x - t.x, e.y - t.y) < 340,
      update(e, dt) {
        if (e.phase === 'grow') { const h = handPos(f, 'fh', 'castUp'); e.x = h.x; e.y = h.y - 60; e.r = Math.min(110, e.r + 90 * dt); if (e.t > 1.4) { e.phase = 'fly'; } }
        else if (e.phase === 'fly') {
          const c = center(o), a = Math.atan2(c.y - e.y, c.x - e.x);
          e.x += Math.cos(a) * 520 * dt; e.y += Math.sin(a) * 520 * dt;
          if (Math.hypot(c.x - e.x, c.y - e.y) < e.r + 30 || e.t > 3.6) { e.phase = 'boom'; e.bt = 0; sfx.bigBoom(); shake = 1; impactT = 0.1;
            if (Math.hypot(c.x - e.x, c.y - e.y) < 260) hit(o, f, 44, { kind: 'heavy', el: 'fire', kx: Math.sign(c.x - e.x || 1) * 1100, ky: -500, stun: 0.9, special: true });
            addParts(e.x, e.y, 80, '#ffb02a', 1100, 1, 10); }
        } else { e.bt += dt; if (e.bt > 0.6) e.dead = true; }
      },
      draw(e, c) {
        c.save(); c.globalCompositeOperation = 'lighter';
        if (e.phase === 'boom') { const k = e.bt / 0.6; glowOrb(c, e.x, e.y, 260 * (0.5 + k), '#ff7a2a'); }
        else { glowOrb(c, e.x, e.y, e.r, '#ff9a2a', '#fffbe0'); for (let i = 0; i < 6; i++) { const a = time * 3 + i; c.strokeStyle = 'rgba(255,200,80,.6)'; c.lineWidth = 3; c.beginPath(); c.arc(e.x, e.y, e.r * (1.2 + 0.1 * Math.sin(a * 2)), a, a + 0.8); c.stroke(); } }
        c.restore();
      } });
  },
  /* Mira */
  disc(f, o) {
    startCast(f, 'castOne', 0.65);
    later(0.28, () => { if (f.state === 'ko') return; const h = handPos(f, 'fh', 'castOne');
      spawnProj({ type: 'disc', x: h.x, y: h.y, vx: f.face * 700, vy: -150, r: 28, dmg: 15, owner: f, life: 2.8, homing: 3.5, speed: 780, col: '#c7e9ff', kind: 'heavy', spin: 0, special: true }); sfx.whoosh(); });
  },
  mirror(f, o) { f.reflect = 2; sfx.ice(); },
  prism(f, o) { startCast(f, 'castF', 2.3); later(0.45, () => addBeam(f, o, { w: 76, dur: 1.6, dps: 30, col: '#9fe6ff', col2: '#c7a8ff', track: 0.55, freeze: true, style: 'ice', low: true, special: true })); },
  zero(f, o) {
    startCast(f, 'castF', 1.4); sfx.ice();
    addEnt({ dur: 3.4, owner: f, x: o.x, y: center(o).y, frozeT: -1,
      danger: (e, t) => e.t < 0.85,
      update(e, dt) {
        if (e.t < 0.55) { const c = center(o); e.x = lerp(e.x, c.x, 0.2); e.y = lerp(e.y, c.y, 0.2); }
        if (e.frozeT < 0 && e.t > 0.85) {
          e.frozeT = e.t;
          if (inside(o, e.x, e.y, 130) && o.phase <= 0 && o.invuln <= 0) { o.frozen = 2.2; o.state = 'idle'; o.vx = o.vy = 0; sfx.ice(); impactT = 0.06; }
          else e.dur = 1.2;
        }
        if (e.frozeT > 0 && !e.shattered && e.t > e.frozeT + 2.1) { e.shattered = true; if (o.frozen > 0) { o.frozen = 0; hit(o, f, 40, { kind: 'heavy', kx: f.face * 700, ky: -300, stun: 0.6, special: true }); addParts(center(o).x, center(o).y, 50, '#dff6ff', 800, 0.8, 7); sfx.ice(); sfx.boom(); } }
      },
      draw(e, c) {
        if (e.t > 0.9) return;
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 + e.t * 2, r = 260 * (1 - e.t / 0.9) + 30; c.fillStyle = 'rgba(200,240,255,.85)'; c.save(); c.translate(e.x + Math.cos(a) * r, e.y + Math.sin(a) * r); c.rotate(a); c.beginPath(); c.moveTo(-18, 0); c.lineTo(0, -6); c.lineTo(18, 0); c.lineTo(0, 6); c.fill(); c.restore(); }
        c.restore();
      } });
  },
  /* Gorran */
  quake(f, o) {
    startCast(f, 'castSpread', 0.65);
    later(0.12, () => { if (f.state === 'ko') return; const c0 = center(f);
      addEnt({ dur: 0.45, owner: f, x: c0.x, y: c0.y, r: 20,
        update(e) { e.r = lerp(20, 390, Math.min(1, e.t / e.dur)); const c = center(o); if (!e.hit && Math.hypot(c.x - e.x, c.y - e.y) < e.r + 30) { e.hit = true; hit(o, f, 18, { kind: 'heavy', kx: Math.sign(c.x - e.x || 1) * 1200, ky: -380, stun: 0.7, special: true }); } for (const p of proj) if (p.owner !== f && Math.hypot(p.x - e.x, p.y - e.y) < e.r) p.dead = true; },
        draw(e, c) { const a = 1 - e.t / e.dur; c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = alpha('#e6c070', Math.max(0, a)); c.lineWidth = 26 * a + 4; c.beginPath(); c.arc(e.x, e.y, e.r, 0, Math.PI * 2); c.stroke(); c.strokeStyle = '#ffffff'; c.lineWidth = 4; c.stroke(); c.restore(); } });
      shake = 0.5; sfx.boom(); });
  },
  boulders(f, o) {
    startCast(f, 'castUp', 0.9);
    for (let i = 0; i < 3; i++) later(0.15 + i * 0.22, () => {
      if (f.state === 'ko') return;
      const h = handPos(f, 'fh', 'castUp'), c = center(o), T = 0.7;
      spawnProj({ type: 'boulder', x: h.x, y: h.y - 30, vx: (c.x - h.x) / T, vy: (c.y - h.y - 0.5 * 900 * T * T) / T, grav: 900, r: 30, dmg: 10, owner: f, life: 2.5, kind: 'heavy', col: '#8a7058', spin: 0, special: true });
      sfx.whoosh();
    });
  },
  hammer(f, o) {
    startCast(f, 'castUp', 1.5);
    later(0.3, () => addEnt({ owner: f, x: o.x, y: camTop() - 260, phase: 'track', vy: 0, dur: 4,
      danger: (e, t) => Math.abs(e.x - t.x) < 180,
      update(e, dt) {
        if (e.phase === 'track') { e.x = lerp(e.x, o.x, 1 - Math.exp(-dt * 5)); e.y = camTop() - 260; if (e.t > 0.75) e.phase = 'fall'; }
        else if (e.phase === 'fall') {
          e.vy += 5200 * dt; e.y += e.vy * dt;
          if (!e.hit && Math.abs(o.x - e.x) < 140 && e.y + 90 >= o.y - 60) { e.hit = true; hit(o, f, 40, { kind: 'heavy', kx: Math.sign(o.x - e.x || 1) * 500, ky: 900, stun: 0.9, special: true }); }
          if (e.y >= WORLD.ground - 90) { e.y = WORLD.ground - 90; e.phase = 'land'; e.lt = 0; shake = 1; sfx.boom(); addParts(e.x, WORLD.ground, 40, '#b89a70', 700, 0.8, 9); }
        } else { e.lt += dt; if (e.lt > 0.6) e.dead = true; }
      },
      draw(e, c) {
        c.save(); c.translate(e.x, e.y); if (e.phase === 'land') c.globalAlpha = Math.max(0, 1 - e.lt / 0.6);
        const g = c.createLinearGradient(-70, 0, 70, 0); g.addColorStop(0, '#4a3c2e'); g.addColorStop(0.5, '#86715a'); g.addColorStop(1, '#3a2e22');
        c.fillStyle = g; c.fillRect(-70, -1300, 140, 1250);
        c.fillStyle = '#8a745c'; c.beginPath(); c.ellipse(0, 0, 135, 105, 0, 0, Math.PI * 2); c.fill();
        c.strokeStyle = '#3a2e22'; c.lineWidth = 8; for (let i = -1; i <= 2; i++) { c.beginPath(); c.moveTo(i * 50 - 25, 20); c.lineTo(i * 50 - 25, 98); c.stroke(); }
        c.beginPath(); c.moveTo(-125, 10); c.lineTo(125, 10); c.stroke();
        c.restore();
        if (e.phase !== 'land') { c.fillStyle = 'rgba(0,0,0,.35)'; c.beginPath(); c.ellipse(e.x, WORLD.ground + 6, 150, 18, 0, 0, Math.PI * 2); c.fill(); }
      } }));
  },
  mountain(f, o) {
    startCast(f, 'castUp', 2.2); sfx.boom(); shake = 0.6;
    addEnt({ owner: f, x: o.x, y: camTop() - 500, phase: 'track', vy: 0, dur: 5,
      danger: (e, t) => Math.abs(e.x - t.x) < 300,
      update(e, dt) {
        if (e.phase === 'track') { e.x = lerp(e.x, o.x, 1 - Math.exp(-dt * 3)); e.y = camTop() - 500; shake = Math.max(shake, 0.25); if (e.t > 1.1) e.phase = 'fall'; }
        else if (e.phase === 'fall') {
          e.vy += 3800 * dt; e.y += e.vy * dt;
          if (!e.hit && Math.abs(o.x - e.x) < 260 && e.y + 200 >= o.y - 60) { e.hit = true; hit(o, f, 50, { kind: 'heavy', ky: 1200, stun: 1, special: true }); }
          if (e.y >= WORLD.ground - 180) { e.phase = 'land'; e.lt = 0; shake = 1.4; impactT = 0.12; sfx.bigBoom(); addParts(e.x, WORLD.ground, 90, '#b89a70', 1000, 1.2, 12); }
        } else { e.lt += dt; if (e.lt > 1) e.dead = true; }
      },
      draw(e, c) {
        c.save(); c.translate(e.x, e.y); if (e.phase === 'land') c.globalAlpha = Math.max(0, 1 - e.lt);
        const g = c.createLinearGradient(0, -300, 0, 200); g.addColorStop(0, '#9a8a78'); g.addColorStop(1, '#4a3c2e');
        c.fillStyle = g; c.beginPath(); c.moveTo(-300, 180); c.lineTo(-180, -60); c.lineTo(-60, -300); c.lineTo(40, -200); c.lineTo(120, -320); c.lineTo(300, 180); c.closePath(); c.fill();
        c.fillStyle = '#eef2f6'; c.beginPath(); c.moveTo(-60, -300); c.lineTo(-20, -240); c.lineTo(10, -230); c.lineTo(40, -200); c.lineTo(80, -260); c.lineTo(120, -320); c.lineTo(150, -250); c.lineTo(-110, -200); c.closePath(); c.fill();
        c.restore();
        if (e.phase !== 'land') { c.fillStyle = 'rgba(0,0,0,.4)'; c.beginPath(); c.ellipse(e.x, WORLD.ground + 6, 300, 30, 0, 0, Math.PI * 2); c.fill(); }
      } });
  },
  /* Kaze */
  clones(f, o) {
    sfx.zip();
    for (const side of [-1, 1]) {
      addEnt({ dur: 3.2, owner: f, x: o.x + side * 260, y: o.y - 60, side,
        update(e, dt) {
          e.x = lerp(e.x, o.x + e.side * 260, 1 - Math.exp(-dt * 2)); e.y = lerp(e.y, o.y - 60 + Math.sin(time * 3 + e.side) * 40, 1 - Math.exp(-dt * 2));
          if (tick(e, 'fk', 0.45, dt)) { const a = Math.atan2(center(o).y - e.y, o.x - e.x); spawnProj({ type: 'shuriken', x: e.x, y: e.y - 30, vx: Math.cos(a) * 1000, vy: Math.sin(a) * 1000, r: 12, dmg: 3, owner: f, life: 1.5, kind: 'blast', col: '#8affd6', spin: 0 }); sfx.swing(); }
        },
        draw(e, c) { const pj = {}; for (const k of JOINTS) pj[k] = POSES.idle[k]; drawGhost(c, { x: e.x, y: e.y + 40, face: o.x > e.x ? 1 : -1, size: fsize(f), tilt: 0, pj }, '#8affd6', 0.55 * Math.min(1, (e.dur - e.t) / 0.3)); } });
    }
  },
  cyclone(f, o) {
    startCast(f, 'castOne', 0.6);
    later(0.25, () => addEnt({ dur: 2.6, owner: f, x: f.x + f.face * 120, y: f.y,
      danger: (e, t) => Math.abs(e.x - t.x) < 200,
      update(e, dt) {
        const c = center(o); e.x += Math.sign(c.x - e.x) * Math.min(Math.abs(c.x - e.x), 520 * dt); e.y += Math.sign(c.y - e.y) * Math.min(Math.abs(c.y - e.y), 300 * dt);
        if (Math.abs(c.x - e.x) < 80 && Math.abs(c.y - e.y) < 160) { if (o.phase <= 0 && o.invuln <= 0) { o.trapped = 0.25; o.x = lerp(o.x, e.x + Math.sin(time * 14) * 30, 0.3); } if (tick(e, 'hk', 0.25, dt)) hit(o, f, 2.5, { kind: 'blast', stun: 0.25, special: true, quiet: true }); }
      },
      draw(e, c) {
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 12; i++) { const y = e.y - 170 + i * 30, r = 30 + i * 6, a = time * 12 + i; c.strokeStyle = `rgba(160,255,220,${0.25 + 0.03 * i})`; c.lineWidth = 4; c.beginPath(); c.ellipse(e.x + Math.sin(a * 0.3) * 8, y, r, r * 0.28, 0, a % (Math.PI * 2), a % (Math.PI * 2) + 4); c.stroke(); }
        c.restore();
      } }));
  },
  thousand(f, o) {
    f.state = 'dash'; f.st = 1.3; f.hidden = true; f.armor = true; f.vx = f.vy = 0; f.noPhoenix = true; sfx.zip();
    for (let i = 0; i < 10; i++) later(0.1 + i * 0.1, () => {
      const a = Math.random() * Math.PI * 2, c = center(o);
      addEnt({ dur: 0.18, draw: (e, cc) => { cc.save(); cc.globalCompositeOperation = 'lighter'; cc.strokeStyle = '#e6fffa'; cc.globalAlpha = 1 - e.t / e.dur; cc.lineWidth = 5; cc.beginPath(); cc.moveTo(c.x - Math.cos(a) * 160, c.y - Math.sin(a) * 160); cc.lineTo(c.x + Math.cos(a) * 160, c.y + Math.sin(a) * 160); cc.stroke(); cc.restore(); } });
      hit(o, f, 3.6, { kind: 'melee', kx: Math.cos(a) * 120, ky: Math.sin(a) * 120, stun: 0.2, special: true }); sfx.swing();
    });
    later(1.25, () => { f.hidden = false; f.noPhoenix = false; teleport(f, o.x - o.face * 140, o.y); });
  },
  tempest(f, o) {
    startCast(f, 'castUp', 2.2); sfx.whoosh();
    addEnt({ dur: 4.2, owner: f, x: o.x, y: o.y - 100,
      danger: () => true,
      update(e, dt) {
        e.x = lerp(e.x, o.x, dt * 0.6); e.y = lerp(e.y, o.y - 60, dt * 0.6);
        const c = center(o), dx = e.x - c.x, dy = e.y - c.y, d = Math.hypot(dx, dy) || 1;
        if (o.phase <= 0) { o.x += dx / d * 260 * dt; o.y += dy / d * 260 * dt; }
        if (d < 300 && tick(e, 'hk', 0.25, dt)) hit(o, f, 3, { kind: 'beam', stun: 0.2, special: true, quiet: true });
        for (const p of proj) if (p.owner !== f && Math.hypot(p.x - e.x, p.y - e.y) < 400) p.dead = true;
      },
      draw(e, c) {
        c.save(); c.globalCompositeOperation = 'lighter';
        const k = Math.min(1, e.t / 0.5) * Math.min(1, (e.dur - e.t) / 0.5);
        for (let i = 0; i < 26; i++) { const a = time * 5 + i * 0.7, r = 40 + i * 14; c.strokeStyle = `rgba(160,255,220,${0.22 * k})`; c.lineWidth = 6; c.beginPath(); c.arc(e.x, e.y, r, a, a + 1.6); c.stroke(); }
        glowOrb(c, e.x, e.y, 30, '#e6fffa');
        c.restore();
      } });
  },
  /* Vex */
  voidorb(f, o) {
    startCast(f, 'castF', 0.6);
    later(0.2, () => { if (f.state === 'ko') return; const h = handPos(f, 'fh', 'castF'), a = aimAng(h, o);
      spawnProj({ type: 'void', x: h.x, y: h.y, vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, r: 34, dmg: 18, owner: f, life: 4.5, homing: 1.2, speed: 300, col: '#9b4dff', kind: 'heavy', pull: 380, special: true,
        onHit: (p, t) => { const s = Math.min(t.ki, 20); t.ki -= s; f.ki = Math.min(100, f.ki + s); } }); sfx.whoosh(); });
  },
  phase(f) { f.phase = 1.5; sfx.zip(); },
  eclipse(f, o) {
    startCast(f, 'castUp', 1.7);
    addEnt({ dur: 2.4, owner: f, x: o.x, grab: false,
      danger: (e, t) => e.t < 0.8 && Math.abs(e.x - t.x) < 200,
      update(e, dt) {
        if (e.t < 0.6) e.x = lerp(e.x, o.x, 1 - Math.exp(-dt * 6));
        if (!e.checked && e.t > 0.8) { e.checked = true; if (Math.abs(o.x - e.x) < 150 && o.phase <= 0 && o.invuln <= 0) { e.grab = true; o.trapped = 1.2; o.vx = o.vy = 0; sfx.boom(); } else e.dur = 1.2; }
        if (e.grab && !e.crushed && e.t > 1.9) { e.crushed = true; hit(o, f, 35, { kind: 'heavy', ky: -300, stun: 0.6, special: true }); }
      },
      draw(e, c) {
        const top = e.t < 0.8 ? lerp(WORLD.ground, o.y - 20, e.t / 0.8) : o.y - 20;
        c.save(); c.globalCompositeOperation = 'source-over';
        for (const side of [-1, 1]) {
          const g = c.createLinearGradient(0, WORLD.ground, 0, top); g.addColorStop(0, 'rgba(10,0,20,.95)'); g.addColorStop(1, 'rgba(90,20,140,.9)');
          c.fillStyle = g; c.beginPath(); c.moveTo(e.x + side * 120, WORLD.ground);
          c.quadraticCurveTo(e.x + side * 140, (WORLD.ground + top) / 2, e.x + side * 40, top);
          c.lineTo(e.x + side * 10, top + 30); c.quadraticCurveTo(e.x + side * 80, (WORLD.ground + top) / 2, e.x + side * 60, WORLD.ground); c.fill();
        }
        c.restore();
      } });
  },
  horizon(f, o) {
    startCast(f, 'castUp', 2); sfx.bigBoom();
    addEnt({ dur: 3.8, owner: f, x: (f.x + o.x) / 2 + (o.x - f.x) * 0.3, y: Math.min(f.y, o.y) - 120,
      danger: () => true,
      update(e, dt) {
        const c = center(o), dx = e.x - c.x, dy = e.y - c.y, d = Math.hypot(dx, dy) || 1;
        if (o.phase <= 0) { const pull = Math.min(520, 120000 / d); o.x += dx / d * pull * dt; o.y += dy / d * pull * dt; }
        if (d < 150 && tick(e, 'hk', 0.2, dt)) hit(o, f, 3.4, { kind: 'beam', stun: 0.25, special: true, quiet: true });
        for (const p of proj) if (p.owner !== f) { const pdx = e.x - p.x, pdy = e.y - p.y, pd = Math.hypot(pdx, pdy) || 1; p.vx += pdx / pd * 1500 * dt; p.vy += pdy / pd * 1500 * dt; if (pd < 40) p.dead = true; }
        if (!e.boom && e.t > e.dur - 0.2) { e.boom = true; if (d < 300) hit(o, f, 18, { kind: 'heavy', kx: -dx / d * 900, ky: -dy / d * 900, stun: 0.6, special: true }); shake = 1; sfx.bigBoom(); }
      },
      draw(e, c) {
        const k = Math.min(1, e.t / 0.6);
        c.save(); c.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 4; i++) { c.strokeStyle = `rgba(200,90,255,${0.35 - i * 0.07})`; c.lineWidth = 10; c.beginPath(); c.ellipse(e.x, e.y, (150 + i * 40) * k, (40 + i * 12) * k, time * 0.5, 0, Math.PI * 2); c.stroke(); }
        c.restore();
        c.fillStyle = '#000'; c.beginPath(); c.arc(e.x, e.y, 70 * k, 0, Math.PI * 2); c.fill();
        c.strokeStyle = 'rgba(255,200,255,.8)'; c.lineWidth = 3; c.stroke();
      } });
  },
  /* Sol */
  spear(f, o) {
    startCast(f, 'castOne', 0.6);
    later(0.25, () => { if (f.state === 'ko') return; const h = handPos(f, 'fh', 'castOne'), a = aimAng(h, o);
      spawnProj({ type: 'spear', x: h.x, y: h.y, vx: Math.cos(a) * 1400, vy: Math.sin(a) * 1400, r: 18, dmg: 16, owner: f, life: 1.6, kind: 'pierce', col: '#ffe08a', special: true }); sfx.laser(); });
  },
  sanctuary(f) { f.dome = 3; sfx.heal(); },
  judgment(f, o) {
    startCast(f, 'castSpread', 1.8);
    for (let i = 0; i < 9; i++) later(0.2 + i * 0.15, () => {
      const x = o.x + (i === 4 ? 0 : rand(-480, 480));
      addEnt({ dur: 0.75, owner: f, x,
        danger: (e, t) => e.t < 0.3 && Math.abs(e.x - t.x) < 120,
        update(e) { if (!e.hit && e.t > 0.3) { e.hit = true; sfx.laser(); if (Math.abs(o.x - e.x) < 70) hit(o, f, 9, { kind: 'beam', ky: 200, stun: 0.35, special: true }); } },
        draw(e, c) {
          if (e.t < 0.3) { c.fillStyle = 'rgba(255,230,140,.25)'; c.fillRect(e.x - 6, camTop(), 12, WORLD.ground - camTop()); return; }
          const k = 1 - (e.t - 0.3) / 0.45; c.save(); c.globalCompositeOperation = 'lighter';
          const g = c.createLinearGradient(e.x - 60, 0, e.x + 60, 0); g.addColorStop(0, 'rgba(255,230,140,0)'); g.addColorStop(0.5, `rgba(255,250,220,${k})`); g.addColorStop(1, 'rgba(255,230,140,0)');
          c.fillStyle = g; c.fillRect(e.x - 60, camTop() - 50, 120, WORLD.ground - camTop() + 50); c.restore();
        } });
    });
  },
  dawn(f, o) {
    startCast(f, 'castUp', 2.6); impactT = 0.08;
    addEnt({ dur: 3, owner: f, x: o.x,
      danger: (e, t) => Math.abs(e.x - t.x) < 260,
      update(e, dt) {
        if (e.t > 0.6) { e.x += clamp(o.x - e.x, -240 * dt, 240 * dt); if (Math.abs(o.x - e.x) < 140 && tick(e, 'hk', 0.1, dt)) hit(o, f, 3.2, { kind: 'beam', ky: 300, stun: 0.2, special: true, quiet: true }); shake = Math.max(shake, 0.3); }
        else e.x = lerp(e.x, o.x, 0.1);
        if (!e.snd && e.t > 0.6) { e.snd = true; hum(2.2, 80, 0.12); }
      },
      draw(e, c) {
        const top = camTop() - 100;
        c.save(); c.globalCompositeOperation = 'lighter';
        if (e.t < 0.6) { c.strokeStyle = 'rgba(255,240,180,.5)'; c.lineWidth = 3; c.beginPath(); c.moveTo(e.x, top); c.lineTo(e.x, WORLD.ground); c.stroke(); }
        else { const k = Math.min(1, (e.t - 0.6) / 0.2) * Math.min(1, (e.dur - e.t) / 0.4), w = 150 * k;
          const g = c.createLinearGradient(e.x - w * 1.6, 0, e.x + w * 1.6, 0); g.addColorStop(0, 'rgba(255,210,90,0)'); g.addColorStop(0.3, 'rgba(255,220,120,.5)'); g.addColorStop(0.5, 'rgba(255,255,240,1)'); g.addColorStop(0.7, 'rgba(255,220,120,.5)'); g.addColorStop(1, 'rgba(255,210,90,0)');
          c.fillStyle = g; c.fillRect(e.x - w * 1.6, top, w * 3.2, WORLD.ground - top + 20); }
        c.restore();
      } });
  },
  /* Torque */
  missiles(f, o) {
    startCast(f, 'castF', 0.8);
    for (let i = 0; i < 8; i++) later(0.05 + i * 0.07, () => {
      if (f.state === 'ko') return;
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.4;
      spawnProj({ type: 'missile', x: f.x - f.face * 10, y: f.y - 60, vx: Math.cos(a) * 600, vy: Math.sin(a) * 600, r: 10, dmg: 4, owner: f, life: 3, homing: 4.2, speed: 760, col: '#ffb02a', kind: 'blast', special: true });
      sfx.blast();
    });
  },
  mine(f, o) {
    startCast(f, 'castF', 0.4);
    const h = handPos(f, 'fh', 'castF');
    addEnt({ dur: 4.5, owner: f, x: h.x, y: h.y,
      danger: (e, t) => Math.hypot(e.x - t.x, e.y - t.y) < 260,
      update(e, dt) {
        const c = center(o), dx = e.x - c.x, dy = e.y - c.y, d = Math.hypot(dx, dy) || 1;
        e.x -= dx / d * 160 * dt; e.y -= dy / d * 160 * dt;
        if (d < 320 && o.phase <= 0) { o.x += dx / d * 240 * dt; o.y += dy / d * 240 * dt; }
        if (!e.boom && (d < 70 || e.t > e.dur - 0.1)) { e.boom = true; e.dur = e.t + 0.4; sfx.boom(); shake = 0.7; addParts(e.x, e.y, 40, '#ffb02a', 700, 0.6, 8); if (d < 170) hit(o, f, 22, { kind: 'heavy', kx: -dx / d * 900, ky: -dy / d * 900 - 200, stun: 0.6, special: true }); }
      },
      draw(e, c) {
        c.save(); c.globalCompositeOperation = 'lighter';
        if (e.boom) glowOrb(c, e.x, e.y, 120 * (1 - (e.dur - e.t) / 0.4 + 0.3), '#ff8a1a');
        else { glowOrb(c, e.x, e.y, 14, Math.sin(time * 12) > 0 ? '#ff3a2a' : '#ffb02a'); c.strokeStyle = 'rgba(255,176,42,.35)'; c.lineWidth = 2; c.beginPath(); c.arc(e.x, e.y, 320, 0, Math.PI * 2); c.stroke(); }
        c.restore();
      } });
  },
  railcannon(f, o) { startCast(f, 'castF', 1.5); later(0.35, () => addBeam(f, o, { w: 52, dur: 1, dps: 48, col: '#ff8a1a', col2: '#ffd04a', track: 0.25, style: 'rail', kind: 'pierce', special: true })); },
  orbital(f, o) {
    startCast(f, 'castUp', 1.6);
    addEnt({ dur: 3.4, owner: f, x: o.x,
      danger: (e, t) => Math.abs(e.x - t.x) < 240,
      update(e, dt) {
        e.x += clamp(o.x - e.x, -(e.t < 1 ? 900 : 260) * dt, (e.t < 1 ? 900 : 260) * dt);
        if (e.t > 1 && Math.abs(o.x - e.x) < 110 && tick(e, 'hk', 0.1, dt)) hit(o, f, 3.4, { kind: 'pierce', ky: 300, stun: 0.2, special: true, quiet: true });
        if (e.t > 1) shake = Math.max(shake, 0.35);
        if (!e.snd && e.t > 1) { e.snd = true; hum(2.2, 70, 0.12); }
      },
      draw(e, c) {
        const top = camTop() - 100;
        c.save(); c.globalCompositeOperation = 'lighter';
        if (e.t < 1) { c.strokeStyle = `rgba(255,60,40,${0.5 + 0.5 * Math.sin(time * 30)})`; c.lineWidth = 2; c.beginPath(); c.moveTo(e.x, top); c.lineTo(e.x, WORLD.ground); c.stroke(); c.beginPath(); c.arc(e.x, o.y - 40, 50, 0, Math.PI * 2); c.stroke(); }
        else { const k = Math.min(1, (e.dur - e.t) / 0.3), w = 110 * k;
          const g = c.createLinearGradient(e.x - w, 0, e.x + w, 0); g.addColorStop(0, 'rgba(255,60,40,0)'); g.addColorStop(0.35, 'rgba(255,90,40,.8)'); g.addColorStop(0.5, 'rgba(255,255,230,1)'); g.addColorStop(0.65, 'rgba(255,90,40,.8)'); g.addColorStop(1, 'rgba(255,60,40,0)');
          c.fillStyle = g; c.fillRect(e.x - w, top, w * 2, WORLD.ground - top + 10); glowOrb(c, e.x, WORLD.ground, 80 * k, '#ff8a1a'); }
        c.restore();
      } });
  },
};

function castSpecial(f, o, slot) {
  if (!canAct(f)) return false;
  const mv = f.ch.moves[slot];
  if (mv.form > f.form) { fnote(f, `${mv.name} unlocks in ${FORM_NAMES[mv.form]} form. Fill your Surge meter and power up.`); return false; }
  if (f.ki < mv.cost) { fnote(f, `${mv.name} needs ${mv.cost} ki. Drop your fists to charge.`); return false; }
  f.ki -= mv.cost; f.auraT = 1; f.state = 'idle';
  if (NETH()) netSend({ t: (slot === 'ult' || slot === 'sup') ? 'cutin' : 'cast', who: whoOf(f), slot });
  if (f === P) stats.specials++;
  if (slot === 'ult' || slot === 'sup') { startCutin(f, mv, () => MOVES[mv.id](f, o)); }
  else { banner(mv.name, auraCol(f), f === P ? 'left' : 'right'); sfx.special(); MOVES[mv.id](f, o); }
  return true;
}

function transform(f) {
  if (f.form >= 2 || f.surge < 100 || !canAct(f) || f.state === 'punch') return false;
  f.surge = 0; f.state = 'transform'; f.st = 99; f.vx = f.vy = 0;
  cine = { type: 'transform', t: 0, dur: 3.3, f, done: false };
  if (NETH()) netSend({ t: 'tf', who: whoOf(f) });
  sfx.rise(2.1);
  if (f === P) stats.forms++;
  return true;
}

/* ---------------- cutscenes ---------------- */
const cutinCanvas = document.createElement('canvas');
function startCutin(f, mv, cb) {
  cutinCanvas.width = 420; cutinCanvas.height = 420;
  portrait(cutinCanvas, f.ch, 'face', f.form);
  cine = { type: 'cutin', t: 0, dur: 1.0, f, mv, cb };
  f.state = 'cast'; f.st = 99; f.castPose = 'castUp';
  sfx.cutin();
}
function updateCine(dt) {
  const c = cine; c.t += dt;
  if (c.type === 'transform') {
    const f = c.f;
    f.state = 'transform'; f.shakeX = (Math.random() - 0.5) * 6 * Math.min(1, c.t);
    lerpPose(f, 'charge', dt, 10);
    const cc = center(f);
    for (let i = 0; i < 4; i++) { const a = Math.random() * Math.PI * 2, r = rand(200, 380); parts.push({ x: cc.x + Math.cos(a) * r, y: cc.y + Math.sin(a) * r, vx: -Math.cos(a) * r * 1.8, vy: -Math.sin(a) * r * 1.8, life: 0.5, max: 0.5, col: f.ch.c.aura[Math.min(2, f.form + 1)], size: 4 }); }
    if (Math.random() < 0.4) parts.push({ x: cc.x + rand(-300, 300), y: WORLD.ground, vx: 0, vy: -rand(200, 500), life: 1.2, max: 1.2, col: '#8a7a68', size: rand(3, 8) });
    shake = Math.max(shake, 0.15 + c.t * 0.12);
    if (!c.done && c.t > 2.15) {
      c.done = true; f.form = Math.min(2, f.form + 1); if (!NETG()) { f.hp = Math.min(100, f.hp + 15); f.ki = 100; } f.shakeX = 0;
      sfx.transform(); impactT = 0.1; shake = 1.2;
      addParts(cc.x, cc.y, 120, f.ch.c.aura[f.form], 1300, 1.1, 8);
      addEnt({ dur: 0.7, x: cc.x, y: cc.y, draw: (e, g) => { const k = e.t / e.dur; g.save(); g.globalCompositeOperation = 'lighter'; g.strokeStyle = alpha(f.ch.c.aura[f.form], 1 - k); g.lineWidth = 30 * (1 - k) + 2; g.beginPath(); g.arc(e.x, e.y, 60 + k * 900, 0, Math.PI * 2); g.stroke(); g.restore(); } });
      banner(`${f.ch.forms[f.form]}`, f.ch.c.aura[f.form], 'center');
      if (f === P) { Music.intensity = 0.95; setupHud(); }
    }
    for (const e of ents) { e.t += c.done ? dt : 0; }
    for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; }
    parts = parts.filter(p => p.life > 0);
    if (c.t >= c.dur) { f.state = 'idle'; f.st = 0; cine = null; }
    return;
  }
  if (c.type === 'cutin' && c.t >= c.dur) { cine = null; c.f.state = 'idle'; c.cb(); if (!NETG()) banner(c.mv.name, auraCol(c.f), c.f === P ? 'left' : 'right'); }
  if (c.type === 'vs' && c.t >= c.dur) { cine = null; mode = 'intro'; introT = 1.6; $('#hud').hidden = false; $('#tray').hidden = false; }
}

/* ---------------- AI ---------------- */
function updateAI(f, o, dt) {
  if (Net.active) { const i = Net.lastIn; f.inX = clamp(+i.mx || 0, -1, 1); f.inY = clamp(+i.my || 0, -1, 1); f.inGuard = !!i.guard; f.inCharge = !!i.charge; chargeTransform(f, dt); return; }
  f.inX = f.inY = 0; f.inGuard = f.inCharge = false;
  if (cfg.training || mode !== 'fight' || cine) return;
  const d = DIFF[cfg.diff];
  AI.guardT -= dt; AI.chargeT -= dt; AI.think -= dt;
  const threat = threatened(f);
  if (threat && f.tpCD <= 0 && Math.random() < d.vanish * dt * 6 && f.ki >= 12) { doVanish(f); return; }
  if (AI.think <= 0) {
    AI.think = rand(...d.think);
    const dist = Math.hypot(o.x - f.x, o.y - f.y), mv = f.ch.moves;
    const can = s => f.ki >= mv[s].cost && f.form >= mv[s].form;
    if (f.surge >= 100 && f.form < 2 && !threat && f.hp < 85) transform(f);
    else if (threat && Math.random() < d.block) AI.guardT = rand(0.35, 0.8);
    else if (can('sup') && Math.random() < 0.3 * d.spec) castSpecial(f, o, 'sup');
    else if (can('ult') && Math.random() < 0.25 * d.spec) castSpecial(f, o, 'ult');
    else if (can('s1') && Math.random() < 0.16 * d.spec) castSpecial(f, o, 's1');
    else if (can('s2') && Math.random() < 0.12 * d.spec) castSpecial(f, o, 's2');
    else if (dist > 500 && f.ki > 30 && Math.random() < 0.15 * d.aggr) doRush(f);
    else if (dist < 170 && Math.random() < d.aggr) AI.burst = 2 + ((Math.random() * 3) | 0);
    else if (dist > 420 && f.ki < 45 && Math.random() < 0.45) AI.chargeT = rand(0.6, 1.4);
    else if (Math.random() < 0.5 * d.aggr) AI.burst = 1 + (Math.random() < 0.35 ? 2 : 0);
    if (Math.random() < 0.35) { AI.wantD = Math.random() < 0.45 * d.aggr ? 100 : rand(260, 560); AI.yOff = rand(-240, 160); }
  }
  if (AI.burst > 0 && f.state === 'idle' && AI.guardT <= 0) { doPunch(f, o); AI.burst--; }
  f.inGuard = AI.guardT > 0;
  f.inCharge = AI.chargeT > 0 && !f.inGuard && !threat;
  if (!f.inGuard && !f.inCharge) steerTo(f, o, AI.wantD, AI.yOff);
}
function steerTo(f, o, dist, yOff) {
  const side = Math.sign(f.x - o.x) || 1;
  let tx = o.x + side * dist; if (tx < 140 || tx > WORLD.w - 140) tx = o.x - side * dist;
  const ty = clamp(o.y + yOff, 200, WORLD.ground - 80);
  const mx = tx - f.x, my = ty - f.y, m = Math.hypot(mx, my);
  if (m > 30) { f.inX = mx / m * Math.min(1, m / 160); f.inY = my / m * Math.min(1, m / 160); }
}

/* ---------------- fighter update ---------------- */
function updateFighter(f, o, dt) {
  f.flash = Math.max(0, f.flash - dt); f.blastCD -= dt; f.auraT = Math.max(0, f.auraT - dt * 0.8);
  for (const k of ['slow', 'phase', 'reflect', 'dome', 'exposed', 'invuln', 'tpCD', 'trapped']) f[k] = Math.max(0, f[k] - dt);
  if (f.frozen > 0) { f.frozen = Math.max(0, f.frozen - dt); f.vx = f.vy = 0; f.guard = f.charging = false; return; }
  if (f.burn > 0) { f.burn -= dt; f.hp = Math.max(1, f.hp - 1.6 * dt); if (Math.random() < dt * 20) parts.push({ x: f.x + rand(-20, 20), y: f.y - rand(0, 80), vx: 0, vy: -120, life: 0.4, max: 0.4, col: '#ff7a2a', size: 6 }); }
  if (f.dome > 0) f.hp = Math.min(100, f.hp + 4 * dt);
  if (f.guard && f.ch.id === 'sol') f.hp = Math.min(100, f.hp + 1.5 * dt);
  f.ki = Math.min(100, f.ki + FORM_MULT[f.form].regen * dt);
  if (f.state === 'ko') {
    f.vy += 1500 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= Math.pow(0.3, dt);
    const gy = WORLD.ground - 18;
    if (f.y >= gy) { f.y = gy; f.vy = -Math.abs(f.vy) * 0.25; if (Math.abs(f.vy) < 60) f.vy = 0; f.vx *= 0.7; }
    f.koRot = Math.min(1, f.koRot + dt * 2.5); f.x = clamp(f.x, 60, WORLD.w - 60);
    lerpPose(f, 'hurt', dt, 10); return;
  }
  if (f.state === 'transform') return;
  if (f.state !== 'idle') {
    f.st -= dt;
    if (f.state === 'dash' && !f.noPhoenix) {
      parts.push({ x: f.x + rand(-20, 20), y: f.y - 30 + rand(-20, 20), vx: -f.vx * 0.1, vy: rand(-60, 60), life: 0.5, max: 0.5, col: '#ff8a2a', size: 10 });
      if (!f.dashHit && Math.hypot(o.x - f.x, o.y - f.y) < 120) { f.dashHit = true; hit(o, f, 34, { kind: 'heavy', el: 'fire', kx: Math.sign(f.vx) * 1100, ky: -350, stun: 0.8, special: true }); sfx.boom(); }
    }
    if (f.st <= 0) {
      if (f.state === 'dash') { f.vx *= 0.15; f.vy *= 0.15; }
      f.state = 'idle'; f.armor = false; f.hidden = false;
      if (f.queued > 0) { f.queued--; doPunch(f, o); }
    }
  }
  const can = f.state === 'idle' && mode === 'fight' && !cine && f.trapped <= 0;
  f.guard = can && f.inGuard;
  f.charging = can && f.inCharge && !f.guard;
  if (f.state !== 'dash' && f.state !== 'hurt') f.face = o.x >= f.x ? 1 : -1;
  const sp = f.ch.stats.speed * FORM_MULT[f.form].speed * (f.slow > 0 ? 0.4 : 1);
  if (f.state === 'hurt') { f.vx *= Math.pow(0.05, dt); f.vy *= Math.pow(0.05, dt); }
  else if (f.state !== 'dash') {
    const move = can && !f.guard && !f.charging;
    const k = 1 - Math.exp(-dt * 11);
    f.vx = lerp(f.vx, move ? f.inX * sp : 0, k); f.vy = lerp(f.vy, move ? f.inY * sp : 0, k);
  }
  f.x += f.vx * dt; f.y += f.vy * dt;
  f.x = clamp(f.x, 80, WORLD.w - 80);
  f.y = clamp(f.y, WORLD.top + 150, WORLD.ground - 70 * f.ch.size);
  if (f.charging) {
    f.ki = Math.min(100, f.ki + 32 * dt); f.surge = Math.min(100, f.surge + 5 * dt);
    if (Math.random() < dt * 30) parts.push({ x: f.x + rand(-40, 40), y: f.y + rand(-20, 40), vx: 0, vy: -rand(200, 420), life: 0.6, max: 0.6, col: auraCol(f), size: 4 });
  }
  let pose = 'idle';
  if (f.state === 'punch') pose = f.punchAlt ? 'punchB' : 'punchF';
  else if (f.state === 'cast') pose = f.castPose;
  else if (f.state === 'hurt') pose = 'hurt';
  else if (f.state === 'dash') pose = 'fly';
  else if (f.guard) pose = 'guard';
  else if (f.charging) pose = 'charge';
  else if (Math.hypot(f.vx, f.vy) > 140) pose = 'fly';
  f.pose = pose;
  lerpPose(f, pose, dt, f.state === 'punch' ? 45 : 16);
  const fwd = f.vx * f.face;
  const tTilt = f.state === 'hurt' ? -0.25 : pose === 'fly' ? clamp(fwd / 700, -0.35, 0.55) + clamp(f.vy / 1600, -0.2, 0.2) * f.face : 0;
  f.tilt = lerp(f.tilt, tTilt, 1 - Math.exp(-dt * 8));
  if (Math.hypot(f.vx, f.vy) > 600 && Math.random() < 0.3) ghosts.push({ s: snapshot(f), col: auraCol(f), t: 0 });
}
function lerpPose(f, name, dt, rate) {
  const k = 1 - Math.exp(-dt * rate), tgt = POSES[name];
  for (const j of JOINTS) { f.pj[j][0] = lerp(f.pj[j][0], tgt[j][0], k); f.pj[j][1] = lerp(f.pj[j][1], tgt[j][1], k); }
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function updateWorld(dt) {
  for (const t of timers) t.t -= dt;
  const due = timers.filter(t => t.t <= 0); timers = timers.filter(t => t.t > 0);
  due.forEach(t => t.fn());
  const guest = NETG();
  // projectiles
  if (!guest) {
  for (const p of proj) {
    p.t += dt;
    const tgt = other(p.owner);
    if (p.homing && tgt.state !== 'ko') {
      const c = center(tgt), a = Math.atan2(c.y - p.y, c.x - p.x), cur = Math.atan2(p.vy, p.vx);
      let da = a - cur; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      const na = cur + clamp(da, -p.homing * dt, p.homing * dt), sp = p.speed || Math.hypot(p.vx, p.vy);
      p.vx = Math.cos(na) * sp; p.vy = Math.sin(na) * sp;
    }
    if (p.grav) p.vy += p.grav * dt;
    if (p.pull && tgt.phase <= 0) { const c = center(tgt), dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy) || 1; if (d < p.pull) { tgt.x += dx / d * 200 * dt; tgt.y += dy / d * 200 * dt; } }
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt;
    if (p.spin !== undefined) p.spin += dt * 18;
    if (p.type === 'fire' && Math.random() < 0.6) parts.push({ x: p.x, y: p.y, vx: rand(-40, 40), vy: rand(-80, 0), life: 0.35, max: 0.35, col: '#ff8a2a', size: 7 });
    if (p.type === 'missile' && Math.random() < 0.8) parts.push({ x: p.x, y: p.y, vx: -p.vx * 0.05, vy: -p.vy * 0.05, life: 0.4, max: 0.4, col: '#ffcf80', size: 4 });
    const c = center(tgt), dist = Math.hypot(c.x - p.x, c.y - p.y);
    if (!p.dead && tgt.reflect > 0 && dist < 150) { p.vx *= -1.1; p.vy *= -1.1; p.owner = tgt; p.homing = 0; addParts(p.x, p.y, 8, '#dff6ff', 300, 0.3, 3); sfx.ice(); continue; }
    if (!p.dead && tgt.dome > 0 && dist < 115 && p.kind !== 'pierce') { p.dead = true; addParts(p.x, p.y, 8, '#ffe08a', 300, 0.3, 3); continue; }
    if (!p.dead && tgt.state !== 'ko' && !tgt.hidden && tgt.phase <= 0 && dist < p.r + 36 * fsize(tgt)) {
      p.dead = true;
      hit(tgt, p.owner, p.dmg, { kind: p.kind, el: p.el, special: p.special, kx: Math.sign(p.vx) * (p.kind === 'heavy' ? 600 : 200), ky: p.kind === 'heavy' ? -200 : 0, stun: p.kind === 'heavy' ? 0.5 : 0.22 });
      p.onHit && p.onHit(p, tgt);
      addParts(p.x, p.y, 10, p.col, 350, 0.3, 4);
      if (p.type !== 'blast' && p.type !== 'laser') sfx.punch(false);
    }
    if (p.y > WORLD.ground + 10) { p.dead = true; addParts(p.x, WORLD.ground, 8, '#b89a70', 250, 0.4, 5); if (p.type === 'boulder') sfx.boom(); }
  }
  for (let i = 0; i < proj.length; i++) for (let k = i + 1; k < proj.length; k++) {
    const a = proj[i], b = proj[k];
    if (a.owner !== b.owner && !a.dead && !b.dead && Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r) {
      if (a.type === 'blast' || a.type === 'laser') a.dead = true; if (b.type === 'blast' || b.type === 'laser') b.dead = true;
      if (!a.dead && !b.dead) a.dead = b.dead = true;
      addParts((a.x + b.x) / 2, (a.y + b.y) / 2, 8, '#ffffff', 300, 0.25, 3);
    }
  }
  proj = proj.filter(p => !p.dead && p.life > 0 && p.x > -300 && p.x < WORLD.w + 300 && p.y > -900);
  }
  // beams
  if (!guest) {
  for (const b of beams) {
    b.t += dt;
    const f = b.owner, tgt = b.target;
    if (f.state === 'ko') { b.t = b.dur; continue; }
    const o = handPos(f, 'fh', 'castF'); b.ox = o.x; b.oy = o.y;
    if (tgt.state !== 'ko') {
      const want = aimAng(o, tgt);
      let da = want - b.ang; while (da > Math.PI) da -= Math.PI * 2; while (da < -Math.PI) da += Math.PI * 2;
      b.ang += clamp(da, -b.track * dt, b.track * dt);
    }
    b.len = Math.min(b.maxLen, b.len + 3400 * dt);
    const c = center(tgt), dT = Math.hypot(c.x - o.x, c.y - o.y);
    const ex = o.x + Math.cos(b.ang) * b.len, ey = o.y + Math.sin(b.ang) * b.len;
    const onLine = segDist(c.x, c.y, o.x, o.y, ex, ey) < b.w * 0.5 + 34 * fsize(tgt);
    if (onLine && (tgt.reflect > 0 || (tgt.dome > 0 && b.kind !== 'pierce'))) { b.len = Math.min(b.len, dT - (tgt.dome > 0 ? 110 : 70)); if (Math.random() < 0.5) addParts(o.x + Math.cos(b.ang) * b.len, o.y + Math.sin(b.ang) * b.len, 3, b.col, 300, 0.3, 4); }
    else if (onLine && tgt.phase <= 0) {
      if (tick(b, 'tick', 0.1, dt)) { hit(tgt, f, b.dps * 0.1, { kind: b.kind, kx: Math.cos(b.ang) * 320, ky: Math.sin(b.ang) * 320, stun: 0.18, quiet: true, special: b.special }); if (b.freeze && !tgt.guard) tgt.slow = Math.max(tgt.slow, 1.6); }
    }
    for (const p of proj) if (p.owner !== f && segDist(p.x, p.y, o.x, o.y, ex, ey) < b.w * 0.5 + p.r) { p.dead = true; addParts(p.x, p.y, 6, b.col, 250, 0.25, 3); }
  }
  beams = beams.filter(b => b.t < b.dur);
  }
  // entities
  for (const e of ents) { e.t += dt; e.update && e.update(e, dt); if (e.dur && e.t > e.dur) e.dead = true; }
  ents = ents.filter(e => !e.dead);
  for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= Math.pow(0.15, dt); p.vy *= Math.pow(0.15, dt); p.life -= dt; }
  parts = parts.filter(p => p.life > 0);
  if (parts.length > 700) parts.splice(0, parts.length - 700);
  for (const g of ghosts) g.t += dt;
  ghosts = ghosts.filter(g => g.t < 0.35);
}

/* ---------------- camera ---------------- */
function camTop() { return camera.y - H() / 2 / camera.z; }
function updateCamera(dt) {
  if (!P) return;
  let mx, my, zt;
  if (cine && cine.type === 'transform') { const c = center(cine.f); mx = c.x; my = c.y; zt = H() / 420; }
  else {
    mx = (P.x + E.x) / 2; my = (P.y + E.y) / 2 - 40;
    const spanX = Math.abs(P.x - E.x) + 720, spanY = Math.abs(P.y - E.y) + 540;
    zt = clamp(Math.min(W() / spanX, H() / spanY), H() / 1500, H() / 560);
  }
  const k = 1 - Math.exp(-dt * (cine ? 3 : 4));
  camera.z = lerp(camera.z, zt, k); camera.x = lerp(camera.x, mx, k); camera.y = lerp(camera.y, my, k);
  const vw = W() / camera.z, vh = H() / camera.z;
  camera.x = vw > WORLD.w + 400 ? WORLD.w / 2 : clamp(camera.x, vw / 2 - 200, WORLD.w + 200 - vw / 2);
  camera.y = Math.min(camera.y, WORLD.ground + 260 - vh / 2);
}

/* ---------------- drawing ---------------- */
function worldTransform() {
  const D = R2.DPR, sx = shake > 0 ? (Math.random() - 0.5) * shake * 30 : 0, sy = shake > 0 ? (Math.random() - 0.5) * shake * 30 : 0;
  ctx.setTransform(D * camera.z, 0, 0, D * camera.z, D * (W() / 2 - camera.x * camera.z + sx), D * (H() / 2 - camera.y * camera.z + sy));
}
function drawProjectiles() {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const p of proj) {
    if (p.type === 'disc') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.spin); ctx.fillStyle = 'rgba(220,240,255,.9)';
      ctx.beginPath(); ctx.arc(0, 0, p.r * 1.3, 0, Math.PI * 2); ctx.arc(p.r * 0.45, 0, p.r * 1.05, 0, Math.PI * 2, true); ctx.fill(); ctx.restore();
      glowOrb(ctx, p.x, p.y, p.r * 0.5, '#c7a8ff');
    } else if (p.type === 'void') {
      glowOrb(ctx, p.x, p.y, p.r, '#9b4dff', '#2a0040');
      ctx.strokeStyle = 'rgba(220,160,255,.6)'; ctx.lineWidth = 3; for (let i = 0; i < 3; i++) { const a = time * 4 + i * 2; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 1.4, a, a + 1.2); ctx.stroke(); }
    } else if (p.type === 'missile') {
      const a = Math.atan2(p.vy, p.vx); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a); ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = '#d8dde4'; ctx.fillRect(-12, -4, 20, 8); ctx.fillStyle = '#ff8a1a'; ctx.beginPath(); ctx.moveTo(8, -4); ctx.lineTo(16, 0); ctx.lineTo(8, 4); ctx.fill(); ctx.restore();
      glowOrb(ctx, p.x - Math.cos(a) * 14, p.y - Math.sin(a) * 14, 6, '#ffb02a');
    } else if (p.type === 'boulder') {
      ctx.save(); ctx.globalCompositeOperation = 'source-over'; ctx.translate(p.x, p.y); ctx.rotate(p.spin * 0.2);
      ctx.fillStyle = '#7a6450'; ctx.beginPath(); ctx.moveTo(-30, -10); ctx.lineTo(-12, -30); ctx.lineTo(18, -26); ctx.lineTo(32, 2); ctx.lineTo(16, 28); ctx.lineTo(-20, 24); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#3a2e22'; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
    } else if (p.type === 'spear') {
      const a = Math.atan2(p.vy, p.vx); ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
      const g = ctx.createLinearGradient(-90, 0, 30, 0); g.addColorStop(0, 'rgba(255,230,140,0)'); g.addColorStop(1, '#fffbe6');
      ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(-90, -5); ctx.lineTo(10, -6); ctx.lineTo(36, 0); ctx.lineTo(10, 6); ctx.lineTo(-90, 5); ctx.fill(); ctx.restore();
    } else if (p.type === 'shuriken') {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.spin); ctx.fillStyle = '#c2fff0';
      ctx.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? 5 : 16, a = i / 8 * Math.PI * 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.fill(); ctx.restore();
    } else if (p.type === 'laser') {
      const a = Math.atan2(p.vy, p.vx); ctx.strokeStyle = p.col; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(p.x - Math.cos(a) * 40, p.y - Math.sin(a) * 40); ctx.lineTo(p.x, p.y); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
    } else glowOrb(ctx, p.x, p.y, p.r, p.col);
  }
  ctx.restore();
}
function drawBeams() {
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const b of beams) {
    if (b.ox === undefined) continue;
    const fade = clamp((b.dur - b.t) / 0.2, 0, 1), w = b.w * fade * (1 + 0.08 * Math.sin(time * 40)), L = b.len;
    ctx.save(); ctx.translate(b.ox, b.oy); ctx.rotate(b.ang);
    ctx.fillStyle = alpha(b.col2, 0.25); ctx.fillRect(0, -w * 1.2, L, w * 2.4);
    ctx.fillStyle = alpha(b.col, 0.75); ctx.fillRect(0, -w * 0.5, L, w);
    ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fillRect(0, -w * 0.18, L, w * 0.36);
    if (b.style === 'electric') { for (let k = 0; k < 2; k++) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(0, 0); for (let x = 0; x < L; x += 40) ctx.lineTo(x, rand(-w, w)); ctx.stroke(); } }
    if (b.style === 'rail') { ctx.strokeStyle = alpha(b.col2, 0.7); ctx.lineWidth = 3; for (let x = (time * 900) % 120; x < L; x += 120) { ctx.beginPath(); ctx.ellipse(x, 0, 10, w * 1.1, 0, 0, Math.PI * 2); ctx.stroke(); } }
    if (b.style === 'ice') { ctx.fillStyle = '#ffffff'; for (let x = (time * 500) % 70; x < L; x += 70) { ctx.save(); ctx.translate(x, Math.sin(x + time * 9) * w * 0.6); ctx.rotate(time * 3 + x); ctx.fillRect(-4, -4, 8, 8); ctx.restore(); } }
    ctx.restore();
    glowOrb(ctx, b.ox, b.oy, w * 0.9, b.col);
    glowOrb(ctx, b.ox + Math.cos(b.ang) * L, b.oy + Math.sin(b.ang) * L, w * 0.8, b.col);
  }
  ctx.restore();
}
function drawStatusFx(f) {
  const c = center(f);
  if (f.reflect > 0) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = `rgba(200,240,255,${0.5 + 0.3 * Math.sin(time * 10)})`; ctx.lineWidth = 4;
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; ctx.lineTo(c.x + f.face * 70 + Math.cos(a) * 30, c.y + Math.sin(a) * 110); } ctx.closePath(); ctx.stroke(); ctx.restore();
  }
  if (f.dome > 0) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(c.x, c.y, 60, c.x, c.y, 120); g.addColorStop(0, 'rgba(255,230,140,0)'); g.addColorStop(0.85, 'rgba(255,230,140,.25)'); g.addColorStop(1, 'rgba(255,250,220,.6)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(c.x, c.y, 120, 0, Math.PI * 2); ctx.fill(); ctx.restore();
  }
  if (f.exposed > 0) { ctx.strokeStyle = `rgba(255,79,109,${f.exposed})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(c.x, c.y, 80, 0, Math.PI * 2); ctx.stroke(); }
}
function drawPhoenix(f) {
  ctx.save(); ctx.translate(f.x, f.y - 30); ctx.scale(Math.sign(f.vx) || f.face, 1); ctx.globalCompositeOperation = 'lighter';
  const flap = Math.sin(time * 30) * 0.5;
  for (const [col, sc] of [['rgba(255,90,26,.8)', 1.25], ['rgba(255,176,42,.85)', 1], ['rgba(255,242,176,.9)', 0.55]]) {
    ctx.fillStyle = col; ctx.save(); ctx.scale(sc, sc);
    ctx.beginPath(); ctx.ellipse(0, 0, 60, 22, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, -5); ctx.quadraticCurveTo(-30, -90 - flap * 60, -110, -70 - flap * 40); ctx.quadraticCurveTo(-50, -30, -20, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(10, 5); ctx.quadraticCurveTo(-30, 90 + flap * 60, -110, 70 + flap * 40); ctx.quadraticCurveTo(-50, 30, -20, 0); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-50, 0); ctx.lineTo(-170, -26); ctx.lineTo(-140, 0); ctx.lineTo(-170, 26); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

function drawScreenText(dt) {
  const D = R2.DPR; ctx.setTransform(D, 0, 0, D, 0, 0);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  banners = banners.filter(b => (b.t += dt) < 1.5);
  for (const b of banners) {
    const k = b.t < 0.15 ? b.t / 0.15 : b.t > 1.2 ? 1 - (b.t - 1.2) / 0.3 : 1, big = b.side === 'center';
    const y = big ? H() * 0.42 : H() * 0.22;
    const xOff = big ? 0 : (b.side === 'left' ? -1 : 1) * (1 - Math.min(1, b.t / 0.15)) * W() * 0.4;
    ctx.globalAlpha = clamp(k, 0, 1);
    ctx.save(); ctx.translate(W() / 2 + xOff, y); ctx.transform(1, 0, -0.18, 1, 0, 0);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(-W(), -38, W() * 2, 76);
    ctx.fillStyle = b.col; ctx.fillRect(-W(), -38, W() * 2, 4); ctx.fillRect(-W(), 34, W() * 2, 4);
    ctx.font = `${Math.round(Math.min(W() * (big ? 0.11 : 0.06), big ? 104 : 56))}px ${DISPLAY}`;
    ctx.lineWidth = 8; ctx.strokeStyle = '#000'; ctx.strokeText(b.text.toUpperCase(), 0, 2); ctx.fillStyle = b.col; ctx.fillText(b.text.toUpperCase(), 0, 2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  texts = texts.filter(t => (t.t += dt) < 1);
  for (const t of texts) {
    let x = t.x, y = t.y;
    if (t.world) { x = W() / 2 + (t.x - camera.x) * camera.z; y = H() / 2 + (t.y - camera.y) * camera.z; }
    ctx.globalAlpha = clamp(t.t > 0.7 ? 1 - (t.t - 0.7) / 0.3 : 1, 0, 1);
    ctx.font = `${Math.round(40 * t.size)}px ${DISPLAY}`;
    ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.strokeText(t.txt, x, y - t.t * 40); ctx.fillStyle = t.col; ctx.fillText(t.txt, x, y - t.t * 40);
  }
  ctx.globalAlpha = 1;
  if (mode === 'intro') {
    const txt = introT > 0.6 ? 'READY' : 'FIGHT!';
    ctx.font = `${Math.round(Math.min(W() * 0.13, 120))}px ${DISPLAY}`;
    ctx.lineWidth = 10; ctx.strokeStyle = '#000'; ctx.strokeText(txt, W() / 2, H() * 0.42);
    ctx.fillStyle = introT > 0.6 ? '#eaf4f2' : '#ffd23a'; ctx.fillText(txt, W() / 2, H() * 0.42);
  }
}
function drawLetterbox(k) { const h = H() * 0.11 * k; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W(), h); ctx.fillRect(0, H() - h, W(), h); }
function drawSpeedLines(k, col = '#ffffff') {
  ctx.save(); ctx.globalAlpha = k; ctx.strokeStyle = col; ctx.lineWidth = 2;
  for (let i = 0; i < 60; i++) { const a = Math.random() * Math.PI * 2, r1 = Math.max(W(), H()) * (0.35 + Math.random() * 0.2); ctx.beginPath(); ctx.moveTo(W() / 2 + Math.cos(a) * r1, H() / 2 + Math.sin(a) * r1); ctx.lineTo(W() / 2 + Math.cos(a) * r1 * 2, H() / 2 + Math.sin(a) * r1 * 2); ctx.stroke(); }
  ctx.restore();
}
const vsCanvas = [document.createElement('canvas'), document.createElement('canvas')];
function drawCine() {
  const c = cine, D = R2.DPR; ctx.setTransform(D, 0, 0, D, 0, 0);
  if (c.type === 'vs') {
    if (c.t < 0.02) { for (const [i, f] of [[0, P], [1, E]]) { vsCanvas[i].width = 520; vsCanvas[i].height = 640; portrait(vsCanvas[i], f.ch, 'full', 0); } }
    const k = Math.min(1, c.t / 0.35), out = c.t > c.dur - 0.35 ? (c.t - (c.dur - 0.35)) / 0.35 : 0;
    ctx.fillStyle = `rgba(4,8,12,${0.92 * (1 - out)})`; ctx.fillRect(0, 0, W(), H());
    ctx.globalAlpha = 1 - out;
    const pw = Math.min(W() * 0.42, H() * 0.75 * 0.81), ph = pw / 0.81;
    ctx.save(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(W() * 0.56, 0); ctx.lineTo(W() * 0.44, H()); ctx.lineTo(0, H()); ctx.clip();
    ctx.drawImage(vsCanvas[0], lerp(-pw, W() * 0.06, k), (H() - ph) / 2, pw, ph); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.moveTo(W() * 0.56, 0); ctx.lineTo(W(), 0); ctx.lineTo(W(), H()); ctx.lineTo(W() * 0.44, H()); ctx.clip();
    ctx.translate(W(), 0); ctx.scale(-1, 1); ctx.drawImage(vsCanvas[1], lerp(-pw, W() * 0.06, k), (H() - ph) / 2, pw, ph); ctx.restore();
    ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(W() * 0.56, 0); ctx.lineTo(W() * 0.44, H()); ctx.stroke();
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(Math.min(W() * 0.12, 130) * (1.6 - 0.6 * k))}px ${DISPLAY}`; ctx.lineWidth = 10; ctx.strokeStyle = '#000'; ctx.strokeText('VS', W() / 2, H() / 2); ctx.fillStyle = '#ffd23a'; ctx.fillText('VS', W() / 2, H() / 2);
    ctx.font = `${Math.round(Math.min(W() * 0.045, 44))}px ${DISPLAY}`;
    ctx.fillStyle = P.ch.c.aura[0]; ctx.strokeText(P.ch.name.toUpperCase(), W() * 0.22, H() * 0.86); ctx.fillText(P.ch.name.toUpperCase(), W() * 0.22, H() * 0.86);
    ctx.fillStyle = E.ch.c.aura[0]; ctx.strokeText(E.ch.name.toUpperCase(), W() * 0.78, H() * 0.86); ctx.fillText(E.ch.name.toUpperCase(), W() * 0.78, H() * 0.86);
    ctx.font = `600 ${Math.round(Math.min(W() * 0.022, 20))}px ${UIF}`; ctx.fillStyle = '#eaf4f2';
    ctx.fillText(P.ch.title, W() * 0.22, H() * 0.91); ctx.fillText(E.ch.title, W() * 0.78, H() * 0.91);
    ctx.fillText(STAGES[cfg.stage].name.toUpperCase(), W() / 2, H() * 0.12);
    ctx.globalAlpha = 1;
  } else if (c.type === 'cutin') {
    const k = Math.min(1, c.t / 0.18), out = c.t > c.dur - 0.15 ? (c.t - (c.dur - 0.15)) / 0.15 : 0;
    ctx.fillStyle = `rgba(0,0,0,${0.5 * (1 - out)})`; ctx.fillRect(0, 0, W(), H());
    drawSpeedLines(0.5 * (1 - out), auraCol(c.f));
    const bh = H() * 0.34, y = H() * 0.33;
    ctx.save(); ctx.globalAlpha = 1 - out;
    ctx.translate(lerp(c.f === P ? -W() : W(), 0, k), 0);
    ctx.beginPath(); ctx.moveTo(0, y + 30); ctx.lineTo(W(), y - 30); ctx.lineTo(W(), y + bh - 30); ctx.lineTo(0, y + bh + 30); ctx.closePath();
    const g = ctx.createLinearGradient(0, 0, W(), 0); g.addColorStop(0, alpha(c.f.ch.c.bg, 0.95)); g.addColorStop(1, alpha(auraCol(c.f), 0.55));
    ctx.fillStyle = g; ctx.fill(); ctx.save(); ctx.clip();
    const ps = bh * 1.5; ctx.drawImage(cutinCanvas, c.f === P ? W() * 0.08 : W() * 0.92 - ps, y + bh / 2 - ps / 2 + 20, ps, ps);
    ctx.restore();
    ctx.strokeStyle = auraCol(c.f); ctx.lineWidth = 4; ctx.stroke();
    ctx.textAlign = c.f === P ? 'right' : 'left'; ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(Math.min(W() * 0.07, 76))}px ${DISPLAY}`; ctx.lineWidth = 9; ctx.strokeStyle = '#000';
    const tx = c.f === P ? W() * 0.94 : W() * 0.06;
    ctx.strokeText(c.mv.name.toUpperCase(), tx, y + bh / 2); ctx.fillStyle = '#ffffff'; ctx.fillText(c.mv.name.toUpperCase(), tx, y + bh / 2);
    ctx.font = `700 ${Math.round(Math.min(W() * 0.02, 18))}px ${UIF}`; ctx.fillStyle = auraCol(c.f);
    ctx.fillText(`${c.f.ch.name.toUpperCase()} · ${c.f.ch.forms[c.f.form].toUpperCase()}`, tx, y + bh / 2 + 50);
    ctx.restore();
  } else if (c.type === 'transform') {
    const k = Math.min(1, c.t / 0.4);
    drawLetterbox(k);
    if (c.t < 2.15) { ctx.fillStyle = `rgba(0,0,0,${0.35 * k})`; ctx.fillRect(0, H() * 0.11, W(), H() * 0.78); }
    const flash = c.t > 2.15 ? Math.max(0, 1 - (c.t - 2.15) / 0.5) : 0;
    if (flash > 0) { ctx.fillStyle = `rgba(255,255,255,${flash})`; ctx.fillRect(0, 0, W(), H()); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (c.t < 2.15) { ctx.font = `700 ${Math.round(Math.min(W() * 0.024, 22))}px ${UIF}`; ctx.fillStyle = '#eaf4f2'; ctx.fillText(`${c.f.ch.name.toUpperCase()} IS POWERING UP`, W() / 2, H() * 0.94); }
    else { ctx.font = `700 ${Math.round(Math.min(W() * 0.024, 22))}px ${UIF}`; ctx.fillStyle = auraCol(c.f); ctx.fillText(`${FORM_NAMES[c.f.form].toUpperCase()} FORM · NEW MOVES UNLOCKED`, W() / 2, H() * 0.94); }
  }
}

function render(dt) {
  const D = R2.DPR;
  ctx.setTransform(D, 0, 0, D, 0, 0);
  drawSky(ctx, camera, time);
  drawLayers(ctx, camera, WORLD.ground);
  if (!P) { drawWeather(ctx, dt, time); return; }
  worldTransform();
  drawGround(ctx, WORLD.ground, WORLD.w, time);
  for (const f of [P, E]) {
    const h = clamp((WORLD.ground - f.y) / 900, 0, 1);
    ctx.fillStyle = `rgba(10,6,4,${0.45 - h * 0.3})`; ctx.beginPath(); ctx.ellipse(f.x, WORLD.ground + 6, 60 * f.ch.size * (1 - h * 0.5), 12 * (1 - h * 0.5), 0, 0, Math.PI * 2); ctx.fill();
  }
  for (const g of ghosts) drawGhost(ctx, g.s, g.col, 0.35 * (1 - g.t / 0.35));
  for (const e of ents) if (e.back) e.draw(e, ctx);
  for (const f of [E, P]) {
    if (f.hidden) { if (!f.noPhoenix) drawPhoenix(f); continue; }
    drawFighter(ctx, f, time);
    drawStatusFx(f);
  }
  drawProjectiles(); drawBeams();
  for (const e of ents) if (!e.back && e.draw) e.draw(e, ctx);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  for (const p of parts) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  ctx.setTransform(D, 0, 0, D, 0, 0);
  drawWeather(ctx, dt, time);
  const v = ctx.createRadialGradient(W() / 2, H() / 2, Math.min(W(), H()) * 0.4, W() / 2, H() / 2, Math.max(W(), H()) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.5)');
  ctx.fillStyle = v; ctx.fillRect(0, 0, W(), H());
  if (P.slow > 0 || P.frozen > 0) { ctx.fillStyle = `rgba(160,230,255,${Math.min(0.22, (P.slow + P.frozen) * 0.15)})`; ctx.fillRect(0, 0, W(), H()); }
  if (P.hp < 25 && mode === 'fight') { ctx.fillStyle = `rgba(160,0,20,${0.1 + 0.07 * Math.sin(time * 6)})`; ctx.fillRect(0, 0, W(), H()); }
  if (speedLines > 0) drawSpeedLines(speedLines * 2, auraCol(P));
  drawScreenText(dt);
  if (cine) drawCine();
  if (impactT > 0) { ctx.save(); ctx.globalCompositeOperation = 'difference'; ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W(), H()); ctx.restore(); }
}

/* ---------------- HUD ---------------- */
function inputIcon(cnv, inp, accent) {
  if (inp.type === 'gesture') drawMan(cnv, inp.key, accent);
  else if (inp.type === 'sign') drawSign(cnv, inp.key, accent);
  else { const c = cnv.getContext('2d'); const a = document.createElement('canvas'), b = document.createElement('canvas'); a.width = b.width = a.height = b.height = cnv.width;
    drawSign(a, inp.signs[0], accent); drawSign(b, inp.signs[1], accent);
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cnv.width, cnv.height); c.drawImage(a, 0, cnv.height * 0.1, cnv.width * 0.55, cnv.height * 0.55); c.drawImage(b, cnv.width * 0.45, cnv.height * 0.35, cnv.width * 0.55, cnv.height * 0.55); }
}
function inputText(inp) {
  if (inp.type === 'gesture') return GESTURES[inp.key].short;
  if (inp.type === 'sign') return `Sign ${SIGNS[inp.key].emoji}`;
  return `Seal ${SIGNS[inp.signs[0]].emoji} → ${SIGNS[inp.signs[1]].emoji}`;
}
const KEYS_FOR = { s1: 'U', s2: 'O', ult: 'I', sup: 'P' };
function setupHud() {
  for (const [id, f] of [['#pl1', P], ['#pl2', E]]) {
    const el = $(id);
    el.querySelector('.nm').textContent = `${f.ch.name}${f.form ? ' · ' + f.ch.forms[f.form] : ''}${f === E && cfg.training ? ' · training' : ''}`;
    portrait(el.querySelector('.face'), f.ch, 'face', f.form);
  }
  const tray = $('#tray'); tray.innerHTML = '';
  for (const slot of ['s1', 's2', 'ult', 'sup']) {
    const mv = P.ch.moves[slot], d = document.createElement('div'); d.className = 'mv'; d.id = 'mv-' + slot;
    const sub = inputMode === 'cam' ? inputText(mv.input) : `Key ${KEYS_FOR[slot]}`;
    d.innerHTML = `<canvas width="88" height="88"></canvas><b>${mv.name}</b><span>${sub} · ${mv.cost} ki</span><div class="prog"><i></i></div>`;
    tray.appendChild(d);
    inputIcon(d.querySelector('canvas'), mv.input, slot === 'sup' ? '#c7a8ff' : slot === 'ult' ? '#ff4f6d' : '#ffd23a');
  }
  const tf = document.createElement('div'); tf.className = 'mv tf'; tf.id = 'mv-tf';
  tf.innerHTML = `<canvas width="88" height="88"></canvas><b>Transform</b><span>${inputMode === 'cam' ? 'Hold fists low' : 'Key T'} · full Surge</span><div class="prog"><i></i></div>`;
  tray.appendChild(tf); drawMan(tf.querySelector('canvas'), 'charge', '#8affd6');
}
function updateHud() {
  for (const [id, f] of [['#pl1', P], ['#pl2', E]]) {
    const el = $(id);
    el.querySelector('.hp i').style.width = f.hp + '%'; el.querySelector('.hp s').style.width = f.hp + '%';
    el.querySelector('.ki i').style.width = f.ki + '%';
    el.querySelector('.surge i').style.width = f.surge + '%';
    el.querySelector('.surge').classList.toggle('full', f.surge >= 100 && f.form < 2);
    el.querySelector('.forms').textContent = '◆'.repeat(f.form) + '◇'.repeat(2 - f.form);
  }
  $('#timer').textContent = cfg.training ? '∞' : Math.ceil(clockT);
  for (const slot of ['s1', 's2', 'ult', 'sup']) {
    const el = $('#mv-' + slot); if (!el) continue;
    const mv = P.ch.moves[slot], locked = mv.form > P.form;
    const gs = Track.gs[slot];
    let prog = P.ki / mv.cost;
    if (inputMode === 'cam' && gs && gs.prog > 0) prog = gs.prog;
    if (slot === 'sup' && P.seal) prog = 0.5;
    el.classList.toggle('locked', locked || P.ki < mv.cost);
    el.classList.toggle('armed', !!(gs && gs.armed) || (slot === 'sup' && !!P.seal));
    el.querySelector('.prog i').style.width = `${clamp(prog, 0, 1) * 100}%`;
    el.querySelector('span').textContent = locked ? `Unlocks in ${FORM_NAMES[mv.form]} form` : `${inputMode === 'cam' ? inputText(mv.input) : 'Key ' + KEYS_FOR[slot]} · ${mv.cost} ki`;
  }
  const tf = $('#mv-tf');
  if (tf) { tf.classList.toggle('armed', P.surge >= 100 && P.form < 2); tf.classList.toggle('locked', P.surge < 100 || P.form >= 2); tf.querySelector('.prog i').style.width = (P.form >= 2 ? 100 : P.surge) + '%'; }
  if (Snd.chargeGain) Snd.chargeGain.gain.setTargetAtTime(P.charging ? 0.35 : 0, Snd.ac.currentTime, 0.08);
}

/* ---------------- webcam monitor ---------------- */
const pc = $('#pipc'), px = pc.getContext('2d');
const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];
function drawPip() {
  if ($('#pip').hidden) return;
  const w = pc.width, h = pc.height, v = Track.video;
  px.save(); px.translate(w, 0); px.scale(-1, 1);
  if (v && v.readyState >= 2) px.drawImage(v, 0, 0, w, h); else { px.fillStyle = '#000'; px.fillRect(0, 0, w, h); }
  px.restore();
  px.fillStyle = 'rgba(6,14,20,.35)'; px.fillRect(0, 0, w, h);
  const lm = Track.lm, F = Track.F;
  if (lm) {
    const Q = i => [(1 - lm[i].x) * w, lm[i].y * h];
    px.lineWidth = 4; px.lineCap = 'round';
    for (const [a, b] of BONES) {
      const side = [13, 15].includes(b) ? 'L' : [14, 16].includes(b) ? 'R' : null;
      px.strokeStyle = side && Track.arms[side].on ? '#ffd23a' : Track.guard ? '#7fd0ff' : 'rgba(234,244,242,.85)';
      px.beginPath(); px.moveTo(...Q(a)); px.lineTo(...Q(b)); px.stroke();
    }
  }
  if (F) {
    const sx = w / F.vw, sy = h / F.vh;
    for (const side of ['L', 'R']) {
      const pts = Track.hands[side], held = Track.hands.held[side];
      if (pts) { px.fillStyle = held ? '#ffd23a' : '#7fd0ff'; for (const q of pts) { px.beginPath(); px.arc(q.x * sx, q.y * sy, 1.8, 0, Math.PI * 2); px.fill(); } }
      if (held) { const p = pts ? pts[9] : null; if (p) { px.font = '700 22px sans-serif'; px.textAlign = 'center'; px.fillText(SIGNS[held].emoji, p.x * sx, p.y * sy - 30); } }
    }
  }
  // arm meters with learned thresholds
  for (const [i, side] of [[0, 'L'], [1, 'R']]) {
    const y = h - 26 + i * 12, A = Track.arms[side], pr = Track.prof;
    px.fillStyle = 'rgba(0,0,0,.6)'; px.fillRect(6, y - 2, w - 12, 10);
    px.fillStyle = A.on ? '#ffd23a' : '#8fb0b0'; px.fillRect(8, y, (w - 16) * clamp(A.e, 0, 1), 6);
    px.fillStyle = '#ff4f6d'; px.fillRect(8 + (w - 16) * pr.on[side], y - 2, 2, 10);
    px.fillStyle = '#49e39a'; px.fillRect(8 + (w - 16) * pr.off[side], y - 2, 2, 10);
  }
  let st = '';
  const armed = Object.entries(Track.gs).find(([, s]) => s.armed);
  if (armed && P) { const mv = P.ch.moves[armed[0]]; st = `${mv.name}: ${({ palms: 'THRUST!', overhead: 'SLAM!', oneup: 'SWING!', tpose: 'CLAP!', xburst: 'FLING!' })[mv.input.key] || 'GO!'}`; }
  else if (performance.now() - Track.body.lastT < 800 && Track.body.last) st = ({ vanish: 'VANISH', rush: 'RUSH', blinkU: 'BLINK ↑', blinkL: 'BLINK ←', blinkR: 'BLINK →' })[Track.body.last];
  else if (Track.guard) st = 'GUARD';
  else if (Track.charge) st = P && P.surge >= 100 && P.form < 2 ? 'POWERING UP…' : 'CHARGING';
  else if (P && P.seal) st = `SEAL: now ${SIGNS[P.ch.moves.sup.input.signs[1]].emoji}`;
  $('#pstate').textContent = st;
  $('#lost').hidden = !Track.ready || !!(F && F.body);
}

/* ---------------- input routing ---------------- */
function handleEvent(ev) {
  if (NETG()) { if (mode === 'fight' && !cine && P) { netSend({ t: 'ev', e: ev }); if (ev === 'punch') { stats.punches++; P.lastPunchT = time; } } return; }
  handleEventFor(P, ev);
}
function handleEventFor(f, ev) {
  if (mode !== 'fight' || cine || !f) return;
  const o = other(f);
  if (ev === 'punch') { doPunch(f, o); return; }
  if (ev === 's1' || ev === 's2' || ev === 'ult' || ev === 'sup') { castSpecial(f, o, ev); return; }
  if (ev === 'vanish') return doVanish(f);
  if (ev === 'rush') return doRush(f);
  if (ev === 'blinkU') return doBlink(f, 0, -1);
  if (ev === 'blinkL') return doBlink(f, -1, 0);
  if (ev === 'blinkR') return doBlink(f, 1, 0);
  if (ev === 'transform') { if (f.surge < 100) fnote(f, 'Fill the Surge meter first: land hits, take hits, or charge.'); else if (f.form >= 2) fnote(f, 'Already in Apex form'); else transform(f); return; }
  if (typeof ev === 'string' && ev.startsWith('sign:')) {
    const s = ev.slice(5), mv = f.ch.moves;
    for (const slot of ['s1', 's2']) if (mv[slot].input.type === 'sign' && mv[slot].input.key === s) { castSpecial(f, o, slot); return; }
    const seq = mv.sup.input.signs;
    if (s === seq[0]) { f.seal = { t: time }; fnote(f, `Seal started. Now show ${SIGNS[seq[1]].emoji}`); return; }
    if (f.seal && s === seq[1] && time - f.seal.t < 2.5) { f.seal = null; castSpecial(f, o, 'sup'); }
  }
}
const KMAP = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', k: 'guard', l: 'charge' };
const KEV = { j: 'punch', u: 's1', o: 's2', i: 'ult', p: 'sup', q: 'vanish', e: 'rush', t: 'transform', ' ': 'blinkU' };
addEventListener('keydown', ev => {
  const k = ev.key.toLowerCase();
  if (k === 'escape' && mode !== 'menu') { if (Net.connected) netSend({ t: 'left' }); toMenu(); return; }
  if (k === 'm') { setMuted(!Snd.muted); note(Snd.muted ? 'Sound off' : 'Sound on'); return; }
  if (k === 'n' && Snd.ac) { musicNext(1); return; }
  if (mode === 'menu' || mode === 'setup') return;
  if (KMAP[k]) { keys[KMAP[k]] = true; ev.preventDefault(); }
  if (ev.repeat) return;
  if (KEV[k]) { ev.preventDefault(); handleEvent(KEV[k]); }
});
addEventListener('keyup', ev => { const k = KMAP[ev.key.toLowerCase()]; if (k) keys[k] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// gamepad
const gpPrev = {};
function pollGamepad() {
  const gps = navigator.getGamepads ? navigator.getGamepads() : [];
  const gp = gps && [...gps].find(g => g);
  if (!gp) return null;
  const btn = i => gp.buttons[i] && gp.buttons[i].pressed;
  const map = { 0: 'punch', 1: 'vanish', 3: 'rush', 5: 's1', 7: 's2', 6: 'ult', 4: 'sup', 9: 'transform' };
  for (const [i, ev] of Object.entries(map)) { const b = btn(+i); if (b && !gpPrev[i]) handleEvent(ev); gpPrev[i] = b; }
  const x = Math.abs(gp.axes[0]) > 0.18 ? gp.axes[0] : 0, y = Math.abs(gp.axes[1]) > 0.18 ? gp.axes[1] : 0;
  return { x, y, guard: btn(2), charge: btn(10) || btn(11) };
}

// phone controller (needs server.py)
function initPhoneLink() {
  if (!location.protocol.startsWith('http')) { $('#phoneBox').innerHTML = '<p class="fine">To use your phone as a joystick, start the game with <code>python3 server.py</code> and open the address it prints. Then this box shows a QR code.</p>'; return; }
  fetch('/info').then(r => r.json()).then(info => {
    pad.url = `http://${info.ip}:${info.port}/pad`;
    const box = $('#phoneBox'); box.innerHTML = '<div id="qr"></div><div><p class="fine">Scan with your phone (same Wi-Fi), then pick <b>Phone joystick</b> above.</p><p class="fine"><code>' + pad.url + '</code></p><p class="fine" id="padStatus">Phone not connected</p></div>';
    try { new QRCode($('#qr'), { text: pad.url, width: 120, height: 120, colorDark: '#081118', colorLight: '#eaf4f2' }); } catch (e) { /* QR library unavailable: the URL is still shown */ }
    const es = new EventSource('/relay/pad');
    es.onmessage = m => {
      try {
        const d = JSON.parse(m.data); pad.lastT = performance.now(); pad.x = d.x || 0; pad.y = d.y || 0;
        const now = new Set(d.b || []);
        for (const b of now) if (!pad.pressed.has(b) && b !== 'guard') handleEvent(b);
        pad.pressed = now; pad.guard = now.has('guard');
        if (!pad.connected) { pad.connected = true; const s = $('#padStatus'); if (s) s.textContent = 'Phone connected ✓'; note('Phone connected'); }
      } catch (e) { /* ignore malformed */ }
    };
    setInterval(() => {
      if (!pad.connected || !P) return;
      fetch('/relay/feedback', { method: 'POST', body: JSON.stringify({ hp: Math.round(P.hp), ki: Math.round(P.ki), surge: Math.round(P.surge), form: P.form, ehp: Math.round(E.hp), hurt: P.state === 'hurt' }) }).catch(() => {});
    }, 250);
  }).catch(() => { $('#phoneBox').innerHTML = '<p class="fine">Phone link unavailable. Start the game with <code>python3 server.py</code>.</p>'; });
}

// transform: hold the charge pose for a second with a full Surge meter
function chargeTransform(f, dt) {
  if (f.inCharge && f.surge >= 100 && f.form < 2 && mode === 'fight' && !cine) { f.chargeHold += dt; if (f.chargeHold > 1) { f.chargeHold = 0; transform(f); } } else f.chargeHold = 0;
}
function applyPlayerInput(dt) {
  let mx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0), my = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  const gp = pollGamepad();
  if (!mx && !my && gp && (gp.x || gp.y)) { mx = gp.x; my = gp.y; }
  if (!mx && !my && pad.connected && performance.now() - pad.lastT < 600 && Math.hypot(pad.x, pad.y) > 0.15) { mx = pad.x; my = pad.y; }
  const manual = !!(mx || my);
  if (manual) { const m = Math.hypot(mx, my); if (m > 1) { mx /= m; my /= m; } P.inX = mx; P.inY = my; }
  else if (cfg.move === 'auto' && inputMode === 'cam' && mode === 'fight') {
    P.inX = P.inY = 0;
    const melee = time - P.lastPunchT < 0.9 && Math.abs(P.x - E.x) < 260;
    steerTo(P, E, melee ? 100 : P.ch.range, Math.sin(time * 0.8) * 50);
    P.inX *= 0.85; P.inY *= 0.85;
  } else { P.inX = 0; P.inY = 0; }
  P.inGuard = !!keys.guard || (gp && gp.guard) || pad.guard || (inputMode === 'cam' && Track.guard);
  P.inCharge = !!keys.charge || (gp && gp.charge) || (inputMode === 'cam' && Track.charge);
  if (NETG()) {
    Net.inT += dt;
    const i = { t: 'in', mx: Math.round(P.inX * 100) / 100, my: Math.round(P.inY * 100) / 100, guard: !!P.inGuard, charge: !!P.inCharge };
    const k = JSON.stringify(i);
    if (k !== Net.lastSentIn || Net.inT > 0.1) { Net.lastSentIn = k; Net.inT = 0; netSend(i); }
  } else chargeTransform(P, dt);
  while (Track.events.length) handleEvent(Track.events.shift());
}

/* ---------------- setup / calibration flow ---------------- */
const setup = { step: null, t: 0, noise: { L: [], R: [] }, count: 0 };
function setSetup(title, msg, prog = 0, buttons = []) {
  $('#setupTitle').textContent = title; $('#setupMsg').textContent = msg;
  $('#setupBar').style.width = `${clamp(prog, 0, 1) * 100}%`;
  const b = $('#setupBtns'); b.innerHTML = '';
  for (const [label, fn, primary] of buttons) { const el = document.createElement('button'); el.className = 'big' + (primary ? ' primary' : ''); el.type = 'button'; el.textContent = label; el.onclick = fn; b.appendChild(el); }
}
function beginSetup() {
  mode = 'setup'; setup.step = 'frame'; setup.t = 0;
  $('#menu').hidden = true; $('#setup').hidden = false; $('#pip').hidden = false; $('#pip').classList.add('big');
  setSetup('Get in frame', 'Step back until your head, shoulders and both hands are visible.');
}
function updateSetup(dt) {
  const F = Track.F, ok = F && F.body && F.okL && F.okR;
  if (setup.step === 'frame') {
    setup.t = ok ? setup.t + dt : 0;
    setSetup('Get in frame', ok ? 'Good. Now raise your guard.' : !(F && F.body) ? 'Step back until your head and shoulders are visible.' : 'Bring both hands up where the camera can see them.', setup.t / 1);
    if (setup.t > 1) { setup.step = 'guard'; calibStartGuard(); }
  } else if (setup.step === 'guard') {
    const done = calibGuardStep(dt);
    setSetup('Hold your guard', 'Fists up by your chin, elbows down. Stay still for two seconds.', Calib.t / 2);
    if (done) { setup.step = 'noise'; setup.noise = { L: [], R: [] }; }
  } else if (setup.step === 'noise') {
    setSetup('Hold your guard', 'Almost done…', 1);
    if (calibNoiseStep(dt, setup.noise)) {
      if (trackHasProfile() && Track.prof.trained) {
        setup.step = 'ask';
        setSetup('Punch profile found', 'You trained your punches before. Use that profile, or retrain now?', 1,
          [['Use saved profile', () => finishSetup(), true], ['Retrain punches', () => startTrain('L')]]);
      } else startTrain('L');
    }
  } else if (setup.step === 'train') {
    const n = calibPunchStep(dt);
    const side = Calib.side === 'L' ? 'LEFT' : 'RIGHT';
    setSetup(`Throw 5 punches with your ${side} hand`, `Real punches at the screen, back to guard each time. ${n} of 5 counted.`, n / 5,
      [['Skip training', () => finishSetup()]]);
    if (n >= 5 || Calib.t > 14) { calibFinishPunches(); if (Calib.side === 'L') startTrain('R'); else { Track.prof.trained = true; trackSaveProfile(); finishSetup(); } }
  }
}
function startTrain(side) { setup.step = 'train'; calibStartPunches(side); }
function finishSetup() { setup.step = null; $('#pip').classList.remove('big'); if (Net.connected) netSetReady(); else { $('#setup').hidden = true; startFight(); } }

/* ---------------- menu ---------------- */
function buildMenu() {
  const roster = $('#roster');
  CHARS.forEach((ch, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'pick'; b.setAttribute('aria-pressed', i === selIdx);
    b.innerHTML = `<canvas width="240" height="270"></canvas><b>${ch.name}</b><span>${ch.element}</span>`;
    b.addEventListener('click', () => { selIdx = i; if (Net.connected) netSend({ t: 'pick', ch: i }); document.querySelectorAll('.pick').forEach((p, k) => p.setAttribute('aria-pressed', k === i)); renderDetail(); });
    roster.appendChild(b); portrait(b.querySelector('canvas'), ch, 'full', 0);
  });
  const stages = $('#stages');
  STAGES.forEach((st, i) => {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'stg'; b.setAttribute('aria-pressed', i === cfg.stage);
    b.innerHTML = `<canvas width="200" height="90"></canvas><span>${st.name}</span>`;
    b.addEventListener('click', () => { if (Net.role === 'guest' && Net.connected) { note('The host picks the stage'); return; } cfg.stage = i; if (Net.connected) netSend({ t: 'stage', i }); document.querySelectorAll('.stg').forEach((p, k) => p.setAttribute('aria-pressed', k === i)); buildStage(st); if (Snd.ac && cfg.music < 0) musicPlay(st.track); });
    stages.appendChild(b);
    const c = b.querySelector('canvas').getContext('2d'), g = c.createLinearGradient(0, 0, 0, 90);
    st.sky.forEach((col, k) => g.addColorStop(k / (st.sky.length - 1), col)); c.fillStyle = g; c.fillRect(0, 0, 200, 90);
    c.fillStyle = st.far; c.beginPath(); c.moveTo(0, 90); for (let x = 0; x <= 200; x += 20) c.lineTo(x, 50 + Math.sin(x * 0.07 + i) * 14); c.lineTo(200, 90); c.fill();
    c.fillStyle = st.ground[0]; c.fillRect(0, 76, 200, 14);
  });
  const sel = $('#music');
  sel.innerHTML = '<option value="-1">Stage theme</option>' + TRACKS.map((t, i) => `<option value="${i}">${t.name}</option>`).join('');
  sel.addEventListener('change', () => { cfg.music = +sel.value; audioInit(); musicPlay(cfg.music >= 0 ? cfg.music : STAGES[cfg.stage].track); });
  Music.onChange = i => { const el = $('#nowPlaying'); if (el) el.textContent = `♪ ${TRACKS[i].name}`; };
  $('#musicPrev').onclick = () => { audioInit(); musicNext(-1); };
  $('#musicNext').onclick = () => { audioInit(); musicNext(1); };
  $('#musicVol').oninput = e => setMusicVol(+e.target.value);
  const basics = $('#basics');
  const B = [
    ['punch', 'Punch / blast', 'Snap a punch at the screen. Up close it hits, at range it fires a ki blast.'],
    ['cross', 'Guard', 'Cross your forearms in front of your face.'],
    ['charge', 'Charge ki', 'Drop both fists to your hips. With a full Surge meter, hold it to transform.'],
    ['duck', 'Vanish', 'Duck quickly. You teleport away. Right before a hit lands, it’s a Perfect Vanish and your rival is left open.'],
    ['lunge', 'Rush', 'Lunge toward the screen. You teleport to your rival and strike.'],
    ['hop', 'Blink', 'Hop to blink upward, or slip sideways to blink left or right.'],
  ];
  for (const [g, name, text] of B) { const d = document.createElement('div'); d.className = 'move'; d.innerHTML = `<canvas width="140" height="140"></canvas><div><b>${name}</b><p>${text}</p></div>`; basics.appendChild(d); drawMan(d.querySelector('canvas'), g); }
  renderDetail();
  initPhoneLink();
}
function renderDetail() {
  const ch = CHARS[selIdx], el = $('#detail');
  const bar = v => `<div class="stat"><i style="width:${Math.round(clamp(v, 0, 1) * 100)}%"></i></div>`;
  const tag = s => ({ s1: ['SPECIAL', ''], s2: ['SPECIAL', ''], ult: ['ULTIMATE · ASCENDED', 'ult'], sup: ['SUPER · APEX', 'sup'] })[s];
  el.innerHTML = `<div class="dname"><h2 style="color:${ch.c.aura[1]}">${ch.name}</h2><span>${ch.title} · ${ch.element}</span></div>
    <p class="fine">${ch.blurb}</p>
    <div class="stats"><span>Speed</span>${bar(ch.stats.speed / 550)}<span>Power</span>${bar(ch.stats.power)}<span>Toughness</span>${bar(1.6 - ch.stats.defense)}</div>
    <p class="fine"><b>Passive: ${ch.passive.name}.</b> ${ch.passive.desc}</p>
    <p class="fine"><b>Forms:</b> ${ch.forms.join(' → ')}</p>
    <div class="moves">${['s1', 's2', 'ult', 'sup'].map(s => { const m = ch.moves[s], [t, cl] = tag(s); const how = m.input.type === 'gesture' ? GESTURES[m.input.key].long : m.input.type === 'sign' ? `Hold the ${SIGNS[m.input.key].name} sign ${SIGNS[m.input.key].emoji} still for a moment.` : `Seal: ${SIGNS[m.input.signs[0]].emoji} then ${SIGNS[m.input.signs[1]].emoji} within 2.5 seconds.`;
      return `<div class="move"><canvas width="140" height="140" data-s="${s}"></canvas><div><b>${m.name}</b><span class="tag ${cl}">${t} · ${m.cost} KI</span><p>${m.desc}</p><p><strong>${how}</strong></p></div></div>`; }).join('')}</div>`;
  el.querySelectorAll('canvas[data-s]').forEach(c => { const s = c.dataset.s; inputIcon(c, ch.moves[s].input, s === 'sup' ? '#c7a8ff' : s === 'ult' ? '#ff4f6d' : '#ffd23a'); });
}
function readOpts() {
  cfg.diff = $('#diff').value; cfg.training = $('#training').checked; cfg.track = $('#track').value;
  cfg.move = document.querySelector('input[name=move]:checked').value;
  Track.sens = cfg.sens = parseFloat($('#sens').value); Track.bodySens = cfg.bodySens = parseFloat($('#bodySens').value);
  Track.signsOn = true;
}
function toMenu() {
  mode = 'menu'; P = E = null; cine = null; Net.active = false; Net.meReady = false; netLobbyUI();
  ['#hud', '#tray', '#result', '#setup', '#toast'].forEach(s => $(s).hidden = true);
  $('#pip').hidden = true; $('#pip').classList.remove('big');
  $('#menu').hidden = false;
  if (Snd.chargeGain) Snd.chargeGain.gain.setTargetAtTime(0, Snd.ac.currentTime, 0.05);
  Music.intensity = 0.45;
}
$('#btnCam').addEventListener('click', async () => {
  readOpts(); audioInit(); if (Music.idx < 0) musicPlay(cfg.music >= 0 ? cfg.music : 0);
  const btn = $('#btnCam'), err = $('#camErr'); err.hidden = true; btn.disabled = true;
  try {
    await trackStart(cfg.track, s => btn.textContent = s);
    inputMode = 'cam'; beginSetup();
  } catch (e) {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    err.textContent = denied ? 'Camera permission was blocked. Click the camera icon in the address bar, allow it, and try again.' : `Couldn’t start tracking: ${e && e.message ? e.message : e}. The models download on first run, so check your internet connection.`;
    err.hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Fight with camera'; }
});
$('#btnKeys').addEventListener('click', () => { readOpts(); audioInit(); if (Music.idx < 0) musicPlay(0); inputMode = 'keys'; if (Net.connected) netSetReady(); else startFight(); });
$('#btnAgain').addEventListener('click', () => { if (Net.connected) netSetReady(); else startFight(); });
$('#btnMenu').addEventListener('click', toMenu);
document.addEventListener('pointerdown', () => { if (!Snd.ac) { audioInit(); Music.intensity = 0.45; musicPlay(0); } }, { once: true });

/* ---------------- online play ---------------- */
const r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
function fSnap(f) {
  return { x: r1(f.x), y: r1(f.y), vx: r1(f.vx), vy: r1(f.vy), fa: f.face, hp: r1(f.hp), ki: r1(f.ki), su: r1(f.surge), fo: f.form, st: f.state, po: f.pose,
    ti: r2(f.tilt), au: r2(f.auraT), kr: r2(f.koRot), fl: r2(f.flash), g: f.guard ? 1 : 0, c: f.charging ? 1 : 0, h: f.hidden ? 1 : 0, np: f.noPhoenix ? 1 : 0,
    ph: r2(f.phase), rf: r2(f.reflect), dm: r2(f.dome), fz: r2(f.frozen), ex: r2(f.exposed), sl: r2(f.slow) };
}
function sendSnap() {
  netSend({ t: 's', m: mode, c: r1(clockT), f: [fSnap(P), fSnap(E)],
    p: proj.map(p => [p.id, p.type, r1(p.x), r1(p.y), r1(p.vx), r1(p.vy), p.r, p.col, r2(p.spin || 0)]),
    b: beams.filter(b => b.ox !== undefined).map(b => [r1(b.ox), r1(b.oy), r2(b.ang), r1(b.len), b.w, b.col, b.col2, b.style || '', r2(b.t), b.dur]) });
}
function applySnapF(f, d, dt) {
  const k = 1 - Math.exp(-dt * 20);
  if (Math.hypot(d.x - f.x, d.y - f.y) > 250) { f.x = d.x; f.y = d.y; } else { f.x = lerp(f.x, d.x, k); f.y = lerp(f.y, d.y, k); }
  Object.assign(f, { vx: d.vx, vy: d.vy, face: d.fa, hp: d.hp, ki: d.ki, surge: d.su, form: d.fo, state: d.st, pose: d.po, auraT: d.au, koRot: d.kr,
    guard: !!d.g, charging: !!d.c, hidden: !!d.h, noPhoenix: !!d.np, phase: d.ph, reflect: d.rf, dome: d.dm, frozen: d.fz, exposed: d.ex, slow: d.sl });
  f.flash = Math.max(f.flash - dt, d.fl); f.tilt = lerp(f.tilt, d.ti, k);
  lerpPose(f, POSES[f.pose] ? f.pose : 'idle', dt, f.state === 'punch' ? 45 : 16);
}
const guestSeen = new Set();
function guestStep(dt) {
  const s = Net.snap; if (!s || !P) return;
  if (s.m === 'fight' && mode === 'intro') mode = 'fight';
  clockT = s.c;
  applySnapF(E, s.f[0], dt); applySnapF(P, s.f[1], dt);
  if (Net.snapNew) {
    Net.snapNew = false;
    proj = s.p.map(([id, type, x, y, vx, vy, r, col, spin]) => {
      if (!guestSeen.has(id)) { guestSeen.add(id); if (type === 'blast') sfx.blast(); else if (type === 'laser') sfx.laser(); }
      return { id, type, x, y, vx, vy, r, col, spin };
    });
    if (guestSeen.size > 3000) guestSeen.clear();
    beams = s.b.map(([ox, oy, ang, len, w, col, col2, style, t, dur]) => ({ ox, oy, ang, len, w, col, col2, style, t, dur }));
  } else {
    for (const p of proj) { p.x += p.vx * dt; p.y += p.vy * dt; if (p.spin !== undefined) p.spin += dt * 18; if (p.type === 'fire' && Math.random() < 0.5) parts.push({ x: p.x, y: p.y, vx: 0, vy: -60, life: 0.3, max: 0.3, col: '#ff8a2a', size: 7 }); }
    for (const b of beams) b.t += dt;
    beams = beams.filter(b => b.t < b.dur);
  }
}
function netOnMsg(d) {
  switch (d.t) {
    case '_open':
      if (Net.role === 'guest') netSend({ t: 'hello', ch: selIdx }); else netSend({ t: 'lobby', ch: selIdx, stage: cfg.stage });
      break;
    case '_closed':
      if (Net.active || mode === 'netwait') { note('Your rival disconnected.', 3000); toMenu(); }
      break;
    case 'full': note('That room already has two players.', 3000); netClose(); break;
    case 'hello': case 'pick': Net.themCh = d.ch; break;
    case 'lobby': Net.themCh = d.ch; selectStage(d.stage); break;
    case 'stage': if (Net.role === 'guest') selectStage(d.i); break;
    case 'ready': Net.themReady = true; netMaybeStart(); break;
    case 'left': if (Net.active || mode === 'netwait' || mode === 'over') { note('Your rival left the match.', 3000); toMenu(); } Net.themReady = false; break;
    case 'start':
      if (Net.role !== 'guest') break;
      Net.meReady = false; guestSeen.clear();
      cfg.music = d.music;
      startFight({ net: true, eIdx: d.hch, guestSide: true, stage: d.stage });
      break;
    case 'in': Net.lastIn = d; break;
    case 'ev': if (NETH() && E) handleEventFor(E, d.e); break;
    case 's': Net.snap = d; Net.snapNew = true; break;
    case 'fx': {
      if (!NETG()) break;
      const blocked = !!d.bl;
      addParts(d.x, d.y, blocked ? 6 : d.hv ? 24 : 10, blocked ? '#cfe8ff' : '#fff3c0', d.hv ? 750 : 450, 0.35, 4);
      if (!blocked) { shake = Math.max(shake, d.hv ? 0.6 : 0.18); if (d.hv && !d.q) impactT = 0.07; if (!d.q) sfx.punch(!!d.hv); }
      else if (!d.q) sfx.block();
      if (d.d >= 2 && !d.q) addText(String(Math.round(d.d)), blocked ? '#9fb6c8' : (d.d > 12 ? '#ffd23a' : '#ffffff'), d.d > 12 ? 1 : 0.6, d.x + rand(-20, 20), d.y - 50, true);
      const tgt = byWho(d.tw); if (tgt === E) { stats.dealt += d.d; if (!blocked) stats.landed++; } else stats.taken += d.d;
      if (tgt) tgt.flash = blocked ? tgt.flash : 0.12;
      break; }
    case 'tp': { if (!NETG()) break; const f = byWho(d.who); const sn = snapshot(f); sn.x = d.x1; sn.y = d.y1; ghosts.push({ s: sn, col: auraCol(f), t: 0 }); fxStreak(d.x1, d.y1 - 40, d.x2, d.y2 - 40, auraCol(f)); sfx.zip(); f.x = d.x2; f.y = d.y2; break; }
    case 'bn': if (NETG()) banners.push({ text: d.text, col: d.col, side: d.side, t: 0 }); break;
    case 'txt': if (NETG()) addText(d.txt, d.col, d.size, W() / 2, H() * 0.3); break;
    case 'note': note(d.msg); break;
    case 'cast': { if (!NETG()) break; const f = byWho(d.who), mv = f.ch.moves[d.slot]; f.auraT = 1; sfx.special(); if (f === P) stats.specials++; MOVES[mv.id](f, other(f)); break; }
    case 'cutin': { if (!NETG()) break; const f = byWho(d.who), mv = f.ch.moves[d.slot]; if (f === P) stats.specials++; startCutin(f, mv, () => MOVES[mv.id](f, other(f))); break; }
    case 'tf': { if (!NETG()) break; const f = byWho(d.who); f.state = 'transform'; cine = { type: 'transform', t: 0, dur: 3.3, f, done: false }; sfx.rise(2.1); break; }
    case 'ko': { if (!NETG()) break; const t = byWho(d.who); mode = 'ko'; slowmo = 1.6; shake = 0.9; impactT = 0.12; sfx.ko(); t.state = 'ko'; break; }
    case 'end': {
      if (!NETG()) break;
      const win = !d.hw;
      const how = d.to ? `Time up · ${d.gh} vs ${d.hh} health` : win ? `Knockout in ${d.gt} seconds` : 'Knocked out';
      timeout = !!d.to; P.hp = d.gh; E.hp = d.hh; endFight(win, how);
      break; }
  }
}
Net.onMsg = netOnMsg;
function netSetReady() {
  Net.meReady = true; netSend({ t: 'ready' });
  mode = 'netwait'; P = null;
  $('#menu').hidden = true; $('#result').hidden = true; $('#hud').hidden = true; $('#tray').hidden = true;
  $('#setup').hidden = false; $('#pip').classList.remove('big'); $('#pip').hidden = inputMode !== 'cam';
  setSetup('Ready', 'Waiting for your rival to get ready…', 1, [['Back to menu', () => { netSend({ t: 'left' }); toMenu(); }]]);
  netMaybeStart();
}
function netMaybeStart() {
  if (Net.role !== 'host' || !Net.meReady || !Net.themReady || Net.themCh === null) return;
  Net.meReady = Net.themReady = false;
  const music = cfg.music >= 0 ? cfg.music : -1;
  netSend({ t: 'start', hch: selIdx, stage: cfg.stage, music });
  startFight({ net: true, eIdx: Net.themCh });
}
function selectStage(i) { cfg.stage = i; document.querySelectorAll('.stg').forEach((p, k) => p.setAttribute('aria-pressed', k === i)); buildStage(STAGES[i]); }
function netLobbyUI(kind, msg) {
  const st = $('#netStatus'); if (!st) return;
  const share = $('#netShare');
  if (kind === undefined) kind = Net.connected ? 'connected' : Net.role === 'host' && Net.peer ? 'waiting' : '';
  share.hidden = true;
  if (kind === 'waiting') {
    const link = `${location.origin}${location.pathname}?room=${Net.code}`;
    st.innerHTML = `Room code <b class="code">${Net.code}</b>. Send your rival the code or this link:`;
    share.hidden = false; $('#netLink').value = link;
  } else if (kind === 'connected') {
    const them = Net.themCh !== null ? CHARS[Net.themCh].name : 'someone';
    st.innerHTML = `<b>Connected.</b> Your rival picked ${them}. ${Net.role === 'host' ? 'You pick the stage.' : 'The host picks the stage.'} Each of you now press <b>Fight with camera</b> or <b>Fight with keyboard</b>.`;
  } else if (kind === 'opening' || kind === 'error' || kind === 'closed') st.textContent = msg;
  else st.textContent = '';
}
Net.onStatus = (kind, msg) => netLobbyUI(kind, msg);
setInterval(() => { if (mode === 'menu' && Net.connected) netLobbyUI(); }, 1000);
$('#btnHost').addEventListener('click', () => { audioInit(); netHost(); });
$('#btnJoin').addEventListener('click', () => { const c = $('#joinCode').value.trim(); if (c.length < 4) { netLobbyUI('error', 'Type the 5-letter room code from the host.'); return; } audioInit(); netJoin(c); });
$('#btnCopy').addEventListener('click', () => { const v = $('#netLink').value; navigator.clipboard?.writeText(v).then(() => note('Link copied'), () => { $('#netLink').select(); }); });
{ const room = new URLSearchParams(location.search).get('room'); if (room) { $('#joinCode').value = room.toUpperCase(); setTimeout(() => netJoin(room), 300); } }

/* ---------------- main loop ---------------- */
let last = performance.now();
function frame(now) {
  try { step(now); } catch (e) { console.warn('frame error', e); }
  requestAnimationFrame(frame);
}
function step(now) {
  const rdt = Math.min(0.05, (now - last) / 1000); last = now; time += rdt;
  if (inputMode === 'cam' && Track.ready) trackFrame(now, rdt, { fight: mode === 'fight' && !cine });
  if (mode === 'setup') { updateSetup(rdt); Track.events.length = 0; }
  if (P && mode !== 'menu' && mode !== 'setup' && mode !== 'netwait') {
    slowmo = Math.max(0, slowmo - rdt); impactT = Math.max(0, impactT - rdt); speedLines = Math.max(0, speedLines - rdt);
    const dt = rdt * (slowmo > 0 ? 0.3 : 1);
    if (mode !== 'over') applyPlayerInput(rdt); else Track.events.length = 0;
    if (cine) updateCine(rdt);
    else if (NETG()) {
      if (mode === 'intro') { introT -= rdt; if (introT <= 0) mode = 'fight'; }
      guestStep(rdt); updateWorld(dt);
    }
    else if (mode === 'intro' || mode === 'fight' || mode === 'ko') {
      if (mode === 'intro') { introT -= rdt; if (introT <= 0) { mode = 'fight'; sfx.bell && sfx.bell(); } }
      if (mode === 'fight') {
        gameT += dt;
        if (!cfg.training) { clockT -= dt; if (clockT <= 0) { clockT = 0; mode = 'ko'; koT = 2; timeout = true; banner('TIME!', '#eaf4f2', 'center'); } }
      }
      updateAI(E, P, dt);
      updateFighter(P, E, dt); updateFighter(E, P, dt);
      updateWorld(dt);
      if (mode === 'ko') {
        koT -= rdt;
        if (koT <= 0) {
          if (timeout) endFight(P.hp >= E.hp, `Time up · ${Math.round(P.hp)} vs ${Math.round(E.hp)} health`);
          else endFight(koWin, koWin ? `Knockout in ${Math.round(gameT)} seconds` : 'Knocked out');
        }
      }
    }
    updateCamera(rdt);
    if (NETH()) { Net.sendT += rdt; if (Net.sendT >= 0.033) { Net.sendT = 0; sendSnap(); } }
    if (mode !== 'vs' && mode !== 'over') $('#tray').hidden = !!cine;
    if (P.form > 0 || P.hp < 30) Music.intensity = Math.max(Music.intensity, 0.85);
    updateHud();
  }
  shake = Math.max(0, shake - rdt * 1.8);
  try { render(rdt); drawPip(); } catch (e) { console.warn('draw error', e); }
}

window.__sky = { get P() { return P; }, get E() { return E; }, get mode() { return mode; }, get cine() { return cine; }, handleEvent, Track, transform: () => P && (P.surge = 100, transform(P)), setSel: i => { selIdx = i; } };
resize();
buildMenu();
document.fonts?.ready.then(() => { document.querySelectorAll('.pick canvas').forEach((c, i) => portrait(c, CHARS[i], 'full', 0)); renderDetail(); });
requestAnimationFrame(frame);
