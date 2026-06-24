# GateLM Folder Structure

> P0 범위 안내: 이 문서는 장기 폴더 구조와 확장 후보를 포함한다. 현재 P0 구현 범위는 `docs/p0/p0-contract.md`와 `docs/p0/implementation-cut.md`를 우선한다. 이 문서의 `MVP` 또는 `1차 구현` 표현이 P0 문서와 충돌하면 P1/P2 후보 또는 참고 설계로 본다.

## 문서 목적

이 문서는 GateLM 구현자가 백엔드, 프론트엔드, Gateway, Worker, 공통 코드의 위치를 임의로 만들지 않도록 고정하는 기준 문서다.

GateLM은 단순 Chat UI가 아니라 **확장 가능한 LLM Gateway 플랫폼**이다. 폴더 구조도 MVP만 빠르게 맞추는 방식이 아니라, Provider, Model, 정책, 배포 방식, 분석 지표, SDK, 외부 연동이 늘어나도 구조를 갈아엎지 않도록 설계한다.

---

# 0. 핵심 원칙

## 0.1 확장 가능성 우선

모든 폴더 구조는 아래 기준을 따른다.

- 기능이 늘어나도 기존 폴더의 의미가 바뀌면 안 된다.
- `provider`, `model`, `policy`, `analytics`, `integration`, `masking detector` 관련 코드는 enum처럼 닫힌 구조로 만들지 않는다.
- 새 기능은 먼저 `docs`, `contracts`, `api-spec.md`, `db-schema.md`에 반영한 뒤 구현한다.
- 임시 구현을 위해 `misc`, `temp`, `new`, `test2`, `common2`, `utils2` 같은 폴더를 만들지 않는다.
- 공통 코드는 무조건 `common`으로 보내지 않는다. 도메인에 속하면 도메인 모듈 안에 둔다.
- 외부 시스템 연동 코드는 `adapters`, `clients`, `infrastructure` 계층에 둔다.
- 비즈니스 규칙은 Controller, React Component, DB Repository에 넣지 않는다.

## 0.2 서비스 경계 고정

GateLM의 1차 서비스 경계는 다음과 같다.

```text
apps/web                 Next.js Web Console + Text-only Chat UI
apps/control-plane-api   NestJS Control Plane API
apps/gateway-core        Go Gateway Core
apps/ai-service          Python FastAPI AI helper service
apps/worker              Async event worker
packages/contracts       OpenAPI, Event Schema, JSON Schema
packages/shared          TypeScript 공통 타입/상수/유틸
infra                    Docker Compose, Terraform, 배포 설정
docs                     프로젝트 문서
scripts                  개발/운영 스크립트
```

새로운 top-level app을 추가하려면 먼저 `architecture.md`와 이 문서를 수정한다.

## 0.3 Gateway 우선 원칙

- 고객사 앱, 개발 도구, GateLM Chat UI는 Provider를 직접 호출하지 않는다.
- LLM 호출 코드는 `apps/gateway-core`에만 둔다.
- Control Plane은 Tenant, Project, Key, Policy, Budget, Log 조회를 담당한다.
- Web Console은 Control Plane API와 Gateway API를 호출할 뿐, Provider SDK를 직접 import하지 않는다.

## 0.4 계약 우선 원칙

공개 API, Event, DB, Policy Schema는 코드보다 먼저 문서와 contract에 반영한다.

```text
요구사항 변경
-> docs 수정
-> packages/contracts 수정
-> DB migration / DTO / Event schema 수정
-> 서비스 구현
-> 테스트 수정
```

---

# 1. Monorepo 전체 구조

```text
gatelm/
├── apps/
│   ├── web/
│   ├── control-plane-api/
│   ├── gateway-core/
│   ├── ai-service/
│   └── worker/
│
├── packages/
│   ├── contracts/
│   ├── shared/
│   ├── eslint-config/
│   ├── tsconfig/
│   └── test-utils/
│
├── infra/
│   ├── docker/
│   ├── terraform/
│   └── local/
│
├── docs/
│   ├── project-overview.md
│   ├── architecture.md
│   ├── gateway-flow.md
│   ├── pii-masking-policy.md
│   ├── llm-log-schema.md
│   ├── cost-policy.md
│   ├── dashboard-metrics.md
│   ├── db-schema.md
│   ├── api-spec.md
│   ├── folder-structure.md
│   ├── coding-convention.md
│   └── ai-coding-rules.md
│
├── scripts/
│   ├── dev/
│   ├── db/
│   └── ops/
│
├── .github/
│   └── workflows/
│
├── docker-compose.yml
├── pnpm-workspace.yaml
├── package.json
├── README.md
└── .env.example
```

## 1.1 각 영역의 책임

| 경로 | 책임 |
|---|---|
| `apps/web` | Next.js 기반 Web Console, Dashboard, Policy UI, Text-only Chat UI |
| `apps/control-plane-api` | Tenant, User, Project, Key, Policy, Budget, Log 조회 API |
| `apps/gateway-core` | OpenAI-compatible Gateway, 인증, 정책, 캐시, 라우팅, 마스킹, Provider 호출, 이벤트 발행 |
| `apps/ai-service` | Embedding, Semantic Cache 보조, Routing score 보조 |
| `apps/worker` | Redpanda event 소비, ClickHouse/PostgreSQL/S3 저장, 집계, 알림 |
| `packages/contracts` | OpenAPI, Event Schema, JSON Schema, Policy Schema |
| `packages/shared` | TypeScript 앱 간 공유 가능한 순수 타입, 상수, 유틸 |
| `infra` | 로컬/클라우드 인프라 정의 |
| `docs` | 구현 기준 문서 |
| `scripts` | 반복 작업 자동화 스크립트 |

---

# 2. 백엔드 폴더 구조

백엔드는 하나의 폴더에 몰아넣지 않는다. 서비스별 실행 단위가 다르므로 아래처럼 분리한다.

```text
apps/
├── control-plane-api/   # NestJS
├── gateway-core/        # Go
├── ai-service/          # Python FastAPI
└── worker/              # TypeScript worker
```

---

# 3. Control Plane API 구조

Control Plane API는 NestJS를 기준으로 한다.

## 3.1 기본 구조

