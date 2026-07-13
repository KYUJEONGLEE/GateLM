import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const outputPath = path.resolve(
  "docs/v2.1.0/fixtures/category-evaluation-challenge.fixture.jsonl",
);

const datasetVersion = "category_eval_2026_07_13_ko_1000_challenge_category_only";
const createdAt = "2026-07-03T00:00:00Z";

const targets = [
  ["general", 190],
  ["code", 150],
  ["translation", 120],
  ["summarization", 130],
  ["structured_output", 120],
  ["customer_support", 110],
  ["reasoning", 150],
  ["unclassified", 30],
];

const subjects = {
  general: [
    "환불 문서",
    "번역 옵션",
    "코드 입력 화면",
    "결제 도움말",
    "비교 리포트",
    "JSON 다운로드",
    "요약 위젯",
    "모델 선택 메뉴",
    "대시보드 필터",
    "팀 설정",
  ],
  code: [
    "세션 갱신 부분",
    "요청 본문 조립부",
    "응답 변환 계층",
    "캐시 조회 순서",
    "배치 처리 루틴",
    "권한 확인 흐름",
    "스냅샷 반영 구간",
    "로그 적재 경로",
    "모델 선택 함수",
    "상태 동기화 부분",
  ],
  translation: [
    "온보딩 안내",
    "요금제 변경 안내",
    "장애 공지",
    "권한 요청 안내",
    "초대 메일",
    "사용량 초과 알림",
    "환영 메시지",
    "점검 공지",
    "실패 안내",
    "고객 응대 문장",
  ],
  summarization: [
    "긴 장애 회고",
    "여러 명의 리뷰 의견",
    "운영 회의 기록",
    "사용자 인터뷰 메모",
    "릴리즈 준비 메모",
    "성능 측정 노트",
    "정책 논의 기록",
    "고객 응대 모음",
    "기획 초안",
    "멘토 코멘트",
  ],
  structured_output: [
    "지원 요청",
    "정산 메일",
    "배포 점검표",
    "오류 접수 내용",
    "회의 할 일 목록",
    "고객 설문",
    "청구 내역",
    "작업 요청서",
    "검토 의견",
    "운영 체크리스트",
  ],
  customer_support: [
    "배송 누락",
    "부분 반품",
    "구독 종료",
    "이중 청구",
    "쿠폰 적용 실패",
    "결제 취소 요청",
    "상품 회수",
    "배송비 환급",
    "서비스 미사용",
    "주문 철회",
  ],
  reasoning: [
    "빠른 응답과 낮은 비용",
    "정확도와 개발 속도",
    "운영 안정성과 데모 임팩트",
    "단순 룰과 복합 점수",
    "캐시 우선과 최신성",
    "저렴한 모델과 균형 모델",
    "문서화와 즉시 구현",
    "자동화와 사람 검토",
    "세밀한 정책과 쉬운 운영",
    "릴리즈 일정과 품질 기준",
  ],
  unclassified: ["unclassifiable synthetic input"],
};

