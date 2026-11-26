// lib/model.js: validation, normalising and the snippet file format.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const m = require('../../lib/model');

const {
  sanitizeItem, sanitizeSubtask, normalizeBoard, normalizeArchive, STAGES, STAGE_KEYS, projectStage, effectiveStage,
  sanitizeSnippet, serializeSnippet, parseSnippet, MAX_SUBTASKS, MAX_SNIPPET_LINKS
} = m;

/* ---------- sanitizeItem ---------- */

test('sanitizeItem: create fills in defaults and a valid id', () => {
  const it = sanitizeItem({ title: '  Hello  ' }, null);
  assert.equal(it.title, 'Hello');
  assert.match(it.id, m.ITEM_ID_RE);
  assert.ok(it.createdAt);
  assert.equal(it.prio, 'medium');
  assert.equal(it.status, 'open');
  assert.equal(it.project, '');
  assert.equal(it.group, '');
  assert.equal(it.note, '');
});

test('sanitizeItem: a good client id is kept, a bad one replaced', () => {
  assert.equal(sanitizeItem({ id: 'i-abc-123', title: 't' }, null).id, 'i-abc-123');
  const bad = sanitizeItem({ id: 'nope!', title: 't' }, null);
  assert.notEqual(bad.id, 'nope!');
  assert.match(bad.id, m.ITEM_ID_RE);
});

test('sanitizeItem: update keeps id/createdAt and only touches given fields', () => {
  const it = sanitizeItem({ title: 'A', prio: 'high', note: 'n' }, null);
  const up = sanitizeItem({ id: 'i-other-1', title: 'B' }, it);
  assert.equal(up.id, it.id);
  assert.equal(up.createdAt, it.createdAt);
  assert.equal(up.title, 'B');
  assert.equal(up.prio, 'high');
  assert.equal(up.note, 'n');
});

test('sanitizeItem: unknown prio/status fall back to the current value or default', () => {
  assert.equal(sanitizeItem({ title: 't', prio: 'urgent', status: 'weird' }, null).prio, 'medium');
  assert.equal(sanitizeItem({ title: 't', prio: 'urgent', status: 'weird' }, null).status, 'open');
  const it = sanitizeItem({ title: 't', prio: 'low', status: 'doing' }, null);
  const up = sanitizeItem({ prio: 'urgent', status: 'weird' }, it);
  assert.equal(up.prio, 'low');
  assert.equal(up.status, 'doing');
});

test('sanitizeItem: doneAt is set on the way into done, kept while done, dropped on the way out', () => {
  const created = sanitizeItem({ title: 't', status: 'done' }, null);
  assert.ok(created.doneAt);
  const open = sanitizeItem({ title: 't' }, null);
  assert.ok(!('doneAt' in open));
  const done = sanitizeItem({ status: 'done' }, open);
  assert.ok(done.doneAt);
  const stamp = '2020-01-01T00:00:00.000Z';
  const again = sanitizeItem({ status: 'done', note: 'x' }, { ...done, doneAt: stamp });
  assert.equal(again.doneAt, stamp);
  const back = sanitizeItem({ status: 'doing' }, done);
  assert.ok(!('doneAt' in back));
});

test('sanitizeItem: stage only with a project, only valid keys, and can be cleared', () => {
  assert.equal(sanitizeItem({ title: 't', project: 'P', stage: 'golive' }, null).stage, 'golive');
  assert.ok(!('stage' in sanitizeItem({ title: 't', project: 'P', stage: 'nope' }, null)));
  assert.ok(!('stage' in sanitizeItem({ title: 't', stage: 'golive' }, null)), 'no project, no stage');
  const it = sanitizeItem({ title: 't', project: 'P', stage: 'golive' }, null);
  assert.ok(!('stage' in sanitizeItem({ stage: '' }, it)));
  assert.ok(!('stage' in sanitizeItem({ project: '' }, it)), 'dropping the project drops the stage');
  assert.equal(sanitizeItem({ note: 'x' }, it).stage, 'golive');
});

