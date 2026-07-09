import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: "list",
  testDir: "./src",
  testMatch: "**/*.spec.ts",
  timeout: 10000
});
