# GateLM AI Service

This service owns optional AI Safety and Evaluation Lab work for the v1.0.0 baseline. It is not a required dependency of the Gateway hot path.

## Private RAG extraction

`POST /internal/v1/rag/extract` is a stateless raw-body endpoint for the future Control Plane Worker. It requires `X-GateLM-AI-Service-Token` and accepts only `text/plain` (UTF-8, optional BOM) or `application/pdf` with a text layer. The service does not read S3 or PostgreSQL, call OpenAI, create embeddings, resolve tenant keys, persist chunks, or mutate jobs.

TXT normalization removes NUL characters, converts CRLF/CR to LF, applies Unicode NFC (not compatibility-changing NFKC), and collapses horizontal whitespace per line while preserving blank-line paragraph boundaries and 1-based source line ranges. PDF extraction preserves 1-based page ranges. Encrypted, damaged, scanned/image-only, over-limit, and timed-out PDFs return stable sanitized errors; OCR and embedded images/attachments are never processed.

Chunking uses the local `cl100k_base` tokenizer mapped to `text-embedding-3-large`. Profile defaults are target 600, overlap 100, and maximum 900 tokens. The tokenizer performs no OpenAI request. Runtime dependencies are pinned in `requirements-rag-extraction.lock`.

Local configuration uses `AI_SERVICE_RAG_SERVICE_TOKEN` and the `AI_SERVICE_RAG_*` bounds in `.env.example`. When `TENANT_CHAT_RAG_ENABLED=true`, `self_host`, `staging`, `production`, and `aws` deployment modes fail startup if the token is missing, shorter than 32 characters, or marked as a local/fake/example placeholder. Enabled non-local modes also require `AI_SERVICE_RAG_TEMP_DIR` to be a dedicated absolute mount; the production Compose paths bind it to a size-bounded tmpfs and clean only stale `gatelm-rag-*.source` files on startup. With the flag disabled, those RAG-only token and temp-directory dependencies are not required. `AI_SERVICE_RAG_MAX_CONCURRENT_EXTRACTIONS` bounds extraction concurrency, and PDF child processes receive configurable address-space and CPU limits in addition to the container memory and PID limits. Access logging remains disabled by default because request bodies contain document plaintext.

## RemoteSafetyEngine Prototype

RemoteSafetyEngine is an internal shadow/evaluation prototype for v2 evidence. It is disabled by default and is not connected to Gateway production blocking.

Install local dependencies when running the FastAPI prototype:

```bash
cd apps/ai-service
python -m pip install -e ".[test]"
```

Run it standalone for local evaluation:

```bash
cd apps/ai-service
AI_SERVICE_REMOTE_SAFETY_MODE=shadow python -m app.main
```

`AI_SERVICE_ACCESS_LOG_ENABLED=false` is the default for the `app.main` launcher. If running uvicorn directly, pass `--access-log false`.

Endpoint:

```text
POST /internal/v1/safety/evaluate
```

The endpoint accepts `remote-safety.v1` requests and returns non-authoritative safety metadata. It must not store raw prompt, raw response, credentials, Authorization headers, or raw detected values.

## Optional NER / Token Classification Detector

The safety lab includes an optional local token-classification adapter for sidecar experiments:

```text
prompt
-> regex detectors
-> PrivacyFilterAdapter.detect()
-> GateLM detector type normalization
-> overlap merge / dedupe
-> policy evaluator
-> redaction preview
```

Install ONNX dependencies only in a local sidecar image or experiment environment:

```bash
cd apps/ai-service
python -m pip install -e ".[onnx,test]"
```

`PrivacyFilterAdapter` lazy-loads either the direct OpenAI ONNX Runtime classifier or an Optimum ONNX token-classification pipeline. It returns only in-memory `Detection` objects with `detector_type`, `source`, `start`, `end`, and `confidence`; it does not return or store `word`, raw detected values, raw prompt fragments, or offsets through the FastAPI response. The current `/internal/v1/safety/evaluate` response contract still exposes only the existing sanitized decision and metadata shape.

