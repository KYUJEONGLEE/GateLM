import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { once } from 'node:events';

import { ChatWebServiceGuard } from '@/auth/chat-web-service.guard';

import { ConversationService, type PreparedTurn } from './conversation.service';
import {
  ConversationIdParams,
  CreateConversationDto,
  CreateTurnDto,
  ConversationPageQueryDto,
  MessagePageQueryDto,
  RenameConversationDto,
  TurnIdParams,
} from './dto';

const MAX_DELTA_BYTES = 16 * 1024;

@Controller('internal/v1/tenant-chat/conversations')
@UseGuards(ChatWebServiceGuard)
export class ConversationController {
  constructor(private readonly conversations: ConversationService) {}

  @Post()
  async create(
    @Headers('x-gatelm-chat-access') accessToken: string,
    @Body() body: CreateConversationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.conversations.create(accessToken, body.idempotencyKey, body.title);
    response.status(result.replayed ? 200 : 201);
    return result.conversation;
  }

  @Get()
  list(
    @Headers('x-gatelm-chat-access') accessToken: string,
    @Query() query: ConversationPageQueryDto,
  ) {
    return this.conversations.list(accessToken, query.cursor, query.limit ?? 20);
  }

  @Get(':conversationId')
  get(
    @Headers('x-gatelm-chat-access') accessToken: string,
    @Param() params: ConversationIdParams,
  ) {
    return this.conversations.get(accessToken, params.conversationId);
  }

  @Patch(':conversationId')
  rename(
    @Headers('x-gatelm-chat-access') accessToken: string,
    @Param() params: ConversationIdParams,
    @Body() body: RenameConversationDto,
  ) {
    return this.conversations.rename(accessToken, params.conversationId, body.title, body.expectedVersion);
  }

  @Delete(':conversationId')
  @HttpCode(204)
  async delete(
    @Headers('x-gatelm-chat-access') accessToken: string,
    @Headers('if-match') ifMatch: string,
    @Param() params: ConversationIdParams,
  ): Promise<void> {
    await this.conversations.delete(accessToken, params.conversationId, parseIfMatch(ifMatch));
  }

  @Get(':conversationId/messages')
  history(
    @Headers('x-gatelm-chat-access') accessToken: string,
    @Param() params: ConversationIdParams,
    @Query() query: MessagePageQueryDto,
  ) {
    return this.conversations.history(accessToken, params.conversationId, query.cursor, query.limit ?? 50);
  }

  @Post(':conversationId/turns')
  async turn(
    @Headers('x-gatelm-chat-access') accessToken: string,
    @Param() params: ConversationIdParams,
    @Body() body: CreateTurnDto,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const prepared = await this.conversations.prepareTurn(accessToken, params.conversationId, body);
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    let sequence = 1;
    let finished = false;
    const disconnect = () => {
      if (!finished && !response.writableEnded) void this.conversations.disconnect(prepared);
    };
    response.once('close', disconnect);
    request.socket.setNoDelay(true);
    try {
      await writeEvent(response, prepared.reserved.turnId, {
        type: 'chat.turn.accepted',
        schemaVersion: 1,
        conversationId: prepared.reserved.conversationId,
        turnId: prepared.reserved.turnId,
        sequence,
        replayed: prepared.kind === 'replay' || prepared.reserved.replayed,
      });
      if (prepared.kind === 'replay') {
        sequence = await writeDeltas(response, prepared, prepared.message.content, sequence);
        sequence += 1;
        await writeEvent(response, prepared.reserved.turnId, finalEvent(prepared, sequence, prepared.message.id, true));
      } else {
        const result = await this.conversations.executeTurn(prepared, async (delta) => {
          sequence = await writeDeltas(response, prepared, delta, sequence);
        });
        sequence += 1;
        await writeEvent(response, prepared.reserved.turnId, finalEvent(prepared, sequence, result.message.id, result.replayed));
      }
      finished = true;
    } catch (error) {
      const safe = this.conversations.streamError(error, prepared.kind === 'execute' && prepared.signal.aborted);
      if (!response.destroyed && !response.writableEnded) {
        sequence += 1;
        await writeEvent(response, prepared.reserved.turnId, {
          type: safe.cancelled ? 'chat.turn.cancelled' : 'chat.turn.error',
          schemaVersion: 1,
          conversationId: prepared.reserved.conversationId,
          turnId: prepared.reserved.turnId,
          sequence,
          error: { code: safe.code, message: safe.message },
        }).catch(() => undefined);
      }
    } finally {
      response.off('close', disconnect);
      if (!response.writableEnded) response.end();
    }
  }

  @Post(':conversationId/turns/:turnId/cancel')
  @HttpCode(200)
  cancel(
    @Headers('x-gatelm-chat-access') accessToken: string,
    @Param() params: TurnIdParams,
  ) {
    return this.conversations.cancel(accessToken, params.conversationId, params.turnId);
  }
}

function parseIfMatch(value: string): number {
  if (!/^\"[1-9][0-9]*\"$/.test(value ?? '')) {
    throw new BadRequestException({
      code: 'CHAT_INVALID_REQUEST',
      message: 'If-Match must contain a conversation version.',
    });
  }
  const version = Number(value.slice(1, -1));
  if (!Number.isSafeInteger(version)) {
    throw new BadRequestException({
      code: 'CHAT_INVALID_REQUEST',
      message: 'If-Match must contain a conversation version.',
    });
  }
  return version;
}

async function writeDeltas(
  response: Response,
  prepared: PreparedTurn,
  content: string,
  sequence: number,
): Promise<number> {
  for (const delta of utf8Chunks(content, MAX_DELTA_BYTES)) {
    sequence += 1;
    await writeEvent(response, prepared.reserved.turnId, {
      type: 'chat.turn.delta',
      schemaVersion: 1,
      conversationId: prepared.reserved.conversationId,
      turnId: prepared.reserved.turnId,
      sequence,
      delta,
    });
  }
  return sequence;
}

function finalEvent(prepared: PreparedTurn, sequence: number, messageId: string, replayed: boolean) {
  return {
    type: 'chat.turn.final',
    schemaVersion: 1,
    conversationId: prepared.reserved.conversationId,
    turnId: prepared.reserved.turnId,
    sequence,
    messageId,
    terminalOutcome: 'succeeded',
    replayed,
  } as const;
}

async function writeEvent(response: Response, turnId: string, event: Readonly<{ type: string; sequence: number } & Record<string, unknown>>): Promise<void> {
  const frame = `id: ${turnId}:${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  if (Buffer.byteLength(frame) > 64 * 1024) throw new Error('SSE frame limit exceeded.');
  if (!response.write(frame, 'utf8')) {
    await Promise.race([
      once(response, 'drain'),
      once(response, 'close').then(() => { throw new Error('SSE response closed.'); }),
    ]);
  }
}

function utf8Chunks(value: string, maximum: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const symbol of value) {
    const size = Buffer.byteLength(symbol, 'utf8');
    if (bytes + size > maximum && current) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += symbol;
    bytes += size;
  }
  if (current) chunks.push(current);
  return chunks;
}
