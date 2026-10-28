// BeatLab 3D knob: a rendered control sitting in a recessed well, with a ring of LED dots that light
// up to the chosen step, like the hardware it's modelled on. Drag up and down, scroll or use the arrow keys.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const ease = x => 1 - (1 - x) ** 3;
const MATERIALS = {  // body, well, cap top, screws; per theme
  dark: { body: '#2E2E2E', well: '#121212', top: '#383838', screw: '#7A7A7A', ledOff: '#2C2C2C' },
  light: { body: '#F2F2F2', well: '#D9D9D9', top: '#FFFFFF', screw: '#A8A8A8', ledOff: '#C9C9C9' },
};

export function knob3d(host, { steps, value, label, valueText, onChange, accent = '#FF6B2C' }) {
  const canvas = document.createElement('canvas');
  host.append(canvas);
  Object.assign(host, { tabIndex: 0 });
  host.setAttribute('role', 'slider');
  host.setAttribute('aria-label', label);
  host.setAttribute('aria-valuemin', 0);
  host.setAttribute('aria-valuemax', steps - 1);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(), pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  const camera = new THREE.PerspectiveCamera(29, 1, 0.1, 50);  // just wide enough that the cap and every LED stay in frame
  camera.position.set(0, 6.3, 4.3);
  camera.lookAt(0, 0.25, 0.1);
  const key = new THREE.DirectionalLight('#FFF4EA', 2.4);
  key.position.set(-2.5, 6, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.radius = 6;
  Object.assign(key.shadow.camera, { left: -2.5, right: 2.5, top: 2.5, bottom: -2.5, near: 1, far: 15 });
  const rim = new THREE.DirectionalLight('#BFD4FF', 0.7);
  rim.position.set(3, 3, -3);
  scene.add(key, rim, new THREE.AmbientLight('#ffffff', 0.18));

  const mat = (color, rough, metal) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, envMapIntensity: 0.5 });
  const M = { body: mat('#30343C', 0.5, 0.2), well: mat('#191B20', 0.85, 0.05), top: mat('#2A2E35', 0.42, 0.25), screw: mat('#6A707A', 0.3, 0.85) };

  // the well: a shallow cup cut into the faceplate
  const well = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0, -0.32), new THREE.Vector2(1.18, -0.32), new THREE.Vector2(1.3, -0.12), new THREE.Vector2(1.36, 0)], 72), M.well);
  well.material.side = THREE.DoubleSide;
  well.receiveShadow = true;
  scene.add(well);

  // the knob: a bell-shaped body rising to a capped neck, with four screws and a pointer notch
  const knob = new THREE.Group();
  const body = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0, -0.3), new THREE.Vector2(1.02, -0.3), new THREE.Vector2(1.06, -0.12), new THREE.Vector2(1.0, 0.12),
    new THREE.Vector2(0.86, 0.42), new THREE.Vector2(0.68, 0.66), new THREE.Vector2(0.56, 0.8), new THREE.Vector2(0.54, 0.88),
  ], 96), M.body);
  const cap = new THREE.Mesh(new THREE.LatheGeometry([
    new THREE.Vector2(0, 0.86), new THREE.Vector2(0.66, 0.86), new THREE.Vector2(0.71, 0.92), new THREE.Vector2(0.72, 1.08),
    new THREE.Vector2(0.69, 1.15), new THREE.Vector2(0.6, 1.18), new THREE.Vector2(0, 1.18),
  ], 96), M.top);
  for (const m of [body, cap]) { m.castShadow = true; m.receiveShadow = true; knob.add(m); }
  for (let i = 0; i < 4; i++) {
    const a = i / 4 * Math.PI * 2 + Math.PI / 4, screw = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 10), M.screw);
    screw.position.set(Math.cos(a) * 0.44, 1.18, Math.sin(a) * 0.44);
    screw.scale.y = 0.5;
    knob.add(screw);
  }
  const notch = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.22), new THREE.MeshStandardMaterial({ color: '#F4F5F7', emissive: '#FFFFFF', emissiveIntensity: 0.35, roughness: 0.4 }));
  notch.position.set(0, 1.19, -0.42);
  knob.add(notch);
  scene.add(knob);

  // LED dots around the well, sweeping 270 degrees from bottom-left to bottom-right
  const count = Math.max(steps, 12);
  const leds = Array.from({ length: count }, (_, i) => {
    const u = i / (count - 1), a = Math.PI * 0.75 + u * Math.PI * 1.5;
    const m = new THREE.MeshStandardMaterial({ color: '#14161A', emissive: '#000000', roughness: 0.4 });
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 14, 10), m);
    dot.position.set(Math.cos(a) * 1.68, 0.02, Math.sin(a) * 1.68);
    dot.scale.y = 0.45;
    scene.add(dot);
    return { m, u };
  });

  let index = value, shown = value / (steps - 1), from = shown, t0 = 0, theme = 'dark';
  const target = () => index / (steps - 1);
  const angle = u => Math.PI * 0.75 - u * Math.PI * 1.5;  // turning clockwise seen from above
  function paint() {
    const colors = MATERIALS[theme];
    M.body.color.set(colors.body); M.well.color.set(colors.well); M.top.color.set(colors.top); M.screw.color.set(colors.screw);
    for (const led of leds) {
      const on = led.u <= shown + 1e-3;
      led.m.color.set(on ? accent : colors.ledOff);
      led.m.emissive.set(on ? accent : '#000000');
      led.m.emissiveIntensity = on ? 1.6 : 0;
    }
    knob.rotation.y = angle(shown) - Math.PI / 2;
    renderer.render(scene, camera);
  }
  let raf = 0;
  function animate(now) {
    const k = Math.min(1, (now - t0) / 260);
    shown = from + (target() - from) * ease(k);
    paint();
    raf = k < 1 ? requestAnimationFrame(animate) : 0;
  }
  function go(i, fire = true) {
    i = Math.max(0, Math.min(steps - 1, i));
    if (i === index && raf) return;
    const changedIndex = i !== index;
    index = i;
    from = shown;
    t0 = performance.now();
    host.setAttribute('aria-valuenow', i);
    host.setAttribute('aria-valuetext', valueText(i));
    host.title = `${label}: ${valueText(i)}. Drag, scroll or use the arrow keys.`;
    if (!raf) raf = requestAnimationFrame(animate);
    if (fire && changedIndex) onChange(i);
  }

  host.addEventListener('pointerdown', e => {
    e.preventDefault();
    host.setPointerCapture(e.pointerId);
    host.classList.add('active');
    let y = e.clientY, acc = 0;
    const move = ev => {
      acc += y - ev.clientY;
      y = ev.clientY;
      if (Math.abs(acc) >= 14) { go(index + Math.sign(acc)); acc = 0; }  // one detent per 14 px
    };
    const up = () => { host.classList.remove('active'); host.removeEventListener('pointermove', move); host.removeEventListener('pointerup', up); };
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerup', up);
  });
  host.addEventListener('wheel', e => { e.preventDefault(); go(index - Math.sign(e.deltaY)); }, { passive: false });
  host.addEventListener('keydown', e => {
    const k = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 }[e.key];
    if (k) { e.preventDefault(); go(index + k); }
    if (e.key === 'Home') go(0);
    if (e.key === 'End') go(steps - 1);
  });

  const resize = () => {
    const w = host.clientWidth, hgt = host.clientHeight;
    if (!w) return;
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
    paint();
  };
  new ResizeObserver(resize).observe(host);
  resize();
  go(value, false);

  return {
    set: i => go(i, false),
    setTheme: t => { theme = t; paint(); },
  };
}
