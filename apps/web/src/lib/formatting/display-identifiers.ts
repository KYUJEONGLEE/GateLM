const displayIdentifierReplacements: Array<[string, string]> = [
  ["tenant_demo_acme", "tenant_acme"],
  ["app_customer_demo", "app_customer"],
  ["customer_user_demo_", "customer_user_"],
  ["request_v1_demo_", "request_v1_"],
  ["_demo", ""]
];

export function formatDisplayIdentifier(value: string) {
  return displayIdentifierReplacements.reduce(
    (displayValue, [source, replacement]) => displayValue.replaceAll(source, replacement),
    value
  );
}

export function formatModelDisplayName(value: string | null | undefined, fallback = "not routed") {
  if (!value) {
    return fallback;
  }

  const formattedValue = formatDisplayIdentifier(value);
  const separatorIndex = formattedValue.lastIndexOf(":");

  if (separatorIndex >= 0 && separatorIndex < formattedValue.length - 1) {
    return formattedValue.slice(separatorIndex + 1);
  }

  return formattedValue;
}

export function formatTenantDisplayName(tenantId: string) {
  return tenantId === "tenant_demo_acme" ? "Acme Corp" : formatDisplayIdentifier(tenantId);
}

export function sanitizeDisplayValue(value: unknown): unknown {
  if (typeof value === "string") {
    return formatDisplayIdentifier(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeDisplayValue(item));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, sanitizeDisplayValue(item)])
    );
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}
