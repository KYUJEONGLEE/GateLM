"use client";

import { ArrowRight, Clock3, Plus, Save, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumb, type BreadcrumbItem } from "@/components/ui/breadcrumb";
import type {
  ProjectBudgetThresholdRecord,
  ProjectRecord,
  ProjectsModel,
  ProjectStatus,
  ProjectUpdateValues
} from "@/lib/control-plane/projects-types";
import type { ProjectMonthlyCostReport } from "@/lib/gateway/live-cost-report";
import { nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";
import {
  getProjectCreateActionLocation,
  getRelativeTokenUsagePercent
} from "./project-management-state";

type ProjectManagementProps = {
  budgetThresholds: ProjectBudgetThresholdRecord[];
  canCreateProject: boolean;
  locale: Locale;
  model: ProjectsModel;
  monthlyCostReport: ProjectMonthlyCostReport;
};

type ProjectDetailManagementProps = {
  breadcrumbItems?: BreadcrumbItem[];
  locale: Locale;
  project: ProjectRecord;
  tenantId: string;
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type ProjectResponsePayload = {
  error?: string;
  project?: ProjectRecord;
};

type ProjectSortMode = "budgetRisk" | "tokens";
type ProjectBudgetState = "alert" | "operational" | "warning";

const projectStatuses: ProjectStatus[] = ["ACTIVE", "DRAFT", "DISABLED", "ARCHIVED"];
const projectSortModes: ProjectSortMode[] = ["budgetRisk", "tokens"];
const defaultWarningThresholdPercent = 80;
const compactTokenFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  notation: "compact"
});

const projectText: Record<
  Locale,
  {
    budgetUsage: string;
    createProject: string;
    description: string;
    empty: string;
    budgetAlert: string;
    budgetWarning: string;
    costReportFallback: string;
    fixtureFallback: string;
    detailSaved: string;
    draftBadge: string;
    draftDescription: string;
    draftTitle: string;
    general: string;
    manageProject: string;
    name: string;
    openProject: string;
    operating: string;
    operatingProjects: string;
    previewUsage: string;
    save: string;
    delete: string;
    deleteConfirm: string;
    sortBudgetRisk: string;
    sortLabel: string;
    sortTokens: string;
    totalBudget: string;
    status: string;
    title: string;
    tokenComparison: string;
    tokenComparisonEmpty: string;
    tokenUsage: string;
    usageUnavailable: string;
  }
> = {
  en: {
    budgetUsage: "Budget used",
    createProject: "Create Project",
    description: "Description",
    empty: "No projects found.",
    budgetAlert: "Budget exceeded",
    budgetWarning: "Budget warning",
    costReportFallback: "Monthly usage is unavailable.",
    fixtureFallback: "Control Plane unavailable. Showing fixture project.",
    detailSaved: "Project saved.",
    draftBadge: "Saved draft",
    draftDescription: "These projects were saved before setup was completed.",
    draftTitle: "Projects in progress",
    general: "General",
    manageProject: "Manage project",
    name: "Name",
    openProject: "Open project",
    operating: "Operating",
    operatingProjects: "Operating projects",
    previewUsage: "Showing synthetic monthly usage for layout preview only.",
    save: "Save",
    delete: "Delete",
    deleteConfirm: "Delete this project? This action cannot be undone.",
    sortBudgetRisk: "Budget used",
    sortLabel: "Sort by",
    sortTokens: "Token usage",
    totalBudget: "Project budget",
    status: "Status",
    title: "Projects",
    tokenComparison: "of the highest project usage",
    tokenComparisonEmpty: "No token usage to compare yet.",
    tokenUsage: "Token usage",
    usageUnavailable: "Usage unavailable"
  },
  ko: {
    budgetUsage: "예산 소진율",
    createProject: "프로젝트 생성",
    description: "설명",
    empty: "프로젝트가 없습니다.",
    budgetAlert: "예산 초과",
    budgetWarning: "예산 경고",
    costReportFallback: "월간 사용량을 불러올 수 없습니다.",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 프로젝트를 표시 중입니다.",
    detailSaved: "프로젝트가 저장되었습니다.",
    draftBadge: "임시 저장",
    draftDescription: "프로젝트 생성을 완료하기 전에 임시 저장된 항목입니다.",
    draftTitle: "작성 중인 프로젝트",
    general: "일반",
    manageProject: "프로젝트 관리",
    name: "이름",
    openProject: "프로젝트 열기",
    operating: "운영 중",
    operatingProjects: "운영 프로젝트",
    previewUsage: "화면 검토를 위한 합성 월간 사용량을 표시 중입니다.",
    save: "저장",
    delete: "삭제",
    deleteConfirm: "이 프로젝트를 삭제할까요? 이 작업은 되돌릴 수 없습니다.",
    sortBudgetRisk: "예산 소진율",
    sortLabel: "정렬 기준",
    sortTokens: "토큰 사용량",
    totalBudget: "프로젝트 예산",
    status: "상태",
    title: "프로젝트",
    tokenComparison: "최대 사용 프로젝트 대비",
    tokenComparisonEmpty: "아직 비교할 토큰 사용량이 없습니다.",
    tokenUsage: "토큰 사용량",
    usageUnavailable: "사용량 미확인"
  }
};

