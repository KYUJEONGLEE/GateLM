"use client";

import { Plus, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ProjectFormValues,
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

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type ProjectResponsePayload = {
  error?: string;
  project?: ProjectRecord;
};

const projectStatuses: ProjectStatus[] = ["ACTIVE", "DISABLED", "ARCHIVED"];

const emptyProjectForm: ProjectFormValues = {
  description: "",
  name: ""
};

const projectText: Record<
  Locale,
  {
    create: string;
    created: string;
    description: string;
    empty: string;
    fixtureFallback: string;
    management: string;
    name: string;
    projectId: string;
    save: string;
    source: string;
    status: string;
    title: string;
    updated: string;
  }
> = {
  en: {
    create: "Create project",
    created: "Created",
    description: "Description",
    empty: "No projects found.",
    fixtureFallback: "Control Plane unavailable. Showing fixture project.",
    management: "management",
    name: "Name",
    projectId: "Project ID",
    save: "Save",
    source: "Source",
    status: "Status",
    title: "Projects",
    updated: "Updated"
  },
  ko: {
    create: "프로젝트 생성",
    created: "생성",
    description: "설명",
    empty: "프로젝트가 없습니다.",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 프로젝트를 표시 중입니다.",
    management: "관리",
    name: "이름",
    projectId: "Project ID",
    save: "저장",
    source: "출처",
    status: "상태",
    title: "프로젝트",
    updated: "수정"
  }
};

export function ProjectManagement({ locale, model }: ProjectManagementProps) {
  const router = useRouter();
  const text = projectText[locale];
  const [projects, setProjects] = useState<ProjectRecord[]>(model.projects);
  const [createValues, setCreateValues] = useState<ProjectFormValues>(emptyProjectForm);
  const [editingRows, setEditingRows] = useState<Record<string, ProjectUpdateValues>>(() =>
    Object.fromEntries(model.projects.map((project) => [project.id, getProjectUpdateValues(project)]))
  );
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const sourceLabel = model.source === "control-plane" ? "Control Plane" : "fixture";

  async function submitCreateProject() {
    if (!createValues.name.trim()) {
      setSubmitState({
        message: locale === "ko" ? "프로젝트 이름을 입력하세요." : "Project name is required.",
        status: "error"
      });
      return;
    }

    setPendingAction("create");
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/projects", {
      body: JSON.stringify({
        action: "create",
        values: createValues
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProjectResponsePayload;

    if (!response.ok || !payload.project) {
      setSubmitState({
        message: payload.error ?? "Project creation failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    const createdProject = payload.project;

    setProjects((current) => [...current, createdProject]);
    setEditingRows((current) => ({
      ...current,
      [createdProject.id]: getProjectUpdateValues(createdProject)
    }));
    setCreateValues(emptyProjectForm);
    setSubmitState({
      message: locale === "ko" ? "프로젝트가 생성되었습니다." : "Project created.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function submitUpdateProject(projectId: string) {
    const values = editingRows[projectId];

    if (!values?.name.trim()) {
      setSubmitState({
        message: locale === "ko" ? "프로젝트 이름을 입력하세요." : "Project name is required.",
        status: "error"
      });
      return;
    }

    setPendingAction(`update:${projectId}`);
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

    const updatedProject = payload.project;

    setProjects((current) =>
      current.map((project) => (project.id === projectId ? updatedProject : project))
    );
    setEditingRows((current) => ({
      ...current,
      [projectId]: getProjectUpdateValues(updatedProject)
    }));
    setSubmitState({
      message: locale === "ko" ? "프로젝트가 수정되었습니다." : "Project updated.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  function updateRow(projectId: string, values: Partial<ProjectUpdateValues>) {
    setEditingRows((current) => ({
      ...current,
      [projectId]: {
        ...current[projectId],
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
        <div className="project-source">
          <span>{text.source}</span>
          <strong>{sourceLabel}</strong>
        </div>
      </section>

      {model.source === "fixture" ? (
        <p className="policy-alert" data-status="warning">
          {text.fixtureFallback} {model.loadError}
        </p>
      ) : null}
      {submitState.message ? (
        <p className="policy-alert" data-status={submitState.status}>
          {submitState.message}
        </p>
      ) : null}

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{text.create}</h3>
        </div>
        <div className="project-create-form">
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
          <Button
            disabled={pendingAction !== null}
            onClick={() => void submitCreateProject()}
            type="button"
          >
            <Plus aria-hidden="true" />
            {text.create}
          </Button>
        </div>
      </section>

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
                  <th>{text.status}</th>
                  <th>{text.updated}</th>
                  <th>{text.projectId}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => {
                  const rowValues = editingRows[project.id] ?? getProjectUpdateValues(project);

                  return (
                    <tr key={project.id}>
                      <td>
                        <label className="policy-field project-table-field">
                          <span>{text.name}</span>
                          <input
                            maxLength={120}
                            onChange={(event) => updateRow(project.id, { name: event.target.value })}
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
                              updateRow(project.id, { description: event.target.value })
                            }
                            value={rowValues.description}
                          />
                        </label>
                      </td>
                      <td>
                        <div className="project-status-cell">
                          <Badge
                            className="project-status-badge"
                            data-status={project.status}
                            variant="outline"
                          >
                            {formatProjectStatus(project.status)}
                          </Badge>
                          <label className="policy-field project-table-field">
                            <span>{text.status}</span>
                            <select
                              onChange={(event) =>
                                updateRow(project.id, {
                                  status: event.target.value as ProjectStatus
                                })
                              }
                              value={rowValues.status}
                            >
                              {projectStatuses.map((status) => (
                                <option key={status} value={status}>
                                  {formatProjectStatus(status)}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </td>
                      <td>
                        <span className="project-muted">{formatDateTime(project.updatedAt)}</span>
                        <small className="project-muted">
                          {text.created}: {formatDateTime(project.createdAt)}
                        </small>
                      </td>
                      <td>
                        <code className="project-code">{project.id}</code>
                      </td>
                      <td>
                        <div className="project-row-actions">
                          <Button
                            disabled={pendingAction !== null}
                            onClick={() => void submitUpdateProject(project.id)}
                            type="button"
                            variant="outline"
                          >
                            <Save aria-hidden="true" />
                            {pendingAction === `update:${project.id}` ? "..." : text.save}
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

function getProjectUpdateValues(project: ProjectRecord): ProjectUpdateValues {
  return {
    description: nullableText(project.description, ""),
    name: project.name,
    projectId: project.id,
    status: project.status
  };
}

function formatProjectStatus(status: ProjectStatus) {
  return status.toLowerCase();
}
