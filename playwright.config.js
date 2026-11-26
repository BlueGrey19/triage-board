// Browser tests (npm run test:e2e). Edge on Windows, bundled Chromium elsewhere.
// PW_CHANNEL overrides: e.g. PW_CHANNEL=chromium (after `npx playwright install chromium`).
const { defineConfig } = require('@playwright/test');

const wanted = process.env.PW_CHANNEL !== undefined ? process.env.PW_CHANNEL : (process.platform === 'win32' ? 'msedge' : 'chromium');
const channel = wanted && wanted !== 'chromium' ? wanted : undefined;

module.exports = defineConfig({
  testDir: 'test/e2e',
  // Some checks wait several seconds on purpose, and the suites are long.
  timeout: 6 * 60 * 1000,
  expect: { timeout: 15000 },
  retries: 0,
  // Every spec starts its own server on its own port with its own data folder.
  workers: 4,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    channel,
    // Same defaults the standalone scripts had: Playwright Test has no action timeout unless set.
    actionTimeout: 30000,
    navigationTimeout: 30000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure'
  }
});
