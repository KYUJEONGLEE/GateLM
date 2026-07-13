import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const outputPath = path.resolve(
  "docs/v2.1.0/fixtures/difficulty-evaluation-training-pilot-500.fixture.jsonl",
);
const splitManifestPath = path.resolve(
  "docs/v2.1.0/fixtures/difficulty-training-split-manifest.v1.json",
);

const datasetVersion = "difficulty_eval_2026_07_13_pilot_500_v1";
const createdAt = "2026-07-13T00:00:00Z";
const categories = ["general", "code", "translation", "summarization", "reasoning"];
const difficulties = ["simple", "complex"];

const cells = {
  "general/simple": {
    subjects: [
      ["ko", "서비스 점검 시간"],
      ["ko", "계정 이름 변경 위치"],
      ["ko", "배송 상태 표시 의미"],
      ["ko", "회의실 예약 취소 방법"],
      ["ko", "구독 만료일 확인 경로"],
      ["ko", "알림 소리 끄는 메뉴"],
      ["en", "the office Wi-Fi guest password policy"],
      ["en", "the location of the billing history page"],
      ["en", "the meaning of the yellow status icon"],
      ["mixed", "Dashboard의 usage badge 의미"],
    ],
    families: [
      {
        ko: "다음 항목을 한 문장으로 알려줘: {subject}.",
        en: "Explain {subject} in one sentence.",
        mixed: "{subject}를 one sentence로 알려줘.",
      },
      {
        ko: "{subject}만 짧게 안내해줘.",
        en: "Give me a brief answer about {subject}.",
        mixed: "{subject}만 short answer로 안내해줘.",
      },
      {
        ko: "처음 사용하는 사람에게 다음 항목을 설명해줘: {subject}.",
        en: "Explain {subject} to a first-time user.",
        mixed: "처음 쓰는 user에게 {subject}를 설명해줘.",
      },
      {
        boundary: true,
        ko: "배경 설명은 길게 하지 말고 {subject}에 대한 답만 줘. 관련 기능의 역사나 다른 메뉴와의 차이는 필요 없고 지금 사용자가 확인할 한 가지 내용만 말해줘.",
        en: "Skip the background, history, and related options; answer only the single question about {subject}.",
        mixed: "background와 history는 빼고 {subject}에 대한 single answer만 줘.",
      },
      {
        boundary: true,
        ko: "전문 용어가 포함되어 있어도 추가 분석은 하지 말고 {subject}의 뜻이나 위치만 그대로 알려줘.",
        en: "Even if the wording sounds technical, just state the meaning or location of {subject} without further analysis.",
        mixed: "technical term이어도 분석하지 말고 {subject}의 meaning이나 location만 알려줘.",
      },
    ],
  },
  "general/complex": {
    subjects: [
      ["ko", "신규 직원 온보딩"],
      ["ko", "배송 지연 고객 대응"],
      ["ko", "사무실 이전 준비"],
      ["ko", "구독 해지 후속 처리"],
      ["ko", "분기별 접근 권한 점검"],
      ["ko", "장애 공지와 복구 안내"],
      ["en", "a multi-region office closure response"],
      ["en", "an account recovery support workflow"],
      ["en", "a vendor onboarding and approval process"],
      ["mixed", "Enterprise plan의 renewal 운영 절차"],
    ],
    families: [
      {
        ko: "다음 업무를 준비, 실행, 확인 단계로 나누고 각 단계의 담당자와 완료 조건을 정해줘: {subject}.",
        en: "Break {subject} into preparation, execution, and verification, with an owner and completion condition for each stage.",
        mixed: "{subject}을 prepare, execute, verify 단계로 나누고 owner와 done condition을 정해줘.",
      },
      {
        ko: "{subject}에서 정상 경로와 두 가지 예외 상황을 구분하고 예외별 대응 순서와 중단 기준을 만들어줘.",
        en: "For {subject}, separate the normal path from two exception paths and define response order and stop conditions.",
        mixed: "{subject}의 happy path와 exception 두 개를 나누고 대응 order와 stop condition을 정해줘.",
      },
      {
        ko: "{subject}에 필요한 정보를 여러 부서 자료에서 모아 누락 항목을 찾고 실행 가능한 체크리스트로 통합해줘.",
        en: "Combine information from several teams for {subject}, identify missing items, and produce an actionable checklist.",
        mixed: "여러 team 자료에서 {subject} 정보를 합치고 missing item을 찾아 actionable checklist로 만들어줘.",
      },
      {
        boundary: true,
        ko: "{subject}: 승인 전이면 담당자를 확인하고, 승인 후면 완료 여부를 검사하며, 지연 중이면 고객 안내 후 재확인하는 절차를 짧게 설계해줘.",
        en: "Design a concise workflow for {subject}: check ownership before approval, verify completion after approval, and notify then recheck when delayed.",
        mixed: "{subject}: before approval은 owner 확인, after approval은 completion 검사, delayed면 notify 후 recheck하는 flow를 짧게 설계해줘.",
      },
      {
        boundary: true,
        ko: "다음 업무를 한 문단으로 답하되 준비 조건, 실패 시 대체 경로, 완료 검증 방법을 모두 포함해줘: {subject}.",
        en: "Answer in one paragraph, but include prerequisites, a fallback path, and completion verification for {subject}.",
        mixed: "{subject}을 one paragraph로 쓰되 prerequisite, fallback, completion check를 모두 포함해줘.",
      },
    ],
  },
  "code/simple": {
    subjects: [
      ["ko", "Go에서 문자열 앞뒤 공백을 제거하는 코드"],
      ["ko", "Python 리스트의 길이를 구하는 코드"],
      ["ko", "JavaScript 숫자를 문자열로 바꾸는 코드"],
      ["ko", "SQL에서 상위 다섯 행만 조회하는 문장"],
      ["ko", "Java에서 현재 시간이 비어 있는지 확인하는 조건문"],
      ["ko", "CSS 버튼 글자를 가운데 정렬하는 속성"],
      ["en", "a Rust function that adds two integers"],
      ["en", "a TypeScript type for an optional name"],
      ["en", "a Bash command that prints the working directory"],
      ["mixed", "Kotlin에서 nullable String을 확인하는 if문"],
    ],
    families: [
      {
        ko: "{subject} 예시 하나만 보여줘.",
        en: "Show one example of {subject}.",
        mixed: "{subject} example 하나만 보여줘.",
      },
      {
        ko: "추가 라이브러리 없이 다음 코드를 작성해줘: {subject}.",
        en: "Write {subject} without an external library.",
        mixed: "external library 없이 {subject}을 작성해줘.",
      },
      {
        ko: "설명은 한 줄로 하고 다음 코드를 보여줘: {subject}.",
        en: "Show {subject} with a one-line explanation.",
        mixed: "설명은 one line으로 하고 {subject}을 보여줘.",
      },
      {
        boundary: true,
        ko: "프로젝트 전체 구조나 성능 분석은 필요 없고 {subject} 한 조각만 정확한 문법으로 적어줘.",
        en: "Do not analyze architecture or performance; provide only {subject} with valid syntax.",
        mixed: "architecture나 performance 분석 없이 {subject} snippet만 valid syntax로 적어줘.",
      },
      {
        boundary: true,
        ko: "아래 요구는 기술 용어가 길지만 작업은 하나뿐이야. 가장 짧은 형태로 작성해줘: {subject}.",
        en: "The terminology is long, but this is one operation: write the shortest form of {subject}.",
        mixed: "technical wording은 길지만 single operation이야. {subject}을 shortest form으로 작성해줘.",
      },
    ],
  },
  "code/complex": {
    subjects: [
      ["ko", "동시 요청에서 중복 결제가 발생하는 서비스"],
      ["ko", "캐시 갱신 중 오래된 값이 되살아나는 모듈"],
      ["ko", "여러 파일에 흩어진 권한 검사 로직"],
      ["ko", "재시도와 타임아웃이 겹치는 작업 큐"],
      ["ko", "메모리 사용량이 계속 증가하는 스트림 처리기"],
      ["ko", "두 버전의 API를 함께 지원해야 하는 클라이언트"],
      ["en", "a distributed lock that occasionally admits two workers"],
      ["en", "a schema migration with rolling deployment compatibility"],
      ["en", "an event consumer that loses ordering during retries"],
      ["mixed", "multi-tenant cache의 key isolation 문제"],
    ],
    families: [
      {
        ko: "{subject}의 재현 조건과 가능한 원인을 좁히고 수정안과 회귀 테스트를 함께 설계해줘.",
        en: "Narrow the reproduction conditions and likely causes of {subject}, then design a fix and regression tests.",
        mixed: "{subject}의 reproduce condition과 root cause를 좁히고 fix와 regression test를 설계해줘.",
      },
      {
        ko: "다음 대상을 안전하게 리팩터링하되 기존 동작, 오류 처리, 성능 한도를 유지하는 단계별 계획을 작성해줘: {subject}.",
        en: "Create a staged refactor plan for {subject} while preserving behavior, error handling, and performance limits.",
        mixed: "{subject}을 staged refactor하되 behavior, error handling, performance limit을 유지해줘.",
      },
      {
        ko: "{subject}의 상태 전이와 경쟁 조건을 분석하고 실패 경로별 관측 지점과 테스트 경계를 제안해줘.",
        en: "Analyze state transitions and race conditions in {subject}, with observability points and test boundaries for each failure path.",
        mixed: "{subject}의 state transition과 race condition을 분석하고 failure path별 observability와 test boundary를 제안해줘.",
      },
      {
        boundary: true,
        ko: "{subject}: 무중단, 순서 보장, 중복 처리 방지. 원인과 수정 순서를 정해줘.",
        en: "For {subject}: require zero downtime, preserved ordering, and duplicate prevention; determine the cause and fix order.",
        mixed: "{subject}: zero downtime, ordering, deduplication을 만족하도록 root cause와 fix order를 정해줘.",
      },
      {
        boundary: true,
        ko: "다음 대상이 가끔만 실패한다. 로그를 늘릴 위치, 가설 검증 순서, 안전한 롤백 조건을 짧게 제시해줘: {subject}.",
        en: "{subject} fails intermittently; briefly specify instrumentation points, hypothesis order, and safe rollback conditions.",
        mixed: "{subject}이 intermittent하게 실패해. instrumentation, hypothesis order, safe rollback condition을 짧게 줘.",
      },
    ],
  },
  "translation/simple": {
    subjects: [
      ["ko", "'회의는 세 시에 시작합니다'를 영어로"],
      ["ko", "'문을 닫아 주세요'를 일본어로"],
      ["ko", "'배송이 완료되었습니다'를 영어로"],
      ["ko", "'오늘은 휴무입니다'를 중국어로"],
      ["ko", "'비밀번호를 다시 입력하세요'를 영어로"],
      ["ko", "'예약이 확정되었습니다'를 프랑스어로"],
      ["en", "'The package arrived safely' into Korean"],
      ["en", "'Please wait here' into Spanish"],
      ["en", "'The meeting was canceled' into German"],
      ["mixed", "'업데이트가 ready되었습니다'를 자연스러운 English로"],
    ],
    families: [
      {
        ko: "{subject} 번역해줘.",
        en: "Translate {subject}.",
        mixed: "{subject} translate해줘.",
      },
      {
        ko: "부연 설명 없이 {subject} 옮겨줘.",
        en: "Translate {subject} without an explanation.",
        mixed: "explanation 없이 {subject} translate해줘.",
      },
      {
        ko: "일반적인 표현으로 {subject} 번역해줘.",
        en: "Use ordinary wording to translate {subject}.",
        mixed: "normal wording으로 {subject} 번역해줘.",
      },
      {
        boundary: true,
        ko: "문장은 짧지만 따옴표와 문장부호는 그대로 두고 {subject} 번역해줘. 별도 현지화는 필요 없어.",
        en: "Translate {subject}, preserving quotation marks and punctuation; no localization is needed.",
        mixed: "quote와 punctuation은 유지하되 localization 없이 {subject} translate해줘.",
      },
      {
        boundary: true,
        ko: "여러 의미를 분석하지 말고 가장 흔한 뜻으로 {subject} 한 번만 번역해줘.",
        en: "Translate {subject} once using the most common meaning, without analyzing alternatives.",
        mixed: "alternative 분석 없이 common meaning으로 {subject} 한 번만 translate해줘.",
      },
    ],
  },
  "translation/complex": {
    subjects: [
      ["ko", "개인정보 처리방침의 정의와 예외 조항을 영어로"],
      ["ko", "의료기기 사용 안내와 경고 문구를 일본어로"],
      ["ko", "결제 약관의 의무 표현과 상호 참조를 영어로"],
      ["ko", "게임 캐릭터 대사의 말투와 말장난을 프랑스어로"],
      ["ko", "제품 UI 문자열과 치환 변수를 독일어로"],
      ["ko", "투자 보고서의 전문 용어와 표 제목을 영어로"],
      ["en", "a legal notice with defined terms into Korean"],
      ["en", "a clinical trial summary with dosage units into Japanese"],
      ["en", "a marketing campaign with culture-specific humor into Korean"],
      ["mixed", "API migration guide의 code token을 보존해 한국어로"],
    ],
    families: [
      {
        ko: "{subject} 번역하되 정의된 용어, 번호 체계, 상호 참조를 일관되게 보존해줘.",
        en: "Translate {subject} while preserving defined terms, numbering, and cross-references consistently.",
        mixed: "{subject} translate하되 defined term, numbering, cross-reference를 일관되게 보존해줘.",
      },
      {
        ko: "{subject} 옮기고 대상 독자에게 자연스럽게 현지화하되 법적·기술적 의미는 바꾸지 마.",
        en: "Translate and localize {subject} for the target audience without changing legal or technical meaning.",
        mixed: "{subject}를 target audience에 localize하되 legal/technical meaning은 바꾸지 마.",
      },
      {
        ko: "{subject} 번역에서 용어집을 적용하고 단위, 치환 변수, 서식을 유지한 뒤 애매한 표현을 표시해줘.",
        en: "Translate {subject} using a glossary, preserve units, placeholders, and formatting, and flag ambiguities.",
        mixed: "{subject}에 glossary를 적용하고 unit, placeholder, format을 보존한 뒤 ambiguity를 표시해줘.",
      },
      {
        boundary: true,
        ko: "{subject}: 톤 유지, 용어 통일, 변수 보존, 문화권에 맞는 표현까지 처리해줘.",
        en: "For {subject}, preserve tone, standardize terminology, retain variables, and adapt culture-specific wording.",
        mixed: "{subject}: tone, terminology, variable을 보존하고 culture-specific wording까지 처리해줘.",
      },
      {
        boundary: true,
        ko: "짧은 문구인 {subject} 번역이지만 규제 의미와 브랜드 말투가 모두 유지되도록 두 후보를 만들고 차이를 설명해줘.",
        en: "Although {subject} is short, produce two translations preserving regulatory meaning and brand voice, then explain the difference.",
        mixed: "짧은 {subject}지만 regulatory meaning과 brand voice를 유지한 두 translation과 차이를 줘.",
      },
    ],
  },
  "summarization/simple": {
    subjects: [
      ["ko", "공지: 정기 점검은 화요일 오전 두 시부터 세 시까지 진행됩니다"],
      ["ko", "회의 메모: 다음 회의는 금요일이며 장소는 3층 회의실입니다"],
      ["ko", "배송 안내: 상품은 오늘 출고되었고 도착 예정일은 목요일입니다"],
      ["ko", "업데이트 노트: 검색 버튼의 위치만 상단으로 변경되었습니다"],
      ["ko", "휴무 안내: 고객센터는 공휴일에 운영하지 않습니다"],
      ["ko", "신청 결과: 교육 참가 신청이 승인되었습니다"],
      ["en", "Notice: The library closes at 6 p.m. on Friday"],
      ["en", "Meeting note: The owner is Mina and the due date is Monday"],
      ["en", "Release note: Only the icon color changed in this update"],
      ["mixed", "공지: beta launch는 8월 1일이고 장소는 online입니다"],
    ],
    families: [
      {
        ko: "다음 내용의 핵심 한 가지를 한 문장으로 요약해줘: {subject}",
        en: "Summarize the single key point in one sentence: {subject}",
        mixed: "다음 내용의 key point 하나를 one sentence로 요약해줘: {subject}",
      },
      {
        ko: "다음 문장에서 날짜나 상태만 짧게 남겨줘: {subject}",
        en: "Keep only the date or status from this sentence: {subject}",
        mixed: "이 문장에서 date나 status만 짧게 남겨줘: {subject}",
      },
      {
        ko: "다음 짧은 공지를 제목처럼 줄여줘: {subject}",
        en: "Reduce this short notice to a title: {subject}",
        mixed: "이 short notice를 title처럼 줄여줘: {subject}",
      },
      {
        boundary: true,
        ko: "배경 문장이 더 있다고 가정해도 새로운 결론을 만들지 말고, 다음 내용에서 명시된 일정 하나만 요약해줘: {subject}",
        en: "Even if more background exists, infer nothing new and summarize only the explicit schedule: {subject}",
        mixed: "background가 더 있어도 inference 없이 explicit schedule 하나만 요약해줘: {subject}",
      },
      {
        boundary: true,
        ko: "표현은 업무 문서처럼 길지만 정보는 하나뿐이야. 다음 문장을 짧게 줄여줘: {subject}",
        en: "The wording is formal and long, but it contains one fact; shorten it: {subject}",
        mixed: "formal wording이지만 fact는 하나야. 다음을 short summary로 줄여줘: {subject}",
      },
    ],
  },
  "summarization/complex": {
    subjects: [
      ["ko", "세 팀의 장애 회고와 서로 다른 원인 분석"],
      ["ko", "분기별 사용자 인터뷰와 상충하는 개선 요청"],
      ["ko", "여러 회의의 결정 사항과 미지정 후속 작업"],
      ["ko", "정책 개정 전후 문서와 변경 근거"],
      ["ko", "두 공급업체 보고서의 비용과 위험 주장"],
      ["ko", "장기간 프로젝트 기록과 반복된 일정 변경"],
      ["en", "incident reports from three regions with conflicting timelines"],
      ["en", "multiple research notes with overlapping and contradictory findings"],
      ["en", "a quarter of meeting notes with decisions, owners, and unresolved risks"],
      ["mixed", "여러 sprint retro의 action item과 unresolved risk"],
    ],
    families: [
      {
        ko: "다음 자료를 중복 제거 후 결정, 근거, 미해결 충돌로 나누고 출처를 연결해 요약해줘: {subject}.",
        en: "Deduplicate {subject}, summarize decisions, evidence, and unresolved conflicts, and retain source links.",
        mixed: "{subject}을 deduplicate하고 decision, evidence, unresolved conflict로 나눠 source를 연결해줘.",
      },
      {
        ko: "{subject}에서 공통 흐름과 예외를 종합하고 담당자, 일정, 위험, 후속 조치를 빠짐없이 정리해줘.",
        en: "Synthesize common patterns and exceptions in {subject}, including owners, dates, risks, and follow-ups.",
        mixed: "{subject}의 common pattern과 exception을 합치고 owner, date, risk, follow-up을 정리해줘.",
      },
      {
        ko: "{subject}의 시간 순서를 재구성하고 서로 모순되는 진술을 표시한 뒤 경영진용 요약과 근거 목록을 만들어줘.",
        en: "Reconstruct the timeline of {subject}, flag contradictions, and produce an executive summary with evidence references.",
        mixed: "{subject} timeline을 재구성하고 contradiction을 표시한 뒤 executive summary와 evidence reference를 만들어줘.",
      },
      {
        boundary: true,
        ko: "{subject}: 합의점, 충돌점, 주인 없는 작업, 근거 출처를 한 화면에 요약해줘.",
        en: "Summarize {subject} on one screen with agreements, conflicts, unowned actions, and evidence sources.",
        mixed: "{subject}: agreement, conflict, unowned action, evidence source를 one-screen summary로 만들어줘.",
      },
      {
        boundary: true,
        ko: "결과는 세 문장만 쓰되 {subject}의 변화 추세, 핵심 예외, 의사결정에 필요한 불확실성을 모두 보존해줘.",
        en: "Use only three sentences, but preserve trends, key exceptions, and decision-relevant uncertainty from {subject}.",
        mixed: "three sentences만 쓰되 {subject}의 trend, key exception, decision uncertainty를 모두 보존해줘.",
      },
    ],
  },
  "reasoning/simple": {
    subjects: [
      ["ko", "12와 19 중 더 큰 수"],
      ["ko", "오후 두 시에서 세 시간 뒤의 시각"],
      ["ko", "개당 4천 원인 물건 세 개의 합계"],
      ["ko", "길이 8과 5의 차이"],
      ["ko", "점수가 70점 이상인지 여부"],
      ["ko", "세 숫자 3, 1, 2의 오름차순"],
      ["en", "which is larger, 42 or 37"],
      ["en", "the total cost of four items at five dollars each"],
      ["en", "whether 18 is divisible by 3"],
      ["mixed", "score 85가 cutoff 80을 넘는지"],
    ],
    families: [
      {
        ko: "다음 값을 계산해서 답만 알려줘: {subject}.",
        en: "Calculate {subject} and give only the answer.",
        mixed: "{subject}를 calculate해서 answer만 알려줘.",
      },
      {
        ko: "한 단계로 판단할 수 있는 {subject}의 결과를 알려줘.",
        en: "Give the result for {subject}, which requires one direct step.",
        mixed: "one direct step으로 {subject}의 result를 알려줘.",
      },
      {
        ko: "조건을 추가로 가정하지 말고 {subject}에 답해줘.",
        en: "Answer {subject} without adding assumptions.",
        mixed: "extra assumption 없이 {subject}에 answer해줘.",
      },
      {
        boundary: true,
        ko: "판단 과정에 대한 긴 설명이나 대안 비교는 필요 없어. 주어진 값만 사용해서 다음 결과를 구해줘: {subject}.",
        en: "No long rationale or alternative comparison is needed; use only the given values to determine {subject}.",
        mixed: "long rationale이나 alternative comparison 없이 given value로 {subject}를 구해줘.",
      },
      {
        boundary: true,
        ko: "문장이 길어 보여도 규칙은 하나야. 입력을 그대로 적용해서 {subject}의 결과 하나만 반환해줘.",
        en: "The sentence may look long, but there is one rule; apply it directly and return {subject}.",
        mixed: "sentence는 길어도 single rule이야. 그대로 apply해서 {subject} result 하나만 반환해줘.",
      },
    ],
  },
  "reasoning/complex": {
    subjects: [
      ["ko", "세 지역 중 신규 물류 거점 선택"],
      ["ko", "한정된 인력으로 네 프로젝트의 우선순위 결정"],
      ["ko", "비용과 안정성이 다른 데이터베이스 전환안 선택"],
      ["ko", "상충하는 규칙을 만족하는 배포 순서 결정"],
      ["ko", "수요가 불확실한 제품 출시 시점 판단"],
      ["ko", "여러 팀의 휴가 조건을 만족하는 일정 구성"],
      ["en", "choosing among three vendors under cost and reliability constraints"],
      ["en", "allocating limited compute across competing workloads"],
      ["en", "planning a migration with uncertain failure probabilities"],
      ["mixed", "latency와 cost trade-off가 있는 model routing 선택"],
    ],
    families: [
      {
        ko: "다음 결정을 위해 대안을 비교하고 필수 제약과 선호 기준을 분리해 최종 선택과 근거를 제시해줘: {subject}.",
        en: "For {subject}, compare alternatives, separate hard constraints from preferences, and justify a final choice.",
        mixed: "{subject}에서 alternative를 비교하고 hard constraint와 preference를 나눠 final choice를 설명해줘.",
      },
      {
        ko: "{subject}의 의존 관계를 단계별로 풀고 각 단계가 실패할 때 가능한 대체 경로를 평가해줘.",
        en: "Resolve the dependencies in {subject} step by step and evaluate fallback paths for each possible failure.",
        mixed: "{subject}의 dependency를 step-by-step으로 풀고 각 failure의 fallback path를 평가해줘.",
      },
      {
        ko: "{subject}에서 낙관, 기준, 비관 시나리오를 만들고 민감한 가정과 결론이 바뀌는 조건을 찾아줘.",
        en: "For {subject}, build optimistic, baseline, and pessimistic scenarios and identify assumptions that change the conclusion.",
        mixed: "{subject}에 optimistic, baseline, pessimistic scenario를 만들고 conclusion을 바꾸는 assumption을 찾아줘.",
      },
      {
        boundary: true,
        ko: "{subject}: 예산 제한, 선행 조건, 실패 비용을 동시에 만족하는 선택과 차선책을 정해줘.",
        en: "For {subject}, choose an option and backup that jointly satisfy budget limits, prerequisites, and failure costs.",
        mixed: "{subject}: budget limit, prerequisite, failure cost를 동시에 만족하는 choice와 backup을 정해줘.",
      },
      {
        boundary: true,
        ko: "{subject}의 답은 하나만 쓰되 불확실한 변수 두 개와 그 변수가 뒤집힐 때의 결론까지 검토해줘.",
        en: "Give one answer for {subject}, but assess two uncertain variables and how reversing them would change the conclusion.",
        mixed: "{subject}에 one answer를 주되 uncertain variable 두 개와 reverse 시 conclusion 변화까지 검토해줘.",
      },
    ],
  },
};

