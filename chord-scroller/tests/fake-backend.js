// Node side of the Supabase test double (see fake-supabase.js). One instance is the "server" shared by
// every browser context in a test run. Rules follow supabase/migrations/*.sql.
module.exports = function createFakeBackend() {
  const db = { users: new Map(), otp: new Map(), bands: [], band_members: [], band_invites: [], docs: [], doc_audit: [], ocr_log: [] };
  const pages = new Map();          // page → uid, for realtime delivery
  const ocrCalls = [];
  let ocrResult = null;
  const rid = () => Math.random().toString(16).slice(2, 14);
  const role = (band, uid) => { const m = db.band_members.find(r => r.band_id === band && r.user_id === uid); return m ? m.role : null; };
  const canWrite = (band, uid) => ["owner", "editor"].includes(role(band, uid));
  const ok = data => ({ data, error: null });
  const err = (code, message, body) => ({ data: null, error: { code, message, body } });
  const clone = x => JSON.parse(JSON.stringify(x));
  async function broadcast(eventType, n, o) {
    const band = (n || o).band_id;
    for (const [page, uid] of pages) {
      if (page.isClosed()) { pages.delete(page); continue; }
      if (!role(band, uid)) continue;   // realtime respects row level security
      try { await page.evaluate(c => window.__fakeRealtime && window.__fakeRealtime(c), { band, payload: { eventType, new: n ? clone(n) : {}, old: o ? clone(o) : {} } }); } catch (e) { /* page navigating */ }
    }
  }
  const broadcastSoon = (...a) => setTimeout(() => broadcast(...a), 5);
  function audit(row, op, uid) { db.doc_audit.push({ ...clone(row), op, changed_by: uid, at: Date.now() }); }
  const match = (r, filters) => filters.every(([c, v]) => r[c] === v);
  const visible = (table, r, uid) => table === "docs" || table === "band_members" ? !!role(r.band_id, uid)
    : table === "bands" ? !!role(r.id, uid) : table === "band_invites" ? role(r.band_id, uid) === "owner" : table === "ocr_log" ? r.user_id === uid : true;

  async function query(q, uid) {
    const rows = db[q.table];
    if (q.op === "select") {
      let out = rows.filter(r => visible(q.table, r, uid) && match(r, q.filters)).map(clone);
      if (q.table === "band_members" && /bands\(name\)/.test(q.cols)) out = out.map(r => ({ ...r, bands: { name: (db.bands.find(b => b.id === r.band_id) || {}).name } }));
      if (q.range) out = out.slice(q.range[0], q.range[1] + 1);
      return ok(q.single ? out[0] || null : out);
    }
    if (q.table === "docs" && q.op === "upsert") {
      const p = q.payload;
      if (!canWrite(p.band_id, uid)) return err("42501", "new row violates row-level security policy for table \"docs\"");
      const cur = rows.find(x => x.band_id === p.band_id && x.col === p.col && x.id === p.id);
      if (cur) { audit(cur, "update", uid); const old = clone(cur); cur.data = clone(p.data); cur.version++; cur.updated_by = uid; broadcastSoon("UPDATE", cur, old); }
      else { const n = { band_id: p.band_id, col: p.col, id: p.id, data: clone(p.data), version: 1, updated_by: uid }; rows.push(n); broadcastSoon("INSERT", n, null); }
      return ok(null);
    }
    if (q.table === "docs" && q.op === "delete") {
      for (const r of rows.filter(r => match(r, q.filters) && canWrite(r.band_id, uid))) { audit(r, "delete", uid); db.docs.splice(db.docs.indexOf(r), 1); broadcastSoon("DELETE", null, r); }
      return ok(null);
    }
    if (q.op === "update") {
      for (const r of rows.filter(r => match(r, q.filters))) {
        if (q.table === "band_members" && (r.user_id !== uid || Object.keys(q.payload).some(k => k !== "display_name"))) continue;
        if (q.table === "bands" && role(r.id, uid) !== "owner") continue;
        Object.assign(r, q.payload);
      }
      return ok(null);
    }
    if (q.op === "insert" && q.table === "ocr_log") { if (!canWrite(q.payload.band_id, uid)) return err("42501", "rls"); rows.push({ ...q.payload, user_id: uid }); return ok(null); }
    return err("0A000", "unsupported in fake: " + q.table + " " + q.op);
  }

  async function rpc(name, a, uid) {
    if (!uid) return err("28000", "sign in first");
    if (name === "create_band") { const id = rid(); db.bands.push({ id, name: a.p_name }); db.band_members.push({ band_id: id, user_id: uid, role: "owner", display_name: a.p_display_name || "", joined_at: Date.now() }); return ok(id); }
    if (name === "band_role") return ok(role(a.p_band, uid));
    if (name === "create_invite") { if (role(a.p_band, uid) !== "owner") return err("42501", "only the band owner can invite"); const code = rid() + rid(); db.band_invites.push({ code, band_id: a.p_band, role: a.p_role, expires_at: new Date(Date.now() + 14 * 864e5).toISOString(), uses: 0, max_uses: 20 }); return ok(code); }
    if (name === "revoke_invite") { db.band_invites = db.band_invites.filter(i => !(i.code === a.p_code && role(i.band_id, uid) === "owner")); return ok(null); }
    if (name === "accept_invite") {
      const inv = db.band_invites.find(i => i.code === a.p_code);
      if (!inv || inv.uses >= inv.max_uses) return err("P0002", "invite link is invalid or expired");
      const cur = db.band_members.find(m => m.band_id === inv.band_id && m.user_id === uid);
      if (!cur) db.band_members.push({ band_id: inv.band_id, user_id: uid, role: inv.role, display_name: a.p_display_name || "", joined_at: Date.now() });
      else if (cur.role === "viewer" && inv.role === "editor") cur.role = "editor";
      inv.uses++; return ok(inv.band_id);
    }
    if (name === "set_member_role") {
      if (role(a.p_band, uid) !== "owner") return err("42501", "only the band owner can change roles");
      const t = db.band_members.find(m => m.band_id === a.p_band && m.user_id === a.p_user);
      if (t.role === "owner" && a.p_role !== "owner" && db.band_members.filter(m => m.band_id === a.p_band && m.role === "owner").length <= 1) return err("23514", "a band needs at least one owner");
      t.role = a.p_role; return ok(null);
    }
    if (name === "remove_member") {
      if (a.p_user !== uid && role(a.p_band, uid) !== "owner") return err("42501", "only the band owner can remove members");
      const t = db.band_members.find(m => m.band_id === a.p_band && m.user_id === a.p_user);
      if (t && t.role === "owner" && db.band_members.filter(m => m.band_id === a.p_band && m.role === "owner").length <= 1) return err("23514", "a band needs at least one owner");
      db.band_members = db.band_members.filter(m => !(m.band_id === a.p_band && m.user_id === a.p_user)); return ok(null);
    }
    if (name === "put_doc_if") {
      const r = db.docs.find(x => x.band_id === a.p_band && x.col === a.p_col && x.id === a.p_id && role(x.band_id, uid));
      if (!r) return ok({ ok: false, missing: true });
      if ((r.data.rev || 0) !== a.p_expected_rev) return ok({ ok: false, current: clone(r.data) });
      if (!canWrite(a.p_band, uid)) return err("42501", "not allowed");
      audit(r, "update", uid); const old = clone(r); r.data = clone(a.p_data); r.version++; broadcastSoon("UPDATE", r, old);
      return ok({ ok: true, version: r.version });
    }
    if (name === "merge_doc") {
      const r = db.docs.find(x => x.band_id === a.p_band && x.col === a.p_col && x.id === a.p_id);
      if (!r || !canWrite(a.p_band, uid)) return err("P0002", "document does not exist or not allowed");
      audit(r, "update", uid); const old = clone(r); r.data = { ...r.data, ...clone(a.p_patch) }; r.version++; broadcastSoon("UPDATE", r, old);
      return ok(r.version);
    }
    if (name === "ocr_allowance") return ok(40);
    return err("42883", "function does not exist: " + name);
  }

  async function handle(page, method, args) {
    const uid = args.uid;
    if (method === "otp") { db.otp.set(args.email, "123456"); return ok({}); }
    if (method === "verify") {
      if (db.otp.get(args.email) !== args.token) return err("401", "Token has expired or is invalid");
      if (!db.users.has(args.email)) db.users.set(args.email, "u_" + rid());
      return ok({ id: db.users.get(args.email), email: args.email });
    }
    if (method === "hello") { pages.set(page, uid); return ok(null); }
    if (uid) pages.set(page, uid);
    if (method === "query") return query(args, uid);
    if (method === "rpc") return rpc(args.name, args.args || {}, uid);
    if (method === "fn") {
      const b = args.body;
      if (!canWrite(b.bandId, uid)) return { data: null, error: { message: "403", body: { code: "not_granted", message: "only owners and editors" } } };
      ocrCalls.push({ images: b.images.length, tiled: b.tiled, bytes: b.images.map(i => i.data.length) });
      return ok(ocrResult || { title: "เพลงจากรูปคลาวด์", artist: "วงทดสอบ", bpm: 88, text: "[G]ฟ้า [D]ใส\n[Em?]หม่น {?หมอง}\n", unclear: [{ line: 2, what: "Em หรือ Em7" }], notes: "" });
    }
    return err("0A000", "unknown method " + method);
  }
  return { handle, db, ocrCalls, setOcrResult: r => { ocrResult = r; }, role };
};
