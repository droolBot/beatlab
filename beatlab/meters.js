// BeatLab master meters, read live from the master output: momentary (400 ms), short-term (3 s) and
// integrated loudness with BS.1770 K-weighting and gating, sample peak with hold, stereo correlation,
// a spectrum and a stereo scope.
const LU = p => (p > 0 ? -0.691 + 10 * Math.log10(p) : -Infinity);

export function createMeters(engine) {
  const c = engine.ctx, sr = c.sampleRate, split = c.createChannelSplitter(2), N = 4096;
  engine.out.connect(split);
  const raw = [0, 1].map(i => { const a = c.createAnalyser(); a.fftSize = N; split.connect(a, i); return a; });
  const kw = [0, 1].map(i => {  // K-weighting: a +4 dB shelf above about 1.7 kHz, then a 38 Hz high-pass
    const shelf = c.createBiquadFilter(), hp = c.createBiquadFilter(), a = c.createAnalyser();
    Object.assign(shelf, { type: 'highshelf' }); shelf.frequency.value = 1681; shelf.gain.value = 4;
    Object.assign(hp, { type: 'highpass' }); hp.frequency.value = 38; hp.Q.value = 0.5;
    a.fftSize = N;
    split.connect(shelf, i);
    shelf.connect(hp).connect(a);
    return a;
  });
  const spec = c.createAnalyser();
  spec.fftSize = 8192;
  spec.smoothingTimeConstant = 0.82;
  engine.out.connect(spec);
  const L = new Float32Array(N), R = new Float32Array(N), kL = new Float32Array(N), kR = new Float32Array(N), freq = new Float32Array(spec.frequencyBinCount);
  let last = c.currentTime, blocks = [], gate = [], gateAcc = { e: 0, n: 0, t: 0 }, hold = 0, holdT = 0;
  const state = { momentary: -Infinity, short: -Infinity, integrated: -Infinity, peak: -Infinity, hold: -Infinity, corr: 1, freq, L, R, sr };

  const energy = (span, now) => {  // mean power over the last `span` seconds of blocks
    let e = 0, n = 0;
    for (const b of blocks) if (b.t > now - span) { e += b.e; n += b.n; }
    return n ? e / n : 0;
  };

  return {
    state,
    read(spectrum = true) {
      const now = c.currentTime, n = Math.min(N, Math.round((now - last) * sr));
      if (n <= 0) return state;
      last = now;
      raw[0].getFloatTimeDomainData(L); raw[1].getFloatTimeDomainData(R);
      kw[0].getFloatTimeDomainData(kL); kw[1].getFloatTimeDomainData(kR);
      let e = 0, pk = 0, lr = 0, ll = 0, rr = 0;
      for (let i = N - n; i < N; i++) {
        e += kL[i] * kL[i] + kR[i] * kR[i];  // channel powers add, both weighted 1
        pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i]));
        lr += L[i] * R[i]; ll += L[i] * L[i]; rr += R[i] * R[i];
      }
      blocks.push({ t: now, e, n });
      blocks = blocks.filter(b => b.t > now - 3);
      state.momentary = LU(energy(0.4, now));
      state.short = LU(energy(3, now));
      // integrated: 400 ms blocks every 100 ms, gated at -70 LUFS, then 10 LU under their mean
      gateAcc.e += e; gateAcc.n += n;
      if (now - gateAcc.t >= 0.1) {
        const p = energy(0.4, now);
        if (LU(p) > -70) gate.push(p);
        gateAcc = { e: 0, n: 0, t: now };
        if (gate.length) {
          const mean = gate.reduce((s, x) => s + x, 0) / gate.length, rel = LU(mean) - 10, kept = gate.filter(x => LU(x) > rel);
          state.integrated = LU(kept.reduce((s, x) => s + x, 0) / Math.max(1, kept.length));
        }
      }
      state.peak = pk > 0 ? 20 * Math.log10(pk) : -Infinity;
      if (pk >= hold || now - holdT > 2) { hold = pk; holdT = now; }
      state.hold = hold > 0 ? 20 * Math.log10(hold) : -Infinity;
      state.corr = ll > 1e-9 && rr > 1e-9 ? lr / Math.sqrt(ll * rr) : 1;
      if (spectrum) spec.getFloatFrequencyData(freq);
      return state;
    },
    reset() { gate = []; blocks = []; hold = 0; state.integrated = -Infinity; state.hold = -Infinity; },
  };
}

export const fmtLU = v => (Number.isFinite(v) ? v.toFixed(1) : '—');

// Log-frequency spectrum from 20 Hz to 20 kHz, with grid lines and labels
export function drawSpectrum(cv, freq, sr, ink) {
  const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'), top = 34, bottom = h - 22, x = f => Math.log(f / 20) / Math.log(1000) * w, y = d => top + (bottom - top) * Math.min(1, Math.max(0, (-6 - d) / 84));
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.font = '10px Geist, sans-serif';
  g.fillStyle = ink.grid;
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) { g.fillRect(x(f), top, 1, bottom - top); g.fillStyle = ink.label; g.fillText(f >= 1000 ? `${f / 1000}k` : f, x(f) + 4, h - 7); g.fillStyle = ink.grid; }
  for (const d of [-12, -24, -36, -48, -60, -72]) { g.fillRect(0, y(d), w, 1); }
  const binHz = sr / 2 / freq.length;
  g.beginPath();
  g.moveTo(0, bottom);
  for (let px = 0; px <= w; px += 2) {
    const f = 20 * 1000 ** (px / w), i = Math.min(freq.length - 1, Math.round(f / binHz)), d = Number.isFinite(freq[i]) ? freq[i] + 4.5 * Math.log2(f / 1000) : -120;  // tilt 4.5 dB/oct so a balanced mix reads flat
    g.lineTo(px, y(d));
  }
  g.lineTo(w, bottom);
  g.closePath();
  g.fillStyle = ink.fill;
  g.fill();
  g.strokeStyle = ink.line;
  g.lineWidth = 1.5;
  g.stroke();
}

// Stereo scope: mid up, side across. A mono signal is a vertical line, a wide one a cloud.
export function drawScope(cv, L, R, ink) {
  const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d'), cx = w / 2, cy = h / 2 + 10, r = Math.min(w, h - 40) * 0.42;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.strokeStyle = ink.grid;
  g.lineWidth = 1;
  g.beginPath(); g.moveTo(cx, cy - r); g.lineTo(cx, cy + r); g.moveTo(cx - r, cy); g.lineTo(cx + r, cy);
  g.moveTo(cx - r * 0.7, cy - r * 0.7); g.lineTo(cx + r * 0.7, cy + r * 0.7); g.moveTo(cx + r * 0.7, cy - r * 0.7); g.lineTo(cx - r * 0.7, cy + r * 0.7); g.stroke();
  g.fillStyle = ink.dot;
  for (let i = 0; i < L.length; i += 2) {
    const m = (L[i] + R[i]) * 0.7071, s = (L[i] - R[i]) * 0.7071;
    g.fillRect(cx + s * r, cy - m * r, 1.3, 1.3);
  }
}
