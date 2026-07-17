import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { controlPlaneEnvFilePaths } from '@/config/env-file-paths';
import { DatabaseModule } from '@/infrastructure/database/database.module';
import { ControlPlaneTenantContentKeyService } from '@/modules/rag-documents/crypto/tenant-content-key.service';
import { RagDocumentsCryptoStartupService } from '@/modules/rag-documents/crypto/rag-documents-crypto-startup.service';
import { RagWrappingKeyProvider } from '@/modules/rag-documents/crypto/wrapping-key-provider';
import { createRagObjectStore } from '@/modules/rag-documents/rag-documents.module';
import { RAG_OBJECT_STORE } from '@/modules/rag-documents/storage';

import { AiServiceRagExtractionClient } from './rag-ai-extraction.client';
import { GatewayRagEmbeddingClient } from './rag-gateway-embedding.client';
import { RagDeletionProcessor } from './rag-deletion.processor';
import { RAG_EMBEDDING_CLIENT, RAG_EXTRACTION_CLIENT, RagIngestionProcessor } from './rag-ingestion.processor';
import { RagJobRepository } from './rag-job.repository';
import { RagWorkloadCredentials } from './rag-workload-credentials';
import { RagWorkerProfileStartupService } from './rag-worker-profile-startup.service';
import { RagWorkerSettings } from './rag-worker-settings';
import { RagWorkerService } from './rag-worker.service';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: controlPlaneEnvFilePaths() }),
    DatabaseModule,
  ],
  providers: [
    RagWrappingKeyProvider,
    ControlPlaneTenantContentKeyService,
    RagDocumentsCryptoStartupService,
    RagWorkerSettings,
    RagWorkerProfileStartupService,
    RagWorkloadCredentials,
    RagJobRepository,
    RagIngestionProcessor,
    RagDeletionProcessor,
    RagWorkerService,
    AiServiceRagExtractionClient,
    GatewayRagEmbeddingClient,
    {
      provide: RAG_OBJECT_STORE,
      inject: [ConfigService],
      useFactory: createRagObjectStore,
    },
    { provide: RAG_EXTRACTION_CLIENT, useExisting: AiServiceRagExtractionClient },
    { provide: RAG_EMBEDDING_CLIENT, useExisting: GatewayRagEmbeddingClient },
  ],
})
export class RagWorkerModule {}
