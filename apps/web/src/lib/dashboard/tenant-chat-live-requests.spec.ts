import { expect, test } from "@playwright/test";
import { resolveTenantChatMaskingObservation } from "@/lib/control-plane/tenant-chat-masking-observation";

test("maps explicit Tenant Chat masking actions to live-request safety values", () => {
  expect(observation("redacted").liveAction).toBe("REDACTED");
  expect(observation("blocked").liveAction).toBe("BLOCKED");
  expect(observation("none").liveAction).toBe("NONE");
});

test("marks missing historical masking evidence as unavailable", () => {
  expect(observation(null)).toEqual({
    action: null,
    liveAction: "UNAVAILABLE",
    observationState: "unavailable",
    safetyOutcome: "not_checked"
  });
});

test("uses a safety-blocked terminal result without inventing observed evidence", () => {
  expect(observation(null, "safety_blocked")).toEqual({
    action: "blocked",
    liveAction: "BLOCKED",
    observationState: "unavailable",
    safetyOutcome: "blocked"
  });
});

function observation(
  maskingAction: "none" | "redacted" | "blocked" | null,
  terminalOutcome = "succeeded"
) {
  return resolveTenantChatMaskingObservation({ maskingAction, terminalOutcome });
}