// These overrides create explicit, reviewable cases that generic family
// templates cannot guarantee: one-added-task pairs, one-added-constraint
// pairs, category-confusion cases, and menu/setting negative contexts.
// The simple and complex contrast prompts differ by exactly the final clause.
const profilePromptOverrides = {
  general: {
    simple: {
      taskcontrast: "비밀번호 최소 길이는 8자이고 입력값은 6자야. 가입이 거절된 이유를 한 문장으로 알려줘.",
      constraintcontrast: "환불 문의에 대한 고객 답변을 작성해줘.",
      categoryconfusion: "'코드 번역 요약'이라는 도움말 메뉴가 어디 있는지 알려줘.",
      negativecontext: "'고급 추론'은 설정 이름이야. 이 설정을 켜는 메뉴 위치만 알려줘.",
    },
    complex: {
      taskcontrast: "비밀번호 최소 길이는 8자이고 입력값은 6자야. 가입이 거절된 이유를 한 문장으로 알려줘. 그리고 가입 복구 절차를 작성해줘.",
      constraintcontrast: "환불 문의에 대한 고객 답변을 작성해줘. 단, 국가별 예외 규칙을 반드시 반영해줘.",
      categoryconfusion: "'번역 요약'이라는 프로젝트의 신청, 승인, 반려 절차와 예외별 담당자를 정해줘.",
      negativecontext: "'코드 분석'은 설정 이름이야. 이 설정이 비활성화된 경우의 권한 확인, 예외 처리, 재승인 절차를 설계해줘.",
    },
  },
  code: {
    simple: {
      taskcontrast: "Go 함수의 변수 이름 userNmae를 userName으로 바꿔줘.",
      constraintcontrast: "이 TypeScript 함수 이름을 바꿔줘.",
      categoryconfusion: "'번역 설정'이라는 메뉴명을 상수로 선언하는 TypeScript 코드 한 줄을 작성해줘.",
      negativecontext: "'요약 모델'은 설정 이름이야. 이 설정값을 읽는 Go 예시 하나를 보여줘.",
    },
    complex: {
      taskcontrast: "Go 함수의 변수 이름 userNmae를 userName으로 바꿔줘. 그리고 이 함수를 호출하는 부분도 수정해줘.",
      constraintcontrast: "이 TypeScript 함수 이름을 바꿔줘. 단, 외부 API 호환성을 유지해줘.",
      categoryconfusion: "'번역 설정'이라는 메뉴 상태가 동시 요청에서 되돌아가는 원인을 분석하고 수정 테스트를 설계해줘.",
      negativecontext: "'고급 추론'은 설정 이름이야. 이를 코드 enum으로 고정하지 않고 버전 호환성을 유지하는 리팩터링 계획을 작성해줘.",
    },
  },
  translation: {
    simple: {
      taskcontrast: "'빌드가 통과했습니다'를 영어로 번역해줘.",
      constraintcontrast: "'상태 보고서: 점검이 끝났습니다'를 영어로 번역해줘.",
      categoryconfusion: "'코드 요약 메뉴를 여세요'라는 문장을 영어로 번역해줘.",
      negativecontext: "'추론 모드'는 설정 이름이야. 이 이름을 영어로 번역해줘.",
    },
    complex: {
      taskcontrast: "'빌드가 통과했습니다'를 영어로 번역해줘. 그리고 용어 선택 이유를 설명해줘.",
      constraintcontrast: "'상태 보고서: 점검이 끝났습니다'를 영어로 번역해줘. 단, 표 제목인 '상태 보고서'는 번역하지 마.",
      categoryconfusion: "코드 리뷰 의견을 영어로 번역하되 식별자와 마크다운 서식을 보존하고 애매한 용어를 표시해줘.",
      negativecontext: "'추론 모드'와 '코드 요약'은 설정 이름이야. 제품 용어와 대문자 규칙을 보존하면서 영어로 현지화해줘.",
    },
  },
  summarization: {
    simple: {
      taskcontrast: "'배포일은 금요일이고 담당자는 아직 정해지지 않았다'를 한 문장으로 요약해줘.",
      constraintcontrast: "'점검은 월요일에 끝났고 서비스는 정상이다'를 요약해줘.",
      categoryconfusion: "'코드 번역'은 메뉴명이고 다음 점검일은 금요일이라는 공지를 한 문장으로 요약해줘.",
      negativecontext: "'고급 추론'은 설정 이름이며 현재 비활성화 상태라는 안내를 짧게 요약해줘.",
    },
    complex: {
      taskcontrast: "'배포일은 금요일이고 담당자는 아직 정해지지 않았다'를 한 문장으로 요약해줘. 그리고 미해결 항목을 따로 적어줘.",
      constraintcontrast: "'점검은 월요일에 끝났고 서비스는 정상이다'를 요약해줘. 단, 각 문장에 출처 표시를 유지해줘.",
      categoryconfusion: "코드 리뷰와 번역 검수 회의 기록을 결정, 충돌, 담당자 없는 작업으로 나눠 중복 없이 요약해줘.",
      negativecontext: "'요약 모델'과 '고급 추론'은 설정 이름이야. 세 팀의 설정 변경 기록에서 합의점, 예외, 미완료 작업을 출처와 함께 요약해줘.",
    },
  },
  reasoning: {
    simple: {
      taskcontrast: "월 비용만 보면 A는 10만 원, B는 12만 원, C는 11만 원이야. 가장 저렴한 것을 골라줘.",
      constraintcontrast: "A는 월 10만 원에 250ms, B는 12만 원에 180ms, C는 11만 원에 210ms야. 월 비용이 가장 낮은 것을 골라줘.",
      categoryconfusion: "'번역 품질' 메뉴 점수는 80이고 '요약 품질' 메뉴 점수는 75야. 더 큰 점수를 알려줘.",
      negativecontext: "'코드 모드'와 '추론 모드'는 설정 이름이야. 사용량 12와 9 중 더 큰 값만 알려줘.",
    },
    complex: {
      taskcontrast: "월 비용만 보면 A는 10만 원, B는 12만 원, C는 11만 원이야. 가장 저렴한 것을 골라줘. 그리고 사용할 수 없을 때의 차선책도 정해줘.",
      constraintcontrast: "A는 월 10만 원에 250ms, B는 12만 원에 180ms, C는 11만 원에 210ms야. 월 비용이 가장 낮은 것을 골라줘. 단, 응답 시간이 200ms 이하여야 해.",
      categoryconfusion: "'번역 품질'과 '요약 품질'은 메뉴 이름이야. 비용, 정확도, 지연시간이 다른 두 메뉴의 적용 순서를 정하고 실패 시 대안을 제시해줘.",
      negativecontext: "'코드 모드'와 '추론 모드'는 설정 이름이야. 예산, 지연시간, 실패 비용을 함께 고려해 기본값과 대체값을 정해줘.",
    },
  },
};

