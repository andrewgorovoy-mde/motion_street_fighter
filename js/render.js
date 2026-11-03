'use strict';
/* =========================================================================
   SKYBREAK — rendering: stages, fighters, effects, icons and portraits
   ========================================================================= */
const R2 = { W: 0, H: 0, DPR: 1, stage: null, layers: null, weather: [] };
const rclamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rlerp = (a, b, t) => a + (b - a) * t;
function rseed(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }

/* ---------------- color helpers ---------------- */
const shadeCache = new Map();
function shade(hex, amt) {
  const key = hex + amt; let v = shadeCache.get(key); if (v) return v;
  const n = parseInt(hex.slice(1), 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (amt > 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; } else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  v = `rgb(${r | 0},${g | 0},${b | 0})`; shadeCache.set(key, v); return v;
}
function alpha(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; }

/* ---------------- poses (local coords, facing right, hip = 0,0) ---------------- */
const LEG = {
  idle: { fk: [16, 28], ff: [10, 64], bk: [-10, 30], bf: [-22, 62] },
  fly:  { fk: [-2, 32], ff: [-30, 56], bk: [-16, 28], bf: [-46, 46] },
  wide: { fk: [24, 32], ff: [32, 66], bk: [-24, 32], bf: [-32, 66] },
  hurt: { fk: [18, 24], ff: [26, 58], bk: [-4, 30], bf: [6, 64] },
  brace:{ fk: [22, 28], ff: [20, 64], bk: [-18, 30], bf: [-38, 58] },
};
const POSES = {
  idle:   { neck: [4, -64], head: [7, -86], fe: [24, -38], fh: [36, -58], be: [-4, -36], bh: [20, -54], ...LEG.idle },
  fly:    { neck: [13, -62], head: [17, -83], fe: [28, -38], fh: [40, -56], be: [0, -36], bh: [24, -52], ...LEG.fly },
  punchF: { neck: [11, -62], head: [14, -84], fe: [43, -59], fh: [80, -60], be: [-6, -36], bh: [17, -52], ...LEG.brace },
  punchB: { neck: [13, -62], head: [16, -84], fe: [22, -40], fh: [32, -60], be: [36, -58], bh: [78, -58], ...LEG.brace },
  guard:  { neck: [0, -62], head: [3, -83], fe: [30, -54], fh: [24, -86], be: [28, -45], bh: [34, -81], ...LEG.idle },
  charge: { neck: [0, -66], head: [0, -90], fe: [28, -40], fh: [17, -13], be: [-24, -40], bh: [-13, -13], ...LEG.wide },
  castF:  { neck: [11, -62], head: [13, -84], fe: [45, -54], fh: [73, -54], be: [41, -47], bh: [71, -49], ...LEG.brace },
  castUp: { neck: [0, -66], head: [0, -88], fe: [13, -101], fh: [9, -137], be: [-9, -101], bh: [-4, -137], ...LEG.wide },
  castOne:{ neck: [2, -64], head: [5, -86], fe: [17, -103], fh: [24, -139], be: [-4, -36], bh: [20, -54], ...LEG.idle },
  castSpread: { neck: [0, -64], head: [2, -88], fe: [36, -64], fh: [73, -68], be: [-34, -64], bh: [-71, -68], ...LEG.wide },
  hurt:   { neck: [-13, -60], head: [-19, -80], fe: [-4, -32], fh: [-24, -15], be: [-28, -45], bh: [-52, -62], ...LEG.hurt },
  hook:   { neck: [12, -62], head: [16, -84], fe: [34, -74], fh: [66, -66], be: [-4, -36], bh: [18, -54], ...LEG.brace },
  upper:  { neck: [9, -60], head: [12, -82], fe: [32, -34], fh: [50, -98], be: [-4, -36], bh: [18, -54], fk: [22, 24], ff: [20, 62], bk: [-18, 28], bf: [-36, 58] },
  chop:   { neck: [14, -60], head: [18, -81], fe: [44, -86], fh: [74, -48], be: [-6, -36], bh: [16, -52], ...LEG.brace },
  knee:   { neck: [6, -64], head: [9, -86], fe: [26, -40], fh: [36, -60], be: [-4, -38], bh: [20, -56], fk: [34, -12], ff: [30, 28], bk: [-8, 30], bf: [-16, 64] },
  victory:{ neck: [2, -66], head: [4, -89], fe: [14, -100], fh: [16, -136], be: [-10, -40], bh: [6, -22], ...LEG.idle },
};
const JOINTS = Object.keys(POSES.idle);
const clonePose = n => { const o = {}; for (const k of JOINTS) o[k] = [...POSES[n][k]]; return o; };

const OUTFIT = {
  raiko: { outfit: 'gi', sleeve: 'short' }, ember: { outfit: 'gi', sleeve: 'none', wraps: true }, mira: { outfit: 'gi', sleeve: 'long' },
  gorran: { outfit: 'gi', sleeve: 'none', muscle: true }, kaze: { outfit: 'gi', sleeve: 'long', scarf: true }, vex: { outfit: 'cloak', sleeve: 'long' },
  sol: { outfit: 'armor', sleeve: 'long' }, torque: { outfit: 'mech', sleeve: 'armor' },
};

/* ---------------- primitive: shaded tapered capsule ---------------- */
function capsule(c, a, b, w1, w2, col, outline = true) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 0.001;
  let nx = -dy / L, ny = dx / L;
  const tn = Math.atan2(ny, nx);
  c.beginPath();
  c.moveTo(a[0] + nx * w1 / 2, a[1] + ny * w1 / 2);
  c.lineTo(b[0] + nx * w2 / 2, b[1] + ny * w2 / 2);
  c.arc(b[0], b[1], w2 / 2, tn, tn - Math.PI, true);
  c.lineTo(a[0] - nx * w1 / 2, a[1] - ny * w1 / 2);
  c.arc(a[0], a[1], w1 / 2, tn + Math.PI, tn, true);
  c.closePath();
  if (ny > 0) { nx = -nx; ny = -ny; }                       // light comes from above
  const w = Math.max(w1, w2) / 2, mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  const g = c.createLinearGradient(mx + nx * w, my + ny * w, mx - nx * w, my - ny * w);
  g.addColorStop(0, shade(col, 0.28)); g.addColorStop(0.45, col); g.addColorStop(1, shade(col, -0.45));
  c.fillStyle = g; c.fill();
  if (outline) { c.strokeStyle = 'rgba(10,6,12,.55)'; c.lineWidth = 1.3; c.stroke(); }
}
function poly(c, pts) { c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]); c.closePath(); }
function glowOrb(c, x, y, r, col, core = '#ffffff') {
  const g = c.createRadialGradient(x, y, 0, x, y, r * 2.4);
  g.addColorStop(0, core); g.addColorStop(0.22, col); g.addColorStop(1, alpha(col.length === 7 ? col : '#ffffff', 0));
  c.fillStyle = g; c.beginPath(); c.arc(x, y, r * 2.4, 0, Math.PI * 2); c.fill();
}
function bolt(c, x1, y1, x2, y2, col, col2, w = 8, jag = 30, segs = 10) {
  const pts = [[x1, y1]];
  for (let i = 1; i < segs; i++) { const t = i / segs; pts.push([rlerp(x1, x2, t) + (Math.random() - 0.5) * jag, rlerp(y1, y2, t) + (Math.random() - 0.5) * jag]); }
  pts.push([x2, y2]);
  c.save(); c.globalCompositeOperation = 'lighter'; c.lineJoin = 'round'; c.lineCap = 'round';
  for (const [cl, lw] of [[col2, w * 2.4], [col, w], ['#ffffff', w * 0.35]]) {
    c.strokeStyle = cl; c.lineWidth = lw; c.globalAlpha = cl === col2 ? 0.45 : 1;
    c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts) c.lineTo(p[0], p[1]); c.stroke();
  }
  c.restore();
}

