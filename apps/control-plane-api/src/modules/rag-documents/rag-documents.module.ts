import { S3Client } from '@aws-sdk/client-s3';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DatabaseModule } from '@/infrastructure/database/database.module';

import { RagDocumentPrivateMetadataCodec } from './crypto/rag-document-private-metadata.codec';
import { RagDocumentsCryptoStartupService } from './crypto/rag-documents-crypto-startup.service';
import { ControlPlaneTenantContentKeyService } from './crypto/tenant-content-key.service';
import { RagWrappingKeyProvider } from './crypto/wrapping-key-provider';
import { RagDocumentsController } from './rag-documents.controller';
import { RagDocumentsService } from './rag-documents.service';
import {
  DisabledLocalRagObjectStore,
  RAG_OBJECT_STORE,
  RagUploadStreamService,
  S3RagObjectStore,
  type RagObjectStore,
} from './storage';
import { createIamRoleCredentialProvider } from './storage/iam-role-credentials';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [RagDocumentsController],
  providers: [
    AdminAuthGuard,
    RagWrappingKeyProvider,
    ControlPlaneTenantContentKeyService,
    RagDocumentPrivateMetadataCodec,
    RagDocumentsCryptoStartupService,
    RagUploadStreamService,
    RagDocumentsService,
    {
      provide: RAG_OBJECT_STORE,
      inject: [ConfigService],
      useFactory: createRagObjectStore,
    },
  ],
})
export class RagDocumentsModule {}

export function createRagObjectStore(config: ConfigService): RagObjectStore {
  if (config.get<string>('TENANT_CHAT_RAG_ENABLED') !== 'true') {
    return new DisabledLocalRagObjectStore();
  }
  if (config.getOrThrow<string>('RAG_OBJECT_STORE_DRIVER') === 'fake') {
    return new DisabledLocalRagObjectStore();
  }

  const endpoint = config.get<string>('RAG_S3_ENDPOINT')?.trim();
  const region = config.getOrThrow<string>('RAG_S3_REGION');
  const client = new S3Client({
    region,
    ...(endpoint ? { endpoint } : {}),
    ...(endpoint
      ? {}
      : {
          credentials: createIamRoleCredentialProvider(process.env, region),
        }),
    forcePathStyle: config.get<string>('RAG_S3_FORCE_PATH_STYLE') === 'true',
  });
  return new S3RagObjectStore(client, {
    bucket: config.getOrThrow<string>('RAG_S3_BUCKET'),
    kmsKeyId: config.getOrThrow<string>('RAG_S3_KMS_KEY_ID'),
  });
}
