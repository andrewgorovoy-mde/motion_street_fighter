'use strict';
/* =========================================================================
   SKYBREAK — body + hand tracking
   - Punches: per-arm "guard vs extended" state machine on an extension score,
     with thresholds learned from your own punches (training step).
   - Body moves (no hands): duck = Vanish, lunge = Rush, hop = Blink up,
     side slip = Blink left/right.
   - Gestures (two-arm poses) and hand signs (held finger shapes).
   ========================================================================= */
const MP_VER = '0.10.14';
const MP_URL = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/vision_bundle.mjs`;
const MP_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VER}/wasm`;
const MODEL_FULL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task';
const MODEL_LITE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
const MODEL_HAND = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

const tclamp = (v, a, b) => Math.max(a, Math.min(b, v));
const tlerp = (a, b, t) => a + (b - a) * t;
const tmed = a => { const q = [...a].sort((x, y) => x - y); return q[q.length >> 1]; };
const tpct = (a, p) => { const q = [...a].sort((x, y) => x - y); return q[Math.min(q.length - 1, Math.floor(q.length * p))]; };

const Track = {
  video: null, pose: null, hand: null, kind: null, lastVT: -1,
  lm: null, F: null, events: [],
  guard: false, charge: false, crossT: 0,
  sens: 1, bodySens: 1, signsOn: true, ready: false,
  arms: { L: { e: 0, on: false, onT: -1e9, last: -1e9 }, R: { e: 0, on: false, onT: -1e9, last: -1e9 } },
  prof: { refUA: { L: 0, R: 0 }, refFA: { L: 0, R: 0 }, g: { L: 0.12, R: 0.12 }, on: { L: 0.5, R: 0.5 }, off: { L: 0.28, R: 0.28 }, trained: false },
  binds: { gest: {}, flurry: null },
  gs: {}, B: {}, punchTimes: [], specialLock: -1e9, pending: [],
  body: { hist: [], lock: -1e9, last: '' , lastT: -1e9 },
  hands: { crops: [null, null], L: null, R: null, hist: { L: [], R: [] }, held: { L: null, R: null }, lastSign: { name: null, t: -1e9 }, cost: 0, frame: 0 },
  raw: {},
};

/* ---------------- model loading ---------------- */
async function trackStart(kind, onStatus) {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('this browser can’t use the camera here. Use Chrome or Edge, and open the game from localhost or as a file');
  const video = Track.video || document.getElementById('cam');
  Track.video = video;
  if (!video.srcObject) video.srcObject = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 }, facingMode: 'user' }, audio: false });
  await video.play();
  onStatus && onStatus('Loading body tracker…');
  const vision = await import(MP_URL);
  const fileset = await vision.FilesetResolver.forVisionTasks(MP_WASM);
  if (!Track.pose || Track.kind !== kind) {
    Track.pose?.close?.();
    const model = kind === 'accurate' ? MODEL_FULL : MODEL_LITE;
    try { Track.pose = await vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: model, delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1 }); }
    catch (e) { Track.pose = await vision.PoseLandmarker.createFromOptions(fileset, { baseOptions: { modelAssetPath: MODEL_LITE, delegate: 'CPU' }, runningMode: 'VIDEO', numPoses: 1 }); }
    Track.kind = kind;
  }
  if (!Track.hand) {
    onStatus && onStatus('Loading hand tracker…');
    const opts = d => ({ baseOptions: { modelAssetPath: MODEL_HAND, delegate: d }, runningMode: 'VIDEO', numHands: 2, minHandDetectionConfidence: 0.4, minHandPresenceConfidence: 0.4, minTrackingConfidence: 0.4 });
    try { Track.hand = await vision.HandLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch (e) { try { Track.hand = await vision.HandLandmarker.createFromOptions(fileset, opts('CPU')); } catch (e2) { Track.hand = null; } }
  }
  trackLoadProfile();
  Track.ready = true;
}

