/**
 * Triage Board — server.
 *
 * Serves the UI and a small REST API for the triage board and the snippet
 * library. Storage depends on configuration:
 *
 *   Local mode (default)   no login; data lives in data/board.json and
 *                          data/snippets/*.md on this machine.
 *   GitHub mode            "Sign in with GitHub" via a GitHub App; each user's
 *                          data lives in their own private repo
 *                          (board.json + snippets/*.md), versioned by git.
 *
 * GitHub mode switches on when GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET are
 * set (in .env or the environment). See README.md for setup.
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const express = require('express');

require('./lib/env').loadEnv(path.join(__dirname, '.env'));

const {
  HttpError, SNIPPET_ID_RE, ITEM_ID_RE, SUBTASK_ID_RE, MAX_SUBTASKS, sanitizeSubtask, normalizeBoard, cleanProjectColor, oneLine, sanitizeItem, sanitizeSnippet
} = require('./lib/model');
const { GitHubError, request, authorizeUrl, exchangeCode, refreshToken } = require('./lib/github');
const { parseCookies, serializeCookie, createSealer } = require('./lib/session');
const { createLocalStore } = require('./lib/store-local');
const { createGithubStore } = require('./lib/store-github');

/* ---------- config ---------- */

const PORT = Number(process.env.PORT) || 4317;
const BASE_URL = (process.env.BASE_URL || 'http://localhost:' + PORT).replace(/\/+$/, '');
const CLIENT_ID = process.env.GITHUB_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET || '';
const APP_SLUG = process.env.GITHUB_APP_SLUG || '';
const DATA_REPO = process.env.DATA_REPO || 'triage-data';
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const ALLOWED_USERS = (process.env.ALLOWED_USERS || '')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const MODE = CLIENT_ID && CLIENT_SECRET ? 'github' : 'local';
const SECURE_COOKIES = BASE_URL.startsWith('https://');
const REDIRECT_URI = BASE_URL + '/auth/callback';
const SESSION_COOKIE = 'tb_session';
const STATE_COOKIE = 'tb_oauth_state';

if (MODE === 'github' && SESSION_SECRET.length < 32) {
  console.error('\n  SESSION_SECRET must be set (32+ random characters) when GitHub login is enabled.');
  console.error('  Generate one with:  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"\n');
  process.exit(1);
}

const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const SEED = (() => {
  try { return normalizeBoard(JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'seed.json'), 'utf8'))); }
  catch (_) { return normalizeBoard(null); }
})();

const localStore = MODE === 'local' ? createLocalStore({ dataDir: DATA_DIR, seed: SEED }) : null;
const sealer = MODE === 'github' ? createSealer(SESSION_SECRET) : null;

/* ---------- app ---------- */

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Wrap async handlers so rejections reach the error handler (Express 4).
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- sessions (GitHub mode) ---------- */

function setSession(res, s) {
  res.append('Set-Cookie', serializeCookie(SESSION_COOKIE, sealer.seal(s), {
    maxAge: 60 * 60 * 24 * 30, secure: SECURE_COOKIES
  }));
}
function clearSession(res) {
  res.append('Set-Cookie', serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: SECURE_COOKIES }));
}

// Refresh tokens are single-use. If the page fires several requests right as
// the access token expires, share one refresh between them.
const refreshing = new Map();
function refreshOnce(rt) {
  if (!refreshing.has(rt)) {
    const p = refreshToken({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, refreshToken: rt });
    refreshing.set(rt, p);
    p.catch(() => {}).finally(() => setTimeout(() => refreshing.delete(rt), 60000));
  }
  return refreshing.get(rt);
}

async function getSession(req, res) {
  if (req.session !== undefined) return req.session;
  let s = sealer.unseal(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  if (s && s.e && s.e < Date.now() + 60000) {
    try {
      if (!s.r) throw new Error('no refresh token');
      const t = await refreshOnce(s.r);
      s = { ...s, t: t.accessToken, r: t.refreshToken || s.r, e: t.expiresAt };
      setSession(res, s);
    } catch (e) {
      // GitHub unreachable: keep the session and let the caller try again,
      // rather than signing the user out over a network blip.
      if (e && e.network) throw e;
      s = null;
      clearSession(res);
    }
  }
  req.session = s;
  return s;
}

/* ---------- auth routes ---------- */

app.get('/auth/login', (req, res) => {
  if (MODE !== 'github') return res.redirect('/');
  const state = crypto.randomBytes(16).toString('hex');
  res.append('Set-Cookie', serializeCookie(STATE_COOKIE, state, { maxAge: 600, secure: SECURE_COOKIES }));
  res.redirect(authorizeUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI, state }));
});

