// Musical edits the brain can make: the things a producer asks for that change notes, not knobs. Each one
// changes the song in place and returns a short note for the chat. Pure data, so test_edit.mjs checks them all.
import { STEP, BAR, PPQ, chordAt, songScale, chordScale, nearestOf, newTrack, hits, rng, seed, patternOf, trackName } from './music.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const loopT = (song, t) => t % (8 * BAR);  // the harmony is an 8-bar loop
const chordOf = (song, t) => chordAt(song.harmony, loopT(song, t));
const barsOf = (song, pid) => patternOf(song, pid)?.bars ?? 8;
const ladder = (pcs, lo, hi) => { const out = []; for (let n = lo; n <= hi; n++) if (pcs.includes(n % 12)) out.push(n); return out; };
// Every pattern that has drums: a new drum part belongs wherever the beat is playing
const beatPatterns = song => song.patterns.filter(p => song.tracks.some(t => t.kind === 'drum' && (t[p.id] ?? []).length)).map(p => p.id);

// The pattern that plays right before the first clip of a section, for "a pause before the hook"
export function patternBefore(song, name) {
  const clips = song.playlist.clips.filter(c => c.type === 'pattern').sort((a, b) => a.t - b.t);
  const before = clips.filter((c, i) => i > 0 && (patternOf(song, c.pattern)?.name ?? '').toLowerCase().startsWith(name)).map(c => clips[clips.indexOf(c) - 1].pattern);
  return before.find(id => song.tracks.some(t => t.kind === 'drum' && (t[id] ?? []).length)) ?? before[0] ?? null;  // the one with a beat to stop, not a quiet intro
}

// Silence at the end of a pattern: the classic gap before a drop
export function dropout(ts, pid, song, beats = 2) {
  const end = barsOf(song, pid) * BAR, from = end - beats * PPQ;
  for (const t of ts) if (t[pid]) t[pid] = t[pid].filter(n => n.t < from).map(n => (n.t + n.d > from ? { ...n, d: from - n.t } : n));
  return `${beats === 4 ? 'the last bar' : `the last ${beats} beats`} of ${patternOf(song, pid)?.name} drop out`;
}
// Parts stay out until a bar: "drums come in at bar 5"
export function bringIn(ts, pid, song, bar) {
  const from = (clamp(bar, 1, barsOf(song, pid)) - 1) * BAR;
  for (const t of ts) if (t[pid]) t[pid] = t[pid].filter(n => n.t >= from);
  return `in ${patternOf(song, pid)?.name}, they come in at bar ${bar}`;
}

