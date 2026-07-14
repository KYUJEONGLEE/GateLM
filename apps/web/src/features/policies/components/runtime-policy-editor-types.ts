import type { Dispatch, ReactNode, SetStateAction } from "react";

import type { BreadcrumbItem } from "@/components/ui/breadcrumb";
import type { OneTimeApiKeyResponse } from "@/lib/control-plane/api-keys-types";
import type {
  RuntimePolicyConfig,
  RuntimePolicyDetector,
  RuntimePolicyDraftValues,
  RuntimePolicyModel
} from "@/lib/control-plane/runtime-policy-types";
import type { Locale } from "@/lib/i18n/locale";

export type RuntimePolicyEditorProps = {
  apiKeyReadiness?: RuntimePolicyApiKeyReadiness;
  breadcrumbItems?: BreadcrumbItem[];
  children?: ReactNode;
  employeeSection?: ReactNode;
  generalFooter?: ReactNode;
  generalBudgetPanelPlacement?: "afterChildren" | "childSlot";
  hideStreamingTab?: boolean;
  locale: Locale;
  model: RuntimePolicyModel;
  moveBudgetToGeneral?: boolean;
  providerManagementHref?: string;
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
  | "employees"
  | "safety"
  | "routing"
  | "budget"
  | "rateLimit"
  | "cache"
  | "streaming";

export type RoutingProviderOption = {
  displayName: string;
  family: string;
  provider: string;
  providerId: string;
};

export type RuntimePolicyDraftValuesSetter = Dispatch<
  SetStateAction<RuntimePolicyDraftValues>
>;

export type RuntimePolicyEditorText = {
  activeApiKeyMissing: string;
  activeConfig: string;
  apiKeyIssueFailed: string;
  apiKeyIssued: string;
  budget: string;
  budgetEnforcement: string;
  budgetPolicyEnabled: string;
  budgetPolicyHint: string;
  budgetTab: string;
  budgetWarning: string;
  blockAction: string;
  cache: string;
  cacheEnabled: string;
  cacheEnabledHint: string;
  cacheSettings: string;
  cacheSection: string;
  cacheTab: string;
  cacheTtl: string;
  catalogVersion: string;
  close: string;
  completionPrice: string;
  configVersion: string;
  details: string;
  detectorNames: Record<RuntimePolicyDetector["type"], string>;
  detectorType: string;
  detectors: string;
  disabled: string;
  edit: string;
  enabled: string;
  employees: string;
  fixtureFallback: string;
  general: string;
  history: string;
  issueApiKey: string;
  issuingApiKey: string;
  jsonMode: string;
  limit: string;
  logSafeCaptureHint: string;
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
  privacyMasking: string;
  promptCapture: string;
  promptCaptureEnabled: string;
  promptCaptureMaxChars: string;
  promptPrice: string;
  provider: string;
  providerAdd: string;
  providerCatalog: string;
  providerConnectionMissing: string;
  providerCount: string;
  publish: string;
  publishedAt: string;
  rateLimit: string;
  rateLimitInfo: string;
  rateLimitTab: string;
  redactAction: string;
  refillRate: string;
  remove: string;
  responseCapture: string;
  responseCaptureHint: string;
  responseCaptureMaxChars: string;
  rollback: string;
  routing: string;
  routingAuthoringRequired: string;
  routingComplexModel: string;
  routingConvert: string;
  routingConversionDescription: string;
  routingConversionDraftNote: string;
  routingConversionImpact: string;
  routingConversionTitle: string;
  routingConversionUnavailable: string;
  routingFallbackModel: string;
  routingFallbackNone: string;
  routingMockWarning: string;
  routingRoleDescription: string;
  routingRoleHint: string;
  routingRoleModels: string;
  routingSimpleModel: string;
  runtimeSnapshot: string;
  safetyTab: string;
  saveDraft: string;
  semanticCache: string;
  semanticCacheDisabled: string;
  semanticCacheEvidenceOnly: string;
  semanticCacheNote: string;
  snapshotState: string;
  snapshotVersion: string;
  streaming: string;
  streamingNote: string;
  streamingUnavailable: string;
  templateFallback: string;
  title: string;
  tokens: string;
  unsavedChanges: string;
};
