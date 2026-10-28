// Run: node beatlab/test_tools.mjs
import assert from 'node:assert/strict';
import { STEP } from './music.js';
import { quantize, humanize, euclid, shiftSteps, snapToScale, inBox, tidy, valueAt, AUTO, CHORDS } from './tools.js';

const n = (t, p = 60, d = 12, v = 100) => ({ t, d, p, v });
assert.deepEqual(quantize([n(5), n(20)], STEP).map(x => x.t), [0, 24]);
assert.deepEqual(quantize([n(12)], STEP, 0.5).map(x => x.t), [18]);  // halfway from 12 toward 24 (ties round up)
let seed = 1;
const rng = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
for (const x of humanize(Array.from({ length: 50 }, (_, i) => n(i * 24)), rng)) assert(x.t >= 0 && x.v >= 1 && x.v <= 127);
assert.equal(euclid(3, 8).map(b => (b ? 'x' : '.')).join(''), 'x..x..x.');
assert.equal(euclid(4, 16).filter(Boolean).length, 4);
assert.equal(euclid(5, 16, 1).filter(Boolean).length, 5);
assert.equal(euclid(5, 16, 1)[0], false);
assert.deepEqual(shiftSteps([n(0), n(15 * STEP)], 1, 16 * STEP).map(x => x.t), [STEP, 0]);
const cMinor = [0, 2, 3, 5, 7, 8, 10];
assert.equal(snapToScale(64, cMinor), 63);  // E snaps down to Eb
assert.equal(snapToScale(61, cMinor), 60);
assert.equal(snapToScale(62, cMinor), 62);
assert.equal(inBox([n(0, 60), n(48, 64), n(96, 70)], 0, 50, 59, 65).length, 2);
const t = tidy([n(0, 60, 48), n(24, 60, 24), n(100, 62, 0)]);
assert.deepEqual(t.map(x => [x.t, x.d]), [[0, 24], [24, 24]]);
const pts = [{ t: 0, v: 0 }, { t: 100, v: 1 }];
assert.equal(valueAt(pts, 50, 0.8), 0.5);
assert.equal(valueAt(pts, -5, 0.8), 0);
assert.equal(valueAt(pts, 500, 0.8), 1);
assert.equal(valueAt([], 10, 0.8), 0.8);
assert.equal(AUTO.vol.toParam(0.8), 1);
assert(Math.abs(AUTO.cut.toParam(1) - 20000) < 1e-6);
assert.deepEqual(CHORDS.min7.iv, [0, 3, 7, 10]);
console.log('tools ok');
