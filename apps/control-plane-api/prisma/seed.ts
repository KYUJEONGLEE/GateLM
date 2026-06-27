import { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';

const prisma = new PrismaClient();

const DEMO_TENANT_ID = '00000000-0000-4000-8000-000000000100';
const DEMO_PROJECT_ID = '00000000-0000-4000-8000-000000000200';
const DEMO_APPLICATION_ID = '00000000-0000-4000-8000-000000000300';
const DEMO_API_KEY_ID = '00000000-0000-4000-8000-000000000400';
const DEMO_APP_TOKEN_ID = '00000000-0000-4000-8000-000000000500';

function sha256(value: string): string {
  return createHash('sha256').update(value.trim(), 'utf8').digest('hex');
}

async function main(): Promise<void> {
  await prisma.tenant.upsert({
    where: { id: DEMO_TENANT_ID },
    update: {},
    create: {
      id: DEMO_TENANT_ID,
      name: 'Demo Tenant',
    },
  });

  await prisma.project.upsert({
    where: { id: DEMO_PROJECT_ID },
    update: {},
    create: {
      id: DEMO_PROJECT_ID,
      tenantId: DEMO_TENANT_ID,
      name: 'Customer Support',
    },
  });

  await prisma.application.upsert({
    where: { id: DEMO_APPLICATION_ID },
    update: {},
    create: {
      id: DEMO_APPLICATION_ID,
      tenantId: DEMO_TENANT_ID,
      projectId: DEMO_PROJECT_ID,
      name: 'Customer Demo App',
    },
  });

  await prisma.providerConnection.upsert({
    where: {
      projectId_provider: {
        projectId: DEMO_PROJECT_ID,
        provider: 'mock',
      },
    },
    update: {},
    create: {
      tenantId: DEMO_TENANT_ID,
      projectId: DEMO_PROJECT_ID,
      provider: 'mock',
      displayName: 'Mock Provider',
      baseUrl: 'http://mock-provider:8090',
      resolver: 'none',
    },
  });

  await prisma.gatewayApiKey.upsert({
    where: { id: DEMO_API_KEY_ID },
    update: {},
    create: {
      id: DEMO_API_KEY_ID,
      tenantId: DEMO_TENANT_ID,
      projectId: DEMO_PROJECT_ID,
      displayName: 'Demo API Key',
      prefix: 'gsk_live_',
      last4: '9xA1',
      secretHash: sha256('gsk_live_demo_only_9xA1'),
      scopes: ['chat:completions', 'models:read'],
    },
  });

  await prisma.appToken.upsert({
    where: { id: DEMO_APP_TOKEN_ID },
    update: {},
    create: {
      id: DEMO_APP_TOKEN_ID,
      tenantId: DEMO_TENANT_ID,
      projectId: DEMO_PROJECT_ID,
      applicationId: DEMO_APPLICATION_ID,
      displayName: 'Demo App Token',
      prefix: 'gat_app_',
      last4: '4tK2',
      secretHash: sha256('gat_app_demo_only_4tK2'),
      scopes: ['gateway:invoke'],
    },
  });
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
