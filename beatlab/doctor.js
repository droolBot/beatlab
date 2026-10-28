// The mix doctor: measures a beat the way an engineer listens (the frequency balance, the kick against the
// 808, low end where it doesn't belong, stereo, how squeezed it is, the levels) and turns each problem into
// plain words and a fix. Pure maths on Float32Arrays, so test_doctor.mjs checks every rule on test signals.

export const BANDS = [31.5, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];  // octave centres, Hz
// Where a finished hip-hop or pop mix's octaves sit against its 1 kHz octave, in dB: heavy lows, a gentle slope up top
export const REF = [4, 8, 6, 3, 1.5, 0, -2, -4.5, -7.5, -15];

function fft(re, im) {  // in place, radix 2
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k], vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci, vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        [cr, ci] = [cr * wr - ci * wi, cr * wi + ci * wr];
      }
    }
  }
}

// Octave-band levels in dB over the whole signal, and each frame's energy below 120 Hz (to see what overlaps)
export function spectrum(x, sr, size = 4096) {
  const bands = new Float64Array(BANDS.length), lows = [], win = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / size));
  const re = new Float64Array(size), im = new Float64Array(size);
  for (let at = 0; at + size <= x.length; at += size) {
    for (let i = 0; i < size; i++) { re[i] = x[at + i] * win[i]; im[i] = 0; }
    fft(re, im);
    let low = 0;
    for (let k = 1; k < size / 2; k++) {
      const f = k * sr / size, p = re[k] * re[k] + im[k] * im[k], b = Math.round(Math.log2(f / 31.5));
      if (b >= 0 && b < BANDS.length) bands[b] += p;
      if (f >= 30 && f < 120) low += p;
    }
    lows.push(low);
  }
  const frames = Math.max(1, lows.length);
  return { db: [...bands].map(e => 10 * Math.log10(e / frames + 1e-20)), lows };
}
const energy = x => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return s; };
export function correlation(l, r) {
  let lr = 0, ll = 0, rr = 0;
  for (let i = 0; i < l.length; i++) { lr += l[i] * r[i]; ll += l[i] * l[i]; rr += r[i] * r[i]; }
  return ll && rr ? lr / Math.sqrt(ll * rr) : 1;
}

const LIST = xs => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const dB = x => `${x > 0 ? '+' : ''}${x.toFixed(1)} dB`;
const LOW_OK = new Set(['bass', 'drum']);  // the parts that are meant to carry low end

