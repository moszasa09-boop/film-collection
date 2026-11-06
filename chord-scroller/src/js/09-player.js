/* ---------- the player ----------
   Plays one song, either inside a gig (with that gig's key, capo, BPM, singer and note, and previous/next
   in set order) or straight from the library. The sheet holds still and steps one line at a time,
   timed by BPM; a one-bar count-in starts it. Scrolling by hand pauses the clock and it resumes from the
   line at the playhead. */
const P = {
  key: "", ctx: null, parts: [], bpm: 80, shift: 0, capo: 0,
  playing: false, countBeats: 0, countStart: 0, elapsed: 0, lastT: 0,
  rows: [], tops: [], starts: [], total: 0, cur: 0,
  userScrolling: false, userTimer: 0, autoScrollUntil: 0, dragging: false, wakeLock: null, taps: [],
  paintedCur: -1, paintedSec: -1, saveTimer: 0, pendingSave: null, songRev: null, itemSig: "", ended: false
};
const pActive = () => !!P.ctx && !!$("#sheet.player-sheet");
let fontScale = 1;

/* ---------- shared sheet rendering (player and editor preview) ---------- */
function chordHTML(c, s) {
  if (!c) return "&nbsp;";
  const shown = tr(c.replace(/\?$/, ""), s);
  return isUnclearChord(c) ? `<span class="unclear" title="อ่านไม่ชัด">${esc(shown)}?</span>` : esc(shown);
}
function lyricHTML(t) {
  return esc(t || "").replace(/\{\?([^}]*)\}/g, (m, w) => `<span class="unclear" title="อ่านไม่ชัด">${w || "?"}</span>`);
}
function segHTML(line, s, attrs) {
  const hasChord = line.some(([c]) => c);
  const hasText = line.some(([, t]) => t && t.trim());
  const cls = !hasChord ? "nochord" : !hasText ? "onlychord" : "";
  return `<div class="line lyr ${cls}" ${attrs}>` + line.map(([c, t]) =>
    `<span class="seg"><span class="ch">${chordHTML(c, s)}</span><span class="ly">${lyricHTML(t)}</span></span>`).join("") + `</div>`;
}
function sheetHTML(parts, s) {
  return parts.map((p, pi) => {
    const b = p.block;
    if (p.kind === "instru") return `<div class="line instru" data-p="${pi}" data-bars="${p.bars}"><span class="lab">${esc(p.name)}</span><span class="bars">${(b.bars || []).map(bar => `<span>${bar.split(/\s+/).map(c => chordHTML(c, s)).join(" ")}</span>`).join("")}</span>${b.note ? `<span class="note">${esc(b.note)}</span>` : ""}</div>`;
    if (p.kind === "lines") return `<div class="stanza"><div class="sec" data-sec="${pi}">${esc(p.name)}</div>${p.lines.map(l => segHTML(l.line, s, `data-p="${pi}" data-bars="${l.bars}"`)).join("")}</div>`;
    if (p.kind === "note") return `<div class="line notel" data-p="${pi}" data-bars="0">${esc(b.text)}</div>`;
    if (p.kind === "end") return `<div class="line endl" data-p="${pi}" data-bars="0">${esc(b.text)}</div>`;
    return "";
  }).join("");
}

/* ---------- context ---------- */
function playerContext(kind, a, b) {
  if (kind === "event") {
    const ev = Store.events.get(a), item = Store.items.get(b);
    if (!ev || !item) return null;
    if (isBreak(item)) return null;
    const full = eventItems(a), list = full.filter(i => !isBreak(i));
    return { kind, event: ev, item, song: Store.songs.get(item.songId), list, full, index: list.findIndex(i => i.id === b) };
  }
  const song = Store.songs.get(a);
  return song ? { kind: "song", song, event: null, item: null, list: [], index: -1 } : null;
}
const itemSig = it => it ? [it.shift || 0, it.capo || 0, it.bpm || "", it.singer || "", it.note || "", it.setId].join("|") : "";
function settingsFrom(ctx) {
  if (ctx.item) return { bpm: itemBpm(ctx.item, ctx.song), shift: ctx.item.shift || 0, capo: ctx.item.capo || 0 };
  const lib = prefs.get("lib:" + ctx.song.id, {});
  return { bpm: validBpm(ctx.song.bpm) ? ctx.song.bpm : 80, shift: lib.shift || 0, capo: lib.capo || 0 };
}

