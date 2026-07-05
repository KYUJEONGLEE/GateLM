# Configuration

이 문서는 현재 GateLM 설정을 읽을 때의 기준을 설명한다. 실제 환경 변수 목록은 각 app의 설정 코드와 `.env.example` 파일을 함께 확인한다.

## Runtime 기준

- Node.js: `22`
- pnpm: `9.15.0`
- Gateway: Go module 기준
- Database: PostgreSQL 중심
- Runtime cache/rate limit: Redis 중심

## Gateway 설정 원칙

- Gateway는 editable RuntimeConfig를 직접 소비하지 않는다.
- Gateway는 published RuntimeSnapshot만 소비한다.
- RuntimeSnapshot lookup key는 `tenantId/projectId/applicationId`다.
- 비용과 쿼터 귀속은 `budgetScopeType/budgetScopeId`로 표현한다.
- client-provided budget scope는 신뢰하지 않는다.

## Provider 설정 원칙

- Provider와 Model은 DB enum 또는 code enum으로 고정하지 않는다.
- Provider Adapter 선택은 catalog/config data를 통해 이뤄진다.
- Provider credential은 server-side resolver를 통해 조회한다.
- API Key, App Token, Provider Key, Authorization header는 로그, fixture, metrics label, UI에 평문으로 남기지 않는다.

## Self-host 설정 상태

`deploy/selfhost/`에는 Docker Compose bundle draft가 있다. 다만 `v0.1.0` 기준 검증된 production self-host 지원 경로로 선언하지 않는다. self-host 문서는 향후 installability track의 draft로 취급한다.