```text
apps/control-plane-api/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   │
│   ├── config/
│   │   ├── app.config.ts
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   ├── secrets.config.ts
│   │   └── validation.schema.ts
│   │
│   ├── common/
│   │   ├── constants/
│   │   ├── decorators/
│   │   ├── errors/
│   │   ├── filters/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   ├── logging/
│   │   ├── pagination/
│   │   ├── pipes/
│   │   ├── security/
│   │   ├── types/
│   │   └── utils/
│   │
│   ├── infrastructure/
│   │   ├── database/
│   │   │   ├── prisma/
│   │   │   │   ├── prisma.module.ts
│   │   │   │   └── prisma.service.ts
│   │   │   └── transactions/
│   │   │       └── transaction-manager.ts
│   │   ├── redis/
│   │   ├── clickhouse/
│   │   ├── redpanda/
│   │   ├── secrets-manager/
│   │   ├── object-storage/
│   │   └── mailer/
│   │
│   ├── modules/
│   │   ├── auth/
│   │   ├── users/
│   │   ├── tenants/
│   │   ├── tenant-memberships/
│   │   ├── invitations/
│   │   ├── projects/
│   │   ├── applications/
│   │   ├── api-keys/
│   │   ├── app-tokens/
│   │   ├── provider-connections/
│   │   ├── model-catalog/
│   │   ├── policies/
│   │   ├── rate-limits/
│   │   ├── quotas/
│   │   ├── budgets/
│   │   ├── dashboard/
│   │   ├── request-logs/
│   │   ├── analytics/
│   │   ├── conversations/
│   │   ├── audit-logs/
│   │   ├── webhooks/
│   │   └── health/
│   │
│   └── generated/
│       └── contracts/
│
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed.ts
│
├── test/
│   ├── e2e/
│   └── fixtures/
│
├── package.json
├── tsconfig.json
└── .env.example
```

## 3.2 NestJS Module 표준 구조

모든 Control Plane 도메인 모듈은 아래 구조를 기본으로 한다.

```text
src/modules/<domain>/
├── <domain>.module.ts
├── <domain>.controller.ts
├── <domain>.service.ts
│
├── dto/
│   ├── create-<resource>.dto.ts
│   ├── update-<resource>.dto.ts
│   ├── list-<resource>.query.dto.ts
│   └── <resource>-response.dto.ts
│
├── entities/
│   └── <resource>.entity.ts
│
├── repositories/
│   ├── <resource>.repository.ts
│   └── prisma-<resource>.repository.ts
│
├── mappers/
│   └── <resource>.mapper.ts
│
├── policies/
│   └── <resource>.policy.ts
│
├── validators/
│   └── <resource>.validator.ts
│
└── tests/
    ├── <domain>.service.spec.ts
    └── <domain>.controller.spec.ts
```

예시:

```text
src/modules/projects/
├── projects.module.ts
├── projects.controller.ts
├── projects.service.ts
├── dto/
│   ├── create-project.dto.ts
│   ├── update-project.dto.ts
│   ├── list-projects.query.dto.ts
│   └── project-response.dto.ts
├── entities/
│   └── project.entity.ts
├── repositories/
│   ├── project.repository.ts
│   └── prisma-project.repository.ts
├── mappers/
│   └── project.mapper.ts
├── policies/
│   └── project.policy.ts
└── validators/
    └── project-name.validator.ts
```

## 3.3 Controller / Service / Repository 위치와 책임

| 계층 | 위치 | 책임 | 금지 |
|---|---|---|---|
| Controller | `src/modules/<domain>/<domain>.controller.ts` | HTTP routing, 인증 데코레이터, DTO validation 연결 | 비즈니스 규칙, DB query, 외부 API 호출 |
| Service | `src/modules/<domain>/<domain>.service.ts` | Use case, transaction 경계, 권한/정책 적용 조합 | SQL 직접 작성, HTTP request 객체 남용 |
| DTO | `src/modules/<domain>/dto/*.dto.ts` | Request/Response shape, validation decorator | DB entity와 혼용 |
| Entity | `src/modules/<domain>/entities/*.entity.ts` | 도메인 모델, 서비스 내부에서 쓰는 명확한 타입 | Prisma generated type을 그대로 외부 노출 |
| Repository Interface | `src/modules/<domain>/repositories/<resource>.repository.ts` | DB 접근 추상화 | Prisma Client 직접 노출 |
| Repository Impl | `src/modules/<domain>/repositories/prisma-<resource>.repository.ts` | Prisma 기반 DB query 구현 | 비즈니스 정책 처리 |
| Mapper | `src/modules/<domain>/mappers/*.mapper.ts` | DB row ↔ Entity ↔ DTO 변환 | 권한 검증, DB query |
| Policy | `src/modules/<domain>/policies/*.policy.ts` | 도메인 단위 접근 제어 판단 | Runtime Policy 엔진 대체 |
| Validator | `src/modules/<domain>/validators/*.validator.ts` | 도메인 validation | DB write |

## 3.4 DTO 기준

DTO는 HTTP 계약을 표현한다.

```text
좋음:
src/modules/projects/dto/create-project.dto.ts
src/modules/projects/dto/project-response.dto.ts

나쁨:
src/dto/create-project.dto.ts
src/modules/projects/projects.dto.ts
src/common/dto/project.dto.ts
```

규칙:

- Request DTO와 Response DTO를 분리한다.
- Query DTO는 `*.query.dto.ts`로 끝낸다.
- 응답 DTO에는 DB 내부 필드명을 노출하지 않는다.
- `tenantId`, `projectId` 같은 scope ID는 Controller에서 route/auth context와 함께 검증한다.
- DTO는 다른 도메인의 DB Entity를 직접 import하지 않는다.

## 3.5 Entity 기준

Entity는 ORM entity가 아니라 **도메인 모델**이다.

```text
src/modules/projects/entities/project.entity.ts
src/modules/policies/entities/runtime-policy.entity.ts
src/modules/budgets/entities/budget-policy.entity.ts
```

규칙:

- Entity는 서비스 내부 use case에서 사용하는 타입이다.
- Prisma generated type을 Controller Response로 직접 반환하지 않는다.
- TypeORM을 도입하더라도 Entity 위치는 동일하게 유지한다.
- ORM decorator를 쓰는 경우에도 외부 API Response DTO와 Entity를 분리한다.

## 3.6 Repository 기준

Repository는 DB 접근을 숨긴다.

```text
src/modules/projects/repositories/project.repository.ts
src/modules/projects/repositories/prisma-project.repository.ts
```

예시 책임:

```text
project.repository.ts
- ProjectRepository interface
- Repository injection token

prisma-project.repository.ts
- PrismaProjectRepository implementation
- Prisma query
- pagination query
- transaction 참여
```

규칙:

