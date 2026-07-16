import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  verifyDifficultyLabelDatasetManifest,
  verifyDifficultyLabelRecords,
} from "../verify-v2.1-difficulty-eval.mjs";

const root = path.resolve("docs/v2.1.0/reviews/difficulty-model-path-expansion-3120");
const createdAt = "2026-07-15T00:00:00Z";
const splitSeed = 2026071502;
const familyPolicyVersion = "difficulty-prompt-family.v1";
const splitPolicyVersion = "difficulty-model-path-expansion-family-split.2026-07-15.v1";
const decisionBoundaryVersion = "difficulty-decision-boundary.semantic-empty-combined-8.2026-07-15.v2";
const trainingPolicyVersion = "difficulty-training-policy.single-request-model-path.2026-07-15.v2";
const categories = ["general", "code", "reasoning", "summarization", "translation"];
const difficulties = ["simple", "complex"];
const slices = [
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

const pair = (ko, en) => ({ ko, en });
const hash = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const runeLength = (value) => [...value].length;
const rotate = (values, amount) => values.map((_, index) => values[(index + amount) % values.length]);

const labelCategory = {
  general_explanation: "general",
  general_extraction: "general",
  general_other: "general",
  general_qa: "general",
  general_support: "general",
  general_transformation: "general",
  code_debugging: "code",
  code_design: "code",
  code_explanation: "code",
  code_generation: "code",
  code_refactoring: "code",
  code_review: "code",
  reasoning_causal: "reasoning",
  reasoning_comparison: "reasoning",
  reasoning_constraint_solving: "reasoning",
  reasoning_decision: "reasoning",
  reasoning_planning: "reasoning",
  summarization_direct: "summarization",
  summarization_key_points: "summarization",
  summarization_multi_source: "summarization",
  summarization_structured: "summarization",
  translation_direct: "translation",
  translation_localization: "translation",
  translation_style_preserving: "translation",
};

const partitionLabelCounts = {
  train: {
    general_explanation: 14, general_extraction: 14, general_other: 8, general_qa: 11, general_support: 9, general_transformation: 15,
    code_debugging: 12, code_design: 12, code_explanation: 12, code_generation: 10, code_refactoring: 12, code_review: 12,
    reasoning_causal: 12, reasoning_comparison: 14, reasoning_constraint_solving: 12, reasoning_decision: 8, reasoning_planning: 14,
    summarization_direct: 14, summarization_key_points: 15, summarization_multi_source: 15, summarization_structured: 15,
    translation_direct: 19, translation_localization: 20, translation_style_preserving: 20,
  },
  calibration: {
    general_explanation: 5, general_extraction: 5, general_other: 3, general_qa: 3, general_support: 3, general_transformation: 5,
    code_debugging: 4, code_design: 4, code_explanation: 4, code_generation: 3, code_refactoring: 4, code_review: 4,
    reasoning_causal: 5, reasoning_comparison: 5, reasoning_constraint_solving: 4, reasoning_decision: 2, reasoning_planning: 4,
    summarization_direct: 5, summarization_key_points: 5, summarization_multi_source: 4, summarization_structured: 5,
    translation_direct: 6, translation_localization: 6, translation_style_preserving: 7,
  },
  evaluation: {
    general_explanation: 6, general_extraction: 6, general_other: 4, general_qa: 4, general_support: 4, general_transformation: 6,
    code_debugging: 5, code_design: 5, code_explanation: 5, code_generation: 4, code_refactoring: 5, code_review: 6,
    reasoning_causal: 6, reasoning_comparison: 7, reasoning_constraint_solving: 6, reasoning_decision: 5, reasoning_planning: 6,
    summarization_direct: 7, summarization_key_points: 8, summarization_multi_source: 7, summarization_structured: 8,
    translation_direct: 9, translation_localization: 10, translation_style_preserving: 11,
  },
  promotion: {
    general_explanation: 2, general_extraction: 2, general_other: 1, general_qa: 2, general_support: 1, general_transformation: 2,
    code_debugging: 2, code_design: 2, code_explanation: 2, code_generation: 1, code_refactoring: 1, code_review: 2,
    reasoning_causal: 2, reasoning_comparison: 2, reasoning_constraint_solving: 2, reasoning_decision: 2, reasoning_planning: 2,
    summarization_direct: 2, summarization_key_points: 3, summarization_multi_source: 2, summarization_structured: 3,
    translation_direct: 3, translation_localization: 3, translation_style_preserving: 4,
  },
};

const batchConfigs = [
  { id: "t1", role: "train", partition: "train", families: 80, categories: [18, 18, 15, 15, 14], languages: [149, 134, 117], simpleMajor: 43, sliceCounts: [64, 76, 78, 70, 54, 42, 71, 70], buckets: { task: [194, 125, 81], constraint: [224, 121, 55], scope: [196, 121, 83], dependency: [203, 118, 79] } },
  { id: "t2", role: "train", partition: "train", families: 80, categories: [18, 17, 15, 15, 15], languages: [149, 134, 117], simpleMajor: 43, sliceCounts: [64, 76, 78, 70, 54, 42, 71, 70], buckets: { task: [194, 125, 81], constraint: [224, 121, 55], scope: [196, 121, 83], dependency: [202, 119, 79] } },
  { id: "t3", role: "train", partition: "train", families: 80, categories: [18, 18, 15, 14, 15], languages: [149, 134, 117], simpleMajor: 42, sliceCounts: [64, 76, 78, 70, 54, 42, 71, 70], buckets: { task: [194, 125, 81], constraint: [224, 121, 55], scope: [196, 121, 83], dependency: [202, 119, 79] } },
  { id: "t4", role: "train", partition: "train", families: 79, categories: [17, 17, 15, 15, 15], languages: [147, 134, 114], simpleMajor: 42, sliceCounts: [61, 74, 76, 69, 52, 39, 68, 70], buckets: { task: [192, 125, 78], constraint: [221, 120, 54], scope: [195, 119, 81], dependency: [201, 117, 77] } },
  { id: "c1", role: "calibration", partition: "calibration", families: 55, categories: [13, 12, 10, 10, 10], languages: [103, 93, 79], simpleMajor: 34, sliceCounts: [44, 52, 54, 48, 37, 29, 48, 48], buckets: { task: [134, 86, 55], constraint: [154, 83, 38], scope: [135, 83, 57], dependency: [139, 82, 54] } },
  { id: "c2", role: "calibration", partition: "calibration", families: 50, categories: [11, 11, 10, 9, 9], languages: [93, 84, 73], simpleMajor: 30, sliceCounts: [39, 47, 48, 44, 33, 25, 44, 44], buckets: { task: [121, 78, 51], constraint: [140, 76, 34], scope: [123, 76, 51], dependency: [127, 74, 49] } },
  { id: "e1", role: "evaluation", partition: "holdout", families: 75, categories: [15, 15, 15, 15, 15], languages: [140, 126, 109], simpleMajor: 37, sliceCounts: [59, 71, 73, 65, 50, 38, 66, 65], buckets: { task: [182, 117, 76], constraint: [210, 113, 52], scope: [184, 113, 78], dependency: [190, 111, 74] } },
  { id: "e2", role: "evaluation", partition: "holdout", families: 75, categories: [15, 15, 15, 15, 15], languages: [140, 126, 109], simpleMajor: 38, sliceCounts: [60, 71, 73, 66, 50, 39, 66, 66], buckets: { task: [182, 118, 75], constraint: [210, 114, 51], scope: [184, 114, 77], dependency: [190, 112, 73] } },
  { id: "p1", role: "promotion", partition: "holdout", families: 50, categories: [10, 10, 10, 10, 10], languages: [92, 84, 74], simpleMajor: 25, sliceCounts: [40, 47, 49, 44, 34, 26, 44, 44], buckets: { task: [121, 79, 50], constraint: [140, 76, 34], scope: [122, 75, 53], dependency: [127, 74, 49] } },
];

const scenarioParts = {
  general: {
    objects: [pair("도서관 좌석 예약", "library seat booking"), pair("공유 공구 대여", "shared-tool lending"), pair("동네 강좌 신청", "community class signup"), pair("공연 대기표", "show waitlist"), pair("택배 보관함", "parcel locker"), pair("자전거 정비 접수", "bike repair intake"), pair("급식 알림판", "meal notice board"), pair("반려식물 돌봄표", "plant-care roster"), pair("소규모 전시 안내", "small exhibit guide"), pair("재사용 용기 반납", "reusable-container return"), pair("봉사 일정표", "volunteer schedule"), pair("공동 작업실 출입", "makerspace access")],
    contexts: [pair("마감 직전 변경", "a last-minute change"), pair("주말 운영 예외", "a weekend exception"), pair("중복 접수", "a duplicate submission"), pair("표시 순서 혼동", "a display-order mix-up"), pair("알림 지연", "a delayed notice"), pair("임시 규칙 전환", "a temporary rule change"), pair("빈 상태 화면", "an empty-state screen"), pair("잘못 선택한 옵션", "a mistakenly selected option"), pair("예약 취소 후 복구", "recovery after cancellation"), pair("서로 다른 시간 표기", "inconsistent time notation"), pair("담당자 교대", "an owner handoff"), pair("승인 전 보류", "a pre-approval hold"), pair("이용 조건 갱신", "an eligibility update")],
  },
  code: {
    objects: [pair("Go 일정 병합기", "Go schedule merger"), pair("TypeScript 폼 상태기", "TypeScript form state machine"), pair("Python 배치 재시도기", "Python batch retry helper"), pair("Rust 범위 파서", "Rust range parser"), pair("Kotlin 알림 필터", "Kotlin notification filter"), pair("Java 만료 판정기", "Java expiry checker"), pair("SQL 좌석 할당 쿼리", "SQL seat-allocation query"), pair("C# 파일 이름 검사기", "C# filename validator"), pair("Swift 오프라인 큐", "Swift offline queue"), pair("Ruby 일정 충돌 검사", "Ruby schedule-conflict checker"), pair("Bash 정리 작업", "Bash cleanup task"), pair("Lua 게임 설정 로더", "Lua game-config loader")],
    contexts: [pair("윤일 경계", "a leap-day boundary"), pair("빈 배열 입력", "an empty-array input"), pair("취소 직후 재시도", "a retry after cancellation"), pair("대소문자 혼합 키", "mixed-case keys"), pair("느린 소비자", "a slow consumer"), pair("부분 저장 실패", "a partial-write failure"), pair("동시 갱신", "concurrent updates"), pair("시간대 전환", "a timezone transition"), pair("중복 이벤트", "a duplicate event"), pair("오래된 캐시", "a stale cache"), pair("순서가 뒤바뀐 응답", "out-of-order responses"), pair("호환 버전 혼재", "mixed compatibility versions"), pair("간헐적 테스트", "an intermittent test")],
  },
  reasoning: {
    objects: [pair("이동 도서관 경로", "mobile-library route"), pair("공유 주방 예약 정책", "shared-kitchen booking policy"), pair("지역 축제 우천안", "rain plan for a local festival"), pair("소형 온실 급수 방식", "small-greenhouse watering method"), pair("야간 셔틀 배차", "night-shuttle dispatch"), pair("기부 물품 분류 방식", "donation sorting method"), pair("동아리 예산 배분", "club budget allocation"), pair("팝업 전시 장소", "pop-up exhibit venue"), pair("공동 장비 교체", "shared-equipment replacement"), pair("학습실 좌석 정책", "study-room seating policy"), pair("주말 안내 인력", "weekend guide staffing"), pair("지역 소식 발송 주기", "neighborhood-news cadence")],
    contexts: [pair("비용과 접근성의 상충", "a cost-accessibility trade-off"), pair("예측이 다른 두 자료", "two forecasts that disagree"), pair("인력이 한 명 부족한 상황", "a one-person staffing shortfall"), pair("마감이 앞당겨진 상황", "an accelerated deadline"), pair("실패 비용이 큰 선택", "a choice with high failure cost"), pair("수요가 불확실한 상황", "uncertain demand"), pair("계절별 변동", "seasonal variation"), pair("안전 기준 강화", "stricter safety criteria"), pair("대체안이 제한된 상황", "limited fallback options"), pair("지역별 선호 차이", "regional preference differences"), pair("데이터 일부 누락", "partially missing data"), pair("단기와 장기 효과의 충돌", "a short-versus-long-term conflict"), pair("되돌리기 어려운 결정", "a hard-to-reverse decision")],
  },
  summarization: {
    objects: [pair("마을 회의 메모", "town-meeting notes"), pair("도서 교환 행사 기록", "book-swap event notes"), pair("자전거 점검 일지", "bike-inspection log"), pair("작은 전시 관람 의견", "small-exhibit feedback"), pair("학습 모임 회고", "study-group retrospective"), pair("공유 정원 관찰 기록", "community-garden observations"), pair("지역 셔틀 운행 메모", "local-shuttle operations notes"), pair("급식 만족도 응답", "meal-satisfaction responses"), pair("봉사 인수인계", "volunteer handoff"), pair("작업실 안전 점검", "makerspace safety review"), pair("주말 프로그램 보고", "weekend-program report"), pair("기부 캠페인 기록", "donation-campaign notes")],
    contexts: [pair("결정과 질문이 섞인", "mixing decisions and questions"), pair("서로 다른 날짜가 등장하는", "containing conflicting dates"), pair("중복 문장이 많은", "containing many repeated lines"), pair("담당자가 불분명한", "with unclear ownership"), pair("변경 전후가 섞인", "mixing before-and-after states"), pair("찬반 의견이 나뉜", "split between supporting and opposing views"), pair("후속 조치가 흩어진", "with scattered follow-ups"), pair("수치와 서술이 함께 있는", "combining figures and narrative"), pair("세 장소의 관찰을 합친", "combining observations from three sites"), pair("예외 사례가 숨어 있는", "with hidden exceptions"), pair("시간 순서가 뒤섞인", "with events out of order"), pair("합의와 미해결 항목이 공존하는", "containing consensus and unresolved items"), pair("짧은 자료 여러 개를 모은", "combining several short sources")],
  },
  translation: {
    objects: [pair("공방 예약 안내", "studio booking notice"), pair("지역 축제 표지판", "local-festival signage"), pair("어린이 과학관 설명", "children's science-center copy"), pair("반려동물 진료 준비문", "pet-clinic preparation note"), pair("산책로 안전 안내", "trail safety notice"), pair("재사용 용기 반납문", "reusable-container return copy"), pair("소규모 전시 소개", "small-exhibit introduction"), pair("도서 교환 규칙", "book-swap rules"), pair("공유 주방 알림", "shared-kitchen notice"), pair("야간 셔틀 공지", "night-shuttle announcement"), pair("학습 모임 초대문", "study-group invitation"), pair("자전거 수리 접수문", "bike-repair intake copy")],
    contexts: [pair("미국의 처음 방문하는 독자", "first-time US visitors"), pair("한국의 모바일 화면", "a Korean mobile interface"), pair("영국의 격식 있는 독자", "a formal UK audience"), pair("일본의 짧은 표지판", "compact Japanese signage"), pair("캐나다의 친근한 안내", "friendly Canadian guidance"), pair("호주의 보호자 독자", "Australian caregivers"), pair("독일의 안전 중심 독자", "safety-focused German readers"), pair("프랑스의 문화 행사 독자", "French cultural-event visitors"), pair("스페인의 앱 사용자", "Spanish app users"), pair("싱가포르의 다국어 독자", "multilingual Singapore readers"), pair("인도의 지원 센터", "an Indian help center"), pair("뉴질랜드의 가족 독자", "New Zealand families"), pair("브라질의 짧은 캠페인", "a compact Brazilian campaign")],
  },
};

const scenarioSettings = [
  pair("아침 교대 시간", "during a morning handoff"),
  pair("소규모 시범 운영", "in a small pilot"),
  pair("계절 일정 전환기", "during a seasonal schedule change"),
  pair("임시 연습 환경", "in a temporary practice environment"),
  pair("마감 전 점검 시간", "during a pre-deadline check"),
  pair("주간 운영 회고", "during a weekly operations review"),
  pair("새 안내 방식 시험", "while testing a new guidance format"),
];

const actionSets = {
  general_qa: { ko: ["바로 답해줘", "요점을 짚어줘", "근거 한 줄을 덧붙여줘", "답이 달라지는 조건을 표시해줘"], en: ["answer it directly", "pinpoint the answer", "add one supporting reason", "note the condition that would change the answer"], mixed: ["direct answer를 줘", "핵심 answer를 짚어줘", "supporting reason 한 줄을 더해줘", "answer가 바뀌는 condition을 표시해줘"] },
  general_explanation: { ko: ["작동 원리를 설명해줘", "원리를 풀어줘", "핵심 원인을 구분해줘", "오해하기 쉬운 지점을 확인해줘"], en: ["explain how it works", "unpack the mechanism", "separate the main causes", "flag the easy-to-misread point"], mixed: ["작동 mechanism을 설명해줘", "원리를 unpack해줘", "main cause를 구분해줘", "misread하기 쉬운 point를 표시해줘"] },
  general_extraction: { ko: ["필요한 값을 추출해줘", "관련 항목만 골라내줘", "누락 값을 표시해줘", "중복 항목을 구분해줘"], en: ["extract the needed values", "pick out only the relevant fields", "mark missing values", "separate duplicate entries"], mixed: ["필요한 value를 extract해줘", "relevant field만 골라줘", "missing value를 표시해줘", "duplicate entry를 구분해줘"] },
  general_support: { ko: ["지원 답변을 작성해줘", "도움이 되는 안내를 마련해줘", "사용자가 할 다음 행동을 알려줘", "해결되지 않을 때의 안내를 덧붙여줘"], en: ["write a support response", "prepare helpful guidance", "state the user's next action", "add guidance for an unresolved case"], mixed: ["support response를 작성해줘", "helpful guidance를 마련해줘", "user의 next action을 알려줘", "unresolved case 안내를 덧붙여줘"] },
  general_transformation: { ko: ["요청한 형식으로 바꿔줘", "읽기 좋은 꼴로 재구성해줘", "항목 순서를 정리해줘", "변환 과정의 누락을 확인해줘"], en: ["transform it into the requested format", "reshape it for easy reading", "organize the item order", "check the transformation for omissions"], mixed: ["requested format으로 바꿔줘", "readable structure로 재구성해줘", "item order를 정리해줘", "transformation 누락을 확인해줘"] },
  general_other: { ko: ["알맞은 문안을 만들어줘", "쓰임에 맞는 결과를 꾸려줘", "대안 문구를 하나 더 제안해줘", "가장 자연스러운 안을 골라줘"], en: ["create suitable copy", "compose a result that fits the use", "propose one alternative line", "choose the most natural option"], mixed: ["알맞은 copy를 만들어줘", "use case에 맞는 result를 꾸려줘", "alternative line을 하나 더 제안해줘", "가장 natural한 option을 골라줘"] },
  code_generation: { ko: ["코드를 구현해줘", "작동하는 구현안을 적어줘", "입력 검사를 추가해줘", "작은 테스트 예시를 만들어줘"], en: ["implement the code", "draft a working implementation", "add input validation", "create a small test example"], mixed: ["code를 구현해줘", "working implementation을 적어줘", "input validation을 추가해줘", "small test example을 만들어줘"] },
  code_debugging: { ko: ["버그를 진단해 고쳐줘", "고장 원인을 좁혀줘", "수정 방향을 제안해줘", "재발을 잡는 테스트를 작성해줘"], en: ["debug and fix the fault", "narrow down the root cause", "propose the patch direction", "write a regression test"], mixed: ["bug를 진단해 fix해줘", "root cause를 좁혀줘", "patch 방향을 제안해줘", "regression test를 작성해줘"] },
  code_refactoring: { ko: ["동작을 지키며 리팩터링해줘", "구조를 다듬어줘", "책임 경계를 나눠줘", "회귀 위험을 확인해줘"], en: ["refactor while preserving behavior", "reshape the structure", "separate responsibility boundaries", "check the regression risk"], mixed: ["behavior를 지키며 refactor해줘", "structure를 다듬어줘", "responsibility boundary를 나눠줘", "regression risk를 확인해줘"] },
  code_review: { ko: ["코드를 검토해줘", "결함 가능성을 살펴줘", "우선순위별 지적을 정리해줘", "수정 예시를 제안해줘"], en: ["review the code", "inspect it for likely defects", "rank the findings by priority", "propose a correction example"], mixed: ["code를 review해줘", "likely defect를 살펴줘", "finding을 priority별로 정리해줘", "correction example을 제안해줘"] },
  code_explanation: { ko: ["코드 동작을 설명해줘", "실행 흐름을 풀어줘", "상태 변화를 짚어줘", "주의할 경계를 표시해줘"], en: ["explain the code behavior", "walk through the execution flow", "identify the state changes", "mark the boundary to watch"], mixed: ["code behavior를 설명해줘", "execution flow를 풀어줘", "state change를 짚어줘", "주의할 boundary를 표시해줘"] },
  code_design: { ko: ["구조를 설계해줘", "구성 요소 경계를 잡아줘", "인터페이스를 제안해줘", "실패 처리 흐름을 정해줘"], en: ["design the structure", "shape the component boundaries", "propose the interfaces", "define the failure-handling flow"], mixed: ["structure를 design해줘", "component boundary를 잡아줘", "interface를 제안해줘", "failure-handling flow를 정해줘"] },
  reasoning_causal: { ko: ["인과 관계를 분석해줘", "원인 고리를 추적해줘", "다른 설명을 검토해줘", "결론을 바꿀 증거를 제시해줘"], en: ["analyze the causal relationship", "trace the causal chain", "evaluate an alternative explanation", "state the evidence that would change the conclusion"], mixed: ["causal relation을 분석해줘", "causal chain을 추적해줘", "alternative explanation을 검토해줘", "conclusion을 바꿀 evidence를 제시해줘"] },
  reasoning_comparison: { ko: ["대안을 비교해줘", "선택지를 견줘줘", "차이를 기준별로 평가해줘", "조건에 맞는 쪽을 추천해줘"], en: ["compare the alternatives", "weigh the options", "evaluate the differences by criterion", "recommend the option that fits"], mixed: ["alternative를 비교해줘", "option을 견줘줘", "difference를 criterion별로 평가해줘", "조건에 맞는 option을 추천해줘"] },
  reasoning_constraint_solving: { ko: ["조건을 만족하는 해를 찾아줘", "제약을 맞추는 방법을 풀어줘", "가능한 조합을 확인해줘", "불가능할 때 최소 완화안을 제안해줘"], en: ["find a solution satisfying the conditions", "work out a constraint-fitting approach", "check the feasible combinations", "propose the smallest relaxation if none works"], mixed: ["condition을 만족하는 solution을 찾아줘", "constraint-fitting 방법을 풀어줘", "feasible combination을 확인해줘", "불가능하면 minimum relaxation을 제안해줘"] },
  reasoning_decision: { ko: ["선택을 내려줘", "근거에 맞는 안을 골라줘", "선택 이유를 평가해줘", "차선책을 정해줘"], en: ["make the decision", "choose the evidence-backed option", "evaluate the reason for the choice", "select a fallback"], mixed: ["decision을 내려줘", "evidence 기반 option을 골라줘", "choice reason을 평가해줘", "fallback을 정해줘"] },
  reasoning_planning: { ko: ["실행 계획을 세워줘", "진행 순서를 짜줘", "단계별 확인점을 정해줘", "지연될 때의 대안을 제안해줘"], en: ["create an execution plan", "lay out the work order", "define the checkpoints", "propose a fallback for delays"], mixed: ["execution plan을 세워줘", "work order를 짜줘", "checkpoint를 정해줘", "delay fallback을 제안해줘"] },
  summarization_direct: { ko: ["짧게 요약해줘", "내용을 간추려줘", "핵심 문장을 뽑아줘", "한 줄 결론을 덧붙여줘"], en: ["summarize it briefly", "condense the content", "extract the central sentence", "add a one-line conclusion"], mixed: ["brief summary로 만들어줘", "content를 간추려줘", "central sentence를 뽑아줘", "one-line conclusion을 덧붙여줘"] },
  summarization_key_points: { ko: ["핵심을 추려 요약해줘", "요지만 뽑아줘", "중요 항목을 묶어줘", "빠진 질문을 표시해줘"], en: ["summarize the key points", "distill the essentials", "group the important items", "flag unanswered questions"], mixed: ["key point를 요약해줘", "essential만 뽑아줘", "important item을 묶어줘", "unanswered question을 표시해줘"] },
  summarization_multi_source: { ko: ["자료를 종합 요약해줘", "여러 기록을 한 흐름으로 엮어줘", "중복 내용을 합쳐줘", "서로 다른 주장을 표시해줘"], en: ["synthesize the sources", "weave the records into one account", "merge duplicate content", "flag conflicting claims"], mixed: ["source를 종합 summary해줘", "record를 one account로 엮어줘", "duplicate content를 합쳐줘", "conflicting claim을 표시해줘"] },
  summarization_structured: { ko: ["구조화해 요약해줘", "항목별 개요로 묶어줘", "결정과 후속 조치를 나눠줘", "미해결 항목을 표시해줘"], en: ["create a structured summary", "organize it into a sectioned digest", "separate decisions from follow-ups", "flag unresolved items"], mixed: ["structured summary로 만들어줘", "sectioned digest로 묶어줘", "decision과 follow-up을 나눠줘", "unresolved item을 표시해줘"] },
  translation_direct: { ko: ["직접 번역해줘", "뜻을 살려 옮겨줘", "애매한 표현을 표시해줘", "대체 번역 하나를 덧붙여줘"], en: ["translate it directly", "render it faithfully", "flag ambiguous wording", "add one alternative translation"], mixed: ["direct translation을 해줘", "meaning을 살려 옮겨줘", "ambiguous wording을 표시해줘", "alternative translation을 하나 더해줘"] },
  translation_localization: { ko: ["독자에 맞게 현지화해줘", "지역 표현에 맞춰 옮겨줘", "문화적으로 어색한 부분을 다듬어줘", "현지 대안을 제안해줘"], en: ["localize the text", "adapt the wording to local usage", "smooth culturally awkward wording", "propose a local alternative"], mixed: ["audience에 맞게 localize해줘", "local usage에 맞춰 옮겨줘", "culturally awkward한 부분을 다듬어줘", "local alternative를 제안해줘"] },
  translation_style_preserving: { ko: ["스타일을 보존해 번역해줘", "목소리를 살려 옮겨줘", "정의된 표현을 확인해줘", "말투가 흔들린 곳을 표시해줘"], en: ["translate while preserving the style", "carry over the original voice", "check the defined expressions", "flag places where the voice drifts"], mixed: ["style을 보존해 translate해줘", "original voice를 살려 옮겨줘", "defined expression을 확인해줘", "voice가 흔들린 곳을 표시해줘"] },
};

const scopeNouns = {
  general: pair("기록", "records"), code: pair("파일", "files"), reasoning: pair("대안", "options"),
  summarization: pair("자료", "sources"), translation: pair("원문", "source passages"),
};

const constraintPool = {
  ko: ["결과의 레이아웃을 그대로 둬", "핵심 명칭을 일관되게 써", "요청한 어조를 지켜", "안전 관련 가정을 추가하지 마", "처리 속도 수치를 꾸며내지 마", "결과는 두 문단 안에 담아", "이전 버전과의 연결을 깨지 마", "검증 범위를 벗어나지 마"],
  en: ["keep the result layout unchanged", "use the key names consistently", "retain the requested voice", "do not invent safety assumptions", "do not fabricate processing-speed figures", "keep the result within two paragraphs", "do not break older-version behavior", "stay inside the stated validation range"],
  mixed: ["result layout을 그대로 둬", "key name을 consistent하게 써", "requested voice를 지켜", "safety assumption을 추가하지 마", "processing-speed figure를 꾸며내지 마", "result를 two paragraphs 안에 담아", "older-version behavior를 깨지 마", "stated validation range를 벗어나지 마"],
};

const decoyContext = {
  general: pair("코드와 번역 용어는 배경일 뿐이다", "code and translation terms are only background"),
  code: pair("마케팅 문구와 요약 메모는 배경일 뿐이다", "marketing copy and summary notes are only background"),
  reasoning: pair("원문 번역과 코드 예시는 배경일 뿐이다", "translation text and code examples are only background"),
  summarization: pair("함수명과 대상 언어 표시는 배경일 뿐이다", "function names and target-language labels are only background"),
  translation: pair("디버깅 로그와 의사결정 표는 배경일 뿐이다", "debug logs and decision tables are only background"),
};

const longPrefaces = {
  ko: {
    general: "다음 교대자가 운영 맥락을 바로 이해할 수 있도록 배경을 조금 자세히 적어 둔다. 기록에 나오는 대상과 시점은 모두 같은 한 건을 설명한다.",
    code: "작은 연습용 프로젝트에서 재현 조건을 정리하고 있다. 입력 상황과 실행 시점을 나눠 적었지만 확인할 구현은 이 한 부분이다.",
    reasoning: "운영 회의 전에 현재 조건을 빠짐없이 공유하려고 배경을 적는다. 이번 논의에서 판단할 대상은 아래에 적은 한 가지 선택이다.",
    summarization: "다음 담당자가 흐름을 놓치지 않도록 기록이 만들어진 맥락을 함께 남긴다. 아래 내용은 같은 사건을 설명하는 한 묶음의 메모다.",
    translation: "게시 전에 독자와 사용 장면을 분명히 해 두려고 배경을 함께 적는다. 옮길 원문은 한 건이며 아래 맥락에서 읽힐 예정이다.",
  },
  en: {
    general: "I am leaving enough background for the next shift to understand the operating context. The object and timing below all describe the same single case.",
    code: "I am documenting the reproduction conditions in a small practice project. The input situation and runtime are described separately, but only this implementation is in scope.",
    reasoning: "I am writing down the current conditions before an operations meeting so the context is clear. The discussion concerns the one choice described below.",
    summarization: "I am keeping the context with these notes so the next coordinator can follow the thread. Everything below belongs to one record of the same event.",
    translation: "I am including the audience and usage context before publication. There is one source passage, and it will be read in the setting described below.",
  },
  mixed: {
    general: "다음 shift가 operating context를 바로 이해할 수 있도록 background를 조금 자세히 적어 둔다. 아래 object와 timing은 같은 한 건을 설명한다.",
    code: "작은 practice project에서 reproduction condition을 정리하고 있다. input 상황과 runtime을 나눠 적었지만 확인할 implementation은 이 부분 하나다.",
    reasoning: "operations meeting 전에 current condition을 빠짐없이 공유하려고 background를 적는다. 이번 discussion 대상은 아래의 choice 하나다.",
    summarization: "다음 coordinator가 흐름을 놓치지 않도록 notes가 만들어진 context를 함께 남긴다. 아래 내용은 same event의 record 한 묶음이다.",
    translation: "publish 전에 audience와 usage context를 분명히 하려고 background를 함께 적는다. source passage는 한 건이고 아래 setting에서 읽힐 예정이다.",
  },
};

const complexPrefaces = {
  ko: {
    general: "이 요청은 다음 운영 검토에 바로 사용할 예정이다. 입력 범위와 결과 형식, 확인 순서를 한 흐름으로 함께 처리해줘.",
    code: "작은 연습용 프로젝트에 반영할 변경이다. 구현과 검증 규칙, 실패 처리 순서를 서로 이어진 조건으로 다뤄줘.",
    reasoning: "운영 회의에서 이 판단을 사용할 예정이다. 대안과 기준, 확인 결과에 따른 차선책을 한 흐름으로 검토해줘.",
    summarization: "다음 담당자에게 넘길 기록이다. 자료 범위와 요약 구조, 후속 확인을 서로 이어진 결과로 만들어줘.",
    translation: "편집 검토 뒤 게시할 문장이다. 독자 맥락과 용어 규칙, 검토 순서를 함께 적용해줘.",
  },
  en: {
    general: "This request will be used in the next operations review. Handle the input scope, result format, and verification order as one connected flow.",
    code: "This change is for a small practice project. Treat the implementation, validation rules, and failure-handling order as connected requirements.",
    reasoning: "This decision will be used in an operations meeting. Review the options, criteria, and fallback from the check result as one connected flow.",
    summarization: "These notes will go to the next coordinator. Keep the source scope, summary structure, and follow-up check connected in the result.",
    translation: "This text will be published after an editorial check. Apply the audience context, terminology rules, and review order together.",
  },
  mixed: {
    general: "이 request는 다음 operations review에 바로 쓸 예정이다. input scope와 result format, verification order를 한 flow로 처리해줘.",
    code: "작은 practice project에 반영할 change다. implementation, validation rule, failure-handling order를 connected requirement로 다뤄줘.",
    reasoning: "operations meeting에서 이 decision을 쓸 예정이다. option, criterion, check result에 따른 fallback을 한 flow로 검토해줘.",
    summarization: "다음 coordinator에게 넘길 notes다. source scope, summary structure, follow-up check를 하나의 result로 이어줘.",
    translation: "editorial check 뒤 publish할 text다. audience context, terminology rule, review order를 함께 적용해줘.",
  },
};

const longContextDetails = {
  ko: [
    "다음 근무자가 바로 읽을 수 있도록 대상과 시점을 문장 안에 분명히 적었다.",
    "관련 메모가 흩어지지 않도록 필요한 배경을 한곳에 모아 두었다.",
    "검토 시점을 놓치지 않게 운영 상황과 사용 맥락을 함께 남긴다.",
    "인수인계 뒤에도 같은 장면을 이해할 수 있도록 상황을 풀어 썼다.",
    "앞뒤 기록을 다시 찾지 않아도 되도록 필요한 맥락을 문장에 포함했다.",
    "배포 전에 확인하기 쉽도록 대상과 이용 환경을 함께 기록했다.",
    "이 항목을 처음 보는 담당자도 이해할 수 있게 배경을 한 문단으로 정리했다.",
  ],
  en: [
    "I named the object and timing explicitly so the next shift can read this without extra context.",
    "I gathered the relevant background here so the handoff notes do not become scattered.",
    "The operating situation and usage context are included to make the review timing clear.",
    "I spelled out the situation so a new coordinator can understand the same scene after handoff.",
    "The needed context is included here so no one has to search through earlier notes.",
    "I recorded the object and usage setting together to make the pre-publication check easier.",
    "The background is kept in one paragraph for a coordinator seeing this item for the first time.",
  ],
  mixed: [
    "다음 shift가 바로 읽을 수 있도록 object와 timing을 문장 안에 분명히 적었다.",
    "handoff note가 흩어지지 않도록 relevant background를 한곳에 모아 두었다.",
    "review timing을 놓치지 않게 operating situation과 usage context를 함께 남긴다.",
    "새 coordinator도 같은 scene을 이해할 수 있도록 situation을 풀어 썼다.",
    "earlier note를 다시 찾지 않아도 되도록 필요한 context를 문장에 포함했다.",
    "publish 전 check가 쉽도록 object와 usage setting을 함께 기록했다.",
    "이 item을 처음 보는 coordinator도 이해하도록 background를 한 paragraph로 정리했다.",
  ],
};

function semanticScenario(family, language) {
  const source = scenarioParts[family.category];
  // Each category has fewer families than its object/context product. Walking
  // the product directly prevents template twins from crossing frozen roles.
  const objectIndex = family.categoryIndex % source.objects.length;
  const contextIndex = Math.floor(family.categoryIndex / source.objects.length) % source.contexts.length;
  const settingIndex = Math.floor(family.categoryIndex / (source.objects.length * source.contexts.length)) % scenarioSettings.length;
  const object = source.objects[objectIndex];
  const context = source.contexts[contextIndex];
  const setting = scenarioSettings[settingIndex];
  const key = language === "en" ? "en" : "ko";
  const objectText = object[key];
  const contextText = context[key];
  const settingText = setting[key];
  const patterns = {
    general: key === "en" ? `${objectText} under ${contextText} ${settingText}` : `${settingText}의 ${contextText} 상황에 놓인 ${objectText}`,
    code: key === "en" ? `${objectText} facing ${contextText} ${settingText}` : `${settingText}에 ${contextText} 조건으로 실행되는 ${objectText}`,
    reasoning: key === "en" ? `${objectText} with ${contextText} ${settingText}` : `${settingText}에 ${contextText}이 있는 ${objectText}`,
    summarization: key === "en" ? `${objectText} ${contextText} ${settingText}` : `${settingText}에 작성된 ${contextText} ${objectText}`,
    translation: key === "en" ? `${objectText} for ${contextText} ${settingText}` : `${settingText}에 ${contextText}에게 보여줄 ${objectText}`,
  };
  const shortPatterns = {
    general: key === "en" ? `${objectText} with ${contextText}` : `${contextText} 상황의 ${objectText}`,
    code: key === "en" ? `${objectText} reproducing ${contextText}` : `${contextText} 조건의 ${objectText}`,
    reasoning: key === "en" ? `${objectText} under ${contextText}` : `${contextText}에서의 ${objectText}`,
    summarization: key === "en" ? `${objectText} with ${contextText}` : `${contextText} ${objectText}`,
    translation: key === "en" ? `${objectText} for ${contextText}` : `${contextText} 대상 ${objectText}`,
  };
  const compactWord = (value, stopWords) => {
    const word = value.split(/[^\p{L}\p{N}-]+/u).find((candidate) => candidate && !stopWords.has(candidate.toLowerCase())) ?? value;
    return language === "en" ? word.slice(0, 8) : [...word].slice(0, 5).join("");
  };
  const stopWords = new Set(["a", "an", "the", "during", "in", "while", "with"]);
  const contextWords = contextText
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((candidate) => candidate && !stopWords.has(candidate.toLowerCase()));
  const contextTail = contextWords.length > 1
    ? (language === "en" ? contextWords.at(-1).slice(0, 5) : [...contextWords.at(-1)].slice(0, 3).join(""))
    : "";
  const compactContext = [compactWord(contextText, stopWords), contextTail].filter(Boolean).join("-");
  const compact = [compactWord(objectText, stopWords), compactContext, compactWord(settingText, stopWords)].join("·");
  const briefWords = (value) => value
    .split(/[^\p{L}\p{N}-]+/u)
    .filter((candidate) => candidate && !stopWords.has(candidate.toLowerCase()));
  const compactPair = (value) => {
    const words = briefWords(value);
    if (words.length < 2) return words[0] ?? value;
    return `${words[0]} ${words.at(-1)}`;
  };
  const briefObject = compactPair(objectText);
  const briefContext = compactPair(contextText);
  const koreanBrief = family.category === "translation"
    ? `${contextText}용 ${objectText}`
    : family.category === "summarization"
      ? `${contextText} ${objectText}`
      : `${contextText} 조건의 ${objectText}`;
  const brief = key === "en" ? `${briefObject} (${briefContext})` : koreanBrief;
  const ultraPair = (value) => {
    const words = briefWords(value);
    if (words.length === 0) return value;
    const first = words[0].split("-").at(-1);
    const last = words.at(-1);
    return first === last ? first : `${first} ${last}`;
  };
  const ultraBrief = key === "en" ? `${ultraPair(objectText)} (${ultraPair(contextText)})` : brief;
  return { full: patterns[family.category], short: shortPatterns[family.category], brief, ultraBrief, compact };
}

function syntheticTerm(index) {
  const first = ["tal", "nex", "vori", "lum", "sena", "kavi", "daro", "miri", "pelo", "runa", "zemi", "faro", "bex", "cori", "hanu", "jexa", "lori", "mavo", "puri", "savi", "tori", "vexa", "yuni", "zaro"];
  const second = ["lume", "vex", "nari", "toma", "rion", "sela", "prax", "dine", "kora", "melo", "fira", "glen", "havi", "juno", "lix", "mora", "nexi", "pavo", "qira", "suno", "tavi", "voro", "wena", "xilo", "yara", "zumi"];
  return `${first[index % first.length]}${second[Math.floor(index / first.length) % second.length]}`;
}

function buildFamilies() {
  const labels = Object.keys(labelCategory);
  const labelIndexes = new Map(labels.map((label, index) => [label, index]));
  const roleFamilies = {};
  const categoryIndexes = new Map(categories.map((category) => [category, 0]));
  let globalIndex = 0;
  for (const [role, counts] of Object.entries(partitionLabelCounts)) {
    roleFamilies[role] = [];
    for (const [label, count] of Object.entries(counts)) {
      for (let ordinal = 0; ordinal < count; ordinal++) {
        const category = labelCategory[label];
        const categoryIndex = categoryIndexes.get(category);
        roleFamilies[role].push({
          role,
          category,
          categoryIndex,
          label,
          labelIndex: labelIndexes.get(label),
          ordinal,
          globalIndex,
          promptFamily: `modelpath3120.${label}.scenario.f${String(globalIndex + 1).padStart(4, "0")}`,
        });
        categoryIndexes.set(category, categoryIndex + 1);
        globalIndex++;
      }
    }
  }

  const markerOrder = Object.values(roleFamilies)
    .flat()
    .sort((left, right) => hash(`${splitSeed}:marker:${left.promptFamily}`).localeCompare(hash(`${splitSeed}:marker:${right.promptFamily}`)));
  markerOrder.forEach((family, markerIndex) => {
    family.markerIndex = markerIndex;
  });

  const assigned = [];
  for (const role of Object.keys(roleFamilies)) {
    const roleBatches = batchConfigs.filter((batch) => batch.role === role);
    for (const [categoryIndex, category] of categories.entries()) {
      const pool = roleFamilies[role]
        .filter((family) => family.category === category)
        .sort((left, right) => hash(`${splitSeed}:${left.promptFamily}`).localeCompare(hash(`${splitSeed}:${right.promptFamily}`)));
      let offset = 0;
      for (const batch of roleBatches) {
        const count = batch.categories[categoryIndex];
        for (const family of pool.slice(offset, offset + count)) {
          family.batchId = batch.id;
          family.partition = batch.partition;
          assigned.push(family);
        }
        offset += count;
      }
      if (offset !== pool.length) throw new Error(`${role}/${category}: batch family quota mismatch`);
    }
  }
  if (assigned.length !== 624) throw new Error(`expected 624 families, got ${assigned.length}`);
  return assigned;
}

function languagePairTypes(batch) {
  const [ko, en, mixed] = batch.languages.map((count) => count - batch.families);
  const koEn = (ko + en - mixed) / 2;
  const koMixed = (ko + mixed - en) / 2;
  const enMixed = (en + mixed - ko) / 2;
  if (![koEn, koMixed, enMixed].every(Number.isInteger) || koEn + koMixed + enMixed !== batch.families) {
    throw new Error(`${batch.id}: invalid language family pairing`);
  }
  return [
    ...Array.from({ length: koEn }, () => ["ko", "en"]),
    ...Array.from({ length: koMixed }, () => ["ko", "mixed"]),
    ...Array.from({ length: enMixed }, () => ["en", "mixed"]),
  ];
}

function buildBatchRecords(batch, allFamilies) {
  const families = allFamilies
    .filter((family) => family.batchId === batch.id)
    .sort((left, right) => hash(`${splitSeed}:batch:${left.promptFamily}`).localeCompare(hash(`${splitSeed}:batch:${right.promptFamily}`)));
  if (families.length !== batch.families) throw new Error(`${batch.id}: family count mismatch`);

  const simpleMajorFamilies = new Set(families.slice(0, batch.simpleMajor).map((family) => family.promptFamily));
  const pairTypes = languagePairTypes(batch);
  const records = [];
  families.forEach((family, familyIndex) => {
    const pairType = pairTypes[familyIndex];
    const languages = rotate(["ko", "en", "mixed", ...pairType], (family.globalIndex + 2) % 5);
    const difficultyBase = simpleMajorFamilies.has(family.promptFamily)
      ? ["simple", "simple", "simple", "complex", "complex"]
      : ["simple", "simple", "complex", "complex", "complex"];
    const difficultyValues = rotate(difficultyBase, (family.globalIndex * 3 + 1) % 5);
    for (let variant = 0; variant < 5; variant++) {
      records.push({
        family,
        variant,
        language: languages[variant],
        expectedDifficulty: difficultyValues[variant],
        semanticLoad: 0,
        sliceLoad: 0,
        evaluationSlices: [],
        bucketStates: {},
      });
    }
  });
  return records;
}

function stableLoadSort(values, key) {
  return [...values].sort((left, right) => {
    const difference = key(left) - key(right);
    if (difference !== 0) return difference;
    return hash(`${splitSeed}:${left.family.promptFamily}:${left.variant}`).localeCompare(
      hash(`${splitSeed}:${right.family.promptFamily}:${right.variant}`),
    );
  });
}

function assignBucketDimension(records, dimension, counts) {
  const [, moderateTarget, strongTarget] = counts;
  const assigned = new Set();
  let strongRemaining = strongTarget;
  let moderateRemaining = moderateTarget;

  if (dimension === "scope") {
    const required = records.filter((record) => ["summarization_multi_source", "reasoning_comparison", "reasoning_decision"].includes(record.family.label));
    const requiredComplex = stableLoadSort(required.filter((record) => record.expectedDifficulty === "complex"), (record) => record.semanticLoad);
    for (const record of requiredComplex.slice(0, Math.min(strongRemaining, requiredComplex.length))) {
      record.bucketStates[dimension] = "strong";
      record.semanticLoad += 2;
      assigned.add(record);
      strongRemaining--;
    }
    for (const record of stableLoadSort(required.filter((record) => !assigned.has(record)), (item) => item.semanticLoad)) {
      if (moderateRemaining <= 0) throw new Error("scope quota cannot cover semantic-label minimum scope");
      record.bucketStates[dimension] = "moderate";
      record.semanticLoad += 1;
      assigned.add(record);
      moderateRemaining--;
    }
  }

  const strongCandidates = stableLoadSort(
    records.filter((record) => record.expectedDifficulty === "complex" && !assigned.has(record)),
    (record) => record.semanticLoad,
  );
  for (const record of strongCandidates.slice(0, strongRemaining)) {
    record.bucketStates[dimension] = "strong";
    record.semanticLoad += 2;
    assigned.add(record);
  }
  if (strongCandidates.length < strongRemaining) throw new Error(`${dimension}: not enough complex records for strong bucket`);

  const complexModerate = stableLoadSort(
    records.filter((record) => record.expectedDifficulty === "complex" && !assigned.has(record)),
    (record) => record.semanticLoad,
  );
  for (const record of complexModerate.slice(0, Math.min(moderateRemaining, complexModerate.length))) {
    record.bucketStates[dimension] = "moderate";
    record.semanticLoad += 1;
    assigned.add(record);
    moderateRemaining--;
  }
  const simpleModerate = stableLoadSort(
    records.filter((record) => record.expectedDifficulty === "simple" && !assigned.has(record)),
    (record) => record.semanticLoad,
  );
  for (const record of simpleModerate.slice(0, moderateRemaining)) {
    record.bucketStates[dimension] = "moderate";
    record.semanticLoad += 1;
    assigned.add(record);
  }
  if (simpleModerate.length < moderateRemaining) throw new Error(`${dimension}: not enough records for moderate bucket`);
  for (const record of records) {
    if (!record.bucketStates[dimension]) record.bucketStates[dimension] = "low";
  }
}

function assignSlice(records, slice, count, predicate = () => true) {
  const candidates = stableLoadSort(records.filter((record) => predicate(record)), (record) => record.sliceLoad);
  if (candidates.length < count) throw new Error(`${slice}: not enough eligible records`);
  for (const record of candidates.slice(0, count)) {
    record.evaluationSlices.push(slice);
    record.sliceLoad++;
  }
}

function assignProfiles(batch, records) {
  for (const dimension of ["scope", "task", "constraint", "dependency"]) {
    assignBucketDimension(records, dimension, batch.buckets[dimension]);
  }
  const [negation, indirect, synonym, shortComplex, longSimple, payload, categoryConfusion, ood] = batch.sliceCounts;
  assignSlice(records, "short_complex", shortComplex, (record) => record.expectedDifficulty === "complex");
  assignSlice(records, "long_simple", longSimple, (record) => record.expectedDifficulty === "simple");
  assignSlice(
    records,
    "payload_contamination",
    payload,
    (record) => !record.evaluationSlices.includes("short_complex") &&
      (record.expectedDifficulty === "complex" || record.evaluationSlices.includes("long_simple")),
  );
  assignSlice(records, "indirect_expression", indirect);
  assignSlice(records, "synonym", synonym);
  assignSlice(records, "negation", negation);
  assignSlice(records, "category_confusion", categoryConfusion);
  assignSlice(records, "ood_terminology", ood);
  for (const record of records) {
    record.evaluationSlices.unshift(record.language === "ko" ? "korean" : record.language === "en" ? "english" : "mixed_language");
  }
}

function taskCount(state) {
  return state === "strong" ? 3 : state === "moderate" ? 2 : 1;
}

function localized(record, values) {
  return values[record.language];
}

const compactPrimary = {
  general_qa: ["답을 내줘", "give the answer", "answer를 줘"], general_explanation: ["원리를 설명해줘", "explain the mechanism", "mechanism을 설명해줘"],
  general_extraction: ["값을 추출해줘", "extract the fields", "field를 추출해줘"], general_support: ["지원 안내를 써줘", "draft support guidance", "support 안내를 써줘"],
  general_transformation: ["형식을 바꿔줘", "transform the format", "format을 바꿔줘"], general_other: ["문안을 만들어줘", "create the copy", "copy를 만들어줘"],
  code_generation: ["코드를 구현해줘", "implement the code", "code를 구현해줘"], code_debugging: ["버그를 진단해줘", "debug the fault", "bug를 진단해줘"],
  code_refactoring: ["리팩터링해줘", "refactor it", "refactor해줘"], code_review: ["코드를 검토해줘", "review the code", "code를 review해줘"],
  code_explanation: ["동작을 설명해줘", "explain the code", "code 동작을 설명해줘"], code_design: ["구조를 설계해줘", "design the structure", "structure를 설계해줘"],
  reasoning_causal: ["인과를 분석해줘", "trace the causes", "causal 관계를 분석해줘"], reasoning_comparison: ["대안을 비교해줘", "compare the options", "option을 비교해줘"],
  reasoning_constraint_solving: ["제약을 풀어줘", "solve the constraints", "constraint를 풀어줘"], reasoning_decision: ["선택해줘", "choose the option", "option을 골라줘"],
  reasoning_planning: ["실행 계획을 짜줘", "plan the execution", "execution plan을 짜줘"], summarization_direct: ["바로 요약해줘", "summarize it", "바로 summary해줘"],
  summarization_key_points: ["핵심을 요약해줘", "distill the points", "key point를 요약해줘"], summarization_multi_source: ["자료를 종합해줘", "synthesize the sources", "source를 종합해줘"],
  summarization_structured: ["구조화해 요약해줘", "structure the summary", "structured summary로 만들어줘"], translation_direct: ["직접 번역해줘", "translate it directly", "direct translation해줘"],
  translation_localization: ["현지화해줘", "localize it", "localize해줘"], translation_style_preserving: ["스타일을 살려 번역해줘", "preserve the style in translation", "style을 살려 translate해줘"],
};

function compactOperations(record) {
  const languageIndex = record.language === "ko" ? 0 : record.language === "en" ? 1 : 2;
  const primary = compactPrimary[record.family.label][languageIndex];
  const count = taskCount(record.bucketStates.task);
  if (count === 1) return primary;
  if (record.language === "en") return count === 2 ? `${primary}+check` : `${primary}+check+recovery`;
  if (record.language === "mixed") return count === 2 ? `${primary}+check` : `${primary}+check+recovery`;
  return count === 2 ? `${primary}+검토` : `${primary}+검토+대안`;
}

const terseEnglishPrimary = {
  general_qa: "answer", general_explanation: "explain", general_extraction: "extract", general_support: "support reply",
  general_transformation: "transform", general_other: "write copy", code_generation: "implement", code_debugging: "debug",
  code_refactoring: "refactor", code_review: "review", code_explanation: "explain code", code_design: "design",
  reasoning_causal: "trace causes", reasoning_comparison: "compare", reasoning_constraint_solving: "solve constraints", reasoning_decision: "choose",
  reasoning_planning: "plan", summarization_direct: "summarize", summarization_key_points: "key-point summary", summarization_multi_source: "synthesize",
  summarization_structured: "structured summary", translation_direct: "translate", translation_localization: "localize", translation_style_preserving: "preserve style",
};

function terseEnglishOperations(record) {
  const primary = terseEnglishPrimary[record.family.label];
  const count = taskCount(record.bucketStates.task);
  return count === 1 ? primary : count === 2 ? `${primary}+check` : `${primary}+check+fallback`;
}

function renderShort(record) {
  const scenarioData = semanticScenario(record.family, record.language);
  const actions = localized(record, actionSets[record.family.label]);
  const operationCount = taskCount(record.bucketStates.task);
  const languageIndex = record.language === "ko" ? 0 : record.language === "en" ? 1 : 2;
  const primaryNoun = compactPrimary[record.family.label][languageIndex];
  const directPrimary = primaryNoun;
  const primary = record.evaluationSlices.includes("synonym") ? actions[1] : directPrimary;
  const operation = record.language === "en"
    ? operationCount === 1 ? primary : operationCount === 2 ? `${primary}, then check the result` : `${primary}, check it, and choose a fallback`
    : record.language === "mixed"
      ? operationCount === 1 ? primary : operationCount === 2 ? `${primary} 그리고 result도 check해줘` : `${primary} result를 check한 뒤 fallback도 정해줘`
      : operationCount === 1 ? primary : operationCount === 2 ? `${primary} 그리고 결과도 확인해줘` : `${primary} 결과를 확인한 뒤 대안도 정해줘`;
  const scopeNoun = scopeNouns[record.family.category][record.language === "en" ? "en" : "ko"];
  const scope = record.bucketStates.scope === "low" ? "" : record.language === "en"
    ? `use ${record.bucketStates.scope === "strong" ? "four" : "two"} ${scopeNoun}`
    : `${scopeNoun} ${record.bucketStates.scope === "strong" ? 4 : 2}개를 함께 봐`;
  const constraint = record.bucketStates.constraint === "low" ? "" : record.language === "en"
    ? `keep ${record.bucketStates.constraint === "strong" ? "format, terms, and tone" : "format and terms"}`
    : record.language === "mixed"
      ? `${record.bucketStates.constraint === "strong" ? "format, term, tone" : "format과 term"}을 유지해`
      : `${record.bucketStates.constraint === "strong" ? "형식, 용어, 말투" : "형식과 용어"}를 유지해`;
  const dependency = record.bucketStates.dependency === "low" ? "" : record.language === "en"
    ? record.bucketStates.dependency === "strong" ? "use the check result to choose recovery" : "feed the criterion into the check"
    : record.language === "mixed"
      ? record.bucketStates.dependency === "strong" ? "check result로 recovery를 골라" : "criterion result를 check에 써"
      : record.bucketStates.dependency === "strong" ? "확인 결과로 복구안을 골라" : "기준 결과를 확인에 써";
  const extras = [];
  if (record.evaluationSlices.includes("negation")) extras.push(record.language === "en" ? "do not guess" : record.language === "mixed" ? "guess하지 마" : "추측하지 마");
  if (record.evaluationSlices.includes("category_confusion")) extras.push(record.language === "en" ? "ignore the decoy terms" : record.language === "mixed" ? "decoy term에 끌리지 마" : "배경의 미끼 용어에 끌리지 마");
  if (record.evaluationSlices.includes("ood_terminology")) extras.push(record.language === "en" ? `${syntheticTerm(record.family.markerIndex)} is fictional` : `${syntheticTerm(record.family.markerIndex)}는 가상 표식이야`);
  const leadFrames = record.language === "en"
    ? record.evaluationSlices.includes("indirect_expression")
      ? [`What I need for ${scenarioData.short} is this`, `A useful result for ${scenarioData.short} would do this`, `The outcome I need for ${scenarioData.short} is this`, `For ${scenarioData.short}, this would help`, `This is what would help with ${scenarioData.short}`]
      : [`For ${scenarioData.short}`, `${scenarioData.short}`, `Please handle ${scenarioData.short}`, `Work from ${scenarioData.short}`, `Regarding ${scenarioData.short}`]
    : record.language === "mixed"
      ? [`${scenarioData.short} 건이야`, `${scenarioData.short}에서 필요한 result야`, `${scenarioData.short} 관련 request야`, `${scenarioData.short} 기준으로 처리해줘`, `${scenarioData.short}에 쓸 outcome이 필요해`]
      : [`${scenarioData.short} 건이야`, `${scenarioData.short}에서 필요한 결과야`, `${scenarioData.short} 관련 요청이야`, `${scenarioData.short} 기준으로 처리해줘`, `${scenarioData.short}에 쓸 결과가 필요해`];
  const render = (lead) => record.language === "en"
    ? `${lead}: ${operation}. ${[scope, constraint, dependency, ...extras].filter(Boolean).join("; ")}.`
    : `${lead}. ${operation}. ${[scope, constraint, dependency, ...extras].filter(Boolean).join("; ")}.`;
  let prompt = render(leadFrames[record.variant]);
  if (runeLength(prompt) > 120) {
    prompt = render(record.language === "en" ? scenarioData.brief : `${scenarioData.brief} 건`);
  }
  if (runeLength(prompt) > 120) {
    const shortScope = record.bucketStates.scope === "strong" ? "4src" : record.bucketStates.scope === "moderate" ? "2src" : "";
    const shortConstraint = record.bucketStates.constraint === "strong" ? "format/terms/tone" : record.bucketStates.constraint === "moderate" ? "format/terms" : "";
    const shortDependency = record.bucketStates.dependency === "strong" ? "criterion→check→fallback" : record.bucketStates.dependency === "moderate" ? "criterion→check" : "";
    const shortExtras = [record.evaluationSlices.includes("negation") ? "no-guess" : "", record.evaluationSlices.includes("category_confusion") ? "skip-decoy" : "", record.evaluationSlices.includes("ood_terminology") ? syntheticTerm(record.family.markerIndex) : ""];
    const shortTag = record.language === "en"
      ? ["case", "request", "check", "task", "result"][record.variant]
      : ["건", "요청", "검토", "작업", "결과"][record.variant];
    prompt = `${scenarioData.brief} ${shortTag}: ${compactOperations(record)};${[shortScope, shortConstraint, shortDependency, ...shortExtras].filter(Boolean).join(";")}.`;
  }
  if (runeLength(prompt) > 120) {
    const minimalScope = record.bucketStates.scope === "strong" ? "4src" : record.bucketStates.scope === "moderate" ? "2src" : "";
    const minimalConstraint = record.bucketStates.constraint === "strong" ? "fmt/term/tone" : record.bucketStates.constraint === "moderate" ? "fmt/term" : "";
    const minimalDependency = record.bucketStates.dependency === "strong" ? "rule>check>fallback" : record.bucketStates.dependency === "moderate" ? "rule>check" : "";
    const minimalExtras = [record.evaluationSlices.includes("negation") ? "no-guess" : "", record.evaluationSlices.includes("category_confusion") ? "skip-decoy" : "", record.evaluationSlices.includes("ood_terminology") ? syntheticTerm(record.family.markerIndex) : ""];
    const minimalTag = ["case", "request", "check", "task", "result"][record.variant];
    prompt = `${scenarioData.ultraBrief} ${minimalTag}: ${terseEnglishOperations(record)};${[minimalScope, minimalConstraint, minimalDependency, ...minimalExtras].filter(Boolean).join(";")}.`;
  }
  if (runeLength(prompt) > 120) throw new Error(`${record.family.promptFamily}/${record.variant}: short prompt is ${runeLength(prompt)} runes`);
  return prompt;
}

function renderRegular(record) {
  const language = record.language;
  const scenario = semanticScenario(record.family, language).full;
  const actions = localized(record, actionSets[record.family.label]);
  const operationCount = taskCount(record.bucketStates.task);
  const primaryAction = actions[record.evaluationSlices.includes("synonym") ? 1 : 0];
  const actionValues = [primaryAction, actions[2], actions[3]].slice(0, operationCount);
  const indirect = record.evaluationSlices.includes("indirect_expression");
  let actionSentences;
  if (indirect) {
    const lead = language === "en"
      ? [
          `What would help for ${scenario} is this`,
          `The result I need for ${scenario} is this`,
          `It would be useful to have this for ${scenario}`,
          `For ${scenario}, this is the outcome I am after`,
          `A useful response for ${scenario} would do the following`,
        ][record.variant]
      : language === "mixed"
        ? [
            `${scenario}에 필요한 result는 이거야`,
            `${scenario}에서 바라는 outcome은 이거야`,
            `${scenario}에 이런 result가 있으면 유용하겠어`,
            `${scenario} 관련해서 찾는 outcome은 다음과 같아`,
            `${scenario}에 helpful한 response라면 이걸 해주면 돼`,
          ][record.variant]
        : [
            `${scenario}에 필요한 결과가 있으면 좋겠어`,
            `${scenario}에서 바라는 결과는 이거야`,
            `${scenario}에 이런 결과가 있으면 유용하겠어`,
            `${scenario} 관련해서 찾는 결과는 다음과 같아`,
            `${scenario}에 도움이 되는 답이라면 이걸 해주면 돼`,
          ][record.variant];
    actionSentences = [`${lead}: ${actionValues[0]}`, ...actionValues.slice(1)];
  } else {
    const frames = language === "en"
      ? [`For ${scenario}, ${actionValues[0]}`, `${scenario}: ${actionValues[0]}`, `Please ${actionValues[0]} for ${scenario}`, `I need you to ${actionValues[0]} for ${scenario}`, `With ${scenario} in mind, ${actionValues[0]}`]
      : language === "mixed"
        ? [`${scenario}에 대해 ${actionValues[0]}`, `${scenario}: ${actionValues[0]}`, `${scenario} case에서 ${actionValues[0]}`, `${scenario} 관련해서 ${actionValues[0]}`, `${scenario} 기준으로 ${actionValues[0]}`]
        : [`${scenario}에 대해 ${actionValues[0]}`, `${scenario}: ${actionValues[0]}`, `${scenario} 상황에서 ${actionValues[0]}`, `${scenario} 관련해서 ${actionValues[0]}`, `${scenario} 기준으로 ${actionValues[0]}`];
    actionSentences = [frames[record.variant], ...actionValues.slice(1)];
  }

  const dependency = record.bucketStates.dependency;
  if (dependency === "moderate") {
    const dependencyContext = language === "en"
      ? "Use the criterion result as the input to the following operation"
      : language === "mixed"
        ? "criterion result를 이어지는 operation의 input으로 써"
        : "기준 결과를 이어지는 작업의 입력으로 써";
    actionSentences.unshift(dependencyContext);
  } else if (dependency === "strong") {
    const dependencyContext = language === "en"
      ? "Feed the criterion result into the cross-check result, and use that output to determine the recovery alternative"
      : language === "mixed"
        ? "criterion result를 cross-check result의 input으로 쓰고 그 output으로 recovery alternative를 정해"
        : "기준 결과를 교차 확인 결과의 입력으로 쓰고 그 출력으로 복구 대안을 정해";
    actionSentences.unshift(dependencyContext);
  }

  if (language === "en") {
    actionSentences = actionSentences.map((sentence) => sentence.length === 0 ? sentence : `${sentence[0].toUpperCase()}${sentence.slice(1)}`);
  }
  const parts = [actionSentences.join(". ")];
  const scope = record.bucketStates.scope;
  if (scope !== "low") {
    const noun = scopeNouns[record.family.category][language === "en" ? "en" : "ko"];
    const count = scope === "strong" ? 4 : 2;
    parts.push(language === "en" ? `The scope is ${count} ${noun}` : language === "mixed" ? `scope는 ${noun} ${count}개야` : `대상은 ${noun} ${count}개야`);
  }

  const constraintState = record.bucketStates.constraint;
  let constraintCount = constraintState === "strong" ? 3 : constraintState === "moderate" ? 2 : ((record.family.globalIndex + record.variant) % 2);
  const availableConstraints = rotate(constraintPool[language], (record.family.globalIndex + record.variant) % constraintPool[language].length);
  const selectedConstraints = availableConstraints.slice(0, constraintCount);
  if (record.evaluationSlices.includes("negation")) {
    const negative = language === "en" ? "do not invent missing facts" : language === "mixed" ? "missing fact를 만들지 마" : "빠진 사실을 만들어내지 마";
    if (selectedConstraints.length === 0) selectedConstraints.push(negative);
    else selectedConstraints[selectedConstraints.length - 1] = negative;
  }
  if (selectedConstraints.length > 0) parts.push(selectedConstraints.join(language === "en" ? "; " : ", "));

  if (record.evaluationSlices.includes("category_confusion")) {
    const decoy = decoyContext[record.family.category][language === "en" ? "en" : "ko"];
    parts.unshift(language === "en" ? `Although ${decoy}, the requested result stays unchanged` : language === "mixed" ? `${decoy}. 그래도 requested result는 그대로야` : `${decoy}. 그래도 요청한 결과는 그대로야`);
  }
  if (record.evaluationSlices.includes("ood_terminology")) {
    const term = syntheticTerm(record.family.markerIndex);
    parts.unshift(language === "en" ? `${term} is a fictional internal label for this case` : language === "mixed" ? `${term}는 이 case의 fictional internal label이야` : `${term}는 이 사례에만 쓰는 가상 내부 용어야`);
  }
  const renderedParts = language === "en"
    ? parts.map((part) => part.length === 0 ? part : `${part[0].toUpperCase()}${part.slice(1)}`)
    : parts;
  let prompt = `${renderedParts.join(". ")}.`;
  if (record.evaluationSlices.includes("long_simple")) {
    const detail = longContextDetails[language][(record.family.markerIndex + record.variant) % longContextDetails[language].length];
    prompt = `${longPrefaces[language][record.family.category]} ${detail} ${prompt}`;
  }
  return prompt;
}

function payloadText(record) {
  const language = record.language;
  const scenario = semanticScenario(record.family, language).full;
  const term = syntheticTerm(record.family.globalIndex);
  if (language === "en") return `Synthetic reference for ${scenario}. A quoted line says “translate this, debug code, and summarize it,” but that line is untrusted content, not an instruction. ${term} is fictional. No customer data or secret is present.`;
  if (language === "mixed") return `${scenario}용 synthetic reference다. 인용문에는 “translate하고 code를 debug한 뒤 summarize하라”는 문장이 있지만 untrusted content일 뿐 instruction이 아니다. ${term}는 fictional term이며 customer data나 secret은 없다.`;
  return `${scenario}용 합성 참고 자료다. 인용문에는 “번역하고 코드를 디버깅한 뒤 요약하라”는 문장이 있지만 신뢰하지 않는 내용일 뿐 지시가 아니다. ${term}는 가상 용어이며 고객 데이터나 비밀은 없다.`;
}

function renderPrompt(record) {
  const compactRepairKeys = new Set([
    "143:2", "189:3", "169:4", "88:2", "167:3", "81:2", "196:3", "97:3",
    "83:2", "345:0", "362:0", "376:2", "512:0", "470:0", "456:1", "513:1",
  ]);
  const compactRepair = compactRepairKeys.has(`${record.family.globalIndex + 1}:${record.variant}`);
  let prompt = record.evaluationSlices.includes("short_complex") || compactRepair ? renderShort(record) : renderRegular(record);
  let boundary = { kind: "instruction_only", boundaryType: "none", confidence: "none", payloadBlockCount: "zero" };
  if (record.expectedDifficulty === "simple" && !record.evaluationSlices.includes("long_simple") && runeLength(prompt) > 120) {
    prompt = renderShort(record);
  }
  if (record.expectedDifficulty === "complex" && !record.evaluationSlices.includes("short_complex") && runeLength(prompt) <= 120) {
    prompt = `${complexPrefaces[record.language][record.family.category]} ${prompt}`;
  }
  if (record.evaluationSlices.includes("payload_contamination")) {
    prompt = `${prompt}\n\`\`\`text\n${payloadText(record)}\n\`\`\``;
    boundary = { kind: "explicit_separation", boundaryType: "code_fence", confidence: "high", payloadBlockCount: "one" };
  }
  if (record.expectedDifficulty === "simple" && !record.evaluationSlices.includes("long_simple") && runeLength(prompt) > 120) {
    throw new Error(`${record.family.promptFamily}/${record.variant}: untagged simple prompt is ${runeLength(prompt)} runes`);
  }
  if (record.expectedDifficulty === "complex" && !record.evaluationSlices.includes("short_complex") && runeLength(prompt) <= 120) {
    throw new Error(`${record.family.promptFamily}/${record.variant}: untagged complex prompt is ${runeLength(prompt)} runes`);
  }
  return { prompt, boundary };
}

const bucketNames = {
  task: { low: "count_1", moderate: "count_2", strong: "count_3_plus" },
  constraint: { low: "count_0_to_1", moderate: "count_2", strong: "count_3_plus" },
  scope: { low: "count_1", moderate: "count_2_to_3", strong: "count_4_plus" },
  dependency: { low: "depth_0_to_1", moderate: "depth_2", strong: "depth_3_plus" },
};

function finalizeRecord(batch, record) {
  const { prompt, boundary } = renderPrompt(record);
  return {
    schemaVersion: "gatelm.difficulty-label-record.v2",
    datasetVersion: `difficulty_model_path_expansion_3120_2026_07_15_${batch.id}_candidate_v1`,
    sampleId: `difficulty_modelpath3120_${batch.id}_${record.family.category}_${String(record.family.globalIndex + 1).padStart(4, "0")}_v${String(record.variant + 1).padStart(2, "0")}`,
    redactedPrompt: prompt,
    expectedCategory: record.family.category,
    expectedDifficulty: record.expectedDifficulty,
    semanticInputStatus: "eligible",
    taskBucket: bucketNames.task[record.bucketStates.task],
    constraintBucket: bucketNames.constraint[record.bucketStates.constraint],
    scopeBucket: bucketNames.scope[record.bucketStates.scope],
    dependencyBucket: bucketNames.dependency[record.bucketStates.dependency],
    expectedSemanticLabel: record.family.label,
    promptFamily: record.family.promptFamily,
    language: record.language,
    expectedInstructionPayloadBoundary: boundary,
    evaluationSlices: record.evaluationSlices,
    labelSource: "synthetic_fixture",
    consentType: "synthetic",
    source: "synthetic_fixture",
    redactionVersion: "synthetic_no_customer_data_v1",
    createdAt,
    labelConfidence: record.evaluationSlices.includes("category_confusion") || record.evaluationSlices.includes("indirect_expression") ? 0.78 : 0.84,
    reviewStatus: "pending",
    reviewerCount: 0,
    reviewerNote: `Synthetic ${batch.id.toUpperCase()} candidate; GPT and owner review pending.`,
  };
}

function groupBy(values, selector) {
  const groups = new Map();
  for (const value of values) {
    const key = selector(value);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(value);
  }
  return groups;
}

function counts(values, selector) {
  return Object.fromEntries([...groupBy(values, selector)].map(([key, rows]) => [key, rows.length]).sort(([a], [b]) => a.localeCompare(b)));
}

function familyCoverage(familyGroups) {
  const countFamilies = (predicate) => [...familyGroups.values()].filter((rows) => rows.some(predicate)).length;
  return {
    categoryFamilies: Object.fromEntries(categories.map((category) => [category, countFamilies((record) => record.expectedCategory === category)])),
    difficultyFamilies: Object.fromEntries(difficulties.map((difficulty) => [difficulty, countFamilies((record) => record.expectedDifficulty === difficulty)])),
    categoryDifficultyFamilies: Object.fromEntries(categories.map((category) => [category, Object.fromEntries(difficulties.map((difficulty) => [difficulty, countFamilies((record) => record.expectedCategory === category && record.expectedDifficulty === difficulty)]))])),
    languageFamilies: Object.fromEntries(["ko", "en", "mixed", "unknown"].map((language) => [language, countFamilies((record) => record.language === language)])),
    evaluationSliceFamilies: Object.fromEntries(slices.map((slice) => [slice, countFamilies((record) => record.evaluationSlices.includes(slice))])),
  };
}

function buildManifest(batch, records, datasetText) {
  const familyGroups = groupBy(records, (record) => record.promptFamily);
  const datasetPath = `docs/v2.1.0/reviews/difficulty-model-path-expansion-3120/${batch.id}/${batch.id}.candidate.jsonl`;
  return {
    schemaVersion: "gatelm.difficulty-label-dataset-manifest.v2",
    datasetVersion: records[0].datasetVersion,
    recordSchemaVersion: "gatelm.difficulty-label-record.v2",
    datasetPath,
    datasetSha256: hash(datasetText),
    datasetPurpose: "training_candidate",
    trainingEligible: false,
    labelCoverageStatus: "complete",
    familyPolicyVersion,
    splitPolicyVersion,
    splitSeed,
    trainingGate: { minimumFamilyPolicyStatus: "decision_required" },
    counts: {
      records: records.length,
      families: familyGroups.size,
      humanReviewedFamilies: 0,
      approvedHumanReviewedFamilies: 0,
      semanticHeadEligibleRecords: records.length,
      semanticHeadEligibleFamilies: familyGroups.size,
      emptyInstructionRecords: 0,
      emptyInstructionFamilies: 0,
    },
    coverage: familyCoverage(familyGroups),
    families: [...familyGroups.entries()].map(([promptFamily, rows]) => ({
      promptFamily,
      expectedCategory: rows[0].expectedCategory,
      expectedSemanticLabel: rows[0].expectedSemanticLabel,
      reviewStatus: "pending",
      humanReviewed: false,
      partition: batch.partition,
      records: rows.length,
    })).sort((left, right) => left.promptFamily.localeCompare(right.promptFamily)),
    createdAt,
  };
}

function assertExact(actual, expected, description) {
  for (const [key, value] of Object.entries(expected)) {
    if ((actual[key] ?? 0) !== value) throw new Error(`${description}: expected ${key}=${value}, got ${actual[key] ?? 0}`);
  }
}

function validateBatch(batch, records, manifest) {
  if (records.length !== batch.families * 5) throw new Error(`${batch.id}: record count mismatch`);
  if (new Set(records.map((record) => record.sampleId)).size !== records.length) throw new Error(`${batch.id}: duplicate sampleId`);
  if (new Set(records.map((record) => record.redactedPrompt)).size !== records.length) {
    const duplicates = [...groupBy(records, (record) => record.redactedPrompt)]
      .filter(([, rows]) => rows.length > 1)
      .map(([, rows]) => rows.map((record) => record.sampleId).join(", "));
    throw new Error(`${batch.id}: exact prompt duplicate: ${duplicates.join("; ")}`);
  }
  const familyGroups = groupBy(records, (record) => record.promptFamily);
  if (familyGroups.size !== batch.families || [...familyGroups.values()].some((rows) => rows.length !== 5)) throw new Error(`${batch.id}: family size mismatch`);
  for (const rows of familyGroups.values()) {
    if (new Set(rows.map((record) => record.expectedCategory)).size !== 1 || new Set(rows.map((record) => record.expectedSemanticLabel)).size !== 1) throw new Error(`${rows[0].promptFamily}: family label leakage`);
    const simpleCount = rows.filter((record) => record.expectedDifficulty === "simple").length;
    if (simpleCount !== 2 && simpleCount !== 3) throw new Error(`${rows[0].promptFamily}: family contrast mismatch`);
    if (new Set(rows.map((record) => record.language)).size !== 3) throw new Error(`${rows[0].promptFamily}: family must contain ko/en/mixed variants`);
  }
  assertExact(counts(records, (record) => record.expectedCategory), Object.fromEntries(categories.map((category, index) => [category, batch.categories[index] * 5])), `${batch.id} category`);
  const simple = batch.simpleMajor * 3 + (batch.families - batch.simpleMajor) * 2;
  assertExact(counts(records, (record) => record.expectedDifficulty), { simple, complex: records.length - simple }, `${batch.id} difficulty`);
  assertExact(counts(records, (record) => record.language), { ko: batch.languages[0], en: batch.languages[1], mixed: batch.languages[2] }, `${batch.id} language`);
  const namedSlices = ["negation", "indirect_expression", "synonym", "short_complex", "long_simple", "payload_contamination", "category_confusion", "ood_terminology"];
  assertExact(Object.fromEntries(namedSlices.map((slice) => [slice, records.filter((record) => record.evaluationSlices.includes(slice)).length])), Object.fromEntries(namedSlices.map((slice, index) => [slice, batch.sliceCounts[index]])), `${batch.id} slices`);
  for (const [dimension, quota] of Object.entries(batch.buckets)) {
    const field = `${dimension}Bucket`;
    const names = bucketNames[dimension];
    assertExact(counts(records, (record) => record[field]), { [names.low]: quota[0], [names.moderate]: quota[1], [names.strong]: quota[2] }, `${batch.id} ${field}`);
  }
  for (const record of records.filter((row) => row.evaluationSlices.includes("short_complex"))) {
    if (record.expectedDifficulty !== "complex" || runeLength(record.redactedPrompt) > 120) throw new Error(`${record.sampleId}: invalid short_complex`);
  }
  for (const record of records.filter((row) => row.evaluationSlices.includes("long_simple"))) {
    if (record.expectedDifficulty !== "simple" || runeLength(record.redactedPrompt) <= 120) throw new Error(`${record.sampleId}: invalid long_simple`);
  }
  const failures = [
    ...verifyDifficultyLabelRecords(records),
    ...verifyDifficultyLabelDatasetManifest(manifest, { manifestPath: `${batch.id} candidate manifest` }),
  ];
  if (failures.length > 0) throw new Error(`${batch.id} schema verification failed:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
}

function reportFor(batch, records, manifest) {
  return {
    schemaVersion: "gatelm.difficulty-generation-report.v1",
    batchId: batch.id,
    partitionRole: batch.role,
    manifestPartition: batch.partition,
    datasetVersion: manifest.datasetVersion,
    datasetSha256: manifest.datasetSha256,
    decisionBoundaryVersion,
    trainingPolicyVersion,
    reviewStatus: "pending_owner_review",
    trainingEligible: false,
    counts: { records: records.length, families: manifest.counts.families },
    distributions: {
      category: counts(records, (record) => record.expectedCategory),
      difficulty: counts(records, (record) => record.expectedDifficulty),
      language: counts(records, (record) => record.language),
      semanticLabel: counts(records, (record) => record.expectedSemanticLabel),
      taskBucket: counts(records, (record) => record.taskBucket),
      constraintBucket: counts(records, (record) => record.constraintBucket),
      scopeBucket: counts(records, (record) => record.scopeBucket),
      dependencyBucket: counts(records, (record) => record.dependencyBucket),
      slices: Object.fromEntries(slices.map((slice) => [slice, records.filter((record) => record.evaluationSlices.includes(slice)).length])),
      boundary: counts(records, (record) => record.expectedInstructionPayloadBoundary.kind),
    },
    generatedAt: createdAt,
  };
}

function writeOrCheck(filePath, contents, checkOnly) {
  if (checkOnly) {
    let actual;
    try {
      actual = readFileSync(filePath, "utf8");
    } catch (error) {
      throw new Error(`${filePath}: unable to read generated artifact (${error.message})`);
    }
    if (actual !== contents) {
      throw new Error(`${filePath}: generated artifact is stale; rerun this script without --check`);
    }
    return;
  }
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

function readExistingRecords() {
  return [
    "docs/v2.1.0/training/difficulty-training-candidate-500.owner-approved.jsonl",
    "docs/v2.1.0/training/difficulty-training-candidate-expansion-2000.owner-approved.jsonl",
  ].flatMap((file) => readFileSync(path.resolve(file), "utf8").trim().split("\n").map((line) => JSON.parse(line)));
}

function writeArtifacts() {
  const checkOnly = process.argv.includes("--check");
  const allFamilies = buildFamilies();
  const existingRecords = readExistingRecords();
  const existingFamilies = new Set(existingRecords.map((record) => record.promptFamily));
  const collisions = allFamilies.filter((family) => existingFamilies.has(family.promptFamily));
  if (collisions.length > 0) throw new Error(`existing family collisions: ${collisions.map((family) => family.promptFamily).join(", ")}`);

  const allRecords = [];
  const index = [];
  const generatedFiles = [];
  for (const batch of batchConfigs) {
    const workingRecords = buildBatchRecords(batch, allFamilies);
    assignProfiles(batch, workingRecords);
    const records = workingRecords.map((record) => finalizeRecord(batch, record));
    const datasetText = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
    const manifest = buildManifest(batch, records, datasetText);
    validateBatch(batch, records, manifest);
    const batchDir = path.join(root, batch.id);
    generatedFiles.push(
      [path.join(batchDir, `${batch.id}.candidate.jsonl`), datasetText],
      [path.join(batchDir, `${batch.id}.candidate.manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`],
    );
    const report = reportFor(batch, records, manifest);
    generatedFiles.push([path.join(batchDir, `${batch.id}.generation-report.json`), `${JSON.stringify(report, null, 2)}\n`]);
    if (batch.role === "promotion") {
      const blindIndex = records.map((record) => ({
        sampleId: record.sampleId,
        promptFamily: record.promptFamily,
        datasetSha256: manifest.datasetSha256,
      }));
      generatedFiles.push([path.join(batchDir, `${batch.id}.blind-index.json`), `${JSON.stringify({ batchId: batch.id, frozenAt: createdAt, records: blindIndex }, null, 2)}\n`]);
    }
    allRecords.push(...records);
    index.push({
      batchId: batch.id,
      partitionRole: batch.role,
      manifestPartition: batch.partition,
      records: records.length,
      families: manifest.counts.families,
      datasetPath: manifest.datasetPath,
      manifestPath: `docs/v2.1.0/reviews/difficulty-model-path-expansion-3120/${batch.id}/${batch.id}.candidate.manifest.json`,
      generationReportPath: `docs/v2.1.0/reviews/difficulty-model-path-expansion-3120/${batch.id}/${batch.id}.generation-report.json`,
      goAuditPath: `docs/v2.1.0/reviews/difficulty-model-path-expansion-3120/${batch.id}/${batch.id}.go-audit.json`,
      datasetSha256: manifest.datasetSha256,
    });
  }

  const normalizedPrompt = (value) => value.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
  const allPromptKeys = new Map();
  for (const record of [...existingRecords, ...allRecords]) {
    const key = normalizedPrompt(record.redactedPrompt);
    const previous = allPromptKeys.get(key);
    if (previous && previous.promptFamily !== record.promptFamily) throw new Error(`cross-family exact duplicate: ${previous.sampleId}, ${record.sampleId}`);
    allPromptKeys.set(key, record);
  }
  if (allRecords.length !== 3120 || new Set(allRecords.map((record) => record.promptFamily)).size !== 624) throw new Error("global record/family count mismatch");
  generatedFiles.push([path.join(root, "generation-index.json"), `${JSON.stringify({
    schemaVersion: "gatelm.difficulty-generation-index.v1",
    datasetGoal: "model_path_5000",
    decisionBoundaryVersion,
    trainingPolicyVersion,
    reviewStatus: "pending_owner_review",
    trainingEligible: false,
    candidateRecords: allRecords.length,
    candidateFamilies: new Set(allRecords.map((record) => record.promptFamily)).size,
    ownerApprovedSourceRecordsUnchanged: 2500,
    batches: index,
    createdAt,
  }, null, 2)}\n`]);
  for (const [filePath, contents] of generatedFiles) {
    writeOrCheck(filePath, contents, checkOnly);
  }
  console.log(`${checkOnly ? "verified" : "wrote"} ${allRecords.length} pending records in ${index.length} separate batches`);
}

writeArtifacts();