const RHYTHM = {
  offbeat: '..x...x...x...x.', backbeat: '....x.......x...', beat: 'x...x...x...x...', eighths: 'x.x.x.x.x.x.x.x.', sixteenths: 'xxxxxxxxxxxxxxxx',
  syncopated: '...x..x....x..x.', last: '..............x.',
};
const DRUM_ID = { openhat: 'openhat', hat: 'hat', kick: 'kick', snare: 'snare' };
export const DRUM_RHYTHMS = Object.keys(RHYTHM);
function drumChannel(song, sound, name) {
  const id = DRUM_ID[sound], own = id && song.tracks.find(t => t.id === id);
  if (own) return own;
  const had = song.tracks.find(t => t.kind === 'drum' && t.sound === sound && !t.layerOf);
  if (had) return had;
  const t = newTrack('drum', sound, song.tracks.filter(x => x.user && x.kind === 'drum').length + 1);
  t.vol = 0.4;
  if (name) t.name = name;
  song.tracks.push(t);
  return t;
}
// A drum part on a rhythm, in the pattern named or everywhere the beat plays
export function addDrum(song, { sound, rhythm = 'backbeat', pid = null, steps = null }) {
  const t = drumChannel(song, sound), bar = steps ?? RHYTHM[rhythm] ?? RHYTHM.backbeat;
  for (const p of pid ? [pid] : beatPatterns(song)) {
    const notes = [];
    for (let b = 0; b < barsOf(song, p); b++) hits(bar, b * BAR, notes);
    t[p] = notes.map(n => ({ ...n, v: clamp(n.v - 8, 1, 127) }));
  }
  return trackName(t);
}
// Another sound playing the same hits: "layer the snare with a clap"
export function layer(song, src, sound) {
  const t = newTrack('drum', sound, 1);
  t.name = `${trackName(src)} layer`;
  t.layerOf = src.id;
  t.vol = src.vol * 0.6;
  t.pan = src.pan;
  for (const p of song.patterns) if (src[p.id]) t[p.id] = src[p.id].map(n => ({ ...n, v: clamp(n.v - 10, 1, 127) }));
  song.tracks.push(t);
  return trackName(t);
}
// The bass plays with every kick, on the root of the chord there, and rings until the next
export function bassFollowKick(song, bass, kick) {
  for (const p of song.patterns) {
    const starts = [...new Set((kick[p.id] ?? []).filter(n => n.v > 60).map(n => n.t))].sort((a, b) => a - b), old = bass[p.id] ?? [];
    if (!starts.length || !old.length) continue;
    const mid = old.reduce((s, n) => s + n.p, 0) / old.length, end = barsOf(song, p.id) * BAR;
    bass[p.id] = starts.map((t, i) => ({ t, d: Math.min(starts[i + 1] ?? end, t + 2 * BAR) - t, p: nearestOf(mid, [chordOf(song, t).root], Math.round(mid) - 7, Math.round(mid) + 7), v: 110 }));
  }
}
// A second line that answers the melody in its gaps, on chord tones
export function counterMelody(song, melody, sound = 'pluck', s = seed()) {
  const r = rng(s), t = newTrack('melody', sound, 1);
  t.name = 'Counter melody';
  t.vol = Math.min(melody.vol * 0.65, 0.4);
  t.pan = melody.pan > 0 ? -0.25 : 0.25;
  t.rev = 0.3;
  t.dly = 0.2;
  for (const p of song.patterns) {
    const line = [...(melody[p.id] ?? [])].sort((a, b) => a.t - b.t);
    if (!line.length) continue;
    const mid = Math.round(line.reduce((a, n) => a + n.p, 0) / line.length), out = [], end = barsOf(song, p.id) * BAR;
    let prev = mid + 5;
    const gaps = [];
    let at = 0;
    for (const n of line) { if (n.t - at >= 4 * STEP) gaps.push([at, n.t]); at = Math.max(at, n.t + n.d); }
    if (end - at >= 4 * STEP) gaps.push([at, end]);
    if (gaps.length < 3) for (let b = 1; b < barsOf(song, p.id); b += 2) gaps.push([b * BAR + 8 * STEP, b * BAR + 16 * STEP]);  // a busy lead: answers at the end of every second bar
    for (const [a, b] of gaps) {
      const start = Math.ceil((a + STEP) / (2 * STEP)) * 2 * STEP;
      for (let k = start, i = 0; k + 2 * STEP <= b && i < 4; k += (r() < 0.3 ? 4 : 2) * STEP, i++) {
        const c = chordOf(song, k);
        prev = nearestOf(prev + (r() < 0.5 ? 2 : -2), c.pcs, mid - 2, mid + 12);
        out.push({ t: k, d: 2 * STEP, p: prev, v: 74 });
      }
    }
    t[p.id] = out;
  }
  song.tracks.push(t);
  return t;
}
// A new instrument: pads, strings and keys play the chords, anything else doubles the melody an octave up
const PLAYS_CHORDS = new Set(['pad', 'strings', 'organ', 'piano', 'keys', 'guitar', 'vox', 'wave', 'fm', 'synth']);
export function addSound(song, sound, pid = null, s = seed()) {
  const chordy = PLAYS_CHORDS.has(sound), kind = chordy ? 'chords' : 'melody', from = song.tracks.find(t => t.id === (chordy ? 'chords' : 'melody')), t = newTrack(kind, sound, 1);
  if (!from) return null;
  const r = rng(s);
  t.vol = from.vol * 0.7;
  t.rev = chordy ? 0.3 : 0.25;
  t.pan = r() < 0.5 ? -0.2 : 0.2;
  for (const p of pid ? [patternOf(song, pid)] : song.patterns) {
    const notes = from[p.id];
    if (notes?.length) t[p.id] = notes.map(n => ({ ...n, p: chordy ? n.p : Math.min(n.p + 12, 108), v: clamp(n.v - 12, 1, 127) }));
  }
  song.tracks.push(t);
  return t;
}
// A busy part breathes: the weakest notes off the beat go, the ones on the beat and long ones stay
export function thin(ts, pid) {
  for (const t of ts) if (t[pid]) t[pid] = t[pid].filter((n, i) => n.d >= 4 * STEP || Math.round(n.t / STEP) % 4 === 0 || i % 2 === 0 && Math.round(n.t / STEP) % 2 === 0);
}
// A riser in the last bars of a pattern, and an impact where the next section lands
export function riser(song, fx, pid, bars = 2) {
  const t = fx ?? (() => { const n = newTrack('fx', 'fx', 1); n.name = 'Risers and FX'; n.vol = 0.6; n.rev = 0.45; song.tracks.push(n); return n; })();
  const end = barsOf(song, pid) * BAR, len = Math.min(bars, barsOf(song, pid)) * BAR;
  t[pid] = [...(t[pid] ?? []).filter(n => n.p !== 60), { t: end - len, d: len, p: 60, v: 100 }];
  const hook = song.patterns.find(p => p.name === 'Hook' && p.id !== pid);
  if (hook) t[hook.id] = [...(t[hook.id] ?? []).filter(n => !(n.t === 0 && n.p === 61)), { t: 0, d: BAR, p: 61, v: 110 }];
}
// A pattern gets longer or shorter. The notes repeat to fill it, and the playlist makes room.
export function setLength(song, pid, bars) {
  const p = patternOf(song, pid), old = p?.bars ?? 8;
  bars = clamp(Math.round(bars), 1, 64);
  if (!p || bars === old) return false;
  for (const t of song.tracks) {
    const notes = t[pid];
    if (!notes) continue;
    if (bars < old) t[pid] = notes.filter(n => n.t < bars * BAR).map(n => ({ ...n, d: Math.min(n.d, bars * BAR - n.t) }));
    else { const out = []; for (let k = 0; k * old < bars; k++) for (const n of notes) { const at = n.t + k * old * BAR; if (at < bars * BAR) out.push({ ...n, t: at }); } t[pid] = out; }
  }
  p.bars = bars;
  const delta = (bars - old) * BAR, ends = song.playlist.clips.filter(c => c.type === 'pattern' && c.pattern === pid && c.d === old * BAR).map(c => c.t + c.d);
  const shift = t => t + delta * ends.filter(e => e <= t).length;
  for (const c of song.playlist.clips) {
    const stretch = c.type === 'pattern' && c.pattern === pid && c.d === old * BAR;
    c.t = shift(c.t);
    if (stretch) c.d = bars * BAR;
  }
  for (const m of song.markers ?? []) m.t = shift(m.t);
  return true;
}
// One bar plays something else: melodic parts move to other notes in the chord, drums get new hits
export function varyBar(song, ts, pid, bar, s = seed()) {
  const r = rng(s), from = (bar - 1) * BAR, to = bar * BAR, scale = songScale(song);
  let moved = 0;
  for (const t of ts) {
    const notes = t[pid];
    if (!notes) continue;
    if (t.kind === 'drum') {
      const inBar = notes.filter(n => n.t >= from && n.t < to);
      if (!inBar.length) continue;
      const keep = notes.filter(n => n.t < from || n.t >= to), v = inBar[0].v;
      const out = inBar.filter((n, i) => i === 0 || r() > 0.3).map(n => (r() < 0.3 ? { ...n, t: Math.min(to - STEP, n.t + 2 * STEP) } : n));
      for (let k = 0; k < 2; k++) out.push({ t: from + (1 + 2 * Math.floor(r() * 7)) * STEP, d: 8, p: inBar[0].p, v: clamp(v - 25, 1, 127) });
      const seen = new Set();
      t[pid] = [...keep, ...out.filter(n => !seen.has(n.t) && seen.add(n.t))].sort((a, b) => a.t - b.t);
      moved += out.length;
    } else if (t.kind !== 'audio') {
      t[pid] = notes.map(n => {
        if (n.t < from || n.t >= to) return n;
        const c = chordOf(song, n.t), l = ladder(chordScale(c.pcs, scale), n.p - 7, n.p + 7), at = l.indexOf(nearestOf(n.p, l.map(x => x % 12), n.p - 7, n.p + 7));
        moved++;
        return { ...n, p: l[clamp(at + [-3, -2, 2, 3, 4][Math.floor(r() * 5)], 0, l.length - 1)] };
      });
    }
  }
  return moved;
}
// A line's shape: "goes up at the end", "falls at the end", "higher", "lower"
export function shapeLine(song, t, pid, shape) {
  const notes = t[pid];
  if (!notes?.length) return;
  if (shape === 'higher' || shape === 'lower') { t[pid] = notes.map(n => ({ ...n, p: clamp(n.p + (shape === 'higher' ? 12 : -12), 12, 115) })); return; }
  const dir = shape === 'up' ? 1 : -1, end = barsOf(song, pid) * BAR, scale = songScale(song);
  const last = notes.filter(n => n.t >= end - 2 * BAR).sort((a, b) => a.t - b.t);
  let p = null;
  for (const n of last) {
    const l = ladder(chordScale(chordOf(song, n.t).pcs, scale), 40, 100);
    p = p == null ? n.p : l[clamp(l.findIndex(x => x >= p) + dir * (dir > 0 && l.includes(p) ? 1 : dir > 0 ? 0 : 1), 0, l.length - 1)];
    n.p = p;
  }
}
// The hook lifts above the rest: the melody doubled an octave up, a fuller top on the chords, open hats on the offbeat
export function lift(song, pid) {
  for (const t of song.tracks) {
    const notes = t[pid];
    if (!notes?.length) continue;
    if (t.kind === 'melody' && t.id === 'melody') t[pid] = [...notes, ...notes.map(n => ({ ...n, p: Math.min(n.p + 12, 108), v: clamp(n.v - 28, 1, 127), lift: 1 }))];
    if (t.kind === 'chords') {
      const top = Math.max(...notes.map(n => n.p)), tops = notes.filter(n => n.p >= top - 2);
      t[pid] = [...notes, ...tops.map(n => ({ ...n, p: Math.min(n.p + 12, 108), v: clamp(n.v - 20, 1, 127), lift: 1 }))];
    }
  }
  const hats = drumChannel(song, 'openhat');
  if (!(hats[pid] ?? []).length) { const out = []; for (let b = 0; b < barsOf(song, pid); b++) hits(RHYTHM.offbeat, b * BAR, out); hats[pid] = out.map(n => ({ ...n, v: 64 })); }
  return `${patternOf(song, pid)?.name} lifted`;
}
// Notes written out by name: what a language model hands over. Bars and beats count from 1.
export function writeNotes(song, t, pid, list, { replace = true } = {}) {
  const bars = barsOf(song, pid), kept = [];
  for (const n of Array.isArray(list) ? list : []) {
    const bar = +n.bar, beat = +(n.beat ?? 1), len = +(n.len ?? 1), p = +n.pitch;
    if (!(bar >= 1 && bar <= bars && beat >= 1 && beat < 5 && len > 0 && len <= 16 && p >= 12 && p <= 115)) continue;
    const at = Math.round(((bar - 1) * 4 + beat - 1) * PPQ / (STEP / 2)) * (STEP / 2);
    kept.push({ t: at, d: Math.min(Math.max(STEP / 2, Math.round(len * PPQ)), bars * BAR - at), p: Math.round(p), v: clamp(Math.round(+(n.vel ?? 90)), 1, 127) });
  }
  if (!kept.length) return 0;
  t[pid] = replace ? kept : [...(t[pid] ?? []), ...kept];
  return kept.length;
}
// A drum part from step strings, one bar each, repeating: "x...x...x...x..."
export function writeSteps(song, t, pid, bars) {
  const list = (Array.isArray(bars) ? bars : [bars]).map(s => String(s).padEnd(16, '.').slice(0, 16)), out = [];
  for (let b = 0; b < barsOf(song, pid); b++) hits(list[b % list.length], b * BAR, out);
  t[pid] = out;
  return out.length;
}
