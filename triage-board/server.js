/**
 * Triage Board — local server.
 *
 * Serves the board UI and a tiny REST API backed by a single JSON file
 * (data/board.json). Every change the UI makes is written straight to that
 * file, so if you close the server and start it again your board is exactly
 * as you left it.
 *
 * No database, no cloud, no accounts. Your data never leaves your machine.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 4317;

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'board.json');
const SEED_FILE = path.join(DATA_DIR, 'seed.json');

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- persistence helpers ---------- */

// The shape of the whole board. Kept deliberately simple.
function emptyBoard() {
  return {
    // Projects the user is working on. These populate the "Project" dropdown
    // when creating a new item, and the project filter row.
    projects: ['Milltrans', 'Cradle Tech', 'RMI'],
    // Task items.
    items: [],
    // Bumped whenever we write, handy for debugging / future sync.
    updatedAt: null
  };
}

function ensureData() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    // Prefer a seed file if one ships with the repo; else start empty.
    let initial = emptyBoard();
    if (fs.existsSync(SEED_FILE)) {
      try { initial = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')); }
      catch (e) { console.warn('seed.json unreadable, starting empty:', e.message); }
    }
    writeBoard(initial);
    console.log('Created a fresh board at', DATA_FILE);
  }
}

function readBoard() {
  try {
    const b = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    // defensive defaults so an older/hand-edited file still loads
    if (!Array.isArray(b.projects)) b.projects = emptyBoard().projects;
    if (!Array.isArray(b.items)) b.items = [];
    return b;
  } catch (e) {
    console.error('Could not read board.json, returning empty board:', e.message);
    return emptyBoard();
  }
}

// Atomic write: write to a temp file then rename, so a crash mid-write
// can never leave you with a half-written, corrupt board.json.
function writeBoard(board) {
  board.updatedAt = new Date().toISOString();
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(board, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
  return board;
}

/* ---------- validation ---------- */

const PRIOS = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['open', 'doing', 'blocked', 'done'];

function newId() {
  return 'i-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function cleanStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max || 200);
}

// Coerce whatever the client sent into a valid item we're willing to store.
function sanitizeItem(raw, existing) {
  const it = existing ? { ...existing } : {
    id: newId(), createdAt: new Date().toISOString()
  };
  if ('title' in raw)   it.title   = cleanStr(raw.title, 200);
  if ('project' in raw) it.project = cleanStr(raw.project, 80);
  if ('group' in raw)   it.group   = cleanStr(raw.group, 80);
  if ('note' in raw)    it.note    = cleanStr(raw.note, 800);
  if ('prio' in raw)    it.prio    = PRIOS.includes(raw.prio) ? raw.prio : (it.prio || 'medium');
  if ('status' in raw)  it.status  = STATUSES.includes(raw.status) ? raw.status : (it.status || 'open');
  // fill defaults on create
  if (!it.prio)   it.prio = 'medium';
  if (!it.status) it.status = 'open';
  if (it.group == null)   it.group = '';
  if (it.note == null)    it.note = '';
  if (it.project == null) it.project = '';
  return it;
}

/* ---------- API ---------- */

// Whole board (projects + items).
app.get('/api/board', (req, res) => {
  res.json(readBoard());
});

// --- Projects ---
app.post('/api/projects', (req, res) => {
  const name = cleanStr(req.body && req.body.name, 80);
  if (!name) return res.status(400).json({ error: 'Project name required.' });
  const board = readBoard();
  if (board.projects.some(p => p.toLowerCase() === name.toLowerCase())) {
    return res.status(409).json({ error: 'That project already exists.' });
  }
  board.projects.push(name);
  writeBoard(board);
  res.json(board);
});

app.delete('/api/projects/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const board = readBoard();
  board.projects = board.projects.filter(p => p !== name);
  // Items keep their project label even if the project is removed from the list,
  // so nothing is silently lost. They just won't have a matching filter chip.
  writeBoard(board);
  res.json(board);
});

// --- Items ---
app.post('/api/items', (req, res) => {
  const body = req.body || {};
  if (!cleanStr(body.title, 200)) return res.status(400).json({ error: 'Title required.' });
  const board = readBoard();
  const item = sanitizeItem(body, null);
  board.items.push(item);
  writeBoard(board);
  res.json(item);
});

app.patch('/api/items/:id', (req, res) => {
  const board = readBoard();
  const idx = board.items.findIndex(i => i.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Item not found.' });
  board.items[idx] = sanitizeItem(req.body || {}, board.items[idx]);
  writeBoard(board);
  res.json(board.items[idx]);
});

app.delete('/api/items/:id', (req, res) => {
  const board = readBoard();
  const before = board.items.length;
  board.items = board.items.filter(i => i.id !== req.params.id);
  if (board.items.length === before) return res.status(404).json({ error: 'Item not found.' });
  writeBoard(board);
  res.json({ ok: true });
});

/* ---------- boot ---------- */

ensureData();
app.listen(PORT, () => {
  console.log('');
  console.log('  Triage Board is running.');
  console.log('  Open  ->  http://localhost:' + PORT);
  console.log('  Data  ->  ' + DATA_FILE);
  console.log('');
  console.log('  Leave this window open while you use the board.');
  console.log('  Press Ctrl+C here to stop the server.');
  console.log('');
});