app.get('/auth/callback', h(async (req, res) => {
  if (MODE !== 'github') return res.redirect('/');
  const { code, state, error } = req.query;
  const expected = parseCookies(req.headers.cookie)[STATE_COOKIE];
  res.append('Set-Cookie', serializeCookie(STATE_COOKIE, '', { maxAge: 0, secure: SECURE_COOKIES }));
  if (error) return res.redirect('/');
  if (!code || !state || state !== expected) {
    return res.status(400).send(authErrorPage('The login link expired or was tampered with.'));
  }
  try {
    const t = await exchangeCode({ clientId: CLIENT_ID, clientSecret: CLIENT_SECRET, code: String(code), redirectUri: REDIRECT_URI });
    const user = await request(t.accessToken, 'GET', '/user');
    if (ALLOWED_USERS.length && !ALLOWED_USERS.includes(String(user.login).toLowerCase())) {
      return res.status(403).send(authErrorPage('This board is private. @' + user.login + ' is not on the allowed list.'));
    }
    setSession(res, { login: user.login, a: user.avatar_url, t: t.accessToken, r: t.refreshToken, e: t.expiresAt });
    res.redirect('/');
  } catch (e) {
    console.error('Login failed:', e.message);
    res.status(400).send(authErrorPage('GitHub did not accept the login (' + e.message + ').'));
  }
}));

app.post('/auth/logout', (req, res) => {
  if (MODE === 'github') clearSession(res);
  res.redirect('/');
});

function authErrorPage(msg) {
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return '<!doctype html><meta charset="utf-8"><title>Login failed</title>' +
    '<body style="background:#0d0b14;color:#eae6f5;font-family:system-ui;padding:40px">' +
    '<h1>Login failed</h1><p>' + esc(msg) + '</p><p><a style="color:#b388ff" href="/">Back to the board</a></p></body>';
}

/* ---------- API plumbing ---------- */

// Mutating API calls must carry a custom header. Browsers won't send one
// cross-site without a CORS preflight (which we never approve), so this
// blocks CSRF on top of the SameSite=Lax cookie.
app.use('/api', (req, res, next) => {
  if (req.method !== 'GET' && req.get('X-Triage') !== '1') {
    return res.status(403).json({ error: 'Missing X-Triage header.' });
  }
  next();
});

app.get('/api/session', h(async (req, res) => {
  if (MODE === 'local') return res.json({ mode: 'local', signedIn: true, ready: true, storage: 'this computer' });
  const s = await getSession(req, res);
  if (!s) return res.json({ mode: 'github', signedIn: false });

  const out = {
    mode: 'github', signedIn: true,
    user: { login: s.login, avatar: s.a },
    repo: s.login + '/' + DATA_REPO,
    ready: false,
    newRepoUrl: 'https://github.com/new?name=' + encodeURIComponent(DATA_REPO) + '&visibility=private',
    installUrl: APP_SLUG ? 'https://github.com/apps/' + encodeURIComponent(APP_SLUG) + '/installations/new' : null
  };
  try {
    const r = await request(s.t, 'GET', '/repos/' + encodeURIComponent(s.login) + '/' + encodeURIComponent(DATA_REPO));
    out.ready = true;
    out.repoPrivate = !!r.private;
  } catch (e) {
    if (e.status === 401) { clearSession(res); return res.json({ mode: 'github', signedIn: false }); }
    if (e.status !== 404 && e.status !== 403) throw e;
  }
  res.json(out);
}));

// Attach the right storage backend for this request.
const withStore = h(async (req, res, next) => {
  if (MODE === 'local') { req.store = localStore; return next(); }
  const s = await getSession(req, res);
  if (!s) throw new HttpError(401, 'Sign in with GitHub to continue.', 'auth');
  req.store = createGithubStore({ token: s.t, owner: s.login, repo: DATA_REPO, seed: SEED });
  next();
});
app.use('/api', withStore);

/* ---------- board API ---------- */

app.get('/api/board', h(async (req, res) => {
  res.json(await req.store.getBoard());
}));

