# Tenant Chat PII ONNX Model Integration Evidence — 2026-07-15

## 1. Status and decision

| Item | Value |
|---|---|
| Branch | `feat/tenant-chat-pii-model-integration` |
| Baseline | local `dev` at `0c637455` |
| Runtime | local CPU-only ONNX sidecar |
| Product path | Tenant Chat private completion safety stage |
| Integration status | implemented and locally verified |
| Promotion status | **not production-grade evidence** |

This change connects the existing local rule engine and the two supplied ONNX artifacts to Tenant Chat. It proves that the artifacts load, that Tenant Chat can call the sidecar before Provider execution, and that `allow|redact|block` policy overrides reach the sidecar. It does not prove acceptable detector accuracy or production capacity.

## 2. Supplied artifacts

The delivery archive is kept at the Git-ignored runtime path `apps/ai-service/.cache/bundles/tenant-chat-pii-model-bundle-20260715.zip`. Runtime artifacts are imported into the Git-ignored, versioned `.cache/onnx/releases/tenant-chat-pii-models-20260715` directory only after the separately pinned outer archive, embedded manifest, and manifest allowlist all verify; the archive is not blindly expanded into the repository.

| Model | Revision | Runtime form | License |
|---|---|---|---|
| `openai/privacy-filter` | `7ffa9a043d54d1be65afb281eddf0ffbe629385b` | ONNX model plus external tensor data | Apache-2.0 |
| `amoeba04/koelectra-small-v3-privacy-ner` | `9f4e2fd9e35b12bcdb5fc334ac31be4399cb4281` | Optimum ONNX export, dynamic QInt8 | Apache-2.0 |

- Imported model bytes: `1,661,718,450` bytes.
- Manifest-listed files: 12; all size and SHA-256 checks passed.
- GateLM fine-tuning: none. Public checkpoints are used as supplied.
- Versioned evidence: `pii-model-manifest-20260715.json`, `pii-model-evaluation-summary-20260715.json`, `THIRD_PARTY_NOTICES.md`, and the Apache-2.0 text.
- Runtime model files and the local `.venv` remain ignored by Git.

## 3. Runtime flow

```text
Tenant Chat completion messages
-> Tenant safety evaluator, preserving message order and one shared entity scope
-> local P0 rules for every message
-> immediate all-local result when a mandatory/local rule blocks
-> one ordered batch HTTP request to the local ai-service sidecar for remaining text
-> cheap rule scan and ML candidate gate
-> bounded OpenAI ONNX micro-batches, then safe-limit KoELECTRA calls when ML is needed
-> Tenant RuntimeSnapshot detector action override
-> enforce: model result can redact/block
-> shadow: observation only; Provider prompt/action remain local-rule result
-> redacted input only continues to cache/routing/Provider
```

The Gateway first applies local rules and sends that Provider-safe result transiently to a process inside the trusted local runtime boundary. This preserves cross-message local entity placeholders and reduces raw sensitive text reaching the sidecar. The sidecar returns separate Provider-safe and log-safe prompts, does not return raw spans or detected values, and the smoke runner emits aggregate/sanitized evidence only. Sidecar timeout, invalid response, or server failure falls back to the local P0 rule result.

The current Tenant evaluator sends at most one ordered sidecar HTTP request for up to 64 messages. It keeps one shared entity scope so repeated values receive stable placeholders, and restores results by `itemIndex`. Older/non-batch masking engines retain the per-message compatibility path. A timeout, invalid/partial response, local block, policy mismatch, or over-limit request returns the complete local-rule result for every message; the Gateway never mixes a partial remote result into the request.

## 4. Model contribution boundary

The pinned label maps accept these model outputs:

- OpenAI ONNX: account number, email, phone, postal address, private date, private URL, secret.
- KoELECTRA ONNX: email, phone, resident registration number.

`person_name` and `organization_name` are deliberately absent from both model label maps in this bundle integration. Current Korean-name and organization results are `local_rule` backstop results. A successful name/company smoke case is therefore not evidence that either model detected it.

## 5. Supplied quality evidence

The supplied evaluation is case-level detector-type presence over a 1,000-case synthetic corpus. It is not span-level, model-only, or an untouched promotion holdout.

| Metric | Supplied result |
|---|---:|
| Overall pass rate | 65.6% |
| False-positive cases | 211 |
| False-negative cases | 180 |
| Email precision | 12.83% |
| Email recall | 100% |
| Person-name F1 | 0.40, rule backstop |
| Organization-name F1 | 0.4516, rule backstop |

The high email recall does not compensate for the 12.83% precision. This evidence is inadequate for a production accuracy claim and could cause substantial false redaction.

## 6. Local CPU measurements

Environment:

- Windows 11 / WSL2 host
- Intel Core Ultra 5 226V, 8 logical CPUs exposed to WSL
- CPython 3.12.10
- ONNX Runtime 1.27.0
- `intra_op=4`, `inter_op=1`, spinning disabled
- adapters executed sequentially

Three same-day exploratory process runs showed material variability. They are individual observations, not repeated-cold percentile evidence. The table shows the earliest and final-code runs; the intermediate run observed `23,359.76 ms` startup warmup and warm combined p50/p95 `212.86/274.15 ms`.

