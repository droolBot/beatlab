// BeatLab music engine: styles, harmony, drums, bass, melody, arps and song arrangement as plain note data.
// A note is {t, d, p, v}: start and length in ticks (96 per quarter), MIDI pitch, velocity.
// 808 slides add g: 1 (and arrange() fills in `from`, the pitch they glide from).
// A song works like an FL Studio project: numbered patterns, each holding notes for any channel (a track keeps
// a pattern's notes under the pattern's id, track.p1, track.p2...), and a playlist of pattern and audio clips.
// The generator still writes an 8-bar hook (`notes`), verse (`notesB`) and fills plus a section plan, then
// toPlaylist() turns those into patterns placed on the playlist.
export const PPQ = 96, STEP = PPQ / 4, BAR = STEP * 16;
export const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export const noteName = p => NOTES[p % 12] + Math.floor(p / 12);  // FL Studio naming: MIDI 60 is C5

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
};
const isMinor = mode => mode !== 'major';
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

// Chord qualities as semitones above the root
const CHORDS = {
  M: [0, 4, 7], m: [0, 3, 7], add9: [0, 4, 7, 14], madd9: [0, 3, 7, 14],
  maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], 7: [0, 4, 7, 10],
  maj9: [0, 4, 7, 11, 14], m9: [0, 3, 7, 10, 14], 9: [0, 4, 7, 10, 14], 13: [0, 4, 10, 14, 21], alt: [0, 4, 10, 15, 20],
};
const SUFFIX = { M: '', m: 'm', add9: 'add9', madd9: 'm(add9)', maj7: 'maj7', m7: 'm7', 7: '7', maj9: 'maj9', m9: 'm9', 9: '9', 13: '13', alt: '7alt' };
export const SIMPLE_SUFFIX = { M: '', m: 'm', add9: '', madd9: 'm', maj7: 'maj7', m7: 'm7', 7: '7', maj9: 'maj7', m9: 'm7', 9: '7', 13: '7', alt: '7' };  // what the AI model understands
const SIMPLER = { add9: 'M', madd9: 'm', maj7: 'M', m7: 'm', 7: 'M', maj9: 'maj7', m9: 'm7', 9: '7', 13: '7', alt: '7' };
const RICHER = { M: 'add9', m: 'madd9', maj7: 'maj9', m7: 'm9', 7: '9', 9: '13' };

export const SOUNDS = {
  kick: 'Kick', snare: 'Snare', clap: 'Clap', hat: 'Closed hat', openhat: 'Open hat', rim: 'Rim', shaker: 'Shaker',
  conga: 'Conga', tom: 'Dhol', tabla: 'Tabla', cowbell: 'Cowbell', 808: '808', bass: 'Sub bass', reese: 'Reese bass', logdrum: 'Log drum',
  keys: 'Electric piano', piano: 'Piano', organ: 'Organ', pad: 'Pad', strings: 'Strings', guitar: 'Guitar', sitar: 'Sitar', pluck: 'Pluck',
  bell: 'Bell', flute: 'Flute', lead: 'Synth lead', vox: 'Vocal synth', brass: 'Brass', synth: 'Trio synth', acid: 'Acid bass', fm: 'FM synth', wave: 'Wavetable', slicer: 'Slicer', vinyl: 'Vinyl crackle', fx: 'Risers and impacts',
};
// What each sound is, for the plugin browser and the docs
export const SOUND_INFO = {
  kick: 'Synth kick with tune, decay and punch', snare: 'Synth snare with snap', clap: 'Layered hand clap', hat: 'Closed hi-hat', openhat: 'Open hi-hat, choked by the closed one', rim: 'Rim shot', shaker: 'Shaker', conga: 'Tuned conga', tom: 'Tom', tabla: 'Tabla with pitch bend', cowbell: 'Two-tone cowbell',
  808: '808 bass with drive, glide and tone', acid: 'Acid bass: a squelchy resonant filter, accents on loud notes, slides on tied ones', bass: 'Filtered synth bass', reese: 'Detuned Reese bass', logdrum: 'Amapiano log drum',
  keys: 'Electric piano with tine and tremolo', piano: 'Acoustic-style piano', organ: 'Drawbar organ with Leslie', pad: 'Warm detuned pad', strings: 'String ensemble with vibrato', guitar: 'Plucked nylon guitar', pluck: 'Bright plucked synth', bell: 'FM bell', vox: 'Vowel choir', brass: 'Brass section',
  flute: 'Breathy flute', lead: 'Detuned lead with glide', sitar: 'Buzzing sitar', synth: 'Three oscillators, unison, filter envelope and LFO', fm: 'Three FM operators: electric pianos, bells, basses, brass', wave: 'Morphing wavetables scanned by an envelope and an LFO', slicer: 'Chops a dropped loop into slices you rearrange on the steps', vinyl: 'Vinyl crackle bed', fx: 'Risers and impacts',
};
export const SOUNDS_FOR = {
  drum: ['kick', 'snare', 'clap', 'hat', 'openhat', 'rim', 'shaker', 'conga', 'tom', 'tabla', 'cowbell', 'slicer'],
  bass: ['808', 'bass', 'reese', 'acid', 'logdrum', 'synth', 'fm', 'wave'],
  chords: ['keys', 'piano', 'organ', 'pad', 'strings', 'guitar', 'pluck', 'bell', 'vox', 'brass', 'synth', 'fm', 'wave'],
  melody: ['bell', 'pluck', 'flute', 'lead', 'keys', 'piano', 'organ', 'guitar', 'sitar', 'strings', 'vox', 'brass', 'cowbell', 'synth', 'fm', 'wave'],
  texture: ['vinyl'],
  fx: ['fx'],
};

const TRACKS = [['kick', 'drum'], ['snare', 'drum'], ['hat', 'drum'], ['openhat', 'drum'], ['perc', 'drum'], ['bass', 'bass'],
  ['chords', 'chords'], ['arp', 'melody'], ['melody', 'melody'], ['texture', 'texture'], ['fx', 'fx']];
export const COLORS = { kick: '#C98466', snare: '#C9A271', hat: '#BFB27F', openhat: '#ABA383', perc: '#97AA8C', bass: '#86A8A6', chords: '#9A96BD', arp: '#8B9DB8', melody: '#B8909F', texture: '#8F9296', fx: '#A3A6AA', audio: '#B3A491' };
const MIX = {
  kick: { vol: 0.9 }, snare: { vol: 0.72, rev: 0.12 }, hat: { vol: 0.42, pan: 0.15 }, openhat: { vol: 0.32, pan: -0.15, rev: 0.08 },
  perc: { vol: 0.42, pan: -0.25, rev: 0.18 }, bass: { vol: 0.78 }, chords: { vol: 0.5, rev: 0.32 }, arp: { vol: 0.34, pan: 0.3, rev: 0.3, dly: 0.25 },
  melody: { vol: 0.55, rev: 0.28, dly: 0.18 }, texture: { vol: 0.5 }, fx: { vol: 0.6, rev: 0.45 },
};
const DEFAULT_SOUND = { kick: 'kick', snare: 'snare', hat: 'hat', openhat: 'openhat', perc: 'rim', texture: 'vinyl', fx: 'fx' };
const BASS_RANGE = { 808: [28, 40], bass: [31, 45], reese: [28, 40], logdrum: [36, 48] };
export const KINDS = Object.fromEntries(TRACKS);

export const trackName = t => t.name ?? ({ kick: 'Kick', hat: 'Hats', openhat: 'Open hat', chords: 'Chords', arp: 'Arp', melody: 'Melody', texture: 'Vinyl', fx: 'Risers and FX' })[t.id] ?? SOUNDS[t.sound] ?? 'Audio';

