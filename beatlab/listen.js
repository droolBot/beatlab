// BeatLab listening: decode a song, then estimate its tempo, key and loudness. All local, no AI service.
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];  // Krumhansl-Kessler key profiles
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export const decode = bytes => new OfflineAudioContext(2, 1, 48000).decodeAudioData(bytes);  // 48 kHz for the loudness filter

export function analyze(buf) {
  const chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const mono = new Float32Array(buf.length);
  let peak = 0;
  for (const ch of chans) {
    for (let i = 0; i < ch.length; i++) {
      mono[i] += ch[i] / chans.length;
      peak = Math.max(peak, Math.abs(ch[i]));
    }
  }
  const bpms = tempo(mono, buf.sampleRate), keys = key(mono, buf.sampleRate);
  return { duration: buf.duration, bpms, keys, key: keys[0], lufs: loudness(chans, buf.sampleRate), peak: 20 * Math.log10(peak || 1e-9) };
}

// Onset strength (energy rise, full band plus a high-frequency emphasis) every 10 ms, then
// autocorrelation scored at 1-4 beat lags. Returns the three best distinct tempos.
export function tempo(x, sr) {
  const hop = Math.round(sr / 100), fps = sr / hop, mid = x.length >> 1, half = Math.min(mid, 45 * sr);
  x = x.subarray(mid - half, mid + half);
  const o = [];
  let p0 = null, p1 = 0;
  for (let i = 1; i + hop < x.length; i += hop) {
    let e0 = 0, e1 = 0;
    for (let j = i; j < i + hop; j++) {
      const dx = x[j] - x[j - 1];
      e0 += x[j] * x[j];
      e1 += dx * dx;
    }
    e0 = Math.log(1e-9 + e0);
    e1 = Math.log(1e-9 + e1);
    o.push(p0 === null ? 0 : Math.max(0, e0 - p0) + Math.max(0, e1 - p1));
    p0 = e0;
    p1 = e1;
  }
  const lmax = Math.ceil(4 * 60 * fps / 55) + 2;
  if (o.length < lmax * 2) return [];  // under ~9 seconds is too short to judge
  const mean = o.reduce((s, v) => s + v, 0) / o.length;
  for (let i = 0; i < o.length; i++) o[i] -= mean;
  const acf = new Float64Array(lmax);
  for (let l = 0; l < lmax; l++) {
    let s = 0;
    for (let i = 0; i + l < o.length; i++) s += o[i] * o[i + l];
    acf[l] = s / (o.length - l);
  }
  const at = f => { const i = Math.floor(f); return acf[i] + (f - i) * (acf[i + 1] - acf[i]); };
  const scores = [];
  for (let b = 60; b < 200; b += 0.25) {
    let s = 0;
    for (let k = 1; k <= 4; k++) s += at(k * 60 * fps / b);
    scores.push([s, b]);
  }
  scores.sort((a, b) => b[0] - a[0]);
  const picks = [];
  for (const [, b] of scores) {
    if (picks.every(p => Math.abs(p - b) > 4)) picks.push(b);
    if (picks.length === 3) break;
  }
  return picks;
}

// Pitch-class energy from Goertzel filters (F1 to B5) over 24 one-second windows, matched against
// major and minor key profiles. If the strongest bass note is the tonic of a near-tie, it wins.
export function key(x, sr) {
  const f = Math.round(sr / 4000), rate = sr / f, n = Math.floor(rate), len = Math.floor(x.length / f);
  const y = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (let j = 0; j < f; j++) s += x[i * f + j];
    y[i] = s / f;
  }
  const hann = Float32Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1)));
  const coef = [];
  for (let m = 29; m < 84; m++) coef.push([m, 2 * Math.cos(2 * Math.PI * 440 * 2 ** ((m - 69) / 12) / rate)]);
  const chroma = new Float64Array(12), bass = new Float64Array(12);
  for (let w = 0; w < 24; w++) {
    const start = Math.floor(len * (0.05 + 0.9 * w / 24));
    if (start + n > len) continue;
    for (const [m, c] of coef) {
      let s1 = 0, s2 = 0;
      for (let i = 0; i < n; i++) {
        const s0 = y[start + i] * hann[i] + c * s1 - s2;
        s2 = s1;
        s1 = s0;
      }
      const mag = Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - c * s1 * s2));
      chroma[m % 12] += mag;
      if (m < 48) bass[m % 12] += mag;
    }
  }
  const bassPc = bass.indexOf(Math.max(...bass)), ranked = [];
  for (let r = 0; r < 12; r++) {
    for (const [prof, mode] of [[MAJOR, 'major'], [MINOR, 'minor']]) ranked.push({ root: r, mode, score: corr(chroma, prof.map((_, i) => prof[(i - r + 12) % 12])) });
  }
  ranked.sort((a, b) => b.score - a.score);
  const top = ranked.slice(0, 3), tonic = top.find(k => k.root === bassPc && k.score > top[0].score - 0.08);
  if (tonic) top.unshift(...top.splice(top.indexOf(tonic), 1));
  return top.map(k => ({ ...k, name: `${NAMES[k.root]} ${k.mode}` }));
}

function corr(a, b) {
  const ma = a.reduce((s, v) => s + v, 0) / 12, mb = b.reduce((s, v) => s + v, 0) / 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db || 1);
}

