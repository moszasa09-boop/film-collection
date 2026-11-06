// Browser side of the Supabase test double used by tests/cloud.js. supabase-js calls are forwarded to a
// fake backend in the test runner (window.__fakeBackend, a Playwright binding), which follows the rules in
// supabase/migrations/*.sql: roles, row level security, put_doc_if, merge_doc, invites. Each browser
// context is a different person; all of them share the backend like members of one band.
// The real rules are tested on PostgreSQL by supabase/tests/run.sh.
(() => {
  window.__fakeOffline = localStorage.getItem("__fakeOffline") === "1";   // lets a test reload a page "offline"
  const NET = { message: "TypeError: Failed to fetch" };
  const channels = [];
  window.__fakeRealtime = change => {
    for (const ch of channels) for (const h of ch.handlers) {
      if (h.filter && h.filter !== "band_id=eq." + change.band) continue;
      h.cb(change.payload);
    }
  };
  function createClient(url, key, opts) {
    const storageKey = (opts && opts.auth && opts.auth.storageKey) || "sb";
    const authListeners = [];
    const session = () => { try { return JSON.parse(localStorage.getItem(storageKey)); } catch (e) { return null; } };
    const uid = () => { const s = session(); return s && s.user ? s.user.id : null; };
    const call = async (method, args) => {
      if (window.__fakeOffline) return { data: null, error: NET };
      return window.__fakeBackend(method, { ...args, uid: uid() });
    };
    const auth = {
      async getSession() { return { data: { session: session() }, error: null }; },
      onAuthStateChange(cb) { authListeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithOtp({ email }) { return call("otp", { email }); },
      async verifyOtp({ email, token }) {
        const r = await call("verify", { email, token });
        if (r.error) return r;
        const s = { access_token: "fake", user: r.data };
        localStorage.setItem(storageKey, JSON.stringify(s));
        authListeners.forEach(cb => cb("SIGNED_IN", s));
        return { data: { session: s }, error: null };
      },
      async signOut() { localStorage.removeItem(storageKey); authListeners.forEach(cb => cb("SIGNED_OUT", null)); return { error: null }; }
    };
    function from(table) {
      const q = { table, op: "select", filters: [], range: null, single: false, cols: "*", payload: null };
      const b = {
        select(c) { q.cols = c || "*"; return b; }, eq(c, v) { q.filters.push([c, v]); return b; }, order() { return b; },
        range(a, z) { q.range = [a, z]; return b; }, maybeSingle() { q.single = true; return b; },
        upsert(p) { q.op = "upsert"; q.payload = p; return b; }, update(p) { q.op = "update"; q.payload = p; return b; },
        insert(p) { q.op = "insert"; q.payload = p; return b; }, delete() { q.op = "delete"; return b; },
        then(res, rej) { return call("query", q).then(res, rej); }
      };
      return b;
    }
    const rpc = (name, args) => call("rpc", { name, args });
    function channel(name) {
      const ch = { name, handlers: [], on(kind, f, cb) { ch.handlers.push({ filter: f.filter, cb }); return ch; },
        subscribe(cb) { channels.push(ch); call("hello", {}).then(() => cb && cb("SUBSCRIBED")); return ch; } };
      return ch;
    }
    const functions = {
      async invoke(fname, { body }) {
        const r = await call("fn", { fname, body });
        if (r.error && r.error.body) { const body2 = r.error.body; return { data: null, error: { message: r.error.message, context: { json: async () => body2 } } }; }
        return r;
      }
    };
    return { auth, from, rpc, channel, removeChannel() {}, functions };
  }
  // the page's own copy of supabase-js assigns window.supabase later; keep the fake in place
  const fake = { createClient };
  Object.defineProperty(window, "supabase", { configurable: true, get: () => fake, set: () => {} });
})();
