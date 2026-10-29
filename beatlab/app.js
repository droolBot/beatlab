// BeatLab studio: an FL Studio-style workstation around the music engine, the sound engine, the AI
// brain and the 3D deck. Every edit is undoable and autosaved into the open project.
import {
  STYLES, NOTES, SOUNDS, SOUNDS_FOR, SECTION_NAMES, PPQ, STEP, BAR, generate, regenerate, refresh, changeMode, transpose,
  arrange, suggestStyles, noteName, songScale, trackName, notesFor, pickKit, COLORS, newTrack, songLength, patternOf, newPatternId, clipId, upgrade, PATTERN_COLORS, ROWS, SOUND_INFO,
} from './music.js';
import { Engine, Player, PARAMS, EFFECTS, DELAY_TIMES, GATE_TIMES, PAN_TIMES, VOCODER_BANDS, paramsOf, render, LANES } from './sound.js';
import { WARP_MODES, WARP_WHEN, KEYS, TUNE_SCALES, maskOf } from './dsp.js';
import { humToNotes } from './hum.js';
import { diagnose } from './doctor.js';
import { PRESETS, STYLE_SOUNDS, flInstruments, flKits, kitRoles, buildZones, drumZone, spread, unwrapOgg, isAudio } from './instruments.js';
import { decode, analyze, groove } from './listen.js';
import { aiMelody, aiDrums, aiHumanize, aiVariations, aiFill, smartRewrite, smartAvailable, aiContinueLine, aiContinueDrums } from './brain.js';
import { plan, describe, fromModel } from './intent.js';
import { quantize, humanize, euclid, snapToScale, inBox, tidy, AUTO, CHORDS, clock } from './tools.js';
import { lufsOf, finish, encodeWav, encodeMp3, limitInPlace, peakOf, db, midiFile, zipFiles } from './deliver.js';
import { projects, putAudio, getAudio, delAudio, audioIds, newId } from './store.js';
import { openInput, capture, inputLatency, setMonitor, inputName, connectMidi, typingNote, GM_DRUMS } from './record.js';
import { createMeters, fmtLU, drawSpectrum, drawScope } from './meters.js';
import { $ as $doc, h, icon, knob, fader, menu, picker, toggle, floating, toast, lcdText, openDialog, palette, SHORTCUTS } from './ui.js';

// Finds elements in views that aren't on screen right now too (the Rig layout keeps one view attached at a time)
const $ = sel => $doc(sel) ?? Object.values(V).map(v => v.body.querySelector(sel) ?? v.tools.querySelector(sel)).find(Boolean) ?? null;

const PIANO_RANGE = { bass: [24, 60], chords: [43, 84], melody: [55, 96] };
const PATTERN_COLOR = { A: '#FF5E1A', B: '#8F8F8F' };
// A phone gets its own layout (studio.html, html.phone): a tab bar, one view at a time, a narrower track column
const PHONE = matchMedia('(max-width: 1279px)');  // phones, tablets and small laptops: the full studio needs about 1280 px
let phone = PHONE.matches;
const ROW = 40, hdr = () => (phone ? 112 : 210);  // match --row in studio.html
const VIEWS = { arrange: ['playlist', 'Playlist', 'F5'], rack: ['rack', 'Channel rack', 'F6'], roll: ['piano', 'Piano roll', 'F7'], mixer: ['mixer', 'Mixer', 'F9'], master: ['master', 'Master', ''], sounds: ['sounds', 'Browser', 'F8'], listen: ['listen', 'Listen', ''] };
const MASTER_DEFAULT = { glue: 0.5, width: 1, ceiling: -1 };
const HINT = 'Hover over anything to see what it does. Ctrl+K finds any action.';
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const at = e => ({ getBoundingClientRect: () => new DOMRect(e.clientX, e.clientY, 0, 0), focus() {} });  // anchors a menu at the mouse

let ctx, engine, player, meters, deck, song, current = null, ref = null, refSrc = null, lib = [], previewSrc = null, turns = 0, lastStep = -1, rec = null, selClip = null;
const ui = {
  style: 'rnb', energy: 0.5, complexity: 0.5, temp: 1, flKit: true, aiMel: false, aiDrm: false, aiFeel: false, autoMix: true, smart: false,
  pattern: null, mode: 'pattern', bar: 0, selected: 'kick', view: 'arrange', devices: true, noteLen: 2, grid: 1, chord: 'none', scaleSnap: false,
  layout: 'rig', wins: {}, btab: 'plugins', focus: 'arrange', tool: 'draw', rollTool: 'draw', snap: 'beat', plZoom: 1, countIn: true,
  master: 1, copyGroove: true, country: 'IN', open: ['Drums'], theme: 'dark', metro: false, typing: false, octave: 4, recQuant: true, recOffset: 0, monitor: false,
  cursor: 0, lanes: {}, project: null, exp: {}, exports: [],
};
const buffers = new Map();   // decoded FL samples by path
const audioBufs = new Map(); // recorded and imported audio by id

// ---------- audio, saving, history, samples ----------
function audio() {  // audio may only start after a click, so the engine is built on first use
  if (!ctx) {
    ctx = new AudioContext({ latencyHint: ui.latency ?? 'interactive' });
    engine = new Engine(ctx);
    player = new Player(engine);
    meters = createMeters(engine);
    engine.setMaster(ui.master);
    engine.setMasterChain(song.master);
    player.metronome = ui.metro;
  }
  if (ctx.state !== 'running') ctx.resume().then(engineState);
  return ctx;
}
function engineState() {
  const lat = Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000);
  $('#engine-state').textContent = `${ctx.sampleRate / 1000} kHz${lat ? ` · ${lat} ms output latency` : ''}`;
}
const dusty = () => !!STYLES[song.style].dusty;
const view = () => (ui.mode === 'song' ? 'song' : ui.pattern);
const track = id => song.tracks.find(t => t.id === id);
const soundLabel = t => { if (t.kind !== 'audio') return t.inst?.name ?? t.sampleName ?? (t.preset ? `${SOUNDS[t.sound]}, ${t.preset}` : SOUNDS[t.sound]); const n = audioClipsOf(t.id).length; return `${n} audio clip${n === 1 ? '' : 's'}`; };
const spt = () => 60 / (song.bpm * PPQ);
const songJSON = () => JSON.stringify(song, (k, v) => (k === 'sample' || k === 'zoneBufs' ? undefined : v));

let saveTimer, batching = false;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const json = songJSON();
    try { localStorage.setItem('beatlab:v3', `{"ui":${JSON.stringify({ ...ui, plugin: undefined })},"song":${json}}`); } catch { /* private mode: the project store still has it */ }
    if (!batching) commit(json);
    persist(json);
  }, 250);
}
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem('beatlab:v3') ?? localStorage.getItem('beatlab:v2'));
    if (s?.song?.sections && STYLES[s.song.style]) {
      song = s.song;
      Object.assign(ui, s.ui, { plugin: null });
      if (!VIEWS[ui.view]) ui.view = 'arrange';
      prepare(song);
      return true;
    }
  } catch { /* ignore a damaged save */ }
  return false;
}
function prepare(s) {  // fill in what older saves lack
  upgrade(s);
  s.master ??= { ...MASTER_DEFAULT };
  while (s.playlist.rows.length < ROWS) s.playlist.rows.push({ name: `Track ${s.playlist.rows.length + 1}`, mute: false });
  for (const t of s.tracks) {
    if (!t.samplePath) delete t.sampleName;  // dropped files can't come back after a reload
    if (COLORS[t.id]) t.color = COLORS[t.id];
    else if (t.kind === 'audio') t.color = COLORS.audio;
  }
}

// Undo and redo: every saved state of the song, up to 200 steps. A knob drag or a note drag is one step.
const history = { stack: [], at: -1 };
function commit(json) {
  if (history.stack[history.at] === json) return;
  history.stack.splice(history.at + 1);
  history.stack.push(json);
  if (history.stack.length > 200) history.stack.shift();
  history.at = history.stack.length - 1;
  renderUndo();
}
function stepHistory(d) {
  const to = history.at + d;
  if (to < 0 || to >= history.stack.length) return hint(d < 0 ? 'Nothing to undo.' : 'Nothing to redo.');
  history.at = to;
  const keep = new Map(song.tracks.filter(t => t.sample).map(t => [`${t.id}|${t.sampleName}`, t.sample]));
  song = JSON.parse(history.stack[to]);
  for (const t of song.tracks) if (t.sampleName) t.sample = keep.get(`${t.id}|${t.sampleName}`);
  restoreSounds(song.tracks);
  if (!track(ui.selected)) ui.selected = song.tracks[0].id;
  if (ctx) engine.setMasterChain(song.master);
  toolbarKnobs();
  changed();
  renderUndo();
  hint(d < 0 ? 'Undone. Ctrl+Y redoes it.' : 'Redone.');
}
function renderUndo() {
  $('#undo').disabled = history.at <= 0;
  $('#redo').disabled = history.at >= history.stack.length - 1;
}
const hint = msg => { $('#hint').textContent = msg; };

function sampleBuffer(path) {  // decoded once, shared by every channel that uses it
  if (!buffers.has(path)) {
    const decode = bytes => new OfflineAudioContext(2, 1, 44100).decodeAudioData(bytes.buffer);
    const get = async pcm => {
      // with the desktop server every sample comes through it; as a website, BeatLab's own are plain files
      // and FL's come from the visitor's own FL Studio folder
      if (!server && !path.startsWith('BeatLab/')) {
        const f = flFiles.get(path);
        if (!f) throw new Error("Connect FL Studio's Packs folder in the Sounds view to hear this.");
        return decode(unwrapOgg(new Uint8Array(await f.arrayBuffer())));
      }
      const r = await fetch(!server ? `samples/${path.split('/').map(encodeURIComponent).join('/')}` : `/api/sample?p=${encodeURIComponent(path)}${pcm ? '&pcm=1' : ''}`);
      if (!r.ok) throw new Error((await r.json()).error);
      return decode(new Uint8Array(await r.arrayBuffer()));
    };
    // a few of FL's samples only open once BeatLab's server has converted them (ffmpeg, desktop only)
    buffers.set(path, get(false).catch(e => (e.name === 'EncodingError' && server ? get(true) : Promise.reject(e))).catch(e => { buffers.delete(path); throw e; }));
  }
  return buffers.get(path);
}
async function loadSamplePath(t, path) {
  t.sample = await sampleBuffer(path);
  t.samplePath = path;
  t.sampleName = path.split('/').pop().replace(/\.\w+$/, '');
  clearInstrument(t);
}
const clearInstrument = t => { delete t.inst; delete t.zoneBufs; };
const clearSample = t => { delete t.sample; delete t.samplePath; delete t.sampleName; };

// FL instruments and kits. Working out every sample's note takes a moment, so the answer is remembered.
let flInst = [], flKit = [], server = false, hasFL = false, flFiles = new Map();
const zoneCache = () => { try { return JSON.parse(localStorage.getItem('beatlab:zones') ?? '{}'); } catch { return {}; } };
async function zonesFor(id, files, drum) {
  const cache = zoneCache();
  if (cache[id]) return cache[id];
  const entries = (await Promise.all((drum ? spread(files) : files).map(path => sampleBuffer(path).then(buffer => ({ path, buffer }), () => null)))).filter(Boolean);
  if (!entries.length) throw new Error('none of its samples would load');
  const zones = drum ? drumZone(entries) : buildZones(entries);
  try { localStorage.setItem('beatlab:zones', JSON.stringify({ ...cache, [id]: zones })); } catch { /* storage full: work it out again next time */ }
  return zones;
}
async function attachZones(t) {
  t.zoneBufs = await Promise.all(t.inst.zones.map(async z => ({ root: z.root, bufs: await Promise.all(z.takes.map(p => sampleBuffer(p).catch(() => null))) })));
}
async function loadInstrument(t, inst) {  // a multi-sample (or single-sample) FL instrument on a channel
  hint(`Loading ${inst.name}…`);
  const zones = await zonesFor(inst.id, inst.files, false);
  Object.assign(t, { inst: { id: inst.id, name: inst.name, zones }, params: {} });
  clearSample(t);
  delete t.preset;
  await attachZones(t);
  hint(`${inst.name} is on ${trackName(t)}: ${zones.length} recorded note${zones.length === 1 ? '' : 's'}, ${zones.reduce((n, z) => n + z.takes.length, 0)} samples.`);
}
const STYLE_KIT = { trap: 'Trap Kit', phonk: 'Trap Kit', drill: 'Drill Kit', lofi: 'Lofi Kit', rnb: 'Lofi Kit', boombap: 'Boom Bap Kit', desi: 'Boom Bap Kit', house: 'House Kit', afro: 'House Kit', amapiano: 'House Kit', pop: 'House Kit', reggaeton: 'House Kit' };
const KIT_ROLE = t => ({ perc: t.sound }[t.id] ?? (SOUNDS_FOR.drum.includes(t.sound) ? t.sound : t.id));
async function loadKit(kit, only = null) {  // every drum channel takes its hit from the kit, with all its takes
  const roles = kitRoles(kit.files), done = [];
  await Promise.all(song.tracks.filter(t => t.kind === 'drum' && (!only || t === only)).map(async t => {
    const role = KIT_ROLE(t), files = roles[role] ?? (role === 'clap' ? roles.snare : role === 'rim' ? roles.snare : null);
    if (!files) return;
    const id = `${kit.id}#${role}`;
    try {
      const zones = await zonesFor(id, files, true);
      Object.assign(t, { inst: { id, name: `${kit.name} ${SOUNDS[role] ?? role}`, kit: kit.id, zones }, params: {} });
      clearSample(t);
      await attachZones(t);
      done.push(trackName(t));
    } catch { /* this hit stays as it was */ }
  }));
  song.kit = kit.id;
  changed();
  toast(done.length ? `${kit.name} kit on ${done.join(', ')}. Each hit switches takes with how hard it's played.` : `${kit.name} has no hits for these channels.`);
}
const reachable = p => server || p.startsWith('BeatLab/') || flFiles.has(p);  // the website keeps FL sounds until FL is connected
function restoreSounds(tracks) {  // reload FL sounds after an undo, a reload or opening a project
  return Promise.all(tracks.map(t => Promise.all([
    t.samplePath && !t.sample && reachable(t.samplePath) ? loadSamplePath(t, t.samplePath).catch(() => clearSample(t)) : null,
    t.inst && !t.zoneBufs && t.inst.zones.some(z => z.takes.some(reachable)) ? attachZones(t).catch(() => clearInstrument(t)) : null,
  ]))).then(() => { if (ctx) mixChanged(); });
}
// FL instruments that suit the style go on the chords, the lead and, where a played bass suits it, the bass
async function applyInstruments() {
  const rules = STYLE_SOUNDS[song.style] ?? {}, used = [];
  await Promise.all(Object.entries(rules).map(async ([id, re]) => {
    const t = track(id), choices = flInst.filter(i => re.test(i.id));
    if (!t || !choices.length) return;
    const inst = choices[Math.floor(Math.random() * choices.length)];
    try { await loadInstrument(t, inst); used.push(inst.name); } catch { /* keeps the synth */ }
  }));
  return used;
}
async function loadSampleFile(t, file) {
  try {
    t.sample = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(await file.arrayBuffer());
    t.sampleName = file.name.replace(/\.\w+$/, '');
    delete t.samplePath;
    clearInstrument(t);
    if (t.sound === 'slicer') fillSlices(t);
    changed();
    audition(t, t.kind === 'bass' ? 36 : 60);
    toast(`${file.name} now plays on ${trackName(t)}. Files you drop in need adding again after a reload; sounds from the Sounds view come back on their own.`);
  } catch {
    toast(`${file.name} isn't an audio file this browser can read. Try a WAV or MP3.`);
  }
}
// The slicer cuts a loop into equal slices and lays them across the steps in order, a slice per step or
// two, by the loop's length at this tempo
function fillSlices(t) {
  const N = [4, 8, 16, 32][Math.round(paramsOf('slicer', t.params).slices)], bars = Math.max(1, Math.round(t.sample.duration / (240 / song.bpm))), per = bars * 16 / N, f = editable(t);
  t[f] = Array.from({ length: N }, (_, i) => ({ t: Math.round(i * per) * STEP, d: Math.max(2, Math.round(per * STEP * 0.9)), p: 60 + i, v: 100 }));
  hint(`${t.sampleName}: ${N} slices over ${bars} bar${bars === 1 ? '' : 's'}. Move the steps to rearrange the loop; a new step plays the slice under it.`);
}
async function useLibrarySample(t, path) {
  if (!t || t.kind === 'audio') return toast('Pick an instrument or drum channel first. Audio tracks hold clips instead.');
  try {
    await loadSamplePath(t, path);
    t.params = t.sound === 'slicer' ? { slices: t.params?.slices ?? 2 } : {};
    if (t.sound === 'slicer') fillSlices(t);
    changed();
    audition(t, t.kind === 'bass' ? 36 : 60);
    toast(`${t.sampleName} is now on ${trackName(t)}.`);
  } catch (e) {
    toast(`Couldn't load that sound: ${e.message}`);
  }
}
function dropOn(el, t) {  // drag a file from your computer or a sound from the Sounds view onto a channel
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('drag'); });
  el.addEventListener('dragleave', () => el.classList.remove('drag'));
  el.addEventListener('drop', e => {
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drag');
    const path = e.dataTransfer.getData('text/x-beatlab-sample');
    if (t.kind === 'audio') { if (e.dataTransfer.files[0]) importAudio(e.dataTransfer.files[0], t); return; }
    if (path) useLibrarySample(t, path);
    else if (e.dataTransfer.files[0]) loadSampleFile(t, e.dataTransfer.files[0]);
  });
}

async function applyKit() {  // names of the FL sounds that loaded; a failed one keeps the synth
  const picks = pickKit(song, lib);
  const loaded = await Promise.all(Object.entries(picks).map(([id, path]) => loadSamplePath(track(id), path).then(() => track(id).sampleName, () => null)));
  return loaded.filter(Boolean);
}

function audition(t, p) {
  audio();
  engine.mix(song.tracks);
  engine.play({ ...t, mute: false }, { t: 0, d: STEP * 3, p, v: 100 }, ctx.currentTime + 0.01, spt());
}

// ---------- refresh everything that shows the song ----------
function changed({ redraw = true } = {}) {  // redraw: false leaves the screen alone, e.g. right after dragging a note
  save();
  suggestSoon();
  if (player?.playing) player.load(song, view(), dusty(), audioBufs);
  renderTransport();
  if (redraw) renderView();
  renderPads();
  if (ui.plugin) renderPlugin();
}

function setSong(next, msg) {
  for (const t of next.tracks) {  // keep sounds you chose on the same channels
    const old = song?.tracks.find(x => x.id === t.id);
    if (old?.sample && !ui.flKit) Object.assign(t, { sample: old.sample, samplePath: old.samplePath, sampleName: old.sampleName, params: old.params });
    if (old?.inst && !ui.flKit) Object.assign(t, { inst: old.inst, zoneBufs: old.zoneBufs, params: old.params });
  }
  next.master ??= song?.master ?? { ...MASTER_DEFAULT };
  song = next;
  if (!track(ui.selected)) ui.selected = song.tracks[0].id;
  if (!patternOf(song, ui.pattern)) ui.pattern = hookId(song);
  toolbarKnobs();
  changed();
  if (msg) toast(msg);
}

// ---------- top bar ----------
const posText = tick => { const bar = Math.floor(tick / BAR), step = Math.floor(tick % BAR / STEP); return `${String(bar + 1).padStart(2, '0')}.${(step >> 2) + 1}.${step % 4 + 1}`; };
function renderTransport() {
  lcdText($('#bpm-v'), bpmText());
  $('#key-pick').replaceChildren(picker({
    label: 'Key', value: `${song.root} ${song.mode === 'major' ? 'major' : 'minor'}`,
    options: ['minor', 'major'].flatMap(m => NOTES.map((n, i) => ({ value: `${i} ${m}`, label: `${n} ${m}` }))),
    onChange: v => setKey(...v.split(' ').map((x, i) => (i ? x : +x))),
  }));
  const playing = !!player?.playing;
  $('#play').classList.toggle('on', playing);
  $('#play').setAttribute('aria-label', playing ? 'Stop' : 'Play');
  $('#rec').classList.toggle('on', !!rec);
  $('#metro').setAttribute('aria-pressed', ui.metro);
  renderPatternPicker();
  for (const b of document.querySelectorAll('[data-mode]')) b.setAttribute('aria-pressed', b.dataset.mode === ui.mode);
  if (!playing) {
    $('#where').textContent = ui.mode === 'song' ? `Song from bar ${Math.floor(ui.cursor / BAR) + 1}` : `Pattern: ${pat().name}`;
    lcdText($('#pos'), posText(ui.mode === 'song' ? ui.cursor : 0));
  }
}
function setKey(root, mode) {
  if (mode !== (song.mode === 'major' ? 'major' : 'minor')) {
    song = transpose(song, root);
    setSong(changeMode(song, mode), `Switched to ${NOTES[root]} ${mode}. Chords, bass and melody were rewritten.`);
  } else { song = transpose(song, root); changed(); }
}

function toolbarKnobs() {  // rebuilt only when the song changes, so dragging isn't interrupted
  $('#master-k').replaceChildren(knob({ label: 'Master volume', caption: 'Master', value: ui.master, min: 0, max: 1.2, def: 1, size: 44, hero: true, fmt: v => `${Math.round(v * 100)}%`, onInput: v => { ui.master = v; audio(); engine.setMaster(v); save(); } }));
}

const bpmText = () => String(song.bpm).padStart(3, '0');
function setBpm(v, commitNow = false) {
  v = clamp(Math.round(v), 50, 200);
  if (v === song.bpm) return;
  player?.setBpm(v);
  song.bpm = v;
  lcdText($('#bpm-v'), bpmText());
  if (commitNow) changed({ redraw: showing('arrange') }); else save();
}
function tempoControl() {  // drag up and down like FL's tempo box, scroll, arrows, or double-click to type
  const el = $('#tempo');
  el.addEventListener('pointerdown', e => {
    if (e.target.tagName === 'INPUT') return;
    el.setPointerCapture(e.pointerId);
    const y0 = e.clientY, b0 = song.bpm;
    const move = ev => setBpm(b0 + (y0 - ev.clientY) / 3);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); changed({ redraw: showing('arrange') }); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
  el.addEventListener('wheel', e => { e.preventDefault(); setBpm(song.bpm - Math.sign(e.deltaY)); }, { passive: false });
  el.addEventListener('keydown', e => {
    const k = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[e.key];
    if (k) { e.preventDefault(); setBpm(song.bpm + k); }
  });
  el.addEventListener('dblclick', () => {
    const input = h('input', { type: 'number', min: 50, max: 200, value: song.bpm, 'aria-label': 'Tempo' });
    const b = $('#bpm-v');
    b.replaceChildren(input);
    input.focus();
    input.select();
    const done = () => { b.textContent = ''; setBpm(+input.value || song.bpm, true); lcdText(b, bpmText()); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); if (e.key === 'Escape') { input.value = song.bpm; input.blur(); } });
    input.addEventListener('blur', done);
  });
}

// ---------- transport and recording ----------
function togglePlay(fromTick) {
  audio();
  if (rec) return stopRecording();
  if (player.playing) {
    player.stop();
    lastStep = -1;
    markStep(-1);
  } else {
    stopRef();
    player.load(song, view(), dusty(), audioBufs);
    player.start(fromTick ?? (ui.mode === 'song' ? ui.cursor : 0));
    engineState();
  }
  renderTransport();
}
function stopAll() {
  if (player?.playing || rec) togglePlay();
  turns = 0;
  ui.bar = 0;
  barChanged();
  renderTransport();
}
function barChanged() {  // the rack and the pads show one bar at a time
  if (showing('rack')) refreshRack();
  renderPads();
}
// After a step edit or a new bar, only the step strips change. Rebuilding the whole rack (its knobs and
// all) on every click is what made editing during playback stutter.
function refreshRack() {
  for (const cv of V.rack.body.querySelectorAll('.graph[data-graph] canvas')) drawGraph(cv, track(cv.parentNode.dataset.graph));
  for (const row of V.rack.body.querySelectorAll('.ch[data-ch]')) {
    const t = track(row.dataset.ch);
    if (t) row.lastElementChild.replaceWith(t.kind === 'drum' ? steps(t, notesFor(t, ui.pattern)) : mini(t, notesFor(t, ui.pattern)));
  }
  V.rack.tools.querySelectorAll('.pager button').forEach((b, i) => b.setAttribute('aria-pressed', i === ui.bar));
  showSuggestion();
}
function stepsChanged() {  // what a step edit has to redraw
  changed({ redraw: false });
  if (showing('rack')) refreshRack();
  if (showing('arrange')) drawPlaylist();
  if (showing('roll')) renderRoll();
}
function setMode(m) {
  const was = player?.playing && !rec;
  if (was) togglePlay();
  ui.mode = m;
  save();
  renderTransport();
  renderView();
  if (was) togglePlay();
}
function toggleMetro() {
  ui.metro = !ui.metro;
  if (player) player.metronome = ui.metro;
  save();
  renderTransport();
  hint(ui.metro ? 'Metronome on.' : 'Metronome off.');
}
function setCursor(tick) {
  ui.cursor = Math.max(0, tick);
  save();
  if (player?.playing && ui.mode === 'song' && !rec) { player.stop(); player.load(song, 'song', dusty(), audioBufs); player.start(ui.cursor); }
  renderTransport();
  renderView();
}

