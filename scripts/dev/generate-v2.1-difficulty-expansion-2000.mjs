import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  verifyDifficultyLabelDatasetManifest,
  verifyDifficultyLabelRecords,
} from "../verify-v2.1-difficulty-eval.mjs";

const outputPath = path.resolve(
  "docs/v2.1.0/fixtures/difficulty-label-expansion-2000.fixture.jsonl",
);
const manifestPath = path.resolve(
  "docs/v2.1.0/fixtures/difficulty-label-expansion-2000.manifest.json",
);
const datasetPath = "docs/v2.1.0/fixtures/difficulty-label-expansion-2000.fixture.jsonl";
const datasetVersion = "difficulty_label_2026_07_15_expansion_2000_v1";
const createdAt = "2026-07-15T00:00:00Z";
const splitSeed = 20260715;
const splitPolicyVersion = "difficulty-expansion-family-split.2026-07-15.v1";
const categories = ["general", "code", "translation", "summarization", "reasoning"];
const difficulties = ["simple", "complex"];
const splits = ["train", "calibration", "holdout"];
const languagesByProfile = ["ko", "en", "mixed", "ko", "en", "mixed", "ko", "en", "ko", "en"];
const structuralBoundaryTypes = ["code_fence", "role_tag", "role_heading", "begin_end", "blockquote"];
const payloadOnlyBoundaryTypes = ["code_fence", "role_tag", "role_heading", "begin_end", "multiple"];
const requiredEvaluationSlices = [
  "negation",
  "indirect_expression",
  "synonym",
  "short_complex",
  "long_simple",
  "payload_contamination",
  "korean",
  "english",
  "mixed_language",
  "category_confusion",
  "ood_terminology",
];

const topic = (ko, en) => ({ ko, en });

