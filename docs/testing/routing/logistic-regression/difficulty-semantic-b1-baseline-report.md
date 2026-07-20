# GateLM Difficulty Semantic B1 Baseline Experiment Report

> [!CAUTION]
> 이 보고서는 안전한 집계값과 불변 provenance만 기록한다. Raw prompt/response, 정규화 문자열, token, embedding, feature vector, raw logit, 미보정 probability, per-sample score와 feature contribution은 포함하지 않는다.

## 1. 의사결정 요약

| 항목 | 값 |
|---|---|
| 실험 실행 ID | `20260719-semantic-b1` |
| 실행 시각 | `2026-07-19 / UTC` |
| 평가 commit | `43ff506d30c48de00e0a01b900df6074d0016a48` |
| 규칙 기준 (`B0`) | current deterministic rule difficulty |
| 동결 기준 (`B1`) | 42D Logistic Regression `C=10` + Isotonic + threshold `0.5` |
| Artifact version | `difficulty-logistic.semantic-b1.model-path-5000.2026-07-19.v1` |
| Artifact content hash | `sha256:6fdd46325175cb36189f33c2e590841165be13f081c44b982400da13f17d38a9` |
| Experiment baseline hash | `sha256:3051848158afc624898d5ee3e1549a2a0c1423335e1d4dc65c1b1fc9b600fe8e` |
| B1 baseline 동결 | **GO** |
| Authoritative runtime 승격 | **NO-GO** |

42D B1 artifact를 후속 Difficulty Semantic 실험의 기준 모델과 non-authoritative Gateway request shadow로 동결한다. Validation 전체에 refit한 Isotonic 기준 accuracy는 `85.3%`로 B0의 `74.0%`보다 높지만, 이 값은 calibrator in-sample 진단이며 promotion evidence가 아니다. 더 보수적인 grouped OOF Isotonic 진단은 `84.8%`다. B1의 전체 complex → simple 오류는 B0보다 1건 많고 translation에서는 9건에서 19건으로 증가했으며, promotion holdout과 runtime 성능 근거도 없으므로 authoritative routing 승격은 허용하지 않는다.

## 2. 범위와 사전 고정값

이번 run은 후보 탐색이 아니라 owner-fixed B1 reset이다.

| 항목 | 고정값 | B1 추론 사용 여부 |
|---|---|---|
| B1 입력 | `difficulty-feature-vector.v1`, 42D | 사용 |
| Projection | `raw pooled → PCA(6) → L2`, `P=6` | 미사용; 후속 semantic candidate 설정 |
| Semantic heads | 4개 multinomial LR, L2/lbfgs, `C=10` | 미사용; 후속 semantic candidate 설정 |
| Final LR | binary LR, L2/liblinear, `C=10` | 사용 |
| Calibration | exact-tie sample-count PAVA Isotonic | 사용 |
| Threshold | `0.5`, `score >= threshold → complex` | 사용 |

42D/106D/118D 후보 선택, LR C grid, Platt/Isotonic 선택과 threshold sweep은 수행하지 않았다. `P=6`과 semantic-head `C=10`은 B1 inference content hash에 넣지 않고 experiment baseline hash에 포함했다.

## 3. 동결된 출처와 hash

| 산출물 | 불변 값 |
|---|---|
| Dataset version | `difficulty_model_path_5000_2026_07_16_owner_approved_v1` |
| Dataset SHA-256 | `b29f2de446f540266572acd84b44ace5cf2084a3321a1f542d928abeadce45cf` |
| Dataset manifest SHA-256 | `a7c72b7af1a4be4d11f73e07a8b253658498a8fb28176f9ff5505c1acdcf5e8c` |
| Role manifest SHA-256 | `2066c1d46e6b2b6644bd100e53436c6b5ce3f12309eadb49cc174889a7b3afcd` |
| Training policy version | `difficulty-logistic-training.semantic-b1.2026-07-19.v1` |
| Training policy SHA-256 | `5e7ded120f2101a26badade9ab025391a858f8402785a9ef0c6aedfdb1f4fb0a` |
| Threshold policy | `difficulty-threshold.semantic-b1-fixed-0_5.2026-07-19.v1` |

Checked-in 근거는 [B1 artifact](../../scripts/routing_difficulty_model/artifacts/difficulty-logistic.semantic-b1.model-path-5000.v1.json), [fixed policy](../../scripts/routing_difficulty_model/training-policy.semantic-b1.v1.json), [trainer](../../scripts/routing_difficulty_model/gatelm_difficulty_model/semantic_b1.py)와 [policy guard test](../../scripts/routing_difficulty_model/tests/test_semantic_b1.py)다.

