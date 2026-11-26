// lib/store-local.js in a throwaway temp folder.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createLocalStore } = require('../../lib/store-local');
const { sanitizeItem, sanitizeSnippet } = require('../../lib/model');

let dir, store;
const seed = { projects: ['Alpha'], projectColors: {}, items: [] };
const quietly = fn => { // "Created a fresh board" is logged on purpose; keep test output clean
  const orig = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = orig; }
};
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-local-'));
  store = quietly(() => createLocalStore({ dataDir: dir, seed }));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const leftovers = d => fs.readdirSync(d).filter(f => f.endsWith('.tmp'));

test('a fresh board is created from the seed', async () => {
  assert.ok(fs.existsSync(path.join(dir, 'board.json')));
  const b = await store.getBoard();
  assert.deepEqual(b.projects, ['Alpha']);
  assert.deepEqual(b.items, []);
  assert.ok(b.updatedAt);
});

test('an existing board is not overwritten', async () => {
  fs.writeFileSync(path.join(dir, 'board.json'), JSON.stringify({ projects: ['Mine'], items: [] }));
  const again = quietly(() => createLocalStore({ dataDir: dir, seed }));
  assert.deepEqual((await again.getBoard()).projects, ['Mine']);
});

test('mutateBoard changes are saved and returned', async () => {
  const item = sanitizeItem({ title: 'Hello', project: 'Alpha' }, null);
  const result = await store.mutateBoard(b => { b.items.push(item); return item.id; });
  assert.equal(result, item.id);
  const b = await store.getBoard();
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0].title, 'Hello');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'board.json'), 'utf8')).items.length, 1);
});

test('getArchive is empty without a file, and an unchanged mutateArchive creates none', async () => {
  const a = await store.getArchive();
  assert.deepEqual(a.items, []);
  assert.deepEqual(a.projects, []);
  assert.equal(fs.existsSync(path.join(dir, 'archive.json')), false);
  await store.mutateArchive(x => { x.items = x.items.filter(i => i.id === 'nope'); });
  assert.equal(fs.existsSync(path.join(dir, 'archive.json')), false);
});

test('a changed mutateArchive creates the file', async () => {
  const r = await store.mutateArchive(x => { x.items.push({ id: 'i-a-1', title: 'Old' }); return 'done'; });
  assert.equal(r, 'done');
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'archive.json'), 'utf8'));
  assert.equal(onDisk.items.length, 1);
  assert.ok(onDisk.updatedAt);
  assert.equal((await store.getArchive()).items[0].id, 'i-a-1');
  // changing nothing afterwards does not rewrite it
  const before = fs.readFileSync(path.join(dir, 'archive.json'), 'utf8');
  await store.mutateArchive(() => {});
  assert.equal(fs.readFileSync(path.join(dir, 'archive.json'), 'utf8'), before);
});

test('snippets: list, put, get, delete', async () => {
  assert.deepEqual(await store.listSnippets(), []);
  assert.equal(await store.getSnippet('nope'), null);
  const s = sanitizeSnippet({ id: 'my-snip', title: 'My snip', code: 'x = 1;', tags: 'a, b', projects: ['Alpha'] }, null);
  await store.putSnippet(s);
  assert.ok(fs.existsSync(path.join(dir, 'snippets', 'my-snip.md')));
  const got = await store.getSnippet('my-snip');
  assert.equal(got.snippet.title, 'My snip');
  assert.equal(got.snippet.code, 'x = 1;');
  assert.deepEqual(got.snippet.tags, ['a', 'b']);
  assert.deepEqual(got.snippet.projects, ['Alpha']);
  assert.deepEqual((await store.listSnippets()).map(x => x.id), ['my-snip']);
  assert.equal(await store.deleteSnippet('my-snip'), true);
  assert.equal(await store.deleteSnippet('my-snip'), false);
  assert.deepEqual(await store.listSnippets(), []);
});

test('atomic writes leave no .tmp file behind', async () => {
  await store.mutateBoard(b => { b.items.push(sanitizeItem({ title: 'x' }, null)); });
  await store.mutateArchive(x => { x.items.push({ id: 'i-a-1' }); });
  await store.putSnippet(sanitizeSnippet({ id: 's-1', title: 'S', code: 'c' }, null));
  assert.deepEqual(leftovers(dir), []);
  assert.deepEqual(leftovers(path.join(dir, 'snippets')), []);
});
