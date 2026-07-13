"use client";

import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CredentialOneTimeSecret } from "@/features/onboarding/components/credential-one-time-secret";
import type {
  ApiKeyListItem,
  ApiKeysModel,
  OneTimeApiKeyResponse
} from "@/lib/control-plane/api-keys-types";
import { formatDateTime } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type ProjectGatewayApiKeySectionProps = {
  locale: Locale;
  model: ApiKeysModel;
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type ApiKeyResponsePayload = {
  apiKey?: OneTimeApiKeyResponse;
  error?: string;
};

const PRIMARY_GATEWAY_API_KEY_DISPLAY_NAME = "Primary Gateway API Key";

const gatewayApiKeyText: Record<
  Locale,
  {
    activeKey: string;
    confirmRotate: string;
    created: string;
    credential: string;
    expiresAt: string;
    fixtureFallback: string;
    issue: string;
    issueFailed: string;
    issued: string;
    lastUsed: string;
    noActiveKey: string;
    rotate: string;
    rotateFailed: string;
    rotated: string;
    scopes: string;
    status: string;
    title: string;
  }
> = {
  en: {
    activeKey: "Representative active key",
    confirmRotate:
      "The existing key will be revoked immediately and the new key plaintext will be shown only once.",
    created: "Created",
    credential: "Credential",
    expiresAt: "Expires",
    fixtureFallback: "Control Plane unavailable. Gateway API Key metadata is unavailable.",
    issue: "Issue key",
    issueFailed: "Gateway API Key issue failed.",
    issued: "Gateway API Key issued.",
    lastUsed: "Last used",
    noActiveKey: "No active Gateway API Key exists for this project.",
    rotate: "Rotate key",
    rotateFailed: "Gateway API Key rotation failed.",
    rotated: "Gateway API Key rotated.",
    scopes: "Scopes",
    status: "Status",
    title: "Gateway API Key"
  },
  ko: {
    activeKey: "대표 active key",
    confirmRotate: "기존 키는 즉시 revoke되고 새 키 원문은 한 번만 표시됩니다.",
    created: "생성",
    credential: "Credential",
    expiresAt: "만료",
    fixtureFallback: "Control Plane을 사용할 수 없어 Gateway API Key metadata를 불러올 수 없습니다.",
    issue: "새 키 발급",
    issueFailed: "Gateway API Key 발급에 실패했습니다.",
    issued: "Gateway API Key가 발급되었습니다.",
    lastUsed: "마지막 사용",
    noActiveKey: "이 Project에 active Gateway API Key가 없습니다.",
    rotate: "키 재발급",
    rotateFailed: "Gateway API Key 재발급에 실패했습니다.",
    rotated: "Gateway API Key가 재발급되었습니다.",
    scopes: "Scopes",
    status: "상태",
    title: "Gateway API Key"
  }
};

export function ProjectGatewayApiKeySection(props: ProjectGatewayApiKeySectionProps) {
  return (
    <main className="console-content management-line-content">
      <ProjectGatewayApiKeyPanel {...props} />
    </main>
  );
}

export function ProjectGatewayApiKeyPanel({
  locale,
  model
}: ProjectGatewayApiKeySectionProps) {
  const text = gatewayApiKeyText[locale];
  const [apiKeys, setApiKeys] = useState<ApiKeyListItem[]>(() => model.apiKeys ?? []);
  const [oneTimeSecret, setOneTimeSecret] = useState<OneTimeApiKeyResponse | null>(null);
  const [pendingAction, setPendingAction] = useState<"issue" | "rotate" | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const representativeKey = getRepresentativeActiveKey(apiKeys);
  const actionsDisabled = model.source !== "control-plane";

  async function submitIssueApiKey() {
    setPendingAction("issue");
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/api-keys", {
      body: JSON.stringify({
        action: "issue",
        values: {
          displayName: PRIMARY_GATEWAY_API_KEY_DISPLAY_NAME,
          expiresAt: "",
          projectId: model.controlPlaneProjectId,
          scopes: "gateway:invoke"
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ApiKeyResponsePayload;

    if (!response.ok || !payload.apiKey) {
      setSubmitState({
        message: payload.error ?? text.issueFailed,
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    setApiKeys((current) => [
      ...current,
      toListItem(payload.apiKey as OneTimeApiKeyResponse, PRIMARY_GATEWAY_API_KEY_DISPLAY_NAME)
    ]);
    setOneTimeSecret(payload.apiKey);
    setSubmitState({ message: text.issued, status: "success" });
    setPendingAction(null);
  }

  async function submitRotateApiKey(apiKey: ApiKeyListItem) {
    if (!window.confirm(text.confirmRotate)) {
      return;
    }

    setPendingAction("rotate");
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/api-keys", {
      body: JSON.stringify({
        action: "rotate",
        apiKeyId: apiKey.credentialId
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ApiKeyResponsePayload;

    if (!response.ok || !payload.apiKey) {
      setSubmitState({
        message: payload.error ?? text.rotateFailed,
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    setApiKeys((current) => [
      ...current.map((item) =>
        item.credentialId === apiKey.credentialId
          ? {
              ...item,
              status: "revoked" as const
            }
          : item
      ),
      toListItem(payload.apiKey as OneTimeApiKeyResponse, apiKey.displayName)
    ]);
    setOneTimeSecret(payload.apiKey);
    setSubmitState({ message: text.rotated, status: "success" });
    setPendingAction(null);
  }

  return (
      <section className="team-section gateway-api-key-section">
        <div className="gateway-api-key-layout">
          <div className="gateway-api-key-heading">
            <h3>{text.title}</h3>
          </div>

          <div className="gateway-api-key-main">
            {model.source === "error" ? (
              <Alert variant="warning">
                <AlertDescription>
                  {text.fixtureFallback} {model.loadError}
                </AlertDescription>
              </Alert>
            ) : null}

            {submitState.message ? (
              <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
                <AlertDescription>{submitState.message}</AlertDescription>
              </Alert>
            ) : null}

            {oneTimeSecret ? (
              <CredentialOneTimeSecret
                credentialName="Gateway API Key"
                issueResponse={oneTimeSecret}
                locale={locale}
              />
            ) : null}

            {representativeKey ? (
              <article className="gateway-api-key-card">
                <div>
                  <span>{text.activeKey}</span>
                  <strong>{representativeKey.displayName}</strong>
                </div>
                <div>
                  <span>{text.credential}</span>
                  <code>{`${representativeKey.prefix}...${representativeKey.last4}`}</code>
                </div>
                <div>
                  <span>{text.status}</span>
                  <Badge
                    className="project-status-badge"
                    data-status={representativeKey.status.toUpperCase()}
                    variant="outline"
                  >
                    {representativeKey.status}
                  </Badge>
                </div>
                <div>
                  <span>{text.scopes}</span>
                  <p>{representativeKey.scopes.join(", ") || "none"}</p>
                </div>
                <div>
                  <span>{text.created}</span>
                  <p>{formatDateTime(representativeKey.createdAt)}</p>
                </div>
                <div>
                  <span>{text.expiresAt}</span>
                  <p>{formatDateTime(representativeKey.expiresAt)}</p>
                </div>
                <div>
                  <span>{text.lastUsed}</span>
                  <p>{formatDateTime(representativeKey.lastUsedAt)}</p>
                </div>
              </article>
            ) : (
              <div className="secret-placeholder secret-placeholder-action">
                <span>{text.noActiveKey}</span>
              </div>
            )}

            <div className="gateway-api-key-actions">
              {representativeKey ? (
                <Button
                  className="gateway-api-key-action-button gateway-api-key-rotate-button"
                  disabled={pendingAction !== null || actionsDisabled}
                  onClick={() => void submitRotateApiKey(representativeKey)}
                  type="button"
                >
                  {pendingAction === "rotate" ? "..." : text.rotate}
                </Button>
              ) : (
                <Button
                  className="gateway-api-key-action-button"
                  disabled={pendingAction !== null || actionsDisabled}
                  onClick={() => void submitIssueApiKey()}
                  type="button"
                >
                  {pendingAction === "issue" ? "..." : text.issue}
                </Button>
              )}
            </div>
          </div>
        </div>
      </section>
  );
}

function getRepresentativeActiveKey(apiKeys: ApiKeyListItem[]) {
  return apiKeys
    .filter((apiKey) => apiKey.status === "active" && !isExpired(apiKey.expiresAt))
    .sort(
      (left, right) =>
        new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    )[0] ?? null;
}

function toListItem(apiKey: OneTimeApiKeyResponse, displayName: string): ApiKeyListItem {
  return {
    createdAt: apiKey.createdAt,
    credentialId: apiKey.credentialId,
    credentialType: "api_key",
    displayName,
    expiresAt: apiKey.expiresAt,
    last4: apiKey.last4,
    lastUsedAt: null,
    prefix: apiKey.prefix,
    projectId: "",
    projectName: "",
    scopes: apiKey.scopes,
    status: apiKey.status
  };
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) {
    return false;
  }

  const expiresAtTime = new Date(expiresAt).getTime();

  return Number.isNaN(expiresAtTime) ? false : expiresAtTime <= Date.now();
}
