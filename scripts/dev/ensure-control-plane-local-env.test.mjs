import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CONTROL_PLANE_AUTH_STATE_SECRET,
  ensureControlPlaneLocalEnv,
} from './ensure-control-plane-local-env.mjs';

const bootstrapScriptPath = fileURLToPath(
  new URL('./ensure-control-plane-local-env.mjs', import.meta.url),
);

function withTemporaryRepository(run) {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'gatelm-local-env-'));
  const rootEnvPath = path.join(repoRoot, '.env');
  const appEnvPath = path.join(repoRoot, 'apps', 'control-plane-api', '.env');
  const exampleEnvPath = path.join(repoRoot, '.env.example');
  writeFileSync(
    exampleEnvPath,
    [
      'DATABASE_URL=local-database',
      `${CONTROL_PLANE_AUTH_STATE_SECRET}=replace-me-with-random-value`,
      '',
    ].join('\n'),
  );

  try {
    return run({ appEnvPath, exampleEnvPath, repoRoot, rootEnvPath });
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
}

test('creates a persistent secret from the repository example without logging it', () => {
  withTemporaryRepository((paths) => {
    const generated = 'x'.repeat(43);
    const logs = [];
    const result = ensureControlPlaneLocalEnv({
      ...paths,
      generateSecret: () => generated,
      logger: (message) => logs.push(message),
      processEnv: {},
    });
    const content = readFileSync(paths.rootEnvPath, 'utf8');

    assert.equal(result.changed, true);
    assert.match(
      content,
      new RegExp(`^${CONTROL_PLANE_AUTH_STATE_SECRET}=${generated}$`, 'm'),
    );
    assert.equal(logs.join('\n').includes(generated), false);
  });
});

test('adds the missing key once and keeps the second run byte-for-byte stable', () => {
  withTemporaryRepository((paths) => {
    writeFileSync(paths.rootEnvPath, 'DATABASE_URL=local-database\r\n');
    let generations = 0;
    const options = {
      ...paths,
      generateSecret: () => {
        generations += 1;
        return 'y'.repeat(43);
      },
      logger: () => {},
      processEnv: {},
    };

    ensureControlPlaneLocalEnv(options);
    const firstContent = readFileSync(paths.rootEnvPath, 'utf8');
    const secondResult = ensureControlPlaneLocalEnv(options);
    const secondContent = readFileSync(paths.rootEnvPath, 'utf8');

    assert.equal(generations, 1);
    assert.equal(secondResult.changed, false);
    assert.equal(secondContent, firstContent);
    assert.equal(secondContent.includes('\r\n'), true);
  });
});

test('replaces a known root placeholder without touching unrelated settings', () => {
  withTemporaryRepository((paths) => {
    writeFileSync(
      paths.rootEnvPath,
      [
        'DATABASE_URL=local-database',
        `${CONTROL_PLANE_AUTH_STATE_SECRET}='replace-me'`,
        'REDIS_URL=redis://localhost:6379',
      ].join('\n'),
    );

    ensureControlPlaneLocalEnv({
      ...paths,
      generateSecret: () => 'z'.repeat(43),
      logger: () => {},
      processEnv: {},
    });
    const content = readFileSync(paths.rootEnvPath, 'utf8');

    assert.equal(content.includes('DATABASE_URL=local-database'), true);
    assert.equal(content.includes('REDIS_URL=redis://localhost:6379'), true);
    assert.equal(content.includes('replace-me'), false);
  });
});

test('refuses production-like environments without creating a local env file', () => {
  withTemporaryRepository((paths) => {
    assert.throws(
      () =>
        ensureControlPlaneLocalEnv({
          ...paths,
          logger: () => {},
          processEnv: { NODE_ENV: 'production' },
        }),
      /disabled in production-like environments/,
    );
    assert.equal(existsSync(paths.rootEnvPath), false);
  });
});

