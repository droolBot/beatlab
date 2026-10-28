// Run: node beatlab/test_music.mjs
import assert from 'node:assert/strict';
import { STYLES, BAR, generate, arrange, regenerate, transpose, changeMode, suggestStyles, pickKit, notesFor, songLength, patternOf, upgrade } from './music.js';

const seeds = { chords: 1, drums: 2, bass: 3, melody: 4 };
const hookOf = song => song.patterns.find(p => p.name === 'Hook').id;
for (const style of Object.keys(STYLES)) {
  for (const mode of ['minor', 'major']) {
    for (const energy of [0, 0.5, 1]) {
      const opts = { style, bpm: 100, root: 4, mode, energy, complexity: energy, seeds };
      const song = generate(opts);
      assert.deepEqual(song, generate(opts), `${style}: same seeds give the same beat`);
      assert.deepEqual(song.patterns.map(p => p.name), ['Intro', 'Hook', 'Verse', 'Verse 2', 'Bridge', 'Outro'], `${style}: the beat arrives as named patterns`);
      assert.equal(song.playlist.clips.length, 8, `${style}: eight pattern clips on the playlist`);
      assert(notesFor(song.tracks.find(t => t.id === 'melody'), hookOf(song)).length >= 4, `${style}: the hook has a melody`);
      for (const view of [...song.patterns.map(p => p.id), 'song']) {
        const { events, length } = arrange(song, view);
        assert.equal(length, view === 'song' ? songLength(song) : patternOf(song, view).bars * BAR);
        for (const { track, notes } of events) {
          const busyUntil = {};
          for (const n of notes) {
            const where = `${style}/${mode}/${view}/${track.id} note ${n.p} at ${n.t}`;
            assert(Number.isFinite(n.t) && n.t >= 0 && n.d >= 1 && n.t < length, where);
            assert(n.p >= 0 && n.p <= 127 && n.v >= 1 && n.v <= 127, where);
            assert(!(busyUntil[n.p] > n.t + 1e-6), `${where} overlaps the previous one`);  // FL needs clean note-offs
            busyUntil[n.p] = n.t + n.d;
          }
        }
      }
      const fx = arrange(song, 'song').events.find(e => e.track.id === 'fx').notes;
      assert(fx.some(n => n.p === 60) && fx.some(n => n.p === 61), `${style}: risers and impacts around hooks`);
    }
  }
}

const song = generate({ style: 'rnb', bpm: 87, root: 4, mode: 'minor', seeds }), hook = hookOf(song);
const melody = t => notesFor(t.tracks.find(x => x.id === 'melody'), hook);
assert.equal(songLength(song), 52 * BAR, '52 bars, as the section plan says');
assert.equal(notesFor(song.tracks.find(t => t.id === 'melody'), song.patterns.find(p => p.name === 'Verse').id).length, 0, 'the verse leaves room for vocals');
assert.deepEqual(melody(regenerate(song, 'drums')), melody(song), 'new drums keep the melody');
assert.notDeepEqual(notesFor(regenerate(song, 'drums').tracks.find(t => t.id === 'kick'), hook), notesFor(song.tracks.find(t => t.id === 'kick'), hook), 'new drums change the kick');
assert.deepEqual(melody(transpose(structuredClone(song), 6)).map(n => n.p), melody(song).map(n => n.p + 2), 'E to F# moves up 2');
assert.notDeepEqual(changeMode(song, 'major').harmony.map(c => c.name), song.harmony.map(c => c.name), 'major key gets new chords');
assert.equal(suggestStyles([87.25, 175, 70.75], 'minor', 'R&B/Soul')[0].id, 'rnb');
assert.equal(suggestStyles([140, 70, 93], 'minor', 'Hip-Hop/Rap')[0].bpm, 140);

// the playlist behaves like FL's: clips can go anywhere, shorter clips cut their pattern, muted rows are silent
const s2 = structuredClone(song), kickHook = notesFor(s2.tracks.find(t => t.id === 'kick'), hook).length;
s2.playlist.clips = [{ id: 'a', type: 'pattern', pattern: hook, row: 0, t: 60 * BAR, d: 8 * BAR }];
assert.equal(songLength(s2), 68 * BAR, 'the song ends where the last clip does');
assert.equal(arrange(s2, 'song').events.find(e => e.track.id === 'kick').notes.length, kickHook, 'a clip plays its whole pattern');
s2.playlist.clips[0].d = 2 * BAR;
assert(arrange(s2, 'song').events.find(e => e.track.id === 'kick').notes.every(n => n.t < 62 * BAR), 'a shorter clip cuts its pattern off');
s2.playlist.rows[0].mute = true;
assert.equal(arrange(s2, 'song').events.find(e => e.track.id === 'kick').notes.length, 0, 'a muted playlist track is silent');
assert.equal(upgrade(song), song, 'a current song needs no upgrade');

const groove = { kick: ['x.......x.......'], snare: ['....x.......x...'] };
const grooved = generate({ style: 'trap', bpm: 140, root: 0, mode: 'minor', seeds, groove });
assert.deepEqual(notesFor(grooved.tracks.find(t => t.id === 'kick'), hookOf(grooved)).filter(n => n.t < BAR).map(n => Math.round(n.t / 24)), [0, 8], 'copied groove drives the kick');

const library = ['Drums/Kicks/909 Kick.wav', 'Drums/Hats/808 CH.wav', 'Drums/Hats/808 OH.wav', 'Drums/Percussion/909 Clap.wav', 'Instruments/Keyboard/Rhodes/Piano Rhodes (1).wav'];
assert.deepEqual(pickKit(grooved, library), { kick: library[0], snare: library[3], hat: library[1], openhat: library[2] }, 'trap kit from FL samples');
console.log('music engine ok:', Object.keys(STYLES).length, 'styles,', song.patterns.length, 'patterns,', songLength(song) / BAR, 'bar song,', song.harmony.map(c => c.name).join(' '));
