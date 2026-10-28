// BeatLab sound: instrument plugins with knobs, mixer strips with insert effects and sidechain,
// live playback, offline rendering and WAV files. Web Audio, plus an AudioWorklet for the effects that
// work sample by sample (dsp.js).
import { PPQ, STEP, arrange, rng, songScale } from './music.js';
import { maskOf } from './dsp.js';

// The audio-thread effects load once per audio context. Until they have, a new one passes sound through.
const DSP = new WeakMap(), DSP_READY = new WeakSet();
export const loadDsp = c => {
  if (!DSP.has(c)) DSP.set(c, c.audioWorklet.addModule(new URL('./dsp-worklet.js', import.meta.url)).then(() => { DSP_READY.add(c); }));
  return DSP.get(c);
};
const DSP_FX = { warp: 'beatlab-warp', pitch: 'beatlab-pitch', tune: 'beatlab-tune', transient: 'beatlab-transient' };
const SCALE_PCS = [[0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 8, 10], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]];

const mtof = p => 440 * 2 ** ((p - 69) / 12);
const shape = fn => Float32Array.from({ length: 2049 }, (_, i) => fn(i / 1024 - 1));
// Clean up to 0.7, then a soft knee that never passes 0.875 (about -1.2 dBFS), so exports can't clip
const CLIP = shape(x => Math.sign(x) * (Math.abs(x) < 0.7 ? Math.abs(x) : 0.7 + 0.19 * Math.tanh((Math.abs(x) - 0.7) / 0.19)));
const driveCurve = k => shape(x => Math.tanh((1 + k * 6) * x) / Math.tanh(1 + k * 6));
const DRIVES = Array.from({ length: 11 }, (_, i) => driveCurve(i / 10));
const drive = k => DRIVES[Math.round(Math.max(0, Math.min(1, k)) * 10)];

// Instrument knobs: [id, label, min, max, default, step names for a stepped knob]
const WAVES = ['Sine', 'Triangle', 'Saw', 'Square', 'Noise'], OCTAVES = ['-2', '-1', '0', '+1', '+2'];
export const RATIOS = ['0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6', '7', '8'];
const ALGOS = ['3 into 2 into 1', '2 and 3 into 1', '1+2, 3 into 1'];
export const TABLES = ['Sine', 'Soft', 'Saw', 'Square', 'Hollow', 'Vocal', 'Organ', 'Glass', 'Digital'];
const SLICES = ['4', '8', '16', '32'];
export const PARAMS = {
  kick: [['tune', 'Tune', -12, 12, 0], ['decay', 'Decay', 0.1, 1.5, 0.48], ['punch', 'Punch', 0, 1, 0.4]],
  snare: [['tune', 'Tune', -12, 12, 0], ['decay', 'Decay', 0.05, 0.6, 0.2], ['snap', 'Snap', 0, 1, 0.5]],
  clap: [['tone', 'Tone', 600, 3000, 1150], ['decay', 'Decay', 0.05, 0.6, 0.22]],
  hat: [['tone', 'Tone', 4000, 12000, 7500], ['decay', 'Decay', 0.01, 0.2, 0.045]],
  openhat: [['tone', 'Tone', 4000, 12000, 6500], ['decay', 'Decay', 0.1, 1, 0.4]],
  rim: [['tune', 'Tune', -12, 12, 0], ['decay', 'Decay', 0.01, 0.2, 0.03]],
  shaker: [['tone', 'Tone', 3000, 11000, 7000], ['decay', 'Decay', 0.02, 0.2, 0.06]],
  conga: [['tune', 'Tune', -12, 12, 0], ['decay', 'Decay', 0.05, 0.6, 0.25]],
  tom: [['tune', 'Tune', -12, 12, 0], ['decay', 'Decay', 0.1, 0.8, 0.38]],
  tabla: [['tune', 'Tune', -12, 12, 0], ['bend', 'Bend', 0, 1, 0.5]],
  cowbell: [['decay', 'Decay', 0.1, 1, 0.35], ['tone', 'Tone', 1, 3, 1.7]],
  acid: [['wave', 'Wave', 0, 1, 0, ['Saw', 'Square']], ['cutoff', 'Cutoff', 60, 3000, 320], ['res', 'Resonance', 1, 25, 14], ['env', 'Env mod', 0, 1, 0.6], ['decay', 'Decay', 0.05, 1.5, 0.28], ['accent', 'Accent', 0, 1, 0.7], ['drive', 'Drive', 0, 1, 0.35]],
  808: [['decay', 'Decay', 0.2, 3, 1.2], ['drive', 'Drive', 0, 1, 0.45], ['glide', 'Glide', 0.01, 0.3, 0.08], ['tone', 'Tone', 200, 4000, 1000]],
  bass: [['cutoff', 'Cutoff', 100, 4000, 1200], ['res', 'Resonance', 0.5, 12, 3], ['decay', 'Decay', 0.05, 1, 0.25]],
  reese: [['cutoff', 'Cutoff', 100, 4000, 700], ['detune', 'Detune', 0, 40, 18], ['drive', 'Drive', 0, 1, 0.3]],
  logdrum: [['decay', 'Decay', 0.05, 0.6, 0.17], ['drive', 'Drive', 0, 1, 0.6]],
  keys: [['bright', 'Brightness', 0, 1, 0.6], ['decay', 'Decay', 0.2, 3, 1.1], ['tine', 'Tine', 0, 1, 0.4], ['trem', 'Tremolo', 0, 1, 0]],
  piano: [['bright', 'Brightness', 0, 1, 0.5], ['decay', 'Decay', 0.3, 4, 1.6]],
  organ: [['drawbar', 'Drawbars', 0, 1, 0.5], ['leslie', 'Leslie', 0, 1, 0.5]],
  pad: [['cutoff', 'Cutoff', 300, 6000, 1300], ['attack', 'Attack', 0.01, 2, 0.4], ['release', 'Release', 0.05, 3, 0.5], ['detune', 'Detune', 0, 30, 9]],
  strings: [['attack', 'Attack', 0.01, 1.5, 0.15], ['cutoff', 'Cutoff', 800, 8000, 2600], ['vibrato', 'Vibrato', 0, 20, 7]],
  guitar: [['tone', 'Tone', 800, 8000, 3800], ['sustain', 'Sustain', 0, 1, 0.5]],
  sitar: [['buzz', 'Buzz', 0, 1, 0.6], ['sustain', 'Sustain', 0, 1, 0.6]],
  pluck: [['cutoff', 'Cutoff', 1, 24, 12], ['decay', 'Decay', 0.05, 1, 0.25]],
  bell: [['bright', 'Brightness', 0, 1, 0.6], ['decay', 'Decay', 0.2, 3, 0.7], ['ratio', 'Ratio', 1, 8, 3.5]],
  flute: [['breath', 'Breath', 0, 1, 0.4], ['vibrato', 'Vibrato', 0, 1, 0.5]],
  lead: [['cutoff', 'Cutoff', 500, 8000, 3200], ['detune', 'Detune', 0, 40, 12], ['vibrato', 'Vibrato', 0, 40, 12], ['glide', 'Glide', 0, 0.3, 0]],
  vox: [['vowel', 'Ah to oo', 0, 1, 0], ['breath', 'Breath', 0, 1, 0.3]],
  brass: [['bright', 'Brightness', 0, 1, 0.6], ['attack', 'Attack', 0.01, 0.3, 0.05]],
  vinyl: [['crackle', 'Crackle', 0, 1, 0.6]],
  fx: [['riser', 'Riser', 0, 1, 0.7], ['impact', 'Impact', 0, 1, 0.8]],
  sample: [['tune', 'Tune', -24, 24, 0], ['root', 'Root note', 24, 96, 60], ['start', 'Start', 0, 0.9, 0], ['reverse', 'Reverse', 0, 1, 0]],
  fm: [
    ['algo', 'Routing', 0, 2, 0, ALGOS], ['r1', 'Op 1 ratio', 0, 11, 1, RATIOS], ['r2', 'Op 2 ratio', 0, 11, 1, RATIOS], ['i2', 'Op 2 depth', 0, 10, 3], ['d2', 'Op 2 decay', 0.03, 3, 0.6],
    ['r3', 'Op 3 ratio', 0, 11, 5, RATIOS], ['i3', 'Op 3 depth', 0, 10, 0], ['d3', 'Op 3 decay', 0.03, 3, 0.3], ['vel', 'Velocity to tone', 0, 1, 0.5],
    ['attack', 'Attack', 0.001, 2, 0.003], ['decay', 'Decay', 0.01, 3, 0.8], ['sustain', 'Sustain', 0, 1, 0.3], ['release', 'Release', 0.01, 3, 0.3],
  ],
  wave: [
    ['table', 'Table', 0, 7, 2, TABLES.slice(0, 8)], ['morph', 'Morph', 0, 1, 0], ['scan', 'Env to morph', -1, 1, 0.5], ['scantime', 'Scan time', 0.05, 4, 0.8],
    ['lrate', 'LFO rate', 0.05, 8, 0.4], ['ldepth', 'LFO to morph', 0, 0.5, 0], ['uni', 'Unison', 1, 3, 1, ['1', '2', '3']], ['detune', 'Detune', 0, 40, 10],
    ['cutoff', 'Cutoff', 100, 18000, 9000], ['res', 'Resonance', 0.1, 12, 0.8],
    ['attack', 'Attack', 0.001, 2, 0.01], ['decay', 'Decay', 0.01, 3, 0.5], ['sustain', 'Sustain', 0, 1, 0.7], ['release', 'Release', 0.01, 3, 0.4],
  ],
  slicer: [['slices', 'Slices', 0, 3, 2, SLICES], ['tune', 'Tune', -12, 12, 0], ['gate', 'Length', 0.1, 1, 1], ['reverse', 'Reverse', 0, 1, 0]],
  inst: [['tune', 'Tune', -12, 12, 0], ['attack', 'Attack', 0, 1, 0], ['release', 'Release', 0.02, 3, 0.35], ['tone', 'Tone', 500, 20000, 20000]],
  synth: [
    ['w1', 'Osc 1', 0, 4, 2, WAVES], ['o1', 'Octave', -2, 2, 0, OCTAVES], ['l1', 'Level', 0, 1, 0.8],
    ['w2', 'Osc 2', 0, 4, 2, WAVES], ['o2', 'Octave', -2, 2, 0, OCTAVES], ['d2', 'Detune', -50, 50, 7], ['l2', 'Level', 0, 1, 0.6],
    ['w3', 'Osc 3', 0, 4, 3, WAVES], ['o3', 'Octave', -2, 2, -1, OCTAVES], ['l3', 'Level', 0, 1, 0.3],
    ['uni', 'Unison', 1, 5, 1, ['1', '2', '3', '4', '5']], ['spread', 'Spread', 0, 50, 12],
    ['ftype', 'Filter', 0, 2, 0, ['Low-pass', 'Band-pass', 'High-pass']], ['cutoff', 'Cutoff', 60, 18000, 3000], ['res', 'Resonance', 0.1, 20, 1], ['fenv', 'Env amount', -1, 1, 0.4], ['fdecay', 'Env decay', 0.01, 2, 0.3],
    ['attack', 'Attack', 0.001, 2, 0.005], ['decay', 'Decay', 0.01, 2, 0.3], ['sustain', 'Sustain', 0, 1, 0.7], ['release', 'Release', 0.01, 3, 0.3],
    ['glide', 'Glide', 0, 0.5, 0], ['drive', 'Drive', 0, 1, 0], ['lrate', 'LFO rate', 0.1, 12, 5], ['lpitch', 'LFO to pitch', 0, 100, 0], ['lcut', 'LFO to filter', 0, 1, 0], ['lamp', 'LFO to volume', 0, 1, 0],
  ],
};
export const paramsOf = (sound, own = {}) => Object.fromEntries((PARAMS[sound] ?? []).map(([id, , , , def]) => [id, own[id] ?? def]));