- Service는 `PrismaService`를 직접 import하지 않는다.
- Service는 Repository interface에 의존한다.
- Repository는 DTO를 반환하지 않는다. Entity 또는 persistence model을 반환한다.
- ClickHouse 조회는 `analytics` 또는 `request-logs` 모듈의 repository에서만 수행한다.
- Provider credential 원문 조회는 repository가 아니라 `secrets-manager` adapter를 통해 수행한다.

## 3.7 Control Plane Module 목록

| Module | 위치 | 책임 |
|---|---|---|
| Auth | `src/modules/auth` | Login, session/JWT, refresh, current user |
| Users | `src/modules/users` | 전역 사용자 계정 |
| Tenants | `src/modules/tenants` | Tenant 생성/조회/수정/삭제 |
| Tenant Memberships | `src/modules/tenant-memberships` | 사용자-Tenant 관계, role 관리 |
| Invitations | `src/modules/invitations` | 사용자 초대, 초대 수락/만료 |
| Projects | `src/modules/projects` | Project 생성/수정/보관 |
| Applications | `src/modules/applications` | 고객사 앱 단위 식별자 |
| API Keys | `src/modules/api-keys` | Gateway 인증용 API Key metadata, 회전, 폐기 |
| App Tokens | `src/modules/app-tokens` | Application 접근용 token metadata, 발급, 만료 |
| Provider Connections | `src/modules/provider-connections` | Provider Key metadata, secret reference 관리 |
| Model Catalog | `src/modules/model-catalog` | Provider/Model 목록, 가격 metadata |
| Policies | `src/modules/policies` | Runtime Policy 작성, 검증, publish, rollback |
| Rate Limits | `src/modules/rate-limits` | RPM/TPM/동시 요청 제한 설정 |
| Quotas | `src/modules/quotas` | 사용량 quota 설정 |
| Budgets | `src/modules/budgets` | 예산 정책, ledger 조회 |
| Dashboard | `src/modules/dashboard` | Overview aggregate API |
| Request Logs | `src/modules/request-logs` | Request Log, Detail Drawer 조회 |
| Analytics | `src/modules/analytics` | ClickHouse 기반 분석 query |
| Conversations | `src/modules/conversations` | Text-only Chat UI conversation metadata, reply-to context metadata |
| Audit Logs | `src/modules/audit-logs` | 관리 작업 감사 로그 조회 |
| Webhooks | `src/modules/webhooks` | 외부 webhook endpoint 설정 |
| Health | `src/modules/health` | `/healthz`, `/readyz` |

## 3.8 Control Plane 공통 유틸 위치

```text
src/common/
├── constants/      # 앱 내부 공통 상수
├── decorators/     # @CurrentUser, @TenantScope 등
├── errors/         # AppError, ErrorCode
├── filters/        # Exception filter
├── guards/         # JwtAuthGuard, TenantRoleGuard
├── interceptors/   # Logging, Response envelope
├── logging/        # logger wrapper
├── pagination/     # cursor pagination helper
├── pipes/          # validation/parse pipe
├── security/       # hash, token redaction, permission helper
├── types/          # 앱 내부 공통 타입
└── utils/          # 도메인 없는 순수 함수만 허용
```

`src/common/utils`에는 아래만 허용한다.

- 날짜 포맷 변환
- stable JSON stringify
- safe object omit
- string normalize
- token redaction helper

아래는 `common/utils`에 넣지 않는다.

- Project 생성 규칙
- Policy 평가 규칙
- Provider 가격 계산
- Budget 차단 판단
- Chat context 조립

이런 코드는 각 도메인 모듈 또는 Gateway pipeline에 둔다.

---

# 4. Gateway Core 구조

Gateway Core는 Go를 기준으로 한다. LLM 호출 경로의 핵심이므로 Control Plane API나 Web Console 안에 구현하지 않는다.

## 4.1 기본 구조

```text
apps/gateway-core/
├── cmd/
│   └── gateway/
│       └── main.go
│
├── internal/
│   ├── app/
│   │   ├── server.go
│   │   ├── router.go
│   │   └── lifecycle.go
│   │
│   ├── config/
│   │   ├── config.go
│   │   └── env.go
│   │
│   ├── http/
│   │   ├── handlers/
│   │   │   ├── chat_completions_handler.go
│   │   │   └── health_handler.go
│   │   ├── middleware/
│   │   │   ├── request_id.go
│   │   │   ├── recovery.go
│   │   │   ├── logging.go
│   │   │   └── cors.go
│   │   └── sse/
│   │       ├── stream_writer.go
│   │       └── stream_parser.go
│   │
│   ├── pipeline/
│   │   ├── pipeline.go
│   │   ├── context.go
│   │   ├── stages/
│   │   │   ├── authenticate/
│   │   │   ├── identify/
│   │   │   ├── appauth/
│   │   │   ├── ratelimit/
│   │   │   ├── quota/
│   │   │   ├── policy/
│   │   │   ├── masking/
│   │   │   ├── cache/
│   │   │   ├── routing/
│   │   │   ├── provider/
│   │   │   └── events/
│   │   └── errors/
│   │
│   ├── domain/
│   │   ├── auth/
│   │   ├── tenant/
│   │   ├── request/
│   │   ├── policy/
│   │   ├── masking/
│   │   ├── cache/
│   │   ├── routing/
│   │   ├── provider/
│   │   ├── usage/
│   │   └── errors/
│   │
│   ├── adapters/
│   │   ├── controlplane/
│   │   ├── redis/
│   │   ├── redpanda/
│   │   ├── secrets/
│   │   ├── aiservice/
│   │   └── providers/
│   │       ├── openai/
│   │       ├── anthropic/
│   │       ├── gemini/
│   │       └── local/
│   │
│   ├── ports/
│   │   ├── policy_store.go
│   │   ├── cache_store.go
│   │   ├── provider_client.go
│   │   ├── event_publisher.go
│   │   └── secret_store.go
│   │
│   ├── observability/
│   │   ├── logger.go
│   │   └── metrics.go
│   │
│   └── testutil/
│
├── api/
│   └── openai-compatible/
│       └── examples/
│
├── test/
│   ├── integration/
│   └── fixtures/
│
├── go.mod
├── go.sum
└── .env.example
```

## 4.2 Gateway Pipeline 단계 위치

Gateway 요청 처리 단계는 반드시 `internal/pipeline/stages` 아래에 둔다.

