import { Module } from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DatabaseModule } from '@/infrastructure/database/database.module';

import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [DatabaseModule],
  controllers: [TenantsController],
  providers: [TenantsService, AdminAuthGuard],
})
export class TenantsModule {}
