const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/;
const CURSOR = /^[A-Za-z0-9_.-]{32,2048}$/;
const ERROR_CODE = /^CHAT_[A-Z0-9_]{1,59}$/;
const MODEL_KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const POLICY_STATES = Object.freeze(['normal', 'warning', 'economy', 'blocked']);
const POLICY_RANK = Object.freeze({ normal: 0, warning: 1, economy: 2, blocked: 3 });

export class ConversationContractError extends Error {
  constructor(message = '요청 형식이 올바르지 않습니다.') {
    super(message);
    this.code = 'CHAT_INVALID_REQUEST';
    this.status = 400;
  }
}

export function conversationId(value) {
  if (typeof value !== 'string' || !UUID_V4.test(value)) invalid();
  return value;
}

export function turnId(value) {
  return conversationId(value);
}

export function parsePageQuery(url, maximum, fallback) {
  const search = new URL(url).searchParams;
  const entries = [...search];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) invalid();
  exactKeys(Object.fromEntries(entries), ['cursor', 'limit'], ['cursor', 'limit']);
  const cursor = search.get('cursor') ?? undefined;
  if (cursor !== undefined && !CURSOR.test(cursor)) invalid();
  const rawLimit = search.get('limit');
  const limit = rawLimit === null ? fallback : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum || (rawLimit !== null && String(limit) !== rawLimit)) invalid();
  return Object.freeze({ cursor, limit });
}

export function assertNoQuery(url) {
  if ([...new URL(url).searchParams].length) invalid();
}

export function assertExactOrigin(request, expectedOrigin) {
  if (request.headers.get('origin') !== expectedOrigin) forbidden('CHAT_ORIGIN_REJECTED');
}

export function assertDoubleSubmitCsrf(request, cookieValue) {
  const header = request.headers.get('x-gatelm-csrf');
  if (typeof cookieValue !== 'string' || typeof header !== 'string' || !constantTimeTextEqual(cookieValue, header)) {
    forbidden('CHAT_CSRF_REJECTED');
  }
}

export function parseIfMatch(value) {
  if (typeof value !== 'string' || !/^"[1-9][0-9]*"$/.test(value)) invalid('대화 버전 정보가 올바르지 않습니다.');
  const version = Number(value.slice(1, -1));
  if (!Number.isSafeInteger(version)) invalid('대화 버전 정보가 올바르지 않습니다.');
  return version;
}

export function createConversationBody(value) {
  const body = record(value, ['idempotencyKey', 'title']);
  if (typeof body.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(body.idempotencyKey)) invalid();
  const title = titleValue(body.title);
  return Object.freeze({ idempotencyKey: body.idempotencyKey, title });
}

export function renameConversationBody(value) {
  const body = record(value, ['expectedVersion', 'title']);
  if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1) invalid();
  return Object.freeze({ expectedVersion: body.expectedVersion, title: titleValue(body.title) });
}

export function createTurnBody(value) {
  const body = record(value, ['content', 'idempotencyKey', 'usageIntent']);
  if (typeof body.idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(body.idempotencyKey)) invalid();
  if (typeof body.content !== 'string' || body.content.length < 1 || body.content.length > 20_000) invalid();
  const intent = record(body.usageIntent, ['cacheStrategy', 'maxOutputTokens', 'requestedTier']);
  if (!Number.isSafeInteger(intent.maxOutputTokens) || intent.maxOutputTokens < 1 || intent.maxOutputTokens > 8192) invalid();
  if (!['auto', 'high_quality', 'standard', 'economy'].includes(intent.requestedTier)) invalid();
  if (!['off', 'exact'].includes(intent.cacheStrategy)) invalid();
  return Object.freeze({
    content: body.content,
    idempotencyKey: body.idempotencyKey,
    usageIntent: Object.freeze({
      cacheStrategy: intent.cacheStrategy,
      maxOutputTokens: intent.maxOutputTokens,
      requestedTier: intent.requestedTier,
    }),
  });
}

export function conversationView(value) {
  const source = record(value, ['createdAt', 'historyRetentionDays', 'id', 'title', 'updatedAt', 'version']);
  if (!UUID_V4.test(source.id) || typeof source.title !== 'string' || source.title.length < 1 || source.title.length > 120) upstreamInvalid();
  if (!Number.isSafeInteger(source.version) || source.version < 1 || !Number.isSafeInteger(source.historyRetentionDays) || source.historyRetentionDays < 1) upstreamInvalid();
  if (!validDate(source.createdAt) || !validDate(source.updatedAt)) upstreamInvalid();
  return Object.freeze({
    id: source.id,
    title: source.title,
    version: source.version,
    historyRetentionDays: source.historyRetentionDays,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  });
}

