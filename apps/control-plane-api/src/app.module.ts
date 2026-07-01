import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { controlPlaneEnvFilePaths } from './config/env-file-paths';
import { validateEnv } from './config/env.schema';
import { DatabaseModule } from './infrastructure/database/database.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AppTokensModule } from './modules/app-tokens/app-tokens.module';
import { HealthModule } from './modules/health/health.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ProviderConnectionsModule } from './modules/provider-connections/provider-connections.module';
import { RuntimeConfigsModule } from './modules/runtime-configs/runtime-configs.module';
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
    ApplicationsModule,
    ProviderConnectionsModule,
    ApiKeysModule,
    AppTokensModule,
    RuntimeConfigsModule,
    HealthModule,
  ],
})
export class AppModule {}
