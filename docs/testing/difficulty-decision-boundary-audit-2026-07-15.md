# Difficulty Decision Boundary Audit — 2026-07-15

## Scope

- Code baseline: `940be8f36`
- Decision boundary: `difficulty-decision-boundary.semantic-empty-combined-8.2026-07-15.v2`
- Existing owner-approved records were not edited or deleted.
- Raw prompts are not copied into this report.

Audited immutable datasets:

| Dataset | Records | Dataset SHA-256 |
|---|---:|---|
| `difficulty_training_2026_07_15_owner_approved_500_v2` | 500 | `4f4b00a783ef6372a2d23baf77b0c793670a72f03f4636c6674c8e911662189f` |
| `difficulty_training_2026_07_15_expansion_2000_owner_approved_v1` | 2,000 | `9bd448240d3479072c5daf9517abd6ea7fc0797d204354d6d636a33111a0b9de` |

## Resolution 1: semantic-empty boundary

The previous Go boundary used only `payloadSizeBucket == empty` for the simple sentinel. One hundred payload-only records therefore reported `UsesDifficultyModelPath=true` even though the instruction-only semantic input was unavailable and the semantic exporter excluded them.

`DifficultyFeatures` now preserves whether semantic instruction input is empty. The canonical route checks that state before the hard sentinel or model path. The semantic exporter also validates that a record declared as `empty_instruction` is unavailable to the actual Go semantic-input extractor and uses the simple sentinel.

After the change:

- declared `empty_instruction`: 100
- actual Go simple sentinel: 100
- semantic-status/route mismatch: 0
- source split counts: train 1,500 / calibration 500 / holdout 500
- semantic-eligible split counts: train 1,430 / calibration 485 / holdout 485

## Resolution 2: hard-rule versus independent labels

The owner-approved difficulty labels remain the source of truth. Classifier output was not used to relabel records.

The previous hard rule was `commonEvidenceScore >= 3 OR categoryEvidenceScore >= 3`. It bypassed 832 records:

| Previous route result | Count |
|---|---:|
| expected complex | 703 |
| expected simple | 129 |

All 129 independent simple labels were preserved. The conflict was adjudicated as a deterministic-boundary false positive rather than a bulk label error. No sample-ID exception or allowlist was introduced.

Boundary candidates measured on the immutable 2,500 records were:

| Candidate | Hard records | Simple conflicts | Complex records | Precision |
|---|---:|---:|---:|---:|
| separate score `3+` OR | 832 | 129 | 703 | 0.8450 |
| separate score `4+` OR | 644 | 16 | 628 | 0.9752 |
| separate score `5+` OR | 280 | 2 | 278 | 0.9929 |
| combined score `7+` | 169 | 1 | 168 | 0.9941 |
| combined score `8+` | 43 | 0 | 43 | 1.0000 |

The canonical hard sentinel now requires `commonEvidenceScore + categoryEvidenceScore >= 8`. The result is deliberately conservative because a deterministic bypass must have higher precision than the learnable model path.

After the change:

| Route | Simple | Complex | Total |
|---|---:|---:|---:|
| simple sentinel | 100 | 0 | 100 |
| model path | 1,150 | 1,207 | 2,357 |
| hard sentinel | 0 | 43 | 43 |

Partition result:

| Partition | Simple sentinel | Model path | Hard sentinel |
|---|---:|---:|---:|
| train | 70 | 1,405 | 25 |
| calibration | 15 | 475 | 10 |
| legacy holdout | 15 | 477 | 8 |

## Training consequence

The active clean 5,000-record target excludes the legacy holdout and both sentinel paths. Reusing current train/calibration model-path records gives the revised generation requirement:

| Partition | Existing model path | New required | Final |
|---|---:|---:|---:|
| train | 1,405 | 1,595 | 3,000 |
| calibration | 475 | 525 | 1,000 |
| new evaluation holdout | 0 | 750 | 750 |
| new promotion holdout | 0 | 250 | 250 |
| total | 1,880 | 3,120 | 5,000 |

Existing single-request v3 model artifacts were trained with the historical model-path membership and are not retraining or promotion evidence for this boundary. Any retraining must use a new decision-boundary-aware training policy and artifact identity; existing artifact versions must not be overwritten.

### Pending 3,120-record expansion

The deterministic generator at `scripts/dev/generate-v2.1-difficulty-model-path-expansion-3120.mjs` now materializes the missing records as nine family-disjoint review batches under `docs/v2.1.0/reviews/difficulty-model-path-expansion-3120/`:

| role | batches | records | families |
| --- | --- | ---: | ---: |
| train | `t1`-`t4` | 1,595 | 319 |
| calibration | `c1`-`c2` | 525 | 105 |
| new evaluation | `e1`-`e2` | 750 | 150 |
| new promotion | `p1` | 250 | 50 |

All 3,120 records are synthetic review candidates with `reviewStatus=pending`, `reviewerCount=0`, and `trainingEligible=false`. The current Go decision audit verifies `modelPath=3,120`, `simpleSentinel=0`, `hardSentinel=0`, and semantic-route mismatches `0` against `difficulty-decision-boundary.semantic-empty-combined-8.2026-07-15.v2`. The deterministic quality verifier also reports exact duplicates `0`, family collisions `0`, strict cross-partition or existing-source near-duplicate leakage `0`, and security-pattern hits `0`.

Automated verification is not label review. The frozen review report still contains 305 broad near-duplicate candidates and 1,133 expected-to-current-rule category mismatches for owner inspection; neither is silently treated as an approved correction. Generation or verification does not authorize training, calibration, evaluation, artifact creation, or live shadow. Each family must be reviewed and explicitly owner-approved without moving records across the frozen roles.

## Runtime consequence

The checked-in v3 Go material carries the historical decision-boundary identity separately from its immutable inference hashes. Gateway compares that identity with the current boundary before creating the optional encoder. The pair remains incompatible and fails closed by default. After this audit, the routing owner approved one exact v3 baseline E2E exception in [`difficulty-live-shadow-baseline-e2e-waiver.json`](difficulty-live-shadow-baseline-e2e-waiver.json). Only the pinned waiver plus global enable and an exact development pair may bypass the compatibility rejection for non-authoritative shadow wiring; product routing remains rule-only. The supersession record remains authoritative for the historical approval by itself.

Optional-image verification checks the pinned tokenizer, QInt8 encoder, native runtime, Python/Go pooled-output parity, image contents, startup isolation, and an actual native request-shadow observation with rule decision/modelRef invariance under the exact waiver. Historical v3 Holdout replay remains intentionally skipped because replaying it through the new model-path membership would no longer be the approved exact pair.

## Verification

The safe audit command emits sample IDs, family/split metadata, labels, route reason codes and bounded evidence scores only. It does not emit prompt text:

```powershell
go run ./apps/gateway-core/cmd/difficulty-decision-audit `
  --dataset <owner-approved-jsonl> `
  --manifest <owner-approved-manifest>
```

The expansion semantic exporter now succeeds directly with 2,000 source records, 100 excluded semantic-empty sentinels, 1,900 semantic-eligible samples, 1,857 model-path samples and 43 hard sentinels.
