import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

const panelUrl = new URL("./analytics-live-usage-panel.tsx", import.meta.url);
const chartUrl = new URL("./analytics-charts.tsx", import.meta.url);
const stylesUrl = new URL("../analytics-live-usage.css", import.meta.url);

test("live usage defaults off and polls without overlap only while visible", async () => {
  const source = await readFile(panelUrl, "utf8");
  expect(source).toContain("useState(false)");
  expect(source).toContain('document.visibilityState === "visible"');
  expect(source).toContain("new AbortController()");
  expect(source).toContain("controller?.abort()");
  expect(source).toContain("setTimeout(() => void poll()");
  expect(source).not.toContain("setInterval(");
  expect(source.indexOf("await fetch(")).toBeLessThan(source.indexOf("schedule(nextPoll.delayMs)"));
});

test("live usage uses project policy links, safe Korean wrapping, and reduced motion", async () => {
  const [source, styles] = await Promise.all([
    readFile(panelUrl, "utf8"),
    readFile(stylesUrl, "utf8")
  ]);
  expect(source).toContain("policies?tab=rate-limit");
  expect(source).toContain("지속 충전량 / 순간 최대");
  expect(source).not.toContain("Tenant Chat");
  expect(styles).toContain("word-break: keep-all");
  expect(styles).toContain("line-break: strict");
  expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  expect(styles).toContain("@media (max-width: 820px)");
  expect(styles).not.toContain("overflow-x: auto");
});

test("static usage keeps the selected range while live usage uses the rolling window", async () => {
  const source = await readFile(panelUrl, "utf8");

  expect(source).toContain("rollingWindow={Boolean(snapshot)}");
  expect(source).toMatch(
    /displayBuckets\.slice\(snapshot\s+\? analyticsLiveChartStartIndex\(displayBuckets\)\s+: 0\)/
  );
});

test("live usage displays Seoul time and keeps ECharts line colors hover-safe", async () => {
  const [panelSource, chartSource] = await Promise.all([
    readFile(panelUrl, "utf8"),
    readFile(chartUrl, "utf8")
  ]);

  expect(panelSource).toContain("timeZone: DEFAULT_DISPLAY_TIMEZONE");
  expect(chartSource).toContain("timeZone: DEFAULT_DISPLAY_TIMEZONE");
  expect(chartSource).toMatch(/bucket\.incomingRps\),\s+palette\[1\]/);
  expect(chartSource).toMatch(/bucket\.processedRps\),\s+palette\[0\]/);
  expect(chartSource).toMatch(/bucket\.rateLimitedRps\),\s+palette\[2\]/);
});

test("top project rank and name stay readable in the compact two-column layout", async () => {
  const styles = await readFile(stylesUrl, "utf8");

  expect(styles).toMatch(
    /\.analytics-live-project-line > span \{[\s\S]*?font-size: calc\(19px \+ var\(--global-font-lift\)\);/
  );
  expect(styles).toMatch(
    /\.analytics-live-project-line > a \{[\s\S]*?font-size: calc\(21px \+ var\(--global-font-lift\)\);[\s\S]*?line-height: 1\.25;/
  );
});
