// BeatLab landing page. First a pinned stage that the scroll plays like a tape: a pocket player turns
// from a line drawing into a halftone print, a barcode wipe becomes the waveform of a beat BeatLab
// renders right here, a clear player tumbles through "Unleash the beat", then the player comes apart
// into layers named after the parts of the studio, and each layer becomes that studio window. Then the
// page: the studio part by part, the layouts, the plugins, the keys, and an orange door to the studio.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildPlayer, inkUniforms } from './cassette.js';
import { generate, NOTES, STYLES } from './music.js';
import { render } from './sound.js';

const $ = s => document.querySelector(s);
const clamp01 = x => Math.max(0, Math.min(1, x));
const lerp = (a, b, k) => a + (b - a) * k;
const smooth = x => x * x * (3 - 2 * x);
const out3 = x => 1 - (1 - x) ** 3;
const seg = (p, a, b) => clamp01((p - a) / (b - a));
const INK = '#171A12', ORANGE = '#F2540F';
const fmt = (v, d) => v.toFixed(d).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ---------- the 3D scene: an ink player and a clear one ----------
const gl = $('#gl'), renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(22, 1, 0.1, 100);
camera.position.set(0, 0, 14);
const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = env;
const sun = new THREE.DirectionalLight('#ffffff', 2.4), back = new THREE.DirectionalLight('#eaf7c4', 1.4);
sun.position.set(-3, 5, 6);
back.position.set(4, -2, -5);
scene.add(sun, back, new THREE.AmbientLight('#ffffff', 0.5));
const U = inkUniforms();
const inkP = buildPlayer('ink', U), clearP = buildPlayer('clear', U, env);
const inkPivot = new THREE.Group(), clearPivot = new THREE.Group();
inkP.root.position.y = -0.5;    // turn round the middle of the body, not its feet
clearP.root.position.y = -0.5;
inkPivot.add(inkP.root);
clearPivot.add(clearP.root);
scene.add(inkPivot, clearPivot);
const GAP = 0.62;  // how far each layer lifts in the exploded view
const VIS_H = 2 * camera.position.z * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));

// ---------- the bezel ----------
let F = null;
function buildFrame() {
  const w = innerWidth, h = innerHeight, m = Math.max(10, Math.round(w * 0.014)), top = Math.round(h * 0.062), bot = h - Math.round(h * 0.018), r = 14;
  const c = w / 2, nw = Math.min(w * 0.09, 160), dip = Math.round(h * 0.018);
  const lensH = h * 0.115, lensD = w * 0.072, cy = h / 2, tipLine = w * 0.078;
  const x0 = w * 0.026, y0 = h * 0.083, x1 = w * 0.19, y1 = h * 0.32;
  F = { w, h, m, top, bot, lensH, lensD, cy, x0, y0, x1, y1 };
  const lens = (side, depth) => {  // the concave "tie" at the middle of each side
    const e = side < 0 ? m : w - m, s = side < 0 ? 1 : -1;
    return `M ${e} ${cy - lensH} C ${e} ${cy - lensH * 0.3} ${e + s * depth * 0.5} ${cy} ${e + s * depth} ${cy} C ${e + s * depth * 0.5} ${cy} ${e} ${cy + lensH * 0.3} ${e} ${cy + lensH}`;
  };
  F.lens = lens;
  const bracket = side => {
    const sx = side < 0 ? x0 : w - x0, ex = side < 0 ? x1 : w - x1;
    return `<path d="M ${ex} ${y0} H ${sx} V ${y1}" /><circle cx="${ex}" cy="${y0}" r="3" fill="${INK}" stroke="none"/><circle cx="${sx}" cy="${y1}" r="3" fill="${INK}" stroke="none"/>`;
  };
  const arrows = side => {  // the header strip's arrowheads
    const e = side < 0 ? m : w - m, s = side < 0 ? 1 : -1, y = top + h * 0.022;
    const head = (x, size) => `<path d="M ${x} ${y - size * 0.55} Q ${x + s * size * 0.25} ${y} ${x + s * size} ${y} Q ${x + s * size * 0.25} ${y} ${x} ${y + size * 0.55} Z" fill="${INK}"/>`;
    return head(e, h * 0.045) + head(e + s * h * 0.05, h * 0.028) + head(e + s * h * 0.085, h * 0.018) +
      `<path d="M ${e + s * h * 0.12} ${y} H ${c - s * w * 0.06}" stroke="${INK}" stroke-width="1.2"/><rect x="${Math.min(e + s * w * 0.075, e + s * w * 0.125)}" y="${y - 2}" width="${w * 0.05}" height="4" rx="2" fill="${INK}"/><rect x="${Math.min(e + s * w * 0.2, e + s * w * 0.25)}" y="${y - 3}" width="${w * 0.05}" height="6" rx="3" fill="none" stroke="${INK}" stroke-width="1.2"/>`;
  };
  $('#frame').setAttribute('viewBox', `0 0 ${w} ${h}`);
  $('#frame').innerHTML = `
    <g id="f-frame" fill="none" stroke="${INK}" stroke-width="1.6">
      <path d="M ${m + r} ${top} H ${c - nw - 26} C ${c - nw - 8} ${top} ${c - nw - 10} ${top + dip} ${c - nw + 10} ${top + dip} H ${c + nw - 10} C ${c + nw + 10} ${top + dip} ${c + nw + 8} ${top} ${c + nw + 26} ${top} H ${w - m - r} Q ${w - m} ${top} ${w - m} ${top + r} V ${bot - r} Q ${w - m} ${bot} ${w - m - r} ${bot} H ${m + r} Q ${m} ${bot} ${m} ${bot - r} V ${top + r} Q ${m} ${top} ${m + r} ${top} Z"/>
      <path d="${lens(-1, lensD)} M ${m + lensD} ${cy} H ${m + lensD + tipLine}"/>
      <path d="${lens(1, lensD)} M ${w - m - lensD} ${cy} H ${w - m - lensD - tipLine}"/>
    </g>
    <path id="lens-l" fill="${INK}"/><path id="lens-r" fill="${INK}"/>
    <g id="f-brackets" fill="none" stroke="${INK}" stroke-width="1.6">${bracket(-1)}${bracket(1)}
      <rect id="sl-tl" y="${y0 - 3}" width="30" height="6" rx="3" fill="${INK}" stroke="none"/><rect id="sl-tr" y="${y0 - 3}" width="30" height="6" rx="3" fill="${INK}" stroke="none"/>
      <rect id="sv-tl" x="${x0 - 2.5}" width="5" height="${h * 0.075}" rx="2" fill="${INK}" stroke="none"/><rect id="sv-tr" x="${w - x0 - 2.5}" width="5" height="${h * 0.075}" rx="2" fill="${INK}" stroke="none"/>
      <rect id="so-tl" x="${x0 - 4}" width="8" height="${h * 0.05}" rx="4" stroke-width="1.4"/><rect id="so-tr" x="${w - x0 - 4}" width="8" height="${h * 0.05}" rx="4" stroke-width="1.4"/>
    </g>
    <g id="f-strip" opacity="0">${arrows(-1)}${arrows(1)}</g>
    ${[-1, 1].map(s => { const x = s < 0 ? m + w * 0.016 : w - m - w * 0.016, y = h * 0.66; return `<g fill="${INK}"><rect x="${x - 5}" y="${y}" width="10" height="10"/><path d="M ${x} ${y + 16} l 6 6 -6 6 -6 -6 Z"/><rect x="${x - 5}" y="${y + 34}" width="10" height="10"/></g>`; }).join('')}`;
  $('#pct-l').style.left = `${m + lensD + tipLine + w * 0.025}px`;
  $('#pct-r').style.right = `${m + lensD + tipLine + w * 0.025}px`;
  $('#strip-label').style.top = `${top + h * 0.022}px`;
}