// Record: in Song mode, audio from the microphone onto an audio track from the song position; in
// Pattern mode, notes from a MIDI keyboard, the pads or the computer keyboard into the pattern.
const toggleRecord = () => (rec ? stopRecording() : startRecording());
async function startRecording() {
  audio();
  if (player.playing) player.stop();
  stopRef();
  if (ui.mode === 'song') {
    let t = song.tracks.find(x => x.kind === 'audio' && x.arm) ?? song.tracks.find(x => x.kind === 'audio');
    try { await openInput(ctx); } catch (e) {
      return toast(`BeatLab can't hear a microphone (${e.message}). Allow microphone access for this page in the address bar, or plug one in.`);
    }
    if (!t) { t = newTrack('audio', null, 1); song.tracks.push(t); }
    setMonitor(ui.monitor);
    player.load(song, 'song', dusty(), audioBufs);
    rec = { kind: 'audio', id: t.id, row: audioClipsOf(t.id)[0]?.row ?? freeRow(), from: ui.cursor, cap: capture(ctx) };
    player.start(ui.cursor, ui.countIn === false ? 0 : 1);
    if (ui.layout !== 'daw' && ui.view !== 'arrange') ui.view = 'arrange';
    toast(`Recording ${inputName() || 'the microphone'} onto ${trackName(t)} from bar ${Math.floor(ui.cursor / BAR) + 1}, after a one-bar count-in. Space or R stops.`);
  } else {
    player.load(song, view(), dusty(), audioBufs);
    rec = { kind: 'notes' };
    player.start(0, ui.countIn === false ? 0 : 1);
    toast(`Recording notes into ${pat().name} on ${trackName(track(ui.selected) ?? padTrack())}. Play a MIDI keyboard, the pads or the computer keyboard. Space stops.`);
  }
  changed();
}
// Hum a melody: one pass of the pattern after a count-in, then the humming becomes notes in the key
const HUM_CENTER = { melody: 72, chords: 62, bass: 40 };
async function startHum() {
  audio();
  if (rec) return;
  if (player.playing) player.stop();
  stopRef();
  try { await openInput(ctx); } catch (e) { return toast(`BeatLab can't hear a microphone (${e.message}). Allow microphone access for this page in the address bar, or plug one in.`); }
  const sel = track(ui.selected), t = sel && HUM_CENTER[sel.kind] ? sel : song.tracks.find(x => x.kind === 'melody');
  if (!t) return toast('Add a melody channel first, then hum into it.');
  if (ui.mode === 'song') setMode('pattern');
  player.load(song, view(), dusty(), audioBufs);
  rec = { kind: 'hum', id: t.id, pid: ui.pattern, cap: capture(ctx), len: arrange(song, view()).length };
  player.start(0, 1);
  const r = rec;
  setTimeout(() => { if (rec === r) stopRecording(); }, (4 * 60 / song.bpm + r.len * spt()) * 1000 + 250);  // the count-in bar, then one pass
  renderTransport();
  toast(`Hum or sing the ${trackName(t)} for ${pat().name} after the count-in. BeatLab writes it in ${NOTES[song.root]} ${song.mode} when the pattern ends. Space stops early.`);
}
async function stopRecording() {
  const r = rec, musicStart = player.countUntil, s = spt();
  rec = null;
  player.stop();
  renderTransport();
  if (r.kind === 'notes') return changed();
  if (r.kind === 'hum') {
    const got = await r.cap.stop(), t = track(r.id);
    if (!got || !t) return toast('Nothing was heard.');
    const latency = inputLatency() + (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + ui.recOffset / 1000, sr = got.buffer.sampleRate;
    const x = got.buffer.getChannelData(0).subarray(Math.round(Math.max(0, musicStart - got.start + latency) * sr));
    const notes = humToNotes(x, sr, { bpm: song.bpm, mask: maskOf(songScale(song)), step: STEP, ppq: PPQ, center: HUM_CENTER[t.kind], maxTicks: r.len });
    if (!notes.length) return toast("BeatLab couldn't hear a tune in that. Hum a little louder or closer to the microphone, on 'da' or 'la'.");
    t[r.pid] = notes;
    if (t.id !== ui.selected) select(t.id);
    changed();
    return toast(`Wrote ${notes.length} notes from your humming onto ${trackName(t)}, in ${NOTES[song.root]} ${song.mode} and on the beat. Ctrl+Z takes them back.`);
  }
  const got = await r.cap.stop();
  const t = track(r.id);
  if (!got || !t) return toast('Nothing was recorded.');
  // the take started before the count-in; line it up with what the performer heard
  const latency = inputLatency() + (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + ui.recOffset / 1000;
  let off = musicStart - got.start + latency, start = r.from;
  if (off < 0) { start += Math.round(-off / s); off = 0; }
  const len = got.buffer.duration - off;
  if (len < 0.25) return toast('The take was shorter than the count-in, so nothing was kept.');
  const id = newId();
  audioBufs.set(id, got.buffer);
  try { await putAudio(id, got.buffer); } catch (e) { toast(`The take plays, but the browser wouldn't store it: ${e.message}`); }
  song.playlist.clips.push({ id: clipId(), type: 'audio', ch: t.id, row: r.row, buf: id, name: `Take ${audioClipsOf(t.id).length + 1}`, t: start, off, len, gain: 0, fi: 0.005, fo: 0.02, rev: false });
  changed();
  toast(`Kept ${clock(len)} on ${trackName(t)}. Drag the clip to move it, drag its edges to trim, right-click for fades, gain and more.`);
}

// Live notes from MIDI, the computer keyboard and the pads. While recording in Pattern mode they're written in.
const held = new Map();
function noteOn(p, v, source, forced = null) {
  audio();
  let t = forced ?? track(ui.selected);
  if (source === 'midi' && t?.kind === 'drum' && GM_DRUMS[p] && track(GM_DRUMS[p])) t = track(GM_DRUMS[p]);
  if (!t || !['drum', 'bass', 'chords', 'melody'].includes(t.kind)) t = padTrack();
  lightKey(p, true);
  held.get(p)?.live.release();
  held.set(p, { live: engine.liveOn(t, p, v), t, at: rec?.kind === 'notes' && player.playing && !player.counting ? player.position() : null, v });
}
function noteOff(p) {
  const n = held.get(p);
  if (!n) return;
  held.delete(p);
  n.live.release();
  lightKey(p, false);
  if (n.at == null || rec?.kind !== 'notes') return;
  const loop = patBars() * BAR, f = editable(n.t), drum = n.t.kind === 'drum';
  let start = n.at, d = ((player.position() - n.at) % loop + loop) % loop;
  if (ui.recQuant) { start = Math.round(start / STEP) * STEP % loop; d = Math.max(STEP, Math.round(d / STEP) * STEP); }
  n.t[f] = tidy([...n.t[f], { t: start, d: drum ? STEP / 2 : Math.max(STEP / 2, d), p: drum ? 60 : p, v: n.v }]);
  changed({ redraw: showing('rack') || showing('roll') });
}

// ---------- Brain ----------
// A pocket-pedal face: an LCD with the style number, a 3D knob to turn through the styles,
// three brushed knobs for the feel, and LED keys for the options.
const STYLE_IDS = Object.keys(STYLES);
let styleKnob = null;
function chooseStyle(id) { ui.style = id; save(); renderBrain(); }
function renderBrain() {
  const i = STYLE_IDS.indexOf(ui.style), st = STYLES[ui.style];
  lcdText($('#style-num'), String(i + 1).padStart(2, '0'));
  $('#style-name').replaceChildren(h('b', {}, st.name), h('span', {}, `${st.bpm[0]} to ${st.bpm[1]} BPM`), icon('down', 16));
  styleKnob?.set(i);
  const pct = v => `${Math.round(v * 100)}`;
  $('#feel-knobs').replaceChildren(
    knob({ label: 'Energy', caption: '', value: ui.energy, min: 0, max: 1, def: 0.5, size: 56, metal: true, fmt: pct, onInput: v => { ui.energy = v; save(); } }),
    knob({ label: 'Complexity', caption: '', value: ui.complexity, min: 0, max: 1, def: 0.5, size: 56, metal: true, fmt: pct, onInput: v => { ui.complexity = v; save(); } }),
    knob({ label: 'AI creativity', caption: '', value: ui.temp, min: 0.6, max: 1.6, def: 1, size: 56, metal: true, onInput: v => { ui.temp = v; save(); } }));
  const option = (label, key, title, enabled = true) => {
    const on = !!ui[key] && enabled;
    return h('button', { class: 'opt', 'aria-pressed': on, title: enabled ? title : `${title} (FL Studio's sample packs weren't found)`, disabled: !enabled, onclick: () => { ui[key] = !ui[key]; save(); renderBrain(); } },
      h('span', { class: `dot-led${on ? ' on' : ''}` }), label);
  };
  $('#switches').replaceChildren(
    option(hasFL ? 'FL sounds' : 'Sample kits', 'flKit', hasFL ? 'Use FL Studio drums, and FL instruments that suit the style' : "Use BeatLab's own sampled drum kits", lib.length > 0),
    option('AI feel', 'aiFeel', 'The AI humanizes the drums of every new beat (downloads 16 MB once)'),
    option('Auto mix', 'autoMix', 'Balance the levels of every new beat'));
}
async function initStyleKnob() {
  try {
    const { knob3d } = await import('./knob3d.js');
    styleKnob = knob3d($('#style-knob'), {
      steps: STYLE_IDS.length, value: STYLE_IDS.indexOf(ui.style), label: 'Style', accent: '#FF5E1A',
      valueText: i => STYLES[STYLE_IDS[i]].name, onChange: i => chooseStyle(STYLE_IDS[i]),
    });
    styleKnob.setTheme(ui.theme);
  } catch (e) {
    $('#style-knob').replaceChildren(h('span', { class: 'dim', style: 'font-size:11px' }, `3D knob unavailable (${e.message})`));
  }
}

// ---------- white or dark studio ----------
let palCache = null;
function pal() {  // canvas colours follow the theme
  if (!palCache) {
    const st = getComputedStyle(document.documentElement), v = n => st.getPropertyValue(n).trim();
    palCache = { grid: v('--cv-grid'), strong: v('--cv-grid-strong'), rowIn: v('--cv-row-in'), rowOut: v('--cv-row-out'), rowBlack: v('--cv-row-black'), label: v('--cv-label'), hilite: v('--cv-hilite'), clip: v('--cv-clip'), wave: v('--cv-wave'), subtle: v('--subtle'), muted: v('--muted'), accent: v('--accent'), text: v('--text'), rec: v('--rec'), tick: v('--tick') };
  }
  return palCache;
}
function applyTheme() {
  document.documentElement.dataset.theme = ui.theme;
  $('#theme').replaceChildren(icon(ui.theme === 'light' ? 'moon' : 'sun', 17));
  styleKnob?.setTheme(ui.theme);
  palCache = null;
}

function chordNames() {
  const names = song.harmony.map(c => c.name), half = names.length / 2;
  return Number.isInteger(half) && names.slice(0, half).join() === names.slice(half).join() ? names.slice(0, half) : names;  // the loop repeats
}

const aiStatus = msg => { Object.assign($('#ai-status'), { textContent: msg, title: msg }); };
const aiReady = () => { $('#ai-chip').classList.add('on'); $('#ai-chip .t').textContent = 'AI ready'; };
let busy = false;
async function withBusy(fn) {
  if (busy) return hint('The brain is still busy with the last request. Try again in a moment.');
  busy = true;
  document.querySelectorAll('#make, #new-part').forEach(b => { b.disabled = true; });
  try { await fn(); } catch (e) { aiStatus(`The AI stopped: ${e.message}`); }
  busy = false;
  document.querySelectorAll('#make, #new-part').forEach(b => { b.disabled = false; });
}
async function runAiMelody(pattern) {
  const end = (patternOf(song, pattern)?.bars ?? 8) * BAR;
  track('melody')[pattern] = (await aiMelody(song, pattern, ui.temp, aiStatus)).filter(n => n.t < end);
  aiReady();
}
async function runAiDrums(pattern) {
  const parts = await aiDrums(song, pattern, ui.temp, aiStatus);
  const end = (patternOf(song, pattern)?.bars ?? 8) * BAR;
  for (const [id, notes] of Object.entries(parts)) if (track(id)) track(id)[pattern] = notes.filter(n => n.t < end);
  song = refresh(song, {}, ['bass']);  // the 808 follows the AI's new kick
  aiReady();
}
const make = (opts = {}) => withBusy(() => makeBeat(opts));
async function makeBeat(opts = {}) {
  const st = STYLES[opts.style ?? ui.style], [lo, hi] = st.bpm, bpm = opts.bpm ?? (song.bpm >= lo && song.bpm <= hi ? song.bpm : st.bpm[2]);
  const root = opts.root ?? song.root, mode = opts.mode ?? song.mode;
  {
    const next = generate({ style: opts.style ?? ui.style, bpm, root, mode, energy: ui.energy, complexity: ui.complexity, groove: opts.groove });
    next.tracks.push(...song.tracks.filter(t => t.user || t.kind === 'audio'));  // your own channels and recordings stay
    setSong(next);
    const used = [];
    if (ui.flKit && lib.length) {
      const picked = hasFL ? await applyKit() : [];
      used.push(...picked);
      if (!picked.length) { const k = flKit.find(x => x.name === `${STYLE_KIT[song.style] ?? 'Trap Kit'} (BeatLab)`); if (k) { await loadKit(k); used.push(k.name); } }
      used.push(...await applyInstruments());
    }
    if (ui.aiMel) await runAiMelody(hookId(song));
    if (ui.aiDrm) await runAiDrums(song.patterns.find(p => p.name === 'Verse')?.id ?? hookId(song));
    if (ui.aiFeel) for (const p of new Set([hookId(song), song.patterns.find(x => x.name === 'Verse')?.id].filter(Boolean))) await humanizeIn(p);
    if (ui.autoMix) await autoMix(false);
    changed();
    const extras = [opts.groove && 'drum groove copied from the reference', used.length && `Sounds: ${used.slice(0, 3).join(', ')}`, (ui.aiMel || ui.aiDrm || ui.aiFeel) && 'AI parts included', ui.autoMix && 'mix balanced'].filter(Boolean);
    aiStatus('');
    toast(`New ${st.name} beat at ${bpm} BPM in ${NOTES[root]} ${mode}${opts.like ? `, like ${opts.like}` : ''}.${extras.length ? ` ${extras.join('; ')}.` : ''} Ctrl+Z brings the last one back.`);
  }
}

// ---------- auto mix ----------
// Every part plays the Hook on its own through its own effects, gets measured (LUFS), and moves to where a
// balanced beat puts it: kick and 808 up front, snare just behind, lead over the chords, hats and textures
// underneath. Low cuts keep chords, leads and hats out of the kick and bass's way.
const MIX_TARGET = { kick: -10, snare: -12.5, hat: -20, openhat: -22, perc: -21, bass: -11, chords: -16, arp: -20, melody: -14, texture: -28, fx: -24 };
const KIND_TARGET = { drum: -19, bass: -11, chords: -16, melody: -15, texture: -28, fx: -24 };
const LOW_CUT = { chords: 120, melody: 150, arp: 200, hat: 300, openhat: 250, perc: 180 };
async function autoMix(say = true) {
  const p = hookId(song), moves = [], measured = [];
  for (const t of song.tracks) {  // low cuts first, so what's measured is what you'll hear
    const f = LOW_CUT[t.id] ?? (t.kind === 'chords' ? 120 : t.kind === 'melody' ? 150 : null);
    if (f && !t.fx.some(x => x.auto) && t.fx.length < 8) t.fx.unshift({ type: 'filter', hp: 1, cutoff: f, res: 0.7, auto: true });
  }
  for (const t of song.tracks) {  // one at a time: each is a few bars, and memory stays low
    const want = MIX_TARGET[t.id] ?? KIND_TARGET[t.kind];
    if (want == null || t.mute || !notesFor(t, p).length) continue;
    aiStatus(`Balancing the mix: ${trackName(t)}…`);
    const l = await lufsOf(await render(song, p, dusty(), t.id, { sr: 48000, master: song.master }));
    if (Number.isFinite(l) && l > -70) measured.push({ t, vol: t.vol * 10 ** (clamp(want - l, -24, 24) / 20) });
  }
  // The balance is what matters: everything moves together so the loudest part sits at full volume,
  // and the master and the export's loudness target take care of the level
  const k = Math.min(1, 1 / Math.max(1e-6, ...measured.map(x => x.vol)));
  for (const { t, vol } of measured) {
    const v = clamp(vol * k, 0.02, 1.2), moved = 20 * Math.log10(v / t.vol);
    t.vol = v;
    if (Math.abs(moved) >= 1) moves.push(`${trackName(t)} ${moved > 0 ? '+' : ''}${moved.toFixed(1)} dB`);
  }
  mixChanged();
  aiStatus('');
  if (say) { changed(); toast(moves.length ? `Mix balanced: ${moves.join(', ')}. Low cuts added where they help. Ctrl+Z undoes it.` : 'The mix was already balanced.'); }
  return moves;
}

// ---------- the mix doctor: listens to the hook, names what's wrong, and fixes it on request ----------
async function listenToMix() {
  const p = hookId(song), parts = [];
  aiStatus('The mix doctor is listening to the whole mix…');
  const mixBuf = await render(song, p, dusty(), null, { sr: 48000, master: song.master });
  for (const t of song.tracks) {
    if (t.mute || t.kind === 'bus' || t.kind === 'audio' || !notesFor(t, p).length) continue;
    aiStatus(`The mix doctor is listening to the ${trackName(t)}…`);
    const b = await render(song, p, dusty(), t.id, { sr: 48000, master: song.master }), x = b.getChannelData(0).slice();
    if (b.numberOfChannels > 1) { const r = b.getChannelData(1); for (let i = 0; i < x.length; i++) x[i] = (x[i] + r[i]) / 2; }
    parts.push({ id: t.id, name: trackName(t), kind: t.kind, x, lufs: await lufsOf(b), duck: t.duck, target: MIX_TARGET[t.id] ?? KIND_TARGET[t.kind], lowCut: t.fx.some(f => f.type === 'filter' && f.hp > 0.5 && !f.off) });
  }
  aiStatus('');
  return diagnose({ sr: 48000, mix: { l: mixBuf.getChannelData(0), r: mixBuf.getChannelData(mixBuf.numberOfChannels > 1 ? 1 : 0), lufs: await lufsOf(mixBuf), peak: db(peakOf(mixBuf)) }, parts, master: song.master, dusty: dusty() });
}
async function applyFix(f) {  // a fix is data from doctor.js; each one is the move a mix engineer would make
  const t = f.track ? track(f.track) : null;
  if (f.kind === 'duck') t.duck = f.value;
  if (f.kind === 'lowcut') for (const id of f.tracks) { const x = track(id); if (x && !x.fx.some(e => e.type === 'filter' && e.hp > 0.5)) x.fx.unshift({ type: 'filter', hp: 1, cutoff: f.f, res: 0.7, auto: true }); }
  if (f.kind === 'eq') Object.assign(t.fx.find(e => e.doctor) ?? addFx(t, { type: 'peq', doctor: true }), f.set);
  if (f.kind === 'vol') t.vol = clamp(t.vol * 10 ** (f.dB / 20), 0.02, 1.2);
  if (f.kind === 'tone') f.tracks.map(track).filter(Boolean).forEach(x => shapeTone(x, f.dir));
  if (f.kind === 'width') f.tracks.map(track).filter(Boolean).forEach(x => { const w = x.fx.find(e => e.type === 'width') ?? addFx(x, { type: 'width' }); w.width = f.value; });
  if (f.kind === 'master') song.master = { ...song.master, ...f.set };
  if (f.kind === 'automix') await autoMix(false);
  mixChanged();
}
const SCORE_WORDS = s => (s >= 90 ? 'Ready to release' : s >= 70 ? 'Nearly there' : s >= 45 ? 'Needs work' : 'Needs a lot of work');
function doctorChart(r) {  // each octave of the mix against a finished mix: above the line louder, below quieter
  const cols = r.bands.map((v, i) => {
    const d = clamp(v - r.ref[i], -18, 18), px = Math.max(2, Math.abs(d) * 2.4);
    return h('div', { class: 'doc-col', title: `${['30', '60', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'][i]} Hz: ${d > 0 ? '+' : ''}${d.toFixed(1)} dB` },
      h('i', { class: Math.abs(d) > 3 ? 'off' : '', style: `height:${px}px;${d >= 0 ? `bottom:50%` : `top:50%`}` }),
      h('small', {}, ['30', '60', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'][i]));
  });
  return h('div', { class: 'doc-chart', role: 'img', 'aria-label': "Your mix's frequency balance against a finished mix" },
    h('div', { class: 'doc-bars' }, cols), h('p', {}, 'Each bar is an octave of your mix against a finished one: above the line is louder, below is quieter. Orange bars are off by more than 3 dB.'));
}
async function mixDoctor(before = null) {
  const r = await listenToMix();
  const fixAll = h('button', { class: 'key primary btn', style: 'height:34px', onclick: () => withBusy(async () => { for (const i of r.issues) await applyFix(i.fix); changed(); await mixDoctor(r.score); }) }, icon('brain', 15), r.issues.length === 1 ? 'Fix it' : `Fix all ${r.issues.length}`);
  const card = i => h('div', { class: 'doc-issue', 'data-issue': i.id },
    h('span', { class: `doc-dot${i.weight >= 12 ? ' hot' : ''}`, 'aria-hidden': 'true' }),
    h('div', {}, h('b', {}, i.title), h('p', {}, i.detail)),
    h('button', { class: 'btn small', onclick: () => withBusy(async () => { await applyFix(i.fix); changed(); await mixDoctor(r.score); }) }, i.fixLabel));
  const gain = before != null ? r.score - before : null;
  openDialog({ title: 'Mix doctor', glyph: 'brain', body: [
    h('div', { class: 'doc-head' },
      h('div', { class: 'doc-score', role: 'img', 'aria-label': `Mix health ${r.score} out of 100` }, h('b', {}, String(r.score)), h('small', {}, '/ 100')),
      h('div', {}, h('b', {}, SCORE_WORDS(r.score)), h('p', { class: 'note' }, gain != null ? `${gain >= 0 ? `Up ${gain}` : `Down ${-gain}`} from ${before}. Ctrl+Z undoes the fixes.` : `It listened to ${patternOf(song, hookId(song))?.name ?? 'the hook'} part by part, the way an engineer would.`)),
      r.issues.length ? fixAll : null),
    doctorChart(r),
    r.issues.length ? h('div', { class: 'doc-list' }, r.issues.map(card)) : h('p', { class: 'note' }, 'Nothing to fix: this mix measures like a finished one.'),
  ] });
}

// ---------- the brain: what you type becomes steps, done as one undo ----------
const brainCtx = () => ({
  tracks: song.tracks.map(t => ({ id: t.id, name: trackName(t), kind: t.kind })),
  styles: STYLE_IDS.map(id => ({ id, name: STYLES[id].name })),
  effects: Object.entries(EFFECTS).map(([id, f]) => ({ id, name: f.name })),
  instruments: flInst.map(i => i.name), kits: flKit.map(k => k.name),
});
const brainNames = () => ({ ...Object.fromEntries(song.tracks.map(t => [t.id, trackName(t)])), drums: 'the drums', mix: 'the mix', vocals: 'the vocals', ...Object.fromEntries(STYLE_IDS.map(id => [id, STYLES[id].name])), ...Object.fromEntries(Object.entries(EFFECTS).map(([id, f]) => [id, f.name])) });
const NEEDS_PARTS = ['mute', 'solo', 'pan', 'unfx', 'instrument'];
function brainPlan(text) {
  return plan(text, brainCtx()).map(st => (NEEDS_PARTS.includes(st.type) && !(st.parts ?? []).length ? { type: 'unknown', text: describe(st) } : st));
}
function brainItem(q) {  // the palette's top line when what you typed is a request rather than a search
  const steps = brainPlan(q), known = steps.filter(x => x.type !== 'unknown'), words = q.split(/\s+/).length;
  if (ui.smart && !known.length && words >= 3) return { label: `Ask the smart brain: "${q}"`, icon: 'brain', run: () => runBrain(q) };
  if (!known.length || (steps.length === 1 && words < 2)) return null;
  return { label: steps.map(x => (x.type === 'unknown' && ui.smart ? `smart brain: "${x.text}"` : describe(x, brainNames()))).join(' · '), icon: 'brain', run: () => runBrain(q) };
}
function partTracks(ps) {
  const out = new Set();
  for (const id of ps) {
    if (id === 'mix') song.tracks.filter(t => t.kind !== 'audio').forEach(t => out.add(t));
    else if (id === 'drums') song.tracks.filter(t => t.kind === 'drum').forEach(t => out.add(t));
    else if (id === 'vocals') (song.tracks.some(t => t.kind === 'audio') ? song.tracks.filter(t => t.kind === 'audio') : song.tracks.filter(t => t.kind === 'melody')).forEach(t => out.add(t));  // recordings, or the lead if there are none
    else (track(id) ? [track(id)] : song.tracks.filter(t => t.kind === ({ hat: 'drum', snare: 'drum', kick: 'drum', perc: 'drum', openhat: 'drum' }[id] ?? id))).forEach(t => out.add(t));
  }
  return [...out];
}
const sectionPattern = st => {
  if (!st.section) return ui.pattern;
  const name = st.section === 'chorus' ? 'hook' : st.section;
  return song.patterns.find(x => x.name.toLowerCase() === name)?.id ?? song.patterns.find(x => x.name.toLowerCase().startsWith(name))?.id ?? ui.pattern;
};
const fxOf = (t, type) => t.fx.find(f => f.type === type && !f.auto);
function addFx(t, fx) { if (t.fx.length < 8) t.fx.push(fx); return fx; }
function shapeTone(t, dir) {  // darker, brighter, warmer…: the smallest change a mix engineer would make
  const lp = t.fx.find(f => f.type === 'filter' && !(f.hp > 0.5));
  if (dir === 'darker') { if (lp) lp.cutoff = Math.max(400, (lp.cutoff ?? 8000) * 0.55); else addFx(t, { type: 'filter', cutoff: 2800, res: 0.7 }); }
  if (dir === 'brighter') { if (lp) lp.cutoff = Math.min(20000, (lp.cutoff ?? 8000) * 1.8); const eq = fxOf(t, 'eq') ?? addFx(t, { type: 'eq', high: 0 }); eq.high = Math.min(12, (eq.high ?? 0) + 4); }
  if (dir === 'warmer') { const x = fxOf(t, 'tape') ?? addFx(t, { type: 'tape', drive: 0.25 }); x.drive = Math.min(1, (x.drive ?? 0.35) + 0.15); }
  if (dir === 'grittier') { const x = fxOf(t, 'drive') ?? addFx(t, { type: 'drive', amount: 0.3 }); x.amount = Math.min(1, (x.amount ?? 0.3) + 0.2); }
  if (dir === 'wider' || dir === 'narrower') { const x = fxOf(t, 'width') ?? addFx(t, { type: 'width', width: 1 }); x.width = dir === 'wider' ? Math.min(2, (x.width ?? 1) + 0.5) : Math.max(0, (x.width ?? 1) - 0.5); }
  if (dir === 'wetter') t.rev = Math.min(1, (t.rev ?? 0) + 0.15);
  if (dir === 'drier') { t.rev = Math.max(0, (t.rev ?? 0) - 0.15); t.dly = Math.max(0, (t.dly ?? 0) - 0.1); }
  if (dir === 'echo') t.dly = Math.min(1, (t.dly ?? 0) + 0.2);
}
function addSlides(every, p) {  // the 808 slides up into the last 8th of every few bars, and back down after
  const t = track('bass'), notes = t?.[p];
  if (!notes?.length) return 'there is no bass in this pattern';
  for (let b = every - 1; b < barsOf(p); b += every) {
    const end = (b + 1) * BAR, inBar = notes.filter(n => n.t >= b * BAR && n.t < end).sort((x, y) => x.t - y.t), last = inBar.at(-1);
    if (!last) continue;
    const at = end - 2 * STEP;
    if (last.t >= at) { last.g = 1; continue; }
    last.d = Math.max(STEP, Math.min(last.d, at - last.t));
    notes.push({ t: at, d: 2 * STEP, p: last.p + (b % (2 * every) === every - 1 ? 12 : 7), v: last.v, g: 1 });
    const next = notes.find(n => n.t >= end && n.t < end + STEP);
    if (next) next.g = 1;
  }
  return t.sound === '808' || t.sound === 'synth' || t.sound === 'lead' ? null : `the slides glide on the 808 or a synth bass; ${trackName(t)} plays them as notes`;
}
function addHatRolls(every, p) {
  const t = track('hat');
  if (!t) return 'there are no hats';
  t[p] ??= [];
  for (let b = every - 1; b < barsOf(p); b += every) {
    const from = b * BAR + 12 * STEP;
    t[p] = t[p].filter(n => n.t < from || n.t >= (b + 1) * BAR);
    [[12, 1], [13, 2], [14, 3], [15, 4]].forEach(([s, k]) => { for (let i = 0; i < k; i++) t[p].push({ t: b * BAR + s * STEP + Math.floor(i * STEP / k), d: Math.max(2, Math.floor(STEP / k / 2)), p: 60, v: 70 + Math.round(40 * (s - 12 + i / k) / 4) }); });
  }
  return null;
}
async function runStep(st) {
  const ts = partTracks(st.parts ?? []), pid = sectionPattern(st);
  switch (st.type) {
    case 'make': chooseStyle(st.style); return makeBeat({ style: st.style, bpm: st.bpm });
    case 'tempo': return setBpm(st.bpm, true);
    case 'tempoBy': return setBpm(song.bpm + st.delta, true);
    case 'tempoTimes': return setBpm(Math.round(song.bpm * st.f), true);
    case 'key': return setKey(st.root ?? song.root, st.mode ?? song.mode);
    case 'transpose':
      if (Math.abs(st.semis) === 12) { for (const t of song.tracks) if (t.kind !== 'drum' && t.kind !== 'audio') for (const p of song.patterns) for (const n of t[p.id] ?? []) n.p = clamp(n.p + st.semis, 12, 115); return changed(); }
      song = transpose(song, ((song.root + st.semis) % 12 + 12) % 12); return changed();
    case 'swing': song.swing = st.value; return changed();
    case 'swingBy': song.swing = clamp(st.delta <= -1 ? 0 : song.swing + st.delta, 0, 0.5); return changed();
    case 'ai':
      if (st.what === 'humanize') return humanizeIn(pid);
      if (st.what === 'fill') return fillIn(pid);
      if (st.what === 'vary-drums') return varyIn('drums', pid);
      if (st.what === 'vary-melody') return varyIn('melody', pid);
      if (st.what === 'melody') return runAiMelody(pid);
      return runAiDrums(pid);
    case 'slides': return addSlides(st.every, pid);
    case 'hatRolls': return addHatRolls(st.every, pid);
    case 'automix': return autoMix(false);
    case 'doctor': return mixDoctor();
    case 'agent': { const note = await songAgent(); showView('arrange'); return note; }
    case 'hum': return startHum();
    case 'export': return openExport(st.fmt === 'mp3' ? { mp3: true } : st.fmt === 'midi' ? { mix: false, stems: false } : st.fmt === 'stems' ? { stems: true } : {});
    case 'regen': song = regenerate(song, st.part); return changed();
    case 'energy': song = refresh(song, { energy: clamp((song.energy ?? ui.energy) + st.delta, 0, 1) }, ['kick', 'snare', 'hat', 'openhat', 'perc', 'bass']); return changed();
    case 'mute': ts.forEach(t => { t.mute = st.on; }); return mixChanged();
    case 'solo': ts.forEach(t => { t.solo = st.on; }); return mixChanged();
    case 'pan': ts.forEach(t => { t.pan = st.value; }); return mixChanged();
    case 'vol': ts.forEach(t => { t.vol = clamp(t.vol * 10 ** (st.dB / 20), 0, 1.2); }); return mixChanged();
    case 'fx': ts.forEach(t => addFx(t, { type: st.fx, ...st.set })); return mixChanged();
    case 'unfx': ts.forEach(t => { t.fx = t.fx.filter(f => (st.fx ? f.type !== st.fx : f.auto)); }); return mixChanged();
    case 'tone': ts.filter(t => t.kind !== 'audio').forEach(t => shapeTone(t, st.dir)); return mixChanged();
    case 'kit': return loadKit(flKit.find(k => k.name === st.name));
    case 'instrument': { const inst = flInst.find(i => i.name === st.name); for (const t of ts.filter(x => x.kind !== 'drum' && x.kind !== 'audio')) await loadInstrument(t, inst); return null; }
    case 'play': if (!player?.playing) togglePlay(); return null;
    case 'stop': if (player?.playing) togglePlay(); return null;
    default: return null;
  }
}
async function runBrain(text, { quiet = false } = {}) {
  if (busy) return hint('The brain is still busy with the last request. Try again in a moment.');
  let steps = brainPlan(text);
  const names = brainNames(), said = [];
  busy = true;
  batching = true;
  document.querySelectorAll('#make, #new-part').forEach(b => { b.disabled = true; });
  try {
    const unknown = steps.filter(x => x.type === 'unknown');
    if (ui.smart && unknown.length) {  // the smart brain rewrites what the rules didn't get into commands they do
      const ask = unknown.map(x => x.text).join('. ');
      try {
        const rewritten = fromModel(await smartRewrite(ask, aiStatus)), extra = brainPlan(rewritten).filter(x => x.type !== 'unknown');
        steps = [...steps.filter(x => x.type !== 'unknown'), ...extra];
        said.push(extra.length ? `the smart brain read "${ask}" as: ${rewritten}` : `✗ the smart brain couldn't turn "${ask}" into anything BeatLab can do`);
      } catch (e) { said.push(`✗ the smart brain didn't run: ${e.message}`); }
    }
    for (const st of steps) {
      if (st.type === 'unknown') { said.push(`✗ ${describe(st)}`); continue; }
      aiStatus(`${describe(st, names)}…`);
      const note = await runStep(st);
      said.push(`✓ ${describe(st, names)}${typeof note === 'string' ? ` (${note})` : ''}`);
    }
  } catch (e) { said.push(`✗ stopped: ${e.message}`); }
  batching = false;
  busy = false;
  document.querySelectorAll('#make, #new-part').forEach(b => { b.disabled = false; });
  toolbarKnobs();
  changed();
  const ok = said.filter(x => x.startsWith('✓')).length;
  aiStatus(said.join('  ·  '));
  if (!quiet) toast(`${ok} of ${steps.length} done: ${said.join('; ')}.${ok ? ' Ctrl+Z undoes all of it.' : ''}`);
  renderChat();
  return { said, ok };
}
function toggleSmart() {
  if (!ui.smart && !smartAvailable()) return toast("The smart brain needs WebGPU, which this browser doesn't have. Chrome or Edge on a PC with a graphics card can run it.");
  ui.smart = !ui.smart;
  save();
  toast(ui.smart ? 'Smart brain on. When the brain doesn’t understand part of a request, a small free AI model on this computer (Qwen 2.5, about 1 GB, downloaded the first time) rewrites it into commands BeatLab knows. It can only do what the brain can do, and you see what it read.' : 'Smart brain off.');
}
const askBrain = () => palette({ items: commands(), parse: q => parseCommand(q) ?? brainItem(q), placeholder: 'Tell the brain what to do, like "darker chords, 808 slides every 4 bars and humanize the drums"' });
// A drummer's feel, variations and fills for the pattern you're in
const kitIds = () => song.tracks.filter(t => t.kind === 'drum').map(t => t.id);
const barsOf = p => patternOf(song, p)?.bars ?? 8;
async function humanizeIn(p) {
  const parts = await aiHumanize(song, p, barsOf(p), aiStatus);
  for (const [id, notes] of Object.entries(parts)) track(id)[p] = notes;
  aiReady();
}
async function fillIn(p) {
  const parts = await aiFill(song, p, barsOf(p), aiStatus);
  for (const [id, notes] of Object.entries(parts)) track(id)[p] = notes;
  aiReady();
}
const aiHumanizeButton = () => withBusy(async () => {
  await humanizeIn(ui.pattern);
  changed();
  aiStatus(`The AI played ${pat().name}'s drums with a human feel: small pushes and drags, and real dynamics. Ctrl+Z undoes it.`);
});
const aiFillButton = () => withBusy(async () => {
  await fillIn(ui.pattern);
  changed();
  aiStatus(`The AI played a fill in ${pat().name}'s last bar. Press it again for another.`);
});
let vary = null;  // the variations made for one part, so pressing again steps through them
const melodic = () => { const t = track(ui.selected); return t && t.kind !== 'drum' && t.kind !== 'audio' && notesFor(t, ui.pattern).length ? t : track('melody'); };
async function varyIn(kind, p) {
  const t = kind === 'melody' ? melodic() : null, key = `${kind}|${p}|${t?.id ?? ''}`;
  const now = () => JSON.stringify(kind === 'drums' ? kitIds().map(id => notesFor(track(id), p)) : notesFor(t, p));
  if (vary?.key !== key || vary.applied !== now()) {  // anything edited since: vary what's there now
    vary = { key, i: -1, list: await aiVariations(song, p, barsOf(p), kind, t, ui.temp, aiStatus) };
  }
  vary.i = (vary.i + 1) % vary.list.length;
  const v = vary.list[vary.i];
  if (kind === 'drums') for (const [id, notes] of Object.entries(v)) track(id)[p] = notes;
  else t[p] = v;
  vary.applied = now();
  aiReady();
  return `Variation ${vary.i + 1} of ${vary.list.length} of ${kind === 'drums' ? 'the drums' : trackName(t)} in ${patternOf(song, p).name}`;
}
const aiVaryButton = kind => withBusy(async () => {
  const said = await varyIn(kind, ui.pattern);
  changed();
  aiStatus(`${said}. Press again for the next, Ctrl+Z to go back.`);
});
const aiMelodyButton = () => withBusy(async () => { await runAiMelody(ui.pattern); changed(); aiStatus(`The AI wrote a new melody for ${pat().name}. Press it again for another take.`); });
const aiDrumsButton = () => withBusy(async () => { await runAiDrums(ui.pattern); changed(); aiStatus(`The AI played ${pat().name}'s drums on from your first two bars.`); });
function newPartMenu(anchor) {
  menu(anchor, [
    { heading: 'Rewrite one part' },
    ...[['drums', 'New drums'], ['chords', 'New chords'], ['bass', 'New bass'], ['melody', 'New melody']].map(([part, text]) => ({
      label: text, icon: 'dice', onSelect: () => setSong(regenerate(song, part), `${text}. Everything else stayed the same. Ctrl+Z undoes it.`),
    })),
    '-', { heading: 'On every new beat' },
    { label: 'AI writes the hook melody', active: ui.aiMel, onSelect: () => { ui.aiMel = !ui.aiMel; save(); } },
    { label: 'AI plays the verse drums', active: ui.aiDrm, onSelect: () => { ui.aiDrm = !ui.aiDrm; save(); } },
    '-', { heading: 'AI brain' },
    { label: `AI melody for ${pat().name}`, hint: 'Follows the chords', icon: 'brain', onSelect: aiMelodyButton },
    { label: `AI drums for ${pat().name}`, hint: 'From bars 1 and 2', icon: 'brain', onSelect: aiDrumsButton },
    { label: 'Tell the brain…', hint: 'Ctrl+K', icon: 'brain', onSelect: askBrain },
    { label: 'Hum a melody', hint: 'Into the microphone', icon: 'mic', onSelect: startHum },
    { label: 'Smart brain for anything it doesn’t know', hint: 'Free, 1 GB once', active: ui.smart, onSelect: toggleSmart },
    { label: 'Humanize the drums', hint: 'A drummer\'s feel', icon: 'brain', onSelect: aiHumanizeButton },
    { label: 'Vary the drums', hint: 'Press again for the next', icon: 'brain', onSelect: () => aiVaryButton('drums') },
    { label: `Vary ${trackName(melodic())}`, hint: 'Press again for the next', icon: 'brain', onSelect: () => aiVaryButton('melody') },
    { label: 'Fill in the last bar', icon: 'brain', onSelect: aiFillButton },
  ], { width: 300 });
}

// ---------- Listen ----------
async function useFile(file) {
  try {
    await setRef({ title: file.name.replace(/\.[^.]+$/, ''), artist: 'From this computer', genre: '' }, await file.arrayBuffer());
  } catch {
    toast(`${file.name} couldn't be read. Try an MP3, WAV or M4A file.`);
  }
}
async function setRef(meta, bytes) {
  stopRef();
  $('#ref').hidden = false;
  $('#ref-empty').hidden = true;
  $('#ref').replaceChildren(h('p', { class: 'dim' }, `Listening to ${meta.title}…`));
  const buffer = await decode(bytes);
  await new Promise(r => setTimeout(r, 30));  // let the message paint before the number crunching
  const a = analyze(buffer);
  if (!a.bpms.length) return $('#ref').replaceChildren(h('p', { class: 'dim' }, `${meta.title} is too short to measure. Use at least 10 seconds of audio.`));
  const sugg = suggestStyles(a.bpms, a.key.mode, meta.genre);
  ref = { meta, buffer, a, sugg, pick: sugg[0] };
  renderRef();
}
function renderRef() {
  const { meta, a, sugg } = ref, others = a.bpms.slice(1).map(b => Math.round(b)).join(' or ');
  const wave = h('canvas', { 'aria-hidden': 'true' });
  $('#ref').replaceChildren(
    h('div', { style: 'display:flex;gap:8px;align-items:center' },
      h('div', { class: 'grow', style: 'min-width:0' }, h('div', { class: 'title' }, meta.title), h('div', { class: 'dim', style: 'font-size:12px' }, [meta.artist, meta.genre].filter(Boolean).join(', '))),
      h('button', { class: 'btn small', id: 'ref-play', onclick: () => toggleRef() }, icon(refSrc ? 'stop' : 'play', 14), refSrc ? 'Stop' : 'Play')),
    wave,
    h('div', { class: 'stats' },
      h('div', {}, h('span', {}, 'Tempo, BPM'), h('b', {}, `${Math.round(a.bpms[0])}`), others ? h('small', {}, `or ${others}`) : null),
      h('div', {}, h('span', {}, 'Key'), h('b', { class: 'text' }, a.key.name), h('small', {}, `or ${a.keys.slice(1).map(k => k.name).join(', ')}`)),
      h('div', {}, h('span', {}, 'Loudness, LUFS'), h('b', { class: a.lufs == null ? 'text' : '' }, a.lufs == null ? 'n/a' : a.lufs.toFixed(1)), h('small', {}, 'Released songs: about -14 to -7')),
      h('div', {}, h('span', {}, 'Highest peak, dB'), h('b', { class: a.peak > -0.1 ? 'warn text' : '' }, `${a.peak > 0 ? '+' : ''}${a.peak.toFixed(1)}`), h('small', {}, a.peak > -0.1 ? 'Clips. Add a limiter at -1 dB.' : 'No clipping'))),
    h('div', { class: 'sect', style: 'margin-top:4px' }, 'Closest styles'),
    h('div', { class: 'sugg' }, sugg.map(s => h('button', { class: 'btn small', 'aria-pressed': s === ref.pick, onclick: () => { ref.pick = s; renderRef(); } }, `${STYLES[s.id].name}, ${s.bpm}`))),
    toggle({ label: 'Copy its drum groove', checked: ui.copyGroove, onChange: v => { ui.copyGroove = v; save(); } }),
    h('p', { class: 'note' }, 'Groove copying works best on beats without vocals. In the Master view you can compare it with your beat at matched loudness.'),
    h('button', { class: 'key primary make', style: 'height:40px;margin-top:10px;padding:0 16px', onclick: makeLikeRef }, icon('brain', 16), `Make a ${STYLES[ref.pick.id].name} beat like this`));
  requestAnimationFrame(() => drawWave(wave, ref.buffer));
}
function drawWave(cv, buf) {
  const w = cv.clientWidth, ht = cv.clientHeight, d = buf.getChannelData(0), g = cv.getContext('2d');
  cv.width = w * 2;
  cv.height = ht * 2;
  g.scale(2, 2);
  g.fillStyle = '#D6D6D6';
  const step = Math.floor(d.length / w);
  for (let x = 0; x < w; x++) {
    let m = 0;
    for (let i = x * step; i < (x + 1) * step; i += 16) m = Math.max(m, Math.abs(d[i]));
    g.fillRect(x, ht / 2 - m * ht / 2, 1, Math.max(1, m * ht));
  }
}
function toggleRef(gainDb = 0) {
  if (refSrc) return stopRef();
  if (player?.playing) togglePlay();
  audio();
  refSrc = ctx.createBufferSource();
  refSrc.buffer = ref.buffer;
  const g = ctx.createGain();
  g.gain.value = 10 ** (gainDb / 20);
  refSrc.connect(g).connect(ctx.destination);
  refSrc.onended = () => { refSrc = null; const b = $('#ref-play'); if (b) b.replaceChildren(icon('play', 14), 'Play'); if (showing('master')) renderMaster(); };
  refSrc.start();
  $('#ref-play')?.replaceChildren(icon('stop', 14), 'Stop');
}
function stopRef() {
  if (!refSrc) return;
  const src = refSrc;
  src.onended();
  src.onended = null;
  src.stop();
}
function makeLikeRef() {
  const { a, pick } = ref;
  ui.style = pick.id;
  renderBrain();
  const g = ui.copyGroove ? groove(ref.buffer, pick.bpm) : null;
  const copied = g && Object.fromEntries(Object.entries(g).filter(([, v]) => v));
  make({ style: pick.id, bpm: pick.bpm, root: a.key.root, mode: a.key.mode, groove: copied && Object.keys(copied).length ? copied : null, like: ref.meta.title });
}
const COUNTRIES = [['IN', 'India'], ['US', 'US'], ['GB', 'UK'], ['CA', 'Canada'], ['NG', 'Nigeria']];
function renderCountry() {
  $('#country-pick').replaceChildren(picker({ label: 'Store country', value: ui.country, options: COUNTRIES.map(([value, label]) => ({ value, label })), onChange: v => { ui.country = v; save(); renderCountry(); } }));
}
// iTunes Search API: free, no key, and open to web pages, so the studio asks Apple directly.
// An Apple Music link is looked up by its song id.
async function findSongs(q, country) {
  const id = q.match(/[?&]i=(\d+)/)?.[1] ?? q.match(/music\.apple\.com\/.*?\/(\d{6,})/)?.[1];
  const url = id ? `https://itunes.apple.com/lookup?id=${id}&country=${country}`
    : `https://itunes.apple.com/search?${new URLSearchParams({ term: q, media: 'music', entity: 'song', limit: 25, country })}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status === 403 || r.status === 429 ? 'Apple is limiting searches for a minute.' : `Apple answered ${r.status}.`);
  return (await r.json()).results.filter(x => x.previewUrl).map(x => ({ title: x.trackName, artist: x.artistName, genre: x.primaryGenreName ?? '', art: x.artworkUrl100, preview: x.previewUrl }));
}
async function search(e) {
  e.preventDefault();
  const q = $('#q').value.trim(), list = $('#results');
  if (!q) return;
  list.replaceChildren(h('li', { class: 'muted' }, 'Searching…'));
  try {
    const items = await findSongs(q, ui.country);
    if (!items.length) return list.replaceChildren(h('li', { class: 'muted' }, `No songs found for "${q}". Try adding the artist, another country, or paste an Apple Music link.`));
    list.replaceChildren(...items.map(it => h('li', {},
      h('img', { src: it.art, alt: '', loading: 'lazy' }),
      h('div', { style: 'min-width:0' }, h('div', { class: 't', title: it.title }, it.title), h('div', { class: 'a' }, `${it.artist}, ${it.genre}`)),
      h('div', { class: 'btns' },
        h('button', { class: 'iconbtn', 'aria-label': `Preview ${it.title}`, title: 'Preview', onclick: ev => togglePreview(it, ev.currentTarget) }, icon('play', 15)),
        h('button', { class: 'btn small', 'aria-label': `Analyze ${it.title}`, onclick: () => analyzeItem(it) }, 'Analyze')))));
  } catch (err) {
    list.replaceChildren(h('li', { class: 'muted' }, `Search didn't work: ${err.message} Check the internet connection and try again.`));
  }
}
const previewAudio = new Audio();
function togglePreview(it, btn) {
  for (const b of document.querySelectorAll('.results .iconbtn')) b.replaceChildren(icon('play', 15));
  if (previewAudio.src === it.preview && !previewAudio.paused) return previewAudio.pause();
  previewAudio.src = it.preview;
  previewAudio.play();
  btn.replaceChildren(icon('stop', 15));
  previewAudio.onended = () => btn.replaceChildren(icon('play', 15));
}
async function analyzeItem(it) {
  previewAudio.pause();
  try {
    const r = await fetch(it.preview);
    if (!r.ok) throw new Error(`Apple answered ${r.status}.`);
    await setRef(it, await r.arrayBuffer());
  } catch (err) {
    $('#ref').hidden = false;
    $('#ref').replaceChildren(h('p', { class: 'dim' }, `Couldn't load the preview: ${err.message}`));
  }
}

// ---------- Sounds: FL Studio's sample library as a folder tree ----------
async function loadLibrary() {
  try {
    const own = await fetch('samples/index.json').then(r => r.json()).then(j => j.files, () => []);
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);  // BeatLab's server only ever runs on this PC
    const fl = local ? await fetch('/api/samples').then(r => (r.ok && /json/.test(r.headers.get('content-type') ?? '') ? r.json() : null)).catch(() => null) : null;
    server = !!fl;  // without the desktop server BeatLab runs as a website: FL sounds from a folder you pick, exports as a zip
    const packs = server ? fl.files : [...flFiles.keys()].sort();
    lib = [...packs, ...own];
    hasFL = packs.length > 0;
    flInst = flInstruments(lib);
    flKit = flKits(lib);
    $('#lib-note').replaceChildren(hasFL
      ? `${lib.length} sounds: FL Studio's packs and BeatLab's own kits. Click one to hear it, then Load it onto the selected channel or drag it onto any channel.`
      : `${lib.length} of BeatLab's own sounds: drum kits, 808s and loops. ${server ? "FL Studio's packs weren't found on this computer." : 'Have FL Studio? Connect its Packs folder and its sounds join them.'} You can also drop WAV or MP3 files onto any channel.`,
      ...(server || hasFL ? [] : [' ', h('button', { class: 'btn small', id: 'connect-fl', onclick: connectFL }, 'Connect FL Studio')]));
  } catch {
    $('#lib-note').textContent = "Couldn't read the sample library. Is BeatLab still running?";
  }
  renderBrain();
  renderSounds();
}
// As a website, FL Studio's packs come from the visitor's own FL install: they pick its Packs folder and
// the browser reads the sounds from there. Nothing is uploaded, and it's picked again after a reload.
function connectFL() {
  const input = document.createElement('input');
  input.type = 'file';
  input.webkitdirectory = true;
  input.onchange = async () => {
    const files = [...input.files].filter(f => isAudio(f.name)), at = p => { const s = p.split('/'), i = s.findIndex(x => /^packs$/i.test(x)); return s.slice(i + 1 || 1).join('/'); };
    if (!files.length) return toast("That folder has no sounds in it. Pick FL Studio's Packs folder: Program Files, Image-Line, FL Studio, Data, Patches, Packs.");
    flFiles = new Map(files.map(f => [at(f.webkitRelativePath), f]));
    await loadLibrary();
    await restoreSounds(song.tracks);
    renderView();
    toast(`FL Studio connected: ${flFiles.size} sounds, ${flInst.length} instruments and ${flKit.length} drum kits. Make a beat picks from them now.`);
  };
  toast("Pick FL Studio's Packs folder: Program Files, Image-Line, FL Studio, Data, Patches, Packs. Chrome calls it uploading, but the sounds stay on your computer.");
  input.click();
}
function sampleRow(p, depth, showFolder) {
  const parts = p.split('/'), name = parts.pop().replace(/\.\w+$/, ''), sel = track(ui.selected);
  const li = h('li', { draggable: 'true', title: p, style: `padding-left:${8 + depth * 14}px`, onclick: () => hear(p) },
    icon('wave', 14), h('span', { class: 'nm' }, name, showFolder ? h('small', {}, `  ${parts.slice(-2).join(' / ')}`) : null),
    h('button', { class: 'btn small load', title: `Load onto ${sel ? trackName(sel) : 'the selected channel'}`, onclick: e => { e.stopPropagation(); useLibrarySample(track(ui.selected), p); } }, 'Load'));
  li.addEventListener('dragstart', e => e.dataTransfer.setData('text/x-beatlab-sample', p));
  return li;
}
function soundsView() {
  V.sounds.tools.replaceChildren(h('span', { class: 'crumb' }, `Load puts a sound on ${trackName(track(ui.selected))}`),
    flInst.length ? h('button', { class: 'btn small', title: 'Play one of FL Studio\'s instruments on the selected channel', onclick: e => instrumentMenu(e.currentTarget, track(ui.selected)) }, icon('piano', 14), 'FL instrument') : null,
    flKit.length ? h('button', { class: 'btn small', title: 'Put one of FL Studio\'s drum kits on every drum channel', onclick: e => kitMenu(e.currentTarget) }, icon('pads', 14), 'Drum kit') : null);
  renderSounds();
}
function renderSounds() {
  const q = $('#lib-q').value.trim().toLowerCase(), list = $('#samples');
  if (q) {
    const hits = lib.filter(p => p.toLowerCase().includes(q)).slice(0, 300);
    list.replaceChildren(...hits.map(p => sampleRow(p, 0, true)));
    if (lib.length && !hits.length) list.replaceChildren(h('li', { class: 'dim' }, `Nothing matches "${q}".`));
    return;
  }
  const rows = [], walk = (prefix, depth) => {  // folders first, then sounds, opening only expanded folders
    const here = lib.filter(p => p.startsWith(prefix)).map(p => p.slice(prefix.length));
    const folders = [...new Set(here.filter(p => p.includes('/')).map(p => p.split('/')[0]))];
    for (const f of folders) {
      const path = prefix + f, open = ui.open.includes(path), count = here.filter(p => p.startsWith(f + '/')).length;
      rows.push(h('li', { class: 'folder', style: `padding-left:${6 + depth * 14}px`, 'aria-expanded': open, onclick: () => { ui.open = open ? ui.open.filter(x => !x.startsWith(path)) : [...ui.open, path]; save(); renderSounds(); } },
        icon(open ? 'down' : 'right', 13), h('span', { class: 'icon f' }, icon('folder', 15)), h('span', { class: 'nm' }, f), h('small', {}, count)));
      if (open) walk(path + '/', depth + 1);
    }
    for (const p of here.filter(x => !x.includes('/'))) rows.push(sampleRow(prefix + p, depth, false));
  };
  walk('', 0);
  list.replaceChildren(...rows);
}
async function hear(path) {
  audio();
  try {
    if (!buffers.has(path)) await loadSamplePath({}, path);
    previewSrc?.stop();
    previewSrc = engine.preview(await buffers.get(path));
  } catch (e) { toast(`Couldn't play that sound: ${e.message}`); }
}

// ---------- adding channels and audio ----------
function addChannel(kind, sound) {
  const n = song.tracks.filter(t => t.user && t.kind === kind).length + 1, t = newTrack(kind, sound, n);
  song.tracks.push(t);
  ui.selected = t.id;
  changed();
  reveal = t.id;  // the new channel in view, as in FL
  revealChannel();
  toast(`Added ${trackName(t)}. ${kind === 'audio' ? 'Record onto it in Song mode, or drop audio files on the playlist.' : 'Program it in the channel rack or the piano roll.'}`);
  return t;
}
const FL_KIND = { Bass: 'bass', Hits: 'melody' };
const FL_PREFER = { bass: ['Bass'], chords: ['Keys', 'Guitar', 'Orchestral', 'Pads', 'Choir and vocal'], melody: ['Keys', 'Orchestral', 'Guitar', 'Hits', 'Choir and vocal', 'Pads'] };  // the families that suit a channel come first
async function addFlChannel(inst) {
  const kind = FL_KIND[inst.group] ?? 'chords', t = addChannel(kind, kind === 'bass' ? 'bass' : 'keys');
  t.name = inst.name;
  try { await loadInstrument(t, inst); changed(); audition(t, kind === 'bass' ? 36 : 60); } catch (e) { toast(`Couldn't load ${inst.name}: ${e.message}`); }
}
function instrumentMenu(anchor, t) {
  if (!t || t.kind === 'audio') return toast('Pick an instrument channel first.');
  const all = [...new Set(flInst.map(i => i.group))], pref = FL_PREFER[t.kind] ?? [], groups = [...pref.filter(g => all.includes(g)), ...all.filter(g => !pref.includes(g))];
  menu(anchor, groups.flatMap((g, k) => [...(k ? ['-'] : []), { heading: g }, ...flInst.filter(i => i.group === g).map(i => ({
    label: i.name, hint: i.files.length > 1 ? `${i.files.length}` : '', active: t.inst?.id === i.id,
    onSelect: async () => { try { await loadInstrument(t, i); changed(); audition(t, t.kind === 'bass' ? 36 : 60); } catch (e) { toast(`Couldn't load ${i.name}: ${e.message}`); } },
  }))]), { width: 260 });
}
function kitMenu(anchor, only = null) {
  menu(anchor, [{ heading: only ? `A kit hit for ${trackName(only)}` : 'Drum kit for every drum channel' }, ...flKit.map(k => ({ label: k.name, hint: `${k.files.length}`, active: song.kit === k.id, onSelect: () => loadKit(k, only) }))], { width: 240 });
}
// Step through neighbours: the next preset, FL instrument, kit or sample in the same folder
async function browseSound(t, dir) {
  if (t.inst?.kit) {
    const i = flKit.findIndex(k => k.id === t.inst.kit), k = flKit[(i + dir + flKit.length) % flKit.length];
    return loadKit(k, t).then(() => audition(t, 60));
  }
  if (t.inst) {
    const same = flInst.filter(x => x.group === (flInst.find(y => y.id === t.inst.id)?.group ?? x.group)), i = same.findIndex(x => x.id === t.inst.id), next = same[(i + dir + same.length) % same.length];
    await loadInstrument(t, next);
    changed();
    return audition(t, t.kind === 'bass' ? 36 : 60);
  }
  if (t.samplePath) {
    const dir0 = t.samplePath.slice(0, t.samplePath.lastIndexOf('/') + 1), list = lib.filter(x => x.startsWith(dir0) && !x.slice(dir0.length).includes('/'));
    return useLibrarySample(t, list[(list.indexOf(t.samplePath) + dir + list.length) % list.length]);
  }
  const names = Object.keys(PRESETS[t.sound] ?? {});
  if (!names.length) return;
  usePreset(t, names[(names.indexOf(t.preset) + dir + names.length) % names.length]);
}
function usePreset(t, name) {
  t.params = { ...PRESETS[t.sound][name] };
  t.preset = name;
  changed();
  audition(t, t.kind === 'drum' ? 60 : t.kind === 'bass' ? 36 : 64);
}
function addTrackMenu(anchor) {
  menu(anchor, [
    { heading: 'Audio' }, { label: 'Audio channel', hint: 'For recordings', icon: 'mic', onSelect: () => addChannel('audio') },
    '-', { heading: 'Drum channel' }, ...SOUNDS_FOR.drum.map(s => ({ label: SOUNDS[s], icon: 'plus', onSelect: () => addChannel('drum', s) })),
    '-', { heading: 'Bass' }, ...SOUNDS_FOR.bass.map(s => ({ label: SOUNDS[s], icon: 'plus', onSelect: () => addChannel('bass', s) })),
    '-', { heading: 'Keys and pads' }, ...SOUNDS_FOR.chords.map(s => ({ label: SOUNDS[s], icon: 'plus', onSelect: () => addChannel('chords', s) })),
    '-', { heading: 'Lead' }, ...SOUNDS_FOR.melody.map(s => ({ label: SOUNDS[s], icon: 'plus', onSelect: () => addChannel('melody', s) })),
  ], { width: 240 });
}
function pickAudioFile(row = null) {
  const input = h('input', { type: 'file', accept: 'audio/*,.wav,.mp3,.m4a,.flac,.ogg', multiple: true });
  input.addEventListener('change', async () => { for (const f of input.files) await importAudio(f, row); });
  input.click();
}
const audioClipsOf = id => song.playlist.clips.filter(c => c.type === 'audio' && c.ch === id);
function freeRow(from = song.patterns.length) {  // the first playlist track with nothing on it
  const rows = song.playlist.rows;
  for (let r = from; r < rows.length; r++) if (!song.playlist.clips.some(c => c.row === r)) return r;
  rows.push({ name: `Track ${rows.length + 1}`, mute: false });
  return rows.length - 1;
}
// Like FL Studio, each audio file becomes its own audio channel (named after the file) with a clip on the playlist
async function importAudio(file, row = null, tick = ui.cursor) {
  audio();
  let buf;
  try { buf = await ctx.decodeAudioData(await file.arrayBuffer()); } catch { return toast(`${file.name} isn't an audio file this browser can read. Try WAV or MP3.`); }
  const t = newTrack('audio', null, song.tracks.filter(x => x.kind === 'audio').length + 1);
  t.name = file.name.replace(/\.\w+$/, '');
  song.tracks.push(t);
  const id = newId();
  audioBufs.set(id, buf);
  try { await putAudio(id, buf); } catch (e) { toast(`It plays, but the browser wouldn't store it: ${e.message}`); }
  song.playlist.clips.push({ id: clipId(), type: 'audio', ch: t.id, row: row ?? freeRow(), buf: id, name: t.name, t: Math.max(0, tick), off: 0, len: buf.duration, gain: 0, fi: 0, fo: 0, rev: false });
  if (ui.mode !== 'song') ui.mode = 'song';
  changed();
  toast(`${file.name} is on the playlist at bar ${Math.floor(tick / BAR) + 1}, on its own channel. Audio clips play in Song mode.`);
}
async function loadAudioFor(s) {  // fetch the stored audio every clip needs
  const ids = [...new Set((s.playlist?.clips ?? []).filter(c => c.type === 'audio').map(c => c.buf))].filter(id => !audioBufs.has(id));
  await Promise.all(ids.map(async id => { const b = await getAudio(id).catch(() => null); if (b) audioBufs.set(id, b); }));
}

// ---------- patterns ----------
const pat = () => patternOf(song, ui.pattern) ?? song.patterns[0];
const patBars = () => pat()?.bars ?? 8;
const hookId = s => (s.patterns.find(p => p.name === 'Hook') ?? s.patterns[0]).id;
function setPattern(id) {
  if (!patternOf(song, id)) return;
  ui.pattern = id;
  ui.bar = Math.min(ui.bar, patBars() - 1);
  rollSel.clear();
  if (player?.playing && ui.mode === 'pattern') player.load(song, view(), dusty(), audioBufs);
  save();
  renderTransport();
  renderView();
  renderPads();
}
function newPattern(clone = false) {
  const src = pat(), id = newPatternId(song), n = song.patterns.length + 1;
  song.patterns.push({ id, name: clone ? `${src.name} copy` : `Pattern ${n}`, bars: clone ? src.bars : 4, color: PATTERN_COLORS[(n - 1) % PATTERN_COLORS.length] });
  if (clone) for (const t of song.tracks) if (t[src.id]) t[id] = structuredClone(t[src.id]);
  ui.pattern = id;
  changed();
  hint(clone ? `Cloned ${src.name}. Paint it onto the playlist with the draw tool.` : `Pattern ${n} is empty and ready. Program it, then paint it onto the playlist.`);
}
function nextPattern(d) {
  const i = song.patterns.indexOf(pat());
  setPattern(song.patterns[(i + d + song.patterns.length) % song.patterns.length].id);
}
function deletePattern(id) {
  if (song.patterns.length < 2) return toast('A song needs at least one pattern.');
  const p = patternOf(song, id);
  song.patterns = song.patterns.filter(x => x !== p);
  for (const t of song.tracks) delete t[id];
  song.playlist.clips = song.playlist.clips.filter(c => c.pattern !== id);
  if (ui.pattern === id) ui.pattern = song.patterns[0].id;
  changed();
  toast(`Deleted ${p.name} and its clips. Ctrl+Z brings them back.`);
}
function renamePattern(id = ui.pattern) {
  const p = patternOf(song, id), input = h('input', { type: 'text', value: p.name, 'aria-label': 'Pattern name', style: 'width:100%' });
  const done = () => { const v = input.value.trim(); if (v) { p.name = v; changed(); } $('#dlg').close(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
  openDialog({ title: 'Rename pattern', glyph: 'info', wide: false, body: [h('label', { class: 'field' }, 'Name', input),
    h('div', { class: 'field', style: 'margin-top:12px' }, 'Colour', h('div', { style: 'display:flex;gap:6px' }, PATTERN_COLORS.map(c => h('button', { class: 'iconbtn', 'aria-label': `Colour ${c}`, 'aria-pressed': p.color === c, style: `background:${c};width:26px;height:26px;border-radius:7px`, onclick: () => { p.color = c; changed(); renamePattern(id); } })))),
    h('div', { class: 'ex-actions' }, h('button', { class: 'btn', onclick: () => $('#dlg').close() }, 'Cancel'), h('button', { class: 'key primary btn', onclick: done }, 'Rename'))] });
  input.select();
}
function patternMenu(anchor) {
  menu(anchor, [
    { heading: 'Patterns' },
    ...song.patterns.map((p, i) => ({ label: `${i + 1}  ${p.name}`, hint: `${p.bars} bar${p.bars === 1 ? '' : 's'}`, swatch: p.color, active: p.id === ui.pattern, onSelect: () => setPattern(p.id) })),
    '-',
    { label: 'New pattern', icon: 'plus', hint: 'F4', onSelect: () => newPattern() },
    { label: 'Clone this pattern', icon: 'copy', hint: 'Ctrl+Shift+C', onSelect: () => newPattern(true) },
    { label: 'Rename and colour…', icon: 'info', hint: 'F2', onSelect: () => renamePattern() },
    { label: 'Delete this pattern', icon: 'trash', danger: true, disabled: song.patterns.length < 2, onSelect: () => deletePattern(ui.pattern) },
  ], { width: 260 });
}
function renderPatternPicker() {
  const p = pat();
  $('#pat-pick').replaceChildren(h('button', { class: 'picker', 'aria-haspopup': 'menu', title: 'Pattern to edit and loop (numpad + and - step through them)', onclick: e => patternMenu(e.currentTarget) },
    h('span', { class: 'swatch', style: `background:${p.color}` }), h('span', { class: 'picker-text' }, `${song.patterns.indexOf(p) + 1}  ${p.name}`), icon('down', 14)),
    h('button', { class: 'iconbtn', title: 'New pattern (F4)', 'aria-label': 'New pattern', onclick: () => newPattern() }, icon('plus', 16)));
}

// ---------- Playlist: pattern clips and audio clips on tracks, the way FL Studio does it ----------
const TOOLS = {
  draw: ['P', 'pencil', 'Draw: click to place the selected pattern, drag a clip to move it, drag its end to resize it'],
  paint: ['B', 'brush', 'Paint: drag along a track to lay the pattern down again and again'],
  erase: ['D', 'eraser', 'Delete: click or drag over clips or notes to delete them'],
  mute: ['T', 'mute', 'Mute: click a clip or note to mute it, again to unmute'],
  slice: ['C', 'cut', 'Slice: click a clip or note to cut it in two there'],
  select: ['E', 'select', 'Select: drag a box round clips or notes, then drag them; Ctrl+B duplicates, Delete removes'],
};
const SNAPS = { bar: BAR, beat: PPQ, step: STEP, none: 1 };
let barWidth = 20, rowH = ROW, plSel = new Set();
const clipTicks = c => (c.type === 'audio' ? c.len / spt() : c.d);
const snapRound = (t, ev) => { const g = ev?.altKey ? 1 : SNAPS[ui.snap] ?? PPQ; return Math.round(t / g) * g; };  // Alt places freely, as in FL
const snapFloor = (t, ev) => { const g = ev?.altKey ? 1 : SNAPS[ui.snap] ?? PPQ; return Math.floor(t / g) * g; };
function setTool(k, where = ui.focus) {
  if (where === 'roll') ui.rollTool = k; else ui.tool = k;
  save();
  hint(TOOLS[k][2]);
  if (where === 'roll') renderRoll(); else renderPlaylist();
}
const toolBar = (current, where) => h('div', { class: 'seg', role: 'group', 'aria-label': 'Tools' }, Object.entries(TOOLS).map(([k, [key, ic, tip]]) => h('button', { 'aria-pressed': current === k, title: `${tip} (${key})`, 'aria-label': tip.split(':')[0], onclick: () => { ui.focus = where; setTool(k, where); } }, icon(ic, 15))));

function renderPlaylist() {
  const host = V.arrange, rows = song.playlist.rows, lanes = Object.entries(ui.lanes).filter(([id]) => track(id));
  host.tools.replaceChildren(
    toolBar(ui.tool, 'arrange'),
    picker({ label: 'Snap', value: ui.snap, options: [['bar', 'Snap: bar'], ['beat', 'Snap: beat'], ['step', 'Snap: step'], ['none', 'Snap: off']].map(([value, label]) => ({ value, label })), onChange: v => { ui.snap = v; save(); renderPlaylist(); } }),
    h('span', { class: 'crumb', title: 'The chords of the loop' }, chordNames().join('  ·  ')),
    h('button', { class: 'btn small', title: 'Show a channel\'s volume or filter as an automation lane', onclick: e => automationMenu(e.currentTarget) }, icon('auto', 14), 'Automate'),
    h('button', { class: 'btn small', title: 'Import audio files at the song position, or drop them on a track', onclick: () => pickAudioFile() }, icon('upload', 14), 'Audio'),
    h('div', { class: 'seg' }, h('button', { title: 'Zoom out (Ctrl + scroll)', 'aria-label': 'Zoom out', onclick: () => zoomPlaylist(1 / 1.4) }, '−'), h('button', { title: 'Zoom in (Ctrl + scroll)', 'aria-label': 'Zoom in', onclick: () => zoomPlaylist(1.4) }, '+')));
  const pl = host.body, len = songLength(song) / BAR, total = Math.max(32, len + 16);
  barWidth = Math.max(5, Math.round(Math.max(12, Math.floor((pl.clientWidth - hdr() - 14) / Math.max(8, len + 2))) * (ui.plZoom ?? 1)));
  const bw = barWidth, W = total * bw, n = rows.length + lanes.length;
  rowH = clamp(Math.floor((pl.clientHeight - ROW - 24) / Math.min(n, 11)), 34, 58);  // about eleven tracks fill the screen, the rest scroll
  const inner = h('div', { class: 'pl-inner', style: `grid-template-columns:${hdr()}px ${W}px; grid-template-rows:${ROW - 4}px 24px repeat(${n}, ${rowH}px) minmax(0, 1fr)` });
  const marks = (song.markers ?? []).map((m, i) => h('button', { class: 'marker', style: `--pc:var(--muted);left:${m.t / BAR * bw + 2}px;max-width:${Math.max(40, ((song.markers[i + 1]?.t ?? m.t + 8 * BAR) - m.t) / BAR * bw - 4)}px`, title: `${m.name}. Click to rename, move or delete it`, onclick: e => markerMenu(e.currentTarget, m) }, h('span', { class: 'swatch' }), h('span', {}, m.name)));
  const ruler = [];
  for (let b = 0; b < total; b++) {
    ruler.push(h('i', { style: `left:${b * bw}px` }));
    if (bw >= 22 || b % Math.ceil(22 / bw) === 0) ruler.push(h('span', { class: b % 4 === 0 ? 'major' : '', style: `left:${b * bw}px` }, b + 1));
  }
  ruler.push(h('i', { class: 'cursor-mark', style: `left:${ui.cursor / BAR * bw}px` }));
  inner.append(
    h('div', { class: 'pl-corner pl-top', style: 'top:0' }, icon('flag', 13), 'Markers'),
    h('div', { class: 'markers pl-top', style: 'top:0', title: 'Double-click to add a marker here', ondblclick: e => { if (e.target === e.currentTarget) addMarker(Math.floor(e.offsetX / bw) * BAR); } }, marks),
    h('div', { class: 'pl-corner pl-top', style: `top:${ROW - 4}px` }, 'Bar'),
    h('div', { class: 'ruler pl-top', style: `top:${ROW - 4}px`, title: 'Click to set the song position', onclick: e => setCursor(Math.floor(e.offsetX / bw) * BAR) }, ruler));
  rows.forEach((r, i) => {
    const head = h('div', { class: 'thead', 'data-row': i, title: 'Double-click to rename this track' , ondblclick: () => renameRow(i) },
      h('span', { class: 'bar', style: `background:${rowColor(i)}` }), h('div', { style: 'min-width:0' }, h('b', {}, r.name), h('small', {}, rowSummary(i))),
      h('span', { class: 'hbtns' },
        h('button', { class: 'ms m', 'aria-pressed': !!r.mute, title: 'Mute this playlist track', 'aria-label': `Mute ${r.name}`, onclick: e => { e.stopPropagation(); r.mute = !r.mute; changed(); } }, 'M'),
        h('button', { class: 'ms s', 'aria-pressed': !!r.solo, title: 'Solo this playlist track', 'aria-label': `Solo ${r.name}`, onclick: e => { e.stopPropagation(); r.solo = !r.solo; changed(); } }, 'S')));
    inner.append(head, h('canvas', { class: 'lane row', 'data-row': i, style: `width:${W}px;height:${rowH}px` }));
  });
  for (const [id, lane] of lanes) {
    const t = track(id);
    inner.append(h('div', { class: 'thead auto', style: `--c:${t.color}` },
      picker({ label: `${trackName(t)} automation`, value: lane, options: Object.entries(AUTO).map(([value, a]) => ({ value, label: `${trackName(t)} ${a.name.toLowerCase()}` })), onChange: v => { ui.lanes[id] = v; save(); renderPlaylist(); } }),
      h('button', { class: 'ms', title: 'Hide this lane (its points stay)', 'aria-label': 'Hide automation lane', onclick: () => { delete ui.lanes[id]; save(); renderPlaylist(); } }, '×')),
    h('canvas', { class: 'lane auto', 'data-id': id, 'data-lane': lane, style: `width:${W}px;height:${rowH}px`, title: 'Click to add a point, drag to move it, right-click to delete it' }));
  }
  inner.append(h('div', { class: 'thead', style: 'cursor:default' }), h('div', { style: `background-image:repeating-linear-gradient(90deg, ${pal().grid} 0 1px, transparent 1px ${bw}px)` }),
    h('div', { class: 'playhead', id: 'pl-head', hidden: ui.mode !== 'song', style: `left:${hdr() + ui.cursor / BAR * bw}px` }),
    h('div', { class: 'selbox', id: 'pl-box', hidden: true }));
  const keepX = pl.scrollLeft, keepY = pl.scrollTop;
  pl.replaceChildren(inner);
  pl.scrollLeft = keepX;
  pl.scrollTop = keepY;
  for (const cv of pl.querySelectorAll('.lane.row')) wireRow(cv, +cv.dataset.row);
  for (const cv of pl.querySelectorAll('.lane.auto')) wireAutoLane(cv, track(cv.dataset.id), cv.dataset.lane);
  drawPlaylist();
}
const rowColor = i => { const c = song.playlist.clips.find(x => x.row === i); return c ? (c.type === 'pattern' ? patternOf(song, c.pattern)?.color : track(c.ch)?.color) ?? 'var(--tick)' : 'var(--tick)'; };
function rowSummary(i) {
  const cs = song.playlist.clips.filter(c => c.row === i);
  if (!cs.length) return 'Empty';
  const names = [...new Set(cs.map(c => (c.type === 'pattern' ? patternOf(song, c.pattern)?.name : c.name)))];
  return names.length > 2 ? `${names.length} kinds of clip` : names.join(', ');
}
function renameRow(i) {
  const r = song.playlist.rows[i], input = h('input', { type: 'text', value: r.name, 'aria-label': 'Track name', style: 'width:100%' });
  const done = () => { const v = input.value.trim(); if (v) { r.name = v; changed(); } $('#dlg').close(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
  openDialog({ title: 'Rename playlist track', glyph: 'info', wide: false, body: [h('label', { class: 'field' }, 'Name', input), h('div', { class: 'ex-actions' }, h('button', { class: 'btn', onclick: () => $('#dlg').close() }, 'Cancel'), h('button', { class: 'key primary btn', onclick: done }, 'Rename'))] });
  input.select();
}
function zoomPlaylist(f) { ui.plZoom = clamp((ui.plZoom ?? 1) * f, 0.25, 8); save(); renderPlaylist(); }
function addMarker(t = ui.cursor) {
  (song.markers ??= []).push({ t, name: `Marker ${song.markers.length + 1}` });
  song.markers.sort((a, b) => a.t - b.t);
  changed();
}
function markerMenu(anchor, m) {
  const set = fn => () => { fn(); changed(); };
  menu(anchor, [
    { heading: m.name },
    ...SECTION_NAMES.map(n => ({ label: n, active: m.name === n, onSelect: set(() => { m.name = n; }) })),
    '-',
    { label: 'Play from here', icon: 'play', onSelect: () => { if (player?.playing) togglePlay(); ui.mode = 'song'; ui.cursor = m.t; togglePlay(m.t); renderView(); } },
    { label: 'Move one bar earlier', icon: 'left', disabled: m.t < BAR, onSelect: set(() => { m.t -= BAR; }) },
    { label: 'Move one bar later', icon: 'right', onSelect: set(() => { m.t += BAR; }) },
    { label: 'Delete marker', icon: 'trash', danger: true, onSelect: set(() => { song.markers = song.markers.filter(x => x !== m); }) },
  ], { width: 200 });
}
function automationMenu(anchor) {
  const sel = track(ui.selected) && track(ui.selected).kind !== 'bus' ? track(ui.selected) : song.tracks[0];
  menu(anchor, [
    { heading: `Automation clip for ${trackName(sel)}` },
    ...Object.entries(AUTO_PARAMS).map(([param, name]) => ({ label: name, icon: 'auto', hint: 'At the song position', onSelect: () => newAutoClip(sel, param) })),
    '-', { heading: 'Automation lane under the playlist' },
    ...song.tracks.filter(t => t.kind !== 'bus').map(t => ({ label: trackName(t), swatch: t.color, active: !!ui.lanes[t.id], onSelect: () => { if (ui.lanes[t.id]) delete ui.lanes[t.id]; else ui.lanes[t.id] = 'vol'; save(); renderPlaylist(); } })),
  ], { width: 240 });
}
// Automation clips, as in FL: a clip on the playlist that moves one setting of one channel over time.
// Points sit at fractions of the clip, so stretching it stretches the move.
const AUTO_PARAMS = { vol: 'Volume', cut: 'Filter cutoff', pan: 'Pan' };
const restOf = (t, param) => (param === 'pan' ? (t.pan + 1) / 2 : LANES[param].def);
function newAutoClip(t, param) {
  const v = restOf(t, param), c = { id: clipId(), type: 'auto', row: freeRow(), t: ui.cursor, d: 4 * BAR, target: { ch: t.id, param }, points: [{ x: 0, v: param === 'cut' ? 0.55 : v }, { x: 1, v }] };
  song.playlist.clips.push(c);
  if (ui.mode !== 'song') setMode('song');
  changed();
  toast(`Automation clip for ${trackName(t)} ${AUTO_PARAMS[param].toLowerCase()} on track ${c.row + 1}. Click inside it to add points and drag them, right-click a point to remove it. It plays in Song mode.`);
}
function autoY(v, ht) { return 16 + (1 - v) * (ht - 20); }
function drawAutoClip(g, c, x, w, ht, color) {
  const pts = [...c.points].sort((a, b) => a.x - b.x);
  g.strokeStyle = color;
  g.fillStyle = `${color}33`;
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(x, autoY(pts[0]?.v ?? 0.5, ht));
  for (const q of pts) g.lineTo(x + q.x * w, autoY(q.v, ht));
  g.lineTo(x + w, autoY(pts.at(-1)?.v ?? 0.5, ht));
  g.stroke();
  g.lineTo(x + w, ht - 2);
  g.lineTo(x, ht - 2);
  g.fill();
  g.fillStyle = color;
  for (const q of pts) { g.beginPath(); g.arc(x + q.x * w, autoY(q.v, ht), 2.6, 0, Math.PI * 2); g.fill(); }
}
const autoNear = (c, cv, e) => c.points.find(q => Math.hypot(clipX(c) + q.x * clipW(c) - e.offsetX, autoY(q.v, cv.clientHeight) - e.offsetY) < 8);
function editAutoClip(cv, e, c) {  // add a point or grab the nearest, then drag it
  const ht = cv.clientHeight, at = ev => ({ x: clamp((ev.clientX - cv.getBoundingClientRect().left - clipX(c)) / clipW(c), 0, 1), v: clamp(1 - (ev.clientY - cv.getBoundingClientRect().top - 16) / (ht - 20), 0, 1) });
  let q = autoNear(c, cv, e);
  if (!q) { q = at(e); c.points.push(q); }
  cv.setPointerCapture(e.pointerId);
  const t = track(c.target.ch), show = () => hint(`${trackName(t)} ${AUTO_PARAMS[c.target.param].toLowerCase()}: ${c.target.param === 'pan' ? `${Math.round((q.v * 2 - 1) * 100)}` : c.target.param === 'cut' ? `${Math.round(LANES.cut.toParam(q.v))} Hz` : `${Math.round(q.v / 0.8 * 100)}%`} at bar ${((c.t + q.x * c.d) / BAR + 1).toFixed(2)}`);
  show();
  drawPlaylist();
  const move = ev => { Object.assign(q, at(ev)); show(); drawPlaylist(); };
  const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); c.points.sort((a, b) => a.x - b.x); changed(); };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
}

function laneCanvas(cv) {
  const w = cv.clientWidth, ht = cv.clientHeight, dpr = devicePixelRatio || 1;
  cv.width = w * dpr;
  cv.height = ht * dpr;
  const g = cv.getContext('2d');
  g.scale(dpr, dpr);
  const every = barWidth < 10 ? 4 : 1;
  for (let b = 0; b <= w / barWidth; b += every) { g.fillStyle = b % 4 === 0 ? pal().strong : pal().grid; g.fillRect(b * barWidth, 0, 1, ht); }
  return { g, w, ht };
}
function drawPlaylist() {
  for (const cv of document.querySelectorAll('#pl .lane')) {
    if (cv.dataset.lane) { const t = track(cv.dataset.id); if (t) drawAutoLane(cv, t, cv.dataset.lane); }
    else drawRow(cv, +cv.dataset.row);
  }
}
const drawRowN = i => { const cv = document.querySelector(`#pl .lane.row[data-row="${i}"]`); if (cv) drawRow(cv, i); };

// Peaks of recorded and imported audio, cached per buffer at 200 points a second
const PEAKS = new Map();
function peaks(id) {
  if (!PEAKS.has(id)) {
    const b = audioBufs.get(id);
    if (!b) return null;
    const hop = Math.max(1, Math.floor(b.sampleRate / 200)), n = Math.ceil(b.length / hop), out = new Float32Array(n), chs = Array.from({ length: b.numberOfChannels }, (_, i) => b.getChannelData(i));
    for (let i = 0; i < n; i++) { let m = 0; for (const c of chs) for (let j = i * hop; j < Math.min(c.length, (i + 1) * hop); j += 4) m = Math.max(m, Math.abs(c[j])); out[i] = m; }
    PEAKS.set(id, out);
  }
  return PEAKS.get(id);
}
const clipX = c => c.t / BAR * barWidth, clipW = c => Math.max(3, clipTicks(c) / BAR * barWidth);
function drawRow(cv, r) {
  const { g, ht } = laneCanvas(cv), P = pal();
  for (const c of song.playlist.clips) {
    if (c.row !== r) continue;
    const x = clipX(c), w = clipW(c), on = plSel.has(c.id);
    const color = c.type === 'pattern' ? patternOf(song, c.pattern)?.color ?? P.muted : track(c.type === 'auto' ? c.target.ch : c.ch)?.color ?? P.muted;
    g.globalAlpha = c.mute ? 0.35 : 1;
    g.beginPath();
    g.roundRect(x + 1, 2, w - 2, ht - 4, 4);
    g.fillStyle = P.clip;
    g.fill();
    g.fillStyle = `${color}2A`;
    g.fill();
    g.fillStyle = `${color}70`;
    g.fillRect(x + 1, 2, w - 2, 13);  // the clip's name strip, as on FL's clips
    if (on) { g.strokeStyle = P.accent; g.lineWidth = 1.5; g.stroke(); }
    g.save();
    g.beginPath();
    g.rect(x + 1, 2, w - 2, ht - 4);
    g.clip();
    g.fillStyle = P.text;
    g.font = '500 10px Geist, sans-serif';
    g.fillText(c.type === 'pattern' ? patternOf(song, c.pattern)?.name ?? '?' : c.type === 'auto' ? `${trackName(track(c.target.ch) ?? {})} ${AUTO_PARAMS[c.target.param]?.toLowerCase()}` : `${c.name}${c.gain ? `  ${c.gain > 0 ? '+' : ''}${c.gain} dB` : ''}${c.rev ? '  reversed' : ''}`, x + 6, 12);
    if (c.type === 'pattern') drawPatternPreview(g, c, x, w, ht, color);
    else if (c.type === 'auto') drawAutoClip(g, c, x, w, ht, color);
    else drawAudioPreview(g, c, x, w, ht, color);
    g.restore();
    g.globalAlpha = 1;
  }
  if (rec?.kind === 'audio' && rec.row === r && player.playing && !player.counting) {  // the take so far
    const x0 = rec.from / BAR * barWidth, x1 = (rec.from + (player.position() - rec.from + player.length) % player.length) / BAR * barWidth;
    g.fillStyle = `${P.rec}40`;
    g.fillRect(x0, 2, Math.max(2, x1 - x0), ht - 4);
  }
}
function drawPatternPreview(g, c, x, w, ht, color) {  // every channel's notes, small, like FL's pattern clips
  const p = patternOf(song, c.pattern);
  if (!p) return;
  const lines = song.tracks.filter(t => (t[p.id] ?? []).length), top = 17, hh = ht - top - 4, lh = Math.max(1.5, Math.min(4, hh / Math.max(1, lines.length)));
  g.fillStyle = color;
  lines.forEach((t, k) => {
    const y = top + k * (hh / Math.max(1, lines.length));
    for (const n of t[p.id]) {
      const nt = n.t - (c.off ?? 0);
      if (nt < 0 || nt >= c.d) continue;
      g.fillRect(x + nt / BAR * barWidth, y, Math.max(1, Math.min(n.d, c.d - nt) / BAR * barWidth - 0.5), lh * 0.8);
    }
  });
}
function drawAudioPreview(g, c, x, w, ht, color) {
  const pk = peaks(c.buf), gl = 10 ** ((c.gain ?? 0) / 20), P = pal();
  if (!pk) { g.fillStyle = P.subtle; g.font = '11px Geist, sans-serif'; g.fillText('Audio missing', x + 8, ht / 2 + 6); return; }
  g.fillStyle = color;
  const mid = ht / 2 + 7, amp = (ht - 22) / 2;
  for (let px = 0; px < w; px++) {
    const sec = c.off + px / w * c.len, i = Math.floor(c.rev ? pk.length - 1 - sec * 200 : sec * 200), v = Math.min(1, (pk[clamp(i, 0, pk.length - 1)] ?? 0) * gl);
    g.fillRect(x + px, mid - v * amp, 1, Math.max(1, v * amp * 2));
  }
  g.strokeStyle = P.text;
  g.globalAlpha *= 0.5;
  const fiW = (c.fi ?? 0) / c.len * w, foW = (c.fo ?? 0) / c.len * w;
  if (fiW > 2) { g.beginPath(); g.moveTo(x + 1, ht - 2); g.lineTo(x + fiW, 15); g.stroke(); }
  if (foW > 2) { g.beginPath(); g.moveTo(x + w - foW, 15); g.lineTo(x + w - 1, ht - 2); g.stroke(); }
}

const clipsOnRow = r => song.playlist.clips.filter(c => c.row === r);
function hitClip(r, px) {
  for (const c of clipsOnRow(r).reverse()) {
    const x0 = clipX(c), x1 = x0 + clipW(c);
    if (px >= x0 && px <= x1) return { c, edge: px - x0 < 6 && x1 - x0 > 14 ? 'start' : x1 - px < 6 ? 'end' : null };
  }
  return null;
}
function placeClip(r, tick, ev) {
  const p = pat(), c = { id: clipId(), type: 'pattern', pattern: p.id, row: r, t: Math.max(0, snapFloor(tick, ev)), d: p.bars * BAR };
  song.playlist.clips.push(c);
  return c;
}
function wireRow(cv, r) {
  const tickAt = ev => Math.max(0, (ev.clientX - cv.getBoundingClientRect().left) / barWidth * BAR);
  cv.addEventListener('pointermove', e => {
    if (e.buttons) return;
    const k = hitClip(r, e.offsetX), tool = ui.tool;
    cv.style.cursor = tool === 'erase' ? 'not-allowed' : tool === 'slice' ? 'col-resize' : k?.edge ? 'ew-resize' : k ? 'grab' : tool === 'select' ? 'crosshair' : 'copy';
  });
  cv.addEventListener('dblclick', e => {
    const k = hitClip(r, e.offsetX);
    if (!k) return;
    if (k.c.type === 'pattern') { setPattern(k.c.pattern); showView('roll'); }
    else if (k.c.type !== 'auto') { select(k.c.ch); openPlugin(k.c.ch); }
  });
  cv.addEventListener('contextmenu', e => {
    e.preventDefault();
    const k = hitClip(r, e.offsetX);
    if (!k) return;
    if (ui.tool === 'select' || e.shiftKey) return clipMenu(e, k.c);
    const q = k.c.type === 'auto' && e.offsetY >= 15 ? autoNear(k.c, cv, e) : null;
    if (q) { if (k.c.points.length > 1) k.c.points = k.c.points.filter(x => x !== q); return changed(); }  // right-click a point removes it
    deleteClips([k.c.id]);  // right-click deletes, as in FL's playlist
  });
  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    ui.focus = 'arrange';
    let k = hitClip(r, e.offsetX);
    const tool = ui.tool;
    if (k && e.offsetY < 15 && e.offsetX - clipX(k.c) < 70 && tool !== 'erase' && tool !== 'slice') return clipMenu(e, k.c);  // the clip's name opens its menu
    if (tool === 'erase') { if (k) deleteClips([k.c.id]); return dragErase(cv, r); }
    if (tool === 'mute') { if (k) { k.c.mute = !k.c.mute; changed(); } return; }
    if (tool === 'slice') { if (k) sliceClip(k.c, snapRound(tickAt(e), e)); return; }
    if (tool === 'paint' && !k) return dragPaint(cv, r, e);
    if (tool === 'select' && !k) return dragBox(e);
    if (k?.c.type === 'auto' && !k.edge && e.offsetY >= 15 && (tool === 'draw' || tool === 'paint')) return editAutoClip(cv, e, k.c);  // inside: shape it; the name strip moves it
    if (!k) { k = { c: placeClip(r, tickAt(e), e), edge: null }; drawRowN(r); }
    if (!plSel.has(k.c.id) || tool !== 'select') plSel = new Set([k.c.id]);
    if (e.shiftKey) {  // Shift-drag drags a copy, as in FL
      const copies = [...plSel].map(id => ({ ...structuredClone(song.playlist.clips.find(c => c.id === id)), id: clipId() }));
      song.playlist.clips.push(...copies);
      plSel = new Set(copies.map(c => c.id));
      k = { c: copies.find(c => c.t === k.c.t && c.row === k.c.row) ?? copies[0], edge: null };
    }
    dragClips(cv, e, k);
  });
}
function dragClips(cv, e, k) {
  const moving = [...plSel].map(id => song.playlist.clips.find(c => c.id === id)).filter(Boolean);
  const starts = new Map(moving.map(c => [c, { t: c.t, row: c.row, d: c.d, off: c.off ?? 0, len: c.len }]));
  const x0 = e.clientX, y0 = e.clientY, s = spt(), c = k.c, dur = c.type === 'audio' ? audioBufs.get(c.buf)?.duration ?? c.off + c.len : 0;
  const pBars = c.type === 'pattern' ? (patternOf(song, c.pattern)?.bars ?? 8) * BAR : 0;
  cv.setPointerCapture(e.pointerId);
  const move = ev => {
    const dt = (ev.clientX - x0) / barWidth * BAR, drow = Math.round((ev.clientY - y0) / rowH), st = starts.get(c);
    if (k.edge === 'end') {
      if (c.type === 'audio') c.len = clamp(st.len + dt * s, 0.05, dur - c.off);
      else c.d = Math.max(SNAPS.step, snapRound(st.t + st.d + dt, ev) - c.t);
    } else if (k.edge === 'start') {
      const nt = clamp(snapRound(st.t + dt, ev), Math.max(0, st.t - (c.type === 'audio' ? st.off / s : st.off)), st.t + (c.type === 'audio' ? (st.len - 0.05) / s : st.d - SNAPS.step)), dd = nt - st.t;
      if (c.type === 'audio') Object.assign(c, { t: Math.round(nt), off: st.off + dd * s, len: st.len - dd * s });
      else Object.assign(c, { t: nt, off: Math.max(0, Math.min(pBars, st.off + dd)), d: st.d - dd });
    } else {
      const snapped = snapRound(st.t + dt, ev) - st.t;
      for (const [m, s0] of starts) { m.t = Math.max(0, s0.t + snapped); m.row = clamp(s0.row + drow, 0, song.playlist.rows.length - 1); }
    }
    hint(`${c.type === 'pattern' ? patternOf(song, c.pattern)?.name : c.name}: bar ${(c.t / BAR + 1).toFixed(2)}, track ${c.row + 1}, ${c.type === 'audio' ? clock(c.len) : `${(c.d / BAR).toFixed(2)} bars`}`);
    drawPlaylist();
  };
  const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); changed(); };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
}
function dragPaint(cv, r, e) {  // lays the selected pattern down end to end as you drag
  const p = pat(), rect = cv.getBoundingClientRect();
  let last = placeClip(r, (e.clientX - rect.left) / barWidth * BAR, e);
  drawRowN(r);
  cv.setPointerCapture(e.pointerId);
  const move = ev => {
    const tick = (ev.clientX - rect.left) / barWidth * BAR;
    while (tick >= last.t + last.d) { last = { ...last, id: clipId(), t: last.t + last.d }; song.playlist.clips.push(last); }
    drawRowN(r);
  };
  const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); hint(`Painted ${p.name}.`); changed(); };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
}
function dragErase(cv, r) {
  const move = ev => { if (!ev.buttons) return; const k = hitClip(r, ev.offsetX); if (k) { song.playlist.clips = song.playlist.clips.filter(c => c !== k.c); drawRowN(r); } };
  const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); changed(); };
  cv.addEventListener('pointermove', move);
  cv.addEventListener('pointerup', up);
}
function dragBox(e) {  // a box round clips selects them, across tracks
  const inner = V.arrange.body.querySelector('.pl-inner'), box = $('#pl-box'), r0 = inner.getBoundingClientRect(), x0 = e.clientX - r0.left, y0 = e.clientY - r0.top;
  const top = ROW - 4 + 24;
  box.hidden = false;
  const move = ev => {
    const x1 = ev.clientX - r0.left, y1 = ev.clientY - r0.top, l = Math.min(x0, x1), t = Math.min(y0, y1), w = Math.abs(x1 - x0), hh = Math.abs(y1 - y0);
    Object.assign(box.style, { left: `${l}px`, top: `${t}px`, width: `${w}px`, height: `${hh}px` });
    const tA = (l - hdr()) / barWidth * BAR, tB = (l + w - hdr()) / barWidth * BAR, rA = Math.floor((t - top) / rowH), rB = Math.floor((t + hh - top) / rowH);
    plSel = new Set(song.playlist.clips.filter(c => c.row >= rA && c.row <= rB && c.t < tB && c.t + clipTicks(c) > tA).map(c => c.id));
    drawPlaylist();
  };
  const up = () => { box.hidden = true; removeEventListener('pointermove', move); removeEventListener('pointerup', up); hint(`${plSel.size} clip${plSel.size === 1 ? '' : 's'} selected. Drag one to move them all, Ctrl+B duplicates, Delete removes.`); };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}
