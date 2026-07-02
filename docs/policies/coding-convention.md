# GateLM Coding Convention

> v1.0.0 범위 안내: 이 문서는 장기 구현 기준과 확장 원칙을 포함한다. 현재 구현 범위는 `docs/v1.0.0/contracts.md`와 `docs/v1.0.0/implementation-plan.md`를 우선한다. 이 문서의 `P0`, `MVP`, `1차 구현`, `P1/P2` 표현이 v1.0.0 문서와 충돌하면 v1.0.0 문서를 우선한다.

## 문서 목적

이 문서는 GateLM 팀이 같은 코드 스타일과 같은 구현 기준으로 작업하기 위한 코딩 컨벤션 문서다.

GateLM은 단순 Chat UI가 아니라 **확장 가능한 LLM Gateway 플랫폼**이다. 따라서 코드는 MVP 기능만 빠르게 맞추는 방식이 아니라, Provider, Model, Policy, Tenant 규모, 배포 방식, Analytics, SDK, 외부 연동이 늘어나도 기존 구조를 갈아엎지 않도록 작성한다.

이 문서는 다음 작업의 기준이다.

- NestJS Control Plane API 구현
- Go Gateway Core 구현
- Python FastAPI AI Service 구현
- Next.js Web Console / Text-only Chat UI 구현
- Worker 구현
- DTO / Entity / Repository 작성
- API 응답 / 예외 / 로그 / import 규칙 통일
- AI 코드 생성 시 임의 스타일 방지

---

# 0. 상위 기준 문서

코드를 작성할 때는 아래 문서 순서를 따른다.

```text
master-spec.md
-> project-overview.md
-> architecture.md
-> gateway-flow.md
-> pii-masking-policy.md
-> llm-log-schema.md
-> cost-policy.md
-> dashboard-metrics.md
-> db-schema.md
-> api-spec.md
-> folder-structure.md
-> coding-convention.md
-> ai-coding-rules.md
-> 실제 구현
```

우선순위가 충돌하면 아래 기준을 따른다.

1. 제품 방향은 `project-overview.md`를 따른다.
2. 시스템 경계와 요청 흐름은 `architecture.md`와 `gateway-flow.md`를 따른다.
3. 민감정보 탐지, 마스킹, 차단, 저장 전 처리 기준은 `pii-masking-policy.md`를 따른다.
4. 로그 필드와 masking metadata는 `llm-log-schema.md`를 따른다.
5. 비용과 대시보드 지표는 `cost-policy.md`, `dashboard-metrics.md`를 따른다.
6. DB 테이블, 필드, 관계, 삭제 정책은 `db-schema.md`를 따른다.
7. HTTP API 계약은 `api-spec.md`를 따른다.
8. 파일 위치는 `folder-structure.md`를 따른다.
9. AI 작업 제한은 `ai-coding-rules.md`를 따른다.
10. 코드 스타일과 구현 방식은 이 문서를 따른다.

문서에 없는 API, DB, Event, 폴더, Provider 분기, 정책 타입을 임의로 만들지 않는다. 필요한 경우 먼저 문서를 수정한다.

---

# 1. 핵심 코딩 원칙

## 1.1 확장성 우선

모든 코드는 아래 기준을 기본값으로 둔다.

- Provider와 Model을 enum처럼 닫힌 구조로 만들지 않는다.
- 정책 대상은 `tenant`, `project`, `application`, `user`, `api_key`, `app_token` 이후에도 확장될 수 있다고 가정한다.
- 신규 Provider 추가 시 Gateway pipeline 전체를 수정하지 않고 adapter 추가로 끝나야 한다.
- 신규 정책 추가 시 Controller, DTO, DB, Gateway stage를 무분별하게 늘리지 않는다.
- 신규 로그 지표 추가 시 기존 로그 schema를 깨지 않고 metadata 또는 versioned event로 확장한다.
- `if provider == "openai"` 같은 분기를 여러 파일에 흩뿌리지 않는다.
- 임시 구현을 위해 `any`, `map[string]any`, `dict[str, Any]`, `metadata`에 핵심 필드를 숨기는 방식을 남용하지 않는다.

좋은 방향:

```ts
const adapter = this.providerAdapterRegistry.get(provider);
return adapter.createChatCompletion(request);
```

나쁜 방향:

```ts
if (provider === 'openai') {
  // OpenAI 전용 처리
} else if (provider === 'anthropic') {
  // Anthropic 전용 처리
} else if (provider === 'gemini') {
  // Gemini 전용 처리
}
```

Provider별 차이는 adapter 내부에 둔다. Gateway pipeline, Control Plane service, Web UI는 Provider가 늘어나도 구조가 바뀌면 안 된다.

## 1.2 계약 우선

공개 API, Event, DB, Policy Schema는 코드보다 먼저 문서와 contract에 반영한다.

```text
요구사항 변경
-> docs 수정
-> packages/contracts 수정
-> DTO / schema / migration 수정
-> service 구현
-> 테스트 구현
```

코드에서 임의 응답 필드, 임의 error code, 임의 event type을 추가하지 않는다.

## 1.3 Gateway 우선

- 고객사 앱, 개발 도구, GateLM Chat UI는 LLM Provider를 직접 호출하지 않는다.
- LLM 호출 코드는 `apps/gateway-core`에만 둔다.
- Web Console과 Control Plane API에서 Provider SDK를 직접 import하지 않는다.
- Provider Key 원문은 Control Plane에서도 직접 다루지 않고 Secrets Manager reference를 기준으로 처리한다.

## 1.4 원문 저장 최소화

- 원문 Prompt/Response는 기본적으로 영속 저장하지 않는다.
- 로그, 에러, 테스트 fixture, snapshot에 원문 Prompt/Response나 Provider Key를 남기지 않는다.
- 저장 가능한 값은 `redactedPrompt`, `responseSummary`, `promptHash`, `responseHash`, token/cost/latency/cache/routing/masking metadata 중심이다.
- 원문 저장이 필요한 경우 tenant 설정, 암호화, retention 정책이 먼저 있어야 한다.

## 1.5 얇은 Controller, 두꺼운 Service

Controller와 Route Handler는 아래만 담당한다.

- 인증/인가 guard 연결
- Request DTO validation
- path/query/body 파싱
- service 호출
- response DTO 반환

비즈니스 규칙은 Service 또는 Domain layer에 둔다.

Repository는 DB 접근만 담당한다. Repository 안에 예산 정책, 라우팅 판단, 권한 판단을 넣지 않는다.

---

# 2. 공통 네이밍 규칙

## 2.1 언어별 기본 네이밍