// Insert effects for mixer strips: [id, label, min, max, default]
export const EFFECTS = {
  eq: { name: 'EQ', group: 'Tone', params: [['low', 'Low', -15, 15, 0], ['mid', 'Mid', -15, 15, 0], ['midf', 'Mid freq', 200, 6000, 1000], ['high', 'High', -15, 15, 0]] },
  filter: { name: 'Filter', group: 'Tone', params: [['cutoff', 'Cutoff', 60, 20000, 8000], ['res', 'Resonance', 0.1, 15, 0.7], ['hp', 'High-pass', 0, 1, 0]] },
  comp: { name: 'Compressor', group: 'Dynamics', params: [['threshold', 'Threshold', -60, 0, -18], ['ratio', 'Ratio', 1, 20, 4], ['attack', 'Attack', 0.001, 0.1, 0.005], ['gain', 'Makeup', 0, 24, 4]] },
  limiter: { name: 'Limiter', group: 'Dynamics', params: [['gain', 'Input', 0, 18, 3], ['ceiling', 'Ceiling', -12, 0, -1]] },
  drive: { name: 'Drive', group: 'Colour', params: [['amount', 'Amount', 0, 1, 0.3], ['tone', 'Tone', 500, 12000, 6000], ['mix', 'Mix', 0, 1, 1]] },
  tape: { name: 'Tape', group: 'Colour', params: [['drive', 'Saturation', 0, 1, 0.35], ['wow', 'Wow', 0, 1, 0.3], ['tone', 'Tone', 2000, 16000, 9000]] },
  crush: { name: 'Bitcrush', group: 'Colour', params: [['bits', 'Bits', 2, 16, 8], ['mix', 'Mix', 0, 1, 0.6]] },
  chorus: { name: 'Chorus', group: 'Modulation', params: [['rate', 'Rate', 0.1, 5, 0.8], ['depth', 'Depth', 0, 1, 0.5], ['mix', 'Mix', 0, 1, 0.5]] },
  phaser: { name: 'Phaser', group: 'Modulation', params: [['rate', 'Rate', 0.05, 4, 0.4], ['depth', 'Depth', 0, 1, 0.7], ['mix', 'Mix', 0, 1, 0.5]] },
  flanger: { name: 'Flanger', group: 'Modulation', params: [['rate', 'Rate', 0.05, 3, 0.25], ['depth', 'Depth', 0, 1, 0.6], ['feedback', 'Feedback', 0, 0.9, 0.5], ['mix', 'Mix', 0, 1, 0.5]] },
  tremolo: { name: 'Tremolo', group: 'Modulation', params: [['rate', 'Rate', 0.5, 16, 4], ['depth', 'Depth', 0, 1, 0.5]] },
  width: { name: 'Stereo width', group: 'Space', params: [['width', 'Width', 0, 2, 1.4]] },
  delay: { name: 'Delay', group: 'Space', params: [['time', 'Time', 0, 4, 2], ['feedback', 'Feedback', 0, 0.9, 0.35], ['pingpong', 'Ping-pong', 0, 1, 1], ['mix', 'Mix', 0, 1, 0.3]] },
  reverb: { name: 'Reverb', group: 'Space', params: [['size', 'Size', 0.3, 6, 2], ['tone', 'Tone', 1000, 16000, 7000], ['mix', 'Mix', 0, 1, 0.3]] },
  peq: { name: 'Parametric EQ', group: 'Tone', params: [['lf', 'Low freq', 20, 500, 80], ['lg', 'Low', -15, 15, 0], ['f1', 'Freq 1', 80, 3000, 400], ['g1', 'Gain 1', -15, 15, 0], ['q1', 'Width 1', 0.3, 8, 1], ['f2', 'Freq 2', 500, 12000, 3000], ['g2', 'Gain 2', -15, 15, 0], ['q2', 'Width 2', 0.3, 8, 1], ['hf', 'High freq', 2000, 18000, 9000], ['hg', 'High', -15, 15, 0]] },
  vocoder: { name: 'Vocoder', group: 'Modulation', params: [['bands', 'Bands', 0, 2, 1], ['react', 'Release', 3, 60, 18], ['boost', 'Boost', 0, 30, 20], ['mix', 'Mix', 0, 1, 1]] },
  multiband: { name: 'Multiband', group: 'Dynamics', params: [['x1', 'Low split', 60, 600, 180], ['x2', 'High split', 1000, 9000, 3500], ['low', 'Low squash', 0, 1, 0.5], ['mid', 'Mid squash', 0, 1, 0.4], ['high', 'High squash', 0, 1, 0.4], ['out', 'Output', -6, 12, 2]] },
  gate: { name: 'Gate', group: 'Modulation', params: [['rate', 'Rate', 0, 4, 2], ['depth', 'Depth', 0, 1, 0.9], ['smooth', 'Smooth', 0, 1, 0.25]] },
  autopan: { name: 'Auto-pan', group: 'Modulation', params: [['rate', 'Rate', 0, 4, 3], ['depth', 'Depth', 0, 1, 0.6]] },
  transient: { name: 'Transient shaper', group: 'Dynamics', params: [['attack', 'Attack', -1, 1, 0.5], ['sustain', 'Sustain', -1, 1, 0], ['out', 'Output', -12, 12, 0]] },
  warp: { name: 'Time warp', group: 'Time', params: [['mode', 'Effect', 0, 4, 0], ['when', 'When', 0, 3, 1], ['mix', 'Mix', 0, 1, 1]] },
  pitch: { name: 'Pitch shifter', group: 'Pitch', params: [['semis', 'Semitones', -12, 12, 0], ['fine', 'Fine', -50, 50, 0], ['mix', 'Mix', 0, 1, 1]] },
  tune: { name: 'Tune', group: 'Pitch', params: [['key', 'Key', 0, 12, 0], ['scale', 'Scale', 0, 2, 0], ['speed', 'Retune speed', 0, 1, 0.1], ['mix', 'Amount', 0, 1, 1]] },
};
export const VOCODER_BANDS = [['8', 8], ['16', 16], ['24', 24]];
export const GATE_TIMES = [['1/4', 1], ['1/8', 0.5], ['1/16', 0.25], ['1/32', 0.125], ['Dotted 1/8', 0.75]];  // in beats
export const PAN_TIMES = [['1/4', 1], ['1/2', 2], ['1 bar', 4], ['2 bars', 8], ['4 bars', 16]];
export const DELAY_TIMES = [['1/16', 0.25], ['1/8', 0.5], ['Dotted 1/8', 0.75], ['1/4', 1], ['Dotted 1/4', 1.5]];  // in beats

function noiseBuffer(c) {
  const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function crackleBuffer(c) {  // seeded, so every render has the same pops and measures the same
  const n = c.sampleRate * 4, b = c.createBuffer(1, n, c.sampleRate), d = b.getChannelData(0), r = rng(7);
  let lp = 0;
  for (let i = 0; i < n; i++) d[i] = (lp += 0.04 * (r() * 2 - 1 - lp)) * 0.05;  // soft hiss
  for (let i = 0; i < n; i++) {
    if (r() > 0.0004) continue;  // sparse pops
    const a = (r() - 0.5) * 0.9;
    for (let k = 0; k < 48 && i + k < n; k++) d[i + k] += a * Math.exp(-k / 7);
  }
  return b;
}
function impulse(c, secs) {
  const n = Math.floor(c.sampleRate * secs), b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 3.2;
  }
  return b;
}

const osc = (c, type, f, t) => { const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); return o; };
const filter = (c, type, f, q = 0.7) => { const b = c.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
const gain = (c, v) => { const g = c.createGain(); g.gain.value = v; return g; };
function attack(c, t, secs, peak) {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + secs);
  return g;
}
function burst(e, out, t, len, amp, type, freq, q = 0.7) {  // filtered noise hit
  const c = e.ctx, src = c.createBufferSource(), g = c.createGain();
  src.buffer = e.noise;
  g.gain.setValueAtTime(Math.max(0.0002, amp), t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  src.connect(filter(c, type, freq, q)).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + len + 0.02);
}
function tone(e, out, type, f0, f1, t, len, amp) {  // pitched hit with a falling pitch
  const c = e.ctx, o = osc(c, type, f0, t), g = attack(c, t, 0.002, amp);
  o.frequency.exponentialRampToValueAtTime(f1, t + len * 0.5);
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + len + 0.02);
}
function sweep(e, out, t, len, amp, f0, f1, rising) {  // noise riser or downlifter
  const c = e.ctx, src = c.createBufferSource(), bp = filter(c, 'bandpass', f0, 1.4), g = c.createGain();
  src.buffer = e.noise;
  src.loop = true;
  bp.frequency.setValueAtTime(f0, t);
  bp.frequency.exponentialRampToValueAtTime(f1, t + len);
  g.gain.setValueAtTime(rising ? 0.0001 : amp, t);
  g.gain.exponentialRampToValueAtTime(rising ? amp : 0.0001, t + len * 0.98);
  g.gain.setTargetAtTime(0.0001, t + len, 0.02);
  src.connect(bp).connect(g).connect(out);
  src.start(t);
  src.stop(t + len + 0.2);
}
const run = (oscs, t, end) => oscs.forEach(o => { o.start(t); o.stop(end); });
const semis = st => 2 ** (st / 12);

