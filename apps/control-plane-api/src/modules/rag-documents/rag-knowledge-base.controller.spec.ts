import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');

import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { RagKnowledgeBaseController } from './rag-knowledge-base.controller';
import { RagKnowledgeBaseService } from './rag-knowledge-base.service';

describe('RagKnowledgeBaseController admin authorization', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const otherTenantId = '00000000-0000-4000-8000-000000000101';
  const adminUserId = '00000000-0000-4000-8000-000000000200';
  const settings = {
    tenantEnabled: false,
    globalEnabled: true,
    effectiveEnabled: false,
  };

  let app: INestApplication;
  let membershipTenantIds: string[];
  let service: {
    getSettings: jest.Mock;
    updateSettings: jest.Mock;
  };

  beforeEach(async () => {
    membershipTenantIds = [tenantId];
    service = {
      getSettings: jest.fn().mockResolvedValue(settings),
      updateSettings: jest
        .fn()
        .mockResolvedValue({ ...settings, tenantEnabled: true, effectiveEnabled: true }),
    };
    const prisma = {
      authSession: {
        findUnique: jest.fn().mockResolvedValue({
          expiresAt: new Date(Date.now() + 60_000),
          kind: 'full',
          revokedAt: null,
          userId: adminUserId,
        }),
      },
      tenantMembership: {
        findMany: jest.fn().mockImplementation(async () =>
          membershipTenantIds.map((scopedTenantId) => ({
            tenantId: scopedTenantId,
          })),
        ),
      },
      tenantAdmin: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [RagKnowledgeBaseController],
      providers: [
        AdminAuthGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: RagKnowledgeBaseService, useValue: service },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        forbidNonWhitelisted: true,
        transform: true,
        whitelist: true,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('allows a tenant administrator to read and update the tenant setting', async () => {
    await request(app.getHttpServer())
      .get(`/admin/v1/tenants/${tenantId}/rag/knowledge-base`)
      .set('Cookie', 'gatelm_session=session-token')
      .expect(200, { data: settings });

    await request(app.getHttpServer())
      .patch(`/admin/v1/tenants/${tenantId}/rag/knowledge-base`)
      .set('Cookie', 'gatelm_session=session-token')
      .send({ enabled: true })
      .expect(200);

    expect(service.getSettings).toHaveBeenCalledWith(tenantId);
    expect(service.updateSettings).toHaveBeenCalledWith(tenantId, true);
  });

  it('requires a full administrator session for both operations', async () => {
    await request(app.getHttpServer())
      .get(`/admin/v1/tenants/${tenantId}/rag/knowledge-base`)
      .expect(401);
    await request(app.getHttpServer())
      .patch(`/admin/v1/tenants/${tenantId}/rag/knowledge-base`)
      .send({ enabled: true })
      .expect(401);

    expect(service.getSettings).not.toHaveBeenCalled();
    expect(service.updateSettings).not.toHaveBeenCalled();
  });

  it('rejects a general employee and another tenant administrator before service execution', async () => {
    membershipTenantIds = [];
    await request(app.getHttpServer())
      .patch(`/admin/v1/tenants/${tenantId}/rag/knowledge-base`)
      .set('Cookie', 'gatelm_session=session-token')
      .send({ enabled: true })
      .expect(403);

    membershipTenantIds = [tenantId];
    await request(app.getHttpServer())
      .patch(`/admin/v1/tenants/${otherTenantId}/rag/knowledge-base`)
      .set('Cookie', 'gatelm_session=session-token')
      .send({ enabled: true })
      .expect(403);

    expect(service.updateSettings).not.toHaveBeenCalled();
  });

  it('requires a boolean-only body and rejects client scope overrides', async () => {
    await request(app.getHttpServer())
      .patch(`/admin/v1/tenants/${tenantId}/rag/knowledge-base`)
      .set('Cookie', 'gatelm_session=session-token')
      .send({ enabled: 'true' })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/admin/v1/tenants/${tenantId}/rag/knowledge-base`)
      .set('Cookie', 'gatelm_session=session-token')
      .send({ enabled: true, tenantId: otherTenantId })
      .expect(400);
    await request(app.getHttpServer())
      .get(
        `/admin/v1/tenants/${tenantId}/rag/knowledge-base?knowledgeBaseId=${tenantId}`,
      )
      .set('Cookie', 'gatelm_session=session-token')
      .expect(400);

    expect(service.updateSettings).not.toHaveBeenCalled();
    expect(service.getSettings).not.toHaveBeenCalled();
  });
});