| 대상 | 규칙 | 예시 |
|---|---|---|
| TypeScript 변수/함수 | `camelCase` | `createProject`, `tenantId` |
| TypeScript class/interface/type | `PascalCase` | `ProjectService`, `CreateProjectRequestDto` |
| TypeScript 파일 | `kebab-case` + 역할 suffix | `project.service.ts`, `create-project.dto.ts` |
| React component | `PascalCase` | `ProjectList`, `RequestLogDrawer` |
| React hook | `use` prefix + `PascalCase` | `useProjects`, `useRequestLog` |
| Go package | 짧은 lowercase | `gateway`, `routing`, `masking` |
| Go file | `snake_case.go` | `provider_adapter.go` |
| Go exported type/function | `PascalCase` | `ProviderAdapter`, `NewRouter` |
| Go private type/function | `camelCase` | `parseModelName` |
| Python module | `snake_case.py` | `routing_score.py` |
| Python class | `PascalCase` | `EmbeddingRequest` |
| Python function/variable | `snake_case` | `calculate_score` |
| DB table/column | `snake_case` | `tenant_memberships`, `created_at` |
| API JSON field | `camelCase` | `projectId`, `createdAt` |
| Event JSON field | `camelCase` | `requestId`, `cacheStatus` |
| Env var | `UPPER_SNAKE_CASE` | `DATABASE_URL`, `REDIS_URL` |

## 2.2 ID 네이밍

코드 내부에서는 DB PK와 public ID를 구분한다.

| 개념 | 예시 | 설명 |
|---|---|---|
| DB PK | `id: string` | PostgreSQL `uuid` |
| API 노출 ID | `projectId: string` | `project_01J...` 같은 opaque string 가능 |
| 외부 사용자 ID | `externalUserId: string` | 고객사 내부 사용자 식별자 |
| request 추적 ID | `requestId: string` | Gateway/API/Worker/Log에서 공통 사용 |

규칙:

- API 클라이언트는 ID 내부 구조에 의존하면 안 된다.
- DB column은 `tenant_id`, API JSON은 `tenantId`를 사용한다.
- `user_id`와 `external_user_id`를 혼동하지 않는다.
- Gateway request 추적에는 항상 `requestId`를 사용한다.

## 2.3 시간 필드 네이밍

모든 시간 필드는 UTC 기준이다.

| DB | API/TS | 설명 |
|---|---|---|
| `created_at` | `createdAt` | 생성 시각 |
| `updated_at` | `updatedAt` | 마지막 수정 시각 |
| `deleted_at` | `deletedAt` | soft delete 시각 |
| `expires_at` | `expiresAt` | token/key 만료 시각 |
| `revoked_at` | `revokedAt` | 폐기 시각 |
| `published_at` | `publishedAt` | 정책 publish 시각 |

API 응답은 ISO-8601 문자열을 사용한다.

```json
{
  "createdAt": "2026-06-22T06:00:00.000Z"
}
```

## 2.4 상태값 네이밍

상태값은 DB enum으로 고정하지 말고 string으로 둔다.

권장 값:

```text
active, inactive, pending, revoked, expired, deleted, archived
```

정책 action 예시:

```text
allow, block, warn, mask, route, fallback
```

규칙:

- 서버는 알려진 값을 우선 사용한다.
- 클라이언트는 알 수 없는 status/action이 와도 깨지면 안 된다.
- TypeScript에서는 union type을 사용할 수 있지만 외부 입력은 항상 unknown string을 허용할 수 있게 처리한다.

예시:

```ts
type KnownPolicyAction = 'allow' | 'block' | 'warn' | 'mask' | 'route' | 'fallback';
type PolicyAction = KnownPolicyAction | (string & {});
```

## 2.5 Boolean 네이밍

Boolean 값은 의미가 드러나게 작성한다.

좋음:

```ts
isActive
hasMore
canRotate
shouldMask
requiresAppToken
```

나쁨:

```ts
active
more
rotate
mask
flag
```

단, API 계약에서 이미 `active` 같은 필드가 정의되어 있으면 계약을 우선한다.

## 2.6 Count / Amount / Cost 네이밍

| suffix | 의미 | 예시 |
|---|---|---|
| `Count` | 개수 | `requestCount`, `promptTokenCount` |
| `Amount` | 금액 또는 수량 | `budgetAmount` |
| `Cost` | 비용 | `estimatedCost`, `actualCost` |
| `Rate` | 비율 | `cacheHitRate`, `errorRate` |
| `Ms` | millisecond | `latencyMs`, `ttftMs` |

단위가 있는 값은 이름에 단위를 포함한다.

좋음:

```ts
latencyMs
monthlyBudgetUsd
retentionDays
```

나쁨:

```ts
latency
budget
retention
```

---

# 3. TypeScript / NestJS 컨벤션

## 3.1 기본 원칙

- `strict` mode를 사용한다.
- `any`는 금지한다. 불가피하면 `unknown`을 사용하고 좁혀서 처리한다.
- `null`과 `undefined`를 혼용하지 않는다.
- API에서 명시적 empty value는 `null`, 생략 가능한 필드는 `undefined`를 사용한다.
- public method는 반환 타입을 명시한다.
- async function은 `Promise<T>` 반환 타입을 명시한다.
- 비즈니스 로직에서 `console.log`를 사용하지 않는다. logger를 사용한다.

## 3.2 파일명

NestJS 파일은 역할 suffix를 붙인다.

```text
project.module.ts
project.controller.ts
project.service.ts
project.repository.ts
project.entity.ts
create-project.dto.ts
project-response.dto.ts
project.mapper.ts
project.policy.ts
project.service.spec.ts
```

역할이 불분명한 `project.utils.ts`, `project.helper.ts`, `common.ts`를 만들지 않는다. 유틸이 필요하면 도메인 내부에 명확한 이름으로 둔다.

## 3.3 Class 네이밍

| 역할 | 규칙 | 예시 |
|---|---|---|
| Module | `<Domain>Module` | `ProjectsModule` |
| Controller | `<Domain>Controller` | `ProjectsController` |
| Service | `<Domain>Service` | `ProjectsService` |
| Repository | `<Domain>Repository` | `ProjectsRepository` |
| Entity | `<Domain>Entity` | `ProjectEntity` |
| Request DTO | `<Action><Domain>RequestDto` | `CreateProjectRequestDto` |
| Response DTO | `<Domain>ResponseDto` | `ProjectResponseDto` |
| List Response DTO | `List<DomainPlural>ResponseDto` | `ListProjectsResponseDto` |
| Mapper | `<Domain>Mapper` | `ProjectMapper` |
| Guard | `<Purpose>Guard` | `TenantMembershipGuard` |
| Exception Filter | `<Purpose>ExceptionFilter` | `HttpExceptionFilter` |

