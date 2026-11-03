'use strict';
/* =========================================================================
   SKYBREAK — audio: synthesized sound effects and a procedural music engine
   ========================================================================= */
const Snd = { ac: null, master: null, sfxBus: null, musicBus: null, nbuf: null, delay: null, chargeGain: null, muted: false, musicVol: 0.55, sfxVol: 0.8 };

function audioInit() {
  if (Snd.ac) { Snd.ac.resume?.(); return; }
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    Snd.ac = ac;
    Snd.master = ac.createGain(); Snd.master.gain.value = 0.9;
    const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    Snd.master.connect(comp); comp.connect(ac.destination);
    Snd.sfxBus = ac.createGain(); Snd.sfxBus.gain.value = Snd.sfxVol; Snd.sfxBus.connect(Snd.master);
    Snd.musicBus = ac.createGain(); Snd.musicBus.gain.value = Snd.musicVol; Snd.musicBus.connect(Snd.master);
    Snd.nbuf = ac.createBuffer(1, ac.sampleRate * 3, ac.sampleRate);
    const d = Snd.nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    // echo for the lead synth
    Snd.delay = ac.createDelay(1); Snd.delay.delayTime.value = 0.28;
    const fb = ac.createGain(); fb.gain.value = 0.32; const dl = ac.createGain(); dl.gain.value = 0.35;
    Snd.delay.connect(fb); fb.connect(Snd.delay); Snd.delay.connect(dl); dl.connect(Snd.musicBus);
    // charging rumble loop
    const src = ac.createBufferSource(); src.buffer = Snd.nbuf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    Snd.chargeGain = ac.createGain(); Snd.chargeGain.gain.value = 0;
    src.connect(f); f.connect(Snd.chargeGain); Snd.chargeGain.connect(Snd.sfxBus); src.start();
  } catch (e) { Snd.ac = null; }
}
function setMuted(m) { Snd.muted = m; if (Snd.master) Snd.master.gain.setTargetAtTime(m ? 0 : 0.9, Snd.ac.currentTime, 0.05); }
function setMusicVol(v) { Snd.musicVol = v; if (Snd.musicBus) Snd.musicBus.gain.setTargetAtTime(v, Snd.ac.currentTime, 0.05); }

function env(g, t, a, peak, dur) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); }
function tone(f0, dur, type, gain, f1 = f0, attack = 0.004, bus = Snd.sfxBus, t = null) {
  if (!Snd.ac) return;
  const ac = Snd.ac; t = t ?? ac.currentTime;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  env(g, t, attack, gain, dur); o.connect(g); g.connect(bus); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, gain, ftype, f0, f1, Q = 1, attack = 0.003, bus = Snd.sfxBus, t = null) {
  if (!Snd.ac) return;
  const ac = Snd.ac; t = t ?? ac.currentTime;
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = Snd.nbuf; f.type = ftype; f.Q.value = Q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
  env(g, t, attack, gain, dur); s.connect(f); f.connect(g); g.connect(bus); s.start(t, Math.random() * 2); s.stop(t + dur + 0.05);
}
function hum(dur, f0, gain = 0.1) {
  if (!Snd.ac) return;
  const ac = Snd.ac, t = ac.currentTime, g = ac.createGain(), f = ac.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = 1100;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.08);
  g.gain.setValueAtTime(gain, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.35);
  for (const [m, type] of [[1, 'sawtooth'], [1.505, 'square'], [0.5, 'sine']]) {
    const o = ac.createOscillator(); o.type = type; o.frequency.value = f0 * m;
    const l = ac.createOscillator(), lg = ac.createGain(); l.frequency.value = 9; lg.gain.value = f0 * 0.04 * m;
    l.connect(lg); lg.connect(o.frequency); l.start(t); l.stop(t + dur + 0.4);
    o.connect(f); o.start(t); o.stop(t + dur + 0.4);
  }
  f.connect(g); g.connect(Snd.sfxBus);
  noise(dur + 0.3, gain * 2, 'bandpass', 1800, 900, 0.8, 0.08);
}

