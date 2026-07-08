import type { InvocationLogRecord } from "@/lib/fixtures/v1-observability-fixtures";

export function StatusBadge({
  label,
  status
}: {
  label?: string;
  status: InvocationLogRecord["status"];
}) {
  return (
    <span className="status-badge" data-status={status}>
      {label ?? status}
    </span>
  );
}