// Every instrument: (engine, destination, start time, MIDI pitch, length in seconds, amplitude 0..1, note, knobs)
const SYNTHS = {
  kick(e, out, t, p, d, a, n, P) {
    const c = e.ctx, k = semis(P.tune), o = osc(c, 'sine', 160 * k, t), g = attack(c, t, 0.002, a);
    o.frequency.exponentialRampToValueAtTime(55 * k, t + 0.07);
    o.frequency.exponentialRampToValueAtTime(43 * k, t + P.decay * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + P.decay);
    o.connect(g).connect(out);
    run([o], t, t + P.decay + 0.02);
    burst(e, out, t, 0.01, a * P.punch, 'highpass', 2000);
  },
  snare(e, out, t, p, d, a, n, P) {
    burst(e, out, t, P.decay, a * 0.7, 'bandpass', 1900 * semis(P.tune), 0.6);
    burst(e, out, t, P.decay * 0.5, a * 0.6 * P.snap, 'highpass', 6000);
    tone(e, out, 'triangle', 200 * semis(P.tune), 150 * semis(P.tune), t, 0.12, a * 0.55);
  },
  clap(e, out, t, p, d, a, n, P) {
    for (let k = 0; k < 3; k++) burst(e, out, t + k * 0.011, 0.025, a * 0.55, 'bandpass', P.tone, 1.4);
    burst(e, out, t + 0.03, P.decay, a * 0.65, 'bandpass', P.tone, 1.1);
  },
  hat: (e, out, t, p, d, a, n, P) => burst(e, out, t, P.decay, a * 0.5, 'highpass', P.tone),
  openhat: (e, out, t, p, d, a, n, P) => burst(e, out, t, P.decay, a * 0.4, 'highpass', P.tone),
  rim(e, out, t, p, d, a, n, P) {
    tone(e, out, 'triangle', 1700 * semis(P.tune), 1650 * semis(P.tune), t, P.decay, a * 0.5);
    burst(e, out, t, 0.02, a * 0.3, 'bandpass', 3200, 1.5);
  },
  shaker: (e, out, t, p, d, a, n, P) => burst(e, out, t, P.decay, a * 0.35, 'bandpass', P.tone, 1.2),
  conga(e, out, t, p, d, a, n, P) {
    tone(e, out, 'sine', 330 * semis(P.tune), 250 * semis(P.tune), t, P.decay, a * 0.7);
    burst(e, out, t, 0.015, a * 0.2, 'bandpass', 2500);
  },
  tom(e, out, t, p, d, a, n, P) {  // dhol-style low drum with a slap
    tone(e, out, 'sine', 170 * semis(P.tune), 92 * semis(P.tune), t, P.decay, a * 0.9);
    burst(e, out, t, 0.03, a * 0.35, 'bandpass', 900, 1);
  },
  tabla(e, out, t, p, d, a, n, P) {  // bright ringing "na" with a pitch bend, plus a slap
    const c = e.ctx, f = 390 * semis(P.tune + (p - 60)), o = osc(c, 'sine', f, t), g = attack(c, t, 0.002, a * 0.6);
    o.frequency.setValueAtTime(f * (1 + 0.25 * P.bend), t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    o.connect(g).connect(out);
    tone(e, out, 'sine', f * 2.01, f * 2, t, 0.2, a * 0.15);
    run([o], t, t + 0.5);
    burst(e, out, t, 0.02, a * 0.3, 'bandpass', 3000, 2);
  },
  cowbell(e, out, t, p, d, a, n, P) {  // two detuned squares, the 808 recipe; pitched so it can play melodies
    const c = e.ctx, f = mtof(p), bp = filter(c, 'bandpass', f * P.tone, 1.5), g = attack(c, t, 0.002, a * 0.35);
    g.gain.exponentialRampToValueAtTime(a * 0.12 + 0.0002, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(P.decay * 2, Math.max(0.2, d + 0.1)));
    const oscs = [osc(c, 'square', f, t), osc(c, 'square', f * 1.4983, t)];
    oscs.forEach(o => o.connect(bp));
    bp.connect(g).connect(out);
    run(oscs, t, t + P.decay * 2 + 0.1);
  },
  808(e, out, t, p, d, a, n, P) {
    const c = e.ctx, f = mtof(p), o = osc(c, 'sine', f, t), sh = c.createWaveShaper(), g = c.createGain(), end = t + Math.max(0.15, d);
    if (n.g && n.from != null) {  // slide from the previous note
      o.frequency.setValueAtTime(mtof(n.from), t);
      o.frequency.exponentialRampToValueAtTime(f, t + P.glide);
    } else {
      o.frequency.setValueAtTime(f * 2, t);
      o.frequency.exponentialRampToValueAtTime(f, t + 0.04);
    }
    sh.curve = drive(P.drive);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(a * 0.85, t + (n.g ? 0.015 : 0.004));
    g.gain.setTargetAtTime(a * 0.5, t + 0.06, P.decay * 0.7);
    g.gain.setTargetAtTime(0.0001, end, 0.04);
    o.connect(sh).connect(filter(c, 'lowpass', P.tone)).connect(g).connect(out);
    run([o], t, end + 0.25);
  },
  bass(e, out, t, p, d, a, n, P) {
    const c = e.ctx, f = mtof(p), lp = filter(c, 'lowpass', P.cutoff, P.res), g = attack(c, t, 0.005, a * 0.5), end = t + Math.max(0.08, d);
    lp.frequency.setValueAtTime(P.cutoff, t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(80, P.cutoff * 0.22), t + P.decay);
    g.gain.setTargetAtTime(a * 0.38, t + 0.01, 0.2);
    g.gain.setTargetAtTime(0.0001, end, 0.03);
    const saw = osc(c, 'sawtooth', f, t), sub = osc(c, 'sine', f, t);
    saw.connect(lp).connect(g);
    sub.connect(g);
    g.connect(out);
    run([saw, sub], t, end + 0.2);
  },
  acid(e, out, t, p, d, a, n, P) {  // a 303-style line: one oscillator into a squelchy resonant filter; loud notes accent, tied notes slide
    const c = e.ctx, f = mtof(p), acc = a > 0.8 ? P.accent : 0, slide = n.g && n.from != null, end = t + Math.max(0.05, d);
    const o = osc(c, P.wave >= 0.5 ? 'square' : 'sawtooth', slide ? mtof(n.from) : f, t), lp = filter(c, 'lowpass', P.cutoff, P.res * (1 + acc * 0.5)), sh = c.createWaveShaper(), g = c.createGain();
    if (slide) o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const top = Math.min(16000, P.cutoff * (1 + P.env * 10 * (1 + acc)));
    lp.frequency.setValueAtTime(slide ? P.cutoff * (1 + P.env * 3) : top, t);
    lp.frequency.exponentialRampToValueAtTime(P.cutoff, t + P.decay * (acc ? 0.6 : 1));
    sh.curve = drive(P.drive);
    const lvl = a * 0.32 * (1 + acc * 0.4);
    g.gain.setValueAtTime(slide ? lvl : 0.0001, t);
    if (!slide) g.gain.exponentialRampToValueAtTime(lvl, t + 0.003);
    g.gain.setTargetAtTime(0.0001, end, 0.012);
    o.connect(lp).connect(sh).connect(g).connect(out);
    run([o], t, end + 0.1);
  },
  reese(e, out, t, p, d, a, n, P) {  // two detuned saws: the dark drill and drum-and-bass bass
    const c = e.ctx, f = mtof(p), lp = filter(c, 'lowpass', P.cutoff, 1.5), sh = c.createWaveShaper(), g = attack(c, t, 0.01, a * 0.32), end = t + Math.max(0.1, d);
    sh.curve = drive(P.drive);
    g.gain.setTargetAtTime(0.0001, end, 0.05);
    const oscs = [-P.detune, P.detune].map(cents => { const o = osc(c, 'sawtooth', f, t); o.detune.value = cents; o.connect(lp); return o; });
    const sub = osc(c, 'sine', f, t);
    sub.connect(gain(c, 0.8)).connect(g);
    lp.connect(sh).connect(g).connect(out);
    run([...oscs, sub], t, end + 0.3);
  },
  logdrum(e, out, t, p, d, a, n, P) {
    const c = e.ctx, f = mtof(p), o = osc(c, 'sine', f * 1.6, t), sh = c.createWaveShaper(), g = attack(c, t, 0.003, a * 0.8);
    const len = Math.min(0.6, Math.max(0.12, d));
    o.frequency.exponentialRampToValueAtTime(f, t + 0.05);
    sh.curve = drive(P.drive);
    g.gain.setTargetAtTime(0.0001, t + 0.05, P.decay * len * 2);
    o.connect(sh).connect(g).connect(out);
    run([o], t, t + len + 0.3);
  },
  keys(e, out, t, p, d, a, n, P) {  // FM electric piano: 1:1 modulator for the bark, a faint high tine
    const c = e.ctx, f = mtof(p), car = osc(c, 'sine', f, t), mod = osc(c, 'sine', f, t), idx = c.createGain();
    const g = attack(c, t, 0.004, a * 0.35), end = t + Math.max(0.1, d), trem = c.createGain();
    idx.gain.setValueAtTime(f * (0.2 + a * 2.4 * P.bright), t);
    idx.gain.exponentialRampToValueAtTime(f * 0.05 + 0.01, t + 1.2);
    mod.connect(idx).connect(car.frequency);
    g.gain.setTargetAtTime(a * 0.16, t + 0.01, P.decay);
    g.gain.setTargetAtTime(0.0001, end, 0.2);
    const lfo = osc(c, 'sine', 4.5, t), depth = gain(c, P.trem * 0.5);
    lfo.connect(depth).connect(trem.gain);
    trem.gain.value = 1 - P.trem * 0.5;
    car.connect(g).connect(trem).connect(out);
    tone(e, out, 'sine', f * 7, f * 7, t, 0.08, a * 0.06 * P.tine);
    run([car, mod, lfo], t, end + 1.2);
  },
  piano(e, out, t, p, d, a, n, P) {
    const c = e.ctx, f = mtof(p), tau = P.decay * (0.25 + Math.max(0, 84 - p) / 48), end = t + Math.max(0.1, d), g = attack(c, t, 0.003, a * 0.3);
    g.gain.setTargetAtTime(0.0001, t + 0.003, tau);
    g.gain.setTargetAtTime(0.0001, end, 0.12);
    const oscs = [[1, 1], [2, 0.2 + 0.4 * P.bright], [3, 0.08 + 0.2 * P.bright], [4.02, 0.1 * P.bright]].map(([m, lvl]) => {
      const o = osc(c, m === 1 ? 'triangle' : 'sine', f * m, t);
      o.connect(gain(c, lvl)).connect(g);
      return o;
    });
    g.connect(out);
    burst(e, out, t, 0.025, a * 0.08, 'bandpass', 2500);
    run(oscs, t, end + 0.8);
  },
  organ(e, out, t, p, d, a, n, P) {
    const c = e.ctx, f = mtof(p), g = attack(c, t, 0.01, a * 0.16), end = t + Math.max(0.08, d), lfo = osc(c, 'sine', 5.8, t), lg = gain(c, P.leslie * 0.35);
    const trem = gain(c, 1 - P.leslie * 0.35);
    lfo.connect(lg).connect(trem.gain);
    g.gain.setTargetAtTime(0.0001, end, 0.06);
    const oscs = [[0.5, 0.6], [1, 1], [2, 0.3 + 0.7 * P.drawbar], [3, 0.5 * P.drawbar], [4, 0.4 * P.drawbar]].map(([m, lvl]) => {
      const o = osc(c, 'sine', f * m, t);
      o.connect(gain(c, lvl)).connect(g);
      return o;
    });
    g.connect(trem).connect(out);
    run([...oscs, lfo], t, end + 0.4);
  },
  pad(e, out, t, p, d, a, n, P) {
    const c = e.ctx, f = mtof(p), lp = filter(c, 'lowpass', P.cutoff), g = attack(c, t, P.attack, a * 0.12), end = t + Math.max(0.2, d);
    g.gain.setTargetAtTime(0.0001, end, P.release);
    const oscs = [-P.detune, 0, P.detune].map(cents => { const o = osc(c, 'sawtooth', f, t); o.detune.value = cents; o.connect(lp); return o; });
    lp.connect(g).connect(out);
    run(oscs, t, end + P.release * 5);
  },
  strings(e, out, t, p, d, a, n, P) {
    const c = e.ctx, f = mtof(p), lp = filter(c, 'lowpass', P.cutoff), g = attack(c, t, P.attack, a * 0.11), end = t + Math.max(0.3, d);
    const vib = osc(c, 'sine', 5, t), depth = gain(c, P.vibrato);
    vib.connect(depth);
    g.gain.setTargetAtTime(0.0001, end, 0.3);
    const oscs = [-7, 0, 7].map(cents => { const o = osc(c, 'sawtooth', f, t); o.detune.value = cents; depth.connect(o.detune); o.connect(lp); return o; });
    lp.connect(g).connect(out);
    run([...oscs, vib], t, end + 1.6);
  },
  guitar(e, out, t, p, d, a, n, P) {  // Karplus-Strong plucked string
    const c = e.ctx, src = c.createBufferSource(), g = c.createGain(), { buf, rate } = e.string(p), end = t + Math.max(0.1, d);
    src.buffer = buf;
    src.playbackRate.value = rate;
    g.gain.setValueAtTime(a * 1.6, t);
    g.gain.setTargetAtTime(0.0001, t, 0.3 + P.sustain * 2);
    g.gain.setTargetAtTime(0.0001, end, 0.08);
    src.connect(filter(c, 'lowpass', P.tone)).connect(g).connect(out);
    src.start(t);
    src.stop(end + 0.5);
  },
  sitar(e, out, t, p, d, a, n, P) {  // a plucked string through a buzzing bridge and a nasal resonance
    const c = e.ctx, src = c.createBufferSource(), g = c.createGain(), sh = c.createWaveShaper(), { buf, rate } = e.string(p), end = t + Math.max(0.1, d);
    src.buffer = buf;
    src.playbackRate.value = rate;
    sh.curve = drive(0.3 + P.buzz * 0.7);
    const peak = filter(c, 'peaking', 2800, 3);
    peak.gain.value = 9 * P.buzz;
    g.gain.setValueAtTime(a * 0.9, t);
    g.gain.setTargetAtTime(0.0001, t, 0.3 + P.sustain * 2.5);
    g.gain.setTargetAtTime(0.0001, end + 0.3, 0.15);
    src.connect(sh).connect(peak).connect(filter(c, 'lowpass', 6000)).connect(g).connect(out);
    src.start(t);
    src.stop(end + 1);
  },
  pluck(e, out, t, p, d, a, n, P) {
    const c = e.ctx, f = mtof(p), lp = filter(c, 'lowpass', 4000, 2), g = attack(c, t, 0.002, a * 0.3), end = t + Math.max(0.1, Math.min(d, 1.2));
    lp.frequency.setValueAtTime(Math.min(16000, f * P.cutoff), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(300, f * 1.5), t + P.decay);
    g.gain.setTargetAtTime(0.0001, t + 0.01, P.decay);
    g.gain.setTargetAtTime(0.0001, end, 0.05);
    const saw = osc(c, 'sawtooth', f, t), sq = osc(c, 'square', f * 2, t);
    sq.detune.value = 5;
    saw.connect(lp);
    sq.connect(gain(c, 0.25)).connect(lp);
    lp.connect(g).connect(out);
    run([saw, sq], t, end + 0.5);
  },
  bell(e, out, t, p, d, a, n, P) {  // FM with an inharmonic ratio
    const c = e.ctx, f = mtof(p), car = osc(c, 'sine', f, t), mod = osc(c, 'sine', f * P.ratio, t), idx = c.createGain();
    const g = attack(c, t, 0.002, a * 0.28), end = t + Math.max(0.3, d);
    idx.gain.setValueAtTime(f * 3.5 * a * P.bright + 1, t);
    idx.gain.exponentialRampToValueAtTime(f * 0.05 + 0.01, t + 1.5);
    mod.connect(idx).connect(car.frequency);
    g.gain.setTargetAtTime(0.0001, t + 0.005, P.decay);
    g.gain.setTargetAtTime(0.0001, end, 0.35);
    car.connect(g).connect(out);
    run([car, mod], t, end + P.decay * 4);
  },
  flute(e, out, t, p, d, a, n, P) {
    const c = e.ctx, f = mtof(p), o = osc(c, 'sine', f * 0.985, t), o2 = osc(c, 'triangle', f * 2, t), g = attack(c, t, 0.06, a * 0.3);
    const end = t + Math.max(0.1, d), vib = osc(c, 'sine', 5.2, t), vg = c.createGain();
    o.frequency.exponentialRampToValueAtTime(f, t + 0.07);  // a small scoop into the note, like a bansuri
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(f * 0.014 * P.vibrato, t + 0.35);
    vib.connect(vg).connect(o.frequency);
    o2.connect(gain(c, 0.08)).connect(g);
    o.connect(g);
    g.gain.setTargetAtTime(0.0001, end, 0.08);
    g.connect(out);
    burst(e, out, t, Math.min(0.25, Math.max(0.05, d)), a * 0.1 * P.breath, 'bandpass', f * 2, 1);
    run([o, o2, vib], t, end + 0.5);
  },
  lead(e, out, t, p, d, a, n, P) {
    const c = e.ctx, f = mtof(p), lp = filter(c, 'lowpass', P.cutoff, 1), g = attack(c, t, 0.01, a * 0.16), end = t + Math.max(0.08, d);
    const vib = osc(c, 'sine', 5.5, t), vg = c.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(P.vibrato, t + 0.3);
    vib.connect(vg);
    g.gain.setTargetAtTime(0.0001, end, 0.08);
    const from = P.glide && n.from != null ? mtof(n.from) : f;
    const oscs = [-P.detune, P.detune].map(cents => {
      const o = osc(c, 'sawtooth', from, t);
      if (from !== f) o.frequency.exponentialRampToValueAtTime(f, t + P.glide);
      o.detune.value = cents;
      vg.connect(o.detune);
      o.connect(lp);
      return o;
    });
    lp.connect(g).connect(out);
    run([...oscs, vib], t, end + 0.5);
  },
  vox(e, out, t, p, d, a, n, P) {  // formant synth: a vocal "ah" morphing to "oo"
    const c = e.ctx, f = mtof(p), src = osc(c, 'sawtooth', f, t), g = attack(c, t, 0.08, a * 0.5), end = t + Math.max(0.1, d);
    const vib = osc(c, 'sine', 5, t), vg = c.createGain();
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(f * 0.01, t + 0.4);
    vib.connect(vg).connect(src.frequency);
    const lerp = (x, y) => x + (y - x) * P.vowel;
    [[lerp(800, 300), 1], [lerp(1150, 870), 0.5], [lerp(2900, 2240), 0.25]].forEach(([fq, lvl]) => src.connect(filter(c, 'bandpass', fq, 9)).connect(gain(c, lvl * 3)).connect(g));
    g.gain.setTargetAtTime(0.0001, end, 0.18);
    g.connect(out);
    burst(e, out, t, Math.min(0.3, d), a * 0.05 * P.breath, 'bandpass', 3000, 1);
    run([src, vib], t, end + 1);
  },
  brass(e, out, t, p, d, a, n, P) {
    const c = e.ctx, f = mtof(p), lp = filter(c, 'lowpass', 300, 2), g = attack(c, t, P.attack, a * 0.2), end = t + Math.max(0.08, d);
    lp.frequency.setValueAtTime(300, t);
    lp.frequency.exponentialRampToValueAtTime(1200 + 4500 * P.bright, t + P.attack + 0.05);
    lp.frequency.setTargetAtTime(900 + 2000 * P.bright, t + P.attack + 0.08, 0.3);
    g.gain.setTargetAtTime(0.0001, end, 0.07);
    const oscs = [-6, 6].map(cents => { const o = osc(c, 'sawtooth', f, t); o.detune.value = cents; o.connect(lp); return o; });
    lp.connect(g).connect(out);
    run(oscs, t, end + 0.4);
  },
  vinyl(e, out, t, p, d, a, n, P) {
    const c = e.ctx, src = c.createBufferSource(), g = c.createGain();
    src.buffer = e.crackle;
    src.loop = true;
    g.gain.value = a * P.crackle * 1.6;
    src.connect(g).connect(out);
    src.start(t, (t * 1.7) % 3.5);
    src.stop(t + d);
  },
  synth(e, out, t, p, d, a, n, P) {  // three oscillators with unison, a filter with its own envelope, an LFO
    const c = e.ctx, f = mtof(p), end = t + Math.max(0.03, d), stop = end + P.release * 5 + 0.05, peak = a * 0.2;
    const amp = c.createGain(), flt = c.createBiquadFilter(), trem = gain(c, 1 - P.lamp * 0.5), sources = [];
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + P.attack);
    amp.gain.setTargetAtTime(Math.max(0.0001, peak * P.sustain), t + P.attack, P.decay / 3);
    amp.gain.setTargetAtTime(0.0001, end, P.release / 4);
    flt.type = ['lowpass', 'bandpass', 'highpass'][Math.round(P.ftype)];
    flt.Q.value = P.res;
    const cut = P.cutoff, top = Math.min(18000, Math.max(30, cut * 2 ** (P.fenv * 5)));
    flt.frequency.setValueAtTime(cut, t);
    flt.frequency.linearRampToValueAtTime(top, t + Math.max(0.002, P.attack * 0.5));
    flt.frequency.setTargetAtTime(cut, t + Math.max(0.002, P.attack * 0.5), P.fdecay / 3);
    const lfo = osc(c, 'sine', P.lrate, t), toPitch = gain(c, P.lpitch), toCut = gain(c, cut * P.lcut * 0.8), toAmp = gain(c, P.lamp * 0.5);
    lfo.connect(toPitch);
    lfo.connect(toCut).connect(flt.frequency);
    lfo.connect(toAmp).connect(trem.gain);
    sources.push(lfo);
    const uni = Math.round(P.uni), from = P.glide > 0 && n.from != null ? mtof(n.from) : f;
    [[P.w1, P.o1, 0, P.l1], [P.w2, P.o2, P.d2, P.l2], [P.w3, P.o3, 0, P.l3]].forEach(([w, o, det, lvl]) => {
      if (lvl <= 0.001) return;
      const wave = Math.round(w), mult = 2 ** Math.round(o), level = gain(c, lvl / Math.sqrt(uni));
      level.connect(flt);
      if (wave === 4) {  // noise
        const src = c.createBufferSource();
        src.buffer = e.noise;
        src.loop = true;
        src.connect(level);
        sources.push(src);
        return;
      }
      for (let u = 0; u < uni; u++) {
        const o1 = osc(c, ['sine', 'triangle', 'sawtooth', 'square'][wave], from * mult, t);
        if (from !== f) o1.frequency.exponentialRampToValueAtTime(f * mult, t + P.glide);
        o1.detune.value = det + (uni > 1 ? P.spread * (u / (uni - 1) * 2 - 1) : 0);
        toPitch.connect(o1.detune);
        o1.connect(level);
        sources.push(o1);
      }
    });
    let tail = flt;
    if (P.drive > 0.01) { const sh = c.createWaveShaper(); sh.curve = drive(P.drive); tail = tail.connect(sh); }
    tail.connect(trem).connect(amp).connect(out);
    sources.forEach(x => { x.start(t); x.stop(stop); });
  },
  fm(e, out, t, p, d, a, n, P) {  // three sine operators; op 1 is heard, 2 and 3 bend it (or each other)
    const c = e.ctx, f = mtof(p), end = t + Math.max(0.03, d), stop = end + P.release * 5 + 0.05, ratio = i => +RATIOS[Math.round(i)];
    const amp = c.createGain(), peak = a * 0.3, bright = 0.4 + P.vel * a * 1.2;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + P.attack);
    amp.gain.setTargetAtTime(Math.max(0.0001, peak * P.sustain), t + P.attack, P.decay / 3);
    amp.gain.setTargetAtTime(0.0001, end, P.release / 4);
    const op = (r, depth, dec) => {
      const o = osc(c, 'sine', f * r, t), g = c.createGain(), hz = f * r * depth * bright;
      g.gain.setValueAtTime(hz, t);
      g.gain.setTargetAtTime(hz * 0.12, t, dec / 2);
      o.connect(g);
      return { o, g };
    };
    const o1 = osc(c, 'sine', f * ratio(P.r1), t), o2 = op(ratio(P.r2), P.i2, P.d2), o3 = op(ratio(P.r3), P.i3, P.d3), algo = Math.round(P.algo);
    o2.g.connect(o1.frequency);
    if (algo === 0) o3.g.connect(o2.o.frequency);
    else o3.g.connect(o1.frequency);
    o1.connect(amp);
    if (algo === 2) { const level = gain(c, Math.min(1, P.i3 / 6)); o3.o.connect(level).connect(amp); }  // op 3 heard on its own too
    amp.connect(out);
    run([o1, o2.o, o3.o], t, stop);
  },
  wave(e, out, t, p, d, a, n, P) {  // two neighbouring wavetables, cross-faded by the morph, scanned by an envelope and an LFO
    const c = e.ctx, f = mtof(p), end = t + Math.max(0.03, d), stop = end + P.release * 5 + 0.05, peak = a * 0.2;
    const ia = Math.round(P.table), [wa, wb] = [e.table(ia), e.table(ia + 1)];
    const amp = c.createGain(), lp = filter(c, 'lowpass', P.cutoff, P.res), ga = c.createGain(), gb = c.createGain(), mix = c.createConstantSource(), inv = gain(c, -1);
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.linearRampToValueAtTime(peak, t + P.attack);
    amp.gain.setTargetAtTime(Math.max(0.0001, peak * P.sustain), t + P.attack, P.decay / 3);
    amp.gain.setTargetAtTime(0.0001, end, P.release / 4);
    const m0 = Math.max(0, Math.min(1, P.morph)), m1 = Math.max(0, Math.min(1, P.morph + P.scan));
    mix.offset.setValueAtTime(m0, t);
    mix.offset.linearRampToValueAtTime(m1, t + P.scantime);
    ga.gain.value = 1;
    gb.gain.value = 0;
    mix.connect(gb.gain);
    mix.connect(inv).connect(ga.gain);
    const lfo = osc(c, 'sine', P.lrate, t), ld = gain(c, P.ldepth);
    lfo.connect(ld).connect(mix.offset);
    const uni = Math.round(P.uni), oscs = [];
    for (let u = 0; u < uni; u++) {
      const det = uni > 1 ? P.detune * (u / (uni - 1) * 2 - 1) : 0;
      for (const [wave, g] of [[wa, ga], [wb, gb]]) { const o = c.createOscillator(); o.setPeriodicWave(wave); o.frequency.setValueAtTime(f, t); o.detune.value = det; o.connect(g); oscs.push(o); }
    }
    const level = gain(c, 1 / Math.sqrt(uni));
    ga.connect(level);
    gb.connect(level);
    level.connect(lp).connect(amp).connect(out);
    [...oscs, lfo, mix].forEach(x => { x.start(t); x.stop(stop); });
  },
  slicer() {},  // silent until a loop is dropped on it; the engine plays its slices
  fx(e, out, t, p, d, a, n, P) {  // 60 riser, 61 impact, 62 downlifter, 63 crash
    if (p === 60) sweep(e, out, t, d, a * 0.35 * P.riser, 400, 9000, true);
    else if (p === 62) sweep(e, out, t, d, a * 0.3 * P.riser, 7000, 300, false);
    else if (p === 63) burst(e, out, t, 2.2, a * 0.35 * P.impact, 'highpass', 5000);
    else {
      tone(e, out, 'sine', 90, 32, t, 1.6, a * 0.9 * P.impact);
      burst(e, out, t, 0.5, a * 0.4 * P.impact, 'lowpass', 1500);
    }
  },
};

