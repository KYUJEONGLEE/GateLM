import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Employee,
  Prisma,
  Project,
  ProjectEmployeeAssignment,
} from '@prisma/client';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { normalizeEmail } from '../auth/auth.crypto';
import {
  CreateEmployeeDto,
  EmployeeCsvImportResponseDto,
  EmployeeCsvSkippedRowDto,
  EmployeeInvitationStatus,
  EmployeeResponseDto,
  EmployeeStatus,
  ImportEmployeesCsvDto,
  ListEmployeesQueryDto,
  ProjectEmployeeAssignmentResponseDto,
  ProjectEmployeePolicyDto,
  ProjectEmployeesResponseDto,
  ProjectEmployeeStatus,
  UpdateEmployeeDto,
  UpsertProjectEmployeeAssignmentDto,
} from './dto/employee.dto';

const DEFAULT_PROJECT_BUDGET_USD = 100;
const DEFAULT_WARNING_THRESHOLD_PERCENT = 80;

const CSV_HEADER_ALIASES = {
  department: ['department', 'dept', 'team', '부서', '팀'],
  email: ['email', 'e_mail', 'mail', '이메일', '메일'],
  jobTitle: ['jobtitle', 'job_title', 'title', 'position', 'role', '직책', '직무'],
  name: ['name', 'full_name', 'fullname', '이름', '성명'],
} as const;

type EmployeeWithProjectCount = Employee & {
  _count: {
    projectAssignments: number;
  };
};

type ProjectEmployeeWithEmployee = ProjectEmployeeAssignment & {
  employee: Employee;
};

type ProjectBudgetProjection = Pick<
  Project,
  'id' | 'tenantId' | 'totalBudgetUsd'
>;

