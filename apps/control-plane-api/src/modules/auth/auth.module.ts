import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { DatabaseModule } from '@/infrastructure/database/database.module';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  AUTH_REPOSITORY,
  EMAIL_SENDER,
  GOOGLE_OAUTH_CLIENT,
} from './auth.tokens';
import { EmailSender, InMemoryEmailSender } from './email-sender';
import { GoogleOAuthHttpClient } from './google-oauth-client';
import { PrismaAuthRepository } from './prisma-auth.repository';
import { SmtpEmailSender } from './smtp-email-sender';

@Module({
  controllers: [AuthController],
  imports: [ConfigModule, DatabaseModule],
  providers: [
    AuthService,
    {
      provide: AUTH_REPOSITORY,
      useClass: PrismaAuthRepository,
    },
    {
      provide: EMAIL_SENDER,
      useFactory: (config: ConfigService): EmailSender => {
        if (config.get<string>('AUTH_EMAIL_TRANSPORT') === 'smtp') {
          return new SmtpEmailSender(config);
        }

        return new InMemoryEmailSender();
      },
      inject: [ConfigService],
    },
    {
      provide: GOOGLE_OAUTH_CLIENT,
      useClass: GoogleOAuthHttpClient,
    },
  ],
})
export class AuthModule {}