function profileFor(familyIndex, variantIndex, difficulty) {
  if (familyIndex === 3) return difficulty === "simple" ? "longsimple" : "shortcomplex";
  if (familyIndex === 4) return "threshold";
  if (familyIndex === 2 && variantIndex === 0) return "taskcontrast";
  if (familyIndex === 2 && variantIndex === 1) return "constraintcontrast";
  if (familyIndex === 2 && variantIndex === 2) return "categoryconfusion";
  if (familyIndex === 2 && variantIndex === 3) return "negativecontext";
  return "clear";
}

function render(template, subject) {
  return template.replaceAll("{subject}", subject);
}

function buildRecord(category, difficulty, cell, familyIndex, variantIndex) {
  const family = cell.families[familyIndex];
  const [language, subject] = cell.subjects[variantIndex];
  const kind = family.boundary ? "boundary" : "core";
  const profile = profileFor(familyIndex, variantIndex, difficulty);
  const override = profilePromptOverrides[category]?.[difficulty]?.[profile];
  const sampleId = [
    "difficulty",
    category,
    difficulty,
    kind,
    profile,
    `f${String(familyIndex + 1).padStart(2, "0")}`,
    `v${String(variantIndex + 1).padStart(2, "0")}`,
  ].join("_");

  return {
    schemaVersion: "gatelm.difficulty-evaluation-record.v1",
    datasetVersion,
    sampleId,
    redactedPrompt: override ?? render(family[language], subject),
    expectedCategory: category,
    expectedDifficulty: difficulty,
    labelSource: "synthetic_fixture",
    consentType: "synthetic",
    source: "synthetic_fixture",
    language,
    redactionVersion: "rule_based_redaction_v1",
    createdAt,
    labelConfidence: family.boundary ? 0.78 : 0.94,
    reviewerNote: `Synthetic ${profile} pilot case; human review pending.`,
  };
}

