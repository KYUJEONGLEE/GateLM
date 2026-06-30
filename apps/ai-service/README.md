# GateLM AI Service

This service owns optional AI Safety and Evaluation Lab work for the v1.0.0 baseline. It is not a required dependency of the Gateway hot path.

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

Install ML dependencies only in a local sidecar image or experiment environment:

```bash
cd apps/ai-service
python -m pip install -e ".[ml,test]"
```

`PrivacyFilterAdapter` lazy-loads `transformers.pipeline(task="token-classification")` and is not wired into the default evaluator unless it is explicitly injected. It returns only in-memory `Detection` objects with `detector_type`, `source`, `start`, `end`, and `confidence`; it does not return or store `word`, raw detected values, raw prompt fragments, or offsets through the FastAPI response. The current `/internal/v1/safety/evaluate` response contract still exposes only the existing sanitized decision and metadata shape.

## AI Safety Detector Sidecar

The local detector sidecar endpoint is available at:

```text
POST /internal/ai-safety/v1/detect
```

It uses the `ai-safety-detector.v1` draft contract and returns `redactedPrompt`, `detectorSummary`, and sanitized `detections`. The endpoint is `shadow` mode by default and uses a CPU-only local `openai/privacy-filter` adapter. It does not return model `word`, raw detected values, raw prompt fragments, or offsets.

Example request shape:

```json
{
  "contractVersion": "ai-safety-detector.v1",
  "mode": "shadow",
  "input": {
    "promptText": "Use synthetic text only.",
    "locale": "en-US"
  },
  "detectorConfig": {
    "detectorSet": "privacy-filter-default",
    "returnConfidence": true
  }
}
```

Run locally with ML dependencies installed:

```bash
cd apps/ai-service
python -m pip install -e ".[ml,test]"
python -m app.main
```

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
