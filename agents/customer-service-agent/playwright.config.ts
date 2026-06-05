import { defineConfig } from '@playwright/test';

// Mobile-first responsive checks for the agent UI. Runs against PW_BASE if set
// (e.g. prod), otherwise boots a local `next start` on :3010.
const BASE = process.env.PW_BASE || 'http://localhost:3010';
const external = Boolean(process.env.PW_BASE);

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: true,
  reporter: [['list']],
  use: { baseURL: BASE, ignoreHTTPSErrors: true },
  projects: [
    { name: 'iphone-se', use: { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true } },
    { name: 'iphone-12', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'tablet', use: { viewport: { width: 768, height: 1024 }, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
  ],
  ...(external
    ? {}
    : {
        webServer: {
          command: 'npm run start -- -p 3010',
          port: 3010,
          reuseExistingServer: true,
          timeout: 120_000,
        },
      }),
});
