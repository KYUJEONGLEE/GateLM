# Routing Offline Evidence

| Field | Value |
|---|---|
| Status | Supporting testing evidence |
| Applies to | Category, probe, and difficulty offline evaluation summaries |

이 디렉터리는 로컬에서 생성한 routing JSON을 그대로 저장하는 곳이 아니다. 실행 원본은 Git에서 제외되는 `reports/` 아래에 두고, 여기에는 검토 가능한 aggregate metrics와 사람이 읽는 보고서만 저장한다.

## Layout

```text
docs/testing/routing/
├─ category/
│  ├─ metrics/
│  └─ reports/
└─ difficulty/
   ├─ metrics/
   └─ reports/
```

- `category/metrics/`: category 정답 평가와 random probe에서 정리한 aggregate 값
- `category/reports/`: category 분류 결과를 해석한 보고서
- `difficulty/metrics/`: difficulty exact-match, directional error, category × difficulty와 latency aggregate
- `difficulty/reports/`: difficulty 평가의 조건, 결과, 한계와 결론을 기록한 보고서

각 evidence는 측정 날짜, commit, branch, dataset, 실행 명령과 worktree 상태를 기록한다. Raw prompt, raw response, raw detected value, raw prompt fragment, credential, provider raw error body 또는 실제 secret을 저장하지 않는다.
