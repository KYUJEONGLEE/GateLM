alter table if exists p0_llm_invocation_logs
  add column if not exists ttft_ms int null;

do $$
begin
  if to_regclass('p0_llm_invocation_logs') is not null then
    if not exists (
      select 1
      from pg_constraint
      where conrelid = to_regclass('p0_llm_invocation_logs')
        and conname = 'ck_p0_llm_invocation_logs_ttft_non_negative'
    ) then
      -- NOT VALID avoids a full scan of the existing invocation log table during deploy.
      -- PostgreSQL still enforces this CHECK for newly inserted or updated rows.
      alter table p0_llm_invocation_logs
        add constraint ck_p0_llm_invocation_logs_ttft_non_negative
        check (ttft_ms is null or ttft_ms >= 0) not valid;
    end if;
  end if;
end
$$;
