import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);

test("company policy page exposes routing first with the Claude company default", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");

  expect(pageSource).toContain('type RoutingMode = "auto" | "manual"');
  expect(pageSource).toContain("Workload routing policy");
  expect(pageSource).not.toContain("tenant-manual-routing-title");
  expect(pageSource).not.toContain("Manual model selection");
  expect(pageSource).toContain("modelRefs: string[]");
  expect(pageSource).toContain('const companyDefaultModelRef = "anthropic:claude-sonnet"');
  expect(pageSource).toContain(
    'data-policy-state={usesCompanyDefaultOnly ? "company_default" : "category_override"}'
  );
  expect(pageSource).toContain('title: "Tenant"');
  expect(pageSource).toContain('title: "회사 정책"');
  expect(pageSource).toContain('modelName: "GPT 4o-mini"');
  expect(pageSource).toContain('modelRef: "openai:gpt-4o-mini"');
  expect(pageSource).toContain('fallbackTitle: "Fallback model settings"');
  expect(pageSource).toContain('fallbackTitle: "Fallback 모델 설정"');
  expect(pageSource).toContain("ProviderFamilyIcon");
  expect(pageSource).not.toContain("Add fallback");
  expect(pageSource).not.toContain("moveModelRef");
  expect(pageSource).not.toContain("removeModelRef");
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
    "defaultModel:",
    ".defaultModel",
    "highQualityModel",
    "extraction_json",
    "support_refund",
    'id: "unknown"'
  ]) {
    expect(pageSource).not.toContain(retiredToken);
  }
});
