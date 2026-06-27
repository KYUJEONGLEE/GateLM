import { Module } from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DatabaseModule } from '@/infrastructure/database/database.module';

import { AppTokensController } from './app-tokens.controller';
import { AppTokensService } from './app-tokens.service';

@Module({
  imports: [DatabaseModule],
  controllers: [AppTokensController],
  providers: [AppTokensService, AdminAuthGuard],
})
export class AppTokensModule {}
