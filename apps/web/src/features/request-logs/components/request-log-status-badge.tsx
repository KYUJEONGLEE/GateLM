import type { LiveInvocationLogRecord } from "@/lib/gateway/live-observability-contract";

export function StatusBadge({
  label,
  status
}: {
  label?: string;
  status: LiveInvocationLogRecord["status"];
}) {
  return (
    <span className="status-badge" data-status={status}>
      {label ?? status}
    </span>
  );
}
