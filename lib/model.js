/**
 * Data model shared by both storage backends (local disk and GitHub repo):
 * board shape, item + snippet validation, and the snippet file format.
 */

class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ---------- board ---------- */

const PRIOS = ['critical', 'high', 'medium', 'low'];
const STATUSES = ['open', 'doing', 'testing', 'blocked', 'done'];

function emptyBoard() {
  return { projects: [], items: [], updatedAt: null };
}

// Defensive defaults so an older / hand-edited board still loads.
function normalizeBoard(b) {
  if (!b || typeof b !== 'object') b = emptyBoard();
  if (!Array.isArray(b.projects)) b.projects = [];
  if (!Array.isArray(b.items)) b.items = [];
  return b;
}

function newId() {
  return 'i-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function cleanStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max || 200);
}

function oneLine(v, max) {
  return cleanStr(typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ') : v, max);
}

// Coerce whatever the client sent into a valid item we're willing to store.
function sanitizeItem(raw, existing) {
  const it = existing ? { ...existing } : { id: newId(), createdAt: new Date().toISOString() };
  if ('title' in raw)   it.title   = oneLine(raw.title, 200);
  if ('project' in raw) it.project = oneLine(raw.project, 80);
  if ('group' in raw)   it.group   = oneLine(raw.group, 80);
  if ('note' in raw)    it.note    = cleanStr(raw.note, 800);
  if ('prio' in raw)    it.prio    = PRIOS.includes(raw.prio) ? raw.prio : (it.prio || 'medium');
  if ('status' in raw)  it.status  = STATUSES.includes(raw.status) ? raw.status : (it.status || 'open');
  if (!it.prio)   it.prio = 'medium';
  if (!it.status) it.status = 'open';
  if (it.group == null)   it.group = '';
  if (it.note == null)    it.note = '';
  if (it.project == null) it.project = '';
  return it;
}

/* ---------- snippets ---------- */

const LANGS = ['deluge', 'javascript', 'json', 'sql', 'python', 'html', 'css', 'bash', 'plaintext'];
const SNIPPET_ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'snippet';
}

function normalizeTags(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const out = [];
  list.forEach(t => {
    const tag = oneLine(String(t), 30).toLowerCase().replace(/,/g, '');
    if (tag && !out.includes(tag) && out.length < 20) out.push(tag);
  });
  return out;
}

function sanitizeSnippet(raw, existing) {
  const now = new Date().toISOString();
  const s = existing ? { ...existing } : { id: null, created: now };
  if ('title' in raw)       s.title = oneLine(raw.title, 120);
  if ('language' in raw)    s.language = LANGS.includes(raw.language) ? raw.language : (s.language || 'deluge');
  // Where the snippet is used, e.g. "Workflow function" or "Webhook". Free text.
  if ('type' in raw)        s.type = oneLine(raw.type, 40);
  if ('tags' in raw)        s.tags = normalizeTags(raw.tags);
  if ('description' in raw) s.description = cleanStr(raw.description, 4000);
  if ('code' in raw)        s.code = typeof raw.code === 'string' ? raw.code.replace(/\r\n/g, '\n').replace(/\s+$/, '').slice(0, 200000) : '';
  if (!s.language) s.language = 'deluge';
  if (!Array.isArray(s.tags)) s.tags = [];
  if (s.type == null) s.type = '';
  if (s.description == null) s.description = '';
  if (s.code == null) s.code = '';
  if (!s.id) s.id = slugify(s.title) + '-' + Math.random().toString(36).slice(2, 6);
  s.updated = now;
  return s;
}

/*
 * Snippets are stored one per file as readable markdown, so they look right
 * when browsed on github.com and can be hand-edited:
 *
 *   ---
 *   title: Books API - create invoice
 *   language: deluge
 *   type: Workflow function      (optional: where the snippet is used)
 *   tags: books, api
 *   created: 2026-01-01T00:00:00.000Z
 *   updated: 2026-01-01T00:00:00.000Z
 *   ---
 *
 *   Optional description.
 *
 *   ```deluge
 *   ...code...
 *   ```
 */
function longestBacktickRun(s) {
  let max = 0;
  (s.match(/`+/g) || []).forEach(r => { if (r.length > max) max = r.length; });
  return max;
}

function serializeSnippet(s) {
  const fence = '`'.repeat(Math.max(3, longestBacktickRun(s.code) + 1));
  let out = '---\n';
  out += 'title: ' + s.title + '\n';
  out += 'language: ' + s.language + '\n';
  if (s.type) out += 'type: ' + s.type + '\n';
  out += 'tags: ' + s.tags.join(', ') + '\n';
  out += 'created: ' + (s.created || '') + '\n';
  out += 'updated: ' + (s.updated || '') + '\n';
  out += '---\n\n';
  if (s.description) out += s.description + '\n\n';
  out += fence + s.language + '\n' + s.code + '\n' + fence + '\n';
  return out;
}

function parseSnippet(id, text) {
  text = String(text || '').replace(/\r\n/g, '\n');
  const meta = {};
  let body = text;
  if (text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4);
    if (end > 0) {
      text.slice(4, end).split('\n').forEach(line => {
        const m = line.match(/^([A-Za-z]+):\s?(.*)$/);
        if (m) meta[m[1].toLowerCase()] = m[2].trim();
      });
      body = text.slice(end + 4).replace(/^[^\n]*\n/, '');
    }
  }

  // The code is the LAST fenced block; everything before it is the description.
  const lines = body.split('\n');
  let close = -1, open = -1, lang = '';
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^`{3,}\s*$/.test(lines[i])) { close = i; break; }
    if (lines[i].trim()) break;
  }
  if (close > 0) {
    const fence = lines[close].trim();
    for (let j = close - 1; j >= 0; j--) {
      if (lines[j].startsWith(fence) && lines[j][fence.length] !== '`') {
        open = j; lang = lines[j].slice(fence.length).trim(); break;
      }
    }
  }
  let code, description;
  if (open >= 0) {
    code = lines.slice(open + 1, close).join('\n');
    description = lines.slice(0, open).join('\n').trim();
  } else {
    code = body.trim();
    description = '';
  }
  const alias = { js: 'javascript', sh: 'bash', shell: 'bash', py: 'python', text: 'plaintext', txt: 'plaintext' };
  lang = alias[lang.toLowerCase()] || lang.toLowerCase();
  const language = LANGS.includes(meta.language) ? meta.language : (LANGS.includes(lang) ? lang : 'plaintext');
  return {
    id,
    title: meta.title || id,
    language,
    type: oneLine(meta.type || '', 40),
    tags: normalizeTags(meta.tags || ''),
    description,
    code,
    created: meta.created || '',
    updated: meta.updated || ''
  };
}

module.exports = {
  HttpError, PRIOS, STATUSES, LANGS, SNIPPET_ID_RE,
  emptyBoard, normalizeBoard, cleanStr, oneLine, sanitizeItem,
  sanitizeSnippet, serializeSnippet, parseSnippet
};
