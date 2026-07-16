import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const pageSourceUrl = new URL("./page.tsx", import.meta.url);
const stylesSourceUrl = new URL("../../../../globals.css", import.meta.url);

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
});
