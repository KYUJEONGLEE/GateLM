import { defineConfig, devices } from "@playwright/test";

const port = process.env.PORT ?? "3000";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;
const nextDevCommand = `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`;

export default defineConfig({
  expect: {
    timeout: 5000
  },
  fullyParallel: true,
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"]
      }
    }
  ],
  reporter: "list",
  testDir: "./e2e",
  timeout: 30000,
  use: {
    baseURL,
    trace: "on-first-retry"
  },
  webServer: {
    command: nextDevCommand,
    gracefulShutdown: {
      signal: "SIGTERM",
      timeout: 500
    },
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
    url: baseURL
  }
});
