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

// ---------- everyday language: complaints, moods, slang and sound swaps, checked before the rules below ----------
const STYLE_WORDS = [['trap', /\btrap\b/], ['drill', /\bdrill\b/], ['rnb', /\br ?& ?b\b|\brnb\b/], ['lofi', /\blo-?fi\b|\bchill(hop)?\b|\bstudy\b|\brelax(ing|ed)?\b/],
  ['boombap', /\bboom ?bap\b|\bold school\b|\b90s\b/], ['afro', /\bafro(beats?)?\b/], ['amapiano', /\bamapiano\b/], ['house', /\bhouse\b/], ['reggaeton', /\breggaeton\b/],
  ['phonk', /\bphonk\b/], ['pop', /\bpop\b(?! smoke)/], ['desi', /\bdesi\b/]];
const ARTISTS = [['trap', /\b(travis|metro( boomin)?|future|21 savage|young thug|lil baby|gunna|carti|southside|wheezy|808 mafia|lil uzi)\b/], ['drill', /\b(pop smoke|central cee|headie|chief keef|fivio|digga d|kay flock)\b/],
  ['rnb', /\b(drake|weeknd|sza|bryson|6lack|partynextdoor|brent faiyaz)\b/], ['lofi', /\b(nujabes|lofi girl)\b/], ['boombap', /\b(j ?dilla|dj premier|nas|biggie|mf doom|alchemist)\b/],
  ['afro', /\b(burna|wizkid|rema|davido|tems)\b/], ['reggaeton', /\b(bad bunny|daddy yankee|balvin)\b/], ['desi', /\b(divine|seedhe maut|krsna|badshah|raftaar)\b/]];
// sounds a part can be switched to: [BeatLab sound id, words for it]
const SOUND_WORDS = [['piano', /\b(piano|grand)\b/], ['keys', /\b(rhodes|electric piano|e-?piano|keys)\b/], ['organ', /\borgan\b/], ['pad', /\bpads?\b/], ['strings', /\b(strings|violins?|orchestra)\b/],
  ['guitar', /\bguitars?\b/], ['sitar', /\bsitar\b/], ['pluck', /\bplucks?\b/], ['bell', /\bbells?\b/], ['flute', /\bflutes?\b/], ['lead', /\b(synth lead|lead synth)\b/], ['synth', /\bsynth\b/],
  ['vox', /\b(choir|vocal synth|voices?)\b/], ['brass', /\b(brass|horns?|trumpets?)\b/], ['reese', /\breese\b/], ['acid', /\bacid\b/], ['fm', /\bfm\b/], ['wave', /\bwavetable\b/]];
