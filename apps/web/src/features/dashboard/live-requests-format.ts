import type { LiveRequestRow } from "@/lib/gateway/live-requests-types";

const projectPillToneCount = 6;

export type PrimaryPolicyResult =
  | {
      kind: "safety";
      label: string;
      value: Exclude<LiveRequestRow["safetyAction"], "NONE">;
    }
  | {
      kind: "cache";
      label: string;
      value: Exclude<LiveRequestRow["cacheStatus"], "NONE">;
    };

export function primaryPolicyResult(
  row: Pick<LiveRequestRow, "cacheStatus" | "safetyAction">
): PrimaryPolicyResult | null {
  if (row.safetyAction !== "NONE") {
    return {
      kind: "safety",
      label: `PII ${row.safetyAction}`,
      value: row.safetyAction
    };
  }

  if (row.cacheStatus !== "NONE") {
    return {
      kind: "cache",
      label: `CACHE ${row.cacheStatus}`,
      value: row.cacheStatus
    };
  }

  return null;
}

export function projectPillTone(value: string | null | undefined) {
  const seed = typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : "unknown-project";

  return stableHash(seed) % projectPillToneCount;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}