// Drum bars are 16 steps: X accent, x hit, o ghost, r/t/q rolls of 2/3/4 hits, . rest.
// Pattern variants run from sparse to busy; energy picks the hook's, the verse uses a sparser one.
// Progressions are [semitones above the tonic, chord quality, beats] in the style's own mode.
// duck = sidechain depth per track, fx = insert effects per track, kit = which FL drum samples suit it.
export const STYLES = {
  trap: {
    name: 'Trap', bpm: [130, 160, 140], mode: 'minor', swing: 0, feel: 0.03, kit: 'electronic',
    progs: [
      [[0, 'm', 8], [8, 'M', 8], [3, 'M', 8], [10, 'M', 8]],
      [[0, 'm', 8], [5, 'm', 8], [8, 'M', 8], [7, 'M', 8]],
      [[0, 'm', 16], [8, 'M', 8], [7, 'M', 8]],
      [[0, 'm', 8], [10, 'M', 8], [8, 'M', 16]],
      [[0, 'm', 16], [5, 'm', 16]],
    ],
    drums: {
      kick: [['x......x..x.....', 'x.x.......x..x..'], ['x.....x...x.....', 'x......x.x....x.'], ['x..x......x...x.', 'x.x....x..x..x..']],
      snare: [['........x.......'], ['........x.......', '........x.....o.'], ['........x.......', '........x..o..x.']],
      hat: [['x.x.x.x.x.x.x.x.'], ['x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.xrx.'], ['x.x.x.xxx.x.x.x.', 'x.x.x.x.x.xtx.rr'], ['xxx.x.xxx.xtx.xx', 'x.xrx.x.xxx.trx.']],
      openhat: [['................', '..............x.'], ['......x.........', '..............x.']],
    },
    fills: { hat: 'x.x.x.x.ttttrrrr', snare: '........x...o.xx' },
    sounds: { snare: 'clap' },
    chords: { rhythm: 'pad', range: [55, 74], sound: 'pad' },
    bass: { mode: 'kick', sound: '808', slides: 0.15 },
    melody: { rhythms: 'medium', range: [72, 89], sound: 'bell' },
    arp: { sound: 'pluck', rate: 2, range: [67, 84] },
  },
  drill: {
    name: 'Drill', bpm: [138, 146, 142], mode: 'harmonic', swing: 0, feel: 0.03, kit: 'electronic',
    progs: [
      [[0, 'm', 8], [8, 'M', 8], [5, 'm', 8], [7, 'M', 8]],
      [[0, 'm', 16], [8, 'M', 8], [7, 'M', 8]],
      [[0, 'm', 8], [5, 'm', 8], [0, 'm', 8], [8, 'M', 8]],
      [[0, 'm', 8], [1, 'M', 8], [0, 'm', 8], [7, 'M', 8]],
    ],
    drums: {
      kick: [['x.........x.....', 'x......x........'], ['x.........x.....', 'x.....x....x....']],
      snare: [['........x.......', '........x..x....'], ['........x.......', '.....x..x.......']],
      hat: [['x..x..x...x..x..'], ['x..x..x.x..x.x..', 'x..x..x...x.tx..'], ['x.xx..x.x.xx..x.', 'x..x..x.x.ttx..x']],
      perc: [['..........x.....'], ['...x......x.....', '......x.....x...']],
    },
    fills: { hat: 'x..x..x.tttttttt', snare: '........x..x.xox' },
    sounds: { perc: 'rim' },
    chords: { rhythm: 'pad', range: [55, 74], sound: 'strings' },
    bass: { mode: 'kick', sound: '808', slides: 0.55 },
    melody: { rhythms: 'medium', range: [69, 86], sound: 'piano' },
    duck: { chords: 0.3 },
  },
  rnb: {
    name: 'R&B', bpm: [65, 95, 80], mode: 'major', swing: 0.15, feel: 0.08, kit: 'vintage',
    progs: [
      [[5, 'maj9', 4], [4, 'alt', 4], [9, 'm9', 4], [7, 'm9', 2], [0, '13', 2]],
      [[5, 'maj7', 4], [4, 'm7', 4], [2, 'm9', 4], [0, 'maj9', 4]],
      [[2, 'm9', 4], [7, '13', 4], [0, 'maj9', 4], [9, 'm9', 4]],
      [[0, 'maj9', 4], [9, 'm9', 4], [5, 'maj9', 4], [7, '13', 4]],
      [[9, 'm9', 4], [5, 'maj9', 4], [2, 'm9', 4], [7, '13', 4]],
    ],
    drums: {
      kick: [['x.........x.....', 'x......x..x.....'], ['x.....x...x.....', 'x.x.......x..x..'], ['x.....x.x.x.....', 'x.x....x..x..x..']],
      snare: [['....x.......x...'], ['....x.......x...', '....x.......x.o.']],
      hat: [['x.x.x.x.x.x.x.x.'], ['x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.xxx.'], ['x.xxx.x.x.xxx.x.', 'x.x.x.xrx.x.x.tt']],
      perc: [['..........x.....'], ['......x.......x.', '...x......x.....']],
    },
    fills: { hat: 'x.x.x.x.x.ttrrrr', snare: '....x.......x.oo' },
    sounds: { perc: 'rim' },
    chords: { rhythm: 'roll', range: [52, 72], rootless: true, sound: 'keys' },
    bass: { mode: 'kick', sound: '808', slides: 0.1 },
    melody: { rhythms: 'sparse', range: [64, 81], sound: 'guitar' },
    fx: { chords: [{ type: 'chorus', mix: 0.35 }] },
  },
  lofi: {
    name: 'Lofi', bpm: [70, 90, 82], mode: 'major', swing: 0.3, feel: 0.1, texture: true, dusty: true, kit: 'vintage',
    progs: [
      [[2, 'm9', 4], [7, '13', 4], [0, 'maj9', 8]],
      [[0, 'maj7', 4], [9, 'm7', 4], [2, 'm7', 4], [7, '7', 4]],
      [[5, 'maj7', 4], [4, 'm7', 4], [9, 'm7', 4], [0, 'maj7', 4]],
      [[9, 'm9', 4], [2, 'm9', 4], [7, '13', 4], [0, 'maj9', 4]],
    ],
    drums: {
      kick: [['x.........x.....', 'x......x..x.....'], ['x.......x.x.....', 'x.x.......x.....']],
      snare: [['....x.......x...'], ['....x.......x...', '....x..o....x...']],
      hat: [['x.x.x.x.x.x.x.x.'], ['x.xxx.x.x.xxx.x.']],
      perc: [['o.o.o.o.o.o.o.o.']],
    },
    fills: { snare: '....x.......x.o.' },
    sounds: { perc: 'shaker' },
    chords: { rhythm: 'keys', range: [52, 72], rootless: true, sound: 'keys' },
    bass: { mode: 'line', sound: 'bass', line: [['x-------..f-----'], ['x-------x---..o-'], ['x-----x-..x-----']] },
    melody: { rhythms: 'sparse', range: [67, 84], sound: 'piano' },
    fx: { chords: [{ type: 'crush', bits: 10, mix: 0.35 }], melody: [{ type: 'filter', cutoff: 4500 }] },
  },
  boombap: {
    name: 'Boom bap', bpm: [84, 96, 90], mode: 'dorian', swing: 0.25, feel: 0.08, kit: 'vintage',
    progs: [
      [[0, 'm7', 8], [5, 'm7', 8]],
      [[0, 'm9', 8], [8, 'maj7', 8]],
      [[0, 'm7', 4], [10, 'M', 4], [8, 'maj7', 4], [7, 'm7', 4]],
      [[0, 'm9', 16], [5, '9', 16]],
    ],
    drums: {
      kick: [['x......x.x......', 'x.x.......x.....'], ['x.......x.x.....', 'x......x..x..x..']],
      snare: [['....x.......x...'], ['....x.......x...', '....x..o....x..o']],
      hat: [['x.x.x.x.x.x.x.x.'], ['x.x.x.x.x.x.x.x.', 'x.x.x.x.x.x.x.xx']],
      openhat: [['..............x.']],
    },
    fills: { snare: '....x.......x.xo' },
    chords: { rhythm: 'keys', range: [52, 72], sound: 'piano' },
    bass: { mode: 'kick', sound: 'bass', slides: 0 },
    melody: { rhythms: 'sparse', range: [67, 84], sound: 'strings' },
    fx: { kick: [{ type: 'drive', amount: 0.25, mix: 0.6 }], snare: [{ type: 'crush', bits: 12, mix: 0.4 }] },
  },
  afro: {
    name: 'Afrobeats', bpm: [98, 115, 106], mode: 'major', swing: 0.12, feel: 0.06, kit: 'electronic',
    progs: [
      [[0, 'add9', 4], [7, 'M', 4], [9, 'm7', 4], [5, 'maj7', 4]],
      [[9, 'm7', 4], [5, 'maj7', 4], [0, 'add9', 4], [7, 'M', 4]],
      [[2, 'm7', 4], [7, 'M', 4], [0, 'maj7', 8]],
      [[5, 'maj7', 8], [0, 'add9', 8]],
    ],
    drums: {
      kick: [['x...x...x...x...'], ['x..x..x...x.x...'], ['x..x...x..x..x..']],
      snare: [['...x..x....x..x.'], ['...x..x....x..x.', '...x..x...x...x.']],
      hat: [['xoxoxoxoxoxoxoxo'], ['x.xox.xox.xox.xo']],
      perc: [['..x...x...x..x..'], ['..x..x.x..x..x..']],
    },
    fills: { perc: 'x.x.x.xxx.x.tttt' },
    sounds: { snare: 'rim', hat: 'shaker', perc: 'conga' },
    chords: { rhythm: 'pluck', range: [55, 76], sound: 'guitar' },
    bass: { mode: 'line', sound: 'bass', line: [['x--.x-.x..x-.x-.'], ['x-.x..x-..x-.x..']] },
    melody: { rhythms: 'busy', range: [69, 86], sound: 'flute' },
    arp: { sound: 'bell', rate: 2, range: [72, 88] },
    duck: { bass: 0.35, chords: 0.25 },
  },
  amapiano: {
    name: 'Amapiano', bpm: [108, 116, 112], mode: 'minor', swing: 0.15, feel: 0.06, kit: 'electronic',
    progs: [
      [[0, 'm9', 8], [5, 'm9', 8], [10, '9', 8], [3, 'maj9', 8]],
      [[0, 'm9', 16], [8, 'maj9', 16]],
      [[5, 'm9', 8], [10, '9', 8], [3, 'maj9', 8], [8, 'maj9', 8]],
    ],
    drums: {
      kick: [['x...x...x...x...']],
      snare: [['....x.......x...'], ['....x.......x...', '....x.......x..o']],
      hat: [['xoxoxoxoxoxoxoxo']],
      openhat: [['..x...x...x...x.']],
      perc: [['...x.....x..x...'], ['...x..x....x..x.']],
    },
    sounds: { snare: 'clap', hat: 'shaker', perc: 'rim' },
    chords: { rhythm: 'keys', range: [55, 74], rootless: true, sound: 'keys' },
    bass: { mode: 'line', sound: 'logdrum', line: [['x..x..f...x.o...'], ['x..x..x.o..x..f.'], ['..x..x....x.x...']] },
    melody: { rhythms: 'sparse', range: [67, 84], sound: 'vox' },
    duck: { chords: 0.3 },
  },
  house: {
    name: 'House', bpm: [118, 128, 124], mode: 'minor', swing: 0.08, feel: 0.04, kit: 'electronic',
    progs: [
      [[0, 'm7', 8], [5, 'm7', 8]],
      [[0, 'm9', 8], [8, 'maj7', 8], [10, 'M', 8], [7, 'm7', 8]],
      [[0, 'm7', 8], [10, 'M', 8], [8, 'maj7', 8], [10, 'M', 8]],
    ],
    drums: {
      kick: [['x...x...x...x...']],
      snare: [['....x.......x...']],
      hat: [['o.o.o.o.o.o.o.o.'], ['oooooooooooooooo']],
      openhat: [['..x...x...x...x.']],
      perc: [['......x.......x.'], ['...x..x....x..x.']],
    },
    fills: { snare: '....x.......xxxx' },
    sounds: { snare: 'clap', perc: 'shaker' },
    chords: { rhythm: 'stab', range: [55, 74], sound: 'piano' },
    bass: { mode: 'line', sound: 'bass', line: [['..x-..x-..x-..x-'], ['..x-..x-..x-..o-'], ['x-.x..x-x-.x..x-']] },
    melody: { rhythms: 'busy', range: [72, 89], sound: 'vox' },
    arp: { sound: 'pluck', rate: 1, range: [67, 84] },
    duck: { bass: 0.6, chords: 0.5, arp: 0.4 },
  },
  reggaeton: {
    name: 'Reggaeton', bpm: [88, 100, 94], mode: 'minor', swing: 0, feel: 0.04, kit: 'electronic',
    progs: [
      [[0, 'm', 8], [8, 'M', 8], [3, 'M', 8], [10, 'M', 8]],
      [[0, 'm', 8], [5, 'm', 8], [10, 'M', 8], [3, 'M', 8]],
      [[0, 'm', 8], [10, 'M', 8], [8, 'M', 8], [7, 'M', 8]],
    ],
    drums: {
      kick: [['x...x...x...x...']],
      snare: [['...x..x....x..x.'], ['...x..x....x..x.', '...x..x...x.x.x.']],
      hat: [['x.x.x.x.x.x.x.x.'], ['x.xxx.x.x.xxx.x.']],
      perc: [['..x.......x.....']],
    },
    fills: { snare: '...x..x....xxxxx' },
    sounds: { perc: 'rim' },
    chords: { rhythm: 'pluck', range: [55, 74], sound: 'pluck' },
    bass: { mode: 'kick', sound: '808', slides: 0.05 },
    melody: { rhythms: 'medium', range: [69, 86], sound: 'bell' },
    arp: { sound: 'pluck', rate: 2, range: [67, 84] },
  },
  phonk: {
    name: 'Phonk', bpm: [125, 160, 130], mode: 'phrygian', swing: 0, feel: 0.03, kit: 'electronic',
    progs: [
      [[0, 'm', 16], [1, 'M', 16]],
      [[0, 'm', 8], [8, 'M', 8], [10, 'm', 8], [0, 'm', 8]],
      [[0, 'm', 8], [1, 'M', 8], [10, 'm', 8], [8, 'M', 8]],
    ],
    drums: {
      kick: [['x.....x...x.....', 'x.x...x...x..x..'], ['x..x..x...x.x...']],
      snare: [['....x.......x...']],
      hat: [['x.x.x.x.x.x.x.x.'], ['x.xxx.xxx.xxx.xx'], ['xxxxxxxxxxxxxxxx']],
      openhat: [['..x...x...x...x.']],
    },
    sounds: { snare: 'clap' },
    chords: { rhythm: 'pad', range: [55, 72], sound: 'pad' },
    bass: { mode: 'kick', sound: '808', slides: 0.2 },
    melody: { rhythms: 'cowbell', range: [69, 84], sound: 'cowbell' },
    fx: { bass: [{ type: 'drive', amount: 0.5, mix: 0.7 }], melody: [{ type: 'drive', amount: 0.3, mix: 0.5 }] },
  },
  pop: {
    name: 'Pop', bpm: [98, 126, 112], mode: 'major', swing: 0, feel: 0.04, kit: 'electronic',
    progs: [
      [[0, 'M', 4], [7, 'M', 4], [9, 'm', 4], [5, 'M', 4]],
      [[9, 'm', 4], [5, 'M', 4], [0, 'M', 4], [7, 'M', 4]],
      [[0, 'M', 4], [9, 'm', 4], [5, 'M', 4], [7, 'M', 4]],
      [[5, 'M', 4], [0, 'M', 4], [7, 'M', 4], [9, 'm', 4]],
    ],
    drums: {
      kick: [['x.......x.......'], ['x.....x.x.......'], ['x...x...x...x...']],
      snare: [['....x.......x...']],
      hat: [['x.x.x.x.x.x.x.x.'], ['xxxxxxxxxxxxxxxx']],
      openhat: [['..............x.']],
    },
    sounds: { snare: 'clap' },
    chords: { rhythm: 'pulse', range: [55, 76], sound: 'pluck' },
    bass: { mode: 'line', sound: 'bass', line: [['x-x-x-x-x-x-x-x-'], ['x---x---x---x-o-'], ['x--x--x-x--x--x-']] },
    melody: { rhythms: 'busy', range: [69, 86], sound: 'lead' },
    arp: { sound: 'bell', rate: 2, range: [72, 88] },
    duck: { bass: 0.4, chords: 0.35 },
  },
  desi: {
    name: 'Desi hip-hop', bpm: [86, 104, 95], mode: 'harmonic', swing: 0.1, feel: 0.06, kit: 'vintage',
    progs: [
      [[0, 'm', 8], [8, 'M', 8], [7, 'M', 8], [0, 'm', 8]],
      [[0, 'm', 8], [1, 'M', 8], [0, 'm', 8], [7, 'M', 8]],
      [[0, 'm', 16], [5, 'm', 8], [7, 'M', 8]],
    ],
    drums: {
      kick: [['x.........x.....', 'x......x..x.....'], ['x.....x...x.....']],
      snare: [['....x.......x...']],
      hat: [['x.x.x.x.x.x.x.x.'], ['x.xxx.x.x.xxx.x.']],
      perc: [['x..x..x.x..x..x.'], ['x..x..x.x.x.x..x']],
    },
    sounds: { perc: 'tabla' },
    chords: { rhythm: 'pad', range: [55, 72], sound: 'strings' },
    bass: { mode: 'kick', sound: '808', slides: 0.25 },
    melody: { rhythms: 'medium', range: [67, 86], sound: 'sitar' },
    arp: { sound: 'flute', rate: 4, range: [72, 86] },
  },
};

