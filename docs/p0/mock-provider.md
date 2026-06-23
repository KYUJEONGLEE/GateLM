# GateLM Mock Provider Spec v0.1

## 문서 목적

이 문서는 GateLM P0에서 실제 OpenAI/Anthropic/Gemini Key 없이도 Gateway end-to-end 데모가 가능하도록 하는 mock provider 기준이다. Mock Provider는 비용, 캐시, 라우팅, 로그, 장애 시나리오를 안정적으로 재현하기 위한 테스트 Provider다.

---

## 1. 원칙

```text
1. P0 데모는 mock provider만으로 완주 가능해야 한다.
2. mock provider 응답은 deterministic해야 한다.
3. token usage와 latency를 제어할 수 있어야 한다.
4. error/timeout을 의도적으로 발생시킬 수 있어야 한다.
5. mock provider도 Provider Adapter를 통해 호출해야 한다.
6. Web Console, Control Plane, Chat UI가 mock provider를 직접 호출하지 않는다.
```

---

## 2. 구현 방식 선택

P0는 아래 둘 중 하나를 선택한다.

| 방식 | 설명 | 추천 |
|---|---|---:|
| A안 | `apps/mock-provider` 별도 local HTTP service | 데모/테스트에 좋음 |
| B안 | Gateway 내부 `mock` Provider Adapter | 구현이 빠름 |

권장: A안. 단, 시간이 부족하면 B안으로 시작하고 interface는 Provider Adapter 기준으로 유지한다.

---

## 3. Mock Provider 모델 목록

| Provider | Model | 용도 | Input price | Output price |
|---|---|---|---:|---:|
| `mock` | `mock-fast` | low-cost routing 대상 | 10 micro USD / 1M tokens | 20 micro USD / 1M tokens |
| `mock` | `mock-balanced` | 기본 모델 | 20 micro USD / 1M tokens | 40 micro USD / 1M tokens |
| `mock` | `mock-smart` | 고비용 모델 시뮬레이션 | 100 micro USD / 1M tokens | 200 micro USD / 1M tokens |

가격은 데모용이다. 실제 Provider 가격과 혼동하지 않는다.

---

## 4. Endpoint

Mock Provider는 OpenAI-compatible subset을 지원한다.

```text
GET  /healthz
GET  /v1/models
POST /v1/chat/completions
GET  /__mock/stats
POST /__mock/reset
POST /__mock/config
```

`/__mock/*` endpoint는 로컬 개발/테스트 전용이다. 운영 배포 대상이 아니다.

---

## 5. Chat Completions Request

```json
{
  "model": "mock-fast",
  "messages": [
    {
      "role": "user",
      "content": "Write a short refund response."
    }
  ],
  "temperature": 0.2,
  "max_tokens": 128,
  "stream": false
}
```

P0 mock provider는 text-only만 처리한다.

거부 대상:

```text
stream=true, P0에서는 optional
image/file/audio content
function/tool call
multipart request
```

---

## 6. Chat Completions Response

```json
{
  "id": "mock_chatcmpl_000001",
  "object": "chat.completion",
  "created": 1782108000,
  "model": "mock-fast",
  "choices": [
    {
      "index": 0,
      "message": {
        "role": "assistant",
        "content": "Mock response for: Write a short refund response."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 32,
    "completion_tokens": 24,
    "total_tokens": 56
  }
}
```

응답 content는 deterministic해야 한다.

권장 생성 규칙:

```text
response = "Mock response for: " + first 80 chars of normalized redacted user prompt
```

주의: mock provider가 받은 prompt도 log에 raw로 남기지 않는다. 테스트 stats에는 promptHash와 redactedPreview만 허용한다.

---

## 7. Token Usage 계산

정확한 tokenizer가 없어도 P0에서는 deterministic 추정으로 충분하다.

```text
prompt_tokens = ceil(total_input_chars / 4)
completion_tokens = min(max_tokens, max(16, ceil(response_chars / 4)))
total_tokens = prompt_tokens + completion_tokens
```

Gateway cost 계산은 mock model pricing table을 사용한다.

---

## 8. Latency 제어

기본 latency:

```text
mock-fast: 80ms
mock-balanced: 150ms
mock-smart: 300ms
```

`/__mock/config`로 변경 가능해야 한다.

```json
{
  "defaultLatencyMs": 150,
  "modelLatencyMs": {
    "mock-fast": 80,
    "mock-balanced": 150,
    "mock-smart": 300
  }
}
```

---

## 9. Error / Timeout 시뮬레이션

`/__mock/config` 예시:

```json
{
  "errorMode": "off",
  "errorRate": 0,
  "timeoutMode": "off",
  "timeoutAfterMs": 0
}
```

지원 mode:

| Mode | 의미 |
|---|---|
| `off` | 정상 응답 |
| `always_error` | 항상 502-like provider error |
| `always_timeout` | 지정 시간 이후 timeout |
| `rate_limited` | 429-like provider error |
| `random_error` | `errorRate` 기준 랜덤 오류 |

Provider raw error body에는 prompt를 포함하지 않는다.

---

## 10. Call Count / Stats

`GET /__mock/stats` 응답:

```json
{
  "data": {
    "totalCalls": 3,
    "callsByModel": {
      "mock-fast": 2,
      "mock-balanced": 1
    },
    "lastCalls": [
      {
        "requestId": "request_01J...",
        "model": "mock-fast",
        "promptHash": "hmac-sha256:...",
        "redactedPromptPreview": "Write a short refund response.",
        "createdAt": "2026-06-23T00:00:00.000Z"
      }
    ]
  }
}
```

용도:

```text
- Exact Cache hit 시 Provider 호출이 증가하지 않았는지 확인
- Routing 결과로 어떤 model이 호출됐는지 확인
- Redaction이 Provider 호출 전에 적용됐는지 확인
```

금지:

```text
rawPrompt
rawResponse
authorizationHeader
apiKey
appToken
```

---

## 11. Gateway 연동 기준

Gateway는 mock provider도 일반 Provider Adapter로 취급한다.

```text
ProviderRegistry
  -> mock.Adapter
  -> CreateChatCompletion(ctx, req)
```

Gateway handler에서 아래처럼 분기하지 않는다.

```text
금지: if provider == "mock" { special case }
허용: adapter := providerRegistry.Get(provider)
```

---

## 12. Seed Provider Connection

Seed 데이터 예시:

```json
{
  "provider": "mock",
  "name": "Local Mock Provider",
  "baseUrl": "http://localhost:8090",
  "defaultModel": "mock-balanced",
  "status": "active",
  "secretRef": "local-secret://mock-provider/test"
}
```

`secretRef`는 interface 일관성을 위한 값이다. mock provider가 실제 secret을 요구하지 않더라도 Provider credential resolver 흐름은 유지한다.

---

## 13. Acceptance Criteria

```text
[ ] /healthz 응답 가능
[ ] /v1/models에 mock-fast/mock-balanced/mock-smart 표시
[ ] /v1/chat/completions non-stream 응답 가능
[ ] usage token 반환
[ ] model별 latency 설정 가능
[ ] error/timeout mode 설정 가능
[ ] /__mock/stats에서 call count 확인 가능
[ ] raw prompt/raw token이 stats/log에 남지 않음
[ ] Gateway Exact Cache hit 시 totalCalls가 증가하지 않음
[ ] redacted request에서 stats preview에 placeholder만 표시
```
