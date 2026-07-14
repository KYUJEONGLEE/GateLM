import { NestFactory } from '@nestjs/core';
import { randomBytes, randomUUID } from 'node:crypto';

import { AppModule } from '@/app.module';
import { PrismaService } from '@/database/prisma.service';

import { RetentionService } from './retention.service';
import { TenantContentKeyService } from './tenant-content-key.service';
import { WrappingKeyProvider } from './wrapping-key-provider';

const BASE_URL = 'http://127.0.0.1:3003';
const TENANT_ID = '00000000-0000-4000-8000-000000000100';
const PRIMARY_USER_ID = '00000000-0000-4000-8000-000000000900';
const SERVICE_TOKEN = required('TENANT_CHAT_WEB_SERVICE_TOKEN');
const MARKER = process.env.TENANT_CHAT_SMOKE_MARKER || `smoke-${randomBytes(32).toString('base64url')}`;
const USAGE_INTENT = Object.freeze({
  estimatedInputTokens: 16,
  maxOutputTokens: 64,
  requestedTier: 'standard',
  cacheStrategy: 'exact',
});

async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  try {
    const prisma = app.get(PrismaService);
    const legacyBefore = await legacyCounts(prisma);
    const primary = await login('tenant-chat-smoke@example.invalid');
    const foreign = await login('tenant-chat-idor-smoke@example.invalid');

    const createKey = opaque();
    const created = await apiJson('POST', '/internal/v1/tenant-chat/conversations', primary, {
      idempotencyKey: createKey,
      title: `${MARKER}-title-primary`,
    }, 201);
    const conversationId = stringField(created, 'id');
    const initialVersion = numberField(created, 'version');

    const createReplay = await apiJson('POST', '/internal/v1/tenant-chat/conversations', primary, {
      idempotencyKey: createKey,
      title: `${MARKER}-title-primary`,
    }, 200);
    assert(stringField(createReplay, 'id') === conversationId, 'CreateReplayIdentity');
    await apiStatus('POST', '/internal/v1/tenant-chat/conversations', primary, 409, {
      idempotencyKey: createKey,
      title: `${MARKER}-title-conflict`,
    });
    await apiStatus('GET', `/internal/v1/tenant-chat/conversations/${conversationId}`, foreign, 404);

    const pageConversation = await createConversation(primary, `${MARKER}-title-page`);
    const firstPage = await apiJson('GET', '/internal/v1/tenant-chat/conversations?limit=1', primary, undefined, 200);
    const cursor = stringField(firstPage, 'nextCursor');
    await apiStatus('GET', `/internal/v1/tenant-chat/conversations?limit=1&cursor=${tamper(cursor)}`, primary, 400);

    const renamed = await apiJson('PATCH', `/internal/v1/tenant-chat/conversations/${conversationId}`, primary, {
      title: `${MARKER}-title-renamed`,
      expectedVersion: initialVersion,
    }, 200);
    const renamedVersion = numberField(renamed, 'version');
    await apiStatus('PATCH', `/internal/v1/tenant-chat/conversations/${conversationId}`, primary, 409, {
      title: `${MARKER}-title-stale`,
      expectedVersion: initialVersion,
    });

    const beforeRotation = await prisma.tenantChatConversation.findUniqueOrThrow({ where: { id: conversationId } });
    const oldContentKeyVersion = beforeRotation.titleContentKeyVersion!;
    const newContentKeyVersion = await app.get(TenantContentKeyService).rotateContentKey(TENANT_ID);
    assert(newContentKeyVersion > oldContentKeyVersion, 'ContentKeyRotation');
    await apiStatus('GET', `/internal/v1/tenant-chat/conversations/${conversationId}`, primary, 200);
    const swapOne = await createConversation(primary, `${MARKER}-title-swap-one`);
    const swapTwo = await createConversation(primary, `${MARKER}-title-swap-two`);

    const turnBody = {
      idempotencyKey: opaque(),
      content: `${MARKER}-prompt-primary`,
      usageIntent: USAGE_INTENT,
    };
    const [firstTurn, attachedTurn] = await Promise.all([
      apiSse(`/internal/v1/tenant-chat/conversations/${conversationId}/turns`, primary, turnBody),
      apiSse(`/internal/v1/tenant-chat/conversations/${conversationId}/turns`, primary, turnBody),
    ]);
    const firstAccepted = accepted(firstTurn);
    const attachedAccepted = accepted(attachedTurn);
    assert(firstAccepted.turnId === attachedAccepted.turnId, 'ConcurrentTurnIdentity');
    const firstFinal = final(firstTurn);
    const attachedFinal = final(attachedTurn);
    assert(firstFinal.messageId === attachedFinal.messageId, 'ConcurrentFinalIdentity');
    assert(firstTurn.some((event) => event.type === 'chat.turn.delta'), 'TurnDeltaMissing');
    assert(attachedTurn.some((event) => event.type === 'chat.turn.delta'), 'AttachedDeltaMissing');

    const turn = await prisma.tenantChatTurn.findUniqueOrThrow({ where: { id: firstAccepted.turnId as string } });
    assert(turn.state === 'completed', 'TurnNotCompleted');
    assert(await prisma.tenantChatTurn.count({ where: { tenantId: TENANT_ID, userId: PRIMARY_USER_ID, idempotencyKey: turnBody.idempotencyKey } }) === 1, 'TurnDuplicateRow');
    assert(await prisma.tenantChatMessage.count({ where: { turnId: turn.id } }) === 2, 'TurnMessageCardinality');
    assert(await prisma.tenantChatProviderAttempt.count({ where: { requestId: turn.requestId } }) === 1, 'ProviderReplayDuplicated');
    assert(await prisma.tenantChatMessage.count({ where: { id: firstFinal.messageId as string, role: 'assistant' } }) === 1, 'FinalBeforeCiphertextCommit');

    const terminalReplay = await apiSse(`/internal/v1/tenant-chat/conversations/${conversationId}/turns`, primary, turnBody);
    assert(accepted(terminalReplay).turnId === turn.id, 'TerminalReplayTurnIdentity');
    assert(accepted(terminalReplay).replayed === true, 'TerminalReplayFlag');
    assert(final(terminalReplay).messageId === firstFinal.messageId, 'TerminalReplayMessageIdentity');
    await apiStatus('POST', `/internal/v1/tenant-chat/conversations/${conversationId}/turns`, primary, 409, {
      ...turnBody,
      content: `${MARKER}-prompt-conflict`,
    });

    const historyFirst = await apiJson('GET', `/internal/v1/tenant-chat/conversations/${conversationId}/messages?limit=1`, primary, undefined, 200);
    const historyCursor = stringField(historyFirst, 'nextCursor');
    const historySecond = await apiJson('GET', `/internal/v1/tenant-chat/conversations/${conversationId}/messages?limit=1&cursor=${historyCursor}`, primary, undefined, 200);
    assert(arrayField(historyFirst, 'items').length === 1 && arrayField(historySecond, 'items').length === 1, 'HistoryPagination');
    await apiStatus('GET', `/internal/v1/tenant-chat/conversations/${conversationId}/messages?limit=1&cursor=${tamper(historyCursor)}`, primary, 400);
    await apiStatus('GET', `/internal/v1/tenant-chat/conversations/${conversationId}/messages`, foreign, 404);

    await assertRecordSwapFails(prisma, primary, swapOne, swapTwo);
    await assertTagTamperFails(prisma, primary, swapOne);
    await assertWrongKeyFails(prisma, primary, conversationId, oldContentKeyVersion, newContentKeyVersion);
    await assertKeyUnavailableFails(prisma, primary, conversationId, oldContentKeyVersion);
    await assertRollbackFloorFails(app.get(TenantContentKeyService), app.get(WrappingKeyProvider), prisma, primary, conversationId);

    const cancellationConversation = await createConversation(primary, `${MARKER}-title-cancel`);
    await assertCancellation(primary, cancellationConversation);

    const retentionConversation = await createConversation(primary, `${MARKER}-title-retention`);
    await prisma.tenantChatConversation.update({
      where: { id: retentionConversation },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    assert(await app.get(RetentionService).runOnce() >= 1, 'RetentionBatchEmpty');
    await apiStatus('GET', `/internal/v1/tenant-chat/conversations/${retentionConversation}`, primary, 404);
    const retained = await prisma.tenantChatConversation.findUniqueOrThrow({ where: { id: retentionConversation } });
    assert(retained.status === 'deleted' && !retained.titleCiphertext, 'RetentionTombstoneInvalid');

    await apiStatus('DELETE', `/internal/v1/tenant-chat/conversations/${conversationId}`, primary, 409, undefined, { 'if-match': `"${initialVersion}"` });
    await apiStatus('DELETE', `/internal/v1/tenant-chat/conversations/${conversationId}`, primary, 204, undefined, { 'if-match': `"${renamedVersion}"` });
    await apiStatus('DELETE', `/internal/v1/tenant-chat/conversations/${conversationId}`, primary, 204, undefined, { 'if-match': `"${renamedVersion}"` });
    await apiStatus('GET', `/internal/v1/tenant-chat/conversations/${conversationId}`, primary, 404);
    const tombstone = await prisma.tenantChatConversation.findUniqueOrThrow({ where: { id: conversationId } });
    assert(tombstone.status === 'deleted' && !tombstone.titleCiphertext && tombstone.cacheEpoch > beforeRotation.cacheEpoch, 'DeleteTombstoneInvalid');
    assert(await prisma.tenantChatMessage.count({ where: { conversationId } }) === 0, 'DeleteCiphertextRemains');

    await apiStatus('DELETE', `/internal/v1/tenant-chat/conversations/${pageConversation}`, primary, 204, undefined, { 'if-match': '"1"' });
    assert(!(await plaintextPresent(prisma)), 'DatabasePlaintextLeak');
    const legacyAfter = await legacyCounts(prisma);
    assert(legacyAfter.conversations === legacyBefore.conversations && legacyAfter.messages === legacyBefore.messages, 'LegacyDualWrite');

    process.stdout.write(`${JSON.stringify({
      status: 'ok',
      api: true,
      sse: true,
      idempotency: true,
      idor: true,
      encryption: true,
      retention: true,
      databasePlaintext: false,
      legacyDualWrite: false,
    })}\n`);
  } finally {
    await app.close();
  }
}

async function login(email: string): Promise<string> {
  const value = await apiJson('POST', '/internal/v1/tenant-chat/auth/password', undefined, {
    email,
    password: 'tenant-chat-local-smoke-password',
    deviceId: `smoke-device-${randomUUID()}`,
  }, 201);
  return stringField(value, 'accessToken');
}

async function createConversation(accessToken: string, title: string): Promise<string> {
  const value = await apiJson('POST', '/internal/v1/tenant-chat/conversations', accessToken, {
    idempotencyKey: opaque(),
    title,
  }, 201);
  return stringField(value, 'id');
}

async function assertCancellation(accessToken: string, conversationId: string): Promise<void> {
  const response = await apiRaw('POST', `/internal/v1/tenant-chat/conversations/${conversationId}/turns`, accessToken, {
    idempotencyKey: opaque(),
    content: `${MARKER}-prompt-cancel`,
    usageIntent: USAGE_INTENT,
  });
  assert(response.status === 200 && response.body, 'CancelStreamStart');
  const reader = response.body!.getReader();
  let text = '';
  while (!text.includes('\n\n')) {
    const next = await reader.read();
    assert(!next.done && !!next.value, 'CancelAcceptedMissing');
    text += new TextDecoder().decode(next.value);
  }
  const initial = parseSse(text.slice(0, text.indexOf('\n\n') + 2), false);
  const acceptedEvent = accepted(initial);
  await apiStatus('POST', `/internal/v1/tenant-chat/conversations/${conversationId}/turns/${acceptedEvent.turnId}/cancel`, accessToken, 200);
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    if (next.value) text += new TextDecoder().decode(next.value);
  }
  const terminal = parseSse(text).at(-1);
  assert(terminal?.type === 'chat.turn.cancelled', 'CancelTerminalMissing');
}