function trackLoadProfile() {
  try { const p = JSON.parse(localStorage.getItem('skybreak.punch') || 'null'); if (p && p.on) Object.assign(Track.prof, p); } catch (e) { /* storage blocked */ }
}
function trackSaveProfile() { try { localStorage.setItem('skybreak.punch', JSON.stringify(Track.prof)); } catch (e) { /* storage blocked */ } }
function trackHasProfile() { try { return !!localStorage.getItem('skybreak.punch'); } catch (e) { return false; } }

/* ---------------- per-frame entry ---------------- */
function trackFrame(now, dt, ctxInfo) {
  const v = Track.video;
  if (!Track.pose || !v || v.readyState < 2 || v.currentTime === Track.lastVT) return false;
  Track.lastVT = v.currentTime;
  let res; try { res = Track.pose.detectForVideo(v, now); } catch (e) { return false; }
  trackPose(res, now, dt, ctxInfo || {});
  if (Track.hand && Track.signsOn) {
    const H = Track.hands; H.frame = (H.frame + 1) % 2;
    if (H.cost < 16 || H.frame === 0) { const t0 = performance.now(); trackHands(now); H.cost = tlerp(H.cost, performance.now() - t0, 0.2); }
  }
  return true;
}

/* ---------------- pose features ---------------- */
const USE = [0, 2, 5, 11, 12, 13, 14, 15, 16, 19, 20, 23, 24, 25, 26];
function trackFeatures(lm) {
  const vw = Track.video?.videoWidth || 640, vh = Track.video?.videoHeight || 480;
  // median of the last 3 frames per landmark kills one-frame glitches
  const P = {};
  for (const i of USE) {
    const r = Track.raw[i] || (Track.raw[i] = []);
    r.push([lm[i].x, lm[i].y, lm[i].z, lm[i].visibility ?? 1]); if (r.length > 3) r.shift();
    const m = k => tmed(r.map(q => q[k]));
    P[i] = { x: (1 - m(0)) * vw, y: m(1) * vh, z: m(2) * vw, v: m(3) };
  }
  const ls = P[11], rs = P[12];
  const sw = Math.max(20, Math.hypot(ls.x - rs.x, ls.y - rs.y));
  return { n: P[0], eyeL: P[2], eyeR: P[5], ls, rs, le: P[13], re: P[14], lw: P[15], rw: P[16], li: P[19], ri: P[20], hl: P[23], hr: P[24], kl: P[25], kr: P[26],
    sw, shX: (ls.x + rs.x) / 2, shY: (ls.y + rs.y) / 2, vw, vh,
    body: P[0].v > 0.5 && ls.v > 0.5 && rs.v > 0.5, okL: P[15].v > 0.5 && P[13].v > 0.4, okR: P[16].v > 0.5 && P[14].v > 0.4 };
}
const d2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function armParts(side) {
  const F = Track.F;
  return side === 'L' ? { sh: F.ls, el: F.le, wr: F.lw, ok: F.okL } : { sh: F.rs, el: F.re, wr: F.rw, ok: F.okR };
}
// 0 = tucked guard, ~1 = fully extended. Three cues, whichever is strongest:
//  fore  – upper arm foreshortened with the elbow raised (punch straight at the camera)
//  reach – hand far from the shoulder on screen (hooks, angled punches)
//  depth – the tracker's own depth estimate for the wrist
function armScore(side) {
  const F = Track.F, { sh, el, wr, ok } = armParts(side);
  if (!ok) return 0;
  const refUA = Track.prof.refUA[side] || F.sw * 0.9, refFA = Track.prof.refFA[side] || F.sw * 0.85;
  const ua = d2(sh, el);
  const elbowRaised = el.y < sh.y + 0.55 * F.sw;
  const fore = elbowRaised ? tclamp(1 - ua / refUA, 0, 1) * 1.25 : 0;
  const reach = tclamp((d2(sh, wr) / (refUA + refFA) - 0.4) / 0.55, 0, 1);
  const depth = tclamp((-(wr.z - sh.z) / F.sw - 0.4) / 1.4, 0, 1) * 0.8;
  return Math.max(fore, reach, depth);
}

