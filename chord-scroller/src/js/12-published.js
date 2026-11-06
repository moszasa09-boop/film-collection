/* ---------- the band's published copy (public link, no accounts needed) ----------
   band-data.json sits next to the app on GitHub Pages. Every device that opens the link loads it and
   brings its songs and gigs up to date, so everyone sees the same gigs and songs on every device.
   Whoever prepares the gigs publishes a new copy from “แชร์และสำรอง” (download or copy, then upload to
   GitHub). What the band removes from the published copy is removed on every device; what a member made
   only on their own device stays theirs. Before an update replaces a song someone changed on their own
   device, their version goes into the song's history, so nothing is lost. */
const PUBLISH = typeof PUBLISH_CONFIG !== "undefined" ? PUBLISH_CONFIG : null;   // {repo, branch, path}
const PUB_FILE = "band-data.json";
const Published = { at: null, songs: 0, events: 0, error: null, lastCheck: 0, lastResult: null };
const META_KEYS = new Set(["rev", "createdAt", "updatedAt", "updatedBy", "setsRev", "id"]);
const contentKey = o => JSON.stringify(sortKeys(Object.fromEntries(Object.entries(o || {}).filter(([k]) => !META_KEYS.has(k)))));
const publishedOn = () => Store.mode === "device" && /^https?:$/.test(location.protocol);

async function syncPublished({ force = false } = {}) {
  if (!publishedOn()) return null;
  Published.lastCheck = now();
  let data;
  try {
    const res = await fetch(PUB_FILE + "?t=" + Date.now(), { cache: "no-store" });
    if (res.status === 404) { Published.error = null; Published.at = null; return null; }
    if (!res.ok) throw new Error("HTTP " + res.status);
    data = await res.json();
  } catch (e) {
    Published.error = navigator.onLine ? "โหลดฉบับของวงไม่ได้" : null;   // offline: just use what this device has
    return null;
  }
  const r = checkBackup(data);
  if (r.fatal) { Published.error = "ไฟล์ฉบับของวงเสีย: " + r.fatal; return null; }
  Published.at = data.exportedAt; Published.songs = r.songs.length; Published.events = r.events.length; Published.error = null;
  const seen = prefs.get("pub:seen", null);
  if (!force && seen && seen.at === data.exportedAt) return (Published.lastResult = { unchanged: true });

  // only write what really differs (timestamps alone don't count)
  const differs = c => x => { const cur = Store[c].get(x.id); return !cur || contentKey(cur) !== contentKey(x); };
  const todo = { ...r, songs: r.songs.filter(differs("songs")), events: r.events.filter(differs("events")), items: r.items.filter(differs("items")) };
  let kept = 0;
  for (const s of todo.songs) { const cur = Store.songs.get(s.id); if (cur) { await keepHistory("song", s.id, cur, "edit"); kept++; } }
  const res = await applyRestore(todo, false, { quiet: true });

  // removed by the band since the last copy this device took
  const prev = (seen && seen.ids) || { songs: [], events: [], items: [] };
  const nowIds = { songs: new Set(r.songs.map(x => x.id)), events: new Set(r.events.map(x => x.id)), items: new Set(r.items.map(x => x.id)) };
  let removed = 0;
  for (const c of ["items", "events", "songs"]) for (const id of prev[c] || []) {
    if (nowIds[c].has(id) || !Store[c].has(id)) continue;
    if (c === "songs") await keepHistory("song", id, Store.songs.get(id), "delete", { items: [] });
    if (c === "events") await keepHistory("event", id, Store.events.get(id), "delete", { items: [] });
    if (await track("ลบตามฉบับของวง", () => Store.db.doc(c + "/" + id).delete())) removed++;
  }
  if (!res.failed) prefs.set("pub:seen", { at: data.exportedAt, ids: { songs: [...nowIds.songs], events: [...nowIds.events], items: [...nowIds.items] } });
  const changed = res.changed + removed;
  if (changed) toast(`อัปเดตตามฉบับของวงแล้ว (เผยแพร่ ${fmtAgo(Date.parse(data.exportedAt))})${kept ? ` · เก็บฉบับเดิมของ ${kept} เพลงไว้ในประวัติ` : ""}`, 7000);
  notify("published");
  return (Published.lastResult = { changed, removed, kept, failed: res.failed });
}
window.addEventListener("online", () => syncPublished());
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && now() - Published.lastCheck > 5 * 60 * 1000) syncPublished();
});