function renderPlayer(kind, a, b) {
  const key = kind + ":" + a + ":" + (b || "");
  const ctx = playerContext(kind, a, b);
  if (!ctx || !ctx.song) {
    stopPlay();
    P.ctx = null; P.key = "";
    const back = kind === "event" ? "#event-" + a : "#library";
    app.innerHTML = header({ title: "เล่นเพลง", back }) + `<main class="wrap"><p class="empty">${Store.fresh || Store.mode === "device" ? (ctx && !ctx.song ? "เพลงนี้ถูกลบออกจากคลังแล้ว" : "ไม่พบเพลงนี้ อาจถูกลบหรือย้ายไปแล้ว") : "กำลังโหลด…"}</p><p style="text-align:center"><a class="btn" href="${back}">กลับ</a></p></main>`;
    return;
  }
  // same song still on screen: refresh in place instead of rebuilding (keeps the position while playing)
  if (P.key === key && pActive()) {
    const songChanged = (ctx.song.rev || 0) !== P.songRev;
    const itemChanged = itemSig(ctx.item) !== P.itemSig && !P.pendingSave;
    P.ctx = ctx;
    if (itemChanged) { const st = settingsFrom(ctx); P.bpm = st.bpm; P.shift = st.shift; P.capo = st.capo; P.itemSig = itemSig(ctx.item); }
    if (songChanged) { P.songRev = ctx.song.rev || 0; P.parts = analyse(ctx.song.blocks); rebuildSheet(); toast("เนื้อเพลงนี้เพิ่งถูกแก้ไข แสดงฉบับล่าสุดแล้ว"); }
    else if (itemChanged) { rebuildSheet(); toast("ใช้ค่าล่าสุดของเพลงนี้ในงานแล้ว"); }
    refreshPlayerChrome();
    return;
  }
  stopPlay();
  P.key = key; P.ctx = ctx; P.parts = analyse(ctx.song.blocks);
  const st = settingsFrom(ctx); P.bpm = st.bpm; P.shift = st.shift; P.capo = st.capo;
  P.songRev = ctx.song.rev || 0; P.itemSig = itemSig(ctx.item);
  P.cur = 0; P.elapsed = 0; P.ended = false; P.paintedCur = P.paintedSec = -1;
  fontScale = prefs.get("font", 1);
  document.documentElement.style.setProperty("--scale", fontScale);
  document.body.classList.toggle("stage", !!prefs.get("stage", false));
  const s = ctx.song;
  document.title = s.title + " · คอร์ดเลื่อนตามเพลง";
  const back = ctx.event ? "#event-" + ctx.event.id : "#library";
  const prev = ctx.event && ctx.list[ctx.index - 1], next = ctx.event && ctx.list[ctx.index + 1];
  const nameOf = it => { const x = it && Store.songs.get(it.songId); return x ? x.title : "เพลงถูกลบ"; };
  app.innerHTML = header({
    title: `${esc(s.title)}${s.artist ? `<small>${esc(s.artist)}</small>` : ""}`, back, sync: false,
    right: `${prev ? `<a class="icon-btn" href="#play-${ctx.event.id}-${prev.id}" aria-label="เพลงก่อนหน้า: ${esc(nameOf(prev))}">${ICON.prevSong}</a>` : ""}
      ${next ? `<a class="icon-btn" href="#play-${ctx.event.id}-${next.id}" aria-label="เพลงถัดไป: ${esc(nameOf(next))}">${ICON.nextSong}</a>` : ""}
      <button class="icon-btn" id="stage" type="button" aria-pressed="${!!prefs.get("stage", false)}" aria-label="โหมดเวที" title="โหมดเวที">${ICON.stage}</button>
`
  }) + `
  <div class="guide" aria-hidden="true"></div>
  <main class="wrap">
    <div class="song-head">
      <h1>${esc(s.title)}</h1>
      <div class="meta" id="pl-meta"></div>
      ${ctx.item && ctx.item.note ? `<div class="banner info" style="margin:6px 0 0"><span class="grow">${esc(ctx.item.note)}</span></div>` : ""}
      ${songStats(s).unclear ? `<div class="banner" style="margin:6px 0 0"><span class="grow">เพลงนี้ยังมี ${songStats(s).unclear} จุดที่อ่านไม่ชัด (สีเหลือง)${writable() ? ` · <a href="#edit-${s.id}">ตรวจแก้</a>` : ""}</span></div>` : ""}
    </div>
    <article class="sheet player-sheet" id="sheet"></article>
    <div class="next-song">
      ${prev ? `<a href="#play-${ctx.event.id}-${prev.id}">‹ ${esc(nameOf(prev))}</a>` : "<span></span>"}
      ${next ? `<a href="#play-${ctx.event.id}-${next.id}">${esc(nameOf(next))} ›</a>` : ""}
    </div>
    ${writable() ? `<p style="text-align:center"><a class="btn ghost" href="#edit-${s.id}">แก้เนื้อเพลง/คอร์ด</a></p>` : ""}
  </main>
  <div style="height:230px"></div>
  <section class="player" aria-label="ตัวควบคุมการเล่น"><div class="wrap">
    <div class="status" aria-live="polite"><span class="now-sec" id="now-sec"></span><span class="next-sec" id="next-sec"></span>
      <span class="beats" aria-hidden="true"><i></i><i></i><i></i><i></i></span></div>
    <div id="next-card"></div>
    <div class="prog"><span id="t-now">0:00</span><input id="seek" type="range" min="0" max="1000" value="0" aria-label="ตำแหน่งในเพลง"><span id="t-all">0:00</span></div>
    <div class="ctrls">
      <button class="play" id="play" type="button" aria-label="เล่น">${ICON.play}</button>
      <div class="stepper" role="group" aria-label="ความเร็วเพลง"><span class="cap">BPM</span>
        <button id="bpm-down" type="button" aria-label="ช้าลง">−</button><span class="val" id="bpm"></span><button id="bpm-up" type="button" aria-label="เร็วขึ้น">+</button></div>
      <div class="tapwrap"><span class="cap">จับจังหวะ</span><button class="tap" id="tap" type="button">แตะตาม</button></div>
      <div class="stepper" role="group" aria-label="เปลี่ยนคีย์"><span class="cap">คีย์</span>
        <button id="tr-down" type="button" aria-label="ลดคีย์ครึ่งเสียง">−</button><span class="val key" id="tr"></span><button id="tr-up" type="button" aria-label="เพิ่มคีย์ครึ่งเสียง">+</button></div>
    </div>
    <div class="row" style="justify-content:space-between">
      <div class="stepper" role="group" aria-label="คาโป้" style="grid-template-columns:auto 30px auto 30px;gap:6px"><span class="cap" style="grid-column:auto">คาโป้</span>
        <button id="capo-down" type="button" aria-label="ลดคาโป้">−</button><span class="val" id="capo"></span><button id="capo-up" type="button" aria-label="เพิ่มคาโป้">+</button></div>
      <div class="stepper" role="group" aria-label="ขนาดตัวหนังสือ" style="grid-template-columns:auto 34px 34px;gap:6px"><span class="cap" style="grid-column:auto">ตัวอักษร</span>
        <button id="fs-down" type="button" aria-label="ตัวหนังสือเล็กลง" style="font-size:14px">A−</button><button id="fs-up" type="button" aria-label="ตัวหนังสือใหญ่ขึ้น" style="font-size:14px">A+</button></div>
      <button class="btn ghost" type="button" id="reset" style="min-height:36px;padding:0 10px">คืนค่าเดิม</button>
      ${syncPill()}
      <span class="saved-note" id="saved-note" style="flex-basis:100%"></span>
    </div>
  </div></section>`;
  document.body.classList.add("player-on");
  rebuildSheet();
  wirePlayer();
  window.scrollTo(0, 0);
  refreshPlayerChrome();
}
function rebuildSheet() {
  const keep = P.cur;
  $("#sheet").innerHTML = sheetHTML(P.parts, P.shift - P.capo);
  P.paintedCur = P.paintedSec = -1;
  measure();
  P.cur = Math.min(keep, Math.max(0, P.rows.length - 1));
  if (P.cur > 0) scrollToRow(P.cur, true);
  paint();
}
function refreshPlayerChrome() {
  const ctx = P.ctx; if (!ctx) return;
  const s = ctx.song;
  const key = keyOf(s.blocks, P.shift), shape = P.capo ? keyOf(s.blocks, P.shift - P.capo) : "";
  const meta = [];
  if (s.artist) meta.push(`<span class="hide-stage">${esc(s.artist)}</span>`);
  meta.push(`<span>คีย์ <b>${esc(key)}</b>${P.capo ? ` · คาโป้ ${P.capo} จับคอร์ด <b>${esc(shape)}</b>` : ""}</span>`);
  if (ctx.item && ctx.item.singer) meta.push(`<span>ร้อง: ${esc(ctx.item.singer)}</span>`);
  if (ctx.event) meta.push(`<span class="hide-stage">${esc(ctx.event.name)} · เพลงที่ ${ctx.index + 1}/${ctx.list.length}</span>`);
  meta.push(`<span class="hide-stage">ยาวประมาณ ${fmtTime(P.total)}</span>`);
  $("#pl-meta").innerHTML = meta.join("");
  $("#bpm").textContent = P.bpm;
  $("#tr").textContent = P.shift === 0 ? "เดิม" : (P.shift > 0 ? "+" : "") + P.shift;
  $("#capo").textContent = P.capo;
  const note = $("#saved-note");
  if (note) note.textContent = ctx.item ? (writable() ? "ค่าที่ปรับบันทึกไว้กับงานนี้" : "ดูอย่างเดียว: ค่าที่ปรับใช้ชั่วคราว") : "BPM บันทึกกับเพลง · คีย์/คาโป้จำไว้ในเครื่องนี้";
  refreshSyncPill();
}

