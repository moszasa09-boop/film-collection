/* ---------- home: gigs ---------- */
let homeQuery = "";
function renderHome() {
  document.title = "คอร์ดเลื่อนตามเพลง";
  app.innerHTML = header({ title: "คอร์ดเลื่อนตามเพลง", tabs: "events" }) + `
  <main class="wrap">
    ${modeBanner()}
    <div class="page-head"><h1>งานและเซ็ตลิสต์</h1><p>เปิดงานแล้วเล่นตามลำดับ หรือสร้างงานใหม่แล้วเลือกเพลงจากคลัง</p></div>
    <div class="row">
      ${writable() ? `<button class="btn primary" id="new-event" type="button">${ICON.plus} สร้างงานใหม่</button>` : ""}
      <a class="btn" href="#library">คลังเพลง</a>
    </div>
    <div class="search">${ICON.search}<input id="q" type="search" placeholder="ค้นหางาน ชื่อเพลง หรือศิลปิน" autocomplete="off" aria-label="ค้นหา" value="${esc(homeQuery)}"></div>
    <div id="home-list"></div>
  </main>`;
  const q = $("#q");
  q.addEventListener("input", () => { homeQuery = q.value; renderHomeList(); });
  const ne = $("#new-event"); if (ne) ne.onclick = () => openEventForm(null);
  renderHomeList();
}
function renderHomeList() {
  const box = $("#home-list"); if (!box) return;
  if (Store.mode === "loading" || (Store.mode === "shared" && !Store.loaded.events)) { box.innerHTML = `<p class="empty">กำลังโหลดงาน…</p>`; return; }
  const nq = norm(homeQuery);
  const evs = eventList().filter(ev => {
    if (!nq) return true;
    if (norm(ev.name + ev.venue + ev.note).includes(nq)) return true;
    return eventItems(ev.id).some(it => { const s = Store.songs.get(it.songId); return s && norm(s.title + s.artist).includes(nq); });
  });
  const songs = nq ? songList().filter(s => norm(s.title + s.artist).includes(nq)) : [];
  let html = "";
  if (!Store.events.size && !Store.songs.size) {
    html = `<div class="empty"><p>ยังไม่มีเพลงหรืองาน</p>${writable() ? `<button class="btn primary" id="seed" type="button">นำเข้าเพลงชุดเริ่มต้น ITD (${BUILTIN.songs.length} เพลง)</button><p class="small">หรือไปที่คลังเพลงเพื่อเพิ่มเพลงจากรูปหรือข้อความ</p>` : ""}</div>`;
  } else {
    const today = new Date().toISOString().slice(0, 10);
    const upcoming = evs.filter(e => !e.date || e.date >= today), past = evs.filter(e => e.date && e.date < today);
    const card = ev => {
      const sum = summarize(eventItems(ev.id));
      const over = ev.slotMinutes && sum.secs / 60 > ev.slotMinutes;
      return `<a class="event-card" href="#event-${ev.id}">
        <h3>${esc(ev.name || "ไม่มีชื่องาน")}</h3>
        <div class="meta">${ev.date ? `<span>${esc(fmtDate(ev.date))}</span>` : ""}${ev.venue ? `<span>${esc(ev.venue)}</span>` : ""}
          <span>${(ev.sets || []).length} เซ็ต · ${sum.count} เพลง · ราว ${fmtMinutes(sum.secs)}${ev.slotMinutes ? ` / เวลางาน ${ev.slotMinutes} นาที` : ""}</span></div>
        <div class="row">${sum.count ? `<span class="chip ${sum.ready === sum.count ? "ok" : "warn"}">พร้อมเล่น ${sum.ready}/${sum.count}</span><span class="chip">ตรวจกับเพลงจริง ${sum.checked}/${sum.count}</span>` : `<span class="chip">ยังไม่มีเพลง</span>`}${over ? `<span class="chip bad">เกินเวลางาน</span>` : ""}${sum.missing ? `<span class="chip bad">เพลงถูกลบ ${sum.missing}</span>` : ""}</div>
      </a>`;
    };
    html += upcoming.length ? `<div class="events">${upcoming.map(card).join("")}</div>` : (nq ? "" : `<p class="empty">ยังไม่มีงานที่กำลังจะถึง</p>`);
    if (past.length) html += `<div class="section-title">งานที่ผ่านมา</div><div class="events">${past.map(card).join("")}</div>`;
    if (nq && songs.length) html += `<div class="section-title">เพลงในคลัง</div><div class="list">${songs.map(songRow).join("")}</div>`;
    if (nq && !evs.length && !songs.length) html += `<p class="empty">ไม่พบ “${esc(homeQuery)}” ลองพิมพ์แค่บางคำ</p>`;
  }
  box.innerHTML = html;
  const seed = $("#seed");
  if (seed) seed.onclick = async () => { seed.disabled = true; seed.textContent = "กำลังนำเข้า…"; const ok = await seedBuiltin(); toast(ok ? "นำเข้าเพลงชุดเริ่มต้นแล้ว" : "นำเข้าได้ไม่ครบ ดูรายการที่ไม่สำเร็จที่ปุ่มสถานะ"); };
}

