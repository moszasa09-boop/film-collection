/* ---------- members, sharing, backup & restore ---------- */
async function myRole() {
  if (Store.mode === "device") return { label: "ใช้งานบนเครื่องนี้", can: "เพิ่ม แก้ไข ลบ เพลงและงานได้ทั้งหมด ข้อมูลอยู่ในเบราว์เซอร์นี้เท่านั้น" };
  const me = Store.me;
  if (me.isOwner) return { label: "เจ้าของ", can: "แก้ไขทุกอย่าง สำรองและกู้คืนแบบแทนที่ทั้งหมดได้ แชร์ลิงก์ได้" };
  if (me.canEdit) return { label: "Editor", can: "แก้ไขทุกอย่าง สำรองและกู้คืนแบบแทนที่ทั้งหมดได้" };
  if (Store.canWrite === false) return { label: "ดูอย่างเดียว (Viewer/Commenter หรือคนนอกองค์กร)", can: "เปิดงาน เล่นเพลง ดาวน์โหลดไฟล์สำรองได้ แต่แก้ไขไม่ได้" };
  if (Store.canWrite === true) return { label: "Contributor", can: "เพิ่ม แก้ไข จัดเซ็ต และรวมไฟล์สำรองได้ (แทนที่ทั้งหมดต้องเป็น Editor)" };
  return { label: "ยังไม่ทราบระดับสิทธิ์", can: "ลองแก้ไขได้ ถ้าไม่มีสิทธิ์ ระบบจะแจ้งและไม่บันทึก" };
}
const canReplaceAll = () => Store.mode === "device" || Store.me.isOwner || Store.me.canEdit;

