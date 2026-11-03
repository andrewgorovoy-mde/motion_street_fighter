'use strict';
/* =========================================================================
   SKYBREAK — game data: fighters, moves, stages, music tracks, inputs
   ========================================================================= */

// Inputs. Gestures use the body tracker, signs use the hand tracker.
const GESTURES = {
  palms:    { short: 'Palms → thrust',    long: 'Press your palms together at your chest, hold a beat, then thrust both hands at the screen.' },
  overhead: { short: 'Hands up → slam',   long: 'Raise both hands overhead, hold half a second, then slam them down.' },
  oneup:    { short: 'Arm up → swing',    long: 'Raise one arm straight up, hold, then swing it down like a sword.' },
  tpose:    { short: 'Arms wide → clap',  long: 'Spread your arms wide in a T, hold, then clap.' },
  xburst:   { short: 'Cross → fling',     long: 'Cross your arms, hold, then fling them wide open.' },
  flurry:   { short: '4 fast punches',    long: 'Throw four punches within a second and a half.' },
};
const SIGNS = {
  V:     { name: 'Victory', emoji: '✌️', long: 'Index and middle finger up, others curled.' },
  horns: { name: 'Horns',   emoji: '🤘', long: 'Index and pinky up, middle and ring curled.' },
  palm:  { name: 'Palm',    emoji: '✋', long: 'Open hand, all fingers spread.' },
  gun:   { name: 'Finger gun', emoji: '👉', long: 'Thumb up and index out, others curled.' },
};

const FORM_NAMES = ['Base', 'Ascended', 'Apex'];
const FORM_MULT = [
  { dmg: 1,    speed: 1,    def: 1,    regen: 0 },
  { dmg: 1.2,  speed: 1.12, def: 0.9,  regen: 3 },
  { dmg: 1.45, speed: 1.25, def: 0.8,  regen: 6 },
];

// m(id, name, input, cost, form, desc)
const mv = (id, name, input, cost, form, desc) => ({ id, name, input, cost, form, desc });
const G = k => ({ type: 'gesture', key: k });
const S = k => ({ type: 'sign', key: k });
const SEAL = (a, b) => ({ type: 'seal', signs: [a, b] });