// Melody rhythms, two bars each: x starts a note, - holds it, . rests
const RHYTHMS = {
  sparse: ['....x-x-x---x---x-----x-x-------', 'x-------..x-x-x-x-------........', '..x-x-x---x-x---x---------......', '....x---x-x-x---........x-x-x---'],
  medium: ['x--x--x-x--x--x-x--x--x-x-x-x---', 'x-x-x-x-x---x-x-x-x-x-x-x-------', 'x--x--x---x-x---x--x--x---x-x-x-', 'x---x-x-x--x--x-x---x-x-x-------'],
  busy: ['x-x-x-xxx-x-x-x-x-x-x-xxx-x-x---', 'x.x.x.x-x.x.x.x-x.x.x.x-x-x-x---', 'xx.xx.x-xx.xx.x-x-x-x-x-x-x-x---', 'x-xx-xx-x-x-x---x-xx-xx-x-x-----'],
  cowbell: ['x..x..x.x..x..x.x..x..x.x.x.x.x.', 'x.xx.xx.x.xx.x..x.xx.xx.x.x.xxx.', 'x..x..x...x.x.x.x..x..x...xxx.x.'],
};
const DENSITY = ['sparse', 'medium', 'busy'];
const CHORD_RHYTHM = { keys: 'x-----x---------', stab: '..x-..x-..x-..x-', pluck: 'x--x--x-x--x--x-', pulse: 'x-x-x-x-x-x-x-x-' };