async function renderData() {
  document.title = "สมาชิกและข้อมูล · คอร์ดเลื่อนตามเพลง";
  const role = await myRole();
  const counts = `${Store.songs.size} เพลง · ${Store.events.size} งาน · ${Store.items.size} รายการในเซ็ต`;
  app.innerHTML = header({ title: "คอร์ดเลื่อนตามเพลง", tabs: "data" }) + `
  <main class="wrap">
    ${modeBanner()}
    <div class="page-head"><h1>สมาชิกและข้อมูล</h1><p>${esc(counts)}</p></div>

    <h2 class="section-title">สิทธิ์ของคุณ</h2>
    <p style="margin:0"><b>${esc(role.label)}</b> — ${esc(role.can)}</p>

    <h2 class="section-title">ให้สมาชิกวงเปิดงานเดียวกัน</h2>
    ${Store.mode === "device" ? `
      <p>ลิงก์นี้เปิดได้ทุกคน แต่ข้อมูลของแต่ละคนเก็บในเครื่องของคนนั้น ไม่ซิงก์กัน วิธีส่งงานให้สมาชิก:</p>
      <ol><li>กด “ดาวน์โหลดไฟล์สำรอง” ด้านล่าง แล้วส่งไฟล์ให้สมาชิก (LINE, อีเมล)</li>
      <li>สมาชิกเปิดลิงก์เดียวกัน ไปที่หน้านี้ แล้วกด “นำเข้าจากไฟล์” เลือก “รวมกับข้อมูลเดิม”</li>
      <li>ถ้าแก้งานทีหลัง ต้องส่งไฟล์ใหม่อีกครั้ง</li></ol>
      <p class="small muted">ถ้าต้องการให้ทั้งวงเห็นข้อมูลชุดเดียวกันแบบอัตโนมัติ ใช้ลิงก์ claude.ai ของเจ้าของ หรือเชื่อมฐานข้อมูลภายนอก (ดูเอกสารใน repo)</p>`
    : `
      <p>ทุกคนที่เปิดลิงก์ claude.ai นี้เห็นงาน เซ็ต และเพลงชุดเดียวกัน แก้แล้วเห็นตรงกันทันที เจ้าของเป็นคนแชร์:</p>
      <ol><li>เจ้าของกดปุ่ม <b>Share</b> ของหน้านี้บน claude.ai</li>
      <li>เพิ่มสมาชิกหรือเปิดลิงก์ แล้วตั้งระดับ: <b>Viewer</b> = ดูและเล่นได้อย่างเดียว · <b>Contributor</b> = เพิ่ม/แก้เพลงและเซ็ตได้ · <b>Editor</b> = ได้ทุกอย่างรวมถึงกู้คืนแบบแทนที่ทั้งหมด</li>
      <li>สมาชิกต้องเข้าสู่ระบบ claude.ai จึงจะเห็นข้อมูล คนนอกองค์กรหรือคนที่เปิดผ่านลิงก์สาธารณะจะดูได้อย่างเดียว</li></ol>
      <p class="small muted">การอ่านคอร์ดจากรูปใช้โควตา Claude ของคนที่กด ไม่ใช่ของเจ้าของ · ค่าที่ปรับเฉพาะตัว (ขนาดตัวอักษร โหมดเวที) เก็บแยกตามบัญชีในแต่ละเครื่อง</p>`}

    <h2 class="section-title">สำรองข้อมูล</h2>
    <p style="margin:0 0 8px">ไฟล์เดียวมีเพลง งาน เซ็ต และค่าของแต่ละเพลงในงานครบ เก็บไว้กู้คืนหรือย้ายไปเครื่องอื่นได้</p>
    <div class="row"><button class="btn primary" id="bk-save" type="button">ดาวน์โหลดไฟล์สำรอง</button><button class="btn" id="bk-show" type="button">แสดงเป็นข้อความเพื่อคัดลอก</button></div>
    <div id="bk-out"></div>

    <h2 class="section-title">กู้คืน / นำเข้าจากไฟล์</h2>
    ${writable() ? `<div class="row"><label class="btn"><input type="file" id="rs-file" accept=".json,application/json" hidden>เลือกไฟล์สำรอง (.json)</label>
      <button class="btn" id="rs-paste" type="button">วางข้อความสำรอง</button></div>
      <div id="rs-out"></div>` : `<p class="muted">บัญชีนี้ดูได้อย่างเดียว จึงนำเข้าไม่ได้</p>`}
    <div style="height:60px"></div>
  </main>`;
  $("#bk-save").onclick = saveBackupFile;
  $("#bk-show").onclick = () => {
    const txt = JSON.stringify(makeBackup(), null, 1);
    $("#bk-out").innerHTML = `<label class="f" style="margin-top:8px"><span>ข้อความสำรอง (${Math.round(txt.length / 1024)} KB)</span><textarea id="bk-text" readonly rows="8">${esc(txt)}</textarea></label>
      <button class="btn" id="bk-copy" type="button" style="margin-top:6px">คัดลอก</button>`;
    $("#bk-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(txt); toast("คัดลอกแล้ว"); }
      catch (e) { const t = $("#bk-text"); t.focus(); t.select(); toast("กด คัดลอก (Ctrl/⌘+C) ข้อความที่เลือกไว้"); }
    };
  };
  const f = $("#rs-file");
  if (f) {
    f.addEventListener("change", async () => {
      const file = f.files[0]; f.value = ""; if (!file) return;
      if (file.size > 20 * 1024 * 1024) { toast("ไฟล์ใหญ่เกินไป"); return; }
      previewRestore(await file.text());
    });
    $("#rs-paste").onclick = () => openDialog(`<h2>วางข้อความสำรอง</h2><label class="f"><span>ข้อความจากปุ่ม “แสดงเป็นข้อความ”</span><textarea id="rs-txt" rows="8" autofocus></textarea></label>
      <div class="actions"><button class="btn ghost" data-a="c" type="button">ยกเลิก</button><button class="btn primary" data-a="ok" type="button">ตรวจไฟล์</button></div>`, (el, d) => {
      $('[data-a="c"]', el).onclick = () => d.close();
      $('[data-a="ok"]', el).onclick = () => { const t = $("#rs-txt", el).value; d.close(); previewRestore(t); };
    }, { label: "วางข้อความสำรอง" });
  }
}

