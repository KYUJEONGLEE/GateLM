import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import {
  RAG_EMBEDDING_PROFILE,
  RagEmbeddingProfileMismatchError,
} from '@gatelm/rag-config';

import { PrismaService } from '@/database/prisma.service';

@Injectable()
export class RagProfileStartupService implements OnApplicationBootstrap {
  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const mismatch = await this.prisma.ragKnowledgeBase.findFirst({
      where: {
        OR: [
          { embeddingProvider: { not: RAG_EMBEDDING_PROFILE.provider } },
          { embeddingModel: { not: RAG_EMBEDDING_PROFILE.model } },
          { embeddingDimensions: { not: RAG_EMBEDDING_PROFILE.dimensions } },
          {
            embeddingProfileVersion: {
              not: RAG_EMBEDDING_PROFILE.profileVersion,
            },
          },
          { embeddingDistance: { not: RAG_EMBEDDING_PROFILE.distanceMetric } },
        ],
      },
      select: { id: true },
    });
    if (mismatch) {
      throw new RagEmbeddingProfileMismatchError();
    }
  }
}
