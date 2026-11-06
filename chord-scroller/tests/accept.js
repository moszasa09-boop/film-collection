// Acceptance checks for the items the band asked to verify before use, served over http://localhost
// (so the service worker and offline mode run as they do on github.io). Chromium via Playwright.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const PORT = 8765;
const ROOT = path.resolve(__dirname, '..');
const URL0 = `http://localhost:${PORT}/index.html`;
const results = [];
let section = '';
const ok = (c, m) => { results.push([!!c, section + m]); console.log((c ? 'PASS ' : 'FAIL ') + section + m); };
async function step(name, fn) { try { await fn(); } catch (e) { ok(false, name + ' threw: ' + String(e && e.message || e).split('\n')[0]); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const parseTime = t => { const m = /(\d+):(\d\d)/.exec(t); return m ? +m[1] * 60 + +m[2] : NaN; };

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await sleep(800);
  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
    const a = await ctx.newPage();
    const errs = [];
    a.on('pageerror', e => errs.push(e.message));
    const S = (fn, arg) => a.evaluate(fn, arg);
    await a.goto(URL0); await a.waitForSelector('.event-card'); await sleep(400);
    const ITD = await S(() => [...ChordApp.Store.events.keys()][0]);
    const itdBefore = await S(id => JSON.stringify([...ChordApp.Store.items.values()].filter(i => i.eventId === id).sort((x, y) => x.order - y.order)), ITD);

    // a gig with 5 songs in the main set and 1 in a reserve set
    section = '[setup] ';
    const EV = await S(async () => {
      const id = await createEvent({ name: 'งานตรวจรับ', date: '2026-12-31' });
      await changeSets(id, sets => [...sets, { id: 'reserve', name: 'เพลงสำรอง' }]);
      const songs = [...ChordApp.Store.songs.values()].sort((a, b) => a.title.localeCompare(b.title, 'th'));
      const main = ChordApp.Store.events.get(id).sets[0].id;
      await addItems(id, main, songs.slice(0, 5).map(s => s.id));
      await addItems(id, 'reserve', [songs[5].id]);
      return id;
    });
    await sleep(300);
    const order = () => S(id => { const ev = ChordApp.Store.events.get(id); return [...ChordApp.Store.items.values()].filter(i => i.eventId === id).sort((x, y) => (ev.sets.findIndex(s => s.id === x.setId) - ev.sets.findIndex(s => s.id === y.setId)) || x.order - y.order).map(i => i.id); }, EV);
    const item = id => S(id => ChordApp.Store.items.get(id), id);
    ok((await order()).length === 6, 'gig with 6 songs in 2 sets');
    const ids = await order();
    const X = ids[1];
    await S(x => patchItem(x, { shift: 3, capo: 1, bpm: 120, singer: 'นุ่น', note: 'เปิดด้วยกีตาร์', durationSec: 245 }), X);
    await sleep(200);
    const settingsOf = async id => { const i = await item(id); return JSON.stringify([i.shift, i.capo, i.bpm, i.singer, i.note, i.durationSec]); };
    const XS = await settingsOf(X);

    section = '[reorder] ';
    await step('buttons', async () => {
      await a.goto(URL0 + '#event-' + EV); await sleep(300);
      await a.click(`.item-row [data-itemmenu="${X}"]`); await a.click('#it-mup'); await sleep(300);
      ok((await order())[0] === X, 'move-up button puts the song first');
      ok(await settingsOf(X) === XS, 'key, capo, BPM, singer, note and length stay after moving up');
      await a.click(`.item-row [data-itemmenu="${X}"]`); await a.selectOption('#it-set', 'reserve'); await a.click('#it-form button[type=submit]'); await sleep(400);
      const it = await item(X);
      ok(it.setId === 'reserve' && await settingsOf(X) === XS, 'moved to the reserve set with every setting kept');
      await a.click('.toast-act'); await sleep(400);
      ok((await item(X)).setId !== 'reserve' && (await order())[0] === X, 'Undo in the toast puts it back where it was');
    });
    await step('mouse drag', async () => {
      const before = await order();
      const rows = await a.$$('.set:first-of-type .item-row');
      const h = await (await rows[3].$('.handle')).boundingBox(), t = await rows[0].boundingBox();
      await a.mouse.move(h.x + 10, h.y + 10); await a.mouse.down();
      await a.mouse.move(h.x + 10, t.y + 5, { steps: 10 }); await a.mouse.up(); await sleep(400);
      const after = await order();
      ok(after[0] === before[3], 'mouse drag moves the 4th song to the top');
      await a.keyboard.press('Control+z'); await sleep(400);
      ok(JSON.stringify(await order()) === JSON.stringify(before), 'Ctrl+Z undoes the drag');
    });

    section = '[mobile] ';
    await step('touch drag', async () => {
      const m = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
      const t = await m.newPage();
      await t.goto(URL0); await sleep(500);
      // same browser profile is not shared between contexts: build the gig here too
      const ev2 = await t.evaluate(async () => { const id = await createEvent({ name: 'มือถือ' }); const songs = [...ChordApp.Store.songs.values()]; await addItems(id, ChordApp.Store.events.get(id).sets[0].id, songs.slice(0, 4).map(s => s.id)); return id; });
      await t.goto(URL0 + '#event-' + ev2); await sleep(400);
      const ord = () => t.evaluate(id => [...ChordApp.Store.items.values()].filter(i => i.eventId === id).sort((x, y) => x.order - y.order).map(i => i.id), ev2);
      const before = await ord();
      const rows = await t.$$('.item-row');
      await rows[1].evaluate(el => el.scrollIntoView({ block: 'center' })); await sleep(200);
      const h = await (await rows[2].$('.handle')).boundingBox(), top = await rows[0].boundingBox();
      ok(h.y + h.height < 844 && top.y > 0, 'both rows are on screen before the finger drag');
      const cdp = await m.newCDPSession(t);
      const pt = (x, y) => [{ x, y, id: 1 }];
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(h.x + h.width / 2, h.y + h.height / 2) });
      for (let k = 1; k <= 10; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(h.x + h.width / 2, h.y + h.height / 2 + (top.y + 4 - (h.y + h.height / 2)) * k / 10) });
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await sleep(500);
      const after = await ord();
      ok(after[0] === before[2], 'dragging with a finger moves the 3rd song to the top: ' + (after[0] === before[2]));
      await t.click(`.item-row [data-itemmenu="${after[1]}"]`); await t.click('#it-mdown'); await sleep(300);
      const after2 = await ord();
      ok(after2[2] === after[1], 'move-down button works on a phone');
      const w = await t.evaluate(() => document.documentElement.scrollWidth);
      ok(w <= 390, 'gig page fits the phone width');
      await m.close();
    });

    section = '[order] ';
    await step('previous/next follow the new order', async () => {
      const ord = await order();
      const songsOnly = [];
      for (const id of ord) { const i = await item(id); if (i.kind !== 'break') songsOnly.push(id); }
      await a.goto(URL0 + `#play-${EV}-${songsOnly[0]}`); await sleep(300);
      const visited = [songsOnly[0]];
      for (let k = 1; k < songsOnly.length; k++) {
        await a.click('a[aria-label^="เพลงถัดไป"]'); await sleep(250);
        visited.push((await a.evaluate(() => location.hash)).split('-').pop());
      }
      ok(JSON.stringify(visited) === JSON.stringify(songsOnly), 'next button walks the gig in its current order (both sets)');
      await a.click('a[aria-label^="เพลงก่อนหน้า"]'); await sleep(250);
      ok((await a.evaluate(() => location.hash)).endsWith(songsOnly[songsOnly.length - 2]), 'previous goes back one');
      const bpm = +(await a.textContent('#bpm'));
      const exp = await S(id => { const i = ChordApp.Store.items.get(id); const s = ChordApp.Store.songs.get(i.songId); return itemBpm(i, s); }, songsOnly[songsOnly.length - 2]);
      ok(bpm === exp, 'each song shows its own gig BPM after switching');
    });

    section = '[isolation] ';
    await step('other gigs untouched', async () => {
      const now = await S(id => JSON.stringify([...ChordApp.Store.items.values()].filter(i => i.eventId === id).sort((x, y) => x.order - y.order)), ITD);
      ok(now === itdBefore, 'ITD rows (order, key, BPM, singer) unchanged after all edits to the other gig');
    });

    section = '[reset] ';
    await step('back to the song’s own key and BPM', async () => {
      await a.goto(URL0 + '#event-' + EV); await sleep(300);
      await a.click(`.item-row [data-itemmenu="${X}"]`); await a.click('#it-reset'); await sleep(300);
      const r = await item(X);
      ok(r.shift === 0 && r.capo === 0 && r.bpm === null && r.durationSec === null && r.singer === 'นุ่น', 'reset clears key, capo, BPM and length but keeps singer and note');
      await a.click('.toast-act'); await sleep(300);
      ok(await settingsOf(X) === XS, 'Undo brings the gig settings back');
      await a.goto(URL0 + `#play-${EV}-${X}`); await sleep(300);
      await a.click('#reset'); await sleep(400);
      const songBpm = await S(id => { const i = ChordApp.Store.items.get(id); return ChordApp.Store.songs.get(i.songId).bpm; }, X);
      ok(+(await a.textContent('#bpm')) === songBpm && (await a.textContent('#tr')) === 'เดิม' && (await a.textContent('#capo')) === '0', 'player “คืนค่าเดิม” shows the song’s own BPM, key and no capo');
      ok((await item(X)).bpm === null, 'and saves it to the gig');
      await a.click('.toast-act'); await sleep(400);
      ok((await item(X)).bpm === 120 && (await item(X)).shift === 3, 'player reset can be undone');
    });

    section = '[time] ';
    await step('plan the show length', async () => {
      await a.goto(URL0 + '#event-' + EV); await sleep(300);
      await a.click('#ev-edit'); await a.fill('#ev-slot', '10'); await a.fill('#ev-gap', '30'); await a.click('#ev-form button[type=submit]'); await sleep(300);
      const mainSet = await S(id => ChordApp.Store.events.get(id).sets[0].id, EV);
      await a.click(`[data-addbreak="${mainSet}"]`); await a.fill('#br-min', '15'); await a.click('#br button[type=submit]'); await sleep(400);
      const t = await a.textContent('.totals');
      const exp = await S(id => { const ev = ChordApp.Store.events.get(id); const its = eventItems(id); const songs = its.filter(i => !isBreak(i)); return songs.reduce((n, i) => n + itemSecs(i), 0) + 15 * 60 + (songs.length - 1) * 30; }, EV);
      ok(Math.abs(parseTime(/เวลารวม\s*([\d:]+)/.exec(t)[1]) - exp) <= 1, `total = songs + 15 min break + 30 s between songs (${fmt(exp)})`);
      ok(/เกิน/.test(t), 'warns that the show runs over the planned 10 minutes');
      ok((await a.textContent('details.ready')).includes('เกินเวลางาน'), 'readiness check lists the overrun');
      ok((await a.$$('.break-row')).length === 1, 'break shows as its own row');
      const fit = await S(id => { const its = eventItems(id).filter(i => !isBreak(i)); return its.length; }, EV);
      await a.click('#ev-edit'); await a.fill('#ev-slot', '120'); await a.click('#ev-form button[type=submit]'); await sleep(300);
      ok(/เหลือ/.test(await a.textContent('.totals')), 'with 120 minutes it shows time left instead');
      // the song before the break announces it, and next skips the break
      const ord = await order();
      const bi = (await Promise.all(ord.map(item))).findIndex(i => i.kind === 'break');
      const beforeBreak = ord[bi - 1], afterBreak = ord.slice(bi + 1).find(Boolean);
      await a.goto(URL0 + `#play-${EV}-${beforeBreak}`); await sleep(300);
      await a.evaluate(() => { ChordApp.P.bpm = 220; retime(); seekTo(ChordApp.P.total - 0.3); });
      await a.click('#play'); await sleep(1500);
      const card = await a.textContent('#next-card');
      ok(card.includes('พัก 15 นาที'), 'end of the song before the break says “พัก 15 นาที”: ' + card.trim().slice(0, 50));
      if (afterBreak) { const nh = await a.getAttribute('#next-card a', 'href'); ok(nh.endsWith(afterBreak), 'next button skips the break to the following song'); }
      function fmt(s) { return Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0'); }
    });

    section = '[ready] ';
    await step('readiness before the stage', async () => {
      const sid = await S(async () => { const r = await saveSong({ title: 'เพลงยังไม่ชัด', artist: '', bpm: 90, blocks: textToBlocks('[G]ฟ้า {?ใส}\n[C?]ร้อง').blocks, source: 'image', sourceCheck: 'unchecked', musicCheck: 'unchecked' }, null); return r.id; });
      const mainSet = await S(id => ChordApp.Store.events.get(id).sets[0].id, EV);
      await S(([e, s, so]) => addItems(e, s, [so]), [EV, mainSet, sid]); await sleep(300);
      await a.goto(URL0 + '#event-' + EV); await sleep(300);
      const panel = await a.textContent('details.ready');
      ok(panel.includes('อ่านไม่ชัด 2 จุด'), 'flags unclear chords/words');
      ok(panel.includes('ยังไม่ตรวจกับเพลงจริง') && panel.includes('ยังไม่กำหนดนักร้อง'), 'flags songs not checked against the recording and missing singers');
      ok(await a.isVisible('details.ready[open]'), 'panel opens by itself when something needs fixing');
      ok(!!(await a.$('details.ready a[href^="#edit-"]')), 'each problem links to where it is fixed');
    });

    section = '[history] ';
    let HS = null;
    await step('versions and rollback', async () => {
      HS = await S(() => [...ChordApp.Store.songs.values()].find(s => s.title === 'เพลงยังไม่ชัด').id);
      await a.goto(URL0 + '#edit-' + HS); await sleep(300);
      await a.fill('#ed-title', 'ชื่อที่สอง'); await a.click('#ed-save'); await sleep(600);
      await a.goto(URL0 + '#edit-' + HS); await sleep(300);
      await a.fill('#ed-title', 'ชื่อที่สาม'); await a.click('#ed-save'); await sleep(600);
      await a.goto(URL0 + '#edit-' + HS); await sleep(300);
      await a.click('#ed-hist'); await sleep(400);
      const n = (await a.$$('.history-list .h')).length;
      ok(n === 2, 'two earlier versions kept: ' + n);
      const items = await a.$$('.history-list .h');
      ok((await items[1].textContent()).includes('เพลงยังไม่ชัด'), 'the oldest version is the original');
      await (await items[1].$('[data-restore]')).click(); await sleep(200);
      await a.click('.scrim [data-a="yes"]'); await sleep(800);
      const s = await S(id => ChordApp.Store.songs.get(id), HS);
      ok(s.title === 'เพลงยังไม่ชัด' && s.rev === 4, 'rolled back to the original as a new revision (4)');
      const h = await S(async id => (await historyList(h => h.refId === id)).length, HS);
      ok(h === 3, 'the replaced version went into history too, so the rollback can itself be undone');
    });

    section = '[trash] ';
    await step('restore deleted song and gig', async () => {
      const row = await S(id => [...ChordApp.Store.items.values()].find(i => i.songId === id), HS);
      await a.goto(URL0 + '#edit-' + HS); await sleep(300);
      await a.click('#ed-del'); await a.click('.scrim [data-a="yes"]'); await sleep(600);
      ok(!(await S(id => ChordApp.Store.songs.has(id), HS)) && !(await S(id => ChordApp.Store.items.has(id), row.id)), 'song and its gig row deleted');
      await a.goto(URL0 + '#data'); await sleep(600);
      ok((await a.textContent('#trash')).includes('เพลงยังไม่ชัด'), 'deleted song is in the trash');
      await a.click('#trash [data-untrash]'); await sleep(800);
      const back = await S(id => ChordApp.Store.items.get(id), row.id);
      ok(await S(id => ChordApp.Store.songs.has(id), HS) && back && back.order === row.order && back.setId === row.setId, 'restored song is back in the gig at the same place');
      const gigRows = await S(id => eventItems(id).length, EV);
      await a.goto(URL0 + '#event-' + EV); await sleep(300);
      await a.click('#ev-del'); await a.click('.scrim [data-a="yes"]'); await sleep(800);
      await a.goto(URL0 + '#data'); await sleep(600);
      await a.click('#trash [data-untrash]'); await sleep(1200);
      ok(await S(([id, n]) => ChordApp.Store.events.has(id) && eventItems(id).length === n, [EV, gigRows]), `deleted gig restored with all ${gigRows} rows`);
      ok(await settingsOf(X) === XS, 'restored rows keep their key/capo/BPM/singer/note');
    });

    section = '[backup] ';
    await step('backup and restore are exact', async () => {
      await a.goto(URL0 + '#data'); await sleep(300);
      const [d1] = await Promise.all([a.waitForEvent('download'), a.click('#bk-save')]);
      const A = JSON.parse(fs.readFileSync(await d1.path(), 'utf8'));
      // change things: delete a gig, edit a song, add a gig
      await S(async ev => { await deleteEvent(ev); const s = [...ChordApp.Store.songs.values()][0]; await patchSong(s.id, { title: 'เปลี่ยนแล้ว' }); await createEvent({ name: 'งานเกิน' }); }, EV);
      await sleep(400);
      await a.goto(URL0 + '#data'); await sleep(300);
      await a.setInputFiles('#rs-file', { name: 'a.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(A)) }); await sleep(300);
      await a.fill('#rs-confirm', 'แทนที่'); await a.click('.scrim [data-a="replace"]'); await sleep(2500);
      await a.goto(URL0 + '#data'); await sleep(300);
      const [d2] = await Promise.all([a.waitForEvent('download'), a.click('#bk-save')]);
      const B = JSON.parse(fs.readFileSync(await d2.path(), 'utf8'));
      const norm = x => JSON.stringify(['songs', 'events', 'items'].map(k => x[k].map(d => JSON.stringify(Object.keys(d).sort().reduce((o, kk) => (o[kk] = d[kk], o), {}))).sort()));
      ok(norm(A) === norm(B), `after restore the data is identical to the backup (${A.songs.length} songs, ${A.events.length} gigs, ${A.items.length} rows)`);
      if (norm(A) !== norm(B)) for (const k of ['songs', 'events', 'items']) {
        const ma = new Map(A[k].map(d => [d.id, d])), mb = new Map(B[k].map(d => [d.id, d]));
        for (const [id, d] of ma) {
          const e = mb.get(id);
          if (!e) { console.log('  missing after restore', k, id); continue; }
          for (const f of new Set([...Object.keys(d), ...Object.keys(e)])) if (JSON.stringify(d[f]) !== JSON.stringify(e[f])) console.log('  differs', k, id, f, JSON.stringify(d[f]).slice(0, 60), '->', JSON.stringify(e[f]).slice(0, 60));
        }
        for (const id of mb.keys()) if (!ma.has(id)) console.log('  extra after restore', k, id);
      }
    });

    section = '[offline] ';
    await step('prepare a gig and play without internet', async () => {
      await a.goto(URL0 + '#event-' + EV); await sleep(400);
      ok((await a.textContent('#offline-state')).includes('ยังไม่ได้เตรียม'), 'gig says it is not ready offline yet');
      await a.click('.offline-state [data-offline]'); await sleep(2500);
      ok((await a.textContent('.toast')).includes('พร้อมเล่นออฟไลน์'), 'preparing reports success: ' + await a.textContent('.toast'));
      await a.goto(URL0 + '#event-' + EV); await sleep(300);
      ok((await a.textContent('#offline-state')).includes('พร้อมเล่นออฟไลน์'), 'status chip says ready');
      await ctx.setOffline(true);
      await a.reload(); await sleep(1200);
      ok((await a.textContent('h1')).includes('งานตรวจรับ'), 'page and gig open with the network off');
      const first = (await order())[0];
      await a.goto(URL0 + `#play-${EV}-${first}`); await sleep(400);
      await a.click('#play'); await sleep(2500);
      ok(await a.evaluate(() => ChordApp.P.playing || ChordApp.P.cur > 0 || document.querySelector('.countin')), 'a song plays offline');
      await ctx.setOffline(false);
      await S(id => patchSong(ChordApp.Store.items.get(id).songId, { title: 'แก้หลังเตรียม' }), first); await sleep(200);
      await a.goto(URL0 + '#event-' + EV); await sleep(300);
      ok((await a.textContent('#offline-state')).includes('มีการแก้ไขหลังเตรียม'), 'after an edit it asks to prepare again');
    });

    section = '[layout] ';
    await step('320px', async () => {
      await a.setViewportSize({ width: 320, height: 568 });
      for (const h of ['#event-' + EV, '#data', '#play-' + EV + '-' + (await order())[0]]) {
        await a.goto(URL0 + h); await sleep(300);
        const w = await a.evaluate(() => document.documentElement.scrollWidth);
        const over = await a.evaluate(() => [...document.querySelectorAll('.player button, .bar button, .bar a, .set-head button')].filter(b => b.getBoundingClientRect().right > 320.5).map(b => b.textContent.trim()));
        ok(w <= 320 && !over.length, `${h.split('-')[0]} fits 320px ${over.join(',')}`);
      }
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
