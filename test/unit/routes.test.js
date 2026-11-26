// API routes (server.js) over HTTP, against the real GitHub store on the in-memory fake of GitHub.
// Checks what ends up in board.json / archive.json and exactly which commits are made.
const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Local mode, no .env, a throwaway data dir: all set BEFORE server.js is required.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-routes-'));
Object.assign(process.env, {
  TRIAGE_NO_DOTENV: '1', GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '', DATA_DIR: dataDir
});
const app = require('../../server');
const { createFakeGithub } = require('../helpers/fake-github');
const { sanitizeItem, MAX_SNIPPET_LINKS } = require('../../lib/model');

let server, base, gh, store;
before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once('listening', r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
  await new Promise(r => server.close(r));
  fs.rmSync(dataDir, { recursive: true, force: true });
});
beforeEach(() => { gh = createFakeGithub(); gh.install(); });
afterEach(() => { gh.uninstall(); delete app.locals.storeOverride; });

function useStore(seed) {
  store = gh.store(seed);
  app.locals.storeOverride = store;
  return store;
}
async function api(method, url, body) {
  const r = await fetch(base + url, {
    method,
    headers: { 'X-Triage': '1', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const quietly = async fn => { // the server logs GitHub errors; keep the test output clean
  const orig = console.error;
  console.error = () => {};
  try { return await fn(); } finally { console.error = orig; }
};

const B = () => JSON.parse(gh.files['board.json']);
const A = () => (gh.files['archive.json'] ? JSON.parse(gh.files['archive.json']) : { items: [], projects: [] });
const ids = () => B().items.map(i => i.id);
const aids = () => A().items.map(i => i.id);
const mk = (id, t, extra) => sanitizeItem(Object.assign({ id, title: t, project: 'P' }, extra), null);

test('the API needs the X-Triage header', async () => {
  useStore({ projects: ['P'], items: [] });
  const r = await fetch(base + '/api/archive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(r.status, 403);
});

/* ---------- archive ---------- */

test('archive: reading, moving, restoring and closing', async () => {
  useStore({ projects: ['P'], items: [] });
  await store.mutateBoard(b => {
    b.items.push(mk('i-aaa-1111', 'One', { status: 'done', subtasks: [{ text: 'step' }] }), mk('i-aaa-2222', 'Two'), mk('i-aaa-3333', 'Three'));
    b.projectColors.P = 'teal';
  }, 'seed');
  assert.equal(gh.files['archive.json'], undefined);

  // 1. reading the archive does not create it
  let n = gh.log.length;
  const empty = await api('GET', '/api/archive');
  assert.deepEqual(empty.body.items, []);
  assert.equal(gh.files['archive.json'], undefined);
  assert.equal(gh.log.length, n);

  // 2. archive move: archive written first, then board; same message
  n = gh.log.length;
  assert.deepEqual((await api('POST', '/api/archive', { ids: ['i-aaa-1111'] })).body, { ok: true });
  assert.deepEqual(gh.log.slice(n), ['archive.json | Archive item: One', 'board.json | Archive item: One']);
  assert.ok(!ids().includes('i-aaa-1111') && aids().includes('i-aaa-1111'));
  const arch1 = A().items[0];
  assert.ok(arch1.archivedAt && arch1.doneAt && arch1.subtasks.length === 1 && arch1.createdAt, 'fields kept');

  // 3. repeat of the same archive request: nothing on the board -> no commits
  n = gh.log.length;
  assert.deepEqual((await api('POST', '/api/archive', { ids: ['i-aaa-1111'] })).body, { ok: true });
  assert.equal(gh.log.length, n);

  // 4. failure on the board write after the archive write: item in both; retry cleans up
  gh.failNextWrite('board.json');
  const failed = await quietly(() => api('POST', '/api/archive', { ids: ['i-aaa-2222'] }));
  assert.equal(failed.status, 502);
  assert.ok(ids().includes('i-aaa-2222') && aids().includes('i-aaa-2222'));
  n = gh.log.length;
  await api('POST', '/api/archive', { ids: ['i-aaa-2222'] });
  assert.ok(!ids().includes('i-aaa-2222'));
  assert.equal(aids().filter(i => i === 'i-aaa-2222').length, 1);
  assert.deepEqual(gh.log.slice(n), ['board.json | Archive item: Two']);

  // 5. lost reply on the archive write + retry: no duplicate, no empty commit
  n = gh.log.length;
  gh.dropNextReply('archive.json');
  await api('POST', '/api/archive', { ids: ['i-aaa-3333'] });
  assert.equal(aids().filter(i => i === 'i-aaa-3333').length, 1);
  assert.ok(!ids().includes('i-aaa-3333'));
  assert.deepEqual(gh.log.slice(n), ['archive.json | Archive item: Three', 'board.json | Archive item: Three']);

  // 6. close a project: record {name,color,closedAt} in the archive, project off the board
  await store.mutateBoard(b => {
    b.items.push(mk('i-bbb-1111', 'Closer', { project: 'Q' }));
    b.projects.push('Q');
    b.projectColors.Q = 'rose';
  }, 'seed Q');
  await api('POST', '/api/projects/Q/close');
  assert.ok(A().projects.find(p => p.name === 'Q' && p.color === 'rose' && p.closedAt));
  assert.ok(!B().projects.includes('Q'));
  assert.ok(!('Q' in B().projectColors));
  assert.ok(aids().includes('i-bbb-1111'));

  // 7. restore: board first, then archive; project + colour back, closed record removed
  n = gh.log.length;
  await api('POST', '/api/archive/restore', { ids: ['i-bbb-1111'] });
  assert.deepEqual(gh.log.slice(n), ['board.json | Restore item: Closer', 'archive.json | Restore item: Closer']);
  const bb = B();
  assert.ok(bb.projects.includes('Q') && bb.projectColors.Q === 'rose' && bb.items.some(i => i.id === 'i-bbb-1111' && !i.archivedAt));
  assert.ok(!A().projects.some(p => p.name === 'Q'));

  // 8. restore retry after success: archive no longer has it -> no commits
  n = gh.log.length;
  assert.deepEqual((await api('POST', '/api/archive/restore', { ids: ['i-bbb-1111'] })).body, { ok: true });
  assert.equal(gh.log.length, n);

  // 9. restore where the item is already on the board (interrupted before the archive cleanup): no dup
  const item2 = A().items.find(i => i.id === 'i-aaa-2222');
  await store.mutateBoard(b => { b.items.push(Object.assign({}, item2, { archivedAt: undefined })); }, 'put back');
  await api('POST', '/api/archive/restore', { ids: ['i-aaa-2222'] });
  assert.equal(ids().filter(i => i === 'i-aaa-2222').length, 1);
  assert.ok(!aids().includes('i-aaa-2222'));

  // bad ids
  assert.equal((await api('POST', '/api/archive', { ids: [] })).status, 400);
  assert.equal((await api('POST', '/api/archive', { ids: ['nope!'] })).status, 400);
});

/* ---------- stages ---------- */

test('stages: moves, repeats, failure recovery, close and reopen', async () => {
  useStore({ projects: ['P'], items: [] });
  await store.mutateBoard(x => {
    x.items.push(mk('i-aaa-1111', 'Done old', { status: 'done' }), mk('i-aaa-2222', 'Open old', { status: 'doing' }),
      mk('i-aaa-3333', 'Done own', { status: 'done', stage: 'implementation' }), mk('i-aaa-4444', 'Other', { project: 'Q', status: 'done' }));
    x.projects.push('Q');
  }, 'seed');
  const move = (name, stage) => api('POST', '/api/projects/' + encodeURIComponent(name) + '/stage', { stage });

  // invalid / missing
  const bad = await move('P', 'nope');
  assert.ok(bad.status === 400 && bad.body.error === 'Unknown stage.');
  const missing = await move('Z', 'golive');
  assert.ok(missing.status === 404 && missing.body.error === 'That project no longer exists.');

  // forward = exactly 2 commits, archive first, then ONE board write
  let n = gh.log.length;
  assert.deepEqual((await move('P', 'golive')).body, { ok: true });
  assert.deepEqual(gh.log.slice(n), ['archive.json | Move P to Go Live', 'board.json | Move P to Go Live']);
  const bd = B(), ar = A();
  assert.deepEqual(bd.items.map(i => i.id).sort(), ['i-aaa-2222', 'i-aaa-4444']);
  assert.equal(bd.items.find(i => i.id === 'i-aaa-2222').stage, 'implementation');
  assert.equal(bd.projectStages.P, 'golive');
  assert.deepEqual(ar.items.map(i => i.id).sort(), ['i-aaa-1111', 'i-aaa-3333']);
  assert.ok(ar.items.every(i => i.stage === 'implementation' && i.archivedAt));
  assert.ok(!bd.items.find(i => i.id === 'i-aaa-4444').stage, 'other project untouched');

  // repeated move = 0 commits
  n = gh.log.length;
  await move('P', 'golive');
  assert.equal(gh.log.length, n);

  // backward = 1 board commit, nothing archived
  await store.mutateBoard(x => { x.items.push(mk('i-aaa-5555', 'Done at golive', { status: 'done', stage: 'golive' })); }, 'seed2');
  n = gh.log.length;
  await move('P', 'implementation');
  assert.deepEqual(gh.log.slice(n), ['board.json | Move P back to Implementation']);
  assert.ok(B().items.some(i => i.id === 'i-aaa-5555'));
  assert.equal(B().projectStages.P, undefined);
  assert.equal(A().items.length, 2);
  n = gh.log.length;
  await move('P', 'implementation');
  assert.equal(gh.log.length, n);

  // failure on the board write after the archive write, then retry
  await store.mutateBoard(x => { x.items.push(mk('i-aaa-6666', 'Done late', { status: 'done' })); }, 'seed3');
  gh.failNextWrite('board.json');
  const failed = await quietly(() => move('P', 'acceptance'));
  assert.equal(failed.status, 502);
  assert.ok(B().items.some(i => i.id === 'i-aaa-6666') && A().items.some(i => i.id === 'i-aaa-6666'), 'in both after failure');
  assert.equal(B().projectStages.P, undefined, 'stage not set yet');
  n = gh.log.length;
  await move('P', 'acceptance');
  assert.deepEqual(gh.log.slice(n), ['board.json | Move P to Acceptance']);
  assert.ok(!B().items.some(i => i.id === 'i-aaa-6666') && A().items.filter(i => i.id === 'i-aaa-6666').length === 1);
  assert.equal(B().projectStages.P, 'acceptance');
  // jumping two stages archived the golive done item too
  assert.ok(!B().items.some(i => i.id === 'i-aaa-5555') && A().items.some(i => i.id === 'i-aaa-5555' && i.stage === 'golive'));

  // close stores the stage, reopen restores it
  await api('POST', '/api/projects/P/close');
  assert.equal(A().projects.find(p => p.name === 'P').stage, 'acceptance');
  assert.equal(B().projectStages.P, undefined);
  await api('POST', '/api/projects/P/reopen');
  assert.equal(B().projectStages.P, 'acceptance');
  assert.ok(!A().projects.some(p => p.name === 'P'));
});

/* ---------- quick add ---------- */

test('quick add: POST /api/items/batch', async () => {
  useStore({ projects: ['P'], projectStages: { P: 'golive' }, items: [] });
  await store.mutateBoard(x => { x.items.push(sanitizeItem({ id: 'i-seed-1', title: 'Seed', project: 'P' }, null)); }, 'seed');
  const mkBatch = k => Array.from({ length: k }, (_, i) => ({ id: 'i-bt-' + i, title: 'Task number ' + (i + 1), project: i % 2 ? 'P' : '', prio: 'high', status: 'open', subtasks: [{ id: 's-' + i, text: 'step ' + i }] }));
  const batch = items => api('POST', '/api/items/batch', { items });

  // batch of 8 = exactly 1 commit, truncated message, stage from the project
  let n = gh.log.length;
  assert.deepEqual((await batch(mkBatch(8))).body, { ok: true, added: 8 });
  assert.equal(gh.log.length - n, 1, 'exactly one commit');
  const msg = gh.log[gh.log.length - 1].split(' | ')[1];
  assert.ok(msg.startsWith('Add 8 items: Task number 1, Task number 2'), msg);
  assert.ok(msg.length <= 72 && msg.endsWith('…'), 'truncated: ' + msg + ' (' + msg.length + ')');
  assert.equal(B().items.length, 9);
  assert.equal(B().items.find(i => i.id === 'i-bt-1').stage, 'golive');
  assert.equal(B().items.find(i => i.id === 'i-bt-0').stage, undefined);

  // repeated batch = 0 commits
  n = gh.log.length;
  assert.deepEqual((await batch(mkBatch(8))).body, { ok: true, added: 0 });
  assert.equal(gh.log.length, n, 'no commit');

  // short messages are not truncated; a single item uses "Add item:"
  n = gh.log.length;
  await batch([{ id: 'i-one-1', title: 'Solo' }]);
  assert.equal(gh.log[gh.log.length - 1], 'board.json | Add item: Solo');
  await batch([{ id: 'i-two-1', title: 'A' }, { id: 'i-two-2', title: 'B' }]);
  assert.equal(gh.log[gh.log.length - 1], 'board.json | Add 2 items: A, B');
  assert.equal(gh.log.length - n, 2);

  // partial overlap (and a duplicate id inside the batch): only new items, 1 commit
  n = gh.log.length;
  const r3 = await batch([{ id: 'i-two-2', title: 'B' }, { id: 'i-new-1', title: 'C' }, { id: 'i-new-1', title: 'C again' }]);
  assert.deepEqual(r3.body, { ok: true, added: 1 });
  assert.equal(gh.log.length - n, 1);
  assert.equal(B().items.filter(i => i.id === 'i-new-1').length, 1);
  assert.equal(gh.log[gh.log.length - 1], 'board.json | Add item: C');

  // lost reply: the write lands but the response is lost, the browser retries the same body
  const count0 = B().items.length;
  const lost = Array.from({ length: 5 }, (_, i) => ({ id: 'i-lost-' + i, title: 'Lost ' + i, prio: 'low' }));
  await batch(lost); // reply "lost": ignore it
  n = gh.log.length;
  assert.deepEqual((await batch(lost)).body, { ok: true, added: 0 });
  assert.equal(gh.log.length, n);
  assert.equal(B().items.length, count0 + 5);
  assert.equal(B().items.filter(i => /^Lost/.test(i.title)).length, 5);

  // validation
  const tooMany = Array.from({ length: 101 }, (_, i) => ({ id: 'i-x-' + i, title: 't' }));
  for (const bad of [[], null, tooMany, [{ id: 'i-ok-1', title: ' ' }], [{ title: 'no id' }], [{ id: 'nope!', title: 'x' }]]) {
    assert.equal((await batch(bad)).status, 400);
  }
});

/* ---------- snippet links ---------- */

test('snippet links: link, unlink, limits and 404s', async () => {
  useStore({ projects: ['P'], items: [] });
  await store.mutateBoard(x => {
    x.items.push(sanitizeItem({ id: 'i-one-1', title: 'Fix sync', project: 'P' }, null));
    x.items.push(sanitizeItem({ id: 'i-two-1', title: 'Other' }, null));
  }, 'seed');
  for (const [id, title] of [['sn-a', 'Books invoice'], ['sn-b', 'Webhook']]) {
    assert.equal((await api('POST', '/api/snippets', { id, title, code: 'x = 1;', tags: 'a' })).status, 200);
  }
  const link = (id, snippetId) => api('POST', '/api/items/' + id + '/snippets', { snippetId });
  const unlink = (id, sid) => api('DELETE', '/api/items/' + id + '/snippets/' + sid);

  let n = gh.log.length;
  const r = await link('i-one-1', 'sn-a');
  assert.deepEqual(r.body.snippets, ['sn-a']);
  assert.equal(gh.log.length - n, 1, 'one commit');
  assert.equal(gh.log[gh.log.length - 1], 'board.json | Link snippet: Books invoice → Fix sync');
  assert.deepEqual(B().items[0].snippets, ['sn-a']);

  n = gh.log.length;
  const r2 = await link('i-one-1', 'sn-a');
  assert.deepEqual(r2.body.snippets, ['sn-a']);
  assert.equal(gh.log.length, n, 'no commit');

  n = gh.log.length;
  await link('i-one-1', 'sn-b');
  assert.equal(gh.log.length - n, 1);
  assert.deepEqual(B().items[0].snippets, ['sn-a', 'sn-b']);

  n = gh.log.length;
  const e1 = await link('i-one-1', 'sn-missing');
  assert.ok(e1.status === 404 && e1.body.error === 'Snippet not found.');
  const e2 = await link('i-none-1', 'sn-a');
  assert.ok(e2.status === 404 && e2.body.error === 'Item not found.');
  assert.equal((await link('i-one-1', 'Bad Id')).status, 400);
  assert.equal(gh.log.length, n, 'no commits');

  n = gh.log.length;
  await unlink('i-one-1', 'sn-a');
  assert.equal(gh.log.length - n, 1);
  assert.equal(gh.log[gh.log.length - 1], 'board.json | Unlink snippet: Books invoice → Fix sync');
  assert.deepEqual(B().items[0].snippets, ['sn-b']);

  n = gh.log.length;
  assert.equal((await unlink('i-one-1', 'sn-a')).status, 200);
  assert.equal((await unlink('i-none-1', 'sn-a')).status, 200);
  assert.equal(gh.log.length, n);

  // the snippet is gone (deleted elsewhere): unlinking still works, message falls back to the id
  delete gh.files['snippets/sn-b.md'];
  n = gh.log.length;
  await unlink('i-one-1', 'sn-b');
  assert.equal(gh.log.length - n, 1);
  assert.equal(gh.log[gh.log.length - 1], 'board.json | Unlink snippet: sn-b → Fix sync');
  assert.ok(!('snippets' in B().items[0]), 'empty array removed');

  // limit
  for (let i = 0; i < MAX_SNIPPET_LINKS; i++) {
    await api('POST', '/api/snippets', { id: 'lim-' + i, title: 'L' + i, code: 'c' });
    assert.equal((await link('i-two-1', 'lim-' + i)).status, 200);
  }
  await api('POST', '/api/snippets', { id: 'lim-x', title: 'LX', code: 'c' });
  n = gh.log.length;
  const e4 = await link('i-two-1', 'lim-x');
  assert.ok(e4.status === 400 && /20/.test(e4.body.error));
  assert.equal(gh.log.length, n);

  // snippet deletion does not touch board.json
  const before = gh.files['board.json'];
  assert.equal((await api('DELETE', '/api/snippets/lim-3')).status, 200);
  assert.equal(gh.files['snippets/lim-3.md'], undefined);
  assert.equal(gh.files['board.json'], before);
});
