import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const apiPort = Number(process.env.E2E_API_PORT || 3102);
const webPort = Number(process.env.E2E_WEB_PORT || 4173);
const configDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'bash ./e2e/scripts/start-api.sh',
      cwd: configDir,
      url: `http://127.0.0.1:${apiPort}/api/health`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `bash -lc 'VITE_API_PROXY_TARGET=http://127.0.0.1:${apiPort} npm run build && VITE_API_PROXY_TARGET=http://127.0.0.1:${apiPort} npm run preview -- --host 127.0.0.1 --port ${webPort}'`,
      cwd: configDir,
      url: `http://127.0.0.1:${webPort}`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
