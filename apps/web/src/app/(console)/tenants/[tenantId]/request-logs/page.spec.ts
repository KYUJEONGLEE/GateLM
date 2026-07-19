import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);
const stylesSourceUrl = new URL("../../../../globals.css", import.meta.url);
const requestLogTableSourceUrl = new URL(
  "../../../../../features/request-logs/components/request-log-table.tsx",
  import.meta.url
);
const requestLogDetailSourceUrl = new URL(
  "../../../../../features/request-logs/components/request-log-detail.tsx",
  import.meta.url
);

test("request logs validates tenant access before directory or Gateway reads", async () => {
  const pageSource = await readFile(pageSourceUrl, "utf8");
  const accessGuardIndex = pageSource.indexOf(
    "if (!hasConsoleTenantAccess(auth, effectiveTenantId))"
  );
  const projectsReadIndex = pageSource.indexOf("getProjectsModel(effectiveTenantId)");
  const employeesReadIndex = pageSource.indexOf("getTenantEmployees(effectiveTenantId)");
  const gatewayReadIndex = pageSource.indexOf("getLiveGatewayRequestLogsWithMeta({");

  expect(accessGuardIndex).toBeGreaterThan(-1);
  expect(projectsReadIndex).toBeGreaterThan(accessGuardIndex);
  expect(employeesReadIndex).toBeGreaterThan(accessGuardIndex);
  expect(gatewayReadIndex).toBeGreaterThan(accessGuardIndex);
});

test("request log table stays full width with compact text and rows", async () => {
  const styles = await readFile(stylesSourceUrl, "utf8");

  expect(styles).toMatch(
    /\.request-log-screen \.request-table \{[^}]*width: 100%;[^}]*table-layout: fixed;/
  );
  expect(styles).toMatch(
    /\.request-log-screen \.request-table th,\s*\.request-log-screen \.request-table td \{\s*padding: 10px 14px;/
  );
  expect(styles).toMatch(
    /\.request-log-screen \.request-table \{\s*font-size: calc\(var\(--font-size-xs\) \+ var\(--global-font-lift\)\);/
  );
  expect(styles).toMatch(/\.request-log-col-time \{\s*width: 12%;/);
  expect(styles).toMatch(/\.request-log-col-model \{\s*width: 19%;/);
  expect(styles).toMatch(/\.request-log-col-cost \{\s*width: 10\.334%;/);
  expect(styles).toMatch(
    /\.request-log-screen \.request-table th:first-child,[\s\S]*?min-width: 84px;/
  );
});

test("request log list uses compact costs and stronger typography without changing detail cost precision", async () => {
  const [tableSource, detailSource, styles] = await Promise.all([
    readFile(requestLogTableSourceUrl, "utf8"),
    readFile(requestLogDetailSourceUrl, "utf8"),
    readFile(stylesSourceUrl, "utf8")
  ]);

  expect(tableSource).toContain("maximumFractionDigits: 3");
  expect(tableSource).toContain("minimumFractionDigits: 3");
  expect(tableSource).not.toContain("request-log-list-end");
  expect(tableSource).not.toContain("rangeEndLabel");
  expect(detailSource).toContain("maximumFractionDigits: 6");
  expect(styles).toMatch(
    /\.request-log-hero h2 \{[^}]*font-weight: var\(--font-weight-bold\);/
  );
  expect(styles).toMatch(
    /\.request-log-screen \.request-table :is\(th, td\),[\s\S]*?font-weight: var\(--font-weight-semibold\);/
  );
});
