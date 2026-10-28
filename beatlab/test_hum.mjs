// node beatlab/test_hum.mjs: a hummed phrase becomes notes in the key, on the grid
import assert from 'node:assert/strict';
import { humToNotes } from './hum.js';
import { maskOf } from './dsp.js';

const sr = 48000, bpm = 120, beat = 60 / bpm, rnd = (s => () => (s = (s * 16807) % 2147483647) / 2147483647)(7);
// [midi, beats]; null is a breath. Sung 30 cents sharp with a 5 Hz vibrato, like a real voice
const phrase = [[57, 1], [60, 0.5], [60, 0.5], [64, 1], [null, 0.5], [62, 0.5], [57, 1]];
const total = phrase.reduce((s, [, b]) => s + b, 0) * beat, x = new Float32Array(Math.round(total * sr));
let at = 0, ph = 0;
for (const [m, b] of phrase) {
  const n = Math.round(b * beat * sr);
  for (let i = 0; i < n; i++) {
    const env = m == null ? 0 : Math.min(1, i / (0.02 * sr), (n - i) / (0.04 * sr)), f = m == null ? 0 : 440 * 2 ** ((m + 0.3 - 69) / 12) * (1 + 0.006 * Math.sin(2 * Math.PI * 5 * i / sr));
    ph += 2 * Math.PI * f / sr;
    x[at + i] = 0.4 * env * (Math.sin(ph) + 0.35 * Math.sin(2 * ph) + 0.15 * Math.sin(3 * ph)) + 0.004 * (rnd() * 2 - 1);
  }
  at += n;
}
const aMinor = maskOf([9, 11, 0, 2, 4, 5, 7]);
const notes = humToNotes(x, sr, { bpm, mask: aMinor, center: 60 });
assert.deepEqual(notes.map(n => n.p), [57, 60, 60, 64, 62, 57], `pitches ${notes.map(n => n.p)}`);
assert.deepEqual(notes.map(n => n.t), [0, 96, 144, 192, 336, 384], `starts ${notes.map(n => n.t)}`);  // 96 ticks a beat
assert.ok(notes.every(n => n.d >= 24 && n.t % 24 === 0 && n.v >= 70 && n.v <= 120));
assert.ok(notes[3].d >= 72 && notes[3].d <= 96, `the held E lasts about a beat: ${notes[3].d}`);
assert.deepEqual(humToNotes(x, sr, { bpm, mask: aMinor, center: 72 }).map(n => n.p), [69, 72, 72, 76, 74, 69], 'an octave up for a lead');
assert.deepEqual(humToNotes(new Float32Array(sr), sr, { bpm }), [], 'silence writes nothing');
console.log(`hum ok: ${notes.length} notes from a hummed phrase, in key and on the grid`);
