import { randomUUID } from 'node:crypto';

import {
  MAX_EPHEMERAL_MESSAGE_CHARACTERS,
  type ClientUsageIntent,
} from '@/execution/execution.types';
import {
  citationSnapshotJson,
  type RagCitation,
} from '@/rag/rag-citations';

import { ConversationNotFound } from './chat-store.errors';
import { createMessageCitationsAad, encryptContent } from './content-crypto';
import { EncryptedChatStore, type ChatActor } from './encrypted-chat-store';

const actor: ChatActor = Object.freeze({
  tenantId: '00000000-0000-4000-8000-000000000100',
  userId: '00000000-0000-4000-8000-000000000200',
});
const conversationId = '00000000-0000-4000-8000-000000000300';
const usageIntent: ClientUsageIntent = Object.freeze({
  maxOutputTokens: 64,
  requestedTier: 'standard',
  cacheStrategy: 'exact',
});

describe('EncryptedChatStore concurrency boundaries', () => {
  it('does not insert a turn when deletion wins the conversation lock', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      tenantChatTurn: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    };
    const integrity = { sign: jest.fn().mockResolvedValue(bindingMac()) };
    const store = new EncryptedChatStore(
      prisma as never,
      {} as never,
      integrity as never,
      {} as never,
    );

    await expect(store.reserveTurn(actor, conversationId, {
      idempotencyKey: 'idempotency-key-0001',
      content: '<synthetic>',
      contextMode: 'conversation',
      usageIntent,
    })).rejects.toBeInstanceOf(ConversationNotFound);
    expect(integrity.sign).toHaveBeenCalledWith(expect.not.objectContaining({ contextMode: expect.anything() }));
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.tenantChatTurn.create).not.toHaveBeenCalled();
  });

  it('binds single-turn context mode without changing the legacy conversation binding', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      tenantChatTurn: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    };
    const integrity = { sign: jest.fn().mockResolvedValue(bindingMac()) };
    const store = new EncryptedChatStore(
      prisma as never,
      {} as never,
      integrity as never,
      {} as never,
    );

    await expect(store.reserveTurn(actor, conversationId, {
      idempotencyKey: 'idempotency-key-0001',
      content: '<synthetic>',
      contextMode: 'single_turn',
      usageIntent,
    })).rejects.toBeInstanceOf(ConversationNotFound);
    expect(integrity.sign).toHaveBeenCalledWith(expect.objectContaining({ contextMode: 'single_turn' }));
  });

  it('rechecks expiry under the delete lock before hard deletion', async () => {
    const futureExpiry = new Date(Date.now() + 60_000);
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{
        id: conversationId,
        status: 'active',
        version: 1,
        cacheEpoch: 1n,
        expiresAt: futureExpiry,
      }]),
      tenantChatConversation: { update: jest.fn() },
      tenantChatMessage: { deleteMany: jest.fn() },
      tenantChatTurn: { findMany: jest.fn(), updateMany: jest.fn() },
    };
    const prisma = {
      tenantChatConversation: {
        findMany: jest.fn().mockResolvedValue([{
          id: conversationId,
          tenantId: actor.tenantId,
          userId: actor.userId,
        }]),
      },
      $transaction: jest.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx)),
    };
    const store = new EncryptedChatStore(prisma as never, {} as never, {} as never, {} as never);

    await expect(store.deleteExpiredBatch(10)).resolves.toEqual({
      deleted: 0,
      cancelledTurnIds: [],
    });
    expect(tx.tenantChatConversation.update).not.toHaveBeenCalled();
    expect(tx.tenantChatMessage.deleteMany).not.toHaveBeenCalled();
    expect(tx.tenantChatTurn.updateMany).not.toHaveBeenCalled();
  });
});

