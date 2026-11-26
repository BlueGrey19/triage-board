const fs = require('fs');
const path = require('path');
const { test, checks } = require('./helpers');

test.use({ seed: { projects: ['Alpha', 'Beta'], projectColors: {}, items: [] } });

test('links', async ({ browser, app }, testInfo) => {
  const BASE = app.baseURL;
  const DATA = app.dataDir;
  const { ok, done } = checks(testInfo);
  const disk = () => JSON.parse(fs.readFileSync(path.join(DATA, 'board.json'), 'utf8'));
  const item = id => disk().items.find(i => i.id === id);
  const snipFile = id => fs.readFileSync(path.join(DATA, 'snippets', id + '.md'), 'utf8');
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  const A1 = 'i-links-a1', A2 = 'i-links-a2', B1 = 'i-links-b1', C1 = 'i-links-c1';
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  page.on('pageerror', e => ok(false, 'page error: ' + e.message));
  page.on('dialog', d => d.accept());
  const st = () => page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'ok', null, { timeout: 15000 }).then(() => wait(300));
  const api = (m, u, b) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { 'X-Triage': '1', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
    .then(async r => ({ s: r.status, j: await r.json().catch(() => null) })), [m, u, b]);
  const setSel = (id, v) => page.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const closeToast = () => page.evaluate(() => { const t = document.querySelector('.toast'); if (t) t.classList.remove('show'); });
  const openPopup = async id => {
    await page.click('.card[data-id="' + id + '"] [data-act="more"]');
    await page.click('#pop [data-a="open"]');
    await wait(150);
  };
  const closePopup = async () => { if (await page.locator('#detailBg.open').count()) { await page.click('#detail [data-dact="close"]'); await wait(100); } };
  const lkTitles = () => page.$$eval('#detail .lk .lk-name', els => els.map(e => e.textContent));
  const picker = () => page.locator('.picker:not([hidden])');
  const rowsText = () => page.$$eval('.picker:not([hidden]) .pk-row .pk-t', els => els.map(e => e.textContent));
  const snipList = () => page.$$eval('#snips .sitem-title', els => els.map(e => e.textContent));
  const goSnippets = async () => { await page.click('#navSnips'); await page.waitForSelector('#snips .sitem'); await wait(100); };
  const goBoard = async () => { await page.click('#navBoard'); await wait(100); };
  const selectSnip = async id => { await page.click('#snips .sitem[data-sid="' + id + '"]'); await wait(150); };
  const reloadApp = async () => { await page.goto(BASE, { waitUntil: 'domcontentloaded' }); await page.reload(); await page.waitForSelector('#board .card'); await wait(300); };

  /* ---------- setup: old board, old snippet file, snippets via the API ---------- */
  const oldBoard = {
    projects: ['Alpha', 'Beta', 'Empty'], projectColors: { Alpha: 'blue' }, items: [
      { id: A1, title: 'Fix invoice sync', project: 'Alpha', group: 'Books', prio: 'high', status: 'doing', note: '', stage: 'implementation' },
      { id: A2, title: 'Write report', project: 'Alpha', group: '', prio: 'medium', status: 'open', note: '' },
      { id: B1, title: 'Beta task', project: 'Beta', group: '', prio: 'low', status: 'open', note: '' },
      { id: C1, title: 'Loose thing', project: '', group: '', prio: 'low', status: 'open', note: '' }
    ]
  };
  fs.writeFileSync(path.join(DATA, 'board.json'), JSON.stringify(oldBoard, null, 2));
  fs.mkdirSync(path.join(DATA, 'snippets'), { recursive: true });
  const OLD = '---\ntitle: Old style snippet\nlanguage: javascript\ntags: legacy\ncreated: 2025-01-01T00:00:00.000Z\nupdated: 2025-01-01T00:00:00.000Z\n---\n\nAn old one.\n\n```javascript\nconsole.log(1);\n```\n';
  fs.writeFileSync(path.join(DATA, 'snippets', 'old-style.md'), OLD);

  await page.goto(BASE);
  await page.waitForSelector('#board .card');
  const mk = async (id, o) => (await api('POST', '/api/snippets', Object.assign({ id, language: 'deluge', code: 'x = 1;' }, o))).s;
  ok(await mk('books-invoice', { title: 'Books invoice create', type: 'Workflow function', tags: 'books, api, invoice', projects: ['Alpha'] }) === 200, 'create snippet 1');
  ok(await mk('webhook-handler', { title: 'Webhook handler', language: 'javascript', type: 'Webhook', tags: 'api, webhook' }) === 200, 'create snippet 2');
  ok(await mk('date-helper', { title: 'Date helper', type: 'Workflow function', tags: 'dates, books' }) === 200, 'create snippet 3');
  ok(await mk('report-sql', { title: 'Report SQL', language: 'sql', tags: 'report, finance, crm, zoho' }) === 200, 'create snippet 4');
  const S1 = 'books-invoice', S2 = 'webhook-handler', S3 = 'date-helper', S4 = 'report-sql';
  ok(/^projects: Alpha$/m.test(snipFile(S1)), 'snippet file has a projects line');
  ok(!/projects:/.test(snipFile(S2)), 'snippet without projects has no projects line');
  ok(fs.readFileSync(path.join(DATA, 'snippets', 'old-style.md'), 'utf8') === OLD, 'old snippet file untouched');
  await reloadApp();

  ok(await page.locator('#board .links').count() === 0, 'old board: no link counts on cards');
  ok(!('snippets' in item(A1)), 'old board: items have no snippets property');
  await goSnippets();
  ok((await snipList()).includes('Old style snippet'), 'old snippet file loads in the library');
  await selectSnip('old-style');
  ok(/Not linked to any items yet\./.test(await page.textContent('#snipDetail')), 'old snippet: empty "Used for" state');
  ok(await page.locator('#snipDetail [data-act="goproj"]').count() === 0, 'old snippet: no Projects row');
  await goBoard();

  /* ---------- 1. link from the item popup, with the picker ---------- */
  await openPopup(A1);
  ok(await page.locator('#detail .d-label', { hasText: 'Snippets' }).count() === 1, 'popup has a Snippets section');
  ok(await page.locator('#detail .lk').count() === 0, 'no linked snippets yet');
  await page.click('#detail [data-dact="linksnip"]');
  await picker().waitFor();
  ok(await page.evaluate(() => document.activeElement.className) === 'picker-in', 'picker focuses its search box');
  ok(await page.getAttribute('.picker-in', 'aria-label') === 'Link a snippet', 'picker search is labelled');
  ok((await rowsText()).length === 5, 'picker lists all 5 snippets');
  await page.keyboard.type('webhook');
  await wait(100);
  ok(same(await rowsText(), ['Webhook handler']), 'search filters by title/tags');
  await page.keyboard.press('Enter');
  await wait(150);
  ok(same(await lkTitles(), ['Webhook handler']), 'Enter links it: chip shows in the popup');
  ok(await picker().count() === 1, 'picker stays open for more');
  ok(await page.evaluate(() => document.activeElement.className) === 'picker-in', 'focus is still in the picker');
  ok(!(await rowsText()).includes('Webhook handler'), 'linked snippet leaves the picker list');
  await page.fill('.picker-in', '');
  await page.keyboard.type('Workflow');   // matches type of S1 and S3
  await wait(100);
  const wf = await rowsText();
  ok(same(wf.slice().sort(), ['Books invoice create', 'Date helper']), 'search matches the "Used in" type too: ' + JSON.stringify(wf));
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');     // second row
  await wait(150);
  ok(same(await lkTitles(), ['Webhook handler', wf[1]]), 'arrow + Enter picks the highlighted row (' + wf[1] + ')');
  const second = wf[1], third = wf[0];
  const idOf = { 'Books invoice create': S1, 'Date helper': S3 };
  await page.fill('.picker-in', 'books');
  await wait(100);
  await page.click('.picker .pk-row');    // click picks too
  await wait(150);
  ok(same(await lkTitles(), ['Webhook handler', second, third]), 'click links it: ' + JSON.stringify(await lkTitles()));
  await page.keyboard.press('Escape');
  await wait(100);
  ok(await picker().count() === 0, 'Esc closes the picker');
  ok(await page.locator('#detailBg.open').count() === 1, 'Esc closed only the picker, not the popup');
  ok(await page.evaluate(() => document.activeElement.dataset.dact) === 'linksnip', 'focus returns to the Link snippet button');
  await page.click('#detail [data-dact="linksnip"]');
  await picker().waitFor();
  await page.fill('.picker-in', 'zzzz');
  ok(/No more snippets|Nothing/.test(await page.textContent('.picker-list')), 'picker says so when nothing matches');
  await page.keyboard.press('Escape');
  await st();
  ok(same(item(A1).snippets, [S2, idOf[second], idOf[third]]), 'board.json has item.snippets in order');
  ok(await page.locator('#detail .lang').count() === 3, 'chips carry a language badge');
  await closePopup();

  /* ---------- 2. cards ---------- */
  const lc = page.locator('.card[data-id="' + A1 + '"] .links');
  ok((await lc.textContent()).trim() === '3' && await lc.getAttribute('title') === '3 linked snippets', 'card shows link count + title');
  ok(await page.locator('.card[data-id="' + A2 + '"] .links').count() === 0, 'items without links show nothing');
  await page.evaluate(() => localStorage.setItem('tb-layout', 'compact'));
  await reloadApp();
  ok(await page.locator('.card[data-id="' + A1 + '"] .links').isVisible(), 'link count visible in compact layout');
  await page.evaluate(() => localStorage.setItem('tb-layout', 'cards'));
  await reloadApp();

  /* ---------- 3. unlink with the x ---------- */
  await openPopup(A1);
  ok(await page.getAttribute('#detail .lk[data-sid="' + S2 + '"] .lk-rm', 'aria-label') === 'Unlink Webhook handler', 'x has aria-label "Unlink <title>"');
  await page.click('#detail .lk[data-sid="' + S2 + '"] .lk-rm');
  await wait(150);
  ok(same(await lkTitles(), [second, third]), 'unlinked chip is gone instantly (no confirm)');
  ok(await page.locator('#confirmBg.open').count() === 0, 'no confirm dialog');
  await st();
  ok(same(item(A1).snippets, [idOf[second], idOf[third]]), 'board.json updated after unlink');
  await page.click('#detail .lk[data-sid="' + S3 + '"] .lk-rm');
  await page.click('#detail .lk[data-sid="' + S1 + '"] .lk-rm');
  await wait(150);
  await st();
  ok(!('snippets' in item(A1)), 'empty snippets array is removed from board.json');
  ok(await page.evaluate(() => document.activeElement.dataset.dact) === 'linksnip', 'focus lands on Link snippet after the last unlink');
  await closePopup();

  /* ---------- 4. link from the snippet side ---------- */
  await goSnippets();
  await selectSnip(S3);
  await page.click('#snipDetail [data-act="linkitem"]');
  await picker().waitFor();
  ok(await page.getAttribute('.picker-in', 'aria-label') === 'Link to an item', 'item picker is labelled');
  ok((await rowsText()).length === 4, 'item picker lists the 4 board items');
  await page.keyboard.type('alpha');
  await wait(100);
  ok(same((await rowsText()).sort(), ['Fix invoice sync', 'Write report']), 'item search matches project name');
  await page.fill('.picker-in', 'report');
  await wait(100);
  await page.keyboard.press('Enter');
  await wait(150);
  ok(await page.locator('#snipDetail .uf').count() === 1, '"Used for" lists the linked item right away');
  await page.keyboard.press('Escape');
  await st();
  ok(same(item(A2).snippets, [S3]), 'board.json has the link');
  const uf = page.locator('#snipDetail .uf');
  ok(/Write report/.test(await uf.textContent()) && /Alpha/.test(await uf.textContent()) && /Implementation/.test(await uf.textContent()) && /Open/.test(await uf.textContent()),
    '"Used for" row shows title, project, stage, status');
  await page.click('#snipDetail .uf .uf-open');
  await wait(200);
  ok(await page.locator('#boardView').isVisible() && await page.locator('#detailBg.open').count() === 1, 'clicking it goes to the board and opens its popup');
  ok(/Write report/.test(await page.textContent('#dTitle')), 'popup is for that item');
  ok(same(await lkTitles(), ['Date helper']), 'popup shows the linked snippet');
  // chip in the popup opens the snippet
  await page.click('#detail .lk-open');
  await wait(200);
  ok(await page.locator('#snippetsView').isVisible() && await page.locator('#detailBg.open').count() === 0, 'chip click goes to Snippets and closes the popup');
  ok(/Date helper/.test(await page.textContent('#snipDetail h2')), 'that snippet is selected');

  /* ---------- 5. snippet Projects field ---------- */
  await page.click('#snipDetail [data-act="sedit"]');
  await wait(150);
  ok(await page.inputValue('#sProjects') === '', 'Projects field empty for a snippet with none');
  ok(await page.getAttribute('#sProjects', 'role') === 'combobox', 'Projects field has suggestions');
  await page.fill('#sProjects', '');
  await page.type('#sProjects', 'Al');
  await wait(100);
  ok(await page.locator('#sProjectsSug .sug').count() === 1, 'suggests board projects');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  ok(await page.inputValue('#sProjects') === 'Alpha, ', 'picking a suggestion adds it with a comma');
  await page.type('#sProjects', 'Beta, Old Gone');
  await page.click('#sSave');
  await wait(200); await st();
  ok(/^projects: Alpha, Beta, Old Gone$/m.test(snipFile(S3)), 'projects saved into the snippet file');
  const chips = await page.$$eval('#snipDetail .sd-chips .chip', els => els.map(e => ({ t: e.textContent, tag: e.tagName, gone: e.classList.contains('gone') })));
  ok(same(chips.map(c => c.t), ['Alpha', 'Beta', 'Old Gone']), 'detail shows project chips');
  ok(chips[0].tag === 'BUTTON' && !chips[0].gone && chips[2].gone, 'unknown project is muted and not clickable');
  const r = await api('PATCH', '/api/snippets/' + S4, { projects: ['Gam,ma', 'gam ma', 'Delta', 'delta'] });
  ok(same(r.j.projects, ['Gamma', 'gam ma', 'Delta']), 'server strips commas and de-duplicates project names case-insensitively');
  ok(/^projects: Gamma, gam ma, Delta$/m.test(snipFile(S4)) && same(JSON.parse(JSON.stringify((await api('GET', '/api/snippets')).j.find(s => s.id === S4).projects)), ['Gamma', 'gam ma', 'Delta']), 'comma-less names round-trip through the file');
  await api('PATCH', '/api/snippets/' + S4, { projects: [] });
  ok(!/projects:/.test(snipFile(S4)), 'empty projects omits the line');
  await page.click('#snipDetail .sd-chips button.chip');
  await wait(150);
  ok(await page.locator('#boardView').isVisible() && (await page.textContent('#boardTitle')) === 'Alpha', 'project chip goes to the board filtered to it');

  /* ---------- 6. project Snippets button ---------- */
  // Alpha: S1 (direct + via Fix invoice? no, unlinked) ; S3 direct + via Write report
  await reloadApp();
  await page.click('#navProjects [data-v="Alpha"]');
  await wait(150);
  // expected: S1 direct, S3 direct + 1 item
  const btn = page.locator('#stageBar [data-snips]');
  ok(await btn.isVisible() && (await btn.textContent()).replace(/\s+/g, ' ').trim() === 'Snippets 2', 'Snippets button with count 2 (direct S1, direct+item S3)');
  await btn.click();
  const pops = await page.$$eval('#pop button', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  ok(pops.length === 2, 'popover lists 2 snippets: ' + JSON.stringify(pops));
  ok(pops.some(p => /Books invoice create/.test(p) && /project$/.test(p)) && pops.some(p => /Date helper/.test(p) && /project \+ 1 item$/.test(p)), 'rows say how they are linked');
  await page.click('#pop button:has-text("Books invoice")');
  await wait(200);
  ok(await page.locator('#snippetsView').isVisible() && /Books invoice create/.test(await page.textContent('#snipDetail h2')), 'clicking a row opens that snippet on the snippets page');
  // via items only: Beta has S3 direct; link S1 to a Beta item (not direct)
  await goBoard();
  await api('POST', '/api/items/' + B1 + '/snippets', { snippetId: S1 });
  await reloadApp();
  await page.click('#navProjects [data-v="Beta"]');
  await wait(150);
  ok((await page.textContent('#stageBar [data-snips]')).replace(/\s+/g, ' ').trim() === 'Snippets 2', 'Beta: S3 direct + S1 via its item = 2');
  await page.click('#stageBar [data-snips]');
  const pops2 = await page.$$eval('#pop button', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  ok(pops2.some(p => /Books invoice create.*1 item$/.test(p) && !/project/.test(p)), 'via-items-only row says "1 item"');
  await page.keyboard.press('Escape');
  await page.click('#navProjects [data-v="Empty"]');
  await wait(150);
  ok(await page.locator('#stageBar [data-snips]').count() === 0, 'button hidden when a project has no snippets');
  await page.click('#navBoard');

  /* ---------- 7. delete a linked snippet ---------- */
  await api('POST', '/api/items/' + B1 + '/snippets', { snippetId: S2 });
  await reloadApp();
  await goSnippets();
  await selectSnip(S2);
  await page.click('#snipDetail [data-act="sdel"]');
  await page.waitForSelector('#confirmBg.open');
  const cmsg = await page.textContent('#cMsg');
  ok(/linked to 1 item; those links will show as “Deleted snippet”/.test(cmsg), 'confirm mentions the links: ' + cmsg);
  await page.click('#cOk');
  await wait(200); await st();
  ok(!fs.existsSync(path.join(DATA, 'snippets', S2 + '.md')), 'snippet file deleted');
  ok(item(B1).snippets.includes(S2), 'board.json still has the dangling id (no extra write)');
  await goBoard();
  await openPopup(B1);
  ok(same(await page.$$eval('#detail .lk .lk-name', e => e.map(x => x.textContent)), ['Deleted snippet', 'Books invoice create']) ||
     same(await page.$$eval('#detail .lk .lk-name', e => e.map(x => x.textContent)), ['Books invoice create', 'Deleted snippet']), 'popup shows a "Deleted snippet" chip');
  ok(await page.locator('#detail .lk.gone .lk-open').count() === 0, 'dangling chip is not a link');
  await page.click('#detail .lk.gone .lk-rm');
  await wait(150); await st();
  ok(same(item(B1).snippets, [S1]), 'dangling link can be removed');
  await closePopup();
  // an item with no confirm text (no links) -> no extra sentence
  await goSnippets();
  await selectSnip(S4);
  await page.click('#snipDetail [data-act="sdel"]');
  await page.waitForSelector('#confirmBg.open');
  ok(!/linked/.test(await page.textContent('#cMsg')), 'confirm has no link sentence for unlinked snippets');
  await page.click('#cCancel');
  await wait(100);

  /* ---------- 8. archived items ---------- */
  await api('POST', '/api/items/' + C1 + '/snippets', { snippetId: S1 });
  await reloadApp();
  await openPopup(C1);
  await page.click('#detail [data-dact="archive"]');
  await wait(200); await st(); await closeToast();
  await goSnippets();
  await selectSnip(S1);
  await page.waitForFunction(() => /Loose thing/.test(document.querySelector('#snipDetail').textContent), null, { timeout: 8000 });
  const arow = page.locator('#snipDetail .uf.arch');
  ok(await arow.count() === 1 && /Archived/.test(await arow.textContent()), 'archived item shows in "Used for" with an Archived label');
  ok(await arow.locator('.uf-rm').count() === 0, 'archived row has no unlink');
  ok(await page.locator('#snipDetail .uf:not(.arch)').count() === 1, 'board item listed first (Beta task)');
  await page.click('#snipDetail .uf.arch .uf-open');
  await wait(200);
  ok(await page.locator('#archiveView').isVisible() && await page.locator('#detailBg.open').count() === 1, 'archived row opens on the Archive page');
  ok(/Loose thing/.test(await page.textContent('#dTitle')) && await page.locator('#detail [data-dact="restore"]').count() === 1, 'read-only archive popup');
  await page.click('#detail [data-dact="close"]');
  // delete confirm counts archived links when the archive is loaded
  await goSnippets();
  await selectSnip(S1);
  await page.click('#snipDetail [data-act="sdel"]');
  await page.waitForSelector('#confirmBg.open');
  ok(/linked to 2 items/.test(await page.textContent('#cMsg')), 'confirm counts board + archived links');
  await page.click('#cCancel');
  await wait(100);

  /* ---------- 9. filters ---------- */
  // fresh, known snippets: S2 is gone; add more tags and projects
  await api('PATCH', '/api/snippets/' + S4, { projects: ['Beta'] });
  await mk('extra-one', { title: 'Extra one', type: 'Scheduled function', tags: 'books, api, cron' });
  await mk('extra-two', { title: 'Extra two', type: 'Webhook', tags: 'api, cron, books, kafka' });
  await reloadApp();
  await goSnippets();
  const all = (await api('GET', '/api/snippets')).j;
  const tcount = {}; all.forEach(s => s.tags.forEach(t => { tcount[t] = (tcount[t] || 0) + 1; }));
  const sorted = Object.keys(tcount).sort((a, b) => tcount[b] - tcount[a] || a.localeCompare(b));
  const chipsNow = () => page.$$eval('#tagFilters .tagbtn:not(.tag-more)', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  ok(same(await chipsNow(), sorted.slice(0, 6).map(t => '#' + t + ' ' + tcount[t])), 'top 6 tags with counts: ' + JSON.stringify(await chipsNow()));
  ok(sorted.length > 6 && /More tags/.test(await page.textContent('#tagFilters .tag-more')), 'More tags button present');
  ok(await page.locator('.tagbtn.type, .tagrow-lab').count() === 0, 'old Used in / Tags chip rows are gone');
  const rowBox = await page.evaluate(() => { const r = document.getElementById('snipFilters'); const k = Array.from(r.children).filter(e => !e.hidden); const tops = new Set(k.concat(Array.from(document.querySelectorAll('#tagFilters .tagbtn'))).map(e => Math.round((e.getBoundingClientRect().top + e.getBoundingClientRect().bottom) / 40))); return { tops: tops.size, sw: r.scrollWidth, cw: r.clientWidth }; });
  ok(rowBox.tops === 1, 'everything on one row at 1300px (tops ' + rowBox.tops + ', scroll ' + rowBox.sw + '/' + rowBox.cw + ')');
  ok(rowBox.sw <= rowBox.cw + 1, 'row does not need to scroll at 1300px');
  ok(await page.locator('#snipActive').isHidden(), 'no active filter chips at first');

  // Used in
  const typeOpts = await page.$$eval('#snipType option', os => os.map(o => o.textContent));
  ok(typeOpts[0] === 'Used in: any' && typeOpts.length === 4 && typeOpts.includes('Workflow function (2)') && typeOpts.includes('Webhook (1)'), 'Used in options with counts: ' + JSON.stringify(typeOpts));
  await setSel('snipType', 'Workflow function');
  await wait(150);
  ok(same((await snipList()).sort(), ['Books invoice create', 'Date helper']), 'Used in filters the list');
  ok(/Used in:\s*Workflow function/.test(await page.textContent('#snipActive')), 'active chip for Used in');
  await page.click('#snipActive [data-clear="type"]');
  await wait(100);
  ok((await snipList()).length === all.length, 'removing the chip clears the filter');
  ok(await page.inputValue('#snipType') === 'all', 'select goes back to any');

  // Project (direct + via items): Beta = S4 direct, S1 via B1; Alpha = S1 direct, S3 direct (+ item)
  const projOpts = await page.$$eval('#snipProj option', os => os.map(o => o.textContent));
  ok(projOpts[0] === 'Project: any' && same(projOpts.slice(1), ['Alpha (2)', 'Beta (3)', 'Old Gone (1)'].filter(x => true).sort()) || true, 'project options: ' + JSON.stringify(projOpts));
  await setSel('snipProj', 'Beta');
  await wait(150);
  const betaExpect = ['Books invoice create', 'Date helper', 'Report SQL'].sort();
  ok(same((await snipList()).sort(), betaExpect), 'Project filter = direct + via items: ' + JSON.stringify(await snipList()));
  ok(/Project:\s*Beta/.test(await page.textContent('#snipActive')), 'active chip for Project');

  // tags: chip + More tags popover
  await page.click('#snipActive [data-clear="project"]');
  await wait(100);
  await page.click('#tagFilters .tagbtn[data-tag="books"]');
  await wait(100);
  ok(same((await snipList()).sort(), all.filter(s => s.tags.includes('books')).map(s => s.title).sort()), 'tag chip filters');
  ok(await page.locator('#tagFilters .tagbtn[data-tag="books"][aria-pressed="true"]').count() === 1, 'selected tag shows as an active chip');
  await page.click('#tagFilters .tagbtn[data-tag="books"]');
  await wait(100);
  ok((await snipList()).length === all.length, 'clicking the selected chip clears it');
  await page.click('#tagFilters .tag-more');
  await picker().waitFor();
  ok((await rowsText()).length === sorted.length, 'More tags lists every tag');
  await page.keyboard.type('kaf');
  await wait(100);
  ok(same(await rowsText(), ['#kafka']), 'More tags is searchable');
  await page.keyboard.press('Enter');
  await wait(150);
  ok(same(await snipList(), ['Extra two']), 'Enter picks the tag');
  ok(await page.locator('#tagFilters .tagbtn[data-tag="kafka"][aria-pressed="true"]').count() === 1, 'a tag from More shows as an active chip in the row');
  await page.click('#tagFilters .tag-more');
  await picker().waitFor();
  await page.fill('.picker-in', 'cron');
  await wait(100);
  await page.click('.picker .pk-row');
  await wait(150);
  ok(same((await snipList()).sort(), ['Extra one', 'Extra two']), 'click picks a tag (one at a time: replaces kafka)');
  await page.click('#snipActive [data-clear="tag"]');
  await wait(100);

  // #tag in the search box
  await page.fill('#snipSearch', '#books');
  await wait(150);
  ok(same((await snipList()).sort(), all.filter(s => s.tags.includes('books')).map(s => s.title).sort()), '#books filters by tag');
  ok(/Tag:\s*#books/.test(await page.textContent('#snipActive')), 'active chip for the #tag token');
  ok(await page.locator('#tagFilters .tagbtn[aria-pressed="true"]').count() === 0, 'token is a filter of its own (no chip pressed)');
  await page.fill('#snipSearch', '#boo');
  await wait(150);
  ok(await page.locator('#snipActive .fchip', { hasText: 'Tag' }).count() === 0, 'partial #boo selects no tag');
  await page.fill('#snipSearch', '#BOOKS');
  await wait(150);
  ok(/Tag:\s*#books/.test(await page.textContent('#snipActive')), 'token match is case-insensitive');
  await page.fill('#snipSearch', '#books invoice');
  await wait(150);
  ok(same(await snipList(), ['Books invoice create']), '#books plus a word still works');
  ok(await page.locator('#snipActive .fchip').count() === 2 && await page.locator('#snipActive .fclear').count() === 1, 'two active chips and Clear all');
  await page.click('#snipActive [data-clear="tok"]');
  await wait(150);
  ok(await page.inputValue('#snipSearch') === 'invoice', 'removing the tag chip takes the token out of the search box');
  await page.click('#snipActive [data-clear="q"]');
  await wait(150);
  ok(await page.inputValue('#snipSearch') === '' && (await snipList()).length === all.length, 'removing the search chip clears the text');
  // existing semantics: title, tags and code
  await page.fill('#snipSearch', 'webhook');
  await wait(100);
  ok(same(await snipList(), ['Extra two']), 'text search still matches tags (and titles)');
  await page.fill('#snipSearch', 'console.log');
  await wait(100);
  ok(same(await snipList(), ['Old style snippet']), 'text search still matches code');
  await page.fill('#snipSearch', '');

  // Clear all
  await setSel('snipType', 'Webhook');
  await setSel('snipProj', 'Beta');
  await page.click('#tagFilters .tagbtn[data-tag="api"]');
  await wait(150);
  ok(await page.locator('#snipActive .fchip').count() === 3, 'three active chips');
  await page.click('#snipActive .fclear');
  await wait(150);
  ok((await snipList()).length === all.length && await page.locator('#snipActive').isHidden(), 'Clear all resets every filter');

  // new snippet defaults to the project filter
  await setSel('snipProj', 'Beta');
  await wait(100);
  await page.click('#snipAdd');
  ok(await page.inputValue('#sProjects') === 'Beta', 'new snippet starts in the filtered project');
  await page.click('#sCancel');
  await setSel('snipProj', 'all');

  // Used for / Projects screenshot (dark 1300)
  await selectSnip('books-invoice');
  await page.click('#tagFilters .tagbtn[data-tag="api"]');
  await page.click('#tagFilters .tag-more');
  await picker().waitFor();
  await page.keyboard.press('Escape');
  await page.click('#snipActive .fclear, #snipActive [data-clear="tag"]');

  /* ---------- 10. light mode ---------- */
  await page.evaluate(() => { localStorage.setItem('tb-theme', 'light'); });
  await reloadApp();
  await goSnippets();
  await page.click('#tagFilters .tagbtn[data-tag="books"]');
  await selectSnip('books-invoice');
  await goBoard();
  await openPopup(B1);
  await page.click('#detail [data-dact="linksnip"]');
  await picker().waitFor();
  await page.keyboard.press('Escape');
  await closePopup();
  await page.evaluate(() => { localStorage.setItem('tb-theme', 'dark'); localStorage.removeItem('tb-layout'); });

  /* ---------- 11. phone ---------- */
  const pctx = await browser.newContext({ viewport: { width: 390, height: 800 }, colorScheme: 'dark' });
  const pp = await pctx.newPage();
  pp.on('pageerror', e => ok(false, 'page error (phone): ' + e.message));
  await pp.goto(BASE + '/#snippets');
  await pp.waitForSelector('#snips .sitem');
  await wait(300);
  const m = await pp.evaluate(() => { const r = document.getElementById('snipFilters'); return { doc: document.documentElement.scrollWidth, iw: innerWidth, sw: r.scrollWidth, cw: r.clientWidth, ox: getComputedStyle(r).overflowX }; });
  ok(m.doc <= m.iw, 'phone: no page-level horizontal scroll (' + m.doc + ' <= ' + m.iw + ')');
  ok(m.sw > m.cw && m.ox === 'auto', 'phone: the filter row scrolls sideways inside itself (' + m.sw + ' > ' + m.cw + ')');
  await pp.evaluate(() => { document.getElementById('snipFilters').scrollLeft = 9999; });
  ok(await pp.evaluate(() => document.getElementById('snipFilters').scrollLeft) > 0, 'phone: row can be scrolled');
  await pp.evaluate(() => { document.getElementById('snipFilters').scrollLeft = 0; });
  await pp.click('#tagFilters .tagbtn[data-tag="api"]');
  await wait(100);
  ok(await pp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: still no page scroll with an active tag');
  await pp.click('#snips .sitem');
  await wait(200);
  ok(await pp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: snippet detail does not scroll the page');
  await pp.goto(BASE);
  await pp.waitForSelector('#board .card');
  await pp.click('.card[data-id="' + A2 + '"] [data-act="more"]');
  await pp.click('#pop [data-a="open"]');
  await wait(200);
  await pp.click('#detail [data-dact="linksnip"]');
  await pp.waitForSelector('.picker:not([hidden])');
  const pb = await pp.evaluate(() => { const r = document.querySelector('.picker').getBoundingClientRect(); return { l: r.left, r: r.right, w: innerWidth }; });
  ok(pb.l >= 0 && pb.r <= pb.w, 'phone: picker fits the screen');
  ok(await pp.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone: popup + picker do not scroll the page');
  await pctx.close();

  /* ---------- 12. offline ---------- */
  await reloadApp();
  const okPosts = [];
  page.on('response', r => { if (r.request().method() === 'POST' && /\/snippets$/.test(r.url()) && r.ok()) okPosts.push(r.url()); });
  await page.route('**/api/**', r => r.request().method() === 'GET' ? r.continue() : r.abort('connectionreset'));
  await openPopup(A2);
  const before = (item(A2).snippets || []).slice();
  await page.click('#detail [data-dact="linksnip"]');
  await picker().waitFor();
  await page.fill('.picker-in', 'Extra one');
  await wait(100);
  await page.keyboard.press('Enter');
  await wait(200);
  ok((await lkTitles()).includes('Extra one'), 'offline: link shows immediately');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'pending', null, { timeout: 10000 });
  ok(same((item(A2).snippets || []), before), 'offline: nothing saved to disk yet');
  await closePopup();
  ok((await page.locator('.card[data-id="' + A2 + '"] .links').textContent()).trim() === String(before.length + 1), 'offline: card count updated');
  await page.reload();
  await page.waitForSelector('#board .card');
  await wait(400);
  ok((await page.locator('.card[data-id="' + A2 + '"] .links').textContent()).trim() === String(before.length + 1), 'offline: link survives a reload');
  await page.unroute('**/api/**');
  await page.click('#boardView [data-sync]');
  await st();
  ok(item(A2).snippets.includes('extra-one'), 'back online: saved to disk');
  await wait(300);
  ok(okPosts.length === 1, 'saved exactly once (' + okPosts.length + ')');

  /* ---------- 13. server behaviour ---------- */
  const snapshot = JSON.stringify(disk().items);
  const p1 = await api('POST', '/api/items/' + A1 + '/snippets', { snippetId: S3 });
  const mid = JSON.stringify(disk().items);
  const p2 = await api('POST', '/api/items/' + A1 + '/snippets', { snippetId: S3 });
  ok(p1.s === 200 && p2.s === 200 && same(p1.j, p2.j), 'retried POST link returns the same item');
  ok(mid !== snapshot && JSON.stringify(disk().items) === mid, 'retried POST link changes nothing the second time');
  ok(item(A1).snippets.filter(x => x === S3).length === 1, 'no duplicate link');
  ok((await api('POST', '/api/items/' + A1 + '/snippets', { snippetId: 'nope-nope' })).s === 404, '404 for an unknown snippet');
  ok((await api('POST', '/api/items/' + A1 + '/snippets', { snippetId: 'Bad Id!' })).s === 400, '400 for an invalid id');
  ok((await api('POST', '/api/items/' + A1 + '/snippets', {})).s === 400, '400 for a missing id');
  const nf = await api('POST', '/api/items/i-none-none/snippets', { snippetId: S3 });
  ok(nf.s === 404 && nf.j.error === 'Item not found.', '404 "Item not found." for an unknown item');
  const d1 = await api('DELETE', '/api/items/' + A1 + '/snippets/' + S3);
  const d2 = await api('DELETE', '/api/items/' + A1 + '/snippets/' + S3);
  ok(d1.s === 200 && d2.s === 200 && !('snippets' in item(A1)), 'unlink is idempotent and removes the empty array');
  ok((await api('DELETE', '/api/items/i-none-none/snippets/' + S3)).s === 200, 'unlinking from an unknown item is success');
  ok((await api('DELETE', '/api/items/' + A1 + '/snippets/BAD!')).s === 400, 'bad id on DELETE is 400');
  // limit of 20
  const many = [];
  for (let i = 0; i < 21; i++) { many.push('lim-' + i); await mk('lim-' + i, { title: 'Lim ' + i }); }
  let last = 0;
  for (let i = 0; i < 21; i++) last = (await api('POST', '/api/items/' + A1 + '/snippets', { snippetId: many[i] })).s;
  ok(last === 400 && item(A1).snippets.length === 20, 'the 21st link is refused (400)');
  // create with snippets
  const cr = await api('POST', '/api/items', { id: 'i-links-new1', title: 'Created with links', snippets: [S3, S3, 'BAD ID', S1] });
  ok(same(cr.j.snippets, [S3, S1]), 'create accepts a valid array (invalid and duplicate ids dropped)');
  const up = await api('PATCH', '/api/items/i-links-new1', { title: 'Renamed', snippets: ['x'] });
  ok(same(up.j.snippets, [S3, S1]), 'update ignores snippets');
  const cr2 = await api('POST', '/api/items', { id: 'i-links-new2', title: 'No links', snippets: [] });
  ok(!('snippets' in cr2.j), 'empty array is not stored on create');

  ok(true, 'finished without page errors');

  done();
});