const labelDefinitions = [
  {
    category: "general",
    label: "general_qa",
    splitCounts: { train: 2, calibration: 1, holdout: 1 },
    topics: [
      topic("서비스 점검 시간", "the service maintenance window"),
      topic("청구 내역 화면 위치", "the billing history page location"),
      topic("노란 상태 아이콘 의미", "the meaning of the yellow status icon"),
      topic("초대 링크 만료 조건", "the invitation link expiry rule"),
    ],
  },
  {
    category: "general",
    label: "general_explanation",
    splitCounts: { train: 2, calibration: 1, holdout: 1 },
    topics: [
      topic("재시도 지터가 필요한 이유", "why retry jitter is needed"),
      topic("세션 토큰 순환 방식", "how session token rotation works"),
      topic("멱등 키가 중복을 막는 원리", "how an idempotency key prevents duplicates"),
      topic("캐시 만료 후 재검증 흐름", "the cache revalidation flow after expiry"),
    ],
  },
  {
    category: "general",
    label: "general_extraction",
    splitCounts: { train: 2, calibration: 1, holdout: 1 },
    topics: [
      topic("장애 기록의 시각과 영향 범위", "timestamps and impact scopes in incident notes"),
      topic("청구서의 세금과 최종 합계", "tax and final totals in invoices"),
      topic("회의 메모의 담당자와 기한", "owners and due dates in meeting notes"),
      topic("배포 기록의 위험과 롤백 조건", "risks and rollback conditions in release notes"),
    ],
  },
  {
    category: "general",
    label: "general_support",
    splitCounts: { train: 2, calibration: 1, holdout: 1 },
    topics: [
      topic("환불 지연 문의", "a delayed refund inquiry"),
      topic("계정 복구 요청", "an account recovery request"),
      topic("초대 실패 안내", "an invitation failure notice"),
      topic("사용량 한도 경고", "a usage limit warning"),
    ],
  },
  {
    category: "general",
    label: "general_transformation",
    splitCounts: { train: 2, calibration: 1, holdout: 1 },
    topics: [
      topic("변경 기록을 표 형식으로 변환", "converting a changelog into a table"),
      topic("정책 목록을 체크리스트로 변환", "converting a policy list into a checklist"),
      topic("회의 불릿을 안내 메일로 변환", "turning meeting bullets into an announcement email"),
      topic("운영 메모를 시간순 기록으로 변환", "turning operations notes into a timeline"),
    ],
  },
  {
    category: "general",
    label: "general_other",
    splitCounts: { train: 14, calibration: 3, holdout: 3 },
    payloadOnlySimple: true,
    topics: [
      topic("온보딩 환영 문구", "an onboarding welcome message"),
      topic("새 상태 이름 후보", "new status name candidates"),
      topic("주간 회의 안건", "a weekly meeting agenda"),
      topic("운영 경고 문구", "an operations warning message"),
      topic("후속 질문 묶음", "a set of follow-up questions"),
      topic("설문 시작 문장", "a survey opening sentence"),
      topic("기능 소개 한 줄", "a one-line feature introduction"),
      topic("대기 화면 안내", "a waiting screen notice"),
      topic("내부 캠페인 이름", "an internal campaign name"),
      topic("교육 세션 제목", "a training session title"),
      topic("점검 완료 배너", "a maintenance completion banner"),
      topic("팀 회고 질문", "a team retrospective question"),
      topic("신규 메뉴 설명", "a new menu description"),
      topic("일정 변경 공지", "a schedule change notice"),
      topic("파일 업로드 도움말", "a file upload help message"),
      topic("프로필 설정 안내", "a profile settings hint"),
      topic("사용자 확인 문구", "a user confirmation message"),
      topic("대시보드 빈 상태 문구", "dashboard empty-state copy"),
      topic("피드백 요청 문장", "a feedback request sentence"),
      topic("작업 완료 알림", "a task completion notification"),
    ],
  },
  {
    category: "code",
    label: "code_generation",
    splitCounts: { train: 4, calibration: 2, holdout: 2 },
    topics: [
      topic("Go 문자열 정규화 함수", "a Go string normalization function"),
      topic("TypeScript 페이지네이션 타입", "a TypeScript pagination type"),
      topic("Python 재시도 데코레이터", "a Python retry decorator"),
      topic("Rust 범위 검사 함수", "a Rust range validation function"),
      topic("SQL 최근 행 조회", "a SQL query for recent rows"),
      topic("Java 만료 시각 검사", "a Java expiry-time check"),
      topic("Kotlin nullable 변환", "a Kotlin nullable conversion"),
      topic("Bash 파일 개수 출력", "a Bash file-count command"),
    ],
  },
  {
    category: "code",
    label: "code_debugging",
    splitCounts: { train: 4, calibration: 2, holdout: 2 },
    topics: [
      topic("동시 결제 중복 오류", "a duplicate charge under concurrency"),
      topic("캐시 갱신 순서 역전", "a cache refresh ordering inversion"),
      topic("재시도 중 이벤트 유실", "an event loss during retries"),
      topic("간헐적 테스트 타임아웃", "an intermittent test timeout"),
      topic("스트림 메모리 증가", "a growing stream memory footprint"),
      topic("롤링 배포 호환 실패", "a rolling-deploy compatibility failure"),
      topic("테넌트 캐시 키 충돌", "a tenant cache-key collision"),
      topic("작업 큐 중복 실행", "a duplicate job-queue execution"),
    ],
  },
  {
    category: "code",
    label: "code_refactoring",
    splitCounts: { train: 4, calibration: 1, holdout: 1 },
    topics: [
      topic("분산된 권한 검사", "scattered authorization checks"),
      topic("중복된 provider adapter", "duplicated provider adapters"),
      topic("거대한 request handler", "an oversized request handler"),
      topic("전역 상태 기반 테스트", "tests coupled to global state"),
      topic("레거시 오류 매핑", "legacy error mapping"),
      topic("혼합된 캐시 정책", "intermixed cache policies"),
    ],
  },
  {
    category: "code",
    label: "code_review",
    splitCounts: { train: 4, calibration: 1, holdout: 1 },
    topics: [
      topic("JWT 검증 middleware", "JWT validation middleware"),
      topic("SQL transaction 경계", "SQL transaction boundaries"),
      topic("Redis lock 해제 코드", "Redis lock release code"),
      topic("파일 경로 검증 함수", "a file-path validation function"),
      topic("비동기 로그 writer", "an asynchronous log writer"),
      topic("요청 body 제한 로직", "request-body limit logic"),
    ],
  },
  {
    category: "code",
    label: "code_explanation",
    splitCounts: { train: 4, calibration: 1, holdout: 1 },
    topics: [
      topic("Go context 취소 전파", "Go context cancellation propagation"),
      topic("Promise.all 실패 처리", "Promise.all failure handling"),
      topic("PostgreSQL MVCC", "PostgreSQL MVCC"),
      topic("Python context manager", "a Python context manager"),
      topic("Rust ownership 이동", "Rust ownership moves"),
      topic("HTTP keep-alive 재사용", "HTTP keep-alive reuse"),
    ],
  },
  {
    category: "code",
    label: "code_design",
    splitCounts: { train: 4, calibration: 1, holdout: 1 },
    topics: [
      topic("provider catalog interface", "a provider catalog interface"),
      topic("tenant usage ledger", "a tenant usage ledger"),
      topic("idempotent webhook consumer", "an idempotent webhook consumer"),
      topic("versioned runtime snapshot", "a versioned runtime snapshot"),
      topic("bounded worker queue", "a bounded worker queue"),
      topic("fallback routing module", "a fallback routing module"),
    ],
  },
  {
    category: "translation",
    label: "translation_direct",
    splitCounts: { train: 8, calibration: 3, holdout: 3 },
    topics: [
      topic("점검 공지를 영어로", "a Korean maintenance notice into English"),
      topic("배송 안내를 일본어로", "an English shipping notice into Japanese"),
      topic("회의 취소 문장을 독일어로", "a meeting cancellation sentence into German"),
      topic("예약 확인 문장을 스페인어로", "a reservation confirmation into Spanish"),
      topic("비밀번호 안내를 프랑스어로", "a password instruction into French"),
      topic("휴무 안내를 중국어로", "a closure notice into Chinese"),
      topic("결제 완료 문장을 한국어로", "a payment completion sentence into Korean"),
      topic("접수 확인 문장을 영어로", "an application receipt sentence into English"),
      topic("방문 안내를 태국어로", "a visitor instruction into Thai"),
      topic("교육 일정을 베트남어로", "a training schedule into Vietnamese"),
      topic("상태 메시지를 포르투갈어로", "a status message into Portuguese"),
      topic("배송 지연 문장을 이탈리아어로", "a shipping delay sentence into Italian"),
      topic("로그인 안내를 네덜란드어로", "a login instruction into Dutch"),
      topic("업데이트 알림을 인도네시아어로", "an update notice into Indonesian"),
    ],
  },
  {
    category: "translation",
    label: "translation_localization",
    splitCounts: { train: 8, calibration: 3, holdout: 3 },
    topics: [
      topic("한국 쇼핑 앱의 미국 출시 문구", "US launch copy for a Korean shopping app"),
      topic("일본 게임의 한국 이벤트 문구", "Korean event copy for a Japanese game"),
      topic("독일 결제 화면의 영국 표현", "UK wording for a German checkout screen"),
      topic("프랑스 여행 앱의 캐나다 안내", "Canadian guidance for a French travel app"),
      topic("미국 교육 서비스의 한국 학기 표현", "Korean semester wording for a US education service"),
      topic("한국 음식 메뉴의 호주 설명", "Australian descriptions for a Korean food menu"),
      topic("브라질 캠페인의 스페인 표현", "Spanish wording for a Brazilian campaign"),
      topic("영국 고객센터의 인도 안내", "Indian support copy for a UK help center"),
      topic("싱가포르 핀테크의 일본 경고", "Japanese warnings for a Singapore fintech app"),
      topic("미국 날짜 형식의 유럽 변환", "European adaptation of US date formats"),
      topic("한국 단위 표기의 미국 변환", "US adaptation of Korean measurement units"),
      topic("일본 존칭의 영어 대화 변환", "English dialogue adaptation of Japanese honorifics"),
      topic("한국 말장난의 프랑스 캠페인", "French campaign adaptation of a Korean pun"),
      topic("인도 축제 문구의 영국 안내", "UK adaptation of Indian festival copy"),
    ],
  },
  {
    category: "translation",
    label: "translation_style_preserving",
    splitCounts: { train: 8, calibration: 2, holdout: 2 },
    topics: [
      topic("법률 고지의 정의 용어", "defined terms in a legal notice"),
      topic("의료 안내의 경고 어조", "warning tone in medical guidance"),
      topic("브랜드 캠페인의 친근한 말투", "friendly voice in brand campaign copy"),
      topic("API 문서의 식별자와 코드", "identifiers and code in API documentation"),
      topic("투자 보고서의 표 제목", "table headings in an investment report"),
      topic("게임 대사의 캐릭터 말투", "character voice in game dialogue"),
      topic("제품 UI의 치환 변수", "placeholders in product UI strings"),
      topic("계약서의 번호와 상호 참조", "numbering and cross-references in a contract"),
      topic("연구 초록의 전문 용어", "technical terminology in a research abstract"),
      topic("시의 반복 리듬", "repeated rhythm in a poem"),
      topic("고객 편지의 격식", "formality in a customer letter"),
      topic("안전 매뉴얼의 단위 표기", "measurement units in a safety manual"),
    ],
  },
  {
    category: "summarization",
    label: "summarization_direct",
    splitCounts: { train: 6, calibration: 2, holdout: 2 },
    topics: [
      topic("단일 점검 공지", "one maintenance notice"),
      topic("단일 배송 안내", "one shipping notice"),
      topic("한 회의 메모", "one meeting note"),
      topic("한 배포 기록", "one release note"),
      topic("한 정책 변경문", "one policy change note"),
      topic("한 고객 문의", "one customer inquiry"),
      topic("한 연구 초록", "one research abstract"),
      topic("한 장애 공지", "one incident notice"),
      topic("한 교육 안내", "one training announcement"),
      topic("한 예산 보고", "one budget report"),
    ],
  },
  {
    category: "summarization",
    label: "summarization_key_points",
    splitCounts: { train: 6, calibration: 2, holdout: 2 },
    topics: [
      topic("사용자 인터뷰 메모", "user interview notes"),
      topic("프로젝트 주간 기록", "weekly project notes"),
      topic("보안 점검 결과", "security review findings"),
      topic("고객 피드백 묶음", "a customer feedback collection"),
      topic("성능 시험 기록", "performance test notes"),
      topic("운영 인수인계", "operations handoff notes"),
      topic("채용 면접 기록", "interview panel notes"),
      topic("분기 목표 문서", "a quarterly goals document"),
      topic("지원 티켓 기록", "support ticket notes"),
      topic("설문 자유 응답", "survey free-text responses"),
    ],
  },
  {
    category: "summarization",
    label: "summarization_structured",
    splitCounts: { train: 6, calibration: 2, holdout: 2 },
    topics: [
      topic("결정과 담당자가 섞인 회의록", "minutes mixing decisions and owners"),
      topic("위험과 일정이 섞인 배포 계획", "a release plan mixing risks and dates"),
      topic("원인과 조치가 섞인 장애 회고", "an incident review mixing causes and actions"),
      topic("질문과 답변이 섞인 인터뷰", "an interview mixing questions and answers"),
      topic("요구와 예외가 섞인 정책", "a policy mixing requirements and exceptions"),
      topic("목표와 지표가 섞인 분기 보고", "a quarterly report mixing goals and metrics"),
      topic("작업과 의존성이 섞인 백로그", "a backlog mixing tasks and dependencies"),
      topic("의견과 결론이 섞인 검토 기록", "review notes mixing opinions and conclusions"),
      topic("비용과 효과가 섞인 제안서", "a proposal mixing costs and benefits"),
      topic("문제와 소유자가 섞인 지원 기록", "support notes mixing issues and owners"),
    ],
  },
  {
    category: "summarization",
    label: "summarization_multi_source",
    splitCounts: { train: 6, calibration: 2, holdout: 2 },
    topics: [
      topic("세 지역의 장애 보고", "incident reports from three regions"),
      topic("네 팀의 분기 회고", "quarterly retrospectives from four teams"),
      topic("여러 공급업체 비용 보고", "cost reports from several vendors"),
      topic("상충하는 사용자 조사", "conflicting user research studies"),
      topic("여러 버전의 정책 문서", "multiple versions of a policy"),
      topic("장기간 프로젝트 기록", "a long-running project archive"),
      topic("서로 다른 보안 감사", "different security audit reports"),
      topic("여러 채널의 고객 의견", "customer feedback from multiple channels"),
      topic("중복된 회의 결정 기록", "overlapping meeting decision logs"),
      topic("서로 다른 성능 실험", "different performance experiments"),
    ],
  },
  {
    category: "reasoning",
    label: "reasoning_comparison",
    splitCounts: { train: 4, calibration: 2, holdout: 2 },
    topics: [
      topic("두 저장소의 비용과 지연", "cost and latency of two storage options"),
      topic("세 배포 방식의 위험", "risk across three deployment methods"),
      topic("두 인증 방식의 운영 부담", "operational burden of two auth methods"),
      topic("세 큐의 처리량과 복구", "throughput and recovery across three queues"),
      topic("두 캐시 전략의 일관성", "consistency of two cache strategies"),
      topic("세 데이터 형식의 호환성", "compatibility of three data formats"),
      topic("두 로깅 방식의 비용", "cost of two logging approaches"),
      topic("세 테스트 전략의 신뢰도", "reliability of three testing strategies"),
    ],
  },
  {
    category: "reasoning",
    label: "reasoning_planning",
    splitCounts: { train: 4, calibration: 2, holdout: 2 },
    topics: [
      topic("다중 지역 이전", "a multi-region migration"),
      topic("분기별 권한 점검", "a quarterly access review"),
      topic("서비스 종료 전환", "a service deprecation transition"),
      topic("공급업체 교체", "a vendor replacement"),
      topic("대규모 데이터 정리", "a large data cleanup"),
      topic("장애 대응 훈련", "an incident response drill"),
      topic("신규 직원 온보딩", "new employee onboarding"),
      topic("호환성 마이그레이션", "a compatibility migration"),
    ],
  },
  {
    category: "reasoning",
    label: "reasoning_decision",
    splitCounts: { train: 4, calibration: 2, holdout: 2 },
    topics: [
      topic("예산 내 모델 선택", "model selection within a budget"),
      topic("지연 제한 내 지역 선택", "region selection under a latency limit"),
      topic("복구 시간에 맞는 백업 선택", "backup selection under a recovery target"),
      topic("규모에 맞는 큐 선택", "queue selection for a workload size"),
      topic("보존 기간에 맞는 저장소 선택", "storage selection for a retention period"),
      topic("팀 역량에 맞는 프레임워크 선택", "framework selection for team skills"),
      topic("위험 허용도에 맞는 배포 선택", "deployment selection for a risk tolerance"),
      topic("정확도 목표에 맞는 평가 선택", "evaluation selection for an accuracy target"),
    ],
  },
  {
    category: "reasoning",
    label: "reasoning_constraint_solving",
    splitCounts: { train: 6, calibration: 1, holdout: 1 },
    topics: [
      topic("예산·지연·가용성 동시 만족", "joint budget, latency, and availability constraints"),
      topic("인력·기한·품질 동시 만족", "joint staffing, deadline, and quality constraints"),
      topic("보안·호환·성능 동시 만족", "joint security, compatibility, and performance constraints"),
      topic("용량·비용·복구 동시 만족", "joint capacity, cost, and recovery constraints"),
      topic("지역·규정·지연 동시 만족", "joint region, regulation, and latency constraints"),
      topic("순서·중복·재시도 동시 만족", "joint ordering, deduplication, and retry constraints"),
      topic("톤·길이·정확성 동시 만족", "joint tone, length, and accuracy constraints"),
      topic("범위·소유자·검증 동시 만족", "joint scope, ownership, and validation constraints"),
    ],
  },
  {
    category: "reasoning",
    label: "reasoning_causal",
    splitCounts: { train: 6, calibration: 1, holdout: 1 },
    topics: [
      topic("재시도 증가와 지연 급증", "retry growth and a latency spike"),
      topic("캐시 적중률과 DB 부하", "cache hit rate and database load"),
      topic("배포 순서와 오류율", "deployment order and error rate"),
      topic("큐 적체와 타임아웃", "queue backlog and timeouts"),
      topic("가격 변경과 이탈률", "price changes and churn"),
      topic("알림 빈도와 응답률", "notification frequency and response rate"),
      topic("권한 상속과 노출 위험", "permission inheritance and exposure risk"),
      topic("샘플 편향과 평가 점수", "sample bias and evaluation scores"),
    ],
  },
];

