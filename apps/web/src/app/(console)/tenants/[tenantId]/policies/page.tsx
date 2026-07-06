import Link from "next/link";
import { ConsoleShell } from "@/components/layout/console-shell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { getApplicationsModel } from "@/lib/control-plane/applications-client";
import type { ApplicationRecord } from "@/lib/control-plane/applications-types";
import { getProjectsModel } from "@/lib/control-plane/projects-client";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";
import { getRequestLocale } from "@/lib/i18n/server-locale";
import type { Locale } from "@/lib/i18n/locale";

type PoliciesPageProps = {
  params: Promise<{
    tenantId: string;
  }>;
  searchParams?: Promise<{
    projectId?: string;
  }>;
};

type PolicyApplicationSelection = {
  applications: ApplicationRecord[];
  loadError: string | null;
  source: "control-plane" | "fixture";
};

const policySelectionText: Record<
  Locale,
  {
    applications: string;
    applicationEmpty: string;
    applicationHint: string;
    budget: string;
    chooseProject: string;
    created: string;
    editPolicy: string;
    fixtureFallback: string;
    management: string;
    noProjects: string;
    projectHint: string;
    projectRequired: string;
    select: string;
    selected: string;
    status: string;
    title: string;
    updated: string;
  }
> = {
  en: {
    applications: "Applications",
    applicationEmpty: "No applications found in this project.",
    applicationHint: "Choose an application to edit its runtime policy.",
    budget: "Budget",
    chooseProject: "Choose project",
    created: "Created",
    editPolicy: "Edit policy",
    fixtureFallback: "Control Plane unavailable. Showing fixture values.",
    management: "management",
    noProjects: "No active projects found.",
    projectHint: "Select a project first. Policies are edited per application inside a project.",
    projectRequired: "Project selection is required before policy editing.",
    select: "Select",
    selected: "Selected",
    status: "Status",
    title: "Policies",
    updated: "Updated"
  },
  ko: {
    applications: "Applications",
    applicationEmpty: "No applications found in this project.",
    applicationHint: "Choose an application to edit its runtime policy.",
    budget: "Budget",
    chooseProject: "Choose project",
    created: "Created",
    editPolicy: "Edit policy",
    fixtureFallback: "Control Plane unavailable. Showing fixture values.",
    management: "management",
    noProjects: "No active projects found.",
    projectHint: "Select a project first. Policies are edited per application inside a project.",
    projectRequired: "Project selection is required before policy editing.",
    select: "Select",
    selected: "Selected",
    status: "Status",
    title: "Policies",
    updated: "Updated"
  }
};

export default async function PoliciesPage({ params, searchParams }: PoliciesPageProps) {
  const { tenantId } = await params;
  const resolvedSearchParams = await searchParams;
  const selectedProjectId = resolvedSearchParams?.projectId;
  const [locale, projectsModel] = await Promise.all([
    getRequestLocale(),
    getProjectsModel(tenantId)
  ]);
  const projects = projectsModel.projects.filter((project) => project.status !== "ARCHIVED");
  const selectedProject = selectedProjectId
    ? projects.find((project) => project.id === selectedProjectId) ?? null
    : null;
  const applicationSelection = selectedProject
    ? await getPolicyApplicationSelection(tenantId, selectedProject)
    : null;

  return (
    <ConsoleShell
      activeManagementItem="policies"
      activeSection="management"
      locale={locale}
      tenantId={tenantId}
    >
      <PolicyProjectSelectionView
        applicationSelection={applicationSelection}
        locale={locale}
        projects={projects}
        projectsLoadError={projectsModel.loadError}
        projectsSource={projectsModel.source}
        selectedProject={selectedProject}
        tenantId={tenantId}
      />
    </ConsoleShell>
  );
}

async function getPolicyApplicationSelection(
  tenantId: string,
  project: ProjectRecord
): Promise<PolicyApplicationSelection> {
  const applicationsModel = await getApplicationsModel(tenantId, project.id);

  return {
    applications: applicationsModel.applications.filter(
      (application) => application.status !== "ARCHIVED"
    ),
    loadError: applicationsModel.loadError,
    source: applicationsModel.source
  };
}

