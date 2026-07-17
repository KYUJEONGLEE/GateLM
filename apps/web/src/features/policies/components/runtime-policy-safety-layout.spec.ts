import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const safetyPanelSourceUrl = new URL(
  "./runtime-policy-panels/safety-panel.tsx",
  import.meta.url
);
const stylesSourceUrl = new URL("../../../app/globals.css", import.meta.url);

test("safety detector actions are an always-visible single-choice group", async () => {
  const [source, styles] = await Promise.all([
    readFile(safetyPanelSourceUrl, "utf8"),
    readFile(stylesSourceUrl, "utf8")
  ]);

  expect(source).toContain('(["redact", "block"] as const).map');
  expect(source).toContain("showAllActionOptions");
  expect(source).toContain("showAllActionOptions={showAllActionOptions}");
  expect(source).toContain("data-action={actionValue}");
  expect(source).toContain('className="policy-detector-action-indicator"');
  expect(source).toContain('<legend className="sr-only">');
  expect(source).toContain('type="radio"');
  expect(source).toContain("checked={isSelected}");
  expect(source).toContain("data-selected={isSelected}");
  expect(source).toContain("action: nextAction");
  expect(source).toContain("const showPlaceholder = allowPlaceholderEditing;");
  expect(source).not.toContain(
    'allowPlaceholderEditing && actionValue === "redact"'
  );
  expect(source).not.toContain("policy-detector-edit-button");
  expect(source).not.toContain("setIsEditing");

  expect(styles).toMatch(
    /\.policy-detector-action-group \{[\s\S]*?position: relative;[\s\S]*?display: inline-grid;[\s\S]*?gap: 4px;/
  );
  expect(styles).toMatch(
    /\.policy-detector-action-indicator \{[\s\S]*?transform 220ms cubic-bezier\(0\.2, 0\.8, 0\.2, 1\)/
  );
  expect(styles).toContain(
    '.policy-detector-action-group[data-action="block"] .policy-detector-action-indicator'
  );
  expect(styles).toContain("transform: translateX(calc(100% + 4px));");
  expect(styles).toContain(
    '.policy-detector-mode-button[data-selected="true"][data-action="redact"]'
  );
  expect(styles).toContain(
    '.policy-detector-mode-button[data-selected="true"][data-action="block"]'
  );
  expect(styles).toContain("--policy-redact-soft: #dcfce7;");
  expect(styles).toContain("--policy-redact-border: #4ade80;");
  expect(styles).toContain("--policy-redact-text: #15803d;");
  expect(styles).toContain("--policy-redact-soft: rgb(20 83 45 / 58%);");
  expect(styles).toContain("--policy-redact-border: #22c55e;");
  expect(styles).toContain("--policy-redact-text: #bbf7d0;");
});
