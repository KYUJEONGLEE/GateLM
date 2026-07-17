import { Injectable } from '@nestjs/common';
import { Prisma, type TenantChatMessage } from '@prisma/client';
import { randomUUID, timingSafeEqual } from 'node:crypto';

import { PrismaService } from '@/database/prisma.service';
import {
  MAX_EPHEMERAL_MESSAGE_CHARACTERS,
  type AdmissionHandle,
  type ClientUsageIntent,
  type TenantChatContextMode,
} from '@/execution/execution.types';
import type { JsonValue } from '@/execution/jcs';

import {
  ConversationNotFound,
  ConversationVersionConflict,
  IdempotencyConflict,
  TurnStateConflict,
} from './chat-store.errors';
import { ContentIntegrityError } from './content.errors';
import {
  createMessageAad,
  createMessageCitationsAad,  createTitleAad,
  decryptContent,
  encryptContent,
  type ContentRole,
  type EncryptedContent,
} from './content-crypto';
import { citationSnapshotJson, parseCitationSnapshot, type RagCitation } from '@/rag/rag-citations';
import { ContentIntegrityService } from './content-integrity.service';
import { CursorCodec, InvalidCursor } from './cursor-codec';
import { TenantContentKeyService } from './tenant-content-key.service';

const CREATE_SCOPE = 'tenant-chat:conversation:create:v1';
const TURN_SCOPE = 'tenant-chat:turn:create:v1';
const CONVERSATION_CURSOR_SCOPE = 'tenant-chat:conversation:list:v1';
const MESSAGE_CURSOR_SCOPE = 'tenant-chat:message:list:v1';
const MAX_HISTORY_MESSAGES = 32;
const MAX_HISTORY_BYTES = 256 * 1024;
const MAX_PLACEHOLDER_COUNTER = 1_000_000;
const PLACEHOLDER_PATTERN = /\[(EMAIL|PHONE_NUMBER|ADDRESS|PERSON|ORGANIZATION|CUSTOMER|AGENT|DOCTOR|PATIENT|APPLICANT|INTERVIEWER)_([1-9][0-9]{0,6})\]/g;
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
  knowledgeMode: 'off' | 'tenant';
  createdAt: string;
  updatedAt: string;
}>;

export type MessageView = Readonly<{
  id: string;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;
  effectiveModelKey?: string;
  citations?: readonly RagCitation[];
  sequence: number;
  createdAt: string;
}>;

export type MessageSafetyStatus = 'legacy_unverified' | 'sanitized' | 'provider_generated';

export type CompletionHistoryMessage = Readonly<{
  id: string;
  turnId: string;
  role: 'user' | 'assistant';
  content: string;
  safetyStatus: MessageSafetyStatus;
  safetyPolicyDigest: string | null;
}>;

export type CompletionHistory = Readonly<{
  messages: readonly CompletionHistoryMessage[];
  placeholderCounters: Readonly<Record<string, number>>;
}>;

export type LegacyUserSanitization = Readonly<{
  messageId: string;
  content: string;
}>;

