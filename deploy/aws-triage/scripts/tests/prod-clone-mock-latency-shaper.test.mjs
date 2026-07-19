#!/usr/bin/env node

import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

import {
  createLatencyScheduler,
  loadLatencyProfile,
  summarizeLatencies,
} from "../prod-clone-mock-latency-shaper.mjs";

const profilePath = fileURLToPath(
  new URL("../../perf/profiles/provider-latency-profiles.json", import.meta.url),
);

const control = loadLatencyProfile(profilePath, "control_100ms", 100);
assert.equal(control.sourceType, "synthetic");
assert.equal(control.sourceApplicationSha, null);
assert.equal(control.sourceSampleCount, 0);
assert.deepEqual(control.summary, {
  count: 1,
  averageMs: 100,
  minMs: 100,
  p50Ms: 100,
  p90Ms: 100,
  p95Ms: 100,
  p99Ms: 100,
  maxMs: 100,
});
assert.throws(
  () => loadLatencyProfile(profilePath, "control_100ms", 50),
  /does not match configured control latency/,
);

const historical = loadLatencyProfile(
  profilePath,
  "historical_openai_nonstream",
  100,
);
assert.equal(historical.sourceType, "production_clone_observation");
assert.equal(
  historical.sourceApplicationSha,
  "13d2964fe76e074e4e61f03ece588794fe0cc5e4",
);
assert.equal(historical.sourceSampleCount, 50);
assert.equal(historical.valuesMs.length, 50);
assert.deepEqual(historical.summary, {
  count: 50,
  averageMs: 2207.28,
  minMs: 683,
  p50Ms: 1947,
  p90Ms: 3382,
  p95Ms: 4099,
  p99Ms: 7849,
  maxMs: 7849,
});
assert.deepEqual(summarizeLatencies(historical.valuesMs), historical.summary);

const scheduler = createLatencyScheduler(historical);
assert.equal(scheduler.next(), 1807);
assert.equal(scheduler.next(), 3776);
assert.deepEqual(
  { assignedCalls: scheduler.snapshot().assignedCalls, cursor: scheduler.snapshot().cursor },
  { assignedCalls: 2, cursor: 2 },
);
scheduler.reset();
assert.equal(scheduler.next(), 1807);
assert.deepEqual(
  { assignedCalls: scheduler.snapshot().assignedCalls, cursor: scheduler.snapshot().cursor },
  { assignedCalls: 1, cursor: 1 },
);

assert.throws(
  () => loadLatencyProfile(profilePath, "missing_profile", 100),
  /unknown latency profile/,
);

console.log("production-clone Mock latency shaper tests passed");
