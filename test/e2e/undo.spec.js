const fs = require('fs');
const path = require('path');
const { test, checks } = require('./helpers');

test.use({ seed: { projects: ['Alpha', 'Beta'], projectColors: {}, items: [] } });

test('undo', async ({ browser, app }, testInfo) => {
  const BASE = app.baseURL;
  const DATA = app.dataDir;
  const { ok, done } = checks(testInfo);
  const disk = () => JSON.parse(fs.readFileSync(path.join(DATA, 'board.json'), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const st = () => page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'ok', null, { timeout: 15000 });
  const toastTxt = async () => ((await page.locator('.toast').textContent()) || '').trim();
  const toastShown = () => page.evaluate(() => { const t = document.querySelector('.toast'); return !!t && t.classList.contains('show'); });
  const undoVisible = () => page.locator('.toast.show .toast-btn:not([hidden])').count();
  const item = id => disk().items.find(i => i.id === id);

  await page.goto(BASE);
  await page.waitForSelector('#board .card, #board .empty');
  await page.evaluate(() => fetch('/api/items', { method: 'POST', headers: { 'X-Triage': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Undo me', prio: 'high', project: 'Alpha' }) }));
  await page.reload();
  await page.waitForSelector('#board .card');
  const id = await page.locator('.card[aria-label="Undo me"]').getAttribute('data-id');
  const card = () => page.locator('.card[data-id="' + id + '"]');

  // 1. Status via popover, undo with button
  await card().locator('[data-act="status"]').click();
  await page.click('#pop [data-s="testing"]');
  await st();
  ok(item(id).status === 'testing', 'status saved');
  ok(/“Undo me” moved to Testing/.test(await toastTxt()) && await undoVisible() === 1, 'toast: ' + await toastTxt());
  await page.click('.toast-btn');
  await st(); await wait(300);
  ok(item(id).status === 'open', 'undo button restored status');
  ok(await card().locator('.pill').textContent() === 'Open', 'card shows Open again');
  ok(/Change undone/.test(await toastTxt()) && await undoVisible() === 0, 'then "Change undone" without Undo');

  // 2. Done toggle + Ctrl+Z
  await card().locator('[data-act="done"]').click();
  await st();
  ok(/marked done/.test(await toastTxt()), 'done toast: ' + await toastTxt());
  await page.keyboard.press('Control+z');
  await st(); await wait(300);
  ok(item(id).status === 'open', 'Ctrl+Z undid "done"');

  // 3. Priority via drag
  const src = card();
  const target = page.locator('.band-body').nth(0); // critical band
  await src.dragTo(target);
  await st();
  ok(item(id).prio === 'critical', 'drag set prio critical');
  ok(/set to Critical priority/.test(await toastTxt()), 'drag toast: ' + await toastTxt());
  await page.keyboard.press('Control+z');
  await st(); await wait(300);
  ok(item(id).prio === 'high', 'Ctrl+Z restored High');

  // 4. Edit in popup: project + note, undo restores both
  await card().locator('[data-act="more"]').click();
  await page.click('#pop [data-a="edit"]');
  await page.evaluate(() => { const s = document.getElementById('mProj'); s.value = 'Beta'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#mNote', 'a note');
  await page.click('#mSave');
  await st();
  ok(item(id).project === 'Beta' && item(id).note === 'a note', 'edit saved');
  ok(/“Undo me” updated/.test(await toastTxt()), 'edit toast: ' + await toastTxt());
  await page.click('.toast-btn');
  await st(); await wait(300);
  ok(item(id).project === 'Alpha' && item(id).note === '', 'undo restored project and note');

  // 5. Saving the popup with no changes: no save, no toast
  await page.evaluate(() => { const t = document.querySelector('.toast'); t.classList.remove('show'); });
  await card().locator('[data-act="more"]').click();
  await page.click('#pop [data-a="edit"]');
  await page.click('#mSave');
  await wait(400);
  ok(!(await toastShown()), 'unchanged edit: no message');

  // 6. Ctrl+Z while typing in a field does nothing to the board
  await card().locator('[data-act="status"]').click();
  await page.click('#pop [data-s="blocked"]');
  await st();
  await page.click('#boardSearch');
  await page.keyboard.type('x');
  await page.keyboard.press('Control+z');
  await wait(400);
  ok(item(id).status === 'blocked', 'Ctrl+Z in search box left the board alone');
  await page.fill('#boardSearch', '');
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});

  // 7. Hover keeps it open past 6s; it closes after leaving
  await card().locator('[data-act="status"]').click();
  await page.click('#pop [data-s="doing"]');
  await st();
  await page.hover('.toast');
  await wait(7000);
  ok(await toastShown(), 'hovering keeps the message open past 6s');
  await page.mouse.move(5, 5);
  await wait(6500);
  ok(!(await toastShown()), 'closes 6s after the mouse leaves');
  await page.keyboard.press('Control+z');
  await wait(400);
  ok(item(id).status === 'doing', 'Ctrl+Z after the message closed does nothing');

  // 8. Keyboard: Tab-focus the Undo button keeps it open, Enter undoes
  await card().locator('[data-act="status"]').click();
  await page.click('#pop [data-s="testing"]');
  await st();
  await page.focus('.toast-btn');
  await wait(7000);
  ok(await toastShown(), 'focus keeps the message open');
  await page.keyboard.press('Enter');
  await st(); await wait(300);
  ok(item(id).status === 'doing', 'Enter on focused Undo works');
  ok(await page.evaluate(() => document.querySelector('.toast').getAttribute('role')) === 'status', 'message has role=status');

  // 9. Offline: change + undo both queued, saved in order when back
  await page.route('**/api/**', r => r.request().method() === 'GET' ? r.continue() : r.abort('connectionreset'));
  await card().locator('[data-act="status"]').click();
  await page.click('#pop [data-s="blocked"]');
  await page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'pending');
  ok(await undoVisible() === 1, 'save failure toast didn’t push Undo off screen');
  await page.keyboard.press('Control+z');
  ok(await card().locator('.pill').textContent() === 'Doing', 'undo shows straight away while failing');
  await page.unroute('**/api/**');
  await page.locator('#boardView [data-sync]').click();
  await st(); await wait(400);
  ok(item(id).status === 'doing', 'after reconnect the end result is the undone value');

  // 10. Undo after the item was deleted elsewhere
  await card().locator('[data-act="status"]').click();
  await page.click('#pop [data-s="testing"]');
  await st();
  await page.evaluate(id => { const i = board.items; }, id).catch(() => {});
  await page.evaluate(id => fetch('/api/items/' + id, { method: 'DELETE', headers: { 'X-Triage': '1' } }), id);
  await page.evaluate(() => window.dispatchEvent(new Event('online'))); // nudge a reload
  await wait(800);
  await page.keyboard.press('Control+z');
  await wait(800);
  ok(!disk().items.some(i => i.id === id), 'deleted item not recreated by undo');
  ok(/no longer exists|deleted somewhere else/.test(await toastTxt()), 'deleted elsewhere: ' + await toastTxt());

  // phone width screenshot
  await page.setViewportSize({ width: 390, height: 700 });
  await page.evaluate(() => fetch('/api/items', { method: 'POST', headers: { 'X-Triage': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'A fairly long item title for the phone layout check', prio: 'low' }) }));
  await page.reload();
  await page.waitForSelector('#board .card');
  await page.locator('.card:visible [data-act="done"]').first().click();
  await st();

  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));

  done();
});
