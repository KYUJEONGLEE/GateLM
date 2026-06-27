import Link from "next/link";
import type {
  AdminOnboardingModel,
  CredentialIssueResponse,
  CredentialListItem
} from "@/lib/fixtures/v1-admin-fixtures";
import { CredentialOneTimeSecret } from "@/features/onboarding/components/credential-one-time-secret";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type AdminOnboardingFlowProps = {
  activeStepId: OnboardingStepId;
  locale: Locale;
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
  labels: Record<
    Locale,
    {
      label: string;
      summary: string;
    }
  >;
};

const onboardingSteps: OnboardingStep[] = [
  {
    id: "project",
    labels: {
      en: {
        label: "Project",
        summary: "Tenant-scoped customer support project"
      },
      ko: {
        label: "프로젝트",
        summary: "테넌트 범위 고객 지원 프로젝트"
      }
    }
  },
  {
    id: "application",
    labels: {
      en: {
        label: "Application",
        summary: "Customer demo app and rate limit scope"
      },
      ko: {
        label: "애플리케이션",
        summary: "고객사 데모 앱과 rate limit 범위"
      }
    }
  },
  {
    id: "provider",
    labels: {
      en: {
        label: "Provider",
        summary: "Mock provider configuration without direct calls"
      },
      ko: {
        label: "Provider",
        summary: "직접 호출 없는 mock provider 설정"
      }
    }
  },
  {
    id: "api-key",
    labels: {
      en: {
        label: "API Key",
        summary: "Gateway API key issue and list states"
      },
      ko: {
        label: "API Key",
        summary: "Gateway API key 발급과 조회 상태"
      }
    }
  },
  {
    id: "app-token",
    labels: {
      en: {
        label: "App Token",
        summary: "Application-bound token issue and list states"
      },
      ko: {
        label: "App Token",
        summary: "Application에 묶인 token 발급과 조회 상태"
      }
    }
  },
  {
    id: "runtime-config",
    labels: {
      en: {
        label: "Runtime Config",
        summary: "Published config consumed by Gateway"
      },
      ko: {
        label: "Runtime Config",
        summary: "Gateway가 소비하는 publish된 설정"
      }
    }
  }
];

const onboardingText: Record<
  Locale,
  {
    heroCopy: string;
    noProviderCall: string;
    next: string;
    previous: string;
    step: string;
    title: string;
  }
> = {
  en: {
    heroCopy:
      "Fixture-backed setup path for Project, Application, Provider, API Key, App Token, and the active Runtime Config consumed by Gateway.",
    noProviderCall: "No provider call",
    next: "Next",
    previous: "Previous",
    step: "step",
    title: "Control Plane setup flow"
  },
  ko: {
    heroCopy:
      "Project, Application, Provider, API Key, App Token, 그리고 Gateway가 소비하는 active Runtime Config 준비 흐름을 fixture로 확인합니다.",
    noProviderCall: "Provider 직접 호출 없음",
    next: "다음",
    previous: "이전",
    step: "단계",
    title: "Control Plane 설정 흐름"
  }
};

export function AdminOnboardingFlow({ activeStepId, locale, model }: AdminOnboardingFlowProps) {
  const activeIndex = onboardingSteps.findIndex((step) => step.id === activeStepId);
  const activeStep = onboardingSteps[activeIndex] ?? onboardingSteps[0];
  const previousStep = onboardingSteps[activeIndex - 1];
  const nextStep = onboardingSteps[activeIndex + 1];
  const text = onboardingText[locale];
  const activeStepLabel = activeStep.labels[locale].label;

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">admin onboarding</p>
          <h2>{text.title}</h2>
          <p>{text.heroCopy}</p>
        </div>
        <div className="console-context">{text.noProviderCall}</div>
      </section>

      <section className="onboarding-layout" aria-label="Admin onboarding flow">
        <aside className="onboarding-rail" aria-label="Onboarding steps">
          {onboardingSteps.map((step, index) => (
            <Link
              className="onboarding-step"
              data-active={step.id === activeStep.id}
              data-position={index < activeIndex ? "previous" : "current-or-next"}
              href={getStepPath(model.tenantId, step.id)}
              key={step.id}
            >
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step.labels[locale].label}</strong>
              <small>{step.labels[locale].summary}</small>
            </Link>
          ))}
        </aside>

        <div className="onboarding-main">
          <article className="console-panel onboarding-panel">
            <div className="panel-heading">
              <div>
                <p className="console-kicker">
                  {text.step} {activeIndex + 1}
                </p>
                <h3>{activeStepLabel}</h3>
              </div>
              <span className="status-badge" data-status="success">
                fixture
              </span>
            </div>

            {renderStepContent({
              activeStepId: activeStep.id,
              locale,
              model
            })}
          </article>

          <div className="onboarding-actions">
            {previousStep ? (
              <Link className="secondary-button" href={getStepPath(model.tenantId, previousStep.id)}>
                {text.previous}
              </Link>
            ) : (
              <span className="secondary-button" aria-disabled="true">
                {text.previous}
              </span>
            )}
            {nextStep ? (
              <Link className="primary-button" href={getStepPath(model.tenantId, nextStep.id)}>
                {text.next}
              </Link>
            ) : (
              <span className="primary-button" aria-disabled="true">
                {text.next}
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
  locale,
  model
}: {
  activeStepId: OnboardingStepId;
  locale: Locale;
  model: AdminOnboardingModel;
}) {
  if (activeStepId === "project") {
    return (
      <DetailGrid
        rows={[
          ["Tenant", model.tenantId],
          ["Project", model.project.id],
          ["Status", model.project.status],
          ["API state", "fixture only"]
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
        locale={locale}
        listItem={model.apiKey.listItem}
      />
    );
  }

  if (activeStepId === "app-token") {
    return (
      <CredentialStep
        credentialName="App Token"
        issueResponse={model.appToken.issueResponse}
        locale={locale}
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
  locale,
  listItem
}: {
  credentialName: string;
  issueResponse: CredentialIssueResponse;
  locale: Locale;
  listItem: CredentialListItem;
}) {
  const listTitle = locale === "ko" ? "이후 조회 상태" : "Subsequent list state";
  const listCopy =
    locale === "ko" ? "평문과 secret hash는 응답에 포함하지 않습니다." : "Plaintext and secret hash are absent.";

  return (
    <div className="credential-flow">
      <CredentialOneTimeSecret
        credentialName={credentialName}
        issueResponse={issueResponse}
        locale={locale}
      />

      <section className="credential-list-state" aria-label={`${credentialName} list state`}>
        <div className="panel-heading">
          <h4>{listTitle}</h4>
          <p>{listCopy}</p>
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
          <dd>{value}</dd>
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
