import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/eval',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  reporter: [['list'], ['json', { outputFile: 'test/eval/result.json' }]],
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