export type ReservedTurn = Readonly<{
  conversationId: string;
  turnId: string;
  requestId: string;
  idempotencyKey: string;
  cacheEpoch: bigint;
  state: string;
  knowledgeMode: 'off' | 'tenant';
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
    input: Readonly<{
      idempotencyKey: string;
      title: string;
      historyRetentionDays: number;
      knowledgeMode: 'off' | 'tenant';
    }>,
  ): Promise<Readonly<{ conversation: ConversationView; replayed: boolean }>> {
    const binding = createBinding(actor, input.idempotencyKey, input.title, input.knowledgeMode);
    const signed = await this.integrity.sign(binding);
    const id = randomUUID();
    const encrypted = await this.keys.withActiveKey(actor.tenantId, (key, version) =>
      encryptContent(key, input.title, createTitleAad(actor.tenantId, id, version)),
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
          knowledgeMode: input.knowledgeMode,
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

  async updateConversation(
    actor: ChatActor,
    conversationId: string,
    input: Readonly<{
      expectedVersion: number;
      title?: string;
      knowledgeMode?: 'off' | 'tenant';
    }>,
  ): Promise<ConversationView> {
    await this.activeConversation(actor, conversationId);
    const encrypted = input.title === undefined
      ? undefined
      : await this.keys.withActiveKey(actor.tenantId, (key, version) =>
        encryptContent(key, input.title!, createTitleAad(actor.tenantId, conversationId, version)),
      );
    const changed = await this.prisma.tenantChatConversation.updateMany({
      where: {
        id: conversationId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        status: 'active',
        deletedAt: null,
        version: input.expectedVersion,
      },
      data: {
        version: { increment: 1 },
        ...(encrypted === undefined ? {} : {
          titleCiphertext: bytes(encrypted.ciphertext),
          titleNonce: bytes(encrypted.nonce),
          titleTag: bytes(encrypted.tag),
          titleContentKeyVersion: encrypted.contentKeyVersion,
          titleSchemaVersion: encrypted.schemaVersion,
        }),
        ...(input.knowledgeMode === undefined ? {} : { knowledgeMode: input.knowledgeMode }),
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
    input: Readonly<{
      idempotencyKey: string;
      content: string;
      contextMode: TenantChatContextMode;
      usageIntent: ClientUsageIntent;
    }>,
  ): Promise<ReservedTurn> {
    const binding = turnBinding(actor, conversationId, input);
    const signed = await this.integrity.sign(binding);
    const turnId = randomUUID();
    const requestId = randomUUID();
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const conversation = await lockActiveConversation(tx, actor, conversationId);
        const turn = await tx.tenantChatTurn.create({
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
        return { turn, knowledgeMode: conversation.knowledgeMode };
      });
      return reservedView(created.turn, false, created.knowledgeMode);
    } catch (error) {
      if (!uniqueConflict(error)) throw error;
      const result = await this.prisma.$transaction(async (tx) => {
        const conversation = await lockActiveConversation(tx, actor, conversationId);
        const turn = await tx.tenantChatTurn.findUnique({
          where: {
            tenantId_userId_idempotencyKey: {
              tenantId: actor.tenantId,
              userId: actor.userId,
              idempotencyKey: input.idempotencyKey,
            },
          },
        });
        return { turn, knowledgeMode: conversation.knowledgeMode };
      });
      if (!result.turn || result.turn.conversationId !== conversationId) throw new IdempotencyConflict();
      await this.verifyBinding(binding, result.turn.requestBindingKeyVersion, result.turn.requestBindingMac);
      return reservedView(result.turn, true, result.knowledgeMode);
    }
  }

  async persistAdmittedUser(
    actor: ChatActor,
    reserved: ReservedTurn,
    sanitizedContent: string,
    policyDigest: string,
    handle: AdmissionHandle,
    legacyUsers: readonly LegacyUserSanitization[] = [],
    legacyPolicyDigest = policyDigest,
  ): Promise<Readonly<{ message: MessageView; replayed: boolean }>> {
    assertHandle(actor, reserved, handle);
    if (!validPolicyDigest(policyDigest) || !validPolicyDigest(legacyPolicyDigest)) {
      throw new ContentIntegrityError();
    }
    if (legacyUsers.length > MAX_HISTORY_MESSAGES - 1) throw new ContentIntegrityError();
    const existing = await this.findTurnMessage(actor, reserved.turnId, 'user');
    if (existing && messageSafety(existing).status === 'sanitized') {
      await this.assertMessageContent(existing, sanitizedContent);
      assertSanitizedPolicy(existing, policyDigest);
      if (legacyUsers.length === 0) {
        return Object.freeze({ message: await this.messageView(existing), replayed: true });
      }
    }

    const messageId = existing?.id ?? randomUUID();
    const uniqueLegacy = uniqueLegacySanitizations(legacyUsers, messageId);
    const concurrentlyMigratedIds = new Set<string>();
    const encryptions = await this.keys.withActiveKey(actor.tenantId, (key, version) => {
      const current = existing && messageSafety(existing).status === 'sanitized'
        ? undefined
        : encryptContent(
          key,
          sanitizedContent,
          messageAadV2(
            actor.tenantId,
            reserved.conversationId,
            messageId,
            'user',
            version,
            'sanitized',
            policyDigest,
          ),
        );
      const migrated = uniqueLegacy.map((legacy) => ({
        ...legacy,
        encrypted: encryptContent(
          key,
          legacy.content,
          messageAadV2(
            actor.tenantId,
            reserved.conversationId,
            legacy.messageId,
            'user',
            version,
            'sanitized',
            legacyPolicyDigest,
          ),
        ),
      }));
      return { current, migrated };
    });
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

        for (const migration of encryptions.migrated) {
          const changed = await tx.tenantChatMessage.updateMany({
            where: {
              id: migration.messageId,
              conversationId: reserved.conversationId,
              tenantId: actor.tenantId,
              userId: actor.userId,
              role: 'user',
              schemaVersion: 1,
              safetyStatus: 'legacy_unverified',
            },
            data: sanitizedMessageData(migration.encrypted, legacyPolicyDigest),
          });
          if (changed.count !== 1) {
            const concurrentlyMigrated = await tx.tenantChatMessage.findFirst({
              where: {
                id: migration.messageId,
                conversationId: reserved.conversationId,
                tenantId: actor.tenantId,
                userId: actor.userId,
                role: 'user',
              },
            });
            if (!concurrentlyMigrated) throw new TurnStateConflict();
            assertSanitizedPolicy(concurrentlyMigrated, legacyPolicyDigest);
            concurrentlyMigratedIds.add(migration.messageId);
          }
        }

        if (existing) {
          if (messageSafety(existing).status === 'legacy_unverified') {
            if (!encryptions.current) throw new ContentIntegrityError();
            const changed = await tx.tenantChatMessage.updateMany({
              where: {
                id: existing.id,
                conversationId: reserved.conversationId,
                tenantId: actor.tenantId,
                userId: actor.userId,
                turnId: reserved.turnId,
                role: 'user',
                schemaVersion: 1,
                safetyStatus: 'legacy_unverified',
              },
              data: sanitizedMessageData(encryptions.current, policyDigest),
            });
            if (changed.count !== 1) throw new TurnStateConflict();
          }
          return;
        }

        if (turn.state !== 'pending_admission') return;
        if (!encryptions.current) throw new TurnStateConflict();
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
            ...sanitizedMessageData(encryptions.current, policyDigest),
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
      for (const migration of encryptions.migrated) {
        if (!concurrentlyMigratedIds.has(migration.messageId)) continue;
        const concurrentlyMigrated = await this.prisma.tenantChatMessage.findFirst({
          where: {
            id: migration.messageId,
            conversationId: reserved.conversationId,
            tenantId: actor.tenantId,
            userId: actor.userId,
            role: 'user',
          },
        });
        if (!concurrentlyMigrated) throw new TurnStateConflict();
        assertSanitizedPolicy(concurrentlyMigrated, legacyPolicyDigest);
        await this.assertMessageContent(concurrentlyMigrated, migration.content);
      }
      const persisted = await this.findTurnMessage(actor, reserved.turnId, 'user');
      if (!persisted || messageSafety(persisted).status !== 'sanitized') throw new TurnStateConflict();
      await this.assertMessageContent(persisted, sanitizedContent);
      assertSanitizedPolicy(persisted, policyDigest);
      return Object.freeze({ message: await this.messageView(persisted), replayed: existing !== null });
    } catch (error) {
      if (!uniqueConflict(error)) throw error;
      const duplicate = await this.findTurnMessage(actor, reserved.turnId, 'user');
      if (!duplicate) throw error;
      if (messageSafety(duplicate).status !== 'sanitized') throw new TurnStateConflict();
      await this.assertMessageContent(duplicate, sanitizedContent);
      assertSanitizedPolicy(duplicate, policyDigest);
      return Object.freeze({ message: await this.messageView(duplicate), replayed: true });
    }
  }

  async persistRagNoEvidence(
    actor: ChatActor,
    reserved: ReservedTurn,
    userContent: string,
    userPolicyDigest: string,
    assistantContent: string,
  ): Promise<Readonly<{ message: MessageView; userMessage: MessageView }>> {
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const completed = await this.keys.withActiveKey(actor.tenantId, async (key, version) => {
      const user = encryptContent(
        key,
        userContent,
        messageAadV2(
          actor.tenantId,
          reserved.conversationId,
          userMessageId,
          'user',
          version,
          'sanitized',
          userPolicyDigest,
        ),
      );
      const assistant = encryptContent(
        key,
        assistantContent,
        messageAadV2(
          actor.tenantId,
          reserved.conversationId,
          assistantMessageId,
          'assistant',
          version,
          'provider_generated',
          null,
        ),
      );
      return this.prisma.$transaction(async (tx) => {
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
        if (!turn) throw new TurnStateConflict();
        if (turn.state === 'completed') return true;
        if (turn.state !== 'pending_admission') throw new TurnStateConflict();
        const expiresAt = expiry(conversation.historyRetentionDays);
        await tx.tenantChatMessage.createMany({
          data: [
            {
              id: userMessageId, conversationId: reserved.conversationId, tenantId: actor.tenantId,
              userId: actor.userId, turnId: reserved.turnId, requestId: reserved.requestId,
              role: 'user', sequence: conversation.nextMessageSequence,
              ciphertext: bytes(user.ciphertext), nonce: bytes(user.nonce), tag: bytes(user.tag),
              contentKeyVersion: user.contentKeyVersion, schemaVersion: user.schemaVersion,
              safetyStatus: 'sanitized', safetyPolicyDigest: userPolicyDigest, expiresAt,
            },
            {
              id: assistantMessageId, conversationId: reserved.conversationId, tenantId: actor.tenantId,
              userId: actor.userId, turnId: reserved.turnId, requestId: reserved.requestId,
              role: 'assistant', sequence: conversation.nextMessageSequence + 1n,
              ciphertext: bytes(assistant.ciphertext), nonce: bytes(assistant.nonce), tag: bytes(assistant.tag),
              contentKeyVersion: assistant.contentKeyVersion, schemaVersion: assistant.schemaVersion,
              safetyStatus: 'provider_generated', safetyPolicyDigest: null,
              effectiveModelKey: null, expiresAt,
            },
          ],
        });
        await tx.tenantChatTurn.update({
          where: { id: reserved.turnId },
          data: { state: 'completed', safeErrorCode: null, completedAt: new Date() },
        });
        await tx.tenantChatConversation.update({
          where: { id: reserved.conversationId },
          data: { nextMessageSequence: { increment: 2 }, expiresAt },
        });
        return false;
      });
    });
    const [message, userMessage] = completed
      ? await Promise.all([
          this.findTurnMessage(actor, reserved.turnId, 'assistant'),
          this.findTurnMessage(actor, reserved.turnId, 'user'),
        ])
      : await Promise.all([
          this.prisma.tenantChatMessage.findUnique({ where: { id: assistantMessageId } }),
          this.prisma.tenantChatMessage.findUnique({ where: { id: userMessageId } }),
        ]);
    if (!message || !userMessage) throw new TurnStateConflict();
    if (completed) {
      await Promise.all([
        this.assertMessageContent(message, assistantContent),
        this.assertMessageContent(userMessage, userContent),
      ]);
    }
    const [messageView, userMessageView] = await Promise.all([
      this.messageView(message),
      this.messageView(userMessage),
    ]);
    return Object.freeze({ message: messageView, userMessage: userMessageView });
  }

  async completionHistory(
    actor: ChatActor,
    conversationId: string,
    currentContentBytes: number,
  ): Promise<CompletionHistory> {
    await this.activeConversation(actor, conversationId);
    if (!Number.isSafeInteger(currentContentBytes) || currentContentBytes < 1 || currentContentBytes > MAX_HISTORY_BYTES) {
      throw new ContentIntegrityError();
    }
    const rows = await this.prisma.tenantChatMessage.findMany({
      where: {
        conversationId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        turn: { state: 'completed' },
      },
      orderBy: { sequence: 'desc' },
      take: MAX_HISTORY_MESSAGES - 1,
    });
    const selected: CompletionHistoryMessage[] = [];
    let bytesUsed = currentContentBytes;
    for (const row of rows) {
      const content = await this.decryptMessage(row);
      if (content.length > MAX_EPHEMERAL_MESSAGE_CHARACTERS) break;
      const contentBytes = Buffer.byteLength(content, 'utf8');
      if (bytesUsed + contentBytes > MAX_HISTORY_BYTES) break;
      bytesUsed += contentBytes;
      const safety = messageSafety(row);
      selected.push(Object.freeze({
        id: row.id,
        turnId: row.turnId,
        role: row.role as 'user' | 'assistant',
        content,
        safetyStatus: safety.status,
        safetyPolicyDigest: safety.policyDigest,
      }));
    }
    selected.reverse();
    return Object.freeze({
      messages: Object.freeze(selected),
      placeholderCounters: Object.freeze(placeholderCounters(selected)),
    });
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
    citations?: readonly RagCitation[],
  ): Promise<Readonly<{ message: MessageView; replayed: boolean }>> {
    assertEffectiveModelKey(effectiveModelKey);
    const existing = await this.findTurnMessage(actor, reserved.turnId, 'assistant');
    if (existing) {
      await this.assertMessageContent(existing, content);
      assertEffectiveModelKeyMatches(existing, effectiveModelKey);
      return Object.freeze({ message: await this.messageView(existing), replayed: true });
    }
    const messageId = randomUUID();
    const encrypted = await this.keys.withActiveKey(actor.tenantId, (key, version) => {
      const payload = encryptContent(
        key,
        content,
        messageAadV2(
          actor.tenantId,
          reserved.conversationId,
          messageId,
          'assistant',
          version,
          'provider_generated',
          null,
        ),
      );
      const citation = citations === undefined ? undefined : encryptContent(
        key, citationSnapshotJson(citations),
        createMessageCitationsAad(actor.tenantId, reserved.conversationId, messageId, version),
      );
      return { content: payload, citation };
    });
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
            ciphertext: bytes(encrypted.content.ciphertext),
            nonce: bytes(encrypted.content.nonce),
            tag: bytes(encrypted.content.tag),
            contentKeyVersion: encrypted.content.contentKeyVersion,
            schemaVersion: encrypted.content.schemaVersion,
            safetyStatus: 'provider_generated',
            safetyPolicyDigest: null,
            ...(encrypted.citation ? {
              citationCiphertext: bytes(encrypted.citation.ciphertext),
              citationNonce: bytes(encrypted.citation.nonce),
              citationTag: bytes(encrypted.citation.tag),
              citationContentKeyVersion: encrypted.citation.contentKeyVersion,
              citationSchemaVersion: encrypted.citation.schemaVersion,
            } : {}),            effectiveModelKey,
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

  async readSanitizedUser(
    actor: ChatActor,
    reserved: ReservedTurn,
  ): Promise<MessageView | null> {
    const row = await this.prisma.tenantChatMessage.findFirst({
      where: {
        turnId: reserved.turnId,
        conversationId: reserved.conversationId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        role: 'user',
      },
    });
    if (!row) return null;
    const safety = messageSafety(row);
    if (safety.status !== 'sanitized' || !safety.policyDigest) {
      throw new ContentIntegrityError();
    }
    return this.messageView(row);
  }

  async readCurrentUserSafety(
    actor: ChatActor,
    reserved: ReservedTurn,
  ): Promise<CompletionHistoryMessage | null> {
    const row = await this.prisma.tenantChatMessage.findFirst({
      where: {
        turnId: reserved.turnId,
        conversationId: reserved.conversationId,
        tenantId: actor.tenantId,
        userId: actor.userId,
        role: 'user',
      },
    });
    if (!row) return null;
    const safety = messageSafety(row);
    return Object.freeze({
      id: row.id,
      turnId: row.turnId,
      role: 'user' as const,
      content: await this.decryptMessage(row),
      safetyStatus: safety.status,
      safetyPolicyDigest: safety.policyDigest,
    });
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
        createTitleAad(row.tenantId, row.id, row.titleContentKeyVersion!),
      ),
    );
    return Object.freeze({
      id: row.id,
      title,
      version: row.version,
      historyRetentionDays: row.historyRetentionDays,
      knowledgeMode: knowledgeMode(row.knowledgeMode),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  private async messageView(row: TenantChatMessage): Promise<MessageView> {
    const content = await this.decryptMessage(row);
    const effectiveModelKey = messageEffectiveModelKey(row);
    const citations = await this.decryptCitations(row);
    return Object.freeze({
      id: row.id,
      turnId: row.turnId,
      role: row.role as 'user' | 'assistant',
      content,
      ...(effectiveModelKey ? { effectiveModelKey } : {}),
      ...(citations ? { citations: await this.withCitationAvailability(row.tenantId, citations) } : {}),
      sequence: safeSequence(row.sequence),
      createdAt: row.createdAt.toISOString(),
    });
  }

  private async decryptCitations(row: TenantChatMessage): Promise<readonly RagCitation[] | undefined> {
    const values = [row.citationCiphertext, row.citationNonce, row.citationTag, row.citationContentKeyVersion, row.citationSchemaVersion];
    if (values.every((value) => value === null)) return undefined;
    if (!row.citationCiphertext || !row.citationNonce || !row.citationTag || !row.citationContentKeyVersion || row.citationSchemaVersion !== 1 || row.role !== 'assistant') throw new ContentIntegrityError();
    const plaintext = await this.keys.withKeyVersion(row.tenantId, row.citationContentKeyVersion, (key) => decryptContent(key, {
      ciphertext: Buffer.from(row.citationCiphertext!), nonce: Buffer.from(row.citationNonce!), tag: Buffer.from(row.citationTag!),
    }, createMessageCitationsAad(row.tenantId, row.conversationId, row.id, row.citationContentKeyVersion!)));
    try { return parseCitationSnapshot(plaintext); } catch { throw new ContentIntegrityError(); }
  }

  private async withCitationAvailability(tenantId: string, citations: readonly RagCitation[]): Promise<readonly RagCitation[]> {
    if (citations.length === 0) return citations;
    const documents = await this.prisma.ragDocument.findMany({
      where: { tenantId, publicId: { in: citations.map((citation) => citation.documentId) }, status: 'READY' },
      select: { publicId: true },
    });
    const available = new Set(documents.map((document) => document.publicId));
    return Object.freeze(citations.map((citation) => Object.freeze({ ...citation, availability: available.has(citation.documentId) ? 'available' as const : 'unavailable' as const })));
  }

  private async decryptMessage(row: TenantChatMessage): Promise<string> {
    if (![1, 2].includes(row.schemaVersion) || !['user', 'assistant'].includes(row.role)) {
      throw new ContentIntegrityError();
    }
    const safety = messageSafety(row);
    return this.keys.withKeyVersion(row.tenantId, row.contentKeyVersion, (key) =>
      decryptContent(
        key,
        {
          ciphertext: Buffer.from(row.ciphertext),
          nonce: Buffer.from(row.nonce),
          tag: Buffer.from(row.tag),
        },
        row.schemaVersion === 1
          ? messageAadV1(
            row.tenantId,
            row.conversationId,
            row.id,
            row.role as 'user' | 'assistant',
            row.contentKeyVersion,
          )
          : messageAadV2(
            row.tenantId,
            row.conversationId,
            row.id,
            row.role as 'user' | 'assistant',
            row.contentKeyVersion,
            safety.status as 'sanitized' | 'provider_generated',
            safety.policyDigest,
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
    if (typeof value.boundary.id !== 'string' || !isUuidV4(value.boundary.id) || typeof value.boundary.updatedAt !== 'string') throw new InvalidCursor();
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
  knowledgeMode: string;
}>;

function createBinding(
  actor: ChatActor,
  idempotencyKey: string,
  title: string,
  knowledgeMode: 'off' | 'tenant',
): JsonValue {
  const legacy = { actor: actorValue(actor), idempotencyKey, scope: CREATE_SCOPE, title, version: 1 };
  return knowledgeMode === 'tenant' ? { ...legacy, knowledgeMode } : legacy;
}

function turnBinding(
  actor: ChatActor,
  conversationId: string,
  input: Readonly<{
    idempotencyKey: string;
    content: string;
    contextMode: TenantChatContextMode;
    usageIntent: ClientUsageIntent;
  }>,
): JsonValue {
  const legacyBinding = {
    actor: actorValue(actor),
    content: input.content,
    conversationId,
    idempotencyKey: input.idempotencyKey,
    scope: TURN_SCOPE,
    usageIntent: input.usageIntent,
    version: 1,
  };
  return (input.contextMode === 'single_turn'
    ? { ...legacyBinding, contextMode: input.contextMode }
    : legacyBinding) as unknown as JsonValue;
}

function actorValue(actor: ChatActor): JsonValue {
  return { tenantId: actor.tenantId, userId: actor.userId };
}


function messageAadV1(
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

function messageAadV2(
  tenantId: string,
  conversationId: string,
  recordId: string,
  role: 'user' | 'assistant',
  contentKeyVersion: number,
  safetyStatus: 'sanitized' | 'provider_generated',
  safetyPolicyDigest: string | null,
) {
  return {
    schemaVersion: 2 as const,
    tenantId,
    conversationId,
    recordId,
    contentKind: 'message' as const,
    role,
    contentKeyVersion,
    safetyStatus,
    safetyPolicyDigest,
  };
}

function sanitizedMessageData(encrypted: EncryptedContent, policyDigest: string) {
  if (encrypted.schemaVersion !== 2 || !validPolicyDigest(policyDigest)) {
    throw new ContentIntegrityError();
  }
  return {
    ciphertext: bytes(encrypted.ciphertext),
    nonce: bytes(encrypted.nonce),
    tag: bytes(encrypted.tag),
    contentKeyVersion: encrypted.contentKeyVersion,
    schemaVersion: 2,
    safetyStatus: 'sanitized',
    safetyPolicyDigest: policyDigest,
  } as const;
}

function messageSafety(row: TenantChatMessage): Readonly<{
  status: MessageSafetyStatus;
  policyDigest: string | null;
}> {
  if (row.role !== 'user' && row.role !== 'assistant') throw new ContentIntegrityError();
  if (row.schemaVersion === 1) {
    return row.role === 'user'
      ? Object.freeze({ status: 'legacy_unverified', policyDigest: null })
      : Object.freeze({ status: 'provider_generated', policyDigest: null });
  }
  if (row.schemaVersion !== 2) throw new ContentIntegrityError();
  if (
    row.role === 'user' && row.safetyStatus === 'sanitized' &&
    validPolicyDigest(row.safetyPolicyDigest)
  ) {
    return Object.freeze({ status: 'sanitized', policyDigest: row.safetyPolicyDigest });
  }
  if (
    row.role === 'assistant' && row.safetyStatus === 'provider_generated' &&
    row.safetyPolicyDigest === null
  ) {
    return Object.freeze({ status: 'provider_generated', policyDigest: null });
  }
  throw new ContentIntegrityError();
}

function assertSanitizedPolicy(row: TenantChatMessage, expected: string): void {
  const safety = messageSafety(row);
  if (safety.status !== 'sanitized' || safety.policyDigest !== expected) {
    throw new ContentIntegrityError();
  }
}

function uniqueLegacySanitizations(
  values: readonly LegacyUserSanitization[],
  currentMessageId: string,
): readonly LegacyUserSanitization[] {
  const seen = new Set<string>([currentMessageId]);
  return Object.freeze(values.map((value) => {
    if (!isUuidV4(value.messageId) || seen.has(value.messageId) || !value.content) {
      throw new ContentIntegrityError();
    }
    seen.add(value.messageId);
    return Object.freeze({ messageId: value.messageId, content: value.content });
  }));
}

function placeholderCounters(messages: readonly CompletionHistoryMessage[]): Record<string, number> {
  const counters: Record<string, number> = {};
  for (const message of messages) {
    if (message.safetyStatus !== 'sanitized') continue;
    PLACEHOLDER_PATTERN.lastIndex = 0;
    for (let match = PLACEHOLDER_PATTERN.exec(message.content); match; match = PLACEHOLDER_PATTERN.exec(message.content)) {
      const prefix = match[1];
      const count = Number(match[2]);
      if (!prefix || !Number.isSafeInteger(count) || count < 1 || count > MAX_PLACEHOLDER_COUNTER) continue;
      counters[prefix] = Math.max(counters[prefix] ?? 0, count);
    }
  }
  return counters;
}

function validPolicyDigest(value: unknown): value is string {
  return typeof value === 'string' && /^sha256:[A-Za-z0-9_-]{43}$/.test(value);
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
    knowledgeMode: string;
  }>>(Prisma.sql`
    SELECT id, cache_epoch AS "cacheEpoch", next_message_sequence AS "nextMessageSequence",
      history_retention_days AS "historyRetentionDays", expires_at AS "expiresAt",
      knowledge_mode AS "knowledgeMode"
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
  mode: string,
): ReservedTurn {
  return Object.freeze({
    conversationId: row.conversationId,
    turnId: row.id,
    requestId: row.requestId,
    idempotencyKey: row.idempotencyKey,
    cacheEpoch: row.capturedCacheEpoch,
    state: row.state,
    knowledgeMode: knowledgeMode(mode),
    replayed,
  });
}

function knowledgeMode(value: string): 'off' | 'tenant' {
  if (value === 'off' || value === 'tenant') return value;
  throw new ContentIntegrityError();
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

function isUuidV4(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}
