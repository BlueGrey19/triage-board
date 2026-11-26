// lib/store-github.js against the in-memory fake of GitHub (lost replies, conflicts, archive writes).
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { createFakeGithub } = require('../helpers/fake-github');
const { sanitizeItem, sanitizeSnippet } = require('../../lib/model');

let gh, store;
beforeEach(() => { gh = createFakeGithub(); gh.install(); store = gh.store({ projects: [], items: [] }); });
afterEach(() => gh.uninstall());

const mk = (id, title, extra) => sanitizeItem(Object.assign({ id, title, project: 'P' }, extra), null);
const board = () => JSON.parse(gh.files['board.json']);
const archive = () => JSON.parse(gh.files['archive.json']);

test('lost replies: items are saved once and no-ops make no commit', async () => {
  await store.mutateBoard(b => { b.items.push(sanitizeItem({ title: 'seed' }, null)); }, 'seed');
  const before = gh.log.length;

  // Add item: write lands, reply lost -> retry -> conflict -> re-read -> already there
  const item = sanitizeItem({ id: 'i-abc123-wxyz', title: 'Lost reply item' }, null);
  gh.dropNextReply();
  await store.mutateBoard(b => { if (!b.items.find(i => i.id === item.id)) b.items.push(item); }, 'Add item');
  assert.equal(board().items.filter(i => i.id === item.id).length, 1);
  assert.equal(gh.log.length - before, 1);

  // Status change: same thing
  gh.dropNextReply();
  await store.mutateBoard(b => { b.items.find(i => i.id === item.id).status = 'testing'; }, 'Update item');
  assert.equal(board().items.find(i => i.id === item.id).status, 'testing');
  assert.equal(gh.log.length - before, 2);

  // A change that changes nothing makes no commit
  await store.mutateBoard(b => { b.items.find(i => i.id === item.id).status = 'testing'; }, 'Update item');
  assert.equal(gh.log.length - before, 2);
});

test('snippets: lost reply is not a false conflict, a real conflict is reported', async () => {
  const s = sanitizeSnippet({ id: 'my-snip-ab12', title: 'My snip', code: 'info 1;' }, null);
  gh.dropNextReply();
  await store.putSnippet(s, null, 'Add snippet');
  assert.ok(gh.files['snippets/my-snip-ab12.md'].includes('info 1;'));

  const found = await store.getSnippet('my-snip-ab12');
  gh.files['snippets/my-snip-ab12.md'] += '\n'; // someone else edited it
  await assert.rejects(store.putSnippet({ ...s, code: 'info 2;' }, found.version, 'Update'), e => e.status === 409);
});

test('snippets: list (GraphQL), get, delete', async () => {
  assert.deepEqual(await store.listSnippets(), []);
  assert.equal(await store.getSnippet('nope'), null);
  await store.putSnippet(sanitizeSnippet({ id: 'a-1', title: 'A', code: 'x' }, null), null, 'Add A');
  await store.putSnippet(sanitizeSnippet({ id: 'b-1', title: 'B', code: 'y' }, null), null, 'Add B');
  assert.deepEqual((await store.listSnippets()).map(s => s.id).sort(), ['a-1', 'b-1']);
  assert.equal(await store.deleteSnippet('a-1', 'Delete A'), true);
  assert.equal(await store.deleteSnippet('a-1', 'Delete A'), false);
  assert.deepEqual((await store.listSnippets()).map(s => s.id), ['b-1']);
  assert.ok(gh.log.includes('snippets/a-1.md | Delete A'));
});

test('a fresh board seeds itself on the first write', async () => {
  const s = gh.store({ projects: ['P'], items: [] });
  assert.deepEqual((await s.getBoard()).projects, ['P']);
  assert.equal(gh.files['board.json'], undefined);
  await s.mutateBoard(() => {}, 'first');
  assert.deepEqual(board().projects, ['P']);
});

test('archive.json only comes into being once something changes (0 commits before)', async () => {
  await store.mutateBoard(b => { b.items.push(mk('i-aaa-1111', 'One')); }, 'seed');
  assert.equal(gh.files['archive.json'], undefined);
  const n = gh.log.length;
  assert.deepEqual((await store.getArchive()).items, []);
  await store.mutateArchive(x => { x.items = x.items.filter(i => i.id === 'nope'); }, 'noop');
  assert.equal(gh.files['archive.json'], undefined);
  assert.equal(gh.log.length, n);
  await store.mutateArchive(a => { a.items.push({ id: 'i-x-1' }); }, 'add');
  assert.equal(archive().items.length, 1);
});

test('mutateArchive returns the fn result; the message can be a function', async () => {
  await store.mutateArchive(a => { a.items.push(mk('i-aaa-1111', 'One')); }, 'add');
  const m = await store.mutateArchive(x => x.items.length, t => 'count ' + t);
  assert.equal(m, 1);
});

test('a failed write is thrown and nothing changes', async () => {
  await store.mutateBoard(b => { b.items.push(mk('i-aaa-1111', 'One')); }, 'seed');
  gh.failNextWrite('board.json');
  await assert.rejects(store.mutateBoard(b => { b.items = []; }, 'x'), e => e.status === 500);
  assert.equal(board().items.length, 1);
});

test('a dropped connection is retried inside the request', async () => {
  gh.failNextRequests(1);
  await store.mutateBoard(b => { b.items.push(mk('i-aaa-1111', 'One')); }, 'seed');
  assert.equal(board().items.length, 1);
  assert.equal(gh.log.length, 1);
});
