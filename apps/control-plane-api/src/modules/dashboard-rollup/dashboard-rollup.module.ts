import { Module } from '@nestjs/common';

import { DatabaseModule } from '@/infrastructure/database/database.module';

import { DashboardRollupService } from './dashboard-rollup.service';

@Module({
  imports: [DatabaseModule],
  providers: [DashboardRollupService],
  exports: [DashboardRollupService],
})
export class DashboardRollupModule {}