function deleteClips(ids) {
  const gone = new Set(ids);
  song.playlist.clips = song.playlist.clips.filter(c => !gone.has(c.id));
  for (const id of ids) plSel.delete(id);
  changed();
}
function duplicateClips() {  // Ctrl+B: the selection again, straight after itself
  const sel = song.playlist.clips.filter(c => plSel.has(c.id));
  if (!sel.length) return false;
  const a = Math.min(...sel.map(c => c.t)), b = Math.max(...sel.map(c => c.t + clipTicks(c))), span = Math.ceil((b - a) / BAR) * BAR || BAR;
  const copies = sel.map(c => ({ ...c, id: clipId(), t: c.t + span }));
  song.playlist.clips.push(...copies);
  plSel = new Set(copies.map(c => c.id));
  changed();
  return true;
}
function sliceClip(c, at) {
  const cut = at - c.t;
  if (cut <= 0 || cut >= clipTicks(c)) return;
  if (c.type === 'audio') {
    const secs = cut * spt();
    song.playlist.clips.push({ ...c, id: clipId(), name: `${c.name} (2)`, t: at, off: c.off + secs, len: c.len - secs, fi: 0.005 });
    Object.assign(c, { len: secs, fo: 0.005 });
  } else {
    song.playlist.clips.push({ ...c, id: clipId(), t: at, off: (c.off ?? 0) + cut, d: c.d - cut });
    c.d = cut;
  }
  changed();
}
function clipMenu(e, c) {
  const set = fn => () => { fn(); if (c.type === 'audio') PEAKS.delete(c.buf); changed(); };
  const common = [
    '-',
    { label: c.mute ? 'Unmute clip' : 'Mute clip', icon: 'mute', onSelect: set(() => { c.mute = !c.mute; }) },
    { label: 'Slice at the song position', icon: 'cut', disabled: !(ui.cursor > c.t && ui.cursor < c.t + clipTicks(c)), title: 'Click the ruler to put the song position inside the clip', onSelect: () => sliceClip(c, ui.cursor) },
    { label: 'Duplicate after it', icon: 'copy', onSelect: set(() => { song.playlist.clips.push({ ...structuredClone(c), id: clipId(), t: c.t + Math.ceil(clipTicks(c) / PPQ) * PPQ }); }) },
    { label: 'Delete clip', icon: 'trash', danger: true, onSelect: () => deleteClips([c.id]) },
  ];
  if (c.type === 'auto') {
    const t = track(c.target.ch);
    return menu(at(e), [
      { heading: `${trackName(t ?? {})} ${AUTO_PARAMS[c.target.param]?.toLowerCase()}` },
      ...Object.entries(AUTO_PARAMS).map(([param, name]) => ({ label: `Automate ${name.toLowerCase()}`, active: c.target.param === param, onSelect: set(() => { c.target.param = param; }) })),
      { label: 'Flatten', icon: 'history', onSelect: set(() => { c.points = [{ x: 0, v: restOf(t, c.target.param) }, { x: 1, v: restOf(t, c.target.param) }]; }) },
      { label: 'Ramp up', icon: 'up', onSelect: set(() => { c.points = [{ x: 0, v: 0.1 }, { x: 1, v: 0.9 }]; }) },
      { label: 'Ramp down', icon: 'down', onSelect: set(() => { c.points = [{ x: 0, v: 0.9 }, { x: 1, v: 0.1 }]; }) },
      ...common.filter(x => x === '-' || !/^Slice/.test(x.label)),
    ], { width: 230 });
  }
  if (c.type === 'pattern') {
    const p = patternOf(song, c.pattern);
    return menu(at(e), [
      { heading: `${p?.name ?? 'Pattern'} clip` },
      { label: 'Edit this pattern', icon: 'piano', onSelect: () => { setPattern(c.pattern); showView('roll'); } },
      { label: 'Make it unique', icon: 'copy', hint: 'A copy of the pattern just for this clip', onSelect: () => { setPattern(c.pattern); newPattern(true); c.pattern = ui.pattern; changed(); } },
      { label: 'Fit to the pattern length', icon: 'right', onSelect: set(() => { c.d = (p?.bars ?? 8) * BAR; c.off = 0; }) },
      ...common,
    ], { width: 250 });
  }
  const fade = (key, label) => [{ heading: label }, ...[[0, 'None'], [0.01, 'Short'], [0.5, 'Half a second'], [2, 'Two seconds']].map(([v, l]) => ({ label: l, active: Math.abs((c[key] ?? 0) - v) < 0.002, onSelect: set(() => { c[key] = Math.min(v, c.len / 2); }) }))];
  menu(at(e), [
    { heading: `${c.name} · ${clock(c.len)}` },
    { label: 'Louder, +3 dB', icon: 'up', onSelect: set(() => { c.gain = Math.min(24, (c.gain ?? 0) + 3); }) },
    { label: 'Quieter, -3 dB', icon: 'down', onSelect: set(() => { c.gain = Math.max(-36, (c.gain ?? 0) - 3); }) },
    { label: 'Normalize to -1 dB', icon: 'wave', onSelect: set(() => {
      const pk = peaks(c.buf);
      if (!pk) return;
      let m = 0;
      for (let i = Math.floor(c.off * 200); i < Math.min(pk.length, Math.ceil((c.off + c.len) * 200)); i++) m = Math.max(m, pk[c.rev ? pk.length - 1 - i : i]);
      if (m > 0) c.gain = Math.round((-1 - db(m)) * 10) / 10;
    }) },
    ...fade('fi', 'Fade in'), ...fade('fo', 'Fade out'),
    '-',
    { label: 'Reverse', icon: 'left', active: !!c.rev, onSelect: set(() => { const d = audioBufs.get(c.buf)?.duration ?? c.off + c.len; c.rev = !c.rev; c.off = Math.max(0, d - c.off - c.len); }) },
    { label: 'Channel settings', icon: 'knob', onSelect: () => { select(c.ch); openPlugin(c.ch); } },
    ...common,
  ], { width: 240 });
}

