import { Module } from '@nestjs/common';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DatabaseModule } from '@/infrastructure/database/database.module';

import { ConversationsController } from './conversations.controller';
import {
  ConversationsRepository,
  PrismaConversationsRepository,
} from './conversations.repository';
import { ConversationsService } from './conversations.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ConversationsController],
  providers: [
    ConversationsService,
    AdminAuthGuard,
    {
      provide: ConversationsRepository,
      useClass: PrismaConversationsRepository,
    },
  ],
})
export class ConversationsModule {}
