"use client";

import { Pencil, Plus, Save, Settings, Trash2 } from "lucide-react";
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

type ProjectManagementProps = {
  budgetThresholds: ProjectBudgetThresholdRecord[];
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

type ProjectSortMode = "budget" | "limitRisk" | "usage";
type ProjectBudgetState = "alert" | "operational" | "warning";

const projectStatuses: ProjectStatus[] = ["ACTIVE", "DISABLED", "ARCHIVED"];
const projectSortModes: ProjectSortMode[] = ["budget", "limitRisk", "usage"];
const defaultWarningThresholdPercent = 80;

const projectText: Record<
  Locale,
  {
    actions: string;
    createProject: string;
    created: string;
    description: string;
    edit: string;
    editPolicy: string;
    empty: string;
    budgetAlert: string;
    budgetWarning: string;
    costReportFallback: string;
    fixtureFallback: string;
    detailSaved: string;
    general: string;
    management: string;
    name: string;
    operating: string;
    project: string;
    projectId: string;
    save: string;
    delete: string;
    deleteConfirm: string;
    sortBudget: string;
    sortLabel: string;
    sortLimitRisk: string;
    sortUsage: string;
    totalBudget: string;
    deleted: string;
    source: string;
    status: string;
    title: string;
    updated: string;
    usage: string;
  }
> = {
  en: {
    actions: "Actions",
    createProject: "Create Project",
    created: "Created",
    description: "Description",
    edit: "Edit",
    editPolicy: "Edit policy",
    empty: "No projects found.",
    budgetAlert: "Limit exceeded",
    budgetWarning: "Warning",
    costReportFallback: "Monthly usage is unavailable.",
    fixtureFallback: "Control Plane unavailable. Showing fixture project.",
    detailSaved: "Project saved.",
    general: "General",
    management: "management",
    name: "Name",
    operating: "Operating",
    project: "Project",
    projectId: "Project ID",
    save: "Save",
    delete: "Delete",
    deleteConfirm: "Delete this project? This action cannot be undone.",
    sortBudget: "Budget",
    sortLabel: "Sort by",
    sortLimitRisk: "Limit risk",
    sortUsage: "Usage",
    totalBudget: "Project budget",
    deleted: "Project deleted.",
    source: "Source",
    status: "Status",
    title: "Projects",
    updated: "Updated",
    usage: "Usage"
  },
  ko: {
    actions: "작업",
    createProject: "Create Project",
    created: "생성",
    description: "설명",
    edit: "편집",
    editPolicy: "정책 수정",
    empty: "프로젝트가 없습니다.",
    budgetAlert: "한도 초과",
    budgetWarning: "주의",
    costReportFallback: "월간 사용량을 불러올 수 없습니다.",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 프로젝트를 표시 중입니다.",
    detailSaved: "Project가 저장되었습니다.",
    general: "일반",
    management: "관리",
    name: "이름",
    operating: "운영중",
    project: "Project",
    projectId: "Project ID",
    save: "저장",
    delete: "삭제",
    deleteConfirm: "이 Project를 삭제할까요? 이 작업은 되돌릴 수 없습니다.",
    sortBudget: "예산순",
    sortLabel: "정렬 기준",
    sortLimitRisk: "한도 임박순",
    sortUsage: "사용량순",
    totalBudget: "프로젝트 예산",
    deleted: "Project가 삭제되었습니다.",
    source: "출처",
    status: "상태",
    title: "프로젝트",
    updated: "수정",
    usage: "사용률"
  }
};

export function ProjectManagement({
  budgetThresholds,
  locale,
  model,
  monthlyCostReport
}: ProjectManagementProps) {
  const text = projectText[locale];
  const [sortMode, setSortMode] = useState<ProjectSortMode>("usage");
  const projects = model.projects.filter((project) => project.status !== "ARCHIVED");
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
  const usageKnown = monthlyCostReport.source === "gateway";
  const sortedProjects = useMemo(
    () =>
      [...projects].sort((left, right) =>
        compareProjectsBySortMode(
          left,
          right,
          sortMode,
          getProjectUsage(left, projectCostsById.get(left.id), usageKnown),
          getProjectUsage(right, projectCostsById.get(right.id), usageKnown)
        )
      ),
    [projectCostsById, projects, sortMode, usageKnown]
  );

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
        <Alert variant="warning">
          <AlertDescription>{text.fixtureFallback} {model.loadError}</AlertDescription>
        </Alert>
      ) : null}

      {monthlyCostReport.loadError ? (
        <Alert variant="warning">
          <AlertDescription>{text.costReportFallback}</AlertDescription>
        </Alert>
      ) : null}

      <section className="console-panel project-list-panel">
        <div className="panel-heading">
          <h3>{text.title}</h3>
        </div>
        {projects.length === 0 ? (
          <p className="project-empty">{text.empty}</p>
        ) : (
          <div className="project-card-list">
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
            </div>

            <div className="project-card-grid">
              {sortedProjects.map((project) => {
                const projectHref = `/tenants/${model.routeTenantId}/projects/${project.id}`;
                const policyHref = project.runtimeApplicationId ? `${projectHref}/policies` : null;
                const usage = getProjectUsage(project, projectCostsById.get(project.id), usageKnown);
                const warningThresholdPercent =
                  warningThresholdsByProjectId.get(project.id) ?? defaultWarningThresholdPercent;
                const budgetState = getProjectBudgetState(
                  usage.usagePercent,
                  warningThresholdPercent
                );
                const progressWidth = usage.usagePercent === null
                  ? 0
                  : Math.max(0, Math.min(usage.usagePercent, 100));
                const usageCostText = `${formatMicroUsd(usage.costMicroUsd)} / ${formatBudgetUsd(project.totalBudgetUsd)}`;

                return (
                  <article
                    className="project-card"
                    data-budget-state={budgetState}
                    data-testid="project-card"
                    key={project.id}
                  >
                    <div className="project-card-title-row">
                      <h4 className="project-card-title">{project.name}</h4>
                      <Badge
                        className="project-budget-badge"
                        data-budget-state={budgetState}
                        variant="outline"
                      >
                        {formatProjectBudgetState(budgetState, text)}
                      </Badge>
                    </div>

                    <div className="project-card-usage">
                      <div className="project-usage-summary">
                        <div>
                          <span className="project-usage-label">{text.usage}</span>
                          <strong className="project-usage-value">
                            {formatUsagePercent(usage.usagePercent)}
                          </strong>
                        </div>
                        <span className="project-usage-cost">{usageCostText}</span>
                      </div>
                      <div
                        aria-label={text.usage}
                        aria-valuemax={100}
                        aria-valuemin={0}
                        aria-valuenow={Math.round(progressWidth)}
                        className="project-usage-track"
                        role="progressbar"
                      >
                        <span className="project-usage-fill" style={{ width: `${progressWidth}%` }} />
                      </div>
                    </div>

                    <div className="project-card-actions">
                      <Link className="secondary-button project-list-action-link" href={projectHref}>
                        <Pencil aria-hidden="true" />
                        {text.edit}
                      </Link>
                      {policyHref ? (
                        <Link className="secondary-button project-list-action-link" href={policyHref}>
                          <Settings aria-hidden="true" />
                          {text.editPolicy}
                        </Link>
                      ) : (
                        <span
                          aria-disabled="true"
                          className="secondary-button project-list-action-link project-list-action-disabled"
                        >
                          <Settings aria-hidden="true" />
                          {text.editPolicy}
                        </span>
                      )}
                    </div>
                  </article>
                );
              })}
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
  project
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

  return (
    <main className="console-content management-line-content project-detail-content">
      <section className="dashboard-hero">
        <div>
          {breadcrumbItems ? <Breadcrumb items={breadcrumbItems} /> : null}
          <p className="console-kicker">{text.project}</p>
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
      setIsDeleting(false);
      return;
    }

    router.push(`/tenants/${tenantId}/projects`);
    router.refresh();
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

type ProjectMonthlyCostRecord = ProjectMonthlyCostReport["projectCosts"][number];

type ProjectUsage = {
  costMicroUsd: number | null;
  remainingBudgetUsd: number | null;
  usagePercent: number | null;
};

function compareProjectsBySortMode(
  left: ProjectRecord,
  right: ProjectRecord,
  sortMode: ProjectSortMode,
  leftUsage: ProjectUsage,
  rightUsage: ProjectUsage
) {
  if (sortMode === "budget") {
    return compareDescending(left.totalBudgetUsd, right.totalBudgetUsd) || left.name.localeCompare(right.name);
  }

  if (sortMode === "limitRisk") {
    return (
      compareNullableAscending(leftUsage.remainingBudgetUsd, rightUsage.remainingBudgetUsd) ||
      compareNullableDescending(leftUsage.usagePercent, rightUsage.usagePercent) ||
      left.name.localeCompare(right.name)
    );
  }

  return (
    compareNullableDescending(leftUsage.usagePercent, rightUsage.usagePercent) ||
    compareNullableDescending(leftUsage.costMicroUsd, rightUsage.costMicroUsd) ||
    left.name.localeCompare(right.name)
  );
}

function compareDescending(left: number, right: number) {
  return right - left;
}

function compareNullableAscending(left: number | null, right: number | null) {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  return left - right;
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
      remainingBudgetUsd: null,
      usagePercent: null
    };
  }

  const costMicroUsd = monthlyCost?.costMicroUsd ?? 0;
  const costUsd = costMicroUsd / 1_000_000;
  const budgetUsd = Math.max(0, project.totalBudgetUsd);
  const usagePercent = budgetUsd > 0 ? (costUsd * 100) / budgetUsd : costUsd > 0 ? 100 : 0;

  return {
    costMicroUsd,
    remainingBudgetUsd: budgetUsd - costUsd,
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

function formatProjectBudgetState(state: ProjectBudgetState, text: (typeof projectText)[Locale]) {
  if (state === "alert") {
    return text.budgetAlert;
  }

  if (state === "warning") {
    return text.budgetWarning;
  }

  return text.operating;
}

function formatProjectSortMode(mode: ProjectSortMode, text: (typeof projectText)[Locale]) {
  if (mode === "budget") {
    return text.sortBudget;
  }

  if (mode === "limitRisk") {
    return text.sortLimitRisk;
  }

  return text.sortUsage;
}

function formatUsagePercent(value: number | null) {
  if (value === null) {
    return "-";
  }

  return `${Math.round(value)}%`;
}

function formatMicroUsd(value: number | null) {
  if (value === null) {
    return "-";
  }

  return formatBudgetUsd(value / 1_000_000);
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
