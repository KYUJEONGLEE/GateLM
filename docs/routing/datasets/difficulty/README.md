# GateLM 프롬프트 난이도 분류 데이터셋 구축 계획

| 항목 | 값 |
|---|---|
| 상태 | 버전 독립 routing 데이터 작업 영역; 후보 revision 보존 및 owner-approved 15,000개 학습 승격 완료 |
| 전체 초기 목표 | 15,000개 (`simple` 7,500 / `complex` 7,500) |
| 현재 생성 범위 | 공개 7,000 + 서비스 맞춤형 합성 6,000 + 경계 사례 2,000 |
| 공개 소스 조사 | [`public-source-review.md`](public-source-review.md) |
| 편향 감사 | [`bias-audit.md`](bias-audit.md) |
| 현재 학습 사용 가능 여부 | owner-approved revision만 가능 (`training_eligible=true`) |
| 진입점 | [`../../README.md`](../../README.md) |
| 기준일 | 2026-07-22 |

이 문서는 사용자 프롬프트를 `Simple` 또는 `Complex`로 분류하는 GateLM 난이도 모델의 데이터 구축·검수·분할·운영 개선 계획과 현재 생성된 15,000개 후보 데이터를 함께 관리한다. 이 영역은 제품 SemVer와 분리된 `docs/routing/` 아래에 있으며, 기존 `docs/v2.1.0` 평가 fixture를 수정하거나 새 데이터의 저장 위치로 사용하지 않는다.

초기·B/C·Codex·Reviewer E revision은 라벨 생성과 검수 이력을 재현하는 비승인 증거로 보존한다. Dataset owner는 2026-07-22 Reviewer E revision 15,000건을 전수 검수하고 현재 라벨을 승인했다. 별도 owner-approved revision의 모든 record는 `human_reviewed=true`, `review_status=approved`이며 pinned multilingual-E5 감사 후보 0쌍을 확인해 `training_eligible=true`다. 승인 근거는 [`reviews/human/dataset-owner-full-review-attestation.json`](reviews/human/dataset-owner-full-review-attestation.json)에 Prompt 없이 기록한다. 공개 Prompt 직접 사람 작성 비율과 실제 사용자 Prompt 부재, 일부 작업·도메인 라벨 비율은 알려진 한계로 남지만 dataset owner가 학습 사용 시 수용했다. 이 승격은 threshold 선택이나 runtime promotion 승인이 아니다.

## 1. 목표와 구축 전략

초기 목표는 국내 기업 업무 환경을 대표하는 15,000개 prompt로 클래스 균형이 잡힌 분류 데이터셋을 만드는 것이다.

```text
Prompt 또는 안전하게 마스킹된 User Message
→ 정제·중복 제거·언어/업무 유형 분류
→ 난이도 라벨링
→ Simple / Complex
→ 그룹 단위 Train / Validation / Test 분할
```

사람이 1만 개 이상의 prompt를 직접 작성하는 방식은 비용과 표현 다양성 측면에서 적절하지 않다. 권장 전략은 실제 사용자 표현을 제공하는 여러 공개 데이터와 GateLM 업무 분포를 채우는 합성·경계 데이터를 결합하는 것이다.

초기 15,000개 구성은 다음과 같다.

| 출처 | Simple | Complex | 합계 | 현재 상태 |
|---|---:|---:|---:|---|
| 공개 데이터 기반 | 3,500 | 3,500 | 7,000 | 생성 완료, 검수 대기 |
| 서비스 맞춤형 합성 | 3,000 | 3,000 | 6,000 | 생성 완료, 검수 대기 |
| 경계·반례 | 1,000 | 1,000 | 2,000 | 생성 완료, 검수 대기 |
| 합계 | 7,500 | 7,500 | 15,000 | 15,000 / 15,000 확보 |

공개 7,000개는 OASST1, Dolly, Aya, K2-Eval의 사람 작성 Prompt, KITE·HRM8K의 사람 원문 기원·검수 번역, KULLM-v2의 Dolly 파생 한국어 번역과 제한된 benchmark 보조를 조합한다. 실제 서비스 사용자 표현은 권리·접근 조건을 통과한 source가 없어 아직 0개이며 향후 별도 승인된 자료로 보강해야 한다.

## 2. 공개 데이터 후보와 채택 절차

공개 7,000개 단계의 라이선스·접근성·Prompt 추출성 조사와 최종 판정은 [`public-source-review.md`](public-source-review.md)에 고정한다.

| 후보 | 기대 입력 | 확인할 항목 | 현재 판정 |
|---|---|---|---|
| LMSYS Chat | 대화의 실제 user turn | 제3자 재배포 금지 | 제외 |
| ShareGPT | 공유 대화의 user message | 원본 단위 license·provenance 불명확 | 제외 |
| UltraChat | 합성 대화 user turn | MIT, user turn 분리 가능 | 제외 |
| OpenAssistant | `prompter` message | Apache-2.0, moderation field 제공 | 1,449개 채택 |
| AI Hub 한국어 데이터 | 한국어 지시·질의 후보 | 로그인·과제별 이용조건으로 익명 재현 불가 | 제외 |
| KoAlpaca | 한국어 instruction | v1.1a 비상업 조건, RealQA 승인형 접근 | 제외 |
| KLUE MRC | 한국어 질문 | CC-BY-SA-4.0, 질문 필드 분리 가능 | 142개 채택 |
| KITE | 한국어 instruction | Apache-2.0, instruction 분리 가능 | 154개 채택 |
| Aya Dataset | 사람 annotation `inputs` | Apache-2.0 | 387개 채택 |
| Dolly 15k | 직원 작성 instruction/context | CC-BY-SA-3.0 | 607개 채택 |
| KULLM-v2 Dolly subset | Dolly의 한국어 번역 instruction/input | Dolly 계보에 CC-BY-SA-3.0 보수 적용 | 3,100개 채택 |
| HRM8K KSM | 한국 수학 question | MIT | 979개 채택 |
| K2-Eval | handwritten instruction | MIT | 55개 채택 |
| HAE-RAE BENCH 2.0 | 한국어 benchmark question | MIT | 127개 채택 |