## 3.4 Controller 작성 방식

Controller는 얇게 유지한다.

좋음:

```ts
@Post()
async createProject(
  @CurrentTenantId() tenantId: string,
  @Body() body: CreateProjectRequestDto,
): Promise<DataEnvelope<ProjectResponseDto>> {
  const project = await this.projectsService.createProject({
    tenantId,
    name: body.name,
    description: body.description ?? null,
  });

  return { data: ProjectMapper.toResponse(project) };
}
```

나쁨:

```ts
@Post()
async createProject(@Body() body: any) {
  if (!body.name) throw new Error('name required');
  const row = await this.prisma.project.create({ data: body });
  return row;
}
```

금지:

- Controller에서 Prisma 직접 호출
- Controller에서 Provider SDK 호출
- Controller에서 정책 판단 직접 수행
- Controller에서 response shape 임의 생성
- Controller에서 원문 Prompt/Response 로그 출력

## 3.5 Service 작성 방식

Service는 use case 단위로 public method를 작성한다.

```ts
async createProject(input: CreateProjectInput): Promise<Project> {
  await this.assertTenantCanCreateProject(input.tenantId);

  const project = Project.create({
    tenantId: input.tenantId,
    name: input.name,
    description: input.description,
  });

  return this.projectsRepository.save(project);
}
```

규칙:

- public method는 명령형 이름을 사용한다: `createProject`, `rotateApiKey`, `publishPolicy`.
- validation은 boundary validation과 business validation을 구분한다.
- transaction이 필요한 경우 service에서 transaction boundary를 잡는다.
- 외부 API 호출은 adapter/client를 통해 수행한다.
- service method 인자는 객체 하나로 받는다. 인자가 3개 이상인 positional parameter는 금지한다.

좋음:

```ts
await this.apiKeysService.rotateApiKey({
  tenantId,
  projectId,
  apiKeyId,
  actorUserId,
});
```

나쁨:

```ts
await this.apiKeysService.rotateApiKey(tenantId, projectId, apiKeyId, actorUserId);
```

## 3.6 Repository 작성 방식

Repository는 DB 접근과 mapping만 담당한다.

```ts
async findById(input: FindProjectByIdInput): Promise<Project | null> {
  const row = await this.prisma.project.findFirst({
    where: {
      id: input.projectId,
      tenantId: input.tenantId,
      deletedAt: null,
    },
  });

  return row ? ProjectMapper.fromPrisma(row) : null;
}
```

규칙:

- multi-tenant table 조회는 반드시 `tenantId` 조건을 포함한다.
- soft delete 대상 table은 기본적으로 `deletedAt: null` 조건을 포함한다.
- repository는 HTTP exception을 던지지 않는다.
- repository는 domain error 또는 `null`을 반환한다.
- repository는 API response DTO를 반환하지 않는다.

## 3.7 DTO 작성 방식

DTO는 외부 boundary에만 사용한다.

- Request DTO: HTTP body/query/path validation
- Response DTO: API response shape 고정
- Domain model: 비즈니스 로직 내부 표현
- Entity/Prisma model: DB 표현

DTO와 Domain model을 섞지 않는다.

예시:

```ts
export class CreateProjectRequestDto {
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class ProjectResponseDto {
  id!: string;
  tenantId!: string;
  name!: string;
  description!: string | null;
  status!: string;
  createdAt!: string;
  updatedAt!: string;
}
```

DTO 규칙:

- API JSON field는 `camelCase`를 사용한다.
- DB column 이름을 DTO에 노출하지 않는다.
- `provider`, `model`, `status`, `action`은 string으로 받는다.
- create/update 요청에서 서버가 정하는 필드는 body로 받지 않는다.
- `tenantId`, `actorUserId`, `requestId`는 가능하면 인증 context/header/path에서 가져온다.
- Response DTO는 secret 원문을 포함하지 않는다.
- API Key/App Token 원문은 생성/회전 응답에서만 1회 반환한다.

## 3.8 Mapper 작성 방식

외부 응답 변환은 mapper에서 처리한다.

```ts
export class ProjectMapper {
  static toResponse(project: Project): ProjectResponseDto {
    return {
      id: project.publicId,
      tenantId: project.tenantPublicId,
      name: project.name,
      description: project.description,
      status: project.status,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}
```

규칙:

- Controller에서 수동 mapping을 길게 작성하지 않는다.
- Entity/Prisma row를 그대로 response로 반환하지 않는다.
- Date는 mapper에서 ISO string으로 변환한다.
- secret, hash, internal id 노출 여부는 mapper에서 명확히 통제한다.

---

# 4. Go Gateway Core 컨벤션

## 4.1 기본 원칙

- `gofmt`와 `go vet`을 통과해야 한다.
- 모든 request-scoped 함수는 첫 번째 인자로 `context.Context`를 받는다.
- panic은 금지한다. 서버 시작 시 설정 오류처럼 복구 불가능한 경우에만 사용한다.
- Provider 호출, Redis 호출, AI Service 호출은 timeout과 context cancellation을 반드시 따른다.
- Gateway hot path에서는 불필요한 allocation과 blocking I/O를 피한다.
- 원문 Prompt/Response를 log에 남기지 않는다.

## 4.2 Package 네이밍

Go package는 짧고 명확한 lowercase를 사용한다.

```text
internal/pipeline
internal/auth
internal/identity
internal/ratelimit
internal/quota
internal/policy
internal/masking
internal/cache
internal/routing
internal/provider
internal/events
```

`common`, `util`, `helper` package를 남용하지 않는다.

## 4.3 Interface 위치

Interface는 사용하는 쪽 package에 둔다.

좋음:

```go
package routing

type ProviderRegistry interface {
    Get(provider string) (provider.Adapter, bool)
}
```

나쁨:

```go
package common

type ProviderRegistry interface { ... }
```

## 4.4 Error 처리

Go error는 wrapping한다.

```go
if err != nil {
    return nil, fmt.Errorf("call provider %s: %w", providerName, err)
}
```

규칙:

- 사용자에게 반환할 error와 내부 원인을 분리한다.
- `errors.Is`, `errors.As`로 분기 가능한 sentinel/domain error를 사용한다.
- Provider error body를 그대로 사용자에게 노출하지 않는다.
- Provider credential, raw prompt, raw response는 error message에 포함하지 않는다.

## 4.5 Gateway Pipeline Stage 작성

