// node beatlab/test_edit.mjs: the musical edits change the notes they should, and nothing else
import assert from 'node:assert/strict';
import { generate, setProgression, regenerate, BAR, STEP, chordAt, songScale, patternOf, songLength } from './music.js';
import { dropout, bringIn, addDrum, layer, bassFollowKick, counterMelody, riser, setLength, varyBar, shapeLine, lift, writeNotes, writeSteps, patternBefore } from './edit.js';

const fresh = (style = 'trap') => generate({ style, bpm: 140, root: 9, mode: 'minor', seeds: { chords: 1, drums: 2, bass: 3, melody: 4 } });
const hookOf = s => s.patterns.find(p => p.name === 'Hook').id, tr = (s, id) => s.tracks.find(t => t.id === id);

{ // a gap before the drop
  const s = fresh(), h = hookOf(s), ts = [tr(s, 'kick'), tr(s, 'bass')];
  dropout(ts, h, s, 4);
  for (const t of ts) assert(t[h].every(n => n.t + n.d <= 7 * BAR), `${t.id} still plays in the last bar`);
  assert(tr(s, 'chords')[h].some(n => n.t + n.d > 7 * BAR), 'chords were left alone');
}
{ // drums come in at bar 5
  const s = fresh(), h = hookOf(s), ts = [tr(s, 'kick'), tr(s, 'snare')];
  bringIn(ts, h, s, 5);
  for (const t of ts) assert(t[h].every(n => n.t >= 4 * BAR) && t[h].length, t.id);
}
{ // new drum parts, on a rhythm, wherever the beat plays
  const s = fresh(), h = hookOf(s), n = s.tracks.length;
  addDrum(s, { sound: 'shaker', rhythm: 'eighths' });
  const t = s.tracks.at(-1);
  assert.equal(s.tracks.length, n + 1);
  assert.equal(t[h].length, 8 * 8);
  addDrum(s, { sound: 'openhat', rhythm: 'offbeat' });
  assert.equal(s.tracks.length, n + 1, 'the open hat channel already exists');
  assert(tr(s, 'openhat')[h].every(x => (x.t / STEP) % 4 === 2));
}
{ // a layer plays the same hits
  const s = fresh(), h = hookOf(s), sn = tr(s, 'snare');
  layer(s, sn, 'clap');
  assert.deepEqual(s.tracks.at(-1)[h].map(n => n.t), sn[h].map(n => n.t));
}
{ // the 808 lands with the kick, on the chord's root
  const s = fresh(), h = hookOf(s), k = tr(s, 'kick'), b = tr(s, 'bass');
  bassFollowKick(s, b, k);
  assert.deepEqual(b[h].map(n => n.t), [...new Set(k[h].filter(n => n.v > 60).map(n => n.t))].sort((x, y) => x - y));
  for (const n of b[h]) assert.equal(n.p % 12, chordAt(s.harmony, n.t % (8 * BAR)).root);
}
{ // the counter melody answers in the gaps, in key
  const s = fresh(), h = hookOf(s), m = tr(s, 'melody'), c = counterMelody(s, m, 'pluck', 7);
  assert(c[h].length > 4, 'it wrote something');
  const scale = songScale(s);
  for (const n of c[h]) assert(chordAt(s.harmony, n.t % (8 * BAR)).pcs.includes(n.p % 12) || scale.includes(n.p % 12));
}
{ // a riser ends where the pattern does
  const s = fresh(), v = patternBefore(s, 'hook');
  assert(v, 'something plays before the hook');
  riser(s, tr(s, 'fx'), v);
  const n = tr(s, 'fx')[v].find(x => x.p === 60);
  assert.equal(n.t + n.d, patternOf(s, v).bars * BAR);
}
{ // a longer hook repeats its notes and the playlist makes room
  const s = fresh(), h = hookOf(s), len = songLength(s), count = tr(s, 'kick')[h].length, hooks = s.playlist.clips.filter(c => c.pattern === h).length;
  setLength(s, h, 16);
  assert.equal(patternOf(s, h).bars, 16);
  assert.equal(tr(s, 'kick')[h].length, count * 2);
  assert.equal(songLength(s), len + hooks * 8 * BAR);
  const clips = s.playlist.clips.filter(c => c.type === 'pattern').sort((a, b) => a.t - b.t);
  clips.slice(1).forEach((c, i) => assert(c.t >= clips[i].t + clips[i].d, 'clips never overlap'));
  setLength(s, h, 4);
  assert(tr(s, 'kick')[h].every(n => n.t < 4 * BAR));
}
{ // only the bar you named changes
  const s = fresh(), h = hookOf(s), m = tr(s, 'melody'), before = structuredClone(m[h]);
  assert(varyBar(s, [m], h, 2, 5) > 0);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  assert(same(m[h].filter(n => n.t < BAR || n.t >= 2 * BAR), before.filter(n => n.t < BAR || n.t >= 2 * BAR)), 'other bars stay');
  assert(!same(m[h].filter(n => n.t >= BAR && n.t < 2 * BAR), before.filter(n => n.t >= BAR && n.t < 2 * BAR)), 'that bar changed');
}
{ // a line that climbs at the end
  const s = fresh(), h = hookOf(s), m = tr(s, 'melody');
  shapeLine(s, m, h, 'up');
  const last = m[h].filter(n => n.t >= 6 * BAR).sort((a, b) => a.t - b.t);
  assert(last.length >= 2);
  last.slice(1).forEach((n, i) => assert(n.p >= last[i].p, `${n.p} after ${last[i].p}`));
  assert(last.at(-1).p > last[0].p);
}
{ // the hook gets bigger
  const s = fresh(), h = hookOf(s), a = tr(s, 'melody')[h].length, c = tr(s, 'chords')[h].length;
  lift(s, h);
  assert.equal(tr(s, 'melody')[h].length, a * 2);
  assert(tr(s, 'chords')[h].length > c);
  assert(tr(s, 'openhat')[h].length > 0);
}
{ // a language model's notes: bad ones are dropped, good ones land on the grid
  const s = fresh(), h = hookOf(s), m = tr(s, 'melody');
  assert.equal(writeNotes(s, m, h, [{ bar: 1, beat: 1, len: 1, pitch: 69 }, { bar: 2, beat: 3.5, len: 0.5, pitch: 72, vel: 100 }, { bar: 99, beat: 1, pitch: 60 }, { bar: 1, beat: 1, pitch: 900 }, 'junk']), 2);
  assert.deepEqual(m[h][1], { t: BAR + 10 * STEP, d: 2 * STEP, p: 72, v: 100 });
  assert.equal(writeNotes(s, m, h, []), 0);
  assert.equal(m[h].length, 2, 'nothing valid leaves the part alone');
  assert.equal(writeSteps(s, tr(s, 'kick'), h, ['x...x...x...x...']), 32);
}
{ // a named progression re-fits the chords, bass and melody
  const a = setProgression(fresh(), { degrees: [1, 6, 4, 5] }), h = hookOf(a);
  assert.deepEqual(a.harmony.slice(0, 4).map(c => c.name), ['Am', 'F', 'Dm', 'Em']);
  assert(a.harmony.every(c => c.t < 8 * BAR));
  assert.equal(tr(a, 'bass')[h][0].p % 12, 9, 'the bass starts on the new first chord');
  const b = setProgression(fresh(), { names: ['Cmaj7', 'Am7', 'Dm7', 'G7'] });
  assert.deepEqual(b.harmony.slice(0, 4).map(c => c.name), ['Cmaj7', 'Am7', 'Dm7', 'G7']);
  const c = regenerate(a, 'chords');
  assert.equal(c.prog, null, 'new chords forget the named progression');
  const same = setProgression(fresh(), { names: ['nonsense'] });
  assert(same.harmony.length, 'a bad name changes nothing');
}
console.log('edits ok: gaps, entries, drum parts, layers, 808 on the kick, counter melody, risers, lengths, bars, shapes, lifts, written notes, progressions');