각 채택 source는 40자리 revision을 manifest에 고정했다. 모호한 license, provenance가 끊긴 미러, 익명 접근으로 재현할 수 없는 데이터는 제외했다. 제3자 고지와 파생 데이터 이용 조건은 [`THIRD_PARTY_DATASETS.md`](THIRD_PARTY_DATASETS.md)에 기록한다.

공개 데이터 처리 순서는 다음과 같다.

```text
공식 배포본 확보
→ license/provenance snapshot 고정
→ user role Prompt만 추출
→ system/assistant/tool message 제거
→ PII·기밀·secret 제거 또는 마스킹
→ 의미 없는 입력과 형식 오류 제거
→ exact/normalized/semantic dedup
→ 언어·작업 유형·도메인 분류
→ 난이도 자동 라벨링
→ 검수·group_id 부여
→ split 배치
```

최종 구성과 revision별 수량은 [`public-source-review.md`](public-source-review.md)에 기록한다. 가장 큰 source는 KULLM-v2 Dolly subset 3,100개로 공개 component의 44.3%이며 단일 source 45% 상한을 지킨다. exact·정규화 일치와 MinHash/Jaccard 제거 뒤 pinned multilingual-E5 384D cosine 전수 감사를 수행했다. 임계값 0.985에서 동일 라벨·작업·도메인의 교차 group 의미 중복 후보는 0쌍이다.

KLUE 142개는 `question`만 사용한다. 길이가 인접한 질문끼리 짝지은 뒤 쌍 안에서 의미 난이도를 상대 비교해 라벨 후보를 만들고, KLUE 길이 단독 ROC-AUC 0.55 이하를 검증한다. `context`를 직렬화하지 않으므로 KLUE가 만든 `rag_query`는 0개다. KLUE가 전체 공개분의 대부분이거나 길이·문맥 형식이 난이도 라벨을 직접 누설하던 구조를 제거했지만, 규칙 라벨을 gold 정답으로 만들지는 않으므로 사람 adjudication은 계속 필요하다.

## 3. 라벨링 방법과 승인 흐름

공개 데이터의 대부분에는 Simple/Complex 정답이 없으므로 사전에 고정된 기준과 출력 schema를 LLM에 함께 제공한다.

```text
다음 프롬프트를 사전에 정의한 7개 난이도 기준에 따라
Simple 또는 Complex 중 하나로 분류하라.
근거, 신뢰도, 경계 여부를 schema에 맞게 반환하라.
```

권장 라벨링 흐름은 다음과 같다. 현재 15,000개를 Gemini 리뷰어 A와 GPT 리뷰어 B에게 블라인드로 전달하는 실행 계약과 패키지 생성 방법은 [`independent-llm-review.md`](independent-llm-review.md)에 고정한다.

```text
1차 LLM 자동 라벨링
→ 규칙 기반 일관성 검사
→ 필요 시 독립 2차 모델 판정
→ 낮은 신뢰도·모델 불일치·경계 사례 선별
→ 사람 검수
→ adjudication
→ 최종 라벨 확정
```

사람 검수 대상은 다음과 같다.

- confidence가 초기 임계값보다 낮은 record
- Simple/Complex 경계가 애매한 record
- 라벨링 모델 간 판정이 다른 record
- 각 작업 유형·언어·도메인·source의 무작위 표본
- 코드, 긴 입력, JSON, 전문 용어 등 표면 특징으로 오분류될 가능성이 높은 record
- 최종 Test 후보와 2,000개 경계 사례

현재 합성 8,000개는 설계 규칙으로 `automatic_label`과 현재 `label`을 채웠지만 독립 LLM 판정이나 사람 검수 결과를 가장하지 않는다. 후속 라벨링에서 자동 라벨, 현재 라벨, confidence, 안전한 label reason, review 상태를 갱신하며 reviewer identity와 prompt fragment는 note에 저장하지 않는다.

## 4. 난이도 정의

### Simple

주로 다음 특성을 가지는 요청이다.

- 단일 작업
- 추론이 거의 필요하지 않음
- 간단한 변환 또는 정보 제공
- 짧거나 직접적인 응답으로 해결 가능
- 복잡한 문맥 통합이 필요하지 않음
- 외부 도구나 결과 검증이 필요하지 않음

### Complex

다음 특성 중 하나 이상을 강하게 가지는 요청이다.

- 여러 단계의 작업 수행
- 논리적 추론 또는 분석 필요
- 여러 조건을 동시에 만족해야 함
- 전문 지식 또는 긴 문맥 이해 필요
- 여러 자료를 통합해야 함
- 외부 도구, 검색, 파일 처리 등이 필요함
- 복수 산출물 또는 결과 검증 과정이 필요함

한 요소가 존재한다는 이유만으로 자동으로 Complex가 되지는 않는다. 아래 7개 기준을 종합한다.

### 4.1 추론 필요 수준

단순 조회·복사·변환인지, 원인 분석·비교·평가·의사결정인지, 여러 추론 단계를 거치는지를 본다.

### 4.2 작업 단계 수

단일 작업인지, 여러 작업인지, 이전 단계 결과를 다음 단계가 사용하는 의존적 순서가 있는지를 본다. 독립적인 기계 작업 여러 개는 단계 표현만으로 Complex가 되지 않는다.

### 4.3 요구 조건과 제약 수

출력 형식, 길이, 예외, 금지 조건, 대상 독자, 표현 방식과 여러 제약의 동시 충족 여부를 본다. 제약이 많아도 기계적 변환이면 Simple일 수 있다.

### 4.4 전문 지식 수준

일반 상식으로 해결 가능한지, 특정 전공·산업·기술 지식과 전문 판단이 필요한지를 본다. 전문 용어가 많다는 사실 자체는 Complex 근거가 아니다.

### 4.5 문맥 통합 필요성

짧은 입력 하나인지, 긴 문서를 이해해야 하는지, 여러 문서·대화·정보 조각을 통합해야 하는지를 본다. 입력이 길거나 첨부가 많다는 사실 자체는 Complex 근거가 아니다.

### 4.6 도구와 외부 자원 필요성

웹 검색, 최신 정보, RAG, 코드 실행, 파일·이미지 처리, 외부 API/DB와 여러 도구의 연속 사용을 본다. 도구 하나로 단순 사실을 찾는 요청은 Simple일 수 있으며 도구 수와 후속 해석 난이도를 함께 본다.

### 4.7 결과 검증 필요성

