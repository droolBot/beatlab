"""MIDI beat helpers + a trap beat to drag into FL Studio. Run: python make_beat.py"""
import random
import struct
from pathlib import Path

PPQ = 96          # ticks per quarter note
STEP = PPQ // 4   # one 16th note
BAR = STEP * 16
ROOT = 60         # FL sampler root note (shown as C5 in FL), so samples play at natural pitch
HERE = Path(__file__).parent


def vlq(n):
    out = [n & 0x7F]
    while n := n >> 7:
        out.append(n & 0x7F | 0x80)
    return bytes(reversed(out))


def track(name, notes, bpm=None):
    """notes: (start_tick, length_ticks, pitch, velocity)"""
    events = []
    for start, length, pitch, vel in notes:
        events.append((start, 1, bytes([0x90, pitch, vel])))
        events.append((start + length, 0, bytes([0x80, pitch, 0])))
    events.sort(key=lambda e: e[:2])  # note-offs before note-ons on the same tick
    data = b"\x00\xff\x03" + vlq(len(name)) + name.encode()
    if bpm:
        data += b"\x00\xff\x51\x03" + round(60_000_000 / bpm).to_bytes(3, "big")
        data += b"\x00\xff\x58\x04\x04\x02\x18\x08"  # 4/4
    now = 0
    for tick, _, msg in events:
        data += vlq(tick - now) + msg
        now = tick
    data += b"\x00\xff\x2f\x00"
    return b"MTrk" + struct.pack(">I", len(data)) + data


def write_midi(path, bpm, tracks):
    """tracks: [(name, notes)]. Tempo goes in the first track."""
    chunks = b"".join(track(name, notes, bpm if i == 0 else None) for i, (name, notes) in enumerate(tracks))
    path.write_bytes(b"MThd" + struct.pack(">IHHH", 6, len(tracks) > 1, len(tracks), PPQ) + chunks)


def save(folder, bpm, parts):
    """One .mid per part to drag onto channels, plus beat.mid with every part for File > Import > MIDI file."""
    folder.mkdir(exist_ok=True)
    for name, notes in parts.items():
        write_midi(folder / f"{name}.mid", bpm, [(name, notes)])
    write_midi(folder / "beat.mid", bpm, list(parts.items()))
    print("Wrote", ", ".join(p.name for p in sorted(folder.glob("*.mid"))), "to", folder)


def drum(pattern, bars, swing=0.0, vel=115):
    """pattern: 16-step bars, cycled. x = hit, r = 32nd roll (2 hits), t = triplet roll (3 hits), . = rest.
    swing pushes every offbeat 16th later by that fraction of a step. vel is the downbeat velocity."""
    off = round(swing * STEP)
    notes = []
    for b in range(bars):
        for i, c in enumerate(pattern[b % len(pattern)]):
            n = {"x": 1, "r": 2, "t": 3}.get(c, 0)
            start, span = b * BAR + i * STEP + off * (i % 2), STEP - off * (i % 2)
            for h in range(n):
                v = vel - 25 * (i % 2) if n == 1 else vel - 45 + 15 * h  # offbeats softer, rolls swell
                notes.append((start + h * span // n, span // n // 2, ROOT, v))  # short notes never overlap the next hit
    return notes


def humanize(notes, vel=8, time=0, seed=1):
    """Random velocity (±vel) and late starts (up to time ticks, end kept) so parts don't sound robotic."""
    rnd = random.Random(seed)
    out = []
    for s, l, p, v in notes:
        d = rnd.randint(0, min(time, l - 1))
        out.append((s + d, l - d, p, max(1, min(127, v + rnd.randint(-vel, vel)))))
    return out


def bass(kick, pitch_at, end):
    """808 hits with every kick and rings until the next one; pitch_at(tick) picks the note."""
    starts = [s for s, *_ in kick]
    return [(s, e - s, pitch_at(s), 110) for s, e in zip(starts, starts[1:] + [end])]


def melody(bars):
    """bars: per-bar lists of (step, length in steps, note)"""
    return [(b * BAR + s * STEP, l * STEP, n, 100) for b, bar in enumerate(bars) for s, l, n in bar]


if __name__ == "__main__":
    assert vlq(0) == b"\x00" and vlq(0x80) == b"\x81\x00" and vlq(0x3FFF) == b"\xff\x7f"
    BARS = 8
    # i - VI - III - VII in C minor, 2 bars each: (808 note, chord voicing)
    CHORDS = [
        (60, [60, 63, 67]),  # Cm
        (56, [56, 60, 63]),  # Ab
        (63, [58, 63, 67]),  # Eb
        (58, [58, 62, 65]),  # Bb
    ]
    A = [
        [(0, 3, 79), (3, 3, 75), (6, 2, 72), (8, 2, 75), (10, 2, 79), (12, 4, 82)],
        [(0, 6, 79), (6, 2, 77), (8, 4, 75), (12, 4, 72)],
        [(0, 3, 79), (3, 3, 75), (6, 2, 72), (8, 2, 75), (10, 2, 77), (12, 4, 79)],
        [(0, 8, 75), (8, 8, 72)],
    ]
    kick = drum(["x......x..x.....", "x.x.......x..x.."], BARS)
    save(HERE / "trap_Cmin_140", 140, {
        "kick": kick,
        "clap": drum(["........x......."], BARS),
        "hat": drum(["x.x.x.x.x.x.x.x.", "x.x.x.xxx.x.x.x.", "x.x.x.x.x.x.x.xx", "x.x.x.x.x.ttx.rr"], BARS),
        "open_hat": drum(["................", "..............x."], BARS),
        "808": bass(kick, lambda t: CHORDS[t // (2 * BAR)][0], BARS * BAR),
        "chords": [(c * 2 * BAR, 2 * BAR, n, 80) for c, (_, v) in enumerate(CHORDS) for n in v],
        "melody": melody(A + A[:3] + [[(0, 8, 74), (8, 8, 70)]]),  # last bar resolves onto Bb
    })