```text
internal/pipeline/stages/authenticate/  # API Key 인증
internal/pipeline/stages/identify/      # Tenant / Project / User 식별
internal/pipeline/stages/appauth/       # App Token 검증
internal/pipeline/stages/ratelimit/     # RPM / TPM / concurrent limit
internal/pipeline/stages/quota/         # quota / budget pre-check
internal/pipeline/stages/policy/        # Runtime Policy 검사
internal/pipeline/stages/masking/       # PII / secret masking or block
internal/pipeline/stages/cache/         # Exact / Semantic cache lookup
internal/pipeline/stages/routing/       # Model / Provider routing
internal/pipeline/stages/provider/      # Provider call / stream relay
internal/pipeline/stages/events/        # async event publish
```

규칙:

- Pipeline 순서는 코드에서 임의로 바꾸지 않는다.
- 새 Stage 추가는 `architecture.md`, `api-spec.md`, `contracts/events` 영향 여부를 먼저 확인한다.
- Provider별 차이는 `adapters/providers/<provider>`에 둔다.
- Provider 공통 인터페이스는 `ports/provider_client.go`에 둔다.
- Redis, Secrets Manager, Redpanda 직접 호출은 `adapters`에만 둔다.

## 4.3 Gateway Provider Adapter 기준

```text
internal/adapters/providers/<provider>/
├── client.go
├── request_mapper.go
├── response_mapper.go
├── stream_mapper.go
├── errors.go
└── tests/
```

예시:

```text
internal/adapters/providers/openai/client.go
internal/adapters/providers/anthropic/request_mapper.go
internal/adapters/providers/gemini/stream_mapper.go
```

규칙:

- 새 Provider 추가 시 Gateway 전체 구조를 바꾸지 않는다.
- Provider별 요청/응답 변환은 adapter 내부에서만 처리한다.
- Gateway handler는 Provider별 SDK를 직접 import하지 않는다.
- Provider 이름은 DB/API에서 string으로 처리한다.
- 새 Provider 추가 시 model catalog seed, policy schema, routing rule test도 함께 추가한다.

## 4.4 Gateway 공통 유틸 위치

```text
internal/observability/  # logging, metric
internal/domain/errors/  # domain error code
internal/testutil/       # test helper
```

Go에서는 `internal/common` 또는 `pkg/utils`를 남발하지 않는다. 여러 패키지가 쓰는 코드라도 역할이 명확하면 `domain`, `adapters`, `observability`, `pipeline` 중 하나에 둔다.

---

# 5. AI Service 구조

AI Service는 Python FastAPI를 기준으로 한다. Gateway의 보조 서비스이며 Provider 호출 주체가 아니다.

## 5.1 기본 구조

```text
apps/ai-service/
├── app/
│   ├── main.py
│   │
│   ├── api/
│   │   ├── routes/
│   │   │   ├── health.py
│   │   │   ├── embeddings.py
│   │   │   ├── semantic_cache.py
│   │   │   └── routing_score.py
│   │   └── dependencies.py
│   │
│   ├── core/
│   │   ├── config.py
│   │   ├── logging.py
│   │   └── errors.py
│   │
│   ├── domain/
│   │   ├── embeddings/
│   │   ├── semantic_cache/
│   │   └── routing/
│   │
│   ├── services/
│   │   ├── embedding_service.py
│   │   ├── semantic_cache_service.py
│   │   └── routing_score_service.py
│   │
│   ├── adapters/
│   │   ├── redis/
│   │   ├── vector_store/
│   │   └── model_clients/
│   │
│   ├── schemas/
│   │   ├── embeddings.py
│   │   ├── semantic_cache.py
│   │   └── routing_score.py
│   │
│   └── tests/
│
├── pyproject.toml
├── poetry.lock
└── .env.example
```

## 5.2 AI Service 규칙

- AI Service는 Gateway 대신 Provider completion을 호출하지 않는다.
- AI Service는 Embedding, Semantic Cache 보조, Routing score 보조에 집중한다.
- FastAPI route는 `app/api/routes`에 둔다.
- request/response schema는 `app/schemas`에 둔다.
- 비즈니스 계산은 `app/services` 또는 `app/domain`에 둔다.
- Redis/vector store 접근은 `app/adapters`에 둔다.
- Python 공통 유틸은 `app/core` 또는 도메인 하위에 둔다.

---

# 6. Worker 구조

Worker는 Redpanda event를 소비하고 비동기 저장/집계/알림을 수행한다. HTTP Controller가 없는 TypeScript worker로 시작한다.

## 6.1 기본 구조

```text
apps/worker/
├── src/
│   ├── main.ts
│   ├── worker.module.ts
│   │
│   ├── config/
│   │   ├── worker.config.ts
│   │   ├── redpanda.config.ts
│   │   ├── clickhouse.config.ts
│   │   ├── database.config.ts
│   │   └── validation.schema.ts
│   │
│   ├── common/
│   │   ├── errors/
│   │   ├── logging/
│   │   ├── retry/
│   │   ├── serialization/
│   │   └── utils/
│   │
│   ├── infrastructure/
│   │   ├── redpanda/
│   │   ├── clickhouse/
│   │   ├── database/
│   │   ├── object-storage/
│   │   └── mailer/
│   │
│   ├── modules/
│   │   ├── llm-invocations/
│   │   ├── provider-attempts/
│   │   ├── masking-events/
│   │   ├── cache-events/
│   │   ├── routing-events/
│   │   ├── usage-ledger/
│   │   ├── budget-ledger/
│   │   ├── alerts/
│   │   └── audit-events/
│   │
│   └── generated/
│       └── contracts/
│
├── test/
│   ├── integration/
│   └── fixtures/
│
├── package.json
├── tsconfig.json
└── .env.example
```

## 6.2 Worker Module 표준 구조

```text
src/modules/<event-domain>/
├── <event-domain>.module.ts
├── <event-domain>.consumer.ts
├── <event-domain>.service.ts
│
├── handlers/
│   └── <event-name>.handler.ts
│
├── dto/
│   └── <event-name>.event.dto.ts
│
├── repositories/
│   ├── <event-domain>.repository.ts
│   ├── clickhouse-<event-domain>.repository.ts
│   └── postgres-<event-domain>.repository.ts
│
├── mappers/
│   └── <event-domain>.mapper.ts
│
└── tests/
    └── <event-domain>.handler.spec.ts
```

예시:

```text
src/modules/llm-invocations/
├── llm-invocations.module.ts
├── llm-invocations.consumer.ts
├── llm-invocations.service.ts
├── handlers/
│   └── llm-invocation-completed.handler.ts
├── dto/
│   └── llm-invocation-completed.event.dto.ts
├── repositories/
│   ├── llm-invocation.repository.ts
│   ├── clickhouse-llm-invocation.repository.ts
│   └── postgres-usage-ledger.repository.ts
└── mappers/
    └── llm-invocation.mapper.ts
```

