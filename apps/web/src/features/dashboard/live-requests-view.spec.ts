import { expect, test } from "@playwright/test";
import {
  formatLiveRequestCostUsd,
  primaryPolicyResult,
  projectPillTone
} from "./live-requests-format";

test("prioritizes a PII result over a cache result", () => {
  expect(
    primaryPolicyResult({
      cacheStatus: "MISS",
      safetyAction: "REDACTED"
    })
  ).toEqual({
    kind: "safety",
    label: "PII REDACTED",
    value: "REDACTED"
  });

  expect(
    primaryPolicyResult({
      cacheStatus: "HIT",
      safetyAction: "MASKED"
    })
  ).toEqual({
    kind: "safety",
    label: "PII MASKED",
    value: "MASKED"
  });
});

test("uses a cache result only when there is no PII result", () => {
  expect(
    primaryPolicyResult({
      cacheStatus: "HIT",
      safetyAction: "NONE"
    })
  ).toEqual({
    kind: "cache",
    label: "CACHE HIT",
    value: "HIT"
  });

  expect(
    primaryPolicyResult({
      cacheStatus: "MISS",
      safetyAction: "NONE"
    })
  ).toEqual({
    kind: "cache",
    label: "CACHE MISS",
    value: "MISS"
  });
});

test("uses cache results before unavailable masking evidence", () => {
  expect(
    primaryPolicyResult({
      cacheStatus: "HIT",
      safetyAction: "UNAVAILABLE"
    })
  ).toEqual({
    kind: "cache",
    label: "CACHE HIT",
    value: "HIT"
  });

  expect(
    primaryPolicyResult(
      {
        cacheStatus: "MISS",
        safetyAction: "UNAVAILABLE"
      },
      "ko"
    )
  ).toEqual({
    kind: "cache",
    label: "캐시 미스",
    value: "MISS"
  });

  expect(
    primaryPolicyResult(
      {
        cacheStatus: "BYPASS",
        safetyAction: "UNAVAILABLE"
      },
      "ko"
    )
  ).toEqual({
    kind: "cache",
    label: "캐시 우회",
    value: "BYPASS"
  });
});

test("shows unavailable masking evidence when there is no cache result", () => {
  expect(
    primaryPolicyResult({
      cacheStatus: "NONE",
      safetyAction: "UNAVAILABLE"
    })
  ).toEqual({
    kind: "safety",
    label: "Masking unavailable",
    value: "UNAVAILABLE"
  });
});

test("returns no policy result when no outcome is present", () => {
  expect(
    primaryPolicyResult({
      cacheStatus: "NONE",
      safetyAction: "NONE"
    })
  ).toBeNull();
});

test("localizes policy results for the Korean console", () => {
  expect(
    primaryPolicyResult(
      {
        cacheStatus: "MISS",
        safetyAction: "REDACTED"
      },
      "ko"
    )
  ).toEqual({
    kind: "safety",
    label: "개인정보 마스킹",
    value: "REDACTED"
  });

  expect(
    primaryPolicyResult(
      {
        cacheStatus: "HIT",
        safetyAction: "NONE"
      },
      "ko"
    )
  ).toEqual({
    kind: "cache",
    label: "캐시 적중",
    value: "HIT"
  });
});

test("returns a stable project pill tone when project identifiers are missing", () => {
  const missingTone = projectPillTone(undefined);

  expect(missingTone).toBeGreaterThanOrEqual(0);
  expect(missingTone).toBeLessThan(6);
  expect(projectPillTone(null)).toBe(missingTone);
  expect(projectPillTone("")).toBe(missingTone);
});

test("keeps Krafton demo project pills visually distinct", () => {
  expect(projectPillTone("GateLM")).toBe(0);
  expect(projectPillTone("Ask Lake")).toBe(2);
  expect(projectPillTone("Sketch Catch")).toBe(4);
  expect(new Set([
    projectPillTone("GateLM"),
    projectPillTone("Ask Lake"),
    projectPillTone("Sketch Catch")
  ]).size).toBe(3);
});

test("formats request cost for fast table scanning without hiding sub-cent spend", () => {
  expect(formatLiveRequestCostUsd(0)).toBe("$0.00");
  expect(formatLiveRequestCostUsd(0.0004)).toBe("$0.001");
  expect(formatLiveRequestCostUsd(0.0046)).toBe("$0.005");
  expect(formatLiveRequestCostUsd(0.01)).toBe("$0.01");
  expect(formatLiveRequestCostUsd(0.016)).toBe("$0.02");
  expect(formatLiveRequestCostUsd(Number.NaN)).toBe("—");
});
