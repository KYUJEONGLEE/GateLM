import { Module } from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DatabaseModule } from '@/infrastructure/database/database.module';

import { TenantChatObservabilityController } from './tenant-chat-observability.controller';
import { TenantChatObservabilityService } from './tenant-chat-observability.service';
import { TenantChatProjectionService } from './tenant-chat-projection.service';

@Module({
  imports: [DatabaseModule],
  controllers: [TenantChatObservabilityController],
  providers: [
    AdminAuthGuard,
    TenantChatObservabilityService,
    TenantChatProjectionService,
  ],
  exports: [TenantChatProjectionService],
})
export class TenantChatObservabilityModule {}