## 6.3 Worker 규칙

- Worker는 사용자 응답 경로에 끼어들지 않는다.
- Worker는 event schema를 기준으로 처리한다.
- Event DTO는 `packages/contracts/events`에서 생성하거나 그 schema와 1:1로 맞춘다.
- ClickHouse insert는 analytics 성격의 고볼륨 데이터에만 사용한다.
- PostgreSQL write는 ledger, audit, 상태 변경에만 사용한다.
- S3 저장은 redacted payload, response summary, export artifact에만 사용한다.
- 실패한 event는 retry 후 dead letter topic으로 보낸다.

---

# 7. Frontend 구조

Frontend는 Next.js App Router를 기준으로 한다.

## 7.1 기본 구조

```text
apps/web/
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── globals.css
│   │   │
│   │   ├── (public)/
│   │   │   ├── page.tsx
│   │   │   ├── pricing/page.tsx
│   │   │   └── docs/page.tsx
│   │   │
│   │   ├── (auth)/
│   │   │   ├── login/page.tsx
│   │   │   ├── signup/page.tsx
│   │   │   ├── accept-invitation/page.tsx
│   │   │   └── layout.tsx
│   │   │
│   │   ├── (console)/
│   │   │   ├── layout.tsx
│   │   │   ├── tenants/[tenantId]/
│   │   │   │   ├── dashboard/page.tsx
│   │   │   │   ├── projects/page.tsx
│   │   │   │   ├── projects/[projectId]/page.tsx
│   │   │   │   ├── applications/page.tsx
│   │   │   │   ├── api-keys/page.tsx
│   │   │   │   ├── app-tokens/page.tsx
│   │   │   │   ├── provider-connections/page.tsx
│   │   │   │   ├── model-catalog/page.tsx
│   │   │   │   ├── policies/page.tsx
│   │   │   │   ├── budgets/page.tsx
│   │   │   │   ├── usage/page.tsx
│   │   │   │   ├── request-logs/page.tsx
│   │   │   │   ├── request-logs/[requestId]/page.tsx
│   │   │   │   ├── audit-logs/page.tsx
│   │   │   │   ├── members/page.tsx
│   │   │   │   └── settings/page.tsx
│   │   │   │
│   │   │   └── onboarding/
│   │   │       ├── tenant/page.tsx
│   │   │       ├── project/page.tsx
│   │   │       ├── provider-key/page.tsx
│   │   │       └── policy/page.tsx
│   │   │
│   │   └── (chat)/
│   │       ├── layout.tsx
│   │       └── tenants/[tenantId]/chat/page.tsx
│   │
│   ├── features/
│   │   ├── auth/
│   │   ├── tenants/
│   │   ├── projects/
│   │   ├── applications/
│   │   ├── api-keys/
│   │   ├── app-tokens/
│   │   ├── provider-connections/
│   │   ├── model-catalog/
│   │   ├── policies/
│   │   ├── budgets/
│   │   ├── dashboard/
│   │   ├── request-logs/
│   │   ├── analytics/
│   │   ├── conversations/
│   │   ├── audit-logs/
│   │   └── onboarding/
│   │
│   ├── components/
│   │   ├── ui/
│   │   ├── layout/
│   │   ├── common/
│   │   ├── charts/
│   │   └── feedback/
│   │
│   ├── lib/
│   │   ├── api/
│   │   ├── auth/
│   │   ├── gateway/
│   │   ├── formatting/
│   │   ├── validation/
│   │   ├── errors/
│   │   └── utils/
│   │
│   ├── hooks/
│   ├── stores/
│   ├── types/
│   ├── constants/
│   └── generated/
│       └── contracts/
│
├── public/
├── package.json
├── next.config.ts
├── tsconfig.json
└── .env.example
```

## 7.2 Route 위치 규칙

| 화면 | 위치 |
|---|---|
| 소개 페이지 | `src/app/(public)/page.tsx` |
| 로그인 | `src/app/(auth)/login/page.tsx` |
| 회원가입 | `src/app/(auth)/signup/page.tsx` |
| 초대 수락 | `src/app/(auth)/accept-invitation/page.tsx` |
| Tenant 온보딩 | `src/app/(console)/onboarding/tenant/page.tsx` |
| Dashboard | `src/app/(console)/tenants/[tenantId]/dashboard/page.tsx` |
| Project 목록 | `src/app/(console)/tenants/[tenantId]/projects/page.tsx` |
| Project 상세 | `src/app/(console)/tenants/[tenantId]/projects/[projectId]/page.tsx` |
| Request Log | `src/app/(console)/tenants/[tenantId]/request-logs/page.tsx` |
| Request Detail | `src/app/(console)/tenants/[tenantId]/request-logs/[requestId]/page.tsx` |
| Policy Control | `src/app/(console)/tenants/[tenantId]/policies/page.tsx` |
| Text-only Chat UI | `src/app/(chat)/tenants/[tenantId]/chat/page.tsx` |

규칙:

- `src/pages`는 만들지 않는다. App Router만 사용한다.
- `src/app/api`는 기본적으로 만들지 않는다. API는 `apps/control-plane-api`와 `apps/gateway-core`가 담당한다.
- Next.js Route Handler가 필요하면 먼저 `api-spec.md`에 BFF 필요성을 명시한다.
- Page 파일에는 데이터 조립과 layout 연결만 둔다.
- 실제 UI 조각과 비즈니스 interaction은 `features/<domain>`에 둔다.

## 7.3 Frontend Feature 표준 구조

```text
src/features/<domain>/
├── api/
│   ├── <domain>.api.ts
│   └── <domain>.query-keys.ts
│
├── components/
│   ├── <domain>-table.tsx
│   ├── <domain>-form.tsx
│   └── <domain>-detail-drawer.tsx
│
├── hooks/
│   ├── use-<domain>.ts
│   └── use-<domain>-mutation.ts
│
├── schemas/
│   └── <domain>.schema.ts
│
├── types/
│   └── <domain>.types.ts
│
├── utils/
│   └── <domain>.utils.ts
│
└── index.ts
```

예시:

```text
src/features/request-logs/
├── api/
│   ├── request-logs.api.ts
│   └── request-logs.query-keys.ts
├── components/
│   ├── request-log-table.tsx
│   ├── request-log-filter.tsx
│   └── request-log-detail-drawer.tsx
├── hooks/
│   ├── use-request-logs.ts
│   └── use-request-log-detail.ts
├── schemas/
│   └── request-log-filter.schema.ts
├── types/
│   └── request-log.types.ts
└── index.ts
```

