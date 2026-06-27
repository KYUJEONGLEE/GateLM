import { Module } from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DatabaseModule } from '@/infrastructure/database/database.module';

import { ProviderConnectionsController } from './provider-connections.controller';
import { ProviderConnectionsService } from './provider-connections.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ProviderConnectionsController],
  providers: [ProviderConnectionsService, AdminAuthGuard],
})
export class ProviderConnectionsModule {}
