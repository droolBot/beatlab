// node beatlab/test_instruments.mjs: pitch detection, note names, kit roles and key zones
import assert from 'node:assert/strict';
import { detectPitch, noteFromName, kitRoles, buildZones, PRESETS, unwrapOgg } from './instruments.js';

const sr = 44100;
const tone = (midi, secs = 0.5, harmonics = [1, 0.5, 0.3]) => {  // a decaying harmonic tone, like a plucked note
  const f = 440 * 2 ** ((midi - 69) / 12), data = Float32Array.from({ length: sr * secs }, (_, i) => harmonics.reduce((s, a, k) => s + a * Math.sin(2 * Math.PI * f * (k + 1) * i / sr), 0) * Math.exp(-i / sr * 3));
  return { sampleRate: sr, length: data.length, numberOfChannels: 1, getChannelData: () => data };
};
for (const m of [28, 36, 45, 57, 64, 69, 81, 90]) assert.ok(Math.abs(detectPitch(tone(m)) - m) < 0.35, `pitch ${m} heard as ${detectPitch(tone(m))}`);

assert.equal(noteFromName('Instruments/Orchestral/Strings Section/OSTR C3.wav'), 48);
assert.equal(noteFromName('Legacy/Instruments/Piano/Piano 2/Gz_A#1ogg.wav'), 34);
assert.equal(noteFromName('Legacy/Instruments/Pads/PAD_Fantasy_C3.wav'), 48);
assert.equal(noteFromName('Instruments/Keyboard/Rhodes/Piano Rhodes (3).wav'), null);
assert.equal(noteFromName('Legacy/Instruments/Piano/Piano 1/CHANGPIANOHARD_A#1OGG.WAV'), 34);

const roles = kitRoles(['kick v1 rr1.wav', 'kick v2 rr1.wav', 'snare v1 rr1.wav', 'snare rim v1.wav', 'hatclosed 01 subtle.wav', 'hatopen 01 soft.wav', 'Crash HQ Funk #1.wav', 'VT_BD.wav'].map(f => `Drums/Kits/X/${f}`));
assert.deepEqual(roles.kick.length, 2);
assert.ok(roles.snare.every(p => !/rim/.test(p)) && roles.rim[0].includes('rim'), 'snare and rim kept apart');
assert.ok(roles.hat[0].includes('hatclosed') && roles.openhat[0].includes('hatopen'), 'closed and open hats');

// numbered samples a fifth apart, one of them heard an octave high: the fit puts it back
const notes = [40, 47, 54, 61, 68], entries = notes.map((m, i) => ({ path: `Instruments/Bass/X/X (${i + 1}).wav`, buffer: tone(m) }));
entries[2].buffer = tone(66);
const zones = buildZones(entries);
assert.deepEqual(zones.map(z => z.root), notes);
assert.ok(Object.keys(PRESETS).length > 15);
// an FL-style WAV: an odd-sized chunk, then Ogg pages from two interleaved streams; only stream 1 survives
const bytes = (...xs) => Uint8Array.from(xs.flatMap(x => (typeof x === 'string' ? [...x].map(c => c.charCodeAt(0)) : [...x])));
const le = n => [n & 255, n >> 8 & 255, n >> 16 & 255, n >>> 24];
const page = (serial, body) => bytes('OggS', [0, 0], new Array(8).fill(0), le(serial), le(0), le(0), [1, body.length], body);
const ogg = bytes(page(1, [1, 2, 3]), page(2, [9, 9]), page(1, [4, 5]));
const wav = bytes('RIFF', le(0), 'WAVE', 'LIST', le(3), [7, 7, 7, 0], 'data', le(ogg.length), ogg);
assert.deepEqual([...unwrapOgg(wav)], [...bytes(page(1, [1, 2, 3]), page(1, [4, 5]))]);
const plain = bytes('RIFF', le(0), 'WAVE', 'data', le(2), [5, 5]);
assert.equal(unwrapOgg(plain), plain, 'a plain WAV passes through');
console.log('instruments ok:', zones.map(z => z.root).join(' '));
