"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Save,
  Upload,
  UserPlus,
  Users,
  Wallet
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
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
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type EmployeeControlManagementProps = {
  locale: Locale;
  model: EmployeeControlModel;
};

type ProjectEmployeeAssignmentProps = {
  locale: Locale;
  model: EmployeeControlModel;
  project: ProjectRecord;
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type EmployeeSortDirection = "asc" | "desc";
type EmployeeSortField = "department" | "email" | "invitation" | "name" | "project";

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
    addTab: string;
    allocation: string;
    assigned: string;
    budget: string;
    cancel: string;
    created: string;
    csv: string;
    department: string;
    disable: string;
    email: string;
    employeeAddTitle: string;
    employees: string;
    fixtureFallback: string;
    import: string;
    imported: string;
    invitation: string;
    inviteSend: string;
    jobTitle: string;
    listTab: string;
    management: string;
    modelKeys: string;
    name: string;
    next: string;
    noAssignments: string;
    noEmployees: string;
    note: string;
    page: string;
    previous: string;
    project: string;
    projectCount: string;
    providerIds: string;
    remaining: string;
    save: string;
    sortBy: string;
    sortDepartment: string;
    sortName: string;
    sortProject: string;
    staged: string;
    status: string;
    title: string;
    warning: string;
  }
> = {
  en: {
    addTab: "Add employees",
    allocation: "Project allocation",
    assigned: "Assigned",
    budget: "Monthly limit",
    cancel: "Cancel",
    created: "Created",
    csv: "CSV",
    department: "Department",
    disable: "Disable",
    email: "Email",
    employeeAddTitle: "Individual invite",
    employees: "Employees",
    fixtureFallback: "Control Plane unavailable. Showing fixture employees.",
    import: "Import",
    imported: "Imported",
    invitation: "Invite",
    inviteSend: "Add invitee",
    jobTitle: "Job title",
    listTab: "Employee list",
    management: "management",
    modelKeys: "Models",
    name: "Name",
    next: "Next",
    noAssignments: "No project employees.",
    noEmployees: "No employees.",
    note: "Note",
    page: "Page",
    previous: "Previous",
    project: "Project",
    projectCount: "Projects",
    providerIds: "Providers",
    remaining: "Remaining",
    save: "Save",
    sortBy: "Sort",
    sortDepartment: "Department",
    sortName: "Name",
    sortProject: "Project",
    staged: "Staged",
    status: "Status",
    title: "Employee Control",
    warning: "Warning"
  },
  ko: {
    addTab: "직원 추가",
    allocation: "Project 배정",
    assigned: "배정",
    budget: "월 한도",
    cancel: "취소",
    created: "생성",
    csv: "CSV",
    department: "부서",
    disable: "비활성화",
    email: "이메일",
    employeeAddTitle: "개별 초대",
    employees: "직원",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 직원을 표시 중입니다.",
    import: "등록",
    imported: "등록됨",
    invitation: "초대",
    inviteSend: "초대 대상 추가",
    jobTitle: "직책",
    listTab: "직원 목록",
    management: "관리",
    modelKeys: "모델",
    name: "이름",
    next: "다음",
    noAssignments: "Project에 배정된 직원이 없습니다.",
    noEmployees: "직원이 없습니다.",
    note: "메모",
    page: "페이지",
    previous: "이전",
    project: "Project",
    projectCount: "프로젝트",
    providerIds: "Provider",
    remaining: "잔여",
    save: "저장",
    sortBy: "정렬",
    sortDepartment: "부서순",
    sortName: "이름순",
    sortProject: "프로젝트순",
    staged: "대기",
    status: "상태",
    title: "직원 통제",
    warning: "경고"
  }
};

const projectEmployeeText: Record<
  Locale,
  {
    assigned: string;
    budget: string;
    department: string;
    disable: string;
    email: string;
    employees: string;
    fixtureFallback: string;
    modelKeys: string;
    noAssignments: string;
    noDepartments: string;
    noEmployees: string;
    note: string;
    providerIds: string;
    remaining: string;
    save: string;
    title: string;
    warning: string;
  }
