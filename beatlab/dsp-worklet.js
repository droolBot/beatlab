// The audio thread's side of dsp.js: each effect becomes an AudioWorklet processor whose knobs are
// AudioParams, so they can be set ahead of time and work the same in playback and in offline renders.
import { Warp, Pitch, Tune, Transient } from './dsp.js';

const knob = (name, minValue, maxValue, defaultValue) => ({ name, minValue, maxValue, defaultValue, automationRate: 'k-rate' });
const timing = [knob('bpm', 20, 400, 120), knob('t0', -1e9, 1e9, 0)];
const silence = [new Float32Array(128)];

function processor(Core, params) {
  return class extends AudioWorkletProcessor {
    static get parameterDescriptors() { return params; }
    constructor() { super(); this.core = new Core(sampleRate); this.v = {}; }
    process(inputs, outputs, p) {
      for (const d of params) this.v[d.name] = p[d.name][0];
      const out = outputs[0];
      this.core.process(inputs[0]?.length ? inputs[0] : silence, out, out[0].length, this.v, currentTime);
      return true;  // effects with memory (half-time, tails) keep running between notes
    }
  };
}
registerProcessor('beatlab-warp', processor(Warp, [knob('mode', 0, 4, 0), knob('when', 0, 3, 1), knob('mix', 0, 1, 1), ...timing]));
registerProcessor('beatlab-pitch', processor(Pitch, [knob('semis', -12, 12, 0), knob('fine', -50, 50, 0), knob('mix', 0, 1, 1)]));
registerProcessor('beatlab-tune', processor(Tune, [knob('mask', 0, 4095, 4095), knob('speed', 0, 1, 0.1), knob('mix', 0, 1, 1)]));
registerProcessor('beatlab-transient', processor(Transient, [knob('attack', -1, 1, 0.5), knob('sustain', -1, 1, 0), knob('out', -12, 12, 0)]));
