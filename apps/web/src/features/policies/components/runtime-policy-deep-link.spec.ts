import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const editorUrl = new URL("./runtime-policy-editor.tsx", import.meta.url);
const pageUrl = new URL(
  "../../../app/(console)/tenants/[tenantId]/projects/[projectId]/policies/page.tsx",
  import.meta.url
);

test("project policy deep links whitelist the request-limit tab", async () => {
  const pageSource = await readFile(pageUrl, "utf8");
  expect(pageSource).toContain('"rate-limit": "rateLimit"');
  expect(pageSource).toContain("initialPolicySection={normalizePolicySection(query?.tab)}");
  expect(pageSource).not.toContain("query?.tab as PolicySection");
});

test("policy tabs update history without remounting the editor draft", async () => {
  const editorSource = await readFile(editorUrl, "utf8");
  const selectorStart = editorSource.indexOf("function selectPolicySection");
  const selectorEnd = editorSource.indexOf("\n  return (", selectorStart);
  const selector = editorSource.slice(selectorStart, selectorEnd);

  expect(editorSource).toContain("initialPolicySection ?? getDefaultPolicySection");
  expect(selector).toContain("setActivePolicySection(section)");
  expect(selector).toContain("window.history.replaceState(");
  expect(selector).not.toContain("router.replace(");
  expect(selector).not.toContain("router.push(");
});