const intentNouns = {
  general_qa: { ko: "직접 답변", en: "direct answer" },
  general_explanation: { ko: "원리 설명", en: "mechanism explanation" },
  general_extraction: { ko: "필드 추출", en: "field extraction" },
  general_support: { ko: "지원 안내", en: "support guidance" },
  general_transformation: { ko: "형식 변환", en: "format transformation" },
  general_other: { ko: "일반 결과", en: "general-purpose result" },
  code_generation: { ko: "코드 구현", en: "code implementation" },
  code_debugging: { ko: "디버깅 수정", en: "debugging fix" },
  code_refactoring: { ko: "리팩터링안", en: "refactoring result" },
  code_review: { ko: "코드 검토", en: "code review" },
  code_explanation: { ko: "코드 설명", en: "code explanation" },
  code_design: { ko: "코드 설계", en: "code design" },
  translation_direct: { ko: "직접 번역", en: "direct translation" },
  translation_localization: { ko: "현지화 번역", en: "localized translation" },
  translation_style_preserving: { ko: "스타일 보존 번역", en: "style-preserving translation" },
  summarization_direct: { ko: "직접 요약", en: "direct summary" },
  summarization_key_points: { ko: "핵심 요약", en: "key-point summary" },
  summarization_structured: { ko: "구조화 요약", en: "structured summary" },
  summarization_multi_source: { ko: "다중 자료 요약", en: "multi-source summary" },
  reasoning_comparison: { ko: "비교 결론", en: "comparison" },
  reasoning_planning: { ko: "실행 계획", en: "execution plan" },
  reasoning_decision: { ko: "선택 결론", en: "decision" },
  reasoning_constraint_solving: { ko: "제약 해법", en: "constraint solution" },
  reasoning_causal: { ko: "인과 분석", en: "causal analysis" },
};

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function actionFor(family, language, synonym = false) {
  const { label, topic: familyTopic } = family;
  const aliases = {
    general_qa: ["답을 짚어줘", "pinpoint the answer", "direct answer를 짚어줘"],
    general_explanation: ["원리를 풀어줘", "unpack the mechanism", "mechanism을 풀어줘"],
    general_extraction: ["필요한 값을 골라내줘", "pick out the needed values", "needed value를 골라줘"],
    general_support: ["도움 문안을 마련해줘", "prepare helpful guidance", "support guidance를 마련해줘"],
    general_transformation: ["요청한 꼴로 바꿔줘", "reshape it into the requested form", "requested format으로 바꿔줘"],
    general_other: ["알맞은 결과를 꾸려줘", "compose a suitable result", "suitable result를 꾸려줘"],
    code_generation: ["구현안을 적어줘", "draft the implementation", "implementation을 적어줘"],
    code_debugging: ["고장 원인을 좁혀 고쳐줘", "narrow down and repair the fault", "fault를 좁혀 fix해줘"],
    code_refactoring: ["동작을 지키며 구조를 다듬어줘", "reshape the structure while preserving behavior", "behavior를 지키며 structure를 다듬어줘"],
    code_review: ["결함을 살펴줘", "inspect it for defects", "defect를 살펴줘"],
    code_explanation: ["동작을 풀어줘", "unpack how it behaves", "behavior를 풀어줘"],
    code_design: ["구조안을 잡아줘", "shape the design", "design structure를 잡아줘"],
    translation_direct: ["다른 언어로 옮겨줘", "render it in the target language", "target language로 옮겨줘"],
    translation_localization: ["현지 독자에 맞춰 다듬어줘", "adapt it for the local audience", "local audience에 맞춰 다듬어줘"],
    translation_style_preserving: ["말투를 살려 옮겨줘", "carry it over without losing its voice", "voice를 살려 옮겨줘"],
    summarization_direct: ["짧게 줄여줘", "condense it", "concise하게 줄여줘"],
    summarization_key_points: ["요지만 추려줘", "distill the key points", "key point만 추려줘"],
    summarization_structured: ["항목별로 재구성해줘", "organize the digest by section", "section별 digest로 구성해줘"],
    summarization_multi_source: ["겹침을 걷어내 한 흐름으로 묶어줘", "weave the sources into one deduplicated account", "source를 deduplicate해 한 흐름으로 묶어줘"],
    reasoning_comparison: ["서로 견줘줘", "weigh the alternatives", "alternative를 견줘줘"],
    reasoning_planning: ["실행 순서를 짜줘", "lay out the execution order", "execution order를 짜줘"],
    reasoning_decision: ["근거에 맞는 결론을 골라줘", "choose the evidence-backed option", "evidence 기반 option을 골라줘"],
    reasoning_constraint_solving: ["조건을 모두 맞추는 해를 찾아줘", "find a solution satisfying every condition", "all condition을 만족하는 solution을 찾아줘"],
    reasoning_causal: ["원인 고리를 밝혀줘", "trace the causal chain", "causal chain을 밝혀줘"],
  };
  if (synonym) {
    const index = language === "ko" ? 0 : language === "en" ? 1 : 2;
    return `${familyTopic[language === "en" ? "en" : "ko"]}: ${aliases[label][index]}`;
  }

  const actions = {
    general_qa: [`${familyTopic.ko}에 직접 답해줘`, `Answer the question about ${familyTopic.en}`, `${familyTopic.ko}에 direct answer를 줘`],
    general_explanation: [`${familyTopic.ko}을 설명해줘`, `Explain ${familyTopic.en}`, `${familyTopic.ko}의 mechanism을 설명해줘`],
    general_extraction: [`${familyTopic.ko}에서 필요한 값을 추출해줘`, `Extract ${familyTopic.en}`, `${familyTopic.ko}에서 required field를 extract해줘`],
    general_support: [`${familyTopic.ko}에 대한 지원 안내를 작성해줘`, `Write support guidance for ${familyTopic.en}`, `${familyTopic.ko}에 대한 support guidance를 작성해줘`],
    general_transformation: [`${familyTopic.ko} 작업을 수행해줘`, `Perform ${familyTopic.en}`, `${familyTopic.ko} 작업을 requested format으로 처리해줘`],
    general_other: [`${familyTopic.ko}에 필요한 일반 결과를 만들어줘`, `Create a general-purpose result for ${familyTopic.en}`, `${familyTopic.ko}에 필요한 general result를 만들어줘`],
    code_generation: [`${familyTopic.ko} 코드를 작성해줘`, `Write ${familyTopic.en}`, `${familyTopic.ko} implementation을 작성해줘`],
    code_debugging: [`${familyTopic.ko}의 원인을 분석하고 수정해줘`, `Debug and fix ${familyTopic.en}`, `${familyTopic.ko}의 root cause를 분석하고 fix해줘`],
    code_refactoring: [`${familyTopic.ko}을 동작 보존 방식으로 리팩터링해줘`, `Refactor ${familyTopic.en} while preserving behavior`, `${familyTopic.ko}을 behavior-preserving 방식으로 refactor해줘`],
    code_review: [`${familyTopic.ko}을 정확성과 유지보수성 관점에서 검토해줘`, `Review ${familyTopic.en} for correctness and maintainability`, `${familyTopic.ko}을 correctness와 maintainability 관점에서 review해줘`],
    code_explanation: [`${familyTopic.ko}의 동작을 설명해줘`, `Explain ${familyTopic.en}`, `${familyTopic.ko}의 behavior를 설명해줘`],
    code_design: [`${familyTopic.ko}을 설계해줘`, `Design ${familyTopic.en}`, `${familyTopic.ko}을 interface 중심으로 design해줘`],
    translation_direct: [`${familyTopic.ko} 직접 번역해줘`, `Directly translate ${familyTopic.en}`, `${familyTopic.ko} direct translation을 해줘`],
    translation_localization: [`${familyTopic.ko} 현지화해줘`, `Localize ${familyTopic.en}`, `${familyTopic.ko} localization을 해줘`],
    translation_style_preserving: [`${familyTopic.ko}을 보존하며 번역해줘`, `Translate while preserving ${familyTopic.en}`, `${familyTopic.ko}을 preserve하며 translate해줘`],
    summarization_direct: [`${familyTopic.ko}을 직접 요약해줘`, `Summarize ${familyTopic.en}`, `${familyTopic.ko}을 direct summary로 만들어줘`],
    summarization_key_points: [`${familyTopic.ko}의 핵심을 추려 요약해줘`, `Summarize the key points from ${familyTopic.en}`, `${familyTopic.ko}의 key point를 summary해줘`],
    summarization_structured: [`${familyTopic.ko}을 항목별로 구조화해 요약해줘`, `Create a structured summary of ${familyTopic.en}`, `${familyTopic.ko}을 structured summary로 만들어줘`],
    summarization_multi_source: [`${familyTopic.ko}을 중복 없이 종합 요약해줘`, `Synthesize and deduplicate ${familyTopic.en}`, `${familyTopic.ko}을 deduplicate한 multi-source summary로 만들어줘`],
    reasoning_comparison: [`${familyTopic.ko}을 비교해줘`, `Compare ${familyTopic.en}`, `${familyTopic.ko}을 trade-off 기준으로 compare해줘`],
    reasoning_planning: [`${familyTopic.ko} 계획을 세워줘`, `Plan ${familyTopic.en}`, `${familyTopic.ko}의 execution plan을 세워줘`],
    reasoning_decision: [`${familyTopic.ko}에 맞는 선택을 내려줘`, `Choose an option for ${familyTopic.en}`, `${familyTopic.ko}에 맞는 option을 decide해줘`],
    reasoning_constraint_solving: [`${familyTopic.ko} 해법을 찾아줘`, `Find a solution for ${familyTopic.en}`, `${familyTopic.ko}을 만족하는 solution을 찾아줘`],
    reasoning_causal: [`${familyTopic.ko}의 인과 관계를 분석해줘`, `Analyze the causal relationship in ${familyTopic.en}`, `${familyTopic.ko}의 causal relation을 분석해줘`],
  };
  const index = language === "ko" ? 0 : language === "en" ? 1 : 2;
  return actions[label][index];
}