> = {
  en: {
    assigned: "Assigned",
    budget: "Monthly limit",
    department: "Department",
    disable: "Disable",
    email: "Email",
    employees: "Employees",
    fixtureFallback: "Control Plane unavailable. Showing fixture employees.",
    modelKeys: "Models",
    noAssignments: "No project employees.",
    noDepartments: "No departments found.",
    noEmployees: "No employees in this department.",
    note: "Note",
    providerIds: "Providers",
    remaining: "Remaining",
    save: "Save",
    title: "Department employees",
    warning: "Warning"
  },
  ko: {
    assigned: "배정",
    budget: "월 한도",
    department: "부서",
    disable: "비활성화",
    email: "이메일",
    employees: "직원",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 직원을 표시 중입니다.",
    modelKeys: "모델",
    noAssignments: "Project에 배정된 직원이 없습니다.",
    noDepartments: "등록된 부서가 없습니다.",
    noEmployees: "이 부서에 배정 가능한 직원이 없습니다.",
    note: "메모",
    providerIds: "Provider",
    remaining: "잔여",
    save: "저장",
    title: "부서 직원 배정",
    warning: "경고"
  }
};

export function ProjectEmployeeAssignment({
  locale,
  model,
  project
}: ProjectEmployeeAssignmentProps) {
  const router = useRouter();
  const text = projectEmployeeText[locale];
  const departments = useMemo(
    () =>
      Array.from(
        new Set(
          model.employees
            .map((employee) => employee.department?.trim())
            .filter((department): department is string => Boolean(department))
        )
      ).sort((left, right) => left.localeCompare(right)),
    [model.employees]
  );
  const [selectedDepartment, setSelectedDepartment] = useState(departments[0] ?? "");
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [assignments, setAssignments] = useState<ProjectEmployeeAssignmentRecord[]>(
    model.assignmentsByProjectId[project.id] ?? []
  );
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

  useEffect(() => {
    if (!selectedDepartment && departments[0]) {
      setSelectedDepartment(departments[0]);
      return;
    }

    if (selectedDepartment && !departments.includes(selectedDepartment)) {
      setSelectedDepartment(departments[0] ?? "");
    }
  }, [departments, selectedDepartment]);

  const departmentEmployees = useMemo(
    () =>
      model.employees
        .filter(
          (employee) =>
            employee.department === selectedDepartment &&
            (employee.status === "active" || employee.status === "staged")
        )
        .sort((left, right) => left.email.localeCompare(right.email)),
    [model.employees, selectedDepartment]
  );

  useEffect(() => {
    if (!departmentEmployees.some((employee) => employee.id === selectedEmployeeId)) {
      setSelectedEmployeeId(departmentEmployees[0]?.id ?? "");
    }
  }, [departmentEmployees, selectedEmployeeId]);

  useEffect(() => {
    const existingAssignment = assignments.find(
      (assignment) => assignment.employeeId === selectedEmployeeId
    );

    setAssignmentValues({
      allowedModelKeys: existingAssignment?.policy.allowedModelKeys.join(", ") ?? "",
      allowedProviderConnectionIds:
        existingAssignment?.policy.allowedProviderConnectionIds.join(", ") ?? "",
      monthlyBudgetLimitUsd: existingAssignment?.monthlyBudgetLimitUsd ?? 0,
      policyNote: existingAssignment?.policy.note ?? "",
      warningThresholdPercent: existingAssignment?.warningThresholdPercent ?? 80
    });
  }, [assignments, selectedEmployeeId]);

  const activeAssignments = assignments.filter((assignment) => assignment.status === "active");
  const assignedBudgetUsd = activeAssignments.reduce(
    (total, assignment) => total + assignment.monthlyBudgetLimitUsd,
    0
  );
  const remainingBudgetUsd = project.totalBudgetUsd - assignedBudgetUsd;

  async function submitAssignment() {
    if (!selectedEmployeeId) {
      return;
    }

    const values: ProjectEmployeeAssignmentValues = {
      allowedModelKeys: splitCommaList(assignmentValues.allowedModelKeys),
      allowedProviderConnectionIds: splitCommaList(assignmentValues.allowedProviderConnectionIds),
      employeeId: selectedEmployeeId,
      monthlyBudgetLimitUsd: assignmentValues.monthlyBudgetLimitUsd,
      policyNote: assignmentValues.policyNote,
      projectId: project.id,
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

    const assignment = payload.assignment;
    setAssignments((current) => upsertAssignment(current, assignment));
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

    const disabledAssignment = payload.assignment;
    setAssignments((current) => upsertAssignment(current, disabledAssignment));
    setSubmitState({
      message: locale === "ko" ? "배정이 비활성화되었습니다." : "Assignment disabled.",
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
            <h3>{text.title}</h3>
          </div>
          <div
            className="project-budget-badge"
            data-budget-state={remainingBudgetUsd < 0 ? "over" : "ok"}
          >
            <Wallet aria-hidden="true" size={16} />
            {formatBudgetUsd(assignedBudgetUsd)} / {formatBudgetUsd(project.totalBudgetUsd)}
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

        <div className="modal-form-grid">
          <label className="policy-field">
            <span>{text.department}</span>
            <select
              disabled={pendingAction !== null || departments.length === 0}
              onChange={(event) => setSelectedDepartment(event.target.value)}
              value={selectedDepartment}
            >
              {departments.length === 0 ? (
                <option value="">{text.noDepartments}</option>
              ) : null}
              {departments.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
          </label>
          <label className="policy-field">
            <span>{text.employees}</span>
            <select
              disabled={pendingAction !== null || departmentEmployees.length === 0}
              onChange={(event) => setSelectedEmployeeId(event.target.value)}
              value={selectedEmployeeId}
            >
              {departmentEmployees.length === 0 ? (
                <option value="">{text.noEmployees}</option>
              ) : null}
              {departmentEmployees.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.name ? `${employee.name} · ${employee.email}` : employee.email}
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
                setAssignmentValues((current) => ({
                  ...current,
                  allowedModelKeys: event.target.value
                }))
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
                setAssignmentValues((current) => ({
                  ...current,
                  policyNote: event.target.value
                }))
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
            disabled={pendingAction !== null || !selectedEmployeeId}
            onClick={() => void submitAssignment()}
            type="button"
          >
            <Save aria-hidden="true" />
            {pendingAction === "assign" ? "..." : text.save}
          </Button>
        </div>

        {assignments.length === 0 ? (
          <p className="project-empty">
            {departments.length === 0 ? text.noDepartments : text.noAssignments}
          </p>
        ) : (
          <div className="team-list">
            {assignments.map((assignment) => (
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
                    <span>{text.assigned}</span>
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

export function EmployeeControlManagement({ locale, model }: EmployeeControlManagementProps) {
  const router = useRouter();
  const text = employeeText[locale];
  const [activeTab, setActiveTab] = useState<"add" | "list">("add");
  const [employees, setEmployees] = useState<EmployeeRecord[]>(model.employees);
  const [csvText, setCsvText] = useState("email,name,department,jobTitle\n");
  const [createValues, setCreateValues] = useState<EmployeeCreateValues>(emptyCreateValues);
  const [sortState, setSortState] = useState<{
    direction: EmployeeSortDirection;
    field: EmployeeSortField;
  }>({
    direction: "asc",
    field: "name"
  });
  const [pageIndex, setPageIndex] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });

  const projectNamesByEmployeeId = useMemo(() => {
    const projectsById = new Map(model.projects.map((project) => [project.id, project.name]));
    const employeeProjects = new Map<string, string[]>();

    for (const [projectId, assignments] of Object.entries(model.assignmentsByProjectId)) {
      const projectName = projectsById.get(projectId) ?? projectId;
      for (const assignment of assignments) {
        const current = employeeProjects.get(assignment.employeeId) ?? [];
        current.push(projectName);
        employeeProjects.set(assignment.employeeId, current);
      }
    }

    for (const names of employeeProjects.values()) {
      names.sort((left, right) => left.localeCompare(right));
    }

    return employeeProjects;
  }, [model.assignmentsByProjectId, model.projects]);

  const sortedEmployees = useMemo(() => {
    const nextEmployees = [...employees];

    nextEmployees.sort((left, right) => {
      let result = 0;

      if (sortState.field === "department") {
        result = compareEmployeeDepartment(left, right);
      } else if (sortState.field === "project") {
        result = compareProjectNames(
          projectNamesByEmployeeId.get(left.id),
          projectNamesByEmployeeId.get(right.id)
        );
      } else if (sortState.field === "email") {
        result = left.email.localeCompare(right.email);
      } else if (sortState.field === "invitation") {
        result = formatInvitationStatus(left.invitationStatus, locale).localeCompare(
          formatInvitationStatus(right.invitationStatus, locale)
        );
      } else {
        result = compareEmployeeName(left, right);
      }

      if (result === 0) {
        result = compareEmployeeName(left, right) || left.email.localeCompare(right.email);
      }

      return sortState.direction === "asc" ? result : -result;
    });

    return nextEmployees;
  }, [employees, locale, projectNamesByEmployeeId, sortState.direction, sortState.field]);

  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(sortedEmployees.length / pageSize));
  const currentPageEmployees = sortedEmployees.slice(
    pageIndex * pageSize,
    pageIndex * pageSize + pageSize
  );

  useEffect(() => {
    if (pageIndex >= pageCount) {
      setPageIndex(pageCount - 1);
    }
  }, [pageCount, pageIndex]);

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
          defaultDepartment: "",
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
    setPageIndex(0);
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
    if (!createValues.email.trim() || !createValues.name.trim()) {
      setSubmitState({
        message: locale === "ko" ? "이름과 이메일을 입력하세요." : "Name and email are required.",
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
    setCreateValues(emptyCreateValues);
    setPageIndex(0);
    setSubmitState({
      message: locale === "ko" ? "직원이 생성되었습니다." : "Employee created.",
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
      return [...byId.values()].sort(compareEmployeeName);
    });
  }

  function changeEmployeeSort(field: EmployeeSortField) {
    setSortState((current) => ({
      direction: current.field === field && current.direction === "asc" ? "desc" : "asc",
      field
    }));
    setPageIndex(0);
  }

  function renderEmployeeSortHeader(field: EmployeeSortField, label: string) {
    const isActive = sortState.field === field;
    const directionLabel = sortState.direction === "asc" ? "ascending" : "descending";

    return (
      <button
        aria-label={`${label} ${locale === "ko" ? "정렬" : "sort"}`}
        aria-sort={isActive ? directionLabel : "none"}
        className="employee-list-sort-button"
        data-active={isActive}
        onClick={() => changeEmployeeSort(field)}
        type="button"
      >
        <span>{label}</span>
        {isActive ? (
          sortState.direction === "asc" ? (
            <ArrowUp aria-hidden="true" size={14} />
          ) : (
            <ArrowDown aria-hidden="true" size={14} />
          )
        ) : (
          <ArrowUpDown aria-hidden="true" size={14} />
        )}
      </button>
    );
  }

  return (
    <main className="console-content employee-console">
      <section className="employee-hero">
        <div>
          <p className="console-kicker">{text.management}</p>
          <h2>{text.title}</h2>
        </div>
      </section>

      <div className="employee-tabs" role="tablist">
        <button
          aria-selected={activeTab === "add"}
          data-active={activeTab === "add"}
          onClick={() => setActiveTab("add")}
          role="tab"
          type="button"
        >
          {text.addTab}
        </button>
        <button
          aria-selected={activeTab === "list"}
          data-active={activeTab === "list"}
          onClick={() => setActiveTab("list")}
          role="tab"
          type="button"
        >
          {text.listTab}
        </button>
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

      {activeTab === "add" ? (
        <>
          <section className="employee-panel employee-csv-panel">
            <div className="employee-panel-header">
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
            <div className="employee-add-grid employee-csv-only-grid">
              <label className="policy-field employee-csv-field">
                <span>{text.csv}</span>
                <textarea
                  onChange={(event) => setCsvText(event.target.value)}
                  rows={3}
                  value={csvText}
                />
              </label>
            </div>
            <div className="employee-actions">
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

          <section className="employee-panel employee-invite-panel">
            <div className="employee-panel-header">
              <div>
                <h3>{text.employeeAddTitle}</h3>
              </div>
            </div>
            <div className="employee-invite-grid">
              <label className="policy-field">
                <span>{text.name}</span>
                <input
                  maxLength={120}
                  onChange={(event) =>
                    setCreateValues((current) => ({ ...current, name: event.target.value }))
                  }
                  type="text"
                  value={createValues.name}
                />
              </label>
              <label className="policy-field">
                <span>{text.email}</span>
                <input
                  maxLength={320}
                  onChange={(event) =>
                    setCreateValues((current) => ({ ...current, email: event.target.value }))
                  }
                  type="email"
                  value={createValues.email}
                />
              </label>
            </div>
            <div className="employee-actions">
              <Button
                disabled={
                  pendingAction !== null ||
                  createValues.email.trim().length === 0 ||
                  createValues.name.trim().length === 0
                }
                onClick={() => void submitCreateEmployee()}
                type="button"
              >
                <UserPlus aria-hidden="true" />
                {pendingAction === "create" ? "..." : text.inviteSend}
              </Button>
            </div>
          </section>
        </>
      ) : (
        <section className="employee-panel employee-list-panel">
          <div className="employee-list-toolbar">
            <div>
              <h3>{text.employees}</h3>
            </div>
          </div>

          {employees.length === 0 ? (
            <p className="project-empty">{text.noEmployees}</p>
          ) : (
            <>
              <div className="employee-list-grid">
                <div className="employee-list-header">
                  {renderEmployeeSortHeader("name", text.name)}
                  {renderEmployeeSortHeader("department", text.department)}
                  {renderEmployeeSortHeader("project", text.projectCount)}
                  {renderEmployeeSortHeader("email", text.email)}
                  {renderEmployeeSortHeader("invitation", text.invitation)}
                </div>
                <div className="employee-list">
                  {currentPageEmployees.map((employee) => {
                    const projectNames = projectNamesByEmployeeId.get(employee.id) ?? [];
                    return (
                      <article className="employee-list-row" key={employee.id}>
                        <div
                          className="employee-list-cell employee-name-cell"
                          data-label={text.name}
                        >
                          <strong>{nullableText(employee.name, employee.email)}</strong>
                        </div>
                        <div
                          className="employee-list-cell employee-department-cell"
                          data-label={text.department}
                        >
                          <p>{nullableText(employee.department, "-")}</p>
                        </div>
                        <div
                          className="employee-list-cell employee-project-cell"
                          data-label={text.projectCount}
                        >
                          <p>{projectNames.length > 0 ? projectNames.join(", ") : "-"}</p>
                        </div>
                        <div
                          className="employee-list-cell employee-email-cell"
                          data-label={text.email}
                        >
                          <p>{employee.email}</p>
                        </div>
                        <div
                          className="employee-list-cell employee-invitation-cell"
                          data-label={text.invitation}
                        >
                          <Badge variant="outline">
                            {formatInvitationStatus(employee.invitationStatus, locale)}
                          </Badge>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
              <div className="employee-pagination">
                <Button
                  disabled={pageIndex === 0}
                  onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
                  type="button"
                  variant="outline"
                >
                  {text.previous}
                </Button>
                <span className="application-budget-summary">
                  {text.page} {pageIndex + 1} / {pageCount}
                </span>
                <Button
                  disabled={pageIndex >= pageCount - 1}
                  onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
                  type="button"
                  variant="outline"
                >
                  {text.next}
                </Button>
              </div>
            </>
          )}
        </section>
      )}
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

function compareEmployeeName(left: EmployeeRecord, right: EmployeeRecord) {
  return getEmployeeDisplayName(left).localeCompare(getEmployeeDisplayName(right));
}

function compareEmployeeDepartment(left: EmployeeRecord, right: EmployeeRecord) {
  return nullableText(left.department, "").localeCompare(nullableText(right.department, ""));
}

function compareProjectNames(left: string[] = [], right: string[] = []) {
  return left.join(",").localeCompare(right.join(","));
}

function getEmployeeDisplayName(employee: EmployeeRecord) {
  return nullableText(employee.name, employee.email);
}

function formatBudgetUsd(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
    style: "currency"
  }).format(value);
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
