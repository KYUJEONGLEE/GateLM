import { randomUUID } from 'node:crypto';

import {
  MAX_EPHEMERAL_MESSAGE_CHARACTERS,
  type ClientUsageIntent,
} from '@/execution/execution.types';

import { ConversationNotFound } from './chat-store.errors';
import { encryptContent } from './content-crypto';
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
    const store = new EncryptedChatStore(
      prisma as never,
      {} as never,
      { sign: jest.fn().mockResolvedValue(bindingMac()) } as never,
      {} as never,
    );

    await expect(store.reserveTurn(actor, conversationId, {
      idempotencyKey: 'idempotency-key-0001',
      content: '<synthetic>',
      usageIntent,
    })).rejects.toBeInstanceOf(ConversationNotFound);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.tenantChatTurn.create).not.toHaveBeenCalled();
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
    const currentUser = encryptedMessage(key, 'user', '<current>', 4n);
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
        findMany: jest.fn().mockResolvedValue([currentUser, oversizedAssistant, olderUser]),
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

    await expect(store.completionHistory(actor, conversationId, currentUser.turnId))
      .resolves.toEqual([{ role: 'user', content: '<current>' }]);
    expect(keys.withKeyVersion).toHaveBeenCalledTimes(2);
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
