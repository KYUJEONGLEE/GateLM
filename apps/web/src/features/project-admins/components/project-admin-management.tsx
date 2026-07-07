"use client";

import { Copy, Search, Trash2, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import type {
  ProjectAdminInvitationRecord,
  ProjectAdminRecord,
  ProjectAdminsModel
} from "@/lib/control-plane/project-admins-types";
import { formatDateTime } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type ProjectAdminManagementProps = {
  locale: Locale;
  model: ProjectAdminsModel;
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type ProjectAdminActionPayload = {
  error?: string;
  invitation?: ProjectAdminInvitationRecord;
  projectAdmin?: ProjectAdminRecord;
  status?: number;
};

const projectAdminText: Record<
  Locale,
  {
    active: string;
    assigned: string;
    connectedAt: string;
    copy: string;
    empty: string;
    fixtureFallback: string;
    invite: string;
    inviteEmail: string;
    inviteName: string;
    inviteLink: string;
    invited: string;
    manager: string;
    pending: string;
    remove: string;
    role: string;
    roleName: string;
    search: string;
    status: string;
    submitInvite: string;
    title: string;
    action: string;
  }
> = {
  en: {
    active: "Active",
    assigned: "Project admin added.",
    connectedAt: "Connected",
    copy: "Copy",
    empty: "No project admins yet.",
    fixtureFallback: "Control Plane unavailable. Showing fixture project admins.",
    invite: "Invite admin",
    inviteEmail: "Admin email",
    inviteName: "Admin name",
    inviteLink: "Invitation link",
    invited: "Invitation email sent.",
    manager: "Admin",
    pending: "Pending",
    remove: "Remove",
    role: "Role",
    roleName: "Project admin",
    search: "Search by name",
    status: "Status",
    submitInvite: "Send invite",
    title: "Project admins",
    action: "Action"
  },
  ko: {
    active: "활성",
    assigned: "프로젝트 관리자로 추가되었습니다.",
    connectedAt: "연결일",
    copy: "복사",
    empty: "프로젝트 관리자가 없습니다.",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 프로젝트 관리자를 표시 중입니다.",
    invite: "관리자 초대",
    inviteEmail: "관리자 이메일",
    inviteName: "관리자 이름",
    inviteLink: "초대 링크",
    invited: "초대 메일을 발송했습니다.",
    manager: "관리자",
    pending: "대기중",
    remove: "제거",
    role: "역할",
    roleName: "프로젝트 관리자",
    search: "이름으로 검색",
    status: "상태",
    submitInvite: "초대 메일 발송",
    title: "프로젝트 관리자",
    action: "작업"
  }
};

export function ProjectAdminManagement({ locale, model }: ProjectAdminManagementProps) {
  const router = useRouter();
  const text = projectAdminText[locale];
  const [projectAdmins, setProjectAdmins] = useState<ProjectAdminRecord[]>(model.projectAdmins);
  const [query, setQuery] = useState("");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [lastInviteUrl, setLastInviteUrl] = useState("");
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });

  const visibleProjectAdmins = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
      return projectAdmins;
    }

    return projectAdmins.filter((projectAdmin) => {
      return (
        projectAdmin.name.toLowerCase().includes(normalizedQuery)
      );
    });
  }, [projectAdmins, query]);

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = inviteEmail.trim();
    const name = inviteName.trim();

    if (!email || !name) {
      return;
    }

    setPendingAction("invite");
    setSubmitState({ message: "", status: "idle" });
    setLastInviteUrl("");

    const response = await fetch("/api/control-plane/project-admins", {
      body: JSON.stringify({
        action: "invite",
        values: {
          email,
          name,
          projectId: model.projectId
        }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProjectAdminActionPayload;

    if (!response.ok || (!payload.invitation && !payload.projectAdmin)) {
      setSubmitState({
        message: payload.error ?? "Project admin invitation failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    if (payload.projectAdmin) {
      setProjectAdmins((current) => [
        ...current.filter((item) => item.id !== payload.projectAdmin?.id),
        payload.projectAdmin as ProjectAdminRecord
      ]);
      setInviteEmail("");
      setInviteName("");
      setLastInviteUrl("");
      setSubmitState({ message: text.assigned, status: "success" });
      setPendingAction(null);
      router.refresh();
      return;
    }

    const pendingProjectAdmin = toPendingProjectAdmin(payload.invitation as ProjectAdminInvitationRecord);
    setProjectAdmins((current) => [
      ...current.filter((item) => item.id !== pendingProjectAdmin.id),
      pendingProjectAdmin
    ]);
    setInviteEmail("");
    setInviteName("");
    setLastInviteUrl((payload.invitation as ProjectAdminInvitationRecord).signupUrl);
    setSubmitState({ message: text.invited, status: "success" });
    setPendingAction(null);
    router.refresh();
  }
  async function removeProjectAdmin(projectAdmin: ProjectAdminRecord) {
    const action = projectAdmin.invitationId ? "revokeInvitation" : "remove";
    const pendingKey = `${action}:${projectAdmin.id}`;
    setPendingAction(pendingKey);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/project-admins", {
      body: JSON.stringify({
        action,
        values: projectAdmin.invitationId
          ? { invitationId: projectAdmin.invitationId, projectId: projectAdmin.projectId }
          : { projectId: model.projectId, userId: projectAdmin.userId }
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProjectAdminActionPayload;

    if (!response.ok) {
      setSubmitState({
        message: payload.error ?? "Project admin remove failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    setProjectAdmins((current) => current.filter((item) => item.id !== projectAdmin.id));
    setSubmitState({ message: locale === "ko" ? "프로젝트 관리자에서 제거했습니다." : "Project admin removed.", status: "success" });
    setPendingAction(null);
    router.refresh();
  }

  async function copyInviteUrl() {
    if (!lastInviteUrl) {
      return;
    }

    await navigator.clipboard?.writeText(lastInviteUrl).catch(() => undefined);
  }

  return (
    <main className="console-content management-line-content project-admin-content">
      <section className="project-admin-section">
        <div className="project-admin-heading-row">
          <h3>{text.title}</h3>
        </div>

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

        <div className="project-admin-toolbar">
          <label className="project-admin-search">
            <Search aria-hidden="true" />
            <input
              aria-label={text.search}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={text.search}
              type="search"
              value={query}
            />
          </label>
          <button
            className="primary-button project-admin-invite-button"
            onClick={() => setIsInviteOpen((current) => !current)}
            type="button"
          >
            <UserPlus aria-hidden="true" />
            {text.invite}
          </button>
        </div>

        {isInviteOpen ? (
          <form className="project-admin-invite-form" onSubmit={submitInvite}>
            <label>
              <span>{text.inviteName}</span>
              <input
                autoComplete="name"
                onChange={(event) => setInviteName(event.target.value)}
                placeholder={text.inviteName}
                required
                type="text"
                value={inviteName}
              />
            </label>
            <label>
              <span>{text.inviteEmail}</span>
              <input
                autoComplete="email"
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="name@example.com"
                required
                type="email"
                value={inviteEmail}
              />
            </label>
            <button className="primary-button" disabled={pendingAction !== null} type="submit">
              <UserPlus aria-hidden="true" />
              {pendingAction === "invite" ? "..." : text.submitInvite}
            </button>
          </form>
        ) : null}
        {lastInviteUrl ? (
          <div className="project-admin-invite-link">
            <span>{text.inviteLink}</span>
            <input readOnly value={lastInviteUrl} />
            <button className="secondary-button" onClick={() => void copyInviteUrl()} type="button">
              <Copy aria-hidden="true" />
              {text.copy}
            </button>
          </div>
        ) : null}

        <div className="project-admin-table-wrap">
          <table className="project-admin-table">
            <thead>
              <tr>
                <th>{text.manager}</th>
                <th>{text.status}</th>
                <th>{text.connectedAt}</th>
                <th>{text.role}</th>
                <th>{text.action}</th>
              </tr>
            </thead>
            <tbody>
              {visibleProjectAdmins.length === 0 ? (
                <tr>
                  <td colSpan={5}>{text.empty}</td>
                </tr>
              ) : (
                visibleProjectAdmins.map((projectAdmin) => {
                  const pendingKey = `${projectAdmin.invitationId ? "revokeInvitation" : "remove"}:${projectAdmin.id}`;

                  return (
                    <tr key={projectAdmin.id}>
                      <td>
                        <strong>{projectAdmin.name}</strong>
                      </td>
                      <td>
                        <Badge
                          className="project-admin-status-badge"
                          data-status={projectAdmin.status}
                          variant="outline"
                        >
                          {projectAdmin.status === "active" ? text.active : text.pending}
                        </Badge>
                      </td>
                      <td>{formatDateTime(projectAdmin.connectedAt)}</td>
                      <td>{text.roleName}</td>
                      <td>
                        <button
                          className="project-admin-remove-button"
                          disabled={pendingAction !== null}
                          onClick={() => void removeProjectAdmin(projectAdmin)}
                          type="button"
                        >
                          <Trash2 aria-hidden="true" />
                          {pendingAction === pendingKey ? "..." : text.remove}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <p className="project-admin-summary">
          {locale === "ko"
            ? projectAdmins.length + "명의 프로젝트 관리자가 이 프로젝트를 관리하고 있습니다."
            : projectAdmins.length + " project admins manage this project."}
        </p>
      </section>
    </main>
  );
}

function toPendingProjectAdmin(invitation: ProjectAdminInvitationRecord): ProjectAdminRecord {
  return {
    connectedAt: new Date().toISOString(),
    email: invitation.email,
    id: `project-admin-invitation:${invitation.invitationId}`,
    invitationId: invitation.invitationId,
    name: invitation.name,
    projectAdminId: null,
    projectId: invitation.projectId,
    role: "project_admin",
    status: "pending",
    tenantId: invitation.tenantId,
    userId: null
  };
}