## 4. Split과 누출 감사

| 역할 | Records | Families | 사용 |
|---|---:|---:|---|
| Train | 3,000 | 490 | 42D LR fit |
| Calibration/Validation | 1,000 | 165 | Isotonic fit와 grouped OOF 진단 |
| Promotion holdout | N/A | N/A | outcome 미열람 |

- Train ↔ calibration family overlap: `0`
- Holdout outcome accessed: `false`
- Raw prompt/vector/per-sample score persisted: `false`
- Dataset 역할은 기존 frozen role manifest를 사용했다.

## 5. G0 — Parser와 sentinel 경계

Parser, 42D vectorizer, model-path eligibility와 sentinel boundary는 변경하지 않았다. Selection export의 current boundary를 그대로 재사용했으며 이 run에서 새로운 parser/sentinel ground-truth gate를 수행하지 않았다. 따라서 G0는 B1 baseline 재현에는 `PASS`, runtime promotion evidence에는 `N/A`다.

## 6. E1 — Projection

Projection은 `P=6`, `svd_solver=full`, `whiten=false`, post-projection L2로 고정했다. B1은 Candidate A 42D이므로 projection을 fit하거나 inference에 사용하지 않았다. Projection quality와 latency 결과는 후속 C1 run에서 별도로 측정해야 한다.

## 7. E2 — Semantic heads

네 semantic head는 L2/lbfgs `C=10`, `max_iter=2000`, seed `20260714`로 고정했다. B1 추론에는 head와 12D head probability가 없으며 이번 run에서 head를 학습하지 않았다.

## 8. E3 — Feature candidate

Owner directive에 따라 Candidate A, 즉 42D rule vector만 B1으로 선택했다. Candidate B/C와의 데이터 기반 우열 비교는 수행하지 않았으므로 이 run은 42D가 semantic candidate보다 우수하다고 주장하지 않는다.

## 9. E4 — Final Logistic Regression

| 설정 | 값 |
|---|---|
| Penalty / solver | `L2 / liblinear` |
| C | `10` |
| Fit intercept | `true` |
| Class weight | `None` |
| Max iterations / tolerance | `2000 / 1e-4` |
| Random seed | `1729` |
| 실제 iterations | `6` |
| 입력 차원 | `42` |

Fit은 수렴했고 coefficient, intercept와 generated Go material의 shape 검증을 통과했다.

## 10. E5 — Isotonic calibration

Calibration 1,000건을 family-grouped 5-fold로 나눠 OOF 진단을 만들고, artifact용 Isotonic은 calibration 전체에 다시 fit했다. Exact-equal raw probability를 sample-count로 묶은 PAVA, maximal constant block, inclusive-lower floor lookup과 endpoint clipping을 사용한다. 선형 보간과 small-block 자동 병합은 없다.

| 항목 | 결과 |
|---|---:|
| Full-fit block count | 15 |
| Full-fit minimum block support | 18 |
| OOF fold block counts | 17 / 14 / 16 / 15 / 13 |
| OOF fold minimum block support | 2 / 6 / 10 / 13 / 25 |
| OOF log loss | 0.473137902220 |
| OOF Brier score | 0.112671968846 |
| OOF ECE | 0.023956159249 |

Full-calibration fit의 log loss `0.329961895721`과 Brier `0.106068285274`는 같은 calibration data에 fit·평가한 진단값이므로 일반화 성능으로 사용하지 않는다.

## 11. E6 — Threshold

Threshold는 성능 최적화 없이 owner-fixed `0.5`를 사용했다. 판정은 inclusive하며 score가 정확히 `0.5`이면 `complex`다. Threshold sweep, 인접 후보 비교, bootstrap stability와 cost-ratio 최적화는 `N/A`다.

## 12. Validation 결과

### 12.1 전체

| 지표 | B0 rule | B1 full-fit Isotonic | B1 grouped-OOF 진단 |
|---|---:|---:|---:|
| Accuracy | 0.740 | 0.853 | 0.848 |
| Simple → complex | 165 / 501 (32.93%) | 51 / 501 (10.18%) | 51 / 501 (10.18%) |
| Complex → simple | 95 / 499 (19.04%) | 96 / 499 (19.24%) | 101 / 499 (20.24%) |

B1 full-fit accuracy의 B0 대비 대응 차이는 `+11.3%p`지만 calibrator in-sample 값이다. Candidate superiority용 family-bootstrap CI는 계산하지 않았고 C1도 없으므로 이 차이를 promotion 기준 통과로 해석하지 않는다.

### 12.2 Category별 complex → simple

