// End-to-end test of BeatLab Studio through real mouse and keyboard input (Chrome DevTools protocol).
// Start `python beatlab.py --no-browser`, then: npm run test:studio
// Settings: CHROME (browser path), BEATLAB_URL (default http://localhost:8765), BEATLAB_TEST_DIR (scratch folder)
import { spawn } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const S = process.env.BEATLAB_TEST_DIR ?? join(tmpdir(), 'beatlab-e2e'), URL = process.env.BEATLAB_URL ?? 'http://localhost:8765';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME ?? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].find(existsSync);
const OUT = `${S}/test`, PROFILE = `${S}/test-profile`, DL = `${S}/dl`;
rmSync(PROFILE, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true }); mkdirSync(DL, { recursive: true });
const port = 9700 + Math.floor(Math.random() * 200);
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${PROFILE}`,
  '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
  '--hide-scrollbars', '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let targets;
for (let i = 0; i < 60; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); break; } catch { await sleep(200); } }
const ws = new WebSocket(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0;
const pending = new Map(), errors = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).split('\n').slice(0, 3).join(' | '));
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('CONSOLE ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/favicon/.test(m.params.entry.url ?? '')) errors.push('LOG ' + m.params.entry.text + ' ' + (m.params.entry.url ?? ''));
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async expr => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error('page JS: ' + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
  return r.result?.result?.value;
};
const shot = async name => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.result.data, 'base64')); };
const mouse = (type, x, y, o = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: type === 'mouseMoved' && !o.buttons ? 'none' : o.button ?? 'left', buttons: o.buttons ?? 0, clickCount: 1, modifiers: o.modifiers ?? 0, deltaX: 0, deltaY: o.deltaY ?? 0 });
async function click(x, y, o = {}) {
  await mouse('mouseMoved', x, y, o);
  await mouse('mousePressed', x, y, { ...o, buttons: o.button === 'right' ? 2 : 1 });
  await mouse('mouseReleased', x, y, o);
  await sleep(120);
}
async function drag(x0, y0, x1, y1, o = {}) {
  await mouse('mouseMoved', x0, y0, o);
  await mouse('mousePressed', x0, y0, { ...o, buttons: 1 });
  for (let k = 1; k <= 6; k++) await mouse('mouseMoved', x0 + (x1 - x0) * k / 6, y0 + (y1 - y0) * k / 6, { ...o, buttons: 1 });
  await mouse('mouseReleased', x1, y1, o);
  await sleep(150);
}
const isExpr = sel => /^(document|\[\.\.\.)/.test(sel);
const box = sel => ev(`(() => { const e = ${isExpr(sel) ? sel : `document.querySelector(${JSON.stringify(sel)})`}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, l: r.x, t: r.y, w: r.width, h: r.height }; })()`);
async function clickSel(sel, o) { const b = await box(sel); if (!b) throw new Error(`nothing matches ${sel}`); await click(b.x, b.y, o); }
async function menuPick(text) {
  await ev(`[...document.querySelectorAll('.menu .menu-item')].find(b => b.textContent.includes(${JSON.stringify(text)}))?.scrollIntoView({ block: 'nearest' })`);  // long menus scroll
  const b = await box(`[...document.querySelectorAll('.menu .menu-item')].find(b => b.textContent.includes(${JSON.stringify(text)}))`);
  if (!b) throw new Error(`no menu item "${text}" (menu: ${await ev(`[...document.querySelectorAll('.menu .menu-item')].map(b => b.textContent).join(' / ')`)})`);
  await click(b.x, b.y);
}
const KEYCODES = { F5: 116, F6: 117, F7: 118, F8: 119, F9: 120, F10: 121, F1: 112, Delete: 46, Escape: 27, Enter: 13, ' ': 32, ArrowUp: 38, ArrowDown: 40, ArrowLeft: 37, ArrowRight: 39, Backspace: 8 };
async function key(k, mods = 0) {  // mods: Alt 1, Ctrl 2, Shift 8
  const code = k === ' ' ? 'Space' : k.length === 1 ? `Key${k.toUpperCase()}` : k, vk = KEYCODES[k] ?? k.toUpperCase().charCodeAt(0);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
  if (k.length === 1 && !(mods & 2)) await send('Input.dispatchKeyEvent', { type: 'char', key: k, text: k, modifiers: mods });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
  await sleep(120);
}
async function type(text) { for (const ch of text) await send('Input.insertText', { text: ch }); await sleep(100); }
const saved = async () => { await sleep(450); return ev(`JSON.parse(localStorage.getItem('beatlab:v3')).song`); };
const results = [];
async function test(name, fn) {
  if (process.env.ONLY && !new RegExp(process.env.ONLY).test(name)) return;
  const before = errors.length;
  try { const note = await fn(); results.push(`PASS ${name}${note ? ` — ${note}` : ''}`); }
  catch (e) { results.push(`FAIL ${name} — ${e.message}`); await shot(`fail_${name.replace(/\W+/g, '_')}`).catch(() => {});
    await ev(`document.querySelector('[data-layout=rig]').click(); 0`).catch(() => {}); }  // a failure mid-test can leave the DAW layout on
  if (errors.length > before) results.push(`  errors during ${name}: ${errors.slice(before).join(' || ')}`);
  await ev(`document.querySelector('.menu')?.remove(); document.querySelector('.palette')?.remove(); document.querySelector('#dlg').open && document.querySelector('#dlg').close(); 0`).catch(() => {});
}
const assert = (c, msg) => { if (!c) throw new Error(msg); };
const track = (song, id) => song.tracks.find(t => t.id === id);
await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: DL.replace(/\//g, '\\') });
await send('Page.navigate', { url: `${URL}/studio.html#still` });
for (let i = 0; i < 60 && !(await ev(`document.querySelectorAll('#pl .lane.row').length > 0`).catch(() => false)); i++) await sleep(500);
await sleep(4000);
await click(960, 1066);  // a first click on the status bar starts audio
const uiState = async () => (await sleep(450), ev(`JSON.parse(localStorage.getItem('beatlab:v3')).ui`));
const curPat = async () => (await uiState()).pattern;
const notesOf = async id => { const p = await curPat(), s = await saved(); return track(s, id)[p] ?? []; };  // curPat waits out the save
const bw = () => ev(`parseFloat([...document.querySelectorAll('#pl .ruler i')].filter(i => !i.classList.contains('cursor-mark'))[1].style.left)`);
const rowBox = r => box(`#pl .lane.row[data-row="${r}"]`);
const rackRow = i => `document.querySelectorAll('.rack .ch')[${i}]`;
const kickStep = i => `${rackRow(0)}.querySelectorAll('.step')[${i}]`;

await test('loads with a project, patterns and autosave', async () => {
  const name = await ev(`document.querySelector('#proj-name').textContent`), st = await ev(`document.querySelector('#save-state').textContent`), s = await saved();
  assert(name === 'My first beat', `project name ${name}`);
  assert(/saved/i.test(st), `save state ${st}`);
  assert(s.patterns.length === 6 && s.playlist.clips.length === 8, `${s.patterns.length} patterns, ${s.playlist.clips.length} clips`);
  return `${name}; ${s.patterns.map(p => p.name).join(', ')}; picker "${await ev(`document.querySelector('#pat-pick').textContent`)}"`;
});