/* ---------------- aura ---------------- */
function drawAura(c, col, col2, t, k, big = 1) {
  c.save(); c.globalCompositeOperation = 'lighter';
  for (let layer = 0; layer < 3; layer++) {
    const cl = layer === 1 ? col2 : col;
    const n = 30, cx = 0, cy = -38, rx = (58 - layer * 14) * (0.75 + 0.25 * k) * big, ry = (112 - layer * 24) * (0.75 + 0.25 * k) * big;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, up = Math.max(0, -Math.sin(a));
      const sp = (i % 2 ? 1 : 0.8) + 0.13 * Math.sin(t * 15 + i * 1.9 + layer * 2) + up * 0.55 * (0.6 + 0.4 * Math.sin(t * 9 + i + layer));
      pts.push([cx + Math.cos(a) * rx * sp, cy + Math.sin(a) * ry * sp - up * 36]);
    }
    const g = c.createRadialGradient(cx, cy, 8, cx, cy, ry * 1.35);
    g.addColorStop(0, alpha(cl, 0)); g.addColorStop(0.5, alpha(cl, layer === 2 ? 0.5 : 0.3 * k + 0.1)); g.addColorStop(1, alpha(cl, 0));
    c.fillStyle = g; poly(c, pts); c.fill();
  }
  c.restore();
}

/* ---------------- hair & headgear ---------------- */
function drawHead(c, f, j, t, form, C) {
  const ch = f.ch, hx = j.head[0], hy = j.head[1], OF = OUTFIT[ch.id];
  const hairC = C.hair[form], hairD = C.hairD[form], eyeC = C.eye[form];
  const glowEyes = form > 0 || f.charging || f.state === 'cast' || f.state === 'transform';
  const hurt = f.state === 'hurt' || f.state === 'ko';
  const sc = 1 + form * 0.18;
  // back hair layers
  if (ch.hair === 'long') {
    const s = Math.sin(t * 3 + f.x * 0.01) * 6;
    c.fillStyle = hairD; c.beginPath(); c.moveTo(hx - 6, hy - 16); c.quadraticCurveTo(hx - 34, hy + 10, hx - 46 - s, hy + 66 * sc); c.lineTo(hx - 24 - s * 0.5, hy + 58 * sc); c.quadraticCurveTo(hx - 16, hy + 20, hx + 4, hy - 4); c.fill();
  } else if (ch.hair === 'mane') {
    const s = Math.sin(t * 2.5) * 5;
    c.fillStyle = hairD;
    poly(c, [[hx - 2, hy - 20], [hx - 40, hy - 20 * sc], [hx - 56 * sc, hy + 4 + s], [hx - 44, hy + 30 * sc + s], [hx - 50 * sc, hy + 52 * sc], [hx - 16, hy + 24], [hx, hy + 6]]); c.fill();
    if (form === 2) { c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = alpha('#ffe08a', 0.7 + 0.2 * Math.sin(t * 4)); c.lineWidth = 4; c.beginPath(); c.ellipse(hx - 10, hy - 6, 30, 30, 0, 0, Math.PI * 2); c.stroke(); c.restore(); }
  } else if (ch.hair === 'hood') {
    const s = Math.sin(t * 3) * 4;
    c.fillStyle = C.gi; poly(c, [[hx - 18, hy - 14], [hx - 40, hy + 10 + s], [hx - 30, hy + 30], [hx - 8, hy + 18]]); c.fill();
  }
  // neck
  capsule(c, j.neck, [hx - 2, hy + 8], 13, 12, ch.hair === 'helmet' ? C.gi2 : C.skinD);
  // skull
  if (ch.hair === 'helmet') {
    const g = c.createLinearGradient(hx, hy - 18, hx, hy + 16); g.addColorStop(0, shade(C.gi, 0.35)); g.addColorStop(1, shade(C.gi, -0.35));
    c.fillStyle = g; c.beginPath(); c.ellipse(hx, hy, 16, 18, 0, 0, Math.PI * 2); c.fill(); c.strokeStyle = 'rgba(0,0,0,.5)'; c.lineWidth = 1.3; c.stroke();
    c.save(); c.globalCompositeOperation = 'lighter';
    const vg = c.createLinearGradient(hx, hy - 6, hx + 16, hy - 6); vg.addColorStop(0, alpha(eyeC, 0.2)); vg.addColorStop(1, eyeC);
    c.fillStyle = vg; c.fillRect(hx + 1, hy - 7, 15, 6);
    glowOrb(c, hx + 12, hy - 4, 3 + form, eyeC);
    c.restore();
    c.strokeStyle = shade(C.gi, -0.5); c.lineWidth = 2; c.beginPath(); c.moveTo(hx - 6, hy - 16); c.lineTo(hx - 12, hy - 30); c.stroke();
    c.fillStyle = eyeC; c.beginPath(); c.arc(hx - 12, hy - 30, 2.5, 0, Math.PI * 2); c.fill();
    return;
  }
  const sk = c.createRadialGradient(hx + 4, hy - 6, 2, hx, hy, 20);
  sk.addColorStop(0, shade(C.skin, 0.18)); sk.addColorStop(0.7, C.skin); sk.addColorStop(1, shade(C.skin, -0.35));
  c.fillStyle = sk;
  c.beginPath(); c.moveTo(hx - 13, hy - 6);
  c.bezierCurveTo(hx - 15, hy - 22, hx + 12, hy - 24, hx + 14, hy - 6);   // crown
  c.lineTo(hx + 16, hy + 2); c.lineTo(hx + 13, hy + 6);                   // nose
  c.lineTo(hx + 12, hy + 12); c.quadraticCurveTo(hx + 6, hy + 19, hx - 2, hy + 16); // jaw
  c.quadraticCurveTo(hx - 12, hy + 10, hx - 13, hy - 6); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(10,6,12,.5)'; c.lineWidth = 1.2; c.stroke();
  c.fillStyle = C.skinD; c.beginPath(); c.ellipse(hx - 4, hy + 1, 3.5, 5, 0, 0, Math.PI * 2); c.fill();
  // eye
  if (ch.hair === 'hood') {
    c.fillStyle = 'rgba(0,0,0,.55)'; c.beginPath(); c.ellipse(hx + 4, hy - 1, 13, 15, 0, 0, Math.PI * 2); c.fill();
  }
  if (hurt) { c.strokeStyle = '#1a1010'; c.lineWidth = 2; c.beginPath(); c.moveTo(hx + 5, hy - 4); c.lineTo(hx + 11, hy + 1); c.moveTo(hx + 11, hy - 4); c.lineTo(hx + 5, hy + 1); c.stroke(); }
  else {
    c.fillStyle = '#f6f2ea'; c.beginPath(); c.moveTo(hx + 3, hy - 2); c.quadraticCurveTo(hx + 8, hy - 6, hx + 12, hy - 2); c.quadraticCurveTo(hx + 8, hy + 1, hx + 3, hy - 2); c.fill();
    c.fillStyle = eyeC; c.beginPath(); c.arc(hx + 9, hy - 2.2, 2.1, 0, Math.PI * 2); c.fill();
    if (glowEyes) { c.save(); c.globalCompositeOperation = 'lighter'; glowOrb(c, hx + 9, hy - 2.2, 2.5 + form, eyeC); c.restore(); }
    c.strokeStyle = shade(hairC === '#ffffff' ? '#888888' : hairD, -0.2); c.lineWidth = 2.2; c.lineCap = 'round';
    c.beginPath(); c.moveTo(hx + 2, hy - 8); c.lineTo(hx + 13, hy - 6 + (f.state === 'cast' || f.charging ? 1.5 : 0)); c.stroke();
  }
  c.strokeStyle = 'rgba(40,16,10,.7)'; c.lineWidth = 1.4; c.beginPath();
  if (f.charging || f.state === 'cast' || f.state === 'transform') { c.ellipse(hx + 9, hy + 10, 2.5, 2, 0, 0, Math.PI * 2); } else { c.moveTo(hx + 6, hy + 10); c.lineTo(hx + 11, hy + 9.5); }
  c.stroke();
  // markings in Apex form
  if (form === 2 && ch.hair !== 'hood') {
    c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = alpha(C.aura[2] === '#ffffff' ? C.aura2[2] : C.aura[2], 0.9); c.lineWidth = 1.6;
    c.beginPath(); c.moveTo(hx + 4, hy + 2); c.lineTo(hx + 8, hy + 8); c.moveTo(hx + 10, hy + 2); c.lineTo(hx + 13, hy + 7); c.stroke(); c.restore();
  }
  // front hair / headgear
  const g = c.createLinearGradient(hx, hy - 50 * sc, hx, hy + 10); g.addColorStop(0, shade(hairC, 0.25)); g.addColorStop(1, hairD);
  c.fillStyle = g; c.strokeStyle = 'rgba(10,6,12,.5)'; c.lineWidth = 1.2;
  const P = pts => pts.map(([x, y]) => [hx + x * sc, hy + y * sc]);
  const wob = Math.sin(t * 7) * 2 * form;
  switch (ch.hair) {
    case 'spiky':
      poly(c, P([[-14, 8], [-36, 2], [-22, -8], [-42, -24 + wob], [-18, -22], [-26, -48 - wob], [-6, -28], [4, -56 + wob], [12, -28], [28, -44], [20, -16], [32, -14], [18, -4], [20, 4], [12, -6], [4, -12], [-6, -6]])); c.fill(); c.stroke(); break;
    case 'flame': {
      const s = Math.sin(t * 8) * 3;
      poly(c, P([[-14, 10], [-50, 4 + s], [-26, -6], [-60, -24 + s], [-22, -20], [-42, -44 + s], [-6, -30], [6, -38 + s], [16, -22], [20, -8], [14, -10], [4, -14], [-6, -6]])); c.fill(); c.stroke(); break; }
    case 'long':
      c.beginPath(); c.arc(hx - 1, hy - 3, 16.5, Math.PI * 0.82, Math.PI * 2.06); c.closePath(); c.fill();
      poly(c, [[hx + 4, hy - 18], [hx + 18, hy - 9], [hx + 15, hy + 4], [hx + 10, hy - 5], [hx + 4, hy - 1]]); c.fill(); break;
    case 'mane':
      poly(c, P([[-14, 4], [-20, -16], [-6, -22], [8, -22], [18, -12], [14, -6], [6, -12], [-4, -10]])); c.fill(); c.stroke();
      c.fillStyle = C.trim; c.fillRect(hx - 12, hy - 14, 24, 3); break;
    case 'bald': {
      const s = Math.sin(t * 7) * 4;
      c.strokeStyle = hairC; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(hx - 14, hy - 9); c.lineTo(hx + 14, hy - 11); c.stroke();
      c.lineWidth = 4;
      c.beginPath(); c.moveTo(hx - 14, hy - 9); c.quadraticCurveTo(hx - 30, hy - 12 + s, hx - 46, hy - 4 + s); c.stroke();
      c.beginPath(); c.moveTo(hx - 14, hy - 8); c.quadraticCurveTo(hx - 28, hy + 1 - s, hx - 42, hy + 9 - s); c.stroke();
      if (form > 0) { c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = alpha(C.aura[form], 0.85); c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(hx - 2, hy - 20); c.lineTo(hx + 2, hy - 13); c.lineTo(hx - 1, hy - 8); c.moveTo(hx + 8, hy - 18); c.lineTo(hx + 6, hy - 12); c.stroke(); c.restore(); }
      break; }
    case 'topknot': {
      c.beginPath(); c.arc(hx - 1, hy - 4, 15.5, Math.PI * 0.9, Math.PI * 2.02); c.closePath(); c.fill();
      c.beginPath(); c.ellipse(hx - 6, hy - 24 * sc, 6 * sc, 8 * sc, -0.4, 0, Math.PI * 2); c.fill();
      const s = Math.sin(t * 6) * 4;
      if (form > 0) { poly(c, P([[-10, -26], [-24, -40 + s], [-14, -28], [-30, -30 - s], [-12, -22]])); c.fill(); }
      // scarf mask
      c.fillStyle = C.trim; c.beginPath(); c.moveTo(hx - 12, hy + 2); c.lineTo(hx + 15, hy + 1); c.lineTo(hx + 12, hy + 14); c.quadraticCurveTo(hx, hy + 20, hx - 10, hy + 12); c.closePath(); c.fill();
      c.strokeStyle = C.trim; c.lineWidth = 5; c.lineCap = 'round';
      c.beginPath(); c.moveTo(hx - 10, hy + 8); c.quadraticCurveTo(hx - 34, hy + 4 + s, hx - 56, hy + 12 - s); c.stroke();
      break; }
    case 'hood': {
      const hg = c.createLinearGradient(hx, hy - 24, hx, hy + 20); hg.addColorStop(0, shade(C.gi, 0.25)); hg.addColorStop(1, shade(C.gi, -0.3));
      c.fillStyle = hg; c.beginPath(); c.moveTo(hx + 16, hy - 6); c.quadraticCurveTo(hx + 10, hy - 28, hx - 8, hy - 26); c.quadraticCurveTo(hx - 24, hy - 20, hx - 20, hy + 6); c.quadraticCurveTo(hx - 14, hy + 20, hx - 2, hy + 18); c.lineTo(hx + 2, hy + 6); c.quadraticCurveTo(hx + 4, hy - 12, hx + 16, hy - 6); c.fill(); c.stroke();
      c.save(); c.globalCompositeOperation = 'lighter'; glowOrb(c, hx + 9, hy - 2, 3 + form * 1.5, eyeC); glowOrb(c, hx + 4, hy - 2, 2 + form, eyeC); c.restore();
      if (form > 0) { c.strokeStyle = alpha(C.aura[form], 0.8); c.lineWidth = 2; c.beginPath(); c.moveTo(hx + 16, hy - 6); c.quadraticCurveTo(hx + 10, hy - 28, hx - 8, hy - 26); c.stroke(); }
      break; }
  }
}

