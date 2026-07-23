import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

const overviewSourceUrl = new URL("./analytics-v5-overview.tsx", import.meta.url);
const panelsSourceUrl = new URL("./analytics-panels.tsx", import.meta.url);
const v3StylesSourceUrl = new URL("../analytics-v3.css", import.meta.url);
const v5StylesSourceUrl = new URL("../analytics-v5.css", import.meta.url);

test("policy impact prioritizes cost evidence without duplicating usage charts", async () => {
  const source = await readFile(overviewSourceUrl, "utf8");

  expect(source).toContain('knownSavings: "확인된 절감 비용"');
  expect(source).toContain('partialSavings: "부분 집계"');
  expect(source).toContain("model.impact.savedCostMicroUsd");
  expect(source).toContain("AnalyticsV5ModelShareChart");
  expect(source).toContain("AnalyticsV5RoutingDifficultyChart");
  expect(source).not.toContain("AnalyticsV5ProjectUsageChart");
  expect(source).not.toContain("AnalyticsV5ModelTrafficChart");
});

test("cache, security, and cost panels use compact decision-focused summaries", async () => {
  const source = await readFile(panelsSourceUrl, "utf8");
  const cachePanel = source.slice(
    source.indexOf("export function AnalyticsCachePanel"),
    source.indexOf("function PanelShell")
  );

  expect(cachePanel).toContain('className="analytics-v3-cache-ring"');
  expect(cachePanel).toContain('className="analytics-v3-cache-outcomes"');
  expect(cachePanel).not.toContain("AnalyticsRankedBarChart");
  expect(source).toContain('className="analytics-v3-security-summary"');
  expect(source).toContain("employeeSourceRows");
  expect(source).toContain("<AnalyticsCostAttributionChart");
});

test("performance evidence uses a concrete reader-facing title", async () => {
  const source = await readFile(panelsSourceUrl, "utf8");

  expect(source).toContain('slow: "최장 지연 요청"');
  expect(source).not.toContain('"느린 요청 근거"');
  expect(source).not.toContain('"캐시 운영 근거"');
});

test("cache panel omits redundant source evidence and savings scope copy", async () => {
  const source = await readFile(panelsSourceUrl, "utf8");
  const cachePanel = source.slice(
    source.indexOf("export function AnalyticsCachePanel"),
    source.indexOf("function PanelShell")
  );

  expect(cachePanel).not.toContain("사용 경로별 캐시 현황");
  expect(cachePanel).not.toContain("Project/Application 기록 기준");
  expect(cachePanel).not.toContain("<EvidenceTable");
});

test("security panel omits redundant usage-surface evidence table", async () => {
  const source = await readFile(panelsSourceUrl, "utf8");
  const securityPanel = source.slice(
    source.indexOf("export function AnalyticsSecurityPanel"),
    source.indexOf("export function AnalyticsCachePanel")
  );

  expect(securityPanel).not.toContain("사용 경로별 보안 근거");
  expect(securityPanel).not.toContain("<EvidenceTable");
  expect(securityPanel).toContain("employeeSourcesTitle");
});

test("cost panel replaces employee cost paths with spend destination", async () => {
  const source = await readFile(panelsSourceUrl, "utf8");
  const costPanel = source.slice(
    source.indexOf("export function AnalyticsCostPanel"),
    source.indexOf("export function AnalyticsPerformancePanel")
  );

  expect(costPanel).toContain('byProject: "비용 사용처"');
  expect(costPanel).not.toContain('"직원별 비용 경로"');
  expect(costPanel.match(/microUsdMaximumFractionDigits=\{2\}/g)).toHaveLength(2);
  expect(costPanel.match(/valueLabelFontSize=\{12\}/g)).toHaveLength(2);
  expect(costPanel.match(/<AnalyticsCostAttributionChart/g)).toHaveLength(1);
  expect(costPanel.indexOf("<AnalyticsCostAttributionChart")).toBeLessThan(
    costPanel.lastIndexOf("</div>")
  );
});

test("new analytics summaries keep responsive one-column fallbacks", async () => {
  const [v3Styles, v5Styles] = await Promise.all([
    readFile(v3StylesSourceUrl, "utf8"),
    readFile(v5StylesSourceUrl, "utf8")
  ]);

  expect(v3Styles).toMatch(
    /\.analytics-v3-cache-insight-body \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
  );
  expect(v3Styles).toMatch(
    /\.analytics-v3-cost-attribution-layout \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
  );
  expect(v3Styles).toMatch(
    /\.analytics-v3-employee-workspace \.analytics-v3-cost-attribution-layout \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
  );
  expect(v5Styles).toMatch(
    /\.analytics-v5-model-share-layout \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/
  );
});

test("confirmed savings keeps its amount on one line on mobile", async () => {
  const styles = await readFile(v5StylesSourceUrl, "utf8");

  expect(styles).toMatch(
    /@media \(max-width: 760px\) \{[\s\S]*?\.analytics-v5-metric-primary > div \{[\s\S]*?flex-direction: column;/
  );
  expect(styles).toMatch(
    /@media \(max-width: 760px\) \{[\s\S]*?\.analytics-v5-metric-primary > div > strong \{[\s\S]*?overflow-wrap: normal;[\s\S]*?white-space: nowrap;/
  );
});

test("analytics category tabs keep compact vertical spacing", async () => {
  const styles = await readFile(v5StylesSourceUrl, "utf8");

  expect(styles).toMatch(
    /\.console-content\.analytics-v5-page \{\s*gap: 8px;\s*\}/
  );
  expect(styles).toMatch(
    /\.analytics-v5-page \.analytics-v3-subtabs \{\s*padding-top: 6px;\s*\}/
  );
  expect(styles).toMatch(
    /\.analytics-v5-page \.analytics-v3-panel,[\s\S]*?\.analytics-v5-overview \{[\s\S]*?padding: 12px 0 48px;/
  );
});

test("all analytics panels reuse the policy impact card language", async () => {
  const styles = await readFile(v3StylesSourceUrl, "utf8");

  expect(styles).toMatch(
    /\.analytics-v3-executive-band \{[\s\S]*?border: 1px solid var\(--border-strong\);[\s\S]*?border-radius: 10px;/
  );
  expect(styles).toMatch(
    /\.analytics-v3-workspace \{[\s\S]*?gap: 14px;/
  );
  expect(styles).toMatch(
    /\.analytics-v3-analysis-surface \{[\s\S]*?border: 1px solid var\(--border\);[\s\S]*?border-radius: 10px;[\s\S]*?box-shadow: var\(--shadow-xs\);/
  );
  expect(styles).toMatch(
    /\.analytics-v3-decision-path,[\s\S]*?\.analytics-v3-evidence-table \{[\s\S]*?border-radius: 10px;[\s\S]*?box-shadow: var\(--shadow-xs\);/
  );
});
