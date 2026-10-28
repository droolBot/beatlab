// Runs on the audio thread: copies the microphone into blocks stamped with the context frame they were
// captured at, so a recording lines up exactly with the beat it was played against.
class Capture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.on = false;
    this.block = [];
    this.size = 0;
    this.frame = 0;
    this.port.onmessage = e => {
      if (e.data === 'start') { this.on = true; this.block = []; this.size = 0; }
      if (e.data === 'stop') { this.flush(); this.on = false; this.port.postMessage('done'); }
    };
  }
  flush() {
    if (!this.size) return;
    const out = new Float32Array(this.size);
    let o = 0;
    for (const b of this.block) { out.set(b, o); o += b.length; }
    this.port.postMessage({ frame: this.frame, data: out }, [out.buffer]);
    this.block = [];
    this.size = 0;
  }
  process(inputs) {
    const x = inputs[0]?.[0];
    if (this.on && x) {
      if (!this.size) this.frame = currentFrame;
      this.block.push(x.slice());
      this.size += x.length;
      if (this.size >= 4096) this.flush();
    }
    return true;
  }
}
registerProcessor('capture', Capture);
