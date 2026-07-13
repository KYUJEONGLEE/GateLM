"use client";

import { Ban, Copy, EyeOff, Plus, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  AppTokenIssueValues,
  AppTokenListItem,
  AppTokensModel,
  OneTimeAppTokenResponse
} from "@/lib/control-plane/app-tokens-types";
import { formatDateTime } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type AppTokenManagementProps = {
  locale: Locale;
  model: AppTokensModel;
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type AppTokenResponsePayload = {
  appToken?: OneTimeAppTokenResponse;
  error?: string;
};

type AppTokenRevokePayload = {
  error?: string;
  revoked?: {
    credentialId: string;
    revokedAt: string;
    status: "revoked";
  };
};

type OneTimeSecretState = {
  appToken: OneTimeAppTokenResponse;
  displayName: string;
  hidden: boolean;
  mode: "issued" | "rotated";
};

const defaultIssueValues: AppTokenIssueValues = {
  displayName: "",
  expiresAt: "",
  scopes: "gateway:invoke"
};

const appTokenText: Record<
  Locale,
  {
    actions: string;
    activeOnly: string;
    applicationId: string;
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
    activeOnly: "Only active, unexpired App Tokens can be rotated.",
    applicationId: "Application ID",
    copy: "Copy",
    created: "Created",
    credential: "Credential",
    empty: "No App Tokens found.",
    expiresAt: "Expires at",
    fixtureFallback: "Control Plane unavailable. Showing fixture App Token metadata.",
    hide: "Mark stored",
    issue: "Issue App Token",
    lastUsed: "Last used",
    management: "management",
    name: "Display name",
    plaintext: "one-time plaintext",
    revoke: "Revoke",
    rotate: "Rotate",
    scopes: "Scopes",
    source: "Source",
    status: "Status",
    stored: "Plaintext hidden. Lists keep only prefix and last4.",
    title: "App Tokens",
    warning: "Store this value now. GateLM will not show it again."
  },
  ko: {
    actions: "작업",
    activeOnly: "회전은 active 상태이고 만료되지 않은 App Token에서만 가능합니다.",
    applicationId: "Application ID",
    copy: "복사",
    created: "생성",
    credential: "Credential",
    empty: "App Token이 없습니다.",
    expiresAt: "만료 시각",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture App Token metadata를 표시 중입니다.",
    hide: "저장 완료 처리",
    issue: "App Token 발급",
    lastUsed: "마지막 사용",
    management: "관리",
    name: "표시 이름",
    plaintext: "1회 표시 원문",
    revoke: "폐기",
    rotate: "회전",
    scopes: "Scopes",
    source: "출처",
    status: "상태",
    stored: "원문을 숨겼습니다. 목록에는 prefix와 last4만 유지합니다.",
    title: "App Tokens",
    warning: "지금 저장하세요. GateLM은 이 값을 다시 보여주지 않습니다."
  }
};

