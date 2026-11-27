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
  // Same stages, in order, as the server. Activities are the suggested groups.
  var STAGES = [
    { k: 'implementation', name: 'Implementation', acts: ['Development', 'Configuration'] },
    { k: 'golive', name: 'Go Live', acts: ['Training', 'Customer Testing', 'Defect Resolution'] },
    { k: 'acceptance', name: 'Acceptance', acts: ['Final Review', 'Project Closure'] },
    { k: 'hypercare', name: 'Hypercare', acts: ['User Onboarding', 'Support Takeover'] }
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
    steps: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><polyline points="8 12 11 15 16 9"/></svg>',
    link:  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>',
    archive: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9M10 13h4"/></svg>',
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
  // Archived items and closed projects: null until the Archive page is first opened.
  var archive = null;
  var archLoaded = false;
  var archFilter = { q: '', project: 'all', group: 'all', stage: 'all' };
  var detailArchId = null; // archived item shown (read-only) in the popup

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
  var archTouched = false;      // an archive change was sent: reload the archive after

  function rid() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }
  function readQueue() {
    try { var q = JSON.parse(localStorage.getItem(QKEY) || '[]'); queue = Array.isArray(q) ? q : []; }
    catch (_) { /* storage blocked: keep what's in memory */ }
  }
  function writeQueue() { try { localStorage.setItem(QKEY, JSON.stringify(queue)); } catch (_) {} }
  function isSnipOp(op) { return op.t.indexOf('snip.') === 0; }
  function isArchOp(op) { return op.t.indexOf('arch.') === 0 || op.t === 'proj.close' || op.t === 'proj.reopen' || op.t === 'proj.stage'; }

  // Apply a change to what's on screen. Used when the change is made, and
  // again after every reload for changes that haven't been saved yet.
  function applyOp(op, scope) {
    var b = op.b || {};
    switch (op.t) {
      case 'item.add':
        if (!itemById(b.id)) {
          var added = Object.assign({ status: 'open', createdAt: new Date().toISOString() }, b);
          if (added.status === 'done') added.doneAt = added.createdAt;
          if (!added.stage || !added.project) delete added.stage;
          board.items.push(added);
        }
        break;
      case 'item.batch':
        (b.items || []).forEach(function (n) {
          if (itemById(n.id)) return;
          var bi = Object.assign({ status: 'open', createdAt: new Date().toISOString() }, n);
          if (bi.project) bi.stage = projStage(bi.project); else delete bi.stage;
          board.items.push(bi);
        });
        break;
      case 'item.patch':
        var it = itemById(op.k);
        if (it) {
          var wasDone = it.status === 'done';
          Object.assign(it, b);
          if (!it.stage || !it.project) delete it.stage;
          // Same as the server: doneAt is set on the way into done, dropped on the way out.
          if (b.status === 'done' && !wasDone) it.doneAt = new Date().toISOString();
          else if (b.status && b.status !== 'done') delete it.doneAt;
        }
        break;
      case 'item.del':
        board.items = board.items.filter(function (i) { return i.id !== op.k; });
        break;
      case 'sub.add':
        var sit = itemById(op.k);
        if (sit) {
          if (!sit.subtasks) sit.subtasks = [];
          if (!sit.subtasks.some(function (x) { return x.id === b.id; })) sit.subtasks.push({ id: b.id, text: b.text, done: false });
        }
        break;
      case 'sub.patch':
        var pit = itemById(op.k);
        var pst = pit && (pit.subtasks || []).filter(function (x) { return x.id === op.sk; })[0];
        if (pst) Object.assign(pst, b);
        break;
      case 'sub.del':
        var dit = itemById(op.k);
        if (dit && dit.subtasks) {
          dit.subtasks = dit.subtasks.filter(function (x) { return x.id !== op.sk; });
          if (!dit.subtasks.length) delete dit.subtasks;
        }
        break;
      case 'link.add':
        var lit = itemById(op.k);
        if (lit) {
          if (!lit.snippets) lit.snippets = [];
          if (lit.snippets.indexOf(op.sid) < 0) lit.snippets.push(op.sid);
        }
        break;
      case 'link.del':
        var uit = itemById(op.k);
        if (uit && uit.snippets) {
          uit.snippets = uit.snippets.filter(function (x) { return x !== op.sid; });
          if (!uit.snippets.length) delete uit.snippets;
        }
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
        if (board.projectStages) delete board.projectStages[op.k];
        break;
      case 'arch.add':
        moveToArchive(op.snap, b.ids, null, scope);
        break;
      case 'proj.close':
        moveToArchive(op.snap, null, op.k, scope);
        break;
      case 'proj.stage':
        moveStage(op, scope);
        break;
      case 'arch.restore':
        moveToBoard(op.snap, b.ids, null, scope);
        break;
      case 'proj.reopen':
        moveToBoard(op.snap, null, op.k, scope);
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
  // Archive changes carry a copy of the items they move (op.snap), so they can be
  // shown on the Archive page even when it was loaded after the change was made.
  // scope: 'board' or 'archive' to touch only that side (used when re-applying
  // queued changes to a freshly loaded copy); otherwise both.
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function archItemById(id) {
    var list = archive ? archive.items : [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }
  function moveToArchive(snap, ids, closing, scope) {
    snap = snap || { items: [], colors: {} };
    var gone = {};
    (ids || []).forEach(function (id) { gone[id] = true; });
    snap.items.forEach(function (it) { gone[it.id] = true; });
    if (closing) board.items.forEach(function (it) { if (it.project === closing) gone[it.id] = true; });
    if (scope !== 'archive') {
      board.items = board.items.filter(function (it) { return !gone[it.id]; });
      if (closing) {
        board.projects = board.projects.filter(function (p) { return p !== closing; });
        if (board.projectColors) delete board.projectColors[closing];
        if (board.projectStages) delete board.projectStages[closing];
      }
    }
    if (archive && scope !== 'board') {
      snap.items.forEach(function (it) { if (!archItemById(it.id)) archive.items.push(clone(it)); });
      if (closing && !archive.projects.some(function (p) { return p.name === closing; })) {
        var crec = { name: closing, color: (snap.colors && snap.colors[closing]) || '', closedAt: new Date().toISOString() };
        if (snap.stages && snap.stages[closing]) crec.stage = snap.stages[closing];
        archive.projects.push(crec);
      }
    }
  }
  function moveToBoard(snap, ids, reopen, scope) {
    snap = snap || { items: [], colors: {} };
    var names = snap.items.map(function (it) { return it.project; });
    if (reopen) names.push(reopen);
    if (scope !== 'archive') {
      snap.items.forEach(function (src) {
        if (itemById(src.id)) return;
        var it = clone(src); delete it.archivedAt;
        board.items.push(it);
      });
      names.forEach(function (name) {
        if (!name || board.projects.indexOf(name) >= 0) return;
        board.projects.push(name);
        var c = snap.colors && snap.colors[name];
        if (c) { board.projectColors = Object.assign({}, board.projectColors); board.projectColors[name] = c; }
        var sg = snap.stages && snap.stages[name];
        if (sg && sg !== STAGES[0].k) { board.projectStages = Object.assign({}, board.projectStages); board.projectStages[name] = sg; }
      });
    }
    if (archive && scope !== 'board') {
      var gone = {};
      snap.items.forEach(function (it) { gone[it.id] = true; });
      archive.items = archive.items.filter(function (it) { return !gone[it.id] && !(reopen && it.project === reopen); });
      archive.projects = archive.projects.filter(function (p) { return names.indexOf(p.name) < 0; });
    }
  }
  // Moving a project to another stage: items without a stage of their own keep the
  // old one, done items from earlier stages (op.snap.items) go to the archive.
  function moveStage(op, scope) {
    var name = op.k, snap = op.snap || { items: [], colors: {} };
    if (scope !== 'archive' && board.projects.indexOf(name) >= 0) {
      board.items.forEach(function (it) { if (it.project === name && !it.stage) it.stage = snap.from; });
      board.projectStages = Object.assign({}, board.projectStages);
      if (op.b.stage === STAGES[0].k) delete board.projectStages[name]; else board.projectStages[name] = op.b.stage;
    }
    moveToArchive(snap, null, null, scope);
  }
  function applyPending(kind) {
    queue.forEach(function (op) {
      if (kind === 'arch') { if (isArchOp(op)) applyOp(op, 'archive'); }
      else if ((kind === 'snip') === isSnipOp(op)) applyOp(op, kind === 'board' ? 'board' : undefined);
    });
  }

  // Make a change: show it now, save it in the background.
  function change(op) {
    op.id = rid(); op.tries = 0;
    applyOp(op);
    if (isSnipOp(op)) afterSnipsChange();
    else {
      render(); if (projBg.classList.contains('open')) renderProjList();
      if (isArchOp(op) && archive) renderArchive();
    }
    readQueue(); // pick up anything another tab queued
    queue.push(op); writeQueue();
    flush();
  }

  function dropMessage(op, err) {
    var what = op.label ? '“' + op.label + '”' : 'that change';
    if (op.t === 'item.patch' && /not found/i.test(err)) return what + ' was deleted somewhere else, so your change wasn’t saved.';
    if (op.t.indexOf('link.') === 0 && /not found/i.test(err)) return what + ' wasn’t linked because its item or snippet was deleted somewhere else.';
    if (op.t.indexOf('sub.') === 0 && /not found/i.test(err)) return what + ' wasn’t saved because its item or step was deleted somewhere else.';
    if (op.t === 'snip.patch' && /not found/i.test(err)) return what + ' was deleted somewhere else, so your change wasn’t saved.';
    if (op.t === 'proj.close' && /no longer exists/i.test(err)) return 'Project ' + what + ' was removed somewhere else, so it wasn’t closed.';
    if (op.t === 'proj.reopen' && /not in the archive/i.test(err)) return 'Project ' + what + ' is no longer in the archive, so it wasn’t reopened.';
    if (op.t === 'proj.stage' && /no longer exists/i.test(err)) return 'Project ' + what + ' was removed somewhere else, so it wasn’t moved to another stage.';
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
      if (isArchOp(op)) archTouched = true;
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
      if (archTouched) { archTouched = false; if (archive) loadArchive(); }
    }, function (e) {
      flushing = false;
      if (e.kind === 'auth') { syncPaused = true; setSync('pending'); boot(); return; }
      setSync(e.kind === 'offline' && navigator.onLine === false ? 'offline' : 'pending');
      if (!failing) toastIfFree((syncMode === 'github' ? 'Couldn’t save to GitHub' : 'Couldn’t save') + '. Your changes are kept and will be retried.');
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
        if (archive) loadArchive();
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
    if (!failing) { failing = true; toastIfFree('You’re offline. Showing your last saved copy; changes will sync when you’re back.'); }
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
  /* ---------- project stages ---------- */
  function stageIdx(k) {
    for (var i = 0; i < STAGES.length; i++) if (STAGES[i].k === k) return i;
    return -1;
  }
  function stageName(k) { var i = stageIdx(k); return i < 0 ? '' : STAGES[i].name; }
  // A project's current stage; no entry means Implementation.
  function projStage(name) {
    var k = board.projectStages && board.projectStages[name];
    return stageIdx(k) >= 0 ? k : STAGES[0].k;
  }
  // An item's stage: its own, or else its project's current one ('' without a project).
  function itemStage(it) {
    if (!it.project) return '';
    return stageIdx(it.stage) >= 0 ? it.stage : projStage(it.project);
  }
  function stageChip(k, tip) {
    return '<span class="stagechip" title="' + esc(tip + ': ' + stageName(k)) + '">' + esc(stageName(k)) + '</span>';
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
  function projChip(p, color) {
    var k = color == null ? projColor(p) : color;
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
  function stepsDone(it) { return (it.subtasks || []).filter(function (s) { return s.done; }).length; }
  function matchesSearch(it) {
    var q = filters.q.trim().toLowerCase();
    if (!q) return true;
    var hay = [it.title, it.note, it.group, it.project].concat((it.subtasks || []).map(function (s) { return s.text; })).join('\n').toLowerCase();
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
    // Items left behind in an earlier stage say so; current-stage items stay clean.
    if (it.project && stageIdx(itemStage(it)) < stageIdx(projStage(it.project))) h += stageChip(itemStage(it), 'From an earlier stage');
    groupsOf(it).forEach(function (g) {
      var on = filters.group !== 'all' && sameText(g, filters.group);
      h += '<button class="chip grp' + (on ? ' on' : '') + '" data-act="group" data-g="' + esc(g) + '" aria-pressed="' + on + '" title="' +
        (on ? 'Stop filtering by ' : 'Show only ') + esc(g) + '">' + esc(g) + '</button>';
    });
    var steps = it.subtasks || [];
    if (steps.length) {
      var sdone = stepsDone(it), label = sdone + ' of ' + steps.length + ' steps done';
      h += '<span class="steps' + (sdone === steps.length ? ' all' : '') + '" title="' + label + '" aria-label="' + label + '">' +
        ICON.steps + sdone + '/' + steps.length + '</span>';
    }
    var links = it.snippets || [];
    if (links.length) {
      var llabel = plural(links.length, 'linked snippet', 'linked snippets');
      h += '<span class="links" title="' + llabel + '" aria-label="' + llabel + '">' + ICON.link + links.length + '</span>';
    }
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
    archDoneBtn.hidden = !done;
    document.getElementById('archDoneLab').innerHTML = '<span class="lab-long">Archive ' + done + ' done</span><span class="lab-short">Archive ' + done + '</span>';
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

    renderStageBar();
    renderNav();
    applyAccent();
    if (detailId) renderDetail();
    if (page === 'snippets') renderSnippets(); // "Used for" reads from the board
  }

  /* ---------- stage track (board filtered to one project) ---------- */
  var stageBarEl = document.getElementById('stageBar');
  function renderStageBar() {
    var name = filters.project;
    if (name === 'all' || name === '(no project)' || board.projects.indexOf(name) < 0) {
      stageBarEl.hidden = true; stageBarEl.innerHTML = ''; return;
    }
    var cur = stageIdx(projStage(name));
    var h = '<div class="stage-track" role="group" aria-label="Stage of ' + esc(name) + '">';
    STAGES.forEach(function (s, i) {
      var cls = i < cur ? 'done' : i === cur ? 'cur' : 'todo';
      h += '<button type="button" class="stage-seg ' + cls + '" data-stage="' + s.k + '"' +
        (i === cur ? ' aria-current="step" aria-label="' + s.name + ' (current stage)"'
          : ' title="' + (i < cur ? 'Move back to ' : 'Move to ') + s.name + '"') + '>' +
        (i < cur ? ICON.check : '') + '<span>' + s.name + '</span></button>';
    });
    h += '</div>';
    var last = cur === STAGES.length - 1;
    h += '<button type="button" class="btn primary sm stage-next" data-stage-next="1">' +
      (last ? 'Close project' : 'Move to ' + STAGES[cur + 1].name) + '</button>';
    var psn = projectSnippets(name);
    if (psn.length) {
      h += '<button type="button" class="btn sm stage-snips" data-snips="1" aria-haspopup="menu" aria-expanded="false" title="Snippets linked to ' + esc(name) + '">' +
        ICON.code + 'Snippets <span class="c">' + psn.length + '</span></button>';
    }
    stageBarEl.innerHTML = h;
    stageBarEl.hidden = false;
    // On a narrow screen the track scrolls sideways: keep the current stage in view.
    var tr = stageBarEl.querySelector('.stage-track'), seg = stageBarEl.querySelector('.stage-seg.cur');
    if (tr.scrollWidth > tr.clientWidth) tr.scrollLeft = Math.max(0, seg.offsetLeft - 40);
  }
  stageBarEl.addEventListener('click', function (e) {
    var name = filters.project;
    var sb = e.target.closest('[data-snips]');
    if (sb) {
      if (popAnchor === sb) return closePop(true);
      var html = projectSnippets(name).map(function (r) {
        var how = [];
        if (r.direct) how.push('project');
        if (r.items) how.push(plural(r.items, 'item', 'items'));
        return '<button role="menuitem" data-sid="' + esc(r.s.id) + '"><span class="pp-t">' + esc(r.s.title) + '</span>' +
          '<span class="lang">' + esc(LANG_LABEL[r.s.language] || r.s.language) + '</span><span class="pp-how">' + how.join(' + ') + '</span></button>';
      }).join('');
      if (html) openPop(sb, '<p class="pop-label">Snippets for ' + esc(name) + '</p>' + html, function (d) { if (d.sid) openSnippetPage(d.sid); });
      return;
    }
    if (e.target.closest('[data-stage-next]')) {
      var cur = stageIdx(projStage(name));
      if (cur === STAGES.length - 1) closeProject(name); else moveProjectStage(name, STAGES[cur + 1].k);
      return;
    }
    var seg = e.target.closest('[data-stage]');
    if (seg) moveProjectStage(name, seg.dataset.stage);
  });
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }
  function moveProjectStage(name, key) {
    var from = stageIdx(projStage(name)), to = stageIdx(key);
    if (to < 0 || to === from || board.projects.indexOf(name) < 0) return;
    var label = STAGES[to].name, mine = board.items.filter(function (i) { return i.project === name; });
    var title, msg, toArchive = [];
    if (to < from) {
      title = 'Move ' + name + ' back to ' + label + '?';
      msg = 'Nothing is archived. New items will go into ' + label + '.';
    } else {
      toArchive = mine.filter(function (i) { return i.status === 'done' && stageIdx(itemStage(i)) < to; });
      var n = toArchive.length, m = mine.filter(notDone).length;
      title = 'Move ' + name + ' to ' + label + '?';
      msg = (n ? plural(n, 'done item moves', 'done items move') + ' to the Archive.' : 'No done items to archive.') + ' ' +
        (m ? plural(m, 'unfinished item stays', 'unfinished items stay') + ' on the board.' : 'No unfinished items.');
    }
    confirmDialog({ title: title, message: msg, ok: 'Move', plain: true }).then(function (ok) {
      if (!ok) return;
      var now = new Date().toISOString();
      change({ t: 'proj.stage', m: 'POST', u: '/api/projects/' + encodeURIComponent(name) + '/stage', b: { stage: key }, k: name, label: name,
        snap: { from: projStage(name), colors: {}, items: toArchive.map(function (i) { var c = clone(i); c.archivedAt = now; c.stage = itemStage(i); return c; }) } });
      toast(name + ' moved to ' + label, true);
    });
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
        '<span class="nav-dot" style="--c:' + pcVar(projColor(p)) + '"></span><span class="nav-name">' + esc(p) +
        (board.projects.indexOf(p) >= 0 ? '<span class="nav-stage"> · ' + stageName(projStage(p)) + '</span>' : '') +
        '</span><span class="nav-count">' + (n || '') + '</span></button>';
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
    setCurrent(document.getElementById('navArchive'), page === 'archive');
  }
  function setCurrent(el, on) { if (on) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current'); }

  document.getElementById('nav').addEventListener('click', function (e) {
    var b = e.target.closest('[data-nav]'); if (!b) return;
    var k = b.dataset.nav;
    if (k === 'snippets' || k === 'archive') { showPage(k); }
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
  // Only the fields that actually change are sent. Afterwards the message
  // offers Undo, which sends the old values back as a change of its own.
  var ITEM_DEFAULTS = { status: 'open', prio: 'medium', project: '', group: '', note: '' };
  function patchItem(id, patch, undoing) {
    var it = itemById(id);
    if (!it) { if (undoing) toast('That item no longer exists, so there’s nothing to undo.'); return; }
    var diff = {}, before = {}, any = false;
    Object.keys(patch).forEach(function (k) {
      var old = it[k] == null ? (ITEM_DEFAULTS[k] || '') : it[k];
      if (patch[k] !== old) { diff[k] = patch[k]; before[k] = old; any = true; }
    });
    if (!any) return;
    var title = it.title;
    change({ t: 'item.patch', m: 'PATCH', u: '/api/items/' + encodeURIComponent(id) + (undoing ? '?undo=1' : ''), b: diff, k: id, label: title });
    if (undoing) return toast('Change undone', true);
    toast(changeText(it.title, diff, it), false, function () { patchItem(id, before, true); });
  }
  function changeText(title, diff, it) {
    var t = '“' + (title.length > 40 ? title.slice(0, 39) + '…' : title) + '” ';
    var keys = Object.keys(diff);
    // The stage follows a project change, so it isn't a change of its own then.
    if (diff.project != null && keys.length === 2 && 'stage' in diff) keys = ['project'];
    if (keys.length > 1 || keys[0] === 'title') return t.replace(/ $/, '') + ' updated';
    if (keys[0] === 'status') return t + (diff.status === 'done' ? 'marked done' : 'moved to ' + SLAB[diff.status]);
    if (keys[0] === 'prio') return t + 'set to ' + PLAB[diff.prio] + ' priority';
    if (keys[0] === 'project') return t + (diff.project ? 'moved to ' + diff.project : 'removed from its project');
    if (keys[0] === 'stage') return t + 'moved to ' + stageName(diff.stage || projStage(it.project)) + ' stage';
    return t + 'updated';
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
      '<hr><button role="menuitem" data-a="archive">Archive</button><button role="menuitem" class="danger" data-a="del">Delete</button>';
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
  var SELECT_IDS = ['mProj', 'mStage', 'mPrio', 'qaProj', 'qaPrio', 'sLang', 'archProj', 'archStage', 'archGrp', 'snipType', 'snipProj'];
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
  // In a project, the activities of the chosen stage come first.
  function groupSuggestions(project, stage) {
    if (project === undefined) { project = document.getElementById('mProj').value; stage = document.getElementById('mStage').value; }
    var i = project ? stageIdx(stage) : -1;
    return i < 0 ? allGroups() : STAGES[i].acts.concat(allGroups().filter(function (g) {
      return !STAGES[i].acts.some(function (a) { return sameText(a, g); });
    }));
  }
  attachSuggest(document.getElementById('mGroup'), groupSuggestions, true);
  attachSuggest(document.getElementById('qaGroup'), function () {
    var p = document.getElementById('qaProj').value;
    return groupSuggestions(p, p ? projStage(p) : '');
  }, true);
  attachSuggest(document.getElementById('sProjects'), function () { return board.projects; }, true);
  attachSuggest(document.getElementById('sTags'), function () {
    var all = []; snippets.forEach(function (s) { all = all.concat(s.tags); });
    return uniqueSorted(all);
  }, true);

  /* ---------- confirm dialog (#16) ---------- */
  var confirmBg = document.getElementById('confirmBg');
  var TRASH_ICON = confirmBg.querySelector('.c-ico').innerHTML;
  var confirmResolve = null, confirmReturnFocus = null;
  function confirmDialog(o) {
    if (confirmResolve) closeConfirm(false);
    document.getElementById('cTitle').textContent = o.title;
    document.getElementById('cMsg').textContent = o.message || '';
    document.getElementById('cOk').textContent = o.ok || 'Delete';
    // Moving things to the Archive isn't destructive: no red button or bin icon.
    document.getElementById('cOk').className = 'btn ' + (o.plain ? 'primary' : 'danger-solid');
    confirmBg.querySelector('.c-ico').classList.toggle('plain', !!o.plain);
    confirmBg.querySelector('.c-ico').innerHTML = o.plain ? ICON.archive : TRASH_ICON;
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
          else if (d.a === 'archive') archiveOne(id);
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

  /* ---------- picker: a search box over a short list ----------
   * Used to link snippets to items and items to snippets, and for "More tags".
   * Lives on the page (not inside a popup), so it survives the popup being
   * rebuilt after each pick. Focus stays in the search box; the arrow keys move
   * through the list (aria-activedescendant). o: { label, placeholder, empty,
   * rows(q) -> [{ id, html }], onPick(id), keep (stay open after a pick),
   * refocus() -> element to focus when it closes }. */
  var pkEl = document.createElement('div');
  pkEl.className = 'picker'; pkEl.hidden = true;
  pkEl.innerHTML = '<input type="text" class="picker-in" role="combobox" aria-autocomplete="list" aria-expanded="true" aria-controls="pickerList" autocomplete="off">' +
    '<div class="picker-list" id="pickerList" role="listbox"></div>';
  document.body.appendChild(pkEl);
  var pkIn = pkEl.firstChild, pkList = pkEl.lastChild;
  var pk = null; // { o, anchor, rows, active }

  function pickerRender() {
    pk.rows = pk.o.rows(pkIn.value.trim().toLowerCase());
    if (pk.active >= pk.rows.length) pk.active = pk.rows.length - 1;
    if (pk.active < 0 && pk.rows.length) pk.active = 0;
    pkList.innerHTML = pk.rows.length ? pk.rows.map(function (r, i) {
      return '<div class="pk-row" role="option" id="pkopt' + i + '" data-i="' + i + '" aria-selected="' + (i === pk.active) + '">' + r.html + '</div>';
    }).join('') : '<p class="pk-empty">' + esc(pk.o.empty || 'Nothing to pick') + '</p>';
    if (pk.active >= 0) pkIn.setAttribute('aria-activedescendant', 'pkopt' + pk.active); else pkIn.removeAttribute('aria-activedescendant');
  }
  function pickerActive(i) {
    pk.active = i;
    Array.prototype.forEach.call(pkList.children, function (el, j) { el.setAttribute('aria-selected', String(j === i)); });
    pkIn.setAttribute('aria-activedescendant', 'pkopt' + i);
    pkList.children[i].scrollIntoView({ block: 'nearest' });
  }
  function openPicker(anchor, o) {
    closePop(); closePicker();
    pk = { o: o, anchor: anchor, rows: [], active: 0 };
    pkIn.value = ''; pkIn.placeholder = o.placeholder || 'Search…';
    pkIn.setAttribute('aria-label', o.label); pkEl.setAttribute('role', 'dialog'); pkEl.setAttribute('aria-label', o.label);
    anchor.setAttribute('aria-expanded', 'true');
    pkEl.hidden = false;
    pickerRender();
    var r = anchor.getBoundingClientRect(), pw = pkEl.offsetWidth, ph = pkEl.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
    var top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    pkEl.style.left = left + 'px'; pkEl.style.top = top + 'px';
    pkIn.focus({ preventScroll: true });
  }
  function closePicker(restoreFocus) {
    if (!pk) return false;
    var o = pk.o, anchor = pk.anchor;
    pk = null; pkEl.hidden = true; pkList.innerHTML = '';
    if (document.contains(anchor)) anchor.setAttribute('aria-expanded', 'false');
    if (restoreFocus) {
      var f = (o.refocus && o.refocus()) || (document.contains(anchor) ? anchor : null);
      if (f) f.focus({ preventScroll: true });
    }
    return true;
  }
  function pickerPick(i) {
    var r = pk && pk.rows[i]; if (!r) return;
    var o = pk.o;
    if (!o.keep) closePicker(true);
    o.onPick(r.id);
    if (o.keep && pk) pickerRender();
  }
  pkIn.addEventListener('input', function () { if (pk) { pk.active = 0; pickerRender(); } });
  pkIn.addEventListener('keydown', function (e) {
    if (!pk) return;
    var n = pk.rows.length;
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); pickerActive((pk.active + 1) % n); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); pickerActive((pk.active - 1 + n) % n); }
    else if (e.key === 'Enter') { e.preventDefault(); if (!e.isComposing) pickerPick(pk.active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePicker(true); }
    else if (e.key === 'Tab') closePicker(true);
  });
  // mousedown (not click) so the search box keeps focus
  pkList.addEventListener('mousedown', function (e) {
    var el = e.target.closest('.pk-row'); if (!el) return;
    e.preventDefault(); pickerPick(+el.dataset.i);
  });
  document.addEventListener('click', function (e) {
    if (pk && !pkEl.contains(e.target) && !(pk.anchor && pk.anchor.contains(e.target))) closePicker();
  });

  /* ---------- snippet links (item <-> snippet) ---------- */
  var MAX_LINKS = 20;
  function linkUrl(itemId, sid) {
    return '/api/items/' + encodeURIComponent(itemId) + '/snippets' + (sid ? '/' + encodeURIComponent(sid) : '');
  }
  function linkSnippet(itemId, sid) {
    var it = itemById(itemId); if (!it) return;
    var cur = it.snippets || [];
    if (cur.indexOf(sid) >= 0) return;
    if (cur.length >= MAX_LINKS) { toast('An item can have up to ' + MAX_LINKS + ' linked snippets.'); return; }
    var s = snipById(sid);
    change({ t: 'link.add', m: 'POST', u: linkUrl(itemId), b: { snippetId: sid }, k: itemId, sid: sid, label: s ? s.title : sid });
  }
  function unlinkSnippet(itemId, sid) {
    var it = itemById(itemId); if (!it || (it.snippets || []).indexOf(sid) < 0) return;
    var s = snipById(sid);
    change({ t: 'link.del', m: 'DELETE', u: linkUrl(itemId, sid), k: itemId, sid: sid, label: s ? s.title : sid });
  }
  function itemsLinking(sid) {
    return board.items.filter(function (i) { return (i.snippets || []).indexOf(sid) >= 0; });
  }
  function archivedLinking(sid) {
    return archive ? archive.items.filter(function (i) { return (i.snippets || []).indexOf(sid) >= 0; }) : [];
  }
  function projsOf(s) { return s.projects || []; }
  // Snippets tied to a project, directly or through its items, with how.
  function projectSnippets(name) {
    var out = [];
    snippets.forEach(function (s) {
      var direct = projsOf(s).some(function (p) { return sameText(p, name); });
      var n = board.items.filter(function (i) { return i.project === name && (i.snippets || []).indexOf(s.id) >= 0; }).length;
      if (direct || n) out.push({ s: s, direct: direct, items: n });
    });
    return out;
  }
  // Show a snippet on the Snippets page (clearing filters that would hide it).
  function openSnippetPage(sid) {
    var s = snipById(sid); if (!s) return;
    closeDetail();
    if (!snipMatches(s)) {
      snipFilter = { q: '', tag: 'all', type: 'all', project: 'all' };
      searchEl.value = '';
    }
    selectedSnip = sid;
    libEl.classList.add('show-detail');
    showPage('snippets');
    renderSnippets();
    var row = snipsEl.querySelector('.sitem[data-sid="' + sid + '"]'); if (row) row.scrollIntoView({ block: 'nearest' });
  }
  function linkSnippetPicker(anchor, itemId) {
    openPicker(anchor, {
      label: 'Link a snippet', placeholder: 'Search snippets…', keep: true, empty: 'No more snippets to link.',
      refocus: function () { return detailEl.querySelector('[data-dact="linksnip"]'); },
      rows: function (q) {
        var it = itemById(itemId), have = it ? it.snippets || [] : [];
        return snippets.filter(function (s) {
          if (have.indexOf(s.id) >= 0) return false;
          return !q || (s.title + '\n' + (s.type || '') + '\n' + s.tags.join(' ')).toLowerCase().indexOf(q) >= 0;
        }).slice(0, 50).map(function (s) {
          return { id: s.id, html: '<span class="pk-t">' + esc(s.title) + '</span><span class="lang">' + esc(LANG_LABEL[s.language] || s.language) + '</span>' +
            (s.type ? '<span class="pk-sub">' + esc(s.type) + '</span>' : '') };
        });
      },
      onPick: function (sid) { linkSnippet(itemId, sid); }
    });
  }
  function linkItemPicker(anchor, sid) {
    openPicker(anchor, {
      label: 'Link to an item', placeholder: 'Search items…', keep: true, empty: 'No more items to link.',
      refocus: function () { return snipDetailEl.querySelector('[data-act="linkitem"]'); },
      rows: function (q) {
        return board.items.filter(function (i) {
          if ((i.snippets || []).indexOf(sid) >= 0) return false;
          return !q || [i.title, i.project, i.group].join('\n').toLowerCase().indexOf(q) >= 0;
        }).slice(0, 50).map(function (i) {
          return { id: i.id, html: '<span class="pk-t">' + esc(i.title) + '</span>' + (i.project ? '<span class="pk-sub">' + esc(i.project) + '</span>' : '') };
        });
      },
      onPick: function (id) { linkSnippet(id, sid); }
    });
  }

  /* ---------- expanded card (detail) ---------- */
  var detailBg = document.getElementById('detailBg');
  var detailEl = document.getElementById('detail');

  var MAX_STEPS = 50;
  var detailRendering = false;   // true while the popup is being rebuilt (ignore the blur this causes)

  function stepRow(sid) {
    var rows = detailEl.querySelectorAll('.sub');
    for (var i = 0; i < rows.length; i++) if (rows[i].dataset.sid === sid) return rows[i];
    return null;
  }
  function stepTextBtn(text) {
    return '<button type="button" class="sub-text" title="Click to edit">' + esc(text) + '</button>';
  }
  function checklistHTML(it) {
    var steps = it.subtasks || [], done = stepsDone(it);
    var h = '<div class="d-section"><div class="d-labelrow"><p class="d-label">Checklist</p>';
    if (steps.length) h += '<span class="sub-count">' + done + ' of ' + steps.length + '</span>';
    h += '</div>';
    if (steps.length) {
      h += '<div class="sub-bar' + (done === steps.length ? ' all' : '') + '" role="progressbar" aria-label="Checklist progress" aria-valuemin="0" aria-valuemax="' + steps.length +
        '" aria-valuenow="' + done + '"><span style="width:' + Math.round(done / steps.length * 100) + '%"></span></div>';
      h += '<ul class="sub-list">' + steps.map(function (s) {
        return '<li class="sub' + (s.done ? ' done' : '') + '" data-sid="' + esc(s.id) + '">' +
          '<input type="checkbox" class="sub-cb"' + (s.done ? ' checked' : '') + ' aria-label="Done: ' + esc(s.text) + '">' +
          stepTextBtn(s.text) +
          '<button type="button" class="sub-rm" aria-label="Remove step: ' + esc(s.text) + '" title="Remove step">&times;</button></li>';
      }).join('') + '</ul>';
    }
    var full = steps.length >= MAX_STEPS;
    h += '<input type="text" class="sub-add" maxlength="200" autocomplete="off" aria-label="Add a step" placeholder="' +
      (full ? 'Step limit reached (' + MAX_STEPS + ')' : 'Add a step') + '"' + (full ? ' disabled' : '') + '></div>';
    return h;
  }
  // Linked snippets: a chip each (click opens it, x unlinks), plus a button that opens the picker.
  function snippetsSectionHTML(it) {
    var ids = it.snippets || [];
    var h = '<div class="d-section"><div class="d-labelrow"><p class="d-label">Snippets</p>' +
      '<button type="button" class="btn sm lk-add" data-dact="linksnip" aria-haspopup="dialog" aria-expanded="false">Link snippet</button></div>';
    if (ids.length) {
      h += '<ul class="lk-list">' + ids.map(function (sid) {
        var s = snipById(sid);
        if (!s) {
          var gl = snipsReady ? 'Deleted snippet' : 'Loading…';
          return '<li class="lk gone" data-sid="' + esc(sid) + '"><span class="lk-name">' + gl + '</span>' +
            '<button type="button" class="lk-rm" aria-label="Unlink ' + gl.toLowerCase() + '" title="Unlink">&times;</button></li>';
        }
        return '<li class="lk" data-sid="' + esc(sid) + '"><button type="button" class="lk-open" title="Open this snippet">' +
          '<span class="lk-name">' + esc(s.title) + '</span><span class="lang">' + esc(LANG_LABEL[s.language] || s.language) + '</span></button>' +
          '<button type="button" class="lk-rm" aria-label="Unlink ' + esc(s.title) + '" title="Unlink">&times;</button></li>';
      }).join('') + '</ul>';
    }
    return h + '</div>';
  }
  // Swap a step's text for an input. Used when clicked, and to put an
  // unfinished edit back after the popup is rebuilt.
  function startStepEdit(row, value) {
    var btn = row.querySelector('.sub-text'); if (!btn) return null;
    var inp = document.createElement('input');
    inp.type = 'text'; inp.className = 'sub-edit'; inp.maxLength = 200; inp.autocomplete = 'off';
    inp.setAttribute('aria-label', 'Edit step');
    inp.value = value != null ? value : btn.textContent;
    btn.replaceWith(inp);
    return inp;
  }
  // Leave edit mode without re-rendering. save: store the new text if it changed.
  function endStepEdit(inp, save) {
    var row = inp.closest('.sub'); if (!row || inp.dataset.fin) return;
    inp.dataset.fin = '1';
    var it = itemById(detailId), sid = row.dataset.sid;
    var st = it && (it.subtasks || []).filter(function (s) { return s.id === sid; })[0];
    var text = inp.value.replace(/[\r\n]+/g, ' ').trim();
    if (save && st && text && text !== st.text) {
      change({ t: 'sub.patch', m: 'PATCH', u: stepUrl(it.id, sid), b: { text: text }, k: it.id, sk: sid, label: text });
    } else {
      inp.outerHTML = stepTextBtn(st ? st.text : inp.value);
    }
  }
  function stepUrl(itemId, sid) {
    return '/api/items/' + encodeURIComponent(itemId) + '/subtasks' + (sid ? '/' + encodeURIComponent(sid) : '');
  }

  // Rebuilding the popup mid-click would swallow the click (e.g. finishing a
  // step edit on blur, then clicking another step's ×). So while a pointer is
  // down inside it, the rebuild waits until just after the click.
  var detailPointer = false, detailStale = false;
  detailEl.addEventListener('pointerdown', function () { detailPointer = true; });
  function detailPointerUp() {
    if (!detailPointer) return;
    detailPointer = false;
    if (detailStale) { detailStale = false; setTimeout(function () { if (detailId) renderDetail(); }, 0); }
  }
  window.addEventListener('pointerup', detailPointerUp);
  window.addEventListener('pointercancel', detailPointerUp);

  // "Created … · Done … · Archived …", whichever dates the item has.
  function datesHTML(it) {
    var parts = [['Created', it.createdAt], ['Done', it.doneAt], ['Archived', it.archivedAt]]
      .filter(function (x) { return fmtDate(x[1]); })
      .map(function (x) { return x[0] + ' ' + fmtDate(x[1]); });
    return parts.length ? '<p class="d-dates">' + parts.join(' · ') + '</p>' : '';
  }

  function renderDetail() {
    var it = itemById(detailId);
    if (!it) { closeDetail(); return; }
    if (detailPointer) { detailStale = true; return; }
    // The popup is rebuilt from scratch, and this can run while the user is
    // typing (a background save reloads the board). Remember what they were
    // doing and put it back afterwards.
    var keep = { scroll: 0 };
    var body0 = detailEl.querySelector('.d-body'); if (body0) keep.scroll = body0.scrollTop;
    var addIn = detailEl.querySelector('.sub-add');
    if (addIn) keep.add = { v: addIn.value, s: addIn.selectionStart, e: addIn.selectionEnd };
    var ed = detailEl.querySelector('.sub-edit');
    if (ed && !ed.dataset.fin && ed.closest('.sub')) keep.edit = { sid: ed.closest('.sub').dataset.sid, v: ed.value, s: ed.selectionStart, e: ed.selectionEnd };
    var ae = document.activeElement;
    if (ae && detailEl.contains(ae)) {
      if (ae === addIn) keep.focus = { add: true };
      else if (ed && ae === ed) keep.focus = { edit: true };
      else if (ae.closest('.sub')) keep.focus = { sid: ae.closest('.sub').dataset.sid, cls: ae.className };
      else if (ae.closest('.lk')) keep.focus = { lk: ae.closest('.lk').dataset.sid, cls: ae.className };
      else if (ae.dataset && ae.dataset.dact === 'linksnip') keep.focus = { linkBtn: true };
    }
    var st = it.status || 'open', pr = it.prio || 'medium';
    detailEl.className = 'modal detail ' + pr;
    var h = '<div class="d-top"><div class="d-crumbs"><span class="d-prio">' + PLAB[pr] + '</span>';
    if (it.project) h += projChip(it.project) + stageChip(itemStage(it), 'Stage');
    groupsOf(it).forEach(function (g) { h += '<span class="chip">' + esc(g) + '</span>'; });
    h += '</div><h2 id="dTitle">' + esc(it.title) + '</h2></div>';
    h += '<div class="d-body">';
    h += '<div class="d-section"><p class="d-label">Status</p><div class="d-status" role="group" aria-label="Status">' +
      STATUSES.map(function (s) { return '<button data-ds="' + s + '" data-s="' + s + '" aria-pressed="' + (s === st) + '">' + SLAB[s] + '</button>'; }).join('') + '</div></div>';
    h += '<div class="d-section"><p class="d-label">Description</p>' +
      (it.note ? '<p class="d-note">' + esc(it.note) + '</p>' : '<p class="d-note muted">No description yet. Click Edit to add one.</p>') + '</div>';
    h += checklistHTML(it);
    h += snippetsSectionHTML(it);
    h += datesHTML(it);
    h += '</div>';
    h += '<div class="d-foot"><button class="btn sm danger" data-dact="del">Delete</button>' +
      '<button class="btn sm" data-dact="archive">Archive</button><span class="grow"></span>' +
      '<button class="btn sm" data-dact="close">Close</button><button class="btn sm primary" data-dact="edit">Edit</button></div>';
    detailRendering = true;
    detailEl.innerHTML = h;
    detailRendering = false;

    var body1 = detailEl.querySelector('.d-body'); if (body1 && keep.scroll) body1.scrollTop = keep.scroll;
    var add1 = detailEl.querySelector('.sub-add');
    if (add1 && keep.add && !add1.disabled) {
      add1.value = keep.add.v;
      try { add1.setSelectionRange(keep.add.s, keep.add.e); } catch (_) {}
    }
    var focusEl = null;
    if (keep.edit) {
      var row = stepRow(keep.edit.sid), inp = row && startStepEdit(row, keep.edit.v);
      if (inp && keep.focus && keep.focus.edit) {
        focusEl = inp;
        try { inp.setSelectionRange(keep.edit.s, keep.edit.e); } catch (_) {}
      }
    }
    if (keep.focus && keep.focus.add) focusEl = add1;
    else if (keep.focus && keep.focus.sid) {
      var r2 = stepRow(keep.focus.sid);
      // If that step is gone (just removed), carry on typing in the add box.
      focusEl = (r2 && r2.querySelector('.' + keep.focus.cls.split(' ')[0])) || add1;
    }
    else if (keep.focus && keep.focus.lk) {
      // If that link is gone (just unlinked), land on the Link snippet button.
      var lrow = detailEl.querySelector('.lk[data-sid="' + keep.focus.lk + '"]');
      focusEl = (lrow && lrow.querySelector('.' + keep.focus.cls.split(' ')[0])) || detailEl.querySelector('[data-dact="linksnip"]');
    } else if (keep.focus && keep.focus.linkBtn) focusEl = detailEl.querySelector('[data-dact="linksnip"]');
    if (focusEl && !focusEl.disabled) focusEl.focus({ preventScroll: true });
  }
  function openDetail(id) {
    detailId = id; renderDetail();
    detailBg.classList.add('open');
    setTimeout(function () { var b = detailEl.querySelector('[data-dact="close"]'); if (b) b.focus(); }, 30);
  }
  function closeDetail() {
    if (!detailBg.classList.contains('open')) return;
    detailBg.classList.remove('open');
    closePicker();
    var id = detailId, aid = detailArchId; detailId = null; detailArchId = null;
    var card = id && boardEl.querySelector('.card[data-id="' + id + '"]'); if (card) card.focus({ preventScroll: true });
    var row = aid && archListEl.querySelector('.arch-row[data-id="' + aid + '"] .arch-title'); if (row) row.focus({ preventScroll: true });
  }
  detailBg.addEventListener('click', function (e) {
    if (e.target === detailBg) return closeDetail();
    if (detailArchId) {
      var ab = e.target.closest('[data-dact]'); if (!ab) return;
      var aid = detailArchId;
      if (ab.dataset.dact === 'close') closeDetail();
      else if (ab.dataset.dact === 'restore') { closeDetail(); restoreOne(aid); }
      return;
    }
    var s = e.target.closest('[data-ds]');
    if (s && detailId) { var it = itemById(detailId); if (it && it.status !== s.dataset.ds) patchItem(detailId, { status: s.dataset.ds }); return; }
    var lkAdd = e.target.closest('[data-dact="linksnip"]');
    if (lkAdd && detailId) {
      if (pk && pk.anchor === lkAdd) return closePicker(true);
      if (!snipsLoaded) loadSnippets();
      return linkSnippetPicker(lkAdd, detailId);
    }
    var lkRow = e.target.closest('.lk');
    if (lkRow && detailId) {
      var lsid = lkRow.dataset.sid;
      if (e.target.closest('.lk-rm')) unlinkSnippet(detailId, lsid);
      else if (e.target.closest('.lk-open')) openSnippetPage(lsid);
      return;
    }
    var rm = e.target.closest('.sub-rm'), tx = e.target.closest('.sub-text');
    if ((rm || tx) && detailId) {
      var row = (rm || tx).closest('.sub'), sid = row.dataset.sid;
      if (tx) { var inp = startStepEdit(row); if (inp) { inp.focus(); inp.select(); } return; }
      var rit = itemById(detailId), rst = rit && (rit.subtasks || []).filter(function (s) { return s.id === sid; })[0];
      if (rst) change({ t: 'sub.del', m: 'DELETE', u: stepUrl(rit.id, sid), k: rit.id, sk: sid, label: rst.text });
      return;
    }
    var a = e.target.closest('[data-dact]'); if (!a) return;
    var id = detailId;
    if (a.dataset.dact === 'close') closeDetail();
    else if (a.dataset.dact === 'edit') { closeDetail(); openEdit(id); }
    else if (a.dataset.dact === 'del') confirmDelete(id);
    else if (a.dataset.dact === 'archive') { closeDetail(); archiveOne(id); }
  });
  detailBg.addEventListener('change', function (e) {
    var cb = e.target.closest('.sub-cb'); if (!cb || !detailId) return;
    var it = itemById(detailId), sid = cb.closest('.sub').dataset.sid;
    var st = it && (it.subtasks || []).filter(function (s) { return s.id === sid; })[0];
    if (st && st.done !== cb.checked) change({ t: 'sub.patch', m: 'PATCH', u: stepUrl(it.id, sid), b: { done: cb.checked }, k: it.id, sk: sid, label: st.text });
  });
  detailBg.addEventListener('keydown', function (e) {
    var t = e.target;
    if (!t.classList) return;
    if (t.classList.contains('sub-edit')) {
      if (e.key !== 'Enter' && e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation(); // Esc cancels the edit, not the popup
      if (e.isComposing) return;
      var row = t.closest('.sub'), sid = row && row.dataset.sid;
      endStepEdit(t, e.key === 'Enter');
      var r2 = sid && stepRow(sid), b = r2 && r2.querySelector('.sub-text');
      if (b) b.focus();
    } else if (t.classList.contains('sub-add')) {
      if (e.key === 'Escape' && t.value) { e.stopPropagation(); t.value = ''; return; }
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      var text = t.value.replace(/[\r\n]+/g, ' ').trim(), it = itemById(detailId);
      if (!text || !it || (it.subtasks || []).length >= MAX_STEPS) return;
      t.value = ''; // cleared first so the rebuilt popup keeps the box empty and focused
      var sid2 = 's-' + rid();
      change({ t: 'sub.add', m: 'POST', u: stepUrl(it.id), b: { id: sid2, text: text }, k: it.id, label: text });
    }
  });
  detailBg.addEventListener('focusout', function (e) {
    if (detailRendering || !e.target.classList || !e.target.classList.contains('sub-edit')) return;
    endStepEdit(e.target, true);
  });

  /* ---------- add / edit modal ---------- */
  var modalBg = document.getElementById('modalBg');
  var mErr = document.getElementById('mErr');

  function fillProjectSelect(sel) {
    sel.innerHTML = board.projects.map(function (p) { return '<option>' + esc(p) + '</option>'; }).join('')
      || '<option value="">(add a project first)</option>';
  }
  // The Stage field only shows with a project; it starts at that project's current stage.
  function setStageField(project, stage) {
    var sel = document.getElementById('mStage');
    document.getElementById('mStageFld').hidden = !project;
    sel.value = project ? (stage || projStage(project)) : STAGES[0].k;
    syncSelect(sel);
  }
  document.getElementById('mStage').innerHTML = STAGES.map(function (s) { return '<option value="' + s.k + '">' + s.name + '</option>'; }).join('');
  document.getElementById('mProj').addEventListener('change', function () { setStageField(this.value, ''); });
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
    setStageField(sel.value, '');
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
    setStageField(it.project, itemStage(it));
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
      note: document.getElementById('mNote').value.trim(),
      stage: ''
    };
    if (payload.project) {
      payload.stage = document.getElementById('mStage').value;
      // An item with no stage of its own that stays in its project's current stage stays stage-less.
      var cur0 = editingId && itemById(editingId);
      if (cur0 && !cur0.stage && payload.stage === projStage(payload.project)) payload.stage = '';
    }
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

  /* ---------- quick add: paste a list, make many items ---------- */
  var qaBg = document.getElementById('qaBg');
  var qaText = document.getElementById('qaText');
  var qaPrev = document.getElementById('qaPrev');
  var MAX_STEPS = 50;
  var qaList = [];        // the preview: { title, note, prio, own (prio set by hand), steps: [text] }
  var qaDropped = 0;      // steps over the per-item limit
  var qaTimer = null;

  // Text -> [{ title, note, steps }]. Top-level lines are items; indented lines are
  // steps of the item above (or an item, if there is none yet).
  function parseQuickAdd(text) {
    var out = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      var indented = /^[ \t]/.test(line);
      var rest = line.replace(/^[ \t]+/, '');
      // "> text" (indented or not) is description for the item above, like an email quote.
      if (/^>/.test(rest) && out.length) {
        var d = rest.replace(/^>\s?/, '').trim();
        var prev = out[out.length - 1];
        if (d) prev.desc.push(d);
        return;
      }
      var t = rest.replace(/^>\s?/, '')
        .replace(/^(?:[-*•–·]|\d+[.)]|\(\d+\)|[a-z][.)])(?:\s+|$)/i, '').trim();
      if (!t) return;
      var cut = t;
      if (t.length > 200) {
        cut = t.slice(0, 200);
        var sp = cut.lastIndexOf(' ');
        if (t.charAt(200) !== ' ' && sp > 0) cut = cut.slice(0, sp);
        cut = cut.trim();
      }
      if (indented && out.length) {
        var cur = out[out.length - 1];
        if (cur.steps.length < MAX_STEPS) cur.steps.push(cut); else cur.dropped = (cur.dropped || 0) + 1;
      } else {
        out.push({ title: cut, note: t.length > 200 ? t : '', desc: [], steps: [] });
      }
    });
    // A cut-off long title keeps its full text first, then any "> " lines.
    out.forEach(function (n) {
      n.note = [n.note].concat(n.desc).filter(Boolean).join('\n');
      delete n.desc;
    });
    return out;
  }

  function qaParse() {
    var batchPrio = document.getElementById('qaPrio').value;
    qaDropped = 0;
    qaTimer = null;
    qaList = parseQuickAdd(qaText.value).map(function (n) {
      qaDropped += n.dropped || 0;
      return { title: n.title, note: n.note, prio: batchPrio, own: false, steps: n.steps };
    });
    qaRender();
  }
  function qaValid() { return qaList.filter(function (n) { return n.title.trim(); }); }
  // The batch's shared description first, then the item's own.
  function qaNoteFor(n, shared) { return [shared, (n.note || '').trim()].filter(Boolean).join('\n\n'); }
  function qaRender() {
    var h = '';
    qaList.forEach(function (n, i) {
      h += '<div class="qa-item" data-i="' + i + '"><div class="qa-row">' +
        '<input class="qa-title" aria-label="Item title" maxlength="200" value="' + esc(n.title) + '">' +
        '<select class="qa-prio" aria-label="Item priority">' +
        ['critical', 'high', 'medium', 'low'].map(function (p) {
          return '<option value="' + p + '"' + (p === n.prio ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>';
        }).join('') + '</select>' +
        '<button type="button" class="qa-rm" data-rm="item" aria-label="Remove ' + esc(n.title) + '">&times;</button></div>';
      if (n.note || n.noteOpen) {
        h += '<div class="qa-row qa-desc"><textarea class="qa-note" rows="2" maxlength="800" aria-label="Description for ' + esc(n.title) +
          '" placeholder="Description">' + esc(n.note) + '</textarea></div>';
      } else {
        h += '<button type="button" class="qa-addnote" data-note="' + i + '">+ Add description</button>';
      }
      n.steps.forEach(function (st, j) {
        h += '<div class="qa-row qa-step" data-j="' + j + '">' +
          '<input class="qa-stext" aria-label="Step text" maxlength="200" value="' + esc(st) + '">' +
          '<button type="button" class="qa-rm" data-rm="step" aria-label="Remove step ' + esc(st) + '">&times;</button></div>';
      });
      h += '</div>';
    });
    qaPrev.innerHTML = h;
    qaPrev.hidden = !qaList.length;
    qaUpdate();
  }
  function qaUpdate() {
    var v = qaValid(), steps = 0;
    v.forEach(function (n) { steps += n.steps.filter(function (s) { return s.trim(); }).length; });
    document.getElementById('qaCount').textContent = v.length
      ? v.length + (v.length === 1 ? ' item' : ' items') + (steps ? ' · ' + steps + (steps === 1 ? ' step' : ' steps') : '') : '';
    var over = v.length > 100;
    var shared = document.getElementById('qaNote').value.trim();
    var long = v.some(function (n) { return qaNoteFor(n, shared).length > 800; });
    document.getElementById('qaErr').textContent = over ? 'Up to 100 items at a time.'
      : long ? 'Some descriptions are over 800 characters and will be cut short.'
      : qaDropped ? qaDropped + ' extra ' + (qaDropped === 1 ? 'step was' : 'steps were') + ' left out (50 steps per item at most).' : '';
    var add = document.getElementById('qaAdd');
    add.textContent = v.length ? 'Add ' + v.length + (v.length === 1 ? ' item' : ' items') : 'Add items';
    add.disabled = !v.length || over;
  }
  qaText.addEventListener('input', function () { clearTimeout(qaTimer); qaTimer = setTimeout(qaParse, 150); });
  document.getElementById('qaNote').addEventListener('input', qaUpdate);
  qaPrev.addEventListener('input', function (e) {
    var row = e.target.closest('.qa-item'); if (!row) return;
    var n = qaList[+row.dataset.i], t = e.target;
    if (t.classList.contains('qa-title')) {
      n.title = t.value;
      row.querySelector('[data-rm="item"]').setAttribute('aria-label', 'Remove ' + t.value);
    } else if (t.classList.contains('qa-stext')) {
      n.steps[+t.closest('.qa-step').dataset.j] = t.value;
    } else if (t.classList.contains('qa-note')) {
      n.note = t.value;
    }
    qaUpdate();
  });
  qaPrev.addEventListener('change', function (e) {
    if (!e.target.classList.contains('qa-prio')) return;
    var n = qaList[+e.target.closest('.qa-item').dataset.i];
    n.prio = e.target.value; n.own = true;
  });
  qaPrev.addEventListener('click', function (e) {
    var addNote = e.target.closest('[data-note]');
    if (addNote) {
      var k = +addNote.dataset.note;
      qaList[k].noteOpen = true;
      qaRender();
      var box = qaPrev.querySelector('.qa-item[data-i="' + k + '"] .qa-note'); if (box) box.focus();
      return;
    }
    var btn = e.target.closest('[data-rm]'); if (!btn) return;
    var i = +btn.closest('.qa-item').dataset.i;
    if (btn.dataset.rm === 'item') qaList.splice(i, 1);
    else qaList[i].steps.splice(+btn.closest('.qa-step').dataset.j, 1);
    qaRender();
    (qaPrev.querySelector('input') || qaText).focus();
  });
  document.getElementById('qaPrio').addEventListener('change', function () {
    var p = this.value;
    qaList.forEach(function (n) { if (!n.own) n.prio = p; });
    qaRender();
  });

  function openQuickAdd() {
    var sel = document.getElementById('qaProj');
    sel.innerHTML = '<option value="">(no project)</option>' + board.projects.map(function (p) { return '<option>' + esc(p) + '</option>'; }).join('');
    sel.value = filters.project !== 'all' && board.projects.indexOf(filters.project) >= 0 ? filters.project : '';
    document.getElementById('qaPrio').value = filters.prio !== 'all' ? filters.prio : 'medium';
    document.getElementById('qaGroup').value = filters.group !== 'all' ? filters.group : '';
    document.getElementById('qaNote').value = '';
    qaText.value = '';
    syncSelects();
    qaParse();
    qaBg.classList.add('open');
    setTimeout(function () { qaText.focus(); }, 30);
  }
  function qaShut() {
    clearTimeout(qaTimer);
    qaBg.classList.remove('open');
    document.getElementById('qaBtn').focus({ preventScroll: true });
  }
  // Asks first when there's a list that would be lost.
  function qaClose() {
    if (!qaText.value.trim() && !document.getElementById('qaNote').value.trim()) return qaShut();
    confirmDialog({ title: 'Discard this list?', message: 'The items you pasted won’t be added.', ok: 'Discard' }).then(function (ok) {
      if (ok) qaShut();
    });
  }
  function qaSubmit() {
    if (qaTimer) { clearTimeout(qaTimer); qaParse(); } // the list changed a moment ago
    var v = qaValid();
    if (!v.length || v.length > 100) return;
    var project = document.getElementById('qaProj').value, group = document.getElementById('qaGroup').value.trim();
    var shared = document.getElementById('qaNote').value.trim();
    var items = v.map(function (n) {
      var it = { id: 'i-' + rid(), title: n.title.trim(), project: project, prio: n.prio, group: group, status: 'open' };
      var note = qaNoteFor(n, shared).slice(0, 800);
      if (note) it.note = note;
      var steps = n.steps.map(function (s) { return s.trim(); }).filter(Boolean);
      if (steps.length) it.subtasks = steps.map(function (s) { return { id: 's-' + rid(), text: s }; });
      return it;
    });
    // relax filters so every new item is visible (as the single Add does)
    function hides(f) { return items.some(function (it) { return !f(it); }); }
    if (filters.prio !== 'all' && hides(function (it) { return it.prio === filters.prio; })) filters.prio = 'all';
    if (filters.project !== 'all' && filters.project !== project) filters.project = 'all';
    if (filters.view !== 'all' && filters.view !== 'active') filters.view = 'all';
    if (filters.group !== 'all' && hides(function (it) { return groupsOf(it).some(function (g) { return sameText(g, filters.group); }); })) filters.group = 'all';
    if (filters.q && hides(matchesSearch)) { filters.q = ''; boardSearch.value = ''; }
    qaShut();
    change({ t: 'item.batch', m: 'POST', u: '/api/items/batch', b: { items: items }, k: items[0].id, label: items.length + ' items' });
    toast(items.length + (items.length === 1 ? ' item added' : ' items added'), true);
  }
  document.getElementById('qaBtn').addEventListener('click', openQuickAdd);
  document.getElementById('qaCancel').addEventListener('click', qaClose);
  qaBg.addEventListener('click', function (e) { if (e.target === qaBg) qaClose(); });
  document.getElementById('qaAdd').addEventListener('click', qaSubmit);
  qaText.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); qaSubmit(); }
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
             '<button class="pcl" data-p="' + esc(p) + '" title="Move this project and its items to the Archive">Close</button>' +
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

  document.getElementById('plist').addEventListener('click', function (e) {
    var b = e.target.closest('.pcl'); if (!b) return;
    closeProject(b.dataset.p);
  });
  function closeProject(name) {
    var items = board.items.filter(function (i) { return i.project === name; });
    var n = items.length, m = items.filter(notDone).length;
    var tail = 'The project leaves the board and is kept in the Archive, where you can reopen it.';
    var msg = tail;
    if (n) {
      msg = (n === 1 ? 'The item moves' : 'All ' + n + ' items move') + ' to the Archive' +
        (m ? ' (' + (n === 1 ? 'it isn’t' : m === 1 ? '1 isn’t' : m + ' aren’t') + ' done yet)' : '') + '. ' + tail;
    }
    confirmDialog({ title: 'Close ' + name + '?', message: msg, ok: 'Close project', plain: true }).then(function (ok) {
      if (!ok) return;
      if (filters.project === name) filters.project = 'all';
      var now = new Date().toISOString();
      change({ t: 'proj.close', m: 'POST', u: '/api/projects/' + encodeURIComponent(name) + '/close', k: name, label: name,
        snap: { items: items.map(function (i) { var c = clone(i); c.archivedAt = now; return c; }), colors: oneColor(name, board.projectColors), stages: oneStage(name, projStage(name)) } });
    });
  }

  /* ---------- toast ---------- */
  // A message at the bottom of the screen. With `undo` it also shows an Undo
  // button (and Ctrl+Z works) for 6 seconds; hovering or focusing it keeps it open.
  var toastEl = null, toastMsg, toastBtn, toastT = null, toastMs = 0, toastHeld = false, toastUndo = null;
  function toast(msg, ok, undo) {
    if (!toastEl) {
      toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status');
      toastEl.innerHTML = '<span class="toast-msg"></span><button type="button" class="toast-btn" aria-keyshortcuts="Control+Z" hidden>Undo</button>';
      toastMsg = toastEl.firstChild; toastBtn = toastEl.lastChild;
      toastBtn.addEventListener('click', runUndo);
      toastEl.addEventListener('mouseenter', holdToast);
      toastEl.addEventListener('focusin', holdToast);
      toastEl.addEventListener('mouseleave', releaseToast);
      toastEl.addEventListener('focusout', function (e) { if (!toastEl.contains(e.relatedTarget)) releaseToast(); });
      document.body.appendChild(toastEl);
    }
    var hadFocus = toastEl.contains(document.activeElement);
    toastMsg.textContent = msg;
    toastUndo = undo || null;
    toastBtn.hidden = !undo;
    toastEl.classList.toggle('ok', !!ok);
    toastEl.classList.toggle('act', !!undo);
    toastEl.classList.add('show');
    if (hadFocus && !undo) { toastHeld = false; document.activeElement.blur(); }
    toastMs = undo ? 6000 : ok ? 1600 : 3200;
    clearTimeout(toastT);
    if (!toastHeld) toastT = setTimeout(hideToast, toastMs);
  }
  // Sync problems are already shown on the label, so they don't push an Undo off screen.
  function toastIfFree(msg) { if (!toastUndo) toast(msg); }
  function hideToast() { toastEl.classList.remove('show'); toastUndo = null; toastHeld = false; }
  function holdToast() { toastHeld = true; clearTimeout(toastT); }
  function releaseToast() {
    if (!toastHeld) return;
    toastHeld = false; clearTimeout(toastT);
    if (toastEl.classList.contains('show')) toastT = setTimeout(hideToast, toastMs);
  }
  function runUndo() {
    var f = toastUndo; if (!f) return false;
    var hadFocus = toastEl.contains(document.activeElement);
    hideToast(); f();
    if (hadFocus) toastBtn.blur();
    return true;
  }

  /* ==========================================================
   * Snippet library (two-pane)
   * ========================================================== */
  var snippets = [];
  var snipsLoaded = false;
  var snipsReady = false;   // the list has really arrived (snipsLoaded is set when loading starts)
  var snipFilter = { q: '', tag: 'all', type: 'all', project: 'all' };
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
      snippets = list; snipsReady = true;
      applyPending('snip'); // changes not saved yet stay on screen
      afterSnipsChange();
    }).catch(function (e) {
      snipsLoaded = false; // try again next time the page is opened
      if (e.offline) {
        goOffline();
        if (snippets.length) return; // keep what's on screen
        var copy = readCache('snips');
        if (copy) { snippets = copy; snipsReady = true; applyPending('snip'); afterSnipsChange(); return; }
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
  function snipProjects(raw) {
    var out = [];
    (Array.isArray(raw) ? raw : String(raw || '').split(',')).forEach(function (n) {
      n = String(n).replace(/[\r\n]+/g, ' ').replace(/,/g, '').trim().slice(0, 80).trim();
      if (n && !out.some(function (x) { return sameText(x, n); }) && out.length < 20) out.push(n);
    });
    return out;
  }
  // The snippet lists changed: redraw everything that shows them.
  function afterSnipsChange() {
    renderSnippets();
    renderStageBar();
    if (detailId) renderDetail();
  }
  function localSnippet(p, into) {
    var now = new Date().toISOString();
    var s = into || { id: p.id, created: now, title: '', language: 'deluge', type: '', tags: [], projects: [], description: '', code: '' };
    ['title', 'language', 'type', 'description', 'code'].forEach(function (k) { if (k in p) s[k] = p[k]; });
    if ('tags' in p) s.tags = snipTags(p.tags);
    if ('projects' in p) s.projects = snipProjects(p.projects);
    s.updated = now;
    return s;
  }
  function snipSlug(title) {
    return String(title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50) || 'snippet';
  }

  // Everything the Project filter can offer: name -> { name, ids } where ids are the
  // snippets linked to it directly or through one of its items.
  function snipProjectIndex() {
    var idx = {}, have = {};
    snippets.forEach(function (s) { have[s.id] = true; });
    function add(name, id) {
      var k = String(name).toLowerCase();
      if (!k) return;
      var e = idx[k] || (idx[k] = { name: name, ids: {} });
      e.ids[id] = true;
    }
    board.projects.forEach(function (p) { idx[p.toLowerCase()] = { name: p, ids: {} }; });
    snippets.forEach(function (s) { projsOf(s).forEach(function (p) { add(p, s.id); }); });
    board.items.forEach(function (it) {
      if (it.project) (it.snippets || []).forEach(function (id) { if (have[id]) add(it.project, id); });
    });
    Object.keys(idx).forEach(function (k) { if (!Object.keys(idx[k].ids).length) delete idx[k]; });
    return idx;
  }
  // "#tag" words in the search box that exactly match a tag are filters (and not
  // searched as text); anything else, like a half-typed "#boo", is plain text.
  function parseSnipQuery(q, tags) {
    var text = [], used = [];
    q.trim().split(/\s+/).filter(Boolean).forEach(function (w) {
      var t = w.charAt(0) === '#' ? w.slice(1).toLowerCase() : '';
      if (t && tags.indexOf(t) >= 0) { if (used.indexOf(t) < 0) used.push(t); } else text.push(w);
    });
    return { text: text, tags: used };
  }
  var snipCtx = { idx: {}, query: { text: [], tags: [] } }; // set by renderSnippets for snipMatches
  function snipMatches(s) {
    var c = snipCtx;
    if (snipFilter.tag !== 'all' && s.tags.indexOf(snipFilter.tag) < 0) return false;
    if (!c.query.tags.every(function (t) { return s.tags.indexOf(t) >= 0; })) return false;
    if (snipFilter.type !== 'all' && !sameText(s.type || '', snipFilter.type)) return false;
    if (snipFilter.project !== 'all') {
      var e = c.idx[snipFilter.project.toLowerCase()];
      if (!e || !e.ids[s.id]) return false;
    }
    if (!c.query.text.length) return true;
    var hay = (s.title + '\n' + (s.type || '') + '\n' + s.description + '\n' + s.tags.map(function (t) { return '#' + t; }).join(' ') + '\n' + s.code).toLowerCase();
    return c.query.text.every(function (w) { return hay.indexOf(w.toLowerCase()) >= 0; });
  }
  function snipById(id) {
    for (var i = 0; i < snippets.length; i++) if (snippets[i].id === id) return snippets[i];
    return null;
  }

  function renderSnippets() {
    document.getElementById('navSnipCount').textContent = snippets.length || '';

    // Filter row: Used in and Project menus, the most-used tags, a menu for the rest.
    var types = snipTypes();
    if (snipFilter.type !== 'all' && !types.some(function (x) { return sameText(x, snipFilter.type); })) snipFilter.type = 'all';
    var counts = {};
    snippets.forEach(function (s) { s.tags.forEach(function (x) { counts[x] = (counts[x] || 0) + 1; }); });
    var tags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    if (snipFilter.tag !== 'all' && !counts[snipFilter.tag]) snipFilter.tag = 'all';
    var pidx = snipProjectIndex();
    if (snipFilter.project !== 'all' && !pidx[snipFilter.project.toLowerCase()]) snipFilter.project = 'all';
    snipCtx = { idx: pidx, query: parseSnipQuery(snipFilter.q, tags) };

    var typeOpts = [{ v: 'all', t: 'Used in: any' }].concat(types.map(function (x) {
      return { v: x, t: x + ' (' + snippets.filter(function (s) { return sameText(s.type || '', x); }).length + ')' };
    }));
    setOptions(snipTypeSel, typeOpts, snipFilter.type);
    document.getElementById('snipTypeWrap').hidden = typeOpts.length < 2;
    var pnames = Object.keys(pidx).map(function (k) { return pidx[k]; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var projOpts = [{ v: 'all', t: 'Project: any' }].concat(pnames.map(function (e) { return { v: e.name, t: e.name + ' (' + Object.keys(e.ids).length + ')' }; }));
    setOptions(snipProjSel, projOpts, snipFilter.project === 'all' ? 'all' : pidx[snipFilter.project.toLowerCase()].name);
    document.getElementById('snipProjWrap').hidden = projOpts.length < 2;

    var TOP_TAGS = 6;
    var shown = tags.slice(0, TOP_TAGS);
    if (snipFilter.tag !== 'all' && shown.indexOf(snipFilter.tag) < 0) shown.push(snipFilter.tag);
    var chips = shown.map(function (x) {
      return '<button type="button" class="tagbtn" data-tag="' + esc(x) + '" aria-pressed="' + (snipFilter.tag === x) + '" title="' +
        (snipFilter.tag === x ? 'Stop filtering by #' : 'Show only #') + esc(x) + '">#' + esc(x) + ' <span class="c">' + counts[x] + '</span></button>';
    }).join('');
    if (tags.length > TOP_TAGS) {
      chips += '<button type="button" class="tagbtn tag-more" data-more="1" aria-haspopup="dialog" aria-expanded="false">More tags <span class="c">' +
        (tags.length - TOP_TAGS) + '</span></button>';
    }
    document.getElementById('tagFilters').innerHTML = chips;

    var act = [];
    if (snipFilter.type !== 'all') act.push({ k: 'type', lab: 'Used in', v: snipFilter.type });
    if (snipFilter.project !== 'all') act.push({ k: 'project', lab: 'Project', v: pidx[snipFilter.project.toLowerCase()].name });
    if (snipFilter.tag !== 'all') act.push({ k: 'tag', lab: 'Tag', v: '#' + snipFilter.tag });
    snipCtx.query.tags.forEach(function (x) { act.push({ k: 'tok', t: x, lab: 'Tag', v: '#' + x }); });
    if (snipCtx.query.text.length) act.push({ k: 'q', lab: 'Search', v: '“' + snipCtx.query.text.join(' ') + '”' });
    var actEl = document.getElementById('snipActive');
    actEl.innerHTML = act.map(function (x) {
      return '<span class="fchip">' + x.lab + ': <b>' + esc(x.v) + '</b><button data-clear="' + x.k + '"' + (x.t ? ' data-t="' + esc(x.t) + '"' : '') +
        ' aria-label="Remove ' + x.lab.toLowerCase() + ' filter" title="Remove">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg></button></span>';
    }).join('') + (act.length > 1 ? '<button class="fclear" data-clear="all">Clear all</button>' : '');
    actEl.hidden = !act.length;

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

  // Projects the snippet is linked to, and the items that use it (board first, then archived).
  function snipLinksHTML(s) {
    // The archive loads the first time a detail pane needs it.
    if (!archLoaded) loadArchive().then(function () { if (archLoaded && page === 'snippets') renderSnipDetail(); });
    var h = '<div class="sd-links">';
    var projs = projsOf(s);
    if (projs.length) {
      h += '<div class="sd-row"><span class="sd-lab">Projects</span><span class="sd-chips">' + projs.map(function (n) {
        var known = board.projects.indexOf(n) >= 0;
        if (!known) return '<span class="chip proj gone" title="No longer on the board">' + esc(n) + '</span>';
        var k = projColor(n);
        return '<button type="button" class="chip proj" data-act="goproj" data-p="' + esc(n) + '"' + (k ? ' style="--pc:' + pcVar(k) + '"' : '') +
          ' title="Show ' + esc(n) + ' on the board">' + esc(n) + '</button>';
      }).join('') + '</span></div>';
    }
    var onBoard = itemsLinking(s.id), arch = archivedLinking(s.id);
    h += '<div class="sd-row sd-used"><span class="sd-lab">Used for</span><button type="button" class="btn sm" data-act="linkitem" aria-haspopup="dialog" aria-expanded="false">Link to item</button></div>';
    if (!onBoard.length && !arch.length) {
      h += '<p class="sd-none">Not linked to any items yet.</p>';
    } else {
      h += '<ul class="uf-list">' + onBoard.map(function (i) {
        var st = i.status || 'open';
        return '<li class="uf" data-id="' + esc(i.id) + '"><button type="button" class="uf-open" data-act="openitem" title="Open this item">' + esc(i.title) + '</button>' +
          (i.project ? projChip(i.project) + stageChip(itemStage(i), 'Stage') : '') +
          '<span class="pill static ' + st + '">' + SLAB[st] + '</span>' +
          '<button type="button" class="uf-rm" data-act="unlink" aria-label="Unlink ' + esc(i.title) + '" title="Unlink">&times;</button></li>';
      }).join('') + arch.map(function (i) {
        var st = i.status || 'open';
        return '<li class="uf arch" data-id="' + esc(i.id) + '"><button type="button" class="uf-open" data-act="openarch" title="Open in the Archive">' + esc(i.title) + '</button>' +
          '<span class="uf-tag">Archived</span>' + (i.project ? archProjChip(i.project) : '') +
          '<span class="pill static ' + st + '">' + SLAB[st] + '</span></li>';
      }).join('') + '</ul>';
    }
    return h + '</div>';
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
    h += snipLinksHTML(s);
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
    } else if (act === 'goproj') {
      filters.prio = 'all'; filters.project = btn.dataset.p; filters.group = 'all';
      showPage('board'); render();
    } else if (act === 'openitem') {
      showPage('board'); openDetail(btn.closest('.uf').dataset.id);
    } else if (act === 'openarch') {
      showPage('archive'); openArchiveDetail(btn.closest('.uf').dataset.id);
    } else if (act === 'unlink') {
      unlinkSnippet(btn.closest('.uf').dataset.id, s.id);
    } else if (act === 'linkitem') {
      if (pk && pk.anchor === btn) return closePicker(true);
      linkItemPicker(btn, s.id);
    } else if (act === 'sedit') {
      openSnip(s);
    } else if (act === 'sdel') {
      var nl = itemsLinking(s.id).length + archivedLinking(s.id).length;
      var dmsg = '“' + s.title + '” will be removed from your code library.' +
        (nl ? ' It’s linked to ' + plural(nl, 'item', 'items') + '; those links will show as “Deleted snippet”.' : '');
      confirmDialog({ title: 'Delete this snippet?', message: dmsg }).then(function (ok) {
        if (ok) change({ t: 'snip.del', m: 'DELETE', u: '/api/snippets/' + encodeURIComponent(s.id), k: s.id, label: s.title });
      });
    }
  });

  var snipTypeSel = document.getElementById('snipType');
  var snipProjSel = document.getElementById('snipProj');
  snipTypeSel.addEventListener('change', function () { snipFilter.type = snipTypeSel.value; renderSnippets(); });
  snipProjSel.addEventListener('change', function () { snipFilter.project = snipProjSel.value; renderSnippets(); });
  document.getElementById('tagFilters').addEventListener('click', function (e) {
    var b = e.target.closest('.tagbtn'); if (!b) return;
    if (b.dataset.more) {
      if (pk && pk.anchor === b) return closePicker(true);
      var counts = {};
      snippets.forEach(function (s) { s.tags.forEach(function (x) { counts[x] = (counts[x] || 0) + 1; }); });
      var all = Object.keys(counts).sort(function (a, c) { return counts[c] - counts[a] || a.localeCompare(c); });
      openPicker(b, {
        label: 'Filter by tag', placeholder: 'Search tags…', empty: 'No tags match.',
        refocus: function () { return document.querySelector('#tagFilters [data-more]'); },
        rows: function (q) {
          return all.filter(function (x) { return !q || x.indexOf(q.replace(/^#/, '')) >= 0; }).map(function (x) {
            return { id: x, html: '<span class="pk-t">#' + esc(x) + '</span><span class="pk-sub">' + counts[x] + '</span>' };
          });
        },
        onPick: function (x) { snipFilter.tag = x; renderSnippets(); }
      });
      return;
    }
    snipFilter.tag = snipFilter.tag === b.dataset.tag ? 'all' : b.dataset.tag; // click again to clear
    renderSnippets();
  });
  document.getElementById('snipActive').addEventListener('click', function (e) {
    var b = e.target.closest('[data-clear]'); if (!b) return;
    var k = b.dataset.clear, tok = b.dataset.t;
    if (k === 'all' || k === 'type') snipFilter.type = 'all';
    if (k === 'all' || k === 'project') snipFilter.project = 'all';
    if (k === 'all' || k === 'tag') snipFilter.tag = 'all';
    if (k === 'all') snipFilter.q = '';
    else if (k === 'tok' || k === 'q') {
      // Take that part out of the search box; the rest of what was typed stays.
      var words = snipFilter.q.trim().split(/\s+/).filter(Boolean);
      snipFilter.q = words.filter(function (w) {
        var isTag = snipCtx.query.tags.indexOf(w.slice(1).toLowerCase()) >= 0 && w.charAt(0) === '#';
        return k === 'tok' ? w.slice(1).toLowerCase() !== tok || w.charAt(0) !== '#' : isTag;
      }).join(' ');
    }
    searchEl.value = snipFilter.q;
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
    // A new snippet starts in the project being looked at.
    var dp = snipFilter.project !== 'all' ? snipFilter.project : (filters.project !== 'all' && board.projects.indexOf(filters.project) >= 0 ? filters.project : '');
    document.getElementById('sProjects').value = s ? projsOf(s).join(', ') : dp;
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
      projects: snipProjects(document.getElementById('sProjects').value),
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

  /* ==========================================================
   * Archive
   * ========================================================== */
  var archListEl = document.getElementById('archList');
  var archBannerEl = document.getElementById('archBanner');
  var archSearch = document.getElementById('archSearch');
  var archProjSel = document.getElementById('archProj');
  var archGrpSel = document.getElementById('archGrp');
  var archStageSel = document.getElementById('archStage');
  var archDoneBtn = document.getElementById('archDone');

  function loadArchive() {
    archLoaded = true; // set up front so concurrent callers don't double-fetch
    return api('GET', '/api/archive').then(function (a) {
      writeCache('archive', a);
      archive = { items: a.items || [], projects: a.projects || [] };
      applyPending('arch'); // changes not saved yet stay on screen
      renderArchive();
    }).catch(function (e) {
      archLoaded = false; // try again next time the page is opened
      if (e.offline) {
        goOffline();
        if (archive) return; // keep what's on screen
        var copy = readCache('archive');
        if (copy) { archive = { items: copy.items || [], projects: copy.projects || [] }; applyPending('arch'); renderArchive(); return; }
      }
      archListEl.innerHTML = '<p class="empty">Could not load the archive.<br><br>' + esc(e.message) + '</p>';
    });
  }

  function oneStage(name, k) { var o = {}; o[name] = k; return o; }
  function oneColor(name, map) { var o = {}; if (map && map[name]) o[name] = map[name]; return o; }
  function closedRec(name) {
    var list = archive ? archive.projects : [];
    for (var i = 0; i < list.length; i++) if (list[i].name === name) return list[i];
    return null;
  }
  function shortTitle(t) { return t.length > 40 ? t.slice(0, 39) + '…' : t; }

  // Move items off the board (any status). Undo sends them back.
  function archiveItemsNow(items) {
    var now = new Date().toISOString();
    var copies = items.map(function (i) { var c = clone(i); c.archivedAt = now; return c; });
    for (var n = 0; n < copies.length; n += 1000) { // the server takes up to 1000 at a time
      var part = copies.slice(n, n + 1000);
      change({ t: 'arch.add', m: 'POST', u: '/api/archive', b: { ids: part.map(function (i) { return i.id; }) }, k: part[0].id,
        label: part.length === 1 ? part[0].title : part.length + ' items', snap: { items: part, colors: {} } });
    }
    return copies;
  }
  function archiveOne(id) {
    var it = itemById(id); if (!it) return;
    var copy = archiveItemsNow([it])[0];
    toast('“' + shortTitle(copy.title) + '” archived', false, function () {
      sendRestore([copy]);
      toast('Restored to the board', true);
    });
  }
  function sendRestore(items) {
    var colors = {}, stages = {};
    if (archive) archive.projects.forEach(function (p) { if (p.color) colors[p.name] = p.color; if (p.stage) stages[p.name] = p.stage; });
    change({ t: 'arch.restore', m: 'POST', u: '/api/archive/restore', b: { ids: items.map(function (i) { return i.id; }) }, k: items[0].id,
      label: items.length === 1 ? items[0].title : items.length + ' items', snap: { items: items.map(clone), colors: colors, stages: stages } });
  }
  function restoreOne(id) {
    var it = archItemById(id); if (!it) return;
    var title = it.title;
    sendRestore([it]);
    toast('“' + shortTitle(title) + '” restored to the board', true);
  }

  archDoneBtn.addEventListener('click', function () {
    var items = board.items.filter(function (i) { return i.status === 'done' && inScope(i); });
    var n = items.length; if (!n) return;
    var parts = [];
    if (filters.prio !== 'all') parts.push(PLAB[filters.prio] + ' priority');
    if (filters.project !== 'all') parts.push(filters.project);
    if (filters.group !== 'all') parts.push(filters.group);
    if (filters.q.trim()) parts.push('“' + filters.q.trim() + '”');
    var msg = (parts.length ? 'Done items in ' + parts.join(' · ') : 'All done items') + ' will move to the Archive, where you can restore them.';
    confirmDialog({ title: 'Archive ' + n + ' done item' + (n === 1 ? '' : 's') + '?', message: msg, ok: 'Archive', plain: true }).then(function (ok) {
      if (!ok) return;
      archiveItemsNow(items);
      toast(n + ' item' + (n === 1 ? '' : 's') + ' archived', true);
    });
  });

  function archProjName(it) { return it.project || '(no project)'; }
  function archProjChip(name) {
    var k = projColor(name), rec = closedRec(name);
    if (!k && rec && PROJ_COLORS.some(function (c) { return c.k && c.k === rec.color; })) k = rec.color;
    return projChip(name, k);
  }
  // An archived item's stage: its own, or its closed project's.
  function archStage(it) {
    if (stageIdx(it.stage) >= 0) return it.stage;
    var rec = it.project && closedRec(it.project);
    return rec && stageIdx(rec.stage) >= 0 ? rec.stage : '';
  }
  function archMatches(it) {
    if (archFilter.stage !== 'all' && archStage(it) !== archFilter.stage) return false;
    if (archFilter.project !== 'all' && archProjName(it) !== archFilter.project) return false;
    if (archFilter.group !== 'all' && !groupsOf(it).some(function (g) { return sameText(g, archFilter.group); })) return false;
    var q = archFilter.q.trim().toLowerCase();
    if (!q) return true;
    var hay = [it.title, it.note, it.group, it.project].concat((it.subtasks || []).map(function (x) { return x.text; })).join('\n').toLowerCase();
    return q.split(/\s+/).every(function (t) { return hay.indexOf(t) >= 0; });
  }
  function setOptions(sel, opts, value) {
    sel.innerHTML = opts.map(function (o) { return '<option value="' + esc(o.v) + '">' + esc(o.t) + '</option>'; }).join('');
    sel.value = value; syncSelect(sel);
  }

  function renderArchive() {
    if (!archive) { archListEl.innerHTML = '<p class="empty">Loading…</p>'; return; }
    var items = archive.items;

    var names = [];
    items.forEach(function (it) { var n = archProjName(it); if (names.indexOf(n) < 0) names.push(n); });
    archive.projects.forEach(function (p) { if (names.indexOf(p.name) < 0) names.push(p.name); });
    names.sort(function (a, b) { return a.localeCompare(b); });
    if (archFilter.project !== 'all' && names.indexOf(archFilter.project) < 0) archFilter.project = 'all';
    setOptions(archProjSel, [{ v: 'all', t: 'All projects' }].concat(names.map(function (n) {
      var r = closedRec(n), d = r && fmtDate(r.closedAt);
      return { v: n, t: r ? n + ' · closed' + (d ? ' ' + d : '') : n };
    })), archFilter.project);

    setOptions(archStageSel, [{ v: 'all', t: 'All stages' }].concat(STAGES.map(function (s) { return { v: s.k, t: s.name }; })), archFilter.stage);

    var groups = [];
    items.forEach(function (it) {
      if (archFilter.project !== 'all' && archProjName(it) !== archFilter.project) return;
      groupsOf(it).forEach(function (g) { if (!groups.some(function (x) { return sameText(x, g); })) groups.push(g); });
    });
    groups.sort(function (a, b) { return a.localeCompare(b); });
    if (archFilter.group !== 'all' && !groups.some(function (g) { return sameText(g, archFilter.group); })) archFilter.group = 'all';
    setOptions(archGrpSel, [{ v: 'all', t: 'All groups' }].concat(groups.map(function (g) { return { v: g, t: g }; })), archFilter.group);

    var rec = archFilter.project !== 'all' ? closedRec(archFilter.project) : null;
    if (rec) {
      var cn = items.filter(function (it) { return archProjName(it) === rec.name; }).length, cd = fmtDate(rec.closedAt);
      archBannerEl.innerHTML = '<div class="arch-banner"><p><b>' + esc(rec.name) + '</b> was closed' + (cd ? ' on ' + cd : '') + ' · ' + cn + ' item' + (cn === 1 ? '' : 's') +
        '</p><button type="button" class="btn sm primary" data-act="reopen">Reopen project</button></div>';
    } else {
      archBannerEl.innerHTML = '';
    }

    var vis = items.filter(archMatches).sort(function (a, b) { return String(b.archivedAt || '').localeCompare(String(a.archivedAt || '')); });
    if (!items.length) {
      archListEl.innerHTML = '<p class="empty">Nothing archived yet. Done items you archive will show here.</p>';
    } else if (!vis.length) {
      archListEl.innerHTML = '<p class="empty">No matches</p>';
    } else {
      archListEl.innerHTML = '<ul class="arch-items">' + vis.map(archRowHTML).join('') + '</ul>';
    }
    if (detailArchId) renderArchiveDetail();
  }

  function archRowHTML(it) {
    var st = it.status || 'open';
    var h = '<li class="arch-row" data-id="' + esc(it.id) + '"><div class="arch-main">';
    h += '<button type="button" class="arch-title" data-act="open">' + esc(it.title) + '</button>';
    h += '<div class="meta"><span class="pill static ' + st + '">' + SLAB[st] + '</span>';
    if (it.project) h += archProjChip(it.project);
    if (archStage(it)) h += stageChip(archStage(it), 'Stage');
    groupsOf(it).forEach(function (g) { h += '<span class="chip">' + esc(g) + '</span>'; });
    var steps = it.subtasks || [];
    if (steps.length) {
      var sd = stepsDone(it), label = sd + ' of ' + steps.length + ' steps done';
      h += '<span class="steps' + (sd === steps.length ? ' all' : '') + '" title="' + label + '" aria-label="' + label + '">' + ICON.steps + sd + '/' + steps.length + '</span>';
    }
    h += '</div>';
    var dates = [];
    if (fmtDate(it.doneAt)) dates.push('Done ' + fmtDate(it.doneAt));
    if (fmtDate(it.archivedAt)) dates.push('Archived ' + fmtDate(it.archivedAt));
    if (dates.length) h += '<p class="arch-dates">' + dates.join(' · ') + '</p>';
    h += '</div><button type="button" class="btn sm" data-act="restore" aria-label="Restore: ' + esc(it.title) + '">Restore</button></li>';
    return h;
  }

  archListEl.addEventListener('click', function (e) {
    var row = e.target.closest('.arch-row'); if (!row) return;
    var btn = e.target.closest('[data-act]');
    if (btn && btn.dataset.act === 'restore') restoreOne(row.dataset.id);
    else openArchiveDetail(row.dataset.id);
  });
  archBannerEl.addEventListener('click', function (e) {
    if (!e.target.closest('[data-act="reopen"]')) return;
    var name = archFilter.project, rec = closedRec(name); if (!rec) return;
    var items = archive.items.filter(function (it) { return archProjName(it) === name; });
    var n = items.length, colors = {}, stages = {};
    if (rec.color) colors[name] = rec.color;
    if (rec.stage) stages[name] = rec.stage;
    confirmDialog({ title: 'Reopen ' + name + '?', message: 'The project and its ' + n + ' item' + (n === 1 ? '' : 's') + ' go back on the board.', ok: 'Reopen', plain: true }).then(function (ok) {
      if (!ok) return;
      archFilter.project = 'all'; archFilter.group = 'all';
      change({ t: 'proj.reopen', m: 'POST', u: '/api/projects/' + encodeURIComponent(name) + '/reopen', k: name, label: name,
        snap: { items: items.map(clone), colors: colors, stages: stages } });
      toast(name + ' reopened', true);
    });
  });
  archSearch.addEventListener('input', function () { archFilter.q = archSearch.value; renderArchive(); });
  archSearch.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && archSearch.value) { e.stopPropagation(); archSearch.value = ''; archFilter.q = ''; renderArchive(); }
  });
  archProjSel.addEventListener('change', function () { archFilter.project = archProjSel.value; renderArchive(); });
  archStageSel.addEventListener('change', function () { archFilter.stage = archStageSel.value; renderArchive(); });
  archGrpSel.addEventListener('change', function () { archFilter.group = archGrpSel.value; renderArchive(); });

  // Read-only look at an archived item, in the same popup as board items.
  function openArchiveDetail(id) {
    detailId = null; detailArchId = id;
    renderArchiveDetail();
    detailBg.classList.add('open');
    setTimeout(function () { var b = detailEl.querySelector('[data-dact="close"]'); if (b) b.focus(); }, 30);
  }
  function renderArchiveDetail() {
    var it = archItemById(detailArchId);
    if (!it) { closeDetail(); return; }
    var st = it.status || 'open', pr = it.prio || 'medium', steps = it.subtasks || [], sd = stepsDone(it);
    detailEl.className = 'modal detail ' + pr;
    var h = '<div class="d-top"><div class="d-crumbs"><span class="d-prio">' + PLAB[pr] + '</span>';
    if (it.project) h += archProjChip(it.project);
    if (archStage(it)) h += stageChip(archStage(it), 'Stage');
    groupsOf(it).forEach(function (g) { h += '<span class="chip">' + esc(g) + '</span>'; });
    h += '</div><h2 id="dTitle">' + esc(it.title) + '</h2></div><div class="d-body">';
    h += '<div class="d-section"><p class="d-label">Status</p><span class="pill static ' + st + '">' + SLAB[st] + '</span></div>';
    h += '<div class="d-section"><p class="d-label">Description</p>' +
      (it.note ? '<p class="d-note">' + esc(it.note) + '</p>' : '<p class="d-note muted">No description.</p>') + '</div>';
    if (steps.length) {
      h += '<div class="d-section"><div class="d-labelrow"><p class="d-label">Checklist</p><span class="sub-count">' + sd + ' of ' + steps.length + '</span></div>' +
        '<ul class="sub-list">' + steps.map(function (x) {
          return '<li class="sub' + (x.done ? ' done' : '') + '"><input type="checkbox" class="sub-cb" disabled' + (x.done ? ' checked' : '') +
            ' aria-label="' + (x.done ? 'Done' : 'Not done') + ': ' + esc(x.text) + '"><span class="sub-ro">' + esc(x.text) + '</span></li>';
        }).join('') + '</ul></div>';
    }
    h += datesHTML(it) + '</div>';
    h += '<div class="d-foot"><span class="grow"></span><button class="btn sm" data-dact="close">Close</button>' +
      '<button class="btn sm primary" data-dact="restore">Restore</button></div>';
    var prev = detailEl.querySelector('.d-body');
    var scroll = prev ? prev.scrollTop : 0;
    detailEl.innerHTML = h;
    var body = detailEl.querySelector('.d-body'); if (body && scroll) body.scrollTop = scroll;
  }

  /* ---------- global keys ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (closePop(true)) return;
      if (closePicker(true)) return;
      if (closeConfirm(false)) return;
      if (qaBg.classList.contains('open')) return qaClose();
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
    // Ctrl+Z undoes the last change while its message is showing. In a text
    // field it's left alone, so it undoes typing as usual.
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'z' || e.key === 'Z')) {
      if (!typing && toastUndo && runUndo()) e.preventDefault();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal-bg.open') || appEl.classList.contains('gated')) return;
    if (e.key === '/') { e.preventDefault(); (page === 'snippets' ? searchEl : page === 'archive' ? archSearch : boardSearch).focus(); }
    else if ((e.key === 'n' || e.key === 'N') && page === 'board') { e.preventDefault(); openAdd(); }
    else if ((e.key === 'q' || e.key === 'Q') && page === 'board') { e.preventDefault(); openQuickAdd(); }
  });

  /* ==========================================================
   * Pages, session and sign-in gate
   * ========================================================== */
  var gateEl = document.getElementById('gate');

  function showPage(name) {
    page = name === 'snippets' || name === 'archive' ? name : 'board';
    appEl.dataset.page = page;
    document.body.dataset.page = page;
    applyAccent(); // project colour only applies on the board
    document.getElementById('boardView').hidden = page !== 'board';
    document.getElementById('snippetsView').hidden = page !== 'snippets';
    document.getElementById('archiveView').hidden = page !== 'archive';
    document.getElementById('topTitle').textContent = { snippets: 'Snippets', archive: 'Archive', board: 'Board' }[page];
    try { history.replaceState(null, '', page === 'board' ? location.pathname : '#' + page); } catch (_) {}
    if (page === 'snippets' && !snipsLoaded) loadSnippets();
    if (page === 'archive') { if (!archLoaded) loadArchive(); else renderArchive(); }
    closePop(); closePicker();
    renderNav();
  }

  function setGated(on) {
    appEl.classList.toggle('gated', on);
    gateEl.hidden = !on;
    if (on) {
      document.getElementById('boardView').hidden = true;
      document.getElementById('snippetsView').hidden = true;
      document.getElementById('archiveView').hidden = true;
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
    archLoaded = false; archive = null;
    showPage(location.hash === '#snippets' ? 'snippets' : location.hash === '#archive' ? 'archive' : 'board');
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
