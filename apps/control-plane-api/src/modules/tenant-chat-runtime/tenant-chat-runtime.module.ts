import { Module } from '@nestjs/common';

import { DatabaseModule } from '@/infrastructure/database/database.module';

import { TenantChatRuntimeService } from './tenant-chat-runtime.service';

@Module({
  imports: [DatabaseModule],
  providers: [TenantChatRuntimeService],
  exports: [TenantChatRuntimeService],
})
export class TenantChatRuntimeModule {}
