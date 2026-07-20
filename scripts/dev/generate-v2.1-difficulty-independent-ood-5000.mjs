import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  verifyDifficultyLabelDatasetManifest,
  verifyDifficultyLabelRecords,
} from "../verify-v2.1-difficulty-eval.mjs";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const datasetVersion = "difficulty_independent_ood_5000_2026_07_18_candidate_v1";
const createdAt = "2026-07-18T00:00:00Z";
const assignmentSeed = 2026071802;
const splitSeed = 2026071803;
const familyPolicyVersion = "difficulty-prompt-family.v1";
const datasetPath = "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.candidate.jsonl";
const manifestPath = "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.candidate.manifest.json";
const splitManifestPath = "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.splits.json";
const splitPaths = {
  train: "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.train.jsonl",
  validation: "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.validation.jsonl",
  test: "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.test.jsonl",
};
const diversityReportPath = "docs/v2.1.0/evaluation/difficulty-independent-ood-5000.v1.diversity-report.json";
const blindReviewPath =
  "docs/v2.1.0/reviews/difficulty-independent-ood-5000/difficulty-independent-ood-5000.v1.blind-review.jsonl";
const dataset1Path = "docs/v2.1.0/training/difficulty-model-path-5000.owner-approved.jsonl";
const categories = ["general", "code", "translation", "summarization", "reasoning"];
const languageValues = ["ko", "en", "mixed", "unknown"];
const evaluationSlices = [
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
const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");
const runeLength = (value) => [...value].length;
const defaultBoundary = () => ({
  kind: "instruction_only",
  boundaryType: "none",
  confidence: "none",
  payloadBlockCount: "zero",
});
const explicitBoundary = (boundaryType, payloadBlockCount = "one") => ({
  kind: "explicit_separation",
  boundaryType,
  confidence: "high",
  payloadBlockCount,
});

const semanticLabels = {
  general: [
    "general_qa",
    "general_explanation",
    "general_extraction",
    "general_support",
    "general_transformation",
    "general_other",
  ],
  code: [
    "code_generation",
    "code_debugging",
    "code_refactoring",
    "code_review",
    "code_explanation",
    "code_design",
  ],
  translation: ["translation_direct", "translation_localization", "translation_style_preserving"],
  summarization: [
    "summarization_direct",
    "summarization_key_points",
    "summarization_structured",
    "summarization_multi_source",
  ],
  reasoning: [
    "reasoning_comparison",
    "reasoning_planning",
    "reasoning_decision",
    "reasoning_constraint_solving",
    "reasoning_causal",
  ],
};

const topicCatalog = {
  general: [
    pair("섬 여객선 분실물 접수", "island-ferry lost-property claim"),
    pair("씨앗 도서관 대여 규칙", "seed-library lending rule"),
    pair("천문대 야간 관람권", "observatory night pass"),
    pair("공동 냉장고 전기료 표", "cooperative cold-storage bill"),
    pair("접근성 자막 기기 대여", "accessible caption-device loan"),
    pair("해안 조수 알림 구독", "coastal tide-alert subscription"),
    pair("가로수 가지치기 허가", "street-tree pruning permit"),
    pair("이동 진료소 예약 창구", "mobile-clinic booking window"),
    pair("기록관 복제 수수료", "archive reproduction fee"),
    pair("보호소 임시보호 키트", "shelter foster-kit pickup"),
    pair("수리 카페 대기 번호", "repair-cafe queue token"),
    pair("드론 비행 회랑 공지", "drone-corridor notice"),
    pair("옥상 양봉장 검사 일정", "rooftop-apiary inspection"),
    pair("수질 측정 키오스크", "water-quality kiosk reading"),
    pair("언어 교환 출석 배지", "language-exchange attendance badge"),
    pair("헌옷 순환 바우처", "textile-reuse voucher"),
    pair("마을 배터리 잔량판", "community-battery dashboard"),
    pair("소형 선박 정박 순번", "small-vessel berth order"),
    pair("공공 망원경 예약", "public-telescope reservation"),
    pair("우산 공유함 반납", "umbrella-share return"),
    pair("농산물 직판장 보관표", "farm-stand storage chart"),
    pair("공동 세탁실 소음 규칙", "shared-laundry noise rule"),
    pair("산불 연기 대피 안내", "wildfire-smoke shelter guide"),
    pair("재난 라디오 점검표", "emergency-radio check sheet"),
  ],
  code: [
    pair("Elixir GenServer 우편함", "Elixir GenServer mailbox"),
    pair("Zig 바이너리 프레임 판독기", "Zig binary-frame reader"),
    pair("OCaml 명령 파서", "OCaml command parser"),
    pair("Haskell 근무표 계산기", "Haskell roster calculator"),
    pair("Deno edge 작업 큐", "Deno edge work queue"),
    pair("Clojure 이벤트 축약기", "Clojure event reducer"),
    pair("Scala 스트림 조인", "Scala stream join"),
    pair("Raku 로그 토크나이저", "Raku log tokenizer"),
    pair("Julia 센서 보간기", "Julia sensor interpolator"),
    pair("Dart 오프라인 동기화", "Dart offline synchronizer"),
    pair("Perl 고정폭 레코드 파서", "Perl fixed-width record parser"),
    pair("Nim 체크섬 검사기", "Nim checksum validator"),
    pair("Erlang 감독 트리", "Erlang supervision tree"),
    pair("WebAssembly 링 버퍼", "WebAssembly ring buffer"),
    pair("GraphQL 배치 로더", "GraphQL batch loader"),
    pair("SQLite 순환 참조 쿼리", "SQLite recursive-reference query"),
    pair("Nix 개발 셸", "Nix development shell"),
    pair("Rego 접근 정책", "Rego access policy"),
    pair("Protobuf 호환성 검사", "Protobuf compatibility check"),
    pair("Tcl 장비 제어 스크립트", "Tcl device-control script"),
    pair("F# 단위 변환 파이프", "F# unit-conversion pipeline"),
    pair("Crystal 파일 감시기", "Crystal file watcher"),
    pair("Solidity 시간 잠금", "Solidity time lock"),
    pair("AWK 재고 집계", "AWK inventory aggregation"),
  ],
  translation: [
    pair("빙하 관측소 방문 안내", "glacier-observatory visitor note"),
    pair("무소음 열차칸 표지", "quiet-carriage sign"),
    pair("해양 구조 훈련 카드", "marine-rescue drill card"),
    pair("향신료 알레르기 라벨", "spice-allergen label"),
    pair("고문서 전시 캡션", "manuscript exhibit caption"),
    pair("야생동물 통로 경고", "wildlife-crossing warning"),
    pair("무인 우체국 오류 문구", "unattended-post-office error copy"),
    pair("수어 통역 예약 안내", "sign-language interpreter booking note"),
    pair("빙상장 안전 방송", "ice-rink safety announcement"),
    pair("정수 시설 견학문", "water-treatment tour copy"),
    pair("발효 식품 보관 라벨", "fermented-food storage label"),
    pair("철새 관찰 예절", "migratory-bird viewing etiquette"),
    pair("화산 박물관 비상문", "volcano-museum emergency copy"),
    pair("심야 약국 자동 응답", "late-night pharmacy auto-reply"),
    pair("도예 가마 사용 주의", "kiln-use caution"),
    pair("청각 보호구 착용문", "hearing-protection notice"),
    pair("해저 케이블 공사 알림", "subsea-cable work notice"),
    pair("산악 대피소 체크인", "mountain-shelter check-in copy"),
    pair("우주 교육관 버튼 문구", "space-learning center button copy"),
    pair("공공 냉동고 정전 알림", "public-freezer outage alert"),
    pair("고령자용 투표 안내", "senior-friendly voting guide"),
    pair("농약 비산 주의 표지", "pesticide-drift warning"),
    pair("잠수 장비 반납 규정", "dive-gear return rule"),
    pair("수목원 씨앗 채집문", "arboretum seed-collection notice"),
  ],
  summarization: [
    pair("극지 연구 교대 일지", "polar-research shift log"),
    pair("소형 댐 수위 관측", "small-dam water-level notes"),
    pair("점자 도서 제작 회의", "braille-book production meeting"),
    pair("철새 개체수 조사", "migratory-bird census notes"),
    pair("공공 급속 충전기 민원", "public fast-charger feedback"),
    pair("산악 구조 훈련 회고", "mountain-rescue drill retrospective"),
    pair("식품 창고 온도 기록", "food-depot temperature log"),
    pair("소음 지도 현장 메모", "noise-map field notes"),
    pair("수어 통역 품질 의견", "sign-language interpretation feedback"),
    pair("도시 양봉 관찰", "urban-apiary observations"),
    pair("해안 침식 사진 설명", "coastal-erosion photo notes"),
    pair("야간 약국 운영 보고", "late-night pharmacy report"),
    pair("폐열 회수 실험 기록", "waste-heat recovery experiment"),
    pair("산불 감시 교대 메모", "wildfire-watch handoff"),
    pair("해양 쓰레기 분류표", "marine-debris sorting sheets"),
    pair("공공 와이파이 장애 기록", "public-Wi-Fi incident notes"),
    pair("재난 문자 접근성 검토", "emergency-alert accessibility review"),
    pair("기상 풍선 회수 보고", "weather-balloon recovery report"),
    pair("야생 씨앗 발아 실험", "wild-seed germination experiment"),
    pair("공동 냉동고 전력 일지", "shared-freezer power log"),
    pair("소형 위성 지상국 회고", "small-satellite ground-station review"),
    pair("응급 급수차 배치 기록", "emergency water-truck dispatch log"),
    pair("저시력 표지판 사용성", "low-vision signage usability notes"),
    pair("도시 열섬 순회 측정", "urban heat-island survey"),
  ],
  reasoning: [
    pair("섬 지역 드론 의약품 배송", "island drone medicine delivery"),
    pair("산불철 순회 도서차 노선", "wildfire-season mobile-library route"),
    pair("공공 냉동고 예비 전원", "backup power for a public freezer"),
    pair("철새 보호구역 조명", "lighting near a bird sanctuary"),
    pair("심야 약국 당번 배치", "late-night pharmacy staffing"),
    pair("빗물 저장조 교체", "rainwater-tank replacement"),
    pair("고령자 대피 수단", "evacuation transport for older residents"),
    pair("해안 센서 통신 방식", "coastal-sensor communication method"),
    pair("소형 댐 방류 알림", "small-dam release notification"),
    pair("공공 와이파이 우선 복구", "public-Wi-Fi recovery priority"),
    pair("폐교 데이터센터 전환", "school-to-data-center conversion"),
    pair("산악 대피소 난방", "heating for a mountain shelter"),
    pair("야생동물 통로 위치", "wildlife-corridor placement"),
    pair("지역 배터리 충전 순서", "community-battery charging order"),
    pair("수어 통역 인력 공유", "shared sign-language interpreter pool"),
    pair("도시 양봉장 이전", "urban-apiary relocation"),
    pair("이동 진료소 방문 주기", "mobile-clinic visit cadence"),
    pair("농촌 정전 경보 채널", "rural outage-alert channel"),
    pair("해양 쓰레기 수거 장비", "marine-debris collection equipment"),
    pair("도심 열섬 그늘막", "heat-island shade deployment"),
    pair("재난 라디오 배포 방식", "emergency-radio distribution"),
    pair("기록관 디지털화 순서", "archive digitization order"),
    pair("기상 풍선 발사 창", "weather-balloon launch window"),
    pair("접근성 표지 교체", "accessible-signage replacement"),
  ],
};

const settings = [
  pair("두 기관의 운영 시간이 어긋난 상태", "two agencies using different operating hours"),
  pair("한 달짜리 임시 규칙이 적용되는 기간", "a one-month temporary-rule period"),
  pair("현장 표지와 앱 설명이 충돌하는 상황", "a conflict between signage and app copy"),
  pair("통신이 간헐적으로 끊기는 날", "a day with intermittent connectivity"),
  pair("신규 담당자에게 인계하는 시점", "a handoff to a new operator"),
  pair("예산 확정 전의 시범 운영", "a pilot before the budget is final"),
  pair("평일과 공휴일 규칙이 다른 주", "a week with different holiday rules"),
  pair("구버전 단말이 함께 남아 있는 환경", "an environment that still has legacy devices"),
  pair("현장 수치 하나가 누락된 상태", "a field reading with one missing value"),
  pair("접근성 검토가 뒤늦게 추가된 단계", "a late accessibility-review stage"),
  pair("두 차례 공지가 서로 다른 날짜를 말하는 경우", "two notices naming different dates"),
  pair("담당 부서가 교대 직전에 바뀐 경우", "an ownership change just before handoff"),
  pair("수요가 예상치의 두 배가 된 날", "a day when demand doubles"),
  pair("보조 장비 한 대가 고장 난 상황", "a situation with one backup device unavailable"),
  pair("정책 문구만 바뀌고 화면은 그대로인 상태", "policy copy changing before the interface"),
  pair("복구 가능 시간이 불확실한 장애", "an outage with an uncertain recovery time"),
  pair("세 지역의 기준이 조금씩 다른 배포", "a rollout with three slightly different regional rules"),
  pair("검수자가 서로 다른 해석을 남긴 경우", "reviewers leaving conflicting interpretations"),
  pair("마감이 예정보다 여섯 시간 앞당겨진 날", "a deadline moved six hours earlier"),
  pair("민감한 값 없이 재현한 훈련 환경", "a training environment reproduced without sensitive values"),
  pair("주간 보고와 실시간 화면의 집계가 다른 때", "a mismatch between weekly and live totals"),
  pair("대체 수단이 한정된 야간 운영", "night operations with limited alternatives"),
  pair("계절 전환으로 단위 표기가 바뀌는 시기", "a seasonal change in displayed units"),
  pair("재시도 기록이 순서 없이 도착한 상태", "retry records arriving out of order"),
];

const caseFocuses = [
  pair("표시 단위가 빠진 항목", "the entry with a missing unit"),
  pair("네 분 늦게 도착한 기록", "the record arriving four minutes late"),
  pair("승인 표식이 두 번 찍힌 건", "the item carrying two approval marks"),
  pair("이전 규칙 이름이 남은 화면", "the screen retaining the former rule name"),
  pair("순서 번호가 건너뛴 구간", "the segment with a skipped sequence number"),
  pair("대체 채널만 정상인 경우", "the case where only the fallback channel works"),
  pair("두 번째 측정값이 비어 있는 묶음", "the batch with its second reading blank"),
  pair("경계 시각에 접수된 요청", "the request submitted at the cutoff"),
  pair("한 글자 다른 상태 코드", "the status code differing by one character"),
  pair("되돌림 기록만 남은 항목", "the item retaining only a rollback record"),
  pair("현장 표기와 원격 표기가 다른 건", "the item labeled differently on-site and remotely"),
  pair("세 번째 출처만 날짜가 다른 묶음", "the batch whose third source names another date"),
  pair("구버전에서만 재현되는 사례", "the case reproduced only on the legacy version"),
  pair("주말 예외가 처음 적용된 건", "the first item under the weekend exception"),
  pair("수동 보정 뒤 다시 열린 항목", "the item reopened after manual correction"),
  pair("두 지역에서 반대 결과가 난 사례", "the case producing opposite regional outcomes"),
  pair("검수 메모가 본문보다 늦은 건", "the item whose review note is newer than the body"),
];

const constraints = [
  pair("확인되지 않은 사실은 단정하지 않기", "do not state unverified facts as certain"),
  pair("결과는 세 항목을 넘기지 않기", "keep the result to at most three items"),
  pair("현장 담당자가 바로 읽을 수 있는 표현 쓰기", "use wording a field operator can scan"),
  pair("시간대와 단위를 명시하기", "state the timezone and unit"),
  pair("원문의 고유 명칭은 보존하기", "preserve source-specific names"),
  pair("변경 이유와 영향을 구분하기", "separate the reason from the impact"),
  pair("실패한 경우의 처리도 포함하기", "include handling for the failure case"),
  pair("추측으로 빈 값을 채우지 않기", "do not invent missing values"),
  pair("모바일 한 화면 분량으로 제한하기", "fit within one mobile screen"),
  pair("상충하는 자료는 출처별로 표시하기", "attribute conflicting material by source"),
  pair("기존 호환 동작은 유지하기", "preserve existing compatibility behavior"),
  pair("최종 선택 기준을 짧게 남기기", "state the final selection criterion"),
];

const sourceKinds = [
  pair("현장 점검표", "field checklist"),
  pair("교대 메모", "shift handoff"),
  pair("기기 상태표", "device status sheet"),
  pair("정책 발췌", "policy excerpt"),
  pair("사용성 관찰", "usability observation"),
  pair("오류 재현 기록", "reproduction note"),
  pair("운영 일정", "operations schedule"),
  pair("검수 의견", "review comment"),
  pair("센서 요약", "sensor summary"),
  pair("현지화 메모", "localization note"),
];

const inventedTerms = [
  "aerolith queue", "brinex window", "cobalt hinge", "deltawisp", "echo lattice",
  "farside token", "glimmer lock", "hushgrid", "ionfold", "juniper lane",
  "kestrel patch", "lumen braid", "morrow slot", "nacre mode", "opal relay",
  "palisade bit", "quartzloop", "rime ledger", "sable gate", "tidemark unit",
  "umbra spool", "velvet checksum", "willow phase", "xeno docket", "yarrow index",
  "zephyr notch", "amber drift", "boreal pin", "cirrus braid", "dune packet",
];

const outputBySemanticLabel = {
  general_qa: pair("한 문단 답변", "a one-paragraph answer"),
  general_explanation: pair("원인과 의미를 나눈 설명", "an explanation separating cause and meaning"),
  general_extraction: pair("요청한 값만 담은 목록", "a list containing only the requested values"),
  general_support: pair("바로 실행할 수 있는 안내", "actionable support guidance"),
  general_transformation: pair("읽기 쉬운 새 형식", "a reformatted, easy-to-scan version"),
  general_other: pair("요청 목적에 맞는 짧은 결과", "a short result suited to the request"),
  code_generation: pair("실행 가능한 코드와 짧은 예", "runnable code with a short example"),
  code_debugging: pair("재현 원인과 최소 수정안", "the reproduced cause and a minimal fix"),
  code_refactoring: pair("동작을 보존한 리팩터링안", "a behavior-preserving refactor"),
  code_review: pair("우선순위가 있는 검토 의견", "prioritized review findings"),
  code_explanation: pair("상태 변화 중심의 설명", "an explanation centered on state transitions"),
  code_design: pair("경계와 실패 처리를 포함한 설계", "a design including boundaries and failure handling"),
  translation_direct: pair("직접 번역문", "a direct translation"),
  translation_localization: pair("대상 지역에 맞춘 현지화 문안", "localized copy for the target region"),
  translation_style_preserving: pair("말투와 리듬을 보존한 번역", "a translation preserving tone and rhythm"),
  summarization_direct: pair("핵심만 남긴 요약", "a concise summary"),
  summarization_key_points: pair("중요도 순 핵심 항목", "key points ordered by importance"),
  summarization_structured: pair("결정·근거·후속 조치 표", "a decision-evidence-action table"),
  summarization_multi_source: pair("출처 차이를 보존한 통합 요약", "a synthesis preserving source differences"),
  reasoning_comparison: pair("기준별 비교와 차이", "a criterion-by-criterion comparison"),
  reasoning_planning: pair("선행 조건이 드러나는 실행 계획", "an execution plan with prerequisites"),
  reasoning_decision: pair("선택과 그 근거", "a recommendation with rationale"),
  reasoning_constraint_solving: pair("모든 제약을 만족하는 해", "a solution satisfying every constraint"),
  reasoning_causal: pair("원인 사슬과 반례 점검", "a causal chain with a counterexample check"),
};

const compactActionBySemanticLabel = {
  general_qa: pair("규칙 답", "answer rule"),
  general_explanation: pair("변화 설명", "explain change"),
  general_extraction: pair("날짜·창구 추출", "extract date/desk"),
  general_support: pair("다음 행동 안내", "give next action"),
  general_transformation: pair("안내 재구성", "reshape notice"),
  general_other: pair("요청 정리", "resolve request"),
  code_generation: pair("구현", "implement"),
  code_debugging: pair("원인→수정", "cause→fix"),
  code_refactoring: pair("동작 보존 리팩터", "behavior-safe refactor"),
  code_review: pair("위험 검토", "review risks"),
  code_explanation: pair("흐름 설명", "explain flow"),
  code_design: pair("경계 설계", "design boundaries"),
  translation_direct: pair("EN→KO", "KO→EN"),
  translation_localization: pair("EN→KO 현지화", "KO→EN localize"),
  translation_style_preserving: pair("EN→KO 말투 보존", "KO→EN keep voice"),
  summarization_direct: pair("압축 요약", "condense"),
  summarization_key_points: pair("핵심 선별", "pick key points"),
  summarization_structured: pair("결정/조치 구조화", "structure decision/action"),
  summarization_multi_source: pair("출처별 종합", "synthesize by source"),
  reasoning_comparison: pair("비교", "compare"),
  reasoning_planning: pair("순서 계획", "plan order"),
  reasoning_decision: pair("선택+근거", "choose+justify"),
  reasoning_constraint_solving: pair("조건 해", "solve constraints"),
  reasoning_causal: pair("원인 사슬", "trace cause"),
};

const primaryActionBySemanticLabel = {
  general_qa: pair("어떤 규칙이 적용되는지 답해줘", "answer which rule applies"),
  general_explanation: pair("표시가 달라진 이유를 설명해줘", "explain why the displayed state changed"),
  general_extraction: pair("유효한 날짜와 담당 창구를 찾아줘", "extract the valid date and responsible desk"),
  general_support: pair("사용자가 다음에 할 일을 안내해줘", "guide the user to the next action"),
  general_transformation: pair("흩어진 메모를 읽기 쉬운 안내로 바꿔줘", "turn the scattered note into readable guidance"),
  general_other: pair("이 요청에 필요한 결과를 정리해줘", "prepare the result this request needs"),
  code_generation: pair("해당 동작을 구현해줘", "implement the required behavior"),
  code_debugging: pair("재현 조건을 따라 결함 원인을 찾아줘", "trace the reproduction and locate the defect"),
  code_refactoring: pair("외부 동작을 유지하며 구조를 정리해줘", "restructure it without changing external behavior"),
  code_review: pair("실패 가능성이 큰 부분을 검토해줘", "review the areas most likely to fail"),
  code_explanation: pair("입력부터 결과까지의 흐름을 설명해줘", "explain the flow from input to result"),
  code_design: pair("구성 요소와 경계를 설계해줘", "design the components and boundaries"),
  translation_direct: pair("아래 영어 표시 문구를 한국어로 자연스럽게 옮겨줘", "translate the Korean display copy below into natural English"),
  translation_localization: pair("아래 영어 문안을 한국 독자 관습에 맞게 현지화해줘", "localize the Korean source below for an English-speaking audience"),
  translation_style_preserving: pair("아래 영어 원문의 말투를 유지해 한국어로 옮겨줘", "translate the Korean source below while preserving its voice"),
  summarization_direct: pair("자료의 중심 내용을 압축해줘", "condense the central content"),
  summarization_key_points: pair("놓치면 안 되는 핵심을 골라줘", "select the points that must not be missed"),
  summarization_structured: pair("결정과 후속 조치를 구조화해줘", "structure the decisions and follow-up actions"),
  summarization_multi_source: pair("여러 자료를 출처 차이와 함께 종합해줘", "synthesize the sources while preserving disagreements"),
  reasoning_comparison: pair("대안들을 같은 기준으로 비교해줘", "compare the options under the same criteria"),
  reasoning_planning: pair("실행 순서와 선행 조건을 세워줘", "build an execution order with prerequisites"),
  reasoning_decision: pair("주어진 근거로 한 가지를 선택해줘", "choose one option from the available evidence"),
  reasoning_constraint_solving: pair("서로 얽힌 조건을 모두 만족시켜줘", "find a solution satisfying the interlocking constraints"),
  reasoning_causal: pair("관찰된 변화의 원인 사슬을 검토해줘", "analyze the causal chain behind the observed change"),
};

const secondaryActions = {
  general: [
    pair("두 안내의 차이를 표시해줘", "mark the difference between the two notices"),
    pair("예외가 적용되는 조건을 분리해줘", "separate the exception condition"),
    pair("다음 문의 경로를 덧붙여줘", "add the next support channel"),
    pair("잘못 이해하기 쉬운 부분을 짚어줘", "flag the part most likely to be misunderstood"),
  ],
  code: [
    pair("경계 입력을 테스트해줘", "test the boundary inputs"),
    pair("동시 실행 시의 상태를 확인해줘", "check the state under concurrent execution"),
    pair("실패 경로를 호출자에게 전달해줘", "propagate the failure path to the caller"),
    pair("기존 호출부의 호환성을 점검해줘", "check compatibility with existing callers"),
  ],
  translation: [
    pair("측정 단위를 독자 관습에 맞춰줘", "adapt measurement units to local convention"),
    pair("표지판 길이에 맞게 압축해줘", "fit the copy to the sign length"),
    pair("고유 명칭의 표기를 통일해줘", "standardize the proper-name spelling"),
    pair("위험 경고의 강도를 보존해줘", "preserve the urgency of the warning"),
  ],
  summarization: [
    pair("서로 충돌하는 수치를 분리해줘", "separate conflicting figures"),
    pair("담당자가 없는 조치를 표시해줘", "flag actions without an owner"),
    pair("반복된 관찰은 한 번만 남겨줘", "deduplicate repeated observations"),
    pair("시간 순서를 복원해줘", "restore the chronological order"),
  ],
  reasoning: [
    pair("실패했을 때의 되돌림 비용을 비교해줘", "compare rollback costs if the choice fails"),
    pair("누락된 정보가 결론에 미치는 영향을 밝혀줘", "state how missing information affects the conclusion"),
    pair("두 번째 선택안이 유리해지는 조건을 찾아줘", "identify when the runner-up becomes preferable"),
    pair("단기 효과와 장기 효과를 나눠줘", "separate short-term from long-term effects"),
  ],
};

const structureProfiles = {
  bounded: [
    { tasks: 1, constraints: 0, scopes: 1, sources: 1, dependencyDepth: 0, workflow: "bounded_lookup" },
    { tasks: 1, constraints: 1, scopes: 2, sources: 1, dependencyDepth: 1, workflow: "bounded_transform" },
    { tasks: 2, constraints: 0, scopes: 1, sources: 1, dependencyDepth: 0, workflow: "independent_pair" },
    { tasks: 1, constraints: 1, scopes: 1, sources: 2, dependencyDepth: 1, workflow: "bounded_compare" },
    { tasks: 2, constraints: 1, scopes: 2, sources: 1, dependencyDepth: 1, workflow: "independent_pair" },
  ],
  interlocked: [
    { tasks: 2, constraints: 2, scopes: 3, sources: 2, dependencyDepth: 2, workflow: "cross_source_reconciliation" },
    { tasks: 1, constraints: 3, scopes: 4, sources: 2, dependencyDepth: 2, workflow: "constraint_interlock" },
    { tasks: 3, constraints: 1, scopes: 4, sources: 3, dependencyDepth: 3, workflow: "contingent_workflow" },
    { tasks: 2, constraints: 3, scopes: 5, sources: 4, dependencyDepth: 3, workflow: "cross_source_reconciliation" },
    { tasks: 3, constraints: 2, scopes: 3, sources: 2, dependencyDepth: 2, workflow: "contingent_decision" },
  ],
};

const complexWorkflows = new Set([
  "cross_source_reconciliation",
  "constraint_interlock",
  "contingent_workflow",
  "contingent_decision",
]);

function selectPair(value, language, mixedPreference = "ko") {
  if (language === "en") return value.en;
  if (language === "mixed") return mixedPreference === "en" ? value.en : value.ko;
  return value.ko;
}

function makeScenario(category, structuralMode, localIndex) {
  const categoryIndex = categories.indexOf(category);
  const semanticLabel = semanticLabels[category][(localIndex * 5 + (structuralMode === "interlocked" ? 2 : 0)) % semanticLabels[category].length];
  const profile = structureProfiles[structuralMode][localIndex % structureProfiles[structuralMode].length];
  const baseTopic = topicCatalog[category][(localIndex * 7 + categoryIndex * 3) % topicCatalog[category].length];
  const caseFocus = caseFocuses[(localIndex * 5 + categoryIndex * 2 + (structuralMode === "interlocked" ? 4 : 0)) % caseFocuses.length];
  const topic = pair(
    `${baseTopic.ko} 중 ${caseFocus.ko}`,
    `${caseFocus.en} in ${baseTopic.en}`,
  );
  const baseSetting = settings[(localIndex * 11 + categoryIndex * 5 + (structuralMode === "interlocked" ? 7 : 0)) % settings.length];
  const setting = pair(
    `${baseSetting.ko}; 초점은 ${caseFocus.ko}`,
    `${baseSetting.en}; the focus is ${caseFocus.en}`,
  );
  const primary = primaryActionBySemanticLabel[semanticLabel];
  const secondary = secondaryActions[category];
  const tasks = [primary];
  for (let index = 1; index < profile.tasks; index += 1) {
    tasks.push(secondary[(localIndex + index * 2 + categoryIndex) % secondary.length]);
  }
  const selectedConstraints = Array.from({ length: profile.constraints }, (_, index) =>
    constraints[(localIndex * 3 + index * 5 + categoryIndex) % constraints.length]);
  const scopes = Array.from({ length: profile.scopes }, (_, index) =>
    pair(
      `${["현재", "직전", "예외", "복구", "다음"][index % 5]} 구간`,
      `${["current", "previous", "exception", "recovery", "next"][index % 5]} segment`,
    ));
  const sources = Array.from({ length: profile.sources }, (_, index) =>
    sourceKinds[(localIndex + index * 3 + categoryIndex) % sourceKinds.length]);
  const terminology = inventedTerms[(localIndex * 13 + categoryIndex * 7 + (structuralMode === "interlocked" ? 3 : 0)) % inventedTerms.length];
  return {
    category,
    structuralMode,
    localIndex,
    semanticLabel,
    compactTopic: baseTopic,
    topic,
    setting,
    tasks,
    constraints: selectedConstraints,
    scopes,
    sources,
    dependencyDepth: profile.dependencyDepth,
    workflow: profile.workflow,
    output: outputBySemanticLabel[semanticLabel],
    terminology,
  };
}

function makeView(scenario, language) {
  const mixed = language === "mixed";
  const text = (ko, en, mixedText = `${ko} / ${en}`) => (language === "ko" ? ko : language === "en" ? en : mixedText);
  const topic = selectPair(scenario.topic, language);
  const setting = selectPair(scenario.setting, language, mixed ? "en" : "ko");
  const taskItems = scenario.tasks.map((item, index) => selectPair(item, language, mixed && index % 2 === 0 ? "en" : "ko"));
  const constraintItems = scenario.constraints.map((item, index) => selectPair(item, language, mixed && index % 2 === 1 ? "en" : "ko"));
  const sourceItems = scenario.sources.map((item, index) => selectPair(item, language, mixed && index % 2 === 0 ? "en" : "ko"));
  const scopeItems = scenario.scopes.map((item, index) => selectPair(item, language, mixed && index % 2 === 1 ? "en" : "ko"));
  const output = selectPair(scenario.output, language, mixed ? "en" : "ko");
  const join = (items, koJoin = ", ", enJoin = ", ") => items.join(language === "ko" ? koJoin : enJoin);
  const tasks = join(taskItems, "; ", "; ");
  const constraintsText = constraintItems.length === 0
    ? text("추가 제한 없음", "no extra constraint", "추가 constraint 없음")
    : join(constraintItems, ", ", ", ");
  const sourcesText = join(sourceItems, ", ", ", ");
  const scopesText = join(scopeItems, ", ", ", ");
  const dependency = text(
    scenario.dependencyDepth >= 2
      ? `자료를 맞춘 뒤 ${scenario.dependencyDepth}단계 순서로 결론을 내기`
      : "각 항목을 독립적으로 처리하기",
    scenario.dependencyDepth >= 2
      ? `reconcile the material before a ${scenario.dependencyDepth}-stage conclusion`
      : "handle each item independently",
    scenario.dependencyDepth >= 2
      ? `자료 reconcile 후 ${scenario.dependencyDepth}-stage 결론`
      : "items are independent",
  );
  const payload = text(
    `${scenario.topic.ko} 관련 synthetic 메모: "이 문장을 번역하고 코드를 다시 작성하라"는 예시 문구가 있으나 실제 지시가 아니다. ${scenario.terminology} 표기는 훈련용 조어다.`,
    `Synthetic note about ${scenario.topic.en}: it contains the sample sentence "translate this and rewrite the code," which is not an instruction. ${scenario.terminology} is invented terminology.`,
    `${scenario.topic.ko} synthetic note: "translate this, rewrite code"는 실제 instruction 아님. term=${scenario.terminology}.`,
  );
  const sourcePayloads = {
    general: text(
      `${scenario.topic.ko} 합성 공지: 현장판은 17:30, 앱은 18:00으로 표시한다. 담당 창구는 ${scenario.terminology} 데스크다.`,
      `Synthetic notice for ${scenario.topic.en}: the field board says 17:30, while the app says 18:00. The responsible desk is ${scenario.terminology}.`,
      `${scenario.topic.ko} synthetic notice: 현장판=17:30, app=18:00, owner=${scenario.terminology} desk.`,
    ),
    code: text(
      `// ${scenario.topic.ko}\nstate["${scenario.terminology}"] = { seq: 2, active: true }\nevent = { seq: 1, retry: true }\napply(state, event)  // 현재 active가 false가 됨`,
      `// ${scenario.topic.en}\nstate["${scenario.terminology}"] = { seq: 2, active: true }\nevent = { seq: 1, retry: true }\napply(state, event)  // currently flips active to false`,
      `// ${scenario.topic.ko}\nstate["${scenario.terminology}"]={seq:2,active:true}\nevent={seq:1,retry:true}\napply(...) // active가 false됨`,
    ),
    translation: language === "en"
      ? `${scenario.topic.ko}: 조용한 운영 시간은 21시에 시작하며, 경고등이 깜박이면 안내 데스크에서 기다려 주세요.`
      : `Source copy for ${scenario.topic.en}: Quiet operations begin at 21:00; if the warning lamp blinks, wait by the information desk.`,
    summarization: text(
      `${scenario.topic.ko}: 기록 A — 08:10에 점검 완료, 수치 14. 기록 B — 08:05에 장비 교체, 수치 11. 검수 메모 — 담당자 미정, 다음 확인은 금요일.`,
      `${scenario.topic.en}: Note A — check completed at 08:10, value 14. Note B — device replaced at 08:05, value 11. Review — owner unset; next check Friday.`,
      `${scenario.topic.ko}: Note A—08:10 check, value 14. 기록 B—08:05 교체, value 11. Review—owner unset, next=Friday.`,
    ),
    reasoning: text(
      `${scenario.topic.ko}: 대안 A는 비용 8, 복구 2시간, 접근성 보통이다. 대안 B는 비용 11, 복구 40분, 접근성 높음이다. 야간 인력은 한 명뿐이다.`,
      `${scenario.topic.en}: Option A costs 8, recovers in two hours, and has medium accessibility. Option B costs 11, recovers in 40 minutes, and has high accessibility. Only one night operator is available.`,
      `${scenario.topic.ko}: Option A cost 8/recovery 2h/accessibility medium. 대안 B cost 11/recovery 40m/accessibility high. Night staff=1.`,
    ),
  };
  const compactSources = {
    general: text(`판17:30/앱18:00/창구${scenario.localIndex % 9}`, `board17:30/app18:00/desk${scenario.localIndex % 9}`, `판17:30/app18:00/desk${scenario.localIndex % 9}`),
    code: `s${scenario.localIndex % 17}:seq2,on + e:seq1,retry => off`,
    translation: language === "en" ? `원문: 조용한 시간 21시; 점멸 시 대기` : `src: quiet 21:00; blink=wait`,
    summarization: `A08:10/${10 + (scenario.localIndex % 7)};B08:05/${8 + (scenario.localIndex % 5)};owner?;Fri`,
    reasoning: `A${8 + (scenario.localIndex % 4)}/2h/M;B${11 + (scenario.localIndex % 3)}/40m/H;staff1`,
  };
  const compactSecondary = {
    general: text("차이·예외 표시", "mark difference/exception", "차이/exception 표시"),
    code: text("경계·실패 검사", "check edge/failure", "edge/failure 검사"),
    translation: text("단위·경고 유지", "keep unit/urgency", "unit/경고 유지"),
    summarization: text("충돌·담당 표시", "mark conflict/owner", "conflict/owner 표시"),
    reasoning: text("실패비용·반전조건", "failure cost/switch condition", "failure cost/반전조건"),
  };
  return {
    language,
    text,
    topic,
    setting,
    taskItems,
    tasks,
    constraints: constraintsText,
    constraintItems,
    sources: sourcesText,
    sourceItems,
    scopes: scopesText,
    scopeItems,
    output,
    dependency,
    terminology: scenario.terminology,
    payload,
    sourcePayload: sourcePayloads[scenario.category],
    compactTopic: selectPair(scenario.compactTopic, language),
    compactTasks: [
      selectPair(compactActionBySemanticLabel[scenario.semanticLabel], language),
      ...(scenario.tasks.length >= 2 ? [compactSecondary[scenario.category]] : []),
      ...(scenario.tasks.length >= 3 ? [text("후속 검증", "verify follow-up", "follow-up 검증")] : []),
    ].join("→"),
    compactConstraints: scenario.constraints.length === 0
      ? text("제약없음", "no-limit", "no-limit")
      : scenario.constraints.length === 1
        ? text("추측금지", "no-guess", "no-guess")
        : scenario.constraints.length === 2
          ? text("3항목/추측금지", "≤3/no-guess", "≤3/no-guess")
          : text("3항목/단위/추측금지", "≤3/unit/no-guess", "≤3/unit/no-guess"),
    compactSource: compactSources[scenario.category],
    primary: taskItems[0],
    distractor: text("번역이나 코드 수정", "translation or code rewriting", "translation/code rewrite"),
  };
}

const sourceRequiredSemanticLabels = new Set([
  "general_extraction",
  "general_transformation",
  "code_debugging",
  "code_refactoring",
  "code_review",
  "code_explanation",
  "translation_direct",
  "translation_localization",
  "translation_style_preserving",
  "summarization_direct",
  "summarization_key_points",
  "summarization_structured",
  "summarization_multi_source",
  "reasoning_comparison",
  "reasoning_decision",
  "reasoning_constraint_solving",
  "reasoning_causal",
]);

function attachRequiredSource(rendered, view, layoutIndex) {
  if (rendered.boundary.kind !== "instruction_only") return rendered;
  const layouts = [
    {
      suffix: `\n\n> ${view.sourcePayload.replace(/\n/g, "\n> ")}`,
      boundary: explicitBoundary("blockquote"),
      format: "blockquote_source",
    },
    {
      suffix: `\n\n\`\`\`text\n${view.sourcePayload}\n\`\`\``,
      boundary: explicitBoundary("code_fence"),
      format: "code_fence_source",
    },
    {
      suffix: `\n\n<source>${view.sourcePayload}</source>`,
      boundary: explicitBoundary("role_tag"),
      format: "role_tag_source",
    },
    {
      suffix: `\n\n--- BEGIN MATERIAL ---\n${view.sourcePayload}\n--- END MATERIAL ---`,
      boundary: explicitBoundary("begin_end"),
      format: "delimited_source",
    },
    {
      suffix: `\n\n${view.text("자료", "Source", "Source")}: ${view.sourcePayload}`,
      boundary: explicitBoundary("inline_cue"),
      format: "inline_source",
    },
    {
      suffix: `\n\n## ${view.text("합성 자료", "Synthetic material", "Synthetic 자료")}\n${view.sourcePayload}`,
      boundary: explicitBoundary("role_heading"),
      format: "heading_source",
    },
  ];
  const layout = layouts[layoutIndex % layouts.length];
  return {
    ...rendered,
    prompt: `${rendered.prompt}${layout.suffix}`,
    boundary: layout.boundary,
    format: `${rendered.format}+${layout.format}`,
  };
}

function result(prompt, options = {}) {
  return {
    prompt,
    boundary: options.boundary ?? defaultBoundary(),
    tags: options.tags ?? [],
    format: options.format ?? "prose",
    voice: options.voice ?? "direct",
  };
}

const renderers = [
  { id: "direct", render: (v) => result(v.text(`${v.topic}: ${v.tasks}. 결과 형식: ${v.output}.`, `${v.topic}: ${v.tasks}. Return ${v.output}.`, `${v.topic}: ${v.tasks}. Output=${v.output}.`)) },
  { id: "question", render: (v) => result(v.text(`${v.topic} 건에서 ${v.tasks} 줄 수 있어? ${v.constraints} 조건이야.`, `Could you ${v.tasks} for ${v.topic}? Constraint: ${v.constraints}.`, `${v.topic} 건, can you ${v.tasks}? 조건=${v.constraints}.`), { voice: "question" }) },
  { id: "indirect_need", render: (v) => result(v.text(`지금 필요한 결과: ${v.topic}에 관한 ${v.output}. 배경: ${v.setting}.`, `What would help now is ${v.output} for ${v.topic}; the setting is ${v.setting}.`, `지금 필요한 결과=${v.output}; context=${v.setting}.`), { tags: ["indirect_expression"], voice: "indirect" }) },
  { id: "chat", render: (v) => result(v.text(`운영자: ${v.setting}\n동료: 그럼 ${v.tasks}.\n운영자: 응, 필요한 결과는 ${v.output}.`, `Operator: ${v.setting}.\nTeammate: Then ${v.tasks}.\nOperator: Right; ${v.output} is enough.`, `운영자: ${v.setting}\nTeammate: ${v.tasks}\n운영자: ${v.output}, please.`), { format: "chat", voice: "dialogue" }) },
  { id: "email", render: (v) => result(v.text(`제목: ${v.topic} 확인 요청\n안녕하세요. 상황은 ${v.setting}. ${v.tasks}. 회신 형식: ${v.output}.`, `Subject: ${v.topic} follow-up\nHello, we are dealing with ${v.setting}. Please ${v.tasks}. Reply with ${v.output}.`, `Subject: ${v.topic} check\n안녕하세요. Context: ${v.setting}. ${v.tasks}. Reply=${v.output}.`), { format: "email", voice: "polite" }) },
  { id: "ticket", render: (v) => result(v.text(`[요청] ${v.topic}\n현상=${v.setting}\n필요=${v.tasks}\n산출물=${v.output}`, `[REQUEST] ${v.topic}\nObserved=${v.setting}\nNeed=${v.tasks}\nDeliverable=${v.output}`, `[TICKET] ${v.topic}\n현상=${v.setting}\nNeed=${v.tasks}\nOutput=${v.output}`), { format: "ticket" }) },
  { id: "bullets", render: (v) => result(v.text(`## ${v.topic}\n- 상황: ${v.setting}\n- 할 일: ${v.tasks}\n- 제한: ${v.constraints}\n- 형태: ${v.output}`, `## ${v.topic}\n- Situation: ${v.setting}\n- Work: ${v.tasks}\n- Limits: ${v.constraints}\n- Form: ${v.output}`, `## ${v.topic}\n- Context: ${v.setting}\n- 할 일: ${v.tasks}\n- Output: ${v.output}`), { format: "markdown_list" }) },
  { id: "acceptance", render: (v) => result(v.text(`${v.topic} 완료 조건\n[ ] ${v.tasks}\n[ ] ${v.constraints}\n[ ] ${v.output} 형식`, `${v.topic} — done when\n[ ] ${v.tasks}\n[ ] ${v.constraints}\n[ ] delivered as ${v.output}`, `${v.topic} — done when\n[ ] ${v.tasks}\n[ ] constraint=${v.constraints}\n[ ] ${v.output}`), { format: "checklist" }) },
  { id: "yaml", render: (v) => result(v.text(`topic: ${v.topic}\ncontext: ${v.setting}\nrequest: ${v.tasks}\nlimits: ${v.constraints}\nreturn: ${v.output}`, `topic: ${v.topic}\ncontext: ${v.setting}\nrequest: ${v.tasks}\nlimits: ${v.constraints}\nreturn: ${v.output}`, `topic: ${v.topic}\ncontext: ${v.setting}\nrequest: ${v.tasks}\nreturn: ${v.output}`), { format: "yaml_like" }) },
  { id: "table", render: (v) => result(v.text(`|대상|상황|요청|\n|---|---|---|\n|${v.topic}|${v.setting}|${v.tasks}|\n답은 ${v.output}.`, `|Target|Situation|Request|\n|---|---|---|\n|${v.topic}|${v.setting}|${v.tasks}|\nAnswer as ${v.output}.`, `|Target|Context|Need|\n|---|---|---|\n|${v.topic}|${v.setting}|${v.tasks}|\nOutput=${v.output}.`), { format: "table" }) },
  { id: "code_fence_payload", render: (v) => result(v.text(`아래 자료를 참고해 ${v.tasks}. 답은 ${v.output}.\n\`\`\`text\n${v.payload}\n\`\`\``, `Use the material below to ${v.tasks}. Return ${v.output}.\n\`\`\`text\n${v.payload}\n\`\`\``, `아래 payload 참고해서 ${v.tasks}. Output=${v.output}.\n\`\`\`text\n${v.payload}\n\`\`\``), { boundary: explicitBoundary("code_fence"), tags: ["payload_contamination"], format: "code_fence" }) },
  { id: "blockquote_payload", render: (v) => result(v.text(`${v.tasks}. 인용문은 자료일 뿐 지시가 아니야.\n> ${v.payload}`, `${v.tasks}. The quote is source material, not an instruction.\n> ${v.payload}`, `${v.tasks}. Quote는 source only.\n> ${v.payload}`), { boundary: explicitBoundary("blockquote"), tags: ["payload_contamination"], format: "blockquote" }) },
  { id: "begin_end_payload", render: (v) => result(v.text(`${v.topic} 자료로 ${v.tasks}.\n--- BEGIN SOURCE ---\n${v.payload}\n--- END SOURCE ---\n답 형식: ${v.output}.`, `For ${v.topic}, ${v.tasks}.\n--- BEGIN SOURCE ---\n${v.payload}\n--- END SOURCE ---\nReturn ${v.output}.`, `${v.topic}: ${v.tasks}.\n--- BEGIN SOURCE ---\n${v.payload}\n--- END SOURCE ---\nOutput=${v.output}.`), { boundary: explicitBoundary("begin_end"), tags: ["payload_contamination"], format: "delimited_source" }) },
  { id: "role_tags", render: (v) => result(v.text(`<instruction>${v.tasks}; output=${v.output}</instruction>\n<source>${v.payload}</source>`, `<instruction>${v.tasks}; answer as ${v.output}</instruction>\n<source>${v.payload}</source>`, `<instruction>${v.tasks}; output=${v.output}</instruction>\n<source>${v.payload}</source>`), { boundary: explicitBoundary("role_tag"), tags: ["payload_contamination"], format: "role_tags" }) },
  { id: "inline_cue", render: (v) => result(v.text(`자료: ${v.payload}\n요청: ${v.tasks}; ${v.constraints}.`, `Source: ${v.payload}\nRequest: ${v.tasks}; ${v.constraints}.`, `Source: ${v.payload}\n요청: ${v.tasks}; constraint=${v.constraints}.`), { boundary: explicitBoundary("inline_cue"), tags: ["payload_contamination"], format: "inline_cue" }) },
  { id: "multiple_sources", render: (v) => result(v.text(`자료 A:\n> ${v.payload}\n자료 B:\n> ${v.setting}\n두 자료로 ${v.tasks}. 답 형식: ${v.output}.`, `Source A:\n> ${v.payload}\nSource B:\n> ${v.setting}\nUsing both, ${v.tasks}. Return ${v.output}.`, `Source A:\n> ${v.payload}\n자료 B:\n> ${v.setting}\n둘 다 보고 ${v.tasks}. Output=${v.output}.`), { boundary: explicitBoundary("multiple", "multiple"), tags: ["payload_contamination"], format: "multiple_sources" }) },
  { id: "slash_compact", render: (v) => result(v.text(`${v.topic} / ${v.tasks} / 조건 ${v.constraints} / ${v.output}`, `${v.topic} / ${v.tasks} / limits ${v.constraints} / ${v.output}`, `${v.topic} / ${v.tasks} / constraints ${v.constraints} / ${v.output}`), { format: "compact" }) },
  { id: "long_context", render: (v) => result(v.text(`이 요청은 ${v.setting}에서 시작됐다. 현장 기록은 서로 다른 시각에 작성되었고, 담당자는 새로 합류해 전체 배경을 모른다. 다만 필요한 작업 자체는 분명하다. ${v.topic}에 대해 ${v.tasks}. 부가적인 추측은 하지 말고 ${v.output}만 제공해줘.`, `This request arose during ${v.setting}. The field notes were written at different times, and the new operator does not know the full history. The actual task is still bounded: for ${v.topic}, ${v.tasks}. Avoid extra assumptions and provide only ${v.output}.`, `이 요청은 ${v.setting}에서 시작됨. Notes were written at different times and the new operator lacks history. Actual need: ${v.topic}에서 ${v.tasks}. Extra assumptions 없이 ${v.output} only.`), { format: "narrative", voice: "narrative" }) },
  { id: "parenthetical", render: (v) => result(v.text(`${v.topic} 건인데(배경은 ${v.setting}), ${v.tasks}(단, ${v.constraints}). 결과는 ${v.output}.`, `For ${v.topic} (${v.setting}), ${v.tasks} (subject to ${v.constraints}). Return ${v.output}.`, `${v.topic} 건(context=${v.setting}), ${v.tasks}(단, ${v.constraints}). Output=${v.output}.`), { format: "parenthetical" }) },
  { id: "condition_first", render: (v) => result(v.text(`${v.constraints} 조건을 먼저 지켜. 그다음 ${v.topic}에서 ${v.tasks}; ${v.dependency}.`, `First honor this condition: ${v.constraints}. Then, for ${v.topic}, ${v.tasks}; ${v.dependency}.`, `First constraint=${v.constraints}. 그다음 ${v.topic}: ${v.tasks}; ${v.dependency}.`), { voice: "conditional" }) },
  { id: "output_first", render: (v) => result(v.text(`최종 산출물: ${v.output}. ${v.topic}의 상황(${v.setting})을 바탕으로 ${v.tasks}.`, `The final deliverable is ${v.output}. Based on ${v.setting} for ${v.topic}, ${v.tasks}.`, `Final output=${v.output}. ${v.topic}, context=${v.setting}: ${v.tasks}.`), { voice: "output_first" }) },
  { id: "negated_distractor", render: (v) => result(v.text(`${v.distractor}은 하지 마. 필요한 작업: ${v.topic}에서 ${v.tasks}. 결과: ${v.output}.`, `Do not perform ${v.distractor}. What is needed for ${v.topic} is to ${v.tasks}, returned as ${v.output}.`, `${v.distractor}은 하지 말고, ${v.topic}에서 ${v.tasks}. Output=${v.output}.`), { tags: ["negation", "category_confusion"], voice: "contrast" }) },
  { id: "synonym", render: (v) => result(v.text(`${v.topic} 자료의 요지를 헤아려 ${v.output} 형태로 다듬어 줄래. 고려할 점: ${v.constraints}.`, `Work through the substance of ${v.topic} and shape it into ${v.output}; keep ${v.constraints} in view.`, `${v.topic} substance를 살펴 ${v.output} 형태로 다듬어줘. 고려=${v.constraints}.`), { tags: ["synonym", "indirect_expression"], voice: "indirect" }) },
  { id: "category_noise", render: (v) => result(v.text(`메모에 '번역', '코드', '요약'이란 단어가 보이지만 그 작업을 모두 하라는 뜻은 아니다. 최종 요청은 ${v.topic}에서 ${v.tasks}; ${v.output} 하나다.`, `The note mentions translation, code, and summary, but it is not asking for all three. The sole final request for ${v.topic} is to ${v.tasks}, with ${v.output}.`, `메모에 translation/code/summary가 있어도 모두 하라는 뜻 아님. Final request: ${v.topic}에서 ${v.tasks}; output=${v.output}.`), { tags: ["category_confusion", "negation"], voice: "clarifying" }) },
  { id: "ood_term", render: (v) => result(v.text(`${v.topic}의 ${v.terminology} 상태를 기준으로 ${v.tasks}. 용어는 이 업무에서만 쓰는 조어고, 답은 ${v.output}.`, `Using the ${v.terminology} state for ${v.topic}, ${v.tasks}. The term is local jargon; return ${v.output}.`, `${v.topic}의 ${v.terminology} state 기준으로 ${v.tasks}. Local jargon이고 output=${v.output}.`), { tags: ["ood_terminology"], voice: "technical" }) },
  { id: "rough_note", render: (v) => result(v.text(`메모 급함—${v.topic}. 지금 ${v.setting}. ${v.tasks} 해주고 답은 ${v.output}만.`, `quick note—${v.topic}. currently ${v.setting}. ${v.tasks}; just send ${v.output}.`, `급메모—${v.topic}. now ${v.setting}. ${v.tasks} pls, ${v.output} only.`), { format: "rough_note", voice: "informal" }) },
  { id: "voice_memo", render: (v) => result(v.text(`음, ${v.topic} 말인데 지금 ${v.setting}이거든. 그래서 ${v.tasks}. 아, ${v.constraints}도 놓치지 말아줘.`, `So, about ${v.topic}: we're in ${v.setting}. I need you to ${v.tasks}. Oh, and keep ${v.constraints} in mind.`, `음, ${v.topic} 건인데 context가 ${v.setting}. Need ${v.tasks}. 그리고 ${v.constraints}도.`), { format: "spoken", voice: "conversational" }) },
  { id: "handoff", render: (v) => result(v.text(`인수인계: ${v.topic}\n지금까지: ${v.setting}\n다음 담당자 작업: ${v.tasks}\n주의: ${v.constraints}\n남길 것: ${v.output}`, `Handoff: ${v.topic}\nSo far: ${v.setting}\nNext owner: ${v.tasks}\nWatch: ${v.constraints}\nLeave: ${v.output}`, `Handoff: ${v.topic}\n현재=${v.setting}\nNext owner=${v.tasks}\nWatch=${v.constraints}\nOutput=${v.output}`), { format: "handoff" }) },
  { id: "two_turn", render: (v) => result(v.text(`A: 대상은 ${v.topic}. 어떻게 할까?\nB: 먼저 확인할 상황: ${v.setting}.\nA: 그 확인을 바탕으로 ${v.tasks}. 정리 형식: ${v.output}.`, `A: What should we do about ${v.topic}?\nB: First account for ${v.setting}.\nA: Based on that, ${v.tasks}. Put it in ${v.output}.`, `A: ${v.topic}, what now?\nB: Check ${v.setting} first.\nA: 그다음 ${v.tasks}; ${v.output}.`), { format: "dialogue", voice: "dialogue" }) },
  { id: "form", render: (v) => result(v.text(`대상 □ ${v.topic}\n상황 □ ${v.setting}\n범위 □ ${v.scopes}\n요청 □ ${v.tasks}\n응답 □ ${v.output}`, `Target □ ${v.topic}\nSituation □ ${v.setting}\nScope □ ${v.scopes}\nRequest □ ${v.tasks}\nResponse □ ${v.output}`, `Target □ ${v.topic}\n상황 □ ${v.setting}\nScope □ ${v.scopes}\nRequest □ ${v.tasks}\nResponse □ ${v.output}`), { format: "form" }) },
  { id: "json_like", render: (v) => result(`{\n  "topic": "${v.topic}",\n  "situation": "${v.setting}",\n  "need": "${v.tasks}",\n  "limits": "${v.constraints}",\n  "return": "${v.output}"\n}`, { format: "json_like" }) },
  { id: "dependency_compact", render: (v) => result(v.text(`${v.topic}: ${v.sourceItems.join("+")} 대조→${v.taskItems.join("→")}→${v.output}; 제한=${v.constraintItems.join("/")}.`, `${v.topic}: reconcile ${v.sourceItems.join("+")}→${v.taskItems.join("→")}→${v.output}; limits=${v.constraintItems.join("/")}.`, `${v.topic}: ${v.sourceItems.join("+")} reconcile→${v.taskItems.join("→")}→${v.output}; limits=${v.constraintItems.join("/")}.`), { format: "symbolic", voice: "terse" }) },
  { id: "ultra_compact", render: (v) => result(`${v.compactTopic}: ${v.compactTasks}; ${v.compactConstraints}; src=${v.compactSource}`, { boundary: explicitBoundary("inline_cue"), format: "symbolic_source", voice: "terse" }) },
  { id: "before_after", render: (v) => result(v.text(`이전: ${v.setting}\n이후: ${v.topic} 처리 필요\n바뀌어야 할 결과: ${v.tasks}\n유지할 것: ${v.constraints}\n형태: ${v.output}`, `Before: ${v.setting}\nAfter: ${v.topic} needs handling\nChange: ${v.tasks}\nPreserve: ${v.constraints}\nForm: ${v.output}`, `Before: ${v.setting}\nAfter: ${v.topic}\nChange: ${v.tasks}\nPreserve: ${v.constraints}\nOutput: ${v.output}`), { format: "before_after" }) },
  { id: "meeting_note", render: (v) => result(v.text(`회의 끝나기 전 남은 한 건: ${v.topic}. 배경 ${v.setting}. ${v.tasks}. 합의된 제한은 ${v.constraints}, 기록 형식은 ${v.output}.`, `One item remains before the meeting ends: ${v.topic}. Context: ${v.setting}. ${v.tasks}. Agreed limits: ${v.constraints}; record it as ${v.output}.`, `Meeting 마지막 item: ${v.topic}. Context=${v.setting}. ${v.tasks}. Limits=${v.constraints}; output=${v.output}.`), { format: "meeting_note" }) },
  { id: "mobile_chat", render: (v) => result(v.text(`나: ${v.topic} 지금 볼 수 있어?\n나: 상황은 ${v.setting}\n나: ${v.tasks}\n나: 필요한 결과=${v.output}`, `me: can you look at ${v.topic}?\nme: we're in ${v.setting}\nme: ${v.tasks}\nme: ${v.output} is enough`, `me: ${v.topic} 볼 수 있어?\nme: context=${v.setting}\nme: ${v.tasks}\nme: output=${v.output}`), { format: "mobile_chat", voice: "informal" }) },
  { id: "formal_policy", render: (v) => result(v.text(`검토 대상: ${v.topic}. 전제 상황: ${v.setting}. 요청 작업: ${v.tasks}. 적용 제약: ${v.constraints}. 산출 형식: ${v.output}.`, `The review is limited to ${v.topic}. Assuming ${v.setting}, ${v.tasks}. Applicable constraints are ${v.constraints}; the deliverable shall be ${v.output}.`, `Scope=${v.topic}. Given ${v.setting}, ${v.tasks}. Constraints=${v.constraints}; deliverable=${v.output}.`), { format: "formal_spec", voice: "formal" }) },
  { id: "ordered_steps", render: (v) => result(v.text(`${v.topic}\n1) ${v.sources} 확인\n2) ${v.tasks}\n3) ${v.constraints} 검증\n4) ${v.output} 제출`, `${v.topic}\n1) inspect ${v.sources}\n2) ${v.tasks}\n3) verify ${v.constraints}\n4) submit ${v.output}`, `${v.topic}\n1) ${v.sources} check\n2) ${v.tasks}\n3) verify ${v.constraints}\n4) ${v.output}`), { format: "ordered_list" }) },
  { id: "fragments", render: (v) => result(v.text(`${v.topic}. ${v.setting}. 필요한 것—${v.tasks}. 빠뜨리면 안 될 것—${v.constraints}. 답—${v.output}.`, `${v.topic}. ${v.setting}. Needed—${v.tasks}. Must retain—${v.constraints}. Answer—${v.output}.`, `${v.topic}. ${v.setting}. Need—${v.tasks}. Must keep—${v.constraints}. Output—${v.output}.`), { format: "fragments", voice: "terse" }) },
  { id: "rhetorical", render: (v) => result(v.text(`이 상황에서 정말 필요한 게 ${v.distractor}일까? 아니야. ${v.topic}에 관한 작업은 ${v.tasks}. 필요한 결과: ${v.output}.`, `Is ${v.distractor} really what this situation needs? No. For ${v.topic}, ${v.tasks}; ${v.output} is sufficient.`, `여기서 really 필요한 게 ${v.distractor}? No. ${v.topic}: ${v.tasks}; output=${v.output}.`), { tags: ["negation", "indirect_expression", "category_confusion"], voice: "rhetorical" }) },
  { id: "unordered_note", render: (v) => result(v.text(`${v.output} 필요. 참고로 ${v.constraints}. 대상은 ${v.topic}. ${v.tasks}. 배경은 마지막에 말하면 ${v.setting}.`, `Need ${v.output}. Also, ${v.constraints}. Target: ${v.topic}. ${v.tasks}. The background, mentioned last, is ${v.setting}.`, `Need ${v.output}. 참고=${v.constraints}. Target=${v.topic}. ${v.tasks}. Context(last)=${v.setting}.`), { format: "unordered", voice: "fragmented" }) },
  { id: "scope_first", render: (v) => result(v.text(`범위부터 적을게: ${v.scopes}. ${v.topic}에서 ${v.tasks}. 자료는 ${v.sources}, 조건은 ${v.constraints}.`, `Scope first: ${v.scopes}. For ${v.topic}, ${v.tasks}. Sources: ${v.sources}; limits: ${v.constraints}.`, `Scope first=${v.scopes}. ${v.topic}: ${v.tasks}. Sources=${v.sources}; limits=${v.constraints}.`), { voice: "scope_first" }) },
  { id: "term_and_noise", render: (v) => result(v.text(`${v.terminology}라는 내부 표현이 있고 메모에는 코드 번역 이야기도 섞여 있다. 그 말들은 배경일 뿐이다. ${v.topic}에서 ${v.tasks}; 최종 결과: ${v.output}.`, `The local term ${v.terminology} appears beside references to code translation. Those are only background. For ${v.topic}, ${v.tasks}; finish with ${v.output}.`, `Local term=${v.terminology}, note에는 code translation noise도 있음. Background only. ${v.topic}: ${v.tasks}; output=${v.output}.`), { tags: ["ood_terminology", "category_confusion"], voice: "clarifying" }) },
  { id: "polite_indirect", render: (v) => result(v.text(`${v.topic} 때문에 현장이 조금 막혀 있어요. ${v.setting}까지 고려한 ${v.output} 결과가 있으면 다음 교대가 훨씬 수월할 것 같습니다.`, `The team is blocked on ${v.topic}. Having ${v.output} that accounts for ${v.setting} would make the next handoff much easier.`, `Team이 ${v.topic}에서 blocked. ${v.setting}까지 반영한 ${v.output} 결과가 있으면 next handoff가 쉬울 듯해요.`), { tags: ["indirect_expression"], voice: "polite_indirect" }) },
];

function chooseLanguages(familyOrdinal) {
  const rotations = [
    ["ko", "en", "mixed", "ko", "en"],
    ["en", "mixed", "ko", "en", "ko"],
    ["mixed", "ko", "en", "ko", "en"],
  ];
  return rotations[familyOrdinal % rotations.length];
}

function chooseRendererIndex(scenario, familyOrdinal, variantIndex, categoryIndex) {
  if (variantIndex === 0 && scenario.structuralMode === "bounded" && scenario.localIndex % 4 === 0) {
    return renderers.findIndex((renderer) => renderer.id === "long_context");
  }
  if (variantIndex === 0 && scenario.structuralMode === "interlocked" && scenario.localIndex % 4 === 0) {
    return renderers.findIndex((renderer) => renderer.id === "ultra_compact");
  }
  return (familyOrdinal * 17 + variantIndex * 11 + categoryIndex * 7) % renderers.length;
}

function bucketForCount(value, thresholds) {
  if (value <= thresholds[0]) return thresholds[1];
  if (value <= thresholds[2]) return thresholds[3];
  return thresholds[4];
}

function annotateRenderedScenario(scenario, rendered, language) {
  const expectedDifficulty = complexWorkflows.has(scenario.workflow) ? "complex" : "simple";
  const slices = new Set(rendered.tags);
  slices.add(language === "ko" ? "korean" : language === "en" ? "english" : "mixed_language");
  const length = runeLength(rendered.prompt);
  if (expectedDifficulty === "complex" && length <= 120) slices.add("short_complex");
  if (expectedDifficulty === "simple" && length > 120) slices.add("long_simple");
  return {
    expectedDifficulty,
    taskBucket: bucketForCount(scenario.tasks.length, [1, "count_1", 2, "count_2", "count_3_plus"]),
    constraintBucket: bucketForCount(scenario.constraints.length, [1, "count_0_to_1", 2, "count_2", "count_3_plus"]),
    scopeBucket: bucketForCount(scenario.scopes.length, [1, "count_1", 3, "count_2_to_3", "count_4_plus"]),
    dependencyBucket: bucketForCount(scenario.dependencyDepth, [1, "depth_0_to_1", 2, "depth_2", "depth_3_plus"]),
    evaluationSlices: evaluationSlices.filter((slice) => slices.has(slice)),
  };
}

function opaqueSampleId(promptFamily, variantIndex) {
  return `ood2_${sha256(`${promptFamily}:${variantIndex}:${assignmentSeed}`).slice(0, 18)}`;
}

function buildCandidateEntries() {
  const entries = [];
  let familyOrdinal = 0;
  for (const [categoryIndex, category] of categories.entries()) {
    for (const structuralMode of ["bounded", "interlocked"]) {
      for (let localIndex = 0; localIndex < 100; localIndex += 1) {
        const scenario = makeScenario(category, structuralMode, localIndex);
        const semanticSlug = scenario.semanticLabel.replace(`${category}_`, "");
        const familyNumber = structuralMode === "bounded" ? localIndex + 1 : localIndex + 101;
        const promptFamily = `independent2.${category}.${semanticSlug}.scenario.f${String(familyNumber).padStart(3, "0")}`;
        const split = localIndex < 60 ? "train" : localIndex < 80 ? "validation" : "test";
        const languages = chooseLanguages(familyOrdinal);
        const usedRendererIndexes = new Set();
        for (let variantIndex = 0; variantIndex < 5; variantIndex += 1) {
          const language = languages[variantIndex];
          let rendererIndex = chooseRendererIndex(scenario, familyOrdinal, variantIndex, categoryIndex);
          while (usedRendererIndexes.has(rendererIndex)) rendererIndex = (rendererIndex + 1) % renderers.length;
          usedRendererIndexes.add(rendererIndex);
          const renderer = renderers[rendererIndex];
          const view = makeView(scenario, language);
          let rendered = renderer.render(view);
          if (sourceRequiredSemanticLabels.has(scenario.semanticLabel)) {
            rendered = attachRequiredSource(rendered, view, familyOrdinal + variantIndex + rendererIndex);
          }
          const annotation = annotateRenderedScenario(scenario, rendered, language);
          const record = {
            schemaVersion: "gatelm.difficulty-label-record.v2",
            datasetVersion,
            sampleId: opaqueSampleId(promptFamily, variantIndex),
            redactedPrompt: rendered.prompt,
            expectedCategory: category,
            expectedDifficulty: annotation.expectedDifficulty,
            semanticInputStatus: "eligible",
            taskBucket: annotation.taskBucket,
            constraintBucket: annotation.constraintBucket,
            scopeBucket: annotation.scopeBucket,
            dependencyBucket: annotation.dependencyBucket,
            expectedSemanticLabel: scenario.semanticLabel,
            promptFamily,
            language,
            expectedInstructionPayloadBoundary: rendered.boundary,
            evaluationSlices: annotation.evaluationSlices,
            labelSource: "synthetic_fixture",
            consentType: "synthetic",
            source: "synthetic_fixture",
            redactionVersion: "synthetic_no_customer_data_v1",
            createdAt,
            labelConfidence: rendered.tags.includes("category_confusion") || rendered.tags.includes("indirect_expression") ? 0.68 : 0.74,
            reviewStatus: "pending",
            reviewerCount: 0,
            reviewerNote: "Post-render provisional labels; two independent human reviews and adjudication remain pending.",
          };
          entries.push({
            record,
            meta: {
              rendererId: renderer.id,
              format: rendered.format,
              voice: rendered.voice,
              split,
              workflow: scenario.workflow,
              structuralMode,
            },
          });
        }
        familyOrdinal += 1;
      }
    }
  }
  return entries;
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

function countBy(values, selector) {
  return Object.fromEntries(
    [...groupBy(values, selector).entries()]
      .map(([key, grouped]) => [key, grouped.length])
      .sort(([left], [right]) => String(left).localeCompare(String(right))),
  );
}

function countFamilies(familyGroups, predicate) {
  return [...familyGroups.values()].filter((records) => records.some(predicate)).length;
}

function computeCoverage(familyGroups) {
  return {
    categoryFamilies: Object.fromEntries(
      categories.map((category) => [category, countFamilies(familyGroups, (record) => record.expectedCategory === category)]),
    ),
    difficultyFamilies: Object.fromEntries(
      ["simple", "complex"].map((difficulty) => [difficulty, countFamilies(familyGroups, (record) => record.expectedDifficulty === difficulty)]),
    ),
    categoryDifficultyFamilies: Object.fromEntries(
      categories.map((category) => [
        category,
        Object.fromEntries(
          ["simple", "complex"].map((difficulty) => [
            difficulty,
            countFamilies(
              familyGroups,
              (record) => record.expectedCategory === category && record.expectedDifficulty === difficulty,
            ),
          ]),
        ),
      ]),
    ),
    languageFamilies: Object.fromEntries(
      languageValues.map((language) => [language, countFamilies(familyGroups, (record) => record.language === language)]),
    ),
    evaluationSliceFamilies: Object.fromEntries(
      evaluationSlices.map((slice) => [slice, countFamilies(familyGroups, (record) => record.evaluationSlices.includes(slice))]),
    ),
  };
}

function buildManifest(entries, datasetText) {
  const records = entries.map((entry) => entry.record);
  const families = groupBy(records, (record) => record.promptFamily);
  const splitForFamily = new Map(entries.map((entry) => [entry.record.promptFamily, entry.meta.split]));
  return {
    schemaVersion: "gatelm.difficulty-label-dataset-manifest.v2",
    datasetVersion,
    recordSchemaVersion: "gatelm.difficulty-label-record.v2",
    datasetPath,
    datasetSha256: sha256(datasetText),
    datasetPurpose: "independent_dataset_candidate",
    trainingEligible: false,
    labelCoverageStatus: "complete",
    familyPolicyVersion,
    splitPolicyVersion: "difficulty-independent-ood-family-split.2026-07-18.v1",
    splitSeed,
    splitCounts: {
      train: { families: 600, records: 3000 },
      calibration: { families: 200, records: 1000 },
      holdout: { families: 200, records: 1000 },
    },
    trainingGate: { minimumFamilyPolicyStatus: "decision_required" },
    counts: {
      records: records.length,
      families: families.size,
      humanReviewedFamilies: 0,
      approvedHumanReviewedFamilies: 0,
      semanticHeadEligibleRecords: records.length,
      semanticHeadEligibleFamilies: families.size,
      emptyInstructionRecords: 0,
      emptyInstructionFamilies: 0,
    },
    coverage: computeCoverage(families),
    families: [...families.entries()].map(([promptFamily, rows]) => ({
      promptFamily,
      expectedCategory: rows[0].expectedCategory,
      expectedSemanticLabel: rows[0].expectedSemanticLabel,
      reviewStatus: "pending",
      humanReviewed: false,
      partition: splitForFamily.get(promptFamily) === "train"
        ? "train"
        : splitForFamily.get(promptFamily) === "validation"
          ? "calibration"
          : "holdout",
      records: rows.length,
    })).sort((left, right) => left.promptFamily.localeCompare(right.promptFamily)),
    createdAt,
  };
}

function deterministicShuffle(values, seed) {
  const copy = [...values];
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function buildBlindReviewText(records) {
  const blindRecords = deterministicShuffle(records, assignmentSeed).map((record) => ({
    schemaVersion: "gatelm.difficulty-blind-review-record.v1",
    datasetVersion,
    sampleId: record.sampleId,
    redactedPrompt: record.redactedPrompt,
    language: record.language,
  }));
  return `${blindRecords.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

function buildSplitTexts(entries) {
  return Object.fromEntries(Object.keys(splitPaths).map((split) => {
    const records = entries.filter((entry) => entry.meta.split === split).map((entry) => entry.record);
    return [split, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`];
  }));
}

