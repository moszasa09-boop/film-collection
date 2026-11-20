/* ---------- data ----------
   Shared mode (opened on claude.ai): three flat collections in the artifact's database, shared by
   everyone the artifact is shared with —
     songs/{songId}   the song itself: title, artist, bpm, blocks, check status, rev
     events/{eventId} a gig: name, date, venue, note, planned minutes, its sets [{id, name}]
     items/{itemId}   one song placed in one set of one gig, with that gig's key/capo/BPM/singer/note
   A song is stored once and used by any number of gigs. Ids are permanent random ids, never positions.
   Device mode (the public github.io link, a downloaded file, or no database here): the same collections
   kept in this browser only (see LocalDB). On first open the starter songs are copied in. */
const TAB = newId();
const Store = {
  mode: "loading",          // "loading" | "shared" | "device"
  db: null, user: null,
  me: { id: null, name: "", isOwner: false, canEdit: false },
  canWrite: null,           // true / false / null (platform said nothing; let a refused write decide)
  songs: new Map(), events: new Map(), items: new Map(),
  loaded: { songs: false, events: false, items: false },
  fresh: false,             // a snapshot confirmed by the server has arrived
  slow: false,              // no answer after 10 s
  revoked: false,
  listeners: new Set()
};
const writable = () => Store.mode === "device" || ((Store.mode === "shared" || Store.mode === "cloud") && Store.canWrite !== false && !Store.revoked);
function notify(what) { Store.listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } }); }

async function initStore() {
  const c = window.claude;
  let db = null, user = null;
  if (c && typeof c.use === "function") {
    [db, user] = await Promise.all([c.use("db").catch(() => null), c.use("user").catch(() => null)]);
  }
  Store.user = user;
  if (user) {
    try {
      const me = await user.me();
      Store.me = me; prefs.owner = me.id || "anon";
      Store.canWrite = await user.can("data.write");
    } catch (e) { /* reads never reject per contract; keep defaults */ }
  }
  if (!db) {
    const cdb = await cloudStart().catch(e => { console.error(e); return null; });
    if (cdb) {
      Store.db = cdb; Store.mode = "cloud";
      Store.canWrite = Cloud.role !== "viewer";
      Store.me = { id: Cloud.user.id, name: Cloud.band.myName || "", isOwner: Cloud.role === "owner", canEdit: Cloud.role === "owner" };
      subscribeAll(cdb);
      setTimeout(cloudCopyLocalIfAsked, 1500);
      return;
    }
    await openDevice(); return;
  }
  Store.db = db; Store.mode = "shared";
  subscribeAll(db);
}
function subscribeAll(db) {
  const timer = setTimeout(() => { if (!Store.fresh) { Store.slow = true; notify("sync"); } }, 10000);
  for (const name of ["songs", "events", "items"]) {
    db.collection(name).onSnapshot(snap => {
      const m = new Map();
      for (const d of snap.docs) { const v = d.data(); if (v) m.set(d.id, { ...v, id: d.id }); }
      Store[name] = m;
      Store.loaded[name] = true;
      if (!snap.metadata.fromCache && Object.values(Store.loaded).every(Boolean)) { Store.fresh = true; Store.slow = false; clearTimeout(timer); }
      notify(name);
    }, err => {
      if (err && err.code === "revoked") Store.revoked = true;
      Store.loaded[name] = true; Store.slow = true;
      clearTimeout(timer);
      notify("sync");
    });
  }
}

async function openDevice() {
  const db = createLocalDB("v1");
  Store.db = db; Store.mode = "device"; Store.canWrite = true;
  const first = db.isEmpty();
  subscribeAll(db);
  if (first) { try { await seedBuiltin(true); db.markSeeded(); } catch (e) { /* reported by track() */ } }
}

