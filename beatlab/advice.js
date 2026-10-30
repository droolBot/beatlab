// Answers to the questions a producer asks about their beat. Facts come from the song itself; the craft comes
// from a small table of what works. Each answer carries ideas: requests you can press to try it.
import { STYLES, BAR, chordAt, songScale, patternOf, trackName, NOTES } from './music.js';

const TIPS = [
  [/\b(kick)\b.*\b(weak|quiet|thin|soft|lost|punch|hit|hard|small)\b/, song => {
    const k = song.tracks.find(t => t.id === 'kick'), b = song.tracks.find(t => t.kind === 'bass'), why = [];
    if ((b?.duck ?? 0) < 0.3) why.push(`the ${trackName(b ?? { name: '808' })} isn't ducking under it, so the two blur together`);
    if (k && !k.fx.some(f => f.type === 'transient')) why.push('nothing is sharpening its attack');
    if (k && k.vol < 0.6) why.push('its fader is low');
    return `Usually it's the low end, not the kick. Here, ${why.length ? why.join(', and ') : 'the level and the ducking look fine, so try a different kick sample'}. Short kicks read better over long 808s.`;
  }, ['make the kick hit harder', 'duck the 808 under the kick', 'check my mix']],
  [/\b808s?\b|\bsub\b|\bbass(line)?\b/, () => 'Keep it on the chord\'s root and in key, let it ring until the next kick, and leave gaps so it can breathe. A little distortion lets it read on phone speakers, and ducking it under the kick stops the two fighting. Slides into the last 8th of a phrase keep it moving.', ['make the 808 follow the kick', 'make the 808 dirty', 'add 808 slides every 2 bars']],
  [/\bsnare|clap\b/, () => 'Layer two sounds: one for the body, one for the crack. A short reverb gives it space, and ghost notes before it add bounce. Keep it just under the kick in level.', ['layer the snare with a clap', 'add reverb to the snare', 'make the snare crack']],
  [/\bhats?\b|\bhi-?hats?\b/, () => 'Vary the velocity so they aren\'t a machine gun, and add a roll at the end of every second or fourth bar. Pan them slightly off centre and keep them quiet: you should feel them more than hear them.', ['add hi-hat rolls every 2 bars', 'humanize the drums', 'add an open hat on the offbeat']],
  [/\b(melody|melodies|lead|hook|catchy|topline)\b/, () => 'Write a short two-bar idea and repeat it, changing only the ending the second time. Leave gaps, land long notes on chord tones, and let the highest note come once. If you can\'t hum it after one listen, it\'s too busy.', ['write a melody that goes up at the end', 'add a counter melody', 'hum a melody']],
  [/\b(chords?|progression|harmony)\b/, () => 'Four chords are plenty. Sevenths and ninths sound richer, and smaller moves between chords sound smoother. In minor keys, 1 6 3 7 and 1 4 6 5 are safe starting points.', ['use a 1 6 3 7 progression', 'make the chords jazzier', 'make the chords warmer']],
  [/\b(mix|mixing|muddy|loud|louder|master|mastering|clean)\b/, () => 'Get the kick and 808 right first, then bring everything else in around them. Cut the lows from anything that isn\'t kick or bass, and duck the bass under the kick. Then let the master do the loudness.', ['check my mix', 'balance the mix', 'duck the 808 under the kick']],
  [/\b(arrange|arrangement|structure|song)\b/, () => 'A common shape is 4-bar intro, 8-bar hook, 16-bar verse, hook, verse, hook, outro. Take something away before each hook so it hits harder, and add one small new thing every 8 bars.', ['turn this into a full song', 'put a pause before the hook', 'add a riser before the hook']],
  [/\b(sidechain|ducking|duck)\b/, () => 'Sidechain turns one sound down for a moment whenever another hits. Ducking the 808 under the kick lets both come through. On chords, it gives that pumping feel.', ['duck the 808 under the kick', 'make the chords pump']],
  [/\b(swing|groove|bounce)\b/, () => 'Swing pushes every other 16th late, which gives a beat its bounce. Trap uses little or none; lofi and boom bap use a lot. Small timing and velocity changes on the hats help as much as the swing itself.', ['more swing', 'humanize the drums']],
  [/\b(reverb|delay|echo|effects?)\b/, () => 'Keep the kick and 808 dry. Use a short reverb on the snare, a longer one on the melody, and a delay when the lead has gaps to fill. Too much reverb is the quickest way to make a beat sound far away.', ['add reverb to the snare', 'add delay to the melody']],
];

