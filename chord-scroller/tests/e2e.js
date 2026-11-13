// End-to-end checks in a real browser (Chromium via Playwright), clicking through the app like a person.
// Part A: public link / device mode (no claude.ai).  Part B: claude.ai shared mode with a test double
// for the database, user, Claude image reading and downloads (tests/mock-claude.js).
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '../index.html');
const MOCK = fs.readFileSync(path.join(__dirname, 'mock-claude.js'), 'utf8');
const SHOTS = process.argv[2] || null;
const results = [];
let section = '';
const ok = (c, m) => { results.push([!!c, section + m]); console.log((c ? 'PASS ' : 'FAIL ') + section + m); };
async function step(name, fn) { try { await fn(); } catch (e) { ok(false, name + ' threw: ' + (e && e.message || e).split('\n')[0]); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const yes = async p => { await p.click('.scrim [data-a="yes"]'); await sleep(150); };
const st = (p, fn, arg) => p.evaluate(fn, arg);
async function fitsWidth(p, w) {
  return p.evaluate(w => {
    const over = [];
    if (document.documentElement.scrollWidth > w) over.push('page ' + document.documentElement.scrollWidth);
    document.querySelectorAll('.player button, .player a, .bar button, .bar a, .player input').forEach(el => {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > w + 0.5 || r.left < -0.5)) over.push((el.id || el.textContent.trim().slice(0, 10)) + ' ' + Math.round(r.right));
    });
    return over;
  }, w);
}

