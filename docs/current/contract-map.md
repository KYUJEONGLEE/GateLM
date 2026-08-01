# GateLM Current Contract Map

| Field | Value |
|---|---|
| Status | Active contract routing index |
| Authority | 범위별 권위 문서와 lifecycle 연결 |
| Development baseline | `origin/dev @ e54d35b94d0409cf4b6ceba8036735f1ee7afe6e` |
| Last verified | 2026-07-27 |
| Release policy | `Unreleased`; refactor/release gate 완료 후 target `v1.0.0` |
| Contract effect | 새 API/DB/Event/Metrics/Security 의미를 만들지 않음 |

이 문서는 계약 내용을 복사하지 않는다. 작업 범위별로 어떤 문서가 현재
권위를 가지는지 한 곳에서 판별하도록 연결한다. 상세 우선순위와 충돌 처리는
[`source-of-truth.md`](source-of-truth.md)가 소유한다.

## Contract Map

| 범위 | 현재 분류 | 유일한 권위 진입점 | 구현·gap 확인 |
|---|---|---|---|
| 문서 거버넌스 | Active governance | [`README.md`](README.md), [`source-of-truth.md`](source-of-truth.md) | [`documentation-gaps.md`](documentation-gaps.md) |
| 일반 Gateway routing | Active scoped contract | [`../routing/README.md`](../routing/README.md) | [`implementation-status.md`](implementation-status.md), [`documentation-gaps.md`](documentation-gaps.md) |
| 신규 Tenant Chat Product | Active scoped contract | [`../tenant-chat/README.md`](../tenant-chat/README.md) | [`implementation-status.md`](implementation-status.md), [`documentation-gaps.md`](documentation-gaps.md) |
| Tenant Chat RAG 제품 계약 | Active scoped contract | [`../tenant-chat/README.md`](../tenant-chat/README.md) | [`implementation-status.md`](implementation-status.md), [`documentation-gaps.md`](documentation-gaps.md) |
| Tenant Chat RAG 구현 계획·성숙도 | Approved implementation planning; 계약 아님 | [`../rag/implementation-plan.md`](../rag/implementation-plan.md) | [`../rag/validation-matrix.md`](../rag/validation-matrix.md), [`documentation-gaps.md`](documentation-gaps.md) |
| Self-host delivery | Active scoped contract; legacy pre-v1 path | [`../v2.1.0/README.md`](../v2.1.0/README.md) | [`implementation-status.md`](implementation-status.md), [`documentation-gaps.md`](documentation-gaps.md) |
| Advanced Routing offline 평가 | Pre-v1 evidence scope | [`../v2.1.0/README.md`](../v2.1.0/README.md) | [`../testing/`](../testing/), [`documentation-gaps.md`](documentation-gaps.md) |
| 아직 대체되지 않은 Gateway/API/DB/Event/Metrics/Security 의미 | Pre-v1 inherited baseline compatibility | [`../v2.0.0/README.md`](../v2.0.0/README.md) | [`documentation-gaps.md`](documentation-gaps.md) |
| 과거 release-like 문서의 상태와 이관 | Active migration index | [`../pre-v1/README.md`](../pre-v1/README.md) | [`documentation-gaps.md`](documentation-gaps.md) |
| current proposal과 implementation companion | Non-authoritative registry | [`proposals/README.md`](proposals/README.md) | proposal별 baseline과 현재 코드 |
| 현재 구현 사실 | As-built evidence; 계약 아님 | [`implementation-status.md`](implementation-status.md) | 현재 `origin/dev` 코드와 테스트 |
| 미결정·충돌 | Open decision register; 계약 아님 | [`documentation-gaps.md`](documentation-gaps.md) | owner decision과 후속 contract PR |

## 판별 규칙

1. `Active scoped contract`로 표시된 범위만 현재 제품 계약으로 사용한다.
2. proposal은 파일명에 `contract`가 있어도 이 지도에서 Active로 승격되기
   전까지 권위 문서가 아니다.
3. 구현 코드와 implementation companion의 존재는 proposal acceptance,
   release 완료 또는 GA를 뜻하지 않는다.
4. pre-v1 문서는 이 지도에 적힌 범위 밖으로 권위를 확장하거나 출시 상태를 주장하지 않는다.
5. current 대체 계약이 없는 호환성 의미만 v2.0.0 baseline에서 선택한다.
6. 계약을 승격·대체·폐기할 때는 이 지도와
   [`source-of-truth.md`](source-of-truth.md)를 같은 contract PR에서 갱신한다.

## 읽기 순서

```text
docs/current/README.md
  -> docs/current/source-of-truth.md
  -> docs/current/contract-map.md
  -> 위 표의 범위별 권위 진입점
  -> 필요할 때 implementation-status / documentation-gaps
```

이 순서는 모든 계약을 한 파일로 합치는 방식이 아니다. 범위별 계약의 경계를
유지하면서 active 여부를 한 지도에서 일관되게 결정하는 방식이다.
