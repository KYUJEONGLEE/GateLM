"use client";

import { Plus, Save, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ApplicationFormValues,
  ApplicationRecord,
  ApplicationsModel,
  ApplicationStatus,
  ApplicationUpdateValues
} from "@/lib/control-plane/applications-types";
import type { OneTimeAppTokenResponse } from "@/lib/control-plane/app-tokens-types";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type ApplicationManagementProps = {
  locale: Locale;
  model: ApplicationsModel;
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type ApplicationResponsePayload = {
  application?: ApplicationRecord;
  error?: string;
};

type AppTokenResponsePayload = {
  appToken?: OneTimeAppTokenResponse;
  error?: string;
};

type OneTimeAppTokenState = {
  applicationName: string;
  appToken: OneTimeAppTokenResponse;
};

const applicationStatuses: ApplicationStatus[] = ["ACTIVE", "DISABLED", "ARCHIVED"];

const emptyApplicationForm: ApplicationFormValues = {
  description: "",
  name: ""
};

const applicationText: Record<
  Locale,
  {
    applicationId: string;
    appToken: string;
    cancel: string;
    close: string;
    create: string;
    creating: string;
    created: string;
    delete: string;
    description: string;
    empty: string;
    fixtureFallback: string;
    management: string;
    name: string;
    save: string;
    source: string;
    status: string;
    title: string;
    updated: string;
    warning: string;
  }
> = {
  en: {
    applicationId: "Application ID",
    appToken: "App Token",
    cancel: "Cancel",
    close: "OK",
    create: "Create application",
    creating: "Creating...",
    created: "Created",
    delete: "Delete",
    description: "Description",
    empty: "No applications found.",
    fixtureFallback: "Control Plane unavailable. Showing fixture application.",
    management: "management",
    name: "Name",
    save: "Save",
    source: "Source",
    status: "Status",
    title: "Applications",
    updated: "Updated",
    warning: "Store this value now. GateLM will not show it again."
  },
  ko: {
    applicationId: "Application ID",
    appToken: "App Token",
    cancel: "취소",
    close: "확인",
    create: "애플리케이션 생성",
    creating: "생성 중...",
    created: "생성",
    delete: "삭제",
    description: "설명",
    empty: "애플리케이션이 없습니다.",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 애플리케이션을 표시 중입니다.",
    management: "관리",
    name: "이름",
    save: "저장",
    source: "출처",
    status: "상태",
    title: "애플리케이션",
    updated: "수정",
    warning: "지금 저장하세요. GateLM은 이 값을 다시 보여주지 않습니다."
  }
};

export function ApplicationManagement({ locale, model }: ApplicationManagementProps) {
  const router = useRouter();
  const text = applicationText[locale];
  const [applications, setApplications] = useState<ApplicationRecord[]>(model.applications);
  const [createValues, setCreateValues] =
    useState<ApplicationFormValues>(emptyApplicationForm);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [oneTimeAppToken, setOneTimeAppToken] = useState<OneTimeAppTokenState | null>(null);
  const [editingRows, setEditingRows] = useState<Record<string, ApplicationUpdateValues>>(() =>
    Object.fromEntries(
      model.applications.map((application) => [
        application.id,
        getApplicationUpdateValues(application)
      ])
    )
  );
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });

  function openCreateModal() {
    setCreateValues(emptyApplicationForm);
    setOneTimeAppToken(null);
    setSubmitState({ message: "", status: "idle" });
    setIsCreateModalOpen(true);
  }

  function closeCreateModal() {
    setCreateValues(emptyApplicationForm);
    setOneTimeAppToken(null);
    setSubmitState({ message: "", status: "idle" });
    setIsCreateModalOpen(false);
  }

  async function submitCreateApplication() {
    if (!createValues.name.trim()) {
      setSubmitState({
        message:
          locale === "ko" ? "애플리케이션 이름을 입력하세요." : "Application name is required.",
        status: "error"
      });
      return;
    }

    setPendingAction("create");
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/applications", {
      body: JSON.stringify({
        action: "create",
        values: {
          ...createValues,
          projectId: model.controlPlaneProjectId
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ApplicationResponsePayload;

    if (!response.ok || !payload.application) {
      setSubmitState({
        message: payload.error ?? "Application creation failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    const createdApplication = payload.application;
    const appToken = await issueInitialAppToken(createdApplication);

    setApplications((current) => [...current, createdApplication]);
    setEditingRows((current) => ({
      ...current,
      [createdApplication.id]: getApplicationUpdateValues(createdApplication)
    }));
    setCreateValues(emptyApplicationForm);
    setSubmitState({
      message: appToken
        ? locale === "ko"
          ? "애플리케이션이 생성되고 App Token이 발급되었습니다."
          : "Application created and App Token issued."
        : locale === "ko"
          ? "애플리케이션은 생성되었지만 App Token 발급에 실패했습니다."
          : "Application created, but App Token issue failed.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function issueInitialAppToken(application: ApplicationRecord) {
    try {
      const response = await fetch("/api/control-plane/app-tokens", {
        body: JSON.stringify({
          action: "issue",
          values: {
            applicationId: application.id,
            displayName: `${application.name} App Token`,
            expiresAt: "",
            scopes: "gateway:invoke"
          }
        }),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      const payload = (await response.json().catch(() => ({}))) as AppTokenResponsePayload;

      if (!response.ok || !payload.appToken) {
        return null;
      }

      setOneTimeAppToken({
        applicationName: application.name,
        appToken: payload.appToken
      });

      return payload.appToken;
    } catch {
      return null;
    }
  }

  async function submitUpdateApplication(
    applicationId: string,
    overrideValues?: ApplicationUpdateValues
  ) {
    const values = overrideValues ?? editingRows[applicationId];

    if (!values?.name.trim()) {
      setSubmitState({
        message:
          locale === "ko" ? "애플리케이션 이름을 입력하세요." : "Application name is required.",
        status: "error"
      });
      return;
    }

    setPendingAction(`update:${applicationId}`);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/applications", {
      body: JSON.stringify({
        action: "update",
        values
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ApplicationResponsePayload;

    if (!response.ok || !payload.application) {
      setSubmitState({
        message: payload.error ?? "Application update failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    const updatedApplication = payload.application;

    setApplications((current) =>
      current.map((application) =>
        application.id === applicationId ? updatedApplication : application
      )
    );
    setEditingRows((current) => ({
      ...current,
      [applicationId]: getApplicationUpdateValues(updatedApplication)
    }));
    setSubmitState({
      message: locale === "ko" ? "애플리케이션이 수정되었습니다." : "Application updated.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  function updateRow(applicationId: string, values: Partial<ApplicationUpdateValues>) {
    setEditingRows((current) => ({
      ...current,
      [applicationId]: {
        ...current[applicationId],
        ...values
      }
    }));
  }

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.management}</p>
          <h2>{text.title}</h2>
        </div>
      </section>

      {model.source === "fixture" ? (
        <p className="policy-alert" data-status="warning">
          {text.fixtureFallback} {model.loadError}
        </p>
      ) : null}
      {!isCreateModalOpen && submitState.message ? (
        <p className="policy-alert" data-status={submitState.status}>
          {submitState.message}
        </p>
      ) : null}

      <section className="console-panel">
        <div className="applications-panel-heading">
          <div className="panel-heading">
            <h3>{text.title}</h3>
          </div>
          <button className="primary-button" onClick={openCreateModal} type="button">
            <Plus aria-hidden="true" />
            {text.create}
          </button>
        </div>
        {applications.length === 0 ? (
          <p className="project-empty">{text.empty}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table project-table">
              <thead>
                <tr>
                  <th>{text.name}</th>
                  <th>{text.description}</th>
                  <th>{text.status}</th>
                  <th>{text.updated}</th>
                  <th>{text.applicationId}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {applications.map((application) => {
                  const rowValues =
                    editingRows[application.id] ?? getApplicationUpdateValues(application);

                  return (
                    <tr key={application.id}>
                      <td>
                        <label className="policy-field project-table-field">
                          <span>{text.name}</span>
                          <input
                            maxLength={120}
                            onChange={(event) =>
                              updateRow(application.id, { name: event.target.value })
                            }
                            type="text"
                            value={rowValues.name}
                          />
                        </label>
                      </td>
                      <td>
                        <label className="policy-field project-table-field">
                          <span>{text.description}</span>
                          <textarea
                            maxLength={500}
                            onChange={(event) =>
                              updateRow(application.id, { description: event.target.value })
                            }
                            value={rowValues.description}
                          />
                        </label>
                      </td>
                      <td>
                        <div className="project-status-cell">
                          <Badge
                            className="project-status-badge"
                            data-status={application.status}
                            variant="outline"
                          >
                            {formatApplicationStatus(application.status)}
                          </Badge>
                          <label className="policy-field project-table-field">
                            <span>{text.status}</span>
                            <select
                              onChange={(event) =>
                                updateRow(application.id, {
                                  status: event.target.value as ApplicationStatus
                                })
                              }
                              value={rowValues.status}
                            >
                              {applicationStatuses.map((status) => (
                                <option key={status} value={status}>
                                  {formatApplicationStatus(status)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </td>
                      <td>
                        <span className="project-muted">{formatDateTime(application.updatedAt)}</span>
                        <small className="project-muted">
                          {text.created}: {formatDateTime(application.createdAt)}
                        </small>
                      </td>
                      <td>
                        <code className="project-code">{application.id}</code>
                      </td>
                      <td>
                        <div className="project-row-actions">
                          <Button
                            disabled={pendingAction !== null}
                            onClick={() => void submitUpdateApplication(application.id)}
                            type="button"
                            variant="outline"
                          >
                            <Save aria-hidden="true" />
                            {pendingAction === `update:${application.id}` ? "..." : text.save}
                          </Button>
                          <Button
                            disabled={pendingAction !== null || application.status === "ARCHIVED"}
                            onClick={() =>
                              void submitUpdateApplication(application.id, {
                                ...rowValues,
                                status: "ARCHIVED"
                              })
                            }
                            type="button"
                            variant="outline"
                          >
                            <Trash2 aria-hidden="true" />
                            {text.delete}
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

      {isCreateModalOpen ? (
        <div className="modal-backdrop" role="presentation">
          <section
            aria-labelledby="create-application-title"
            aria-modal="true"
            className="modal-panel"
            role="dialog"
          >
            <div className="panel-heading">
              <h3 id="create-application-title">{text.create}</h3>
            </div>

            {submitState.message ? (
              <p className="policy-alert" data-status={submitState.status}>
                {submitState.message}
              </p>
            ) : null}

            {oneTimeAppToken ? (
              <div className="one-time-secret">
                <div>
                  <p className="console-kicker">{text.create}</p>
                  <h4>
                    {oneTimeAppToken.applicationName} {text.appToken}
                  </h4>
                  <p>{oneTimeAppToken.appToken.warning || text.warning}</p>
                </div>
                <code>{oneTimeAppToken.appToken.plaintext}</code>
              </div>
            ) : (
              <div className="modal-form-grid">
                <label className="policy-field">
                  <span>{text.name}</span>
                  <input
                    maxLength={120}
                    onChange={(event) =>
                      setCreateValues((current) => ({
                        ...current,
                        name: event.target.value
                      }))
                    }
                    type="text"
                    value={createValues.name}
                  />
                </label>
                <label className="policy-field">
                  <span>{text.description}</span>
                  <input
                    maxLength={500}
                    onChange={(event) =>
                      setCreateValues((current) => ({
                        ...current,
                        description: event.target.value
                      }))
                    }
                    type="text"
                    value={createValues.description}
                  />
                </label>
              </div>
            )}

            <div className="modal-actions">
              {oneTimeAppToken ? (
                <button className="primary-button" onClick={closeCreateModal} type="button">
                  {text.close}
                </button>
              ) : (
                <>
                  <button
                    className="secondary-button"
                    disabled={pendingAction !== null}
                    onClick={closeCreateModal}
                    type="button"
                  >
                    {text.cancel}
                  </button>
                  <button
                    className="primary-button"
                    disabled={pendingAction !== null || createValues.name.trim().length === 0}
                    onClick={() => void submitCreateApplication()}
                    type="button"
                  >
                    {pendingAction === "create" ? text.creating : text.save}
                  </button>
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function getApplicationUpdateValues(application: ApplicationRecord): ApplicationUpdateValues {
  return {
    applicationId: application.id,
    description: nullableText(application.description, ""),
    name: application.name,
    status: application.status
  };
}

function formatApplicationStatus(status: ApplicationStatus) {
  return status.toLowerCase();
}
