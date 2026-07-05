import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const outputPath = path.resolve(
  "docs/drafts/gateway-v2.1.0/fixtures/category-evaluation-ambiguous.fixture.jsonl",
);

const datasetVersion = "category_eval_2026_07_03_ko_1000_ambiguous_synthetic";
const createdAt = "2026-07-03T00:00:00Z";

const targets = [
  ["general", 200],
  ["code", 140],
  ["translation", 120],
  ["summarization", 130],
  ["extraction_json", 120],
  ["support_refund", 100],
  ["reasoning", 150],
  ["unknown", 40],
];

const tierByCategory = {
  general: "low_cost",
  code: "high_quality",
  translation: "balanced",
  summarization: "balanced",
  extraction_json: "balanced",
  support_refund: "low_cost",
  reasoning: "high_quality",
  unknown: "balanced",
};

const templates = {
  general: [
    "{subject} 화면에서 {object} 위치만 알려줘.",
    "{subject} 설정 메뉴가 어디 있는지 찾고 있어.",
    "{object} 기능을 켜는 위치를 안내해줘.",
    "{subject} 문서 링크를 담당자에게 공유할 수 있게 알려줘.",
    "{object} 탭 이름이 헷갈리는데 어디서 확인하지?",
    "{subject} 정책 문서가 최신인지 확인하는 방법 알려줘.",
    "{object} 버튼이 안 보인다는 사용자에게 어디를 보라고 하면 돼?",
    "{subject} 관련 자주 묻는 질문을 어디서 볼 수 있어?",
    "{object} 내보내기 메뉴 위치만 알려줘.",
    "{subject} 안내 페이지로 가는 경로를 알려줘.",
  ],
  code: [
    "{module}에서 특정 입력일 때만 결과가 이상해. 어디부터 봐야 할까?",
    "{module} 변경 후 테스트는 통과하는데 실제 요청에서만 깨져.",
    "{module} 책임이 너무 넓어 보여. 더 나누는 기준을 잡아줘.",
    "{module}에서 nil 비슷한 값 때문에 흐름이 끊기는 것 같아.",
    "{module} 응답 타입이 계속 흔들리는데 안전하게 잡는 방법은?",
    "{module} 처리 순서 때문에 race처럼 보이는 문제가 있어.",
    "{module} 쿼리가 느린데 조건을 어떻게 좁히면 좋을까?",
    "{module}의 fallback 흐름이 너무 꼬였어. 단순화 방향을 봐줘.",
    "{module} 테스트가 가끔만 실패해. 의심 지점을 정리해줘.",
    "{module} adapter가 기대한 값과 다른 값을 넘기는 것 같아.",
  ],
  translation: [
    "{subject} 문장을 해외 고객에게 보내도 어색하지 않게 바꿔줘.",
    "{subject} 안내를 영문 톤으로 자연스럽게 다듬어줘.",
    "{subject} 문구를 일본 고객에게 맞게 현지화해줘.",
    "{subject} 내용을 한국 고객이 읽기 편한 표현으로 바꿔줘.",
    "{subject} 알림을 직역 말고 제품 문맥에 맞게 바꿔줘.",
    "{subject} 문장을 외국 고객에게 보낼 수 있게 정리해줘.",
    "{subject} 실패 안내를 고객에게 보낼 영어 문구로 바꿔줘.",
    "{subject} 버튼 문구를 비즈니스 영어 느낌으로 바꿔줘.",
    "{subject} 공지를 중국어 사용자도 이해할 수 있게 바꿔줘.",
    "{subject} 메시지를 딱딱하지 않은 영문 문구로 바꿔줘.",
  ],
  summarization: [
    "긴 {subject}를 처음 보는 사람이 이해할 수 있게 줄여줘.",
    "{subject} 내용을 발표 한 장에 들어갈 정도로 압축해줘.",
    "{subject}에서 결정사항과 남은 이슈만 짧게 정리해줘.",
    "{subject}를 회의 전에 빠르게 볼 수 있게 핵심만 뽑아줘.",
    "{subject} 내용이 길어. 팀 공유용으로 짧게 설명해줘.",
    "{subject}에서 반복되는 말은 빼고 핵심 흐름만 남겨줘.",
    "{subject}를 읽지 않은 사람도 알 수 있게 간단히 정리해줘.",
    "{subject}를 3분 발표용 메모로 줄여줘.",
    "{subject}에서 우리가 결정한 것만 추려줘.",
    "{subject} 전체 내용을 슬랙 공유용으로 압축해줘.",
  ],
  extraction_json: [
    "{subject}에서 담당자, 상태, 다음 액션만 열로 나눠줘.",
    "{subject} 내용을 시스템 입력용 필드와 값으로 분리해줘.",
    "{subject}를 엑셀에 붙이기 쉽게 항목별로 나눠줘.",
    "{subject}에서 빠진 값은 null로 두고 표 형태로 만들어줘.",
    "{subject}에서 요청자, 마감일, 우선순위만 뽑아줘.",
    "{subject} 내용을 API 응답 예시처럼 구조화해줘.",
    "{subject}를 CSV에 넣을 수 있게 열 이름과 값으로 정리해줘.",
    "{subject}에서 금액, 상태, 사유를 각각 분리해줘.",
    "{subject}를 검토 체크리스트 필드로 바꿔줘.",
    "{subject}에서 필요한 값만 뽑아서 등록 양식에 넣기 쉽게 만들어줘.",
  ],
  support_refund: [
    "고객이 {subject} 때문에 돈이 다시 들어오는지 물어봤어.",
    "{subject} 후 비용이 청구됐다는 문의에 답해야 해.",
    "{subject}를 없던 일로 하고 싶다는 요청이 들어왔어.",
    "{subject} 때문에 결제 내역이 이상하다는 고객 문의야.",
    "고객이 {subject} 후 돌려받을 수 있는지 묻고 있어.",
    "{subject} 상황에서 교환이나 반품이 가능한지 알려줘.",
    "{subject} 관련 청구를 취소할 수 있는지 답변해줘.",
    "{subject} 이후 배송비까지 돌려받는지 문의가 왔어.",
    "{subject} 상태인데 돈이 빠져나갔다고 해.",
    "{subject}에 대해 고객에게 짧게 안내할 답변을 써줘.",
  ],
  reasoning: [
    "{subject} 둘 다 장점이 있어 보여. 어떤 기준으로 고르면 좋을까?",
    "{subject} 중 지금은 무엇을 버리고 무엇을 남겨야 할까?",
    "{subject}를 선택하면 생기는 리스크와 이득을 비교해줘.",
    "{subject} 사이에서 빠른 출시와 안정성 중 어디에 무게를 둬야 해?",
    "{subject} 방향이 맞는지 판단 기준부터 잡아줘.",
    "{subject}를 지금 할지 나중에 할지 결정해야 해.",
    "{subject} 중 비용을 줄이면서 품질을 덜 잃는 선택은?",
    "{subject}를 두고 팀 의견이 갈려. 결정 순서를 세워줘.",
    "{subject}의 장단점이 섞여 있어서 고민돼. 추천해줘.",
    "{subject} 중 하나만 남겨야 한다면 무엇이 더 타당해?",
  ],
  unknown: [
    "",
    "   ",
    "????",
    "........",
    "[REDACTED]",
    "[전부 마스킹됨]",
    "//// ////",
    "___ ___",
    "...?",
    "[MASKED]",
  ],
};