// ---------- the beat in the waveform ----------
const wave = { peaks: null, buf: null, ctx: null, src: null, t0: 0, playing: false };
// until the real beat is rendered, a smooth stand-in so the section never looks empty
let s0 = 11;
const rnd = () => (s0 = (s0 * 16807) % 2147483647) / 2147483647;
const standIn = Array.from({ length: 200 }, (_, i) => 0.35 + 0.55 * Math.abs(Math.sin(i / 14) * Math.sin(i / 37 + 1)) + rnd() * 0.08);
const peakAt = u => { const p = wave.peaks ?? standIn; return p[Math.min(p.length - 1, Math.floor(u * p.length))]; };
async function makeDemo() {
  const root = 5, song = generate({ style: 'trap', bpm: 140, root, mode: 'minor', energy: 0.62, complexity: 0.6 });
  const hook = song.patterns.find(p => p.name === 'Hook');
  hook.bars = 4;  // the first four bars of the hook render in a moment
  wave.buf = await render(song, hook.id, false);
  const d = wave.buf.getChannelData(0), n = 400, step = Math.floor(d.length / n);
  const peaks = Array.from({ length: n }, (_, i) => { let m = 0; for (let j = i * step; j < (i + 1) * step; j += 8) m = Math.max(m, Math.abs(d[j])); return m; });
  const top = Math.max(...peaks);
  wave.peaks = peaks.map(p => 0.12 + 0.88 * (p / top) ** 0.9);
  $('#hear').disabled = false;
  $('#hear').title = `${STYLES.trap.name}, 140 BPM, ${NOTES[root]} minor: written and rendered by BeatLab in your browser just now`;
  dirty = true;
}
function toggleHear() {
  if (!wave.buf) return;
  if (wave.playing) return stopHear();
  wave.ctx ??= new AudioContext();
  wave.ctx.resume();
  wave.src = wave.ctx.createBufferSource();
  wave.src.buffer = wave.buf;
  wave.src.connect(wave.ctx.destination);
  wave.src.onended = stopHear;
  wave.t0 = wave.ctx.currentTime;
  wave.src.start();
  wave.playing = true;
  $('#hear b').textContent = '■';
  $('#rec-dot').classList.add('live');
}
function stopHear() {
  if (wave.src) { wave.src.onended = null; try { wave.src.stop(); } catch { /* already ended */ } }
  wave.playing = false;
  $('#hear b').textContent = '▶';
  $('#rec-dot').classList.remove('live');
  dirty = true;
}

