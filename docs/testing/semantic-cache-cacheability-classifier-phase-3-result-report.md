# Semantic Cache Cacheability Classifier Phase 3 Result Report

## 완료한 작업

- FastText runtime integration 방식으로 HTTP sidecar adapter를 추가했다.
  - Gateway process는 `CacheabilityClassifier` interface 뒤에서 sidecar에 JSON classification request만 보낸다.
  - Gateway runtime request path에서 Python 학습/평가 스크립트는 실행하지 않는다.
  - Python FastText model loading과 prediction은 별도 sidecar process가 담당한다.
- env로 `stub`/`fasttext` 전환이 가능하도록 config를 확장했다.
  - `SEMANTIC_CACHE_CLASSIFIER_TYPE=stub`
  - `SEMANTIC_CACHE_CLASSIFIER_TYPE=fasttext`
  - `SEMANTIC_CACHE_CLASSIFIER_ENDPOINT=http://127.0.0.1:8765/classify`
- FastText sidecar adapter를 구현했다.
  - `POST` JSON request: `text`, `promptCategory`
  - JSON response contract: `label`, `confidence`, `reasonCode`, `modelVersion`
  - sidecar result는 기존 Phase 1A result contract validation을 그대로 통과해야 한다.
- timeout/error/invalid response fail-closed 처리를 보강했다.
  - context timeout은 `classifier_timeout`
  - sidecar request/server error는 `classifier_error`
  - malformed JSON 또는 invalid response contract는 `classifier_invalid`
  - 모든 classifier 실패는 Semantic Cache lookup/store/embedding만 skip하고 provider execution은 계속한다.
- FastText sidecar Python server script를 추가했다.
  - `scripts/semantic_cache_classifier/serve_fasttext_classifier.py`
  - `.bin` artifact를 startup 시 한 번 load하고 `/classify` endpoint로 prediction을 제공한다.
- demo 문장 pair 검증을 Go test로 추가했다.
  - static cacheable request는 semantic lookup/store 경로에 진입한다.
  - dynamic/user-specific request는 semantic lookup/store와 embedding 호출 전에 fail-closed skip된다.
- shadow/enforce 동작을 FastText sidecar adapter 경로에서 검증했다.
  - `mode=enforce`: 기존 semantic hit policy를 통과한 경우에만 cached response를 반환한다.
  - `mode=shadow`: hit candidate가 있어도 provider bypass가 발생하지 않는다.
- embedding 중복 호출 방지 최종 확인을 유지/보강했다.
  - lookup에서 만든 embedding vector를 request context/store 단계에서 재사용한다.
- classifier가 직접 hit을 결정하지 않도록 기존 구조를 유지했다.
  - classifier는 lookup/store 후보 gate만 판단한다.
  - 실제 hit은 기존 Semantic Cache mode, boundary, threshold, hit policy가 결정한다.
- Semantic Cache evidence는 normal API/UI surface에 노출하지 않는 기존 테스트를 유지했다.
- actual cacheHitRate 계산에는 shadow hit/candidate evidence를 섞지 않았다.
- Public API, DB schema, persisted Event schema, Dashboard Metrics contract는 변경하지 않았다.

## 변경한 주요 파일

- `.env.example`
- `apps/gateway-core/internal/domain/cache/cacheability_classifier.go`
- `apps/gateway-core/internal/domain/cache/cacheability_fasttext_classifier_test.go`
- `apps/gateway-core/internal/config/config.go`
- `apps/gateway-core/internal/config/semantic_cache_config_test.go`
- `apps/gateway-core/internal/app/router.go`
- `apps/gateway-core/internal/http/handlers/chat_completions_handler.go`
- `apps/gateway-core/internal/http/handlers/chat_completions_semantic_cache_test.go`
- `scripts/semantic_cache_classifier/README.md`
- `scripts/semantic_cache_classifier/serve_fasttext_classifier.py`
- `docs/testing/semantic-cache-cacheability-classifier-phase-3-result-report.md`

## 실행한 테스트

```powershell
python -m py_compile "scripts\semantic_cache_classifier\serve_fasttext_classifier.py"
python "scripts\semantic_cache_classifier\serve_fasttext_classifier.py" --help
python -c "import importlib.util; print('fasttext_installed=' + str(importlib.util.find_spec('fasttext') is not None))"
go test ./internal/domain/cache
go test ./internal/config
go test ./internal/http/handlers -run "SemanticCache|FastText|Classifier"
go test ./internal/app
go test ./...
git diff --check
corepack pnpm run verify:v2-docs
Select-String -Path <Phase 3 files> -Pattern '[ \t]+$'
corepack pnpm run verify:v2-final
```