테스트, 검산, 사실 검증, 여러 결과 비교, 오류 분석, 수정 전후 검증과 조건 충족 확인이 필요한지를 본다.

## 5. 언어 구성과 다양성

초기 15,000개의 언어 목표는 고정된 80:15:5다.

| 언어 | 비율 | 전체 15,000 | 합성·경계 8,000 | 공개 7,000 |
|---|---:|---:|---:|---:|
| 한국어 | 80% | 12,000 | 7,800 | 4,200 |
| 영어 | 15% | 2,250 | 0 | 2,250 |
| 한영 혼합 | 5% | 750 | 200 | 550 |

통합 데이터는 각 언어 안에서도 Simple/Complex를 정확히 절반씩 둔다.

| 조합 | 개수 |
|---|---:|
| 한국어 Simple / Complex | 6,000 / 6,000 |
| 영어 Simple / Complex | 1,125 / 1,125 |
| 한영 혼합 Simple / Complex | 375 / 375 |

한국어는 일반 사내 업무, 요약, 규정 질의, 보고서, 인사·채용, 분석, 코드 등 전체 작업 유형에 배치한다. 한국어에도 코드 분석, 다단계 추론, 여러 문서 비교와 전문 판단을 충분히 포함한다.

영어는 기술 문서, 코드 주석·오류, API·framework·library, 이메일·보고서, 요약·번역, 해외 자료 검색·비교를 포함하되 기술·Complex에만 몰리지 않는다. 간단한 번역, 사실 요청과 짧은 형식 변환 등 영어 Simple을 동일하게 보존한다.

한영 혼합은 실제 업무 표현을 반영한다.

```text
이 API response를 JSON으로 정리해줘.
아래 Python 코드에서 race condition 원인을 분석해줘.
이 보고서를 executive summary로 요약해줘.
배포 전 security risk와 rollback plan을 검토해줘.
```

영어와 한영 혼합 표현 자체가 Complex 신호가 되지 않도록 모든 언어×라벨 조합을 유지한다. 영어·한영 혼합 record를 코드·전문 업무에만 배치하지 않는다.

언어 데이터는 단순 번역본으로만 만들지 않는다. 합성 record에는 한국어·영어·한영 혼합 업무 template을 유지하고, 공개 단계에는 한국어 원문 KLUE·KITE·Aya·K2, 영어 사람 작성 OASST1·Dolly·Aya, 사람 원문 기원 한국어 번역을 함께 둔다. 직접 사람 작성, 사람 원문 기원 번역과 benchmark-derived를 record metadata와 manifest에서 분리한다. 의미가 같은 번역·표현 변형은 동일 semantic origin으로 추적하고 동시에 선택하지 않거나 같은 `group_id`와 split에 둔다.

파일럿 이후 실제 요청 언어 분포를 분석해 재학습 비율을 조정할 수 있지만, 영어·한영 혼합 성능이 사라지지 않도록 최소 보존 세트를 유지한다.

## 6. 작업·구조·표현·도메인 다양성

### 6.1 작업 유형

현재 schema와 generator는 다음 23개 작업 유형을 갖는다. 각 유형에 Simple과 Complex가 모두 존재한다.

```text
일반 질의, 사실·개념 설명, 번역, 요약, 문서 작성,
코드 생성, 코드 설명, 코드 수정, 코드 리뷰, 디버깅,
데이터 분석, 수학 문제, 비교·평가, 계획 수립, 검색,
RAG 기반 질의, 표 변환, JSON 변환, 구조화 데이터 처리,
파일 처리, 여러 문서 비교, 업무 보고서 작성, 사내 문서 질의
```

예를 들어 간단한 정렬 함수 작성은 Simple이고, 비동기 시스템의 경쟁 조건을 분석해 재현·수정·테스트를 만드는 요청은 Complex다. 짧은 문단 요약은 Simple이고 여러 보고서의 주장·근거·위험 통합은 Complex다. 작업 유형을 라벨의 대리 변수로 사용하지 않는다.

### 6.2 길이와 구조

다음 조합을 의도적으로 포함한다.

- 짧은·중간·긴 Simple과 Complex
- 단일 명령과 다단계 명령
- 짧은 입력과 긴 문서 기반 입력
- 한 문장과 여러 문단
- 긴 배경 설명
- 단계가 명시된 요청
- 단계가 명시되지 않았지만 내부적으로 다단계인 요청

긴 문서를 그대로 번역·복사·표 변환하는 요청은 Simple 반례로, 짧은 증명·인과·선례 판단은 Complex 반례로 포함한다.

KLUE는 질문 단독 142개만 사용한다. 문맥+질문 직렬화와 KLUE 유래 RAG query를 제거했으며 길이가 인접한 질문 쌍 안에서 의미 난이도를 상대 판정한다. 통합 15,000개에서는 긴 Simple/Complex를 각각 860개 확보했고, 각 길이 bucket의 라벨 비중을 35~65%, 길이 단독 ROC-AUC를 0.60 이하로 검증한다. 23개 작업 유형은 424~900개, 23개 서비스 도메인은 363~1,609개이며 모든 유형·도메인의 라벨 비율이 35~65%다.

### 6.3 표현 방식

현재 generator는 정중체, 명령형, 질문형, 부탁형, 구어체, 반말, 축약형, 메신저체, 오탈자, 띄어쓰기 오류, 긴 설명형, 키워드 나열, 복합 명령형, 한영 혼합, 기술 용어, 불완전 문장의 16개 style을 순환 배치한다.

동일 의미에서 파생된 네 개 표현 변형은 같은 `group_id`를 사용한다. 조건 추가·제거로 라벨이 달라지는 경계 contrast도 동일 group 안에서 관리하므로 split 간 변형 누수를 막는다.

### 6.4 서비스 도메인

현재 데이터는 다음 23개 기업 도메인을 포함하며 각 도메인에 두 라벨이 모두 존재한다.

```text
일반 사내 업무, 인사·채용, 사내 규정·정책, 재무·회계, 영업,
마케팅, 고객 지원, 보안, 법무, 컴플라이언스, 개인정보 보호,
소프트웨어 개발, 데이터 분석, 프로젝트 관리, 제품 기획,
연구·조사, 경영 전략, 문서 관리, 회의록, 업무 보고,
교육·온보딩, RAG 기반 사내 문서 질의, 업무 형식 변환
```