/* ---------- queries ---------- */
const songList = () => [...Store.songs.values()].sort((a, b) => a.title.localeCompare(b.title, "th"));
function eventList() {
  return [...Store.events.values()].sort((a, b) => {
    const da = a.date || "9999", dbb = b.date || "9999";
    return da === dbb ? (a.name || "").localeCompare(b.name || "", "th") : da < dbb ? -1 : 1;
  });
}
function eventItems(eventId) {
  const ev = Store.events.get(eventId);
  const setIdx = new Map(((ev && ev.sets) || []).map((s, i) => [s.id, i]));
  return [...Store.items.values()].filter(i => i.eventId === eventId)
    .sort((a, b) => ((setIdx.get(a.setId) ?? 999) - (setIdx.get(b.setId) ?? 999)) || (a.order - b.order));
}
const setItems = (eventId, setId) => eventItems(eventId).filter(i => i.setId === setId);
const itemBpm = (item, song) => validBpm(item && item.bpm) ? item.bpm : validBpm(song && song.bpm) ? song.bpm : 80;
const validDur = v => Number.isInteger(v) && v >= 10 && v <= 3600;
const isBreak = it => it && it.kind === "break";
/** Seconds this row takes in the show: a break's minutes, a typed real length, or the estimate from BPM. */
function itemSecs(it) {
  if (isBreak(it)) return clamp(Number(it.minutes) || 0, 0, 240) * 60;
  if (validDur(it.durationSec)) return it.durationSec;
  const s = Store.songs.get(it.songId);
  return s ? songSeconds(s.blocks, itemBpm(it, s)) : 0;
}
function usageOf(songId) {
  const out = new Map();
  for (const it of Store.items.values()) if (it.songId === songId) out.set(it.eventId, (out.get(it.eventId) || 0) + 1);
  return out;
}
/** Totals for a list of rows: songs, breaks, the gap between songs, readiness. */
function summarize(items, ev) {
  let songSecs = 0, breakSecs = 0, ready = 0, checked = 0, missing = 0, count = 0;
  for (const it of items) {
    if (isBreak(it)) { breakSecs += itemSecs(it); continue; }
    count++;
    const s = Store.songs.get(it.songId);
    if (!s) { missing++; continue; }
    songSecs += itemSecs(it);
    if (songStats(s).ready) ready++;
    if (s.musicCheck === "checked") checked++;
  }
  const gapSecs = ev && ev.gapSeconds > 0 ? Math.max(0, count - 1) * ev.gapSeconds : 0;
  return { count, secs: songSecs + breakSecs + gapSecs, songSecs, breakSecs, gapSecs, ready, checked, missing };
}

/* ---------- saving ----------
   Every write goes through track(): the status pill shows "saving" while any write is in flight,
   "waiting to send" while offline, and lists failed writes with a retry, so the page never claims
   something was saved before the store confirmed it. */
const Sync = { pending: 0, failed: [], lastOk: 0 };
const ERR_TEXT = {
  invalid_argument: "ไม่มีสิทธิ์แก้ไข หรือข้อมูลไม่ถูกต้อง",
  quota_exceeded: "พื้นที่ข้อมูลเต็ม ลบเพลงหรืองานที่ไม่ใช้ก่อน",
  resource_exhausted: "บันทึกถี่เกินไป รอสักครู่แล้วลองใหม่",
  revoked: "สิทธิ์การเข้าถึงเปลี่ยนไป เปิดหน้าใหม่อีกครั้ง",
  unavailable: "เชื่อมต่อไม่ได้ชั่วคราว",
  timeout: "รอนานเกินไป อาจออฟไลน์อยู่"
};
const errText = e => ERR_TEXT[e && e.code] || "บันทึกไม่สำเร็จ";
const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej({ code: "timeout", message: "timeout" }), ms))]);
}
async function track(label, fn) {
  if (!writable()) { toast("บัญชีนี้ดูได้อย่างเดียว"); return false; }
  Sync.pending++; notify("sync");
  try {
    try { await fn(); }
    catch (e) {
      if (e && e.code === "unavailable") { await sleep(500 + Math.random() * 1000); await fn(); }
      else throw e;
    }
    Sync.lastOk = now();
    return true;
  } catch (e) {
    if (e && e.code === "invalid_argument" && Store.canWrite == null) Store.canWrite = false; // platform hadn't said; the store did
    if (e && e.code === "revoked") Store.revoked = true;
    Sync.failed.push({ id: newId(), label, fn, error: e, at: now() });
    toast(label + " ไม่สำเร็จ: " + errText(e));
    return false;
  } finally {
    Sync.pending--; notify("sync");
  }
}
async function retryFailed(id) {
  const f = Sync.failed.find(x => x.id === id); if (!f) return;
  Sync.failed = Sync.failed.filter(x => x.id !== id);
  await track(f.label, f.fn);
}
function syncState() {
  if (Store.mode === "loading") return { state: "saving", text: "กำลังโหลด…" };
  if (Store.mode === "cloud") {
    if (Sync.failed.length) return { state: "error", text: `บันทึกไม่สำเร็จ ${Sync.failed.length} รายการ` };
    const n = Store.db.pending ? Store.db.pending() : 0;
    if (n) return navigator.onLine ? { state: "saving", text: `กำลังส่ง ${n} รายการ…` } : { state: "offline", text: `ออฟไลน์ รอส่ง ${n} รายการ` };
    if (!navigator.onLine) return { state: "offline", text: "ออฟไลน์ ใช้ข้อมูลที่เก็บไว้" };
    if (Cloud.realtime !== "SUBSCRIBED") return { state: "stale", text: "กำลังเชื่อมต่อวง…" };
    if (Store.canWrite === false) return { state: "readonly", text: "ผู้ดู · ซิงก์กับวงแล้ว" };
    return { state: "ok", text: "ซิงก์กับวงแล้ว" };
  }
  if (Store.mode === "device") {
    if (Sync.failed.length) return { state: "error", text: `บันทึกไม่สำเร็จ ${Sync.failed.length} รายการ` };
    return { state: "local", text: Sync.pending ? "กำลังบันทึก…" : "เก็บในเครื่องนี้" };
  }
  if (Store.revoked) return { state: "error", text: "สิทธิ์เปลี่ยน เปิดหน้าใหม่" };
  if (Sync.failed.length) return { state: "error", text: `บันทึกไม่สำเร็จ ${Sync.failed.length} รายการ` };
  if (Sync.pending) return navigator.onLine ? { state: "saving", text: "กำลังบันทึก…" } : { state: "offline", text: `ออฟไลน์ รอส่ง ${Sync.pending} รายการ` };
  if (!navigator.onLine) return { state: "offline", text: "ออฟไลน์ ข้อมูลอาจไม่ล่าสุด" };
  if (Store.slow && !Store.fresh) return { state: "stale", text: "ยังโหลดข้อมูลล่าสุดไม่ได้" };
  if (Store.canWrite === false) return { state: "readonly", text: "ดูอย่างเดียว" };
  return { state: "ok", text: Sync.lastOk ? "บันทึกแล้ว" : "ข้อมูลล่าสุด" };
}

