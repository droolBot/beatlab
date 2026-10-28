// BeatLab's sample-by-sample effects. The maths lives here as plain classes, so the audio thread
// (dsp-worklet.js) and the tests (test_dsp.mjs) run exactly the same code. Every core takes
// process(ins, outs, n, v, time): input and output channels, the block length, the knob values and
// the block's start time in seconds.

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// A stereo ring buffer, read at a fractional delay in samples (0 is the sample just written)
class Ring {
  constructor(size) { this.size = size; this.ch = [new Float32Array(size), new Float32Array(size)]; this.w = 0; }
  write(l, r) { this.ch[0][this.w] = l; this.ch[1][this.w] = r; this.w = (this.w + 1) % this.size; }
  read(k, d) {
    let p = this.w - 1 - Math.min(d, this.size - 2);
    p -= Math.floor(p / this.size) * this.size;
    const i = Math.floor(p), f = p - i, b = this.ch[k];
    return b[i] + (b[(i + 1) % this.size] - b[i]) * f;
  }
}
const stereo = ins => [ins[0], ins[1] ?? ins[0]];

// ---------- Time warp: half-time, stutter, tape stop and reverse, locked to the bar ----------
// Everything is a delay that changes over a stretch of the song: reading the past at half speed is
// half-time, holding the read point still is a stutter, slowing it to a stop is a tape stop.
export const WARP_MODES = [['Half-time', 0], ['Stutter 1/8', 1], ['Stutter 1/16', 2], ['Tape stop', 3], ['Reverse', 4]];
export const WARP_WHEN = [['Every bar', 0], ['Every 2nd bar', 1], ['Last beat of the bar', 2], ['Last bar of 4', 3]];
export function warpSpan(beat, when) {  // the stretch the effect works on, [start, length] in beats, or null
  const bar = Math.floor(beat / 4);
  if (when === 0) return [bar * 4, 4];
  if (when === 1) return bar % 2 ? [bar * 4, 4] : null;
  if (when === 2) return beat - bar * 4 >= 3 ? [bar * 4 + 3, 1] : null;
  return bar % 4 === 3 ? [bar * 4, 4] : null;
}
export class Warp {
  constructor(sr) { this.sr = sr; this.ring = new Ring(Math.ceil(sr * 20)); }
  process(ins, outs, n, v, time) {
    const [L, R] = stereo(ins), spb = 60 / v.bpm, edge = 0.006 / spb, mode = Math.round(v.mode), when = Math.round(v.when);
    for (let i = 0; i < n; i++) {
      const l = L[i], r = R[i];
      this.ring.write(l, r);
      const beat = (time + i / this.sr - v.t0) / spb, span = beat >= 0 ? warpSpan(beat, when) : null;
      let a = 0, lvl = 1, d = 0;  // a: how much replaces the dry sound; lvl: the warped sound's own level
      if (span) {
        const [s, len] = span, x = beat - s;
        a = clamp(Math.min(x, len - x) / edge, 0, 1) * v.mix;
        if (mode === 0) d = x / 2;
        else if (mode === 1 || mode === 2) {
          const g = mode === 1 ? 0.5 : 0.25, gx = x % g;
          d = x - gx;
          lvl = clamp(Math.min(gx, g - gx) / edge, 0, 1);
        } else if (mode === 3) { d = x * x / (2 * len); lvl = clamp((len - x) / (len * 0.25), 0, 1); }
        else d = 2 * x;
      }
      const ds = d * spb * this.sr;
      outs[0][i] = a ? l * (1 - a) + this.ring.read(0, ds) * a * lvl : l;
      outs[1][i] = a ? r * (1 - a) + this.ring.read(1, ds) * a * lvl : r;
    }
  }
}

// ---------- Pitch: two crossfaded taps sweeping a short delay line ----------
export class Shifter {
  constructor(sr, win = 0.05) { this.W = Math.round(sr * win); this.ring = new Ring(this.W * 2 + 4); this.ph = 0; this.out = [0, 0]; }
  step(l, r, ratio) {
    this.ring.write(l, r);
    this.ph = (this.ph + (1 - ratio) / this.W) % 1;
    if (this.ph < 0) this.ph += 1;
    const p2 = (this.ph + 0.5) % 1, g1 = Math.sin(Math.PI * this.ph) ** 2, d1 = this.ph * this.W, d2 = p2 * this.W;
    for (let k = 0; k < 2; k++) this.out[k] = this.ring.read(k, d1) * g1 + this.ring.read(k, d2) * (1 - g1);
    return this.out;
  }
}
export class Pitch {
  constructor(sr) { this.sh = new Shifter(sr); }
  process(ins, outs, n, v) {
    const [L, R] = stereo(ins), ratio = 2 ** ((Math.round(v.semis) + v.fine / 100) / 12);
    for (let i = 0; i < n; i++) {
      const [wl, wr] = this.sh.step(L[i], R[i], ratio);
      outs[0][i] = L[i] * (1 - v.mix) + wl * v.mix;
      outs[1][i] = R[i] * (1 - v.mix) + wr * v.mix;
    }
  }
}

