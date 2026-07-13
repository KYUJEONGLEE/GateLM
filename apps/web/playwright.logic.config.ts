import { defineConfig } from "@playwright/test";

export default defineConfig({
  reporter: "list",
  testDir: "./e2e",
  testMatch: [
    "runtime-policy-editor-utils.spec.ts",
    "runtime-policy-routing-v2.spec.ts"
  ],
  timeout: 10000
});
