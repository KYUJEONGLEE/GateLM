# GateLM Local Development Guide v0.1

## 문서 목적

이 문서는 GateLM P0를 로컬에서 실행하기 위한 기준이다. 개발자는 이 문서를 따라 동일한 환경을 띄우고, 같은 seed 데이터로 Gateway end-to-end 흐름을 검증해야 한다.

---

## 1. 로컬 개발 원칙

```text
1. 로컬 실행, 데모, 최종 검증은 Docker Compose 기준으로 한다.
2. P0는 mock provider만으로도 end-to-end 데모가 가능해야 한다.
3. 실제 Provider Key는 필수가 아니다.
4. .env 파일은 커밋하지 않는다.
5. 필요한 환경변수는 .env.example에만 문서화한다.
6. raw prompt, raw response, secret 원문을 log에 남기지 않는다.
7. 이번 P0에서는 Docker Compose 기반 로컬 인프라를 공식 기준으로 승인한다.
8. 로컬 Node/Go/Python 설치 버전은 보조 수단이며, 최종 기준은 Docker toolbox container다.
```

---

## 2. 권장 로컬 포트

| 서비스 | 포트 | 비고 |
|---|---:|---|
| Web Console | `3000` | Next.js |
| Control Plane API | `3001` | NestJS |
| Gateway Core | `8080` | Go |
| AI Service | `8000` | P1/P2, P0에서는 optional |
| Worker | 없음 | background process |
| PostgreSQL | `5432` | Control Plane |
| Redis | `6379` | cache, rate limit |
| Redpanda | `9092` | P1, P0 optional |
| ClickHouse | `8123`, `9000` | P1, P0 optional |
| Mock Provider | `8090` | local mock |

---

## 3. 필수 도구

```text
Docker + Docker Compose
Git
PostgreSQL client 선택
Redis client 선택
```

P0 공통 런타임 버전은 Docker로 고정한다.

```text
Node.js 22
pnpm 9.15.0
Go 1.24
Python 3.12
PostgreSQL 16
Redis 7
```

로컬에 Node/Go/Python을 직접 설치해도 되지만, 팀 공통 실행/테스트/데모 기준은 Docker Compose다.

---

## 4. 예상 monorepo 구조

```text
gatelm/
├── apps/
│   ├── web/
│   ├── control-plane-api/
│   ├── gateway-core/
│   ├── worker/
│   └── ai-service/
├── packages/
│   ├── contracts/
│   └── shared/
├── infra/
│   └── local/
├── docs/
├── docker-compose.yml
├── package.json
├── pnpm-workspace.yaml
└── .env.example
```

폴더 구조는 `folder-structure.md`를 우선한다.

---

## 5. `.env.example` 기준

루트 `.env.example`에는 실제 secret을 넣지 않는다.

```bash
# App
NODE_ENV=development
GATELM_ENV=local

# Runtime versions
NODE_VERSION=22
PNPM_VERSION=9.15.0
GO_VERSION=1.24
PYTHON_VERSION=3.12

# URLs
WEB_BASE_URL=http://localhost:3000
CONTROL_PLANE_API_URL=http://localhost:3001
GATEWAY_BASE_URL=http://localhost:8080
MOCK_PROVIDER_BASE_URL=http://localhost:8090

# Database
DATABASE_URL=postgresql://gatelm:gatelm@localhost:5432/gatelm?schema=public
REDIS_URL=redis://localhost:6379

# Optional analytics
REDPANDA_BROKERS=localhost:9092
CLICKHOUSE_URL=http://localhost:8123
CLICKHOUSE_DATABASE=gatelm
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=

# Local secret resolver
SECRET_STORE_MODE=local
LOCAL_PROVIDER_SECRET_VALUE=test_provider_key_redacted

# Gateway
GATEWAY_PORT=8080
GATEWAY_DEFAULT_PROVIDER=mock
GATEWAY_DEFAULT_MODEL=mock-balanced
GATEWAY_LOW_COST_MODEL=mock-fast
GATEWAY_APP_TOKEN_REQUIRED=true

# Mock provider
MOCK_PROVIDER_PORT=8090
MOCK_PROVIDER_DEFAULT_LATENCY_MS=150
MOCK_PROVIDER_ERROR_MODE=off
```

금지:

```text
실제 Provider Key
실제 고객 데이터
실제 JWT
실제 API Key
```

---

