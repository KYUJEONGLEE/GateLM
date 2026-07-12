import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { DatabaseModule } from '@/infrastructure/database/database.module';
import { AuthModule } from '@/modules/auth/auth.module';

import { TenantChatIdentityController } from './tenant-chat-identity.controller';
import { TenantChatIdentityService } from './tenant-chat-identity.service';
import { TenantChatServiceAuthGuard } from './tenant-chat-service-auth.guard';

@Module({
  controllers: [TenantChatIdentityController],
  imports: [ConfigModule, DatabaseModule, AuthModule],
  providers: [TenantChatIdentityService, TenantChatServiceAuthGuard],
})
export class TenantChatIdentityModule {}
