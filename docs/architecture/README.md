# GateLM Architecture Overview

이 문서는 현재 `v0.1.0` release readiness 기준의 공개 아키텍처 개요다. 세부 계약은 `specs/gateway/v2.0.0/contracts.md`를 우선한다.

## 시스템 경계

GateLM은 고객사의 LLM 요청을 Gateway로 모아 정책, 비용, 보안, 캐시, 라우팅, 로그, 관측을 중앙에서 다루는 B2B LLMOps Gateway다.

```text
Customer App / Employee Chat
-> Gateway Core
-> RuntimeSnapshot policy
-> budget / rate limit / safety / routing-aware exact cache
-> Provider Adapter or Mock fallback
-> Request Log / Detail / Dashboard / Metrics
```

## Plane 분리

| 영역 | 책임 |
|---|---|
| Control Plane | organization, tenant/project/application, RuntimeConfig authoring, publish, Provider/Model catalog, credential metadata |
| Data Plane | Gateway request path, RuntimeSnapshot load, auth/context, budget/rate limit, safety, routing, exact cache, Provider Adapter, fallback, streaming thin slice |
| Experience Plane | Web Console, Employee Chat, Customer Demo, Request Log/Detail, Dashboard |
| Evidence Plane | smoke, verifier, k6, provider E2E, release readiness 기록 |

## 현재 구현 경계

- Gateway는 editable RuntimeConfig가 아니라 published RuntimeSnapshot을 소비한다.
- RuntimeSnapshot lookup key는 `tenantId/projectId/applicationId`다.
- Provider/Model은 enum이 아니라 catalog/config data로 취급한다.
- Mock fallback은 MVP 경계 안에서 유지한다.
- Streaming은 thin slice이며 token-level logging은 현재 범위가 아니다.
- AWS 배포형 SaaS와 self-hosting은 제품 방향이지만, `v0.1.0`에서 production-ready 지원으로 주장하지 않는다.

## Reference 문서

아래 문서는 세부 설계나 과거 설계 문맥을 볼 때 참고한다.

| 문서 | 주의 |
|---|---|
| `docs/architecture/architecture.md` | 장기 아키텍처와 과거 v1/P0 표현이 섞인 reference |
| `docs/architecture/api-spec.md` | 초기 API 설계 reference |
| `docs/architecture/db-schema.md` | 초기 DB 설계 reference |
| `docs/architecture/gateway-flow.md` | Gateway flow reference |
| `docs/architecture/dashboard-metrics.md` | Dashboard/metrics reference |

계약/API/DB/Event/Metrics/security-sensitive 판단은 reference 문서가 아니라 `specs/gateway/v2.0.0/`를 따른다.
