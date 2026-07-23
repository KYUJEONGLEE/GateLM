import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const wrapper = readFileSync(
  new URL("./run-analytics-live-three-projects.sh", import.meta.url),
  "utf8"
);
const runner = readFileSync(
  new URL("./run-analytics-live-mock-traffic.sh", import.meta.url),
  "utf8"
);

test("three-project runner uses safe interactive secrets and bounded demo defaults", () => {
  assert.match(wrapper, /GATELM_TRAFFIC_PRESET=three-project-demo/);
  assert.match(wrapper, /GATELM_TRAFFIC_DURATION_SECONDS:-60/);
  assert.match(wrapper, /GATELM_TRAFFIC_REPORT_INTERVAL:-1/);

  assert.match(runner, /local -a names=\("우주" "AskLake" "AURA"\)/);
  assert.match(runner, /GATELM_TRAFFIC_WOOJOO_RPS:-8/);
  assert.match(runner, /GATELM_TRAFFIC_ASKLAKE_RPS:-4/);
  assert.match(runner, /GATELM_TRAFFIC_AURA_RPS:-2/);
  assert.match(runner, /read_secret "\$\{names\[\$index\]\} GateLM 통합 API Key: "/);
  assert.match(runner, /STARTED_AT="\$\(date \+%s\)"/);
  assert.match(runner, /wait >\/dev\/null 2>&1 \|\| true\s+print_summary/);
  assert.doesNotMatch(wrapper, /gsk_live_/);
  assert.doesNotMatch(runner, /gsk_live_/);
});
