# GateLM v1.0.0 k6 Baseline Report

## 범위

이 문서는 Gateway v1.0.0 baseline main flow 기준 k6 baseline 실행 결과와 관측 증거를 정리한다. 사용한 API는 기존 계약에 있는 아래 endpoint뿐이다.

```text
POST /v1/chat/completions
GET /metrics
GET /api/projects/{projectId}/logs
GET /api/dashboard/overview
```

이 baseline은 API, DB, Event/Log, Metrics schema를 변경하지 않는다. 기존 `/metrics` endpoint를 소비해서 아래 흐름을 숫자로 확인한다.

```text
safe request -> provider call
same safe request -> cache_hit / provider bypass
blocked request -> provider/cache lookup 전 차단
/metrics -> request/cache/provider/masking/log 지표 증가 확인
```

## 실행 환경

기본 로컬 baseline 환경은 아래와 같다.

```text
Gateway: http://localhost:8080
Mock Provider: http://localhost:8090
Project ID: 00000000-0000-4000-8000-000000000200
PostgreSQL: docker compose postgres
Redis: docker compose redis
k6: local executable
```

Credential 처리 기준:

```text
GATELM_DEMO_API_KEY / GATELM_DEMO_APP_TOKEN은 env로 주입할 수 있다.
env가 없으면 gateway-core 기본 demo redacted credential을 사용한다.
실제 secret이나 개인정보는 baseline 요청에 사용하지 않는다.
Authorization/App Token 원문은 이 report에 기록하지 않는다.
```

## 실행 명령

의존 컨테이너 실행:

```powershell
docker compose up -d postgres redis mock-provider
```

다른 PowerShell에서 Gateway 실행:

```powershell
$repoRoot = "C:\path\to\GateLM"
cd "$repoRoot\apps\gateway-core"
$env:GATEWAY_PORT="8080"
go run ./cmd/gateway
```

v1.0.0 baseline 실행:

```powershell
$repoRoot = "C:\path\to\GateLM"
cd $repoRoot
.\scripts\dev\v1-k6-baseline.ps1 -GatewayBaseUrl http://localhost:8080
```

wrapper는 k6 실행 전에 기존 local demo migration과 seed를 적용한다. 로컬 schema가 이미 준비되어 있을 때만 `-SkipDbPrepare`를 사용한다.

직접 k6를 실행하려면 아래 명령을 사용할 수 있다.

```powershell
$env:GATEWAY_BASE_URL="http://localhost:8080"
k6 run .\scripts\perf\k6-gateway-baseline.js
```

## k6 시나리오

```text
safe_miss_warmup:
  unique safe prompt 1회 전송
  HTTP 200 확인
  X-GateLM-Cache-Status=miss 확인
  provider metric 증가 확인

safe_cache_hit_baseline:
  warm-up 이후 같은 safe prompt 반복 전송
  HTTP 200 확인
  X-GateLM-Cache-Status=hit 확인
  provider metric이 추가 증가하지 않는지 확인

blocked_before_provider:
  synthetic api_key marker 전송
  HTTP 403 sensitive_data_blocked 확인
  X-GateLM-Cache-Status=bypass 확인
  provider/cache metric이 증가하지 않는지 확인

metrics_probe:
  GET /metrics 호출
  필수 metric family 노출 확인
  forbidden metric label이 없는지 확인
```

`blocked_before_provider`의 403은 실패가 아니라 기대 결과로 처리한다.

## 필수 Metrics 증거

baseline은 아래 metric family가 `/metrics`에 노출되는지 확인한다.

```text
gatelm_gateway_requests_total
gatelm_gateway_request_duration_seconds
gatelm_gateway_inflight_requests
gatelm_provider_requests_total
gatelm_provider_request_duration_seconds
gatelm_cache_operations_total
gatelm_rate_limit_decisions_total
gatelm_rate_limit_decision_duration_seconds
gatelm_masking_actions_total
gatelm_log_writes_total
gatelm_log_write_duration_seconds
```

기대하는 증거 형태:

```text
safe miss:
  gatelm_gateway_requests_total{status="success", http_status="200"} 증가
  gatelm_provider_requests_total{status="success", http_status="200"} 증가
  gatelm_cache_operations_total{operation="lookup", cache_status="miss", cache_type="exact"} 증가

cache hit:
  gatelm_gateway_requests_total{status="cache_hit", http_status="200"} 증가
  gatelm_cache_operations_total{operation="lookup", cache_status="hit", cache_type="exact"} 증가
  cache hit 확인 중 gatelm_provider_requests_total은 증가하지 않음

blocked:
  gatelm_gateway_requests_total{status="blocked", http_status="403", error_code="sensitive_data_blocked"} 증가
  gatelm_masking_actions_total{masking_action="blocked"} 증가
  blocked request 처리 중 gatelm_provider_requests_total은 증가하지 않음
  blocked request 처리 중 gatelm_cache_operations_total은 증가하지 않음
```

아래 forbidden label은 metrics에 나타나면 안 된다.

