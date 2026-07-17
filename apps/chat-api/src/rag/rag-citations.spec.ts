import { citationSnapshotJson, parseCitationSnapshot, validateRagCitations, type RagCitation } from './rag-citations';

const source = (sourceId: `S${number}`): RagCitation => ({
  sourceId, documentId: '00000000-0000-4000-8000-000000000101',
  displayName: 'Policy.pdf', pageStart: 2, pageEnd: 2, lineStart: null, lineEnd: null, ordinal: 1,
});

describe('validateRagCitations', () => {
  it('keeps only deduplicated source-map entries and ignores fabricated IDs', () => {
    expect(validateRagCitations('Policy-evil.pdf page 999 [S1] [S999] [S1]', [source('S1')])).toEqual([source('S1')]);
  });

  it('serializes only safe source-map metadata for encrypted persistence', () => {
    expect(parseCitationSnapshot(citationSnapshotJson([source('S1')]))).toEqual([source('S1')]);
    expect(() => parseCitationSnapshot(JSON.stringify([{ ...source('S1'), s3ObjectKey: 'rag/internal' }]))).toThrow('Invalid citation snapshot.');
  });
});