// Mid/side width: 0 is mono, 1 untouched, 2 twice as wide
function makeWidth(c) {
  const input = c.createGain(), output = c.createGain(), split = c.createChannelSplitter(2), merge = c.createChannelMerger(2);
  const g = Array.from({ length: 4 }, () => c.createGain());  // L->L, R->L, L->R, R->R
  input.connect(split);
  split.connect(g[0], 0); split.connect(g[1], 1); split.connect(g[2], 0); split.connect(g[3], 1);
  g[0].connect(merge, 0, 0); g[1].connect(merge, 0, 0); g[2].connect(merge, 0, 1); g[3].connect(merge, 0, 1);
  merge.connect(output);
  // L' = M + wS, R' = M - wS with M = (L+R)/2, S = (L-R)/2
  const set = w => { const a = (1 + w) / 2, b = (1 - w) / 2; g[0].gain.value = a; g[1].gain.value = b; g[2].gain.value = b; g[3].gain.value = a; };
  set(1);
  return { input, output, set };
}
const IMPULSES = new Map();
const impulseFor = (c, secs) => {  // reverb tails are slow to build, so each size is made once per context
  const key = Math.round(secs * 10);
  let m = IMPULSES.get(c);
  if (!m) IMPULSES.set(c, m = new Map());
  if (!m.has(key)) m.set(key, impulse(c, key / 10));
  return m.get(key);
};

