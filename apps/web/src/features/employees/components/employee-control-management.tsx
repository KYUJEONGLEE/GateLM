"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Plus,
  Save,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Wallet
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  getProviderConnectionFamily,
  ProviderFamilyIcon
} from "@/features/provider-connections/components/provider-family-icon";
import type {
  EmployeeControlModel,
  EmployeeCreateValues,
  EmployeeInvitationResult,
  EmployeeOrganizationCsvImportResult,
  EmployeeRecord,
  ProjectEmployeeAssignmentRecord,
  ProjectEmployeeAssignmentValues
} from "@/lib/control-plane/employees-types";
import type { ProjectRecord } from "@/lib/control-plane/projects-types";
import type { ProviderConnectionRecord } from "@/lib/control-plane/provider-connections-types";
import {
  getRateLimitRefillTokensPerSecond,
  getRateLimitWindowSeconds
} from "@/lib/control-plane/runtime-policy-types";
import { nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type EmployeeControlManagementProps = {
  locale: Locale;
  model: EmployeeControlModel;
};

type ProjectEmployeeAssignmentProps = {
  locale: Locale;
  model: EmployeeControlModel;
  project: ProjectRecord;
  providerConnections?: ProviderConnectionRecord[];
};

type SubmitState = {
  message: string;
  status: "error" | "idle" | "success";
};

type EmployeeSortDirection = "asc" | "desc";
type EmployeeSortField = "department" | "email" | "invitation" | "name" | "project";
type EmployeeAddMethod = "csv" | "invite";
type EmployeePolicyTab = "limits" | "provider-model";

type EmployeeProviderModelRow = {
  id: string;
  model: string;
  providerConnectionId: string;
};

type EmployeeResponsePayload = {
  employee?: EmployeeRecord;
  error?: string;
};

type EmployeeImportResponsePayload = {
  error?: string;
  importResult?: EmployeeOrganizationCsvImportResult;
};

type EmployeeInvitationResponsePayload = {
  error?: string;
  invitation?: EmployeeInvitationResult;
};

type ProjectEmployeeResponsePayload = {
  assignment?: ProjectEmployeeAssignmentRecord;
  error?: string;
};

const emptyCreateValues: EmployeeCreateValues = {
  department: "",
  email: "",
  name: ""
};

const emptyProviderConnections: ProviderConnectionRecord[] = [];

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
    csvUpload: string;
    department: string;
    disable: string;
    email: string;
    employeeAddTitle: string;
    employees: string;
    fixtureFallback: string;
    import: string;
    imported: string;
    invitation: string;
    inviteLink: string;
    inviteAll: string;
    inviteResend: string;
    inviteSend: string;
    inviteSent: string;
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
    csvUpload: "CSV file upload",
    department: "Department",
    disable: "Disable",
    email: "Email",
    employeeAddTitle: "Individual invite",
    employees: "Employees",
    fixtureFallback: "Control Plane unavailable. Showing fixture employees.",
    import: "Import",
    imported: "Imported",
    invitation: "Invite",
    inviteLink: "Invitation link",
    inviteAll: "Invite all",
    inviteResend: "Resend",
    inviteSend: "Send invite",
    inviteSent: "Invitation email sent.",
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
    title: "Employee Management",
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
    csvUpload: "CSV 파일 업로드",
    department: "부서",
    disable: "비활성화",
    email: "이메일",
    employeeAddTitle: "개별 초대",
    employees: "직원",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 직원을 표시 중입니다.",
    import: "등록",
    imported: "등록됨",
    invitation: "초대",
    inviteLink: "초대 링크",
    inviteAll: "일괄 초대",
    inviteResend: "재발송",
    inviteSend: "초대 메일 보내기",
    inviteSent: "초대 메일을 발송했습니다.",
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
    title: "직원 관리",
    warning: "경고"
  }
};

const projectEmployeeText: Record<
  Locale,
  {
    addEmployee: string;
    addModel: string;
    assign: string;
    assigned: string;
    assignmentCreated: string;
    available: string;
    budget: string;
    cancel: string;
    confirmDisable: string;
    department: string;
    disable: string;
    disableConfirmMessage: string;
    disableConfirmTitle: string;
    email: string;
    employeeList: string;
    enabled: string;
    employees: string;
    fixtureFallback: string;
    management: string;
    modelKeys: string;
    noProviderModels: string;
    noSelectedModels: string;
    limitSettings: string;
    monthlyUsage: string;
    name: string;
    noAssignments: string;
    noCandidates: string;
    noDepartments: string;
    noEmployees: string;
    note: string;
    policySettings: string;
    providerIds: string;
    providerModelSettings: string;
    quotaExceeded: string;
    quotaNotConfigured: string;
    quotaWarning: string;
    quotaWithinLimit: string;
    rateLimit: string;
    remaining: string;
    refillRequestsPerSecond: string;
    requestsPerMinute: string;
    removeModel: string;
    save: string;
    searchEmployee: string;
    selectDepartment: string;
    selectModel: string;
    selectProvider: string;
    budgetWarning: string;
  }