창작 소설·시·퀴즈는 현재 8,000개 범위에 넣지 않았다. 공개 데이터 단계에서 유입되더라도 실제 업무 분포를 훼손하지 않는 제한된 비중만 허용한다.

## 7. 경계 사례와 규칙 특징 편향 방지

2,000개 경계 record는 표면 특징과 난이도 라벨의 잘못된 상관을 끊는 counterexample/counterfactual 데이터다. 다음 유형을 모두 포함한다.

- 코드가 있지만 Simple / 코드가 없지만 Complex
- 길지만 Simple / 짧지만 Complex
- 전문 용어가 많지만 Simple / 일상 표현이지만 Complex
- 조건은 많지만 기계적인 Simple / 조건은 적지만 깊은 Complex
- 긴 문서 단순 번역·복사·형식 변환
- 긴 문맥의 단일 추출 작업
- 여러 단계처럼 보이지만 독립적인 Simple
- 단계 표현 없이 내부적으로 다단계인 Complex
- JSON 출력 Simple / 출력 형식 없는 Complex
- 파일이 있지만 단순 추출 / 파일 없이 전문 분석
- 검색이 필요한 단순 사실 조회 / 검색 없는 복잡한 논리 판단
- 답변은 길지만 Simple / 답변은 짧아도 판단은 Complex

LightGBM 또는 다른 tabular head에서 고려할 수 있는 규칙 특징은 token·문자·문장·문단 수, 명령 동사·조건·금지 조건 수, 코드·파일·이미지 여부, 출력 형식·표·JSON 여부, 비교·다단계·도구·검색·검증 여부다.

검증 보고서는 각 특징별 `P(feature | simple)`과 `P(feature | complex)`, 언어·작업 유형을 통제한 교차표, label과 특징의 mutual information, 단일 특징 ablation을 확인해야 한다. 다음 규칙을 학습시키지 않는다.

```text
코드 포함 = 항상 Complex
긴 Prompt = 항상 Complex
JSON 요구 = 항상 Complex
전문 용어 = 항상 Complex
영어·한영 혼합 = Complex
```

## 8. 데이터 관리 schema

Canonical record schema는 [`schemas/difficulty-dataset-record.schema.json`](schemas/difficulty-dataset-record.schema.json)이다. JSONL 한 줄이 record 하나다.

| 필드 | 의미 |
|---|---|
| `schema_version` | 버전 독립 record 계약 식별자 |
| `dataset_version` | 날짜·목적 기반 dataset revision; 제품 SemVer 아님 |
| `sample_id` | prompt 내용·개인정보를 포함하지 않는 고유 ID |
| `redacted_prompt` | 합성 입력 또는 안전성 필터를 통과한 라이선스 공개 Prompt; 고객 raw prompt 금지 |
| `automatic_label` | 합성 설계 또는 자동 판정 단계의 라벨 |
| `label` | 현재 후보 라벨; pending 상태에서는 gold가 아님 |
| `expected_category` | 활성 routing의 5개 category vocabulary로 투영한 값 |
| `task_type` | 23개 작업 유형 |
| `service_domain` | 23개 업무 도메인 |
| `language` | `ko | en | mixed` |
| `source` | `synthetic | boundary | public` |
| `boundary_case` | 경계·반례 여부 |
| `counterexample_type` | 경계 유형; 일반 합성은 `null` |
| `label_source` | `synthetic_design | public_rule_candidate | llm_same_family_consensus_candidate | llm_codex_advisory_candidate | llm_gpt_risk_sensitive_candidate` |
| `label_confidence` | 검수 우선순위용 confidence; 학습 확률 target 아님 |
| `label_reason` | prompt fragment 없는 안전한 판정 근거 |
| `human_reviewed` | 사람 검수 완료 여부 |
| `review_status` | `pending | in_review | needs_adjudication | approved | rejected` |
| `group_id` | 번역·표현·길이·조건 변형과 contrast를 묶는 누수 방지 ID |
| `split` | `train | validation | test` |
| `expression_style` | 표현 방식 분석용 style |
| `prompt_structure` | 문장·문단·키워드 구조 |
| `length_bucket` | 실제 생성 문자열 길이 기반 bucket |
| `reasoning_level` | `low | medium | high` |
| `task_step_count` | 의도된 작업 단계 수 |
| `constraint_count` | 의도된 제약 수 |
| `has_code`, `has_file` | 입력의 표면 특징 |
| `tool_required` | 외부 도구 필요 여부 |
| `verification_required` | 결과 검증 필요 여부 |
| `source_dataset` 등 | 공개 record의 dataset, hash ID, license, URL, revision, prompt 성격과 변환 방식 |
| `source_authorship` | 직접 사람 작성, 사람 검수 번역, 사람 원문 기원 기계 번역, benchmark-derived 등 provenance 구분 |
| `source_human_origin` | 사람 원문에서 유래했는지 여부 |
| `source_direct_human_authored` | 최종 Prompt 표현을 직접 사람이 작성했다고 확인되는지 여부 |
| `source_real_user` | 실제 서비스 사용자의 Prompt인지 여부 |

`prompt`라는 필드명은 사용하지 않는다. GateLM 고객·운영 raw prompt 금지 경계를 지키기 위해 안전한 합성 입력과 라이선스·안전성 검사를 통과한 공개 Prompt만 `redacted_prompt`에 둔다. schema는 reviewer identity, 원본 source 사용자 ID, assistant 답변, raw model score, token, embedding, secret, provider error를 저장하지 않는다.

Manifest schema는 [`schemas/difficulty-dataset-manifest.schema.json`](schemas/difficulty-dataset-manifest.schema.json)이다. 총량, hash, 분포, coverage, dedup 방법, 검수 상태와 training blocker를 기록한다.

## 9. 정제와 품질 관리

공개·운영 데이터에는 다음 pipeline을 적용한다.

```text
원문 수집
→ 사용자 prompt 추출
→ 빈 값·의미 없는 값 제거
→ 지나치게 짧은 무의미 입력 분리
→ system/assistant response 제거
→ PII·기밀·API key·password·token 제거
→ exact dedup
→ 정규화 dedup
→ MinHash LSH와 token-shingle 유사도 기반 의미 중복 후보 탐색
→ 언어·task·domain 분류
→ 난이도 라벨링
→ 사람 검수
→ 최종 저장
```

