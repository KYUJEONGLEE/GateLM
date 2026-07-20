-- Keep dashboard rollup discovery and hourly rebuild cost bounded as the raw
-- invocation table grows. CONCURRENTLY avoids blocking Gateway writes while
-- these indexes are built on an existing installation.
--
-- This file must be executed by psql without an enclosing transaction. Native
-- PostgreSQL does not support CREATE INDEX CONCURRENTLY on a partitioned parent,
-- so repeat deployments select the compatible form from the relation kind.

select (relkind = 'p')::text as p0_logs_partitioned
from pg_class
where oid = 'public.p0_llm_invocation_logs'::regclass
\gset

\if :p0_logs_partitioned
  create index if not exists ix_p0_llm_invocation_logs_ingested_request
    on p0_llm_invocation_logs (ingested_at, request_id);

  create index if not exists ix_p0_llm_invocation_logs_tenant_created
    on p0_llm_invocation_logs (tenant_id, created_at);
\else
  create index concurrently if not exists ix_p0_llm_invocation_logs_ingested_request
    on p0_llm_invocation_logs (ingested_at, request_id);

  create index concurrently if not exists ix_p0_llm_invocation_logs_tenant_created
    on p0_llm_invocation_logs (tenant_id, created_at);
\endif