// Insert effect units: {input, output, set(params, bpm)}
function makeEffect(c, fx) {
  const input = c.createGain(), output = c.createGain();
  let set, sync = null, unitFilters = null, unitMod = null;
  if (fx.type === 'eq') {
    const lo = filter(c, 'lowshelf', 120), mid = filter(c, 'peaking', 1000, 0.8), hi = filter(c, 'highshelf', 8000);
    input.connect(lo).connect(mid).connect(hi).connect(output);
    set = P => { lo.gain.value = P.low; mid.gain.value = P.mid; mid.frequency.value = P.midf; hi.gain.value = P.high; };
  } else if (fx.type === 'limiter') {
    const pre = c.createGain(), lim = c.createDynamicsCompressor(), post = c.createWaveShaper();
    Object.entries({ knee: 0, ratio: 20, attack: 0.001, release: 0.08 }).forEach(([k, v]) => { lim[k].value = v; });
    input.connect(pre).connect(lim).connect(post).connect(output);
    set = P => { pre.gain.value = 10 ** (P.gain / 20); lim.threshold.value = P.ceiling - 1; const ceil = 10 ** (P.ceiling / 20); post.curve = shape(x => Math.max(-ceil, Math.min(ceil, x))); };
  } else if (fx.type === 'tape') {
    const sh = c.createWaveShaper(), tone = filter(c, 'lowpass', 9000, 0.5), dl = c.createDelay(0.05), lfo = c.createOscillator(), depth = gain(c, 0);
    dl.delayTime.value = 0.006;
    lfo.frequency.value = 0.6;
    lfo.connect(depth).connect(dl.delayTime);
    lfo.start();
    input.connect(sh).connect(tone).connect(dl).connect(output);
    set = P => { sh.curve = drive(P.drive * 0.7); tone.frequency.value = P.tone; depth.gain.value = 0.0025 * P.wow; };
  } else if (fx.type === 'phaser') {
    const stages = Array.from({ length: 4 }, (_, i) => filter(c, 'allpass', 400 + i * 500, 0.6)), lfo = c.createOscillator(), depth = gain(c, 600), wet = gain(c, 0.5);
    lfo.connect(depth);
    for (const s of stages) depth.connect(s.frequency);
    lfo.start();
    stages.reduce((prev, s) => prev.connect(s), input).connect(wet).connect(output);
    input.connect(output);
    set = P => { lfo.frequency.value = P.rate; depth.gain.value = 900 * P.depth; wet.gain.value = P.mix; };
  } else if (fx.type === 'flanger') {
    const dl = c.createDelay(0.03), fb = gain(c, 0.5), lfo = c.createOscillator(), depth = gain(c, 0.002), wet = gain(c, 0.5);
    dl.delayTime.value = 0.004;
    lfo.connect(depth).connect(dl.delayTime);
    lfo.start();
    input.connect(dl).connect(wet).connect(output);
    dl.connect(fb).connect(dl);
    input.connect(output);
    set = P => { lfo.frequency.value = P.rate; depth.gain.value = 0.0035 * P.depth; fb.gain.value = P.feedback; wet.gain.value = P.mix; };
  } else if (fx.type === 'tremolo') {
    const amp = gain(c, 1), lfo = c.createOscillator(), depth = gain(c, 0.25);
    lfo.connect(depth).connect(amp.gain);
    lfo.start();
    input.connect(amp).connect(output);
    set = P => { lfo.frequency.value = P.rate; depth.gain.value = P.depth / 2; amp.gain.value = 1 - P.depth / 2; };
  } else if (fx.type === 'width') {
    const w = makeWidth(c);
    input.connect(w.input);
    w.output.connect(output);
    set = P => w.set(P.width);
  } else if (fx.type === 'delay') {
    const dl = c.createDelay(4), dr = c.createDelay(4), fb = gain(c, 0.35), cross = gain(c, 0), tone = filter(c, 'lowpass', 5000), wet = gain(c, 0.3);
    const merge = c.createChannelMerger(2), mono = gain(c, 1);
    input.connect(output);
    input.connect(mono);
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    mono.connect(dl);
    dl.connect(tone).connect(fb);
    fb.connect(dl);            // straight echoes
    fb.connect(cross).connect(dr);  // ping-pong: every other echo on the right
    const both = gain(c, 0);  // without ping-pong the echoes sit in the middle
    dl.connect(merge, 0, 0);
    dl.connect(both).connect(merge, 0, 1);
    dr.connect(merge, 0, 1);
    merge.connect(wet).connect(output);
    set = (P, bpm = 120) => {
      const beats = DELAY_TIMES[Math.round(Math.max(0, Math.min(4, P.time)))][1], secs = beats * 60 / bpm;
      dl.delayTime.value = secs;
      dr.delayTime.value = secs;
      fb.gain.value = P.feedback;
      cross.gain.value = P.pingpong > 0.5 ? 1 : 0;
      both.gain.value = P.pingpong > 0.5 ? 0 : 1;
      wet.gain.value = P.mix;
    };
  } else if (fx.type === 'reverb') {
    const conv = c.createConvolver(), tone = filter(c, 'lowpass', 7000), wet = gain(c, 0.3), dry = gain(c, 1);
    input.connect(dry).connect(output);
    input.connect(conv).connect(tone).connect(wet).connect(output);
    let size = 0;
    set = P => {
      if (Math.abs(P.size - size) > 0.05) { conv.buffer = impulseFor(c, P.size); size = P.size; }
      tone.frequency.value = P.tone;
      wet.gain.value = P.mix;
      dry.gain.value = 1 - P.mix * 0.5;
    };
  } else if (fx.type === 'filter') {
    const f = filter(c, 'lowpass', 8000);
    input.connect(f).connect(output);
    set = P => { f.type = P.hp > 0.5 ? 'highpass' : 'lowpass'; f.frequency.value = P.cutoff; f.Q.value = P.res; };
  } else if (fx.type === 'drive' || fx.type === 'crush') {
    const sh = c.createWaveShaper(), tone = filter(c, 'lowpass', 6000), wet = gain(c, 1), dry = gain(c, 0);
    input.connect(sh).connect(tone).connect(wet).connect(output);
    input.connect(dry).connect(output);
    set = fx.type === 'drive'
      ? P => { sh.curve = drive(P.amount); tone.frequency.value = P.tone; wet.gain.value = P.mix; dry.gain.value = 1 - P.mix; }
      : P => { const q = 2 ** (Math.round(P.bits) - 1); sh.curve = shape(x => Math.round(x * q) / q); tone.frequency.value = 20000; wet.gain.value = P.mix; dry.gain.value = 1 - P.mix; };
  } else if (fx.type === 'chorus') {
    const dl = c.createDelay(0.05), lfo = c.createOscillator(), depth = gain(c, 0.003), wet = gain(c, 0.5);
    dl.delayTime.value = 0.015;
    lfo.connect(depth).connect(dl.delayTime);
    lfo.start();
    input.connect(output);
    input.connect(dl).connect(wet).connect(output);
    set = P => { lfo.frequency.value = P.rate; depth.gain.value = 0.006 * P.depth; wet.gain.value = P.mix; };
  } else if (fx.type === 'peq') {
    const lo = filter(c, 'lowshelf', 80), p1 = filter(c, 'peaking', 400, 1), p2 = filter(c, 'peaking', 3000, 1), hi = filter(c, 'highshelf', 9000);
    input.connect(lo).connect(p1).connect(p2).connect(hi).connect(output);
    set = P => {
      lo.frequency.value = P.lf; lo.gain.value = P.lg; p1.frequency.value = P.f1; p1.gain.value = P.g1; p1.Q.value = P.q1;
      p2.frequency.value = P.f2; p2.gain.value = P.g2; p2.Q.value = P.q2; hi.frequency.value = P.hf; hi.gain.value = P.hg;
    };
    unitFilters = [lo, p1, p2, hi];
  } else if (fx.type === 'multiband') {
    // Linkwitz-Riley splits (two Butterworths in a row) add back up flat, so with no squash it's transparent
    const lr = (type, f) => { const a = filter(c, type, f, 0.7071), b = filter(c, type, f, 0.7071); a.connect(b); return [a, b]; };
    const [l1, l2] = lr('lowpass', 180), [m1, m2] = lr('highpass', 180), [m3, m4] = lr('lowpass', 3500), [h1, h2] = lr('highpass', 3500), out = gain(c, 1);
    const comps = [0, 1, 2].map(() => c.createDynamicsCompressor()), makeup = [0, 1, 2].map(() => gain(c, 1));
    input.connect(l1); l2.connect(comps[0]);
    input.connect(m1); m2.connect(m3); m4.connect(comps[1]);
    input.connect(h1); h2.connect(comps[2]);
    comps.forEach((k, i) => { k.knee.value = 6; k.attack.value = [0.02, 0.008, 0.003][i]; k.release.value = [0.2, 0.12, 0.08][i]; k.connect(makeup[i]).connect(out); });
    out.connect(output);
    set = P => {
      for (const f of [l1, l2, m1, m2]) f.frequency.value = P.x1;
      for (const f of [m3, m4, h1, h2]) f.frequency.value = Math.max(P.x2, P.x1 * 2);
      [P.low, P.mid, P.high].forEach((a, i) => { comps[i].threshold.value = -6 - a * 30; comps[i].ratio.value = 1 + a * 7; makeup[i].gain.value = 10 ** (a * 9 / 20); });
      out.gain.value = 10 ** (P.out / 20);
    };
  } else if (fx.type === 'gate' || fx.type === 'autopan') {
    // A square or sine wave at the beat's rate opens and closes the volume (or swings the pan). It restarts at
    // every play so the gate lands on the beat.
    const isGate = fx.type === 'gate', amp = gain(c, 1), pan = c.createStereoPanner(), smooth = filter(c, 'lowpass', 200, 0.5), depth = gain(c, 0);
    let lfo = null, P0 = null, bpm0 = 120;
    const rate = (P, bpm) => (bpm / 60) / (isGate ? GATE_TIMES : PAN_TIMES)[Math.round(Math.max(0, Math.min(4, P.rate)))][1];
    const start = t => {
      try { lfo?.stop(t); } catch { /* not started */ }  // the old one runs until the new one takes over
      lfo = c.createOscillator();
      lfo.type = isGate ? 'square' : 'sine';
      lfo.frequency.value = P0 ? rate(P0, bpm0) : 2;
      lfo.connect(isGate ? smooth : depth);
      lfo.start(t);
    };
    if (isGate) { smooth.connect(depth).connect(amp.gain); input.connect(amp).connect(output); } else { depth.connect(pan.pan); input.connect(pan).connect(output); }
    start(c.currentTime);
    set = (P, bpm = 120) => {
      P0 = P; bpm0 = bpm;
      lfo.frequency.value = rate(P, bpm);
      if (isGate) { depth.gain.value = P.depth / 2; amp.gain.value = 1 - P.depth / 2; smooth.frequency.value = 30 + (1 - P.smooth) * 900; } else depth.gain.value = P.depth;
    };
    sync = start;
  } else if (fx.type === 'vocoder') {
    const modIn = c.createGain(), wet = gain(c, 1), dry = gain(c, 0), sum = gain(c, 8);  // each narrow band passes a sliver of the sound, so the sum needs make-up gain
    const ABS = shape(x => Math.abs(x));
    let bank = [], n = 0;
    const build = (bands, react) => {
      bank.forEach(b => { b.car.disconnect(); b.mod.disconnect(); b.vca.disconnect(); });
      bank = Array.from({ length: bands }, (_, i) => {
        const f = 110 * (8000 / 110) ** (i / (bands - 1)), q = bands * 0.45;
        const car = filter(c, 'bandpass', f, q), mod = filter(c, 'bandpass', f, q), rect = c.createWaveShaper(), env = filter(c, 'lowpass', react, 0.5), vca = gain(c, 0), k = gain(c, 6);
        rect.curve = ABS;
        input.connect(car).connect(vca).connect(sum);
        modIn.connect(mod).connect(rect).connect(env).connect(k).connect(vca.gain);
        return { car, mod, vca, env, k };
      });
      n = bands;
    };
    sum.connect(wet).connect(output);
    input.connect(dry).connect(output);
    set = P => {
      const bands = VOCODER_BANDS[Math.round(Math.max(0, Math.min(2, P.bands)))][1];
      if (bands !== n) build(bands, P.react);
      for (const b of bank) { b.env.frequency.value = P.react; b.k.gain.value = 6 * 10 ** (P.boost / 20) / Math.sqrt(bands); }
      wet.gain.value = P.mix;
      dry.gain.value = 1 - P.mix;
    };
    unitMod = modIn;
  } else if (DSP_FX[fx.type]) {  // runs on the audio thread (dsp.js); knobs are AudioParams
    let node = null, vals = { t0: 0 };
    const apply = () => { if (node) for (const [k, v] of Object.entries(vals)) node.parameters.get(k)?.setValueAtTime(v, c.currentTime); };
    const attach = () => { node = new AudioWorkletNode(c, DSP_FX[fx.type], { outputChannelCount: [2] }); input.disconnect(); input.connect(node).connect(output); apply(); };
    if (DSP_READY.has(c)) attach(); else { input.connect(output); loadDsp(c).then(attach, () => { /* no AudioWorklet: the sound passes through */ }); }
    set = (P, bpm, keyMask) => {
      vals = { ...vals, ...P, bpm };
      if (fx.type === 'tune') vals.mask = Math.round(P.key) ? maskOf(SCALE_PCS[Math.round(P.scale)].map(i => Math.round(P.key) - 1 + i)) : keyMask;
      apply();
    };
    sync = t => { vals.t0 = t; apply(); };
  } else {  // compressor
    const comp = c.createDynamicsCompressor(), makeup = gain(c, 1);
    comp.release.value = 0.15;
    input.connect(comp).connect(makeup).connect(output);
    set = P => { comp.threshold.value = P.threshold; comp.ratio.value = P.ratio; comp.attack.value = P.attack; makeup.gain.value = 10 ** (P.gain / 20); };
  }
  return { input, output, sync, filters: unitFilters, mod: unitMod, set: (own, bpm, keyMask) => set(Object.fromEntries(EFFECTS[fx.type].params.map(([id, , , , def]) => [id, own[id] ?? def])), bpm, keyMask) };
}