## 7.4 Frontend 공통 컴포넌트 위치

```text
src/components/ui/        # shadcn/ui 기반 primitive
src/components/layout/    # AppShell, Sidebar, Header, TenantSwitcher
src/components/common/    # EmptyState, ConfirmDialog, DataTable wrapper
src/components/charts/    # ECharts wrapper, ChartCard
src/components/feedback/  # Toast, ErrorPanel, LoadingState
```

규칙:

- 도메인 이름이 들어가는 컴포넌트는 `components/common`에 두지 않는다.
- `ProjectTable`은 `features/projects/components`에 둔다.
- `RequestLogDetailDrawer`는 `features/request-logs/components`에 둔다.
- `DataTable`처럼 도메인 없는 재사용 컴포넌트만 `components/common`에 둔다.

## 7.5 Frontend API Client 위치

```text
src/lib/api/
├── http-client.ts
├── control-plane-client.ts
├── analytics-client.ts
├── errors.ts
└── pagination.ts

src/lib/gateway/
├── gateway-client.ts
├── stream-chat-completion.ts
└── gateway-errors.ts
```

규칙:

- Feature API는 `src/features/<domain>/api`에 둔다.
- 공통 HTTP client만 `src/lib/api`에 둔다.
- Gateway streaming 처리는 `src/lib/gateway`에 둔다.
- React component에서 `fetch`를 직접 호출하지 않는다.
- Provider SDK를 Web에 설치하지 않는다.

---

# 8. Shared Packages 구조

## 8.1 packages/contracts

```text
packages/contracts/
├── openapi/
│   ├── control-plane.openapi.yaml
│   ├── gateway.openapi.yaml
│   └── internal.openapi.yaml
│
├── events/
│   ├── llm-invocation.completed.schema.json
│   ├── provider-attempt.completed.schema.json
│   ├── masking-event.created.schema.json
│   ├── cache-event.created.schema.json
│   ├── routing-event.created.schema.json
│   └── budget-threshold.exceeded.schema.json
│
├── policies/
│   ├── runtime-policy.schema.json
│   ├── routing-policy.schema.json
│   ├── security-policy.schema.json
│   ├── rate-limit-policy.schema.json
│   └── budget-policy.schema.json
│
├── db/
│   └── schema-notes.md
│
├── examples/
│   ├── gateway-chat-completion.request.json
│   ├── llm-invocation.completed.json
│   └── runtime-policy.json
│
└── package.json
```

규칙:

- API shape 변경은 먼저 `openapi`에 반영한다.
- Event shape 변경은 먼저 `events` JSON Schema에 반영한다.
- Policy shape 변경은 먼저 `policies` JSON Schema에 반영한다.
- 서비스별 DTO는 contracts를 기준으로 생성하거나 수동 동기화한다.

## 8.2 packages/shared

```text
packages/shared/
├── src/
│   ├── constants/
│   │   ├── error-codes.ts
│   │   ├── roles.ts
│   │   └── scopes.ts
│   │
│   ├── types/
│   │   ├── ids.ts
│   │   ├── pagination.ts
│   │   ├── money.ts
│   │   └── timestamps.ts
│   │
│   ├── utils/
│   │   ├── stable-json.ts
│   │   ├── redact.ts
│   │   └── assert-never.ts
│   │
│   └── index.ts
│
└── package.json
```

규칙:

- `packages/shared`에는 TypeScript 서비스와 Web에서 같이 쓰는 순수 코드만 둔다.
- NestJS, React, Prisma, ClickHouse, Redis에 의존하는 코드는 넣지 않는다.
- 비즈니스 로직을 무리하게 공유하지 않는다.
- Go Gateway와 Python AI Service는 이 패키지를 직접 import하지 않는다. 필요한 경우 contract 파일을 기준으로 별도 생성한다.

---

# 9. Infrastructure / Scripts 구조

## 9.1 infra

```text
infra/
├── docker/
│   ├── control-plane-api.Dockerfile
│   ├── gateway-core.Dockerfile
│   ├── ai-service.Dockerfile
│   ├── worker.Dockerfile
│   └── web.Dockerfile
│
├── terraform/
│   ├── environments/
│   │   ├── dev/
│   │   └── prod/
│   ├── modules/
│   │   ├── alb/
│   │   ├── ec2/
│   │   ├── rds/
│   │   ├── secrets-manager/
│   │   └── s3/
│   └── versions.tf
│
└── local/
    ├── postgres/
    ├── clickhouse/
    ├── redpanda/
    └── redis/
```

## 9.2 scripts

```text
scripts/
├── dev/
│   ├── bootstrap.sh
│   ├── start-local.sh
│   └── stop-local.sh
│
├── db/
│   ├── migrate.sh
│   ├── seed.sh
│   └── reset-local.sh
│
└── ops/
    ├── rotate-demo-secrets.sh
    ├── export-openapi.sh
    └── generate-contracts.sh
```

규칙:

- 배포/운영 스크립트는 `scripts/ops`에 둔다.
- DB 관련 스크립트는 `scripts/db`에 둔다.
- 로컬 개발용 스크립트는 `scripts/dev`에 둔다.
- 임시 스크립트를 root에 만들지 않는다.

---

# 10. 테스트 폴더 기준

## 10.1 Control Plane API

```text
apps/control-plane-api/src/modules/projects/tests/projects.service.spec.ts
apps/control-plane-api/src/modules/projects/tests/projects.controller.spec.ts
apps/control-plane-api/test/e2e/projects.e2e-spec.ts
```

## 10.2 Gateway Core

```text
apps/gateway-core/internal/pipeline/stages/masking/masking_test.go
apps/gateway-core/internal/adapters/providers/openai/client_test.go
apps/gateway-core/test/integration/chat_completions_test.go
```

## 10.3 AI Service

```text
apps/ai-service/app/tests/test_embedding_service.py
apps/ai-service/app/tests/test_semantic_cache_service.py
```

## 10.4 Worker

```text
apps/worker/src/modules/llm-invocations/tests/llm-invocation-completed.handler.spec.ts
apps/worker/test/integration/redpanda-consumer.e2e-spec.ts
```

## 10.5 Web

```text
apps/web/src/features/projects/components/project-form.test.tsx
apps/web/src/features/request-logs/hooks/use-request-logs.test.ts
apps/web/src/features/policies/schemas/policy.schema.test.ts
```

규칙:

- Unit test는 가능하면 구현 파일 근처의 `tests` 폴더에 둔다.
- E2E test는 각 app의 `test/e2e` 또는 `test/integration`에 둔다.
- fixture는 각 app의 `test/fixtures`에 둔다.
- 테스트 데이터를 `src` production 코드에 넣지 않는다.

---

# 11. Naming Convention

## 11.1 공통

| 대상 | 기준 | 예시 |
|---|---|---|
| 폴더명 | kebab-case | `provider-connections` |
| TypeScript 파일 | kebab-case | `create-project.dto.ts` |
| TypeScript class | PascalCase | `CreateProjectDto` |
| TypeScript interface | PascalCase | `ProjectRepository` |
| TypeScript function | camelCase | `createProject` |
| React component 파일 | kebab-case | `request-log-table.tsx` |
| React component | PascalCase | `RequestLogTable` |
| Go package | lowercase | `ratelimit` |
| Go file | snake_case | `request_mapper.go` |
| Python package | snake_case | `semantic_cache` |
| Python file | snake_case | `routing_score_service.py` |
| DB table | snake_case plural | `provider_connections` |
| DB column | snake_case | `created_at` |
| API JSON | camelCase | `createdAt` |

## 11.2 Domain 이름 기준

동일한 개념은 전체 코드베이스에서 같은 이름을 사용한다.

```text
tenant
project
application
api-key
app-token
provider-connection
model-catalog
runtime-policy
rate-limit
quota
budget
request-log
conversation
audit-log
```

아래처럼 이름을 섞지 않는다.

```text
나쁨:
organization / company / workspace / tenant 혼용
service / app / client / application 혼용
llm-log / request / invocation-log 혼용
```

기준 용어가 필요하면 문서부터 수정한다.

---

# 12. Import / Dependency 규칙

## 12.1 Control Plane API

허용 방향:

```text
controller -> service -> repository -> infrastructure/database
service -> other domain service, only through module export
service -> infrastructure adapter, only when 외부 시스템 작업이 use case 일부일 때
```

금지:

```text
controller -> repository 직접 호출
controller -> PrismaService 직접 호출
service -> HTTP Response 객체 조작
repository -> service import
common -> modules import
```

## 12.2 Web

허용 방향:

```text
app route -> feature component
feature component -> feature hook
feature hook -> feature api
feature api -> lib/api client
shared component -> no domain import
```

금지:

```text
components/common -> features/projects import
lib/api -> features import
page.tsx 안에서 복잡한 table/filter 상태 직접 구현
React component에서 Provider SDK 직접 호출
```

## 12.3 Gateway Core

허용 방향:

```text
http handler -> pipeline
pipeline stage -> domain + ports
adapters -> ports 구현
app -> wiring
```

금지:

```text
http handler -> provider adapter 직접 호출
pipeline stage -> concrete Redis client 직접 호출
provider adapter -> pipeline import
adapters/providers/openai -> adapters/providers/anthropic import
```

## 12.4 Worker

허용 방향:

```text
consumer -> handler -> service -> repository -> infrastructure
```

금지:

```text
handler -> ClickHouse client 직접 호출
repository -> handler import
worker -> gateway internal package import
```

---

# 13. 기능 추가 시 폴더 선택 규칙

## 13.1 새 Control Plane 기능 추가

예: Department 단위 정책이 추가되는 경우

```text
1. docs/architecture/api-spec.md 수정
2. docs/architecture/db-schema.md 수정
3. packages/contracts/openapi 수정
4. apps/control-plane-api/src/modules/departments 생성
5. apps/web/src/features/departments 생성
6. 필요한 경우 apps/gateway-core/internal/domain/tenant 또는 policy 확장
```

새 기능이 Tenant/Project 하위 설정이면 기존 module 안에 넣고, 독립 리소스이면 새 module을 만든다.

## 13.2 새 Provider 추가

예: `mistral` Provider 추가

```text
apps/gateway-core/internal/adapters/providers/mistral/
├── client.go
├── request_mapper.go
├── response_mapper.go
├── stream_mapper.go
└── errors.go

apps/control-plane-api/src/modules/model-catalog/        # model metadata seed/API 확장
apps/control-plane-api/src/modules/provider-connections/ # credential metadata 처리
packages/contracts/                                      # API/Event 예시 업데이트
```

Control Plane에 `mistral` 전용 module을 만들지 않는다. Provider별 차이는 Gateway adapter와 model catalog metadata로 처리한다.

## 13.3 새 Policy Type 추가

예: Data residency policy 추가

```text
packages/contracts/policies/data-residency-policy.schema.json
apps/control-plane-api/src/modules/policies/
apps/gateway-core/internal/domain/policy/
apps/gateway-core/internal/pipeline/stages/policy/
apps/web/src/features/policies/
apps/worker/src/modules/audit-events/  # 정책 변경 audit 필요 시
```

정책을 Controller나 Gateway handler에 하드코딩하지 않는다.

## 13.4 새 Dashboard Widget 추가

예: Provider별 오류율 widget 추가

```text
packages/contracts/openapi/control-plane.openapi.yaml
apps/control-plane-api/src/modules/dashboard/
apps/control-plane-api/src/modules/analytics/
apps/web/src/features/dashboard/components/provider-error-rate-card.tsx
apps/web/src/features/dashboard/api/dashboard.api.ts
```

Worker event schema나 ClickHouse table 변경이 필요하면 `packages/contracts/events`와 `db-schema.md`를 먼저 수정한다.

## 13.5 새 Event 추가

예: `policy.evaluated` event 추가

```text
packages/contracts/events/policy.evaluated.schema.json
apps/gateway-core/internal/pipeline/stages/events/
apps/worker/src/modules/policy-events/
apps/control-plane-api/src/modules/request-logs/  # 조회 필요 시
apps/web/src/features/request-logs/               # 표시 필요 시
```

Event는 producer와 consumer가 동시에 이해할 수 있도록 schema를 먼저 만든다.

---

# 14. 구현 금지 폴더

아래 폴더는 만들지 않는다.

```text
src/controllers/
src/services/
src/repositories/
src/models/
src/helpers/
src/utils2/
src/common2/
src/temp/
src/new/
src/legacy/
app/api/  # Next.js API Route. 명시적 필요 전까지 금지
backend/
server/
client/
```

단, 각 module 내부의 `controllers`, `services` 같은 복수형 폴더도 MVP에서는 만들지 않는다. NestJS는 module root에 `<domain>.controller.ts`, `<domain>.service.ts`를 둔다.

예외가 필요하면 이 문서를 먼저 수정한다.

---

# 15. 환경 변수 파일 위치