// Automation lanes: a channel's volume or filter over the song, as points joined by straight lines
function drawAutoLane(cv, t, lane) {
  const { g, w, ht } = laneCanvas(cv), P = pal(), spec = AUTO[lane], pts = t.auto?.[lane] ?? [], y = v => 5 + (1 - v) * (ht - 10), xOf = tick => tick / BAR * barWidth;
  g.strokeStyle = P.subtle;
  g.setLineDash([3, 4]);
  g.beginPath(); g.moveTo(0, y(spec.def)); g.lineTo(w, y(spec.def)); g.stroke();
  g.setLineDash([]);
  if (!pts.length) { g.fillStyle = P.subtle; g.font = '11px Geist, sans-serif'; g.fillText(`${trackName(t)} ${spec.name.toLowerCase()} stays at ${spec.text(spec.def)}. Click to add a point.`, 10, ht / 2 - 4); return; }
  g.beginPath();
  g.moveTo(0, y(pts[0].v));
  for (const p of pts) g.lineTo(xOf(p.t), y(p.v));
  g.lineTo(w, y(pts[pts.length - 1].v));
  g.strokeStyle = P.accent;
  g.lineWidth = 1.5;
  g.stroke();
  g.lineTo(w, ht); g.lineTo(0, ht); g.closePath();
  g.fillStyle = `${P.accent}14`;
  g.fill();
  for (const p of pts) { g.beginPath(); g.arc(xOf(p.t), y(p.v), 3.5, 0, Math.PI * 2); g.fillStyle = P.accent; g.fill(); }
}
function wireAutoLane(cv, t, lane) {
  const spec = AUTO[lane], ht = () => cv.clientHeight, vOf = py => clamp(1 - (py - 5) / (ht() - 10), 0, 1);
  const near = e => (t.auto?.[lane] ?? []).find(p => Math.hypot(p.t / BAR * barWidth - e.offsetX, 5 + (1 - p.v) * (ht() - 10) - e.offsetY) < 8);
  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    t.auto ??= {};
    t.auto[lane] ??= [];
    let p = near(e);
    if (!p) { p = { t: Math.round(e.offsetX / barWidth * 16) * STEP, v: vOf(e.offsetY) }; t.auto[lane].push(p); }
    const sort = () => t.auto[lane].sort((a, b) => a.t - b.t);
    sort();
    cv.setPointerCapture(e.pointerId);
    const r = cv.getBoundingClientRect();
    const move = ev => {
      p.t = Math.max(0, Math.round((ev.clientX - r.left) / barWidth * 16) * STEP);
      p.v = vOf(ev.clientY - r.top);
      sort();
      hint(`${trackName(t)} ${spec.name.toLowerCase()}: ${spec.text(p.v)} at bar ${(p.t / BAR + 1).toFixed(2)}`);
      drawAutoLane(cv, t, lane);
    };
    const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); changed(); };
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    hint(`${trackName(t)} ${spec.name.toLowerCase()}: ${spec.text(p.v)}`);
    drawAutoLane(cv, t, lane);
  });
  cv.addEventListener('contextmenu', e => {
    e.preventDefault();
    const p = near(e);
    if (p) { t.auto[lane] = t.auto[lane].filter(x => x !== p); changed(); }
  });
}

// ---------- views: one screen (Rig) or FL-style floating windows (DAW) ----------
const V = {};
const RENDER = { arrange: () => renderPlaylist(), rack: () => renderRack(), roll: () => renderRoll(), mixer: () => renderMixer(), master: () => renderMaster(), sounds: () => soundsView(), listen: () => {} };
function initViews() {
  const mk = (name, body) => { V[name] = { tools: h('div', { class: 'tools' }), body }; body.hidden = false; body.classList.add('vbody'); };
  mk('arrange', $('#pl'));
  for (const v of ['rack', 'roll', 'mixer']) mk(v, h('div', { class: 'dock-body screen', 'data-view-body': v }));
  mk('master', $('#tab-master'));
  mk('sounds', $('#tab-sounds'));
  mk('listen', $('#tab-listen'));
  for (const [name, v] of Object.entries(V)) v.body.addEventListener('pointerdown', () => { ui.focus = name; }, true);
}
function select(id) {
  ui.selected = id;
  save();
  if (ui.layout === 'daw') { for (const w of ['rack', 'roll', 'mixer']) if (ui.wins[w]?.open) RENDER[w](); }
  else if (ui.view !== 'arrange') renderView();
  renderPads();
  renderBrowser();
}
function showView(v) {
  ui.pview = null;  // a phone leaves the Make tab
  if (ui.layout === 'daw') return v === 'arrange' ? frontWin(null) : v === 'sounds' ? showBrowser('sounds') : openWin(v, true);
  ui.view = v;
  ui.focus = v;
  save();
  renderView();
}
// is a view on screen: the Rig's one display, or the DAW's playlist and open windows
const showing = v => ui.layout === 'daw' ? v === 'arrange' || !!ui.wins[v]?.open : ui.view === v;
// re-attaching a view resets its scroll, so only move it when it isn't already there
const put = (parent, el) => { if (parent.childNodes.length !== 1 || parent.firstChild !== el) parent.replaceChildren(el); };
function renderView() {
  if (ui.layout === 'daw') return renderWorkspace();
  for (const b of document.querySelectorAll('[data-view]')) b.setAttribute('aria-selected', b.dataset.view === ui.view);
  const v = V[ui.view];
  put($('#dock-tools'), v.tools);
  put($('.display-body'), v.body);
  RENDER[ui.view]();
  lastStep = -1;
  markPhoneTab();
  if (suggestion && !showing(suggestion.where)) { suggestion = null; showSuggestion(); }  // a suggestion belongs to its view
}

// The DAW layout: the playlist fills the desktop, the other editors float above it where you left them
const WIN = {
  rack: { title: 'Channel rack', icon: 'rack', key: 'F6', x: 40, y: 30, w: 1060, h: 470 },
  roll: { title: 'Piano roll', icon: 'piano', key: 'F7', x: 90, y: 60, w: 1180, h: 560 },
  mixer: { title: 'Mixer', icon: 'mixer', key: 'F9', x: 60, y: 90, w: 1240, h: 560 },
  master: { title: 'Master', icon: 'master', key: '', x: 120, y: 50, w: 1100, h: 560 },
  listen: { title: 'Listen', icon: 'listen', key: '', x: 140, y: 70, w: 1040, h: 560 },
};
const winEls = {};
function winEl(name) {
  if (winEls[name]) return winEls[name];
  const spec = WIN[name];
  const close = h('button', { class: 'iconbtn', title: 'Close', 'aria-label': `Close ${spec.title}`, onclick: () => closeWin(name) }, icon('close', 14));
  const max = h('button', { class: 'iconbtn', title: 'Maximize or restore', 'aria-label': `Maximize ${spec.title}`, onclick: () => { ui.wins[name].max = !ui.wins[name].max; save(); layoutWin(name); RENDER[name](); } }, icon('panel', 14));
  const head = h('div', { class: 'fhead' }, icon(spec.icon, 14), h('b', {}, spec.title), h('div', { class: 'ftools' }), h('span', { class: 'grow' }), max, close);
  const grip = h('div', { class: 'fgrip', 'aria-hidden': 'true' });
  const el = h('section', { class: 'fwin', 'data-win': name, role: 'dialog', 'aria-label': spec.title }, head, h('div', { class: 'fbody' }), grip);
  el.addEventListener('pointerdown', () => frontWin(name), true);
  head.addEventListener('dblclick', e => { if (!e.target.closest('button, .ftools')) { ui.wins[name].max = !ui.wins[name].max; save(); layoutWin(name); RENDER[name](); } });
  const drag = (handle, apply) => handle.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (handle === head && e.target.closest('button, .ftools, .picker, input'))) return;
    const st = ui.wins[name], s0 = { ...st }, x0 = e.clientX, y0 = e.clientY;
    if (st.max) return;
    handle.setPointerCapture(e.pointerId);
    const move = ev => { apply(st, s0, ev.clientX - x0, ev.clientY - y0); layoutWin(name); };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); save(); RENDER[name](); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
  drag(head, (st, s0, dx, dy) => { st.x = Math.max(0, s0.x + dx); st.y = Math.max(0, s0.y + dy); });
  drag(grip, (st, s0, dx, dy) => { st.w = Math.max(420, s0.w + dx); st.h = Math.max(240, s0.h + dy); });
  $('#desktop').append(el);
  return (winEls[name] = el);
}
function layoutWin(name) {
  const el = winEl(name), st = ui.wins[name], d = $('#desktop').getBoundingClientRect();
  el.classList.toggle('max', !!st.max);
  if (st.max) Object.assign(el.style, { left: '0px', top: '0px', width: `${d.width}px`, height: `${d.height}px` });
  else Object.assign(el.style, { left: `${clamp(st.x, 0, Math.max(0, d.width - 120))}px`, top: `${clamp(st.y, 0, Math.max(0, d.height - 40))}px`, width: `${Math.min(st.w, d.width)}px`, height: `${Math.min(st.h, d.height)}px` });
  el.style.zIndex = 10 + (st.z ?? 0);
}
function openWin(name, toggle = false) {
  ui.wins[name] ??= { ...WIN[name] };
  const st = ui.wins[name];
  if (toggle && st.open && st.z === topZ()) return closeWin(name);
  st.open = true;
  frontWin(name);
  save();
  renderWorkspace();
}
function closeWin(name) {
  if (ui.wins[name]) ui.wins[name].open = false;
  if (winEls[name]) winEls[name].hidden = true;
  if (ui.focus === name) ui.focus = 'arrange';
  save();
}
const topZ = () => Math.max(0, ...Object.values(ui.wins).filter(w => w.open).map(w => w.z ?? 0));
function frontWin(name) {
  if (!name) { ui.focus = 'arrange'; return; }
  const st = ui.wins[name];
  if (!st || st.z === topZ()) { ui.focus = name; return; }
  st.z = topZ() + 1;
  ui.focus = name;
  layoutWin(name);
}
function renderWorkspace() {
  const base = $('#base-win');
  put(base.querySelector('.ftools'), V.arrange.tools);
  put(base.querySelector('.fbody'), V.arrange.body);
  for (const name of Object.keys(WIN)) {
    const st = ui.wins[name];
    if (!st?.open) { if (winEls[name]) winEls[name].hidden = true; continue; }
    const el = winEl(name);
    el.hidden = false;
    put(el.querySelector('.ftools'), V[name].tools);
    put(el.querySelector('.fbody'), V[name].body);
    layoutWin(name);
  }
  renderPlaylist();
  for (const name of Object.keys(WIN)) if (ui.wins[name]?.open) RENDER[name]();
  renderBrowser();
  lastStep = -1;
}
function applyLayout() {
  const daw = ui.layout === 'daw';
  document.body.classList.toggle('daw', daw);
  $('#rig').classList.toggle('daw', daw);
  for (const b of document.querySelectorAll('[data-layout]')) b.setAttribute('aria-pressed', b.dataset.layout === ui.layout);
  if (!daw) for (const el of Object.values(winEls)) el.hidden = true;
  if (!daw && showing('sounds')) $('.display-body').replaceChildren(V.sounds.body);
  renderView();
}
function setLayout(l) {
  ui.layout = l;
  save();
  applyLayout();
  hint(l === 'daw' ? 'DAW layout: the playlist fills the screen and the channel rack (F6), piano roll (F7) and mixer (F9) float above it.' : 'Rig layout: one big screen over the devices.');
}

// The browser down the left of the DAW layout: the plugin library, FL Studio's sounds and this project
const GEN_GROUPS = [['Drums', 'drum'], ['Bass', 'bass'], ['Keys and pads', 'chords'], ['Leads', 'melody']];
function showBrowser(tab) { ui.btab = tab; save(); renderBrowser(); }
function renderBrowser() {
  if (ui.layout !== 'daw') return;
  const tab = ui.btab ?? 'plugins', body = $('#browser-body');
  for (const b of document.querySelectorAll('[data-btab]')) b.setAttribute('aria-selected', b.dataset.btab === tab);
  if (tab === 'sounds') { body.replaceChildren(V.sounds.body); renderSounds(); return; }
  const q = ($('#browser-q')?.value ?? '').trim().toLowerCase(), hit = s => !q || s.toLowerCase().includes(q);
  const item = (label, sub, ic, onclick, title, extra) => h('li', { title: title ?? sub, onclick }, icon(ic, 14), h('span', { class: 'nm' }, label, h('small', {}, `  ${sub}`)), extra);
  if (tab === 'plugins') {
    // Every entry is [folder, key, make]; starred keys also show in Favourites at the top
    const sel = track(ui.selected), entries = [], favs = new Set(ui.favs ?? []);
    const star = key => h('button', { class: 'iconbtn star', 'aria-pressed': favs.has(key), 'aria-label': favs.has(key) ? 'Remove from favourites' : 'Add to favourites', title: favs.has(key) ? 'Remove from favourites' : 'Add to favourites',
      onclick: ev => { ev.stopPropagation(); ui.favs = favs.has(key) ? [...favs].filter(x => x !== key) : [...favs, key]; save(); renderBrowser(); } }, icon('star', 13));
    const add = (folder, key, ...args) => entries.push([folder, key, () => item(...args, star(key))]);
    for (const [group, kind] of GEN_GROUPS) {
      for (const s of SOUNDS_FOR[kind].filter(s => hit(`${SOUNDS[s]} ${SOUND_INFO[s] ?? ''} ${group}`))) add(`Instruments · ${group}`, `g:${kind}:${s}`, SOUNDS[s], SOUND_INFO[s] ?? '', 'knob', () => addChannel(kind, s), `${SOUND_INFO[s] ?? SOUNDS[s]}. Click to add it as a new channel`);
    }
    for (const group of [...new Set(flInst.map(i => i.group))]) {
      for (const i of flInst.filter(i => i.group === group && hit(`${i.name} ${group} FL Studio`))) add(`FL Studio · ${group}`, `i:${i.id}`, i.name, i.files.length > 1 ? `${i.files.length} samples` : 'one sample', 'piano', () => addFlChannel(i), `${i.name} from FL Studio's packs. Click to add it as a new channel`);
    }
    for (const k of flKit.filter(k => hit(`${k.name} drum kit`))) add('FL Studio · Drum kits', `k:${k.id}`, k.name, `${k.files.length} samples`, 'pads', () => loadKit(k), `Put the ${k.name} kit on your drum channels`);
    for (const g of FX_GROUPS) {
      for (const [k, fx] of Object.entries(EFFECTS).filter(([, fx]) => fx.group === g && hit(`${fx.name} ${fx.info} ${g} effect`))) add(`Effects · ${g}`, `f:${k}`, fx.name, fx.info, 'mixer', () => {
        if (!sel) return toast('Select a channel first.');
        if (sel.fx.length >= 8) return toast(`${trackName(sel)} already has 8 effects.`);
        sel.fx.push({ type: k });
        mixChanged();
        openPlugin(sel.id);
        renderView();
      }, `Click to add ${fx.name} to ${sel ? trackName(sel) : 'the selected channel'}`);
    }
    const folder = label => h('li', { class: 'folder' }, icon(label === 'Favourites' ? 'star' : 'folder', 14), h('span', { class: 'nm' }, label));
    const mine = entries.filter(([, key]) => favs.has(key)), rows = mine.length ? [folder('Favourites'), ...mine.map(([, , make]) => make())] : [];
    entries.forEach(([f, , make], i) => { if (f !== entries[i - 1]?.[0]) rows.push(folder(f)); rows.push(make()); });
    body.replaceChildren(h('input', { id: 'browser-q', type: 'search', placeholder: 'Search instruments and effects', 'aria-label': 'Search plugins', value: q, oninput: () => { renderBrowser(); $('#browser-q').focus(); } }), h('ul', { class: 'tree one' }, rows));
    return;
  }
  // this project: patterns, channels and markers, each one click away
  const rows = [h('li', { class: 'folder' }, icon('folder', 14), h('span', { class: 'nm' }, 'Patterns'))];
  song.patterns.forEach((p, i) => rows.push(h('li', { class: p.id === ui.pattern ? 'cur' : '', onclick: () => setPattern(p.id), ondblclick: () => renamePattern(p.id), title: 'Click to edit, double-click to rename' }, h('span', { class: 'swatch', style: `background:${p.color}` }), h('span', { class: 'nm' }, `${i + 1}  ${p.name}`, h('small', {}, `  ${p.bars} bars`)))));
  rows.push(h('li', { class: 'folder' }, icon('folder', 14), h('span', { class: 'nm' }, 'Channels')));
  for (const t of song.tracks) rows.push(h('li', { class: t.id === ui.selected ? 'cur' : '', onclick: () => select(t.id), ondblclick: () => openPlugin(t.id) }, h('span', { class: 'swatch', style: `background:${t.color}` }), h('span', { class: 'nm' }, trackName(t), h('small', {}, `  ${soundLabel(t)}`))));
  if (song.markers?.length) {
    rows.push(h('li', { class: 'folder' }, icon('folder', 14), h('span', { class: 'nm' }, 'Markers')));
    for (const m of song.markers) rows.push(h('li', { onclick: () => setCursor(m.t) }, icon('flag', 14), h('span', { class: 'nm' }, m.name, h('small', {}, `  bar ${m.t / BAR + 1}`))));
  }
  body.replaceChildren(h('ul', { class: 'tree one' }, rows));
}

// The menu bar, with FL Studio's menus and shortcuts
function menuBar() {
  const M = {
    File: () => [
      { label: 'New project', icon: 'plus', onSelect: newProject },
      { label: 'Open a project…', icon: 'folder', hint: 'Ctrl+O', onSelect: projectsDialog },
      { label: 'Save a version', icon: 'save', hint: 'Ctrl+S', onSelect: quickVersion },
      { label: 'Save a new named version…', icon: 'save', hint: 'Alt+N', onSelect: versionDialog },
      { label: 'Project info…', icon: 'info', hint: 'F11', onSelect: infoDialog },
      '-',
      { label: 'Import audio files…', icon: 'upload', onSelect: () => pickAudioFile() },
      { label: 'Export WAV and MIDI…', icon: 'export', hint: 'Ctrl+R', onSelect: () => openExport() },
      { label: 'Export MP3…', icon: 'export', hint: 'Ctrl+Shift+R', onSelect: () => openExport({ mp3: true }) },
      { label: 'Export MIDI only…', icon: 'export', hint: 'Ctrl+Shift+M', onSelect: () => openExport({ mix: false, stems: false }) },
      '-',
      { label: 'Save as a project file…', icon: 'export', onSelect: exportProjectFile },
      { label: 'Open a project file…', icon: 'upload', onSelect: importProjectFile },
      { label: 'Home page', icon: 'left', onSelect: () => { location.href = '/'; } },
    ],
    Edit: () => [
      { label: 'Undo', icon: 'undo', hint: 'Ctrl+Z', onSelect: () => stepHistory(-1) },
      { label: 'Redo', icon: 'redo', hint: 'Ctrl+Y', onSelect: () => stepHistory(1) },
      '-',
      { label: 'Select all', icon: 'select', hint: 'Ctrl+A', onSelect: () => editKey('a') },
      { label: 'Duplicate selection', icon: 'copy', hint: 'Ctrl+B', onSelect: () => editKey('b') },
      { label: 'Delete selection', icon: 'trash', hint: 'Del', onSelect: () => editKey('Delete') },
      { label: 'Quantize notes', icon: 'magnet', hint: 'Ctrl+Q', onSelect: () => editKey('q') },
      { label: 'Legato notes', icon: 'right', hint: 'Ctrl+L', onSelect: () => editKey('l') },
    ],
    Add: () => [
      { label: 'Channel…', icon: 'plus', onSelect: () => addTrackMenu($('#menubar')) },
      { label: 'Audio channel', icon: 'mic', onSelect: () => addChannel('audio') },
      { label: 'Marker at the song position', icon: 'flag', onSelect: () => addMarker() },
      { label: 'Automation for the selected channel', icon: 'auto', onSelect: () => { ui.lanes[ui.selected] ??= 'vol'; save(); showView('arrange'); renderPlaylist(); } },
      { label: 'Playlist track', icon: 'playlist', onSelect: () => { song.playlist.rows.push({ name: `Track ${song.playlist.rows.length + 1}`, mute: false }); changed(); } },
    ],
    Patterns: () => [
      { label: 'New pattern', icon: 'plus', hint: 'F4', onSelect: () => newPattern() },
      { label: 'Clone pattern', icon: 'copy', hint: 'Ctrl+Shift+C', onSelect: () => newPattern(true) },
      { label: 'Rename and colour…', icon: 'info', hint: 'F2', onSelect: () => renamePattern() },
      { label: 'Delete pattern', icon: 'trash', danger: true, disabled: song.patterns.length < 2, onSelect: () => deletePattern(ui.pattern) },
      '-',
      ...song.patterns.map((p, i) => ({ label: `${i + 1}  ${p.name}`, swatch: p.color, active: p.id === ui.pattern, onSelect: () => setPattern(p.id) })),
    ],
    View: () => [
      { label: 'Rig layout', icon: 'panel', active: ui.layout !== 'daw', onSelect: () => setLayout('rig') },
      { label: 'DAW layout', icon: 'playlist', active: ui.layout === 'daw', onSelect: () => setLayout('daw') },
      '-',
      ...Object.entries(VIEWS).map(([id, [ic, name, key]]) => ({ label: name, icon: ic, hint: key, onSelect: () => showView(id) })),
      { label: `${ui.devices ? 'Hide' : 'Show'} the devices`, icon: 'panel', onSelect: () => $('#devices-toggle').click() },
      { label: 'Close all windows', icon: 'close', hint: 'F12', onSelect: closeAllWins },
      { label: 'Dark or white studio', icon: 'sun', onSelect: () => $('#theme').click() },
    ],
    Options: () => [
      { label: 'Audio and MIDI settings…', icon: 'midi', hint: 'F10', onSelect: settingsDialog },
      { label: 'Typing keyboard to piano', icon: 'keyboard', hint: 'Alt+T', active: ui.typing, onSelect: toggleTyping },
      { label: 'Metronome', icon: 'metro', hint: 'M', active: ui.metro, onSelect: toggleMetro },
      { label: 'Count in before recording', icon: 'metro', active: ui.countIn !== false, onSelect: () => { ui.countIn = ui.countIn === false; save(); } },
      { label: 'Quantize recorded notes', icon: 'magnet', active: ui.recQuant, onSelect: () => { ui.recQuant = !ui.recQuant; save(); } },
    ],
    Tools: () => [
      { label: 'Find any action', icon: 'search', hint: 'Ctrl+K', onSelect: openPalette },
      { label: 'Make a beat', icon: 'brain', onSelect: () => make() },
      ...['drums', 'chords', 'bass', 'melody'].map(p => ({ label: `New ${p}`, icon: 'dice', onSelect: () => setSong(regenerate(song, p), `New ${p}. Ctrl+Z undoes it.`) })),
      { label: 'AI melody', icon: 'brain', onSelect: aiMelodyButton },
      { label: 'AI drums', icon: 'brain', onSelect: aiDrumsButton },
      { label: 'AI: humanize the drums', icon: 'brain', onSelect: aiHumanizeButton },
      { label: 'AI: vary the drums', icon: 'brain', onSelect: () => aiVaryButton('drums') },
      { label: 'AI: vary the melody', icon: 'brain', onSelect: () => aiVaryButton('melody') },
      { label: 'AI: fill in the last bar', icon: 'brain', onSelect: aiFillButton },
      { label: 'Clean up unused audio', icon: 'trash', onSelect: cleanUpAudio },
    ],
    Help: () => [
      { label: 'Shortcuts and help', icon: 'help', hint: 'F1', onSelect: openHelp },
      { label: 'BeatLab docs', icon: 'help', hint: 'New tab', onSelect: () => window.open('docs.html', '_blank', 'noopener') },
      { label: 'About BeatLab', icon: 'info', onSelect: () => toast('BeatLab runs on this computer: no account, no subscription. It reads and writes files FL Studio opens.') },
    ],
  };
  $('#menus').replaceChildren(...Object.entries(M).map(([name, items]) => h('button', { class: 'mbtn', 'aria-haspopup': 'menu', onclick: e => menu(e.currentTarget, items(), { width: 280 }) }, name)));
}
function closeAllWins() {
  for (const name of Object.keys(ui.wins)) closeWin(name);
  closePlugin();
  hint('Closed every window. F6, F7 and F9 bring them back.');
}

const editable = t => {  // the selected pattern's notes on a channel, made editable
  t[ui.pattern] ??= [];
  return ui.pattern;
};