단순 인사만 있는 입력, 응답이 섞인 입력, system prompt, 개인정보와 secret, 거의 같은 중복, 난이도를 판정할 수 없는 불완전 데이터, source 형식 오류는 제거하거나 quarantine한다. 실제 서비스가 단순 인사를 분류해야 한다면 제한된 Simple slice로 별도 관리한다.

현재 generator 검증기는 다음을 자동 차단한다.

- exact·NFKC/소문자/문장부호 정규화 중복
- 공개 후보의 48-value MinHash LSH + token unigram/bigram Jaccard 0.90 이상 근접 중복
- secret, Authorization, 이메일, 전화번호, 주민번호 형태
- system/assistant/developer role marker
- group의 split 누수
- 요구 분포와 coverage 불일치

lexical heuristic 뒤 pinned multilingual-E5 전수 감사를 수행한다. cosine 0.985 이상이면서 동일 라벨·작업·도메인인 교차 group 후보를 제거·보충하고, 감사 JSON의 데이터 SHA-256과 후보 0쌍을 빠른 verifier로 확인한다. 독립 LLM 난이도 재판정과 사람 adjudication은 의미 중복 검사와 별개의 승인 단계로 남는다.

## 10. Train / Validation / Test 분할

초기 목표 비율은 70:15:15다.

| 구분 | 전체 15,000 | 합성·경계 8,000 | 공개 7,000 |
|---|---:|---:|---:|
| Train | 10,500 | 5,600 | 4,900 |
| Validation | 2,250 | 1,200 | 1,050 |
| Test | 2,250 | 1,200 | 1,050 |

전체 split은 Simple/Complex 50:50을 유지하며 언어 총량은 80:15:5다. 정수 제약 때문에 Validation/Test의 영어·혼합 언어 수는 1건 차이가 날 수 있으며 source, task type, domain, boundary 비율은 manifest에서 확인한다.

표현 변형, 번역, 길이 변형, 조건 추가·제거, template 파생, 의미가 거의 같은 record는 `group_id` 단위로 배치한다. 합성·경계 8,000개는 1,752개 group, 공개 7,000개는 source record별 7,000개 group으로 구성되며 어느 group도 둘 이상의 split에 나타나지 않는다. Test는 최종 평가 전용이며 model 선택, feature 선택, threshold나 hyperparameter tuning에 사용하지 않는다.

공개 group에는 전체 15,000의 class·language 목표를 맞추는 공동 quota를 배정했고 기존 합성·경계 group의 split은 바꾸지 않았다.

## 11. 현재 생성 산출물과 재현 방법

