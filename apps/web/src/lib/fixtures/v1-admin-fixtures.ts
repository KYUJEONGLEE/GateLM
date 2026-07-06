import controlPlaneAdminApiFixture from "@/lib/fixtures/legacy-v1/control-plane-admin-api.fixture.json";
import credentialLifecycleFixture from "@/lib/fixtures/legacy-v1/credential-lifecycle.fixture.json";
import runtimeConfigFixture from "@/lib/fixtures/legacy-v1/runtime-config.fixture.json";

export type AdminEndpoint = {
  operationId: string;
  method: string;
  path: string;
  successStatus: number;
  notes: string[];
};

export type CredentialIssueResponse = {
  credentialId: string;
  credentialType: string;
  plaintext: string;
  plaintextShownOnce: boolean;
  prefix: string;
  last4: string;
  status: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  warning: string;
};

export type CredentialListItem = {
  credentialId: string;
  credentialType: string;
  displayName: string;
  prefix: string;
  last4: string;
  status: string;
  scopes: string[];
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
};

type CredentialListItemFixture = Omit<CredentialListItem, "scopes"> & {
  scopes?: string[] | null;
};

export type AdminOnboardingModel = {
  tenantId: string;
  project: {
    id: string;
    status: string;
  };
  application: {
    id: string;
    status: string;
    rateLimitScope: string;
    rateLimitLimit: number;
    rateLimitWindowSeconds: number;
  };
  provider: {
    providerId: string;
    provider: string;
    displayName: string;
    status: string;
    resolver: string;
    credentialPreview: string | null;
    modelCount: number;
    models: AdminProviderModel[];
  };
  modelSelection: {
    defaultProvider: string;
    defaultModel: string;
    lowCostProvider: string;
    lowCostModel: string;
    fallbackProvider: string;
    fallbackModel: string;
  };
  apiKey: {
    issueResponse: CredentialIssueResponse;
    listItem: CredentialListItem;
  };
  appToken: {
    issueResponse: CredentialIssueResponse;
    listItem: CredentialListItem;
  };
  runtimeConfig: {
    configVersion: string;
    publishState: string;
    configHash: string;
    securityPolicyHash: string;
    routingPolicyHash: string;
    cacheType: string;
    cacheEnabled: boolean;
    safetyMode: string;
    detectorCount: number;
  };
  endpoints: AdminEndpoint[];
  forbiddenAdminResponseFields: string[];
  plaintextShownOnce: boolean;
};

export type AdminProviderModel = {
  provider: string;
  model: string;
  displayName: string;
  status: string;
  contextWindowTokens: number;
  supportsStreaming: boolean;
  supportsJsonMode: boolean;
};

type RuntimeConfigFixture = {
  runtimeConfig: {
    configVersion: string;
    configHash: string;
    publishState: string;
    tenantId: string;
    projectId: string;
    projectStatus: string;
    applicationId: string;
    applicationStatus: string;
    providers?: Array<{
      providerId: string;
      provider: string;
      displayName: string;
      status: string;
      resolver: string;
      credentialPreview: string | null;
      models?: string[];
    }>;
    models?: AdminProviderModel[];
    rateLimit: {
      scope: string;
      windowSeconds: number;
      limit: number;
    };
    safetyPolicy?: {
      mode: string;
      securityPolicyHash: string;
      detectors?: unknown[];
    };
    cachePolicy?: {
      enabled: boolean;
      type: string;
    };
    routingPolicy?: {
      defaultProvider?: string;
      defaultModel?: string;
      lowCostProvider?: string;
      lowCostModel?: string;
      fallbackProvider?: string;
      fallbackModel?: string;
      routingPolicyHash: string;
    };
  };
};

type CredentialLifecycleFixture = {
  credentialLifecycle: {
    plaintextDisplayPolicy: {
      plaintextShownOnce: boolean;
    };
    forbiddenAdminResponseFields?: string[] | null;
    apiKey: {
      issueExample: {
        response: CredentialIssueResponse;
      };
      listItemExample: CredentialListItemFixture;
    };
    appToken: {
      issueExample: {
        response: CredentialIssueResponse;
      };
      listItemExample: CredentialListItemFixture;
    };
  };
};

type ControlPlaneAdminApiFixture = {
  adminApi: {
    endpoints: AdminEndpoint[];
  };
};

const onboardingOperationIds = [
  "createProject",
  "createApplication",
  "upsertProvider",
  "issueApiKey",
  "listApiKeys",
  "issueAppToken",
  "listAppTokens",
  "getActiveRuntimeConfig"
];

const unconfiguredProvider = {
  providerId: "provider_unconfigured",
  provider: "unconfigured",
  displayName: "Provider not configured",
  status: "missing",
  resolver: "not_configured",
  credentialPreview: null,
  models: []
};

function normalizeCredentialListItem(listItem: CredentialListItemFixture): CredentialListItem {
  return {
    ...listItem,
    scopes: listItem.scopes ?? []
  };
}

