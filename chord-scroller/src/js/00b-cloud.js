/* ---------- Supabase: one band's data shared across devices (public link) ----------
   When the page is built with a Supabase project (cloud.json) and opened outside claude.ai, a signed-in
   member works on their band's shared data. createCloudDB() offers the same small API as the claude.ai
   database and LocalDB, so the rest of the app does not change:
   - every write shows up at once (optimistic), then goes to Supabase; if the network is down it waits in
     an outbox kept in this browser and is sent when the connection returns (also after a reload);
   - everything last seen is cached per person and band, so a prepared gig opens without internet;
   - other members' changes arrive live through Supabase Realtime, and a full reload after reconnecting
     catches anything missed;
   - song saves use put_doc_if on the server, so two people saving the same song never silently overwrite. */
const Cloud = { cfg: typeof CLOUD_CONFIG !== "undefined" ? CLOUD_CONFIG : null, sb: null, user: null, bands: [], band: null, role: null, realtime: "off", db: null };
const cloudConfigured = () => !!(Cloud.cfg && Cloud.cfg.url && Cloud.cfg.anonKey && window.supabase && window.supabase.createClient);
const isNetErr = e => !navigator.onLine || /fetch|network|load failed|timeout/i.test(String(e && (e.message || e)));
function cloudErr(e) {
  if (!e) return { code: "unavailable", message: "unknown" };
  if (isNetErr(e)) return { code: "offline", message: String(e.message || e) };
  if (e.code === "42501" || /row-level security|permission|not allowed/i.test(e.message || "")) return { code: "invalid_argument", message: e.message };
  if (e.code === "P0002") return { code: "not_found", message: e.message };
  return { code: e.code || "unavailable", message: e.message || String(e) };
}

