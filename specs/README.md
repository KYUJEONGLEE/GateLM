# GateLM Specs

`specs/`는 GateLM의 계약, JSON Schema, fixture처럼 구현 판단에 직접 영향을 주는 자료를 둔다.

사람이 읽는 설명 문서는 `docs/`에 두고, API/DB/Event/Metrics/security-sensitive field 판단은 이 폴더의 versioned spec을 우선한다.

## 현재 Spec

| 위치 | 의미 |
|---|---|
| `specs/gateway/v2.0.0/` | 현재 Gateway 계약, schema, fixture |

`v2.0.0`은 GitHub Release 번호가 아니라 Gateway spec version이다. 다음 소프트웨어 릴리즈 준비 목표는 `v0.1.0`이다.