/** The copy to publish: everything on this device except history. */
function makePublishCopy() {
  const b = makeBackup();
  return JSON.stringify({ ...b, publishedFrom: "chord-scroller" }, null, 1);
}
function publishLinks() {
  if (!PUBLISH) return null;
  const base = `https://github.com/${PUBLISH.repo}`;
  return {
    upload: `${base}/upload/${PUBLISH.branch}/${PUBLISH.path}`,
    edit: `${base}/edit/${PUBLISH.branch}/${PUBLISH.path}/${PUB_FILE}`
  };
}
function publishSectionHTML() {
  if (!publishedOn()) return "";
  const links = publishLinks();
  const status = Published.at ? `ฉบับของวงล่าสุด: เผยแพร่ ${esc(fmtAgo(Date.parse(Published.at)))} · ${Published.songs} เพลง ${Published.events} งาน`
    : Published.error ? esc(Published.error) : "ยังไม่เคยเผยแพร่ฉบับของวง";
  return `<h2 class="section-title">เผยแพร่ให้ทั้งวงเห็น</h2>
    <p style="margin:0 0 6px">ทุกเครื่องที่เปิดลิงก์นี้จะดึง “ฉบับของวง” มาเอง ไม่ต้องล็อกอิน ใครจัดงานเสร็จก็เผยแพร่ฉบับใหม่ได้</p>
    <p class="small"><span class="chip ${Published.at ? "ok" : ""}">${status}</span> <button class="btn ghost" type="button" id="pub-check">ดึงฉบับล่าสุดตอนนี้</button></p>
    <ol class="small">
      <li>จัดงาน เพลง และเซ็ตในเครื่องนี้ให้เรียบร้อย</li>
      <li>กด <b>ดาวน์โหลดไฟล์เผยแพร่</b> ได้ไฟล์ชื่อ <code>${PUB_FILE}</code> (ถ้าเครื่องตั้งชื่อเป็นอย่างอื่น เปลี่ยนกลับเป็นชื่อนี้)</li>
      <li>${links ? `เปิด <a href="${esc(links.upload)}" target="_blank" rel="noopener">หน้าอัปโหลดใน GitHub</a> ลากไฟล์ไปวาง แล้วกด <b>Commit changes</b>` : "อัปโหลดไฟล์ไปไว้ข้างไฟล์ index.html ของเว็บ"}</li>
      <li>รอ 1–2 นาที ทุกเครื่องเปิดลิงก์ใหม่จะเห็นเหมือนกัน (เครื่องที่เปิดค้างไว้จะดึงเองเมื่อกลับมาที่หน้าเว็บ)</li>
    </ol>
    <div class="row"><button class="btn primary" type="button" id="pub-dl">ดาวน์โหลดไฟล์เผยแพร่</button>
      <button class="btn" type="button" id="pub-copy">คัดลอกข้อมูล (สำหรับมือถือ)</button>
      ${links ? `<a class="btn ghost" href="${esc(links.edit)}" target="_blank" rel="noopener">เปิดหน้าแก้ไฟล์ใน GitHub</a>` : ""}</div>
    <p class="small muted">บนมือถือ: กด “คัดลอกข้อมูล” → “เปิดหน้าแก้ไฟล์ใน GitHub” → ลบของเดิม วางของใหม่ → Commit changes · ต้องมีสิทธิ์แก้ repo บน GitHub · ถ้าต้องการให้ทุกคนแก้ได้และเห็นกันทันที ใช้การซิงก์วงผ่าน Supabase</p>`;
}
function wirePublishSection() {
  const dl = $("#pub-dl"); if (!dl) return;
  dl.onclick = () => {
    try {
      const url = URL.createObjectURL(new Blob([makePublishCopy()], { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = PUB_FILE; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast("ดาวน์โหลดแล้ว ขั้นต่อไป: อัปโหลดไฟล์นี้ไปที่ GitHub");
    } catch (e) { toast("ดาวน์โหลดไม่ได้ ใช้ “คัดลอกข้อมูล” แทน"); }
  };
  $("#pub-copy").onclick = () => copyText(makePublishCopy(), "คัดลอกข้อมูลแล้ว ขั้นต่อไป: วางในหน้าแก้ไฟล์ของ GitHub");
  $("#pub-check").onclick = async () => {
    const r = await syncPublished({ force: true });
    toast(!r ? (Published.error || "ยังไม่มีฉบับของวงบนเว็บ") : r.changed ? `อัปเดตแล้ว ${r.changed} รายการ` : "เครื่องนี้ตรงกับฉบับของวงแล้ว");
    route();
  };
}