const sfx = {
  punch(heavy) { noise(0.12, 0.8, 'lowpass', 2400, 260); tone(heavy ? 90 : 130, heavy ? 0.25 : 0.14, 'sine', 0.8, 40); },
  swing() { noise(0.1, 0.16, 'bandpass', 900, 2400, 1.2, 0.02); },
  blast() { tone(880, 0.14, 'square', 0.05, 180); noise(0.12, 0.2, 'bandpass', 3000, 900, 2); },
  laser() { tone(1400, 0.18, 'sawtooth', 0.05, 300); },
  block() { noise(0.07, 0.4, 'bandpass', 2200, 1300, 2); tone(420, 0.06, 'triangle', 0.08, 260); },
  boom() { noise(0.7, 1, 'lowpass', 1600, 60, 0.7); tone(70, 0.6, 'sine', 0.9, 28); },
  bigBoom() { noise(1.6, 1, 'lowpass', 2200, 40, 0.6); tone(55, 1.4, 'sine', 1, 22); },
  bolt() { noise(0.25, 0.9, 'highpass', 5000, 1500, 0.7); tone(60, 0.4, 'sine', 0.6, 30); },
  whoosh() { noise(0.4, 0.4, 'bandpass', 400, 3000, 1.2, 0.05); },
  zip() { noise(0.16, 0.45, 'bandpass', 4000, 600, 3, 0.005); tone(1800, 0.12, 'sine', 0.08, 300); },
  armed() { tone(660, 0.12, 'triangle', 0.08, 990); },
  sign() { tone(880, 0.08, 'sine', 0.08, 1320); },
  special() { tone(220, 0.5, 'sawtooth', 0.06, 880, 0.05); noise(0.5, 0.25, 'bandpass', 600, 3000, 1, 0.1); },
  fire() { noise(0.6, 0.5, 'lowpass', 1200, 300, 0.5, 0.05); },
  ice() { noise(0.3, 0.5, 'highpass', 6000, 3000, 2); tone(2400, 0.3, 'sine', 0.06, 1800); },
  heal() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.5, 'sine', 0.08, f), i * 70)); },
  perfect() { tone(1046, 0.25, 'triangle', 0.12, 1568); tone(1568, 0.4, 'sine', 0.08, 2093); },
  ko() { noise(2.5, 0.5, 'bandpass', 700, 300, 0.6, 0.4); tone(110, 1.4, 'sine', 0.6, 40); },
  cutin() { noise(0.35, 0.5, 'bandpass', 300, 5000, 1.5, 0.02); tone(330, 0.5, 'sawtooth', 0.08, 660); },
  rise(dur) { if (!Snd.ac) return; noise(dur, 0.6, 'bandpass', 150, 3000, 1.2, dur * 0.9); tone(55, dur, 'sawtooth', 0.15, 220, dur * 0.8); },
  transform() { this.bigBoom(); [261, 329, 392, 523].forEach(f => tone(f, 2.2, 'sawtooth', 0.06, f, 0.02)); noise(2, 0.4, 'highpass', 3000, 8000, 0.5, 0.01); },
};

/* ---------------- procedural music ---------------- */
const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], phrygian: [0, 1, 3, 5, 7, 8, 10] };
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
const Music = { idx: -1, step: 0, next: 0, timer: null, intensity: 0.5, pat: null, onChange: null };

function mrng(seed) { let s = seed * 9301 + 49297; return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; }; }
function degNote(tr, deg, oct = 0) { const sc = SCALES[tr.scale]; const d = ((deg % 7) + 7) % 7; return tr.root + sc[d] + 12 * (Math.floor(deg / 7) + oct); }