Stage는 입력 context를 받아 명확한 결과를 반환한다.

```go
type Stage interface {
    Name() string
    Execute(ctx context.Context, req *pipeline.RequestContext) error
}
```

규칙:

- Stage는 한 가지 책임만 가진다.
- Stage 순서는 `architecture.md`의 Gateway 흐름을 따른다.
- 인증 실패, quota 초과, policy block은 Provider 호출 전에 중단한다.
- Stage는 다음 stage의 내부 구현에 의존하지 않는다.
- stage 간 공유 데이터는 `RequestContext`에 명시 필드로 둔다.
- 임의 데이터를 넣기 위해 `map[string]any`를 남용하지 않는다.

## 4.6 Provider Adapter 작성

Provider adapter는 Provider별 요청/응답 차이를 캡슐화한다.

```go
type Adapter interface {
    Name() string
    CreateChatCompletion(ctx context.Context, req ChatCompletionRequest) (*ChatCompletionResponse, error)
    StreamChatCompletion(ctx context.Context, req ChatCompletionRequest) (<-chan StreamEvent, error)
}
```

규칙:

- Provider별 request/response 변환은 adapter 내부에 둔다.
- Gateway handler에 Provider별 조건문을 만들지 않는다.
- Streaming 구현은 client disconnect를 감지하고 Provider 연결을 닫아야 한다.
- retry/fallback 가능 여부를 error type으로 표현한다.

---

# 5. Python AI Service 컨벤션

## 5.1 기본 원칙

- Python 코드는 `black`, `ruff`, `mypy` 기준을 따른다.
- FastAPI route는 얇게 유지한다.
- Pydantic model로 request/response를 검증한다.
- route 함수에서 비즈니스 로직을 길게 작성하지 않는다.
- embedding, semantic cache, routing score 계산은 service layer에 둔다.

## 5.2 네이밍

```text
module: routing_score.py
class: RoutingScoreService
function: calculate_routing_score
variable: model_name
constant: DEFAULT_EMBEDDING_DIMENSION
```

## 5.3 Pydantic Model

```py
class EmbeddingRequest(BaseModel):
    tenant_id: str = Field(alias="tenantId")
    text_hash: str = Field(alias="textHash")
    redacted_text: str = Field(alias="redactedText")

    model_config = ConfigDict(populate_by_name=True)
```

규칙:

- 외부 JSON은 `camelCase`를 사용한다.
- Python 내부 변수는 `snake_case`를 사용한다.
- 원문 Prompt 대신 redacted text 또는 hash를 우선 사용한다.
- AI Service가 Provider Key를 직접 다루지 않는다.

## 5.4 예외 처리

- domain exception을 정의하고 FastAPI exception handler에서 HTTP response로 변환한다.
- raw exception을 그대로 반환하지 않는다.
- embedding provider 오류, timeout, invalid input을 구분한다.
- 로그에는 `requestId`, `tenantId`, `operation` 중심으로 남기고 원문 text는 남기지 않는다.

---

# 6. Next.js / React 컨벤션

## 6.1 기본 원칙

- Next.js App Router를 기준으로 한다.
- Page file은 route 연결만 담당한다.
- 기능 UI는 `src/features/<domain>` 아래에 둔다.
- 공통 UI는 `src/components`에 둔다.
- 서버에서만 사용 가능한 코드는 client component에 import하지 않는다.
- Web Console은 Provider SDK를 직접 import하지 않는다.

## 6.2 Component 네이밍

```text
ProjectList.tsx
ProjectCreateDialog.tsx
RequestLogTable.tsx
RequestLogDetailDrawer.tsx
PolicyEditor.tsx
```

규칙:

- Component는 `PascalCase`를 사용한다.
- Hook은 `use` prefix를 사용한다.
- API 호출 함수는 `src/lib/api` 또는 feature 내부 `api`에 둔다.
- 복잡한 화면 상태는 custom hook으로 분리한다.
- table column 정의는 화면 component 안에 길게 두지 말고 별도 파일로 분리한다.

## 6.3 Client / Server Component 기준

Server Component:

- 초기 데이터 fetch
- 권한 확인
- SEO/metadata
- server-only config 접근

Client Component:

- form state
- modal/drawer state
- chart interaction
- live search/filter
- optimistic UI

규칙:

- `use client`는 필요한 component에만 붙인다.
- `use client`가 붙은 파일에서 server-only module을 import하지 않는다.
- token, secret, provider key를 client bundle에 포함하지 않는다.

## 6.4 Form 작성

- form schema는 명확한 validation schema를 사용한다.
- API error의 `fieldErrors`를 form field에 연결한다.
- submit 중복 방지를 적용한다.
- 성공 후 list invalidate/refetch 기준을 명확히 한다.

---

# 7. Worker 컨벤션

## 7.1 기본 원칙

Worker는 Redpanda event를 소비해 ClickHouse/PostgreSQL/S3 저장, 집계, 알림을 처리한다.

규칙:

- event handler는 idempotent해야 한다.
- 같은 event가 두 번 들어와도 ledger와 analytics가 중복 반영되면 안 된다.
- event schema version을 확인한다.
- 처리 실패 시 retry 가능 오류와 poison event를 구분한다.
- 원문 Prompt/Response 저장은 tenant 정책을 확인한 경우에만 허용한다.

## 7.2 Handler 네이밍

```ts
LlmInvocationCompletedHandler
ProviderAttemptFailedHandler
MaskingAppliedHandler
BudgetThresholdReachedHandler
```

## 7.3 Event 처리 흐름

```text
consume event
-> validate schema version
-> deduplicate by eventId
-> transform to analytics/ledger model
-> write ClickHouse/PostgreSQL/S3
-> commit offset
```

규칙:

- offset commit은 저장 성공 후 수행한다.
- partial failure가 가능한 저장은 outbox 또는 retry queue를 사용한다.
- 대량 로그 저장은 PostgreSQL이 아니라 ClickHouse를 우선 사용한다.

---

# 8. 함수 작성 방식

## 8.1 함수 크기

함수는 한 가지 일을 해야 한다.

권장 기준:

- 일반 함수: 30줄 이하 권장
- Controller method: 20줄 이하 권장
- 복잡한 service method: 단계별 private method로 분리
- 3단계 이상 중첩되는 if/for는 guard clause 또는 함수 분리 검토

이 기준은 절대 숫자가 아니라 가독성 기준이다. 단, 100줄 이상의 함수는 원칙적으로 금지한다.

## 8.2 인자 규칙

인자가 3개 이상이면 객체로 받는다.

좋음:

```ts
type CheckQuotaInput = {
  tenantId: string;
  projectId: string;
  appTokenId: string | null;
  estimatedTokenCount: number;
};

async checkQuota(input: CheckQuotaInput): Promise<QuotaCheckResult> {}
```

나쁨:

```ts
async checkQuota(tenantId: string, projectId: string, appTokenId: string | null, estimatedTokenCount: number) {}
```

## 8.3 반환값 규칙

- 성공/실패가 비즈니스 결과라면 `Result` type 또는 명확한 union을 사용한다.
- 예외 상황은 exception/error로 처리한다.
- `null` 반환은 “없음”의 의미일 때만 사용한다.
- 실패 이유를 표현하기 위해 `false`만 반환하지 않는다.

좋음:

```ts
type PolicyDecision =
  | { action: 'allow'; policyVersionId: string }
  | { action: 'block'; policyVersionId: string; reasonCode: string }
  | { action: 'redact'; policyVersionId: string; redactedPrompt: string };
```

나쁨:

```ts
async checkPolicy(): Promise<boolean> {}
```

## 8.4 Side Effect 명시

함수 이름은 side effect를 드러내야 한다.

| 함수명 | 의미 |
|---|---|
| `getProject` | 조회만 수행 |
| `createProject` | 생성 수행 |
| `ensureProjectExists` | 없으면 예외 |
| `assertCanAccessProject` | 권한 없으면 예외 |
| `calculateCost` | 순수 계산 |
| `recordUsage` | 저장 side effect 있음 |
| `publishPolicy` | 상태 변경 및 이벤트 발행 가능 |

`handle`, `process`, `doWork`, `run` 같은 이름은 구체적인 의미가 없으면 사용하지 않는다.

## 8.5 순수 함수 우선

비즈니스 계산은 가능하면 순수 함수로 분리한다.

예시:

```ts
export function calculateEstimatedCost(input: CalculateEstimatedCostInput): CostEstimate {
  return {
    promptCost: input.promptTokens * input.promptTokenUnitPrice,
    completionCost: input.completionTokens * input.completionTokenUnitPrice,
  };
}
```

순수 함수는 테스트하기 쉽고 Gateway/Worker/Control Plane에서 재사용하기 좋다.

---

# 9. DTO 작성 기준

## 9.1 Request DTO

Request DTO는 입력 검증에 집중한다.

규칙:

- 필수 필드는 명확히 required로 둔다.
- optional 필드는 `?`로 표시한다.
- nullable 필드는 `null`을 허용할 때만 사용한다.
- 문자열 길이 제한을 둔다.
- 배열은 최대 길이를 둔다.
- object metadata는 크기 제한과 key 제한을 둔다.
- Provider/Model string은 허용하되 길이 제한을 둔다.

예시:

```ts
export class CreateModelAllowlistEntryRequestDto {
  @IsString()
  @MaxLength(80)
  provider!: string;

  @IsString()
  @MaxLength(120)
  model!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
```

## 9.2 Response DTO

Response DTO는 API 계약을 고정한다.

규칙:

- Date 객체를 그대로 반환하지 않는다.
- BigInt를 그대로 반환하지 않는다.
- DB 내부 PK를 노출할지 public ID를 노출할지 명확히 한다.
- secret, hashed secret, encrypted blob을 반환하지 않는다.
- `metadata`는 확장 필드용이다. 핵심 필드를 `metadata`에 숨기지 않는다.

## 9.3 Update DTO

Update DTO는 partial update와 replace update를 구분한다.

- `PATCH`: 일부 필드만 수정
- `PUT`: 전체 리소스 교체

MVP에서는 대부분 `PATCH`를 사용한다.

주의:

```ts
name?: string;
description?: string | null;
```

- `undefined`: 변경하지 않음
- `null`: 값을 비움
- `string`: 해당 값으로 변경

이 차이를 service에서 보존해야 한다.

## 9.4 Query DTO

List API query DTO는 cursor pagination을 따른다.

```ts
export class ListProjectsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;

  @IsOptional()
  @IsString()
  sort?: string = '-createdAt';
}
```

규칙:

- `limit` 최대값은 200이다.
- 기본 정렬은 `-createdAt`이다.
- 대량 로그 조회는 기간 필터를 요구할 수 있다.

---

# 10. 예외 처리 방식

## 10.1 예외 계층

GateLM은 domain error와 transport error를 구분한다.

```text
Domain Error
- ValidationError
- NotFoundError
- PermissionDeniedError
- PolicyBlockedError
- QuotaExceededError
- BudgetExceededError
- SensitiveDataBlockedError

Infrastructure Error
- ProviderTimeoutError
- ProviderUnavailableError
- RedisUnavailableError
- SecretsManagerError
- EventPublishError

HTTP Error Mapping
- Control Plane Error Response
- Gateway OpenAI-compatible Error Response
```

## 10.2 Error Code

Error code는 `api-spec.md`의 공통 error code를 따른다.

Control Plane 예시:

```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Project quota exceeded.",
    "details": {
      "projectId": "project_01J..."
    },
    "requestId": "request_01J...",
    "retryable": false
  }
}
```

Gateway 예시:

```json
{
  "error": {
    "message": "Project quota exceeded.",
    "type": "gatelm_quota_error",
    "param": null,
    "code": "quota_exceeded",
    "request_id": "request_01J..."
  }
}
```

## 10.3 Throw 기준

Throw 가능한 경우:

- 인증 실패
- 권한 없음
- 리소스 없음
- 정책 차단
- quota/budget 초과
- provider timeout
- validation 실패
- 복구 불가능한 infrastructure 오류

Throw하지 말아야 하는 경우:

- 단순히 값이 없는 조회. 이 경우 `null` 반환 가능
- policy decision 자체. `allow/block/mask/warn` 결과로 표현
- cache hit/miss. 정상 결과로 표현
- routing 결과. 정상 결과로 표현

## 10.4 Error Message 기준

Error message는 사용자에게 보여도 안전해야 한다.

금지:

- Provider Key 원문 포함
- App Token 원문 포함
- 원문 Prompt/Response 포함
- SQL query 원문 포함
- 내부 stack trace 포함
- Provider raw response 전체 포함

좋음:

```text
Provider request timed out.
Project quota exceeded.
Policy blocked this request.
```

나쁨:

```text
OpenAI error: { raw provider body ... }
Failed prompt: 사용자의 원문 프롬프트...
Database query failed: select * from secrets...
```

## 10.5 Retry 기준

Retry 가능한 오류:

- provider 429/5xx 중 retryable로 판단되는 경우
- provider timeout
- 일시적 network 오류
- Redpanda publish transient failure