// ---------- channel rack: steps with velocity, chance and ratchets ----------
function renderRack() {
  const p = pat();
  V.rack.tools.replaceChildren(
    knob({ label: 'Swing', caption: 'Swing', value: song.swing, min: 0, max: 0.5, def: 0, size: 30, fmt: v => `${Math.round(v * 200)}%`, onInput: v => { song.swing = v; save(); if (player?.playing) player.load(song, view(), dusty(), audioBufs); } }),
    picker({ label: 'Pattern length', value: p.bars, options: [1, 2, 4, 8, 12, 16].map(n => ({ value: n, label: `${n} bar${n === 1 ? '' : 's'}` })), onChange: v => { p.bars = v; ui.bar = Math.min(ui.bar, v - 1); changed(); } }),
    h('span', { class: 'crumb' }, `${p.name}, bar`),
    h('div', { class: 'seg pager', role: 'group', 'aria-label': 'Bar to show' }, Array.from({ length: patBars() }, (_, b) => h('button', { 'aria-pressed': b === ui.bar, onclick: () => { ui.bar = b; barChanged(); } }, b + 1))),
    h('button', { class: 'btn small', title: 'Add a drum, instrument or audio channel', onclick: e => addTrackMenu(e.currentTarget) }, icon('plus', 14), 'Channel'),
    h('button', { class: 'btn small', 'aria-pressed': (ui.graph ?? 'off') !== 'off', title: 'The graph editor under the selected drum: draw each step\'s velocity, or how often it plays', onclick: () => { ui.graph = { off: 'vel', vel: 'chance', chance: 'off' }[ui.graph ?? 'off']; save(); renderRack(); } }, icon('auto', 14), { vel: 'Graph: velocity', chance: 'Graph: chance' }[ui.graph] ?? 'Graph'),
    flKit.length ? h('button', { class: 'btn small', title: "Put one of FL Studio's drum kits on every drum channel", onclick: e => kitMenu(e.currentTarget) }, icon('pads', 14), song.kit ? flKit.find(k => k.id === song.kit)?.name ?? 'Kit' : 'Drum kit') : null,
    h('button', { class: 'btn small', title: 'The AI plays these drums with a human feel', onclick: aiHumanizeButton }, icon('brain', 14), 'Humanize'),
    h('button', { class: 'btn small', title: 'The AI writes a variation of these drums. Press again for the next one', onclick: () => aiVaryButton('drums') }, icon('brain', 14), 'Vary'),
    h('button', { class: 'btn small', title: 'The AI plays a fill in the last bar', onclick: aiFillButton }, icon('brain', 14), 'Fill'));
  const notesOf = t => notesFor(t, ui.pattern);
  V.rack.body.replaceChildren(h('div', { class: 'rack' }, song.tracks.filter(t => t.kind !== 'audio' && t.kind !== 'bus').map(t => {
    const row = h('div', { class: `ch${t.id === ui.selected ? ' sel' : ''}`, style: `--c:${t.color}`, 'data-ch': t.id },
      h('button', { class: 'led', 'aria-pressed': !t.mute, title: t.mute ? 'Unmute' : 'Mute', 'aria-label': `Mute ${trackName(t)}`, onclick: () => { t.mute = !t.mute; mixChanged(); renderRack(); } }),
      knob({ label: `${trackName(t)} pan`, caption: '', value: t.pan, min: -1, max: 1, def: 0, size: 26, onInput: v => { t.pan = v; mixChanged(); } }),
      knob({ label: `${trackName(t)} volume`, caption: '', value: t.vol, min: 0, max: 1.2, def: 0.7, size: 26, onInput: v => { t.vol = v; mixChanged(); } }),
      h('button', { class: 'cbtn', title: 'Click for the channel settings, right-click for fills, Euclidean rhythms and more', onclick: () => { select(t.id); openPlugin(t.id); }, oncontextmenu: e => { e.preventDefault(); rowMenu(e, t); } },
        h('i', { class: 'c' }), h('span', {}, h('b', {}, trackName(t)), h('small', {}, soundLabel(t)))),
      t.kind === 'drum' ? steps(t, notesOf(t)) : mini(t, notesOf(t)));
    dropOn(row, t);
    return (ui.graph ?? 'off') !== 'off' && t.id === ui.selected && t.kind === 'drum' ? [row, graphRow(t)] : row;
  }).flat()));
  revealChannel();
  showSuggestion();
}
function graphRow(t) {
  const cv = h('canvas', { class: 'graph-cv', 'aria-label': `${trackName(t)} ${ui.graph === 'vel' ? 'velocity' : 'chance'} per step` });
  const row = h('div', { class: 'ch graph', 'data-graph': t.id }, h('span', { class: 'glabel' }, ui.graph === 'vel' ? 'Velocity' : 'Chance'), cv);
  let last = null;  // the previous point, so a quick sweep sets every step in between
  const setAt = ev => {
    const r = cv.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width * 16, v = clamp(1 - (ev.clientY - r.top) / r.height, 0, 1);
    const from = last ?? { x, v }, i0 = clamp(Math.floor(Math.min(from.x, x)), 0, 15), i1 = clamp(Math.floor(Math.max(from.x, x)), 0, 15);
    let said = '';
    for (let i = i0; i <= i1; i++) {
      const k = i1 === i0 ? 1 : (i + 0.5 - Math.min(from.x, x)) / Math.abs(x - from.x || 1), vi = clamp(from.x <= x ? from.v + (v - from.v) * k : v + (from.v - v) * k, 0, 1);
      const { here } = stepOf(t, ui.bar * 16 + i);
      for (const n of here) { if (ui.graph === 'vel') n.v = Math.max(1, Math.round(vi * 127)); else if (vi > 0.97) delete n.c; else n.c = Math.round(vi * 20) / 20; }
      said = here.length ? `Step ${i + 1}: ${ui.graph === 'vel' ? `velocity ${Math.round(vi * 127)}` : `plays ${Math.round(vi * 100)}% of the time`}` : `Step ${i + 1} is empty`;
    }
    last = { x, v };
    drawGraph(cv, t);
    hint(said);
  };
  cv.addEventListener('pointerdown', e => {
    cv.setPointerCapture(e.pointerId);
    last = null;
    setAt(e);
    const move = ev => setAt(ev), up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); stepsChanged(); };
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
  });
  requestAnimationFrame(() => drawGraph(cv, t));
  return row;
}
function drawGraph(cv, t) {
  const w = cv.clientWidth, ht = cv.clientHeight, dpr = devicePixelRatio || 1, g = cv.getContext('2d'), notes = notesFor(t, ui.pattern), sw = w / 16;
  if (!w) return;
  cv.width = Math.round(w * dpr); cv.height = Math.round(ht * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (let i = 0; i < 16; i++) {
    const s = ui.bar * 16 + i, here = notes.filter(n => n.t >= s * STEP && n.t < (s + 1) * STEP);
    g.fillStyle = pal().grid;
    g.fillRect(i * sw + 3, 0, sw - 6, ht);
    if (!here.length) continue;
    const v = ui.graph === 'vel' ? Math.max(...here.map(n => n.v)) / 127 : here[0].c ?? 1;
    g.fillStyle = t.color;
    g.fillRect(i * sw + 3, ht - v * ht, sw - 6, v * ht);
  }
}
let reveal = null;  // a channel to bring into view once the rack has drawn, whatever redraws it first
function revealChannel() {
  if (reveal) requestAnimationFrame(() => { V.rack.body.querySelector(`.ch[data-ch="${reveal}"]`)?.scrollIntoView({ block: 'nearest' }); reveal = null; });
}
const stepOf = (t, s) => { const f = editable(t), inStep = n => n.t >= s * STEP && n.t < (s + 1) * STEP; return { f, inStep, here: t[f].filter(inStep) }; };
function setStep(t, s, { hits = 1, v, c } = {}) {
  const { f, inStep, here } = stepOf(t, s), v0 = v ?? here.at(-1)?.v ?? (s % 4 ? 92 : 108), c0 = c === undefined ? here[0]?.c : c;
  t[f] = t[f].filter(n => !inStep(n));
  for (let i = 0; i < hits; i++) {
    const n = { t: s * STEP + Math.floor(i * STEP / hits), d: Math.max(2, Math.floor(STEP / hits / 2)), p: 60, v: hits > 1 ? clamp(v0 - 16 * (hits - 1 - i), 20, 127) : v0 };
    if (c0 != null && c0 < 1) n.c = c0;
    t[f].push(n);
  }
}
function steps(t, notes) {
  return h('div', { class: 'steps' }, Array.from({ length: 16 }, (_, i) => {
    const s = ui.bar * 16 + i, here = notes.filter(n => n.t >= s * STEP && n.t < (s + 1) * STEP), top = here.length ? Math.max(...here.map(n => n.v)) : 0, c = here[0]?.c;
    return h('button', {
      class: `step${here.length ? ' on' : ''}${here.length > 1 ? ' roll' : ''}${c != null && c < 1 ? ' chance' : ''}${Math.floor(i / 4) % 2 ? ' alt' : ''}`,
      'data-step': i, 'aria-pressed': !!here.length, 'aria-label': `${trackName(t)} step ${i + 1}`,
      title: here.length ? `Velocity ${top}${c != null && c < 1 ? `, plays ${Math.round(c * 100)}% of the time` : ''}${here.length > 1 ? `, ${here.length} hits` : ''}. Scroll for velocity, Shift-click for a roll, right-click for more` : 'Click to add a hit, Shift-click for a roll, right-click for more',
      style: here.length ? `--v:${top / 127}` : null,
      onpointerdown: e => {
        if (e.button !== 0 || t.kind === 'audio') return;
        e.preventDefault();
        if (e.shiftKey) return togglePad(t, s, true);
        painting = { t, on: !here.length };
        paintStep(t, s);
      },
      onpointerenter: e => { if (painting?.t === t && e.buttons & 1) paintStep(t, s); },
      onclick: e => { if (e.detail === 0) togglePad(t, s, e.shiftKey); },  // Enter or Space on a focused step
      oncontextmenu: e => { e.preventDefault(); stepMenu(e, t, s); },
      onwheel: e => { if (!here.length) return; e.preventDefault(); setStep(t, s, { hits: here.length, v: clamp(top - Math.sign(e.deltaY) * 8, 10, 127) }); stepsChanged(); },
    });
  }));
}
let painting = null;
addEventListener('pointerup', () => { painting = null; });
function paintStep(t, s) {
  const { f, inStep, here } = stepOf(t, s);
  if (painting.on === !!here.length) return;
  if (painting.on) setStep(t, s); else t[f] = t[f].filter(n => !inStep(n));
  if (painting.on && !player?.playing) audition(t, 60);
  stepsChanged();
}
function togglePad(t, s, shift) {
  if (t.kind === 'audio') return;
  const { f, inStep, here } = stepOf(t, s);
  if (shift) setStep(t, s, { hits: here.length >= 4 ? 1 : Math.max(2, here.length + 1) });  // rolls go 2, 3, 4 hits, then back to one
  else if (here.length) t[f] = t[f].filter(n => !inStep(n));
  else setStep(t, s);
  if (!player?.playing && t[f].some(inStep)) audition(t, 60);
  stepsChanged();
}
function stepMenu(e, t, s) {
  const { here } = stepOf(t, s), set = opts => () => { setStep(t, s, { hits: here.length || 1, ...opts }); changed(); };
  menu(at(e), [
    { heading: `Step ${s % 16 + 1}` },
    { heading: 'Velocity' }, ...[[50, 'Ghost'], [80, 'Soft'], [100, 'Medium'], [118, 'Hard'], [127, 'Accent']].map(([v, l]) => ({ label: `${l}, ${v}`, active: here[0]?.v === v, onSelect: set({ v }) })),
    '-', { heading: 'Chance' }, ...[1, 0.75, 0.5, 0.25].map(c => ({ label: `${Math.round(c * 100)}% of the time`, active: (here[0]?.c ?? 1) === c, onSelect: set({ c }) })),
    '-', { heading: 'Ratchet' }, ...[1, 2, 3, 4].map(k => ({ label: k === 1 ? 'Single hit' : `${k} hits`, active: here.length === k, onSelect: () => { setStep(t, s, { hits: k }); changed(); } })),
    '-', { label: 'Clear step', icon: 'trash', disabled: !here.length, onSelect: () => togglePad(t, s, false) },
  ], { width: 200 });
}
let stepClip = null;
function rowMenu(e, t) {
  const f = editable(t), b0 = ui.bar * BAR, inBar = n => n.t >= b0 && n.t < b0 + BAR, isDrum = t.kind === 'drum';
  const fillBar = on => { t[f] = t[f].filter(n => !inBar(n)); on.forEach((x, i) => { if (x) t[f].push({ t: b0 + i * STEP, d: STEP / 2, p: 60, v: i % 4 ? 92 : 108 }); }); changed(); };
  menu(at(e), [
    { heading: `${trackName(t)}, bar ${ui.bar + 1}` },
    ...(isDrum ? [
      ...[1, 2, 4, 8].map(k => ({ label: k === 1 ? 'Fill every step' : `Fill every ${k} steps`, icon: 'rack', onSelect: () => fillBar(Array.from({ length: 16 }, (_, i) => i % k === 0)) })),
      '-', { heading: 'Euclidean rhythm' },
      ...[3, 5, 7, 9, 11].map(k => ({ label: `${k} hits spread over 16`, icon: 'dice', onSelect: () => fillBar(euclid(k, 16)) })),
      { label: 'Random, about a third', icon: 'dice', onSelect: () => fillBar(Array.from({ length: 16 }, () => Math.random() < 0.33)) },
      '-',
      { label: 'Shift right one step', icon: 'right', onSelect: () => { t[f] = t[f].map(n => (inBar(n) ? { ...n, t: b0 + (n.t - b0 + STEP) % BAR } : n)); changed(); } },
      { label: 'Shift left one step', icon: 'left', onSelect: () => { t[f] = t[f].map(n => (inBar(n) ? { ...n, t: b0 + (n.t - b0 - STEP + BAR) % BAR } : n)); changed(); } },
    ] : [
      { label: 'Edit in the piano roll', icon: 'piano', onSelect: () => { ui.selected = t.id; showView('roll'); } },
    ]),
    { label: 'Copy this bar', icon: 'copy', onSelect: () => { stepClip = t[f].filter(inBar).map(n => ({ ...n, t: n.t - b0 })); hint('Copied the bar. Right-click another bar or channel to paste it.'); } },
    { label: 'Paste into this bar', icon: 'copy', disabled: !stepClip, onSelect: () => { t[f] = [...t[f].filter(n => !inBar(n)), ...stepClip.map(n => ({ ...n, t: n.t + b0 }))]; changed(); } },
    { label: 'Copy this bar to every bar', icon: 'copy', onSelect: () => { const bar = t[f].filter(inBar).map(n => ({ ...n, t: n.t - b0 })); t[f] = Array.from({ length: patBars() }, (_, b) => bar.map(n => ({ ...n, t: n.t + b * BAR }))).flat(); changed(); } },
    { label: 'Clear this bar', icon: 'trash', onSelect: () => { t[f] = t[f].filter(n => !inBar(n)); changed(); } },
    { label: 'Clear the whole pattern', icon: 'trash', onSelect: () => { t[f] = []; changed(); } },
    '-',
    { label: 'Rename…', icon: 'info', onSelect: () => renameTrack(t) },
    { label: 'Channel settings', icon: 'knob', onSelect: () => { select(t.id); openPlugin(t.id); } },
    ...(song.tracks.length > 1 ? [{ label: 'Delete channel', icon: 'trash', danger: true, onSelect: () => deleteTrack(t) }] : []),
  ], { width: 250 });
}
function renameTrack(t) {
  const input = h('input', { type: 'text', value: trackName(t), 'aria-label': 'Channel name', style: 'width:100%' });
  const done = () => { const v = input.value.trim(); if (v) { t.name = v; changed(); } $('#dlg').close(); };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') done(); });
  openDialog({ title: 'Rename channel', glyph: 'info', wide: false, body: [h('label', { class: 'field' }, 'Name', input), h('div', { class: 'ex-actions' }, h('button', { class: 'btn', onclick: () => $('#dlg').close() }, 'Cancel'), h('button', { class: 'key primary btn', onclick: done }, 'Rename'))] });
  input.select();
}
function deleteTrack(t) {
  song.tracks = song.tracks.filter(x => x !== t);
  for (const x of song.tracks) if (x.out === t.id) delete x.out;  // a deleted bus hands its channels back to the master
  delete ui.lanes[t.id];
  if (ui.plugin === t.id) closePlugin();
  if (ui.selected === t.id) ui.selected = song.tracks[0].id;
  changed();
  toast(`Deleted ${trackName(t)}. Ctrl+Z brings it back.`);
}
function mini(t, notes) {
  const auto = t.kind === 'texture' || t.kind === 'fx';
  const cv = h('canvas', { class: 'mini', title: auto ? 'Plays automatically' : 'Open in the piano roll', onclick: () => { if (auto) return; ui.selected = t.id; showView('roll'); } });
  requestAnimationFrame(() => {
    const w = cv.clientWidth, ht = cv.clientHeight, g = cv.getContext('2d'), total = patBars() * BAR;
    if (!w) return;
    cv.width = w * 2;
    cv.height = ht * 2;
    g.scale(2, 2);
    g.fillStyle = pal().hilite;
    g.fillRect(ui.bar * BAR / total * w, 0, BAR / total * w, ht);
    g.fillStyle = pal().strong;
    for (let b = 1; b < patBars(); b++) g.fillRect(b * BAR / total * w, 0, 1, ht);
    const ps = notes.map(n => n.p), lo = Math.min(...ps, 60) - 1, hi = Math.max(...ps, 61) + 1;
    g.fillStyle = t.color;
    for (const n of notes) g.fillRect(n.t / total * w, 4 + (hi - n.p) / (hi - lo) * (ht - 10), Math.max(1.5, n.d / total * w - 0.5), 2);
    if (auto) { g.fillStyle = pal().subtle; g.font = '400 11px Geist, sans-serif'; g.fillText(t.kind === 'fx' ? 'Placed automatically around the hooks' : 'Runs under the whole beat', 8, ht / 2 + 4); }
  });
  return cv;
}

// ---------- piano roll: select, move, stretch, chords, scale snap, velocity ----------
let rollSel = new Set(), rollClip = [], rollRedraw = null;
const rollGrid = () => ui.grid * STEP;
function renderRoll() {
  const melodic = song.tracks.filter(t => PIANO_RANGE[t.kind]);
  if (!melodic.length) return V.roll.body.replaceChildren(h('p', { class: 'note', style: 'padding:20px' }, 'Add a bass, keys or lead channel to use the piano roll.'));
  if (!PIANO_RANGE[track(ui.selected)?.kind]) ui.selected = melodic.find(t => t.id === 'melody')?.id ?? melodic[0].id;
  const t = track(ui.selected), [lo, hi] = PIANO_RANGE[t.kind], rh = 14, rows = hi - lo + 1, cols = patBars() * 16, scale = songScale(song);
  const field = () => editable(t);
  const targets = () => (rollSel.size ? [...rollSel] : t[field()]);
  const reselect = (before, after) => { const m = new Map(before.map((n, i) => [n, after[i]])); rollSel = new Set([...rollSel].map(n => m.get(n)).filter(Boolean)); };
  const transform = fn => {  // quantize or humanize the selection, or everything
    const f = editable(t), list = targets(), out = fn(list), map = new Map(list.map((n, i) => [n, out[i]]));
    t[f] = tidy(t[f].map(n => map.get(n) ?? n));
    reselect(list, out);
    changed();
  };
  V.roll.tools.replaceChildren(...[
    toolBar(ui.rollTool, 'roll'),
    picker({ label: 'Channel', value: t.id, options: melodic.map(m => ({ value: m.id, label: trackName(m), swatch: m.color })), onChange: v => { ui.selected = v; rollSel.clear(); renderRoll(); renderPads(); } }),
    picker({ label: 'Length of new notes', value: ui.noteLen, options: [[1, '1/16'], [2, '1/8'], [4, '1/4'], [8, '1/2'], [16, '1 bar']].map(([value, label]) => ({ value, label: `${label} notes` })), onChange: v => { ui.noteLen = v; save(); renderRoll(); } }),
    picker({ label: 'Snap', value: ui.grid, options: [[0.5, '1/32'], [1, '1/16'], [2, '1/8'], [4, '1/4']].map(([value, label]) => ({ value, label: `Snap ${label}` })), onChange: v => { ui.grid = v; save(); renderRoll(); } }),
    picker({ label: 'Chord stamp: clicking places this chord', value: ui.chord, options: Object.entries(CHORDS).map(([value, c]) => ({ value, label: c.name })), onChange: v => { ui.chord = v; save(); renderRoll(); } }),
    h('button', { class: 'btn small', 'aria-pressed': ui.scaleSnap, title: `Keep new and moved notes in ${NOTES[song.root]} ${song.mode}`, onclick: () => { ui.scaleSnap = !ui.scaleSnap; save(); renderRoll(); } }, icon('magnet', 14), 'Scale'),
    h('button', { class: 'btn small', title: 'Snap the selected notes (or all) to the grid (Q)', onclick: () => transform(list => quantize(list, rollGrid())) }, 'Quantize'),
    h('button', { class: 'btn small', title: 'Loosen timing and velocity a little, like a player', onclick: () => transform(list => humanize(list, Math.random)) }, 'Humanize'),
    t.id === 'melody' ? h('button', { class: 'btn small', onclick: () => aiMelodyButton() }, icon('brain', 14), `AI melody`) : null,
    t.kind !== 'drum' ? h('button', { class: 'btn small', title: 'Hum or sing this part into the microphone; BeatLab writes the notes in the key', onclick: startHum }, icon('mic', 14), 'Hum it') : null,
    t.kind !== 'drum' ? h('button', { class: 'btn small', title: 'The AI writes a variation of this part. Press again for the next one', onclick: () => aiVaryButton('melody') }, icon('brain', 14), 'Vary') : null,
    ['melody', 'bass'].includes(t.kind) ? suggestBtn() : null,
    h('button', { class: 'btn small ghost', title: 'Remove every note in this pattern', onclick: () => { t[editable(t)] = []; rollSel.clear(); changed(); } }, icon('trash', 14), 'Clear')].filter(Boolean));
  const keys = h('div', { class: 'keys' });
  for (let p = hi; p >= lo; p--) keys.append(h('div', { class: NOTES[p % 12].includes('#') ? 'key-w black' : 'key-w', 'data-p': p }, p % 12 === 0 ? noteName(p) : ''));
  playable(keys, () => t);
  const cv = h('canvas', { style: `height:${rows * rh}px`, 'aria-label': `${trackName(t)} piano roll`, title: 'Click to add, drag to move or stretch, Ctrl-drag to select, right-click to delete' });
  const vel = h('canvas', { 'aria-label': 'Velocity', title: 'Drag up and down to set velocity (of the selected notes, if any)' });
  const top = h('div', { class: 'roll-top' });
  const scroll = h('div', { class: 'roll-scroll' }, h('div', { class: 'roll-inner', style: `height:${rows * rh}px` }, keys, cv), h('div', { class: 'playhead', id: 'roll-head', style: 'left:60px' }));
  const velRow = h('div', { class: 'vel' }, h('span', {}, 'Velocity'), vel);
  V.roll.body.replaceChildren(h('div', { class: 'proll' }, top, scroll, velRow));
  const ghost = t.id !== 'chords' ? track('chords') : null;
  let box = null;
  const draw = () => {
    const w = cv.clientWidth, ht = rows * rh, dpr = devicePixelRatio || 1, P = pal();
    if (!w) return;
    cv.width = w * dpr;
    cv.height = ht * dpr;
    const g = cv.getContext('2d'), cw = w / cols;
    g.scale(dpr, dpr);
    for (let p = hi; p >= lo; p--) {
      g.fillStyle = NOTES[p % 12].includes('#') ? P.rowBlack : scale.includes(p % 12) ? P.rowIn : P.rowOut;
      g.fillRect(0, (hi - p) * rh, w, rh - 1);
      if (p % 12 === 0) { g.fillStyle = P.strong; g.fillRect(0, (hi - p + 1) * rh - 1, w, 1); }
    }
    for (let c = 0; c <= cols; c++) {
      g.fillStyle = c % 16 === 0 ? P.strong : c % 4 === 0 ? P.grid : P.hilite;
      g.fillRect(Math.round(c * cw), 0, 1, ht);
    }
    if (ghost) {  // the chords, faintly, so lines are easy to fit
      g.fillStyle = P.muted;
      g.globalAlpha = 0.18;
      for (const n of notesFor(ghost, ui.pattern)) if (n.p >= lo && n.p <= hi) g.fillRect(n.t / STEP * cw, (hi - n.p) * rh + 2, n.d / STEP * cw, rh - 5);
      g.globalAlpha = 1;
    }
    g.font = '600 9.5px Geist, sans-serif';
    for (const n of t[field()]) {
      if (n.p < lo || n.p > hi) continue;
      const x = n.t / STEP * cw + 1, y = (hi - n.p) * rh + 1, nw = Math.max(4, n.d / STEP * cw - 2), on = rollSel.has(n);
      g.globalAlpha = n.m ? 0.22 : 0.5 + 0.5 * n.v / 127;  // muted notes stay faint
      g.fillStyle = on ? P.accent : t.color;
      g.beginPath();
      g.roundRect(x, y, nw, rh - 3, 3);
      g.fill();
      g.globalAlpha = 1;
      if (nw > 26) { g.fillStyle = '#111'; g.fillText(noteName(n.p), x + 4, y + 9); }
    }
    const sg = suggestion?.where === 'roll' && suggestion.track === t.id && suggestion.pattern === ui.pattern ? suggestion.notes : [];
    for (const n of sg) {  // the suggestion: an outline and a faint fill, until Tab keeps it
      if (n.p < lo || n.p > hi) continue;
      const x = n.t / STEP * cw + 1, y = (hi - n.p) * rh + 1, nw = Math.max(4, n.d / STEP * cw - 2);
      g.globalAlpha = 0.22; g.fillStyle = P.accent; g.beginPath(); g.roundRect(x, y, nw, rh - 3, 3); g.fill();
      g.globalAlpha = 0.9; g.strokeStyle = P.accent; g.setLineDash([3, 2]); g.lineWidth = 1; g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
    }
    if (box) { g.strokeStyle = P.accent; g.fillStyle = `${P.accent}18`; const bx = Math.min(box.x0, box.x1), by = Math.min(box.y0, box.y1); g.fillRect(bx, by, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0)); g.strokeRect(bx, by, Math.abs(box.x1 - box.x0), Math.abs(box.y1 - box.y0)); }
    top.replaceChildren(...song.harmony.filter(c => c.t < cols * STEP).map(c => h('span', { style: `left:${c.t / STEP * cw}px` }, c.name)));
    drawVel();
  };
  V.roll.redraw = draw;
  const drawVel = () => {
    const w = vel.clientWidth, ht = vel.clientHeight, dpr = devicePixelRatio || 1, P = pal();
    if (!w) return;
    vel.width = w * dpr;
    vel.height = ht * dpr;
    const g = vel.getContext('2d'), cw = w / cols;
    g.scale(dpr, dpr);
    g.fillStyle = P.grid;
    for (let c = 0; c <= cols; c += 4) g.fillRect(Math.round(c * cw), 0, 1, ht);
    for (const n of t[field()]) {
      const x = n.t / STEP * cw + 1, hh = n.v / 127 * (ht - 8);
      g.fillStyle = rollSel.has(n) ? P.accent : t.color;
      g.fillRect(x, ht - hh, 2, hh);
      g.beginPath(); g.arc(x + 1, ht - hh, 2.5, 0, Math.PI * 2); g.fill();
    }
  };
  rollRedraw = draw;
  const pos = e => {
    const r = cv.getBoundingClientRect();
    return { tick: clamp((e.clientX - r.left) / r.width, 0, 0.9999) * cols * STEP, p: clamp(hi - Math.floor((e.clientY - r.top) / rh), lo, hi), cw: r.width / cols, x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const fit = p => (ui.scaleSnap ? clamp(snapToScale(p, scale), lo, hi) : p);
  cv.addEventListener('contextmenu', e => {
    e.preventDefault();
    const { tick, p } = pos(e), f = editable(t), hitN = t[f].find(n => n.p === p && tick >= n.t && tick < n.t + n.d);
    if (!hitN) return;
    const gone = rollSel.has(hitN) ? rollSel : new Set([hitN]);
    t[f] = t[f].filter(n => !gone.has(n));
    rollSel = new Set([...rollSel].filter(n => !gone.has(n)));
    draw();
    changed({ redraw: false });
  });
  cv.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const q0 = pos(e), f = editable(t), grid = rollGrid();
    let hitN = t[f].find(n => n.p === q0.p && q0.tick >= n.t && q0.tick < n.t + n.d), mode = 'move';
    const tool = ui.rollTool ?? 'draw';
    ui.focus = 'roll';
    cv.setPointerCapture(e.pointerId);
    const after = (fn, done) => { const up = () => { cv.removeEventListener('pointermove', fn); cv.removeEventListener('pointerup', up); done?.(); t[f] = tidy(t[f]); draw(); changed({ redraw: false }); }; cv.addEventListener('pointermove', fn); cv.addEventListener('pointerup', up); };
    if (tool === 'erase') {  // click or drag over notes to delete them
      const kill = q => { const n = t[f].find(m => m.p === q.p && q.tick >= m.t && q.tick < m.t + m.d); if (n) { t[f] = t[f].filter(x => x !== n); rollSel.delete(n); draw(); } };
      kill(q0);
      return after(ev => kill(pos(ev)));
    }
    if (tool === 'mute') { if (hitN) { if (hitN.m) delete hitN.m; else hitN.m = 1; draw(); changed({ redraw: false }); } return; }
    if (tool === 'slice') {
      const cut = Math.round(q0.tick / grid) * grid;
      if (hitN && cut > hitN.t && cut < hitN.t + hitN.d) { t[f].push({ ...hitN, t: cut, d: hitN.t + hitN.d - cut }); hitN.d = cut - hitN.t; draw(); changed({ redraw: false }); }
      return;
    }
    if (tool === 'paint' && !hitN) {  // drag along a key to lay notes down one after another
      const p0 = fit(q0.p), len = ui.noteLen * STEP;
      let next = Math.floor(q0.tick / grid) * grid;
      const add = upTo => { while (next <= upTo && next < cols * STEP) { t[f].push({ t: next, d: len, p: p0, v: 96 }); next += len; } };
      add(q0.tick);
      audition(t, p0);
      draw();
      return after(ev => { add(pos(ev).tick); draw(); });
    }
    if (!hitN && (e.ctrlKey || e.metaKey || e.shiftKey || tool === 'select')) {  // box select
      box = { x0: q0.x, y0: q0.y, x1: q0.x, y1: q0.y, t0: q0.tick, p0: q0.p };
      const move = ev => { const q = pos(ev); Object.assign(box, { x1: q.x, y1: q.y }); rollSel = new Set(inBox(t[f], box.t0, q.tick, box.p0, q.p)); draw(); };
      const up = () => { box = null; cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); draw(); hint(`${rollSel.size} notes selected. Arrows move them, Delete removes them, Ctrl+C and Ctrl+V copy them.`); };
      cv.addEventListener('pointermove', move);
      cv.addEventListener('pointerup', up);
      return;
    }
    if (!hitN) {  // place a note, or a whole chord with the stamp
      const base = Math.floor(q0.tick / grid) * grid, root = fit(q0.p);
      const made = CHORDS[ui.chord].iv.map(iv => fit(root + iv)).filter((p, i, a) => p <= hi && a.indexOf(p) === i).map(p => ({ t: base, d: ui.noteLen * STEP, p, v: 96 }));
      t[f].push(...made);
      rollSel = new Set(made);
      made.forEach(n => audition(t, n.p));
      hitN = made[0];
      mode = 'resize';
    } else {
      if (!rollSel.has(hitN)) rollSel = e.shiftKey ? new Set([...rollSel, hitN]) : new Set([hitN]);
      if ((hitN.t + hitN.d - q0.tick) * q0.cw / STEP < 7) mode = 'resize';
    }
    const starts = new Map([...rollSel].map(n => [n, { t: n.t, p: n.p, d: n.d }]));
    let lastP = hitN.p;
    const move = ev => {
      const q = pos(ev), dt = Math.round((q.tick - q0.tick) / grid) * grid, dp = q.p - q0.p;
      for (const [n, s] of starts) {
        if (mode === 'move') { n.t = clamp(s.t + dt, 0, cols * STEP - n.d); n.p = clamp(fit(s.p + dp), lo, hi); }
        else n.d = clamp(s.d + dt, grid, cols * STEP - n.t);
      }
      if (mode === 'move' && hitN.p !== lastP) { lastP = hitN.p; audition(t, hitN.p); }
      draw();
    };
    const up = () => {
      cv.removeEventListener('pointermove', move);
      cv.removeEventListener('pointerup', up);
      t[f] = tidy(t[f]);
      rollSel = new Set([...rollSel].filter(n => t[f].includes(n)));
      draw();
      changed({ redraw: false });
    };
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    draw();
  });
  vel.addEventListener('pointerdown', e => {
    const f = editable(t);
    vel.setPointerCapture(e.pointerId);
    const paint = ev => {
      const r = vel.getBoundingClientRect(), tick = (ev.clientX - r.left) / r.width * cols * STEP, v = clamp(Math.round((1 - (ev.clientY - r.top) / r.height) * 127), 1, 127), reach = STEP * 0.6;
      for (const n of t[f]) if (Math.abs(n.t - tick) < reach && (!rollSel.size || rollSel.has(n))) n.v = v;
      hint(`Velocity ${v}`);
      draw();
    };
    paint(e);
    const up = () => { vel.removeEventListener('pointermove', paint); vel.removeEventListener('pointerup', up); changed({ redraw: false }); };
    vel.addEventListener('pointermove', paint);
    vel.addEventListener('pointerup', up);
  });
  requestAnimationFrame(() => {
    velRow.style.paddingRight = `${scroll.offsetWidth - scroll.clientWidth}px`;  // line the velocity lane up with the roll above
    draw();
    const ps = t[field()].map(n => n.p).filter(p => p >= lo && p <= hi), mid = ps.length ? (Math.max(...ps) + Math.min(...ps)) / 2 : (lo + hi) / 2;
    scroll.scrollTop = (hi - mid) * rh - scroll.clientHeight / 2;
  });
  rollKeys.track = t;
  rollKeys.transform = transform;
}
// Piano roll keys: Delete, Ctrl+A/C/V/D, arrows to move, Q to quantize
function rollKeys(e) {
  const t = rollKeys.track;
  if (!t || !track(t.id)) return false;
  const f = editable(t), mod = e.ctrlKey || e.metaKey, list = [...rollSel], [lo, hi] = PIANO_RANGE[t.kind], end = patBars() * BAR;
  const done = () => { e.preventDefault(); t[f] = tidy(t[f]); rollSel = new Set([...rollSel].filter(n => t[f].includes(n))); rollRedraw?.(); changed({ redraw: false }); return true; };
  if (mod && e.key.toLowerCase() === 'a') { rollSel = new Set(t[f]); e.preventDefault(); rollRedraw?.(); return true; }
  if (mod && e.key.toLowerCase() === 'c' && list.length) { const t0 = Math.min(...list.map(n => n.t)); rollClip = list.map(n => ({ ...n, t: n.t - t0 })); hint(`Copied ${list.length} notes.`); e.preventDefault(); return true; }
  if (mod && e.key.toLowerCase() === 'x' && list.length) { const t0 = Math.min(...list.map(n => n.t)); rollClip = list.map(n => ({ ...n, t: n.t - t0 })); t[f] = t[f].filter(n => !rollSel.has(n)); rollSel.clear(); return done(); }
  if (mod && e.key.toLowerCase() === 'q') { rollKeys.transform?.(l => quantize(l, rollGrid())); e.preventDefault(); return true; }
  if (mod && e.key.toLowerCase() === 'l') {  // legato: every note runs to the next one
    const ns = [...(list.length ? list : t[f])].sort((a, b) => a.t - b.t);
    ns.forEach((n, i) => { const next = ns.slice(i + 1).find(m => m.t > n.t); n.d = Math.max(STEP / 2, (next ? next.t : end) - n.t); });
    return done();
  }
  const dup = ['d', 'b'].includes(e.key.toLowerCase());
  if (mod && (e.key.toLowerCase() === 'v' || dup)) {
    const src = dup ? list.map(n => ({ ...n })) : rollClip.map(n => ({ ...n }));
    if (!src.length) return false;
    const spanStart = dup ? Math.min(...list.map(n => n.t)) : 0;
    const after = list.length ? Math.max(...list.map(n => n.t + n.d)) : 0, shift = dup ? after - spanStart : Math.ceil(after / BAR) * BAR;
    const made = src.map(n => ({ ...n, t: n.t + shift })).filter(n => n.t < end);
    t[f].push(...made);
    rollSel = new Set(made);
    return done();
  }
  if (!list.length) return false;
  if (e.key === 'Delete' || e.key === 'Backspace') { t[f] = t[f].filter(n => !rollSel.has(n)); rollSel.clear(); return done(); }
  const k = { ArrowUp: [0, 1], ArrowDown: [0, -1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[e.key];
  if (k && (!mod || k[1])) {
    for (const n of list) { n.p = clamp(n.p + k[1] * (e.shiftKey || mod ? 12 : 1), lo, hi); n.t = clamp(n.t + k[0] * rollGrid(), 0, end - n.d); }
    if (k[1]) audition(t, list[0].p);
    return done();
  }
  if (e.key.toLowerCase() === 'q' && !mod && !ui.typing) { rollKeys.transform?.(l => quantize(l, rollGrid())); e.preventDefault(); return true; }
  if (e.key === 'Escape') { rollSel.clear(); rollRedraw?.(); return true; }
  return false;
}

// ---------- mixer ----------
const FX_GROUPS = [...new Set(Object.values(EFFECTS).map(f => f.group))];
function effectMenu(anchor, t) {
  menu(anchor, [{ heading: 'Add an effect' }, ...FX_GROUPS.flatMap((g, i) => [...(i ? ['-'] : []), { heading: g }, ...Object.entries(EFFECTS).filter(([, fx]) => fx.group === g).map(([k, fx]) => ({
    label: fx.name, icon: 'plus', onSelect: () => { t.fx.push({ type: k }); mixChanged(); renderView(); openPlugin(t.id); },
  }))])], { width: 220 });
}
function fxMenu(e, t, k) {
  const fx = t.fx[k], set = fn => () => { fn(); mixChanged(); renderView(); if (ui.plugin === t.id) renderPlugin(); };
  menu(at(e), [
    { heading: EFFECTS[fx.type].name },
    { label: fx.off ? 'Turn on' : 'Bypass', icon: 'bypass', onSelect: set(() => { fx.off = !fx.off; }) },
    { label: 'Move up', icon: 'up', disabled: k === 0, onSelect: set(() => { t.fx.splice(k - 1, 0, ...t.fx.splice(k, 1)); }) },
    { label: 'Move down', icon: 'down', disabled: k === t.fx.length - 1, onSelect: set(() => { t.fx.splice(k + 1, 0, ...t.fx.splice(k, 1)); }) },
    { label: 'Open the settings', icon: 'knob', onSelect: () => openPlugin(t.id) },
    { label: 'Remove', icon: 'trash', danger: true, onSelect: set(() => { t.fx.splice(k, 1); }) },
  ], { width: 190 });
}
function addBus() {
  const n = song.tracks.filter(t => t.kind === 'bus').length + 1, t = { id: `bus${Date.now().toString(36)}`, kind: 'bus', name: `Bus ${n}`, color: '#8E97A6', vol: 0.8, pan: 0, rev: 0, dly: 0, fx: [], mute: false, solo: false, user: true };
  song.tracks.push(t);
  changed();
  toast(`Added ${t.name}. Send channels to it with their "To" switch, then put effects on the bus to treat them together.`);
  return t;
}
const busesOf = () => song.tracks.filter(t => t.kind === 'bus');
function renderMixer() {
  V.mixer.tools.replaceChildren(
    h('button', { class: 'btn small', title: 'Measure every part and set the levels where a balanced beat has them', onclick: () => withBusy(() => autoMix()) }, icon('mixer', 14), 'Auto mix'),
    h('button', { class: 'btn small', title: 'Listen to the mix, explain what to fix and fix it', onclick: () => withBusy(() => mixDoctor()) }, icon('brain', 14), 'Mix doctor'),
    h('button', { class: 'btn small', title: 'Add a bus: several channels into one insert, with its own effects and fader', onclick: () => addBus() }, icon('plus', 14), 'Bus'),
    h('span', { class: 'crumb' }, 'Right-click an effect to bypass, reorder or remove it. Duck ties a channel to the kick.'));
  const scale = () => h('div', { class: 'scale' }, h('span', {}, '0'), h('span', {}, '-12'), h('span', {}, '-24'), h('span', {}, '-48'));
  const strip = (t, i) => h('div', { class: `strip${t.id === ui.selected ? ' sel' : ''}`, style: `--c:${t.color}` }, h('i', { class: 'colorbar' }),
    h('button', { class: 'sname', title: t.kind === 'bus' ? 'Bus settings' : 'Channel settings', onclick: () => { select(t.id); openPlugin(t.id); } }, h('small', {}, t.kind === 'bus' ? 'Bus' : `Insert ${i + 1}`), h('b', {}, trackName(t))),
    h('div', { class: 'route' }, t.kind === 'bus' ? h('span', { class: 'dim' }, `${song.tracks.filter(x => x.out === t.id).length} in`) : busesOf().length
      ? picker({ label: `${trackName(t)} goes to`, value: t.out && track(t.out) ? t.out : '', options: [{ value: '', label: 'To master' }, ...busesOf().map(b => ({ value: b.id, label: `To ${trackName(b)}` }))], onChange: v => { if (v) t.out = v; else delete t.out; mixChanged(); renderMixer(); } }) : null),
    h('div', { class: 'slots' },
      t.fx.map((fx, k) => h('button', { class: `slot ${fx.off ? 'off' : 'on'}`, title: `${EFFECTS[fx.type].name}${fx.off ? ' (bypassed)' : ''}. Click to edit, right-click for more`, onclick: () => openPlugin(t.id), oncontextmenu: e => { e.preventDefault(); fxMenu(e, t, k); } }, h('span', {}, EFFECTS[fx.type].name))),
      t.fx.length < 8 ? h('button', { class: 'slot empty', onclick: e => effectMenu(e.currentTarget, t) }, '+ Effect') : null),
    h('div', { class: 'knobs' },
      knob({ label: `${trackName(t)} pan`, caption: 'Pan', value: t.pan, min: -1, max: 1, def: 0, size: 30, onInput: v => { t.pan = v; mixChanged(); } }),
      knob({ label: `${trackName(t)} duck`, caption: 'Duck', value: t.duck ?? 0, min: 0, max: 1, def: 0, size: 30, onInput: v => { t.duck = v; mixChanged(); } }),
      knob({ label: `${trackName(t)} reverb`, caption: 'Reverb', value: t.rev, min: 0, max: 1, def: 0, size: 30, onInput: v => { t.rev = v; mixChanged(); } }),
      knob({ label: `${trackName(t)} delay`, caption: 'Delay', value: t.dly, min: 0, max: 1, def: 0, size: 30, onInput: v => { t.dly = v; mixChanged(); } })),
    h('div', { class: 'meterbox' }, scale(), h('canvas', { class: 'meter', 'data-meter': t.id }), fader({ label: `${trackName(t)} volume`, value: t.vol, min: 0, max: 1.2, def: 0.7, onInput: v => { t.vol = v; mixChanged(); } })),
    h('div', { class: 'msrow' },
      h('button', { class: 'ms m', 'aria-pressed': !!t.mute, title: 'Mute', onclick: e => { t.mute = !t.mute; e.currentTarget.setAttribute('aria-pressed', t.mute); mixChanged(); } }, 'M'),
      h('button', { class: 'ms s', 'aria-pressed': !!t.solo, title: 'Solo', onclick: e => { t.solo = !t.solo; e.currentTarget.setAttribute('aria-pressed', t.solo); mixChanged(); } }, 'S')));
  const m = song.master;
  const master = h('div', { class: 'strip master', style: '--c:var(--accent)' }, h('i', { class: 'colorbar' }),
    h('button', { class: 'sname', title: 'Open the Master view', onclick: () => showView('master') }, h('small', {}, 'Output'), h('b', {}, 'Master')), h('div', { class: 'route' }),
    h('div', { class: 'slots' }, ...[`Glue ${Math.round(m.glue * 100)}%`, `Width ${Math.round(m.width * 100)}%`, `Limiter ${m.ceiling} dB`].map(s => h('button', { class: 'slot on', onclick: () => showView('master') }, h('span', {}, s)))),
    h('div'),
    h('div', { class: 'meterbox' }, scale(), h('canvas', { class: 'meter', 'data-meter': 'master' }), fader({ label: 'Master volume', value: ui.master, min: 0, max: 1.2, def: 1, onInput: v => { ui.master = v; audio(); engine.setMaster(v); save(); } })),
    h('div'));
  V.mixer.body.replaceChildren(h('div', { class: 'mixer' }, master, song.tracks.map(strip)));
}
function mixChanged() {  // no re-render here: it would interrupt the knob being dragged
  save();
  if (engine) engine.mix(song.tracks);
}

// ---------- Master: meters, analyzers and the mastering chain ----------
const TARGETS = [['Spotify, YouTube', -14], ['Apple Music', -16], ['SoundCloud', -11], ['Club and DJ', -9]];
function renderMaster() {
  const m = song.master, refGain = () => (ref?.a.lufs != null && Number.isFinite(meters?.state.integrated) ? meters.state.integrated - ref.a.lufs : 0);
  V.master.tools.replaceChildren(
    ref ? h('button', { class: 'btn small', 'aria-pressed': !!refSrc, title: `Play ${ref.meta.title} at the loudness of your beat, so you compare the sound, not the volume`, onclick: () => { toggleRef(refGain()); renderMaster(); } }, icon(refSrc ? 'stop' : 'listen', 14), refSrc ? 'Stop reference' : `Hear ${ref.meta.title} at matched loudness`) : h('span', { class: 'crumb' }, 'Analyze a song in Listen to compare it here at matched loudness.'),
    h('button', { class: 'btn small', title: 'Start the integrated loudness measurement again', onclick: () => { meters?.reset(); hint('Loudness reset. Play the whole song for an integrated reading.'); } }, icon('history', 14), 'Reset loudness'));
  const readout = (id, label, small) => h('div', {}, h('span', {}, label), h('b', { id }, '—'), small ? h('small', {}, small) : null);
  const set = (key, v) => { m[key] = v; audio(); engine.setMasterChain(m); save(); };
  $('#tab-master').replaceChildren(h('div', { class: 'master-view', style: 'grid-template-areas:"spec loud" "knobs scope"' },
    h('div', { class: 'panel', style: 'grid-area:spec' }, h('span', { class: 'legend' }, 'Spectrum, tilted 4.5 dB per octave so a balanced mix reads flat'), h('canvas', { id: 'm-spec' })),
    h('div', { class: 'panel loud', style: 'grid-area:loud' }, h('span', { class: 'legend' }, 'Loudness'),
      readout('lu-m', 'Momentary, LUFS', '400 ms'), readout('lu-s', 'Short-term, LUFS', '3 s'), readout('lu-i', 'Integrated, LUFS', 'Since you pressed play'), readout('lu-p', 'Peak hold, dB', 'Keep it under -1'),
      h('div', { class: 'targets', id: 'targets' }, TARGETS.map(([name, v]) => h('div', { class: 'target' }, h('span', {}, name), h('i', {}, h('em', { style: 'display:none' })), h('span', { class: 'num' }, `${v} LUFS`))))),
    h('div', { class: 'panel', style: 'grid-area:knobs' }, h('span', { class: 'legend' }, 'Master chain'),
      h('div', { class: 'master-knobs' },
        knob({ label: 'Glue compression', caption: 'Glue', value: m.glue, min: 0, max: 1, def: 0.5, size: 56, metal: true, fmt: v => `${Math.round(v * 100)}%`, onInput: v => set('glue', v) }),
        knob({ label: 'Stereo width', caption: 'Width', value: m.width, min: 0, max: 2, def: 1, size: 56, metal: true, fmt: v => `${Math.round(v * 100)}%`, onInput: v => set('width', v) }),
        knob({ label: 'Limiter ceiling', caption: 'Ceiling', value: m.ceiling, min: -6, max: 0, def: -1, size: 56, metal: true, fmt: v => `${v.toFixed(1)} dB`, onInput: v => set('ceiling', Math.round(v * 10) / 10) }),
        knob({ label: 'Master volume', caption: 'Volume', value: ui.master, min: 0, max: 1.2, def: 1, size: 56, hero: true, fmt: v => `${Math.round(v * 100)}%`, onInput: v => { ui.master = v; audio(); engine.setMaster(v); save(); toolbarKnobs(); } }))),
    h('div', { class: 'panel', style: 'grid-area:scope' }, h('span', { class: 'legend', id: 'corr' }, 'Stereo, correlation —'), h('canvas', { id: 'm-scope' }))));
  drawMaster();
}
function drawMaster() {
  const s = meters?.state, P = pal();
  const ink = { grid: P.grid, label: P.subtle, fill: `${P.accent}22`, line: P.accent, dot: P.text };
  if (s) {
    drawSpectrum($('#m-spec'), s.freq, s.sr, ink);
    drawScope($('#m-scope'), s.L, s.R, ink);
    $('#lu-m').textContent = fmtLU(s.momentary);
    $('#lu-s').textContent = fmtLU(s.short);
    $('#lu-i').textContent = fmtLU(s.integrated);
    $('#lu-p').textContent = Number.isFinite(s.hold) ? s.hold.toFixed(1) : '—';
    $('#lu-p').classList.toggle('warn', s.hold > -1);
    $('#corr').textContent = `Stereo, correlation ${Number.isFinite(s.corr) ? s.corr.toFixed(2) : '—'}${s.corr < 0 ? ', out of phase: check in mono' : ''}`;
    $('#targets').querySelectorAll('.target').forEach((el, i) => {  // where the song sits against each platform's level
      const em = el.querySelector('em'), d = s.integrated - TARGETS[i][1];
      em.style.display = Number.isFinite(d) ? '' : 'none';
      em.style.left = `${clamp(50 + d * 4, 0, 100)}%`;
      el.title = Number.isFinite(d) ? `${Math.abs(d).toFixed(1)} LU ${d > 0 ? 'louder than' : 'quieter than'} ${TARGETS[i][0]}'s level, which ${d > 0 ? 'turns it down' : 'leaves it as it is or turns it up'}` : '';
    });
  } else {
    for (const id of ['m-spec', 'm-scope']) { const cv = $(`#${id}`); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); }
  }
}

// ---------- channel settings window ----------
function openPlugin(id) {
  ui.plugin = id;
  const win = $('#plugin');
  if (win.hidden) Object.assign(win.style, { left: `${Math.max(340, innerWidth / 2 - 230)}px`, top: '100px' });
  win.hidden = false;
  renderPlugin();
}
function closePlugin() { ui.plugin = null; $('#plugin').hidden = true; }
function renderPlugin() {
  const t = track(ui.plugin), win = $('#plugin');
  if (!t) return closePlugin();
  const multi = !!t.inst, sampled = !multi && !!t.sample, isAudio = t.kind === 'audio', src = multi ? 'inst' : t.sound === 'slicer' ? 'slicer' : sampled ? 'sample' : t.sound, P = paramsOf(src, t.params ?? {});
  const defs = (PARAMS[src] ?? []).filter(([id]) => !(sampled && id === 'root' && t.kind === 'drum') && !(multi && t.kind === 'drum' && id === 'attack'));
  const list = SOUNDS_FOR[t.kind] ?? [], idx = list.indexOf(t.sound);
  const setSound = s => { t.sound = s; t.params = {}; delete t.preset; clearInstrument(t); clearSample(t); if (t.user && t.name?.startsWith(SOUNDS[list[idx]])) t.name = t.name.replace(SOUNDS[list[idx]], SOUNDS[s]); changed(); audition(t, t.kind === 'bass' ? 36 : t.kind === 'drum' ? 60 : 64); };
  const title = h('div', { class: 'wtitle', style: `--c:${t.color}` },
    h('span', { class: 'swatch', style: `background:${t.color}` }), h('b', {}, trackName(t)),
    multi || sampled || isAudio || !list.length ? h('span', { class: 'dim' }, isAudio ? 'Audio track' : multi ? 'FL instrument' : 'Sampler')
      : h('div', { class: 'tools' },
        h('button', { class: 'iconbtn', 'aria-label': 'Previous instrument', title: 'Previous instrument', onclick: () => setSound(list[(idx - 1 + list.length) % list.length]) }, icon('left', 15)),
        picker({ label: 'Instrument', className: 'flat', value: t.sound, options: list.map(s => ({ value: s, label: SOUNDS[s] })), onChange: setSound }),
        h('button', { class: 'iconbtn', 'aria-label': 'Next instrument', title: 'Next instrument', onclick: () => setSound(list[(idx + 1) % list.length]) }, icon('right', 15))),
    h('span', { class: 'grow' }),
    h('button', { class: 'iconbtn', 'aria-label': 'Close', title: 'Close (Esc)', onclick: closePlugin }, icon('close', 16)));
  const fxKnob = (fx, [id, label, min, max, def]) => {
    const names = FX_STEPS[fx.type]?.[id];
    return knob({
      label, value: fx[id] ?? def, min, max, def, size: 44,
      fmt: names ? v => names[Math.round(v)][0] : undefined,
      caption: names ? names[Math.round(fx[id] ?? def)][0] : label,
      onInput: v => { fx[id] = names ? Math.round(v) : v; mixChanged(); if (fx.type === 'peq') drawEq(win.querySelector(`canvas[data-eq="${t.fx.indexOf(fx)}"]`), fx); },
    });
  };
  const fxCards = t.fx.map((fx, i) => h('div', { class: 'pcard' },
    h('h3', {}, h('span', { class: `dot-led${fx.off ? '' : ' on'}` }), EFFECTS[fx.type].name, h('span', { class: 'grow' }),
      h('button', { class: 'btn small ghost', 'aria-pressed': !!fx.off, title: 'Bypass this effect', onclick: () => { fx.off = !fx.off; mixChanged(); renderPlugin(); if (showing('mixer')) renderMixer(); } }, icon('bypass', 13), fx.off ? 'Bypassed' : 'Bypass'),
      h('button', { class: 'iconbtn', disabled: i === 0, title: 'Move up', 'aria-label': 'Move up', onclick: () => { t.fx.splice(i - 1, 0, ...t.fx.splice(i, 1)); mixChanged(); renderPlugin(); if (showing('mixer')) renderMixer(); } }, icon('up', 14)),
      h('button', { class: 'btn small ghost', onclick: () => { t.fx.splice(i, 1); mixChanged(); renderPlugin(); if (showing('mixer')) renderMixer(); } }, icon('trash', 13), 'Remove')),
    fx.type === 'peq' ? h('canvas', { class: 'eqcurve', 'data-eq': i, 'aria-hidden': 'true' }) : null,
    fx.type === 'vocoder' ? h('div', { style: 'display:flex;gap:8px;align-items:center;margin:2px 0 8px;font-size:12px' }, h('span', { class: 'dim' }, 'Voice from'),
      picker({ label: 'Vocoder voice', value: fx.source ?? '', options: [{ value: '', label: 'Choose a channel' }, ...song.tracks.filter(x => x !== t && x.kind !== 'bus').map(x => ({ value: x.id, label: trackName(x) }))], onChange: v => { fx.source = v || undefined; mixChanged(); renderPlugin(); } })) : null,
    h('div', { class: 'knob-row' }, EFFECTS[fx.type].params.map(p => fxKnob(fx, p)))));
  const instrument = isAudio
    ? h('div', { class: 'pcard' }, h('h3', {}, 'Clips'), h('p', { class: 'dim', style: 'margin:0;font-size:12px' }, `${audioClipsOf(t.id).length} clip${audioClipsOf(t.id).length === 1 ? '' : 's'} on the playlist. Record onto this channel in Song mode (arm it on its mixer strip or in the channel menu), or drop audio files on the playlist.`),
      h('div', { style: 'display:flex;gap:6px;margin-top:12px;flex-wrap:wrap' },
        h('button', { class: 'btn small', 'aria-pressed': !!t.arm, onclick: () => { for (const x of song.tracks) if (x.kind === 'audio') x.arm = x === t ? !t.arm : false; changed(); } }, icon('rec', 13), t.arm ? 'Armed for recording' : 'Arm for recording'),
        h('button', { class: 'btn small', onclick: () => pickAudioFile() }, icon('upload', 13), 'Import audio'),
        toggle({ label: 'Hear the input while recording', checked: ui.monitor, onChange: v => { ui.monitor = v; setMonitor(v); save(); } })))
    : h('div', { class: 'pcard' },
      h('h3', {}, multi ? `FL instrument: ${t.inst.name}` : t.sound === 'slicer' ? `Slicer: ${t.sampleName ?? 'drop a loop on this channel'}` : sampled ? `Sampler: ${t.sampleName}` : `${SOUNDS[t.sound]} synth`, h('span', { class: 'grow' }),
        multi || t.samplePath || PRESETS[t.sound] ? h('div', { class: 'tools' },
          h('button', { class: 'iconbtn', 'aria-label': 'Previous sound', title: multi ? 'Previous instrument' : sampled ? 'Previous sample in this folder' : 'Previous preset', onclick: () => browseSound(t, -1) }, icon('left', 15)),
          !multi && !sampled ? picker({ label: 'Preset', className: 'flat', value: t.preset ?? '', options: [{ value: '', label: t.preset ? 'Preset' : 'Your settings' }, ...Object.keys(PRESETS[t.sound]).map(n => ({ value: n, label: n.replace(/_/g, ' ') }))], onChange: v => { if (v) usePreset(t, v); } }) : null,
          h('button', { class: 'iconbtn', 'aria-label': 'Next sound', title: multi ? 'Next instrument' : sampled ? 'Next sample in this folder' : 'Next preset', onclick: () => browseSound(t, 1) }, icon('right', 15))) : null),
      h('div', { class: 'knob-row' }, defs.map(([id, label, min, max, def, names]) => (id === 'reverse'
        ? toggle({ label: 'Reverse', checked: P.reverse > 0.5, onChange: v => { t.params = { ...t.params, reverse: v ? 1 : 0 }; save(); audition(t, 60); } })
        : knob({ label, value: P[id], min, max, def, size: defs.length > 8 ? 44 : 56, fmt: names ? v => names[Math.round(v) - min] : id === 'start' ? v => `${Math.round(v * 100)}%` : undefined, onInput: v => { t.params = { ...t.params, [id]: names ? Math.round(v) : v }; delete t.preset; save(); } })))),
      h('div', { style: 'display:flex;gap:6px;margin-top:12px;flex-wrap:wrap' },
        h('button', { class: 'btn small', onclick: () => audition(t, t.kind === 'drum' ? 60 : t.kind === 'bass' ? 36 : 64) }, icon('play', 13), 'Play a note'),
        flInst.length && t.kind !== 'drum' ? h('button', { class: 'btn small', title: "Play one of FL Studio's sampled instruments on this channel", onclick: e => instrumentMenu(e.currentTarget, t) }, icon('piano', 13), 'FL instrument') : null,
        flKit.length && t.kind === 'drum' ? h('button', { class: 'btn small', title: 'Take this hit from one of FL Studio\'s drum kits', onclick: e => kitMenu(e.currentTarget, t) }, icon('pads', 13), 'From a kit') : null,
        multi || sampled ? h('button', { class: 'btn small ghost', onclick: () => { clearSample(t); clearInstrument(t); t.params = {}; changed(); } }, 'Use the synth instead')
          : h('span', { class: 'dim', style: 'font-size:12px;align-self:center' }, 'Drop a sound on the channel to sample it')));
  win.replaceChildren(title, h('div', { class: 'pbody' },
    h('div', { class: 'pcard' }, h('h3', {}, 'Channel'),
      h('div', { class: 'knob-row' },
        knob({ label: 'Volume', value: t.vol, min: 0, max: 1.2, def: 0.7, size: 44, fmt: v => `${Math.round(v * 100)}%`, onInput: v => { t.vol = v; mixChanged(); } }),
        knob({ label: 'Pan', value: t.pan, min: -1, max: 1, def: 0, size: 44, onInput: v => { t.pan = v; mixChanged(); } }),
        knob({ label: 'Reverb', value: t.rev, min: 0, max: 1, def: 0, size: 44, onInput: v => { t.rev = v; mixChanged(); } }),
        knob({ label: 'Delay', value: t.dly, min: 0, max: 1, def: 0, size: 44, onInput: v => { t.dly = v; mixChanged(); } }),
        knob({ label: 'Duck', value: t.duck ?? 0, min: 0, max: 1, def: 0, size: 44, onInput: v => { t.duck = v; mixChanged(); } }))),
    instrument,
    isAudio ? null : h('div', { class: 'pcard' }, h('h3', {}, 'Keyboard', h('span', { class: 'grow' }), h('small', { class: 'dim' }, 'Click and slide to play')), keyboard(t)),
    h('div', { class: 'pcard' }, h('h3', {}, `Effects, ${t.fx.length} of 8`, h('span', { class: 'grow' }), t.fx.length < 8 ? h('button', { class: 'btn small', onclick: e => effectMenu(e.currentTarget, t) }, icon('plus', 13), 'Add effect') : null),
      fxCards.length ? h('div', { style: 'display:grid;gap:8px' }, fxCards) : h('p', { class: 'dim', style: 'margin:0;font-size:12px' }, 'No effects on this channel yet.'))));
  floating(win, title);
  t.fx.forEach((fx, i) => { if (fx.type === 'peq') drawEq(win.querySelector(`canvas[data-eq="${i}"]`), fx); });
}
const FX_STEPS = { delay: { time: DELAY_TIMES }, gate: { rate: GATE_TIMES }, autopan: { rate: PAN_TIMES }, vocoder: { bands: VOCODER_BANDS }, warp: { mode: WARP_MODES, when: WARP_WHEN }, tune: { key: KEYS, scale: TUNE_SCALES } };
// The parametric EQ's response, worked out by the same filters the engine uses
let eqCtx = null;
function drawEq(cv, fx) {
  if (!cv) return;
  const w = cv.clientWidth, ht = cv.clientHeight, dpr = devicePixelRatio || 1;
  if (!w) return requestAnimationFrame(() => drawEq(cv, fx));
  cv.width = Math.round(w * dpr); cv.height = Math.round(ht * dpr);
  eqCtx ??= new OfflineAudioContext(1, 1, 44100);
  const P = Object.fromEntries(EFFECTS.peq.params.map(([id, , , , def]) => [id, fx[id] ?? def])), n = 200;
  const freqs = Float32Array.from({ length: n }, (_, i) => 20 * 1000 ** (i / (n - 1))), mag = new Float32Array(n), ph = new Float32Array(n), total = new Float32Array(n).fill(0);
  for (const [type, f, gdb, q] of [['lowshelf', P.lf, P.lg, 0.7], ['peaking', P.f1, P.g1, P.q1], ['peaking', P.f2, P.g2, P.q2], ['highshelf', P.hf, P.hg, 0.7]]) {
    const b = eqCtx.createBiquadFilter();
    Object.assign(b, { type }); b.frequency.value = f; b.gain.value = gdb; b.Q.value = q;
    b.getFrequencyResponse(freqs, mag, ph);
    for (let i = 0; i < n; i++) total[i] += 20 * Math.log10(mag[i]);
  }
  const g = cv.getContext('2d'), y = db => ht / 2 - db / 18 * (ht / 2 - 6);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, ht);
  g.fillStyle = pal().grid;
  for (const f of [100, 1000, 10000]) g.fillRect(Math.log(f / 20) / Math.log(1000) * w, 0, 1, ht);
  g.fillRect(0, ht / 2, w, 1);
  g.beginPath();
  for (let i = 0; i < n; i++) g[i ? 'lineTo' : 'moveTo'](i / (n - 1) * w, y(total[i]));
  g.strokeStyle = pal().accent;
  g.lineWidth = 2;
  g.stroke();
}

