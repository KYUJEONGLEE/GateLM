import assert from 'node:assert/strict';
import test from 'node:test';

import { getModelBrand } from './src/lib/model-brand.mjs';

test('resolves native model families from effective model keys', () => {
  assert.equal(getModelBrand('gpt-4o-mini')?.key, 'openai');
  assert.equal(getModelBrand('provider-id:o3-mini')?.key, 'openai');
  assert.equal(getModelBrand('models/gemini-2.5-flash')?.key, 'gemini');
  assert.equal(getModelBrand('anthropic:claude-sonnet-4')?.key, 'claude');
});

test('does not guess a provider for shared or unknown model families', () => {
  assert.equal(getModelBrand('llama-3.3-70b'), null);
  assert.equal(getModelBrand('model_standard_001'), null);
  assert.equal(getModelBrand(undefined), null);
});
