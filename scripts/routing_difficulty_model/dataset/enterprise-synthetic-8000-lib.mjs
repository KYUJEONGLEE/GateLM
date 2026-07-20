import { createHash } from "node:crypto";
import { lengthBucket } from "./dataset-bias.mjs";

export const DATASET_VERSION = "routing_difficulty_enterprise_synthetic_8000_rebalanced_2026_07_21";
export const RECORD_SCHEMA_VERSION = "gatelm.routing-difficulty-dataset-record.v1";
export const MANIFEST_SCHEMA_VERSION = "gatelm.routing-difficulty-dataset-manifest.v1";
export const CREATED_AT = "2026-07-20T00:00:00Z";
export const GENERATION_SEED = 20260720;

export const DATASET_PATH =
  "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.jsonl";
export const MANIFEST_PATH =
  "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.manifest.json";
export const RECORD_SCHEMA_PATH =
  "docs/routing/datasets/difficulty/schemas/difficulty-dataset-record.schema.json";
export const MANIFEST_SCHEMA_PATH =
  "docs/routing/datasets/difficulty/schemas/difficulty-dataset-manifest.schema.json";

export const LABELS = ["simple", "complex"];
export const LANGUAGES = ["ko", "en", "mixed"];
export const SPLITS = ["train", "validation", "test"];
export const SOURCES = ["synthetic", "boundary"];

const DOMAINS = [
  ["corporate_operations", "일반 사내 업무", "internal operations"],
  ["hr_recruiting", "인사·채용", "HR and recruiting"],
  ["internal_policy", "사내 규정·정책", "internal policy"],
  ["finance_accounting", "재무·회계", "finance and accounting"],
  ["sales", "영업", "sales"],
  ["marketing", "마케팅", "marketing"],
  ["customer_support", "고객 지원", "customer support"],
  ["security", "보안", "security"],
  ["legal", "법무", "legal"],
  ["compliance", "컴플라이언스", "compliance"],
  ["privacy", "개인정보 보호", "privacy"],
  ["software_development", "소프트웨어 개발", "software development"],
  ["data_analysis", "데이터 분석", "data analytics"],
  ["project_management", "프로젝트 관리", "project management"],
  ["product_planning", "제품 기획", "product planning"],
  ["research", "연구·조사", "research"],
  ["business_strategy", "경영 전략", "business strategy"],
  ["document_management", "문서 관리", "document management"],
  ["meeting_minutes", "회의록", "meeting minutes"],
  ["business_reporting", "업무 보고", "business reporting"],
  ["training_onboarding", "교육·온보딩", "training and onboarding"],
  ["rag_internal_knowledge", "RAG 기반 사내 문서 질의", "RAG-based internal knowledge"],
  ["business_format_conversion", "업무 형식 변환", "business format conversion"],
].map(([id, ko, en]) => ({ id, ko, en }));

const CONTEXTS = {
  artifacts: [
    ["월간 운영 보고서", "monthly operations report"],
    ["신규 입사자 안내서", "new-hire guide"],
    ["비용 정산 표", "expense reconciliation sheet"],
    ["고객 문의 기록", "customer inquiry log"],
    ["배포 점검표", "deployment checklist"],
    ["접근 권한 정책", "access-control policy"],
    ["분기별 실적 자료", "quarterly performance brief"],
    ["프로젝트 위험 등록부", "project risk register"],
    ["제품 요구사항 문서", "product requirements document"],
    ["교육 만족도 설문", "training satisfaction survey"],
    ["회의 결정사항", "meeting decision log"],
    ["개인정보 처리 지침", "privacy handling guideline"],
  ],
  periods: [
    ["이번 주", "this week"],
    ["7월", "July"],
    ["3분기", "Q3"],
    ["다음 배포 전", "before the next release"],
    ["파일럿 운영 기간", "the pilot period"],
    ["연말 결산 시점", "year-end close"],
  ],
  audiences: [
    ["팀장", "team lead"],
    ["신규 입사자", "new hires"],
    ["경영진", "executives"],
    ["고객 지원 담당자", "support agents"],
    ["개발자", "developers"],
    ["감사 담당자", "auditors"],
    ["해외 파트너", "international partners"],
    ["일반 직원", "employees"],
  ],
  metrics: [
    ["처리 시간", "handling time"],
    ["오류율", "error rate"],
    ["전환율", "conversion rate"],
    ["예산 편차", "budget variance"],
    ["재문의율", "repeat-contact rate"],
    ["납기 준수율", "on-time delivery rate"],
    ["정책 준수율", "policy compliance rate"],
    ["활성 사용자 수", "active user count"],
  ],
  systems: [
    ["권한 관리 API", "access-control API"],
    ["결제 배치", "billing batch"],
    ["문서 검색 서비스", "document search service"],
    ["고객 티켓 파이프라인", "support ticket pipeline"],
    ["배포 워크플로", "deployment workflow"],
    ["비용 집계 잡", "cost aggregation job"],
    ["인사 데이터 동기화", "HR data synchronization"],
    ["알림 큐", "notification queue"],
  ],
  initiatives: [
    ["온보딩 개선", "onboarding improvement"],
    ["비용 절감", "cost reduction"],
    ["품질 안정화", "quality stabilization"],
    ["고객 이탈 방지", "customer retention"],
    ["권한 정비", "access cleanup"],
    ["보고 자동화", "reporting automation"],
    ["업무 표준화", "workflow standardization"],
    ["감사 대응", "audit readiness"],
    ["배포 안전성", "release safety"],
    ["데이터 정합성", "data consistency"],
    ["응답 속도 개선", "response-time improvement"],
    ["정책 통합", "policy consolidation"],
    ["운영 인수인계", "operations handoff"],
    ["리스크 조기 탐지", "early risk detection"],
    ["문서 최신화", "documentation refresh"],
    ["지표 신뢰성", "metric reliability"],
  ],
  regions: [
    ["국내", "Korea"],
    ["아시아 태평양", "Asia-Pacific"],
    ["북미", "North America"],
    ["유럽", "Europe"],
    ["수도권", "capital-region"],
    ["동남권", "southeast-region"],
    ["본사", "headquarters"],
    ["해외 법인", "overseas-subsidiary"],
    ["파일럿 조직", "pilot-organization"],
    ["공통 플랫폼", "shared-platform"],
    ["내부 운영망", "internal-operations-network"],
    ["파트너 채널", "partner-channel"],
  ],
  channels: [
    ["모바일", "mobile"],
    ["웹", "web"],
    ["이메일", "email"],
    ["고객 센터", "contact-center"],
    ["배치 처리", "batch-processing"],
    ["실시간 처리", "real-time"],
    ["관리자 콘솔", "admin-console"],
    ["사내 포털", "internal-portal"],
    ["API", "API"],
    ["데이터 웨어하우스", "data-warehouse"],
    ["문서 저장소", "document-repository"],
    ["협업 도구", "collaboration-tool"],
  ],
};

function task(id, category, simple, complex) {
  return { id, category, simple, complex };
}