const CHARS = [
  { id: 'raiko', name: 'Raiko', title: 'The Storm Fang', element: 'Lightning', size: 1, build: 1, range: 360,
    stats: { speed: 455, power: 0.75, defense: 0.9 },
    blurb: 'Fast and long-ranged. Keeps you at a distance and punishes every mistake.',
    passive: { name: 'Static', desc: 'Every third melee hit in a combo stuns.' },
    hair: 'spiky', forms: ['Base', 'Storm Herald', 'Thunder God'],
    c: { gi: '#1f4fbf', gi2: '#14357f', trim: '#f2c230', pants: '#22325e', pants2: '#18233f', boots: '#e8e2d0', skin: '#e9b58a', skinD: '#b9845d',
      bg: '#16305e', hair: ['#2b2f45', '#ffd83a', '#f4fbff'], hairD: ['#151826', '#d39b0e', '#9fe0ff'], aura: ['#7fd0ff', '#ffe45a', '#ffffff'], aura2: ['#3a7bd5', '#7fd0ff', '#7fd0ff'], eye: ['#222', '#46c8ff', '#e8f8ff'] },
    moves: {
      s1: mv('lance', 'Thunder Lance', G('palms'), 30, 0, 'A fast lightning beam that tracks your rival.'),
      s2: mv('flashstep', 'Flash Step', S('V'), 25, 0, 'Teleport behind your rival and strike twice.'),
      ult: mv('storm', 'Storm Crown', G('overhead'), 60, 1, 'Six lightning bolts strike wherever your rival flies.'),
      sup: mv('raijin', 'Raijin Dragon', SEAL('palm', 'horns'), 90, 2, 'A dragon of living lightning sweeps the whole sky.'),
    } },
  { id: 'ember', name: 'Ember Vos', title: 'Cinder Queen', element: 'Fire', size: 0.97, build: 0.92, range: 300,
    stats: { speed: 490, power: 0.8, defense: 0.85 },
    blurb: 'Relentless pressure. Every fire hit keeps burning after it lands.',
    passive: { name: 'Kindle', desc: 'Fire hits burn for extra damage over two seconds.' },
    hair: 'flame', forms: ['Base', 'Blaze Form', 'Phoenix Queen'],
    c: { gi: '#c2361f', gi2: '#83210f', trim: '#1b1b1b', pants: '#2a1a1a', pants2: '#1a0f0f', boots: '#d6a24a', skin: '#c98d62', skinD: '#956240',
      bg: '#5a1d12', hair: ['#8a2410', '#ff6a2a', '#ffe08a'], hairD: ['#4a1006', '#b8300c', '#ff8a2a'], aura: ['#ff7a2a', '#ff9a2a', '#fff2b0'], aura2: ['#b8300c', '#ffd04a', '#ff6a2a'], eye: ['#2a1206', '#ffb02a', '#fff2b0'] },
    moves: {
      s1: mv('volley', 'Cinder Volley', G('flurry'), 25, 0, 'Seven homing fireballs fan out at your rival.'),
      s2: mv('flamewall', 'Flame Wall', S('palm'), 25, 0, 'A wall of fire that burns through incoming blasts.'),
      ult: mv('phoenix', 'Phoenix Dive', G('tpose'), 60, 1, 'Become a firebird and crash straight through your rival.'),
      sup: mv('solarcore', 'Solar Core', SEAL('gun', 'V'), 90, 2, 'Forge a tiny sun and detonate it on your rival.'),
    } },
  { id: 'mira', name: 'Mira Solen', title: 'Moonlit Blade', element: 'Frost', size: 0.97, build: 0.9, range: 380,
    stats: { speed: 470, power: 0.8, defense: 0.9 },
    blurb: 'Patient control. Slows, reflects and freezes until her rival can’t move.',
    passive: { name: 'Chill', desc: 'Special moves that hit slow your rival.' },
    hair: 'long', forms: ['Base', 'Lunar Form', 'Eclipse Empress'],
    c: { gi: '#5b3fa8', gi2: '#3c2875', trim: '#9fe6ff', pants: '#e8e6f2', pants2: '#b8b4cc', boots: '#3c2875', skin: '#f0cfb4', skinD: '#c39c80',
      bg: '#2b2260', hair: ['#9aa6d6', '#dfe6ff', '#ffffff'], hairD: ['#5d6796', '#9aa6d6', '#9fe6ff'], aura: ['#9fe6ff', '#c7a8ff', '#e8fbff'], aura2: ['#5b3fa8', '#9fe6ff', '#c7a8ff'], eye: ['#3c2875', '#9fe6ff', '#ffffff'] },
    moves: {
      s1: mv('disc', 'Crescent Disc', G('oneup'), 25, 0, 'A spinning blade of moonlight that hunts your rival.'),
      s2: mv('mirror', 'Ice Mirror', S('horns'), 25, 0, 'A mirror that reflects blasts and beams back for 2 seconds.'),
      ult: mv('prism', 'Moonbeam Prism', G('palms'), 60, 1, 'A huge freezing beam. Frozen rivals barely move.'),
      sup: mv('zero', 'Absolute Zero', SEAL('V', 'palm'), 90, 2, 'Freeze your rival solid, then shatter the ice.'),
    } },
  { id: 'gorran', name: 'Gorran', title: 'Mountain Breaker', element: 'Earth', size: 1.18, build: 1.3, range: 200,
    stats: { speed: 380, power: 1, defense: 0.75 },
    blurb: 'Slow and enormous. Light hits bounce off him. Get close and everything hurts.',
    passive: { name: 'Bedrock', desc: 'Light punches and blasts don’t flinch him.' },
    hair: 'bald', forms: ['Base', 'Iron Titan', 'World Breaker'],
    c: { gi: '#3f6b2a', gi2: '#2a481b', trim: '#c23a2a', pants: '#5a4630', pants2: '#3e3020', boots: '#2a2018', skin: '#a8714a', skinD: '#7a4e30',
      bg: '#2e3a18', hair: ['#c23a2a', '#ff8a2a', '#ffe45a'], hairD: ['#8a2418', '#c23a2a', '#ff8a2a'], aura: ['#a8ff6a', '#e6c070', '#ffb02a'], aura2: ['#5a8a2a', '#a8ff6a', '#ff6a2a'], eye: ['#1a1206', '#e6c070', '#ffb02a'] },
    moves: {
      s1: mv('quake', 'Quake Nova', G('xburst'), 30, 0, 'A shockwave that smashes blasts and launches your rival.'),
      s2: mv('boulders', 'Boulder Barrage', S('gun'), 25, 0, 'Tear up three boulders and hurl them.'),
      ult: mv('hammer', 'Titan Hammer', G('overhead'), 60, 1, 'A stone fist the size of a house drops on your rival.'),
      sup: mv('mountain', 'Mountain Fall', SEAL('palm', 'horns'), 90, 2, 'Rip a mountain out of the ground and bring it down.'),
    } },
  { id: 'kaze', name: 'Kaze', title: 'The Quiet Gale', element: 'Wind', size: 0.95, build: 0.88, range: 320,
    stats: { speed: 540, power: 0.7, defense: 0.95 },
    blurb: 'A wind ninja. Teleports for free and fights with clones and cyclones.',
    passive: { name: 'Windwalker', desc: 'Vanish, Rush and Blink cost no ki.' },
    hair: 'topknot', forms: ['Base', 'Gale Form', 'Tempest Sage'],
    c: { gi: '#1e6b66', gi2: '#124541', trim: '#e6f2ee', pants: '#1a2a2a', pants2: '#101a1a', boots: '#e6f2ee', skin: '#e2b896', skinD: '#b0866a',
      bg: '#123e3b', hair: ['#1f2a2a', '#8affd6', '#e6fffa'], hairD: ['#0d1414', '#3fb894', '#8affd6'], aura: ['#8affd6', '#c2fff0', '#ffffff'], aura2: ['#1e6b66', '#3fb894', '#8affd6'], eye: ['#1a1a1a', '#8affd6', '#ffffff'] },
    moves: {
      s1: mv('clones', 'Shadow Clones', S('V'), 25, 0, 'Two wind clones appear and fire on your rival.'),
      s2: mv('cyclone', 'Cyclone Trap', G('oneup'), 25, 0, 'A cyclone that traps your rival and spins them.'),
      ult: mv('thousand', 'Thousand Cuts', G('xburst'), 60, 1, 'A blur of slashes from every direction at once.'),
      sup: mv('tempest', 'Eye of the Tempest', SEAL('horns', 'gun'), 90, 2, 'A hurricane fills the sky and shreds your rival.'),
    } },
  { id: 'vex', name: 'Vex', title: 'Hollow Shade', element: 'Shadow', size: 1, build: 0.95, range: 340,
    stats: { speed: 470, power: 0.85, defense: 0.9 },
    blurb: 'Feeds on your rival’s energy. Slips through attacks and drags them into the dark.',
    passive: { name: 'Siphon', desc: 'Your hits steal ki from your rival.' },
    hair: 'hood', forms: ['Base', 'Umbral Form', 'Void Sovereign'],
    c: { gi: '#1a1024', gi2: '#100818', trim: '#9b4dff', pants: '#140c1c', pants2: '#0c0612', boots: '#2a1a3a', skin: '#c9b2a6', skinD: '#8f7a70',
      bg: '#1b0f2c', hair: ['#1a1024', '#2a1240', '#3a0a4a'], hairD: ['#0a0610', '#140820', '#1a0420'], aura: ['#9b4dff', '#c24dff', '#ff3df0'], aura2: ['#3a1a6a', '#6a2aa8', '#9b4dff'], eye: ['#b07aff', '#d29bff', '#ff8af6'] },
    moves: {
      s1: mv('voidorb', 'Void Orb', G('palms'), 30, 0, 'A slow orb that drags your rival in and drains them.'),
      s2: mv('phase', 'Phase Shift', S('horns'), 20, 0, 'Turn to shadow for 1.5 seconds. Nothing can touch you.'),
      ult: mv('eclipse', 'Eclipse Grasp', G('overhead'), 60, 1, 'Shadow hands rise from the ground and crush your rival.'),
      sup: mv('horizon', 'Event Horizon', SEAL('gun', 'V'), 90, 2, 'Open a black hole that swallows everything nearby.'),
    } },
  { id: 'sol', name: 'Sol Ardent', title: 'Dawn Paladin', element: 'Light', size: 1.04, build: 1.05, range: 300,
    stats: { speed: 430, power: 0.85, defense: 0.8 },
    blurb: 'A holy knight who heals, shields and calls down light from the sky.',
    passive: { name: 'Grace', desc: 'Slowly heals while guarding.' },
    hair: 'mane', forms: ['Base', 'Radiant Form', 'Sunlord'],
    c: { gi: '#f2efe6', gi2: '#c9c3b2', trim: '#e8b23a', pants: '#e2dccb', pants2: '#b3ac98', boots: '#e8b23a', skin: '#d9a57c', skinD: '#a8795a',
      bg: '#5a4a1a', hair: ['#c9a04a', '#ffe08a', '#fffbe6'], hairD: ['#8a6a24', '#e8b23a', '#ffe08a'], aura: ['#ffe08a', '#fff3c0', '#ffffff'], aura2: ['#e8b23a', '#ffe08a', '#ffd04a'], eye: ['#3a2a10', '#ffe08a', '#ffffff'] },
    moves: {
      s1: mv('spear', 'Radiant Spear', G('oneup'), 25, 0, 'Hurl a spear of light that pierces guards.'),
      s2: mv('sanctuary', 'Sanctuary', S('palm'), 30, 0, 'A dome of light that blocks attacks and heals you.'),
      ult: mv('judgment', 'Judgment Rays', G('tpose'), 60, 1, 'Pillars of light rain down across the arena.'),
      sup: mv('dawn', 'Dawnbreaker', SEAL('V', 'horns'), 90, 2, 'The sky splits open and a column of sunlight crushes your rival.'),
    } },
  { id: 'torque', name: 'Torque', title: 'Siege Engine', element: 'Tech', size: 1.08, build: 1.15, range: 420,
    stats: { speed: 420, power: 0.85, defense: 0.8 },
    blurb: 'A walking arsenal. Missiles, mines, rail cannons and an orbital laser.',
    passive: { name: 'Twin Cannons', desc: 'Ki blasts fire in pairs.' },
    hair: 'helmet', forms: ['Base', 'Overclock', 'Omega Protocol'],
    c: { gi: '#6b7480', gi2: '#454c56', trim: '#ff8a1a', pants: '#3a4048', pants2: '#262a30', boots: '#2a2e34', skin: '#b5bcc6', skinD: '#7d858f',
      bg: '#2a2e34', hair: ['#6b7480', '#ff8a1a', '#ff3a2a'], hairD: ['#454c56', '#b85a0a', '#a81a10'], aura: ['#ffb02a', '#ff8a1a', '#ff3a2a'], aura2: ['#6b7480', '#ffb02a', '#ff8a1a'], eye: ['#ff8a1a', '#ffd04a', '#ff3a2a'] },
    moves: {
      s1: mv('missiles', 'Missile Swarm', G('flurry'), 25, 0, 'Eight homing missiles launch from your back.'),
      s2: mv('mine', 'Grav Mine', S('gun'), 20, 0, 'Plant a mine that pulls your rival in and explodes.'),
      ult: mv('railcannon', 'Rail Cannon', G('palms'), 60, 1, 'An enormous piercing beam. It ignores half of a guard.'),
      sup: mv('orbital', 'Orbital Strike', SEAL('V', 'palm'), 90, 2, 'A satellite fires a sky-wide laser that tracks your rival.'),
    } },
];

