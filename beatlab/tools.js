// BeatLab editing tools: pure functions on notes, steps and automation. No DOM, no audio, so they're
// easy to test (node beatlab/test_tools.mjs). Notes are {t, d, p, v} in ticks; extra fields ride along.
import { STEP } from './music.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Pull note starts toward a grid. strength 1 snaps fully, 0.5 moves halfway; ends keep their length.
export function quantize(notes, grid = STEP, strength = 1) {
  return notes.map(n => ({ ...n, t: Math.max(0, Math.round(n.t + (Math.round(n.t / grid) * grid - n.t) * strength)) }));
}

// Loosen timing and velocity a little, like a player would. rng returns 0..1.
export function humanize(notes, rng, { time = 6, vel = 12 } = {}) {
  return notes.map(n => ({ ...n, t: Math.max(0, Math.round(n.t + (rng() * 2 - 1) * time)), v: clamp(Math.round(n.v + (rng() * 2 - 1) * vel), 1, 127) }));
}

// k hits spread as evenly as possible over n steps, starting on the downbeat, then rotated.
// 3 over 8 gives x..x..x., the tresillo.
export function euclid(k, n, rotate = 0) {
  const hits = Array.from({ length: n }, (_, i) => (i * k) % n < k);
  return Array.from({ length: n }, (_, i) => hits[((i - rotate) % n + n) % n]);
}

// Move every note by whole steps inside a loop, wrapping round the end
export function shiftSteps(notes, steps, loop) {
  return notes.map(n => ({ ...n, t: ((n.t + steps * STEP) % loop + loop) % loop }));
}

// Chord stamps for the piano roll: intervals above the clicked note
export const CHORDS = {
  none: { name: 'Single notes', iv: [0] },
  maj: { name: 'Major', iv: [0, 4, 7] }, min: { name: 'Minor', iv: [0, 3, 7] },
  maj7: { name: 'Major 7', iv: [0, 4, 7, 11] }, min7: { name: 'Minor 7', iv: [0, 3, 7, 10] }, dom7: { name: 'Dominant 7', iv: [0, 4, 7, 10] },
  min9: { name: 'Minor 9', iv: [0, 3, 7, 10, 14] }, maj9: { name: 'Major 9', iv: [0, 4, 7, 11, 14] },
  sus2: { name: 'Sus 2', iv: [0, 2, 7] }, sus4: { name: 'Sus 4', iv: [0, 5, 7] }, dim: { name: 'Diminished', iv: [0, 3, 6] },
  oct: { name: 'Octaves', iv: [0, 12] }, power: { name: 'Power (5th)', iv: [0, 7, 12] },
};

// Nearest pitch whose pitch class is in the scale; ties go down
export function snapToScale(p, scale) {
  for (let d = 0; d < 12; d++) {
    if (scale.includes(((p - d) % 12 + 12) % 12)) return p - d;
    if (scale.includes(((p + d) % 12 + 12) % 12)) return p + d;
  }
  return p;
}

// Notes that start in a box of time (ticks) and pitch
export const inBox = (notes, t0, t1, p0, p1) => notes.filter(n => n.t >= Math.min(t0, t1) && n.t <= Math.max(t0, t1) && n.p >= Math.min(p0, p1) && n.p <= Math.max(p0, p1));

// Trim notes that run into the next note of the same pitch, and drop empty ones (FL needs clean note-offs)
export function tidy(notes) {
  const sorted = [...notes].sort((a, b) => a.t - b.t), out = [];
  for (const n of sorted) {
    const prev = out.findLast(m => m.p === n.p);
    if (prev && prev.t + prev.d > n.t) prev.d = n.t - prev.t;
    out.push(n);
  }
  return out.filter(n => n.d > 0);
}

// Automation: points [{t, v}] sorted by t, v 0..1. Before the first point and after the last, the
// lane holds that point's value; with no points it holds `def`.
export function valueAt(points, t, def) {
  if (!points?.length) return def;
  if (t <= points[0].t) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (t <= b.t) return b.t === a.t ? b.v : a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
  }
  return points[points.length - 1].v;
}
export const AUTO = {  // what each lane controls, and how 0..1 maps onto it
  vol: { name: 'Volume', def: 0.8, toParam: v => v / 0.8, text: v => `${v <= 0 ? '-inf' : (20 * Math.log10(v / 0.8)).toFixed(1)} dB` },
  cut: { name: 'Filter', def: 1, toParam: v => 20 * 1000 ** v, text: v => { const f = 20 * 1000 ** v; return f >= 1000 ? `${(f / 1000).toFixed(1)} kHz` : `${Math.round(f)} Hz`; } },
};

// Seconds as m:ss.s for clip lengths and times
export const clock = s => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
