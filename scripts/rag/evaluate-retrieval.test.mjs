import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateRetrieval } from './evaluate-retrieval.mjs';

test('deterministic RAG fixture has the required quality and tenant-isolation slices', async () => {
  const report = await evaluateRetrieval();
  assert.equal(report.metrics.hitAt1, 1);
  assert.equal(report.metrics.hitAt3, 1);
  assert.equal(report.metrics.hitAt6, 1);
  assert.equal(report.metrics.mrr, 1);
  assert.equal(report.metrics.noAnswerFalseRetrievalRate, 0);
  assert.deepEqual(report.cases.find((entry) => entry.id === 'cross-tenant')?.results, []);
  assert.deepEqual(report.cases.find((entry) => entry.id === 'deleted-document')?.results, []);
});
