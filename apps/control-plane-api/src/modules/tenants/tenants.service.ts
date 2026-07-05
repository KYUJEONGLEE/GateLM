import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  CreateTenantDto,
  ListTenantsQueryDto,
  TenantResponseDto,
  UpdateTenantDto,
} from './dto/tenant.dto';

const DEFAULT_TENANT_BUDGET_USD = 1000;
const DEFAULT_PROJECT_BUDGET_USD = 100;

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTenant(dto: CreateTenantDto): Promise<TenantResponseDto> {
    const tenant = await this.prisma.tenant.create({
      data: {
        name: dto.name,
        totalBudgetUsd: dto.totalBudgetUsd ?? DEFAULT_TENANT_BUDGET_USD,
      },
    });

    return this.toTenantResponse(tenant);
  }

  async listTenants(
    query: ListTenantsQueryDto,
  ): Promise<ListEnvelope<TenantResponseDto>> {
    const limit = query.limit ?? 50;
    let tenants: Tenant[];
    try {
      tenants = await this.prisma.tenant.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });
    } catch (error) {
      if (this.isRecordNotFoundError(error)) {
        throw new BadRequestException('Tenant cursor is invalid.');
      }

      throw error;
    }
    const hasMore = tenants.length > limit;
    const page = tenants.slice(0, limit);

    return {
      data: page.map((tenant) => this.toTenantResponse(tenant)),
      pagination: {
        limit,
        nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
        hasMore,
      },
    };
  }

  async updateTenant(
    tenantId: string,
    dto: UpdateTenantDto,
  ): Promise<TenantResponseDto> {
    const data: Prisma.TenantUpdateInput = {};

    if (dto.name !== undefined) {
      data.name = dto.name;
    }
    if (dto.status !== undefined) {
      data.status = dto.status;
    }
    if (dto.totalBudgetUsd !== undefined) {
      await this.assertTenantBudgetCanCoverProjects(
        tenantId,
        dto.totalBudgetUsd,
      );
      data.totalBudgetUsd = dto.totalBudgetUsd;
    }

    if (Object.keys(data).length === 0) {
      return this.getTenantOrThrow(tenantId);
    }

    try {
      const tenant = await this.prisma.tenant.update({
        where: { id: tenantId },
        data,
      });

      return this.toTenantResponse(tenant);
    } catch (error) {
      if (this.isRecordNotFoundError(error)) {
        throw new NotFoundException('Tenant not found.');
      }

      throw error;
    }
  }

  private async getTenantOrThrow(tenantId: string): Promise<TenantResponseDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found.');
    }

    return this.toTenantResponse(tenant);
  }

  private async assertTenantBudgetCanCoverProjects(
    tenantId: string,
    totalBudgetUsd: number,
  ): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        projects: {
          where: {
            status: {
              not: 'ARCHIVED',
            },
          },
          select: {
            totalBudgetUsd: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundException('Tenant not found.');
    }

    const allocatedBudgetUsd = tenant.projects.reduce(
      (total, project) =>
        total +
        Math.max(
          0,
          this.toNumber(project.totalBudgetUsd) ?? DEFAULT_PROJECT_BUDGET_USD,
        ),
      0,
    );

    if (allocatedBudgetUsd > totalBudgetUsd) {
      throw new ConflictException('Project budgets exceed the tenant budget.');
    }
  }

  private toTenantResponse(tenant: Tenant): TenantResponseDto {
    return {
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
      totalBudgetUsd:
        this.toNumber(tenant.totalBudgetUsd) ?? DEFAULT_TENANT_BUDGET_USD,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  }

  private toNumber(value: Prisma.Decimal | null | undefined): number | null {
    return value === null || value === undefined ? null : value.toNumber();
  }

  private isRecordNotFoundError(
    error: unknown,
  ): error is Prisma.PrismaClientKnownRequestError {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2025'
    );
  }
}
