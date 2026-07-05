# Deployment

이 문서는 현재 deployment positioning을 정리한다. GateLM은 AWS 배포형 SaaS와 self-hosting으로 확장할 수 있는 방향을 가진 프로젝트지만, `v0.1.0`에서 production-ready 배포 제품으로 선언하지 않는다.

## 현재 상태

| 경로 | 상태 |
|---|---|
| Local development | 검증과 데모 중심 경로 |
| AWS SaaS | 제품 방향과 아키텍처 목표, 운영 배포 보장 아님 |
| Self-host Docker Compose | `deploy/selfhost/`에 draft 존재, 검증된 지원 경로로 선언하지 않음 |
| Kubernetes | 현재 release readiness 범위 아님 |

## Self-host draft

`deploy/selfhost/`는 single-node Docker Compose installability를 탐색하는 draft다. 이미지 tag, registry, migration, seed, smoke path는 팀 리뷰와 검증이 끝나기 전까지 release 지원 계약으로 보지 않는다.

자세한 draft 문서는 `deploy/selfhost/README.md`에서 확인한다.

## Production 주의

실제 운영 노출 전에는 최소한 아래 항목을 별도 검증해야 한다.

- TLS/reverse proxy
- secret 관리 체계
- backup/restore 절차
- migration/rollback 절차
- provider credential resolver
- rate limit/budget 정책
- log retention과 forbidden data scan
- monitoring/alerting
