"use client";

import { MoreHorizontal, Plus, Save, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  ProjectTeamRecord,
  ProjectTeamsModel,
  TeamFormValues,
  TeamRecord,
  TeamsModel,
  TeamStatus,
  TeamUpdateValues
} from "@/lib/control-plane/teams-types";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type TeamManagementProps = {
  locale: Locale;
  model: TeamsModel;
};

type ProjectTeamAssignmentProps = {
  locale: Locale;
  model: ProjectTeamsModel;
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type TeamResponsePayload = {
  error?: string;
  team?: TeamRecord;
};

type ProjectTeamResponsePayload = {
  error?: string;
  projectTeam?: ProjectTeamRecord;
};

const teamStatuses: TeamStatus[] = ["ACTIVE", "DISABLED", "ARCHIVED"];

export const emptyTeamForm: TeamFormValues = {
  description: "",
  name: ""
};

type TeamCreateModalProps = {
  createValues: TeamFormValues;
  locale: Locale;
  onChange: (values: Partial<TeamFormValues>) => void;
  onClose: () => void;
  onSubmit: () => void;
  pendingAction: string | null;
};

const teamText: Record<
  Locale,
  {
    addTeam: string;
    archive: string;
    assigned: string;
    attach: string;
    attachedTeams: string;
    create: string;
    created: string;
    delete: string;
    description: string;
    empty: string;
    fixtureFallback: string;
    createDescription: string;
    listDescription: string;
    management: string;
    name: string;
    noAssignableTeam: string;
    projectCount: string;
    projectTeamsDescription: string;
    remove: string;
    save: string;
    selectTeam: string;
    cancel: string;
    status: string;
    team: string;
    title: string;
    updated: string;
  }
> = {
  en: {
    addTeam: "Add team",
    archive: "Archive",
    assigned: "Assigned",
    attach: "Attach",
    attachedTeams: "Project teams",
    create: "Create team",
    created: "Created",
    delete: "Delete",
    description: "Description",
    empty: "No teams found.",
    fixtureFallback: "Control Plane unavailable. Showing fixture teams.",
    createDescription: "Create organization teams before assigning them to projects.",
    listDescription: "Manage team status and project assignment count inline.",
    management: "management",
    name: "Name",
    noAssignableTeam: "No active teams available.",
    projectCount: "Projects",
    projectTeamsDescription: "Attach teams that can use this project.",
    remove: "Remove",
    save: "Save",
    selectTeam: "Select team",
    cancel: "Cancel",
    status: "Status",
    team: "Team",
    title: "Teams",
    updated: "Updated"
  },
  ko: {
    addTeam: "팀 추가",
    archive: "보관",
    assigned: "연결됨",
    attach: "연결",
    attachedTeams: "Project 팀",
    create: "팀 생성",
    created: "생성",
    delete: "삭제",
    description: "설명",
    empty: "팀이 없습니다.",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 팀을 표시 중입니다.",
    createDescription: "조직 단위 팀을 먼저 만들고 Project에 연결합니다.",
    listDescription: "팀 상태와 Project 연결 수를 한 줄에서 관리합니다.",
    management: "관리",
    name: "이름",
    noAssignableTeam: "연결할 수 있는 활성 팀이 없습니다.",
    projectCount: "Project",
    projectTeamsDescription: "이 Project를 사용할 수 있는 팀을 연결합니다.",
    remove: "제거",
    save: "저장",
    selectTeam: "팀 선택",
    cancel: "취소",
    status: "상태",
    team: "Team",
    title: "팀",
    updated: "수정"
  }
};

export function TeamManagement({ locale, model }: TeamManagementProps) {
  const router = useRouter();
  const text = teamText[locale];
  const [teams, setTeams] = useState<TeamRecord[]>(model.teams);
  const [createValues, setCreateValues] = useState<TeamFormValues>(emptyTeamForm);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [expandedTeamId, setExpandedTeamId] = useState<string | null>(null);
  const [editingRows, setEditingRows] = useState<Record<string, TeamUpdateValues>>(() =>
    Object.fromEntries(model.teams.map((team) => [team.id, getTeamUpdateValues(team)]))
  );
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const visibleTeams = teams.filter((team) => team.status !== "ARCHIVED");

  async function submitCreateTeam() {
    if (!createValues.name.trim()) {
      setSubmitState({
        message: locale === "ko" ? "팀 이름을 입력하세요." : "Team name is required.",
        status: "error"
      });
      return;
    }

    setPendingAction("create");
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/teams", {
      body: JSON.stringify({
        action: "create",
        values: createValues
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as TeamResponsePayload;

    if (!response.ok || !payload.team) {
      setSubmitState({
        message: payload.error ?? "Team creation failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    const createdTeam = payload.team;

    setTeams((current) => [...current, createdTeam]);
    setEditingRows((current) => ({
      ...current,
      [createdTeam.id]: getTeamUpdateValues(createdTeam)
    }));
    setCreateValues(emptyTeamForm);
    setIsCreateModalOpen(false);
    setSubmitState({
      message: locale === "ko" ? "팀이 생성되었습니다." : "Team created.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function submitUpdateTeam(teamId: string, overrideValues?: TeamUpdateValues) {
    const values = overrideValues ?? editingRows[teamId];

    if (!values?.name.trim()) {
      setSubmitState({
        message: locale === "ko" ? "팀 이름을 입력하세요." : "Team name is required.",
        status: "error"
      });
      return;
    }

    setPendingAction(`update:${teamId}`);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/teams", {
      body: JSON.stringify({
        action: "update",
        values
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as TeamResponsePayload;

    if (!response.ok || !payload.team) {
      setSubmitState({
        message: payload.error ?? "Team update failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    const updatedTeam = payload.team;

    setTeams((current) => current.map((team) => (team.id === teamId ? updatedTeam : team)));
    setEditingRows((current) => ({
      ...current,
      [teamId]: getTeamUpdateValues(updatedTeam)
    }));
    setSubmitState({
      message: locale === "ko" ? "팀이 수정되었습니다." : "Team updated.",
      status: "success"
    });
    setExpandedTeamId(null);
    setPendingAction(null);
    router.refresh();
  }

  function updateRow(teamId: string, values: Partial<TeamUpdateValues>) {
    setEditingRows((current) => ({
      ...current,
      [teamId]: {
        ...current[teamId],
        ...values
      }
    }));
  }

  return (
    <main className="console-content management-line-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.management}</p>
          <h2>{text.title}</h2>
        </div>
      </section>

      {model.source === "fixture" ? (
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

      <section className="team-section">
        <div className="team-section-header">
          <div>
            <h3>{text.title}</h3>
            <p>{text.listDescription}</p>
          </div>
          <div className="team-section-header-action">
            <button
              className="primary-button"
              disabled={pendingAction !== null}
              onClick={() => setIsCreateModalOpen(true)}
              type="button"
            >
              <Plus aria-hidden="true" />
              {text.create}
            </button>
          </div>
        </div>
        {visibleTeams.length === 0 ? (
          <p className="project-empty">{text.empty}</p>
        ) : (
          <div className="team-list">
            {visibleTeams.map((team) => {
              const rowValues = editingRows[team.id] ?? getTeamUpdateValues(team);
              const isExpanded = expandedTeamId === team.id;

              return (
                <article className="team-row" data-expanded={isExpanded} key={team.id}>
                  <div
                    aria-expanded={isExpanded}
                    className="team-row-summary"
                    onClick={() => setExpandedTeamId(isExpanded ? null : team.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setExpandedTeamId(isExpanded ? null : team.id);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                  >
                    <div>
                      <span>{text.name}</span>
                      <strong>{team.name}</strong>
                    </div>
                    <div>
                      <span>{text.description}</span>
                      <p>{nullableText(team.description, "-")}</p>
                    </div>
                    <div>
                      <span>{text.status}</span>
                      <Badge
                        className="project-status-badge"
                        data-status={team.status}
                        variant="outline"
                      >
                        {formatTeamStatus(team.status)}
                      </Badge>
                    </div>
                    <span className="team-row-more" aria-hidden="true">
                      <MoreHorizontal aria-hidden="true" />
                    </span>
                  </div>
                  {isExpanded ? (
                    <div className="team-row-detail">
                      <dl className="team-row-detail-meta">
                        {[
                          [text.projectCount, String(team.projectCount)],
                          [text.created, formatDateTime(team.createdAt)],
                          [text.updated, formatDateTime(team.updatedAt)]
                        ].map(([label, value]) => (
                          <div key={label}>
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                          </div>
                        ))}
                      </dl>
                      <div className="team-row-main">
                        <label className="policy-field team-name-field">
                          <span>{text.name}</span>
                          <input
                            maxLength={120}
                            onChange={(event) =>
                              updateRow(team.id, { name: event.target.value })
                            }
                            type="text"
                            value={rowValues.name}
                          />
                        </label>
                        <label className="policy-field team-description-field">
                          <span>{text.description}</span>
                          <textarea
                            maxLength={500}
                            onChange={(event) =>
                              updateRow(team.id, { description: event.target.value })
                            }
                            value={rowValues.description}
                          />
                        </label>
                        <label className="policy-field team-status-field">
                          <span>{text.status}</span>
                          <select
                            onChange={(event) =>
                              updateRow(team.id, {
                                status: event.target.value as TeamStatus
                              })
                            }
                            value={rowValues.status}
                          >
                            {teamStatuses.map((status) => (
                              <option key={status} value={status}>
                                {formatTeamStatus(status)}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                      <div className="team-row-actions">
                        <Button
                          className="team-save-button"
                          disabled={pendingAction !== null}
                          onClick={() => void submitUpdateTeam(team.id)}
                          type="button"
                          variant="outline"
                        >
                          <Save aria-hidden="true" />
                          {pendingAction === `update:${team.id}` ? "..." : text.save}
                        </Button>
                        <Button
                          className="team-delete-button"
                          disabled={pendingAction !== null}
                          onClick={() =>
                            void submitUpdateTeam(team.id, {
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
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
      </section>

      {isCreateModalOpen ? (
        <TeamCreateModal
          createValues={createValues}
          locale={locale}
          onChange={(values) =>
            setCreateValues((current) => ({
              ...current,
              ...values
            }))
          }
          onClose={() => setIsCreateModalOpen(false)}
          onSubmit={submitCreateTeam}
          pendingAction={pendingAction}
        />
      ) : null}
    </main>
  );
}

export function TeamCreateModal({
  createValues,
  locale,
  onChange,
  onClose,
  onSubmit,
  pendingAction
}: TeamCreateModalProps) {
  const text = teamText[locale];

  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (pendingAction !== "create") {
          onClose();
        }
      }}
      role="presentation"
    >
      <section
        aria-labelledby="team-create-title"
        aria-modal="true"
        className="modal-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="panel-heading">
          <div>
            <p className="console-kicker">{text.management}</p>
            <h3 id="team-create-title">{text.create}</h3>
            <p>{text.createDescription}</p>
          </div>
        </div>
        <div className="modal-form-grid">
          <label className="policy-field">
            <span>{text.name}</span>
            <input
              autoFocus
              maxLength={120}
              onChange={(event) => onChange({ name: event.target.value })}
              type="text"
              value={createValues.name}
            />
          </label>
          <label className="policy-field">
            <span>{text.description}</span>
            <input
              maxLength={500}
              onChange={(event) => onChange({ description: event.target.value })}
              type="text"
              value={createValues.description}
            />
          </label>
        </div>
        <div className="modal-actions">
          <Button
            disabled={pendingAction === "create"}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            {text.cancel}
          </Button>
          <Button
            disabled={pendingAction !== null || createValues.name.trim().length === 0}
            onClick={() => void onSubmit()}
            type="button"
          >
            <Plus aria-hidden="true" />
            {pendingAction === "create" ? "..." : text.create}
          </Button>
        </div>
      </section>
    </div>
  );
}

export function ProjectTeamAssignment({ locale, model }: ProjectTeamAssignmentProps) {
  const router = useRouter();
  const text = teamText[locale];
  const [attachedTeams, setAttachedTeams] = useState<ProjectTeamRecord[]>(model.attachedTeams);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const attachedTeamIds = useMemo(
    () => new Set(attachedTeams.map((projectTeam) => projectTeam.teamId)),
    [attachedTeams]
  );
  const assignableTeams = model.availableTeams.filter(
    (team) => team.status === "ACTIVE" && !attachedTeamIds.has(team.id)
  );
  const [selectedTeamId, setSelectedTeamId] = useState("");

  async function submitAttachTeam() {
    if (!selectedTeamId) {
      return;
    }

    setPendingAction("attach");
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/teams", {
      body: JSON.stringify({
        action: "attach",
        values: {
          projectId: model.projectId,
          teamId: selectedTeamId
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProjectTeamResponsePayload;

    if (!response.ok || !payload.projectTeam) {
      setSubmitState({
        message: payload.error ?? "Team attach failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    setAttachedTeams((current) => [...current, payload.projectTeam as ProjectTeamRecord]);
    setSelectedTeamId("");
    setSubmitState({
      message: locale === "ko" ? "팀이 Project에 연결되었습니다." : "Team attached.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function submitDetachTeam(teamId: string) {
    setPendingAction(`detach:${teamId}`);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/teams", {
      body: JSON.stringify({
        action: "detach",
        values: {
          projectId: model.projectId,
          teamId
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProjectTeamResponsePayload;

    if (!response.ok || !payload.projectTeam) {
      setSubmitState({
        message: payload.error ?? "Team remove failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    setAttachedTeams((current) => current.filter((item) => item.teamId !== teamId));
    setSubmitState({
      message: locale === "ko" ? "팀 연결이 제거되었습니다." : "Team removed.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  return (
    <main className="console-content management-line-content">
      <section className="team-section">
        <div className="team-section-header team-section-header-with-actions">
          <div>
            <h3>{text.attachedTeams}</h3>
            <p>{text.projectTeamsDescription}</p>
          </div>
          <div className="team-attach-controls">
            <select
              aria-label={text.selectTeam}
              disabled={pendingAction !== null || assignableTeams.length === 0}
              onChange={(event) => setSelectedTeamId(event.target.value)}
              value={selectedTeamId}
            >
              <option value="">{text.selectTeam}</option>
              {assignableTeams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
            <button
              className="primary-button"
              disabled={pendingAction !== null || !selectedTeamId}
              onClick={() => void submitAttachTeam()}
              type="button"
            >
              <Users aria-hidden="true" />
              {pendingAction === "attach" ? "..." : text.attach}
            </button>
          </div>
        </div>

      {model.source === "fixture" ? (
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

      {attachedTeams.length === 0 ? (
        <p className="project-empty">
          {assignableTeams.length === 0 ? text.noAssignableTeam : text.empty}
        </p>
      ) : (
        <div className="team-list team-list-compact">
          {attachedTeams.map((projectTeam) => (
            <article className="team-row team-row-attached" key={projectTeam.id}>
              <div>
                <strong>{projectTeam.teamName}</strong>
                <p>{nullableText(projectTeam.teamDescription, "-")}</p>
              </div>
              <Badge
                className="project-status-badge"
                data-status={projectTeam.teamStatus}
                variant="outline"
              >
                {formatTeamStatus(projectTeam.teamStatus)}
              </Badge>
              <span className="team-row-assigned">
                {text.assigned}: <strong>{formatDateTime(projectTeam.assignedAt)}</strong>
              </span>
              <Button
                className="team-delete-button"
                disabled={pendingAction !== null}
                onClick={() => void submitDetachTeam(projectTeam.teamId)}
                type="button"
                variant="outline"
              >
                <Trash2 aria-hidden="true" />
                {pendingAction === `detach:${projectTeam.teamId}` ? "..." : text.remove}
              </Button>
            </article>
          ))}
        </div>
      )}
      </section>
    </main>
  );
}

function getTeamUpdateValues(team: TeamRecord): TeamUpdateValues {
  return {
    description: nullableText(team.description, ""),
    name: team.name,
    status: team.status,
    teamId: team.id
  };
}

function formatTeamStatus(status: TeamStatus) {
  return status.toLowerCase();
}
