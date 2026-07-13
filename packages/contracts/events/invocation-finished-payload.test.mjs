import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const contractPath = "packages/contracts/events/invocation-finished-payload.ts";
const fixturePath = "packages/contracts/events/fixtures/invocation-finished.v2.fixture.json";

test("invocation-finished v2 separates routing summary from actual provider attempts", () => {
  const source = readFileSync(contractPath, "utf8");

  assert.match(source, /INVOCATION_SCHEMA_VERSION\s*=\s*2/);
  assert.match(source, /eventVersion:\s*2/);
  assert.match(source, /schemaVersion:\s*2/);
  assert.doesNotMatch(source, /\bselectedProvider\b|\bselectedModel\b/);
  assert.match(source, /interface ProviderAttemptRecord[\s\S]*providerId:[\s\S]*modelId:/);
  assert.match(source, /interface CostSettlementRecord[\s\S]*providerId:[\s\S]*modelId:/);
});

test("invocation-finished v2 fixture keeps actual identity inside attempt and cost records", () => {
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const serialized = JSON.stringify(fixture);

  assert.equal(fixture.eventVersion, 2);
  assert.equal(fixture.request.schemaVersion, 2);
  assert.doesNotMatch(serialized, /selectedProvider|selectedModel/);
  assert.equal(fixture.request.routing.category, "general");
  assert.equal(fixture.request.routing.difficulty, "simple");
  assert.equal(fixture.providerAttempts[0].providerId, "provider-mock");
  assert.equal(fixture.providerAttempts[0].modelId, "mock-balanced");
  assert.equal(fixture.costSettlement.providerId, "provider-mock");
  assert.equal(fixture.costSettlement.modelId, "mock-balanced");
  assert.equal("providerId" in fixture.request.routing, false);
  assert.equal("modelId" in fixture.request.routing, false);
});

test("forward migrations drop only the duplicate selected target columns", () => {
  const migrationPaths = [
    "db/migrations/015_drop_legacy_selected_routing_columns.sql",
    "deploy/selfhost/migrations/002_drop_legacy_selected_routing_columns.sql",
    "deploy/aws-triage/migrations/002_drop_legacy_selected_routing_columns.sql",
  ];

  for (const migrationPath of migrationPaths) {
    const sql = readFileSync(migrationPath, "utf8");
    assert.match(sql, /drop\s+column\s+if\s+exists\s+selected_provider/i);
    assert.match(sql, /drop\s+column\s+if\s+exists\s+selected_model/i);
    assert.doesNotMatch(sql, /drop\s+column(?:\s+if\s+exists)?\s+provider\b/i);
    assert.doesNotMatch(sql, /drop\s+column(?:\s+if\s+exists)?\s+model\b/i);
  }
});