| 경로 | 역할 |
|---|---|
| [`data/enterprise-synthetic-8000.jsonl`](data/enterprise-synthetic-8000.jsonl) | 8,000개 합성·경계 후보 record |
| [`data/enterprise-synthetic-8000.manifest.json`](data/enterprise-synthetic-8000.manifest.json) | hash, 분포, coverage, 검수·training 상태 |
| [`data/public-prompts-7000.jsonl`](data/public-prompts-7000.jsonl) | 9개 공개 source slice에서 정제한 7,000개 후보 record |
| [`data/public-prompts-7000.manifest.json`](data/public-prompts-7000.manifest.json) | source revision·license, 필터·중복 제거, 분포와 검수 상태 |
| [`data/initial-routing-difficulty-15000.jsonl`](data/initial-routing-difficulty-15000.jsonl) | 합성·경계·공개를 합친 초기 15,000개 bundle |
| [`data/initial-routing-difficulty-15000.manifest.json`](data/initial-routing-difficulty-15000.manifest.json) | 통합 hash, component hash와 전체 분포 |
| [`data/initial-routing-difficulty-15000.semantic-dedup.json`](data/initial-routing-difficulty-15000.semantic-dedup.json) | pinned E5 전수 감사, 보정·후보·cluster 증거(원문·embedding 비저장) |
| [`data/enterprise-synthetic-8000.reviewer-b-c-revised.jsonl`](data/enterprise-synthetic-8000.reviewer-b-c-revised.jsonl) | 라벨은 보존하고 B/C 사람 queue 19건의 검수 상태만 반영한 합성·경계 수정본 |
| [`data/enterprise-synthetic-8000.reviewer-b-c-revised.manifest.json`](data/enterprise-synthetic-8000.reviewer-b-c-revised.manifest.json) | 합성·경계 수정본 hash와 검수 blocker |
| [`data/public-prompts-7000.reviewer-b-c-revised.jsonl`](data/public-prompts-7000.reviewer-b-c-revised.jsonl) | B/C 동일 GPT 계열 합의로 3,215건의 현재 라벨을 교체한 공개 수정본 |
| [`data/public-prompts-7000.reviewer-b-c-revised.manifest.json`](data/public-prompts-7000.reviewer-b-c-revised.manifest.json) | 공개 수정본 hash, 라벨·검수 상태와 blocker |
| [`data/initial-routing-difficulty-15000.reviewer-b-c-revised.jsonl`](data/initial-routing-difficulty-15000.reviewer-b-c-revised.jsonl) | 현재 라벨 검토용 15,000건 통합 수정본; 원본은 리뷰 증거로 보존 |
| [`data/initial-routing-difficulty-15000.reviewer-b-c-revised.manifest.json`](data/initial-routing-difficulty-15000.reviewer-b-c-revised.manifest.json) | 통합 수정본 hash, 분포, 의미 중복 재검사와 training blocker |
| [`data/enterprise-synthetic-8000.codex-advisory-revised.jsonl`](data/enterprise-synthetic-8000.codex-advisory-revised.jsonl) | Codex advisory 대상 19건을 반영한 합성·경계 component |
| [`data/public-prompts-7000.codex-advisory-revised.jsonl`](data/public-prompts-7000.codex-advisory-revised.jsonl) | Codex advisory 대상 2,230건을 반영한 공개 component |
| [`data/initial-routing-difficulty-15000.codex-advisory-revised.jsonl`](data/initial-routing-difficulty-15000.codex-advisory-revised.jsonl) | Codex 7축 advisory 2,249건을 적용한 현재 검토용 통합 revision |
| [`data/initial-routing-difficulty-15000.codex-advisory-revised.manifest.json`](data/initial-routing-difficulty-15000.codex-advisory-revised.manifest.json) | Codex 수정본 hash, 분포, 검수·중복·training blocker |
| [`data/enterprise-synthetic-8000.reviewer-e-risk-revised.jsonl`](data/enterprise-synthetic-8000.reviewer-e-risk-revised.jsonl) | Reviewer E 대상 2,663건을 반영한 합성·경계 component |
| [`data/public-prompts-7000.reviewer-e-risk-revised.jsonl`](data/public-prompts-7000.reviewer-e-risk-revised.jsonl) | Reviewer E 대상 5,311건을 반영한 공개 component |
| [`data/initial-routing-difficulty-15000.reviewer-e-risk-revised.jsonl`](data/initial-routing-difficulty-15000.reviewer-e-risk-revised.jsonl) | Reviewer E 위험 회피형 7,974건을 적용한 현재 검토용 통합 revision |
| [`data/initial-routing-difficulty-15000.reviewer-e-risk-revised.manifest.json`](data/initial-routing-difficulty-15000.reviewer-e-risk-revised.manifest.json) | Reviewer E 수정본 hash, 분포, 검수·중복·training blocker |
| [`data/enterprise-synthetic-8000.owner-approved.jsonl`](data/enterprise-synthetic-8000.owner-approved.jsonl) | 전수 사람 승인된 합성·경계 8,000개 component |
| [`data/public-prompts-7000.owner-approved.jsonl`](data/public-prompts-7000.owner-approved.jsonl) | 전수 사람 승인된 공개 7,000개 component |
| [`data/initial-routing-difficulty-15000.owner-approved.jsonl`](data/initial-routing-difficulty-15000.owner-approved.jsonl) | 학습 가능한 owner-approved 15,000개 canonical revision |
| [`data/initial-routing-difficulty-15000.owner-approved.manifest.json`](data/initial-routing-difficulty-15000.owner-approved.manifest.json) | 사람 승인, 학습 eligibility, component·감사 hash와 accepted limitation |
| [`data/initial-routing-difficulty-15000.owner-approved.semantic-dedup.json`](data/initial-routing-difficulty-15000.owner-approved.semantic-dedup.json) | owner-approved revision의 pinned multilingual-E5 후보 0쌍 감사 |
| [`reviews/human/dataset-owner-full-review-attestation.json`](reviews/human/dataset-owner-full-review-attestation.json) | Prompt 없는 dataset-owner 전수 검수·학습 승인 선언 |
| [`schemas/difficulty-dataset-record.schema.json`](schemas/difficulty-dataset-record.schema.json) | 독립 record schema |
| [`schemas/difficulty-dataset-manifest.schema.json`](schemas/difficulty-dataset-manifest.schema.json) | manifest schema |
| [`../../../../scripts/routing_difficulty_model/dataset/generate-enterprise-synthetic-8000.mjs`](../../../../scripts/routing_difficulty_model/dataset/generate-enterprise-synthetic-8000.mjs) | seed 기반 결정론적 생성기 |
| [`../../../../scripts/routing_difficulty_model/dataset/verify-enterprise-synthetic-8000.mjs`](../../../../scripts/routing_difficulty_model/dataset/verify-enterprise-synthetic-8000.mjs) | 분포·보안·중복·schema 검증기 |
| [`../../../../scripts/routing_difficulty_model/dataset/tests/enterprise-synthetic-8000.test.mjs`](../../../../scripts/routing_difficulty_model/dataset/tests/enterprise-synthetic-8000.test.mjs) | 생성기·누수·민감정보 회귀 테스트 |
| [`../../../../scripts/routing_difficulty_model/dataset/acquire-public-prompt-sources.mjs`](../../../../scripts/routing_difficulty_model/dataset/acquire-public-prompt-sources.mjs) | revision·익명 접근을 검사하고 Prompt 측 필드만 `.tmp`에 수집 |
| [`../../../../scripts/routing_difficulty_model/dataset/generate-public-prompts-7000.mjs`](../../../../scripts/routing_difficulty_model/dataset/generate-public-prompts-7000.mjs) | 공개 7,000개와 통합 15,000개 결정론적 생성기 |
| [`../../../../scripts/routing_difficulty_model/dataset/verify-public-prompts-7000.mjs`](../../../../scripts/routing_difficulty_model/dataset/verify-public-prompts-7000.mjs) | 공개·통합 분포, hash, 중복, 누수 검증기 |
| [`../../../../scripts/routing_difficulty_model/dataset/semantic-dedup.py`](../../../../scripts/routing_difficulty_model/dataset/semantic-dedup.py) | pinned multilingual-E5 전수 감사와 remediation 생성기 |
| [`../../../../scripts/routing_difficulty_model/dataset/verify-semantic-dedup.mjs`](../../../../scripts/routing_difficulty_model/dataset/verify-semantic-dedup.mjs) | 감사의 데이터·모델 hash, 보정 정밀도, 후보 0쌍 빠른 검증기 |
| [`../../../../scripts/routing_difficulty_model/dataset/apply-reviewer-b-c-consensus-labels.mjs`](../../../../scripts/routing_difficulty_model/dataset/apply-reviewer-b-c-consensus-labels.mjs) | B/C 비교 증거에서 3,215건 라벨 수정본과 Prompt 없는 override 이력을 생성·검증 |
| [`../../../../scripts/routing_difficulty_model/dataset/apply-codex-advisory-labels.mjs`](../../../../scripts/routing_difficulty_model/dataset/apply-codex-advisory-labels.mjs) | 사람 queue 2,249건의 7축 Codex advisory 라벨을 별도 revision에 적용·검증 |
| [`../../../../scripts/routing_difficulty_model/dataset/apply-gpt-risk-sensitive-review-labels.mjs`](../../../../scripts/routing_difficulty_model/dataset/apply-gpt-risk-sensitive-review-labels.mjs) | Reviewer E 위험 회피형 7,974건을 별도 revision에 적용·검증 |
| [`../../../../scripts/routing_difficulty_model/dataset/promote-owner-approved-dataset.mjs`](../../../../scripts/routing_difficulty_model/dataset/promote-owner-approved-dataset.mjs) | 검수된 Reviewer E revision을 별도 owner-approved 학습 revision으로 결정론적 승격·검증 |