function PolicyProjectSelectionView({
  applicationSelection,
  locale,
  projects,
  projectsLoadError,
  projectsSource,
  selectedProject,
  tenantId
}: {
  applicationSelection: PolicyApplicationSelection | null;
  locale: Locale;
  projects: ProjectRecord[];
  projectsLoadError: string | null;
  projectsSource: "control-plane" | "fixture";
  selectedProject: ProjectRecord | null;
  tenantId: string;
}) {
  const text = policySelectionText[locale];
  const applications = applicationSelection?.applications ?? [];

  return (
    <main className="console-content management-line-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.management}</p>
          <h2>{text.title}</h2>
        </div>
      </section>

      <Alert variant="neutral">
        <AlertDescription>{text.projectRequired}</AlertDescription>
      </Alert>

      {projectsSource === "fixture" ? (
        <Alert variant="warning">
          <AlertDescription>
            {text.fixtureFallback} {projectsLoadError}
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{text.chooseProject}</h3>
          <p>{text.projectHint}</p>
        </div>
        {projects.length === 0 ? (
          <p className="project-empty">{text.noProjects}</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table project-table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Description</th>
                  <th>{text.budget}</th>
                  <th>{text.status}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => {
                  const isSelected = selectedProject?.id === project.id;

                  return (
                    <tr key={project.id}>
                      <td>
                        <strong className="provider-name">{project.name}</strong>
                        <small className="project-muted">{project.id}</small>
                      </td>
                      <td>{nullableText(project.description, "-")}</td>
                      <td>{formatBudgetUsd(project.totalBudgetUsd)}</td>
                      <td>
                        <Badge
                          className="project-status-badge"
                          data-status={project.status}
                          variant="outline"
                        >
                          {formatStatus(project.status)}
                        </Badge>
                      </td>
                      <td>
                        <Link
                          className={isSelected ? "primary-button" : "secondary-link"}
                          href={`/tenants/${tenantId}/policies?projectId=${project.id}`}
                        >
                          {isSelected ? text.selected : text.select}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedProject ? (
        <section className="console-panel">
          <div className="panel-heading">
            <h3>
              {selectedProject.name} / {text.applications}
            </h3>
            <p>{text.applicationHint}</p>
          </div>

          {applicationSelection?.source === "fixture" ? (
            <Alert variant="warning">
              <AlertDescription>
                {text.fixtureFallback} {applicationSelection.loadError}
              </AlertDescription>
            </Alert>
          ) : null}

          {applications.length === 0 ? (
            <p className="project-empty">{text.applicationEmpty}</p>
          ) : (
            <div className="table-wrap">
              <table className="data-table application-table">
                <thead>
                  <tr>
                    <th>Application</th>
                    <th>{text.budget}</th>
                    <th>{text.status}</th>
                    <th>{text.updated}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {applications.map((application) => (
                    <tr key={application.id}>
                      <td>
                        <strong className="provider-name">{application.name}</strong>
                        <small className="project-muted">{application.id}</small>
                      </td>
                      <td>{formatBudgetUsd(application.effectiveBudgetLimitUsd)}</td>
                      <td>
                        <Badge
                          className="project-status-badge"
                          data-status={application.status}
                          variant="outline"
                        >
                          {formatStatus(application.status)}
                        </Badge>
                      </td>
                      <td>
                        <span className="project-muted">
                          {formatDateTime(application.updatedAt)}
                        </span>
                        <small className="project-muted">
                          {text.created}: {formatDateTime(application.createdAt)}
                        </small>
                      </td>
                      <td>
                        <Link
                          className="primary-button"
                          href={`/tenants/${tenantId}/projects/${selectedProject.id}/applications/${application.id}/policies`}
                        >
                          {text.editPolicy}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </main>
  );
}

function formatBudgetUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    style: "currency"
  }).format(value);
}

function formatStatus(value: string) {
  return value.toLowerCase().replace(/_/g, " ");
}