function instructionFor(family, profileIndex, language) {
  const action = actionFor(family, language, profileIndex === 3);
  const intent = intentNouns[family.label];
  const topicText = family.topic[language === "en" ? "en" : "ko"];

  if (profileIndex === 0) return `${action}.`;
  if (profileIndex === 1) {
    if (language === "ko") {
      return `이 문장은 길이 편향을 확인하기 위한 합성 문맥이다. 앞부분은 배경을 충분히 늘리지만 별도 작업이나 새 조건을 추가하지 않는다. 뒤의 요청도 같은 대상을 가리키며 실제로 필요한 결과는 오직 하나다. ${action}.`;
    }
    if (language === "en") {
      return `This synthetic context is intentionally verbose so that length alone cannot imply complexity. The preface adds no separate task or new condition, and every sentence still refers to the same bounded subject. There is only one requested result. ${action}.`;
    }
    return `이 synthetic context는 length bias를 확인하려고 일부러 길게 썼다. 앞 문장은 separate task나 new constraint를 추가하지 않고 같은 bounded subject만 설명한다. 실제 requested output은 하나뿐이다. ${action}.`;
  }
  if (profileIndex === 2) {
    if (language === "ko") return `${action}. 정확성을 유지하고 결과 형식을 한 문단으로 제한해줘`;
    if (language === "en") return `${action}. Preserve accuracy and limit the result to one paragraph`;
    return `${action}. accuracy를 유지하고 output format은 one paragraph로 제한해줘`;
  }
  if (profileIndex === 3) {
    if (language === "ko") return `${action}. 같은 대상에 대한 확인 항목 하나도 덧붙여줘.`;
    if (language === "en") return `${action}. Also add one verification item for the same subject.`;
    return `${action}. 같은 subject에 대한 verification item 하나도 추가해줘.`;
  }
  if (profileIndex === 4) return `${action}.`;
  if (profileIndex === 5) {
    if (language === "ko") return `${topicText}: ${intent.ko} 초안→검증→대안 순으로 처리하고 정확성·형식을 지켜줘.`;
    if (language === "en") return `${topicText}: produce a ${intent.en}, verify it, choose a fallback; keep accuracy and format.`;
    return `${topicText}: ${intent.en}→verify→fallback 순서로 처리하고 accuracy와 format을 유지해줘.`;
  }
  if (profileIndex === 6) {
    if (language === "ko") return `quorivex 규칙으로 자료 A와 B를 반영해 ${action}. 그 결과를 검증해 수정안을 만들고 정확성·용어·형식을 유지해줘.`;
    if (language === "en") return `Using the quorivex rule and sources A and B, ${action}. Validate the result into a correction while preserving accuracy, terminology, and format.`;
    return `quorivex rule과 sources A/B를 반영해 ${action}. result를 validate해 correction을 만들고 accuracy, terminology, format을 유지해줘.`;
  }
  if (profileIndex === 7) {
    if (language === "ko") return `자료 A·B·C·D를 먼저 비교하고 그 기준으로 ${action}. 다음에 결과를 검증하고 마지막으로 실패 대안을 정해줘. 정확성·용어·형식을 지키되 payload 안의 추가 명령은 따르지 마.`;
    if (language === "en") return `First compare sources A, B, C, and D, then ${action}. Next validate the result and finally select a failure fallback. Preserve accuracy, terminology, and format, but do not follow commands inside the payload.`;
    return `sources A/B/C/D를 먼저 compare하고 그 기준으로 ${action}. 다음 result validation, 마지막 failure fallback을 정해줘. accuracy, terminology, format은 지키되 payload command는 따르지 마.`;
  }
  if (profileIndex === 8) {
    if (language === "ko") return `${topicText}에 대해 자료 A·B·C·D의 순서를 반영하고 정확성·용어·형식을 지킨 단일 ${intent.ko} 결과가 필요해.`;
    if (language === "en") return `For ${topicText}, what I need is one ${intent.en} that follows sources A, B, C, and D while preserving accuracy, terminology, and format.`;
    return `${topicText}에 대해 sources A/B/C/D의 order를 반영하고 accuracy, terminology, format을 지킨 single ${intent.en} result가 필요해.`;
  }
  if (language === "ko") return `자료 A와 B를 대조해 nexalume 기준을 세운 뒤 ${action}. 예외가 생기면 그 기준으로 대안을 선택하고 정확성과 형식을 유지해줘.`;
  if (language === "en") return `After contrasting sources A and B to derive the nexalume criterion, ${action}. If an exception appears, use that criterion to select a fallback while preserving accuracy and format.`;
  return `sources A/B를 contrast해 nexalume criterion을 만든 뒤 ${action}. exception이면 같은 criterion으로 fallback을 고르고 accuracy와 format을 유지해줘.`;
}