/* ---------------- gestures ---------------- */
const GDEF = {
  palms:    { need: 0.3,  holding: () => Track.B.palms, whileHolding: true, fire: () => Math.max(Track.arms.L.e, Track.arms.R.e) > Math.min(Track.prof.on.L, Track.prof.on.R) * 0.8 },
  overhead: { need: 0.45, holding: () => Track.B.overhead, fire: () => Track.B.handsBelow },
  oneup:    { need: 0.4,  holding: () => Track.B.upL || Track.B.upR, onArm: s => { s.side = Track.B.upL ? 'L' : 'R'; }, fire: s => { const F = Track.F, w = s.side === 'L' ? F.lw : F.rw, ok = s.side === 'L' ? F.okL : F.okR; return !ok || w.y > F.shY; } },
  tpose:    { need: 0.4,  holding: () => Track.B.tpose, fire: () => Track.B.handsDist < 0.9 },
  xburst:   { need: 0.35, holding: () => Track.B.crossed, fire: () => Track.B.both && (Track.F.rw.x - Track.F.lw.x) > 1.8 * Track.F.sw },
};
function stepGesture(key, slot, dt, now) {
  const T = Track;
  if (key === 'flurry') {
    while (T.punchTimes.length && now - T.punchTimes[0] > 1500) T.punchTimes.shift();
    const s = T.gs[slot] || (T.gs[slot] = {}); s.prog = Math.min(1, T.punchTimes.length / 4); s.armed = false;
    if (T.punchTimes.length >= 4) { T.punchTimes.length = 0; T.events.push(slot); return true; }
    return false;
  }
  const d = GDEF[key], s = T.gs[slot] || (T.gs[slot] = { hold: 0, armed: false, rel: 0, prog: 0 });
  const h = d.holding();
  if (h) { s.hold = Math.min(d.need, s.hold + dt); if (s.hold >= d.need && !s.armed) { s.armed = true; s.rel = 0; d.onArm && d.onArm(s); sfx.armed(); } }
  else if (!s.armed) s.hold = Math.max(0, s.hold - dt * 2);
  s.prog = s.hold / d.need;
  if (s.armed) {
    s.rel = h ? 0 : s.rel + dt;
    if ((!h || d.whileHolding) && d.fire(s)) { s.armed = false; s.hold = 0; T.events.push(slot); return true; }
    if (s.rel > 0.9) { s.armed = false; s.hold = 0; }
  }
  return false;
}
function trackSetBinds(ch) {
  const b = { gest: {}, flurry: null };
  for (const slot of ['s1', 's2', 'ult']) {
    const inp = ch.moves[slot].input;
    if (inp.type === 'gesture') { if (inp.key === 'flurry') b.flurry = slot; else b.gest[inp.key] = slot; }
  }
  Track.binds = b; Track.gs = {}; Track.punchTimes = []; Track.pending = [];
}