function buildSplitManifest(entries, datasetText, blindReviewText, splitTexts) {
  const byFamily = groupBy(entries, (entry) => entry.record.promptFamily);
  const assignments = [...byFamily.entries()].map(([promptFamily, rows]) => ({
    promptFamily,
    split: rows[0].meta.split,
    records: rows.length,
  })).sort((left, right) => left.promptFamily.localeCompare(right.promptFamily));
  return {
    schemaVersion: "gatelm.difficulty-independent-dataset-split-manifest.v1",
    datasetVersion,
    masterDatasetPath: datasetPath,
    masterDatasetSha256: sha256(datasetText),
    blindReviewPath,
    blindReviewSha256: sha256(blindReviewText),
    splitPolicyVersion: "difficulty-independent-ood-family-split.2026-07-18.v1",
    splitSeed,
    assignmentUnit: "prompt_family",
    labelState: "labels_pending_human_review",
    trainingEligible: false,
    dataset1Isolation: {
      dataset1Path,
      usedAsGenerationInput: false,
      usedForPostGenerationOverlapAudit: true,
      sharedGeneratorModules: [],
      familyNamespace: "independent2",
    },
    standardManifestProjection: {
      train: "train",
      validation: "calibration",
      test: "holdout",
    },
    splits: {
      train: {
        datasetPath: splitPaths.train,
        datasetSha256: sha256(splitTexts.train),
        records: 3000,
        families: 600,
        purpose: "future_weight_fit_after_human_approval",
      },
      validation: {
        datasetPath: splitPaths.validation,
        datasetSha256: sha256(splitTexts.validation),
        records: 1000,
        families: 200,
        purpose: "future_model_selection_after_human_approval",
      },
      test: {
        datasetPath: splitPaths.test,
        datasetSha256: sha256(splitTexts.test),
        records: 1000,
        families: 200,
        purpose: "untouched_final_evaluation_after_human_approval",
      },
    },
    assignments,
    createdAt,
  };
}