// A reversed copy of a buffer, for clips played backwards
const REVERSED = new WeakMap();
function reversed(buf) {
  if (!REVERSED.has(buf)) {
    const r = new AudioBuffer({ length: buf.length, numberOfChannels: buf.numberOfChannels, sampleRate: buf.sampleRate });
    for (let i = 0; i < buf.numberOfChannels; i++) r.copyToChannel(buf.getChannelData(i).slice().reverse(), i);
    REVERSED.set(buf, r);
  }
  return REVERSED.get(buf);
}

export class Engine {
  constructor(ctx) {
    const c = this.ctx = ctx;
    this.bpm = 120;
    this.bus = c.createGain();
    this.tone = filter(c, 'lowpass', 20000, 0.5);  // "dusty" lofi master filter
    this.width = makeWidth(c);
    const glue = this.glue = c.createDynamicsCompressor(), limit = this.limit = c.createDynamicsCompressor(), clip = c.createWaveShaper();
    Object.entries({ threshold: -12, knee: 8, ratio: 2.5, attack: 0.015, release: 0.25 }).forEach(([k, v]) => { glue[k].value = v; });
    Object.entries({ threshold: -4, knee: 0, ratio: 20, attack: 0.002, release: 0.12 }).forEach(([k, v]) => { limit[k].value = v; });
    clip.curve = CLIP;
    clip.oversample = '2x';
    this.out = gain(c, 0.9);
    this.bus.connect(this.tone).connect(this.width.input);
    this.width.output.connect(glue).connect(limit).connect(clip).connect(this.out).connect(c.destination);
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 2048;
    this.out.connect(this.analyser);
    this.reverb = c.createConvolver();
    this.reverb.buffer = impulse(c, 2.2);
    this.reverb.connect(this.bus);
    this.delay = c.createDelay(2);
    const fb = gain(c, 0.32), dtone = filter(c, 'lowpass', 3500);
    this.delay.connect(dtone).connect(fb).connect(this.delay);
    dtone.connect(this.bus);
    this.noise = noiseBuffer(c);
    this.crackle = crackleBuffer(c);
    this.strips = new Map();
    this.ks = new Map();
    this.keyMask = 4095;  // the song's scale, for Tune
    loadDsp(c).catch(() => { /* older browsers: those effects pass sound through */ });
    this.open = [];  // ringing open hats, cut off by the next closed hat
  }

  setTempo(bpm) {
    this.bpm = bpm;
    this.delay.delayTime.value = 0.75 * 60 / bpm;  // dotted 8th echoes
    for (const s of this.strips.values()) this.setEffects(s, s.list ?? [], true);  // tempo-synced delays follow
  }
  setKey(pcs) {
    const m = maskOf(pcs);
    if (m === this.keyMask) return;
    this.keyMask = m;
    for (const s of this.strips.values()) this.setEffects(s, s.list ?? [], true);
  }
  setDusty(on) { this.tone.frequency.value = on ? 6500 : 20000; }
  setMaster(v) { this.out.gain.value = 0.9 * v; }
  // The master chain: glue compression amount 0..1, stereo width, limiter ceiling in dB
  setMasterChain({ glue = 0.5, width = 1, ceiling = -1 } = {}) {
    this.glue.threshold.value = -2 - glue * 20;
    this.glue.ratio.value = 1.5 + glue * 2;
    this.width.set(width);
    this.limit.threshold.value = ceiling - 3;
  }

  // A mixer strip: automation, volume, sidechain duck, insert effects, pan, meter, reverb and delay sends
  strip(id) {
    let s = this.strips.get(id);
    if (!s) {
      const c = this.ctx;
      s = { input: c.createGain(), auto: c.createGain(), lp: filter(c, 'lowpass', 20000, 0.7), duck: c.createGain(), pan: c.createStereoPanner(), rev: c.createGain(), dly: c.createGain(), meter: c.createAnalyser(), chain: [], sig: '' };
      s.meter.fftSize = 512;
      s.input.connect(s.auto).connect(s.lp).connect(s.duck).connect(s.pan);
      s.pan.connect(this.bus);
      s.dest = this.bus;
      s.pan.connect(s.meter);
      s.pan.connect(s.rev).connect(this.reverb);
      s.pan.connect(s.dly).connect(this.delay);
      this.strips.set(id, s);
    }
    return s;
  }

  setEffects(s, list, force = false) {
    const on = list.filter(f => !f.off), sig = on.map(f => f.type).join();
    if (sig !== s.sig || (force && !on.length && s.sig)) {  // rebuild only when effects are added, removed, bypassed or reordered
      s.duck.disconnect();
      s.chain.forEach(u => u.output.disconnect());
      s.chain = on.map(f => makeEffect(this.ctx, f));
      let prev = s.duck;
      for (const u of s.chain) { prev.connect(u.input); prev = u.output; }
      prev.connect(s.pan);
      s.sig = sig;
    }
    s.list = list;
    on.forEach((f, i) => {
      const u = s.chain[i];
      u.set(f, this.bpm, this.keyMask);
      if (u.mod && u.source !== f.source) {  // the voice that shapes it: another channel, after its fader
        if (u.source) this.strips.get(u.source)?.pan.disconnect(u.mod);
        if (f.source && this.strip(f.source) !== s) this.strip(f.source).pan.connect(u.mod);
        u.source = f.source;
      }
    });
  }

