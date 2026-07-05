# Getting Started

이 문서는 GateLM을 로컬에서 확인하기 위한 최소 실행 안내다. 현재 `v0.1.0`은 release readiness 단계이며 production-ready SaaS나 안정 self-host 배포로 선언하지 않는다.

## 요구 사항

| Runtime | Version |
|---|---|
| Node.js | `22` |
| pnpm | `9.15.0` |
| Go | `apps/gateway-core/go.mod` 기준 |
| PostgreSQL | `16` |
| Redis | `7` |

## 설치

```powershell
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile
```

로컬 의존 서비스는 repository root에서 Docker Compose로 올린다.

```powershell
docker compose up -d
```

## 기본 검증

문서와 계약 정합성:

```powershell
corepack pnpm run verify:v2-docs
```

최종 hardening baseline:

```powershell
corepack pnpm run verify:v2-final
```

영향 범위에 따라 아래 검증을 추가한다.

```powershell
pnpm --filter @gatelm/control-plane-api typecheck
pnpm --filter @gatelm/web typecheck
pnpm --filter @gatelm/application typecheck
go test ./...
```

## 문서 읽는 순서

1. `docs/README.md`
2. `README.md`
3. `specs/gateway/v2.0.0/README.md`
4. `docs/releases/v0.1.0.md`
