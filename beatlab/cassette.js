// A pocket cassette player, modelled in layers so it can come apart: the lower body, the power and
// processor board, the tape transport, the tape, and the lid with its window and keys.
// Two finishes: 'ink' draws it like a photocopied technical print (halftone shading, ink outlines,
// controlled by shared uniforms), 'clear' is transparent plastic with a neon tape inside.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const W = 2.0, D = 1.5;  // width and depth; the top faces +Y, the keys sit at the back (-Z)

// ---------- the printed tape label ----------
export function labelTexture(kind) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 640;
  const g = c.getContext('2d'), ink = '#171a12';
  if (kind === 'ink') { g.fillStyle = '#ecefe2'; g.fillRect(0, 0, 1024, 640); }
  g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 6;
  const rr = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  // the top strip: a warning sign between two little reel windows
  rr(150, 28, 724, 150, 26); g.stroke();
  for (const x of [215, 809]) { g.beginPath(); g.arc(x, 75, 30, 0, Math.PI * 2); g.stroke(); }
  for (const x of [300, 690]) { rr(x, 52, 40, 40, 6); g.stroke(); }
  g.font = '700 38px "IBM Plex Mono", monospace'; g.textAlign = 'center';
  g.fillText('!! WARNING !!', 512, 88);
  g.font = '700 32px "IBM Plex Mono", monospace';
  g.fillText('REALLY BUSY, MAKING BEATS', 512, 148);
  for (const [x, d] of [[245, -1], [779, 1]]) {  // swooshes
    g.beginPath(); g.moveTo(x, 118); g.quadraticCurveTo(x + d * 60, 98, x + d * 150, 112); g.quadraticCurveTo(x + d * 60, 128, x, 118); g.fill();
  }
  // speaker rings and the reel windows
  g.lineWidth = 5;
  for (const [x, y] of [[190, 300], [834, 300], [190, 480], [834, 480]]) { g.beginPath(); g.arc(x, y, 72, 0, Math.PI * 2); g.stroke(); }
  for (const x of [330, 694]) {
    g.beginPath(); g.arc(x, 390, 66, 0, Math.PI * 2); g.lineWidth = 9; g.stroke();
    g.beginPath(); g.arc(x, 390, 34, 0, Math.PI * 2); g.lineWidth = 6; g.stroke();
    for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3; g.fillRect(x + Math.cos(a) * 38 - 7, 390 + Math.sin(a) * 38 - 7, 14, 14); }
  }
  // a producer with headphones, in the middle
  g.beginPath(); g.arc(512, 300, 46, 0, Math.PI * 2); g.fill();
  g.lineWidth = 12; g.beginPath(); g.arc(512, 300, 62, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
  for (const x of [448, 576]) { g.beginPath(); g.ellipse(x, 312, 16, 30, 0, 0, Math.PI * 2); g.fill(); }
  g.beginPath(); g.moveTo(512, 346); g.bezierCurveTo(430, 350, 392, 420, 382, 560); g.lineTo(642, 560); g.bezierCurveTo(632, 420, 594, 350, 512, 346); g.fill();
  g.fillStyle = kind === 'ink' ? '#ecefe2' : 'rgba(0,0,0,0)';
  if (kind !== 'ink') g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.moveTo(512, 380); g.lineTo(498, 470); g.lineTo(512, 520); g.lineTo(526, 470); g.fill();  // the shirt opening
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = ink;
  // print speckle down the sides, like the screen-printed original
  let s = 7;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 900; i++) {
    const side = rnd() < 0.5, x = side ? 60 + rnd() * 70 : 894 + rnd() * 70, y = 200 + rnd() * 380, r = rnd() * 6 + 1;
    if (rnd() < 0.55) { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
  }
  // the counter plate at the bottom
  g.lineWidth = 5;
  rr(290, 520, 444, 108, 14); g.stroke();
  g.font = '600 22px "IBM Plex Mono", monospace';
  g.textAlign = 'left'; g.fillText('BEATLAB', 312, 552); g.textAlign = 'center'; g.fillText('LOCAL STUDIO', 512, 552); g.textAlign = 'right'; g.fillText('KIKA', 712, 552);
  g.textAlign = 'center'; g.fillText('087 BPM · SIDE A', 512, 588);
  g.textAlign = 'left';
  ['-0', '-1', '-2', '-3'].forEach((t, i) => { g.fillText(t, 300, 572 + i * 14 - 14); });
  g.fillText('27/10/26', 600, 616); g.fillText('BL-S 087', 312, 616);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// ---------- the print look ----------
// One set of uniforms drives every ink material, so the whole model shifts between a line drawing
// (shade 0) and a dense halftone print (shade 1) together.
export function inkUniforms() {
  return {
    uPaper: { value: new THREE.Color('#AEB59B') }, uInk: { value: new THREE.Color('#171a12') },
    uShade: { value: 0 }, uArt: { value: 1 }, uDot: { value: 4.0 }, uLine: { value: 0.012 }, uLineAlpha: { value: 0.95 },
  };
}
function inkMaterial(U, tone = 1, map = null) {
  return new THREE.ShaderMaterial({
    uniforms: { ...U, uTone: { value: tone }, map: { value: map }, hasMap: { value: map ? 1 : 0 } },
    vertexShader: 'varying vec3 vN; varying vec2 vUv; void main() { vN = normalize(normalMatrix * normal); vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform vec3 uPaper; uniform vec3 uInk; uniform float uShade; uniform float uArt; uniform float uDot; uniform float uTone; uniform sampler2D map; uniform float hasMap;
      varying vec3 vN; varying vec2 vUv;
      void main() {
        vec3 L = normalize(vec3(-0.45, 0.55, 0.7));
        float lam = clamp(dot(normalize(vN), L), 0.0, 1.0);
        float tone = (0.3 + 0.7 * lam) * uTone;
        vec2 g = mat2(0.7071, -0.7071, 0.7071, 0.7071) * (gl_FragCoord.xy / uDot);  // a 45 degree print screen
        float r = sqrt(clamp(1.0 - tone, 0.0, 1.0)) * 0.78;
        float dots = 1.0 - smoothstep(r - 0.1, r + 0.1, length(fract(g) - 0.5));
        float ink = dots * uShade;
        if (hasMap > 0.5) {
          vec4 t = texture2D(map, vUv);
          float a = mix(1.0, dot(t.rgb, vec3(0.333)), t.a);
          ink = max(ink, (1.0 - smoothstep(0.3, 0.5, a)) * uArt);
        }
        float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 paper = uPaper * (0.95 + 0.08 * lam) + (n - 0.5) * 0.035;
        gl_FragColor = vec4(mix(paper, uInk, clamp(ink, 0.0, 1.0) * 0.93), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
function hullMaterial(U) {  // inverted hull: a slightly fattened back face, drawn in ink, outlines every silhouette
  return new THREE.ShaderMaterial({
    uniforms: U, side: THREE.BackSide, transparent: true, depthWrite: true,
    vertexShader: 'uniform float uLine; void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * uLine, 1.0); }',
    fragmentShader: `uniform vec3 uInk; uniform float uLineAlpha;
      void main() { gl_FragColor = vec4(uInk, uLineAlpha);
      #include <colorspace_fragment>
      }`,
  });
}

// ---------- the model ----------
export function buildPlayer(kind, U, env) {
  const ink = kind === 'ink', label = labelTexture(kind);
  const lineMat = new THREE.LineBasicMaterial({ color: '#171a12', transparent: true, opacity: 0.85 });
  const hull = ink ? hullMaterial(U) : null, glint = new THREE.LineBasicMaterial({ color: '#fbfff2', transparent: true, opacity: 0.45 });
  const M = ink ? {
    body: inkMaterial(U, 0.98), dark: inkMaterial(U, 0.35), plate: inkMaterial(U, 0.88), board: inkMaterial(U, 0.7), chip: inkMaterial(U, 0.45),
    shell: inkMaterial(U, 0.95), label: inkMaterial(U, 1, label), key: inkMaterial(U, 0.9), glass: null,
  } : {  // see-through plastic: alpha-blended so whatever is behind the canvas shows through, with strong reflections
    body: new THREE.MeshPhysicalMaterial({ color: '#f2f6ea', roughness: 0.04, metalness: 0, transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.6 }),
    dark: new THREE.MeshStandardMaterial({ color: '#1b1c19', roughness: 0.45, metalness: 0.4 }),
    plate: new THREE.MeshStandardMaterial({ color: '#2a2b27', roughness: 0.35, metalness: 0.7 }),
    board: new THREE.MeshStandardMaterial({ color: '#273020', roughness: 0.6, metalness: 0.2 }),
    chip: new THREE.MeshStandardMaterial({ color: '#121311', roughness: 0.4, metalness: 0.3 }),
    shell: new THREE.MeshPhysicalMaterial({ color: '#c8f23a', roughness: 0.25, transparent: true, opacity: 0.86, emissive: '#7aa315', emissiveIntensity: 0.45, clearcoat: 0.6, envMapIntensity: 1.2 }),
    label: new THREE.MeshStandardMaterial({ map: label, transparent: true, roughness: 0.6, emissive: '#2a3a08', emissiveIntensity: 0.15 }),
    key: new THREE.MeshPhysicalMaterial({ color: '#eef2e8', roughness: 0.08, transparent: true, opacity: 0.5, depthWrite: false, clearcoat: 1, envMapIntensity: 2.2 }),
    glass: new THREE.MeshPhysicalMaterial({ color: '#ffffff', roughness: 0.02, transparent: true, opacity: 0.1, depthWrite: false, clearcoat: 1, envMapIntensity: 3, side: THREE.DoubleSide }),
  };
  if (env) for (const m of Object.values(M)) if (m && 'envMap' in m) m.envMap = env;

  const add = (parent, geo, mat, x = 0, y = 0, z = 0, opts = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (opts.rx) m.rotation.x = opts.rx;
    if (opts.ry) m.rotation.y = opts.ry;
    if (opts.rz) m.rotation.z = opts.rz;
    parent.add(m);
    if (ink && opts.hull !== false) m.add(new THREE.Mesh(geo, hull));
    if (ink && opts.edges !== false) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, opts.crease ?? 38), lineMat));
    if (!ink && (mat === M.body || mat === M.key)) m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), glint));
    return m;
  };
  const box = (w, h, d, r = 0.02, seg = 3) => new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2 - 1e-3, h / 2 - 1e-3, d / 2 - 1e-3));
  const cyl = (r, h, n = 32) => new THREE.CylinderGeometry(r, r, h, n);
  const root = new THREE.Group(), layer = name => { const g = new THREE.Group(); g.name = name; root.add(g); return g; };

  // 1 the lower body: a rounded tub with vents along the front, a jack and four feet
  const body = layer('body');
  add(body, box(W, 0.72, D, 0.13, 5), M.body, 0, 0.36, 0);
  for (let i = 0; i < 9; i++) add(body, box(0.05, 0.16, 0.03, 0.012), M.dark, -0.56 + i * 0.14, 0.3, D / 2 + 0.002, { hull: false });
  add(body, cyl(0.045, 0.05), M.dark, W / 2 + 0.01, 0.42, 0.35, { rz: Math.PI / 2, hull: false });
  for (const [x, z] of [[-0.78, -0.55], [0.78, -0.55], [-0.78, 0.55], [0.78, 0.55]]) add(body, cyl(0.09, 0.05), M.dark, x, -0.02, z, { hull: false });
  // 2 power and processor: the board, chips, capacitors and the battery
  const pcb = layer('pcb');
  add(pcb, box(W - 0.24, 0.035, D - 0.24, 0.02), M.board, 0, 0.39, 0);
  for (const [x, z, w, d] of [[-0.55, 0.32, 0.34, 0.26], [0.05, 0.38, 0.22, 0.22], [0.42, 0.34, 0.16, 0.3], [0.7, -0.2, 0.18, 0.18], [-0.15, -0.32, 0.12, 0.12]]) add(pcb, box(w, 0.05, d, 0.01), M.chip, x, 0.43, z);
  for (const [x, z] of [[0.25, -0.25], [0.38, -0.25], [-0.75, -0.2], [0.75, 0.25]]) add(pcb, cyl(0.045, 0.12), M.plate, x, 0.47, z);
  add(pcb, box(0.62, 0.12, 0.3, 0.03), M.chip, -0.45, 0.47, -0.3);
  // 3 the tape transport: a plate with spindles, gears, the capstan and the head
  const mech = layer('mech');
  add(mech, box(W - 0.2, 0.03, D - 0.22, 0.02), M.plate, 0, 0.55, 0);
  for (const x of [-0.4, 0.4]) {
    add(mech, cyl(0.16, 0.025, 40), M.dark, x, 0.58, -0.02);
    for (let k = 0; k < 14; k++) { const a = k / 14 * Math.PI * 2; add(mech, new THREE.BoxGeometry(0.035, 0.025, 0.035), M.dark, x + Math.cos(a) * 0.17, 0.58, -0.02 + Math.sin(a) * 0.17, { ry: -a, hull: false, edges: false }); }
    add(mech, cyl(0.045, 0.12), M.plate, x, 0.63, -0.02);
  }
  add(mech, cyl(0.035, 0.14), M.plate, 0.66, 0.63, 0.42);
  add(mech, cyl(0.07, 0.1), M.dark, 0.5, 0.62, 0.44);
  add(mech, box(0.34, 0.12, 0.1, 0.02), M.plate, 0, 0.62, 0.5);
  // 4 the tape: shell, label, reel hubs
  const tape = layer('tape');
  add(tape, box(1.52, 0.13, 0.96, 0.05, 4), M.shell, 0, 0.73, 0.06);
  const lab = add(tape, new THREE.PlaneGeometry(1.42, 0.88), M.label, 0, 0.797, 0.06, { rx: -Math.PI / 2, hull: false, edges: false });
  lab.renderOrder = 2;
  for (const x of [-0.33, 0.33]) add(tape, cyl(0.075, 0.02, 6), M.dark, x, 0.805, -0.0, { hull: false });
  // 5 the lid: a frame round a window, a hinge strip along the back with four keys
  const lid = layer('lid'), lidHinge = new THREE.Group();
  lidHinge.position.set(0, 0.84, -D / 2);  // the lid swings open from its back edge
  lid.add(lidHinge);
  const shape = new THREE.Shape(), hole = new THREE.Path(), rect = (p, x, y, w, h, r) => { p.moveTo(x + r, y); p.lineTo(x + w - r, y); p.quadraticCurveTo(x + w, y, x + w, y + r); p.lineTo(x + w, y + h - r); p.quadraticCurveTo(x + w, y + h, x + w - r, y + h); p.lineTo(x + r, y + h); p.quadraticCurveTo(x, y + h, x, y + h - r); p.lineTo(x, y + r); p.quadraticCurveTo(x, y, x + r, y); };
  rect(shape, -W / 2, -D / 2, W, D, 0.14);
  rect(hole, -0.82, -0.55, 1.64, 1.04, 0.06);
  shape.holes.push(hole);
  const frame = new THREE.ExtrudeGeometry(shape, { depth: 0.09, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.025, bevelSegments: 1, curveSegments: 10 });
  frame.rotateX(-Math.PI / 2);
  const lidBody = add(lidHinge, frame, M.body, 0, -0.03, D / 2, { crease: 30 });
  if (M.glass) add(lidHinge, new THREE.PlaneGeometry(1.66, 1.06), M.glass, 0, 0.06, D / 2 + 0.03, { rx: -Math.PI / 2 });
  add(lidHinge, box(W - 0.14, 0.12, 0.26, 0.05), M.body, 0, 0.05, 0.13);
  [[-0.56, 0.26], [-0.25, 0.22], [0.06, 0.3], [0.4, 0.22]].forEach(([x, w]) => add(lidHinge, box(w, 0.12, 0.18, 0.04), M.key, x, 0.15, 0.02));
  add(lidHinge, box(0.18, 0.04, 0.07, 0.015), M.dark, 0.78, 0.13, 0.12);

  const layers = [body, pcb, mech, tape, lid].map(g => ({ g, y: g.position.y }));
  return { root, layers, lid: lidHinge, tape, lidBody, label };
}
