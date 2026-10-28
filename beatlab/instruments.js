// BeatLab instruments: presets for the built-in synths, and FL Studio's own sample packs turned into
// instruments you can play: multi-sampled pianos, basses, guitars, strings and choirs, and drum kits with
// velocity layers and alternate takes. FL's patch files (.fst) are its own format, so BeatLab works out
// each sample's note from its name or, failing that, by listening for its pitch.

// ---------- presets: named settings for each synth's knobs ----------
export const PRESETS = {
  kick: { Deep: { tune: -3, decay: 0.9, punch: 0.25 }, Punchy: { tune: 2, decay: 0.38, punch: 0.85 }, Tight: { tune: 4, decay: 0.22, punch: 0.6 }, Boom: { tune: -6, decay: 1.4, punch: 0.15 } },
  snare: { Tight: { tune: 3, decay: 0.12, snap: 0.75 }, Fat: { tune: -4, decay: 0.38, snap: 0.35 }, 'Trap snap': { tune: 5, decay: 0.16, snap: 1 }, Soft: { tune: -2, decay: 0.24, snap: 0.15 } },
  clap: { Dry: { tone: 1400, decay: 0.12 }, Roomy: { tone: 1000, decay: 0.45 }, Bright: { tone: 2200, decay: 0.2 } },
  hat: { Tick: { tone: 10000, decay: 0.02 }, Crisp: { tone: 8500, decay: 0.05 }, Dark: { tone: 5000, decay: 0.08 } },
  openhat: { Short: { tone: 7500, decay: 0.2 }, Long: { tone: 6000, decay: 0.8 }, Dark: { tone: 4500, decay: 0.5 } },
  808: {
    'Clean sub': { decay: 1.6, drive: 0.1, glide: 0.06, tone: 600 }, 'Hard drive': { decay: 1.2, drive: 0.85, glide: 0.08, tone: 2500 },
    'Long slide': { decay: 2.6, drive: 0.4, glide: 0.22, tone: 1200 }, 'Short punch': { decay: 0.4, drive: 0.55, glide: 0.04, tone: 1800 },
    Distorted: { decay: 1.4, drive: 1, glide: 0.1, tone: 4000 },
  },
  bass: { Round: { cutoff: 500, res: 1.5, decay: 0.4 }, Acid: { cutoff: 2400, res: 11, decay: 0.18 }, Plucky: { cutoff: 3000, res: 4, decay: 0.08 }, Warm: { cutoff: 900, res: 2.5, decay: 0.6 } },
  reese: { Dark: { cutoff: 400, detune: 22, drive: 0.4 }, Wide: { cutoff: 1100, detune: 38, drive: 0.2 }, Gritty: { cutoff: 900, detune: 16, drive: 0.9 } },
  keys: { Classic: { bright: 0.6, decay: 1.1, tine: 0.4, trem: 0 }, Mellow: { bright: 0.25, decay: 1.6, tine: 0.15, trem: 0.2 }, Bell: { bright: 0.9, decay: 0.8, tine: 0.9, trem: 0 }, 'Suitcase trem': { bright: 0.5, decay: 1.3, tine: 0.35, trem: 0.7 } },
  piano: { Bright: { bright: 0.85, decay: 1.4 }, Soft: { bright: 0.2, decay: 2.2 }, Felt: { bright: 0.05, decay: 1 } },
  organ: { Gospel: { drawbar: 0.9, leslie: 0.8 }, Jazz: { drawbar: 0.4, leslie: 0.35 }, Soft: { drawbar: 0.15, leslie: 0.1 } },
  pad: { Warm: { cutoff: 1100, attack: 0.5, release: 0.8, detune: 9 }, Dark: { cutoff: 500, attack: 0.9, release: 1.2, detune: 14 }, 'Bright wide': { cutoff: 4500, attack: 0.3, release: 0.6, detune: 24 }, 'Slow swell': { cutoff: 1800, attack: 1.8, release: 2.5, detune: 12 } },
  strings: { Lush: { attack: 0.35, cutoff: 3000, vibrato: 9 }, Staccato: { attack: 0.01, cutoff: 5000, vibrato: 2 }, Dark: { attack: 0.6, cutoff: 1200, vibrato: 6 } },
  pluck: { Short: { cutoff: 16, decay: 0.12 }, Soft: { cutoff: 6, decay: 0.35 }, Bright: { cutoff: 24, decay: 0.25 } },
  bell: { Glass: { bright: 0.8, decay: 1.2, ratio: 3.5 }, Music_box: { bright: 0.5, decay: 0.6, ratio: 4 }, Metal: { bright: 1, decay: 2, ratio: 1.41 } },
  lead: { Saw: { cutoff: 4000, detune: 14, vibrato: 10, glide: 0 }, Soft: { cutoff: 1600, detune: 6, vibrato: 6, glide: 0 }, Glide: { cutoff: 3200, detune: 18, vibrato: 14, glide: 0.12 }, Screamer: { cutoff: 7500, detune: 30, vibrato: 25, glide: 0.05 } },
  brass: { Stab: { bright: 0.9, attack: 0.02 }, Swell: { bright: 0.5, attack: 0.25 }, Mellow: { bright: 0.2, attack: 0.08 } },
  vox: { Ah: { vowel: 0, breath: 0.3 }, Oo: { vowel: 1, breath: 0.2 }, Breathy: { vowel: 0.4, breath: 0.9 } },
  fm: {
    'Electric piano': { algo: 1, r1: 1, r2: 1, i2: 2.2, d2: 0.9, r3: 10, i3: 0.6, d3: 0.15, attack: 0.002, decay: 1.4, sustain: 0.2, release: 0.4 },
    'FM bass': { algo: 0, r1: 1, r2: 1, i2: 4, d2: 0.25, r3: 3, i3: 1.2, d3: 0.12, attack: 0.002, decay: 0.4, sustain: 0.8, release: 0.08 },
    'Tubular bell': { algo: 1, r1: 1, r2: 6, i2: 3, d2: 2, r3: 9, i3: 1.5, d3: 1.2, attack: 0.001, decay: 2.5, sustain: 0, release: 1.5 },
    Brass: { algo: 0, r1: 1, r2: 1, i2: 3, d2: 1.5, r3: 1, i3: 0.5, d3: 1, attack: 0.06, decay: 0.6, sustain: 0.7, release: 0.2 },
    'Glass pad': { algo: 2, r1: 1, r2: 3, i2: 1, d2: 3, r3: 7, i3: 3, d3: 3, attack: 0.8, decay: 2, sustain: 0.8, release: 1.6 },
    Pluck: { algo: 0, r1: 1, r2: 3, i2: 5, d2: 0.08, r3: 1, i3: 2, d3: 0.05, attack: 0.001, decay: 0.3, sustain: 0, release: 0.2 },
  },
  wave: {
    'Vowel pad': { table: 4, morph: 0.2, scan: 0.7, scantime: 2.5, ldepth: 0.15, lrate: 0.2, uni: 3, detune: 14, cutoff: 6000, attack: 0.6, sustain: 0.8, release: 1.5 },
    'Digital lead': { table: 7, morph: 0, scan: 0.9, scantime: 0.3, uni: 2, detune: 12, cutoff: 9000, attack: 0.005, sustain: 0.8, release: 0.2 },
    'Glass keys': { table: 6, morph: 0.5, scan: -0.5, scantime: 1, cutoff: 12000, attack: 0.002, decay: 1.2, sustain: 0.1, release: 0.6 },
    'Organ swell': { table: 5, morph: 0.4, scan: 0.4, scantime: 3, ldepth: 0.1, lrate: 5, cutoff: 7000, attack: 0.2, sustain: 0.9, release: 0.4 },
    'Growl bass': { table: 2, morph: 0.3, scan: 0, ldepth: 0.5, lrate: 3, uni: 2, detune: 8, cutoff: 1800, res: 5, attack: 0.005, sustain: 1, release: 0.1 },
  },
  synth: {
    Supersaw: { w1: 2, w2: 2, w3: 2, o3: 1, l3: 0.35, uni: 5, spread: 22, cutoff: 6000, res: 0.8, fenv: 0.1, attack: 0.01, decay: 0.4, sustain: 0.8, release: 0.4 },
    'Pluck lead': { w1: 2, w2: 3, d2: 6, l3: 0, cutoff: 900, res: 4, fenv: 0.9, attack: 0.002, decay: 0.25, sustain: 0.1, release: 0.15 },
    'Sub bass': { w1: 0, o1: -1, l1: 1, l2: 0.25, w2: 1, l3: 0, cutoff: 900, res: 0.7, fenv: 0, attack: 0.004, decay: 0.3, sustain: 1, release: 0.08, glide: 0.06 },
    'Wobble bass': { w1: 2, o1: -1, w2: 3, o2: -1, d2: 9, l3: 0, cutoff: 500, res: 9, fenv: 0, lrate: 4, lcut: 0.85, drive: 0.6, attack: 0.005, sustain: 1, release: 0.1 },
    'Square lead': { w1: 3, w2: 3, d2: 12, o2: 1, l2: 0.3, l3: 0, cutoff: 3500, res: 1.5, fenv: 0.3, lpitch: 18, glide: 0.08, attack: 0.01, sustain: 0.85 },
    'Warm pad': { w1: 2, w2: 1, w3: 2, o3: -1, l3: 0.4, uni: 3, spread: 14, cutoff: 1400, res: 1, fenv: 0.25, attack: 0.8, decay: 1.5, sustain: 0.8, release: 1.6, lrate: 0.3, lcut: 0.2 },
    'Brass stab': { w1: 2, w2: 2, d2: -8, l3: 0, cutoff: 700, res: 2, fenv: 1, attack: 0.03, decay: 0.3, sustain: 0.6, release: 0.2 },
    'Bell keys': { w1: 0, w2: 1, o2: 2, l2: 0.5, w3: 0, o3: 1, l3: 0.3, cutoff: 9000, fenv: 0, attack: 0.002, decay: 1.2, sustain: 0, release: 0.8 },
    'Noise sweep': { w1: 4, l1: 1, l2: 0, l3: 0, ftype: 1, cutoff: 600, res: 6, fenv: 1, attack: 1.5, decay: 1, sustain: 0.5, release: 1.5 },
    'Chip arp': { w1: 3, l2: 0, l3: 0, cutoff: 12000, fenv: 0, attack: 0.001, decay: 0.12, sustain: 0.2, release: 0.05 },
  },
};

