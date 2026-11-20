/* ---------- add / edit a song (from pictures, typed or pasted text) ---------- */
let ed = null;          // editor state while the editor is open
let edLeaseTimer = 0;
function closeEditor() { ed = null; dirtyGuard = null; clearInterval(edLeaseTimer); }

function renderEditor(mode, songId) {
  // mode: "image" | "text" | "edit"
  const existing = songId ? Store.songs.get(songId) : null;
  if (mode === "edit" && !existing) {
    app.innerHTML = header({ title: "แก้ไขเพลง", back: "#library" }) + `<main class="wrap"><p class="empty">${Store.loaded.songs ? "ไม่พบเพลงนี้ อาจถูกลบไปแล้ว" : "กำลังโหลด…"}</p></main>`;
    return;
  }
  if (!writable()) {
    app.innerHTML = header({ title: "แก้ไขเพลง", back: "#library" }) + `<main class="wrap">${modeBanner()}<p class="empty">หน้านี้ใช้แก้ไขเพลง บัญชีหรือฉบับที่เปิดอยู่แก้ไขไม่ได้</p></main>`;
    return;
  }
  const key = mode + ":" + (songId || "");
  if (!ed || ed.key !== key) {
    ed = {
      key, mode, id: existing ? existing.id : null, baseRev: existing ? (existing.rev || 0) : null,
      title: existing ? existing.title : "", artist: existing ? existing.artist || "" : "",
      bpm: existing && validBpm(existing.bpm) ? existing.bpm : "",
      text: existing ? blocksToText(existing.blocks) : "",
      sourceCheck: existing ? existing.sourceCheck || "unchecked" : "unchecked",
      musicCheck: existing ? existing.musicCheck || "unchecked" : "unchecked",
      source: existing ? existing.source || "text" : mode === "image" ? "image" : "text",
      target: "new", targetId: "", images: [], modelNotes: null, reading: null, dirty: false, remoteChanged: false
    };
    if (mode === "edit") startEditLease(existing.id);
  }
  const title = mode === "edit" ? "แก้ไขเพลง" : mode === "image" ? "เพิ่มเพลงจากรูป" : "เพิ่มเพลง";
  document.title = title + " · คอร์ดเลื่อนตามเพลง";
  const back = mode === "edit" ? "#song-" + ed.id : "#library";
  app.innerHTML = header({ title, back }) + `
  <main class="wrap wide">
    ${modeBanner()}
    <div id="ed-remote"></div>
    <div class="editor">
      ${mode !== "edit" ? imagePanel() : `<details class="help"><summary>อ่านเนื้อเพลงใหม่จากรูป</summary>${imagePanel()}</details>`}
      <div class="grid2">
        <label class="f"><span>ชื่อเพลง *</span><input id="ed-title" maxlength="120" value="${esc(ed.title)}"></label>
        <label class="f"><span>ศิลปิน</span><input id="ed-artist" maxlength="120" value="${esc(ed.artist)}"></label>
        <label class="f"><span>BPM (40–220)</span><input id="ed-bpm" type="number" inputmode="numeric" min="40" max="220" step="1" value="${ed.bpm}" placeholder="80"></label>
      </div>
      ${mode !== "edit" ? `<fieldset class="f" style="border:0;padding:0;margin:0"><legend style="font-weight:600;color:var(--muted);font-size:14px">บันทึกเป็น</legend>
        <div class="checks">
          <label><input type="radio" name="ed-target" value="new" ${ed.target === "new" ? "checked" : ""}> เพลงใหม่ในคลัง</label>
          <label><input type="radio" name="ed-target" value="update" ${ed.target === "update" ? "checked" : ""}> อัปเดตเพลงที่มีอยู่ (แทนที่เนื้อเพลงและคอร์ด)</label>
          <select id="ed-target-id" class="f" style="min-height:44px;border-radius:10px;border:1px solid var(--rule);padding:0 10px;background:var(--surface)" ${ed.target === "update" ? "" : "hidden"}>
            <option value="">เลือกเพลงที่จะอัปเดต</option>
            ${songList().map(s => `<option value="${esc(s.id)}" ${ed.targetId === s.id ? "selected" : ""}>${esc(s.title)}${s.artist ? " – " + esc(s.artist) : ""}</option>`).join("")}
          </select>
        </div></fieldset>` : ""}
      <div class="editor-cols">
        <div style="display:grid;gap:8px;min-width:0">
          <label class="f"><span>เนื้อเพลงและคอร์ด</span>
            <textarea id="ed-text" spellcheck="false" autocapitalize="off" autocomplete="off" placeholder="[Em]สุดท้าย.. ต่อให้เหนี่ยว [Am]รั้งสักเท่าไหร่">${esc(ed.text)}</textarea></label>
          <div class="row" id="ed-convert-row" hidden><span class="small muted grow">ดูเหมือนคอร์ดอยู่บรรทัดบนของเนื้อร้อง</span><button class="btn" type="button" id="ed-convert">แปลงคอร์ดบรรทัดบนเป็น [คอร์ด]</button></div>
          <details class="help"><summary>วิธีเขียน</summary>
            <p><code>[Em]สุดท้าย.. ต่อให้เหนี่ยว [Am]รั้ง</code> ใส่คอร์ดในวงเล็บเหลี่ยมหน้าพยางค์ที่อยู่ใต้คอร์ด</p>
            <p><code>[INTRO] | Em | Em | C | C | ( 2 Times )</code> กล่องดนตรี · <code>| C | D |</code> แถวต่อของกล่องเดิม</p>
            <p>เว้นบรรทัดว่าง = ขึ้นท่อนใหม่ · <code>## ฮุค</code> ตั้งชื่อท่อน · <code>&gt; ( ซ้ำ * )</code> หมายเหตุ · ขึ้นต้นท่อนด้วย * หรือ ** เพื่อให้ระบบรู้ว่าเป็นท่อนฮุค</p>
            <p><code>[Am?]</code> คอร์ดที่อ่านไม่ชัด · <code>{?คำ}</code> คำที่อ่านไม่ชัด — ลบ ? ออกเมื่อตรวจแล้ว</p>
            <p>วางเนื้อที่มีคอร์ดอยู่บรรทัดบน (แบบเว็บคอร์ดทั่วไป) แล้วกดปุ่มแปลงได้</p>
          </details>
          <ul class="issues" id="ed-issues"></ul>
          <div class="checks">
            <label><input type="checkbox" id="ed-src" ${ed.sourceCheck === "matched" ? "checked" : ""}> ตรวจกับรูปหรือต้นฉบับแล้ว คอร์ดและเนื้อตรงตามที่พิมพ์ไว้</label>
            <label><input type="checkbox" id="ed-music" ${ed.musicCheck === "checked" ? "checked" : ""}> ตรวจกับเพลงจริงแล้ว (ฟังและเล่นตามแล้วถูก)</label>
          </div>
        </div>
        <div class="preview" aria-label="ตัวอย่าง"><div class="song-head"><h1 id="pv-title" style="font-size:22px"></h1><div class="meta" id="pv-meta"></div></div><div class="sheet" id="pv-sheet"></div></div>
      </div>
    </div>
  </main>
  <div class="player" style="padding-bottom:env(safe-area-inset-bottom,0px)"><div class="wrap"><div class="row">
    <span class="small muted grow" id="ed-state"></span>
    ${mode === "edit" ? `<button class="btn ghost" type="button" id="ed-hist">ประวัติ</button><button class="btn danger" type="button" id="ed-del">ลบเพลง</button>` : ""}
    <a class="btn ghost" href="${back}">ยกเลิก</a>
    <button class="btn primary" type="button" id="ed-save">บันทึก</button>
  </div></div></div>`;
  wireEditor();
  edRefresh();
  if (ed.remoteChanged) showRemoteNote();
}

