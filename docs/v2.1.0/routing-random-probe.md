# GateLM Routing Random Probe

> [!NOTE]
> **문서 상태: Versioned evidence scenario.** 현재 문서 진입점은 [`docs/current/README.md`](../current/README.md)다. 이 probe는 accuracy나 production readiness를 증명하지 않는다.

## 목적

정답 라벨이 없는 한국어 synthetic 입력 1000개를 넣고, 현재 룰 기반 classifier가 어떤 category로 분류하는지 분포와 진단을 관찰한다.

이 문서는 정확도를 계산하는 평가셋이 아니라, 실제 한국어 트래픽에 가까운 샘플을 넣었을 때 category 분류가 한쪽으로 과하게 쏠리는지 확인하는 evidence 문서다.

## 범위

- Gateway, Control Plane, DB, Redis, Provider 서버를 실행하지 않는다.
- 실제 사용자 prompt를 수집하지 않는다.
- raw prompt, raw response, secret, API key, token, header를 포함하지 않는다.
- `expectedCategory` 같은 정답 라벨을 넣지 않는다.
- accuracy가 아니라 category distribution, classifier latency, category diagnostics를 본다.

## 실행

```powershell
corepack pnpm run v2.1:routing:probe
```

리포트는 아래 경로에 저장된다.

```text
reports/routing-probe/routing-probe-<yyyyMMdd-HHmmss>.json
reports/routing-probe/latest.json
```

저장되는 JSON 리포트는 category-only 기계용 필드와 사람이 바로 읽을 수 있는 `한글요약` 블록을 함께 포함한다.

각 샘플에는 synthetic/redacted 입력인 `redactedPrompt`를 포함한다. 이 필드는 사람이 category 판단을 빠르게 검토하기 위한 평가 문맥이며, 실제 고객 raw prompt를 저장한다는 의미가 아니다.

## 해석

| 항목 | 의미 |
|---|---|
| `byCategory` | 한국어 synthetic 입력이 어떤 category로 분류됐는지 |
| `latency` | 룰 기반 category classifier의 avg/p50/p95/max 판단 시간 |
| `samples` | sampleId별 허용된 synthetic/redactedPrompt, category, category diagnostics |

`categoryDiagnostics`는 category 점수, margin, confidence, ambiguity를 확인하기 위한 low-cardinality 진단이다. Probe report에는 tier 분포, 비용 추정, provider/model 선택 또는 routing reason을 포함하지 않는다.

## 현재 한국어 random probe 특징

기본 fixture는 정답을 맞히도록 만든 평가셋이 아니다.

일반 문의, 코드, 요약, 번역, 환불/결제, JSON 구조화, 비교/판단 요청을 섞은 한국어 synthetic traffic mix다.

따라서 결과가 fallback category인 `general`에 과하게 몰리거나 특정 category의 낮은 score margin과 ambiguity가 반복되면 분류 룰과 traffic mix를 검토할 신호로 본다.

## 평가셋과의 차이

| 구분 | 평가셋 | Random Probe |
|---|---|---|
| 목적 | 정답률 측정 | 분포 관찰 |
| 라벨 | `expectedCategory` 있음 | 없음 |
| 주요 지표 | category accuracy/error rate, confusion matrix | category distribution, classifier latency |
| 진단 | 실패 sample과 category diagnostics | sample별 category diagnostics |
| 실패 케이스 | 정답과 다르면 failure | failure 개념 없음 |
| 사용 시점 | 룰 변경 후 회귀 검증 | 룰이 한국어 입력에서 어떻게 흔들리는지 확인 |