```text
request_id
trace_id
tenant_id
project_id
application_id
api_key_id
app_token_id
end_user_id
feature_id
prompt
prompt_hash
cache_key_hash
authorization
```

## 최신 Baseline 결과

상태:

```text
2026-06-28 20:18 Asia/Seoul 로컬 실행 확인 완료.
GatewayBaseUrl=http://localhost:18180
k6=v2.0.0
```

k6 요약:

```text
checks:              46 / 46, 100.00%
http_req_failed:     0 / 17, 0.00%
http_req_duration:   p95=53.7ms
http_reqs:           17, 0.849149/s
iterations:          6
```

k6가 출력한 metric delta:

```text
safe miss provider_requests_total:       0 -> 1
cache hit provider_requests_total:       1 -> 1
cache hit provider_requests_total:       1 -> 1
cache hit provider_requests_total:       1 -> 1
blocked provider_requests_total:         1 -> 1
blocked cache_operations_total:          5 -> 5
```

cache hit 증거:

```text
같은 safe prompt 반복 요청은 cache_hit이 되었고,
cache hit 동안 gatelm_provider_requests_total은 1에서 증가하지 않았다.
즉, cache hit 요청은 provider call을 우회했다.
```

blocked 증거:

```text
synthetic credential-like request는 403 sensitive_data_blocked로 차단되었다.
차단 처리 중 provider request count와 cache operation count는 증가하지 않았다.
즉, blocked request는 provider/cache lookup 전에 차단되었다.
```

## Request Log / Dashboard 증거

로컬 실행 후 아래 API로 확인할 수 있다.

```text
GET /api/projects/00000000-0000-4000-8000-000000000200/logs?from=<run-from>&to=<run-to>&limit=50
GET /api/dashboard/overview?projectId=00000000-0000-4000-8000-000000000200&from=<run-from>&to=<run-to>
```

Request Log 기대 증거:

```text
safe warm-up request:
  status=success
  httpStatus=200
  cacheStatus=miss

cache hit request:
  status=cache_hit
  httpStatus=200
  cacheStatus=hit

blocked request:
  status=blocked
  httpStatus=403
  errorCode=sensitive_data_blocked
  cacheStatus=bypass
```

Dashboard Overview 기대 증거:

```text
totalRequests가 baseline request 수만큼 증가한다.
successfulRequests에 success와 cache_hit이 포함된다.
blockedRequests가 blocked request만큼 증가한다.
같은 safe prompt 반복 후 cacheHitRequests가 증가한다.
statusCounts.success, statusCounts.cache_hit, statusCounts.blocked가 반영된다.
```

최신 로컬 Request Log 증거:

```text
range: 2026-06-28T11:12:55Z -> 2026-06-28T11:32:55Z

success:
  requestId=request_fd38d676224d82f82c458077498afc2f
  httpStatus=200
  cacheStatus=miss
  selectedProvider=mock
  selectedModel=mock-fast

cache_hit:
  requestIds=3
  httpStatus=200
  cacheStatus=hit
  selectedProvider=mock
  selectedModel=mock-fast

blocked:
  requestId=request_a5cc8a83da9d90ef355c1e5012bedf1d
  httpStatus=403
  cacheStatus=bypass
  maskingAction=blocked
```

최신 로컬 Dashboard Overview 증거:

```text
range: 2026-06-28T11:12:55Z -> 2026-06-28T11:32:55Z

totalRequests: 5
successfulRequests: 4
failedRequests: 0
blockedRequests: 1
rateLimitedRequests: 0
cacheHitRequests: 3
cacheEligibleRequests: 4
cacheHitRate: 0.75
statusCounts.success: 1
statusCounts.cache_hit: 3
statusCounts.blocked: 1
averageLatencyMs: 44.4
p95LatencyMs: 200
dataFreshness.source: postgresql_request_log
```

## Rate Limit 참고

Rate limit metric 기록은 Gateway handler smoke와 local stack smoke에서 검증했다. 이번 live k6 baseline에서는 rate limit overflow를 강제로 만들지 않는다. 강제로 초과시키면 현재 PostgreSQL fixed-window counter 상태와 환경별 limit 설정에 따라 baseline이 불안정해질 수 있기 때문이다.

live rate-limit 증거가 필요하면 `GATEWAY_RATE_LIMIT_LIMIT`을 의도적으로 낮춘 별도 focused scenario로 실행하고, 후속 evidence path로 문서화한다.

## 현재 한계

```text
Metrics는 process memory 기반이라 Gateway 재시작 시 reset된다.
Prometheus/Grafana scraping 구성은 v1.0.0 baseline 범위 밖이다.
Metric delta 비교는 같은 시간대에 unrelated Gateway traffic이 없다는 전제를 둔다.
이 report는 synthetic prompt만 사용하며, production DLP 또는 production performance coverage를 주장하지 않는다.
```

## v2 Evidence Path

```text
Prometheus scrape config와 Grafana dashboard
제어된 rate-limit overflow를 포함한 장시간 k6 soak
cache miss, cache hit, blocked, rate_limited outcome별 latency baseline 분리
CI에서 실행 가능한 k6 smoke gate와 sanitized summary artifact
```
