// BeatLab deck: the KIKA turntable in 3D. It assembles itself on load, the record turns once per bar,
// the arm drops onto the record while playing, and the 16 pads light up with the drum pattern.
// Click a pad to program a step, click the record to play or stop, drag to look around.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const LED_ON = new THREE.Color('#FF7A2E'), NOW = new THREE.Color('#FFF4E0');
const ease = x => 1 - (1 - x) ** 3;

export async function createDeck(canvas, { onPad, onRecord }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, devicePixelRatio));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene(), pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  // A neutral studio light: a warm white key from the front-left and a cool grey rim from behind
  const warm = new THREE.DirectionalLight('#FFE9DA', 2.6), cool = new THREE.DirectionalLight('#C9D2DC', 1.5);
  warm.position.set(-5, 4, 4);
  cool.position.set(5, 3, -2.5);
  scene.add(warm, cool, new THREE.AmbientLight('#ffffff', 0.22));

  const camera = new THREE.PerspectiveCamera(28, 1.6, 0.1, 100);
  const controls = new OrbitControls(camera, canvas);
  Object.assign(controls, { enableDamping: true, enablePan: false, enableZoom: false, minPolarAngle: 0.35, maxPolarAngle: 1.3, minAzimuthAngle: -0.6, maxAzimuthAngle: 1.2 });

  const [gltf, exploded] = await Promise.all([
    new GLTFLoader().loadAsync('assets/turntable.glb'),
    fetch('assets/exploded.json').then(r => r.json()),
  ]);
  const model = gltf.scene;
  scene.add(model);
  model.traverse(o => {
    if (!o.isMesh) return;
    o.material.side = THREE.DoubleSide;  // some panels face inward, which Blender shows but WebGL hides
    o.material.envMapIntensity = 0.45;   // keep reflections subtle so the coloured lights lead
  });
  const part = name => model.getObjectByName(name);
  // The .blend's own camera: 50 mm lens at (2.6, -8.4, 4.6) aimed at (0, 0, 0.15), converted to Y-up.
  // Its 40° horizontal view is kept at any canvas shape.
  const fit = () => {
    camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(43) / 2) / camera.aspect));  // a little wider than 39.6° for margin
    camera.updateProjectionMatrix();
    camera.position.set(2.6, 4.6, 8.4);
    controls.target.set(0, 0.15, 0);
    controls.update();
  };

  // Assembly: every part flies from its exploded position to its place, bottom parts first
  const parts = Object.entries(exploded).map(([name, m], i) => {
    const obj = part(name), from = new THREE.Matrix4().fromArray(m);
    const a = { p: new THREE.Vector3(), q: new THREE.Quaternion(), s: new THREE.Vector3() }, b = { p: obj.position.clone(), q: obj.quaternion.clone(), s: obj.scale.clone() };
    from.decompose(a.p, a.q, a.s);
    return { obj, a, b, delay: i * 0.06 };
  });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || new URLSearchParams(location.hash.slice(1)).has('still');  // #still skips the intro
  let build = reduced ? Infinity : 0;

  // The record, platter and label spin on their own centres; the arm and headshell swing round the arm's base
  const spinners = ['platter', 'record', 'label'].map(part).filter(Boolean).map(o => ({ o, q: o.quaternion.clone() }));
  const arm = part('arm'), head = part('head'), pivot = arm.position.clone();
  const armQ = arm.quaternion.clone(), headQ = head?.quaternion.clone(), headP = head?.position.clone();
  const REST = 0.3;  // radians off the record when stopped: the headshell parks between the record and the knob
  let armAngle = REST;

  // Pads: the 16 pad groups left to right, each with a cap and a small LED
  const pads = [...part('pads').children].filter(g => /^pads_Group_\d+$/.test(g.name))
    .map(g => ({ g, x: g.getWorldPosition(new THREE.Vector3()).x }))
    .sort((p, q) => p.x - q.x).slice(0, 16)
    .map(({ g }) => {
      const mats = kind => g.children.filter(c => c.isMesh && c.name.includes(kind)).map(c => (c.material = c.material.clone()));
      const caps = mats('Extrude'), leds = mats('Cylinder');
      return { g, caps, leds, base: [...caps, ...leds].map(m => m.color.clone()) };
    });

  const raycaster = new THREE.Raycaster(), pointer = new THREE.Vector2();
  const hit = e => {
    const r = canvas.getBoundingClientRect();
    pointer.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const first = raycaster.intersectObject(model, true)[0];
    // the pads sit in a recessed strip whose frame is hit first, so a pad just behind it still counts
    const pad = raycaster.intersectObjects(pads.map(p => p.g), true)[0];
    if (pad && first && pad.distance - first.distance < 0.12) {
      for (let o = pad.object; o; o = o.parent) { const i = pads.findIndex(p => p.g === o); if (i >= 0) return { pad: i }; }
    }
    for (let o = first?.object; o; o = o.parent) {
      const i = pads.findIndex(p => p.g === o);
      if (i >= 0) return { pad: i };
      if (['record', 'label', 'platter'].includes(o.name)) return { record: true };
    }
    return first ? { object: first.object.name } : null;
  };
  let down = null;
  canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', e => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;  // a drag turns the view instead
    const h = hit(e);
    if (h?.pad != null) onPad(h.pad);
    else if (h?.record) onRecord();
  });
  canvas.addEventListener('pointermove', e => { if (e.buttons === 0) canvas.style.cursor = hit(e) ? 'pointer' : 'grab'; });

  let state = { playing: false, turns: 0, progress: 0, lit: [], now: -1 }, last = performance.now(), dirty = true;
  controls.addEventListener('change', () => { dirty = true; });
  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    fit();
    dirty = true;
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const axis = new THREE.Vector3(0, 1, 0), tmpQ = new THREE.Quaternion();
  let onScreen = true;
  new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }).observe(canvas);
  function frame(time) {
    requestAnimationFrame(frame);
    controls.update();
    const moving = build < 3 || state.playing || Math.abs(REST - armAngle) > 0.002;
    if (!onScreen || (!moving && !dirty)) return;  // nothing to see: leave the GPU alone
    if (!dirty && build >= 3 && time - last < 32) return;  // only spinning: 30 frames a second is plenty
    const dt = Math.min(0.05, (time - last) / 1000);
    last = time;
    dirty = false;
    if (build < 3) {
      build += dt;
      for (const { obj, a, b, delay } of parts) {
        const k = ease(Math.max(0, Math.min(1, (build - delay) / 1.6)));
        obj.position.lerpVectors(a.p, b.p, k);
        obj.quaternion.slerpQuaternions(a.q, b.q, k);
        obj.scale.lerpVectors(a.s, b.s, k);
      }
    }
    if (build >= 2.6) {  // spin and arm only once everything has landed
      tmpQ.setFromAxisAngle(axis, -state.turns * Math.PI * 2);
      for (const s of spinners) s.o.quaternion.copy(s.q).multiply(tmpQ);
      armAngle += ((state.playing ? -0.2 * state.progress : REST) - armAngle) * Math.min(1, dt * 5);  // creeps toward the label as the song plays
      tmpQ.setFromAxisAngle(axis, armAngle);
      arm.quaternion.copy(tmpQ).multiply(armQ);
      if (head) {
        head.position.copy(headP).sub(pivot).applyQuaternion(tmpQ).add(pivot);
        head.quaternion.copy(tmpQ).multiply(headQ);
      }
    }
    pads.forEach((p, i) => {
      const on = state.lit[i], now = state.now === i;
      [...p.caps, ...p.leds].forEach((m, k) => {
        const isLed = k >= p.caps.length;
        m.color.copy(p.base[k]);
        if (isLed && on) m.color.copy(LED_ON);
        else if (isLed) m.color.multiplyScalar(0.35);
        if (now) m.color.lerp(NOW, isLed ? 0.6 : 0.35);
        if (!m.emissive) return;  // unlit materials only change colour
        if (isLed && on) { m.emissive.copy(LED_ON); m.emissiveIntensity = 2.5; }
        else if (now) { m.emissive.copy(NOW); m.emissiveIntensity = 0.25; }
        else m.emissiveIntensity = 0;
      });
    });
    renderer.render(scene, camera);
  }
  requestAnimationFrame(frame);

  return {
    hitAt: (clientX, clientY) => hit({ clientX, clientY }),  // what a click at this point would touch
    pads: pads.length,
    // playing: arm on the record; turns: record rotation in turns (one per bar); progress: 0..1 through the song;
    // lit: 16 booleans; now: pad under the playhead
    update(next) {
      if (next.now !== state.now || next.playing !== state.playing || next.lit?.join() !== state.lit.join()) dirty = true;
      state = { ...state, ...next };
    },
  };
}
