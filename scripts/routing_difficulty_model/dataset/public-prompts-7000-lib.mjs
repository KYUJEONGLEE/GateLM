import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  characterLength,
  lengthBucket,
  lengthLabelDistribution,
  lengthOnlyRocAuc,
  validateLengthGuardrails,
} from "./dataset-bias.mjs";

export const DATASET_VERSION = "routing_difficulty_public_prompts_7000_rebalanced_2026_07_21";
export const BUNDLE_VERSION = "routing_difficulty_initial_15000_rebalanced_2026_07_21";
export const RECORD_SCHEMA_VERSION = "gatelm.routing-difficulty-dataset-record.v1";
export const MANIFEST_SCHEMA_VERSION = "gatelm.routing-difficulty-dataset-manifest.v1";
export const GENERATED_AT = "2026-07-21T00:00:00Z";
export const GENERATION_SEED = 20260721;

export const DATASET_PATH = "docs/routing/datasets/difficulty/data/public-prompts-7000.jsonl";
export const MANIFEST_PATH = "docs/routing/datasets/difficulty/data/public-prompts-7000.manifest.json";
export const BUNDLE_PATH = "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.jsonl";
export const BUNDLE_MANIFEST_PATH =
  "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.manifest.json";
export const ENTERPRISE_DATASET_PATH =
  "docs/routing/datasets/difficulty/data/enterprise-synthetic-8000.jsonl";
export const RECORD_SCHEMA_PATH =
  "docs/routing/datasets/difficulty/schemas/difficulty-dataset-record.schema.json";

const SEMANTIC_DEDUP_REMEDIATION = JSON.parse(
  readFileSync(new URL("./semantic-dedup-remediation.v1.json", import.meta.url), "utf8"),
);
const EXCLUDED_PUBLIC_SAMPLE_IDS = new Set(
  SEMANTIC_DEDUP_REMEDIATION.excluded_public_sample_ids,
);

export const SOURCE_SPECS = {
  klue_mrc: {
    cache: "klue-mrc-prompts.jsonl",
    url: "https://huggingface.co/datasets/klue/klue",
    license: "CC-BY-SA-4.0",
    revision: "349481ec73fff722f88e0453ca05c77a447d967c",
    promptKind: "benchmark_question",
    authorship: "human_authored",
    humanOrigin: true,
    directHumanAuthored: true,
    realUser: false,
  },
  kite: {
    cache: "kite-prompts.jsonl",
    url: "https://huggingface.co/datasets/junkim100/KITE",
    license: "Apache-2.0",
    revision: "b02c5cf191a1fd2691b7154875fef46e2aeedc95",
    promptKind: "benchmark_instruction",
    authorship: "human_curated_translation",
    humanOrigin: true,
    directHumanAuthored: false,
    realUser: false,
  },
  aya_dataset: {
    cache: "aya-prompts.jsonl",
    url: "https://huggingface.co/datasets/CohereLabs/aya_dataset",
    license: "Apache-2.0",
    revision: "f9ea04583f02a8f86404ff6c58bf75fe637df8a2",
    promptKind: "human_authored_instruction",
    authorship: "human_authored",
    humanOrigin: true,
    directHumanAuthored: true,
    realUser: false,
  },
  k2_eval: {
    cache: "k2-eval-prompts.jsonl",
    url: "https://huggingface.co/datasets/HAERAE-HUB/K2-Eval",
    license: "MIT",
    revision: "14bbbc9ee6eef17368508735700465eedc9ec4c5",
    promptKind: "handwritten_benchmark_instruction",
    authorship: "human_authored",
    humanOrigin: true,
    directHumanAuthored: true,
    realUser: false,
  },
  hrm8k_ksm: {
    cache: "hrm8k-ksm-prompts.jsonl",
    url: "https://huggingface.co/datasets/HAERAE-HUB/HRM8K",
    license: "MIT",
    revision: "c360cabf8d733a82455565358b3dc965aab9ba8d",
    promptKind: "human_reviewed_math_question",
    authorship: "human_origin_machine_translated",
    humanOrigin: true,
    directHumanAuthored: false,
    realUser: false,
  },
  haerae_bench_2: {
    cache: "haerae-bench-2-prompts.jsonl",
    url: "https://huggingface.co/datasets/HAERAE-HUB/HAE_RAE_BENCH_2.0",
    license: "MIT",
    revision: "87bf691006fbd6c3440238802fd8cb4e9bdbcffe",
    promptKind: "benchmark_question",
    authorship: "benchmark_derived",
    humanOrigin: false,
    directHumanAuthored: false,
    realUser: false,
  },
  openassistant_oasst1: {
    cache: "oasst1-prompts-only.jsonl",
    url: "https://huggingface.co/datasets/OpenAssistant/oasst1",
    license: "Apache-2.0",
    revision: "fdf72ae0827c1cda404aff25b6603abec9e3399b",
    promptKind: "human_authored_prompter",
    authorship: "human_authored",
    humanOrigin: true,
    directHumanAuthored: true,
    realUser: false,
  },
  databricks_dolly_15k: {
    cache: "dolly-prompts.jsonl",
    url: "https://huggingface.co/datasets/databricks/databricks-dolly-15k",
    license: "CC-BY-SA-3.0",
    revision: "bdd27f4d94b9c1f951818a7da7fd7aeea5dbff1a",
    promptKind: "employee_authored_instruction",
    authorship: "human_authored",
    humanOrigin: true,
    directHumanAuthored: true,
    realUser: false,
  },
  kullm_v2_dolly: {
    cache: "kullm-v2-dolly-prompts.jsonl",
    url: "https://huggingface.co/datasets/nlpai-lab/kullm-v2",
    license: "CC-BY-SA-3.0",
    revision: "cddcb73c259269928e974e0ce141f123eb068030",
    promptKind: "machine_translated_human_instruction",
    authorship: "human_origin_machine_translated",
    humanOrigin: true,
    directHumanAuthored: false,
    realUser: false,
  },
};

const SPLIT_QUOTAS = {
  ko: {
    simple: { train: 1470, validation: 315, test: 315 },
    complex: { train: 1470, validation: 315, test: 315 },
  },
  en: {
    simple: { train: 787, validation: 169, test: 169 },
    complex: { train: 787, validation: 169, test: 169 },
  },
  mixed: {
    simple: { train: 193, validation: 41, test: 41 },
    complex: { train: 193, validation: 41, test: 41 },
  },
};

const TASK_TYPES = [
  "general_query",
  "fact_explanation",
  "translation",
  "summarization",
  "document_writing",
  "code_generation",
  "code_explanation",
  "code_modification",
  "code_review",
  "debugging",
  "data_analysis",
  "math_problem",
  "comparison_evaluation",
  "planning",
  "search",
  "rag_query",
  "table_conversion",
  "json_conversion",
  "structured_data_processing",
  "file_processing",
  "multi_document_comparison",
  "business_report",
  "internal_document_query",
];

const DOMAINS = [
  "corporate_operations",
  "hr_recruiting",
  "internal_policy",
  "finance_accounting",
  "sales",
  "marketing",
  "customer_support",
  "security",
  "legal",
  "compliance",
  "privacy",
  "software_development",
  "data_analysis",
  "project_management",
  "product_planning",
  "research",
  "business_strategy",
  "document_management",
  "meeting_minutes",
  "business_reporting",
  "training_onboarding",
  "rag_internal_knowledge",
  "business_format_conversion",
];