// ---------- Tune: hears the note being sung and pulls it to the nearest note of the key ----------
// YIN pitch detection: the lag where the signal best matches itself, normalised so octave errors are rare
export function yin(x, sr, fmin = 70, fmax = 1100, threshold = 0.15) {
  const tmax = Math.min(Math.floor(sr / fmin), x.length >> 1), tmin = Math.max(2, Math.floor(sr / fmax)), W = x.length - tmax;
  let energy = 0;
  for (let j = 0; j < x.length; j++) energy += x[j] * x[j];
  if (energy / x.length < 1e-6) return 0;  // silence
  const d = new Float32Array(tmax + 1);
  let sum = 0, best = 0;
  for (let tau = 1; tau <= tmax; tau++) {
    let s = 0;
    for (let j = 0; j < W; j++) { const e = x[j] - x[j + tau]; s += e * e; }
    sum += s;
    d[tau] = sum ? s * tau / sum : 1;
    if (tau >= tmin + 1 && !best && d[tau - 1] < threshold && d[tau - 1] <= d[tau]) best = tau - 1;
  }
  if (!best) return 0;  // breath, noise or a consonant
  const a = d[best - 1], b = d[best], c = d[best + 1], den = a - 2 * b + c;
  return sr / (best + (den ? clamp((a - c) / (2 * den), -0.5, 0.5) : 0));
}
export const KEYS = [['Song key', 0], ...['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'].map((k, i) => [k, i + 1])];
export const TUNE_SCALES = [['Major', 0], ['Minor', 1], ['Chromatic', 2]];
export const maskOf = pcs => pcs.reduce((m, pc) => m | 1 << ((pc % 12 + 12) % 12), 0);
export function nearestIn(midi, mask) {  // the closest note whose pitch class is in the mask
  for (let k = 0; k <= 6; k++) for (const m of [Math.round(midi) - k, Math.round(midi) + k].sort((x, y) => Math.abs(x - midi) - Math.abs(y - midi))) if (mask >> ((m % 12 + 12) % 12) & 1) return m;
  return Math.round(midi);
}
export class Tune {
  constructor(sr) {
    this.sr = sr;
    this.dec = Math.max(1, Math.round(sr / 12000));  // detection runs at about 12 kHz
    this.win = new Float32Array(512);
    this.acc = 0; this.k = 0; this.fill = 0; this.since = 0;
    this.corr = 0;  // semitones of correction now
    this.sh = new Shifter(sr, 0.03);
  }
  process(ins, outs, n, v) {
    const [L, R] = stereo(ins), dsr = this.sr / this.dec, hop = 128, mask = Math.round(v.mask) || 4095;
    for (let i = 0; i < n; i++) {
      this.acc += (L[i] + R[i]) / 2;
      if (++this.k === this.dec) {  // a decimated sample, averaged to keep out aliasing
        this.win.copyWithin(0, 1);
        this.win[this.win.length - 1] = this.acc / this.dec;
        this.acc = 0; this.k = 0;
        this.fill = Math.min(this.win.length, this.fill + 1);
        if (++this.since >= hop && this.fill === this.win.length) {
          this.since = 0;
          const f = yin(this.win, dsr), midi = f ? 69 + 12 * Math.log2(f / 440) : null;
          const want = midi == null ? 0 : nearestIn(midi, mask) - midi;
          const step = v.speed <= 0.001 ? 1 : 1 - Math.exp(-(hop / dsr) / (v.speed * 0.2));
          this.corr += (want - this.corr) * step;
        }
      }
      const [wl, wr] = this.sh.step(L[i], R[i], 2 ** (this.corr / 12));
      outs[0][i] = L[i] * (1 - v.mix) + wl * v.mix;
      outs[1][i] = R[i] * (1 - v.mix) + wr * v.mix;
    }
  }
}

// ---------- Transient shaper: a fast and a slow envelope; where they differ is the hit or the tail ----------
export class Transient {
  constructor(sr) {
    const c = s => Math.exp(-1 / (s * sr));
    Object.assign(this, { fa: c(0.0005), fr: c(0.03), sa: c(0.03), sl: c(0.3), gs: c(0.002), fast: 0, slow: 0, g: 1 });
  }
  process(ins, outs, n, v) {
    const [L, R] = stereo(ins), out = 10 ** (v.out / 20);
    for (let i = 0; i < n; i++) {
      const x = Math.max(Math.abs(L[i]), Math.abs(R[i]));
      this.fast = x > this.fast ? this.fa * this.fast + (1 - this.fa) * x : this.fr * this.fast + (1 - this.fr) * x;
      this.slow = x > this.slow ? this.sa * this.slow + (1 - this.sa) * x : this.sl * this.slow + (1 - this.sl) * x;
      const ratio = Math.log2((this.fast + 1e-5) / (this.slow + 1e-5));
      const db = v.attack * 9 * clamp(ratio, 0, 2) + v.sustain * 9 * clamp(-ratio, 0, 2);
      this.g = this.gs * this.g + (1 - this.gs) * 10 ** (db / 20);
      outs[0][i] = L[i] * this.g * out;
      outs[1][i] = R[i] * this.g * out;
    }
  }
}
