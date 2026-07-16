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

export type ProviderDisplayFamily = "openai" | "anthropic" | "google" | "mock" | "unknown";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveProviderDisplay(
  value: string | null | undefined,
  model: string | null | undefined
): { family: ProviderDisplayFamily; label: string } {
  const provider = value?.trim() ?? "";
  const normalizedModel = formatModelDisplayName(model, "").toLowerCase();
  const candidates = [provider.toLowerCase(), normalizedModel];

  if (candidates.some((candidate) =>
    candidate.includes("openai") || /^(gpt|chatgpt|o[134](?:-|$))/.test(candidate)
  )) {
    return { family: "openai", label: "OpenAI" };
  }

  if (candidates.some((candidate) =>
    candidate.includes("anthropic") || candidate.includes("claude")
  )) {
    return { family: "anthropic", label: "Anthropic" };
  }

  if (candidates.some((candidate) =>
    candidate.includes("google") || candidate.includes("gemini")
  )) {
    return { family: "google", label: "Google" };
  }

  if (candidates.some((candidate) => candidate.includes("mock"))) {
    return { family: "mock", label: "Mock" };
  }

  return {
    family: "unknown",
    label: provider && !uuidPattern.test(provider)
      ? formatDisplayIdentifier(provider)
      : "Provider"
  };
}

export type BudgetScopeDisplayInput = {
  budgetScopeId?: string | null;
  budgetScopeType?: string | null;
  resolvedBy?: string | null;
};

export function formatBudgetScopeTypeDisplayName(scopeType: string | null | undefined) {
  if (scopeType === "application") {
    return "Project default policy";
  }

  if (scopeType === "project") {
    return "Project budget";
  }

  if (scopeType === "team") {
    return "Team budget";
  }

  return scopeType ? formatDisplayIdentifier(scopeType) : "Project budget";
}

export function formatBudgetScopeDisplayName(scope: BudgetScopeDisplayInput) {
  if (scope.budgetScopeType === "application") {
    return "Project default policy";
  }

  const typeLabel = formatBudgetScopeTypeDisplayName(scope.budgetScopeType);
  const scopeId = scope.budgetScopeId?.trim();

  return scopeId ? `${typeLabel}: ${formatDisplayIdentifier(scopeId)}` : typeLabel;
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