const STAGES = [
  { id: 'canyon', name: 'Canyon Wastes', track: 1, sky: ['#081a28', '#1b4652', '#6f9c86', '#d6d49c'], far: '#2b5560', mid: '#1c3b40', ground: ['#9b7a4a', '#3d2c1c'], light: '#ffe0a8', weather: 'dust', body: 'ringed' },
  { id: 'temple', name: 'Sky Temple', track: 2, sky: ['#0d2a5a', '#3a78c0', '#9cc8f0', '#fdf2dc'], far: '#c8daf0', mid: '#8aa6c8', ground: ['#f2f6fb', '#9fb6d2'], light: '#fff6dc', weather: 'clouds', body: 'sun' },
  { id: 'neon', name: 'Neon Megacity', track: 3, sky: ['#05040f', '#160a2e', '#3a0f4a', '#7a1f5a'], far: '#1a1238', mid: '#0f0a22', ground: ['#1a1428', '#08060f'], light: '#ff4fd8', weather: 'rain', body: 'moon' },
  { id: 'magma', name: 'Magma Rift', track: 4, sky: ['#120404', '#3a0c06', '#8a2a0a', '#ff7a2a'], far: '#2a0c08', mid: '#1a0806', ground: ['#3a1a10', '#120604'], light: '#ff8a3a', weather: 'embers', body: 'none' },
  { id: 'moon', name: 'Frozen Moon', track: 5, sky: ['#000008', '#060c24', '#123060', '#4a8ab8'], far: '#2a4a6a', mid: '#18304a', ground: ['#d8ecf8', '#7aa0c0'], light: '#bfe6ff', weather: 'snow', body: 'planet' },
];

// Procedural music: each track is generated live from these settings
const TRACKS = [
  { name: 'Skybreak Main Theme', bpm: 132, root: 45, scale: 'minor', prog: [0, 5, 3, 4], style: 'epic', seed: 3 },
  { name: 'Dust Devil', bpm: 150, root: 40, scale: 'dorian', prog: [0, 0, 6, 4], style: 'rock', seed: 11 },
  { name: 'Above the Clouds', bpm: 128, root: 48, scale: 'major', prog: [0, 4, 5, 3], style: 'trance', seed: 21 },
  { name: 'Neon Pulse', bpm: 118, root: 41, scale: 'minor', prog: [0, 5, 6, 4], style: 'synthwave', seed: 7 },
  { name: 'Molten Core', bpm: 160, root: 38, scale: 'phrygian', prog: [0, 1, 0, 6], style: 'rock', seed: 31 },
  { name: 'Lunar Silence', bpm: 96, root: 43, scale: 'minor', prog: [0, 3, 5, 4], style: 'dark', seed: 17 },
];
