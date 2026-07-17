import { expect, test } from "@playwright/test";

import {
  hasDatedModelVersion,
  hasExcludedGeminiVariant
} from "./provider-model-name";

test("detects dated Provider model versions", () => {
  expect(hasDatedModelVersion("gpt-5.5-2026-04-23")).toBe(true);
  expect(hasDatedModelVersion("gpt-5.4-mini-2026-03-17")).toBe(true);
  expect(hasDatedModelVersion("provider/gpt-5-2026-01-15-preview")).toBe(true);
});

test("keeps undated Provider model aliases", () => {
  expect(hasDatedModelVersion("gpt-5.5")).toBe(false);
  expect(hasDatedModelVersion("gpt-5.4-mini")).toBe(false);
  expect(hasDatedModelVersion("gemini-2.5-flash")).toBe(false);
});

test("detects Gemini preview and 001 variants", () => {
  expect(hasExcludedGeminiVariant("gemini-2.5-pro-preview-05-06")).toBe(true);
  expect(hasExcludedGeminiVariant("gemini-2.0-flash-001")).toBe(true);
  expect(hasExcludedGeminiVariant("models/gemini-2.0-flash-001")).toBe(true);
});

test("keeps stable Gemini aliases and non-Gemini preview models", () => {
  expect(hasExcludedGeminiVariant("gemini-2.5-flash")).toBe(false);
  expect(hasExcludedGeminiVariant("gpt-5-preview")).toBe(false);
  expect(hasExcludedGeminiVariant("provider-001-model")).toBe(false);
});
