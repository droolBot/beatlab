// BeatLab storage: projects, their versions and recorded audio live in the browser's IndexedDB, which
// survives reloads and holds far more than localStorage. Audio is kept as raw Float32 channels.
let dbp = null;
function db() {
  dbp ??= new Promise((ok, fail) => {
    const r = indexedDB.open('beatlab', 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('projects', { keyPath: 'id' });
      r.result.createObjectStore('audio');
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => fail(r.error);
  });
  return dbp;
}
async function run(store, mode, fn) {
  const d = await db();
  return new Promise((ok, fail) => {
    const t = d.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => ok(req?.result);
    t.onerror = () => fail(t.error);
    t.onabort = () => fail(t.error ?? new Error('The browser refused to save. Is the disk full?'));
  });
}

export const projects = {
  all: () => run('projects', 'readonly', s => s.getAll()),
  get: id => run('projects', 'readonly', s => s.get(id)),
  put: p => run('projects', 'readwrite', s => s.put(p)),
  del: id => run('projects', 'readwrite', s => s.delete(id)),
};

export function putAudio(id, buf) {
  const data = { sr: buf.sampleRate, ch: Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i).slice()) };
  return run('audio', 'readwrite', s => s.put(data, id));
}
export async function getAudio(id) {
  const d = await run('audio', 'readonly', s => s.get(id));
  if (!d) return null;
  const b = new AudioBuffer({ length: d.ch[0].length, numberOfChannels: d.ch.length, sampleRate: d.sr });
  d.ch.forEach((c, i) => b.copyToChannel(c, i));
  return b;
}
export const delAudio = id => run('audio', 'readwrite', s => s.delete(id));
export const audioIds = () => run('audio', 'readonly', s => s.getAllKeys());
export const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