// Bars across the frame. `fill` is how far the solid bars reach (0..1), `amp` scales their height,
// `hair` how strongly the hairlines show, `thick` blends the not-yet-played lines toward full stripes.
const barLayout = () => { const n = Math.round(F.w / 21), x0 = F.m + 6, span = F.w - 2 * F.m - 12; return { n, x: i => x0 + (i + 0.5) * span / n, step: span / n }; };
function drawBars(g, { fill, amp, hair, thick = 0, cy, maxH, top, bottom, wipe = 1 }) {
  const { n, x, step } = barLayout(), bw = step * 0.62;
  g.fillStyle = INK;
  for (let i = 0; i < n; i++) {
    const u = i / n, xi = x(i);
    if (u > wipe) continue;
    if (u < fill) {
      const hh = Math.max(bw, peakAt(u) * maxH * amp);
      g.beginPath();
      g.roundRect(xi - bw / 2, cy - hh / 2, bw, hh, bw / 2);
      g.fill();
    } else if (hair > 0 || thick > 0) {
      const lw = lerp(1.6, bw, thick);
      g.globalAlpha = Math.max(hair, thick);
      g.fillRect(xi - lw / 2, top, lw, bottom - top);
      g.globalAlpha = 1;
    }
  }
}
function sizeCanvas(cv, w, h) {
  const dpr = Math.min(2, devicePixelRatio), W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return g;
}

