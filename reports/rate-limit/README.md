# Rate Limit Reports

Rate limit 성능 측정 계획, 분석 리포트, 실행 산출물 위치를 모아두는 디렉터리다.

## 구조

- `perf/`: 측정 질문, 실행 방법, 관찰 SQL, 결과 기록 템플릿
- `report/`: 해석과 결론 중심의 Markdown 리포트
- `runs/`: k6, metrics, DB snapshot 같은 raw 실행 산출물

`runs/`는 로컬 재현과 분석용이며 기본적으로 Git에 커밋하지 않는다.
