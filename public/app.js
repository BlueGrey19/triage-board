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
  var STATUSES = ['open', 'doing', 'blocked', 'done'];
  var SLAB = { open: 'Open', doing: 'Doing', blocked: 'Blocked', done: 'Done' };
  var SCOLOR = { open: 'var(--st-open)', doing: 'var(--st-doing)', blocked: 'var(--st-blocked)', done: 'var(--st-done)' };
  var SRANK = { doing: 0, blocked: 1, open: 2, done: 3 };

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
    blocked: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></svg>',
    done:    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 11.1V12a10 10 0 1 1-5.9-9.1"/><polyline points="22 4 12 14 9 11"/></svg>'
  };

  // Local view of server state.
  var board = { projects: [], items: [] };
  // prio / project come from the sidebar; view comes from the status tiles.
  var filters = { prio: 'all', project: 'all', view: 'all' };
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
          throw new Error(data.error || ('Request failed (' + r.status + ')'));
        }
        return data;
      });
    });
  }

  function loadBoard() {
    return api('GET', '/api/board').then(function (b) {
      board = b;
      // keep the active project filter valid
      if (filters.project !== 'all' && projectOrder().indexOf(filters.project) < 0) filters.project = 'all';
      render();
    }).catch(function (e) {
      boardEl.innerHTML = '<p class="empty">Could not reach the server.<br>Is it still running in your terminal?<br><br>' + esc(e.message) + '</p>';
    });
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
  function inScope(it) {
    if (filters.prio !== 'all' && (it.prio || 'medium') !== filters.prio) return false;
    if (filters.project !== 'all' && (it.project || '(no project)') !== filters.project) return false;
    return true;
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
  function cardHTML(it, showProject) {
    var st = it.status || 'open';
    var h = '<article class="card s-' + st + '" data-id="' + esc(it.id) + '" draggable="true" tabindex="0" aria-label="' + esc(it.title) + '">';
    h += '<button class="check" data-act="done" aria-label="' + (st === 'done' ? 'Mark not done' : 'Mark done') + '">' + ICON.check + '</button>';
    h += '<h3 class="ct">' + esc(it.title) + '</h3>';
    h += '<button class="more" data-act="more" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">' + ICON.more + '</button>';
    h += '<div class="meta">';
    h += '<button class="pill ' + st + '" data-act="status" aria-haspopup="menu" title="Change status">' + SLAB[st] + '</button>';
    if (showProject && it.project) h += '<span class="chip proj">' + esc(it.project) + '</span>';
    if (it.group) h += '<span class="chip">' + esc(it.group) + '</span>';
    if (it.note) h += '<span class="has-note" title="Has a description">' + ICON.note + '</span>';
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
    h += '<span class="band-count" title="Not done">' + openCount + '</span>';
    h += '<button class="band-add" data-act="band-add" data-p="' + p.k + '" title="Add a ' + p.name + ' item" aria-label="Add a ' + p.name + ' item">' + ICON.plus + '</button></div>';

    if (filters.view === 'done') {
      h += '<div class="band-body" data-band="' + p.k + '">' +
        (done.length ? done.map(function (i) { return cardHTML(i, showProject); }).join('') : '<p class="drophint">Nothing done yet</p>') + '</div>';
    } else {
      h += '<div class="band-body" data-band="' + p.k + '">' +
        (open.length ? open.map(function (i) { return cardHTML(i, showProject); }).join('')
                     : '<p class="drophint">' + (filters.view === 'all' || filters.view === 'active' ? 'Nothing open. Drop a card here' : 'None') + '</p>') + '</div>';
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
      blocked: scoped.filter(function (i) { return i.status === 'blocked'; }).length,
      done: scoped.filter(function (i) { return i.status === 'done'; }).length
    };
    var tiles = [
      { k: 'active',  lab: 'Not done', c: 'var(--acc)' },
      { k: 'doing',   lab: 'Doing',    c: SCOLOR.doing },
      { k: 'blocked', lab: 'Blocked',  c: SCOLOR.blocked },
      { k: 'done',    lab: 'Done',     c: SCOLOR.done }
    ];
    return tiles.map(function (t) {
      return '<button class="stat" style="--c:' + t.c + '" data-view="' + t.k + '" aria-pressed="' + (filters.view === t.k) + '" title="Show only ' + t.lab.toLowerCase() + ' items (click again for all)">' +
        '<span class="stat-ico">' + ICON[t.k] + '</span>' +
        '<span class="stat-txt"><span class="stat-lab">' + t.lab + '</span><span class="stat-num">' + n[t.k] + '</span></span></button>';
    }).join('');
  }

  function render() {
    var scoped = board.items.filter(inScope);
    var showProject = filters.project === 'all';
    var bands = filters.prio === 'all' ? PRIOS : PRIOS.filter(function (p) { return p.k === filters.prio; });

    // header
    var title = 'All items';
    if (filters.prio !== 'all') title = PLAB[filters.prio] + ' priority';
    else if (filters.project !== 'all') title = esc(filters.project);
    document.getElementById('boardTitle').innerHTML = title;
    var done = scoped.filter(function (i) { return i.status === 'done'; }).length;
    document.getElementById('doneN').textContent = done;
    document.getElementById('totN').textContent = scoped.length;
    document.getElementById('leftN').textContent = scoped.length - done;
    document.getElementById('barFill').style.width = (scoped.length ? done / scoped.length * 100 : 0) + '%';
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
    refreshGroupDatalist();
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
      return '<button class="nav-item" data-nav="project" data-v="' + esc(p) + '"' + (page === 'board' && filters.project === p ? ' aria-current="page"' : '') + '>' +
        '<span class="nav-dot" style="--c:var(--purple)"></span><span>' + esc(p) + '</span><span class="nav-count">' + (n || '') + '</span></button>';
    }).join('') : '<p class="nav-empty">No projects yet</p>';

    var allBoard = page === 'board' && filters.prio === 'all' && filters.project === 'all';
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
  document.getElementById('stats').addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]'); if (!b) return;
    filters.view = filters.view === b.dataset.view ? 'all' : b.dataset.view;
    render();
  });

  /* ---------- mutations (optimistic: update locally, then reload) ---------- */
  function patchItem(id, patch) {
    var it = itemById(id); if (it) Object.assign(it, patch); render(); // instant feedback
    api('PATCH', '/api/items/' + id, patch).then(loadBoard).catch(function (e) { toast(e.message); loadBoard(); });
  }
  function deleteItem(id) {
    api('DELETE', '/api/items/' + id).then(loadBoard).catch(function (e) { toast(e.message); });
  }
  function confirmDelete(id) {
    var it = itemById(id);
    if (it && confirm('Delete "' + it.title + '"?')) { closeDetail(); deleteItem(id); }
  }

  /* ---------- popover menu ---------- */
  var popEl = document.getElementById('pop');
  var popAnchor = null, popHandler = null;
  function openPop(anchor, html, handler) {
    closePop();
    popEl.innerHTML = html; popEl.hidden = false;
    popAnchor = anchor; popHandler = handler;
    anchor.setAttribute('aria-expanded', 'true');
    var r = anchor.getBoundingClientRect(), pw = popEl.offsetWidth, ph = popEl.offsetHeight;
    var left = Math.min(Math.max(8, r.left), window.innerWidth - pw - 8);
    var top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    popEl.style.left = left + 'px'; popEl.style.top = top + 'px';
    var first = popEl.querySelector('button'); if (first) first.focus({ preventScroll: true });
  }
  function closePop() {
    if (popEl.hidden) return false;
    popEl.hidden = true; popEl.innerHTML = '';
    if (popAnchor) popAnchor.setAttribute('aria-expanded', 'false');
    popAnchor = null; popHandler = null;
    return true;
  }
  popEl.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !popHandler) return;
    var h = popHandler; closePop(); h(b.dataset);
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

  /* ---------- board interactions ---------- */
  boardEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]');
    var card = e.target.closest('.card');
    if (btn) {
      var act = btn.dataset.act;
      if (act === 'band-add') return openAdd(btn.dataset.p);
      if (act === 'done-toggle') { openDone[btn.dataset.p] = !openDone[btn.dataset.p]; return render(); }
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
    if (it.project) h += '<span class="chip proj">' + esc(it.project) + '</span>';
    if (it.group) h += '<span class="chip">' + esc(it.group) + '</span>';
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
  function refreshGroupDatalist() {
    var dl = document.getElementById('groupList'); if (!dl) return;
    var seen = {}, opts = '';
    board.items.forEach(function (i) { if (i.group && !seen[i.group]) { seen[i.group] = 1; opts += '<option value="' + esc(i.group) + '">'; } });
    dl.innerHTML = opts;
  }
  function openAdd(prio) {
    editingId = null;
    document.getElementById('mTitle').textContent = 'New item';
    document.getElementById('mSave').textContent = 'Add to board';
    mErr.textContent = '';
    document.getElementById('mTitleIn').value = '';
    document.getElementById('mGroup').value = '';
    document.getElementById('mNote').value = '';
    var sel = document.getElementById('mProj');
    fillProjectSelect(sel);
    if (filters.project !== 'all' && board.projects.indexOf(filters.project) >= 0) sel.value = filters.project;
    document.getElementById('mPrio').value = prio || (filters.prio !== 'all' ? filters.prio : 'medium');
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
    var req = editingId
      ? api('PATCH', '/api/items/' + editingId, payload)
      : api('POST', '/api/items', payload);
    // if adding into a filtered-out priority/project/status, relax filters so it's visible
    if (!editingId) {
      if (filters.prio !== 'all' && filters.prio !== payload.prio) filters.prio = 'all';
      if (filters.project !== 'all' && filters.project !== payload.project) filters.project = 'all';
      if (filters.view !== 'all' && filters.view !== 'active') filters.view = 'all';
    }
    req.then(function () { closeModal(); return loadBoard(); })
       .catch(function (e) { mErr.textContent = e.message; });
  });

  /* ---------- manage projects modal ---------- */
  var projBg = document.getElementById('projBg');
  var pErr = document.getElementById('pErr');

  function renderProjList() {
    var ul = document.getElementById('plist');
    if (!board.projects.length) { ul.innerHTML = '<li><span class="pn" style="color:var(--text-3)">No projects yet. Add one below.</span></li>'; return; }
    ul.innerHTML = board.projects.map(function (p) {
      var n = board.items.filter(function (i) { return i.project === p; }).length;
      return '<li><span class="pn">' + esc(p) + '</span><span class="pcount">' + n + ' item' + (n === 1 ? '' : 's') + '</span>' +
             '<button class="prm" data-p="' + esc(p) + '">Remove</button></li>';
    }).join('');
  }
  function openProj() { pErr.textContent = ''; document.getElementById('pNewIn').value = ''; renderProjList(); projBg.classList.add('open'); closeMenu(); setTimeout(function () { document.getElementById('pNewIn').focus(); }, 30); }
  function closeProj() { projBg.classList.remove('open'); }

  document.getElementById('manageProj').addEventListener('click', function (e) { e.stopPropagation(); openProj(); });
  document.getElementById('pClose').addEventListener('click', closeProj);
  projBg.addEventListener('click', function (e) { if (e.target === projBg) closeProj(); });

  function addProject() {
    var name = document.getElementById('pNewIn').value.trim();
    if (!name) { pErr.textContent = 'Type a project name.'; return; }
    api('POST', '/api/projects', { name: name })
      .then(function (b) { board = b; document.getElementById('pNewIn').value = ''; pErr.textContent = ''; renderProjList(); render(); })
      .catch(function (e) { pErr.textContent = e.message; });
  }
  document.getElementById('pAdd').addEventListener('click', addProject);
  document.getElementById('pNewIn').addEventListener('keydown', function (e) { if (e.key === 'Enter') addProject(); });

  document.getElementById('plist').addEventListener('click', function (e) {
    var b = e.target.closest('.prm'); if (!b) return;
    var name = b.dataset.p;
    var n = board.items.filter(function (i) { return i.project === name; }).length;
    var msg = n > 0
      ? 'Remove "' + name + '" from your project list?\n\nThe ' + n + ' item' + (n === 1 ? '' : 's') + ' tagged with it will stay on the board (still labelled "' + name + '").'
      : 'Remove "' + name + '"?';
    if (!confirm(msg)) return;
    api('DELETE', '/api/projects/' + encodeURIComponent(name))
      .then(function (bd) { board = bd; if (filters.project === name) filters.project = 'all'; renderProjList(); render(); })
      .catch(function (e) { pErr.textContent = e.message; });
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
  var snipFilter = { q: '', tag: 'all' };
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
      snippets = list; renderSnippets();
    }).catch(function (e) {
      snipsLoaded = false;
      snipsEl.innerHTML = '<p class="empty">Could not load snippets.<br><br>' + esc(e.message) + '</p>';
    });
  }

  function snipMatches(s) {
    if (snipFilter.tag !== 'all' && s.tags.indexOf(snipFilter.tag) < 0) return false;
    var q = snipFilter.q.trim().toLowerCase();
    if (!q) return true;
    var hay = (s.title + '\n' + s.description + '\n' + s.tags.join(' ') + '\n' + s.code).toLowerCase();
    return q.split(/\s+/).every(function (t) { return hay.indexOf(t) >= 0; });
  }
  function snipById(id) {
    for (var i = 0; i < snippets.length; i++) if (snippets[i].id === id) return snippets[i];
    return null;
  }

  function renderSnippets() {
    document.getElementById('navSnipCount').textContent = snippets.length || '';

    // tag chips, most-used first
    var counts = {};
    snippets.forEach(function (s) { s.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var tags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    if (snipFilter.tag !== 'all' && !counts[snipFilter.tag]) snipFilter.tag = 'all';
    var chips = tags.length ? '<button class="tagbtn" data-tag="all" aria-pressed="' + (snipFilter.tag === 'all') + '">All <span class="c">' + snippets.length + '</span></button>' : '';
    tags.forEach(function (t) {
      chips += '<button class="tagbtn" data-tag="' + esc(t) + '" aria-pressed="' + (snipFilter.tag === t) + '">#' + esc(t) + ' <span class="c">' + counts[t] + '</span></button>';
    });
    document.getElementById('tagFilters').innerHTML = chips;
    document.getElementById('tagList').innerHTML = tags.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('');

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
          (s.tags.length ? '<span class="sitem-tags">' + s.tags.map(function (t) { return '#' + esc(t); }).join('  ') + '</span>' : '') +
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
    } else if (act === 'sedit') {
      openSnip(s);
    } else if (act === 'sdel') {
      if (!confirm('Delete snippet "' + s.title + '"?')) return;
      api('DELETE', '/api/snippets/' + encodeURIComponent(s.id)).then(loadSnippets).catch(function (er) { toast(er.message); });
    }
  });

  document.getElementById('tagFilters').addEventListener('click', function (e) {
    var b = e.target.closest('.tagbtn'); if (!b) return;
    snipFilter.tag = b.dataset.tag; renderSnippets();
  });

  var searchEl = document.getElementById('snipSearch');
  searchEl.addEventListener('input', function () { snipFilter.q = searchEl.value; renderSnippets(); });

  function openSnip(s) {
    editingSnip = s ? s.id : null;
    document.getElementById('sTitle').textContent = s ? 'Edit snippet' : 'New snippet';
    sErr.textContent = '';
    document.getElementById('sTitleIn').value = s ? s.title : '';
    document.getElementById('sLang').value = s ? s.language : 'deluge';
    document.getElementById('sTags').value = s ? s.tags.join(', ') : (snipFilter.tag !== 'all' ? snipFilter.tag : '');
    document.getElementById('sDesc').value = s ? s.description : '';
    document.getElementById('sCode').value = s ? s.code : '';
    snipBg.classList.add('open');
    setTimeout(function () { document.getElementById('sTitleIn').focus(); }, 30);
  }
  function closeSnip() { snipBg.classList.remove('open'); editingSnip = null; }

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
      tags: document.getElementById('sTags').value,
      description: document.getElementById('sDesc').value.trim(),
      code: code
    };
    var btn = this; btn.disabled = true;
    var wasNew = !editingSnip;
    var req = editingSnip
      ? api('PATCH', '/api/snippets/' + encodeURIComponent(editingSnip), payload)
      : api('POST', '/api/snippets', payload);
    req.then(function (saved) {
      closeSnip();
      if (wasNew && saved && saved.id) selectedSnip = saved.id;
      return loadSnippets();
    })
       .catch(function (e) { sErr.textContent = e.message; })
       .then(function () { btn.disabled = false; });
  });

  /* ---------- global keys ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (closePop()) return;
      if (modalBg.classList.contains('open')) return closeModal();
      if (snipBg.classList.contains('open')) return closeSnip();
      if (projBg.classList.contains('open')) return closeProj();
      if (detailBg.classList.contains('open')) return closeDetail();
      if (appEl.classList.contains('menu-open')) return closeMenu();
    }
    var tag = (e.target.tagName || '').toLowerCase();
    if (e.key === '/' && page === 'snippets' && tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
      e.preventDefault(); searchEl.focus();
    }
  });

  /* ==========================================================
   * Pages, session and sign-in gate
   * ========================================================== */
  var gateEl = document.getElementById('gate');

  function showPage(name) {
    page = name === 'snippets' ? 'snippets' : 'board';
    appEl.dataset.page = page;
    document.body.dataset.page = page;
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

  function gateSetup(s) {
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
      '<div class="macts"><form method="post" action="/auth/logout"><button class="btn" type="submit">Sign out</button></form>' +
      '<button class="btn primary" id="gateRetry">I’ve done this, check again</button></div></div>';
    document.getElementById('gateRetry').addEventListener('click', boot);
  }

  function enterApp(s) {
    setGated(false);
    var gh = s.mode === 'github';
    document.getElementById('syncTxt').textContent = gh ? 'Synced to GitHub' : 'Saved locally';
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
  }

  function boot() {
    api('GET', '/api/session').then(function (s) {
      if (!s.signedIn) return gateLogin();
      if (!s.ready) return gateSetup(s);
      enterApp(s);
    }).catch(function (e) {
      boardEl.innerHTML = '<p class="empty">Could not reach the server.<br>Is it still running?<br><br>' + esc(e.message) + '</p>';
    });
  }

  /* ---------- go ---------- */
  boot();
})();