const TASKS = [
  task(
    "general_query",
    "general",
    {
      ko: "{domain}에서 사용하는 {artifact}의 담당 부서를 한 문장으로 알려줘.",
      en: "Name the team responsible for the {artifact} in {domain} in one sentence.",
      mixed: "{domain}의 {artifact} owner team만 한 문장으로 알려줘.",
    },
    {
      ko: "{domain}의 {artifact} 요청이 세 정책과 충돌한다. 적용 우선순위를 판단하고 예외, 위험, 승인 경로를 근거와 함께 정리해줘.",
      en: "A {artifact} request in {domain} conflicts with three policies. Determine precedence and explain exceptions, risks, and the approval path with evidence.",
      mixed: "{domain} {artifact} 요청이 policy 세 개와 충돌해. precedence를 판단하고 exception, risk, approval path를 근거와 함께 정리해줘.",
    },
  ),
  task(
    "fact_explanation",
    "general",
    {
      ko: "{domain}에서 {metric}이 무엇을 뜻하는지 두 문장으로 설명해줘.",
      en: "Explain what {metric} means in {domain} in two sentences.",
      mixed: "{domain}에서 {metric} metric이 뭘 뜻하는지 두 문장으로 설명해줘.",
    },
    {
      ko: "{domain}의 {metric}이 악화된 원인을 가능한 가설로 나누고, 각 가설의 확인 자료와 반증 조건을 설계해줘.",
      en: "Break down plausible causes of worsening {metric} in {domain}, then design evidence checks and falsification criteria for each hypothesis.",
      mixed: "{domain}의 {metric} 악화 원인을 hypothesis별로 나누고 evidence check와 falsification criteria를 설계해줘.",
    },
  ),
  task(
    "translation",
    "translation",
    {
      ko: "'{artifact} 검토가 완료되었습니다'를 자연스러운 비즈니스 영어로 번역해줘.",
      en: "Translate 'The {artifact} review is complete' into natural Korean.",
      mixed: "'{artifact} review 완료' 문장을 natural business English로 번역해줘.",
    },
    {
      ko: "{domain}의 한국어·영어 용어집과 기존 공지 두 건을 비교해서 {audience}용 번역을 만들고, 용어 선택이 충돌한 부분과 해결 근거를 표로 정리해줘.",
      en: "Compare the Korean-English glossary and two prior notices for {domain}, produce a translation for {audience}, and tabulate terminology conflicts and resolutions.",
      mixed: "{domain} KO/EN glossary와 기존 notice 두 건을 비교해 {audience}용 translation을 만들고 terminology conflict와 resolution 근거를 표로 정리해줘.",
    },
  ),
  task(
    "summarization",
    "summarization",
    {
      ko: "{artifact}의 아래 한 문단을 핵심 세 문장으로 요약해줘: 일정은 유지되고 담당자만 변경된다.",
      en: "Summarize this {artifact} paragraph in three key sentences: the schedule stays the same and only the owner changes.",
      mixed: "{artifact} paragraph를 key point 세 문장으로 요약해줘: schedule은 그대로고 owner만 바뀐다.",
    },
    {
      ko: "{domain}의 보고서 세 건을 비교해 주장, 근거, 상충 지점, 누락된 위험을 통합하고 {audience}용 executive summary와 근거표를 작성해줘.",
      en: "Compare three {domain} reports, synthesize claims, evidence, conflicts, and missing risks, then write an executive summary and evidence table for {audience}.",
      mixed: "{domain} report 세 건을 compare해서 claim, evidence, conflict, missing risk를 통합하고 {audience}용 executive summary와 evidence table을 작성해줘.",
    },
  ),
  task(
    "document_writing",
    "general",
    {
      ko: "{audience}에게 {artifact} 제출을 안내하는 짧은 이메일을 작성해줘.",
      en: "Write a short email asking {audience} to submit the {artifact}.",
      mixed: "{audience}에게 {artifact} submit을 안내하는 short email 작성해줘.",
    },
    {
      ko: "{domain}의 {artifact}를 바탕으로 배경, 대안 세 가지, 비용·위험 비교, 권고안, 실행 일정이 포함된 의사결정 문서를 작성해줘.",
      en: "Using the {artifact} for {domain}, write a decision memo with context, three alternatives, cost-risk comparison, recommendation, and implementation timeline.",
      mixed: "{domain} {artifact}를 바탕으로 context, three options, cost/risk comparison, recommendation, implementation timeline이 있는 decision memo를 작성해줘.",
    },
  ),
  task(
    "code_generation",
    "code",
    {
      ko: "문자열 배열을 길이순으로 정렬하는 Python 함수를 작성해줘.",
      en: "Write a Python function that sorts a string array by length.",
      mixed: "string array를 length 기준으로 sort하는 Python function 작성해줘.",
    },
    {
      ko: "{system}의 비동기 작업을 idempotent하게 처리하는 모듈을 설계하고 구현 코드, 재시도 정책, 동시성 제어, 단위·통합 테스트를 함께 작성해줘.",
      en: "Design an idempotent asynchronous module for the {system}, including implementation, retry policy, concurrency control, and unit and integration tests.",
      mixed: "{system} async job을 idempotent하게 처리하도록 design하고 implementation, retry policy, concurrency control, unit/integration test를 작성해줘.",
    },
  ),
  task(
    "code_explanation",
    "code",
    {
      ko: "다음 Python 코드가 반환하는 값을 설명해줘.\n```python\nitems = [3, 1, 2]\nprint(sorted(items))\n```",
      en: "Explain the value returned by this Python code.\n```python\nitems = [3, 1, 2]\nprint(sorted(items))\n```",
      mixed: "이 Python code의 return value만 설명해줘.\n```python\nitems = [3, 1, 2]\nprint(sorted(items))\n```",
    },
    {
      ko: "{system}의 상태 전이 코드와 호출 로그를 함께 읽고 경쟁 조건이 생기는 경로를 추적한 뒤, 재현 순서와 안전한 수정 방안을 설명해줘.",
      en: "Analyze the state-transition code and call log for the {system}, trace the race path, and explain a reproducible sequence and safe fix.",
      mixed: "{system} state transition code와 call log를 같이 보고 race path를 trace한 뒤 reproduction sequence와 safe fix를 설명해줘.",
    },
  ),
  task(
    "code_modification",
    "code",
    {
      ko: "다음 JavaScript 함수의 변수 이름만 더 명확하게 바꿔줘.\n```js\nconst f = (x) => x.map(v => v.id);\n```",
      en: "Rename only the variables in this JavaScript function for clarity.\n```js\nconst f = (x) => x.map(v => v.id);\n```",
      mixed: "이 JavaScript function에서 variable name만 readable하게 바꿔줘.\n```js\nconst f = (x) => x.map(v => v.id);\n```",
    },
    {
      ko: "{system} 코드를 무중단 전환이 가능하도록 리팩터링하고 기존 API 호환성, 오류 복구, 성능 회귀를 검증하는 테스트와 롤백 절차까지 제시해줘.",
      en: "Refactor the {system} for zero-downtime migration and provide compatibility, recovery, performance-regression tests, and a rollback procedure.",
      mixed: "{system} code를 zero-downtime migration 가능하게 refactor하고 API compatibility, recovery, performance regression test와 rollback 절차를 제시해줘.",
    },
  ),
  task(
    "code_review",
    "code",
    {
      ko: "다음 조건문에 명백한 오타가 있는지만 확인해줘.\n```ts\nif (status === 'ready') return true;\n```",
      en: "Check only whether this condition has an obvious typo.\n```ts\nif (status === 'ready') return true;\n```",
      mixed: "이 condition에 obvious typo가 있는지만 check해줘.\n```ts\nif (status === 'ready') return true;\n```",
    },
    {
      ko: "{system} 변경분을 보안, 동시성, 장애 복구, 관측 가능성 관점에서 리뷰하고 우선순위별 결함, 수정 패치, 검증 테스트를 작성해줘.",
      en: "Review the {system} change for security, concurrency, recovery, and observability; provide prioritized findings, patches, and verification tests.",
      mixed: "{system} change를 security, concurrency, recovery, observability 관점에서 review하고 prioritized finding, patch, verification test를 작성해줘.",
    },
  ),
  task(
    "debugging",
    "code",
    {
      ko: "`ReferenceError: total is not defined` 오류의 뜻을 한 문장으로 알려줘.",
      en: "Explain `ReferenceError: total is not defined` in one sentence.",
      mixed: "`ReferenceError: total is not defined` error 의미만 한 문장으로 알려줘.",
    },
    {
      ko: "{system}에서 간헐적으로 발생하는 중복 처리의 원인을 로그 순서와 상태 전이로 분석하고, 최소 재현 코드, 수정 코드, 회귀 테스트를 만들어줘.",
      en: "Diagnose intermittent duplicate processing in the {system} from log order and state transitions, then create a minimal reproduction, fix, and regression tests.",
      mixed: "{system} intermittent duplicate processing을 log order와 state transition으로 분석하고 minimal repro, fix, regression test를 만들어줘.",
    },
  ),
  task(
    "data_analysis",
    "reasoning",
    {
      ko: "{period} {metric} 값 12, 15, 18의 평균을 계산해줘.",
      en: "Calculate the mean of the {period} {metric} values 12, 15, and 18.",
      mixed: "{period} {metric} values 12, 15, 18의 mean 계산해줘.",
    },
    {
      ko: "{domain}의 {metric} 원자료에서 결측과 이상치를 처리하고 세그먼트별 추세, 교란 요인, 대안 가설을 분석한 뒤 재현 가능한 분석 절차를 작성해줘.",
      en: "Clean missing values and outliers in the {domain} {metric} data, analyze segment trends, confounders, and alternative hypotheses, and document a reproducible workflow.",
      mixed: "{domain} {metric} raw data의 missing/outlier를 처리하고 segment trend, confounder, alternative hypothesis를 분석한 뒤 reproducible workflow를 작성해줘.",
    },
  ),
  task(
    "math_problem",
    "reasoning",
    {
      ko: "240의 15%를 계산해줘.",
      en: "Calculate 15% of 240.",
      mixed: "240의 15 percent 계산해줘.",
    },
    {
      ko: "서로 의존하는 세 예산 제약과 두 확률 조건을 만족하는 최적 배분식을 세우고, 해의 존재 조건과 민감도까지 증명해줘.",
      en: "Formulate an optimal allocation under three dependent budget constraints and two probability conditions, then prove existence and analyze sensitivity.",
      mixed: "dependent budget constraint 세 개와 probability condition 두 개를 만족하는 optimization을 세우고 existence condition과 sensitivity를 증명해줘.",
    },
  ),
  task(
    "comparison_evaluation",
    "reasoning",
    {
      ko: "두 문구 중 더 짧은 것을 골라줘: '검토 완료'와 '검토가 완료되었습니다'.",
      en: "Choose the shorter phrase: 'Review complete' or 'The review has been completed'.",
      mixed: "'Review complete'와 'The review has been completed' 중 shorter phrase를 골라줘.",
    },
    {
      ko: "{domain}의 대안 세 가지를 비용, 위험, 구현 기간, 규정 영향으로 비교하고 가중치 변화에 따른 권고안의 민감도를 평가해줘.",
      en: "Compare three {domain} alternatives on cost, risk, implementation time, and regulatory impact, then assess recommendation sensitivity to weight changes.",
      mixed: "{domain} option 세 개를 cost, risk, lead time, compliance impact로 비교하고 weight change에 따른 recommendation sensitivity를 평가해줘.",
    },
  ),
  task(
    "planning",
    "reasoning",
    {
      ko: "{artifact} 검토 회의를 위한 30분짜리 간단한 순서를 만들어줘.",
      en: "Create a simple 30-minute agenda for reviewing the {artifact}.",
      mixed: "{artifact} review meeting용 30-minute agenda를 간단히 만들어줘.",
    },
    {
      ko: "{domain} 전환 계획을 단계별로 만들고 선행 조건, 담당자 의존성, 실패 기준, 롤백, 검증 지표를 연결한 실행 계획을 작성해줘.",
      en: "Build a phased {domain} transition plan linking prerequisites, owner dependencies, failure criteria, rollback, and verification metrics.",
      mixed: "{domain} transition plan을 phase별로 만들고 prerequisite, owner dependency, failure criteria, rollback, verification metric을 연결해줘.",
    },
  ),
  task(
    "search",
    "general",
    {
      ko: "웹에서 {period} 공휴일 날짜 하나를 찾아 출처 링크와 함께 알려줘.",
      en: "Look up one public holiday date for {period} and provide the source link.",
      mixed: "web에서 {period} public holiday date 하나만 찾아 source link와 알려줘.",
    },
    {
      ko: "{domain}의 최근 규정 변경을 여러 공식 출처에서 검색해 발효일과 적용 범위를 교차 검증하고, 상충 정보와 실무 영향을 비교해줘.",
      en: "Research recent regulatory changes affecting {domain} across official sources, cross-check effective dates and scope, and compare conflicts and operational impact.",
      mixed: "{domain} recent regulation change를 official source 여러 곳에서 search하고 effective date와 scope를 cross-check한 뒤 conflict와 impact를 비교해줘.",
    },
  ),
  task(
    "rag_query",
    "general",
    {
      ko: "사내 지식베이스에서 {artifact}의 보관 기간 한 항목만 찾아줘.",
      en: "Retrieve the retention period for the {artifact} from the internal knowledge base.",
      mixed: "internal knowledge base에서 {artifact} retention period 한 항목만 찾아줘.",
    },
    {
      ko: "사내 지식베이스의 정책·절차·예외 문서를 함께 검색해 {domain} 사례에 적용할 규칙을 판단하고 인용 근거, 충돌, 추가 확인 사항을 정리해줘.",
      en: "Retrieve policy, procedure, and exception documents from the internal knowledge base, determine which rules apply to the {domain} case, and summarize citations, conflicts, and open checks.",
      mixed: "internal KB의 policy, procedure, exception docs를 함께 retrieve해서 {domain} case에 적용할 rule을 판단하고 citation, conflict, open check를 정리해줘.",
    },
  ),
  task(
    "table_conversion",
    "general",
    {
      ko: "'이름: 민수, 역할: 검토자' 형식의 합성 문장을 이름과 역할 두 열의 표로 바꿔줘.",
      en: "Convert the synthetic text 'Name: Alex, Role: Reviewer' into a two-column table.",
      mixed: "'Name: Sample User, Role: Reviewer' synthetic text를 name/role two-column table로 바꿔줘.",
    },
    {
      ko: "서로 다른 세 {artifact}의 열 이름과 단위를 정규화하고 불일치 규칙을 해결한 뒤 통합 표, 변환 규칙표, 검증 결과를 만들어줘.",
      en: "Normalize column names and units across three {artifact} files, resolve conflicting rules, and produce a consolidated table, mapping table, and validation results.",
      mixed: "서로 다른 {artifact} 세 개의 column/unit을 normalize하고 conflicting rule을 resolve한 뒤 consolidated table, mapping, validation result를 만들어줘.",
    },
  ),
  task(
    "json_conversion",
    "general",
    {
      ko: "'상태=완료, 건수=3'을 `status`와 `count` 필드의 JSON으로 바꿔줘.",
      en: "Convert 'status=done, count=3' into JSON with `status` and `count` fields.",
      mixed: "'상태=done, 건수=3'을 `status`, `count` field의 JSON으로 convert해줘.",
    },
    {
      ko: "여러 버전의 {system} 응답을 하나의 JSON 스키마로 통합하고 누락·충돌 필드 처리, 하위 호환 변환, schema validation 테스트를 설계해줘.",
      en: "Unify multiple {system} response versions into one JSON schema and design missing/conflicting field handling, backward-compatible transforms, and schema-validation tests.",
      mixed: "여러 {system} response version을 single JSON schema로 통합하고 missing/conflicting field, backward compatibility transform, schema validation test를 설계해줘.",
    },
  ),
  task(
    "structured_data_processing",
    "reasoning",
    {
      ko: "쉼표로 구분된 '기획,개발,검토'를 문자열 배열로 바꿔줘.",
      en: "Convert the comma-separated text 'plan,build,review' into a string array.",
      mixed: "comma-separated 'plan,build,review'를 string array로 바꿔줘.",
    },
    {
      ko: "{domain}의 중첩 데이터에서 서로 다른 키 규칙을 해석하고 중복 엔터티를 병합한 뒤 참조 무결성과 집계값을 검증하는 처리 절차를 작성해줘.",
      en: "Interpret inconsistent key rules in nested {domain} data, merge duplicate entities, and define a process to verify referential integrity and aggregates.",
      mixed: "nested {domain} data의 inconsistent key rule을 해석하고 duplicate entity를 merge한 뒤 referential integrity와 aggregate를 verify하는 절차를 작성해줘.",
    },
  ),
  task(
    "file_processing",
    "general",
    {
      ko: "첨부한 합성 CSV에서 헤더 이름만 추출해줘.",
      en: "Extract only the header names from the attached synthetic CSV.",
      mixed: "attached synthetic CSV에서 header name만 extract해줘.",
    },
    {
      ko: "형식이 다른 {artifact} 파일들을 읽어 인코딩과 열 불일치를 해결하고 통합 파일, 오류 목록, 재실행 가능한 검증 스크립트를 만들어줘.",
      en: "Process differently formatted {artifact} files, resolve encoding and column mismatches, and produce a merged file, error inventory, and repeatable validation script.",
      mixed: "format이 다른 {artifact} files를 읽고 encoding/column mismatch를 resolve해서 merged file, error inventory, repeatable validation script를 만들어줘.",
    },
  ),
  task(
    "multi_document_comparison",
    "reasoning",
    {
      ko: "두 합성 안내문에서 날짜가 같은지만 확인해줘.",
      en: "Check only whether the dates match in two synthetic notices.",
      mixed: "synthetic notice 두 개의 date가 same인지 여부만 확인해줘.",
    },
    {
      ko: "{domain} 문서 네 건을 비교해 공통 주장, 상충 근거, 적용 범위, 누락 위험을 추적하고 신뢰도별 결론과 추가 조사 계획을 작성해줘.",
      en: "Compare four {domain} documents, trace shared claims, conflicting evidence, scope, and missing risks, then write confidence-graded conclusions and a follow-up plan.",
      mixed: "{domain} docs 네 건을 compare해서 shared claim, conflicting evidence, scope, missing risk를 trace하고 confidence별 conclusion과 follow-up plan을 작성해줘.",
    },
  ),
  task(
    "business_report",
    "general",
    {
      ko: "{period} {metric}이 5% 증가했다는 한 문단짜리 업무 보고를 작성해줘.",
      en: "Write a one-paragraph business update stating that {metric} increased by 5% {period}.",
      mixed: "{period} {metric}이 5 percent 증가했다는 one-paragraph business update를 작성해줘.",
    },
    {
      ko: "{domain}의 {period} 실적을 목표·전기·세그먼트와 비교하고 원인, 위험, 재무 영향, 다음 행동, 검증 지표가 포함된 경영 보고서를 작성해줘.",
      en: "Compare {period} {domain} performance with targets, prior periods, and segments, then write an executive report covering causes, risks, financial impact, actions, and validation metrics.",
      mixed: "{domain} {period} performance를 target/prior period/segment와 compare하고 cause, risk, financial impact, next action, validation metric이 있는 executive report를 작성해줘.",
    },
  ),
  task(
    "internal_document_query",
    "general",
    {
      ko: "{artifact}에서 승인권자 직급 한 항목만 찾아줘.",
      en: "Find the single approver-level field in the {artifact}.",
      mixed: "{artifact}에서 approver level 한 항목만 찾아줘.",
    },
    {
      ko: "{domain}의 현행 규정, 과거 예외 승인, 관련 절차서를 함께 검토해 이 사례의 허용 여부를 판단하고 근거 조항과 불확실성을 정리해줘.",
      en: "Review the current policy, prior exception approvals, and procedure for {domain}, determine whether this case is allowed, and summarize governing clauses and uncertainty.",
      mixed: "{domain} current policy, prior exception approval, procedure를 함께 review해서 case 허용 여부를 판단하고 governing clause와 uncertainty를 정리해줘.",
    },
  ),
];