/* ---------- library ---------- */
let libQuery = "", libFilter = "all";
function songRow(s) {
  const used = usageOf(s.id);
  return `<a class="item-row" href="#song-${s.id}">
    <span class="n"></span>
    <span class="t"><b>${esc(s.title)}</b>${s.artist ? `<span class="a">${esc(s.artist)}</span>` : ""}
      <span class="chips">${songChips(s)}${used.size ? `<span class="chip">อยู่ใน ${used.size} งาน</span>` : ""}</span></span>
    <span class="acts">${ICON.next}</span>
  </a>`;
}
function renderLibrary() {
  document.title = "คลังเพลง · คอร์ดเลื่อนตามเพลง";
  app.innerHTML = header({ title: "คอร์ดเลื่อนตามเพลง", tabs: "library" }) + `
  <main class="wrap">
    ${modeBanner()}
    <div class="page-head"><h1>คลังเพลง</h1><p>เพลงเก็บไว้ที่เดียว ใช้ได้หลายงาน แก้ที่นี่แล้วทุกงานเห็นตรงกัน</p></div>
    ${writable() ? `<div class="row"><a class="btn primary" href="#new-image">${ICON.plus} เพิ่มจากรูป</a><a class="btn" href="#new-text">พิมพ์หรือวางข้อความ</a></div>` : ""}
    <div class="search">${ICON.search}<input id="q" type="search" placeholder="ค้นหาชื่อเพลง ศิลปิน หรือเนื้อร้อง" autocomplete="off" aria-label="ค้นหาเพลง" value="${esc(libQuery)}"></div>
    <div class="filters" role="group" aria-label="กรองเพลง">
      ${[["all", "ทั้งหมด"], ["unclear", "มีจุดอ่านไม่ชัด"], ["unchecked", "ยังไม่ตรวจกับเพลงจริง"], ["checked", "ตรวจแล้ว"], ["unused", "ยังไม่อยู่ในงาน"]]
        .map(([k, t]) => `<button type="button" data-f="${k}" aria-pressed="${libFilter === k}">${t}</button>`).join("")}
    </div>
    <div id="lib-list"></div>
  </main>`;
  const q = $("#q");
  q.addEventListener("input", () => { libQuery = q.value; renderLibList(); });
  $(".filters").addEventListener("click", e => {
    const b = e.target.closest("[data-f]"); if (!b) return;
    libFilter = b.dataset.f;
    $$(".filters button").forEach(x => x.setAttribute("aria-pressed", x === b));
    renderLibList();
  });
  renderLibList();
}
function lyricText(s) { return (s.blocks || []).filter(b => b.type === "lines").map(b => b.lines.map(l => l.map(x => x[1]).join("")).join(" ")).join(" "); }
function renderLibList() {
  const box = $("#lib-list"); if (!box) return;
  if (Store.mode === "shared" && !Store.loaded.songs) { box.innerHTML = `<p class="empty">กำลังโหลดเพลง…</p>`; return; }
  const nq = norm(libQuery);
  const list = songList().filter(s => {
    if (nq && !norm(s.title + s.artist).includes(nq) && !norm(lyricText(s)).includes(nq)) return false;
    const st = songStats(s);
    if (libFilter === "unclear") return st.unclear > 0;
    if (libFilter === "unchecked") return s.musicCheck !== "checked";
    if (libFilter === "checked") return s.musicCheck === "checked";
    if (libFilter === "unused") return !usageOf(s.id).size;
    return true;
  });
  box.innerHTML = `<p class="small muted">${list.length} เพลง</p>` + (list.length ? `<div class="list">${list.map(songRow).join("")}</div>` : `<p class="empty">${Store.songs.size ? "ไม่พบเพลงที่ตรงกับคำค้นหรือตัวกรอง" : "คลังยังว่าง เพิ่มเพลงจากรูปหรือข้อความได้เลย"}</p>`);
}