// Copy a song's drum groove at a given tempo: onset strength in three bands (kick under 120 Hz,
// snare/clap 200 Hz-2.5 kHz, hats above 6 kHz) every 5 ms, lined up on the 16th-note grid, averaged
// over every two-bar cycle and kept where it is strong. Returns bar patterns like the styles use.
export function groove(buf, bpm) {
  const sr = buf.sampleRate, chans = Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
  const hop = Math.round(sr / 200), frames = Math.floor(buf.length / hop), step = 200 * 60 / bpm / 4;  // frames per 16th
  if (frames < step * 64) return null;  // need at least two cycles of two bars
  const k = fc => 1 - Math.exp(-2 * Math.PI * fc / sr), a120 = k(120), a200 = k(200), a2500 = k(2500), a6000 = k(6000);
  const E = [0, 1, 2].map(() => new Float32Array(frames));
  let l1 = 0, l2 = 0, m1 = 0, m2 = 0, h1 = 0;
  for (let f = 0; f < frames; f++) {
    let e0 = 0, e1 = 0, e2 = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) {
      let v = 0;
      for (const ch of chans) v += ch[i];
      v /= chans.length;
      l1 += a120 * (v - l1); l2 += a120 * (l1 - l2);
      m1 += a200 * (v - m1); m2 += a2500 * (v - m1 - m2);
      h1 += a6000 * (v - h1);
      e0 += l2 * l2; e1 += m2 * m2; e2 += (v - h1) ** 2;
    }
    E[0][f] = Math.sqrt(e0); E[1][f] = Math.sqrt(e1); E[2][f] = Math.sqrt(e2);
  }
  const O = E.map(e => {  // amplitude rise, normalised to the band's average
    const o = new Float32Array(frames);
    for (let f = 1; f < frames; f++) o[f] = Math.max(0, e[f] - e[f - 1]);
    const mean = o.reduce((s, v) => s + v, 0) / frames || 1;
    return o.map(v => v / mean);
  });
  const at = (o, pos) => { const f = Math.round(pos); return Math.max(o[f - 1] ?? 0, o[f] ?? 0, o[f + 1] ?? 0); };
  const sum = (o, start, every) => { let s = 0; for (let p = start; p < frames - 1; p += every) s += at(o, p); return s; };
  // Grid phase: where all onsets line up best; then which 16th is the beat; then which beat is the bar's first
  let phase = 0, best = -1;
  for (let ph = 0; ph < step; ph += 0.5) {
    const s = sum(O[0], ph, step) + sum(O[1], ph, step) + sum(O[2], ph, step);
    if (s > best) { best = s; phase = ph; }
  }
  let beat = phase;
  best = -1;
  for (let q = 0; q < 4; q++) {
    const s = sum(O[0], phase + q * step, 4 * step) + sum(O[1], phase + q * step, 4 * step);
    if (s > best) { best = s; beat = phase + q * step; }
  }
  let bar = beat;
  best = -Infinity;
  for (let b = 0; b < 4; b++) {  // kicks land on 1 (and often 3); snares rarely on 1
    const start = beat + b * 4 * step;
    const s = sum(O[0], start, 16 * step) + 0.5 * sum(O[0], start + 8 * step, 16 * step) - sum(O[1], start, 16 * step);
    if (s > best) { best = s; bar = start; }
  }
  bar %= 16 * step;
  const cycles = Math.floor((frames - bar) / (32 * step));
  const strength = O.map(o => Array.from({ length: 32 }, (_, s) => {
    let v = 0;
    for (let c = 0; c < cycles; c++) v += at(o, bar + (c * 32 + s) * step);
    return v / cycles;
  }));
  // Keep steps that stand out from the band's background (an 808 or a vocal keeps every step busy).
  // A band that still comes out empty or crowded is left to the style's own pattern (null).
  const toBars = (vals, on, ghost = Infinity) => {
    const base = [...vals].sort((a, b) => a - b)[16], top = Math.max(...vals) - base || 1;
    const str = vals.map(v => (v - base) / top >= on ? 'x' : (v - base) / top >= ghost ? 'o' : '.').join('');
    const count = [...str].filter(c => c === 'x').length;
    return count >= 2 && count <= 20 ? [str.slice(0, 16), str.slice(16)] : null;
  };
  return { kick: toBars(strength[0], 0.55), snare: toBars(strength[1], 0.6, 0.4), hat: toBars(strength[2], 0.45) };
}

// Integrated loudness per ITU-R BS.1770 (K-weighting, 400 ms blocks, -70 LUFS and relative gates)
export function loudness(chans, sr) {
  if (sr !== 48000) return null;  // the filter coefficients below are for 48 kHz
  const [b0, b1, b2, a1, a2] = [1.53512485958697, -2.69169618940638, 1.19839281085285, -1.69065929318241, 0.73248077421585];
  const [c1, c2] = [-1.99004745483398, 0.99007225036621];
  const n = chans[0].length, block = 19200, hop = 4800, sum = new Float64Array(n + 1);
  for (const x of chans) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0, z1 = 0, z2 = 0;
    for (let i = 0; i < n; i++) {
      const y = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = x[i];
      const z = y - 2 * y1 + y2 - c1 * z1 - c2 * z2;  // high-pass stage runs on the shelf output
      y2 = y1; y1 = y;
      z2 = z1; z1 = z;
      sum[i + 1] += z * z;
    }
  }
  for (let i = 0; i < n; i++) sum[i + 1] += sum[i];
  const L = p => -0.691 + 10 * Math.log10(p), mean = a => a.reduce((s, v) => s + v, 0) / a.length;
  let blocks = [];
  for (let s = 0; s + block <= n; s += hop) blocks.push((sum[s + block] - sum[s]) / block);
  blocks = blocks.filter(p => p > 0 && L(p) > -70);
  if (!blocks.length) return null;
  const gate = L(mean(blocks)) - 10;
  return L(mean(blocks.filter(p => L(p) > gate)));
}