/* ---------------- pose processing ---------------- */
function trackPose(res, now, dt, info) {
  const T = Track, lm = res.landmarks && res.landmarks[0];
  T.lm = lm || null;
  if (!lm) { T.F = null; T.guard = T.charge = false; return; }
  const F = T.F = trackFeatures(lm);
  if (!F.body) { T.guard = T.charge = false; return; }
  const { lw: L, rw: R, okL, okR, sw, shY, shX, n } = F;
  const B = T.B;
  const both = okL && okR;
  B.both = both;
  B.handsDist = both ? d2(L, R) / sw : 9;
  B.crossed = both && L.x > R.x + 0.15 * sw && L.y < shY + 1.0 * sw && R.y < shY + 1.0 * sw && L.y > n.y - 1.3 * sw && R.y > n.y - 1.3 * sw;
  T.crossT = B.crossed ? T.crossT + dt : 0;
  const midY = (L.y + R.y) / 2, midX = (L.x + R.x) / 2;
  B.palms = both && !B.crossed && B.handsDist < 0.38 && midY > shY - 0.6 * sw && midY < shY + 1.6 * sw && Math.abs(midX - shX) < 0.9 * sw;
  B.overhead = both && L.y < n.y - 0.2 * sw && R.y < n.y - 0.2 * sw;
  B.upL = okL && L.y < n.y - 0.4 * sw && (!okR || R.y > n.y - 0.1 * sw);
  B.upR = okR && R.y < n.y - 0.4 * sw && (!okL || L.y > n.y - 0.1 * sw);
  B.tpose = both && (R.x - L.x) > 2.4 * sw && Math.abs(L.y - shY) < 0.8 * sw && Math.abs(R.y - shY) < 0.8 * sw;
  const elbowsLow = F.le.v > 0.4 && F.re.v > 0.4 && F.le.y > shY + 0.55 * sw && F.re.y > shY + 0.55 * sw;
  B.charge = elbowsLow && (!okL || L.y > shY + 1.0 * sw) && (!okR || R.y > shY + 1.0 * sw);
  B.handsBelow = (!okL || L.y > shY - 0.1 * sw) && (!okR || R.y > shY - 0.1 * sw);

  // arm extension scores + wrist history
  for (const side of ['L', 'R']) {
    const A = T.arms[side], w = side === 'L' ? L : R, ok = side === 'L' ? okL : okR;
    A.e = armScore(side);
    A.wh = A.wh || [];
    if (ok) A.wh.push({ t: now, x: w.x, y: w.y, z: w.z }); else A.wh.length = 0;
    while (A.wh.length && now - A.wh[0].t > 420) A.wh.shift();
    const recent = A.wh.filter(q => now - q.t <= 130);
    A.rise = recent.length ? (recent[0].y - w.y) / sw : 0;
    A.upT = A.upT || -1e9; A.chopT = A.chopT || -1e9;
  }

  // gestures bound to the current fighter
  let fired = false;
  if (info.fight) for (const [g, slot] of Object.entries(T.binds.gest)) fired = stepGesture(g, slot, dt, now) || fired;
  if (fired) T.specialLock = now + 450;
  const anyArmed = Object.values(T.gs).some(s => s.armed);
  const palmsHeld = T.binds.gest.palms && T.gs[T.binds.gest.palms] && T.gs[T.binds.gest.palms].hold > 0.12;

  const suppressAll = fired || now < T.specialLock || T.crossT > 0.08 || palmsHeld || B.overhead || B.tpose || B.charge || anyArmed;
  const fire = kind => { T.events.push(kind); T.punchTimes.push(now); T.lastStrike = { kind, t: now }; };
  // straight (jab / cross) vs hook, decided from where the wrist travelled in the last quarter second
  const classify = side => {
    const A = T.arms[side], { wr } = armParts(side);
    const o = A.wh.find(q => now - q.t <= 260);
    if (o) {
      const out = (wr.x - o.x) / sw * (side === 'L' ? -1 : 1), up = (o.y - wr.y) / sw, tow = -(wr.z - o.z) / sw;
      if (out > 0.5 && out > tow * 0.7 && Math.abs(up) < 0.7) return 'hook';
    }
    return side === 'L' ? 'jab' : 'cross';
  };

  // 1) straights, hooks and twin palms: each guard → extended transition counts once
  for (const side of ['L', 'R']) {
    const A = T.arms[side], O = T.arms[side === 'L' ? 'R' : 'L'], os = side === 'L' ? 'R' : 'L';
    const on = T.prof.on[side], off = T.prof.off[side];
    const { sh, el, wr, ok } = armParts(side);
    if (!A.on && A.e > on) {
      A.on = true; A.onT = now;
      const raising = el.y < sh.y - 0.25 * sw || wr.y < n.y - 0.1 * sw || A.rise > 0.2;
      const together = O.on && now - O.onT < 160;
      if (together) {
        const had = T.pending.find(p => p.side === os);
        T.pending = T.pending.filter(p => p.side !== os);
        if (had && !suppressAll && B.handsDist < 1.1 && !raising) { A.last = O.last = now; fire('twin'); }
      } else if (ok && !suppressAll && !raising && !T.hands.held[side] && now - A.last > 110 && now - A.upT > 250) {
        A.last = now;
        const kind = classify(side);
        if (!O.on && O.e > T.prof.off[os]) T.pending.push({ side, t: now, kind });
        else fire(kind);
      }
    } else if (A.on && A.e < off) A.on = false;
  }
  for (const p of T.pending) {
    const os = p.side === 'L' ? 'R' : 'L', O = T.arms[os];
    if (suppressAll) p.cancel = true;
    else if (now - p.t >= 80 || O.e < T.prof.off[os]) { p.done = true; fire(p.kind); }
  }
  T.pending = T.pending.filter(p => !p.done && !p.cancel);

  // 2) uppercut: the fist rises fast from shoulder height or lower and stops around the chin.
  //    Confirmed 70 ms later so an arm going all the way overhead (a gesture) doesn't count.
  // 3) hammer: one arm comes down fast from above the head.
  for (const side of ['L', 'R']) {
    const A = T.arms[side], O = T.arms[side === 'L' ? 'R' : 'L'], { sh, el, wr, ok } = armParts(side);
    if (!ok || suppressAll || T.hands.held[side]) { A.upPend = null; continue; }
    if (A.upPend) {
      if (wr.y < n.y - 0.55 * sw || O.rise > 0.3) A.upPend = null;
      else if (now - A.upPend >= 70) { A.upPend = null; A.upT = now; A.last = now; fire('upper'); }
      continue;
    }
    const w = A.wh.filter(q => now - q.t <= 240);
    if (w.length >= 3) {
      const lowest = Math.max(...w.map(q => q.y));
      const rose = (lowest - wr.y) / sw;
      if (rose > 0.5 && lowest > sh.y - 0.05 * sw && wr.y < sh.y && wr.y > n.y - 0.55 * sw && el.y > wr.y
          && Math.abs(wr.x - shX) < 1.1 * sw && now - A.upT > 300 && now - A.last > 150 && now - A.chopT > 500) A.upPend = now;
    }
    const w2 = A.wh.filter(q => now - q.t <= 380);
    if (w2.length >= 3 && now - A.chopT > 400) {
      const highest = Math.min(...w2.map(q => q.y));
      const oHigh = O.wh && O.wh.length ? Math.min(...O.wh.filter(q => now - q.t <= 380).map(q => q.y).concat([1e9])) : 1e9;
      if (highest < n.y - 0.3 * sw && wr.y > sh.y + 0.05 * sw && (wr.y - highest) / sw > 0.9 && oHigh > n.y - 0.2 * sw) {
        A.chopT = now; A.last = now; fire('chop');
      }
    }
  }

  // 4) knee: a knee comes up toward the hip (only when your legs are in frame)
  T.knees = T.knees || { L: { h: [], last: -1e9 }, R: { h: [], last: -1e9 } };
  for (const [kn, hp, key] of [[F.kl, F.hl, 'L'], [F.kr, F.hr, 'R']]) {
    const K = T.knees[key];
    if (kn.v < 0.5 || hp.v < 0.5) { K.h.length = 0; continue; }
    K.h.push({ t: now, d: (kn.y - hp.y) / sw }); while (K.h.length && now - K.h[0].t > 300) K.h.shift();
    const maxD = Math.max(...K.h.map(q => q.d)), d = (kn.y - hp.y) / sw;
    if (maxD - d > 0.55 && d < 0.6 && now - K.last > 450 && !suppressAll) { K.last = now; fire('knee'); }
  }
  if (info.fight && T.binds.flurry) { if (stepGesture('flurry', T.binds.flurry, dt, now)) T.specialLock = now + 300; }

  T.guard = T.crossT > 0.08;
  T.charge = B.charge;
  trackBody(now);
}