test('recognizes exported production assignments', () => {
  withTemporaryRepository((paths) => {
    const original = 'export NODE_ENV=production\n';
    writeFileSync(paths.rootEnvPath, original);
    assert.throws(
      () =>
        ensureControlPlaneLocalEnv({
          ...paths,
          logger: () => {},
          processEnv: {},
        }),
      /disabled in production-like environments/,
    );
    assert.equal(readFileSync(paths.rootEnvPath, 'utf8'), original);
  });
});

test('accepts a valid legacy app-local secret without modifying the root env', () => {
  withTemporaryRepository((paths) => {
    const originalRootContent = 'DATABASE_URL=local-database\n';
    const appSecret = 'a'.repeat(43);
    const logs = [];
    writeFileSync(paths.rootEnvPath, originalRootContent);

    mkdirSync(path.dirname(paths.appEnvPath), { recursive: true });
    writeFileSync(
      paths.appEnvPath,
      `export ${CONTROL_PLANE_AUTH_STATE_SECRET}=${appSecret}\n`,
    );

    const result = ensureControlPlaneLocalEnv({
      ...paths,
      logger: (message) => logs.push(message),
      processEnv: {},
    });

    assert.deepEqual(result, { changed: false, source: 'app-env' });
    assert.equal(readFileSync(paths.rootEnvPath, 'utf8'), originalRootContent);
    assert.equal(logs.join('\n').includes(appSecret), false);
  });
});

test('preserves a valid exported quoted secret with an inline comment', () => {
  withTemporaryRepository((paths) => {
    const original = `export ${CONTROL_PLANE_AUTH_STATE_SECRET}="${'q'.repeat(32)}#inside" # local only\n`;
    writeFileSync(paths.rootEnvPath, original);

    const result = ensureControlPlaneLocalEnv({
      ...paths,
      logger: () => {},
      processEnv: {},
    });

    assert.equal(result.changed, false);
    assert.equal(readFileSync(paths.rootEnvPath, 'utf8'), original);
  });
});

test('refuses invalid higher-precedence process and app-local assignments', () => {
  withTemporaryRepository((paths) => {
    writeFileSync(paths.rootEnvPath, 'DATABASE_URL=local-database\n');
    assert.throws(
      () =>
        ensureControlPlaneLocalEnv({
          ...paths,
          logger: () => {},
          processEnv: { [CONTROL_PLANE_AUTH_STATE_SECRET]: '' },
        }),
      /process environment is missing, weak, or a placeholder/,
    );

    mkdirSync(path.dirname(paths.appEnvPath), { recursive: true });
    writeFileSync(
      paths.appEnvPath,
      `${CONTROL_PLANE_AUTH_STATE_SECRET}=app-local-value\n`,
    );
    const originalRootContent = readFileSync(paths.rootEnvPath, 'utf8');
    assert.throws(
      () =>
        ensureControlPlaneLocalEnv({
          ...paths,
          logger: () => {},
          processEnv: {},
        }),
      /apps\/control-plane-api\/\.env is missing, weak, or a placeholder/,
    );
    assert.equal(readFileSync(paths.rootEnvPath, 'utf8'), originalRootContent);
  });
});

test('treats an unquoted inline comment as an empty value and replaces it', () => {
  withTemporaryRepository((paths) => {
    writeFileSync(
      paths.rootEnvPath,
      `${CONTROL_PLANE_AUTH_STATE_SECRET}= # set by local bootstrap\n`,
    );

    ensureControlPlaneLocalEnv({
      ...paths,
      generateSecret: () => 'c'.repeat(43),
      logger: () => {},
      processEnv: {},
    });

    assert.equal(
      readFileSync(paths.rootEnvPath, 'utf8'),
      `${CONTROL_PLANE_AUTH_STATE_SECRET}=${'c'.repeat(43)}\n`,
    );
  });
});

