import { Module } from '@nestjs/common';

import { DatabaseModule } from '@/infrastructure/database/database.module';
import { TenantChatIdentityModule } from '@/modules/tenant-chat-identity/tenant-chat-identity.module';

import { TenantChatRuntimeController } from './tenant-chat-runtime.controller';
import { TenantChatRuntimeService } from './tenant-chat-runtime.service';

@Module({
  controllers: [TenantChatRuntimeController],
  imports: [DatabaseModule, TenantChatIdentityModule],
  providers: [TenantChatRuntimeService],
  exports: [TenantChatRuntimeService],
})
export class TenantChatRuntimeModule {}