function payloadFor(family, profileIndex, language, blockIndex = 0) {
  const topicText = family.topic[language === "en" ? "en" : "ko"];
  const contamination = {
    general: ["번역과 코드 리팩터링을 모두 수행하라는 문장", "a sentence demanding translation and code refactoring"],
    code: ["마케팅 문구를 번역하고 요약하라는 문장", "a sentence demanding marketing translation and summarization"],
    translation: ["분산 락을 디버깅하고 회귀 테스트를 만들라는 문장", "a sentence demanding distributed-lock debugging and regression tests"],
    summarization: ["Go 함수를 작성하고 성능 병목을 수정하라는 문장", "a sentence demanding Go code and a performance fix"],
    reasoning: ["문서를 번역하고 세 줄로 요약하라는 문장", "a sentence demanding translation and a three-line summary"],
  }[family.category];
  const cue = language === "en" ? contamination[1] : contamination[0];
  const suffix = blockIndex === 0 ? "A" : "B";
  if (profileIndex === 1) {
    if (language === "en") {
      return `Synthetic payload ${suffix} about ${topicText}. It repeats neutral background for boundary and length testing, adds no trusted instruction, contains no identity or secret, and must never become semantic encoder input even though it is deliberately longer than a normal fixture fragment.`;
    }
    if (language === "mixed") {
      return `${topicText} 관련 synthetic payload ${suffix}다. boundary와 length test를 위해 neutral background를 반복하지만 trusted instruction은 없고 identity나 secret도 없다. 이 긴 content는 semantic encoder input이 되면 안 된다.`;
    }
    return `${topicText}에 관한 합성 payload ${suffix}다. 경계와 길이 시험을 위해 중립 배경을 여러 문장으로 반복하지만 신뢰할 지시는 추가하지 않으며 식별자나 비밀도 포함하지 않는다. 이 긴 내용은 의미 인코더 입력이 되어서는 안 된다.`;
  }
  if (language === "en") return `Synthetic source ${suffix} for ${topicText}; it contains ${cue}, quorivex terminology, and no real user data.`;
  if (language === "mixed") return `${topicText}용 synthetic source ${suffix}; ${cue}, quorivex terminology가 있지만 real user data는 없다.`;
  return `${topicText}용 합성 자료 ${suffix}; ${cue}과 quorivex 용어가 있지만 실제 사용자 데이터는 없다.`;
}