(async () => {
  const browser = await browser_launch();
  async function browser_launch() { return chromium.launch(); }

  /* ===================== A. public link: device mode ===================== */
  section = '[device] ';
  const ctxA = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true, hasTouch: false });
  const a = await ctxA.newPage();
  const errsA = [];
  a.on('pageerror', e => errsA.push(e.message));
  a.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_/.test(m.text())) errsA.push(m.text()); });
  await a.goto(FILE); await a.waitForSelector('.event-card'); await sleep(300);
  let itd = null, evId = null;

  await step('first open', async () => {
    const s = await st(a, () => ({ songs: ChordApp.Store.songs.size, events: ChordApp.Store.events.size, items: ChordApp.Store.items.size, mode: ChordApp.Store.mode }));
    const want = await st(a, () => ({ songs: BUILTIN.songs.length, events: BUILTIN.events.length, items: BUILTIN.items.length }));
    ok(s.mode === 'device' && s.songs === want.songs && s.events === want.events && s.items === want.items, 'first open copies the starter songs and gigs (เบรค 1, เบรค 2) ' + JSON.stringify(s));
    itd = 'e9adc0d877e2';   // เบรค 2, the gig that was called ITD
    ok((await a.textContent('#sync')).includes('เก็บในเครื่องนี้'), 'status says data is kept on this device');
  });

  await step('create gig', async () => {
    await a.click('#new-event');
    await a.click('#ev-form button[type=submit]');
    ok((await a.textContent('#ev-err')).includes('ใส่ชื่องาน'), 'empty gig name is refused');
    await a.fill('#ev-name', 'งานแต่ง ธ.ค.'); await a.fill('#ev-slot', '0');
    await a.click('#ev-form button[type=submit]');
    ok((await a.textContent('#ev-err')).includes('1–1440'), 'show length 0 minutes is refused');
    await a.fill('#ev-slot', '45'); await a.fill('#ev-date', '2026-12-20'); await a.fill('#ev-venue', 'โรงแรมริมน้ำ'); await a.fill('#ev-note', 'แต่งชุดขาว');
    await a.click('#ev-form button[type=submit]'); await sleep(300);
    evId = (await a.evaluate(() => location.hash)).replace('#event-', '');
    const ev = await st(a, id => ChordApp.Store.events.get(id), evId);
    ok(ev && ev.name === 'งานแต่ง ธ.ค.' && ev.date === '2026-12-20' && ev.slotMinutes === 45 && ev.sets.length === 1, 'gig saved with date, venue, note, planned minutes');
  });

  await step('sets and songs', async () => {
    await a.click('#ev-addset'); await a.fill('#pt-v', 'เพลงสำรอง'); await a.click('#pt button[type=submit]'); await sleep(300);
    ok((await a.$$('.set')).length === 2, 'second set added');
    await a.click('[data-add]');
    for (const q of ['ห้ามใจ', 'ฝากที', 'คุกเข่า']) { await a.fill('#pk-q', q); await a.check('#pk-list input[type=checkbox]'); }
    ok((await a.textContent('[data-a="ok"]')).includes('3'), 'picker counts 3 chosen songs across searches');
    await a.click('.scrim [data-a="ok"]'); await sleep(400);
    const sets = await st(a, id => ChordApp.Store.events.get(id).sets, evId);
    await a.click(`[data-add="${sets[1].id}"]`); await a.fill('#pk-q', 'ก่อนตาย'); await a.check('#pk-list input'); await a.click('.scrim [data-a="ok"]'); await sleep(400);
    const titles = await st(a, id => [...ChordApp.Store.items.values()].filter(i => i.eventId === id).sort((x, y) => x.order - y.order).map(i => ChordApp.Store.songs.get(i.songId).title), evId);
    ok(titles.length === 4, 'four songs placed in the gig ' + titles.join(', '));
    await a.click('[data-add]'); await a.fill('#pk-q', 'ห้ามใจ');
    ok((await a.textContent('#pk-list')).includes('อยู่ในงานนี้แล้ว'), 'picker warns a song is already in the gig');
    await a.click('.scrim [data-a="c"]');
    const totals = await a.textContent('.totals');
    ok(/4\s*เพลง/.test(totals) && totals.includes('เวลางาน'), 'gig shows count, total time and planned minutes');
  });

  await step('per-gig settings', async () => {
    const itemId = await st(a, id => [...ChordApp.Store.items.values()].find(i => i.eventId === id && ChordApp.Store.songs.get(i.songId).title === 'ห้ามใจ').id, evId);
    await a.click(`.item-row [data-itemmenu="${itemId}"]`);
    await a.click('#it-up'); await a.click('#it-up');
    await a.fill('#it-capo', '2'); await a.fill('#it-bpm', '-120');
    await a.click('#it-form button[type=submit]');
    ok((await a.textContent('#it-err')).includes('BPM'), 'negative BPM refused');
    await a.fill('#it-bpm', '100'); await a.fill('#it-singer', 'โม'); await a.fill('#it-note', 'เริ่มช้า ๆ');
    await a.click('#it-form button[type=submit]'); await sleep(300);
    const it = await st(a, id => ChordApp.Store.items.get(id), itemId);
    ok(it.shift === 2 && it.capo === 2 && it.bpm === 100 && it.singer === 'โม' && it.note === 'เริ่มช้า ๆ', 'key +2, capo 2, BPM 100, singer and note saved on this gig ' + JSON.stringify(it));
    const other = await st(a, id => { const s = [...ChordApp.Store.songs.values()].find(x => x.title === 'ห้ามใจ'); return [...ChordApp.Store.items.values()].find(i => i.eventId === id && i.songId === s.id); }, itd);
    const orig = await st(a, id => BUILTIN.items.find(i => i.id === id), other.id);
    ok(other.shift === orig.shift && other.bpm === orig.bpm && other.singer === orig.singer && other.singer === 'คิง (ร้องหลัก)', 'the same song in เบรค 2 keeps its own settings');
    ok((await a.textContent(`[data-item="${itemId}"]`)).includes('F#m') && (await a.textContent(`[data-item="${itemId}"]`)).includes('คาโป้ 2'), 'row shows the gig key F#m and capo');
  });

  const order = () => st(a, id => { const ev = ChordApp.Store.events.get(id); return [...ChordApp.Store.items.values()].filter(i => i.eventId === id).sort((x, y) => (ev.sets.findIndex(s => s.id === x.setId) - ev.sets.findIndex(s => s.id === y.setId)) || x.order - y.order).map(i => ChordApp.Store.songs.get(i.songId).title); }, evId);
  await step('drag to reorder', async () => {
    const before = await order();
    const rows = await a.$$('.set:first-of-type .item-row');
    const h3 = await (await rows[2].$('.handle')).boundingBox();
    const r1 = await rows[0].boundingBox();
    await a.mouse.move(h3.x + h3.width / 2, h3.y + h3.height / 2); await a.mouse.down();
    await a.mouse.move(h3.x + 10, r1.y + 20, { steps: 8 }); await a.mouse.move(h3.x + 10, r1.y + 6, { steps: 4 });
    await a.mouse.up(); await sleep(400);
    const after = await order();
    ok(after[0] === before[2] && after[1] === before[0], `dragged 3rd song to the top: ${before.join(' / ')} → ${after.join(' / ')}`);
    // drag across sets: last song of set 1 into set 2
    const rows2 = await a.$$('.set:first-of-type .item-row');
    const hl = await (await rows2[rows2.length - 1].$('.handle')).boundingBox();
    const target = await (await a.$$('.set'))[1].$('.item-row');
    const tb = await target.boundingBox();
    await a.mouse.move(hl.x + 10, hl.y + 10); await a.mouse.down();
    await a.mouse.move(hl.x + 10, tb.y + tb.height - 6, { steps: 12 }); await a.mouse.up(); await sleep(400);
    const sets = await st(a, id => { const ev = ChordApp.Store.events.get(id); return ev.sets.map(s => [...ChordApp.Store.items.values()].filter(i => i.eventId === id && i.setId === s.id).length); }, evId);
    ok(sets[0] === 2 && sets[1] === 2, 'dragged a song into the other set ' + JSON.stringify(sets));
  });

  await step('move via settings and buttons', async () => {
    const o1 = await order();
    const firstId = await st(a, id => { const ev = ChordApp.Store.events.get(id); return [...ChordApp.Store.items.values()].filter(i => i.eventId === id && i.setId === ev.sets[0].id).sort((x, y) => x.order - y.order)[0].id; }, evId);
    await a.click(`.item-row [data-itemmenu="${firstId}"]`); await a.click('#it-mdown'); await sleep(300);
    const o2 = await order();
    ok(o2[0] === o1[1] && o2[1] === o1[0], 'move down button swaps with the next song');
  });

  await step('reload keeps everything', async () => {
    const o = await order();
    await a.reload(); await sleep(600);
    ok(JSON.stringify(await order()) === JSON.stringify(o), 'order survives reload');
    const it = await st(a, id => [...ChordApp.Store.items.values()].find(i => i.eventId === id && i.bpm === 100), evId);
    ok(!!it && it.capo === 2, 'gig settings survive reload');
  });

  await step('play the gig', async () => {
    const list = await st(a, id => { const ev = ChordApp.Store.events.get(id); return [...ChordApp.Store.items.values()].filter(i => i.eventId === id).sort((x, y) => (ev.sets.findIndex(s => s.id === x.setId) - ev.sets.findIndex(s => s.id === y.setId)) || x.order - y.order).map(i => ({ id: i.id, bpm: i.bpm, title: ChordApp.Store.songs.get(i.songId).title, def: ChordApp.Store.songs.get(i.songId).bpm })); }, evId);
    for (const it of list) {
      await a.goto(FILE + `#play-${evId}-${it.id}`); await sleep(350);
      const bpm = +(await a.textContent('#bpm'));
      ok(bpm === (it.bpm || it.def), `${it.title}: shows this gig's BPM ${bpm}`);
    }
    const ham = list.find(x => x.title === 'ห้ามใจ');
    await a.goto(FILE + `#play-${evId}-${ham.id}`); await sleep(350);
    const meta = await a.textContent('#pl-meta');
    ok(meta.includes('F#m') && meta.includes('คาโป้ 2') && meta.includes('Em') && meta.includes('ร้อง: โม'), 'ห้ามใจ: key F#m, capo 2 shapes Em, singer shown: ' + meta);
    ok((await a.textContent('#sheet .lyr .ch')).trim() === 'Em', 'with +2 and capo 2 the chord shapes read as written (Em)');
    ok((await a.textContent('.song-head')).includes('เริ่มช้า'), 'gig note shown above the song');
    const idx = list.indexOf(ham);
    if (list[idx + 1]) ok((await a.textContent('.player')).includes(list[idx + 1].title) || (await a.getAttribute('a[aria-label^="เพลงถัดไป"]', 'aria-label')).includes(list[idx + 1].title), 'next song is named');
    await a.evaluate(() => { ChordApp.P.bpm = 220; retime(); seekTo(ChordApp.P.total - 0.3); });
    await a.click('#play'); await sleep(1500);
    const card = await a.textContent('#next-card');
    ok(list[idx + 1] ? card.includes('เพลงถัดไป') : card.includes('จบ'), 'end of song offers the next song: ' + card.trim().slice(0, 60));
    if (list[idx + 1]) { await a.click('#next-card a'); await sleep(350); ok((await a.evaluate(() => location.hash)).includes(list[idx + 1].id), 'next-song button opens the next song'); }
    // player changes are saved to this gig only
    await a.goto(FILE + `#play-${evId}-${list[0].id}`); await sleep(300);
    await a.click('#bpm-up'); await sleep(1300);
    const saved = await st(a, id => ChordApp.Store.items.get(id).bpm, list[0].id);
    ok(saved === (list[0].bpm || list[0].def) + 2, 'BPM changed in the player is saved to this gig item');
    await a.click('#stage'); await sleep(200);
    ok(await a.evaluate(() => document.body.classList.contains('stage')), 'stage mode turns on');
    await a.click('#stage');
  });

  await step('small screens (QA-01)', async () => {
    for (const [w, h] of [[320, 568], [360, 740]]) {
      await a.setViewportSize({ width: w, height: h });
      for (const hash of ['', `#event-${evId}`, `#play-${evId}-${await st(a, id => [...ChordApp.Store.items.values()].find(i => i.eventId === id).id, evId)}`, '#library', '#data', '#new-text']) {
        await a.goto(FILE + hash); await sleep(250);
        const over = await fitsWidth(a, w);
        ok(!over.length, `${w}px ${hash || 'home'} fits: ${over.join(', ')}`);
      }
    }
    if (SHOTS) { await a.goto(FILE + `#play-${evId}-${await st(a, id => [...ChordApp.Store.items.values()].find(i => i.eventId === id).id, evId)}`); await sleep(300); await a.screenshot({ path: SHOTS + '/e2e-320-player.png' }); }
    await a.setViewportSize({ width: 390, height: 844 });
  });

  await step('duplicate and delete gig', async () => {
    await a.goto(FILE + `#event-${evId}`); await sleep(300);
    await a.click('#ev-dup'); await sleep(600);
    const dup = (await a.evaluate(() => location.hash)).replace('#event-', '');
    const n = await st(a, id => [...ChordApp.Store.items.values()].filter(i => i.eventId === id).length, dup);
    ok(dup !== evId && n === 4, 'copy has the same 4 songs');
    await a.click('#ev-del'); await yes(a); await sleep(400);
    const gone = await st(a, id => !ChordApp.Store.events.has(id) && ![...ChordApp.Store.items.values()].some(i => i.eventId === id), dup);
    ok(gone && (await st(a, id => ChordApp.Store.events.has(id), evId)) && (await st(a, () => ChordApp.Store.songs.size === BUILTIN.songs.length)), 'deleting the copy leaves the original gig and the library alone');
  });

  let newSongId = null;
  await step('add a song by text', async () => {
    await a.goto(FILE + '#new-text'); await sleep(300);
    await a.click('#ed-save'); await sleep(200);
    ok((await a.textContent('#ed-issues')).includes('ใส่ชื่อเพลง'), 'empty song cannot be saved');
    await a.fill('#ed-title', 'ทดสอบแปะเนื้อ'); await a.fill('#ed-bpm', '96');
    await a.fill('#ed-text', 'Am        G\nเธอคือความฝัน\n\n[Xq]ผิด');
    await sleep(300);
    ok(await a.isVisible('#ed-convert'), 'offers to convert chords written above the lyrics');
    await a.click('#ed-convert'); await sleep(200);
    ok((await a.inputValue('#ed-text')).startsWith('[Am]เธอคือความ[G]ฝัน'), 'converted to inline chords: ' + (await a.inputValue('#ed-text')).split('\n')[0]);
    ok((await a.textContent('#ed-issues')).includes('Xq'), 'a wrong chord is reported');
    await a.click('#ed-save'); await sleep(200);
    ok((await a.evaluate(() => location.hash)) === '#new-text', 'wrong chord blocks saving');
    await a.fill('#ed-text', (await a.inputValue('#ed-text')).replace('[Xq]ผิด', '[C]จริงนะ {?ฮัม}')); await sleep(300);
    ok(await a.isDisabled('#ed-src'), 'cannot mark as checked while a {? } mark remains');
    ok((await a.$$('#pv-sheet .unclear')).length === 1, 'preview highlights the unclear word');
    await a.click('#ed-save'); await sleep(500);
    newSongId = (await a.evaluate(() => location.hash)).replace('#song-', '');
    const s = await st(a, id => ChordApp.Store.songs.get(id), newSongId);
    ok(s && s.title === 'ทดสอบแปะเนื้อ' && s.bpm === 96 && s.sourceCheck === 'unchecked', 'song saved and opened in the player');
    await a.goto(FILE + '#library'); await sleep(200);
    await a.fill('#q', 'แปะ'); await sleep(150);
    ok((await a.textContent('#lib-list')).includes('อ่านไม่ชัด 1 จุด'), 'library shows the unclear mark count');
    await a.click('[data-f="unclear"]'); ok((await a.$$('#lib-list .item-row')).length === 1, 'filter “มีจุดอ่านไม่ชัด” finds it');
  });

  await step('duplicates and unsaved work', async () => {
    await a.goto(FILE + '#new-text'); await sleep(250);
    await a.fill('#ed-title', 'ห้ามใจ'); await a.fill('#ed-artist', 'Bodyslam'); await a.fill('#ed-text', '[G]ทดสอบ'); await sleep(300);
    ok((await a.textContent('#ed-issues')).includes('มีเพลง'), 'warns the song already exists');
    ok(await a.isVisible('[data-usedup]'), 'offers to update the existing song instead');
    await a.click('.bar a.icon-btn'); await sleep(250);
    ok(await a.isVisible('.scrim'), 'leaving with unsaved text asks first');
    await a.click('.scrim [data-a="no"]'); await sleep(200);
    ok((await a.evaluate(() => location.hash)) === '#new-text' && (await a.inputValue('#ed-title')) === 'ห้ามใจ', 'cancel keeps the typed text');
    await a.click('.bar a.icon-btn'); await sleep(200); await yes(a); await sleep(300);
    ok((await a.evaluate(() => location.hash)) === '#library', 'confirm leaves without saving');
  });

  await step('two tabs edit at once', async () => {
    const b2 = await ctxA.newPage(); await b2.goto(FILE + '#library'); await sleep(500);
    const ids = await st(a, id => [...ChordApp.Store.items.values()].filter(i => i.eventId === id).map(i => i.id), itd);
    await Promise.all([
      a.evaluate(id => patchItem(id, { singer: 'แท็บ A' }), ids[0]),
      b2.evaluate(id => patchItem(id, { singer: 'แท็บ B' }), ids[1])
    ]);
    await sleep(400);
    const s = await st(a, ids => ids.map(id => ChordApp.Store.items.get(id).singer), ids.slice(0, 2));
    ok(s[0] === 'แท็บ A' && s[1] === 'แท็บ B', 'edits to different songs from two tabs both survive ' + JSON.stringify(s));
    // same song edited in both: the second save is stopped and asked
    await a.goto(FILE + '#edit-' + newSongId); await sleep(300);
    await b2.goto(FILE + '#edit-' + newSongId); await sleep(300);
    await b2.fill('#ed-title', 'ชื่อจากแท็บ B'); await b2.click('#ed-save'); await sleep(500);
    await sleep(300);
    ok((await a.textContent('#ed-remote')).includes('มีคน'), 'tab A is told someone saved this song');
    await a.fill('#ed-title', 'ชื่อจากแท็บ A'); await a.click('#ed-save'); await sleep(600);
    ok(await a.isVisible('.scrim [data-a="new"]'), 'saving over it opens the conflict choice');
    await a.click('.scrim [data-a="new"]'); await sleep(600);
    const titles = await st(a, () => [...ChordApp.Store.songs.values()].map(s => s.title));
    ok(titles.includes('ชื่อจากแท็บ B') && titles.includes('ชื่อจากแท็บ A (ฉบับของฉัน)'), 'both versions kept, nothing lost');
    await b2.close();
  });

  await step('backup and restore', async () => {
    await a.goto(FILE + '#data'); await sleep(300);
    const [dl] = await Promise.all([a.waitForEvent('download'), a.click('#bk-save')]);
    const file = await dl.path(); const text = fs.readFileSync(file, 'utf8'); const data = JSON.parse(text);
    const base = await st(a, () => ({ songs: BUILTIN.songs.length, events: BUILTIN.events.length }));
    ok(data.format === 'chordscroll-backup' && data.songs.length === base.songs + 2 && data.events.length === base.events + 1, `backup has ${data.songs.length} songs, ${data.events.length} gigs, ${data.items.length} items`);
    // lose the gig, then merge it back
    await a.evaluate(id => deleteEvent(id), evId); await sleep(300);
    await a.setInputFiles('#rs-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(text) }); await sleep(300);
    await a.click('.scrim [data-a="merge"]'); await sleep(1200);
    ok(await st(a, id => ChordApp.Store.events.has(id) && [...ChordApp.Store.items.values()].filter(i => i.eventId === id).length === 4, evId), 'merge brings the deleted gig back with its 4 songs');
    // add something extra, then replace: it must disappear
    await a.evaluate(() => createEvent({ name: 'งานชั่วคราว' })); await sleep(300);
    await a.goto(FILE + '#data'); await sleep(300);
    await a.setInputFiles('#rs-file', { name: 'b.json', mimeType: 'application/json', buffer: Buffer.from(text) }); await sleep(300);
    ok(await a.isDisabled('.scrim [data-a="replace"]'), 'replace stays locked until “แทนที่” is typed');
    await a.fill('#rs-confirm', 'แทนที่'); await a.click('.scrim [data-a="replace"]'); await sleep(1500);
    const names = await st(a, () => [...ChordApp.Store.events.values()].map(e => e.name));
    ok(!names.includes('งานชั่วคราว') && names.length === data.events.length, 'replace makes the data match the file exactly ' + JSON.stringify(names));
    await a.setInputFiles('#rs-file', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{oops') }); await sleep(300);
    ok((await a.textContent('.toast')).includes('JSON'), 'a broken file is refused before anything changes');
  });

  await step('storage full', async () => {
    await a.goto(FILE + `#event-${evId}`); await sleep(300);
    await a.evaluate(() => { window.__realSet = Storage.prototype.setItem; Storage.prototype.setItem = function (k, v) { if (k.startsWith('chordscroll-db')) { const e = new Error('The quota has been exceeded.'); e.name = 'QuotaExceededError'; throw e; } return window.__realSet.call(this, k, v); }; });
    const id = await st(a, id => [...ChordApp.Store.items.values()].find(i => i.eventId === id).id, evId);
    await a.evaluate(id => patchItem(id, { note: 'จะบันทึกไม่ได้' }), id); await sleep(300);
    const pill = await a.getAttribute('#sync', 'data-state');
    ok(pill === 'error' && (await a.textContent('#sync')).includes('ไม่สำเร็จ'), 'status pill reports the failed save instead of “saved”');
    ok(await st(a, id => ChordApp.Store.items.get(id).note !== 'จะบันทึกไม่ได้', id), 'nothing pretends to be saved');
    await a.evaluate(() => { Storage.prototype.setItem = window.__realSet; });
    await a.click('#sync'); await a.click('.scrim [data-retry]'); await sleep(400);
    ok(await st(a, id => ChordApp.Store.items.get(id).note === 'จะบันทึกไม่ได้', id), 'retry saves it once space is back');
  });
  ok(!errsA.length, 'no script errors: ' + errsA.slice(0, 3).join(' | '));
  await ctxA.close();

  /* ===================== B. claude.ai: shared database ===================== */
  section = '[shared] ';
  const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const owner = await ctxB.newPage();
  const errsB = [];
  owner.on('pageerror', e => errsB.push(e.message));
  await owner.addInitScript(MOCK);
  await owner.goto(FILE); await sleep(800);

  await step('empty shared database', async () => {
    ok(await st(owner, () => ChordApp.Store.mode === 'shared'), 'runs on the shared database');
    ok(await owner.isVisible('#seed'), 'empty database offers the starter songs');
    await owner.click('#seed'); await sleep(1500);
    ok(await st(owner, () => ChordApp.Store.songs.size === BUILTIN.songs.length && ChordApp.Store.items.size === BUILTIN.items.length && ChordApp.Store.events.size === BUILTIN.events.length), 'starter songs and gigs written to the shared database');
  });

  // a picture to "upload": screenshot of a small chord sheet drawn in the page
  const pic = async (txt) => {
    const pg = await ctxB.newPage();
    await pg.setContent(`<div id=x style="width:600px;padding:20px;font:20px sans-serif;background:#fff">${txt}</div>`);
    const buf = await (await pg.$('#x')).screenshot(); await pg.close(); return buf;
  };
  let imgSongId = null;
  await step('add a song from pictures', async () => {
    await owner.goto(FILE + '#new-image'); await sleep(400);
    await owner.setInputFiles('#ed-file', [{ name: 'p1.png', mimeType: 'image/png', buffer: await pic('G D<br>ฟ้ายังคงสดใส') }, { name: 'p2.png', mimeType: 'image/png', buffer: await pic('C D<br>ร้องเพลงนี้ให้เธอ') }]);
    await sleep(200);
    ok((await owner.$$('.thumb')).length === 2, 'two pictures queued');
    const firstSrc = await owner.getAttribute('.thumb img', 'src');
    await owner.click('.thumb [data-mv="0:1"]'); await sleep(100);
    ok((await owner.getAttribute('.thumb:nth-child(2) img', 'src')) === firstSrc, 'pictures can be reordered');
    await owner.click('#ed-read'); await sleep(150);
    ok(await owner.isVisible('#ed-progress'), 'shows reading progress with a stop button');
    await sleep(900);
    const calls = await st(owner, () => window.__mockCfg.sampleCalls);
    ok(calls.length === 1 && calls[0].images === 2 && /IMMEDIATELY BEFORE the syllable/.test(calls[0].input) && /\[Am\?\]/.test(calls[0].input), 'both pictures sent in order with the transcription and honesty rules');
    ok((await owner.inputValue('#ed-title')) === 'เพลงจากรูป' && (await owner.inputValue('#ed-bpm')) === '92', 'title, artist and BPM filled from the picture');
    const issues = await owner.textContent('#ed-issues');
    ok(issues.includes('อ่านไม่ชัด') && issues.includes('จากการอ่านรูป'), 'unclear spots listed, with the reader’s own notes');
    ok((await owner.$$('#pv-sheet .unclear')).length === 2, 'preview highlights the unclear chord and word');
    ok(await owner.isDisabled('#ed-src'), '“checked against the source” locked while marks remain');
    await owner.click('#ed-save'); await sleep(700);
    imgSongId = (await owner.evaluate(() => location.hash)).replace('#song-', '');
    const s = await st(owner, id => ChordApp.Store.songs.get(id), imgSongId);
    ok(s && s.source === 'image' && s.sourceCheck === 'unchecked' && s.musicCheck === 'unchecked', 'saved as “not yet checked”, never as correct');
    ok((await owner.textContent('.song-head')).includes('2 จุดที่อ่านไม่ชัด'), 'player warns about the 2 unclear spots');
  });

  await step('update an existing song from pictures', async () => {
    await owner.goto(FILE + '#new-image'); await sleep(300);
    await owner.evaluate(() => { window.__mockCfg.sample = { result: { title: 'เพลงจากรูป', artist: 'วงทดสอบ', bpm: 92, text: '[G]ฟ้ายังคง [D]สดใส\nแม้ใจจะ [Em]หม่นหมอง', unclear: [], notes: '' } }; });
    await owner.setInputFiles('#ed-file', { name: 'p3.png', mimeType: 'image/png', buffer: await pic('fixed') });
    await owner.click('#ed-read'); await sleep(900);
    ok((await owner.textContent('#ed-issues')).includes('มีเพลง'), 'notices the song already exists');
    await owner.click('[data-usedup]'); await sleep(100);
    await owner.click('#ed-save'); await sleep(300);
    ok((await owner.textContent('.scrim')).includes('แทนที่'), 'asks before overwriting the existing song');
    await yes(owner); await sleep(800);
    const s = await st(owner, id => ChordApp.Store.songs.get(id), imgSongId);
    ok(s.rev === 2, 'existing song updated in place (same id, rev 2)');
    await owner.goto(FILE + '#new-image'); await sleep(300);
    await owner.evaluate(() => { window.__mockCfg.sample = { error: 'rate_limited' }; });
    await owner.setInputFiles('#ed-file', { name: 'p4.png', mimeType: 'image/png', buffer: await pic('x') });
    await owner.click('#ed-read'); await sleep(700);
    ok((await owner.textContent('.toast')).includes('ถี่เกินไป'), 'reading failure is explained, nothing is invented');
    await owner.evaluate(() => { window.__mockCfg.sample = null; });
    await owner.click('.bar a.icon-btn'); await sleep(200); if (await owner.isVisible('.scrim')) await yes(owner);
  });

  await step('failed and offline saves', async () => {
    const itd = await st(owner, () => [...ChordApp.Store.events.keys()][0]);
    await owner.goto(FILE + '#event-' + itd); await sleep(300);
    await owner.evaluate(() => { window.__mockCfg.fail = { count: 1, code: 'quota_exceeded' }; });
    await owner.evaluate(id => updateEvent(id, { note: 'โน้ตใหม่' }), itd); await sleep(300);
    ok((await owner.getAttribute('#sync', 'data-state')) === 'error', 'a refused write shows as failed');
    await owner.click('#sync'); await owner.click('.scrim [data-retry]'); await sleep(400);
    ok(await st(owner, id => ChordApp.Store.events.get(id).note === 'โน้ตใหม่', itd), 'retry from the status pill succeeds');
    await ctxB.setOffline(true);
    await owner.evaluate(() => { window.__mockCfg.offline = true; });
    const p = owner.evaluate(id => updateEvent(id, { venue: 'เวทีกลาง' }), itd);
    await sleep(300);
    ok((await owner.textContent('#sync')).includes('ออฟไลน์'), 'offline write shows “waiting to send”: ' + await owner.textContent('#sync'));
    await ctxB.setOffline(false); await owner.evaluate(() => window.__mockGoOnline()); await p; await sleep(300);
    ok((await owner.textContent('#sync')).includes('บันทึกแล้ว'), 'after reconnecting it says saved');
  });

  await step('view-only member', async () => {
    const viewer = await ctxB.newPage();
    await viewer.addInitScript(() => { window.__mockCfg = { user: { id: 'u_viewer', isOwner: false, canEdit: false, canWrite: false } }; });
    await viewer.addInitScript(MOCK);
    await viewer.goto(FILE); await sleep(800);
    ok(!(await viewer.$('#new-event')) && (await viewer.textContent('main')).includes('ดูอย่างเดียว'), 'no create button, read-only notice shown');
    const itd = await st(viewer, () => [...ChordApp.Store.events.keys()][0]);
    await viewer.goto(FILE + '#event-' + itd); await sleep(300);
    ok(!(await viewer.$('.handle')) && !(await viewer.$('#ev-del')), 'no drag handles or delete for a viewer');
    await viewer.goto(FILE + '#new-text'); await sleep(200);
    ok((await viewer.textContent('main')).includes('แก้ไขไม่ได้'), 'editor refuses a viewer');
    const it = await st(viewer, id => [...ChordApp.Store.items.values()].find(i => i.eventId === id).id, itd);
    await viewer.goto(FILE + `#play-${itd}-${it}`); await sleep(300);
    ok((await viewer.textContent('#saved-note')).includes('ชั่วคราว'), 'viewer can still play; changes are only temporary');
    // live update from the owner, without reload
    await owner.evaluate(id => updateEvent(id, { name: 'ITD (แก้จากเจ้าของ)' }), itd); await sleep(500);
    await viewer.goto(FILE + '#event-' + itd); await sleep(300);
    ok((await viewer.textContent('h1')).includes('แก้จากเจ้าของ'), 'viewer sees the owner’s change');
    // personal settings stay per person
    await owner.goto(FILE + `#play-${itd}-${it}`); await sleep(300); await owner.click('#fs-up'); await sleep(100);
    await viewer.reload(); await sleep(600); await viewer.goto(FILE + `#play-${itd}-${it}`); await sleep(300);
    const vs = await viewer.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--scale').trim());
    ok(vs === '1', 'text size set by the owner does not leak into the viewer’s account (' + vs + ')');
    await viewer.close();
  });
  ok(!errsB.length, 'no script errors: ' + errsB.slice(0, 3).join(' | '));
  await browser.close();

  const fails = results.filter(r => !r[0]).length;
  console.log(fails ? `\n${fails} FAILED of ${results.length}` : `\nALL ${results.length} PASSED`);
  process.exit(fails ? 1 : 0);
})();
