import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthController } from './auth/auth.controller';
import { ChatWebServiceGuard } from './auth/chat-web-service.guard';
import { ControlPlaneClient } from './auth/control-plane.client';
import { SessionService } from './auth/session.service';
import { validateEnv } from './config/env';
import { PrismaService } from './database/prisma.service';
import { HealthController } from './health.controller';

@Module({
  controllers: [AuthController, HealthController],
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv })],
  providers: [ChatWebServiceGuard, ControlPlaneClient, PrismaService, SessionService],
})
export class AppModule {}
