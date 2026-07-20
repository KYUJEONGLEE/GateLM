# 공개 Prompt 데이터셋 조사와 7,000개 구축 보고서

| 항목 | 값 |
|---|---|
| 기준일 | 2026-07-21 |
| 목표 | GateLM `Simple / Complex` 난이도 분류용 공개 Prompt 후보 7,000개 |
| 공개 subset | [`data/public-prompts-7000.jsonl`](data/public-prompts-7000.jsonl) |
| 통합 초기 데이터 | [`data/initial-routing-difficulty-15000.jsonl`](data/initial-routing-difficulty-15000.jsonl) |
| 상태 | 규칙 기반 후보 라벨, 사람 미검수, `training_eligible=false` |

공식 dataset card와 고정 revision을 기준으로 익명 접근, Prompt 측 필드 분리, 라이선스와 provenance를 확인했다. 이 문서는 법률 자문이 아니며 재배포·상업 이용 전에는 조직의 법무·데이터 owner가 각 조건을 다시 확인해야 한다.

## 1. 조사 결과

| 데이터셋 | 공식 출처 | 라이선스·접근 | Prompt 추출 | 판정 | 이유 |
|---|---|---|---|---|---|
| LMSYS Chat-1M | [dataset card](https://huggingface.co/datasets/lmsys/lmsys-chat-1m) | 별도 access agreement, 파생 데이터 재배포 제한 | user turn | 제외 | 실제 사용자 표현은 유용하지만 이 저장소에 Prompt를 재배포할 수 없음 |
| ShareGPT | canonical 배포본 없음 | 미러별 provenance·권리 불명확 | 미러별 상이 | 제외 | 원 메시지 단위 권리와 삭제 이력을 증명할 수 없음 |
| OpenAssistant OASST1 | [dataset card](https://huggingface.co/datasets/OpenAssistant/oasst1) | Apache-2.0, 익명 접근 | `role=prompter`, `text` | 1,329 채택 | 사람 작성 crowd prompt, moderation·PII label 제공 |
| UltraChat | [dataset card](https://huggingface.co/datasets/openbmb/UltraChat) | MIT, 익명 접근 | 첫 user turn | 제외 | 합성 prompt이며 새 사람 기원 source로 대체 |
| AI Hub | [이용정책](https://aihub.or.kr/intrcn/guid/usagepolicy.do?currMenu=151&topMenu=105) | 로그인·신청·과제별 조건 | 과제별 상이 | 제외 | 익명 취득과 단일 license 판정 불가 |
| KoAlpaca v1.1a | [dataset card](https://huggingface.co/datasets/beomi/KoAlpaca-v1.1a) | CC-BY-NC-4.0 | `instruction` | 제외 | 상업 이용 불가 |
| KoAlpaca-RealQA | [dataset card](https://huggingface.co/datasets/beomi/KoAlpaca-RealQA) | CC-BY-SA-4.0, `gated: auto` | `question` | 제외 | 실제 한국어 사용자 prompt이나 익명 재현 불가 |
| KLUE MRC | [dataset card](https://huggingface.co/datasets/klue/klue) | CC-BY-SA-4.0 | `question` | 745 채택 | 문맥 직렬화 없이 질문만 사용하고 길이 인접 쌍으로 라벨 결합 해소 |
| KITE | [dataset card](https://huggingface.co/datasets/junkim100/KITE) | Apache-2.0 | `instruction` | 328 채택 | 한국어 직접 작성 100개와 사람 검수 번역 instruction |
| Aya Dataset | [dataset card](https://huggingface.co/datasets/CohereLabs/aya_dataset) | Apache-2.0 | `inputs` | 367 채택 | 사람 annotation 기반 한국어·영어 instruction |
| Databricks Dolly 15k | [dataset card](https://huggingface.co/datasets/databricks/databricks-dolly-15k) | CC-BY-SA-3.0 | `instruction`, 선택적 `context` | 600 채택 | Databricks 직원 작성, 작업 category 제공 |
| KULLM-v2 Dolly subset | [dataset card](https://huggingface.co/datasets/nlpai-lab/kullm-v2) | 배포본 Apache-2.0; Dolly 계보는 보수적으로 CC-BY-SA-3.0 적용 | Dolly 행의 번역 `instruction`, `input` | 2,190 채택 | Dolly 사람 원문 계보를 유지한 한국어 번역; Vicuna·ShareGPT·GPT4All·Alpaca 행 제외 |
| HRM8K KSM | [dataset card](https://huggingface.co/datasets/HAERAE-HUB/HRM8K) | MIT | `question` | 1,199 채택 | 한국 수학 문제·사람 검수 번역; 수학 유형 상한 내 제한 |
| K2-Eval | [dataset card](https://huggingface.co/datasets/HAERAE-HUB/K2-Eval) | MIT | generation split `instruction` | 90 채택 | 90개 한국 문화 handwritten instruction |
| HAE-RAE BENCH 2.0 | [dataset card](https://huggingface.co/datasets/HAERAE-HUB/HAE_RAE_BENCH_2.0) | MIT | `question` | 152 채택 | 날짜·어휘·속담·산술 benchmark 보조; 사람 직접 작성 비율에는 미포함 |

WildChat sanitized는 실제 사용자 prompt 후보지만 ODC-BY가 개별 콘텐츠 권리까지 자동으로 보장하지 않는다. 별도 법무 승인이 없으므로 포함하지 않았다. No Robots는 비상업 license, CSAT-QA는 연구 전용 조건, HAE-RAE BENCH 1.1은 비상업·변경금지·gate라 제외했다.

## 2. 최종 source와 고정 revision

| source key | revision | 사용 개수 |
|---|---|---:|
| `klue_mrc` | `349481ec73fff722f88e0453ca05c77a447d967c` | 745 |
| `kite` | `b02c5cf191a1fd2691b7154875fef46e2aeedc95` | 328 |
| `aya_dataset` | `f9ea04583f02a8f86404ff6c58bf75fe637df8a2` | 367 |
| `k2_eval` | `14bbbc9ee6eef17368508735700465eedc9ec4c5` | 90 |
| `hrm8k_ksm` | `c360cabf8d733a82455565358b3dc965aab9ba8d` | 1,199 |
| `haerae_bench_2` | `87bf691006fbd6c3440238802fd8cb4e9bdbcffe` | 152 |
| `openassistant_oasst1` | `fdf72ae0827c1cda404aff25b6603abec9e3399b` | 1,329 |
| `databricks_dolly_15k` | `bdd27f4d94b9c1f951818a7da7fd7aeea5dbff1a` | 600 |
| `kullm_v2_dolly` | `cddcb73c259269928e974e0ce141f123eb068030` | 2,190 |
| 합계 |  | 7,000 |

가장 큰 source는 KULLM-v2 Dolly subset 2,190개로 공개 component의 31.3%다. 단일 source 40% 상한 2,800개를 넘지 않는다. KLUE는 기존 5,547개에서 745개로 줄었고 `context`는 전혀 직렬화하지 않아 KLUE 유래 `rag_query`가 0개다.

## 3. 사람 작성과 실제 사용자 구분

`사람 작성`, `사람 원문 기원 번역`, `실제 서비스 사용자`를 같은 수치로 합치지 않는다.

| provenance | 개수 | 공개 7,000 비율 | 판정 |
|---|---:|---:|---|
| 최종 Prompt를 직접 사람이 작성했다고 확인 가능 | 3,224 | 46.1% | 목표 60%보다 976개 부족 |
| 사람 원문 기원·사람 검수 번역까지 포함 | 6,848 | 97.8% | 참고 지표 |
| 익명 접근·재배포 가능한 실제 서비스 사용자 Prompt | 0 | 0% | KoAlpaca-RealQA gate와 WildChat 법무 미승인 때문에 미확보 |
| benchmark-derived 보조 | 152 | 2.2% | HAE-RAE BENCH 2.0 |

따라서 “사람 직접 작성 60%”는 충족했다고 주장하지 않는다. manifest에 `direct_human_authored_gap_records=976`, `direct_human_authored_60_percent_met=false`와 관련 training blocker를 기록했다. 실제 사용자 자료를 추가하려면 KoAlpaca-RealQA 접근·재배포 승인 또는 WildChat 개별 콘텐츠 이용에 대한 법무 승인이 먼저 필요하다.

## 4. 추출·정제·중복 제거

- assistant 응답, source answer, system/tool message와 source 사용자 식별자는 저장하지 않는다.
- Dolly와 KULLM의 context/input은 사용자 요청을 완성하는 경우에만 instruction 아래에 직렬화한다.
- KULLM은 `row_idx=52002..67012`의 Dolly 파생 구간만 사용하고 다른 혼합 source는 제외한다.
- 이메일, 전화번호, 주민번호, 결제카드, secret, Authorization, private key와 개인 연락·계좌 맥락을 차단한다.
- NFKC·소문자·문장부호·공백 normalized exact match 후 48-value MinHash LSH와 unigram/bigram Jaccard 0.90을 적용한다.
- 기존 합성·경계 8,000개와도 같은 중복 검사를 수행한다.
- Dolly 영어 원문과 KULLM 한국어 번역은 동일 semantic origin으로 추적하며 둘을 동시에 선택하지 않아 교차 언어 변형 누수를 피한다.

MinHash/Jaccard는 lexical proxy다. 승인 전 multilingual embedding 후보 검색과 사람 판정이 추가로 필요하다.

## 5. 최종 분포

### 언어와 라벨

| 언어 | Simple | Complex | 합계 |
|---|---:|---:|---:|
| 한국어 | 2,300 | 2,300 | 4,600 |
| 영어 | 1,025 | 1,025 | 2,050 |
| 한영 혼합 | 175 | 175 | 350 |
| 합계 | 3,500 | 3,500 | 7,000 |

합성·경계 8,000개는 한국어 7,400, 영어 200, 한영 혼합 400으로 재조정했다. 통합 15,000개는 한국어 12,000, 영어 2,250, 한영 혼합 750의 80:15:5를 정확히 유지한다.

### 통합 15,000개 작업 유형

모든 작업 유형은 최소 424개이며 최대 1,300개다. 즉 단일 작업이 전체의 8.67%를 넘지 않는다.

| 작업 유형 | 개수 | 작업 유형 | 개수 |
|---|---:|---|---:|
| general query | 1,300 | fact explanation | 1,300 |
| math problem | 1,300 | structured data processing | 1,035 |
| planning | 579 | summarization | 712 |
| document writing | 748 | comparison/evaluation | 694 |
| internal document query | 468 | JSON conversion | 451 |
| code generation | 826 | translation | 456 |
| data analysis | 495 | search | 487 |
| file processing | 515 | code explanation | 431 |
| debugging | 457 | code modification | 433 |
| code review | 428 | business report | 440 |
| multi-document comparison | 424 | RAG query | 428 |
| table conversion | 593 |  |  |

`fact_explanation`, `general_query`, `math_problem`은 현재 가드레일 상한인 1,300개에 도달했다. 이상적 900개 상한과 공개 상위 5개 유형 55% 목표는 현재 승인된 후보 pool로 동시에 충족하지 못했으므로 manifest blocker와 [`bias-audit.md`](bias-audit.md)에 남겼다.

### Split

| split | 공개 7,000 | 통합 15,000 |
|---|---:|---:|
| Train | 4,900 | 10,500 |
| Validation | 1,050 | 2,250 |
| Test | 1,050 | 2,250 |

모든 `group_id`는 하나의 split에만 존재한다.

## 6. 라벨과 사용 제한

공개 source에는 GateLM 난이도 gold label이 없다. 현재 record는 고정 규칙으로 양끝 후보를 선택했으며 모두 `label_source=public_rule_candidate`, `review_status=pending`, `human_reviewed=false`다.

통합 데이터는 다음 이유로 `training_eligible=false`다.

- 규칙 후보 라벨의 독립 LLM 재판정과 사람 adjudication 미완료
- 사람 직접 작성 공개 Prompt 60% 목표에서 976개 부족
- 작업 유형 400~900개, 도메인 최대 12.5%, 공개 상위 5개 유형 55%의 엄격 목표 미충족
- 익명 접근·재배포 가능한 실제 서비스 사용자 Prompt 0개
- embedding 기반 의미 중복 재검사 미완료

이 blocker를 해소하기 전에는 학습, threshold 선택, production runtime 승격의 근거로 사용하지 않는다.