/* ---------- songs ---------- */
const SONG_FIELDS = ["title", "artist", "bpm", "blocks", "source", "sourceCheck", "musicCheck", "notes"];
function songBody(song, rev) {
  const body = {};
  for (const k of SONG_FIELDS) if (song[k] !== undefined) body[k] = song[k];
  body.title = String(body.title || "").trim();
  body.artist = String(body.artist || "").trim();
  body.rev = rev; body.updatedAt = now(); body.updatedBy = Store.me.id || null;
  if (!song.createdAt) body.createdAt = now(); else body.createdAt = song.createdAt;
  return body;
}
/** Save a song. For an existing song, first checks nobody else saved it since `baseRev` was loaded.
 *  Resolves {ok} | {conflict: theirSong|null (deleted)} | {unchecked: true} (couldn't reach the store to check). */
async function saveSong(song, baseRev, { force = false } = {}) {
  if (!writable()) return { ok: false };
  const id = song.id || newId();
  const ref = Store.db.doc("songs/" + id);
  let rev = 1;
  if (song.id && baseRev != null) {
    try { await withTimeout(ref.acquire({ holder: TAB, ttlMs: 8000 }), 4000); } catch (e) { /* lease is advisory */ }
    let cur;
    try { cur = await withTimeout(ref.get(), 6000); }
    catch (e) { if (!force) return { unchecked: true }; }
    if (cur && cur.metadata && cur.metadata.fromCache && !force) return { unchecked: true };   // offline copy: can't tell if someone else saved
    if (cur && !force) {
      if (!cur.exists) return { conflict: null };
      const theirRev = (cur.data() || {}).rev || 0;
      if (theirRev !== baseRev) return { conflict: { ...cur.data(), id } };
    }
    rev = Math.max(baseRev, cur && cur.exists ? (cur.data().rev || 0) : 0) + 1;
    const before = cur && cur.exists ? { ...cur.data(), id } : Store.songs.get(id);
    if (before) await keepHistory("song", id, before, "edit");
  }
  const body = songBody({ ...song, id }, rev);
  const label = "บันทึกเพลง “" + body.title + "”";
  if (ref.putIfRev && song.id && baseRev != null && !force && navigator.onLine) {
    // the server compares the revision and writes in one step, so a save that raced ours cannot be lost
    let conflict = null;
    const ok = await track(label, async () => {
      try { await ref.putIfRev(body, rev - 1); }
      catch (e) { if (e && e.code === "conflict") { conflict = e; return; } throw e; }
    });
    if (conflict) return { conflict: conflict.current ? { ...conflict.current, id } : null };
    return ok ? { ok: true, id, rev } : { ok: false, id };
  }
  const ok = await track(label, () => ref.set(body));
  return ok ? { ok: true, id, rev } : { ok: false, id };
}
async function patchSong(id, patch) {
  const ref = Store.db.doc("songs/" + id);
  return track("บันทึกเพลง", () => ref.update({ ...patch, updatedAt: now(), updatedBy: Store.me.id || null }));
}
async function deleteSong(id, removeItems) {
  const items = [...Store.items.values()].filter(i => i.songId === id);
  const before = Store.songs.get(id);
  if (before) await keepHistory("song", id, before, "delete", { items: removeItems ? items : [] });
  if (removeItems) for (const it of items) await track("เอาเพลงออกจากงาน", () => Store.db.doc("items/" + it.id).delete());
  return track("ลบเพลง", () => Store.db.doc("songs/" + id).delete());
}