/* ---------- saving player changes (one write per pause) ---------- */
function queueSave(patch) {
  const ctx = P.ctx; if (!ctx) return;
  if (!ctx.item) {
    const lib = prefs.get("lib:" + ctx.song.id, {});
    if ("shift" in patch) lib.shift = patch.shift;
    if ("capo" in patch) lib.capo = patch.capo;
    prefs.set("lib:" + ctx.song.id, lib);
    if ("bpm" in patch && writable()) { P.pendingSave = { ...(P.pendingSave || {}), bpm: patch.bpm }; }
  } else if (writable()) P.pendingSave = { ...(P.pendingSave || {}), ...patch };
  if (!P.pendingSave) return;
  clearTimeout(P.saveTimer);
  P.saveTimer = setTimeout(flushSave, 900);
}
async function flushSave() {
  const ctx = P.ctx, patch = P.pendingSave; P.pendingSave = null;
  if (!ctx || !patch) return;
  if (ctx.item) { P.itemSig = itemSig({ ...ctx.item, ...patch }); await patchItem(ctx.item.id, patch); }
  else if ("bpm" in patch) await patchSong(ctx.song.id, { bpm: patch.bpm });
}

/* ---------- timeline ---------- */
function measure() {
  P.rows = $$("#sheet .line");
  P.tops = P.rows.map(el => el.getBoundingClientRect().top + window.scrollY);
  retime();
}
const secPerBar = () => 4 * 60 / P.bpm;
function retime() {
  P.starts = []; let t = 0;
  P.rows.forEach(el => { P.starts.push(t); t += (+el.dataset.bars) * secPerBar(); });
  P.total = t;
  const all = $("#t-all"); if (all) all.textContent = fmtTime(P.total);
  paint();
}
const rowDur = k => P.rows[k] ? (+P.rows[k].dataset.bars) * secPerBar() : 0;
const guideY = () => window.innerHeight * 0.34;
function rowAtScroll() {
  const y = window.scrollY + guideY() + 6;
  let lo = 0, hi = P.tops.length - 1, k = 0;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (P.tops[m] <= y) { k = m; lo = m + 1; } else hi = m - 1; }
  return k;
}
function scrollToRow(k, instant) {
  if (!P.rows[k]) return;
  P.autoScrollUntil = performance.now() + 900;
  window.scrollTo({ top: Math.max(0, P.tops[k] - guideY() + 2), behavior: instant || reduceMotion() ? "auto" : "smooth" });
}
function seekTo(t) {
  let k = 0; while (k < P.rows.length - 1 && P.starts[k + 1] <= t) k++;
  P.cur = k; P.elapsed = Math.max(0, t - P.starts[k]); P.countBeats = 0; P.ended = false;
  scrollToRow(k, true); paint();
}
function sectionOf(k) { return P.rows[k] ? +P.rows[k].dataset.p : -1; }
function nextSectionName(k) {
  const p = sectionOf(k);
  for (let j = k + 1; j < P.rows.length; j++) { const q = sectionOf(j); if (q !== p && P.parts[q] && P.parts[q].name) return P.parts[q].name; }
  return "";
}
function nextSongItem() { const c = P.ctx; return c && c.event ? c.list[c.index + 1] : null; }
/** Breaks planned between this song and the next one, e.g. "พัก 15 นาที". */
function breakAfter() {
  const c = P.ctx; if (!c || !c.full) return "";
  const i = c.full.findIndex(x => x.id === c.item.id); const out = [];
  for (let j = i + 1; j < c.full.length && isBreak(c.full[j]); j++) out.push(`${c.full[j].label || "พัก"} ${c.full[j].minutes} นาที`);
  return out.join(", ");
}
function paint() {
  if (!pActive() || !P.rows.length) return;
  if (P.cur !== P.paintedCur) {
    P.rows.forEach((el, j) => { el.classList.toggle("now", j === P.cur); el.classList.toggle("past", j < P.cur); el.style.removeProperty("--p"); });
    P.paintedCur = P.cur;
  }
  const p = sectionOf(P.cur);
  if (p !== P.paintedSec) {
    $$(".sec.on").forEach(e => e.classList.remove("on"));
    const s = $(`.sec[data-sec="${p}"]`); if (s) s.classList.add("on");
    $("#now-sec").textContent = (P.parts[p] && P.parts[p].name) || "";
    const nx = nextSectionName(P.cur), ns = nextSongItem(), nsong = ns && Store.songs.get(ns.songId);
    const brk = breakAfter();
    $("#next-sec").innerHTML = nx ? `ต่อไป <b>${esc(nx)}</b>` : brk ? `ท่อนสุดท้าย · แล้ว<b>${esc(brk)}</b>` : nsong ? `ท่อนสุดท้าย · เพลงถัดไป <b>${esc(nsong.title)}</b>` : "ท่อนสุดท้าย";
    P.paintedSec = p;
  }
  const d = rowDur(P.cur);
  P.rows[P.cur].style.setProperty("--p", d ? Math.min(1, P.elapsed / d) : 0);
  const t = (P.starts[P.cur] || 0) + (P.countBeats > 0 ? 0 : P.elapsed);
  $("#t-now").textContent = fmtTime(t);
  if (!P.dragging) $("#seek").value = P.total ? Math.round(t / P.total * 1000) : 0;
  const beat = !P.playing ? -1 : P.countBeats > 0 ? 4 - P.countBeats : Math.floor(t / (60 / P.bpm)) % 4;
  $$(".beats i").forEach((e, j) => e.classList.toggle("on", j === beat));
  const card = $("#next-card");
  if (card) {
    const ns = nextSongItem(), nsong = ns && Store.songs.get(ns.songId);
    const brk = breakAfter();
    const html = P.ended ? (ns ? `<div class="next-card"><span>จบเพลง${brk ? ` · <b>${esc(brk)}</b> แล้ว` : " ·"} ถัดไป <b>${esc(nsong ? nsong.title : "เพลงถูกลบ")}</b></span><a class="btn primary" href="#play-${P.ctx.event.id}-${ns.id}">เพลงถัดไป ${ICON.next}</a></div>`
      : `<div class="next-card"><span>${P.ctx.event ? "จบเพลงสุดท้ายของงาน" : "จบเพลง"}</span><a class="btn" href="${P.ctx.event ? "#event-" + P.ctx.event.id : "#library"}">กลับ</a></div>`) : "";
    if (card.innerHTML !== html) card.innerHTML = html;
  }
}

