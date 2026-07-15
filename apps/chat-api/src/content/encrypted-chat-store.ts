import { Injectable } from '@nestjs/common';
import { Prisma, type TenantChatMessage } from '@prisma/client';
import { randomUUID, timingSafeEqual } from 'node:crypto';

import { PrismaService } from '@/database/prisma.service';
import {
  MAX_EPHEMERAL_MESSAGE_CHARACTERS,
  type AdmissionHandle,
  type ClientUsageIntent,
  type EphemeralMessage,
} from '@/execution/execution.types';
import type { JsonValue } from '@/execution/jcs';

import {
  ConversationNotFound,
  ConversationVersionConflict,
  IdempotencyConflict,
  TurnStateConflict,
} from './chat-store.errors';
import { ContentIntegrityError } from './content.errors';
import { decryptContent, encryptContent, type ContentRole } from './content-crypto';
import { ContentIntegrityService } from './content-integrity.service';
import { CursorCodec, InvalidCursor } from './cursor-codec';
import { TenantContentKeyService } from './tenant-content-key.service';

const CREATE_SCOPE = 'tenant-chat:conversation:create:v1';
const TURN_SCOPE = 'tenant-chat:turn:create:v1';
const CONVERSATION_CURSOR_SCOPE = 'tenant-chat:conversation:list:v1';
const MESSAGE_CURSOR_SCOPE = 'tenant-chat:message:list:v1';
const MAX_HISTORY_MESSAGES = 32;
const MAX_HISTORY_BYTES = 256 * 1024;
const MODEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

export type ChatActor = Readonly<{
  tenantId: string;
  userId: string;
}>;

export type ConversationView = Readonly<{
  id: string;
  title: string;
  version: number;
  historyRetentionDays: number;
  createdAt: string;
  updatedAt: string;
}>;

export type MessageView = Readonly<{
  id: string;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;
  effectiveModelKey?: string;
  sequence: number;
  createdAt: string;
}>;

export type ReservedTurn = Readonly<{
  conversationId: string;
  turnId: string;
  requestId: string;
  idempotencyKey: string;
  cacheEpoch: bigint;
  state: string;
  replayed: boolean;
}>;