function normalizePrompt(value) {
  return value.normalize("NFKC").toLocaleLowerCase("und").replace(/[\p{P}\p{S}\s]+/gu, "");
}

function wordFourGrams(value) {
  const tokens = value.normalize("NFKC").toLocaleLowerCase("und").match(/[\p{L}\p{N}_-]+/gu) ?? [];
  const grams = new Set();
  for (let index = 0; index <= tokens.length - 4; index += 1) {
    grams.add(tokens.slice(index, index + 4).join(" "));
  }
  return grams;
}

function jaccard(left, right) {
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function maxIndexedFourGramJaccard(leftRecords, rightRecords, options = {}) {
  const rightGrams = rightRecords.map((record) => wordFourGrams(record.redactedPrompt));
  const index = new Map();
  rightGrams.forEach((grams, recordIndex) => {
    for (const gram of grams) {
      if (!index.has(gram)) index.set(gram, []);
      index.get(gram).push(recordIndex);
    }
  });
  let maximum = 0;
  let comparison = null;
  let comparedPairs = 0;
  leftRecords.forEach((record) => {
    const left = wordFourGrams(record.redactedPrompt);
    const candidates = new Map();
    for (const gram of left) {
      const matches = index.get(gram) ?? [];
      if (matches.length > 80) continue;
      for (const recordIndex of matches) {
        candidates.set(recordIndex, (candidates.get(recordIndex) ?? 0) + 1);
      }
    }
    const strongest = [...candidates.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    for (const [recordIndex] of strongest) {
      const rightRecord = rightRecords[recordIndex];
      if (options.excludeSameFamily && rightRecord.promptFamily === record.promptFamily) continue;
      comparedPairs += 1;
      const score = jaccard(left, rightGrams[recordIndex]);
      if (score > maximum) {
        maximum = score;
        comparison = {
          leftSampleId: record.sampleId,
          rightSampleId: rightRecord.sampleId,
        };
      }
    }
  });
  return {
    method: "inverted-index word 4-gram Jaccard; grams occurring in more than 80 reference rows are ignored",
    comparedCandidatePairs: comparedPairs,
    maximum: Number(maximum.toFixed(6)),
    comparison,
  };
}

function percentile(values, quantile) {
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * quantile)));
  return sorted[index];
}

