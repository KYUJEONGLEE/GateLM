-- Local-only backfill for accounts created before tenant_admin/project_admin
-- access rows existed.
--
-- Intended use:
--   psql "$DATABASE_URL" -f scripts/dev/backfill-local-tenant-admins.sql
--
-- The script promotes only active, email-verified users that do not already
-- have tenant_admin or project_admin access in the target tenant. It keeps
-- tenant_memberships and tenant_admins in sync because different console
-- paths still read both tables.

create extension if not exists "pgcrypto";

with target_tenant as (
  select t."id"
  from "tenants" t
  order by
    case
      when t."id" = '00000000-0000-4000-8000-000000000100'::uuid then 0
      else 1
    end,
    t."createdAt" asc,
    t."id" asc
  limit 1
),
eligible_users as (
  select
    u."id" as "userId",
    u."email",
    tt."id" as "tenantId"
  from "users" u
  cross join target_tenant tt
  where u."deletedAt" is null
    and u."status" = 'active'
    and u."emailVerifiedAt" is not null
    and not exists (
      select 1
      from "tenant_admins" ta
      where ta."tenantId" = tt."id"
        and ta."userId" = u."id"
    )
    and not exists (
      select 1
      from "project_admins" pa
      where pa."tenantId" = tt."id"
        and pa."userId" = u."id"
    )
),
updated_memberships as (
  update "tenant_memberships" tm
  set
    "role" = 'tenant_admin',
    "status" = 'active',
    "joinedAt" = coalesce(tm."joinedAt", current_timestamp),
    "updatedAt" = current_timestamp,
    "deletedAt" = null
  from eligible_users eu
  where tm."tenantId" = eu."tenantId"
    and tm."userId" = eu."userId"
    and tm."deletedAt" is null
  returning
    tm."tenantId",
    tm."userId"
),
inserted_memberships as (
  insert into "tenant_memberships" (
    "id",
    "tenantId",
    "userId",
    "role",
    "status",
    "joinedAt",
    "createdAt",
    "updatedAt",
    "deletedAt"
  )
  select
    gen_random_uuid(),
    eu."tenantId",
    eu."userId",
    'tenant_admin',
    'active',
    current_timestamp,
    current_timestamp,
    current_timestamp,
    null
  from eligible_users eu
  where not exists (
      select 1
      from updated_memberships um
      where um."tenantId" = eu."tenantId"
        and um."userId" = eu."userId"
    )
    and not exists (
      select 1
      from "tenant_memberships" tm
      where tm."tenantId" = eu."tenantId"
        and tm."userId" = eu."userId"
        and tm."deletedAt" is null
    )
  returning
    "tenantId",
    "userId"
),
inserted_tenant_admins as (
  insert into "tenant_admins" (
    "tenantId",
    "userId",
    "createdAt",
    "updatedAt"
  )
  select
    eu."tenantId",
    eu."userId",
    current_timestamp,
    current_timestamp
  from eligible_users eu
  on conflict ("tenantId", "userId") do nothing
  returning
    "tenantId",
    "userId"
)
select
  (select "id" from target_tenant) as "targetTenantId",
  (select count(*) from eligible_users) as "eligibleUserCount",
  (select count(*) from updated_memberships) as "updatedMembershipCount",
  (select count(*) from inserted_memberships) as "insertedMembershipCount",
  (select count(*) from inserted_tenant_admins) as "insertedTenantAdminCount";
