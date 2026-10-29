// BeatLab's brain, the language part: turns what you type ("make the hook darker, add 808 slides every
// 4 bars and humanize the drums") into a list of studio actions the app carries out as one undoable step.
// Rules, not a cloud model: it runs instantly, offline and free. Anything it can't place comes back as an
// 'unknown' step, so it never guesses silently.

const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, ten: 10, twelve: 12, a: 1, an: 1 };
const num = w => (w == null ? null : /^\d+(\.\d+)?$/.test(w) ? +w : NUM[w] ?? null);
import { WARP_MODES, WARP_WHEN } from './dsp.js';

const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// Words for each part of the beat. Drums means every drum channel; the mix means everything.
const PARTS = [
  ['drums', /\b(drums?|kit|percussion|beat ?drums)\b/],
  ['kick', /\b(kicks?|bd|bass ?drum)\b/],
  ['snare', /\b(snares?|claps?)\b/],
  ['hat', /\b(hi-?hats?|hats?|hh)\b/],
  ['openhat', /\bopen ?hats?\b/],
  ['perc', /\b(perc|rim|shakers?|congas?)\b/],
  ['bass', /\b(808s?|bass(line)?|sub)\b/],
  ['chords', /\b(chords?|keys|pads?|piano|rhodes)\b/],
  ['arp', /\barp(eggio)?s?\b/],
  ['melody', /\b(melody|melodies|lead|hook melody|topline)\b/],
  ['texture', /\b(vinyl|crackle|texture)\b/],
  ['fx', /\b(fx|risers?|impacts?)\b/],
  ['vocals', /\b(vocals?|vox|voice|singing|rap|recordings?)\b/],
  ['mix', /\b(mix|everything|whole (beat|song|track)|master|it all)\b/],
];
// When a Time warp acts, by its knob's positions: every bar, every 2nd bar, the last beat of the bar, the last bar of 4
const WHEN = [
  [1, /\bevery (2nd|second|other) bar|every 2 bars\b/],
  [2, /\b(last beat|end of (each|every|the) bar|each bars end)\b/],
  [3, /\b(last bar|every (4|four) bars|every (4th|fourth) bar|end of (the |every |each )?(phrase|section|4 bars))\b/],
  [0, /\b(every bar|all the time|always|the whole (time|way)|throughout)\b/],
];
const SECTIONS = ['intro', 'hook', 'chorus', 'verse 2', 'verse', 'bridge', 'outro'];
const TONES = [
  ['darker', /\b(dark(er)?|duller|muffled|less bright|mellow(er)?)\b/],
  ['brighter', /\b(bright(er)?|crisp(er)?|airy|airier|clearer|more presence)\b/],
  ['warmer', /\b(warm(er)?|vintage|tape|analog(ue)?)\b/],
  ['grittier', /\b(gritt?(y|ier)|dirt(y|ier)|distort(ed|ion)?|crunch(y|ier)?|saturat(e|ed|ion)|harder|aggressive)\b/],
  ['wider', /\b(wide(r)?|stereo|bigger)\b/],
  ['narrower', /\b(narrow(er)?|mono)\b/],
  ['wetter', /\b(more reverb|wett?er|spacious|roomier|more space|ambient)\b/],
  ['drier', /\b(less reverb|dri?er|dry|tighter)\b/],
  ['echo', /\b(echo(es)?|more delay)\b/],
];

const clean = s => ` ${s.toLowerCase().replace(/[’']/g, '').replace(/\b(please|can you|could you|would you|i want( you)? to|i want|lets|let us|just|kindly|a bit|a little|slightly|some more|some|really|very|kinda|sort of)\b/g, ' ').replace(/\s+/g, ' ').trim()} `;
// Clauses: commas, semicolons, "and", "then", "also", "plus" (but not "rock and roll" style pairs inside a name)
const clauses = s => s.split(/[,;.!?]+|\b(?:and then|then|and also|also|plus|and|after that)\b/).map(x => x.trim()).filter(Boolean);

export function parts(text) { return PARTS.filter(([, re]) => re.test(text)).map(([id]) => id).filter((id, _, all) => !(id === 'hat' && all.includes('openhat') && !/\bclosed\b|\bhats?\b(?! *open)/.test(text.replace(/open ?hats?/g, '')))); }
const sectionOf = text => SECTIONS.find(s => text.includes(s)) ?? null;

