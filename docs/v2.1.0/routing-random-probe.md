# GateLM Routing Random Probe

## 목적

정답 라벨이 있는 평가셋은 룰이 기대대로 동작하는지 확인하는 데 사용한다.

반대로 random probe는 정답률을 계산하지 않고, 임의 synthetic 입력 1000개가 현재 룰 기반 라우터에서 어떻게 분류되는지 관찰하는 데 사용한다.

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

## 해석

리포트에서 먼저 볼 항목은 아래와 같다.

| 항목 | 의미 |
|---|---|
| `byCategory` | 임의 입력이 어떤 category로 분류됐는지 |
| `byTier` | 임의 입력이 어떤 cost tier로 라우팅됐는지 |
| `routingReasons` | 라우팅 사유별 분포 |
| `latency` | 룰 기반 라우팅 판단 시간 |
| `costEstimate` | 모든 요청을 high quality로 보냈을 때 대비 상대 비용 추정 |
| `samples` | sampleId별 category/tier/routingReason. prompt text는 포함하지 않음 |

## 현재 synthetic random probe 특징

기본 fixture는 의도적으로 특정 category 정답을 맞히도록 만든 데이터가 아니다.

대부분은 중립적인 업무 문장이고, 일부는 임의 조합 문장 또는 긴 중립 문장이다.

따라서 결과가 `general`에 많이 몰리는 것은 버그가 아니라 현재 룰 기반 classifier의 성격을 보여주는 evidence다.

## 평가셋과의 차이

| 구분 | 평가셋 | Random Probe |
|---|---|---|
| 목적 | 정답률 측정 | 분포 관찰 |
| 라벨 | `expectedCategory`, `expectedTier` 있음 | 없음 |
| 주요 지표 | accuracy, error rate | category/tier distribution |
| 실패 케이스 | 정답과 다르면 failure | failure 개념 없음 |
| 사용 시점 | 룰 변경 후 회귀 검증 | 룰이 임의 입력에서 어떻게 편향되는지 확인 |
