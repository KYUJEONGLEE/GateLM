import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const editorSourceUrl = new URL("./runtime-policy-editor.tsx", import.meta.url);
const projectPageSourceUrl = new URL(
  "../../../app/(console)/tenants/[tenantId]/projects/[projectId]/policies/page.tsx",
  import.meta.url
);
const routingSourceUrl = new URL(
  "./runtime-policy-panels/routing-panel.tsx",
  import.meta.url
);
const stylesSourceUrl = new URL("../../../app/globals.css", import.meta.url);

test("project policy settings opt into the responsive full-width editor layout", async () => {
  const [editorSource, projectPageSource, styles] = await Promise.all([
    readFile(editorSourceUrl, "utf8"),
    readFile(projectPageSourceUrl, "utf8"),
    readFile(stylesSourceUrl, "utf8")
  ]);

  expect(projectPageSource).toContain("fullWidth");
  expect(editorSource).toContain('import { ManagementPage } from "@/components/layout/management-page"');
  expect(editorSource).toContain('headerEyebrow={breadcrumb}');
  expect(editorSource).toContain("project-policy-console-content");
  expect(styles).toMatch(
    /\.project-policy-console-content \.policy-section-toolbar,[\s\S]*?\.project-policy-budget-panel \{[\s\S]*?width: 100%;[\s\S]*?max-width: none;/
  );
  expect(styles).toMatch(
    /\.project-policy-console-content[\s\S]*?\.project-detail-general-content,[\s\S]*?\.project-policy-console-content[\s\S]*?\.project-detail-form \{\s*width: 100%;\s*min-width: 0;\s*max-width: none;/
  );
  expect(styles).toMatch(
    /@media \(max-width: 760px\) \{[\s\S]*?\.policy-section-toolbar \{[\s\S]*?flex-direction: column;[\s\S]*?\.policy-section-toolbar \.policy-section-tabs \{[\s\S]*?width: 100%;/
  );
});

test("project policy settings use the shared management typography scale", async () => {
  const styles = await readFile(stylesSourceUrl, "utf8");

  expect(styles).toMatch(
    /\.management-page\.console-content \{[\s\S]*?--management-font-title:[\s\S]*?--management-font-section:[\s\S]*?--management-font-body:[\s\S]*?--management-font-label:/
  );
  expect(styles).toMatch(
    /\.project-policy-console-content \.policy-section-tabs button,[\s\S]*?font-size: var\(--management-font-body\);[\s\S]*?font-weight: var\(--font-weight-semibold\);/
  );
  expect(styles).toMatch(
    /\.project-policy-general-tab\.management-line-content[\s\S]*?\.project-general-name-field[\s\S]*?input \{[\s\S]*?font-size: calc\(var\(--font-size-lg\) \+ var\(--global-font-lift\)\);[\s\S]*?font-weight: var\(--font-weight-semibold\);/
  );
});

test("project policy tabs share the compact routing switch geometry", async () => {
  const [routingSource, styles] = await Promise.all([
    readFile(routingSourceUrl, "utf8"),
    readFile(stylesSourceUrl, "utf8")
  ]);
  const projectPolicyStyles = styles.slice(
    styles.indexOf(".project-policy-console-content {")
  );

  expect(routingSource).toContain(
    'className="tenant-routing-model-card policy-auto-routing-card"'
  );
  expect(routingSource).not.toContain("<span>Auto routing</span>");
  expect(routingSource).toContain('aria-label="Auto routing"');
  expect(projectPolicyStyles).toContain("gap: var(--space-3);");
  expect(projectPolicyStyles).toContain("margin-top: 6px;");
  expect(projectPolicyStyles).toMatch(
    /\.tenant-routing-switch-control \{[\s\S]*?gap: 8px;[\s\S]*?font-size: var\(--font-size-sm\);/
  );
  expect(projectPolicyStyles).toMatch(
    /\.project-policy-console-content \[data-slot="switch"\] \{[\s\S]*?flex: 0 0 56px;[\s\S]*?width: 56px;[\s\S]*?height: 32px;[\s\S]*?border: 0;/
  );
  expect(projectPolicyStyles).toMatch(
    /\.project-policy-console-content \[data-slot="switch"\] \[data-slot="switch-thumb"\] \{[\s\S]*?top: 3px;[\s\S]*?left: 3px;[\s\S]*?width: 26px;[\s\S]*?height: 26px;[\s\S]*?transform: none !important;/
  );
  expect(projectPolicyStyles).toMatch(
    /\[data-slot="switch"\]:is\(\[data-checked\], \[aria-checked="true"\]\)[\s\S]*?left: 27px;/
  );
});

test("project routing role copy uses tighter heading spacing", async () => {
  const [routingSource, styles] = await Promise.all([
    readFile(routingSourceUrl, "utf8"),
    readFile(stylesSourceUrl, "utf8")
  ]);

  expect(routingSource).toContain(
    'className="tenant-routing-model-card policy-category-model-card"'
  );
  expect(styles).toMatch(
    /\.policy-category-model-card \.tenant-routing-model-heading-copy > p \{\s*margin-top: 6px;/
  );
});
