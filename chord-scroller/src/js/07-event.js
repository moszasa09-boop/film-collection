/* ---------- one gig: sets and their songs ---------- */
let dragActive = false, renderAfterDrag = false;
function renderEvent(eventId) {
  if (dragActive) { renderAfterDrag = true; return; }
  const ev = Store.events.get(eventId);
  if (!ev) {
    app.innerHTML = header({ title: "งาน", back: "#" }) + `<main class="wrap"><p class="empty">${Store.loaded.events ? "ไม่พบงานนี้ อาจถูกลบไปแล้ว" : "กำลังโหลด…"}</p></main>`;
    return;
  }
  document.title = (ev.name || "งาน") + " · คอร์ดเลื่อนตามเพลง";
  const all = eventItems(eventId), sum = summarize(all, ev);
  const firstSong = all.find(i => !isBreak(i));
  const w = writable();
  const over = ev.slotMinutes && sum.secs / 60 > ev.slotMinutes;
  let n = 0;
  const sets = (ev.sets || []).map((set, si) => {
    const its = all.filter(i => i.setId === set.id), s = summarize(its, ev);
    return `<section class="set" data-set="${esc(set.id)}">
      <div class="set-head"><h2>${esc(set.name)}</h2>
        <span class="meta">${s.count} เพลง · ราว ${fmtTime(s.secs)}${s.breakSecs ? ` (รวมพัก ${fmtMinutes(s.breakSecs)})` : ""} · พร้อมเล่น ${s.ready}/${s.count} · ตรวจกับเพลงจริง ${s.checked}/${s.count}</span>
        <span class="spacer"></span>
        ${w ? `<button class="btn" type="button" data-add="${esc(set.id)}">${ICON.plus} เพิ่มเพลง</button>
        <button class="btn ghost" type="button" data-addbreak="${esc(set.id)}">${ICON.plus} พัก</button>
        <button class="icon-btn" type="button" data-setmenu="${esc(set.id)}" aria-label="ตัวเลือกเซ็ต ${esc(set.name)}">${ICON.more}</button>` : ""}
      </div>
      <div class="list" data-list="${esc(set.id)}">
        ${its.map(it => isBreak(it) ? breakRow(it, w) : itemRow(it, ++n, w)).join("") || `<p class="empty small">${w ? "ยังไม่มีเพลง กด “เพิ่มเพลง” หรือลากเพลงจากเซ็ตอื่นมาวาง" : "ยังไม่มีเพลง"}</p>`}
      </div>
    </section>`;
  }).join("");
  const orphan = all.filter(i => !(ev.sets || []).some(s => s.id === i.setId));
  const slotLeft = ev.slotMinutes ? ev.slotMinutes * 60 - sum.secs : null;
  app.innerHTML = header({ title: esc(ev.name || "งาน"), back: "#", right: firstSong ? `<a class="btn primary" href="#play-${ev.id}-${firstSong.id}">${ICON.play} เล่น</a>` : "" }) + `
  <main class="wrap">
    ${modeBanner()}
    <div class="page-head">
      <h1>${esc(ev.name || "ไม่มีชื่องาน")}</h1>
      <p>${[ev.date && fmtDate(ev.date), ev.venue].filter(Boolean).map(esc).join(" · ") || "ยังไม่ระบุวันและสถานที่"}</p>
      ${ev.note ? `<p style="white-space:pre-wrap">${esc(ev.note)}</p>` : ""}
    </div>
    <div class="totals"><span><b>${sum.count}</b> เพลง</span><span>เวลารวม <b>${fmtTime(sum.secs)}</b></span>
      ${ev.slotMinutes ? `<span class="${over ? "over" : ""}">เวลางาน <b>${ev.slotMinutes}</b> นาที · ${over ? `<b>เกิน ${fmtTime(-slotLeft)}</b>` : `เหลือ <b>${fmtTime(slotLeft)}</b>`}</span>` : ""}
      <span>พร้อมเล่น <b>${sum.ready}/${sum.count}</b></span><span>ตรวจกับเพลงจริง <b>${sum.checked}/${sum.count}</b></span></div>
    <p class="small muted" style="margin:0">เวลารวม = เพลง ${fmtTime(sum.songSecs)} + พัก ${fmtTime(sum.breakSecs)} + ระหว่างเพลง ${fmtTime(sum.gapSecs)}${ev.gapSeconds ? ` (${ev.gapSeconds} วินาที/ครั้ง)` : ""} · ความยาวเพลงประมาณจาก BPM เว้นแต่ใส่ความยาวจริงไว้</p>
    ${(() => { const o = offlineStatus(ev.id); return o ? `<div class="offline-state small" style="margin-top:10px"><span class="chip ${o.ready ? "ok" : ""}" id="offline-state">${esc(o.text)}</span><button class="btn ghost" type="button" data-offline="${esc(ev.id)}">${o.ready ? "เตรียมใหม่" : "เตรียมเล่นออฟไลน์"}</button></div>` : ""; })()}
    ${readinessPanel(ev, all)}
    ${w ? `<div class="row" style="margin-top:10px">
      <button class="btn" type="button" id="ev-edit">แก้ไขข้อมูลงาน</button>
      <button class="btn" type="button" id="ev-addset">${ICON.plus} เพิ่มเซ็ต</button>
      <button class="btn" type="button" id="ev-dup">ทำสำเนางาน</button>
      <button class="btn danger" type="button" id="ev-del">ลบงาน</button></div>` : ""}
    ${sets}
    ${orphan.length ? `<section class="set"><div class="set-head"><h2>ไม่อยู่ในเซ็ตไหน</h2><span class="meta">เซ็ตเดิมถูกลบ ย้ายเพลงเหล่านี้ไปเซ็ตอื่น</span></div><div class="list">${orphan.map(it => itemRow(it, ++n, w)).join("")}</div></section>` : ""}
    <div style="height:60px"></div>
  </main>`;
  if (!w) return;
  app.querySelectorAll("[data-addbreak]").forEach(b => b.onclick = () => openBreakSheet(eventId, b.dataset.addbreak, null));
  app.querySelectorAll("[data-breakmenu]").forEach(b => b.onclick = () => openBreakSheet(eventId, null, b.dataset.breakmenu));
  $("#ev-edit").onclick = () => openEventForm(eventId);
  $("#ev-addset").onclick = () => promptText("เพิ่มเซ็ต", "ชื่อเซ็ต เช่น เซ็ตเปิดงาน, เพลงสำรอง", "", name => changeSets(eventId, sets => [...sets, { id: newId(), name }]));
  $("#ev-dup").onclick = async () => { const id = await duplicateEvent(eventId); if (id) { toast("ทำสำเนาแล้ว"); location.hash = "#event-" + id; } };
  $("#ev-del").onclick = async () => {
    if (await confirmDialog(`ลบงาน “${ev.name}”?`, `เพลง ${sum.count} รายการในงานนี้จะถูกเอาออกจากงาน (เพลงในคลังยังอยู่) กู้คืนได้จากถังขยะในหน้า “แชร์และสำรอง”`, "ลบงาน", true)) {
      location.hash = "#"; await deleteEvent(eventId); toast("ลบงานแล้ว");
    }
  };
  app.querySelectorAll("[data-add]").forEach(b => b.onclick = () => openPicker(eventId, b.dataset.add));
  app.querySelectorAll("[data-setmenu]").forEach(b => b.onclick = () => openSetMenu(eventId, b.dataset.setmenu));
  app.querySelectorAll("[data-itemmenu]").forEach(b => b.onclick = () => openItemSheet(b.dataset.itemmenu));
  app.querySelectorAll(".handle").forEach(h => h.addEventListener("pointerdown", e => startDrag(e, h.dataset.drag, eventId)));
}
function breakRow(it, w) {
  return `<div class="item-row break-row" data-item="${esc(it.id)}">
    ${w ? `<button class="handle" type="button" data-drag="${esc(it.id)}" aria-label="ลากเพื่อเรียงลำดับ">${ICON.grip}</button>` : `<span class="n">–</span>`}
    <span class="t"><b>${esc(it.label || "พัก")} · ${clamp(Number(it.minutes) || 0, 0, 240)} นาที</b><span class="a">ช่วงพัก ไม่มีเพลง</span></span>
    <span class="acts">${w ? `<button class="icon-btn" type="button" data-breakmenu="${esc(it.id)}" aria-label="ตั้งค่าช่วงพัก">${ICON.more}</button>` : ""}</span>
  </div>`;
}
/* ---------- ready for the stage? ---------- */
function readinessIssues(ev, all) {
  const out = [];
  const songs = all.filter(i => !isBreak(i));
  if (!songs.length) out.push({ level: "bad", text: "ยังไม่มีเพลงในงาน" });
  const sum = summarize(all, ev);
  if (ev.slotMinutes && sum.secs > ev.slotMinutes * 60) out.push({ level: "bad", text: `เวลารวม ${fmtTime(sum.secs)} เกินเวลางาน ${ev.slotMinutes} นาที` });
  songs.forEach((it, i) => {
    const s = Store.songs.get(it.songId), n = `${i + 1}. ${s ? s.title : "เพลงถูกลบ"}`;
    if (!s) { out.push({ level: "bad", text: n + ": เพลงถูกลบจากคลัง", item: it.id }); return; }
    const st = songStats(s);
    if (!st.lyricLines) out.push({ level: "bad", text: n + ": ไม่มีเนื้อร้อง", song: s.id });
    if (!st.chords) out.push({ level: "bad", text: n + ": ไม่มีคอร์ด", song: s.id });
    if (st.unclear) out.push({ level: "warn", text: `${n}: อ่านไม่ชัด ${st.unclear} จุด`, song: s.id });
    if (s.musicCheck !== "checked") out.push({ level: "info", text: n + ": ยังไม่ตรวจกับเพลงจริง", song: s.id });
    if (!it.singer) out.push({ level: "info", text: n + ": ยังไม่กำหนดนักร้อง", item: it.id });
    if (!validBpm(it.bpm) && !validBpm(s.bpm)) out.push({ level: "info", text: n + ": ยังไม่ตั้ง BPM (ใช้ 80)", item: it.id });
  });
  const off = typeof offlineStatus === "function" ? offlineStatus(ev.id) : null;
  if (off && !off.ready) out.push({ level: "info", text: off.text, offline: true });
  return out;
}
function readinessPanel(ev, all) {
  const list = readinessIssues(ev, all);
  const bad = list.filter(x => x.level === "bad").length, warn = list.filter(x => x.level === "warn").length, info = list.filter(x => x.level === "info").length;
  const head = !list.length ? `<span class="chip ok">พร้อมขึ้นเวที</span>` :
    `${bad ? `<span class="chip bad">ต้องแก้ ${bad}</span>` : ""}${warn ? `<span class="chip warn">ควรตรวจ ${warn}</span>` : ""}${info ? `<span class="chip">ยังไม่ครบ ${info}</span>` : ""}`;
  const w = writable();
  return `<details class="ready" ${bad || warn ? "open" : ""}><summary><b>ตรวจความพร้อมก่อนขึ้นเวที</b> ${head}</summary>
    ${list.length ? `<ul class="issues">${list.map(x => `<li class="${x.level === "bad" ? "err" : x.level === "warn" ? "warn" : ""}">${esc(x.text)}
      ${w && x.song ? ` <a href="#edit-${esc(x.song)}">แก้เพลง</a>` : ""}${w && x.item ? ` <button class="btn ghost" type="button" data-itemmenu="${esc(x.item)}">ตั้งค่า</button>` : ""}${x.offline ? ` <button class="btn ghost" type="button" data-offline="${esc(ev.id)}">เตรียมออฟไลน์</button>` : ""}</li>`).join("")}</ul>`
    : `<p class="small muted">ทุกเพลงมีเนื้อร้องและคอร์ด ไม่มีจุดอ่านไม่ชัด ตรวจกับเพลงจริงแล้ว กำหนดนักร้องครบ และไม่เกินเวลา</p>`}
  </details>`;
}
function openBreakSheet(eventId, setId, itemId) {
  const it = itemId ? Store.items.get(itemId) : null;
  const ev = Store.events.get(eventId);
  openDialog(`<h2>${it ? "แก้ช่วงพัก" : "เพิ่มช่วงพัก"}</h2><form id="br" class="checks" novalidate>
    <div class="grid2"><label class="f"><span>ชื่อ</span><input id="br-label" maxlength="40" value="${esc(it ? it.label || "พัก" : "พัก")}"></label>
    <label class="f"><span>กี่นาที</span><input id="br-min" type="number" inputmode="numeric" min="1" max="240" step="1" value="${it ? it.minutes : 15}" autofocus></label></div>
    ${it ? `<label class="f"><span>อยู่ในเซ็ต</span><select id="br-set">${(ev.sets || []).map(x => `<option value="${esc(x.id)}" ${x.id === it.setId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>` : ""}
    <p class="f"><span class="err" id="br-err"></span></p>
    <div class="actions">${it ? `<button class="btn danger" type="button" data-a="rm">ลบช่วงพัก</button>` : ""}<button class="btn ghost" type="button" data-a="c">ยกเลิก</button><button class="btn primary" type="submit">บันทึก</button></div></form>`, (el, d) => {
    $('[data-a="c"]', el).onclick = () => d.close();
    const rm = $('[data-a="rm"]', el); if (rm) rm.onclick = async () => { d.close(); await removeItemUndoable(itemId); };
    $("#br", el).addEventListener("submit", async e => {
      e.preventDefault();
      const minutes = Number($("#br-min", el).value), label = $("#br-label", el).value.trim() || "พัก";
      if (!(Number.isInteger(minutes) && minutes >= 1 && minutes <= 240)) { $("#br-err", el).textContent = "ใส่นาที 1–240"; return; }
      d.close();
      if (!it) return addBreak(eventId, setId, minutes, label);
      const target = $("#br-set", el).value;
      if (target !== it.setId) await moveItemUndoable(itemId, eventId, target, null);
      if (minutes !== it.minutes || label !== it.label) await patchItemUndoable(itemId, { minutes, label }, "แก้ช่วงพักแล้ว");
    });
  }, { label: "ช่วงพัก" });
}
function itemRow(it, n, w) {
  const s = Store.songs.get(it.songId);
  return `<div class="item-row" data-item="${esc(it.id)}">
    ${w ? `<button class="handle" type="button" data-drag="${esc(it.id)}" aria-label="ลากเพื่อเรียงลำดับ">${ICON.grip}</button>` : `<span class="n">${n}</span>`}
    <a class="t open" href="#play-${it.eventId}-${it.id}" style="text-decoration:none">
      <b>${w ? `<span class="muted small" style="font-family:var(--f-chord)">${n}.</span> ` : ""}${esc(s ? s.title : "เพลงถูกลบ")}</b>
      ${s && s.artist ? `<span class="a">${esc(s.artist)}${it.singer ? " · ร้องโดย " + esc(it.singer) : ""}</span>` : it.singer ? `<span class="a">ร้องโดย ${esc(it.singer)}</span>` : ""}
      <span class="chips">${songChips(s, { bpm: itemBpm(it, s), shift: it.shift || 0, capo: it.capo || 0 })}</span>
      ${it.note ? `<span class="note">${esc(it.note)}</span>` : ""}
    </a>
    <span class="acts">${w ? `<button class="icon-btn" type="button" data-itemmenu="${esc(it.id)}" aria-label="ตั้งค่าเพลงนี้ในงาน">${ICON.more}</button>` : ""}</span>
  </div>`;
}

function promptText(title, hint, value, onOk) {
  openDialog(`<h2>${esc(title)}</h2><form id="pt" novalidate><label class="f"><span>${esc(hint)}</span><input id="pt-v" maxlength="80" value="${esc(value)}" autofocus></label>
    <p class="f"><span class="err" id="pt-err"></span></p>
    <div class="actions"><button class="btn ghost" type="button" data-a="c">ยกเลิก</button><button class="btn primary" type="submit">บันทึก</button></div></form>`, (el, d) => {
    $('[data-a="c"]', el).onclick = () => d.close();
    $("#pt", el).addEventListener("submit", e => {
      e.preventDefault();
      const v = $("#pt-v", el).value.trim();
      if (!v) { $("#pt-err", el).textContent = "ใส่ชื่อ"; return; }
      d.close(); onOk(v);
    });
  }, { label: title });
}

function openSetMenu(eventId, setId) {
  const ev = Store.events.get(eventId); const sets = ev.sets || [];
  const i = sets.findIndex(s => s.id === setId); const set = sets[i];
  const count = setItems(eventId, setId).length;
  openDialog(`<h2>เซ็ต “${esc(set.name)}”</h2>
    <div class="row">
      <button class="btn" data-a="rename" type="button">เปลี่ยนชื่อ</button>
      <button class="btn" data-a="up" type="button" ${i === 0 ? "disabled" : ""}>เลื่อนเซ็ตขึ้น</button>
      <button class="btn" data-a="down" type="button" ${i === sets.length - 1 ? "disabled" : ""}>เลื่อนเซ็ตลง</button>
      <button class="btn danger" data-a="del" type="button">ลบเซ็ต</button>
    </div>
    <div class="actions"><button class="btn" data-a="close" type="button">ปิด</button></div>`, (el, d) => {
    el.addEventListener("click", async e => {
      const a = (e.target.closest("[data-a]") || {}).dataset?.a; if (!a) return;
      if (a === "close") return d.close();
      d.close();
      if (a === "rename") promptText("เปลี่ยนชื่อเซ็ต", "ชื่อเซ็ต", set.name, name => changeSets(eventId, ss => ss.map(s => s.id === setId ? { ...s, name } : s)));
      if (a === "up" || a === "down") changeSets(eventId, ss => { const j = ss.findIndex(s => s.id === setId), k = a === "up" ? j - 1 : j + 1; if (j < 0 || k < 0 || k >= ss.length) return null; [ss[j], ss[k]] = [ss[k], ss[j]]; return ss; });
      if (a === "del") {
        if (count) {
          const others = sets.filter(s => s.id !== setId);
          if (!others.length) { toast("เซ็ตนี้ยังมีเพลง และเป็นเซ็ตเดียวของงาน ย้ายหรือเอาเพลงออกก่อน"); return; }
          const move = await confirmDialog(`เซ็ตนี้มี ${count} เพลง`, `ย้ายเพลงทั้งหมดไปเซ็ต “${others[0].name}” แล้วลบเซ็ตนี้?`, "ย้ายแล้วลบเซ็ต", true);
          if (!move) return;
          for (const it of setItems(eventId, setId)) await moveItem(it.id, eventId, others[0].id, null);
        } else if (!(await confirmDialog(`ลบเซ็ต “${set.name}”?`, "", "ลบเซ็ต", true))) return;
        changeSets(eventId, ss => ss.filter(s => s.id !== setId));
      }
    });
  }, { label: "ตัวเลือกเซ็ต" });
}

/* ---------- add songs from the library ---------- */
function openPicker(eventId, setId) {
  const ev = Store.events.get(eventId);
  const inEvent = new Set(eventItems(eventId).filter(i => !isBreak(i)).map(i => i.songId));
  let q = "";
  const chosen = new Set();
  openDialog(`<h2>เพิ่มเพลงจากคลัง</h2>
    <label class="f"><span>เพิ่มเข้าเซ็ต</span><select id="pk-set">${(ev.sets || []).map(s => `<option value="${esc(s.id)}" ${s.id === setId ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
    <div class="search" style="margin:0">${ICON.search}<input id="pk-q" type="search" placeholder="ค้นหาเพลง" autocomplete="off" aria-label="ค้นหาเพลง" autofocus></div>
    <div class="pick-list" id="pk-list"></div>
    <p class="small muted" style="margin:0">เพลงที่มีอยู่ในงานแล้วเพิ่มซ้ำได้ (เช่นเล่นซ้ำตอนท้าย) แต่จะมีป้ายเตือน · ไม่เจอเพลงที่ต้องการ? <a href="#new-image">เพิ่มเพลงใหม่ในคลัง</a></p>
    <div class="actions"><button class="btn ghost" data-a="c" type="button">ยกเลิก</button><button class="btn primary" data-a="ok" type="button" disabled>เพิ่ม 0 เพลง</button></div>`, (el, d) => {
    const draw = () => {
      const nq = norm(q);
      const list = songList().filter(s => !nq || norm(s.title + s.artist).includes(nq));
      $("#pk-list", el).innerHTML = list.map(s => `<label><input type="checkbox" value="${esc(s.id)}" ${chosen.has(s.id) ? "checked" : ""}>
        <span><b>${esc(s.title)}</b><span class="a">${esc(s.artist || "")}</span></span>
        <span>${inEvent.has(s.id) ? `<span class="chip warn">อยู่ในงานนี้แล้ว</span>` : ""}</span></label>`).join("") || `<p class="empty">ไม่พบเพลง</p>`;
    };
    const upd = () => { const b = $('[data-a="ok"]', el); b.disabled = !chosen.size; b.textContent = `เพิ่ม ${chosen.size} เพลง`; el.dataset.dirty = chosen.size ? "1" : ""; };
    $("#pk-q", el).addEventListener("input", e => { q = e.target.value; draw(); });
    $("#pk-list", el).addEventListener("change", e => { if (e.target.checked) chosen.add(e.target.value); else chosen.delete(e.target.value); upd(); });
    $('[data-a="c"]', el).onclick = () => d.tryClose();
    $('[data-a="ok"]', el).onclick = async () => {
      const target = $("#pk-set", el).value; const ids = [...chosen];
      d.close();
      const ok = await addItems(eventId, target, ids);
      toast(ok ? `เพิ่ม ${ids.length} เพลงแล้ว` : "เพิ่มได้ไม่ครบ ดูที่ปุ่มสถานะ");
    };
    draw();
  }, { label: "เพิ่มเพลงจากคลัง" });
}

/* ---------- this song in this gig: key, capo, BPM, singer, note, set ---------- */
function openItemSheet(itemId) {
  const it = Store.items.get(itemId); if (!it) return;
  const s = Store.songs.get(it.songId), ev = Store.events.get(it.eventId);
  let shift = it.shift || 0;
  const list = setItems(it.eventId, it.setId); const pos = list.findIndex(x => x.id === itemId);
  openDialog(`<h2>${esc(s ? s.title : "เพลงถูกลบ")}</h2>
    <p class="small muted" style="margin:0">ค่าเหล่านี้ใช้เฉพาะงาน “${esc(ev.name)}” งานอื่นที่มีเพลงนี้ไม่เปลี่ยน</p>
    <form id="it-form" class="checks" novalidate>
      <div class="grid2">
        <div class="f"><span>คีย์ในงานนี้</span><div class="stepper" style="justify-content:start">
          <button type="button" id="it-down" aria-label="ลดคีย์ครึ่งเสียง">−</button><span class="val key" id="it-key"></span><button type="button" id="it-up" aria-label="เพิ่มคีย์ครึ่งเสียง">+</button></div></div>
        <label class="f"><span>คาโป้ (เฟร็ต)</span><input id="it-capo" type="number" inputmode="numeric" min="0" max="11" step="1" value="${it.capo || 0}"></label>
        <label class="f"><span>BPM ในงานนี้</span><input id="it-bpm" type="number" inputmode="numeric" min="40" max="220" step="1" value="${validBpm(it.bpm) ? it.bpm : ""}" placeholder="ใช้ค่าของเพลง (${s && validBpm(s.bpm) ? s.bpm : 80})"></label>
        <label class="f"><span>นักร้อง</span><input id="it-singer" maxlength="60" value="${esc(it.singer || "")}"></label>
        <label class="f"><span>ความยาวจริง (นาที:วินาที)</span><input id="it-dur" inputmode="numeric" maxlength="6" value="${validDur(it.durationSec) ? fmtTime(it.durationSec) : ""}" placeholder="ประมาณ ${s ? fmtTime(songSeconds(s.blocks, itemBpm(it, s))) : "-"}"></label>
      </div>
      <label class="f"><span>หมายเหตุสำหรับงานนี้</span><textarea id="it-note" rows="2" maxlength="500">${esc(it.note || "")}</textarea></label>
      <label class="f"><span>อยู่ในเซ็ต</span><select id="it-set">${(ev.sets || []).map(x => `<option value="${esc(x.id)}" ${x.id === it.setId ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>
      <p class="f"><span class="err" id="it-err"></span></p>
      <div class="row">
        <button class="btn" type="button" id="it-mup" ${pos <= 0 ? "disabled" : ""}>เลื่อนขึ้น</button>
        <button class="btn" type="button" id="it-mdown" ${pos >= list.length - 1 ? "disabled" : ""}>เลื่อนลง</button>
        ${s ? `<a class="btn" href="#edit-${s.id}">แก้เนื้อเพลง/คอร์ด (มีผลทุกงาน)</a>` : ""}
        <button class="btn" type="button" id="it-reset">คืนค่าเริ่มต้น</button>
        <button class="btn danger" type="button" id="it-rm">เอาออกจากเซ็ต</button>
      </div>
      <div class="actions"><button class="btn ghost" type="button" data-a="c">ยกเลิก</button><button class="btn primary" type="submit">บันทึก</button></div>
    </form>`, (el, d) => {
    const showKey = () => { $("#it-key", el).textContent = (s ? keyOf(s.blocks, shift) : "?") + (shift ? ` (${shift > 0 ? "+" : ""}${shift})` : ""); };
    showKey();
    $("#it-down", el).onclick = () => { shift = ((shift - 1 + 6 + 120) % 12) - 6; showKey(); el.dataset.dirty = "1"; };
    $("#it-up", el).onclick = () => { shift = ((shift + 1 + 6 + 120) % 12) - 6; showKey(); el.dataset.dirty = "1"; };
    el.addEventListener("input", () => { el.dataset.dirty = "1"; });
    $('[data-a="c"]', el).onclick = () => d.tryClose();
    $("#it-mup", el).onclick = async () => { d.close(); await moveItemUndoable(itemId, it.eventId, it.setId, list[pos - 1].id, "เลื่อนขึ้นแล้ว"); };
    $("#it-mdown", el).onclick = async () => { d.close(); await moveItemUndoable(itemId, it.eventId, it.setId, list[pos + 2] ? list[pos + 2].id : null, "เลื่อนลงแล้ว"); };
    $("#it-rm", el).onclick = async () => { d.close(); await removeItemUndoable(itemId); };
    $("#it-reset", el).onclick = async () => { d.close(); await patchItemUndoable(itemId, { shift: 0, capo: 0, bpm: null, durationSec: null }, "คืนคีย์ คาโป้ BPM และความยาวเป็นค่าของเพลงแล้ว"); };
    $("#it-form", el).addEventListener("submit", async e => {
      e.preventDefault();
      const capo = Number($("#it-capo", el).value || 0);
      const bpmRaw = $("#it-bpm", el).value.trim(), bpm = bpmRaw === "" ? null : Number(bpmRaw);
      const durRaw = $("#it-dur", el).value.trim(), dm = /^(\d{1,2}):([0-5]\d)$/.exec(durRaw);
      const durationSec = durRaw === "" ? null : dm ? (+dm[1]) * 60 + (+dm[2]) : NaN;
      const err = !(Number.isInteger(capo) && capo >= 0 && capo <= 11) ? "คาโป้ต้องเป็น 0–11"
        : bpm != null && !validBpm(bpm) ? "BPM ต้องเป็นจำนวนเต็ม 40–220 หรือเว้นว่าง"
        : durationSec !== null && !validDur(durationSec) ? "ความยาวต้องเป็น นาที:วินาที เช่น 4:05 (0:10–60:00) หรือเว้นว่าง" : "";
      $("#it-err", el).textContent = err;
      if (err) return;
      const patch = {};
      const setId = $("#it-set", el).value;
      const vals = { shift, capo, bpm, durationSec, singer: $("#it-singer", el).value.trim(), note: $("#it-note", el).value.trim() };
      const old = { shift: it.shift || 0, capo: it.capo || 0, bpm: validBpm(it.bpm) ? it.bpm : null, durationSec: validDur(it.durationSec) ? it.durationSec : null, singer: it.singer || "", note: it.note || "" };
      for (const k in vals) if (old[k] !== vals[k]) patch[k] = vals[k];
      d.close();
      if (setId !== it.setId) await moveItemUndoable(itemId, it.eventId, setId, null, "ย้ายเซ็ตแล้ว");
      if (Object.keys(patch).length) await patchItemUndoable(itemId, patch, "บันทึกค่าของเพลงในงานแล้ว");
    });
  }, { label: "ตั้งค่าเพลงในงาน" });
}

/* ---------- drag to reorder (mouse, touch, pen) ---------- */
function startDrag(e, itemId, eventId) {
  if (e.button > 0) return;
  e.preventDefault();
  const row = e.target.closest(".item-row");
  const it = Store.items.get(itemId); const s = it && Store.songs.get(it.songId);
  dragActive = true;
  row.classList.add("dragging");
  const ghost = document.createElement("div");
  ghost.className = "drag-ghost"; ghost.textContent = s ? s.title : "เพลง";
  document.body.appendChild(ghost);
  const line = document.createElement("div"); line.className = "drop-line";
  let target = null, scrollTimer = 0, lastY = e.clientY;
  const place = (x, y) => {
    ghost.style.transform = `translate(${x + 12}px, ${y - 20}px)`;
    const under = document.elementFromPoint(x, y);
    $$(".set.drop-target").forEach(el => el.classList.remove("drop-target"));
    const set = under && under.closest(".set[data-set]");
    if (!set) { line.remove(); target = null; return; }
    set.classList.add("drop-target");
    const listEl = $("[data-list]", set);
    const rows = $$(".item-row[data-item]", listEl).filter(r => r.dataset.item !== itemId);
    let before = null;
    for (const r of rows) { const b = r.getBoundingClientRect(); if (y < b.top + b.height / 2) { before = r; break; } }
    if (before) listEl.insertBefore(line, before); else listEl.appendChild(line);
    target = { setId: set.dataset.set, beforeId: before ? before.dataset.item : null };
  };
  const autoscroll = () => {
    const edge = 70, h = window.innerHeight;
    if (lastY < edge) window.scrollBy(0, -12); else if (lastY > h - edge) window.scrollBy(0, 12);
  };
  scrollTimer = setInterval(autoscroll, 30);
  place(e.clientX, e.clientY);
  const move = ev => { lastY = ev.clientY; place(ev.clientX, ev.clientY); };
  const end = async ev => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    clearInterval(scrollTimer);
    ghost.remove(); line.remove(); row.classList.remove("dragging");
    $$(".set.drop-target").forEach(el => el.classList.remove("drop-target"));
    dragActive = false;
    const t = ev.type === "pointerup" ? target : null;
    if (t) {
      const list = setItems(eventId, t.setId).map(i => i.id);
      const curIdx = list.indexOf(itemId), nextId = curIdx >= 0 ? list[curIdx + 1] || null : undefined;
      const unchanged = it.setId === t.setId && (t.beforeId === nextId);
      if (!unchanged) await moveItemUndoable(itemId, eventId, t.setId, t.beforeId, "ย้ายเพลงแล้ว");
    }
    if (renderAfterDrag || t) { renderAfterDrag = false; route(); }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === "z" && currentRoute && currentRoute.name === "event" && !dialogStack.length && !inside(e.target, "input, textarea, select")) {
    e.preventDefault(); undoLast();
  }
});
document.addEventListener("click", e => { const b = inside(e.target, "[data-offline]") && e.target.closest("[data-offline]"); if (b) prepareOffline(b.dataset.offline); });
