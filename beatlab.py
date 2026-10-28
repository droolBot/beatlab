"""BeatLab: a beat studio that runs in your browser. Run: python beatlab.py"""
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.parse
import urllib.request
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from make_beat import write_midi

HERE = Path(__file__).parent
WEB, EXPORTS = HERE / "beatlab", HERE / "exports"
PORT = 8765
AUDIO_HOSTS = (".itunes.apple.com", ".mzstatic.com")  # song previews only, so this is not an open proxy
# FL Studio's own sample packs, if FL is installed: served read-only to the page
PACKS = next((p for p in sorted(Path("C:/Program Files/Image-Line").glob("FL Studio*/Data/Patches/Packs"), reverse=True) if p.is_dir()), None)
SAMPLE_TYPES = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".flac": "audio/flac"}
_library = None


def sample_bytes(f):
    """FL ships most pack samples as Ogg Vorbis inside a WAV wrapper (format tag 0x674F/0x6750), which
    browsers can't open. The wrapper's data chunk is a plain Ogg stream, so that is what gets served."""
    d = f.read_bytes()
    if d[:4] == b"RIFF" and d[8:12] == b"WAVE":
        i = 12
        while i + 8 <= len(d):
            cid, size = d[i:i + 4], int.from_bytes(d[i + 4:i + 8], "little")
            if cid == b"data" and d[i + 8:i + 12] == b"OggS":
                return first_stream(d[i + 8:i + 8 + size]), "audio/ogg"
            i += 8 + size + (size & 1)
    return d, SAMPLE_TYPES[f.suffix.lower()]


def first_stream(ogg):
    """Some of FL's samples carry a second, non-audio stream interleaved with the sound, which browsers
    won't open. Keeping only the pages of the first stream leaves an ordinary Ogg Vorbis file."""
    serial, out, i = ogg[14:18], bytearray(), 0
    while i + 27 <= len(ogg) and ogg[i:i + 4] == b"OggS":
        n = ogg[i + 26]
        end = i + 27 + n + sum(ogg[i + 27:i + 27 + n])
        if ogg[i + 14:i + 18] == serial:
            out += ogg[i:end]
        i = end
    return bytes(out) if out else ogg


FFMPEG = shutil.which("ffmpeg")


def sample_pcm(f):
    """A few of FL's Ogg samples are packed in a way Chrome's decoder refuses, though they're fine. If
    ffmpeg is installed it turns them into plain 16-bit WAV; without it those samples stay unavailable."""
    if not FFMPEG:
        raise FileNotFoundError("This sample needs ffmpeg to play in the browser, and ffmpeg isn't installed.")
    data, _ = sample_bytes(f)
    wav = bytearray(subprocess.run([FFMPEG, "-v", "error", "-i", "pipe:0", "-f", "wav", "-acodec", "pcm_s16le", "pipe:1"], input=data, capture_output=True, timeout=30, check=True).stdout)
    i = wav.find(b"data")  # written to a pipe, ffmpeg can't go back and fill in the sizes
    wav[4:8] = (len(wav) - 8).to_bytes(4, "little")
    wav[i + 4:i + 8] = (len(wav) - i - 8).to_bytes(4, "little")
    return bytes(wav), "audio/wav"


def library():
    global _library
    if _library is None:
        _library = sorted(f.relative_to(PACKS).as_posix() for f in PACKS.rglob("*") if f.suffix.lower() in SAMPLE_TYPES) if PACKS else []
    return _library