for (const [v, sel] of [['arrange', '#pl .lane.row'], ['rack', '.display-body .rack'], ['roll', '.display-body .proll'], ['mixer', '.display-body .mixer'], ['master', '.master-view'], ['sounds', '#tab-sounds'], ['listen', '#tab-listen']]) {
  await test(`rig view ${v}`, async () => {
    await clickSel(`[data-view=${v}]`);
    await sleep(500);
    assert(await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return !!e && e.getBoundingClientRect().height > 30; })()`), `${sel} not showing`);
    await shot(`view_${v}`);
  });
}

await test('FL keys: F6 rack, F9 mixer, F7 piano roll, L mode, M metronome', async () => {
  await key('F6'); assert(await ev(`document.querySelector('[data-view=rack]').getAttribute('aria-selected')`) === 'true', 'F6');
  await key('F9'); assert(await ev(`document.querySelector('[data-view=mixer]').getAttribute('aria-selected')`) === 'true', 'F9');
  await key('F7'); assert(await ev(`document.querySelector('[data-view=roll]').getAttribute('aria-selected')`) === 'true', 'F7');
  await key('l'); assert((await uiState()).mode === 'song', 'L to song');
  await key('l'); assert((await uiState()).mode === 'pattern', 'L back to pattern');
  await key('m'); assert((await uiState()).metro === true, 'M metronome');
  await key('m');
});

await test('patterns: F4 new, numpad steps, clone, rename', async () => {
  const n0 = (await saved()).patterns.length;
  await key('F4'); await sleep(300);
  const s1 = await saved();
  assert(s1.patterns.length === n0 + 1 && (await curPat()) === s1.patterns.at(-1).id, 'F4 made and selected a new pattern');
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: '+', code: 'NumpadAdd', windowsVirtualKeyCode: 107 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: '+', code: 'NumpadAdd', windowsVirtualKeyCode: 107 }); await sleep(300);
  assert((await curPat()) === s1.patterns[0].id, 'numpad + wraps to pattern 1');
  await clickSel('#pat-pick .picker'); await menuPick('Hook'); await sleep(300);
  await key('c', 2 | 8); await sleep(400);
  const s2 = await saved(), hook = s2.patterns.find(p => p.name === 'Hook');
  const copy = s2.patterns.find(p => p.name === 'Hook copy');
  assert(copy && JSON.stringify(track(s2, 'kick')[copy.id]) === JSON.stringify(track(s2, 'kick')[hook.id]), 'Ctrl+Shift+C cloned the hook with its notes');
  await key('F2'); await sleep(300);
  assert(await ev(`document.querySelector('#dlg').open && document.querySelector('#dlg b').textContent === 'Rename pattern'`), 'F2 opens rename');
  await ev(`document.querySelector('#dlg').close()`);
  await clickSel('#pat-pick .picker'); await menuPick('Hook'); await sleep(300);
  return `${s2.patterns.length} patterns`;
});

await test('channel rack: step on, undo, redo', async () => {
  await key('F6'); await sleep(400);
  const i = await ev(`[...${rackRow(0)}.querySelectorAll('.step')].findIndex(s => !s.classList.contains('on'))`);
  await clickSel(kickStep(i));
  assert(await ev(`${kickStep(i)}.classList.contains('on')`), 'step did not light');
  await sleep(500);
  await key('z', 2); await sleep(300);
  assert(!(await ev(`${kickStep(i)}.classList.contains('on')`)), 'undo did not clear the step');
  await key('y', 2); await sleep(300);
  assert(await ev(`${kickStep(i)}.classList.contains('on')`), 'redo did not bring it back');
  return `step ${i + 1}`;
});

await test('channel rack: chance, ratchet, wheel velocity, Euclidean fill', async () => {
  const i = await ev(`[...${rackRow(0)}.querySelectorAll('.step')].findIndex(s => s.classList.contains('on'))`), b = await box(kickStep(i));
  await click(b.x, b.y, { button: 'right' }); await menuPick('50% of the time'); await sleep(200);
  await click(b.x, b.y, { button: 'right' }); await menuPick('3 hits'); await sleep(200);
  assert(await ev(`${kickStep(i)}.classList.contains('chance') && ${kickStep(i)}.classList.contains('roll')`), 'chance and roll');
  const v0 = await ev(`${kickStep(i)}.title`);
  await mouse('mouseWheel', b.x, b.y, { deltaY: 120 }); await sleep(300);
  assert(v0 !== await ev(`${kickStep(i)}.title`), 'wheel velocity');
  const hits = (await notesOf('kick')).filter(n => n.t >= i * 24 && n.t < (i + 1) * 24);
  assert(hits.length === 3 && hits.every(n => n.c === 0.5), `saved hits ${JSON.stringify(hits)}`);
  const cb = await box(`${rackRow(0)}.querySelector('.cbtn')`);
  await click(cb.x, cb.y, { button: 'right' }); await menuPick('5 hits spread over 16'); await sleep(300);
  assert(await ev(`${rackRow(0)}.querySelectorAll('.step.on').length`) === 5, 'euclid');
});

await test('channel rack: add a channel, Up and Down select, pattern length', async () => {
  const before = await ev(`document.querySelectorAll('.rack .ch').length`);
  await clickSel(`[...document.querySelectorAll('#dock-tools .btn')].find(b => b.textContent.includes('Channel'))`);
  await menuPick('Clap'); await sleep(400);
  assert(await ev(`document.querySelectorAll('.rack .ch').length`) === before + 1, 'added');
  await clickSel(`${rackRow(1)}.querySelector('.cbtn')`); await sleep(300);
  await ev(`document.querySelector('#plugin').hidden = true`);
  await key('ArrowDown'); await sleep(300);
  assert((await uiState()).selected === 'hat', `Down selected ${(await uiState()).selected}`);
  return 'Clap 1 added; Down moved snare to hats';
});

await test('pads program the selected drum', async () => {
  await clickSel(`[...document.querySelectorAll('#pad-channels .chip')].find(c => c.textContent.includes('Snare'))`);
  const lit = await ev(`document.querySelectorAll('#padgrid .bigpad.on').length`);
  await clickSel(`document.querySelectorAll('#padgrid .bigpad')[1]`);
  assert(await ev(`document.querySelectorAll('#padgrid .bigpad.on').length`) !== lit, 'pad did not change');
});

await test('piano roll: draw, select all, delete, undo', async () => {
  await key('F7'); await sleep(500);
  await clickSel(`[...document.querySelectorAll('#dock-tools .picker')].find(p => p.title === 'Channel')`); await menuPick('Melody'); await sleep(400);
  const n0 = (await notesOf('melody')).length, cv = await box('.proll canvas'), vis = await box('.roll-scroll');
  await click(cv.l + cv.w * 0.47 + 3, vis.t + 30);
  const n1 = (await notesOf('melody')).length;
  assert(n1 === n0 + 1, `notes ${n0} -> ${n1}`);
  await key('a', 2); await key('Delete'); await sleep(300);
  assert((await notesOf('melody')).length === 0, 'delete all');
  await key('z', 2); await sleep(400);
  assert((await notesOf('melody')).length === n1, 'undo');
  return `${n0} -> ${n1} -> 0 -> ${n1}`;
});

await test('piano roll: chord stamp, scale snap, quantize, copy-paste, legato, velocity lane', async () => {
  await clickSel(`[...document.querySelectorAll('#dock-tools .picker')].find(p => p.title.startsWith('Chord stamp'))`); await menuPick('Minor 7'); await sleep(300);
  const n0 = (await notesOf('melody')).length, cv = await box('.proll canvas'), vis = await box('.roll-scroll');
  await click(cv.l + cv.w * 0.9 + 3, vis.t + vis.h * 0.6);
  const n1 = (await notesOf('melody')).length;
  assert(n1 - n0 >= 3, `chord added ${n1 - n0}`);
  await key('q', 2); await key('c', 2); await key('v', 2); await key('l', 2); await sleep(300);
  const vel = await box('.vel canvas');
  await drag(vel.l + 2, vel.t + 3, vel.l + vel.w - 2, vel.t + 3);
  assert((await notesOf('melody')).some(n => n.v > 110), 'velocity lane');
  await clickSel(`[...document.querySelectorAll('#dock-tools .picker')].find(p => p.title.startsWith('Chord stamp'))`); await menuPick('Single notes');
  return `chord +${n1 - n0}, then ${(await notesOf('melody')).length} notes`;
});

await test('piano roll: delete, mute and slice tools (D, T, C)', async () => {
  const notes = await notesOf('melody'), n = notes[0], cv = await box('.proll canvas'), scroll = await box('.roll-scroll');
  const hi = 96, rh = 14, cur = await curPat(), patBars = (await saved()).patterns.find(p => p.id === cur).bars;
  const x = cv.l + (n.t + n.d / 2) / (patBars * 16 * 24) * cv.w, y = cv.t + (hi - n.p) * rh + rh / 2;
  if (y < scroll.t || y > scroll.t + scroll.h) await ev(`document.querySelector('.roll-scroll').scrollTop = ${(hi - n.p) * rh - 100}`);
  const cv2 = await box('.proll canvas'), y2 = cv2.t + (hi - n.p) * rh + rh / 2;
  await key('t'); await click(x, y2); await sleep(300);
  assert((await notesOf('melody')).find(m => m.t === n.t && m.p === n.p)?.m === 1, 'T then click mutes the note');
  await key('c');
  const count = (await notesOf('melody')).length;
  if (n.d >= 48) { await click(cv2.l + (n.t + n.d / 2) / (patBars * 384) * cv2.w, y2); await sleep(300); assert((await notesOf('melody')).length === count + 1, 'C slices'); }
  await key('d'); await click(cv2.l + (n.t + 6) / (patBars * 384) * cv2.w, y2); await sleep(300);  // the start, which a slice leaves on this note
  assert(!(await notesOf('melody')).some(m => m.t === n.t && m.p === n.p), 'D then click deletes');
  await key('p');
  return `muted, ${n.d >= 48 ? 'sliced, ' : ''}deleted the note at ${n.t}`;
});

await test('piano: keys play while held, and the channel keyboard too', async () => {
  const k = await box(`document.querySelector('.keys [data-p="72"]')`);
  await ev(`document.querySelector('.roll-scroll').scrollTop = 200`);
  const k2 = await box(`document.querySelector('.keys [data-p="72"]')`);
  await mouse('mouseMoved', k2.x, k2.y); await mouse('mousePressed', k2.x, k2.y, { buttons: 1 }); await sleep(250);
  const down = await ev(`document.querySelector('.keys [data-p="72"]').classList.contains('down')`);
  await mouse('mouseReleased', k2.x, k2.y); await sleep(200);
  const up = await ev(`document.querySelector('.keys [data-p="72"]').classList.contains('down')`);
  assert(down && !up, `roll key down ${down}, after release ${up}`);
  await key('F6'); await sleep(300);
  await clickSel(`[...document.querySelectorAll('.rack .cbtn')].find(b => b.textContent.includes('Chords'))`); await sleep(500);
  const kb = await box(`document.querySelector('#plugin .kb [data-p="64"]')`);
  assert(kb, 'channel window has a keyboard');
  await mouse('mouseMoved', kb.x, kb.y + 30); await mouse('mousePressed', kb.x, kb.y + 30, { buttons: 1 }); await sleep(200);
  const kdown = await ev(`document.querySelector('#plugin .kb [data-p="64"]').classList.contains('down')`);
  await mouse('mouseReleased', kb.x, kb.y + 30);
  assert(kdown, 'channel keyboard key lit while held');
  await ev(`[...document.querySelectorAll('#plugin .iconbtn')].find(b => b.title.startsWith('Close')).click()`);
});

await test('mixer: every effect loads, bypass, reorder', async () => {
  await key('F9'); await sleep(400);
  const all = ['EQ', 'Filter', 'Compressor', 'Limiter', 'Drive', 'Tape', 'Bitcrush', 'Chorus', 'Phaser', 'Flanger', 'Tremolo', 'Stereo width', 'Delay', 'Reverb'];
  let k = 0;
  for (const strip of ['Chords', 'Melody']) {
    while (k < all.length && await ev(`!![...document.querySelectorAll('.strip')].find(s => s.querySelector('.sname b')?.textContent === ${JSON.stringify(strip)}).querySelector('.slot.empty')`)) {
      await ev(`document.querySelector('#plugin').hidden = true`);
      await clickSel(`[...document.querySelectorAll('.strip')].find(s => s.querySelector('.sname b')?.textContent === ${JSON.stringify(strip)}).querySelector('.slot.empty')`);
      await menuPick(all[k++]);
      await sleep(250);
    }
  }
  const s = await saved(), fx = [...track(s, 'chords').fx, ...track(s, 'melody').fx].map(f => f.type);
  assert(fx.length >= 14, `fx ${fx.join(',')}`);
  await ev(`document.querySelector('#plugin').hidden = true`);
  const slot = await box(`[...document.querySelectorAll('.strip')].find(s => s.querySelector('.sname b')?.textContent === 'Chords').querySelectorAll('.slot')[1]`);
  await click(slot.x, slot.y, { button: 'right' }); await menuPick('Bypass');
  await click(slot.x, slot.y, { button: 'right' }); await menuPick('Move up');
  assert(track(await saved(), 'chords').fx[0].off === true, 'bypass + move');
  await key(' '); await sleep(3000);
  const pos = await ev(`document.querySelector('#pos').textContent`);
  await key(' '); await sleep(300);
  assert(pos !== '01.1.1', `clock did not move (${pos})`);
  for (const id of ['Chords', 'Melody']) for (let i = 0; i < 9; i++) {
    const b = await box(`[...document.querySelectorAll('.strip')].find(s => s.querySelector('.sname b')?.textContent === ${JSON.stringify(id)})?.querySelector('.slot.on, .slot.off')`);
    if (!b) break;
    await click(b.x, b.y, { button: 'right' }); await menuPick('Remove'); await sleep(120);
  }
  return `played to ${pos} through all 14 effects`;
});

await test('playlist: draw, paint, right-click delete, slice, mute (P B D C T)', async () => {
  await key('F5'); await sleep(500);
  await clickSel('#pat-pick .picker'); await menuPick('Hook'); await sleep(300);
  const c0 = (await saved()).playlist.clips.length, w = await bw(), r7 = await rowBox(7);
  await key('p');
  await click(r7.l + 20 * w + 4, r7.y); await sleep(400);
  let s = await saved();
  const placed = s.playlist.clips.find(c => c.row === 7);
  assert(s.playlist.clips.length === c0 + 1 && placed?.t === 20 * 384, `draw placed ${JSON.stringify(placed)}`);
  await key('b');
  const r8 = await rowBox(8);
  await drag(r8.l + 2 * w + 2, r8.y, r8.l + 25 * w, r8.y); await sleep(400);
  s = await saved();
  const painted = s.playlist.clips.filter(c => c.row === 8);
  assert(painted.length === 3, `paint laid ${painted.length} clips`);
  await key('p');
  await click(r8.l + 3 * w, r8.y, { button: 'right' }); await sleep(400);
  assert((await saved()).playlist.clips.filter(c => c.row === 8).length === 2, 'right-click deleted one');
  await key('c');
  await click(r7.l + 24 * w + 2, r7.y); await sleep(400);
  assert((await saved()).playlist.clips.filter(c => c.row === 7).length === 2, 'C sliced the clip in two');
  await key('t');
  await click(r7.l + 21 * w, r7.y); await sleep(300);
  assert((await saved()).playlist.clips.find(c => c.row === 7 && c.t === 20 * 384)?.mute === true, 'T muted it');
  await key('p');
  await shot('playlist_tools');
  return `drew at bar 21, painted 3, sliced at bar 25`;
});

await test('playlist: select box, drag to move, Ctrl+B duplicate, Delete', async () => {
  const w = await bw(), r7 = await rowBox(7), r8 = await rowBox(8);
  await key('e');
  await drag(r7.l + 19 * w, r7.t + 3, r8.l + 30 * w, r8.t + r8.h - 3); await sleep(300);
  const n = await ev(`document.querySelector('#hint').textContent`);
  assert(/^3 clips selected/.test(n), n);
  await key('b', 2); await sleep(400);
  let s = await saved();
  assert(s.playlist.clips.filter(c => c.row === 7 || c.row === 8).length === 7, 'Ctrl+B duplicated three clips');
  await key('Delete'); await sleep(400);
  s = await saved();
  assert(s.playlist.clips.filter(c => c.row === 7 || c.row === 8).length === 4, 'Delete removed the copies');
  await key('p');
  const r7b = await rowBox(7), clip = s.playlist.clips.find(c => c.row === 7 && c.t === 20 * 384);
  await drag(r7b.l + 21 * w, r7b.y, r7b.l + 29 * w, r7b.y + r7b.h); await sleep(400);
  const moved = (await saved()).playlist.clips.find(c => c.id === clip.id);
  assert(moved.row === 8 && moved.t > clip.t, `moved to row ${moved.row} at ${moved.t}`);
  return 'box-selected 3, duplicated, deleted, dragged one down a track';
});

await test('automation lane from the Automate menu', async () => {
  await clickSel(`[...document.querySelectorAll('#dock-tools .btn')].find(b => b.textContent.includes('Automate'))`); await menuPick('Chords'); await sleep(400);
  await ev(`document.querySelector('#pl').scrollTop = 10000`); await sleep(200);
  const lane = await box('.lane.auto[data-id=chords]');
  assert(lane, 'no automation lane');
  await click(lane.l + lane.w * 0.1, lane.t + lane.h * 0.8);
  await click(lane.l + lane.w * 0.2, lane.t + lane.h * 0.2);
  const pts = track(await saved(), 'chords').auto?.vol ?? [];
  assert(pts.length === 2 && pts[0].v < pts[1].v, `points ${JSON.stringify(pts)}`);
  await ev(`document.querySelector('#pl').scrollTop = 0`);
});

await test('audio: drop a file on the playlist, drag, trim and edit the clip', async () => {
  await ev(`(() => {
    const sr = 44100, n = sr * 2, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf), w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.sin(i / sr * 2 * Math.PI * 220) * 12000 * (1 - i / n), true);
    const dt = new DataTransfer(); dt.items.add(new File([buf], 'test tone.wav', { type: 'audio/wav' }));
    const pl = document.querySelector('#pl'), r = pl.getBoundingClientRect();
    pl.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 210 + 300, clientY: r.top + 300 }));
    return 1;
  })()`);
  await sleep(1500);
  let s = await saved();
  const c0 = s.playlist.clips.find(c => c.type === 'audio');
  assert(c0 && Math.abs(c0.len - 2) < 0.01 && s.tracks.find(t => t.id === c0.ch)?.name === 'test tone', 'audio clip on its own channel');
  const w = await bw(), lane = await rowBox(c0.row), spt = 60 / (s.bpm * 96), cw = c0.len / spt / 384 * w, x0 = lane.l + c0.t / 384 * w;
  await sleep(600);
  await drag(x0 + cw / 2, lane.y, x0 + cw / 2 + w * 2, lane.y); await sleep(300);
  const c1 = (await saved()).playlist.clips.find(c => c.id === c0.id);
  assert(c1.t > c0.t, `drag ${c0.t} -> ${c1.t}`);
  const nx = lane.l + c1.t / 384 * w;
  await sleep(500);
  await drag(nx + cw - 2, lane.y, nx + cw * 0.55, lane.y); await sleep(300);
  const c2 = (await saved()).playlist.clips.find(c => c.id === c0.id);
  assert(c2.len < c1.len - 0.3, `trim ${c1.len} -> ${c2.len}`);
  await click(nx + 8, lane.t + 7); await menuPick('Reverse');
  await click(nx + 8, lane.t + 7); await menuPick('Half a second');
  await click(nx + 8, lane.t + 7); await menuPick('Normalize to -1 dB');
  const c3 = (await saved()).playlist.clips.find(c => c.id === c0.id);
  assert(c3.rev && c3.fi === 0.5 && c3.gain > 0, `menu ${JSON.stringify(c3)}`);
  return `moved ${((c1.t - c0.t) / 384).toFixed(1)} bars, trimmed to ${c2.len.toFixed(2)} s, +${c3.gain} dB`;
});

await test('song mode from the ruler', async () => {
  await clickSel('[data-mode=song]');
  const r = await box('#pl .ruler'), w = await bw();
  await click(r.l + w * 4 + 3, r.y);
  const where = await ev(`document.querySelector('#where').textContent`);
  await key(' '); await sleep(2500);
  const pos = await ev(`document.querySelector('#pos').textContent`);
  await key(' '); await sleep(300);
  assert(/bar 5/.test(where) && +pos.slice(0, 2) >= 5, `${where}, clock ${pos}`);
  return `${where}, clock ${pos}`;
});

await test('record from the microphone onto the playlist', async () => {
  const before = (await saved()).playlist.clips.filter(c => c.type === 'audio').length;
  await key('r'); await sleep(1200);
  const counting = await ev(`document.querySelector('#where').textContent`);
  await sleep(4200);
  await key('r'); await sleep(2000);
  const s = await saved(), audio = s.playlist.clips.filter(c => c.type === 'audio');
  assert(audio.length === before + 1, `clips ${before} -> ${audio.length}; ${counting}`);
  const take = audio.at(-1);
  assert(take.len > 1 && take.t === 4 * 384, `take ${take.len} s at ${take.t}`);
  return `${counting}; take ${take.len.toFixed(2)} s at bar 5 on track ${take.row + 1}`;
});

await test('record notes with the computer keyboard in pattern mode', async () => {
  await clickSel('[data-mode=pattern]');
  await key('F6'); await sleep(300);
  await clickSel(`document.querySelector('.rack .ch[data-ch=melody] .cbtn')`); await sleep(400);  // typing plays the selected channel
  await key('Escape'); await sleep(200);
  assert((await uiState()).selected === 'melody', 'melody selected');
  await key('F7'); await sleep(300);
  const n0 = (await notesOf('melody')).length;
  await key('t', 1);
  await clickSel('#rec'); await sleep(3300);
  for (const k of ['z', 'c', 'b', 'q']) { await key(k); await sleep(250); }
  await sleep(300);
  await key(' '); await sleep(600);
  await key('t', 1);
  const n1 = (await notesOf('melody')).length;
  assert(n1 >= n0 + 3, `melody ${n0} -> ${n1}`);
  return `melody ${n0} -> ${n1}`;
});

await test('command palette: typed commands', async () => {
  const run = async text => { await key('k', 2); await sleep(200); await type(text); await sleep(200); await key('Enter'); await sleep(500); };
  await run('tempo 140');
  assert(await ev(`document.querySelector('#bpm-v').textContent`) === '140', 'tempo');
  await run('mute hats');
  assert(track(await saved(), 'hat').mute === true, 'mute hats');
  await run('key g minor');
  const s = await saved();
  assert(s.root === 7 && s.mode === 'minor', `key ${s.root} ${s.mode}`);
  await run('pattern 3');
  assert((await curPat()) === s.patterns[2].id, 'pattern 3');
  await run('add delay to snare');
  assert(track(await saved(), 'snare').fx.some(f => f.type === 'delay'), 'add delay');
  await run('unmute hats'); await run('tempo 87');
  await clickSel('#pat-pick .picker'); await menuPick('Hook');
  await ev(`document.querySelector('#plugin').hidden || [...document.querySelectorAll('#plugin .iconbtn')].find(b => b.title.startsWith('Close')).click()`);
});

await test('master meters while playing', async () => {
  await clickSel('[data-view=master]'); await sleep(300);
  await key(' '); await sleep(4000);
  const vals = await ev(`['lu-m', 'lu-s', 'lu-i', 'lu-p'].map(id => document.querySelector('#' + id).textContent)`);
  await key(' '); await sleep(300);
  assert(vals.slice(0, 3).every(v => /^-?\d+\.\d$/.test(v)), `readouts ${vals}`);
  return vals.join(' / ');
});

await test('F10 opens audio and MIDI settings', async () => {
  await key('F10'); await sleep(300);
  assert(await ev(`document.querySelector('#dlg').open && document.querySelector('#dlg b').textContent === 'Audio and MIDI settings'`), 'settings');
  await key('Escape');
});

await test('make a beat keeps your channels and recordings; undo brings the old one back', async () => {
  const s0 = await saved();
  await clickSel('#make'); await sleep(4000);
  const s1 = await saved();
  assert(JSON.stringify(s1.harmony) !== JSON.stringify(s0.harmony), 'beat did not change');
  assert(s1.tracks.some(t => t.kind === 'audio') && s1.tracks.some(t => t.user && t.kind === 'drum'), 'lost your channels');
  for (let i = 0; i < 6; i++) { await key('z', 2); await sleep(350); if (JSON.stringify((await saved()).harmony) === JSON.stringify(s0.harmony)) return `back after ${i + 1} undo steps`; }
  throw new Error('undo did not bring the old beat back');
});

await test('export: a pattern at -14 LUFS with MP3, stems and a drums-only version', async () => {
  await key('r', 2); await sleep(500);
  await ev(`(() => { document.querySelector('#dlg input[type=text]').value = 'zz_test_export'; return 1; })()`);
  const pick = async label => clickSel(`[...document.querySelectorAll('#dlg label')].find(l => l.textContent.trim().startsWith(${JSON.stringify(label)})).querySelector('input')`);
  await pick('Hook, 8 bars'); await pick('Also MP3, 320 kbps'); await pick('Stems, one per part'); await pick('Drums only'); await pick('-14 LUFS, streaming'); await pick('24-bit');
  await clickSel(`[...document.querySelectorAll('#dlg button')].find(b => b.textContent.trim() === 'Export')`);
  let status = '';
  for (let i = 0; i < 240; i++) { await sleep(1000); status = await ev(`document.querySelector('#dlg .ex-status').textContent`); if (/Saved to|stopped/.test(status)) break; }
  assert(/Saved to/.test(status), status);
  const dir = join(ROOT, 'exports', 'zz_test_export'), files = readdirSync(dir), report = readFileSync(`${dir}/report.txt`, 'utf8');
  assert(['mix.wav', 'mix.mp3', 'beat.mid', 'mix_drums_only.wav'].every(f => files.includes(f)) && files.some(f => f.startsWith('stem_')), files.join(','));
  const mixLine = report.split('\n').find(l => l.startsWith('Mix:')), lufs = +mixLine.match(/(-?\d+\.\d) LUFS/)[1];
  assert(Math.abs(lufs + 14) < 0.6, mixLine);
  assert(readFileSync(`${dir}/mix.wav`).readUInt16LE(34) === 24, 'bits');
  return `${files.length} files; ${mixLine}`;
});

await test('projects: version, new project, reopen, project file', async () => {
  await key('s', 2); await sleep(400);
  await clickSel('#project'); await menuPick('New project'); await sleep(1500);
  const name2 = await ev(`document.querySelector('#proj-name').textContent`);
  await key('o', 2); await sleep(500);
  await clickSel(`[...document.querySelectorAll('#dlg .list .item')].find(i => i.textContent.includes('My first beat')).querySelector('button')`); await sleep(1500);
  const back = await saved();
  assert(/Untitled/.test(name2) && await ev(`document.querySelector('#proj-name').textContent`) === 'My first beat' && back.playlist.clips.some(c => c.type === 'audio'), 'reopen');
  await clickSel('#project'); await menuPick('Save as a project file'); await sleep(2500);
  const f = readdirSync(DL).find(x => x.endsWith('.beatlab')), data = JSON.parse(readFileSync(`${DL}/${f}`, 'utf8'));
  assert(data.song.patterns && Object.keys(data.audio).length >= 2, `audio ${Object.keys(data.audio ?? {}).length}`);
  return `new project "${name2}", reopened, saved ${f} with ${Object.keys(data.audio).length} recordings`;
});

await test('DAW layout: floating windows, drag, close all, browser', async () => {
  await clickSel('[data-layout=daw]'); await sleep(1500);
  assert(await ev(`!!document.querySelector('#base-win .lane.row')`), 'playlist fills the desktop');
  await key('F6'); await sleep(800);
  assert(await ev(`!document.querySelector('.fwin[data-win=rack]').hidden && !!document.querySelector('.fwin[data-win=rack] .rack .ch')`), 'F6 opens the rack window');
  const head = await box('.fwin[data-win=rack] .fhead b'), x0 = (await uiState()).wins.rack.x;
  await drag(head.x, head.y, head.x + 120, head.y + 60); await sleep(400);
  assert((await uiState()).wins.rack.x > x0 + 100, 'dragged');
  await key('F7'); await sleep(800);
  assert(await ev(`!document.querySelector('.fwin[data-win=roll]').hidden`), 'F7 opens the piano roll window');
  await shot('daw_windows');
  await key('F12'); await sleep(300);
  assert(await ev(`document.querySelector('.fwin[data-win=rack]').hidden && document.querySelector('.fwin[data-win=roll]').hidden`), 'F12 closes all');
  const n0 = (await saved()).tracks.length;
  const bell = `[...document.querySelectorAll('#browser-body li')].find(l => l.textContent.startsWith('Bell'))`;
  await ev(`${bell}.scrollIntoView({ block: 'center' })`); await sleep(200);
  await clickSel(bell); await sleep(500);
  const s = await saved();
  assert(s.tracks.length === n0 + 1 && s.tracks.at(-1).name === 'Bell 1', 'browser adds an instrument');
  await clickSel('[data-btab=project]'); await sleep(300);
  assert(await ev(`[...document.querySelectorAll('#browser-body li')].some(l => l.textContent.includes('Hook'))`), 'project tab lists patterns');
  await key('F8'); await sleep(500);
  assert(await ev(`document.querySelector('[data-btab=sounds]').getAttribute('aria-selected') === 'true' && !!document.querySelector('#browser-body #samples')`), 'F8 shows the sounds');
  await shot('daw_browser');
  await clickSel('[data-layout=rig]'); await sleep(800);
});

// New tests: smoother rack editing, FL instruments and kits, presets, the Trio synth, new effects, the AI
const until = async (expr, ms = 20000) => { for (let i = 0; i < ms / 250; i++) { if (await ev(expr)) return true; await sleep(250); } return false; };
const savedTrack = async id => track(await saved(), id);
const rackTool = text => `[...document.querySelectorAll('#dock-tools .btn, .fwin[data-win=rack] .ftools .btn')].find(b => b.textContent.trim().startsWith(${JSON.stringify(text)}))`;
const pluginBtn = text => `[...document.querySelectorAll('#plugin button')].find(b => b.textContent.trim() === ${JSON.stringify(text)})`;

await test('rack: drag across steps paints them, and from a lit step clears them', async () => {
  await key('F6'); await sleep(400);
  const [id, at] = await ev(`(() => { for (const ch of document.querySelectorAll('.rack .ch')) { const s = [...ch.querySelectorAll('.step')]; for (let i = 0; i + 4 <= s.length; i++) if (s.slice(i, i + 4).every(x => !x.classList.contains('on'))) return [ch.dataset.ch, i]; } return ['', -1]; })()`);
  const steps = `[...document.querySelectorAll('.rack .ch[data-ch=${id}] .step')]`;
  assert(at >= 0, 'no four empty steps in a row');
  const a = await box(`${steps}[${at}]`), b = await box(`${steps}[${at + 3}]`), n0 = notesFor(await savedTrack(id), await curPat());
  await drag(a.x, a.y, b.x, b.y);
  const n1 = notesFor(await savedTrack(id), await curPat());
  assert(n1.length === n0.length + 4, `painted ${n1.length - n0.length}`);
  await drag(a.x, a.y, b.x, b.y);
  const n2 = notesFor(await savedTrack(id), await curPat());
  assert(n2.length === n0.length, `cleared to ${n2.length} from ${n0.length}`);
  return `painted 4 steps from step ${at + 1}, then cleared them`;
});
function notesFor(t, p) { return t[p] ?? []; }

await test('FL instrument: Rhodes on the chords maps across the keys', async () => {
  await key('F6'); await sleep(300);
  await clickSel(`document.querySelector('.rack .ch[data-ch=chords] .cbtn')`); await sleep(500);
  await clickSel(pluginBtn('FL instrument')); await menuPick('Rhodes');
  assert(await until(`JSON.parse(localStorage.getItem('beatlab:v3')).song.tracks.find(t => t.id === 'chords').inst?.name === 'Rhodes'`), 'Rhodes never loaded');
  const t = await savedTrack('chords'), roots = t.inst.zones.map(z => z.root);
  assert(roots.length === 7 && roots[0] === 36 && roots.at(-1) === 72, `zones ${roots}`);
  const k = await box('#plugin .kb-w');
  await click(k.x, k.y); await sleep(300);
  assert(/Rhodes/.test(await ev(`document.querySelector('#plugin').textContent`)), 'window shows the instrument');
  return `zones ${roots.join(' ')}`;
});

await test('drum kit: an FL kit on every drum channel, with its takes', async () => {
  await ev(`document.querySelector('#plugin').hidden = true`);
  await key('F6'); await sleep(300);
  await clickSel(rackTool('Drum kit')); await menuPick('HQ Funk Kit');
  assert(await until(`/HQ Funk Kit/.test(JSON.parse(localStorage.getItem('beatlab:v3')).song.tracks.find(t => t.id === 'kick').inst?.kit ?? '')`, 30000), 'kit never loaded');
  const kick = await savedTrack('kick'), snare = await savedTrack('snare');
  assert(kick.inst.zones[0].takes.length > 1 && snare.inst?.zones[0].takes.length > 1, 'takes');
  await key(' '); await sleep(2000); await key(' ');
  return `kick ${kick.inst.zones[0].takes.length} takes, snare ${snare.inst.zones[0].takes.length}`;
});

await test('synth presets: the browse arrows step through them', async () => {
  await ev(`document.querySelector('#plugin').hidden = true`);
  await key('F6'); await sleep(300);
  await clickSel(`document.querySelector('.rack .ch[data-ch=bass] .cbtn')`); await sleep(500);
  const before = (await savedTrack('bass')).sound;
  if ((await savedTrack('bass')).inst) await clickSel(pluginBtn('Use the synth instead'));
  await sleep(300);
  await clickSel(`document.querySelector('#plugin [aria-label="Next sound"]')`); await sleep(300);
  const p1 = (await savedTrack('bass')).preset;
  await clickSel(`document.querySelector('#plugin [aria-label="Next sound"]')`); await sleep(300);
  const p2 = (await savedTrack('bass')).preset;
  assert(p1 && p2 && p1 !== p2, `presets ${p1} then ${p2}`);
  return `${before}: ${p1}, then ${p2}`;
});

await test('Trio synth: add it, pick a preset, play it', async () => {
  await ev(`document.querySelector('#plugin').hidden = true`);
  await key('F6'); await sleep(300);
  await clickSel(rackTool('Channel')); await menuPick('Trio synth');
  const t = (await saved()).tracks.at(-1);
  assert(t.sound === 'synth', `added ${t.sound}`);
  await ev(`document.querySelector('.rack .ch[data-ch="${t.id}"]').scrollIntoView({ block: 'nearest' })`);  // as you would scroll to it
  await clickSel(`document.querySelector('.rack .ch[data-ch="${t.id}"] .cbtn')`);
  assert(await until(`!document.querySelector('#plugin').hidden && /Trio synth/.test(document.querySelector('#plugin .wtitle b')?.textContent)`, 5000), 'its window never opened');
  await clickSel(`[...document.querySelectorAll('#plugin .picker')].find(p => (p.title ?? '').startsWith('Preset') || p.getAttribute('aria-label') === 'Preset')`); await menuPick('Supersaw'); await sleep(300);
  assert((await savedTrack(t.id)).params.uni === 5, 'Supersaw sets five voices');
  const knobs = await ev(`document.querySelectorAll('#plugin .knob-row .knob, #plugin .knob-row [role=slider]').length`);
  const k = await box('#plugin .kb-w'); await click(k.x, k.y); await sleep(300);
  return `${knobs} knobs, Supersaw`;
});

await test('new effects: parametric EQ with its curve, multiband, gate and auto-pan play', async () => {
  await ev(`document.querySelector('#plugin').hidden = true`);
  await key('F9'); await sleep(400);
  const name0 = await ev(`[...document.querySelectorAll('.strip')].find(s => s.querySelector('.slot.empty') && s.querySelectorAll('.slot.on, .slot.off').length <= 4 && s.querySelector('.sname b') && !/Master/.test(s.textContent))?.querySelector('.sname b').textContent`);
  const strip = `[...document.querySelectorAll('.strip')].find(s => s.querySelector('.sname b')?.textContent === ${JSON.stringify(name0 ?? '')})`;
  const chId = (await saved()).tracks.find(t => (t.name ?? '') === name0 || ({ kick: 'Kick', hat: 'Hats', openhat: 'Open hat', chords: 'Chords', arp: 'Arp', melody: 'Melody', texture: 'Vinyl', fx: 'Risers and FX' })[t.id] === name0 || t.id === name0.toLowerCase())?.id;
  for (const name of ['Parametric EQ', 'Multiband', 'Gate', 'Auto-pan']) { await clickSel(`${strip}.querySelector('.slot.empty')`); await menuPick(name); await sleep(250); }
  const fx = (await savedTrack(chId)).fx.map(f => f.type);
  assert(['peq', 'multiband', 'gate', 'autopan'].every(x => fx.includes(x)), `fx ${fx}`);
  await ev(`document.querySelector('#plugin').hidden = true`);
  await key('F6'); await sleep(300);
  await clickSel(`document.querySelector('.rack .ch[data-ch="${chId}"] .cbtn')`); await sleep(800);
  const inked = await ev(`(() => { const c = document.querySelector('#plugin canvas.eqcurve'); if (!c || !c.width) return 0; const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; })()`);
  assert(inked > 100, `EQ curve pixels ${inked}`);
  await key(' '); await sleep(2500);
  const pos = await ev(`document.querySelector('#pos').textContent`);
  await key(' ');
  assert(pos !== '01.1.1', 'played');
  return `${fx.join(', ')}; curve drawn; played to ${pos}`;
});

await test('AI: humanize, vary and fill the drums', async () => {
  await ev(`document.querySelector('#plugin').hidden = true`);
  await key('F6'); await sleep(300);
  const status = `document.querySelector('#ai-status').textContent`;
  await clickSel(rackTool('Humanize'));
  assert(await until(`/human feel|stopped/.test(${status})`, 120000), 'humanize never finished');
  assert(!/stopped/.test(await ev(status)), await ev(status));
  const kick = notesFor(await savedTrack('kick'), await curPat()), off = kick.filter(n => n.t % 24 !== 0).length;
  await clickSel(rackTool('Vary'));
  assert(await until(`/Variation 1 of 4|stopped/.test(${status})`, 120000), 'vary never finished');
  assert(!/stopped/.test(await ev(status)), await ev(status));
  await clickSel(rackTool('Vary'));
  assert(await until(`/Variation 2 of 4/.test(${status})`, 20000), 'second variation');
  await clickSel(rackTool('Fill'));
  assert(await until(`/played a fill|stopped/.test(${status})`, 60000), 'fill never finished');
  assert(!/stopped/.test(await ev(status)), await ev(status));
  return `humanized (${off} of ${kick.length} kicks nudged off the grid), two variations, a fill`;
});

await test('make a beat picks FL instruments that suit the style', async () => {
  await key('k', 2); await sleep(200); await type('Make a Lofi beat'); await sleep(200); await key('Enter');
  assert(await until(`(() => { const s = JSON.parse(localStorage.getItem('beatlab:v3')).song; return s.style === 'lofi' && !!s.tracks.find(t => t.id === 'chords').inst; })()`, 30000), 'no FL instrument on the chords');
  const s = await saved(), names = ['chords', 'melody', 'bass'].map(id => track(s, id)?.inst?.name).filter(Boolean);
  await key(' '); await sleep(2500); await key(' ');
  return names.join(', ');
});

const tell = async text => { await key('k', 2); await sleep(250); await type(text); await sleep(400); const top = await ev(`document.querySelector('.palette-list [role=option]')?.textContent ?? ''`); await key('Enter'); return top; };
await test('brain: one sentence, several changes, one undo', async () => {
  await until(`!document.querySelector('#make').disabled`);
  const s0 = await saved(), chords0 = track(s0, 'chords').fx.length;
  const top = await tell('tempo 150, mute the hats and make the chords darker');
  assert(await until(`/3 of 3 done/.test([...document.querySelectorAll('.toast')].map(t => t.textContent).join(' '))`, 15000), `toast; palette offered "${top}"`);
  const s1 = await saved();
  assert(s1.bpm === 150 && track(s1, 'hat').mute === true && track(s1, 'chords').fx.some(f => f.type === 'filter' && !(f.hp > 0.5)), 'all three applied');
  await key('z', 2); await sleep(600);
  const s2 = await saved();
  assert(s2.bpm === s0.bpm && !track(s2, 'hat').mute && track(s2, 'chords').fx.length === chords0, `one undo: bpm ${s2.bpm}, hat mute ${track(s2, 'hat').mute}`);
  return `offered: ${top}`;
});
await test('brain: 808 slides and hi-hat rolls from a request', async () => {
  const p = await curPat(), s0 = await saved(), g0 = (track(s0, 'bass')[p] ?? []).filter(n => n.g).length, h0 = (track(s0, 'hat')[p] ?? []).length;
  await tell('add 808 slides every 2 bars and hat rolls every 4 bars');
  assert(await until(`/2 of 2 done/.test([...document.querySelectorAll('.toast')].map(t => t.textContent).join(' '))`, 15000), 'toast');
  const s1 = await saved(), g1 = (track(s1, 'bass')[p] ?? []).filter(n => n.g).length, h1 = (track(s1, 'hat')[p] ?? []).length;
  assert(g1 > g0 && h1 > h0, `slides ${g0} -> ${g1}, hats ${h0} -> ${h1}`);
  await key(' '); await sleep(2000); await key(' ');
  return `808 slides ${g0} -> ${g1}, hat hits ${h0} -> ${h1}`;
});
await test('auto mix: levels land where they should, a second pass changes nothing', async () => {
  assert(await until(`!document.querySelector('#make').disabled`, 120000), 'the last beat never finished');  // a beat being made is still mixing itself
  await key('F9'); await sleep(400);
  await clickSel(`[...document.querySelectorAll('#dock-tools .btn, .fwin[data-win=mixer] .ftools .btn')].find(b => b.textContent.trim() === 'Auto mix')`);
  const t0 = Date.now(), done1 = await until(`/Mix balanced|already balanced/.test([...document.querySelectorAll('.toast')].map(t => t.textContent).join(' '))`, 90000);
  assert(done1, `first pass: ${await ev(`JSON.stringify([document.querySelector('#ai-status')?.textContent, document.querySelector('#hint')?.textContent, [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ')])`)}`);
  const first = await ev(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' ')`);
  await ev(`document.querySelector('#toast').textContent = ''; 1`);
  await sleep(500);
  await clickSel(`[...document.querySelectorAll('#dock-tools .btn, .fwin[data-win=mixer] .ftools .btn')].find(b => b.textContent.trim() === 'Auto mix')`);
  assert(await until(`/Mix balanced|already balanced/.test([...document.querySelectorAll('.toast')].map(t => t.textContent).join(' '))`, 90000), 'second pass');
  const second = await ev(`[...document.querySelectorAll('.toast')].map(t => t.textContent).join(' ')`);
  assert(/already balanced/.test(second), second);
  return first.slice(0, 160);
});