/* ---------------- body moves (teleports) ---------------- */
function trackBody(now) {
  const T = Track, F = T.F, Bd = T.body;
  const ed = (F.eyeL.v > 0.5 && F.eyeR.v > 0.5) ? d2(F.eyeL, F.eyeR) : 0;
  Bd.hist.push({ t: now, x: F.shX, y: F.shY, sw: F.sw, nx: F.n.x, ny: F.n.y, ed });
  while (Bd.hist.length && now - Bd.hist[0].t > 380) Bd.hist.shift();
  if (now < Bd.lock || Bd.hist.length < 4) return;
  const ref = Bd.hist[0];
  if (now - ref.t < 150) return;
  const k = 1 / T.bodySens, sw = ref.sw;
  const dy = (F.shY - ref.y) / sw, dny = (F.n.y - ref.ny) / sw, dx = (F.shX - ref.x) / sw, dnx = (F.n.x - ref.nx) / sw;
  const grow = F.sw / ref.sw, egrow = ed && ref.ed ? ed / ref.ed : 0;
  let ev = null;
  if (dy > 0.45 * k && dny > 0.4 * k) ev = 'vanish';
  else if (dy < -0.38 * k && dny < -0.34 * k) ev = 'blinkU';
  else if (Math.abs(dx) > 0.5 * k && Math.abs(dnx) > 0.45 * k && Math.sign(dx) === Math.sign(dnx)) ev = dx < 0 ? 'blinkL' : 'blinkR';
  else if (grow > 1 + 0.15 * k && (!egrow || egrow > 1 + 0.08 * k)) ev = 'rush';
  if (ev) { T.events.push(ev); Bd.lock = now + 700; Bd.hist.length = 0; Bd.last = ev; Bd.lastT = now; }
}

