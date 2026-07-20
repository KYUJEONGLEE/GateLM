"use client";

import {
  AlertTriangle,
  CheckCircle2,
  DatabaseZap,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { KnowledgeDocuments } from "@/features/rag-documents/knowledge-documents";
import type { TenantRagDocument } from "@/lib/control-plane/rag-documents-types";
import type { TenantRagKnowledgeBaseSettings } from "@/lib/control-plane/rag-knowledge-base-types";
import type { Locale } from "@/lib/i18n/locale";

type KnowledgeBaseManagementProps = {
  active: boolean;
  initialDocuments: TenantRagDocument[];
  initialDocumentsError: string | null;
  initialSettings: TenantRagKnowledgeBaseSettings | null;
  initialSettingsError: string | null;
  locale: Locale;
  tenantId: string;
};

const copy = {
  en: {
    disableHint:
      "Disabling blocks new employee retrieval and Knowledge Chat requests immediately. Documents and past citations are preserved.",
    disabled: "Disabled",
    disabledDescription:
      "Employees cannot use Knowledge Chat. You can still upload and prepare documents until they are Ready.",
    effective: "Available to employees",
    enabled: "Enabled",
    enabledDescription:
      "The global and tenant switches are enabled. Ready documents can now be used in Knowledge Chat.",
    globalDisabled:
      "The platform-wide RAG switch is off. You can save this tenant preference, but employees cannot use Knowledge Chat until the global switch is enabled.",
    loadError: "Knowledge Base settings could not be loaded.",
    retry: "Try again",
    savedDisabled: "Knowledge Chat was disabled for this tenant.",
    savedEnabled: "Knowledge Chat was enabled for this tenant.",
    saveError: "Knowledge Base settings could not be updated.",
    saving: "Saving Knowledge Base setting",
    tenantToggle: "Enable Knowledge Chat for this tenant",
    title: "Knowledge Base",
    description:
      "Prepare tenant documents first, then enable employee Knowledge Chat when the sources are ready.",
  },
  ko: {
    disableHint:
      "비활성화하면 이후 직원 retrieval과 지식 채팅 요청을 즉시 차단합니다. 기존 문서와 과거 citation은 유지됩니다.",
    disabled: "비활성",
    disabledDescription:
      "직원은 지식 채팅을 사용할 수 없습니다. 문서는 계속 업로드하고 준비됨 상태까지 처리할 수 있습니다.",
    effective: "직원 사용 가능",
    enabled: "활성",
    enabledDescription:
      "global 설정과 tenant 설정이 모두 켜져 있습니다. 준비된 문서를 지식 채팅에서 사용할 수 있습니다.",
    globalDisabled:
      "플랫폼 전체 RAG 설정이 꺼져 있습니다. tenant 설정은 저장할 수 있지만 global 설정이 켜질 때까지 직원은 지식 채팅을 사용할 수 없습니다.",
    loadError: "지식 베이스 설정을 불러오지 못했습니다.",
    retry: "다시 시도",
    savedDisabled: "이 tenant의 지식 채팅을 비활성화했습니다.",
    savedEnabled: "이 tenant의 지식 채팅을 활성화했습니다.",
    saveError: "지식 베이스 설정을 변경하지 못했습니다.",
    saving: "지식 베이스 설정 저장 중",
    tenantToggle: "이 tenant에서 지식 채팅 활성화",
    title: "지식 베이스",
    description:
      "tenant 문서를 먼저 준비한 뒤, 출처가 준비되면 직원용 지식 채팅을 활성화합니다.",
  },
} satisfies Record<Locale, Record<string, string>>;

export function KnowledgeBaseManagement({
  active,
  initialDocuments,
  initialDocumentsError,
  initialSettings,
  initialSettingsError,
  locale,
  tenantId,
}: KnowledgeBaseManagementProps) {
  const text = copy[locale];
  const [settings, setSettings] = useState(initialSettings);
  const [settingsError, setSettingsError] = useState(initialSettingsError);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function loadSettings() {
    if (pending) return;
    setPending(true);
    setFeedback(null);
    const result = await requestSettings(tenantId);
    if (result.ok) {
      setSettings(result.data);
      setSettingsError(null);
    } else {
      setSettingsError(result.error);
    }
    setPending(false);
  }

  async function updateEnabled(enabled: boolean) {
    if (pending || !settings) return;
    setPending(true);
    setFeedback(null);
    setSettingsError(null);
    const result = await requestSettings(tenantId, enabled);
    if (result.ok) {
      setSettings(result.data);
      setFeedback(enabled ? text.savedEnabled : text.savedDisabled);
    } else {
      setSettingsError(result.error);
    }
    setPending(false);
  }

  return (
    <div
      aria-labelledby="chat-app-knowledge-tab"
      className="policy-tab-panel tenant-chat-knowledge-panel space-y-5"
      hidden={!active}
      id="chat-app-knowledge-panel"
      role="tabpanel"
      tabIndex={0}
    >
      <Card data-effective-enabled={settings?.effectiveEnabled ?? false}>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="min-w-0 space-y-1">
            <CardTitle className="flex items-center gap-2">
              <DatabaseZap aria-hidden="true" />
              {text.title}
            </CardTitle>
            <CardDescription>{text.description}</CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-sm text-muted-foreground">{text.effective}</span>
            <Badge variant={settings?.effectiveEnabled ? "success" : "secondary"}>
              {settings?.effectiveEnabled ? text.enabled : text.disabled}
            </Badge>
            <Switch
              aria-label={text.tenantToggle}
              checked={settings?.tenantEnabled ?? false}
              disabled={pending || !settings}
              onCheckedChange={(enabled) => void updateEnabled(enabled)}
            />
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {settings?.effectiveEnabled
              ? text.enabledDescription
              : text.disabledDescription}
          </p>
          <p className="text-sm text-muted-foreground">{text.disableHint}</p>
          {pending ? (
            <p aria-live="polite" className="flex items-center gap-2 text-sm">
              <LoaderCircle aria-hidden="true" className="animate-spin" />
              {text.saving}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {settings && !settings.globalEnabled ? (
        <Alert variant="warning">
          <AlertTriangle aria-hidden="true" />
          <AlertDescription>{text.globalDisabled}</AlertDescription>
        </Alert>
      ) : null}

      {settingsError ? (
        <Alert variant="destructive">
          <AlertTriangle aria-hidden="true" />
          <AlertTitle>{text.loadError}</AlertTitle>
          <AlertDescription>
            <p>{settingsError || text.saveError}</p>
            <Button
              disabled={pending}
              onClick={() => void loadSettings()}
              size="sm"
              variant="outline"
            >
              {pending ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" />
              ) : (
                <RefreshCw aria-hidden="true" />
              )}
              {text.retry}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {feedback ? (
        <Alert variant="success">
          <CheckCircle2 aria-hidden="true" />
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      ) : null}

      <KnowledgeDocuments
        active={active}
        embedded
        initialDocuments={initialDocuments}
        initialLoadError={initialDocumentsError}
        locale={locale}
        tenantId={tenantId}
      />
    </div>
  );
}

async function requestSettings(
  tenantId: string,
  enabled?: boolean,
): Promise<
  | { data: TenantRagKnowledgeBaseSettings; ok: true }
  | { error: string; ok: false }
> {
  try {
    const response = await fetch(knowledgeBaseApiUrl(tenantId), {
      body: enabled === undefined ? undefined : JSON.stringify({ enabled }),
      cache: "no-store",
      headers:
        enabled === undefined
          ? undefined
          : { "Content-Type": "application/json" },
      method: enabled === undefined ? "GET" : "PATCH",
    });
    const payload = (await response.json().catch(() => ({}))) as unknown;
    if (!response.ok || !isSettings(payload)) {
      return {
        error: readPayloadError(payload),
        ok: false,
      };
    }
    return { data: payload, ok: true };
  } catch {
    return { error: "Control Plane unavailable.", ok: false };
  }
}

function knowledgeBaseApiUrl(tenantId: string) {
  return `/api/control-plane/rag-knowledge-base?tenantId=${encodeURIComponent(tenantId)}`;
}

function isSettings(value: unknown): value is TenantRagKnowledgeBaseSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.tenantEnabled === "boolean" &&
    typeof record.globalEnabled === "boolean" &&
    typeof record.effectiveEnabled === "boolean" &&
    record.effectiveEnabled === (record.tenantEnabled && record.globalEnabled)
  );
}

function readPayloadError(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const error = (value as Record<string, unknown>).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return "Knowledge Base request failed.";
}