/* ---------------- fighter ---------------- */
function drawFighter(c, f, t, opts = {}) {
  const ch = f.ch, C = ch.c, Bw = ch.build, j = f.pj, form = f.form || 0, OF = OUTFIT[ch.id];
  const size = ch.size * (1 + form * 0.04) * 1.08;
  c.save();
  const bob = f.state === 'ko' || opts.still ? 0 : Math.sin(t * 3 + (f.cpu ? 1.5 : 0)) * 6;
  c.translate(f.x + (f.shakeX || 0), f.y + bob);
  c.scale(f.face * size, size);
  c.rotate(f.tilt || 0);
  if (f.state === 'ko') c.rotate(-1.45 * (f.koRot || 0));
  if (f.phase > 0) c.globalAlpha = 0.35 + 0.15 * Math.sin(t * 30);
  const auraK = f.state === 'transform' ? 1.3 : f.charging ? 1 : f.state === 'cast' ? 0.85 : form > 0 ? 0.45 + form * 0.12 : (f.auraT || 0);
  if (auraK > 0.01) drawAura(c, C.aura[form], C.aura2[form], t, auraK, 1 + form * 0.12);
  const sh = [j.neck[0], j.neck[1] + 7], shB = [j.neck[0] - 4, j.neck[1] + 8];
  const armW = OF.muscle ? 15 : 12, legW = 17;
  const sleeveCol = OF.sleeve === 'none' ? C.skin : C.gi;

  // cloak behind
  if (OF.outfit === 'cloak') {
    const s = Math.sin(t * 4 + f.x * 0.01) * 8 + (f.vx || 0) * f.face * -0.02;
    const cg = c.createLinearGradient(0, j.neck[1], 0, 80); cg.addColorStop(0, shade(C.gi, 0.15)); cg.addColorStop(1, shade(C.gi, -0.4));
    c.fillStyle = cg; c.beginPath(); c.moveTo(j.neck[0] - 6, j.neck[1] + 4);
    c.quadraticCurveTo(-40 + s, 0, -58 + s * 1.5, 78); c.lineTo(-30 + s, 70); c.lineTo(-10, 82); c.lineTo(10, 60); c.lineTo(j.neck[0] + 10, j.neck[1] + 8); c.closePath(); c.fill();
    if (form > 0) { c.strokeStyle = alpha(C.aura[form], 0.6); c.lineWidth = 2; c.stroke(); }
  }
  // back leg
  capsule(c, [0, 0], j.bk, legW * Bw, 14 * Bw, C.pants2); capsule(c, j.bk, j.bf, 14 * Bw, 11 * Bw, C.pants2);
  drawBoot(c, j.bf, j.bk, C.boots, -0.2, Bw);
  // back arm
  capsule(c, shB, j.be, armW * Bw, (armW - 2) * Bw, OF.sleeve === 'none' ? C.skinD : shade(sleeveCol, -0.15));
  capsule(c, j.be, j.bh, (armW - 2) * Bw, 9 * Bw, OF.sleeve === 'long' || OF.sleeve === 'armor' ? shade(C.gi, -0.15) : C.skinD);
  drawFist(c, j.bh, j.be, OF.sleeve === 'armor' ? C.gi2 : C.skinD, 8.5 * Bw);
  // sash tails
  if (OF.outfit === 'gi') {
    const s = Math.sin(t * 8 + f.x * 0.01) * 4;
    c.strokeStyle = C.trim; c.lineWidth = 5; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-10 * Bw, -4); c.quadraticCurveTo(-26 * Bw, 8 + s, -40 * Bw, 18 - s); c.stroke();
  }
  // torso
  drawTorso(c, f, j, C, OF, Bw, form, t);
  // front leg
  capsule(c, [0, 0], j.fk, (legW + 1) * Bw, 15 * Bw, C.pants); capsule(c, j.fk, j.ff, 15 * Bw, 12 * Bw, C.pants);
  drawBoot(c, j.ff, j.fk, C.boots, 0, Bw);
  // head
  drawHead(c, f, j, t, form, C);
  // front arm
  capsule(c, sh, j.fe, (armW + 1) * Bw, armW * Bw, sleeveCol);
  capsule(c, j.fe, j.fh, armW * Bw, 10 * Bw, OF.sleeve === 'long' || OF.sleeve === 'armor' ? C.gi : C.skin);
  if (OF.wraps || OF.sleeve === 'short') { const wb = [rlerp(j.fe[0], j.fh[0], 0.7), rlerp(j.fe[1], j.fh[1], 0.7)]; capsule(c, wb, [rlerp(j.fe[0], j.fh[0], 0.85), rlerp(j.fe[1], j.fh[1], 0.85)], 12 * Bw, 11 * Bw, OF.wraps ? '#e8e2d0' : C.trim); }
  if (OF.sleeve === 'armor') { c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = alpha(C.aura[form], 0.8); c.lineWidth = 2; c.beginPath(); c.moveTo(j.fe[0], j.fe[1]); c.lineTo(rlerp(j.fe[0], j.fh[0], 0.8), rlerp(j.fe[1], j.fh[1], 0.8)); c.stroke(); c.restore(); }
  drawFist(c, j.fh, j.fe, OF.sleeve === 'armor' ? C.gi2 : C.skin, 9.5 * Bw);
  // Apex crackle
  if (form === 2 && Math.random() < 0.5) {
    const a = Math.random() * Math.PI * 2, r = 40 + Math.random() * 30;
    bolt(c, Math.cos(a) * r, -40 + Math.sin(a) * r * 1.4, Math.cos(a + 0.6) * r * 0.6, -40 + Math.sin(a + 0.6) * r, C.aura[2], C.aura2[2], 2, 12, 4);
  }
  if (f.flash > 0) {
    c.globalCompositeOperation = 'lighter'; c.globalAlpha = Math.min(1, f.flash * 5);
    c.fillStyle = '#ffffff'; c.beginPath(); c.ellipse(0, -40, 36 * Bw, 78, 0, 0, Math.PI * 2); c.fill();
  }
  if (f.frozen > 0) {
    c.globalCompositeOperation = 'source-over'; c.globalAlpha = 0.75;
    const ig = c.createLinearGradient(-40, -120, 40, 70); ig.addColorStop(0, 'rgba(220,250,255,.9)'); ig.addColorStop(1, 'rgba(120,200,240,.7)');
    c.fillStyle = ig; poly(c, [[-38, 70], [-46, -20], [-24, -118], [8, -132], [40, -96], [46, 10], [34, 72]]); c.fill();
    c.strokeStyle = 'rgba(255,255,255,.9)'; c.lineWidth = 2; c.stroke();
  }
  c.restore();
}
function drawFist(c, h, e, col, r) {
  const a = Math.atan2(h[1] - e[1], h[0] - e[0]);
  c.save(); c.translate(h[0], h[1]); c.rotate(a);
  const g = c.createRadialGradient(-r * 0.3, -r * 0.4, 1, 0, 0, r * 1.2); g.addColorStop(0, shade(col, 0.25)); g.addColorStop(1, shade(col, -0.35));
  c.fillStyle = g; c.beginPath(); c.roundRect ? c.roundRect(-r * 0.9, -r * 0.85, r * 1.9, r * 1.7, r * 0.55) : c.arc(0, 0, r, 0, Math.PI * 2); c.fill();
  c.strokeStyle = 'rgba(10,6,12,.55)'; c.lineWidth = 1.2; c.stroke();
  c.strokeStyle = 'rgba(10,6,12,.35)'; c.beginPath(); for (let i = -1; i <= 1; i++) { c.moveTo(r * 0.6, i * r * 0.45); c.lineTo(r * 0.95, i * r * 0.45); } c.stroke();
  c.restore();
}
function drawBoot(c, foot, knee, col, dk, Bw) {
  const a = Math.atan2(foot[1] - knee[1], foot[0] - knee[0]) - Math.PI / 2;
  c.save(); c.translate(foot[0], foot[1]); c.rotate(a);
  const g = c.createLinearGradient(0, -10, 0, 8); g.addColorStop(0, shade(col, 0.2 + dk)); g.addColorStop(1, shade(col, -0.4 + dk));
  c.fillStyle = g; c.beginPath(); c.moveTo(-7 * Bw, -12); c.lineTo(7 * Bw, -12); c.lineTo(9 * Bw, 2); c.quadraticCurveTo(20 * Bw, 2, 20 * Bw, 8); c.lineTo(-8 * Bw, 8); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(10,6,12,.55)'; c.lineWidth = 1.2; c.stroke();
  c.restore();
}
function drawTorso(c, f, j, C, OF, Bw, form, t) {
  const nk = j.neck, top = nk[1] + 9;
  const shR = nk[0] + 19 * Bw, shL = nk[0] - 17 * Bw;
  const pts = [[-14 * Bw, 2], [14 * Bw, 2], [shR, top + 2], [nk[0] + 8 * Bw, top - 4], [nk[0] - 8 * Bw, top - 4], [shL, top + 2]];
  const g = c.createLinearGradient(-20, top, 24, top + 40);
  const base = OF.outfit === 'armor' ? C.gi : C.gi;
  g.addColorStop(0, shade(base, 0.22)); g.addColorStop(0.5, base); g.addColorStop(1, shade(base, -0.45));
  c.fillStyle = g; poly(c, pts); c.fill(); c.strokeStyle = 'rgba(10,6,12,.55)'; c.lineWidth = 1.3; c.stroke();
  if (OF.outfit === 'gi') {
    // open chest V
    const vg = c.createLinearGradient(nk[0], top, nk[0] + 6, top + 30); vg.addColorStop(0, C.skin); vg.addColorStop(1, shade(C.skin, -0.3));
    c.fillStyle = vg; poly(c, [[nk[0] - 5 * Bw, top - 3], [nk[0] + 11 * Bw, top - 3], [nk[0] + 4 * Bw, top + (OF.muscle ? 40 : 26)]]); c.fill();
    if (OF.muscle) { c.strokeStyle = shade(C.skin, -0.4); c.lineWidth = 1.2; c.beginPath(); c.moveTo(nk[0] + 3, top + 6); c.quadraticCurveTo(nk[0] + 8, top + 14, nk[0] + 4, top + 22); c.stroke(); }
    c.strokeStyle = shade(C.gi, -0.5); c.lineWidth = 1.2; c.beginPath(); c.moveTo(nk[0] - 5 * Bw, top - 3); c.lineTo(nk[0] + 4 * Bw, top + 26); c.moveTo(-6, top + 22); c.quadraticCurveTo(-2, top + 30, -8, top + 40); c.stroke();
    capsule(c, [-15 * Bw, -3], [15 * Bw, -3], 8, 8, C.trim);
  } else if (OF.outfit === 'cloak') {
    c.fillStyle = shade(C.gi, -0.3); poly(c, [[nk[0] - 6, top - 2], [nk[0] + 12, top - 2], [nk[0] + 2, top + 30]]); c.fill();
    c.save(); c.globalCompositeOperation = 'lighter'; c.strokeStyle = alpha(C.aura[form], 0.5 + form * 0.2); c.lineWidth = 1.8;
    c.beginPath(); c.moveTo(nk[0] - 2, top + 6); c.lineTo(nk[0] + 3, top + 18); c.lineTo(nk[0] - 1, top + 30); c.stroke(); c.restore();
    capsule(c, [-14 * Bw, -3], [14 * Bw, -3], 6, 6, C.trim);
  } else if (OF.outfit === 'armor') {
    c.fillStyle = shade(C.trim, 0.1); poly(c, [[nk[0] - 10, top + 2], [nk[0] + 14, top + 2], [nk[0] + 8, top + 34], [nk[0] - 4, top + 34]]); c.fill();
    c.fillStyle = C.gi; poly(c, [[nk[0] - 7, top + 5], [nk[0] + 11, top + 5], [nk[0] + 6, top + 30], [nk[0] - 2, top + 30]]); c.fill();
    c.save(); c.globalCompositeOperation = 'lighter'; glowOrb(c, nk[0] + 2, top + 14, 3 + form * 1.5, C.aura[form]); c.restore();
    // pauldron
    capsule(c, [nk[0] + 10, top + 2], [nk[0] + 24 * Bw, top + 8], 16, 12, C.trim);
    // tabard
    c.fillStyle = shade(C.trim, -0.1); poly(c, [[-6, -2], [10, -2], [8, 34], [-4, 34]]); c.fill();
  } else if (OF.outfit === 'mech') {
    c.strokeStyle = shade(C.gi, -0.5); c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(-12, top + 18); c.lineTo(14, top + 18); c.moveTo(-10, top + 32); c.lineTo(12, top + 32); c.stroke();
    c.save(); c.globalCompositeOperation = 'lighter';
    const pulse = 0.7 + 0.3 * Math.sin(t * 6);
    glowOrb(c, nk[0] + 4, top + 12, (4 + form * 2) * pulse, C.aura[form]);
    c.restore();
    capsule(c, [nk[0] + 6, top], [nk[0] + 26 * Bw, top + 6], 20, 15, C.gi2);
    capsule(c, [-14 * Bw, -3], [14 * Bw, -3], 7, 7, C.trim);
  }
}
// simple flat silhouette used for afterimages and clones
function drawGhost(c, s, col, a) {
  const j = s.pj;
  c.save(); c.translate(s.x, s.y); c.scale(s.face * s.size, s.size); c.rotate(s.tilt || 0);
  c.globalAlpha = a; c.globalCompositeOperation = 'lighter';
  c.strokeStyle = col; c.fillStyle = col; c.lineCap = 'round'; c.lineJoin = 'round';
  const L = (pts, w) => { c.lineWidth = w; c.beginPath(); c.moveTo(pts[0][0], pts[0][1]); for (const p of pts) c.lineTo(p[0], p[1]); c.stroke(); };
  L([[0, 0], j.bk, j.bf], 14); L([[0, 0], j.fk, j.ff], 15); L([[0, 0], j.neck], 26);
  L([[j.neck[0], j.neck[1] + 7], j.be, j.bh], 11); L([[j.neck[0], j.neck[1] + 7], j.fe, j.fh], 12);
  c.beginPath(); c.arc(j.head[0], j.head[1], 15, 0, Math.PI * 2); c.fill();
  c.restore();
}

