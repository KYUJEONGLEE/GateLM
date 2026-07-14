import type { ApiKeysModel } from "@/lib/control-plane/api-keys-types";

export const PRIMARY_GATEWAY_API_KEY_DISPLAY_NAME = "Primary Gateway API Key";

type ProjectGatewayApiKeyContext = Pick<
  ApiKeysModel,
  "controlPlaneProjectId" | "routeTenantId"
>;

export function getProjectGatewayApiKeyIssuePayload(model: ProjectGatewayApiKeyContext) {
  return {
    action: "issue" as const,
    routeTenantId: model.routeTenantId,
    values: {
      displayName: PRIMARY_GATEWAY_API_KEY_DISPLAY_NAME,
      expiresAt: "",
      projectId: model.controlPlaneProjectId,
      scopes: "gateway:invoke"
    }
  };
}

export function getProjectGatewayApiKeyRotatePayload(
  model: ProjectGatewayApiKeyContext,
  apiKeyId: string
) {
  return {
    action: "rotate" as const,
    apiKeyId,
    projectId: model.controlPlaneProjectId,
    routeTenantId: model.routeTenantId
  };
}
