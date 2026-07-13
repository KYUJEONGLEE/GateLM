import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);

test("tenant routing page exposes the Auto modelRef contract without an OFF-state model card", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain('type RoutingMode = "auto" | "manual"');
  expect(pageSource).toContain("Category × difficulty routing matrix");
  expect(pageSource).not.toContain("tenant-manual-routing-title");
  expect(pageSource).not.toContain("Manual model selection");
  expect(pageSource).toContain("modelRefs: string[]");
  expect(pageSource).toContain('const mockBootstrapModelRef = "mock-balanced"');
  expect(pageSource).toContain('data-bootstrap-state={usesMockModels ? "mock_bootstrap" : "configured"}');
  expect(pageSource).toContain("Add fallback");
  expect(pageSource).toContain("data-save-confirmed");
});

test("tenant routing page hard-cuts over from legacy route fields and category labels", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  for (const category of ["general", "code", "translation", "summarization", "reasoning"]) {
    expect(pageSource).toContain(`id: "${category}"`);
  }
  for (const difficulty of ["simple", "complex"]) {
    expect(pageSource).toContain(`id: "${difficulty}"`);
  }
  for (const retiredToken of [
    "defaultRoute",
    "highQualityRoute",
    "offDefaultRoute",
    "fallbackRoute",
    "lowCostModel",
    "defaultModel",
    "highQualityModel",
    "extraction_json",
    "support_refund",
    'id: "unknown"'
  ]) {
    expect(pageSource).not.toContain(retiredToken);
  }
});
