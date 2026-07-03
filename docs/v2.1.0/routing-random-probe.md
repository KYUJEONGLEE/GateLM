# GateLM Routing Random Probe

## 목적

정답 라벨이 없는 한국어 synthetic 입력 1000개를 넣고, 현재 룰 기반 라우터가 어떤 category와 tier로 분류하는지 분포를 관찰한다.

이 문서는 정확도를 계산하는 평가셋이 아니라, 실제 한국어 트래픽에 가까운 샘플을 넣었을 때 라우팅이 한쪽으로 과하게 쏠리는지 확인하는 evidence 문서다.

## 범위

- Gateway, Control Plane, DB, Redis, Provider 서버를 실행하지 않는다.
- 실제 사용자 prompt를 수집하지 않는다.
- raw prompt, raw response, secret, API key, token, header를 포함하지 않는다.
- `expectedCategory`, `expectedTier` 라벨을 넣지 않는다.
- accuracy가 아니라 category/tier distribution을 본다.

## 실행

```powershell
corepack pnpm run v2.1:routing:probe
```

리포트는 아래 경로에 저장된다.

```text
reports/routing-probe/routing-probe-<yyyyMMdd-HHmmss>.json
reports/routing-probe/latest.json
```

저장되는 JSON 리포트는 기존 기계용 필드를 유지하면서, 사람이 바로 읽을 수 있는 `한글요약` 블록도 함께 포함한다.

## 해석

| 항목 | 의미 |
|---|---|
| `byCategory` | 한국어 synthetic 입력이 어떤 category로 분류됐는지 |
| `byTier` | 한국어 synthetic 입력이 어떤 cost tier로 라우팅됐는지 |
| `routingReasons` | 라우팅 사유별 분포 |
| `latency` | 룰 기반 라우팅 판단 시간 |
| `costEstimate` | 모든 요청을 high quality로 보내는 경우 대비 예상 비용 절감 |
| `samples` | sampleId별 category/tier/routingReason. prompt text는 포함하지 않음 |

## 현재 한국어 random probe 특징

기본 fixture는 정답을 맞히도록 만든 평가셋이 아니다.

일반 문의, 코드, 요약, 번역, 환불/결제, JSON 구조화, 비교/판단 요청을 섞은 한국어 synthetic traffic mix다.

따라서 결과가 `general`에 과하게 몰리면 룰이 너무 약하다는 신호이고, 반대로 고비용 tier에 과하게 몰리면 비용 절감 목적과 맞지 않는다는 신호로 본다.

## 평가셋과의 차이

| 구분 | 평가셋 | Random Probe |
|---|---|---|
| 목적 | 정답률 측정 | 분포 관찰 |
| 라벨 | `expectedCategory`, `expectedTier` 있음 | 없음 |
| 주요 지표 | accuracy, error rate | category/tier distribution |
| 실패 케이스 | 정답과 다르면 failure | failure 개념 없음 |
| 사용 시점 | 룰 변경 후 회귀 검증 | 룰이 한국어 입력에서 어떻게 흔들리는지 확인 |
