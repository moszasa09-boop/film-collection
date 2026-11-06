// Test double for the claude.ai runtime (db, user, sample, downloads), injected before the app loads.
// Data lives in localStorage under "__mockdb:" so two pages of one browser context act like two members
// on the same shared database (they see each other's writes through the storage event).
// Configure with window.__mockCfg before load (via addInitScript) or at run time:
//   { user: {id, isOwner, canEdit, canWrite}, fail: {count, code}, offline: bool, sample: {...} }
(() => {
  const cfg = window.__mockCfg = Object.assign({ user: { id: "u_owner", isOwner: true, canEdit: true, canWrite: true }, fail: null, offline: false, sample: null, sampleCalls: [] }, window.__mockCfg || {});
  window.__mockDownloads = [];
  const P = "__mockdb:";
  const listeners = new Set();
  const read = path => { const v = localStorage.getItem(P + path); return v == null ? undefined : JSON.parse(v); };
  const index = col => read("__index/" + col) || [];
  const write = (path, val) => val === undefined ? localStorage.removeItem(P + path) : localStorage.setItem(P + path, JSON.stringify(val));
  const split = path => { const i = path.lastIndexOf("/"); return [path.slice(0, i), path.slice(i + 1)]; };
  const snap = (id, data, pending) => ({ id, exists: data !== undefined, data: () => data && JSON.parse(JSON.stringify(data)), metadata: { fromCache: false, hasPendingWrites: !!pending } });
  const colSnap = col => { const docs = index(col).map(id => snap(id, read(col + "/" + id))).filter(d => d.exists); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } }; };
  const emit = col => { for (const l of listeners) if (l.col === col) l.fn(colSnap(col)); };
  window.addEventListener("storage", e => { if (e.key && e.key.startsWith(P + "__index/")) emit(e.key.slice(P.length + 8)); else if (e.key && e.key.startsWith(P)) emit(split(e.key.slice(P.length))[0]); });
  const waiters = [];
  const gate = async () => {
    if (cfg.offline) await new Promise(r => waiters.push(r));
    if (cfg.fail && cfg.fail.count > 0) { cfg.fail.count--; throw { code: cfg.fail.code || "unavailable", message: "injected" }; }
    if (!cfg.user.canWrite) throw { code: "invalid_argument", message: "below write level" };
  };
  window.__mockGoOnline = () => { cfg.offline = false; while (waiters.length) waiters.shift()(); };
  const leases = new Map();
  function doc(path) {
    const [col, id] = split(path);
    return {
      id, path,
      async get() { if (cfg.offline) await new Promise(r => waiters.push(r)); return snap(id, read(path)); },
      async set(data) { await gate(); write(path, JSON.parse(JSON.stringify(data))); const ix = index(col); if (!ix.includes(id)) write("__index/" + col, [...ix, id]); emit(col); },
      async update(data) { await gate(); const cur = read(path); if (cur === undefined) throw { code: "invalid_argument", message: "missing" }; write(path, { ...cur, ...JSON.parse(JSON.stringify(data)) }); emit(col); },
      async delete() { await gate(); write(path, undefined); write("__index/" + col, index(col).filter(x => x !== id)); emit(col); },
      async acquire({ holder, ttlMs = 30000 }) {
        const t = Date.now(), cur = leases.get(path);
        if (cur && cur.holder !== holder && cur.until > t) return { acquired: false, expiresAt: new Date(cur.until).toISOString() };
        leases.set(path, { holder, until: t + ttlMs }); return { acquired: true, holder, expiresAt: new Date(t + ttlMs).toISOString() };
      },
      onSnapshot(fn) { const l = { col: "__doc:" + path, fn }; listeners.add(l); setTimeout(() => fn(snap(id, read(path))), 5); return () => listeners.delete(l); }
    };
  }
  const db = Object.freeze({
    doc,
    collection(col) {
      return {
        path: col, doc: id => doc(col + "/" + (id || Math.random().toString(36).slice(2, 14))),
        async get() { return colSnap(col); },
        onSnapshot(fn) { const l = { col, fn }; listeners.add(l); setTimeout(() => fn(colSnap(col)), 20); return () => listeners.delete(l); }
      };
    }
  });
  const user = Object.freeze({
    async me() { return { id: cfg.user.id, name: "Tester", isOwner: !!cfg.user.isOwner, canEdit: !!cfg.user.canEdit, email: null, avatarUrl: "", color: "#888" }; },
    async id() { return cfg.user.id; }, async isOwner() { return !!cfg.user.isOwner; }, async canEdit() { return !!cfg.user.canEdit; },
    async can(name) { return name === "data.write" ? (cfg.user.canWrite === null ? null : !!cfg.user.canWrite) : false; },
    async profiles(ids) { const o = {}; for (const i of [].concat(ids)) o[i] = { id: i, name: "", avatarUrl: "", color: "#888", email: null, isMe: i === cfg.user.id, guest: false }; return o; }
  });
  const DEFAULT_OCR = {
    title: "เพลงจากรูป", artist: "วงทดสอบ", bpm: 92,
    text: "[INTRO] | G | D | Em | C |\n\n[G]ฟ้ายังคง [D]สดใส\nแม้ใจจะ [Em?]หม่นหมอง {?ลำพัง}\n\n* [C]ร้องเพลงนี้ [D]ให้เธอ\n",
    unclear: [{ line: 4, what: "คอร์ด Em อาจเป็น Em7" }, { line: 4, what: "คำว่า ลำพัง ไม่ชัด" }], notes: ""
  };
  function sampleFn(input, opts = {}) { return sampleFn.json(input, opts).then(v => ({ text: JSON.stringify(v), truncated: false, modelTierApplied: "default" })); }
  sampleFn.json = async (input, opts = {}) => {
    cfg.sampleCalls.push({ input, images: opts.images ? [].concat(opts.images).length : 0 });
    await new Promise((res, rej) => {
      const t = setTimeout(res, (cfg.sample && cfg.sample.delay) || 300);
      if (opts.signal) opts.signal.addEventListener("abort", () => { clearTimeout(t); rej({ code: "cancelled", message: "aborted" }); });
    });
    if (cfg.sample && cfg.sample.error) throw { code: cfg.sample.error, message: "injected" };
    if (opts.onText) opts.onText({ text: "...", delta: "..." });
    return JSON.parse(JSON.stringify((cfg.sample && cfg.sample.result) || DEFAULT_OCR));
  };
  sampleFn.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 5, maxInputBytes: 20e6, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] } });
  const downloads = Object.freeze({ async save({ filename, data }) { window.__mockDownloads.push({ filename, data: typeof data === "string" ? data : "[binary]" }); return { status: "saved" }; } });
  const caps = { db, user, sample: sampleFn, downloads };
  window.claude = Object.freeze({ use: name => new Promise(r => setTimeout(() => r(caps[name] || null), 30)) });
})();
