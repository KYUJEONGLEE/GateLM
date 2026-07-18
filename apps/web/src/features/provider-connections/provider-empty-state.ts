import type { Locale } from "@/lib/i18n/locale";

export type ProviderEmptyStateGuide = {
  description: string;
  steps: readonly {
    description: string;
    title: string;
  }[];
  title: string;
};

const providerEmptyStateGuides: Record<Locale, ProviderEmptyStateGuide> = {
  en: {
    description: "Register provider credentials and models once at the tenant level, then use them across projects and Tenant Chat.",
    steps: [
      {
        description: "Choose the provider account you want to connect.",
        title: "Choose a provider"
      },
      {
        description: "Register its API key within this tenant scope.",
        title: "Add credentials"
      },
      {
        description: "Add the chat models that projects and Tenant Chat can use.",
        title: "Connect models"
      }
    ],
    title: "Connect your first provider"
  },
  ko: {
    description: "Provider 인증 정보와 모델을 Tenant 범위에 한 번 등록하고 Project와 Tenant Chat에서 함께 사용할 수 있습니다.",
    steps: [
      {
        description: "연결할 Provider 계정을 선택합니다.",
        title: "Provider 선택"
      },
      {
        description: "API Key를 현재 Tenant 범위에 등록합니다.",
        title: "인증 정보 등록"
      },
      {
        description: "Project와 Tenant Chat에서 사용할 Chat 모델을 추가합니다.",
        title: "모델 연결"
      }
    ],
    title: "첫 Provider를 연결해 모델 사용을 준비하세요"
  }
};

export function getProviderEmptyStateGuide(locale: Locale) {
  return providerEmptyStateGuides[locale];
}