export function ProjectManagement({
  budgetThresholds,
  canCreateProject,
  locale,
  model,
  monthlyCostReport
}: ProjectManagementProps) {
  const text = projectText[locale];
  const [sortMode, setSortMode] = useState<ProjectSortMode>("budgetRisk");
  const projects = useMemo(
    () =>
      model.projects.filter(
        (project) => project.status !== "ARCHIVED" && project.status !== "DRAFT"
      ),
    [model.projects]
  );
  const draftProjects = useMemo(
    () => model.projects.filter((project) => project.status === "DRAFT"),
    [model.projects]
  );
  const projectCostsById = useMemo(
    () => new Map(monthlyCostReport.projectCosts.map((cost) => [cost.projectId, cost])),
    [monthlyCostReport.projectCosts]
  );
  const warningThresholdsByProjectId = useMemo(
    () =>
      new Map(
        budgetThresholds.map((threshold) => [
          threshold.projectId,
          threshold.warningThresholdPercent
        ])
      ),
    [budgetThresholds]
  );
  const usageKnown = monthlyCostReport.source !== "unavailable";
  const highestProjectTokens = useMemo(
    () =>
      usageKnown
        ? Math.max(
            0,
            ...projects.map((project) => projectCostsById.get(project.id)?.totalTokens ?? 0)
          )
        : null,
    [projectCostsById, projects, usageKnown]
  );
  const projectItems = useMemo(
    () =>
      projects.map((project) => {
        const projectHref = `/tenants/${model.routeTenantId}/projects/${project.id}`;
        const usage = getProjectUsage(project, projectCostsById.get(project.id), usageKnown);
        const warningThresholdPercent =
          warningThresholdsByProjectId.get(project.id) ?? defaultWarningThresholdPercent;

        return {
          budgetProgress: clampProgress(usage.usagePercent),
          budgetState: getProjectBudgetState(usage.usagePercent, warningThresholdPercent),
          href: project.runtimeApplicationId ? `${projectHref}/policies` : projectHref,
          project,
          tokenProgress: getRelativeTokenUsagePercent(
            usage.totalTokens,
            highestProjectTokens
          ),
          usage
        };
      }),
    [
      highestProjectTokens,
      model.routeTenantId,
      projectCostsById,
      projects,
      usageKnown,
      warningThresholdsByProjectId
    ]
  );
  const sortedProjectItems = useMemo(
    () =>
      [...projectItems].sort((left, right) =>
        compareProjectsBySortMode(
          left.project,
          right.project,
          sortMode,
          left.usage,
          right.usage
        )
      ),
    [projectItems, sortMode]
  );
  const createProjectActionLocation = getProjectCreateActionLocation(
    projects.length,
    canCreateProject
  );
  const createProjectAction = createProjectActionLocation ? (
    <Link
      className="primary-button project-create-button"
      href={`/tenants/${model.routeTenantId}/onboarding`}
    >
      <Plus aria-hidden="true" />
      {text.createProject}
    </Link>
  ) : null;

  return (
    <main className="console-content management-line-content">
      <header className="project-page-header">
        <h2>{text.title}</h2>
      </header>

      {model.source === "fixture" ? (
        <Alert variant="warning">
          <AlertDescription>{text.fixtureFallback} {model.loadError}</AlertDescription>
        </Alert>
      ) : null}

      {monthlyCostReport.source === "preview" ? (
        <Alert>
          <AlertDescription>{text.previewUsage}</AlertDescription>
        </Alert>
      ) : monthlyCostReport.loadError ? (
        <Alert variant="warning">
          <AlertDescription>{text.costReportFallback}</AlertDescription>
        </Alert>
      ) : null}

      {draftProjects.length > 0 ? (
        <section className="console-panel project-draft-panel" aria-label={text.draftTitle}>
          <div className="project-draft-heading">
            <span className="project-draft-icon" aria-hidden="true">
              <Clock3 />
            </span>
            <div>
              <h3>
                {text.draftTitle} <span>{draftProjects.length}</span>
              </h3>
              <p>{text.draftDescription}</p>
            </div>
          </div>
          <div className="project-draft-list">
            {draftProjects.map((project) => (
              <Link
                className="project-draft-link"
                href={`/tenants/${model.routeTenantId}/projects/${project.id}`}
                key={project.id}
              >
                <span className="project-draft-name">
                  <Badge className="project-draft-badge" variant="outline">
                    {text.draftBadge}
                  </Badge>
                  <strong>{project.name}</strong>
                </span>
                <span className="project-draft-action">
                  {text.openProject}
                  <ArrowRight aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="console-panel project-list-panel">
        {projects.length === 0 ? (
          <div className="project-empty-state">
            <p className="project-empty">{text.empty}</p>
            {createProjectActionLocation === "empty" ? createProjectAction : null}
          </div>
        ) : (
          <div className="project-card-list">
            <div className="project-list-toolbar">
              <h3>
                {text.operatingProjects} <span>{projects.length}</span>
              </h3>
              <div className="project-sort-control" aria-label={text.sortLabel}>
                <span>{text.sortLabel}</span>
                <div className="project-sort-buttons">
                  {projectSortModes.map((mode) => (
                    <button
                      aria-pressed={sortMode === mode}
                      className="project-sort-button"
                      data-active={sortMode === mode}
                      key={mode}
                      onClick={() => setSortMode(mode)}
                      type="button"
                    >
                      {formatProjectSortMode(mode, text)}
                    </button>
                  ))}
                </div>
                {createProjectActionLocation === "toolbar" ? createProjectAction : null}
              </div>
            </div>

            <div className="project-card-grid">
              {sortedProjectItems.map((item) => (
                  <Link
                    aria-label={`${item.project.name} ${text.manageProject}`}
                    className="project-card"
                    data-budget-state={item.budgetState}
                    data-testid="project-card"
                    href={item.href}
                    key={item.project.id}
                  >
                    <div className="project-card-title-row">
                      <h4 className="project-card-title">{item.project.name}</h4>
                    </div>

                    <div className="project-card-metrics">
                      <div className="project-card-metric project-budget-metric">
                        <div className="project-metric-heading">
                          <span>{text.budgetUsage}</span>
                          <strong>{formatUsagePercent(item.usage.usagePercent)}</strong>
                        </div>
                        <div
                          aria-label={text.budgetUsage}
                          aria-valuemax={100}
                          aria-valuemin={0}
                          aria-valuenow={item.usage.usagePercent === null ? undefined : Math.round(item.budgetProgress)}
                          className="project-usage-track"
                          role="progressbar"
                        >
                          <span
                            className="project-usage-fill"
                            style={{ width: `${item.budgetProgress}%` }}
                          />
                        </div>
                        <p className="project-metric-detail">
                          {item.usage.costMicroUsd === null
                            ? text.usageUnavailable
                            : `${formatMicroUsd(item.usage.costMicroUsd)} / ${formatBudgetUsd(
                                item.project.totalBudgetUsd
                              )}`}
                        </p>
                      </div>

                      <div className="project-card-metric project-token-metric">
                        <div className="project-metric-heading">
                          <span>{text.tokenUsage}</span>
                          <strong>{formatTokenCount(item.usage.totalTokens)}</strong>
                        </div>
                        <div
                          aria-label={text.tokenUsage}
                          aria-valuemax={100}
                          aria-valuemin={0}
                          aria-valuenow={item.tokenProgress === null ? undefined : Math.round(item.tokenProgress)}
                          className="project-token-track"
                          role="progressbar"
                        >
                          <span
                            className="project-token-fill"
                            style={{ width: `${item.tokenProgress ?? 0}%` }}
                          />
                        </div>
                        <p className="project-metric-detail">
                          {item.tokenProgress === null
                            ? text.usageUnavailable
                            : highestProjectTokens === 0
                              ? text.tokenComparisonEmpty
                              : `${text.tokenComparison} ${Math.round(item.tokenProgress)}%`}
                        </p>
                      </div>
                    </div>

                    <span className="project-card-action">
                      {text.manageProject}
                      <ArrowRight aria-hidden="true" />
                    </span>
                  </Link>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

export function ProjectDetailManagement({
  breadcrumbItems,
  locale,
  project,
  tenantId
}: ProjectDetailManagementProps) {
  const router = useRouter();
  const text = projectText[locale];
  const [values, setValues] = useState<ProjectUpdateValues>(() => getProjectUpdateValues(project));
  const [pendingAction, setPendingAction] = useState<"save" | null>(null);
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
          locale === "ko" ? "프로젝트 예산은 0 이상으로 입력하세요." : "Project budget must be 0 or more.",
        status: "error"
      });
      return;
    }

    setPendingAction("save");
    setSubmitState({ message: "", status: "idle" });

    try {
      const response = await fetch("/api/control-plane/projects", {
        body: JSON.stringify({
          action: "update",
          tenantId,
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
        return;
      }

      setValues(getProjectUpdateValues(payload.project));
      setSubmitState({
        message: text.detailSaved,
        status: "success"
      });
      router.refresh();
    } catch {
      setSubmitState({
        message: "Project update failed.",
        status: "error"
      });
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <main className="console-content management-line-content project-detail-content">
      <section className="dashboard-hero">
        <div>
          {breadcrumbItems ? <Breadcrumb items={breadcrumbItems} /> : null}
          <h2>{project.name}</h2>
        </div>
      </section>

      {submitState.message ? (
        <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="console-panel project-detail-panel">
        <div className="project-detail-section">
          <div className="project-detail-section-heading">
            <h3>{text.general}</h3>
          </div>
          <div className="project-detail-general-content">
            <div className="project-detail-form">
              <label className="policy-field project-general-name-field">
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
              <label className="policy-field project-general-description-field">
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
              <div className="project-general-meta-grid">
                <label className="policy-field project-general-budget-field">
                  <span>{text.totalBudget}</span>
                  <div className="project-general-budget-input">
                    <span aria-hidden="true">$</span>
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
                  </div>
                </label>
                <label className="policy-field project-general-status-field">
                  <span>{text.status}</span>
                  <div className="project-general-status-input" data-status={values.status}>
                    <span aria-hidden="true" />
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
                  </div>
                </label>
              </div>
            </div>
            <div className="project-detail-actions">
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
          </div>
        </div>

      </section>
    </main>
  );
}

export function ProjectDetailSection({
  locale,
  project,
  tenantId
}: Omit<ProjectDetailManagementProps, "breadcrumbItems">) {
  const router = useRouter();
  const text = projectText[locale];
  const [values, setValues] = useState<ProjectUpdateValues>(() => getProjectUpdateValues(project));
  const [pendingAction, setPendingAction] = useState<"save" | null>(null);
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
          locale === "ko" ? "프로젝트 예산은 0 이상으로 입력하세요." : "Project budget must be 0 or more.",
        status: "error"
      });
      return;
    }

    setPendingAction("save");
    setSubmitState({ message: "", status: "idle" });

    try {
      const response = await fetch("/api/control-plane/projects", {
        body: JSON.stringify({
          action: "update",
          tenantId,
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
        return;
      }

      setValues(getProjectUpdateValues(payload.project));
      setSubmitState({
        message: text.detailSaved,
        status: "success"
      });
      router.refresh();
    } catch {
      setSubmitState({
        message: "Project update failed.",
        status: "error"
      });
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <>
      {submitState.message ? (
        <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="console-panel project-detail-panel">
        <div className="project-detail-section">
          <div className="project-detail-section-heading">
            <h3>{text.general}</h3>
          </div>
          <div className="project-detail-general-content">
            <div className="project-detail-form">
              <label className="policy-field project-general-name-field">
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
              <label className="policy-field project-general-description-field">
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
              <div className="project-general-meta-grid">
                <label className="policy-field project-general-budget-field">
                  <span>{text.totalBudget}</span>
                  <div className="project-general-budget-input">
                    <span aria-hidden="true">$</span>
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
                  </div>
                </label>
                <label className="policy-field project-general-status-field">
                  <span>{text.status}</span>
                  <div
                    className="project-general-status-input"
                    data-status={values.status}
                  >
                    <span aria-hidden="true" />
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
                  </div>
                </label>
              </div>
            </div>
            <div className="project-detail-actions">
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
          </div>
        </div>
      </section>
    </>
  );
}

export function ProjectDeleteManagement({ locale, project, tenantId }: ProjectDetailManagementProps) {
  const router = useRouter();
  const text = projectText[locale];
  const [submitState, setSubmitState] = useState<SubmitState>({ message: "", status: "idle" });
  const [isDeleting, setIsDeleting] = useState(false);

  async function deleteProject() {
    if (!window.confirm(text.deleteConfirm)) {
      return;
    }

    setIsDeleting(true);
    setSubmitState({ message: "", status: "idle" });

    let didNavigate = false;

    try {
      const response = await fetch("/api/control-plane/projects", {
        body: JSON.stringify({
          action: "update",
          tenantId,
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
        return;
      }

      didNavigate = true;
      router.push(`/tenants/${tenantId}/projects`);
      router.refresh();
    } catch {
      setSubmitState({
        message: "Project delete failed.",
        status: "error"
      });
    } finally {
      if (!didNavigate) {
        setIsDeleting(false);
      }
    }
  }

  return (
    <main className="console-content management-line-content project-delete-content">
      {submitState.message ? (
        <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="console-panel project-detail-panel">
        <div className="project-detail-section project-delete-section">
          <div className="project-detail-actions project-delete-actions">
            <button
              className="secondary-button project-danger-button"
              disabled={isDeleting || project.status === "ARCHIVED"}
              onClick={() => void deleteProject()}
              type="button"
            >
              <Trash2 aria-hidden="true" />
              {isDeleting ? "..." : text.delete}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}

export function ProjectDeleteSection({
  locale,
  project,
  tenantId
}: Omit<ProjectDetailManagementProps, "breadcrumbItems">) {
  const router = useRouter();
  const text = projectText[locale];
  const [submitState, setSubmitState] = useState<SubmitState>({ message: "", status: "idle" });
  const [isDeleting, setIsDeleting] = useState(false);

  async function deleteProject() {
    if (!window.confirm(text.deleteConfirm)) {
      return;
    }

    setIsDeleting(true);
    setSubmitState({ message: "", status: "idle" });

    let didNavigate = false;

    try {
      const response = await fetch("/api/control-plane/projects", {
        body: JSON.stringify({
          action: "update",
          tenantId,
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
        return;
      }

      didNavigate = true;
      router.push(`/tenants/${tenantId}/projects`);
      router.refresh();
    } catch {
      setSubmitState({
        message: "Project delete failed.",
        status: "error"
      });
    } finally {
      if (!didNavigate) {
        setIsDeleting(false);
      }
    }
  }

  return (
    <>
      {submitState.message ? (
        <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}

      <section className="console-panel project-detail-panel">
        <div className="project-detail-section project-delete-section">
          <div className="project-detail-actions project-delete-actions">
            <button
              className="secondary-button project-danger-button"
              disabled={isDeleting || project.status === "ARCHIVED"}
              onClick={() => void deleteProject()}
              type="button"
            >
              <Trash2 aria-hidden="true" />
              {isDeleting ? "..." : text.delete}
            </button>
          </div>
        </div>
      </section>
    </>
  );
}

type ProjectMonthlyCostRecord = ProjectMonthlyCostReport["projectCosts"][number];

type ProjectUsage = {
  costMicroUsd: number | null;
  totalTokens: number | null;
  usagePercent: number | null;
};

function compareProjectsBySortMode(
  left: ProjectRecord,
  right: ProjectRecord,
  sortMode: ProjectSortMode,
  leftUsage: ProjectUsage,
  rightUsage: ProjectUsage
) {
  if (sortMode === "budgetRisk") {
    return (
      compareNullableDescending(leftUsage.usagePercent, rightUsage.usagePercent) ||
      compareNullableDescending(leftUsage.costMicroUsd, rightUsage.costMicroUsd) ||
      compareProjectIdentity(left, right)
    );
  }

  return (
    compareNullableDescending(leftUsage.totalTokens, rightUsage.totalTokens) ||
    compareProjectIdentity(left, right)
  );
}

function compareProjectIdentity(left: ProjectRecord, right: ProjectRecord) {
  return compareStableText(left.name, right.name) || compareStableText(left.id, right.id);
}

function compareStableText(left: string, right: string) {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
}

function compareNullableDescending(left: number | null, right: number | null) {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return right - left;
}

function getProjectUsage(
  project: ProjectRecord,
  monthlyCost: ProjectMonthlyCostRecord | undefined,
  usageKnown: boolean
): ProjectUsage {
  if (!usageKnown) {
    return {
      costMicroUsd: null,
      totalTokens: null,
      usagePercent: null
    };
  }

  const costMicroUsd = monthlyCost?.costMicroUsd ?? 0;
  const costUsd = costMicroUsd / 1_000_000;
  const budgetUsd = Math.max(0, project.totalBudgetUsd);
  const usagePercent = budgetUsd > 0 ? (costUsd * 100) / budgetUsd : costUsd > 0 ? 100 : 0;

  return {
    costMicroUsd,
    totalTokens: monthlyCost?.totalTokens ?? 0,
    usagePercent
  };
}

function getProjectBudgetState(
  usagePercent: number | null,
  warningThresholdPercent: number
): ProjectBudgetState {
  if (usagePercent !== null && usagePercent >= 100) {
    return "alert";
  }

  if (
    usagePercent !== null &&
    warningThresholdPercent > 0 &&
    usagePercent >= warningThresholdPercent
  ) {
    return "warning";
  }

  return "operational";
}

function formatProjectSortMode(mode: ProjectSortMode, text: (typeof projectText)[Locale]) {
  if (mode === "budgetRisk") {
    return text.sortBudgetRisk;
  }

  return text.sortTokens;
}

function formatUsagePercent(value: number | null) {
  if (value === null) {
    return "—";
  }

  return `${Math.round(value)}%`;
}

function formatMicroUsd(value: number | null) {
  if (value === null) {
    return "—";
  }

  return formatBudgetUsd(value / 1_000_000);
}

function formatTokenCount(value: number | null) {
  if (value === null) {
    return "—";
  }

  return compactTokenFormatter.format(value);
}

function clampProgress(value: number | null) {
  if (value === null) {
    return 0;
  }

  return Math.max(0, Math.min(value, 100));
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
