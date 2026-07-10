"use client";

import { Ban, Copy, EyeOff, Plus, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ApiKeyIssueValues,
  ApiKeyListItem,
  ApiKeysModel,
  OneTimeApiKeyResponse
} from "@/lib/control-plane/api-keys-types";
import { formatDateTime } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type ApiKeyManagementProps = {
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

type ApiKeyRevokePayload = {
  error?: string;
  revoked?: {
    credentialId: string;
    revokedAt: string;
    status: "revoked";
  };
};

type OneTimeSecretState = {
  apiKey: OneTimeApiKeyResponse;
  displayName: string;
  hidden: boolean;
  mode: "issued" | "rotated";
};

const defaultIssueValues: ApiKeyIssueValues = {
  displayName: "",
  expiresAt: "",
  scopes: "chat:completions, models:read"
};

const apiKeyText: Record<
  Locale,
  {
    actions: string;
    activeOnly: string;
    copy: string;
    created: string;
    credential: string;
    empty: string;
    expiresAt: string;
    fixtureFallback: string;
    hide: string;
    issue: string;
    lastUsed: string;
    management: string;
    name: string;
    plaintext: string;
    projectId: string;
    revoke: string;
    rotate: string;
    scopes: string;
    source: string;
    status: string;
    stored: string;
    title: string;
    warning: string;
  }
> = {
  en: {
    actions: "Actions",
    activeOnly: "Only active, unexpired API Keys can be rotated.",
    copy: "Copy",
    created: "Created",
    credential: "Credential",
    empty: "No API Keys found.",
    expiresAt: "Expires at",
    fixtureFallback: "Control Plane unavailable. Showing fixture API Key metadata.",
    hide: "Mark stored",
    issue: "Issue API Key",
    lastUsed: "Last used",
    management: "management",
    name: "Display name",
    plaintext: "one-time plaintext",
    projectId: "Project ID",
    revoke: "Revoke",
    rotate: "Rotate",
    scopes: "Scopes",
    source: "Source",
    status: "Status",
    stored: "Plaintext hidden. Lists keep only prefix and last4.",
    title: "API Keys",
    warning: "Store this value now. GateLM will not show it again."
  },
  ko: {
    actions: "작업",
    activeOnly: "회전은 active 상태이고 만료되지 않은 API Key에서만 가능합니다.",
    copy: "복사",
    created: "생성",
    credential: "Credential",
    empty: "API Key가 없습니다.",
    expiresAt: "만료 시각",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture API Key metadata를 표시 중입니다.",
    hide: "저장 완료 처리",
    issue: "API Key 발급",
    lastUsed: "마지막 사용",
    management: "관리",
    name: "표시 이름",
    plaintext: "1회 표시 원문",
    projectId: "Project ID",
    revoke: "폐기",
    rotate: "회전",
    scopes: "Scopes",
    source: "출처",
    status: "상태",
    stored: "원문을 숨겼습니다. 목록에는 prefix와 last4만 유지합니다.",
    title: "API Keys",
    warning: "지금 저장하세요. GateLM은 이 값을 다시 보여주지 않습니다."
  }
};

export function ApiKeyManagement({ locale, model }: ApiKeyManagementProps) {
  const router = useRouter();
  const text = apiKeyText[locale];
  const [apiKeys, setApiKeys] = useState<ApiKeyListItem[]>(model.apiKeys);
  const [issueValues, setIssueValues] = useState<ApiKeyIssueValues>(defaultIssueValues);
  const [oneTimeSecret, setOneTimeSecret] = useState<OneTimeSecretState | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const actionsDisabled = model.source === "fixture";

  async function submitIssueApiKey() {
    if (!issueValues.displayName.trim()) {
      setSubmitState({
        message: locale === "ko" ? "표시 이름을 입력하세요." : "Display name is required.",
        status: "error"
      });
      return;
    }

    setPendingAction("issue");
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/api-keys", {
      body: JSON.stringify({
        action: "issue",
        values: issueValues
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ApiKeyResponsePayload;

    if (!response.ok || !payload.apiKey) {
      setSubmitState({
        message: payload.error ?? "API Key issue failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    const issuedApiKey = payload.apiKey;
    const displayName = issueValues.displayName.trim();

    setApiKeys((current) => [...current, toListItem(issuedApiKey, displayName)]);
    setOneTimeSecret({
      apiKey: issuedApiKey,
      displayName,
      hidden: false,
      mode: "issued"
    });
    setIssueValues(defaultIssueValues);
    setSubmitState({
      message: locale === "ko" ? "API Key가 발급되었습니다." : "API Key issued.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function submitRotateApiKey(apiKey: ApiKeyListItem) {
    setPendingAction(`rotate:${apiKey.credentialId}`);
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
        message: payload.error ?? "API Key rotation failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    const rotatedApiKey = payload.apiKey;

    setApiKeys((current) => [
      ...current.map((item) =>
        item.credentialId === apiKey.credentialId
          ? {
              ...item,
              status: "revoked" as const
            }
          : item
      ),
      toListItem(rotatedApiKey, apiKey.displayName)
    ]);
    setOneTimeSecret({
      apiKey: rotatedApiKey,
      displayName: apiKey.displayName,
      hidden: false,
      mode: "rotated"
    });
    setSubmitState({
      message: locale === "ko" ? "API Key가 회전되었습니다." : "API Key rotated.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function submitRevokeApiKey(apiKey: ApiKeyListItem) {
    setPendingAction(`revoke:${apiKey.credentialId}`);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/api-keys", {
      body: JSON.stringify({
        action: "revoke",
        apiKeyId: apiKey.credentialId
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ApiKeyRevokePayload;

    if (!response.ok || !payload.revoked) {
      setSubmitState({
        message: payload.error ?? "API Key revoke failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    setApiKeys((current) =>
      current.map((item) =>
        item.credentialId === apiKey.credentialId
          ? {
              ...item,
              status: "revoked" as const
            }
          : item
      )
    );
    setSubmitState({
      message: locale === "ko" ? "API Key가 폐기되었습니다." : "API Key revoked.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function copyOneTimeSecret() {
    if (!oneTimeSecret || oneTimeSecret.hidden) {
      return;
    }

    await navigator.clipboard.writeText(oneTimeSecret.apiKey.plaintext);
  }

  return (
    <main className="console-content management-line-content">
      <section className="dashboard-hero">
        <div>
          <h2>{text.title}</h2>
        </div>
      </section>

      {model.source === "fixture" ? (
        <Alert variant="warning">
          <AlertDescription>{text.fixtureFallback} {model.loadError}</AlertDescription>
        </Alert>
      ) : null}
      {submitState.message ? (
        <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}

      {oneTimeSecret ? (
        <section className="one-time-secret" data-hidden={oneTimeSecret.hidden}>
          <div>
            <p className="console-kicker">
              {oneTimeSecret.mode === "issued" ? text.issue : text.rotate}
            </p>
            <h4>
              {oneTimeSecret.displayName} {text.plaintext}
            </h4>
            <p>{oneTimeSecret.apiKey.warning || text.warning}</p>
          </div>
          {oneTimeSecret.hidden ? (
            <div className="secret-placeholder">{text.stored}</div>
          ) : (
            <>
              <code>{oneTimeSecret.apiKey.plaintext}</code>
              <div className="api-key-secret-actions">
                <Button onClick={() => void copyOneTimeSecret()} type="button" variant="outline">
                  <Copy aria-hidden="true" />
                  {text.copy}
                </Button>
                <Button
                  onClick={() =>
                    setOneTimeSecret((current) =>
                      current
                        ? {
                            ...current,
                            hidden: true
                          }
                        : current
                    )
                  }
                  type="button"
                >
                  <EyeOff aria-hidden="true" />
                  {text.hide}
                </Button>
              </div>
            </>
          )}
        </section>
      ) : null}

      <section className="console-panel credential-line-panel">
        <div className="panel-heading">
          <h3>{text.issue}</h3>
        </div>
        <div className="api-key-issue-form">
          <label className="policy-field">
            <span>{text.name}</span>
            <input
              maxLength={120}
              onChange={(event) =>
                setIssueValues((current) => ({
                  ...current,
                  displayName: event.target.value
                }))
              }
              type="text"
              value={issueValues.displayName}
            />
          </label>
          <label className="policy-field">
            <span>{text.scopes}</span>
            <input
              maxLength={240}
              onChange={(event) =>
                setIssueValues((current) => ({
                  ...current,
                  scopes: event.target.value
                }))
              }
              type="text"
              value={issueValues.scopes}
            />
          </label>
          <label className="policy-field">
            <span>{text.expiresAt}</span>
            <input
              onChange={(event) =>
                setIssueValues((current) => ({
                  ...current,
                  expiresAt: event.target.value
                }))
              }
              type="datetime-local"
              value={issueValues.expiresAt}
            />
          </label>
          <div className="api-key-form-actions">
            <Button
              disabled={pendingAction === "issue" || actionsDisabled}
              onClick={() => void submitIssueApiKey()}
              type="button"
            >
              <Plus aria-hidden="true" />
              {text.issue}
            </Button>
          </div>
        </div>
      </section>

      <section className="console-panel credential-line-panel">
        <div className="panel-heading">
          <h3>{text.title}</h3>
          <p>{text.activeOnly}</p>
        </div>
        {apiKeys.length === 0 ? (
          <p className="project-empty">{text.empty}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table api-key-table">
              <thead>
                <tr>
                  <th>{text.name}</th>
                  <th>{text.credential}</th>
                  <th>{text.status}</th>
                  <th>{text.scopes}</th>
                  <th>{text.created}</th>
                  <th>{text.actions}</th>
                </tr>
              </thead>
              <tbody>
                {apiKeys.map((apiKey) => {
                  const canRotate = apiKey.status === "active" && !isExpired(apiKey.expiresAt);
                  const isPending =
                    pendingAction === `rotate:${apiKey.credentialId}` ||
                    pendingAction === `revoke:${apiKey.credentialId}`;

                  return (
                    <tr key={apiKey.credentialId}>
                      <td>
                        <strong className="provider-name">{apiKey.displayName}</strong>
                        <code className="project-code">{apiKey.credentialId}</code>
                      </td>
                      <td>
                        <code className="project-code">{apiKey.prefix}</code>
                        <small className="project-muted">last4: {apiKey.last4}</small>
                      </td>
                      <td>
                        <Badge
                          className="project-status-badge"
                          data-status={apiKey.status.toUpperCase()}
                          variant="outline"
                        >
                          {apiKey.status}
                        </Badge>
                      </td>
                      <td>
                        <span className="project-muted">{apiKey.scopes.join(", ") || "none"}</span>
                      </td>
                      <td>
                        <span className="project-muted">{formatDateTime(apiKey.createdAt)}</span>
                        <small className="project-muted">
                          {text.expiresAt}: {formatDateTime(apiKey.expiresAt)}
                        </small>
                        <small className="project-muted">
                          {text.lastUsed}: {formatDateTime(apiKey.lastUsedAt)}
                        </small>
                      </td>
                      <td>
                        <div className="project-row-actions api-key-row-actions">
                          <Button
                            disabled={isPending || !canRotate || actionsDisabled}
                            onClick={() => void submitRotateApiKey(apiKey)}
                            type="button"
                            variant="outline"
                          >
                            <RotateCcw aria-hidden="true" />
                            {text.rotate}
                          </Button>
                          <Button
                            disabled={isPending || apiKey.status === "revoked" || actionsDisabled}
                            onClick={() => void submitRevokeApiKey(apiKey)}
                            type="button"
                            variant="destructive"
                          >
                            <Ban aria-hidden="true" />
                            {text.revoke}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
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