// ---------- pads: the selected drum's current bar as sixteen backlit pads ----------
const padTrack = () => (track(ui.selected)?.kind === 'drum' ? track(ui.selected) : track('kick') ?? song.tracks.find(t => t.kind === 'drum') ?? song.tracks[0]);
function renderPads() {
  const t = padTrack(), notes = notesFor(t, ui.pattern) ?? [];
  $('#pad-channels').replaceChildren(...song.tracks.filter(d => d.kind === 'drum').map(d => {
    const chip = h('button', { class: 'chip', style: `--c:${d.color}`, 'aria-pressed': d === t, title: `Play ${trackName(d)} on the pads`, onclick: () => select(d.id) }, h('i'), trackName(d));
    dropOn(chip, d);
    return chip;
  }));
  $('#pad-bars').replaceChildren(...Array.from({ length: patBars() }, (_, b) => h('button', { 'aria-pressed': b === ui.bar, 'aria-label': `Bar ${b + 1}`, onclick: () => { ui.bar = b; barChanged(); } }, b + 1)));
  $('#padgrid').replaceChildren(...Array.from({ length: 16 }, (_, i) => {
    const s = ui.bar * 16 + i, here = notes.filter(n => n.t >= s * STEP && n.t < (s + 1) * STEP), c = here[0]?.c;
    return h('button', {
      class: `bigpad${here.length ? ' on' : ''}${here.length > 1 ? ' roll' : ''}${c != null && c < 1 ? ' chance' : ''}`, 'data-step': i, 'aria-pressed': !!here.length,
      'aria-label': `${trackName(t)} step ${i + 1}`, title: 'Click to add or remove a hit, Shift-click for a roll, right-click for velocity, chance and ratchets',
      style: `--c:${t.color}${here.length ? `;--v:${Math.max(...here.map(n => n.v)) / 127}` : ''}`, onclick: e => togglePad(t, s, e.shiftKey),
      oncontextmenu: e => { e.preventDefault(); stepMenu(e, t, s); },
    }, h('span', {}, i + 1));
  }));
  lastStep = -1;
}

// ---------- 3D deck ----------
async function initDeck() {
  try {
    const { createDeck } = await import('./deck.js');
    deck = await createDeck($('#deck'), { onPad: i => togglePad(padTrack(), ui.bar * 16 + i, false), onRecord: () => togglePlay() });
    $('#deck-hint').textContent = 'Click the record to play';
    window.beatlabDeck = deck;  // handy for poking at the 3D scene from the console
  } catch (e) {
    $('#deck-hint').textContent = `The 3D turntable couldn't load (${e.message})`;
  }
}

// ---------- every frame: playheads, lights, meters ----------
function markStep(i) {
  for (const el of document.querySelectorAll('[data-step].now')) el.classList.remove('now');
  if (i >= 0) for (const el of document.querySelectorAll(`[data-step="${i}"]`)) el.classList.add('now');
}
let frameN = 0, lastMeter = 0;
function frame() {
  requestAnimationFrame(frame);
  frameN++;
  const playing = player?.playing;
  let now = -1;
  if (playing) {
    const tick = player.position(), bar = Math.floor(tick / BAR), sec = player.sections.findLast(s => s.start <= tick);
    const step = Math.floor(tick % BAR / STEP);
    turns = tick / BAR;
    if (player.counting) {
      const left = Math.ceil((player.countUntil - ctx.currentTime) / (60 / song.bpm));
      lcdText($('#pos'), `--.${clamp(5 - left, 1, 4)}.-`);
      $('#where').textContent = `Count-in, ${left}`;
    } else {
      lcdText($('#pos'), posText(tick));
      $('#where').textContent = rec ? `Recording, bar ${bar + 1}` : ui.mode === 'song' ? `${sec?.name ?? 'Song'}, bar ${bar + 1}` : `${pat().name}, bar ${bar % patBars() + 1}`;
    }
    if (ui.mode === 'pattern' && !player.counting && bar % patBars() !== ui.bar) { ui.bar = bar % patBars(); barChanged(); }
    now = player.counting ? -1 : step;
    if (now !== lastStep) { markStep(now); lastStep = now; }
    const head = $('#pl-head');
    if (head && ui.mode === 'song') head.style.left = `${hdr() + tick / BAR * barWidth}px`;
    const rh = $('#roll-head');
    if (rh) { rh.hidden = ui.mode !== 'pattern'; rh.style.left = `calc(60px + (100% - 60px) * ${tick / (patBars() * BAR)})`; }
    if (showing('mixer')) drawMeters();
    if (rec?.kind === 'audio' && frameN % 6 === 0) drawRowN(rec.row);
  }
  if (meters && (playing || refSrc || Number.isFinite(meters.state.momentary))) {
    meters.read(showing('master'));  // the spectrum is only read when it's on screen
    if (!playing && !refSrc && meters.state.momentary < -70) meters.state.momentary = -Infinity;
    if (showing('master')) drawMaster();
    $('#lufs-mini').textContent = Number.isFinite(meters.state.short) && playing ? `Output · ${fmtLU(meters.state.short)} LUFS` : 'Output';
  }
  if ((playing || outPeak > 1e-3) && performance.now() - lastMeter > 15) { lastMeter = performance.now(); drawOutMeter(); }  // 60 a second, even on faster screens
  if (deck) {
    const t = padTrack(), notes = notesFor(t, ui.pattern) ?? [];
    const lit = Array.from({ length: 16 }, (_, i) => notes.some(n => n.t >= (ui.bar * 16 + i) * STEP && n.t < (ui.bar * 16 + i + 1) * STEP));
    deck.update({ playing: !!playing, turns, progress: playing ? player.position() / player.length : 0, lit, now });
  }
}

const masterBuf = new Float32Array(2048);
let outPeak = 1e-6, outAvg = 1e-6;
const LED = (i, segs) => (i >= segs - 2 ? '#FF3B30' : i >= segs - 7 ? '#FF7A3D' : ui.theme === 'light' ? '#3A3A3A' : '#CFCFCF');
function drawOutMeter() {  // two rows of LED segments in the top bar, peak over average; unlit ones stay faintly visible
  const cv = $('#out-meter'), w = cv.clientWidth, ht = cv.clientHeight, dpr = devicePixelRatio || 1;
  if (!w) return;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(ht * dpr); }
  let peak = 0, sum = 0;
  if (engine && player?.playing) {
    engine.analyser.getFloatTimeDomainData(masterBuf);
    for (let i = 0; i < masterBuf.length; i++) { const x = masterBuf[i], a = x < 0 ? -x : x; if (a > peak) peak = a; sum += x * x; }
  }
  outPeak = Math.max(peak, outPeak * 0.9);  // fall back slowly, like a real meter
  outAvg = Math.max(Math.sqrt(sum / masterBuf.length), outAvg * 0.94);
  const g = cv.getContext('2d'), segs = 30, gap = 3, sw = (w - gap * (segs - 1)) / segs, rh = (ht - 4) / 2;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, ht);
  [outPeak, outAvg].forEach((v, row) => {  // one path per colour band, lit and unlit
    const lit = Math.round(clamp((20 * Math.log10(v) + 42) / 42, 0, 1) * segs);
    for (const [a, b] of [[0, segs - 7], [segs - 7, segs - 2], [segs - 2, segs]]) {
      for (const on of [true, false]) {
        g.fillStyle = LED(a, segs);
        g.globalAlpha = on ? 1 : 0.09;
        g.beginPath();
        for (let i = a; i < b; i++) if ((i < lit) === on) g.roundRect(i * (sw + gap), row * (rh + 4), sw, rh, 1.5);
        g.fill();
      }
    }
  });
  g.globalAlpha = 1;
}
function drawMeters() {
  for (const cv of document.querySelectorAll('[data-meter]')) {
    const id = cv.dataset.meter;
    let v;
    if (id === 'master') {
      engine.analyser.getFloatTimeDomainData(masterBuf);
      v = masterBuf.reduce((m, x) => Math.max(m, Math.abs(x)), 0);
    } else v = engine.level(id);
    const w = cv.clientWidth, ht = cv.clientHeight, g = cv.getContext('2d'), dpr = devicePixelRatio || 1;
    if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = ht * dpr; }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const level = 20 * Math.log10(v || 1e-6), segs = 20, gap = 2, sh = (ht - 4 - gap * (segs - 1)) / segs, lit = Math.round(clamp((level + 48) / 48, 0, 1) * segs);
    g.clearRect(0, 0, w, ht);
    for (let i = 0; i < segs; i++) {
      g.fillStyle = i >= 18 ? '#FF3B30' : i >= 15 ? '#FF7A3D' : ui.theme === 'light' ? '#3A3A3A' : '#CFCFCF';
      g.globalAlpha = i < lit ? 1 : 0.08;
      g.fillRect(2, ht - 2 - (i + 1) * sh - i * gap, w - 4, sh);
    }
    g.globalAlpha = 1;
  }
}

