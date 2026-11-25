/* Triage Board — frontend.
 * Talks to the server's /api endpoints. The server owns the data (local
 * files, or the signed-in user's private GitHub repo); this file just renders
 * it and sends changes back.
 */
(function () {
  'use strict';

  var PRIOS = [
    { k: 'critical', name: 'Critical' },
    { k: 'high',     name: 'High' },
    { k: 'medium',   name: 'Medium' },
    { k: 'low',      name: 'Low' }
  ];
  var PLAB = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
  var PCOLOR = { critical: 'var(--crit)', high: 'var(--high)', medium: 'var(--med)', low: 'var(--low)' };
  // Project accent colours. Names match the server's PROJECT_COLORS; the actual
  // shades live in styles.css (--pc-*) so each theme can use a readable one.
  var PROJ_COLORS = [
    { k: '', name: 'Default (purple)' },
    { k: 'blue', name: 'Blue' }, { k: 'cyan', name: 'Cyan' }, { k: 'teal', name: 'Teal' },
    { k: 'green', name: 'Green' }, { k: 'lime', name: 'Lime' }, { k: 'amber', name: 'Amber' },
    { k: 'orange', name: 'Orange' }, { k: 'rose', name: 'Rose' }, { k: 'pink', name: 'Pink' },
    { k: 'slate', name: 'Slate' }
  ];
  var STATUSES = ['open', 'doing', 'testing', 'blocked', 'done'];
  var SLAB = { open: 'Open', doing: 'Doing', testing: 'Testing', blocked: 'Blocked', done: 'Done' };
  var SCOLOR = { open: 'var(--st-open)', doing: 'var(--st-doing)', testing: 'var(--st-testing)', blocked: 'var(--st-blocked)', done: 'var(--st-done)' };
  var SRANK = { doing: 0, testing: 1, blocked: 2, open: 3, done: 4 };

  var ICON = {
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    more:  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>',
    note:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
    plus:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    chev:  '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>',
    back:  '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>',
    copy:  '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    code:  '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    active:  '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>',
    doing:   '<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="7 4 19 12 7 20 7 4"/></svg>',
    testing: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6L4.5 18.5A1.7 1.7 0 0 0 6 21h12a1.7 1.7 0 0 0 1.5-2.5L14 9V3M7 15h10"/></svg>',
    blocked: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
    done:    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><polyline points="22 4 12 14 9 11"/></svg>'
  };

  // Local view of server state.
  var board = { projects: [], items: [] };
  var boardLoaded = false;
  // prio / project come from the sidebar; view comes from the status tiles.
  // group: one entry from an item's comma-separated groups; q: board search text.
  var filters = { prio: 'all', project: 'all', group: 'all', view: 'all', q: '' };
  var openDone = {};      // band key -> true when its Done section is expanded
  var editingId = null;   // when set, the add-modal is in "edit" mode
  var detailId = null;    // item shown in the expanded-card modal
  var page = 'board';

  var appEl = document.getElementById('app');
  var boardEl = document.getElementById('board');

  /* ---------- small persisted preferences ---------- */
  function pref(key, fallback) { try { return localStorage.getItem(key) || fallback; } catch (_) { return fallback; } }
  function setPref(key, v) { try { localStorage.setItem(key, v); } catch (_) {} }
  var layout = pref('tb-layout', 'cards');

  /* ---------- tiny API client ---------- */
  function api(method, url, body) {
    var headers = { 'X-Triage': '1' };
    if (body) headers['Content-Type'] = 'application/json';
    return fetch(url, {
      method: method,
      headers: headers,
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) {
          // Session expired or repo went missing: drop back to the gate screen.
          if (data.code === 'auth' || data.code === 'setup') setTimeout(boot, 0);
          var e = new Error(data.error || ('Request failed (' + r.status + ')'));
          // GitHub (or a proxy in front of us) unreachable: worth showing the saved copy.
          e.offline = r.status === 502 || r.status === 503 || r.status === 504;
          throw e;
        }
        return data;
      });
    }, function () {
      var e = new Error('Can’t reach the server.'); e.offline = true; throw e;
    });
  }

  /* ---------- saved copy for offline use ----------
   * The last board and snippets loaded, kept in this browser so the app can
   * still open (with any unsaved changes on top) when GitHub or the server
   * can't be reached. Cleared on sign out. */
  var who = '';                 // 'local' or the GitHub login, set in enterApp
  function cacheKey(k) { return 'tb-cache:' + who + ':' + k; }
  function readCache(k) { try { return JSON.parse(localStorage.getItem(cacheKey(k)) || 'null'); } catch (_) { return null; } }
  function writeCache(k, v) { try { localStorage.setItem(cacheKey(k), JSON.stringify(v)); } catch (_) {} }
  function clearCaches() {
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (k.indexOf('tb-cache:') === 0 || k === 'tb-last-session') localStorage.removeItem(k);
      });
    } catch (_) {}
  }
  var showingCopy = false;      // on screen is the saved copy, not the latest from the server

  /* ==========================================================
   * Sync queue
   *
   * Every change shows on screen straight away and is queued in the browser
   * (localStorage, so it survives a refresh), then sent to the server in
   * order. If the server or GitHub can't be reached, the change stays queued
   * and is retried, waiting longer each time. Each change is a small
   * instruction ("set this item's status to Testing"), and the server applies
   * it to the latest board, so edits from another device aren't overwritten.
   * The server treats a repeated change as already done, so sending one twice
   * is harmless.
   * ========================================================== */
  var QKEY = 'tb-queue';        // per user, set in enterApp
  var queue = [];               // [{ id, t, m, u, b, k, label, tries }]
  var syncMode = 'local';       // 'local' | 'github'
  var syncState = 'ok';         // 'ok' | 'saving' | 'pending' | 'offline'
  var flushing = false, retryT = null, retryDelay = 0, syncPaused = false;
  var failing = false;          // saves are currently failing (label shows it; toasts once)
  var snipsTouched = false;     // a snippet change was sent: reload the library after

  function rid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }
  function readQueue() {
    try { var q = JSON.parse(localStorage.getItem(QKEY) || '[]'); queue = Array.isArray(q) ? q : []; }
    catch (_) { /* storage blocked: keep what's in memory */ }
  }
  function writeQueue() { try { localStorage.setItem(QKEY, JSON.stringify(queue)); } catch (_) {} }
  function isSnipOp(op) { return op.t.indexOf('snip.') === 0; }

  // Apply a change to what's on screen. Used when the change is made, and
  // again after every reload for changes that haven't been saved yet.
  function applyOp(op) {
    var b = op.b || {};
    switch (op.t) {
      case 'item.add':
        if (!itemById(b.id)) board.items.push(Object.assign({ status: 'open', createdAt: new Date().toISOString() }, b));
        break;
      case 'item.patch':
        var it = itemById(op.k); if (it) Object.assign(it, b);
        break;
      case 'item.del':
        board.items = board.items.filter(function (i) { return i.id !== op.k; });
        break;
      case 'proj.add':
        if (!board.projects.some(function (p) { return p.toLowerCase() === b.name.toLowerCase(); })) {
          board.projects.push(b.name);
          board.projectColors = Object.assign({}, board.projectColors);
          if (b.color) board.projectColors[b.name] = b.color;
        }
        break;
      case 'proj.color':
        if (board.projects.indexOf(op.k) >= 0) {
          board.projectColors = Object.assign({}, board.projectColors);
          if (b.color) board.projectColors[op.k] = b.color; else delete board.projectColors[op.k];
        }
        break;
      case 'proj.del':
        board.projects = board.projects.filter(function (p) { return p !== op.k; });
        if (board.projectColors) delete board.projectColors[op.k];
        break;
      case 'snip.add':
        if (!snipById(b.id)) snippets.unshift(localSnippet(b, null));
        break;
      case 'snip.patch':
        // Most recently updated first, as the server sorts them.
        var s = snipById(op.k);
        if (s) { localSnippet(b, s); snippets = [s].concat(snippets.filter(function (x) { return x !== s; })); }
        break;
      case 'snip.del':
        snippets = snippets.filter(function (x) { return x.id !== op.k; });
        break;
    }
  }
  function applyPending(kind) {
    queue.forEach(function (op) { if ((kind === 'snip') === isSnipOp(op)) applyOp(op); });
  }

  // Make a change: show it now, save it in the background.
  function change(op) {
    op.id = rid(); op.tries = 0;
    applyOp(op);
    if (isSnipOp(op)) renderSnippets();
    else { render(); if (projBg.classList.contains('open')) renderProjList(); }
    readQueue(); // pick up anything another tab queued
    queue.push(op); writeQueue();
    flush();
  }

  function dropMessage(op, err) {
    var what = op.label ? '“' + op.label + '”' : 'that change';
    if (op.t === 'item.patch' && /not found/i.test(err)) return what + ' was deleted somewhere else, so your change wasn’t saved.';
    if (op.t === 'snip.patch' && /not found/i.test(err)) return what + ' was deleted somewhere else, so your change wasn’t saved.';
    if (op.t === 'proj.color' && /no longer exists/i.test(err)) return 'Project ' + what + ' was removed somewhere else, so its colour wasn’t saved.';
    return 'Couldn’t save ' + what + ': ' + err;
  }

  // Send one change. Resolves when it's done with (saved, or can never be
  // saved and was dropped); rejects with .kind when it should be retried.
  function sendOp(op) {
    function fail(kind, msg) { var e = new Error(msg); e.kind = kind; return e; }
    return fetch(op.u, {
      method: op.m,
      headers: { 'X-Triage': '1', 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: op.b ? JSON.stringify(op.b) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (r.ok) return null;
        var msg = data.error || ('Request failed (' + r.status + ')');
        // Signed out or repo gone: keep the change, it's sent after signing back in.
        if (data.code === 'auth' || data.code === 'setup') throw fail('auth', msg);
        if (r.status === 502 || r.status === 503 || r.status === 504) throw fail('retry', msg);
        if (r.status >= 500) {
          // A server bug won't fix itself; give up after a few tries so one bad
          // change can't hold up everything behind it.
          if (++op.tries < 4) throw fail('retry', msg);
          return dropMessage(op, msg);
        }
        return dropMessage(op, msg); // 4xx: this change can't be applied
      });
    }, function () { throw fail('offline', 'Can’t reach the server.'); });
  }

  function drain() {
    readQueue();
    var op = queue[0];
    if (!op) return Promise.resolve();
    return sendOp(op).then(function (dropped) {
      if (isSnipOp(op)) snipsTouched = true;
      readQueue();
      queue = queue.filter(function (x) { return x.id !== op.id; });
      writeQueue();
      if (dropped) toast(dropped);
      setSync(queue.length ? 'saving' : 'ok');
      return drain();
    }, function (e) {
      // Keep the retry count for server errors.
      readQueue();
      queue.forEach(function (x) { if (x.id === op.id) x.tries = op.tries; });
      writeQueue();
      throw e;
    });
  }

  function flush() {
    if (flushing || syncPaused) return;
    readQueue();
    if (!queue.length) {
      // Nothing to send, but the screen is the saved copy: try loading the latest.
      if (showingCopy) { clearTimeout(retryT); retryT = null; loadBoard(); }
      else setSync('ok');
      return;
    }
    clearTimeout(retryT); retryT = null;
    flushing = true;
    // While retrying, keep showing "Not synced" (with the new count) instead of flickering.
    setSync(failing ? syncState : 'saving');
    // Only one tab sends at a time (where the browser supports it).
    var run = navigator.locks ? navigator.locks.request('tb-sync', drain) : drain();
    run.then(function () {
      flushing = false; retryDelay = 0;
      setSync('ok');
      if (failing) toast('All changes saved', true);
      failing = false;
      // Catch up with the saved version (and anything changed on another device).
      loadBoard();
      if (snipsTouched) { snipsTouched = false; loadSnippets(); }
    }, function (e) {
      flushing = false;
      if (e.kind === 'auth') { syncPaused = true; setSync('pending'); boot(); return; }
      setSync(e.kind === 'offline' && navigator.onLine === false ? 'offline' : 'pending');
      if (!failing) toast((syncMode === 'github' ? 'Couldn’t save to GitHub' : 'Couldn’t save') + '. Your changes are kept and will be retried.');
      failing = true;
      retryDelay = Math.min(Math.max(2000, retryDelay * 2), 60000);
      retryT = setTimeout(flush, retryDelay);
    });
  }

  function setSync(state) {
    syncState = state;
    var n = queue.length, gh = syncMode === 'github';
    var waiting = n + ' change' + (n === 1 ? '' : 's');
    var text = {
      ok: gh ? 'Synced to GitHub' : 'Saved locally',
      saving: 'Saving…',
      pending: n
        ? (gh ? 'Not synced' : 'Not saved') + ' · ' + waiting + ' · retrying'
        : (gh ? 'Can’t reach GitHub' : 'Can’t reach the server') + ' · retrying',
      offline: n ? 'Offline · ' + waiting + ' waiting' : 'Offline · showing saved copy'
    }[state];
    var tip = state === 'pending' || state === 'offline'
      ? 'Your changes are kept in this browser and will be saved automatically. Click to try again now.'
      : (gh ? 'Every change is saved as a commit in your GitHub repo.' : 'Changes are saved to this computer.');
    document.querySelectorAll('[data-sync]').forEach(function (el) {
      el.dataset.state = state;
      el.querySelector('.sync-txt').textContent = text;
      el.title = tip;
      el.setAttribute('aria-label', text + '. ' + tip);
    });
  }

  document.addEventListener('click', function (e) {
    if (!e.target.closest('[data-sync]')) return;
    if (syncState === 'pending' || syncState === 'offline') { retryDelay = 0; flush(); }
  });
  window.addEventListener('online', function () { retryDelay = 0; flush(); });
  window.addEventListener('offline', function () { if (queue.length && !flushing) setSync('offline'); });
  // Another tab queued or saved something: keep the count in the label right.
  window.addEventListener('storage', function (e) {
    if (e.key !== QKEY) return;
    readQueue();
    if (!flushing) setSync(queue.length ? syncState === 'ok' ? 'saving' : syncState : 'ok');
  });
  window.addEventListener('beforeunload', function (e) {
    if (!queue.length) return;
    e.preventDefault(); e.returnValue = ''; // changes are kept either way; this is a heads-up
  });

  function loadBoard() {
    return api('GET', '/api/board').then(function (b) {
      writeCache('board', b);
      board = b;
      applyPending('board'); // changes not saved yet stay on screen
      boardLoaded = true;
      if (showingCopy) {
        showingCopy = false;
        loadSnippets(); // the library may be the saved copy too
        if (!queue.length) {
          if (failing) toast('Back online', true);
          failing = false; retryDelay = 0;
          setSync('ok');
        }
      }
      // keep the active project filter valid
      if (filters.project !== 'all' && projectOrder().indexOf(filters.project) < 0) filters.project = 'all';
      if (filters.group !== 'all' && !allGroups().some(function (g) { return sameText(g, filters.group); })) filters.group = 'all';
      render();
    }).catch(function (e) {
      // Already showing the board: keep it rather than blanking the screen.
      if (boardLoaded) { if (e.offline) goOffline(); return; }
      var copy = e.offline && readCache('board');
      if (copy) {
        board = copy;
        applyPending('board');
        boardLoaded = true;
        goOffline();
        render();
        return;
      }
      boardEl.innerHTML = '<p class="empty">' + (e.offline
        ? 'Can’t load your board right now.<br>' + esc(e.message) + '<br><br>It will load once the connection is back.'
        : 'Could not load the board.<br><br>' + esc(e.message)) + '</p>';
      if (e.offline) goOffline();
    });
  }

  // Couldn't reach the server/GitHub to load: say so, and keep trying.
  function goOffline() {
    showingCopy = true;
    if (!failing) { failing = true; toast('You’re offline. Showing your last saved copy; changes will sync when you’re back.'); }
    setSync(navigator.onLine === false ? 'offline' : 'pending');
    if (!retryT && !flushing) {
      retryDelay = Math.min(Math.max(2000, retryDelay * 2), 60000);
      retryT = setTimeout(function () { retryT = null; flush(); }, retryDelay);
    }
  }

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function itemById(id) {
    for (var i = 0; i < board.items.length; i++) if (board.items[i].id === id) return board.items[i];
    return null;
  }
  // Projects in the user's configured order, then any leftover labels found
  // on items (e.g. from a removed project).
  function projectOrder() {
    var order = board.projects.slice();
    board.items.forEach(function (it) {
      var p = it.project || '(no project)';
      if (order.indexOf(p) < 0) order.push(p);
    });
    return order;
  }
  /* ---------- project colours ---------- */
  function projColor(p) {
    var k = board.projectColors && board.projectColors[p];
    return PROJ_COLORS.some(function (c) { return c.k && c.k === k; }) ? k : '';
  }
  function pcVar(k) { return k ? 'var(--pc-' + k + ')' : 'var(--purple)'; }
  function colorName(k) {
    for (var i = 0; i < PROJ_COLORS.length; i++) if (PROJ_COLORS[i].k === k) return PROJ_COLORS[i].name;
    return PROJ_COLORS[0].name;
  }
  function projChip(p) {
    var k = projColor(p);
    return '<span class="chip proj"' + (k ? ' style="--pc:' + pcVar(k) + '"' : '') + '>' + esc(p) + '</span>';
  }
  // When the board is filtered to a project with a colour, that colour becomes
  // the page accent (header glow, progress bar, buttons, chips, menus).
  function applyAccent() {
    var k = page === 'board' && filters.project !== 'all' ? projColor(filters.project) : '';
    var s = document.body.style;
    if (k) {
      s.setProperty('--acc', 'var(--pc-' + k + ')');
      s.setProperty('--acc-2', 'var(--pc-' + k + '-2)');
      s.setProperty('--acc-ink', 'var(--pc-ink)');
      document.body.dataset.pc = k;
    } else {
      s.removeProperty('--acc'); s.removeProperty('--acc-2'); s.removeProperty('--acc-ink');
      delete document.body.dataset.pc;
    }
  }

  // Groups are stored as one text field; commas separate several ("Books, Reporting tags").
  function groupsOf(it) {
    return String(it.group || '').split(',').map(function (g) { return g.trim(); }).filter(Boolean);
  }
  function sameText(a, b) { return String(a).toLowerCase() === String(b).toLowerCase(); }
  // Every group used on the board, case-insensitively unique, A–Z.
  function allGroups() {
    var seen = {}, out = [];
    board.items.forEach(function (it) {
      groupsOf(it).forEach(function (g) { var k = g.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(g); } });
    });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  function matchesSearch(it) {
    var q = filters.q.trim().toLowerCase();
    if (!q) return true;
    var hay = [it.title, it.note, it.group, it.project].join('\n').toLowerCase();
    return q.split(/\s+/).every(function (t) { return hay.indexOf(t) >= 0; });
  }
  // skip: name of one filter to ignore (used to count what the group menu would show).
  function inScope(it, skip) {
    if (filters.prio !== 'all' && (it.prio || 'medium') !== filters.prio) return false;
    if (filters.project !== 'all' && (it.project || '(no project)') !== filters.project) return false;
    if (skip !== 'group' && filters.group !== 'all' && !groupsOf(it).some(function (g) { return sameText(g, filters.group); })) return false;
    return matchesSearch(it);
  }
  function matchesView(it) {
    var st = it.status || 'open';
    if (filters.view === 'active') return st !== 'done';
    if (filters.view === 'all') return true;
    return st === filters.view;
  }
  function notDone(it) { return it.status !== 'done'; }
  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  }

  /* ==========================================================
   * Board rendering
   * ========================================================== */
  // Title plus the description icon. The icon is glued to the last word so it
  // never wraps onto a line of its own.
  function titleWithNote(it) {
    var t = String(it.title || '');
    if (!it.note) return esc(t);
    var icon = '<span class="has-note" title="Has a description" aria-label="Has a description">' + ICON.note + '</span>';
    var cut = t.lastIndexOf(' ');
    return esc(t.slice(0, cut + 1)) + '<span class="nw">' + esc(t.slice(cut + 1)) + icon + '</span>';
  }

  function cardHTML(it, showProject) {
    var st = it.status || 'open';
    var h = '<article class="card s-' + st + '" data-id="' + esc(it.id) + '" draggable="true" tabindex="0" aria-label="' + esc(it.title) + '">';
    h += '<button class="check" data-act="done" aria-label="' + (st === 'done' ? 'Mark not done' : 'Mark done') + '">' + ICON.check + '</button>';
    h += '<h3 class="ct">' + titleWithNote(it) + '</h3>';
    h += '<button class="more" data-act="more" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">' + ICON.more + '</button>';
    h += '<div class="meta">';
    h += '<button class="pill ' + st + '" data-act="status" aria-haspopup="menu" title="Change status">' + SLAB[st] + '</button>';
    if (showProject && it.project) h += projChip(it.project);
    groupsOf(it).forEach(function (g) {
      var on = filters.group !== 'all' && sameText(g, filters.group);
      h += '<button class="chip grp' + (on ? ' on' : '') + '" data-act="group" data-g="' + esc(g) + '" aria-pressed="' + on + '" title="' +
        (on ? 'Stop filtering by ' : 'Show only ') + esc(g) + '">' + esc(g) + '</button>';
    });
    h += '</div></article>';
    return h;
  }

  function bandHTML(p, showProject) {
    var all = board.items.filter(function (i) { return (i.prio || 'medium') === p.k && inScope(i); });
    var open = all.filter(function (i) { return notDone(i) && matchesView(i); })
      .sort(function (a, b) { return SRANK[a.status || 'open'] - SRANK[b.status || 'open']; });
    var done = all.filter(function (i) { return i.status === 'done'; });
    var openCount = all.filter(notDone).length;

    var h = '<section class="band ' + p.k + '" data-band="' + p.k + '">';
    h += '<div class="band-head"><span class="band-dot"></span><h2 class="band-name">' + p.name + '</h2>';
    if (openCount) h += '<span class="band-count" title="Not done">' + openCount + '</span>';
    h += '<button class="band-add" data-act="band-add" data-p="' + p.k + '" title="Add a ' + p.name + ' item" aria-label="Add a ' + p.name + ' item">' + ICON.plus + '</button></div>';

    if (filters.view === 'done') {
      h += '<div class="band-body" data-band="' + p.k + '">' +
        (done.length ? done.map(function (i) { return cardHTML(i, showProject); }).join('') : '<p class="drophint">' + (filters.q ? 'No matches' : 'Nothing done yet') + '</p>') + '</div>';
    } else {
      var emptyMsg = filters.q ? 'No matches' : (filters.view === 'all' || filters.view === 'active' ? 'Nothing open. Drop a card here' : 'None');
      h += '<div class="band-body" data-band="' + p.k + '">' +
        (open.length ? open.map(function (i) { return cardHTML(i, showProject); }).join('')
                     : '<p class="drophint">' + emptyMsg + '</p>') + '</div>';
      if (filters.view === 'all' && done.length) {
        var ex = !!openDone[p.k];
        h += '<button class="done-toggle" data-act="done-toggle" data-p="' + p.k + '" aria-expanded="' + ex + '">' +
             '<span class="ok">' + ICON.check + '</span>' + done.length + ' done' + ICON.chev + '</button>';
        if (ex) h += '<div class="band-body done-body" data-band="' + p.k + '">' + done.map(function (i) { return cardHTML(i, showProject); }).join('') + '</div>';
      }
    }
    return h + '</section>';
  }

  function statsHTML(scoped) {
    var n = {
      active: scoped.filter(notDone).length,
      doing: scoped.filter(function (i) { return i.status === 'doing'; }).length,
      testing: scoped.filter(function (i) { return i.status === 'testing'; }).length,
      blocked: scoped.filter(function (i) { return i.status === 'blocked'; }).length,
      done: scoped.filter(function (i) { return i.status === 'done'; }).length
    };
    var tiles = [
      { k: 'active',  lab: 'Not done', c: 'var(--acc)' },
      { k: 'doing',   lab: 'Doing',    c: SCOLOR.doing },
      { k: 'testing', lab: 'Testing',  c: SCOLOR.testing },
      { k: 'blocked', lab: 'Blocked',  c: SCOLOR.blocked },
      { k: 'done',    lab: 'Done',     c: SCOLOR.done }
    ];
    return tiles.map(function (t) {
      return '<button class="stat" style="--c:' + t.c + '" data-view="' + t.k + '" aria-pressed="' + (filters.view === t.k) + '" title="Show only ' + t.lab.toLowerCase() + ' items (click again for all)">' +
        '<span class="stat-ico">' + ICON[t.k] + '</span><span class="stat-lab">' + t.lab + '</span><span class="stat-num">' + n[t.k] + '</span></button>';
    }).join('');
  }

  // Removable chips for every active filter, shown under the board title.
  var VIEW_LAB = { active: 'Not done', doing: 'Doing', testing: 'Testing', blocked: 'Blocked', done: 'Done' };
  function activeFiltersHTML() {
    var f = [];
    if (filters.prio !== 'all') f.push({ k: 'prio', lab: 'Priority', v: PLAB[filters.prio] });
    if (filters.project !== 'all') f.push({ k: 'project', lab: 'Project', v: filters.project });
    if (filters.group !== 'all') f.push({ k: 'group', lab: 'Group', v: filters.group });
    if (filters.view !== 'all') f.push({ k: 'view', lab: 'Status', v: VIEW_LAB[filters.view] });
    if (filters.q.trim()) f.push({ k: 'q', lab: 'Search', v: '“' + filters.q.trim() + '”' });
    if (!f.length) return '';
    return f.map(function (x) {
      return '<span class="fchip">' + x.lab + ': <b>' + esc(x.v) + '</b><button data-clear="' + x.k + '" aria-label="Remove ' + x.lab.toLowerCase() + ' filter" title="Remove">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button></span>';
    }).join('') + (f.length > 1 ? '<button class="fclear" data-clear="all">Clear all</button>' : '');
  }
  function clearFilter(k) {
    if (k === 'all' || k === 'prio') filters.prio = 'all';
    if (k === 'all' || k === 'project') filters.project = 'all';
    if (k === 'all' || k === 'group') filters.group = 'all';
    if (k === 'all' || k === 'view') filters.view = 'all';
    if (k === 'all' || k === 'q') { filters.q = ''; document.getElementById('boardSearch').value = ''; }
    render();
  }
  document.getElementById('activeFilters').addEventListener('click', function (e) {
    var b = e.target.closest('[data-clear]'); if (b) clearFilter(b.dataset.clear);
  });

  function render() {
    var scoped = board.items.filter(inScope);
    var showProject = filters.project === 'all';
    var bands = filters.prio === 'all' ? PRIOS : PRIOS.filter(function (p) { return p.k === filters.prio; });

    // header
    var title = 'All items';
    if (filters.prio !== 'all') title = PLAB[filters.prio] + ' priority';
    else if (filters.project !== 'all') title = esc(filters.project);
    else if (filters.group !== 'all') title = esc(filters.group);
    document.getElementById('boardTitle').innerHTML = title;
    var af = activeFiltersHTML(), afEl = document.getElementById('activeFilters');
    afEl.innerHTML = af; afEl.hidden = !af;
    var done = scoped.filter(function (i) { return i.status === 'done'; }).length;
    document.getElementById('doneN').textContent = done;
    document.getElementById('totN').textContent = scoped.length;
    document.getElementById('leftN').textContent = scoped.length - done;
    var pct = scoped.length ? Math.round(done / scoped.length * 100) : 0;
    document.getElementById('barFill').style.width = pct + '%';
    document.getElementById('donePct').textContent = pct + '%';
    var gf = document.getElementById('groupFilter');
    document.getElementById('groupFilterLab').innerHTML = filters.group === 'all'
      ? '<span class="lab-long">All groups</span><span class="lab-short">Groups</span>' : esc(filters.group);
    gf.classList.toggle('on', filters.group !== 'all');
    gf.hidden = !allGroups().length;
    document.getElementById('stats').innerHTML = statsHTML(scoped);

    // layout
    boardEl.classList.toggle('compact', layout === 'compact');
    boardEl.classList.toggle('single', bands.length === 1);
    document.querySelectorAll('#layoutSw [data-layout]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.layout === layout));
    });

    if (!board.items.length) {
      boardEl.innerHTML = '<p class="empty">No items yet. Click <b>Add item</b> to create your first one.</p>';
    } else {
      boardEl.innerHTML = bands.map(function (p) { return bandHTML(p, showProject); }).join('');
    }

    renderNav();
    applyAccent();
    if (detailId) renderDetail();
  }

  /* ---------- sidebar ---------- */
  function renderNav() {
    var open = board.items.filter(notDone);
    document.getElementById('navBoardCount').textContent = open.length || '';

    document.getElementById('navPrios').innerHTML = PRIOS.map(function (p) {
      var n = open.filter(function (i) { return (i.prio || 'medium') === p.k; }).length;
      return '<button class="nav-item" data-nav="prio" data-v="' + p.k + '"' + (page === 'board' && filters.prio === p.k ? ' aria-current="page"' : '') + '>' +
        '<span class="nav-dot" style="--c:' + PCOLOR[p.k] + '"></span><span>' + p.name + '</span><span class="nav-count">' + (n || '') + '</span></button>';
    }).join('');

    var projs = projectOrder();
    document.getElementById('navProjects').innerHTML = projs.length ? projs.map(function (p) {
      var n = open.filter(function (i) { return (i.project || '(no project)') === p; }).length;
      var pk = projColor(p);
      return '<button class="nav-item" data-nav="project" data-v="' + esc(p) + '"' + (pk ? ' style="--acc:' + pcVar(pk) + '"' : '') +
        (page === 'board' && filters.project === p ? ' aria-current="page"' : '') + '>' +
        '<span class="nav-dot" style="--c:' + pcVar(projColor(p)) + '"></span><span>' + esc(p) + '</span><span class="nav-count">' + (n || '') + '</span></button>';
    }).join('') : '<p class="nav-empty">No projects yet</p>';

    var groups = allGroups();
    document.getElementById('navGroupsLabel').hidden = !groups.length;
    document.getElementById('navGroups').innerHTML = groups.map(function (g) {
      var n = open.filter(function (i) { return groupsOf(i).some(function (x) { return sameText(x, g); }); }).length;
      var cur = page === 'board' && filters.group !== 'all' && sameText(filters.group, g);
      return '<button class="nav-item" data-nav="group" data-v="' + esc(g) + '"' + (cur ? ' aria-current="page"' : '') + '>' +
        '<span class="nav-hash" aria-hidden="true">#</span><span>' + esc(g) + '</span><span class="nav-count">' + (n || '') + '</span></button>';
    }).join('');

    var allBoard = page === 'board' && filters.prio === 'all' && filters.project === 'all' && filters.group === 'all';
    setCurrent(document.getElementById('navBoard'), allBoard);
    setCurrent(document.getElementById('navSnips'), page === 'snippets');
  }
  function setCurrent(el, on) { if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); }

  document.getElementById('nav').addEventListener('click', function (e) {
    var b = e.target.closest('[data-nav]'); if (!b) return;
    var k = b.dataset.nav;
    if (k === 'snippets') { showPage('snippets'); }
    else {
      filters.prio = k === 'prio' ? b.dataset.v : 'all';
      filters.project = k === 'project' ? b.dataset.v : 'all';
      filters.group = k === 'group' ? b.dataset.v : 'all';
      showPage('board');
      render();
    }
    closeMenu();
  });

  var navCaret = document.getElementById('navCaret');
  function setNavOpen(on) {
    navCaret.setAttribute('aria-expanded', String(on));
    document.getElementById('navSub').classList.toggle('closed', !on);
    setPref('tb-nav', on ? 'open' : 'closed');
  }
  setNavOpen(pref('tb-nav', 'open') === 'open');
  navCaret.addEventListener('click', function () { setNavOpen(navCaret.getAttribute('aria-expanded') !== 'true'); });

  // Groups list in the sidebar: collapsed by default, remembers its state.
  var navGroupsToggle = document.getElementById('navGroupsToggle');
  function setGroupsOpen(on) {
    navGroupsToggle.setAttribute('aria-expanded', String(on));
    document.getElementById('navGroups').hidden = !on;
    setPref('tb-nav-groups', on ? 'open' : 'closed');
  }
  setGroupsOpen(pref('tb-nav-groups', 'closed') === 'open');
  navGroupsToggle.addEventListener('click', function () { setGroupsOpen(navGroupsToggle.getAttribute('aria-expanded') !== 'true'); });

  // mobile drawer
  var menuBtn = document.getElementById('menuBtn');
  function closeMenu() { appEl.classList.remove('menu-open'); menuBtn.setAttribute('aria-expanded', 'false'); }
  menuBtn.addEventListener('click', function () {
    var on = !appEl.classList.contains('menu-open');
    appEl.classList.toggle('menu-open', on); menuBtn.setAttribute('aria-expanded', String(on));
  });
  document.getElementById('scrim').addEventListener('click', closeMenu);

  /* ---------- theme ---------- */
  var themePref = pref('tb-theme', 'system');
  var darkMQ = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
  function applyTheme() {
    var dark = themePref === 'dark' || (themePref === 'system' && darkMQ && darkMQ.matches);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    document.querySelectorAll('#themeSw [data-theme-pref]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.themePref === themePref));
    });
  }
  document.getElementById('themeSw').addEventListener('click', function (e) {
    var b = e.target.closest('[data-theme-pref]'); if (!b) return;
    themePref = b.dataset.themePref; setPref('tb-theme', themePref); applyTheme();
  });
  if (darkMQ) {
    var onSys = function () { if (themePref === 'system') applyTheme(); };
    if (darkMQ.addEventListener) darkMQ.addEventListener('change', onSys); else if (darkMQ.addListener) darkMQ.addListener(onSys);
  }
  applyTheme();

  /* ---------- header controls ---------- */
  document.getElementById('layoutSw').addEventListener('click', function (e) {
    var b = e.target.closest('[data-layout]'); if (!b) return;
    layout = b.dataset.layout; setPref('tb-layout', layout); render();
  });
  // Group filter on the board: works alongside the priority/project/search filters.
  var groupFilterBtn = document.getElementById('groupFilter');
  groupFilterBtn.addEventListener('click', function () {
    if (popAnchor === groupFilterBtn) return closePop(true);
    var pool = board.items.filter(function (i) { return inScope(i, 'group') && notDone(i); });
    var html = '<button role="menuitemradio" data-g="" aria-checked="' + (filters.group === 'all') + '">All groups</button>';
    html += '<hr>' + allGroups().map(function (g) {
      var n = pool.filter(function (i) { return groupsOf(i).some(function (x) { return sameText(x, g); }); }).length;
      var on = filters.group !== 'all' && sameText(filters.group, g);
      return '<button role="menuitemradio" data-g="' + esc(g) + '" aria-checked="' + on + '"><span class="pop-hash">#</span>' + esc(g) +
        (n ? '<span class="pop-count">' + n + '</span>' : '') + '</button>';
    }).join('');
    openPop(groupFilterBtn, html, function (d) { filters.group = d.g || 'all'; render(); }, { matchWidth: true });
  });

  var boardSearch = document.getElementById('boardSearch');
  boardSearch.addEventListener('input', function () { filters.q = boardSearch.value; render(); });
  boardSearch.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && boardSearch.value) { e.stopPropagation(); boardSearch.value = ''; filters.q = ''; render(); }
  });
  document.getElementById('stats').addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]'); if (!b) return;
    filters.view = filters.view === b.dataset.view ? 'all' : b.dataset.view;
    render();
  });

  /* ---------- item changes (shown now, saved through the sync queue) ---------- */
  function patchItem(id, patch) {
    var it = itemById(id);
    change({ t: 'item.patch', m: 'PATCH', u: '/api/items/' + encodeURIComponent(id), b: patch, k: id, label: it ? it.title : '' });
  }
  function deleteItem(id) {
    var it = itemById(id);
    change({ t: 'item.del', m: 'DELETE', u: '/api/items/' + encodeURIComponent(id), k: id, label: it ? it.title : '' });
  }
  function confirmDelete(id) {
    var it = itemById(id); if (!it) return;
    confirmDialog({ title: 'Delete this item?', message: '“' + it.title + '” will be removed from the board.' })
      .then(function (ok) { if (ok) { closeDetail(); deleteItem(id); } });
  }

  /* ---------- popover menu ---------- */
  var popEl = document.getElementById('pop');
  var popAnchor = null, popHandler = null;
  // opts.matchWidth: at least as wide as the anchor (used by dropdowns).
  function openPop(anchor, html, handler, opts) {
    opts = opts || {};
    closePop();
    popEl.innerHTML = html; popEl.hidden = false;
    popAnchor = anchor; popHandler = handler;
    anchor.setAttribute('aria-expanded', 'true');
    var r = anchor.getBoundingClientRect();
    popEl.style.minWidth = opts.matchWidth ? r.width + 'px' : '';
    var pw = popEl.offsetWidth, ph = popEl.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
    var top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    popEl.style.left = left + 'px'; popEl.style.top = top + 'px';
    var start = popEl.querySelector('button[aria-checked="true"]') || popEl.querySelector('button');
    if (start) start.focus({ preventScroll: true });
  }
  function closePop(restoreFocus) {
    if (popEl.hidden) return false;
    var anchor = popAnchor;
    popEl.hidden = true; popEl.innerHTML = '';
    if (anchor) anchor.setAttribute('aria-expanded', 'false');
    popAnchor = null; popHandler = null;
    if (restoreFocus && anchor && document.contains(anchor)) anchor.focus({ preventScroll: true });
    return true;
  }
  popEl.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !popHandler) return;
    var h = popHandler; closePop(true); h(b.dataset);
  });
  // Keyboard: arrows / Home / End move, a letter jumps to the next match, Tab closes.
  popEl.addEventListener('keydown', function (e) {
    var btns = Array.prototype.slice.call(popEl.querySelectorAll('button'));
    var i = btns.indexOf(document.activeElement), next = -1;
    if (e.key === 'ArrowDown') next = (i + 1) % btns.length;
    else if (e.key === 'ArrowUp') next = (i - 1 + btns.length) % btns.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = btns.length - 1;
    else if (e.key === 'Tab') { closePop(true); e.preventDefault(); return; }
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      var k = e.key.toLowerCase();
      for (var n = 1; n <= btns.length; n++) {
        var b = btns[(i + n) % btns.length];
        if (b.textContent.trim().toLowerCase().indexOf(k) === 0) { next = (i + n) % btns.length; break; }
      }
    }
    if (next >= 0) { e.preventDefault(); btns[next].focus(); }
  });
  document.addEventListener('click', function (e) {
    if (!popEl.hidden && !popEl.contains(e.target) && e.target !== popAnchor && !(popAnchor && popAnchor.contains(e.target))) closePop();
  });
  window.addEventListener('resize', closePop);
  window.addEventListener('scroll', closePop, true);

  function statusMenu(cur) {
    return '<p class="pop-label">Status</p>' + STATUSES.map(function (s) {
      return '<button role="menuitemradio" data-s="' + s + '" aria-checked="' + (s === cur) + '"><span class="pd" style="--c:' + SCOLOR[s] + '"></span>' + SLAB[s] + '</button>';
    }).join('');
  }
  function moreMenu(it) {
    var pr = it.prio || 'medium';
    return '<button role="menuitem" data-a="open">Open</button><button role="menuitem" data-a="edit">Edit</button>' +
      '<hr><p class="pop-label">Priority</p>' + PRIOS.map(function (p) {
        return '<button role="menuitemradio" data-p="' + p.k + '" aria-checked="' + (p.k === pr) + '"><span class="pd" style="--c:' + PCOLOR[p.k] + '"></span>' + p.name + '</button>';
      }).join('') +
      '<hr><button role="menuitem" class="danger" data-a="del">Delete</button>';
  }

  /* ---------- styled dropdowns (#14) ----------
   * The native <select> stays in the DOM (hidden) and keeps holding the value,
   * so existing code can keep reading/writing sel.value. A button shows the
   * current choice and opens the shared popover as the list.
   */
  var SEL_CHEV = '<svg class="sel-chev" viewBox="0 0 24 24" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  function selDot(sel, v) {
    return sel.dataset.dots === 'prio' && PCOLOR[v] ? '<span class="pd" style="--c:' + PCOLOR[v] + '"></span>' : '';
  }
  function syncSelect(sel) {
    if (!sel._btn) return;
    var o = sel.options[sel.selectedIndex];
    sel._btn.innerHTML = '<span class="sel-val">' + selDot(sel, sel.value) + esc(o ? o.text : '') + '</span>' + SEL_CHEV;
  }
  function enhanceSelect(sel) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'sel-btn'; btn.id = sel.id + 'Btn';
    btn.setAttribute('aria-haspopup', 'menu'); btn.setAttribute('aria-expanded', 'false');
    sel.hidden = true; sel.tabIndex = -1;
    sel.parentNode.insertBefore(btn, sel.nextSibling);
    var lab = document.querySelector('label[for="' + sel.id + '"]'); if (lab) lab.htmlFor = btn.id;
    sel._btn = btn;
    function open() {
      if (popAnchor === btn) return closePop(true);
      var html = Array.prototype.map.call(sel.options, function (o) {
        return '<button role="menuitemradio" data-v="' + esc(o.value) + '" aria-checked="' + (o.value === sel.value) + '">' +
          selDot(sel, o.value) + esc(o.text) + '</button>';
      }).join('');
      openPop(btn, html, function (d) {
        sel.value = d.v; syncSelect(sel);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, { matchWidth: true });
    }
    btn.addEventListener('click', open);
    btn.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); }
    });
    syncSelect(sel);
  }
  var SELECT_IDS = ['mProj', 'mPrio', 'sLang'];
  SELECT_IDS.forEach(function (id) { enhanceSelect(document.getElementById(id)); });
  function syncSelects() { SELECT_IDS.forEach(function (id) { syncSelect(document.getElementById(id)); }); }

  /* ---------- suggestion list under a text field (#15) ----------
   * Replaces <datalist>, which Edge draws as a detached floating box.
   * multi = comma-separated field (tags): suggests for the last entry only.
   */
  function attachSuggest(input, getOptions, multi) {
    var box = document.createElement('div');
    box.className = 'suggest'; box.id = input.id + 'Sug'; box.hidden = true;
    box.setAttribute('role', 'listbox');
    input.parentNode.classList.add('has-suggest');
    input.parentNode.appendChild(box);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-expanded', 'false');
    input.setAttribute('aria-controls', box.id);
    var items = [], active = -1;

    function parts() { return input.value.split(','); }
    function query() { return (multi ? parts()[parts().length - 1] : input.value).trim().toLowerCase(); }
    function alreadyUsed() {
      return multi ? parts().slice(0, -1).map(function (s) { return s.trim().toLowerCase(); }) : [];
    }
    function highlight(o, q) {
      var i = q ? o.toLowerCase().indexOf(q) : -1;
      if (i < 0) return esc(o);
      return esc(o.slice(0, i)) + '<b>' + esc(o.slice(i, i + q.length)) + '</b>' + esc(o.slice(i + q.length));
    }
    function show() {
      var q = query(), used = alreadyUsed();
      items = getOptions().filter(function (o) {
        var l = o.toLowerCase();
        return l.indexOf(q) >= 0 && l !== q && used.indexOf(l) < 0;
      }).slice(0, 8);
      if (!items.length) return hide();
      active = -1;
      box.innerHTML = items.map(function (o, i) {
        return '<div class="sug" role="option" aria-selected="false" id="' + box.id + i + '" data-i="' + i + '">' + highlight(o, q) + '</div>';
      }).join('');
      box.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      input.removeAttribute('aria-activedescendant');
    }
    function hide() {
      box.hidden = true; box.innerHTML = ''; items = []; active = -1;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
    }
    function setActive(i) {
      active = i;
      Array.prototype.forEach.call(box.children, function (el, j) {
        el.classList.toggle('on', j === i); el.setAttribute('aria-selected', String(j === i));
      });
      input.setAttribute('aria-activedescendant', box.id + i);
      box.children[i].scrollIntoView({ block: 'nearest' });
    }
    function pick(i) {
      var v = items[i]; if (v == null) return;
      if (multi) {
        var keep = parts().slice(0, -1).map(function (s) { return s.trim(); }).filter(Boolean);
        keep.push(v);
        input.value = keep.join(', ') + ', ';
      } else {
        input.value = v;
      }
      hide(); input.focus();
    }
    input.addEventListener('input', show);
    input.addEventListener('focus', show);
    input.addEventListener('blur', hide);
    input.addEventListener('keydown', function (e) {
      if (box.hidden) { if (e.key === 'ArrowDown') { show(); e.preventDefault(); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % items.length); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + items.length) % items.length); }
      else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); pick(active); }
      else if (e.key === 'Escape') { e.stopPropagation(); hide(); } // close the list, not the window
      else if (e.key === 'Tab') hide();
    });
    // mousedown (not click) so the input keeps focus and doesn't blur first
    box.addEventListener('mousedown', function (e) {
      var el = e.target.closest('.sug'); if (!el) return;
      e.preventDefault(); pick(+el.dataset.i);
    });
  }
  function uniqueSorted(list) {
    var seen = {}, out = [];
    list.forEach(function (v) { var k = v.toLowerCase(); if (v && !seen[k]) { seen[k] = 1; out.push(v); } });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  // Groups are comma-separated, so suggest for the entry being typed (like tags).
  attachSuggest(document.getElementById('mGroup'), allGroups, true);
  attachSuggest(document.getElementById('sTags'), function () {
    var all = []; snippets.forEach(function (s) { all = all.concat(s.tags); });
    return uniqueSorted(all);
  }, true);

  /* ---------- confirm dialog (#16) ---------- */
  var confirmBg = document.getElementById('confirmBg');
  var confirmResolve = null, confirmReturnFocus = null;
  function confirmDialog(o) {
    if (confirmResolve) closeConfirm(false);
    document.getElementById('cTitle').textContent = o.title;
    document.getElementById('cMsg').textContent = o.message || '';
    document.getElementById('cOk').textContent = o.ok || 'Delete';
    confirmReturnFocus = document.activeElement;
    confirmBg.classList.add('open');
    document.getElementById('cOk').focus(); // immediately, so an Enter right away goes to Delete
    return new Promise(function (resolve) { confirmResolve = resolve; });
  }
  function closeConfirm(result) {
    if (!confirmResolve) return false;
    var resolve = confirmResolve; confirmResolve = null;
    confirmBg.classList.remove('open');
    if (confirmReturnFocus && document.contains(confirmReturnFocus)) confirmReturnFocus.focus({ preventScroll: true });
    resolve(result);
    return true;
  }
  document.getElementById('cOk').addEventListener('click', function () { closeConfirm(true); });
  document.getElementById('cCancel').addEventListener('click', function () { closeConfirm(false); });
  confirmBg.addEventListener('click', function (e) { if (e.target === confirmBg) closeConfirm(false); });
  // Enter confirms unless Cancel has focus (then Enter activates Cancel as usual).
  confirmBg.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && document.activeElement.id !== 'cCancel') { e.preventDefault(); closeConfirm(true); }
  });

  /* ---------- board interactions ---------- */
  boardEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    var card = e.target.closest('.card');
    if (btn) {
      var act = btn.dataset.act;
      if (act === 'band-add') return openAdd(btn.dataset.p);
      if (act === 'done-toggle') { openDone[btn.dataset.p] = !openDone[btn.dataset.p]; return render(); }
      if (act === 'group') {
        e.stopPropagation();
        var g = btn.dataset.g;
        filters.group = filters.group !== 'all' && sameText(filters.group, g) ? 'all' : g; // click again to clear
        return render();
      }
      if (!card) return;
      var id = card.dataset.id, it = itemById(id); if (!it) return;
      e.stopPropagation();
      if (act === 'done') {
        patchItem(id, { status: it.status === 'done' ? 'open' : 'done' });
      } else if (act === 'status') {
        if (popAnchor === btn) return closePop();
        openPop(btn, statusMenu(it.status || 'open'), function (d) { if (d.s && d.s !== it.status) patchItem(id, { status: d.s }); });
      } else if (act === 'more') {
        if (popAnchor === btn) return closePop();
        openPop(btn, moreMenu(it), function (d) {
          if (d.p) { if (d.p !== it.prio) patchItem(id, { prio: d.p }); }
          else if (d.a === 'open') openDetail(id);
          else if (d.a === 'edit') openEdit(id);
          else if (d.a === 'del') confirmDelete(id);
        });
      }
      return;
    }
    if (card) openDetail(card.dataset.id);
  });
  boardEl.addEventListener('keydown', function (e) {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('card')) {
      e.preventDefault(); openDetail(e.target.dataset.id);
    }
  });

  /* ---------- drag & drop between priority bands ---------- */
  var dragId = null;
  boardEl.addEventListener('dragstart', function (e) {
    var card = e.target.closest('.card'); if (!card) return;
    closePop();
    dragId = card.dataset.id; card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragId); } catch (_) {}
  });
  boardEl.addEventListener('dragend', function (e) {
    var card = e.target.closest('.card'); if (card) card.classList.remove('dragging');
    document.querySelectorAll('.band-body.drop-hot').forEach(function (b) { b.classList.remove('drop-hot'); });
    dragId = null;
  });
  boardEl.addEventListener('dragover', function (e) {
    var body = e.target.closest('.band-body'); if (!body || !dragId) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    document.querySelectorAll('.band-body.drop-hot').forEach(function (b) { if (b !== body) b.classList.remove('drop-hot'); });
    body.classList.add('drop-hot');
  });
  boardEl.addEventListener('dragleave', function (e) {
    var body = e.target.closest('.band-body');
    if (body && !body.contains(e.relatedTarget)) body.classList.remove('drop-hot');
  });
  boardEl.addEventListener('drop', function (e) {
    var body = e.target.closest('.band-body'); if (!body || !dragId) return;
    e.preventDefault();
    var np = body.dataset.band, it = itemById(dragId);
    if (it && np && it.prio !== np) patchItem(dragId, { prio: np });
  });

  /* ---------- expanded card (detail) ---------- */
  var detailBg = document.getElementById('detailBg');
  var detailEl = document.getElementById('detail');

  function renderDetail() {
    var it = itemById(detailId);
    if (!it) { closeDetail(); return; }
    var st = it.status || 'open', pr = it.prio || 'medium';
    detailEl.className = 'modal detail ' + pr;
    var h = '<div class="d-top"><div class="d-crumbs"><span class="d-prio">' + PLAB[pr] + '</span>';
    if (it.project) h += projChip(it.project);
    groupsOf(it).forEach(function (g) { h += '<span class="chip">' + esc(g) + '</span>'; });
    h += '</div><h2 id="dTitle">' + esc(it.title) + '</h2></div>';
    h += '<div class="d-body">';
    h += '<div class="d-section"><p class="d-label">Status</p><div class="d-status" role="group" aria-label="Status">' +
      STATUSES.map(function (s) { return '<button data-ds="' + s + '" data-s="' + s + '" aria-pressed="' + (s === st) + '">' + SLAB[s] + '</button>'; }).join('') + '</div></div>';
    h += '<div class="d-section"><p class="d-label">Description</p>' +
      (it.note ? '<p class="d-note">' + esc(it.note) + '</p>' : '<p class="d-note muted">No description yet. Click Edit to add one.</p>') + '</div>';
    var created = fmtDate(it.createdAt);
    if (created) h += '<p class="d-dates">Created ' + created + '</p>';
    h += '</div>';
    h += '<div class="d-foot"><button class="btn sm danger" data-dact="del">Delete</button><span class="grow"></span>' +
      '<button class="btn sm" data-dact="close">Close</button><button class="btn sm primary" data-dact="edit">Edit</button></div>';
    detailEl.innerHTML = h;
  }
  function openDetail(id) {
    detailId = id; renderDetail();
    detailBg.classList.add('open');
    setTimeout(function () { var b = detailEl.querySelector('[data-dact="close"]'); if (b) b.focus(); }, 30);
  }
  function closeDetail() {
    if (!detailBg.classList.contains('open')) return;
    detailBg.classList.remove('open');
    var id = detailId; detailId = null;
    var card = id && boardEl.querySelector('.card[data-id="' + id + '"]'); if (card) card.focus({ preventScroll: true });
  }
  detailBg.addEventListener('click', function (e) {
    if (e.target === detailBg) return closeDetail();
    var s = e.target.closest('[data-ds]');
    if (s && detailId) { var it = itemById(detailId); if (it && it.status !== s.dataset.ds) patchItem(detailId, { status: s.dataset.ds }); return; }
    var a = e.target.closest('[data-dact]'); if (!a) return;
    var id = detailId;
    if (a.dataset.dact === 'close') closeDetail();
    else if (a.dataset.dact === 'edit') { closeDetail(); openEdit(id); }
    else if (a.dataset.dact === 'del') confirmDelete(id);
  });

  /* ---------- add / edit modal ---------- */
  var modalBg = document.getElementById('modalBg');
  var mErr = document.getElementById('mErr');

  function fillProjectSelect(sel) {
    sel.innerHTML = board.projects.map(function (p) { return '<option>' + esc(p) + '</option>'; }).join('')
      || '<option value="">(add a project first)</option>';
  }
  function openAdd(prio) {
    editingId = null;
    document.getElementById('mTitle').textContent = 'New item';
    document.getElementById('mSave').textContent = 'Add to board';
    mErr.textContent = '';
    document.getElementById('mTitleIn').value = '';
    document.getElementById('mGroup').value = filters.group !== 'all' ? filters.group : '';
    document.getElementById('mNote').value = '';
    var sel = document.getElementById('mProj');
    fillProjectSelect(sel);
    if (filters.project !== 'all' && board.projects.indexOf(filters.project) >= 0) sel.value = filters.project;
    document.getElementById('mPrio').value = prio || (filters.prio !== 'all' ? filters.prio : 'medium');
    syncSelects();
    modalBg.classList.add('open');
    setTimeout(function () { document.getElementById('mTitleIn').focus(); }, 30);
  }
  function openEdit(id) {
    var it = itemById(id); if (!it) return;
    editingId = id;
    document.getElementById('mTitle').textContent = 'Edit item';
    document.getElementById('mSave').textContent = 'Save changes';
    mErr.textContent = '';
    document.getElementById('mTitleIn').value = it.title || '';
    fillProjectSelect(document.getElementById('mProj'));
    document.getElementById('mProj').value = it.project || '';
    document.getElementById('mPrio').value = it.prio || 'medium';
    document.getElementById('mGroup').value = it.group || '';
    document.getElementById('mNote').value = it.note || '';
    syncSelects();
    modalBg.classList.add('open');
    setTimeout(function () { document.getElementById('mTitleIn').focus(); }, 30);
  }
  function closeModal() { modalBg.classList.remove('open'); editingId = null; }

  document.getElementById('addBtn').addEventListener('click', function () { openAdd(); });
  document.getElementById('mCancel').addEventListener('click', closeModal);
  modalBg.addEventListener('click', function (e) { if (e.target === modalBg) closeModal(); });

  document.getElementById('mSave').addEventListener('click', function () {
    var title = document.getElementById('mTitleIn').value.trim();
    if (!title) { mErr.textContent = 'Give the item a title.'; document.getElementById('mTitleIn').focus(); return; }
    var payload = {
      title: title,
      project: document.getElementById('mProj').value,
      prio: document.getElementById('mPrio').value,
      group: document.getElementById('mGroup').value.trim(),
      note: document.getElementById('mNote').value.trim()
    };
    // if adding into a filtered-out priority/project/status, relax filters so it's visible
    if (!editingId) {
      if (filters.prio !== 'all' && filters.prio !== payload.prio) filters.prio = 'all';
      if (filters.project !== 'all' && filters.project !== payload.project) filters.project = 'all';
      if (filters.view !== 'all' && filters.view !== 'active') filters.view = 'all';
      if (filters.group !== 'all' && !groupsOf(payload).some(function (g) { return sameText(g, filters.group); })) filters.group = 'all';
      if (filters.q && !matchesSearch(payload)) { filters.q = ''; boardSearch.value = ''; }
    }
    if (editingId) {
      patchItem(editingId, payload);
    } else {
      // The id is made here so the new item can be shown (and changed) before it's saved.
      payload.id = 'i-' + rid();
      change({ t: 'item.add', m: 'POST', u: '/api/items', b: payload, k: payload.id, label: payload.title });
    }
    closeModal();
  });

  /* ---------- manage projects modal ---------- */
  var projBg = document.getElementById('projBg');
  var pErr = document.getElementById('pErr');

  function renderProjList() {
    var ul = document.getElementById('plist');
    if (!board.projects.length) { ul.innerHTML = '<li><span class="pn" style="color:var(--text-3)">No projects yet. Add one below.</span></li>'; return; }
    ul.innerHTML = board.projects.map(function (p) {
      var n = board.items.filter(function (i) { return i.project === p; }).length;
      var k = projColor(p);
      return '<li><button class="swatch-btn" data-color-for="' + esc(p) + '" aria-haspopup="menu" aria-expanded="false" ' +
             'aria-label="Colour for ' + esc(p) + ': ' + colorName(k) + '" title="Colour: ' + colorName(k) + '">' +
             '<span class="sw" style="--c:' + pcVar(k) + '"></span></button>' +
             '<span class="pn">' + esc(p) + '</span><span class="pcount">' + n + ' item' + (n === 1 ? '' : 's') + '</span>' +
             '<button class="prm" data-p="' + esc(p) + '">Remove</button></li>';
    }).join('');
  }

  // Palette popover shared by the project rows and the "Add a project" row.
  function openColorPicker(anchor, current, label, onPick) {
    if (popAnchor === anchor) return closePop(true);
    var html = '<p class="pop-label">' + esc(label) + '</p><div class="swatch-grid">' + PROJ_COLORS.map(function (c) {
      return '<button class="swatch" role="menuitemradio" data-color="' + c.k + '" aria-checked="' + (c.k === current) + '" ' +
        'aria-label="' + c.name + '" title="' + c.name + '"><span class="sw" style="--c:' + pcVar(c.k) + '"></span></button>';
    }).join('') + '</div>';
    openPop(anchor, html, function (d) { onPick(d.color || ''); });
  }

  // Change an existing project's colour: show it straight away, then save.
  function setProjectColor(name, k) {
    if (projColor(name) === k) return;
    change({ t: 'proj.color', m: 'PATCH', u: '/api/projects/' + encodeURIComponent(name), b: { color: k }, k: name, label: name });
  }
  document.getElementById('plist').addEventListener('click', function (e) {
    var b = e.target.closest('[data-color-for]'); if (!b) return;
    var name = b.dataset.colorFor;
    openColorPicker(b, projColor(name), 'Colour for ' + name, function (k) { setProjectColor(name, k); });
  });

  // Colour chosen for a project that hasn't been added yet.
  var newProjColor = '';
  var newColorBtn = document.getElementById('pNewColor');
  function syncNewColorBtn() {
    newColorBtn.querySelector('.sw').style.setProperty('--c', pcVar(newProjColor));
    newColorBtn.setAttribute('aria-label', 'Colour for the new project: ' + colorName(newProjColor));
    newColorBtn.title = 'Colour: ' + colorName(newProjColor);
  }
  newColorBtn.addEventListener('click', function () {
    openColorPicker(newColorBtn, newProjColor, 'Colour for new project', function (k) { newProjColor = k; syncNewColorBtn(); });
  });
  function openProj() { pErr.textContent = ''; document.getElementById('pNewIn').value = ''; renderProjList(); projBg.classList.add('open'); closeMenu(); setTimeout(function () { document.getElementById('pNewIn').focus(); }, 30); }
  function closeProj() { projBg.classList.remove('open'); }

  document.getElementById('manageProj').addEventListener('click', function (e) { e.stopPropagation(); openProj(); });
  document.getElementById('pClose').addEventListener('click', closeProj);
  projBg.addEventListener('click', function (e) { if (e.target === projBg) closeProj(); });

  function addProject() {
    var name = document.getElementById('pNewIn').value.trim();
    if (!name) { pErr.textContent = 'Type a project name.'; return; }
    if (name.length > 80) { pErr.textContent = 'Keep the name under 80 characters.'; return; }
    if (board.projects.some(function (p) { return p.toLowerCase() === name.toLowerCase(); })) {
      pErr.textContent = 'That project already exists.'; return;
    }
    document.getElementById('pNewIn').value = ''; pErr.textContent = '';
    var color = newProjColor;
    newProjColor = ''; syncNewColorBtn();
    change({ t: 'proj.add', m: 'POST', u: '/api/projects', b: { name: name, color: color }, k: name, label: name });
  }
  document.getElementById('pAdd').addEventListener('click', addProject);
  document.getElementById('pNewIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') addProject(); });

  document.getElementById('plist').addEventListener('click', function (e) {
    var b = e.target.closest('.prm'); if (!b) return;
    var name = b.dataset.p;
    var n = board.items.filter(function (i) { return i.project === name; }).length;
    var msg = n > 0
      ? '“' + name + '” will be removed from your project list. The ' + n + ' item' + (n === 1 ? '' : 's') + ' tagged with it will stay on the board, still labelled “' + name + '”.'
      : '“' + name + '” will be removed from your project list.';
    confirmDialog({ title: 'Remove this project?', message: msg, ok: 'Remove' }).then(function (ok) {
      if (!ok) return;
      if (filters.project === name) filters.project = 'all';
      change({ t: 'proj.del', m: 'DELETE', u: '/api/projects/' + encodeURIComponent(name), k: name, label: name });
    });
  });

  /* ---------- toast ---------- */
  var toastEl = null, toastT = null;
  function toast(msg, ok) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.toggle('ok', !!ok);
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, ok ? 1600 : 3200);
  }

  /* ==========================================================
   * Snippet library (two-pane)
   * ========================================================== */
  var snippets = [];
  var snipsLoaded = false;
  var snipFilter = { q: '', tag: 'all', type: 'all' };
  // Suggestions for "Used in"; anything else typed is kept too.
  var TYPE_PRESETS = ['Workflow function', 'Standalone function', 'Scheduled function', 'Custom button', 'Client script', 'Webhook'];
  function snipTypes() {
    var seen = {}, out = [];
    snippets.forEach(function (s) { var k = (s.type || '').toLowerCase(); if (k && !seen[k]) { seen[k] = 1; out.push(s.type); } });
    return out.sort(function (a, b) { return a.localeCompare(b); });
  }
  var selectedSnip = null;
  var editingSnip = null;
  var libEl = document.getElementById('lib');
  var snipsEl = document.getElementById('snips');
  var snipDetailEl = document.getElementById('snipDetail');
  var snipBg = document.getElementById('snipBg');
  var sErr = document.getElementById('sErr');
  var LANG_LABEL = { deluge: 'Deluge', javascript: 'JS', json: 'JSON', sql: 'SQL', python: 'Python', html: 'HTML', css: 'CSS', bash: 'Shell', plaintext: 'Text' };
  var HLJS_NAME = { deluge: 'deluge', javascript: 'javascript', json: 'json', sql: 'sql', python: 'python', html: 'xml', css: 'css', bash: 'bash' };

  // highlight.js has no Deluge grammar, so register a small one.
  function registerDeluge() {
    if (!window.hljs || hljs.getLanguage('deluge')) return;
    hljs.registerLanguage('deluge', function (hl) {
      return {
        name: 'Deluge',
        keywords: {
          keyword: 'if else for each in while return break continue void try catch throw invokeurl info alert ' +
                   'cancel submit openUrl sendmail insert into update delete fetch from where range sort by',
          type: 'string int bigint long decimal float bool boolean date datetime time map list collection file',
          literal: 'true false null',
          built_in: 'zoho input thisapp'
        },
        contains: [
          hl.C_LINE_COMMENT_MODE, hl.C_BLOCK_COMMENT_MODE,
          hl.QUOTE_STRING_MODE, hl.APOS_STRING_MODE, hl.C_NUMBER_MODE,
          { className: 'title.function', begin: /(?<=\.)[A-Za-z_]\w*(?=\s*\()/, relevance: 0 }
        ]
      };
    });
  }

  function highlight(code, lang) {
    var name = HLJS_NAME[lang];
    if (window.hljs && name) {
      registerDeluge();
      if (hljs.getLanguage(name)) {
        try { return hljs.highlight(code, { language: name, ignoreIllegals: true }).value; } catch (_) {}
      }
    }
    return esc(code);
  }

  function loadSnippets() {
    snipsLoaded = true; // set up front so concurrent callers don't double-fetch
    return api('GET', '/api/snippets').then(function (list) {
      writeCache('snips', list);
      snippets = list;
      applyPending('snip'); // changes not saved yet stay on screen
      renderSnippets();
    }).catch(function (e) {
      snipsLoaded = false; // try again next time the page is opened
      if (e.offline) {
        goOffline();
        if (snippets.length) return; // keep what's on screen
        var copy = readCache('snips');
        if (copy) { snippets = copy; applyPending('snip'); renderSnippets(); return; }
      }
      snipsEl.innerHTML = '<p class="empty">Could not load snippets.<br><br>' + esc(e.message) + '</p>';
    });
  }

  // Same clean-up the server does (lib/model.js), so a snippet looks the same
  // before and after it's saved. Updates `into` if given, else makes a new one.
  function snipTags(raw) {
    var out = [];
    String(raw || '').split(',').forEach(function (t) {
      t = t.replace(/[\r\n]+/g, ' ').trim().slice(0, 30).toLowerCase();
      if (t && out.indexOf(t) < 0 && out.length < 20) out.push(t);
    });
    return out;
  }
  function localSnippet(p, into) {
    var now = new Date().toISOString();
    var s = into || { id: p.id, created: now, title: '', language: 'deluge', type: '', tags: [], description: '', code: '' };
    ['title', 'language', 'type', 'description', 'code'].forEach(function (k) { if (k in p) s[k] = p[k]; });
    if ('tags' in p) s.tags = snipTags(p.tags);
    s.updated = now;
    return s;
  }
  function snipSlug(title) {
    return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'snippet';
  }

  function snipMatches(s) {
    if (snipFilter.tag !== 'all' && s.tags.indexOf(snipFilter.tag) < 0) return false;
    if (snipFilter.type !== 'all' && !sameText(s.type || '', snipFilter.type)) return false;
    var q = snipFilter.q.trim().toLowerCase();
    if (!q) return true;
    var hay = (s.title + '\n' + (s.type || '') + '\n' + s.description + '\n' + s.tags.join(' ') + '\n' + s.code).toLowerCase();
    return q.split(/\s+/).every(function (t) { return hay.indexOf(t) >= 0; });
  }
  function snipById(id) {
    for (var i = 0; i < snippets.length; i++) if (snippets[i].id === id) return snippets[i];
    return null;
  }

  function renderSnippets() {
    document.getElementById('navSnipCount').textContent = snippets.length || '';

    // "Used in" chips first (click again to clear), then tag chips, most-used first
    var types = snipTypes();
    if (snipFilter.type !== 'all' && !types.some(function (t) { return sameText(t, snipFilter.type); })) snipFilter.type = 'all';
    var chips = '';
    if (types.length) {
      chips += '<span class="tagrow-lab">Used in</span>' + types.map(function (t) {
        var n = snippets.filter(function (s) { return sameText(s.type || '', t); }).length;
        var on = snipFilter.type !== 'all' && sameText(snipFilter.type, t);
        return '<button class="tagbtn type" data-type="' + esc(t) + '" aria-pressed="' + on + '">' + esc(t) + ' <span class="c">' + n + '</span></button>';
      }).join('');
    }
    var counts = {};
    snippets.forEach(function (s) { s.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var tags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    if (snipFilter.tag !== 'all' && !counts[snipFilter.tag]) snipFilter.tag = 'all';
    if (tags.length) {
      chips += (types.length ? '<span class="tagrow-sep" aria-hidden="true"></span>' : '') + '<span class="tagrow-lab">Tags</span>';
      chips += '<button class="tagbtn" data-tag="all" aria-pressed="' + (snipFilter.tag === 'all') + '">All <span class="c">' + snippets.length + '</span></button>';
      tags.forEach(function (t) {
        chips += '<button class="tagbtn" data-tag="' + esc(t) + '" aria-pressed="' + (snipFilter.tag === t) + '">#' + esc(t) + ' <span class="c">' + counts[t] + '</span></button>';
      });
    }
    document.getElementById('tagFilters').innerHTML = chips;

    var vis = snippets.filter(snipMatches);
    if (!vis.some(function (s) { return s.id === selectedSnip; })) {
      selectedSnip = vis.length ? vis[0].id : null;
      libEl.classList.remove('show-detail');
    }

    if (!snippets.length) {
      snipsEl.innerHTML = '<p class="empty">No snippets yet.<br>Click <b>New snippet</b> to save your first one.</p>';
    } else if (!vis.length) {
      snipsEl.innerHTML = '<p class="empty">Nothing matches that search.</p>';
    } else {
      snipsEl.innerHTML = '<div role="listbox" aria-label="Snippets">' + vis.map(function (s) {
        return '<button class="sitem" role="option" data-sid="' + esc(s.id) + '" aria-selected="' + (s.id === selectedSnip) + '">' +
          '<span class="sitem-top"><span class="sitem-title">' + esc(s.title) + '</span><span class="lang">' + esc(LANG_LABEL[s.language] || s.language) + '</span></span>' +
          (s.type || s.tags.length ? '<span class="sitem-tags">' + (s.type ? '<span class="sitem-type">' + esc(s.type) + '</span>' : '') +
            s.tags.map(function (t) { return '#' + esc(t); }).join('  ') + '</span>' : '') +
          '</button>';
      }).join('') + '</div>';
    }
    renderSnipDetail();
  }

  function renderSnipDetail() {
    var s = snipById(selectedSnip);
    if (!s) {
      snipDetailEl.innerHTML = '<div class="sd-empty">' + ICON.code + '<p>' + (snippets.length ? 'Pick a snippet from the list.' : 'Your saved code will show up here.') + '</p></div>';
      return;
    }
    var lines = s.code.split('\n').length;
    var gutter = ''; for (var i = 1; i <= lines; i++) gutter += i + (i < lines ? '\n' : '');
    var h = '<div class="sd-head">';
    h += '<button class="btn sm sd-back" data-act="back">' + ICON.back + 'All snippets</button>';
    h += '<div class="sd-title"><h2>' + esc(s.title) + '</h2><div class="sd-sub"><span class="lang">' + esc(LANG_LABEL[s.language] || s.language) + '</span>' +
      (s.type ? '<button class="stype" data-act="type" data-type="' + esc(s.type) + '" title="Show only ' + esc(s.type) + ' snippets">' + esc(s.type) + '</button>' : '') +
      s.tags.map(function (t) { return '<button class="stag" data-act="tag" data-tag="' + esc(t) + '">#' + esc(t) + '</button>'; }).join('') + '</div></div>';
    h += '<div class="sd-acts"><button class="btn sm primary" data-act="copy">' + ICON.copy + 'Copy</button>' +
      '<button class="btn sm" data-act="sedit">Edit</button><button class="btn sm danger" data-act="sdel" aria-label="Delete snippet">Delete</button></div>';
    h += '</div>';
    if (s.description) h += '<p class="sd-desc">' + esc(s.description) + '</p>';
    h += '<div class="codebox"><div class="gutter" aria-hidden="true">' + gutter + '</div><pre><code class="hljs">' + highlight(s.code, s.language) + '</code></pre></div>';
    snipDetailEl.innerHTML = h;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(new Error('Copy failed')); }
      catch (e) { reject(e); }
      document.body.removeChild(ta);
    });
  }

  libEl.addEventListener('click', function (e) {
    var item = e.target.closest('.sitem');
    if (item) {
      selectedSnip = item.dataset.sid;
      libEl.classList.add('show-detail');
      snipsEl.querySelectorAll('.sitem').forEach(function (b) { b.setAttribute('aria-selected', String(b === item)); });
      renderSnipDetail();
      snipDetailEl.scrollTop = 0;
      return;
    }
    var btn = e.target.closest('[data-act]'); if (!btn) return;
    var act = btn.dataset.act;
    if (act === 'back') { libEl.classList.remove('show-detail'); return; }
    var s = snipById(selectedSnip); if (!s) return;
    if (act === 'copy') {
      copyText(s.code).then(function () { toast('Copied “' + s.title + '”', true); }, function () { toast('Could not copy. Select the code manually.'); });
    } else if (act === 'tag') {
      snipFilter.tag = btn.dataset.tag; renderSnippets();
    } else if (act === 'type') {
      snipFilter.type = btn.dataset.type; renderSnippets();
    } else if (act === 'sedit') {
      openSnip(s);
    } else if (act === 'sdel') {
      confirmDialog({ title: 'Delete this snippet?', message: '“' + s.title + '” will be removed from your code library.' }).then(function (ok) {
        if (ok) change({ t: 'snip.del', m: 'DELETE', u: '/api/snippets/' + encodeURIComponent(s.id), k: s.id, label: s.title });
      });
    }
  });

  document.getElementById('tagFilters').addEventListener('click', function (e) {
    var b = e.target.closest('.tagbtn'); if (!b) return;
    if (b.dataset.type) snipFilter.type = b.getAttribute('aria-pressed') === 'true' ? 'all' : b.dataset.type;
    else snipFilter.tag = b.dataset.tag;
    renderSnippets();
  });

  var searchEl = document.getElementById('snipSearch');
  searchEl.addEventListener('input', function () { snipFilter.q = searchEl.value; renderSnippets(); });

  function openSnip(s) {
    editingSnip = s ? s.id : null;
    document.getElementById('sTitle').textContent = s ? 'Edit snippet' : 'New snippet';
    sErr.textContent = '';
    document.getElementById('sTitleIn').value = s ? s.title : '';
    document.getElementById('sLang').value = s ? s.language : 'deluge';
    document.getElementById('sType').value = s ? (s.type || '') : (snipFilter.type !== 'all' ? snipFilter.type : '');
    document.getElementById('sTags').value = s ? s.tags.join(', ') : (snipFilter.tag !== 'all' ? snipFilter.tag : '');
    document.getElementById('sDesc').value = s ? s.description : '';
    document.getElementById('sCode').value = s ? s.code : '';
    syncSelects();
    snipBg.classList.add('open');
    setTimeout(function () { document.getElementById('sTitleIn').focus(); }, 30);
  }
  function closeSnip() { snipBg.classList.remove('open'); editingSnip = null; }

  // "Used in": suggest the common places plus any custom ones already used.
  attachSuggest(document.getElementById('sType'), function () { return uniqueSorted(TYPE_PRESETS.concat(snipTypes())); });

  document.getElementById('snipAdd').addEventListener('click', function () { openSnip(null); });
  document.getElementById('sCancel').addEventListener('click', closeSnip);
  snipBg.addEventListener('click', function (e) { if (e.target === snipBg) closeSnip(); });

  // Tab key inserts two spaces in the code box instead of leaving it.
  document.getElementById('sCode').addEventListener('keydown', function (e) {
    if (e.key !== 'Tab' || e.shiftKey) return;
    e.preventDefault();
    var ta = e.target, a = ta.selectionStart, b = ta.selectionEnd;
    ta.value = ta.value.slice(0, a) + '  ' + ta.value.slice(b);
    ta.selectionStart = ta.selectionEnd = a + 2;
  });

  document.getElementById('sSave').addEventListener('click', function () {
    var title = document.getElementById('sTitleIn').value.trim();
    var code = document.getElementById('sCode').value;
    if (!title) { sErr.textContent = 'Give the snippet a title.'; document.getElementById('sTitleIn').focus(); return; }
    if (!code.trim()) { sErr.textContent = 'Paste some code.'; document.getElementById('sCode').focus(); return; }
    var payload = {
      title: title,
      language: document.getElementById('sLang').value,
      type: document.getElementById('sType').value.trim(),
      tags: document.getElementById('sTags').value,
      description: document.getElementById('sDesc').value.trim(),
      code: code
    };
    if (editingSnip) {
      change({ t: 'snip.patch', m: 'PATCH', u: '/api/snippets/' + encodeURIComponent(editingSnip), b: payload, k: editingSnip, label: title });
    } else {
      // The id is made here so the new snippet can be shown (and changed) before it's saved.
      payload.id = snipSlug(title) + '-' + Math.random().toString(36).slice(2, 6);
      selectedSnip = payload.id;
      change({ t: 'snip.add', m: 'POST', u: '/api/snippets', b: payload, k: payload.id, label: title });
    }
    closeSnip();
  });

  /* ---------- global keys ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (closePop(true)) return;
      if (closeConfirm(false)) return;
      if (modalBg.classList.contains('open')) return closeModal();
      if (snipBg.classList.contains('open')) return closeSnip();
      if (projBg.classList.contains('open')) return closeProj();
      if (detailBg.classList.contains('open')) return closeDetail();
      if (appEl.classList.contains('menu-open')) return closeMenu();
    }
    // Shortcuts: "/" focuses the page's search, "N" adds a board item.
    // Ignored while typing, with a window open, or with Ctrl/Cmd/Alt held.
    var tag = (e.target.tagName || '').toLowerCase();
    var typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal-bg.open') || appEl.classList.contains('gated')) return;
    if (e.key === '/') { e.preventDefault(); (page === 'snippets' ? searchEl : boardSearch).focus(); }
    else if ((e.key === 'n' || e.key === 'N') && page === 'board') { e.preventDefault(); openAdd(); }
  });

  /* ==========================================================
   * Pages, session and sign-in gate
   * ========================================================== */
  var gateEl = document.getElementById('gate');

  function showPage(name) {
    page = name === 'snippets' ? 'snippets' : 'board';
    appEl.dataset.page = page;
    document.body.dataset.page = page;
    applyAccent(); // project colour only applies on the board
    document.getElementById('boardView').hidden = page !== 'board';
    document.getElementById('snippetsView').hidden = page !== 'snippets';
    document.getElementById('topTitle').textContent = page === 'snippets' ? 'Snippets' : 'Board';
    try { history.replaceState(null, '', page === 'snippets' ? '#snippets' : location.pathname); } catch (_) {}
    if (page === 'snippets' && !snipsLoaded) loadSnippets();
    closePop();
    renderNav();
  }

  function setGated(on) {
    appEl.classList.toggle('gated', on);
    gateEl.hidden = !on;
    if (on) {
      document.getElementById('boardView').hidden = true;
      document.getElementById('snippetsView').hidden = true;
    }
  }

  function gateLogin() {
    setGated(true);
    gateEl.innerHTML =
      '<div class="gate-card"><h2>Sign in</h2>' +
      '<p>Your board and snippet library live in a private GitHub repo that only you can see. ' +
      'Every change is a commit, so you get full history for free.</p>' +
      '<a class="btn primary" href="/auth/login">Sign in with GitHub</a></div>';
  }

  function gateSetup(s, notice) {
    setGated(true);
    var install = s.installUrl
      ? '<a href="' + esc(s.installUrl) + '" target="_blank" rel="noopener">Install the app</a> and choose <b>Only select repositories</b> → <code>' + esc(s.repo) + '</code>.'
      : 'Install this board’s GitHub App on <b>only</b> that repo (ask whoever runs this board for the install link).';
    gateEl.innerHTML =
      '<div class="gate-card"><h2>One-time setup</h2>' +
      '<p>Signed in as <b>@' + esc(s.user.login) + '</b>, but the board can’t reach <code>' + esc(s.repo) + '</code> yet.</p>' +
      '<ol>' +
      '<li><a href="' + esc(s.newRepoUrl) + '" target="_blank" rel="noopener">Create a private repo</a> named <code>' + esc(s.repo.split('/')[1]) + '</code>. Leave it empty.</li>' +
      '<li>' + install + '</li>' +
      '</ol>' +
      (notice ? '<p class="gate-msg" role="alert">' + esc(notice) + '</p>' : '') +
      '<div class="macts"><form method="post" action="/auth/logout"><button class="btn" type="submit">Sign out</button></form>' +
      '<button class="btn primary" id="gateRetry">I’ve done this, check again</button></div></div>';
    document.getElementById('gateRetry').addEventListener('click', function () { recheckSetup(s, this); });
  }

  // #17: give visible feedback instead of silently re-rendering the same card.
  function recheckSetup(prev, btn) {
    btn.disabled = true; btn.textContent = 'Checking…';
    var minWait = new Promise(function (r) { setTimeout(r, 600); }); // long enough to notice
    Promise.all([api('GET', '/api/session'), minWait]).then(function (res) {
      var s = res[0];
      if (!s.signedIn) return gateLogin();
      if (s.ready) return enterApp(s);
      gateSetup(s, 'Still can’t reach ' + s.repo + '. Check that the repo exists, is named exactly “' +
        s.repo.split('/')[1] + '”, and that the app is installed on it. Then try again.');
    }).catch(function (e) {
      gateSetup(prev, 'Couldn’t check right now: ' + e.message);
    });
  }

  function enterApp(s) {
    setGated(false);
    var gh = s.mode === 'github';
    // Changes waiting to be saved belong to this user (or to local mode).
    syncMode = s.mode;
    who = gh ? s.user.login.toLowerCase() : 'local';
    QKEY = 'tb-queue:' + who;
    // Remembered so the app can still open from the saved copy when offline.
    try { localStorage.setItem('tb-last-session', JSON.stringify(s)); } catch (_) {}
    syncPaused = false;
    readQueue();
    setSync(queue.length ? 'saving' : 'ok');
    document.getElementById('signOut').hidden = !gh;
    var av = document.getElementById('whoAvatar');
    av.hidden = !gh;
    document.getElementById('whoLocal').hidden = gh;
    document.getElementById('whoNote').hidden = gh;
    var repoA = document.getElementById('whoRepo');
    repoA.hidden = !gh;
    if (gh) {
      av.src = s.user.avatar || '';
      document.getElementById('whoName').textContent = '@' + s.user.login;
      repoA.textContent = s.repo;
      repoA.href = 'https://github.com/' + s.repo;
      if (s.repoPrivate === false) toast('Heads up: ' + s.repo + ' is PUBLIC. Make it private in its GitHub settings.');
    } else {
      document.getElementById('whoName').textContent = 'Local mode';
    }
    snipsLoaded = false;
    showPage(location.hash === '#snippets' ? 'snippets' : 'board');
    loadBoard();
    if (!snipsLoaded) loadSnippets(); // for the sidebar count
    flush(); // send anything left over from last time (or from before signing in again)
  }

  var bootT = null;
  function boot() {
    clearTimeout(bootT);
    api('GET', '/api/session').then(function (s) {
      if (!s.signedIn) return gateLogin();
      if (!s.ready) return gateSetup(s);
      enterApp(s);
    }).catch(function (e) {
      // Already showing the board (e.g. checking the session after a failed
      // save): keep it on screen, the sync label shows what's wrong.
      if (boardLoaded) { bootT = setTimeout(boot, 10000); return; }
      // Offline: open as the last signed-in user, from the saved copy.
      // Saving waits until the session can be checked again.
      var last = null;
      try { last = JSON.parse(localStorage.getItem('tb-last-session') || 'null'); } catch (_) {}
      if (e.offline && last && last.ready) { enterApp(last); return; }
      boardEl.innerHTML = '<p class="empty">' + (e.offline
        ? 'Can’t connect right now.<br>' + esc(e.message)
        : 'Could not start the board.<br>' + esc(e.message)) + '<br><br>Trying again…</p>';
      bootT = setTimeout(boot, 5000);
    });
  }

  // Signing out: don't leave a copy of the board behind in this browser.
  // (Covers the sidebar button and the one on the setup screen.)
  document.addEventListener('submit', function (e) {
    if (/\/auth\/logout$/.test(e.target.getAttribute('action') || '')) clearCaches();
  });

  /* ---------- go ---------- */
  boot();
})();
