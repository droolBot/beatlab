"""Aesthetic R&B type beat: 80 BPM, Bb major "Just the Two of Us" changes, rolled Rhodes-style chords.
Run: python make_rnb.py"""
from make_beat import BAR, HERE, STEP, bass, drum, humanize, melody, save

BPM = 80
BARS = 8
SWING = 0.15      # lazy swing on offbeat 16ths
PUSH = STEP       # chord changes land a 16th early

# IVmaj9 - III7alt - vim9 - vm9 I13 in Bb major. Rootless voicings: the 808 plays the roots.
# (step in the 4-bar loop, 808 note, voicing low to high)
CHANGES = [
    (0, 63, [55, 58, 62, 65]),   # Ebmaj9
    (16, 62, [54, 58, 60, 65]),  # D7#9b13
    (32, 55, [53, 57, 58, 62]),  # Gm9
    (48, 53, [55, 56, 60, 63]),  # Fm9
    (56, 58, [55, 56, 60, 62]),  # Bb13
]
TIMELINE = [(loop * 4 * BAR + step * STEP, root, v) for loop in range(BARS // 4) for step, root, v in CHANGES]

# Sparse top line on chord extensions, room left for a vocal: (step, length in steps, note)
A = [
    [(4, 2, 74), (6, 2, 77), (8, 4, 74), (12, 4, 72)],
    [(0, 6, 70), (6, 2, 69), (8, 8, 66)],
    [(4, 2, 69), (6, 2, 70), (8, 4, 74), (12, 4, 72)],
    [(0, 6, 72), (6, 2, 70), (8, 8, 67)],
]


def change_at(t):
    return [c for c in TIMELINE if c[0] <= t + PUSH][-1]


def roll(start, end, voicing, spread=3):
    """Strum bottom to top like a keys player, top note a little louder."""
    return [(start + k * spread, end - start - k * spread, n, 68 + 5 * k) for k, n in enumerate(voicing)]


starts = [max(0, s - PUSH) for s, *_ in TIMELINE]
chords = [n for s, e, (_, _, v) in zip(starts, starts[1:] + [BARS * BAR], TIMELINE) for n in roll(s, e, v)]
kick = drum(["x.....x...x.....", "x.x.......x..x.."], BARS, SWING)

save(HERE / "rnb_Bbmaj_80", BPM, {
    "kick": humanize(kick, 6),
    "snare": humanize(drum(["....x.......x..."], BARS, SWING, 110), 6),
    "hat": humanize(drum(["x.x.x.x.x.x.x.x.", "x.x.x.x.x.x.xxx.", "x.x.x.x.x.x.x.x.", "x.x.x.xrx.x.x.tt"], BARS, SWING, 90), 12, 2),
    "808": bass(kick, lambda t: change_at(t)[1], BARS * BAR),
    "chords": humanize(chords, 6),
    "melody": humanize(melody(A + A[:3] + [[(0, 4, 72), (4, 4, 68), (8, 8, 74)]]), 10, 4),  # last bar lifts to D
})