// ---------- FL Studio's packs as instruments ----------
const AUDIO = /\.(wav|ogg|flac|mp3)$/i;
const label = s => s.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
const folderOf = p => p.slice(0, p.lastIndexOf('/'));
const GROUPS = { Keyboard: 'Keys', Piano: 'Keys', Bass: 'Bass', Guitar: 'Guitar', Orchestral: 'Orchestral', Strings: 'Orchestral', Choirs: 'Choir and vocal', Pads: 'Pads', Hits: 'Hits', Percs: 'Hits' };

// Multi-sample folders (several notes of one instrument) and single-sample sounds, from the library's paths
export function flInstruments(library) {
  const byFolder = new Map();
  for (const p of library) {
    if (!AUDIO.test(p) || !/^(Instruments|Legacy\/Instruments|BeatLab\/Instruments)\//.test(p)) continue;
    const f = folderOf(p);
    if (!byFolder.has(f)) byFolder.set(f, []);
    byFolder.get(f).push(p);
  }
  const out = [];
  for (const [folder, files] of byFolder) {
    const parts = folder.split('/'), deep = parts[0] === 'Legacy' || parts[0] === 'BeatLab', cat = parts[parts.length - (deep ? (parts.length > 3 ? 2 : 1) : 2)] ?? '', group = GROUPS[cat] ?? cat;
    const multi = parts.length >= (deep ? 4 : 3);
    if (multi) out.push({ id: folder, name: label(parts.at(-1)), group, files: files.sort(byNumber) });
    else for (const f of files) out.push({ id: f, name: label(f.split('/').pop().replace(AUDIO, '').replace(/^(PAD|STR|CHR|BAS|HIT|PRC)_/i, '').replace(/ [A-G]#?\d$/, '')) + (parts[0] === 'BeatLab' ? ' (BeatLab)' : ''), group, files: [f] });
  }
  return out.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}
const num = p => +(p.match(/(\d+)\)?\.\w+$/)?.[1] ?? NaN);
const byNumber = (a, b) => (num(a) - num(b)) || a.localeCompare(b);

// Drum kits: FL's kit folders and the older flat folders of named hits
export function flKits(library) {
  const byFolder = new Map();
  for (const p of library) {
    if (!AUDIO.test(p) || !/^(Drums\/Kits|Legacy\/Drums|BeatLab\/Kits)\//.test(p) || /Legacy\/Drums\/FPC\//.test(p)) continue;
    const f = folderOf(p);
    if (!byFolder.has(f)) byFolder.set(f, []);
    byFolder.get(f).push(p);
  }
  return [...byFolder].filter(([, files]) => files.length >= 5).map(([folder, files]) => ({ id: folder, name: label(folder.split('/').pop()) + (folder.startsWith('BeatLab/') ? ' (BeatLab)' : ''), files }))
    .filter(k => Object.keys(kitRoles(k.files)).length >= 3).sort((a, b) => a.name.localeCompare(b.name));
}

// Which samples in a kit are which drum. A hit's takes (velocity layers, round robins) share a name once
// their numbers and loudness words are taken off.
const ROLES = {
  kick: /kick|\bbd\b|bass ?drum|\bkik/,
  snare: /snare|\bsd\b|\bsnr/,
  clap: /clap|\bcl\b/,
  hat: /(hh|hat|hihat).*(clos|tight|pedal|foot)|closed|hatclosed|\bch\b|^(hip )?hat$|\bhh\b(?!.*open)|chihat/,
  openhat: /open|\boh\b|hatopen|ohihat/,
  rim: /rim|side ?stick|\bstick|cross/,
  shaker: /shak|tamb|cabasa|\begg/,
  conga: /conga|bongo/,
  tom: /\btom/,
  cowbell: /cow ?bell|\bcb\b/,
};
const NOT = { snare: /rim|side|stick|brush|roll|flam|buzz/, hat: /open|\boh\b/, kick: /sub drop/, tom: /roto/ };
const takeName = p => p.split('/').pop().replace(AUDIO, '').toLowerCase().replace(/^(jl|vt|hip|rd|cb)[ _]/, '').replace(/\b(v\d+|rr\d+|#\d+|\d+|soft|medium|hard|subtle|light|loud|ogg)\b/g, ' ').replace(/[_()#-]+/g, ' ').replace(/\s+/g, ' ').trim();
export function kitRoles(files) {
  const groups = new Map();
  for (const p of files) { const k = takeName(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const roles = {};
  for (const [role, re] of Object.entries(ROLES)) {
    const best = [...groups].filter(([k]) => re.test(k) && !NOT[role]?.test(k)).sort((a, b) => b[1].length - a[1].length)[0];
    if (best) roles[role] = best[1];
  }
  return roles;
}

// FL instruments that suit each style, matched against their folders and names. Bass is only swapped
// where a played bass suits the style; trap and drill keep their 808.
export const STYLE_SOUNDS = {
  trap: { chords: /Choir (Ahh|Ooh)|Strings Section|Stage Grand|PAD (Fantasy|Cloud|AirChorus)/i, melody: /Rhodes|Strings Solo|Piano Electric|Woodwind/i },
  drill: { chords: /Strings Section|Choir (Ahh|Ooh)|Orchestral\/Strings/i, melody: /Close Grand|Stage Grand|Strings Solo/i },
  rnb: { chords: /Rhodes|Keyboard\/Electric|Close Grand/i, melody: /Rhodes|Strings Solo|Guitar\/Jazz/i, bass: /Bass\/(Ibanez|Classic 80|Temptated)/i },
  lofi: { chords: /Rhodes|Keyboard\/Electric|Close Grand|Guitar\/Jazz/i, melody: /Guitar\/(Jazz|Piezo)|Rhodes|Woodwind/i, bass: /Bass\/(Acoustic|Classic 80)/i },
  boombap: { chords: /Rhodes|Grand|Guitar\/Jazz|Piano 2/i, melody: /Tenor Sax|Trombone|Brass Section|Strings Solo/i, bass: /Bass\/(Acoustic|Classic 80)/i },
  afro: { chords: /Rhodes|Keyboard\/Electric|Strat|Picked Humb/i, melody: /Strat Pos|Classical Acoustic|Woodwind/i, bass: /Bass\/(Slap|Ibanez|Temptated)/i },
  amapiano: { chords: /Rhodes|Keyboard\/Electric|Grand/i, melody: /Woodwind|Strings Solo|Rhodes/i },
  house: { chords: /Stage Grand|Keyboard\/Grand|Rhodes|Choir/i, melody: /Strings Section|PAD/i },
  reggaeton: { chords: /Grand|Classical Acoustic|Strings Section/i, melody: /Classical Acoustic|Strings Solo|Brass Section/i },
  phonk: { chords: /Choir|Legacy\/Instruments\/Choirs|PAD/i },
  pop: { chords: /Stage Grand|Keyboard\/Grand|Strat|Rhodes/i, melody: /Strings Section|Choir|Piezo/i },
  desi: { chords: /Strings Section|Grand|Choir/i, melody: /Strings Solo|Woodwind|Classical Acoustic/i },
};

// A drum hit's takes from softest to loudest, at most `max` of them spread across the range
export function drumZone(entries, max = 12) {
  const sorted = entries.map(e => ({ path: e.path, level: rms(e.buffer) })).sort((a, b) => a.level - b.level).map(t => t.path);
  const takes = sorted.length <= max ? sorted : Array.from({ length: max }, (_, i) => sorted[Math.round(i * (sorted.length - 1) / (max - 1))]);
  return [{ root: 60, takes }];
}
// Which takes of a kit hit to fetch before their loudness is known: evenly spread through the names
export const spread = (files, max = 12) => (files.length <= max ? files : Array.from({ length: max }, (_, i) => files[Math.round(i * (files.length - 1) / (max - 1))]));

// ---------- notes from names, and pitch by ear ----------
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
// "OSTR C3", "Gz_A#1ogg", "PAD_Fantasy_C3": a note name and octave, as MIDI with C4 = 60 (the folder's own
// octave convention is checked against the pitch detector afterwards)
export function noteFromName(path) {
  const m = path.split('/').pop().replace(AUDIO, '').match(/(?:^|[\s_\-(])([A-Ga-g])([#b]?)(-?[0-8])(?:ogg|OGG)?(?:\(|\)|$|[\s_\-])/);
  if (!m) return null;
  return PC[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (+m[3] + 1) * 12;
}

// Fundamental pitch of a sample as a MIDI number, or null: YIN on a mono, 4x downsampled stretch just after
// the attack. Good from about A0 to C7; the per-folder fit below catches its occasional octave slips.
export function detectPitch(buffer) {
  const sr = buffer.sampleRate / 4, start = Math.floor(buffer.sampleRate * 0.06), N = 2048, ch = [...Array(buffer.numberOfChannels)].map((_, i) => buffer.getChannelData(i));
  if (buffer.length < start + N * 4) return null;
  const x = new Float32Array(N);
  for (let i = 0; i < N; i++) { let s = 0; for (const c of ch) for (let k = 0; k < 4; k++) s += c[start + i * 4 + k]; x[i] = s; }
  const maxLag = Math.min(N / 2, Math.floor(sr / 26)), minLag = Math.max(2, Math.floor(sr / 1400)), d = new Float32Array(maxLag + 1);
  const W = N - maxLag;
  for (let lag = 1; lag <= maxLag; lag++) { let s = 0; for (let i = 0; i < W; i++) { const v = x[i] - x[i + lag]; s += v * v; } d[lag] = s; }
  let run = 0, best = -1;
  for (let lag = 1; lag <= maxLag; lag++) { run += d[lag]; d[lag] = run ? d[lag] * lag / run : 1; }  // cumulative mean normalised difference
  for (let lag = minLag; lag < maxLag; lag++) if (d[lag] < 0.2) { while (lag + 1 < maxLag && d[lag + 1] < d[lag]) lag++; best = lag; break; }
  if (best < 0) { let lo = 1; for (let lag = minLag; lag < maxLag; lag++) if (d[lag] < lo) { lo = d[lag]; best = lag; } if (lo > 0.45) return null; }
  const a = d[best - 1] ?? d[best], b = d[best], c = d[best + 1] ?? d[best], lag = best + Math.max(-0.5, Math.min(0.5, (a - c) / (2 * (a - 2 * b + c) || 1)));  // parabolic peak, kept within its own sample
  return 69 + 12 * Math.log2(sr / lag / 440);
}

const rms = buf => { const c = buf.getChannelData(0); let s = 0; for (let i = 0; i < c.length; i += 8) s += c[i] * c[i]; return Math.sqrt(s / (c.length / 8)); };
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };

// Key zones for a multi-sample folder: entries are [{ path, buffer }]. Each zone is one recorded note with its
// takes from softest to loudest. Names win when they carry notes; otherwise detected pitches, straightened
// along the files' numbering (FL numbers a folder's samples from the lowest note up).
export function buildZones(entries) {
  const named = entries.map(e => noteFromName(e.path)), heard = entries.map(e => detectPitch(e.buffer));
  let roots;
  if (named.filter(n => n != null).length >= entries.length * 0.6) {
    const shift = 12 * Math.round(median(named.map((n, i) => (n != null && heard[i] != null ? heard[i] - n : NaN)).filter(Number.isFinite)) / 12 || 0);
    roots = named.map((n, i) => (n != null ? n + shift : Math.round(heard[i] ?? 60)));
  } else {
    roots = heard.map(h => (h == null ? null : Math.round(h)));
    if (entries.length > 2) {  // a straight line through the numbered notes, so one octave slip can't scramble the keys (FL doesn't always number low to high, so only if most notes sit on it)
      const steps = roots.map((r, i) => (i && r != null && roots[i - 1] != null ? r - roots[i - 1] : NaN)).filter(v => Number.isFinite(v) && v > 0 && v < 13);
      const step = Math.round(median(steps));
      const base = Math.round(median(roots.map((r, i) => (r == null ? NaN : r - step * i)).filter(Number.isFinite)));
      const fits = roots.filter((r, k) => r != null && Math.abs(r - (base + step * k)) <= 1).length;
      if (step > 0 && fits >= roots.length * 0.6) roots = roots.map((r, k) => (r == null || Math.abs(r - (base + step * k)) > 2 ? base + step * k : r));  // only when the numbering really does climb
    }
    roots = roots.map(r => r ?? 60);
  }
  const zones = new Map();
  entries.forEach((e, i) => { if (!zones.has(roots[i])) zones.set(roots[i], []); zones.get(roots[i]).push(e); });
  return [...zones].sort((a, b) => a[0] - b[0]).map(([root, es]) => ({ root, takes: es.map(e => ({ path: e.path, level: rms(e.buffer) })).sort((a, b) => a.level - b.level).map(t => t.path) }));
}