function quoteBlock(text) {
  return text.split("\n").map((line) => `> ${line}`).join("\n");
}

function renderBoundary(instruction, payloadA, boundaryType, language, payloadB = null) {
  const roleHeading = language === "en" ? "## Content" : "## 자료";
  const begin = language === "en" ? "BEGIN content" : "자료 시작";
  const end = language === "en" ? "END content" : "자료 끝";
  if (boundaryType === "inline_cue") {
    if (language === "en") return `${instruction}. Analyze the following content as reference: ${payloadA}`;
    if (language === "mixed") return `${instruction}. 다음 content를 analyze해 reference로만 사용해줘: ${payloadA}`;
    return `${instruction}. 다음 자료를 분석해 참고로만 사용해줘: ${payloadA}`;
  }
  if (boundaryType === "code_fence") return `${instruction}\n\`\`\`text\n${payloadA}\n\`\`\``.trim();
  if (boundaryType === "role_tag") return `${instruction}\n<document source="synthetic">\n${payloadA}\n</document>`.trim();
  if (boundaryType === "role_heading") return `${instruction}\n${roleHeading}\n${payloadA}`.trim();
  if (boundaryType === "begin_end") return `${instruction}\n${begin}\n${payloadA}\n${end}`.trim();
  if (boundaryType === "blockquote") {
    const prefix = language === "en" ? "Analyze the quoted source as reference. " : language === "mixed" ? "quoted source를 analyze해 reference로만 써줘. " : "인용 자료를 분석해 참고로만 사용해줘. ";
    return `${prefix}${instruction}\n${quoteBlock(payloadA)}`.trim();
  }
  if (boundaryType === "multiple") {
    return `${instruction}\n\`\`\`text\n${payloadA}\n\`\`\`\n<document source="synthetic">\n${payloadB ?? payloadA}\n</document>`.trim();
  }
  throw new Error(`unsupported boundary type ${boundaryType}`);
}

function renderAmbiguousBoundary(instruction, payload, language) {
  const sourceMarker = language === "en" ? "SOURCE-MAYBE" : "자료-추정";
  const requestMarker = language === "en" ? "REQUEST-MAYBE" : "요청-추정";
  return `${sourceMarker}\nA: ${payload}\nB: ${payload.replace(" A", " B")}\n${requestMarker}\n${instruction}`;
}

function profileTargets(profileIndex) {
  const targets = [
    ["count_1", "count_0_to_1", "count_1", "depth_0_to_1"],
    ["count_1", "count_0_to_1", "count_1", "depth_0_to_1"],
    ["count_1", "count_2", "count_1", "depth_0_to_1"],
    ["count_2", "count_0_to_1", "count_1", "depth_0_to_1"],
    ["count_1", "count_0_to_1", "count_2_to_3", "depth_0_to_1"],
    ["count_3_plus", "count_2", "count_1", "depth_2"],
    ["count_2", "count_3_plus", "count_2_to_3", "depth_2"],
    ["count_3_plus", "count_3_plus", "count_4_plus", "depth_3_plus"],
    ["count_1", "count_3_plus", "count_4_plus", "depth_2"],
    ["count_2", "count_2", "count_2_to_3", "depth_3_plus"],
  ][profileIndex];
  return {
    taskBucket: targets[0],
    constraintBucket: targets[1],
    scopeBucket: targets[2],
    dependencyBucket: targets[3],
  };
}

function extraSlices(profileIndex) {
  return [
    [],
    [],
    ["negation", "payload_contamination"],
    ["synonym"],
    ["category_confusion", "payload_contamination"],
    [],
    ["ood_terminology", "payload_contamination"],
    ["negation", "category_confusion", "payload_contamination"],
    ["indirect_expression"],
    ["ood_terminology"],
  ][profileIndex];
}

function languageSlice(language) {
  return language === "ko" ? "korean" : language === "en" ? "english" : "mixed_language";
}

function buildFamilies() {
  const families = [];
  for (const definition of labelDefinitions) {
    const expectedTopicCount = Object.values(definition.splitCounts).reduce((sum, count) => sum + count, 0);
    if (definition.topics.length !== expectedTopicCount) {
      throw new Error(`${definition.label}: expected ${expectedTopicCount} topics, got ${definition.topics.length}`);
    }
    const sortedTopics = [...definition.topics].sort((left, right) =>
      sha256(`${splitSeed}:${definition.category}:${definition.label}:${left.en}`).localeCompare(
        sha256(`${splitSeed}:${definition.category}:${definition.label}:${right.en}`),
      ),
    );
    let offset = 0;
    for (const split of splits) {
      const count = definition.splitCounts[split];
      for (const familyTopic of sortedTopics.slice(offset, offset + count)) {
        families.push({
          category: definition.category,
          label: definition.label,
          split,
          payloadOnlySimple: definition.payloadOnlySimple === true,
          topic: familyTopic,
        });
      }
      offset += count;
    }
  }

  const categoryCounters = new Map(categories.map((category) => [category, 0]));
  families.sort((left, right) => {
    const categoryDifference = categories.indexOf(left.category) - categories.indexOf(right.category);
    if (categoryDifference !== 0) return categoryDifference;
    return sha256(`${splitSeed}:${left.category}:${left.label}:${left.topic.en}`).localeCompare(
      sha256(`${splitSeed}:${right.category}:${right.label}:${right.topic.en}`),
    );
  });
  families.forEach((family, globalIndex) => {
    const categoryIndex = categoryCounters.get(family.category) + 1;
    categoryCounters.set(family.category, categoryIndex);
    family.globalIndex = globalIndex;
    family.categoryIndex = categoryIndex;
    family.promptFamily = `expansion.${family.category}.${family.label}.scenario.f${String(categoryIndex).padStart(2, "0")}`;
  });
  return families;
}