function lengthSummary(records) {
  const lengths = records.map((record) => runeLength(record.redactedPrompt));
  return {
    min: Math.min(...lengths),
    p10: percentile(lengths, 0.1),
    median: percentile(lengths, 0.5),
    p90: percentile(lengths, 0.9),
    max: Math.max(...lengths),
  };
}

function auditAgainstDataset1(entries, dataset1Text) {
  const records = entries.map((entry) => entry.record);
  const dataset1Records = dataset1Text.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  const promptSet = new Set(dataset1Records.map((record) => record.redactedPrompt));
  const normalizedSet = new Set(dataset1Records.map((record) => normalizePrompt(record.redactedPrompt)));
  const familySet = new Set(dataset1Records.map((record) => record.promptFamily));
  return {
    dataset1Path,
    dataset1Sha256: sha256(dataset1Text),
    dataset1Records: dataset1Records.length,
    usedAsGenerationInput: false,
    readPhase: "post_generation_overlap_audit_only",
    exactPromptOverlap: records.filter((record) => promptSet.has(record.redactedPrompt)).length,
    normalizedPromptOverlap: records.filter((record) => normalizedSet.has(normalizePrompt(record.redactedPrompt))).length,
    promptFamilyOverlap: new Set(records.filter((record) => familySet.has(record.promptFamily)).map((record) => record.promptFamily)).size,
    wordFourGramAudit: maxIndexedFourGramJaccard(records, dataset1Records),
  };
}