function markDirty() { ed.dirty = true; dirtyGuard = "ยังไม่ได้บันทึกเพลงนี้"; }
function readFields() {
  ed.title = $("#ed-title").value; ed.artist = $("#ed-artist").value;
  const b = $("#ed-bpm").value.trim(); ed.bpm = b === "" ? "" : Number(b);
  ed.text = $("#ed-text").value;
  ed.sourceCheck = $("#ed-src").checked ? "matched" : "unchecked";
  ed.musicCheck = $("#ed-music").checked ? "checked" : "unchecked";
  const t = $('input[name="ed-target"]:checked'); if (t) ed.target = t.value;
  const tid = $("#ed-target-id"); if (tid) ed.targetId = tid.value;
}
function edSong() {
  const parsed = textToBlocks(ed.text);
  const song = { id: ed.mode === "edit" ? ed.id : ed.target === "update" ? ed.targetId : null, title: ed.title, artist: ed.artist,
    bpm: ed.bpm === "" ? null : ed.bpm, blocks: parsed.blocks, source: ed.source, sourceCheck: ed.sourceCheck, musicCheck: ed.musicCheck };
  return { song, parsed };
}
let edTimer = 0;
function edRefresh() {
  if (!ed) return;
  const { song, parsed } = edSong();
  const v = validateSong(song, parsed, songList());
  if (ed.mode !== "edit" && ed.target === "update" && !ed.targetId) v.errors.push({ msg: "เลือกเพลงที่จะอัปเดต" });
  if (ed.modelNotes && ed.modelNotes.length) ed.modelNotes.forEach(u => v.warnings.push({ msg: `จากการอ่านรูป: บรรทัด ${u.line || "?"} ${u.what || ""}`.trim() }));
  $("#ed-issues").innerHTML = [...v.errors.map(e => `<li class="err">${e.line ? `บรรทัด ${e.line}: ` : ""}${esc(e.msg)}</li>`),
    ...v.warnings.map(w => `<li class="warn">${esc(w.msg)}${w.dupId && ed.mode !== "edit" ? ` <button class="btn" type="button" data-usedup="${esc(w.dupId)}">อัปเดตเพลงนั้นแทน</button>` : ""}</li>`)].join("")
    || `<li>พร้อมบันทึก · ${v.stats.lyricLines} บรรทัดเนื้อร้อง · ${v.stats.chords} คอร์ด</li>`;
  const src = $("#ed-src");
  src.disabled = v.stats.unclear > 0;
  src.parentElement.title = v.stats.unclear ? "ยังมีจุดอ่านไม่ชัด ตรวจและลบเครื่องหมาย ? ก่อน" : "";
  if (v.stats.unclear && src.checked) { src.checked = false; ed.sourceCheck = "unchecked"; }
  $("#pv-title").textContent = song.title || "ชื่อเพลง";
  $("#pv-meta").innerHTML = [song.artist && esc(song.artist), keyOf(song.blocks) && `คีย์ <b>${esc(keyOf(song.blocks))}</b>`, `ราว ${fmtTime(songSeconds(song.blocks, song.bpm))}`].filter(Boolean).join(" · ");
  $("#pv-sheet").innerHTML = sheetHTML(analyse(song.blocks), 0) || `<p class="muted">ตัวอย่างจะแสดงตรงนี้</p>`;
  $("#ed-convert-row").hidden = !ed.text.split("\n").some((l, i, a) => isChordLine(l) && !INSTRU_RE.test(l.trim()) && a[i + 1] && a[i + 1].trim() && !isChordLine(a[i + 1]));
  $("#ed-state").textContent = v.errors.length ? `ต้องแก้ ${v.errors.length} จุดก่อนบันทึก` : ed.dirty ? "ยังไม่ได้บันทึก" : "";
  return v;
}
function wireEditor() {
  const main = app;
  main.addEventListener("input", e => {
    if (!ed || !inside(e.target, "#ed-title, #ed-artist, #ed-bpm, #ed-text, #ed-src, #ed-music, [name=ed-target], #ed-target-id")) return;
    readFields(); markDirty();
    const tid = $("#ed-target-id"); if (tid) tid.hidden = ed.target !== "update";
    clearTimeout(edTimer); edTimer = setTimeout(edRefresh, 150);
  });
  main.addEventListener("change", e => { if (ed && inside(e.target, "#ed-src, #ed-music, [name=ed-target], #ed-target-id")) { readFields(); markDirty(); const tid = $("#ed-target-id"); if (tid) tid.hidden = ed.target !== "update"; edRefresh(); } });
  $("#ed-issues").addEventListener("click", e => {
    const b = e.target.closest("[data-usedup]"); if (!b) return;
    ed.target = "update"; ed.targetId = b.dataset.usedup;
    const r = $('input[name="ed-target"][value="update"]'); if (r) r.checked = true;
    const tid = $("#ed-target-id"); tid.hidden = false; tid.value = ed.targetId;
    edRefresh();
  });
  $("#ed-convert").onclick = () => {
    const r = convertChordsAbove($("#ed-text").value);
    $("#ed-text").value = r.text; readFields(); markDirty(); edRefresh();
    toast(`แปลง ${r.changed} บรรทัดแล้ว ตรวจตำแหน่งคอร์ดในตัวอย่างด้านข้าง`);
  };
  $("#ed-save").onclick = saveEditor;
  const del = $("#ed-del"); if (del) del.onclick = deleteFromEditor;
  const hist = $("#ed-hist"); if (hist) hist.onclick = () => openSongHistory(ed.id);
  wireImagePanel();
}

