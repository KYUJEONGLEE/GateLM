import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  ChatMessageEntity,
  ConversationEntity,
  ConversationScope,
  ConversationsRepository,
} from './conversations.repository';
import {
  ChatMessageResponseDto,
  ConversationContextDto,
  ConversationResponseDto,
  CreateConversationDto,
  CreateConversationMessageDto,
  CreateConversationMessageResponseDto,
  ListConversationMessagesQueryDto,
  ListConversationsQueryDto,
  UpdateConversationDto,
} from './dto/conversation.dto';

const DEFAULT_SYSTEM_MESSAGE = 'You are a helpful customer support assistant.';
const SLIDING_WINDOW_MAX_PREVIOUS_USER_TURNS = 10;
const SLIDING_WINDOW_MAX_PREVIOUS_CHARS = 8000;
const RETAINED_CONTEXT_FETCH_LIMIT = 120;

@Injectable()
export class ConversationsService {
  constructor(private readonly repository: ConversationsRepository) {}

  async createConversation(
    dto: CreateConversationDto,
  ): Promise<ConversationResponseDto> {
    const scope = this.toScope(dto);
    await this.assertApplicationScope(scope);

    const conversation = await this.repository.createConversation({
      ...scope,
      contextRetentionEnabled: dto.contextRetentionEnabled ?? false,
      endUserId: this.toNullableText(dto.endUserId),
      title: this.toNullableText(dto.title),
    });

    return this.toConversationResponse(conversation);
  }

  async listConversations(
    query: ListConversationsQueryDto,
  ): Promise<ConversationResponseDto[]> {
    const scope = this.toScope(query);
    await this.assertApplicationScope(scope);

    const conversations = await this.repository.listConversations({
      cursor: query.cursor,
      limit: query.limit ?? 50,
      scope,
    });

    return conversations.map((conversation) =>
      this.toConversationResponse(conversation),
    );
  }

  async getMessages(
    conversationId: string,
    query: ListConversationMessagesQueryDto,
  ): Promise<ChatMessageResponseDto[]> {
    const scope = this.toScope(query);
    await this.getConversationForScopeOrThrow(conversationId, scope);

    const messages = await this.repository.listMessages({
      conversationId,
      cursor: query.cursor,
      limit: query.limit ?? 50,
      scope,
    });

    return messages.map((message) => this.toChatMessageResponse(message));
  }

  async updateConversation(
    conversationId: string,
    dto: UpdateConversationDto,
  ): Promise<ConversationResponseDto> {
    const scope = this.toScope(dto);
    const current = await this.getConversationForScopeOrThrow(
      conversationId,
      scope,
    );
    const nextStatus = dto.status ?? current.status;
    const data = {
      ...(dto.contextRetentionEnabled !== undefined
        ? { contextRetentionEnabled: dto.contextRetentionEnabled }
        : {}),
      ...(dto.title !== undefined
        ? { title: this.toNullableText(dto.title) }
        : {}),
      ...(dto.status !== undefined ? { status: dto.status } : {}),
      ...(dto.status === 'deleted'
        ? { deletedAt: new Date() }
        : nextStatus !== 'deleted'
          ? { deletedAt: null }
          : {}),
    };

    if (Object.keys(data).length === 0) {
      return this.toConversationResponse(current);
    }

    const conversation = await this.repository.updateConversation(
      conversationId,
      scope,
      data,
    );

    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    return this.toConversationResponse(conversation);
  }

  async createMessage(
    conversationId: string,
    dto: CreateConversationMessageDto,
  ): Promise<CreateConversationMessageResponseDto> {
    const scope = this.toScope(dto);
    const conversation = await this.getConversationForScopeOrThrow(
      conversationId,
      scope,
    );

    if (conversation.status === 'deleted' || conversation.deletedAt) {
      throw new NotFoundException('Conversation not found.');
    }

    const safeContent = sanitizeLogSafeContent(dto.content);
    if (!safeContent) {
      throw new BadRequestException('Message content is empty.');
    }

    const shouldRetain = conversation.contextRetentionEnabled;
    const message = await this.repository.createMessageWithNextSequence({
      ...scope,
      contentPolicy: shouldRetain ? 'retained' : 'not_retained',
      conversationId,
      parentMessageId: dto.parentMessageId ?? null,
      requestId: this.toNullableText(dto.requestId),
      role: dto.role,
      safeContent: shouldRetain ? safeContent : null,
    });
    const context = await this.assembleContext({
      conversation,
      currentMessage: message,
      currentSafeContent: safeContent,
      scope,
      systemMessage: dto.systemMessage,
    });

    return {
      context,
      message: this.toChatMessageResponse(message),
    };
  }

  private async assertApplicationScope(scope: ConversationScope): Promise<void> {
    const exists = await this.repository.applicationExistsForScope(scope);

    if (!exists) {
      throw new BadRequestException(
        'Conversation application scope does not exist.',
      );
    }
  }

  private async getConversationForScopeOrThrow(
    conversationId: string,
    scope: ConversationScope,
  ): Promise<ConversationEntity> {
    const conversation = await this.repository.findConversationForScope(
      conversationId,
      scope,
    );

    if (!conversation) {
      throw new NotFoundException('Conversation not found.');
    }

    return conversation;
  }