/* ---------- events, sets, items ---------- */
const EVENT_FIELDS = ["name", "date", "venue", "note", "slotMinutes", "gapSeconds"];
async function createEvent(fields) {
  const id = newId();
  const body = { ...pick(fields, EVENT_FIELDS), sets: fields.sets || [{ id: newId(), name: "เซ็ตหลัก" }], createdAt: now(), updatedAt: now(), updatedBy: Store.me.id || null, setsRev: 1 };
  const ok = await track("สร้างงาน", () => Store.db.doc("events/" + id).set(body));
  return ok ? id : null;
}
function pick(o, keys) { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; }
async function updateEvent(id, fields) {
  return track("บันทึกงาน", () => Store.db.doc("events/" + id).update({ ...pick(fields, EVENT_FIELDS), updatedAt: now(), updatedBy: Store.me.id || null }));
}
/** Change the list of sets with a check that nobody else changed it meanwhile. mutate(sets) returns the new array. */
async function changeSets(eventId, mutate) {
  const ref = Store.db.doc("events/" + eventId);
  try { await withTimeout(ref.acquire({ holder: TAB, ttlMs: 6000 }), 3000); } catch (e) { /* advisory */ }
  let cur;
  try { cur = await withTimeout(ref.get(), 6000); } catch (e) { toast("เชื่อมต่อไม่ได้ ยังแก้รายการเซ็ตไม่ได้"); return false; }
  if (!cur.exists) { toast("งานนี้ถูกลบไปแล้ว"); return false; }
  const data = cur.data();
  const sets = mutate((data.sets || []).map(s => ({ ...s })));
  if (!sets) return false;
  return track("บันทึกเซ็ต", () => ref.update({ sets, setsRev: (data.setsRev || 0) + 1, updatedAt: now(), updatedBy: Store.me.id || null }));
}
async function deleteEvent(id) {
  const before = Store.events.get(id);
  if (before) await keepHistory("event", id, before, "delete", { items: eventItems(id) });
  for (const it of eventItems(id)) await track("ลบรายการเพลง", () => Store.db.doc("items/" + it.id).delete());
  return track("ลบงาน", () => Store.db.doc("events/" + id).delete());
}
async function duplicateEvent(id) {
  const ev = Store.events.get(id); if (!ev) return null;
  const nid = await createEvent({ ...ev, name: ev.name + " (สำเนา)", sets: (ev.sets || []).map(s => ({ ...s })) });
  if (!nid) return null;
  for (const it of eventItems(id)) {
    const body = { ...pick(it, ITEM_FIELDS), eventId: nid, updatedAt: now() };
    await track("คัดลอกรายการเพลง", () => Store.db.doc("items/" + newId()).set(body));
  }
  return nid;
}
const ITEM_FIELDS = ["eventId", "setId", "songId", "order", "shift", "capo", "bpm", "singer", "note", "kind", "minutes", "label", "durationSec"];
async function addItems(eventId, setId, songIds) {
  let order = Math.max(0, ...setItems(eventId, setId).map(i => i.order || 0));
  let ok = true;
  const created = [];
  for (const songId of songIds) {
    order += 1000;
    const id = newId();
    const body = { eventId, setId, songId, order, shift: 0, capo: 0, bpm: null, singer: "", note: "", updatedAt: now(), updatedBy: Store.me.id || null };
    const done = await track("เพิ่มเพลงเข้าเซ็ต", () => Store.db.doc("items/" + id).set(body));
    if (done) created.push(id);
    ok = done && ok;
  }
  if (created.length) pushUndo(`เพิ่ม ${created.length} เพลงแล้ว`, async () => { let r = true; for (const id of created) r = (await removeItem(id)) && r; return r; });
  return ok;
}
async function patchItem(id, patch) {
  return track("บันทึกค่าของเพลงในงาน", () => Store.db.doc("items/" + id).update({ ...patch, updatedAt: now(), updatedBy: Store.me.id || null }));
}
const removeItem = id => track("เอาเพลงออกจากเซ็ต", () => Store.db.doc("items/" + id).delete());
/** Move an item to `setId`, just before `beforeId` (or to the end). Writes only the moved item,
 *  unless the gap between neighbours has run out, then renumbers that set once. */
