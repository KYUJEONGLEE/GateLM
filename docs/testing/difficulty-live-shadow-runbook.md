# Difficulty E5 Hot-Path Runtime Runbook

| Field | Value |
|---|---|
| Status | Authoritative 106D model-path difficulty runtime |
| Applies to | Optional Linux amd64 E5 Gateway profile: public Gateway and Tenant Chat private completion |
| Category | Existing rule classifier remains authoritative |
| Failure mode | Per-request or startup rule-difficulty fallback |
| Active contract | [`../routing/contracts.md`](../routing/contracts.md) |
| Model report | [`../../reports/routing-difficulty-model/20260716-model-path-5000/REPORT.md`](../../reports/routing-difficulty-model/20260716-model-path-5000/REPORT.md) |
| Last reviewed | 2026-07-16 |

## 1. Promoted Artifact

The promoted model is frozen Candidate B: `42D rule + 64D PCA`, Logistic Regression L2/liblinear `C=10`, Platt scaling and global threshold `0.096`. It was trained with 3,000 records, calibrated and selected with 1,000 records, then evaluated once on a separate 1,000-record test. Test joint routing accuracy was `62.6%` with 95% CI `59.1–65.9%`; difficulty accuracy was `97.8%`.

- Artifact version: `difficulty-offline.model-path-5000.2026-07-16.42d-rule-vector-v1-plus-projection.shadow.v1`
- Bundle hash: `sha256:1a755c3bca16f76a43f86696e9b2028e805eb7536161245a8683adf78b118ebd`
- Content hash: `sha256:4c2c4f516206530d3b3f9c393b0633b7694a2e0aa5e20400d65faf088a184f5d`
- Decision boundary: current `semantic-empty / combined score-8`
- Historical baseline waiver: rejected and not required

Promotion reuses the exact artifact and generated Go arrays already verified in shadow. It does not refit, recalibrate, change the threshold or reopen the frozen test 1,000 records.

## 2. Runtime Behavior

For a normal public Gateway or Tenant Chat `model: "auto"` model-path request, a `ready` 106D result replaces only the rule difficulty before routing-matrix lookup. Tenant Chat then resolves the selected category × difficulty cell from the Chat App 5×2 table to its ordered modelRefs. The category remains rule-based. Manual modelRef, auto-disabled, empty/sentinel and hard-rule paths do not depend on E5 inference.

Each Gateway process owns one encoder worker and four bounded waiting jobs shared by the public Gateway and Tenant Chat completion paths; Tenant Chat does not initialize or close a second runtime. Each request waits at most `GATEWAY_DIFFICULTY_E5_RUNTIME_TIMEOUT_MS` (`100ms` default, `1..1000ms` allowed). Queue saturation, request cancellation, timeout, invalid embedding, inference failure or panic retains that request's rule difficulty. Startup bundle verification or smoke failure starts both paths in rule-difficulty fallback mode.

Process startup allows up to `60s` for the one-time cold tokenizer/ONNX smoke. This does not change the per-request `100ms` default. Exceeding the startup bound marks the E5 runtime unavailable and starts the Gateway in rule-difficulty fallback mode.

Runtime activation:

```dotenv
GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED=true
GATEWAY_DIFFICULTY_E5_RUNTIME_TIMEOUT_MS=100
GATEWAY_DIFFICULTY_E5_SHADOW_ENABLED=false
```

Use [`../../infra/docker/gateway-core-e5-runtime.Dockerfile`](../../infra/docker/gateway-core-e5-runtime.Dockerfile). The default CGO-free image contains no E5 native runtime and remains rule-only. Enabling both runtime and historical request shadow is a configuration error.

Tenant Chat local Compose selects the E5 runtime image by default, prepares the pinned `.tmp/gateway-e5-runtime-bundle` before `build` or `up`, enables authoritative runtime mode, and disables historical shadow. The standalone CGO-free image remains available for explicit rule-only execution and rollback.

## 3. Rollout Guardrails

Set a container memory hard limit of `2 GiB` (`2147483648` bytes). Confirm the startup log contains `difficulty E5 hot-path runtime initialized`. Then verify public Gateway and Tenant Chat auto requests can select both the simple and complex matrix cells while manual routes remain unchanged. For Tenant Chat, verify all five Chat App category rows resolve the selected difficulty cell's first eligible modelRef.

Rollback immediately when any one of these occurs:

- container OOM or repeated Gateway restart
- sensitive-data exposure in API, DB, Event, Metrics or logs
- request latency exceeds the configured bound because of semantic queueing
- semantic failure prevents provider execution instead of falling back
- Python/Go parity, artifact checksum or startup smoke verification fails

Rollback when either memory condition persists for 5 minutes:

- process RSS greater than `1.25 GiB` (`1342177280` bytes)
- cgroup current greater than `1.75 GiB` (`1879048192` bytes)

Operational memory and restart observations come from deployment-platform telemetry. This promotion adds no API, DB, Event or Metrics field.

## 4. Rollback

Set the runtime flag to false and restart the Gateway:

```dotenv
GATEWAY_DIFFICULTY_E5_RUNTIME_ENABLED=false
```

Both public Gateway and Tenant Chat completion then use the existing rule classifier for category and difficulty. No policy, schema, database or cache migration is required. Do not enable historical shadow as part of an emergency rollback.

## 5. Verification

Run the checked-in bundle verifier. It validates immutable hashes, generated Go code, Python/Go pooled-output parity, public and Tenant Chat hot-path routing, Tenant Chat 5×2 mapping/fallback/manual isolation, timeout/busy/error isolation, the native request-runtime E2E, the optional image and startup smoke. It does not rerun the frozen test set.

```powershell
corepack pnpm run verify:v2.1-difficulty-gateway-bundle
corepack pnpm run verify:v2.1-gateway-e5-runtime
```

Record source commit, image identity, artifact version, bundle/content hashes, timeout, memory limit and verification outcome. Do not record tenant/application IDs, request/trace IDs, prompt or response content, tokens, embeddings, individual scores, modelRef, provider/model or native error detail.

## 6. AWS Production Image Build

`deploy/aws-triage/scripts/deploy-main.sh` checks out the requested source commit, runs `prepare-gateway-e5-runtime-bundle.sh`, validates the resulting named build context, and only then builds `gateway-core`. The preparation step may access the pinned artifact sources; checksum, size, allowlist, extraction, or symlink validation failure aborts before application cutover.

Production Compose fixes runtime mode on, historical shadow off, and the timeout to `100ms` unless explicitly overridden. The E5 image smoke test runs as UID/GID `1000:1000` to cover the same arbitrary-user boundary used for production Tenant Chat secret mounts. A successful source commit alone is not deployment evidence; record the actual deployment run and post-cutover checks separately.