const notesIn = (song, t) => song.patterns.flatMap(p => t[p.id] ?? []);
function whatNext(song) {
  const has = id => song.tracks.some(t => t.id === id && !t.mute && notesIn(song, t).length), say = [], ideas = [];
  const clips = song.playlist.clips.filter(c => c.type === 'pattern'), kick = song.tracks.find(t => t.id === 'kick'), bass = song.tracks.find(t => t.kind === 'bass');
  if (!has('melody')) { say.push('there\'s no melody yet'); ideas.push('write a melody'); }
  if (new Set(clips.map(c => c.pattern)).size < 3) { say.push('it\'s still a loop, so it needs sections'); ideas.push('turn this into a full song'); }
  if (kick && bass && (bass.duck ?? 0) < 0.3) { say.push('the 808 and kick aren\'t ducking, so the low end is blurred'); ideas.push('duck the 808 under the kick'); }
  if (!song.tracks.some(t => t.name === 'Counter melody')) { say.push('a small second line would add interest'); ideas.push('add a counter melody'); }
  if (!song.tracks.find(t => t.id === 'fx')?.[song.patterns.find(p => /verse/i.test(p.name))?.id]?.length) { say.push('a riser or a gap would make the hook land harder'); ideas.push('add a riser before the hook'); }
  ideas.push('check my mix');
  return { text: say.length ? `From what's in the project: ${say.slice(0, 3).join('; ')}.` : 'The parts are all there. I\'d check the mix, then get a vocal on it.', ideas: ideas.slice(0, 3) };
}
function inKey(song) {
  const scale = songScale(song), off = [];
  let all = 0;
  for (const t of song.tracks) {
    if (t.kind === 'drum' || t.kind === 'audio' || t.kind === 'fx' || t.kind === 'texture' || t.kind === 'bus') continue;
    const n = notesIn(song, t), bad = n.filter(x => !scale.includes(x.p % 12)).length;
    all += n.length;
    if (bad) off.push(`${trackName(t)} has ${bad}`);
  }
  return !all ? 'There are no notes to check yet.' : off.length ? `Mostly. ${off.join(', ')} outside the scale of ${NOTES[song.root]} ${song.mode}. That's usually fine: they follow the chords, like a major V.` : `Yes. All ${all} notes sit in ${NOTES[song.root]} ${song.mode}.`;
}
export const isQuestion = q => /^\s*(why|how|what|whats|what's|which|is|are|does|do i|should|can i|when|where|who|tell me)\b/i.test(q) || /\?\s*$/.test(q);
// { text, ideas } for a question, or null when this isn't one of them
export function advise(q, song, pattern = null) {
  if (!isQuestion(q)) return null;
  const t = ` ${q.toLowerCase().replace(/[’'?]/g, '')} `;
  let m;
  if ((m = t.match(/\bbar (\d+)\b/)) && /\bchord\b/.test(t)) { const b = +m[1], c = chordAt(song.harmony, ((b - 1) * BAR) % (8 * BAR)); return { text: `${c.name} is playing in bar ${b}.`, ideas: [] }; }
  if (/\bin key\b|\bout of key\b|\bwrong notes?\b/.test(t)) return { text: inKey(song), ideas: [] };
  if (/\b(bpm|tempo|how fast)\b/.test(t)) {
    const st = Object.values(STYLES).find(s => t.includes(s.name.toLowerCase()) || t.includes(s.name.toLowerCase().replace(/[^a-z]/g, '')));
    if (st) return { text: `${st.name} usually sits between ${st.bpm[0]} and ${st.bpm[1]} BPM. ${st.bpm[2]} is a good place to start.`, ideas: [`make a ${st.name.toLowerCase()} beat at ${st.bpm[2]}`] };
    return null;
  }
  if (/\b(add|do|try|work on) next\b|\bwhat next\b|\bwhats next\b|\bwhat (should|can|could) i (add|do|try|change)\b|\bwhat (would|will|could) make (this|it) better\b|\bhow (can|do|could) (i|we) (make )?(this|it) better\b|\bwhat.*\bmissing\b|\bimprove\b/.test(t)) return whatNext(song);
  if (/\b(what|which) (key|bpm|tempo|style|genre|chords|channels?|tracks?|patterns?|effects?|plugins?)\b/.test(t)) return null;  // facts about the project: the chat knows those
  for (const [re, text, ideas] of TIPS) if (re.test(t)) return { text: typeof text === 'function' ? text(song, pattern) : text(), ideas };
  return null;
}