const records = [];
for (const category of categories) {
  for (const difficulty of difficulties) {
    const cell = cells[`${category}/${difficulty}`];
    if (!cell || cell.families.length !== 5 || cell.subjects.length !== 10) {
      throw new Error(`invalid generator cell ${category}/${difficulty}`);
    }
    for (let familyIndex = 0; familyIndex < cell.families.length; familyIndex++) {
      for (let variantIndex = 0; variantIndex < cell.subjects.length; variantIndex++) {
        records.push(buildRecord(category, difficulty, cell, familyIndex, variantIndex));
      }
    }
  }
}

for (const category of categories) {
  for (const profile of ["taskcontrast", "constraintcontrast"]) {
    const simplePrompt = profilePromptOverrides[category].simple[profile];
    const complexPrompt = profilePromptOverrides[category].complex[profile];
    if (!complexPrompt.startsWith(simplePrompt)) {
      throw new Error(`${category}/${profile} must add to the exact simple prompt`);
    }
  }
}

if (records.length !== 500) {
  throw new Error(`expected 500 records, got ${records.length}`);
}

if (new Set(records.map((record) => record.sampleId)).size !== records.length) {
  throw new Error("sampleId values must be unique");
}

if (new Set(records.map((record) => record.redactedPrompt)).size !== records.length) {
  throw new Error("redactedPrompt values must be unique");
}