export const seed = () => Math.floor(Math.random() * 2 ** 31);
export function rng(s) {  // mulberry32: small, fast, seedable
  let a = s >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, a) => a[Math.floor(r() * a.length)];

// Progressions are written in the style's home mode; a key in the other mode uses its relative
const relShift = (st, mode) => isMinor(st.mode) === isMinor(mode) ? 0 : isMinor(mode) ? 3 : 9;
const tonicOf = (st, root, mode) => (root + relShift(st, mode)) % 12;
export const songScale = song => { const st = STYLES[song.style]; return SCALES[st.mode].map(i => (tonicOf(st, song.root, song.mode) + i) % 12); };

const motion = (a, b) => b.reduce((s, n) => s + Math.min(...a.map(m => Math.abs(m - n))), 0) + a.reduce((s, m) => s + Math.min(...b.map(n => Math.abs(m - n))), 0);

// Place a chord in range, as close as possible to the previous one (smooth voice leading)
function voice(root, q, prev, [lo, hi], rootless) {
  let ints = CHORDS[q];
  if (rootless && ints.length >= 4) ints = ints.slice(1);  // the bass already plays the root
  else if (ints.length >= 5) ints = ints.filter(i => i !== 7);  // drop the fifth so rooted 9ths stay clear
  const pcs = [...new Set(ints.map(i => (root + i) % 12))];
  let best = null, bestCost = Infinity;
  for (let base = lo; base < lo + 12; base++) {
    const r0 = pcs.indexOf(base % 12);
    if (r0 < 0) continue;
    const v = [base];
    for (let k = 1; k < pcs.length; k++) { let n = v[k - 1] + 1; while (n % 12 !== pcs[(r0 + k) % pcs.length]) n++; v.push(n); }
    if (v[v.length - 1] > hi) continue;
    const off = Math.abs((v[0] + v[v.length - 1]) / 2 - (lo + hi) / 2);
    const cost = prev ? motion(prev, v) + off * 0.3 : off;
    if (cost < bestCost) { bestCost = cost; best = v; }
  }
  return best ?? pcs.map(pc => lo + (pc - lo % 12 + 12) % 12).sort((a, b) => a - b);
}

function buildHarmony(st, tonic, complexity, r, bars) {
  const prog = pick(r, st.progs), out = [];
  let t = 0, prev = null;
  while (t < bars * BAR) {
    for (const [off, q0, beats] of prog) {
      if (t >= bars * BAR) break;
      const q = complexity < 0.34 ? SIMPLER[q0] ?? q0 : complexity > 0.67 ? RICHER[q0] ?? q0 : q0;
      const root = (tonic + off) % 12;
      prev = voice(root, q, prev, st.chords.range, st.chords.rootless);
      out.push({ t, d: beats * PPQ, root, q, voicing: prev, pcs: CHORDS[q].map(i => (root + i) % 12), name: NOTES[root] + SUFFIX[q] });
      t += beats * PPQ;
    }
  }
  return out;
}
export const chordAt = (harmony, t) => harmony.findLast(c => c.t <= t) ?? harmony[0];

function humanize(notes, r, feel) {
  const dv = feel * 120, dt = Math.round(feel * 40);
  return notes.map(n => {
    const s = Math.min(Math.floor(r() * (dt + 1)), n.d - 1);  // starts drift late, ends stay put
    return { ...n, t: n.t + s, d: n.d - s, v: clamp(Math.round(n.v + (r() * 2 - 1) * dv), 1, 127) };
  });
}

// A drummer's pocket instead of random jitter: hats lean on the beat and lift off the "e" and the "a",
// snares sit behind the beat in the laid-back styles, kicks stay on it, and every hit varies a little.
const LAY = { snare: 1, openhat: 0.45, perc: 0.6, hat: 0.25, kick: 0 };
const HAT_ACCENT = [1, 0.72, 0.87, 0.76];
function pocket(notes, id, st, r) {
  const back = st.feel * 40;  // ticks behind the beat for the laid-back parts: about 1 in trap, 4 in lofi
  return notes.map(n => {
    const ghost = n.v < 70, accent = id === 'hat' && !ghost ? HAT_ACCENT[Math.round(n.t / STEP) % 4] : 1;
    const late = Math.round(back * (LAY[id] ?? 0.3) + (r() - 0.5) * (id === 'kick' ? 1 : 2.5));
    return { ...n, t: Math.max(0, n.t + late), v: clamp(Math.round(n.v * accent + (r() * 2 - 1) * (ghost ? 4 : 7)), 1, 127) };
  });
}

