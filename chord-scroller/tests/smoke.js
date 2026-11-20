// Quick look: open each screen in device mode (no claude.ai), collect script errors and screenshots.
const { chromium } = require('playwright');
const path = require('path');
const file = 'file://' + path.resolve(__dirname, '../index.html');
const out = process.argv[2] || '/tmp';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_/.test(m.text())) errs.push('console: ' + m.text()); });
  await p.goto(file); await p.waitForTimeout(800);
  await p.screenshot({ path: out + '/s-home.png' });
  const evHref = await p.getAttribute('.event-card', 'href').catch(() => null);
  console.log('event link', evHref);
  if (evHref) { await p.goto(file + evHref); await p.waitForTimeout(400); await p.screenshot({ path: out + '/s-event.png', fullPage: false }); }
  const play = await p.getAttribute('.item-row a.open', 'href').catch(() => null);
  if (play) { await p.goto(file + play); await p.waitForTimeout(500); await p.screenshot({ path: out + '/s-play.png' }); }
  await p.goto(file + '#library'); await p.waitForTimeout(300); await p.screenshot({ path: out + '/s-lib.png' });
  await p.goto(file + '#new-text'); await p.waitForTimeout(300);
  await p.fill('#ed-title', 'ทดสอบ'); await p.fill('#ed-text', 'Em      Am\nสุดท้าย ต่อให้เหนี่ยวรั้ง\n');
  await p.waitForTimeout(300); await p.screenshot({ path: out + '/s-edit.png', fullPage: true });
  await p.goto(file + '#data'); await p.waitForTimeout(300);
  await p.goto(file + '#s1-3'); await p.waitForTimeout(500);
  console.log('legacy route ->', await p.evaluate(() => location.hash), await p.textContent('.song-head h1').catch(() => '-'));
  console.log('errors:', errs.length ? errs : 'none');
  await b.close();
})();
