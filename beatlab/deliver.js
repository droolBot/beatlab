// BeatLab delivery: the last step before files leave. Loudness measurement (BS.1770, any sample rate),
// normalising to a target with a lookahead peak limiter so nothing clips, dither, and WAV and MP3 encoders.
import { loudness } from './listen.js';

const chans = buf => Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i));
export const peakOf = buf => chans(buf).reduce((m, c) => { for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i])); return m; }, 0);
export const db = x => (x > 0 ? 20 * Math.log10(x) : -Infinity);

// Integrated loudness in LUFS. The meter's filters are defined at 48 kHz, so other rates are resampled first.
export async function lufsOf(buf) {
  if (buf.sampleRate === 48000) return loudness(chans(buf), 48000);
  const ctx = new OfflineAudioContext(buf.numberOfChannels, Math.ceil(buf.duration * 48000), 48000), src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(ctx.destination);
  src.start();
  return loudness(chans(await ctx.startRendering()), 48000);
}

// Gain the whole file, then hold peaks under the ceiling: the gain drops 1.5 ms before a peak arrives
// (a sliding-window minimum, so it's linear time) and recovers over 80 ms.
export function limitInPlace(buf, gainLin, ceilingDb = -1) {
  const cs = chans(buf), n = buf.length, sr = buf.sampleRate, ceil = 10 ** (ceilingDb / 20);
  const look = Math.max(1, Math.round(sr * 0.0015)), rel = Math.exp(-1 / (sr * 0.08)), att = Math.exp(-1 / (sr * 0.0004));
  const need = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of cs) m = Math.max(m, Math.abs(c[i] * gainLin));
    need[i] = m > ceil ? ceil / m : 1;
  }
  const dq = new Int32Array(n + 1);  // indices of a rising run of minima over the window ahead
  let head = 0, tail = 0, g = 1, reduced = 0;
  for (let j = 0; j < Math.min(look, n); j++) { while (tail > head && need[dq[tail - 1]] >= need[j]) tail--; dq[tail++] = j; }
  for (let i = 0; i < n; i++) {
    const j = i + look;
    if (j < n) { while (tail > head && need[dq[tail - 1]] >= need[j]) tail--; dq[tail++] = j; }
    while (dq[head] < i) head++;
    const target = need[dq[head]];
    g = target < g ? target + (g - target) * att : target + (g - target) * rel;
    const k = gainLin * g;
    for (const c of cs) c[i] = Math.max(-ceil, Math.min(ceil, c[i] * k));  // the clamp only catches what the attack missed
    reduced = Math.max(reduced, 1 - g);
  }
  return db(1 - reduced);  // the most gain reduction, in dB (negative)
}

// Bring a render to a loudness target (null leaves the level alone) under a peak ceiling.
export async function finish(buf, { target = null, ceiling = -1 } = {}) {
  const before = await lufsOf(buf);
  let gainDb = 0;
  if (target != null && before != null) gainDb = Math.max(-24, Math.min(18, target - before));
  const reduction = limitInPlace(buf, 10 ** (gainDb / 20), ceiling);
  return { before, after: await lufsOf(buf), gainDb, reduction, peak: db(peakOf(buf)) };
}

// WAV: 16-bit with triangular dither, 24-bit, or 32-bit float
export function encodeWav(buf, bits = 16) {
  const cs = chans(buf), ch = cs.length, len = buf.length, bps = bits / 8, bytes = len * ch * bps, v = new DataView(new ArrayBuffer(44 + bytes));
  const text = (o, s) => [...s].forEach((x, i) => v.setUint8(o + i, x.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, bits === 32 ? 3 : 1, true); v.setUint16(22, ch, true); v.setUint32(24, buf.sampleRate, true);
  v.setUint32(28, buf.sampleRate * ch * bps, true); v.setUint16(32, ch * bps, true); v.setUint16(34, bits, true);
  text(36, 'data'); v.setUint32(40, bytes, true);
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let k = 0; k < ch; k++, o += bps) {
      const s = Math.max(-1, Math.min(1, cs[k][i]));
      if (bits === 32) v.setFloat32(o, s, true);
      else if (bits === 24) { const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff); v.setUint8(o, x & 255); v.setUint8(o + 1, (x >> 8) & 255); v.setUint8(o + 2, (x >> 16) & 255); }
      else v.setInt16(o, Math.max(-32768, Math.min(32767, Math.round(s * 32767 + (Math.random() - Math.random())))), true);
    }
  }
  return new Blob([v], { type: 'audio/wav' });
}

