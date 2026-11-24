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
    if (e.key === 'Escape') {
      if (modalBg.classList.contains('open')) closeModal();
      if (projBg.classList.contains('open')) closeProj();
      if (snipBg.classList.contains('open')) closeSnip();
    }
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
  function toast(msg, ok) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl); }
    toastEl.textContent = msg;
    toastEl.classList.toggle('ok', !!ok);
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('show'); }, ok ? 1600 : 3200);
  }

  /* ==========================================================
   * Snippet library
   * ========================================================== */
  var snippets = [];
  var snipsLoaded = false;
  var snipFilter = { q: '', tag: 'all' };
  var editingSnip = null;
  var snipsEl = document.getElementById('snips');
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
    return api('GET', '/api/snippets').then(function (list) {
      snippets = list; snipsLoaded = true; renderSnippets();
    }).catch(function (e) {
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

  function snipHTML(s) {
    var h = '<article class="card snip" data-sid="' + esc(s.id) + '">';
    h += '<div class="snip-head"><h3 class="ct">' + esc(s.title) + '</h3><span class="lang">' + esc(LANG_LABEL[s.language] || s.language) + '</span></div>';
    if (s.tags.length) {
      h += '<div class="tags">' + s.tags.map(function (t) {
        return '<button class="tag stag" data-act="tag" data-tag="' + esc(t) + '">#' + esc(t) + '</button>';
      }).join('') + '</div>';
    }
    if (s.description) h += '<p class="reason">' + esc(s.description) + '</p>';
    h += '<pre class="code"><code class="hljs">' + highlight(s.code, s.language) + '</code></pre>';
    h += '<div class="cfoot"><button class="copy" data-act="copy">copy code</button><span class="grow"></span>';
    h += '<button class="edit" data-act="sedit" title="Edit snippet">edit</button>';
    h += '<button class="del" data-act="sdel" title="Delete snippet" aria-label="Delete snippet">✕</button></div>';
    h += '</article>';
    return h;
  }

  function renderSnippets() {
    // tag chips, most-used first
    var counts = {};
    snippets.forEach(function (s) { s.tags.forEach(function (t) { counts[t] = (counts[t] || 0) + 1; }); });
    var tags = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a] || a.localeCompare(b); });
    if (snipFilter.tag !== 'all' && !counts[snipFilter.tag]) snipFilter.tag = 'all';
    var chips = '<button class="f" data-tag="all" aria-pressed="' + (snipFilter.tag === 'all') + '">All <span class="c">' + snippets.length + '</span></button>';
    tags.forEach(function (t) {
      chips += '<button class="f" data-tag="' + esc(t) + '" aria-pressed="' + (snipFilter.tag === t) + '">#' + esc(t) + ' <span class="c">' + counts[t] + '</span></button>';
    });
    document.getElementById('tagFilters').innerHTML = chips;
    document.getElementById('tagList').innerHTML = tags.map(function (t) { return '<option value="' + esc(t) + '">'; }).join('');

    var vis = snippets.filter(snipMatches);
    if (!snippets.length) {
      snipsEl.innerHTML = '<p class="empty">No snippets yet. Hit <b>+ New snippet</b> to save your first one.</p>';
    } else if (!vis.length) {
      snipsEl.innerHTML = '<p class="empty">Nothing matches that search.</p>';
    } else {
      snipsEl.innerHTML = '<div class="snip-grid">' + vis.map(snipHTML).join('') + '</div>';
    }
  }

  function snipById(id) {
    for (var i = 0; i < snippets.length; i++) if (snippets[i].id === id) return snippets[i];
    return null;
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

  snipsEl.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-act]'); if (!btn) return;
    var card = btn.closest('[data-sid]'); if (!card) return;
    var s = snipById(card.dataset.sid); if (!s) return;
    var act = btn.dataset.act;
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
    var b = e.target.closest('.f'); if (!b) return;
    snipFilter.tag = b.dataset.tag; renderSnippets();
  });

  var searchEl = document.getElementById('snipSearch');
  searchEl.addEventListener('input', function () { snipFilter.q = searchEl.value; renderSnippets(); });
  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (e.key === '/' && currentTab === 'snippets' && tag !== 'input' && tag !== 'textarea' && tag !== 'select') {
      e.preventDefault(); searchEl.focus();
    }
  });

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
    var req = editingSnip
      ? api('PATCH', '/api/snippets/' + encodeURIComponent(editingSnip), payload)
      : api('POST', '/api/snippets', payload);
    req.then(function () { closeSnip(); return loadSnippets(); })
       .catch(function (e) { sErr.textContent = e.message; })
       .then(function () { btn.disabled = false; });
  });

  /* ==========================================================
   * Tabs, session and sign-in gate
   * ========================================================== */
  var currentTab = 'board';
  var gateEl = document.getElementById('gate');

  function showTab(name) {
    currentTab = name === 'snippets' ? 'snippets' : 'board';
    document.getElementById('boardView').hidden = currentTab !== 'board';
    document.getElementById('progRow').hidden = currentTab !== 'board';
    document.getElementById('snippetsView').hidden = currentTab !== 'snippets';
    document.querySelectorAll('#tabs [data-tab]').forEach(function (b) {
      b.setAttribute('aria-selected', String(b.dataset.tab === currentTab));
    });
    try { history.replaceState(null, '', currentTab === 'snippets' ? '#snippets' : location.pathname); } catch (_) {}
    if (currentTab === 'snippets' && !snipsLoaded) loadSnippets();
  }
  document.getElementById('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]'); if (b) showTab(b.dataset.tab);
  });

  function setGated(on) {
    gateEl.hidden = !on;
    document.getElementById('tabs').hidden = on;
    if (on) {
      document.getElementById('boardView').hidden = true;
      document.getElementById('snippetsView').hidden = true;
      document.getElementById('progRow').hidden = true;
    }
  }

  function gateLogin() {
    setGated(true);
    document.getElementById('who').hidden = true;
    document.getElementById('kicker').textContent = 'Priority triage · stored in your GitHub';
    gateEl.innerHTML =
      '<div class="gate-card"><h2>Sign in</h2>' +
      '<p>Your board and snippet library live in a private GitHub repo that only you can see. ' +
      'Every change is a commit, so you get full history for free.</p>' +
      '<a class="addbtn big" href="/auth/login">Sign in with GitHub</a></div>';
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
      '<div class="macts"><form method="post" action="/auth/logout"><button class="mbtn" type="submit">Sign out</button></form>' +
      '<button class="mbtn primary" id="gateRetry">I’ve done this, check again</button></div></div>';
    document.getElementById('gateRetry').addEventListener('click', boot);
  }

  function enterApp(s) {
    setGated(false);
    var kicker = document.getElementById('kicker');
    if (s.mode === 'github') {
      kicker.textContent = 'Priority triage · synced to GitHub';
      var who = document.getElementById('who');
      who.hidden = false;
      document.getElementById('whoAvatar').src = s.user.avatar || '';
      var repoA = document.getElementById('whoRepo');
      repoA.textContent = s.repo;
      repoA.href = 'https://github.com/' + s.repo;
      if (s.repoPrivate === false) toast('Heads up: ' + s.repo + ' is PUBLIC. Make it private in its GitHub settings.');
    } else {
      kicker.textContent = 'Priority triage · saved locally';
    }
    snipsLoaded = false;
    showTab(location.hash === '#snippets' ? 'snippets' : 'board');
    loadBoard();
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
