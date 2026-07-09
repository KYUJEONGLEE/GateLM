"use client";

import { Save, Upload, UserPlus, Users, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, type ChangeEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type {
  EmployeeControlModel,
  EmployeeCreateValues,
  EmployeeCsvImportResult,
  EmployeeRecord,
  ProjectEmployeeAssignmentRecord,
  ProjectEmployeeAssignmentValues
} from "@/lib/control-plane/employees-types";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type EmployeeControlManagementProps = {
  locale: Locale;
  model: EmployeeControlModel;
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type EmployeeResponsePayload = {
  employee?: EmployeeRecord;
  error?: string;
};

type EmployeeImportResponsePayload = {
  error?: string;
  importResult?: EmployeeCsvImportResult;
};

type ProjectEmployeeResponsePayload = {
  assignment?: ProjectEmployeeAssignmentRecord;
  error?: string;
};

const emptyCreateValues: EmployeeCreateValues = {
  department: "",
  email: "",
  jobTitle: "",
  name: ""
};

const employeeText: Record<
  Locale,
  {
    allocation: string;
    assigned: string;
    budget: string;
    cancel: string;
    created: string;
    csv: string;
    department: string;
    disable: string;
    email: string;
    employees: string;
    fixtureFallback: string;
    import: string;
    imported: string;
    invitation: string;
    jobTitle: string;
    management: string;
    modelKeys: string;
    name: string;
    noAssignments: string;
    noEmployees: string;
    note: string;
    project: string;
    providerIds: string;
    remaining: string;
    save: string;
    staged: string;
    status: string;
    title: string;
    warning: string;
  }
> = {
  en: {
    allocation: "Project allocation",
    assigned: "Assigned",
    budget: "Monthly limit",
    cancel: "Cancel",
    created: "Created",
    csv: "CSV",
    department: "Department",
    disable: "Disable",
    email: "Email",
    employees: "Employees",
    fixtureFallback: "Control Plane unavailable. Showing fixture employees.",
    import: "Import",
    imported: "Imported",
    invitation: "Invite",
    jobTitle: "Job title",
    management: "management",
    modelKeys: "Models",
    name: "Name",
    noAssignments: "No project employees.",
    noEmployees: "No employees.",
    note: "Note",
    project: "Project",
    providerIds: "Providers",
    remaining: "Remaining",
    save: "Save",
    staged: "Staged",
    status: "Status",
    title: "Employee Control",
    warning: "Warning"
  },
  ko: {
    allocation: "Project 배정",
    assigned: "배정",
    budget: "월 한도",
    cancel: "취소",
    created: "생성",
    csv: "CSV",
    department: "부서",
    disable: "비활성화",
    email: "이메일",
    employees: "직원",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 직원을 표시 중입니다.",
    import: "등록",
    imported: "등록됨",
    invitation: "초대",
    jobTitle: "직책",
    management: "관리",
    modelKeys: "모델",
    name: "이름",
    noAssignments: "Project에 배정된 직원이 없습니다.",
    noEmployees: "직원이 없습니다.",
    note: "메모",
    project: "Project",
    providerIds: "Provider",
    remaining: "잔여",
    save: "저장",
    staged: "대기",
    status: "상태",
    title: "직원 통제",
    warning: "경고"
  }
};

export function EmployeeControlManagement({ locale, model }: EmployeeControlManagementProps) {
  const router = useRouter();
  const text = employeeText[locale];
  const [employees, setEmployees] = useState<EmployeeRecord[]>(model.employees);
  const [csvText, setCsvText] = useState("email,name,department,jobTitle\n");
  const [defaultDepartment, setDefaultDepartment] = useState("");
  const [createValues, setCreateValues] = useState<EmployeeCreateValues>(emptyCreateValues);
  const [assignmentsByProjectId, setAssignmentsByProjectId] = useState(model.assignmentsByProjectId);
  const [selectedProjectId, setSelectedProjectId] = useState(model.projects[0]?.id ?? "");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState(model.employees[0]?.id ?? "");
  const [assignmentValues, setAssignmentValues] = useState({
    allowedModelKeys: "",
    allowedProviderConnectionIds: "",
    monthlyBudgetLimitUsd: 0,
    policyNote: "",
    warningThresholdPercent: 80
  });
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });

  const selectedProject = model.projects.find((project) => project.id === selectedProjectId) ?? null;
  const projectAssignments = assignmentsByProjectId[selectedProjectId] ?? [];
  const activeProjectAssignments = projectAssignments.filter(
    (assignment) => assignment.status === "active"
  );
  const assignedBudgetUsd = activeProjectAssignments.reduce(
    (total, assignment) => total + assignment.monthlyBudgetLimitUsd,
    0
  );
  const projectBudgetUsd = selectedProject?.totalBudgetUsd ?? 0;
  const remainingBudgetUsd = projectBudgetUsd - assignedBudgetUsd;
  const departments = useMemo(
    () => [...new Set(employees.map((employee) => employee.department).filter(Boolean))] as string[],
    [employees]
  );

  async function handleCsvFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setCsvText(await file.text());
  }

  async function submitImportCsv() {
    if (!csvText.trim()) {
      setSubmitState({
        message: locale === "ko" ? "CSV 내용을 입력하세요." : "CSV content is required.",
        status: "error"
      });
      return;
    }

    setPendingAction("importCsv");
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/employees", {
      body: JSON.stringify({
        action: "importCsv",
        values: {
          csvText,
          defaultDepartment,
          tenantId: model.controlPlaneTenantId
        }
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as EmployeeImportResponsePayload;

    if (!response.ok || !payload.importResult) {
      setSubmitState({
        message: payload.error ?? "Employee import failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    mergeEmployees(payload.importResult.employees);
    setSubmitState({
      message:
        locale === "ko"
          ? `${payload.importResult.createdCount}명 생성, ${payload.importResult.updatedCount}명 수정`
          : `${payload.importResult.createdCount} created, ${payload.importResult.updatedCount} updated`,
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function submitCreateEmployee() {
    if (!createValues.email.trim()) {
      setSubmitState({
        message: locale === "ko" ? "이메일을 입력하세요." : "Email is required.",
        status: "error"
      });
      return;
    }

    setPendingAction("create");
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/employees", {
      body: JSON.stringify({
        action: "create",
        values: {
          ...createValues,
          tenantId: model.controlPlaneTenantId
        }
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as EmployeeResponsePayload;

    if (!response.ok || !payload.employee) {
      setSubmitState({
        message: payload.error ?? "Employee creation failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    mergeEmployees([payload.employee]);
    if (!selectedEmployeeId) {
      setSelectedEmployeeId(payload.employee.id);
    }
    setCreateValues(emptyCreateValues);
    setSubmitState({
      message: locale === "ko" ? "직원이 생성되었습니다." : "Employee created.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function submitAssignment() {
    if (!selectedProjectId || !selectedEmployeeId) {
      return;
    }

    const values: ProjectEmployeeAssignmentValues = {
      allowedModelKeys: splitCommaList(assignmentValues.allowedModelKeys),
      allowedProviderConnectionIds: splitCommaList(assignmentValues.allowedProviderConnectionIds),
      employeeId: selectedEmployeeId,
      monthlyBudgetLimitUsd: assignmentValues.monthlyBudgetLimitUsd,
      policyNote: assignmentValues.policyNote,
      projectId: selectedProjectId,
      status: "active",
      warningThresholdPercent: assignmentValues.warningThresholdPercent
    };

    setPendingAction("assign");
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/employees", {
      body: JSON.stringify({ action: "assign", values }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProjectEmployeeResponsePayload;

    if (!response.ok || !payload.assignment) {
      setSubmitState({
        message: payload.error ?? "Project employee assignment failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    setAssignmentsByProjectId((current) => ({
      ...current,
      [selectedProjectId]: upsertAssignment(current[selectedProjectId] ?? [], payload.assignment)
    }));
    setSubmitState({
      message: locale === "ko" ? "직원 한도가 저장되었습니다." : "Employee limit saved.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function disableAssignment(assignment: ProjectEmployeeAssignmentRecord) {
    setPendingAction(`disable:${assignment.id}`);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/employees", {
      body: JSON.stringify({
        action: "disableAssignment",
        values: {
          employeeId: assignment.employeeId,
          projectId: assignment.projectId
        }
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as ProjectEmployeeResponsePayload;

    if (!response.ok || !payload.assignment) {
      setSubmitState({
        message: payload.error ?? "Project employee disable failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    setAssignmentsByProjectId((current) => ({
      ...current,
      [assignment.projectId]: upsertAssignment(current[assignment.projectId] ?? [], payload.assignment)
    }));
    setSubmitState({
      message: locale === "ko" ? "배정이 비활성화되었습니다." : "Assignment disabled.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  function mergeEmployees(nextEmployees: EmployeeRecord[]) {
    setEmployees((current) => {
      const byId = new Map(current.map((employee) => [employee.id, employee]));
      for (const employee of nextEmployees) {
        byId.set(employee.id, employee);
      }
      return [...byId.values()].sort((left, right) => left.email.localeCompare(right.email));
    });
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
            <h3>{text.csv}</h3>
          </div>
          <label className="primary-button" htmlFor="employee-csv-file">
            <Upload aria-hidden="true" />
            CSV
          </label>
          <input
            accept=".csv,text/csv"
            className="sr-only"
            id="employee-csv-file"
            onChange={(event) => void handleCsvFile(event)}
            type="file"
          />
        </div>
        <div className="modal-form-grid">
          <label className="policy-field">
            <span>{text.department}</span>
            <input
              maxLength={120}
              onChange={(event) => setDefaultDepartment(event.target.value)}
              type="text"
              value={defaultDepartment}
            />
          </label>
          <label className="policy-field team-description-field">
            <span>{text.csv}</span>
            <textarea
              onChange={(event) => setCsvText(event.target.value)}
              rows={5}
              value={csvText}
            />
          </label>
        </div>
        <div className="modal-actions">
          <Button
            disabled={pendingAction !== null || csvText.trim().length === 0}
            onClick={() => void submitImportCsv()}
            type="button"
          >
            <Upload aria-hidden="true" />
            {pendingAction === "importCsv" ? "..." : text.import}
          </Button>
        </div>
      </section>

      <section className="team-section">
        <div className="team-section-header">
          <div>
            <h3>{text.employees}</h3>
          </div>
        </div>
        <div className="modal-form-grid">
          <label className="policy-field">
            <span>{text.email}</span>
            <input
              maxLength={320}
              onChange={(event) => setCreateValues((current) => ({ ...current, email: event.target.value }))}
              type="email"
              value={createValues.email}
            />
          </label>
          <label className="policy-field">
            <span>{text.name}</span>
            <input
              maxLength={120}
              onChange={(event) => setCreateValues((current) => ({ ...current, name: event.target.value }))}
              type="text"
              value={createValues.name}
            />
          </label>
          <label className="policy-field">
            <span>{text.department}</span>
            <input
              list="employee-departments"
              maxLength={120}
              onChange={(event) => setCreateValues((current) => ({ ...current, department: event.target.value }))}
              type="text"
              value={createValues.department}
            />
          </label>
          <label className="policy-field">
            <span>{text.jobTitle}</span>
            <input
              maxLength={120}
              onChange={(event) => setCreateValues((current) => ({ ...current, jobTitle: event.target.value }))}
              type="text"
              value={createValues.jobTitle}
            />
          </label>
        </div>
        <datalist id="employee-departments">
          {departments.map((department) => (
            <option key={department} value={department} />
          ))}
        </datalist>
        <div className="modal-actions">
          <Button
            disabled={pendingAction !== null || createValues.email.trim().length === 0}
            onClick={() => void submitCreateEmployee()}
            type="button"
          >
            <UserPlus aria-hidden="true" />
            {pendingAction === "create" ? "..." : text.save}
          </Button>
        </div>

        {employees.length === 0 ? (
          <p className="project-empty">{text.noEmployees}</p>
        ) : (
          <div className="team-list">
            {employees.map((employee) => (
              <article className="team-row" key={employee.id}>
                <div className="team-row-summary">
                  <div>
                    <span>{text.email}</span>
                    <strong>{employee.email}</strong>
                  </div>
                  <div>
                    <span>{text.name}</span>
                    <p>{nullableText(employee.name, "-")}</p>
                  </div>
                  <div>
                    <span>{text.department}</span>
                    <p>{nullableText(employee.department, "-")}</p>
                  </div>
                  <div>
                    <span>{text.status}</span>
                    <Badge variant="outline">{formatEmployeeStatus(employee.status, locale)}</Badge>
                  </div>
                  <div>
                    <span>{text.invitation}</span>
                    <Badge variant="outline">{formatInvitationStatus(employee.invitationStatus, locale)}</Badge>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="team-section">
        <div className="team-section-header">
          <div>
            <h3>{text.allocation}</h3>
          </div>
          <div className="project-budget-badge" data-budget-state={remainingBudgetUsd < 0 ? "over" : "ok"}>
            <Wallet aria-hidden="true" size={16} />
            {formatBudgetUsd(assignedBudgetUsd)} / {formatBudgetUsd(projectBudgetUsd)}
          </div>
        </div>
        <div className="modal-form-grid">
          <label className="policy-field">
            <span>{text.project}</span>
            <select
              onChange={(event) => setSelectedProjectId(event.target.value)}
              value={selectedProjectId}
            >
              {model.projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <label className="policy-field">
            <span>{text.employees}</span>
            <select
              onChange={(event) => setSelectedEmployeeId(event.target.value)}
              value={selectedEmployeeId}
            >
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.email}
                </option>
              ))}
            </select>
          </label>
          <label className="policy-field">
            <span>{text.budget}</span>
            <input
              min={0}
              onChange={(event) =>
                setAssignmentValues((current) => ({
                  ...current,
                  monthlyBudgetLimitUsd: Number(event.target.value)
                }))
              }
              step="0.01"
              type="number"
              value={assignmentValues.monthlyBudgetLimitUsd}
            />
          </label>
          <label className="policy-field">
            <span>{text.warning}</span>
            <input
              max={100}
              min={0}
              onChange={(event) =>
                setAssignmentValues((current) => ({
                  ...current,
                  warningThresholdPercent: Number(event.target.value)
                }))
              }
              type="number"
              value={assignmentValues.warningThresholdPercent}
            />
          </label>
          <label className="policy-field">
            <span>{text.modelKeys}</span>
            <input
              onChange={(event) =>
                setAssignmentValues((current) => ({ ...current, allowedModelKeys: event.target.value }))
              }
              type="text"
              value={assignmentValues.allowedModelKeys}
            />
          </label>
          <label className="policy-field">
            <span>{text.providerIds}</span>
            <input
              onChange={(event) =>
                setAssignmentValues((current) => ({
                  ...current,
                  allowedProviderConnectionIds: event.target.value
                }))
              }
              type="text"
              value={assignmentValues.allowedProviderConnectionIds}
            />
          </label>
          <label className="policy-field team-description-field">
            <span>{text.note}</span>
            <input
              maxLength={500}
              onChange={(event) =>
                setAssignmentValues((current) => ({ ...current, policyNote: event.target.value }))
              }
              type="text"
              value={assignmentValues.policyNote}
            />
          </label>
        </div>
        <div className="modal-actions">
          <span className="application-budget-summary">
            {text.remaining}: {formatBudgetUsd(remainingBudgetUsd)}
          </span>
          <Button
            disabled={pendingAction !== null || !selectedProjectId || !selectedEmployeeId}
            onClick={() => void submitAssignment()}
            type="button"
          >
            <Save aria-hidden="true" />
            {pendingAction === "assign" ? "..." : text.save}
          </Button>
        </div>

        {projectAssignments.length === 0 ? (
          <p className="project-empty">{text.noAssignments}</p>
        ) : (
          <div className="team-list">
            {projectAssignments.map((assignment) => (
              <article className="team-row" key={assignment.id}>
                <div className="team-row-summary">
                  <div>
                    <span>{text.email}</span>
                    <strong>{assignment.employeeEmail}</strong>
                  </div>
                  <div>
                    <span>{text.department}</span>
                    <p>{nullableText(assignment.employeeDepartment, "-")}</p>
                  </div>
                  <div>
                    <span>{text.budget}</span>
                    <p>{formatBudgetUsd(assignment.monthlyBudgetLimitUsd)}</p>
                  </div>
                  <div>
                    <span>{text.modelKeys}</span>
                    <p>{assignment.policy.allowedModelKeys.join(", ") || "-"}</p>
                  </div>
                  <div>
                    <span>{text.created}</span>
                    <p>{formatDateTime(assignment.createdAt)}</p>
                  </div>
                  <Button
                    disabled={pendingAction !== null || assignment.status === "disabled"}
                    onClick={() => void disableAssignment(assignment)}
                    type="button"
                    variant="outline"
                  >
                    <Users aria-hidden="true" />
                    {pendingAction === `disable:${assignment.id}` ? "..." : text.disable}
                  </Button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function upsertAssignment(
  assignments: ProjectEmployeeAssignmentRecord[],
  nextAssignment: ProjectEmployeeAssignmentRecord
) {
  const existingIndex = assignments.findIndex(
    (assignment) => assignment.employeeId === nextAssignment.employeeId
  );

  if (existingIndex < 0) {
    return [...assignments, nextAssignment];
  }

  return assignments.map((assignment, index) =>
    index === existingIndex ? nextAssignment : assignment
  );
}

function splitCommaList(value: string): string[] {
  return [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
}

function formatBudgetUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency"
  }).format(value);
}

function formatEmployeeStatus(status: EmployeeRecord["status"], locale: Locale) {
  const labels: Record<EmployeeRecord["status"], Record<Locale, string>> = {
    active: { en: "Active", ko: "활성" },
    archived: { en: "Archived", ko: "보관" },
    staged: { en: "Staged", ko: "대기" },
    suspended: { en: "Suspended", ko: "중지" }
  };

  return labels[status][locale];
}

function formatInvitationStatus(status: EmployeeRecord["invitationStatus"], locale: Locale) {
  const labels: Record<EmployeeRecord["invitationStatus"], Record<Locale, string>> = {
    accepted: { en: "Accepted", ko: "완료" },
    not_sent: { en: "Not sent", ko: "미발송" },
    pending: { en: "Pending", ko: "대기" },
    revoked: { en: "Revoked", ko: "취소" }
  };

  return labels[status][locale];
}