## 테스트 결과

- `python -m py_compile ...`: 통과
- `serve_fasttext_classifier.py --help`: 통과
- `fasttext_installed=False`
  - 현재 Python 환경에는 `fasttext` package가 없어 실제 `.bin` model artifact load와 live sidecar process 구동은 실행하지 않았다.
  - Go runtime adapter와 Gateway path는 `httptest` sidecar로 검증했다.
- `go test ./internal/domain/cache`: 통과
- `go test ./internal/config`: 통과
- `go test ./internal/http/handlers -run "SemanticCache|FastText|Classifier"`: 통과
- `go test ./internal/app`: 통과
- `go test ./...` in `apps/gateway-core`: 통과
- `git diff --check`: 통과
- `corepack pnpm run verify:v2-docs`: 통과
  - Node engine warning 출력: expected `>=22 <23`, current `v24.14.0`
- Phase 3 파일 trailing whitespace 검사: 통과
- `corepack pnpm run verify:v2-final`: 실패
  - `@gatelm/control-plane-api` typecheck 실패: Prisma generated client에 `budgetLimitMode`, `budgetLimitUsd`, `budgetLimitPercent`, `totalBudgetUsd`, `Team`, `ProjectTeamAssignment` 등이 없는 상태에서 서비스 코드가 해당 필드를 참조한다.
  - `@gatelm/control-plane-api` tests 실패: 위 TypeScript compile error로 `applications.service.spec.ts`, `projects.service.spec.ts` suite가 실행 전 실패했다.
  - `@gatelm/web` typecheck 실패: `echarts/charts`, `echarts/components`, `echarts/core`, `echarts/renderers` module/type declaration을 찾지 못했다.
- `verify:v2-final` 내부 gateway-core Go tests는 통과했다.

## 후속 sidecar 검증 업데이트

- Python 3.12 venv에서 `fasttext-wheel`과 `numpy<2`를 사용해 실제 `.bin` artifact를 생성하고 sidecar load를 검증했다.
- `serve_fasttext_classifier.py`를 로컬에서 띄운 뒤 UTF-8 JSON request로 `/classify`를 호출했다.
  - `cacheable_static` synthetic 문장: `label=cacheable_static`, confidence 약 `0.976`
  - `dynamic_user_state` synthetic 문장: `label=dynamic_user_state`, confidence 약 `0.989`
- PowerShell inline literal로 한국어 JSON을 만들면 인코딩이 깨질 수 있어, manual 검증은 UTF-8 파일에서 문장을 읽거나 Python client에서 UTF-8 bytes로 보내는 방식이 안전하다.

## 실패하거나 보류한 항목

- 기본 Anaconda Python 3.13 환경에는 `fasttext` package가 설치되어 있지 않다. 실제 sidecar manual verification은 Python 3.12 venv에서 진행했다.
- `corepack pnpm run verify:v2-final`은 기존 workspace의 control-plane Prisma generated type 불일치와 web `echarts` dependency/type resolution 문제로 실패했다.
- Phase 3 범위에 없는 외부 LLM API classifier는 추가하지 않았다.
- Gateway runtime request path에서 `prepare_dataset.py`, `train_fasttext.py`, `evaluate_fasttext.py`를 호출하지 않았다.
- Semantic Cache evidence를 normal API/UI surface에 노출하지 않았다.
- Public API, DB schema, persisted Event schema, Dashboard Metrics contract는 변경하지 않았다.

## 다음 Phase/Sub-Phase에서 이어받아야 할 내용

- 실제 model artifact를 생성할 환경에서는 Phase 2 순서대로 dataset 준비, FastText 학습, 평가 threshold 확인 후 sidecar를 구동한다.
  - `prepare_dataset.py`
  - `train_fasttext.py`
  - `evaluate_fasttext.py --fail-on-threshold`
  - `serve_fasttext_classifier.py`
- 운영 또는 demo 환경에서 `SEMANTIC_CACHE_CLASSIFIER_TYPE=fasttext`를 사용할 때는 `SEMANTIC_CACHE_CLASSIFIER_ENDPOINT`를 반드시 설정해야 한다.
- production/default config는 계속 disabled/no-op 원칙을 유지한다.
- sidecar response contract는 `label`, `confidence`, `reasonCode`, `modelVersion`을 유지해야 하며, invalid response는 fail-closed 된다.
- `cacheable_policy`는 Phase 1B 원칙대로 기존 request context 또는 RuntimeSnapshot boundary에서 policy/version/hash 확인이 가능할 때만 store 후보가 될 수 있다.
