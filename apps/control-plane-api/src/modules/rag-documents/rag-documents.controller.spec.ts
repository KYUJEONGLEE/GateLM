import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request = require('supertest');

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { HttpExceptionFilter } from '@/common/filters/http-exception.filter';
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import { RagDocumentsController } from './rag-documents.controller';
import { RagDocumentsService } from './rag-documents.service';

describe('RagDocumentsController admin authorization', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const otherTenantId = '00000000-0000-4000-8000-000000000101';
  const adminUserId = '00000000-0000-4000-8000-000000000200';
  const documentId = '00000000-0000-4000-8000-000000000300';
  const response = {
    documentId,
    displayName: 'Policy',
    mimeType: 'text/plain' as const,
    sizeBytes: 5,
    status: 'UPLOADED',
    failureCode: null,
    failureMessage: null,
    uploadedBy: { displayName: 'Tenant Admin' },
    createdAt: '2026-07-16T00:00:00.000Z',
    updatedAt: '2026-07-16T00:00:00.000Z',
  };

  let app: INestApplication;
  let membershipTenantIds: string[];
  let service: {
    upload: jest.Mock;
    list: jest.Mock;
    getStatus: jest.Mock;
    requestDelete: jest.Mock;
  };

  beforeEach(async () => {
    membershipTenantIds = [tenantId];
    service = {
      upload: jest.fn().mockResolvedValue(response),
      list: jest.fn().mockResolvedValue({
        data: [response],
        pagination: { limit: 50, nextCursor: null, hasMore: false },
      }),
      getStatus: jest.fn().mockResolvedValue(response),
      requestDelete: jest.fn().mockResolvedValue({ ...response, status: 'DELETING' }),
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
      controllers: [RagDocumentsController],
      providers: [
        AdminAuthGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: RagDocumentsService, useValue: service },
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

  it('accepts a tenant-admin upload and uses only the authenticated user ID', async () => {
    const httpResponse = await request(app.getHttpServer())
      .post(`/admin/v1/tenants/${tenantId}/rag/documents`)
      .set('Cookie', 'gatelm_session=session-token')
      .attach('file', Buffer.from('hello'), {
        filename: 'policy.txt',
        contentType: 'text/plain',
      })
      .expect(202);

    expect(httpResponse.body).toEqual({ data: response });
    expect(service.upload).toHaveBeenCalledWith(
      tenantId,
      adminUserId,
      expect.anything(),
    );
  });

  it('rejects a general employee before the upload service is called', async () => {
    membershipTenantIds = [];

    await request(app.getHttpServer())
      .post(`/admin/v1/tenants/${tenantId}/rag/documents`)
      .set('Cookie', 'gatelm_session=session-token')
      .attach('file', Buffer.from('hello'), {
        filename: 'policy.txt',
        contentType: 'text/plain',
      })
      .expect(403);

    expect(service.upload).not.toHaveBeenCalled();
  });

  it('rejects an administrator outside the route tenant before upload', async () => {
    await request(app.getHttpServer())
      .post(`/admin/v1/tenants/${otherTenantId}/rag/documents`)
      .set('Cookie', 'gatelm_session=session-token')
      .attach('file', Buffer.from('hello'), {
        filename: 'policy.txt',
        contentType: 'text/plain',
      })
      .expect(403);

    expect(service.upload).not.toHaveBeenCalled();
  });

  it('requires the full admin session for list and status reads', async () => {
    await request(app.getHttpServer())
      .get(`/admin/v1/tenants/${tenantId}/rag/documents`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/admin/v1/tenants/${tenantId}/rag/documents/${documentId}`)
      .expect(401);

    expect(service.list).not.toHaveBeenCalled();
    expect(service.getStatus).not.toHaveBeenCalled();
  });

  it('accepts only a tenant-admin DELETE and never accepts tenant scope from a request body', async () => {
    const httpResponse = await request(app.getHttpServer())
      .delete(`/admin/v1/tenants/${tenantId}/rag/documents/${documentId}`)
      .set('Cookie', 'gatelm_session=session-token')
      .expect(202);

    expect(httpResponse.body).toEqual({ data: { ...response, status: 'DELETING' } });
    expect(service.requestDelete).toHaveBeenCalledWith(tenantId, documentId);

    await request(app.getHttpServer())
      .delete(`/admin/v1/tenants/${otherTenantId}/rag/documents/${documentId}`)
      .set('Cookie', 'gatelm_session=session-token')
      .expect(403);
    expect(service.requestDelete).toHaveBeenCalledTimes(1);
  });

  it('rejects tenant or knowledge-base query overrides on upload and status', async () => {
    await request(app.getHttpServer())
      .post(
        `/admin/v1/tenants/${tenantId}/rag/documents?tenantId=${otherTenantId}`,
      )
      .set('Cookie', 'gatelm_session=session-token')
      .attach('file', Buffer.from('hello'), {
        filename: 'policy.txt',
        contentType: 'text/plain',
      })
      .expect(400);

    await request(app.getHttpServer())
      .get(
        `/admin/v1/tenants/${tenantId}/rag/documents/${documentId}?knowledgeBaseId=${documentId}`,
      )
      .set('Cookie', 'gatelm_session=session-token')
      .expect(400);

    expect(service.upload).not.toHaveBeenCalled();
    expect(service.getStatus).not.toHaveBeenCalled();
  });
});
