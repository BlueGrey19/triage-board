// Network retry in lib/github.js, against a fake fetch.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const gh = require('../../lib/github');

const realFetch = global.fetch;
beforeEach(() => { global.fetch = realFetch; });
afterEach(() => { global.fetch = realFetch; });

function dropErr() {
  const e = new TypeError('fetch failed');
  e.cause = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' });
  return e;
}
// First `failures` fetches throw like a dropped socket, then succeed.
function fakeFetch(failures, status = 200) {
  let calls = 0;
  global.fetch = async () => {
    calls++;
    if (calls <= failures) throw dropErr();
    return new Response(JSON.stringify({ ok: true }), { status, headers: { 'content-type': 'application/json' } });
  };
  return () => calls;
}

test('one drop is retried (2 calls)', async () => {
  const n = fakeFetch(1);
  assert.deepEqual(await gh.request('t', 'GET', '/x'), { ok: true });
  assert.equal(n(), 2);
});

test('two drops are retried (3 calls)', async () => {
  const n = fakeFetch(2);
  await gh.request('t', 'PUT', '/x', { a: 1 });
  assert.equal(n(), 3);
});

test('gives up after 3 tries with a clear 503', async () => {
  const n = fakeFetch(3);
  await assert.rejects(gh.request('t', 'GET', '/x'),
    e => e.status === 503 && e.network === true && /Couldn't reach GitHub/.test(e.message));
  assert.equal(n(), 3);
});

test('GitHub 502 is retried', async () => {
  let c = 0;
  global.fetch = async () => (++c === 1 ? new Response('{}', { status: 502 }) : new Response('{"ok":1}', { status: 200 }));
  await gh.request('t', 'GET', '/x');
  assert.equal(c, 2);
});

test('404 is not retried', async () => {
  let c = 0;
  global.fetch = async () => { c++; return new Response('{"message":"Not Found"}', { status: 404 }); };
  await assert.rejects(gh.request('t', 'GET', '/x'), e => e.status === 404 && !e.network);
  assert.equal(c, 1);
});

test('token refresh retries a drop', async () => {
  let calls = 0;
  global.fetch = async () => {
    if (++calls === 1) throw dropErr();
    return new Response(JSON.stringify({ access_token: 'x', refresh_token: 'y', expires_in: 10 }), { status: 200 });
  };
  const t = await gh.refreshToken({ clientId: 'a', clientSecret: 'b', refreshToken: 'c' });
  assert.equal(t.accessToken, 'x');
  assert.equal(calls, 2);
});