The default runtime loads only the pinned `openai/privacy-filter` ONNX model. The ML candidate allowlist is limited to `phone_number` and `secret`; other supported PII categories continue through the local rule path. Keep the additional-model setting blank for this OpenAI-only configuration:

```bash
AI_SERVICE_TRANSFORMERS_OFFLINE=1
AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME=onnx
AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED=true
AI_SERVICE_AI_SAFETY_MICRO_BATCH_SIZE=4
AI_SERVICE_AI_SAFETY_MAX_CONCURRENT=1
AI_SERVICE_AI_SAFETY_MAX_PENDING=4
AI_SERVICE_AI_SAFETY_WAIT_TIMEOUT_MS=50
AI_SERVICE_ONNX_INTRA_OP_THREADS=4
AI_SERVICE_ONNX_INTER_OP_THREADS=1
AI_SERVICE_ONNX_ALLOW_SPINNING=false
AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES=phone_number,secret
AI_SERVICE_AI_SAFETY_PERSON_NAME_MODEL_ONLY=false
AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID=.cache/onnx/releases/tenant-chat-pii-models-20260715/openai--privacy-filter
AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS=
```

The primary model is loaded through the local ONNX Runtime pipeline and its detections are merged through the same sanitized GateLM policy path. Do not send raw prompts to hosted Hugging Face inference APIs for this path.

`AI_SERVICE_AI_SAFETY_MAX_CONCURRENT` is the process-local active inference limit from `1` to `32`; the conservative default is `1`. Single and batch requests share it. `AI_SERVICE_AI_SAFETY_MAX_PENDING` bounds waiting requests from `0` to `32` (default `4`), and `AI_SERVICE_AI_SAFETY_WAIT_TIMEOUT_MS` bounds each wait from `0` to `1000ms` (default `50ms`). A request continues only when a slot opens before its deadline; a full pending queue or expired wait returns the sanitized retryable `503 sidecar_unavailable` response. Setting either waiting value to `0` preserves immediate rejection. Active and pending limits are process-local, so worker or replica counts multiply the deployment-wide bounds. Raise them only after benchmarking the same vCPU and ONNX thread settings used in deployment.

The pinned 2026-07-15 delivery bundle still contains the KoELECTRA artifact and the importer verifies all manifest-listed files, but a blank additional-model setting prevents that adapter from loading or warming up. If the allowlisted KoELECTRA path is explicitly enabled for an isolated evaluation, its accepted labels remain email, phone number, and resident registration number only. Person-name and organization-name detections remain rule backstops, and the supplied evaluation does not justify production-grade accuracy claims.

`AI_SERVICE_AI_SAFETY_PERSON_NAME_MODEL_ONLY` defaults to `false`. For an isolated evaluation with a separately supplied model that supports `person_name`, set the ML allowlist to include `person_name` and enable this flag. Existing name-rule matches then seed model windows but do not become final masking signals; only accepted model `person_name` detections are masked. All non-name deterministic rules stay enabled. Startup fails when the flag is enabled without `person_name` model support. This flag does not install, activate, or deploy a model by itself.

For the Gateway path, also set `GATEWAY_AI_SAFETY_PERSON_NAME_MODEL_ONLY=true`. This removes only the Gateway's local `person_name` rules so the original name reaches the AI Service; all other local PII rules remain active. Gateway startup fails unless the sidecar is enabled in `enforce` mode with a non-empty URL and matching model ID. Keep both flags `false` outside the isolated evaluation profile.

`GATEWAY_AI_SAFETY_OVERLOAD_POLICY` defaults to `local_fallback` for compatibility.
`fail_closed` is valid only in `enforce` mode: a validated retryable sidecar overload `503`
stops before Provider execution instead of switching the request to full local rules. The
root `.env.example` and root Compose defaults use `local_fallback` with a `750ms` Gateway
timeout. The KoELECTRA development helper is a candidate-rehearsal exception and prints
`fail_closed` with a temporary `300ms` timeout. The Self-host example and Compose default
use `fail_closed` with `750ms`, while allowing the operator to select either policy
explicitly. The AWS candidate env and production-distributed profile hardcode `fail_closed`
with a temporary `300ms` Gateway timeout and mark the sidecar as a required readiness
dependency. The `300ms` value used by candidate rehearsal and AWS production-distributed
covers the configured `50ms` wait plus the previously observed HTTP inference tail; it is
not a production SLA and must be revalidated on the target Linux/Uvicorn/network profile.

