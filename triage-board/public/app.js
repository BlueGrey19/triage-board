/* Triage Board — frontend.
 * Talks to the local server's /api endpoints. The server owns the data
 * (data/board.json); this file just renders it and sends changes back.
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
  var STATUSES = ['open', 'doing', 'blocked', 'done'];
  var SLAB = { open: 'Open', doing: 'Doing', blocked: 'Blocked', done: 'Done' };
  var CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';

  // Local view of server state.
  var board = { projects: [], items: [] };
  var filters = { project: 'all', view: 'all' };
  var editingId = null; // when set, the add-modal is in "edit" mode

  var boardEl = document.getElementById('board');

  /* ---------- tiny API client ---------- */
  function api(method, url, body) {
    return fetch(url, {
      method: method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (data) {
        if (!r.ok) throw new Error(data.error || ('Request failed (' + r.status + ')'));
        return data;
      });
    });
  }

  function loadBoard() {
    return api('GET', '/api/board').then(function (b) {
      board = b;
      // keep the active project filter valid
      if (filters.project !== 'all' && board.projects.indexOf(filters.project) < 0) {
        filters.project = 'all';
      }
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
  function visible(it) {
    if (filters.project !== 'all' && it.project !== filters.project) return false;
    if (filters.view === 'open') return it.status !== 'done';
    if (filters.view === 'done') return it.status === 'done';
    if (filters.view === 'blocked') return it.status === 'blocked';
    return true;
  }
  function itemById(id) {
    for (var i = 0; i < board.items.length; i++) if (board.items[i].id === id) return board.items[i];
    return null;
  }
  // Project order for subgroups: user's configured order first, then any
  // leftover project labels found on items (e.g. from a removed project).
  function projectOrder() {
    var order = board.projects.slice();
    board.items.forEach(function (it) {
      var p = it.project || '(no project)';
      if (order.indexOf(p) < 0) order.push(p);
    });
    return order;
  }

  /* ---------- render ---------- */
  function cardHTML(it) {
    var st = it.status || 'open', pr = it.prio || 'medium';
    var h = '<article class="card s-' + st + '" data-id="' + it.id + '" draggable="true">';
    h += '<div class="crow"><button class="check" data-act="done" aria-label="Toggle done">' + CHECK + '</button>';
    h += '<h3 class="ct">' + esc(it.title) + '</h3></div>';
    if (it.group) h += '<div class="tags"><span class="tag grp">' + esc(it.group) + '</span></div>';
    if (it.note) h += '<p class="reason">' + esc(it.note) + '</p>';
    h += '<div class="seg" role="group" aria-label="Set status">';
    STATUSES.forEach(function (s) {
      h += '<button data-act="set" data-s="' + s + '" aria-pressed="' + (st === s) + '">' + SLAB[s] + '</button>';
    });
    h += '</div>';
    h += '<div class="cfoot"><div class="prio-sel">';
    h += '<button class="prio-btn" data-act="prio-toggle" aria-haspopup="true">priority: <span class="cur">' + PLAB[pr] + '</span> \u25be</button>';
    h += '<div class="prio-menu" role="menu">';
    PRIOS.forEach(function (p) {
      h += '<button data-act="prio-set" data-p="' + p.k + '" aria-pressed="' + (p.k === pr) + '"><span class="pd"></span>' + p.name + '</button>';
    });
    h += '</div></div><span class="grow"></span>';
    h += '<button class="edit" data-act="edit" title="Edit item">edit</button>';
    h += '<button class="del" data-act="del" title="Delete item" aria-label="Delete item">\u2715</button>';
    h += '</div></article>';
    return h;
  }

  function render() {
    // project filter chips (rebuilt each time so new projects appear)
    var pf = document.getElementById('projFilters');
    var chips = '<button class="f proj" data-k="project" data-v="all" aria-pressed="' + (filters.project === 'all') + '">All projects <span class="c">' + board.items.length + '</span></button>';
    board.projects.forEach(function (p) {
      var n = board.items.filter(function (i) { return i.project === p; }).length;
      chips += '<button class="f proj" data-k="project" data-v="' + esc(p) + '" aria-pressed="' + (filters.project === p) + '">' + esc(p) + ' <span class="c">' + n + '</span></button>';
    });
    pf.innerHTML = chips;

    document.querySelectorAll('#stateFilters .f').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.v === filters.view));
    });

    // bands
    var html = '';
    PRIOS.forEach(function (p) {
      var inBand = board.items.filter(function (i) { return (i.prio || 'medium') === p.k; });
      // hide a band entirely only when a project filter empties it of everything
      var scoped = inBand.filter(function (i) { return filters.project === 'all' || i.project === filters.project; });
      if (filters.project !== 'all' && scoped.length === 0) return;

      var vis = inBand.filter(visible);
      var doneN = scoped.filter(function (i) { return i.status === 'done'; }).length;

      html += '<section class="band ' + p.k + '" data-band="' + p.k + '">';
      html += '<div class="band-head"><span class="dot"></span>';
      html += '<div><h2 class="band-name">' + p.name + '</h2></div>';
      html += '<span class="band-prog">' + doneN + ' / ' + scoped.length + ' done</span></div>';

      if (vis.length === 0) {
        html += '<div class="band-body" data-band="' + p.k + '"><p class="drophint">Drop a card here to set ' + p.name + '</p></div>';
      } else {
        // segregate by project within the band
        projectOrder().forEach(function (proj) {
          var group = vis.filter(function (i) { return (i.project || '(no project)') === proj; });
          if (group.length === 0) return;
          html += '<div class="pgroup">';
          html += '<div class="pgroup-head"><span class="pgroup-tab">' + esc(proj) + '</span><span class="pgroup-line"></span><span class="pgroup-count">' + group.length + '</span></div>';
          html += '<div class="band-body" data-band="' + p.k + '">' + group.map(cardHTML).join('') + '</div>';
          html += '</div>';
        });
      }
      html += '</section>';
    });
    if (!html) html = '<p class="empty">No items yet. Hit <b>+ Add item</b> to create your first one.</p>';
    boardEl.innerHTML = html;

    // progress
    var total = board.items.length;
    var done = board.items.filter(function (i) { return i.status === 'done'; }).length;
    document.getElementById('doneN').textContent = done;
    document.getElementById('totN').textContent = total;
    document.getElementById('leftN').textContent = total - done;
    document.getElementById('barFill').style.width = (total ? done / total * 100 : 0) + '%';

    refreshGroupDatalist();
  }

  /* ---------- mutations (optimistic-ish: call API then reload) ---------- */
  function patchItem(id, patch) {
    var it = itemById(id); if (it) Object.assign(it, patch); render(); // instant feedback
    api('PATCH', '/api/items/' + id, patch).then(loadBoard).catch(function (e) { toast(e.message); loadBoard(); });
  }
  function deleteItem(id) {
    api('DELETE', '/api/items/' + id).then(loadBoard).catch(function (e) { toast(e.message); });
  }

  /* ---------- board interactions ---------- */
  boardEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]'); if (!btn) return;
    var card = btn.closest('[data-id]'); if (!card) return;
    var id = card.dataset.id, act = btn.dataset.act;

    if (act === 'done') {
      var cur = itemById(id);
      patchItem(id, { status: cur && cur.status === 'done' ? 'open' : 'done' });
    } else if (act === 'set') {
      patchItem(id, { status: btn.dataset.s });
    } else if (act === 'prio-toggle') {
      var menu = btn.nextElementSibling, isOpen = menu.classList.contains('open');
      closeMenus(); if (!isOpen) menu.classList.add('open'); e.stopPropagation();
    } else if (act === 'prio-set') {
      patchItem(id, { prio: btn.dataset.p });
    } else if (act === 'edit') {
      openEdit(id);
    } else if (act === 'del') {
      var it = itemById(id);
      if (it && confirm('Delete "' + it.title + '"?')) deleteItem(id);
    }
  });
  function closeMenus() { document.querySelectorAll('.prio-menu.open').forEach(function (m) { m.classList.remove('open'); }); }
  document.addEventListener('click', closeMenus);

  /* ---------- filters ---------- */
  document.getElementById('projFilters').addEventListener('click', function (e) {
    var b = e.target.closest('.f'); if (!b) return;
    filters.project = b.dataset.v; render();
  });
  document.getElementById('stateFilters').addEventListener('click', function (e) {
    var b = e.target.closest('.f'); if (!b) return;
    filters.view = b.dataset.v; render();
  });

  /* ---------- drag & drop between priority bands ---------- */
  var dragId = null;
  boardEl.addEventListener('dragstart', function (e) {
    var card = e.target.closest('.card'); if (!card) return;
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
    var body = e.target.closest('.band-body'); if (!body) return;
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
  function openAdd() {
    editingId = null;
    document.getElementById('mTitle').textContent = 'New item';
    document.getElementById('mSave').textContent = 'Add to board';
    mErr.textContent = '';
    document.getElementById('mTitleIn').value = '';
    document.getElementById('mGroup').value = '';
    document.getElementById('mNote').value = '';
    fillProjectSelect(document.getElementById('mProj'));
    document.getElementById('mPrio').value = 'medium';
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

  document.getElementById('addBtn').addEventListener('click', openAdd);
  document.getElementById('mCancel').addEventListener('click', closeModal);
  modalBg.addEventListener('click', function (e) { if (e.target === modalBg) closeModal(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (modalBg.classList.contains('open')) closeModal(); if (projBg.classList.contains('open')) closeProj(); }
  });

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
    // if adding into a filtered-out project/status, relax filters so it's visible
    if (!editingId) {
      if (filters.project !== 'all' && filters.project !== payload.project) filters.project = 'all';
      if (filters.view === 'blocked' || filters.view === 'done') filters.view = 'all';
    }
    req.then(function () { closeModal(); return loadBoard(); })
       .catch(function (e) { mErr.textContent = e.message; });
  });

  /* ---------- manage projects modal ---------- */
  var projBg = document.getElementById('projBg');
  var pErr = document.getElementById('pErr');

  function renderProjList() {
    var ul = document.getElementById('plist');
    if (!board.projects.length) { ul.innerHTML = '<li><span class="pn" style="color:var(--ink3)">No projects yet — add one below.</span></li>'; return; }
    ul.innerHTML = board.projects.map(function (p) {
      var n = board.items.filter(function (i) { return i.project === p; }).length;
      return '<li><span class="pn">' + esc(p) + '</span><span class="pcount">' + n + ' item' + (n === 1 ? '' : 's') + '</span>' +
             '<button class="prm" data-p="' + esc(p) + '">remove</button></li>';
    }).join('');
  }
  function openProj() { pErr.textContent = ''; document.getElementById('pNewIn').value = ''; renderProjList(); projBg.classList.add('open'); setTimeout(function () { document.getElementById('pNewIn').focus(); }, 30); }
  function closeProj() { projBg.classList.remove('open'); }

  document.getElementById('manageProj').addEventListener('click', openProj);
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
      ? 'Remove "' + name + '" from your project list?\n\nThe ' + n + ' item' + (n === 1 ? '' : 's') + ' tagged with it will stay on the board (still labelled "' + name + '"), you just won\u2019t have a filter chip for it.'
      : 'Remove "' + name + '"?';
    if (!confirm(msg)) return;
    api('DELETE', '/api/projects/' + encodeURIComponent(name))
      .then(function (bd) { board = bd; if (filters.project === name) filters.project = 'all'; renderProjList(); render(); })
      .catch(function (e) { pErr.textContent = e.message; });
  });

  /* ---------- toast ---------- */
  var toastEl = null, toastT = null;
  function toast(msg) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 3200);
  }

  /* ---------- go ---------- */
  loadBoard();
})();