```powershell
corepack pnpm run routing:difficulty:generate-enterprise-8000
corepack pnpm run verify:routing-difficulty-enterprise-8000
corepack pnpm run routing:difficulty:acquire-public-sources
corepack pnpm run routing:difficulty:generate-public-7000
corepack pnpm run routing:difficulty:audit-semantic-dedup
corepack pnpm run verify:routing-difficulty-public-7000
corepack pnpm run verify:routing-difficulty-semantic-dedup
corepack pnpm run routing:difficulty:apply-reviewer-b-c-labels
corepack pnpm run verify:routing-difficulty-reviewer-b-c-labels
corepack pnpm run routing:difficulty:apply-codex-advisory-labels
corepack pnpm run verify:routing-difficulty-codex-advisory-labels
corepack pnpm run routing:difficulty:apply-gpt-risk-sensitive-review-labels
corepack pnpm run verify:routing-difficulty-gpt-risk-sensitive-review-labels
corepack pnpm run routing:difficulty:promote-owner-approved
corepack pnpm run verify:routing-difficulty-owner-approved
```

통합 manifest의 핵심 값은 다음과 같다.

```text
records      15,000
groups        8,752
simple        7,500
complex       7,500
ko           12,000
en            2,250
mixed           750
synthetic     6,000
boundary      2,000
public        7,000
train        10,500
validation    2,250
test          2,250
```

위 수치는 보존된 원본 후보의 50:50 분포다. Reviewer B/C 수정본은 요청된 3,215건을 모두 반영하여 `simple=9,729`, `complex=5,271`이며 더 이상 50:50이 아니다. 상세 적용·잔여 작업은 [`reviews/independent-llm/reviewer-c-gpt/reviewer-b-c-label-application-report.md`](reviews/independent-llm/reviewer-c-gpt/reviewer-b-c-label-application-report.md)에서 확인한다.

Codex advisory 수정본은 B/C 사람 queue 2,249건을 `simple=1,727`, `complex=522`로 다시 판정해 적용한 별도 revision이다. 전체 현재 라벨은 `simple=9,358`, `complex=5,642`다. 이는 사람 adjudication을 대체하지 않으며 상세 근거와 blocker는 [`reviews/independent-llm/reviewer-d-codex/codex-advisory-label-application-report.md`](reviews/independent-llm/reviewer-d-codex/codex-advisory-label-application-report.md)에 기록한다.

Reviewer E 위험 회피형 수정본은 표면 속성 결합 challenge slice 7,974건을 `simple=3,915`, `complex=4,059`로 판정해 적용한 최신 검토 revision이다. 전체 현재 라벨은 `simple=6,576`, `complex=8,424`다. 기존 queue와 E의 사람 요청 합집합 3,565건은 `needs_adjudication`을 유지한다. 상세 근거는 [`reviews/independent-llm/reviewer-e-gpt/reviewer-e-label-application-report.md`](reviews/independent-llm/reviewer-e-gpt/reviewer-e-label-application-report.md)에 기록한다.

Reviewer E revision의 embedding 후보는 누적 9쌍을 8개 원자적 의미 그룹으로 통합해 해소했다. Prompt·라벨·15,000개 및 전체 분포는 유지하고 split 7건만 일치 특성 record와 순환 재배치했다. pinned multilingual-E5 재감사 결과 후보 0쌍, group split leak 0건이다. Prompt 없는 결정 기록은 [`reviews/independent-llm/reviewer-e-gpt/reviewer-e-semantic-dedup-resolution.json`](reviews/independent-llm/reviewer-e-gpt/reviewer-e-semantic-dedup-resolution.json)에 둔다.

Dataset owner 전수 검수 승격본은 Reviewer E revision의 Prompt·라벨·group·split·label provenance를 그대로 보존한다. 15,000건 모두 `human_reviewed=true`, `review_status=approved`이며 Simple 6,576 / Complex 8,424다. owner-approved 파일 hash에 대한 pinned multilingual-E5 재감사도 후보 0쌍으로 통과해 manifest는 `training_eligible=true`, `training_blockers=[]`다. 알려진 데이터 구성 한계는 accepted limitation으로 남고 runtime promotion은 승인하지 않는다. 상세 근거는 [`reviews/human/dataset-owner-training-promotion-report.md`](reviews/human/dataset-owner-training-promotion-report.md)에 기록한다.

## 12. 프로젝트 규모별 권장 데이터

| 단계 | 권장 규모 | 의미 |
|---|---:|---|
| 발표·데모 | 5,000~10,000 | 구현 가능성과 기본 성능 확인 |
| 파일럿 | 10,000~20,000 | 제한된 환경에서 실제 요청 처리와 운영 데이터 수집 |
| 실제 운영 | 30,000~100,000+ | 여러 조직·도메인에서 지속 확장 |

개수만으로 서비스 가능 여부를 판단하지 않는다. task·domain·language·boundary slice와 False Simple 성능을 함께 평가한다.

## 13. 운영 데이터와 Active Learning

초기 데이터로 모델을 완성했다고 보지 않는다.

```text
초기 데이터 구축
→ 모델 학습
→ 파일럿 운영
→ 정책상 허용된 운영 사례 수집
→ 오분류·낮은 confidence 후보 선별
→ 라벨링·검수
→ dataset revision 갱신
→ 재학습
→ 기존 모델과 비교
→ 개선된 경우에만 단계 배포
→ 반복
```

운영 후보 metadata는 예측 라벨·확률, 실제 선택 경로, fallback, 재시도, 운영자 수정, 성공·실패, 지연, token·비용 집계, task와 신규 유형 여부다. 그러나 raw prompt 원문을 무조건 저장하지 않는다.

```text
PII·secret 탐지
→ 마스킹 또는 제거
→ 조직별 데이터 사용 정책과 consent 확인
→ 학습 허용 데이터만 격리 저장
```

Active Learning 우선 후보는 threshold 근처, 낮은 confidence, 모델 간 불일치, Simple 예측 후 고성능 fallback, 사용자 재시도, 운영자 수정, embedding OOD, 반복 오분류와 Complex→Simple 오류다. 자동 선별은 정답 확정이 아니며 신뢰 가능한 검수 절차를 거친다.

GateLM의 API·DB·log·metric·UI에는 raw prompt, raw response, raw fragment, secret을 남기지 않는 기존 보안 경계를 그대로 적용한다. 운영 학습 저장소가 필요하면 별도 계약과 조직별 승인을 먼저 마련한다.

