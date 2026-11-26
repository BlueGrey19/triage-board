/**
 * In-memory fake of the parts of GitHub's API the GitHub store uses: the
 * contents API (GET/PUT/DELETE a file) and the GraphQL snippet listing.
 * It replaces global fetch for api.github.com only; every other URL (e.g. a
 * test server on localhost) goes to the real fetch. Never touches the network.
 *
 *   const gh = createFakeGithub();   gh.install();   ...   gh.uninstall();
 *   gh.files    { 'board.json': '<text>', ... }
 *   gh.log      one 'path | commit message' entry per commit, in order
 *   gh.store()  a real lib/store-github.js store talking to this fake
 */

const crypto = require('crypto');
const path = require('path');
const { createGithubStore } = require(path.join(__dirname, '..', '..', 'lib', 'store-github.js'));

const sha = t => crypto.createHash('sha1').update(t).digest('hex');
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });

function socketDrop() {
  const e = new TypeError('fetch failed');
  e.cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
  return e;
}

function createFakeGithub() {
  const files = {};
  const log = [];
  let realFetch = null;
  let failWrite = null;     // { path, status }: reject the next write to path
  let dropReply = null;     // path (or true for any): next write lands, but its reply is lost
  let networkErrors = 0;    // the next N requests fail like a dropped socket

  async function fake(url, opt = {}) {
    const u = new URL(url);
    if (u.host !== 'api.github.com') return realFetch(url, opt);
    if (networkErrors > 0) { networkErrors--; throw socketDrop(); }
    const method = opt.method || 'GET';

    if (u.pathname === '/graphql') {
      const entries = Object.keys(files)
        .filter(p => /^snippets\/[^/]+$/.test(p))
        .map(p => ({ name: p.slice('snippets/'.length), type: 'blob', object: { text: files[p] } }));
      return json({ data: { repository: { object: entries.length ? { entries } : null } } });
    }

    const p = decodeURIComponent(u.pathname.split('/contents/')[1] || '');
    const cur = files[p];
    if (method === 'GET') {
      if (cur === undefined) return json({ message: 'Not Found' }, 404);
      return json({ content: Buffer.from(cur).toString('base64'), sha: sha(cur) });
    }
    const body = JSON.parse(opt.body);
    if (failWrite && failWrite.path === p) {
      const status = failWrite.status;
      failWrite = null;
      return json({ message: 'boom' }, status);
    }
    if (method === 'PUT') {
      if (cur !== undefined && body.sha !== sha(cur)) return json({ message: 'is at ' + sha(cur) + ' but expected ' + body.sha }, 409);
      if (cur === undefined && body.sha) return json({ message: 'sha mismatch' }, 409);
      if (cur !== undefined && !body.sha) return json({ message: '"sha" wasn\'t supplied.' }, 422);
      files[p] = Buffer.from(body.content, 'base64').toString();
      log.push(p + ' | ' + body.message);
      if (dropReply === true || dropReply === p) { dropReply = null; throw socketDrop(); }
      return json({ content: { sha: sha(files[p]) } }, cur !== undefined ? 200 : 201);
    }
    if (method === 'DELETE') {
      if (cur === undefined) return json({ message: 'Not Found' }, 404);
      if (body.sha !== sha(cur)) return json({ message: 'sha mismatch' }, 409);
      delete files[p];
      log.push(p + ' | ' + body.message);
      return json({ commit: {} });
    }
    throw new Error('unexpected ' + method + ' ' + url);
  }

  return {
    files,
    log,
    install() { if (!realFetch) { realFetch = global.fetch; global.fetch = fake; } },
    uninstall() { if (realFetch) { global.fetch = realFetch; realFetch = null; } },
    // The next write to this path is rejected with a status (500 by default).
    failNextWrite(p, status = 500) { failWrite = { path: p, status }; },
    // The next write (to this path, or any) is applied, but the reply never arrives.
    dropNextReply(p = true) { dropReply = p; },
    // The next n requests fail like a dropped connection.
    failNextRequests(n) { networkErrors = n; },
    // A real store-github.js store against this fake.
    store(seed = { projects: [], items: [] }) {
      return createGithubStore({ token: 't', owner: 'me', repo: 'data', seed });
    }
  };
}

module.exports = { createFakeGithub };