function makeBackup() {
  const strip = o => { const r = { ...o }; return r; };
  return {
    format: "chordscroll-backup", version: 1, exportedAt: new Date().toISOString(),
    songs: [...Store.songs.values()].map(strip), events: [...Store.events.values()].map(strip), items: [...Store.items.values()].map(strip)
  };
}
async function saveBackupFile() {
  const data = JSON.stringify(makeBackup(), null, 1);
  const name = `chordscroll-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const dl = window.claude && window.claude.use ? await window.claude.use("downloads").catch(() => null) : null;
  if (dl) {
    try { await dl.save({ filename: name, data }); toast("บันทึกไฟล์แล้ว"); }
    catch (e) { toast(e && e.code === "declined" ? "ยกเลิกการดาวน์โหลด" : "ดาวน์โหลดไม่ได้ ใช้ “แสดงเป็นข้อความ” แทน"); }
    return;
  }
  try {
    const url = URL.createObjectURL(new Blob([data], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast("เริ่มดาวน์โหลดแล้ว ถ้าไม่มีไฟล์ ใช้ “แสดงเป็นข้อความ” แทน");
  } catch (e) { toast("ดาวน์โหลดไม่ได้ ใช้ “แสดงเป็นข้อความ” แทน"); }
}

/** Check a backup before touching anything. Bad entries are listed and skipped, never half-written. */
function checkBackup(raw) {
  let data;
  try { data = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return { fatal: "ไม่ใช่ไฟล์ JSON ที่อ่านได้" }; }
  if (!data || data.format !== "chordscroll-backup") return { fatal: "ไม่ใช่ไฟล์สำรองของคอร์ดเลื่อนตามเพลง" };
  if (data.version !== 1) return { fatal: `ไฟล์สำรองรุ่น ${data.version} ยังไม่รองรับ` };
  const idOk = id => typeof id === "string" && /^[A-Za-z0-9_\-.~:@+]{1,80}$/.test(id) && id !== "." && id !== "..";
  const problems = [];
  const songs = [], events = [], items = [];
  for (const s of Array.isArray(data.songs) ? data.songs : []) {
    if (!idOk(s.id) || typeof s.title !== "string" || !s.title.trim() || !Array.isArray(s.blocks)) { problems.push(`ข้ามเพลงที่ข้อมูลไม่ครบ: ${String(s && s.title || s && s.id || "?").slice(0, 40)}`); continue; }
    if (s.bpm != null && !validBpm(s.bpm)) s.bpm = null;
    songs.push(s);
  }
  for (const e of Array.isArray(data.events) ? data.events : []) {
    if (!idOk(e.id) || typeof e.name !== "string" || !Array.isArray(e.sets) || !e.sets.every(x => x && idOk(x.id) && typeof x.name === "string")) { problems.push(`ข้ามงานที่ข้อมูลไม่ครบ: ${String(e && e.name || "?").slice(0, 40)}`); continue; }
    events.push(e);
  }
  const songIds = new Set([...songs.map(s => s.id), ...Store.songs.keys()]);
  const eventIds = new Set([...events.map(e => e.id), ...Store.events.keys()]);
  for (const it of Array.isArray(data.items) ? data.items : []) {
    if (!idOk(it.id) || !idOk(it.eventId) || !idOk(it.songId) || typeof it.order !== "number" || !isFinite(it.order)) { problems.push("ข้ามรายการเพลงในเซ็ตที่ข้อมูลไม่ครบ"); continue; }
    if (!eventIds.has(it.eventId) || !songIds.has(it.songId)) { problems.push("ข้ามรายการที่อ้างถึงงานหรือเพลงที่ไม่มีในไฟล์"); continue; }
    if (it.bpm != null && !validBpm(it.bpm)) it.bpm = null;
    it.capo = Number.isInteger(it.capo) ? clamp(it.capo, 0, 11) : 0;
    it.shift = Number.isInteger(it.shift) ? clamp(it.shift, -6, 6) : 0;
    items.push(it);
  }
  return { songs, events, items, problems, exportedAt: data.exportedAt };
}
function previewRestore(raw) {
  const r = checkBackup(raw);
  if (r.fatal) { toast(r.fatal, 5000); return; }
  const over = c => r[c].filter(x => Store[c].has(x.id)).length;
  const extra = c => [...Store[c].keys()].filter(id => !r[c].some(x => x.id === id)).length;
  const admin = canReplaceAll();
  openDialog(`<h2>นำเข้าไฟล์สำรอง</h2>
    <p class="muted" style="margin:0">ไฟล์จาก ${esc(r.exportedAt ? fmtAgo(Date.parse(r.exportedAt)) : "ไม่ทราบเวลา")}: ${r.songs.length} เพลง · ${r.events.length} งาน · ${r.items.length} รายการในเซ็ต</p>
    ${r.problems.length ? `<ul class="issues">${[...new Set(r.problems)].slice(0, 8).map(p => `<li class="warn">${esc(p)}</li>`).join("")}</ul>` : ""}
    <div class="checks">
      <div><b>รวมกับข้อมูลเดิม</b><br><span class="small muted">เพิ่มรายการใหม่ และทับเฉพาะรายการที่มีในไฟล์ (${over("songs")} เพลง, ${over("events")} งาน จะถูกทับ) รายการอื่นที่มีอยู่ไม่ถูกแตะ</span></div>
      <div><b>แทนที่ทั้งหมด</b><br><span class="small muted">ข้อมูลจะเหมือนไฟล์ทุกอย่าง ลบ ${extra("songs")} เพลง, ${extra("events")} งาน, ${extra("items")} รายการที่ไม่มีในไฟล์${admin ? "" : " · ต้องเป็น Editor หรือเจ้าของ"}</span></div>
    </div>
    <label class="f" ${admin ? "" : "hidden"}><span>พิมพ์คำว่า แทนที่ เพื่อยืนยันแบบแทนที่ทั้งหมด</span><input id="rs-confirm" autocomplete="off"></label>
    <div class="actions"><button class="btn ghost" data-a="c" type="button">ยกเลิก</button>
      ${admin ? `<button class="btn danger" data-a="replace" type="button" disabled>แทนที่ทั้งหมด</button>` : ""}
      <button class="btn primary" data-a="merge" type="button">รวมกับข้อมูลเดิม</button></div>`, (el, d) => {
    const conf = $("#rs-confirm", el), rep = $('[data-a="replace"]', el);
    if (conf && rep) conf.addEventListener("input", () => { rep.disabled = conf.value.trim() !== "แทนที่"; });
    el.addEventListener("click", async e => {
      const a = (e.target.closest("[data-a]") || {}).dataset?.a; if (!a) return;
      d.close();
      if (a === "c") return;
      await applyRestore(r, a === "replace");
    });
  }, { label: "นำเข้าไฟล์สำรอง" });
}
async function applyRestore(r, replace) {
  const out = $("#rs-out");
  let done = 0, failed = 0;
  const total = r.songs.length + r.events.length + r.items.length;
  const step = async (label, fn) => { const ok = await track(label, fn); ok ? done++ : failed++; if (out) out.innerHTML = `<p class="progress"><span class="spinner"></span> นำเข้าแล้ว ${done}/${total}${failed ? ` · ไม่สำเร็จ ${failed}` : ""}</p>`; };
  for (const s of r.songs) { const { id, ...body } = s; await step("นำเข้าเพลง " + s.title, () => Store.db.doc("songs/" + id).set(body)); }
  for (const ev of r.events) { const { id, ...body } = ev; await step("นำเข้างาน " + ev.name, () => Store.db.doc("events/" + id).set(body)); }
  for (const it of r.items) { const { id, ...body } = it; await step("นำเข้ารายการเพลง", () => Store.db.doc("items/" + id).set(body)); }
  let removed = 0;
  if (replace && !failed) {
    const keep = { songs: new Set(r.songs.map(x => x.id)), events: new Set(r.events.map(x => x.id)), items: new Set(r.items.map(x => x.id)) };
    for (const c of ["items", "events", "songs"]) for (const id of [...Store[c].keys()]) if (!keep[c].has(id)) {
      if (await track("ลบรายการที่ไม่มีในไฟล์", () => Store.db.doc(c + "/" + id).delete())) removed++; else failed++;
    }
  }
  const msg = failed ? `นำเข้าได้ ${done}/${total} รายการ ไม่สำเร็จ ${failed} (ดูที่ปุ่มสถานะเพื่อลองใหม่)${replace ? " · ยังไม่ได้ลบรายการเดิม เพราะนำเข้าไม่ครบ" : ""}`
    : `นำเข้าครบ ${done} รายการ${replace ? ` · ลบรายการที่ไม่มีในไฟล์ ${removed} รายการ` : ""}`;
  if (out) out.innerHTML = `<div class="banner ${failed ? "bad" : "info"}"><span class="grow">${esc(msg)}</span></div>`;
  toast(msg, 6000);
}