app.post('/api/projects', h(async (req, res) => {
  const name = oneLine(req.body && req.body.name, 80);
  if (!name) throw new HttpError(400, 'Project name required.');
  // Already there (e.g. this is a retry of an add that went through): leave it.
  // The browser stops people adding a duplicate on purpose.
  const board = await req.store.mutateBoard(b => {
    if (b.projects.some(p => p.toLowerCase() === name.toLowerCase())) return b;
    b.projects.push(name);
    const color = cleanProjectColor(req.body && req.body.color);
    if (color) b.projectColors[name] = color;
    return b;
  }, 'Add project: ' + name);
  res.json(board);
}));

// Set a project's accent colour. '' (or any unknown value) resets it to the default.
app.patch('/api/projects/:name', h(async (req, res) => {
  const name = req.params.name;
  const color = cleanProjectColor(req.body && req.body.color);
  const board = await req.store.mutateBoard(b => {
    if (!b.projects.includes(name)) throw new HttpError(404, 'That project no longer exists.');
    if (color) b.projectColors[name] = color;
    else delete b.projectColors[name];
    return b;
  }, 'Update project colour: ' + name + ' (' + (color || 'default') + ')');
  res.json(board);
}));

app.delete('/api/projects/:name', h(async (req, res) => {
  const name = req.params.name;
  // Items keep their project label even if the project is removed from the
  // list, so nothing is silently lost.
  const board = await req.store.mutateBoard(b => {
    b.projects = b.projects.filter(p => p !== name);
    delete b.projectColors[name];
    return b;
  }, 'Remove project: ' + name);
  res.json(board);
}));

app.post('/api/items', h(async (req, res) => {
  const body = req.body || {};
  if (!oneLine(body.title, 200)) throw new HttpError(400, 'Title required.');
  const item = sanitizeItem(body, null);
  // Adding the same id twice (a retried add) keeps the one already saved.
  const saved = await req.store.mutateBoard(b => {
    const existing = b.items.find(i => i.id === item.id);
    if (existing) return existing;
    b.items.push(item);
    return item;
  }, 'Add item: ' + item.title);
  res.json(saved);
}));

app.patch('/api/items/:id', h(async (req, res) => {
  const item = await req.store.mutateBoard(b => {
    const idx = b.items.findIndex(i => i.id === req.params.id);
    if (idx < 0) throw new HttpError(404, 'Item not found.');
    b.items[idx] = sanitizeItem(req.body || {}, b.items[idx]);
    return b.items[idx];
  }, it => (req.query.undo === '1' ? 'Undo change: ' : 'Update item: ') + it.title);
  res.json(item);
}));

/* ---------- checklist steps ---------- */

function stepId(req) {
  const sid = String(req.params.sid || '');
  if (!SUBTASK_ID_RE.test(sid)) throw new HttpError(400, 'Bad step id.');
  return sid;
}

// A retried add (same step id) returns the item unchanged.
app.post('/api/items/:id/subtasks', h(async (req, res) => {
  const body = req.body || {};
  const step = sanitizeSubtask(body, null);
  if (!step.text) throw new HttpError(400, 'Step text required.');
  let title = '';
  const item = await req.store.mutateBoard(b => {
    const it = b.items.find(i => i.id === req.params.id);
    if (!it) throw new HttpError(404, 'Item not found.');
    title = it.title;
    if (!Array.isArray(it.subtasks)) it.subtasks = [];
    if (it.subtasks.some(s => s.id === step.id)) return it;
    if (it.subtasks.length >= MAX_SUBTASKS) throw new HttpError(400, 'This item already has ' + MAX_SUBTASKS + ' steps.');
    it.subtasks.push(step);
    return it;
  }, () => 'Add step: ' + step.text + ' (' + title + ')');
  res.json(item);
}));

app.patch('/api/items/:id/subtasks/:sid', h(async (req, res) => {
  const sid = stepId(req);
  const body = req.body || {};
  let verb = 'Edit step: ', label = '', title = '';
  const item = await req.store.mutateBoard(b => {
    const it = b.items.find(i => i.id === req.params.id);
    if (!it) throw new HttpError(404, 'Item not found.');
    const idx = (it.subtasks || []).findIndex(s => s.id === sid);
    if (idx < 0) throw new HttpError(404, 'Step not found.');
    const next = sanitizeSubtask({ text: body.text, done: body.done }, it.subtasks[idx]);
    // Only apply the fields that were sent.
    const cur = it.subtasks[idx];
    if (!('text' in body)) next.text = cur.text;
    if (!('done' in body)) next.done = cur.done;
    if (!next.text) throw new HttpError(400, 'Step text required.');
    if (next.done !== cur.done) verb = next.done ? 'Tick step: ' : 'Untick step: ';
    it.subtasks[idx] = next;
    label = next.text;
    title = it.title;
    return it;
  }, () => verb + label + ' (' + title + ')');
  res.json(item);
}));

