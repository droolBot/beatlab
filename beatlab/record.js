// BeatLab input: the microphone (or an audio interface input) for recording, and MIDI keyboards, pad
// controllers and the computer keyboard for playing notes.

// ---------- audio input ----------
let stream = null, node = null, monitor = null;
export async function openInput(ctx) {
  if (node) return;
  stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  await ctx.audioWorklet.addModule('capture-worklet.js');
  const source = ctx.createMediaStreamSource(stream);
  node = new AudioWorkletNode(ctx, 'capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
  const silent = ctx.createGain();
  silent.gain.value = 0;
  source.connect(node).connect(silent).connect(ctx.destination);  // pulled by the graph so it keeps running
  monitor = ctx.createGain();
  monitor.gain.value = 0;
  source.connect(monitor).connect(ctx.destination);
}
export const inputName = () => stream?.getAudioTracks()[0]?.label ?? '';
// seconds between a sound reaching the microphone and the page seeing it
export const inputLatency = () => stream?.getAudioTracks()[0]?.getSettings().latency ?? 0.01;
export function setMonitor(on) { if (monitor) monitor.gain.value = on ? 1 : 0; }

// Start keeping what comes in. stop() resolves to {buffer, start} where start is the context time of the
// first sample.
export function capture(ctx) {
  const blocks = [];
  node.port.onmessage = e => { if (e.data !== 'done') blocks.push(e.data); };
  node.port.postMessage('start');
  return {
    stop: () => new Promise(done => {
      const finish = () => {
        node.port.onmessage = null;
        const len = blocks.reduce((s, b) => s + b.data.length, 0);
        if (!len) return done(null);
        const buffer = new AudioBuffer({ length: len, numberOfChannels: 1, sampleRate: ctx.sampleRate }), d = buffer.getChannelData(0);
        let o = 0;
        for (const b of blocks) { d.set(b.data, o); o += b.data.length; }
        done({ buffer, start: blocks[0].frame / ctx.sampleRate });
      };
      node.port.onmessage = e => { if (e.data === 'done') finish(); else blocks.push(e.data); };
      node.port.postMessage('stop');
    }),
  };
}

// ---------- MIDI ----------
let access = null;
export async function connectMidi({ noteOn, noteOff, devices }) {
  access ??= await navigator.requestMIDIAccess();
  const hook = () => {
    const names = [];
    for (const input of access.inputs.values()) {
      input.onmidimessage = e => {
        const [status, d1, d2] = e.data, type = status & 0xf0;
        if (type === 0x90 && d2 > 0) noteOn(d1, d2);
        else if (type === 0x80 || type === 0x90) noteOff(d1);
      };
      names.push(input.name);
    }
    devices(names);
  };
  access.onstatechange = hook;  // plugging a controller in or out keeps working without a reload
  hook();
}

// FL Studio's typing keyboard: Z row and S row from C, Q row and number row an octave up
const KEYS = { z: 0, s: 1, x: 2, d: 3, c: 4, v: 5, g: 6, b: 7, h: 8, n: 9, j: 10, m: 11, ',': 12, l: 13, '.': 14, ';': 15, '/': 16,
  q: 12, 2: 13, w: 14, 3: 15, e: 16, r: 17, 5: 18, t: 19, 6: 20, y: 21, 7: 22, u: 23, i: 24, 9: 25, o: 26, 0: 27, p: 28 };
export const typingNote = (key, octave) => (KEYS[key] == null ? null : 12 * (octave + 1) + KEYS[key]);
// General MIDI drum notes, so pad controllers hit the right channel
export const GM_DRUMS = { 35: 'kick', 36: 'kick', 37: 'perc', 38: 'snare', 39: 'snare', 40: 'snare', 42: 'hat', 44: 'hat', 46: 'openhat', 49: 'fx', 41: 'perc', 43: 'perc', 45: 'perc', 47: 'perc', 48: 'perc', 50: 'perc' };
