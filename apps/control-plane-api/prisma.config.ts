import { defineConfig } from 'prisma/config';

const databaseUrl =
  process.env.DATABASE_URL ??
  'postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public';

export default defineConfig({
  schema: './prisma/schema.prisma',
  seed: 'ts-node -r tsconfig-paths/register prisma/seed.ts',
  engine: 'classic',
  datasource: {
    url: databaseUrl,
  },
});
