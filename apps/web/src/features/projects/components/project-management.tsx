"use client";

import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import type {
  ProjectRecord,
  ProjectsModel,
  ProjectStatus,
  ProjectUpdateValues
} from "@/lib/control-plane/projects-types";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type ProjectManagementProps = {
  locale: Locale;
  model: ProjectsModel;
};

type ProjectDetailManagementProps = {
  locale: Locale;
  project: ProjectRecord;
  runtimeSettings: ProjectRuntimeSettings | null;
  tenantId: string;
};

export type ProjectRuntimeSettings = {
  cacheEnabled: boolean;
  cacheType: string;
  publishState: string;
  safetyMode: string;
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type ProjectResponsePayload = {
  error?: string;
  project?: ProjectRecord;
};

const projectStatuses: ProjectStatus[] = ["ACTIVE", "DISABLED", "ARCHIVED"];

const projectText: Record<
  Locale,
  {
    cache: string;
    cacheType: string;
    createProject: string;
    created: string;
    description: string;
    edit: string;
    empty: string;
    fixtureFallback: string;
    detailSaved: string;
    management: string;
    name: string;
    project: string;
    projectId: string;
    publishState: string;
    runtimeSettings: string;
    save: string;
    delete: string;
    totalBudget: string;
    deleted: string;
    source: string;
    status: string;
    safetyMode: string;
    title: string;
    updated: string;
  }
> = {
  en: {
    cache: "Cache",
    cacheType: "Cache type",
    createProject: "Create Project",
    created: "Created",
    description: "Description",
    edit: "Edit",
    empty: "No projects found.",
    fixtureFallback: "Control Plane unavailable. Showing fixture project.",
    detailSaved: "Project saved.",
    management: "management",
    name: "Name",
    project: "Project",
    projectId: "Project ID",
    publishState: "Publish state",
    runtimeSettings: "Runtime settings",
    save: "Save",
    delete: "Delete",
    totalBudget: "Project budget",
    deleted: "Project deleted.",
    source: "Source",
    status: "Status",
    safetyMode: "Safety mode",
    title: "Projects",
    updated: "Updated"
  },
  ko: {
    cache: "Cache",
    cacheType: "Cache type",
    createProject: "Create Project",
    created: "생성",
    description: "설명",
    edit: "수정",
    empty: "프로젝트가 없습니다.",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 프로젝트를 표시 중입니다.",
    detailSaved: "Project가 저장되었습니다.",
    management: "관리",
    name: "이름",
    project: "Project",
    projectId: "Project ID",
    publishState: "Publish state",
    runtimeSettings: "Runtime 설정",
    save: "저장",
    delete: "삭제",
    totalBudget: "프로젝트 예산",
    deleted: "Project가 삭제되었습니다.",
    source: "출처",
    status: "상태",
    safetyMode: "Safety mode",
    title: "프로젝트",
    updated: "수정"
  }
};

export function ProjectManagement({ locale, model }: ProjectManagementProps) {
  const text = projectText[locale];
  const projects = model.projects.filter((project) => project.status !== "ARCHIVED");

  return (
    <main className="console-content management-line-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.management}</p>
          <h2>{text.title}</h2>
        </div>
        <div className="dashboard-hero-actions">
          <Link className="primary-button" href={`/tenants/${model.routeTenantId}/onboarding`}>
            <Plus aria-hidden="true" />
            {text.createProject}
          </Link>
        </div>
      </section>

      {model.source === "fixture" ? (
        <p className="policy-alert" data-status="warning">
          {text.fixtureFallback} {model.loadError}
        </p>
      ) : null}

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{text.title}</h3>
        </div>
        {projects.length === 0 ? (
          <p className="project-empty">{text.empty}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table project-table">
              <thead>
                <tr>
                  <th>{text.name}</th>
                  <th>{text.description}</th>
                  <th>{text.totalBudget}</th>
                  <th>{text.status}</th>
                  <th>{text.updated}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id}>
                    <td>
                      <strong className="provider-name">{project.name}</strong>
                    </td>
                    <td>{nullableText(project.description, "-")}</td>
                    <td>{formatBudgetUsd(project.totalBudgetUsd)}</td>
                    <td>
                      <Badge
                        className="project-status-badge"
                        data-status={project.status}
                        variant="outline"
                      >
                        {formatProjectStatus(project.status)}
                      </Badge>
                    </td>
                    <td>
                      <span className="project-muted">{formatDateTime(project.updatedAt)}</span>
                      <small className="project-muted">
                        {text.created}: {formatDateTime(project.createdAt)}
                      </small>
                    </td>
                    <td>
                      <Link
                        className="secondary-button"
                        href={`/tenants/${model.routeTenantId}/projects/${project.id}`}
                      >
                        <Pencil aria-hidden="true" />
                        {text.edit}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

export function ProjectDetailManagement({
  locale,
  project,
  runtimeSettings,
  tenantId
}: ProjectDetailManagementProps) {
  const router = useRouter();
  const text = projectText[locale];
  const [values, setValues] = useState<ProjectUpdateValues>(() => getProjectUpdateValues(project));
  const [pendingAction, setPendingAction] = useState<"delete" | "save" | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });

  async function saveProjectDetail() {
    if (!values.name.trim()) {
      setSubmitState({
        message: locale === "ko" ? "프로젝트 이름을 입력하세요." : "Project name is required.",
        status: "error"
      });
      return;
    }

    if (!Number.isFinite(values.totalBudgetUsd) || values.totalBudgetUsd < 0) {
      setSubmitState({
        message:
          locale === "ko" ? "프로젝트 예산을 0 이상으로 입력하세요." : "Project budget must be 0 or more.",
        status: "error"
      });
      return;
    }

    setPendingAction("save");
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/projects", {
      body: JSON.stringify({
        action: "update",
        values
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProjectResponsePayload;

    if (!response.ok || !payload.project) {
      setSubmitState({
        message: payload.error ?? "Project update failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    setValues(getProjectUpdateValues(payload.project));
    setSubmitState({
      message: text.detailSaved,
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function deleteProject() {
    setPendingAction("delete");
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/projects", {
      body: JSON.stringify({
        action: "update",
        values: {
          ...getProjectUpdateValues(project),
          status: "ARCHIVED"
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProjectResponsePayload;

    if (!response.ok || !payload.project) {
      setSubmitState({
        message: payload.error ?? "Project delete failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    setSubmitState({
      message: text.deleted,
      status: "success"
    });
    router.push(`/tenants/${tenantId}/projects`);
    router.refresh();
  }

  return (
    <main className="console-content management-line-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.project}</p>
          <h2>{project.name}</h2>
        </div>
      </section>

      {submitState.message ? (
        <p className="policy-alert" data-status={submitState.status}>
          {submitState.message}
        </p>
      ) : null}

      <section className="console-panel project-detail-panel">
        <div className="project-detail-section">
          <div className="panel-heading">
            <h3>{text.edit}</h3>
          </div>
          <div className="project-create-form">
            <label className="policy-field">
              <span>{text.name}</span>
              <input
                maxLength={120}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    name: event.target.value
                  }))
                }
                type="text"
                value={values.name}
              />
            </label>
            <label className="policy-field">
              <span>{text.description}</span>
              <input
                maxLength={500}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    description: event.target.value
                  }))
                }
                type="text"
                value={values.description}
              />
            </label>
            <label className="policy-field">
              <span>{text.totalBudget}</span>
              <input
                min={0}
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    totalBudgetUsd: Number(event.target.value)
                  }))
                }
                step="0.01"
                type="number"
                value={values.totalBudgetUsd}
              />
            </label>
            <label className="policy-field">
              <span>{text.status}</span>
              <select
                onChange={(event) =>
                  setValues((current) => ({
                    ...current,
                    status: event.target.value as ProjectStatus
                  }))
                }
                value={values.status}
              >
                {projectStatuses.map((status) => (
                  <option key={status} value={status}>
                    {formatProjectStatus(status)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {runtimeSettings ? (
          <div className="project-detail-section">
            <div className="panel-heading">
              <h3>{text.runtimeSettings}</h3>
            </div>
            <div className="project-create-form">
              <label className="policy-field">
                <span>{text.publishState}</span>
                <input disabled readOnly type="text" value={runtimeSettings.publishState} />
              </label>
              <label className="policy-field">
                <span>{text.cache}</span>
                <input
                  disabled
                  readOnly
                  type="text"
                  value={runtimeSettings.cacheEnabled ? "enabled" : "disabled"}
                />
              </label>
              <label className="policy-field">
                <span>{text.cacheType}</span>
                <input disabled readOnly type="text" value={runtimeSettings.cacheType} />
              </label>
              <label className="policy-field">
                <span>{text.safetyMode}</span>
                <input disabled readOnly type="text" value={runtimeSettings.safetyMode} />
              </label>
            </div>
          </div>
        ) : null}
      </section>
      <div className="project-detail-actions">
        <button
          className="secondary-button project-danger-button"
          disabled={pendingAction !== null || project.status === "ARCHIVED"}
          onClick={() => void deleteProject()}
          type="button"
        >
          <Trash2 aria-hidden="true" />
          {pendingAction === "delete" ? "..." : text.delete}
        </button>
        <button
          className="primary-button"
          disabled={pendingAction !== null}
          onClick={() => void saveProjectDetail()}
          type="button"
        >
          <Save aria-hidden="true" />
          {pendingAction === "save" ? "..." : text.save}
        </button>
      </div>
    </main>
  );
}

function getProjectUpdateValues(project: ProjectRecord): ProjectUpdateValues {
  return {
    description: nullableText(project.description, ""),
    name: project.name,
    projectId: project.id,
    status: project.status,
    totalBudgetUsd: project.totalBudgetUsd
  };
}

function formatProjectStatus(status: ProjectStatus) {
  return status.toLowerCase();
}

function formatBudgetUsd(value: number) {
  return `$${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  })}`;
}