// ---------- every frame ----------
let P = 0, lastP = -1, dirty = true;
const PARTS = ['Master', 'Mixer', 'Channel rack', 'Piano roll', 'Playlist'];  // bottom layer to top
$('#callouts').innerHTML = PARTS.map((t, i) => `<div class="callout ${i % 2 ? 'left' : ''}"><i></i><span><b>0${5 - i}</b>${t}</span></div>`).join('');
function frame(now) {
  requestAnimationFrame(frame);
  const tape = $('#tape');
  P = clamp01(-tape.getBoundingClientRect().top / Math.max(1, tape.offsetHeight - innerHeight));
  if (P === lastP && !dirty && !wave.playing) return;
  lastP = P;
  dirty = false;
  const { w, h, m, top, bot } = F;

  // the bezel: the frame shows in the device and waveform parts and comes back on the orange
  const frameOn = Math.max(1 - seg(P, 0.43, 0.47), seg(P, 0.88, 0.91));
  $('#f-frame').style.opacity = frameOn;
  const p1 = seg(P, 0, 0.2), lensFill = P < 0.43 ? p1 : 0;
  $('#lens-l').setAttribute('d', `${F.lens(-1, F.lensD * lensFill)} Z`);
  $('#lens-r').setAttribute('d', `${F.lens(1, F.lensD * lensFill)} Z`);
  $('#lens-l').style.opacity = frameOn;
  $('#lens-r').style.opacity = frameOn;
  const brackets = 1 - seg(P, 0.19, 0.22);
  $('#f-brackets').style.opacity = brackets;
  const a = smooth(p1), slx = lerp(F.x0 + 30, F.x1 - 50, a), svy = lerp(F.y0 + 40, F.y1 - h * 0.12, a), soy = lerp(F.y1 - h * 0.08, F.y0 + h * 0.1, a);
  $('#sl-tl').setAttribute('x', slx); $('#sl-tr').setAttribute('x', w - slx - 30);
  $('#sv-tl').setAttribute('y', svy); $('#sv-tr').setAttribute('y', soy + 20);
  $('#so-tl').setAttribute('y', soy); $('#so-tr').setAttribute('y', svy + h * 0.1);
  for (const [id, x, y, text] of [['#dim-tl', slx + 15, F.y0 + 10, fmt(lerp(26.8, 144.2, a), 1)], ['#dim-tr', w - slx - 15, F.y0 + 10, fmt(lerp(144.2, 26.8, a), 1)], ['#dim-tlv', F.x0 + 48, svy + h * 0.03, fmt(lerp(2064.56, 17983.9, a), 2)], ['#dim-trv', w - F.x0 - 48, soy + h * 0.05, fmt(lerp(2183.37, 17982.81, a), 2)]]) {
    const el = $(id);
    el.style.left = `${x}px`; el.style.top = `${y}px`; el.style.opacity = brackets; el.textContent = text;
  }
  const pct = `${String(Math.round(p1 * 100)).padStart(3, '0')}%`, pctOn = 1 - seg(P, 0.2, 0.23);
  for (const id of ['#pct-l', '#pct-r']) { $(id).textContent = pct; $(id).style.opacity = pctOn; }
  const stripOn = seg(P, 0.44, 0.47);
  $('#f-strip').style.opacity = stripOn;
  $('#strip-label').style.opacity = stripOn;
  $('#bl-box').style.opacity = stripOn;
  $('#counter').textContent = String(Math.floor(3214 + P * 96786)).padStart(12, '0');
  $('#hint').style.opacity = 1 - seg(P, 0, 0.015);
  $('#lede').style.opacity = 1 - seg(P, 0.012, 0.045);

  // the barcode wipe, the waveform and its collapse into a strip
  const g = sizeCanvas($('#fx'), w, h), wipe = seg(P, 0.2, 0.25), wv = seg(P, 0.25, 0.42), shrink = seg(P, 0.42, 0.47);
  const playing = wave.playing && P >= 0.25 && P < 0.43, head = playing ? clamp01((wave.ctx.currentTime - wave.t0) / wave.buf.duration) : wv;
  if (P >= 0.2 && P < 0.47) {
    const frameH = bot - top, maxH = frameH * 0.92, amp = lerp(1, 0.157 / 0.92, smooth(shrink));
    drawBars(g, { fill: P < 0.25 ? 0 : head, amp, hair: (1 - shrink) * 0.9, thick: 1 - seg(P, 0.25, 0.28), cy: h / 2, maxH, top: top + 1, bottom: bot - 1, wipe: P < 0.25 ? wipe * 1.08 : 1 });
    if (P >= 0.25 && shrink < 1) {  // the orange playhead with its two caps
      const { n, x } = barLayout(), px = lerp(x(0), x(n - 1), head);
      g.globalAlpha = 1 - shrink;
      g.fillStyle = ORANGE;
      g.fillRect(px - 2.5, top, 5, bot - top);
      const cap = y => { g.beginPath(); g.moveTo(px - 14, y); g.quadraticCurveTo(px - 3, y, px - 2.5, y + Math.sign(h / 2 - y) * 18); g.lineTo(px + 2.5, y + Math.sign(h / 2 - y) * 18); g.quadraticCurveTo(px + 3, y, px + 14, y); g.fill(); };
      cap(top); cap(bot);
      g.globalAlpha = 1;
    }
  }
  const tagOn = seg(P, 0.255, 0.275) * (1 - seg(P, 0.42, 0.45));
  $('#tag').style.opacity = tagOn;
  $('#tag').style.pointerEvents = tagOn > 0.5 ? 'auto' : 'none';
  const secs = (wave.buf?.duration ?? 9) * head;
  $('#tag-time').textContent = `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(Math.floor(secs % 60)).padStart(2, '0')}:${String(Math.floor(secs % 1 * 100)).padStart(2, '0')}`;

  // UNLEASH THE BEAT: the strip slides away and the words grow out of it
  const u = seg(P, 0.47, 0.645), mq = $('#marquee'), mqOn = P >= 0.468 && P < 0.66;
  mq.style.visibility = mqOn ? 'visible' : 'hidden';
  if (mqOn) {
    const sg = sizeCanvas($('#strip'), w, h * 0.16);
    drawBars(sg, { fill: 1, amp: 0.157 / 0.92, hair: 0, cy: h * 0.08, maxH: (bot - top) * 0.92, top: 0, bottom: h * 0.16 });
    const rowW = mq.scrollWidth;
    mq.style.transform = `translate(${-u * (rowW - w * 0.05)}px, -50%)`;
    $('#word').style.transform = `scaleY(${lerp(0.58, 1.55, out3(seg(u, 0, 0.5)))})`;
  }

  const tabOn = seg(P, 0.44, 0.47) * (1 - seg(P, 0.97, 1));
  $('#tab').style.opacity = tabOn;
  $('#tab').classList.toggle('on', tabOn > 0.5);
  $('#unpacked').style.opacity = seg(P, 0.91, 0.95);

  // the players
  const inkOn = P < 0.215 || (P > 0.65 && P < 0.86), clearOn = P > 0.465 && P < 0.66;
  inkPivot.visible = inkOn;
  clearPivot.visible = clearOn;
  if (P < 0.215) {  // the device turns, from line drawing to halftone print and back to line and print
    const visW = VIS_H * camera.aspect, s = Math.min(0.42 * visW / 2, 0.5 * VIS_H / 1.5), turn = smooth(seg(p1, 0.25, 0.8)) * Math.PI * 2;
    inkPivot.position.set(0, 0.05, 0);
    inkPivot.scale.setScalar(s * lerp(0.94, 1.04, p1));
    inkPivot.rotation.set(Math.PI / 2 - 0.16 * Math.sin(turn / 2), turn + 0.08 * Math.sin(p1 * Math.PI * 3), 0, 'YXZ');
    U.uShade.value = p1 < 0.25 ? 0.03 : p1 < 0.5 ? lerp(0.03, 1, seg(p1, 0.25, 0.5)) : p1 < 0.85 ? lerp(1, 0.55, seg(p1, 0.5, 0.85)) : lerp(0.55, 0.1, seg(p1, 0.85, 1));
    U.uArt.value = seg(p1, 0.45, 0.62);
    for (const L of inkP.layers) L.g.position.y = L.y;
    inkP.lid.rotation.x = 0;
    gl.style.opacity = 1 - seg(P, 0.2, 0.215);
  } else if (P > 0.65) {  // rises from below in a three-quarter view, then comes apart
    const rise = out3(seg(P, 0.655, 0.7)), e = smooth(seg(P, 0.69, 0.76)), s = Math.min(1.05, 0.9 * VIS_H / 4.4);
    inkPivot.scale.setScalar(s);
    inkPivot.position.set(w > 900 ? 0.35 : 0, lerp(-VIS_H * 0.85, -0.2, rise) - e * GAP * 2 * s * 0.75, 0);
    inkPivot.rotation.set(0.58, -0.7 + e * 0.28, 0, 'YXZ');
    U.uShade.value = 0.16;
    U.uArt.value = 1;
    const fold = smooth(seg(P, 0.815, 0.86));  // the hardware folds away under its screens
    inkP.layers.forEach((L, i) => { L.g.position.y = L.y + e * GAP * i; L.g.scale.setScalar(Math.max(1e-4, 1 - fold)); });
    gl.style.opacity = 1;
    placeCallouts(e, seg(e, 0.5, 0.85) * (1 - seg(P, 0.8, 0.815)));
  }
  if (!(P > 0.65 && P < 0.82)) placeCallouts(0, 0);
  placeWindows();
  if (clearOn) {  // tumbles in with the tape popping out, settles shut, spins away
    const a1 = out3(seg(u, 0, 0.35)), b1 = smooth(seg(u, 0.35, 0.65)), c1 = seg(u, 0.65, 1) ** 2;
    const visW = VIS_H * camera.aspect;
    clearPivot.scale.setScalar(Math.min(1.35, visW * 0.16));
    clearPivot.position.set(lerp(lerp(visW * 0.36, 0.9, a1), 0.2, b1) + lerp(0, -visW * 0.42, c1), lerp(lerp(-VIS_H * 0.6, 0.1, a1), 0.15, b1) + lerp(0, VIS_H * 0.55, c1), 0);
    clearPivot.rotation.set(lerp(lerp(1.0, 0.75, a1), 1.22, b1) + c1 * 0.9, lerp(lerp(-1.1, -0.45, a1), 0.28, b1) + c1 * 1.6, lerp(lerp(0.7, 0.18, a1), -0.12, b1) + c1 * 0.8, 'YXZ');
    clearP.lid.rotation.x = -lerp(lerp(1.35, 0.55, a1), 0, b1);
    clearP.tape.position.y = lerp(lerp(1.05, 0.38, a1), 0, b1);
    clearP.tape.position.z = lerp(lerp(-0.25, -0.1, a1), 0, b1);
    clearP.tape.rotation.x = -lerp(lerp(0.7, 0.3, a1), 0, b1);
    gl.style.opacity = 1;
  }
  renderer.render(scene, camera);  // also clears the canvas once neither player is showing
}

