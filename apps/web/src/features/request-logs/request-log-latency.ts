import { formatLatency } from "@/lib/formatting/formatters";

export function formatRequestLogTtft(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? formatLatency(value)
    : "—";
}
