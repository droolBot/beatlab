// BeatLab UI parts: element builder, icons, knobs, faders, menus, pickers, switches, floating windows
// and toasts. No app state here.

export const $ = s => document.querySelector(s);

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k.startsWith('aria-')) el.setAttribute(k, String(v));  // aria-pressed="false" must be spelled out
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  el.append(...kids.flat().filter(k => k != null && k !== false));
  return el;
}

// 24px line icons, drawn with currentColor
const PATHS = {
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" stroke="none"/>',
  brain: '<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6zM18.5 14l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8zM6 15l.6 1.6 1.6.6-1.6.6L6 19.4l-.6-1.6L3.8 17.2l1.6-.6z"/>',
  listen: '<path d="M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0"/>',
  sounds: '<path d="M3.5 6.5h6l2 2h9v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/><path d="M14 16.5v-5l4-1v5"/><circle cx="12.6" cy="16.6" r="1.4"/><circle cx="16.6" cy="15.6" r="1.4"/>',
  rack: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M3.5 14.5h17M8.5 4.5v15"/>',
  piano: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M8 4.5v15M12 4.5v15M16 4.5v15"/><path d="M6.5 4.5h3v8h-3zM14.5 4.5h3v8h-3z" fill="currentColor"/>',
  mixer: '<path d="M6 4v16M12 4v16M18 4v16"/><rect x="4" y="13" width="4" height="3" rx="1" fill="currentColor"/><rect x="10" y="7" width="4" height="3" rx="1" fill="currentColor"/><rect x="16" y="11" width="4" height="3" rx="1" fill="currentColor"/>',
  playlist: '<path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17"/><rect x="5" y="4.5" width="6" height="4" rx="1" fill="currentColor"/><rect x="12" y="10" width="7" height="4" rx="1" fill="currentColor"/><rect x="7" y="15.5" width="5" height="4" rx="1" fill="currentColor"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  down: '<path d="M7 10l5 5 5-5"/>',
  left: '<path d="M14 7l-5 5 5 5"/>',
  right: '<path d="M10 7l5 5-5 5"/>',
  dice: '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/>',
  export: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20"/>',
  folder: '<path d="M3.5 6.5h6l2 2h9v10a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1z"/>',
  wave: '<path d="M2 12c2 0 2-6 4-6s2 12 4 12 2-9 4-9 2 6 4 6 2-3 4-3"/>',
  flag: '<path d="M6 21V4M6 4h11l-2 4 2 4H6"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  copy: '<rect x="8" y="8" width="11" height="11" rx="1.5"/><path d="M5 15V5h10"/>',
  knob: '<circle cx="12" cy="12" r="7"/><path d="M12 12V6"/>',
  record: '<circle cx="12" cy="12" r="5.5" fill="currentColor" stroke="none"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4"/>',
  moon: '<path d="M19.5 14.5A7.5 7.5 0 0 1 9.5 4.5a7.5 7.5 0 1 0 10 10z"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
  rec: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
  metro: '<path d="M8.5 20.5h7L13.2 4h-2.4z"/><path d="M12 15l5.5-8"/><path d="M6.5 20.5h11"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M7 14h10"/>',
  midi: '<circle cx="12" cy="12" r="8.5"/><circle cx="8" cy="11" r="0.9" fill="currentColor"/><circle cx="16" cy="11" r="0.9" fill="currentColor"/><circle cx="10" cy="15" r="0.9" fill="currentColor"/><circle cx="14" cy="15" r="0.9" fill="currentColor"/><circle cx="12" cy="8" r="0.9" fill="currentColor"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.4v.6"/><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none"/>',
  auto: '<path d="M3 17l5-6 4 3 5-7 4 4"/><circle cx="8" cy="11" r="1.4" fill="currentColor"/><circle cx="17" cy="7" r="1.4" fill="currentColor"/>',
  master: '<path d="M5 19V11M10 19V5M15 19V9M20 19v-5"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7"/>',
  cut: '<circle cx="6" cy="18" r="2.5"/><circle cx="6" cy="6" r="2.5"/><path d="M8 8l12 11M8 16L20 5"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  upload: '<path d="M12 16V4M7.5 8.5L12 4l4.5 4.5M5 19.5h14"/>',
  history: '<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5M12 8v4.5l3 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6"/><circle cx="12" cy="7.8" r=".9" fill="currentColor" stroke="none"/>',
  bypass: '<path d="M12 3v8"/><path d="M7 6.5a7 7 0 1 0 10 0"/>',
  up: '<path d="M7 14l5-5 5 5"/>',
  magnet: '<path d="M6 4v8a6 6 0 0 0 12 0V4h-4v8a2 2 0 0 1-4 0V4z"/><path d="M6 8h4M14 8h4"/>',
  pencil: '<path d="M4 20l4.5-1 10-10-3.5-3.5-10 10z"/><path d="M13.5 7l3.5 3.5"/>',
  brush: '<path d="M14 4l6 6-7.5 7.5-6-6z"/><path d="M6.5 11.5C4 12 3.5 14 3.5 16.5 5 18 7 20.5 8 20.5c2.5 0 4.5-.5 5-3"/>',
  eraser: '<path d="M9 20h11M5.5 15.5l8-8 5 5-6.5 6.5H8z"/><path d="M10 11l5 5"/>',
  mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
  select: '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><path d="M9.5 9.5l8 3-3.5 1-1 3.5z" fill="currentColor"/>',
  panel: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 14h17M8 17h.01M12 17h.01M16 17h.01"/>',
  pads: '<rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6" fill="currentColor"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
};
export function icon(name, size = 16) {
  const s = h('span', { class: 'icon', 'aria-hidden': 'true' });
  s.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${PATHS[name]}</svg>`;
  return s;
}

// Frequency-like ranges feel right on a log scale
const isLog = (min, max) => min > 0 && max / min >= 20;
const toUnit = (v, min, max) => isLog(min, max) ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
const fromUnit = (u, min, max) => isLog(min, max) ? min * (max / min) ** u : min + u * (max - min);
export const nice = v => Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.abs(v) >= 100 ? `${Math.round(v)}` : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2);

// Drag up and down (Shift for fine), scroll, arrow keys, double-click to reset
function control(el, { value, min, max, def, onInput, draw, label, show }) {
  let u = toUnit(value, min, max);
  const set = (nu, fire = true) => {
    u = Math.max(0, Math.min(1, nu));
    const v = fromUnit(u, min, max);
    el.setAttribute('aria-valuenow', nice(v));
    el.title = `${label}: ${nice(v)}`;
    draw(u);
    show?.(v);
    if (fire) onInput(v);
  };
  el.tabIndex = 0;
  el.setAttribute('role', 'slider');
  el.setAttribute('aria-label', label);
  el.setAttribute('aria-valuemin', min);
  el.setAttribute('aria-valuemax', max);
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add('active');
    let y = e.clientY;
    const move = ev => { set(u + (y - ev.clientY) / (ev.shiftKey ? 600 : 150)); y = ev.clientY; };
    const up = () => { el.classList.remove('active'); el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  });
  el.addEventListener('wheel', e => { e.preventDefault(); set(u - Math.sign(e.deltaY) * 0.03); }, { passive: false });
  el.addEventListener('dblclick', () => set(toUnit(def ?? value, min, max)));
  el.addEventListener('keydown', e => {
    const k = { ArrowUp: 0.02, ArrowRight: 0.02, ArrowDown: -0.02, ArrowLeft: -0.02, PageUp: 0.1, PageDown: -0.1 }[e.key];
    if (k) { e.preventDefault(); set(u + k * (e.shiftKey ? 0.25 : 1)); }
    if (e.key === 'Home') set(0);
    if (e.key === 'End') set(1);
  });
  set(u, false);
  return el;
}

// A hardware knob: a domed cap with a pointer that turns, inside a ring of tick marks that light up
// to the value (from the centre for pan-style controls). `metal` gives a brushed aluminium top.
// The label shows the value while the knob is being turned.
export function knob({ label, value, min, max, def, onInput, color = 'var(--accent)', size = 34, caption = label, fmt = nice, metal = size >= 50, hero = false }) {
  const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), c = size / 2;
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`);
  svg.setAttribute('class', 'ring');
  // a fine, dense tick ring like printed scales; tiny knobs and the hero knob use a value arc instead
  const n = hero || size < 30 ? 0 : size < 44 ? 21 : 33, r0 = c - Math.max(2.5, size * 0.07), r1 = c - 0.5;
  const bipolar = min < 0 && max > 0, mid = bipolar ? toUnit(0, min, max) : 0;
  const ticks = Array.from({ length: n }, (_, i) => {
    const u = i / (n - 1), a = Math.PI * 0.75 + u * Math.PI * 1.5, line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', c + r0 * Math.cos(a)); line.setAttribute('y1', c + r0 * Math.sin(a));
    line.setAttribute('x2', c + r1 * Math.cos(a)); line.setAttribute('y2', c + r1 * Math.sin(a));
    svg.append(line);
    return { line, u };
  });
  let arc = null;
  if (!n) {  // tiny knobs get a thin value arc instead of ticks
    const track = document.createElementNS(ns, 'path');
    arc = document.createElementNS(ns, 'path');
    track.setAttribute('class', 'arc-track');
    arc.setAttribute('class', 'arc');
    svg.append(track, arc);
  }
  const rr = c - (hero ? 3 : 1.5), path = (u0, u1) => {
    const a0 = Math.PI * 0.75 + u0 * Math.PI * 1.5, a1 = Math.PI * 0.75 + u1 * Math.PI * 1.5, p = a => `${c + rr * Math.cos(a)} ${c + rr * Math.sin(a)}`;
    return `M ${p(a0)} A ${rr} ${rr} 0 ${u1 - u0 > 2 / 3 ? 1 : 0} 1 ${p(a1)}`;
  };
  if (arc) svg.querySelector('.arc-track').setAttribute('d', path(0, 1));
  const dial = h('div', { class: 'dial' }, h('i', { class: 'pointer' })), cap = h('div', { class: 'cap' }, dial);  // only the pointer turns, the light stays put
  const out = caption ? h('span', { class: 'knob-label' }, caption) : null;
  const el = h('div', { class: `knob${metal ? ' metal' : ''}${hero ? ' hero' : n ? '' : ' tiny'}`, style: `--s:${size}px;--lit:${color}` }, h('div', { class: 'knob-body' }, svg, cap), out);
  return control(el, {
    value, min, max, def, onInput, label,
    show: out && (v => { if (el.classList.contains('active')) out.textContent = fmt(v); }),
    draw: u => {
      const [u0, u1] = u < mid ? [u, mid] : [mid, u];
      for (const t of ticks) t.line.classList.toggle('on', t.u >= u0 - 0.001 && t.u <= u1 + 0.001 && u1 - u0 > 0.004);
      if (arc) arc.setAttribute('d', u1 - u0 > 0.004 ? path(u0, u1) : '');
      dial.style.transform = `rotate(${-135 + u * 270}deg)`;
      if (out && !el.classList.contains('active')) out.textContent = caption;
    },
  });
}

