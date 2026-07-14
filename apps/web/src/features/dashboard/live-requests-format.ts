import type { LiveRequestRow } from "@/lib/gateway/live-requests-types";
import type { Locale } from "@/lib/i18n/locale";

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
  row: Pick<LiveRequestRow, "cacheStatus" | "safetyAction">,
  locale: Locale = "en"
): PrimaryPolicyResult | null {
  if (row.safetyAction !== "NONE") {
    return {
      kind: "safety",
      label: safetyResultLabel(row.safetyAction, locale),
      value: row.safetyAction
    };
  }

  if (row.cacheStatus !== "NONE") {
    return {
      kind: "cache",
      label: cacheResultLabel(row.cacheStatus, locale),
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

function safetyResultLabel(
  action: Exclude<LiveRequestRow["safetyAction"], "NONE">,
  locale: Locale
) {
  if (locale === "ko") {
    return action === "BLOCKED" ? "개인정보 차단" : "개인정보 마스킹";
  }

  return `PII ${action}`;
}

function cacheResultLabel(
  status: Exclude<LiveRequestRow["cacheStatus"], "NONE">,
  locale: Locale
) {
  if (locale === "ko") {
    const labels: Record<typeof status, string> = {
      BYPASS: "캐시 우회",
      HIT: "캐시 적중",
      MISS: "캐시 미스"
    };
    return labels[status];
  }

  return `CACHE ${status}`;
}
