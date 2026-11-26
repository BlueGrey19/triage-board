const fs = require('fs');
const path = require('path');
const { test, checks } = require('./helpers');

test.use({ seed: { projects: ['Alpha', 'Beta'], projectColors: {}, items: [] } });

test('archive', async ({ browser, app }, testInfo) => {
  const BASE = app.baseURL;
  const DATA = app.dataDir;
  const { ok, done } = checks(testInfo);
  const boardFile = path.join(DATA, 'board.json');
  const archFile = path.join(DATA, 'archive.json');
  const disk = () => JSON.parse(fs.readFileSync(boardFile, 'utf8'));
  const arc = () => (fs.existsSync(archFile) ? JSON.parse(fs.readFileSync(archFile, 'utf8')) : { items: [], projects: [] });
  const bItem = id => disk().items.find(i => i.id === id);
  const aItem = id => arc().items.find(i => i.id === id);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const GH = { M1: 'i-tt-m1', M2: 'i-tt-m2', M3: 'i-tt-m3', M4: 'i-tt-m4', A1: 'i-tt-a1', A2: 'i-tt-a2' };
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 800 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); ok(false, 'page error: ' + e.message); });
  const st = () => page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'ok', null, { timeout: 15000 }).then(() => wait(250));
  const state = s => page.waitForFunction(s => document.querySelector('#boardView [data-sync]').dataset.state === s, s, { timeout: 15000 });
  const toastTxt = async () => ((await page.locator('.toast').textContent()) || '').trim();
  const api = (m, u, b) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { 'X-Triage': '1', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
    .then(async r => ({ s: r.status, j: await r.json().catch(() => null) })), [m, u, b]);
  const setSel = (id, v) => page.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const optVals = id => page.evaluate(id => Array.from(document.getElementById(id).options).map(o => o.value), id);
  const optTexts = id => page.evaluate(id => Array.from(document.getElementById(id).options).map(o => o.text), id);
  const card = id => page.locator('.card[data-id="' + id + '"]');
  const rows = () => page.locator('#archList .arch-row');
  const rowTitles = () => page.locator('#archList .arch-row .arch-title').allTextContents();
  const row = id => page.locator('.arch-row[data-id="' + id + '"]');
  const cMsg = () => page.locator('#cMsg').textContent();
  const cTitle = () => page.locator('#cTitle').textContent();
  // pop menu is position:fixed and closes on any scroll, so click it without Playwright scrolling
  const popClick = async sel => { await page.waitForSelector('#pop ' + sel); await page.evaluate(sel => document.querySelector('#pop ' + sel).click(), sel); };
  const showCard = async id => {
    while (await card(id).count() === 0 && await page.locator('[data-act="done-toggle"][aria-expanded="false"]').count()) {
      await page.locator('[data-act="done-toggle"][aria-expanded="false"]').first().click();
    }
  };
  const moreBtn = async id => { await showCard(id); await card(id).scrollIntoViewIfNeeded(); await wait(150); await card(id).locator('[data-act="more"]').click(); };
  const openPopup = async id => { await moreBtn(id); await popClick('[data-a="open"]'); await wait(150); };
  const closeToast = () => page.evaluate(() => { const t = document.querySelector('.toast'); if (t) t.classList.remove('show'); });
  const unique = a => new Set(a).size === a.length;

  /* ---------- 0. a board with no archive.json: Archive page shows the empty state ---------- */
  ok(!fs.existsSync(archFile), 'start: no archive.json');
  await page.goto(BASE);
  await page.waitForSelector('#board .card, #board .empty');
  ok(await page.locator('#archDone').isHidden(), 'Archive done button hidden when nothing is done');
  await page.click('#navArchive');
  await page.waitForSelector('#archList .empty');
  ok(/Nothing archived yet\. Done items you archive will show here\./.test(await page.textContent('#archList')), 'empty state text');
  ok(await page.evaluate(() => location.hash) === '#archive', 'hash is #archive');
  ok(await page.locator('#navArchive').getAttribute('aria-current') === 'page', 'nav marks Archive current');
  ok((await page.textContent('#archiveView h1')) === 'Archive' && /Board/.test(await page.textContent('#archiveView .kicker')), 'header: eyebrow Board, h1 Archive');
  ok(/Saved locally/.test(await page.textContent('#archiveView [data-sync]')), 'archive page has the sync pill');
  ok(!fs.existsSync(archFile), 'reading the archive does not create archive.json');
  await page.click('#navBoard');

  /* ---------- seed ---------- */
  await api('POST', '/api/projects', { name: 'Milltrans', color: 'teal' });
  const mk = (id, title, project, status, group, extra) => api('POST', '/api/items', Object.assign({ id, title, project, status, group, prio: 'medium' }, extra));
  await mk(GH.M1, 'Build login', 'Milltrans', 'done', 'Main build', { prio: 'high' });
  await api('POST', '/api/items/' + GH.M1 + '/subtasks', { id: 's-tt-1', text: 'Write tests' });
  await api('POST', '/api/items/' + GH.M1 + '/subtasks', { id: 's-tt-2', text: 'Ship it' });
  await api('PATCH', '/api/items/' + GH.M1 + '/subtasks/s-tt-1', { done: true });
  await mk(GH.M2, 'Tidy docs', 'Milltrans', 'done', 'Docs');
  await mk(GH.M3, 'Open task', 'Milltrans', 'doing', 'Main build');
  await mk(GH.M4, 'Zebra rollout', 'Milltrans', 'done', 'Main build', { note: 'zebra stripes' });
  await mk(GH.A1, 'Alpha done', 'Alpha', 'done', 'Docs');
  await mk(GH.A2, 'Alpha open', 'Alpha', 'open', '');
  const m1Orig = JSON.parse(JSON.stringify(bItem(GH.M1)));
  await page.reload();
  await page.waitForSelector('#board .card');

  /* ---------- 1. doneAt ---------- */
  ok(!!bItem(GH.M1).doneAt && !bItem(GH.M3).doneAt && !bItem(GH.A2).doneAt, 'doneAt set on create-as-done only');
  await card(GH.A2).locator('[data-act="done"]').click();
  await st();
  ok(!!bItem(GH.A2).doneAt && /^\d{4}-\d\d-\d\dT/.test(bItem(GH.A2).doneAt), 'doneAt set on disk when marked done');
  await openPopup(GH.A2);
  ok(/Created .* · Done /.test(await page.textContent('#detail .d-dates')), 'popup: "Created … · Done …": ' + await page.textContent('#detail .d-dates'));
  await page.click('#detail [data-dact="close"]');
  await showCard(GH.A2);
  await card(GH.A2).locator('[data-act="done"]').click();
  await st();
  ok(bItem(GH.A2).doneAt === undefined && bItem(GH.A2).status === 'open', 'doneAt cleared when moved out of done');
  await openPopup(GH.A2);
  ok(!/Done/.test(await page.textContent('#detail .d-dates')), 'popup: no Done date once reopened');
  ok(await page.locator('#detail [data-dact="archive"]').count() === 1 && await page.locator('#detail [data-dact="del"]').count() === 1, 'board popup: Archive and Delete buttons');
  await page.click('#detail [data-dact="close"]');
  await closeToast();

  /* ---------- 2. Archive done, with filters ---------- */
  const lab = () => page.locator('#archDone').innerText();
  ok(/Archive 4 done/.test(await lab()), 'button counts all done items: ' + await lab());
  await page.click('[data-nav="project"][data-v="Milltrans"]');
  ok(/Archive 3 done/.test(await lab()), 'respects project filter: ' + await lab());
  await card(GH.M3).locator('[data-act="group"]').click();
  ok(/Archive 2 done/.test(await lab()), 'respects group filter: ' + await lab());
  await page.fill('#boardSearch', 'zebra');
  ok(/Archive 1 done/.test(await lab()), 'respects search: ' + await lab());
  await page.click('#archDone');
  ok(await cTitle() === 'Archive 1 done item?', 'confirm title (1): ' + await cTitle());
  ok(/Done items in Milltrans · Main build · “zebra” will move to the Archive/.test(await cMsg()), 'confirm names project, group and search: ' + await cMsg());
  await page.click('#cCancel');
  ok(!!bItem(GH.M4) && !aItem(GH.M4), 'Cancel changes nothing');
  await page.fill('#boardSearch', '');
  await page.click('#archDone');
  ok(await cTitle() === 'Archive 2 done items?', 'confirm title: ' + await cTitle());
  ok(await cMsg() === 'Done items in Milltrans · Main build will move to the Archive, where you can restore them.', 'confirm message: ' + await cMsg());
  ok(await page.locator('#cOk').textContent() === 'Archive' && !(await page.locator('#cOk').getAttribute('class')).includes('danger'), 'confirm button is plain "Archive"');
  await page.click('#cOk');
  await st();
  ok(!bItem(GH.M1) && !bItem(GH.M4) && !!bItem(GH.M2) && !!bItem(GH.A1) && !!bItem(GH.M3), 'exactly the filtered done items left board.json');
  const a1 = aItem(GH.M1), a4 = aItem(GH.M4);
  ok(!!a1 && !!a4 && a1.archivedAt && a4.archivedAt && arc().items.length === 2, 'both are in archive.json with archivedAt');
  const { archivedAt, ...a1rest } = a1;
  ok(JSON.stringify(a1rest) === JSON.stringify(m1Orig) && a1.subtasks.length === 2 && a1.doneAt, 'archived copy keeps every field (subtasks, doneAt, createdAt)');
  ok(/2 items archived/.test(await toastTxt()) && await page.locator('.toast.show .toast-btn:not([hidden])').count() === 0, 'toast "2 items archived", no Undo');
  ok(await page.locator('#archDone').isHidden(), 'button hidden when 0 match the filters');
  await page.click('#navBoard');
  ok(/Archive 2 done/.test(await lab()), 'filters cleared: ' + await lab());

  /* ---------- 3. single archive + Undo ---------- */
  await moreBtn(GH.A2);
  await popClick('[data-a="archive"]');
  ok(await card(GH.A2).count() === 0, 'card leaves the board immediately');
  ok(/“Alpha open” archived/.test(await toastTxt()) && await page.locator('.toast.show .toast-btn:not([hidden])').count() === 1, 'toast with Undo: ' + await toastTxt());
  await st();
  ok(!bItem(GH.A2) && !!aItem(GH.A2) && !!aItem(GH.A2).archivedAt, 'saved: in archive.json only');
  await page.click('.toast-btn');
  await st(); await wait(200);
  ok(!!bItem(GH.A2) && !aItem(GH.A2) && await card(GH.A2).count() === 1, 'Undo puts it back (board + disk)');
  ok(bItem(GH.A2).project === 'Alpha' && bItem(GH.A2).status === 'open', 'restored item unchanged');
  await openPopup(GH.A2);
  await page.click('#detail [data-dact="archive"]');
  ok(!(await page.locator('#detailBg').getAttribute('class')).includes('open'), 'popup closes after Archive');
  await st();
  ok(!bItem(GH.A2) && !!aItem(GH.A2), 'archive from the popup saved');

  /* ---------- 4. bulk archive the rest of the done items ---------- */
  await page.click('#archDone');
  ok(await cMsg() === 'All done items will move to the Archive, where you can restore them.', 'no filters: "All done items…"');
  await page.click('#cOk');
  await st();
  ok(arc().items.length === 5 && unique(arc().items.map(i => i.id)) && disk().items.length === 1 && !!bItem(GH.M3), 'archive has 5, board has only the open item');

  /* ---------- 5. Archive page ---------- */
  await page.click('#navArchive');
  await page.waitForSelector('.arch-row');
  ok(await rows().count() === 5, 'archive lists 5 rows');
  const t = await rowTitles();
  ok(['Alpha done', 'Tidy docs'].includes(t[0]) && ['Alpha done', 'Tidy docs'].includes(t[1]) && t[2] === 'Alpha open' && ['Build login', 'Zebra rollout'].includes(t[3]) && ['Build login', 'Zebra rollout'].includes(t[4]), 'newest archived first: ' + t.join(' | '));
  ok(await row(GH.M1).locator('.pill.static').textContent() === 'Done' && await row(GH.A2).locator('.pill.static').textContent() === 'Open', 'static status pills');
  ok((await row(GH.M1).locator('.steps').textContent()).trim() === '1/2', 'steps chip 1/2');
  ok(/Done .+ · Archived /.test(await row(GH.M1).locator('.arch-dates').textContent()) && /^Archived /.test(await row(GH.A2).locator('.arch-dates').textContent()), 'dates line: ' + await row(GH.M1).locator('.arch-dates').textContent());
  ok(await row(GH.M1).locator('.chip.proj').count() === 1 && /teal/.test(await row(GH.M1).locator('.chip.proj').getAttribute('style') || ''), 'project chip is coloured');
  ok(await rows().locator('[data-act="restore"]').count() === 5, 'every row has Restore');
  await page.fill('#archSearch', 'zebra');
  ok((await rowTitles()).join() === 'Zebra rollout', 'search matches the description');
  await page.fill('#archSearch', 'tests');
  ok((await rowTitles()).join() === 'Build login', 'search matches step text');
  await page.fill('#archSearch', 'alpha');
  ok((await rows().count()) === 2, 'search matches project / title');
  await page.fill('#archSearch', 'qqqq');
  ok(/No matches/.test(await page.textContent('#archList')), 'No matches state');
  await page.fill('#archSearch', '');
  ok(JSON.stringify(await optVals('archProj')) === JSON.stringify(['all', 'Alpha', 'Milltrans']), 'project options: ' + (await optVals('archProj')).join());
  await setSel('archProj', 'Alpha');
  ok(await rows().count() === 2, 'project filter');
  ok(JSON.stringify(await optVals('archGrp')) === JSON.stringify(['all', 'Docs']), 'group options narrowed by project: ' + (await optVals('archGrp')).join());
  await setSel('archGrp', 'Docs');
  ok((await rowTitles()).join() === 'Alpha done', 'group filter');
  await setSel('archProj', 'Milltrans');
  ok(JSON.stringify(await optVals('archGrp')) === JSON.stringify(['all', 'Docs', 'Main build']), 'group options for Milltrans: ' + (await optVals('archGrp')).join());
  await setSel('archGrp', 'Main build');
  ok(await rows().count() === 2, 'Milltrans + Main build = 2');
  await setSel('archProj', 'Alpha');
  ok(await page.locator('#archGrp').inputValue() === 'all' && await rows().count() === 2, 'stale group resets when project changes');
  await page.click('#archProjBtn'); await popClick('[data-v="all"]');
  ok(await rows().count() === 5, 'custom picker works: back to All projects');
  ok(await page.locator('label[for="archProjBtn"]').count() === 1, 'project filter has a label');

  await page.focus('.arch-row[data-id="' + GH.M4 + '"] .arch-title');
  await page.keyboard.press('Enter'); await wait(150);
  ok((await page.locator('#detailBg').getAttribute('class')).includes('open') && /Zebra rollout/.test(await page.textContent('#detail')), 'keyboard: Enter on a row title opens it');
  await page.keyboard.press('Escape');
  ok(!(await page.locator('#detailBg').getAttribute('class')).includes('open'), 'Esc closes it');
  await row(GH.M4).locator('.arch-dates').click(); await wait(150);
  ok((await page.locator('#detailBg').getAttribute('class')).includes('open'), 'clicking the row body opens it');
  await page.click('#detail [data-dact="close"]');

  await row(GH.M1).locator('.arch-title').click(); await wait(150);
  ok(/Build login/.test(await page.textContent('#detail h2')) && /High/.test(await page.textContent('#detail .d-prio')), 'read-only popup: title + priority');
  ok(await page.locator('#detail li.sub').count() === 2 && await page.locator('#detail li.sub.done').count() === 1, 'read-only checklist: 2 steps, 1 ticked');
  ok(/line-through/.test(await page.locator('#detail li.sub.done .sub-ro').evaluate(e => getComputedStyle(e).textDecorationLine)), 'ticked step is struck through');
  ok(await page.locator('#detail .sub-add, #detail [data-ds], #detail [data-dact="edit"], #detail [data-dact="del"], #detail .sub-rm').count() === 0, 'no editing controls');
  ok(await page.locator('#detail input.sub-cb:not([disabled])').count() === 0, 'checkboxes are disabled');
  ok(/Created .* · Done .* · Archived /.test(await page.textContent('#detail .d-dates')) && /Milltrans/.test(await page.textContent('#detail .d-crumbs')) && /Main build/.test(await page.textContent('#detail .d-crumbs')), 'popup: project, group and all three dates');
  ok(await page.locator('#detail [data-dact]').allTextContents().then(a => a.join() === 'Close,Restore'), 'footer: Close, Restore');
  await page.click('#detail [data-dact="restore"]');
  ok(!(await page.locator('#detailBg').getAttribute('class')).includes('open'), 'Restore in the popup closes it');
  await st();
  ok(/“Build login” restored to the board/.test(await toastTxt()), 'toast: ' + await toastTxt());
  ok(JSON.stringify(bItem(GH.M1)) === JSON.stringify(m1Orig) && !aItem(GH.M1), 'restored M1 is identical to the original (id, createdAt, doneAt, subtasks) and gone from archive.json');
  ok(await row(GH.M1).count() === 0 && await rows().count() === 4, 'row disappears');
  await row(GH.M4).locator('[data-act="restore"]').click();
  await st();
  ok(!!bItem(GH.M4) && !aItem(GH.M4) && !bItem(GH.M4).archivedAt, 'row Restore button works');

  /* ---------- 6. close project ---------- */
  await page.click('#navBoard');
  await page.click('[data-nav="project"][data-v="Milltrans"]');
  await page.click('#manageProj');
  await page.click('.pcl[data-p="Beta"]');
  ok(await cMsg() === 'The project leaves the board and is kept in the Archive, where you can reopen it.', '0 items message: ' + await cMsg());
  await page.click('#cCancel');
  await page.click('.pcl[data-p="Milltrans"]');
  ok(await cTitle() === 'Close Milltrans?', 'close title: ' + await cTitle());
  ok(/^All 3 items move to the Archive \(1 isn’t done yet\)\. The project leaves the board and is kept in the Archive, where you can reopen it\.$/.test(await cMsg()), 'close message mentions not-done count: ' + await cMsg());
  await page.click('#cOk');
  await st();
  ok(!disk().projects.includes('Milltrans') && !('Milltrans' in disk().projectColors), 'project gone from board.json (list + colour)');
  ok(disk().items.length === 0, 'its items left board.json (any status)');
  ok(arc().items.filter(i => i.project === 'Milltrans').length === 4 && unique(arc().items.map(i => i.id)), 'items in archive.json (+ M2 from before), no dups');
  const rec = arc().projects.find(p => p.name === 'Milltrans');
  ok(rec && rec.color === 'teal' && /^\d{4}-/.test(rec.closedAt), 'closed record with colour: ' + JSON.stringify(rec));
  ok(await page.locator('[data-nav="project"][data-v="Milltrans"]').count() === 0, 'project gone from the sidebar');
  ok(await page.textContent('#boardTitle') === 'All items', 'board filter reset to all');
  await page.click('#pClose');

  /* ---------- 7. archive page: closed project ---------- */
  await page.click('#navArchive');
  await page.waitForSelector('.arch-row');
  ok(await rows().count() === 6, 'archive now 6 rows');
  ok((await optTexts('archProj')).some(x => /^Milltrans · closed \d{1,2} \w{3} \d{4}$|^Milltrans · closed .*\d{4}$/.test(x)), 'closed label in project select: ' + (await optTexts('archProj')).join(' / '));
  await setSel('archProj', 'Milltrans');
  ok(await rows().count() === 4, 'closed project shows its 4 items');
  const banner = (await page.textContent('#archBanner')).trim();
  ok(/Milltrans was closed on .*\d{4} · 4 items/.test(banner) && await page.locator('#archBanner [data-act="reopen"]').textContent() === 'Reopen project', 'banner: ' + banner);
  await page.click('[data-theme-pref="light"]');
  await page.click('[data-theme-pref="dark"]');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'archive page does not overflow at 390px');
  await page.click('#menuBtn');
  await page.click('#navBoard');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'board page does not overflow at 390px');
  await page.setViewportSize({ width: 1300, height: 800 });
  await page.click('#navArchive');

  /* ---------- 8. restoring one item brings the project back ---------- */
  await row(GH.M3).locator('[data-act="restore"]').click();
  await st();
  ok(disk().projects.includes('Milltrans') && disk().projectColors.Milltrans === 'teal' && !!bItem(GH.M3), 'project + colour back on the board with the item');
  ok(!arc().projects.some(p => p.name === 'Milltrans') && !aItem(GH.M3), 'closed record and item removed from archive.json');
  ok((await page.textContent('#archBanner')).trim() === '', 'banner gone');
  ok((await optTexts('archProj')).includes('Milltrans'), 'select label no longer says closed');
  ok(await page.locator('[data-nav="project"][data-v="Milltrans"]').count() === 1, 'project back in the sidebar');

  /* ---------- 9. reopen project ---------- */
  await page.click('#navBoard');
  await page.click('#manageProj');
  await page.click('.pcl[data-p="Milltrans"]');
  ok(/^The item moves to the Archive \(it isn’t done yet\)\./.test(await cMsg()), '1-item message: ' + await cMsg());
  await page.click('#cOk');
  await st();
  await page.click('#pClose');
  await page.click('#navArchive');
  await setSel('archProj', 'Milltrans');
  await page.click('#archBanner [data-act="reopen"]');
  ok(await cTitle() === 'Reopen Milltrans?' && await cMsg() === 'The project and its 4 items go back on the board.', 'reopen confirm: ' + await cTitle() + ' / ' + await cMsg());
  await page.click('#cOk');
  await st();
  ok(/Milltrans reopened/.test(await toastTxt()), 'toast: ' + await toastTxt());
  ok(disk().projects.includes('Milltrans') && disk().projectColors.Milltrans === 'teal', 'project back with its colour');
  ok(disk().items.filter(i => i.project === 'Milltrans').length === 4, 'all 4 items back on the board');
  ok(!arc().projects.some(p => p.name === 'Milltrans') && arc().items.every(i => i.project !== 'Milltrans'), 'archive has no Milltrans left');
  ok(await page.locator('#archProj').inputValue() === 'all', 'project filter reset');
  ok(JSON.stringify(bItem(GH.M1)) === JSON.stringify(m1Orig), 'M1 still identical after the round trip');

  /* ---------- 10. retried requests ---------- */
  await closeToast();
  let r1 = await api('POST', '/api/archive', { ids: [GH.M1] }), r2 = await api('POST', '/api/archive', { ids: [GH.M1] });
  ok(r1.s === 200 && r2.s === 200 && r2.j.ok, 'archive twice: both 200');
  ok(arc().items.filter(i => i.id === GH.M1).length === 1 && !bItem(GH.M1), 'archive twice: one copy, off the board');
  r1 = await api('POST', '/api/archive/restore', { ids: [GH.M1] }); r2 = await api('POST', '/api/archive/restore', { ids: [GH.M1] });
  ok(r1.s === 200 && r2.s === 200, 'restore twice: both 200');
  ok(disk().items.filter(i => i.id === GH.M1).length === 1 && !aItem(GH.M1), 'restore twice: one copy on the board');
  ok((await api('POST', '/api/archive', { ids: [] })).s === 400 && (await api('POST', '/api/archive', { ids: ['nope'] })).s === 400 &&
    (await api('POST', '/api/archive', {})).s === 400 && (await api('POST', '/api/archive/restore', { ids: 'x' })).s === 400, 'bad ids -> 400');
  const many = Array.from({ length: 1001 }, (_, i) => 'i-x-' + i);
  ok((await api('POST', '/api/archive', { ids: many })).s === 400, '1001 ids -> 400');
  ok((await api('POST', '/api/archive', { ids: ['i-zz-zz'] })).s === 200 && !fs.statSync(archFile).isDirectory(), 'unknown ids ignored');
  r1 = await api('POST', '/api/projects/Milltrans/close');
  const m0 = fs.statSync(archFile).mtimeMs, mb = fs.statSync(boardFile).mtimeMs;
  await wait(30);
  r2 = await api('POST', '/api/projects/Milltrans/close');
  ok(r1.s === 200 && r2.s === 200, 'close twice: both 200');
  ok(fs.statSync(archFile).mtimeMs === m0 && fs.statSync(boardFile).mtimeMs === mb, 'second close wrote nothing');
  ok(arc().projects.filter(p => p.name === 'Milltrans').length === 1 && unique(arc().items.map(i => i.id)), 'close twice: one record, no duplicate items');
  r1 = await api('POST', '/api/projects/Milltrans/reopen'); r2 = await api('POST', '/api/projects/Milltrans/reopen');
  ok(r1.s === 200 && r2.s === 200 && disk().projects.filter(p => p === 'Milltrans').length === 1 && unique(disk().items.map(i => i.id)), 'reopen twice: both 200, no duplicates');
  ok((await api('POST', '/api/projects/Nope/close')).s === 404 && (await api('POST', '/api/projects/Nope/reopen')).s === 404, 'unknown project -> 404');
  await api('POST', '/api/projects', { name: 'Empty', color: 'rose' });
  await api('POST', '/api/projects/Empty/close');
  ok(!disk().projects.includes('Empty') && arc().projects.some(p => p.name === 'Empty' && p.color === 'rose'), 'empty project closes (record only)');
  await api('POST', '/api/projects/Empty/reopen');
  ok(disk().projects.includes('Empty') && disk().projectColors.Empty === 'rose' && !arc().projects.some(p => p.name === 'Empty'), 'empty project reopens with its colour');
  ok(unique(disk().items.map(i => i.id)) && unique(arc().items.map(i => i.id)) && arc().items.every(a => !disk().items.some(b => b.id === a.id)), 'no item in both files');

  /* ---------- 11. offline ---------- */
  await api('POST', '/api/items', { id: 'i-tt-o1', title: 'Off one', project: 'Alpha', status: 'open' });
  await api('POST', '/api/items', { id: 'i-tt-o2', title: 'Beta item', project: 'Beta', status: 'done' });
  await page.click('#navBoard');
  await page.reload();
  await page.waitForSelector('#board .card');
  const offline = () => page.route('**/api/**', r => (r.request().method() === 'GET' ? r.continue() : r.abort('connectionreset')));
  await offline();
  await moreBtn('i-tt-o1');
  await popClick('[data-a="archive"]');
  ok(await card('i-tt-o1').count() === 0, 'offline: archived card leaves the board at once');
  await state('pending');
  await page.click('#manageProj');
  await page.click('.pcl[data-p="Beta"]');
  await page.click('#cOk');
  ok(await page.locator('[data-nav="project"][data-v="Beta"]').count() === 0 && await card('i-tt-o2').count() === 0, 'offline: closed project + item vanish at once');
  await page.click('#pClose');
  await wait(300);
  ok(!!bItem('i-tt-o1') && disk().projects.includes('Beta'), 'offline: nothing saved yet');
  await page.reload();
  await page.waitForSelector('#board .card');
  ok(await card('i-tt-o1').count() === 0 && await page.locator('[data-nav="project"][data-v="Beta"]').count() === 0, 'offline: still applied after a reload');
  ok(/2 changes/.test(await page.textContent('#boardView [data-sync]')), 'pill counts 2 waiting changes: ' + (await page.textContent('#boardView [data-sync]')).trim());
  await page.click('#navArchive');
  await page.waitForSelector('.arch-row');
  ok((await rowTitles()).includes('Off one') && (await rowTitles()).includes('Beta item'), 'offline: Archive page (first opened now) shows the pending items');
  ok((await optTexts('archProj')).some(x => /^Beta · closed/.test(x)), 'offline: Beta shows as closed');
  await page.click('#navBoard');
  await page.unroute('**/api/**');
  await page.click('#boardView [data-sync]');
  await st(); await wait(300);
  ok(!bItem('i-tt-o1') && !bItem('i-tt-o2') && !disk().projects.includes('Beta'), 'back online: board.json updated');
  ok(arc().items.filter(i => i.id === 'i-tt-o1').length === 1 && arc().items.filter(i => i.id === 'i-tt-o2').length === 1 && arc().projects.filter(p => p.name === 'Beta').length === 1, 'saved exactly once');
  ok(unique(arc().items.map(i => i.id)), 'no duplicates in archive.json');
  // restore while offline
  await page.click('#navArchive');
  await page.waitForSelector('.arch-row');
  await offline();
  await row('i-tt-o1').locator('[data-act="restore"]').click();
  ok(await row('i-tt-o1').count() === 0, 'offline: restored row leaves the archive list');
  await state('pending');
  await page.reload();
  await page.waitForSelector('#navBoard');
  await page.click('#navBoard');
  await page.waitForSelector('#board .card');
  ok(await card('i-tt-o1').count() === 1, 'offline: restored item is on the board after reload');
  await page.unroute('**/api/**');
  await page.click('#boardView [data-sync]');
  await st(); await wait(300);
  ok(disk().items.filter(i => i.id === 'i-tt-o1').length === 1 && !aItem('i-tt-o1'), 'restore saved once');
  ok(await page.locator('#boardView [data-sync]').getAttribute('data-state') === 'ok', 'sync pill back to ok');

  /* ---------- board header screenshot ---------- */

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);

  ok(errors.length === 0, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));

  done();
});
