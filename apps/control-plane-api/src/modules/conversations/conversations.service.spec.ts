import { BadRequestException, NotFoundException } from '@nestjs/common';

import {
  ChatMessageEntity,
  ConversationEntity,
  ConversationsRepository,
} from './conversations.repository';
import { ConversationsService } from './conversations.service';

describe('ConversationsService', () => {
  const tenantId = '00000000-0000-4000-8000-000000000100';
  const projectId = '00000000-0000-4000-8000-000000000200';
  const applicationId = '00000000-0000-4000-8000-000000000300';
  const conversationId = '00000000-0000-4000-8000-000000000400';
  const createdAt = new Date('2026-07-05T00:00:00.000Z');

  function createService(options: { retention?: boolean } = {}) {
    const repository = new FakeConversationsRepository(
      conversation({ contextRetentionEnabled: options.retention ?? false }),
    );

    return {
      repository,
      service: new ConversationsService(repository),
    };
  }

  it('creates conversations only for a matching tenant/project/application scope', async () => {
    const { repository, service } = createService();

    const result = await service.createConversation({
      applicationId,
      contextRetentionEnabled: true,
      endUserId: 'customer_user_demo_live',
      projectId,
      tenantId,
      title: 'Support chat',
    });

    expect(repository.createdConversations).toHaveLength(1);
    expect(repository.createdConversations[0]).toMatchObject({
      applicationId,
      contextRetentionEnabled: true,
      projectId,
      tenantId,
    });
    expect(result).toMatchObject({
      applicationId,
      contextRetentionEnabled: true,
      projectId,
      tenantId,
      title: 'Support chat',
    });
  });

  it('defaults new conversations to context retention off', async () => {
    const { repository, service } = createService();

    const result = await service.createConversation({
      applicationId,
      projectId,
      tenantId,
    });

    expect(repository.createdConversations[0]).toMatchObject({
      contextRetentionEnabled: false,
    });
    expect(result.contextRetentionEnabled).toBe(false);
  });

  it('blocks conversation creation when the application scope does not match', async () => {
    const { repository, service } = createService();
    repository.applicationScopeExists = false;

    await expect(
      service.createConversation({
        applicationId,
        projectId,
        tenantId,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createdConversations).toHaveLength(0);
  });

  it('lists conversations for the requested application scope', async () => {
    const { service } = createService();

    const result = await service.listConversations({
      applicationId,
      limit: 20,
      projectId,
      tenantId,
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      applicationId,
      id: conversationId,
      projectId,
      tenantId,
    });
  });

  it('updates context retention without exposing previous raw content', async () => {
    const { repository, service } = createService({ retention: true });

    const result = await service.updateConversation(conversationId, {
      applicationId,
      contextRetentionEnabled: false,
      projectId,
      tenantId,
    });

    expect(repository.conversation?.contextRetentionEnabled).toBe(false);
    expect(result).toMatchObject({
      contextRetentionEnabled: false,
      id: conversationId,
    });
  });

  it('soft deletes conversations and blocks later message writes', async () => {
    const { repository, service } = createService({ retention: true });

    const result = await service.updateConversation(conversationId, {
      applicationId,
      projectId,
      status: 'deleted',
      tenantId,
    });

    expect(result.status).toBe('deleted');
    expect(result.deletedAt).toEqual(expect.any(String));
    expect(repository.conversation?.deletedAt).toBeInstanceOf(Date);

    await expect(
      service.createMessage(conversationId, {
        applicationId,
        content: 'hello after delete',
        projectId,
        role: 'user',
        tenantId,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.createdMessages).toHaveLength(0);
  });

  it('does not retain safeContent when context retention is disabled', async () => {
    const { repository, service } = createService({ retention: false });

    const result = await service.createMessage(conversationId, {
      applicationId,
      content:
        'Email minji.kim@example.test with Bearer abcdefgh.',
      projectId,
      role: 'user',
      tenantId,
    });

    expect(repository.createdMessages[0]).toMatchObject({
      contentPolicy: 'not_retained',
      role: 'user',
      safeContent: null,
    });
    expect(result.message).toMatchObject({
      contentPolicy: 'not_retained',
      safeContent: null,
    });
    expect(result.context.messages).toHaveLength(2);
    expect(result.context.messages.map((message) => message.role)).toEqual([
      'system',
      'user',
    ]);
    expect(result.context.messages[1]?.content).toContain('[EMAIL_1]');
    expect(result.context.messages[1]?.content).toContain(
      '[AUTHORIZATION_REDACTED]',
    );
    expect(JSON.stringify(result)).not.toContain('minji.kim@example.test');
    expect(JSON.stringify(result)).not.toContain('abcdefgh');
    expect(repository.listRetainedCalls).toBe(0);
  });

  it('assembles previous retained safe messages in sequence order when retention is enabled', async () => {
    const { repository, service } = createService({ retention: true });
    repository.retainedMessages = [
      message({ role: 'assistant', safeContent: 'second', sequence: 2 }),
      message({ role: 'user', safeContent: 'first', sequence: 1 }),
      message({
        contentPolicy: 'not_retained',
        role: 'assistant',
        safeContent: null,
        sequence: 3,
      }),
      message({ role: 'user', safeContent: 'third', sequence: 4 }),
    ];

    const result = await service.createMessage(conversationId, {
      applicationId,
      content: 'current user message',
      projectId,
      role: 'user',
      tenantId,
    });

    expect(result.context.messages.map((item) => item.content)).toEqual([
      'You are a helpful customer support assistant.',
      'first',
      'second',
      'third',
      'current user message',
    ]);
    expect(result.context.messages.map((item) => item.role)).toEqual([
      'system',
      'user',
      'assistant',
      'user',
      'user',
    ]);
  });

  it('limits sliding window to the latest ten user turns', async () => {
    const { repository, service } = createService({ retention: true });
    repository.retainedMessages = Array.from({ length: 12 }, (_, index) =>
      message({
        role: 'user',
        safeContent: `previous user ${index + 1}`,
        sequence: index + 1,
      }),
    );

    const result = await service.createMessage(conversationId, {
      applicationId,
      content: 'current',
      projectId,
      role: 'user',
      tenantId,
    });

    expect(result.context.messages.slice(1).map((item) => item.content)).toEqual([
      'previous user 3',
      'previous user 4',
      'previous user 5',
      'previous user 6',
      'previous user 7',
      'previous user 8',
      'previous user 9',
      'previous user 10',
      'previous user 11',
      'previous user 12',
      'current',
    ]);
  });

  it('limits sliding window to eight thousand previous-message characters', async () => {
    const { repository, service } = createService({ retention: true });
    repository.retainedMessages = [
      message({ role: 'user', safeContent: 'a'.repeat(3000), sequence: 1 }),
      message({ role: 'assistant', safeContent: 'b'.repeat(3000), sequence: 2 }),
      message({ role: 'user', safeContent: 'c'.repeat(3000), sequence: 3 }),
    ];

    const result = await service.createMessage(conversationId, {
      applicationId,
      content: 'current',
      projectId,
      role: 'user',
      tenantId,
    });

    expect(result.context.messages.slice(1).map((item) => item.content)).toEqual([
      'b'.repeat(3000),
      'c'.repeat(3000),
      'current',
    ]);
  });

  it('blocks cross-scope message access without leaking another tenant conversation', async () => {
    const { repository, service } = createService();
    repository.conversation = null;

    await expect(
      service.createMessage(conversationId, {
        applicationId,
        content: 'hello',
        projectId,
        role: 'user',
        tenantId,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(repository.createdMessages).toHaveLength(0);
  });

  function conversation(
    overrides: Partial<ConversationEntity> = {},
  ): ConversationEntity {
    return {
      applicationId,
      contextRetentionEnabled: false,
      createdAt,
      deletedAt: null,
      endUserId: 'customer_user_demo_live',
      id: conversationId,
      projectId,
      status: 'active',
      tenantId,
      title: 'Support chat',
      updatedAt: createdAt,
      ...overrides,
    };
  }

  function message(overrides: Partial<ChatMessageEntity>): ChatMessageEntity {
    return {
      applicationId,
      contentPolicy: 'retained',
      conversationId,
      createdAt,
      id: `00000000-0000-4000-8000-0000000005${String(
        overrides.sequence ?? 0,
      ).padStart(2, '0')}`,
      parentMessageId: null,
      projectId,
      requestId: null,
      role: 'user',
      safeContent: 'message',
      sequence: 1,
      tenantId,
      ...overrides,
    };
  }

  class FakeConversationsRepository implements ConversationsRepository {
    applicationScopeExists = true;
    conversation: ConversationEntity | null;
    createdConversations: Array<Partial<ConversationEntity>> = [];
    createdMessages: Array<Partial<ChatMessageEntity>> = [];
    listRetainedCalls = 0;
    retainedMessages: ChatMessageEntity[] = [];

    constructor(conversationEntity: ConversationEntity) {
      this.conversation = conversationEntity;
    }

    async applicationExistsForScope(): Promise<boolean> {
      return this.applicationScopeExists;
    }

    async createConversation(
      data: Parameters<ConversationsRepository['createConversation']>[0],
    ): Promise<ConversationEntity> {
      this.createdConversations.push(data);
      return conversation({
        contextRetentionEnabled: data.contextRetentionEnabled,
        endUserId: data.endUserId,
        title: data.title,
      });
    }

    async createMessageWithNextSequence(
      data: Parameters<ConversationsRepository['createMessageWithNextSequence']>[0],
    ): Promise<ChatMessageEntity> {
      this.createdMessages.push(data);
      return message({
        contentPolicy: data.contentPolicy,
        parentMessageId: data.parentMessageId,
        requestId: data.requestId,
        role: data.role,
        safeContent: data.safeContent,
        sequence: 99,
      });
    }

    async findConversationForScope(): Promise<ConversationEntity | null> {
      return this.conversation;
    }

    async listConversations(): Promise<ConversationEntity[]> {
      return this.conversation ? [this.conversation] : [];
    }

    async listMessages(): Promise<ChatMessageEntity[]> {
      return [];
    }

    async listRetainedMessagesBeforeSequence(): Promise<ChatMessageEntity[]> {
      this.listRetainedCalls += 1;
      return this.retainedMessages;
    }

    async updateConversation(
      _conversationId: string,
      _scope: Parameters<ConversationsRepository['updateConversation']>[1],
      data: Parameters<ConversationsRepository['updateConversation']>[2],
    ): Promise<ConversationEntity | null> {
      if (!this.conversation) {
        return null;
      }

      this.conversation = {
        ...this.conversation,
        ...data,
        deletedAt: data.deletedAt ?? this.conversation.deletedAt,
      };

      return this.conversation;
    }
  }
});
