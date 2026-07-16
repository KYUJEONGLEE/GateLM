import {
  DatabaseZap,
  KeyRound,
  LockKeyhole,
  ShieldCheck,
  UserRoundCheck
} from "lucide-react";

import type { Locale } from "@/lib/i18n/locale";

export type ChatAppReadOnlyPolicySection = "cache" | "security";

type PolicySummaryItem = {
  description: string;
  icon: typeof DatabaseZap;
  title: string;
};

const copy: Record<
  Locale,
  Record<ChatAppReadOnlyPolicySection, {
    boundary: string;
    description: string;
    items: PolicySummaryItem[];
    readOnly: string;
    title: string;
  }>
> = {
  en: {
    cache: {
      boundary:
        "The current Chat App admin API only edits routing. Cache settings remain preserved in the active RuntimeSnapshot, so this tab describes the enforced policy boundary without exposing inactive controls.",
      description: "How Tenant Chat reuses completed responses without another Provider call.",
      items: [
        {
          description: "Only completed responses for an identical request in the same tenant and user scope are eligible.",
          icon: DatabaseZap,
          title: "Exact cache"
        },
        {
          description: "A cache hit skips the Provider call and records zero confirmed token and cost debit.",
          icon: ShieldCheck,
          title: "Usage handling"
        },
        {
          description: "Cache values are encrypted and bound to the selected runtime policy and model route.",
          icon: LockKeyhole,
          title: "Isolation and encryption"
        }
      ],
      readOnly: "Policy overview",
      title: "Cache"
    },
    security: {
      boundary:
        "The current Chat App admin API only edits routing. Security settings remain preserved in the active RuntimeSnapshot, so this tab describes the enforced policy boundary without exposing inactive controls.",
      description: "Security controls applied before routing, cache lookup, and Provider execution.",
      items: [
        {
          description: "Detected personal information follows the active masking or blocking action before execution continues.",
          icon: UserRoundCheck,
          title: "Personal data protection"
        },
        {
          description: "API keys, authorization headers, JWTs, and private keys remain mandatory protected values.",
          icon: KeyRound,
          title: "Secret protection"
        },
        {
          description: "Raw prompts, raw responses, and detected values are not exposed through this console.",
          icon: LockKeyhole,
          title: "Raw content protection"
        }
      ],
      readOnly: "Policy overview",
      title: "Security"
    }
  },
  ko: {
    cache: {
      boundary:
        "현재 채팅 앱 관리 API는 라우팅 설정만 편집합니다. 캐시 설정은 활성 RuntimeSnapshot에서 보존되며, 이 탭은 비활성 조작 UI 없이 실제 적용 경계만 안내합니다.",
      description: "Provider를 다시 호출하지 않고 Tenant Chat의 완료 응답을 재사용하는 기준입니다.",
      items: [
        {
          description: "같은 테넌트·사용자 범위에서 동일한 요청의 완료 응답만 재사용 대상이 됩니다.",
          icon: DatabaseZap,
          title: "정확 일치 캐시"
        },
        {
          description: "캐시 적중 시 Provider를 호출하지 않으며 확정 토큰·비용 차감은 0으로 기록됩니다.",
          icon: ShieldCheck,
          title: "사용량 처리"
        },
        {
          description: "캐시 값은 암호화되고 선택된 런타임 정책과 모델 경로에 결합됩니다.",
          icon: LockKeyhole,
          title: "격리 및 암호화"
        }
      ],
      readOnly: "정책 안내",
      title: "캐시"
    },
    security: {
      boundary:
        "현재 채팅 앱 관리 API는 라우팅 설정만 편집합니다. 보안 설정은 활성 RuntimeSnapshot에서 보존되며, 이 탭은 비활성 조작 UI 없이 실제 적용 경계만 안내합니다.",
      description: "라우팅·캐시 조회·Provider 실행 전에 적용되는 Tenant Chat 보안 기준입니다.",
      items: [
        {
          description: "탐지된 개인정보는 실행을 계속하기 전에 활성 정책의 마스킹 또는 차단 처리를 따릅니다.",
          icon: UserRoundCheck,
          title: "개인정보 보호"
        },
        {
          description: "API Key, Authorization header, JWT, private key는 항상 보호되는 민감정보입니다.",
          icon: KeyRound,
          title: "Secret 보호"
        },
        {
          description: "raw prompt, raw response와 탐지된 원문은 이 콘솔에 노출하지 않습니다.",
          icon: LockKeyhole,
          title: "원문 보호"
        }
      ],
      readOnly: "정책 안내",
      title: "보안"
    }
  }
};

export function ChatAppPolicySummary({
  locale,
  section
}: {
  locale: Locale;
  section: ChatAppReadOnlyPolicySection;
}) {
  const text = copy[locale][section];

  return (
    <div className="chat-app-policy-summary">
      <header className="chat-app-policy-summary-heading">
        <div>
          <span>{text.readOnly}</span>
          <h3>{text.title}</h3>
        </div>
        <p>{text.description}</p>
      </header>

      <div className="chat-app-policy-summary-list">
        {text.items.map((item) => {
          const ItemIcon = item.icon;

          return (
            <article className="chat-app-policy-summary-item" key={item.title}>
              <span aria-hidden="true" className="chat-app-policy-summary-icon">
                <ItemIcon />
              </span>
              <div>
                <strong>{item.title}</strong>
                <p>{item.description}</p>
              </div>
            </article>
          );
        })}
      </div>

      <div className="chat-app-policy-boundary-note">
        <LockKeyhole aria-hidden="true" />
        <p>{text.boundary}</p>
      </div>
    </div>
  );
}