async function cloudStart() {
  if (!cloudConfigured()) return null;
  Cloud.sb = window.supabase.createClient(Cloud.cfg.url, Cloud.cfg.anonKey, {
    auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "chordscroll-auth" }
  });
  let session = null;
  try { session = (await Cloud.sb.auth.getSession()).data.session; } catch (e) { /* offline: stored session still works below */ }
  // a sign-in link brings ?code=… back to the page; supabase-js has used it by now, so tidy the address bar
  const q = new URLSearchParams(location.search);
  if (q.has("code") || q.has("error_description")) { q.delete("code"); q.delete("error"); q.delete("error_code"); q.delete("error_description"); history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash); }
  Cloud.user = session ? session.user : null;
  Cloud.sb.auth.onAuthStateChange((event, s) => {
    const had = !!Cloud.user, has = !!(s && s.user);
    if (had !== has) location.reload();   // signed in or out in this or another tab: start over cleanly
  });
  if (!Cloud.user) return null;
  prefs.owner = Cloud.user.id;
  const join = new URLSearchParams(location.search).get("join");
  if (join) {
    const { data, error } = await Cloud.sb.rpc("accept_invite", { p_code: join, p_display_name: prefs.get("myName", "") });
    const q2 = new URLSearchParams(location.search); q2.delete("join");
    history.replaceState(null, "", location.pathname + (q2.toString() ? "?" + q2 : "") + location.hash);
    if (error) setTimeout(() => toast("ลิงก์เชิญใช้ไม่ได้: หมดอายุหรือถูกใช้ครบแล้ว ขอลิงก์ใหม่จากเจ้าของวง", 7000), 500);
    else { prefs.set("cloudBand", data); setTimeout(() => toast("เข้าร่วมวงแล้ว"), 500); }
  }
  await loadBands();
  if (!Cloud.bands.length) return null;
  Cloud.band = Cloud.bands.find(b => b.id === prefs.get("cloudBand", "")) || Cloud.bands[0];
  Cloud.role = Cloud.band.role;
  prefs.set("cloudBand", Cloud.band.id);
  Cloud.db = createCloudDB(Cloud.band.id, Cloud.user.id);
  return Cloud.db;
}
async function loadBands() {
  const key = "chordscroll-cloud-bands:" + Cloud.user.id;
  const { data, error } = await Cloud.sb.from("band_members").select("band_id, role, display_name, bands(name)").eq("user_id", Cloud.user.id);
  if (!error && data) {
    Cloud.bands = data.map(r => ({ id: r.band_id, role: r.role, myName: r.display_name, name: r.bands ? r.bands.name : "วง" }));
    try { localStorage.setItem(key, JSON.stringify(Cloud.bands)); } catch (e) { /* cache optional */ }
    // no longer in a band (left or removed): drop this device's copy of that band's data
    forgetCloudData(Cloud.user.id, new Set(Cloud.bands.map(b => b.id)));
  } else {
    try { Cloud.bands = JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { Cloud.bands = []; }
  }
}

function createCloudDB(bandId, userId) {
  const sb = Cloud.sb;
  const COLS = ["songs", "events", "items"];
  const cacheKey = "chordscroll-cloud:" + userId + ":" + bandId;
  const outKey = cacheKey + ":outbox";
  const local = {}; COLS.forEach(c => local[c] = new Map());
  const loaded = {};
  let cachedAt = 0;
  try {
    const c = JSON.parse(localStorage.getItem(cacheKey) || "null");
    if (c) { COLS.forEach(col => (c[col] || []).forEach(([id, d]) => local[col].set(id, d))); cachedAt = c.at || 0; }
  } catch (e) { /* no cache yet */ }
  let outbox = [];
  try { outbox = JSON.parse(localStorage.getItem(outKey) || "[]"); } catch (e) { outbox = []; }
  const waiters = new Map();          // op id → {resolve, reject} for writes made in this page
  const listeners = new Set();        // {col, fn}
  let closed = false;
  const saveCache = () => {
    if (closed) return;
    try { localStorage.setItem(cacheKey, JSON.stringify({ at: Date.now(), ...Object.fromEntries(COLS.map(c => [c, [...local[c]]])) })); } catch (e) { /* full disk: cache is optional */ }
  };
  let cacheTimer = 0;
  const saveCacheSoon = () => { clearTimeout(cacheTimer); cacheTimer = setTimeout(saveCache, 400); };
  const saveOutbox = () => { try { localStorage.setItem(outKey, JSON.stringify(outbox)); } catch (e) { /* if this fails the write still waits in memory */ } };
  const snap = (id, data, fromCache) => ({ id, exists: data !== undefined, data: () => data === undefined ? undefined : JSON.parse(JSON.stringify(data)), metadata: { fromCache: !!fromCache, hasPendingWrites: false } });
  function emit(col) {
    const docs = [...local[col]].map(([id, d]) => snap(id, d, !loaded[col]));
    const s = { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: !loaded[col], hasPendingWrites: outbox.length > 0 } };
    for (const l of listeners) if (l.col === col) l.fn(s);
    saveCacheSoon();
  }
  async function fetchAll(col) {
    const rows = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("docs").select("id, data").eq("band_id", bandId).eq("col", col).range(from, from + 999);
      if (error) throw cloudErr(error);
      rows.push(...data);
      if (data.length < 1000) break;
    }
    return rows;
  }
  async function reloadAll() {
    for (const col of COLS) {
      try {
        const rows = await fetchAll(col);
        const m = new Map(rows.map(r => [r.id, r.data]));
        // keep our own writes that have not reached the server yet
        for (const op of outbox) if (op.col === col) { if (op.op === "delete") m.delete(op.id); else if (op.op === "merge") { const cur = m.get(op.id); if (cur) m.set(op.id, { ...cur, ...op.data }); } else m.set(op.id, op.data); }
        local[col] = m; loaded[col] = true; emit(col);
      } catch (e) { emit(col); }
    }
    notify("sync");
  }
  async function send(op) {
    if (op.op === "set") { const { error } = await sb.from("docs").upsert({ band_id: bandId, col: op.col, id: op.id, data: op.data }); if (error) throw cloudErr(error); }
    else if (op.op === "merge") { const { error } = await sb.rpc("merge_doc", { p_band: bandId, p_col: op.col, p_id: op.id, p_patch: op.data }); if (error) throw cloudErr(error); }
    else if (op.op === "delete") { const { error } = await sb.from("docs").delete().eq("band_id", bandId).eq("col", op.col).eq("id", op.id); if (error) throw cloudErr(error); }
  }
  let flushing = false;
  async function flush() {
    if (flushing || !outbox.length || !navigator.onLine) return;
    flushing = true;
    try {
      while (outbox.length) {
        const op = outbox[0];
        try { await send(op); }
        catch (e) {
          if (e.code === "offline") break;           // still offline: try again later
          outbox.shift(); saveOutbox();               // the server refused it: report it and undo it locally
          const w = waiters.get(op.opId); if (w) { waiters.delete(op.opId); w.reject(e); }
          else setTimeout(() => toast("การแก้ไขที่ค้างอยู่ถูกปฏิเสธ: " + errText(e), 6000), 0);
          refetchOne(op.col, op.id);
          continue;
        }
        outbox.shift(); saveOutbox();
        const w = waiters.get(op.opId); if (w) { waiters.delete(op.opId); w.resolve(); }
      }
    } finally { flushing = false; notify("sync"); }
  }
  async function refetchOne(col, id) {
    const { data } = await sb.from("docs").select("data").eq("band_id", bandId).eq("col", col).eq("id", id).maybeSingle();
    if (data) local[col].set(id, data.data); else local[col].delete(id);
    emit(col);
  }
  function queue(op) {
    op.opId = newId(); op.at = Date.now();
    outbox.push(op); saveOutbox();
    const p = new Promise((resolve, reject) => waiters.set(op.opId, { resolve, reject }));
    flush();
    return p;
  }
  window.addEventListener("online", () => { flush().then(reloadAll); });
  setInterval(() => { if (outbox.length) flush(); }, 15000);

  // live changes from other members
  const channel = sb.channel("band-" + bandId)
    .on("postgres_changes", { event: "*", schema: "public", table: "docs", filter: "band_id=eq." + bandId }, p => {
      const row = p.new && p.new.col ? p.new : p.old;
      if (!row || !COLS.includes(row.col)) return;
      if (outbox.some(o => o.col === row.col && o.id === row.id)) return;   // our own pending change wins locally until it is sent
      if (p.eventType === "DELETE") local[row.col].delete(row.id); else local[row.col].set(row.id, p.new.data);
      emit(row.col);
    })
    .subscribe(status => {
      const was = Cloud.realtime; Cloud.realtime = status;
      if (status === "SUBSCRIBED" && was !== "SUBSCRIBED" && was !== "off") reloadAll();   // reconnected: catch up
      notify("sync");
    });

  const api = {
    bandId,
    pending: () => outbox.length,
    cachedAt: () => cachedAt,
    doc(path) {
      const [col, id] = [path.slice(0, path.lastIndexOf("/")), path.slice(path.lastIndexOf("/") + 1)];
      return {
        id, path,
        async get() {
          if (col === "history" || navigator.onLine) {
            const { data, error } = await sb.from("docs").select("data").eq("band_id", bandId).eq("col", col).eq("id", id).maybeSingle();
            if (!error) return snap(id, data ? data.data : undefined, false);
            if (!isNetErr(error)) throw cloudErr(error);
          }
          if (!local[col]) throw { code: "offline", message: "offline" };
          return snap(id, local[col].get(id), true);
        },
        set(data) {
          const body = JSON.parse(JSON.stringify(data));
          if (local[col]) { local[col].set(id, body); emit(col); }
          return queue({ op: "set", col, id, data: body });
        },
        update(patch) {
          const p = JSON.parse(JSON.stringify(patch));
          if (local[col]) {
            const cur = local[col].get(id);
            if (!cur) return Promise.reject({ code: "invalid_argument", message: "document does not exist" });
            local[col].set(id, { ...cur, ...p }); emit(col);
          }
          return queue({ op: "merge", col, id, data: p });
        },
        delete() {
          if (local[col]) { local[col].delete(id); emit(col); }
          return queue({ op: "delete", col, id });
        },
        /** Atomic save: only if the stored "rev" is still expectedRev. Rejects {code:"conflict", current} or {code:"offline"}. */
        async putIfRev(data, expectedRev) {
          if (!navigator.onLine) throw { code: "offline", message: "offline" };
          const { data: r, error } = await sb.rpc("put_doc_if", { p_band: bandId, p_col: col, p_id: id, p_data: data, p_expected_rev: expectedRev });
          if (error) throw cloudErr(error);
          if (r && r.ok) { if (local[col]) { local[col].set(id, JSON.parse(JSON.stringify(data))); emit(col); } return; }
          throw { code: "conflict", current: r && r.current ? r.current : null, message: "changed by someone else" };
        },
        async acquire({ holder, ttlMs }) { return { acquired: true, holder, expiresAt: new Date(Date.now() + (ttlMs || 30000)).toISOString() }; },
        onSnapshot(fn) { return api.collection(col).onSnapshot(s => { const d = s.docs.find(x => x.id === id); fn(d || snap(id, undefined, s.metadata.fromCache)); }); }
      };
    },
    collection(col) {
      return {
        path: col,
        doc: id => api.doc(col + "/" + (id || newId())),
        async get() {
          if (local[col] && loaded[col]) return { docs: [...local[col]].map(([id, d]) => snap(id, d, false)), size: local[col].size };
          const rows = await fetchAll(col);
          const docs = rows.map(r => snap(r.id, r.data, false));
          return { docs, size: docs.length, empty: !docs.length };
        },
        onSnapshot(fn) {
          const l = { col, fn }; listeners.add(l);
          setTimeout(() => emit(col), 0);
          return () => listeners.delete(l);
        }
      };
    },
    close() { closed = true; clearTimeout(cacheTimer); try { sb.removeChannel(channel); } catch (e) { /* page is going away */ } }
  };
  // start: show the cache right away, then load fresh data and send anything left from last time
  setTimeout(() => { COLS.forEach(emit); flush().then(reloadAll); }, 0);
  return api;
}