async function moveItem(itemId, eventId, setId, beforeId) {
  const list = setItems(eventId, setId).filter(i => i.id !== itemId);
  const idx = beforeId ? list.findIndex(i => i.id === beforeId) : list.length;
  const prev = list[idx - 1], next = list[idx];
  let order;
  if (!prev && !next) order = 1000;
  else if (!prev) order = next.order - 1000;
  else if (!next) order = prev.order + 1000;
  else order = (prev.order + next.order) / 2;
  if (prev && next && Math.abs(next.order - prev.order) < 1e-6) {
    const all = [...list.slice(0, idx), { id: itemId }, ...list.slice(idx)];
    let ok = true;
    for (let k = 0; k < all.length; k++) ok = (await patchItem(all[k].id, { setId, order: (k + 1) * 1000 })) && ok;
    return ok;
  }
  return patchItem(itemId, { setId, order });
}

/* ---------- starter songs ---------- */
async function seedBuiltin(quiet) {
  let ok = true;
  for (const s of BUILTIN.songs) {
    if (Store.songs.has(s.id)) continue;
    ok = (await track("นำเข้าเพลง " + s.title, () => Store.db.doc("songs/" + s.id).set(songBody(s, 1)))) && ok;
  }
  for (const e of BUILTIN.events) {
    if (Store.events.has(e.id)) continue;
    const body = { ...pick(e, EVENT_FIELDS), sets: e.sets, setsRev: 1, createdAt: now(), updatedAt: now(), updatedBy: Store.me.id || null };
    ok = (await track("นำเข้างาน " + e.name, () => Store.db.doc("events/" + e.id).set(body))) && ok;
    for (const it of BUILTIN.items.filter(i => i.eventId === e.id)) {
      if (Store.items.has(it.id)) continue;
      const ib = { ...pick(it, ITEM_FIELDS), updatedAt: now() };
      ok = (await track("นำเข้ารายการเพลง", () => Store.db.doc("items/" + it.id).set(ib))) && ok;
    }
  }
  return ok;
}

/* ---------- history, trash, restore ----------
   Before a song is overwritten or a song/gig is deleted, its previous state is copied to history/{id}
   (with the gig rows it took along). The last 30 versions per song are kept. Restoring writes the old
   state back as a new revision, so restoring is itself undoable. */
