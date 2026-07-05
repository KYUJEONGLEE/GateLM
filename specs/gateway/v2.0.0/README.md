# Gateway v2.0.0 Spec

이 폴더는 GateLM Gateway v2.0.0 계약의 현재 Source Of Truth다.

## 포함 파일

| 위치 | 의미 |
|---|---|
| `contracts.md` | Gateway runtime, provider, safety, cache, observability 계약 |
| `schemas/*.schema.json` | 계약된 read model/context/schema |
| `fixtures/*.fixture.json` | schema 검증용 synthetic fixture |

## 사용 규칙

- 계약/API/DB/Event/Metrics/security-sensitive field 판단은 `contracts.md`를 먼저 본다.
- schema와 fixture가 계약과 충돌하면 `contracts.md`를 우선한다.
- Provider와 Model은 DB enum 또는 code enum으로 고정하지 않는다.
- Fixture에는 실제 개인정보, 실제 secret, 실제 Authorization header, 실제 Provider Key를 넣지 않는다.

Historical implementation plan과 PR packet은 `docs/archive/gateway-v2.0.0-planning/`에 있다. 해당 문서는 현재 계약을 대체하지 않는다.
