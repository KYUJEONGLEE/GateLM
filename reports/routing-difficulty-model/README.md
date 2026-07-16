# Routing Difficulty Model Reproducible Runs

이 디렉터리는 PCA, semantic head, Logistic Regression, calibration, threshold 실험의 로컬 재현 산출물을 run 단위로 분리한다. 생성된 run 디렉터리는 Git에 포함하지 않으며, 선택이 끝난 immutable artifact와 aggregate evidence만 기존 `scripts/routing_difficulty_model/artifacts/` 및 `docs/testing/` 경로로 승격한다.

## Create A Run

기본 timestamp run ID를 사용한다.

```powershell
corepack pnpm run v2.1:routing:new-difficulty-model-run
```

명시적인 run ID를 사용한다.

```powershell
corepack pnpm run v2.1:routing:new-difficulty-model-run -RunId pca64-baseline-01
```

생성 구조는 다음과 같다.

```text
reports/routing-difficulty-model/<run-id>/
  run-manifest.json
  pca-sweep.json
  semantic-head-report.json
  logistic-comparison.json
  calibration-report.json
  threshold-sweep.json
  console.log
```

실행 출력을 해당 run에 추가하려면 PowerShell에서 다음 형태를 사용한다.

```powershell
corepack pnpm run <experiment-command> *>&1 |
  Tee-Object -FilePath reports/routing-difficulty-model/<run-id>/console.log -Append
```

## Data Safety

이 디렉터리에는 aggregate 결과와 안전한 실행 metadata만 저장한다. Raw prompt, raw response, instruction text, token, embedding, assembled vector, semantic-head probability, sample별 calibrated score, secret 또는 provider raw error를 저장하지 않는다.