// A console fader: a recessed slot with a scale, and a tall cap with a grip line
export function fader({ label, value, min = 0, max = 1, def, onInput }) {
  const thumb = h('div', { class: 'fader-thumb' }), fill = h('div', { class: 'fader-fill' });
  const el = h('div', { class: 'fader' }, h('div', { class: 'fader-scale' }), h('div', { class: 'fader-slot' }, fill), thumb);
  return control(el, { value, min, max, def, onInput, label, draw: u => { thumb.style.bottom = `${u * 100}%`; fill.style.height = `${u * 100}%`; } });
}

// Seven-segment readouts show the unlit "8"s behind the digits, like a real LCD
export function lcdText(el, text) {
  if (el.textContent === text) return;
  el.textContent = text;
  el.dataset.ghost = text.replace(/\d/g, '8');
}

// A menu that opens next to its anchor and closes on a pick, Escape, or a click elsewhere
let openMenu = null;
export function closeMenu() { openMenu?.remove(); openMenu = null; }
export function menu(anchor, items, { width } = {}) {
  closeMenu();
  const list = h('div', { class: 'menu', role: 'menu' }, items.map(it => it === '-' ? h('div', { class: 'menu-sep' })
    : it.heading ? h('div', { class: 'menu-head' }, it.heading)
    : h('button', {
      role: 'menuitemradio', 'aria-checked': !!it.active, class: `menu-item${it.danger ? ' danger' : ''}`, disabled: !!it.disabled, title: it.title,
      onclick: () => { closeMenu(); it.onSelect(); },
    }, it.swatch ? h('span', { class: 'swatch', style: `background:${it.swatch}` }) : it.icon ? icon(it.icon, 15) : h('span', { class: 'menu-check' }, it.active ? '✓' : ''), h('span', {}, it.label), it.hint ? h('small', {}, it.hint) : null)));
  document.body.append(list);
  const r = anchor.getBoundingClientRect(), w = width ?? Math.max(r.width, 180);
  list.style.minWidth = `${w}px`;
  const below = r.bottom + 4 + list.offsetHeight < innerHeight;
  list.style.left = `${Math.min(r.left, innerWidth - list.offsetWidth - 8)}px`;
  list.style.top = `${below ? r.bottom + 4 : Math.max(8, r.top - 4 - list.offsetHeight)}px`;
  openMenu = list;
  (list.querySelector('[aria-checked=true]') ?? list.querySelector('button'))?.focus();
  list.addEventListener('keydown', e => {
    const btns = [...list.querySelectorAll('button')], i = btns.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); btns[(i + 1) % btns.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); btns[(i - 1 + btns.length) % btns.length].focus(); }
    if (e.key === 'Escape') { closeMenu(); anchor.focus(); }
  });
  return list;
}
addEventListener('pointerdown', e => { if (openMenu && !openMenu.contains(e.target)) closeMenu(); }, true);