/* ---------------- stages ---------------- */
function buildStage(st) {
  const W = R2.W, H = R2.H, DPR = R2.DPR;
  const mk = (w, h) => { const cv = document.createElement('canvas'); cv.width = Math.max(1, Math.round(w * DPR)); cv.height = Math.max(1, Math.round(h * DPR)); const g = cv.getContext('2d'); g.scale(DPR, DPR); return [cv, g]; };
  const L = {};
  // far layer
  { const fw = W * 2.2, fh = H * 0.55, [cv, g] = mk(fw, fh), R = rseed(11);
    if (st.id === 'canyon') {
      g.fillStyle = st.far; g.beginPath(); g.moveTo(0, fh);
      for (let x = 0; x <= fw; x += 40 + R() * 90) { const tall = R() < 0.35, top = fh * (tall ? 0.15 + R() * 0.25 : 0.55 + R() * 0.25), w = 60 + R() * 140; g.lineTo(x, fh * 0.85); g.lineTo(x + w * 0.1, top); g.lineTo(x + w * 0.9, top + R() * 10); g.lineTo(x + w, fh * 0.85); }
      g.lineTo(fw, fh); g.closePath(); g.fill();
    } else if (st.id === 'temple') {
      for (let i = 0; i < 40; i++) { const x = R() * fw, y = fh * (0.4 + R() * 0.55), r = 40 + R() * 110; const cg = g.createRadialGradient(x, y, 0, x, y, r); cg.addColorStop(0, 'rgba(255,255,255,.95)'); cg.addColorStop(1, 'rgba(220,235,250,0)'); g.fillStyle = cg; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
      g.fillStyle = 'rgba(140,170,210,.6)';
      for (let i = 0; i < 6; i++) { const x = R() * fw, y = fh * (0.2 + R() * 0.3), w = 50 + R() * 60; g.beginPath(); g.ellipse(x, y, w, w * 0.25, 0, 0, Math.PI); g.fill(); for (let k = 0; k < 4; k++) g.fillRect(x - w * 0.6 + k * w * 0.4, y - w * 0.5, w * 0.08, w * 0.5); g.fillRect(x - w * 0.7, y - w * 0.58, w * 1.4, w * 0.1); }
    } else if (st.id === 'neon') {
      for (let x = 0; x < fw; x += 30 + R() * 50) {
        const w = 30 + R() * 60, h = fh * (0.3 + R() * 0.65);
        g.fillStyle = st.far; g.fillRect(x, fh - h, w, h);
        for (let wy = fh - h + 8; wy < fh - 6; wy += 9) for (let wx = x + 4; wx < x + w - 4; wx += 7) if (R() < 0.3) { g.fillStyle = R() < 0.7 ? 'rgba(255,220,150,.5)' : 'rgba(120,220,255,.5)'; g.fillRect(wx, wy, 3, 4); }
      }
    } else if (st.id === 'magma') {
      for (let i = 0; i < 5; i++) {
        const x = R() * fw, w = 200 + R() * 300, h = fh * (0.4 + R() * 0.5);
        g.fillStyle = st.far; g.beginPath(); g.moveTo(x - w, fh); g.lineTo(x - w * 0.12, fh - h); g.lineTo(x + w * 0.12, fh - h); g.lineTo(x + w, fh); g.fill();
        const lg = g.createRadialGradient(x, fh - h, 0, x, fh - h, 80); lg.addColorStop(0, 'rgba(255,140,40,.9)'); lg.addColorStop(1, 'rgba(255,80,20,0)'); g.fillStyle = lg; g.fillRect(x - 80, fh - h - 80, 160, 160);
        g.strokeStyle = 'rgba(255,110,30,.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x, fh - h); g.lineTo(x + 20 - R() * 40, fh - h * 0.6); g.lineTo(x + 30 - R() * 60, fh - h * 0.2); g.stroke();
      }
    } else {
      g.fillStyle = st.far; g.beginPath(); g.moveTo(0, fh);
      for (let x = 0; x <= fw; x += 60 + R() * 120) g.lineTo(x, fh * (0.25 + R() * 0.55));
      g.lineTo(fw, fh); g.closePath(); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 2; g.stroke();
    }
    L.far = { c: cv, w: fw, h: fh };
  }
  // mid layer
  { const mw = W * 2.6, mh = H * 0.6, [cv, g] = mk(mw, mh), R = rseed(23);
    for (let i = 0; i < 26; i++) {
      const x = R() * mw, w = 30 + R() * 70, top = mh * (0.15 + R() * 0.6);
      if (st.id === 'neon') {
        g.fillStyle = st.mid; g.fillRect(x - w, top, w * 2, mh - top);
        const neon = ['#ff4fd8', '#4fe0ff', '#ffd23a', '#7a5cff'][(R() * 4) | 0];
        g.shadowColor = neon; g.shadowBlur = 14; g.fillStyle = neon; g.fillRect(x - w * 0.6, top + 20 + R() * 40, w * 1.2, 5); g.shadowBlur = 0;
        for (let wy = top + 40; wy < mh; wy += 14) for (let wx = x - w + 6; wx < x + w - 6; wx += 10) if (R() < 0.25) { g.fillStyle = 'rgba(255,230,180,.35)'; g.fillRect(wx, wy, 4, 6); }
      } else if (st.id === 'temple') {
        const y = mh * (0.3 + R() * 0.5), iw = w * 1.4;
        g.fillStyle = '#b8c8de'; g.beginPath(); g.moveTo(x - iw, y); g.lineTo(x + iw, y); g.lineTo(x + iw * 0.4, y + iw * 0.9); g.lineTo(x, y + iw * 1.3); g.lineTo(x - iw * 0.5, y + iw * 0.8); g.closePath(); g.fill();
        g.fillStyle = '#5a8a5a'; g.fillRect(x - iw, y - 5, iw * 2, 6);
        if (R() < 0.6) { g.fillStyle = '#e8eef6'; for (let k = 0; k < 3; k++) g.fillRect(x - iw * 0.6 + k * iw * 0.55, y - iw * 0.7, iw * 0.12, iw * 0.7); g.fillStyle = '#c84a3a'; g.beginPath(); g.moveTo(x - iw * 0.8, y - iw * 0.7); g.lineTo(x, y - iw * 1.1); g.lineTo(x + iw * 0.8, y - iw * 0.7); g.fill(); }
      } else {
        const gr = g.createLinearGradient(0, top, 0, mh); gr.addColorStop(0, shade(st.mid, 0.1)); gr.addColorStop(1, shade(st.mid, -0.3));
        g.fillStyle = gr;
        g.beginPath(); g.moveTo(x - w, mh); g.lineTo(x - w * 0.45, top + 20); g.lineTo(x - w * 0.1, top); g.lineTo(x + w * 0.35, top + 14); g.lineTo(x + w, mh); g.closePath(); g.fill();
        if (st.id === 'magma') { g.strokeStyle = 'rgba(255,120,30,.55)'; g.lineWidth = 2; g.beginPath(); g.moveTo(x - w * 0.1, top + 10); g.lineTo(x + w * 0.1, top + 60); g.lineTo(x - w * 0.2, mh); g.stroke(); }
        if (st.id === 'moon') { g.strokeStyle = 'rgba(220,240,255,.5)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x - w * 0.1, top); g.lineTo(x - w * 0.45, top + 20); g.stroke(); }
        if (R() < 0.3) { g.beginPath(); g.ellipse(x + (R() - 0.5) * 120, top - 60 - R() * 80, 26 + R() * 30, 10 + R() * 8, 0, 0, Math.PI * 2); g.fill(); }
      }
    }
    L.mid = { c: cv, w: mw, h: mh };
  }
  R2.layers = L; R2.stage = st;
  // weather field
  const n = st.weather === 'rain' ? 140 : st.weather === 'clouds' ? 14 : 90;
  R2.weather = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, s: Math.random(), z: 0.3 + Math.random() * 0.7 }));
}

