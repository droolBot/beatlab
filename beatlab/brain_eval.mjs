// node beatlab/brain_eval.mjs: how much of what producers actually type the brain understands.
// Each line is a request and the step types it should become (in any order). Run with -v to see misses.
import { plan, describe, IDEAS, checkSteps, parseReply } from './intent.js';

export const CASES = [
  // making beats, every way people ask
  ['make a beat', 'make'], ['make beat', 'make'], ['trap beat pls', 'make'], ['can u make a lofi beat', 'make'], ['give me a dark drill beat 140', 'make'],
  ['cook up something hard', 'make'], ['i want a sad beat', 'make'], ['make a chill beat', 'make'], ['make something like travis scott', 'make'], ['new beat', 'make'],
  ['make an rnb beat at 90', 'make'], ['drill type beat', 'make'], ['make me a boom bap beat', 'make'], ['afro beat', 'make'], ['make a house track', 'make'],
  ['make a hard trap beat with 808 slides', 'make slides'], ['start a new trap beat', 'make'], ['generate a beat', 'make'], ['make a phonk beat', 'make'], ['make a beat like drake', 'make'],
  // tempo
  ['140 bpm', 'tempo'], ['set bpm to 150', 'tempo'], ['make it faster', 'tempoBy'], ['slower', 'tempoBy'], ['speed it up a bit', 'tempoBy'], ['too slow', 'tempoBy'], ['too fast', 'tempoBy'],
  ['make it 5 bpm faster', 'tempoBy'], ['double time', 'tempoTimes'], ['half time', 'tempoTimes'], ['tempo to 92', 'tempo'], ['bpm 128', 'tempo'],
  // key and mood
  ['change the key to c minor', 'key'], ['make it sad', 'key'], ['make it happier', 'key'], ['put it in a minor', 'key'], ['switch to major', 'key'], ['transpose down 2', 'transpose'],
  ['move everything up an octave', 'transpose'], ['make it darker', 'tone'], ['brighter', 'tone'], ['make the chords darker', 'tone'], ['more emotional', 'key'], ['make it sound evil', 'key'],
  // drums
  ['make the drums hit harder', 'fx'], ['the kick is too quiet', 'vol'], ['kick louder', 'vol'], ['turn the snare down', 'vol'], ['drums too loud', 'vol'], ['more punch on the kick', 'fx'],
  ['punchier drums', 'fx'], ['busier drums', 'energy'], ['less hats', 'vol'], ['remove the hats', 'mute'], ['mute the hats', 'mute'], ['add hi hat rolls', 'hatRolls'],
  ['hat rolls every 2 bars', 'hatRolls'], ['add triplets on the hats', 'hatRolls'], ['make the hats faster', 'hatRolls'], ['simpler drums', 'energy'], ['the drums are boring', 'ai'],
  ['switch up the drums', 'ai'], ['new drums', 'regen'], ['change the drum pattern', 'regen'], ['add a drum fill', 'ai'], ['humanize the drums', 'ai'], ['make the drums sound human', 'ai'],
  ['add swing', 'swingBy'], ['make it bounce', 'swingBy'], ['more groove', 'swingBy'], ['no swing', 'swingBy'], ['swing 25%', 'swing'], ['make the snare crack', 'fx'],
  // 808 and bass
  ['add 808 slides', 'slides'], ['make the 808 slide more', 'slides'], ['808 glides every 4 bars', 'slides'], ['turn up the 808', 'vol'], ['808 louder', 'vol'], ['bass louder', 'vol'],
  ['the 808 is too loud', 'vol'], ['make the 808 dirty', 'tone'], ['distort the 808', 'tone'], ['new bassline', 'regen'], ['change the 808 pattern', 'regen'], ['808 not hitting', 'vol'],
  ['the bass is muddy', 'doctor'], ['less bass', 'vol'], ['mute the 808', 'mute'], ['solo the 808', 'solo'],
  // chords and melody
  ['new melody', 'regen'], ['change the melody its trash', 'regen'], ['different chords', 'regen'], ['rewrite the chords', 'regen'], ['give me a better melody', 'regen'], ['ai melody', 'ai'],
  ['vary the melody', 'ai'], ['make the melody louder', 'vol'], ['lower the melody', 'vol'], ['melody too loud', 'vol'], ['make the melody a flute', 'sound'], ['use a piano for the chords', 'sound'],
  ['change the chords to strings', 'sound'], ['put a bell melody', 'sound'], ['make the lead a synth', 'sound'], ['add reverb to the melody', 'fx'], ['more reverb on the chords', 'tone'],
  ['the melody is too bright', 'tone'], ['make the chords warmer', 'tone'], ['pan the chords right', 'pan'], ['pan the melody left', 'pan'], ['mute the melody', 'mute'], ['remove the melody', 'mute'],
  ['hum a melody', 'hum'], ['let me sing the hook', 'hum'], ['make the melody sadder', 'key'],
  // effects and mix
  ['add reverb to the snare', 'fx'], ['echo on the snare', 'tone'], ['add delay to the melody', 'fx'], ['put a filter on the chords', 'fx'], ['add a compressor to the drums', 'fx'], ['make it wider', 'tone'],
  ['make it mono', 'tone'], ['half-time the hats', 'fx'], ['tape stop at the end', 'fx'], ['stutter the drums', 'fx'], ['autotune the vocals', 'fx'], ['pitch the chords up an octave', 'fx'],
  ['add vinyl', 'mute'], ['remove the vinyl', 'mute'], ['make it sound old', 'tone'], ['lofi it', 'tone'], ['make it dusty', 'tone'], ['saturate the drums', 'tone'],
  ['remove the reverb from the snare', 'unfx'], ['take the effects off the 808', 'unfx'], ['mix it', 'automix'], ['balance the mix', 'automix'], ['fix the mix', 'automix'], ['check my mix', 'doctor'],
  ['make it sound professional', 'doctor'], ['make it sound better', 'doctor'], ['why does it sound muddy', 'doctor'], ['is my mix good', 'doctor'], ['it sounds muddy', 'doctor'], ['master it', 'automix'],
  ['make it louder', 'vol'], ['turn everything down', 'vol'],
  // song and arrangement
  ['turn this into a full song', 'agent'], ['make it a whole song', 'agent'], ['arrange the beat', 'agent'], ['finish the song', 'agent'], ['build a song from this loop', 'agent'],
  ['it sounds empty', 'energy'], ['it sounds boring', 'ai'], ['add more stuff', 'energy'], ['too much going on', 'energy'], ['make it more minimal', 'energy'], ['add some energy', 'energy'],
  // transport and files
  ['play', 'play'], ['play it', 'play'], ['stop', 'stop'], ['pause', 'stop'], ['export', 'export'], ['export an mp3', 'export'], ['save as wav', 'export'], ['bounce it', 'export'], ['export the stems', 'export'],
  // typos and run-ons
  ['mak a trap beat', 'make'], ['ad reverb to the snare', 'fx'], ['louder kik', 'vol'], ['mute the hihats', 'mute'], ['add hihat rolls', 'hatRolls'], ['chnage the melody', 'regen'],
  ['make it faster and add 808 slides', 'tempoBy slides'], ['mute the hats then make the kick louder', 'mute vol'], ['darker chords and more swing', 'tone swingBy'],
  // found by asking it things it was never tuned on
  ['change to f minor', 'key'], ['i dont like the chords', 'regen'], ['fix my mix', 'automix'], ['make it sound mixed and mastered', 'automix'], ['sidechain the 808 to the kick', 'duck'],
  // real musical requests: these change notes
  ['write a melody that goes up at the end', 'regen shape'], ['make the second bar different', 'varyBar'], ['put a pause before the drop', 'dropout'], ['drop everything out for one bar', 'dropout'], ['make the hook bigger than the verse', 'lift'],
  ['layer the snare with a clap', 'layer'], ['add a counter melody', 'counter'], ['add an open hat on the offbeat', 'addDrum'], ['add a shaker', 'addDrum'], ['make the 808 follow the kick', 'bassFollow'], ['use a 1 6 4 5 progression', 'progression'],
  ['chords am f c g', 'progression'], ['i vi iv v progression', 'progression'], ['make the chords jazzier', 'chordFlavor'], ['add a riser before the hook', 'riser'], ['start with just the melody', 'bringIn'], ['drums come in at bar 5', 'bringIn'],
  ['give me a dark piano melody in a minor', 'key sound regen tone'], ['double the hook', 'length'], ['make a 16 bar loop', 'length'], ['four on the floor kick', 'addDrum'],
  // feelings become several changes
  ['make it sound like a late night drive', 'key tone swingBy'], ['more bounce less clutter', 'swingBy energy'], ['i want it to feel expensive', 'sound tone vol'], ['its not hard enough', 'energy fx tone vol'], ['needs more movement', 'ai hatRolls'],
  ['sounds too clean', 'tone mute ai'], ['give it some air', 'tone'], ['make it hit in the car', 'vol duck fx'], ['sounds like a ringtone', 'sound tone vol'], ['less cheesy', 'sound tone vol'], ['make it darker but keep the tempo', 'tone'], ['this slaps but the drums feel off', 'doctor'],
  // questions get answers, not edits
  ['why does my kick sound weak', 'ask'], ['what should i add next', 'ask'], ['how do i make a good 808', 'ask'], ['whats a good bpm for drill', 'ask'], ['is this in key', 'ask'], ['which chord is playing in bar 3', 'ask'],
  ['make the chords pump', 'duck'], ['quantize the piano roll', 'unknown'], ['the 808 isnt hitting', 'vol'], ['kick doesnt knock', 'fx'], ['the vocals dont cut through', 'vol'], ['duck the bass under the kick', 'duck'], ['chords feel cheap', 'doctor'], ['the hats are annoying', 'doctor'], ['switch the chords to a piano', 'sound'],
];