function buildDiversityReport(entries, datasetText, dataset1Audit) {
  const records = entries.map((entry) => entry.record);
  const families = groupBy(records, (record) => record.promptFamily);
  const exactPrompts = new Set(records.map((record) => record.redactedPrompt));
  const normalizedPrompts = new Set(records.map((record) => normalizePrompt(record.redactedPrompt)));
  const openingFingerprints = new Set(records.map((record) => {
    const tokens = record.redactedPrompt.normalize("NFKC").toLocaleLowerCase("und").match(/[\p{L}\p{N}_-]+/gu) ?? [];
    return tokens.slice(0, 5).join(" ");
  }));
  const allFourGrams = new Set(records.flatMap((record) => [...wordFourGrams(record.redactedPrompt)]));
  const categoryDifficulty = Object.fromEntries(categories.map((category) => [
    category,
    {
      simple: records.filter((record) => record.expectedCategory === category && record.expectedDifficulty === "simple").length,
      complex: records.filter((record) => record.expectedCategory === category && record.expectedDifficulty === "complex").length,
    },
  ]));
  const simpleRecords = records.filter((record) => record.expectedDifficulty === "simple");
  const complexRecords = records.filter((record) => record.expectedDifficulty === "complex");
  return {
    schemaVersion: "gatelm.difficulty-independent-ood-diversity-report.v1",
    datasetVersion,
    datasetPath,
    datasetSha256: sha256(datasetText),
    generatorPath: "scripts/dev/generate-v2.1-difficulty-independent-ood-5000.mjs",
    generationBoundary: {
      promptRenderedBeforeAnnotation: true,
      expectedDifficultyPassedToRenderer: false,
      structuralFactsUsedForPostRenderAnnotation: ["tasks", "constraints", "scopes", "sources", "dependencyDepth", "workflow"],
      humanReviewRequired: true,
      labelSource: "synthetic_fixture",
      reviewStatus: "pending",
    },
    counts: {
      records: records.length,
      families: families.size,
      recordsPerFamily: 5,
      exactUniquePrompts: exactPrompts.size,
      normalizedUniquePrompts: normalizedPrompts.size,
      distinctOpeningFiveTokenFingerprints: openingFingerprints.size,
      distinctWordFourGrams: allFourGrams.size,
    },
    coverage: {
      categoryDifficultyRecords: categoryDifficulty,
      languageRecords: countBy(records, (record) => record.language),
      splitRecords: countBy(entries, (entry) => entry.meta.split),
      splitFamilies: Object.fromEntries(["train", "validation", "test"].map((split) => [
        split,
        new Set(entries.filter((entry) => entry.meta.split === split).map((entry) => entry.record.promptFamily)).size,
      ])),
      evaluationSliceRecords: Object.fromEntries(
        evaluationSlices.map((slice) => [slice, records.filter((record) => record.evaluationSlices.includes(slice)).length]),
      ),
      rendererUsage: countBy(entries, (entry) => entry.meta.rendererId),
      formatUsage: countBy(entries, (entry) => entry.meta.format),
      voiceUsage: countBy(entries, (entry) => entry.meta.voice),
      workflowUsage: countBy(entries, (entry) => entry.meta.workflow),
      taskBucketRecords: countBy(records, (record) => record.taskBucket),
      constraintBucketRecords: countBy(records, (record) => record.constraintBucket),
      scopeBucketRecords: countBy(records, (record) => record.scopeBucket),
      dependencyBucketRecords: countBy(records, (record) => record.dependencyBucket),
    },
    lengthCounterfactuals: {
      simple: lengthSummary(simpleRecords),
      complex: lengthSummary(complexRecords),
      longSimpleRecords: simpleRecords.filter((record) => record.evaluationSlices.includes("long_simple")).length,
      shortComplexRecords: complexRecords.filter((record) => record.evaluationSlices.includes("short_complex")).length,
      distributionsOverlap: Math.min(...complexRecords.map((record) => runeLength(record.redactedPrompt))) <=
        Math.max(...simpleRecords.map((record) => runeLength(record.redactedPrompt))),
    },
    withinDatasetOverlap: {
      exactDuplicateRecords: records.length - exactPrompts.size,
      normalizedDuplicateRecords: records.length - normalizedPrompts.size,
      crossFamilyWordFourGramAudit: maxIndexedFourGramJaccard(records, records, { excludeSameFamily: true }),
    },
    dataset1Comparison: dataset1Audit,
    createdAt,
  };
}

