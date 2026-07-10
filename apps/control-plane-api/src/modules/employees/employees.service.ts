import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  Employee,
  Prisma,
  Project,
  ProjectEmployeeAssignment,
  ResourceStatus,
} from '@prisma/client';

import { ConfigService } from '@nestjs/config';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { createOpaqueToken, hashSecret, normalizeEmail } from '../auth/auth.crypto';
import { EMAIL_SENDER } from '../auth/auth.tokens';
import { EmailSender } from '../auth/email-sender';
import {
  CreateEmployeeDto,
  EmployeeCsvImportResponseDto,
  EmployeeCsvSkippedRowDto,
  EmployeeImportProjectResponseDto,
  EmployeeInvitationResponseDto,
  EmployeeInvitationStatus,
  EmployeeOrganizationCsvImportResponseDto,
  EmployeeResponseDto,
  EmployeeStatus,
  ImportEmployeeOrganizationCsvDto,
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
const DEPRECATED_JOB_TITLE_CSV_HEADERS = [
  'jobtitle',
  'job_title',
  'title',
  'position',
  'role',
  '직책',
  '직무',
] as const;

const CSV_HEADER_ALIASES = {
  allowedModelKeys: ['allowedmodelkeys', 'allowed_model_keys', 'models', 'model_keys', '모델'],
  allowedProviderConnectionIds: [
    'allowedproviderconnectionids',
    'allowed_provider_connection_ids',
    'provider_connection_ids',
    'providers',
    'provider_ids',
    '프로바이더',
  ],
  department: ['department', 'dept', 'team', '부서', '팀'],
  email: ['email', 'e_mail', 'mail', '이메일', '메일'],
  employeeBudgetUsd: [
    'employeebudgetusd',
    'employee_budget_usd',
    'monthly_budget_usd',
    'budget_usd',
    '직원예산',
  ],
  name: ['name', 'full_name', 'fullname', '이름', '성명'],
  policyNote: ['policynote', 'policy_note', 'note', '메모'],
  project: ['project', 'project_name', '프로젝트'],
  projectBudgetUsd: ['projectbudgetusd', 'project_budget_usd', 'project_budget', '프로젝트예산'],
  projectDescription: [
    'projectdescription',
    'project_description',
    'project_desc',
    '프로젝트설명',
  ],
  warningThresholdPercent: [
    'warningthresholdpercent',
    'warning_threshold_percent',
    'warning_percent',
    '경고기준',
  ],
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

type ProjectImportProjection = Pick<
  Project,
  'createdAt' | 'description' | 'id' | 'name' | 'status' | 'tenantId' | 'totalBudgetUsd' | 'updatedAt'
>;

type ProjectImportEntry = {
  project: ProjectImportProjection;
  runtimeApplicationId: string | null;
};

type ParsedCsvRow = {
  department: string | null;
  email: string;
  name: string | null;
  rowNumber: number;
};

type ParsedOrganizationCsvRow = ParsedCsvRow & {
  allowedModelKeys: string[];
  allowedProviderConnectionIds: string[];
  employeeBudgetUsd: number;
  policyNote: string | null;
  projectBudgetUsd: number | null;
  projectDescription: string | null;
  projectName: string | null;
  warningThresholdPercent: number;
};

type PreparedOrganizationAssignment = {
  employee: EmployeeWithProjectCount;
  projectEntry: ProjectImportEntry;
  row: ParsedOrganizationCsvRow;
};

@Injectable()
export class EmployeesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(EMAIL_SENDER)
    private readonly emailSender: EmailSender,
  ) {}

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
      const existingEmployees = await tx.employee.findMany({
        where: {
          deletedAt: null,
          email: { in: dedupedRows.map((row) => row.email) },
          tenantId,
        },
      });
      const existingEmployeesByEmail = new Map(
        existingEmployees.map((employee) => [employee.email, employee]),
      );

      for (const row of dedupedRows) {
        const existing = existingEmployeesByEmail.get(row.email);
        const data = {
          department: row.department,
          email: row.email,
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

  async importEmployeeOrganizationCsv(
    tenantId: string,
    dto: ImportEmployeeOrganizationCsvDto,
  ): Promise<EmployeeOrganizationCsvImportResponseDto> {
    await this.assertTenantExists(tenantId);

    const { rows, skippedRows } = this.parseEmployeeOrganizationCsv(dto.csvText);
    const allSkippedRows: EmployeeCsvSkippedRowDto[] = [...skippedRows];
    let createdCount = 0;
    let updatedCount = 0;
    let projectCreatedCount = 0;
    let projectUpdatedCount = 0;
    let assignmentCreatedCount = 0;
    let assignmentUpdatedCount = 0;

    const result = await this.prisma.$transaction(async (tx) => {
      const existingEmployees = await tx.employee.findMany({
        where: {
          deletedAt: null,
          email: { in: [...new Set(rows.map((row) => row.email))] },
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
      const employeesByEmail = new Map<string, EmployeeWithProjectCount>(
        existingEmployees.map((employee) => [employee.email, employee]),
      );
      const projectsByName = new Map<string, ProjectImportEntry>();
      const assignments: ProjectEmployeeWithEmployee[] = [];
      const preparedAssignments: PreparedOrganizationAssignment[] = [];
      const touchedAssignmentKeys = new Set<string>();

      for (const row of rows) {
        const existingEmployee = employeesByEmail.get(row.email);
        const employeeData = {
          department: row.department,
          email: row.email,
          name: row.name,
        };
        const employee = existingEmployee
          ? await tx.employee.update({
              where: { id: existingEmployee.id },
              data: employeeData,
              include: {
                _count: {
                  select: {
                    projectAssignments: true,
                  },
                },
              },
            })
          : await tx.employee.create({
              data: {
                ...employeeData,
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

        if (existingEmployee) {
          updatedCount += 1;
        } else {
          createdCount += 1;
        }
        employeesByEmail.set(employee.email, employee);

        if (!row.projectName) {
          continue;
        }

        const projectKey = row.projectName.toLocaleLowerCase();
        let projectEntry = projectsByName.get(projectKey);
        if (!projectEntry) {
          const existingProject = await tx.project.findFirst({
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            where: {
              name: {
                equals: row.projectName,
                mode: 'insensitive',
              },
              tenantId,
            },
          });

          if (existingProject) {
            const projectUpdateData: Prisma.ProjectUpdateInput = {};
            if (row.projectDescription !== null) {
              projectUpdateData.description = row.projectDescription;
            }
            if (row.projectBudgetUsd !== null) {
              projectUpdateData.totalBudgetUsd = row.projectBudgetUsd;
            }

            const project = Object.keys(projectUpdateData).length > 0
              ? await tx.project.update({
                  data: projectUpdateData,
                  where: { id: existingProject.id },
                })
              : existingProject;
            if (Object.keys(projectUpdateData).length > 0) {
              projectUpdatedCount += 1;
            }
            const runtimeApplication = await tx.application.findFirst({
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: { id: true },
              where: { projectId: project.id },
            });
            projectEntry = {
              project,
              runtimeApplicationId: runtimeApplication?.id ?? null,
            };
          } else {
            const project = await tx.project.create({
              data: {
                description: row.projectDescription,
                name: row.projectName,
                status: ResourceStatus.ACTIVE,
                tenantId,
                totalBudgetUsd: row.projectBudgetUsd ?? DEFAULT_PROJECT_BUDGET_USD,
              },
            });
            const runtimeApplication = await tx.application.create({
              data: {
                budgetLimitMode: 'PERCENT',
                budgetLimitPercent: 100,
                budgetLimitUsd: null,
                description: row.projectDescription,
                name: row.projectName,
                projectId: project.id,
                tenantId,
              },
            });
            projectCreatedCount += 1;
            projectEntry = {
              project,
              runtimeApplicationId: runtimeApplication.id,
            };
          }
          projectsByName.set(projectKey, projectEntry);
        }

        const assignmentKey = `${projectEntry.project.id}:${employee.id}`;
        if (touchedAssignmentKeys.has(assignmentKey)) {
          allSkippedRows.push({
            reason: 'Duplicate project employee assignment in CSV.',
            rowNumber: row.rowNumber,
          });
          continue;
        }
        touchedAssignmentKeys.add(assignmentKey);

        preparedAssignments.push({ employee, projectEntry, row });
      }

      const existingAssignments = preparedAssignments.length > 0
        ? await tx.projectEmployeeAssignment.findMany({
            where: {
              employeeId: {
                in: [...new Set(preparedAssignments.map(({ employee }) => employee.id))],
              },
              projectId: {
                in: [
                  ...new Set(
                    preparedAssignments.map(({ projectEntry }) => projectEntry.project.id),
                  ),
                ],
              },
              tenantId,
            },
          })
        : [];
      const existingAssignmentsByKey = new Map(
        existingAssignments.map((assignment) => [
          `${assignment.projectId}:${assignment.employeeId}`,
          assignment,
        ]),
      );

      for (const { employee, projectEntry, row } of preparedAssignments) {
        const existingAssignment = existingAssignmentsByKey.get(
          `${projectEntry.project.id}:${employee.id}`,
        );

        const policy: Prisma.InputJsonObject = {
          allowedModelKeys: row.allowedModelKeys,
          allowedProviderConnectionIds: row.allowedProviderConnectionIds,
          note: row.policyNote,
        };
        const assignment = existingAssignment
          ? await tx.projectEmployeeAssignment.update({
              where: { id: existingAssignment.id },
              data: {
                monthlyBudgetLimitMicroUsd: this.usdToMicroUsd(row.employeeBudgetUsd),
                policy,
                status: 'active',
                warningThresholdPercent: row.warningThresholdPercent,
              },
              include: { employee: true },
            })
          : await tx.projectEmployeeAssignment.create({
              data: {
                employeeId: employee.id,
                monthlyBudgetLimitMicroUsd: this.usdToMicroUsd(row.employeeBudgetUsd),
                policy,
                projectId: projectEntry.project.id,
                status: 'active',
                tenantId,
                warningThresholdPercent: row.warningThresholdPercent,
              },
              include: { employee: true },
            });

        if (existingAssignment) {
          assignmentUpdatedCount += 1;
        } else {
          assignmentCreatedCount += 1;
        }
        assignments.push(assignment);
      }

      return {
        assignments,
        employees: [...employeesByEmail.values()],
        projects: [...projectsByName.values()],
      };
    });

    return {
      assignmentCreatedCount,
      assignmentUpdatedCount,
      assignments: result.assignments.map((assignment) =>
        this.toProjectEmployeeAssignmentResponse(assignment),
      ),
      createdCount,
      employees: result.employees.map((employee) => this.toEmployeeResponse(employee)),
      projectCreatedCount,
      projects: result.projects.map((entry) =>
        this.toProjectImportResponse(entry.project, entry.runtimeApplicationId),
      ),
      projectUpdatedCount,
      skippedRows: allSkippedRows,
      updatedCount,
    };
  }

  async sendEmployeeInvitation(
    tenantId: string,
    employeeId: string,
  ): Promise<EmployeeInvitationResponseDto> {
    const employee = await this.prisma.employee.findFirst({
      include: {
        _count: {
          select: {
            projectAssignments: true,
          },
        },
        tenant: {
          select: {
            name: true,
          },
        },
      },
      where: {
        deletedAt: null,
        id: employeeId,
        tenantId,
      },
    });

    if (!employee) {
      throw new NotFoundException('Employee not found.');
    }
    if (employee.invitationStatus === 'accepted') {
      throw new BadRequestException('Employee invitation is already accepted.');
    }

    const now = new Date();
    const token = createOpaqueToken();
    const expiresAt = addDays(now, 7);
    const signupUrl = this.buildEmployeeSignupUrl(token);

    const updatedEmployee = await this.prisma.employee.update({
      where: { id: employee.id },
      data: {
        invitationExpiresAt: expiresAt,
        invitationRevokedAt: null,
        invitationStatus: 'pending',
        invitationTokenHash: hashSecret(token),
        invitedAt: now,
      },
      include: {
        _count: {
          select: {
            projectAssignments: true,
          },
        },
      },
    });

    try {
      await this.emailSender.sendEmployeeInvitationEmail({
        email: employee.email,
        expiresAt,
        name: employee.name?.trim() || employee.email,
        signupUrl,
        tenantName: employee.tenant.name,
      });
    } catch {
      await this.prisma.employee.update({
        where: { id: employee.id },
        data: {
          invitationExpiresAt: null,
          invitationRevokedAt: now,
          invitationStatus: 'not_sent',
          invitationTokenHash: null,
          invitedAt: null,
        },
      });
      throw new InternalServerErrorException('Employee invitation email failed to send.');
    }

    return {
      employee: this.toEmployeeResponse(updatedEmployee),
      expiresAt: expiresAt.toISOString(),
      signupUrl,
    };
  }

  async updateEmployee(
    tenantId: string,
    employeeId: string,
    dto: UpdateEmployeeDto,
  ): Promise<EmployeeResponseDto> {
    await this.getEmployeeOrThrow(tenantId, employeeId, {
      includeDeleted: true,
    });

    const data: Prisma.EmployeeUpdateInput = {};
    if (dto.name !== undefined) {
      data.name = this.toNullableString(dto.name);
    }
    if (dto.department !== undefined) {
      data.department = this.toNullableString(dto.department);
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
      data.deletedAt = dto.status === 'archived' ? new Date() : null;
    }
    if (dto.invitationStatus !== undefined) {
      data.invitationStatus = dto.invitationStatus;
    }

    if (Object.keys(data).length === 0) {
      return this.getEmployeeResponseOrThrow(tenantId, employeeId, {
        includeDeleted: true,
      });
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
    return this.prisma.$transaction(async (tx) => {
      const lockedProjects = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "projects"
        WHERE "id" = ${projectId}::uuid
        FOR UPDATE
      `;
      if (!lockedProjects[0]) {
        throw new NotFoundException('Project not found.');
      }

      const project = await tx.project.findUnique({
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

      const employee = await tx.employee.findFirst({
        where: {
          deletedAt: null,
          id: employeeId,
          tenantId: project.tenantId,
        },
      });
      if (!employee) {
        throw new NotFoundException('Employee not found.');
      }

      const existing = await tx.projectEmployeeAssignment.findUnique({
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

      await this.assertProjectBudgetCanCoverEmployeeLimits(
        {
          employeeId,
          monthlyBudgetLimitMicroUsd,
          project,
          status,
        },
        tx,
      );

      const assignment = existing
        ? await tx.projectEmployeeAssignment.update({
            where: { id: existing.id },
            data: {
              monthlyBudgetLimitMicroUsd,
              policy,
              status,
              warningThresholdPercent,
            },
            include: { employee: true },
          })
        : await tx.projectEmployeeAssignment.create({
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
    });
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
    options: { includeDeleted?: boolean } = {},
  ): Promise<Employee> {
    const employee = await this.prisma.employee.findFirst({
      where: {
        ...(options.includeDeleted ? {} : { deletedAt: null }),
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
    options: { includeDeleted?: boolean } = {},
  ): Promise<EmployeeResponseDto> {
    const employee = await this.prisma.employee.findFirst({
      where: {
        ...(options.includeDeleted ? {} : { deletedAt: null }),
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
  }, tx: Prisma.TransactionClient): Promise<void> {
    const projectBudgetMicroUsd = this.usdToMicroUsd(
      this.toProjectBudgetUsd(args.project.totalBudgetUsd),
    );
    const activeAssignments = await tx.projectEmployeeAssignment.findMany({
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

    const hasJobTitleHeader = headers.some((header) =>
      DEPRECATED_JOB_TITLE_CSV_HEADERS.some(
        (alias) => alias === normalizeHeader(header),
      ),
    );
    if (hasJobTitleHeader) {
      throw new BadRequestException('CSV jobTitle column is no longer supported.');
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
        name: this.toNullableString(readOptionalCsvCell(row, headerMap.name)),
        rowNumber,
      });
    });

    return { rows, skippedRows };
  }

  private parseEmployeeOrganizationCsv(
    csvText: string,
  ): { rows: ParsedOrganizationCsvRow[]; skippedRows: EmployeeCsvSkippedRowDto[] } {
    const table = parseCsvTable(csvText);
    const [headers, ...dataRows] = table;

    if (!headers || headers.length === 0) {
      throw new BadRequestException('CSV header row is required.');
    }

    const hasJobTitleHeader = headers.some((header) =>
      DEPRECATED_JOB_TITLE_CSV_HEADERS.some(
        (alias) => alias === normalizeHeader(header),
      ),
    );
    if (hasJobTitleHeader) {
      throw new BadRequestException('CSV jobTitle column is no longer supported.');
    }

    const headerMap = buildHeaderMap(headers);
    if (headerMap.email === undefined) {
      throw new BadRequestException('CSV must include an email column.');
    }
    const emailColumnIndex = headerMap.email;

    const rows: ParsedOrganizationCsvRow[] = [];
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

      const projectBudgetUsd = parseOptionalNonnegativeNumber(
        readOptionalCsvCell(row, headerMap.projectBudgetUsd),
      );
      const employeeBudgetUsd = parseOptionalNonnegativeNumber(
        readOptionalCsvCell(row, headerMap.employeeBudgetUsd),
      );
      const warningThresholdPercent = parseOptionalIntegerInRange(
        readOptionalCsvCell(row, headerMap.warningThresholdPercent),
        0,
        100,
      );

      if (
        projectBudgetUsd === 'invalid' ||
        employeeBudgetUsd === 'invalid' ||
        warningThresholdPercent === 'invalid'
      ) {
        skippedRows.push({
          reason: 'Budget and warning threshold columns must be valid non-negative numbers.',
          rowNumber,
        });
        return;
      }

      rows.push({
        allowedModelKeys: splitDelimitedList(
          readOptionalCsvCell(row, headerMap.allowedModelKeys),
        ),
        allowedProviderConnectionIds: splitDelimitedList(
          readOptionalCsvCell(row, headerMap.allowedProviderConnectionIds),
        ),
        department: this.toNullableString(readOptionalCsvCell(row, headerMap.department)),
        email,
        employeeBudgetUsd: employeeBudgetUsd ?? 0,
        name: this.toNullableString(readOptionalCsvCell(row, headerMap.name)),
        policyNote: this.toNullableString(readOptionalCsvCell(row, headerMap.policyNote)),
        projectBudgetUsd,
        projectDescription: this.toNullableString(
          readOptionalCsvCell(row, headerMap.projectDescription),
        ),
        projectName: this.toNullableString(readOptionalCsvCell(row, headerMap.project)),
        rowNumber,
        warningThresholdPercent: warningThresholdPercent ?? DEFAULT_WARNING_THRESHOLD_PERCENT,
      });
    });

    return { rows, skippedRows };
  }

  private toProjectImportResponse(
    project: ProjectImportProjection,
    runtimeApplicationId: string | null,
  ): EmployeeImportProjectResponseDto {
    return {
      createdAt: project.createdAt.toISOString(),
      description: project.description,
      id: project.id,
      name: project.name,
      runtimeApplicationId,
      status: project.status,
      tenantId: project.tenantId,
      totalBudgetUsd: this.toProjectBudgetUsd(project.totalBudgetUsd),
      updatedAt: project.updatedAt.toISOString(),
      warningThresholdPercent: DEFAULT_WARNING_THRESHOLD_PERCENT,
    };
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

  private buildEmployeeSignupUrl(token: string): string {
    const origin = this.config.getOrThrow<string>('CONTROL_PLANE_WEB_ORIGIN');

    return `${origin.replace(/\/+$/, '')}/?employeeInvite=${encodeURIComponent(token)}`;
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

function splitDelimitedList(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return uniqueTrimmedStrings(value.split(/[;,|]/));
}

function parseOptionalNonnegativeNumber(value: string | null): number | null | 'invalid' {
  if (!value || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 'invalid';
}

function parseOptionalIntegerInRange(
  value: string | null,
  min: number,
  max: number,
): number | null | 'invalid' {
  if (!value || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : 'invalid';
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
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