/* ---------- account, band and members ---------- */
async function cloudSignIn() {
  openDialog(`<h2>เข้าสู่ระบบเพื่อใช้กับวง</h2>
    <p class="small muted" style="margin:0">ใส่อีเมล ระบบจะส่งลิงก์และรหัส 6 หลักไปให้ ไม่ต้องตั้งรหัสผ่าน</p>
    <form id="si-form" class="checks" novalidate>
      <label class="f"><span>อีเมล</span><input id="si-email" type="email" autocomplete="email" inputmode="email" required autofocus></label>
      <label class="f" id="si-code-wrap" hidden><span>รหัส 6 หลักจากอีเมล</span><input id="si-code" inputmode="numeric" autocomplete="one-time-code" maxlength="10"></label>
      <p class="f"><span class="err" id="si-err"></span></p>
      <div class="actions"><button class="btn ghost" type="button" data-a="c">ยกเลิก</button><button class="btn primary" type="submit" id="si-go">ส่งรหัส</button></div>
    </form>`, (el, d) => {
    let sent = false;
    $('[data-a="c"]', el).onclick = () => d.close();
    $("#si-form", el).addEventListener("submit", async e => {
      e.preventDefault();
      const email = $("#si-email", el).value.trim(), err = $("#si-err", el), go = $("#si-go", el);
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { err.textContent = "ใส่อีเมลให้ถูกต้อง"; return; }
      go.disabled = true; err.textContent = "";
      if (!sent) {
        const { error } = await Cloud.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname + location.search } });
        go.disabled = false;
        if (error) { err.textContent = /rate|seconds/i.test(error.message) ? "ส่งถี่เกินไป รอสักครู่แล้วลองใหม่" : isNetErr(error) ? "ต้องต่ออินเทอร์เน็ตเพื่อเข้าสู่ระบบ" : "ส่งไม่สำเร็จ: " + error.message; return; }
        sent = true; $("#si-code-wrap", el).hidden = false; $("#si-email", el).readOnly = true; go.textContent = "เข้าสู่ระบบ";
        err.textContent = ""; toast("ส่งแล้ว เปิดอีเมลแล้วกดลิงก์ หรือใส่รหัส 6 หลักที่นี่", 8000);
        $("#si-code", el).focus();
        return;
      }
      const token = $("#si-code", el).value.replace(/\s/g, "");
      const { error } = await Cloud.sb.auth.verifyOtp({ email, token, type: "email" });
      go.disabled = false;
      if (error) { err.textContent = "รหัสไม่ถูกต้องหรือหมดอายุ ลองขอรหัสใหม่"; return; }
      d.close();   // onAuthStateChange reloads the page as the signed-in member
    });
  }, { label: "เข้าสู่ระบบ" });
}
/** Remove this device's cached band data for `uid` (all bands, or all except `keep`). Unsent writes are kept. */
function forgetCloudData(uid, keep) {
  try {
    const prefix = "chordscroll-cloud:" + uid + ":";
    const drop = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      if (k.endsWith(":outbox")) { if (!keep && (localStorage.getItem(k) || "[]") === "[]") drop.push(k); continue; }   // never drop unsent work
      const band = k.slice(prefix.length);
      if (!keep || !keep.has(band)) drop.push(k);
    }
    drop.forEach(k => localStorage.removeItem(k));
    if (!keep) localStorage.removeItem("chordscroll-cloud-bands:" + uid);
    for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith("chordscroll-offline-pack:")) localStorage.removeItem(k); }
  } catch (e) { /* storage blocked */ }
}
async function cloudSignOut() {
  const pending = Cloud.db ? Cloud.db.pending() : 0;
  if (pending && !(await confirmDialog("ยังมีการแก้ไขที่ส่งไม่ถึงเซิร์ฟเวอร์", `${pending} รายการยังรอส่ง ถ้าออกจากระบบตอนนี้ รายการเหล่านั้นจะรอในเครื่องนี้จนกว่าคุณจะเข้าสู่ระบบอีกครั้ง`, "ออกจากระบบ", true))) return;
  if (Cloud.db) Cloud.db.close();
  forgetCloudData(Cloud.user.id, null);   // shared phone: the next person must not find this band's data here
  await Cloud.sb.auth.signOut();
}
async function cloudCreateBand(copyLocal) {
  promptText("สร้างวง", "ชื่อวง", "", async name => {
    const { data: id, error } = await Cloud.sb.rpc("create_band", { p_name: name, p_display_name: prefs.get("myName", "") });
    if (error) { toast("สร้างวงไม่สำเร็จ: " + (cloudErr(error).message || "")); return; }
    prefs.set("cloudBand", id);
    if (copyLocal) prefs.set("copyLocalTo", id);
    location.reload();
  });
}
/** After creating a band from a device that already has songs: copy them up once. */
async function cloudCopyLocalIfAsked() {
  if (Store.mode !== "cloud" || prefs.get("copyLocalTo", "") !== Cloud.band.id) return;
  prefs.set("copyLocalTo", "");
  const ldb = createLocalDB("v1");
  const pick = async c => (await ldb.collection(c).get()).docs.map(d => ({ ...d.data(), id: d.id }));
  const data = { format: "chordscroll-backup", version: 1, exportedAt: new Date().toISOString(), songs: await pick("songs"), events: await pick("events"), items: await pick("items") };
  if (!data.songs.length && !data.events.length) return;
  const r = checkBackup(data);
  toast(`กำลังย้าย ${r.songs.length} เพลงและ ${r.events.length} งานจากเครื่องนี้ขึ้นวง…`, 8000);
  await applyRestore(r, false);
}
async function cloudMembers() {
  const { data, error } = await Cloud.sb.from("band_members").select("user_id, role, display_name, joined_at").eq("band_id", Cloud.band.id).order("joined_at");
  if (error) throw cloudErr(error);
  return data;
}
async function cloudInvites() {
  if (Cloud.role !== "owner") return [];
  const { data } = await Cloud.sb.from("band_invites").select("code, role, expires_at, uses, max_uses").eq("band_id", Cloud.band.id).order("created_at", { ascending: false });
  return (data || []).filter(i => new Date(i.expires_at) > new Date() && i.uses < i.max_uses);
}
const inviteUrl = code => location.origin + location.pathname + "?join=" + encodeURIComponent(code);
const ROLE_TH = { owner: "เจ้าของ", editor: "ผู้แก้ไข", viewer: "ผู้ดู" };