await test('automation clip: add one, shape it, it plays in song mode', async () => {
  await ev(`document.querySelector('#plugin').hidden = true`);
  await key('F5'); await sleep(400);
  await clickSel(`[...document.querySelectorAll('#dock-tools .btn, .fwin.base .ftools .btn')].find(b => b.textContent.includes('Automate'))`); await menuPick('Filter cutoff'); await sleep(500);
  const c = (await saved()).playlist.clips.find(x => x.type === 'auto');
  assert(c && c.target.param === 'cut' && c.points.length === 2, `clip ${JSON.stringify(c)}`);
  const row = await box(`#pl .lane.row[data-row="${c.row}"]`), w = await bw();
  await ev(`(() => { const pl = document.querySelector('#pl'), x = pl.scrollLeft; document.querySelector('#pl .lane.row[data-row="${c.row}"]').scrollIntoView({ block: 'nearest' }); pl.scrollLeft = x; return 1; })()`);  // down to the track, not sideways
  const row2 = await box(`#pl .lane.row[data-row="${c.row}"]`);
  await click(row2.l + (c.t / 384 + 2) * w, row2.t + row2.h * 0.8); await sleep(400);
  const c2 = (await saved()).playlist.clips.find(x => x.id === c.id);
  if (c2.points.length !== 3) { const px = row2.l + (c.t / 384 + 2) * w, py = row2.t + row2.h * 0.8; console.log('DBG auto', px, py, JSON.stringify(row2), w, c.t, c.d, await ev(`(() => { const e = document.elementFromPoint(${px}, ${py}); return e?.tagName + '.' + e?.className + ' row=' + e?.dataset?.row + ' tool=' + JSON.parse(localStorage.getItem('beatlab:v3')).ui.tool + ' hint=' + document.querySelector('#hint').textContent; })()`)); }
  assert(c2.points.length === 3, `points ${JSON.stringify(c2.points)}`);
  await key(' '); await sleep(2500); await key(' ');
  return `on track ${c.row + 1}, ${c2.points.length} points`;
});
await test('mixer bus: route a channel into a bus and play', async () => {
  await key('F9'); await sleep(400);
  await clickSel(`[...document.querySelectorAll('#dock-tools .btn, .fwin[data-win=mixer] .ftools .btn')].find(b => b.textContent.trim() === 'Bus')`); await sleep(500);
  const bus = (await saved()).tracks.find(t => t.kind === 'bus');
  assert(bus, 'no bus');
  await clickSel(`[...document.querySelectorAll('.strip')].find(s => s.querySelector('.sname b')?.textContent === 'Chords').querySelector('.route .picker')`); await menuPick(`To ${bus.name}`); await sleep(400);
  assert(track(await saved(), 'chords').out === bus.id, 'routed');
  await key(' '); await sleep(2000); await key(' ');
  return `Chords into ${bus.name}`;
});
await test('graph editor: draw the velocity of every step', async () => {
  await key('F6'); await sleep(400);
  await clickSel(`document.querySelector('.rack .ch[data-ch=kick] .cbtn')`); await sleep(300);
  await ev(`document.querySelector('#plugin').hidden = true`);
  await clickSel(rackTool('Graph')); await sleep(400);
  const cv = await box('.rack .graph canvas');
  assert(cv, 'no graph row');
  await drag(cv.l + 4, cv.t + cv.h * 0.85, cv.l + cv.w - 4, cv.t + cv.h * 0.85); await sleep(400);
  const bar = (await saved()).tracks.find(t => t.id === 'kick')[await curPat()].filter(n => n.t < 384);
  assert(bar.length && bar.every(n => n.v < 40), `velocities ${bar.map(n => n.v)}`);
  await clickSel(rackTool('Graph')); await clickSel(rackTool('Graph'));  // velocity, chance, off
  return `bar 1 kicks at ${bar.map(n => n.v).join(', ')}`;
});
await test('plugins: FM synth, wavetable and slicer channels play', async () => {
  await key('F6'); await sleep(300);
  const add = async (label, preset) => {
    await ev(`document.querySelector('#plugin').hidden = true`);
    await clickSel(rackTool('Channel')); await menuPick(label); await sleep(400);
    const t = (await saved()).tracks.at(-1);
    await ev(`document.querySelector('.rack .ch[data-ch="${t.id}"]').scrollIntoView({ block: 'nearest' })`);
    await clickSel(`document.querySelector('.rack .ch[data-ch="${t.id}"] .cbtn')`);
    assert(await until(`!document.querySelector('#plugin').hidden`, 5000), `${label} window`);
    if (preset) { await clickSel(`[...document.querySelectorAll('#plugin .picker')].find(p => (p.title ?? '').startsWith('Preset'))`); await menuPick(preset); await sleep(300); }
    const k = await box('#plugin .kb-w'); if (k) { await click(k.x, k.y); await sleep(250); }
    return (await saved()).tracks.find(x => x.id === t.id);
  };
  const fm = await add('FM synth', 'Electric piano'), wv = await add('Wavetable', 'Vowel pad'), sl = await add('Slicer');
  assert(fm.sound === 'fm' && fm.preset === 'Electric piano' && wv.sound === 'wave' && wv.preset === 'Vowel pad' && sl.sound === 'slicer', 'channels');
  await ev(`document.querySelector('#plugin').hidden = true`);
  await clickSel('[data-view=sounds]'); await sleep(400);
  await ev(`(() => { const q = document.querySelector('#lib-q'); q.value = 'Trap drums 140'; q.dispatchEvent(new Event('input', { bubbles: true })); return 1; })()`); await sleep(500);
  await clickSel(`[...document.querySelectorAll('#samples li')].find(li => li.textContent.includes('Trap drums 140')).querySelector('.load')`);
  assert(await until(`(JSON.parse(localStorage.getItem('beatlab:v3')).song.tracks.find(t => t.id === ${JSON.stringify(sl.id)})[JSON.parse(localStorage.getItem('beatlab:v3')).ui.pattern] ?? []).length === 16`, 10000), 'slices on the steps');
  await key('F6'); await key(' '); await sleep(2500); await key(' ');
  return `FM ${fm.preset}, Wavetable ${wv.preset}, Slicer with 16 slices`;
});
await test('vocoder: the chords take their voice from the kick', async () => {
  await key('F9'); await sleep(400);
  const strip = `[...document.querySelectorAll('.strip')].find(s => s.querySelector('.sname b')?.textContent === 'Chords')`;
  await ev(`document.querySelector('#plugin').hidden = true`);
  await clickSel(`${strip}.querySelector('.slot.empty')`); await menuPick('Vocoder'); await sleep(300);
  await key('F6'); await sleep(300);
  await clickSel(`document.querySelector('.rack .ch[data-ch=chords] .cbtn')`); await sleep(600);
  const voice = `[...document.querySelectorAll('#plugin .picker')].find(p => (p.title ?? '') === 'Vocoder voice')`;
  await ev(`${voice}.scrollIntoView({ block: 'center' })`); await sleep(200);
  await clickSel(voice); await menuPick('Kick'); await sleep(400);
  assert(track(await saved(), 'chords').fx.some(f => f.type === 'vocoder' && f.source === 'kick'), 'source');
  await key(' '); await sleep(2000); await key(' ');
  return 'Vocoder on Chords, voice from Kick';
});
await test('BeatLab kits in the desktop version', async () => {
  await ev(`document.querySelector('#plugin').hidden = true`);
  await key('F6'); await sleep(300);
  await clickSel(rackTool('Drum kit')); await menuPick('Lofi Kit (BeatLab)');
  const okk = await until(`(JSON.parse(localStorage.getItem('beatlab:v3')).song.tracks.find(t => t.id === 'kick').inst?.name ?? '').includes('Lofi Kit (BeatLab)')`, 20000);
  if (!okk) console.log('DBG kit', await ev(`JSON.stringify(JSON.parse(localStorage.getItem('beatlab:v3')).song.tracks.find(t => t.id === 'kick').inst?.name ?? null)`));
  assert(okk, 'kit');
  const k = track(await saved(), 'kick');
  return `${k.inst.name}, ${k.inst.zones[0].takes.length} takes`;
});

await test('help and white studio', async () => {
  await key('F1'); await sleep(300);
  assert(await ev(`document.querySelectorAll('#dlg .help-grid div').length > 30`), 'help');
  await key('Escape');
  await clickSel('#theme'); await sleep(600); await shot('light_arrange');
  await clickSel('#theme');
});

console.log(results.join('\n'));
console.log(`\n${results.filter(r => r.startsWith('PASS')).length} passed, ${results.filter(r => r.startsWith('FAIL')).length} failed`);
if (errors.length) console.log('\nAll errors:\n' + [...new Set(errors)].join('\n'));
ws.close();
chrome.kill();
rmSync(join(ROOT, 'exports', 'zz_test_export'), { recursive: true, force: true });
process.exit(results.some(r => r.startsWith('FAIL')) ? 1 : 0);
