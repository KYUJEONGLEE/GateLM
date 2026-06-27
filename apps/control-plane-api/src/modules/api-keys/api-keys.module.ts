import { Module } from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DatabaseModule } from '@/infrastructure/database/database.module';

import { ApiKeysController } from './api-keys.controller';
import { ApiKeysService } from './api-keys.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ApiKeysController],
  providers: [ApiKeysService, AdminAuthGuard],
})
export class ApiKeysModule {}
