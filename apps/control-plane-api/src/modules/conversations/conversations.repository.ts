import { Injectable } from '@nestjs/common';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import {
  ChatMessageContentPolicyDto,
  ChatMessageRoleDto,
  ConversationStatusDto,
} from './dto/conversation.dto';

export interface ConversationScope {
  applicationId: string;
  projectId: string;
  tenantId: string;
}

export interface ConversationEntity extends ConversationScope {
  contextRetentionEnabled: boolean;
  createdAt: Date;
  deletedAt: Date | null;
  endUserId: string | null;
  id: string;
  status: ConversationStatusDto;
  title: string | null;
  updatedAt: Date;
}

export interface ChatMessageEntity extends ConversationScope {
  contentPolicy: ChatMessageContentPolicyDto;
  conversationId: string;
  createdAt: Date;
  id: string;
  parentMessageId: string | null;
  requestId: string | null;
  role: ChatMessageRoleDto;
  safeContent: string | null;
  sequence: number;
}

export interface CreateConversationRecord extends ConversationScope {
  contextRetentionEnabled: boolean;
  endUserId: string | null;
  title: string | null;
}

export interface CreateMessageRecord extends ConversationScope {
  contentPolicy: ChatMessageContentPolicyDto;
  conversationId: string;
  parentMessageId: string | null;
  requestId: string | null;
  role: ChatMessageRoleDto;
  safeContent: string | null;
}

export interface UpdateConversationRecord {
  contextRetentionEnabled?: boolean;
  deletedAt?: Date | null;
  status?: ConversationStatusDto;
  title?: string | null;
}

type ConversationRow = ConversationEntity;
type ChatMessageRow = ChatMessageEntity;

type ConversationDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<ConversationRow>;
  findFirst(args: Record<string, unknown>): Promise<ConversationRow | null>;
  findMany(args: Record<string, unknown>): Promise<ConversationRow[]>;
  update(args: {
    data: Record<string, unknown>;
    where: { id: string };
  }): Promise<ConversationRow>;
};

type ChatMessageDelegate = {
  create(args: { data: Record<string, unknown> }): Promise<ChatMessageRow>;
  findFirst(args: Record<string, unknown>): Promise<Pick<ChatMessageRow, 'sequence'> | null>;
  findMany(args: Record<string, unknown>): Promise<ChatMessageRow[]>;
};

type ConversationPrismaClient = {
  chatMessage: ChatMessageDelegate;
  conversation: ConversationDelegate;
  $transaction<T>(
    callback: (tx: {
      chatMessage: ChatMessageDelegate;
    }) => Promise<T>,
  ): Promise<T>;
};

export abstract class ConversationsRepository {
  abstract applicationExistsForScope(scope: ConversationScope): Promise<boolean>;

  abstract createConversation(
    data: CreateConversationRecord,
  ): Promise<ConversationEntity>;

  abstract createMessageWithNextSequence(
    data: CreateMessageRecord,
  ): Promise<ChatMessageEntity>;

  abstract findConversationForScope(
    conversationId: string,
    scope: ConversationScope,
  ): Promise<ConversationEntity | null>;

  abstract listConversations(args: {
    cursor?: string;
    limit: number;
    scope: ConversationScope;
  }): Promise<ConversationEntity[]>;

  abstract listMessages(args: {
    conversationId: string;
    cursor?: string;
    limit: number;
    scope: ConversationScope;
  }): Promise<ChatMessageEntity[]>;

  abstract listRetainedMessagesBeforeSequence(args: {
    conversationId: string;
    sequence: number;
    scope: ConversationScope;
    take: number;
  }): Promise<ChatMessageEntity[]>;

  abstract updateConversation(
    conversationId: string,
    scope: ConversationScope,
    data: UpdateConversationRecord,
  ): Promise<ConversationEntity | null>;
}

@Injectable()
export class PrismaConversationsRepository extends ConversationsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async applicationExistsForScope(scope: ConversationScope): Promise<boolean> {
    const application = await this.prisma.application.findFirst({
      where: {
        id: scope.applicationId,
        projectId: scope.projectId,
        tenantId: scope.tenantId,
      },
      select: { id: true },
    });