// A dropdown button that shows the current choice and opens a menu of options [{value, label, hint?, swatch?}]
export function picker({ value, options, onChange, label, className = '' }) {
  const current = options.find(o => o.value === value) ?? options[0];
  const btn = h('button', { type: 'button', class: `picker ${className}`, 'aria-haspopup': 'menu', 'aria-label': `${label}: ${current?.label}`, title: label },
    current?.swatch ? h('span', { class: 'swatch', style: `background:${current.swatch}` }) : null, h('span', { class: 'picker-text' }, current?.label ?? ''), icon('down', 14));
  btn.addEventListener('click', () => menu(btn, options.map(o => ({ ...o, active: o.value === value, onSelect: () => onChange(o.value) }))));
  return btn;
}

export function toggle({ checked, onChange, label, disabled = false }) {
  const input = h('input', { type: 'checkbox', role: 'switch', checked, disabled, onchange: e => onChange(e.target.checked) });
  return h('label', { class: `switch${disabled ? ' disabled' : ''}` }, input, h('span', { class: 'switch-track' }), h('span', {}, label));
}

// A floating window you can drag by its title bar, like FL Studio's plugin windows
export function floating(win, handle) {
  handle.addEventListener('pointerdown', e => {
    if (e.target.closest('button, select, input, .picker')) return;
    const r = win.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    handle.setPointerCapture(e.pointerId);
    const move = ev => {
      win.style.left = `${Math.max(0, Math.min(innerWidth - 80, ev.clientX - dx))}px`;
      win.style.top = `${Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy))}px`;
    };
    const up = () => { handle.removeEventListener('pointermove', move); handle.removeEventListener('pointerup', up); };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  });
}