test('refuses to rotate a non-placeholder weak root secret', () => {
  withTemporaryRepository((paths) => {
    const original = `${CONTROL_PLANE_AUTH_STATE_SECRET}=short-local-value\n`;
    writeFileSync(paths.rootEnvPath, original);

    assert.throws(
      () =>
        ensureControlPlaneLocalEnv({
          ...paths,
          logger: () => {},
          processEnv: {},
        }),
      /repository \.env is too weak/,
    );
    assert.equal(readFileSync(paths.rootEnvPath, 'utf8'), original);
  });
});

test('recovers a stale lock whose owner process no longer exists', () => {
  withTemporaryRepository((paths) => {
    const lockPath = `${paths.rootEnvPath}.control-plane-bootstrap.lock`;
    writeFileSync(
      lockPath,
      JSON.stringify({
        createdAt: new Date().toISOString(),
        pid: 2_147_483_000,
      }),
    );

    ensureControlPlaneLocalEnv({
      ...paths,
      generateSecret: () => 'l'.repeat(43),
      logger: () => {},
      processEnv: {},
    });

    assert.equal(existsSync(lockPath), false);
    assert.match(
      readFileSync(paths.rootEnvPath, 'utf8'),
      new RegExp(`^${CONTROL_PLANE_AUTH_STATE_SECRET}=${'l'.repeat(43)}$`, 'm'),
    );
  });
});

test('rejects duplicate root assignments without changing the file', () => {
  withTemporaryRepository((paths) => {
    const original = [
      `${CONTROL_PLANE_AUTH_STATE_SECRET}=first-local-value`,
      `${CONTROL_PLANE_AUTH_STATE_SECRET}=second-local-value`,
      '',
    ].join('\n');
    writeFileSync(paths.rootEnvPath, original);

    assert.throws(
      () =>
        ensureControlPlaneLocalEnv({
          ...paths,
          logger: () => {},
          processEnv: {},
        }),
      /assigned more than once/,
    );
    assert.equal(readFileSync(paths.rootEnvPath, 'utf8'), original);
  });
});

test('serializes concurrent CLI bootstraps without exposing the generated secret', async () => {
  const repoRoot = mkdtempSync(path.join(tmpdir(), 'gatelm-local-env-race-'));
  const rootEnvPath = path.join(repoRoot, '.env');
  writeFileSync(
    path.join(repoRoot, '.env.example'),
    `${CONTROL_PLANE_AUTH_STATE_SECRET}=replace-me-with-random-value\n`,
  );

  try {
    const [first, second] = await Promise.all([
      runBootstrapCli(repoRoot),
      runBootstrapCli(repoRoot),
    ]);
    assert.equal(first.code, 0, first.stderr);
    assert.equal(second.code, 0, second.stderr);

    const content = readFileSync(rootEnvPath, 'utf8');
    const assignments = Array.from(
      content.matchAll(
        new RegExp(`^${CONTROL_PLANE_AUTH_STATE_SECRET}=([^\\r\\n]+)$`, 'gm'),
      ),
    );
    assert.equal(assignments.length, 1);
    assert.match(assignments[0][1], /^[A-Za-z0-9_-]{32,}$/);
    assert.equal(
      `${first.stdout}${first.stderr}${second.stdout}${second.stderr}`.includes(
        assignments[0][1],
      ),
      false,
    );
  } finally {
    rmSync(repoRoot, { force: true, recursive: true });
  }
});

function runBootstrapCli(repoRoot) {
  const environment = { ...process.env };
  for (const name of [
    CONTROL_PLANE_AUTH_STATE_SECRET,
    'APP_ENV',
    'AWS_EXECUTION_ENV',
    'CONTROL_PLANE_DEPLOYMENT_ENV',
    'DEPLOYMENT_ENV',
    'ECS_CONTAINER_METADATA_URI',
    'ECS_CONTAINER_METADATA_URI_V4',
    'GATELM_DEPLOYMENT_ENV',
    'NODE_ENV',
  ]) {
    delete environment[name];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [bootstrapScriptPath, '--repo-root', repoRoot],
      { env: environment, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stderr, stdout }));
  });
}
