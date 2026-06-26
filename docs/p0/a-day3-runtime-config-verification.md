# GateLM P0 A Day3 Runtime Config Verification

## 1. 문서 목적

이 문서는 Day3 A 산출물인 runtime config 기준이 실제 fixture, 코드 상수, 테스트 문서와 일치하는지 확인하는 방법을 정리한다.

---

## 2. 검증 대상

| 대상 | 경로 |
|---|---|
| Active config fixture | `docs/p0/a-day1-active-config.fixture.json` |
| Day3 shared contract | `docs/p0/day3-shared-contract.md` |
| Day3 A config contract | `docs/p0/a-day3-runtime-config.md` |
| Cache key code constant | `apps/gateway-core/internal/domain/cache/cache_key.go` |
| P0 test matrix | `docs/p0/p0-test-matrix.md` |

---

## 3. 실행 방법

PowerShell에서 실행한다.

```powershell
.\scripts\dev\p0-day3-config-check.ps1
```

다른 위치에서 실행할 때는 root를 직접 지정할 수 있다.

```powershell
.\scripts\dev\p0-day3-config-check.ps1 -Root C:\jungle7\llmops
```

---

## 4. 검증 항목

스크립트는 아래 항목을 확인한다.

| 항목 | 기대값 |
|---|---|
| `securityPolicyHash` | `sec_p0_v1` |
| `routingPolicyHash` | `route_p0_v1` |
| `cachePolicyHash` | `cache_p0_v1` |
| default provider | `mock` |
| default model | `mock-balanced` |
| low cost model | `mock-fast` |
| high quality model | `mock-smart` |
| cache mode | `exact_only` |
| exact cache enabled | `true` |
| semantic cache enabled | `false` |
| cache TTL | `3600` |
| fixture cache key material | `securityPolicyVersionId` |
| fixture cache key material | `routingPolicyVersionId` |
| fixture cache key material | `requestParamsHash` |
| exact key material version | `p0-exact-v2` |
| Go cache key JSON tag | `securityPolicyVersionId` |
| Go cache key JSON tag | `routingPolicyVersionId` |
| Go cache key JSON tag | `requestParamsHash` |
| short prompt routing reason | `short_prompt_low_cost` |
| default routing reason | `default_balanced` |

---

## 5. Day3 A 검증 결과 기준

성공 기준:

```text
Day3 runtime config check passed.
```

실패하면 아래 중 하나가 깨졌을 가능성이 높다.

```text
fixture의 policy hash 또는 model name 변경
cache key material 변경
cache key version 변경
Go KeyMaterial JSON tag 변경
p0-test-matrix의 routingReason 불일치
```

---

## 6. 계약 변경이 필요한 경우

아래 값을 바꾸려면 Day3 각 파트에 영향을 준다.

```text
sec_p0_v1
route_p0_v1
cache_p0_v1
mock-fast
mock-balanced
mock-smart
short_prompt_low_cost
default_balanced
p0-exact-v2
```

변경 절차:

```text
1. Daily Sync에서 변경 이유를 먼저 공유한다.
2. 영향을 받는 파트를 B/C/D/E로 표시한다.
3. docs/p0/day3-shared-contract.md와 이 문서를 같이 수정한다.
4. p0-day3-config-check.ps1을 수정한다.
5. 통합 smoke를 다시 실행한다.
```
