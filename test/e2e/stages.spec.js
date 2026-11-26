const fs = require('fs');
const path = require('path');
const { test, checks } = require('./helpers');

test.use({ seed: require('./fixtures/stages-board.json') });

test('stages', async ({ browser, app }, testInfo) => {
  const BASE = app.baseURL;
  const DATA = app.dataDir;
  const { ok, done } = checks(testInfo);
  const boardFile = path.join(DATA, 'board.json');
  const archFile = path.join(DATA, 'archive.json');
  const disk = () => JSON.parse(fs.readFileSync(boardFile, 'utf8'));
  const arc = () => (fs.existsSync(archFile) ? JSON.parse(fs.readFileSync(archFile, 'utf8')) : { items: [], projects: [] });
  const bItem = id => disk().items.find(i => i.id === id);
  const aItem = id => arc().items.find(i => i.id === id);
  const byTitle = t => disk().items.find(i => i.title === t);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => { errors.push(e.message); ok(false, 'page error: ' + e.message); });
  const st = () => page.waitForFunction(() => document.querySelector('#boardView [data-sync]').dataset.state === 'ok', null, { timeout: 15000 }).then(() => wait(300));
  const toastTxt = async () => ((await page.locator('.toast .toast-msg').textContent()) || '').trim();
  const api = (m, u, b) => page.evaluate(([m, u, b]) => fetch(u, { method: m, headers: { 'X-Triage': '1', 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined })
    .then(async r => ({ s: r.status, j: await r.json().catch(() => null) })), [m, u, b]);
  const setSel = (id, v) => page.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
  const card = id => page.locator('.card[data-id="' + id + '"]');
  const popClick = async sel => { await page.waitForSelector('#pop ' + sel); await page.evaluate(sel => document.querySelector('#pop ' + sel).click(), sel); };
  const pick = async (btnId, v) => { await page.click('#' + btnId); await popClick('[data-v="' + v + '"]'); await wait(80); };
  const moreBtn = async id => { await card(id).scrollIntoViewIfNeeded(); await wait(150); await card(id).locator('[data-act="more"]').click(); };
  const openEditFor = async id => { await moreBtn(id); await popClick('[data-a="edit"]'); await wait(150); };
  const openPopup = async id => { await moreBtn(id); await popClick('[data-a="open"]'); await wait(150); };
  const closeToast = () => page.evaluate(() => { const t = document.querySelector('.toast'); if (t) t.classList.remove('show'); });
  const goProject = async name => { await page.click('#navBoard'); await page.click('#navProjects [data-v="' + name + '"]'); await wait(100); };
  const segTexts = () => page.locator('.stage-seg').allTextContents();
  const curSeg = () => page.locator('.stage-seg[aria-current="step"]').getAttribute('aria-label');
  const nextBtn = () => page.locator('.stage-next').textContent();
  const cOpen = () => page.locator('#confirmBg.open').count();
  const cMsg = () => page.locator('#cMsg').textContent();
  const cTitle = () => page.locator('#cTitle').textContent();
  const confirmOk = async () => { await page.waitForSelector('#confirmBg.open'); await page.click('#cOk'); await wait(100); };
  const addItem = async (title, groupText) => {
    await page.click('#addBtn'); await wait(150);
    await page.fill('#mTitleIn', title);
    if (groupText) await page.fill('#mGroup', groupText);
    await page.click('#mSave'); await st();
  };
  const navText = name => page.locator('#navProjects [data-v="' + name + '"]').textContent();
  const mkApi = (id, title, project, status, extra) => api('POST', '/api/items', Object.assign({ id, title, project, status, prio: 'medium' }, extra));

  /* ---------- 0. an old board (no stages anywhere) ---------- */
  ok(!fs.existsSync(archFile), 'start: no archive.json');
  ok(!('projectStages' in disk()), 'start: board.json has no projectStages');
  await page.goto(BASE);
  await page.waitForSelector('#board .card');
  for (const p of ['Milltrans', 'Alpha', 'Beta']) {
    ok(/·\s*Implementation/.test(await navText(p)), 'old board: sidebar shows ' + p + ' at Implementation');
  }
  ok(await page.locator('#stageBar').isHidden(), 'stage track hidden on All items');
  ok(await page.locator('#board .stagechip').count() === 0, 'old board: no earlier-stage chips on cards');
  const bd0 = (await api('GET', '/api/board')).j;
  ok(same(bd0.projectStages, {}), 'GET /api/board adds an empty projectStages');
  await page.click('#navProjects [data-v="(no project)"]');
  ok(await page.locator('#stageBar').isHidden(), 'stage track hidden on (no project)');
  ok(await page.locator('#navProjects [data-v="(no project)"] .nav-stage').count() === 0, 'no stage text on the (no project) row');

  /* ---------- 1. the track only shows for a project ---------- */
  await goProject('Milltrans');
  ok(await page.locator('#stageBar').isVisible(), 'stage track visible on a project');
  ok(same(await segTexts(), ['Implementation', 'Go Live', 'Acceptance', 'Hypercare']), 'track has the four stages in order');
  ok(await curSeg() === 'Implementation (current stage)', 'current segment has aria-current + label');
  ok(await page.locator('.stage-seg[aria-current="step"]').count() === 1, 'exactly one aria-current step');
  ok((await nextBtn()).trim() === 'Move to Go Live', 'button reads Move to Go Live');
  ok(await page.locator('.stage-seg svg').count() === 0, 'no check icons at the first stage');
  await goProject('Alpha');
  ok(await page.locator('#stageBar').isVisible(), 'track shows for Alpha too');
  await page.click('#navBoard');
  ok(await page.locator('#stageBar').isHidden(), 'track hidden again on All items');
  await goProject('Milltrans');

  /* ---------- 2. a new item takes the project's stage ---------- */
  await page.click('#addBtn'); await wait(150);
  ok(await page.locator('#mStageFld').isVisible(), 'Stage field shows when a project is chosen');
  ok(await page.locator('#mStage').inputValue() === 'implementation', 'Stage defaults to the project stage');
  await setSel('mProj', '');
  ok(await page.locator('#mStageFld').isHidden(), 'Stage field hidden with no project');
  await setSel('mProj', 'Milltrans');
  ok(await page.locator('#mStageFld').isVisible() && await page.locator('#mStage').inputValue() === 'implementation', 'Stage field back after choosing a project');
  await page.fill('#mTitleIn', 'New C1');
  await page.click('#mSave'); await st();
  ok(byTitle('New C1').stage === 'implementation', 'new item saved with the current stage on disk');
  await page.click('#addBtn'); await wait(150);
  await setSel('mProj', ''); await page.fill('#mTitleIn', 'Loose 2'); await page.click('#mSave'); await st();
  ok(byTitle('Loose 2').project === '' && byTitle('Loose 2').stage === undefined, 'item with no project has no stage on disk');

  /* ---------- 3. move forward: Implementation -> Go Live ---------- */
  await goProject('Milltrans');
  await page.click('.stage-next');
  await page.waitForSelector('#confirmBg.open');
  ok(await cTitle() === 'Move Milltrans to Go Live?', 'confirm title');
  ok(await cMsg() === '2 done items move to the Archive. 3 unfinished items stay on the board.', 'confirm counts: ' + (await cMsg()));
  await page.click('#cOk'); await wait(100);
  ok(await toastTxt() === 'Milltrans moved to Go Live', 'toast says Milltrans moved to Go Live: ' + await toastTxt());
  ok(await card('i-st-d1').count() === 0 && await card('i-st-d2').count() === 0, 'done items leave the board straight away');
  ok(await curSeg() === 'Go Live (current stage)', 'track now at Go Live');
  ok((await nextBtn()).trim() === 'Move to Acceptance', 'button now Move to Acceptance');
  ok(await page.locator('.stage-seg.done').count() === 1 && await page.locator('.stage-seg.done svg').count() === 1, 'earlier stage styled complete with a check');
  await st();
  let bd = disk(), ar = arc();
  ok(bd.projectStages.Milltrans === 'golive', 'board.projectStages.Milltrans = golive');
  ok(!bd.projectStages.Alpha, 'Alpha untouched');
  ok(!bItem('i-st-d1') && !bItem('i-st-d2'), 'done items removed from board.json');
  ok(aItem('i-st-d1') && aItem('i-st-d1').stage === 'implementation' && aItem('i-st-d2').stage === 'implementation', 'done items in archive.json with stage implementation');
  ok(aItem('i-st-d1').archivedAt, 'archived items have archivedAt');
  ok(['i-st-o1', 'i-st-o2'].every(id => bItem(id).stage === 'implementation') && byTitle('New C1').stage === 'implementation', 'unfinished items stamped implementation and stay');
  ok(bItem('i-st-a1').stage === undefined, 'items of other projects not stamped');
  ok(await card('i-st-o1').locator('.stagechip').textContent() === 'Implementation', 'earlier-stage chip on an unfinished card');
  ok(await card('i-st-o1').locator('.stagechip').getAttribute('title') === 'From an earlier stage: Implementation', 'chip title');
  ok(/Milltrans\s*·\s*Go Live/.test(await navText('Milltrans')) && /Alpha\s*·\s*Implementation/.test(await navText('Alpha')), 'sidebar: Milltrans · Go Live, Alpha · Implementation');
  ok(arc().projects.length === 0, 'moving a stage does not close the project');

  /* ---------- 4. new items at Go Live, group suggestions ---------- */
  await page.click('#addBtn'); await wait(150);
  ok(await page.locator('#mStage').inputValue() === 'golive', 'new item defaults to Go Live');
  await page.focus('#mGroup'); await wait(100);
  let sug = await page.locator('#mGroupSug .sug').allTextContents();
  ok(same(sug.slice(0, 3), ['Training', 'Customer Testing', 'Defect Resolution']), 'Go Live activities come first: ' + sug.join(' | '));
  ok(sug.length === new Set(sug.map(s => s.toLowerCase())).size, 'suggestions have no case-insensitive duplicates');
  ok(sug.indexOf('Billing') > 2 && sug.indexOf('Main') > 2, 'existing groups follow the activities');
  await page.keyboard.press('Escape');
  await pick('mStageBtn', 'hypercare');
  await page.focus('#mTitleIn'); await page.focus('#mGroup'); await wait(100);
  sug = await page.locator('#mGroupSug .sug').allTextContents();
  ok(same(sug.slice(0, 2), ['User Onboarding', 'Support Takeover']), 'changing the stage changes the activities: ' + sug.join(' | '));
  await pick('mStageBtn', 'golive');
  await page.fill('#mTitleIn', 'New G1');
  await page.click('#mSave'); await st();
  ok(byTitle('New G1').stage === 'golive', 'new item gets golive');
  ok(await card(byTitle('New G1').id).locator('.stagechip').count() === 0, 'current-stage card shows no chip');
  await page.click('#addBtn'); await wait(150);
  await page.fill('#mTitleIn', 'Typed group'); await page.fill('#mGroup', 'Custom area'); await page.click('#mSave'); await st();
  ok(byTitle('Typed group').group === 'Custom area', 'any group can still be typed');

  /* ---------- 5. edit modal ---------- */
  await goProject('Alpha');
  await openEditFor('i-st-a1');
  ok(await page.locator('#mStageFld').isVisible() && await page.locator('#mStage').inputValue() === 'implementation', 'edit: stage-less item shows its effective stage');
  await pick('mProjBtn', 'Milltrans');
  ok(await page.locator('#mStage').inputValue() === 'golive', 'changing the project resets the stage to that project\'s current stage');
  await pick('mProjBtn', 'Alpha');
  ok(await page.locator('#mStage').inputValue() === 'implementation', 'and back to the other project\'s stage');
  await page.click('#mCancel');
  await goProject('Milltrans');
  await openEditFor('i-st-o1');
  ok(await page.locator('#mStage').inputValue() === 'implementation', 'edit: own stage shown');
  await pick('mStageBtn', 'acceptance');
  await page.click('#mSave'); await wait(100);
  ok(await toastTxt() === '“Open C” moved to Acceptance stage', 'toast for a stage-only change: ' + (await toastTxt()));
  await st();
  ok(bItem('i-st-o1').stage === 'acceptance', 'changed stage saved on disk');
  await page.click('.toast-btn'); await st();
  ok(bItem('i-st-o1').stage === 'implementation', 'Undo restores the stage');
  await closeToast();
  await goProject('Alpha');
  await openEditFor('i-st-a1');
  await page.click('#mSave'); await wait(300);
  ok(bItem('i-st-a1').stage === undefined && await page.locator('#boardView [data-sync]').getAttribute('data-state') === 'ok', 'saving an unchanged stage-less item sends nothing');
  await openEditFor('i-st-a1');
  await pick('mStageBtn', 'golive');
  await page.click('#mSave'); await st();
  ok(bItem('i-st-a1').stage === 'golive', 'stage-less item given an explicit stage');
  await page.click('.toast-btn'); await st();
  ok(bItem('i-st-a1').stage === undefined, 'Undo takes it back to stage-less');
  await closeToast();
  // popup
  await goProject('Milltrans');
  await openPopup('i-st-o1');
  ok(await page.locator('#detail .d-crumbs .stagechip, .modal.detail .d-crumbs .stagechip').first().textContent() === 'Implementation', 'popup crumbs show the item\'s stage');
  await page.keyboard.press('Escape'); await wait(100);

  /* ---------- 6. jump two stages: archives done items from all earlier stages ---------- */
  await mkApi('i-st-g2', 'Done G2', 'Milltrans', 'done', { stage: 'golive' });
  await api('PATCH', '/api/items/i-st-o2', { status: 'done' });
  await page.reload(); await page.waitForSelector('#board .card');
  await goProject('Milltrans');
  await page.click('.stage-seg[data-stage="hypercare"]');
  await page.waitForSelector('#confirmBg.open');
  const exp = disk().items.filter(i => i.project === 'Milltrans');
  const nDone = exp.filter(i => i.status === 'done').length, nOpen = exp.filter(i => i.status !== 'done').length;
  ok(await cTitle() === 'Move Milltrans to Hypercare?' && await cMsg() === nDone + ' done items move to the Archive. ' + nOpen + ' unfinished items stay on the board.' && nDone === 2, 'two-stage confirm: ' + (await cMsg()));
  await confirmOk(); await st();
  ok(!bItem('i-st-o2') && !bItem('i-st-g2'), 'done items from both earlier stages left the board');
  ok(aItem('i-st-o2').stage === 'implementation' && aItem('i-st-g2').stage === 'golive', 'archived with their own stages');
  ok(disk().projectStages.Milltrans === 'hypercare', 'stage is hypercare');
  ok(['i-st-o1'].every(id => bItem(id).stage === 'implementation') && byTitle('New G1').stage === 'golive', 'unfinished keep their stages');
  ok((await nextBtn()).trim() === 'Close project', 'at Hypercare the button reads Close project');
  ok(await page.locator('.stage-seg.done').count() === 3, 'three completed stages');
  ok(await card('i-st-o1').locator('.stagechip').count() === 1 && await card(byTitle('New G1').id).locator('.stagechip').textContent() === 'Go Live', 'earlier-stage chips on cards left behind');

  /* ---------- 7. step back ---------- */
  const archCount = arc().items.length;
  await page.click('.stage-seg[data-stage="acceptance"]');
  await page.waitForSelector('#confirmBg.open');
  ok(await cTitle() === 'Move Milltrans back to Acceptance?' && await cMsg() === 'Nothing is archived. New items will go into Acceptance.', 'step-back confirm text');
  await page.click('#cCancel'); await wait(150);
  ok(disk().projectStages.Milltrans === 'hypercare', 'cancel changes nothing');
  await page.click('.stage-seg[aria-current="step"]'); await wait(150);
  ok(await cOpen() === 0, 'clicking the current segment does nothing');
  await page.click('.stage-seg[data-stage="golive"]');
  await confirmOk(); await st();
  ok(disk().projectStages.Milltrans === 'golive' && arc().items.length === archCount, 'stepped back to Go Live, nothing archived');
  ok(await toastTxt() === 'Milltrans moved to Go Live', 'toast after stepping back');
  await addItem('Back1');
  ok(byTitle('Back1').stage === 'golive', 'item added after stepping back gets Go Live');
  await page.click('.stage-seg[data-stage="implementation"]');
  await confirmOk(); await st();
  ok(disk().projectStages.Milltrans === undefined, 'back at Implementation: no projectStages entry');
  await addItem('Back2');
  ok(byTitle('Back2').stage === 'implementation', 'item added at Implementation gets implementation');
  ok(await card(byTitle('Back1').id).locator('.stagechip').count() === 0, 'items from a later stage show no chip');
  ok((await nextBtn()).trim() === 'Move to Go Live', 'button back to Move to Go Live');

  /* ---------- 8. Hypercare -> Close project -> reopen ---------- */
  await page.click('.stage-seg[data-stage="hypercare"]');
  await page.waitForSelector('#confirmBg.open');
  ok(/^No done items to archive\. \d+ unfinished items stay on the board\.$/.test(await cMsg()), 'zero done items text: ' + (await cMsg()));
  await confirmOk(); await st();
  await page.click('.stage-next');
  await page.waitForSelector('#confirmBg.open');
  ok(await cTitle() === 'Close Milltrans?', 'Close project runs the existing close confirm');
  await confirmOk(); await st();
  ok(await page.locator('#stageBar').isHidden(), 'closed project leaves the board (filter reset)');
  bd = disk(); ar = arc();
  ok(!bd.projects.includes('Milltrans') && bd.projectStages.Milltrans === undefined, 'project and its stage entry gone from the board');
  const rec = ar.projects.find(p => p.name === 'Milltrans');
  ok(rec && rec.stage === 'hypercare' && rec.color === 'teal', 'closed record stores the stage: ' + JSON.stringify(rec));
  // archive page
  await page.click('#navArchive'); await page.waitForSelector('#archList .arch-row');
  ok(await page.locator('#archStage').count() === 1, 'Archive has a stage filter');
  const stageOpts = await page.evaluate(() => Array.from(document.getElementById('archStage').options).map(o => o.text));
  ok(same(stageOpts, ['All stages', 'Implementation', 'Go Live', 'Acceptance', 'Hypercare']), 'stage filter options');
  const rowsAll = await page.locator('#archList .arch-row').count();
  ok(rowsAll === arc().items.length, 'all archived rows listed');
  const chipsOk = await page.evaluate(() => Array.from(document.querySelectorAll('#archList .arch-row')).every(r => r.querySelector('.meta .stagechip')));
  ok(chipsOk, 'every archive row shows a stage chip');
  await setSel('archStage', 'implementation');
  const wantImpl = arc().items.filter(i => i.stage === 'implementation').length;
  ok(await page.locator('#archList .arch-row').count() === wantImpl && wantImpl > 0, 'stage filter: Implementation rows = ' + wantImpl);
  ok((await page.locator('#archList .arch-row .stagechip').allTextContents()).every(t => t === 'Implementation'), 'only Implementation chips shown');
  await setSel('archStage', 'golive');
  ok(await page.locator('#archList .arch-row').count() === arc().items.filter(i => i.stage === 'golive').length, 'stage filter: Go Live');
  await setSel('archStage', 'all');
  // search is unchanged
  await page.fill('#archSearch', 'Done G2'); await wait(100);
  ok(await page.locator('#archList .arch-row').count() === 1, 'search still works with the stage filter');
  await page.fill('#archSearch', '');
  // archived popup shows the stage
  await page.locator('#archList .arch-row .arch-title').first().click(); await wait(200);
  ok(await page.locator('.modal.detail .d-crumbs .stagechip').count() === 1, 'archived item popup shows its stage');
  await page.keyboard.press('Escape'); await wait(100);
  // reopen
  await setSel('archProj', 'Milltrans'); await wait(100);
  await page.click('#archBanner [data-act="reopen"]');
  await confirmOk(); await st();
  ok(disk().projects.includes('Milltrans') && disk().projectStages.Milltrans === 'hypercare', 'reopen restores the stage');
  ok(!arc().projects.some(p => p.name === 'Milltrans'), 'closed record removed on reopen');
  await page.click('#navBoard');
  ok(/Milltrans\s*·\s*Hypercare/.test(await navText('Milltrans')), 'sidebar shows Hypercare after reopen');

  /* ---------- 9. stage-less archived items use the closed project's stage ---------- */
  const raw = disk();
  raw.projectStages = Object.assign({}, raw.projectStages, { Beta: 'acceptance' });
  raw.items.push({ id: 'i-st-bd', title: 'Beta done', project: 'Beta', status: 'done', prio: 'medium', group: '', note: '' });
  fs.writeFileSync(boardFile, JSON.stringify(raw, null, 2));
  await page.reload(); await page.waitForSelector('#board .card');
  ok(/Beta\s*·\s*Acceptance/.test(await navText('Beta')), 'a board with stages on disk shows them');
  let r = await api('POST', '/api/projects/Beta/close');
  ok(r.s === 200 && arc().projects.find(p => p.name === 'Beta').stage === 'acceptance' && aItem('i-st-bd').stage === undefined, 'close via API stores the stage; item stays stage-less');
  r = await api('POST', '/api/projects/Beta/close');
  ok(r.s === 200, 'closing twice is fine');
  await page.reload(); await page.waitForSelector('#board');
  await page.click('#navArchive'); await page.waitForSelector('#archList .arch-row');
  ok(await page.locator('.arch-row[data-id="i-st-bd"] .stagechip').textContent() === 'Acceptance', 'stage-less archived item shows its closed project\'s stage');
  await setSel('archStage', 'acceptance'); await wait(100);
  ok(await page.locator('.arch-row[data-id="i-st-bd"]').count() === 1, 'stage filter finds it by the closed record stage');
  await setSel('archStage', 'all');
  r = await api('POST', '/api/archive/restore', { ids: ['i-st-bd'] });
  ok(r.s === 200 && disk().projects.includes('Beta') && disk().projectStages.Beta === 'acceptance', 'restoring one item from a closed project brings the stage back');
  r = await api('POST', '/api/archive/restore', { ids: ['i-st-bd'] });
  ok(r.s === 200, 'restore twice is fine');
  await page.click('#navBoard');

  /* ---------- 10. API rules ---------- */
  r = await mkApi('i-st-x1', 'Api stage-less', 'Alpha', 'open');
  ok(r.j.stage === 'implementation' && bItem('i-st-x1').stage === 'implementation', 'POST /api/items: project item gets the project stage');
  r = await mkApi('i-st-x2', 'Api bogus', 'Milltrans', 'open', { stage: 'bogus' });
  ok(r.j.stage === 'hypercare', 'bogus stage replaced by the project stage');
  r = await mkApi('i-st-x3', 'Api own', 'Milltrans', 'open', { stage: 'golive' });
  ok(r.j.stage === 'golive', 'valid stage kept on create');
  r = await mkApi('i-st-x4', 'Api none', '', 'open', { stage: 'golive' });
  ok(r.j.stage === undefined, 'item with no project never has a stage');
  r = await api('PATCH', '/api/items/i-st-x3', { stage: 'acceptance' });
  ok(r.j.stage === 'acceptance', 'PATCH sets a stage');
  r = await api('PATCH', '/api/items/i-st-x3', { stage: '' });
  ok(r.j.stage === undefined && bItem('i-st-x3').stage === undefined, 'PATCH with empty stage clears it');
  r = await api('PATCH', '/api/items/i-st-x3', { stage: 'nope' });
  ok(r.j.stage === undefined, 'PATCH with an invalid stage clears it');
  r = await api('POST', '/api/projects/Alpha/stage', { stage: 'nope' });
  ok(r.s === 400 && r.j.error === 'Unknown stage.', '400 Unknown stage.');
  r = await api('POST', '/api/projects/Nobody/stage', { stage: 'golive' });
  ok(r.s === 404 && r.j.error === 'That project no longer exists.', '404 for a missing project');
  await api('POST', '/api/projects', { name: 'Temp' });
  await api('POST', '/api/projects/Temp/stage', { stage: 'acceptance' });
  ok(disk().projectStages.Temp === 'acceptance', 'Temp at acceptance');
  await api('DELETE', '/api/projects/Temp');
  ok(!('Temp' in disk().projectStages), 'deleting a project removes its stage entry');
  r = await api('PATCH', '/api/projects/Alpha', { color: 'rose' });
  ok(disk().projectStages.Milltrans === 'hypercare', 'unrelated writes keep projectStages');

  /* ---------- 11. zero-count confirm text and singular text ---------- */
  await api('POST', '/api/projects', { name: 'Empty' });
  await page.reload(); await page.waitForSelector('#board .card');
  await goProject('Empty');
  await page.click('.stage-next');
  await page.waitForSelector('#confirmBg.open');
  ok(await cMsg() === 'No done items to archive. No unfinished items.', 'confirm with nothing in the project: ' + (await cMsg()));
  await page.click('#cCancel'); await wait(100);
  await page.click('#navBoard');

  /* ---------- 12. offline: a stage move while saves fail ---------- */
  await goProject('Alpha');
  // Alpha: 'Alpha open' (stage-less or stamped) + 'Alpha done' (done) + api item (open)
  await page.route('**/api/**', route => (route.request().method() === 'GET' ? route.continue() : route.abort('connectionreset')));
  await page.click('.stage-next');
  await page.waitForSelector('#confirmBg.open');
  ok(await cMsg() === '1 done item moves to the Archive. 2 unfinished items stay on the board.', 'singular wording: ' + (await cMsg()));
  await confirmOk(); await wait(400);
  ok(await card('i-st-ad').count() === 0 && await curSeg() === 'Go Live (current stage)', 'offline: the move shows immediately');
  ok(/Alpha\s*·\s*Go Live/.test(await navText('Alpha')), 'offline: sidebar updated');
  ok(await page.locator('#boardView [data-sync]').getAttribute('data-state') !== 'ok', 'offline: not synced');
  ok(disk().projectStages.Alpha === undefined && !!bItem('i-st-ad'), 'offline: nothing on disk yet');
  await page.reload(); await page.waitForSelector('#board .card');
  await goProject('Alpha');
  ok(await curSeg() === 'Go Live (current stage)' && await card('i-st-ad').count() === 0, 'offline: move survives a reload');
  ok(await card('i-st-a1').locator('.stagechip').textContent() === 'Implementation', 'offline: earlier-stage chip after reload');
  const posts = [];
  page.on('request', q => { if (q.method() === 'POST' && /\/api\/projects\/Alpha\/stage$/.test(q.url())) posts.push(q.url()); });
  await page.unroute('**/api/**');
  await page.click('#boardView [data-sync]'); await st();
  ok(posts.length === 1, 'saved exactly once after reconnecting (' + posts.length + ' request)');
  ok(disk().projectStages.Alpha === 'golive' && !bItem('i-st-ad') && aItem('i-st-ad') && aItem('i-st-ad').stage === 'implementation', 'saved: stage set, done item archived with its stage');
  ok(arc().items.filter(i => i.id === 'i-st-ad').length === 1, 'archived once');
  ok(bItem('i-st-a1').stage === 'implementation', 'stamped on the server too');

  /* ---------- 13. a retried POST /stage ---------- */
  const u0 = disk().updatedAt, a0 = JSON.stringify(arc().items.map(i => i.id).sort());
  r = await api('POST', '/api/projects/Alpha/stage', { stage: 'acceptance' });
  ok(r.s === 200 && r.j.ok === true && disk().projectStages.Alpha === 'acceptance', 'POST stage');
  const u1 = disk().updatedAt;
  r = await api('POST', '/api/projects/Alpha/stage', { stage: 'acceptance' });
  ok(r.s === 200 && r.j.ok === true, 'the same POST again succeeds');
  ok(disk().updatedAt === u1 && u1 !== u0, 'second identical POST writes nothing');
  ok(JSON.stringify(arc().items.map(i => i.id).sort()) === a0, 'no duplicates in the archive');
  r = await api('POST', '/api/projects/Alpha/stage', { stage: 'golive' });
  ok(r.s === 200 && disk().projectStages.Alpha === 'golive', 'backward POST');
  r = await api('POST', '/api/projects/Alpha/stage', { stage: 'golive' });
  ok(r.s === 200 && disk().projectStages.Alpha === 'golive', 'backward POST repeated');

  /* ---------- 14. looks: dark, light, phone ---------- */
  await api('POST', '/api/projects', { name: 'Shots', color: 'blue' });
  await mkApi('i-st-s1', 'Wire the invoice export', 'Shots', 'doing', { prio: 'high', group: 'Development' });
  await mkApi('i-st-s2', 'Customer sign-off call', 'Shots', 'open', { prio: 'medium', group: 'Customer Testing' });
  await mkApi('i-st-s3', 'Fix rounding on totals', 'Shots', 'blocked', { prio: 'critical' });
  await mkApi('i-st-s4', 'Training deck', 'Shots', 'done', { prio: 'low', group: 'Training' });
  await api('POST', '/api/projects/Shots/stage', { stage: 'golive' });
  await mkApi('i-st-s5', 'Train the finance team', 'Shots', 'open', { prio: 'medium', group: 'Training', stage: 'golive' });
  await page.reload(); await page.waitForSelector('#board .card');
  await goProject('Shots');
  // compact layout keeps the chip
  await page.click('#layoutSw [data-layout="compact"]'); await wait(150);
  ok(await card('i-st-s1').locator('.ct').evaluate(e => e.getBoundingClientRect().width) >= 60 && !(await card('i-st-s1').locator('.stagechip').isVisible()), 'compact layout, narrow column: title keeps its room, stage chip hidden');
  await page.click('#layoutSw [data-layout="cards"]'); await wait(100);
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(() => document.querySelector('#themeSw [data-theme-pref="light"]').click());
  await wait(200);
  await page.evaluate(() => document.querySelector('#themeSw [data-theme-pref="dark"]').click());

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  const pp = await phone.newPage();
  pp.on('pageerror', e => { errors.push(e.message); ok(false, 'page error (phone): ' + e.message); });
  await pp.goto(BASE); await pp.waitForSelector('#board .card');
  await pp.click('#menuBtn'); await wait(300);
  await pp.click('#navProjects [data-v="Shots"]'); await wait(300);
  const dims = await pp.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, track: (() => { const t = document.querySelector('.stage-track'); return { sw: t.scrollWidth, cw: t.clientWidth }; })() }));
  ok(dims.sw <= dims.iw, 'phone: no page-level horizontal scroll (' + dims.sw + ' <= ' + dims.iw + ', track ' + dims.track.sw + '/' + dims.track.cw + ')');
  // Hypercare on the phone: the track scrolls to the current stage
  await api('POST', '/api/projects/Shots/stage', { stage: 'hypercare' });
  await pp.reload(); await pp.waitForSelector('#board .card');
  await pp.click('#menuBtn'); await wait(300);
  await pp.click('#navProjects [data-v="Shots"]'); await wait(300);
  const vis = await pp.evaluate(() => { const c = document.querySelector('.stage-seg.cur').getBoundingClientRect(), t = document.querySelector('.stage-track').getBoundingClientRect(); return c.left >= t.left - 1 && c.right <= t.right + 1; });
  ok(vis, 'phone: the current stage is scrolled into view at Hypercare');
  ok(await pp.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'phone Hypercare: no page-level horizontal scroll');
  await phone.close();

  ok(errors.length === 0, 'no page errors (' + errors.join(' | ') + ')');

  // Compact layout: cards with an earlier-stage chip must still show their title.
  await test.step('compact layout keeps titles visible', async () => {
    for (const [name, vp] of [['desk', { width: 1300, height: 700 }], ['phone', { width: 390, height: 800 }]]) {
      const cctx = await browser.newContext({ viewport: vp, colorScheme: 'dark' });
      const p = await cctx.newPage();
      await p.addInitScript(() => { try { localStorage.setItem('tb-layout', 'compact'); } catch (_) {} });
      await p.goto(BASE);
      await p.waitForSelector('#board .card');
      if (name === 'phone') { await p.click('#menuBtn'); await p.waitForTimeout(300); }
      await p.locator('#navProjects [data-v="Shots"]').first().click();
      await p.waitForSelector('#stageBar:not([hidden])');
      // make sure compact is on
      const compactBtn = p.locator('[data-layout="compact"], button:has-text("Compact")').first();
      if (await compactBtn.count() && await compactBtn.isVisible()) await compactBtn.click();
      await p.waitForSelector('#board.compact .card');
      const widths = await p.$$eval('#board .card', cs => cs.map(c => ({ t: c.getAttribute('aria-label'), w: c.querySelector('.ct').getBoundingClientRect().width })));
      ok(true, name + ': cards with a stage chip: ' + widths.length);
      widths.forEach(x => ok(x.w >= 60, name + ': "' + x.t + '" title visible, width ' + Math.round(x.w)));
      await cctx.close();
    }
  });

  done();
});
