import { readFile } from "node:fs/promises";

import { expect, test } from "@playwright/test";

import type { ProviderConnectionRecord } from "../src/lib/control-plane/provider-connections-types";
import {
  countRuntimePolicyModelRoleConversionChanges,
  createRuntimePolicyRoleRoutes,
  getRuntimePolicyModelRoleConversion,
  getRuntimePolicyModelRoles,
  isRuntimeRoutingPolicyHash,
  toRuntimePolicyRoutingWriteInput
} from "../src/lib/control-plane/runtime-policy-types";
import {
  createMockBootstrapRoutingPolicy,
  getRoutingModelRef,
  getSelectedRoutingProviderConnections,
  hasCompleteRoutingMatrix
} from "../src/features/policies/components/runtime-policy-editor-utils";

const routingPanelSourceUrl = new URL(
  "../src/features/policies/components/runtime-policy-panels/routing-panel.tsx",
  import.meta.url
);

test("mock bootstrap creates all five category by two difficulty cells", () => {
  const policy = createMockBootstrapRoutingPolicy();

  expect(policy).toEqual({
    bootstrapState: "mock_bootstrap",
    mode: "auto",
    routes: {
      code: {
        complex: { modelRefs: ["mock-balanced"] },
        simple: { modelRefs: ["mock-balanced"] }
      },
      general: {
        complex: { modelRefs: ["mock-balanced"] },
        simple: { modelRefs: ["mock-balanced"] }
      },
      reasoning: {
        complex: { modelRefs: ["mock-balanced"] },
        simple: { modelRefs: ["mock-balanced"] }
      },
      summarization: {
        complex: { modelRefs: ["mock-balanced"] },
        simple: { modelRefs: ["mock-balanced"] }
      },
      translation: {
        complex: { modelRefs: ["mock-balanced"] },
        simple: { modelRefs: ["mock-balanced"] }
      }
    }
  });
  expect(hasCompleteRoutingMatrix(policy.routes)).toBe(true);
});

test("routing model refs use provider ids and selected connections are deduplicated", () => {
  const first = createProviderConnection("provider-a", "openai", ["gpt-a"]);
  const second = createProviderConnection("provider-b", "anthropic", ["claude-b"]);
  const policy = createMockBootstrapRoutingPolicy();
  policy.bootstrapState = "configured";
  policy.routes.general.simple.modelRefs = [
    getRoutingModelRef(first, "gpt-a"),
    getRoutingModelRef(second, "claude-b")
  ];
  policy.routes.code.complex.modelRefs = [getRoutingModelRef(first, "gpt-a")];

  expect(policy.routes.general.simple.modelRefs).toEqual([
    "provider-a:gpt-a",
    "provider-b:claude-b"
  ]);
  expect(
    getSelectedRoutingProviderConnections(
      {
        routingPolicy: policy
      } as never,
      [first, second]
    ).map((connection) => connection.id)
  ).toEqual(["provider-a", "provider-b"]);
});

test("global Simple and Complex roles project to all ten cells with one fallback", () => {
  const routes = createRuntimePolicyRoleRoutes({
    complexModelRef: "provider-b:premium",
    fallbackModelRef: "provider-c:backup",
    simpleModelRef: "provider-a:cheap"
  });

  expect(getRuntimePolicyModelRoles(routes)).toEqual({
    complexModelRef: "provider-b:premium",
    fallbackModelRef: "provider-c:backup",
    simpleModelRef: "provider-a:cheap"
  });
  expect(routes.general.simple.modelRefs).toEqual([
    "provider-a:cheap",
    "provider-c:backup"
  ]);
  expect(routes.reasoning.complex.modelRefs).toEqual([
    "provider-b:premium",
    "provider-c:backup"
  ]);
});

test("project routing UI preserves the three global roles and only applies card styling", async () => {
  const source = await readFile(routingPanelSourceUrl, "utf8");

  expect(source).toContain("policy-routing-role-list");
  expect(source.match(/appearance="card"/g)).toHaveLength(3);
  expect(source).toContain("label={text.routingSimpleModel}");
  expect(source).toContain("label={text.routingComplexModel}");
  expect(source).toContain("label={text.routingFallbackModel}");
  expect(source).not.toContain("routingCategoryRows");
  expect(source).toContain("createRuntimePolicyRoleRoutes(nextRoles)");
  expect(source).toContain("setRoles({ ...roles, simpleModelRef })");
  expect(source).toContain("setRoles({ ...roles, complexModelRef })");
});