async function assertRecordSwapFails(
  prisma: PrismaService,
  accessToken: string,
  firstId: string,
  secondId: string,
): Promise<void> {
  const [first, second] = await Promise.all([
    prisma.tenantChatConversation.findUniqueOrThrow({ where: { id: firstId } }),
    prisma.tenantChatConversation.findUniqueOrThrow({ where: { id: secondId } }),
  ]);
  try {
    await prisma.$transaction([
      prisma.tenantChatConversation.update({ where: { id: firstId }, data: encryptedTitle(second) }),
      prisma.tenantChatConversation.update({ where: { id: secondId }, data: encryptedTitle(first) }),
    ]);
    await apiStatus('GET', `/internal/v1/tenant-chat/conversations/${firstId}`, accessToken, 500);
    await apiStatus('GET', `/internal/v1/tenant-chat/conversations/${secondId}`, accessToken, 500);
  } finally {
    await prisma.$transaction([
      prisma.tenantChatConversation.update({ where: { id: firstId }, data: encryptedTitle(first) }),
      prisma.tenantChatConversation.update({ where: { id: secondId }, data: encryptedTitle(second) }),
    ]);
  }
}

async function assertTagTamperFails(prisma: PrismaService, accessToken: string, conversationId: string): Promise<void> {
  const row = await prisma.tenantChatConversation.findUniqueOrThrow({ where: { id: conversationId } });
  const changed = Buffer.from(row.titleTag!);
  changed[0] ^= 0xff;
  try {
    await prisma.tenantChatConversation.update({ where: { id: conversationId }, data: { titleTag: Uint8Array.from(changed) } });
    await apiStatus('GET', `/internal/v1/tenant-chat/conversations/${conversationId}`, accessToken, 500);
  } finally {
    await prisma.tenantChatConversation.update({ where: { id: conversationId }, data: { titleTag: row.titleTag } });
  }
}