const subjects = {
  general: [
    "환불 정책",
    "번역 메뉴",
    "버그 리포트",
    "JSON 내보내기",
    "요약 탭",
    "비교 차트",
    "코드 입력란",
    "결제 설정",
    "모델 변경",
    "대시보드",
  ],
  code: [
    "런타임 스냅샷 로더",
    "게이트웨이 라우팅 스테이지",
    "정책 배포 API",
    "요청 로그 저장기",
    "Provider adapter",
    "캐시 키 생성기",
    "Budget checker",
    "프론트 BFF 호출부",
    "DB migration runner",
    "권한 middleware",
  ],
  translation: [
    "결제 실패",
    "권한 부족",
    "요청 실패",
    "배포 지연",
    "캐시 만료",
    "정책 변경",
    "모델 점검",
    "가입 환영",
    "사용량 초과",
    "고객 안내",
  ],
  summarization: [
    "장애 대응 기록",
    "멘토 피드백",
    "PR 리뷰",
    "정책 변경 회의록",
    "고객 문의 묶음",
    "운영 가이드",
    "기획 문서",
    "성능 테스트 결과",
    "릴리즈 노트",
    "회의 메모",
  ],
  extraction_json: [
    "장애 티켓",
    "고객 문의",
    "배포 체크리스트",
    "요청 로그",
    "회의 메모",
    "정산 요청",
    "지원 티켓",
    "정책 변경 기록",
    "검토 메모",
    "업무 요청",
  ],
  support_refund: [
    "주문 취소",
    "배송 지연",
    "구독 해지",
    "상품 반품",
    "중복 결제",
    "결제 오류",
    "배송비 청구",
    "쿠폰 미적용",
    "부분 취소",
    "교환 요청",
  ],
  reasoning: [
    "저비용 모델과 균형 모델",
    "캐시 우선 전략과 실시간 호출",
    "룰 기반 라우팅과 모델 기반 라우팅",
    "빠른 출시와 안정성",
    "정확도와 레이턴시",
    "동기 처리와 비동기 처리",
    "간단한 정책과 세밀한 정책",
    "Provider fallback과 요청 실패",
    "문서 보강과 코드 보강",
    "데모 완성도와 운영 안정성",
  ],
  unknown: [""],
};

