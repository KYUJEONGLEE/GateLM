import { Injectable } from '@nestjs/common';
import { Tenant } from '@prisma/client';

import { ListEnvelope } from '@/common/types/envelope';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  CreateTenantDto,
  ListTenantsQueryDto,
  TenantResponseDto,
} from './dto/tenant.dto';

@Injectable()
export class TenantsService {
  constructor(private readonly prisma: PrismaService) {}

  async createTenant(dto: CreateTenantDto): Promise<TenantResponseDto> {
    const tenant = await this.prisma.tenant.create({
      data: {
        name: dto.name,
      },
    });

    return this.toTenantResponse(tenant);
  }

  async listTenants(
    query: ListTenantsQueryDto,
  ): Promise<ListEnvelope<TenantResponseDto>> {
    const limit = query.limit ?? 50;
    const tenants = await this.prisma.tenant.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
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

  private toTenantResponse(tenant: Tenant): TenantResponseDto {
    return {
      id: tenant.id,
      name: tenant.name,
      status: tenant.status,
      createdAt: tenant.createdAt.toISOString(),
      updatedAt: tenant.updatedAt.toISOString(),
    };
  }
}