// MP3 through lamejs (LGPL, loaded from a CDN the first time). 320 kbps, 44.1 or 48 kHz.
let lame = null;
function loadLame() {
  lame ??= new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js';
    s.onload = () => (window.lamejs ? ok(window.lamejs) : fail(new Error('the MP3 encoder did not start')));
    s.onerror = () => { lame = null; fail(new Error('the MP3 encoder could not be downloaded. Check the internet connection')); };
    document.head.append(s);
  });
  return lame;
}
export async function encodeMp3(buf, kbps = 320) {
  const lj = await loadLame(), cs = chans(buf), stereo = cs.length > 1, enc = new lj.Mp3Encoder(stereo ? 2 : 1, buf.sampleRate, kbps), out = [];
  const toInt = c => { const a = new Int16Array(c.length); for (let i = 0; i < c.length; i++) a[i] = Math.max(-32768, Math.min(32767, Math.round(c[i] * 32767))); return a; };
  const L = toInt(cs[0]), R = stereo ? toInt(cs[1]) : null, block = 1152 * 16;
  for (let i = 0; i < L.length; i += block) {
    const chunk = stereo ? enc.encodeBuffer(L.subarray(i, i + block), R.subarray(i, i + block)) : enc.encodeBuffer(L.subarray(i, i + block));
    if (chunk.length) out.push(new Uint8Array(chunk));
    if (i % (block * 40) === 0) await new Promise(r => setTimeout(r));  // keep the page responsive on long songs
  }
  const end = enc.flush();
  if (end.length) out.push(new Uint8Array(end));
  return new Blob(out, { type: 'audio/mpeg' });
}

// Copy a buffer so finishing an export never changes what's cached
// A Standard MIDI file: tracks are { name, notes: [[start, length, pitch, velocity]] } in 96 ticks a beat,
// tempo and 4/4 in the first track. The same bytes the desktop server writes, for when BeatLab runs as a website.
export function midiFile(bpm, tracks) {
  const vlq = n => { const out = [n & 0x7f]; while ((n >>= 7)) out.unshift((n & 0x7f) | 0x80); return out; };
  const u32 = n => [n >>> 24 & 255, n >>> 16 & 255, n >>> 8 & 255, n & 255];
  const chunk = (t, i) => {
    const name = [...new TextEncoder().encode(t.name)], ev = [];
    for (const [s, l, p, v] of t.notes) { ev.push([s, 1, [0x90, p, v]], [s + l, 0, [0x80, p, 0]]); }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);  // note-offs before note-ons on the same tick
    const data = [0, 0xff, 0x03, ...vlq(name.length), ...name];
    if (i === 0) { const us = Math.round(60e6 / bpm); data.push(0, 0xff, 0x51, 0x03, us >> 16 & 255, us >> 8 & 255, us & 255, 0, 0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08); }
    let now = 0;
    for (const [tick, , msg] of ev) { data.push(...vlq(tick - now), ...msg); now = tick; }
    data.push(0, 0xff, 0x2f, 0);
    return [...[0x4d, 0x54, 0x72, 0x6b], ...u32(data.length), ...data];
  };
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, ...u32(6), 0, tracks.length > 1 ? 1 : 0, tracks.length >> 8, tracks.length & 255, 0, 96, ...tracks.flatMap(chunk)]);
}

// A zip of files [[name, Blob | Uint8Array | string]], stored without compression (WAV and MP3 don't shrink)
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
export async function zipFiles(files) {
  const parts = [], dir = [], enc = new TextEncoder();
  let offset = 0;
  for (const [name, body] of files) {
    const data = typeof body === 'string' ? enc.encode(body) : body instanceof Uint8Array ? body : new Uint8Array(await body.arrayBuffer());
    let crc = 0xffffffff;
    for (let i = 0; i < data.length; i++) crc = CRC[(crc ^ data[i]) & 255] ^ (crc >>> 8);
    crc = (crc ^ 0xffffffff) >>> 0;
    const fn = enc.encode(name), head = new DataView(new ArrayBuffer(30)), cen = new DataView(new ArrayBuffer(46));
    [[0, 0x04034b50, 4], [4, 20, 2], [8, 0, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, fn.length, 2]].forEach(([o, v, n]) => (n === 4 ? head.setUint32(o, v, true) : head.setUint16(o, v, true)));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, fn.length, 2], [42, offset, 4]].forEach(([o, v, n]) => (n === 4 ? cen.setUint32(o, v, true) : cen.setUint16(o, v, true)));
    parts.push(new Uint8Array(head.buffer), fn, data);
    dir.push(new Uint8Array(cen.buffer), fn);
    offset += 30 + fn.length + data.length;
  }
  const size = dir.reduce((n, d) => n + d.length, 0), end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, size, 4], [16, offset, 4]].forEach(([o, v, n]) => (n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
  return new Blob([...parts, ...dir, new Uint8Array(end.buffer)], { type: 'application/zip' });
}

export function cloneBuffer(buf) {
  const b = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
  for (let i = 0; i < buf.numberOfChannels; i++) b.copyToChannel(buf.getChannelData(i), i);
  return b;
}
