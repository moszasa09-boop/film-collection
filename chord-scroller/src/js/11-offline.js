/* ---------- getting a gig ready to play without internet ----------
   Works on the public link (https). The app itself is cached by a service worker (sw.js) and every
   page load keeps it fresh; "เตรียมเล่นออฟไลน์" also copies the gig, its sets and every song into this
   browser and records what was copied, so the page can say plainly whether the gig is ready offline. */
const OFFLINE_CACHE = "chordscroll-app";
const offlineCapable = () => location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
const swCapable = () => offlineCapable() && "serviceWorker" in navigator && "caches" in window && !(window.claude && Store.mode === "shared");
let swReg = null;
async function registerSW() {
  if (!swCapable()) return null;
  try { swReg = await navigator.serviceWorker.register("sw.js"); return swReg; } catch (e) { return null; }
}
function eventStamp(eventId) {
  const ev = Store.events.get(eventId); if (!ev) return 0;
  let t = ev.updatedAt || 0;
  for (const it of eventItems(eventId)) {
    t = Math.max(t, it.updatedAt || 0);
    const s = !isBreak(it) && Store.songs.get(it.songId); if (s) t = Math.max(t, s.updatedAt || 0);
  }
  return t;
}
/** Synchronous answer for the readiness check: {ready, text}. */
function offlineStatus(eventId) {
  if (!swCapable()) return null;   // not offered here (claude.ai frame, file://)
  const meta = prefs.get("offline:" + eventId, null);
  if (!meta) return { ready: false, text: "ยังไม่ได้เตรียมงานนี้สำหรับเล่นออฟไลน์" };
  if (eventStamp(eventId) > meta.stamp) return { ready: false, text: "มีการแก้ไขหลังเตรียมออฟไลน์ครั้งล่าสุด กดเตรียมใหม่" };
  return { ready: true, text: `พร้อมเล่นออฟไลน์ · แอป ✓ · ${meta.songs} เพลง ✓ · เตรียมเมื่อ ${fmtAgo(meta.at)}` };
}
async function prepareOffline(eventId) {
  if (!swCapable()) {
    toast(Store.mode === "shared" ? "หน้านี้บน claude.ai เก็บไว้ใช้ออฟไลน์ไม่ได้ ใช้ลิงก์ github.io แทน" : "เปิดผ่านลิงก์ https (github.io) เพื่อเตรียมเล่นออฟไลน์", 6000);
    return false;
  }
  const ev = Store.events.get(eventId); if (!ev) return false;
  toast("กำลังเตรียมงานสำหรับเล่นออฟไลน์…", 10000);
  try {
    const reg = swReg || await registerSW();
    if (!reg) throw new Error("service worker");
    const cache = await caches.open(OFFLINE_CACHE);
    await cache.add(new Request("./", { cache: "reload" }));
    // fonts are optional: the page falls back to system Thai fonts if they are missing
    const fontLink = $('link[href*="fonts.googleapis.com/css2"]');
    if (fontLink) { try { await cache.add(new Request(fontLink.href, { mode: "no-cors" })); } catch (e) { /* fonts optional */ } }
    const items = eventItems(eventId);
    const songs = items.filter(i => !isBreak(i)).map(i => Store.songs.get(i.songId)).filter(Boolean);
    const missing = items.filter(i => !isBreak(i) && !Store.songs.has(i.songId)).length;
    const pack = { event: ev, items, songs, at: now() };
    localStorage.setItem("chordscroll-offline-pack:" + eventId, JSON.stringify(pack));
    const appOk = !!(await cache.match("./"));
    if (!appOk) throw new Error("app not cached");
    prefs.set("offline:" + eventId, { at: now(), stamp: eventStamp(eventId), songs: songs.length });
    toast(missing ? `เตรียมแล้ว แต่มี ${missing} เพลงที่ถูกลบจากคลัง` : `พร้อมเล่นออฟไลน์แล้ว: แอปและ ${songs.length} เพลงอยู่ในเครื่องนี้`, 6000);
    notify("offline");
    return true;
  } catch (e) {
    toast("เตรียมออฟไลน์ไม่สำเร็จ: " + (/quota/i.test(String(e && e.name)) ? "พื้นที่เครื่องเต็ม" : "ลองใหม่ขณะมีเน็ต"), 6000);
    return false;
  }
}
/** Packs saved for offline use, for a store that cannot reach its server (used by the Supabase connector). */
function offlinePacks() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("chordscroll-offline-pack:")) out.push(JSON.parse(localStorage.getItem(k)));
    }
  } catch (e) { /* storage blocked */ }
  return out;
}
registerSW();