type ParsedCsvRow = {
  department: string | null;
  email: string;
  jobTitle: string | null;
  name: string | null;
  rowNumber: number;
};

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async listEmployees(
    tenantId: string,
    query: ListEmployeesQueryDto,
  ): Promise<ListEnvelope<EmployeeResponseDto>> {
    await this.assertTenantExists(tenantId);

    const limit = query.limit ?? 100;
    const where: Prisma.EmployeeWhereInput = {
      deletedAt: null,
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.department ? { department: query.department } : {}),
    };
    const employees = await this.prisma.employee.findMany({
      where,
      include: {
        _count: {
          select: {
            projectAssignments: true,
          },
        },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const hasMore = employees.length > limit;
    const page = employees.slice(0, limit);

    return {
      data: page.map((employee) => this.toEmployeeResponse(employee)),
      pagination: {
        hasMore,
        limit,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
      },
    };
  }

  async createEmployee(
    tenantId: string,
    dto: CreateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    await this.assertTenantExists(tenantId);

    const email = normalizeEmail(dto.email);
    await this.assertEmployeeEmailAvailable(tenantId, email);

    try {
      const employee = await this.prisma.employee.create({
        data: {
          department: this.toNullableString(dto.department),
          email,
          jobTitle: this.toNullableString(dto.jobTitle),
          name: this.toNullableString(dto.name),
          status: dto.status ?? 'staged',
          tenantId,
        },
        include: {
          _count: {
            select: {
              projectAssignments: true,
            },
          },
        },
      });

      return this.toEmployeeResponse(employee);
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException('Employee email already exists.');
      }

      throw error;
    }
  }

  async importEmployeesCsv(
    tenantId: string,
    dto: ImportEmployeesCsvDto,
  ): Promise<EmployeeCsvImportResponseDto> {
    await this.assertTenantExists(tenantId);

    const { rows, skippedRows } = this.parseEmployeeCsv(
      dto.csvText,
      this.toNullableString(dto.defaultDepartment),
    );
    const seenEmails = new Set<string>();
    const dedupedRows: ParsedCsvRow[] = [];
    const allSkippedRows: EmployeeCsvSkippedRowDto[] = [...skippedRows];

    for (const row of rows) {
      if (seenEmails.has(row.email)) {
        allSkippedRows.push({
          reason: 'Duplicate email in CSV.',
          rowNumber: row.rowNumber,
        });
        continue;
      }
      seenEmails.add(row.email);
      dedupedRows.push(row);
    }

    let createdCount = 0;
    let updatedCount = 0;
    const employees = await this.prisma.$transaction(async (tx) => {
      const imported: EmployeeWithProjectCount[] = [];

      for (const row of dedupedRows) {
        const existing = await tx.employee.findFirst({
          where: {
            deletedAt: null,
            email: row.email,
            tenantId,
          },
        });
        const data = {
          department: row.department,
          email: row.email,
          jobTitle: row.jobTitle,
          name: row.name,
        };

        if (existing) {
          const employee = await tx.employee.update({
            where: { id: existing.id },
            data,
            include: {
              _count: {
                select: {
                  projectAssignments: true,
                },
              },
            },
          });
          updatedCount += 1;
          imported.push(employee);
          continue;
        }

        const employee = await tx.employee.create({
          data: {
            ...data,
            status: 'staged',
            tenantId,
          },
          include: {
            _count: {
              select: {
                projectAssignments: true,
              },
            },
          },
        });
        createdCount += 1;
        imported.push(employee);
      }

      return imported;
    });

    return {
      createdCount,
      employees: employees.map((employee) => this.toEmployeeResponse(employee)),
      skippedRows: allSkippedRows,
      updatedCount,
    };
  }

  async updateEmployee(
    tenantId: string,
    employeeId: string,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    await this.getEmployeeOrThrow(tenantId, employeeId);

    const data: Prisma.EmployeeUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = this.toNullableString(dto.name);
    }
    if (dto.department !== undefined) {
      data.department = this.toNullableString(dto.department);
    }
    if (dto.jobTitle !== undefined) {
      data.jobTitle = this.toNullableString(dto.jobTitle);
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (dto.status === 'archived') {
        data.deletedAt = new Date();
      }
    }
    if (dto.invitationStatus !== undefined) {
      data.invitationStatus = dto.invitationStatus;
    }

    if (Object.keys(data).length === 0) {
      return this.getEmployeeResponseOrThrow(tenantId, employeeId);
    }

    const employee = await this.prisma.employee.update({
      where: { id: employeeId },
      data,
      include: {
        _count: {
          select: {
            projectAssignments: true,
          },
        },
      },
    });

    return this.toEmployeeResponse(employee);
  }

  async listProjectEmployees(
    projectId: string,
  ): Promise<ProjectEmployeesResponseDto> {
    const project = await this.getProjectOrThrow(projectId);
    const assignments = await this.prisma.projectEmployeeAssignment.findMany({
      where: { projectId },
      include: { employee: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const activeAssignments = assignments.filter(
      (assignment) => assignment.status === 'active',
    );
    const projectBudgetUsd = this.toProjectBudgetUsd(project.totalBudgetUsd);
    const assignedBudgetUsd = activeAssignments.reduce(
      (total, assignment) =>
        total + this.microUsdToUsdNumber(assignment.monthlyBudgetLimitMicroUsd),
      0,
    );

    return {
      budget: {
        assignedBudgetUsd,
        projectBudgetUsd,
        remainingBudgetUsd: projectBudgetUsd - assignedBudgetUsd,
      },
      data: assignments.map((assignment) =>
        this.toProjectEmployeeAssignmentResponse(assignment),
      ),
      projectId: project.id,
      tenantId: project.tenantId,
    };
  }

  async upsertProjectEmployeeAssignment(
    projectId: string,
    employeeId: string,
    dto: UpsertProjectEmployeeAssignmentDto,
  ): Promise<ProjectEmployeeAssignmentResponseDto> {
    const project = await this.getProjectOrThrow(projectId);
    const employee = await this.getEmployeeOrThrow(project.tenantId, employeeId);
    const existing = await this.prisma.projectEmployeeAssignment.findUnique({
      where: {
        projectId_employeeId: {
          employeeId,
          projectId,
        },
      },
    });
    const monthlyBudgetLimitMicroUsd =
      dto.monthlyBudgetLimitUsd !== undefined
        ? this.usdToMicroUsd(dto.monthlyBudgetLimitUsd)
        : existing?.monthlyBudgetLimitMicroUsd ?? 0n;
    const warningThresholdPercent =
      dto.warningThresholdPercent ??
      existing?.warningThresholdPercent ??
      DEFAULT_WARNING_THRESHOLD_PERCENT;
    const status = dto.status ?? existing?.status ?? 'active';
    const policy = this.mergeProjectEmployeePolicy(existing?.policy, dto);

    await this.assertProjectBudgetCanCoverEmployeeLimits({
      employeeId,
      monthlyBudgetLimitMicroUsd,
      project,
      status,
    });

    const assignment = existing
      ? await this.prisma.projectEmployeeAssignment.update({
          where: { id: existing.id },
          data: {
            monthlyBudgetLimitMicroUsd,
            policy,
            status,
            warningThresholdPercent,
          },
          include: { employee: true },
        })
      : await this.prisma.projectEmployeeAssignment.create({
          data: {
            employeeId: employee.id,
            monthlyBudgetLimitMicroUsd,
            policy,
            projectId: project.id,
            status,
            tenantId: project.tenantId,
            warningThresholdPercent,
          },
          include: { employee: true },
        });

    return this.toProjectEmployeeAssignmentResponse(assignment);
  }

  async disableProjectEmployeeAssignment(
    projectId: string,
    employeeId: string,
  ): Promise<ProjectEmployeeAssignmentResponseDto> {
    await this.getProjectOrThrow(projectId);

    try {
      const assignment = await this.prisma.projectEmployeeAssignment.update({
        where: {
          projectId_employeeId: {
            employeeId,
            projectId,
          },
        },
        data: { status: 'disabled' },
        include: { employee: true },
      });

      return this.toProjectEmployeeAssignmentResponse(assignment);
    } catch (error) {
      if (this.isRecordNotFoundError(error)) {
        throw new NotFoundException('Project employee assignment not found.');
      }

      throw error;
    }
  }

  private async assertTenantExists(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found.');
    }
  }

  private async assertEmployeeEmailAvailable(
    tenantId: string,
    email: string,
  ): Promise<void> {
    const existing = await this.prisma.employee.findFirst({
      where: {
        deletedAt: null,
        email,
        tenantId,
      },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Employee email already exists.');
    }
  }

  private async getProjectOrThrow(
    projectId: string,
  ): Promise<ProjectBudgetProjection> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        tenantId: true,
        totalBudgetUsd: true,
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found.');
    }

    return project;
  }

  private async getEmployeeOrThrow(
    tenantId: string,
    employeeId: string,
  ): Promise<Employee> {
    const employee = await this.prisma.employee.findFirst({
      where: {
        deletedAt: null,
        id: employeeId,
        tenantId,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }

    return employee;
  }

  private async getEmployeeResponseOrThrow(
    tenantId: string,
    employeeId: string,
  ): Promise<EmployeeResponseDto> {
    const employee = await this.prisma.employee.findFirst({
      where: {
        deletedAt: null,
        id: employeeId,
        tenantId,
      },
      include: {
        _count: {
          select: {
            projectAssignments: true,
          },
        },
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }

    return this.toEmployeeResponse(employee);
  }

  private async assertProjectBudgetCanCoverEmployeeLimits(args: {
    employeeId: string;
    monthlyBudgetLimitMicroUsd: bigint;
    project: ProjectBudgetProjection;
    status: string;
  }): Promise<void> {
    const projectBudgetMicroUsd = this.usdToMicroUsd(
      this.toProjectBudgetUsd(args.project.totalBudgetUsd),
    );
    const activeAssignments = await this.prisma.projectEmployeeAssignment.findMany({
      where: {
        employeeId: { not: args.employeeId },
        projectId: args.project.id,
        status: 'active',
      },
      select: { monthlyBudgetLimitMicroUsd: true },
    });
    const alreadyAssignedMicroUsd = activeAssignments.reduce(
      (total, assignment) => total + assignment.monthlyBudgetLimitMicroUsd,
      0n,
    );
    const nextEmployeeBudgetMicroUsd =
      args.status === 'active' ? args.monthlyBudgetLimitMicroUsd : 0n;

    if (alreadyAssignedMicroUsd + nextEmployeeBudgetMicroUsd > projectBudgetMicroUsd) {
      throw new ConflictException(
        'Employee budget allocations exceed the project budget.',
      );
    }
  }

  private parseEmployeeCsv(
    csvText: string,
    defaultDepartment: string | null,
  ): { rows: ParsedCsvRow[]; skippedRows: EmployeeCsvSkippedRowDto[] } {
    const table = parseCsvTable(csvText);
    const [headers, ...dataRows] = table;

    if (!headers || headers.length === 0) {
      throw new BadRequestException('CSV header row is required.');
    }

    const headerMap = buildHeaderMap(headers);
    if (headerMap.email === undefined) {
      throw new BadRequestException('CSV must include an email column.');
    }

    const emailColumnIndex = headerMap.email;

    const rows: ParsedCsvRow[] = [];
    const skippedRows: EmployeeCsvSkippedRowDto[] = [];

    dataRows.forEach((row, index) => {
      const rowNumber = index + 2;
      if (row.every((field) => field.trim().length === 0)) {
        return;
      }

      const email = normalizeEmail(readCsvCell(row, emailColumnIndex));
      if (!isValidEmail(email)) {
        skippedRows.push({
          reason: 'Valid email is required.',
          rowNumber,
        });
        return;
      }

      rows.push({
        department:
          this.toNullableString(readOptionalCsvCell(row, headerMap.department)) ??
          defaultDepartment,
        email,
        jobTitle: this.toNullableString(readOptionalCsvCell(row, headerMap.jobTitle)),
        name: this.toNullableString(readOptionalCsvCell(row, headerMap.name)),
        rowNumber,
      });
    });

    return { rows, skippedRows };
  }

  private mergeProjectEmployeePolicy(
    currentPolicy: Prisma.JsonValue | undefined,
    dto: UpsertProjectEmployeeAssignmentDto,
  ): Prisma.InputJsonObject {
    const current = this.toProjectEmployeePolicy(currentPolicy);

    return {
      allowedModelKeys:
        dto.allowedModelKeys !== undefined
          ? uniqueTrimmedStrings(dto.allowedModelKeys)
          : current.allowedModelKeys,
      allowedProviderConnectionIds:
        dto.allowedProviderConnectionIds !== undefined
          ? uniqueTrimmedStrings(dto.allowedProviderConnectionIds)
          : current.allowedProviderConnectionIds,
      note:
        dto.policyNote !== undefined
          ? this.toNullableString(dto.policyNote)
          : current.note,
    };
  }

  private toProjectEmployeePolicy(
    policy: Prisma.JsonValue | undefined,
  ): ProjectEmployeePolicyDto {
    if (!isRecord(policy)) {
      return {
        allowedModelKeys: [],
        allowedProviderConnectionIds: [],
        note: null,
      };
    }

    return {
      allowedModelKeys: readStringArray(policy.allowedModelKeys),
      allowedProviderConnectionIds: readStringArray(
        policy.allowedProviderConnectionIds,
      ),
      note: typeof policy.note === 'string' && policy.note.trim() ? policy.note : null,
    };
  }

  private toEmployeeResponse(employee: EmployeeWithProjectCount): EmployeeResponseDto {
    return {
      acceptedAt: employee.acceptedAt?.toISOString() ?? null,
      createdAt: employee.createdAt.toISOString(),
      department: employee.department,
      email: employee.email,
      id: employee.id,
      invitationStatus: normalizeInvitationStatus(employee.invitationStatus),
      invitedAt: employee.invitedAt?.toISOString() ?? null,
      jobTitle: employee.jobTitle,
      name: employee.name,
      projectCount: employee._count.projectAssignments,
      status: normalizeEmployeeStatus(employee.status),
      tenantId: employee.tenantId,
      updatedAt: employee.updatedAt.toISOString(),
      userId: employee.userId,
    };
  }

  private toProjectEmployeeAssignmentResponse(
    assignment: ProjectEmployeeWithEmployee,
  ): ProjectEmployeeAssignmentResponseDto {
    return {
      createdAt: assignment.createdAt.toISOString(),
      employeeDepartment: assignment.employee.department,
      employeeEmail: assignment.employee.email,
      employeeId: assignment.employeeId,
      employeeJobTitle: assignment.employee.jobTitle,
      employeeName: assignment.employee.name,
      employeeStatus: normalizeEmployeeStatus(assignment.employee.status),
      id: assignment.id,
      invitationStatus: normalizeInvitationStatus(
        assignment.employee.invitationStatus,
      ),
      monthlyBudgetLimitMicroUsd: Number(assignment.monthlyBudgetLimitMicroUsd),
      monthlyBudgetLimitUsd: this.microUsdToUsdNumber(
        assignment.monthlyBudgetLimitMicroUsd,
      ),
      policy: this.toProjectEmployeePolicy(assignment.policy),
      projectId: assignment.projectId,
      status: normalizeProjectEmployeeStatus(assignment.status),
      tenantId: assignment.tenantId,
      updatedAt: assignment.updatedAt.toISOString(),
      warningThresholdPercent: assignment.warningThresholdPercent,
    };
  }

  private toNullableString(value: string | null | undefined): string | null {
    if (value === null || value === undefined) {
      return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private toProjectBudgetUsd(value: Prisma.Decimal | null | undefined): number {
    return Math.max(0, value?.toNumber() ?? DEFAULT_PROJECT_BUDGET_USD);
  }

  private usdToMicroUsd(value: number): bigint {
    return BigInt(Math.round(Math.max(0, value) * 1000000));
  }

  private microUsdToUsdNumber(value: bigint): number {
    return Number(value) / 1000000;
  }

  private isRecordNotFoundError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    );
  }

  private isUniqueConstraintError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}

function parseCsvTable(csvText: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;

  for (let index = 0; index < csvText.length; index += 1) {
    const char = csvText[index];
    const nextChar = csvText[index + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      currentRow.push(currentField);
      currentField = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        index += 1;
      }
      currentRow.push(currentField);
      rows.push(currentRow);
      currentRow = [];
      currentField = '';
      continue;
    }

    currentField += char;
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField);
    rows.push(currentRow);
  }

  return rows;
}

function buildHeaderMap(headers: string[]): Partial<Record<keyof typeof CSV_HEADER_ALIASES, number>> {
  const normalizedHeaders = headers.map((header) => normalizeHeader(header));
  const headerMap: Partial<Record<keyof typeof CSV_HEADER_ALIASES, number>> = {};

  for (const [key, aliases] of Object.entries(CSV_HEADER_ALIASES) as Array<
    [keyof typeof CSV_HEADER_ALIASES, readonly string[]]
  >) {
    const index = normalizedHeaders.findIndex((header) =>
      aliases.includes(header),
    );
    if (index >= 0) {
      headerMap[key] = index;
    }
  }

  return headerMap;
}

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]/g, '_');
}

function readCsvCell(row: string[], index: number): string {
  return row[index]?.trim() ?? '';
}

function readOptionalCsvCell(row: string[], index: number | undefined): string | null {
  return index === undefined ? null : readCsvCell(row, index);
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function uniqueTrimmedStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? uniqueTrimmedStrings(value.filter((item): item is string => typeof item === 'string'))
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeEmployeeStatus(value: string): EmployeeStatus {
  if (
    value === 'staged' ||
    value === 'active' ||
    value === 'suspended' ||
    value === 'archived'
  ) {
    return value;
  }

  return 'staged';
}

function normalizeInvitationStatus(value: string): EmployeeInvitationStatus {
  if (
    value === 'not_sent' ||
    value === 'pending' ||
    value === 'accepted' ||
    value === 'revoked'
  ) {
    return value;
  }

  return 'not_sent';
}

function normalizeProjectEmployeeStatus(value: string): ProjectEmployeeStatus {
  return value === 'disabled' ? 'disabled' : 'active';
}
