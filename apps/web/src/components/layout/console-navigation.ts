export type ConsoleSection = "monitoring" | "management";

export type ManagementNavItem =
  | "api-keys"
  | "app-tokens"
  | "chat-app"
  | "employees"
  | "knowledge-documents"
  | "policies"
  | "project"
  | "provider"
  | "tenant-chat"
  | "tenant"
  | "teams";

export type MonitoringNavItem = "alerts" | "analytics" | "live-logs" | "overview";

export type ConsoleNavigationState = {
  activeManagementItem?: ManagementNavItem;
  activeMonitoringItem?: MonitoringNavItem;
  activeSection: ConsoleSection;
};

export function getConsoleNavigationState(pathname: string | null): ConsoleNavigationState {
  switch (getTenantConsoleRoute(pathname)) {
    case "dashboard":
      return {
        activeMonitoringItem: "overview",
        activeSection: "monitoring"
      };
    case "request-logs":
    case "metrics":
      return {
        activeMonitoringItem: "live-logs",
        activeSection: "monitoring"
      };
    case "analytics":
      return {
        activeMonitoringItem: "analytics",
        activeSection: "monitoring"
      };
    case "alerts":
      return {
        activeMonitoringItem: "alerts",
        activeSection: "monitoring"
      };
    case "health":
      return {
        activeSection: "monitoring"
      };
    case "api-keys":
      return {
        activeManagementItem: "api-keys",
        activeSection: "management"
      };
    case "app-tokens":
      return {
        activeManagementItem: "app-tokens",
        activeSection: "management"
      };
    case "policies":
      return {
        activeManagementItem: "policies",
        activeSection: "management"
      };
    case "chat-app":
    case "tenants":
    case "tenant-chat":
      return {
        activeManagementItem: "chat-app",
        activeSection: "management"
      };
    case "employees":
      return {
        activeManagementItem: "employees",
        activeSection: "management"
      };
    case "knowledge-documents":
      return {
        activeManagementItem: "knowledge-documents",
        activeSection: "management"
      };
    case "provider-connections":
    case "model-catalog":
      return {
        activeManagementItem: "provider",
        activeSection: "management"
      };
    case "teams":
      return {
        activeManagementItem: "teams",
        activeSection: "management"
      };
    case "applications":
    case "onboarding":
    case "projects":
      return {
        activeManagementItem: "project",
        activeSection: "management"
      };
    default:
      return {
        activeSection: "management"
      };
  }
}

function getTenantConsoleRoute(pathname: string | null) {
  const segments = (pathname ?? "").split("/").filter(Boolean);
  const tenantIndex = segments.indexOf("tenants");

  return tenantIndex >= 0 ? segments[tenantIndex + 2] : undefined;
}
