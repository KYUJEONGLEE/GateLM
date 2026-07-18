import type { LiveRequestSafetyAction } from "@/lib/gateway/live-requests-types";

export type TenantChatMaskingAction = "none" | "redacted" | "blocked" | null;
export type TenantChatMaskingObservationState = "observed" | "unavailable";
export type TenantChatSafetyOutcome = "passed" | "redacted" | "blocked" | "not_checked";

export type TenantChatMaskingObservation = {
  action: Exclude<TenantChatMaskingAction, null> | null;
  liveAction: LiveRequestSafetyAction;
  observationState: TenantChatMaskingObservationState;
  safetyOutcome: TenantChatSafetyOutcome;
};

export function resolveTenantChatMaskingObservation(input: {
  maskingAction: TenantChatMaskingAction;
  terminalOutcome: string;
}): TenantChatMaskingObservation {
  const observationState = input.maskingAction === null
    ? "unavailable"
    : "observed";
  const action = input.maskingAction ?? (
    input.terminalOutcome === "safety_blocked" ? "blocked" : null
  );

  if (action === "blocked") {
    return {
      action,
      liveAction: "BLOCKED",
      observationState,
      safetyOutcome: "blocked"
    };
  }

  if (action === "redacted") {
    return {
      action,
      liveAction: "REDACTED",
      observationState,
      safetyOutcome: "redacted"
    };
  }

  if (action === "none") {
    return {
      action,
      liveAction: "NONE",
      observationState,
      safetyOutcome: "passed"
    };
  }

  return {
    action: null,
    liveAction: "UNAVAILABLE",
    observationState,
    safetyOutcome: "not_checked"
  };
}