> = {
  en: {
    addEmployee: "Assign employee",
    addModel: "Add model",
    assign: "Assign",
    assigned: "Assigned",
    assignmentCreated: "Employee assigned to this project.",
    available: "Available",
    budget: "Monthly limit",
    cancel: "Cancel",
    confirmDisable: "Disable",
    department: "Department",
    disable: "Disable",
    disableConfirmMessage: " will be disabled for this project. Continue?",
    disableConfirmTitle: "Disable employee",
    email: "Email",
    employeeList: "Employee list",
    employees: "Employees",
    enabled: "Enabled",
    fixtureFallback: "Control Plane unavailable. Showing fixture employees.",
    management: "Management",
    modelKeys: "Models",
    noProviderModels: "No registered Provider models.",
    noSelectedModels: "No models selected.",
    limitSettings: "Limits",
    monthlyUsage: "Used this month",
    name: "Name",
    noAssignments: "No project employees.",
    noCandidates: "No employees available for assignment.",
    noDepartments: "No departments found.",
    noEmployees: "No employees in this department.",
    note: "Note",
    policySettings: "Policy settings",
    providerIds: "Providers",
    providerModelSettings: "Provider / Model",
    quotaExceeded: "High-cost models restricted",
    quotaNotConfigured: "No quota",
    quotaWarning: "Near limit",
    quotaWithinLimit: "Within limit",
    rateLimit: "Rate Limit",
    remaining: "Project remaining budget",
    refillRequestsPerSecond: "Refill tokens / sec",
    requestsPerMinute: "Requests per minute",
    removeModel: "Remove model",
    save: "Save",
    searchEmployee: "Search by name or email",
    selectDepartment: "Select department",
    selectModel: "Select model",
    selectProvider: "Select Provider",
    budgetWarning: "Budget warning"
  },
  ko: {
    addEmployee: "직원 배정",
    addModel: "모델 추가",
    assign: "배정",
    assigned: "배정",
    assignmentCreated: "직원을 현재 프로젝트에 배정했습니다.",
    available: "미배정",
    budget: "월 한도",
    cancel: "취소",
    confirmDisable: "비활성화",
    department: "부서",
    disable: "비활성화",
    disableConfirmMessage: " 직원을 현재 프로젝트에서 비활성화합니다. 계속하시겠습니까?",
    disableConfirmTitle: "직원 비활성화",
    email: "이메일",
    employeeList: "직원 목록",
    employees: "직원",
    enabled: "활성화",
    fixtureFallback: "Control Plane을 사용할 수 없어 fixture 직원을 표시 중입니다.",
    management: "관리",
    modelKeys: "모델",
    noProviderModels: "등록된 Provider 모델이 없습니다.",
    noSelectedModels: "선택된 모델이 없습니다.",
    limitSettings: "한도 설정",
    monthlyUsage: "이번 달 사용액",
    name: "이름",
    noAssignments: "Project에 배정된 직원이 없습니다.",
    noCandidates: "배정할 수 있는 직원이 없습니다.",
    noDepartments: "등록된 부서가 없습니다.",
    noEmployees: "이 부서에 배정 가능한 직원이 없습니다.",
    note: "메모",
    policySettings: "정책 수정",
    providerIds: "Provider",
    providerModelSettings: "Provider / Model",
    quotaExceeded: "고비용 모델 제한",
    quotaNotConfigured: "한도 미설정",
    quotaWarning: "한도 임박",
    quotaWithinLimit: "정상",
    rateLimit: "Rate Limit",
    remaining: "프로젝트 잔여 예산",
    refillRequestsPerSecond: "초당 토큰 충전",
    requestsPerMinute: "분당 요청 한도",
    removeModel: "모델 삭제",
    save: "저장",
    searchEmployee: "이름 또는 이메일 검색",
    selectDepartment: "부서 선택",
    selectModel: "모델 선택",
    selectProvider: "Provider 선택",
    budgetWarning: "예산 경고"
  }
};

export function ProjectEmployeeAssignment(props: ProjectEmployeeAssignmentProps) {
  return (
    <main className="console-content management-line-content">
      <ProjectEmployeeAssignmentSection {...props} />
    </main>
  );
}

