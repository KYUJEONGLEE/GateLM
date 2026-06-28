import { Module } from '@nestjs/common';

import { DatabaseModule } from '@/infrastructure/database/database.module';

import { RuntimeConfigsController } from './runtime-configs.controller';
import { RuntimeConfigsService } from './runtime-configs.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RuntimeConfigsController],
  providers: [RuntimeConfigsService],
})
export class RuntimeConfigsModule {}