export function conversationPage(value) {
  const source = record(value, ['items', 'nextCursor']);
  if (!Array.isArray(source.items) || source.items.length > 50 || (source.nextCursor !== null && (typeof source.nextCursor !== 'string' || !CURSOR.test(source.nextCursor)))) upstreamInvalid();
  return Object.freeze({ items: Object.freeze(source.items.map(conversationView)), nextCursor: source.nextCursor });
}

export function messagePage(value) {
  const source = record(value, ['items', 'nextCursor']);
  if (!Array.isArray(source.items) || source.items.length > 100 || (source.nextCursor !== null && (typeof source.nextCursor !== 'string' || !CURSOR.test(source.nextCursor)))) upstreamInvalid();
  return Object.freeze({ items: Object.freeze(source.items.map(messageView)), nextCursor: source.nextCursor });
}

export function cancelResult(value) {
  const source = record(value, ['cancelled']);
  if (typeof source.cancelled !== 'boolean') upstreamInvalid();
  return Object.freeze({ cancelled: source.cancelled });
}

export function strongestPolicyState(quotaState = 'normal', budgetState = 'normal') {
  if (!isPolicyState(quotaState) || !isPolicyState(budgetState)) throw new Error('Invalid policy state.');
  return POLICY_RANK[quotaState] >= POLICY_RANK[budgetState] ? quotaState : budgetState;
}

export function isBlockedCode(code) {
  return code === 'CHAT_QUOTA_HARD_LIMIT' || code === 'CHAT_BUDGET_HARD_LIMIT';
}

export function safeChatError(value) {
  const code = value && typeof value === 'object' && !Array.isArray(value) && typeof value.code === 'string' && ERROR_CODE.test(value.code)
    ? value.code
    : 'CHAT_INTERNAL_ERROR';
  const retryAfterSeconds = value && typeof value === 'object' && !Array.isArray(value) &&
    Number.isSafeInteger(value.retryAfterSeconds) && value.retryAfterSeconds >= 1 && value.retryAfterSeconds <= 60
    ? value.retryAfterSeconds
    : undefined;
  return Object.freeze({ code, message: safeMessage(code), ...(retryAfterSeconds ? { retryAfterSeconds } : {}) });
}

