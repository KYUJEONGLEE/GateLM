import { expect, test } from "@playwright/test";
import {
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
