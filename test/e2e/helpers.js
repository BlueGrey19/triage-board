/**
 * Browser-test fixtures. Each test gets its own copy of the app: a temp data
 * folder holding the seed board, a free port, and a local-mode server
 * (no .env, no GitHub). Nothing here touches data/ or real GitHub.
 *
 *   const { test, expect } = require('./helpers');
 *   test.use({ seed: { projects: [], projectColors: {}, items: [] } });
 *   test('name', async ({ browser, app }) => { app.baseURL, app.dataDir });
 */

const base = require('@playwright/test');
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function startApp(seed) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'triage-e2e-'));
  fs.writeFileSync(path.join(dataDir, 'board.json'), typeof seed === 'string' ? seed : JSON.stringify(seed));
  const port = await freePort();
  const baseURL = 'http://localhost:' + port;
  let output = '';
  const child = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(port), BASE_URL: baseURL, DATA_DIR: dataDir,
      GITHUB_CLIENT_ID: '', GITHUB_CLIENT_SECRET: '', TRIAGE_NO_DOTENV: '1'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });
  let exited = false;
  child.once('exit', () => { exited = true; });

  const stop = async () => {
    if (!exited) {
      const gone = new Promise(r => child.once('exit', r));
      child.kill();
      await gone;
    }
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  };

  const deadline = Date.now() + 30000;
  for (;;) {
    if (exited) { await stop(); throw new Error('Server exited early:\n' + output); }
    try {
      const r = await fetch(baseURL + '/api/board');
      if (r.ok) break;
    } catch (_) { /* not up yet */ }
    if (Date.now() > deadline) { await stop(); throw new Error('Server did not start:\n' + output); }
    await new Promise(r => setTimeout(r, 100));
  }
  return { app: { baseURL, dataDir }, stop };
}

const test = base.test.extend({
  // The board json the server starts with (an object, or a JSON string).
  seed: [{ projects: [], projectColors: {}, items: [] }, { option: true }],

  app: async ({ seed }, use) => {
    const { app, stop } = await startApp(seed);
    try { await use(app); } finally { await stop(); }
  },

  baseURL: async ({ app }, use) => { await use(app.baseURL); }
});

// ok(cond, message) keeps the original check style: a failed check is reported
// but doesn't stop the run. done() records how many checks ran.
function checks(testInfo) {
  let n = 0;
  const ok = (c, m) => { n++; base.expect.soft(c, m).toBeTruthy(); };
  const done = () => {
    testInfo.annotations.push({ type: 'checks', description: String(n) });
    console.log('[' + testInfo.title + '] ' + n + ' checks');
  };
  return { ok, done };
}

module.exports = { test, expect: base.expect, checks };
