import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request = require('supertest');

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';

import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

describe('ConversationsController', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const projectId = '00000000-0000-4000-8000-000000000200';
  const applicationId = '00000000-0000-4000-8000-000000000300';
  const conversationId = '00000000-0000-4000-8000-000000000400';
  const timestamp = '2026-07-05T00:00:00.000Z';
  let app: INestApplication;
  let service: {
    createConversation: jest.Mock;
    createMessage: jest.Mock;
    getMessages: jest.Mock;
    listConversations: jest.Mock;
    updateConversation: jest.Mock;
  };

  beforeEach(async () => {
    service = {
      createConversation: jest.fn(async () => conversationResponse()),
      createMessage: jest.fn(async () => ({
        context: {
          contextRetentionEnabled: false,
          maxPreviousChars: 8000,
          maxPreviousUserTurns: 10,
          messages: [
            {
              content: 'You are a helpful customer support assistant.',
              role: 'system',
            },
            {
              content: 'hello',
              role: 'user',
            },
          ],
          strategy: 'sliding_window',
        },
        message: {
          applicationId,
          contentPolicy: 'not_retained',
          conversationId,
          createdAt: timestamp,
          id: '00000000-0000-4000-8000-000000000401',
          parentMessageId: null,
          projectId,
          requestId: null,
          role: 'user',
          safeContent: null,
          sequence: 1,
          tenantId,
        },
      })),
      getMessages: jest.fn(async () => []),
      listConversations: jest.fn(async () => [conversationResponse()]),
      updateConversation: jest.fn(async () =>
        conversationResponse({ contextRetentionEnabled: false }),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [ConversationsController],
      providers: [
        {
          provide: ConversationsService,
          useValue: service,
        },
        AdminAuthGuard,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) =>
              key === 'CONTROL_PLANE_ADMIN_AUTH_MODE'
                ? 'demo_admin_placeholder'
                : undefined,
          },
        },
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
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
  });

  it('creates an Application-scoped conversation', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/chat/conversations')
      .send({
        applicationId,
        contextRetentionEnabled: true,
        projectId,
        tenantId,
      })
      .expect(201);

    expect(response.body.data).toMatchObject({
      applicationId,
      contextRetentionEnabled: true,
      id: conversationId,
      projectId,
      tenantId,
    });
    expect(service.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId,
        contextRetentionEnabled: true,
        projectId,
        tenantId,
      }),
    );
  });

  it('creates a message and returns assembled Gateway context', async () => {
    const response = await request(app.getHttpServer())
      .post(`/api/chat/conversations/${conversationId}/messages`)
      .send({
        applicationId,
        content: 'hello',
        projectId,
        role: 'user',
        tenantId,
      })
      .expect(201);

    expect(response.body.data.context).toMatchObject({
      contextRetentionEnabled: false,
      strategy: 'sliding_window',
    });
    expect(response.body.data.context.messages).toHaveLength(2);
    expect(service.createMessage).toHaveBeenCalledWith(
      conversationId,
      expect.objectContaining({
        applicationId,
        content: 'hello',
        projectId,
        role: 'user',
        tenantId,
      }),
    );
  });

  function conversationResponse(
    overrides: Partial<{
      applicationId: string;
      contextRetentionEnabled: boolean;
      createdAt: string;
      deletedAt: string | null;
      endUserId: string | null;
      id: string;
      projectId: string;
      status: string;
      tenantId: string;
      title: string | null;
      updatedAt: string;
    }> = {},
  ) {
    return {
      applicationId,
      contextRetentionEnabled: true,
      createdAt: timestamp,
      deletedAt: null,
      endUserId: null,
      id: conversationId,
      projectId,
      status: 'active',
      tenantId,
      title: null,
      updatedAt: timestamp,
      ...overrides,
    };
  }
});
