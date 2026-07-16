import { Module } from '@nestjs/common';

import { DatabaseModule } from '@/infrastructure/database/database.module';

import { RagProfileStartupService } from './rag-profile-startup.service';

@Module({
  imports: [DatabaseModule],
  providers: [RagProfileStartupService],
})
export class RagConfigModule {}