## 6. Docker Compose 최소 구성

P0 기본 실행 구성:

```text
postgres
redis
mock-provider
```

P0 고정 런타임 도구:

```text
node-toolbox
go-toolbox
python-toolbox
```

P1 구성:

```text
redpanda
clickhouse
```

`docker-compose.yml` 기준 서비스 이름은 아래를 따른다.

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: gatelm
      POSTGRES_PASSWORD: gatelm
      POSTGRES_DB: gatelm
    ports:
      - "5432:5432"

  redis:
    image: redis:7
    ports:
      - "6379:6379"

  mock-provider:
    image: python:3.12-alpine
    # P0 bootstrap용 lightweight mock service.
    # apps/mock-provider가 구현되면 build context 기반 service로 교체할 수 있다.
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8090/healthz', timeout=2).read()\""]
    ports:
      - "8090:8090"

  node-toolbox:
    profiles: ["tools"]
    build:
      context: .
      dockerfile: infra/docker/node/Dockerfile

  go-toolbox:
    profiles: ["tools"]
    build:
      context: .
      dockerfile: infra/docker/go/Dockerfile

  python-toolbox:
    profiles: ["tools"]
    build:
      context: .
      dockerfile: infra/docker/python/Dockerfile
```

P0에서는 PostgreSQL user/password/db 값을 `gatelm/gatelm/gatelm`으로 고정한다. 로컬 `.env`에 과거 값이 남아 있어도 DB identity 기준을 바꾸지 않는다.

P0 기본값은 별도 `mock-provider` service다. 현재 `docker-compose.yml`에 들어 있는 inline Python mock은 공통 로컬 환경을 빠르게 맞추기 위한 bootstrap mock이다. P0 acceptance용 mock-provider는 `docs/p0/mock-provider.md`의 stats/config/error/timeout 기준을 만족하도록 별도 구현체로 승격한다.

`MOCK_PROVIDER_PORT`는 host port override 용도다. bootstrap mock의 container listen port는 `8090`으로 고정한다. 포트를 바꾸는 경우 Gateway의 `MOCK_PROVIDER_BASE_URL`도 함께 바꾼다.

Gateway 내부 adapter는 `apps/mock-provider` 구현이 지연될 때만 임시 fallback으로 허용한다. fallback을 쓰는 경우에도 Provider 호출 횟수, latency, error mode, reset/config에 준하는 테스트 관측 기능은 유지해야 한다.

Toolbox container는 앱 소스가 생기기 전부터 팀의 언어 버전을 고정하기 위한 개발용 런타임이다. 앱별 Dockerfile이 추가되면 같은 버전 기준을 재사용한다.

버전 확인:

```bash
docker compose run --rm node-toolbox node --version
docker compose run --rm node-toolbox pnpm --version
docker compose run --rm go-toolbox go version
docker compose run --rm python-toolbox python --version
```

Node workspace가 생긴 뒤 dependency 설치와 테스트는 아래처럼 실행한다.

```bash
docker compose run --rm node-toolbox pnpm install
docker compose run --rm node-toolbox pnpm test
```

Gateway Go module이 생긴 뒤 테스트는 아래처럼 실행한다.

```bash
docker compose run --rm go-toolbox go test ./...
```

---

## 7. 최초 실행 순서

```bash
# 1. dependency 설치
docker compose run --rm node-toolbox pnpm install

# 2. 로컬 인프라 실행
docker compose up -d postgres redis mock-provider

# 3. DB migration
pnpm --filter @gatelm/control-plane-api db:migrate

# 4. seed data 생성
pnpm --filter @gatelm/control-plane-api db:seed

# 5. Control Plane API 실행
pnpm --filter @gatelm/control-plane-api dev

# 6. Gateway 실행
docker compose run --rm --service-ports go-toolbox go run ./apps/gateway-core/cmd/gateway

# 7. Web Console 실행
pnpm --filter @gatelm/web dev

