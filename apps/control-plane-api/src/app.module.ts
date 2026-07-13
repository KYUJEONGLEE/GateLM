import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { controlPlaneEnvFilePaths } from './config/env-file-paths';
import { validateEnv } from './config/env.schema';
import { DatabaseModule } from './infrastructure/database/database.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AppTokensModule } from './modules/app-tokens/app-tokens.module';
import { AuthModule } from './modules/auth/auth.module';
import { BudgetOperationsModule } from './modules/budget-operations/budget-operations.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { HealthModule } from './modules/health/health.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ProjectAdminsModule } from './modules/project-admins/project-admins.module';
import { ProviderConnectionsModule } from './modules/provider-connections/provider-connections.module';
import { RuntimeConfigsModule } from './modules/runtime-configs/runtime-configs.module';
import { TeamsModule } from './modules/teams/teams.module';
import { TenantChatRuntimeModule } from './modules/tenant-chat-runtime/tenant-chat-runtime.module';
import { TenantChatObservabilityModule } from './modules/tenant-chat-observability/tenant-chat-observability.module';
import { TenantsModule } from './modules/tenants/tenants.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: controlPlaneEnvFilePaths(),
      validate: validateEnv,
    }),
    DatabaseModule,
    TenantsModule,
    ProjectsModule,
    ProjectAdminsModule,
    ApplicationsModule,
    ProviderConnectionsModule,
    ApiKeysModule,
    AppTokensModule,
    AuthModule,
    BudgetOperationsModule,
    ConversationsModule,
    EmployeesModule,
    RuntimeConfigsModule,
    TenantChatRuntimeModule,
    TenantChatObservabilityModule,
    TeamsModule,
    HealthModule,
  ],
})
export class AppModule {}
