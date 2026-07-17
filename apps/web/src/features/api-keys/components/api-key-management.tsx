"use client";

import { Ban, Copy, Plus, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { ManagementPage } from "@/components/layout/management-page";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import type {
  ApiKeyListItem,
  ApiKeysModel,
  ApiKeyStatus,
  OneTimeApiKeyResponse
} from "@/lib/control-plane/api-keys-types";
import {
  compareApiKeyCreatedAtDescending,
  excludeRevokedApiKeys,
  getApiKeyPreviewPrefix
} from "@/lib/control-plane/api-keys-management-model";
import { formatDateTime } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type ApiKeyManagementProps = {
  canManage: boolean;
  locale: Locale;
  model: ApiKeysModel;
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type ConfirmAction = {
  apiKey: ApiKeyListItem;
  type: "revoke" | "rotate";
};

type OneTimeSecretState = {
  apiKey: OneTimeApiKeyResponse;
  displayName: string;
  projectName: string;
  mode: "issued" | "rotated";
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

const DEFAULT_SCOPES = "chat:completions, models:read";

const copy: Record<Locale, Record<string, string>> = {
  en: {
    actions: "Actions",
    active: "Active",
    allProjects: "All projects",
    allStatuses: "All statuses",
    cancel: "Cancel",
    copied: "Copied",
    copy: "Copy API Key",
    created: "Created",
    credential: "API Key",
    empty: "No API Keys match the selected filters.",
    expires: "Expires",
    issue: "Issue new Key",
    issueDescription: "Choose the project that will use this Gateway API Key.",
    issueFailed: "API Key issuance failed.",
    issueName: "Key name",
    issueProject: "Project",
    lastUsed: "Last used",
    loadFailed: "API Key data could not be loaded from the Control Plane.",
    name: "Name",
    never: "Never",
    noPermission: "Only Tenant Admins can manage API Keys.",
    oneTimeDescription: "This plaintext is shown only once. Copy and store it safely now.",
    oneTimeTitle: "Store the new API Key",
    project: "Applied project",
    revoke: "Revoke",
    revokeConfirm: "This Key will stop working immediately and cannot be restored.",
    revokeFailed: "API Key revoke failed.",
    revokeTitle: "Revoke API Key?",
    rotate: "Reissue",
    rotateConfirm: "The current Key will be revoked immediately. The replacement plaintext is shown once.",
    rotateFailed: "API Key reissue failed.",
    rotateTitle: "Reissue API Key?",
    scopes: "Scopes",
    status: "Status",
    title: "API Key Management"
  },
  ko: {
    actions: "작업",
    active: "활성",
    allProjects: "전체 Project",
    allStatuses: "전체 상태",
    cancel: "취소",
    copied: "복사 완료",
    copy: "API Key 복사",
    created: "생성일",
    credential: "API Key",
    empty: "조건에 맞는 API Key가 없습니다.",
    expires: "만료일",
    issue: "새 Key 발급",
    issueDescription: "Gateway API Key를 적용할 Project를 선택하세요.",
    issueFailed: "API Key 발급에 실패했습니다.",
    issueName: "Key 이름",
    issueProject: "Project",
    lastUsed: "마지막 사용",
    loadFailed: "Control Plane에서 API Key 정보를 불러오지 못했습니다.",
    name: "이름",
    never: "사용 기록 없음",
    noPermission: "Tenant Admin만 API Key를 관리할 수 있습니다.",
    oneTimeDescription: "이 원문은 한 번만 표시됩니다. 지금 복사해 안전하게 보관하세요.",
    oneTimeTitle: "새 API Key 보관",
    project: "적용 Project",
    revoke: "폐기",
    revokeConfirm: "이 Key는 즉시 사용할 수 없게 되며 되돌릴 수 없습니다.",
    revokeFailed: "API Key 폐기에 실패했습니다.",
    revokeTitle: "API Key를 폐기할까요?",
    rotate: "재발급",
    rotateConfirm: "현재 Key가 즉시 폐기되고, 교체된 Key 원문은 한 번만 표시됩니다.",
    rotateFailed: "API Key 재발급에 실패했습니다.",
    rotateTitle: "API Key를 재발급할까요?",
    scopes: "권한 범위",
    status: "상태",
    title: "API Key 관리"
  }
};

export function ApiKeyManagement({ canManage, locale, model }: ApiKeyManagementProps) {
  const text = copy[locale];
  const [apiKeys, setApiKeys] = useState(() => excludeRevokedApiKeys(model.apiKeys));
  const [projectFilter, setProjectFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueProjectId, setIssueProjectId] = useState(model.projects[0]?.id ?? "");
  const [issueName, setIssueName] = useState("");
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [oneTimeSecret, setOneTimeSecret] = useState<OneTimeSecretState | null>(null);
  const [copied, setCopied] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const actionsDisabled = model.source !== "control-plane" || !canManage;

  const filteredApiKeys = useMemo(() => apiKeys
    .filter((apiKey) => projectFilter === "all" || apiKey.projectId === projectFilter)
    .filter((apiKey) => statusFilter === "all" || getEffectiveStatus(apiKey) === statusFilter)
    .sort(compareApiKeyCreatedAtDescending),
  [apiKeys, projectFilter, statusFilter]);

  async function issueApiKey() {
    const displayName = issueName.trim();
    const project = model.projects.find((item) => item.id === issueProjectId);
    if (!displayName || !project) return;

    setPendingAction("issue");
    setSubmitState({ message: "", status: "idle" });
    const response = await fetch("/api/control-plane/api-keys", {
      body: JSON.stringify({
        action: "issue",
        routeTenantId: model.routeTenantId,
        values: {
          displayName,
          expiresAt: "",
          projectId: project.id,
          scopes: DEFAULT_SCOPES
        }
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ApiKeyResponsePayload;

    if (!response.ok || !payload.apiKey) {
      setSubmitState({ message: payload.error ?? text.issueFailed, status: "error" });
      setPendingAction(null);
      return;
    }

    setApiKeys((current) => [
      toListItem(payload.apiKey as OneTimeApiKeyResponse, displayName, project.id, project.name),
      ...current
    ]);
    setOneTimeSecret({
      apiKey: payload.apiKey,
      displayName,
      mode: "issued",
      projectName: project.name
    });
    setCopied(false);
    setIssueName("");
    setIssueOpen(false);
    setPendingAction(null);
    setSubmitState({
      message: locale === "ko" ? "새 API Key가 발급되었습니다." : "A new API Key was issued.",
      status: "success"
    });
  }

  async function rotateApiKey(apiKey: ApiKeyListItem) {
    setPendingAction(`rotate:${apiKey.credentialId}`);
    setSubmitState({ message: "", status: "idle" });
    const response = await fetch("/api/control-plane/api-keys", {
      body: JSON.stringify({
        action: "rotate",
        apiKeyId: apiKey.credentialId,
        projectId: apiKey.projectId,
        routeTenantId: model.routeTenantId
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ApiKeyResponsePayload;

    if (!response.ok || !payload.apiKey) {
      setSubmitState({ message: payload.error ?? text.rotateFailed, status: "error" });
      setConfirmAction(null);
      setPendingAction(null);
      return;
    }

    setApiKeys((current) => [
      toListItem(payload.apiKey as OneTimeApiKeyResponse, apiKey.displayName, apiKey.projectId, apiKey.projectName),
      ...current.filter((item) => item.credentialId !== apiKey.credentialId)
    ]);
    setOneTimeSecret({
      apiKey: payload.apiKey,
      displayName: apiKey.displayName,
      mode: "rotated",
      projectName: apiKey.projectName
    });
    setCopied(false);
    setConfirmAction(null);
    setPendingAction(null);
    setSubmitState({
      message: locale === "ko" ? "API Key가 재발급되었습니다." : "The API Key was reissued.",
      status: "success"
    });
  }

  async function revokeApiKey(apiKey: ApiKeyListItem) {
    setPendingAction(`revoke:${apiKey.credentialId}`);
    setSubmitState({ message: "", status: "idle" });
    const response = await fetch("/api/control-plane/api-keys", {
      body: JSON.stringify({
        action: "revoke",
        apiKeyId: apiKey.credentialId,
        projectId: apiKey.projectId,
        routeTenantId: model.routeTenantId
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ApiKeyRevokePayload;

    if (!response.ok || !payload.revoked) {
      setSubmitState({ message: payload.error ?? text.revokeFailed, status: "error" });
      setConfirmAction(null);
      setPendingAction(null);
      return;
    }

    setApiKeys((current) => current.filter(
      (item) => item.credentialId !== apiKey.credentialId
    ));
    setConfirmAction(null);
    setPendingAction(null);
    setSubmitState({
      message: locale === "ko" ? "API Key가 폐기되었습니다." : "The API Key was revoked.",
      status: "success"
    });
  }

  async function copySecret() {
    if (!oneTimeSecret) return;
    try {
      await navigator.clipboard.writeText(oneTimeSecret.apiKey.plaintext);
      setCopied(true);
    } catch {
      setSubmitState({
        message: locale === "ko" ? "클립보드 복사에 실패했습니다." : "Clipboard copy failed.",
        status: "error"
      });
    }
  }

  const confirmationPending = confirmAction
    ? pendingAction === `${confirmAction.type}:${confirmAction.apiKey.credentialId}`
    : false;

  return (
    <ManagementPage className="api-key-management" title={text.title}>

      {model.source === "error" ? (
        <Alert variant="destructive">
          <AlertDescription>{model.loadError ?? text.loadFailed}</AlertDescription>
        </Alert>
      ) : null}
      {!canManage && model.source === "control-plane" ? (
        <Alert variant="warning"><AlertDescription>{text.noPermission}</AlertDescription></Alert>
      ) : null}
      {submitState.message ? (
        <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="api-key-list-section">
        <div className="api-key-list-toolbar">
          <div className="api-key-filters">
            <select
              aria-label={text.project}
              onChange={(event) => setProjectFilter(event.target.value)}
              value={projectFilter}
            >
              <option value="all">{text.allProjects}</option>
              {model.projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            <select
              aria-label={text.status}
              onChange={(event) => setStatusFilter(event.target.value)}
              value={statusFilter}
            >
              <option value="all">{text.allStatuses}</option>
              <option value="active">Active</option>
              <option value="disabled">Disabled</option>
              <option value="expired">Expired</option>
            </select>
          </div>
          <Button
            className="api-key-issue-trigger"
            disabled={actionsDisabled || model.projects.length === 0}
            onClick={() => {
              setSubmitState({ message: "", status: "idle" });
              setIssueOpen(true);
            }}
            size="sm"
            type="button"
          >
            <Plus aria-hidden="true" />
            {text.issue}
          </Button>
        </div>

        {filteredApiKeys.length === 0 ? (
          <p className="project-empty">{text.empty}</p>
        ) : (
          <div className="api-key-list-scroll">
            <div className="api-key-list-grid">
              <div className="api-key-list-header">
                <span>{text.name}</span>
                <span>{text.project}</span>
                <span>{text.credential}</span>
                <span>{text.status}</span>
                <span>{text.created}</span>
                <span>{text.lastUsed}</span>
                <span aria-hidden="true" />
              </div>
              <div className="api-key-list">
                {filteredApiKeys.map((apiKey) => {
                  const effectiveStatus = getEffectiveStatus(apiKey);
                  const active = effectiveStatus === "active";
                  const rowPending = pendingAction?.endsWith(apiKey.credentialId) ?? false;
                  return (
                    <article className="api-key-list-row" key={apiKey.credentialId}>
                      <div className="api-key-list-cell" data-label={text.name}>
                        <strong className="provider-name">{apiKey.displayName}</strong>
                        <small className="project-muted">{apiKey.scopes.join(", ")}</small>
                      </div>
                      <div className="api-key-list-cell" data-label={text.project}>
                        <strong className="provider-name">{apiKey.projectName}</strong>
                      </div>
                      <div className="api-key-list-cell" data-label={text.credential}>
                        <code className="api-key-preview">
                          {getApiKeyPreviewPrefix(apiKey.prefix)}......{apiKey.last4}
                        </code>
                      </div>
                      <div className="api-key-list-cell" data-label={text.status}>
                        <Badge
                          className="project-status-badge"
                          data-status={effectiveStatus.toUpperCase()}
                          variant="outline"
                        >
                          {statusLabel(effectiveStatus, locale)}
                        </Badge>
                      </div>
                      <div className="api-key-list-cell" data-label={text.created}>
                        <span className="project-muted">{formatDateTime(apiKey.createdAt)}</span>
                        {apiKey.expiresAt ? <small className="project-muted">{text.expires}: {formatDateTime(apiKey.expiresAt)}</small> : null}
                      </div>
                      <div className="api-key-list-cell" data-label={text.lastUsed}>
                        <span className="project-muted">{apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt) : text.never}</span>
                      </div>
                      <div className="api-key-list-cell api-key-action-cell" data-label={text.actions}>
                        <TooltipProvider>
                          <div className="api-key-row-actions">
                            <Tooltip>
                              <TooltipTrigger render={
                                <Button
                                  aria-label={text.rotate}
                                  disabled={!active || rowPending || actionsDisabled}
                                  onClick={() => {
                                    setSubmitState({ message: "", status: "idle" });
                                    setConfirmAction({ apiKey, type: "rotate" });
                                  }}
                                  size="icon"
                                  type="button"
                                  variant="outline"
                                />
                              }>
                                <RotateCcw aria-hidden="true" />
                              </TooltipTrigger>
                              <TooltipContent>{text.rotate}</TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger render={
                                <Button
                                  aria-label={text.revoke}
                                  disabled={!active || rowPending || actionsDisabled}
                                  onClick={() => {
                                    setSubmitState({ message: "", status: "idle" });
                                    setConfirmAction({ apiKey, type: "revoke" });
                                  }}
                                  size="icon"
                                  type="button"
                                  variant="destructive"
                                />
                              }>
                                <Ban aria-hidden="true" />
                              </TooltipTrigger>
                              <TooltipContent>{text.revoke}</TooltipContent>
                            </Tooltip>
                          </div>
                        </TooltipProvider>
                      </div>
                    </article>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </section>

      <Dialog onOpenChange={(open) => pendingAction !== "issue" && setIssueOpen(open)} open={issueOpen}>
        <DialogContent className="api-key-dialog">
          <DialogHeader>
            <DialogTitle>{text.issue}</DialogTitle>
            <DialogDescription>{text.issueDescription}</DialogDescription>
          </DialogHeader>
          <div className="api-key-dialog-fields">
            <label>
              <span>{text.issueProject}</span>
              <select onChange={(event) => setIssueProjectId(event.target.value)} value={issueProjectId}>
                {model.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </select>
            </label>
            <label>
              <span>{text.issueName}</span>
              <Input
                maxLength={120}
                onChange={(event) => setIssueName(event.target.value)}
                placeholder={locale === "ko" ? "예: Production Gateway" : "e.g. Production Gateway"}
                value={issueName}
              />
            </label>
          </div>
          {submitState.status === "error" && submitState.message ? (
            <Alert variant="destructive"><AlertDescription>{submitState.message}</AlertDescription></Alert>
          ) : null}
          <DialogFooter>
            <Button disabled={pendingAction !== null} onClick={() => setIssueOpen(false)} type="button" variant="outline">{text.cancel}</Button>
            <Button disabled={!issueName.trim() || !issueProjectId || pendingAction !== null} onClick={() => void issueApiKey()} type="button">
              <Plus aria-hidden="true" />{pendingAction === "issue" ? "..." : text.issue}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => !open && !confirmationPending && setConfirmAction(null)}
        open={confirmAction !== null}
      >
        <DialogContent className="api-key-dialog">
          <DialogHeader>
            <DialogTitle>{confirmAction?.type === "rotate" ? text.rotateTitle : text.revokeTitle}</DialogTitle>
            <DialogDescription>{confirmAction?.type === "rotate" ? text.rotateConfirm : text.revokeConfirm}</DialogDescription>
          </DialogHeader>
          <div className="api-key-confirm-target">
            <strong>{confirmAction?.apiKey.displayName}</strong>
            <span>{confirmAction?.apiKey.projectName}</span>
            <code>{confirmAction ? `${confirmAction.apiKey.prefix}••••${confirmAction.apiKey.last4}` : ""}</code>
          </div>
          {submitState.status === "error" && submitState.message ? (
            <Alert variant="destructive"><AlertDescription>{submitState.message}</AlertDescription></Alert>
          ) : null}
          <DialogFooter>
            <Button disabled={confirmationPending} onClick={() => setConfirmAction(null)} type="button" variant="outline">{text.cancel}</Button>
            <Button
              disabled={!confirmAction || confirmationPending}
              onClick={() => {
                if (!confirmAction) return;
                void (confirmAction.type === "rotate"
                  ? rotateApiKey(confirmAction.apiKey)
                  : revokeApiKey(confirmAction.apiKey));
              }}
              type="button"
              variant={confirmAction?.type === "revoke" ? "destructive" : "default"}
            >
              {confirmAction?.type === "rotate" ? <RotateCcw aria-hidden="true" /> : <Ban aria-hidden="true" />}
              {confirmationPending ? "..." : confirmAction?.type === "rotate" ? text.rotate : text.revoke}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setOneTimeSecret(null);
            setCopied(false);
          }
        }}
        open={oneTimeSecret !== null}
      >
        <DialogContent className="api-key-secret-dialog" showClose={false}>
          <DialogHeader>
            <DialogTitle>{text.oneTimeTitle}</DialogTitle>
            <DialogDescription>{text.oneTimeDescription}</DialogDescription>
          </DialogHeader>
          <div className="api-key-secret-context">
            <strong>{oneTimeSecret?.displayName}</strong>
            <span>{oneTimeSecret?.projectName}</span>
          </div>
          <code className="api-key-one-time-value">{oneTimeSecret?.apiKey.plaintext}</code>
          <DialogFooter>
            <Button onClick={() => void copySecret()} type="button" variant="outline">
              <Copy aria-hidden="true" />{copied ? text.copied : text.copy}
            </Button>
            <Button onClick={() => setOneTimeSecret(null)} type="button">{locale === "ko" ? "보관 완료" : "Stored safely"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ManagementPage>
  );
}

function toListItem(
  apiKey: OneTimeApiKeyResponse,
  displayName: string,
  projectId: string,
  projectName: string
): ApiKeyListItem {
  return {
    createdAt: apiKey.createdAt,
    credentialId: apiKey.credentialId,
    credentialType: "api_key",
    displayName,
    expiresAt: apiKey.expiresAt,
    last4: apiKey.last4,
    lastUsedAt: null,
    prefix: apiKey.prefix,
    projectId,
    projectName,
    scopes: apiKey.scopes,
    status: apiKey.status
  };
}

function isExpired(expiresAt: string | null) {
  if (!expiresAt) return false;
  const time = Date.parse(expiresAt);
  return Number.isNaN(time) ? false : time <= Date.now();
}

function getEffectiveStatus(apiKey: ApiKeyListItem): ApiKeyStatus {
  return apiKey.status === "active" && isExpired(apiKey.expiresAt)
    ? "expired"
    : apiKey.status;
}

function statusLabel(status: ApiKeyStatus, locale: Locale) {
  if (locale === "en") {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  return {
    active: "활성",
    disabled: "비활성",
    expired: "만료",
    revoked: "폐기"
  }[status];
}