test("Simple and Complex may use the same model while fallback stays distinct", () => {
  const routes = createRuntimePolicyRoleRoutes({
    complexModelRef: "provider-a:balanced",
    fallbackModelRef: "provider-b:backup",
    simpleModelRef: "provider-a:balanced"
  });

  expect(getRuntimePolicyModelRoles(routes)).not.toBeNull();
  expect(routes.code.simple.modelRefs).toEqual(routes.code.complex.modelRefs);
});

test("legacy conversion uses general primaries and drops non-uniform fallback", () => {
  const policy = createMockBootstrapRoutingPolicy();
  policy.routes.general.simple.modelRefs = ["provider-a:cheap", "provider-c:backup"];
  policy.routes.general.complex.modelRefs = ["provider-b:premium", "provider-c:backup"];
  policy.routes.code.simple.modelRefs = ["provider-d:category", "provider-e:other-backup"];

  expect(getRuntimePolicyModelRoles(policy.routes)).toBeNull();
  const conversion = getRuntimePolicyModelRoleConversion(policy.routes);

  expect(conversion).toEqual({
    complexModelRef: "provider-b:premium",
    fallbackModelRef: null,
    simpleModelRef: "provider-a:cheap"
  });
  expect(countRuntimePolicyModelRoleConversionChanges(policy.routes, conversion!)).toBe(10);
});

test("legacy routes without General roles can be initialized from explicit model choices", () => {
  const policy = createMockBootstrapRoutingPolicy();
  policy.routes.general.simple.modelRefs = [];
  policy.routes.general.complex.modelRefs = [];

  expect(getRuntimePolicyModelRoleConversion(policy.routes)).toBeNull();

  const routes = createRuntimePolicyRoleRoutes({
    complexModelRef: "provider-b:premium",
    fallbackModelRef: null,
    simpleModelRef: "provider-a:cheap"
  });

  expect(getRuntimePolicyModelRoles(routes)).toEqual({
    complexModelRef: "provider-b:premium",
    fallbackModelRef: null,
    simpleModelRef: "provider-a:cheap"
  });
});

test("conversion change count is zero for an existing global role profile", () => {
  const routes = createRuntimePolicyRoleRoutes({
    complexModelRef: "provider-b:premium",
    fallbackModelRef: "provider-c:backup",
    simpleModelRef: "provider-a:cheap"
  });
  const roles = getRuntimePolicyModelRoles(routes);

  expect(roles).not.toBeNull();
  expect(countRuntimePolicyModelRoleConversionChanges(routes, roles!)).toBe(0);
});

test("an empty route cell makes the matrix invalid", () => {
  const policy = createMockBootstrapRoutingPolicy();
  policy.routes.translation.complex.modelRefs = [];

  expect(hasCompleteRoutingMatrix(policy.routes)).toBe(false);
});

test("Control Plane write input contains only mode and the ten route cells", () => {
  const input = toRuntimePolicyRoutingWriteInput(createMockBootstrapRoutingPolicy());

  expect(Object.keys(input).sort()).toEqual(["mode", "routes"]);
  expect(input).not.toHaveProperty("bootstrapState");
  expect(input).not.toHaveProperty("defaultModel");
  expect(input).not.toHaveProperty("highQualityModel");
  expect(input).not.toHaveProperty("lowCostModel");
  expect(input).not.toHaveProperty("fallbackModel");
});

test("routing policy hashes require the canonical lowercase sha256 tag", () => {
  expect(
    isRuntimeRoutingPolicyHash(
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    )
  ).toBe(true);
  expect(isRuntimeRoutingPolicyHash("sha256:routing")).toBe(false);
  expect(
    isRuntimeRoutingPolicyHash(
      "sha256:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    )
  ).toBe(false);
  expect(
    isRuntimeRoutingPolicyHash(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    )
  ).toBe(false);
});

function createProviderConnection(
  id: string,
  provider: string,
  models: string[]
): ProviderConnectionRecord {
  return {
    baseUrl: "https://provider.invalid",
    createdAt: "2026-07-13T00:00:00.000Z",
    credentialPreview: { last4: null, prefix: null },
    displayName: provider,
    id,
    projectId: null,
    provider,
    providerConfig: { models },
    resolver: "none",
    status: "ACTIVE",
    tenantId: "tenant-test",
    timeoutMs: 30000,
    updatedAt: "2026-07-13T00:00:00.000Z"
  };
}