function drawSky(c, cam, t) {
  const st = R2.stage, W = R2.W, H = R2.H;
  const g = c.createLinearGradient(0, 0, 0, H);
  st.sky.forEach((col, i) => g.addColorStop(i / (st.sky.length - 1), col));
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  const px = W * 0.24 - (cam.x - 1200) * 0.02, py = H * 0.2 - (cam.y - 800) * 0.01, pr = Math.min(W, H) * 0.14;
  if (st.id === 'neon' || st.id === 'moon' || st.id === 'canyon') {
    c.fillStyle = 'rgba(255,255,255,.7)';
    for (let i = 0; i < 70; i++) { const x = (i * 197.3) % W, y = (i * 91.7) % (H * 0.45); const tw = 0.5 + 0.5 * Math.sin(t * 2 + i); c.globalAlpha = 0.3 + tw * 0.5; c.fillRect(x, y, 1.6, 1.6); }
    c.globalAlpha = 1;
  }
  if (st.body === 'ringed') {
    const pg = c.createRadialGradient(px - pr * 0.4, py - pr * 0.4, pr * 0.1, px, py, pr); pg.addColorStop(0, '#f3e6c4'); pg.addColorStop(1, '#a58b6a');
    c.fillStyle = pg; c.beginPath(); c.arc(px, py, pr, 0, Math.PI * 2); c.fill();
    c.strokeStyle = 'rgba(240,226,190,.55)'; c.lineWidth = pr * 0.08; c.beginPath(); c.ellipse(px, py, pr * 1.8, pr * 0.42, -0.35, 0, Math.PI * 2); c.stroke();
  } else if (st.body === 'sun') {
    const sg = c.createRadialGradient(W * 0.75, H * 0.18, 0, W * 0.75, H * 0.18, pr * 2.5); sg.addColorStop(0, 'rgba(255,255,240,1)'); sg.addColorStop(0.15, 'rgba(255,248,220,.9)'); sg.addColorStop(1, 'rgba(255,240,200,0)');
    c.fillStyle = sg; c.fillRect(0, 0, W, H * 0.7);
  } else if (st.body === 'moon') {
    c.fillStyle = '#f2e8ff'; c.beginPath(); c.arc(W * 0.78, H * 0.16, pr * 0.6, 0, Math.PI * 2); c.fill();
    c.fillStyle = st.sky[1]; c.beginPath(); c.arc(W * 0.78 + pr * 0.25, H * 0.16 - pr * 0.1, pr * 0.55, 0, Math.PI * 2); c.fill();
  } else if (st.body === 'planet') {
    const pg = c.createRadialGradient(px - pr * 0.5, py - pr * 0.3, pr * 0.1, px, py, pr * 1.6); pg.addColorStop(0, '#9fd8ff'); pg.addColorStop(0.5, '#2a6aa8'); pg.addColorStop(1, '#061a36');
    c.fillStyle = pg; c.beginPath(); c.arc(px, py + pr * 0.2, pr * 1.5, 0, Math.PI * 2); c.fill();
    // aurora
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let k = 0; k < 3; k++) {
      c.beginPath(); c.moveTo(0, H * 0.3);
      for (let x = 0; x <= W; x += 40) c.lineTo(x, H * (0.22 + k * 0.05) + Math.sin(x * 0.006 + t * 0.6 + k) * 30);
      c.lineTo(W, 0); c.lineTo(0, 0); c.closePath();
      const ag = c.createLinearGradient(0, 0, 0, H * 0.35); ag.addColorStop(0, 'rgba(80,255,180,0)'); ag.addColorStop(1, `rgba(${k ? 140 : 80},255,${k ? 240 : 180},.12)`);
      c.fillStyle = ag; c.fill();
    }
    c.restore();
  }
  if (st.id === 'magma') { const mg = c.createLinearGradient(0, H * 0.4, 0, H); mg.addColorStop(0, 'rgba(255,90,20,0)'); mg.addColorStop(1, 'rgba(255,90,20,.25)'); c.fillStyle = mg; c.fillRect(0, 0, W, H); }
}