const templates = {
  general: [
    "{subject}는 어느 메뉴에서 찾는 게 맞아?",
    "{subject} 관련 화면 이름이 헷갈려. 위치만 알려줘.",
    "{subject}을 담당자에게 보여주려면 어디로 들어가?",
    "{subject} 설정이 보이지 않는다는 문의에 경로만 알려줘.",
    "{subject} 문서가 최신인지 확인하는 위치가 궁금해.",
    "{subject} 버튼이 없는 것처럼 보일 때 확인할 곳은?",
    "{subject}에 대해 자주 묻는 질문 페이지가 있어?",
    "{subject} 항목을 숨기거나 표시하는 설정 위치 알려줘.",
    "{subject} 안내 링크만 짧게 알려줘.",
    "{subject} 관련해서 사용자가 어디를 눌러야 하는지 알려줘.",
  ],
  code: [
    "{subject}이 특정 상황에서만 멈춰. 재현 조건을 어떻게 좁혀?",
    "{subject}이 값을 두 번 넘기는 것 같아. 원인 후보를 잡아줘.",
    "{subject}의 책임 경계가 애매해서 나중에 고치기 어려워 보여.",
    "{subject}에서 빈 값이 들어오면 흐름이 이상해지는 듯해.",
    "{subject}이 순서에 따라 결과가 달라지는 것 같아.",
    "{subject}을 작게 나누려면 어떤 기준으로 파일을 분리해?",
    "{subject} 쪽에서 느려지는 지점을 찾고 싶어.",
    "{subject}이 테스트 환경에서는 괜찮고 로컬 요청에서만 이상해.",
    "{subject}을 바꾼 뒤 다른 경로가 같이 깨질 가능성을 봐줘.",
    "{subject}에서 예외 처리를 어디까지 올리는 게 맞아?",
  ],
  translation: [
    "{subject}를 해외 파트너에게 보내도 자연스럽게 고쳐줘.",
    "{subject}를 한국 사용자에게 부드럽게 읽히도록 다듬어줘.",
    "{subject}의 말투를 영어권 고객에게 맞춰 바꿔줘.",
    "{subject}를 일본 고객용 공지 느낌으로 손봐줘.",
    "{subject}를 중국어 사용자에게 어색하지 않게 바꿔줘.",
    "{subject}의 직역 느낌을 줄이고 제품 톤으로 바꿔줘.",
    "{subject}를 딱딱하지 않은 글로벌 안내문처럼 바꿔줘.",
    "{subject}를 외국 지사에 보낼 문장으로 정돈해줘.",
    "{subject}를 영어 메일 첫 문단으로 어색하지 않게 고쳐줘.",
    "{subject}를 국내 고객이 이해하기 쉬운 표현으로 바꿔줘.",
  ],
  summarization: [
    "{subject}에서 긴 배경은 빼고 결론만 남겨줘.",
    "{subject}를 읽을 시간이 없어서 핵심 흐름만 짚어줘.",
    "{subject}를 팀 공유용 짧은 메모로 줄여줘.",
    "{subject}에서 반복되는 의견을 묶어서 짧게 만들어줘.",
    "{subject}를 발표 전에 볼 수 있게 한 화면 분량으로 압축해줘.",
    "{subject}에서 결정된 것과 보류된 것만 남겨줘.",
    "{subject}를 처음 보는 사람이 빠르게 파악하도록 줄여줘.",
    "{subject}에서 말이 길어진 부분은 덜어내고 요지만 남겨줘.",
    "{subject}를 회의 시작 전에 읽을 수 있는 길이로 줄여줘.",
    "{subject}의 핵심 주장만 남기고 나머지는 걷어내줘.",
  ],
  structured_output: [
    "{subject}에서 이름, 상태, 날짜만 칸으로 나눠줘.",
    "{subject}를 입력 폼에 옮기기 좋게 항목과 값으로 나눠줘.",
    "{subject}에서 금액과 사유와 처리 상태만 뽑아줘.",
    "{subject}를 스프레드시트에 붙이기 좋게 열 이름을 붙여줘.",
    "{subject}에서 빈 정보는 빈 값으로 두고 필요한 칸만 만들어줘.",
    "{subject}를 등록 화면 필드에 맞게 쪼개줘.",
    "{subject}에서 담당 부서와 처리 기한을 따로 빼줘.",
    "{subject}를 사람이 읽는 글 말고 시스템 입력 형태로 바꿔줘.",
    "{subject}에서 번호, 제목, 상태만 따로 정리해줘.",
    "{subject}를 체크리스트 열로 바꿔서 보여줘.",
  ],
  customer_support: [
    "{subject} 때문에 고객이 낸 돈을 돌려받을 수 있는지 물었어.",
    "{subject} 후 청구가 남아 있다는 문의에 답해야 해.",
    "{subject} 상태에서 주문을 취소한 것처럼 처리할 수 있어?",
    "{subject} 때문에 결제 금액이 맞지 않다는 고객 응대가 필요해.",
    "{subject} 이후 배송비까지 다시 받을 수 있는지 묻고 있어.",
    "{subject} 건은 교환으로 처리할지 돈을 돌려줄지 안내해야 해.",
    "{subject} 관련해서 이미 빠져나간 금액을 어떻게 안내하지?",
    "{subject} 문의에 대해 짧은 고객 답변을 만들어줘.",
    "{subject} 이후 사용하지 않았는데 비용이 나갔다고 해.",
    "{subject}를 취소하면 다음 청구가 멈추는지 물어봤어.",
  ],
  reasoning: [
    "{subject} 중 어느 쪽이 지금 상황에 더 맞는지 기준을 잡아줘.",
    "{subject}를 놓고 팀이 갈렸는데 판단 순서를 세워줘.",
    "{subject}의 손해와 이득을 같이 보고 결론을 내줘.",
    "{subject}에서 단기적으로는 뭐가 낫고 장기적으로는 뭐가 위험해?",
    "{subject} 중 하나를 포기해야 하면 무엇을 남겨야 해?",
    "{subject}를 선택하기 전에 확인해야 할 리스크를 정리해줘.",
    "{subject}의 선택지가 둘 다 애매해. 결정을 도와줘.",
    "{subject} 중 비용 대비 효과가 더 나은 쪽을 골라줘.",
    "{subject}를 오늘 결정해야 한다면 어떤 순서로 생각해야 해?",
    "{subject}의 절충안을 만들 수 있는지 판단해줘.",
  ],
  unclassified: [
    "...",
    "???",
    "////",
    "___",
    "[MASKED]",
    "[전부 마스킹됨]",
    "[REDACTED]",
    "-----",
  ],
};

function fill(template, category, index) {
  const subjectList = subjects[category] ?? subjects.general;
  const subject = subjectList[index % subjectList.length];
  const suffix = category === "unclassified" ? "" : ` 챌린지 ${String(index + 1).padStart(4, "0")}.`;
  return template.replaceAll("{subject}", subject) + suffix;
}

function record(category, index) {
  const templateList = templates[category];
  const template = templateList[index % templateList.length];
  const expectedCategory = ["structured_output", "customer_support", "unclassified"].includes(category)
    ? "general"
    : category;
  return {
    schemaVersion: "gatelm.category-evaluation-record.v2",
    datasetVersion,
    sampleId: `challenge_${category}_${String(index + 1).padStart(4, "0")}`,
    redactedPrompt: fill(template, category, index),
    expectedCategory,
    labelSource: "synthetic_fixture",
    consentType: "synthetic",
    source: "synthetic_fixture",
    language: category === "unclassified" ? "unknown" : "ko",
    redactionVersion: "rule_based_redaction_v1",
    createdAt,
    labelConfidence: category === "unclassified" ? 0.95 : 0.82,
    reviewerNote: "Synthetic challenge routing sample with ambiguous wording.",
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
