// BeatLab AI: Google's free Magenta neural networks (Apache-2.0), downloaded once and run in this browser.
// ImprovRNN writes melodies that follow the chords; DrumsRNN continues a groove with its own variations.
import { NOTES, STEP, SIMPLE_SUFFIX, chordAt, chordScale, nearestOf, songScale, notesFor, STYLES } from './music.js';

const LIB = 'https://cdn.jsdelivr.net/npm/@magenta/music@1.23.1/dist/magentamusic.min.js';
const CKPT = 'https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/';
const STEPS = 128;  // 8 bars of 16ths
let lib, models = {};

function loadLib() {
  lib ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = LIB;
    s.onload = () => resolve(window.mm);
    s.onerror = () => { lib = null; reject(new Error("couldn't download the AI library. Check the internet connection.")); };
    document.head.append(s);
  });
  return lib;
}

async function model(name, status) {
  if (!models[name]) {
    models[name] = (async () => {
      status?.('Loading the AI brain (about 7 MB, only the first time)…');
      const mm = await loadLib(), m = new mm.MusicRNN(CKPT + name);
      await m.initialize();
      return m;
    })().catch(e => { delete models[name]; throw e; });
  }
  return models[name];
}

const seq = (notes, total) => ({ notes, quantizationInfo: { stepsPerQuarter: 4 }, totalQuantizedSteps: total });

// A new melody for `pattern` that follows the beat's chords. temperature: 0.6 safe .. 1.6 wild
export async function aiMelody(song, pattern, temperature, status) {
  const rnn = await model('chord_pitches_improv', status);
  status?.('The AI is writing a melody…');
  const track = song.tracks.find(t => t.id === 'melody'), [lo, hi] = STYLES[song.style].melody.range;
  const shift = 12 * Math.round(((lo + hi) / 2 - 66) / 12);  // the model sings between MIDI 48 and 83
  const fit = p => { while (p - shift < 48) p += 12; while (p - shift > 83) p -= 12; return p - shift; };
  const chords = Array.from({ length: STEPS }, (_, s) => { const c = chordAt(song.harmony, s * STEP); return NOTES[c.root] + SIMPLE_SUFFIX[c.q]; });
  const primerSteps = 8;  // two beats of the current melody steer the AI toward the beat's feel
  const primer = notesFor(track, pattern).filter(n => n.t < primerSteps * STEP).map(n => ({
    pitch: fit(n.p), quantizedStartStep: Math.round(n.t / STEP), quantizedEndStep: Math.min(primerSteps, Math.max(Math.round(n.t / STEP) + 1, Math.round((n.t + n.d) / STEP))),
  }));
  if (!primer.length) primer.push({ pitch: fit(nearestOf((lo + hi) / 2, song.harmony[0].pcs, lo, hi)), quantizedStartStep: 0, quantizedEndStep: 2 });
  const out = await rnn.continueSequence(seq(primer, primerSteps), STEPS - primerSteps, temperature, chords);
  const scale = songScale(song), notes = [];
  for (const n of [...primer, ...out.notes.map(n => ({ ...n, quantizedStartStep: n.quantizedStartStep + primerSteps, quantizedEndStep: n.quantizedEndStep + primerSteps }))]) {
    const t = n.quantizedStartStep * STEP, d = Math.max(1, n.quantizedEndStep - n.quantizedStartStep) * STEP, chord = chordAt(song.harmony, t);
    let p = n.pitch + shift;
    while (p < lo) p += 12;
    while (p > hi) p -= 12;
    if (!chordScale(chord.pcs, scale).includes(p % 12)) p = nearestOf(p, chordScale(chord.pcs, scale), lo, hi);  // keep it in key
    notes.push({ t, d: Math.min(d, STEPS * STEP - t), p, v: n.quantizedStartStep % 4 === 0 ? 100 : 88 });
  }
  return notes.filter((n, i) => !notes.some((m, j) => j < i && m.p === n.p && m.t + m.d > n.t));  // no stacked repeats
}

// Drum kit pitches the model knows, and which BeatLab track each one feeds
const TO_GM = { kick: 36, snare: 38, hat: 42, openhat: 46, perc: 45 };
const FROM_GM = { 36: 'kick', 38: 'snare', 42: 'hat', 46: 'openhat', 45: 'perc', 48: 'perc', 50: 'perc' };

