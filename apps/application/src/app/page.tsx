import { getCustomerDemoModel } from "@/lib/fixtures/v1-customer-demo-fixtures";
import type {
  CustomerDemoChatProfile,
  CustomerDemoIntegrationMode,
  CustomerDemoModel
} from "@/lib/gateway/customer-demo-client";
import { getCustomerDemoLiveModel } from "@/lib/gateway/customer-demo-live-model";
import { getRequestLocale } from "@/lib/i18n/server-locale";
import { MessageCircle } from "lucide-react";
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
          <span className="application-launcher-header-icon" aria-hidden="true">
            <MessageCircle size={34} strokeWidth={2.6} />
          </span>
          <div className="application-launcher-header-copy">
            <p>{text.eyebrow}</p>
            <h1 id="application-title">{text.title}</h1>
            <small>{text.subtitle}</small>
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
    : await getCustomerDemoLiveModel();
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
    defaultProject: "Test Project",
    eyebrow: "CHATTING",
    launcher: {
      chatStart: "Start chat",
      nameLabel: "Name",
      namePlaceholder: "Enter your name",
      profileLabel: "Project profile",
      profileMissing: "Gateway API key missing",
      profilePlaceholder: "Select a project",
      settings: "Settings"
    },
    subtitle: "Choose a name and project, then start a new conversation.",
    title: "Start chatting"
  },
  ko: {
    defaultProject: "테스트 프로젝트",
    eyebrow: "CHATTING",
    launcher: {
      chatStart: "채팅 시작하기",
      nameLabel: "이름",
      namePlaceholder: "이름을 입력하세요",
      profileLabel: "프로젝트 프로필",
      profileMissing: "Gateway API Key 누락",
      profilePlaceholder: "프로젝트를 선택하세요",
      settings: "설정"
    },
    subtitle: "이름과 프로젝트를 선택하고 새로운 대화를 시작해보세요.",
    title: "채팅 시작하기"
  }
};