const SIMPLE_BOUNDARY_TYPES = [
  ["code_present_simple", "code_explanation", "코드 한 줄의 반환값만 읽어줘: `const active = true;`", "Read only the returned value in this one-line code: `const active = true;`", "one-line code의 return value만 읽어줘: `const active = true;`"],
  ["long_simple", "translation", "아래 긴 합성 안내문은 해석하거나 줄이지 말고 문장 순서 그대로 영어로 번역해줘. 일정, 담당자, 승인 상태, 배포 창구, 문의 경로가 차례로 적혀 있으며 모든 항목은 가상의 업무 예시다.", "Translate the following long synthetic notice into Korean without analysis or summarization, preserving sentence order, dates, owner, approval state, release window, and support path.", "아래 long synthetic notice를 analyze하거나 summarize하지 말고 sentence order 그대로 English로 translate해줘."],
  ["technical_terms_simple", "general_query", "E5 embedding, PCA projection, ONNX runtime이라는 용어를 알파벳순으로 정렬해줘.", "Sort the terms E5 embedding, PCA projection, and ONNX runtime alphabetically.", "E5 embedding, PCA projection, ONNX runtime terms를 alphabetical order로 sort해줘."],
  ["many_constraints_mechanical_simple", "json_conversion", "값을 JSON으로 바꾸되 키는 두 개, 소문자, 공백 없음, 숫자는 정수, 키 순서는 status 다음 count, 설명은 쓰지 마: 상태=완료, 건수=3.", "Convert to JSON with exactly two lowercase keys, no spaces, integer count, status before count, and no explanation: status=done, count=3.", "status=done, count=3을 JSON으로 convert하되 two lowercase keys, no spaces, integer, status-first, no explanation."],
  ["long_document_translation_simple", "translation", "첨부한 긴 합성 문서를 요약·평가하지 말고 문단과 목록 구조를 유지해 그대로 번역해줘.", "Translate the attached long synthetic document verbatim while preserving paragraphs and lists; do not summarize or evaluate it.", "attached long synthetic document를 summarize/evaluate하지 말고 paragraph와 list structure 유지해서 translate해줘."],
  ["long_document_format_simple", "table_conversion", "긴 합성 문서의 문장을 바꾸지 말고 제목과 본문 두 열의 표로 옮겨줘.", "Move the long synthetic document into a title/body table without changing its sentences.", "long synthetic document 내용을 바꾸지 말고 title/body two-column table로 옮겨줘."],
  ["single_task_long_context_simple", "summarization", "배경 설명과 참고 문단이 길어도 요청은 하나야. 마지막 문단의 첫 문장만 그대로 추출해줘.", "The context is long, but the task is single: extract only the first sentence of the final paragraph.", "context가 길어도 single task야. final paragraph의 first sentence만 extract해줘."],
  ["independent_steps_simple", "structured_data_processing", "세 단어를 소문자로 바꾸고, 세 숫자를 오름차순으로 정렬하고, 날짜 표기의 슬래시를 하이픈으로 바꿔줘. 각 작업은 서로 독립적이야.", "Lowercase three words, sort three numbers, and replace slashes in a date with hyphens; the operations are independent.", "three words lowercase, three numbers ascending sort, date slash를 hyphen으로 convert해줘. steps are independent."],
  ["json_output_simple", "json_conversion", "완료라는 값을 `status` 필드 하나의 JSON으로 출력해줘.", "Return the value done as JSON with a single `status` field.", "완료 값을 single `status` field JSON으로 output해줘."],
  ["file_simple_extraction", "file_processing", "첨부한 합성 파일에서 첫 번째 열의 이름만 알려줘.", "Return only the name of the first column in the attached synthetic file.", "attached synthetic file에서 first column name만 알려줘."],
  ["search_simple_fact", "search", "웹에서 올해 첫 월요일의 날짜 하나만 찾아 출처와 함께 알려줘.", "Look up the date of the first Monday this year and cite one source.", "web에서 this year first Monday date 하나만 찾아 source와 알려줘."],
  ["long_answer_simple", "fact_explanation", "사내 약어 목록 30개를 주어진 순서대로 풀어 써줘. 판단이나 비교는 하지 마.", "Expand 30 internal abbreviations in the given order without judgment or comparison.", "internal abbreviation 30개를 given order대로 expand해줘. judgment/comparison은 하지 마."],
  ["long_input_copy_simple", "document_writing", "아래 긴 합성 원문을 수정하지 말고 그대로 복사해 코드 블록 하나에 넣어줘.", "Copy the long synthetic source unchanged into one code block.", "아래 long synthetic source를 edit하지 말고 one code block에 그대로 copy해줘."],
].map(([id, taskType, ko, en, mixed]) => ({ id, label: "simple", taskType, templates: { ko, en, mixed } }));