// Keep the first two bars of `pattern`'s drums and let the AI play the next six
export async function aiDrums(song, pattern, temperature, status) {
  const rnn = await model('drum_kit_rnn', status);
  status?.('The AI is playing the drums…');
  const primerSteps = 32, primer = [];
  for (const t of song.tracks) {
    if (!TO_GM[t.id]) continue;
    for (const n of notesFor(t, pattern)) {
      const s = Math.round(n.t / STEP);
      if (s < primerSteps && !primer.some(x => x.pitch === TO_GM[t.id] && x.quantizedStartStep === s)) primer.push({ pitch: TO_GM[t.id], quantizedStartStep: s, quantizedEndStep: s + 1, isDrum: true });
    }
  }
  if (!primer.length) primer.push({ pitch: 36, quantizedStartStep: 0, quantizedEndStep: 1, isDrum: true });
  const out = await rnn.continueSequence(seq(primer, primerSteps), STEPS - primerSteps, temperature);
  const parts = Object.fromEntries(Object.keys(TO_GM).map(id => [id, []]));
  for (const t of song.tracks) if (parts[t.id]) parts[t.id] = notesFor(t, pattern).filter(n => n.t < primerSteps * STEP);
  for (const n of out.notes) {
    const id = FROM_GM[n.pitch], s = n.quantizedStartStep + primerSteps;
    if (!id || s >= STEPS || parts[id].some(x => Math.round(x.t / STEP) === s)) continue;
    parts[id].push({ t: s * STEP, d: 12, p: 60, v: s % 4 === 0 ? 108 : s % 2 ? 86 : 96 });
  }
  return parts;
}

export const aiReady = name => !!models[name];

