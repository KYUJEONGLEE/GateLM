export type RagCitation = Readonly<{
  sourceId: `S${number}`;
  documentId: string;
  displayName: string;
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  ordinal: number;
  availability?: 'available' | 'unavailable';
}>;

export function validateRagCitations(answer: string, sources: readonly RagCitation[]): readonly RagCitation[] {
  const sourceMap = new Map(sources.map((source) => [source.sourceId, source] as const));
  const accepted = new Set<`S${number}`>();
  const result: RagCitation[] = [];
  for (const match of answer.matchAll(/\[S([1-9][0-9]{0,2})\]/g)) {
    const sourceId = `S${match[1]}` as `S${number}`;
    const source = sourceMap.get(sourceId);
    if (source && !accepted.has(sourceId)) {
      accepted.add(sourceId);
      result.push(source);
    }
  }
  return Object.freeze(result);
}

export function citationSnapshotJson(citations: readonly RagCitation[]): string {
  return JSON.stringify(citations.map(({ availability: _availability, ...citation }) => citation));
}

export function parseCitationSnapshot(value: string): readonly RagCitation[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.length > 12) throw new Error('Invalid citation snapshot.');
  const seen = new Set<string>();
  return Object.freeze(parsed.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('Invalid citation snapshot.');
    const citation = entry as Record<string, unknown>;
    if (Object.keys(citation).sort().join(',') !== 'displayName,documentId,lineEnd,lineStart,ordinal,pageEnd,pageStart,sourceId' ||
      typeof citation.sourceId !== 'string' || !/^S[1-9][0-9]{0,2}$/.test(citation.sourceId) || seen.has(citation.sourceId) ||
      typeof citation.documentId !== 'string' || typeof citation.displayName !== 'string' ||
      !Number.isInteger(citation.ordinal) || Number(citation.ordinal) < 0 || !locations(citation)) throw new Error('Invalid citation snapshot.');
    seen.add(citation.sourceId);
    return Object.freeze({
      sourceId: citation.sourceId as `S${number}`,
      documentId: citation.documentId as string,
      displayName: citation.displayName as string,
      pageStart: citation.pageStart as number | null,
      pageEnd: citation.pageEnd as number | null,
      lineStart: citation.lineStart as number | null,
      lineEnd: citation.lineEnd as number | null,
      ordinal: citation.ordinal as number,
    });
  }));
}

function locations(value: Record<string, unknown>): boolean {
  return ['pageStart', 'pageEnd', 'lineStart', 'lineEnd'].every((key) => value[key] === null || (Number.isInteger(value[key]) && Number(value[key]) >= 1));
}