const objects = [
  "설정",
  "메뉴",
  "버튼",
  "문서",
  "탭",
  "목록",
  "필터",
  "권한",
  "알림",
  "상태",
];

function fill(template, category, index) {
  const subjectList = subjects[category] ?? subjects.general;
  const subject = subjectList[index % subjectList.length];
  const object = objects[(index * 7) % objects.length];
  const suffix = category === "unknown" ? "" : ` 샘플 ${String(index + 1).padStart(4, "0")}.`;
  return template
    .replaceAll("{subject}", subject)
    .replaceAll("{module}", subject)
    .replaceAll("{object}", object) + suffix;
}

function record(category, index) {
  const templateList = templates[category];
  const template = templateList[index % templateList.length];
  const redactedPrompt = fill(template, category, index);
  return {
    schemaVersion: "gatelm.category-evaluation-record.v1",
    datasetVersion,
    sampleId: `ambiguous_${category}_${String(index + 1).padStart(4, "0")}`,
    redactedPrompt,
    expectedCategory: category,
    expectedTier: tierByCategory[category],
    labelSource: "synthetic_fixture",
    consentType: "synthetic",
    source: "synthetic_fixture",
    language: category === "unknown" ? "unknown" : "ko",
    redactionVersion: "rule_based_redaction_v1",
    createdAt,
    labelConfidence: category === "unknown" ? 0.95 : 0.86,
    reviewerNote: "Ambiguous synthetic routing stress sample.",
  };
}

const records = [];
for (const [category, count] of targets) {
  for (let index = 0; index < count; index++) {
    records.push(record(category, index));
  }
}

if (records.length !== 1000) {
  throw new Error(`expected 1000 records, got ${records.length}`);
}

mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, records.map((item) => JSON.stringify(item)).join("\n") + "\n", "utf8");
console.log(`wrote ${records.length} records to ${outputPath}`);
