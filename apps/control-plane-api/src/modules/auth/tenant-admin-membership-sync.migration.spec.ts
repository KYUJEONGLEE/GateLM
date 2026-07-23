import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  __dirname,
  '../../../prisma/migrations/20260723223000_tenant_chat_admin_membership_sync/migration.sql',
);
const authSessionMigrationPath = resolve(
  __dirname,
  '../../../prisma/migrations/20260713090000_tenant_chat_auth_session/migration.sql',
);
const migrationSql = readFileSync(migrationPath, 'utf8');
const authSessionMigrationSql = readFileSync(authSessionMigrationPath, 'utf8');
const compactSql = migrationSql.replace(/\s+/g, ' ').trim();

describe('Tenant Chat admin account linkage migration', () => {
  it('promotes only an existing TenantAdmin relation to canonical tenant_admin membership', () => {
    expect(compactSql).toContain(
      'UPDATE "tenant_memberships" AS membership SET "role" = \'tenant_admin\', "status" = \'active\'',
    );
    expect(compactSql).toContain('FROM "tenant_admins" AS admin');
    expect(compactSql).toContain(
      'membership."tenantId" = admin."tenantId" AND membership."userId" = admin."userId"',
    );
    expect(migrationSql).not.toMatch(/"email"/i);
  });

  it('inserts missing memberships and legacy projections without creating Employee records', () => {
    expect(compactSql).toContain('INSERT INTO "tenant_memberships"');
    expect(compactSql).toContain('INSERT INTO "tenant_admins"');
    expect(compactSql).toContain("membership.\"role\" = 'tenant_admin'");
    expect(migrationSql).not.toMatch(/"employees"/i);
  });

  it('is additive and avoids repeated updates of already aligned rows', () => {
    expect(migrationSql).not.toMatch(/^\s*(?:DELETE|TRUNCATE|DROP)\b/im);
    expect(compactSql).toContain(
      "membership.\"role\" IS DISTINCT FROM 'tenant_admin' OR membership.\"status\" IS DISTINCT FROM 'active' OR membership.\"deletedAt\" IS NOT NULL",
    );
    expect(migrationSql.match(/ON CONFLICT \("tenantId", "userId"\) DO NOTHING;/g)).toHaveLength(2);
  });

  it('uses the existing membership trigger to invalidate stale actor claims', () => {
    expect(authSessionMigrationSql).toContain(
      'CREATE TRIGGER tenant_chat_membership_actor_version',
    );
    expect(authSessionMigrationSql).toContain(
      'UPDATE "users" SET "actorAuthzVersion" = "actorAuthzVersion" + 1',
    );
  });
});