function buildPattern(tr) {
  const R = mrng(tr.seed);
  // 2-bar melody over chord tones, rests included
  const mel = [];
  let deg = 7 + 2;
  for (let i = 0; i < 32; i++) {
    const rest = R() < (tr.style === 'dark' ? 0.6 : 0.35) || (i % 4 === 3 && R() < 0.5);
    if (rest) { mel.push(null); continue; }
    deg += Math.round((R() - 0.5) * 4); deg = Math.max(4, Math.min(14, deg));
    mel.push(deg);
  }
  const fill = []; for (let i = 0; i < 16; i++) fill.push(R() < 0.4);
  return { mel, fill };
}

function musicPlay(i) {
  if (!Snd.ac) return;
  musicStop();
  Music.idx = (i + TRACKS.length) % TRACKS.length;
  const tr = TRACKS[Music.idx];
  Music.pat = buildPattern(tr);
  Music.step = 0; Music.next = Snd.ac.currentTime + 0.08;
  Music.timer = setInterval(musicTick, 25);
  Music.onChange && Music.onChange(Music.idx);
}
function musicStop() { if (Music.timer) clearInterval(Music.timer); Music.timer = null; }
function musicNext(d = 1) { musicPlay(Music.idx + d); }
function musicTick() {
  const tr = TRACKS[Music.idx], ac = Snd.ac;
  const s16 = 60 / tr.bpm / 4;
  while (Music.next < ac.currentTime + 0.14) { scheduleStep(tr, Music.step, Music.next, s16); Music.next += s16; Music.step++; }
}

const MB = () => Snd.musicBus;
function mKick(t, v = 1) { const ac = Snd.ac, o = ac.createOscillator(), g = ac.createGain(); o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); env(g, t, 0.002, 0.9 * v, 0.34); o.connect(g); g.connect(MB()); o.start(t); o.stop(t + 0.4); }
function mSnare(t, v = 1) { noise(0.18, 0.45 * v, 'bandpass', 1900, 1500, 0.8, 0.002, MB(), t); tone(190, 0.1, 'triangle', 0.25 * v, 160, 0.002, MB(), t); }
function mHat(t, open, v = 1) { noise(open ? 0.22 : 0.04, 0.16 * v, 'highpass', 7500, 9000, 0.7, 0.001, MB(), t); }
function mTom(t, f) { tone(f, 0.3, 'sine', 0.5, f * 0.6, 0.003, MB(), t); }
function mBass(t, m, dur, type = 'sawtooth', cut = 700) {
  const ac = Snd.ac, o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
  o.type = type; o.frequency.value = mtof(m); f.type = 'lowpass'; f.Q.value = 6;
  f.frequency.setValueAtTime(cut * 2.5, t); f.frequency.exponentialRampToValueAtTime(cut * 0.5, t + dur);
  env(g, t, 0.005, 0.32, dur); o.connect(f); f.connect(g); g.connect(MB()); o.start(t); o.stop(t + dur + 0.05);
}
function mPad(t, notes, dur, v = 0.05) {
  const ac = Snd.ac, f = ac.createBiquadFilter(), g = ac.createGain();
  f.type = 'lowpass'; f.frequency.value = 1400;
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.35); g.gain.setValueAtTime(v, t + dur - 0.2); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.4);
  for (const m of notes) for (const det of [-6, 6]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(m); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.5); }
  f.connect(g); g.connect(MB());
}
function mLead(t, m, dur, type = 'square', v = 0.07) {
  const ac = Snd.ac, o = ac.createOscillator(), f = ac.createBiquadFilter(), g = ac.createGain();
  o.type = type; o.frequency.value = mtof(m); f.type = 'lowpass'; f.frequency.value = 2600;
  env(g, t, 0.01, v, dur); o.connect(f); f.connect(g); g.connect(MB()); g.connect(Snd.delay); o.start(t); o.stop(t + dur + 0.05);
}
function mBell(t, m) { tone(mtof(m), 1.2, 'sine', 0.08, mtof(m), 0.003, MB(), t); tone(mtof(m) * 2.76, 0.6, 'sine', 0.03, mtof(m) * 2.76, 0.003, MB(), t); }