// ---------- export ----------
const slug = s => s.toLowerCase().replace(/[^a-z0-9#]+/g, '_').replace(/#/g, 's').replace(/^_|_$/g, '');
function fileNames() {  // unique, readable file names per track
  const used = new Set();
  return Object.fromEntries(song.tracks.map(t => {
    let n = slug(trackName(t));
    if (used.has(n)) n = `${n}_${slug(t.id)}`;
    used.add(n);
    return [t.id, n];
  }));
}
// Where exported files go: BeatLab's exports folder through the desktop server, or one zip download
async function exportSink(name, bpm, tracks) {
  if (server) {
    const res = await post('/api/export', JSON.stringify({ name, bpm, tracks }));
    return { res, file: (n, ext, body) => post(`/api/file?folder=${encodeURIComponent(res.folder)}&file=${encodeURIComponent(n)}&ext=${ext}`, body), done: async () => {} };
  }
  const files = tracks.map(t => [`${slug(t.name)}.mid`, midiFile(bpm, [t])]);
  if (tracks.length) files.push(['beat.mid', midiFile(bpm, tracks)]);
  return {
    res: { folder: name, path: `${name}.zip in your Downloads` },
    file: async (n, ext, body) => { files.push([`${n}.${ext}`, body]); },
    done: async () => download(await zipFiles(files.map(([n, b]) => [`${name}/${n}`, b])), `${name}.zip`),
  };
}
async function post(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'X-BeatLab': '1' }, body });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error);
  return j;
}
const radio = (name, options, value, onChange) => h('div', { style: 'display:grid;gap:7px' }, options.map(([v, label]) => h('label', {}, h('input', { type: 'radio', name, value: String(v), checked: v === value, onchange: () => onChange(v) }), label)));
const check = (label, value, onChange, extra = {}) => h('label', { title: extra.title }, h('input', { type: 'checkbox', checked: value, disabled: extra.disabled, onchange: e => onChange(e.target.checked) }), label);
function openExport(preset = {}) {
  const ex = ui.exp = { what: view(), bits: 24, sr: 44100, mp3: false, target: null, ceiling: -1, mix: true, stems: false, dry: false, inst: false, nomel: false, drums: false, bass: 'sampler', ...ui.exp, what: view(), ...preset };
  const hasAudio = song.playlist.clips.some(c => c.type === 'audio');
  const name = h('input', { type: 'text', value: slug(`${current?.name && !/^untitled/i.test(current.name) ? current.name : STYLES[song.style].name} ${NOTES[song.root]}${song.mode === 'major' ? '' : 'm'} ${song.bpm}`), required: true, 'aria-label': 'Folder name' });
  const summary = h('p', { class: 'note' }), status = h('p', { class: 'ex-status', role: 'status' }), go = h('button', { class: 'key primary btn', style: 'height:34px' }, icon('export', 15), 'Export');
  const openBtn = h('button', { class: 'btn', hidden: true }, icon('folder', 14), 'Open folder');
  const refresh = () => {  // what's about to be written, and roughly how big
    const secs = arrange(song, ex.what).length * spt() + 3, per = secs * ex.sr * 2 * (ex.bits / 8) / 1e6;
    const parts = arrange(song, ex.what).events.filter(e => e.notes.length).length + (ex.what === 'song' ? song.tracks.filter(t => t.kind === 'audio' && audioClipsOf(t.id).length).length : 0);
    const files = (ex.mix ? 1 : 0) + (ex.stems ? parts : 0) + [ex.inst, ex.nomel, ex.drums].filter(Boolean).length;
    summary.textContent = `${clock(secs)} of audio. About ${Math.round(files * per)} MB of WAV${ex.mp3 ? ` plus ${Math.round(files * secs * 0.04)} MB of MP3` : ''}, and a MIDI file for every part.`;
  };
  const set = (k, v) => { ex[k] = v; save(); refresh(); };
  go.addEventListener('click', () => doExport(ex, name.value, status, go, openBtn));
  const history = ui.exports.length ? h('div', {}, h('div', { class: 'sect' }, 'Recent exports'), h('div', { class: 'list' }, ui.exports.map(x => h('div', { class: 'item' },
    h('div', {}, h('b', {}, x.name), h('small', {}, `${new Date(x.at).toLocaleString()} · ${x.what === 'song' ? 'full song' : x.label ?? 'one pattern'}${x.lufs != null ? ` · ${x.lufs.toFixed(1)} LUFS` : ''}`)),
    server ? h('div', { class: 'btns' }, h('button', { class: 'btn small', onclick: () => post(`/api/open?folder=${encodeURIComponent(x.folder)}`, '') }, 'Open')) : null)))) : null;
  openDialog({ title: 'Export to FL Studio', glyph: 'export', body: [
    h('label', { class: 'field' }, 'Folder name, inside BeatLab\'s exports folder', name),
    h('div', { class: 'row3' },
      h('fieldset', {}, h('legend', {}, 'What to export'), radio('what', [[ui.pattern, `${pat().name}, ${patBars()} bars`], ['song', 'The full song']], ex.what === 'song' ? 'song' : ui.pattern, v => set('what', v))),
      h('fieldset', {}, h('legend', {}, 'Audio files'),
        check('Full mix', ex.mix, v => set('mix', v)),
        check('Stems, one per part', ex.stems, v => set('stems', v)),
        check('Stems without effects', ex.dry, v => set('dry', v), { title: 'Dry stems: no insert effects, reverb or delay, so you can mix them fresh in FL Studio' }),
        check('Also MP3, 320 kbps', ex.mp3, v => set('mp3', v))),
      h('fieldset', {}, h('legend', {}, 'Extra versions'),
        check('Instrumental, no recordings', ex.inst, v => set('inst', v), { disabled: !hasAudio, title: hasAudio ? '' : 'Only songs with recorded or imported audio have an instrumental' }),
        check('Without the melody, for vocals', ex.nomel, v => set('nomel', v)),
        check('Drums only', ex.drums, v => set('drums', v)))),
    h('div', { class: 'row3' },
      h('fieldset', {}, h('legend', {}, 'WAV format'), radio('bits', [[16, '16-bit, dithered'], [24, '24-bit'], [32, '32-bit float']], ex.bits, v => set('bits', v)), radio('sr', [[44100, '44.1 kHz'], [48000, '48 kHz']], ex.sr, v => set('sr', v))),
      h('fieldset', {}, h('legend', {}, 'Loudness'), radio('target', [[null, 'As mixed'], [-14, '-14 LUFS, streaming'], [-11, '-11 LUFS, loud'], [-9, '-9 LUFS, club']], ex.target, v => set('target', v)), radio('ceiling', [[-1, 'Peaks under -1 dB'], [-0.3, 'Peaks under -0.3 dB']], ex.ceiling, v => set('ceiling', v))),
      h('fieldset', {}, h('legend', {}, '808 and bass MIDI notes'), radio('bass', [['sampler', 'Around C5, for 808 samples in FL\'s sampler'], ['real', 'At real pitch, for synth plugins']], ex.bass, v => set('bass', v)))),
    summary, status,
    h('div', { class: 'ex-actions' }, h('button', { class: 'btn', onclick: () => $('#dlg').close() }, 'Close'), openBtn, go),
    history,
  ] });
  refresh();
}
async function doExport(ex, folderName, status, go, openBtn) {
  const say = msg => { status.textContent = msg; };
  const what = ex.what, sampler = ex.bass === 'sampler', names = fileNames(), a = arrange(song, what), started = Date.now();
  go.disabled = true;
  const lines = [`BeatLab export, ${new Date().toLocaleString()}`, `${STYLES[song.style].name}, ${song.bpm} BPM, ${NOTES[song.root]} ${song.mode}, ${what === 'song' ? 'full song' : `pattern ${patternOf(song, what)?.name}`}`, `WAV ${ex.bits}-bit ${ex.sr / 1000} kHz${ex.mp3 ? ', MP3 320 kbps' : ''}; loudness ${ex.target == null ? 'as mixed' : `${ex.target} LUFS`}; peaks under ${ex.ceiling} dB`, ''];
  try {
    say('Writing MIDI files…');
    const tracks = a.events.filter(ev => !['texture', 'fx', 'audio'].includes(ev.track.kind) && ev.notes.length).map(({ track: t, notes }) => {
      let shift = 0;
      if (t.kind === 'bass' && sampler) {  // FL's sampler plays a sample at its own pitch on C5 (MIDI 60)
        const ps = notes.map(n => n.p).sort((x, y) => x - y);
        shift = 12 * Math.round((60 - ps[ps.length >> 1]) / 12);
      }
      return { name: names[t.id], notes: notes.map(n => [Math.round(n.t), Math.max(1, Math.round(n.d)), n.p + shift, n.v]) };
    });
    const sink = await exportSink(folderName, song.bpm, tracks), res = sink.res, file = sink.file;
    lines.push(`MIDI: beat.mid plus ${tracks.length} parts`);
    const write = async (n, buf) => { await file(n, 'wav', encodeWav(buf, ex.bits)); if (ex.mp3) await file(n, 'mp3', await encodeMp3(buf)); };
    const opts = { sr: ex.sr, audio: audioBufs, master: song.master };
    let mixGain = 0, mixLufs = null;
    const finished = async (label, n, buf) => {
      const r = await finish(buf, { target: ex.target, ceiling: ex.ceiling });
      await write(n, buf);
      lines.push(`${label}: ${r.after == null ? 'n/a' : r.after.toFixed(1)} LUFS, peak ${r.peak.toFixed(1)} dB${r.gainDb ? `, ${r.gainDb > 0 ? '+' : ''}${r.gainDb.toFixed(1)} dB gain` : ''}${r.reduction < -0.1 ? `, limited ${r.reduction.toFixed(1)} dB` : ''}`);
      return r;
    };
    if (ex.mix) {
      say('Rendering the mix…');
      const r = await finished('Mix', 'mix', await render(song, what, dusty(), null, opts));
      mixGain = r.gainDb;
      mixLufs = r.after;
    }
    const versions = [['inst', 'Instrumental', 'mix_instrumental', song.tracks.filter(t => t.kind === 'audio').map(t => t.id)], ['nomel', 'Without melody', 'mix_no_melody', ['melody', 'arp']], ['drums', 'Drums only', 'mix_drums_only', song.tracks.filter(t => t.kind !== 'drum').map(t => t.id)]];
    for (const [key, label, n, mute] of versions) {
      if (!ex[key]) continue;
      say(`Rendering the ${label.toLowerCase()} version…`);
      await finished(label, n, await render(song, what, dusty(), null, { ...opts, mute }));
    }
    if (ex.stems) {
      const parts = a.events.filter(ev => ev.notes.length || (what === 'song' && ev.track.kind === 'audio' && audioClipsOf(ev.track.id).length)).map(ev => ev.track);
      for (const [i, t] of parts.entries()) {
        say(`Rendering stem ${i + 1} of ${parts.length}: ${trackName(t)}…`);
        const buf = await render(song, what, dusty(), t.id, { ...opts, dry: ex.dry });
        limitInPlace(buf, 10 ** (mixGain / 20), ex.ceiling);  // the mix's gain, so stems still add up to it
        await write(`stem_${names[t.id]}`, buf);
      }
      lines.push(`Stems: ${parts.length}${ex.dry ? ', without effects' : ''}`);
    }
    lines.push('', `Took ${Math.round((Date.now() - started) / 1000)} s.`, 'In FL Studio: set the tempo, then File > Import > MIDI file and pick beat.mid. Drag the WAV files onto the playlist.');
    await file('report', 'txt', lines.join('\n'));
    await sink.done();
    ui.exports = [{ name: folderName, folder: res.folder, at: Date.now(), what, label: patternOf(song, what)?.name, lufs: mixLufs }, ...ui.exports.filter(x => x.folder !== res.folder)].slice(0, 8);
    save();
    say(`Saved to ${res.path}\n${lines.slice(4, -3).join('\n')}\nIn FL Studio, set the tempo to ${song.bpm}, then File > Import > MIDI file and pick beat.mid.`);
    openBtn.hidden = !server;
    openBtn.onclick = () => post(`/api/open?folder=${encodeURIComponent(res.folder)}`, '');
  } catch (err) {
    say(`Export stopped: ${err.message}. Make sure BeatLab is still running in its window, then try again.`);
  }
  go.disabled = false;
}

// ---------- projects, versions and project files ----------
const newProjectRecord = name => ({ id: newId(), name, artist: '', notes: '', created: Date.now(), updated: Date.now(), versions: [], song: '' });
async function persist(json) {
  if (!current) return;
  current.song = json;
  current.updated = Date.now();
  try {
    await projects.put(current);
    setSaveState(`Saved ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`, true);
  } catch (e) { setSaveState(`Not saved: ${e.message}`); }
}
function setSaveState(text, ok) {
  $('#proj-state').textContent = text;
  $('#save-state').textContent = ok ? `Autosaved, ${text.toLowerCase()}` : text;
  $('#save-state').classList.toggle('on', !!ok);
}
function renderProject() {
  $('#proj-name').textContent = current?.name ?? 'Untitled';
  document.title = `${current?.name ?? 'Untitled'} · BeatLab Studio`;
}
async function startProjects() {
  let p = ui.project ? await projects.get(ui.project).catch(() => null) : null;
  if (!p) {
    const n = (await projects.all().catch(() => [])).length;
    p = newProjectRecord(n ? `Untitled ${n + 1}` : 'My first beat');
    ui.project = p.id;
  }
  current = p;
  renderProject();
  persist(songJSON());
}
async function openProject(id) {
  const p = await projects.get(id);
  if (!p?.song) return toast("That project couldn't be opened.");
  if (player?.playing || rec) togglePlay();
  const next = JSON.parse(p.song);
  prepare(next);
  await loadAudioFor(next);
  current = p;
  ui.project = p.id;
  ui.cursor = 0;
  song = next;
  restoreSounds(song.tracks);
  history.stack = [];
  history.at = -1;
  if (!track(ui.selected)) ui.selected = song.tracks[0].id;
  if (!patternOf(song, ui.pattern)) ui.pattern = hookId(song);
  if (ctx) engine.setMasterChain(song.master);
  closePlugin();
  toolbarKnobs();
  renderProject();
  changed();
  $('#dlg').close();
  toast(`Opened ${p.name}.`);
}
async function newProject() {
  if (player?.playing || rec) togglePlay();
  const n = (await projects.all()).length + 1;
  current = newProjectRecord(`Untitled ${n}`);
  ui.project = current.id;
  ui.cursor = 0;
  history.stack = [];
  history.at = -1;
  closePlugin();
  setSong(generate({ style: ui.style, bpm: STYLES[ui.style].bpm[2], root: song.root, mode: song.mode, energy: ui.energy, complexity: ui.complexity }));
  if (ui.flKit && lib.length) { await applyKit(); changed(); }
  renderProject();
  $('#dlg').close();
  toast(`Started ${current.name}. Your other projects are under the project name, top left.`);
}
function projectMenu(anchor) {
  menu(anchor, [
    { heading: current?.name ?? 'Project' },
    { label: 'New project', icon: 'plus', onSelect: newProject },
    { label: 'Open a project…', icon: 'folder', onSelect: projectsDialog },
    { label: 'Save a version…', icon: 'save', hint: 'Ctrl+S', onSelect: versionDialog },
    { label: `Versions${current?.versions.length ? ` (${current.versions.length})` : ''}…`, icon: 'history', onSelect: versionDialog },
    { label: 'Project info…', icon: 'info', onSelect: infoDialog },
    '-',
    { label: 'Save as a project file…', icon: 'export', hint: 'Moves between computers', onSelect: exportProjectFile },
    { label: 'Open a project file…', icon: 'upload', onSelect: importProjectFile },
    { label: 'Clean up unused audio', icon: 'trash', onSelect: cleanUpAudio },
  ], { width: 270 });
}
async function projectsDialog() {
  const all = (await projects.all()).sort((x, y) => y.updated - x.updated);
  const body = h('div', {});
  const draw = list => body.replaceChildren(
    h('div', { style: 'display:flex;gap:8px' }, h('button', { class: 'key primary btn', onclick: newProject }, icon('plus', 14), 'New project'), h('button', { class: 'btn', onclick: importProjectFile }, icon('upload', 14), 'Open a project file')),
    h('div', { class: 'list' }, list.map(p => {
      let sure = false;
      const del = h('button', { class: 'btn small ghost', disabled: p.id === current?.id, title: p.id === current?.id ? 'Open another project to delete this one' : 'Delete this project', onclick: async () => {
        if (!sure) { sure = true; del.textContent = 'Delete for good?'; return; }
        await projects.del(p.id);
        draw((await projects.all()).sort((x, y) => y.updated - x.updated));
      } }, 'Delete');
      return h('div', { class: `item${p.id === current?.id ? ' cur' : ''}` },
        h('div', { style: 'min-width:0' }, h('b', {}, p.name), h('small', {}, `Edited ${new Date(p.updated).toLocaleString()}${p.versions.length ? ` · ${p.versions.length} version${p.versions.length === 1 ? '' : 's'}` : ''}${p.artist ? ` · ${p.artist}` : ''}`)),
        h('div', { class: 'btns' },
          h('button', { class: 'btn small', disabled: p.id === current?.id, onclick: () => openProject(p.id) }, p.id === current?.id ? 'Open now' : 'Open'),
          h('button', { class: 'btn small ghost', onclick: async () => { const copy = { ...structuredClone(p), id: newId(), name: `${p.name} copy`, created: Date.now(), updated: Date.now() }; await projects.put(copy); draw((await projects.all()).sort((x, y) => y.updated - x.updated)); } }, 'Duplicate'),
          del));
    })));
  draw(all);
  openDialog({ title: 'Projects', glyph: 'folder', body });
}
function versionDialog() {
  const name = h('input', { type: 'text', value: `Version ${(current?.versions.length ?? 0) + 1}`, 'aria-label': 'Version name', style: 'flex:1' });
  const body = h('div', {});
  const draw = () => body.replaceChildren(
    h('div', { style: 'display:flex;gap:8px' }, name, h('button', { class: 'key primary btn', onclick: () => { saveVersion(name.value.trim() || 'Version'); name.value = `Version ${current.versions.length + 1}`; draw(); } }, icon('save', 14), 'Save version')),
    h('p', { class: 'note' }, 'A version is a snapshot of the whole beat. Restoring one replaces what\'s open now, and Ctrl+Z undoes that.'),
    h('div', { class: 'list' }, [...current.versions].reverse().map(v => h('div', { class: 'item' },
      h('div', {}, h('b', {}, v.name), h('small', {}, new Date(v.at).toLocaleString())),
      h('div', { class: 'btns' },
        h('button', { class: 'btn small', onclick: async () => { const next = JSON.parse(v.song); prepare(next); await loadAudioFor(next); restoreSounds(next.tracks); song = next; toolbarKnobs(); changed(); $('#dlg').close(); toast(`Restored ${v.name}. Ctrl+Z goes back.`); } }, 'Restore'),
        h('button', { class: 'btn small ghost', onclick: () => { current.versions = current.versions.filter(x => x !== v); persist(songJSON()); draw(); } }, 'Delete'))))));
  draw();
  openDialog({ title: `Versions of ${current.name}`, glyph: 'history', body });
  name.select();
}
function saveVersion(label) {
  current.versions.push({ name: label, at: Date.now(), song: songJSON() });
  persist(songJSON());
  toast(`Saved "${label}". Find it under the project name, Versions.`);
}
const quickVersion = () => saveVersion(`Version ${current.versions.length + 1}, ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`);
function infoDialog() {
  const name = h('input', { type: 'text', value: current.name, 'aria-label': 'Project name' });
  const artist = h('input', { type: 'text', value: current.artist ?? '', placeholder: 'Producer name, like KIKA', 'aria-label': 'Artist' });
  const notes = h('textarea', { rows: 6, placeholder: 'Ideas, lyrics, who it\'s for, sample credits…', 'aria-label': 'Notes' }, current.notes ?? '');
  const clips = song.playlist.clips.filter(c => c.type === 'audio').length;
  openDialog({ title: 'Project info', glyph: 'info', body: [
    h('div', { class: 'row2' }, h('label', { class: 'field' }, 'Name', name), h('label', { class: 'field' }, 'Artist', artist)),
    h('label', { class: 'field', style: 'margin-top:12px' }, 'Notes', notes),
    h('p', { class: 'note' }, `${STYLES[song.style].name}, ${song.bpm} BPM, ${NOTES[song.root]} ${song.mode}. ${song.patterns.length} patterns, ${song.tracks.length} channels, ${clips} audio clips, ${songLength(song) / BAR} bars. Started ${new Date(current.created).toLocaleDateString()}.`),
    h('div', { class: 'ex-actions' }, h('button', { class: 'btn', onclick: () => $('#dlg').close() }, 'Cancel'), h('button', { class: 'key primary btn', onclick: () => {
      Object.assign(current, { name: name.value.trim() || current.name, artist: artist.value.trim(), notes: notes.value });
      persist(songJSON());
      renderProject();
      $('#dlg').close();
    } }, 'Save')),
  ], wide: false });
}
const toBase64 = blob => new Promise(ok => { const r = new FileReader(); r.onload = () => ok(r.result.split(',')[1]); r.readAsDataURL(blob); });
function download(blob, name) {
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
async function exportProjectFile() {
  const ids = [...new Set(song.playlist.clips.filter(c => c.type === 'audio').map(c => c.buf))], audio = {};
  for (const id of ids) { const b = audioBufs.get(id) ?? await getAudio(id); if (b) audio[id] = await toBase64(encodeWav(b, 16)); }
  const fileData = { format: 'beatlab-project', version: 1, saved: new Date().toISOString(), project: { name: current.name, artist: current.artist, notes: current.notes, versions: current.versions }, song: JSON.parse(songJSON()), audio };
  download(new Blob([JSON.stringify(fileData)], { type: 'application/json' }), `${slug(current.name) || 'beat'}.beatlab`);
  toast(`Saved ${current.name} as a .beatlab file with its recordings. Open it on any computer with BeatLab.`);
}
function importProjectFile() {
  const input = h('input', { type: 'file', accept: '.beatlab,.json' });
  input.addEventListener('change', async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      if (data.format !== 'beatlab-project' || !data.song?.tracks) throw new Error('it isn\'t a BeatLab project file');
      audio();
      for (const [id, b64] of Object.entries(data.audio ?? {})) {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), buf = await ctx.decodeAudioData(bytes.buffer);
        audioBufs.set(id, buf);
        await putAudio(id, buf);
      }
      const p = { ...newProjectRecord(data.project?.name ?? 'Imported beat'), artist: data.project?.artist ?? '', notes: data.project?.notes ?? '', versions: data.project?.versions ?? [], song: JSON.stringify(data.song) };
      await projects.put(p);
      await openProject(p.id);
    } catch (e) { toast(`Couldn't open that file: ${e.message}.`); }
  });
  input.click();
}
async function cleanUpAudio() {
  const used = new Set(), grab = json => { try { const j = JSON.parse(json); for (const c of j.playlist?.clips ?? []) if (c.buf) used.add(c.buf); for (const t of j.tracks) for (const c of t.clips ?? []) used.add(c.buf); } catch { /* skip damaged */ } };
  for (const p of await projects.all()) { grab(p.song); for (const v of p.versions) grab(v.song); }
  for (const json of history.stack) grab(json);
  grab(songJSON());
  const gone = (await audioIds()).filter(id => !used.has(id));
  for (const id of gone) { await delAudio(id); audioBufs.delete(id); }
  toast(gone.length ? `Removed ${gone.length} recording${gone.length === 1 ? '' : 's'} no project uses any more.` : 'Every stored recording is still used by a project.');
}





// ---------- the agent: one pattern becomes a whole song, step by step, as one undo ----------
// Intro, verse, hook, verse, bridge, hook, outro, each a copy of the loop with parts taken out or varied
// the way producers build an arrangement, then a fill into the hook and a balanced mix.
async function songAgent() {
  const src = pat(), bars = src.bars ?? 8, kinds = k => t => k.includes(t.kind), done = [];
  const section = (name, keep) => {
    const id = newPatternId(song);
    song.patterns.push({ id, name, bars, color: PATTERN_COLORS[song.patterns.length % PATTERN_COLORS.length] });
    for (const t of song.tracks) if (t[src.id] && keep(t)) t[id] = structuredClone(t[src.id]);
    return id;
  };
  aiStatus('Writing the sections…');
  const intro = section('Intro', kinds(['chords', 'melody', 'texture', 'fx']));
  const verse = section('Verse', kinds(['drum', 'bass', 'chords', 'texture']));  // no lead: room for a vocal
  const bridge = section('Bridge', t => ['chords', 'melody', 'texture'].includes(t.kind) || t.id === 'hat');
  const outro = section('Outro', kinds(['chords', 'texture']));
  done.push('intro, verse, bridge and outro from the loop');
  try { await varyIn('drums', verse); done.push('new drums for the verse'); } catch { /* offline: the verse keeps the loop's drums */ }
  try { await fillIn(verse); done.push('a fill into the hook'); } catch { /* offline */ }
  aiStatus('Laying out the song…');
  const order = [['Intro', intro], ['Verse', verse], ['Hook', src.id], ['Verse 2', verse], ['Bridge', bridge], ['Hook', src.id], ['Outro', outro]];
  const rows = [...new Set(order.map(([, id]) => id))];
  song.playlist.clips = song.playlist.clips.filter(c => c.type !== 'pattern');
  song.markers = [];
  order.forEach(([name, id], i) => {
    song.playlist.clips.push({ id: clipId(), type: 'pattern', pattern: id, row: rows.indexOf(id), t: i * bars * BAR, d: bars * BAR });
    song.markers.push({ t: i * bars * BAR, name });
  });
  if (src.name !== 'Hook' && !song.patterns.some(p => p !== src && p.name === 'Hook')) src.name = 'Hook';
  done.push(`${order.length} sections, ${order.length * bars} bars`);
  aiStatus('Balancing the mix…');
  try { await autoMix(false); done.push('a balanced mix'); } catch { /* the levels stay as they were */ }
  ui.mode = 'song';
  ui.cursor = 0;
  return done.join(', ');
}

// ---------- the chat: the brain as a side panel that knows the project; every change can be reviewed ----------
const CHAT_IDEAS = ['Make a drill beat at 142 with 808 slides every 2 bars', 'Turn this loop into a full song', 'What key is this in?', 'Half-time the hats on the last beat', 'Check my mix', 'Hum a melody'];
const chatLog = () => (ui.chat ??= []);
function openChat(prefill = '') {
  $('#chat').hidden = false;
  document.documentElement.classList.add('chat-open');
  renderChat();
  const i = $('#chat-in');
  if (prefill) i.value = prefill;
  i.focus();
}
function closeChat() { $('#chat').hidden = true; document.documentElement.classList.remove('chat-open'); }
const toggleChat = () => ($('#chat').hidden ? openChat() : closeChat());
function chatContext() {  // what the brain is looking at, shown above the box
  const bits = [`${STYLES[song.style].name} · ${NOTES[song.root]} ${song.mode} · ${song.bpm} BPM`, pat()?.name ?? ''];
  if (rollSel.size && showing('roll')) bits.push(`${rollSel.size} selected in ${trackName(track(ui.selected))}`);
  return bits.filter(Boolean).map(b => h('span', {}, b));
}
function renderChat() {
  if ($('#chat').hidden) return;
  const log = $('#chat-log'), list = chatLog();
  const welcome = h('div', { class: 'chat-hello' },
    h('b', {}, 'Ask the brain anything about this beat.'),
    h('p', {}, 'It knows your channels, patterns, key and mix. It shows what it changed, and you choose Keep or Undo, or A/B to hear before and after. Type @ to name a channel or pattern. Select notes in the piano roll to change only those.'),
    h('div', { class: 'chat-ideas' }, CHAT_IDEAS.map(x => h('button', { class: 'btn small', onclick: () => sendChat(x) }, x))));
  log.replaceChildren(...(list.length ? list.map(chatEntry) : [welcome]));
  log.scrollTop = log.scrollHeight;
  $('#chat-ctx').replaceChildren(...chatContext());
}
function chatEntry(e) {
  if (e.who === 'you') return h('div', { class: 'msg you' }, e.text);
  const live = e.at != null && !e.state && (history.at === e.at || history.at === e.at - 1);
  return h('div', { class: 'msg brain' },
    e.text ? h('p', {}, e.text) : null,
    e.said?.length ? h('ul', { class: 'said' }, e.said.map(s => h('li', { class: s.startsWith('✗') ? 'no' : '' }, s.replace(/^[✓✗] /, '')))) : null,
    e.diff?.length ? h('div', { class: 'diff' }, h('small', {}, 'What changed'), h('ul', {}, e.diff.map(d => h('li', {}, d)))) : null,
    live ? h('div', { class: 'review' },
      h('button', { class: 'key primary btn', onclick: () => reviewChat(e, 'keep') }, 'Keep'),
      h('button', { class: 'btn', onclick: () => reviewChat(e, 'undo') }, 'Undo'),
      h('button', { class: 'btn', 'aria-pressed': history.at === e.at - 1, title: 'Switch between before and after, even while it plays', onclick: () => reviewChat(e, 'ab') }, history.at === e.at - 1 ? 'Hearing before' : 'A/B')) : null,
    e.state ? h('small', { class: 'state' }, e.state === 'kept' ? 'Kept.' : 'Undone.') : null);
}
function reviewChat(e, what) {
  if (what === 'ab') { if (history.at === e.at) stepHistory(-1); else if (history.at === e.at - 1) stepHistory(1); }
  if (what === 'keep') { if (history.at === e.at - 1) stepHistory(1); e.state = 'kept'; }
  if (what === 'undo') { if (history.at === e.at) stepHistory(-1); e.state = 'undone'; }
  save();
  renderChat();
}
// What a request changed, in words: tempo, key, notes per channel, effects, levels, sounds
function diffSongs(a, b) {
  const out = [], pats = [...new Set([...a.patterns, ...b.patterns].map(p => p.id))];
  if (a.bpm !== b.bpm) out.push(`Tempo ${a.bpm} → ${b.bpm} BPM`);
  if (a.root !== b.root || a.mode !== b.mode) out.push(`Key ${NOTES[a.root]} ${a.mode} → ${NOTES[b.root]} ${b.mode}`);
  if (a.style !== b.style) out.push(`Style ${STYLES[a.style]?.name} → ${STYLES[b.style]?.name}`);
  if (Math.abs((a.swing ?? 0) - (b.swing ?? 0)) > 0.004) out.push(`Swing ${Math.round((a.swing ?? 0) * 200)}% → ${Math.round((b.swing ?? 0) * 200)}%`);
  for (const tb of b.tracks) {
    const ta = a.tracks.find(t => t.id === tb.id), bits = [];
    if (!ta) { out.push(`New channel: ${trackName(tb)}`); continue; }
    let plus = 0, minus = 0;
    for (const p of pats) {
      const na = (ta[p] ?? []).map(n => JSON.stringify(n)), nb = (tb[p] ?? []).map(n => JSON.stringify(n)), sa = new Set(na), sb = new Set(nb);
      plus += nb.filter(x => !sa.has(x)).length;
      minus += na.filter(x => !sb.has(x)).length;
    }
    if (plus || minus) bits.push([plus && `+${plus}`, minus && `−${minus}`].filter(Boolean).join(' ') + ' notes');
    const fa = ta.fx.map(f => f.type), fb = tb.fx.map(f => f.type);
    fb.filter(x => !fa.includes(x)).forEach(x => bits.push(`+ ${EFFECTS[x]?.name ?? x}`));
    fa.filter(x => !fb.includes(x)).forEach(x => bits.push(`− ${EFFECTS[x]?.name ?? x}`));
    if (fa.join() === fb.join() && JSON.stringify(ta.fx) !== JSON.stringify(tb.fx)) bits.push('effect settings');
    const dv = 20 * Math.log10(Math.max(1e-4, tb.vol) / Math.max(1e-4, ta.vol));
    if (Math.abs(dv) >= 0.5) bits.push(`${dv > 0 ? '+' : ''}${dv.toFixed(1)} dB`);
    if (ta.pan !== tb.pan) bits.push('pan');
    if (!!ta.mute !== !!tb.mute) bits.push(tb.mute ? 'muted' : 'unmuted');
    if ((ta.duck ?? 0) !== (tb.duck ?? 0)) bits.push('ducked under the kick');
    if (ta.sound !== tb.sound || ta.inst?.name !== tb.inst?.name) bits.push(`now ${soundLabel(tb)}`);
    if (bits.length) out.push(`${trackName(tb)}: ${bits.join(', ')}`);
  }
  for (const ta of a.tracks) if (!b.tracks.some(t => t.id === ta.id)) out.push(`Removed ${trackName(ta)}`);
  const newPats = b.patterns.filter(p => !a.patterns.some(q => q.id === p.id)).map(p => p.name);
  if (newPats.length) out.push(`New patterns: ${newPats.join(', ')}`);
  if (a.playlist.clips.length !== b.playlist.clips.length || JSON.stringify(a.playlist.clips.map(c => [c.pattern, c.t])) !== JSON.stringify(b.playlist.clips.map(c => [c.pattern, c.t]))) out.push(`Playlist: ${b.playlist.clips.filter(c => c.type === 'pattern').length} pattern clips, ${Math.ceil(songLength(b) / BAR)} bars`);
  if (JSON.stringify(a.master) !== JSON.stringify(b.master)) out.push('Master chain');
  return out;
}
// Questions about the project get answers, not edits
function answerQuestion(q) {
  const t = q.toLowerCase();
  if (!/\?\s*$|^(what|which|how many|how long|how fast|tell me|list|show me|explain)\b/.test(t.trim()) || /\b(make|add|turn|set|change|mute|remove)\b/.test(t)) return null;
  const parts = song.tracks.filter(x => x.kind !== 'bus');
  if (/\b(what can you|help|commands?|what do you)\b/.test(t)) return 'I can make a beat in any of the 12 styles, change the tempo, key or swing, rewrite or vary a part, add slides, rolls and fills, mute, pan or level channels, add any effect (half-time, tape stop, auto-tune and more), balance and check the mix, write down a melody you hum, and export. Select notes in the piano roll and I change only those.';
  if (/\b(key|scale)\b/.test(t)) return `${NOTES[song.root]} ${song.mode}. The notes in key are ${songScale(song).sort((x, y) => (x - song.root + 12) % 12 - (y - song.root + 12) % 12).map(p => NOTES[p]).join(', ')}.`;  // from the tonic
  if (/\b(tempo|bpm|how fast|speed)\b/.test(t)) return `${song.bpm} BPM, with ${Math.round((song.swing ?? 0) * 200)}% swing.`;
  if (/\b(style|genre)\b/.test(t)) return `${STYLES[song.style].name}, which usually sits between ${STYLES[song.style].bpm?.join?.(' and ') ?? 'its usual tempos'} BPM.`;
  if (/\b(chords?|progression)\b/.test(t)) return `In ${pat().name}: ${[...new Set(song.harmony.filter(c => c.t < barsOf(ui.pattern) * BAR).map(c => c.name))].join(', ')}.`;
  if (/\b(patterns?|sections?|structure|arrangement|how long|length)\b/.test(t)) return `${song.patterns.length} patterns: ${song.patterns.map(p => p.name).join(', ')}. The whole song is ${Math.ceil(songLength(song) / BAR)} bars, about ${clock(songLength(song) * spt())}.`;
  if (/\b(channels?|tracks?|sounds?|instruments?|parts?)\b/.test(t)) return `${parts.length} channels: ${parts.map(x => `${trackName(x)} (${soundLabel(x)}${x.mute ? ', muted' : ''})`).join(', ')}.`;
  if (/\b(effects?|plugins?)\b/.test(t)) { const on = parts.filter(x => x.fx.length); return on.length ? on.map(x => `${trackName(x)}: ${x.fx.map(f => EFFECTS[f.type]?.name ?? f.type).join(', ')}`).join('. ') + '.' : 'No insert effects yet. Try "add reverb to the snare".'; }
  return null;
}
// Selected notes in the piano roll: the request changes only those (like editing a selection in code)
function selectionEdit(q) {
  if (!rollSel.size || !showing('roll')) return null;
  const t = track(ui.selected), f = editable(t), list = [...rollSel], s = q.toLowerCase();
  const semis = /octave/.test(s) ? 12 : +(s.match(/\b(\d{1,2})\b/)?.[1] ?? 0) || (/semitone|half step/.test(s) ? 1 : /whole step/.test(s) ? 2 : 0);
  let out = null, what = '';
  if (/\b(up|down|higher|lower|raise|drop|transpose)\b/.test(s) && semis && !/\b(louder|quieter|softer)\b/.test(s)) { const d = (/\b(down|lower|drop)\b/.test(s) ? -1 : 1) * semis; out = list.map(n => ({ ...n, p: clamp(n.p + d, 0, 127) })); what = `moved ${d > 0 ? 'up' : 'down'} ${Math.abs(d) === 12 ? 'an octave' : `${Math.abs(d)} semitone${Math.abs(d) > 1 ? 's' : ''}`}`; }
  else if (/\bhumani[sz]e|loosen|human\b/.test(s)) { out = humanize(list, Math.random); what = 'humanized'; }
  else if (/\bquantize|tighten|on the grid|snap\b/.test(s)) { out = quantize(list, rollGrid()); what = 'quantized'; }
  else if (/\b(louder|harder|softer|quieter)\b/.test(s)) { const d = /louder|harder/.test(s) ? 18 : -18; out = list.map(n => ({ ...n, v: clamp(n.v + d, 20, 127) })); what = d > 0 ? 'louder' : 'softer'; }
  else if (/\b(shorter|staccato|choppy)\b/.test(s)) { out = list.map(n => ({ ...n, d: Math.max(STEP / 2, Math.round(n.d / 2)) })); what = 'shorter'; }
  else if (/\b(longer|legato|connect|smooth)\b/.test(s)) { const sorted = [...list].sort((a, b) => a.t - b.t); out = list.map(n => { const next = sorted.find(m => m.t > n.t); return { ...n, d: next ? next.t - n.t : n.d * 2 }; }); what = 'made legato'; }
  else if (/\b(reverse|backwards)\b/.test(s)) { const a = Math.min(...list.map(n => n.t)), b = Math.max(...list.map(n => n.t + n.d)); out = list.map(n => ({ ...n, t: a + b - n.t - n.d })); what = 'reversed'; }
  else if (/\b(delete|remove|clear)\b/.test(s)) { t[f] = t[f].filter(n => !rollSel.has(n)); rollSel.clear(); changed(); return `Deleted ${list.length} notes.`; }
  if (!out) return null;
  const map = new Map(list.map((n, i) => [n, out[i]]));
  t[f] = tidy(t[f].map(n => map.get(n) ?? n));
  rollSel = new Set(out.filter(n => t[f].includes(n)));
  changed();
  return `${list.length} selected note${list.length > 1 ? 's' : ''} in ${trackName(t)} ${what}.`;
}
async function sendChat(text) {
  text = text.trim();
  if (!text) return;
  $('#chat-in').value = '';
  const log = chatLog();
  log.push({ who: 'you', text });
  const before = songJSON(), answer = answerQuestion(text), sel = answer ? null : selectionEdit(text);
  if (sel) commit(songJSON());  // into the undo history now, so Keep, Undo and A/B point at this change
  if (answer || sel) log.push({ who: 'brain', text: answer ?? sel, ...(sel && before !== songJSON() ? { diff: diffSongs(JSON.parse(before), song), at: history.at } : {}) });
  else {
    renderChat();
    $('#chat-send').disabled = true;
    const r = await runBrain(text, { quiet: true });
    $('#chat-send').disabled = false;
    const after = songJSON();
    if (before !== after) commit(after);  // the history usually catches up a moment later; Keep, Undo and A/B need it now
    log.push(r ? { who: 'brain', said: r.said, diff: before === after ? [] : diffSongs(JSON.parse(before), JSON.parse(after)), at: before === after ? null : history.at } : { who: 'brain', text: 'I’m still busy with the last request. Try again in a moment.' });
  }
  log.splice(0, Math.max(0, log.length - 40));
  save();
  renderChat();
}
function mentionMenu() {  // @ lists the channels and patterns to name
  const i = $('#chat-in');
  menu(i, [{ heading: 'Channels' }, ...song.tracks.filter(t => t.kind !== 'bus').map(t => ({ label: trackName(t), onSelect: () => insertMention(trackName(t)) })),
    '-', { heading: 'Patterns' }, ...song.patterns.map(p => ({ label: p.name, onSelect: () => insertMention(`the ${p.name.toLowerCase()}`) }))]);
}
function insertMention(word) {
  const i = $('#chat-in'), at = i.value.lastIndexOf('@');
  i.value = `${at >= 0 ? i.value.slice(0, at) : i.value}${word} `;
  i.focus();
}
function initChat() {
  $('#chat-close').addEventListener('click', closeChat);
  $('#chat-form').addEventListener('submit', e => { e.preventDefault(); sendChat($('#chat-in').value); });
  $('#chat-in').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat($('#chat-in').value); }
    if (e.key === 'Escape') closeChat();
  });
  $('#chat-in').addEventListener('input', e => { if (e.data === '@') mentionMenu(); });
  $('#chat-btn').replaceChildren(icon('brain', 16), h('span', {}, 'Chat'));
  $('#chat-btn').addEventListener('click', toggleChat);
}

