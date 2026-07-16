import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('Tenant Chat local Compose defaults to the authoritative E5 difficulty runtime', async () => {
  const compose = await readFile(
    join(repositoryRoot, 'scripts/dev/docker-compose.tenant-chat-execution.yml'),
    'utf8',
  );

  assert.match(
    compose,
    /dockerfile:\s+\$\{GATELM_GATEWAY_DOCKERFILE:-infra\/docker\/gateway-core-e5-runtime\.Dockerfile\}/,
  );
  assert.match(compose, /gateway-core:\s+platform:\s+linux\/amd64/s);
  assert.match(
    compose,
    /difficulty_e5:\s+\$\{GATELM_DIFFICULTY_E5_BUNDLE_DIR:-\.tmp\/gateway-e5-runtime-bundle\}/,
  );
  assert.match(
    compose,
    /GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED:\s+"\$\{GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED:-true\}"/,
  );
  assert.match(
    compose,
    /GATEWAY_DIFFICULTY_E5_RUNTIME_TIMEOUT_MS:\s+\$\{GATEWAY_DIFFICULTY_E5_RUNTIME_TIMEOUT_MS:-100\}/,
  );
  assert.match(compose, /GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED:\s+"false"/);
});

test('Tenant Chat container smoke overrides the local E5 default with the rule-only Gateway', async () => {
  const workflow = await readFile(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
  const smokeStepStart = workflow.indexOf(
    '- name: Run encrypted Tenant Chat and usage smoke with mock provider',
  );
  const smokeStepEnd = workflow.indexOf('- name: Build remaining production images', smokeStepStart);
  const smokeStep = workflow.slice(smokeStepStart, smokeStepEnd);

  assert.ok(smokeStepStart >= 0);
  assert.ok(smokeStepEnd > smokeStepStart);
  assert.match(
    smokeStep,
    /GATELM_GATEWAY_DOCKERFILE:\s+infra\/docker\/gateway-core\.Dockerfile/,
  );
  assert.match(smokeStep, /GATELM_DIFFICULTY_E5_BUNDLE_DIR:\s+\./);
  assert.match(smokeStep, /GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED:\s+"false"/);
});

test('Tenant Chat local wrapper prepares the pinned E5 runtime bundle before build or up', async () => {
  const wrapper = await readFile(
    join(repositoryRoot, 'scripts/dev/tenant-chat-local-compose.ps1'),
    'utf8',
  );
  const packageJson = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'));

  assert.match(wrapper, /prepare-gateway-e5-shadow-bundle\.ps1/);
  assert.match(wrapper, /\.tmp\/gateway-e5-runtime-bundle/);
  assert.match(wrapper, /'build',\s*'up'/);
  assert.match(
    packageJson.scripts['v2.1:routing:prepare-gateway-e5-runtime'],
    /-OutputDirectory \.tmp\/gateway-e5-runtime-bundle/,
  );
  assert.match(
    packageJson.scripts['v2.1:routing:setup-gateway-e5-runtime-native'],
    /-OutputDirectory \.tmp\/gateway-e5-runtime-bundle/,
  );
});
