create index if not exists ix_p0_llm_invocation_logs_employee_usage
  on p0_llm_invocation_logs (
    tenant_id,
    project_id,
    end_user_id,
    created_at desc
  );
