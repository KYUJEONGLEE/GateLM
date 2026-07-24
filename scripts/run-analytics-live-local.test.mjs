import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(
  new URL("./run-analytics-live-local.sh", import.meta.url),
  "utf8"
);

test("analytics local runner pre-warms primary Console routes without real credentials", () => {
  assert.match(runner, /WEB_PREWARM="\$\{ANALYTICS_WEB_PREWARM:-true\}"/);
  assert.match(runner, /gatelm_session=analytics-local-prewarm/);
  assert.match(runner, /\/tenants\/\$\{DEMO_TENANT_ID\}\/dashboard/);
  assert.match(
    runner,
    /\/tenants\/\$\{DEMO_TENANT_ID\}\/analytics\?tab=usage&range=15m/
  );
  assert.match(runner, /\/tenants\/\$\{DEMO_TENANT_ID\}\/projects/);
  assert.match(runner, /\/tenants\/\$\{DEMO_TENANT_ID\}\/request-logs/);
  assert.match(runner, /\/api\/analytics\/live-usage\?tenantId=/);
  assert.match(runner, /record_service_listener "web" "\$WEB_PORT"\s+prewarm_web_routes/);
  assert.doesNotMatch(runner, /gsk_live_/);
});