for (const category of categories) {
  for (const difficulty of difficulties) {
    const cellRecords = records.filter(
      (record) => record.expectedCategory === category && record.expectedDifficulty === difficulty,
    );
    const boundaryCount = cellRecords.filter((record) => record.sampleId.includes("_boundary_")).length;
    const languageCounts = Object.groupBy(cellRecords, (record) => record.language);
    if (
      cellRecords.length !== 50 ||
      boundaryCount < 15 ||
      languageCounts.ko?.length !== 30 ||
      languageCounts.en?.length !== 15 ||
      languageCounts.mixed?.length !== 5
    ) {
      throw new Error(`invalid distribution for ${category}/${difficulty}`);
    }
  }
}

function familyIdFor(sampleId) {
  const match = /^difficulty_(general|code|translation|summarization|reasoning)_(?:simple|complex)_.+_(f\d{2})_v\d{2}$/.exec(
    sampleId,
  );
  if (!match) {
    throw new Error(`sampleId does not match difficulty family contract: ${sampleId}`);
  }
  return `${match[1]}/${match[2]}`;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const splitPolicyVersion = "difficulty-family-split.v1";
const familyRuleVersion = "difficulty-sample-family.v1";
const familyAssignments = [];
for (const category of categories) {
  const categoryFamilies = [...new Set(
    records
      .filter((record) => record.expectedCategory === category)
      .map((record) => familyIdFor(record.sampleId)),
  )].sort((left, right) =>
    sha256(`${splitPolicyVersion}:${left}`).localeCompare(sha256(`${splitPolicyVersion}:${right}`)),
  );
  if (categoryFamilies.length !== 5) {
    throw new Error(`expected five family groups for ${category}, got ${categoryFamilies.length}`);
  }
  categoryFamilies.forEach((familyId, index) => {
    const split = index < 3 ? "train" : index === 3 ? "calibration" : "holdout";
    familyAssignments.push({ familyId, split });
  });
}
familyAssignments.sort((left, right) => left.familyId.localeCompare(right.familyId));

const datasetText = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
const splitCounts = Object.fromEntries(
  ["train", "calibration", "holdout"].map((split) => {
    const families = new Set(
      familyAssignments.filter((assignment) => assignment.split === split).map((assignment) => assignment.familyId),
    );
    const samples = records.filter((record) => families.has(familyIdFor(record.sampleId))).length;
    return [split, { families: families.size, samples }];
  }),
);
const splitManifest = {
  schemaVersion: "gatelm.difficulty-training-split-manifest.v1",
  datasetVersion,
  datasetSha256: sha256(datasetText),
  splitPolicyVersion,
  familyRuleVersion,
  familyRule: {
    sampleIdPattern:
      "^difficulty_(general|code|translation|summarization|reasoning)_(simple|complex)_.+_(f\\d{2})_v\\d{2}$",
    familyKey: "{category}/{fNN}",
    excludes: ["expectedDifficulty", "vNN"],
  },
  totals: { samples: records.length, families: familyAssignments.length },
  splitCounts,
  families: familyAssignments,
};

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, datasetText, "utf8");
writeFileSync(splitManifestPath, `${JSON.stringify(splitManifest, null, 2)}\n`, "utf8");
console.log(`wrote ${records.length} records to ${outputPath}`);
console.log(`wrote ${familyAssignments.length} family assignments to ${splitManifestPath}`);