  private async assembleContext(args: {
    conversation: ConversationEntity;
    currentMessage: ChatMessageEntity;
    currentSafeContent: string;
    scope: ConversationScope;
    systemMessage: string | undefined;
  }): Promise<ConversationContextDto> {
    const systemContent =
      sanitizeLogSafeContent(args.systemMessage ?? DEFAULT_SYSTEM_MESSAGE) ||
      DEFAULT_SYSTEM_MESSAGE;
    const messages: ConversationContextDto['messages'] = [
      {
        content: systemContent,
        role: 'system',
      },
    ];

    if (args.conversation.contextRetentionEnabled) {
      const previousMessages =
        await this.repository.listRetainedMessagesBeforeSequence({
          conversationId: args.conversation.id,
          scope: args.scope,
          sequence: args.currentMessage.sequence,
          take: RETAINED_CONTEXT_FETCH_LIMIT,
        });
      const retainedWindow = this.applySlidingWindow(previousMessages);

      messages.push(
        ...retainedWindow.map((message) => ({
          content: message.safeContent ?? '',
          role: message.role,
        })),
      );
    }

    messages.push({
      content: args.currentSafeContent,
      role: args.currentMessage.role,
    });

    return {
      contextRetentionEnabled: args.conversation.contextRetentionEnabled,
      maxPreviousChars: SLIDING_WINDOW_MAX_PREVIOUS_CHARS,
      maxPreviousUserTurns: SLIDING_WINDOW_MAX_PREVIOUS_USER_TURNS,
      messages,
      strategy: 'sliding_window',
    };
  }

  private applySlidingWindow(
    messages: ChatMessageEntity[],
  ): ChatMessageEntity[] {
    const retainedMessages = messages
      .filter(
        (message) =>
          message.safeContent !== null &&
          message.contentPolicy !== 'not_retained',
      )
      .sort((left, right) => left.sequence - right.sequence);
    const turnLimited = this.takeLatestUserTurns(retainedMessages);

    return this.takeLatestByCharLimit(turnLimited);
  }

  private takeLatestUserTurns(
    messages: ChatMessageEntity[],
  ): ChatMessageEntity[] {
    const selected: ChatMessageEntity[] = [];
    let userTurns = 0;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];

      if (!message) {
        continue;
      }

      selected.push(message);

      if (message.role === 'user') {
        userTurns += 1;
      }

      if (userTurns >= SLIDING_WINDOW_MAX_PREVIOUS_USER_TURNS) {
        break;
      }
    }

    return selected.sort((left, right) => left.sequence - right.sequence);
  }

  private takeLatestByCharLimit(
    messages: ChatMessageEntity[],
  ): ChatMessageEntity[] {
    const selected: ChatMessageEntity[] = [];
    let totalChars = 0;

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      const safeContent = message?.safeContent;

      if (!message || !safeContent) {
        continue;
      }

      if (totalChars + safeContent.length > SLIDING_WINDOW_MAX_PREVIOUS_CHARS) {
        break;
      }

      totalChars += safeContent.length;
      selected.push(message);
    }

    return selected.sort((left, right) => left.sequence - right.sequence);
  }

  private toScope(scope: ConversationScope): ConversationScope {
    return {
      applicationId: scope.applicationId,
      projectId: scope.projectId,
      tenantId: scope.tenantId,
    };
  }

  private toNullableText(value: string | undefined): string | null {
    const text = value?.trim();

    return text ? text : null;
  }

  private toConversationResponse(
    conversation: ConversationEntity,
  ): ConversationResponseDto {
    return {
      applicationId: conversation.applicationId,
      contextRetentionEnabled: conversation.contextRetentionEnabled,
      createdAt: conversation.createdAt.toISOString(),
      deletedAt: conversation.deletedAt?.toISOString() ?? null,
      endUserId: conversation.endUserId,
      id: conversation.id,
      projectId: conversation.projectId,
      status: conversation.status,
      tenantId: conversation.tenantId,
      title: conversation.title,
      updatedAt: conversation.updatedAt.toISOString(),
    };
  }

  private toChatMessageResponse(
    message: ChatMessageEntity,
  ): ChatMessageResponseDto {
    return {
      applicationId: message.applicationId,
      contentPolicy: message.contentPolicy,
      conversationId: message.conversationId,
      createdAt: message.createdAt.toISOString(),
      id: message.id,
      parentMessageId: message.parentMessageId,
      projectId: message.projectId,
      requestId: message.requestId,
      role: message.role,
      safeContent: message.safeContent,
      sequence: message.sequence,
      tenantId: message.tenantId,
    };
  }
}

export function sanitizeLogSafeContent(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return '';
  }

  return redactPhoneNumbers(
    redactEmails(
      trimmed
        .replace(
          /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b/gi,
          '[AUTHORIZATION_REDACTED]',
        )
        .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, '[TOKEN_REDACTED]')
        .replace(
          /\b(?:gsk|gat_app|gat_provider|glm_api|glm_app)_[A-Za-z0-9_-]{8,}\b/g,
          '[TOKEN_REDACTED]',
        )
        .replace(
          /\b(api[_-]?key|app[_-]?token|provider[_-]?key|secret|password|token)\s*[:=]\s*[^,\s;]+/gi,
          '$1=[SECRET_REDACTED]',
        ),
    ),
  );
}

function redactEmails(value: string): string {
  let index = 0;

  return value.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    () => `[EMAIL_${++index}]`,
  );
}

function redactPhoneNumbers(value: string): string {
  let index = 0;

  return value.replace(
    /(?<!\w)(?:\+?\d{1,3}[ .-]?)?(?:\(?\d{2,4}\)?[ .-]?\d{3,4}[ .-]?\d{4})(?!\w)/g,
    () => `[PHONE_NUMBER_${++index}]`,
  );
}