export function ProjectEmployeeAssignmentSection({
  locale,
  model,
  project,
  providerConnections = emptyProviderConnections
}: ProjectEmployeeAssignmentProps) {
  const router = useRouter();
  const text = projectEmployeeText[locale];
  const [assignments, setAssignments] = useState<ProjectEmployeeAssignmentRecord[]>(
    model.assignmentsByProjectId[project.id] ?? []
  );
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [isEmployeePolicyDialogOpen, setIsEmployeePolicyDialogOpen] = useState(false);
  const [assignmentToDisable, setAssignmentToDisable] =
    useState<ProjectEmployeeAssignmentRecord | null>(null);
  const [isAssignmentDialogOpen, setIsAssignmentDialogOpen] = useState(false);
  const [assignmentDepartment, setAssignmentDepartment] = useState("");
  const [employeeSearchQuery, setEmployeeSearchQuery] = useState("");
  const [candidateEmployeeId, setCandidateEmployeeId] = useState("");
  const [employeePolicyTab, setEmployeePolicyTab] = useState<EmployeePolicyTab>("limits");
  const providerModelRowSequence = useRef(0);
  const activeAssignments = useMemo(
    () => assignments.filter((assignment) => assignment.status === "active"),
    [assignments]
  );
  const activeAssignmentByEmployeeId = useMemo(
    () => new Map(activeAssignments.map((assignment) => [assignment.employeeId, assignment])),
    [activeAssignments]
  );
  const projectEmployees = useMemo(
    () =>
      model.employees
        .filter((employee) => activeAssignmentByEmployeeId.has(employee.id))
        .sort((left, right) =>
          (left.name?.trim() || left.email).localeCompare(
            right.name?.trim() || right.email
          )
        ),
    [activeAssignmentByEmployeeId, model.employees]
  );
  const tenantDepartments = useMemo(
    () =>
      Array.from(
        new Set(
          model.employees
            .filter(
              (employee) => employee.status === "active" || employee.status === "staged"
            )
            .map((employee) => employee.department?.trim())
            .filter((department): department is string => Boolean(department))
        )
      ).sort((left, right) => left.localeCompare(right)),
    [model.employees]
  );
  const [assignmentValues, setAssignmentValues] = useState({
    monthlyBudgetLimitUsd: 0,
    policyNote: "",
    rateLimitEnabled: false,
    rateLimitLimit: 60,
    rateLimitRefillTokensPerSecond: 1,
    rateLimitWindowSeconds: 60,
    warningThresholdPercent: 80
  });
  const [providerModelRows, setProviderModelRows] = useState<EmployeeProviderModelRow[]>([]);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });

  const assignableEmployees = useMemo(() => {
    const normalizedQuery = employeeSearchQuery.trim().toLocaleLowerCase();

    return model.employees
      .filter((employee) => {
        if (
          (employee.status !== "active" && employee.status !== "staged") ||
          activeAssignmentByEmployeeId.has(employee.id) ||
          employee.department?.trim() !== assignmentDepartment
        ) {
          return false;
        }

        if (!normalizedQuery) {
          return true;
        }

        return `${employee.name ?? ""} ${employee.email}`
          .toLocaleLowerCase()
          .includes(normalizedQuery);
      })
      .sort((left, right) =>
        (left.name?.trim() || left.email).localeCompare(right.name?.trim() || right.email)
      );
  }, [
    activeAssignmentByEmployeeId,
    assignmentDepartment,
    employeeSearchQuery,
    model.employees
  ]);
  const selectableProviderConnections = useMemo(
    () =>
      providerConnections
        .filter(
          (providerConnection) =>
            providerConnection.status !== "DISABLED" &&
            getProviderConnectionModels(providerConnection).length > 0
        )
        .sort((left, right) => left.displayName.localeCompare(right.displayName)),
    [providerConnections]
  );
  const providerConnectionsById = useMemo(
    () => new Map(providerConnections.map((providerConnection) => [providerConnection.id, providerConnection])),
    [providerConnections]
  );
  const selectedProviderModelKeys = useMemo(
    () =>
      new Set(
        providerModelRows
          .filter((row) => row.providerConnectionId && row.model)
          .map((row) => providerModelKey(row.providerConnectionId, row.model))
      ),
    [providerModelRows]
  );
  const hasAvailableProviderModel = useMemo(
    () =>
      selectableProviderConnections.some((providerConnection) =>
        getProviderConnectionModels(providerConnection).some(
          (modelName) =>
            !selectedProviderModelKeys.has(providerModelKey(providerConnection.id, modelName))
        )
      ),
    [selectableProviderConnections, selectedProviderModelKeys]
  );

  useEffect(() => {
    if (!projectEmployees.some((employee) => employee.id === selectedEmployeeId)) {
      setSelectedEmployeeId(projectEmployees[0]?.id ?? "");
    }
  }, [projectEmployees, selectedEmployeeId]);

  useEffect(() => {
    if (!assignableEmployees.some((employee) => employee.id === candidateEmployeeId)) {
      setCandidateEmployeeId("");
    }
  }, [assignableEmployees, candidateEmployeeId]);

  useEffect(() => {
    const existingAssignment = assignments.find(
      (assignment) => assignment.employeeId === selectedEmployeeId
    );
    const formState = getEmployeePolicyFormState(existingAssignment, providerConnections);

    setAssignmentValues(formState.assignmentValues);
    setProviderModelRows(formState.providerModelRows);
  }, [assignments, providerConnections, selectedEmployeeId]);

  const assignedBudgetUsd = activeAssignments.reduce(
    (total, assignment) => total + assignment.monthlyBudgetLimitUsd,
    0
  );
  const remainingBudgetUsd = project.totalBudgetUsd - assignedBudgetUsd;
  const selectedEmployee = projectEmployees.find(
    (employee) => employee.id === selectedEmployeeId
  );
  const selectedAssignment = selectedEmployeeId
    ? activeAssignmentByEmployeeId.get(selectedEmployeeId)
    : undefined;
  const selectedQuotaStatus = selectedAssignment?.quotaStatus ?? "not_configured";
  const selectedQuotaStatusLabel = {
    exceeded: text.quotaExceeded,
    not_configured: text.quotaNotConfigured,
    warning: text.quotaWarning,
    within_limit: text.quotaWithinLimit
  }[selectedQuotaStatus];
  const selectedQuotaProgress = Math.min(
    Math.max(selectedAssignment?.quotaUsagePercent ?? 0, 0),
    100
  );
  const assignmentValuesInvalid =
    !Number.isFinite(assignmentValues.monthlyBudgetLimitUsd) ||
    assignmentValues.monthlyBudgetLimitUsd < 0 ||
    (assignmentValues.rateLimitEnabled &&
      (!Number.isInteger(assignmentValues.rateLimitLimit) ||
        assignmentValues.rateLimitLimit < 1 ||
        assignmentValues.rateLimitLimit > 100000 ||
        !Number.isInteger(assignmentValues.rateLimitRefillTokensPerSecond) ||
        assignmentValues.rateLimitRefillTokensPerSecond < 1 ||
        assignmentValues.rateLimitRefillTokensPerSecond > 100000 ||
        !Number.isInteger(assignmentValues.rateLimitWindowSeconds) ||
        assignmentValues.rateLimitWindowSeconds < 1 ||
        assignmentValues.rateLimitWindowSeconds > 3600)) ||
    !Number.isInteger(assignmentValues.warningThresholdPercent) ||
    assignmentValues.warningThresholdPercent < 0 ||
    assignmentValues.warningThresholdPercent > 100 ||
    providerModelRows.some((row) => !row.providerConnectionId || !row.model) ||
    selectedProviderModelKeys.size !== providerModelRows.length;
  const employeeToDisable = assignmentToDisable
    ? model.employees.find((employee) => employee.id === assignmentToDisable.employeeId)
    : undefined;

  function openAssignmentDialog() {
    setAssignmentDepartment(tenantDepartments[0] ?? "");
    setEmployeeSearchQuery("");
    setCandidateEmployeeId("");
    setIsAssignmentDialogOpen(true);
  }

  function openEmployeePolicyDialog(employeeId: string) {
    const existingAssignment = assignments.find(
      (assignment) => assignment.employeeId === employeeId
    );
    const formState = getEmployeePolicyFormState(existingAssignment, providerConnections);

    setSelectedEmployeeId(employeeId);
    setAssignmentValues(formState.assignmentValues);
    setProviderModelRows(formState.providerModelRows);
    setEmployeePolicyTab("limits");
    setSubmitState({ message: "", status: "idle" });
    setIsEmployeePolicyDialogOpen(true);
  }

  function addProviderModelRow() {
    for (const providerConnection of selectableProviderConnections) {
      const modelName = getProviderConnectionModels(providerConnection).find(
        (candidate) =>
          !selectedProviderModelKeys.has(providerModelKey(providerConnection.id, candidate))
      );

      if (modelName) {
        providerModelRowSequence.current += 1;
        setProviderModelRows((current) => [
          ...current,
          {
            id: `new-provider-model-${providerModelRowSequence.current}`,
            model: modelName,
            providerConnectionId: providerConnection.id
          }
        ]);
        return;
      }
    }
  }

  function updateProviderModelRow(
    rowId: string,
    next: Pick<EmployeeProviderModelRow, "model" | "providerConnectionId">
  ) {
    setProviderModelRows((current) =>
      current.map((row) => (row.id === rowId ? { ...row, ...next } : row))
    );
  }

  function changeProviderModelRowProvider(rowId: string, providerConnectionId: string) {
    const providerConnection = providerConnectionsById.get(providerConnectionId);
    const usedKeys = new Set(
      providerModelRows
        .filter((row) => row.id !== rowId && row.providerConnectionId && row.model)
        .map((row) => providerModelKey(row.providerConnectionId, row.model))
    );
    const firstAvailableModel = providerConnection
      ? getProviderConnectionModels(providerConnection).find(
          (modelName) => !usedKeys.has(providerModelKey(providerConnectionId, modelName))
        ) ?? ""
      : "";

    updateProviderModelRow(rowId, {
      model: firstAvailableModel,
      providerConnectionId
    });
  }

  async function submitNewAssignment() {
    const employee = model.employees.find((item) => item.id === candidateEmployeeId);
    if (!employee) {
      return;
    }

    const existingAssignment = assignments.find(
      (assignment) => assignment.employeeId === employee.id
    );
    const values: ProjectEmployeeAssignmentValues = {
      allowedModelKeys: existingAssignment?.policy.allowedModelKeys ?? [],
      allowedProviderConnectionIds:
        existingAssignment?.policy.allowedProviderConnectionIds ?? [],
      employeeId: employee.id,
      monthlyBudgetLimitUsd: existingAssignment?.monthlyBudgetLimitUsd ?? 0,
      policyNote: existingAssignment?.policy.note ?? "",
      projectId: project.id,
      rateLimitEnabled: existingAssignment?.policy.rateLimit.enabled ?? false,
      rateLimitLimit: existingAssignment?.policy.rateLimit.limit ?? 60,
      rateLimitWindowSeconds:
        existingAssignment?.policy.rateLimit.windowSeconds ?? 60,
      status: "active",
      warningThresholdPercent: existingAssignment?.warningThresholdPercent ?? 80
    };

    setPendingAction("assign-new");
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
    setSelectedEmployeeId(employee.id);
    setIsAssignmentDialogOpen(false);
    setSubmitState({ message: text.assignmentCreated, status: "success" });
    setPendingAction(null);
    router.refresh();
  }

  async function submitAssignment() {
    if (!selectedEmployeeId) {
      return;
    }

    const values: ProjectEmployeeAssignmentValues = {
      allowedModelKeys: uniqueStrings(providerModelRows.map((row) => row.model)),
      allowedProviderConnectionIds: uniqueStrings(
        providerModelRows.map((row) => row.providerConnectionId)
      ),
      employeeId: selectedEmployeeId,
      monthlyBudgetLimitUsd: assignmentValues.monthlyBudgetLimitUsd,
      policyNote: assignmentValues.policyNote,
      projectId: project.id,
      rateLimitEnabled: assignmentValues.rateLimitEnabled,
      rateLimitLimit: assignmentValues.rateLimitLimit,
      rateLimitWindowSeconds: assignmentValues.rateLimitWindowSeconds,
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
      message: locale === "ko" ? "직원 정책이 저장되었습니다." : "Employee policy saved.",
      status: "success"
    });
    setIsEmployeePolicyDialogOpen(false);
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
    setAssignmentToDisable(null);
    setPendingAction(null);
    router.refresh();
  }

  return (
    <section className="team-section project-department-section">
      <div className="team-section-header team-section-header-with-actions">
        <div className="project-employee-list-heading">
          <h3>{text.employeeList}</h3>
          <span>{projectEmployees.length}</span>
        </div>
        <div className="project-department-header-actions">
          <div
            className="project-budget-badge"
            data-budget-state={remainingBudgetUsd < 0 ? "over" : "ok"}
          >
            <Wallet aria-hidden="true" size={16} />
            {formatBudgetUsd(assignedBudgetUsd)} / {formatBudgetUsd(project.totalBudgetUsd)}
          </div>
          <Button
            disabled={pendingAction !== null}
            onClick={openAssignmentDialog}
            type="button"
          >
            <UserPlus aria-hidden="true" />
            {text.addEmployee}
          </Button>
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

      {projectEmployees.length === 0 ? (
        <p className="project-empty">{text.noAssignments}</p>
      ) : (
        <div className="project-employee-table-wrap">
          <table className="project-employee-table">
            <thead>
              <tr>
                <th scope="col">{text.name}</th>
                <th scope="col">{text.department}</th>
                <th scope="col">{text.budget}</th>
                <th scope="col">{text.management}</th>
              </tr>
            </thead>
            <tbody>
              {projectEmployees.map((employee) => {
                const assignment = activeAssignmentByEmployeeId.get(employee.id);
                if (!assignment) {
                  return null;
                }

                return (
                  <tr key={assignment.id}>
                    <td>
                      <button
                        className="project-employee-name-button"
                        onClick={() => openEmployeePolicyDialog(employee.id)}
                        type="button"
                      >
                        {employee.name?.trim() || "-"}
                      </button>
                    </td>
                    <td>{employee.department?.trim() || "-"}</td>
                    <td>
                      <div className="project-employee-quota-cell">
                        <strong>
                          {formatBudgetUsd(assignment.monthlyUsedUsd)} /{" "}
                          {formatBudgetUsd(assignment.monthlyBudgetLimitUsd)}
                        </strong>
                        <small data-quota-status={assignment.quotaStatus}>
                          {{
                            exceeded: text.quotaExceeded,
                            not_configured: text.quotaNotConfigured,
                            warning: text.quotaWarning,
                            within_limit: text.quotaWithinLimit
                          }[assignment.quotaStatus]}
                        </small>
                      </div>
                    </td>
                    <td className="project-employee-table-action">
                      <Button
                        disabled={pendingAction !== null}
                        onClick={() => {
                          setSubmitState({ message: "", status: "idle" });
                          setAssignmentToDisable(assignment);
                        }}
                        type="button"
                        variant="outline"
                      >
                        <Users aria-hidden="true" />
                        {pendingAction === `disable:${assignment.id}`
                          ? "..."
                          : text.disable}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        onOpenChange={(open) => {
          if (pendingAction !== "assign") {
            setIsEmployeePolicyDialogOpen(open);
          }
        }}
        open={isEmployeePolicyDialogOpen}
      >
        <DialogContent className="employee-policy-dialog">
          <DialogHeader>
            <DialogTitle className="employee-policy-dialog-title">
              <span>{selectedEmployee?.name?.trim() || "-"}</span>
              <small>{selectedEmployee?.department?.trim() || "-"}</small>
            </DialogTitle>
          </DialogHeader>
          {submitState.status === "error" && submitState.message ? (
            <Alert variant="destructive">
              <AlertDescription>{submitState.message}</AlertDescription>
            </Alert>
          ) : null}
          <Tabs
            className="employee-policy-tabs"
            onValueChange={(value) => setEmployeePolicyTab(value as EmployeePolicyTab)}
            value={employeePolicyTab}
          >
            <TabsList aria-label={text.policySettings}>
              <TabsTrigger value="limits">{text.limitSettings}</TabsTrigger>
              <TabsTrigger value="provider-model">{text.providerModelSettings}</TabsTrigger>
            </TabsList>
            <TabsContent className="employee-policy-tab-content" value="limits">
              <div
                className="employee-policy-usage-summary"
                data-quota-status={selectedQuotaStatus}
              >
                <div className="employee-policy-usage-heading">
                  <span>{text.monthlyUsage}</span>
                  <Badge variant="outline">{selectedQuotaStatusLabel}</Badge>
                </div>
                <strong>
                  {formatBudgetUsd(selectedAssignment?.monthlyUsedUsd ?? 0)} /{" "}
                  {formatBudgetUsd(selectedAssignment?.monthlyBudgetLimitUsd ?? 0)}
                </strong>
                <div
                  aria-label={text.monthlyUsage}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={Math.round(selectedQuotaProgress)}
                  className="employee-policy-quota-progress"
                  role="progressbar"
                >
                  <span style={{ width: `${selectedQuotaProgress}%` }} />
                </div>
              </div>
              <div className="modal-form-grid project-employee-policy-fields">
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
                <label className="policy-field employee-budget-warning-field">
                  <span>{text.budgetWarning}</span>
                  <span className="employee-policy-input-suffix">
                    <input
                      max={100}
                      min={0}
                      onChange={(event) =>
                        setAssignmentValues((current) => ({
                          ...current,
                          warningThresholdPercent: Number(event.target.value)
                        }))
                      }
                      step={5}
                      type="number"
                      value={assignmentValues.warningThresholdPercent}
                    />
                    <span aria-hidden="true">%</span>
                  </span>
                </label>
                <label className="employee-rate-limit-control">
                  <span>{text.rateLimit}</span>
                  <Switch
                    aria-label={text.rateLimit}
                    checked={assignmentValues.rateLimitEnabled}
                    id="employee-rate-limit-enabled"
                    onCheckedChange={(checked) =>
                      setAssignmentValues((current) => ({
                        ...current,
                        rateLimitEnabled: checked
                      }))
                    }
                  />
                </label>
                {assignmentValues.rateLimitEnabled ? (
                  <div className="employee-rate-limit-fields">
                    <label className="policy-field">
                      <span>{text.requestsPerMinute}</span>
                      <input
                        max={100000}
                        min={1}
                        onChange={(event) => {
                          const limit = Number(event.target.value);
                          setAssignmentValues((current) => ({
                            ...current,
                            rateLimitLimit: limit,
                            rateLimitWindowSeconds: getRateLimitWindowSeconds(
                              limit,
                              current.rateLimitRefillTokensPerSecond
                            )
                          }));
                        }}
                        step={1}
                        type="number"
                        value={assignmentValues.rateLimitLimit}
                      />
                    </label>
                    <label className="policy-field">
                      <span>{text.refillRequestsPerSecond}</span>
                      <input
                        max={100000}
                        min={1}
                        onChange={(event) => {
                          const refillTokensPerSecond = Number(event.target.value);
                          setAssignmentValues((current) => ({
                            ...current,
                            rateLimitRefillTokensPerSecond: refillTokensPerSecond,
                            rateLimitWindowSeconds: getRateLimitWindowSeconds(
                              current.rateLimitLimit,
                              refillTokensPerSecond
                            )
                          }));
                        }}
                        step={1}
                        type="number"
                        value={assignmentValues.rateLimitRefillTokensPerSecond}
                      />
                    </label>
                  </div>
                ) : null}
                <label className="policy-field employee-policy-note-field">
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
            </TabsContent>
            <TabsContent className="employee-policy-tab-content" value="provider-model">
              <div className="employee-provider-model-toolbar">
                <span>{text.providerModelSettings}</span>
                <Button
                  disabled={!hasAvailableProviderModel}
                  onClick={addProviderModelRow}
                  type="button"
                  variant="outline"
                >
                  <Plus aria-hidden="true" />
                  {text.addModel}
                </Button>
              </div>
              {selectableProviderConnections.length === 0 && providerModelRows.length === 0 ? (
                <p className="employee-provider-model-empty">{text.noProviderModels}</p>
              ) : null}
              {selectableProviderConnections.length > 0 && providerModelRows.length === 0 ? (
                <p className="employee-provider-model-empty">{text.noSelectedModels}</p>
              ) : null}
              <div className="employee-provider-model-list">
                {providerModelRows.map((row) => {
                  const selectedProvider = providerConnectionsById.get(
                    row.providerConnectionId
                  );
                  const providerSelectable = selectableProviderConnections.some(
                    (providerConnection) => providerConnection.id === row.providerConnectionId
                  );
                  const modelOptions = selectedProvider
                    ? getProviderConnectionModels(selectedProvider)
                    : [];
                  const selectedModelAvailable = modelOptions.includes(row.model);

                  return (
                    <div className="employee-provider-model-row" key={row.id}>
                      <label className="employee-provider-model-field">
                        <span>{text.providerIds}</span>
                        <div className="employee-provider-model-select">
                          {selectedProvider ? (
                            <ProviderFamilyIcon
                              className="employee-provider-model-icon"
                              family={getProviderConnectionFamily(selectedProvider)}
                              size={20}
                            />
                          ) : (
                            <span className="employee-provider-model-icon" aria-hidden="true">
                              -
                            </span>
                          )}
                          <select
                            aria-label={text.selectProvider}
                            onChange={(event) =>
                              changeProviderModelRowProvider(row.id, event.target.value)
                            }
                            value={row.providerConnectionId}
                          >
                            <option value="">{text.selectProvider}</option>
                            {selectedProvider && !providerSelectable ? (
                              <option value={selectedProvider.id}>
                                {selectedProvider.displayName}
                              </option>
                            ) : null}
                            {selectableProviderConnections.map((providerConnection) => (
                              <option key={providerConnection.id} value={providerConnection.id}>
                                {providerConnection.displayName}
                              </option>
                            ))}
                          </select>
                        </div>
                      </label>
                      <label className="employee-provider-model-field">
                        <span>{text.modelKeys}</span>
                        <select
                          aria-label={text.selectModel}
                          disabled={!selectedProvider}
                          onChange={(event) =>
                            updateProviderModelRow(row.id, {
                              model: event.target.value,
                              providerConnectionId: row.providerConnectionId
                            })
                          }
                          value={row.model}
                        >
                          <option value="">{text.selectModel}</option>
                          {row.model && !selectedModelAvailable ? (
                            <option value={row.model}>{row.model}</option>
                          ) : null}
                          {modelOptions.map((modelName) => {
                            const usedByAnotherRow = providerModelRows.some(
                              (candidate) =>
                                candidate.id !== row.id &&
                                candidate.providerConnectionId === row.providerConnectionId &&
                                candidate.model === modelName
                            );

                            return (
                              <option
                                disabled={usedByAnotherRow}
                                key={modelName}
                                value={modelName}
                              >
                                {modelName}
                              </option>
                            );
                          })}
                        </select>
                      </label>
                      <Button
                        aria-label={text.removeModel}
                        className="employee-provider-model-remove"
                        onClick={() =>
                          setProviderModelRows((current) =>
                            current.filter((candidate) => candidate.id !== row.id)
                          )
                        }
                        size="icon"
                        title={text.removeModel}
                        type="button"
                        variant="ghost"
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            </TabsContent>
          </Tabs>
          <div className="modal-actions">
            <span className="application-budget-summary">
              {text.remaining}: {formatBudgetUsd(remainingBudgetUsd)}
            </span>
            <Button
              disabled={pendingAction !== null}
              onClick={() => setIsEmployeePolicyDialogOpen(false)}
              type="button"
              variant="outline"
            >
              {text.cancel}
            </Button>
            <Button
              disabled={
                pendingAction !== null ||
                !selectedEmployeeId ||
                assignmentValuesInvalid
              }
              onClick={() => void submitAssignment()}
              type="button"
            >
              <Save aria-hidden="true" />
              {pendingAction === "assign" ? "..." : text.save}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (
            !open &&
            pendingAction !== `disable:${assignmentToDisable?.id ?? ""}`
          ) {
            setAssignmentToDisable(null);
          }
        }}
        open={assignmentToDisable !== null}
      >
        <DialogContent className="employee-disable-dialog">
          <DialogHeader>
            <DialogTitle>{text.disableConfirmTitle}</DialogTitle>
          </DialogHeader>
          <p className="employee-disable-confirmation">
            <strong>{employeeToDisable?.name?.trim() || "-"}</strong>
            <span>{text.disableConfirmMessage}</span>
          </p>
          {submitState.status === "error" && submitState.message ? (
            <Alert variant="destructive">
              <AlertDescription>{submitState.message}</AlertDescription>
            </Alert>
          ) : null}
          <div className="modal-actions">
            <Button
              disabled={pendingAction !== null}
              onClick={() => setAssignmentToDisable(null)}
              type="button"
              variant="outline"
            >
              {text.cancel}
            </Button>
            <Button
              disabled={pendingAction !== null || assignmentToDisable === null}
              onClick={() => {
                if (assignmentToDisable) {
                  void disableAssignment(assignmentToDisable);
                }
              }}
              type="button"
              variant="destructive"
            >
              <Users aria-hidden="true" />
              {assignmentToDisable &&
              pendingAction === `disable:${assignmentToDisable.id}`
                ? "..."
                : text.confirmDisable}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (pendingAction !== "assign-new") {
            setIsAssignmentDialogOpen(open);
          }
        }}
        open={isAssignmentDialogOpen}
      >
        <DialogContent className="employee-assignment-dialog">
          <DialogHeader>
            <DialogTitle>{text.addEmployee}</DialogTitle>
          </DialogHeader>

          <div className="employee-assignment-controls">
            <label className="policy-field">
              <span>{text.selectDepartment}</span>
              <select
                disabled={pendingAction !== null || tenantDepartments.length === 0}
                onChange={(event) => {
                  setAssignmentDepartment(event.target.value);
                  setCandidateEmployeeId("");
                }}
                value={assignmentDepartment}
              >
                {tenantDepartments.length === 0 ? (
                  <option value="">{text.noDepartments}</option>
                ) : null}
                {tenantDepartments.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
              </select>
            </label>
            <label className="policy-field">
              <span>{text.searchEmployee}</span>
              <input
                disabled={pendingAction !== null || !assignmentDepartment}
                onChange={(event) => setEmployeeSearchQuery(event.target.value)}
                placeholder={text.searchEmployee}
                type="search"
                value={employeeSearchQuery}
              />
            </label>
          </div>

          <div className="project-assignment-candidate-list">
            {assignableEmployees.length === 0 ? (
              <p className="project-empty">{text.noCandidates}</p>
            ) : (
              assignableEmployees.map((employee) => {
                const isSelected = candidateEmployeeId === employee.id;

                return (
                  <button
                    aria-pressed={isSelected}
                    className="project-department-employee"
                    data-active={isSelected}
                    disabled={pendingAction !== null}
                    key={employee.id}
                    onClick={() => setCandidateEmployeeId(employee.id)}
                    type="button"
                  >
                    <span className="project-department-employee-icon">
                      <Users aria-hidden="true" />
                    </span>
                    <span className="project-department-employee-copy">
                      <strong>{employee.name?.trim() || employee.email}</strong>
                      <small>{employee.email}</small>
                    </span>
                    <Badge
                      className="project-status-badge"
                      data-status="DISABLED"
                      variant="outline"
                    >
                      {text.available}
                    </Badge>
                  </button>
                );
              })
            )}
          </div>

          <div className="modal-actions">
            <Button
              disabled={pendingAction === "assign-new"}
              onClick={() => setIsAssignmentDialogOpen(false)}
              type="button"
              variant="outline"
            >
              {text.cancel}
            </Button>
            <Button
              disabled={pendingAction !== null || !candidateEmployeeId}
              onClick={() => void submitNewAssignment()}
              type="button"
            >
              <UserPlus aria-hidden="true" />
              {pendingAction === "assign-new" ? "..." : text.assign}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function EmployeeControlManagement({ locale, model }: EmployeeControlManagementProps) {
  const router = useRouter();
  const text = employeeText[locale];
  const [addMethod, setAddMethod] = useState<EmployeeAddMethod>("csv");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [employees, setEmployees] = useState<EmployeeRecord[]>(model.employees);
  const [projects, setProjects] = useState<ProjectRecord[]>(model.projects);
  const [assignmentsByProjectId, setAssignmentsByProjectId] = useState(
    model.assignmentsByProjectId
  );
  const [csvText, setCsvText] = useState(
    "project,department,email,name,employeeBudgetUsd,projectBudgetUsd\n"
  );
  const [createValues, setCreateValues] = useState<EmployeeCreateValues>(emptyCreateValues);
  const [lastInviteUrl, setLastInviteUrl] = useState<string | null>(null);
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
    const projectsById = new Map(projects.map((project) => [project.id, project.name]));
    const employeeProjects = new Map<string, string[]>();

    for (const [projectId, assignments] of Object.entries(assignmentsByProjectId)) {
      const projectName = projectsById.get(projectId) ?? projectId;
      for (const assignment of assignments) {
        if (assignment.status !== "active") {
          continue;
        }
        const current = employeeProjects.get(assignment.employeeId) ?? [];
        current.push(projectName);
        employeeProjects.set(assignment.employeeId, current);
      }
    }

    for (const names of employeeProjects.values()) {
      names.sort((left, right) => left.localeCompare(right));
    }

    return employeeProjects;
  }, [assignmentsByProjectId, projects]);

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
    setLastInviteUrl(null);

    const response = await fetch("/api/control-plane/employees", {
      body: JSON.stringify({
        action: "importOrganizationCsv",
        values: {
          csvText,
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
    mergeProjects(payload.importResult.projects);
    mergeAssignments(payload.importResult.assignments);
    setPageIndex(0);
    setSubmitState({
      message:
        locale === "ko"
          ? `${payload.importResult.projectCreatedCount}개 프로젝트 생성, ${payload.importResult.createdCount}명 직원 생성, ${payload.importResult.assignmentCreatedCount}개 배정 생성`
          : `${payload.importResult.projectCreatedCount} projects, ${payload.importResult.createdCount} employees, ${payload.importResult.assignmentCreatedCount} assignments created`,
      status: "success"
    });
    setPendingAction(null);
    setIsAddDialogOpen(false);
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

    const invitation = await requestEmployeeInvitation(payload.employee.id);
    if (!invitation) {
      mergeEmployees([payload.employee]);
      setCreateValues(emptyCreateValues);
      setPageIndex(0);
      setPendingAction(null);
      return;
    }

    mergeEmployees([invitation.employee]);
    setCreateValues(emptyCreateValues);
    setLastInviteUrl(invitation.signupUrl);
    setPageIndex(0);
    setSubmitState({ message: text.inviteSent, status: "success" });
    setPendingAction(null);
    setIsAddDialogOpen(false);
    router.refresh();
  }

  async function sendInviteForEmployee(employee: EmployeeRecord) {
    setPendingAction(`invite:${employee.id}`);
    setSubmitState({ message: "", status: "idle" });
    setLastInviteUrl(null);

    const invitation = await requestEmployeeInvitation(employee.id);
    if (!invitation) {
      setPendingAction(null);
      return;
    }

    mergeEmployees([invitation.employee]);
    setLastInviteUrl(invitation.signupUrl);
    setSubmitState({ message: text.inviteSent, status: "success" });
    setPendingAction(null);
    router.refresh();
  }

  async function sendInvitesForAllEmployees() {
    const targets = employees.filter((employee) => employee.invitationStatus !== "accepted");
    if (targets.length === 0) {
      setSubmitState({
        message:
          locale === "ko"
            ? "일괄 초대할 직원이 없습니다."
            : "There are no employees to invite.",
        status: "success"
      });
      return;
    }

    setPendingAction("inviteAll");
    setSubmitState({ message: "", status: "idle" });
    setLastInviteUrl(null);

    const invitations: EmployeeInvitationResult[] = [];
    let failedCount = 0;

    for (let index = 0; index < targets.length; index += 5) {
      const batch = targets.slice(index, index + 5);
      const results = await Promise.all(
        batch.map((employee) => requestEmployeeInvitation(employee.id, false))
      );
      for (const invitation of results) {
        if (invitation) {
          invitations.push(invitation);
        } else {
          failedCount += 1;
        }
      }
    }

    mergeEmployees(invitations.map((invitation) => invitation.employee));
    const successCount = invitations.length;
    setSubmitState({
      message:
        locale === "ko"
          ? failedCount > 0
            ? `${successCount}명 발송, ${failedCount}명 실패`
            : `${successCount}명에게 초대 메일을 발송했습니다.`
          : failedCount > 0
            ? `${successCount} sent, ${failedCount} failed`
            : `Invitation emails sent to ${successCount} employees.`,
      status: failedCount > 0 ? "error" : "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function requestEmployeeInvitation(employeeId: string, reportError = true) {
    try {
      const response = await fetch("/api/control-plane/employees", {
        body: JSON.stringify({
          action: "invite",
          values: {
            employeeId,
            tenantId: model.controlPlaneTenantId
          }
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as EmployeeInvitationResponsePayload;

      if (!response.ok || !payload.invitation) {
        if (reportError) {
          setSubmitState({
            message: payload.error ?? "Employee invitation failed.",
            status: "error"
          });
        }
        return null;
      }

      return payload.invitation;
    } catch {
      if (reportError) {
        setSubmitState({
          message: "Employee invitation failed.",
          status: "error"
        });
      }
      return null;
    }
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

  function mergeProjects(nextProjects: ProjectRecord[]) {
    setProjects((current) => {
      const byId = new Map(current.map((project) => [project.id, project]));
      for (const project of nextProjects) {
        byId.set(project.id, project);
      }
      return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name));
    });
  }

  function mergeAssignments(nextAssignments: ProjectEmployeeAssignmentRecord[]) {
    setAssignmentsByProjectId((current) => {
      const next = { ...current };
      for (const assignment of nextAssignments) {
        next[assignment.projectId] = upsertAssignment(next[assignment.projectId] ?? [], assignment);
      }
      return next;
    });
  }

  function openEmployeeAddDialog() {
    setAddMethod("csv");
    setSubmitState({ message: "", status: "idle" });
    setLastInviteUrl(null);
    setIsAddDialogOpen(true);
  }

  function changeAddMethod(method: EmployeeAddMethod) {
    setAddMethod(method);
    setSubmitState({ message: "", status: "idle" });
  }

  function changeAddDialogOpen(open: boolean) {
    if (!open && pendingAction !== null) {
      return;
    }
    setIsAddDialogOpen(open);
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
        aria-label={`${label} ${locale === "ko" ? "정렬" : "sort"}${
          isActive ? ` (${directionLabel})` : ""
        }`}
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
        <h2>{text.title}</h2>
      </section>

      {model.source === "fixture" ? (
        <Alert variant="warning">
          <AlertDescription>
            {text.fixtureFallback} {model.loadError}
          </AlertDescription>
        </Alert>
      ) : null}
      {!isAddDialogOpen && submitState.message ? (
        <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}
      {!isAddDialogOpen && lastInviteUrl ? (
        <Alert variant="success">
          <AlertDescription>
            {text.inviteLink}: <a href={lastInviteUrl}>{lastInviteUrl}</a>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="employee-list-section">
        <div className="employee-list-toolbar employee-list-actions">
          <Button
            className="employee-invite-all-mobile-button"
            disabled={
              pendingAction !== null ||
              employees.every((employee) => employee.invitationStatus === "accepted")
            }
            onClick={() => void sendInvitesForAllEmployees()}
            size="sm"
            type="button"
            variant="outline"
          >
            <UserPlus aria-hidden="true" />
            {pendingAction === "inviteAll" ? "..." : text.inviteAll}
          </Button>
          <Button
            className="employee-add-trigger"
            disabled={pendingAction !== null}
            onClick={openEmployeeAddDialog}
            size="sm"
            type="button"
          >
            <UserPlus aria-hidden="true" />
            {text.addTab}
          </Button>
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
                <div className="employee-invitation-header">
                  {renderEmployeeSortHeader("invitation", text.invitation)}
                  <Button
                    className="employee-invite-all-button"
                    disabled={
                      pendingAction !== null ||
                      employees.every((employee) => employee.invitationStatus === "accepted")
                    }
                    onClick={() => void sendInvitesForAllEmployees()}
                    size="xs"
                    type="button"
                    variant="outline"
                  >
                    <UserPlus aria-hidden="true" />
                    {pendingAction === "inviteAll" ? "..." : text.inviteAll}
                  </Button>
                </div>
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
                        {employee.invitationStatus !== "accepted" ? (
                          <Button
                            disabled={pendingAction !== null}
                            onClick={() => void sendInviteForEmployee(employee)}
                            type="button"
                            variant="outline"
                          >
                            <UserPlus aria-hidden="true" />
                            {pendingAction === `invite:${employee.id}`
                              ? "..."
                              : employee.invitationStatus === "pending"
                                ? text.inviteResend
                                : text.inviteSend}
                          </Button>
                        ) : null}
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

      <Dialog onOpenChange={changeAddDialogOpen} open={isAddDialogOpen}>
        <DialogContent className="employee-add-dialog">
          <DialogHeader>
            <DialogTitle>{text.addTab}</DialogTitle>
          </DialogHeader>

          <div aria-label={text.addTab} className="employee-add-methods" role="tablist">
            <button
              aria-controls="employee-add-csv-panel"
              aria-selected={addMethod === "csv"}
              className="employee-add-method-button"
              data-active={addMethod === "csv"}
              disabled={pendingAction !== null}
              id="employee-add-csv-tab"
              onClick={() => changeAddMethod("csv")}
              role="tab"
              type="button"
            >
              <Upload aria-hidden="true" />
              {text.csvUpload}
            </button>
            <button
              aria-controls="employee-add-invite-panel"
              aria-selected={addMethod === "invite"}
              className="employee-add-method-button"
              data-active={addMethod === "invite"}
              disabled={pendingAction !== null}
              id="employee-add-invite-tab"
              onClick={() => changeAddMethod("invite")}
              role="tab"
              type="button"
            >
              <UserPlus aria-hidden="true" />
              {text.employeeAddTitle}
            </button>
          </div>

          {submitState.message ? (
            <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
              <AlertDescription>{submitState.message}</AlertDescription>
            </Alert>
          ) : null}

          {addMethod === "csv" ? (
            <div
              aria-labelledby="employee-add-csv-tab"
              className="employee-add-dialog-section"
              id="employee-add-csv-panel"
              role="tabpanel"
            >
              <div className="employee-csv-upload-row">
                <label className="primary-button" htmlFor="employee-csv-file">
                  <Upload aria-hidden="true" />
                  {text.csvUpload}
                </label>
                <input
                  accept=".csv,text/csv"
                  className="sr-only"
                  disabled={pendingAction !== null}
                  id="employee-csv-file"
                  onChange={(event) => void handleCsvFile(event)}
                  type="file"
                />
              </div>
              <label className="policy-field employee-csv-field">
                <span>{text.csv}</span>
                <textarea
                  disabled={pendingAction !== null}
                  onChange={(event) => setCsvText(event.target.value)}
                  rows={4}
                  value={csvText}
                />
              </label>
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
            </div>
          ) : (
            <div
              aria-labelledby="employee-add-invite-tab"
              className="employee-add-dialog-section"
              id="employee-add-invite-panel"
              role="tabpanel"
            >
              <div className="employee-invite-grid">
                <label className="policy-field">
                  <span>{text.name}</span>
                  <input
                    disabled={pendingAction !== null}
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
                    disabled={pendingAction !== null}
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
            </div>
          )}
        </DialogContent>
      </Dialog>
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

function getEmployeePolicyFormState(
  assignment: ProjectEmployeeAssignmentRecord | undefined,
  providerConnections: ProviderConnectionRecord[]
) {
  return {
    assignmentValues: {
      monthlyBudgetLimitUsd: assignment?.monthlyBudgetLimitUsd ?? 0,
      policyNote: assignment?.policy.note ?? "",
      rateLimitEnabled: assignment?.policy.rateLimit.enabled ?? false,
      rateLimitLimit: assignment?.policy.rateLimit.limit ?? 60,
      rateLimitRefillTokensPerSecond: getRateLimitRefillTokensPerSecond(
        assignment?.policy.rateLimit.limit ?? 60,
        assignment?.policy.rateLimit.windowSeconds ?? 60
      ),
      rateLimitWindowSeconds: assignment?.policy.rateLimit.windowSeconds ?? 60,
      warningThresholdPercent: assignment?.warningThresholdPercent ?? 80
    },
    providerModelRows: buildEmployeeProviderModelRows(assignment, providerConnections)
  };
}

function buildEmployeeProviderModelRows(
  assignment: ProjectEmployeeAssignmentRecord | undefined,
  providerConnections: ProviderConnectionRecord[]
): EmployeeProviderModelRow[] {
  const allowedProviderIds = uniqueStrings(
    assignment?.policy.allowedProviderConnectionIds ?? []
  );
  const allowedModels = uniqueStrings(assignment?.policy.allowedModelKeys ?? []);
  const allowedProviders = allowedProviderIds
    .map((providerId) =>
      providerConnections.find((providerConnection) => providerConnection.id === providerId)
    )
    .filter(
      (providerConnection): providerConnection is ProviderConnectionRecord =>
        Boolean(providerConnection)
    );
  const rows = allowedModels.map((modelName, index) => {
    const matchingProvider =
      allowedProviders.find((providerConnection) =>
        getProviderConnectionModels(providerConnection).includes(modelName)
      ) ??
      (allowedProviders.length === 1 ? allowedProviders[0] : undefined) ??
      providerConnections.find((providerConnection) =>
        getProviderConnectionModels(providerConnection).includes(modelName)
      );

    return {
      id: `saved-provider-model-${index}`,
      model: modelName,
      providerConnectionId: matchingProvider?.id ?? ""
    };
  });
  const representedProviderIds = new Set(rows.map((row) => row.providerConnectionId));

  for (const providerId of allowedProviderIds) {
    if (!representedProviderIds.has(providerId)) {
      rows.push({
        id: `saved-provider-only-${rows.length}`,
        model: "",
        providerConnectionId: providerId
      });
    }
  }

  return rows;
}

function getProviderConnectionModels(providerConnection: ProviderConnectionRecord): string[] {
  const models = providerConnection.providerConfig?.models;

  return Array.isArray(models)
    ? uniqueStrings(
        models.map((modelName) => (typeof modelName === "string" ? modelName : ""))
      )
    : [];
}

function providerModelKey(providerConnectionId: string, model: string) {
  return `${providerConnectionId.trim()}::${model.trim()}`;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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
