import { expect, test } from "@playwright/test";
import { resolveProviderDisplay } from "./display-identifiers";

test("derives the provider family from a bounded model when the provider is opaque", () => {
  expect(resolveProviderDisplay(
    "00000000-0000-4000-8000-000000000500",
    "gpt-5.4-mini"
  )).toEqual({ family: "openai", label: "OpenAI" });
  expect(resolveProviderDisplay("provider-claude", "claude-sonnet-4")).toEqual({
    family: "anthropic",
    label: "Anthropic"
  });
  expect(resolveProviderDisplay("provider-gemini", "gemini-2.5-flash")).toEqual({
    family: "google",
    label: "Google"
  });
});

test("does not display an unknown provider UUID", () => {
  expect(resolveProviderDisplay(
    "00000000-0000-4000-8000-000000000500",
    "custom-model"
  )).toEqual({ family: "unknown", label: "Provider" });
  expect(resolveProviderDisplay("internal-provider", "custom-model")).toEqual({
    family: "unknown",
    label: "internal-provider"
  });
});
