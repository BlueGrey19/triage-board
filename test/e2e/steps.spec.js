const fs = require('fs');
const path = require('path');
const { test, checks } = require('./helpers');

test.use({ seed: { projects: ['Alpha', 'Beta'], projectColors: {}, items: [] } });

test('steps', async ({ browser, app }, testInfo) => {
  const BASE = app.baseURL;
  const DATA = app.dataDir;
  const { ok, done } = checks(testInfo);
  const disk = () => JSON.parse(fs.readFileSync(path.join(DATA, 'board.json'), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const post = (page, url, body, method) => page.evaluate(async ([u, b, m]) => {
    const r = await fetch(u, { method: m || 'POST', headers: { 'X-Triage': '1', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }, [url, body, method]);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  const st = () => page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'ok', null, { timeout: 15000 });
  const steps = id => (disk().items.find(i => i.id === id) || {}).subtasks;
  const focusCls = () => page.evaluate(() => document.activeElement && document.activeElement.className);

  // an old-style item (no subtasks)
  const board = disk();
  board.items.push({ id: 'i-old1-aaaa', title: 'Old item', project: 'Alpha', group: '', note: '', prio: 'low', status: 'open', createdAt: '2025-01-01T00:00:00.000Z' });
  fs.writeFileSync(path.join(DATA, 'board.json'), JSON.stringify(board));

  await page.goto(BASE);
  await page.waitForSelector('#board .card');
  ok(await page.locator('.card[aria-label="Old item"] .steps').count() === 0, 'old item loads with no chip');
  await page.evaluate(() => fetch('/api/items', { method: 'POST', headers: { 'X-Triage': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Checklist me', prio: 'high', project: 'Alpha' }) }));
  await page.reload();
  await page.waitForSelector('.card[aria-label="Checklist me"]');
  const id = await page.locator('.card[aria-label="Checklist me"]').getAttribute('data-id');
  const card = () => page.locator('.card[data-id="' + id + '"]');
  const openPop = async () => { await card().locator('[data-act="more"]').click(); await page.click('#pop [data-a="open"]'); await page.waitForSelector('#detail .sub-add'); await wait(120); };
  await openPop();

  // 1. add 3 steps with Enter, focus stays
  const add = page.locator('#detail .sub-add');
  await add.focus();
  for (const t of ['First step', 'Second step', 'Third step']) {
    await page.keyboard.type(t); await page.keyboard.press('Enter');
  }
  await st(); await wait(200);
  ok((await focusCls()) === 'sub-add', 'focus stays in add input (' + await focusCls() + ')');
  ok(await add.inputValue() === '', 'add input cleared');
  const s3 = steps(id);
  ok(s3 && s3.length === 3 && s3.map(s => s.text).join('|') === 'First step|Second step|Third step', 'three steps saved in order');
  ok(s3.every(s => /^s-[a-z0-9]+-[a-z0-9]+$/.test(s.id) && s.done === false), 'step ids valid, not done');
  await page.keyboard.type('x'); ok(await add.inputValue() === 'x', 'can keep typing after saves');
  await page.keyboard.press('Escape');
  ok(await add.inputValue() === '' && await page.locator('#detailBg.open').count() === 1, 'Esc in add input clears text, popup stays open');

  // 2. tick one
  await page.locator('#detail .sub').nth(0).locator('.sub-cb').click();
  await st(); await wait(200);
  ok(steps(id)[0].done === true, 'tick saved');
  ok(((await page.locator('#detail .sub-count').textContent()) || '').trim() === '1 of 3', 'popup count 1 of 3');
  ok((await page.locator('#detail .sub-bar').getAttribute('aria-valuenow')) === '1', 'progressbar aria-valuenow=1');
  ok(/sub-cb/.test(await focusCls()), 'checkbox keeps focus after re-render');
  ok(((await card().locator('.steps').textContent()) || '').trim() === '1/3', 'card chip 1/3');
  ok((await card().locator('.steps').getAttribute('aria-label')) === '1 of 3 steps done', 'chip aria-label');

  // 3. edit text: Enter saves; Esc cancels and keeps popup open
  await page.locator('#detail .sub').nth(1).locator('.sub-text').click();
  await page.keyboard.press('Control+a'); await page.keyboard.type('Second step edited'); await page.keyboard.press('Enter');
  await st(); await wait(200);
  ok(steps(id)[1].text === 'Second step edited', 'edit saved with Enter');
  await page.locator('#detail .sub').nth(2).locator('.sub-text').click();
  await page.keyboard.type(' junk'); await page.keyboard.press('Escape');
  await wait(200);
  ok(await page.locator('#detailBg.open').count() === 1, 'Esc while editing keeps popup open');
  ok(await page.locator('#detail .sub-edit').count() === 0 && ((await page.locator('#detail .sub').nth(2).locator('.sub-text').textContent()) === 'Third step'), 'Esc cancelled edit');
  ok(steps(id)[2].text === 'Third step', 'cancelled edit not saved');
  await page.locator('#detail .sub').nth(2).locator('.sub-text').click();
  await page.keyboard.press('Control+a'); await page.keyboard.press('Backspace'); await page.keyboard.press('Enter');
  await wait(200);
  ok(steps(id)[2].text === 'Third step', 'empty edit cancels');

  ok(await page.locator('#detail .sub-edit').count() === 0, 'no edit input left open after empty edit');
  // 4. screenshot

  // 5. remove instant
  await page.locator('#detail .sub').nth(2).hover();
  await page.locator('#detail .sub').nth(2).locator('.sub-rm').click();
  ok(await page.locator('#detail .sub').count() === 2, 'removed from popup instantly');
  await st(); await wait(200);
  ok(steps(id).length === 2 && !steps(id).some(s => s.text === 'Third step'), 'removed from disk');
  ok(await page.locator('#detailBg.open').count() === 1, 'popup stays open after remove');

  // 6. all ticked + compact layout + search
  await page.locator('#detail .sub').nth(1).locator('.sub-cb').click(); await st();
  await page.locator('#detail .sub-add').focus();
  await page.keyboard.press('Escape'); await wait(200);
  ok(await page.locator('#detailBg.open').count() === 0, 'Esc closes popup normally');
  ok(await card().locator('.steps.all').count() === 1, 'chip is "all" when every step ticked');
  await page.click('#layoutSw [data-layout="compact"]'); await wait(200);
  ok(await page.evaluate(() => document.getElementById('board').classList.contains('compact')), 'compact layout on');
  ok(await card().locator('.steps').isVisible(), 'chip visible in compact layout');
  await page.click('#layoutSw [data-layout="cards"]'); await wait(100);
  await page.fill('#boardSearch', 'edited');
  await wait(200);
  ok(await page.locator('.card[data-id="' + id + '"]').count() === 1 && await page.locator('.card[aria-label="Old item"]').count() === 0, 'search finds item by step text');
  await page.fill('#boardSearch', '');

  // 7. typing + edit survive a background re-render; offline steps
  await openPop();
  await page.route('**/api/**', r => r.request().method() === 'GET' ? r.continue() : r.abort('connectionreset'));
  await page.locator('#detail .sub-add').focus();
  await page.keyboard.type('Offline one'); await page.keyboard.press('Enter');
  await page.keyboard.type('Offline two'); await page.keyboard.press('Enter');
  await wait(300);
  ok(await page.locator('#detail .sub').count() === 4, 'steps added while saves fail show immediately');
  ok(steps(id).length === 2, 'not on disk yet');
  await page.reload(); await page.waitForSelector('.card[data-id="' + id + '"]');
  await openPop();
  ok(await page.locator('#detail .sub').count() === 4, 'unsaved steps survive reload');
  await page.locator('#detail .sub').nth(0).locator('.sub-text').click();
  await page.keyboard.type(' +more');
  const editVal = await page.locator('#detail .sub-edit').inputValue();
  await page.unroute('**/api/**');
  await page.evaluate(() => document.querySelector('#boardView [data-sync]').click());
  await st(); await wait(300);
  ok(await page.locator('#detail .sub-edit').count() === 1 && await page.locator('#detail .sub-edit').inputValue() === editVal, 'in-progress edit survives background re-render: ' + editVal);
  ok((await focusCls()) === 'sub-edit', 'edit input keeps focus');
  const sv = steps(id);
  ok(sv.length === 4 && sv.filter(s => s.text === 'Offline one').length === 1 && sv.filter(s => s.text === 'Offline two').length === 1, 'offline steps saved exactly once');
  await page.keyboard.press('Escape');
  // add box text survives a background re-render
  await page.locator('#detail .sub-add').focus();
  await page.keyboard.type('half typed');
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('ArrowLeft');
  await page.route('**/api/**', r => r.request().method() === 'GET' ? r.continue() : r.abort('connectionreset'));
  await page.locator('#detail .sub').nth(0).locator('.sub-cb').evaluate(el => el.click()); // queued tick
  await page.locator('#detail .sub-add').focus();
  await page.keyboard.type('Z');
  await page.unroute('**/api/**');
  await page.evaluate(() => document.querySelector('#boardView [data-sync]').click());
  await st(); await wait(300);
  const av = await page.locator('#detail .sub-add').inputValue();
  ok(av === 'half typZed', 'add input text and caret survive re-render: ' + av);
  ok((await focusCls()) === 'sub-add', 'add input keeps focus');
  await page.locator('#detail .sub-add').fill('');

  // 8. server behaviour
  const many = []; for (let i = 0; i < 60; i++) many.push({ text: 'm' + i });
  const dupId = 's-dup-1';
  const r1 = await post(page, '/api/items', { title: 'Pasted', subtasks: [{ text: 'a' }, { text: '   ' }, { id: dupId, text: 'dup1' }, { id: dupId, text: 'dup2' }, { id: 'bad id!', text: 'badid', done: true }, { text: 'tick', done: 1 }] });
  const ps = r1.body.subtasks;
  ok(ps && ps.length === 4 && ps.every(s => /^s-[a-z0-9]{1,16}-[a-z0-9]{1,16}$/.test(s.id)), 'create with subtasks sanitised (empty+dup dropped, ids valid)');
  ok(ps.find(s => s.text === 'tick').done === true && ps.find(s => s.text === 'a').done === false, 'done coerced to boolean');
  const r2 = await post(page, '/api/items', { title: 'Many', subtasks: many });
  ok(r2.body.subtasks.length === 50, 'create caps at 50');
  const r3 = await post(page, '/api/items', { title: 'Plain' });
  ok(!('subtasks' in r3.body), 'item without subtasks gets no field');
  const patched = await post(page, '/api/items/' + r1.body.id, { subtasks: [], title: 'Pasted2' }, 'PATCH');
  ok(patched.body.subtasks.length === 4 && patched.body.title === 'Pasted2', 'PATCH item ignores subtasks');
  const u = '/api/items/' + id + '/subtasks';
  const a1 = await post(page, u, { id: 's-rep-1', text: 'Repeat' });
  const a2 = await post(page, u, { id: 's-rep-1', text: 'Repeat' });
  ok(a1.status === 200 && a2.status === 200 && steps(id).filter(s => s.id === 's-rep-1').length === 1, 'repeated POST of same step id does not duplicate');
  ok((await post(page, u, { id: 's-x-1', text: '  ' })).status === 400, 'empty step text 400');
  ok((await post(page, '/api/items/i-nope-1/subtasks', { text: 'x' })).status === 404, 'POST unknown item 404');
  ok((await post(page, '/api/items/' + r2.body.id + '/subtasks', { text: 'one more' })).status === 400, '51st step 400');
  ok((await post(page, u + '/bad!', { text: 'x' }, 'PATCH')).status === 400, 'bad step id 400');
  ok((await post(page, u + '/s-nope-1', { text: 'x' }, 'PATCH')).status === 404, 'PATCH unknown step 404');
  ok((await post(page, u + '/s-rep-1', { text: '' }, 'PATCH')).status === 400, 'PATCH empty text 400');
  const pt = await post(page, u + '/s-rep-1', { done: true }, 'PATCH');
  ok(pt.status === 200 && pt.body.subtasks.find(s => s.id === 's-rep-1').done === true && pt.body.subtasks.find(s => s.id === 's-rep-1').text === 'Repeat', 'PATCH done only keeps text');
  const d1 = await post(page, u + '/s-rep-1', null, 'DELETE');
  const d2 = await post(page, u + '/s-rep-1', null, 'DELETE');
  const d3 = await post(page, '/api/items/i-nope-1/subtasks/s-a-1', null, 'DELETE');
  ok(d1.status === 200 && d2.status === 200 && d3.status === 200 && !steps(id).some(s => s.id === 's-rep-1'), 'DELETE idempotent, gone item ok');
  const only = await post(page, '/api/items', { title: 'One step', subtasks: [{ id: 's-only-1', text: 'x' }] });
  await post(page, '/api/items/' + only.body.id + '/subtasks/s-only-1', null, 'DELETE');
  ok(!('subtasks' in disk().items.find(i => i.id === only.body.id)), 'removing last step removes field');

  // 9. phone + light screenshots
  await page.reload(); await page.waitForSelector('.card[data-id="' + id + '"]');
  await page.setViewportSize({ width: 390, height: 800 });
  await openPop();
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.emulateMedia({ colorScheme: 'light' });
  await wait(200);

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

  done();
});

test('steps: clicking another step after editing one', async ({ browser, app }, testInfo) => {
  const BASE = app.baseURL;
  const DATA = app.dataDir;
  const { ok, done } = checks(testInfo);
  const disk = () => JSON.parse(fs.readFileSync(path.join(DATA, 'board.json'), 'utf8'));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  // Its own context: the browser is shared with the other specs, so only this is closed at the end.
  const b = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const p = await b.newPage();
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(BASE);
  await p.evaluate(() => fetch('/api/items', { method: 'POST', headers: { 'X-Triage': '1', 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Click test', subtasks: [{ text: 'One' }, { text: 'Two' }, { text: 'Three' }] }) }));
  await p.reload(); await p.waitForSelector('#board .card');
  const st = () => p.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'ok', null, { timeout: 15000 });
  const steps = () => disk().items[0].subtasks.map(s => s.text + (s.done ? '✓' : ''));
  await p.locator('.card [data-act="more"]').first().click();
  await p.click('#pop [data-a="open"]');
  await wait(150);

  // edit One, then click Three's × straight away
  await p.locator('.sub').nth(0).locator('.sub-text').click();
  await p.keyboard.press('End'); await p.keyboard.type(' edited');
  await p.locator('.sub').nth(2).locator('.sub-rm').click({ force: true });
  await st(); await wait(400);
  ok(JSON.stringify(steps()) === JSON.stringify(['One edited', 'Two']), 'edit saved AND first click removed step: ' + steps());

  // edit Two, then click One's checkbox
  await p.locator('.sub').nth(1).locator('.sub-text').click();
  await p.keyboard.type('Second');
  await p.locator('.sub').nth(0).locator('.sub-cb').click();
  await st(); await wait(400);
  ok(JSON.stringify(steps()) === JSON.stringify(['One edited✓', 'Second']), 'edit saved AND first click ticked: ' + steps());

  // edit Second, then click One's text to edit it instead
  await p.locator('.sub').nth(1).locator('.sub-text').click();
  await p.keyboard.type('Second step');
  await p.locator('.sub').nth(0).locator('.sub-text').click();
  await wait(300);
  ok(await p.locator('.sub').nth(0).locator('.sub-edit').count() === 1, 'first click opened the other step for editing');
  await st(); await wait(300);
  ok(steps()[1] === 'Second step', 'previous edit saved');
  ok(errors.length === 0, 'no page errors ' + errors.join(' | '));
  await b.close();

  done();
});