// Already gone (item or step) counts as done, so a retried delete doesn't fail.
app.delete('/api/items/:id/subtasks/:sid', h(async (req, res) => {
  const sid = stepId(req);
  let label = '', title = '';
  await req.store.mutateBoard(b => {
    const it = b.items.find(i => i.id === req.params.id);
    if (!it || !Array.isArray(it.subtasks)) return;
    const step = it.subtasks.find(s => s.id === sid);
    if (!step) return;
    label = step.text;
    title = it.title;
    it.subtasks = it.subtasks.filter(s => s.id !== sid);
    if (!it.subtasks.length) delete it.subtasks;
  }, () => 'Remove step: ' + label + ' (' + title + ')');
  res.json({ ok: true });
}));

// Already gone counts as done, so a retried delete doesn't fail.
app.delete('/api/items/:id', h(async (req, res) => {
  await req.store.mutateBoard(b => {
    b.items = b.items.filter(i => i.id !== req.params.id);
  }, 'Delete item');
  res.json({ ok: true });
}));

/* ---------- archive ---------- */

// Moving items between board.json and archive.json is two writes. The archive
// copy is always written first, so a failure in between leaves a duplicate that
// a retry cleans up, never a lost item.

function itemIds(req) {
  const ids = req.body && req.body.ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 ||
      !ids.every(i => typeof i === 'string' && ITEM_ID_RE.test(i))) {
    throw new HttpError(400, 'Send between 1 and 1000 item ids.');
  }
  return Array.from(new Set(ids));
}

const moveMessage = (verb, items) =>
  items.length === 1 ? verb + ' item: ' + items[0].title : verb + ' ' + items.length + ' items';

async function archiveItems(store, items, message, closing) {
  const now = new Date().toISOString();
  await store.mutateArchive(a => {
    items.forEach(it => {
      if (!a.items.some(x => x.id === it.id)) a.items.push({ ...it, archivedAt: now });
    });
    if (closing) {
      const rec = { name: closing.name, color: closing.color, closedAt: now };
      const i = a.projects.findIndex(p => p.name === closing.name);
      if (i < 0) a.projects.push(rec); else a.projects[i] = rec;
    }
  }, message);
  const gone = new Set(items.map(i => i.id));
  await store.mutateBoard(b => {
    b.items = b.items.filter(i => !gone.has(i.id));
    if (closing) {
      b.projects = b.projects.filter(p => p !== closing.name);
      delete b.projectColors[closing.name];
    }
  }, message);
}

// reopen: a project to put back on the board even when it has no items.
async function restoreItems(store, archive, items, message, reopen) {
  const colorOf = name => {
    const rec = archive.projects.find(p => p.name === name);
    return rec ? cleanProjectColor(rec.color) : '';
  };
  const board = await store.mutateBoard(b => {
    items.forEach(src => {
      if (b.items.some(i => i.id === src.id)) return;
      const it = { ...src };
      delete it.archivedAt;
      b.items.push(it);
    });
    const names = items.map(i => i.project);
    if (reopen) names.push(reopen);
    names.forEach(name => {
      if (!name || b.projects.includes(name)) return;
      b.projects.push(name);
      const c = colorOf(name);
      if (c) b.projectColors[name] = c;
    });
    return b;
  }, message);
  const gone = new Set(items.map(i => i.id));
  await store.mutateArchive(a => {
    a.items = a.items.filter(i => !gone.has(i.id));
    a.projects = a.projects.filter(p => !board.projects.includes(p.name));
  }, message);
}

app.get('/api/archive', h(async (req, res) => {
  res.json(await req.store.getArchive());
}));

app.post('/api/archive', h(async (req, res) => {
  const want = new Set(itemIds(req));
  const board = await req.store.getBoard();
  const items = board.items.filter(i => want.has(i.id));
  // Not on the board any more: a retry that finds them already moved.
  if (items.length) await archiveItems(req.store, items, moveMessage('Archive', items));
  res.json({ ok: true });
}));

app.post('/api/archive/restore', h(async (req, res) => {
  const want = new Set(itemIds(req));
  const archive = await req.store.getArchive();
  const items = archive.items.filter(i => want.has(i.id));
  if (items.length) await restoreItems(req.store, archive, items, moveMessage('Restore', items));
  res.json({ ok: true });
}));

