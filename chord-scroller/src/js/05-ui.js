/* ---------- shell: header, status pill, toasts, dialogs ---------- */
const app = document.getElementById("app");
let toastTimer = 0;
function toast(msg, ms = 3200, action) {
  let el = $(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.textContent = msg;
  if (action) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "toast-act"; b.textContent = action.text;
    b.onclick = () => { el.remove(); action.run(); };
    el.appendChild(b);
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.remove(), ms);
}

function syncPill() {
  const s = syncState();
  return `<button class="sync" id="sync" data-state="${s.state}" type="button" ${s.state === "error" ? "" : 'tabindex="-1"'} aria-live="polite">${esc(s.text)}</button>`;
}
function refreshSyncPill() {
  const el = $("#sync"); if (!el) return;
  const s = syncState();
  el.dataset.state = s.state; el.textContent = s.text;
  el.tabIndex = s.state === "error" ? 0 : -1;
}
document.addEventListener("click", e => {
  if (inside(e.target, "#sync") && Sync.failed.length) openFailedDialog();
  if (inside(e.target, "[data-signin]")) cloudSignIn();
  const hide = inside(e.target, "[data-hide-device-note]") && e.target.closest(".banner");
  if (hide) { prefs.set("hideDeviceNote", true); hide.remove(); }
});
window.addEventListener("online", () => notify("sync"));
window.addEventListener("offline", () => notify("sync"));

function header({ title, back, tabs, right = "", sync = true }) {
  return `<header class="bar"><div class="wrap">
    ${back ? `<a class="icon-btn" href="${back}" aria-label="กลับ">${ICON.back}</a>` : ""}
    <div class="brand">${title}</div>
    ${sync ? `<span class="hide-stage">${syncPill()}</span>` : ""}
    ${right}
  </div>${tabs ? `<nav class="tabs wrap" aria-label="ส่วนของแอป">
    <a href="#" ${tabs === "events" ? 'aria-current="page"' : ""}>งาน</a>
    <a href="#library" ${tabs === "library" ? 'aria-current="page"' : ""}>คลังเพลง</a>
    <a href="#data" ${tabs === "data" ? 'aria-current="page"' : ""}>แชร์และสำรอง</a>
  </nav>` : ""}</header>`;
}
function modeBanner() {
  if (Store.mode === "device" && cloudConfigured()) return Cloud.user
    ? `<div class="banner info"><span class="grow"><b>ยังไม่มีวง:</b> สร้างวงใหม่ หรือเปิดลิงก์เชิญจากเจ้าของวง ระหว่างนี้ข้อมูลเก็บในเครื่องนี้</span><a class="btn" href="#data">ไปที่วง</a></div>`
    : `<div class="banner info"><span class="grow"><b>ข้อมูลเก็บในเครื่องนี้เท่านั้น:</b> เข้าสู่ระบบเพื่อใช้งานร่วมกับวงและซิงก์ทุกเครื่อง</span><button class="btn primary" type="button" data-signin>เข้าสู่ระบบ</button></div>`;
  if (Store.mode === "device") return prefs.get("hideDeviceNote", false) ? "" : `<div class="banner info"><span class="grow"><b>ข้อมูลเก็บในเครื่องนี้เท่านั้น:</b> แก้ไขและบันทึกได้ แต่คนอื่นและเครื่องอื่นจะไม่เห็น ส่งต่อด้วยไฟล์สำรองที่หน้า <a href="#data">แชร์และสำรอง</a> · ถ้าลบข้อมูลเบราว์เซอร์ ข้อมูลจะหาย</span><button class="btn ghost" type="button" data-hide-device-note>รับทราบ</button></div>`;
  if (Store.mode === "cloud" && Store.canWrite === false) return `<div class="banner info"><span class="grow"><b>ผู้ดู:</b> เปิดงานและเล่นได้ แต่แก้ไขไม่ได้ ขอสิทธิ์ผู้แก้ไขจากเจ้าของวง “${esc(Cloud.band.name)}”</span></div>`;
  if (Store.revoked) return `<div class="banner bad"><span class="grow">สิทธิ์การเข้าถึงของหน้านี้เปลี่ยนไป ข้อมูลอาจไม่อัปเดต เปิดหน้าใหม่อีกครั้ง</span></div>`;
  if (Store.canWrite === false) return `<div class="banner info"><span class="grow"><b>ดูอย่างเดียว:</b> บัญชีนี้เปิดดูและเล่นได้ แต่แก้ไขไม่ได้ ขอสิทธิ์ Contributor หรือ Editor จากเจ้าของลิงก์</span></div>`;
  if (Store.slow && !Store.fresh) return `<div class="banner"><span class="grow">ยังเชื่อมต่อฐานข้อมูลไม่ได้ ที่เห็นอยู่อาจไม่ใช่ข้อมูลล่าสุด ระบบจะลองต่อเอง</span></div>`;
  return "";
}

