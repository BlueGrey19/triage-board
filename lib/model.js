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
// Preset accent colours a project can use. Stored by name (not hex) so the
// front end can pick a shade that reads well in both light and dark mode.
// No entry = the default purple.
const PROJECT_COLORS = ['blue', 'cyan', 'teal', 'green', 'lime', 'amber', 'orange', 'rose', 'pink', 'slate'];

// Every project moves through the same stages. The activities are the groups
// suggested for items in that stage.
const STAGES = [
  { k: 'implementation', name: 'Implementation', acts: ['Development', 'Configuration'] },
  { k: 'golive', name: 'Go Live', acts: ['Training', 'Customer Testing', 'Defect Resolution'] },
  { k: 'acceptance', name: 'Acceptance', acts: ['Final Review', 'Project Closure'] },
  { k: 'hypercare', name: 'Hypercare', acts: ['User Onboarding', 'Support Takeover'] }
];
const STAGE_KEYS = STAGES.map(s => s.k);

// A project's current stage; no entry means the first one.
function projectStage(board, name) {
  const k = board.projectStages && board.projectStages[name];
  return STAGE_KEYS.includes(k) ? k : STAGE_KEYS[0];
}

// An item's stage: its own, or else its project's current one ('' without a project).
function effectiveStage(board, item) {
  if (!item.project) return '';
  return STAGE_KEYS.includes(item.stage) ? item.stage : projectStage(board, item.project);
}

function emptyBoard() {
  return { projects: [], projectColors: {}, items: [], updatedAt: null };
}

// '' (or anything unknown) means "use the default colour".
function cleanProjectColor(v) {
  return PROJECT_COLORS.includes(v) ? v : '';
}

// Defensive defaults so an older / hand-edited board still loads.
function normalizeBoard(b) {
  if (!b || typeof b !== 'object') b = emptyBoard();
  if (!Array.isArray(b.projects)) b.projects = [];
  if (!Array.isArray(b.items)) b.items = [];
  // Keep only valid colours for projects that still exist.
  const colors = b.projectColors && typeof b.projectColors === 'object' ? b.projectColors : {};
  b.projectColors = {};
  b.projects.forEach(p => {
    const c = cleanProjectColor(colors[p]);
    if (c) b.projectColors[p] = c;
  });
  // Same for stages; 'implementation' is the default, so only the others are kept.
  const stages = b.projectStages && typeof b.projectStages === 'object' ? b.projectStages : {};
  b.projectStages = {};
  b.projects.forEach(p => {
    if (STAGE_KEYS.includes(stages[p])) b.projectStages[p] = stages[p];
  });
  return b;
}

function newId() {
  return 'i-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

// The browser makes the id for a new item, so it can show (and keep changing)
// the item before it's saved. Anything that doesn't look like ours is replaced.
const ITEM_ID_RE = /^i-[a-z0-9]{1,16}-[a-z0-9]{1,16}$/;

function cleanStr(v, max) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, max || 200);
}