// The one modal dialog: a title bar and whatever body the caller builds
export function openDialog({ title, glyph, body, wide = true }) {
  const dlg = $('#dlg');
  dlg.className = wide ? 'wide' : '';
  dlg.replaceChildren(
    h('div', { class: 'dhead' }, glyph ? icon(glyph, 16) : null, h('b', {}, title), h('span', { class: 'grow' }), h('button', { class: 'iconbtn', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => dlg.close() }, icon('close', 16))),
    h('div', { class: 'dbody' }, body));
  if (!dlg.open) dlg.showModal();
  return dlg;
}

// A command palette: type to filter [{label, group, hint, icon, run}]; parse(text) can offer a typed
// command of its own ({label, run}) that goes first
export function palette({ items, parse, placeholder }) {
  document.querySelector('.palette')?.remove();
  const input = h('input', { type: 'text', placeholder, 'aria-label': placeholder, autocomplete: 'off', spellcheck: 'false' });
  const list = h('div', { class: 'palette-list', role: 'listbox' });
  const wrap = h('div', { class: 'palette', onpointerdown: e => { if (e.target === wrap) close(); } }, h('div', { class: 'palette-box' }, input, list));
  let shown = [], at = 0;
  const close = () => wrap.remove();
  const go = it => { close(); it.run(); };
  const draw = () => {
    const q = input.value.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
    const typed = q ? parse?.(q) : null;
    shown = [...(typed ? [{ ...typed, group: 'Do it', icon: typed.icon ?? 'right' }] : []),
      ...items.filter(it => words.every(w => `${it.label} ${it.group ?? ''} ${it.keys ?? ''}`.toLowerCase().includes(w)))].slice(0, 60);
    at = Math.min(at, Math.max(0, shown.length - 1));
    let group = null;
    list.replaceChildren(...shown.flatMap((it, i) => {
      const head = it.group !== group ? h('div', { class: 'phead' }, (group = it.group)) : null;
      return [head, h('button', { role: 'option', 'aria-selected': i === at, onclick: () => go(it), onpointermove: () => { if (at !== i) { at = i; mark(); } } },
        icon(it.icon ?? 'right', 15), h('span', {}, it.label), it.keys ? h('small', {}, it.keys) : null)];
    }));
    if (!shown.length) list.replaceChildren(h('div', { class: 'phead' }, `Nothing matches. Try "tempo 140", "mute hats", "key G minor" or "make a trap beat".`));
  };
  const mark = () => list.querySelectorAll('[role=option]').forEach((b, i) => { b.setAttribute('aria-selected', String(i === at)); if (i === at) b.scrollIntoView({ block: 'nearest' }); });
  input.addEventListener('input', () => { at = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(shown.length - 1, at + 1); mark(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); mark(); }
    if (e.key === 'Enter' && shown[at]) { e.preventDefault(); go(shown[at]); }
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    e.stopPropagation();
  });
  document.body.append(wrap);
  draw();
  input.focus();
}

let toastTimer;
export function toast(msg, action) {
  const t = $('#toast');
  t.replaceChildren(h('span', {}, msg), ...(action ? [h('button', { class: 'btn', onclick: action.run }, action.label)] : []));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 9000 : 4500);
}
