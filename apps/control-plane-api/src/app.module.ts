import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { validateEnv } from './config/env.schema';
import { DatabaseModule } from './infrastructure/database/database.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { HealthModule } from './modules/health/health.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { ProviderConnectionsModule } from './modules/provider-connections/provider-connections.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    ProjectsModule,
    ApplicationsModule,
    ProviderConnectionsModule,
    HealthModule,
  ],
})
export class AppModule {}
