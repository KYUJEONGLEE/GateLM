import Link from "next/link";
import type {
  AdminOnboardingModel,
  CredentialIssueResponse,
  CredentialListItem
} from "@/lib/fixtures/v1-admin-fixtures";
import { CredentialOneTimeSecret } from "@/features/onboarding/components/credential-one-time-secret";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";

type AdminOnboardingFlowProps = {
  activeStepId: OnboardingStepId;
  model: AdminOnboardingModel;
};

export type OnboardingStepId =
  | "project"
  | "application"
  | "provider"
  | "api-key"
  | "app-token"
  | "runtime-config";

type OnboardingStep = {
  id: OnboardingStepId;
  label: string;
  shortLabel: string;
};

const onboardingSteps: OnboardingStep[] = [
  {
    id: "project",
    label: "Project",
    shortLabel: "Project"
  },
  {
    id: "application",
    label: "Application",
    shortLabel: "App"
  },
  {
    id: "provider",
    label: "Provider",
    shortLabel: "Provider"
  },
  {
    id: "api-key",
    label: "API Key",
    shortLabel: "API Key"
  },
  {
    id: "app-token",
    label: "App Token",
    shortLabel: "Token"
  },
  {
    id: "runtime-config",
    label: "Runtime Config",
    shortLabel: "Runtime"
  }
];