function scheduleStep(tr, step, t, s16) {
  const I = Music.intensity, st = tr.style;
  const s = step % 16, bar = Math.floor(step / 16), chordDeg = tr.prog[bar % tr.prog.length];
  const chord = [degNote(tr, chordDeg), degNote(tr, chordDeg + 2), degNote(tr, chordDeg + 4)];
  const bassN = degNote(tr, chordDeg, -1);
  const fillBar = bar % 8 === 7 && s >= 12;
  // drums
  if (st === 'trance') {
    if (s % 4 === 0) mKick(t);
    if (s % 4 === 2) mHat(t, true, 0.8);
    if (s === 4 || s === 12) mSnare(t, 0.6);
    if (I > 0.6 && s % 2 === 1) mHat(t, false, 0.6);
  } else if (st === 'rock') {
    if (s === 0 || s === 8 || s === 10 || (s === 6 && Music.pat.fill[bar % 16])) mKick(t);
    if (s === 4 || s === 12) mSnare(t);
    if (s % 2 === 0) mHat(t, false, I > 0.6 ? 1 : 0.6);
    if (fillBar) mTom(t, 200 - (s - 12) * 25);
  } else if (st === 'epic') {
    if (s === 0 || (s === 10 && I > 0.5)) mKick(t);
    if (s === 8) mSnare(t, 1.1);
    if (I > 0.55 && s % 4 === 2) mHat(t, false, 0.5);
    if (fillBar || (I > 0.8 && s % 8 === 6)) mTom(t, 140 - (s % 4) * 15);
  } else if (st === 'synthwave') {
    if (s === 0 || s === 8) mKick(t);
    if (s === 4 || s === 12) mSnare(t, 0.9);
    if (s % 2 === 0) mHat(t, false, 0.5);
  } else { // dark
    if (s === 0 || (s === 11 && I > 0.6)) mKick(t, 0.8);
    if (I > 0.5 && s % 4 === 2) mHat(t, false, 0.4);
    if (s === 8 && I > 0.7) mSnare(t, 0.5);
  }
  // bass
  if (st === 'trance') { if (s % 4 === 2 || s % 4 === 3) mBass(t, bassN, s16 * 0.9, 'sawtooth', 600); }
  else if (st === 'rock') { if (s % 2 === 0) mBass(t, bassN + (s % 8 === 6 ? 7 : 0), s16 * 1.8, 'sawtooth', 500); }
  else if (st === 'synthwave') { if (s % 2 === 0) mBass(t, bassN + (s % 4 === 2 ? 12 : 0), s16 * 1.6, 'square', 650); }
  else if (st === 'epic') { if (s === 0 || s === 6 || s === 8) mBass(t, bassN, s16 * 5, 'sawtooth', 380); }
  else { if (s === 0) mBass(t, bassN, s16 * 14, 'triangle', 300); }
  // pads once per bar
  if (s === 0) mPad(t, chord, s16 * 16, st === 'dark' ? 0.04 : 0.045);
  // arpeggio
  if ((st === 'trance' || st === 'synthwave') && I > 0.35) {
    const n = chord[s % 3] + 12 + (s % 6 >= 3 ? 12 : 0);
    mLead(t, n, s16 * 0.8, 'sawtooth', 0.025);
  }
  // melody
  if (I > 0.45) {
    const m = Music.pat.mel[(step % 32)];
    if (m !== null && (st !== 'trance' || bar % 2 === 1)) {
      if (st === 'dark') mBell(t, degNote(tr, m, 1));
      else mLead(t, degNote(tr, m, 1), s16 * 1.8, st === 'epic' ? 'sawtooth' : 'square', st === 'epic' ? 0.05 : 0.06);
    }
  }
}
