# Routing difficulty 데이터 편향 감사

기준일은 2026-07-21이며 대상은 `initial-routing-difficulty-15000.jsonl`이다. 이 문서는 재균형 구현의 기준과 현재 남은 한계를 기록한다. 데이터는 여전히 사람 검수 전 후보이며 `training_eligible=false`다.

## 결론

- 공개 후보의 `difficultyScore()`에서 문자 수, 문장 수, 코드 길이, 문서 길이를 직접 가산하던 규칙을 제거했다.
- 길이 bucket 기준을 모든 생성기에서 `short < 160`, `medium < 800`, `long >= 800` 문자로 통일했다.
- 긴 Simple 860개와 긴 Complex 860개를 확보했다. 종전 긴 Prompt 858개 중 Complex 838개(97.7%)였던 결합은 제거됐다.
- 길이 bucket마다 두 라벨 비중을 35~65% 안에 두고, 문자 길이 하나만 사용한 ROC-AUC를 0.60 이하로 검증한다.
- 현재 전체 길이 분포는 short `Simple 4,087 / Complex 2,791`, medium `Simple 2,553 / Complex 3,849`, long `Simple 860 / Complex 860`이며 길이 단독 ROC-AUC는 약 `0.5676`이다.
- KLUE는 질문 필드 745개만 사용하고 context 직렬화와 KLUE 유래 `rag_query`는 0개로 유지한다. 길이가 인접한 질문끼리 짝지은 뒤 의미 난이도를 상대 비교해 라벨 후보를 만들며, KLUE 길이 단독 ROC-AUC는 약 `0.5075`다.
- 23개 작업 유형은 각각 424~1,300개, 23개 서비스 도메인은 각각 356~3,000개다. 최대 작업 유형 비중은 8.67%, 최대 도메인 비중은 20.0%다.

## 자동 라벨 규칙 감사

이전 공개 후보 점수는 긴 입력 자체에 점수를 더했다. 그 결과 내용상 단순한 장문 변환도 Complex 쪽으로 이동할 수 있었다. 현재 점수는 분석·비교·검증, 의존 단계, 충돌 처리, 복수 자료 통합처럼 작업 복잡도를 나타내는 신호만 사용한다. 문자 수, 문장 수, 단락 수, 코드 존재, 문서 존재는 점수에 직접 포함하지 않는다.

테스트는 같은 요청에 의미 없는 중립 문자열을 길게 덧붙여도 `difficultyScore()`가 변하지 않는지 확인한다. 최종 bundle 검증은 별도로 길이-라벨 교차표, long 최소 1,500개, 길이 단독 ROC-AUC 상한을 검사한다.

## 재균형 방법

합성 8,000개에는 각 라벨 800개씩 장문 counterexample을 넣었다. 긴 Simple은 긴 입력에서 한 가지 직접 변환·추출만 요구하고, 긴 Complex는 같은 길이대에서 여러 근거의 비교·의존 단계·검증을 요구한다.

공개 7,000개는 source별 고정 quota 순차 추출 대신 언어×라벨×길이 cell을 round-robin으로 선택한다. 선택 중 전체 15,000개 기준 작업 유형, 도메인, source, label별 상한을 동시에 적용한다. KLUE는 최대 800개, 단일 공개 source는 최대 2,800개다.

## 엄격 목표와 현재 한계

요청한 이상적 목표인 작업 유형별 400~900개, 공개 상위 5개 유형 55% 이하, 도메인별 최대 12.5%는 현재 승인된 공개 후보 pool만으로 동시에 충족하지 못했다. 현재 공개 상위 5개 유형은 4,891개(69.9%)다. 전체에서는 `fact_explanation`, `general_query`, `math_problem`이 각각 1,300개이고 `corporate_operations`가 3,000개다.

이를 숫자만 맞추려고 다른 의미의 task/domain으로 재분류하거나 같은 template을 대량 복제하지 않았다. 생성기는 현재 달성 가능한 가드레일인 작업 유형 400~1,300개, 도메인 300~3,000개, 공개 상위 5개 72% 이하를 강제한다. 엄격 목표 미달은 manifest의 training blocker와 coverage에 명시한다.

공개 7,000개 중 사람 원문 기원은 6,848개이고, 최종 Prompt가 직접 사람 작성임을 확인할 수 있는 데이터는 3,224개(46.1%)다. 직접 사람 작성 60% 목표까지 976개 부족하다. 이는 승인된 한국어 업무 Prompt source를 추가하지 않고는 해소하기 어렵다.

MinHash/Jaccard 기반 의미 중복 후보 제거는 수행했지만 multilingual embedding 기반 군집 검토와 사람 판정은 아직 남아 있다. 따라서 현재 데이터는 학습용 gold로 간주하지 않는다.

## 재현·검증

```powershell
corepack pnpm run routing:difficulty:generate-enterprise-8000
corepack pnpm run routing:difficulty:generate-public-7000
corepack pnpm run verify:routing-difficulty-enterprise-8000
corepack pnpm run verify:routing-difficulty-public-7000
```

세부 수치는 생성된 두 manifest의 `distributions`, `coverage`, `filtering.selection_rejected_candidates`를 기준으로 한다.