```text
.env.example                         # root 공통 예시
apps/web/.env.example
apps/control-plane-api/.env.example
apps/gateway-core/.env.example
apps/ai-service/.env.example
apps/worker/.env.example
```

규칙:

- 실제 `.env`는 commit하지 않는다.
- Provider API Key 원문은 `.env`나 DB에 저장하지 않는다.
- 로컬 개발용 fake key만 `.env.example`에 형식을 보여준다.
- 운영 secret은 AWS Secrets Manager + KMS를 기준으로 한다.

---

# 16. 생성 코드 위치

생성 코드는 사람이 직접 수정하지 않는다.

```text
apps/web/src/generated/contracts/
apps/control-plane-api/src/generated/contracts/
apps/worker/src/generated/contracts/
```

규칙:

- `generated` 내부 파일은 formatter 외 직접 수정 금지.
- 변경은 `packages/contracts`에서 시작한다.
- Gateway Go, AI Python 쪽 생성물이 필요하면 각 서비스의 `internal/generated` 또는 `app/generated`를 명시적으로 추가한다.

---

# 17. 문서 위치

```text
docs/
├── project-overview.md
├── architecture.md
├── gateway-flow.md
├── pii-masking-policy.md
├── llm-log-schema.md
├── cost-policy.md
├── dashboard-metrics.md
├── db-schema.md
├── api-spec.md
├── folder-structure.md
├── coding-convention.md
├── ai-coding-rules.md
├── event-schema.md          # 필요 시 추가
├── policy-spec.md           # 필요 시 추가
├── deployment.md            # 필요 시 추가
└── runbook.md               # 필요 시 추가
```

규칙:

- 구현 기준 문서는 `docs`에 둔다.
- API contract는 `packages/contracts`에 둔다.
- README는 실행 방법과 진입점만 설명한다.
- 긴 설계 판단은 README가 아니라 `docs`에 둔다.


## 17.1 민감정보 정책 문서 위치 기준

민감정보 detector, masking action, redaction placeholder, Provider 호출 전 차단/마스킹 기준은 `docs/policies/pii-masking-policy.md`를 따른다.

- Gateway masking stage 위치는 `apps/gateway-core/internal/pipeline/stages/masking/`이다.
- Control Plane의 보안 정책 관리는 `apps/control-plane-api/src/modules/policies/` 아래에 둔다.
- Worker의 masking event 처리는 `apps/worker/src/modules/masking-events/` 아래에 둔다.
- 별도 `pii`, `security2`, `masking-new` 같은 top-level app/module을 만들지 않는다.

---

# 18. MVP 기준 필수 폴더 체크리스트

MVP 구현 시작 전에 아래 폴더는 있어야 한다.

```text
apps/web/src/app/(console)/tenants/[tenantId]/dashboard/
apps/web/src/app/(console)/tenants/[tenantId]/request-logs/
apps/web/src/app/(console)/tenants/[tenantId]/policies/
apps/web/src/app/(chat)/tenants/[tenantId]/chat/
apps/web/src/features/dashboard/
apps/web/src/features/request-logs/
apps/web/src/features/policies/
apps/web/src/features/conversations/

apps/control-plane-api/src/modules/tenants/
apps/control-plane-api/src/modules/projects/
apps/control-plane-api/src/modules/provider-connections/
apps/control-plane-api/src/modules/api-keys/
apps/control-plane-api/src/modules/app-tokens/
apps/control-plane-api/src/modules/policies/
apps/control-plane-api/src/modules/dashboard/
apps/control-plane-api/src/modules/request-logs/
apps/control-plane-api/src/modules/conversations/

apps/gateway-core/internal/pipeline/stages/authenticate/
apps/gateway-core/internal/pipeline/stages/ratelimit/
apps/gateway-core/internal/pipeline/stages/policy/
apps/gateway-core/internal/pipeline/stages/masking/
apps/gateway-core/internal/security/detectors/
apps/gateway-core/internal/security/redaction/
apps/gateway-core/internal/security/policy/
apps/gateway-core/internal/pipeline/stages/cache/
apps/gateway-core/internal/pipeline/stages/routing/
apps/gateway-core/internal/pipeline/stages/provider/
apps/gateway-core/internal/pipeline/stages/events/
apps/gateway-core/internal/adapters/providers/openai/

apps/worker/src/modules/llm-invocations/
apps/worker/src/modules/provider-attempts/
apps/worker/src/modules/masking-events/
apps/worker/src/modules/cache-events/
apps/worker/src/modules/routing-events/
apps/worker/src/modules/usage-ledger/

packages/contracts/openapi/
packages/contracts/events/
packages/contracts/policies/
```

---

# 19. AI 구현자 지침

AI에게 코드를 생성시킬 때는 아래 규칙을 따른다.

1. 새 파일을 만들기 전에 이 문서에서 위치를 찾는다.
2. 위치가 없으면 임의로 만들지 말고, 먼저 문서를 수정한다.
3. Controller, Service, DTO, Entity, Repository는 도메인 module 안에 둔다.
4. Web page는 `src/app`에 두고, 실제 기능 UI는 `src/features`에 둔다.
5. 공통 UI는 `src/components`, 공통 API client는 `src/lib`에 둔다.
6. Gateway Provider 호출은 `apps/gateway-core/internal/adapters/providers`에만 둔다.
7. Event 처리 코드는 `apps/worker/src/modules`에 둔다.
8. Contract 변경 없이 API/Event shape를 임의로 바꾸지 않는다.
9. MVP 제외 범위인 파일 업로드, 이미지 입력, OCR, RAG, 공식 외부 웹 UI 우회 기능의 폴더를 만들지 않는다.
10. 확장성을 위해 hard-coded provider/model/policy 폴더를 남발하지 않는다.

---

# 20. 최종 기준

GateLM의 폴더 구조는 아래 방향을 유지한다.

```text
설정/관리 API      -> apps/control-plane-api/src/modules/<domain>
LLM 요청 처리      -> apps/gateway-core/internal/pipeline + adapters
비동기 로그/집계   -> apps/worker/src/modules/<event-domain>
AI 보조 기능       -> apps/ai-service/app/domain + services + adapters
화면 route         -> apps/web/src/app
화면 기능          -> apps/web/src/features/<domain>
공통 UI            -> apps/web/src/components
공통 TS 코드       -> packages/shared
계약 문서          -> packages/contracts
인프라             -> infra
문서               -> docs
```

이 문서에 없는 위치에 코드를 추가하지 않는다. 새로운 위치가 필요하면 이 문서를 먼저 업데이트한다.