// ---------- the smart brain: a small language model on this computer ----------
// It never touches the studio itself. It only rewrites a request the rules didn't understand into the
// plain commands they do, so it can't do anything the brain couldn't already do, and you see the result.
const WEBLLM = 'https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.86/+esm';
// Both Apache-2.0 and run on the graphics card (WebGPU). Best understands far more but needs about 5 GB of graphics memory.
export const SMART_MODELS = { fast: { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', size: 'about 1 GB' }, best: { id: 'Qwen2.5-7B-Instruct-q4f16_1-MLC', size: 'about 5 GB' } };
let llm = null, llmKind = null;
export const smartAvailable = () => typeof navigator !== 'undefined' && !!navigator.gpu;
function smartEngine(kind, status) {
  if (llmKind !== kind) { llm?.then(e => e.unload()).catch(() => {}); llm = null; llmKind = kind; }
  llm ??= (async () => {
    const webllm = await import(WEBLLM), m = SMART_MODELS[kind];
    return webllm.CreateMLCEngine(m.id, { initProgressCallback: p => status?.(`Loading the smart brain: ${Math.round((p.progress ?? 0) * 100)}% (${m.size}, only the first time)`) });
  })().catch(e => { llm = null; throw e; });
  return llm;
}
const GUIDE = `You turn a beatmaker's request into short commands for a music studio app. Reply with commands only, one per line, no numbering, no explanations. Use only these forms:
make a <trap|drill|r&b|lofi|boom bap|afrobeats|amapiano|house|reggaeton|phonk|pop|desi> beat at <bpm> bpm
tempo <bpm> | faster | slower | key of <note> <major|minor> | make it minor | make it major | swing <n>% | more swing | no swing
humanize the drums | add a fill | vary the drums | vary the melody | ai melody | new <drums|chords|bass|melody> | busier drums | simpler drums
add 808 slides every <n> bars | add hat rolls every <n> bars
mute the <part> | unmute the <part> | solo the <part> | louder <part> by <n> db | quieter <part> by <n> db | pan the <part> <left|right|center>
make the <part> <darker|brighter|warmer|grittier|wider|narrower> | more reverb on the <part> | drier <part> | add echo to the <part>
add <reverb|delay|drive|tape|chorus|phaser|flanger|bitcrush|compressor|limiter|gate|auto-pan|vocoder|stereo width|parametric eq> to the <part> | remove <effect> from the <part>
make the <part> a <piano|electric piano|organ|pad|strings|guitar|sitar|pluck|bell|flute|synth|brass|reese bass|acid bass> | duck the <part> under the kick
half-time the <part> | stutter the <part> | tape stop at the end | autotune the vocals | make the drums hit harder | make it sound old
balance the mix | check my mix | turn this into a full song | hum a melody | export an mp3 | play | stop
Parts: kick, snare, hats, open hat, perc, 808, chords, arp, melody, drums, vocals, mix.
Leave out anything these commands can't do.`;
const EXAMPLES = [
  ['it feels empty, give it more bounce and make it hit harder', 'busier drums\nmore swing\nlouder kick by 2 db\nmake the 808 grittier'],
  ['something for a sad late night drive', 'make a lofi beat\nmake it minor\nmake the chords darker\nmore reverb on the melody'],
  ['the hats are annoying', 'quieter hats by 4 db\nmake the hats darker'],
].flatMap(([u, a]) => [{ role: 'user', content: u }, { role: 'assistant', content: a }]);
// Returns the commands and which model wrote them: Best falls back to Fast when the graphics card can't hold it
export async function smartRewrite(text, status, kind = 'fast') {
  if (!smartAvailable()) throw new Error("this browser can't run it (no WebGPU). Chrome or Edge on a PC with a graphics card can");
  let engine;
  try { engine = await smartEngine(kind, status); } catch (e) {
    if (kind !== 'best') throw e;
    status?.("This graphics card can't hold the best smart brain, so the fast one is loading instead…");
    kind = 'fast';
    engine = await smartEngine(kind, status);
  }
  status?.('The smart brain is thinking…');
  const r = await engine.chat.completions.create({ messages: [{ role: 'system', content: GUIDE }, ...EXAMPLES, { role: 'user', content: text }], temperature: 0.2, max_tokens: 160 });
  return { text: r.choices[0]?.message?.content ?? '', kind };
}

// ---------- MusicVAE: variations and a drummer's feel, two bars at a time ----------
const VAE = 'https://storage.googleapis.com/magentadata/js/checkpoints/music_vae/';
const SIZES = { groovae_2bar_humanize: 16, drums_2bar_hikl_small: 19, mel_2bar_small: 18 };
async function vae(name, status) {
  if (!models[name]) {
    models[name] = (async () => {
      status?.(`Loading the AI (about ${SIZES[name]} MB, only the first time)…`);
      const mm = await loadLib(), m = new mm.MusicVAE(VAE + name);
      await m.initialize();
      return m;
    })().catch(e => { delete models[name]; throw e; });
  }
  return models[name];
}
const CHUNK = 32;  // two bars of 16ths
const drumParts = (song, pattern) => song.tracks.filter(t => TO_GM[t.id] && notesFor(t, pattern).length);
function drumChunk(song, pattern, c) {  // one two-bar stretch of the kit as a drum sequence
  const notes = [];
  for (const t of drumParts(song, pattern)) for (const n of notesFor(t, pattern)) {
    const s = Math.round(n.t / STEP) - c * CHUNK;
    if (s >= 0 && s < CHUNK && !notes.some(x => x.pitch === TO_GM[t.id] && x.quantizedStartStep === s)) notes.push({ pitch: TO_GM[t.id], quantizedStartStep: s, quantizedEndStep: s + 1, isDrum: true, velocity: n.v });
  }
  return seq(notes, CHUNK);
}

// A drummer's feel: GrooVAE plays the pattern back with small pushes and drags and real dynamics.
// Returns new notes per drum channel; the notes stay on their steps, only nudged.
export async function aiHumanize(song, pattern, bars, status) {
  const m = await vae('groovae_2bar_humanize', status);
  status?.('The AI is playing your drums…');
  const parts = Object.fromEntries(drumParts(song, pattern).map(t => [t.id, notesFor(t, pattern).map(n => ({ ...n }))]));
  for (let c = 0; c * 2 < bars; c++) {
    const input = drumChunk(song, pattern, c);
    if (!input.notes.length) continue;
    const [out] = await m.decode(await m.encode([input]), 0.5, undefined, 4, 120), stepSecs = 60 / 120 / 4;
    for (const [id, notes] of Object.entries(parts)) {
      for (const n of notes) {
        const s = Math.round(n.t / STEP) - c * CHUNK;
        if (s < 0 || s >= CHUNK) continue;
        const played = out.notes.find(x => FROM_GM[x.pitch] === (FROM_GM[TO_GM[id]]) && Math.round(x.startTime / stepSecs) === s);
        if (!played) continue;
        const push = Math.max(-0.4, Math.min(0.4, played.startTime / stepSecs - s));  // a fraction of a step
        n.t = Math.max(0, Math.round((c * CHUNK + s + push) * STEP));
        n.v = Math.max(30, Math.min(127, Math.round(played.velocity ?? n.v)));
      }
    }
  }
  return parts;
}

// Variations: MusicVAE writes `count` new versions close to what's there, two bars at a time.
// kind 'drums' returns a list of { trackId: notes }; kind 'melody' a list of note arrays for `track`.
export async function aiVariations(song, pattern, bars, kind, track, temperature, status, count = 4) {
  const m = await vae(kind === 'drums' ? 'drums_2bar_hikl_small' : 'mel_2bar_small', status);
  status?.('The AI is writing variations…');
  const outs = Array.from({ length: count }, () => (kind === 'drums' ? Object.fromEntries(drumParts(song, pattern).map(t => [t.id, []])) : []));
  for (let c = 0; c * 2 < bars; c++) {
    let input;
    if (kind === 'drums') input = drumChunk(song, pattern, c);
    else {  // the top note of each moment: the melody model sings one note at a time
      const notes = [];
      for (const n of [...notesFor(track, pattern)].sort((a, b) => a.t - b.t || b.p - a.p)) {
        const s = Math.round(n.t / STEP) - c * CHUNK;
        if (s < 0 || s >= CHUNK || notes.some(x => x.quantizedStartStep === s)) continue;
        const prev = notes.at(-1);
        if (prev && prev.quantizedEndStep > s) prev.quantizedEndStep = s;
        notes.push({ pitch: Math.max(21, Math.min(108, n.p)), quantizedStartStep: s, quantizedEndStep: Math.min(CHUNK, Math.max(s + 1, Math.round((n.t + n.d) / STEP) - c * CHUNK)), velocity: n.v });
      }
      input = seq(notes, CHUNK);
    }
    if (!input.notes.length) continue;
    const vars = await m.similar(input, count, 0.72, temperature);
    vars.forEach((v, k) => {
      for (const n of v.notes) {
        const t = (c * CHUNK + n.quantizedStartStep) * STEP;
        if (kind === 'drums') {
          const id = FROM_GM[n.pitch] === 'perc' ? 'perc' : FROM_GM[n.pitch];
          if (outs[k][id]) outs[k][id].push({ t, d: 12, p: 60, v: n.quantizedStartStep % 4 === 0 ? 108 : 92 });
        } else outs[k].push({ t, d: Math.max(1, n.quantizedEndStep - n.quantizedStartStep) * STEP, p: n.pitch, v: n.quantizedStartStep % 4 === 0 ? 100 : 88 });
      }
    });
  }
  if (kind === 'melody') {  // keep it in key, like the melodies the AI writes from scratch
    const scale = songScale(song);
    for (const notes of outs) for (const n of notes) { const ch = chordAt(song.harmony, n.t); if (!chordScale(ch.pcs, scale).includes(n.p % 12)) n.p = nearestOf(n.p, chordScale(ch.pcs, scale), n.p - 6, n.p + 6); }
  }
  return outs;
}

// A fill: DrumsRNN keeps the bars before the last one and plays a busier last bar
export async function aiFill(song, pattern, bars, status) {
  const rnn = await model('drum_kit_rnn', status);
  status?.('The AI is playing a fill…');
  const last = (bars - 1) * 16, from = Math.max(0, last - 48), primer = [];
  for (const t of drumParts(song, pattern)) for (const n of notesFor(t, pattern)) {
    const s = Math.round(n.t / STEP);
    if (s >= from && s < last && !primer.some(x => x.pitch === TO_GM[t.id] && x.quantizedStartStep === s - from)) primer.push({ pitch: TO_GM[t.id], quantizedStartStep: s - from, quantizedEndStep: s - from + 1, isDrum: true });
  }
  if (!primer.length) primer.push({ pitch: 36, quantizedStartStep: 0, quantizedEndStep: 1, isDrum: true });
  const out = await rnn.continueSequence(seq(primer, last - from), 16, 1.35);
  const parts = Object.fromEntries(drumParts(song, pattern).map(t => [t.id, notesFor(t, pattern).filter(n => n.t < last * STEP)]));
  for (const n of out.notes) {
    const id = FROM_GM[n.pitch], s = last + n.quantizedStartStep;
    if (!parts[id] || parts[id].some(x => Math.round(x.t / STEP) === s)) continue;
    parts[id].push({ t: s * STEP, d: 12, p: 60, v: Math.min(127, 96 + 8 * (n.quantizedStartStep >> 2)) });  // builds into the next bar
  }
  return parts;
}

// ---------- autocomplete: what comes next, after the notes you've written ----------
// The next `steps` 16ths of a line from step `from`, continuing the two bars before it and following the
// chords. lo..hi is the part's range. Returns notes starting at `from` or later, in the song's key.
export async function aiContinueLine(song, notes, from, steps, { lo, hi, temperature = 1 }, status) {
  const rnn = await model('chord_pitches_improv', status);
  const start = Math.max(0, from - 32), win = from - start;
  const before = notes.filter(n => n.t >= start * STEP && n.t < from * STEP);
  if (!before.length) return [];
  const mid = before.reduce((s, n) => s + n.p, 0) / before.length, shift = 12 * Math.round((mid - 66) / 12);  // the model sings between MIDI 48 and 83
  const fit = p => { while (p - shift < 48) p += 12; while (p - shift > 83) p -= 12; return p - shift; };
  const primer = before.map(n => ({ pitch: fit(n.p), quantizedStartStep: Math.round(n.t / STEP) - start, quantizedEndStep: Math.min(win, Math.max(Math.round(n.t / STEP) - start + 1, Math.round((n.t + n.d) / STEP) - start)) }));
  const chords = Array.from({ length: win + steps }, (_, s) => { const c = chordAt(song.harmony, (start + s) * STEP); return NOTES[c.root] + SIMPLE_SUFFIX[c.q]; });
  const out = await rnn.continueSequence(seq(primer, win), steps, temperature, chords);
  const scale = songScale(song);
  return out.notes.map(n => {
    const t = (from + n.quantizedStartStep) * STEP, chord = chordAt(song.harmony, t);
    let p = n.pitch + shift;
    while (p < lo) p += 12;
    while (p > hi) p -= 12;
    if (!chordScale(chord.pcs, scale).includes(p % 12)) p = nearestOf(p, chordScale(chord.pcs, scale), lo, hi);
    return { t, d: Math.max(1, Math.min(n.quantizedEndStep, steps) - n.quantizedStartStep) * STEP, p, v: n.quantizedStartStep % 4 === 0 ? 100 : 88 };
  }).filter(n => n.t < (from + steps) * STEP);
}

// The drums for steps from..from+steps, continuing the two bars before. Returns { trackId: [hits] }.
export async function aiContinueDrums(song, pattern, from, steps, status) {
  const rnn = await model('drum_kit_rnn', status);
  const start = Math.max(0, from - 32), primer = [];
  for (const t of song.tracks) {
    if (!TO_GM[t.id]) continue;
    for (const n of notesFor(t, pattern)) {
      const s = Math.round(n.t / STEP);
      if (s >= start && s < from && !primer.some(x => x.pitch === TO_GM[t.id] && x.quantizedStartStep === s - start)) primer.push({ pitch: TO_GM[t.id], quantizedStartStep: s - start, quantizedEndStep: s - start + 1, isDrum: true });
    }
  }
  if (!primer.length) return {};
  const out = await rnn.continueSequence(seq(primer, from - start), steps, 1.1);
  const parts = {};
  for (const n of out.notes) {
    const id = FROM_GM[n.pitch], s = from + n.quantizedStartStep;
    if (!id || s >= from + steps || (parts[id] ??= []).some(x => x.t === s * STEP)) continue;
    parts[id].push({ t: s * STEP, d: 12, p: 60, v: s % 4 === 0 ? 108 : s % 2 ? 86 : 96 });
  }
  return parts;
}