export function hits(s, at, notes = []) {
  for (let i = 0; i < 16; i++) {
    const c = s[i], n = { X: 1, x: 1, o: 1, r: 2, t: 3, q: 4 }[c];
    for (let h = 0; h < (n ?? 0); h++) {
      const v = c === 'X' ? 118 : c === 'o' ? 52 : n > 1 ? 58 + Math.round(40 * h / (n - 1)) : i % 4 === 0 ? 108 : i % 2 ? 86 : 96;
      notes.push({ t: at + i * STEP + Math.floor(h * STEP / n), d: Math.max(2, Math.floor(STEP / n / 2)), p: 60, v });
    }
  }
  return notes;
}

// A drum part from bar patterns; `energy` picks the variant, `fillLast` puts the style's fill in bar 8
function drumPart(st, id, variants, energy, r, bars, fillLast) {
  const pat = variants[clamp(Math.round(energy * (variants.length - 1) + r() - 0.5), 0, variants.length - 1)];
  const fill = fillLast && energy > 0.2 ? st.fills?.[id] : null, notes = [];
  for (let b = 0; b < bars; b++) hits(fill && b === bars - 1 ? fill : pat[b % pat.length], b * BAR, notes);
  return pocket(notes, id, st, r);
}

// Drums for the hook (A), the verse (B, a notch sparser) and a one-bar fill before each hook
function buildDrums(st, energy, r, bars, groove) {
  const out = {};
  for (const [id, styleVariants] of Object.entries(st.drums)) {
    if ((id === 'openhat' || id === 'perc') && energy < 0.25) continue;
    const variants = groove?.[id] ? [groove[id]] : styleVariants;
    out[id] = {
      A: drumPart(st, id, variants, energy, r, bars, true),
      B: drumPart(st, id, variants, Math.max(0, energy - 0.35), r, bars, false),
      fill: st.fills?.[id] ? pocket(hits(st.fills[id], 0), id, st, r) : null,
    };
  }
  return out;
}

function buildBass(st, harmony, kick, r, bars) {
  const cfg = st.bass, [lo, hi] = BASS_RANGE[cfg.sound], notes = [];
  let prev = (lo + hi) / 2;
  const rootNote = t => {
    const pc = chordAt(harmony, t).root;
    let best = lo;
    for (let n = lo; n <= hi; n++) if (n % 12 === pc && Math.abs(n - prev) < Math.abs(best - prev)) best = n;
    return (prev = best);
  };
  if (cfg.mode === 'kick') {  // 808 hits with every kick and rings until the next one
    const starts = [...new Set(kick.filter(n => n.v > 60).map(n => n.t))].sort((a, b) => a - b);
    starts.forEach((s, i) => {
      const end = Math.min(starts[i + 1] ?? bars * BAR, s + 2 * BAR), p = rootNote(s);
      if (cfg.slides && end - s >= 6 * STEP && r() < cfg.slides) {
        const mid = s + Math.round((end - s) / 2 / STEP) * STEP;
        notes.push({ t: s, d: mid - s, p, v: 110 }, { t: mid, d: end - mid, p: p + pick(r, [12, 7, -2, 3, 10]), v: 100, g: 1 });
      } else notes.push({ t: s, d: end - s, p, v: 110 });
    });
  } else {  // written bass line: x root, o octave, f fifth, - hold, . rest
    const line = pick(r, cfg.line);
    for (let b = 0; b < bars; b++) {
      const s = line[b % line.length];
      for (let i = 0; i < 16; i++) {
        if (!'xof'.includes(s[i])) continue;
        let j = i + 1;
        while (j < 16 && s[j] === '-') j++;
        const t = b * BAR + i * STEP;
        notes.push({ t, d: (j - i) * STEP, p: rootNote(t) + { x: 0, o: 12, f: 7 }[s[i]], v: s[i] === 'x' ? 108 : 96 });
      }
    }
  }
  return humanize(notes, r, st.feel / 2);
}

function buildChords(st, harmony, r) {
  const kind = st.chords.rhythm, notes = [];
  harmony.forEach((c, i) => {
    let s = c.t, e = c.t + c.d;
    if (kind === 'pad' || kind === 'roll') {
      if (kind === 'roll') {  // keys-player feel: land a 16th early, strum bottom to top
        if (i > 0) s -= STEP;
        if (i < harmony.length - 1) e -= STEP;
      }
      c.voicing.forEach((p, k) => {
        const o = kind === 'roll' ? k * 3 : 0;
        notes.push({ t: s + o, d: e - s - o, p, v: kind === 'roll' ? 66 + 5 * k : 80 });
      });
      return;
    }
    const pat = CHORD_RHYTHM[kind];
    for (let t = s; t < e; t += STEP) {
      const i16 = (t / STEP) % 16;
      if (pat[i16] !== 'x') continue;
      let j = i16 + 1;
      while (j < 16 && pat[j] === '-') j++;
      const d = Math.min((j - i16) * STEP, e - t);
      c.voicing.forEach((p, k) => notes.push({ t: t + k * 2, d: d - k * 2, p, v: 74 + 3 * k }));
    }
  });
  return humanize(notes, r, st.feel);
}

// Up-and-down arpeggio over the chord tones, `rate` steps per note
function buildArp(st, harmony, r) {
  const { rate, range: [lo, hi] } = st.arp, notes = [], len = rate * STEP;
  let dir = 1, i = 0;
  for (const c of harmony) {
    const ladder = [];
    for (let n = lo; n <= hi; n++) if (c.pcs.includes(n % 12)) ladder.push(n);
    i = clamp(i, 0, ladder.length - 1);  // the next chord may have fewer notes in range
    for (let t = c.t; t < c.t + c.d; t += len) {
      notes.push({ t, d: Math.max(2, len - 2), p: ladder[i], v: (t / STEP) % 4 === 0 ? 92 : 74 });
      if (i + dir < 0 || i + dir >= ladder.length) dir = -dir;
      i = clamp(i + dir, 0, ladder.length - 1);
    }
  }
  return humanize(notes, r, st.feel);
}

// Scale notes that would clash with a chord's own chromatic tones are swapped for those tones
export function chordScale(chord, scale) {
  const out = new Set(chord);
  for (const pc of scale) if (!chord.some(c => !scale.includes(c) && [1, 11].includes((pc - c + 12) % 12))) out.add(pc);
  return [...out];
}
export function nearestOf(p, pcs, lo, hi) {
  let best = lo;
  for (let n = lo; n <= hi; n++) if (pcs.includes(n % 12) && Math.abs(n - p) < Math.abs(best - p)) best = n;
  return best;
}
function stepIn(p, move, pcs, lo, hi) {
  const ladder = [];
  for (let n = lo; n <= hi; n++) if (pcs.includes(n % 12)) ladder.push(n);
  const at = ladder.reduce((bi, n, i) => Math.abs(n - p) < Math.abs(ladder[bi] - p) ? i : bi, 0);
  const i = at + move >= 0 && at + move < ladder.length ? at + move : at - move;  // bounce off the edges
  return ladder[clamp(i, 0, ladder.length - 1)];
}
function onsets(rh) {
  const out = [];
  for (let i = 0; i < rh.length; i++) {
    if (rh[i] !== 'x') continue;
    let j = i + 1;
    while (j < rh.length && rh[j] === '-') j++;
    out.push({ t: i * STEP, d: (j - i) * STEP });
  }
  return out;
}