async function saveEditor() {
  readFields();
  const v = edRefresh();
  if (v.errors.length) { toast("ยังบันทึกไม่ได้: " + v.errors[0].msg); (v.errors[0].field === "title" ? $("#ed-title") : $("#ed-text")).focus(); return; }
  const { song } = edSong();
  let baseRev = ed.baseRev;
  if (ed.mode !== "edit" && ed.target === "update") {
    const t = Store.songs.get(ed.targetId);
    if (!t) { toast("ไม่พบเพลงที่เลือก อาจถูกลบไปแล้ว"); return; }
    const used = usageOf(t.id).size;
    const ok = await confirmDialog(`แทนที่ “${t.title}”?`, `เนื้อเพลงและคอร์ดเดิมจะถูกแทนที่ด้วยที่อยู่ในหน้านี้${used ? ` เพลงนี้ใช้อยู่ใน ${used} งาน ทุกงานจะเห็นเนื้อใหม่ (คีย์/BPM ที่ตั้งในแต่ละงานยังอยู่)` : ""}`, "แทนที่", true);
    if (!ok) return;
    baseRev = t.rev || 0;
    song.createdAt = t.createdAt;
  } else if (ed.mode !== "edit" && v.warnings.some(w => w.dupId)) {
    const ok = await confirmDialog("มีเพลงชื่อนี้ในคลังแล้ว", "บันทึกเป็นอีกเพลงแยกกันไหม? ถ้าต้องการแก้เพลงเดิม เลือก “อัปเดตเพลงที่มีอยู่” แทน", "บันทึกเป็นเพลงใหม่");
    if (!ok) return;
  }
  if (ed.mode === "edit") song.createdAt = (Store.songs.get(ed.id) || {}).createdAt;
  $("#ed-save").disabled = true; $("#ed-state").textContent = "กำลังตรวจและบันทึก…";
  let r = await saveSong(song, baseRev);
  if (r.unchecked) {
    const go = await confirmDialog("ตรวจไม่ได้ว่ามีคนแก้เพลงนี้ชนกันไหม", "ตอนนี้เชื่อมต่อฐานข้อมูลไม่ได้ ถ้าบันทึกต่อ อาจทับสิ่งที่คนอื่นเพิ่งบันทึก", "บันทึกทับต่อ", true);
    r = go ? await saveSong(song, baseRev, { force: true }) : { ok: false };
  }
  if (r.conflict !== undefined) { $("#ed-save").disabled = false; return resolveConflict(song, r.conflict); }
  if (!ed) return;
  $("#ed-save").disabled = false;
  if (r.ok) {
    const id = r.id;
    closeEditor();
    toast("บันทึกแล้ว");
    location.hash = "#song-" + id;
  } else edRefresh();
}
function resolveConflict(mine, theirs) {
  const who = theirs && theirs.updatedAt ? fmtAgo(theirs.updatedAt) : "";
  openDialog(`<h2>${theirs ? "มีคนบันทึกเพลงนี้ไปก่อน" : "เพลงนี้ถูกลบไปแล้ว"}</h2>
    <p class="muted" style="margin:0">${theirs ? `มีการบันทึกเพลงนี้ ${esc(who)} หลังจากที่คุณเปิดแก้ ถ้าบันทึกของคุณทับ สิ่งที่เขาแก้จะหายไป` : "ระหว่างที่คุณแก้ มีคนลบเพลงนี้ออกจากคลัง"}</p>
    <div class="checks">
      <button class="btn" data-a="new" type="button">บันทึกของฉันเป็นเพลงใหม่ (ปลอดภัยที่สุด)</button>
      ${theirs ? `<button class="btn" data-a="load" type="button">ทิ้งของฉัน แล้วเปิดฉบับล่าสุด</button>` : ""}
      <button class="btn danger" data-a="force" type="button">${theirs ? "บันทึกของฉันทับ" : "บันทึกกลับเข้าคลัง"}</button>
    </div>
    <div class="actions"><button class="btn ghost" data-a="c" type="button">กลับไปแก้ต่อ</button></div>`, (el, d) => {
    el.addEventListener("click", async e => {
      const a = (e.target.closest("[data-a]") || {}).dataset?.a; if (!a) return;
      d.close();
      if (a === "c") return;
      if (a === "load") { const k = ed.key, m = ed.mode, id = ed.id || ed.targetId; closeEditor(); ed = null; renderEditor(m === "edit" ? "edit" : m, m === "edit" ? id : undefined); return; }
      let r;
      if (a === "new") r = await saveSong({ ...mine, id: null, title: mine.title + (theirs ? " (ฉบับของฉัน)" : "") }, null);
      else r = await saveSong(mine, null, { force: true });
      if (r && r.ok) { closeEditor(); toast("บันทึกแล้ว"); location.hash = "#song-" + r.id; }
    });
  }, { label: "บันทึกชนกัน" });
}
async function deleteFromEditor() {
  const s = Store.songs.get(ed.id); if (!s) return;
  const used = usageOf(s.id);
  const names = [...used.keys()].map(id => (Store.events.get(id) || {}).name).filter(Boolean);
  const ok = await confirmDialog(`ลบเพลง “${s.title}” ออกจากคลัง?`,
    used.size ? `เพลงนี้ใช้อยู่ใน ${used.size} งาน (${names.slice(0, 3).join(", ")}${names.length > 3 ? " …" : ""}) จะถูกเอาออกจากงานเหล่านั้นด้วย กู้คืนพร้อมตำแหน่งในงานได้จากถังขยะ` : "กู้คืนได้จากถังขยะในหน้า “แชร์และสำรอง”", "ลบเพลง", true);
  if (!ok) return;
  closeEditor(); location.hash = "#library";
  if (await deleteSong(s.id, true)) toast("ลบเพลงแล้ว");
}
function startEditLease(id) {
  clearInterval(edLeaseTimer);
  const ref = Store.db && Store.db.doc("songs/" + id);
  if (!ref) return;
  const take = async () => {
    try {
      const r = await withTimeout(ref.acquire({ holder: TAB, ttlMs: 60000 }), 5000);
      const box = $("#ed-remote");
      if (box && !r.acquired) box.innerHTML = `<div class="banner"><span class="grow">อาจมีคนอื่นกำลังแก้เพลงนี้อยู่ (ถึงประมาณ ${esc(fmtAgo(Date.parse(r.expiresAt)) || "")}) ถ้าบันทึกพร้อมกัน ระบบจะถามก่อนทับ</span></div>`;
    } catch (e) { /* advisory only */ }
  };
  take(); edLeaseTimer = setInterval(take, 45000);
}
function showRemoteNote() {
  const box = $("#ed-remote");
  if (box) box.innerHTML = `<div class="banner"><span class="grow"><b>มีคนบันทึกเพลงนี้ระหว่างที่คุณแก้</b> ตอนกดบันทึก ระบบจะให้เลือกว่าจะเก็บฉบับไหน</span></div>`;
}