// ---------- the morph: each layer of the open player becomes its window of the studio ----------
// A window starts on its layer's top face, grows to its own shape, then flies to its place in a
// cascade like BeatLab's DAW layout, facing you, with a printed shadow.
const loader = new THREE.TextureLoader();
const CASCADE = {  // centre x, centre y and width, as fractions of the cascade's width; later ones sit in front
  playlist: [-0.16, 0.12, 0.64], rack: [0.27, 0.19, 0.42], master: [-0.3, -0.15, 0.34], roll: [0.0, -0.06, 0.44], mixer: [0.31, -0.15, 0.36],
};
const ORDER = Object.keys(CASCADE);
const wins = ['master', 'mixer', 'rack', 'roll', 'playlist'].map((name, i) => {  // one per layer, bottom to top
  const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, toneMapped: false, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat), shadow = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ color: INK, transparent: true, opacity: 0, depthTest: false, depthWrite: false }));
  shadow.position.set(0.014, -0.04, 0);
  mesh.add(shadow);
  mesh.renderOrder = 20 + ORDER.indexOf(name) * 2;
  shadow.renderOrder = mesh.renderOrder - 1;
  mesh.visible = false;
  scene.add(mesh);
  const w = { name, i, mesh, shadow, aspect: 2.2 };
  loader.load(`media/win-${name}.webp`, t => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; mat.map = t; mat.needsUpdate = true; w.aspect = t.image.width / t.image.height; renderer.initTexture(t); dirty = true; });  // uploaded now, not mid-morph
  return w;
});
const rest = inkP.layers.map(L => new THREE.Box3().setFromObject(L.g));  // each layer's box at rest, in the player's own space (it sits at the origin here)
const mA = new THREE.Matrix4(), mT = new THREE.Matrix4(), pA = new THREE.Vector3(), qA = new THREE.Quaternion(), sA = new THREE.Vector3(), qB = new THREE.Quaternion(), FLAT = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
function placeWindows() {
  const on = P > 0.8;
  for (const w of wins) w.mesh.visible = on;
  if (!on) return;
  const appear = smooth(seg(P, 0.8, 0.83)), visW = VIS_H * camera.aspect;
  const Bw = Math.min(0.84 * visW, 0.6 * VIS_H / 0.52), grow = 1 + seg(P, 0.94, 1) * 0.03;
  inkP.root.updateMatrixWorld(true);
  for (const w of wins) {
    const b = rest[w.i], top = b.max.y + GAP * w.i, cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2;
    // A: lying on the layer's top face, stretched to its footprint
    mA.copy(inkP.root.matrixWorld).multiply(mT.makeTranslation(cx, top + 0.03, cz)).multiply(FLAT).multiply(mT.makeScale(b.max.x - b.min.x, b.max.z - b.min.z, 1));
    mA.decompose(pA, qA, sA);
    // B: its place in the cascade, facing the camera; the top layer leaves first
    const [fx, fy, fw] = CASCADE[w.name], k = ORDER.indexOf(w.name), lag = (4 - w.i) * 0.012;
    const t = smooth(seg(P, 0.835 + lag, 0.9 + lag)), bw = fw * Bw * grow;
    w.mesh.position.set(lerp(pA.x, fx * Bw * grow, t), lerp(pA.y, fy * Bw + VIS_H * 0.05, t), lerp(pA.z, k * 0.02, t) + Math.sin(t * Math.PI) * 1.6);
    w.mesh.quaternion.slerpQuaternions(qA, qB, t);
    w.mesh.scale.set(lerp(sA.x, bw, t), lerp(sA.y, bw / w.aspect, t), 1);
    w.mesh.material.opacity = appear;
    w.shadow.material.opacity = 0.92 * t;
  }
}

const tmp = new THREE.Vector3(), box3 = new THREE.Box3();
inkPivot.updateMatrixWorld(true);
const anchors = inkP.layers.map((L, i) => {  // the outer edge of each layer, in the model's own space
  box3.setFromObject(L.g);
  const c = box3.getCenter(new THREE.Vector3());
  return inkP.root.worldToLocal(new THREE.Vector3(i % 2 ? box3.min.x : box3.max.x, c.y, c.z));
});
function placeCallouts(e, alpha) {
  const els = $('#callouts').children;
  inkPivot.updateMatrixWorld(true);
  anchors.forEach((p, i) => {
    const el = els[i];
    el.style.opacity = alpha;
    if (!alpha) return;
    tmp.copy(p);
    tmp.y += e * GAP * i;
    inkP.root.localToWorld(tmp).project(camera);
    el.style.left = `${(tmp.x + 1) / 2 * innerWidth}px`;
    el.style.top = `${(1 - tmp.y) / 2 * innerHeight}px`;
  });
}