function drawLayers(c, cam, ground) {
  const L = R2.layers, W = R2.W, H = R2.H;
  const hz = H / 2 + (ground - cam.y) * cam.z;
  c.drawImage(L.far.c, W / 2 - L.far.w / 2 - (cam.x - 1200) * cam.z * 0.12, hz - L.far.h + 4, L.far.w, L.far.h);
  c.drawImage(L.mid.c, W / 2 - L.mid.w / 2 - (cam.x - 1200) * cam.z * 0.35, hz - L.mid.h + 4, L.mid.w, L.mid.h);
  const hzg = c.createLinearGradient(0, hz - 140, 0, hz + 10);
  hzg.addColorStop(0, alpha(R2.stage.sky[3], 0)); hzg.addColorStop(1, alpha(R2.stage.sky[3], 0.35));
  c.fillStyle = hzg; c.fillRect(0, hz - 140, W, 150);
}

const GROUND_ROCKS = (() => { const R = rseed(5), a = []; for (let i = 0; i < 70; i++) a.push({ x: R() * 3400 - 500, y: 20 + R() * 500, w: 10 + R() * 50, h: 5 + R() * 18 }); return a; })();
function drawGround(c, ground, worldW, t) {
  const st = R2.stage;
  const g = c.createLinearGradient(0, ground, 0, ground + 700);
  g.addColorStop(0, st.ground[0]); g.addColorStop(1, st.ground[1]);
  c.fillStyle = g; c.fillRect(-1500, ground, worldW + 3000, 1600);
  if (st.id === 'neon') {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 18; i++) { const x = i * 160 - 200; const col = ['#ff4fd8', '#4fe0ff', '#ffd23a'][i % 3]; const rg = c.createLinearGradient(0, ground, 0, ground + 300); rg.addColorStop(0, alpha(col, 0.25)); rg.addColorStop(1, alpha(col, 0)); c.fillStyle = rg; c.fillRect(x, ground, 14, 300); }
    c.restore();
    c.strokeStyle = 'rgba(255,255,255,.08)'; c.lineWidth = 2; for (let i = 0; i < 6; i++) { c.beginPath(); c.moveTo(-1500, ground + 40 + i * 60); c.lineTo(worldW + 1500, ground + 40 + i * 60); c.stroke(); }
  } else if (st.id === 'magma') {
    c.save(); c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const x = i * 300 - 100, pulse = 0.6 + 0.4 * Math.sin(t * 2 + i);
      c.strokeStyle = `rgba(255,${100 + i * 8},30,${0.6 * pulse})`; c.lineWidth = 6; c.beginPath(); c.moveTo(x, ground + 10); c.lineTo(x + 80, ground + 90); c.lineTo(x + 40, ground + 200); c.lineTo(x + 140, ground + 400); c.stroke();
    }
    c.restore();
  } else if (st.id === 'temple') {
    c.fillStyle = 'rgba(255,255,255,.7)';
    for (let i = 0; i < 30; i++) { c.beginPath(); c.ellipse(i * 120 - 400 + Math.sin(t * 0.3 + i) * 30, ground + 10 + (i % 4) * 30, 120, 26, 0, 0, Math.PI * 2); c.fill(); }
  } else {
    c.fillStyle = 'rgba(30,20,10,.25)';
    for (const r of GROUND_ROCKS) { c.beginPath(); c.ellipse(r.x, ground + r.y, r.w, r.h, 0, 0, Math.PI * 2); c.fill(); }
  }
}