function oneLine(v, max) {
  return cleanStr(typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ') : v, max);
}

// Checklist steps on an item. Ids are made in the browser, like item ids.
const SUBTASK_ID_RE = /^s-[a-z0-9]{1,16}-[a-z0-9]{1,16}$/;
const MAX_SUBTASKS = 50;

// Snippets linked to an item (item.snippets = [snippet id, ...]).
const MAX_SNIPPET_LINKS = 20;

function sanitizeSubtask(raw, existing) {
  raw = raw && typeof raw === 'object' ? raw : {};
  const st = existing ? { ...existing } : {
    id: typeof raw.id === 'string' && SUBTASK_ID_RE.test(raw.id) ? raw.id
      : 's-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    text: '',
    done: false
  };
  if ('text' in raw) st.text = oneLine(raw.text, 200);
  if ('done' in raw) st.done = !!raw.done;
  st.done = !!st.done;
  return st;
}

// Coerce whatever the client sent into a valid item we're willing to store.
function sanitizeItem(raw, existing) {
  const it = existing ? { ...existing } : {
    id: typeof raw.id === 'string' && ITEM_ID_RE.test(raw.id) ? raw.id : newId(),
    createdAt: new Date().toISOString()
  };
  if ('title' in raw)   it.title   = oneLine(raw.title, 200);
  if ('project' in raw) it.project = oneLine(raw.project, 80);
  if ('group' in raw)   it.group   = oneLine(raw.group, 80);
  if ('note' in raw)    it.note    = cleanStr(raw.note, 800);
  if ('prio' in raw)    it.prio    = PRIOS.includes(raw.prio) ? raw.prio : (it.prio || 'medium');
  const wasDone = !!existing && existing.status === 'done';
  if ('status' in raw)  it.status  = STATUSES.includes(raw.status) ? raw.status : (it.status || 'open');
  if ('stage' in raw) {
    if (STAGE_KEYS.includes(raw.stage)) it.stage = raw.stage;
    else delete it.stage;
  }
  if (!it.prio)   it.prio = 'medium';
  if (!it.status) it.status = 'open';
  if (it.group == null)   it.group = '';
  if (it.note == null)    it.note = '';
  if (it.project == null) it.project = '';
  if (!it.project) delete it.stage;
  // When it was finished: set on the way into done, dropped on the way out.
  if (it.status === 'done') { if (!wasDone) it.doneAt = new Date().toISOString(); }
  else delete it.doneAt;
  // Steps can come with a new item (e.g. a pasted list); after that they only
  // change through the step routes.
  if (!existing && Array.isArray(raw.subtasks)) {
    const seen = {};
    const steps = [];
    raw.subtasks.forEach(s => {
      if (steps.length >= MAX_SUBTASKS) return;
      const st = sanitizeSubtask(s, null);
      if (!st.text || seen[st.id]) return;
      seen[st.id] = true;
      steps.push(st);
    });
    if (steps.length) it.subtasks = steps;
  }
  // Same for linked snippets: set on create, then only via the link routes.
  if (!existing && Array.isArray(raw.snippets)) {
    const ids = [];
    raw.snippets.forEach(id => {
      if (typeof id === 'string' && SNIPPET_ID_RE.test(id) && !ids.includes(id) && ids.length < MAX_SNIPPET_LINKS) ids.push(id);
    });
    if (ids.length) it.snippets = ids;
  }
  return it;
}

/* ---------- archive ---------- */

// archive.json: items taken off the board, plus the projects that were closed.
function normalizeArchive(a) {
  if (!a || typeof a !== 'object') a = {};
  const items = [];
  const seen = {};
  (Array.isArray(a.items) ? a.items : []).forEach(it => {
    if (!it || typeof it !== 'object' || typeof it.id !== 'string' || seen[it.id]) return;
    seen[it.id] = true;
    items.push(it);
  });
  const projects = [];
  (Array.isArray(a.projects) ? a.projects : []).forEach(p => {
    const name = p && typeof p === 'object' ? oneLine(p.name, 80) : '';
    if (!name || projects.some(x => x.name === name)) return;
    const rec = { name, color: cleanProjectColor(p.color), closedAt: typeof p.closedAt === 'string' ? p.closedAt : '' };
    if (STAGE_KEYS.includes(p.stage)) rec.stage = p.stage;
    projects.push(rec);
  });
  return { items, projects, updatedAt: typeof a.updatedAt === 'string' ? a.updatedAt : null };
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

// Project names a snippet is linked to. Commas would break the header line.
function normalizeProjects(raw) {
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const out = [];
  list.forEach(p => {
    const name = oneLine(typeof p === 'string' ? p : '', 80).replace(/,/g, '').trim();
    if (name && !out.some(x => x.toLowerCase() === name.toLowerCase()) && out.length < 20) out.push(name);
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
  if ('projects' in raw)    s.projects = normalizeProjects(raw.projects);
  if ('description' in raw) s.description = cleanStr(raw.description, 4000);
  if ('code' in raw)        s.code = typeof raw.code === 'string' ? raw.code.replace(/\r\n/g, '\n').replace(/\s+$/, '').slice(0, 200000) : '';
  if (!s.language) s.language = 'deluge';
  if (!Array.isArray(s.tags)) s.tags = [];
  if (!Array.isArray(s.projects)) s.projects = [];
  if (s.type == null) s.type = '';
  if (s.description == null) s.description = '';
  if (s.code == null) s.code = '';
  // A new snippet may bring its own id, made in the browser like item ids.
  if (!s.id && typeof raw.id === 'string' && SNIPPET_ID_RE.test(raw.id)) s.id = raw.id;
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
 *   projects: Alpha, Beta       (optional: projects it is linked to)
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
  if (s.projects && s.projects.length) out += 'projects: ' + s.projects.join(', ') + '\n';
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
    projects: normalizeProjects(meta.projects || ''),
    description,
    code,
    created: meta.created || '',
    updated: meta.updated || ''
  };
}

module.exports = {
  HttpError, PRIOS, STATUSES, PROJECT_COLORS, STAGES, STAGE_KEYS, projectStage, effectiveStage, LANGS, SNIPPET_ID_RE, ITEM_ID_RE,
  SUBTASK_ID_RE, MAX_SUBTASKS, MAX_SNIPPET_LINKS, sanitizeSubtask,
  emptyBoard, normalizeBoard, normalizeArchive, cleanProjectColor, cleanStr, oneLine, sanitizeItem,
  sanitizeSnippet, serializeSnippet, parseSnippet
};
