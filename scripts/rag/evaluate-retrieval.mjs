import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixtureUrl = new URL('../../docs/rag/fixtures/retrieval-evaluation.v1.json', import.meta.url);
const DIMENSIONS = 1536;

const aliases = new Map([
  ['vacation', 'leave'], ['paid', 'leave'], ['holiday', 'leave'], ['annual', 'leave'],
  ['mfa', 'multifactor'], ['multi', 'multifactor'], ['factor', 'multifactor'],
  ['remote', 'remote'], ['administrator', 'admin'], ['admins', 'admin'],
  ['starts', 'effective'], ['start', 'effective'], ['date', 'effective'], ['when', 'effective'],
  ['allowance', 'leave'], ['days', 'leave'], ['how', 'leave'], ['much', 'leave'],
  ['commuter', 'commuter'], ['subsidy', 'commuter'], ['amount', 'commuter'],
  ['untrusted', 'untrusted'], ['instructions', 'untrusted'], ['training', 'untrusted'],
]);

export async function evaluateRetrieval({ fixturePath = fileURLToPath(fixtureUrl) } = {}) {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  validateFixture(fixture);
  const results = fixture.cases.map((testCase) => evaluateCase(fixture, testCase));
  const answerable = results.filter((result) => result.answerable);
  const noAnswer = results.filter((result) => !result.answerable);
  const metrics = {
    hitAt1: ratio(answerable.filter((result) => result.rank !== null && result.rank <= 1).length, answerable.length),
    hitAt3: ratio(answerable.filter((result) => result.rank !== null && result.rank <= 3).length, answerable.length),
    hitAt6: ratio(answerable.filter((result) => result.rank !== null && result.rank <= 6).length, answerable.length),
    mrr: answerable.reduce((sum, result) => sum + (result.rank ? 1 / result.rank : 0), 0) / answerable.length,
    noAnswerFalseRetrievalRate: ratio(noAnswer.filter((result) => result.results.length > 0).length, noAnswer.length),
  };
  return Object.freeze({ fixture: fixture.schemaVersion, cases: results, metrics });
}

function evaluateCase(fixture, testCase) {
  const excluded = new Set(testCase.excludedDocuments ?? []);
  const query = vectorize(testCase.query);
  const results = fixture.documents
    .filter((document) => document.tenant === testCase.tenant && !excluded.has(document.document))
    .map((document) => ({ document, score: cosine(query, vectorize(document.text)) }))
    .filter((candidate) => candidate.score >= fixture.minimumScore)
    .sort((left, right) => right.score - left.score || left.document.document.localeCompare(right.document.document))
    .slice(0, 6);
  const rank = testCase.answerable
    ? (results.findIndex((candidate) => candidate.document.document === testCase.expectedDocument) + 1 || null)
    : null;
  return Object.freeze({ id: testCase.id, answerable: testCase.answerable, rank, results: results.map(({ document, score }) => ({ document: document.document, score: Number(score.toFixed(6)) })) });
}

function vectorize(text) {
  const values = new Float64Array(DIMENSIONS);
  for (const token of tokens(text)) {
    const index = hash(token) % DIMENSIONS;
    values[index] += 1;
  }
  return values;
}

function tokens(value) {
  return String(value).toLowerCase().match(/[a-z0-9]+|[가-힣]+/g)?.map((token) => aliases.get(token) ?? token) ?? [];
}

function hash(value) {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return result >>> 0;
}

function cosine(left, right) {
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < DIMENSIONS; index += 1) {
    dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? dot / Math.sqrt(leftNorm * rightNorm) : 0;
}

function ratio(numerator, denominator) { return denominator ? Number((numerator / denominator).toFixed(6)) : 0; }

function validateFixture(fixture) {
  assert.equal(fixture.schemaVersion, 'gatelm.rag-retrieval-evaluation.v1');
  assert.equal(fixture.embedding, 'deterministic-fixture-v1');
  assert.equal(fixture.minimumScore, 0.3);
  assert.ok(Array.isArray(fixture.documents) && fixture.documents.length > 0);
  assert.ok(Array.isArray(fixture.cases) && fixture.cases.length > 0);
  for (const testCase of fixture.cases) {
    assert.equal(typeof testCase.id, 'string'); assert.equal(typeof testCase.tenant, 'string');
    assert.equal(typeof testCase.query, 'string'); assert.equal(typeof testCase.answerable, 'boolean');
    assert.ok(Array.isArray(testCase.tags) && testCase.tags.length > 0);
    if (testCase.answerable) assert.equal(typeof testCase.expectedDocument, 'string');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.env.RAG_EVAL_PROVIDER && process.env.RAG_EVAL_PROVIDER !== 'fake') {
    throw new Error('Real embedding evaluation is opt-in. Set RAG_EVAL_OPENAI=1 and use the documented staging-only command.');
  }
  const report = await evaluateRetrieval();
  console.log(JSON.stringify(report, null, 2));
}