export const SOUND_NAMES = { piano: 'Piano', keys: 'Electric piano', organ: 'Organ', pad: 'Pad', strings: 'Strings', guitar: 'Guitar', sitar: 'Sitar', pluck: 'Pluck', bell: 'Bell', flute: 'Flute', lead: 'Synth lead', synth: 'Trio synth', vox: 'Vocal synth', brass: 'Brass', reese: 'Reese bass', acid: 'Acid bass', fm: 'FM synth', wave: 'Wavetable' };
const LOUD = /\b(too (loud|much|hot|strong|big|harsh)|overpowering|drowning|clipping|way loud)\b/, QUIET = /\b(too (quiet|soft|low|weak|small)|(not|isnt|aint|doesnt|dont|wont) (hit(ting)?|knock(ing)?|slap(ping)?|bang(ing)?|cut(ting)? through)|cant hear|can not hear|buried|weak|lost in the mix|hit harder|knock(s)? more|more knock|hard(er)? hitting)\b/;
const MOOD = [['minor', /\b(sad(der)?|emotional|melanchol(y|ic)|evil|sinister|scary|spooky|moody|depress(ed|ing)|heartbreak|pain(ful)?|cry)\b/], ['major', /\b(happ(y|ier)|uplifting|joyful|cheerful|positive|summery|feel good)\b/]];
const BORING = /\b(boring|repetitive|stale|plain|basic|mid|trash|sucks|bad|wack|weak|lame|not good|ugly|dont like|hate|not feeling|not vibing|not a fan)\b/;
function early(t, ps, push, ctx) {
  let m;
  const style = STYLE_WORDS.find(([, re]) => re.test(t))?.[0] ?? ARTISTS.find(([, re]) => re.test(t))?.[0] ?? null;
  const bpm = +(t.match(/\b(\d{2,3})\b/)?.[1] ?? 0), mood = MOOD.find(([, re]) => re.test(t))?.[0];
  const asksBeat = /\b(make|create|cook( up)?|generate|start|give me|produce|build|whip up|do|need)\b( me)?( (a|an|another|new|fresh|some|something))? .*?\b(beats?|track|instrumental|banger|tune|something|riddim)\b/.test(t) && !/\b(faster|slower|louder|quieter|darker|brighter|full song|whole song|longer)\b/.test(t)
    || /^ ?(a |an |another |new |make )?([\w&-]+ )?(type )?(beat|banger|instrumental)( pls| plz| please| now)? ?$/.test(t) || (style && /\b(type beat|beat)\b/.test(t) && !ps.length);
  if (asksBeat && !/\b(drums?|kick|snare|hats?)\b.*\bbeat\b/.test(t)) {
    push('make', { style: ctx.styles.some(s => s.id === style) ? style : null, ...(bpm >= 50 && bpm <= 200 ? { bpm } : {}) });
    if (mood) push('key', { mode: mood });
    if (/\b(hard|aggressive|hype|crazy|insane|heavy|banger|energetic)\b/.test(t)) push('energy', { delta: 0.25 });
    return true;
  }
  // a part's sound: "make the melody a flute", "use a piano for the chords", "put a bell melody"
  const sound = SOUND_WORDS.find(([, re]) => re.test(t))?.[0];
  const melodicPs = ps.filter(p => ['chords', 'melody', 'arp', 'bass'].includes(p) && !(p === 'chords' && /\b(piano|rhodes|keys|pads?)\b/.test(t) && !/\bchords?\b/.test(t)));
  if (sound && !ctx.instruments.some(n => t.includes(n.toLowerCase())) && /\b(make|turn|switch|change|use|put|swap|replace|play|try|give)\b/.test(t) && (melodicPs.length || /\b(melody|lead|chords?)\b/.test(t)) && !/\b(louder|quieter|reverb|delay|mute|solo|pan)\b/.test(t)) {
    push('sound', { parts: melodicPs.length ? melodicPs : ['melody'], sound });
    return true;
  }
  if (/\b(side ?chain(ed|ing)?|duck(ed|ing)?|pump(ing|s)?)\b/.test(t)) { const who = ps.filter(p => p !== 'kick' && p !== 'drums'); push('duck', { parts: who.length ? who : ['bass'], value: /\b(no|remove|less|off|stop|without)\b/.test(t) ? 0 : 0.6 }); return true; }
  if (/\btoo slow\b|\bdragging\b/.test(t)) { push('tempoBy', { delta: 5 }); return true; }
  if (/\btoo fast\b|\brushing\b/.test(t) && !ps.length) { push('tempoBy', { delta: -5 }); return true; }
  if ((m = t.match(/\bbpm (?:to |at |of |is |= ?)?(\d{2,3})\b/))) { push('tempo', { bpm: +m[1] }); return true; }
  if ((m = t.match(/\bkey (?:to |of |in |into )?([a-g])(#| ?sharp| ?flat|b)? ?(major|minor|maj|min|m)?\b/))) {
    const root = (NOTE[m[1]] + (/#|sharp/.test(m[2] ?? '') ? 1 : /flat|b/.test(m[2] ?? '') ? -1 : 0) + 12) % 12;
    push('key', { root, ...(m[3] ? { mode: /^maj/.test(m[3]) ? 'major' : 'minor' } : {}) });
    return true;
  }
  if ((m = t.match(/\b(?:to|in|into) ([a-g])(#| sharp| flat|b)? (major|minor)\b/))) { push('key', { root: (NOTE[m[1]] + (/#|sharp/.test(m[2] ?? '') ? 1 : /flat|b/.test(m[2] ?? '') ? -1 : 0) + 12) % 12, mode: m[3] }); return true; }
  if (mood && !ps.filter(p => p !== 'mix').length && !/\b(darker|brighter)\b/.test(t) || mood && /\b(melody|chords)\b/.test(t)) { push('key', { mode: mood }); return true; }
  if ((m = t.match(/\b(up|down) (?:an? )?(octave|semitone)s?\b/)) && (!ps.length || ps.every(p => p === 'mix'))) { push('transpose', { semis: (m[1] === 'up' ? 1 : -1) * (m[2] === 'octave' ? 12 : 1) }); return true; }
  // complaints about levels: "the kick is too quiet", "808 not hitting", "drums too loud"
  if (ps.length && (LOUD.test(t) || QUIET.test(t)) && !/\b(reverb|delay|echo)\b/.test(t)) {
    const up = QUIET.test(t) && !LOUD.test(t);
    if (/\b(hit harder|knock|punch)\b/.test(t) && ps.some(p => ['drums', 'kick', 'snare'].includes(p))) push('fx', { parts: ps, fx: 'transient', set: { attack: 0.8 }, label: 'more attack' });
    else push('vol', { parts: ps, dB: up ? 3 : -3 });
    return true;
  }
  if (/\b(hit harder|knock(s)? more|more knock|slap(s)? (more|harder)|bang harder)\b/.test(t)) { push('fx', { parts: ps.length ? ps : ['drums'], fx: 'transient', set: { attack: 0.8 }, label: 'more attack' }); return true; }
  if (/\b(crack|snappy|snappier|more snap)\b/.test(t) && ps.length) { push('fx', { parts: ps, fx: 'transient', set: { attack: 0.8 }, label: 'more attack' }); return true; }
  // "remove the hats", "take out the melody", "add vinyl", "bring back the 808"
  if (/\b(remove|delete|get rid of|take out|take away|drop|cut|kill|lose)\b/.test(t) && ps.length && !ctx.effects.some(f => t.includes(f.name.toLowerCase())) && !/\b(effects?|fx|plugins?)\b/.test(t) && !/\bfrom\b/.test(t)) { push('mute', { parts: ps, on: true }); return true; }
  if ((/\b(bring back|add back|put back|unmute|turn on)\b/.test(t) || (/\badd\b/.test(t) && ps.includes('texture'))) && ps.length) { push('mute', { parts: ps, on: false }); return true; }
  if ((m = t.match(/\b(take|strip|remove|clear)\b.*?\b(all )?(the )?(effects?|fx|plugins?)\b.*?\b(off|from|on)\b/))) { push('unfx', { parts: ps.length ? ps : ['mix'], fx: null }); return true; }
  // hats faster means rolls, not tempo
  if (ps.includes('hat') && /\b(faster|quicker|rolls?|triplets?|trap hats|more hats)\b/.test(t) && !/\bbpm\b/.test(t)) { push('hatRolls', { every: num(t.match(/every (\w+) bars?/)?.[1]) ?? 2 }); return true; }
  if (/^ ?bounce( it| out| the (beat|song|track|mix))? ?$/.test(t)) { push('export', { fmt: 'wav' }); return true; }
  // feel
  if (/\b(bounce|bouncy|bouncier|groove|groovy|groovier|swingy|more swing|shuffle)\b/.test(t) && !/\b(no|less|remove)\b/.test(t)) { push('swingBy', { delta: 0.06 }); return true; }
  if (/\b(sound|feel|more) human\b|\bhuman\b.*\b(drums|feel)\b|\brobotic\b/.test(t)) { push('ai', { what: 'humanize' }); return true; }
  // vague verdicts: boring, empty, too busy, better, professional, muddy
  if (BORING.test(t) && !/\b(make|add|remove)\b.*\b(boring)\b/.test(t)) {
    const melodic = ps.find(p => ['melody', 'chords', 'bass'].includes(p));
    if (melodic && /\b(trash|sucks|bad|wack|ugly|not good|weak|lame|dont like|hate|not feeling|not vibing|not a fan)\b/.test(t)) push('regen', { part: melodic === 'bass' ? 'bass' : melodic });
    else push('ai', { what: melodic ? 'vary-melody' : 'vary-drums' });
    return true;
  }
  if (/\b(better|fresh(er)?|another|replace|redo)\b/.test(t) && (m = t.match(/\b(drums?|chords?|bass(line)?|808|melody|lead)\b/))) { const p = /drum/.test(m[1]) ? 'drums' : /chord/.test(m[1]) ? 'chords' : /bass|808/.test(m[1]) ? 'bass' : 'melody'; push('regen', { part: p }); return true; }
  if (/\b(empty|thin|bare|sparse|needs more|add more( stuff)?|fuller|thicker|more going on|add (some )?energy|more energy|more hype)\b/.test(t) && !ps.filter(p => p !== 'mix').length) { push('energy', { delta: 0.25 }); return true; }
  if (/\b(too (busy|much going on|cluttered|crowded)|too much going on|cluttered|crowded|overcrowded|chaotic)\b/.test(t)) { push('energy', { delta: -0.25 }); return true; }
  if (/\b(muddy|mud|boomy|harsh|messy|unbalanced|(sounds?|feels?|is|are) (off|weird|wrong|cheap|amateur|annoying)|sounds? bad|sound (better|pro(fessional)?|clean(er)?|good)|polish|is (my|the|this) mix|mix good|sound good|any problems)\b/.test(t)) { push('doctor'); return true; }
  if (/\b(master(ed|ing)?|mixed|loud(er)? like (a )?(real|released)|radio ready|release ready)\b/.test(t) && !/\bmaster (volume|chain)\b/.test(t)) { push('automix'); return true; }
  if (/\b(finish|complete)\b.*\b(song|beat|track|it)\b/.test(t)) { push('agent', { task: 'song' }); return true; }
  if (/\b(old|dusty|grainy|lo-?fi it|lofi it|vintage|retro|cassette)\b/.test(t) && !asksBeat) { push('tone', { parts: ps.length ? ps : ['chords', 'melody', 'arp'], dir: 'warmer' }); return true; }
  if (/\b(save as|bounce|render|download|export)\b/.test(t) && !/\b(bounce|bouncy)\b.*\b(drums|beat|groove)\b/.test(t) && /\b(save as|bounce it|bounce the|render|download|mp3|wav|stems?)\b/.test(t)) { push('export', { fmt: /mp3/.test(t) ? 'mp3' : /stem/.test(t) ? 'stems' : /midi/.test(t) ? 'midi' : 'wav' }); return true; }
  if (/\b(louder|turn (it )?up|more volume)\b/.test(t) && !ps.length && !/\b(reverb|delay|swing)\b/.test(t)) { push('vol', { parts: ['mix'], dB: 3 }); return true; }
  if (/\b(quieter|turn (it |everything )?down|less volume)\b/.test(t) && (!ps.length || ps.every(p => p === 'mix'))) { push('vol', { parts: ['mix'], dB: -3 }); return true; }
  return false;
}

// Typos: a word one or two letters off a word the brain knows is read as that word ("mak", "chnage", "kik")
const VOCAB = 'make beat add remove change melody chords chord drums drum kick snare hats hat reverb delay louder quieter faster slower tempo swing minor major darker brighter mute unmute solo export humanize transpose octave vinyl filter compressor distort distortion bass melody piano strings guitar flute bell organ trap drill lofi house phonk afro rnb boom bap fill rolls slides hihat hihats louder softer volume punchier punch warmer wider stereo delete different another better new create generate turn switch replace pattern song hook verse intro outro bridge stutter reverse autotune pitch'.split(' ');
function edits(a, b) {  // Damerau-Levenshtein distance, stopping early past 2
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[a.length][b.length];
}
// everyday words that are never typos, even when they're one letter off a studio word (harder, lower, master, sing)
const COMMON = 'shorter longer tail tails ring boom whats thats wrong isnt doesnt wont im ive youre theres heres lets hows wheres whos aint gonna wanna gotta theyre wasnt arent about above after again all also am an and any are as ask at away back bad be because been before being below best better big bit both bring but by call can cant come could cut dark day did different do does dont down drop each easy end even every feel few fill find fine first for from full fun get give go going good got great had hard has have he her here high him his hit hold how i if in into is it its just keep kind know last left let like little long look lot low lower make many may me mean more most much must my need never new next nice no not now of off old on once one only or other our out over own part play put quick rather real right same say see set she should show side sing small so some something song sound start still stop such sure take tell than that the their them then there these they thing think this those though through to too try turn under up us use very want was way we well were what when where which while who why will with without work would yeah yes yet you your cook bounce master lower harder softer quieter louder higher deeper heavy heavier sad happy chill vibe vibes hype type fire crazy insane wild smooth clean cleaner crisp dirty dusty grainy warm cold wet dry long short tight loose fast slow empty boring busy crowded singing hum whistle record sample slice loop chop flip ass hits slap slaps knock knocks banger evil dope sick lit mid trash sucks weak wack lame ugly human robotic groove groovy swing emotional sinister moody scary spooky'.split(' ');
const KNOWN = new Set([...VOCAB, ...COMMON, 'a', 'an', 'the', 'it', 'to', 'on', 'of', 'in', 'up', 'down', 'and', 'my', 'me', 'more', 'less', 'some', 'too', 'pls', 'plz', 'is', 'at', 'for', 'with', 'this', 'that', 'every', 'bars', 'bar', 'bpm', 'key', 'mix', 'beat', 'set', 'put', 'get', 'go', 'be', 'all']);
const SLANG = { ad: 'add', adn: 'and', teh: 'the', pls: '', plz: '', u: 'you', ur: 'your', hihat: 'hi-hat', hihats: 'hi-hats', hh: 'hats', kik: 'kick', kicks: 'kicks', snr: 'snare', mel: 'melody', lowfi: 'lofi', 'lo fi': 'lofi', rnb: 'rnb', randb: 'rnb', eight0eight: '808', reverbb: 'reverb', verb: 'reverb', bpms: 'bpm', tempos: 'tempo', abit: 'a bit', alil: 'a little', lil: 'a little', gimme: 'give me', wanna: 'want to', gonna: 'going to', abt: 'about', thx: '', bro: '', bruh: '', yo: '', fam: '' };
export function fixTypos(s) {
  return s.split(' ').map(w => {
    if (w in SLANG) return SLANG[w];
    if (w.length < 3 || KNOWN.has(w) || /\d/.test(w)) return w;
    let best = null, bd = 3;
    for (const v of VOCAB) { const d = edits(w, v); if (d < bd && d <= (w.length >= 8 ? 2 : 1)) { bd = d; best = v; } }
    return best ?? w;
  }).filter(Boolean).join(' ');
}

// When the brain doesn't get a request: the closest things it can do, by shared words. {p} is the part
// the request named, so "the snare is kinda weird" offers snare requests.
export const IDEAS = ['make a trap beat', 'make a lofi beat at 85', 'make it faster', 'make it slower', 'change the key to A minor', 'make it sadder', 'make the {p} louder', 'make the {p} darker',
  'add reverb to the {p}', 'make the {p} quieter', 'mute the {p}', 'make the {p} brighter', 'make the {p} warmer', 'solo the {p}', 'pan the {p} left', 'half-time the {p}', 'take the effects off the {p}',
  'new chords', 'new drums', 'new bassline', 'make the melody a flute', 'use a piano for the chords', 'vary the melody', 'duck the 808 under the kick', 'add 808 slides every 2 bars', 'add hi-hat rolls', 'humanize the drums', 'add a drum fill', 'switch up the drums',
  'more swing', 'make it bounce', 'more energy', 'simpler drums', 'tape stop at the end', 'autotune the vocals', 'make it sound old', 'make it wider', 'balance the mix', 'check my mix',
  'turn this into a full song', 'hum a melody', 'export an mp3', 'play'];
const PART_WORD = { kick: 'kick', snare: 'snare', hat: 'hats', openhat: 'open hat', perc: 'perc', bass: '808', chords: 'chords', arp: 'arp', melody: 'melody', drums: 'drums', vocals: 'vocals', texture: 'vinyl' };
const STOP = new Set('the a an it to my me is of in on and this that i you can be so its for with do does dont want need like some just make'.split(' '));
const stems = s => s.replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w)).map(w => w.slice(0, 5));
export function closest(text, n = 3) {
  const t = fixTypos(text.toLowerCase().replace(/[’']/g, '').replace(/\bpiano ?rolls?\b/g, 'pianoroll')), named = parts(` ${t} `).find(p => PART_WORD[p]), mine = new Set(stems(t));
  const ideas = IDEAS.map(x => x.replace('{p}', PART_WORD[named] ?? 'melody'));
  const scored = ideas.map((x, i) => ({ x, s: stems(x).filter(w => mine.has(w)).length + (named && x.includes(PART_WORD[named]) ? 0.5 : 0) - i / 1000 }));
  const hits = scored.filter(o => o.s >= 0.5).sort((a, b) => b.s - a.s).map(o => o.x);
  return [...new Set([...hits, 'check my mix', 'turn this into a full song', 'make a trap beat'])].slice(0, n);  // ponytail: word overlap, not meaning; the smart brain covers meaning
}

const clean = s => ` ${s.toLowerCase().replace(/[’']/g, '').replace(/\b(please|can you|could you|would you|i want( you)? to|i want|lets|let us|just|kindly|a bit|a little|slightly|some more|some|really|very|kinda|sort of)\b/g, ' ').replace(/\s+/g, ' ').trim()} `;
// Clauses: commas, semicolons, "and", "then", "also", "plus" (but not "rock and roll" style pairs inside a name)
const clauses = s => s.split(/[,;.!?]+|\b(?:and then|then|and also|also|plus|and|after that)\b/).map(x => x.trim()).filter(Boolean);

export function parts(text) { return PARTS.filter(([, re]) => re.test(text)).map(([id]) => id).filter((id, _, all) => !(id === 'hat' && all.includes('openhat') && !/\bclosed\b|\bhats?\b(?! *open)/.test(text.replace(/open ?hats?/g, '')))); }
const sectionOf = text => SECTIONS.find(s => text.includes(s)) ?? null;

// ctx: { tracks: [{ id, name, kind }], styles: [{ id, name }], effects: [{ id, name }], instruments: [name], kits: [name] }
export function plan(input, ctx) {
  const steps = [];
  let lastParts = [];
  for (const raw of clauses(input.replace(/\b(beat|track|loop|banger)\s+with\b/gi, '$1 and').replace(/\bmix(ed)? and master(ed)?\b/gi, 'mastered'))) {  // "a trap beat with 808 slides"
    const t = clean(fixTypos(raw.toLowerCase().replace(/[’']/g, '').replace(/\bpiano ?rolls?\b/g, 'pianoroll'))), before = steps.length;  // the window, not chords or hat rolls
    let ps = parts(t);
    if (!ps.length && /\b(it|them|those|that)\b/.test(t)) ps = lastParts;  // "the hats ... and pan them left"
    const section = sectionOf(t);
    const push = (type, o = {}) => steps.push({ type, ...o, ...(section ? { section } : {}) });
    let m;
    if (early(t, ps, push, ctx)) { /* everyday language, above */ }
    else if (/\b(full song|whole song|complete song|into a song|song out of|arrange (it|this|the beat)|song structure|build (a|the) song)\b/.test(t)) push('agent', { task: 'song' });
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
    else if (/\b(auto[ -]?mix|mix it|balance|level (it|the mix)|fix (the |my )?mix|mixdown)\b/.test(t)) push('automix');
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
    case 'duck': return step.value ? `Duck ${who} under the kick` : `Stop ducking ${who}`;
    case 'sound': return `Play ${who} on ${SOUND_NAMES[step.sound] ?? step.sound}`;
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