function coil() {  // the coiled lead between the words
  const pts = Array.from({ length: 160 }, (_, i) => { const t = i / 159, a = t * Math.PI * 2 * 7.5; return `${(30 + 20 * Math.cos(a)).toFixed(1)} ${(8 + t * 200 + 7 * Math.sin(a)).toFixed(1)}`; });
  $('#coil').setAttribute('d', `M 30 0 L ${pts.join(' L ')} L 30 214`);
}
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  buildFrame();
  dirty = true;
}
addEventListener('resize', resize);
$('#hear').addEventListener('click', toggleHear);
$('#loading').remove();
resize();
coil();
requestAnimationFrame(frame);
document.fonts?.ready.then(() => { dirty = true; });
makeDemo().catch(e => { $('#hear').title = `Couldn't render a demo beat here (${e.message})`; });

// ---------- the page below the stage ----------
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pinned = el => { const r = el.getBoundingClientRect(); return clamp01(-r.top / Math.max(1, r.height - innerHeight)); };  // through a sticky section
const inView = el => { const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };

// the statement inks in word by word as you read it, and its key phrases get underlined
const man = $('#manifesto');
(function split(root) {
  for (const node of [...root.childNodes]) {
    if (node.nodeType !== 3) { split(node); continue; }
    const frag = document.createDocumentFragment();
    for (const part of node.textContent.split(/(\s+)/)) frag.append(/\S/.test(part) ? Object.assign(document.createElement('span'), { className: 'w', textContent: part }) : part);
    node.replaceWith(frag);
  }
})(man);
const words = [...man.querySelectorAll('.w')], ems = [...man.querySelectorAll('em')];
function inkWords() {
  const r = man.getBoundingClientRect(), lit = Math.round(clamp01((innerHeight * 0.85 - r.top) / (r.height + innerHeight * 0.2)) * words.length);
  words.forEach((w, i) => w.classList.toggle('lit', still || i < lit));
  for (const e of ems) e.classList.toggle('lit', e.lastElementChild.classList.contains('lit'));
}

// the studio part by part: the step nearest the middle of the screen owns the screen, which wipes to it
const steps = [...document.querySelectorAll('.step')], medias = [...document.querySelectorAll('.media')];
const STEP_NAMES = ['Playlist', 'Piano roll', 'The brain', 'Mixer', 'Master'];
const STEP_WHAT = ['Painting the hook along a track, then dragging one down', 'Stamping minor 7 chords, then playing the keys', 'Three styles, three beats, one press each', 'Every channel on its own insert', 'Loudness, spectrum, and the export'];
let cur = -1, zTop = 1, wipeDone = 0;
steps.forEach((s, i) => s.insertAdjacentHTML('afterbegin', `<div class="rail" aria-hidden="true">${steps.map((_, k) => `<i style="${k === i ? 'background:var(--ink)' : ''}"></i>`).join('')}</div>`));
function showStep(i) {
  if (i === cur) return;
  cur = i;
  steps.forEach((s, k) => s.classList.toggle('on', k === i));
  medias[i].style.zIndex = ++zTop;
  medias[i].classList.add('on');
  clearTimeout(wipeDone);
  wipeDone = setTimeout(() => medias.forEach((m, k) => { if (k !== cur) m.classList.remove('on'); }), 1100);  // the ones underneath reset for next time
  $('#screen-n').textContent = `0${i + 1} / 05`;
  $('#screen-name').textContent = STEP_NAMES[i];
  $('#screen-what').textContent = STEP_WHAT[i];
}
function playSteps() {
  const mid = innerHeight / 2;
  let best = 0, d = Infinity;
  steps.forEach((s, i) => { const r = s.getBoundingClientRect(), dd = Math.abs(r.top + r.height / 2 - mid); if (dd < d) { d = dd; best = i; } });
  showStep(best);
  const live = inView($('#features')) && !still;
  medias.forEach((m, k) => {
    const v = m.querySelector('video');
    if (!v) return;
    if (live && k === cur) { if (v.paused) { v.preload = 'auto'; v.play().catch(() => {}); } } else if (!v.paused) v.pause();
  });
}

// Rig or DAW: the line sweeps across as the picture arrives, until you take hold of it
const cmp = $('#cmp');
let cmpHeld = false;
$('#cmp-x').addEventListener('input', e => { cmpHeld = true; cmp.style.setProperty('--x', `${e.target.value}%`); });
function sweepCompare() {
  if (cmpHeld) return;
  const r = cmp.getBoundingClientRect(), k = smooth(clamp01((innerHeight - r.top) / (innerHeight * 0.95)));
  cmp.style.setProperty('--x', `${lerp(94, 50, still ? 1 : k)}%`);
  $('#cmp-x').value = Math.round(lerp(94, 50, k));
}

// the twelve styles run past, faster and leaning while you scroll
const STYLE_LIST = ['Trap', 'Drill', 'R&B', 'Lofi', 'Boom bap', 'Afrobeats', 'Amapiano', 'House', 'Reggaeton', 'Phonk', 'Pop', 'Desi hip-hop'];
const band = $('#band');
band.innerHTML = [0, 1].map(() => STYLE_LIST.map(n => `<span>${n}</span><span class="star">✶</span>`).join('')).join('');
let bandX = 0, vel = 0;
function runBand(dt) {
  if (!inView(band)) return;
  const half = band.scrollWidth / 2;
  bandX = (bandX + dt * (0.06 + Math.min(2.2, Math.abs(vel)) * 0.5)) % half;
  band.style.transform = `translateX(${-bandX}px) skewX(${clamp01(Math.abs(vel) / 3) * -10 * Math.sign(vel)}deg)`;
}