function assertDataset(entries, manifest, splitManifest, splitTexts, diversityReport, blindReviewText) {
  const records = entries.map((entry) => entry.record);
  const failures = [
    ...verifyDifficultyLabelRecords(records, { rootDir }),
    ...verifyDifficultyLabelDatasetManifest(manifest, { rootDir, manifestPath }),
  ];
  if (failures.length > 0) throw new Error(`canonical validation failed:\n${failures.join("\n")}`);
  const families = groupBy(entries, (entry) => entry.record.promptFamily);
  if (records.length !== 5000 || families.size !== 1000) throw new Error("expected exactly 5,000 records and 1,000 families");
  if ([...families.values()].some((rows) => rows.length !== 5)) throw new Error("every family must contain exactly five records");
  if (new Set(records.map((record) => record.sampleId)).size !== records.length) throw new Error("sampleId values must be unique");
  if (new Set(records.map((record) => record.redactedPrompt)).size !== records.length) {
    const duplicates = [...groupBy(entries, (entry) => entry.record.redactedPrompt).values()]
      .filter((rows) => rows.length > 1)
      .slice(0, 5)
      .map((rows) => rows.map((entry) => `${entry.record.sampleId}:${entry.record.promptFamily}:${entry.record.language}:${entry.meta.rendererId}`).join(", "));
    throw new Error(`exact prompt duplicates are forbidden: ${duplicates.join("; ")}`);
  }
  if (new Set(records.map((record) => normalizePrompt(record.redactedPrompt))).size !== records.length) throw new Error("normalized prompt duplicates are forbidden");
  for (const rows of families.values()) {
    if (new Set(rows.map((entry) => entry.record.expectedCategory)).size !== 1) throw new Error("family crossed category");
    if (new Set(rows.map((entry) => entry.record.expectedSemanticLabel)).size !== 1) throw new Error("family crossed semantic label");
    if (new Set(rows.map((entry) => entry.meta.split)).size !== 1) throw new Error("family crossed dataset split");
  }
  for (const category of categories) {
    for (const difficulty of ["simple", "complex"]) {
      const count = records.filter((record) => record.expectedCategory === category && record.expectedDifficulty === difficulty).length;
      if (count !== 500) throw new Error(`${category}/${difficulty}: expected 500 records, got ${count}`);
    }
  }
  const expectedSplits = {
    train: { records: 3000, families: 600, recordsPerCategoryDifficulty: 300 },
    validation: { records: 1000, families: 200, recordsPerCategoryDifficulty: 100 },
    test: { records: 1000, families: 200, recordsPerCategoryDifficulty: 100 },
  };
  const splitSampleIds = new Set();
  for (const [split, expected] of Object.entries(expectedSplits)) {
    const splitEntries = entries.filter((entry) => entry.meta.split === split);
    const splitFamilies = new Set(splitEntries.map((entry) => entry.record.promptFamily));
    if (splitEntries.length !== expected.records || splitFamilies.size !== expected.families) {
      throw new Error(`${split}: expected ${expected.records} records/${expected.families} families`);
    }
    const parsedSplitRecords = splitTexts[split].trim().split("\n").map((line) => JSON.parse(line));
    if (parsedSplitRecords.length !== expected.records) throw new Error(`${split}: JSONL record count mismatch`);
    for (const record of parsedSplitRecords) {
      if (splitSampleIds.has(record.sampleId)) throw new Error(`${split}: sample crossed split boundary`);
      splitSampleIds.add(record.sampleId);
    }
    for (const category of categories) {
      for (const difficulty of ["simple", "complex"]) {
        const count = splitEntries.filter(
          (entry) => entry.record.expectedCategory === category && entry.record.expectedDifficulty === difficulty,
        ).length;
        if (count !== expected.recordsPerCategoryDifficulty) {
          throw new Error(`${split}/${category}/${difficulty}: expected ${expected.recordsPerCategoryDifficulty}, got ${count}`);
        }
      }
    }
    const manifestSplit = splitManifest.splits[split];
    if (
      manifestSplit.records !== expected.records ||
      manifestSplit.families !== expected.families ||
      manifestSplit.datasetPath !== splitPaths[split] ||
      manifestSplit.datasetSha256 !== sha256(splitTexts[split])
    ) {
      throw new Error(`${split}: split manifest mismatch`);
    }
  }
  if (splitSampleIds.size !== records.length || records.some((record) => !splitSampleIds.has(record.sampleId))) {
    throw new Error("split union must exactly equal the 5,000-record master dataset");
  }
  if (splitManifest.assignments.length !== 1000 || new Set(splitManifest.assignments.map((item) => item.promptFamily)).size !== 1000) {
    throw new Error("split assignments must freeze 1,000 unique families");
  }
  const blindRows = blindReviewText.trim().split("\n").map((line) => JSON.parse(line));
  const blindKeys = ["schemaVersion", "datasetVersion", "sampleId", "redactedPrompt", "language"];
  if (blindRows.length !== 5000 || blindRows.some((row) => JSON.stringify(Object.keys(row)) !== JSON.stringify(blindKeys))) {
    throw new Error("blind review queue must contain only the five non-label fields for all records");
  }
  if (manifest.trainingEligible || records.some((record) => record.reviewStatus !== "pending" || record.reviewerCount !== 0)) {
    throw new Error("candidate must remain pending and non-training-eligible");
  }
  if (diversityReport.counts.distinctOpeningFiveTokenFingerprints < 600) {
    throw new Error("opening fingerprint diversity is below 600");
  }
  if (Object.keys(diversityReport.coverage.rendererUsage).length !== renderers.length || renderers.length < 40) {
    throw new Error("all forty independent renderers must be exercised");
  }
  if (diversityReport.lengthCounterfactuals.longSimpleRecords < 300 || diversityReport.lengthCounterfactuals.shortComplexRecords < 100) {
    throw new Error(
      `length counterfactual coverage is insufficient: long-simple=${diversityReport.lengthCounterfactuals.longSimpleRecords}, ` +
        `short-complex=${diversityReport.lengthCounterfactuals.shortComplexRecords}`,
    );
  }
  if (
    diversityReport.dataset1Comparison.exactPromptOverlap !== 0 ||
    diversityReport.dataset1Comparison.normalizedPromptOverlap !== 0 ||
    diversityReport.dataset1Comparison.promptFamilyOverlap !== 0
  ) {
    throw new Error("Dataset 1 overlap gate failed");
  }
  if (diversityReport.dataset1Comparison.wordFourGramAudit.maximum >= 0.8) {
    throw new Error("Dataset 1 near-duplicate gate failed");
  }
  if (diversityReport.withinDatasetOverlap.crossFamilyWordFourGramAudit.maximum >= 0.8) {
    throw new Error("Dataset 2 cross-family near-duplicate gate failed");
  }
}