Import only manifest-listed model artifacts from the delivery archive and verify every file hash:

```bash
python scripts/tenant_chat_pii_models/import_bundle.py \
  apps/ai-service/.cache/bundles/tenant-chat-pii-model-bundle-20260715.zip
```

The importer verifies the outer bundle pin and installs into `.cache/onnx/releases/tenant-chat-pii-models-20260715` only after every manifest-listed file passes size and SHA-256 verification. These runtime assets are ignored by Git. The manifest, evaluation summary, release descriptor, third-party notices, and Apache-2.0 text remain versioned in the repository. See `docs/ai-safety-lab/tenant-chat-pii-model-integration-20260715.md` for measured evidence and promotion limits.

To produce the artifact-integrity input for the production promotion gate, bind
the verification to the same Git revision used by the other evidence runs:

```bash
python scripts/tenant_chat_pii_models/import_bundle.py \
  apps/ai-service/.cache/bundles/tenant-chat-pii-model-bundle-20260715.zip \
  --evidence-out .tmp/pii-artifact-verification.json \
  --git-revision <deployed-full-git-object-id>
```

Evidence is written only after another complete checksum verification. The JSON
contains aggregate file counts plus manifest/model/Git provenance binding; it
does not contain the bundle source, artifact paths, or artifact digests. The Git
revision must be the immutable full lowercase 40- or 64-hex object ID used by
every other promotion evidence run; branch names and abbreviated SHAs fail closed.

## AI Safety Detector Sidecar

The local detector sidecar endpoint is available at:

```text
POST /internal/ai-safety/v1/detect
POST /internal/ai-safety/v1/detect/batch
```

The single route uses `ai-safety-detector.v1`; the ordered 1-to-64 item route uses `ai-safety-detector-batch.v1`. Both return Provider-safe `redactedPrompt`, storage-safe `logSafePrompt`, sanitized detections, and an `executionSummary` that distinguishes `rules_only` from actual `hybrid` model execution. The endpoint accepts `shadow` and `enforce`: shadow observations do not change the Provider prompt or final action, while enforce results can redact or block before Provider execution. `logSafePrompt` and the preview redact detections even when the Provider policy action is `allow`. It does not return model `word`, raw detected values, raw prompt fragments, or offsets.

Tenant Chat sends all local-P0-redacted messages in one batch without concatenating message text. The sidecar preserves item boundaries and order, runs detector-type-aware dynamic ONNX micro-batches, and maps every result back to its `itemIndex`. The pinned models do not support person or organization labels, so name/organization-only candidates stay rules-only. A malformed or partial batch is rejected so Gateway can use the complete local result set.

Example request shape:

```json
{
  "contractVersion": "ai-safety-detector.v1",
  "mode": "enforce",
  "input": {
    "promptText": "Use synthetic text only.",
    "locale": "en-US"
  },
  "detectorConfig": {
    "detectorSet": "privacy-filter-default",
    "returnConfidence": true,
    "detectorPolicies": [
      {"detectorType": "email", "action": "redact"},
      {"detectorType": "api_key", "action": "block"}
    ]
  }
}
```

Run locally with ONNX dependencies installed:

```bash
cd apps/ai-service
python -m pip install -e ".[onnx,test]"
AI_SERVICE_TRANSFORMERS_OFFLINE=1 \
AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME=onnx \
AI_SERVICE_AI_SAFETY_PRELOAD_ENABLED=true \
AI_SERVICE_AI_SAFETY_MICRO_BATCH_SIZE=4 \
AI_SERVICE_AI_SAFETY_MAX_CONCURRENT=1 \
AI_SERVICE_AI_SAFETY_MAX_PENDING=4 \
AI_SERVICE_AI_SAFETY_WAIT_TIMEOUT_MS=50 \
AI_SERVICE_ONNX_INTRA_OP_THREADS=4 \
AI_SERVICE_ONNX_INTER_OP_THREADS=1 \
AI_SERVICE_ONNX_ALLOW_SPINNING=false \
AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES=phone_number,secret \
AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID=.cache/onnx/releases/tenant-chat-pii-models-20260715/openai--privacy-filter \
AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS="" \
python -m app.main
```

Use ONNX Runtime for an exported token-classification model by installing the optional ONNX dependencies and pointing the model id at the exported model directory:

```bash
cd apps/ai-service
python -m pip install -e ".[onnx,test]"
AI_SERVICE_TRANSFORMERS_OFFLINE=1 \
AI_SERVICE_AI_SAFETY_DETECTOR_RUNTIME=onnx \
AI_SERVICE_AI_SAFETY_ML_ALLOWED_DETECTOR_TYPES=phone_number,secret \
AI_SERVICE_AI_SAFETY_DETECTOR_MODEL_ID=.cache/onnx/releases/tenant-chat-pii-models-20260715/openai--privacy-filter \
AI_SERVICE_AI_SAFETY_ADDITIONAL_DETECTOR_MODEL_IDS="" \
python -m app.main
```

Build an AI service image with local ML dependencies when running the detector in a container:

```bash
docker build -f infra/docker/ai-service.Dockerfile \
  --build-arg AI_SERVICE_INSTALL_ML_DEPS=true \
  -t gatelm/ai-service:ml-local .
```

## Resource / Latency Benchmark Runner

Run the AI Safety Lab sidecar latency benchmark after starting the local sidecar:

```bash
cd apps/ai-service
python -m pip install -e ".[ml,benchmark,test]"
python -m app.services.ai_safety_latency_benchmark_runner \
  --target http \
  --endpoint-url http://127.0.0.1:8000/internal/ai-safety/v1/detect \
  --runtime-profile cpu_local_pipeline \
  --timeout-ms 300 \
  --request-timeout-ms 3000 \
  --corpus ../../docs/ai-safety-lab/fixtures/resource-latency-benchmark-corpus.jsonl \
  --out ../../reports/ai-safety-lab
```

The runner writes sanitized aggregate-only reports to `reports/ai-safety-lab/resource-latency-benchmark.json` and `.md`. It does not write source input text, detected sensitive values, raw offsets, model token text, request identifiers, trace identifiers, hashes, or raw error bodies.

## PII Direct Inference Concurrency Benchmark

Use the direct runner to find the point where additional concurrent ONNX calls stop improving throughput and start increasing latency or context switches:

```bash
cd apps/ai-service
AI_SERVICE_ONNX_INTRA_OP_THREADS=4 \
AI_SERVICE_ONNX_INTER_OP_THREADS=1 \
AI_SERVICE_ONNX_ALLOW_SPINNING=false \
python -m app.services.pii_direct_inference_concurrency_benchmark_runner \
  --model-dir <canonical-koelectra-model-directory> \
  --model-version v0.1.1 \
  --concurrency-levels 1,2,4,8,16,32 \
  --rounds 3 \
  --warmup-requests 32 \
  --measured-requests 1000 \
  --deadline-ms 100 \
  --sample-interval-ms 100
```

The runner verifies every model, tokenizer, and configuration file against the checked-in canonical model registry before loading ONNX. It renders the 50-case synthetic corpus only in memory, compares every concurrent result with a sequential baseline, and never stores prompts, detections, spans, or error bodies.

Each concurrency level is measured three times in crossed order. Only levels with zero inference errors, output mismatches, and deadline excesses in every round are eligible for throughput comparison. The aggregate-only report separates p50/p95/p99 populations and records raw, same-wall idle-control, and adjusted CPU, RSS, thread, and context-switch measurements. A deadline excess is observed after inference finishes because Python cannot safely terminate a running ONNX call.

