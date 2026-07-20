import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

test('Tenant Chat local Compose defaults to the non-authoritative 42D B1 request shadow', async () => {
  const compose = await readFile(
    join(repositoryRoot, 'scripts/dev/docker-compose.tenant-chat-execution.yml'),
    'utf8',
  );

  assert.match(
    compose,
    /dockerfile:\s+infra\/docker\/gateway-core\.Dockerfile/,
  );
  assert.doesNotMatch(compose, /difficulty_e5:/);
  assert.match(compose, /GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED:\s+"false"/);
  assert.match(
    compose,
    /GATEWAY_DIFFICULTY_E5_RUNTIME_TIMEOUT_MS:\s+\$\{GATEWAY_DIFFICULTY_E5_RUNTIME_TIMEOUT_MS:-100\}/,
  );
  assert.match(compose, /GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED:\s+"true"/);
  assert.match(
    compose,
    /GATEWAY_DIFFICULTY_E5_SHADOW_ALLOWED_SCOPES:\s+"\$\{GATEWAY_DIFFICULTY_E5_SHADOW_ALLOWED_SCOPES:-00000000-0000-4000-8000-000000000100\/00000000-0000-4000-8000-000000000300\}"/,
  );
  assert.match(
    compose,
    /GATEWAY_DIFFICULTY_E5_SHADOW_TIMEOUT_MS:\s+\$\{GATEWAY_DIFFICULTY_E5_SHADOW_TIMEOUT_MS:-100\}/,
  );
});

test('Tenant Chat container smoke uses the local rule-authoritative Gateway profile', async () => {
  const workflow = await readFile(join(repositoryRoot, '.github/workflows/ci.yml'), 'utf8');
  const smokeStepStart = workflow.indexOf(
    '- name: Run encrypted Tenant Chat and usage smoke with mock provider',
  );
  const smokeStepEnd = workflow.indexOf('- name: Build remaining production images', smokeStepStart);
  const smokeStep = workflow.slice(smokeStepStart, smokeStepEnd);

  assert.ok(smokeStepStart >= 0);
  assert.ok(smokeStepEnd > smokeStepStart);
  assert.doesNotMatch(smokeStep, /GATELM_GATEWAY_DOCKERFILE:/);
  assert.doesNotMatch(smokeStep, /GATELM_DIFFICULTY_E5_BUNDLE_DIR:/);
  assert.doesNotMatch(smokeStep, /GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED:/);
});

test('Tenant Chat local wrapper does not prepare the unused E5 runtime bundle', async () => {
  const wrapper = await readFile(
    join(repositoryRoot, 'scripts/dev/tenant-chat-local-compose.ps1'),
    'utf8',
  );
  assert.doesNotMatch(wrapper, /prepare-gateway-e5-shadow-bundle\.ps1/);
  assert.doesNotMatch(wrapper, /gateway-e5-runtime-bundle/);
});