function drawWeather(c, dt, t) {
  const st = R2.stage, W = R2.W, H = R2.H;
  c.save();
  for (const p of R2.weather) {
    if (st.weather === 'rain') { p.y += 900 * p.z * dt; p.x -= 150 * p.z * dt; c.strokeStyle = `rgba(180,200,255,${0.25 * p.z})`; c.lineWidth = 1; c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - 6, p.y + 22 * p.z); c.stroke(); }
    else if (st.weather === 'snow') { p.y += 50 * p.z * dt; p.x += Math.sin(t + p.s * 10) * 20 * dt; c.fillStyle = `rgba(255,255,255,${0.6 * p.z})`; c.beginPath(); c.arc(p.x, p.y, 1 + 2 * p.z, 0, Math.PI * 2); c.fill(); }
    else if (st.weather === 'embers') { c.globalCompositeOperation = 'lighter'; p.y -= 60 * p.z * dt; p.x += Math.sin(t * 2 + p.s * 10) * 30 * dt; c.fillStyle = `rgba(255,${120 + p.s * 80},40,${0.7 * p.z})`; c.beginPath(); c.arc(p.x, p.y, 1 + 2 * p.z, 0, Math.PI * 2); c.fill(); }
    else if (st.weather === 'clouds') { p.x -= 40 * p.z * dt; const cg = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, 160 * p.z); cg.addColorStop(0, 'rgba(255,255,255,.18)'); cg.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = cg; c.fillRect(p.x - 160, p.y - 160, 320, 320); }
    else { p.x += 30 * p.z * dt; p.y += Math.sin(t + p.s * 10) * 8 * dt; c.fillStyle = `rgba(230,210,170,${0.35 * p.z})`; c.fillRect(p.x, p.y, 2, 2); }
    if (p.y > H + 30) { p.y = -30; p.x = Math.random() * W; } if (p.y < -30) { p.y = H + 30; p.x = Math.random() * W; }
    if (p.x < -200) p.x = W + 150; if (p.x > W + 200) p.x = -150;
  }
  c.restore();
}

