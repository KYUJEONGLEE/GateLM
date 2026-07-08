import type { Dispatch, ReactNode, SetStateAction } from "react";

import type { BreadcrumbItem } from "@/components/ui/breadcrumb";
import type { OneTimeApiKeyResponse } from "@/lib/control-plane/api-keys-types";
import type {
  RuntimePolicyConfig,
  RuntimePolicyDraftValues,
  RuntimePolicyModel
} from "@/lib/control-plane/runtime-policy-types";
import type { Locale } from "@/lib/i18n/locale";

export type RuntimePolicyEditorProps = {
  apiKeyReadiness?: RuntimePolicyApiKeyReadiness;
  breadcrumbItems?: BreadcrumbItem[];
  children?: ReactNode;
  generalFooter?: ReactNode;
  hideStreamingTab?: boolean;
  locale: Locale;
  model: RuntimePolicyModel;
  moveBudgetToGeneral?: boolean;
};

export type RuntimePolicyApiKeyReadiness = {
  activeApiKeyCount: number;
  loadError: string | null;
  projectId: string;
  projectName: string;
};

export type SubmitState =
  | {
      message: string;
      status: "error" | "idle" | "success";
    }
  | {
      message: string;
      runtimeConfig: RuntimePolicyConfig;
      status: "success";
    };

export type OneTimeApiKeyState = {
  apiKey: OneTimeApiKeyResponse;
  projectName: string;
};

export type PolicySection =
  | "general"
  | "safety"
  | "routing"
  | "budget"
  | "rateLimit"
  | "cache"
  | "streaming";

export type RoutingPriorityRoute = "default" | "fallback" | "lowCost";

export type RoutingProviderOption = {
  displayName: string;
  family: string;
  provider: string;
  providerId: string;
};

export type RuntimePolicyDraftValuesSetter = Dispatch<
  SetStateAction<RuntimePolicyDraftValues>
>;

export type RoutingPriorityRow = {
  priority: string;
  provider: string;
  route: RoutingPriorityRoute;
  selectedModel: string;
};

export type RoutingPriorityTableText = {
  model: string;
  noProviderModels: string;
  provider: string;
};

export type RuntimePolicyEditorText = {
  activeApiKeyMissing: string;
  activeConfig: string;
  apiKeyIssueFailed: string;
  apiKeyIssued: string;
  budget: string;
  budgetEnforcement: string;
  budgetTab: string;
  budgetWarning: string;
  cache: string;
  cacheEnabled: string;
  cacheSection: string;
  cacheTab: string;
  cacheTtl: string;
  catalogVersion: string;
  close: string;
  completionPrice: string;
  configVersion: string;
  defaultRoute: string;
  details: string;
  detectorType: string;
  detectors: string;
  disabled: string;
  enabled: string;
  fallbackRoute: string;
  fixtureFallback: string;
  general: string;
  history: string;
  issueApiKey: string;
  issuingApiKey: string;
  jsonMode: string;
  limit: string;
  logSafeCaptureHint: string;
  lowCostRoute: string;
  mandatoryProtection: string;
  mandatoryProtectionHint: string;
  maxBucketTokens: string;
  mode: string;
  model: string;
  models: string;
  noProviderModels: string;
  placeholder: string;
  policyDetails: string;
  pricing: string;
  pricingVersion: string;
  promptCapture: string;
  promptCaptureEnabled: string;
  promptCaptureMaxChars: string;
  promptPrice: string;
  provider: string;
  providerCatalog: string;
  providerConnectionMissing: string;
  providerCount: string;
  publish: string;
  publishedAt: string;
  rateLimit: string;
  rateLimitInfo: string;
  rateLimitTab: string;
  refillRate: string;
  remove: string;
  responseCapture: string;
  responseCaptureHint: string;
  responseCaptureMaxChars: string;
  rollback: string;
  routing: string;
  routingAdvanced: string;
  runtimeSnapshot: string;
  safetyTab: string;
  saveDraft: string;
  semanticCache: string;
  semanticCacheDisabled: string;
  semanticCacheEvidenceOnly: string;
  semanticCacheNote: string;
  shortPrompt: string;
  snapshotState: string;
  snapshotVersion: string;
  streaming: string;
  streamingNote: string;
  streamingUnavailable: string;
  templateFallback: string;
  title: string;
  tokens: string;
};
