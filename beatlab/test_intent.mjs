// node beatlab/test_intent.mjs: what the brain understands from typed requests
import assert from 'node:assert/strict';
import { plan, describe, fromModel } from './intent.js';

const ctx = {
  tracks: [],
  styles: [['trap', 'Trap'], ['drill', 'Drill'], ['rnb', 'R&B'], ['lofi', 'Lofi'], ['boombap', 'Boom bap'], ['afro', 'Afrobeats'], ['amapiano', 'Amapiano'], ['house', 'House'], ['reggaeton', 'Reggaeton'], ['phonk', 'Phonk'], ['pop', 'Pop'], ['desi', 'Desi hip-hop']].map(([id, name]) => ({ id, name })),
  effects: [['eq', 'EQ'], ['filter', 'Filter'], ['comp', 'Compressor'], ['reverb', 'Reverb'], ['delay', 'Delay'], ['drive', 'Drive'], ['tape', 'Tape'], ['gate', 'Gate'], ['peq', 'Parametric EQ'], ['width', 'Stereo width']].map(([id, name]) => ({ id, name })),
  instruments: ['Rhodes', 'Close Grand', 'Strings Section', 'Choir Ahh', 'Classic 80', 'Jazz'],
  kits: ['HQ Funk Kit', 'Groove Bias', 'Rock'],
};
const types = s => plan(s, ctx).map(x => x.type);
const one = s => { const p = plan(s, ctx); assert.equal(p.length, 1, `${s} -> ${JSON.stringify(p)}`); return p[0]; };
const cases = [
  ['make a trap beat at 145', 'make'], ['make me a lofi beat', 'make'], ['cook up some r&b', 'make'], ['new boom bap beat', 'make'],
  ['tempo 140', 'tempo'], ['set it to 92 bpm', 'tempo'], ['make it faster', 'tempoBy'], ['slow it down by 10', 'tempoBy'], ['double time', 'tempoTimes'],
  ['key of G minor', 'key'], ['in F# major', 'key'], ['make it minor', 'key'], ['transpose up 2', 'transpose'], ['up an octave', 'transpose'],
  ['swing 30%', 'swing'], ['more swing', 'swingBy'], ['no swing', 'swingBy'],
  ['humanize the drums', 'ai'], ['make the drums feel human', 'ai'], ['add a fill', 'ai'], ['vary the melody', 'ai'], ['switch up the drums', 'ai'],
  ['add 808 slides every 4 bars', 'slides'], ['808 glides', 'slides'], ['add hat rolls every 2 bars', 'hatRolls'],
  ['auto mix', 'automix'], ['check my mix', 'doctor'], ['whats wrong with the beat', 'doctor'], ['how does my mix sound', 'doctor'], ['balance the mix', 'automix'], ['export an mp3', 'export'],
  ['new melody', 'regen'], ['different chords', 'regen'], ['change the bassline', 'regen'], ['ai melody', 'ai'], ['ai drums', 'ai'],
  ['busier drums', 'energy'], ['make it more minimal', 'energy'],
  ['mute the hats', 'mute'], ['solo the 808', 'solo'], ['pan the hats left', 'pan'],
  ['louder kick', 'vol'], ['turn the chords down 4 db', 'vol'], ['more 808', 'vol'], ['less melody', 'vol'],
  ['add reverb to the snare', 'fx'], ['put a gate on the chords', 'fx'], ['remove the reverb from the snare', 'unfx'],
  ['use the HQ Funk kit', 'kit'], ['use rhodes on the chords', 'instrument'], ['strings section on the melody', 'instrument'],
  ['make the chords darker', 'tone'], ['brighter hats', 'tone'], ['make the 808 grittier', 'tone'], ['make it warmer', 'tone'], ['more reverb on the melody', 'tone'],
  ['play', 'play'], ['stop', 'stop'], ['half time', 'tempoTimes'],
  ['half-time the hats', 'fx'], ['stutter the drums on the last beat', 'fx'], ['tape stop at the end of every 4 bars', 'fx'], ['reverse the snare every 2nd bar', 'fx'],
  ['autotune the vocals', 'fx'], ['hard autotune on my voice', 'fx'], ['pitch the chords up an octave', 'fx'], ['punchier kick', 'fx'], ['shorter tail on the snare', 'fx'],
];
for (const [s, type] of cases) assert.equal(one(s).type, type, `"${s}" -> ${JSON.stringify(plan(s, ctx))}`);