describe('EncryptedChatStore completion history', () => {
  it('stops before a stored assistant message that exceeds the private message contract', async () => {
    const key = Buffer.alloc(32, 7);
    const oversizedAssistant = encryptedMessage(
      key,
      'assistant',
      'x'.repeat(MAX_EPHEMERAL_MESSAGE_CHARACTERS + 1),
      3n,
    );
    const olderUser = encryptedMessage(key, 'user', '<older>', 2n);
    const prisma = {
      tenantChatConversation: { findFirst: jest.fn().mockResolvedValue({ id: conversationId }) },
      tenantChatMessage: {
        findMany: jest.fn().mockResolvedValue([oversizedAssistant, olderUser]),
      },
    };
    const keys = {
      withKeyVersion: jest.fn(async (
        _tenantId: string,
        _version: number,
        operation: (contentKey: Buffer) => Promise<string> | string,
      ) => operation(key)),
    };
    const store = new EncryptedChatStore(prisma as never, keys as never, {} as never, {} as never);

    await expect(store.completionHistory(actor, conversationId, Buffer.byteLength('<current>')))
      .resolves.toEqual({ messages: [], placeholderCounters: {} });
    expect(keys.withKeyVersion).toHaveBeenCalledTimes(1);
  });

  it('does not trust v1 user metadata or derive counters from legacy content', async () => {
    const key = Buffer.alloc(32, 7);
    const legacy = {
      ...encryptedMessage(key, 'user', '[EMAIL_9]', 1n),
      safetyStatus: 'sanitized',
      safetyPolicyDigest: `sha256:${'A'.repeat(43)}`,
    };
    const prisma = {
      tenantChatConversation: { findFirst: jest.fn().mockResolvedValue({ id: conversationId }) },
      tenantChatMessage: { findMany: jest.fn().mockResolvedValue([legacy]) },
    };
    const keys = contentKeys(key);
    const store = new EncryptedChatStore(prisma as never, keys as never, {} as never, {} as never);

    await expect(store.completionHistory(actor, conversationId, 1)).resolves.toEqual({
      messages: [{
        id: legacy.id,
        turnId: legacy.turnId,
        role: 'user',
        content: '[EMAIL_9]',
        safetyStatus: 'legacy_unverified',
        safetyPolicyDigest: null,
      }],
      placeholderCounters: {},
    });
  });

  it('derives placeholder counters only from AAD-bound v2 sanitized history', async () => {
    const key = Buffer.alloc(32, 7);
    const sanitized = encryptedSanitizedMessage(key, '[EMAIL_9] [PERSON_2]', 1n);
    const prisma = {
      tenantChatConversation: { findFirst: jest.fn().mockResolvedValue({ id: conversationId }) },
      tenantChatMessage: { findMany: jest.fn().mockResolvedValue([sanitized]) },
    };
    const keys = contentKeys(key);
    const store = new EncryptedChatStore(prisma as never, keys as never, {} as never, {} as never);

    await expect(store.completionHistory(actor, conversationId, 1)).resolves.toEqual({
      messages: [{
        id: sanitized.id,
        turnId: sanitized.turnId,
        role: 'user',
        content: '[EMAIL_9] [PERSON_2]',
        safetyStatus: 'sanitized',
        safetyPolicyDigest: sanitized.safetyPolicyDigest,
      }],
      placeholderCounters: { EMAIL: 9, PERSON: 2 },
    });
  });
});

describe('EncryptedChatStore citation history replay', () => {
  it('marks only tenant-scoped READY documents available without exposing storage internals', async () => {
    const key = Buffer.alloc(32, 7);
    const readyDocumentId = '00000000-0000-4000-8000-000000000401';
    const deletingDocumentId = '00000000-0000-4000-8000-000000000402';
    const deletedDocumentId = '00000000-0000-4000-8000-000000000403';
    const otherTenantDocumentId = '00000000-0000-4000-8000-000000000404';
    const internalReadyDocumentId = '00000000-0000-4000-8000-000000000499';
    const rawChunk = '<raw-chunk-must-not-leak>';
    const citations = [
      citation('S1', readyDocumentId),
      citation('S2', deletingDocumentId),
      citation('S3', deletedDocumentId),
      citation('S4', otherTenantDocumentId),
    ] as const;
    const assistant = encryptedMessageWithCitations(
      key,
      'Answer [S1] [S2] [S3] [S4]',
      1n,
      citations,
    );
    const prisma = {
      tenantChatConversation: {
        findFirst: jest.fn().mockResolvedValue({
          id: conversationId,
          cacheEpoch: 1n,
        }),
      },
      tenantChatMessage: {
        findMany: jest.fn().mockResolvedValue([assistant]),
      },
      ragDocument: {
        findMany: jest.fn().mockResolvedValue([{
          publicId: readyDocumentId,
          id: internalReadyDocumentId,
          rawChunk,
        }]),
      },
    };
    const keys = {
      withKeyVersion: jest.fn(async (
        _tenantId: string,
        _version: number,
        operation: (contentKey: Buffer) => Promise<string> | string,
      ) => operation(key)),
    };
    const store = new EncryptedChatStore(
      prisma as never,
      keys as never,
      {} as never,
      {} as never,
    );

    const history = await store.listMessages(actor, conversationId, {
      limit: 10,
    });

    expect(prisma.ragDocument.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: actor.tenantId,
        publicId: {
          in: [
            readyDocumentId,
            deletingDocumentId,
            deletedDocumentId,
            otherTenantDocumentId,
          ],
        },
        status: 'READY',
      },
      select: { publicId: true },
    });
    expect(history.items[0]?.citations).toEqual([
      { ...citation('S1', readyDocumentId), availability: 'available' },
      { ...citation('S2', deletingDocumentId), availability: 'unavailable' },
      { ...citation('S3', deletedDocumentId), availability: 'unavailable' },
      { ...citation('S4', otherTenantDocumentId), availability: 'unavailable' },
    ]);
    const serialized = JSON.stringify(history);
    expect(serialized).not.toContain(internalReadyDocumentId);
    expect(serialized).not.toContain(rawChunk);
    expect(history.items[0]?.citations?.[0]).not.toHaveProperty('chunkId');
    expect(history.items[0]?.citations?.[0]).not.toHaveProperty('internalDocumentId');
  });
});