async function assertWrongKeyFails(
  prisma: PrismaService,
  accessToken: string,
  conversationId: string,
  originalVersion: number,
  wrongVersion: number,
): Promise<void> {
  try {
    await prisma.tenantChatConversation.update({ where: { id: conversationId }, data: { titleContentKeyVersion: wrongVersion } });
    await apiStatus('GET', `/internal/v1/tenant-chat/conversations/${conversationId}`, accessToken, 500);
  } finally {
    await prisma.tenantChatConversation.update({ where: { id: conversationId }, data: { titleContentKeyVersion: originalVersion } });
  }
}

async function assertKeyUnavailableFails(
  prisma: PrismaService,
  accessToken: string,
  conversationId: string,
  keyVersion: number,
): Promise<void> {
  const key = await prisma.tenantChatContentKey.findUniqueOrThrow({
    where: { tenantId_contentKeyVersion: { tenantId: TENANT_ID, contentKeyVersion: keyVersion } },
  });
  try {
    await prisma.tenantChatContentKey.update({
      where: { tenantId_contentKeyVersion: { tenantId: TENANT_ID, contentKeyVersion: keyVersion } },
      data: { status: 'retired', retiredAt: new Date() },
    });
    await apiStatus('GET', `/internal/v1/tenant-chat/conversations/${conversationId}`, accessToken, 503);
  } finally {
    await prisma.tenantChatContentKey.update({
      where: { tenantId_contentKeyVersion: { tenantId: TENANT_ID, contentKeyVersion: keyVersion } },
      data: { status: key.status, retiredAt: key.retiredAt },
    });
  }
}