/* ---------------- hand signs ---------------- */
const handCanvas = document.createElement('canvas'); handCanvas.width = 512; handCanvas.height = 256;
const handCtx = handCanvas.getContext('2d');
function fingerStates(p) {
  const d = (a, b) => Math.hypot(p[a].x - p[b].x, p[a].y - p[b].y), palm = d(0, 9) || 1;
  const ext = (tip, pip, mcp) => d(0, tip) > d(0, pip) * 1.12 && d(mcp, tip) > palm * 0.5;
  return { thumb: d(4, 5) > palm * 0.6 && d(4, 17) > d(3, 17), idx: ext(8, 6, 5), mid: ext(12, 10, 9), ring: ext(16, 14, 13), pinky: ext(20, 18, 17) };
}
function classifySign(p) {
  const f = fingerStates(p);
  if (f.idx && f.mid && f.ring && f.pinky) return 'palm';
  if (f.idx && f.mid && !f.ring && !f.pinky) return 'V';
  if (f.idx && f.pinky && !f.mid && !f.ring) return 'horns';
  if (f.idx && !f.mid && !f.ring && !f.pinky && f.thumb) return 'gun';
  if (!f.idx && !f.mid && !f.ring && !f.pinky) return 'fist';
  return null;
}
function trackHands(now) {
  const T = Track, H = T.hands, F = T.F, lm = T.lm;
  if (!lm || !F || !F.body) { H.L = H.R = null; signStep('L', null, now); signStep('R', null, now); return; }
  const vw = F.vw, vh = F.vh, size = tclamp(F.sw * 1.2, 70, 420);
  handCtx.fillStyle = '#000'; handCtx.fillRect(0, 0, 512, 256);
  [[15, 19], [16, 20]].forEach(([wi, ii], slot) => {
    const w = lm[wi], ix = lm[ii];
    if ((w.visibility ?? 1) < 0.3) { H.crops[slot] = null; return; }
    const cx = (w.x + (ix.x - w.x) * 0.9) * vw, cy = (w.y + (ix.y - w.y) * 0.9) * vh;
    const c = { x: cx - size / 2, y: cy - size / 2, s: size }; H.crops[slot] = c;
    handCtx.drawImage(T.video, c.x, c.y, c.s, c.s, slot * 256, 0, 256, 256);
  });
  let res; try { res = T.hand.detectForVideo(handCanvas, now); } catch (e) { return; }
  const got = [null, null];
  for (const h of (res.landmarks || [])) {
    const slot = h[0].x < 0.5 ? 0 : 1, c = H.crops[slot];
    if (!c || got[slot]) continue;
    got[slot] = h.map(q => ({ x: vw - (c.x + (q.x * 2 - slot) * c.s), y: c.y + q.y * c.s }));
  }
  H.L = got[0]; H.R = got[1];
  signStep('L', got[0] ? classifySign(got[0]) : null, now);
  signStep('R', got[1] ? classifySign(got[1]) : null, now);
}
// a sign counts when it is seen in at least 6 of the last 8 hand frames — this is what removes the twitchiness
function signStep(side, sign, now) {
  const H = Track.hands, h = H.hist[side];
  h.push({ s: sign, t: now }); if (h.length > 8) h.shift();
  const counts = {};
  for (const q of h) if (q.s && now - q.t < 700) counts[q.s] = (counts[q.s] || 0) + 1;
  let best = null, bc = 0; for (const [k, c] of Object.entries(counts)) if (c > bc) { best = k; bc = c; }
  const stable = bc >= 6 ? best : null;
  const prev = H.held[side];
  if (stable && stable !== 'fist') {
    if (prev !== stable) {
      H.held[side] = stable;
      const L = H.lastSign;
      if (!(L.name === stable && now - L.t < 900)) { Track.events.push('sign:' + stable); L.name = stable; L.t = now; sfx.sign(); }
    }
  } else if (!stable || stable === 'fist') {
    if (bc < 4 || stable === 'fist') H.held[side] = null;
  }
}

