import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/database/prisma.service';

export type RagRetrievedChunkRow = Readonly<{
  chunkId: string;
  tenantId: string;
  knowledgeBaseId: string;
  documentId: string;
  publicDocumentId: string;
  documentIndexId: string;
  ordinal: number;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  lineStart: number | null;
  lineEnd: number | null;
  sourceMetadata: Prisma.JsonValue;
  contentCiphertext: Uint8Array;
  contentNonce: Uint8Array;
  contentAuthTag: Uint8Array;
  contentKeyVersion: number;
  privateMetadataCiphertext: Uint8Array;
  privateMetadataNonce: Uint8Array;
  privateMetadataAuthTag: Uint8Array;
  privateMetadataContentKeyVersion: number;
  privateMetadataSchemaVersion: number;
  score: number;
}>;

@Injectable()
export class RagRetrievalRepository {
  constructor(private readonly prisma: PrismaService) {}

  findEnabledKnowledgeBase(tenantId: string): Promise<Readonly<{ id: string }> | null> {
    return this.prisma.ragKnowledgeBase.findFirst({
      where: { tenantId, status: 'ENABLED' },
      select: { id: true },
    });
  }

  async recordQueryEmbeddingUsage(input: Readonly<{
    tenantId: string;
    operationId: string;
    inputCount: 1;
    promptTokens: number;
    totalTokens: number;
  }>): Promise<void> {
    const data = {
      tenantId: input.tenantId,
      purpose: 'RAG_QUERY',
      operationId: input.operationId,
      batchOrdinal: 0,
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-large',
      embeddingDimensions: 1536,
      embeddingProfileVersion: 1,
      inputCount: input.inputCount,
      promptTokens: input.promptTokens,
      totalTokens: input.totalTokens,
    } as const;
    const inserted = await this.prisma.ragEmbeddingUsage.createMany({
      data: [data],
      skipDuplicates: true,
    });
    if (inserted.count === 1) return;

    const existing = await this.prisma.ragEmbeddingUsage.findFirst({
      where: {
        tenantId: input.tenantId,
        purpose: 'RAG_QUERY',
        operationId: input.operationId,
        batchOrdinal: 0,
      },
      select: {
        embeddingProvider: true,
        embeddingModel: true,
        embeddingDimensions: true,
        embeddingProfileVersion: true,
        inputCount: true,
        promptTokens: true,
        totalTokens: true,
      },
    });
    if (
      !existing ||
      existing.embeddingProvider !== data.embeddingProvider ||
      existing.embeddingModel !== data.embeddingModel ||
      existing.embeddingDimensions !== data.embeddingDimensions ||
      existing.embeddingProfileVersion !== data.embeddingProfileVersion ||
      existing.inputCount !== data.inputCount ||
      existing.promptTokens !== data.promptTokens ||
      existing.totalTokens !== data.totalTokens
    ) {
      throw new Error('RAG query embedding usage idempotency conflict');
    }
  }

  async search(input: Readonly<{
    tenantId: string;
    knowledgeBaseId: string;
    embedding: readonly number[];
    minimumScore: number;
    topK: number;
  }>): Promise<RagRetrievedChunkRow[]> {
    assertVector(input.embedding);
    if (!Number.isFinite(input.minimumScore) || input.minimumScore < 0 || input.minimumScore > 1 ||
      !Number.isInteger(input.topK) || input.topK < 1 || input.topK > 12) {
      throw new Error('invalid retrieval query settings');
    }
    const vector = `[${input.embedding.join(',')}]`;
    return this.prisma.$queryRaw<RagRetrievedChunkRow[]>(Prisma.sql`
      SELECT
        chunk.id AS "chunkId",
        chunk.tenant_id AS "tenantId",
        knowledge_base.id AS "knowledgeBaseId",
        document.id AS "documentId",
        document.public_id AS "publicDocumentId",
        document_index.id AS "documentIndexId",
        chunk.ordinal AS "ordinal",
        chunk.token_count AS "tokenCount",
        chunk.page_start AS "pageStart",
        chunk.page_end AS "pageEnd",
        chunk.line_start AS "lineStart",
        chunk.line_end AS "lineEnd",
        chunk.source_metadata AS "sourceMetadata",
        chunk.content_ciphertext AS "contentCiphertext",
        chunk.content_nonce AS "contentNonce",
        chunk.content_auth_tag AS "contentAuthTag",
        chunk.content_key_version AS "contentKeyVersion",
        document.private_metadata_ciphertext AS "privateMetadataCiphertext",
        document.private_metadata_nonce AS "privateMetadataNonce",
        document.private_metadata_auth_tag AS "privateMetadataAuthTag",
        document.private_metadata_content_key_version AS "privateMetadataContentKeyVersion",
        document.private_metadata_schema_version AS "privateMetadataSchemaVersion",
        1 - (chunk.embedding <=> ${vector}::vector) AS "score"
      FROM rag_chunks AS chunk
      INNER JOIN rag_document_indexes AS document_index
        ON document_index.id = chunk.document_index_id
        AND document_index.document_id = chunk.document_id
        AND document_index.tenant_id = chunk.tenant_id
      INNER JOIN rag_documents AS document
        ON document.id = chunk.document_id
        AND document.tenant_id = chunk.tenant_id
      INNER JOIN rag_knowledge_bases AS knowledge_base
        ON knowledge_base.id = document.knowledge_base_id
        AND knowledge_base.tenant_id = document.tenant_id
      WHERE chunk.tenant_id = ${input.tenantId}::uuid
        AND document.tenant_id = ${input.tenantId}::uuid
        AND document_index.tenant_id = ${input.tenantId}::uuid
        AND knowledge_base.tenant_id = ${input.tenantId}::uuid
        AND knowledge_base.id = ${input.knowledgeBaseId}::uuid
        AND knowledge_base.status = 'ENABLED'
        AND document.status = 'READY'
        AND document.status NOT IN ('DELETING', 'FAILED')
        AND document_index.status = 'ACTIVE'
        AND chunk.document_index_id = document_index.id
        AND 1 - (chunk.embedding <=> ${vector}::vector) >= ${input.minimumScore}
      ORDER BY chunk.embedding <=> ${vector}::vector ASC, chunk.id ASC
      LIMIT ${input.topK}
    `);
  }
}

function assertVector(vector: readonly number[]): void {
  if (vector.length !== 1536 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error('invalid query embedding');
  }
}
