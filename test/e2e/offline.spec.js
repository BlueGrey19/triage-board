const fs = require('fs');
const path = require('path');
const { test, checks } = require('./helpers');

test.use({ seed: { projects: [], projectColors: {}, items: [] } });

test('offline', async ({ browser, app }, testInfo) => {
  const BASE = app.baseURL;
  const DATA = app.dataDir;
  const { ok, done } = checks(testInfo);
  const disk = () => JSON.parse(fs.readFileSync(path.join(DATA, 'board.json'), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const GH_DOWN = '{"error":"Couldn\'t reach GitHub. Check your connection and try again.","code":"network"}';
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const pill = () => page.locator('#boardView [data-sync]');
  const pillText = async () => (await pill().textContent()).trim();
  const state = s => page.waitForFunction(s => document.querySelector('#boardView [data-sync]').dataset.state === s, s, { timeout: 15000 });
  const cardByTitle = t => page.locator('.card[aria-label="' + t + '"]');
  const ghDown = () => page.route('**/api/**', r => r.fulfill({ status: 503, contentType: 'application/json', body: GH_DOWN }));

  // Online first: this saves the copy.
  await page.goto(BASE);
  await page.waitForSelector('#board .card, #board .empty');
  const before = disk().items.length;

  // --- The reported bug: add while GitHub is down, then the board reloads/boots ---
  await ghDown();
  await page.keyboard.press('n');
  await page.fill('#mTitleIn', 'Test Offline Item');
  await page.selectOption('#mPrio', 'critical', { timeout: 1000 }).catch(() => {});
  await page.click('#mSave');
  await state('pending');
  ok(await cardByTitle('Test Offline Item').count() === 1, 'item shows while GitHub is down');
  await wait(4500); // let an automatic retry fail
  ok(await cardByTitle('Test Offline Item').count() === 1, 'item still shows after a failed retry');
  ok(!(await page.textContent('#board')).includes('Could not'), 'no error message replaces the board');

  await page.reload(); // refresh while GitHub is down
  await page.waitForSelector('.card[aria-label="Test Offline Item"]', { timeout: 10000 });
  ok(true, 'after refresh while down: board opens from saved copy with the item');
  ok(/Not saved · 1 change · retrying/.test(await pillText()), 'pill: ' + await pillText());

  // Snippets page also opens from the copy
  await page.click('#navSnips');
  await wait(500);
  ok(!(await page.textContent('#snips')).includes('Could not load'), 'snippets page shows saved copy, not an error');
  await page.click('#navBoard');

  // Back online: it saves on its own
  await page.unroute('**/api/**');
  await state('ok');
  await wait(500);
  ok(disk().items.filter(i => i.title === 'Test Offline Item').length === 1 && disk().items.length === before + 1, 'saved exactly once when back');
  ok(await pillText() === 'Saved locally', 'pill back to normal');

  // --- Refresh while down with nothing waiting ---
  await ghDown();
  await page.reload();
  await page.waitForSelector('.card[aria-label="Test Offline Item"]', { timeout: 10000 });
  ok(/Can’t reach the server · retrying/.test(await pillText()), 'nothing waiting: pill: ' + await pillText());
  await page.unroute('**/api/**');
  await state('ok');
  await page.waitForFunction(() => /Back online/.test((document.querySelector('.toast') || {}).textContent || ''), null, { timeout: 5000 });
  ok(true, 'reloads by itself with "Back online"');

  // --- Real browser offline (navigator.onLine false) ---
  await ctx.setOffline(true);
  await cardByTitle('Test Offline Item').locator('[data-act="status"]').click();
  await page.click('#pop [data-s="doing"]');
  await state('offline');
  ok(/Offline · 1 change waiting/.test(await pillText()), 'device offline: pill: ' + await pillText());
  await ctx.setOffline(false);
  await state('ok');
  await wait(400);
  ok(disk().items.find(i => i.title === 'Test Offline Item').status === 'doing', 'saved when the device came back online');

  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));

  done();
});
