import { expect, test } from "@playwright/test";
import {
  getProjectGatewayApiKeyIssuePayload,
  getProjectGatewayApiKeyRotatePayload
} from "./project-gateway-api-key-request";

const context = {
  controlPlaneProjectId: "project-1",
  routeTenantId: "tenant-1"
};

test("includes Tenant and Project context when issuing a Project Gateway API Key", () => {
  expect(getProjectGatewayApiKeyIssuePayload(context)).toMatchObject({
    action: "issue",
    routeTenantId: "tenant-1",
    values: {
      projectId: "project-1"
    }
  });
});

test("includes Tenant, Project, and Key context when rotating a Project Gateway API Key", () => {
  expect(getProjectGatewayApiKeyRotatePayload(context, "key-1")).toEqual({
    action: "rotate",
    apiKeyId: "key-1",
    projectId: "project-1",
    routeTenantId: "tenant-1"
  });
});