const COMPLEX_BOUNDARY_TYPES = [
  ["no_code_complex", "planning", "코드 없이 설명된 조직 개편안의 숨은 의존성과 실패 경로를 찾아 실행 순서와 중단 기준을 설계해줘.", "Without code, infer hidden dependencies and failure paths in the reorganization proposal and design an execution order and stop criteria.", "code 없는 reorganization proposal의 hidden dependency와 failure path를 추론해서 execution order와 stop criteria를 설계해줘."],
  ["short_complex", "math_problem", "이 증명이 순환 논증인지 판정하고 반례 가능성까지 확인해줘.", "Determine whether this proof is circular and check whether a counterexample can exist.", "이 proof가 circular인지 판단하고 counterexample 가능성까지 check해줘."],
  ["everyday_language_complex", "comparison_evaluation", "평범해 보이는 두 선택지 중 나중에 되돌리기 더 어려운 쪽을 숨은 전제까지 따져 골라줘.", "Choose which ordinary-looking option is harder to reverse after examining hidden assumptions.", "평범한 two options 중 harder-to-reverse one을 hidden assumption까지 따져 골라줘."],
  ["few_constraints_deep_complex", "fact_explanation", "이 결과가 우연이 아니라는 결론이 정당한지 판단해줘.", "Judge whether it is justified to conclude that this result is not due to chance.", "이 result가 chance가 아니라는 conclusion이 justified인지 판단해줘."],
  ["implicit_multistep_complex", "internal_document_query", "이 예외 승인이 선례가 될 수 있는지 판단해줘.", "Determine whether this exception approval can establish a precedent.", "이 exception approval이 precedent가 될 수 있는지 판단해줘."],
  ["no_output_format_complex", "data_analysis", "관측된 개선이 실제 정책 효과인지 계절성과 선택 편향을 분리해 판단해줘.", "Determine whether the observed improvement is a real policy effect after separating seasonality and selection bias.", "observed improvement가 real policy effect인지 seasonality와 selection bias를 분리해 판단해줘."],
  ["no_file_expert_analysis", "legal", "자료 첨부 없이 제시된 계약 상황에서 상충 의무와 관할 위험을 분석하고 추가로 필요한 증거를 정해줘.", "Analyze conflicting duties and jurisdiction risk in the described contract scenario and identify additional evidence needed, without relying on an attachment.", "attachment 없이 contract scenario의 conflicting duty와 jurisdiction risk를 분석하고 필요한 evidence를 정해줘."],
  ["no_search_logical_complex", "reasoning", "외부 검색 없이 세 진술이 동시에 참일 수 있는지 논리 모형을 세워 판정해줘.", "Without external search, build a logical model and decide whether all three statements can be true simultaneously.", "external search 없이 three statements가 동시에 true인지 logical model로 판정해줘."],
].map(([id, taskType, ko, en, mixed]) => ({ id, label: "complex", taskType, templates: { ko, en, mixed } }));

