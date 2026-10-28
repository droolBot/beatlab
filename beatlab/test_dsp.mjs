// node beatlab/test_dsp.mjs: the audio-thread effects, measured on test signals
import assert from 'node:assert/strict';
import { Warp, Pitch, Tune, Transient, yin, nearestIn, maskOf, warpSpan } from './dsp.js';

const sr = 48000, N = 128;
const sine = (f, secs, a = 0.5) => Float32Array.from({ length: Math.round(sr * secs) }, (_, i) => a * Math.sin(2 * Math.PI * f * i / sr));
function run(core, input, v) {  // feed a mono signal through in 128-sample blocks, like the audio thread
  const out = [new Float32Array(input.length), new Float32Array(input.length)];
  for (let i = 0; i + N <= input.length; i += N) {
    const block = input.subarray(i, i + N), o = [new Float32Array(N), new Float32Array(N)];
    core.process([block], o, N, v, i / sr);
    out[0].set(o[0], i); out[1].set(o[1], i);
  }
  return out[0];
}
const freqOf = (x, from, to) => {  // rising zero crossings per second over [from, to) seconds
  let n = 0, first = -1, last = -1;
  for (let i = Math.round(from * sr) + 1; i < Math.round(to * sr); i++) if (x[i - 1] < 0 && x[i] >= 0) { if (first < 0) first = i; last = i; n++; }
  return (n - 1) / ((last - first) / sr);
};
// The pitch heard: the energy-weighted centre of the spectrum between lo and hi (a Goertzel scan). A delay-line
// shifter's crossfades spread a tone into sidebands a few hertz either side, so the peak alone misleads.
const peakFreq = (x, from, to, lo, hi) => {
  const seg = x.subarray(Math.round(from * sr), Math.round(to * sr));
  let sum = 0, sumP = 0;
  for (let f = lo; f <= hi; f += 0.25) {
    const w = 2 * Math.cos(2 * Math.PI * f / sr);
    let s1 = 0, s2 = 0;
    for (const v of seg) { const s0 = v + w * s1 - s2; s2 = s1; s1 = s0; }
    const p = s1 * s1 + s2 * s2 - w * s1 * s2;
    sum += f * p; sumP += p;
  }
  return sum / sumP;
};
const near = (a, b, tol, what) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(2)}, wanted ${b.toFixed(2)}`);

// Time warp at 120 BPM: a beat is 0.5 s, a bar 2 s
const bpm = 120, warp = v => ({ bpm, t0: 0, mix: 1, when: 0, ...v });
assert.deepEqual(warpSpan(5, 0), [4, 4]);
assert.equal(warpSpan(2, 1), null);
assert.deepEqual(warpSpan(7.5, 2), [7, 1]);
assert.deepEqual(warpSpan(13, 3), [12, 4]);
const tone = sine(440, 4.5);
near(freqOf(run(new Warp(sr), tone, warp({ mode: 0 })), 2.2, 3.8), 220, 3, 'half-time halves the pitch');
near(freqOf(run(new Warp(sr), tone, warp({ mode: 0, when: 1 })), 0.2, 1.8), 440, 2, 'every 2nd bar leaves bar 1 alone');
const ramp = Float32Array.from({ length: sr * 4 }, (_, i) => i / sr);  // the signal is its own clock
const stut = run(new Warp(sr), ramp, warp({ mode: 1 }));
near(stut[Math.round(2.6 * sr)], 2.1, 0.01, 'a 1/8 stutter replays the first eighth of the bar');  // 0.6 s in: 0.35 s past a 0.25 s grain
const rev = run(new Warp(sr), ramp, warp({ mode: 4 }));
near(rev[Math.round(2.5 * sr)], 1.5, 0.01, 'reverse plays the bar before backwards');
const stop = run(new Warp(sr), tone, warp({ mode: 3 }));
assert.ok(freqOf(stop, 2.05, 2.5) > freqOf(stop, 3.0, 3.4) * 1.5, 'a tape stop slows down');

// Pitch shifter: +5 semitones from 220 Hz
near(peakFreq(run(new Pitch(sr), sine(220, 2), { semis: 5, fine: 0, mix: 1 }), 0.5, 1.9, 270, 320), 220 * 2 ** (5 / 12), 1.5, 'pitch +5');
near(peakFreq(run(new Pitch(sr), sine(440, 2), { semis: -12, fine: 0, mix: 1 }), 0.5, 1.9, 200, 240), 220, 1.5, 'pitch an octave down');

// Tune: YIN hears the note, and a sharp A3 in C major is pulled back to 220 Hz
near(yin(sine(196, 0.05, 0.5).filter((_, i) => i % 4 === 0), sr / 4), 196, 1, 'yin');
assert.equal(yin(new Float32Array(512), 12000), 0, 'silence has no pitch');
const cMajor = maskOf([0, 2, 4, 5, 7, 9, 11]);
assert.equal(nearestIn(57.4, cMajor), 57);
assert.equal(nearestIn(61, cMajor), 60, 'C# in C major goes to C or D');
near(peakFreq(run(new Tune(sr), sine(228, 3), { mask: cMajor, speed: 0, mix: 1 }), 1, 2.9, 205, 240), 220, 1.5, 'tune to A');

// Transient shaper on a drum-like hit: more attack makes the first 5 ms louder, less sustain quietens the tail
const hit = Float32Array.from({ length: sr }, (_, i) => Math.sin(2 * Math.PI * 150 * i / sr) * Math.exp(-i / (0.15 * sr)) * 0.5);
const peak = (x, a, b) => x.subarray(Math.round(a * sr), Math.round(b * sr)).reduce((m, s) => Math.max(m, Math.abs(s)), 0);
const flat = { attack: 0, sustain: 0, out: 0 }, punchy = run(new Transient(sr), hit, { ...flat, attack: 1 }), tight = run(new Transient(sr), hit, { ...flat, sustain: -1 });
assert.ok(peak(punchy, 0, 0.005) > peak(hit, 0, 0.005) * 1.4, 'attack boosts the hit');
assert.ok(peak(tight, 0.3, 0.6) < peak(hit, 0.3, 0.6) * 0.6, 'less sustain shortens the tail');
near(peak(run(new Transient(sr), hit, flat), 0, 0.5), peak(hit, 0, 0.5), 0.01, 'flat settings change nothing');

console.log('dsp ok: half-time, stutter, reverse, tape stop, pitch, tune, transients');
