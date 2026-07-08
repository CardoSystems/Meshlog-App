const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60 * 1000, // 1 minute timeout per test
  expect: {
    timeout: 10000
  },
  fullyParallel: false,
  retries: 0,
  workers: 1, // We only want to run one test at a time against local wrangler
  reporter: 'list',
  outputDir: './tests/debug-artifacts',
  use: {
    headless: false,
    actionTimeout: 0,
    baseURL: 'http://127.0.0.1:8787',
    trace: 'on',
    screenshot: 'on',
    video: 'on',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    }
  ],
  webServer: {
    command: 'npx wrangler dev',
    url: 'http://127.0.0.1:8787', // Playwright will poll this until it responds 200
    timeout: 120 * 1000,
    reuseExistingServer: !process.env.CI,
  },
});