const STYLES = [
  "standard",
  "polite",
  "imperative",
  "interrogative",
  "request_form",
  "conversational",
  "informal",
  "abbreviated",
  "messenger",
  "typo",
  "spacing_error",
  "long_explanation",
  "keyword_list",
  "compound_command",
  "technical",
  "incomplete",
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pick(values, index) {
  return values[((index % values.length) + values.length) % values.length];
}

function contextFor(index, domain) {
  const artifact = pick(CONTEXTS.artifacts, index * 5 + 1);
  const period = pick(CONTEXTS.periods, index * 7 + 2);
  const audience = pick(CONTEXTS.audiences, index * 11 + 3);
  const metric = pick(CONTEXTS.metrics, index * 13 + 4);
  const system = pick(CONTEXTS.systems, index * 17 + 5);
  const initiative = CONTEXTS.initiatives[index % CONTEXTS.initiatives.length];
  const region = CONTEXTS.regions[
    Math.floor(index / CONTEXTS.initiatives.length) % CONTEXTS.regions.length
  ];
  const channel = CONTEXTS.channels[
    Math.floor(index / (CONTEXTS.initiatives.length * CONTEXTS.regions.length)) % CONTEXTS.channels.length
  ];
  return {
    domain,
    artifact,
    period,
    audience,
    metric,
    system,
    initiative,
    region,
    channel,
  };
}

function variablesFor(context, language) {
  const languageIndex = language === "en" ? 1 : 0;
  return {
    domain: language === "en" ? context.domain.en : context.domain.ko,
    artifact: context.artifact[languageIndex],
    period: context.period[languageIndex],
    audience: context.audience[languageIndex],
    metric: context.metric[languageIndex],
    system: context.system[languageIndex],
    scenario: `${context.region[languageIndex]} ${context.channel[languageIndex]} ${context.initiative[languageIndex]}`,
  };
}

function interpolate(template, variables) {
  return template.replace(/\{([a-z]+)\}/g, (_, name) => variables[name] ?? `{${name}}`);
}

function stylePrompt(base, style, language, context, label) {
  const v = variablesFor(context, language);
  const background = language === "en"
    ? `Context: this is a synthetic ${v.domain} scenario for ${v.audience} during ${v.period}.`
    : language === "mixed"
      ? `Context: ${v.period} ${v.domain} synthetic scenario이고 audience는 ${v.audience}야.`
      : `배경: ${v.period} ${v.domain}에서 ${v.audience}가 사용하는 합성 업무 사례다.`;
  const wrappers = {
    standard: () => base,
    polite: () => language === "en" ? `Please help with this request. ${base}` : `업무 요청드립니다. ${base}`,
    imperative: () => language === "en" ? `Do this now: ${base}` : `다음 작업을 수행해: ${base}`,
    interrogative: () => language === "en" ? `Could you handle this? ${base}` : `${base} 가능할까요?`,
    request_form: () => language === "en" ? `I would like to request the following. ${base}` : `아래 내용으로 부탁드립니다. ${base}`,
    conversational: () => language === "en" ? `I am checking one thing. ${base}` : `하나만 확인하려고 해. ${base}`,
    informal: () => language === "en" ? `Can you sort this out? ${base}` : `이거 좀 해줘. ${base}`,
    abbreviated: () => language === "en" ? `Quick req: ${base}` : `요청 요약: ${base}`,
    messenger: () => language === "en" ? `Quick ping — ${base}` : `급해요! ${base}`,
    typo: () => language === "en" ? `Plz check this. ${base.replace(/the /i, "teh ")}` : `이거 확인해죠. ${base}`,
    spacing_error: () => language === "en" ? `No extra spacing needed. ${base}` : `띄어쓰기조금틀려도돼. ${base}`,
    long_explanation: () => `${background}\n\n${language === "en" ? "Request" : "요청"}: ${base}\n${language === "en" ? "Use only the synthetic context above." : "위 합성 맥락만 사용해줘."}`,
    keyword_list: () => language === "en" ? `Keywords: ${v.domain}, ${v.artifact}, ${v.period}. Request: ${base}` : `키워드: ${v.domain}, ${v.artifact}, ${v.period}. 요청: ${base}`,
    compound_command: () => language === "en" ? `${base} Complete the requested output and check that its format is readable.` : `${base} 요청한 결과를 만들고 형식이 읽기 쉬운지만 확인해줘.`,
    technical: () => language === "en" ? `Technical work item for ${v.domain}: ${base}` : `${v.domain} technical work item이야. ${base}`,
    incomplete: () => language === "en" ? `Same synthetic context as above... ${base}` : `위 합성 맥락 기준으로… ${base}`,
  };
  const prompt = wrappers[style]();
  if (label === "simple" && style === "compound_command") {
    return prompt.replace("확인해줘.", "기계적으로 확인해줘.").replace("check that", "mechanically check that");
  }
  return prompt;
}

function longSyntheticContext(context, language, label, groupIndex) {
  const v = variablesFor(context, language);
  const rows = Array.from({ length: 14 }, (_, index) => {
    const sequence = String(index + 1).padStart(2, "0");
    const fingerprint = sha256(`long-context:${GENERATION_SEED}:${groupIndex}:${index}`);
    const markers = Array.from({ length: 6 }, (__, markerIndex) =>
      `ref-${fingerprint.slice(markerIndex * 6, markerIndex * 6 + 6)}`).join(" ");
    if (language === "en") {
      return `Reference ${sequence} (${markers}): synthetic ${v.domain} entry ${groupIndex + 1}-${sequence} records a fictional ${v.artifact} checkpoint for ${v.period}, ${v.audience}, ${v.metric}, and ${v.scenario}; it contains no real person, credential, or organization data.`;
    }
    if (language === "mixed") {
      return `Reference ${sequence} (${markers}): synthetic ${v.domain} entry ${groupIndex + 1}-${sequence}는 ${v.period}, ${v.audience}, ${v.metric}, ${v.scenario}의 fictional ${v.artifact} checkpoint이며 real person, credential, organization data는 없다.`;
    }
    return `참고 ${sequence} (${markers}): 합성 ${v.domain} 항목 ${groupIndex + 1}-${sequence}에는 ${v.period}, ${v.audience}, ${v.metric}, ${v.scenario}에 관한 가상의 ${v.artifact} 점검 기록이 있으며 실제 사람·자격 증명·조직 정보는 없다.`;
  });
  const instruction = label === "simple"
    ? language === "en"
      ? "The long reference block is included to test input-length robustness. Do not infer additional tasks from it; perform only the single direct operation requested above."
      : language === "mixed"
        ? "아래 long reference block은 input-length robustness 확인용이야. 추가 task를 추론하지 말고 위의 single direct operation만 수행해줘."
        : "아래 긴 참고 블록은 입력 길이 강건성 확인용이다. 추가 작업을 추론하지 말고 위에서 요청한 단일 직접 작업만 수행해줘."
    : language === "en"
      ? "Use the synthetic evidence below when carrying out the requested dependent analysis and validation."
      : language === "mixed"
        ? "아래 synthetic evidence를 사용해 요청된 dependent analysis와 validation을 수행해줘."
        : "아래 합성 근거를 사용해 요청된 의존적 분석과 검증을 수행해줘.";
  return `${instruction}\n${rows.join("\n")}`;
}

function structureFor(style) {
  if (style === "long_explanation") return "multi_paragraph";
  if (style === "keyword_list") return "keyword_list";
  if (["compound_command", "technical"].includes(style)) return "multi_sentence";
  return "single_sentence";
}

function taskById(taskType) {
  const found = TASKS.find((entry) => entry.id === taskType);
  if (found) return found;
  if (taskType === "legal") return TASKS.find((entry) => entry.id === "internal_document_query");
  if (taskType === "reasoning") return TASKS.find((entry) => entry.id === "comparison_evaluation");
  throw new Error(`unknown task type: ${taskType}`);
}

function featureMetadata(taskDefinition, label, boundaryType = null, redactedPrompt = "") {
  const toolTasks = new Set(["search", "rag_query", "file_processing"]);
  const verificationTasks = new Set([
    "code_review",
    "debugging",
    "data_analysis",
    "math_problem",
    "comparison_evaluation",
    "structured_data_processing",
    "file_processing",
  ]);
  let taskStepCount = label === "simple" ? 1 : 3;
  let constraintCount = label === "simple" ? 1 : 4;
  let reasoningLevel = label === "simple" ? "low" : "high";
  let hasCode = /```|`(?:const|let|var|return|[a-zA-Z_]+\s*=)[^`]*`/.test(redactedPrompt);
  let hasFile = /(?:첨부|attached|\bfiles?\b|파일)/i.test(redactedPrompt);
  let toolRequired = toolTasks.has(taskDefinition.id);
  let verificationRequired = label === "complex" && verificationTasks.has(taskDefinition.id);

  if (boundaryType) {
    if (boundaryType.id === "code_present_simple") hasCode = true;
    if (boundaryType.id === "search_simple_fact") toolRequired = true;
    if (boundaryType.id === "many_constraints_mechanical_simple") {
      constraintCount = 6;
      reasoningLevel = "low";
    }
    if (boundaryType.id === "independent_steps_simple") taskStepCount = 3;
    if (["few_constraints_deep_complex", "short_complex"].includes(boundaryType.id)) constraintCount = 1;
    if (boundaryType.id === "implicit_multistep_complex") taskStepCount = 3;
    if (["no_search_logical_complex", "no_output_format_complex", "no_file_expert_analysis"].includes(boundaryType.id)) {
      toolRequired = false;
    }
    verificationRequired = label === "complex";
  }

  return {
    reasoning_level: reasoningLevel,
    task_step_count: taskStepCount,
    constraint_count: constraintCount,
    has_code: hasCode,
    has_file: hasFile,
    tool_required: toolRequired,
    verification_required: verificationRequired,
  };
}

function labelReason(label, boundaryType = null) {
  if (boundaryType) {
    return label === "simple"
      ? "Counterexample with surface complexity but a deterministic, non-dependent operation."
      : "Counterexample with a short or ordinary surface form that still requires dependent analysis and validation.";
  }
  return label === "simple"
    ? "One direct task with low reasoning, limited constraints, and no dependent verification."
    : "Multiple dependent reasoning steps, constraints, context integration, or verification are required.";
}

function makeRecord({
  source,
  split,
  groupId,
  recordIndex,
  groupIndex,
  label,
  language,
  taskDefinition,
  domain,
  context,
  boundaryType = null,
  forceLong = false,
}) {
  const style = pick(STYLES, groupIndex * 3 + recordIndex);
  const request = boundaryType
    ? interpolate(boundaryType.templates[language], variablesFor(context, language))
    : interpolate(taskDefinition[label][language], variablesFor(context, language));
  const scenario = variablesFor(context, language).scenario;
  const caseFingerprint = sha256(`synthetic-case:${GENERATION_SEED}:${source}:${groupIndex}`);
  const caseMarkers = Array.from({ length: 4 }, (_, index) =>
    `case-${caseFingerprint.slice(index * 6, index * 6 + 6)}`).join(" ");
  const base = language === "en"
    ? `For the synthetic ${scenario} case (${caseMarkers}): ${request}`
    : language === "mixed"
      ? `synthetic ${scenario} case (${caseMarkers}) 기준이야. ${request}`
      : `가상의 ${scenario} 사례(${caseMarkers})를 기준으로 해줘. ${request}`;
  const styledPrompt = stylePrompt(base, style, language, context, label);
  const redactedPrompt = forceLong
    ? `${styledPrompt}\n\n${longSyntheticContext(context, language, label, groupIndex)}`
    : styledPrompt;
  const prefix = source === "synthetic" ? "syn" : "bnd";
  const sampleId = `${prefix}_${String(groupIndex + 1).padStart(4, "0")}_${label}_${String(recordIndex + 1).padStart(2, "0")}`;
  return {
    schema_version: RECORD_SCHEMA_VERSION,
    dataset_version: DATASET_VERSION,
    sample_id: sampleId,
    redacted_prompt: redactedPrompt,
    automatic_label: label,
    label,
    expected_category: taskDefinition.category,
    task_type: taskDefinition.id,
    service_domain: domain.id,
    language,
    source,
    boundary_case: source === "boundary",
    counterexample_type: boundaryType?.id ?? null,
    label_source: "synthetic_design",
    label_confidence: boundaryType ? 0.82 : 0.92,
    label_reason: labelReason(label, boundaryType),
    human_reviewed: false,
    review_status: "pending",
    group_id: groupId,
    split,
    expression_style: style,
    prompt_structure: forceLong ? "multi_paragraph" : structureFor(style),
    length_bucket: lengthBucket(redactedPrompt),
    ...featureMetadata(taskDefinition, label, boundaryType, redactedPrompt),
  };
}

const SYNTHETIC_QUOTAS = {
  train: {
    ko: { simple: 490, complex: 490 },
    en: { simple: 8, complex: 9 },
    mixed: { simple: 27, complex: 26 },
  },
  validation: {
    ko: { simple: 105, complex: 105 },
    en: { simple: 2, complex: 2 },
    mixed: { simple: 6, complex: 5 },
  },
  test: {
    ko: { simple: 105, complex: 105 },
    en: { simple: 2, complex: 2 },
    mixed: { simple: 5, complex: 6 },
  },
};

const ENTERPRISE_TASK_TARGETS_PER_LABEL = Object.fromEntries(
  TASKS.map(({ id }) => [
    id,
    new Set(["fact_explanation", "general_query", "math_problem", "structured_data_processing", "planning"]).has(id)
      ? 15
      : new Set(["document_writing", "summarization", "code_generation", "comparison_evaluation", "search"]).has(id)
        ? 155
        : 208,
  ]),
);

const ENTERPRISE_DOMAIN_TARGETS_PER_LABEL = Object.fromEntries(
  DOMAINS.map(({ id }, index) => [id, id === "corporate_operations" ? 45 : index < 21 ? 180 : 179]),
);

function dimensionCounts(records, label, field) {
  const counts = Object.fromEntries((field === "task_type" ? TASKS : DOMAINS).map(({ id }) => [id, 0]));
  for (const record of records) {
    if (record.label === label) counts[record[field]] += 1;
  }
  return counts;
}

function chooseByDeficit(definitions, counts, targets, salt) {
  return [...definitions].sort((left, right) => {
    const deficitDifference = (targets[right.id] - counts[right.id]) - (targets[left.id] - counts[left.id]);
    if (deficitDifference) return deficitDifference;
    return sha256(`${GENERATION_SEED}:${salt}:${left.id}`).localeCompare(
      sha256(`${GENERATION_SEED}:${salt}:${right.id}`),
    );
  })[0];
}

const BOUNDARY_RECORD_QUOTAS = {
  train: {
    simple: { ko: 630, en: 36, mixed: 34 },
    complex: { ko: 630, en: 34, mixed: 36 },
  },
  validation: {
    simple: { ko: 133, en: 8, mixed: 7 },
    complex: { ko: 137, en: 7, mixed: 8 },
  },
  test: {
    simple: { ko: 137, en: 8, mixed: 7 },
    complex: { ko: 133, en: 7, mixed: 8 },
  },
};

const BOUNDARY_GROUP_SHAPES = {
  train: [...Array(174).fill({ simple: 4, complex: 4 }), { simple: 2, complex: 2 }, { simple: 2, complex: 2 }],
  validation: [...Array(36).fill({ simple: 4, complex: 4 }), { simple: 2, complex: 6 }, { simple: 2, complex: 2 }],
  test: [...Array(36).fill({ simple: 4, complex: 4 }), { simple: 6, complex: 2 }, { simple: 2, complex: 2 }],
};

function shuffledLanguagePool(quotas, salt) {
  const rows = [];
  for (const language of LANGUAGES) {
    for (let index = 0; index < quotas[language]; index += 1) {
      rows.push({ language, index });
    }
  }
  return rows
    .sort((left, right) =>
      sha256(`${GENERATION_SEED}:${salt}:${left.language}:${left.index}`).localeCompare(
        sha256(`${GENERATION_SEED}:${salt}:${right.language}:${right.index}`),
      ),
    )
    .map(({ language }) => language);
}

function buildSyntheticRecords(boundaryRecords) {
  const records = [];
  let groupIndex = 0;
  const labelCounters = { simple: 0, complex: 0 };
  const taskCounts = Object.fromEntries(
    LABELS.map((label) => [label, dimensionCounts(boundaryRecords, label, "task_type")]),
  );
  const domainCounts = Object.fromEntries(
    LABELS.map((label) => [label, dimensionCounts(boundaryRecords, label, "service_domain")]),
  );
  for (const split of SPLITS) {
    for (const language of LANGUAGES) {
      for (const label of LABELS) {
        const groupCount = SYNTHETIC_QUOTAS[split][language][label];
        for (let cellIndex = 0; cellIndex < groupCount; cellIndex += 1) {
          const labelIndex = labelCounters[label];
          labelCounters[label] += 1;
          const taskDefinition = chooseByDeficit(
            TASKS,
            taskCounts[label],
            ENTERPRISE_TASK_TARGETS_PER_LABEL,
            `${label}:task:${labelIndex}`,
          );
          const domain = chooseByDeficit(
            DOMAINS,
            domainCounts[label],
            ENTERPRISE_DOMAIN_TARGETS_PER_LABEL,
            `${label}:domain:${labelIndex}`,
          );
          taskCounts[label][taskDefinition.id] += 4;
          domainCounts[label][domain.id] += 4;
          const context = contextFor(groupIndex, domain);
          const groupId = `enterprise.synthetic.g${String(groupIndex + 1).padStart(4, "0")}`;
          for (let recordIndex = 0; recordIndex < 4; recordIndex += 1) {
            records.push(
              makeRecord({
                source: "synthetic",
                split,
                groupId,
                recordIndex,
                groupIndex,
                label,
                language,
                taskDefinition,
                domain,
                  context,
                  forceLong: labelIndex < 200,
                }),
            );
          }
          groupIndex += 1;
        }
      }
    }
  }
  return records;
}

function buildBoundaryRecords() {
  const records = [];
  let groupIndex = 0;
  for (const split of SPLITS) {
    const pools = Object.fromEntries(
      LABELS.map((label) => [
        label,
        shuffledLanguagePool(BOUNDARY_RECORD_QUOTAS[split][label], `${split}:${label}`),
      ]),
    );
    const offsets = { simple: 0, complex: 0 };
    for (const shape of BOUNDARY_GROUP_SHAPES[split]) {
      const domain = DOMAINS[groupIndex % DOMAINS.length];
      const context = contextFor(1500 + groupIndex, domain);
      const groupId = `enterprise.boundary.g${String(groupIndex + 1).padStart(4, "0")}`;
      const boundaryByLabel = {
        simple: SIMPLE_BOUNDARY_TYPES[groupIndex % SIMPLE_BOUNDARY_TYPES.length],
        complex: COMPLEX_BOUNDARY_TYPES[groupIndex % COMPLEX_BOUNDARY_TYPES.length],
      };
      let localRecordIndex = 0;
      for (const label of LABELS) {
        const boundaryType = boundaryByLabel[label];
        const taskDefinition = taskById(boundaryType.taskType);
        for (let index = 0; index < shape[label]; index += 1) {
          const language = pools[label][offsets[label]];
          offsets[label] += 1;
          records.push(
            makeRecord({
              source: "boundary",
              split,
              groupId,
              recordIndex: localRecordIndex,
              groupIndex,
              label,
              language,
              taskDefinition,
              domain,
              context,
              boundaryType,
            }),
          );
          localRecordIndex += 1;
        }
      }
      groupIndex += 1;
    }
    for (const label of LABELS) {
      if (offsets[label] !== pools[label].length) {
        throw new Error(`${split}/${label}: unused boundary language assignments`);
      }
    }
  }
  return records;
}

function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = selector(record);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function groupBy(records, selector) {
  const groups = new Map();
  for (const record of records) {
    const key = selector(record);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  return groups;
}

function normalizePrompt(value) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, " ")
    .trim();
}

function tokenSet(value) {
  return new Set(normalizePrompt(value).split(" ").filter(Boolean));
}

function jaccard(left, right) {
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function findCrossGroupNearDuplicates(records, threshold = 0.94) {
  const candidateBuckets = groupBy(
    records,
    (record) => `${record.source}|${record.task_type}|${record.language}|${record.label}`,
  );
  const pairs = [];
  for (const bucket of candidateBuckets.values()) {
    const tokenized = bucket.map((record) => ({ record, tokens: tokenSet(record.redacted_prompt) }));
    for (let leftIndex = 0; leftIndex < tokenized.length; leftIndex += 1) {
      const left = tokenized[leftIndex];
      for (let rightIndex = leftIndex + 1; rightIndex < tokenized.length; rightIndex += 1) {
        const right = tokenized[rightIndex];
        if (left.record.group_id === right.record.group_id) continue;
        const sizeRatio = Math.min(left.tokens.size, right.tokens.size) / Math.max(left.tokens.size, right.tokens.size);
        if (sizeRatio < threshold) continue;
        const similarity = jaccard(left.tokens, right.tokens);
        if (similarity >= threshold) {
          pairs.push({
            left: left.record.sample_id,
            right: right.record.sample_id,
            similarity,
          });
          if (pairs.length >= 20) return pairs;
        }
      }
    }
  }
  return pairs;
}

function expectCounts(records, field, expected, failures) {
  const actual = countBy(records, (record) => record[field]);
  for (const [key, count] of Object.entries(expected)) {
    if (actual[key] !== count) failures.push(`${field}: expected ${key}=${count}, got ${actual[key] ?? 0}`);
  }
  const unexpected = Object.keys(actual).filter((key) => !(key in expected));
  if (unexpected.length > 0) failures.push(`${field}: unexpected values ${unexpected.join(", ")}`);
}

const REQUIRED_FIELDS = [
  "schema_version",
  "dataset_version",
  "sample_id",
  "redacted_prompt",
  "automatic_label",
  "label",
  "expected_category",
  "task_type",
  "service_domain",
  "language",
  "source",
  "boundary_case",
  "counterexample_type",
  "label_source",
  "label_confidence",
  "label_reason",
  "human_reviewed",
  "review_status",
  "group_id",
  "split",
  "expression_style",
  "prompt_structure",
  "length_bucket",
  "reasoning_level",
  "task_step_count",
  "constraint_count",
  "has_code",
  "has_file",
  "tool_required",
  "verification_required",
];

const FORBIDDEN_CONTENT_PATTERNS = [
  ["secret", /\bsk-[a-z0-9_-]{12,}\b/i],
  ["secret", /\b(?:api[_ -]?key|password|token)\s*[:=]\s*[^\s,;]+/i],
  ["authorization", /\bBearer\s+[a-z0-9._-]{8,}/i],
  ["email", /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i],
  ["phone", /\b01[016789]-\d{3,4}-\d{4}\b/],
  ["resident_id", /\b\d{6}-[1-4]\d{6}\b/],
  ["system_message", /^\s*(?:system|assistant|developer)\s*:/im],
  ["system_message", /<\/?system>/i],
];

export function validateRecords(records, { checkNearDuplicates = true } = {}) {
  const failures = [];
  if (records.length !== 8000) failures.push(`records: expected 8000, got ${records.length}`);
  if (new Set(records.map((record) => record.sample_id)).size !== records.length) {
    failures.push("sample_id values must be unique");
  }
  for (const record of records) {
    const missing = REQUIRED_FIELDS.filter((field) => !(field in record));
    if (missing.length > 0) failures.push(`${record.sample_id ?? "unknown"}: missing ${missing.join(", ")}`);
    if (record.schema_version !== RECORD_SCHEMA_VERSION) failures.push(`${record.sample_id}: invalid schema_version`);
    if (record.dataset_version !== DATASET_VERSION) failures.push(`${record.sample_id}: invalid dataset_version`);
    if (!record.redacted_prompt || typeof record.redacted_prompt !== "string") failures.push(`${record.sample_id}: empty redacted_prompt`);
    if (record.automatic_label !== record.label) failures.push(`${record.sample_id}: automatic_label/label mismatch`);
    if (record.human_reviewed !== false || record.review_status !== "pending") {
      failures.push(`${record.sample_id}: generated candidates must remain pending and unreviewed`);
    }
    if (record.boundary_case !== (record.source === "boundary")) {
      failures.push(`${record.sample_id}: boundary_case/source mismatch`);
    }
    if (record.source === "boundary" && !record.counterexample_type) {
      failures.push(`${record.sample_id}: boundary record requires counterexample_type`);
    }
    if (record.source === "synthetic" && record.counterexample_type !== null) {
      failures.push(`${record.sample_id}: synthetic record must have null counterexample_type`);
    }
    for (const [name, pattern] of FORBIDDEN_CONTENT_PATTERNS) {
      if (pattern.test(record.redacted_prompt)) failures.push(`${record.sample_id}: forbidden ${name} pattern`);
    }
    if (failures.length > 100) return failures;
  }

  expectCounts(records, "label", { simple: 4000, complex: 4000 }, failures);
  expectCounts(records, "language", { ko: 7400, en: 200, mixed: 400 }, failures);
  expectCounts(records, "source", { synthetic: 6000, boundary: 2000 }, failures);
  expectCounts(records, "split", { train: 5600, validation: 1200, test: 1200 }, failures);
  expectCounts(records, "boundary_case", { false: 6000, true: 2000 }, failures);

  const sourceLabelExpected = {
    synthetic: { simple: 3000, complex: 3000 },
    boundary: { simple: 1000, complex: 1000 },
  };
  for (const [source, expected] of Object.entries(sourceLabelExpected)) {
    expectCounts(records.filter((record) => record.source === source), "label", expected, failures);
  }
  const languageLabelExpected = {
    ko: { simple: 3700, complex: 3700 },
    en: { simple: 100, complex: 100 },
    mixed: { simple: 200, complex: 200 },
  };
  for (const [language, expected] of Object.entries(languageLabelExpected)) {
    expectCounts(records.filter((record) => record.language === language), "label", expected, failures);
  }
  const splitLabelExpected = {
    train: { simple: 2800, complex: 2800 },
    validation: { simple: 600, complex: 600 },
    test: { simple: 600, complex: 600 },
  };
  const splitLanguageExpected = {
    train: { ko: 5180, en: 138, mixed: 282 },
    validation: { ko: 1110, en: 31, mixed: 59 },
    test: { ko: 1110, en: 31, mixed: 59 },
  };
  for (const split of SPLITS) {
    const splitRecords = records.filter((record) => record.split === split);
    expectCounts(splitRecords, "label", splitLabelExpected[split], failures);
    expectCounts(splitRecords, "language", splitLanguageExpected[split], failures);
  }

  const groups = groupBy(records, (record) => record.group_id);
  for (const [groupId, groupRecords] of groups) {
    const splits = new Set(groupRecords.map((record) => record.split));
    if (splits.size !== 1) failures.push(`${groupId}: group leaks across splits`);
    const sources = new Set(groupRecords.map((record) => record.source));
    if (sources.size !== 1) failures.push(`${groupId}: group mixes sources`);
    if (groupRecords[0].source === "synthetic" && groupRecords.length !== 4) {
      failures.push(`${groupId}: synthetic group must contain four variants`);
    }
    if (groupRecords[0].source === "boundary") {
      if (![4, 8].includes(groupRecords.length)) failures.push(`${groupId}: invalid boundary group size`);
      const labels = countBy(groupRecords, (record) => record.label);
      if (!labels.simple || !labels.complex) failures.push(`${groupId}: boundary contrast group must contain both labels`);
    }
  }

  const taskCoverage = groupBy(records, (record) => record.task_type);
  const domainCoverage = groupBy(records, (record) => record.service_domain);
  if (taskCoverage.size !== TASKS.length) failures.push(`task_type coverage: expected ${TASKS.length}, got ${taskCoverage.size}`);
  if (domainCoverage.size !== DOMAINS.length) failures.push(`service_domain coverage: expected ${DOMAINS.length}, got ${domainCoverage.size}`);
  for (const [taskType, rows] of taskCoverage) {
    if (new Set(rows.map((record) => record.label)).size !== 2) failures.push(`${taskType}: both labels required`);
  }
  for (const [domain, rows] of domainCoverage) {
    if (new Set(rows.map((record) => record.label)).size !== 2) failures.push(`${domain}: both labels required`);
  }

  const boundaryTypes = new Set(records.filter((record) => record.boundary_case).map((record) => record.counterexample_type));
  const requiredBoundaryTypes = [...SIMPLE_BOUNDARY_TYPES, ...COMPLEX_BOUNDARY_TYPES].map((entry) => entry.id);
  for (const boundaryType of requiredBoundaryTypes) {
    if (!boundaryTypes.has(boundaryType)) failures.push(`missing boundary type ${boundaryType}`);
  }

  const exactPrompts = new Set(records.map((record) => record.redacted_prompt));
  if (exactPrompts.size !== records.length) failures.push("redacted_prompt exact duplicates found");
  const normalizedPrompts = new Set(records.map((record) => normalizePrompt(record.redacted_prompt)));
  if (normalizedPrompts.size !== records.length) failures.push("redacted_prompt normalized duplicates found");

  if (checkNearDuplicates) {
    const nearDuplicates = findCrossGroupNearDuplicates(records);
    if (nearDuplicates.length > 0) {
      failures.push(
        `cross-group near duplicates found: ${nearDuplicates
          .slice(0, 5)
          .map((pair) => `${pair.left}/${pair.right}=${pair.similarity.toFixed(3)}`)
          .join(", ")}`,
      );
    }
  }

  const longSimple = records.filter((record) => record.label === "simple" && record.length_bucket === "long").length;
  const shortComplex = records.filter((record) => record.label === "complex" && record.length_bucket === "short").length;
  if (longSimple === 0) failures.push("at least one long simple record is required");
  if (shortComplex === 0) failures.push("at least one short complex record is required");
  return failures;
}

function distributionSummary(records) {
  return {
    label: countBy(records, (record) => record.label),
    language: countBy(records, (record) => record.language),
    source: countBy(records, (record) => record.source),
    split: countBy(records, (record) => record.split),
    task_type: countBy(records, (record) => record.task_type),
    service_domain: countBy(records, (record) => record.service_domain),
    expression_style: countBy(records, (record) => record.expression_style),
    prompt_structure: countBy(records, (record) => record.prompt_structure),
    length_bucket: countBy(records, (record) => record.length_bucket),
    counterexample_type: countBy(
      records.filter((record) => record.counterexample_type !== null),
      (record) => record.counterexample_type,
    ),
  };
}

export function buildArtifacts() {
  const boundaryRecords = buildBoundaryRecords();
  const records = [...buildSyntheticRecords(boundaryRecords), ...boundaryRecords];
  const failures = validateRecords(records);
  if (failures.length > 0) throw new Error(`dataset validation failed:\n- ${failures.join("\n- ")}`);
  const datasetText = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const groups = groupBy(records, (record) => record.group_id);
  const manifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    dataset_version: DATASET_VERSION,
    record_schema_version: RECORD_SCHEMA_VERSION,
    record_schema_path: RECORD_SCHEMA_PATH,
    dataset_path: DATASET_PATH,
    dataset_sha256: sha256(datasetText),
    generated_at: CREATED_AT,
    generation_seed: GENERATION_SEED,
    scope: {
      initial_target_records: 15000,
      generated_records: 8000,
      deferred_public_records: 0,
      public_records: 0,
      training_eligible: false,
      training_blockers: [
        "standalone_component_not_complete_training_bundle",
        "llm_adjudication_not_completed",
        "human_review_not_completed",
      ],
    },
    counts: {
      records: records.length,
      groups: groups.size,
      synthetic_records: records.filter((record) => record.source === "synthetic").length,
      boundary_records: records.filter((record) => record.source === "boundary").length,
      human_reviewed_records: records.filter((record) => record.human_reviewed).length,
    },
    distributions: distributionSummary(records),
    coverage: {
      task_types: TASKS.length,
      service_domains: DOMAINS.length,
      boundary_types: SIMPLE_BOUNDARY_TYPES.length + COMPLEX_BOUNDARY_TYPES.length,
      every_task_type_has_both_labels: true,
      every_service_domain_has_both_labels: true,
      every_language_has_both_labels: true,
      long_simple_records: records.filter((record) => record.length_bucket === "long" && record.label === "simple").length,
      long_complex_records: records.filter((record) => record.length_bucket === "long" && record.label === "complex").length,
    },
    deduplication: {
      exact_duplicate_records: 0,
      normalized_duplicate_records: 0,
      cross_group_near_duplicate_pairs: 0,
      near_duplicate_method: "task-language-label bucketed normalized token Jaccard",
      near_duplicate_threshold: 0.94,
      within_group_variants_allowed: true,
    },
    review: {
      label_source: "synthetic_design",
      review_status: "pending",
      human_reviewed: false,
      production_gold: false,
    },
  };
  return {
    records,
    manifest,
    datasetText,
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
  };
}

export function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

export function verifyPersistedArtifacts(datasetText, manifest) {
  const records = parseJsonl(datasetText);
  const failures = validateRecords(records);
  if (manifest.schema_version !== MANIFEST_SCHEMA_VERSION) failures.push("manifest: invalid schema_version");
  if (manifest.dataset_version !== DATASET_VERSION) failures.push("manifest: invalid dataset_version");
  if (manifest.dataset_path !== DATASET_PATH) failures.push("manifest: invalid dataset_path");
  if (manifest.dataset_sha256 !== sha256(datasetText)) failures.push("manifest: dataset_sha256 mismatch");
  if (manifest.scope?.training_eligible !== false) failures.push("manifest: generated candidate must not be training eligible");
  if (manifest.counts?.records !== records.length) failures.push("manifest: record count mismatch");
  return failures;
}

export const DATASET_DIMENSIONS = {
  tasks: TASKS.map(({ id, category }) => ({ id, category })),
  domains: DOMAINS.map(({ id }) => id),
  simpleBoundaryTypes: SIMPLE_BOUNDARY_TYPES.map(({ id }) => id),
  complexBoundaryTypes: COMPLEX_BOUNDARY_TYPES.map(({ id }) => id),
  styles: STYLES,
};