# 8. Worker 실행, P0에서 필요한 경우
pnpm --filter @gatelm/worker dev
```

실제 script 이름은 구현 시 `package.json`에 맞춘다. 이 문서는 실행 순서의 기준이다.

---

## 8. Health Check

```bash
curl -sS http://localhost:3001/healthz
curl -sS http://localhost:8080/healthz
curl -sS http://localhost:8080/readyz
curl -sS http://localhost:8090/healthz
```

기대 결과:

```json
{"status":"ok"}
```

`readyz`는 dependency 상태를 확인한다.

```text
postgres: connected
redis: connected
mock-provider: reachable
redpanda: optional
clickhouse: optional
```

P0 `/readyz` 판정:

| Dependency | 필수 여부 | 전체 ready 실패 조건 |
|---|---:|---|
| PostgreSQL | Y | 연결 실패 시 실패 |
| Redis | Y | 연결 실패 시 실패 |
| Mock Provider 별도 service 또는 내부 mock adapter | Y | mock 호출 불가능 시 실패 |
| Redpanda | N | details에만 표시, 전체 실패 아님 |
| ClickHouse | N | details에만 표시, 전체 실패 아님 |

---

## 9. Seed 데이터 기준

P0 seed는 매번 같은 데모를 재현해야 한다.

| 리소스 | 기본값 |
|---|---|
| Admin email | `admin@example.invalid` |
| Admin password | `local-demo-password` |
| Tenant | `Example Corp` |
| Project | `Support Bot` |
| Application | `Support Web App` |
| Provider | `mock` |
| Default model | `mock-balanced` |
| Low-cost model | `mock-fast` |
| Expensive model | `mock-smart` |
| API Key preview | `glm_api_test...redacted` |
| App Token preview | `glm_app_token_test...redacted` |

Seed script는 원문 API Key/App Token을 `.local-seed-output.json` 같은 gitignored 파일에만 기록할 수 있다. 콘솔 출력도 데모 편의를 위한 1회 출력만 허용한다.

---

## 10. Gateway curl 검증

### 10.1 모델 목록

```bash
curl -sS http://localhost:8080/v1/models \
  -H 'Authorization: Bearer glm_api_test_redacted' \
  -H 'X-GateLM-App-Token: glm_app_token_test_redacted'
```

### 10.2 Chat Completion

```bash
curl -sS http://localhost:8080/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer glm_api_test_redacted' \
  -H 'X-GateLM-App-Token: glm_app_token_test_redacted' \
  -H 'X-GateLM-End-User-Id: user_demo_001' \
  -H 'X-GateLM-Feature-Id: support-reply' \
  -d '{
    "model": "auto",
    "messages": [
      {"role": "user", "content": "Write a short refund response."}
    ],
    "temperature": 0.2,
    "max_tokens": 128,
    "stream": false
  }'
```

---

## 11. 로그 검증

```bash
curl -sS 'http://localhost:3001/api/projects/<projectId>/logs?limit=20' \
  -H 'Authorization: Bearer <control_plane_access_token>'
```

```bash
curl -sS 'http://localhost:3001/api/llm-requests/<requestId>' \
  -H 'Authorization: Bearer <control_plane_access_token>'
```

확인할 것:

```text
status
provider/model
requestedModel/selectedModel
costMicroUsd
latencyMs
cacheStatus
routingReason
maskingAction
redactedPromptPreview
```

---

## 12. Reset 방법

로컬 데이터를 초기화할 때는 명령 이름을 명확히 둔다.

```bash
pnpm dev:reset
```

내부 동작 예시:

```text
1. docker compose down -v
2. docker compose up -d postgres redis mock-provider
3. pnpm db:migrate
4. pnpm db:seed
```

운영과 혼동되는 destructive command를 문서 없이 사용하지 않는다.

---

## 13. 흔한 문제

| 증상 | 원인 | 조치 |
|---|---|---|
| Gateway 401 | API Key seed 불일치 | seed output 확인 |
| Gateway 403 | App Token 누락 또는 scope 오류 | `X-GateLM-App-Token` 확인 |
| Cache hit 안 됨 | prompt normalization/hash 불일치 | cache key material log를 sanitized로 확인 |
| Dashboard 0건 | Worker 미실행 또는 direct writer 미연결 | P0 log writer 경로 확인 |
| Provider 호출 실패 | mock-provider 미실행 | `curl /healthz` 확인 |
| raw email이 log에 보임 | masking stage 순서 오류 | 즉시 수정, 보안 리뷰 필요 |

---

## 14. 개발 중 보안 체크

```text
[ ] .env 커밋 금지
[ ] 실제 secret seed 금지
[ ] raw prompt log 금지
[ ] authorization header dump 금지
[ ] Provider Key response 반환 금지
[ ] Request Detail raw prompt/response 반환 금지
[ ] test snapshot에 secret-like value 금지
```