Retry 금지:

- 인증 실패
- 권한 없음
- quota/budget 초과
- policy block
- sensitive data block
- request validation error
- invalid provider/model 설정

Retry는 exponential backoff를 사용하고, 무한 retry를 금지한다.

---

# 11. 응답 형식

## 11.1 Control Plane 성공 응답

Control Plane API는 envelope을 사용한다.

단건:

```json
{
  "data": {
    "id": "project_01J..."
  }
}
```

목록:

```json
{
  "data": [],
  "pagination": {
    "limit": 50,
    "nextCursor": null,
    "hasMore": false
  }
}
```

삭제 성공:

```text
204 No Content
```

규칙:

- Control Plane에서 raw entity를 반환하지 않는다.
- 성공 응답에 `error` 필드를 섞지 않는다.
- 실패 응답에 `data` 필드를 섞지 않는다.
- list 응답은 항상 pagination을 포함한다.

## 11.2 Gateway 성공 응답

Gateway API는 OpenAI-compatible response shape을 우선한다.

규칙:

- `/v1/chat/completions`는 Control Plane envelope을 사용하지 않는다.
- Gateway 내부 metadata는 header 또는 OpenAI-compatible 확장 필드에 둔다.
- request 추적을 위해 `X-GateLM-Request-Id`를 반환한다.
- cache/routing/masking 결과는 debug 권한이 있는 경우에만 확장 노출한다.

권장 header:

```text
X-GateLM-Request-Id: request_01J...
X-GateLM-Cache-Status: hit | miss | bypass | error
X-GateLM-Routing-Decision: route_01J...
X-GateLM-Masking-Action: none | redacted | blocked
```

## 11.3 Error Response

Control Plane error:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request body is invalid.",
    "details": {
      "fieldErrors": {
        "name": ["name is required"]
      }
    },
    "requestId": "request_01J...",
    "retryable": false
  }
}
```

Gateway error:

```json
{
  "error": {
    "message": "Project quota exceeded.",
    "type": "gatelm_quota_error",
    "param": null,
    "code": "quota_exceeded",
    "request_id": "request_01J..."
  }
}
```

규칙:

- error code는 문서화된 값을 사용한다.
- validation error는 field별 오류를 제공한다.
- retry 가능한 오류는 `retryable: true`로 표시한다.
- Gateway error는 OpenAI-compatible shape을 유지한다.

---

# 12. Import 규칙

## 12.1 공통 Import 방향

의존성 방향은 아래를 따른다.

```text
controller / route
-> service / use-case
-> domain
-> repository / adapter / client
-> infrastructure
```

반대 방향 import는 금지한다.

금지 예시:

- Repository가 Service를 import
- Domain model이 NestJS decorator를 import
- packages/shared가 apps/control-plane-api를 import
- Web client component가 server-only module을 import
- Control Plane이 Provider SDK를 import

## 12.2 TypeScript Import 순서

TypeScript import는 아래 순서를 따른다.

```ts
// 1. Node / framework
import { Injectable } from '@nestjs/common';

// 2. external packages
import { z } from 'zod';

// 3. internal absolute imports
import { PrismaService } from '@/infrastructure/database/prisma/prisma.service';
import { ProjectMapper } from '@/modules/projects/mappers/project.mapper';