// the plugins: original instruments and effects, each card with its own little waveform
const wavePath = f => 'M' + Array.from({ length: 121 }, (_, i) => { const x = i / 120; return `${(x * 200).toFixed(1)} ${(60 - Math.max(-1, Math.min(1, f(x))) * 46).toFixed(1)}`; }).join(' L');
const PLUGINS = [
  ['Drums', 'Kick', 'Synth kick with tune, decay and punch', x => Math.exp(-x * 5) * Math.sin(x * 40)],
  ['Drums', 'Snare', 'Synth snare with snap', x => Math.sin(x * 400) * Math.sin(x * 97) * Math.exp(-x * 6)],
  ['Drums', 'Clap', 'Layered hand clap', x => Math.sin(x * 300) * Math.exp(-(x * 4 % 1) * 8) * Math.exp(-x * 2)],
  ['Drums', 'Hats', 'Closed and open, choked', x => Math.sin(x * 900 + Math.sin(x * 300) * 3) * Math.exp(-(x * 8 % 1) * 10) * 0.8],
  ['Bass', '808', 'Drive, glide and tone', x => Math.sin(x * 28 - x * x * 8) * Math.exp(-x * 1.2)],
  ['Bass', 'Reese', 'Detuned, moving bass', x => (Math.sin(x * 30) + Math.sin(x * 31.6)) * 0.45],
  ['Keys', 'Electric piano', 'Tine keys that ring', x => Math.sin(x * 40) * Math.exp(-x * 3) * 0.9 + Math.sin(x * 80) * Math.exp(-x * 6) * 0.3],
  ['Keys', 'Organ', 'Drawbars with Leslie', x => (Math.sin(x * 30) + Math.sin(x * 60) * 0.5 + Math.sin(x * 90) * 0.3) * 0.55],
  ['Synth', 'Pad', 'Warm and detuned', x => Math.sin(x * 12) * Math.sin(x * Math.PI) * 0.9],
  ['Synth', 'Strings', 'Ensemble with vibrato', x => Math.sin(x * 36 + Math.sin(x * 6) * 0.8) * Math.min(1, x * 4) * 0.8],
  ['Synth', 'Pluck', 'Bright and short', x => Math.sin(x * 60) * Math.exp(-x * 8)],
  ['Synth', 'Vocal synth', 'A choir of vowels', x => Math.sin(x * 30) * (0.6 + 0.4 * Math.sin(x * 8)) * 0.9],
  ['Tone', 'EQ', 'Low, mid and high, with a sweepable mid', x => 0.5 * Math.exp(-(((x - 0.2) / 0.08) ** 2)) - 0.4 * Math.exp(-(((x - 0.55) / 0.1) ** 2)) + 0.35 * Math.exp(-(((x - 0.85) / 0.07) ** 2)), 'fx'],
  ['Tone', 'Filter', 'Resonant low-pass and high-pass', x => x < 0.62 ? 0.25 + 0.55 * Math.exp(-(((x - 0.62) / 0.05) ** 2)) : 0.8 - (x - 0.62) * 4.5, 'fx'],
  ['Dynamics', 'Compressor', 'Threshold, ratio, attack, makeup', x => (x < 0.5 ? x : 0.5 + (x - 0.5) * 0.25) * 1.7 - 0.85, 'fx'],
  ['Dynamics', 'Limiter', 'A ceiling nothing gets past', x => Math.sin(x * 30) * 1.25, 'fx'],
  ['Colour', 'Drive', 'Saturation with tone and mix', x => Math.tanh(Math.sin(x * 25) * 3) * 0.8, 'fx'],
  ['Colour', 'Tape', 'Saturation, wow and tone', x => Math.sin(x * 25 + Math.sin(x * 4) * 1.2) * 0.75, 'fx'],
  ['Colour', 'Bitcrush', 'Fewer bits, more grit', x => Math.round(Math.sin(x * 20) * 4) / 5, 'fx'],
  ['Modulation', 'Chorus', 'Wide and shimmering', x => (Math.sin(x * 25) + Math.sin(x * 26.5 + 1)) * 0.42, 'fx'],
  ['Modulation', 'Phaser', 'Sweeping notches', x => Math.sin(x * 25) * Math.cos(x * 5) * 0.8, 'fx'],
  ['Modulation', 'Flanger', 'Jet sweep with feedback', x => Math.sin(x * 25 + Math.sin(x * 3) * 4) * 0.8, 'fx'],
  ['Modulation', 'Tremolo', 'Volume that pulses', x => Math.sin(x * 60) * (0.5 + 0.5 * Math.sin(x * 12)) * 0.85, 'fx'],
  ['Space', 'Stereo width', 'From mono to wide', x => Math.sin(x * 20) * (0.15 + x * 0.75), 'fx'],
  ['Space', 'Delay', 'Tempo-synced, ping-pong', x => Math.exp(-(x * 5 % 1) * 14) * 0.6 ** Math.floor(x * 5) * Math.sin(x * 200), 'fx'],
  ['Space', 'Reverb', 'Rooms to halls, with tone', x => Math.sin(x * 977) * Math.sin(x * 313) * Math.exp(-x * 3.5), 'fx'],
  ['Coming next', 'FM, wavetable, sampler, slicer', 'More instruments on the roadmap', x => Math.sin(x * 30 + Math.sin(x * 45) * 2) * 0.7, 'next'],
  ['Coming next', 'Multiband, vocoder, gate', 'More effects on the roadmap', x => Math.sin(x * 40) * Math.sign(Math.sin(x * 9)) * 0.7, 'next'],
];
const track = $('#track');
track.innerHTML = PLUGINS.map(([cat, name, text, f, kind], i) => `<article class="card ${kind ?? ''}"><div class="cat"><span>${cat}</span><span>${String(i + 1).padStart(2, '0')}</span></div><svg viewBox="0 0 200 120" aria-hidden="true"><path d="${wavePath(f)}" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/></svg><div><h3>${name}</h3><p>${text}</p></div></article>`).join('');
function slideTrack() {
  const k = pinned($('#plugins')), travel = Math.max(0, track.scrollWidth - innerWidth);
  track.style.transform = `translateX(${-smooth(k) * travel}px)`;
}