// ---------- autocomplete: write a few notes or steps, pause, and the AI suggests what comes next ----------
// Like code completion: the suggestion shows faintly, Tab (or Keep) adds it, Esc drops it, and any edit
// asks again. Lines come from the melody model, drums from the drum model (brain.js), both in this browser.
let suggestion = null, suggestTimer = 0, dropped = '';
const autocompleteOn = () => ui.autocomplete !== false;
const lineSig = (t, pid) => `${t.id}|${pid}|${JSON.stringify(t[pid] ?? [])}`;
const drumSig = pid => `drums|${pid}|${JSON.stringify(song.tracks.filter(t => t.kind === 'drum').map(t => t[pid] ?? []))}`;
function suggestSoon() {
  clearTimeout(suggestTimer);
  if (suggestion) { suggestion = null; showSuggestion(); }
  if (!autocompleteOn() || batching || rec) return;
  suggestTimer = setTimeout(() => suggestNext().catch(e => aiStatus(`Autocomplete stopped: ${e.message}`)), 900);
}
async function suggestNext() {
  if (busy || suggestion) return;
  const pid = ui.pattern, len = barsOf(pid) * 16;
  if (showing('roll')) {
    const t = track(ui.selected);
    if (!t || !['melody', 'bass'].includes(t.kind) || !(t[pid] ?? []).length) return;
    const sig = lineSig(t, pid), from = Math.ceil(Math.max(...t[pid].map(n => n.t + n.d)) / STEP), steps = Math.min(32, len - from);
    if (sig === dropped || steps < 4) return;
    const [lo, hi] = PIANO_RANGE[t.kind];
    aiStatus('Listening for what comes next…');
    const notes = await aiContinueLine(song, t[pid], from, steps, { lo, hi }, aiStatus);
    aiStatus('');
    if (notes.length && lineSig(t, pid) === sig && showing('roll') && ui.selected === t.id) { suggestion = { where: 'roll', track: t.id, pattern: pid, notes, sig }; showSuggestion(); }
  } else if (showing('rack')) {
    const drums = song.tracks.filter(t => t.kind === 'drum'), bar = ui.bar ?? 0, lit = drums.flatMap(t => (t[pid] ?? []).map(n => Math.round(n.t / STEP))).filter(s => s >= bar * 16 && s < bar * 16 + 16);
    if (!lit.length) return;
    const sig = drumSig(pid), from = Math.max(...lit) + 1, steps = bar * 16 + 16 - from;  // the rest of the bar being written
    if (sig === dropped || steps < 2) return;
    aiStatus('Listening for what comes next…');
    const parts = await aiContinueDrums(song, pid, from, steps, aiStatus);
    aiStatus('');
    for (const [id, list] of Object.entries(parts)) if (!track(id) || track(id).mute) delete parts[id];
    if (Object.values(parts).some(l => l.length) && drumSig(pid) === sig && showing('rack')) { suggestion = { where: 'rack', pattern: pid, bar, parts, sig }; showSuggestion(); }
  }
}
function showSuggestion() {
  const s = suggestion, n = !s ? 0 : s.where === 'roll' ? s.notes.length : Object.values(s.parts).reduce((a, l) => a + l.length, 0);
  $('#suggest').hidden = !s;
  if (s) $('#suggest b').textContent = `${n} suggested ${s.where === 'roll' ? (n === 1 ? 'note' : 'notes') : (n === 1 ? 'hit' : 'hits')}`;
  V.roll.redraw?.();
  for (const el of V.rack.body.querySelectorAll('.step.ghost')) el.classList.remove('ghost');
  if (s?.where === 'rack' && s.pattern === ui.pattern && s.bar === (ui.bar ?? 0)) {
    for (const [id, list] of Object.entries(s.parts)) {
      const cells = V.rack.body.querySelectorAll(`.ch[data-ch="${id}"] .step`);
      for (const h of list) cells[Math.round(h.t / STEP) - s.bar * 16]?.classList.add('ghost');
    }
  }
}
function keepSuggestion() {
  const s = suggestion;
  if (!s) return;
  suggestion = null;
  if (s.where === 'roll') { const t = track(s.track); t[s.pattern] = tidy([...(t[s.pattern] ?? []), ...s.notes]); }
  else for (const [id, list] of Object.entries(s.parts)) { const t = track(id); t[s.pattern] = [...(t[s.pattern] ?? []), ...list].sort((a, b) => a.t - b.t); }
  hint('Kept the suggestion. Ctrl+Z takes it back; keep writing and the next one comes.');
  if (s.where === 'rack') stepsChanged(); else changed();
}
function dropSuggestion() {
  if (!suggestion) return;
  dropped = suggestion.sig;  // not asked again until something changes
  suggestion = null;
  showSuggestion();
}
function toggleAutocomplete() {
  ui.autocomplete = !autocompleteOn();
  save();
  if (!ui.autocomplete) dropSuggestion(); else suggestSoon();
  renderView();
  toast(ui.autocomplete ? 'Autocomplete on: write a few notes or steps and pause. The AI suggests what comes next; Tab keeps it, Esc drops it.' : 'Autocomplete off.');
}
const suggestBtn = () => h('button', { class: 'btn small', 'aria-pressed': autocompleteOn(), title: 'Autocomplete: after you write, the AI suggests what comes next. Tab keeps it, Esc drops it', onclick: toggleAutocomplete }, icon('brain', 14), 'Suggest');

// ---------- phones: Song, Beat, Keys and Mix are the screen's views; Make is the Brain, quick actions and pads ----------
const PHONE_TABS = [['arrange', 'playlist', 'Song'], ['rack', 'rack', 'Beat'], ['roll', 'piano', 'Keys'], ['mixer', 'mixer', 'Mix'], ['make', 'brain', 'Make']];
function markPhoneTab() {
  const tab = ui.pview === 'make' ? 'make' : ui.view, lit = ['master', 'sounds', 'listen'].includes(tab) ? 'make' : tab;  // those open from Make
  document.documentElement.dataset.pview = tab;
  for (const b of document.querySelectorAll('#tabbar button')) b.setAttribute('aria-current', b.dataset.tab === lit ? 'page' : 'false');
}
function phoneTab(tab) {
  if (tab !== 'make') return showView(tab);
  ui.pview = 'make';
  save();
  markPhoneTab();
}
function applyPhone() {
  phone = PHONE.matches;
  document.documentElement.classList.toggle('phone', phone);
  if (phone && ui.layout === 'daw') { ui.layout = 'rig'; save(); applyLayout(); }
  else renderView();
}
function moreMenu() {
  menu($('#more'), [
    { label: 'Projects', icon: 'folder', onSelect: () => $('#project').click() },
    { label: 'Find any action', icon: 'search', onSelect: openPalette },
    { label: 'Redo', icon: 'redo', onSelect: () => stepHistory(1) },
    { label: `Metronome ${ui.metro ? 'off' : 'on'}`, icon: 'metro', onSelect: toggleMetro },
    { label: 'Audio and MIDI settings', icon: 'midi', onSelect: settingsDialog },
    { label: 'Dark or white studio', icon: 'sun', onSelect: () => $('#theme').click() },
    { label: 'Shortcuts and help', icon: 'help', onSelect: openHelp },
    { label: 'BeatLab docs', icon: 'help', onSelect: () => window.open('docs.html', '_blank', 'noopener') },
  ]);
}
function initPhone() {
  $('#tabbar').replaceChildren(...PHONE_TABS.map(([tab, ic, label]) => h('button', { 'data-tab': tab, onclick: () => phoneTab(tab) }, icon(ic, 22), h('span', {}, label))));
  $('#quick-grid').replaceChildren(...[
    ['brain', 'Ask the brain', () => openChat()], ['mic', 'Hum it', startHum], ['brain', 'Mix doctor', () => withBusy(() => mixDoctor())], ['mixer', 'Auto mix', () => withBusy(() => autoMix())],
    ['sounds', 'Sounds', () => showView('sounds')], ['listen', 'Listen', () => showView('listen')], ['master', 'Master', () => showView('master')], ['export', 'Export', () => openExport()],
  ].map(([ic, label, run]) => h('button', { class: 'btn', onclick: run }, icon(ic, 18), label)));
  $('#more').replaceChildren(icon('more', 18));
  $('#more').addEventListener('click', moreMenu);
  PHONE.addEventListener('change', applyPhone);
  document.documentElement.classList.toggle('phone', phone);
  markPhoneTab();
}

// ---------- help, command palette, keys, MIDI ----------
function openHelp() {
  openDialog({ title: 'Shortcuts and help', glyph: 'help', body: [
    h('p', { class: 'note' }, 'Everything about BeatLab, from your first beat to every plugin, is in ', h('a', { href: 'docs.html', target: '_blank', rel: 'noopener' }, 'the docs'), '.'),
    h('div', { class: 'help-grid' }, SHORTCUTS.map(([k, d]) => h('div', {}, h('kbd', {}, k), h('span', {}, d)))),
    h('div', { class: 'sect' }, 'How it fits together'),
    h('p', { class: 'note', style: 'font-size:13px;line-height:1.6' }, 'It works like FL Studio. Pick a pattern at the top, program it in the channel rack (F6) or the piano roll (F7), then paint it onto the playlist (F5) with the draw or paint tool. L switches between playing the pattern and the whole song. The Brain makes a full beat as named patterns already on the playlist. Mix in the mixer (F9), check loudness in Master, record your microphone onto an audio channel in Song mode, and export MIDI, WAV and MP3 for FL Studio. View > DAW layout gives you floating windows instead of one screen. Everything autosaves into the project named top left, and Ctrl+Z undoes any change.'),
  ] });
}
function commands() {
  const v = Object.entries(VIEWS).map(([id, [ic, name, key]]) => ({ group: 'Go to', label: name, icon: ic, keys: key, run: () => showView(id) }));
  const tr = song.tracks.flatMap(t => [
    { group: 'Channels', label: `${t.mute ? 'Unmute' : 'Mute'} ${trackName(t)}`, icon: 'mixer', run: () => { t.mute = !t.mute; mixChanged(); renderView(); } },
    { group: 'Channels', label: `Solo ${trackName(t)}`, icon: 'mixer', run: () => { t.solo = !t.solo; mixChanged(); renderView(); } },
    { group: 'Channels', label: `${trackName(t)} settings`, icon: 'knob', run: () => { select(t.id); openPlugin(t.id); } },
  ]);
  return [
    { group: 'Transport', label: 'Play or stop', icon: 'play', keys: 'Space', run: () => togglePlay() },
    { group: 'Transport', label: 'Record', icon: 'rec', keys: 'R', run: toggleRecord },
    { group: 'Transport', label: `Metronome ${ui.metro ? 'off' : 'on'}`, icon: 'metro', keys: 'M', run: toggleMetro },
    { group: 'Transport', label: 'Song mode', icon: 'playlist', run: () => setMode('song') },
    { group: 'Transport', label: 'Pattern mode', icon: 'rack', run: () => setMode('pattern') },
    ...song.patterns.map((p, i) => ({ group: 'Patterns', label: `Pattern ${i + 1}: ${p.name}`, icon: 'rack', run: () => setPattern(p.id) })),
    { group: 'Patterns', label: 'New pattern', icon: 'plus', keys: 'F4', run: () => newPattern() },
    { group: 'Patterns', label: 'Clone pattern', icon: 'copy', keys: 'Ctrl+Shift+C', run: () => newPattern(true) },
    { group: 'Studio', label: 'Rig layout', icon: 'panel', run: () => setLayout('rig') },
    { group: 'Studio', label: 'DAW layout, floating windows', icon: 'playlist', run: () => setLayout('daw') },
    { group: 'Studio', label: 'Audio and MIDI settings', icon: 'midi', keys: 'F10', run: settingsDialog },
    { group: 'Edit', label: 'Undo', icon: 'undo', keys: 'Ctrl+Z', run: () => stepHistory(-1) },
    { group: 'Edit', label: 'Redo', icon: 'redo', keys: 'Ctrl+Y', run: () => stepHistory(1) },
    { group: 'Edit', label: 'Add a channel or audio track', icon: 'plus', run: () => addTrackMenu($('#cmd')) },
    { group: 'Edit', label: 'Import audio files', icon: 'upload', run: () => pickAudioFile() },
    { group: 'Brain', label: 'Make a beat', icon: 'brain', run: () => make() },
    ...['drums', 'chords', 'bass', 'melody'].map(p => ({ group: 'Brain', label: `New ${p}`, icon: 'dice', run: () => setSong(regenerate(song, p), `New ${p}. Ctrl+Z undoes it.`) })),
    { group: 'Brain', label: 'AI melody', icon: 'brain', run: aiMelodyButton },
    { group: 'Brain', label: 'AI drums', icon: 'brain', run: aiDrumsButton },
    { group: 'Brain', label: 'Humanize the drums', icon: 'brain', run: aiHumanizeButton },
    { group: 'Brain', label: 'Hum a melody into the piano roll', icon: 'mic', run: startHum },
    { group: 'Brain', label: 'Check the mix (mix doctor)', icon: 'brain', run: () => withBusy(() => mixDoctor()) },
    { group: 'Brain', label: 'Balance the mix (auto mix)', icon: 'mixer', run: () => withBusy(() => autoMix()) },
    { group: 'Brain', label: `Smart brain ${ui.smart ? 'off' : 'on'} (a free AI model on this computer)`, icon: 'brain', run: toggleSmart },
    { group: 'Brain', label: 'Vary the drums', icon: 'brain', run: () => aiVaryButton('drums') },
    { group: 'Brain', label: 'Vary the melody', icon: 'brain', run: () => aiVaryButton('melody') },
    { group: 'Brain', label: 'Drum fill in the last bar', icon: 'brain', run: aiFillButton },
    ...flKit.map(k => ({ group: 'Sounds', label: `${k.name} drum kit`, icon: 'pads', run: () => loadKit(k) })),
    ...flInst.map(i => ({ group: 'Sounds', label: `${i.name} on the selected channel`, icon: 'piano', run: () => { const t = track(ui.selected); if (!t || t.kind === 'drum' || t.kind === 'audio') return toast('Select an instrument channel first.'); loadInstrument(t, i).then(() => { changed(); audition(t, 60); }, e => toast(`Couldn't load ${i.name}: ${e.message}`)); } })),
    ...STYLE_IDS.map(id => ({ group: 'Styles', label: `Make a ${STYLES[id].name} beat`, icon: 'brain', run: () => { chooseStyle(id); make({ style: id }); } })),
    { group: 'Project', label: 'Save a version', icon: 'save', keys: 'Ctrl+S', run: quickVersion },
    { group: 'Project', label: 'Versions', icon: 'history', run: versionDialog },
    { group: 'Project', label: 'Open a project', icon: 'folder', run: projectsDialog },
    { group: 'Project', label: 'New project', icon: 'plus', run: newProject },
    { group: 'Project', label: 'Project info', icon: 'info', run: infoDialog },
    { group: 'Project', label: 'Save as a project file', icon: 'export', run: exportProjectFile },
    { group: 'Project', label: 'Open a project file', icon: 'upload', run: importProjectFile },
    { group: 'Project', label: 'Clean up unused audio', icon: 'trash', run: cleanUpAudio },
    { group: 'Project', label: 'Export to FL Studio', icon: 'export', keys: 'Ctrl+E', run: openExport },
    ...v, ...tr,
    { group: 'Studio', label: 'Dark or white studio', icon: 'sun', run: () => $('#theme').click() },
    { group: 'Studio', label: `${ui.devices ? 'Hide' : 'Show'} the devices`, icon: 'panel', run: () => $('#devices-toggle').click() },
    { group: 'Studio', label: `Computer keyboard piano ${ui.typing ? 'off' : 'on'}`, icon: 'keyboard', run: toggleTyping },
    { group: 'Studio', label: 'Connect a MIDI keyboard', icon: 'midi', run: startMidi },
    { group: 'Studio', label: 'Shortcuts and help', icon: 'help', keys: 'F1', run: openHelp },
    { group: 'Brain', label: `Autocomplete ${autocompleteOn() ? 'off' : 'on'} (the AI suggests what comes next)`, icon: 'brain', run: toggleAutocomplete },
    { group: 'Brain', label: 'Chat with the brain', icon: 'brain', keys: 'Ctrl+I', run: () => openChat() },
    { group: 'Studio', label: 'Read the BeatLab docs', icon: 'help', run: () => window.open('docs.html', '_blank', 'noopener') },
    { group: 'Studio', label: 'Go to the home page', icon: 'left', run: () => { location.href = '/'; } },
  ];
}
// Typed commands: "tempo 140", "key g minor", "mute hats", "louder 808", "swing 30", "transpose 2",
// "add reverb to chords", "make a trap beat". Each one goes through the normal edit path, so Ctrl+Z undoes it.
const findTrack = name => song.tracks.find(t => trackName(t).toLowerCase() === name) ?? song.tracks.find(t => trackName(t).toLowerCase().includes(name) || t.id.includes(name));
function parseCommand(q) {
  let m;
  if ((m = q.match(/^(?:set )?(?:tempo|bpm)(?: to)? (\d{2,3})$/) ?? q.match(/^(\d{2,3}) ?bpm$/))) return { label: `Set the tempo to ${m[1]} BPM`, icon: 'metro', run: () => { setBpm(+m[1], true); hint(`Tempo ${song.bpm} BPM.`); } };
  if ((m = q.match(/^(?:key |in )?([a-g])(#|b|sharp|flat)? ?(major|minor|maj|min|m)$/))) {
    const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1]], acc = /#|sharp/.test(m[2] ?? '') ? 1 : /b|flat/.test(m[2] ?? '') ? -1 : 0, root = (base + acc + 12) % 12, mode = /^(major|maj)$/.test(m[3]) ? 'major' : 'minor';
    return { label: `Change the key to ${NOTES[root]} ${mode}`, icon: 'piano', run: () => setKey(root, mode) };
  }
  if ((m = q.match(/^(mute|unmute|solo|unsolo) (.+)$/))) {
    const t = findTrack(m[2]);
    if (t) return { label: `${m[1][0].toUpperCase()}${m[1].slice(1)} ${trackName(t)}`, icon: 'mixer', run: () => { if (m[1].endsWith('mute')) t.mute = m[1] === 'mute'; else t.solo = m[1] === 'solo'; mixChanged(); renderView(); hint(`${trackName(t)} ${m[1]}d.`); } };
  }
  if ((m = q.match(/^(louder|quieter|turn up|turn down|raise|lower) (?:the )?(.+?)(?: by (\d+) ?db)?$/))) {
    const t = findTrack(m[2]), up = /louder|up|raise/.test(m[1]), dB = +(m[3] ?? 3);
    if (t) return { label: `${up ? 'Turn up' : 'Turn down'} ${trackName(t)} by ${dB} dB`, icon: 'mixer', run: () => { t.vol = clamp(t.vol * 10 ** ((up ? dB : -dB) / 20), 0, 1.2); mixChanged(); renderView(); hint(`${trackName(t)} volume ${Math.round(t.vol * 100)}%.`); } };
  }
  if ((m = q.match(/^swing (\d{1,3}) ?%?$/))) return { label: `Set swing to ${clamp(+m[1], 0, 100)}%`, icon: 'metro', run: () => { song.swing = clamp(+m[1], 0, 100) / 200; toolbarKnobs(); changed(); } };
  if ((m = q.match(/^transpose ([+-]?\d{1,2})$/))) return { label: `Transpose ${+m[1] > 0 ? 'up' : 'down'} ${Math.abs(+m[1])} semitones`, icon: 'piano', run: () => { song = transpose(song, ((song.root + +m[1]) % 12 + 12) % 12); changed(); } };
  if ((m = q.match(/^(?:add|put) (?:an? )?(.+?) (?:on|to) (?:the )?(.+)$/))) {
    const fx = Object.entries(EFFECTS).find(([k, f]) => f.name.toLowerCase() === m[1] || k === m[1] || f.name.toLowerCase().startsWith(m[1])), t = findTrack(m[2]);
    if (fx && t) return { label: `Add ${fx[1].name} to ${trackName(t)}`, icon: 'plus', run: () => { if (t.fx.length >= 8) return toast(`${trackName(t)} already has 8 effects.`); t.fx.push({ type: fx[0] }); mixChanged(); renderView(); openPlugin(t.id); } };
  }
  if ((m = q.match(/^(?:pattern|edit|go to) (.+)$/))) {
    const p = song.patterns[+m[1] - 1] ?? song.patterns.find(x => x.name.toLowerCase() === m[1]) ?? song.patterns.find(x => x.name.toLowerCase().startsWith(m[1]));
    if (p) return { label: `Edit pattern ${song.patterns.indexOf(p) + 1}, ${p.name}`, icon: 'rack', run: () => setPattern(p.id) };
  }
  if (q === 'new pattern') return { label: 'New pattern', icon: 'plus', run: () => newPattern() };
  if ((m = q.match(/^make (?:a |an )?(.+?)(?: beat)?$/))) {
    const id = STYLE_IDS.find(s => STYLES[s].name.toLowerCase() === m[1] || s === m[1] || STYLES[s].name.toLowerCase().startsWith(m[1]));
    if (id) return { label: `Make a ${STYLES[id].name} beat`, icon: 'brain', run: () => { chooseStyle(id); make({ style: id }); } };
  }
  return null;
}
const openPalette = () => palette({ items: commands(), parse: q => parseCommand(q) ?? brainItem(q), placeholder: 'Find an action, or tell the brain what to do, like "darker chords and 808 slides every 4 bars"' });

function toggleTyping() {
  ui.typing = !ui.typing;
  $('#typing').setAttribute('aria-pressed', ui.typing);
  save();
  toast(ui.typing ? 'The computer keyboard plays notes on the selected channel: Z to M and Q to U, with - and = for octaves. Letter shortcuts are off until you turn it off.' : 'Computer keyboard piano off.');
}
async function startMidi() {
  if (!navigator.requestMIDIAccess) return toast('This browser has no MIDI support. Chrome and Edge have it.');
  try {
    await connectMidi({
      noteOn: (p, v) => noteOn(p, v, 'midi'), noteOff,
      devices: names => {
        $('#midi-state').textContent = names.length ? `MIDI: ${names.join(', ')}` : 'MIDI on, no device plugged in';
        $('#midi-state').classList.toggle('on', names.length > 0);
        $('#midi').setAttribute('aria-pressed', names.length > 0);
      },
    });
    toast('MIDI is on. Keys play the selected channel; on a drum channel, pad controllers hit kick, snare and hats by their General MIDI notes. Devices you plug in later connect by themselves.');
  } catch (e) { toast(`MIDI didn't start: ${e.message}`); }
}
const typingHeld = new Map();
const focused = () => (ui.layout === 'daw' ? ui.focus : ui.view);  // the editor that shortcuts act on
function playlistKeys(e) {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (mod && k === 'a') { plSel = new Set(song.playlist.clips.map(c => c.id)); e.preventDefault(); drawPlaylist(); return true; }
  if (mod && k === 'b') { e.preventDefault(); return duplicateClips(); }
  if ((e.key === 'Delete' || e.key === 'Backspace') && plSel.size) { e.preventDefault(); deleteClips([...plSel]); return true; }
  if (e.key === 'Escape' && plSel.size) { plSel.clear(); drawPlaylist(); return true; }
  return false;
}
function editKey(key) {  // the Edit menu sends the same keys the editors answer to
  const e = { key, ctrlKey: key !== 'Delete', metaKey: false, shiftKey: false, altKey: false, preventDefault() {}, target: document.body };
  return focused() === 'roll' ? rollKeys(e) : playlistKeys(e);
}
const TOOL_KEYS = { p: 'draw', b: 'paint', d: 'erase', t: 'mute', c: 'slice', e: 'select' };
function keys(e) {
  if (e.target.closest?.('input, select, textarea, [contenteditable]')) return;
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), ed = focused();
  if (suggestion && e.key === 'Tab' && !mod && !e.altKey) { e.preventDefault(); return keepSuggestion(); }
  if (suggestion && e.key === 'Escape') { e.preventDefault(); return dropSuggestion(); }
  if (mod && k === 'k') { e.preventDefault(); return openPalette(); }
  if (mod && k === 'i') { e.preventDefault(); return toggleChat(); }
  if (mod && k === 'z') { e.preventDefault(); return stepHistory(e.shiftKey ? 1 : -1); }
  if (mod && k === 'y') { e.preventDefault(); return stepHistory(1); }
  if (mod && k === 's') { e.preventDefault(); return quickVersion(); }
  if ((mod || e.altKey) && k === 'n') { e.preventDefault(); return versionDialog(); }  // Chrome keeps Ctrl+N and Ctrl+T, so Alt works too
  if (mod && k === 'o') { e.preventDefault(); return projectsDialog(); }
  if (mod && e.shiftKey && k === 'm') { e.preventDefault(); return openExport({ mix: false, stems: false }); }
  if (mod && k === 'r') { e.preventDefault(); return openExport(e.shiftKey ? { mp3: true } : {}); }
  if (mod && k === 'e') { e.preventDefault(); return openExport(); }
  if ((mod || e.altKey) && k === 't') { e.preventDefault(); return toggleTyping(); }
  if (mod && e.shiftKey && k === 'c') { e.preventDefault(); return newPattern(true); }
  if (document.querySelector('dialog[open], .palette')) return;
  const F = { F1: openHelp, F2: () => renamePattern(), F4: () => newPattern(), F10: settingsDialog, F11: infoDialog, F12: closeAllWins };
  if (F[e.key]) { e.preventDefault(); return F[e.key](); }
  const fv = { F5: 'arrange', F6: 'rack', F7: 'roll', F8: 'sounds', F9: 'mixer' }[e.key];
  if (fv) { e.preventDefault(); return showView(fv); }
  if (e.code === 'Space') { e.preventDefault(); return togglePlay(); }  // even with a button focused, Space is play, as in FL
  if (e.code === 'NumpadAdd' || e.code === 'NumpadSubtract') { e.preventDefault(); return nextPattern(e.code === 'NumpadAdd' ? 1 : -1); }
  if (ed === 'roll' && rollKeys(e)) return;
  if (ed === 'arrange' && playlistKeys(e)) return;
  if (ed === 'rack' && !mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    const list = song.tracks.filter(t => t.kind !== 'audio'), i = list.findIndex(t => t.id === ui.selected);
    e.preventDefault();
    return select(list[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, list.length - 1)].id);
  }
  if (e.altKey && e.key === 'Delete') { const t = track(ui.selected); if (t && song.tracks.length > 1) deleteTrack(t); return; }
  if (ui.typing && !mod && !e.altKey) {
    if (k === '-' || k === '=') { ui.octave = clamp(ui.octave + (k === '=' ? 1 : -1), 1, 7); hint(`Computer keyboard octave ${ui.octave}.`); return; }
    const p = typingNote(k, ui.octave);
    if (p != null) { e.preventDefault(); if (!e.repeat && !typingHeld.has(k)) { typingHeld.set(k, p); noteOn(p, 100, 'keys'); } return; }
  }
  if (!mod && !e.altKey && !ui.typing) {
    if (k === 'r') return toggleRecord();
    if (k === 'm') return toggleMetro();
    if (k === 'l') return setMode(ui.mode === 'song' ? 'pattern' : 'song');
    if (TOOL_KEYS[k] && (ed === 'arrange' || ed === 'roll')) return setTool(TOOL_KEYS[k], ed);
  }
  if (e.key === 'Escape' && !document.querySelector('.menu')) closePlugin();
}
// Piano keys you can play with the mouse: press one, slide across the others, let go to stop
function playable(el, getTrack) {
  let downP = null;
  const on = p => { if (downP === p) return; off(); downP = p; noteOn(p, 100, 'mouse', getTrack()); };
  const off = () => { if (downP == null) return; noteOff(downP); downP = null; };
  el.addEventListener('pointerdown', e => {
    const k = e.target.closest('[data-p]');
    if (!k || e.button !== 0) return;
    e.preventDefault();
    on(+k.dataset.p);
    const move = ev => { const t = document.elementFromPoint(ev.clientX, ev.clientY)?.closest('[data-p]'); if (t && el.contains(t)) on(+t.dataset.p); };
    const up = () => { off(); removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
  });
}
function lightKey(p, on) { for (const el of document.querySelectorAll(`.keys [data-p="${p}"], .kb [data-p="${p}"]`)) el.classList.toggle('down', on); }
function keyboard(t) {  // two octaves to play the channel with the mouse
  const base = t.kind === 'bass' ? 36 : 60, kb = h('div', { class: 'kb', 'aria-label': `${trackName(t)} keyboard` });
  let wi = 0;
  for (let p = base; p <= base + 24; p++) {
    if (NOTES[p % 12].includes('#')) kb.append(h('div', { class: 'kb-b', 'data-p': p, style: `left:calc(${wi * 100 / 15}% - 2.1%)`, title: noteName(p) }));
    else { kb.append(h('div', { class: 'kb-w', 'data-p': p, title: noteName(p) }, p % 12 === 0 ? noteName(p) : '')); wi++; }
  }
  playable(kb, () => t);
  return kb;
}
function settingsDialog() {
  const lat = ctx ? Math.round(((ctx.baseLatency || 0) + (ctx.outputLatency || 0)) * 1000) : null;
  openDialog({ title: 'Audio and MIDI settings', glyph: 'midi', wide: false, body: [
    h('div', { class: 'sect' }, 'Audio'),
    h('p', { class: 'note' }, ctx ? `${ctx.sampleRate / 1000} kHz, about ${lat} ms output latency. The browser plays through Windows' default output; change it in Windows sound settings.` : 'Audio starts on your first click.'),
    h('div', { style: 'display:grid;gap:10px' },
      toggle({ label: 'Metronome', checked: ui.metro, onChange: () => toggleMetro() }),
      toggle({ label: 'Count in one bar before recording', checked: ui.countIn !== false, onChange: v => { ui.countIn = v; save(); } }),
      toggle({ label: 'Hear the microphone while recording', checked: ui.monitor, onChange: v => { ui.monitor = v; setMonitor(v); save(); } })),
    h('label', { class: 'field', style: 'margin-top:12px' }, 'Audio buffer',
      picker({ label: 'Audio buffer', value: ui.latency ?? 'interactive', options: [['interactive', 'Small: fastest response'], ['balanced', 'Medium: if you hear clicks'], ['playback', 'Large: never crackles, keys feel later']].map(([value, label]) => ({ value, label })),
        onChange: v => { ui.latency = v; save(); if (ctx) { toast('The new buffer size takes over when BeatLab reloads.'); setTimeout(() => location.reload(), 900); } } })),
    h('label', { class: 'field', style: 'margin-top:12px' }, 'Recording offset in milliseconds, to move takes earlier (negative) or later', h('input', { type: 'number', value: ui.recOffset, step: 1, onchange: e => { ui.recOffset = +e.target.value || 0; save(); } })),
    h('div', { class: 'sect' }, 'MIDI and keyboard'),
    h('p', { class: 'note' }, $('#midi-state').textContent),
    h('div', { style: 'display:grid;gap:10px' },
      h('button', { class: 'btn', style: 'justify-self:start', onclick: startMidi }, icon('midi', 14), 'Connect MIDI devices'),
      toggle({ label: 'Typing keyboard to piano (Alt+T)', checked: ui.typing, onChange: () => toggleTyping() }),
      toggle({ label: 'Quantize recorded notes', checked: ui.recQuant, onChange: v => { ui.recQuant = v; save(); } })),
  ] });
}
function keysUp(e) {
  if (e.code === 'Space' && !e.target.closest?.('input, textarea')) e.preventDefault();  // stops a focused button from clicking too
  const p = typingHeld.get(e.key.toLowerCase());
  if (p == null) return;
  typingHeld.delete(e.key.toLowerCase());
  noteOff(p);
}

function applyDevices() {
  $('#rig').classList.toggle('no-devices', !ui.devices);
  $('#devices-toggle').setAttribute('aria-pressed', ui.devices);
}
function staticChrome() {  // icons and labels that never change
  const label = (el, ic, text) => el.replaceChildren(icon(ic, 15), text);
  for (const [v, [ic, text, key]] of Object.entries(VIEWS)) {
    const b = document.querySelector(`[data-view=${v}]`);
    b.replaceChildren(icon(ic, 15), h('span', { class: 'view-label' }, text));
    b.title = key ? `${text} (${key})` : text;
  }
  label($('#brain-title'), 'brain', 'Brain');
  label($('#pads-title'), 'pads', 'Pads');
  label($('#deck-title'), 'record', 'Turntable');
  initPhone();
  initChat();
  $('.display .wtitle').addEventListener('wheel', e => {  // a vertical wheel scrolls a toolbar that doesn't fit
    const w = e.currentTarget;
    if (e.target.closest('.knob') || w.scrollWidth <= w.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    w.scrollLeft += e.deltaY;
    e.preventDefault();
  }, { passive: false });
  $('#sg-keep').addEventListener('click', keepSuggestion);
  $('#sg-drop').addEventListener('click', dropSuggestion);
  $('#export').replaceChildren(icon('export', 16), 'Export');
  $('#export').title = 'Save MIDI, WAV and MP3 files for FL Studio (Ctrl+E)';
  $('#play').replaceChildren(icon('play', 18));
  $('#stop').replaceChildren(icon('stop', 15));
  $('#rec').replaceChildren(icon('rec', 16));
  $('#metro').replaceChildren(icon('metro', 17));
  $('#undo').replaceChildren(icon('undo', 17));
  $('#redo').replaceChildren(icon('redo', 17));
  $('#cmd').replaceChildren(icon('search', 15), h('span', {}, 'Search actions'), h('kbd', {}, 'Ctrl K'));
  $('#typing').replaceChildren(icon('keyboard', 18));
  $('#midi').replaceChildren(icon('midi', 18));
  $('#help').replaceChildren(icon('help', 18));
  $('#make').replaceChildren(icon('brain', 17), 'Make a beat');
  $('#new-part').replaceChildren(icon('dice', 15), 'New part', icon('down', 13));
  $('#devices-toggle').replaceChildren(icon('panel', 17));
  $('#drop-icon').replaceChildren(icon('wave', 26));
}

async function init() {
  const restored = restore();
  if (!restored) { song = generate({ style: 'rnb', bpm: 87, root: 4, mode: 'minor' }); prepare(song); }  // starts out in WDTBU's tempo and key
  const link = new URLSearchParams(location.hash.slice(1));  // e.g. #view=mixer&theme=light opens straight there
  if (VIEWS[link.get('view')]) ui.view = link.get('view');
  if (['dark', 'light'].includes(link.get('theme'))) ui.theme = link.get('theme');
  if (['rig', 'daw'].includes(link.get('layout'))) ui.layout = link.get('layout');
  if (!patternOf(song, ui.pattern)) ui.pattern = hookId(song);
  initViews();
  menuBar();
  applyTheme();
  staticChrome();
  toolbarKnobs();
  tempoControl();
  renderCountry();
  $('#typing').setAttribute('aria-pressed', ui.typing);

  $('#play').addEventListener('click', () => togglePlay());
  $('#stop').addEventListener('click', stopAll);
  $('#rec').addEventListener('click', toggleRecord);
  $('#metro').addEventListener('click', toggleMetro);
  $('#undo').addEventListener('click', () => stepHistory(-1));
  $('#redo').addEventListener('click', () => stepHistory(1));
  $('#project').addEventListener('click', e => projectMenu(e.currentTarget));
  $('#cmd').addEventListener('click', openPalette);
  $('#typing').addEventListener('click', toggleTyping);
  $('#midi').addEventListener('click', startMidi);
  $('#help').addEventListener('click', openHelp);
  for (const b of document.querySelectorAll('[data-layout]')) b.addEventListener('click', () => setLayout(b.dataset.layout));
  for (const b of document.querySelectorAll('[data-btab]')) b.addEventListener('click', () => showBrowser(b.dataset.btab));
  $('#pl').addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); zoomPlaylist(e.deltaY < 0 ? 1.15 : 1 / 1.15); } }, { passive: false });
  for (const b of document.querySelectorAll('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => showView(b.dataset.view));
  $('#devices-toggle').addEventListener('click', () => { ui.devices = !ui.devices; save(); applyDevices(); });
  $('#new-part').addEventListener('click', e => newPartMenu(e.currentTarget));
  $('#export').addEventListener('click', openExport);
  $('#style-name').addEventListener('click', e => menu(e.currentTarget, STYLE_IDS.map((id, i) => ({
    label: `${String(i + 1).padStart(2, '0')}  ${STYLES[id].name}`, hint: `${STYLES[id].bpm[0]}–${STYLES[id].bpm[1]} BPM`, active: id === ui.style, onSelect: () => chooseStyle(id),
  })), { width: 260 }));
  $('#theme').addEventListener('click', () => { ui.theme = ui.theme === 'light' ? 'dark' : 'light'; save(); applyTheme(); renderView(); });
  $('#ask').replaceChildren(icon('brain', 13), 'Ask');
  $('#ask').addEventListener('click', () => openChat());
  $('#make').addEventListener('click', () => make());
  $('#file').addEventListener('change', e => e.target.files[0] && useFile(e.target.files[0]));
  const drop = $('#drop');
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) useFile(e.dataTransfer.files[0]); });
  const pl = $('#pl');  // audio files dropped anywhere on the playlist land where they're dropped
  pl.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  pl.addEventListener('drop', e => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    const r = pl.getBoundingClientRect(), tick = Math.max(0, Math.round((e.clientX - r.left + pl.scrollLeft - hdr()) / barWidth * 4) * PPQ);
    const lane = e.target.closest('.lane.audio'), t = lane ? track(lane.dataset.id) : null;
    [...e.dataTransfer.files].reduce((p, f) => p.then(() => importAudio(f, t, tick)), Promise.resolve());
  });
  $('#search').addEventListener('submit', search);
  $('#lib-q').addEventListener('input', renderSounds);
  document.addEventListener('keydown', keys);
  document.addEventListener('keyup', keysUp);
  document.addEventListener('mouseover', e => { const el = e.target.closest?.('[title], [aria-label]'); hint(el ? el.getAttribute('title') || el.getAttribute('aria-label') : HINT); });
  addEventListener('blur', () => { for (const p of typingHeld.values()) noteOff(p); typingHeld.clear(); });
  let resizeTimer;
  const onResize = new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(renderView, 100); });
  onResize.observe($('.display-body'));
  onResize.observe($('#desktop'));
  $('#engine-state').textContent = 'Audio starts on your first click';
  addEventListener('pointerdown', () => audio(), { once: true, capture: true });  // opening the sound device takes a moment, so do it now, not on Play

  renderBrain();
  applyDevices();
  await loadAudioFor(song).catch(() => {});
  applyLayout();
  changed();
  commit(songJSON());
  drawOutMeter();
  requestAnimationFrame(frame);
  initDeck();
  initStyleKnob();
  startProjects();
  await loadLibrary();
  // bring back FL sounds chosen before the reload, or pick a kit for a brand-new session
  if (restored) await restoreSounds(song.tracks);
  else if (ui.flKit && lib.length) await applyKit();
  changed();
}

init();