const FORBIDDEN_PATTERNS = [
  ["email", /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i],
  ["phone", /(?:\+?82[- .]?)?0?1[016789][- .]?\d{3,4}[- .]?\d{4}\b/],
  ["phone", /\b0(?:2|[3-6]\d)[- .]?\d{3,4}[- .]?\d{4}\b/],
  ["url", /https?:\/\/\S+/i],
  ["resident_id", /\b\d{6}-[1-4]\d{6}\b/],
  ["credit_card", /\b(?:\d[ -]*?){13,19}\b/],
  ["secret", /\b(?:sk|rk|pk)-[a-z0-9_-]{12,}\b/i],
  ["secret", /\b(?:api[_ -]?key|password|passwd|access[_ -]?token|secret)\s*[:=]\s*[^\s,;]+/i],
  ["authorization", /\bBearer\s+[a-z0-9._-]{8,}/i],
  ["private_key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i],
  ["system_message", /^\s*(?:system|assistant|developer|tool)\s*:/im],
  ["system_message", /<\/?(?:system|assistant|developer|tool)>/i],
  ["control_character", /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/],
];

const PERSONAL_CONTEXT_PATTERN =
  /(?:내\s*(?:주민등록번호|휴대폰\s*번호|전화번호|계좌번호|집\s*주소)|my\s+(?:social security|phone number|home address|bank account)|계좌\s*번호|bank account number|연락처는|주소는\s*\d)/i;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableHash(value) {
  return sha256(`${GENERATION_SEED}|${value}`);
}

function normalizeText(value) {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizePrompt(value) {
  return normalizeText(value)
    .toLocaleLowerCase("und")
    .replace(/[\p{P}\p{S}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countBy(records, selector) {
  const counts = {};
  for (const record of records) {
    const key = String(selector(record));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] ?? 0) + amount;
}

function forbiddenReason(prompt) {
  if (PERSONAL_CONTEXT_PATTERN.test(prompt)) return "personal_context";
  for (const [name, pattern] of FORBIDDEN_PATTERNS) if (pattern.test(prompt)) return name;
  return null;
}

function qualityGate(prompt, stats, { minLength = 8, maxLength = 12000 } = {}) {
  if (typeof prompt !== "string") {
    increment(stats.rejected, "missing_prompt");
    return null;
  }
  const normalized = normalizeText(prompt);
  if (normalized.length < minLength || normalized.length > maxLength) {
    increment(stats.rejected, "invalid_length");
    return null;
  }
  const reason = forbiddenReason(normalized);
  if (reason) {
    increment(stats.rejected, reason);
    return null;
  }
  if (/^(?:n\/?a|null|none|test|hello|hi|안녕|테스트)[.!? ]*$/i.test(normalized)) {
    increment(stats.rejected, "low_information");
    return null;
  }
  const repeated = /(.)\1{12,}/u.test(normalized) || /(.{3,20})(?:\s*\1){5,}/u.test(normalized);
  if (repeated) {
    increment(stats.rejected, "repetition");
    return null;
  }
  return normalized;
}

function detectLanguage(prompt) {
  const hangulCount = (prompt.match(/[가-힣]/g) ?? []).length;
  const latinTokens = prompt.match(/\b[A-Za-z][A-Za-z0-9+.#/_-]{1,}\b/g) ?? [];
  const substantiveLatin = latinTokens.filter((token) => token.length >= 4);
  if (hangulCount > 0 && (latinTokens.length >= 2 || substantiveLatin.length >= 1)) return "mixed";
  if (hangulCount > 0) return "ko";
  return "en";
}

export function difficultyScore(prompt) {
  const text = prompt.toLocaleLowerCase("und");
  let score = 0;
  if (/(?:분석|비교|평가|검토|추론|원인|근거|전략|설계|디버그|최적화|analy[sz]e|compare|evaluate|review|reason|root cause|design|debug|optimi[sz]e)/i.test(text)) score += 2;
  if (/(?:그리고|그런 다음|동시에|각각|단계|먼저|이후|then|after|before|each|step|while|simultaneously)/i.test(text)) score += 1;
  if (/(?:반드시|제외|조건|형식|최소|최대|하지 마|must|without|unless|at least|at most|exactly|format)/i.test(text)) score += 1;
  if (/(?:교차\s*검증|반증|상충|의존성|민감도|예외.*위험|cross[- ]?check|falsif|conflict|dependency|sensitivity|trade-?off)/i.test(text)) score += 2;
  if (/(?:여러|복수|세\s*가지|두\s*개\s*이상|multiple|several|three|across).*(?:문서|자료|조건|대안|sources?|documents?|constraints?|alternatives?)/i.test(text)) score += 2;
  return score;
}

function oasstQuality(row) {
  const labels = row.labels ?? {};
  const value = (name, fallback = 0) => Number(labels[name]?.value ?? fallback);
  const detox = row.detoxify ?? {};
  if (row.role !== "prompter" || row.deleted || row.review_result !== true || row.synthetic) return null;
  if (value("pii") > 0 || value("spam") > 0.2 || value("not_appropriate") > 0.2) return null;
  if (value("hate_speech") > 0.2 || value("sexual_content") > 0.2 || value("toxicity") > 0.35) return null;
  if (Number(detox.severe_toxicity ?? 0) > 0.2 || Number(detox.sexual_explicit ?? 0) > 0.2) return null;
  return Math.max(0.4, Math.min(1, value("quality", 0.65)));
}

export function taskTypeFor(prompt, candidate) {
  if (candidate.sourceDataset === "klue_mrc") return "fact_explanation";
  const text = prompt.toLocaleLowerCase("und");
  const specificRules = [
    ["rag_query", /(?:\brag\b|vector\s*(?:search|검색)|knowledge\s*base|지식\s*베이스)/i],
    ["internal_document_query", /(?:사내|내부|internal|intranet).*(?:문서|규정|정책|document|policy)/i],
    ["multi_document_comparison", /(?:여러|복수|둘\s*이상의|multiple|several|two or more).*(?:문서|보고서|documents?|reports?).*(?:비교|대조|compare|contrast)/i],
    ["translation", /(?:번역|translate|translation)/i],
    ["summarization", /(?:요약|summari[sz]e|summary)/i],
    ["debugging", /(?:디버그|오류|에러|버그|debug|exception|stack trace|race condition)/i],
    ["code_review", /(?:코드\s*리뷰|code review|security review)/i],
    ["code_modification", /(?:코드.*(?:수정|리팩터)|modify.*code|refactor)/i],
    ["code_explanation", /(?:코드.*설명|explain.*code)/i],
    ["code_generation", /(?:코드|함수|클래스|script|function|program|implement|sql query)/i],
    ["json_conversion", /(?:json)/i],
    ["table_conversion", /(?:표로|테이블|table|csv|tsv)/i],
    ["multi_document_comparison", /(?:여러\s*문서|문서.*비교|compare.*documents?|multiple reports?)/i],
    ["file_processing", /(?:파일|file|pdf|xlsx|spreadsheet|image)/i],
    ["data_analysis", /(?:데이터.*분석|통계|상관|회귀|dataset|statistics|correlation|regression)/i],
    ["comparison_evaluation", /(?:비교|평가|장단점|compare|evaluate|pros and cons)/i],
    ["search", /(?:검색|찾아|조사|최신|search|find|research the latest)/i],
    ["business_report", /(?:보고서|executive summary|business report)/i],
  ];
  const specific = specificRules.find(([, pattern]) => pattern.test(text));
  if (specific) return specific[0];
  if (candidate.taskTypeHint) return candidate.taskTypeHint;
  const generalRules = [
    ["math_problem", /(?:계산|방정식|확률|수학|calculate|equation|probability|math)/i],
    ["planning", /(?:계획|로드맵|전략|plan|roadmap|strategy)/i],
    ["document_writing", /(?:작성|초안|이메일|편지|write|draft|email|poem|story)/i],
    ["structured_data_processing", /(?:분류|정렬|목록|구조화|classify|sort|list|structured)/i],
  ];
  return generalRules.find(([, pattern]) => pattern.test(text))?.[0] ?? (prompt.includes("?") ? "general_query" : "fact_explanation");
}

export function domainFor(prompt, candidateOrSource) {
  const candidate = typeof candidateOrSource === "object" && candidateOrSource !== null
    ? candidateOrSource
    : { sourceDataset: candidateOrSource };
  const sourceDataset = candidate.sourceDataset;
  const rules = [
    ["rag_internal_knowledge", /(?:\brag\b|knowledge\s*base|지식\s*베이스|vector\s*(?:search|검색))/i],
    ["business_format_conversion", /(?:json|csv|tsv|표로|테이블|table).*(?:변환|convert|format)/i],
    ["hr_recruiting", /(?:인사|채용|직원|면접|resume|recruit|employee|onboarding)/i],
    ["finance_accounting", /(?:회계|재무|예산|세금|금리|경제|finance|accounting|budget|tax|econom)/i],
    ["security", /(?:보안|취약점|암호|공격|security|vulnerab|encrypt|attack)/i],
    ["privacy", /(?:개인정보|프라이버시|privacy|personal data)/i],
    ["legal", /(?:법률|법원|판결|계약|legal|court|law|contract)/i],
    ["compliance", /(?:규정준수|컴플라이언스|감사|compliance|audit)/i],
    ["internal_policy", /(?:정책|규정|policy|regulation)/i],
    ["software_development", /(?:코드|프로그램|api|python|javascript|typescript|java|sql|software|database|server)/i],
    ["data_analysis", /(?:데이터|통계|분석|dataset|statistics|analytics)/i],
    ["sales", /(?:영업|매출|판매|sales|revenue)/i],
    ["marketing", /(?:마케팅|광고|브랜드|marketing|advertis|brand)/i],
    ["customer_support", /(?:고객|문의|지원|customer|support|ticket)/i],
    ["project_management", /(?:프로젝트|일정|마일스톤|project|milestone|sprint)/i],
    ["product_planning", /(?:제품|기능|요구사항|product|feature|requirements?)/i],
    ["business_strategy", /(?:전략|시장|경쟁|strategy|market|competitor)/i],
    ["meeting_minutes", /(?:회의|회의록|meeting|minutes)/i],
    ["business_reporting", /(?:보고서|성과|지표|report|performance|metric)/i],
    ["training_onboarding", /(?:교육|학습|훈련|training|learning|tutorial)/i],
    ["document_management", /(?:문서|파일|document|file|pdf)/i],
  ];
  const match = rules.find(([, pattern]) => pattern.test(prompt));
  if (match) return match[0];
  if (["klue_mrc", "kite", "haerae_bench_2", "hrm8k_ksm", "k2_eval"].includes(sourceDataset)) {
    return "research";
  }
  const taskType = taskTypeFor(prompt, candidate);
  const taskDomainFallback = {
    business_report: "business_reporting",
    code_explanation: "software_development",
    code_generation: "software_development",
    code_modification: "software_development",
    code_review: "software_development",
    comparison_evaluation: "business_strategy",
    data_analysis: "data_analysis",
    debugging: "software_development",
    document_writing: "business_reporting",
    fact_explanation: "research",
    file_processing: "document_management",
    internal_document_query: "internal_policy",
    json_conversion: "business_format_conversion",
    math_problem: "research",
    multi_document_comparison: "document_management",
    planning: "product_planning",
    rag_query: "rag_internal_knowledge",
    search: "research",
    structured_data_processing: "data_analysis",
    summarization: "document_management",
    table_conversion: "business_format_conversion",
    translation: "document_management",
  };
  return taskDomainFallback[taskType] ?? "corporate_operations";
}

function expectedCategory(taskType) {
  if (taskType.startsWith("code_") || taskType === "debugging") return "code";
  if (taskType === "translation") return "translation";
  if (taskType === "summarization") return "summarization";
  if (["data_analysis", "math_problem", "comparison_evaluation", "planning", "multi_document_comparison", "rag_query"].includes(taskType)) return "reasoning";
  return "general";
}

function featureMetadata(prompt, label, score) {
  const sentences = prompt.split(/[.!?。！？]\s+|\n+/).filter(Boolean).length;
  const constraintMatches = prompt.match(/(?:반드시|제외|금지|최소|최대|형식|must|do not|without|at least|at most|exactly|format)/gi) ?? [];
  const stepMatches = prompt.match(/(?:그리고|그런 다음|먼저|이후|각각|단계|then|after|first|each|step)/gi) ?? [];
  const hasCode = /```|\b(?:python|javascript|typescript|java|golang|rust|sql)\b|\b[A-Za-z_$][\w$]*\([^)]*\)\s*[{;]/i.test(prompt);
  const hasFile = /(?:파일|첨부|문서|pdf|xlsx|csv|image|file|attachment|document)/i.test(prompt);
  const toolRequired = /(?:검색|최신|파일|첨부|실행|search|latest|browse|file|attachment|run the code)/i.test(prompt);
  const verificationRequired = /(?:검증|확인|테스트|비교|근거|verify|validate|test|compare|evidence|cite)/i.test(prompt);
  let expressionStyle = "standard";
  if (/\?$/.test(prompt)) expressionStyle = "interrogative";
  if (/(?:해주세요|해줘|please|could you|can you)/i.test(prompt)) expressionStyle = "request_form";
  if (constraintMatches.length >= 2 || stepMatches.length >= 2) expressionStyle = "compound_command";
  if (hasCode) expressionStyle = "technical";
  if (prompt.length < 40 && !/[.!?]$/.test(prompt)) expressionStyle = "abbreviated";
  const paragraphs = prompt.split(/\n\s*\n/).filter(Boolean).length;
  const promptStructure = paragraphs > 1 ? "multi_paragraph" : sentences > 1 ? "multi_sentence" : "single_sentence";
  return {
    expression_style: expressionStyle,
    prompt_structure: promptStructure,
    length_bucket: lengthBucket(prompt),
    reasoning_level: label === "complex" ? (score >= 6 ? "high" : "medium") : score >= 2 ? "medium" : "low",
    task_step_count: Math.max(1, Math.min(20, 1 + stepMatches.length)),
    constraint_count: Math.min(30, constraintMatches.length),
    has_code: hasCode,
    has_file: hasFile,
    tool_required: toolRequired,
    verification_required: verificationRequired,
  };
}

function candidate({
  sourceDataset,
  originId,
  prompt,
  transform,
  qualityScore,
  labelHint = null,
  language = null,
  difficultyText = prompt,
  taskTypeHint = null,
  semanticOriginKey = null,
  groupKey = null,
  directHumanAuthored = null,
}) {
  return {
    sourceDataset,
    originId,
    prompt,
    transform,
    qualityScore,
    labelHint,
    language: language ?? detectLanguage(prompt),
    difficultyScore: difficultyScore(difficultyText),
    taskTypeHint,
    semanticOriginKey: semanticOriginKey ?? `${sourceDataset}:${originId}`,
    groupKey: groupKey ?? `${sourceDataset}:${originId}`,
    directHumanAuthored,
    stableKey: stableHash(`${sourceDataset}|${originId}|${transform}|${labelHint ?? "open"}`),
  };
}

function buildKlueCandidates(rows, stats) {
  const candidates = [];
  for (const row of rows) {
    increment(stats.examined, "klue_mrc");
    if (row.is_impossible) {
      increment(stats.rejected, "unanswerable_benchmark_item");
      continue;
    }
    const question = qualityGate(row.question, stats, { minLength: 8, maxLength: 500 });
    if (!question) continue;
    candidates.push(
      candidate({
        sourceDataset: "klue_mrc",
        originId: row.guid,
        prompt: question,
        transform: "as_published_field",
        qualityScore: 0.86,
        language: "ko",
        taskTypeHint: "fact_explanation",
        difficultyText: question,
      }),
    );
  }
  const adjacentLengthPairs = candidates
    .filter((item) => lengthBucket(item.prompt) === "short")
    .sort((left, right) =>
      characterLength(left.prompt) - characterLength(right.prompt)
      || left.stableKey.localeCompare(right.stableKey))
    .reduce((pairs, item, index, sorted) => {
      if (index % 2 === 0 && sorted[index + 1]) pairs.push([item, sorted[index + 1]]);
      return pairs;
    }, [])
    .sort((left, right) =>
      stableHash(`klue-length-pair:${left[0].originId}:${left[1].originId}`)
        .localeCompare(stableHash(`klue-length-pair:${right[0].originId}:${right[1].originId}`)))
    .slice(0, 450);

  return adjacentLengthPairs.flatMap((pair) => {
    const [simple, complex] = [...pair].sort((left, right) =>
      left.difficultyScore - right.difficultyScore || left.stableKey.localeCompare(right.stableKey));
    return [
      {
        ...simple,
        labelHint: "simple",
        stableKey: stableHash(`klue_mrc|${simple.originId}|simple|length-matched`),
      },
      {
        ...complex,
        labelHint: "complex",
        stableKey: stableHash(`klue_mrc|${complex.originId}|complex|length-matched`),
      },
    ];
  });
}

function buildKiteCandidates(rows, stats) {
  const candidates = [];
  for (const row of rows) {
    increment(stats.examined, "kite");
    const prompt = qualityGate(row.instruction, stats, { minLength: 12, maxLength: 4000 });
    if (!prompt) continue;
    candidates.push(
      candidate({
        sourceDataset: "kite",
        originId: `${row.config}:${row.row_idx}`,
        prompt,
        transform: "as_published_field",
        qualityScore: 0.9,
        language: "ko",
        directHumanAuthored: row.config === "culturally_aware_all",
      }),
    );
  }
  return candidates;
}

function buildOasstCandidates(rows, stats) {
  const candidates = [];
  for (const row of rows) {
    increment(stats.examined, "openassistant_oasst1");
    if (row.lang !== "en") continue;
    const qualityScore = oasstQuality(row);
    if (qualityScore === null) {
      increment(stats.rejected, "source_quality_or_safety_label");
      continue;
    }
    const prompt = qualityGate(row.text, stats, { minLength: 8, maxLength: 8000 });
    if (!prompt) continue;
    if (row.lang === "en" && detectLanguage(prompt) !== "en") continue;
    candidates.push(
      candidate({
        sourceDataset: "openassistant_oasst1",
        originId: row.message_id,
        prompt,
        transform: "as_published_field",
        qualityScore,
        language: row.lang,
      }),
    );
  }
  return candidates;
}

function promptWithContext(instruction, context, language) {
  if (!context) return instruction;
  return language === "en"
    ? `${instruction}\n\nContext:\n${context}`
    : `${instruction}\n\n입력:\n${context}`;
}

function dollyTaskType(category) {
  return {
    closed_qa: "fact_explanation",
    open_qa: "general_query",
    general_qa: "general_query",
    classification: "structured_data_processing",
    information_extraction: "structured_data_processing",
    brainstorming: "planning",
    summarization: "summarization",
    creative_writing: "document_writing",
  }[category] ?? "general_query";
}

function buildAyaCandidates(rows, stats) {
  const candidates = [];
  for (const row of rows) {
    increment(stats.examined, "aya_dataset");
    if (!["kor", "eng"].includes(row.language_code)) continue;
    const prompt = qualityGate(row.inputs, stats, { minLength: 8, maxLength: 8000 });
    if (!prompt) continue;
    candidates.push(candidate({
      sourceDataset: "aya_dataset",
      originId: String(row.row_idx),
      prompt,
      transform: "as_published_field",
      qualityScore: row.annotation_type === "original-annotations" ? 0.93 : 0.88,
      language: row.language_code === "kor" ? "ko" : "en",
    }));
  }
  return candidates;
}

function buildDollyCandidates(rows, stats) {
  const candidates = [];
  for (const row of rows) {
    increment(stats.examined, "databricks_dolly_15k");
    const instruction = qualityGate(row.instruction, stats, { minLength: 8, maxLength: 4000 });
    if (!instruction) continue;
    const context = row.context ? qualityGate(row.context, stats, { minLength: 1, maxLength: 8000 }) : "";
    if (row.context && !context) continue;
    candidates.push(candidate({
      sourceDataset: "databricks_dolly_15k",
      originId: String(row.row_idx),
      prompt: promptWithContext(instruction, context, "en"),
      transform: context ? "prompt_serialization" : "as_published_field",
      qualityScore: 0.94,
      language: "en",
      taskTypeHint: dollyTaskType(row.category),
      semanticOriginKey: `dolly:${row.row_idx}`,
      groupKey: `dolly:${row.row_idx}`,
    }));
  }
  return candidates;
}

function buildKullmDollyCandidates(rows, dollyRows, stats) {
  const categories = new Map(dollyRows.map((row) => [row.row_idx, row.category]));
  const candidates = [];
  for (const row of rows) {
    increment(stats.examined, "kullm_v2_dolly");
    const dollyRowIndex = row.row_idx - 52002;
    if (!categories.has(dollyRowIndex)) continue;
    const instruction = qualityGate(row.instruction, stats, { minLength: 8, maxLength: 4000 });
    if (!instruction) continue;
    const input = row.input ? qualityGate(row.input, stats, { minLength: 1, maxLength: 8000 }) : "";
    if (row.input && !input) continue;
    const prompt = promptWithContext(instruction, input, "ko");
    const language = detectLanguage(prompt);
    if (!["ko", "mixed"].includes(language)) continue;
    candidates.push(candidate({
      sourceDataset: "kullm_v2_dolly",
      originId: String(row.row_idx),
      prompt,
      transform: "machine_translated_published_field",
      qualityScore: 0.86,
      language,
      taskTypeHint: dollyTaskType(categories.get(dollyRowIndex)),
      semanticOriginKey: `dolly:${dollyRowIndex}`,
      groupKey: `dolly:${dollyRowIndex}`,
    }));
  }
  return candidates;
}

function buildHrm8kCandidates(rows, stats) {
  return rows.flatMap((row) => {
    increment(stats.examined, "hrm8k_ksm");
    const prompt = qualityGate(row.question, stats, { minLength: 12, maxLength: 8000 });
    return prompt ? [candidate({
      sourceDataset: "hrm8k_ksm",
      originId: String(row.row_idx),
      prompt,
      transform: "as_published_field",
      qualityScore: 0.91,
      language: "ko",
      taskTypeHint: "math_problem",
    })] : [];
  });
}

function buildHaeraeBench2Candidates(rows, stats) {
  const taskByConfig = {
    date_understanding: "fact_explanation",
    context_definition_alignment: "fact_explanation",
    proverb_unscrambling: "structured_data_processing",
    "2_digit_multiply": "math_problem",
    "3_digit_subtract": "math_problem",
  };
  return rows.flatMap((row) => {
    increment(stats.examined, "haerae_bench_2");
    const prompt = qualityGate(row.question, stats, { minLength: 12, maxLength: 8000 });
    return prompt ? [candidate({
      sourceDataset: "haerae_bench_2",
      originId: `${row.config}:${row.row_idx}`,
      prompt,
      transform: "as_published_field",
      qualityScore: 0.82,
      language: "ko",
      taskTypeHint: taskByConfig[row.config],
    })] : [];
  });
}

function buildK2Candidates(rows, stats) {
  const abilityTask = {
    "Numerical Estimation": "math_problem",
    "Creative Writing": "document_writing",
    "Proposing Solutions": "planning",
    "Comparative Analysis": "comparison_evaluation",
    "Cause and Effect Analysis": "comparison_evaluation",
    Brainstorming: "planning",
    "Empathetic Reasoning": "general_query",
  };
  return rows.flatMap((row) => {
    increment(stats.examined, "k2_eval");
    const prompt = qualityGate(row.instruction, stats, { minLength: 12, maxLength: 4000 });
    return prompt ? [candidate({
      sourceDataset: "k2_eval",
      originId: String(row.row_idx),
      prompt,
      transform: "as_published_field",
      qualityScore: 0.95,
      language: "ko",
      taskTypeHint: abilityTask[row.ability] ?? "general_query",
    })] : [];
  });
}

function tokenShingles(prompt) {
  const tokens = normalizePrompt(prompt).split(" ").filter(Boolean);
  const shingles = new Set(tokens);
  for (let index = 0; index + 1 < tokens.length; index += 1) shingles.add(`${tokens[index]} ${tokens[index + 1]}`);
  return shingles;
}

function hash32(value, seed = 0) {
  let hash = (2166136261 ^ seed) >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash;
}

const MINHASH_SEEDS = Array.from({ length: 48 }, (_, index) => hash32(`seed:${GENERATION_SEED}:${index}`));

function minhash(shingles) {
  const signature = MINHASH_SEEDS.map(() => 0xffffffff);
  for (const shingle of shingles) {
    const base = hash32(shingle);
    for (let index = 0; index < signature.length; index += 1) {
      const value = Math.imul(base ^ MINHASH_SEEDS[index], 0x5bd1e995) >>> 0;
      if (value < signature[index]) signature[index] = value;
    }
  }
  return signature;
}

function jaccard(left, right) {
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection || 1);
}

class PromptDeduper {
  constructor(seedPrompts = []) {
    this.exact = new Set();
    this.entries = [];
    this.buckets = new Map();
    this.removed = { exact: 0, near: 0 };
    for (const prompt of seedPrompts) this.add(prompt, true);
  }

  bandKeys(signature) {
    const keys = [];
    for (let index = 0; index < signature.length; index += 4) {
      keys.push(`${index / 4}:${signature.slice(index, index + 4).join(".")}`);
    }
    return keys;
  }

  add(prompt, seed = false) {
    const normalized = normalizePrompt(prompt);
    if (this.exact.has(normalized)) {
      if (!seed) this.removed.exact += 1;
      return false;
    }
    const shingles = tokenShingles(prompt);
    const signature = minhash(shingles);
    const candidateIndexes = new Set();
    for (const key of this.bandKeys(signature)) {
      for (const candidateIndex of this.buckets.get(key) ?? []) candidateIndexes.add(candidateIndex);
    }
    for (const candidateIndex of candidateIndexes) {
      const other = this.entries[candidateIndex];
      const lengthRatio = Math.min(shingles.size, other.shingles.size) / Math.max(shingles.size, other.shingles.size);
      if (lengthRatio >= 0.8 && jaccard(shingles, other.shingles) >= 0.9) {
        if (!seed) this.removed.near += 1;
        return false;
      }
    }
    const entryIndex = this.entries.length;
    this.entries.push({ shingles });
    this.exact.add(normalized);
    for (const key of this.bandKeys(signature)) {
      if (!this.buckets.has(key)) this.buckets.set(key, []);
      this.buckets.get(key).push(entryIndex);
    }
    return true;
  }
}

const PUBLIC_LENGTH_LABEL_TARGETS = {
  simple: { short: 2000, medium: 1440, long: 60 },
  complex: { short: 2000, medium: 1440, long: 60 },
};

const BUNDLE_TASK_MIN = 400;
const BUNDLE_TASK_MAX = 900;
const BUNDLE_TASK_LABEL_MAX = 585;
const BUNDLE_DOMAIN_MIN = 300;
const BUNDLE_DOMAIN_MAX = 1875;
const BUNDLE_DOMAIN_LABEL_MAX = 1218;
const PUBLIC_TOP_FIVE_TASK_MAX = 3850;
const DIRECT_HUMAN_AUTHORSHIP_PRIORITY = 3;

function allocateBalancedPublicTargets(keys, existingCounts, candidateCounts, minimum, maximum, total) {
  const targets = Object.fromEntries(keys.map((key) => [key, 0]));
  const capacities = Object.fromEntries(keys.map((key) => [
    key,
    Math.max(0, Math.min(candidateCounts[key] ?? 0, maximum - (existingCounts[key] ?? 0))),
  ]));
  for (const key of keys) {
    targets[key] = Math.min(capacities[key], Math.max(0, minimum - (existingCounts[key] ?? 0)));
  }
  let remaining = total - Object.values(targets).reduce((sum, count) => sum + count, 0);
  while (remaining > 0) {
    const available = keys
      .filter((key) => targets[key] < capacities[key])
      .sort((left, right) => {
        const finalDifference = ((existingCounts[left] ?? 0) + targets[left])
          - ((existingCounts[right] ?? 0) + targets[right]);
        return finalDifference || left.localeCompare(right);
      });
    if (available.length === 0) {
      throw new Error(`balanced target allocation exhausted capacity with ${remaining} records remaining`);
    }
    targets[available[0]] += 1;
    remaining -= 1;
  }
  return { targets, capacities };
}

function selectCandidates(candidatePools, existingRecords, stats) {
  const selected = [];
  const usedSourceRecords = new Set();
  const usedSemanticOrigins = new Set();
  const deduper = new PromptDeduper(existingRecords.map((record) => record.redacted_prompt));
  const taskCounts = countBy(existingRecords, (record) => record.task_type);
  const domainCounts = countBy(existingRecords, (record) => record.service_domain);
  const taskLabelCounts = Object.fromEntries(
    ["simple", "complex"].map((label) => [
      label,
      countBy(existingRecords.filter((record) => record.label === label), (record) => record.task_type),
    ]),
  );
  const domainLabelCounts = Object.fromEntries(
    ["simple", "complex"].map((label) => [
      label,
      countBy(existingRecords.filter((record) => record.label === label), (record) => record.service_domain),
    ]),
  );
  const lengthCounts = {
    simple: { short: 0, medium: 0, long: 0 },
    complex: { short: 0, medium: 0, long: 0 },
  };
  const selectedLanguageCounts = { ko: 0, en: 0, mixed: 0 };
  const sourceCounts = Object.fromEntries(Object.keys(SOURCE_SPECS).map((source) => [source, 0]));
  stats.selectionRejected = {};
  const cellQuotas = {
    "ko:simple": 2100,
    "ko:complex": 2100,
    "en:simple": 1125,
    "en:complex": 1125,
    "mixed:simple": 275,
    "mixed:complex": 275,
  };
  const inventory = Object.values(candidatePools).flat().map((item) => ({
    ...item,
    taskType: taskTypeFor(item.prompt, item),
    serviceDomain: domainFor(item.prompt, item),
    lengthBucket: lengthBucket(item.prompt),
  }));
  const taskCandidateCounts = countBy(inventory, (item) => item.taskType);
  const domainCandidateCounts = countBy(inventory, (item) => item.serviceDomain);
  const taskAllocation = allocateBalancedPublicTargets(
    TASK_TYPES,
    taskCounts,
    taskCandidateCounts,
    BUNDLE_TASK_MIN,
    BUNDLE_TASK_MAX,
    7000,
  );
  const domainAllocation = allocateBalancedPublicTargets(
    DOMAINS,
    domainCounts,
    domainCandidateCounts,
    BUNDLE_DOMAIN_MIN,
    BUNDLE_DOMAIN_MAX,
    7000,
  );
  const selectionPriority = (item) => {
    const taskCapacity = Math.max(1, taskAllocation.capacities[item.taskType] ?? 0);
    const domainCapacity = Math.max(1, domainAllocation.capacities[item.serviceDomain] ?? 0);
    return ((taskAllocation.targets[item.taskType] ?? 0) / taskCapacity)
      + ((domainAllocation.targets[item.serviceDomain] ?? 0) / domainCapacity);
  };
  const cells = Object.entries(cellQuotas).map(([key, quota]) => {
    const [language, label] = key.split(":");
    const queues = Object.fromEntries(
      ["short", "medium", "long"].map((bucket) => [
        bucket,
        inventory
          .filter((item) =>
            item.language === language
            && (item.labelHint === null || item.labelHint === label)
            && item.lengthBucket === bucket)
          .sort((left, right) => {
            const priorityDifference = selectionPriority(right) - selectionPriority(left);
            if (priorityDifference) return priorityDifference;
            const leftSource = SOURCE_SPECS[left.sourceDataset];
            const rightSource = SOURCE_SPECS[right.sourceDataset];
            const leftDirect = left.directHumanAuthored ?? leftSource.directHumanAuthored;
            const rightDirect = right.directHumanAuthored ?? rightSource.directHumanAuthored;
            const leftAdjustedScore = left.difficultyScore
              + (leftDirect ? (label === "simple" ? -DIRECT_HUMAN_AUTHORSHIP_PRIORITY : DIRECT_HUMAN_AUTHORSHIP_PRIORITY) : 0);
            const rightAdjustedScore = right.difficultyScore
              + (rightDirect ? (label === "simple" ? -DIRECT_HUMAN_AUTHORSHIP_PRIORITY : DIRECT_HUMAN_AUTHORSHIP_PRIORITY) : 0);
            const scoreDifference = label === "simple"
              ? leftAdjustedScore - rightAdjustedScore
              : rightAdjustedScore - leftAdjustedScore;
            const authorshipDifference = Number(rightDirect) - Number(leftDirect)
              || Number(rightSource.humanOrigin) - Number(leftSource.humanOrigin);
            return scoreDifference || authorshipDifference || stableHash(`global-select:${left.sourceDataset}:${left.stableKey}`)
              .localeCompare(stableHash(`global-select:${right.sourceDataset}:${right.stableKey}`));
          }),
      ]),
    );
    return { key, language, label, quota, accepted: 0, queues, offsets: { short: 0, medium: 0, long: 0 } };
  });

  while (cells.some((cell) => cell.accepted < cell.quota)) {
    const cell = cells
      .filter((candidateCell) => candidateCell.accepted < candidateCell.quota)
      .sort((left, right) =>
        (left.accepted / left.quota) - (right.accepted / right.quota)
        || left.key.localeCompare(right.key))[0];
    const { label } = cell;
      const bucketOrder = ["short", "medium", "long"]
        .filter((bucket) => lengthCounts[label][bucket] < PUBLIC_LENGTH_LABEL_TARGETS[label][bucket])
        .sort((left, right) => {
          const remainingDifference =
            (PUBLIC_LENGTH_LABEL_TARGETS[label][right] - lengthCounts[label][right])
            - (PUBLIC_LENGTH_LABEL_TARGETS[label][left] - lengthCounts[label][left]);
          return remainingDifference || left.localeCompare(right);
        });
      let chosen = null;
      let chosenBucket = null;
      for (const bucket of bucketOrder) {
        const queue = cell.queues[bucket];
        while (cell.offsets[bucket] < queue.length) {
          const item = queue[cell.offsets[bucket]];
          cell.offsets[bucket] += 1;
          const sourceKey = `${item.sourceDataset}|${item.originId}`;
          const sourceRecordId = sha256(sourceKey).slice(0, 24);
          if (EXCLUDED_PUBLIC_SAMPLE_IDS.has(`pub:${item.sourceDataset}:${sourceRecordId}`)) {
            increment(stats.selectionRejected, "semantic_duplicate_exclusion");
            continue;
          }
          if (usedSourceRecords.has(sourceKey) || usedSemanticOrigins.has(item.semanticOriginKey)) {
            increment(stats.selectionRejected, "used_source_or_semantic_origin");
            continue;
          }
          const sourceCap = item.sourceDataset === "klue_mrc"
            ? 800
            : item.sourceDataset === "kullm_v2_dolly"
              ? 3100
              : 2800;
          const reservedMixedKullm = item.sourceDataset === "kullm_v2_dolly" && item.language !== "mixed"
            ? Math.max(0, 550 - selectedLanguageCounts.mixed)
            : 0;
          if ((sourceCounts[item.sourceDataset] ?? 0) >= sourceCap - reservedMixedKullm) {
            increment(stats.selectionRejected, `source_cap:${item.sourceDataset}`);
            continue;
          }
          if ((taskCounts[item.taskType] ?? 0) >= BUNDLE_TASK_MAX) {
            increment(stats.selectionRejected, `task_cap:${item.taskType}`);
            continue;
          }
          if ((taskLabelCounts[label][item.taskType] ?? 0) >= BUNDLE_TASK_LABEL_MAX) {
            increment(stats.selectionRejected, `task_label_cap:${label}:${item.taskType}`);
            continue;
          }
          if ((domainCounts[item.serviceDomain] ?? 0) >= BUNDLE_DOMAIN_MAX) {
            increment(stats.selectionRejected, `domain_cap:${item.serviceDomain}`);
            continue;
          }
          if ((domainLabelCounts[label][item.serviceDomain] ?? 0) >= BUNDLE_DOMAIN_LABEL_MAX) {
            increment(stats.selectionRejected, `domain_label_cap:${label}:${item.serviceDomain}`);
            continue;
          }
          if (!deduper.add(item.prompt)) {
            increment(stats.selectionRejected, "duplicate");
            continue;
          }
          chosen = item;
          chosenBucket = bucket;
          usedSourceRecords.add(sourceKey);
          usedSemanticOrigins.add(item.semanticOriginKey);
          break;
        }
        if (chosen) break;
      }
      if (!chosen) {
        throw new Error(
          `${cell.key}: expected ${cell.quota}, selected ${cell.accepted}; `
          + `length targets=${JSON.stringify(PUBLIC_LENGTH_LABEL_TARGETS[label])}, `
          + `actual=${JSON.stringify(lengthCounts[label])}, rejected=${JSON.stringify(stats.selectionRejected)}`,
        );
      }
      increment(taskCounts, chosen.taskType);
      increment(domainCounts, chosen.serviceDomain);
      increment(taskLabelCounts[label], chosen.taskType);
      increment(domainLabelCounts[label], chosen.serviceDomain);
      increment(lengthCounts[label], chosenBucket);
      increment(sourceCounts, chosen.sourceDataset);
      increment(selectedLanguageCounts, chosen.language);
      selected.push({ ...chosen, label });
      cell.accepted += 1;
  }
  for (const label of ["simple", "complex"]) {
    for (const bucket of ["short", "medium", "long"]) {
      const expected = PUBLIC_LENGTH_LABEL_TARGETS[label][bucket];
      if (lengthCounts[label][bucket] !== expected) {
        throw new Error(`public length target ${label}/${bucket}: expected ${expected}, got ${lengthCounts[label][bucket]}`);
      }
    }
  }
  stats.deduplication = deduper.removed;
  stats.selectedTaskCounts = taskCounts;
  stats.selectedDomainCounts = domainCounts;
  stats.publicTaskTargets = taskAllocation.targets;
  stats.publicDomainTargets = domainAllocation.targets;
  stats.publicLengthLabelCounts = lengthCounts;
  stats.selectedSourceCounts = sourceCounts;
  return selected;
}

function assignSplits(candidates) {
  const assigned = [];
  for (const [language, labels] of Object.entries(SPLIT_QUOTAS)) {
    for (const [label, quotas] of Object.entries(labels)) {
      const bucket = candidates
        .filter((item) => item.language === language && item.label === label)
        .sort((left, right) => stableHash(`split|${left.sourceDataset}|${left.originId}`).localeCompare(stableHash(`split|${right.sourceDataset}|${right.originId}`)));
      let offset = 0;
      for (const split of ["train", "validation", "test"]) {
        const count = quotas[split];
        assigned.push(...bucket.slice(offset, offset + count).map((item) => ({ ...item, split })));
        offset += count;
      }
      if (offset !== bucket.length) throw new Error(`${language}/${label}: split quotas do not consume ${bucket.length}`);
    }
  }
  return assigned;
}

function toRecord(item, index) {
  const source = SOURCE_SPECS[item.sourceDataset];
  const taskType = item.taskType ?? taskTypeFor(item.prompt, item);
  const sourceRecordId = sha256(`${item.sourceDataset}|${item.originId}`).slice(0, 24);
  const sampleId = `pub:${item.sourceDataset}:${sourceRecordId}`;
  const confidenceBase = item.labelHint ? 0.76 : 0.62 + Math.min(0.18, Math.abs(item.difficultyScore - 3) * 0.025);
  return {
    schema_version: RECORD_SCHEMA_VERSION,
    dataset_version: DATASET_VERSION,
    sample_id: sampleId,
    redacted_prompt: item.prompt,
    automatic_label: item.label,
    label: item.label,
    expected_category: expectedCategory(taskType),
    task_type: taskType,
    service_domain: item.serviceDomain ?? domainFor(item.prompt, item),
    language: item.language,
    source: "public",
    boundary_case: false,
    counterexample_type: null,
    label_source: "public_rule_candidate",
    label_confidence: Number(Math.min(0.9, confidenceBase).toFixed(3)),
    label_reason: item.sourceDataset === "klue_mrc"
      ? item.label === "simple"
        ? "public_candidate_question_operation_rank_low_without_length"
        : "public_candidate_question_operation_rank_high_without_length"
      : item.label === "simple"
        ? "public_candidate_low_operation_or_direct_lookup_without_length"
        : "public_candidate_multi_constraint_context_or_reasoning_without_length",
    human_reviewed: false,
    review_status: "pending",
    group_id: `pubgrp:${sha256(item.groupKey).slice(0, 24)}`,
    split: item.split,
    ...featureMetadata(item.prompt, item.label, item.difficultyScore),
    source_dataset: item.sourceDataset,
    source_record_id: sourceRecordId,
    source_license: source.license,
    source_url: source.url,
    source_revision: source.revision,
    source_prompt_kind: source.promptKind,
    source_transform: item.transform,
    source_authorship: source.authorship,
    source_human_origin: source.humanOrigin,
    source_direct_human_authored: item.directHumanAuthored ?? source.directHumanAuthored,
    source_real_user: source.realUser,
    source_access: "anonymous_public",
    redaction_status: "safety_filtered",
    quality_score: Number(item.qualityScore.toFixed(3)),
    _sort: `${item.split}:${item.sourceDataset}:${String(index).padStart(5, "0")}:${sampleId}`,
  };
}

function distributions(records) {
  return {
    label: countBy(records, (record) => record.label),
    language: countBy(records, (record) => record.language),
    source: countBy(records, (record) => record.source),
    source_dataset: countBy(records.filter((record) => record.source_dataset), (record) => record.source_dataset),
    split: countBy(records, (record) => record.split),
    task_type: countBy(records, (record) => record.task_type),
    service_domain: countBy(records, (record) => record.service_domain),
    length_bucket: countBy(records, (record) => record.length_bucket),
    source_prompt_kind: countBy(records.filter((record) => record.source_prompt_kind), (record) => record.source_prompt_kind),
    source_transform: countBy(records.filter((record) => record.source_transform), (record) => record.source_transform),
  };
}

function expectCounts(records, field, expected, failures) {
  const actual = countBy(records, (record) => record[field]);
  for (const [key, count] of Object.entries(expected)) {
    if (actual[key] !== count) failures.push(`${field}: expected ${key}=${count}, got ${actual[key] ?? 0}`);
  }
}

export function validatePublicRecords(records) {
  const failures = [];
  if (records.length !== 7000) failures.push(`records: expected 7000, got ${records.length}`);
  expectCounts(records, "label", { simple: 3500, complex: 3500 }, failures);
  expectCounts(records, "language", { ko: 4200, en: 2250, mixed: 550 }, failures);
  expectCounts(records, "split", { train: 4900, validation: 1050, test: 1050 }, failures);
  const uniqueFields = ["sample_id", "source_record_id", "group_id"];
  for (const field of uniqueFields) {
    if (new Set(records.map((record) => record[field])).size !== records.length) failures.push(`${field}: duplicates found`);
  }
  if (new Set(records.map((record) => normalizePrompt(record.redacted_prompt))).size !== records.length) {
    failures.push("redacted_prompt: normalized duplicates found");
  }
  for (const record of records) {
    if (record.source !== "public" || record.boundary_case || record.counterexample_type !== null) failures.push(`${record.sample_id}: invalid public source flags`);
    if (record.label_source !== "public_rule_candidate" || record.human_reviewed || record.review_status !== "pending") failures.push(`${record.sample_id}: invalid review state`);
    if (!SOURCE_SPECS[record.source_dataset]) failures.push(`${record.sample_id}: unknown source dataset`);
    const reason = forbiddenReason(record.redacted_prompt);
    if (reason) failures.push(`${record.sample_id}: forbidden ${reason}`);
    if (failures.length > 100) break;
  }
  for (const [language, expected] of Object.entries({ ko: { simple: 2100, complex: 2100 }, en: { simple: 1125, complex: 1125 }, mixed: { simple: 275, complex: 275 } })) {
    expectCounts(records.filter((record) => record.language === language), "label", expected, failures);
  }
  for (const [language, labels] of Object.entries(SPLIT_QUOTAS)) {
    for (const [label, expected] of Object.entries(labels)) {
      expectCounts(records.filter((record) => record.language === language && record.label === label), "split", expected, failures);
    }
  }
  const klueRecords = records.filter((record) => record.source_dataset === "klue_mrc");
  if (klueRecords.some((record) => record.source_transform !== "as_published_field" || record.task_type === "rag_query")) {
    failures.push("klue_mrc: only the published question field is allowed; context serialization and rag_query are forbidden");
  }
  if (records.filter((record) => record.source_human_origin).length < 4200) {
    failures.push("source_human_origin: expected at least 4200 public records");
  }
  if (Math.max(...Object.values(countBy(records, (record) => record.source_dataset))) > 3150) {
    failures.push("source_dataset: one source exceeds the 45% public-component cap");
  }
  if (klueRecords.length > 800) failures.push(`klue_mrc: expected at most 800, got ${klueRecords.length}`);
  if (klueRecords.length === 800) {
    const klueLabelCounts = countBy(klueRecords, (record) => record.label);
    if ((klueLabelCounts.simple ?? 0) < 280 || (klueLabelCounts.complex ?? 0) < 280) {
      failures.push(`klue_mrc: each label must be at least 35%, got ${JSON.stringify(klueLabelCounts)}`);
    }
    const klueLengthAuc = lengthOnlyRocAuc(klueRecords);
    if (klueLengthAuc > 0.55) failures.push(`klue_mrc: length-only ROC-AUC expected <= 0.55, got ${klueLengthAuc.toFixed(4)}`);
  }
  if (new Set(records.map((record) => record.source_dataset)).size < 5) {
    failures.push("source_dataset: expected at least five adopted public sources");
  }
  const publicLength = lengthLabelDistribution(records);
  for (const [bucket, labels] of Object.entries(publicLength)) {
    for (const label of ["simple", "complex"]) {
      const expected = PUBLIC_LENGTH_LABEL_TARGETS[label][bucket];
      if ((labels[label] ?? 0) !== expected) {
        failures.push(`public length ${bucket}/${label}: expected ${expected}, got ${labels[label] ?? 0}`);
      }
    }
  }
  const publicTaskCounts = countBy(records, (record) => record.task_type);
  const topFiveTasks = Object.values(publicTaskCounts).sort((left, right) => right - left).slice(0, 5);
  const topFiveTaskCount = topFiveTasks.reduce((total, count) => total + count, 0);
  if (topFiveTaskCount > PUBLIC_TOP_FIVE_TASK_MAX) {
    failures.push(`public task_type: top five tasks ${topFiveTaskCount} exceed the strict 55% cap`);
  }
  return failures;
}

export function validateBundleRecords(records) {
  const failures = [];
  if (records.length !== 15000) failures.push(`bundle records: expected 15000, got ${records.length}`);
  expectCounts(records, "label", { simple: 7500, complex: 7500 }, failures);
  expectCounts(records, "language", { ko: 12000, en: 2250, mixed: 750 }, failures);
  expectCounts(records, "source", { synthetic: 6000, boundary: 2000, public: 7000 }, failures);
  expectCounts(records, "split", { train: 10500, validation: 2250, test: 2250 }, failures);
  if (new Set(records.map((record) => record.sample_id)).size !== records.length) failures.push("bundle sample_id duplicates found");
  if (new Set(records.map((record) => normalizePrompt(record.redacted_prompt))).size !== records.length) failures.push("bundle normalized prompt duplicates found");
  const splitsByGroup = new Map();
  for (const record of records) {
    if (!splitsByGroup.has(record.group_id)) splitsByGroup.set(record.group_id, new Set());
    splitsByGroup.get(record.group_id).add(record.split);
  }
  if ([...splitsByGroup.values()].some((splits) => splits.size !== 1)) failures.push("bundle group split leak found");
  const taskCounts = countBy(records, (record) => record.task_type);
  for (const taskType of TASK_TYPES) {
    const count = taskCounts[taskType] ?? 0;
    if (count < BUNDLE_TASK_MIN) failures.push(`bundle task_type ${taskType}: expected at least ${BUNDLE_TASK_MIN}, got ${count}`);
    if (count > BUNDLE_TASK_MAX) failures.push(`bundle task_type ${taskType}: expected at most ${BUNDLE_TASK_MAX}, got ${count}`);
    const labels = new Set(records.filter((record) => record.task_type === taskType).map((record) => record.label));
    if (labels.size !== 2) failures.push(`bundle task_type ${taskType}: both labels required`);
    const simpleShare = records.filter((record) => record.task_type === taskType && record.label === "simple").length / count;
    if (simpleShare < 0.35 || simpleShare > 0.65) {
      failures.push(`bundle task_type ${taskType}: simple share ${simpleShare.toFixed(4)} outside 0.35..0.65`);
    }
  }
  const domainCounts = countBy(records, (record) => record.service_domain);
  for (const domain of DOMAINS) {
    const count = domainCounts[domain] ?? 0;
    if (count < BUNDLE_DOMAIN_MIN) failures.push(`bundle service_domain ${domain}: expected at least ${BUNDLE_DOMAIN_MIN}, got ${count}`);
    if (count > BUNDLE_DOMAIN_MAX) failures.push(`bundle service_domain ${domain}: expected at most ${BUNDLE_DOMAIN_MAX}, got ${count}`);
    const labels = new Set(records.filter((record) => record.service_domain === domain).map((record) => record.label));
    if (labels.size !== 2) failures.push(`bundle service_domain ${domain}: both labels required`);
    const simpleShare = records.filter((record) => record.service_domain === domain && record.label === "simple").length / count;
    if (simpleShare < 0.35 || simpleShare > 0.65) {
      failures.push(`bundle service_domain ${domain}: simple share ${simpleShare.toFixed(4)} outside 0.35..0.65`);
    }
  }
  failures.push(...validateLengthGuardrails(records));
  return failures;
}

export function parseJsonl(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`invalid JSONL at line ${index + 1}: ${error.message}`);
      }
    });
}

function sourceManifest() {
  return Object.fromEntries(
    Object.entries(SOURCE_SPECS).map(([name, source]) => [
      name,
      {
        url: source.url,
        license: source.license,
        revision: source.revision,
        anonymous_public_access: true,
        prompt_kind: source.promptKind,
        authorship: source.authorship,
        human_origin: source.humanOrigin,
        direct_human_authored: source.directHumanAuthored,
        real_user: source.realUser,
      },
    ]),
  );
}

export function buildCandidateInventory({ rootDir, cacheDir = path.join(rootDir, ".tmp", "routing-public-sources") }) {
  const readCache = (fileName) => parseJsonl(readFileSync(path.join(cacheDir, fileName), "utf8"));
  const enterpriseText = readFileSync(path.join(rootDir, ...ENTERPRISE_DATASET_PATH.split("/")), "utf8");
  const enterpriseRecords = parseJsonl(enterpriseText);
  const stats = { examined: {}, rejected: {}, deduplication: {} };
  const dollyRows = readCache(SOURCE_SPECS.databricks_dolly_15k.cache);
  const candidatePools = {
    klue_mrc: buildKlueCandidates(readCache(SOURCE_SPECS.klue_mrc.cache), stats),
    kite: buildKiteCandidates(readCache(SOURCE_SPECS.kite.cache), stats),
    aya_dataset: buildAyaCandidates(readCache(SOURCE_SPECS.aya_dataset.cache), stats),
    k2_eval: buildK2Candidates(readCache(SOURCE_SPECS.k2_eval.cache), stats),
    hrm8k_ksm: buildHrm8kCandidates(readCache(SOURCE_SPECS.hrm8k_ksm.cache), stats),
    haerae_bench_2: buildHaeraeBench2Candidates(readCache(SOURCE_SPECS.haerae_bench_2.cache), stats),
    openassistant_oasst1: buildOasstCandidates(readCache(SOURCE_SPECS.openassistant_oasst1.cache), stats),
    databricks_dolly_15k: buildDollyCandidates(dollyRows, stats),
    kullm_v2_dolly: buildKullmDollyCandidates(readCache(SOURCE_SPECS.kullm_v2_dolly.cache), dollyRows, stats),
  };
  return { candidatePools, enterpriseRecords, enterpriseText, stats };
}

export function candidateInventorySummary(options) {
  const { candidatePools } = buildCandidateInventory(options);
  const rows = Object.values(candidatePools).flat().map((item) => ({
    source_dataset: item.sourceDataset,
    language: item.language,
    task_type: taskTypeFor(item.prompt, item),
    service_domain: domainFor(item.prompt, item),
    length_bucket: lengthBucket(item.prompt),
    difficulty_score: item.difficultyScore,
  }));
  return {
    records: rows.length,
    source_dataset: countBy(rows, (row) => row.source_dataset),
    language: countBy(rows, (row) => row.language),
    task_type: countBy(rows, (row) => row.task_type),
    service_domain: countBy(rows, (row) => row.service_domain),
    length_bucket: countBy(rows, (row) => row.length_bucket),
  };
}

export function buildArtifacts({ rootDir, cacheDir = path.join(rootDir, ".tmp", "routing-public-sources") }) {
  const { candidatePools, enterpriseRecords, enterpriseText, stats } = buildCandidateInventory({ rootDir, cacheDir });
  const selected = assignSplits(
    selectCandidates(candidatePools, enterpriseRecords, stats),
  );
  const records = selected
    .map(toRecord)
    .sort((left, right) => left._sort.localeCompare(right._sort))
    .map(({ _sort, ...record }) => record);
  const failures = validatePublicRecords(records);
  if (failures.length) throw new Error(`public dataset validation failed:\n- ${failures.join("\n- ")}`);
  const datasetText = `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const directHumanAuthoredRecords = records.filter((record) => record.source_direct_human_authored).length;
  const humanOriginRecords = records.filter((record) => record.source_human_origin).length;
  const realUserRecords = records.filter((record) => record.source_real_user).length;
  const klueRecords = records.filter((record) => record.source_dataset === "klue_mrc");
  const directHumanTarget = 4200;
  const directHumanGap = Math.max(0, directHumanTarget - directHumanAuthoredRecords);
  const publicTaskCounts = countBy(records, (record) => record.task_type);
  const publicTopFiveTaskRecords = Object.values(publicTaskCounts)
    .sort((left, right) => right - left)
    .slice(0, 5)
    .reduce((total, count) => total + count, 0);
  const manifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    dataset_version: DATASET_VERSION,
    record_schema_version: RECORD_SCHEMA_VERSION,
    record_schema_path: RECORD_SCHEMA_PATH,
    dataset_path: DATASET_PATH,
    dataset_sha256: sha256(datasetText),
    generated_at: GENERATED_AT,
    generation_seed: GENERATION_SEED,
    scope: {
      initial_target_records: 15000,
      generated_records: 7000,
      deferred_public_records: 0,
      public_records: 7000,
      training_eligible: false,
      training_blockers: [
        "rule_assisted_labels_not_human_reviewed",
        "adjudication_not_completed",
        "direct_human_authored_share_below_60_percent",
        "anonymous_real_user_source_unavailable_without_additional_approval",
      ],
    },
    counts: {
      records: 7000,
      groups: 7000,
      public_records: 7000,
      synthetic_records: 0,
      boundary_records: 0,
      human_reviewed_records: 0,
      human_origin_records: humanOriginRecords,
      direct_human_authored_records: directHumanAuthoredRecords,
      real_user_records: realUserRecords,
    },
    distributions: distributions(records),
    coverage: {
      task_types_present: new Set(records.map((record) => record.task_type)).size,
      service_domains_present: new Set(records.map((record) => record.service_domain)).size,
      every_language_has_both_labels: true,
      exact_language_target_for_initial_15000: true,
      public_human_origin_share: humanOriginRecords / records.length,
      public_direct_human_authored_share: directHumanAuthoredRecords / records.length,
      public_real_user_share: realUserRecords / records.length,
      direct_human_authored_target_records: directHumanTarget,
      direct_human_authored_gap_records: directHumanGap,
      direct_human_authored_60_percent_met: directHumanGap === 0,
      single_public_source_cap: 0.45,
      full_dataset_single_task_enforced_cap: BUNDLE_TASK_MAX / 15000,
      public_top_five_task_records: publicTopFiveTaskRecords,
      public_top_five_task_share: publicTopFiveTaskRecords / records.length,
      public_top_five_task_strict_55_percent_met: publicTopFiveTaskRecords / records.length <= 0.55,
      public_top_five_task_enforced_cap: PUBLIC_TOP_FIVE_TASK_MAX / records.length,
      length_label_distribution: lengthLabelDistribution(records),
      length_only_roc_auc: lengthOnlyRocAuc(records),
      klue_records: klueRecords.length,
      klue_label_distribution: countBy(klueRecords, (record) => record.label),
      klue_length_only_roc_auc: lengthOnlyRocAuc(klueRecords),
      klue_context_serialization_records: 0,
      klue_rag_query_records: 0,
      semantic_embedding_dedup_audit_path: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.semantic-dedup.json",
      semantic_embedding_dedup_threshold: 0.985,
      semantic_embedding_dedup_verified: true,
    },
    deduplication: {
      exact_duplicate_records: 0,
      normalized_duplicate_records: 0,
      accepted_near_duplicate_pairs: 0,
      removed_exact_candidates: stats.deduplication.exact,
      removed_near_duplicate_candidates: stats.deduplication.near,
      method: "normalized exact match plus 48-value MinHash LSH and token-unigram/bigram Jaccard",
      near_duplicate_threshold: 0.9,
      compared_against_enterprise_8000: true,
    },
    review: {
      label_source: "public_rule_candidate",
      review_status: "pending",
      human_reviewed: false,
      production_gold: false,
    },
    sources: sourceManifest(),
    filtering: {
      examined_records: stats.examined,
      rejected_candidates: stats.rejected,
      selection_rejected_candidates: stats.selectionRejected,
      system_assistant_tool_messages_included: 0,
      source_answers_included: 0,
      raw_source_user_identifiers_included: 0,
    },
  };

  const bundleRecords = [...enterpriseRecords, ...records];
  const bundleFailures = validateBundleRecords(bundleRecords);
  if (bundleFailures.length) throw new Error(`bundle validation failed:\n- ${bundleFailures.join("\n- ")}`);
  const bundleText = `${bundleRecords.map((record) => JSON.stringify(record)).join("\n")}\n`;
  const bundleTaskCounts = countBy(bundleRecords, (record) => record.task_type);
  const bundleDomainCounts = countBy(bundleRecords, (record) => record.service_domain);
  const bundleTaskValues = Object.values(bundleTaskCounts);
  const bundleDomainValues = Object.values(bundleDomainCounts);
  const bundleManifest = {
    schema_version: MANIFEST_SCHEMA_VERSION,
    dataset_version: BUNDLE_VERSION,
    record_schema_version: RECORD_SCHEMA_VERSION,
    record_schema_path: RECORD_SCHEMA_PATH,
    dataset_path: BUNDLE_PATH,
    dataset_sha256: sha256(bundleText),
    generated_at: GENERATED_AT,
    generation_seed: GENERATION_SEED,
    scope: {
      initial_target_records: 15000,
      generated_records: 15000,
      deferred_public_records: 0,
      public_records: 7000,
      training_eligible: false,
      training_blockers: [
        "rule_assisted_labels_not_human_reviewed",
        "adjudication_not_completed",
        "direct_human_authored_share_below_60_percent",
        "anonymous_real_user_source_unavailable_without_additional_approval",
      ],
    },
    counts: {
      records: 15000,
      groups: new Set(bundleRecords.map((record) => record.group_id)).size,
      public_records: 7000,
      synthetic_records: 6000,
      boundary_records: 2000,
      human_reviewed_records: 0,
      public_human_origin_records: humanOriginRecords,
      public_direct_human_authored_records: directHumanAuthoredRecords,
      public_real_user_records: realUserRecords,
    },
    distributions: distributions(bundleRecords),
    coverage: {
      task_types_present: new Set(bundleRecords.map((record) => record.task_type)).size,
      service_domains_present: new Set(bundleRecords.map((record) => record.service_domain)).size,
      every_language_has_both_labels: true,
      language_ratio: "80:15:5",
      label_ratio: "1:1",
      klue_length_label_proxy_control: true,
      klue_records: klueRecords.length,
      klue_label_distribution: countBy(klueRecords, (record) => record.label),
      klue_length_only_roc_auc: lengthOnlyRocAuc(klueRecords),
      public_human_origin_share: humanOriginRecords / records.length,
      public_direct_human_authored_share: directHumanAuthoredRecords / records.length,
      public_real_user_share: realUserRecords / records.length,
      direct_human_authored_gap_records: directHumanGap,
      length_label_distribution: lengthLabelDistribution(bundleRecords),
      length_only_roc_auc: lengthOnlyRocAuc(bundleRecords),
      long_records: bundleRecords.filter((record) => record.length_bucket === "long").length,
      long_simple_records: bundleRecords.filter((record) => record.length_bucket === "long" && record.label === "simple").length,
      long_complex_records: bundleRecords.filter((record) => record.length_bucket === "long" && record.label === "complex").length,
      task_type_min_records: Math.min(...bundleTaskValues),
      task_type_max_records: Math.max(...bundleTaskValues),
      task_type_max_share: Math.max(...bundleTaskValues) / bundleRecords.length,
      task_type_enforced_range: `${BUNDLE_TASK_MIN}..${BUNDLE_TASK_MAX}`,
      task_type_strict_400_to_900_target_met: Math.min(...bundleTaskValues) >= 400 && Math.max(...bundleTaskValues) <= 900,
      service_domain_min_records: Math.min(...bundleDomainValues),
      service_domain_max_records: Math.max(...bundleDomainValues),
      service_domain_max_share: Math.max(...bundleDomainValues) / bundleRecords.length,
      service_domain_enforced_range: `${BUNDLE_DOMAIN_MIN}..${BUNDLE_DOMAIN_MAX}`,
      service_domain_strict_12_5_percent_cap_met: Math.max(...bundleDomainValues) / bundleRecords.length <= 0.125,
      public_top_five_task_records: publicTopFiveTaskRecords,
      public_top_five_task_share: publicTopFiveTaskRecords / records.length,
      public_top_five_task_strict_55_percent_met: publicTopFiveTaskRecords / records.length <= 0.55,
      every_task_type_label_share_between_35_and_65_percent: true,
      every_service_domain_label_share_between_35_and_65_percent: true,
      semantic_embedding_dedup_audit_path: "docs/routing/datasets/difficulty/data/initial-routing-difficulty-15000.semantic-dedup.json",
      semantic_embedding_dedup_threshold: 0.985,
      semantic_embedding_dedup_verified: true,
    },
    deduplication: {
      exact_duplicate_records: 0,
      normalized_duplicate_records: 0,
      group_split_leaks: 0,
      public_candidates_compared_against_enterprise_8000: true,
      semantic_duplicate_candidate_pairs: 0,
      semantic_duplicate_method: "pinned multilingual-E5 native 384D cosine plus same-label/task/domain candidate policy",
      semantic_duplicate_threshold: 0.985,
    },
    review: {
      review_status: "pending",
      human_reviewed: false,
      production_gold: false,
    },
    components: [
      {
        dataset_version: "routing_difficulty_enterprise_synthetic_8000_rebalanced_2026_07_21",
        dataset_path: ENTERPRISE_DATASET_PATH,
        records: 8000,
        sha256: sha256(enterpriseText),
      },
      { dataset_version: DATASET_VERSION, dataset_path: DATASET_PATH, records: 7000, sha256: sha256(datasetText) },
    ],
  };
  return {
    records,
    manifest,
    datasetText,
    manifestText: `${JSON.stringify(manifest, null, 2)}\n`,
    bundleRecords,
    bundleManifest,
    bundleText,
    bundleManifestText: `${JSON.stringify(bundleManifest, null, 2)}\n`,
  };
}

export function verifyPersistedArtifacts(datasetText, manifest, bundleText, bundleManifest) {
  const records = parseJsonl(datasetText);
  const bundleRecords = parseJsonl(bundleText);
  const failures = [
    ...validatePublicRecords(records),
    ...validateBundleRecords(bundleRecords),
  ];
  if (manifest.dataset_sha256 !== sha256(datasetText)) failures.push("public manifest hash mismatch");
  if (bundleManifest.dataset_sha256 !== sha256(bundleText)) failures.push("bundle manifest hash mismatch");
  if (manifest.scope?.training_eligible !== false || bundleManifest.scope?.training_eligible !== false) failures.push("datasets must remain training-ineligible");
  return failures;
}

export const DATASET_DIMENSIONS = { taskTypes: TASK_TYPES, domains: DOMAINS, splitQuotas: SPLIT_QUOTAS };