test('sanitizeItem: limits', () => {
  const it = sanitizeItem({ title: 'x'.repeat(500), project: 'p'.repeat(200), group: 'g'.repeat(200), note: 'n'.repeat(2000) }, null);
  assert.equal(it.title.length, 200);
  assert.equal(it.project.length, 80);
  assert.equal(it.group.length, 80);
  assert.equal(it.note.length, 800);
  assert.equal(sanitizeItem({ title: 'a\nb\r\nc' }, null).title, 'a b c');
  assert.equal(sanitizeItem({ title: 123 }, null).title, '');
});

test('sanitizeItem: subtasks come with a new item only', () => {
  const it = sanitizeItem({ title: 't', subtasks: [{ text: 'one' }, { id: 's-a-1', text: 'two', done: true }, { text: ' ' }] }, null);
  assert.equal(it.subtasks.length, 2);
  assert.equal(it.subtasks[0].done, false);
  assert.equal(it.subtasks[1].id, 's-a-1');
  assert.equal(it.subtasks[1].done, true);
  const up = sanitizeItem({ subtasks: [{ text: 'sneaky' }] }, it);
  assert.deepEqual(up.subtasks, it.subtasks);
  assert.ok(!('subtasks' in sanitizeItem({ title: 't', subtasks: [] }, null)));
});

test('sanitizeItem: subtasks skip duplicate ids and cap at the limit', () => {
  const dup = sanitizeItem({ title: 't', subtasks: [{ id: 's-a-1', text: 'x' }, { id: 's-a-1', text: 'y' }] }, null);
  assert.equal(dup.subtasks.length, 1);
  const many = sanitizeItem({ title: 't', subtasks: Array.from({ length: 80 }, (_, i) => ({ text: 'step ' + i })) }, null);
  assert.equal(many.subtasks.length, MAX_SUBTASKS);
});

test('sanitizeItem: snippet links come with a new item only', () => {
  const ci = sanitizeItem({ id: 'i-new-1', title: 't', snippets: ['sn-a', 'sn-a', 'BAD!', 'sn-b'] }, null);
  assert.deepEqual(ci.snippets, ['sn-a', 'sn-b']);
  assert.ok(!('snippets' in sanitizeItem({ id: 'i-new-2', title: 't', snippets: [] }, null)));
  assert.deepEqual(sanitizeItem({ snippets: ['zz'] }, ci).snippets, ['sn-a', 'sn-b']);
  const lots = sanitizeItem({ title: 't', snippets: Array.from({ length: 40 }, (_, i) => 'sn-' + i) }, null);
  assert.equal(lots.snippets.length, MAX_SNIPPET_LINKS);
});

test('sanitizeSubtask: create, update, limits', () => {
  const st = sanitizeSubtask({ text: 'a\nb' }, null);
  assert.match(st.id, m.SUBTASK_ID_RE);
  assert.equal(st.text, 'a b');
  assert.equal(st.done, false);
  assert.equal(sanitizeSubtask({ id: 's-ok-1', text: 'x' }, null).id, 's-ok-1');
  assert.notEqual(sanitizeSubtask({ id: 'bad', text: 'x' }, null).id, 'bad');
  const up = sanitizeSubtask({ done: 1, id: 's-zz-9' }, st);
  assert.equal(up.id, st.id);
  assert.equal(up.text, 'a b');
  assert.equal(up.done, true);
  assert.equal(sanitizeSubtask({ text: 'x'.repeat(500) }, null).text.length, 200);
  assert.equal(sanitizeSubtask(null, null).text, '');
});

/* ---------- board / archive ---------- */

test('normalizeBoard: defaults for junk and missing fields', () => {
  const b = normalizeBoard(null);
  assert.deepEqual(b.projects, []);
  assert.deepEqual(b.items, []);
  assert.deepEqual(b.projectColors, {});
  assert.deepEqual(b.projectStages, {});
  assert.deepEqual(normalizeBoard({ projects: 'x', items: 5 }).projects, []);
});