app.post('/api/projects/:name/close', h(async (req, res) => {
  const name = req.params.name;
  const board = await req.store.getBoard();
  if (!board.projects.includes(name)) {
    // Already closed (a retry): nothing to do.
    const archive = await req.store.getArchive();
    if (archive.projects.some(p => p.name === name)) return res.json({ ok: true });
    throw new HttpError(404, 'That project no longer exists.');
  }
  const items = board.items.filter(i => i.project === name);
  await archiveItems(req.store, items, 'Close project: ' + name, { name, color: board.projectColors[name] || '' });
  res.json({ ok: true });
}));

app.post('/api/projects/:name/reopen', h(async (req, res) => {
  const name = req.params.name;
  const archive = await req.store.getArchive();
  const closed = archive.projects.some(p => p.name === name);
  const items = archive.items.filter(i => i.project === name);
  if (!closed && !items.length) {
    // Already reopened (a retry) or never closed.
    const board = await req.store.getBoard();
    if (board.projects.includes(name)) return res.json({ ok: true });
    throw new HttpError(404, 'That project is not in the archive.');
  }
  await restoreItems(req.store, archive, items, 'Reopen project: ' + name, name);
  res.json({ ok: true });
}));

/* ---------- snippets API ---------- */

function snippetId(req) {
  const id = String(req.params.id || '');
  if (!SNIPPET_ID_RE.test(id)) throw new HttpError(400, 'Bad snippet id.');
  return id;
}

app.get('/api/snippets', h(async (req, res) => {
  const list = await req.store.listSnippets();
  list.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  res.json(list);
}));

app.post('/api/snippets', h(async (req, res) => {
  const body = req.body || {};
  if (!oneLine(body.title, 120)) throw new HttpError(400, 'Title required.');
  const s = sanitizeSnippet(body, null);
  // A retried add whose first attempt went through: keep what's saved.
  const existing = await req.store.getSnippet(s.id);
  if (existing) return res.json(existing.snippet);
  await req.store.putSnippet(s, null, 'Add snippet: ' + s.title);
  res.json(s);
}));

app.patch('/api/snippets/:id', h(async (req, res) => {
  const id = snippetId(req);
  const found = await req.store.getSnippet(id);
  if (!found) throw new HttpError(404, 'Snippet not found.');
  const s = sanitizeSnippet(req.body || {}, found.snippet);
  s.id = id;
  if (!s.title) throw new HttpError(400, 'Title required.');
  await req.store.putSnippet(s, found.version, 'Update snippet: ' + s.title);
  res.json(s);
}));

app.delete('/api/snippets/:id', h(async (req, res) => {
  const id = snippetId(req);
  // Already gone counts as done, so a retried delete doesn't fail.
  await req.store.deleteSnippet(id, 'Delete snippet: ' + id);
  res.json({ ok: true });
}));

/* ---------- errors ---------- */

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err instanceof GitHubError) {
    // Already logged (one line) where the retries ran out.
    if (err.network) return res.status(503).json({ error: err.message, code: 'network' });
    if (err.status === 401) {
      if (MODE === 'github') clearSession(res);
      return res.status(401).json({ error: 'Your GitHub session expired. Sign in again.', code: 'auth' });
    }
    if (err.status === 403 || err.status === 404) {
      return res.status(409).json({
        error: 'Can\'t write to your ' + DATA_REPO + ' repo. Check it exists and the app is installed on it.',
        code: 'setup'
      });
    }
    if (err.status === 409) return res.status(409).json({ error: err.message });
    console.error('GitHub error:', err.status, err.message);
    return res.status(502).json({ error: 'GitHub error: ' + err.message });
  }
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

/* ---------- boot ---------- */

app.listen(PORT, () => {
  console.log('');
  console.log('  Triage Board is running.');
  console.log('  Open     ->  ' + BASE_URL);
  if (MODE === 'local') {
    console.log('  Storage  ->  local files in ' + DATA_DIR);
    console.log('               (set GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET to store in GitHub instead)');
  } else {
    console.log('  Storage  ->  GitHub: each user\'s private "' + DATA_REPO + '" repo');
    console.log('  Callback ->  ' + REDIRECT_URI + '   (must match your GitHub App settings)');
  }
  console.log('');
  console.log('  Press Ctrl+C here to stop the server.');
  console.log('');
});
