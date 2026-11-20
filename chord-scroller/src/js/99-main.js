/* ---------- routing ----------
   #                      gigs           #library        song library     #data   members & backup
   #event-<id>            one gig        #play-<event>-<item>  play a song inside a gig
   #song-<id>             play from the library   #edit-<id>  edit a song   #new-image / #new-text  add a song
   #s<set>-<n>            old links from the first version → the same song in the starter gig */
let currentRoute = null, prevHash = location.hash, ignoreHash = false;
function parseRoute(h) {
  const m = /^#?([a-z]+)(?:-([A-Za-z0-9]+))?(?:-([A-Za-z0-9]+))?$/.exec(h || "");
  if (!h || h === "#") return { name: "home" };
  const legacy = /^#s(\d+)-(\d+)$/.exec(h);
  if (legacy) return { name: "legacy", a: +legacy[1], b: +legacy[2] };
  if (!m) return { name: "home" };
  return { name: m[1], a: m[2], b: m[3] };
}
function route() {
  const r = parseRoute(location.hash);
  const same = currentRoute && currentRoute.name === r.name && currentRoute.a === r.a && currentRoute.b === r.b;
  if (currentRoute && !same) {
    if (currentRoute.name === "play" || currentRoute.name === "song") leavePlayer();
    if (["edit", "new"].includes(currentRoute.name)) closeEditor();
  }
  currentRoute = r;
  switch (r.name) {
    case "library": return renderLibrary();
    case "data": return renderData();
    case "event": return renderEvent(r.a);
    case "play": return renderPlayer("event", r.a, r.b);
    case "song": return renderPlayer("song", r.a);
    case "edit": return renderEditor("edit", r.a);
    case "new": return renderEditor(r.a === "image" ? "image" : "text");
    case "legacy": {
      // the first version had one set (ITD, now “เบรค 2”); old links point into it by position
      const LEGACY = ["e9adc0d877e2"];
      const ev = BUILTIN.events.find(e => e.id === LEGACY[r.a - 1]) || BUILTIN.events[r.a - 1];
      const it = ev && Store.events.has(ev.id) && eventItems(ev.id).filter(i => !isBreak(i))[r.b - 1];
      if (it) { location.replace("#play-" + ev.id + "-" + it.id); return; }
      if (!Store.fresh && Store.mode !== "device") { app.innerHTML = header({ title: "คอร์ดเลื่อนตามเพลง" }) + `<main class="wrap"><p class="empty">กำลังโหลด…</p></main>`; return; }
      location.replace("#"); return;
    }
    default: return renderHome();
  }
}
window.addEventListener("hashchange", async () => {
  if (ignoreHash) { ignoreHash = false; return; }
  const leavingEditor = currentRoute && ["edit", "new"].includes(currentRoute.name) && dirtyGuard;
  if (leavingEditor) {
    const target = location.hash;
    ignoreHash = true; location.hash = prevHash;   // stay until the person decides
    if (!(await confirmDialog("ออกโดยไม่บันทึก?", "สิ่งที่แก้ในเพลงนี้ยังไม่ได้บันทึก ถ้าออกตอนนี้จะหายไป", "ออกโดยไม่บันทึก", true))) return;
    closeEditor();
    ignoreHash = false; location.hash = target; prevHash = target;
    return;
  }
  prevHash = location.hash;
  route();
});

/* data changed: redraw what is on screen without losing typing or position */
let redrawQueued = false, lastWhat = new Set();
Store.listeners.add(what => {
  lastWhat.add(what);
  if (redrawQueued) return;
  redrawQueued = true;
  requestAnimationFrame(() => {
    redrawQueued = false;
    const whats = lastWhat; lastWhat = new Set();
    refreshSyncPill();
    if (whats.size === 1 && whats.has("sync")) {
      const banner = $("main .banner"); // the "can't reach the database" note may need to appear or go
      if (currentRoute && ["home", "library", "event"].includes(currentRoute.name) && (Store.slow || banner)) route();
      return;
    }
    const r = currentRoute || { name: "home" };
    if (r.name === "home" && $("#home-list")) return renderHomeList();
    if (r.name === "library" && $("#lib-list")) return renderLibList();
    if (r.name === "data") return; // holds file inputs; counts refresh on next visit
    if (r.name === "edit" || r.name === "new") {
      if (!ed) return route();
      if (ed.mode === "edit") {
        const s = Store.songs.get(ed.id);
        if (s && (s.rev || 0) !== ed.baseRev && !ed.remoteChanged) { ed.remoteChanged = true; showRemoteNote(); }
      }
      return;
    }
    route();
  });
});

/* ---------- start ---------- */
app.innerHTML = header({ title: "คอร์ดเลื่อนตามเพลง" }) + `<main class="wrap"><p class="empty">กำลังโหลด…</p></main>`;
initStore().then(() => { route(); syncPublished(); }, e => { console.error(e); route(); });
window.ChordApp = { textToBlocks, blocksToText, convertChordsAbove, validateSong, tr, keyOf, isChord, analyse, songSeconds, songStats, checkBackup, Store, P, Sync };
