do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ux_projects_id_tenant_id'
      and conrelid = 'projects'::regclass
  ) then
    alter table projects
      add constraint ux_projects_id_tenant_id unique (id, tenant_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_applications_project_tenant'
      and conrelid = 'applications'::regclass
  ) then
    alter table applications
      add constraint fk_applications_project_tenant
      foreign key (project_id, tenant_id)
      references projects (id, tenant_id);
  end if;
end $$;

create index if not exists ix_api_keys_application_id
  on api_keys (application_id);

create index if not exists ix_app_tokens_application_id
  on app_tokens (application_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'ux_model_catalog_provider_model'
      and conrelid = 'model_catalog'::regclass
  ) then
    drop index if exists ux_model_catalog_provider_model;

    alter table model_catalog
      add constraint ux_model_catalog_provider_model unique (provider, model);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'fk_model_pricing_rules_model_catalog'
      and conrelid = 'model_pricing_rules'::regclass
  ) then
    alter table model_pricing_rules
      add constraint fk_model_pricing_rules_model_catalog
      foreign key (provider, model)
      references model_catalog (provider, model);
  end if;
end $$;
