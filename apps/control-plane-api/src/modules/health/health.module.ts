import { Module } from '@nestjs/common';

import { DatabaseModule } from '@/infrastructure/database/database.module';

import { HealthController } from './health.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [HealthController],
})
export class HealthModule {}