/* ---------------- icons ---------------- */
const MAN = {
  punch:  [[34, 46], [42, 34], [64, 42], [54, 36]],
  cross:  [[34, 46], [60, 24], [66, 46], [40, 24]],
  charge: [[26, 50], [34, 64], [74, 50], [66, 64]],
  palms:  [[34, 48], [48, 40], [66, 48], [52, 40]],
  overhead: [[34, 16], [42, 3], [66, 16], [58, 3]],
  oneup:  [[34, 46], [42, 34], [66, 16], [64, 2]],
  tpose:  [[22, 31], [7, 31], [78, 31], [93, 31]],
  xburst: [[34, 46], [60, 24], [66, 46], [40, 24]],
  flurry: [[34, 46], [42, 34], [64, 42], [54, 36]],
  jab:    [[36, 42], [46, 36], [66, 46], [58, 30]],
  hook:   [[34, 46], [42, 32], [76, 28], [88, 40]],
  upper:  [[34, 46], [42, 32], [68, 52], [60, 24]],
  chop:   [[34, 46], [42, 32], [70, 18], [80, 46]],
  knee:   [[34, 46], [42, 32], [66, 46], [58, 32]],
  twin:   [[38, 42], [47, 37], [62, 42], [53, 37]],
  duck:   [[34, 56], [42, 44], [64, 56], [56, 44]],
  lunge:  [[34, 46], [42, 34], [64, 46], [56, 34]],
  hop:    [[34, 46], [42, 34], [64, 46], [56, 34]],
  slip:   [[34, 46], [42, 34], [64, 46], [56, 34]],
};
function iconArrow(c, x1, y1, x2, y2) {
  c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
  const a = Math.atan2(y2 - y1, x2 - x1);
  c.beginPath(); c.moveTo(x2, y2); c.lineTo(x2 - 6 * Math.cos(a - 0.5), y2 - 6 * Math.sin(a - 0.5)); c.moveTo(x2, y2); c.lineTo(x2 - 6 * Math.cos(a + 0.5), y2 - 6 * Math.sin(a + 0.5)); c.stroke();
}
function drawMan(cnv, key, accent = '#ffd23a') {
  const c = cnv.getContext('2d'), s = cnv.width / 100;
  c.setTransform(s, 0, 0, s, 0, 0); c.clearRect(0, 0, 100, 100);
  const m = MAN[key] || MAN.punch;
  const dy = key === 'duck' ? 14 : key === 'hop' ? -6 : 0, dx = key === 'slip' ? -10 : 0;
  c.save(); c.translate(dx, dy);
  c.strokeStyle = '#cfe3e0'; c.fillStyle = '#cfe3e0'; c.lineWidth = 5; c.lineCap = 'round'; c.lineJoin = 'round';
  const sc = key === 'lunge' ? 1.18 : 1;
  c.translate(50, 50); c.scale(sc, sc); c.translate(-50, -50);
  c.beginPath(); c.arc(50, 16, 7.5, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.moveTo(50, 24); c.lineTo(50, 60); c.moveTo(38, 30); c.lineTo(62, 30); c.moveTo(43, 60); c.lineTo(57, 60);
  if (key === 'duck') { c.moveTo(43, 60); c.lineTo(32, 70); c.lineTo(40, 82); c.moveTo(57, 60); c.lineTo(68, 70); c.lineTo(60, 82); }
  else if (key === 'knee') { c.moveTo(43, 60); c.lineTo(41, 94); c.moveTo(57, 60); c.lineTo(70, 62); c.lineTo(62, 84); }
  else { c.moveTo(43, 60); c.lineTo(41, 94); c.moveTo(57, 60); c.lineTo(59, 94); }
  c.stroke();
  c.strokeStyle = accent; c.fillStyle = accent;
  c.beginPath(); c.moveTo(38, 30); c.lineTo(...m[0]); c.lineTo(...m[1]); c.moveTo(62, 30); c.lineTo(...m[2]); c.lineTo(...m[3]); c.stroke();
  const big = key === 'punch' || key === 'flurry' || key === 'cross';
  const bigL = key === 'jab';
  c.beginPath(); c.arc(...m[1], bigL ? 8 : 4.5, 0, Math.PI * 2); c.fill();
  c.beginPath(); c.arc(...m[3], big ? 8 : 4.5, 0, Math.PI * 2); c.fill();
  c.restore();
  c.lineWidth = 2.5; c.strokeStyle = accent; c.fillStyle = accent;
  const burst = (bx, by) => { for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; c.beginPath(); c.moveTo(bx + Math.cos(a) * 12, by + Math.sin(a) * 12); c.lineTo(bx + Math.cos(a) * 17, by + Math.sin(a) * 17); c.stroke(); } };
  if (big) burst(...m[3]);
  if (bigL) burst(...m[1]);
  if (key === 'hook') { c.beginPath(); c.arc(70, 40, 22, -2.6, -0.6); c.stroke(); iconArrow(c, 84, 22, 90, 30); }
  if (key === 'upper') iconArrow(c, 76, 56, 76, 16);
  if (key === 'chop') iconArrow(c, 90, 12, 90, 52);
  if (key === 'knee') iconArrow(c, 82, 92, 82, 62);
  if (key === 'twin') { c.beginPath(); c.arc(50, 37, 12, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(50, 37, 19, 0, Math.PI * 2); c.stroke(); }
  if (key === 'flurry') { c.font = '700 18px sans-serif'; c.fillText('×4', 72, 20); }
  if (key === 'palms') { c.beginPath(); c.arc(50, 40, 11, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(50, 40, 17, 0, Math.PI * 2); c.stroke(); }
  if (key === 'overhead' || key === 'oneup') iconArrow(c, 86, 8, 86, 44);
  if (key === 'tpose') { iconArrow(c, 6, 46, 22, 46); iconArrow(c, 94, 46, 78, 46); }
  if (key === 'xburst') { iconArrow(c, 36, 16, 14, 8); iconArrow(c, 64, 16, 86, 8); }
  if (key === 'charge') for (const x of [30, 36, 64, 70]) { c.beginPath(); c.moveTo(x, 78); c.lineTo(x, 70); c.stroke(); }
  if (key === 'cross') { c.beginPath(); c.arc(50, 26, 15, Math.PI * 1.1, Math.PI * 1.9); c.stroke(); }
  if (key === 'duck') iconArrow(c, 86, 10, 86, 46);
  if (key === 'hop') iconArrow(c, 86, 46, 86, 8);
  if (key === 'slip') { iconArrow(c, 80, 30, 96, 30); iconArrow(c, 20, 30, 4, 30); }
  if (key === 'lunge') { c.beginPath(); c.arc(50, 50, 40, 0, Math.PI * 2); c.stroke(); c.beginPath(); c.arc(50, 50, 46, 0, Math.PI * 2); c.stroke(); }
}
// hand sign icon: palm facing camera, fingers up
function drawSign(cnv, sign, accent = '#ffd23a') {
  const c = cnv.getContext('2d'), s = cnv.width / 100;
  c.setTransform(s, 0, 0, s, 0, 0); c.clearRect(0, 0, 100, 100);
  const up = { V: [1, 1, 0, 0], horns: [1, 0, 0, 1], palm: [1, 1, 1, 1], gun: [1, 0, 0, 0] }[sign] || [0, 0, 0, 0];
  const thumbOut = sign === 'gun' || sign === 'palm';
  c.fillStyle = '#cfe3e0'; c.strokeStyle = '#0a161d'; c.lineWidth = 2;
  c.beginPath(); c.roundRect ? c.roundRect(30, 48, 42, 40, 10) : c.rect(30, 48, 42, 40); c.fill(); c.stroke();
  [[34, 0], [44, 1], [54, 2], [64, 3]].forEach(([x, i]) => {
    c.fillStyle = up[i] ? accent : '#cfe3e0';
    const h = up[i] ? 38 : 10, y = 48 - h;
    c.beginPath(); c.roundRect ? c.roundRect(x - 4, y, 9, h + 6, 4.5) : c.rect(x - 4, y, 9, h + 6); c.fill(); c.stroke();
  });
  c.fillStyle = thumbOut ? accent : '#cfe3e0';
  c.save(); c.translate(30, 66); c.rotate(thumbOut ? -0.9 : -0.2);
  c.beginPath(); c.roundRect ? c.roundRect(-22, -5, 24, 10, 5) : c.rect(-22, -5, 24, 10); c.fill(); c.stroke(); c.restore();
}

function portrait(cnv, ch, mode = 'full', form = 0) {
  const c = cnv.getContext('2d'), w = cnv.width, h = cnv.height;
  c.setTransform(1, 0, 0, 1, 0, 0);
  const g = c.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, ch.c.bg); g.addColorStop(1, '#070d12');
  c.fillStyle = g; c.fillRect(0, 0, w, h);
  const f = { ch, x: 0, y: 0, face: 1, pj: clonePose(mode === 'full' ? 'charge' : 'idle'), state: 'idle', charging: mode === 'full', tilt: 0, flash: 0, form };
  c.save();
  if (mode === 'full') { const sc = h / 290; c.translate(w / 2, h * 0.7); c.scale(sc, sc); }
  else { const sc = w / 52; c.translate(w / 2 - 8 * sc, h / 2 + 92 * sc); c.scale(sc, sc); }
  drawFighter(c, f, 0.6, { still: true });
  c.restore();
}