test('normalizeBoard: colours and stages are kept only for existing projects with valid values', () => {
  const b = normalizeBoard({
    projects: ['A', 'B'],
    projectColors: { A: 'teal', B: 'neon', Gone: 'rose' },
    projectStages: { A: 'golive', B: 'nope', Gone: 'hypercare' },
    items: []
  });
  assert.deepEqual(b.projectColors, { A: 'teal' });
  assert.deepEqual(b.projectStages, { A: 'golive' });
});

test('normalizeBoard: an old board loads unchanged', () => {
  const old = { projects: ['A'], items: [{ id: 'i-a-1', title: 't' }], updatedAt: 'x' };
  const b = normalizeBoard(JSON.parse(JSON.stringify(old)));
  assert.deepEqual(b.projects, old.projects);
  assert.deepEqual(b.items, old.items);
  assert.equal(b.updatedAt, 'x');
  assert.deepEqual(b.projectColors, {});
  assert.deepEqual(b.projectStages, {});
});

test('normalizeArchive: items deduped, projects cleaned, junk ignored', () => {
  const a = normalizeArchive({
    items: [{ id: 'i-a-1' }, { id: 'i-a-1' }, { id: 5 }, null, { id: 'i-b-2' }],
    projects: [
      { name: 'P', color: 'rose', closedAt: 'then', stage: 'golive' },
      { name: 'P' },
      { name: '' },
      { name: 'Q', color: 'neon', stage: 'nope' },
      null
    ],
    updatedAt: 'now'
  });
  assert.deepEqual(a.items.map(i => i.id), ['i-a-1', 'i-b-2']);
  assert.deepEqual(a.projects, [
    { name: 'P', color: 'rose', closedAt: 'then', stage: 'golive' },
    { name: 'Q', color: '', closedAt: '' }
  ]);
  assert.equal(a.updatedAt, 'now');
  assert.deepEqual(normalizeArchive(null), { items: [], projects: [], updatedAt: null });
  assert.deepEqual(normalizeArchive('x').items, []);
});

/* ---------- stages ---------- */

test('STAGES / projectStage / effectiveStage', () => {
  assert.deepEqual(STAGE_KEYS, ['implementation', 'golive', 'acceptance', 'hypercare']);
  assert.equal(STAGES.length, 4);
  assert.ok(STAGES.every(s => s.name && s.acts.length));
  const board = { projectStages: { P: 'golive', Bad: 'nope' } };
  assert.equal(projectStage(board, 'P'), 'golive');
  assert.equal(projectStage(board, 'Other'), 'implementation');
  assert.equal(projectStage(board, 'Bad'), 'implementation');
  assert.equal(projectStage({}, 'P'), 'implementation');
  assert.equal(effectiveStage(board, { project: 'P' }), 'golive');
  assert.equal(effectiveStage(board, { project: 'P', stage: 'hypercare' }), 'hypercare');
  assert.equal(effectiveStage(board, { project: 'P', stage: 'nope' }), 'golive');
  assert.equal(effectiveStage(board, { project: '' }), '');
  assert.equal(effectiveStage(board, { stage: 'golive' }), '');
});

/* ---------- snippets ---------- */

test('sanitizeSnippet: create, update, limits', () => {
  const s = sanitizeSnippet({ title: ' My Snip ', code: 'a\r\nb  \n\n', tags: 'X, y' }, null);
  assert.equal(s.title, 'My Snip');
  assert.match(s.id, /^my-snip-[a-z0-9]+$/);
  assert.equal(s.code, 'a\nb');
  assert.equal(s.language, 'deluge');
  assert.deepEqual(s.tags, ['x', 'y']);
  assert.deepEqual(s.projects, []);
  assert.equal(sanitizeSnippet({ id: 'my-id', title: 't' }, null).id, 'my-id');
  assert.notEqual(sanitizeSnippet({ id: 'Bad Id', title: 't' }, null).id, 'Bad Id');
  const up = sanitizeSnippet({ id: 'other', title: 'New', language: 'nope' }, s);
  assert.equal(up.id, s.id);
  assert.equal(up.title, 'New');
  assert.equal(up.language, 'deluge');
  assert.equal(up.code, 'a\nb');
  assert.equal(sanitizeSnippet({ title: 't'.repeat(300) }, null).title.length, 120);
});