function sanitizeCredentialIssueResponse(
  issueResponse: CredentialIssueResponse
): CredentialIssueResponse {
  return {
    ...issueResponse,
    plaintext: "[one-time value returned only by live issue response]"
  };
}

function getProviderModels(
  runtimeModels: AdminProviderModel[] | undefined,
  provider: {
    models?: string[];
    provider: string;
    status: string;
  }
): AdminProviderModel[] {
  const detailedModels =
    runtimeModels?.filter((model) => model.provider === provider.provider) ?? [];

  if (detailedModels.length > 0) {
    return detailedModels;
  }

  return (provider.models ?? []).map((model) => ({
    provider: provider.provider,
    model,
    displayName: model,
    status: provider.status,
    contextWindowTokens: 0,
    supportsStreaming: false,
    supportsJsonMode: false
  }));
}

export function getAdminOnboardingModel(): AdminOnboardingModel {
  const adminApi = controlPlaneAdminApiFixture as ControlPlaneAdminApiFixture;
  const credentials = credentialLifecycleFixture as CredentialLifecycleFixture;
  const runtime = runtimeConfigFixture as RuntimeConfigFixture;
  const runtimeConfig = runtime.runtimeConfig;
  const provider = runtimeConfig.providers?.[0] ?? unconfiguredProvider;
  const providerModels = getProviderModels(runtimeConfig.models, provider);

  return {
    tenantId: runtimeConfig.tenantId,
    project: {
      id: runtimeConfig.projectId,
      status: runtimeConfig.projectStatus
    },
    application: {
      id: runtimeConfig.applicationId,
      status: runtimeConfig.applicationStatus,
      rateLimitScope: runtimeConfig.rateLimit.scope,
      rateLimitLimit: runtimeConfig.rateLimit.limit,
      rateLimitWindowSeconds: runtimeConfig.rateLimit.windowSeconds
    },
    provider: {
      providerId: provider.providerId ?? unconfiguredProvider.providerId,
      provider: provider.provider ?? unconfiguredProvider.provider,
      displayName: provider.displayName ?? unconfiguredProvider.displayName,
      status: provider.status ?? unconfiguredProvider.status,
      resolver: provider.resolver ?? unconfiguredProvider.resolver,
      credentialPreview: provider.credentialPreview ?? unconfiguredProvider.credentialPreview,
      modelCount: providerModels.length || provider.models?.length || unconfiguredProvider.models.length,
      models: providerModels
    },
    modelSelection: {
      defaultProvider: runtimeConfig.routingPolicy?.defaultProvider ?? provider.provider ?? "unconfigured",
      defaultModel: runtimeConfig.routingPolicy?.defaultModel ?? providerModels[0]?.model ?? "unconfigured",
      lowCostProvider: runtimeConfig.routingPolicy?.lowCostProvider ?? provider.provider ?? "unconfigured",
      lowCostModel: runtimeConfig.routingPolicy?.lowCostModel ?? providerModels[0]?.model ?? "unconfigured",
      fallbackProvider: runtimeConfig.routingPolicy?.fallbackProvider ?? provider.provider ?? "unconfigured",
      fallbackModel: runtimeConfig.routingPolicy?.fallbackModel ?? providerModels[0]?.model ?? "unconfigured"
    },
    apiKey: {
      issueResponse: sanitizeCredentialIssueResponse(
        credentials.credentialLifecycle.apiKey.issueExample.response
      ),
      listItem: normalizeCredentialListItem(credentials.credentialLifecycle.apiKey.listItemExample)
    },
    appToken: {
      issueResponse: sanitizeCredentialIssueResponse(
        credentials.credentialLifecycle.appToken.issueExample.response
      ),
      listItem: normalizeCredentialListItem(credentials.credentialLifecycle.appToken.listItemExample)
    },
    runtimeConfig: {
      configVersion: runtimeConfig.configVersion,
      publishState: runtimeConfig.publishState,
      configHash: runtimeConfig.configHash,
      securityPolicyHash: runtimeConfig.safetyPolicy?.securityPolicyHash ?? "security_policy_missing",
      routingPolicyHash: runtimeConfig.routingPolicy?.routingPolicyHash ?? "routing_policy_missing",
      cacheType: runtimeConfig.cachePolicy?.type ?? "unconfigured",
      cacheEnabled: runtimeConfig.cachePolicy?.enabled ?? false,
      safetyMode: runtimeConfig.safetyPolicy?.mode ?? "missing",
      detectorCount: runtimeConfig.safetyPolicy?.detectors?.length ?? 0
    },
    endpoints: adminApi.adminApi.endpoints.filter((endpoint) =>
      onboardingOperationIds.includes(endpoint.operationId)
    ),
    forbiddenAdminResponseFields: credentials.credentialLifecycle.forbiddenAdminResponseFields ?? [],
    plaintextShownOnce:
      credentials.credentialLifecycle.plaintextDisplayPolicy.plaintextShownOnce
  };
}
