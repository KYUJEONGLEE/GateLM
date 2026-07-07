import { getCustomerDemoModel } from "@/lib/fixtures/v1-customer-demo-fixtures";
import type {
  CustomerDemoChatProfile,
  CustomerDemoIntegrationMode,
  CustomerDemoModel
} from "@/lib/gateway/customer-demo-client";
import { getCustomerDemoLiveModel } from "@/lib/gateway/customer-demo-live-model";
import { getRequestLocale } from "@/lib/i18n/server-locale";
import { ApplicationLauncherForm } from "./application-launcher-form";

export default async function ApplicationPage() {
  const locale = await getRequestLocale();
  const text = locale === "ko" ? copy.ko : copy.en;
  const model = await getLauncherModel();
  const chatProfiles = getLauncherProfiles(model, text.defaultProject);

  return (
    <main className="application-launcher-shell">
      <section className="application-launcher-main" aria-labelledby="application-title">
        <header className="application-launcher-header">
          <div>
            <p>{text.eyebrow}</p>
            <h1 id="application-title">{text.title}</h1>
          </div>
        </header>

        <ApplicationLauncherForm
          chatProfiles={chatProfiles}
          text={text.launcher}
        />
      </section>
    </main>
  );
}

async function getLauncherModel(): Promise<CustomerDemoModel> {
  const integrationMode = getCustomerDemoIntegrationMode();

  return integrationMode === "fixture"
    ? getCustomerDemoModel()
    : getCustomerDemoLiveModel();
}

function getCustomerDemoIntegrationMode(): CustomerDemoIntegrationMode {
  return process.env.GATELM_WEB_CUSTOMER_DEMO_MODE === "fixture" ? "fixture" : "gateway";
}

function getLauncherProfiles(
  model: CustomerDemoModel,
  fallbackLabel: string
): CustomerDemoChatProfile[] {
  if (model.chatProfiles?.length) {
    return model.chatProfiles;
  }

  return [
    {
      applicationId: model.applicationId,
      configured: true,
      id: model.selectedChatProfileId ?? "default",
      isDefault: true,
      label: model.selectedChatProfileLabel ?? fallbackLabel,
      projectId: model.projectId
    }
  ];
}

const copy = {
  en: {
    defaultProject: "Default Project",
    eyebrow: "Applications",
    launcher: {
      chatStart: "Start chat",
      nameLabel: "Name",
      namePlaceholder: "Enter your name",
      profileLabel: "Project profile",
      profileMissing: "Gateway API key missing",
      profilePlaceholder: "Select a project",
      settings: "Settings"
    },
    title: "Choose an application"
  },
  ko: {
    defaultProject: "기본 프로젝트",
    eyebrow: "Applications",
    launcher: {
      chatStart: "채팅 시작하기",
      nameLabel: "이름",
      namePlaceholder: "이름을 입력하세요",
      profileLabel: "프로젝트 프로필",
      profileMissing: "Gateway API Key 누락",
      profilePlaceholder: "프로젝트를 선택하세요",
      settings: "설정"
    },
    title: "애플리케이션 선택"
  }
};