export function AdminOnboardingFlow({ activeStepId, model }: AdminOnboardingFlowProps) {
  const activeIndex = onboardingSteps.findIndex((step) => step.id === activeStepId);
  const activeStep = onboardingSteps[activeIndex] ?? onboardingSteps[0];
  const previousStep = onboardingSteps[activeIndex - 1];
  const nextStep = onboardingSteps[activeIndex + 1];

  return (
    <main className="console-content">
      <section className="onboarding-hero">
        <div>
          <p className="console-kicker">admin onboarding</p>
          <h2>Control Plane setup</h2>
        </div>
        <div className="onboarding-hero-meta">
          <span>{model.project.status}</span>
          <span>{model.application.rateLimitScope} rate limit</span>
        </div>
      </section>

      <section className="onboarding-layout" aria-label="Admin onboarding flow">
        <aside className="onboarding-rail" aria-label="Onboarding steps">
          {onboardingSteps.map((step, index) => (
            <Link
              className="onboarding-step"
              data-active={step.id === activeStep.id}
              data-state={getStepState(index, activeIndex)}
              href={getStepPath(model.tenantId, step.id)}
              key={step.id}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step.shortLabel}</strong>
            </Link>
          ))}
        </aside>

        <div className="onboarding-main">
          <div className="onboarding-step-title">
            <p>Step {activeIndex + 1}</p>
            <h3>{activeStep.label}</h3>
          </div>

          <article className="onboarding-panel">
            <div className="panel-heading">
              <span className="status-badge" data-status="success">
                configured
              </span>
            </div>

            {renderStepContent({
              activeStepId: activeStep.id,
              model
            })}
          </article>

          <div className="onboarding-actions">
            {previousStep ? (
              <Link className="secondary-button" href={getStepPath(model.tenantId, previousStep.id)}>
                Previous
              </Link>
            ) : (
              <span className="secondary-button" aria-disabled="true">
                Previous
              </span>
            )}
            {nextStep ? (
              <Link className="primary-button" href={getStepPath(model.tenantId, nextStep.id)}>
                Next
              </Link>
            ) : (
              <span className="primary-button" aria-disabled="true">
                Next
              </span>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

function renderStepContent({
  activeStepId,
  model
}: {
  activeStepId: OnboardingStepId;
  model: AdminOnboardingModel;
}) {
  if (activeStepId === "project") {
    return (
      <DetailGrid
        rows={[
          ["Tenant", model.tenantId],
          ["Project", model.project.id],
          ["Status", model.project.status],
          ["Gateway scope", "tenant scoped"]
        ]}
      />
    );
  }

  if (activeStepId === "application") {
    return (
      <DetailGrid
        rows={[
          ["Application", model.application.id],
          ["Status", model.application.status],
          ["Rate limit scope", model.application.rateLimitScope],
          ["Fixed window", `${model.application.rateLimitLimit} / ${model.application.rateLimitWindowSeconds}s`]
        ]}
      />
    );
  }

  if (activeStepId === "provider") {
    return (
      <DetailGrid
        rows={[
          ["Provider ID", model.provider.providerId],
          ["Provider", model.provider.provider],
          ["Display name", model.provider.displayName],
          ["Status", model.provider.status],
          ["Credential preview", nullableText(model.provider.credentialPreview, "none")],
          ["Resolver", model.provider.resolver],
          ["Models", String(model.provider.modelCount)],
          ["Provider call", "not executed"]
        ]}
      />
    );
  }

  if (activeStepId === "api-key") {
    return (
      <CredentialStep
        credentialName="API Key"
        issueResponse={model.apiKey.issueResponse}
        listItem={model.apiKey.listItem}
      />
    );
  }

  if (activeStepId === "app-token") {
    return (
      <CredentialStep
        credentialName="App Token"
        issueResponse={model.appToken.issueResponse}
        listItem={model.appToken.listItem}
      />
    );
  }

  return (
    <div className="onboarding-stack">
      <DetailGrid
        rows={[
          ["Config version", model.runtimeConfig.configVersion],
          ["Publish state", model.runtimeConfig.publishState],
          ["Config hash", model.runtimeConfig.configHash],
          ["Security policy hash", model.runtimeConfig.securityPolicyHash],
          ["Routing policy hash", model.runtimeConfig.routingPolicyHash],
          ["Safety mode", model.runtimeConfig.safetyMode],
          ["Detectors", String(model.runtimeConfig.detectorCount)],
          ["Cache", `${model.runtimeConfig.cacheEnabled ? "enabled" : "disabled"}:${model.runtimeConfig.cacheType}`]
        ]}
      />
      <div className="guardrail-list">
        <h4>Forbidden admin response fields</h4>
        <ul>
          {(model.forbiddenAdminResponseFields ?? []).map((field) => (
            <li key={field}>{field}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function CredentialStep({
  credentialName,
  issueResponse,
  listItem
}: {
  credentialName: string;
  issueResponse: CredentialIssueResponse;
  listItem: CredentialListItem;
}) {
  return (
    <div className="credential-flow">
      <CredentialOneTimeSecret credentialName={credentialName} issueResponse={issueResponse} />

      <section className="credential-list-state" aria-label={`${credentialName} list state`}>
        <div className="panel-heading">
          <h4>Subsequent list state</h4>
        </div>
        <DetailGrid
          rows={[
            ["Credential ID", listItem.credentialId],
            ["Display name", listItem.displayName],
            ["Status", listItem.status],
            ["Prefix", listItem.prefix],
            ["Last 4", listItem.last4],
            ["Scopes", (listItem.scopes ?? []).join(", ")],
            ["Created", formatDateTime(listItem.createdAt)],
            ["Last used", formatDateTime(listItem.lastUsedAt)]
          ]}
        />
      </section>
    </div>
  );
}

function DetailGrid({ rows }: { rows: Array<[string, string]> }) {
  return (
    <dl className="onboarding-detail-grid">
      {rows.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            <span>{value}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function normalizeOnboardingStepId(value: string | string[] | undefined): OnboardingStepId {
  const stepId = Array.isArray(value) ? value[0] : value;
  return onboardingSteps.some((step) => step.id === stepId)
    ? (stepId as OnboardingStepId)
    : "project";
}

function getStepPath(tenantId: string, stepId: OnboardingStepId) {
  return `/tenants/${tenantId}/onboarding?step=${stepId}`;
}

function getStepState(index: number, activeIndex: number) {
  if (index < activeIndex) {
    return "completed";
  }

  if (index === activeIndex) {
    return "current";
  }

  return "upcoming";
}
