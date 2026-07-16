import type {
  TenantChatAdminRuntimeSetup,
  TenantChatRoutingCategory,
  TenantChatRoutingDifficulty,
  TenantChatRoutingMatrix
} from "@/lib/control-plane/tenant-chat-runtime-types";

const routingCategories: TenantChatRoutingCategory[] = [
  "general",
  "code",
  "translation",
  "summarization",
  "reasoning"
];
const routingDifficulties: TenantChatRoutingDifficulty[] = ["simple", "complex"];

export function selectTenantChatProviderId(
  setup: TenantChatAdminRuntimeSetup | null,
  requestedProviderId?: string
) {
  if (
    requestedProviderId &&
    setup?.providers.some(
      (provider) => provider.providerConnectionId === requestedProviderId
    )
  ) {
    return requestedProviderId;
  }
  return (
    setup?.activeSnapshot?.providerConnectionId ??
    setup?.providers[0]?.providerConnectionId ??
    ""
  );
}

export function selectTenantChatModelKey(
  setup: TenantChatAdminRuntimeSetup | null,
  providerId: string
) {
  const provider = setup?.providers.find(
    (candidate) => candidate.providerConnectionId === providerId
  );
  if (!provider) {
    return "";
  }
  if (
    setup?.activeSnapshot?.providerConnectionId === providerId &&
    provider.models.some(
      (model) => model.modelKey === setup.activeSnapshot?.modelKey
    )
  ) {
    return setup.activeSnapshot.modelKey;
  }
  return (
    provider.models.find((model) => model.activationStatus === "available")
      ?.modelKey ?? ""
  );
}

export function getTenantChatSetupStep(input: {
  hasAvailableModel: boolean;
  hasProvider: boolean;
  readiness: TenantChatAdminRuntimeSetup["readiness"];
}) {
  if (!input.hasProvider) {
    return 1;
  }
  if (!input.hasAvailableModel) {
    return 2;
  }
  return input.readiness === "ready" ? 3 : 2;
}

export function selectTenantChatSharedFallbackModelRef(
  routes: TenantChatRoutingMatrix
): string | null {
  const fallbackProfiles = routingCategories.flatMap((category) =>
    routingDifficulties.map((difficulty) =>
      (routes[category]?.[difficulty]?.modelRefs ?? []).slice(1)
    )
  );
  const firstProfile = fallbackProfiles[0] ?? [];

  if (fallbackProfiles.every((profile) => profile.length === 0)) {
    return "";
  }
  if (
    firstProfile.length === 1 &&
    fallbackProfiles.every(
      (profile) => profile.length === 1 && profile[0] === firstProfile[0]
    )
  ) {
    return firstProfile[0] ?? "";
  }
  return null;
}

export function updateTenantChatPrimaryModelRef(
  routes: TenantChatRoutingMatrix,
  category: TenantChatRoutingCategory,
  difficulty: TenantChatRoutingDifficulty,
  modelRef: string
): TenantChatRoutingMatrix {
  const currentRefs = routes[category]?.[difficulty]?.modelRefs ?? [];
  return {
    ...routes,
    [category]: {
      ...routes[category],
      [difficulty]: {
        modelRefs: [
          modelRef,
          ...currentRefs.slice(1).filter((candidate) => candidate !== modelRef)
        ]
      }
    }
  };
}

export function applyTenantChatSharedFallbackModelRef(
  routes: TenantChatRoutingMatrix,
  fallbackModelRef: string,
  manualModelRef = ""
): TenantChatRoutingMatrix {
  if (
    fallbackModelRef &&
    getTenantChatFallbackExcludedModelRefs(routes, manualModelRef).has(
      fallbackModelRef
    )
  ) {
    return routes;
  }

  const next = { ...routes } as TenantChatRoutingMatrix;
  for (const category of routingCategories) {
    next[category] = { ...routes[category] };
    for (const difficulty of routingDifficulties) {
      const primaryModelRef = routes[category]?.[difficulty]?.modelRefs?.[0];
      if (primaryModelRef) {
        next[category][difficulty] = {
          modelRefs: fallbackModelRef
            ? [primaryModelRef, fallbackModelRef]
            : [primaryModelRef]
        };
      }
    }
  }
  return next;
}

export function getTenantChatFallbackExcludedModelRefs(
  routes: TenantChatRoutingMatrix,
  manualModelRef = ""
): Set<string> {
  const modelRefs = new Set<string>();
  for (const category of routingCategories) {
    for (const difficulty of routingDifficulties) {
      const primaryModelRef = routes[category]?.[difficulty]?.modelRefs?.[0];
      if (primaryModelRef) {
        modelRefs.add(primaryModelRef);
      }
    }
  }
  if (manualModelRef) {
    modelRefs.add(manualModelRef);
  }
  return modelRefs;
}
