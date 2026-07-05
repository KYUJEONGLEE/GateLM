# Roadmap

이 문서는 release cadence와 version naming 기준을 정리한다. 실제 구현 계획은 현재 코드와 release readiness evidence를 기준으로 갱신한다.

## Version 기준

| Version | 기준 |
|---|---|
| `v0.1.0` | Organization-Based Gateway MVP를 한 번에 설명할 수 있는 release readiness |
| `v0.1.x` | 같은 `v0.1.0` 이야기 안의 bug fix, docs, verification, reliability 개선 |
| `v0.2.0` | 새로 설명 가능한 운영 시나리오나 vertical slice가 검증된 상태 |
| `v1.0.0` | 외부 사용자가 production readiness를 기대해도 되는 수준의 안정성, 문서, 운영 절차, 호환성 기준 |

## Release cadence

완벽할 때까지 미루기보다, 의미 있는 변화가 문서화되고 검증되면 release한다.

- Patch release는 작고 안전한 품질 개선을 묶는다.
- Minor release는 사용자가 이해할 수 있는 기능/운영 단위로 묶는다.
- Major release는 호환성 기대치와 production-readiness 책임을 감당할 수 있을 때만 사용한다.

## 현재 우선순위

1. `v0.1.0` release readiness 정리
2. 팀 리뷰와 GitHub Release 승인
3. `v0.1.x` 품질/문서/검증 보강
4. self-host installability와 SaaS deployment evidence를 별도 track으로 정리