    return application !== null;
  }

  async createConversation(
    data: CreateConversationRecord,
  ): Promise<ConversationEntity> {
    const conversation = await this.client.conversation.create({
      data: {
        applicationId: data.applicationId,
        contextRetentionEnabled: data.contextRetentionEnabled,
        endUserId: data.endUserId,
        projectId: data.projectId,
        status: 'active',
        tenantId: data.tenantId,
        title: data.title,
      },
    });

    return this.toConversationEntity(conversation);
  }

  async createMessageWithNextSequence(
    data: CreateMessageRecord,
  ): Promise<ChatMessageEntity> {
    const message = await this.client.$transaction(async (tx) => {
      const latest = await tx.chatMessage.findFirst({
        orderBy: { sequence: 'desc' },
        select: { sequence: true },
        where: { conversationId: data.conversationId },
      });
      const sequence = (latest?.sequence ?? 0) + 1;

      return tx.chatMessage.create({
        data: {
          applicationId: data.applicationId,
          contentPolicy: data.contentPolicy,
          conversationId: data.conversationId,
          parentMessageId: data.parentMessageId,
          projectId: data.projectId,
          requestId: data.requestId,
          role: data.role,
          safeContent: data.safeContent,
          sequence,
          tenantId: data.tenantId,
        },
      });
    });

    return this.toChatMessageEntity(message);
  }

  async findConversationForScope(
    conversationId: string,
    scope: ConversationScope,
  ): Promise<ConversationEntity | null> {
    const conversation = await this.client.conversation.findFirst({
      where: {
        applicationId: scope.applicationId,
        id: conversationId,
        projectId: scope.projectId,
        tenantId: scope.tenantId,
      },
    });

    return conversation ? this.toConversationEntity(conversation) : null;
  }

  async listConversations(args: {
    cursor?: string;
    limit: number;
    scope: ConversationScope;
  }): Promise<ConversationEntity[]> {
    const conversations = await this.client.conversation.findMany({
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      take: args.limit,
      where: {
        applicationId: args.scope.applicationId,
        deletedAt: null,
        projectId: args.scope.projectId,
        tenantId: args.scope.tenantId,
        ...(args.cursor
          ? {
              id: {
                gt: args.cursor,
              },
            }
          : {}),
      },
    });

    return conversations.map((conversation) =>
      this.toConversationEntity(conversation),
    );
  }

  async listMessages(args: {
    conversationId: string;
    cursor?: string;
    limit: number;
    scope: ConversationScope;
  }): Promise<ChatMessageEntity[]> {
    const messages = await this.client.chatMessage.findMany({
      orderBy: [{ sequence: 'asc' }, { id: 'asc' }],
      take: args.limit,
      where: {
        applicationId: args.scope.applicationId,
        conversationId: args.conversationId,
        projectId: args.scope.projectId,
        tenantId: args.scope.tenantId,
        ...(args.cursor
          ? {
              id: {
                gt: args.cursor,
              },
            }
          : {}),
      },
    });

    return messages.map((message) => this.toChatMessageEntity(message));
  }

  async listRetainedMessagesBeforeSequence(args: {
    conversationId: string;
    sequence: number;
    scope: ConversationScope;
    take: number;
  }): Promise<ChatMessageEntity[]> {
    const messages = await this.client.chatMessage.findMany({
      orderBy: [{ sequence: 'desc' }, { id: 'desc' }],
      take: args.take,
      where: {
        applicationId: args.scope.applicationId,
        contentPolicy: {
          not: 'not_retained',
        },
        conversationId: args.conversationId,
        projectId: args.scope.projectId,
        safeContent: {
          not: null,
        },
        sequence: {
          lt: args.sequence,
        },
        tenantId: args.scope.tenantId,
      },
    });

    return messages.map((message) => this.toChatMessageEntity(message));
  }

  async updateConversation(
    conversationId: string,
    scope: ConversationScope,
    data: UpdateConversationRecord,
  ): Promise<ConversationEntity | null> {
    const current = await this.findConversationForScope(conversationId, scope);

    if (!current) {
      return null;
    }

    const conversation = await this.client.conversation.update({
      data: { ...data },
      where: { id: conversationId },
    });

    return this.toConversationEntity(conversation);
  }

  private get client(): ConversationPrismaClient {
    return this.prisma as unknown as ConversationPrismaClient;
  }

  private toConversationEntity(row: ConversationRow): ConversationEntity {
    return {
      applicationId: row.applicationId,
      contextRetentionEnabled: row.contextRetentionEnabled,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
      endUserId: row.endUserId,
      id: row.id,
      projectId: row.projectId,
      status: this.toConversationStatus(row.status),
      tenantId: row.tenantId,
      title: row.title,
      updatedAt: row.updatedAt,
    };
  }

  private toChatMessageEntity(row: ChatMessageRow): ChatMessageEntity {
    return {
      applicationId: row.applicationId,
      contentPolicy: this.toContentPolicy(row.contentPolicy),
      conversationId: row.conversationId,
      createdAt: row.createdAt,
      id: row.id,
      parentMessageId: row.parentMessageId,
      projectId: row.projectId,
      requestId: row.requestId,
      role: this.toRole(row.role),
      safeContent: row.safeContent,
      sequence: row.sequence,
      tenantId: row.tenantId,
    };
  }

  private toConversationStatus(value: string): ConversationStatusDto {
    if (value === 'archived' || value === 'deleted') {
      return value;
    }

    return 'active';
  }

  private toContentPolicy(value: string): ChatMessageContentPolicyDto {
    return value === 'not_retained' ? 'not_retained' : 'retained';
  }

  private toRole(value: string): ChatMessageRoleDto {
    return value === 'assistant' ? 'assistant' : 'user';
  }
}