test('tags and projects: commas split, duplicates dropped, capped', () => {
  assert.deepEqual(sanitizeSnippet({ tags: 'A, a ,B,,c' }, null).tags, ['a', 'b', 'c']);
  assert.deepEqual(sanitizeSnippet({ tags: ['One', 'one', 'Two'] }, null).tags, ['one', 'two']);
  assert.equal(sanitizeSnippet({ tags: Array.from({ length: 30 }, (_, i) => 't' + i) }, null).tags.length, 20);
  assert.equal(sanitizeSnippet({ tags: ['x'.repeat(50)] }, null).tags[0].length, 30);
  assert.deepEqual(sanitizeSnippet({ projects: ['Alpha', 'Be,ta', 'alpha', '', 5] }, null).projects, ['Alpha', 'Beta']);
  assert.equal(sanitizeSnippet({ projects: Array.from({ length: 30 }, (_, i) => 'P' + i) }, null).projects.length, 20);
});

test('snippet with projects round-trips (commas stripped, duplicates dropped)', () => {
  const s = sanitizeSnippet({ id: 'p-1', title: 'With projects', code: 'x', projects: ['Alpha', 'Be,ta', 'alpha', ''] }, null);
  assert.deepEqual(s.projects, ['Alpha', 'Beta']);
  const text = serializeSnippet(s);
  assert.match(text, /^projects: Alpha, Beta$/m);
  const back = parseSnippet('p-1', text);
  assert.deepEqual(back.projects, ['Alpha', 'Beta']);
  assert.equal(back.title, 'With projects');
  assert.equal(back.code, 'x');
});

test('no projects line when empty', () => {
  assert.equal(serializeSnippet(sanitizeSnippet({ id: 'p-2', title: 't', code: 'x' }, null)).includes('projects:'), false);
});

test('old snippet file parses with projects [] and re-serializes byte for byte', () => {
  const old = '---\ntitle: Old\nlanguage: javascript\ntags: a, b\ncreated: 2025-01-01T00:00:00.000Z\nupdated: 2025-01-01T00:00:00.000Z\n---\n\nDesc\n\n```javascript\nlet a = 1;\n```\n';
  const po = parseSnippet('old', old);
  assert.deepEqual(po.projects, []);
  assert.deepEqual(po.tags, ['a', 'b']);
  assert.equal(po.code, 'let a = 1;');
  assert.equal(po.description, 'Desc');
  assert.equal(serializeSnippet({ ...po, updated: '2025-01-01T00:00:00.000Z' }), old);
  // an update on an old snippet keeps it without the line
  assert.deepEqual(sanitizeSnippet({ title: 'Old 2' }, po).projects, []);
});

test('snippet round-trip: type, description, code with backtick fences', () => {
  const s = sanitizeSnippet({ id: 'rt-1', title: 'Round trip', type: 'Webhook', description: 'Why it exists', code: 'a\n```\nb', language: 'json', tags: 'x' }, null);
  const back = parseSnippet('rt-1', serializeSnippet(s));
  assert.equal(back.title, 'Round trip');
  assert.equal(back.type, 'Webhook');
  assert.equal(back.description, 'Why it exists');
  assert.equal(back.code, 'a\n```\nb');
  assert.equal(back.language, 'json');
  assert.deepEqual(back.tags, ['x']);
});

test('parseSnippet: plain text without front matter or fence', () => {
  const p = parseSnippet('raw', 'just some text');
  assert.equal(p.title, 'raw');
  assert.equal(p.language, 'plaintext');
  assert.equal(p.code, 'just some text');
  assert.equal(p.description, '');
});
