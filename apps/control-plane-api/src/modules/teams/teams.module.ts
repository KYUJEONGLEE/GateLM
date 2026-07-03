import { Module } from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DatabaseModule } from '@/infrastructure/database/database.module';

import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';

@Module({
  imports: [DatabaseModule],
  controllers: [TeamsController],
  providers: [TeamsService, AdminAuthGuard],
})
export class TeamsModule {}