async function assertRollbackFloorFails(
  contentKeys: TenantContentKeyService,
  wrappingKeys: WrappingKeyProvider,
  prisma: PrismaService,
  accessToken: string,
  conversationId: string,
): Promise<void> {
  const state = await prisma.tenantChatContentKeyState.findUniqueOrThrow({ where: { tenantId: TENANT_ID } });
  const activeWrappingVersion = (await wrappingKeys.load()).activeVersion;
  try {
    await prisma.tenantChatContentKeyState.update({
      where: { tenantId: TENANT_ID },
      data: { wrappingKeyRollbackFloor: activeWrappingVersion + 1 },
    });
    assert(!(await contentKeys.isReady()), 'RollbackFloorReadiness');
    await apiStatus('GET', `/internal/v1/tenant-chat/conversations/${conversationId}`, accessToken, 503);
  } finally {
    await prisma.tenantChatContentKeyState.update({
      where: { tenantId: TENANT_ID },
      data: { wrappingKeyRollbackFloor: state.wrappingKeyRollbackFloor },
    });
  }
}

async function plaintextPresent(prisma: PrismaService): Promise<boolean> {
  const tables = await prisma.$queryRaw<Array<{ tableName: string }>>`
    SELECT table_name AS "tableName"
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name LIKE 'tenant_chat_%'
  `;
  for (const { tableName } of tables) {
    assert(/^[a-z0-9_]+$/.test(tableName), 'LeakScanTableName');
    const rows = await prisma.$queryRawUnsafe<Array<{ found: boolean }>>(
      `SELECT EXISTS (SELECT 1 FROM "${tableName}" AS t WHERE to_jsonb(t)::text LIKE $1) AS found`,
      `%${MARKER}%`,
    );
    if (rows[0]?.found) return true;
  }
  return false;
}

async function legacyCounts(prisma: PrismaService) {
  return {
    conversations: await prisma.conversation.count({ where: { tenantId: TENANT_ID } }),
    messages: await prisma.chatMessage.count({ where: { tenantId: TENANT_ID } }),
  };
}

function encryptedTitle(row: Readonly<{
  titleCiphertext: Uint8Array | null;
  titleNonce: Uint8Array | null;
  titleTag: Uint8Array | null;
  titleContentKeyVersion: number | null;
  titleSchemaVersion: number | null;
}>) {
  return {
    titleCiphertext: copyBytes(row.titleCiphertext),
    titleNonce: copyBytes(row.titleNonce),
    titleTag: copyBytes(row.titleTag),
    titleContentKeyVersion: row.titleContentKeyVersion,
    titleSchemaVersion: row.titleSchemaVersion,
  };
}

