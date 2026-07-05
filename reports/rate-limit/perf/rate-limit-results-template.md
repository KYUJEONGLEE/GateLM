# Rate Limit: 성능 측정 결과 기록 템플릿

Codex 로컬 성능 측정 템플릿이다. 공식 기준은 항상 `AGENTS.md`, `docs/README.md`, v2.0.0 계약/스키마/fixture를 따른다.

관련 이슈: https://github.com/KYUJEONGLEE/GateLM/issues/162
작성일: 2026-07-04

## 사용 방법

이 파일은 실제 성능 측정 결과를 매번 같은 형식으로 기록하기 위한 템플릿이다.

새로운 실행 결과는 단일 리포트인
`reports/rate-limit/report/rate-limit-performance-report.md`에 누적한다.
이 템플릿은 임시 run note가 필요할 때만 복사해서 사용한다.

```text
reports/rate-limit/runs/rate-limit-run-YYYYMMDD-<scenario>.md
```

raw prompt, raw response, API/App/Provider key, Authorization header, provider raw error body, actual secret은 기록하지 않는다. 요청 내용은 synthetic/redacted 설명만 남긴다.

---

# Rate Limit 성능 측정 실행: `<run-id>`

## Summary

| 항목 | 값 |
|---|---|
| 실행 ID | `<rate-limit-run-001>` |
| 시나리오 | `<E1/E2/E3/E4/E5/E6/E7>` |
| 실행 일시 | `<YYYY-MM-DD HH:mm KST>` |
| 목적 | `<이번 실행으로 확인할 것>` |
| 결과 | `<통과/부분 확인/실패/판단 보류>` |

## Environment

| 항목 | 값 |
|---|---|
| Commit / Branch | `<sha> / <branch>` |
| Gateway / RuntimeSnapshot mode | `<demo/strict>` |
| Provider path | `<mock/actual>` |
| PostgreSQL / Redis | `<version> / <yes-no>` |
| Rate Limit | `<enabled, scope, algorithm, window, limit>` |
| Load | `<tool, VUs/concurrency, RPS, duration>` |

실행 명령은 secret/token을 제거한 형태로만 남긴다.

## Results

| Area | 값 |
|---|---|
| k6 | `requests=<n>, rps=<n>, 200=<n>, 429=<n>, failed=<n>` |
| Gateway latency | `p50=<ms>, p95=<ms>, p99=<ms>, max=<ms>` |
| Rate Limit decision | `allowed=<n>, limited=<n>, p95=<ms>, p99=<ms>` |
| Provider protection | `provider_before=<n>, provider_after=<n>, 429_called_provider=<yes/no>` |
| PostgreSQL | `update_calls=<n>, read_calls=<n>, mean/max=<ms>, lock_wait=<n>` |
| Redis | `operation=<incr/eval/token_bucket>, mean/max=<ms>, errors=<n>` |
| Artifacts | `<k6 summary / csv / graph / metrics scrape / DB snapshot path>` |

## Observation

```text
<서버 응답이 느려진 시점, Rate Limit 판정 지연, DB query/lock wait 변화를 한 문단으로 기록>
```

## Conclusion

| 질문 | 답 |
|---|---|
| Gateway p95/p99가 악화됐는가? | `<yes/no/hold>` |
| Rate Limit decision이 악화됐는가? | `<yes/no/hold>` |
| PostgreSQL query/lock 신호가 있었는가? | `<yes/no/hold>` |
| 429가 provider 호출을 막았는가? | `<yes/no/hold>` |
| Redis fixed-window 비교 근거로 쓸 수 있는가? | `<yes/no/partial>` |
| token bucket 비교가 필요한가? | `<yes/no/partial>` |

Next: `<반복 측정 / Redis fixed-window 비교 / Redis token bucket 비교 / k6 조정>`
