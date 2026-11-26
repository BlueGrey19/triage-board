const fs = require('fs');
const path = require('path');
const { test, checks } = require('./helpers');

test.use({ seed: { projects: [], projectColors: {}, items: [] } });

test('sync', async ({ browser, app }, testInfo) => {
  const BASE = app.baseURL;
  const DATA = app.dataDir;
  const { ok, done } = checks(testInfo);
  const disk = () => JSON.parse(fs.readFileSync(path.join(DATA, 'board.json'), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const pill = () => page.locator('#boardView [data-sync]');
  const pillText = async () => (await pill().textContent()).trim();
  const queueLen = () => page.evaluate(() => JSON.parse(localStorage.getItem('tb-queue:local') || '[]').length);

  await page.goto(BASE);
  await page.waitForSelector('#board .card, #board .empty');
  ok(await pillText() === 'Saved locally', 'pill starts as "Saved locally"');

  // 1. Normal add saves
  await page.keyboard.press('n');
  await page.fill('#mTitleIn', 'Sync test A');
  await page.click('#mSave');
  await page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'ok');
  await wait(300);
  const a = disk().items.find(i => i.title === 'Sync test A');
  ok(!!a && /^i-/.test(a.id), 'online add saves to disk with browser-made id');

  // 2. Server unreachable for writes: change shows, kept, label says not saved
  await page.route('**/api/**', r => r.request().method() === 'GET' ? r.continue() : r.abort('connectionreset'));
  const card = page.locator('.card[data-id="' + a.id + '"]');
  await card.locator('[data-act="status"]').click();
  await page.click('#pop [data-s="testing"]');
  await page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'pending');
  ok(await card.locator('.pill').textContent() === 'Testing', 'status shows Testing straight away while save fails');
  ok(/Not saved · 1 change · retrying/.test(await pillText()), 'pill: ' + await pillText());
  ok(await queueLen() === 1, 'change kept in localStorage queue');
  ok(disk().items.find(i => i.id === a.id).status === 'open', 'not on disk yet');

  // 3. Add + edit a new item while failing
  await page.keyboard.press('n');
  await page.fill('#mTitleIn', 'Offline B');
  await page.click('#mSave');
  const bId = await page.evaluate(() => [...document.querySelectorAll('.card')].find(c => c.getAttribute('aria-label') === 'Offline B').dataset.id);
  const bCard = page.locator('.card[data-id="' + bId + '"]');
  await bCard.locator('[data-act="status"]').click();
  await page.click('#pop [data-s="doing"]');
  ok(await queueLen() === 3, 'three changes queued');

  // 4. Refresh while still failing: changes stay on screen
  await page.reload();
  await page.waitForSelector('.card[data-id="' + bId + '"]');
  ok(await page.locator('.card[data-id="' + a.id + '"] .pill').textContent() === 'Testing', 'after refresh: A still Testing');
  ok(await page.locator('.card[data-id="' + bId + '"] .pill').textContent() === 'Doing', 'after refresh: new item B still there, Doing');

  // 5. Connection back: click the pill to retry now
  await page.unroute('**/api/**');
  await wait(300);
  await pill().click();
  await page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'ok', null, { timeout: 15000 });
  await wait(500);
  const d = disk();
  ok(d.items.find(i => i.id === a.id).status === 'testing', 'A saved as testing');
  ok(d.items.filter(i => i.title === 'Offline B').length === 1 && d.items.find(i => i.id === bId).status === 'doing', 'B saved once, as doing');
  ok(await queueLen() === 0, 'queue empty');
  ok(await pillText() === 'Saved locally', 'pill back to "Saved locally"');
  const toastTxt = await page.locator('.toast').textContent();
  ok(/All changes saved/.test(toastTxt), 'toast: ' + toastTxt);

  // 6. 503 from server (GitHub unreachable) is retried automatically
  let n = 0;
  await page.route('**/api/items/**', r => (r.request().method() === 'PATCH' && ++n <= 1)
    ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Couldn\'t reach GitHub.","code":"network"}' }) : r.continue());
  await page.locator('.card[data-id="' + a.id + '"] [data-act="status"]').click();
  await page.click('#pop [data-s="blocked"]');
  await page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'pending');
  await page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'ok', null, { timeout: 8000 });
  await wait(300);
  ok(disk().items.find(i => i.id === a.id).status === 'blocked', '503 retried automatically and saved');
  await page.unroute('**/api/items/**');

  // 7. Change to an item deleted elsewhere: dropped with a message, not retried forever
  const del = await page.evaluate(() => fetch('/api/items/' + encodeURIComponent(document.querySelector('.card[aria-label="Offline B"]').dataset.id), { method: 'DELETE', headers: { 'X-Triage': '1' } }).then(r => r.status));
  await page.locator('.card[data-id="' + bId + '"] [data-act="status"]').click();
  await page.click('#pop [data-s="testing"]');
  await page.waitForFunction(() => /deleted somewhere else/.test((document.querySelector('.toast') || {}).textContent || ''), null, { timeout: 5000 });
  ok(del === 200, 'deleted B behind the app\'s back');
  ok(await queueLen() === 0, 'stale change dropped with "deleted somewhere else" message');
  await wait(500);
  ok(await page.locator('.card[data-id="' + bId + '"]').count() === 0, 'board caught up: B gone');

  // 8. Snippet added while failing survives refresh, then saves
  await page.route('**/api/snippets**', r => r.request().method() === 'GET' ? r.continue() : r.abort('connectionreset'));
  await page.click('#navSnips');
  await page.click('#snipAdd');
  await page.fill('#sTitleIn', 'Offline snippet');
  await page.fill('#sCode', 'info "hi";');
  await page.click('#sSave');
  await page.waitForFunction(() => document.querySelector('#snippetsView [data-sync]').dataset.state === 'pending');
  ok(/Not saved/.test(await page.locator('#snippetsView [data-sync]').textContent()), 'snippets page pill shows Not saved');
  await page.reload();
  await page.waitForSelector('.sitem');
  ok(await page.locator('.sitem', { hasText: 'Offline snippet' }).count() === 1, 'unsaved snippet still listed after refresh');
  await page.unroute('**/api/snippets**');
  await page.locator('#snippetsView [data-sync]').click();
  await page.waitForFunction(() => document.querySelector('#snippetsView [data-sync]').dataset.state === 'ok', null, { timeout: 10000 });
  await wait(400);
  const snips = fs.readdirSync(path.join(DATA, 'snippets')).filter(f => f.startsWith('offline-snippet-'));
  ok(snips.length === 1, 'snippet saved once: ' + snips.join(','));

  // 9. Projects: add + colour while failing, then saved
  await page.click('#navBoard');
  await page.route('**/api/projects**', r => r.request().method() === 'GET' ? r.continue() : r.abort('connectionreset'));
  await page.click('#manageProj');
  await page.fill('#pNewIn', 'Sync Proj');
  await page.click('#pAdd');
  ok(await page.locator('#plist .pn', { hasText: 'Sync Proj' }).count() === 1, 'project shows straight away');
  await page.fill('#pNewIn', 'sync proj');
  await page.click('#pAdd');
  ok(/already exists/.test(await page.textContent('#pErr')), 'duplicate project blocked in the browser');
  await page.unroute('**/api/projects**');
  await page.locator('#projBg [data-sync], #boardView [data-sync]').first().click({ force: true }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.locator('#boardView [data-sync]').click();
  await page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'ok', null, { timeout: 10000 });
  await wait(300);
  ok(disk().projects.filter(p => p === 'Sync Proj').length === 1, 'project saved once');

  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));

  done();
});
