/* ---------- device storage ----------
   When the page is opened outside claude.ai (the public github.io link, or a downloaded file) there is no
   shared database. LocalDB gives the same small API the app uses (doc/collection, get/set/update/delete,
   onSnapshot, acquire) backed by this browser's localStorage, so everything works the same, but the data
   stays on this device. Other tabs of the same browser see changes through the "storage" event.
   A full disk rejects with {code: "quota_exceeded"} so the status pill reports it honestly. */
function createLocalDB(namespace) {
  const PREFIX = "chordscroll-db:" + namespace + ":";
  const listeners = new Set();     // {kind: "doc"|"col", path, fn}
  const k = path => PREFIX + path;
  const read = path => { try { const v = localStorage.getItem(k(path)); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; } };
  const index = col => read("__index/" + col) || [];
  const writeRaw = (path, val) => {
    try {
      if (val === undefined) localStorage.removeItem(k(path)); else localStorage.setItem(k(path), JSON.stringify(val));
    } catch (e) {
      throw { code: /quota/i.test(String(e && e.name) + String(e && e.message)) ? "quota_exceeded" : "unavailable", message: String(e && e.message || e) };
    }
  };
  const split = path => { const i = path.lastIndexOf("/"); return [path.slice(0, i), path.slice(i + 1)]; };
  const freeze = (id, data) => ({ id, exists: data !== undefined, data: () => data === undefined ? undefined : JSON.parse(JSON.stringify(data)), metadata: { fromCache: false, hasPendingWrites: false } });
  function colSnap(col) {
    const docs = index(col).map(id => freeze(id, read(col + "/" + id))).filter(d => d.exists);
    return { docs, size: docs.length, empty: !docs.length, docChanges: () => docs.map((d, i) => ({ type: "added", doc: d, oldIndex: -1, newIndex: i })), metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function emit(path) {
    const [col] = split(path);
    for (const l of listeners) {
      if (l.kind === "doc" && l.path === path) l.fn(freeze(split(path)[1], read(path)));
      if (l.kind === "col" && l.path === col) l.fn(colSnap(col));
    }
  }
  window.addEventListener("storage", e => {
    if (!e.key || !e.key.startsWith(PREFIX)) return;
    const path = e.key.slice(PREFIX.length);
    if (path.startsWith("__index/")) { const col = path.slice(8); for (const l of listeners) if (l.kind === "col" && l.path === col) l.fn(colSnap(col)); }
    else emit(path);
  });
  const leases = new Map();
  function docRef(path) {
    const [col, id] = split(path);
    return {
      id, path,
      async get() { return freeze(id, read(path)); },
      async set(data) {
        const ids = index(col);
        writeRaw(path, JSON.parse(JSON.stringify(data)));
        if (!ids.includes(id)) writeRaw("__index/" + col, [...ids, id]);
        emit(path);
      },
      async update(data) {
        const cur = read(path);
        if (cur === undefined) throw { code: "invalid_argument", message: "document does not exist" };
        writeRaw(path, { ...cur, ...JSON.parse(JSON.stringify(data)) });
        emit(path);
      },
      async delete() {
        writeRaw(path, undefined);
        writeRaw("__index/" + col, index(col).filter(x => x !== id));
        emit(path);
      },
      async acquire({ holder, ttlMs = 30000 }) {
        const t = Date.now(), cur = leases.get(path);
        if (cur && cur.holder !== holder && cur.until > t) return { acquired: false, expiresAt: new Date(cur.until).toISOString() };
        const until = t + Math.min(600000, Math.max(1000, ttlMs));
        leases.set(path, { holder, until });
        return { acquired: true, holder, expiresAt: new Date(until).toISOString(), version: 1 };
      },
      onSnapshot(fn) { const l = { kind: "doc", path, fn }; listeners.add(l); setTimeout(() => fn(freeze(id, read(path))), 0); return () => listeners.delete(l); }
    };
  }
  function colRef(col) {
    return {
      path: col,
      doc(id) { return docRef(col + "/" + (id || newId())); },
      async add(data) { const r = docRef(col + "/" + newId()); await r.set(data); return r; },
      async get() { return colSnap(col); },
      onSnapshot(fn) { const l = { kind: "col", path: col, fn }; listeners.add(l); setTimeout(() => fn(colSnap(col)), 0); return () => listeners.delete(l); }
    };
  }
  return {
    doc: docRef, collection: colRef,
    /** true when this device has never stored anything for the app */
    isEmpty() { return ["songs", "events", "items"].every(c => !index(c).length) && !read("__meta/seeded"); },
    markSeeded() { writeRaw("__meta/seeded", { at: Date.now() }); }
  };
}