// details
assert.deepEqual(one('make a trap beat at 145'), { type: 'make', style: 'trap', bpm: 145 });
assert.equal(one('cook up some r&b').style, 'rnb');
assert.deepEqual(one('key of G minor'), { type: 'key', root: 7, mode: 'minor' });
assert.equal(one('in F# major').root, 6);
assert.equal(one('add 808 slides every 4 bars').every, 4);
assert.equal(one('slow it down by 10').delta, -10);
assert.deepEqual(one('turn the chords down 4 db'), { type: 'vol', parts: ['chords'], dB: -4 });
assert.deepEqual(one('make the chords darker').parts, ['chords']);
assert.equal(one('make the hook darker').section, 'hook');
assert.equal(one('put a gate on the chords').fx, 'gate');
assert.equal(one('add a parametric eq to the melody').fx, 'peq');
assert.equal(one('use rhodes on the chords').name, 'Rhodes');
assert.equal(one('mute the open hats').parts.join(), 'openhat');
assert.equal(one('ai melody').what, 'melody');
assert.equal(one('new ai melody').type, 'ai');

// several at once, and "them" carrying the last part forward
assert.deepEqual(types('make the hook darker, add 808 slides every 4 bars and humanize the drums'), ['tone', 'slides', 'ai']);
assert.deepEqual(types('turn up the kick and the snare by 2 db then add a fill'), ['vol', 'ai']);
assert.deepEqual(plan('mute the hats and then unmute them', ctx).map(x => x.parts.join()), ['hat', 'hat']);
assert.deepEqual(types('tempo 150, key of D minor, play'), ['tempo', 'key', 'play']);
assert.equal(types('do a backflip')[0], 'unknown');
assert.deepEqual(plan('turn up the kick and the snare by 2 db', ctx)[0], { type: 'vol', parts: ['kick', 'snare'], dB: 2 });
assert.ok(describe(plan('make the hook darker', ctx)[0], { chords: 'Chords', melody: 'Melody', arp: 'Arp' }).startsWith('Make Chords, Melody and Arp darker'));
const ht = one('half-time the hats'), ts = one('tape stop at the end of every 4 bars'), st = one('stutter the hats on the last beat in 16ths');
assert.deepEqual([ht.fx, ht.set, ht.parts], ['warp', { mode: 0, when: 1 }, ['hat']]);
assert.deepEqual([ts.set, ts.parts], [{ mode: 3, when: 3 }, ['mix']]);
assert.deepEqual(st.set, { mode: 2, when: 2 });
assert.deepEqual([one('hard autotune on my voice').set, one('autotune the vocals').parts], [{ speed: 0 }, ['vocals']]);
assert.deepEqual(one('pitch the chords down 5').set, { semis: -5 });
assert.equal(describe(ht, { warp: 'Time warp', hat: 'Hats' }), 'Add Time warp (half-time, every 2nd bar) to Hats');
// the smart brain's reply, however it's dressed, becomes steps the rules carry out
const reply = ['Sure! Here are the commands:', '1. busier drums', '- more swing', '* "louder kick by 2 db"', '4) make the 808 grittier.'].join('\n');
assert.equal(fromModel(reply), 'busier drums, more swing, louder kick by 2 db, make the 808 grittier');
assert.deepEqual(types(fromModel(reply)), ['energy', 'swingBy', 'vol', 'tone']);
console.log(`intent ok: ${cases.length} phrasings`);
