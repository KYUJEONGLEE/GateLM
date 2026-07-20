# Dataset 2 ChatGPT Blind Review Kit

이 폴더는 5,000건을 `100건 × 50 batch`로 나눈 ChatGPT 전달용 blind-review package다. 입력에는 provisional label, prompt family, dataset split과 classifier output이 없다.

## 바로 사용하는 방법

Reviewer A의 새 ChatGPT 대화에 다음 세 파일을 첨부한다.

1. `GPT-REVIEW-INSTRUCTIONS.md`
2. `LABEL-GUIDE.md`
3. `packets/difficulty-independent-ood-5000.gpt-review.batch-001.input.jsonl`

그 다음 `CHATGPT-COMMAND-REVIEWER-A.md`의 한 문단을 그대로 보낸다. 반환 파일을 `results/reviewer-a/`에 저장하고 batch 002부터 050까지 반복한다. 결과 누락을 줄이려면 batch마다 새 대화를 사용하는 편이 안전하다.

두 번째 독립 검토가 필요하면 Reviewer A 결과가 보이지 않는 새 대화에서 `CHATGPT-COMMAND-REVIEWER-B.md`를 사용하고 결과를 `results/reviewer-b/`에 저장한다. 두 pass가 끝나면 결과를 provisional label과 자동 비교해 불일치·저신뢰 건만 owner adjudication queue로 좁힐 수 있다.

## 중요한 상태 규칙

- GPT 결과는 automated supporting evidence다.
- GPT 결과만으로 `labelSource=human_review`, `reviewStatus=approved`, `reviewerCount>0` 또는 `trainingEligible=true`로 바꾸지 않는다.
- 현재 Dataset 2 candidate와 split 파일은 계속 불변으로 유지한다.
- Owner 판단은 별도 파생 artifact에만 기록한다.

## 재현성 검증

```powershell
corepack pnpm run verify:v2.1-difficulty-independent-ood-5000-gpt-review
```

## Reviewer A import result

2026-07-20에 Reviewer A의 batch 001~050 output 5,000건을 독립 검증해 `results/reviewer-a/`에 고정했다. 원본 candidate는 수정하지 않았다.

- `COMPARISON-REPORT.md`: 전체 agreement와 field mismatch 집계
- `priority/02-core-label-conflicts.jsonl`: core label conflict 1,353건
- `priority/02-core-label-family-context.jsonl`: core conflict 527 family의 전체 문맥
- `priority/03-low-confidence-or-quality.jsonl`: 저신뢰·문장 품질 354건
- `priority/04-structure-conflicts.jsonl`: bucket·boundary conflict 2,564건
- `priority/05-slice-only-conflicts.jsonl`: slice-only conflict 396건
- `results/reviewer-a/OWNER-ADJUDICATION-GUIDE.md`: Owner 확인 순서와 판정 원칙

Agreement는 provisional synthetic label과 GPT 판정의 일치율이며 accuracy가 아니다. 검증 명령은 다음과 같다.

```powershell
corepack pnpm run verify:v2.1-difficulty-independent-ood-5000-gpt-review-import
```