function bindingMac() {
  return {
    keyVersion: 1,
    mac: `hmac-sha256:${'A'.repeat(43)}`,
  };
}

function encryptedMessage(
  key: Buffer,
  role: 'user' | 'assistant',
  content: string,
  sequence: bigint,
) {
  const id = randomUUID();
  const turnId = randomUUID();
  const encrypted = encryptContent(key, content, {
    schemaVersion: 1,
    tenantId: actor.tenantId,
    conversationId,
    recordId: id,
    contentKind: 'message',
    role,
    contentKeyVersion: 1,
  });
  return {
    id,
    conversationId,
    tenantId: actor.tenantId,
    userId: actor.userId,
    turnId,
    requestId: randomUUID(),
    role,
    sequence,
    ciphertext: Uint8Array.from(encrypted.ciphertext),
    nonce: Uint8Array.from(encrypted.nonce),
    tag: Uint8Array.from(encrypted.tag),
    contentKeyVersion: 1,
    schemaVersion: 1,
    effectiveModelKey: role === 'assistant' ? 'mock-model' : null,
    expiresAt: null,
    createdAt: new Date(),
  };
}

function encryptedSanitizedMessage(key: Buffer, content: string, sequence: bigint) {
  const id = randomUUID();
  const turnId = randomUUID();
  const safetyPolicyDigest = `sha256:${'A'.repeat(43)}`;
  const encrypted = encryptContent(key, content, {
    schemaVersion: 2,
    tenantId: actor.tenantId,
    conversationId,
    recordId: id,
    contentKind: 'message',
    role: 'user',
    contentKeyVersion: 1,
    safetyStatus: 'sanitized',
    safetyPolicyDigest,
  });
  return {
    id,
    conversationId,
    tenantId: actor.tenantId,
    userId: actor.userId,
    turnId,
    requestId: randomUUID(),
    role: 'user',
    sequence,
    ciphertext: Uint8Array.from(encrypted.ciphertext),
    nonce: Uint8Array.from(encrypted.nonce),
    tag: Uint8Array.from(encrypted.tag),
    contentKeyVersion: 1,
    schemaVersion: 2,
    safetyStatus: 'sanitized',
    safetyPolicyDigest,
    expiresAt: null,
    createdAt: new Date(),
  };
}

function encryptedMessageWithCitations(
  key: Buffer,
  content: string,
  sequence: bigint,
  citations: readonly RagCitation[],
) {
  const message = encryptedMessage(key, 'assistant', content, sequence);
  const encrypted = encryptContent(
    key,
    citationSnapshotJson(citations),
    createMessageCitationsAad(actor.tenantId, conversationId, message.id, 1),
  );
  return {
    ...message,
    citationCiphertext: Uint8Array.from(encrypted.ciphertext),
    citationNonce: Uint8Array.from(encrypted.nonce),
    citationTag: Uint8Array.from(encrypted.tag),
    citationContentKeyVersion: encrypted.contentKeyVersion,
    citationSchemaVersion: encrypted.schemaVersion,
  };
}

function citation(sourceId: `S${number}`, documentId: string): RagCitation {
  return {
    sourceId,
    documentId,
    displayName: `${sourceId}.txt`,
    pageStart: null,
    pageEnd: null,
    lineStart: 1,
    lineEnd: 2,
    ordinal: Number(sourceId.slice(1)),
  };
}

function contentKeys(key: Buffer) {
  return {
    withKeyVersion: jest.fn(async (
      _tenantId: string,
      _version: number,
      operation: (contentKey: Buffer) => Promise<string> | string,
    ) => operation(key)),  };
}