@Injectable()
export class EncryptedChatStore {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keys: TenantContentKeyService,
    private readonly integrity: ContentIntegrityService,
    private readonly cursors: CursorCodec,
  ) {}

  async createConversation(
    actor: ChatActor,
    input: Readonly<{ idempotencyKey: string; title: string; historyRetentionDays: number }>,
  ): Promise<Readonly<{ conversation: ConversationView; replayed: boolean }>> {
    const binding = createBinding(actor, input.idempotencyKey, input.title);
    const signed = await this.integrity.sign(binding);
    const id = randomUUID();
    const encrypted = await this.keys.withActiveKey(actor.tenantId, (key, version) =>
      encryptContent(key, input.title, titleAad(actor.tenantId, id, version)),
    );
    const expiresAt = expiry(input.historyRetentionDays);
    try {
      const created = await this.prisma.tenantChatConversation.create({
        data: {
          id,
          tenantId: actor.tenantId,
          userId: actor.userId,
          createIdempotencyKey: input.idempotencyKey,
          creationBindingMac: signed.mac,
          creationBindingKeyVersion: signed.keyVersion,
          historyRetentionDays: input.historyRetentionDays,
          expiresAt,
          titleCiphertext: bytes(encrypted.ciphertext),
          titleNonce: bytes(encrypted.nonce),
          titleTag: bytes(encrypted.tag),
          titleContentKeyVersion: encrypted.contentKeyVersion,
          titleSchemaVersion: encrypted.schemaVersion,
        },
      });
      return Object.freeze({ conversation: await this.conversationView(created), replayed: false });
    } catch (error) {
      if (!uniqueConflict(error)) throw error;
      const existing = await this.prisma.tenantChatConversation.findUnique({
        where: {
          tenantId_userId_createIdempotencyKey: {
            tenantId: actor.tenantId,
            userId: actor.userId,
            createIdempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (!existing || existing.status !== 'active' || existing.deletedAt) throw new IdempotencyConflict();
      await this.verifyBinding(binding, existing.creationBindingKeyVersion, existing.creationBindingMac);
      return Object.freeze({ conversation: await this.conversationView(existing), replayed: true });
    }
  }

  async listConversations(
    actor: ChatActor,
    input: Readonly<{ cursor?: string; limit: number }>,
  ): Promise<Readonly<{ items: readonly ConversationView[]; nextCursor: string | null }>> {
    const boundary = input.cursor
      ? await this.readConversationCursor(input.cursor, actor, input.limit)
      : undefined;
    const rows = await this.prisma.tenantChatConversation.findMany({
      where: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        status: 'active',
        deletedAt: null,
        ...(boundary
          ? {
              OR: [
                { updatedAt: { lt: boundary.updatedAt } },
                { updatedAt: boundary.updatedAt, id: { lt: boundary.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: input.limit + 1,
    });
    const page = rows.slice(0, input.limit);
    const items = await Promise.all(page.map((row) => this.conversationView(row)));
    const tail = rows.length > input.limit ? page.at(-1) : undefined;
    const nextCursor = tail
      ? await this.cursors.encode({
          actor: actorValue(actor),
          boundary: { id: tail.id, updatedAt: tail.updatedAt.toISOString() },
          limit: input.limit,
          scope: CONVERSATION_CURSOR_SCOPE,
          version: 1,
        })
      : null;
    return Object.freeze({ items: Object.freeze(items), nextCursor });
  }

  async getConversation(actor: ChatActor, conversationId: string): Promise<ConversationView> {
    const row = await this.activeConversation(actor, conversationId);
    return this.conversationView(row);
  }

  async renameConversation(
    actor: ChatActor,
    conversationId: string,
    title: string,
    expectedVersion: number,
  ): Promise<ConversationView> {
    const current = await this.activeConversation(actor, conversationId);
    const encrypted = await this.keys.withActiveKey(actor.tenantId, (key, version) =>
      encryptContent(key, title, titleAad(actor.tenantId, conversationId, version)),
    );
    const changed = await this.prisma.tenantChatConversation.updateMany({
      where: {
        id: conversationId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        status: 'active',
        deletedAt: null,
        version: expectedVersion,
      },
      data: {
        version: { increment: 1 },
        titleCiphertext: bytes(encrypted.ciphertext),
        titleNonce: bytes(encrypted.nonce),
        titleTag: bytes(encrypted.tag),
        titleContentKeyVersion: encrypted.contentKeyVersion,
        titleSchemaVersion: encrypted.schemaVersion,
      },
    });
    if (changed.count !== 1) {
      const stillOwned = await this.prisma.tenantChatConversation.findFirst({
        where: { id: conversationId, tenantId: actor.tenantId, userId: actor.userId, deletedAt: null },
        select: { id: true },
      });
      if (!stillOwned) throw new ConversationNotFound();
      throw new ConversationVersionConflict();
    }
    return this.getConversation(actor, conversationId);
  }

  async deleteConversation(
    actor: ChatActor,
    conversationId: string,
    expectedVersion?: number,
    retentionCutoff?: Date,
  ): Promise<Readonly<{
    deleted: boolean;
    replayed: boolean;
    cancelledTurnIds: readonly string[];
  }>> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<LockedConversation[]>(Prisma.sql`
        SELECT id, status, version, cache_epoch AS "cacheEpoch", expires_at AS "expiresAt"
        FROM tenant_chat_conversations
        WHERE id = ${conversationId}::uuid
          AND tenant_id = ${actor.tenantId}::uuid
          AND user_id = ${actor.userId}::uuid
        FOR UPDATE
      `);
      const row = rows[0];
      if (!row) throw new ConversationNotFound();
      if (row.status === 'deleted') {
        return Object.freeze({
          deleted: false,
          replayed: true,
          cancelledTurnIds: Object.freeze([] as string[]),
        });
      }
      if (expectedVersion !== undefined && row.version !== expectedVersion) {
        throw new ConversationVersionConflict();
      }
      if (
        retentionCutoff &&
        (!row.expiresAt || row.expiresAt.getTime() > retentionCutoff.getTime())
      ) {
        return Object.freeze({
          deleted: false,
          replayed: false,
          cancelledTurnIds: Object.freeze([] as string[]),
        });
      }
      const activeTurns = await tx.tenantChatTurn.findMany({
        where: {
          conversationId,
          tenantId: actor.tenantId,
          userId: actor.userId,
          state: { in: ['pending_admission', 'user_persisted', 'streaming'] },
        },
        select: { id: true },
      });
      const now = new Date();
      await tx.tenantChatConversation.update({
        where: { id: conversationId },
        data: {
          status: 'deleted',
          version: { increment: 1 },
          cacheEpoch: { increment: 1 },
          deletedAt: now,
          expiresAt: null,
          titleCiphertext: null,
          titleNonce: null,
          titleTag: null,
          titleContentKeyVersion: null,
          titleSchemaVersion: null,
        },
      });
      await tx.tenantChatMessage.deleteMany({
        where: { conversationId, tenantId: actor.tenantId, userId: actor.userId },
      });
      await tx.tenantChatTurn.updateMany({
        where: {
          conversationId,
          tenantId: actor.tenantId,
          userId: actor.userId,
          state: { in: ['pending_admission', 'user_persisted', 'streaming'] },
        },
        data: { state: 'deleted', cancelledAt: now, safeErrorCode: 'CHAT_REQUEST_CANCELLED' },
      });
      return Object.freeze({
        deleted: true,
        replayed: false,
        cancelledTurnIds: Object.freeze(activeTurns.map((turn) => turn.id)),
      });
    });
  }

  async listMessages(
    actor: ChatActor,
    conversationId: string,
    input: Readonly<{ cursor?: string; limit: number }>,
  ): Promise<Readonly<{ items: readonly MessageView[]; nextCursor: string | null }>> {
    const conversation = await this.activeConversation(actor, conversationId);
    const afterSequence = input.cursor
      ? await this.readMessageCursor(input.cursor, actor, conversationId, input.limit, conversation.cacheEpoch)
      : 0n;
    const rows = await this.prisma.tenantChatMessage.findMany({
      where: {
        conversationId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        sequence: { gt: afterSequence },
        turn: { state: 'completed' },
      },
      orderBy: { sequence: 'asc' },
      take: input.limit + 1,
    });
    const page = rows.slice(0, input.limit);
    const items = await Promise.all(page.map((row) => this.messageView(row)));
    const tail = rows.length > input.limit ? page.at(-1) : undefined;
    const nextCursor = tail
      ? await this.cursors.encode({
          actor: actorValue(actor),
          boundary: { afterSequence: tail.sequence.toString() },
          cacheEpoch: conversation.cacheEpoch.toString(),
          conversationId,
          limit: input.limit,
          scope: MESSAGE_CURSOR_SCOPE,
          version: 1,
        })
      : null;
    return Object.freeze({ items: Object.freeze(items), nextCursor });
  }

  async reserveTurn(
    actor: ChatActor,
    conversationId: string,
    input: Readonly<{ idempotencyKey: string; content: string; usageIntent: ClientUsageIntent }>,
  ): Promise<ReservedTurn> {
    const binding = turnBinding(actor, conversationId, input);
    const signed = await this.integrity.sign(binding);
    const turnId = randomUUID();
    const requestId = randomUUID();
    try {
      const turn = await this.prisma.$transaction(async (tx) => {
        const conversation = await lockActiveConversation(tx, actor, conversationId);
        return tx.tenantChatTurn.create({
          data: {
            id: turnId,
            conversationId,
            tenantId: actor.tenantId,
            userId: actor.userId,
            requestId,
            idempotencyKey: input.idempotencyKey,
            requestBindingMac: signed.mac,
            requestBindingKeyVersion: signed.keyVersion,
            capturedCacheEpoch: conversation.cacheEpoch,
          },
        });
      });
      return reservedView(turn, false);
    } catch (error) {
      if (!uniqueConflict(error)) throw error;
      const turn = await this.prisma.$transaction(async (tx) => {
        await lockActiveConversation(tx, actor, conversationId);
        return tx.tenantChatTurn.findUnique({
          where: {
            tenantId_userId_idempotencyKey: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
      });
      if (!turn || turn.conversationId !== conversationId) throw new IdempotencyConflict();
      await this.verifyBinding(binding, turn.requestBindingKeyVersion, turn.requestBindingMac);
      return reservedView(turn, true);
    }
  }

  async persistAdmittedUser(
    actor: ChatActor,
    reserved: ReservedTurn,
    content: string,
    handle: AdmissionHandle,
  ): Promise<Readonly<{ replayed: boolean }>> {
    assertHandle(actor, reserved, handle);
    const existing = await this.findTurnMessage(actor, reserved.turnId, 'user');
    if (existing) {
      await this.assertMessageContent(existing, content);
      return Object.freeze({ replayed: true });
    }
    const messageId = randomUUID();
    const encrypted = await this.keys.withActiveKey(actor.tenantId, (key, version) =>
      encryptContent(key, content, messageAad(actor.tenantId, reserved.conversationId, messageId, 'user', version)),
    );
    try {
      await this.prisma.$transaction(async (tx) => {
        const conversation = await lockActiveConversation(tx, actor, reserved.conversationId);
        if (conversation.cacheEpoch !== reserved.cacheEpoch) throw new TurnStateConflict();
        const turn = await tx.tenantChatTurn.findFirst({
          where: {
            id: reserved.turnId,
            conversationId: reserved.conversationId,
            tenantId: actor.tenantId,
            userId: actor.userId,
          },
        });
        if (!turn || !['pending_admission', 'user_persisted', 'streaming'].includes(turn.state)) {
          throw new TurnStateConflict();
        }
        if (turn.state !== 'pending_admission') return;
        const contentExpiresAt = expiry(conversation.historyRetentionDays);
        await tx.tenantChatMessage.create({
          data: {
            id: messageId,
            conversationId: reserved.conversationId,
            tenantId: actor.tenantId,
            userId: actor.userId,
            turnId: reserved.turnId,
            requestId: reserved.requestId,
            role: 'user',
            sequence: conversation.nextMessageSequence,
            ciphertext: bytes(encrypted.ciphertext),
            nonce: bytes(encrypted.nonce),
            tag: bytes(encrypted.tag),
            contentKeyVersion: encrypted.contentKeyVersion,
            schemaVersion: encrypted.schemaVersion,
            expiresAt: contentExpiresAt,
          },
        });
        await tx.tenantChatConversation.update({
          where: { id: reserved.conversationId },
          data: { nextMessageSequence: { increment: 1 }, expiresAt: contentExpiresAt },
        });
        await tx.tenantChatTurn.update({
          where: { id: reserved.turnId },
          data: {
            state: 'user_persisted',
            actorKind: handle.executionScope.actor.actorKind,
            employeeId: handle.executionScope.actor.employeeId,
            actorAuthzVersion: handle.actorAuthzVersion,
            tenantAuthzVersion: handle.tenantAuthzVersion,
            sessionVersion: handle.sessionVersion,
            snapshotVersion: handle.snapshot.version,
            snapshotDigest: handle.snapshot.digest,
            policyVersion: handle.snapshot.policyVersion,
            employeeNoticeVersion: handle.snapshot.employeeNoticeVersion,
            pricingVersion: handle.snapshot.pricingVersion,
            admissionId: handle.admissionId,
            admissionExpiresAt: new Date(handle.expiresAt),
          },
        });
      });
      return Object.freeze({ replayed: false });
    } catch (error) {
      if (!uniqueConflict(error)) throw error;
      const duplicate = await this.findTurnMessage(actor, reserved.turnId, 'user');
      if (!duplicate) throw error;
      await this.assertMessageContent(duplicate, content);
      return Object.freeze({ replayed: true });
    }
  }

  async completionHistory(
    actor: ChatActor,
    conversationId: string,
    currentTurnId: string,
  ): Promise<readonly EphemeralMessage[]> {
    await this.activeConversation(actor, conversationId);
    const rows = await this.prisma.tenantChatMessage.findMany({
      where: {
        conversationId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        OR: [{ turn: { state: 'completed' } }, { turnId: currentTurnId, role: 'user' }],
      },
      orderBy: { sequence: 'desc' },
      take: MAX_HISTORY_MESSAGES,
    });
    const selected: EphemeralMessage[] = [];
    let bytesUsed = 0;
    for (const row of rows) {
      const content = await this.decryptMessage(row);
      if (content.length > MAX_EPHEMERAL_MESSAGE_CHARACTERS) break;
      const contentBytes = Buffer.byteLength(content, 'utf8');
      if (bytesUsed + contentBytes > MAX_HISTORY_BYTES) break;
      bytesUsed += contentBytes;
      selected.push(Object.freeze({ role: row.role as 'user' | 'assistant', content }));
    }
    return Object.freeze(selected.reverse());
  }

  async markStreaming(actor: ChatActor, turnId: string): Promise<void> {
    const changed = await this.prisma.tenantChatTurn.updateMany({
      where: {
        id: turnId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        state: { in: ['user_persisted', 'streaming'] },
      },
      data: { state: 'streaming' },
    });
    if (changed.count !== 1) throw new TurnStateConflict();
  }

  async persistAssistant(
    actor: ChatActor,
    reserved: ReservedTurn,
    content: string,
    effectiveModelKey: string | null,
  ): Promise<Readonly<{ message: MessageView; replayed: boolean }>> {
    assertEffectiveModelKey(effectiveModelKey);
    const existing = await this.findTurnMessage(actor, reserved.turnId, 'assistant');
    if (existing) {
      await this.assertMessageContent(existing, content);
      assertEffectiveModelKeyMatches(existing, effectiveModelKey);
      return Object.freeze({ message: await this.messageView(existing), replayed: true });
    }
    const messageId = randomUUID();
    const encrypted = await this.keys.withActiveKey(actor.tenantId, (key, version) =>
      encryptContent(key, content, messageAad(actor.tenantId, reserved.conversationId, messageId, 'assistant', version)),
    );
    try {
      const message = await this.prisma.$transaction(async (tx) => {
        const conversation = await lockActiveConversation(tx, actor, reserved.conversationId);
        if (conversation.cacheEpoch !== reserved.cacheEpoch) throw new TurnStateConflict();
        const completed = await tx.tenantChatTurn.updateMany({
          where: {
            id: reserved.turnId,
            conversationId: reserved.conversationId,
            tenantId: actor.tenantId,
            userId: actor.userId,
            state: { in: ['user_persisted', 'streaming'] },
          },
          data: { state: 'completed', safeErrorCode: null, completedAt: new Date() },
        });
        if (completed.count !== 1) throw new TurnStateConflict();
        const contentExpiresAt = expiry(conversation.historyRetentionDays);
        const created = await tx.tenantChatMessage.create({
          data: {
            id: messageId,
            conversationId: reserved.conversationId,
            tenantId: actor.tenantId,
            userId: actor.userId,
            turnId: reserved.turnId,
            requestId: reserved.requestId,
            role: 'assistant',
            sequence: conversation.nextMessageSequence,
            ciphertext: bytes(encrypted.ciphertext),
            nonce: bytes(encrypted.nonce),
            tag: bytes(encrypted.tag),
            contentKeyVersion: encrypted.contentKeyVersion,
            schemaVersion: encrypted.schemaVersion,
            effectiveModelKey,
            expiresAt: contentExpiresAt,
          },
        });
        await tx.tenantChatConversation.update({
          where: { id: reserved.conversationId },
          data: { nextMessageSequence: { increment: 1 }, expiresAt: contentExpiresAt },
        });
        return created;
      });
      return Object.freeze({ message: await this.messageView(message), replayed: false });
    } catch (error) {
      if (!uniqueConflict(error) && !(error instanceof TurnStateConflict)) throw error;
      const duplicate = await this.findTurnMessage(actor, reserved.turnId, 'assistant');
      if (!duplicate) throw error;
      await this.assertMessageContent(duplicate, content);
      assertEffectiveModelKeyMatches(duplicate, effectiveModelKey);
      return Object.freeze({ message: await this.messageView(duplicate), replayed: true });
    }
  }

  async readCompletedReplay(
    actor: ChatActor,
    reserved: ReservedTurn,
  ): Promise<MessageView | null> {
    const row = await this.prisma.tenantChatMessage.findFirst({
      where: {
        turnId: reserved.turnId,
        conversationId: reserved.conversationId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        role: 'assistant',
        turn: { state: 'completed' },
      },
    });
    return row ? this.messageView(row) : null;
  }

  async markTerminalFailure(actor: ChatActor, turnId: string, code: string): Promise<void> {
    await this.prisma.tenantChatTurn.updateMany({
      where: {
        id: turnId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        state: { in: ['pending_admission', 'user_persisted', 'streaming'] },
      },
      data: { state: 'failed', safeErrorCode: safeCode(code), completedAt: new Date() },
    });
  }

  async cancelTurn(
    actor: ChatActor,
    conversationId: string,
    turnId: string,
  ): Promise<Readonly<{ cancelled: boolean }>> {
    await this.activeConversation(actor, conversationId);
    const turn = await this.prisma.tenantChatTurn.findFirst({
      where: { id: turnId, conversationId, tenantId: actor.tenantId, userId: actor.userId },
      select: { state: true },
    });
    if (!turn) throw new ConversationNotFound();
    if (['completed', 'failed', 'cancelled'].includes(turn.state)) {
      return Object.freeze({ cancelled: turn.state === 'cancelled' });
    }
    const changed = await this.prisma.tenantChatTurn.updateMany({
      where: {
        id: turnId,
        conversationId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        state: { in: ['pending_admission', 'user_persisted', 'streaming'] },
      },
      data: { state: 'cancelled', safeErrorCode: 'CHAT_REQUEST_CANCELLED', cancelledAt: new Date() },
    });
    return Object.freeze({ cancelled: changed.count === 1 || turn.state === 'cancelled' });
  }

  async deleteExpiredBatch(limit: number): Promise<Readonly<{
    deleted: number;
    cancelledTurnIds: readonly string[];
  }>> {
    const cutoff = new Date();
    const expired = await this.prisma.tenantChatConversation.findMany({
      where: { status: 'active', deletedAt: null, expiresAt: { lte: cutoff } },
      orderBy: [{ expiresAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true, tenantId: true, userId: true },
    });
    let deleted = 0;
    const cancelledTurnIds: string[] = [];
    for (const row of expired) {
      try {
        const result = await this.deleteConversation(
          { tenantId: row.tenantId, userId: row.userId },
          row.id,
          undefined,
          cutoff,
        );
        if (result.deleted) {
          deleted += 1;
          cancelledTurnIds.push(...result.cancelledTurnIds);
        }
      } catch (error) {
        if (!(error instanceof ConversationNotFound)) throw error;
      }
    }
    return Object.freeze({ deleted, cancelledTurnIds: Object.freeze(cancelledTurnIds) });
  }

  private async activeConversation(actor: ChatActor, conversationId: string) {
    const row = await this.prisma.tenantChatConversation.findFirst({
      where: {
        id: conversationId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        status: 'active',
        deletedAt: null,
      },
    });
    if (!row) throw new ConversationNotFound();
    return row;
  }

  private async conversationView(row: ConversationRow): Promise<ConversationView> {
    if (
      !row.titleCiphertext ||
      !row.titleNonce ||
      !row.titleTag ||
      !row.titleContentKeyVersion ||
      row.titleSchemaVersion !== 1
    ) {
      throw new ContentIntegrityError();
    }
    const title = await this.keys.withKeyVersion(row.tenantId, row.titleContentKeyVersion, (key) =>
      decryptContent(
        key,
        {
          ciphertext: Buffer.from(row.titleCiphertext!),
          nonce: Buffer.from(row.titleNonce!),
          tag: Buffer.from(row.titleTag!),
        },
        titleAad(row.tenantId, row.id, row.titleContentKeyVersion!),
      ),
    );
    return Object.freeze({
      id: row.id,
      title,
      version: row.version,
      historyRetentionDays: row.historyRetentionDays,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  private async messageView(row: TenantChatMessage): Promise<MessageView> {
    const content = await this.decryptMessage(row);
    const effectiveModelKey = messageEffectiveModelKey(row);
    return Object.freeze({
      id: row.id,
      turnId: row.turnId,
      role: row.role as 'user' | 'assistant',
      content,
      ...(effectiveModelKey ? { effectiveModelKey } : {}),
      sequence: safeSequence(row.sequence),
      createdAt: row.createdAt.toISOString(),
    });
  }

  private async decryptMessage(row: TenantChatMessage): Promise<string> {
    if (row.schemaVersion !== 1 || !['user', 'assistant'].includes(row.role)) {
      throw new ContentIntegrityError();
    }
    return this.keys.withKeyVersion(row.tenantId, row.contentKeyVersion, (key) =>
      decryptContent(
        key,
        {
          ciphertext: Buffer.from(row.ciphertext),
          nonce: Buffer.from(row.nonce),
          tag: Buffer.from(row.tag),
        },
        messageAad(
          row.tenantId,
          row.conversationId,
          row.id,
          row.role as 'user' | 'assistant',
          row.contentKeyVersion,
        ),
      ),
    );
  }

  private async assertMessageContent(row: TenantChatMessage, expected: string): Promise<void> {
    const actual = Buffer.from(await this.decryptMessage(row), 'utf8');
    const wanted = Buffer.from(expected, 'utf8');
    try {
      if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) {
        throw new ContentIntegrityError();
      }
    } finally {
      actual.fill(0);
      wanted.fill(0);
    }
  }

  private findTurnMessage(actor: ChatActor, turnId: string, role: ContentRole) {
    return this.prisma.tenantChatMessage.findFirst({
      where: { turnId, tenantId: actor.tenantId, userId: actor.userId, role },
    });
  }

  private async verifyBinding(value: JsonValue, version: number, mac: string): Promise<void> {
    try {
      await this.integrity.verify(value, version, mac);
    } catch (error) {
      if (error instanceof ContentIntegrityError) throw new IdempotencyConflict();
      throw error;
    }
  }

  private async readConversationCursor(cursor: string, actor: ChatActor, limit: number) {
    const value = await this.cursors.decode(cursor);
    if (!isRecord(value) || !exactKeys(value, ['actor', 'boundary', 'limit', 'scope', 'version'])) throw new InvalidCursor();
    if (value.version !== 1 || value.scope !== CONVERSATION_CURSOR_SCOPE || value.limit !== limit || !sameActor(value.actor, actor)) throw new InvalidCursor();
    if (!isRecord(value.boundary) || !exactKeys(value.boundary, ['id', 'updatedAt'])) throw new InvalidCursor();
    if (typeof value.boundary.id !== 'string' || !uuidV4(value.boundary.id) || typeof value.boundary.updatedAt !== 'string') throw new InvalidCursor();
    const updatedAt = new Date(value.boundary.updatedAt);
    if (!Number.isFinite(updatedAt.getTime())) throw new InvalidCursor();
    return { id: value.boundary.id, updatedAt };
  }

  private async readMessageCursor(
    cursor: string,
    actor: ChatActor,
    conversationId: string,
    limit: number,
    cacheEpoch: bigint,
  ): Promise<bigint> {
    const value = await this.cursors.decode(cursor);
    if (!isRecord(value) || !exactKeys(value, ['actor', 'boundary', 'cacheEpoch', 'conversationId', 'limit', 'scope', 'version'])) throw new InvalidCursor();
    if (
      value.version !== 1 || value.scope !== MESSAGE_CURSOR_SCOPE || value.limit !== limit ||
      value.conversationId !== conversationId || value.cacheEpoch !== cacheEpoch.toString() || !sameActor(value.actor, actor)
    ) throw new InvalidCursor();
    if (!isRecord(value.boundary) || !exactKeys(value.boundary, ['afterSequence']) || typeof value.boundary.afterSequence !== 'string' || !/^[1-9][0-9]*$/.test(value.boundary.afterSequence)) throw new InvalidCursor();
    return BigInt(value.boundary.afterSequence);
  }
}

type ConversationRow = Prisma.TenantChatConversationGetPayload<Record<string, never>>;
type LockedConversation = Readonly<{
  id: string;
  status: string;
  version: number;
  cacheEpoch: bigint;
  expiresAt: Date | null;
}>;

function createBinding(actor: ChatActor, idempotencyKey: string, title: string): JsonValue {
  return { actor: actorValue(actor), idempotencyKey, scope: CREATE_SCOPE, title, version: 1 };
}

function turnBinding(
  actor: ChatActor,
  conversationId: string,
  input: Readonly<{ idempotencyKey: string; content: string; usageIntent: ClientUsageIntent }>,
): JsonValue {
  return {
    actor: actorValue(actor),
    content: input.content,
    conversationId,
    idempotencyKey: input.idempotencyKey,
    scope: TURN_SCOPE,
    usageIntent: input.usageIntent,
    version: 1,
  } as unknown as JsonValue;
}

function actorValue(actor: ChatActor): JsonValue {
  return { tenantId: actor.tenantId, userId: actor.userId };
}

function titleAad(tenantId: string, conversationId: string, contentKeyVersion: number) {
  return {
    schemaVersion: 1 as const,
    tenantId,
    conversationId,
    recordId: conversationId,
    contentKind: 'title' as const,
    role: 'none' as const,
    contentKeyVersion,
  };
}

function messageAad(
  tenantId: string,
  conversationId: string,
  recordId: string,
  role: 'user' | 'assistant',
  contentKeyVersion: number,
) {
  return {
    schemaVersion: 1 as const,
    tenantId,
    conversationId,
    recordId,
    contentKind: 'message' as const,
    role,
    contentKeyVersion,
  };
}

async function lockActiveConversation(
  tx: Prisma.TransactionClient,
  actor: ChatActor,
  conversationId: string,
) {
  const rows = await tx.$queryRaw<Array<{
    id: string;
    cacheEpoch: bigint;
    nextMessageSequence: bigint;
    historyRetentionDays: number;
    expiresAt: Date | null;
  }>>(Prisma.sql`
    SELECT id, cache_epoch AS "cacheEpoch", next_message_sequence AS "nextMessageSequence",
      history_retention_days AS "historyRetentionDays", expires_at AS "expiresAt"
    FROM tenant_chat_conversations
    WHERE id = ${conversationId}::uuid
      AND tenant_id = ${actor.tenantId}::uuid
      AND user_id = ${actor.userId}::uuid
      AND status = 'active'
      AND deleted_at IS NULL
    FOR UPDATE
  `);
  if (!rows[0]) throw new ConversationNotFound();
  return rows[0];
}

function assertHandle(actor: ChatActor, reserved: ReservedTurn, handle: AdmissionHandle): void {
  if (
    handle.requestId !== reserved.requestId ||
    handle.turnId !== reserved.turnId ||
    handle.idempotencyKey !== reserved.idempotencyKey ||
    handle.executionScope.tenantId !== actor.tenantId ||
    handle.executionScope.actor.userId !== actor.userId
  ) {
    throw new TurnStateConflict();
  }
}

function reservedView(
  row: Readonly<{
    conversationId: string;
    id: string;
    requestId: string;
    idempotencyKey: string;
    capturedCacheEpoch: bigint;
    state: string;
  }>,
  replayed: boolean,
): ReservedTurn {
  return Object.freeze({
    conversationId: row.conversationId,
    turnId: row.id,
    requestId: row.requestId,
    idempotencyKey: row.idempotencyKey,
    cacheEpoch: row.capturedCacheEpoch,
    state: row.state,
    replayed,
  });
}

function expiry(days: number): Date | null {
  if (days === 0) return null;
  if (![7, 30, 90].includes(days)) throw new ContentIntegrityError();
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function bytes(value: Buffer): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(value) as Uint8Array<ArrayBuffer>;
}

function uniqueConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function assertEffectiveModelKey(value: string | null): void {
  if (value !== null && !MODEL_KEY.test(value)) throw new ContentIntegrityError();
}

function messageEffectiveModelKey(
  row: Pick<TenantChatMessage, 'effectiveModelKey' | 'role'>,
): string | undefined {
  if (row.effectiveModelKey === null) return undefined;
  if (row.role !== 'assistant' || !MODEL_KEY.test(row.effectiveModelKey)) {
    throw new ContentIntegrityError();
  }
  return row.effectiveModelKey;
}

function assertEffectiveModelKeyMatches(
  row: Pick<TenantChatMessage, 'effectiveModelKey' | 'role'>,
  expected: string | null,
): void {
  const actual = messageEffectiveModelKey(row) ?? null;
  if (actual !== expected) throw new ContentIntegrityError();
}

function safeSequence(value: bigint): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new ContentIntegrityError();
  return number;
}

function safeCode(value: string): string {
  return /^CHAT_[A-Z0-9_]{1,59}$/.test(value) ? value : 'CHAT_PROVIDER_FAILED';
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, JsonValue>, keys: string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function sameActor(value: JsonValue, actor: ChatActor): boolean {
  return isRecord(value) && exactKeys(value, ['tenantId', 'userId']) && value.tenantId === actor.tenantId && value.userId === actor.userId;
}

function uuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
