import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthController } from './auth/auth.controller';
import { ChatWebServiceGuard } from './auth/chat-web-service.guard';
import { ControlPlaneClient } from './auth/control-plane.client';
import { SessionService } from './auth/session.service';
import { validateEnv } from './config/env';
import { ContentIntegrityService } from './content/content-integrity.service';
import { ActiveTurnRegistry } from './content/active-turn-registry';
import { ConversationController } from './content/conversation.controller';
import { ConversationService } from './content/conversation.service';
import { CursorCodec } from './content/cursor-codec';
import { EncryptedChatStore } from './content/encrypted-chat-store';
import { RetentionService } from './content/retention.service';
import { TenantContentKeyService } from './content/tenant-content-key.service';
import { WrappingKeyProvider } from './content/wrapping-key-provider';
import { PrismaService } from './database/prisma.service';
import { ExecutionBridgeService } from './execution/execution-bridge.service';
import { PrivateGatewayClient } from './execution/private-gateway.client';
import { WorkloadCredentialsService } from './execution/workload-credentials';
import { WorkloadSigner } from './execution/workload-signer';
import { HealthController } from './health.controller';
import { RagProfileStartupService } from './rag/rag-profile-startup.service';
import { RagEmbeddingClient } from './rag/rag-embedding.client';
import { RagContextBuilder } from './rag/rag-context.builder';
import { RagQueryCredentialsService } from './rag/rag-query-credentials.service';
import { RagQueryWorkloadSigner } from './rag/rag-query-workload-signer';
import { RagRetrievalRepository } from './rag/rag-retrieval.repository';
import { RagRetrievalService } from './rag/rag-retrieval.service';

@Module({
  controllers: [AuthController, ConversationController, HealthController],
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
  providers: [
    ActiveTurnRegistry,
    ChatWebServiceGuard,
    ContentIntegrityService,
    ConversationService,
    ControlPlaneClient,
    CursorCodec,
    EncryptedChatStore,
    ExecutionBridgeService,
    PrismaService,
    PrivateGatewayClient,
    RagContextBuilder,
    RagEmbeddingClient,
    RagProfileStartupService,
    RagQueryCredentialsService,
    RagQueryWorkloadSigner,
    RagRetrievalRepository,
    RagRetrievalService,
    RetentionService,
    SessionService,
    TenantContentKeyService,
    WorkloadCredentialsService,
    WorkloadSigner,
    WrappingKeyProvider,
  ],
})
export class AppModule {}
