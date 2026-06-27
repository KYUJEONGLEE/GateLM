import controlPlaneAdminApiFixture from "../../../../../docs/v1.0.0/fixtures/control-plane-admin-api.fixture.json";
import credentialLifecycleFixture from "../../../../../docs/v1.0.0/fixtures/credential-lifecycle.fixture.json";
import runtimeConfigFixture from "../../../../../docs/v1.0.0/fixtures/runtime-config.fixture.json";

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
    providers: Array<{
      providerId: string;
      provider: string;
      displayName: string;
      status: string;
      resolver: string;
      credentialPreview: string | null;
      models: string[];
    }>;
    rateLimit: {
      scope: string;
      windowSeconds: number;
      limit: number;
    };
    safetyPolicy: {
      mode: string;
      securityPolicyHash: string;
      detectors: unknown[];
    };
    cachePolicy: {
      enabled: boolean;
      type: string;
    };
    routingPolicy: {
      routingPolicyHash: string;
    };
  };
};

type CredentialLifecycleFixture = {
  credentialLifecycle: {
    plaintextDisplayPolicy: {
      plaintextShownOnce: boolean;
    };
    forbiddenAdminResponseFields: string[];
    apiKey: {
      issueExample: {
        response: CredentialIssueResponse;
      };
      listItemExample: CredentialListItem;
    };
    appToken: {
      issueExample: {
        response: CredentialIssueResponse;
      };
      listItemExample: CredentialListItem;
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

export function getAdminOnboardingModel(): AdminOnboardingModel {
  const adminApi = controlPlaneAdminApiFixture as ControlPlaneAdminApiFixture;
  const credentials = credentialLifecycleFixture as CredentialLifecycleFixture;
  const runtime = runtimeConfigFixture as RuntimeConfigFixture;
  const runtimeConfig = runtime.runtimeConfig;
  const provider = runtimeConfig.providers[0];

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
      providerId: provider.providerId,
      provider: provider.provider,
      displayName: provider.displayName,
      status: provider.status,
      resolver: provider.resolver,
      credentialPreview: provider.credentialPreview,
      modelCount: provider.models.length
    },
    apiKey: {
      issueResponse: credentials.credentialLifecycle.apiKey.issueExample.response,
      listItem: credentials.credentialLifecycle.apiKey.listItemExample
    },
    appToken: {
      issueResponse: credentials.credentialLifecycle.appToken.issueExample.response,
      listItem: credentials.credentialLifecycle.appToken.listItemExample
    },
    runtimeConfig: {
      configVersion: runtimeConfig.configVersion,
      publishState: runtimeConfig.publishState,
      configHash: runtimeConfig.configHash,
      securityPolicyHash: runtimeConfig.safetyPolicy.securityPolicyHash,
      routingPolicyHash: runtimeConfig.routingPolicy.routingPolicyHash,
      cacheType: runtimeConfig.cachePolicy.type,
      cacheEnabled: runtimeConfig.cachePolicy.enabled,
      safetyMode: runtimeConfig.safetyPolicy.mode,
      detectorCount: runtimeConfig.safetyPolicy.detectors.length
    },
    endpoints: adminApi.adminApi.endpoints.filter((endpoint) =>
      onboardingOperationIds.includes(endpoint.operationId)
    ),
    forbiddenAdminResponseFields: credentials.credentialLifecycle.forbiddenAdminResponseFields,
    plaintextShownOnce:
      credentials.credentialLifecycle.plaintextDisplayPolicy.plaintextShownOnce
  };
}