// ctx: { tracks: [{ id, name, kind }], styles: [{ id, name }], effects: [{ id, name }], instruments: [name], kits: [name] }
export function plan(input, ctx) {
  const steps = [];
  let lastParts = [];
  for (const raw of clauses(input)) {
    const t = clean(raw), before = steps.length;
    let ps = parts(t);
    if (!ps.length && /\b(it|them|those|that)\b/.test(t)) ps = lastParts;  // "the hats ... and pan them left"
    const section = sectionOf(t);
    const push = (type, o = {}) => steps.push({ type, ...o, ...(section ? { section } : {}) });
    let m;
    if (/\b(full song|whole song|complete song|into a song|song out of|arrange (it|this|the beat)|song structure|build (a|the) song)\b/.test(t)) push('agent', { task: 'song' });
    else if (/\b(stop|pause)\b/.test(t) && !/\b(drums? stop|tape ?stop)\b/.test(t)) push('stop');
    else if (/^ (play|start)( it| the beat| the song| playing)? $/.test(t) || /\bplay (the )?(beat|song|hook|it)\b/.test(t)) push('play');
    else if ((m = t.match(/\b(make|create|give me|start|cook up|new)\b.*?\b(trap|drill|r ?& ?b|rnb|lo-?fi|boom ?bap|afro(beats?)?|amapiano|house|reggaeton|phonk|pop|desi( hip-?hop)?)\b(?:.*?(\d{2,3}) ?(?:bpm)?)?/))) {
      const name = m[2].replace(/\s/g, '');
      const style = ctx.styles.find(s => s.name.toLowerCase().replace(/[\s-]/g, '') === name || s.id === name || s.name.toLowerCase().replace(/[\s-]/g, '').startsWith(name.replace(/s$/, '').replace('-', '')) || (name.includes('&') && s.id === 'rnb'));
      if (style) push('make', { style: style.id, ...(m[5] ? { bpm: +m[5] } : {}) });
    }
    else if ((m = t.match(/\b(\d{2,3}) ?bpm\b/) ?? t.match(/\btempo (?:to |at |of )?(\d{2,3})\b/))) push('tempo', { bpm: +m[1] });
    else if ((m = t.match(/\b(faster|speed (it )?up|slower|slow (it )?down)\b(?: by (\d+))?/))) push('tempoBy', { delta: (/faster|up/.test(m[1]) ? 1 : -1) * (+m[4] || 5) });
    // Performance effects. "Half time" alone still halves the tempo; with a part or a when, it's the Time warp.
    else if ((m = t.match(/\b(half[ -]?time|stutter(?:s|ing)?|tape ?stop|revers(?:e|ed|ing))\b/)) && (ps.length || WHEN.some(([, re]) => re.test(t)) || !/half/.test(m[1]))) {
      const mode = /half/.test(m[1]) ? 0 : /stutter/.test(m[1]) ? (/\b(16(th)?s?|sixteenths?|fast(er)?)\b/.test(t) ? 2 : 1) : /tape/.test(m[1]) ? 3 : 4;
      const when = WHEN.find(([, re]) => re.test(t))?.[0] ?? [1, 2, 2, 3, 2][mode];
      push('fx', { parts: ps.length ? ps : ['mix'], fx: 'warp', set: { mode, when }, label: `${WARP_MODES[mode][0].toLowerCase()}, ${WARP_WHEN[when][0].toLowerCase()}` });
    }
    else if (/\b(auto-?tuned?|pitch[- ]correct(ion|ed)?|t-?pain)\b/.test(t) || /\btune (the |my )?(vocals?|vox|voice|singing|melody|lead|rap)\b/.test(t)) {
      const hard = /\b(hard|robot(ic)?|heavy|t-?pain|strong|full)\b/.test(t);
      push('fx', { parts: ps.length ? ps : ['vocals'], fx: 'tune', set: { speed: hard ? 0 : 0.12 }, label: hard ? 'hard and robotic' : 'natural' });
    }
    else if ((m = t.match(/\bpitch\b(?: [a-z0-9]+)*? (up|down)(?: by)?(?: (an octave|octave|a fifth|fifth|\d{1,2}))?/))) {
      const amt = m[2] ?? 'octave', semis = Math.min(12, /octave/.test(amt) ? 12 : /fifth/.test(amt) ? 7 : +amt), signed = (m[1] === 'up' ? 1 : -1) * semis;
      push('fx', { parts: ps.length ? ps : ['vocals'], fx: 'pitch', set: { semis: signed }, label: `${m[1]} ${semis === 12 ? 'an octave' : `${semis} semitone${semis === 1 ? '' : 's'}`}` });
    }
    else if (/\b(punch(ier|y)?|more attack|snappier|more snap|hit harder)\b/.test(t)) push('fx', { parts: ps.length ? ps : ['drums'], fx: 'transient', set: { attack: 0.8 }, label: 'more attack' });
    else if (/\b(shorter|less|tighter) (tails?|ring(ing)?|boom|sustain)\b/.test(t)) push('fx', { parts: ps.length ? ps : ['drums'], fx: 'transient', set: { attack: 0, sustain: -0.7 }, label: 'shorter tail' });
    else if (/\bdouble[ -]time\b/.test(t)) push('tempoTimes', { f: 2 });
    else if (/\bhalf[ -]time\b/.test(t)) push('tempoTimes', { f: 0.5 });
    else if ((m = t.match(/\b(?:key|in)(?: of)? ([a-g])(#| ?sharp| ?flat|b)? ?(major|minor|maj|min|m)?\b/)) && (m[3] || /\bkey\b/.test(t))) {
      const root = (NOTE[m[1]] + (/#|sharp/.test(m[2] ?? '') ? 1 : /flat|b/.test(m[2] ?? '') ? -1 : 0) + 12) % 12;
      push('key', { root, ...(m[3] ? { mode: /^maj/.test(m[3]) ? 'major' : 'minor' } : {}) });
    }
    else if (/\b(make it|go|switch to|in) (minor|sad(der)?)\b/.test(t)) push('key', { mode: 'minor' });
    else if (/\b(make it|go|switch to|in) (major|happ(y|ier))\b/.test(t)) push('key', { mode: 'major' });
    else if ((m = t.match(/\btranspose (?:it )?(up|down)? ?(?:by )?([+-]?\d{1,2})/))) push('transpose', { semis: (m[1] === 'down' ? -1 : 1) * Math.abs(+m[2]) * (m[2].startsWith('-') ? -1 : 1) });
    else if ((m = t.match(/\b(up|down) (?:an? )?(octave|semitone|step|half step|whole step)s?\b/)) && !ps.length) push('transpose', { semis: (m[1] === 'up' ? 1 : -1) * ({ octave: 12, semitone: 1, 'half step': 1, step: 2, 'whole step': 2 }[m[2]]) });
    else if ((m = t.match(/\b(\d{1,3}) ?% swing\b|\bswing (?:to |at )?(\d{1,3})/))) push('swing', { value: Math.min(100, +(m[1] ?? m[2])) / 200 });
    else if (/\b(more|add) swing|swing(ier| it)\b/.test(t)) push('swingBy', { delta: 0.06 });
    else if (/\b(less|no|remove) swing|straight(er|en)?\b/.test(t)) push('swingBy', { delta: /\bno\b/.test(t) ? -1 : -0.06 });
    else if ((m = t.match(/\b(?:ai|smart) (melody|drums)\b/))) push('ai', { what: m[1] });
    else if (/\bhumani[sz]e|human feel|feel human|less robotic|played feel|groove it\b/.test(t)) push('ai', { what: 'humanize' });
    else if (/\b(fill|drum roll|build ?up)\b/.test(t) && !/\bfilter/.test(t)) push('ai', { what: 'fill' });
    else if (/\b(vary|variation|switch up|change up|remix)\b/.test(t)) push('ai', { what: ps.some(p => ['melody', 'chords', 'arp', 'bass'].includes(p)) ? 'vary-melody' : 'vary-drums' });
    else if ((m = t.match(/\b(808|bass)? ?(slides?|glides?)\b(?:.*?every (\w+) bars?)?/)) && m[2]) push('slides', { every: num(m[3]) ?? 2 });
    else if ((m = t.match(/\b(hat|hi-?hat)? ?(rolls?|ratchets?|triplets)\b(?:.*?every (\w+) bars?)?/)) && m[2] && /hat|roll/.test(t)) push('hatRolls', { every: num(m[3]) ?? 2 });
    else if (/\b(check|diagnose|doctor|review|rate|whats wrong|what is wrong|feedback|how does (it|this|my \w+) sound)\b/.test(t) && /\b(mix|beat|song|track|it|this|doctor)\b/.test(t)) push('doctor');
    else if (/\b(hum|humming|sing|whistle)\b/.test(t) && !/\b(auto-?tune|tune)\b/.test(t)) push('hum');
    else if (/\b(auto[ -]?mix|mix it|balance|level (it|the mix)|fix the mix|mixdown)\b/.test(t)) push('automix');
    else if ((m = t.match(/\bexport\b.*?\b(mp3|wav|stems?|midi)?\b/)) && /\bexport\b/.test(t)) push('export', { fmt: /mp3/.test(t) ? 'mp3' : /stem/.test(t) ? 'stems' : /midi/.test(t) ? 'midi' : 'wav' });
    else if ((m = t.match(/\b(new|different|another|change the|rewrite( the)?|regenerate( the)?|redo( the)?)\b.*?\b(drums?|chords?|bass(line)?|808|melody|lead)\b/))) {
      const p = /drum/.test(m[5]) ? 'drums' : /chord/.test(m[5]) ? 'chords' : /bass|808/.test(m[5]) ? 'bass' : 'melody';
      push(/\b(ai|smart)\b/.test(t) && (p === 'melody' || p === 'drums') ? 'ai' : 'regen', /\b(ai|smart)\b/.test(t) && (p === 'melody' || p === 'drums') ? { what: p } : { part: p });
    }
    else if (/\b(busier|more (energy|hits|going on)|hype(r)?|fuller drums|harder drums)\b/.test(t)) push('energy', { delta: 0.25 });
    else if (/\b(sparser|simpler|calmer|chill(er)?|less busy|more minimal|fewer hits|stripped)\b/.test(t)) push('energy', { delta: -0.25 });
    else if ((m = t.match(/\b(mute|unmute|solo|unsolo)\b/))) push(m[1].includes('solo') ? 'solo' : 'mute', { parts: ps, on: !m[1].startsWith('un') });
    else if ((m = t.match(/\bpan\b.*?\b(left|right|center|centre|middle)\b/))) push('pan', { parts: ps, value: m[1] === 'left' ? -0.5 : m[1] === 'right' ? 0.5 : 0 });
    else if ((m = t.match(/\b(louder|quieter|softer|turn\b.*?\b(?:up|down)|raise|lower|boost|bring\b.*?\b(?:up|down)|more|less)\b/)) && (ps.length || !/^(more|less)$/.test(m[1])) && !TONES.some(([, re]) => re.test(t)) && !/\breverb|delay|echo|swing\b/.test(t)) {
      const up = /louder|\bup\b|raise|boost|more/.test(m[1]), dB = +(t.match(/(\d+) ?db\b/)?.[1] ?? 3);
      push('vol', { parts: ps.length ? ps : ['mix'], dB: (up ? 1 : -1) * dB });
    }
    else if ((m = t.match(/\b(?:remove|delete|take off|get rid of)\b(?: the)? (.+?)\b(?:from|on|off)\b/))) {
      const fx = ctx.effects.find(f => m[1].includes(f.name.toLowerCase()) || m[1].includes(f.id));
      push('unfx', { parts: ps, fx: fx?.id ?? null });
    }
    else if ((m = t.match(/\b(?:add|put|use|throw)\b(?: an?| some| the)? (.+?)(?: on| to| for| onto)\b/)) && ctx.effects.some(f => m[1].includes(f.name.toLowerCase()) || m[1] === f.id)) {
      const fx = [...ctx.effects].sort((a, b) => b.name.length - a.name.length).find(f => m[1].includes(f.name.toLowerCase()) || m[1] === f.id);
      push('fx', { parts: ps.length ? ps : ['mix'], fx: fx.id });
    }
    else if ((m = t.match(/\b(?:use|load|put|switch (?:to|the)?|try|give (?:it|me))\b(?: an?| the)? (.+?) (?:kit|drums)\b/)) && findName(ctx.kits, m[1])) push('kit', { name: findName(ctx.kits, m[1]) });
    else if ((m = t.match(/\b(?:use|load|put|switch to|try|play)\b(?: an?| the)? (.+?)(?: on| for| as)(?: the)? \w+/)) && findName(ctx.instruments, m[1])) push('instrument', { parts: ps.length ? ps.filter(p => p !== 'mix') : ['chords'], name: findName(ctx.instruments, m[1]) });
    else if ((m = t.match(/\b(\w[\w ]*?) on (?:the )?(chords?|keys|melody|lead|bass|arp)\b/)) && findName(ctx.instruments, m[1])) push('instrument', { parts: parts(` ${m[2]} `), name: findName(ctx.instruments, m[1]) });
    else {
      const tone = TONES.find(([, re]) => re.test(t));
      if (tone) push('tone', { parts: ps.length ? ps : ['chords', 'melody', 'arp'], dir: tone[0] });
    }
    const prev = steps.at(-1);
    if (steps.length === before && ps.length && prev?.parts && !/\b(add|make|use|put|new)\b/.test(t)) {  // "turn up the kick and the snare by 2 db": more parts for the same step
      prev.parts = [...new Set([...prev.parts.filter(p => p !== 'mix'), ...ps])];
      const dB = t.match(/(\d+) ?db\b/)?.[1];
      if (dB && prev.type === 'vol') prev.dB = Math.sign(prev.dB) * +dB;
      lastParts = prev.parts;
      continue;
    }
    if (steps.length === before) steps.push({ type: 'unknown', text: raw.trim() });
    else lastParts = ps.length ? ps : lastParts;
  }
  return steps;
}
// What the smart brain (a language model) replies, as one request the rules can read: a command per line,
// with any bullets, numbering, quotes or chatter around them taken off
export function fromModel(reply) {
  return reply.split(/\n+/).map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["'`]+|["'`.]+$/g, '').trim())
    .filter(l => l && l.length < 80 && !/^(here|sure|ok|okay|these|i |commands?:)/i.test(l)).join(', ');
}

// The longest known name that the words mention, or one they start
function findName(names, words) {
  const w = words.trim().replace(/^(the|an?|my) /, '');
  return [...names].sort((a, b) => b.length - a.length).find(n => w.includes(n.toLowerCase()) || n.toLowerCase().startsWith(w)) ?? null;
}

// How each step reads back to you
const LIST = xs => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] ?? '');
export function describe(step, names = {}) {
  const who = LIST((step.parts ?? []).map(p => names[p] ?? p));
  const where = step.section ? ` in the ${step.section}` : '';
  switch (step.type) {
    case 'make': return `Make a new ${names[step.style] ?? step.style} beat${step.bpm ? ` at ${step.bpm} BPM` : ''}`;
    case 'tempo': return `Set the tempo to ${step.bpm} BPM`;
    case 'tempoBy': return `${step.delta > 0 ? 'Speed up' : 'Slow down'} by ${Math.abs(step.delta)} BPM`;
    case 'tempoTimes': return step.f > 1 ? 'Double the tempo' : 'Halve the tempo';
    case 'key': return `Change the key to ${[step.root != null ? ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'][step.root] : null, step.mode].filter(Boolean).join(' ')}`;
    case 'transpose': return `Transpose ${step.semis > 0 ? 'up' : 'down'} ${Math.abs(step.semis)} semitone${Math.abs(step.semis) === 1 ? '' : 's'}`;
    case 'swing': return `Set swing to ${Math.round(step.value * 200)}%`;
    case 'swingBy': return step.delta <= -1 ? 'Take the swing out' : step.delta > 0 ? 'Add swing' : 'Less swing';
    case 'ai': return { humanize: `Humanize the drums${where}`, fill: `Play a drum fill${where}`, 'vary-drums': `Vary the drums${where}`, 'vary-melody': `Vary the melody${where}`, melody: `AI melody${where}`, drums: `AI drums${where}` }[step.what];
    case 'slides': return `Add 808 slides every ${step.every} bar${step.every === 1 ? '' : 's'}${where}`;
    case 'hatRolls': return `Add hi-hat rolls every ${step.every} bar${step.every === 1 ? '' : 's'}${where}`;
    case 'automix': return 'Balance the mix';
    case 'doctor': return 'Check the mix with the mix doctor';
    case 'agent': return 'Turn this pattern into a full song: intro, verse, hook, bridge and outro, with a fill and a balanced mix';
    case 'hum': return 'Listen to you hum a melody and write it down';
    case 'export': return `Open the export, ${step.fmt.toUpperCase()}`;
    case 'regen': return `New ${step.part}`;
    case 'energy': return step.delta > 0 ? 'Busier drums' : 'Simpler drums';
    case 'mute': return `${step.on ? 'Mute' : 'Unmute'} ${who}`;
    case 'solo': return `${step.on ? 'Solo' : 'Unsolo'} ${who}`;
    case 'pan': return `Pan ${who} ${step.value < 0 ? 'left' : step.value > 0 ? 'right' : 'to the centre'}`;
    case 'vol': return `${step.dB > 0 ? 'Turn up' : 'Turn down'} ${who} by ${Math.abs(step.dB)} dB`;
    case 'fx': return `Add ${names[step.fx] ?? step.fx}${step.label ? ` (${step.label})` : ''} to ${who}`;
    case 'unfx': return `Remove ${step.fx ? names[step.fx] ?? step.fx : 'the effects'} from ${who}`;
    case 'kit': return `Load the ${step.name} kit`;
    case 'instrument': return `Play ${who} on ${step.name}`;
    case 'tone': return `Make ${who} ${step.dir}`;
    case 'play': return 'Play';
    case 'stop': return 'Stop';
    default: return `Didn't understand "${step.text}"`;
  }
}