def fetch(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": "BeatLab/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(), r.headers.get("Content-Type", "application/octet-stream")


def safe(name):
    return re.sub(r"[^\w\- ]", "", str(name)).strip()[:80] or "beat"


def search(q, country):
    """iTunes Search API: free, no key. An Apple Music link is looked up by its song id."""
    m = re.search(r"[?&]i=(\d+)", q) or re.search(r"music\.apple\.com/.*?/(\d{6,})", q)
    if m:
        url = f"https://itunes.apple.com/lookup?id={m[1]}&country={country}"
    else:
        params = {"term": q, "media": "music", "entity": "song", "limit": 25, "country": country}
        url = "https://itunes.apple.com/search?" + urllib.parse.urlencode(params)
    results = json.loads(fetch(url)[0])["results"]
    return [{"title": r.get("trackName"), "artist": r.get("artistName"), "genre": r.get("primaryGenreName", ""),
             "art": r.get("artworkUrl100"), "preview": r["previewUrl"]} for r in results if r.get("previewUrl")]


class Handler(SimpleHTTPRequestHandler):
    # Windows can map .js to text/plain in the registry, which browsers refuse for modules
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map, ".js": "text/javascript", ".mjs": "text/javascript"}

    def __init__(self, *args, **kw):
        super().__init__(*args, directory=str(WEB), **kw)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def reply(self, body, ctype="application/json", code=200):
        if not isinstance(body, bytes):
            body = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        try:
            if url.path == "/api/search":
                return self.reply(search(q.get("q", ""), safe(q.get("country", "US"))[:2]))
            if url.path == "/api/audio":
                host = urllib.parse.urlparse(q.get("url", "")).hostname or ""
                if not host.endswith(AUDIO_HOSTS):
                    return self.reply({"error": "Only song previews can be loaded."}, code=400)
                return self.reply(*fetch(q["url"], 30))
            if url.path == "/api/samples":
                return self.reply({"root": str(PACKS) if PACKS else None, "files": library()})
            if url.path == "/api/sample":
                p = q.get("p", "")
                base = WEB / "samples" if p.startswith("BeatLab/") else PACKS  # BeatLab's own kits, or FL Studio's packs
                f = (base / p).resolve() if base else None
                if not f or not f.is_relative_to(base.resolve()) or f.suffix.lower() not in SAMPLE_TYPES or not f.is_file():
                    return self.reply({"error": "That sample isn't in FL Studio's packs."}, code=404)
                return self.reply(*(sample_pcm(f) if q.get("pcm") else sample_bytes(f)))
        except Exception as e:  # network trouble reaches the page as a readable message
            return self.reply({"error": f"Couldn't reach the music service ({e})."}, code=502)
        super().do_GET()

    def do_POST(self):
        # A custom header forces a CORS preflight, so other websites can't write files here
        if self.headers.get("X-BeatLab") != "1":
            return self.reply({"error": "Forbidden."}, code=403)
        url = urllib.parse.urlparse(self.path)
        q = dict(urllib.parse.parse_qsl(url.query))
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        folder = EXPORTS / safe(q.get("folder", ""))
        if url.path == "/api/export":
            job = json.loads(body)
            folder = EXPORTS / safe(job["name"])
            folder.mkdir(parents=True, exist_ok=True)
            tracks = []
            for t in job["tracks"]:
                notes = [(max(0, int(s)), max(1, int(d)), min(127, max(0, int(p))), min(127, max(1, int(v))))
                         for s, d, p, v in t["notes"]]
                tracks.append((safe(t["name"]), notes))
                write_midi(folder / f"{tracks[-1][0]}.mid", float(job["bpm"]), [tracks[-1]])
            if tracks:
                write_midi(folder / "beat.mid", float(job["bpm"]), tracks)
            return self.reply({"folder": folder.name, "path": str(folder.resolve())})
        if url.path == "/api/file":
            ext = q.get("ext", "wav")
            if not folder.is_dir():
                return self.reply({"error": "Export folder not found."}, code=404)
            if ext not in ("wav", "mp3", "txt", "beatlab"):
                return self.reply({"error": "That file type can't be saved."}, code=400)
            (folder / (safe(q.get("file", "")) + "." + ext)).write_bytes(body)
            return self.reply({"ok": True})
        if url.path == "/api/open":
            if folder.is_dir() and hasattr(os, "startfile"):
                os.startfile(folder)
            return self.reply({"ok": True})
        self.reply({"error": "Not found."}, code=404)

    def log_request(self, code="-", size="-"):  # only show failed requests in the terminal
        if isinstance(code, int) and code >= 400:
            super().log_request(code, size)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}"
    print(f"BeatLab is running at {url}  (press Ctrl+C to stop)")
    if "--no-browser" not in sys.argv:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
