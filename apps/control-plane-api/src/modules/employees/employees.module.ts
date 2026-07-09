import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DatabaseModule } from '@/infrastructure/database/database.module';
import { EMAIL_SENDER } from '@/modules/auth/auth.tokens';
import { EmailSender, InMemoryEmailSender } from '@/modules/auth/email-sender';
import { SmtpEmailSender } from '@/modules/auth/smtp-email-sender';

import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [EmployeesController],
  providers: [
    EmployeesService,
    AdminAuthGuard,
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
  ],
})
export class EmployeesModule {}