| Category | Complex n | B0 | B1 full-fit | Safety `B1 <= B0` |
|---|---:|---:|---:|---|
| code | 91 | 17 (18.68%) | 13 (14.29%) | PASS |
| general | 143 | 38 (26.57%) | 36 (25.17%) | PASS |
| reasoning | 83 | 7 (8.43%) | 6 (7.23%) | PASS |
| summarization | 97 | 24 (24.74%) | 22 (22.68%) | PASS |
| translation | 85 | 9 (10.59%) | 19 (22.35%) | **FAIL** |
| overall | 499 | 95 (19.04%) | 96 (19.24%) | **FAIL** |

Translation under-routing가 10건 증가한 것이 가장 중요한 promotion blocker다.

## 13. Gateway artifact와 shadow 반영

Generated Go artifact는 [difficulty_model_b1_generated.go](../../apps/gateway-core/internal/domain/routing/difficulty_model_b1_generated.go)에 version, content hash, 42 weights, Isotonic 15 blocks와 threshold `0.5`를 고정한다. [difficulty_semantic_shadow.go](../../apps/gateway-core/internal/domain/routing/difficulty_semantic_shadow.go)의 B1 evaluator는 E5 encoder를 만들지 않고 model-path 요청의 42D vector만 평가한다.

기존 `GATEWAY_DIFFICULTY_E5_SHADOW_*` 이름은 배포 호환성 때문에 유지하지만 의미는 42D B1 shadow다. 기존 106D generated bundle은 별도 opt-in authoritative E5 hot runtime에만 남는다. Shadow와 authoritative runtime은 동시에 켤 수 없고, shadow 결과는 routing decision에 영향을 주지 않는다.

## 14. Runtime 검증

| 항목 | 결과 |
|---|---|
| Python fixed-policy unit test | PASS |
| Go artifact parser/codegen/domain/gateway targeted tests | PASS |
| B1 version/hash/calibrator/threshold pin | PASS |
| Shadow startup without E5 encoder | PASS |
| `score == 0.5` inclusive label | PASS |
| Python ↔ Go full score parity | 이번 run에서 별도 benchmark N/A |
| p50/p95/p99 latency | N/A |
| Throughput / peak RSS | N/A |
| Production failure rate | N/A |

기능·drift 검증 통과는 성능 예산 또는 production 안정성 통과를 뜻하지 않는다.

## 15. Promotion 판정

| Gate | 결과 | 판정 |
|---|---|---|
| B1 baseline artifact 재현·동결 | version/hash와 fixed policy 일치 | PASS |
| Gateway non-authoritative shadow 연결 | 42D only, E5 encoder 미생성 | PASS |
| 전체 complex → simple B0 비악화 | 95 → 96 | FAIL |
| Category별 complex → simple B0 비악화 | translation 9 → 19 | FAIL |
| Untouched promotion holdout | 미열람 | N/A |
| Runtime latency/RSS/throughput budget | 미측정 | N/A |

결론은 **B1 experiment baseline 및 request shadow 동결 GO / authoritative runtime promotion NO-GO**다.

## 16. 제한과 다음 조치

1. Offline retraining은 [semantic_b1.py](../../scripts/routing_difficulty_model/gatelm_difficulty_model/semantic_b1.py)로 재현할 수 있지만 Gateway가 runtime에서 지속 학습하거나 artifact를 자동 교체하지 않는다.
2. 후속 C1은 `P=6`, head `C=10`, final LR `C=10`, Isotonic과 threshold `0.5` 고정을 유지한 새 run으로 실행한다.
3. Promotion 검토 전에 translation complex slice 원인을 aggregate-safe 방식으로 감사하고, 새 untouched holdout과 runtime benchmark를 준비한다.
4. Holdout 결과를 확인한 뒤 feature, model, calibrator 또는 threshold를 바꾸면 새 run ID와 새로운 outcome-untouched holdout이 필요하다.
5. 이 B1 결과를 기존 106D artifact보다 우수하다는 증거로 사용하지 않는다. 두 artifact의 같은 frozen population paired 비교는 수행하지 않았다.

## 17. 완료 체크리스트

- [x] B1 입력 차원 42D 고정
- [x] Projection `P=6`과 semantic-head `C=10`을 experiment provenance에 고정
- [x] Final LR `C=10`, Isotonic, threshold `0.5` 고정
- [x] Artifact version/content hash와 experiment baseline hash 기록
- [x] Train/calibration family overlap `0` 확인
- [x] Promotion holdout 미열람 확인
- [x] Gateway shadow에서 E5/106D 평가 제거
- [x] Aggregate-only validation 결과 기록
- [ ] 전체 및 category under-routing safety gate 통과
- [ ] Untouched holdout 통과
- [ ] Runtime 성능 예산 통과