/* readiness chips for a song */
function songChips(song, { bpm, shift = 0, capo = 0 } = {}) {
  if (!song) return `<span class="chip bad">ไม่พบเพลง (ถูกลบ)</span>`;
  const st = songStats(song);
  const out = [];
  const key = keyOf(song.blocks, shift);
  if (key) out.push(`<span class="chip key" title="คีย์">${esc(key)}</span>`);
  if (capo) out.push(`<span class="chip">คาโป้ ${capo}</span>`);
  out.push(`<span class="chip">${bpm || song.bpm || 80} BPM</span>`);
  if (st.unclear) out.push(`<span class="chip warn">อ่านไม่ชัด ${st.unclear} จุด</span>`);
  else if (!st.chords) out.push(`<span class="chip bad">ไม่มีคอร์ด</span>`);
  else if (!st.lyricLines) out.push(`<span class="chip warn">ไม่มีเนื้อร้อง</span>`);
  if (song.musicCheck === "checked") out.push(`<span class="chip ok">ตรวจกับเพลงจริงแล้ว</span>`);
  else if (song.sourceCheck === "matched") out.push(`<span class="chip">ตรงต้นฉบับ · ยังไม่ตรวจกับเพลงจริง</span>`);
  else out.push(`<span class="chip warn">ยังไม่ได้ตรวจ</span>`);
  return out.join("");
}

/* ---------- dialogs ----------
   openDialog(html, onMount) shows a sheet; returns {close, el}. Escape and the scrim close it unless
   the dialog says it holds unsaved input (data-dirty), in which case it asks first. */
let dialogStack = [];
function openDialog(html, onMount, { label = "" } = {}) {
  const scrim = document.createElement("div");
  scrim.className = "scrim";
  scrim.innerHTML = `<div class="sheet-dlg" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
  document.body.appendChild(scrim);
  const el = $(".sheet-dlg", scrim);
  const prevFocus = document.activeElement;
  const api = {
    el,
    close() {
      scrim.remove();
      dialogStack = dialogStack.filter(d => d !== api);
      if (prevFocus && prevFocus.focus) try { prevFocus.focus(); } catch (e) { /* element gone */ }
    },
    async tryClose() {
      if (el.dataset.dirty === "1" && !(await confirmDialog("ปิดโดยไม่บันทึก?", "สิ่งที่พิมพ์ในหน้าต่างนี้จะหายไป", "ปิดโดยไม่บันทึก", true))) return;
      api.close();
    }
  };
  scrim.addEventListener("mousedown", e => { if (e.target === scrim) api.tryClose(); });
  dialogStack.push(api);
  if (onMount) onMount(el, api);
  const first = el.querySelector("[autofocus], input, select, textarea, button");
  if (first) first.focus();
  return api;
}
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && dialogStack.length) { e.preventDefault(); dialogStack[dialogStack.length - 1].tryClose(); }
});
function confirmDialog(title, body, okText = "ตกลง", danger = false) {
  return new Promise(resolve => {
    openDialog(`<h2>${esc(title)}</h2>${body ? `<p class="muted" style="margin:0">${esc(body)}</p>` : ""}
      <div class="actions"><button class="btn ghost" data-a="no" type="button">ยกเลิก</button>
      <button class="btn ${danger ? "danger" : "primary"}" data-a="yes" type="button">${esc(okText)}</button></div>`,
      (el, d) => {
        let done = false;
        const finish = v => { if (!done) { done = true; resolve(v); } };
        const orig = d.close; d.close = () => { orig(); finish(false); };   // Escape / scrim = no
        el.addEventListener("click", e => {
          const a = e.target.closest("[data-a]"); if (!a) return;
          finish(a.dataset.a === "yes"); d.close();
        });
      }, { label: title });
  });
}
function openFailedDialog() {
  openDialog(`<h2>บันทึกไม่สำเร็จ</h2>
    <p class="muted" style="margin:0">รายการเหล่านี้ยังไม่ได้ถูกบันทึก กด “ลองใหม่” เมื่อเชื่อมต่อได้ หรือ “ทิ้ง” ถ้าไม่ต้องการแล้ว</p>
    <ul class="issues">${Sync.failed.map(f => `<li class="err">${esc(f.label)} · ${esc(errText(f.error))} · ${esc(fmtAgo(f.at))}
      <button class="btn" data-retry="${f.id}" type="button">ลองใหม่</button><button class="btn ghost" data-drop="${f.id}" type="button">ทิ้ง</button></li>`).join("")}</ul>
    <div class="actions"><button class="btn" data-a="close" type="button">ปิด</button></div>`, (el, d) => {
    el.addEventListener("click", async e => {
      const r = e.target.closest("[data-retry]"), x = e.target.closest("[data-drop]");
      if (r) { d.close(); await retryFailed(r.dataset.retry); }
      else if (x) { Sync.failed = Sync.failed.filter(f => f.id !== x.dataset.drop); d.close(); notify("sync"); }
      else if (e.target.closest('[data-a="close"]')) d.close();
    });
  }, { label: "บันทึกไม่สำเร็จ" });
}

/* ---------- leaving with unsaved work ----------
   A view that holds unsaved input sets `dirtyGuard` to a message. Hash navigation is held back and
   confirmed in-page; closing the tab gets the browser's own prompt. Pending or failed writes also count. */
let dirtyGuard = null;
window.addEventListener("beforeunload", e => {
  if (dirtyGuard || Sync.pending || Sync.failed.length) { e.preventDefault(); e.returnValue = ""; return ""; }
});
