"use client";

import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Info,
  Save,
  Trash2,
  Upload,
  UserPlus,
  Users,
  Wallet
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ChangeEvent, type CSSProperties } from "react";
import { ManagementPage } from "@/components/layout/management-page";
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
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from "@/components/ui/tooltip";
import { AnalyticsRankedBarChart } from "@/features/analytics/components/analytics-charts";
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
import type { EmployeeUsageResponse } from "@/lib/control-plane/employee-usage-types";
import type { ProjectMonthlyCostReport } from "@/lib/gateway/live-cost-report";
import {
  getRateLimitRefillTokensPerSecond,
  getRateLimitWindowSeconds
} from "@/lib/control-plane/runtime-policy-types";
import { formatMicroUsdCurrency, nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";
import { parseCompactStepperInput } from "./employee-policy-unit-stepper";
import type {
  EmployeeUsageReadModel,
  EmployeeUsageRow
} from "../employee-usage-read-model";

type EmployeeControlManagementProps = {
  initialEmployeeId?: string;
  locale: Locale;
  model: EmployeeControlModel;
  monthlyCostReport: ProjectMonthlyCostReport;
  tenantMonthlyTokenLimit: number | null;
  usage: EmployeeUsageReadModel;
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

type CompactUnitStepperProps = {
  ariaLabel: string;
  decimals?: number;
  disabled?: boolean;
  max: number;
  min: number;
  onValueChange: (value: number) => void;
  step: number;
  unit: string;
  value: number;
};

type EmployeeSortDirection = "asc" | "desc";
type EmployeeSortField = "cost" | "department" | "name" | "project" | "weeklyCost";
type EmployeeAddMethod = "csv" | "invite";
type EmployeeCostRange = "24h" | "7d" | "30d";
const EMPLOYEE_WEEKLY_TOKEN_LIMIT_DEFAULT = 1_000_000;
const EMPLOYEE_WEEKLY_TOKEN_LIMIT_SLIDER_MAX = 10_000_000;
const EMPLOYEE_WEEKLY_TOKEN_LIMIT_SLIDER_STEP = 1_000_000;
const UNASSIGNED_DEPARTMENT_VALUE = "__unassigned_department__";

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

type EmployeeWeeklyTokenQuotaResponsePayload = {
  error?: string;
  status?: number;
  weeklyTokenQuota?: unknown;
};

const emptyCreateValues: EmployeeCreateValues = {
  department: "",
  email: "",
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
    createRequired: string;
    csv: string;
    csvUpload: string;
    department: string;
    departmentPlaceholder: string;
    departmentRequired: string;
    deleteConfirm: (count: number) => string;
    deleteFailed: string;
    deleteSelected: string;
    deleted: (successCount: number, failedCount: number) => string;
    disable: string;
    editDepartment: string;
    email: string;
    employeeAddTitle: string;
    employees: string;
    fixtureFallback: string;
    import: string;
    imported: string;
    invitationDeleteConfirm: (count: number) => string;
    invitationDeleteFailed: string;
    invitationDeleteSelected: string;
    invitationDeleted: (successCount: number, failedCount: number) => string;
    inviteSelected: string;
    inviteSend: string;
    inviteSent: string;
    name: string;
    next: string;
    noAssignments: string;
    noEmployees: string;
    note: string;
    page: string;
    previous: string;
    project: string;
    projectCount: string;
    remaining: string;
    save: string;
    selectAll: string;
    selectEmployee: string;
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
    budget: "This month's cost limit",
    cancel: "Cancel",
    created: "Created",
    createRequired: "Name, email, and department are required.",
    csv: "CSV",
    csvUpload: "CSV file upload",
    department: "Department",
    departmentPlaceholder: "Select or enter a department",
    departmentRequired: "Department is required.",
    deleteConfirm: (count) => `Delete ${count} selected employees? Their access will be revoked.`,
    deleteFailed: "Selected employees could not be deleted.",
    deleteSelected: "Delete",
    deleted: (successCount, failedCount) =>
      failedCount > 0
        ? `${successCount} deleted, ${failedCount} failed`
        : `${successCount} employees deleted.`,
    disable: "Disable",
    editDepartment: "Edit department",
    email: "Email",
    employeeAddTitle: "Individual Chat invite",
    employees: "Employees",
    fixtureFallback: "Control Plane unavailable. Showing fixture employees.",
    import: "Import",
    imported: "Imported",
    invitationDeleteConfirm: (count) =>
      `Delete ${count} pending invitations? Employee records and project assignments will remain, but existing invitation links will stop working.`,
    invitationDeleteFailed: "Selected invitations could not be deleted.",
    invitationDeleteSelected: "Delete invite",
    invitationDeleted: (successCount, failedCount) =>
      failedCount > 0
        ? `${successCount} invitations deleted, ${failedCount} failed`
        : `${successCount} invitations deleted.`,
    inviteSelected: "Send invite",
    inviteSend: "Send Chat invite",
    inviteSent: "Chat invitation email sent.",
    name: "Name",
    next: "Next",
    noAssignments: "No project employees.",
    noEmployees: "No employees.",
    note: "Note",
    page: "Page",
    previous: "Previous",
    project: "Project",
    projectCount: "Projects",
    remaining: "Remaining",
    save: "Save",
    selectAll: "Select all employees on this page",
    selectEmployee: "Select employee",
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
    allocation: "프로젝트 배정",
    assigned: "배정",
    budget: "이번 달 비용 한도",
    cancel: "취소",
    created: "생성",
    createRequired: "이름, 이메일, 부서를 입력하세요.",
    csv: "CSV",
    csvUpload: "CSV 파일 업로드",
    department: "부서",
    departmentPlaceholder: "기존 부서 선택 또는 새 부서 입력",
    departmentRequired: "부서를 입력하세요.",
    deleteConfirm: (count) =>
      `선택한 직원 ${count}명을 삭제할까요? 해당 직원의 접근 권한이 해제됩니다.`,
    deleteFailed: "선택한 직원을 삭제하지 못했습니다.",
    deleteSelected: "삭제",
    deleted: (successCount, failedCount) =>
      failedCount > 0
        ? `${successCount}명 삭제, ${failedCount}명 실패`
        : `${successCount}명의 직원을 삭제했습니다.`,
    disable: "비활성화",
    editDepartment: "부서 설정",
    email: "이메일",
    employeeAddTitle: "개별 채팅 초대",
    employees: "직원",
    fixtureFallback: "Control Plane을 사용할 수 없어 예시 직원을 표시 중입니다.",
    import: "등록",
    imported: "등록됨",
    invitationDeleteConfirm: (count) =>
      `선택한 대기 초대 ${count}개를 삭제할까요? 직원과 프로젝트 배정은 유지되고 기존 초대 링크만 무효화됩니다.`,
    invitationDeleteFailed: "선택한 초대를 삭제하지 못했습니다.",
    invitationDeleteSelected: "초대 삭제",
    invitationDeleted: (successCount, failedCount) =>
      failedCount > 0
        ? `${successCount}개 초대 삭제, ${failedCount}개 실패`
        : `${successCount}개의 초대를 삭제했습니다.`,
    inviteSelected: "초대 발송",
    inviteSend: "채팅 초대 보내기",
    inviteSent: "채팅 초대 메일을 발송했습니다.",
    name: "이름",
    next: "다음",
    noAssignments: "프로젝트에 배정된 직원이 없습니다.",
    noEmployees: "직원이 없습니다.",
    note: "메모",
    page: "페이지",
    previous: "이전",
    project: "프로젝트",
    projectCount: "프로젝트",
    remaining: "잔여",
    save: "저장",
    selectAll: "현재 페이지 직원 전체 선택",
    selectEmployee: "직원 선택",
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

const employeeUsageText = {
  en: {
    addProject: "Add to project",
    chatUsage: "Cost limits",
    costLoadFailed: "Employee cost data could not be loaded.",
    dailyLimit: "Daily cost limit",
    dailyUsage: "Cost today",
    exposureState: "Exposure state",
    ledgerPending: "Enforcement ledger connection pending",
    limitConflict: "This policy changed elsewhere. Reload and try again.",
    limitDisabled: "No limit",
    limitEnabled: "Enable daily cost limit",
    limitSaveFailed: "Employee cost limits could not be saved.",
    limitSaved: "Employee cost limits saved.",
    monitorMode: "Costs are monitored without restricting model routing.",
    restrictionMode: "High-cost models are restricted after the limit is reached.",
    saveLimit: "Save limit",
    detail: "Employee usage and controls",
    managePolicy: "Manage project policy",
    noProjectUsage: "No active project usage.",
    noProjectsAvailable: "No projects are available to add.",
    projectAddFailed: "Project could not be added.",
    projectAdded: "Project added.",
    projectBudget: "Project budget",
    projectRemove: "Expel",
    projectRemoveConfirm: "Remove this employee from the project?",
    projectRemoveFailed: "Project could not be removed.",
    projectRemoved: "Project removed.",
    projects: "Project management",
    selectProject: "Select project",
    tokens: "Confirmed cost today",
    unlimited: "Unlimited",
    usage: "Cost used",
    weeklyLimit: "Weekly cost limit",
    weeklyLimitEnabled: "Enable weekly cost limit",
    weeklyUnavailable: "Ledger pending",
    weeklyUsage: "Weekly cost",
    weeklyTokens: "Confirmed cost this week"
  },
  ko: {
    addProject: "프로젝트에 추가",
    chatUsage: "비용 한도",
    costLoadFailed: "직원 비용 데이터를 불러오지 못했습니다.",
    dailyLimit: "일일 비용 제한",
    dailyUsage: "오늘 사용 비용",
    exposureState: "노출 상태",
    ledgerPending: "집행 원장 연결 전",
    limitConflict: "다른 관리자가 정책을 변경했습니다. 새로고침 후 다시 시도하세요.",
    limitDisabled: "한도 없음",
    limitEnabled: "일일 비용 제한 사용",
    limitSaveFailed: "직원 비용 한도를 저장하지 못했습니다.",
    limitSaved: "직원 비용 한도를 저장했습니다.",
    monitorMode: "모델 라우팅을 제한하지 않고 비용만 모니터링합니다.",
    restrictionMode: "한도 도달 후 고비용 모델 사용을 제한합니다.",
    saveLimit: "한도 저장",
    detail: "직원 사용량 및 통제",
    managePolicy: "프로젝트 정책 관리",
    noProjectUsage: "활성 프로젝트 사용량이 없습니다.",
    noProjectsAvailable: "추가할 수 있는 프로젝트가 없습니다.",
    projectAddFailed: "프로젝트를 추가하지 못했습니다.",
    projectAdded: "프로젝트를 추가했습니다.",
    projectBudget: "프로젝트 예산",
    projectRemove: "추방",
    projectRemoveConfirm: "이 직원을 프로젝트에서 제거할까요?",
    projectRemoveFailed: "프로젝트에서 제거하지 못했습니다.",
    projectRemoved: "프로젝트에서 제거했습니다.",
    projects: "프로젝트 관리",
    selectProject: "프로젝트 선택",
    tokens: "오늘 확정 비용",
    unlimited: "무제한",
    usage: "사용 비용",
    weeklyLimit: "주간 비용 한도",
    weeklyLimitEnabled: "주간 비용 한도 사용",
    weeklyUnavailable: "원장 연결 전",
    weeklyUsage: "주간 사용 비용",
    weeklyTokens: "이번 주 확정 비용"
  }
} satisfies Record<Locale, Record<string, string>>;

const projectEmployeeText: Record<
  Locale,
  {
    addEmployee: string;
    assign: string;
    assigned: string;
    assignmentCreated: string;
    available: string;
    budget: string;
    cancel: string;
    confirmDisable: string;
    costLimit: string;
    dailyTokenLimit: string;
    dailyTokenColumn: string;
    dailyTokenUsage: string;
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
    monthlyUsage: string;
    name: string;
    noAssignments: string;
    noCandidates: string;
    noDepartments: string;
    noEmployees: string;
    note: string;
    quotaExceeded: string;
    quotaNotConfigured: string;
    quotaWarning: string;
    quotaWithinLimit: string;
    rateLimit: string;
    remaining: string;
    refillRequestsPerSecond: string;
    requestsPerMinute: string;
    save: string;
    searchEmployee: string;
    selectDepartment: string;
    unassignedDepartment: string;
    unlimited: string;
    budgetWarning: string;
  }
> = {
  en: {
    addEmployee: "Assign employee",
    assign: "Assign",
    assigned: "Assigned",
    assignmentCreated: "Employee assigned to this project.",
    available: "Available",
    budget: "This month's cost limit",
    cancel: "Cancel",
    confirmDisable: "Disable",
    costLimit: "Cost limit",
    dailyTokenLimit: "Daily token limit",
    dailyTokenColumn: "Daily token",
    dailyTokenUsage: "Used today (UTC)",
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
    monthlyUsage: "Used this month",
    name: "Name",
    noAssignments: "No project employees.",
    noCandidates: "No employees available for assignment.",
    noDepartments: "No departments found.",
    noEmployees: "No employees in this department.",
    note: "Note",
    quotaExceeded: "High-cost models restricted",
    quotaNotConfigured: "No quota",
    quotaWarning: "Near limit",
    quotaWithinLimit: "Within limit",
    rateLimit: "Rate Limit",
    remaining: "Project remaining budget",
    refillRequestsPerSecond: "Refill tokens / sec",
    requestsPerMinute: "Requests per minute",
    save: "Save",
    searchEmployee: "Search by name or email",
    selectDepartment: "Select department",
    unassignedDepartment: "No department",
    unlimited: "Unlimited",
    budgetWarning: "Budget warning"
  },
  ko: {
    addEmployee: "직원 배정",
    assign: "배정",
    assigned: "배정",
    assignmentCreated: "직원을 현재 프로젝트에 배정했습니다.",
    available: "미배정",
    budget: "이번 달 비용 한도",
    cancel: "취소",
    confirmDisable: "비활성화",
    costLimit: "비용 한도",
    dailyTokenLimit: "일일 토큰 한도",
    dailyTokenColumn: "일일 토큰",
    dailyTokenUsage: "오늘 사용 토큰 (UTC)",
    department: "부서",
    disable: "비활성화",
    disableConfirmMessage: " 직원을 현재 프로젝트에서 비활성화합니다. 계속하시겠습니까?",
    disableConfirmTitle: "직원 비활성화",
    email: "이메일",
    employeeList: "직원 목록",
    employees: "직원",
    enabled: "활성화",
    fixtureFallback: "Control Plane을 사용할 수 없어 예시 직원을 표시 중입니다.",
    management: "관리",
    monthlyUsage: "이번 달 사용액",
    name: "이름",
    noAssignments: "프로젝트에 배정된 직원이 없습니다.",
    noCandidates: "배정할 수 있는 직원이 없습니다.",
    noDepartments: "등록된 부서가 없습니다.",
    noEmployees: "이 부서에 배정 가능한 직원이 없습니다.",
    note: "메모",
    quotaExceeded: "고비용 모델 제한",
    quotaNotConfigured: "한도 미설정",
    quotaWarning: "한도 임박",
    quotaWithinLimit: "정상",
    rateLimit: "요청 제한",
    remaining: "프로젝트 잔여 예산",
    refillRequestsPerSecond: "초당 토큰 충전",
    requestsPerMinute: "분당 요청 한도",
    save: "저장",
    searchEmployee: "이름 또는 이메일 검색",
    selectDepartment: "부서 선택",
    unassignedDepartment: "부서 미지정",
    unlimited: "무제한",
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
  project
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
  const hasUnassignedEmployees = useMemo(
    () =>
      model.employees.some(
        (employee) =>
          (employee.status === "active" || employee.status === "staged") &&
          !employee.department?.trim() &&
          !activeAssignmentByEmployeeId.has(employee.id)
      ),
    [activeAssignmentByEmployeeId, model.employees]
  );
  const [assignmentValues, setAssignmentValues] = useState({
    dailyTokenLimit: 0,
    monthlyBudgetLimitUsd: 0,
    policyNote: "",
    rateLimitEnabled: false,
    rateLimitLimit: 60,
    rateLimitRefillTokensPerSecond: 1,
    rateLimitWindowSeconds: 60,
    warningThresholdPercent: 80
  });
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
          (assignmentDepartment === UNASSIGNED_DEPARTMENT_VALUE
            ? Boolean(employee.department?.trim())
            : employee.department?.trim() !== assignmentDepartment)
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
    const formState = getEmployeePolicyFormState(existingAssignment);

    setAssignmentValues(formState.assignmentValues);
  }, [assignments, selectedEmployeeId]);

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
  const selectedDailyTokenProgress = Math.min(
    Math.max(selectedAssignment?.dailyTokenUsagePercent ?? 0, 0),
    100
  );
  const assignmentValuesInvalid =
    !Number.isInteger(assignmentValues.dailyTokenLimit) ||
    assignmentValues.dailyTokenLimit < 0 ||
    assignmentValues.dailyTokenLimit > 1000000000 ||
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
    assignmentValues.warningThresholdPercent > 100;
  const employeeToDisable = assignmentToDisable
    ? model.employees.find((employee) => employee.id === assignmentToDisable.employeeId)
    : undefined;

  function openAssignmentDialog() {
    setAssignmentDepartment(
      tenantDepartments[0] ??
        (hasUnassignedEmployees ? UNASSIGNED_DEPARTMENT_VALUE : "")
    );
    setEmployeeSearchQuery("");
    setCandidateEmployeeId("");
    setIsAssignmentDialogOpen(true);
  }

  function openEmployeePolicyDialog(employeeId: string) {
    const existingAssignment = assignments.find(
      (assignment) => assignment.employeeId === employeeId
    );
    const formState = getEmployeePolicyFormState(existingAssignment);

    setSelectedEmployeeId(employeeId);
    setAssignmentValues(formState.assignmentValues);
    setSubmitState({ message: "", status: "idle" });
    setIsEmployeePolicyDialogOpen(true);
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
      dailyTokenLimit: existingAssignment?.policy.dailyTokenLimit.limit ?? 0,
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
      dailyTokenLimit: assignmentValues.dailyTokenLimit,
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
    if (assignment.policy.dailyTokenLimit.limit !== assignmentValues.dailyTokenLimit) {
      setSubmitState({
        message:
          locale === "ko"
            ? "일일 토큰 한도가 저장 결과에 반영되지 않았습니다. 다시 시도해 주세요."
            : "The daily token limit was not reflected in the saved policy. Please try again.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }
    setAssignments((current) => upsertAssignment(current, assignment));
    setSubmitState({
      message: locale === "ko" ? "직원 정책이 저장되었습니다." : "Employee policy saved.",
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
            <colgroup>
              <col className="project-employee-name-column" />
              <col className="project-employee-department-column" />
              <col className="project-employee-cost-column" />
              <col className="project-employee-token-column" />
              <col className="project-employee-action-column" />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">{text.name}</th>
                <th scope="col">{text.department}</th>
                <th scope="col">{text.costLimit}</th>
                <th scope="col">{text.dailyTokenColumn}</th>
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
                    <td>
                      <div className="project-employee-quota-cell">
                        <strong>
                          {formatTokenCount(assignment.dailyTokenUsed, locale)} /{" "}
                          {formatTokenLimit(
                            assignment.policy.dailyTokenLimit.limit,
                            locale,
                            assignment.policy.dailyTokenLimit.enabled,
                            text.unlimited
                          )}
                        </strong>
                        <small data-quota-status={assignment.dailyTokenStatus}>
                          {{
                            exceeded: text.quotaExceeded,
                            not_configured: text.quotaNotConfigured,
                            warning: text.quotaWarning,
                            within_limit: text.quotaWithinLimit
                          }[assignment.dailyTokenStatus]}
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
          {submitState.status === "success" && submitState.message ? (
            <Alert>
              <AlertDescription>{submitState.message}</AlertDescription>
            </Alert>
          ) : null}
          <div className="employee-policy-tab-content">
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
              <div
                className="employee-policy-usage-summary"
                data-quota-status={selectedAssignment?.dailyTokenStatus ?? "not_configured"}
              >
                <div className="employee-policy-usage-heading">
                  <span>{text.dailyTokenUsage}</span>
                </div>
                <strong>
                  {formatTokenCount(selectedAssignment?.dailyTokenUsed ?? 0, locale)} /{" "}
                  {formatTokenLimit(
                    selectedAssignment?.policy.dailyTokenLimit.limit ?? 0,
                    locale,
                    selectedAssignment?.policy.dailyTokenLimit.enabled ?? false,
                    text.unlimited
                  )}
                </strong>
                <div
                  aria-label={text.dailyTokenUsage}
                  aria-valuemax={100}
                  aria-valuemin={0}
                  aria-valuenow={Math.round(selectedDailyTokenProgress)}
                  className="employee-policy-quota-progress"
                  role="progressbar"
                >
                  <span style={{ width: selectedDailyTokenProgress + "%" }} />
                </div>
              </div>
              <div className="modal-form-grid project-employee-policy-fields">
                <div className="employee-policy-compact-row">
                  <span>{text.dailyTokenLimit}</span>
                  <CompactUnitStepper
                    ariaLabel={text.dailyTokenLimit}
                    max={1000000}
                    min={0}
                    onValueChange={(value) =>
                      setAssignmentValues((current) => ({
                        ...current,
                        dailyTokenLimit: value * 1000
                      }))
                    }
                    step={1}
                    unit="K"
                    value={assignmentValues.dailyTokenLimit / 1000}
                  />
                </div>
                <div className="employee-policy-compact-row">
                  <span>{text.budget}</span>
                  <CompactUnitStepper
                    ariaLabel={text.budget}
                    decimals={2}
                    max={100000000}
                    min={0}
                    onValueChange={(value) =>
                      setAssignmentValues((current) => ({
                        ...current,
                        monthlyBudgetLimitUsd: value
                      }))
                    }
                    step={1}
                    unit="USD"
                    value={assignmentValues.monthlyBudgetLimitUsd}
                  />
                </div>
                <label className="employee-policy-compact-row employee-budget-warning-field">
                  <span>{text.budgetWarning}</span>
                  <span className="employee-policy-input-suffix employee-policy-compact-input employee-policy-warning-input">
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
          </div>
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
                disabled={
                  pendingAction !== null ||
                  (tenantDepartments.length === 0 && !hasUnassignedEmployees)
                }
                onChange={(event) => {
                  setAssignmentDepartment(event.target.value);
                  setCandidateEmployeeId("");
                }}
                value={assignmentDepartment}
              >
                {tenantDepartments.length === 0 && !hasUnassignedEmployees ? (
                  <option value="">{text.noDepartments}</option>
                ) : null}
                {tenantDepartments.map((department) => (
                  <option key={department} value={department}>
                    {department}
                  </option>
                ))}
                {hasUnassignedEmployees ? (
                  <option value={UNASSIGNED_DEPARTMENT_VALUE}>
                    {text.unassignedDepartment}
                  </option>
                ) : null}
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

export function EmployeeControlManagement({
  initialEmployeeId,
  locale,
  model,
  monthlyCostReport,
  tenantMonthlyTokenLimit,
  usage
}: EmployeeControlManagementProps) {
  const router = useRouter();
  const text = employeeText[locale];
  const usageText = employeeUsageText[locale];
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
  const [departmentEmployee, setDepartmentEmployee] = useState<EmployeeRecord | null>(null);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(
    initialEmployeeId ?? null
  );
  const [isProjectAssignmentOpen, setIsProjectAssignmentOpen] = useState(false);
  const [candidateProjectId, setCandidateProjectId] = useState("");
  const [projectAssignmentToRemoveId, setProjectAssignmentToRemoveId] = useState<
    string | null
  >(null);
  const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
  const [tokenLimitSubmitState, setTokenLimitSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const [departmentValue, setDepartmentValue] = useState("");
  const [sortState, setSortState] = useState<{
    direction: EmployeeSortDirection;
    field: EmployeeSortField;
  }>({
    direction: "desc",
    field: "cost"
  });
  const [pageIndex, setPageIndex] = useState(0);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const tenantDepartments = useMemo(
    () =>
      Array.from(
        new Set(
          employees
            .map((employee) => employee.department?.trim())
            .filter((department): department is string => Boolean(department))
        )
      ).sort((left, right) => left.localeCompare(right)),
    [employees]
  );
  const usageByEmployeeId = useMemo(
    () => new Map(usage.rows.map((row) => [row.employeeId, row])),
    [usage.rows]
  );
  const initialEmployeeCostChartRows = useMemo(
    () =>
      usage.rows.slice(0, 10).map((row) => ({
        id: row.employeeId,
        label: row.name,
        value: row.dailyCostMicroUsd ?? 0
      })),
    [usage.rows]
  );
  const [employeeCostRange, setEmployeeCostRange] = useState<EmployeeCostRange>("24h");
  const [employeeCostChartRows, setEmployeeCostChartRows] = useState(
    initialEmployeeCostChartRows
  );
  const [employeeCostChartLoading, setEmployeeCostChartLoading] = useState(false);
  const [employeeCostChartError, setEmployeeCostChartError] = useState<string | null>(null);
  const employeeCostChartActiveRows = employeeCostChartRows.filter((row) => row.value > 0);
  const employeeCostChartVisibleTotal = employeeCostChartActiveRows.reduce(
    (total, row) => total + row.value,
    0
  );
  const employeeCostChartAverage =
    employeeCostChartActiveRows.length > 0
      ? employeeCostChartVisibleTotal / employeeCostChartActiveRows.length
      : 0;
  const employeeCostChartTopEmployee = employeeCostChartActiveRows[0] ?? null;
  const employeeCostChartOutlierCount = employeeCostChartActiveRows.filter(
    (row) => row.value >= employeeCostChartAverage * 1.5
  ).length;

  useEffect(() => {
    const controller = new AbortController();
    const namesByEmployeeId = new Map(usage.rows.map((row) => [row.employeeId, row.name]));
    setEmployeeCostChartLoading(true);
    setEmployeeCostChartError(null);

    void fetch(
      `/api/control-plane/employees?tenantId=${encodeURIComponent(model.controlPlaneTenantId)}&range=${employeeCostRange}`,
      { signal: controller.signal }
    )
      .then(async (response) => {
        const payload = (await response.json().catch(() => ({}))) as {
          data?: EmployeeUsageResponse;
          error?: string;
        };
        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Unable to load tenant chat employee usage.");
        }
        setEmployeeCostChartRows(
          payload.data.data.map((row) => ({
            id: row.employeeId,
            label: namesByEmployeeId.get(row.employeeId) ?? row.name ?? row.email,
            value: row.sources.tenantChat.costMicroUsd
          }))
        );
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setEmployeeCostChartError(
          locale === "ko"
            ? "Tenant Chat 사용 비용을 불러오지 못했습니다."
            : "Unable to load Tenant Chat cost usage."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setEmployeeCostChartLoading(false);
        }
      });

    return () => controller.abort();
  }, [employeeCostRange, locale, model.controlPlaneTenantId, usage.rows]);
  const selectedUsage = selectedEmployeeId
    ? usageByEmployeeId.get(selectedEmployeeId) ?? null
    : null;
  const monthlyProjectCostById = useMemo(
    () => new Map(monthlyCostReport.projectCosts.map((row) => [row.projectId, row])),
    [monthlyCostReport.projectCosts]
  );
  const availableProjectsForEmployee = selectedUsage
    ? projects.filter(
        (project) =>
          project.status === "ACTIVE" &&
          !selectedUsage.projects.some((usageProject) => usageProject.projectId === project.id)
      )
    : [];

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
      } else if (sortState.field === "cost") {
        result =
          (usageByEmployeeId.get(left.id)?.dailyCostMicroUsd ?? -1) -
          (usageByEmployeeId.get(right.id)?.dailyCostMicroUsd ?? -1);
      } else if (sortState.field === "weeklyCost") {
        result =
          (usageByEmployeeId.get(left.id)?.weeklyCostMicroUsd ?? -1) -
          (usageByEmployeeId.get(right.id)?.weeklyCostMicroUsd ?? -1);
      } else {
        result = compareEmployeeName(left, right);
      }

      if (result === 0) {
        result = compareEmployeeName(left, right) || left.email.localeCompare(right.email);
      }

      return sortState.direction === "asc" ? result : -result;
    });

    return nextEmployees;
  }, [employees, projectNamesByEmployeeId, sortState.direction, sortState.field, usageByEmployeeId]);

  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(sortedEmployees.length / pageSize));
  const currentPageEmployees = sortedEmployees.slice(
    pageIndex * pageSize,
    pageIndex * pageSize + pageSize
  );
  const selectedEmployeeIdSet = new Set(selectedEmployeeIds);
  const selectableCurrentPageEmployees = currentPageEmployees;
  const allCurrentPageEmployeesSelected =
    selectableCurrentPageEmployees.length > 0 &&
    selectableCurrentPageEmployees.every((employee) =>
      selectedEmployeeIdSet.has(employee.id)
    );
  const selectedEmployeeCount = employees.filter((employee) =>
    selectedEmployeeIdSet.has(employee.id)
  ).length;
  const selectedInvitationEmployeeCount = employees.filter(
    (employee) =>
      employee.invitationStatus !== "accepted" &&
      selectedEmployeeIdSet.has(employee.id)
  ).length;
  const selectedPendingInvitationEmployeeCount = employees.filter(
    (employee) =>
      employee.invitationStatus === "pending" &&
      selectedEmployeeIdSet.has(employee.id)
  ).length;

  useEffect(() => {
    if (pageIndex >= pageCount) {
      setPageIndex(pageCount - 1);
    }
  }, [pageCount, pageIndex]);

  useEffect(() => {
    setSelectedEmployeeId(initialEmployeeId ?? null);
  }, [initialEmployeeId]);

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
    if (
      !createValues.email.trim() ||
      !createValues.name.trim() ||
      !createValues.department.trim()
    ) {
      setSubmitState({
        message: text.createRequired,
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
    setPageIndex(0);
    setSubmitState({ message: text.inviteSent, status: "success" });
    setPendingAction(null);
    setIsAddDialogOpen(false);
    router.refresh();
  }

  function openDepartmentDialog(employee: EmployeeRecord) {
    setDepartmentEmployee(employee);
    setDepartmentValue(employee.department?.trim() ?? "");
    setSubmitState({ message: "", status: "idle" });
  }

  async function submitEmployeeDepartment() {
    if (!departmentEmployee || !departmentValue.trim()) {
      setSubmitState({ message: text.departmentRequired, status: "error" });
      return;
    }

    setPendingAction(`department:${departmentEmployee.id}`);
    setSubmitState({ message: "", status: "idle" });

    const response = await fetch("/api/control-plane/employees", {
      body: JSON.stringify({
        action: "update",
        values: {
          department: departmentValue.trim(),
          employeeId: departmentEmployee.id,
          tenantId: model.controlPlaneTenantId
        }
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
    const payload = (await response.json().catch(() => ({}))) as EmployeeResponsePayload;

    if (!response.ok || !payload.employee) {
      setSubmitState({
        message: payload.error ?? "Employee department update failed.",
        status: "error"
      });
      setPendingAction(null);
      return;
    }

    mergeEmployees([payload.employee]);
    setDepartmentEmployee(null);
    setDepartmentValue("");
    setSubmitState({
      message: locale === "ko" ? "직원 부서를 저장했습니다." : "Employee department saved.",
      status: "success"
    });
    setPendingAction(null);
    router.refresh();
  }

  async function sendInvitesForSelectedEmployees() {
    const selectedIds = new Set(selectedEmployeeIds);
    const targets = employees.filter(
      (employee) =>
        selectedIds.has(employee.id) && employee.invitationStatus !== "accepted"
    );
    if (targets.length === 0) {
      setSubmitState({
        message:
          locale === "ko"
            ? "초대할 직원을 선택하세요."
            : "Select employees to invite.",
        status: "error"
      });
      return;
    }

    setPendingAction("inviteSelected");
    setSubmitState({ message: "", status: "idle" });

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
    const invitedEmployeeIds = new Set(
      invitations.map((invitation) => invitation.employee.id)
    );
    setSelectedEmployeeIds((current) =>
      current.filter((employeeId) => !invitedEmployeeIds.has(employeeId))
    );
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

  async function deleteInvitationsForSelectedEmployees() {
    const selectedIds = new Set(selectedEmployeeIds);
    const targets = employees.filter(
      (employee) =>
        selectedIds.has(employee.id) && employee.invitationStatus === "pending"
    );

    if (
      targets.length === 0 ||
      !window.confirm(text.invitationDeleteConfirm(targets.length))
    ) {
      return;
    }

    setPendingAction("deleteInvitations");
    setSubmitState({ message: "", status: "idle" });

    try {
      const revokedEmployees: EmployeeRecord[] = [];
      let failedCount = 0;

      for (let index = 0; index < targets.length; index += 5) {
        const batch = targets.slice(index, index + 5);
        const results = await Promise.all(
          batch.map(async (employee) => {
            try {
              const response = await fetch("/api/control-plane/employees", {
                body: JSON.stringify({
                  action: "deleteInvitation",
                  values: {
                    employeeId: employee.id,
                    tenantId: model.controlPlaneTenantId
                  }
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST"
              });
              const payload = (await response.json().catch(() => ({}))) as EmployeeResponsePayload;

              return response.ok && payload.employee?.invitationStatus === "revoked"
                ? payload.employee
                : null;
            } catch {
              return null;
            }
          })
        );

        for (const employee of results) {
          if (employee) {
            revokedEmployees.push(employee);
          } else {
            failedCount += 1;
          }
        }
      }

      mergeEmployees(revokedEmployees);
      const revokedEmployeeIds = new Set(
        revokedEmployees.map((employee) => employee.id)
      );
      setSelectedEmployeeIds((current) =>
        current.filter((employeeId) => !revokedEmployeeIds.has(employeeId))
      );
      setSubmitState({
        message:
          revokedEmployees.length > 0
            ? text.invitationDeleted(revokedEmployees.length, failedCount)
            : text.invitationDeleteFailed,
        status: failedCount > 0 || revokedEmployees.length === 0 ? "error" : "success"
      });
      router.refresh();
    } catch {
      setSubmitState({ message: text.invitationDeleteFailed, status: "error" });
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteSelectedEmployees() {
    const selectedIds = new Set(selectedEmployeeIds);
    const targets = employees.filter((employee) => selectedIds.has(employee.id));

    if (targets.length === 0 || !window.confirm(text.deleteConfirm(targets.length))) {
      return;
    }

    setPendingAction("deleteSelected");
    setSubmitState({ message: "", status: "idle" });

    try {
      const deletedEmployeeIds: string[] = [];
      let failedCount = 0;

      for (let index = 0; index < targets.length; index += 5) {
        const batch = targets.slice(index, index + 5);
        const results = await Promise.all(
          batch.map(async (employee) => {
            try {
              const response = await fetch("/api/control-plane/employees", {
                body: JSON.stringify({
                  action: "update",
                  values: {
                    employeeId: employee.id,
                    status: "archived",
                    tenantId: model.controlPlaneTenantId
                  }
                }),
                headers: { "Content-Type": "application/json" },
                method: "POST"
              });
              const payload = (await response.json().catch(() => ({}))) as EmployeeResponsePayload;

              return response.ok && payload.employee?.status === "archived"
                ? employee.id
                : null;
            } catch {
              return null;
            }
          })
        );

        for (const employeeId of results) {
          if (employeeId) {
            deletedEmployeeIds.push(employeeId);
          } else {
            failedCount += 1;
          }
        }
      }

      const deletedIdSet = new Set(deletedEmployeeIds);
      setEmployees((current) => current.filter((employee) => !deletedIdSet.has(employee.id)));
      setSelectedEmployeeIds((current) =>
        current.filter((employeeId) => !deletedIdSet.has(employeeId))
      );
      setSelectedEmployeeId((current) =>
        current && deletedIdSet.has(current) ? null : current
      );
      setSubmitState({
        message:
          deletedEmployeeIds.length > 0
            ? text.deleted(deletedEmployeeIds.length, failedCount)
            : text.deleteFailed,
        status: failedCount > 0 || deletedEmployeeIds.length === 0 ? "error" : "success"
      });
      router.refresh();
    } catch {
      setSubmitState({ message: text.deleteFailed, status: "error" });
    } finally {
      setPendingAction(null);
    }
  }

  function toggleEmployeeSelection(employeeId: string, checked: boolean) {
    setSelectedEmployeeIds((current) => {
      if (checked) {
        return current.includes(employeeId) ? current : [...current, employeeId];
      }
      return current.filter((currentEmployeeId) => currentEmployeeId !== employeeId);
    });
  }

  function toggleCurrentPageEmployeeSelection(checked: boolean) {
    const currentPageIds = new Set(
      selectableCurrentPageEmployees.map((employee) => employee.id)
    );
    setSelectedEmployeeIds((current) => {
      if (checked) {
        return Array.from(new Set([...current, ...currentPageIds]));
      }
      return current.filter((employeeId) => !currentPageIds.has(employeeId));
    });
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

  async function submitEmployeeProjectAssignment() {
    if (!selectedUsage || !candidateProjectId) {
      return;
    }

    const existingAssignment = assignmentsByProjectId[candidateProjectId]?.find(
      (assignment) => assignment.employeeId === selectedUsage.employeeId
    );
    const values: ProjectEmployeeAssignmentValues = {
      dailyTokenLimit: existingAssignment?.policy.dailyTokenLimit.limit ?? 0,
      employeeId: selectedUsage.employeeId,
      monthlyBudgetLimitUsd: existingAssignment?.monthlyBudgetLimitUsd ?? 0,
      policyNote: existingAssignment?.policy.note ?? "",
      projectId: candidateProjectId,
      rateLimitEnabled: existingAssignment?.policy.rateLimit.enabled ?? false,
      rateLimitLimit: existingAssignment?.policy.rateLimit.limit ?? 60,
      rateLimitWindowSeconds: existingAssignment?.policy.rateLimit.windowSeconds ?? 60,
      status: "active",
      warningThresholdPercent: existingAssignment?.warningThresholdPercent ?? 80
    };

    setPendingAction("assignProject");
    setTokenLimitSubmitState({ message: "", status: "idle" });

    try {
      const response = await fetch("/api/control-plane/employees", {
        body: JSON.stringify({ action: "assign", values }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as ProjectEmployeeResponsePayload;

      if (!response.ok || !payload.assignment) {
        setTokenLimitSubmitState({
          message: payload.error ?? usageText.projectAddFailed,
          status: "error"
        });
        return;
      }

      mergeAssignments([payload.assignment]);
      setCandidateProjectId("");
      setIsProjectAssignmentOpen(false);
      setTokenLimitSubmitState({ message: usageText.projectAdded, status: "success" });
      router.refresh();
    } catch {
      setTokenLimitSubmitState({ message: usageText.projectAddFailed, status: "error" });
    } finally {
      setPendingAction(null);
    }
  }

  async function submitEmployeeProjectRemoval(projectId: string) {
    if (!selectedUsage) {
      return;
    }

    const assignment = assignmentsByProjectId[projectId]?.find(
      (candidate) =>
        candidate.employeeId === selectedUsage.employeeId && candidate.status === "active"
    );
    if (!assignment) {
      setTokenLimitSubmitState({ message: usageText.projectRemoveFailed, status: "error" });
      return;
    }

    const action = `removeProject:${projectId}`;
    setPendingAction(action);
    setTokenLimitSubmitState({ message: "", status: "idle" });

    try {
      const response = await fetch("/api/control-plane/employees", {
        body: JSON.stringify({
          action: "disableAssignment",
          values: {
            employeeId: selectedUsage.employeeId,
            projectId
          }
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as ProjectEmployeeResponsePayload;

      if (!response.ok || !payload.assignment) {
        setTokenLimitSubmitState({
          message: payload.error ?? usageText.projectRemoveFailed,
          status: "error"
        });
        return;
      }

      mergeAssignments([payload.assignment]);
      setProjectAssignmentToRemoveId(null);
      setTokenLimitSubmitState({ message: usageText.projectRemoved, status: "success" });
      router.refresh();
    } catch {
      setTokenLimitSubmitState({ message: usageText.projectRemoveFailed, status: "error" });
    } finally {
      setPendingAction(null);
    }
  }

  function openEmployeeAddDialog() {
    setAddMethod("csv");
    setSubmitState({ message: "", status: "idle" });
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
    <ManagementPage className="employee-console" title={text.title}>

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
      <section aria-label={usageText.detail} className="employee-usage-ranking">
        <div className="employee-usage-ranking-heading">
          <div>
            <h3>{locale === "ko" ? "직원별 사용 비용" : "Employee cost usage"}</h3>
            <p>
              {locale === "ko"
                ? "Tenant Chat의 Provider 확정 비용만 표시하는 읽기 전용 지표입니다."
                : "A read-only view of Provider-confirmed Tenant Chat cost only."}
              {usage.periodTimezone ? ` · ${usage.periodTimezone}` : ""}
            </p>
          </div>
          <div className="employee-cost-range-actions" role="group">
            {(["24h", "7d", "30d"] as const).map((range) => (
              <Button
                aria-pressed={employeeCostRange === range}
                key={range}
                onClick={() => setEmployeeCostRange(range)}
                size="sm"
                type="button"
                variant={employeeCostRange === range ? "default" : "outline"}
              >
                {range === "24h" ? (locale === "ko" ? "1일" : "24h") : range === "7d" ? (locale === "ko" ? "1주일" : "7d") : (locale === "ko" ? "1개월" : "30d")}
              </Button>
            ))}
            <span>USD</span>
          </div>
        </div>
        <div className="employee-cost-overview-layout">
          <div className="employee-cost-chart-panel">
            {employeeCostChartError ? (
              <p className="employee-usage-ranking-empty">{employeeCostChartError}</p>
            ) : employeeCostChartLoading ? (
              <p className="employee-usage-ranking-empty">
                {locale === "ko" ? "사용 비용을 불러오는 중입니다." : "Loading cost usage."}
              </p>
            ) : employeeCostChartRows.some((row) => row.value > 0) ? (
              <AnalyticsRankedBarChart
                ariaLabel={
                  locale === "ko" ? "기간별 직원 사용 비용" : "Employee cost usage by period"
                }
                className="employee-cost-ranking-chart"
                kind="micro-usd"
                maxRows={10}
                orientation="vertical"
                outlierMultiplier={1.5}
                rows={employeeCostChartRows}
              />
            ) : (
              <p className="employee-usage-ranking-empty">
                {locale === "ko"
                  ? "선택한 기간에 확정된 Tenant Chat 사용 비용이 없습니다."
                  : "No confirmed Tenant Chat cost was recorded during the selected period."}
              </p>
            )}
          </div>
          <aside
            aria-label={locale === "ko" ? "직원 비용 인사이트" : "Employee cost insights"}
            className="employee-cost-insights"
          >
            <div className="employee-cost-insights-heading">
              <div>
                <span>{locale === "ko" ? "비용 인사이트" : "Cost insights"}</span>
                <strong>{locale === "ko" ? "현재 기간 요약" : "Current period"}</strong>
              </div>
              <span className="employee-cost-insights-status">
                {locale === "ko" ? "확정 비용" : "Confirmed"}
              </span>
            </div>
            <dl className="employee-cost-insights-metrics">
              <div className="employee-cost-insights-primary">
                <dt>{locale === "ko" ? "기간 총 비용" : "Total cost"}</dt>
                <dd>{formatMicroUsd(employeeCostChartVisibleTotal, locale)}</dd>
              </div>
              <div>
                <dt>{locale === "ko" ? "사용 직원 평균" : "Average per employee"}</dt>
                <dd>{formatMicroUsd(employeeCostChartAverage, locale)}</dd>
              </div>
              <div>
                <dt>{locale === "ko" ? "비용 발생 직원" : "Active employees"}</dt>
                <dd>
                  {employeeCostChartActiveRows.length}
                  {locale === "ko" ? "명" : ""}
                </dd>
              </div>
            </dl>
            <div className="employee-cost-insights-highlight">
              <span>{locale === "ko" ? "최고 사용 직원" : "Top employee"}</span>
              <div>
                <strong>{employeeCostChartTopEmployee?.label ?? "-"}</strong>
                <b>
                  {employeeCostChartTopEmployee
                    ? formatMicroUsd(employeeCostChartTopEmployee.value, locale)
                    : "-"}
                </b>
              </div>
            </div>
            <div className="employee-cost-insights-note">
              <i aria-hidden="true" />
              <span>
                {locale === "ko"
                  ? `평균의 1.5배 이상 사용한 직원 ${employeeCostChartOutlierCount}명`
                  : `${employeeCostChartOutlierCount} employees used at least 1.5× the average`}
              </span>
            </div>
          </aside>
        </div>
      </section>
      <section className="employee-list-section">
        <div className="employee-list-toolbar employee-list-actions">
          <div className="employee-selection-actions">
            <Button
              className="compact-action-button"
              disabled={pendingAction !== null || selectedInvitationEmployeeCount === 0}
              onClick={() => void sendInvitesForSelectedEmployees()}
              size="sm"
              type="button"
              variant="outline"
            >
              <UserPlus aria-hidden="true" />
              {pendingAction === "inviteSelected" ? "..." : text.inviteSelected}
            </Button>
            <Button
              className="compact-action-button"
              disabled={pendingAction !== null || selectedPendingInvitationEmployeeCount === 0}
              onClick={() => void deleteInvitationsForSelectedEmployees()}
              size="sm"
              type="button"
              variant="outline"
            >
              <Trash2 aria-hidden="true" />
              {pendingAction === "deleteInvitations" ? "..." : text.invitationDeleteSelected}
            </Button>
            <Button
              className="compact-action-button"
              disabled={pendingAction !== null || selectedEmployeeCount === 0}
              onClick={() => void deleteSelectedEmployees()}
              size="sm"
              type="button"
              variant="destructive"
            >
              <Trash2 aria-hidden="true" />
              {pendingAction === "deleteSelected" ? "..." : text.deleteSelected}
            </Button>
          </div>
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
                <label className="employee-selection-control employee-selection-header">
                  <input
                    aria-label={text.selectAll}
                    checked={allCurrentPageEmployeesSelected}
                    disabled={selectableCurrentPageEmployees.length === 0}
                    onChange={(event) =>
                      toggleCurrentPageEmployeeSelection(event.target.checked)
                    }
                    type="checkbox"
                  />
                </label>
                {renderEmployeeSortHeader("name", text.name)}
                {renderEmployeeSortHeader("department", text.department)}
                {renderEmployeeSortHeader("cost", usageText.tokens)}
                {renderEmployeeSortHeader("weeklyCost", usageText.weeklyTokens)}
                {renderEmployeeSortHeader("project", text.projectCount)}
                <span aria-hidden="true" className="employee-list-header-spacer" />
              </div>
              <div className="employee-list">
                {currentPageEmployees.map((employee) => {
                  const projectNames = projectNamesByEmployeeId.get(employee.id) ?? [];
                  const employeeUsage = usageByEmployeeId.get(employee.id);
                  return (
                    <article
                      className="employee-list-row"
                      key={employee.id}
                      onClick={(event) => {
                        const target = event.target as HTMLElement;
                        if (target.closest("button, input, label, a")) {
                          return;
                        }
                        setSelectedEmployeeId(employee.id);
                      }}
                    >
                      <label
                        className="employee-selection-control employee-list-cell"
                        data-label={text.selectEmployee}
                      >
                        <input
                          aria-label={`${text.selectEmployee}: ${nullableText(employee.name, employee.email)}`}
                          checked={selectedEmployeeIdSet.has(employee.id)}
                          disabled={pendingAction !== null}
                          onChange={(event) =>
                            toggleEmployeeSelection(employee.id, event.target.checked)
                          }
                          type="checkbox"
                        />
                      </label>
                      <div
                        className="employee-list-cell employee-name-cell"
                        data-label={text.name}
                      >
                        <button
                          className="employee-detail-trigger"
                          onClick={() => setSelectedEmployeeId(employee.id)}
                          type="button"
                        >
                          <span>
                            <strong>{nullableText(employee.name, employee.email)}</strong>
                            <span className="employee-name-metadata">
                              <span className="employee-email-reveal">
                                <span aria-hidden="true" className="employee-email-mask">***</span>
                                <span className="employee-email-value">{employee.email}</span>
                              </span>
                              <Badge
                                className="employee-invitation-status"
                                variant={invitationStatusVariant(employee.invitationStatus)}
                              >
                                {formatInvitationStatus(employee.invitationStatus, locale)}
                              </Badge>
                            </span>
                          </span>
                        </button>
                      </div>
                      <div
                        className="employee-list-cell employee-department-cell"
                        data-label={text.department}
                      >
                        <button
                          aria-label={`${nullableText(employee.name, employee.email)} ${text.editDepartment}`}
                          className="employee-department-edit-button"
                          disabled={pendingAction !== null}
                          onClick={() => openDepartmentDialog(employee)}
                          type="button"
                        >
                          {nullableText(employee.department, text.editDepartment)}
                        </button>
                      </div>
                      <div
                        className="employee-list-cell employee-token-cell"
                        data-label={usageText.tokens}
                      >
                        <strong
                          data-rank={
                            employeeUsage &&
                            (employeeUsage.dailyCostMicroUsd ?? 0) > 0 &&
                            employeeUsage.dailyRank <= 3
                              ? employeeUsage.dailyRank
                              : undefined
                          }
                        >
                          {formatMicroUsd(employeeUsage?.dailyCostMicroUsd ?? null, locale)}
                        </strong>
                      </div>
                      <div
                        className="employee-list-cell employee-token-cell"
                        data-label={usageText.weeklyTokens}
                      >
                        <strong
                          data-rank={
                            employeeUsage &&
                            (employeeUsage.weeklyCostMicroUsd ?? 0) > 0 &&
                            employeeUsage.weeklyRank <= 3
                              ? employeeUsage.weeklyRank
                              : undefined
                          }
                        >
                          {formatMicroUsd(
                            employeeUsage?.weeklyCostMicroUsd ?? null,
                            locale
                          )}
                        </strong>
                      </div>
                      <div
                        className="employee-list-cell employee-project-cell"
                        data-label={text.projectCount}
                        title={projectNames.join(", ")}
                      >
                        <p>{formatTokenCount(projectNames.length, locale)}</p>
                      </div>
                      <div aria-hidden="true" className="employee-row-chevron">
                        <ChevronRight size={18} />
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
                <label className="policy-field employee-invite-department-field">
                  <span>{text.department}</span>
                  <input
                    disabled={pendingAction !== null}
                    list="employee-department-options"
                    maxLength={120}
                    onChange={(event) =>
                      setCreateValues((current) => ({
                        ...current,
                        department: event.target.value
                      }))
                    }
                    placeholder={text.departmentPlaceholder}
                    type="text"
                    value={createValues.department}
                  />
                </label>
                <datalist id="employee-department-options">
                  {tenantDepartments.map((department) => (
                    <option key={department} value={department} />
                  ))}
                </datalist>
              </div>
              <div className="employee-actions">
                <Button
                  disabled={
                    pendingAction !== null ||
                    createValues.email.trim().length === 0 ||
                    createValues.name.trim().length === 0 ||
                    createValues.department.trim().length === 0
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

      <Dialog
        onOpenChange={(open) => {
          if (!open) {
            setSelectedEmployeeId(null);
            setIsProjectAssignmentOpen(false);
            setCandidateProjectId("");
            setProjectAssignmentToRemoveId(null);
            setTokenLimitSubmitState({ message: "", status: "idle" });
          }
        }}
        open={selectedUsage !== null}
      >
        <DialogContent className="employee-usage-dialog">
          {selectedUsage ? (
            <>
              <DialogHeader>
                <DialogTitle>{selectedUsage.name}</DialogTitle>
              </DialogHeader>
              <p className="employee-usage-dialog-subtitle">
                {selectedUsage.department ?? "-"} ·{" "}
                <span className="employee-email-reveal" tabIndex={0}>
                  <span aria-hidden="true" className="employee-email-mask">***</span>
                  <span className="employee-email-value">{selectedUsage.email}</span>
                </span>
              </p>

              {tokenLimitSubmitState.message ? (
                <Alert
                  variant={
                    tokenLimitSubmitState.status === "error" ? "destructive" : "success"
                  }
                >
                  <AlertDescription>{tokenLimitSubmitState.message}</AlertDescription>
                </Alert>
              ) : null}

              <div className="employee-usage-summary-grid">
                <article>
                  <span>{usageText.tokens}</span>
                  <strong
                    data-rank={
                      (selectedUsage.dailyCostMicroUsd ?? 0) > 0 &&
                      selectedUsage.dailyRank <= 3
                        ? selectedUsage.dailyRank
                        : undefined
                    }
                  >
                    {formatMicroUsd(selectedUsage.dailyCostMicroUsd, locale)}
                  </strong>
                </article>
                <article>
                  <span>{usageText.weeklyTokens}</span>
                  <strong
                    data-rank={
                      (selectedUsage.weeklyCostMicroUsd ?? 0) > 0 &&
                      selectedUsage.weeklyRank <= 3
                        ? selectedUsage.weeklyRank
                        : undefined
                    }
                  >
                    {formatMicroUsd(selectedUsage.weeklyCostMicroUsd, locale)}
                  </strong>
                </article>
              </div>

              <EmployeeWeeklyTokenQuotaEditor
                employee={selectedUsage}
                key={`${selectedUsage.employeeId}:${selectedUsage.weeklyTokenQuota?.version ?? "new"}:${tenantMonthlyTokenLimit ?? "unknown"}`}
                locale={locale}
                onSaved={() => router.refresh()}
                routeTenantId={model.controlPlaneTenantId}
                tenantMonthlyTokenLimit={tenantMonthlyTokenLimit}
              />

              <section className="employee-usage-projects employee-projects-after-quota">
                <div className="employee-usage-section-heading">
                  <h3>{usageText.projects}</h3>
                  <Button
                    onClick={() => {
                      setCandidateProjectId(availableProjectsForEmployee[0]?.id ?? "");
                      setIsProjectAssignmentOpen((current) => !current);
                      setProjectAssignmentToRemoveId(null);
                    }}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    <UserPlus aria-hidden="true" size={16} />
                    {usageText.addProject}
                  </Button>
                </div>
                {selectedUsage.projects.length > 0 ? (
                  <div className="employee-usage-project-list">
                    {selectedUsage.projects.map((project) => {
                      const projectRecord = projects.find(
                        (candidate) => candidate.id === project.projectId
                      );
                      const projectBudgetUsd = projectRecord?.totalBudgetUsd ?? 0;
                      const projectCost = monthlyProjectCostById.get(project.projectId);
                      const usageKnown = monthlyCostReport.source !== "unavailable";
                      const projectUsedUsd = usageKnown
                        ? (projectCost?.costMicroUsd ?? 0) / 1_000_000
                        : null;
                      const progress =
                        projectUsedUsd === null
                          ? 0
                          : projectBudgetUsd > 0
                            ? Math.min(100, (projectUsedUsd / projectBudgetUsd) * 100)
                            : projectUsedUsd > 0
                              ? 100
                              : 0;
                      const budgetStatus =
                        progress >= 100
                          ? "exceeded"
                          : progress >= (projectRecord?.warningThresholdPercent ?? 80)
                            ? "warning"
                            : "within_limit";

                      return (
                        <article
                          className="employee-usage-project-row"
                          data-quota-status={budgetStatus}
                          key={project.projectId}
                        >
                          <button
                            aria-label={`${usageText.managePolicy}: ${project.projectName}`}
                            className="employee-usage-project-link"
                            onClick={() =>
                              router.push(
                                `/tenants/${model.routeTenantId}/projects/${project.projectId}/policies`
                              )
                            }
                            type="button"
                          >
                            <span className="employee-usage-project-heading">
                              <strong>{project.projectName}</strong>
                              <span>
                                {projectUsedUsd === null
                                  ? "-"
                                  : formatBudgetUsd(projectUsedUsd)}{" "}
                                / {formatBudgetUsd(projectBudgetUsd)}
                              </span>
                            </span>
                            <span className="employee-usage-project-progress" aria-hidden="true">
                              <span style={{ width: `${progress}%` }} />
                            </span>
                          </button>
                          <Button
                            className="employee-usage-project-remove"
                            disabled={pendingAction !== null}
                            onClick={() => {
                              setProjectAssignmentToRemoveId(project.projectId);
                              setIsProjectAssignmentOpen(false);
                            }}
                            size="sm"
                            type="button"
                            variant="destructive"
                          >
                            {usageText.projectRemove}
                          </Button>
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className="project-empty">{usageText.noProjectUsage}</p>
                )}
                {projectAssignmentToRemoveId ? (
                  <div className="employee-project-removal-confirmation">
                    <strong>{usageText.projectRemoveConfirm}</strong>
                    <div>
                      <Button
                        disabled={pendingAction !== null}
                        onClick={() => setProjectAssignmentToRemoveId(null)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {text.cancel}
                      </Button>
                      <Button
                        disabled={pendingAction !== null}
                        onClick={() =>
                          void submitEmployeeProjectRemoval(projectAssignmentToRemoveId)
                        }
                        size="sm"
                        type="button"
                        variant="destructive"
                      >
                        {pendingAction === `removeProject:${projectAssignmentToRemoveId}`
                          ? "..."
                          : usageText.projectRemove}
                      </Button>
                    </div>
                  </div>
                ) : null}
                {isProjectAssignmentOpen ? (
                  <div className="employee-project-assignment-inline">
                    {availableProjectsForEmployee.length > 0 ? (
                      <div className="employee-project-assignment-list">
                        {availableProjectsForEmployee.map((project) => (
                          <button
                            aria-pressed={candidateProjectId === project.id}
                            key={project.id}
                            onClick={() => setCandidateProjectId(project.id)}
                            type="button"
                          >
                            <span>
                              <strong>{project.name}</strong>
                              <small>{project.description?.trim() || "-"}</small>
                            </span>
                            <span>{formatBudgetUsd(project.totalBudgetUsd)}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="project-empty">{usageText.noProjectsAvailable}</p>
                    )}
                    <div className="modal-actions">
                      <Button
                        disabled={pendingAction === "assignProject"}
                        onClick={() => {
                          setIsProjectAssignmentOpen(false);
                          setCandidateProjectId("");
                        }}
                        type="button"
                        variant="outline"
                      >
                        {text.cancel}
                      </Button>
                      <Button
                        disabled={pendingAction !== null || !candidateProjectId}
                        onClick={() => void submitEmployeeProjectAssignment()}
                        type="button"
                      >
                        <UserPlus aria-hidden="true" />
                        {pendingAction === "assignProject" ? "..." : usageText.addProject}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>

              <div className="modal-actions">
                <Button
                  onClick={() => {
                    const employee = employees.find(
                      (candidate) => candidate.id === selectedUsage.employeeId
                    );
                    if (employee) {
                      setSelectedEmployeeId(null);
                      openDepartmentDialog(employee);
                    }
                  }}
                  type="button"
                  variant="outline"
                >
                  {text.editDepartment}
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open && pendingAction !== `department:${departmentEmployee?.id ?? ""}`) {
            setDepartmentEmployee(null);
            setDepartmentValue("");
          }
        }}
        open={departmentEmployee !== null}
      >
        <DialogContent className="employee-department-dialog">
          <DialogHeader>
            <DialogTitle>
              {departmentEmployee?.name?.trim() || departmentEmployee?.email || "-"}
            </DialogTitle>
          </DialogHeader>
          {submitState.status === "error" && submitState.message ? (
            <Alert variant="destructive">
              <AlertDescription>{submitState.message}</AlertDescription>
            </Alert>
          ) : null}
          <label className="policy-field">
            <span>{text.department}</span>
            <input
              autoFocus
              disabled={pendingAction !== null}
              list="employee-department-edit-options"
              maxLength={120}
              onChange={(event) => setDepartmentValue(event.target.value)}
              placeholder={text.departmentPlaceholder}
              type="text"
              value={departmentValue}
            />
          </label>
          <datalist id="employee-department-edit-options">
            {tenantDepartments.map((department) => (
              <option key={department} value={department} />
            ))}
          </datalist>
          <div className="modal-actions">
            <Button
              disabled={pendingAction !== null}
              onClick={() => setDepartmentEmployee(null)}
              type="button"
              variant="outline"
            >
              {text.cancel}
            </Button>
            <Button
              disabled={pendingAction !== null || departmentValue.trim().length === 0}
              onClick={() => void submitEmployeeDepartment()}
              type="button"
            >
              <Save aria-hidden="true" />
              {pendingAction === `department:${departmentEmployee?.id ?? ""}` ? "..." : text.save}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </ManagementPage>
  );
}

function EmployeeWeeklyTokenQuotaEditor({
  employee,
  locale,
  onSaved,
  routeTenantId,
  tenantMonthlyTokenLimit
}: {
  employee: EmployeeUsageRow;
  locale: Locale;
  onSaved: () => void;
  routeTenantId: string;
  tenantMonthlyTokenLimit: number | null;
}) {
  const sourceQuota = employee.weeklyTokenQuota;
  const defaultLimitTokens = sourceQuota && sourceQuota.version > 0
    ? sourceQuota.limitTokens
    : defaultEmployeeWeeklyTokenLimit(tenantMonthlyTokenLimit);
  const [enabled, setEnabled] = useState(sourceQuota?.enabled ?? false);
  const [limitTokens, setLimitTokens] = useState(defaultLimitTokens);
  const [limitInput, setLimitInput] = useState(() => formatWeeklyTokenLimitInput(defaultLimitTokens));
  const [pending, setPending] = useState(false);
  const [submitState, setSubmitState] = useState<SubmitState>({
    message: "",
    status: "idle"
  });
  const currentWeek = sourceQuota?.currentWeek;
  const currentUsageTokens = currentWeek
    ? currentWeek.confirmedTotalTokens + currentWeek.reservedTokens + currentWeek.unconfirmedTokens
    : null;
  const remainingTokens = currentWeek
    ? currentWeek.limitTokens === 0
      ? 0
      : currentWeek.remainingTokens
    : limitTokens;
  const desiredSliderMax = Math.max(
    EMPLOYEE_WEEKLY_TOKEN_LIMIT_SLIDER_MAX,
    Math.ceil(limitTokens / EMPLOYEE_WEEKLY_TOKEN_LIMIT_SLIDER_STEP) *
      EMPLOYEE_WEEKLY_TOKEN_LIMIT_SLIDER_STEP
  );
  const sliderMax = tenantMonthlyTokenLimit === null
    ? desiredSliderMax
    : Math.min(tenantMonthlyTokenLimit, desiredSliderMax);
  const sliderStep = sliderMax > 0 && sliderMax < EMPLOYEE_WEEKLY_TOKEN_LIMIT_SLIDER_STEP
    ? Math.max(1, Math.floor(sliderMax / 10))
    : EMPLOYEE_WEEKLY_TOKEN_LIMIT_SLIDER_STEP;
  const sliderPosition = sliderMax === 0
    ? 0
    : Math.min(100, Math.max(0, (Math.min(limitTokens, sliderMax) / sliderMax) * 100));
  const sliderPositionStyle = {
    "--employee-token-slider-position": `${sliderPosition}%`
  } as CSSProperties;
  const monthlyLimitExceeded =
    enabled &&
    tenantMonthlyTokenLimit !== null &&
    limitTokens > tenantMonthlyTokenLimit;
  const changed =
    enabled !== (sourceQuota?.enabled ?? false) ||
    (enabled &&
      limitTokens !==
        (sourceQuota && sourceQuota.version > 0
          ? sourceQuota.limitTokens
          : defaultEmployeeWeeklyTokenLimit(tenantMonthlyTokenLimit)));

  async function save() {
    if (pending || !changed) {
      return;
    }
    if (monthlyLimitExceeded) {
      setSubmitState({
        message:
          locale === "ko"
            ? `직원 주간 한도는 공통 월간 한도(${formatCompactTokenCount(tenantMonthlyTokenLimit ?? 0, locale)})를 초과할 수 없습니다.`
            : `The weekly employee limit cannot exceed the shared monthly limit (${formatCompactTokenCount(tenantMonthlyTokenLimit ?? 0, locale)}).`,
        status: "error"
      });
      return;
    }

    setPending(true);
    setSubmitState({ message: "", status: "idle" });
    try {
      const response = await fetch("/api/control-plane/employees", {
        body: JSON.stringify({
          action: "updateWeeklyTokenQuota",
          values: {
            employeeId: employee.employeeId,
            enabled,
            ...(sourceQuota && sourceQuota.version > 0
              ? { expectedVersion: sourceQuota.version }
              : {}),
            limitTokens,
            tenantId: routeTenantId
          }
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const payload = (await response
        .json()
        .catch(() => ({}))) as EmployeeWeeklyTokenQuotaResponsePayload;
      if (!response.ok) {
        setSubmitState({
          message:
            response.status === 409
              ? locale === "ko"
                ? "다른 관리자가 한도를 변경했습니다. 최신 상태를 다시 불러옵니다."
                : "Another administrator updated this limit. Refreshing the latest state."
              : payload.error ??
                (locale === "ko" ? "주간 토큰 한도를 저장하지 못했습니다." : "Unable to save the weekly token limit."),
          status: "error"
        });
        if (response.status === 409) {
          onSaved();
        }
        return;
      }

      setSubmitState({
        message:
          locale === "ko"
            ? "주간 토큰 한도를 저장하고 새 Runtime Snapshot을 발행했습니다."
            : "The weekly token limit was saved and a new Runtime Snapshot was published.",
        status: "success"
      });
      onSaved();
    } catch {
      setSubmitState({
        message: locale === "ko" ? "주간 토큰 한도를 저장하지 못했습니다." : "Unable to save the weekly token limit.",
        status: "error"
      });
    } finally {
      setPending(false);
    }
  }

  function updateLimitInput(value: string) {
    setLimitInput(value);
    const parsed = parseWeeklyTokenLimitInput(value);
    if (parsed !== null) {
      setLimitTokens(parsed);
    }
  }

  function resetLimitInput() {
    setLimitInput(formatWeeklyTokenLimitInput(limitTokens));
  }

  function updateLimitFromSlider(value: number) {
    setLimitTokens(value);
    setLimitInput(formatWeeklyTokenLimitInput(value));
  }

  return (
    <section className="employee-chat-usage employee-weekly-token-section">
      <div className="employee-weekly-token-section-heading">
        <div className="employee-weekly-token-title-row">
          <h3>{locale === "ko" ? "주간 토큰 한도" : "Weekly token limit"}</h3>
          <WeeklyTokenQuotaInfo locale={locale} />
        </div>
      </div>

      {submitState.message ? (
        <Alert variant={submitState.status === "error" ? "destructive" : "success"}>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}

      <article className="employee-weekly-token-card" data-enabled={enabled ? "true" : "false"}>
        <header className="employee-weekly-token-card-header">
          <div>
            <strong>{locale === "ko" ? "주간 한도 적용" : "Apply weekly limit"}</strong>
            <p>
              {locale === "ko"
                ? "토글을 켜면 이 직원에게만 주간 토큰 한도를 적용합니다."
                : "Turn this on to apply a weekly token limit to this employee."}
            </p>
          </div>
          <Switch
            aria-label={locale === "ko" ? "주간 토큰 한도 적용" : "Apply weekly token limit"}
            checked={enabled}
            className="employee-weekly-token-switch"
            disabled={pending}
            onCheckedChange={setEnabled}
          />
        </header>
        <dl className="employee-weekly-token-metrics">
          <div>
            <dt>{locale === "ko" ? "사용" : "Used"}</dt>
            <dd>{currentUsageTokens === null ? "-" : formatCompactTokenCount(currentUsageTokens, locale)}</dd>
          </div>
          <div>
            <dt>{locale === "ko" ? "잔여" : "Remaining"}</dt>
            <dd>
              {!enabled
                ? "-"
                : limitTokens === 0
                  ? locale === "ko"
                    ? "즉시 차단"
                    : "Block immediately"
                  : formatCompactTokenCount(remainingTokens, locale)}
            </dd>
          </div>
        </dl>
        {enabled ? (
          <div className="employee-weekly-token-controls">
            <label className="employee-weekly-token-input-field">
              <span>
                {locale === "ko" ? "주간 한도" : "Weekly limit"}
                {tenantMonthlyTokenLimit !== null
                  ? ` · ${locale === "ko" ? "최대" : "Maximum"} ${formatCompactTokenCount(tenantMonthlyTokenLimit, locale)}`
                  : ""}
              </span>
              <input
                aria-describedby="employee-weekly-token-input-hint"
                aria-label={locale === "ko" ? "주간 토큰 한도" : "Weekly token limit"}
                disabled={pending}
                inputMode="decimal"
                onBlur={resetLimitInput}
                onChange={(event) => updateLimitInput(event.target.value)}
                placeholder="1M"
                type="text"
                value={limitInput}
              />
              <small id="employee-weekly-token-input-hint">
                {locale === "ko" ? "예: 1M 또는 1,250,000" : "For example: 1M or 1,250,000"}
              </small>
            </label>
            <div className="employee-weekly-token-slider-field">
              <div className="employee-weekly-token-slider-track" style={sliderPositionStyle}>
                <output className="employee-weekly-token-slider-current">
                  {formatCompactTokenCount(limitTokens, locale)}
                </output>
                <input
                  aria-label={locale === "ko" ? "주간 토큰 한도 슬라이더" : "Weekly token limit slider"}
                  aria-valuetext={formatCompactTokenCount(limitTokens, locale)}
                  className="employee-token-limit-range"
                  disabled={pending}
                  max={sliderMax}
                  min={0}
                  onChange={(event) => updateLimitFromSlider(Number(event.target.value))}
                  step={sliderStep}
                  type="range"
                  value={Math.min(limitTokens, sliderMax)}
                />
              </div>
              <div className="employee-weekly-token-slider-endpoints" aria-hidden="true">
                <span>0</span>
                <span>{formatCompactTokenCount(sliderMax, locale)}</span>
              </div>
            </div>
            {monthlyLimitExceeded ? (
              <p className="employee-weekly-token-limit-error">
                {locale === "ko"
                  ? `공통 월간 한도 ${formatCompactTokenCount(tenantMonthlyTokenLimit ?? 0, locale)} 이하로 입력하세요.`
                  : `Enter a value at or below the shared monthly limit of ${formatCompactTokenCount(tenantMonthlyTokenLimit ?? 0, locale)}.`}
              </p>
            ) : null}
            {limitTokens === 0 ? (
              <p className="employee-weekly-token-block-notice">
                {locale === "ko"
                  ? "적용하면 다음 새 Provider 요청부터 즉시 차단됩니다."
                  : "Applying this blocks the next new Provider request immediately."}
              </p>
            ) : null}
          </div>
        ) : null}
      </article>

      <div className="employee-weekly-token-footer">
        <p className="employee-weekly-token-snapshot">
          {locale === "ko"
            ? `현재 적용 Snapshot 버전: ${sourceQuota?.snapshotVersion ?? "-"}`
            : `Current Snapshot version: ${sourceQuota?.snapshotVersion ?? "-"}`}
        </p>
        <Button
          className="employee-weekly-token-apply-button"
          disabled={pending || !changed || monthlyLimitExceeded}
          onClick={() => void save()}
          size="lg"
          type="button"
        >
          <Save aria-hidden="true" />
          {pending ? "..." : locale === "ko" ? "적용" : "Apply"}
        </Button>
      </div>
    </section>
  );
}

function WeeklyTokenQuotaInfo({ locale }: { locale: Locale }) {
  const description =
    locale === "ko"
      ? "Tenant Chat에서 이 직원이 이번 주 사용할 수 있는 토큰 수입니다. 매주 월요일 0시(Asia/Seoul)에 초기화됩니다."
      : "The number of Tenant Chat tokens this employee can use this week. It resets every Monday at 00:00 (Asia/Seoul).";

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              aria-label={locale === "ko" ? "주간 토큰 한도 안내" : "Weekly token limit information"}
              className="employee-weekly-token-info-trigger"
              type="button"
            />
          }
        >
          <Info aria-hidden="true" />
        </TooltipTrigger>
        <TooltipContent className="employee-weekly-token-info-tooltip" sideOffset={8}>
          {description}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
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

function CompactUnitStepper({
  ariaLabel,
  decimals = 0,
  disabled = false,
  max,
  min,
  onValueChange,
  step,
  unit,
  value
}: CompactUnitStepperProps) {
  const [draftValue, setDraftValue] = useState(() =>
    formatCompactStepperInput(value, decimals, unit)
  );

  useEffect(() => {
    setDraftValue(formatCompactStepperInput(value, decimals, unit));
  }, [decimals, unit, value]);

  function updateValue(nextValue: number) {
    if (!Number.isFinite(nextValue)) {
      return;
    }
    const clampedValue = Math.min(Math.max(nextValue, min), max);
    const normalizedValue = Number(clampedValue.toFixed(decimals));
    setDraftValue(formatCompactStepperInput(normalizedValue, decimals, unit));
    onValueChange(normalizedValue);
  }

  function changeBy(direction: -1 | 1) {
    updateValue(value + step * direction);
  }

  return (
    <div aria-label={ariaLabel} className="employee-policy-unit-stepper" role="group">
      <input
        aria-label={ariaLabel}
        aria-valuemax={max}
        aria-valuemin={min}
        aria-valuenow={value}
        disabled={disabled}
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        onBlur={() => {
          const numericValue = parseCompactStepperInput(draftValue, unit);
          if (numericValue === null) {
            setDraftValue(formatCompactStepperInput(value, decimals, unit));
            return;
          }
          updateValue(numericValue);
        }}
        onChange={(event) => setDraftValue(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            changeBy(event.key === "ArrowUp" ? 1 : -1);
          } else if (event.key === "Enter") {
            event.currentTarget.blur();
          }
        }}
        role="spinbutton"
        type="text"
        value={draftValue}
      />
      <span className="employee-policy-stepper-buttons">
        <button
          aria-label={`${ariaLabel} +${step}${unit}`}
          disabled={disabled || value >= max}
          onClick={() => changeBy(1)}
          type="button"
        >
          <ChevronUp aria-hidden="true" />
        </button>
        <button
          aria-label={`${ariaLabel} -${step}${unit}`}
          disabled={disabled || value <= min}
          onClick={() => changeBy(-1)}
          type="button"
        >
          <ChevronDown aria-hidden="true" />
        </button>
      </span>
    </div>
  );
}

function formatCompactStepperValue(value: number, decimals: number) {
  if (decimals <= 0 || Number.isInteger(value)) {
    return String(value);
  }
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}

function formatCompactStepperInput(value: number, decimals: number, unit: string) {
  return `${formatCompactStepperValue(value, decimals)}${unit}`;
}

function getEmployeePolicyFormState(
  assignment: ProjectEmployeeAssignmentRecord | undefined
) {
  return {
    assignmentValues: {
      dailyTokenLimit: assignment?.policy.dailyTokenLimit.limit ?? 0,
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
    }
  };
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

function formatTokenCount(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "ko" ? "ko-KR" : "en-US", {
    maximumFractionDigits: 0
  }).format(Math.max(0, value));
}

function formatCompactTokenCount(value: number, locale: Locale) {
  const normalized = Math.max(0, Math.trunc(value));
  if (normalized >= 1_000_000 && normalized % 1_000_000 === 0) {
    return `${normalized / 1_000_000}M`;
  }
  if (normalized >= 1_000 && normalized % 1_000 === 0) {
    return `${normalized / 1_000}K`;
  }
  return formatTokenCount(normalized, locale);
}

function defaultEmployeeWeeklyTokenLimit(tenantMonthlyTokenLimit: number | null) {
  return tenantMonthlyTokenLimit === null
    ? EMPLOYEE_WEEKLY_TOKEN_LIMIT_DEFAULT
    : Math.min(EMPLOYEE_WEEKLY_TOKEN_LIMIT_DEFAULT, tenantMonthlyTokenLimit);
}

function formatWeeklyTokenLimitInput(value: number) {
  const normalized = Math.max(0, Math.trunc(value));
  if (normalized >= 1_000_000 && normalized % 1_000_000 === 0) {
    return `${normalized / 1_000_000}M`;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(normalized);
}

function parseWeeklyTokenLimitInput(value: string): number | null {
  const normalized = value.replaceAll(",", "").trim();
  const match = /^(\d+(?:\.\d+)?)\s*([kKmM])?$/.exec(normalized);
  if (!match) return null;

  const multiplier = match[2]?.toLowerCase() === "m"
    ? 1_000_000
    : match[2]?.toLowerCase() === "k"
      ? 1_000
      : 1;
  const parsed = Number(match[1]) * multiplier;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function formatTokenLimit(
  value: number,
  locale: Locale,
  enabled: boolean,
  unlimitedLabel: string
) {
  if (!enabled || value <= 0) {
    return unlimitedLabel;
  }
  if (value > 0 && value % 1000 === 0) {
    return `${formatTokenCount(value / 1000, locale)}K`;
  }
  return formatTokenCount(value, locale);
}

function formatMicroUsd(value: number | null, locale: Locale) {
  return value === null
    ? "-"
    : formatMicroUsdCurrency(value, locale === "ko" ? "ko-KR" : "en-US");
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

function invitationStatusVariant(status: EmployeeRecord["invitationStatus"]) {
  if (status === "accepted") {
    return "success" as const;
  }
  if (status === "pending") {
    return "warning" as const;
  }
  if (status === "revoked") {
    return "destructive" as const;
  }
  return "neutral" as const;
}