const HISTORY_KEEP = 30;
const plain = o => { const r = JSON.parse(JSON.stringify(o || {})); delete r.id; return r; };
async function keepHistory(kind, refId, data, action, extra) {
  const body = { kind, refId, action, rev: (data && data.rev) || 0, title: (data && (data.title || data.name)) || "", data: plain(data),
    extra: extra ? { items: (extra.items || []).map(i => ({ ...plain(i), id: i.id })) } : null, at: now(), by: Store.me.id || null };
  const ok = await track("เก็บประวัติ", () => Store.db.doc("history/" + newId()).set(body));
  if (ok) pruneHistory(kind, refId);
  return ok;
}
async function historyList(filter) {
  try {
    const snap = await withTimeout(Store.db.collection("history").get(), 8000);
    return snap.docs.map(d => ({ ...d.data(), id: d.id })).filter(filter || (() => true)).sort((a, b) => b.at - a.at);
  } catch (e) { toast("โหลดประวัติไม่ได้: " + errText(e)); return null; }
}
async function pruneHistory(kind, refId) {
  const list = await historyList(h => h.kind === kind && h.refId === refId && h.action === "edit");
  if (!list) return;
  for (const h of list.slice(HISTORY_KEEP)) await track("ล้างประวัติเก่า", () => Store.db.doc("history/" + h.id).delete());
}
/** Deleted songs and gigs that are not back yet, newest first. */
async function trashList() {
  const list = await historyList(h => h.action === "delete");
  if (!list) return null;
  const seen = new Set();
  return list.filter(h => {
    const key = h.kind + ":" + h.refId;
    if (seen.has(key)) return false;
    seen.add(key);
    return !(h.kind === "song" ? Store.songs.has(h.refId) : Store.events.has(h.refId));
  });
}
async function restoreHistory(h) {
  if (h.kind === "song") {
    const cur = Store.songs.get(h.refId);
    if (cur) {
      const r = await saveSong({ ...h.data, id: h.refId, createdAt: cur.createdAt }, cur.rev || 0, { force: true });
      return !!(r && r.ok);
    }
    const body = { ...h.data, rev: (h.rev || 0) + 1, updatedAt: now(), updatedBy: Store.me.id || null };
    let ok = await track("กู้เพลง " + (h.title || ""), () => Store.db.doc("songs/" + h.refId).set(body));
    for (const it of (h.extra && h.extra.items) || []) {
      if (!Store.events.has(it.eventId) || Store.items.has(it.id)) continue;
      const { id, ...ib } = it;
      ok = (await track("คืนเพลงเข้างาน", () => Store.db.doc("items/" + id).set(ib))) && ok;
    }
    return ok;
  }
  const body = { ...h.data, updatedAt: now(), updatedBy: Store.me.id || null };
  let ok = await track("กู้งาน " + (h.title || ""), () => Store.db.doc("events/" + h.refId).set(body));
  for (const it of (h.extra && h.extra.items) || []) {
    if (Store.items.has(it.id) || (!isBreak(it) && !Store.songs.has(it.songId))) continue;
    const { id, ...ib } = it;
    ok = (await track("คืนรายการเพลง", () => Store.db.doc("items/" + id).set(ib))) && ok;
  }
  return ok;
}
async function purgeHistory(h) {
  const all = await historyList(x => x.kind === h.kind && x.refId === h.refId);
  for (const x of all || []) await track("ลบถาวร", () => Store.db.doc("history/" + x.id).delete());
}

/* ---------- undo for gig edits ----------
   Reordering, moving, adding, removing and resetting rows push an undo step. The toast offers
   “ย้อนกลับ”, and Ctrl/⌘+Z on the gig page undoes the latest step. */
const undoStack = [];
function pushUndo(label, revert) {
  undoStack.push({ label, revert, at: now() });
  if (undoStack.length > 30) undoStack.shift();
  toast(label, 8000, { text: "ย้อนกลับ", run: undoLast });
}
async function undoLast() {
  const u = undoStack.pop();
  if (!u) { toast("ไม่มีอะไรให้ย้อนกลับ"); return; }
  const ok = await u.revert();
  toast(ok === false ? "ย้อนกลับไม่สำเร็จ ดูที่ปุ่มสถานะ" : "ย้อนกลับแล้ว: " + u.label);
}
const rowState = it => ({ setId: it.setId, order: it.order });
async function moveItemUndoable(itemId, eventId, setId, beforeId, label = "ย้ายเพลงแล้ว") {
  const it = Store.items.get(itemId); if (!it) return false;
  const before = rowState(it);
  const ok = await moveItem(itemId, eventId, setId, beforeId);
  if (ok) pushUndo(label, () => patchItem(itemId, before));
  return ok;
}
async function patchItemUndoable(itemId, patch, label = "บันทึกแล้ว") {
  const it = Store.items.get(itemId); if (!it) return false;
  const before = {};
  for (const k of Object.keys(patch)) before[k] = it[k] === undefined ? null : it[k];
  const ok = await patchItem(itemId, patch);
  if (ok) pushUndo(label, () => patchItem(itemId, before));
  return ok;
}
async function removeItemUndoable(itemId) {
  const it = Store.items.get(itemId); if (!it) return false;
  const { id, ...body } = it;
  const ok = await removeItem(itemId);
  if (ok) pushUndo("เอาออกจากเซ็ตแล้ว", () => track("คืนเพลงเข้าเซ็ต", () => Store.db.doc("items/" + id).set(body)));
  return ok;
}
async function addBreak(eventId, setId, minutes, label) {
  const order = Math.max(0, ...setItems(eventId, setId).map(i => i.order || 0)) + 1000;
  const id = newId();
  const ok = await track("เพิ่มช่วงพัก", () => Store.db.doc("items/" + id).set({ eventId, setId, kind: "break", minutes, label: label || "พัก", order, updatedAt: now(), updatedBy: Store.me.id || null }));
  if (ok) pushUndo("เพิ่มช่วงพักแล้ว", () => removeItem(id));
  return ok;
}
