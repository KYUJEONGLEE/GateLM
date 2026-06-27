alter table gateway_rate_limit_counters
  drop constraint if exists gateway_rate_limit_counters_tenant_id_fkey;

alter table gateway_rate_limit_counters
  add constraint gateway_rate_limit_counters_tenant_id_fkey
  foreign key (tenant_id)
  references tenants(id)
  on delete cascade;

alter table gateway_rate_limit_counters
  drop constraint if exists gateway_rate_limit_counters_application_id_fkey;

alter table gateway_rate_limit_counters
  add constraint gateway_rate_limit_counters_application_id_fkey
  foreign key (application_id)
  references applications(id)
  on delete cascade;