// 4. relative imports in same folder only
import { CreateProjectRequestDto } from './dto/create-project.dto';
```

규칙:

- 먼 상위 경로를 향한 `../../../..` import를 피한다.
- service 간 순환 참조를 만들지 않는다.
- type만 필요한 경우 `import type`을 사용한다.
- barrel export는 순환 참조 위험이 있으면 사용하지 않는다.

## 12.3 Path Alias

권장 alias:

```text
@/config
@/common
@/modules
@/infrastructure
@/features
@/components
@/lib
@/hooks
```

alias는 서비스별 `tsconfig`에 명확히 정의한다.

## 12.4 packages/shared 규칙

`packages/shared`에는 순수 TypeScript 코드만 둔다.

허용:

- 순수 type
- enum-like constant
- date/number/string utility
- ID parsing/formatting utility
- cost calculation 같은 순수 함수

금지:

- DB client
- Redis client
- HTTP client instance
- NestJS provider
- React component
- Node runtime에 의존하는 코드
- 환경변수 직접 접근

---

# 13. 주석 기준

## 13.1 기본 원칙

주석은 “무엇을 하는지”보다 “왜 이렇게 하는지”를 설명한다.

좋음:

```ts
// Provider raw error에는 prompt 일부가 포함될 수 있으므로 그대로 노출하지 않는다.
throw new ProviderError('Provider request failed.', { cause: error });
```

나쁨:

```ts
// 에러를 던진다.
throw new Error('error');
```

## 13.2 필수 주석

아래 경우에는 주석을 남긴다.

- 보안상 중요한 결정
- 원문 Prompt/Response 저장 여부
- retry/fallback 조건
- 비용 계산 공식
- cache key 생성 방식
- policy evaluation 순서
- migration에서 데이터 손실 가능성이 있는 작업
- 임시 우회 코드

## 13.3 TODO 규칙

TODO는 담당자와 이유를 포함한다.

```ts
// TODO(gatelm-team): Semantic cache threshold를 tenant policy에서 읽도록 변경한다.
```

금지:

```ts
// TODO: fix later
```

## 13.4 금지 주석

- 죽은 코드를 주석 처리해 남기지 않는다.
- secret, token, key 예시를 실제 값처럼 남기지 않는다.
- 원문 Prompt/Response sample을 테스트 외부 주석에 남기지 않는다.
- 코드와 맞지 않는 오래된 주석을 방치하지 않는다.

---

# 14. Logging 컨벤션

## 14.1 구조화 로그

로그는 JSON 구조화 로그를 사용한다.

공통 필드:

```json
{
  "level": "info",
  "message": "Gateway request completed.",
  "requestId": "request_01J...",
  "tenantId": "tenant_01J...",
  "projectId": "project_01J...",
  "operation": "gateway.chatCompletion",
  "latencyMs": 320,
  "cacheStatus": "miss",
  "provider": "openai",
  "model": "gpt-4o-mini"
}
```

## 14.2 로그 금지 데이터

절대 로그에 남기지 않는다.

- Provider API Key 원문
- GateLM API Key 원문
- App Token 원문
- 원문 Prompt
- 원문 Response
- Authorization header
- Cookie
- 주민등록번호, 전화번호, 이메일 등 민감정보 원문
- Secrets Manager payload

## 14.3 Error 로그

Error 로그에는 원인 추적에 필요한 metadata만 남긴다.

좋음:

```json
{
  "level": "error",
  "message": "Provider request failed.",
  "requestId": "request_01J...",
  "provider": "openai",
  "model": "gpt-4o-mini",
  "errorCode": "PROVIDER_TIMEOUT",
  "retryable": true
}
```

나쁨:

```json
{
  "level": "error",
  "message": "Provider failed with prompt: ..."
}
```

## 14.4 Product Analytics와 System Logs 분리

- 시스템 로그: 장애, latency, infra 상태 확인용
- 제품 분석 이벤트: 사용량, 비용, cache, routing, masking 분석용

제품 분석 이벤트는 Redpanda event로 발행하고 Worker가 저장한다. 시스템 로그에 제품 분석 데이터를 중복으로 밀어넣지 않는다.

---

# 15. 보안 코딩 규칙

## 15.1 Secret 처리

- Provider Key 원문은 AWS Secrets Manager + KMS에 저장한다.
- PostgreSQL에는 secret reference만 저장한다.
- API Key/App Token은 hash만 저장한다.
- Key 원문은 생성/회전 응답에서만 1회 반환한다.
- Key 원문을 테스트 fixture, log, error, screenshot, seed 파일에 남기지 않는다.

## 15.2 인증/인가

- Control Plane API는 JWT + tenant membership + permission scope를 확인한다.
- Gateway API는 API Key와 App Token을 분리 검증한다.
- multi-tenant 리소스 접근 시 tenant boundary를 항상 확인한다.
- Web UI에서 숨긴 버튼은 보안이 아니다. 서버에서 반드시 권한을 검증한다.

## 15.3 민감정보 처리

- masking은 Provider 호출 전에 수행한다. 세부 detector/action/storage 기준은 `pii-masking-policy.md`를 따른다.
- Provider에는 redacted prompt를 전달한다.
- 정책이 block이면 Provider를 호출하지 않는다.
- masking 결과는 metadata로 기록한다.
- 원문은 요청 처리 중 메모리에서만 사용한다.

## 15.4 Cache Key

- cache key에 원문 Prompt를 직접 넣지 않는다.
- exact cache는 canonicalized prompt hash를 사용한다.
- Reply-to Context가 있으면 parent message hash를 cache key에 포함한다.
- tenant/project/model/policy version이 다른 요청끼리 cache가 섞이면 안 된다.

---

# 16. DB / Transaction 코드 규칙

## 16.1 Multi-tenant Query

Tenant-scoped table 조회는 항상 tenant 조건을 포함한다.

좋음:

```ts
await prisma.project.findFirst({
  where: {
    id: projectId,
    tenantId,
    deletedAt: null,
  },
});
```

나쁨:

```ts
await prisma.project.findUnique({ where: { id: projectId } });
```

단, unique constraint가 `(tenant_id, id)` 기준으로 잡혀 있고 ORM에서 이를 명확히 표현하는 경우는 허용한다.

## 16.2 Soft Delete

- 삭제 가능한 테이블은 `deletedAt`을 사용한다.
- 기본 조회는 `deletedAt: null` 조건을 포함한다.
- hard delete는 retention 정책 또는 운영 도구에서만 수행한다.

## 16.3 Transaction

Transaction은 service layer에서 시작한다.

Transaction이 필요한 경우:

- API Key 생성 + audit log 기록
- policy version 생성 + binding 교체
- budget ledger 반영 + alert event 발행
- invitation 수락 + membership 생성

규칙:

- 외부 Provider 호출을 DB transaction 안에서 수행하지 않는다.
- 긴 작업을 transaction 안에 넣지 않는다.
- transaction 내부에서 event 발행이 필요하면 outbox pattern을 우선 고려한다.

## 16.4 Idempotency

생성/회전/결제성 작업은 `Idempotency-Key`를 지원한다.

- 같은 key와 같은 request fingerprint는 같은 결과를 반환한다.
- 같은 key와 다른 request fingerprint는 conflict 처리한다.
- idempotency record에는 secret 원문을 저장하지 않는다.

---

# 17. API Client / External Client 규칙

## 17.1 Client 위치

외부 시스템 연동은 `clients`, `adapters`, `infrastructure` 계층에 둔다.

예시:

```text
apps/control-plane-api/src/infrastructure/secrets/secrets-manager.client.ts
apps/gateway-core/internal/provider/openai/adapter.go
apps/ai-service/src/adapters/embedding_provider.py
```

## 17.2 Timeout

모든 외부 호출에는 timeout을 설정한다.

- Provider API 호출
- Redis
- PostgreSQL
- ClickHouse
- Secrets Manager
- AI Service
- Redpanda

기본 timeout은 config에서 관리한다. 코드에 magic number로 박지 않는다.

## 17.3 Circuit Breaker / Fallback

Gateway Provider 호출에는 장애 격리 기준을 둔다.

- timeout
- retry
- exponential backoff
- circuit breaker
- fallback route 기록

Fallback은 정책과 allowlist를 위반하면 안 된다.

---

# 18. Config / Environment 규칙

## 18.1 환경변수 접근

`process.env`, `os.Getenv`, `os.environ` 직접 접근은 config layer에서만 허용한다.

금지:

```ts
const redisUrl = process.env.REDIS_URL;
```

허용:

```ts
@Injectable()
export class RedisConfig {
  readonly url = this.configService.getOrThrow<string>('REDIS_URL');
}
```

## 18.2 Config Validation

서비스 시작 시 필수 config를 검증한다.

- DB URL
- Redis URL
- Redpanda broker
- Secrets Manager region
- JWT secret/public key
- Provider timeout
- event topic

검증 실패 시 서버를 시작하지 않는다.

## 18.3 Magic Number 금지

나쁨:

```ts
setTimeout(fn, 3000);
```

좋음:

```ts
setTimeout(fn, this.providerConfig.timeoutMs);
```

정책성 값은 Runtime Policy 또는 DB config에서 관리한다.

---

# 19. 테스트 컨벤션

## 19.1 테스트 종류

| 종류 | 위치 | 목적 |
|---|---|---|
| Unit Test | domain/service 근처 | 순수 로직, 정책 판단, cost 계산 |
| Integration Test | 각 app test 폴더 | DB, Redis, 외부 client adapter |
| Contract Test | packages/contracts | API/Event schema 호환성 |
| E2E Test | apps/*/test/e2e | 주요 사용자 흐름 |

## 19.2 테스트 네이밍

```text
project.service.spec.ts
policy-evaluator.spec.ts
provider_adapter_test.go
test_routing_score.py
```

테스트 이름은 조건과 기대 결과를 포함한다.

좋음:

```ts
it('blocks provider call when project quota is exceeded', async () => {});
```

나쁨:

```ts
it('works', async () => {});
```

## 19.3 필수 테스트 케이스

Gateway 관련 기능은 최소 아래 케이스를 테스트한다.

- 인증 실패 시 Provider 미호출
- App Token 실패 시 Provider 미호출
- Rate Limit 초과 시 Provider 미호출
- Quota/Budget 초과 시 Provider 미호출
- Policy block 시 Provider 미호출
- 민감정보 mask 후 Provider에는 redacted prompt 전달
- Exact Cache hit 시 Provider 미호출
- Provider timeout 시 retry/fallback 판단
- event publish 실패 시 응답 경로 영향 최소화

Control Plane 기능은 최소 아래 케이스를 테스트한다.

- tenant boundary 위반 차단
- role/permission 부족 차단
- API Key 원문 1회 반환
- Provider Key 원문 조회 불가
- policy version immutable 유지
- soft delete 후 기본 조회 제외

## 19.4 테스트 데이터 보안

- 실제 Provider Key를 사용하지 않는다.
- 실제 개인정보를 fixture에 넣지 않는다.
- Prompt sample은 redacted 또는 synthetic data만 사용한다.
- snapshot에 secret-like 값이 들어가면 안 된다.

---

# 20. 코드 리뷰 체크리스트

코드 리뷰 시 아래 항목을 확인한다.

## 20.1 확장성

- Provider/Model이 hard-coded enum으로 닫히지 않았는가?
- 신규 Provider 추가 시 adapter 추가로 확장 가능한가?
- 정책 대상이 특정 리소스에만 고정되지 않았는가?
- metadata에 핵심 비즈니스 필드를 숨기지 않았는가?
- 새 API/Event/DB가 문서에 먼저 반영되었는가?

## 20.2 보안

- 원문 Prompt/Response가 저장되거나 로그에 남지 않는가?
- secret 원문이 DB/API/log/test에 노출되지 않는가?
- tenant boundary를 확인하는가?
- Provider 호출 전 masking/policy/quota 검사가 수행되는가? 마스킹 세부 기준은 `pii-masking-policy.md`를 따르는가?

## 20.3 API 계약

- Control Plane 응답 envelope을 따르는가?
- Gateway 응답이 OpenAI-compatible shape을 유지하는가?
- error code와 status가 `api-spec.md`와 맞는가?
- list API가 cursor pagination을 사용하는가?

## 20.4 코드 구조

- 파일 위치가 `folder-structure.md`와 맞는가?
- Controller/Route Handler가 얇은가?
- 비즈니스 로직이 Service/Domain에 있는가?
- Repository가 DB 접근만 담당하는가?
- import 방향이 올바른가?
- 순환 참조가 없는가?

## 20.5 운영성

- requestId가 로그/응답/event에 연결되는가?
- timeout/retry/fallback 기준이 명확한가?
- event handler가 idempotent한가?
- 실패 시 원인 추적이 가능한 metadata가 남는가?

---

# 21. AI 구현자 금지 사항

AI가 코드를 생성할 때 아래를 금지한다.

- 문서에 없는 폴더 생성
- 문서에 없는 API endpoint 생성
- 문서에 없는 DB table/column 생성
- 문서에 없는 event type 생성
- Provider/Model을 닫힌 enum으로 고정
- `any` 남용
- `utils`, `helpers`, `misc`, `temp`, `common2` 폴더 생성
- Controller에서 Prisma 직접 호출
- React component에서 Provider SDK 직접 호출
- Web Console에서 Provider Key 원문 다루기
- 원문 Prompt/Response 로그 저장
- Provider raw error를 사용자에게 그대로 반환
- API Key/App Token 원문을 DB에 저장
- tenant boundary 없는 query 작성
- Gateway bypass 경로 구현
- MVP 제외 범위인 파일 업로드, 이미지 입력, OCR, RAG, 공식 웹 우회 기능 구현

---

# 22. 새 기능 추가 절차

새 기능은 아래 순서를 따른다.

```text
1. project-overview.md 범위와 충돌 여부 확인
2. architecture.md에서 서비스 경계 확인
3. api-spec.md에 endpoint/response/error 추가
4. db-schema.md에 table/field/index/delete policy 추가
5. folder-structure.md에 위치가 있는지 확인
6. contracts schema 추가 또는 수정
7. coding-convention.md 기준으로 구현
8. unit/integration/e2e 테스트 추가
9. 로그, audit, event 필요 여부 확인
```

새 기능이 기존 구조에 맞지 않는다면 코드를 먼저 만들지 말고 문서를 먼저 바꾼다.

---

# 23. MVP 구현 시 우선 적용할 규칙

MVP에서는 아래 규칙을 반드시 지킨다.

- 모든 LLM 요청은 Gateway를 통과한다.
- Gateway에서 인증, App Token, Rate Limit, Quota, Policy, Masking, Cache, Routing 순서를 지킨다.
- Control Plane과 Gateway의 책임을 섞지 않는다.
- 응답 경로와 분석 경로를 분리한다.
- 원문 Prompt/Response를 기본 저장하지 않는다.
- Provider/Model은 string으로 열어둔다.
- 정책은 Runtime Policy로 관리한다.
- Request Log는 ClickHouse 기준으로 조회한다.
- API Key/App Token 원문은 생성/회전 시점에만 1회 반환한다.
- 문서에 없는 구조를 임의로 만들지 않는다.

---

# 20. 민감정보 마스킹 구현 기준

민감정보 감지, redaction, block, masking event 구현은 `pii-masking-policy.md`를 따른다.

코딩 기준:

- Provider 호출 전 masking stage를 반드시 실행한다.
- `api_key`, `authorization_header`, `jwt`, `resident_registration_number` detector는 MVP 기본값으로 fail-closed 성격을 가진다.
- `llm_masking_events.action`은 `allow`, `redact`, `block`을 사용한다.
- Request Log와 API의 `maskingAction`은 `none`, `redacted`, `blocked`를 사용한다.
- raw prompt, raw response, raw detected value, raw secret은 log, error, metric, test snapshot에 남기지 않는다.
- sample 분석이 필요하면 HMAC 기반 `sampleHash`만 사용한다.
- custom regex는 validation, timeout, audit log 없이 publish하지 않는다.
- detector type과 action value를 임의로 추가하지 않는다. 먼저 `pii-masking-policy.md`, `llm-log-schema.md`, `db-schema.md`, `api-spec.md`를 수정한다.
