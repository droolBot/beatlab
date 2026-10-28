// Hum to notes: a pitch track of what was hummed or sung, cut into notes where the pitch moves, the voice
// stops or a syllable starts again, then each note snapped to the key and the beat grid.
import { yin, nearestIn } from './dsp.js';

const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };

// x: mono samples starting on the downbeat. Returns notes { t, d, p, v } in ticks.
export function humToNotes(x, sr, { bpm, mask = 4095, step = 24, ppq = 96, center = 72, maxTicks = Infinity }) {
  const dec = Math.max(1, Math.round(sr / 12000)), dsr = sr / dec, y = new Float32Array(Math.floor(x.length / dec));
  for (let i = 0; i < y.length; i++) { let s = 0; for (let k = 0; k < dec; k++) s += x[i * dec + k]; y[i] = s / dec; }
  const win = 512, hop = 96, frames = [];
  for (let at = 0; at + win <= y.length; at += hop) {
    const w = y.subarray(at, at + win);
    let e = 0;
    for (const v of w) e += v * v;
    const f = yin(w, dsr);
    frames.push({ rms: Math.sqrt(e / win), midi: f ? 69 + 12 * Math.log2(f / 440) : null });
  }
  const loud = Math.max(1e-9, ...frames.map(f => f.rms)), secsPerFrame = hop / dsr;
  // a frame counts when it's voiced, loud enough, and not the dip between two syllables
  const voiced = frames.map((f, i) => f.midi != null && f.rms > loud * 0.06 && f.rms > 0.45 * Math.max(...frames.slice(Math.max(0, i - 10), i + 1).map(g => g.rms)));
  const snapped = frames.map((f, i) => {
    if (!voiced[i]) return null;
    const near = frames.slice(Math.max(0, i - 2), i + 3).filter((g, k) => voiced[Math.max(0, i - 2) + k]).map(g => g.midi);  // a five-frame median drops octave blips
    return nearestIn(median(near), mask);
  });
  // runs of one note; a blip under 3 frames inside a run is absorbed
  const runs = [];
  for (let i = 0; i < snapped.length; i++) {
    const p = snapped[i], last = runs.at(-1);
    if (p == null) { if (last) last.open = false; continue; }
    if (last?.open && (last.p === p || (snapped.slice(i, i + 3).filter(q => q === last.p).length >= 2))) { last.to = i; last.peak = Math.max(last.peak, frames[i].rms); }
    else runs.push({ p, from: i, to: i, open: true, peak: frames[i].rms });
  }
  const ticksPerSec = ppq * bpm / 60, q = secs => Math.round(secs * ticksPerSec / step) * step, half = win / dsr / 2;  // a frame's pitch belongs to its middle
  let notes = runs.filter(r => (r.to - r.from + 1) * secsPerFrame >= 0.07)
    .map(r => ({ t: q(r.from * secsPerFrame + half), end: q((r.to + 1) * secsPerFrame + half), p: r.p, v: Math.round(70 + 50 * Math.min(1, r.peak / loud)) }));
  notes = notes.map((n, i) => ({ t: n.t, d: Math.max(step, Math.min(n.end, notes[i + 1]?.t ?? Infinity) - n.t), p: n.p, v: n.v }))
    .filter((n, i, all) => n.t < maxTicks && (i === 0 || n.t > all[i - 1].t));
  if (!notes.length) return [];
  const shift = Math.round((center - median(notes.map(n => n.p))) / 12) * 12;  // hummed an octave low? it lands where the part plays
  return notes.map(n => ({ ...n, p: n.p + shift, d: Math.min(n.d, maxTicks - n.t) }));
}
