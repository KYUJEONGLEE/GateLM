# GateLM Observability Stack Evidence

## Goal

Prometheus scrapes the Gateway `/metrics` endpoint and Grafana automatically provisions a Gateway observability dashboard from the collected metrics.

## Scope

This evidence covers the local Docker Compose observability stack:

- Prometheus service
- Grafana service
- Prometheus Gateway scrape target
- Prometheus alert rules
- Grafana Prometheus datasource provisioning
- Grafana Gateway dashboard provisioning
- Smoke evidence script for the full Gateway -> Prometheus -> Grafana path

## Run

Start the Gateway separately on port `8080`, then start the observability stack:

```powershell
docker compose up -d prometheus grafana
```

Default local URLs:

| Component | URL |
| --- | --- |
| Gateway metrics | `http://localhost:8080/metrics` |
| Prometheus | `http://localhost:9090` |
| Grafana | `http://localhost:3005` |

Default Grafana local credentials:

| Key | Value |
| --- | --- |
| User | `admin` |
| Password | `admin` |

## Environment

| Variable | Default | Purpose |
| --- | --- | --- |
| `PROMETHEUS_PORT` | `9090` | Host port for Prometheus |
| `PROMETHEUS_RETENTION_TIME` | `24h` | Local Prometheus TSDB retention |
| `GRAFANA_PORT` | `3005` | Host port for Grafana |
| `GRAFANA_ADMIN_USER` | `admin` | Local Grafana admin user |
| `GRAFANA_ADMIN_PASSWORD` | `admin` | Local Grafana admin password |
| `GATELM_OBSERVABILITY_EVIDENCE_REPORT_DIR` | `reports/observability-stack-evidence` | Evidence report output directory |

Prometheus currently scrapes host.docker.internal:8080 from infra/observability/prometheus/prometheus.yml. Change that target in the config file if the Gateway runs somewhere else.

## Verify Manually

Prometheus target status:

```powershell
Invoke-WebRequest "http://localhost:9090/api/v1/targets?state=active" -UseBasicParsing
```

Prometheus Gateway query:

```powershell
Invoke-WebRequest "http://localhost:9090/api/v1/query?query=up%7Bjob%3D%22gatelm-gateway%22%7D" -UseBasicParsing
```

Grafana health:

```powershell
Invoke-WebRequest "http://localhost:3005/api/health" -UseBasicParsing
```

Grafana dashboard:

```text
http://localhost:3005/d/gatelm-gateway-overview/gatelm-gateway-observability
```

## Verify With Evidence Script

```powershell
corepack pnpm v2:observability:stack-evidence
```

The script checks:

- Gateway `/healthz` is reachable
- Synthetic Gateway request succeeds
- Prometheus `/-/healthy` is reachable
- Prometheus has the `gatelm-gateway` target
- Prometheus target health is `up`
- Prometheus queries return Gateway, Provider, Log, and Async Log samples
- Grafana `/api/health` is reachable
- Grafana datasource `gatelm-prometheus` is provisioned
- Grafana dashboard `gatelm-gateway-overview` is provisioned
- The dashboard has the expected panel set

Reports are written under `reports/observability-stack-evidence/` and are intentionally ignored by git.

## Dashboard Panels

The provisioned dashboard includes panels for:

- Gateway request rate
- Gateway p50/p95 latency
- In-flight requests
- Provider request rate
- Provider latency
- Cache lookup outcomes
- Rate limit decisions
- Masking actions
- Async log queue depth
- Async log enqueue/persist throughput
- Async log drops
- Async log persist latency
- Active streams
- Stream time to first token
- Stream relay outcomes

## Alert Rules

Prometheus loads local demo alert rules for:

- Gateway metrics target down
- Gateway high error rate
- Async log drops detected
- Async log queue backlog

These rules are local observability defaults for demo and development. External alert routing such as Slack, PagerDuty, or Alertmanager integration is intentionally out of scope for this PR.

## Out Of Scope

- Kubernetes or Helm deployment
- Production Grafana authentication hardening
- Alertmanager receiver integration
- Long-term metric remote write
- Loki log search
- New Gateway metric families
