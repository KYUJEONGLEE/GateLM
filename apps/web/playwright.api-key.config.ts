import { defineConfig, devices } from "@playwright/test";

const port = process.env.PORT ?? "3015";
const controlPlanePort = process.env.API_KEY_E2E_CONTROL_PLANE_PORT ?? "3901";
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? `http://127.0.0.1:${port}`;

export default defineConfig({
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  reporter: "list",
  testDir: "./e2e",
  timeout: 60000,
  use: { baseURL, trace: "on-first-retry" },
  webServer: [
    {
      command: "node e2e/api-key-management-mock-server.mjs",
      reuseExistingServer: false,
      timeout: 30000,
      url: `http://127.0.0.1:${controlPlanePort}/healthz`
    },
    {
      command: `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`,
      env: {
        CONTROL_PLANE_BASE_URL: `http://127.0.0.1:${controlPlanePort}`,
        GATELM_CONTROL_PLANE_BASE_URL: `http://127.0.0.1:${controlPlanePort}`
      },
      reuseExistingServer: false,
      timeout: 180000,
      url: baseURL
    }
  ]
});
