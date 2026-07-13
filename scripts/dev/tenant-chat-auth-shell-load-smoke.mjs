import { performance } from 'node:perf_hooks';

const origin = required('TENANT_CHAT_SMOKE_ORIGIN').replace(/\/$/, '');
const email = required('TENANT_CHAT_SMOKE_EMAIL');
const password = required('TENANT_CHAT_SMOKE_PASSWORD');
const sessionCount = positiveInteger('TENANT_CHAT_SMOKE_SESSIONS', 500);
const bootstrapConcurrency = positiveInteger('TENANT_CHAT_SMOKE_BOOTSTRAP_CONCURRENCY', 12);
const sessionDurationSeconds = positiveInteger('TENANT_CHAT_SMOKE_SESSION_DURATION_SECONDS', 600);
const burstDurationSeconds = positiveInteger('TENANT_CHAT_SMOKE_BURST_DURATION_SECONDS', 60);
const loginDurationSeconds = positiveInteger('TENANT_CHAT_SMOKE_LOGIN_DURATION_SECONDS', 60);

const sessions = [];

console.log(`Tenant Chat load smoke: ${sessionCount} preauthenticated sessions`);
const bootstrap = await mapConcurrent(
  Array.from({ length: sessionCount }, (_, index) => index),
  bootstrapConcurrency,
  async () => {
    const startedAt = performance.now();
    const jar = await login();
    return { jar, latencyMs: performance.now() - startedAt };
  },
);
sessions.push(...bootstrap.map((item) => item.jar));
printSummary('bootstrap-login', bootstrap.map((item) => item.latencyMs), 0, bootstrap.length);

const steady = await runRatePhase('session-50rps', 50, sessionDurationSeconds, async (index) => {
  await authenticatedSession(sessions[index % sessions.length]);
});
const burst = await runRatePhase('session-100rps', 100, burstDurationSeconds, async (index) => {
  await authenticatedSession(sessions[index % sessions.length]);
});
const loginPhase = await runRatePhase('login-10rps', 10, loginDurationSeconds, async () => {
  sessions.push(await login());
});

const sessionLatencies = [...steady.latencies, ...burst.latencies];
const sessionErrors = steady.errors + burst.errors;
const sessionRequests = steady.requests + burst.requests;
const sessionP95 = percentile(sessionLatencies, 0.95);
const loginP95 = percentile(loginPhase.latencies, 0.95);
const sessionErrorRate = sessionRequests === 0 ? 1 : sessionErrors / sessionRequests;
const loginErrorRate = loginPhase.requests === 0 ? 1 : loginPhase.errors / loginPhase.requests;

console.log(JSON.stringify({
  login: { errorRate: rounded(loginErrorRate), p95Ms: rounded(loginP95), requests: loginPhase.requests },
  session: { errorRate: rounded(sessionErrorRate), p95Ms: rounded(sessionP95), requests: sessionRequests },
}));

if (sessionP95 > 500 || loginP95 > 1_500 || sessionErrorRate >= 0.01 || loginErrorRate >= 0.01) {
  console.error('Tenant Chat load smoke thresholds were not met.');
  process.exitCode = 1;
}

async function login() {
  const jar = new Map();
  const bootstrapResponse = await fetch(`${origin}/login`, { redirect: 'manual' });
  absorbCookies(jar, bootstrapResponse);
  if (!bootstrapResponse.ok) throw new Error(`login bootstrap failed (${bootstrapResponse.status})`);
  const csrf = jar.get('gatelm_chat_csrf');
  if (!csrf) throw new Error('CSRF bootstrap failed');

  const response = await fetch(`${origin}/api/tenant-chat/auth/login`, {
    body: JSON.stringify({ email, password }),
    headers: {
      'content-type': 'application/json',
      cookie: cookieHeader(jar),
      origin,
      'x-gatelm-csrf': csrf,
    },
    method: 'POST',
    redirect: 'manual',
  });
  absorbCookies(jar, response);
  if (!response.ok) throw new Error(`login failed (${response.status})`);
  if (!jar.has('gatelm_chat_access') || !jar.has('gatelm_chat_refresh')) {
    throw new Error('login did not issue the expected cookies');
  }
  return jar;
}

async function authenticatedSession(jar) {
  const response = await fetch(`${origin}/api/tenant-chat/auth/session`, {
    headers: { cookie: cookieHeader(jar) },
    redirect: 'manual',
  });
  absorbCookies(jar, response);
  if (!response.ok) throw new Error(`session failed (${response.status})`);
}

async function runRatePhase(name, requestsPerSecond, durationSeconds, operation) {
  const total = requestsPerSecond * durationSeconds;
  const intervalMs = 1_000 / requestsPerSecond;
  const startedAt = performance.now();
  const pending = [];
  let completed = 0;
  let errors = 0;
  const latencies = [];
  let nextProgressAt = startedAt + 30_000;

  console.log(`${name}: ${requestsPerSecond} RPS for ${durationSeconds}s (${total} requests)`);
  for (let index = 0; index < total; index += 1) {
    const targetAt = startedAt + index * intervalMs;
    const delayMs = targetAt - performance.now();
    if (delayMs > 0) await delay(delayMs);
    const requestStartedAt = performance.now();
    const request = operation(index)
      .catch(() => { errors += 1; })
      .finally(() => {
        latencies.push(performance.now() - requestStartedAt);
        completed += 1;
      });
    pending.push(request);

    if (performance.now() >= nextProgressAt) {
      console.log(`${name}: scheduled ${index + 1}/${total}, completed ${completed}, errors ${errors}`);
      nextProgressAt += 30_000;
    }
  }
  await Promise.all(pending);
  printSummary(name, latencies, errors, total);
  return { errors, latencies, requests: total };
}

async function mapConcurrent(items, concurrency, operation) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await operation(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

function absorbCookies(jar, response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : splitCombinedSetCookie(response.headers.get('set-cookie'));
  for (const value of values) {
    const [pair, ...attributes] = value.split(';');
    const separator = pair.indexOf('=');
    if (separator <= 0) continue;
    const name = pair.slice(0, separator).trim();
    const cookieValue = pair.slice(separator + 1).trim();
    const expired = attributes.some((attribute) => /^\s*max-age=0\s*$/i.test(attribute));
    if (expired || cookieValue === '') jar.delete(name);
    else jar.set(name, cookieValue);
  }
}

function splitCombinedSetCookie(value) {
  if (!value) return [];
  return value.split(/,(?=\s*[^;,]+=)/);
}

function cookieHeader(jar) {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

function percentile(values, fraction) {
  if (values.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function printSummary(name, latencies, errors, requests) {
  console.log(JSON.stringify({
    errors,
    name,
    p50Ms: rounded(percentile(latencies, 0.5)),
    p95Ms: rounded(percentile(latencies, 0.95)),
    p99Ms: rounded(percentile(latencies, 0.99)),
    requests,
  }));
}

function positiveInteger(name, fallback) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function rounded(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
