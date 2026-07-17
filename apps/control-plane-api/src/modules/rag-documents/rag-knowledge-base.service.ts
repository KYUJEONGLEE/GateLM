import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RAG_EMBEDDING_PROFILE } from '@gatelm/rag-config';
import { Prisma } from '@prisma/client';

import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';

import type { RagKnowledgeBaseResponseDto } from './dto/rag-knowledge-base.dto';

@Injectable()
export class RagKnowledgeBaseService {
  private readonly globalEnabled: boolean;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.globalEnabled =
      config.get<string>('TENANT_CHAT_RAG_ENABLED') === 'true';
  }

  async getSettings(tenantId: string): Promise<RagKnowledgeBaseResponseDto> {
    try {
      const knowledgeBase = await this.prisma.ragKnowledgeBase.findUnique({
        where: { tenantId },
        select: { status: true },
      });
      return this.toResponse(knowledgeBase?.status === 'ENABLED');
    } catch {
      throw unavailable();
    }
  }

  async updateSettings(
    tenantId: string,
    enabled: boolean,
  ): Promise<RagKnowledgeBaseResponseDto> {
    const status = enabled ? 'ENABLED' : 'DISABLED';
    try {
      const knowledgeBase = await this.prisma.ragKnowledgeBase.upsert({
        where: { tenantId },
        create: {
          tenantId,
          status,
          embeddingProvider: RAG_EMBEDDING_PROFILE.provider,
          embeddingModel: RAG_EMBEDDING_PROFILE.model,
          embeddingDimensions: RAG_EMBEDDING_PROFILE.dimensions,
          embeddingDistance: RAG_EMBEDDING_PROFILE.distanceMetric,
          embeddingProfileVersion: RAG_EMBEDDING_PROFILE.profileVersion,
        },
        update: { status },
        select: { status: true },
      });
      return this.toResponse(knowledgeBase.status === 'ENABLED');
    } catch (error) {
      // A first upload and the first settings update can race while both
      // ensure the tenant singleton. If the other transaction wins the
      // unique tenant key, apply the requested status to that committed row.
      if (isUniqueViolation(error)) {
        try {
          const knowledgeBase = await this.prisma.ragKnowledgeBase.update({
            where: { tenantId },
            data: { status },
            select: { status: true },
          });
          return this.toResponse(knowledgeBase.status === 'ENABLED');
        } catch {
          // Normalize the failed recovery below without exposing DB details.
        }
      }
      throw unavailable();
    }
  }

  private toResponse(tenantEnabled: boolean): RagKnowledgeBaseResponseDto {
    return {
      tenantEnabled,
      globalEnabled: this.globalEnabled,
      effectiveEnabled: this.globalEnabled && tenantEnabled,
    };
  }
}

function isUniqueViolation(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function unavailable(): ServiceUnavailableException {
  return new ServiceUnavailableException({
    code: 'RAG_KNOWLEDGE_BASE_UNAVAILABLE',
    message: 'Knowledge Base settings are temporarily unavailable.',
  });
}
