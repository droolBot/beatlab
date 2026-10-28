// node tools/make_samples.mjs -- renders BeatLab's own sample library with BeatLab's own synths, so the
// samples are BeatLab's to ship: drum kits (three velocity takes per hit), 808 one-shots and drum loops.
// Needs BeatLab running (python beatlab.py) and Chrome. Writes beatlab/samples/BeatLab/... and an index.
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'beatlab', 'samples');
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', URL = process.env.BEATLAB_URL ?? 'http://localhost:8765';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const profile = join(tmpdir(), `beatlab-samples-${Date.now()}`), port = 9400 + Math.floor(Math.random() * 300);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pend = new Map();
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { pend.get(m.id)?.(m); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async x => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(`${r.result.exceptionDetails.exception?.description}
--- in ---
${x.slice(0, 600)}`); return r.result?.result?.value; };
await send('Page.navigate', { url: `${URL}/index.html` });
await sleep(2000);
await ev(`(async () => {
  window.M = await import('/music.js'); window.S = await import('/sound.js'); window.D = await import('/deliver.js'); window.I = await import('/instruments.js');
  // one note of one sound, rendered dry, trimmed, mono, with a short fade, as base64 WAV
  window.hit = async (sound, params, { p = 60, v = 110, secs = 1, kind = 'drum', dusty = false, d = 12 } = {}) => {
    const s = M.generate({ style: 'trap', bpm: 120, root: 0, mode: 'minor', energy: 0.5, complexity: 0.5 }), pat = s.patterns[0];
    pat.bars = 1;
    s.tracks = [{ id: 'x', kind, sound, params, vol: 1, pan: 0, rev: 0, dly: 0, fx: [], duck: 0, [pat.id]: [{ t: 0, d, p, v }] }];
    const buf = await S.render(s, pat.id, dusty, null, { dry: true, master: { glue: 0, width: 1, ceiling: 0 } });
    const n = Math.min(buf.length, Math.round(secs * buf.sampleRate)), out = new AudioBuffer({ length: n, numberOfChannels: 1, sampleRate: buf.sampleRate });
    const L = buf.getChannelData(0), R = buf.getChannelData(1), m = out.getChannelData(0), fade = Math.round(buf.sampleRate * 0.02);
    for (let i = 0; i < n; i++) m[i] = (L[i] + R[i]) / 2 * (i > n - fade ? (n - i) / fade : 1);
    return out;
  };
  window.b64 = async blob => { const b = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
  window.wav64 = (buf, gain) => { for (let ch = 0; ch < buf.numberOfChannels; ch++) { const c = buf.getChannelData(ch); for (let i = 0; i < c.length; i++) c[i] *= gain; } return b64(D.encodeWav(buf, 16)); };
  window.peak = buf => { let m = 0; const c = buf.getChannelData(0); for (let i = 0; i < c.length; i++) m = Math.max(m, Math.abs(c[i])); return m; };
  return 1;
})()`);

rmSync(join(ROOT, 'BeatLab'), { recursive: true, force: true });
const write = (rel, b64) => { const f = join(ROOT, rel); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, Buffer.from(b64, 'base64')); };