// Two-bar motif A, varied, A again, then a new answer B. The motif is a contour (scale-step moves),
// so each repeat re-fits itself to the chords underneath; long and on-beat notes land on chord tones.
function buildMelody(st, harmony, scale, r, complexity, density = 0) {
  const [lo, hi] = st.melody.range;
  let set = st.melody.rhythms;
  if (set !== 'cowbell') set = DENSITY[clamp(DENSITY.indexOf(set) + (complexity < 0.34 ? -1 : complexity > 0.67 ? 1 : 0) + density, 0, 2)];
  const motif = () => onsets(pick(r, RHYTHMS[set])).map(o => ({ ...o, move: pick(r, [-3, -2, -1, -1, 0, 1, 1, 2, 3]) }));
  const A = motif(), B = motif();
  const A2 = A.map((o, k) => k >= A.length - 3 ? { ...o, move: pick(r, [-2, -1, 1, 2]) } : o);
  const notes = [];
  let first = null;
  [A, A2, A, B].forEach((m, slot) => {
    let p = null;
    m.forEach((o, k) => {
      const t = slot * 2 * BAR + o.t, chord = chordAt(harmony, t);
      p = p === null ? nearestOf(first ?? lo + (hi - lo) * 0.6, chord.pcs, lo, hi) : stepIn(p, o.move, chordScale(chord.pcs, scale), lo, hi);
      const strong = o.t % (8 * STEP) === 0 || o.d >= 4 * STEP;
      if (strong || k === m.length - 1) p = nearestOf(p, chord.pcs, lo, hi);
      notes.push({ t, d: o.d, p, v: strong ? 100 : 88 });
    });
    if (slot === 0) first = notes[0]?.p ?? null;
  });
  return humanize(notes, r, st.feel);
}

// The song form. `off` lists tracks that sit out of that section; pattern A is the hook, B the verse.
export const SECTION_NAMES = ['Intro', 'Verse', 'Pre-hook', 'Hook', 'Bridge', 'Break', 'Outro'];
const DRUMS_AND_BASS = ['kick', 'snare', 'hat', 'openhat', 'perc', 'bass'];
const defaultSections = () => [
  { name: 'Intro', bars: 4, pattern: 'A', off: [...DRUMS_AND_BASS, 'arp'] },
  { name: 'Hook', bars: 8, pattern: 'A', off: [] },
  { name: 'Verse', bars: 8, pattern: 'B', off: ['melody', 'arp'] },
  { name: 'Hook', bars: 8, pattern: 'A', off: [] },
  { name: 'Verse', bars: 8, pattern: 'B', off: ['melody'] },
  { name: 'Bridge', bars: 4, pattern: 'B', off: ['kick', 'snare', 'bass', 'arp'] },
  { name: 'Hook', bars: 8, pattern: 'A', off: [] },
  { name: 'Outro', bars: 4, pattern: 'A', off: [...DRUMS_AND_BASS, 'arp'] },
];

// Build a beat: pattern A (hook), pattern B (verse), fills, arrangement and mix.
// Each part has its own seed so it can be re-rolled alone. `groove` replaces the style's drum
// patterns with ones copied from a reference song; `kick` keeps an edited kick for the 808 to follow.
export function generate({ style, bpm, root, mode, energy = 0.5, complexity = 0.5, seeds = {}, kick, kickB, groove }) {
  const st = STYLES[style], bars = 8, tonic = tonicOf(st, root, mode), scale = SCALES[st.mode].map(i => (tonic + i) % 12);
  seeds = { chords: seed(), drums: seed(), bass: seed(), melody: seed(), ...seeds };
  const harmony = buildHarmony(st, tonic, complexity, rng(seeds.chords), bars);
  const drums = buildDrums(st, energy, rng(seeds.drums), bars, groove);
  const parts = {};
  for (const [id, d] of Object.entries(drums)) parts[id] = { notes: d.A, notesB: d.B, fill: d.fill };
  const bassRng = rng(seeds.bass);
  parts.bass = { notes: buildBass(st, harmony, kick ?? drums.kick?.A ?? [], bassRng, bars), notesB: buildBass(st, harmony, kickB ?? drums.kick?.B ?? [], bassRng, bars) };
  parts.chords = { notes: buildChords(st, harmony, rng(seeds.chords + 1)) };
  if (st.arp) parts.arp = { notes: buildArp(st, harmony, rng(seeds.chords + 2)) };
  const mr = rng(seeds.melody);
  parts.melody = { notes: buildMelody(st, harmony, scale, mr, complexity), notesB: buildMelody(st, harmony, scale, mr, complexity, -1) };
  if (st.texture) parts.texture = { notes: Array.from({ length: bars }, (_, b) => ({ t: b * BAR, d: BAR, p: 60, v: 90 })) };
  parts.fx = { notes: [] };  // risers and impacts are placed by arrange() at section changes
  const soundOf = id => ({ bass: st.bass.sound, chords: st.chords.sound, melody: st.melody.sound, arp: st.arp?.sound })[id] ?? st.sounds?.[id] ?? DEFAULT_SOUND[id];
  const tracks = TRACKS.filter(([id]) => parts[id]).map(([id, kind]) => ({
    id, kind, sound: soundOf(id), ...parts[id], color: COLORS[id], params: {}, fx: structuredClone(st.fx?.[id] ?? []), duck: st.duck?.[id] ?? 0,
    vol: MIX[id].vol, pan: MIX[id].pan ?? 0, rev: MIX[id].rev ?? 0, dly: MIX[id].dly ?? 0, mute: false, solo: false,
  }));
  return toPlaylist({ style, bpm, root, mode, energy, complexity, seeds, bars, swing: st.swing, harmony, tracks, sections: defaultSections() });
}

// Re-roll some parts, keeping every other track (and all mixer settings, effects and samples) as they are
const NOTE_FIELDS = ['notes', 'notesB', 'fill'];
// Re-roll some parts. Every generated pattern gets the fresh notes for those channels; your own patterns,
// the playlist, the other channels and all mixer settings, effects and samples stay as they are.
export function refresh(song, changes, ids) {
  const keep = id => song.tracks.find(t => t.id === id), gen = key => song.patterns.find(p => p.gen === key)?.id;
  const kick = ids.includes('kick') ? {} : { kick: keep('kick')?.[gen('Hook1')], kickB: keep('kick')?.[gen('Verse1')] };  // the 808 follows the kick you have
  const fresh = generate({ ...song, ...changes, ...kick });
  const out = { ...song, ...changes, harmony: fresh.harmony, seeds: fresh.seeds, mode: fresh.mode, root: fresh.root };
  const match = p => fresh.patterns.find(q => q.gen && q.gen === p.gen);
  out.tracks = song.tracks.map(t => {
    const f = fresh.tracks.find(x => x.id === t.id);
    if (!f || !ids.includes(t.id)) return t;
    const nt = { ...t };
    for (const p of song.patterns) { const q = match(p); if (q) nt[p.id] = f[q.id] ?? []; }
    return nt;
  });
  for (const f of fresh.tracks) {  // a part the old beat didn't have (a new style's arp, say) joins its patterns
    if (keep(f.id)) continue;
    const nt = { ...f };
    for (const q of fresh.patterns) delete nt[q.id];
    for (const p of song.patterns) { const q = match(p); if (q) nt[p.id] = f[q.id] ?? []; }
    out.tracks.push(nt);
  }
  return out;
}
const PARTS = { drums: ['kick', 'snare', 'hat', 'openhat', 'perc', 'bass'], chords: ['chords', 'arp', 'bass', 'melody'], bass: ['bass'], melody: ['melody'] };
export const regenerate = (song, part) => refresh(song, { seeds: { ...song.seeds, [part]: seed() } }, PARTS[part]);
export const changeMode = (song, mode) => refresh(song, { mode }, PARTS.chords);

