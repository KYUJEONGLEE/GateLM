import { NestFactory } from '@nestjs/core';
import 'reflect-metadata';

import { RagWorkerModule } from './rag-worker/rag-worker.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(RagWorkerModule);
  app.enableShutdownHooks();
}

void bootstrap();
