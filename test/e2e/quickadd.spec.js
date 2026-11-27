const fs = require('fs');
const path = require('path');
const { test, checks } = require('./helpers');

test.use({ seed: require('./fixtures/quickadd-board.json') });

test('quickadd', async ({ browser, app }, testInfo) => {
  const BASE = app.baseURL;
  const DATA = app.dataDir;
  const { ok, done } = checks(testInfo);
  const disk = () => JSON.parse(fs.readFileSync(path.join(DATA, 'board.json'), 'utf8'));
  const byTitle = t => disk().items.filter(i => i.title === t);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.on('pageerror', e => ok(false, 'page error: ' + e.message));
  const posts = [];
  page.on('request', r => { if (r.method() === 'POST' && r.url().endsWith('/api/items/batch')) posts.push(r.postData()); });
  const st = () => page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'ok', null, { timeout: 15000 }).then(() => wait(300));
  const api = (m, u, b) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { 'X-Triage': '1', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
    .then(async r => ({ s: r.status, j: await r.json().catch(() => null) })), [m, u, b]);
  const setSel = (id, v) => page.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const isOpen = () => page.locator('#qaBg.open').count().then(n => n === 1);
  const fillList = async t => { await page.fill('#qaText', t); await wait(350); };
  const prev = () => page.evaluate(() => Array.from(document.querySelectorAll('#qaPrev .qa-item')).map(it => ({
    title: it.querySelector('.qa-title').value,
    prio: it.querySelector('.qa-prio').value,
    steps: Array.from(it.querySelectorAll('.qa-stext')).map(s => s.value)
  })));
  const titles = async () => (await prev()).map(i => i.title);
  const count = () => page.locator('#qaCount').textContent();
  const open = async () => { await page.click('#qaBtn'); await page.waitForSelector('#qaBg.open'); await wait(100); };
  const closeEmpty = async () => { await page.keyboard.press('Escape'); await wait(100); };
  const closeToast = () => page.evaluate(() => { const t = document.querySelector('.toast'); if (t) t.classList.remove('show'); });

  const seed = disk();
  const baseCount = seed.items.length;
  await page.goto(BASE);
  await page.waitForSelector('#board .card');

  /* ---------- open: button, shortcut ---------- */
  ok(await page.locator('#qaBtn').isVisible(), 'Quick add button is in the board header');
  await open();
  ok(await isOpen(), 'button opens the window');
  ok(await page.evaluate(() => document.activeElement.id) === 'qaText', 'focus goes to the textarea');
  ok(await page.getAttribute('#qaText', 'aria-label') === 'List to add', 'textarea has aria-label "List to add"');
  ok(/One item per line/.test(await page.textContent('#qaHint')), 'hint shown');
  ok((await page.getAttribute('#qaText', 'placeholder')).indexOf('\n') > 0, 'placeholder shows the format');
  ok(await page.locator('#qaAdd').isDisabled(), 'Add disabled at 0 items');
  await closeEmpty();
  ok(!(await isOpen()), 'Esc closes an empty window without asking');
  ok(await page.evaluate(() => document.activeElement.id) === 'qaBtn', 'focus returns to the Quick add button');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('q');
  await wait(100);
  ok(await isOpen(), '"q" opens the window');
  await closeEmpty();
  await page.keyboard.press('Q');
  await wait(100);
  ok(await isOpen(), '"Q" opens the window');
  await closeEmpty();
  await page.click('#boardSearch');
  await page.keyboard.type('q');
  await wait(100);
  ok(!(await isOpen()), '"q" while typing in search does not open it');
  await page.fill('#boardSearch', '');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Control+q');
  ok(!(await isOpen()), 'Ctrl+q does not open it');
  await page.keyboard.press('n'); await wait(100);
  ok(await page.locator('#modalBg.open').count() === 1, 'n still opens the single Add item window');
  await page.keyboard.press('q'); await wait(100);
  ok(!(await isOpen()), '"q" with another window open does nothing');
  await page.keyboard.press('Escape'); await wait(100);

  /* ---------- defaults from filters ---------- */
  await page.click('#navProjects [data-v="Alpha"]');
  await wait(150);
  await page.locator('.card [data-act="group"][data-g="Docs"]').first().click();
  await wait(150);
  await open();
  ok(await page.inputValue('#qaProj') === 'Alpha', 'default project = filtered project');
  ok(await page.inputValue('#qaGroup') === 'Docs', 'default group = filtered group');
  ok(await page.inputValue('#qaPrio') === 'medium', 'default priority = medium');
  const projOpts = await page.evaluate(() => Array.from(document.getElementById('qaProj').options).map(o => o.text));
  ok(same(projOpts, ['(no project)', 'Alpha', 'Beta']), 'project options include (no project)');
  await closeEmpty();

  /* ---------- preview + add ---------- */
  await open();
  await fillList('- Fix login redirect\n    - Check callback URL\n    - Test on Safari\n- Update invoice template\n    - Remove old logo\n2) Send release notes\n- Throwaway item\n');
  ok(/4 items · 3 steps/.test(await count()), 'live count: 4 items · 3 steps (' + (await count()) + ')');
  ok(await page.locator('#qaAdd').textContent() === 'Add 4 items', 'button says Add 4 items');
  ok(await page.getAttribute('#qaCount', 'aria-live') === 'polite', 'count is aria-live polite');
  ok(same(await titles(), ['Fix login redirect', 'Update invoice template', 'Send release notes', 'Throwaway item']), 'preview titles');
  await page.locator('.qa-title').nth(1).fill('Update invoice layout');
  await page.locator('.qa-prio').nth(2).selectOption('high');
  await page.click('[aria-label="Remove Throwaway item"]');
  await page.click('[aria-label="Remove step Test on Safari"]');
  ok(/^3 items · 2 steps/.test(await count()), 'count after removals: ' + (await count()));
  ok(await page.locator('#qaAdd').textContent() === 'Add 3 items', 'button says Add 3 items');
  await setSel('qaPrio', 'low');
  const pv = await prev();
  ok(same(pv.map(i => i.prio), ['low', 'low', 'high']), 'batch priority change updates only untouched items');
  ok(pv[1].title === 'Update invoice layout', 'edited title survives re-render');
  await page.click('#qaAdd');
  await st();
  ok(!(await isOpen()), 'window closed after adding');
  ok(/3 items added/.test(await page.textContent('.toast .toast-msg')), 'toast "3 items added"');
  ok(posts.length === 1, 'exactly ONE POST to /api/items/batch (' + posts.length + ')');
  const d1 = disk();
  ok(d1.items.length === baseCount + 3, 'exactly 3 new items on disk');
  const a = byTitle('Fix login redirect')[0], b = byTitle('Update invoice layout')[0], c = byTitle('Send release notes')[0];
  ok(a && b && c && byTitle('Throwaway item').length === 0 && byTitle('Update invoice template').length === 0, 'right titles saved');
  ok(a.prio === 'low' && b.prio === 'low' && c.prio === 'high', 'priorities saved');
  ok([a, b, c].every(i => i.project === 'Alpha' && i.group === 'Docs' && i.status === 'open'), 'project, group, status open');
  ok([a, b, c].every(i => i.stage === 'golive'), "stage = the project's current stage (golive)");
  ok(same(a.subtasks.map(s => s.text), ['Check callback URL']) && same(b.subtasks.map(s => s.text), ['Remove old logo']) && !c.subtasks, 'steps saved');
  ok(a.subtasks.every(s => /^s-/.test(s.id) && s.done === false), 'step ids and done=false');
  ok(await page.locator('.card', { hasText: 'Fix login redirect' }).count() === 1, 'items shown on the board');
  await closeToast();

  /* ---------- Ctrl+Enter ---------- */
  await open();
  await fillList('Ctrl one\nCtrl two');
  await page.press('#qaText', 'Control+Enter');
  await st();
  ok(!(await isOpen()) && byTitle('Ctrl one').length === 1 && byTitle('Ctrl two').length === 1, 'Ctrl+Enter adds');
  ok(posts.length === 2, 'second batch = second POST');
  await closeToast();

  /* ---------- filters relax ---------- */
  await open();
  await setSel('qaProj', 'Beta');
  await page.fill('#qaGroup', '');
  await fillList('Beta thing');
  await page.click('#qaAdd');
  await st();
  ok(await page.locator('.card', { hasText: 'Beta thing' }).count() === 1, 'filters relaxed: item in another project/group is visible');
  ok(byTitle('Beta thing')[0].project === 'Beta' && byTitle('Beta thing')[0].stage === 'implementation', 'Beta item saved with its current stage (Implementation)');
  await closeToast();
  await page.fill('#boardSearch', 'Existing');
  await wait(200);
  await open();
  await fillList('Unsearched item');
  await page.click('#qaAdd');
  await st();
  ok(await page.inputValue('#boardSearch') === '' && await page.locator('.card', { hasText: 'Unsearched item' }).count() === 1, 'search relaxed when the new items would not match');
  await closeToast();

  /* ---------- parsing, through the window ---------- */
  await open();
  await fillList('- a\n* b\n• c\n– d\n· e\n1. f\n1) g\n(1) h\na. i\nb) j\n   \n\n');
  ok(same(await titles(), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']), 'all bullet/numbering kinds stripped, blank lines ignored');
  await fillList('Top\n  - s1\n  s2\n\t3) s3\n\t\n    * s4');
  let p = await prev();
  ok(p.length === 1 && same(p[0].steps, ['s1', 's2', 's3', 's4']), 'indented lines (spaces, tab, with/without bullets) become steps');
  await fillList('  first\nsecond\n    - sub of second');
  p = await prev();
  ok(p.length === 2 && p[0].title === 'first' && !p[0].steps.length && same(p[1].steps, ['sub of second']), 'indented line before any item becomes an item');
  await fillList('-   spaced bullet\n-\n- \nplain - dash inside');
  ok(same(await titles(), ['spaced bullet', 'plain - dash inside']), 'empty-after-strip lines ignored; inner dashes kept');
  const long = 'abcdefghi '.repeat(25).trim();
  await fillList('Long: ' + long + '\n' + '    ' + 'x '.repeat(150).trim());
  p = await prev();
  ok(p[0].title.length <= 200 && p[0].title.length > 150 && !/\s$/.test(p[0].title) && ('Long: ' + long).startsWith(p[0].title) && /\w$/.test(p[0].title) &&
     ('Long: ' + long).charAt(p[0].title.length) === ' ', 'long line: title cut at a word boundary (len ' + p[0].title.length + ')');
  ok(p[0].steps[0].length <= 200, 'long step cut to 200');
  await page.click('#qaAdd'); await st();
  const longItem = disk().items.find(i => i.title.startsWith('Long: abc'));
  ok(longItem && longItem.note === 'Long: ' + long, 'long line: full text kept as the note');
  await closeToast();
  await open();
  await fillList('One\n' + Array.from({ length: 51 }, (_, i) => '  step ' + (i + 1)).join('\n'));
  p = await prev();
  ok(p.length === 1 && p[0].steps.length === 50, '51 indented lines -> 50 steps');
  ok(/1 extra step was left out/.test(await page.textContent('#qaErr')), 'preview says a step was left out');
  await fillList('Dear team,\n\nPlease see the amendments below:\n1. Update the pricing page\n    - Change the monthly plan to $19\n    - Remove the legacy tier\n2) Fix the footer links\n    a. Terms\n    b. Privacy\n3. Send the new brochure to print\n\nKind regards,\nSam');
  p = await prev();
  ok(same(p.map(i => i.title), ['Dear team,', 'Please see the amendments below:', 'Update the pricing page', 'Fix the footer links', 'Send the new brochure to print', 'Kind regards,', 'Sam']), 'email paste: items');
  ok(same(p[2].steps, ['Change the monthly plan to $19', 'Remove the legacy tier']) && same(p[3].steps, ['Terms', 'Privacy']), 'email paste: sub-points are steps');
  // empty title after editing is skipped
  await page.locator('.qa-title').nth(0).fill('   ');
  await page.locator('.qa-title').nth(6).fill('');
  ok(/^5 items/.test(await count()) && await page.locator('#qaAdd').textContent() === 'Add 5 items', 'empty titles are not counted');
  // textarea edit after preview edits re-parses fresh
  await page.fill('#qaText', 'fresh a\nfresh b'); await wait(350);
  ok(same(await titles(), ['fresh a', 'fresh b']), 'textarea edit re-parses fresh');

  /* ---------- 101 items ---------- */
  await fillList(Array.from({ length: 101 }, (_, i) => 'Bulk ' + (i + 1)).join('\n'));
  ok(await page.locator('#qaAdd').isDisabled(), '101 items: Add disabled');
  ok(/Up to 100 items at a time/.test(await page.textContent('#qaErr')), '101 items: message');
  const pc = posts.length;
  await page.press('#qaText', 'Control+Enter'); await wait(300);
  ok(await isOpen() && posts.length === pc, 'Ctrl+Enter at 101 does nothing');
  await page.locator('[aria-label="Remove Bulk 101"]').click();
  ok(await page.locator('#qaAdd').isEnabled() && await page.locator('#qaAdd').textContent() === 'Add 100 items', 'removing one enables Add 100 items');
  ok(!/Up to 100/.test(await page.textContent('#qaErr')), 'message cleared');

  /* ---------- Esc with text asks ---------- */
  await page.focus('#qaText');
  await page.keyboard.press('Escape'); await wait(150);
  ok(await page.locator('#confirmBg.open').count() === 1 && (await page.textContent('#cTitle')) === 'Discard this list?', 'Esc with text asks "Discard this list?"');
  await page.keyboard.press('Escape'); await wait(150);
  ok(await page.locator('#confirmBg.open').count() === 0 && await isOpen(), 'Esc on the question keeps the window and the text');
  ok((await page.inputValue('#qaText')).startsWith('Bulk 1'), 'text still there');
  await page.click('#qaCancel'); await wait(150);
  ok(await page.locator('#confirmBg.open').count() === 1, 'Cancel with text asks too');
  await page.click('#cOk'); await wait(200);
  ok(!(await isOpen()), 'Discard closes the window');
  ok(await page.evaluate(() => document.activeElement.id) === 'qaBtn', 'focus back on Quick add');
  const afterDiscard = disk().items.length;
  await open();
  ok(await page.inputValue('#qaText') === '', 'reopened window is empty');
  await closeEmpty();

  /* ---------- retried batch is idempotent ---------- */
  const items = [
    { id: 'i-retry-1', title: 'Retry A', project: 'Alpha', prio: 'high', group: '', status: 'open', subtasks: [{ id: 's-r1', text: 'x' }] },
    { id: 'i-retry-2', title: 'Retry B', project: '', prio: 'low', group: '', status: 'open' }
  ];
  const r1 = await api('POST', '/api/items/batch', { items });
  const r2 = await api('POST', '/api/items/batch', { items });
  ok(r1.s === 200 && r1.j.added === 2 && r2.s === 200 && r2.j.added === 0 && r2.j.ok === true, 'retry: added 2 then added 0 (' + JSON.stringify(r1.j) + JSON.stringify(r2.j) + ')');
  ok(byTitle('Retry A').length === 1 && byTitle('Retry B').length === 1 && disk().items.length === afterDiscard + 2, 'retry: no duplicates');
  ok(byTitle('Retry A')[0].stage === 'golive' && byTitle('Retry B')[0].stage === undefined, 'server stamps stage for project items only');
  ok((await api('POST', '/api/items/batch', { items: [] })).s === 400, '400 for empty');
  ok((await api('POST', '/api/items/batch', {})).s === 400, '400 for not an array');
  const r101 = await api('POST', '/api/items/batch', { items: Array.from({ length: 101 }, (_, i) => ({ id: 'i-big-' + i, title: 'B' + i })) });
  ok(r101.s === 400, '400 for 101 items (' + JSON.stringify(r101.j) + ')');
  ok((await api('POST', '/api/items/batch', { items: [{ id: 'i-ok-1', title: '  ' }] })).s === 400, '400 for empty title');
  ok((await api('POST', '/api/items/batch', { items: [{ title: 'No id' }] })).s === 400, '400 for missing id');
  ok((await api('POST', '/api/items/batch', { items: [{ id: 'bad id!', title: 'Bad id' }] })).s === 400, '400 for invalid id');
  ok(disk().items.length === afterDiscard + 2, '400s changed nothing');

  /* ---------- offline ---------- */
  await page.route('**/api/**', r => (r.request().method() === 'GET' ? r.continue() : r.abort('connectionreset')));
  await open();
  await fillList('Off one\n   - off step\nOff two');
  await page.click('#qaAdd');
  await wait(600);
  ok(await page.locator('.card', { hasText: 'Off one' }).count() === 1 && await page.locator('.card', { hasText: 'Off two' }).count() === 1, 'offline: items shown immediately');
  ok(byTitle('Off one').length === 0, 'offline: not on disk yet');
  await page.reload();
  await page.waitForSelector('#board .card');
  await wait(600);
  ok(await page.locator('.card', { hasText: 'Off one' }).count() === 1 && await page.locator('.card', { hasText: 'Off two' }).count() === 1, 'offline: items survive a reload');
  const before = posts.length;
  await page.unroute('**/api/**');
  await page.click('#boardView [data-sync]');
  await st();
  ok(byTitle('Off one').length === 1 && byTitle('Off two').length === 1 && byTitle('Off one')[0].subtasks.length === 1, 'offline: saved exactly once after reconnect');
  ok(disk().items.length === afterDiscard + 4, 'offline: no duplicates (' + disk().items.length + ')');
  await page.reload(); await page.waitForSelector('#board .card'); await wait(500);
  ok(await page.locator('.card', { hasText: 'Off one' }).count() === 1, 'after reload: shown once');

  /* ---------- looks ---------- */
  await page.evaluate(() => { const t = document.querySelector('.toast'); if (t) t.remove(); });
  const list = '- Fix login redirect\n    - Check callback URL\n    - Test on Safari and Edge\n- Update invoice template\n    - Replace the old logo\n- Send the release notes to the finance team\n- Review the Q3 pricing sheet\n    - Compare with last quarter\n- Book the training room\n- Reply to Amanda about the audit';
  await page.click('#navBoard');
  await open();
  await fillList(list);
  await page.locator('.qa-prio').nth(1).selectOption('high');
  await page.evaluate(() => document.querySelector('#themeSw [data-theme-pref="light"]').click());
  await wait(300);
  await page.evaluate(() => document.querySelector('#themeSw [data-theme-pref="dark"]').click());
  await closeEmpty(); await page.keyboard.press('Escape'); await wait(100);
  await page.evaluate(() => { document.getElementById('qaText').value = ''; });
  const ph = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const pp = await ph.newPage();
  pp.on('pageerror', e => ok(false, 'page error: ' + e.message));
  await pp.goto(BASE); await pp.waitForSelector('#board .card');
  await pp.evaluate(() => document.getElementById('qaBtn').click());
  await pp.fill('#qaText', list); await wait(400);
  const pm = await pp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, m: document.querySelector('#qaBg .modal').getBoundingClientRect().width }));
  ok(pm.sw <= pm.iw && pm.m >= 388, 'phone: no horizontal overflow, window full width (' + JSON.stringify(pm) + ')');
  await pp.evaluate(() => document.getElementById('qaPrev').scrollTo(0, 9999));

  done();
});