For a 4-vCPU deployment, evaluate concurrency 1, 2, and 4 first. Higher levels are oversubscription evidence, not automatic defaults. Repeat the benchmark on the same vCPU quota and ONNX thread profile used in deployment before changing the conservative process-local default of 1.

To compare how the same four logical CPUs are divided between request-level
concurrency and ONNX intra-op work, run the fixed-budget matrix:

```bash
cd apps/ai-service
python -m app.services.pii_thread_budget_matrix_benchmark_runner \
  --model-dir <canonical-koelectra-model-directory> \
  --model-version v0.1.1 \
  --cpu-budget 4 \
  --configurations 1x4,2x2,4x1 \
  --rounds 3 \
  --warmup-requests 32 \
  --measured-requests 1000 \
  --deadline-ms 100 \
  --sample-interval-ms 100
```

Every configuration runs in a fresh process with four-CPU affinity,
`inter-op=1`, and spinning disabled. The runner crosses execution order and
stores only aggregate RPS, p50/p95/p99, deadline counts, output-parity counts,
CPU utilization, and context-switch statistics. Its highest-throughput
configuration with output parity and a worst-round p99 within the deadline is
only a target-environment revalidation candidate. It does not change the
production default without a repeated 4-vCPU Linux, Uvicorn/network, and
Gateway E2E run.

## PII HTTP Admission Gate Benchmark

The direct runner selects a safe concurrency candidate but bypasses FastAPI admission. Use the HTTP runner separately to prove that one process returns bounded HTTP 200 and sanitized HTTP 503 sidecar-unavailable responses while retaining real hybrid KoELECTRA execution:

```bash
cd apps/ai-service
AI_SERVICE_ONNX_INTRA_OP_THREADS=4 \
AI_SERVICE_ONNX_INTER_OP_THREADS=1 \
AI_SERVICE_ONNX_ALLOW_SPINNING=false \
python -m app.services.pii_http_admission_concurrency_benchmark_runner \
  --primary-model-dir <local-openai-privacy-filter-directory> \
  --koelectra-model-dir <canonical-koelectra-model-directory> \
  --model-version v0.1.1 \
  --capacity 1 \
  --pending-capacity 4 \
  --wait-timeout-ms 50 \
  --cpu-affinity-count 4 \
  --parallel-requests 8 \
  --waves 20
```

This runner first keeps only synthetic cases whose in-memory preflight confirms both hybrid execution and an accepted KoELECTRA contribution, then passes those requests through the actual FastAPI route with an in-process ASGI transport. It stores only aggregate selection counts, never case IDs, prompts, or detections. It is gate evidence, not a concurrency recommendation, and does not cover Uvicorn sockets, multiple worker processes, or Gateway fallback under network load.

The v2 report records active and pending capacity, wait timeout, process CPU
affinity, and ONNX thread settings. Set `AI_SERVICE_ONNX_INTRA_OP_THREADS` to
the matrix candidate before launching this runner; the report makes a mismatch
visible but does not promote the candidate to a production default.

## Safety Eval Runner

Run detector-output fixture evaluation:

```bash
cd apps/ai-service
python -m app.services.safety_eval_runner \
  --mode detector-output \
  --corpus ../../docs/v1.0.0/fixtures/safety-eval-corpus.jsonl \
  --fixture app/tests/fixtures/safety_eval/detector-output.fixture.json \
  --out ../../reports/safety-eval
```

Run gateway-safety-output fixture evaluation:

```bash
cd apps/ai-service
python -m app.services.safety_eval_runner \
  --mode gateway-safety-output \
  --corpus ../../docs/v1.0.0/fixtures/safety-eval-corpus.jsonl \
  --fixture app/tests/fixtures/safety_eval/gateway-safety-output.fixture.json \
  --out ../../reports/safety-eval
```

Reports intentionally exclude raw prompts, raw responses, raw detected values, sample hashes, and Authorization headers. Only aggregate counts, detector types, outcomes, and preview hashes are written.

## Tests

```bash
cd apps/ai-service
python -m unittest discover -s app/tests -p "test_*.py"
```
