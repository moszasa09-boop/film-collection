// Band sync on the public link (Supabase), three people on three devices: owner, editor, viewer.
// Uses the app built with a test cloud.json, a fake Supabase (fake-supabase.js + fake-backend.js) and a
// local http server, so sign-in, invites, live sync, conflicts, the offline outbox, image reading and
// offline gigs run end to end in Chromium. The SQL rules themselves are tested by supabase/tests/run.sh.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const createFakeBackend = require('./fake-backend');
const ROOT = path.resolve(__dirname, '..');
const OUTDIR = fs.mkdtempSync('/tmp/chordscroll-cloud-');
execFileSync('python3', ['-I', path.join(ROOT, 'build.py'), '--cloud', path.join(__dirname, 'cloud.test.json'), '--out', path.join(OUTDIR, 'index.html')]);
fs.copyFileSync(path.join(ROOT, 'sw.js'), path.join(OUTDIR, 'sw.js'));
const PORT = 8766, BASE = `http://127.0.0.1:${PORT}/`;
const FAKE = fs.readFileSync(path.join(__dirname, 'fake-supabase.js'), 'utf8');
const results = [];
let section = '';
const ok = (c, m) => { results.push([!!c, section + m]); console.log((c ? 'PASS ' : 'FAIL ') + section + m); };
async function step(name, fn) { try { await fn(); } catch (e) { ok(false, name + ' threw: ' + String(e && e.message || e).split('\n')[0]); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: OUTDIR, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();
  const backend = createFakeBackend();
  const errs = [];
  async function person(name) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.exposeBinding('__fakeBackend', (src, method, args) => backend.handle(src.page, method, args));
    await ctx.addInitScript(FAKE);
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(name + ': ' + e.message));
    return { ctx, page, name };
  }
  async function signIn(p, email) {
    await p.waitForSelector('[data-signin]');
    await p.click('[data-signin]');
    await p.fill('#si-email', email); await p.click('#si-go'); await sleep(200);
    await p.fill('#si-code', '123456');
    await Promise.all([p.waitForNavigation({ timeout: 10000 }).catch(() => {}), p.click('#si-go')]);
    await sleep(900);
  }
  const S = (p, fn, arg) => p.evaluate(fn, arg);
  const mode = p => S(p, () => ({ mode: ChordApp.Store.mode, role: typeof Cloud !== 'undefined' ? Cloud.role : null, songs: ChordApp.Store.songs.size, events: ChordApp.Store.events.size, want: { songs: BUILTIN.songs.length, events: BUILTIN.events.length, items: BUILTIN.items.length } }));
  try {
    const O = await person('owner'), E = await person('editor'), V = await person('viewer');

    section = '[sign-in] ';
    let BAND = null;
    await step('owner signs in and creates the band', async () => {
      await O.page.goto(BASE); await sleep(900);
      const m0 = await mode(O.page);
      ok(m0.mode === 'device' && m0.songs === m0.want.songs && m0.events === m0.want.events, 'before signing in, the app works on this device with the starter songs');
      ok(await O.page.isVisible('[data-signin]'), 'offers to sign in to work with the band');
      await signIn(O.page, 'owner@band.test');
      ok((await O.page.textContent('main')).includes('ยังไม่มีวง'), 'signed in without a band: asks to create one or use an invite');
      await O.page.goto(BASE + '#data'); await sleep(500);
      ok(await O.page.isChecked('#cb-copy'), 'offers to bring this device’s songs into the new band');
      await O.page.click('#cb-create'); await O.page.fill('#pt-v', 'วงทดสอบ');
      await Promise.all([O.page.waitForNavigation({ timeout: 10000 }).catch(() => {}), O.page.click('#pt button[type=submit]')]);
      await sleep(2800);
      const m = await mode(O.page);
      BAND = backend.db.bands[0] && backend.db.bands[0].id;
      ok(m.mode === 'cloud' && m.role === 'owner', 'now working on the band as its owner');
      const docs = backend.db.docs.filter(d => d.band_id === BAND);
      ok(docs.filter(d => d.col === 'songs').length === m.want.songs && docs.filter(d => d.col === 'events').length === m.want.events && docs.filter(d => d.col === 'items').length === m.want.items, `this device’s ${m.want.songs} songs and both starter gigs were copied up (${docs.length} documents)`);
      ok((await O.page.textContent('#sync')).includes('ซิงก์กับวงแล้ว'), 'status says synced with the band');
    });

    let EDIT_URL, VIEW_URL;
    await step('owner makes invite links', async () => {
      await O.page.goto(BASE + '#data'); await sleep(700);
      await O.page.click('[data-invite="editor"]'); await sleep(500);
      if (await O.page.isVisible('.scrim')) await O.page.click('.scrim [data-a="c"]');
      await O.page.click('[data-invite="viewer"]'); await sleep(500);
      if (await O.page.isVisible('.scrim')) await O.page.click('.scrim [data-a="c"]');
      const inv = backend.db.band_invites;
      EDIT_URL = BASE + '?join=' + inv.find(i => i.role === 'editor').code;
      VIEW_URL = BASE + '?join=' + inv.find(i => i.role === 'viewer').code;
      ok(inv.length === 2, 'one editor link and one viewer link');
      ok((await O.page.textContent('#cloud-box')).includes('ลิงก์เชิญ'), 'owner sees the active links with copy and cancel');
    });

    section = '[join] ';
    await step('editor and viewer join from the links', async () => {
      await E.page.goto(EDIT_URL); await sleep(800);
      await signIn(E.page, 'guitar@band.test');
      const me = await mode(E.page);
      ok(me.mode === 'cloud' && me.role === 'editor' && me.songs === me.want.songs && me.events === me.want.events, 'editor is in the band and sees all the songs and gigs');
      ok(!(await E.page.evaluate(() => location.search.includes('join'))), 'the invite code is removed from the address bar');
      await V.page.goto(VIEW_URL); await sleep(800);
      await signIn(V.page, 'singer@band.test');
      const mv = await mode(V.page);
      ok(mv.mode === 'cloud' && mv.role === 'viewer' && mv.songs === mv.want.songs, 'viewer is in the band and sees the songs');
      ok((await V.page.textContent('main')).includes('ผู้ดู'), 'viewer is told they can only view');
      ok(!(await V.page.$('#new-event')), 'viewer has no create button');
    });

    section = '[sync] ';
    const ITD = () => 'e9adc0d877e2';   // เบรค 2
    await step('changes show up on the other devices', async () => {
      const ev = ITD();
      const it = backend.db.docs.find(d => d.col === 'items' && d.data.eventId === ev);
      await O.page.evaluate(id => patchItem(id, { singer: 'นุ่น', bpm: 101 }), it.id); await sleep(700);
      const seenE = await S(E.page, id => ChordApp.Store.items.get(id), it.id), seenV = await S(V.page, id => ChordApp.Store.items.get(id), it.id);
      ok(seenE.singer === 'นุ่น' && seenE.bpm === 101 && seenV.singer === 'นุ่น', 'owner’s change appears live on the editor’s and viewer’s phones');
      await E.page.evaluate(() => createEvent({ name: 'งานจากมือกีตาร์', date: '2026-12-24' })); await sleep(700);
      ok(await S(O.page, () => [...ChordApp.Store.events.values()].some(e => e.name === 'งานจากมือกีตาร์')), 'editor’s new gig appears for the owner');
      // two people change different fields of the same row at once: both survive
      await Promise.all([O.page.evaluate(id => patchItem(id, { note: 'โน้ตเจ้าของ' }), it.id), E.page.evaluate(id => patchItem(id, { capo: 2 }), it.id)]);
      await sleep(800);
      const both = backend.db.docs.find(d => d.id === it.id).data;
      ok(both.note === 'โน้ตเจ้าของ' && both.capo === 2 && both.singer === 'นุ่น', 'two people editing different settings of one song at the same time: both kept');
    });

    await step('the same song saved by two people', async () => {
      const sid = backend.db.docs.find(d => d.col === 'songs').id;
      await O.page.goto(BASE + '#edit-' + sid); await sleep(500);
      await E.page.goto(BASE + '#edit-' + sid); await sleep(500);
      await O.page.fill('#ed-title', 'ชื่อจากเจ้าของ'); await O.page.click('#ed-save'); await sleep(900);
      await E.page.fill('#ed-title', 'ชื่อจากมือกีตาร์'); await E.page.click('#ed-save'); await sleep(900);
      ok(await E.page.isVisible('.scrim [data-a="new"]'), 'the later save is stopped and asks what to keep');
      await E.page.click('.scrim [data-a="new"]'); await sleep(900);
      const titles = backend.db.docs.filter(d => d.col === 'songs').map(d => d.data.title);
      ok(titles.includes('ชื่อจากเจ้าของ') && titles.includes('ชื่อจากมือกีตาร์ (ฉบับของฉัน)'), 'both versions are kept on the server, nothing lost');
      ok(backend.db.doc_audit.some(a => a.id === sid && a.op === 'update'), 'the server audit trail kept the version before the change');
    });

    section = '[offline] ';
    await step('writes wait while offline and are sent later, even after a reload', async () => {
      const it = backend.db.docs.find(d => d.col === 'items' && d.data.eventId === ITD());
      await E.page.goto(BASE + '#event-' + ITD()); await sleep(500);
      await E.page.evaluate(() => { window.__fakeOffline = true; });
      await E.page.evaluate(id => { patchItem(id, { singer: 'เขียนตอนออฟไลน์' }); }, it.id); await sleep(500);
      ok((await E.page.textContent('#sync')).includes('รอส่ง') || (await E.page.textContent('#sync')).includes('กำลังส่ง'), 'status shows the write is waiting: ' + await E.page.textContent('#sync'));
      ok(backend.db.docs.find(d => d.id === it.id).data.singer !== 'เขียนตอนออฟไลน์', 'not on the server yet');
      ok((await S(E.page, id => ChordApp.Store.items.get(id).singer, it.id)) === 'เขียนตอนออฟไลน์', 'but already shown on this phone');
      await E.page.reload(); await sleep(1500);   // the network is back after the reload
      ok(backend.db.docs.find(d => d.id === it.id).data.singer === 'เขียนตอนออฟไลน์', 'after reloading online, the waiting write reached the server');
      await sleep(400);
      ok((await S(O.page, id => ChordApp.Store.items.get(id).singer, it.id)) === 'เขียนตอนออฟไลน์', 'and the owner sees it');
    });

    await step('a prepared gig opens and plays with no internet', async () => {
      await E.page.goto(BASE + '#event-' + ITD()); await sleep(600);
      await E.page.click('.offline-state [data-offline]'); await sleep(2500);
      ok((await E.page.textContent('.toast')).includes('พร้อมเล่นออฟไลน์'), 'gig prepared for offline: ' + await E.page.textContent('.toast'));
      await E.page.evaluate(() => localStorage.setItem('__fakeOffline', '1'));
      await E.ctx.setOffline(true);
      await E.page.reload(); await sleep(1800);
      const m = await mode(E.page);
      ok(m.mode === 'cloud' && m.events >= m.want.events && m.songs >= m.want.songs, 'band data comes from this phone’s copy');
      ok((await E.page.textContent('#sync')).includes('ออฟไลน์'), 'status says offline');
      const first = await S(E.page, id => eventItems(id).find(i => !isBreak(i)).id, ITD());
      await E.page.goto(BASE + `#play-${ITD()}-${first}`); await sleep(500);
      await E.page.click('#play'); await sleep(2000);
      ok(await E.page.evaluate(() => ChordApp.P.playing || ChordApp.P.cur > 0 || !!document.querySelector('.countin')), 'a song plays offline');
      await E.ctx.setOffline(false);
      await E.page.evaluate(() => localStorage.removeItem('__fakeOffline'));
      await E.page.reload(); await sleep(1200);
    });

    section = '[roles] ';
    await step('viewer cannot write; owner changes roles and removes people', async () => {
      const it = backend.db.docs.find(d => d.col === 'items' && d.data.eventId === ITD());
      const before = JSON.stringify(backend.db.docs.find(d => d.id === it.id).data);
      await V.page.evaluate(id => patchItem(id, { singer: 'แอบแก้' }), it.id); await sleep(400);
      await V.page.evaluate(id => ChordApp.Store.db.doc('items/' + id).set({ hacked: true }).catch(() => {}), it.id); await sleep(500);
      ok(JSON.stringify(backend.db.docs.find(d => d.id === it.id).data) === before, 'viewer’s writes are refused by the server');
      await O.page.goto(BASE + '#data'); await sleep(800);
      const vid = backend.db.band_members.find(m => m.role === 'viewer').user_id;
      await O.page.selectOption(`[data-role="${vid}"]`, 'editor'); await sleep(600);
      await V.page.reload(); await sleep(1200);
      ok((await mode(V.page)).role === 'editor', 'owner promoted the viewer to editor');
      const eid = backend.db.band_members.find(m => m.user_id !== vid && m.role === 'editor').user_id;
      await O.page.goto(BASE + '#data'); await sleep(800);
      await O.page.click(`[data-remove="${eid}"]`); await O.page.click('.scrim [data-a="yes"]'); await sleep(600);
      await E.page.goto(BASE + '#'); await E.page.reload(); await sleep(1200);
      const me = await mode(E.page);
      ok(me.mode === 'device', 'removed member no longer gets the band’s data');
      ok((await E.page.textContent('main')).includes('ยังไม่มีวง'), 'and is told they are not in a band');
      ok(await E.page.evaluate(() => !Object.keys(localStorage).some(k => k.startsWith('chordscroll-cloud:') && !k.endsWith(':outbox') && !k.startsWith('chordscroll-cloud-bands'))), 'the band’s data cached on the removed member’s phone is deleted');
      const oid = backend.db.band_members.find(m => m.role === 'owner').user_id;
      const r = await O.page.evaluate(([b, u]) => Cloud.sb.rpc('set_member_role', { p_band: b, p_user: u, p_role: 'viewer' }), [BAND, oid]);
      ok(r.error && /owner/.test(r.error.message), 'the last owner cannot step down');
    });

    section = '[pictures] ';
    await step('read a chord sheet from a picture through the band', async () => {
      await V.page.goto(BASE + '#new-image'); await sleep(700);   // V is an editor now
      const shot = await V.page.screenshot({ clip: { x: 0, y: 0, width: 300, height: 200 } });
      await V.page.setInputFiles('#ed-file', [{ name: 'a.png', mimeType: 'image/png', buffer: shot }, { name: 'b.png', mimeType: 'image/png', buffer: shot }]);
      await V.page.click('#ed-read'); await sleep(1500);
      ok(backend.ocrCalls.length === 1 && backend.ocrCalls[0].images === 2, 'both pictures went to the band’s reader in one request');
      ok((await V.page.inputValue('#ed-title')) === 'เพลงจากรูปคลาวด์' && (await V.page.$$('#pv-sheet .unclear')).length === 2, 'result fills the editor with the unclear spots marked');
      await V.page.click('#ed-save'); await sleep(900);
      ok(backend.db.docs.some(d => d.col === 'songs' && d.data.title === 'เพลงจากรูปคลาวด์' && d.data.sourceCheck === 'unchecked'), 'saved to the band as not yet checked');
    });

    section = '[accounts] ';
    await step('signing out leaves nothing of the band behind in the app', async () => {
      await O.page.goto(BASE + '#data'); await sleep(600);
      await Promise.all([O.page.waitForNavigation({ timeout: 10000 }).catch(() => {}), O.page.click('#cb-out')]);
      await sleep(1000);
      const m = await mode(O.page);
      ok(m.mode === 'device' && !(await S(O.page, () => [...ChordApp.Store.songs.values()].some(s => s.title === 'ชื่อจากเจ้าของ'))), 'after signing out the page shows only this device’s own data, not the band’s');
      ok(await O.page.isVisible('[data-signin]'), 'and offers to sign in again');
      ok(await O.page.evaluate(() => !Object.keys(localStorage).some(k => k.startsWith('chordscroll-cloud:'))), 'no copy of the band’s data is left in this browser');
    });
    ok(!errs.length, 'no script errors: ' + errs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.kill();
  }
  const fails = results.filter(r => !r[0]).length;
  console.log(fails ? `\n${fails} FAILED of ${results.length}` : `\nALL ${results.length} PASSED`);
  process.exit(fails ? 1 : 0);
})();