/* ---------- playback ---------- */
function setPlayIcon() {
  const b = $("#play"); if (!b) return;
  b.innerHTML = P.playing ? ICON.pause : ICON.play;
  b.setAttribute("aria-label", P.playing ? "หยุด" : "เล่น");
  document.body.classList.toggle("playing", P.playing);
}
async function lockScreen() { try { if ("wakeLock" in navigator) P.wakeLock = await navigator.wakeLock.request("screen"); } catch (e) { P.wakeLock = null; } }
function releaseScreen() { try { P.wakeLock && P.wakeLock.release(); } catch (e) { /* already released */ } P.wakeLock = null; }
function showCount(n) {
  let el = $(".countin");
  if (!n) { if (el) el.remove(); return; }
  if (!el) { el = document.createElement("div"); el.className = "countin"; el.setAttribute("aria-hidden", "true"); document.body.appendChild(el); }
  el.textContent = n;
}
function startPlay() {
  if (!pActive() || !P.rows.length) return;
  if (P.ended || (P.cur >= P.rows.length - 1 && P.elapsed >= rowDur(P.cur))) { P.cur = 0; P.elapsed = 0; P.ended = false; }
  scrollToRow(P.cur);
  P.countBeats = P.elapsed === 0 ? 4 : 0; P.countStart = 0;
  P.playing = true; P.lastT = performance.now();
  setPlayIcon(); lockScreen(); paint();
}
function stopPlay() { P.playing = false; P.countBeats = 0; showCount(0); setPlayIcon(); releaseScreen(); }
const togglePlay = () => P.playing ? stopPlay() : startPlay();
function setBpm(v) {
  P.bpm = clamp(Math.round(v), 40, 220);
  $("#bpm").textContent = P.bpm; retime(); refreshPlayerChrome();
  queueSave({ bpm: P.bpm });
}
function tapTempo() {
  const t = performance.now();
  if (P.taps.length && t - P.taps[P.taps.length - 1] > 2000) P.taps = [];
  P.taps.push(t); if (P.taps.length > 6) P.taps.shift();
  const b = $("#tap"); b.classList.add("hit"); setTimeout(() => b.classList.remove("hit"), 120);
  if (P.taps.length >= 3) { const g = P.taps.slice(1).map((x, j) => x - P.taps[j]); setBpm(60000 / (g.reduce((a, c) => a + c, 0) / g.length)); }
}
function setShift(v) { P.shift = (((v + 6) % 12) + 12) % 12 - 6; rebuildSheet(); refreshPlayerChrome(); queueSave({ shift: P.shift }); }
function setCapo(v) { P.capo = clamp(v, 0, 11); rebuildSheet(); refreshPlayerChrome(); queueSave({ capo: P.capo }); }
function setFont(v) {
  fontScale = Math.round(clamp(v, 0.7, 2) * 10) / 10;
  prefs.set("font", fontScale);
  document.documentElement.style.setProperty("--scale", fontScale);
  measure(); scrollToRow(P.cur, true);
}
/** Back to the song's own key, no capo and the song's BPM. In a gig this is saved to the gig row and can be undone. */
async function resetSettings() {
  const ctx = P.ctx; if (!ctx) return;
  const before = { shift: P.shift, capo: P.capo, bpm: P.bpm };
  P.shift = 0; P.capo = 0; P.bpm = validBpm(ctx.song.bpm) ? ctx.song.bpm : 80;
  rebuildSheet(); retime(); refreshPlayerChrome();
  if (ctx.item && writable()) {
    clearTimeout(P.saveTimer); P.pendingSave = null;
    P.itemSig = itemSig({ ...ctx.item, shift: 0, capo: 0, bpm: null });   // our own change: don't announce it as someone else's
    await patchItemUndoable(ctx.item.id, { shift: 0, capo: 0, bpm: null }, "คืนคีย์ คาโป้ และ BPM เป็นค่าของเพลงแล้ว");
  } else {
    if (!ctx.item) prefs.set("lib:" + ctx.song.id, {});
    toast("คืนค่าเดิมแล้ว", 6000, { text: "ย้อนกลับ", run: () => { P.shift = before.shift; P.capo = before.capo; P.bpm = before.bpm; rebuildSheet(); retime(); refreshPlayerChrome(); if (!ctx.item) prefs.set("lib:" + ctx.song.id, { shift: before.shift, capo: before.capo }); } });
  }
}
function toggleStage() {
  const on = !document.body.classList.contains("stage");
  document.body.classList.toggle("stage", on); prefs.set("stage", on);
  $("#stage").setAttribute("aria-pressed", on);
  try {
    if (on && document.documentElement.requestFullscreen && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch (e) { /* fullscreen is optional */ }
  measure(); scrollToRow(P.cur, true);
}
function wirePlayer() {
  $("#play").onclick = togglePlay;
  $("#bpm-down").onclick = () => setBpm(P.bpm - 2);
  $("#bpm-up").onclick = () => setBpm(P.bpm + 2);
  $("#tap").onclick = tapTempo;
  $("#tr-down").onclick = () => setShift(P.shift - 1);
  $("#tr-up").onclick = () => setShift(P.shift + 1);
  $("#capo-down").onclick = () => setCapo(P.capo - 1);
  $("#capo-up").onclick = () => setCapo(P.capo + 1);
  $("#fs-down").onclick = () => setFont(fontScale - 0.1);
  $("#fs-up").onclick = () => setFont(fontScale + 0.1);
  $("#stage").onclick = toggleStage;
  $("#reset").onclick = resetSettings;
  const seek = $("#seek");
  seek.addEventListener("input", () => { P.dragging = true; seekTo(P.total * seek.value / 1000); });
  seek.addEventListener("change", () => { P.dragging = false; });
  $("#sheet").addEventListener("click", e => {
    const ln = inside(e.target, ".line") ? e.target.closest(".line") : null; if (!ln) return;
    const k = P.rows.indexOf(ln); if (k < 0) return;
    P.cur = k; P.elapsed = 0; P.countBeats = 0; P.ended = false; scrollToRow(k); paint();
  });
}
function frame(t) {
  const dt = Math.min(0.25, (t - P.lastT) / 1000); P.lastT = t;
  if (P.playing && pActive() && !P.userScrolling && P.rows.length) {
    if (P.countBeats > 0) {
      P.countStart += dt;
      const left = 4 - Math.floor(P.countStart / (60 / P.bpm));
      if (left <= 0) { P.countBeats = 0; showCount(0); } else { P.countBeats = left; showCount(5 - left); }
    } else {
      P.elapsed += dt;
      while (P.elapsed >= rowDur(P.cur)) {
        if (P.cur >= P.rows.length - 1) { P.elapsed = rowDur(P.cur); P.ended = true; stopPlay(); break; }
        P.elapsed -= rowDur(P.cur); P.cur++;
        scrollToRow(P.cur);
      }
    }
    paint();
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function userScrollStart() { if (!pActive()) return; P.userScrolling = true; clearTimeout(P.userTimer); }
function userScrollEnd(delay) {
  clearTimeout(P.userTimer);
  P.userTimer = setTimeout(() => {
    P.userScrolling = false;
    if (!pActive()) return;
    const k = rowAtScroll();
    if (k !== P.cur) { P.cur = k; P.elapsed = 0; P.ended = false; }
    P.lastT = performance.now(); paint();
  }, delay);
}
window.addEventListener("touchstart", e => { if (!inside(e.target, ".player, .bar, .scrim")) userScrollStart(); }, { passive: true });
window.addEventListener("touchend", () => { if (P.userScrolling) userScrollEnd(900); }, { passive: true });
window.addEventListener("touchcancel", () => { if (P.userScrolling) userScrollEnd(900); }, { passive: true });
window.addEventListener("wheel", () => { if (pActive()) { userScrollStart(); userScrollEnd(500); } }, { passive: true });
window.addEventListener("scroll", () => {
  if (!pActive() || P.playing || performance.now() < P.autoScrollUntil) return;
  const k = rowAtScroll(); if (k !== P.cur) { P.cur = k; P.elapsed = 0; P.ended = false; paint(); }
}, { passive: true });
let lastWidth = window.innerWidth;
window.addEventListener("resize", () => {
  if (!pActive()) return;
  const wc = window.innerWidth !== lastWidth; lastWidth = window.innerWidth;
  measure();
  if (wc && !P.userScrolling) scrollToRow(P.cur, true);
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && P.playing) lockScreen();
  if (document.visibilityState === "hidden" && P.pendingSave) { clearTimeout(P.saveTimer); flushSave(); }
});
document.addEventListener("keydown", e => {
  if (!pActive() || dialogStack.length || inside(e.target, "input, textarea, select")) return;
  const c = P.ctx;
  if (e.code === "Space") { e.preventDefault(); if (e.repeat) return; if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); togglePlay(); }
  else if (e.key === "ArrowDown") { e.preventDefault(); P.cur = Math.min(P.rows.length - 1, P.cur + 1); P.elapsed = 0; scrollToRow(P.cur); paint(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); P.cur = Math.max(0, P.cur - 1); P.elapsed = 0; scrollToRow(P.cur); paint(); }
  else if ((e.key === "ArrowRight" || e.key === "PageDown") && c.event && c.list[c.index + 1]) { e.preventDefault(); location.hash = `#play-${c.event.id}-${c.list[c.index + 1].id}`; }
  else if ((e.key === "ArrowLeft" || e.key === "PageUp") && c.event && c.list[c.index - 1]) { e.preventDefault(); location.hash = `#play-${c.event.id}-${c.list[c.index - 1].id}`; }
});
document.addEventListener("keyup", e => { if (pActive() && e.code === "Space" && inside(e.target, "button")) e.preventDefault(); });
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (pActive()) { measure(); scrollToRow(P.cur, true); } });
function leavePlayer() {
  if (P.pendingSave) { clearTimeout(P.saveTimer); flushSave(); }
  stopPlay(); P.ctx = null; P.key = "";
  document.body.classList.remove("player-on", "stage", "playing");
}