  // Apply volume, pan, sends, effects, mute and solo; `only` renders a single track (for stems)
  mix(tracks, only = null, dry = false) {
    const solo = tracks.some(t => t.solo && t.kind !== 'bus');
    if (tracks.length > 1) this.buses = new Set(tracks.filter(t => t.kind === 'bus').map(t => t.id));
    for (const t of tracks) {
      const s = this.strip(t.id), bus = t.kind === 'bus';
      // a bus stays open for solos and single-part renders: what reaches it is already chosen upstream
      s.input.gain.value = bus ? (t.mute ? 0 : t.vol) : only ? (t.id === only ? t.vol : 0) : t.mute || (solo && !t.solo) ? 0 : t.vol;
      const dest = !bus && t.out && this.buses?.has(t.out) ? this.strip(t.out).input : this.bus;
      if (s.dest !== dest) { s.pan.disconnect(s.dest); s.pan.connect(dest); s.dest = dest; }
      s.pan.pan.value = t.pan;
      s.rev.gain.value = dry ? 0 : t.rev;
      s.dly.gain.value = dry ? 0 : t.dly;
      s.depth = t.duck ?? 0;
      this.setEffects(s, dry ? [] : t.fx ?? []);
    }
  }

  // Volume and filter automation from song-tick points, laid out from time `t0` (where tick 0 falls),
  // starting at tick `from`. Pattern loops reset the lanes to their resting values.
  automate(tracks, t0, spt, from, lanes, pointsOf = (t, lane) => t.auto?.[lane] ?? []) {
    const now = this.ctx.currentTime;
    for (const t of tracks) {
      const s = this.strip(t.id);
      for (const [lane, param] of [['vol', s.auto.gain], ['cut', s.lp.frequency], ['pan', s.pan.pan]]) {
        const spec = lanes[lane], pts = pointsOf(t, lane), start = Math.max(now, t0 + from * spt);
        param.cancelScheduledValues(start);
        if (!pts.length) { param.setValueAtTime(lane === 'pan' ? t.pan : spec.toParam(spec.def), start); continue; }  // at rest: the channel's own setting
        param.setValueAtTime(spec.toParam(valueAtTicks(pts, from, spec.def)), start);
        for (const p of pts) {
          if (p.t <= from) continue;
          const at = t0 + p.t * spt, v = spec.toParam(p.v);
          if (lane === 'cut') param.exponentialRampToValueAtTime(Math.max(20, v), at);
          else param.linearRampToValueAtTime(v, at);
        }
      }
    }
  }
  resetAutomation(tracks) {
    for (const t of tracks) {
      const s = this.strip(t.id);
      s.auto.gain.cancelScheduledValues(0);
      s.auto.gain.value = 1;
      s.lp.frequency.cancelScheduledValues(0);
      s.lp.frequency.value = 20000;
      s.pan.pan.cancelScheduledValues(0);
      s.pan.pan.value = t.pan;
    }
  }

  // Silence everything already scheduled; reverb and echo tails ring out naturally
  hush() {
    const now = this.ctx.currentTime;
    for (const s of this.strips.values()) {
      s.input.gain.setTargetAtTime(0, now, 0.015);
      setTimeout(() => s.input.disconnect(), 400);
    }
    this.strips = new Map();
    this.open = [];
  }

  play(track, n, when, spt, dest = null) {
    if (!this.strips.has(track.id)) this.mix([track]);
    const s = this.strips.get(track.id), t = Math.max(when, this.ctx.currentTime), d = n.d * spt, a = (n.v / 127) ** 1.5;
    if (track.id === 'kick') this.pump(t);
    if (track.id === 'hat') this.choke(t);
    let out = dest ?? s.input;
    if (track.id === 'openhat') {  // its own gain so a closed hat can cut it
      const g = this.ctx.createGain();
      g.connect(out);
      this.open.push(g);
      out = g;
    }
    if (track.sound === 'slicer' && track.sample) return this.slice(track, out, t, n, a);
    if (track.zoneBufs?.length) return this.multi(track, out, t, n.p, d, n.v);
    if (track.sample) return this.sample(track, out, t, n.p, d, a);
    const sound = SYNTHS[track.sound] ? track.sound : 'keys';
    SYNTHS[sound](this, out, t, n.p, d, a, n, paramsOf(sound, track.params));
  }

  // A note held from a MIDI keyboard: it sounds until release() fades it out
  liveOn(track, p, v) {
    const g = gain(this.ctx, 1), spt = 60 / (this.bpm * PPQ);
    g.connect(this.strip(track.id).input);
    this.play(track, { t: 0, d: track.kind === 'drum' ? STEP * 2 : PPQ * 16, p, v }, this.ctx.currentTime, spt, g);
    return { release: () => { g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.06); setTimeout(() => g.disconnect(), 1500); } };
  }

  // An audio clip on the playlist: `offset` seconds into the file, for `dur` seconds, with fades
  clip(track, c, buffer, when, offset = 0, dur = c.len) {
    if (!buffer || dur <= 0) return null;
    const ctx = this.ctx, src = ctx.createBufferSource(), g = ctx.createGain(), t = Math.max(when, ctx.currentTime);
    src.buffer = c.rev ? reversed(buffer) : buffer;
    const gainLin = 10 ** ((c.gain ?? 0) / 20), into = offset - (c.off ?? 0), fi = c.fi ?? 0, fo = c.fo ?? 0, end = c.len;
    // envelope across the whole clip, entered `into` seconds late when playback starts mid-clip
    const env = x => gainLin * Math.min(1, fi > 0 ? x / fi : 1, fo > 0 ? (end - x) / fo : 1);
    g.gain.setValueAtTime(env(into), t);
    if (fi > into) g.gain.linearRampToValueAtTime(gainLin, t + fi - into);
    if (fo > 0) { g.gain.setValueAtTime(env(Math.max(into, end - fo)), t + Math.max(0, end - fo - into)); g.gain.linearRampToValueAtTime(0, t + end - into); }
    src.connect(g).connect(this.strip(track.id).input);
    src.start(t, Math.max(0, offset), dur);
    return src;
  }

  click(t, accent) {  // metronome tick, straight to the speakers so it never ends up in an export
    const ctx = this.ctx, o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = accent ? 1600 : 1100;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(accent ? 0.35 : 0.22, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.06);
  }

  pump(t) {  // sidechain: every kick ducks the strips that ask for it
    for (const s of this.strips.values()) {
      if (!s.depth) continue;
      s.duck.gain.setTargetAtTime(1 - s.depth * 0.85, t, 0.004);
      s.duck.gain.setTargetAtTime(1, t + 0.04, 0.09);
    }
  }

  choke(t) {
    for (const g of this.open) g.gain.setTargetAtTime(0, t, 0.012);
    this.open = [];
  }

  // A sample from FL's library or a dropped file: drums play as they are, pitched sounds follow the notes
  sample(track, out, t, p, d, a) {
    const c = this.ctx, src = c.createBufferSource(), g = c.createGain(), P = paramsOf('sample', track.params);
    const root = track.params?.root ?? (track.kind === 'bass' ? 36 : 60);
    src.buffer = P.reverse > 0.5 ? reversed(track.sample) : track.sample;
    src.playbackRate.value = semis(P.tune + (track.kind === 'drum' ? 0 : p - root));
    g.gain.value = a;
    src.connect(g).connect(out);
    const startAt = P.start * src.buffer.duration;
    src.start(t, startAt);
    if (track.kind !== 'drum') {
      g.gain.setTargetAtTime(0, t + d, 0.05);
      src.stop(t + d + 0.4);
    }
  }

  // Multi-sampled: zones of recorded notes, each with its takes from soft to loud. Drums keep their pitch and
  // alternate between neighbouring takes, so repeated hits never sound copy-pasted.
  multi(track, out, t, p, d, v) {
    const c = this.ctx, P = paramsOf('inst', track.params), drum = track.kind === 'drum', zones = track.zoneBufs;
    let z = zones[0];
    for (const x of zones) if (Math.abs(x.root - p) < Math.abs(z.root - p)) z = x;
    const takes = z.bufs.filter(Boolean);
    if (!takes.length) return;
    let k = Math.min(takes.length - 1, Math.floor(v / 128 * takes.length));
    if (takes.length > 2) k = Math.max(0, Math.min(takes.length - 1, k + Math.round(Math.random() * 2 - 1)));
    const src = c.createBufferSource(), g = c.createGain(), lp = filter(c, 'lowpass', P.tone, 0.5);
    src.buffer = takes[k];
    src.playbackRate.value = semis(P.tune + (drum ? 0 : p - z.root));
    const level = drum ? 0.95 * (0.55 + 0.45 * v / 127) : 0.9 * (v / 127) ** 0.8;  // the takes carry most of the loudness already
    g.gain.setValueAtTime(P.attack > 0.005 ? 0.0001 : level, t);
    if (P.attack > 0.005) g.gain.linearRampToValueAtTime(level, t + P.attack);
    src.connect(lp).connect(g).connect(out);
    src.start(t);
    if (!drum) { g.gain.setTargetAtTime(0.0001, t + Math.max(d, P.attack), P.release / 4); src.stop(t + Math.max(d, P.attack) + P.release * 2 + 0.05); }
  }

  // A slice of the loop: notes above or below C5 pick a slice by pitch, steps in the rack play the slice
  // that sits under them, so moving steps around rearranges the loop
  slice(track, out, t, n, a) {
    const c = this.ctx, P = paramsOf('slicer', track.params), N = +SLICES[Math.round(P.slices)], buf = P.reverse > 0.5 ? reversed(track.sample) : track.sample;
    const idx = ((n.p !== 60 ? n.p - 60 : Math.round(n.t / STEP)) % N + N) % N, len = buf.duration / N, dur = len * P.gate;
    const src = c.createBufferSource(), g = c.createGain();
    src.buffer = buf;
    src.playbackRate.value = semis(P.tune);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + 0.003);
    g.gain.setValueAtTime(a, t + Math.max(0.004, dur / semis(P.tune) - 0.008));
    g.gain.linearRampToValueAtTime(0, t + dur / semis(P.tune));
    src.connect(g).connect(out);
    src.start(t, idx * len, dur);
  }

  table(i) {  // wavetables from harmonic recipes, made once per audio context
    this.tables ??= [];
    const k = Math.max(0, Math.min(TABLES.length - 1, i));
    if (!this.tables[k]) {
      const H = 48, re = new Float32Array(H + 1), im = new Float32Array(H + 1), name = TABLES[k];
      for (let h = 1; h <= H; h++) {
        im[h] = { Sine: h === 1 ? 1 : 0, Soft: 1 / h ** 2.2, Saw: 1 / h, Square: h % 2 ? 1 / h : 0, Hollow: h % 2 ? 1 / h ** 1.6 : 0.04 / h,
          Vocal: Math.exp(-(((h * 130 - 700) / 220) ** 2)) + 0.6 * Math.exp(-(((h * 130 - 1200) / 300) ** 2)) + 0.3 * Math.exp(-(((h * 130 - 2600) / 400) ** 2)) + (h === 1 ? 0.5 : 0),
          Organ: [1, 0.7, 0.5, 0.3, 0, 0.35, 0, 0.25][h - 1] ?? 0, Glass: [1, 0, 0, 0.4, 0, 0, 0.25, 0, 0, 0.18, 0, 0.12][h - 1] ?? 0, Digital: ((h * 7919) % 13) / 13 / h ** 0.7 }[name];
      }
      this.tables[k] = this.ctx.createPeriodicWave(re, im);
    }
    return this.tables[k];
  }

  sync(t) {  // tempo-locked effects restart on the beat
    for (const s of this.strips.values()) for (const u of s.chain) u.sync?.(t);
  }

  preview(buffer) {  // audition a sample from the browser
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain(this.ctx, 0.8)).connect(this.ctx.destination);
    src.start();
    return src;
  }

  level(id) {  // peak level 0..1 of a strip, for meters
    const s = this.strips.get(id);
    if (!s) return 0;
    const buf = s.buf ?? (s.buf = new Float32Array(s.meter.fftSize));
    s.meter.getFloatTimeDomainData(buf);
    let m = 0;
    for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i]));
    return m;
  }

  string(p) {  // cached Karplus-Strong buffer per pitch
    if (!this.ks.has(p)) {
      const c = this.ctx, sr = c.sampleRate, f = mtof(p), N = Math.max(2, Math.round(sr / f)), len = Math.floor(sr * 2.5);
      const buf = c.createBuffer(1, len, sr), out = buf.getChannelData(0), ring = new Float32Array(N);
      let lp = 0;
      for (let i = 0; i < N; i++) ring[i] = lp += 0.5 * (Math.random() * 2 - 1 - lp);  // softened pluck, nylon-like
      const damp = Math.min(0.999, 0.994 + (60 - p) * 0.0002);
      for (let i = 0, k = 0; i < len; i++) {
        const k2 = (k + 1) % N;
        out[i] = ring[k];
        ring[k] = damp * 0.5 * (ring[k] + ring[k2]);
        k = k2;
      }
      this.ks.set(p, { buf, rate: f * (N + 0.5) / sr });  // the averaging filter adds half a sample of delay
    }
    return this.ks.get(p);
  }
}

