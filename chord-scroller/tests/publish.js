// "Everyone sees the same thing" on the public link without accounts: the band's published copy
// (band-data.json next to the app). Two devices, a local edit, a new published copy, a removal.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const DIR = fs.mkdtempSync('/tmp/chordscroll-pub-');
for (const f of ['index.html', 'sw.js', 'band-data.json']) fs.copyFileSync(path.join(ROOT, f), path.join(DIR, f));
const PORT = 8767, URL0 = `http://127.0.0.1:${PORT}/`;
const results = [];
const ok = (c, m) => { results.push([!!c, m]); console.log((c ? 'PASS ' : 'FAIL ') + m); };
async function step(name, fn) { try { await fn(); } catch (e) { ok(false, name + ' threw: ' + String(e && e.message || e).split('\n')[0]); } }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const content = p => p.evaluate(() => {
  const strip = o => { const r = { ...o }; for (const k of ['rev', 'createdAt', 'updatedAt', 'updatedBy', 'setsRev']) delete r[k]; return JSON.stringify(Object.keys(r).sort().map(k => [k, r[k]])); };
  return ['songs', 'events', 'items'].map(c => [...ChordApp.Store[c].values()].map(strip).sort()).map(a => a.join('\n')).join('\n---\n');
});

(async () => {
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: DIR, stdio: 'ignore' });
  await sleep(700);
  const browser = await chromium.launch();
  const errs = [];
  const device = async name => { const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message)); return p; };
  try {
    const A = await device('A'), B = await device('B');
    await step('first open', async () => {
      await A.goto(URL0); await B.goto(URL0); await sleep(1500);
      ok(await content(A) === await content(B), 'two devices that never talked to each other show the same gigs and songs');
      ok(await A.evaluate(() => ChordApp.Store.songs.size === 12 && Published.at !== null), 'the band’s published copy was loaded');
    });

    const pub = JSON.parse(fs.readFileSync(path.join(DIR, 'band-data.json'), 'utf8'));
    const song0 = pub.songs[0];
    await step('a new published copy reaches every device', async () => {
      // device A edits a song locally; device B makes its own gig
      await A.evaluate(id => patchSong(id, { title: 'แก้ในเครื่อง A' }), song0.id);
      await B.evaluate(() => createEvent({ name: 'งานของ B เอง' }));
      await sleep(300);
      // the band publishes: song renamed, ITD gig removed, a new gig with two songs
      const v2 = JSON.parse(JSON.stringify(pub));
      v2.exportedAt = new Date(Date.now() + 1000).toISOString();
      v2.songs[0].title = 'ชื่อใหม่จากวง';
      const itd = v2.events[0].id;
      v2.events = [{ id: 'gignew000001', name: 'งานแต่ง 20 ธ.ค.', date: '2026-12-20', venue: 'โรงแรม', note: '', slotMinutes: 60, sets: [{ id: 'main', name: 'เซ็ตหลัก' }] }];
      v2.items = [{ id: 'row000000001', eventId: 'gignew000001', setId: 'main', songId: v2.songs[2].id, order: 1000, shift: 2, capo: 0, bpm: 90, singer: 'นุ่น', note: '' },
                  { id: 'row000000002', eventId: 'gignew000001', setId: 'main', songId: v2.songs[5].id, order: 2000, shift: 0, capo: 0, bpm: null, singer: '', note: '' }];
      fs.writeFileSync(path.join(DIR, 'band-data.json'), JSON.stringify(v2));
      await A.reload(); await B.reload(); await sleep(1800);
      const a = await A.evaluate(id => ({ title: ChordApp.Store.songs.get(id).title, events: [...ChordApp.Store.events.values()].map(e => e.name).sort() }), song0.id);
      const b = await B.evaluate(id => ({ title: ChordApp.Store.songs.get(id).title, events: [...ChordApp.Store.events.values()].map(e => e.name).sort() }), song0.id);
      ok(a.title === 'ชื่อใหม่จากวง' && b.title === 'ชื่อใหม่จากวง', 'renamed song shows the band’s name on both devices');
      ok(!a.events.includes('ITD') && !b.events.includes('ITD'), 'the gig the band removed is gone on both devices');
      ok(a.events.includes('งานแต่ง 20 ธ.ค.') && b.events.includes('งานแต่ง 20 ธ.ค.'), 'the new gig is on both devices');
      ok(b.events.includes('งานของ B เอง') && !a.events.includes('งานของ B เอง'), 'a gig B made only on its own device stays on B');
      const row = await A.evaluate(() => ChordApp.Store.items.get('row000000001'));
      ok(row && row.shift === 2 && row.bpm === 90 && row.singer === 'นุ่น', 'gig settings (key, BPM, singer) arrive as published');
      const hist = await A.evaluate(async id => (await historyList(h => h.refId === id)).map(h => h.data.title), song0.id);
      ok(hist.includes('แก้ในเครื่อง A'), 'A’s own edit was kept in the song’s history before the band’s version replaced it');
    });

    await step('nothing changes when the copy is the same', async () => {
      const before = await A.evaluate(() => JSON.stringify([...ChordApp.Store.songs.values()].map(s => s.updatedAt)));
      await A.reload(); await sleep(1200);
      const after = await A.evaluate(() => JSON.stringify([...ChordApp.Store.songs.values()].map(s => s.updatedAt)));
      ok(before === after, 'reopening with the same published copy writes nothing');
    });

    await step('publishing from the app', async () => {
      await A.goto(URL0 + '#data'); await sleep(600);
      ok((await A.textContent('main')).includes('เผยแพร่ให้ทั้งวงเห็น'), 'the share page explains publishing');
      const href = await A.getAttribute('a[href*="/upload/"]', 'href');
      ok(href === 'https://github.com/moszasa09-boop/film-collection/upload/claude/zealous-heisenberg-l866k0/chord-scroller', 'links straight to the GitHub upload page for the site folder');
      const [dl] = await Promise.all([A.waitForEvent('download'), A.click('#pub-dl')]);
      ok(dl.suggestedFilename() === 'band-data.json', 'download is named band-data.json');
      const file = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
      ok(file.format === 'chordscroll-backup' && file.events.some(e => e.name === 'งานแต่ง 20 ธ.ค.'), 'the file holds this device’s gigs and songs');
      // publish it (as GitHub would serve it) and check the other device picks it up
      fs.writeFileSync(path.join(DIR, 'band-data.json'), JSON.stringify(file));
      await B.reload(); await sleep(1500);
      ok(await content(B) !== '' && (await B.evaluate(() => [...ChordApp.Store.events.values()].some(e => e.name === 'งานแต่ง 20 ธ.ค.'))), 'the other device takes the newly published copy');
    });
    ok(!errs.length, 'no script errors: ' + errs.slice(0, 3).join(' | '));
  } finally { await browser.close(); server.kill(); }
  const fails = results.filter(r => !r[0]).length;
  console.log(fails ? `\n${fails} FAILED of ${results.length}` : `\nALL ${results.length} PASSED`);
  process.exit(fails ? 1 : 0);
})();