| Measurement | Earlier run | Final-code run |
|---|---:|---:|
| Startup warmup | 8,533.77 ms | 19,180.01 ms |
| RSS delta after both models loaded | 673.12 MiB | 673.04 MiB |
| Warm combined p50, 20 iterations | 141.28 ms | 205.37 ms |
| Warm combined p95, 20 iterations | 152.90 ms | 228.88 ms |
| Warm combined max | 224.22 ms | 1,097.99 ms |
| OpenAI adapter p50 / p95 | 128.25 / 138.18 ms | 169.44 / 187.78 ms |
| KoELECTRA adapter p50 / p95 | 7.48 / 12.63 ms | 13.19 / 17.71 ms |

One earlier live HTTP sidecar run measured server p50/p95 `138/171 ms` and client p50/p95 `152.41/191.62 ms` over 20 requests. Because the later direct runs were slower and the final run contained a 1.10-second outlier, none of these runs is a production latency guarantee. The configured `750 ms` Gateway timeout is a fallback boundary, not a latency target.

## 7. Operational behavior

- `AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED=true` loads both models before `/readyz` becomes healthy, avoiding first-user cold inference.
- `python -m app.main` passes the already-created FastAPI app to Uvicorn, preventing a second import and duplicate model load.
- `GATEWAY_AI_SAFETY_SIDECAR_MODE=enforce` is explicit in self-host configuration. In `shadow`, model results cannot alter the Provider prompt or final action.
- Tenant detector policy overrides are forwarded as sanitized detector type/action pairs and take final precedence over sidecar context heuristics.
- Model adapters execute sequentially because concurrent execution was not faster on the measured CPU. The later batch path uses a bounded per-adapter micro-batch size instead of parallel adapter execution.
- Access logging is disabled by default; raw prompts, raw detected values, and raw spans are not persisted by this integration.

## 8. Verification results

| Check | Result |
|---|---|
| AI Service unit/API suite | 171 tests passed |
| Gateway Core full Go suite | all packages passed |
| Actual ONNX synthetic smoke | both models loaded; sanitized cases passed |
| Model artifact re-verification | 12/12 already present and SHA-256 matched |
| Documentation verifier | `verify:v2-docs` passed |
| Root and self-host Compose static config | passed |
| `git diff --check` | passed |

## 9. Reproduction

```bash
python scripts/tenant_chat_pii_models/import_bundle.py \
  apps/ai-service/.cache/bundles/tenant-chat-pii-model-bundle-20260715.zip
```

Install the pinned local environment with `apps/ai-service/requirements-pii-model.lock`, then run:

```bash
python scripts/tenant_chat_pii_models/run_synthetic_smoke.py --iterations 20
```

For the normal Windows development launcher:

```powershell
scripts/dev/run-ai-service-koelectra.ps1
```

### 9.1 Ordered batch probe (2026-07-16)

An exploratory four-item synthetic-only probe compared sequential adapter calls with the new ordered batch path. It emitted aggregate counts only and did not store or print prompt text, detected values, or offsets.

| Adapter | Sequential calls | Batch-path calls | Sequential p50 | Ordered batch p50 | Detection equivalence |
|---|---:|---:|---:|---:|---|
| OpenAI privacy-filter | 4 | 1 | 430.01 ms | 217.12 ms | pass |
| KoELECTRA, safe limit 1 | 4 | 4 | 48.91 ms | 40.44 ms | pass |

The supplied KoELECTRA dynamic-QInt8 graph accepts a dynamic batch axis, but a padded four-item inference changed accepted email detection counts from `[9,0,0,0]` in single-item execution to `[0,0,0,0]`. For accuracy preservation, its model-specific `max_safe_batch_size` is therefore fixed at 1 even when the configured micro-batch size is 4. The OpenAI graph retained accepted detector type/span results in the same probe and uses dynamic batch size 4. Tenant Chat still makes one sidecar HTTP request; only KoELECTRA inference inside that request remains sequential.

`run_synthetic_smoke.py` now warms both four-item execution shapes, measures them at least five times in alternating order, and reports p50. It fails unless accepted detector type/span/source signatures remain equivalent in every iteration and the expected model invocation counts stay OpenAI `4 -> 1`, KoELECTRA `4 -> 4`; timing is exploratory and is not a pass gate. Its JSON output contains only equivalence, elapsed aggregate timing, and invocation counts for this comparison. The table reports the latest reproducible `--iterations 1` smoke run, which still performs five comparison iterations; the complete sanitized smoke result passed with both models loaded and `rawPromptStored=false`.

## 10. Required evidence before production promotion

1. Build an untouched, representative holdout with approved synthetic or separately governed labeled data; do not collect raw customer prompts by default.
2. Report span-level precision/recall/F1 and case-level false-redaction impact per detector and locale.
3. Decide whether Korean name/organization model labels can be safely admitted; current results are rule-only.
4. Run repeated cold starts and report cold p50/p95, peak RSS, steady RSS, and startup failure rate.
5. Measure warm p50/p95/p99 under expected concurrency and realistic Tenant Chat history lengths.
6. Measure sidecar timeout/fallback rate and verify Provider never receives a value that an enforce result marked protected.
7. Complete security and license review before distributing the model bundle with a release.

Until these gates pass, this integration is a configurable hybrid guardrail with local-rule fallback, not a DLP-grade PII system.