// Linear interpolation over automation points; the same rule as tools.valueAt, kept here so the
// engine has no editor dependency
function valueAtTicks(points, t, def) {
  if (!points.length) return def;
  if (t <= points[0].t) return points[0].v;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    if (t <= b.t) return b.t === a.t ? b.v : a.v + (b.v - a.v) * (t - a.t) / (b.t - a.t);
  }
  return points[points.length - 1].v;
}
export const LANES = {
  vol: { def: 0.8, toParam: v => v / 0.8 },
  cut: { def: 1, toParam: v => 20 * 1000 ** v },
  pan: { def: 0.5, toParam: v => v * 2 - 1 },
};
// A channel's automation for one lane. Automation clips on the playlist own the lane when there are any
// (each holds its last value until the next one starts, as in FL); otherwise the channel's own lane points.
export function autoPoints(song, t, lane) {
  const rows = song.playlist?.rows ?? [], clips = (song.playlist?.clips ?? []).filter(c => c.type === 'auto' && !c.mute && !rows[c.row]?.mute && c.target?.ch === t.id && c.target.param === lane);
  if (!clips.length) return t.auto?.[lane] ?? [];
  return clips.flatMap(c => c.points.map(q => ({ t: c.t + q.x * c.d, v: q.v }))).sort((a, b) => a.t - b.t);
}
const chance = n => n.c == null || Math.random() < n.c;
// Audio clips that should sound: not muted, on a playlist track that isn't muted (or is soloed)
function audioClips(song) {
  const rows = song.playlist.rows, solo = rows.some(r => r.solo);
  return song.playlist.clips.filter(c => c.type === 'audio' && !c.mute && !rows[c.row]?.mute && (!solo || rows[c.row]?.solo));
}  // steps with a chance below 100% sometimes skip

// Lookahead scheduler: every 25 ms, schedule whatever starts in the next 150 ms
export class Player {
  constructor(engine) {
    this.e = engine;
    this.playing = false;
    this.length = 1;
    this.bpm = 120;
    this.metronome = false;
    this.countUntil = 0;
  }

  // `audio` maps clip buffer ids to AudioBuffers; clips and automation only play in the song view
  load(song, view, dusty, audio = new Map()) {
    const a = arrange(song, view), steps = Math.ceil(a.length / STEP);
    this.song = song;
    this.view = view;
    this.length = a.length;
    this.sections = a.sections;
    this.bpm = song.bpm;
    this.buckets = Array.from({ length: steps }, () => []);
    for (const { track, notes } of a.events) for (const n of notes) this.buckets[Math.min(steps - 1, Math.floor(n.t / STEP))].push([track, n]);
    this.clips = view === 'song' ? audioClips(song).map(c => ({ track: song.tracks.find(t => t.id === c.ch), c, buffer: audio.get(c.buf) })).filter(x => x.track && x.buffer) : [];
    this.e.setTempo(song.bpm);
    this.e.setKey(songScale(song));
    this.e.setDusty(dusty);
    this.e.mix(song.tracks);
    if (this.playing) this.laneSchedule(this.position());
  }

  get spt() { return 60 / (this.bpm * PPQ); }  // seconds per tick

  // countIn: bars of metronome before the music starts (for recording)
  start(fromTick = 0, countIn = 0) {
    clearInterval(this.timer);
    const spt = this.spt, lead = countIn * 16 * STEP * spt, begin = this.e.ctx.currentTime + 0.08;
    this.step = Math.floor(fromTick / STEP);
    this.t0 = begin + lead - this.step * STEP * spt;
    this.countUntil = begin + lead;
    for (let b = 0; b < countIn * 4; b++) this.e.click(begin + b * 4 * STEP * spt, b % 4 === 0);
    this.playing = true;
    this.live = [];
    this.e.sync(this.t0 + Math.ceil((begin - this.t0) / (4 * STEP * spt)) * 4 * STEP * spt);  // the next bar line
    this.laneSchedule(fromTick);
    // clips already under way at the start point join in part-way through
    for (const x of this.clips) {
      const start = x.c.t * spt, end = start + x.c.len, at = fromTick * spt;
      if (start < at && end > at) this.live.push(this.e.clip(x.track, x.c, x.buffer, this.countUntil, (x.c.off ?? 0) + at - start, end - at));
    }
    this.timer = setInterval(() => this.pump(), 25);
    this.pump();
  }

  laneSchedule(fromTick) {  // automation for one pass through the song, from fromTick
    if (this.view === 'song') this.e.automate(this.song.tracks, this.t0 + Math.floor(this.step / this.buckets.length) * this.length * this.spt, this.spt, fromTick % this.length, LANES, (t, lane) => autoPoints(this.song, t, lane));
    else this.e.resetAutomation(this.song.tracks);
  }

  pump() {
    const now = this.e.ctx.currentTime, spt = this.spt, n = this.buckets.length;
    while (this.t0 + this.step * STEP * spt < now + 0.15) {
      const i = this.step % n, loopStart = this.t0 + (this.step - i) * STEP * spt;
      if (i === 0 && this.step > 0 && this.view === 'song') this.e.automate(this.song.tracks, loopStart, spt, 0, LANES, (t, lane) => autoPoints(this.song, t, lane));
      for (const [track, note] of this.buckets[i]) if (chance(note)) this.e.play(track, note, loopStart + note.t * spt, spt);
      for (const x of this.clips) {
        if (Math.floor(x.c.t / STEP) === i) this.live.push(this.e.clip(x.track, x.c, x.buffer, loopStart + x.c.t * spt, x.c.off ?? 0, x.c.len));
      }
      if (this.metronome && i % 4 === 0) this.e.click(loopStart + i * STEP * spt, i % 16 === 0);
      this.step++;
    }
  }

  setBpm(bpm) {  // keep the playhead where it is while the tempo changes
    if (this.playing) {
      const now = this.e.ctx.currentTime, tick = (now - this.t0) / this.spt;
      this.bpm = bpm;
      this.t0 = now - tick * this.spt;
    }
    this.bpm = bpm;
    this.e.setTempo(bpm);
  }

  stop() {
    clearInterval(this.timer);
    this.playing = false;
    for (const src of this.live ?? []) try { src?.stop(); } catch { /* already finished */ }
    this.live = [];
    this.e.hush();
  }

  // ticks since the start, looping; 0 while counting in
  position() { return Math.max(0, (this.e.ctx.currentTime - this.t0) / this.spt) % this.length; }
  get counting() { return this.playing && this.e.ctx.currentTime < this.countUntil; }
}

// Render offline. `only` renders one track for a stem. Options: sr (sample rate), audio (clip buffers),
// dry (no insert effects or sends, for dry stems), mute (track ids to leave out, for alternate versions),
// master (the master chain settings), level (master volume).
// Notes are created two seconds ahead of the render position: creating a whole song's notes up front
// makes every silent node get processed for the entire render, which is many times slower.
export async function render(song, view, dusty, only = null, opts = {}) {
  const { sr = 44100, audio = new Map(), dry = false, mute = [], master, level = 1 } = opts;
  const a = arrange(song, view), spt = 60 / (song.bpm * PPQ), secs = a.length * spt + 3, chunk = 2;
  const ctx = new OfflineAudioContext(2, Math.ceil(secs * sr), sr);
  await loadDsp(ctx).catch(() => {});
  const e = new Engine(ctx);
  const tracks = song.tracks.map(t => (mute.includes(t.id) ? { ...t, mute: true } : t));
  e.setTempo(song.bpm);
  e.setKey(songScale(song));
  e.setDusty(dusty);
  e.setMaster(level);
  if (master) e.setMasterChain(master);
  e.mix(tracks, only, dry);
  e.sync(0);
  if (view === 'song') e.automate(tracks, 0, spt, 0, LANES, (t, lane) => autoPoints(song, t, lane));
  const audible = t => (!only || t.id === only) && !mute.includes(t.id);
  // A stem still hears the kick's timing, so its sidechain ducking matches the full mix
  const queue = a.events.filter(ev => audible(ev.track) || ev.track.id === 'kick').flatMap(({ track, notes }) => notes.map(n => [track, n])).sort((x, y) => x[1].t - y[1].t);
  if (view === 'song') {
    for (const c of audioClips(song)) { const t = tracks.find(x => x.id === c.ch); if (t && audible(t)) e.clip(t, c, audio.get(c.buf), c.t * spt, c.off ?? 0, c.len); }
  }
  let i = 0;
  const until = time => {
    while (i < queue.length && queue[i][1].t * spt < time) {
      const [track, n] = queue[i++];
      if (audible(track) && chance(n)) e.play(track, n, n.t * spt, spt);
      else if (track.id === 'kick') e.pump(n.t * spt);
    }
  };
  until(2 * chunk);
  for (let s = chunk; s < secs; s += chunk) ctx.suspend(s).then(() => { until(s + 2 * chunk); ctx.resume(); });
  return ctx.startRendering();
}

export function wav(buffer) {  // 16-bit PCM
  const ch = buffer.numberOfChannels, len = buffer.length, bytes = len * ch * 2, v = new DataView(new ArrayBuffer(44 + bytes));
  const text = (o, s) => [...s].forEach((x, i) => v.setUint8(o + i, x.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); text(8, 'WAVE'); text(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true); v.setUint32(24, buffer.sampleRate, true);
  v.setUint32(28, buffer.sampleRate * ch * 2, true); v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, bytes, true);
  const data = Array.from({ length: ch }, (_, i) => buffer.getChannelData(i));
  for (let i = 0, o = 44; i < len; i++) {
    for (let k = 0; k < ch; k++, o += 2) {
      const s = Math.max(-1, Math.min(1, data[k][i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  return new Blob([v], { type: 'audio/wav' });
}