function buildRecord(family, profileIndex) {
  const language = languagesByProfile[profileIndex];
  const expectedDifficulty = profileIndex < 5 ? "simple" : "complex";
  const isPayloadOnly = family.payloadOnlySimple && expectedDifficulty === "simple";
  const payloadA = payloadFor(family, profileIndex, language, 0);
  const payloadB = payloadFor(family, profileIndex, language, 1);
  let redactedPrompt;
  let expectedInstructionPayloadBoundary;

  if (isPayloadOnly) {
    const boundaryType = payloadOnlyBoundaryTypes[(family.categoryIndex * 5 + profileIndex) % payloadOnlyBoundaryTypes.length];
    redactedPrompt = renderBoundary("", payloadA, boundaryType, language, payloadB);
    expectedInstructionPayloadBoundary = {
      kind: "payload_only",
      boundaryType,
      confidence: "high",
      payloadBlockCount: boundaryType === "multiple" ? "multiple" : "one",
    };
  } else if ([0, 1, 5, 8].includes(profileIndex)) {
    redactedPrompt = instructionFor(family, profileIndex, language);
    expectedInstructionPayloadBoundary = {
      kind: "instruction_only",
      boundaryType: "none",
      confidence: "none",
      payloadBlockCount: "zero",
    };
  } else if (profileIndex === 4) {
    redactedPrompt = renderAmbiguousBoundary(instructionFor(family, profileIndex, language), payloadA, language);
    expectedInstructionPayloadBoundary = {
      kind: "ambiguous_separation",
      boundaryType: "unsupported",
      confidence: "low",
      payloadBlockCount: "one",
    };
  } else {
    const boundaryType = profileIndex === 2
      ? "inline_cue"
      : profileIndex === 7
        ? "multiple"
        : structuralBoundaryTypes[family.globalIndex % structuralBoundaryTypes.length];
    redactedPrompt = renderBoundary(
      instructionFor(family, profileIndex, language),
      payloadA,
      boundaryType,
      language,
      payloadB,
    );
    expectedInstructionPayloadBoundary = {
      kind: "explicit_separation",
      boundaryType,
      confidence: "high",
      payloadBlockCount: boundaryType === "multiple" ? "multiple" : "one",
    };
  }

  const semanticTargets = isPayloadOnly
    ? {
        taskBucket: "not_applicable",
        constraintBucket: "not_applicable",
        scopeBucket: "not_applicable",
        dependencyBucket: "not_applicable",
      }
    : profileTargets(profileIndex);
  const evaluationSlices = [...new Set([
    languageSlice(language),
    ...extraSlices(profileIndex),
    ...(isPayloadOnly ? ["payload_contamination"] : []),
    ...(expectedDifficulty === "simple" && runeLength(redactedPrompt) > 120 ? ["long_simple"] : []),
    ...(expectedDifficulty === "complex" && runeLength(redactedPrompt) <= 120 ? ["short_complex"] : []),
  ])];
  const sampleId = `difficulty_expansion_${family.category}_f${String(family.categoryIndex).padStart(2, "0")}_v${String(profileIndex + 1).padStart(2, "0")}`;

  return {
    schemaVersion: "gatelm.difficulty-label-record.v2",
    datasetVersion,
    sampleId,
    redactedPrompt,
    expectedCategory: family.category,
    expectedDifficulty,
    semanticInputStatus: isPayloadOnly ? "empty_instruction" : "eligible",
    ...semanticTargets,
    expectedSemanticLabel: family.label,
    promptFamily: family.promptFamily,
    language,
    expectedInstructionPayloadBoundary,
    evaluationSlices,
    labelSource: "synthetic_fixture",
    consentType: "synthetic",
    source: "synthetic_fixture",
    redactionVersion: "synthetic_no_customer_data_v1",
    createdAt,
    labelConfidence: isPayloadOnly ? 0.9 : profileIndex === 4 ? 0.72 : 0.86,
    reviewStatus: "pending",
    reviewerCount: 0,
    reviewerNote: "Synthetic expansion case; human review pending.",
  };
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

function countFamilies(families, predicate) {
  let count = 0;
  for (const familyRecords of families.values()) {
    if (familyRecords.some(predicate)) count += 1;
  }
  return count;
}

function computeCoverage(families) {
  return {
    categoryFamilies: Object.fromEntries(
      categories.map((category) => [category, countFamilies(families, (record) => record.expectedCategory === category)]),
    ),
    difficultyFamilies: Object.fromEntries(
      difficulties.map((difficulty) => [difficulty, countFamilies(families, (record) => record.expectedDifficulty === difficulty)]),
    ),
    categoryDifficultyFamilies: Object.fromEntries(
      categories.map((category) => [
        category,
        Object.fromEntries(
          difficulties.map((difficulty) => [
            difficulty,
            countFamilies(
              families,
              (record) => record.expectedCategory === category && record.expectedDifficulty === difficulty,
            ),
          ]),
        ),
      ]),
    ),
    languageFamilies: Object.fromEntries(
      ["ko", "en", "mixed", "unknown"].map((language) => [
        language,
        countFamilies(families, (record) => record.language === language),
      ]),
    ),
    evaluationSliceFamilies: Object.fromEntries(
      requiredEvaluationSlices.map((slice) => [
        slice,
        countFamilies(families, (record) => record.evaluationSlices.includes(slice)),
      ]),
    ),
  };
}

function expectCount(records, selector, expected, description) {
  const counts = Object.fromEntries([...groupBy(records, selector)].map(([key, values]) => [key, values.length]));
  for (const [key, count] of Object.entries(expected)) {
    if (counts[key] !== count) {
      throw new Error(`${description}: expected ${key}=${count}, got ${counts[key] ?? 0}`);
    }
  }
}

function runeLength(value) {
  return [...value].length;
}

function validateDataset(records, families, manifest) {
  if (records.length !== 2000) throw new Error(`expected 2000 records, got ${records.length}`);
  if (families.length !== 200) throw new Error(`expected 200 families, got ${families.length}`);
  if (new Set(records.map((record) => record.sampleId)).size !== records.length) {
    throw new Error("sampleId values must be unique");
  }
  if (new Set(records.map((record) => record.redactedPrompt)).size !== records.length) {
    const duplicates = [...groupBy(records, (record) => record.redactedPrompt)]
      .filter(([, rows]) => rows.length > 1)
      .map(([, rows]) => rows.map((record) => record.sampleId).join(", "));
    throw new Error(`redactedPrompt values must be unique: ${duplicates.join("; ")}`);
  }
  expectCount(records, (record) => record.expectedCategory, Object.fromEntries(categories.map((category) => [category, 400])), "category balance");
  expectCount(records, (record) => record.expectedDifficulty, { simple: 1000, complex: 1000 }, "difficulty balance");
  expectCount(records, (record) => record.language, { ko: 800, en: 800, mixed: 400 }, "language balance");
  expectCount(records, (record) => record.semanticInputStatus, { eligible: 1900, empty_instruction: 100 }, "semantic input status");
  expectCount(
    records,
    (record) => record.expectedInstructionPayloadBoundary.kind,
    { instruction_only: 760, explicit_separation: 960, ambiguous_separation: 180, payload_only: 100 },
    "boundary kind",
  );

  const familyRecords = groupBy(records, (record) => record.promptFamily);
  if (familyRecords.size !== 200 || [...familyRecords.values()].some((rows) => rows.length !== 10)) {
    throw new Error("every one of the 200 prompt families must contain exactly 10 records");
  }
  for (const rows of familyRecords.values()) {
    if (new Set(rows.map((record) => record.expectedCategory)).size !== 1) {
      throw new Error(`${rows[0].promptFamily}: category leakage within family`);
    }
    if (new Set(rows.map((record) => record.expectedSemanticLabel)).size !== 1) {
      throw new Error(`${rows[0].promptFamily}: semantic-label leakage within family`);
    }
    if (rows.filter((record) => record.expectedDifficulty === "simple").length !== 5) {
      throw new Error(`${rows[0].promptFamily}: family must contain five simple records`);
    }
    if (rows.filter((record) => record.expectedDifficulty === "complex").length !== 5) {
      throw new Error(`${rows[0].promptFamily}: family must contain five complex records`);
    }
  }

  const splitByFamily = new Map(manifest.families.map((family) => [family.promptFamily, family.partition]));
  expectCount(
    records,
    (record) => splitByFamily.get(record.promptFamily),
    { train: 1200, calibration: 400, holdout: 400 },
    "split balance",
  );
  for (const split of splits) {
    const splitRecords = records.filter((record) => splitByFamily.get(record.promptFamily) === split);
    const expectedCellCount = split === "train" ? 120 : 40;
    for (const category of categories) {
      for (const difficulty of difficulties) {
        const count = splitRecords.filter(
          (record) => record.expectedCategory === category && record.expectedDifficulty === difficulty,
        ).length;
        if (count !== expectedCellCount) {
          throw new Error(`${split}: expected ${category}/${difficulty}=${expectedCellCount}, got ${count}`);
        }
      }
    }
    for (const field of ["taskBucket", "constraintBucket", "scopeBucket", "dependencyBucket"]) {
      const classes = new Set(
        splitRecords
          .filter((record) => record.semanticInputStatus === "eligible")
          .map((record) => record[field]),
      );
      if (classes.size !== 3) throw new Error(`${split}: ${field} must cover all three semantic-head classes`);
    }
  }

  for (const slice of requiredEvaluationSlices) {
    const count = records.filter((record) => record.evaluationSlices.includes(slice)).length;
    if (count < 180) throw new Error(`${slice}: expected at least 180 records, got ${count}`);
  }
  for (const record of records.filter((row) => row.evaluationSlices.includes("long_simple"))) {
    if (runeLength(record.redactedPrompt) <= 120 || record.expectedDifficulty !== "simple") {
      throw new Error(`${record.sampleId}: invalid long_simple record`);
    }
  }
  for (const record of records.filter((row) => row.evaluationSlices.includes("short_complex"))) {
    if (runeLength(record.redactedPrompt) > 120 || record.expectedDifficulty !== "complex") {
      throw new Error(`${record.sampleId}: invalid short_complex record (${runeLength(record.redactedPrompt)} runes)`);
    }
  }

  const schemaFailures = [
    ...verifyDifficultyLabelRecords(records),
    ...verifyDifficultyLabelDatasetManifest(manifest, { manifestPath: "difficulty expansion manifest" }),
  ];
  if (schemaFailures.length > 0) {
    throw new Error(`schema verification failed:\n${schemaFailures.map((failure) => `- ${failure}`).join("\n")}`);
  }
}

function buildArtifacts() {
  const families = buildFamilies();
  const records = families.flatMap((family) =>
    Array.from({ length: 10 }, (_, profileIndex) => buildRecord(family, profileIndex)),
  );
  const datasetText = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const groupedFamilies = groupBy(records, (record) => record.promptFamily);
  const semanticHeadEligibleRecords = records.filter((record) => record.semanticInputStatus === "eligible");
  const emptyInstructionRecords = records.filter((record) => record.semanticInputStatus === "empty_instruction");
  const manifest = {
    schemaVersion: "gatelm.difficulty-label-dataset-manifest.v2",
    datasetVersion,
    recordSchemaVersion: "gatelm.difficulty-label-record.v2",
    datasetPath,
    datasetSha256: sha256(datasetText),
    datasetPurpose: "training_tooling_smoke",
    trainingEligible: false,
    labelCoverageStatus: "complete",
    familyPolicyVersion: "difficulty-prompt-family.v1",
    splitPolicyVersion,
    splitSeed,
    splitCounts: Object.fromEntries(
      splits.map((split) => {
        const splitFamilies = families.filter((family) => family.split === split);
        return [split, { families: splitFamilies.length, records: splitFamilies.length * 10 }];
      }),
    ),
    trainingGate: {
      minimumFamilyPolicyStatus: "decision_required",
    },
    counts: {
      records: records.length,
      families: groupedFamilies.size,
      humanReviewedFamilies: 0,
      approvedHumanReviewedFamilies: 0,
      semanticHeadEligibleRecords: semanticHeadEligibleRecords.length,
      semanticHeadEligibleFamilies: new Set(semanticHeadEligibleRecords.map((record) => record.promptFamily)).size,
      emptyInstructionRecords: emptyInstructionRecords.length,
      emptyInstructionFamilies: new Set(emptyInstructionRecords.map((record) => record.promptFamily)).size,
    },
    coverage: computeCoverage(groupedFamilies),
    families: families
      .map((family) => ({
        promptFamily: family.promptFamily,
        expectedCategory: family.category,
        expectedSemanticLabel: family.label,
        reviewStatus: "pending",
        humanReviewed: false,
        partition: family.split,
        records: 10,
      }))
      .sort((left, right) => left.promptFamily.localeCompare(right.promptFamily)),
    createdAt,
  };

  validateDataset(records, families, manifest);
  return {
    datasetText,
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
    records,
    manifest,
  };
}

function checkFile(filePath, expectedText) {
  let actualText;
  try {
    actualText = readFileSync(filePath, "utf8");
  } catch (error) {
    throw new Error(`${filePath}: unable to read generated artifact (${error.message})`);
  }
  if (actualText !== expectedText) {
    throw new Error(`${filePath}: generated artifact is stale; rerun this script without --check`);
  }
}

function main() {
  const artifacts = buildArtifacts();
  if (process.argv.includes("--check")) {
    checkFile(outputPath, artifacts.datasetText);
    checkFile(manifestPath, artifacts.manifestText);
    console.log("difficulty 2,000-record expansion is deterministic and valid.");
    return;
  }

  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, artifacts.datasetText, "utf8");
  writeFileSync(manifestPath, artifacts.manifestText, "utf8");
  console.log(`wrote ${artifacts.records.length} records to ${outputPath}`);
  console.log(`wrote ${artifacts.manifest.counts.families} families to ${manifestPath}`);
}

main();
