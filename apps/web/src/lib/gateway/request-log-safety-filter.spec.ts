import { expect, test } from "@playwright/test";
import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";
import {
  matchesRequestLogSafetyOutcome,
  normalizeRequestLogSafetyOutcomeFilter,
  requestLogSafetyOutcome
} from "./request-log-safety-filter";

test("uses canonical safety outcome when filtering request logs", () => {
  const record = safetyRecord("redacted", "none");

  expect(requestLogSafetyOutcome(record)).toBe("redacted");
  expect(matchesRequestLogSafetyOutcome(record, "redacted")).toBe(true);
  expect(matchesRequestLogSafetyOutcome(record, "blocked")).toBe(false);
});

test("bridges legacy masking action when safety outcome is unavailable", () => {
  const record = safetyRecord("unknown", "blocked");

  expect(requestLogSafetyOutcome(record)).toBe("blocked");
  expect(matchesRequestLogSafetyOutcome(record, "blocked")).toBe(true);
});

test("handles request logs with no safety domain outcome", () => {
  const record = {
    domainOutcomes: {},
    maskingAction: "none"
  } as Pick<LiveInvocationLogRecord, "domainOutcomes" | "maskingAction">;

  expect(requestLogSafetyOutcome(record)).toBe("passed");
  expect(matchesRequestLogSafetyOutcome(record, "passed")).toBe(true);
});

test("rejects unsupported safety filter values", () => {
  expect(normalizeRequestLogSafetyOutcomeFilter("filtered")).toBe("");
  expect(normalizeRequestLogSafetyOutcomeFilter("not_checked")).toBe("not_checked");
});

function safetyRecord(
  outcome: string,
  maskingAction: LiveInvocationLogRecord["maskingAction"]
): Pick<LiveInvocationLogRecord, "domainOutcomes" | "maskingAction"> {
  return {
    domainOutcomes: {
      auth: { outcome: "passed" },
      budget: { outcome: "not_used" },
      cache: { outcome: "not_used" },
      fallback: { outcome: "not_needed" },
      logging: { outcome: "written" },
      provider: { outcome: "success" },
      rateLimit: { outcome: "passed" },
      routing: { outcome: "selected" },
      runtime: { outcome: "snapshot_active" },
      safety: { outcome },
      streaming: { outcome: "not_streaming" }
    },
    maskingAction
  };
}