export async function consumeTurnSse(stream, options) {
  if (!stream) throw new Error('응답 스트림을 열 수 없습니다.');
  const reader = stream.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const encoder = new TextEncoder();
  let buffer = '';
  let bufferByteLength = 0;
  let expectedSequence = 1;
  let acceptedTurnId;
  let terminal;
  let completed = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const decoded = decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
      buffer += decoded;
      bufferByteLength += encoder.encode(decoded).byteLength;
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frameByteLength = encoder.encode(frame).byteLength;
        bufferByteLength -= frameByteLength + 2;
        if (!frame) continue;
        const event = parseFrame(frame, frameByteLength, options.conversationId, acceptedTurnId, expectedSequence);
        acceptedTurnId ??= event.turnId;
        expectedSequence += 1;
        if (terminal) throw new Error('Terminal SSE event must be last.');
        if (event.type === 'chat.turn.accepted') options.onAccepted?.(event);
        else if (event.type === 'chat.turn.delta') options.onDelta?.(event.delta, event);
        else {
          terminal = event;
          options.onTerminal?.(event);
        }
      }
      if (bufferByteLength > 128 * 1024) throw new Error('SSE frame limit exceeded.');
    }
    const tail = decoder.decode().replaceAll('\r\n', '\n');
    buffer += tail;
    bufferByteLength += encoder.encode(tail).byteLength;
    if (bufferByteLength > 128 * 1024) throw new Error('SSE frame limit exceeded.');
    if (buffer.trim()) throw new Error('Incomplete SSE frame.');
    if (!acceptedTurnId || !terminal) throw new Error('Incomplete SSE sequence.');
    completed = true;
    return terminal;
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function parseFrame(frame, frameByteLength, expectedConversationId, expectedTurnId, expectedSequence) {
  if (frameByteLength > 64 * 1024) throw new Error('SSE frame limit exceeded.');
  const fields = Object.create(null);
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const separator = line.indexOf(':');
    if (separator < 1) throw new Error('Invalid SSE field.');
    const name = line.slice(0, separator);
    const value = line.slice(separator + 1).replace(/^ /, '');
    if (!['id', 'event', 'data'].includes(name) || fields[name] !== undefined) throw new Error('Invalid SSE field.');
    fields[name] = value;
  }
  if (!fields.id || !fields.event || !fields.data) throw new Error('Incomplete SSE event.');
  let event;
  try { event = JSON.parse(fields.data); } catch { throw new Error('Invalid SSE data.'); }
  if (!event || Array.isArray(event) || typeof event !== 'object') throw new Error('Invalid SSE data.');
  const common = ['conversationId', 'schemaVersion', 'sequence', 'turnId', 'type'];
  const extras = event.type === 'chat.turn.accepted' ? ['replayed']
    : event.type === 'chat.turn.delta' ? ['delta']
      : event.type === 'chat.turn.final' ? ['budgetState', 'cacheOutcome', 'effectiveModelKey', 'messageId', 'quotaState', 'replayed', 'terminalOutcome']
        : ['error'];
  exactKeys(event, [...common, ...extras], event.type === 'chat.turn.final' ? ['budgetState', 'cacheOutcome', 'effectiveModelKey', 'quotaState'] : []);
  if (fields.event !== event.type || event.schemaVersion !== 1 || event.conversationId !== expectedConversationId || !UUID_V4.test(event.turnId)) throw new Error('Mismatched SSE event.');
  if (expectedTurnId && event.turnId !== expectedTurnId) throw new Error('Mismatched SSE turn.');
  if (event.sequence !== expectedSequence || fields.id !== `${event.turnId}:${event.sequence}`) throw new Error('Invalid SSE sequence.');
  if (expectedSequence === 1 && (event.type !== 'chat.turn.accepted' || event.replayed !== Boolean(event.replayed))) throw new Error('Accepted SSE event must be first.');
  if (expectedSequence > 1 && event.type === 'chat.turn.accepted') throw new Error('Duplicate accepted SSE event.');
  if (event.type === 'chat.turn.delta' && (typeof event.delta !== 'string' || !event.delta || event.delta.length > 16_384)) throw new Error('Invalid SSE delta.');
  if (event.type === 'chat.turn.final') {
    if (!UUID_V4.test(event.messageId) || event.terminalOutcome !== 'succeeded' || typeof event.replayed !== 'boolean') throw new Error('Invalid final SSE event.');
    if (event.effectiveModelKey !== undefined && (typeof event.effectiveModelKey !== 'string' || !MODEL_KEY.test(event.effectiveModelKey))) throw new Error('Invalid effective model key.');
    if (event.cacheOutcome !== undefined && !['off', 'hit', 'miss'].includes(event.cacheOutcome)) throw new Error('Invalid cache outcome.');
    if (event.quotaState !== undefined && !isPolicyState(event.quotaState)) throw new Error('Invalid policy state.');
    if (event.budgetState !== undefined && !isPolicyState(event.budgetState)) throw new Error('Invalid policy state.');
    if ((event.quotaState === undefined) !== (event.budgetState === undefined)) throw new Error('Incomplete policy state.');
  }
  if (event.type === 'chat.turn.error' || event.type === 'chat.turn.cancelled') {
    event.error = safeErrorEvent(event.error);
    if (event.type === 'chat.turn.cancelled' && event.error.code !== 'CHAT_REQUEST_CANCELLED') throw new Error('Invalid cancelled SSE event.');
  } else if (!['chat.turn.accepted', 'chat.turn.delta', 'chat.turn.final'].includes(event.type)) {
    throw new Error('Unknown SSE event.');
  }
  return Object.freeze(event);
}

function safeErrorEvent(value) {
  const source = record(value, ['code', 'message', 'retryAfterSeconds'], ['retryAfterSeconds']);
  if (typeof source.code !== 'string' || !ERROR_CODE.test(source.code) || typeof source.message !== 'string' || source.message.length < 1 || source.message.length > 256) throw new Error('Invalid SSE error.');
  if (source.retryAfterSeconds !== undefined && (!Number.isSafeInteger(source.retryAfterSeconds) || source.retryAfterSeconds < 1 || source.retryAfterSeconds > 60)) throw new Error('Invalid SSE retry.');
  return safeChatError(source);
}