const ctx = {
  tracks: [], instruments: ['Rhodes', 'Close Grand', 'Strings Section', 'Choir Ahh'], kits: ['HQ Funk Kit'],
  styles: [['trap', 'Trap'], ['drill', 'Drill'], ['rnb', 'R&B'], ['lofi', 'Lofi'], ['boombap', 'Boom bap'], ['afro', 'Afrobeats'], ['amapiano', 'Amapiano'], ['house', 'House'], ['reggaeton', 'Reggaeton'], ['phonk', 'Phonk'], ['pop', 'Pop'], ['desi', 'Desi hip-hop']].map(([id, name]) => ({ id, name })),
  effects: [['eq', 'EQ'], ['filter', 'Filter'], ['comp', 'Compressor'], ['limiter', 'Limiter'], ['drive', 'Drive'], ['tape', 'Tape'], ['reverb', 'Reverb'], ['delay', 'Delay'], ['warp', 'Time warp'], ['tune', 'Tune'], ['pitch', 'Pitch shifter'], ['transient', 'Transient shaper'], ['width', 'Stereo width']].map(([id, name]) => ({ id, name })),
};
const TALK = [
  ['make the snare louder', ['vol', 'snare']], ['more', ['vol', 'Turn up snare']], ['too much', ['vol', 'Turn down snare']], ['same for the hats', ['vol', 'Turn down hat']], ['now the chords', ['vol', 'Turn down chords']], ['undo that', ['undo']],
  ['make the chords darker', ['tone', 'chords darker']], ['even darker', ['tone', 'chords darker']], ['turn it down', ['vol', 'Turn down chords']], ['less', ['vol', 'Turn up chords']],
  ['new melody', ['regen']], ['another one', ['regen']], ['nah try again', ['regen']], ['perfect keep it', ['say']], ['no the other one', ['say']], ['not that', ['undo']],
];
export function score(verbose = false) {
  let ok = 0;
  const misses = [];
  for (const [text, want] of CASES) {
    const got = plan(text, ctx).map(s => s.type), need = want.split(' ');
    const hit = want === 'unknown' ? got.every(w => w === 'unknown') : need.every(w => got.includes(w)) && !got.includes('unknown');  // 'unknown': not for the brain (a window to open)
    if (hit) ok++; else misses.push(`${text}  →  ${got.join(' ') || '(nothing)'}  (wanted ${want})`);
  }
  // every "closest thing I can do" it offers has to work when clicked, whichever part it names
  for (const p of ['kick', 'snare', 'hats', '808', 'chords', 'melody', 'drums', 'vocals']) for (const x of IDEAS.map(i => i.replace('{p}', p))) {
    const got = plan(x, ctx).map(s => s.type);
    if (!got.length || got.includes('unknown')) misses.push(`suggestion "${x}" doesn't work  →  ${got.join(' ')}`);
  }
  // a conversation: each line works on what the one before did
  let last = null;
  for (const [text, want] of TALK) {
    const steps = plan(text, { ...ctx, last }), got = steps.map(s => s.type), desc = steps.map(s => describe(s)).join(' + ');
    if (!got.includes(want[0]) || (want[1] && !desc.includes(want[1]))) misses.push(`conversation: "${text}"  →  ${desc}  (wanted ${want.join(', ')})`);
    const real = steps.filter(s => !['say', 'ask', 'undo', 'unknown'].includes(s.type));
    if (real.length) last = real;
  }
  if (verbose) console.log(misses.join('\n'));
  return { ok, total: CASES.length, pct: Math.round(100 * ok / CASES.length), misses };
}
if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/').split('/').pop() ?? '')) {
  const r = score(process.argv.includes('-v'));
  console.log(`brain understands ${r.ok} of ${r.total} real requests (${r.pct}%)`);
  if (r.pct < 95 || r.misses.some(m => /^(suggestion|conversation)/.test(m))) { console.error(r.misses.join('\n')); process.exit(1); }
}

// A language model's reply is never trusted: only known steps with sensible values get through
if (import.meta.url.endsWith(process.argv[1]?.replace(/\\/g, '/').split('/').pop() ?? '')) {
  const r = parseReply('Sure! {"say":"ok","steps":[{"type":"vol","parts":["kick"],"dB":2},{"type":"vol","parts":["kick"],"dB":900},{"type":"eval","code":"x"},{"type":"__proto__"},{"type":"key","root":"Bb"},{"type":"sound","parts":"melody","sound":"flute"},{"type":"sound","parts":["melody"],"sound":"laser"},{"type":"fx","parts":["melody"],"fx":"reverb"},{"type":"fx","parts":["melody"],"fx":"nope"}],"ideas":["a",3]}', ctx);
  const types = r.steps.map(s => s.type).join(' ');
  if (types !== 'vol key sound fx' || r.steps[1].root !== 10 || r.dropped.length !== 5 || r.ideas.length !== 1) { console.error('model replies are not being checked:', types, r); process.exit(1); }
  if (!parseReply('mute the hats', ctx).steps.length || parseReply('hello there', ctx).say !== 'hello there' || checkSteps('nope', ctx).steps.length) { console.error('plain replies are not handled'); process.exit(1); }
}