/* ---------- event form (create / edit) ---------- */
function openEventForm(eventId) {
  const ev = eventId ? Store.events.get(eventId) : {};
  openDialog(`<h2>${eventId ? "แก้ไขงาน" : "สร้างงานใหม่"}</h2>
    <form id="ev-form" class="checks" novalidate>
      <label class="f"><span>ชื่องาน *</span><input id="ev-name" required maxlength="120" value="${esc(ev.name || "")}" autofocus></label>
      <div class="grid2">
        <label class="f"><span>วันที่</span><input id="ev-date" type="date" value="${esc(ev.date || "")}"></label>
        <label class="f"><span>เวลาแสดง (นาที)</span><input id="ev-slot" type="number" inputmode="numeric" min="1" max="1440" step="1" value="${ev.slotMinutes || ""}" placeholder="เช่น 90"></label>
      </div>
      <label class="f"><span>สถานที่</span><input id="ev-venue" maxlength="160" value="${esc(ev.venue || "")}"></label>
      <label class="f"><span>หมายเหตุ</span><textarea id="ev-note" maxlength="2000" rows="3">${esc(ev.note || "")}</textarea></label>
      <p class="f"><span class="err" id="ev-err"></span></p>
      <div class="actions"><button class="btn ghost" type="button" data-a="cancel">ยกเลิก</button><button class="btn primary" type="submit">${eventId ? "บันทึก" : "สร้างงาน"}</button></div>
    </form>`, (el, d) => {
    el.addEventListener("input", () => { el.dataset.dirty = "1"; });
    $('[data-a="cancel"]', el).onclick = () => d.tryClose();
    $("#ev-form", el).addEventListener("submit", async e => {
      e.preventDefault();
      const name = $("#ev-name", el).value.trim();
      const slotRaw = $("#ev-slot", el).value.trim();
      const slot = slotRaw ? Number(slotRaw) : null;
      const err = !name ? "ใส่ชื่องาน" : slot != null && !(Number.isInteger(slot) && slot >= 1 && slot <= 1440) ? "เวลาแสดงต้องเป็นนาที 1–1440" : "";
      $("#ev-err", el).textContent = err;
      $("#ev-name", el).setAttribute("aria-invalid", !name);
      if (err) return;
      const fields = { name, date: $("#ev-date", el).value || "", venue: $("#ev-venue", el).value.trim(), note: $("#ev-note", el).value.trim(), slotMinutes: slot };
      d.close();
      if (eventId) { await updateEvent(eventId, fields); }
      else { const id = await createEvent(fields); if (id) location.hash = "#event-" + id; }
    });
  }, { label: eventId ? "แก้ไขงาน" : "สร้างงานใหม่" });
}