// mix: { l, r, lufs, peak (dBFS) }; parts: [{ id, name, kind, x, lufs, duck, lowCut, target }]; master: { glue, width }
// Returns { score, issues: [{ id, weight, title, detail, fix, fixLabel }] }. A fix is data the studio carries out.
export function diagnose({ sr, mix, parts, master = {}, dusty = false }) {
  const issues = [], add = (id, weight, title, detail, fixLabel, fix) => issues.push({ id, weight, title, detail, fixLabel, fix });
  const mono = Float32Array.from(mix.l, (v, i) => (v + mix.r[i]) / 2), spec = spectrum(mono, sr);
  const specs = new Map(parts.map(p => [p.id, spectrum(p.x, sr)]));
  const offset = [2, 3, 4, 5, 6, 7].reduce((s, b) => s + spec.db[b] - REF[b], 0) / 6, dev = spec.db.map((v, b) => v - REF[b] - offset);
  const loudestIn = (bands, ok = () => true) => parts.filter(ok).map(p => ({ p, e: bands.reduce((s, b) => s + 10 ** (specs.get(p.id).db[b] / 10), 0) })).sort((a, b) => b.e - a.e)[0]?.p;

  // The kick and the 808 both loud in the lows at the same moments blur into one boom
  const kick = parts.find(p => p.id === 'kick'), bass = parts.find(p => p.kind === 'bass');
  if (kick && bass) {
    const k = specs.get(kick.id).lows, b = specs.get(bass.id).lows, kMax = Math.max(...k), bMax = Math.max(...b);
    const hits = k.filter(v => v > kMax * 0.1).length, both = k.filter((v, i) => v > kMax * 0.1 && b[i] > bMax * 0.1).length;
    if (hits && both / hits > 0.5 && (bass.duck ?? 0) < 0.3) add('clash', 15, `The kick and the ${bass.name} fight in the low end`, `They're both loud below 120 Hz on ${Math.round(100 * both / hits)}% of the kick's hits, so they blur into one boom. Ducking the ${bass.name} for a moment on each kick lets both come through.`, `Duck the ${bass.name} under the kick`, { kind: 'duck', track: bass.id, value: 0.6 });
  }
  // Low end in parts that don't need it muddies the bass
  const boomy = parts.filter(p => !LOW_OK.has(p.kind) && !p.lowCut && energy(p.x) > 0).filter(p => { const d = specs.get(p.id).db, lo = 10 ** (d[0] / 10) + 10 ** (d[1] / 10), all = d.reduce((s, v) => s + 10 ** (v / 10), 0); return lo / all > 0.15; });
  if (boomy.length) add('lowend', 10, `${LIST(boomy.map(p => p.name))} carr${boomy.length > 1 ? 'y' : 'ies'} low end the ${bass?.name ?? 'bass'} should own`, 'More than 15% of their sound is below 120 Hz, where it only adds rumble under the bass. A low cut keeps what you hear and clears the room.', 'Add low cuts', { kind: 'lowcut', tracks: boomy.map(p => p.id), f: 150 });

  // The frequency balance against a finished mix
  const mud = (dev[3] + dev[4]) / 2, harsh = (dev[6] + dev[7]) / 2, air = (dev[8] + dev[9]) / 2, sub = (dev[0] + dev[1]) / 2;
  if (mud > 3) { const p = loudestIn([3, 4], q => q.kind !== 'drum') ?? loudestIn([3, 4]); add('mud', 12, 'The mix is muddy', `There's ${dB(mud)} too much around 250 to 500 Hz, and most of it comes from the ${p.name}. That range makes a beat sound boxy and cloudy.`, `Cut 300 Hz on the ${p.name}`, { kind: 'eq', track: p.id, set: { f1: 320, g1: -Math.min(6, Math.round(mud)), q1: 1.2 } }); }
  if (harsh > 3) { const p = loudestIn([6, 7]); add('harsh', 12, 'The mix is harsh', `There's ${dB(harsh)} too much around 2 to 5 kHz, mostly from the ${p.name}. It's the range that tires ears on headphones.`, `Soften 3.5 kHz on the ${p.name}`, { kind: 'eq', track: p.id, set: { f2: 3500, g2: -Math.min(6, Math.round(harsh)), q2: 1 } }); }
  if (air < -6 && !dusty) { const hats = parts.filter(p => /hat/.test(p.id)); if (hats.length) add('dull', 8, 'The top end is dull', `Above 6 kHz the mix is ${dB(air)} under a finished one, so it sounds like it's behind a curtain. Brighter hats bring the air back.`, 'Brighten the hats', { kind: 'tone', tracks: hats.map(p => p.id), dir: 'brighter' }); }
  if (bass && sub < -6) add('thin', 10, 'The low end is thin', `Below 90 Hz the mix is ${dB(sub)} under a finished one. On a big speaker the beat will feel light.`, `Turn the ${bass.name} up 3 dB`, { kind: 'vol', track: bass.id, dB: 3 });
  if (bass && sub > 6) add('heavy', 10, 'The low end is too heavy', `Below 90 Hz the mix is ${dB(sub)} over a finished one. It will rattle small speakers and leave the rest sounding quiet.`, `Turn the ${bass.name} down 3 dB`, { kind: 'vol', track: bass.id, dB: -3 });

  // The levels: every part against where it usually sits, after the overall level is taken out
  const leveled = parts.filter(p => Number.isFinite(p.lufs) && p.lufs > -70 && p.target != null);
  if (leveled.length > 2) {
    const offs = leveled.map(p => p.lufs - p.target).sort((a, b) => a - b), mid = offs[offs.length >> 1];
    const off = leveled.map(p => ({ p, d: p.lufs - p.target - mid })).filter(x => Math.abs(x.d) > 4).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    if (off.length) add('balance', 15, 'Some parts are out of balance', LIST(off.slice(0, 3).map(({ p, d }) => `the ${p.name} is ${Math.abs(d).toFixed(0)} dB ${d > 0 ? 'too loud' : 'too quiet'}`)).replace(/^./, c => c.toUpperCase()) + ' next to the rest.', 'Balance the levels', { kind: 'automix' });
  }
  // Stereo: left and right too different collapse on a phone; too alike sound small
  const corr = correlation(mix.l, mix.r);
  if (corr < 0.3) add('phase', 10, 'The stereo could vanish on a phone', `Left and right only match ${Math.round(Math.max(0, corr) * 100)}%, so in mono, on one phone speaker, parts will thin out or disappear.`, 'Narrow the master', { kind: 'master', set: { width: 1 } });
  else if (corr > 0.97 && (master.width ?? 1) <= 1) { const wide = parts.filter(p => p.kind === 'chords'); if (wide.length) add('narrow', 5, 'Everything sits in the middle', 'Left and right are almost the same, so the beat sounds small. Widening the chords makes room around the drums and the vocal.', `Widen the ${LIST(wide.map(p => p.name))}`, { kind: 'width', tracks: wide.map(p => p.id), value: 1.4 }); }
  // How squeezed it is: the distance between the loudest peak and the average loudness
  if (Number.isFinite(mix.lufs) && Number.isFinite(mix.peak)) {
    const plr = mix.peak - mix.lufs;
    if (plr < 6) add('squashed', 10, 'The master is squeezing the hits', `Only ${plr.toFixed(1)} dB separates the loudest peak from the average, so the drums lose their snap.`, 'Ease off the glue', { kind: 'master', set: { glue: Math.max(0, (master.glue ?? 0.5) - 0.3) } });
    else if (plr > 15) add('peaky', 6, 'The hits poke out of the mix', `${plr.toFixed(1)} dB between the loudest peak and the average is more than most released beats, so the mix sounds loose.`, 'More glue on the master', { kind: 'master', set: { glue: Math.min(1, (master.glue ?? 0.5) + 0.25) } });
  }
  issues.sort((a, b) => b.weight - a.weight);
  return { score: Math.max(0, 100 - issues.reduce((s, i) => s + i.weight, 0)), issues, bands: spec.db.map((v, b) => +(v - offset).toFixed(1)), ref: REF };
}
