// Make band-data.json (the band's published copy) from the starter gigs in setlists/, exactly as the
// app's "ดาวน์โหลดไฟล์เผยแพร่" button would on a fresh device. Run after `python3 build.py`:
//   node tools/make-band-data.js
// Needs Playwright + Chromium, like the tests.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(e.message));
    await page.goto('file://' + path.join(ROOT, 'index.html'));
    await page.waitForFunction(() => window.ChordApp && ChordApp.Store.items.size === BUILTIN.items.length, null, { timeout: 15000 });
    const copy = await page.evaluate(() => makePublishCopy());
    if (errs.length) throw new Error(errs.join(' | '));
    const d = JSON.parse(copy);
    fs.writeFileSync(path.join(ROOT, 'band-data.json'), copy + '\n');
    console.log(`band-data.json: ${d.songs.length} songs, ${d.events.length} gigs (${d.events.map(e => e.name).join(', ')}), ${d.items.length} rows`);
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