export function transpose(song, root) {
  const diff = ((root - song.root + 18) % 12) - 6, pc = x => (x + diff + 12) % 12;
  for (const t of song.tracks) {
    if (t.kind === 'drum' || t.kind === 'texture' || t.kind === 'fx') continue;
    for (const p of song.patterns) if (t[p.id]) t[p.id] = t[p.id].map(n => ({ ...n, p: n.p + diff }));
  }
  song.harmony = song.harmony.map(c => ({ ...c, root: pc(c.root), pcs: c.pcs.map(pc), voicing: c.voicing.map(p => p + diff), name: NOTES[pc(c.root)] + SUFFIX[c.q] }));
  song.root = root;
  return song;
}

export function newTrack(kind, sound, n) {
  const id = `${kind}${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const base = { id, kind, user: true, color: COLORS[kind === 'audio' ? 'audio' : { drum: 'perc', bass: 'bass', chords: 'chords', melody: 'melody' }[kind]], params: {}, fx: [], duck: 0, vol: kind === 'drum' ? 0.6 : 0.55, pan: 0, rev: kind === 'melody' ? 0.15 : 0.05, dly: 0, mute: false, solo: false };
  if (kind === 'audio') return { ...base, name: `Audio ${n}`, clips: [], vol: 0.8, rev: 0 };
  return { ...base, sound, name: `${SOUNDS[sound]} ${n}` };
}

// ---------- patterns and the playlist ----------
export const PATTERN_COLORS = ['#C98466', '#9A96BD', '#86A8A6', '#C9A271', '#B8909F', '#97AA8C', '#8B9DB8', '#BFB27F', '#A3A6AA'];
export const ROWS = 16;
export const clipId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
export const notesFor = (track, pattern) => track[pattern] ?? [];
export const patternOf = (song, id) => song.patterns.find(p => p.id === id);
export function newPatternId(song) { let n = 1; while (song.patterns.some(p => p.id === `p${n}`)) n++; return `p${n}`; }
export function songLength(song) {  // ticks to the end of the last clip, rounded up to a bar
  const spt = 60 / (song.bpm * PPQ);
  return Math.ceil(Math.max(BAR, ...song.playlist.clips.map(c => c.t + (c.type === 'audio' ? c.len / spt : c.d))) / BAR) * BAR;
}

// Sections that play the same notes share a pattern, so a generated beat arrives as Intro, Hook, Verse...
function toPlaylist(song) {
  const flat = arrangeLoops({ ...song, swing: 0 }, 'song'), patterns = [], byKey = new Map(), clips = [], markers = [], count = {};
  song.sections.forEach((sec, si) => {
    const start = flat.sections[si].start, end = start + sec.bars * BAR;
    const content = song.tracks.map(t => (flat.events.find(e => e.track === t)?.notes ?? []).filter(n => n.t >= start && n.t < end).map(({ from, ...n }) => ({ ...n, t: n.t - start })));
    const key = `${sec.bars}|${JSON.stringify(content)}`;
    let p = byKey.get(key);
    if (!p) {
      const k = count[sec.name] = (count[sec.name] ?? 0) + 1;
      p = { id: `p${patterns.length + 1}`, name: k > 1 ? `${sec.name} ${k}` : sec.name, bars: sec.bars, color: PATTERN_COLORS[patterns.length % PATTERN_COLORS.length], gen: `${sec.name}${k}` };
      patterns.push(p);
      byKey.set(key, p);
      song.tracks.forEach((t, i) => { t[p.id] = content[i]; });
    }
    clips.push({ id: `g${clips.length + 1}`, type: 'pattern', pattern: p.id, row: patterns.indexOf(p), t: start, d: sec.bars * BAR });
    markers.push({ t: start, name: sec.name });
  });
  let row = patterns.length;
  for (const t of song.tracks) {
    for (const f of NOTE_FIELDS) delete t[f];
    if (t.kind !== 'audio') continue;
    for (const c of t.clips ?? []) clips.push({ id: c.id ?? clipId(), type: 'audio', ch: t.id, row, buf: c.buf, name: c.name, t: c.t, off: c.off ?? 0, len: c.len, gain: c.gain ?? 0, fi: c.fi ?? 0, fo: c.fo ?? 0, rev: !!c.rev });
    delete t.clips;
    row++;
  }
  song.patterns = patterns;
  song.playlist = { rows: Array.from({ length: Math.max(ROWS, row + 4) }, (_, i) => ({ name: `Track ${i + 1}`, mute: false })), clips };
  song.markers = markers;
  delete song.sections;
  delete song.bars;
  return song;
}
export const upgrade = song => (song.patterns ? song : toPlaylist(song));  // saves from before patterns

// A pattern as a loop, or the whole playlist, with swing applied, in absolute ticks. A clip plays its
// pattern from the clip's start and stops at the clip's end, like FL Studio's pattern clips.
export function arrange(song, view) {
  const off = Math.round(song.swing * STEP);
  const warp = t => {  // push offbeat 16ths late; monotonic, so notes never start to overlap
    const s = Math.floor(t / STEP), u = t - s * STEP;
    return s % 2 ? s * STEP + off + u * (STEP - off) / STEP : t;
  };
  const rows = song.playlist.rows, solo = rows.some(r => r.solo), live = r => !rows[r]?.mute && (!solo || rows[r]?.solo);
  const pat = patternOf(song, view);
  const clips = view === 'song'
    ? song.playlist.clips.filter(c => c.type === 'pattern' && !c.mute && live(c.row) && patternOf(song, c.pattern))
    : [{ pattern: view, t: 0, d: (pat?.bars ?? 8) * BAR }];
  const length = view === 'song' ? songLength(song) : clips[0].d;
  const events = song.tracks.map(track => ({ track, notes: [] }));
  for (const c of clips) {
    const end = c.t + c.d, from = c.off ?? 0;
    for (const ev of events) {
      for (const n of ev.track[c.pattern] ?? []) {
        if (n.m) continue;  // a note muted in the piano roll
        const t = c.t + n.t - from;
        if (t < c.t || t >= end) continue;
        const s = warp(t), e = warp(Math.min(t + n.d, end));
        if (e > s) ev.notes.push({ ...n, t: s, d: Math.max(1, e - s) });
      }
    }
  }
  for (const ev of events) {  // in order, 808 slides know where they glide from, and a pitch never overlaps itself
    ev.notes.sort((a, b) => a.t - b.t);
    const last = {};
    let prev = null;
    for (const n of ev.notes) {
      if (n.g && prev) n.from = prev.p;
      const q = last[n.p];
      if (q && q.t + q.d > n.t) q.d = n.t - q.t;
      last[n.p] = n;
      prev = n;
    }
    ev.notes = ev.notes.filter(n => n.d > 0);
  }
  let sections;
  if (view !== 'song') sections = [{ name: pat?.name ?? 'Pattern', start: 0, bars: clips[0].d / BAR }];
  else {
    const marks = [...(song.markers ?? [])].sort((a, b) => a.t - b.t);
    sections = (marks.length ? marks : [{ t: 0, name: 'Song' }]).map((m, i, all) => ({ name: m.name, start: m.t, bars: ((all[i + 1]?.t ?? length) - m.t) / BAR }));
    if (sections[0].start > 0) sections.unshift({ name: 'Start', start: 0, bars: sections[0].start / BAR });
  }
  return { length, sections, events };
}

// The generator's loops laid out as pattern A or B, or the whole section plan, with swing, in absolute ticks
function arrangeLoops(song, view) {
  const form = view === 'song' ? song.sections : [{ name: `Pattern ${view}`, bars: song.bars, pattern: view, off: [] }];
  const off = Math.round(song.swing * STEP);
  const warp = t => {  // push offbeat 16ths late; monotonic, so notes never start to overlap
    const s = Math.floor(t / STEP), u = t - s * STEP;
    return s % 2 ? s * STEP + off + u * (STEP - off) / STEP : t;
  };
  const sort = notes => [...(notes ?? [])].sort((a, b) => a.t - b.t);
  const events = song.tracks.map(track => ({ track, notes: [], A: sort(track.notes), B: sort(track.notesB ?? track.notes), fill: sort(track.fill) }));
  const sections = [];
  let at = 0;
  form.forEach((sec, si) => {
    const end = at + sec.bars * BAR, next = form[si + 1], intoHook = view === 'song' && next?.name === 'Hook' && sec.name !== 'Hook';
    for (const ev of events) {
      const id = ev.track.id;
      if (sec.off.includes(id)) continue;
      const src = sec.pattern === 'B' ? ev.B : ev.A;
      const push = (n, t) => {
        if (intoHook && (id === 'kick' || id === 'bass') && t >= end - BAR / 2) return;  // drop out right before a hook
        const s = warp(t), e = warp(Math.min(t + n.d, end)), prev = ev.notes[ev.notes.length - 1];
        if (e > s) ev.notes.push({ ...n, t: s, d: Math.max(1, e - s), from: n.g && prev ? prev.p : undefined });  // swing can squeeze a roll hit under a tick
      };
      for (let b = 0; b < sec.bars; b++) {
        const lastBar = b === sec.bars - 1, bar = at + b * BAR;
        if (intoHook && lastBar && ev.fill.length) { for (const n of ev.fill) push(n, bar + n.t); continue; }  // drum fill into the hook
        const from = (b % song.bars) * BAR;
        for (const n of src) if (n.t >= from && n.t < from + BAR) push(n, bar + n.t - from);
      }
    }
    // Risers into a hook, an impact and crash on the downbeat, a downlifter out of it
    const fx = events.find(ev => ev.track.id === 'fx');
    if (fx && view === 'song') {
      if (intoHook && !next.off.includes('fx')) fx.notes.push({ t: end - Math.min(2, sec.bars) * BAR, d: Math.min(2, sec.bars) * BAR, p: 60, v: 100 });
      if (sec.name === 'Hook' && !sec.off.includes('fx')) fx.notes.push({ t: at, d: BAR, p: 61, v: 110 }, { t: at, d: BAR, p: 63, v: 100 });
      if (sec.name === 'Hook' && next && next.name !== 'Hook' && !next.off.includes('fx')) fx.notes.push({ t: end, d: BAR, p: 62, v: 90 });
    }
    sections.push({ name: sec.name, start: at, bars: sec.bars, pattern: sec.pattern });
    at = end;
  });
  for (const ev of events) ev.notes.sort((a, b) => a.t - b.t);
  return { length: at, sections, events: events.map(({ track, notes }) => ({ track, notes })) };
}

// FL Studio drum samples that suit each family of styles, matched against the library's file paths
const KITS = {
  electronic: {
    kick: [/Drums\/Kicks\/(909|Pow|Nuked|Monster|Minimal Kick (0[1-9]|1\d)|Grv Kick [12]\d)/i],
    snare: [/Drums\/(Snares\/(909 Snare|808 Snare|Grv Snareclap)|Percussion\/(909 Clap|Grv Clap|SC Clap|Pap Clap))/i],
    clap: [/Drums\/Percussion\/(909 Clap|Grv Clap|SC Clap|Pap Clap|DNC Clap)/i],
    hat: [/Drums\/Hats\/(808 CH|909 CH|Grv CH|Ice Hat|Chromo CH)/i],
    openhat: [/Drums\/Hats\/(808 OH|909 OH|Grv OH|Chromo OH)/i],
    rim: [/Drums\/Snares\/(909 Rim|707 Rim|Chromo Rim)/i],
    shaker: [/Drums\/Percussion\/(Industrial Shaker|FPC Egg|GM Cabasa)/i],
    conga: [/Drums\/Percussion\/(808 Conga|Linn Conga|Industrial Bongo)/i],
    cowbell: [/Drums\/Percussion\/808 Cowbell/i],
  },
  vintage: {
    kick: [/Legacy\/Drums\/(HipHop\/HIP_Kick|Vintage\/VT_(BD|Kick))|Drums\/Kicks\/(Linn|Grv Kick Acoustic|707|Ekit)/i],
    snare: [/Legacy\/Drums\/(HipHop\/HIP_Snare|Vintage\/VT_SD)|Drums\/Snares\/(Linn Snare|FPC Snare|Ekit Snare|Loose Snare)/i],
    clap: [/Legacy\/Drums\/Vintage\/VT_HandClap|Drums\/Percussion\/(Ekit Clap|Grv Clap)/i],
    hat: [/Legacy\/Drums\/(HipHop\/HIP_Hat|Vintage\/VT_CHiHat)|Drums\/Hats\/(Linn CH|Zild CH|OverH CH)/i],
    openhat: [/Legacy\/Drums\/Vintage\/VT_OHiHat|Drums\/Hats\/(Linn OH|Zild OH|OverH OH)/i],
    rim: [/Legacy\/Drums\/Vintage\/VT_RimShot|Drums\/Snares\/(Linn Rim|Stick Rim|14in Rim)/i],
    shaker: [/Drums\/Percussion\/(FPC Egg|Linn Tamb|GM Cabasa)/i],
    conga: [/Drums\/Percussion\/(Linn Conga|808 Conga)/i],
    cowbell: [/Drums\/Percussion\/(808 Cowbell|Grv Cowbell)/i],
  },
};

// Choose an FL Studio sample for every drum track whose sound has a kit rule. `library` is a list of paths.
export function pickKit(song, library, r = rng(song.seeds.drums + 7)) {
  const kit = KITS[STYLES[song.style].kit] ?? KITS.electronic, picks = {};
  for (const t of song.tracks) {
    if (t.kind !== 'drum') continue;
    const rule = kit[t.sound] ?? kit[t.id];
    const matches = rule ? library.filter(p => rule.some(re => re.test(p.replace(/\\/g, '/')))) : [];
    if (matches.length) picks[t.id] = pick(r, matches);
  }
  return picks;
}

// Rank styles for an analyzed song: tempo fit (allowing half and double time), mode and store genre
const GENRE_HINTS = [
  [/r&b|soul/i, { rnb: 0.8, lofi: 0.2 }], [/hip.?hop|rap/i, { trap: 0.4, drill: 0.3, boombap: 0.3, rnb: 0.3, desi: 0.2 }],
  [/dance|house|electronic/i, { house: 0.8 }], [/afro/i, { afro: 0.8, amapiano: 0.5 }], [/latin|reggaeton|urbano/i, { reggaeton: 0.8 }],
  [/pop/i, { pop: 0.6 }], [/indian|bollywood|punjabi|desi|hindi|bhangra/i, { desi: 0.7 }], [/jazz|lo.?fi|chill/i, { lofi: 0.8 }], [/phonk/i, { phonk: 1 }],
];
export function suggestStyles(bpms, mode, genre = '') {
  return Object.entries(STYLES).map(([id, st]) => {
    const [lo, hi] = st.bpm;
    let fit = 0, bpm = st.bpm[2];
    bpms.forEach((b, i) => {
      for (const f of [1, 0.5, 2]) {
        const x = b * f, dist = x < lo ? lo - x : x > hi ? x - hi : 0;
        const s = Math.max(0, 1 - dist / 12) * (i ? 0.8 : 1) * (f === 1 ? 1 : 0.9);
        if (s > fit) { fit = s; bpm = Math.round(x); }
      }
    });
    const hint = GENRE_HINTS.reduce((s, [re, m]) => s + (re.test(genre) ? m[id] ?? 0 : 0), 0);
    // every style adapts to either mode, so the home mode only nudges the order
    return { id, bpm, score: fit + (isMinor(st.mode) === isMinor(mode) ? 0.1 : 0) + hint };
  }).sort((a, b) => b.score - a.score).slice(0, 5);
}
