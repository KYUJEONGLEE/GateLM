# Difficulty Semantic Encoder Provisional Selection

| Field | Value |
|---|---|
| Status | Provisional offline selection; not active and not production-ready |
| Feature proposal | `difficulty-feature-vector.v2` |
| Selected source model | `intfloat/multilingual-e5-small` |
| Immutable revision | `614241f622f53c4eeff9890bdc4f31cfecc418b3` |
| Runtime variant | ONNX Runtime dynamic QInt8, `MatMul` weights only |
| Projection | PCA full SVD, train-only fit, `384 -> 64`, post-projection L2 |
| Measured at | `2026-07-14T07:54:33Z` |
| Source commit | `9ae1d25922696aece2d191d8abff08e13026dfbc` with dirty-worktree state recorded |
| Product runtime changed | `false` |

This report records the reproducible local multilingual encoder choice for the proposed semantic difficulty feature path. It does not activate `difficulty-feature-vector.v2`, change the Gateway hot path, or approve a production artifact.

## Contract Boundary

The semantic proposal uses four ordered heads with three probabilities each, for exactly 12 semantic-head dimensions. The selected encoder projection dimension is provisionally `P = 64`, so the three offline candidate shapes are:

| Candidate | Total dimension |
|---|---:|
| Exact `ruleVectorV1` | `42` |
| `ruleVectorV1 + semanticProjection` | `42 + 64 = 106` |
| `ruleVectorV1 + semanticProjection + four semantic heads` | `42 + 64 + 12 = 118` |

This benchmark selects the encoder, quantization variant, pooling, truncation, and projection. It does not create or approve semantic-head weights, a final difficulty head, a calibrator, or a runtime bundle.

The semantic encoder receives only the process-local `PromptFeatures.instructionText` exported through the current Go extraction path. Empty semantic input is rejected before the tokenizer/encoder call. Payload text, raw prompts, embeddings, projected embeddings, feature vectors, head outputs, raw scores, and per-sample predictions are not written to the aggregate evidence.

## Reproducible Protocol

- Candidate revision and downloaded source artifacts are pinned by SHA-256.
- Download and artifact preparation are a separate phase. Benchmark workers deny socket connections and set Hugging Face offline mode.
- CPU execution uses ONNX Runtime `1.22.1`, batch size `1`, intra-op threads `4`, and inter-op threads `1`.
- Token length is capped at `128`: two declared special tokens plus deterministic token-ID head/tail truncation of `63 + 63` content tokens.
- Pooling is attention-mask-aware mean pooling, followed by train-only PCA and L2 normalization with epsilon `1e-12`.
- Projection candidates are native, `256`, `128`, and `64`. Selection minimizes calibration `complex -> simple`, stays within the accuracy tolerance, and then chooses the smallest dimension.
- QInt8 is selected only when its quality gate and at least one resource gate pass against FP32.
- Candidate selection uses train/calibration only. Holdout is evaluated once after the candidate and variant are fixed.

The full machine, dependency, affinity, split, and percentile settings are recorded in the checked-in JSON report.

## Calibration Selection Result

All rows use each candidate's selected runtime variant at `P = 64`. Latency is end-to-end tokenizer, encoder, pooling, projection, and L2 at batch size `1`.

| Candidate | Selected variant | Accuracy | `complex -> simple` | Minimum language accuracy | p50 (ms) | p95 (ms) | Peak RSS (MiB) | Runtime artifact (MiB) |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| paraphrase-multilingual-MiniLM-L12-v2 | FP32 | 0.95 | 4 | 0.90 | 26.1919 | 41.3810 | 1194.07 | 462.01 |
| multilingual-e5-small | dynamic QInt8 | 0.97 | 3 | 0.95 | 22.4323 | 40.0751 | 1128.72 | 409.02 |
| distiluse-base-multilingual-cased-v2 | dynamic QInt8 | 0.96 | 4 | 0.933333 | 20.8495 | 83.6043 | 873.79 | 396.98 |

MiniLM QInt8 was rejected because its accuracy dropped by `0.01` and its `complex -> simple` count increased by one. E5 QInt8 and DistilUSE QInt8 passed their quality and resource gates. E5 won the global candidate priority with the lowest calibration `complex -> simple` count, then the highest accuracy and minimum-language accuracy.

## Single Holdout Result

The selected E5 QInt8 `P = 64` candidate was evaluated once on 100 synthetic tooling-smoke holdout records.

| Metric | Selected candidate | Current rule baseline |
|---|---:|---:|
| Accuracy | 0.96 | 0.93 |
| `complex -> simple` count | 4/50 | 7/50 |
| Minimum language accuracy | 0.933333 | 0.80 |

The directional `complex -> simple` safety check passed. This is a plumbing and provisional-selection result only: the corpus has `trainingEligible=false` and zero approved human-reviewed families, so `promotionEligible=false` remains locked.

## Locked Evidence

| Artifact | SHA-256 |
|---|---|
| Benchmark report | `a0d35f812125bf0fb415912a603b89c73eddb31595600813d498b0848099f995` |
| Provisional lock bundle | `de3e1791be0598077eb1366e1f68cd0517560cbfbbacc85e54de5418ad8d091a` |
| Projection binary | `760e8d5eabae2ba5e049ae676ccdbe69ebaf9247c05b132af646f36ec8295845` |
| Selected QInt8 encoder | `a374ca7b87cdafc3c2a4b8b3c7db4a6500803ced02c750351d5fa80f60e94a94` |
| Canonical runtime artifact set | `ee60614d1a0bcf137059351eade1e4dc47b18aa8804cc149f0831ef61e7d0036` |

- [Aggregate benchmark JSON](../../scripts/routing_difficulty_model/evidence/difficulty-semantic-encoder-benchmark.windows-2026-07-14.json)
- [Provisional selected-encoder lock](../../scripts/routing_difficulty_model/evidence/selected-encoder.provisional-v1.lock.json)
- [Projection binary](../../scripts/routing_difficulty_model/evidence/difficulty-projection.provisional-v1.bin)
- [Candidate and protocol lock](../../scripts/routing_difficulty_model/encoder-candidates.v1.json)
- [Exact Python dependency lock](../../scripts/routing_difficulty_model/encoder-benchmark-requirements.lock.txt)

## Reproduction

The setup and prepare phases may install dependencies and download pinned artifacts. The benchmark run itself is network-disabled.

```powershell
corepack pnpm run v2.1:routing:setup-semantic-encoder
corepack pnpm run v2.1:routing:prepare-semantic-encoder
corepack pnpm run v2.1:routing:benchmark-semantic-encoder
corepack pnpm run verify:v2.1-semantic-encoder
```

## Required Before Gateway Integration

1. Approve minimum human-reviewed family coverage and create a training-eligible family-disjoint dataset.
2. Repeat candidate selection and untouched holdout evaluation on that approved dataset.
3. Approve and version the four-head/12D semantic-head artifacts, the final decision head, calibrator, and compatible bundle.
4. Approve a separate active routing contract change and Gateway runtime implementation review.
5. Repeat platform CPU compatibility and supply-chain review for intended deployment targets.