/* ---------------- calibration ---------------- */
const Calib = { phase: null, t: 0, samples: [], peaks: [], cur: null, side: 'L' };
function calibStartGuard() { Calib.phase = 'guard'; Calib.t = 0; Calib.samples = []; }
function calibGuardStep(dt) {
  const F = Track.F;
  if (!F || !F.body || !F.okL || !F.okR) { Calib.t = Math.max(0, Calib.t - dt); return false; }
  Calib.t += dt;
  Calib.samples.push({ uaL: d2(F.ls, F.le), uaR: d2(F.rs, F.re), faL: d2(F.le, F.lw), faR: d2(F.re, F.rw) });
  if (Calib.t < 2) return false;
  const S = Calib.samples.slice(-50), P = Track.prof;
  P.refUA.L = tmed(S.map(s => s.uaL)); P.refUA.R = tmed(S.map(s => s.uaR));
  P.refFA.L = tmed(S.map(s => s.faL)); P.refFA.R = tmed(S.map(s => s.faR));
  return true;
}
// after refs are set, measure the guard noise level for a moment
function calibNoiseStep(dt, store) {
  store.L.push(Track.arms.L.e); store.R.push(Track.arms.R.e);
  if (store.L.length < 25) return false;
  const P = Track.prof;
  for (const s of ['L', 'R']) {
    P.g[s] = tpct(store[s], 0.9);
    if (!P.trained) { P.on[s] = tclamp(P.g[s] + 0.3, 0.42, 0.85); P.off[s] = P.g[s] + 0.13; }
  }
  return true;
}
function calibStartPunches(side) { Calib.phase = 'punch'; Calib.side = side; Calib.peaks = []; Calib.cur = null; Calib.t = 0; }
// returns number of punches captured so far for the side
function calibPunchStep(dt) {
  Calib.t += dt;
  const s = Calib.side, e = Track.arms[s].e, g = Track.prof.g[s];
  if (Calib.cur === null) { if (e > g + 0.15) Calib.cur = e; }
  else { Calib.cur = Math.max(Calib.cur, e); if (e < g + 0.08) { Calib.peaks.push(Calib.cur); Calib.cur = null; } }
  return Calib.peaks.length;
}
function calibFinishPunches() {
  const s = Calib.side, P = Track.prof, g = P.g[s];
  if (Calib.peaks.length >= 3) {
    const p = tmed(Calib.peaks);
    P.on[s] = tclamp(g + 0.5 * (p - g), g + 0.12, 0.92);
    P.off[s] = tclamp(g + 0.22 * (p - g), g + 0.06, P.on[s] - 0.06);
  }
}