function copyBytes(value: Uint8Array | null): Uint8Array<ArrayBuffer> | null {
  return value ? Uint8Array.from(value) as Uint8Array<ArrayBuffer> : null;
}

async function apiSse(path: string, accessToken: string, body: unknown): Promise<SseEvent[]> {
  const response = await apiRaw('POST', path, accessToken, body);
  assert(response.status === 200, 'SseHttpStatus');
  assert(response.headers.get('content-type')?.startsWith('text/event-stream') === true, 'SseContentType');
  return parseSse(await response.text());
}

function parseSse(text: string, requireTerminal = true): SseEvent[] {
  const frames = text.replace(/\r\n/g, '\n').split('\n\n').filter(Boolean);
  const events = frames.map((frame) => {
    const lines = frame.split('\n');
    assert(lines.length === 3 && lines[0].startsWith('id: ') && lines[1].startsWith('event: ') && lines[2].startsWith('data: '), 'SseFrameShape');
    const value = JSON.parse(lines[2].slice(6)) as SseEvent;
    assert(lines[0].slice(4) === `${value.turnId}:${value.sequence}` && lines[1].slice(7) === value.type, 'SseFrameBinding');
    return value;
  });
  for (const [index, event] of events.entries()) assert(event.sequence === index + 1, 'SseSequence');
  assert(events[0]?.type === 'chat.turn.accepted', 'SseAcceptedOrder');
  if (requireTerminal) {
    assert(['chat.turn.final', 'chat.turn.error', 'chat.turn.cancelled'].includes(events.at(-1)?.type ?? ''), 'SseTerminalOrder');
  }
  return events;
}

function accepted(events: SseEvent[]): SseEvent {
  const value = events[0];
  assert(value?.type === 'chat.turn.accepted' && value.sequence === 1, 'AcceptedEvent');
  return value;
}

function final(events: SseEvent[]): SseEvent {
  const value = events.at(-1);
  assert(value?.type === 'chat.turn.final', 'FinalEvent');
  return value;
}

async function apiJson(
  method: string,
  path: string,
  accessToken: string | undefined,
  body: unknown,
  expectedStatus: number,
  extraHeaders: Record<string, string> = {},
): Promise<Record<string, unknown>> {
  const response = await apiRaw(method, path, accessToken, body, extraHeaders);
  assert(response.status === expectedStatus, 'ApiJsonStatus');
  const value = await response.json() as unknown;
  assert(isRecord(value), 'ApiJsonShape');
  return value;
}

async function apiStatus(
  method: string,
  path: string,
  accessToken: string | undefined,
  expectedStatus: number,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const response = await apiRaw(method, path, accessToken, body, extraHeaders);
  assert(response.status === expectedStatus, 'ApiStatus');
  await response.body?.cancel();
}

function apiRaw(
  method: string,
  path: string,
  accessToken?: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    method,
    redirect: 'error',
    headers: {
      'x-gatelm-chat-web-service-token': SERVICE_TOKEN,
      ...(accessToken ? { 'x-gatelm-chat-access': accessToken } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...extraHeaders,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(150_000),
  });
}

function stringField(value: Record<string, unknown>, name: string): string {
  const field = value[name];
  assert(typeof field === 'string', 'StringField');
  return field;
}

function numberField(value: Record<string, unknown>, name: string): number {
  const field = value[name];
  assert(typeof field === 'number' && Number.isSafeInteger(field), 'NumberField');
  return field;
}

function arrayField(value: Record<string, unknown>, name: string): unknown[] {
  const field = value[name];
  assert(Array.isArray(field), 'ArrayField');
  return field;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function tamper(value: string): string {
  const tail = value.at(-1);
  return `${value.slice(0, -1)}${tail === 'A' ? 'B' : 'A'}`;
}

function opaque(): string {
  return randomBytes(24).toString('base64url');
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error('SmokeConfigurationMissing');
  return value;
}

function assert(condition: unknown, name: string): asserts condition {
  if (!condition) {
    const error = new Error('Tenant Chat content smoke failed.');
    error.name = name;
    throw error;
  }
}

type SseEvent = Record<string, unknown> & {
  type: string;
  turnId: unknown;
  sequence: number;
  replayed?: unknown;
  messageId?: unknown;
};

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.name : 'TenantChatContentSmokeFailed'}\n`);
  process.exitCode = 1;
});