## 14. 재학습과 dataset revision

초기 10,000~15,000개로 시작해 파일럿에서 신규 검수 데이터 2,000~5,000개가 쌓이면 15,000~20,000개로 재학습하고, 운영 반복을 통해 30,000개 이상으로 확장하는 것을 권장한다.

재학습에는 기존 대표 데이터, 최근 운영 데이터, 오분류, 낮은 confidence, 신규 task, 경계 사례와 이전 모델이 잘 처리하던 보존 데이터를 함께 넣는다. 최근 데이터만 학습해 과거 유형을 잊지 않도록 한다. 영어와 한영 혼합 비율이 실제 운영에서 낮더라도 최소 보존 세트를 유지한다.

Dataset revision에는 다음을 기록한다.

- record·group 개수와 hash
- class·source·task·language·domain·boundary 분포
- 추가·제거된 운영 데이터 수
- label 기준과 schema 변경 여부
- split policy와 seed
- 학습 model identity
- 전체·slice 평가 결과

`dataset_version`은 제품 release SemVer와 분리한다. schema 의미가 바뀌면 schema version을 올리고 migration/projection을 명시한다.

## 15. Champion–Challenger 검증과 배포

재학습 모델은 기존 Champion과 신규 Challenger로 관리한다.

평가 항목은 Accuracy, Macro F1, Simple/Complex Precision·Recall, PR-AUC, ROC-AUC, False Simple Rate, 경계 사례, task·language·domain별 성능, inference latency, model size, fallback 비율과 실제 routing 비용이다.

Complex를 Simple로 잘못 분류하는 False Simple은 고성능 model이 필요한 요청을 낮은 경로로 보낼 수 있으므로 별도 핵심 지표로 둔다. 신규 모델은 다음을 모두 만족할 때만 승격 후보가 된다.

- 전체 성능이 Champion보다 개선
- Complex Recall이 owner가 정한 기준 이상
- False Simple Rate가 허용 범위 이하
- 주요 task·language·domain에서 심각한 회귀 없음
- latency와 model size가 운영 기준 충족
- 품질 개선 또는 비용 절감 효과 확인

배포 순서는 다음과 같다.

```text
오프라인 평가
→ Shadow Test
→ 제한된 A/B Test
→ 전체 배포
```

정확한 threshold, 최소 Complex Recall, False Simple 허용치와 비용 함수는 이 데이터 생성 작업에서 임의로 확정하지 않는다. 별도 실험과 dataset owner·routing owner 승인으로 정한다.

## 16. 완료 기준과 다음 단계

현재 단계의 완료 기준은 다음과 같다.

- [x] 버전 독립 `docs/routing/datasets/difficulty/` 구조
- [x] 서비스 합성 6,000 + 경계 2,000
- [x] Simple/Complex 4,000/4,000
- [x] 합성·경계 한국어/영어/혼합 7,800/0/200과 통합 80:15:5
- [x] 모든 언어×라벨 조합
- [x] 23개 task와 23개 domain 각각 두 라벨
- [x] 21개 counterexample 유형
- [x] group 단위 70/15/15 split
- [x] exact·normalized·cross-group 근접 중복 검사
- [x] 생성 결정성과 manifest hash 검증
- [x] 공개 Prompt 7,000 license·provenance 조사와 수집
- [x] 공개 데이터 exact·normalized·고유사도 중복 제거와 PII·secret 패턴 정제
- [x] KLUE 800개 상한(현재 142개), 질문 필드만 사용, KLUE 문맥 직렬화·RAG query 0개
- [x] 긴 Simple/Complex 각 860개, bucket별 라벨 35~65%, 길이 단독 ROC-AUC 0.60 이하
- [x] 단일 공개 source 45% 이하와 통합 작업 유형별 400~900개
- [x] 공개 상위 5개 작업 유형 55% 이하와 도메인별 최대 12.5%
- [x] multilingual-E5 의미 중복 후보 0쌍 및 split 충돌 cluster 0개
- [x] 사람 원문 기원 공개 Prompt 6,873개(98.2%)
- [ ] 최종 Prompt 직접 사람 작성 4,200개(60%): 현재 2,674개, 1,526개 부족
- [ ] 익명 접근·재배포 가능한 실제 서비스 사용자 Prompt: 현재 0개
- [ ] 독립 LLM 자동 라벨링과 규칙 검사
- [x] 전체 15,000건 사람 검수와 dataset-owner 승인
- [x] 전체 15,000 통합 JSONL과 manifest 생성
- [x] owner-approved revision training eligibility 승인
- [ ] Champion–Challenger offline evaluation

다음 작업은 owner-approved revision으로 Champion–Challenger offline evaluation을 수행하는 것이다. 직접 사람 작성 Prompt 1,526개와 승인된 실제 사용자 Prompt 확보는 알려진 coverage 한계를 줄이기 위한 후속 개선 과제로 유지한다. 학습에는 owner-approved revision만 사용하고 이전 후보 revision을 섞지 않는다.

## 17. 라우팅 실험의 단일 데이터 입력

2026-07-22 이후 새 라우팅 학습·calibration·ablation·LightGBM 비교·tuning 실험은
`data/initial-routing-difficulty-15000.owner-approved.jsonl`과 대응 manifest만 사용한다.
8,000개와 7,000개 component 파일을 각각 입력하거나 `docs/v2.1.0`의 기존 500개,
2,000개, 5,000개 데이터셋을 새 실험 입력으로 사용할 수 없다.

canonical split은 `train 10,500 / validation 2,250 / test 2,250`이며 `group_id`를
보존한다. 기존 실험 vocabulary가 필요한 exporter에서만 `validation`을
`calibration`, `test`를 `holdout`으로 투영하며 row를 다시 추출하거나 재분할하지 않는다.
다른 `--dataset`, `--manifest` 또는 config 경로는 실행 전에 거부한다.

기존 Dataset 1·2와 model-path 5,000 결과물은 과거 결론의 재현 evidence로만 보존한다.
명령 이름에 `replay-historical`이 붙은 작업은 새 실험이나 새 학습 결과로 인정하지 않는다.
이 경계는 다음 명령으로 검증한다.

```powershell
corepack pnpm run verify:routing-experiment-dataset
```