/* ---------- reading pictures with Claude ---------- */
function imagePanel() {
  return `<section class="dropzone" id="ed-drop" aria-label="รูปเนื้อเพลงและคอร์ด">
    <b>วาง เลือก หรือลากรูปชีทคอร์ดมาที่นี่</b>
    <span class="small">หลายรูปต่อหนึ่งเพลงได้ เรียงลำดับก่อนกดอ่าน · ระบบอ่านให้แล้วคุณตรวจแก้ก่อนบันทึก</span>
    <div class="thumbs" id="ed-thumbs"></div>
    <div class="row"><label class="btn"><input type="file" id="ed-file" accept="image/*" multiple hidden>เลือกรูป</label>
      <button class="btn primary" type="button" id="ed-read" disabled>อ่านจากรูป</button>
      <button class="btn ghost" type="button" id="ed-stop" hidden>หยุด</button></div>
    <div class="progress" id="ed-progress" hidden><span class="spinner" aria-hidden="true"></span><span id="ed-progress-t">กำลังอ่าน…</span></div>
    <p class="small" id="ed-img-note"></p>
  </section>`;
}
let sampleFn = undefined, sampleLimits = null;
async function getSample() {
  if (sampleFn !== undefined) return sampleFn;
  sampleFn = Store.mode === "cloud" && Store.canWrite !== false ? cloudSampler()
    : window.claude && window.claude.use ? await window.claude.use("sample").catch(() => null) : null;
  if (sampleFn) sampleLimits = await sampleFn.limits().catch(() => null);
  return sampleFn;
}
function drawThumbs() {
  const box = $("#ed-thumbs"); if (!box || !ed) return;
  box.innerHTML = ed.images.map((im, i) => `<div class="thumb"><img src="${im.url}" alt="รูปที่ ${i + 1}"><span class="n">${i + 1}</span>
    <span class="row"><button type="button" data-mv="${i}:-1" aria-label="เลื่อนรูปที่ ${i + 1} ไปก่อน" ${i === 0 ? "disabled" : ""}>←</button>
    <button type="button" data-rm="${i}" aria-label="เอารูปที่ ${i + 1} ออก">✕</button>
    <button type="button" data-mv="${i}:1" aria-label="เลื่อนรูปที่ ${i + 1} ไปหลัง" ${i === ed.images.length - 1 ? "disabled" : ""}>→</button></span></div>`).join("");
  const rd = $("#ed-read"); if (rd) rd.disabled = !ed.images.length || !!ed.reading;
}
function addImages(files) {
  const imgs = [...files].filter(f => /^image\//.test(f.type));
  if (!imgs.length) { toast("ไฟล์ที่เลือกไม่ใช่รูปภาพ"); return; }
  for (const f of imgs) ed.images.push({ file: f, url: URL.createObjectURL(f) });
  markDirty(); drawThumbs();
}
async function wireImagePanel() {
  const drop = $("#ed-drop"); if (!drop) return;
  drawThumbs();
  const s = await getSample();
  const note = $("#ed-img-note");
  if (!s || !(sampleLimits && sampleLimits.images)) {
    if (note) note.textContent = Store.mode === "device" ? (cloudConfigured() ? "เข้าสู่ระบบและเข้าวงก่อน จึงจะอ่านรูปได้ ระหว่างนี้พิมพ์หรือวางข้อความด้านล่างแทนได้" : "การอ่านจากรูปใช้ได้เมื่อเปิดผ่านลิงก์ claude.ai ระหว่างนี้พิมพ์หรือวางข้อความด้านล่างแทนได้") : "หน้านี้ส่งรูปให้ Claude อ่านไม่ได้ในตอนนี้ พิมพ์หรือวางข้อความด้านล่างแทนได้";
    $("#ed-read").hidden = true;
  } else if (note) note.textContent = Store.mode === "cloud" ? `อ่านด้วย Claude ผ่านเซิร์ฟเวอร์ของวง (ใช้คีย์ Anthropic ของเจ้าของวง) อาจใช้เวลา 30–90 วินาที สูงสุด ${sampleLimits.images.maxCount} รูปต่อครั้ง และ 40 รูปต่อคนต่อชั่วโมง` : `การอ่านใช้โควตา Claude ของบัญชีที่กดอ่าน และอาจใช้เวลา 30–90 วินาที (สูงสุด ${sampleLimits.images.maxCount} รูปต่อครั้ง)`;
  $("#ed-file").addEventListener("change", e => { addImages(e.target.files); e.target.value = ""; });
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files.length) addImages(e.dataTransfer.files); });
  $("#ed-thumbs").addEventListener("click", e => {
    const mv = e.target.closest("[data-mv]"), rm = e.target.closest("[data-rm]");
    if (mv) { const [i, d] = mv.dataset.mv.split(":").map(Number); const j = i + d; [ed.images[i], ed.images[j]] = [ed.images[j], ed.images[i]]; drawThumbs(); }
    if (rm) { const i = +rm.dataset.rm; URL.revokeObjectURL(ed.images[i].url); ed.images.splice(i, 1); drawThumbs(); }
  });
  $("#ed-read").onclick = readImages;
  $("#ed-stop").onclick = () => ed && ed.reading && ed.reading.abort();
}
document.addEventListener("paste", e => {
  if (!ed || !$("#ed-drop")) return;
  const files = [...(e.clipboardData && e.clipboardData.files || [])].filter(f => /^image\//.test(f.type));
  if (files.length) { e.preventDefault(); addImages(files); }
});

/** Big photos are cut into overlapping bands so small print survives the ~1.2-megapixel limit. */
async function prepareImages(files, maxCount) {
  const out = [];
  const bitmaps = [];
  for (const f of files) {
    try { bitmaps.push({ f, bmp: await createImageBitmap(f) }); } catch (e) { bitmaps.push({ f, bmp: null }); }
  }
  let budget = maxCount - files.length;
  for (const { f, bmp } of bitmaps) {
    if (!bmp) { out.push(f); continue; }
    const mp = bmp.width * bmp.height / 1e6;
    const want = Math.min(4, Math.ceil(mp / 1.2));
    if (want <= 1 || budget < want - 1) { out.push(f); continue; }
    budget -= want - 1;
    const tall = bmp.height >= bmp.width;
    const len = tall ? bmp.height : bmp.width, step = len / want, ov = Math.round(step * 0.06);
    for (let k = 0; k < want; k++) {
      const a = Math.max(0, Math.round(k * step) - ov), b = Math.min(len, Math.round((k + 1) * step) + ov);
      const c = document.createElement("canvas");
      c.width = tall ? bmp.width : b - a; c.height = tall ? b - a : bmp.height;
      c.getContext("2d").drawImage(bmp, tall ? 0 : a, tall ? a : 0, c.width, c.height, 0, 0, c.width, c.height);
      out.push(await new Promise(r => c.toBlob(r, "image/jpeg", 0.92)));
    }
  }
  return out;
}
function ocrPrompt(n, tiled) {
  return `You are transcribing a guitar chord sheet for a Thai band's stage app.
The ${n} attached image(s) are in order and together form ONE song.${tiled ? " Some images are overlapping slices of one photo (top to bottom, or left to right): never write an overlapping line twice." : ""}
If the sheet is printed in several columns, read column 1 top to bottom, then column 2, and so on.

Reply with ONLY this JSON object:
{"title": string|null, "artist": string|null, "bpm": integer|null, "text": string, "unclear": [{"line": integer, "what": string}], "notes": string}

"text" uses this format, one printed line per text line:
- Lyric line: put each chord in square brackets IMMEDIATELY BEFORE the syllable printed directly under that chord, e.g. [Em]สุดท้าย.. ต่อให้เหนี่ยว [Am]รั้งสักเท่าไหร่
- A chord with no lyric under it goes at the end of the line, or on its own line like: [C] [G]
- Boxes of bars (INTRO, INSTRU, OUTRO, SOLO): [INTRO] | Em | Em | C | C | ( 2 Times )  (keep repeat notes; a second row of the same box starts with | )
- A blank line between stanzas, as printed.
- A section name only when one is printed (Verse, Hook, ...): ## Hook
- Printed notes such as ( ซ้ำ * ) or ( Till End ): > ( ซ้ำ * )
- Keep *, ** markers, "..", parentheses and spelling exactly as printed. Copy every Thai vowel and tone mark exactly. Some Thai fonts draw คำ so it looks like ศำ: write the real word.
- Chord spelling exactly as printed (#, b, m, 7, maj7, sus4, slash chords like D/F#).

Honesty rules, which matter more than completeness:
- A chord you cannot read with confidence gets a question mark: [Am?]. A word you cannot read with confidence is wrapped: {?คำ}. A line you cannot read at all: {?อ่านไม่ออก}.
- List every such spot in "unclear" with its 1-based line number in "text" and what is uncertain.
- Never invent lyrics or chords that are not in the images, and do not "fix" the music.
- If an image is not a chord sheet, return "text": "" and say so in "notes".
- "bpm" only if a tempo is printed; otherwise null. "title"/"artist" only if printed; otherwise null.`;
}
async function readImages() {
  if (!ed || !ed.images.length) return;
  const sample = await getSample();
  if (!sample) return;
  readFields();
  const max = (sampleLimits && sampleLimits.images && sampleLimits.images.maxCount) || 5;
  if (ed.images.length > max) { toast(`อ่านได้ครั้งละไม่เกิน ${max} รูป เอาบางรูปออก หรืออ่านทีละชุดแล้วต่อข้อความ`); return; }
  const ctl = new AbortController();
  ed.reading = ctl;
  $("#ed-read").disabled = true; $("#ed-stop").hidden = false; $("#ed-progress").hidden = false;
  $("#ed-progress-t").textContent = "กำลังเตรียมรูป…";
  try {
    const blobs = await prepareImages(ed.images.map(i => i.file), max);
    $("#ed-progress-t").textContent = "Claude กำลังอ่านรูป… (มักใช้ 30–90 วินาที)";
    const res = await sample.json(ocrPrompt(blobs.length, blobs.length > ed.images.length), {
      tiled: blobs.length > ed.images.length,
      images: blobs, signal: ctl.signal,
      onText: ({ text }) => { $("#ed-progress-t").textContent = `กำลังเขียนผล… ${text.length} ตัวอักษร`; }
    });
    if (!ed) return;
    if (!res || typeof res.text !== "string") throw { code: "invalid_json" };
    if (!res.text.trim()) { toast(res.notes ? "อ่านไม่ได้: " + res.notes : "ไม่พบเนื้อเพลงในรูป"); return; }
    let text = res.text.replace(/\r\n?/g, "\n");
    if (ed.text.trim()) {
      const replace = await confirmDialog("มีข้อความอยู่แล้ว", "แทนที่ด้วยผลที่อ่านจากรูป? (ถ้าเลือกยกเลิก ผลจะต่อท้ายข้อความเดิม)", "แทนที่");
      text = replace ? text : ed.text.replace(/\s+$/, "") + "\n\n" + text;
    }
    ed.text = text;
    if (!ed.title && res.title) ed.title = String(res.title);
    if (!ed.artist && res.artist) ed.artist = String(res.artist);
    if (ed.bpm === "" && validBpm(res.bpm)) ed.bpm = res.bpm;
    ed.modelNotes = Array.isArray(res.unclear) ? res.unclear.slice(0, 50) : [];
    ed.source = "image"; ed.sourceCheck = "unchecked"; ed.musicCheck = "unchecked";
    markDirty();
    $("#ed-title").value = ed.title; $("#ed-artist").value = ed.artist; $("#ed-bpm").value = ed.bpm; $("#ed-text").value = ed.text;
    $("#ed-src").checked = false; $("#ed-music").checked = false;
    edRefresh();
    const st = songStats({ blocks: textToBlocks(ed.text).blocks });
    toast(st.unclear ? `อ่านเสร็จ มี ${st.unclear} จุดที่อ่านไม่ชัด (สีเหลือง) ตรวจก่อนบันทึก` : "อ่านเสร็จ ตรวจกับรูปอีกครั้งก่อนบันทึก", 5000);
  } catch (e) {
    const code = e && e.code;
    const msg = {
      cancelled: "หยุดอ่านแล้ว", not_granted: "ยังไม่ได้อนุญาตให้หน้านี้ใช้ Claude", sampling_disabled: "บัญชีนี้ใช้ Claude อ่านรูปไม่ได้",
      images_unavailable: "หน้านี้ส่งรูปไม่ได้ในตอนนี้", image_rejected: "รูปนี้ใช้ไม่ได้ (ชนิดไฟล์หรือขนาดไม่รองรับ) ลองรูปอื่น",
      rate_limited: "ใช้งานถี่เกินไปหรือโควตาหมด ลองใหม่ภายหลัง", not_configured: "เจ้าของวงยังไม่ได้ใส่คีย์ Anthropic ใน Supabase (Edge Functions → Secrets)", not_signed_in: "เข้าสู่ระบบใหม่อีกครั้ง", invalid_json: "ผลที่อ่านได้อยู่ในรูปแบบที่ใช้ไม่ได้ กดอ่านใหม่อีกครั้ง",
      refused: "Claude ไม่อ่านรูปนี้ ลองรูปอื่น", session_expired: "ต้องเข้าสู่ระบบ claude.ai ใหม่", empty_completion: "ไม่ได้ผลลัพธ์ ลองครอปรูปให้เหลือแค่ชีทคอร์ด"
    }[code] || "อ่านไม่สำเร็จ ลองใหม่อีกครั้ง";
    toast(msg, 5000);
  } finally {
    if (ed) { ed.reading = null; }
    const st = $("#ed-stop"), pr = $("#ed-progress"); if (st) st.hidden = true; if (pr) pr.hidden = true;
    drawThumbs();
  }
}

/* ---------- a song's earlier versions ---------- */
async function openSongHistory(songId) {
  const cur = Store.songs.get(songId); if (!cur) return;
  const list = await historyList(h => h.kind === "song" && h.refId === songId);
  if (!list) return;
  openDialog(`<h2>ประวัติการแก้ไข</h2>
    <p class="small muted" style="margin:0">ฉบับปัจจุบัน: แก้ล่าสุด ${esc(fmtAgo(cur.updatedAt))} · เก็บฉบับก่อนหน้าไว้ ${HISTORY_KEEP} ครั้งล่าสุด</p>
    <div class="history-list">${list.map(h => `<div class="h"><span><b>${esc(h.data.title || "")}</b> <span class="small muted">${h.action === "delete" ? "ก่อนถูกลบ" : "ก่อนแก้"} · ${esc(fmtAgo(h.at))}</span></span>
      <span class="row"><button class="btn ghost" type="button" data-view="${esc(h.id)}">ดู</button>${writable() ? `<button class="btn" type="button" data-restore="${esc(h.id)}">ใช้ฉบับนี้</button>` : ""}</span></div>`).join("") || `<p class="empty">ยังไม่มีฉบับก่อนหน้า</p>`}</div>
    <div id="hist-view"></div>
    <div class="actions"><button class="btn" data-a="c" type="button">ปิด</button></div>`, (el, d) => {
    el.addEventListener("click", async e => {
      const v = e.target.closest("[data-view]"), r = e.target.closest("[data-restore]");
      if (e.target.closest('[data-a="c"]')) return d.close();
      if (v) { const h = list.find(x => x.id === v.dataset.view); $("#hist-view", el).innerHTML = `<div class="preview"><div class="sheet">${sheetHTML(analyse(h.data.blocks || []), 0)}</div></div>`; }
      if (r) {
        const h = list.find(x => x.id === r.dataset.restore);
        d.close();
        if (ed && ed.dirty && !(await confirmDialog("ทิ้งสิ่งที่แก้อยู่?", "หน้าแก้ไขมีข้อความที่ยังไม่ได้บันทึก การใช้ฉบับเก่าจะแทนที่ข้อความนั้น", "ใช้ฉบับเก่า", true))) return;
        if (!(await confirmDialog("ใช้ฉบับนี้แทนฉบับปัจจุบัน?", "ฉบับปัจจุบันจะถูกเก็บในประวัติ ย้อนกลับมาได้อีก", "ใช้ฉบับนี้"))) return;
        if (await restoreHistory(h)) { toast("ย้อนกลับเป็นฉบับก่อนหน้าแล้ว"); closeEditor(); route(); }
      }
    });
  }, { label: "ประวัติการแก้ไข" });
}
