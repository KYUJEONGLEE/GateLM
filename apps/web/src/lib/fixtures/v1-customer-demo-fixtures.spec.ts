import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

test("fixture-mode customer demo does not revive legacy selected routing targets", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./v1-customer-demo-fixtures.ts", import.meta.url)),
    "utf8"
  );

  expect(source).not.toMatch(/record\.selectedProvider|record\.selectedModel/);
  expect(source).not.toContain("X-GateLM-Routed-Provider");
  expect(source).not.toContain("X-GateLM-Routed-Model");
  expect(source).toContain('executionMode: "mock"');
  expect(source).toContain("model: record.requestedModel ?? \"auto\"");
});