export function AppTokenManagement({ locale, model }: AppTokenManagementProps) {
  const router = useRouter();
  const text = appTokenText[locale];
  const [appTokens, setAppTokens] = useState<AppTokenListItem[]>(model.appTokens);
  const [issueValues, setIssueValues] = useState<AppTokenIssueValues>(defaultIssueValues);
  const [oneTimeSecret, setOneTimeSecret] = useState<OneTimeSecretState | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const actionsDisabled = model.source === "fixture";

  async function submitIssueAppToken() {
    if (!issueValues.displayName.trim()) {
      setSubmitState({
        message: locale === "ko" ? "표시 이름을 입력하세요." : "Display name is required.",
        status: "error"
      });
      return;
    }

    setPendingAction("issue");
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/app-tokens", {
      body: JSON.stringify({
        action: "issue",
        values: issueValues
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as AppTokenResponsePayload;

    if (!response.ok || !payload.appToken) {
      setSubmitState({
        message: payload.error ?? "App Token issue failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    const issuedAppToken = payload.appToken;
    const displayName = issueValues.displayName.trim();

    setAppTokens((current) => [...current, toListItem(issuedAppToken, displayName)]);
    setOneTimeSecret({
      appToken: issuedAppToken,
      displayName,
      hidden: false,
      mode: "issued"
    });
    setIssueValues(defaultIssueValues);
    setSubmitState({
      message: locale === "ko" ? "App Token이 발급되었습니다." : "App Token issued.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function submitRotateAppToken(appToken: AppTokenListItem) {
    setPendingAction(`rotate:${appToken.credentialId}`);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/app-tokens", {
      body: JSON.stringify({
        action: "rotate",
        appTokenId: appToken.credentialId
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as AppTokenResponsePayload;

    if (!response.ok || !payload.appToken) {
      setSubmitState({
        message: payload.error ?? "App Token rotation failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    const rotatedAppToken = payload.appToken;

    setAppTokens((current) => [
      ...current.map((item) =>
        item.credentialId === appToken.credentialId
          ? {
              ...item,
              status: "revoked" as const
            }
          : item
      ),
      toListItem(rotatedAppToken, appToken.displayName)
    ]);
    setOneTimeSecret({
      appToken: rotatedAppToken,
      displayName: appToken.displayName,
      hidden: false,
      mode: "rotated"
    });
    setSubmitState({
      message: locale === "ko" ? "App Token이 회전되었습니다." : "App Token rotated.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function submitRevokeAppToken(appToken: AppTokenListItem) {
    setPendingAction(`revoke:${appToken.credentialId}`);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/app-tokens", {
      body: JSON.stringify({
        action: "revoke",
        appTokenId: appToken.credentialId
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as AppTokenRevokePayload;

    if (!response.ok || !payload.revoked) {
      setSubmitState({
        message: payload.error ?? "App Token revoke failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    setAppTokens((current) =>
      current.map((item) =>
        item.credentialId === appToken.credentialId
          ? {
              ...item,
              status: "revoked" as const
            }
          : item
      )
    );
    setSubmitState({
      message: locale === "ko" ? "App Token이 폐기되었습니다." : "App Token revoked.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function copyOneTimeSecret() {
    if (!oneTimeSecret || oneTimeSecret.hidden) {
      return;
    }

    await navigator.clipboard.writeText(oneTimeSecret.appToken.plaintext);
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
            <p>{oneTimeSecret.appToken.warning || text.warning}</p>
          </div>
          {oneTimeSecret.hidden ? (
            <div className="secret-placeholder">{text.stored}</div>
          ) : (
            <>
              <code>{oneTimeSecret.appToken.plaintext}</code>
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
              onClick={() => void submitIssueAppToken()}
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
        {appTokens.length === 0 ? (
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
                {appTokens.map((appToken) => {
                  const canRotate = appToken.status === "active" && !isExpired(appToken.expiresAt);
                  const isPending =
                    pendingAction === `rotate:${appToken.credentialId}` ||
                    pendingAction === `revoke:${appToken.credentialId}`;

                  return (
                    <tr key={appToken.credentialId}>
                      <td>
                        <strong className="provider-name">{appToken.displayName}</strong>
                        <code className="project-code">{appToken.credentialId}</code>
                      </td>
                      <td>
                        <code className="project-code">{appToken.prefix}</code>
                        <small className="project-muted">last4: {appToken.last4}</small>
                      </td>
                      <td>
                        <Badge
                          className="project-status-badge"
                          data-status={appToken.status.toUpperCase()}
                          variant="outline"
                        >
                          {appToken.status}
                        </Badge>
                      </td>
                      <td>
                        <span className="project-muted">
                          {appToken.scopes.join(", ") || "none"}
                        </span>
                      </td>
                      <td>
                        <span className="project-muted">{formatDateTime(appToken.createdAt)}</span>
                        <small className="project-muted">
                          {text.expiresAt}: {formatDateTime(appToken.expiresAt)}
                        </small>
                        <small className="project-muted">
                          {text.lastUsed}: {formatDateTime(appToken.lastUsedAt)}
                        </small>
                      </td>
                      <td>
                        <div className="project-row-actions api-key-row-actions">
                          <Button
                            disabled={isPending || !canRotate || actionsDisabled}
                            onClick={() => void submitRotateAppToken(appToken)}
                            type="button"
                            variant="outline"
                          >
                            <RotateCcw aria-hidden="true" />
                            {text.rotate}
                          </Button>
                          <Button
                            disabled={
                              isPending || appToken.status === "revoked" || actionsDisabled
                            }
                            onClick={() => void submitRevokeAppToken(appToken)}
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

function toListItem(
  appToken: OneTimeAppTokenResponse,
  displayName: string
): AppTokenListItem {
  return {
    createdAt: appToken.createdAt,
    credentialId: appToken.credentialId,
    credentialType: "app_token",
    displayName,
    expiresAt: appToken.expiresAt,
    last4: appToken.last4,
    lastUsedAt: null,
    prefix: appToken.prefix,
    scopes: appToken.scopes,
    status: appToken.status
  };
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) {
    return false;
  }

  const expiresAtTime = new Date(expiresAt).getTime();

  return Number.isNaN(expiresAtTime) ? false : expiresAtTime <= Date.now();
}
