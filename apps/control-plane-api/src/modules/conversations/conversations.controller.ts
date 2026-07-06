import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DataEnvelope, ListEnvelope } from '@/common/types/envelope';

import { ConversationsService } from './conversations.service';
import {
  ChatMessageResponseDto,
  ConversationResponseDto,
  CreateConversationDto,
  CreateConversationMessageDto,
  CreateConversationMessageResponseDto,
  ListConversationMessagesQueryDto,
  ListConversationsQueryDto,
  UpdateConversationDto,
} from './dto/conversation.dto';

@UseGuards(AdminAuthGuard)
@Controller('api/chat/conversations')
export class ConversationsController {
  constructor(private readonly conversationsService: ConversationsService) {}

  @Post()
  async createConversation(
    @Body() body: CreateConversationDto,
  ): Promise<DataEnvelope<ConversationResponseDto>> {
    return {
      data: await this.conversationsService.createConversation(body),
    };
  }

  @Get()
  async listConversations(
    @Query() query: ListConversationsQueryDto,
  ): Promise<ListEnvelope<ConversationResponseDto>> {
    const data = await this.conversationsService.listConversations(query);

    return {
      data,
      pagination: {
        hasMore: false,
        limit: query.limit ?? 50,
        nextCursor: null,
      },
    };
  }

  @Get(':conversationId/messages')
  async listMessages(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Query() query: ListConversationMessagesQueryDto,
  ): Promise<ListEnvelope<ChatMessageResponseDto>> {
    const data = await this.conversationsService.getMessages(
      conversationId,
      query,
    );

    return {
      data,
      pagination: {
        hasMore: false,
        limit: query.limit ?? 50,
        nextCursor: null,
      },
    };
  }

  @Patch(':conversationId')
  async updateConversation(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() body: UpdateConversationDto,
  ): Promise<DataEnvelope<ConversationResponseDto>> {
    return {
      data: await this.conversationsService.updateConversation(
        conversationId,
        body,
      ),
    };
  }

  @Post(':conversationId/messages')
  async createMessage(
    @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Body() body: CreateConversationMessageDto,
  ): Promise<DataEnvelope<CreateConversationMessageResponseDto>> {
    return {
      data: await this.conversationsService.createMessage(
        conversationId,
        body,
      ),
    };
  }
}