function titleValue(value) {
  if (typeof value !== 'string') invalid();
  const title = value.trim();
  if (!title || title.length > 120) invalid();
  return title;
}

function messageView(value) {
  const source = record(value, ['content', 'createdAt', 'id', 'role', 'sequence', 'turnId'], ['effectiveModelKey']);
  if (!UUID_V4.test(source.id) || !UUID_V4.test(source.turnId) || !['user', 'assistant'].includes(source.role)) upstreamInvalid();
  if (typeof source.content !== 'string' || source.content.length > 1_048_576 || !Number.isSafeInteger(source.sequence) || source.sequence < 1 || !validDate(source.createdAt)) upstreamInvalid();
  if (source.effectiveModelKey !== undefined && (source.role !== 'assistant' || typeof source.effectiveModelKey !== 'string' || !MODEL_KEY.test(source.effectiveModelKey))) upstreamInvalid();
  return Object.freeze({
    id: source.id,
    turnId: source.turnId,
    role: source.role,
    content: source.content,
    ...(source.effectiveModelKey ? { effectiveModelKey: source.effectiveModelKey } : {}),
    sequence: source.sequence,
    createdAt: source.createdAt,
  });
}

function record(value, required, optional = []) {
  if (!value || Array.isArray(value) || typeof value !== 'object') invalid();
  exactKeys(value, [...required, ...optional], optional);
  return value;
}

function exactKeys(value, allowed, optional = []) {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.includes(key)) || allowed.some((key) => !optional.includes(key) && !keys.includes(key))) invalid();
}

function isPolicyState(value) {
  return POLICY_STATES.includes(value);
}

function safeMessage(code) {
  if (isBlockedCode(code)) return '사용 한도에 도달했습니다. 조직 관리자에게 문의해 주세요.';
  if (code === 'CHAT_SAFETY_BLOCKED') return '안전 정책에 따라 이 요청에는 답변할 수 없습니다.';
  if (code === 'CHAT_RATE_LIMITED') return '요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  if (code === 'CHAT_CONCURRENCY_LIMITED') return '진행 중인 요청이 많습니다. 잠시 후 다시 시도해 주세요.';
  if (['CHAT_PROVIDER_FAILED', 'CHAT_PROVIDER_TIMEOUT', 'CHAT_NO_ELIGIBLE_ROUTE'].includes(code)) return '답변 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  if (['CHAT_RUNTIME_UNAVAILABLE', 'CHAT_USAGE_GUARD_UNAVAILABLE', 'CHAT_ENTITLEMENT_UNAVAILABLE'].includes(code)) return '조직의 AI 실행 설정을 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  if (['CHAT_STORAGE_UNAVAILABLE', 'CHAT_CONTENT_KEY_UNAVAILABLE', 'CHAT_CONTENT_INTEGRITY_FAILED'].includes(code)) return '대화 기록을 안전하게 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.';
  if (code === 'CHAT_REQUEST_CANCELLED') return '답변 생성을 중지했습니다.';
  if (code === 'CHAT_AUTH_REQUIRED' || code === 'CHAT_ACCESS_STALE') return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
  if (code === 'CHAT_CONVERSATION_VERSION_CONFLICT') return '대화가 다른 곳에서 변경되었습니다. 새로고침 후 다시 시도해 주세요.';
  if (code === 'CHAT_CONVERSATION_NOT_FOUND') return '대화를 찾을 수 없습니다.';
  if (code === 'CHAT_CURSOR_INVALID') return '대화 목록이 변경되었습니다. 새로고침해 주세요.';
  return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
}

function validDate(value) {
  return typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
}

function upstreamInvalid() {
  const error = new ConversationContractError('대화 서비스 응답을 안전하게 처리할 수 없습니다.');
  error.code = 'CHAT_UPSTREAM_INVALID';
  error.status = 502;
  throw error;
}

function invalid(message) {
  throw new ConversationContractError(message);
}

function forbidden(code) {
  const error = new ConversationContractError('보안 확인이 만료되었습니다. 페이지를 새로고침해 주세요.');
  error.code = code;
  error.status = 403;
  throw error;
}

function constantTimeTextEqual(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}