test('quickadd: descriptions', async ({ browser, app }, testInfo) => {
  const { ok, done } = checks(testInfo);
  const disk = () => JSON.parse(fs.readFileSync(path.join(app.dataDir, 'board.json'), 'utf8'));
  const byTitle = t => disk().items.filter(i => i.title === t);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.on('pageerror', e => ok(false, 'page error: ' + e.message));
  page.on('dialog', d => d.accept());
  const st = () => page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'ok', null, { timeout: 15000 }).then(() => wait(300));
  const open = async () => { await page.click('#qaBtn'); await page.waitForSelector('#qaBg.open'); await wait(100); };
  const notes = () => page.evaluate(() => Array.from(document.querySelectorAll('#qaPrev .qa-item')).map(it => {
    const n = it.querySelector('.qa-note');
    return { title: it.querySelector('.qa-title').value, note: n ? n.value : null, toggle: !!it.querySelector('.qa-addnote'), steps: it.querySelectorAll('.qa-stext').length };
  }));

  await page.goto(app.baseURL);
  await page.waitForSelector('#board .card');
  await open();
  ok(/Lines starting with >/.test(await page.textContent('#qaHint')), 'hint explains > lines');

  // "> " lines, indented or not, become the description of the item above
  await page.fill('#qaText', '> Quote before any item\nFix invoice rounding\n    > Totals are out by a cent.\n    >Seen on SO-1043.\n    - Check line items\n> Not indented either\n>\nUpdate template\n- Leads');
  await wait(350);
  const n1 = await notes();
  ok(n1.length === 4, '4 items (' + n1.map(n => n.title).join(' | ') + ')');
  ok(n1[0].title === 'Quote before any item' && n1[0].note === null && n1[0].toggle, 'a > line before any item becomes an item');
  ok(n1[1].title === 'Fix invoice rounding' && n1[1].note === 'Totals are out by a cent.\nSeen on SO-1043.\nNot indented either', 'description from > lines (indented, no space, not indented; empty > ignored): ' + JSON.stringify(n1[1].note));
  ok(n1[1].steps === 1, 'steps still work alongside a description');
  ok(n1[2].note === null && n1[2].toggle && n1[3].title === 'Leads', 'items without > lines show "+ Add description"');
  ok(/3 steps|1 step/.test(await page.textContent('#qaCount')) && /4 items/.test(await page.textContent('#qaCount')), 'count: ' + await page.textContent('#qaCount'));

  // a long title keeps its full text first, then the > lines
  const long = 'word '.repeat(50).trim();
  await page.fill('#qaText', long + '\n  > extra detail'); await wait(350);
  const n2 = await notes();
  ok(n2[0].note === long + '\nextra detail', 'long title: full text then > lines');

  // "+ Add description" opens a box, focused; typing updates the item
  await page.fill('#qaText', 'Leads\nContacts\nMembers\nAccreditations'); await wait(350);
  await page.locator('.qa-item').nth(1).locator('.qa-addnote').click();
  ok(await page.evaluate(() => document.activeElement.classList.contains('qa-note')), '"+ Add description" opens a focused box');
  ok((await page.locator('.qa-item').nth(1).locator('.qa-note').getAttribute('aria-label')) === 'Description for Contacts', 'box is labelled');
  await page.keyboard.type('Contacts only: also check the mobile field');

  // shared description goes first on every item
  await page.fill('#qaNote', 'Validation rule: criteria to function, regex ^[0-9]{10}$');
  await page.press('#qaText', 'Control+Enter');
  await st();
  const shared = 'Validation rule: criteria to function, regex ^[0-9]{10}$';
  ok(['Leads', 'Members', 'Accreditations'].every(t => byTitle(t)[0] && byTitle(t)[0].note === shared), 'shared description on every item');
  ok(byTitle('Contacts')[0].note === shared + '\n\nContacts only: also check the mobile field', 'shared first, then the item\'s own');
  await page.locator('.card', { hasText: 'Contacts' }).first().locator('[data-act="more"]').click();
  await page.click('#pop [data-a="open"]'); await wait(150);
  ok(/also check the mobile field/.test(await page.textContent('#detail .d-note')), 'description shows in the item popup');
  await page.keyboard.press('Escape'); await wait(100);

  // over 800 characters warns, and saving cuts it to 800
  await open();
  ok(await page.inputValue('#qaNote') === '', 'shared description is cleared when reopened');
  await page.fill('#qaText', 'Long one\n  > ' + 'b'.repeat(300)); await wait(350);
  await page.fill('#qaNote', 'a'.repeat(600));
  ok(/over 800 characters/.test(await page.textContent('#qaErr')), 'warns when a description is over 800 characters');
  await page.click('#qaAdd'); await st();
  ok(byTitle('Long one')[0].note.length === 800, 'saved description cut to 800');

  // only a shared description typed: closing still asks first
  await open();
  await page.fill('#qaNote', 'something');
  let asked = false;
  page.once('dialog', () => { asked = true; });
  await page.keyboard.press('Escape'); await wait(200);
  asked = asked || await page.locator('.confirm-bg.open, #confirmBg.open').count() > 0;
  ok(asked, 'Esc with only a shared description asks before discarding');

  done();
});
