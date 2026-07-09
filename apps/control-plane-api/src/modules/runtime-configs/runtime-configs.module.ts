import { Module } from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DatabaseModule } from '@/infrastructure/database/database.module';

import { RuntimeConfigsController } from './runtime-configs.controller';
import { RuntimeConfigsService } from './runtime-configs.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RuntimeConfigsController],
  providers: [RuntimeConfigsService, AdminAuthGuard],
})
export class RuntimeConfigsModule {}
