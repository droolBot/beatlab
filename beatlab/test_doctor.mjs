// node beatlab/test_doctor.mjs: every mix doctor rule, on mixes built from tones with one known problem each
import assert from 'node:assert/strict';
import { diagnose, spectrum, correlation, BANDS, REF } from './doctor.js';

const sr = 48000, n = sr * 4;
const tone = (f, amp, ph = 0) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin(2 * Math.PI * f * i / sr + ph));
const sum = (...xs) => Float32Array.from({ length: n }, (_, i) => xs.reduce((s, x) => s + x[i], 0));
const scale = (x, k) => Float32Array.from(x, v => v * k);
const shaped = (levels, ph = 0) => sum(...BANDS.map((f, b) => tone(f, 0.05 * 10 ** (levels[b] / 20), ph + b)));  // one tone per octave, at these levels
const hits = (f, amp) => Float32Array.from({ length: n }, (_, i) => { const t = i / sr, x = t % 0.5; return x < 0.2 ? amp * Math.sin(2 * Math.PI * f * t) * (1 - x / 0.2) : 0; });

// the spectrum puts a tone in its octave, and stereo correlation behaves
assert.equal(spectrum(tone(300, 0.5), sr).db.indexOf(Math.max(...spectrum(tone(300, 0.5), sr).db)), 3, '300 Hz is in the 250 Hz octave');
assert.ok(correlation(tone(100, 1), tone(100, 1)) > 0.99 && correlation(tone(100, 1), tone(100, -1)) < -0.99);

// A healthy beat: the reference balance, a ducked 808, parts at their levels, a little width, room for peaks
const base = (o = {}) => {
  const l = o.l ?? shaped(o.levels ?? REF);
  return {
    sr, dusty: false, master: { glue: 0.5, width: 1 },
    mix: { l, r: o.r ?? sum(scale(l, 0.85), scale(shaped(o.levels ?? REF, 1.3), 0.4)), lufs: o.lufs ?? -10, peak: o.peak ?? -1 },
    parts: [
      { id: 'kick', name: 'Kick', kind: 'drum', x: hits(50, 0.6), lufs: -12, target: -10 },
      { id: 'bass', name: '808', kind: 'bass', x: tone(50, 0.4), lufs: -13, target: -11, duck: o.duck ?? 0.6 },
      { id: 'chords', name: 'Chords', kind: 'chords', x: o.chords ?? sum(tone(700, 0.2), tone(1400, 0.1)), lufs: -18, target: -16 },
      { id: 'melody', name: 'Melody', kind: 'melody', x: tone(1000, 0.2), lufs: o.melody ?? -16, target: -14 },
      { id: 'hat', name: 'Hats', kind: 'drum', x: sum(tone(8000, 0.05), tone(4000, 0.05)), lufs: -22, target: -20 },
    ],
  };
};
const ids = r => r.issues.map(i => i.id);
const healthy = diagnose(base());
assert.deepEqual(ids(healthy), [], `a healthy mix: ${JSON.stringify(healthy.issues.map(i => i.title))}`);
assert.equal(healthy.score, 100);

const mud = diagnose(base({ levels: REF.map((v, b) => (b === 3 || b === 4 ? v + 8 : v)), chords: sum(tone(320, 0.5), tone(700, 0.2)) })).issues.find(i => i.id === 'mud');
assert.ok(mud && mud.fix.kind === 'eq' && mud.fix.track === 'chords' && mud.fix.set.g1 < 0, `mud: ${JSON.stringify(mud)}`);
const clash = diagnose(base({ duck: 0 })).issues.find(i => i.id === 'clash');
assert.deepEqual(clash?.fix, { kind: 'duck', track: 'bass', value: 0.6 });
const boomy = diagnose(base({ chords: sum(tone(60, 0.4), tone(700, 0.2)) })).issues.find(i => i.id === 'lowend');
assert.deepEqual(boomy?.fix, { kind: 'lowcut', tracks: ['chords'], f: 150 });
const l = shaped(REF);
assert.ok(ids(diagnose(base({ l, r: scale(l, -1) }))).includes('phase'), 'left against right cancels');
assert.ok(ids(diagnose(base({ l, r: l }))).includes('narrow'), 'identical sides sound small');
const squashed = diagnose(base({ lufs: -6, peak: -1 })).issues.find(i => i.id === 'squashed');
assert.ok(squashed && squashed.fix.set.glue < 0.5);
const loud = diagnose(base({ melody: -10 })).issues.find(i => i.id === 'balance');
assert.ok(loud && /melody is 6 dB too loud/i.test(loud.detail) && loud.fix.kind === 'automix', loud?.detail);
const dull = diagnose(base({ levels: REF.map((v, b) => (b >= 8 ? v - 10 : v)) })).issues.find(i => i.id === 'dull');
assert.deepEqual(dull?.fix, { kind: 'tone', tracks: ['hat'], dir: 'brighter' });
assert.ok(!ids(diagnose({ ...base({ levels: REF.map((v, b) => (b >= 8 ? v - 10 : v)) }), dusty: true })).includes('dull'), 'lofi is meant to be dusty');
const worst = diagnose(base({ duck: 0, lufs: -6, levels: REF.map((v, b) => (b === 3 || b === 4 ? v + 8 : v)), chords: sum(tone(320, 0.5), tone(60, 0.4)) }));
assert.ok(worst.score < 60 && worst.issues[0].weight >= worst.issues.at(-1).weight, `worst first, score ${worst.score}`);
console.log(`doctor ok: healthy 100, problems found: mud, clash, low end, phase, narrow, squashed, balance, dull; a bad mix scores ${worst.score}`);
