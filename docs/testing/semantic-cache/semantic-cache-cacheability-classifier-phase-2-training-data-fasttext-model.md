# Semantic Cache Cacheability Classifier Phase 2: Training Data And FastText Model

이 문서는 Semantic Cache cacheability classifier gate 설계의 Phase 2 실행 범위를 정의한다.

전체 방향과 공통 제약은 [Semantic Cache Cacheability Classifier Gate Plan](semantic-cache-cacheability-classifier-gate-plan.md)을 따른다.

## Required Reading

작업 시작 전에 반드시 [Semantic Cache Cacheability Classifier Gate Plan](semantic-cache-cacheability-classifier-gate-plan.md)을 먼저 읽는다.

Phase 2 구현 전에 Phase 1A/1B 결과 보고서를 읽고, Phase 1A/1B의 실제 결과와 known gap을 반영해 계획을 조정한다.

```text
docs/testing/semantic-cache-cacheability-classifier-phase-1a-result-report.md
docs/testing/semantic-cache-cacheability-classifier-phase-1b-result-report.md
```

Phase 1A/1B 결과 보고서가 없으면 Phase 2 구현을 시작하지 않는다.

## Required Completion Report

Phase 2 완료 시 아래 결과 보고서 파일을 생성한다.

```text
docs/testing/semantic-cache-cacheability-classifier-phase-2-result-report.md
```

보고서는 완료한 작업, 변경한 주요 파일, 실행한 테스트, 테스트 결과, 실패하거나 보류한 항목, 다음 Phase/Sub-Phase에서 이어받아야 할 내용을 포함한다.

## Implementation Direction

- 학습 데이터 준비, 모델 학습, 평가 스크립트는 Python으로 작성한다.
- 권장 위치는 `scripts/semantic_cache_classifier/`다.
- 권장 스크립트는 `prepare_dataset.py`, `train_fasttext.py`, `evaluate_fasttext.py`다.
- FastText는 Python package 또는 CLI를 사용할 수 있지만, 스크립트에서 실행 방법을 일관되게 관리한다.
- Gateway runtime request path에서 Python 학습/평가 스크립트를 매 요청마다 실행하지 않는다.

## Scope

- synthetic dataset 위치와 format 확정
- train/test split 기준 정의
- positive/negative pair 작성
- Python 기반 FastText supervised classifier 학습 스크립트 추가
- Python 기반 FastText 평가 스크립트 추가
- model artifact 생성 방식 정의
- label별 precision/recall 또는 최소 acceptance 기준 정의
- modelVersion 관리 방식 정의

## Non-Scope

- Gateway live request path에 FastText를 강하게 연결하지 않는다.
- Gateway runtime request path에서 Python 학습/평가 스크립트를 호출하지 않는다.
- Public API/DB/Event/Metrics 계약을 변경하지 않는다.
- 외부 LLM API classifier를 기본 경로로 추가하지 않는다.

## Acceptance

- 학습데이터에 같은 키워드가 여러 label로 등장하는 positive/negative pair가 포함된다.
- 사용자별 상태/기록/계정/현재 값 요청은 cache 금지 label로 충분히 포함된다.
- 일반 정보성 질문과 정적 절차 안내는 cacheable label 후보로 포함된다.
- FastText 모델이 label과 confidence를 산출한다.
- Low confidence는 fail-closed 정책과 호환된다.

## Verification

- 학습 스크립트 dry run 또는 local run
- holdout test 결과 기록
- 모델 artifact와 dataset의 version 관계 확인
