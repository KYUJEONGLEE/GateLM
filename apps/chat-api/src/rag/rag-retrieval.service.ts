import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RAG_EMBEDDING_PROFILE } from '@gatelm/rag-config';

import type { AuthorizedExecution } from '@/auth/auth.types';
import { createRagChunkAadV1, createRagDocumentPrivateMetadataAadV1, decryptContent } from '@/content/content-crypto';
import { ContentIntegrityError, ContentKeyUnavailable } from '@/content/content.errors';
import { TenantContentKeyService } from '@/content/tenant-content-key.service';

import { RagEmbeddingClient } from './rag-embedding.client';
import {
  RagRetrievalDisabledError,
  RagRetrievalError,
  RagRetrievalIntegrityError,
} from './rag-retrieval.errors';
import { RagRetrievalRepository, type RagRetrievedChunkRow } from './rag-retrieval.repository';

export type RagRetrievedChunk = Readonly<{
  chunkId: string;
  documentId: string;
  displayName: string;
  score: number;
  content: string;
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  ordinal: number;
  tokenCount: number;
  sourceMetadata: Record<string, unknown>;
}>;

@Injectable()
export class RagRetrievalService {
  private readonly globallyEnabled: boolean;
  private readonly topK: number;
  private readonly minimumScore: number;

  constructor(
    config: ConfigService,
    private readonly repository: RagRetrievalRepository,
    private readonly embeddingClient: RagEmbeddingClient,
    private readonly keys: TenantContentKeyService,
  ) {
    this.globallyEnabled = config.getOrThrow<string>('TENANT_CHAT_RAG_ENABLED') === 'true';
    this.topK = config.getOrThrow<number>('RAG_TOP_K');
    this.minimumScore = config.getOrThrow<number>('RAG_MIN_SCORE');
  }

  async retrieve(actor: AuthorizedExecution, query: string): Promise<readonly RagRetrievedChunk[]> {
    const knowledgeBase = await this.enabledKnowledgeBase(actor.tenantId);
    if (!knowledgeBase) throw new RagRetrievalDisabledError();
    const tenantId = actor.tenantId;
    const embedded = await this.embeddingClient.embedQuery(tenantId, query);
    const embedding = embedded.embedding;
    try {
      if (embedding.length !== RAG_EMBEDDING_PROFILE.dimensions) throw new RagRetrievalIntegrityError();
      try {
        await this.repository.recordQueryEmbeddingUsage({
          tenantId,
          operationId: embedded.operationId,
          inputCount: embedded.usage.inputCount,
          promptTokens: embedded.usage.promptTokens,
          totalTokens: embedded.usage.totalTokens,
        });
      } catch {
        throw new RagRetrievalError('RAG_QUERY_USAGE_UNAVAILABLE');
      }
      const rows = await this.repository.search({
        tenantId, knowledgeBaseId: knowledgeBase.id, embedding, minimumScore: this.minimumScore, topK: this.topK,
      });
      try {
        const displayNames = new Map<string, string>();
        try {
          const result: RagRetrievedChunk[] = [];
          for (const row of rows) {
            const displayName = await this.displayName(row, displayNames);
            result.push(Object.freeze({
              chunkId: row.chunkId,
              documentId: row.publicDocumentId,
              displayName,
              score: numericScore(row.score),
              content: await this.decryptChunk(row),
              pageStart: row.pageStart,
              pageEnd: row.pageEnd,
              lineStart: row.lineStart,
              lineEnd: row.lineEnd,
              ordinal: row.ordinal,
              tokenCount: row.tokenCount,
              sourceMetadata: safeSourceMetadata(row.sourceMetadata),
            }));
          }
          return Object.freeze(result);
        } finally {
          displayNames.clear();
        }
      } finally {
        rows.length = 0;
      }
    } finally {
      embedding.fill(0);
    }
  }

  async assertTenantEnabled(tenantId: string): Promise<void> {
    if (!await this.enabledKnowledgeBase(tenantId)) throw new RagRetrievalDisabledError();
  }

  private async enabledKnowledgeBase(tenantId: string): Promise<Readonly<{ id: string }> | null> {
    if (!this.globallyEnabled) return null;
    return this.repository.findEnabledKnowledgeBase(tenantId);
  }

  private async decryptChunk(row: RagRetrievedChunkRow): Promise<string> {
    try {
      return await this.keys.withKeyVersion(row.tenantId, row.contentKeyVersion, (key) =>
        decryptContent(key, {
          ciphertext: Buffer.from(row.contentCiphertext), nonce: Buffer.from(row.contentNonce), tag: Buffer.from(row.contentAuthTag),
        }, createRagChunkAadV1({
          tenantId: row.tenantId, knowledgeBaseId: row.knowledgeBaseId, documentId: row.documentId,
          documentIndexId: row.documentIndexId, chunkId: row.chunkId, contentKeyVersion: row.contentKeyVersion,
        })),
      );
    } catch (error) {
      if (error instanceof ContentIntegrityError || error instanceof ContentKeyUnavailable) throw new RagRetrievalIntegrityError();
      throw error;
    }
  }

  private async displayName(row: RagRetrievedChunkRow, cache: Map<string, string>): Promise<string> {
    const cached = cache.get(row.documentId);
    if (cached) return cached;
    try {
      const plaintext = await this.keys.withKeyVersion(row.tenantId, row.privateMetadataContentKeyVersion, (key) =>
        decryptContent(key, {
          ciphertext: Buffer.from(row.privateMetadataCiphertext), nonce: Buffer.from(row.privateMetadataNonce), tag: Buffer.from(row.privateMetadataAuthTag),
        }, createRagDocumentPrivateMetadataAadV1({
          tenantId: row.tenantId, knowledgeBaseId: row.knowledgeBaseId, documentId: row.documentId,
          contentKeyVersion: row.privateMetadataContentKeyVersion,
        })),
      );
      const displayName = parseDisplayName(plaintext, row.privateMetadataSchemaVersion);
      cache.set(row.documentId, displayName);
      return displayName;
    } catch (error) {
      if (error instanceof ContentIntegrityError || error instanceof ContentKeyUnavailable) throw new RagRetrievalIntegrityError();
      throw error;
    }
  }
}

function parseDisplayName(plaintext: string, schemaVersion: number): string {
  if (schemaVersion !== 1) throw new RagRetrievalIntegrityError();
  let parsed: unknown;
  try { parsed = JSON.parse(plaintext) as unknown; } catch { throw new RagRetrievalIntegrityError(); }
  if (!exactObject(parsed, ['displayName', 'originalFilename', 'schemaVersion', 'sha256Digest']) ||
    parsed.schemaVersion !== 1 || typeof parsed.displayName !== 'string' ||
    parsed.displayName !== parsed.displayName.normalize('NFC').trim() || parsed.displayName.length < 1 ||
    parsed.displayName.length > 255 || Buffer.byteLength(parsed.displayName, 'utf8') > 1024 || /[\u0000-\u001f\u007f]/u.test(parsed.displayName)) {
    throw new RagRetrievalIntegrityError();
  }
  return parsed.displayName;
}
function safeSourceMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RagRetrievalIntegrityError();
  return Object.freeze(JSON.parse(JSON.stringify(value)) as Record<string, unknown>);
}
function numericScore(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new RagRetrievalIntegrityError();
  return value;
}
function exactObject(value: unknown, expected: string[]): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
}
