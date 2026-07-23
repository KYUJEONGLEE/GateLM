import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AdminAuthGuard } from '@/common/guards/admin-auth.guard';
import { DatabaseModule } from '@/infrastructure/database/database.module';
import { EMAIL_SENDER } from '@/modules/auth/auth.tokens';
import { EmailSender, InMemoryEmailSender } from '@/modules/auth/email-sender';
import { SmtpEmailSender } from '@/modules/auth/smtp-email-sender';
import { TenantChatIdentityModule } from '@/modules/tenant-chat-identity/tenant-chat-identity.module';

import { EmployeesController } from './employees.controller';
import { ClickHouseEmployeeUsageReader } from './clickhouse-employee-usage.reader';
import { EmployeeUsageService } from './employee-usage.service';
import { EmployeeSecurityService } from './employee-security.service';
import { EmployeesService } from './employees.service';
import { TenantChatUsageRankingController } from './tenant-chat-usage-ranking.controller';

@Module({
  imports: [ConfigModule, DatabaseModule, TenantChatIdentityModule],
  controllers: [EmployeesController, TenantChatUsageRankingController],
  providers: [
    EmployeesService,
    ClickHouseEmployeeUsageReader,
    EmployeeUsageService,
    EmployeeSecurityService,
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