export function buildIndependentDatasetArtifacts(options = {}) {
  // Generation is deliberately completed before Dataset 1 is read. Dataset 1 is audit-only input.
  const entries = buildCandidateEntries();
  const records = entries.map((entry) => entry.record);
  const datasetText = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const splitTexts = buildSplitTexts(entries);
  const blindReviewText = buildBlindReviewText(records);
  const dataset1Text = options.dataset1Text ?? readFileSync(path.join(rootDir, dataset1Path), "utf8");
  const dataset1Audit = auditAgainstDataset1(entries, dataset1Text);
  const manifest = buildManifest(entries, datasetText);
  const splitManifest = buildSplitManifest(entries, datasetText, blindReviewText, splitTexts);
  const diversityReport = buildDiversityReport(entries, datasetText, dataset1Audit);
  assertDataset(entries, manifest, splitManifest, splitTexts, diversityReport, blindReviewText);
  return {
    entries,
    records,
    artifacts: {
      [datasetPath]: datasetText,
      [manifestPath]: `${JSON.stringify(manifest, null, 2)}\n`,
      [splitPaths.train]: splitTexts.train,
      [splitPaths.validation]: splitTexts.validation,
      [splitPaths.test]: splitTexts.test,
      [splitManifestPath]: `${JSON.stringify(splitManifest, null, 2)}\n`,
      [diversityReportPath]: `${JSON.stringify(diversityReport, null, 2)}\n`,
      [blindReviewPath]: blindReviewText,
    },
    manifest,
    splitManifest,
    splitTexts,
    diversityReport,
  };
}

function writeArtifacts(artifacts, checkOnly) {
  const drift = [];
  for (const [relativePath, content] of Object.entries(artifacts)) {
    const absolutePath = path.join(rootDir, relativePath);
    if (checkOnly) {
      if (!existsSync(absolutePath) || readFileSync(absolutePath, "utf8") !== content) drift.push(relativePath);
      continue;
    }
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }
  if (drift.length > 0) throw new Error(`generated artifact drift:\n${drift.join("\n")}`);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const { artifacts, diversityReport } = buildIndependentDatasetArtifacts();
  writeArtifacts(artifacts, checkOnly);
  console.log(
    `${checkOnly ? "verified" : "generated"} Dataset 2: 5,000 records, 1,000 families, ` +
      `train/validation/test=3,000/1,000/1,000, ` +
      `${Object.keys(diversityReport.coverage.rendererUsage).length} renderers, ` +
      `${diversityReport.lengthCounterfactuals.longSimpleRecords} long-simple, ` +
      `${diversityReport.lengthCounterfactuals.shortComplexRecords} short-complex`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