// Kits: each hit at three velocities; the loudest take is normalised to -1 dBFS and the softer ones keep their level
const P = (sound, name) => `I.PRESETS[${JSON.stringify(sound)}]?.[${JSON.stringify(name)}] ?? {}`;
const KITS = {
  'Trap Kit': { kick: ['kick', 'Punchy', { tune: 2 }], snare: ['snare', 'Trap snap'], clap: ['clap', 'Dry'], 'hat closed': ['hat', 'Tick'], 'hat open': ['openhat', 'Short'], rim: ['rim', null], shaker: ['shaker', null] },
  'Drill Kit': { kick: ['kick', 'Tight', { tune: -1 }], snare: ['snare', 'Trap snap', { tune: 3 }], clap: ['clap', 'Bright'], 'hat closed': ['hat', 'Crisp'], 'hat open': ['openhat', 'Short'], rim: ['rim', null, { tune: 4 }], conga: ['conga', null] },
  'Lofi Kit': { kick: ['kick', 'Deep'], snare: ['snare', 'Soft'], clap: ['clap', 'Roomy'], 'hat closed': ['hat', 'Dark'], 'hat open': ['openhat', 'Dark'], rim: ['rim', null, { tune: -3 }], shaker: ['shaker', null, { tone: 4500 }], dusty: true },
  'Boom Bap Kit': { kick: ['kick', 'Boom', { tune: -2 }], snare: ['snare', 'Fat'], clap: ['clap', 'Dry'], 'hat closed': ['hat', 'Crisp'], 'hat open': ['openhat', 'Long'], rim: ['rim', null], conga: ['conga', null, { tune: -4 }], dusty: true },
  'House Kit': { kick: ['kick', 'Tight', { decay: 0.35, punch: 0.7 }], snare: ['snare', 'Tight'], clap: ['clap', 'Bright'], 'hat closed': ['hat', 'Crisp'], 'hat open': ['openhat', 'Short'], rim: ['rim', null], cowbell: ['cowbell', null] },
};
let count = 0;
for (const [kit, hits] of Object.entries(KITS)) {
  for (const [hitName, spec] of Object.entries(hits)) {
    if (hitName === 'dusty') continue;
    const [sound, preset, extra = {}] = spec, secs = /open|kick|clap/.test(hitName) ? 1.2 : 0.6;
    const takes = await ev(`(async () => {
      const params = { ...(${preset ? P(sound, preset) : '{}'}), ...${JSON.stringify(extra)} }, bufs = [];
      for (const v of [62, 96, 127]) bufs.push(await hit(${JSON.stringify(sound)}, params, { v, secs: ${secs}, dusty: ${!!hits.dusty} }));
      const g = 0.891 / Math.max(...bufs.map(peak));
      return Promise.all(bufs.map(b => wav64(b, g)));
    })()`);
    takes.forEach((b64, i) => write(`BeatLab/Kits/${kit}/${hitName} v${i + 1}.wav`, b64));
    count += takes.length;
  }
}

// 808 one-shots, recorded at C1 so they play across the keys as instruments
for (const name of ['Clean sub', 'Hard drive', 'Long slide', 'Short punch', 'Distorted']) {
  const b64 = await ev(`(async () => { const b = await hit('808', ${P('808', name)}, { p: 24, v: 120, secs: 2.2, kind: 'bass', d: 96 * 4 }); return wav64(b, 0.891 / peak(b)); })()`);
  write(`BeatLab/Instruments/Bass/808 ${name} C1.wav`, b64);
  count++;
}

// Drum loops for the slicer: the hook's drums of a few styles, two bars, full mix of the kit
for (const [style, bpm] of [['boombap', 90], ['trap', 140], ['lofi', 82], ['house', 124], ['afro', 106]]) {
  const b64 = await ev(`(async () => {
    const s = M.generate({ style: ${JSON.stringify(style)}, bpm: ${bpm}, root: 0, mode: 'minor', energy: 0.65, complexity: 0.55 }), hook = s.patterns.find(p => p.name === 'Hook');
    hook.bars = 2;
    s.tracks = s.tracks.filter(t => t.kind === 'drum');
    const buf = await S.render(s, hook.id, !!M.STYLES[${JSON.stringify(style)}].dusty, null, {});
    const n = Math.round(2 * 240 / ${bpm} * buf.sampleRate), out = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: buf.sampleRate });
    for (let c = 0; c < 2; c++) out.copyToChannel(buf.getChannelData(c).subarray(0, n), c);
    let pk = 0; for (let c = 0; c < 2; c++) { const d = out.getChannelData(c); for (let i = 0; i < n; i++) pk = Math.max(pk, Math.abs(d[i])); }
    return wav64(out, 0.891 / pk);
  })()`);
  write(`BeatLab/Loops/${({ boombap: 'Boom bap', trap: 'Trap', lofi: 'Lofi', house: 'House', afro: 'Afrobeats' })[style]} drums ${bpm} bpm.wav`, b64);
  count++;
}

// The index the studio reads when there's no server to list files
const files = [];
const walk = d => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (f.endsWith('.wav')) files.push(relative(ROOT, p).replace(/\\/g, '/')); } };
walk(join(ROOT, 'BeatLab'));
writeFileSync(join(ROOT, 'index.json'), JSON.stringify({ files: files.sort() }, null, 0));
console.log(`made ${count} samples; index lists ${files.length}`);
ws.close(); chrome.kill(); setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome still letting go of it */ } process.exit(0); }, 500);