// numbers roll like a counter when they arrive
const nums = [...document.querySelectorAll('.num b')];
const rolled = new Set();
function rollNumbers(now) {
  for (const b of nums) {
    if (rolled.has(b) && b.dataset.done) continue;
    const r = b.getBoundingClientRect();
    if (!rolled.has(b) && r.top < innerHeight * 0.9 && r.bottom > 0) { rolled.add(b); b.dataset.t0 = now; }
    if (!rolled.has(b)) continue;
    const k = still ? 1 : (now - b.dataset.t0) / 900;
    if (k >= 1) { b.textContent = b.dataset.to; b.dataset.done = 1; continue; }
    b.textContent = Math.floor(Math.random() * 10 ** String(b.dataset.to).length).toString();
  }
}

// the keys press themselves in turn when they come into view, and light up when you press them for real
const keyEls = [...document.querySelectorAll('.key')];
const press = el => { el.classList.add('down'); setTimeout(() => el.classList.remove('down'), 180); };
let keysPlayed = false;
function playKeys() {
  if (keysPlayed || !inView($('#keyboard')) || $('#keyboard').getBoundingClientRect().top > innerHeight * 0.7) return;
  keysPlayed = true;
  if (!still) keyEls.forEach((el, i) => setTimeout(() => press(el), 120 * i));
}
for (const el of keyEls) el.addEventListener('pointerdown', () => press(el));
addEventListener('keydown', e => {
  const name = (e.ctrlKey ? 'Ctrl ' : '') + (e.key === ' ' ? 'Space' : e.key.length === 1 ? e.key.toUpperCase() : e.key);
  const el = keyEls.find(k => k.querySelector('kbd').textContent === name);
  if (el && inView(el)) press(el);
});

// the door: an orange tab grows until it is the page, bars rise on it, OPEN STUDIO rolls past
const door = $('#door'), orange = $('#orange'), finale = $('#finale');
function openDoor() {
  if (!inView(door)) return;
  const k = pinned(door), g = smooth(seg(k, 0, 0.3)), w = innerWidth, h = innerHeight;
  const pt = (x0, x1, y0, y1) => `${lerp(x0, x1, g)}% ${lerp(y0, y1, g)}%`;
  orange.style.clipPath = `polygon(${pt(43, -40, 100, 110)}, ${pt(46, -20, 96, -10)}, ${pt(54, 120, 96, -10)}, ${pt(57, 140, 100, 110)})`;
  const bg = sizeCanvas($('#finbars'), w, h * 0.74), rise = out3(seg(k, 0.26, 0.45)), n = Math.round(w / 21), step = (w - 24) / n, bw = step * 0.5;
  bg.fillStyle = INK;
  if (rise > 0) for (let i = 0; i < n; i++) {
    const hh = Math.max(bw, peakAt((i / n + 0.37) % 1) * h * 0.72 * rise), x = 12 + (i + 0.5) * step;
    bg.beginPath(); bg.roundRect(x - bw / 2, h * 0.37 - hh / 2, bw, hh, bw / 2); bg.fill();
  }
  const roll = out3(seg(k, 0.4, 0.95));
  finale.style.opacity = seg(k, 0.3, 0.36);
  finale.style.transform = `translate(${lerp(w * 0.85, -(finale.scrollWidth - w * 0.98), roll)}px, -50%)`;
  const note = seg(k, 0.88, 0.98);
  $('#note').style.opacity = note;
  $('#note').style.pointerEvents = note > 0.5 ? 'auto' : 'none';
}

// one loop for the page: cheap checks every frame, real work only when something moved
let lastY = -1, lastT = 0;
function page(now) {
  requestAnimationFrame(page);
  const dt = Math.min(50, now - lastT || 16), y = scrollY, moved = y !== lastY;
  lastT = now;
  vel = lerp(vel, moved ? (y - lastY) / dt : 0, 0.1);
  if (lastY < 0) vel = 0;
  lastY = y;
  runBand(dt);
  rollNumbers(now);
  if (!moved && !page.dirty) return;
  page.dirty = false;
  $('#nav').classList.toggle('on', $('#tape').getBoundingClientRect().bottom < innerHeight * 0.4);
  inkWords();
  playSteps();
  sweepCompare();
  slideTrack();
  playKeys();
  openDoor();
}
page.dirty = true;
addEventListener('resize', () => { page.dirty = true; });
requestAnimationFrame(page);