/* image reading through the band's Supabase function (same interface the editor uses for claude.ai) */
function cloudSampler() {
  const toB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob); });
  async function shrink(blob) {
    try {
      const bmp = await createImageBitmap(blob);
      const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      if (k === 1 && blob.size < 3.5e6 && /jpeg|png|webp/.test(blob.type)) return blob;
      const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(r, "image/jpeg", 0.9));
    } catch (e) { return blob; }
  }
  const fn = {
    async json(prompt, { images, signal, tiled } = {}) {
      const list = [];
      for (const b of [].concat(images || [])) { const s = await shrink(b); list.push({ media_type: s.type || "image/jpeg", data: await toB64(s) }); }
      if (signal && signal.aborted) throw { code: "cancelled" };
      const call = Cloud.sb.functions.invoke("read-chords", { body: { bandId: Cloud.band.id, images: list, tiled: !!tiled } });
      const res = await (signal ? Promise.race([call, new Promise((_, rej) => signal.addEventListener("abort", () => rej({ code: "cancelled" })))]) : call);
      if (res.error) {
        let body = null;
        try { body = res.error.context && typeof res.error.context.json === "function" ? await res.error.context.json() : null; } catch (e) { /* not JSON */ }
        throw { code: (body && body.code) || (isNetErr(res.error) ? "upstream_error" : "upstream_error"), message: (body && body.message) || res.error.message };
      }
      return res.data;
    },
    async limits() { return { maxPromptBytes: 262144, images: { maxCount: 8, maxInputBytes: 20e6, mediaTypes: ["image/jpeg", "image/png", "image/webp", "image/gif"] } }; }
  };
  return fn;
}
