package routing

import "unicode/utf8"

type CommonDifficultyFeatures struct {
	payloadSizeBucket string
	taskCount         int
	constraintCount   int
	scopeCount        int
	dependencyDepth   int
}

type GeneralDifficultyFeatures struct {
	workflowDepth           int
	branchOrExceptionCount  int
	extractionBreadth       int
	hasCrossSourceSynthesis bool
}

type CodeDifficultyFeatures struct {
	codeOperationKind          string
	codeScopeBreadth           int
	causalComplexity           int
	engineeringConstraintCount int
}

type TranslationDifficultyFeatures struct {
	translationScopeCount       int
	preservationConstraintCount int
	domainTerminologyLevel      int
	localizationDegree          int
}

type SummarizationDifficultyFeatures struct {
	sourceBreadth              int
	synthesisLevel             int
	facetCount                 int
	hasTraceabilityConstraints bool
}

type ReasoningDifficultyFeatures struct {
	alternativeCount           int
	criteriaAndConstraintCount int
	reasoningDepth             int
	uncertaintyScenarioCount   int
}

// DifficultyFeatures contains common complexity evidence and only the
// selected category's feature set. Exactly one category pointer is non-nil.
type DifficultyFeatures struct {
	category                 string
	common                   CommonDifficultyFeatures
	semanticInstructionEmpty bool

	general       *GeneralDifficultyFeatures
	code          *CodeDifficultyFeatures
	translation   *TranslationDifficultyFeatures
	summarization *SummarizationDifficultyFeatures
	reasoning     *ReasoningDifficultyFeatures
}

type DifficultyResult struct {
	ComplexityScore float64
	Difficulty      string
}

// DifficultyClassifier applies the inactive hybrid difficulty policy used by
// offline and shadow evaluation. Product runtime continues to use
// RuleBasedDifficultyClassifier until the promotion gates pass.
type DifficultyClassifier struct {
	vectorizer func(DifficultyFeatures) []float64
	model      *difficultyLogisticModel
	calibrator difficultyCalibrator
	threshold  float64
}

func NewDifficultyClassifier(material DifficultyClassifierMaterial) (DifficultyClassifier, error) {
	model, err := newDifficultyLogisticModel(material)
	if err != nil {
		return DifficultyClassifier{}, err
	}
	return newDifficultyClassifier(model), nil
}

func newDifficultyClassifier(model difficultyLogisticModel) DifficultyClassifier {
	return DifficultyClassifier{
		vectorizer: VectorizeDifficultyFeaturesV1,
		model:      &model,
		calibrator: model.calibrator,
		threshold:  model.threshold,
	}
}

func (classifier DifficultyClassifier) ClassifyFeatures(features DifficultyFeatures) DifficultyResult {
	if isMeaninglessDifficultyInput(features) {
		return DifficultyResult{
			ComplexityScore: 0,
			Difficulty:      DifficultySimple,
		}
	}

	if hasHardComplexEvidence(features) {
		return DifficultyResult{
			ComplexityScore: 1,
			Difficulty:      DifficultyComplex,
		}
	}

	vector := classifier.vectorizer(features)
	rawScore, err := classifier.model.score(vector)
	if err != nil {
		// The v1 constructor and canonical vectorizer make this unreachable in
		// normal use. Keep the inactive shadow path fail closed rather than
		// allowing malformed internal material to panic or weaken difficulty.
		return DifficultyResult{ComplexityScore: 1, Difficulty: DifficultyComplex}
	}
	calibratedScore := classifier.calibrator.calibrate(rawScore)

	return DifficultyResult{
		ComplexityScore: calibratedScore,
		Difficulty:      difficultyFromScore(calibratedScore, classifier.threshold),
	}
}

func difficultyFromScore(score float64, threshold float64) string {
	if score >= threshold {
		return DifficultyComplex
	}
	return DifficultySimple
}

func isMeaninglessDifficultyInput(features DifficultyFeatures) bool {
	return features.semanticInstructionEmpty || features.common.payloadSizeBucket == "empty"
}

// UsesDifficultyModelPath is exposed only for approved offline training and
// evaluation tooling so calibration data follows the same deterministic
// bypass boundary as DifficultyClassifier.
func UsesDifficultyModelPath(features DifficultyFeatures) bool {
	return !isMeaninglessDifficultyInput(features) && !hasHardComplexEvidence(features)
}

const (
	DifficultyDecisionRouteSimpleSentinel = "simple_sentinel"
	DifficultyDecisionRouteHardSentinel   = "hard_sentinel"
	DifficultyDecisionRouteModel          = "model"
)

// DifficultyDecisionEvidence contains only bounded, low-cardinality reason
// codes and scores. It is safe for approved offline audits and deliberately
// excludes prompt text and individual feature values.
type DifficultyDecisionEvidence struct {
	Route                 string `json:"route"`
	CommonEvidenceScore   int    `json:"commonEvidenceScore"`
	CategoryEvidenceScore int    `json:"categoryEvidenceScore"`
}

// DifficultyDecisionEvidenceForOffline exposes the canonical deterministic
// bypass decision without exposing request text or mutable classifier state.
func DifficultyDecisionEvidenceForOffline(features DifficultyFeatures) DifficultyDecisionEvidence {
	if isMeaninglessDifficultyInput(features) {
		return DifficultyDecisionEvidence{Route: DifficultyDecisionRouteSimpleSentinel}
	}
	commonScore := commonComplexityEvidenceScore(features.common)
	categoryScore := categoryComplexityEvidenceScore(features)
	if commonScore+categoryScore >= hardComplexCombinedEvidenceThreshold {
		return DifficultyDecisionEvidence{
			Route:                 DifficultyDecisionRouteHardSentinel,
			CommonEvidenceScore:   commonScore,
			CategoryEvidenceScore: categoryScore,
		}
	}
	return DifficultyDecisionEvidence{
		Route:                 DifficultyDecisionRouteModel,
		CommonEvidenceScore:   commonScore,
		CategoryEvidenceScore: categoryScore,
	}
}

func ExtractDifficultyFeatures(features PromptFeatures, category string) DifficultyFeatures {
	category = canonicalCategory(category)
	_, semanticInputAvailable := difficultyEmbeddingInput(features)
	common := CommonDifficultyFeatures{
		payloadSizeBucket: routingPayloadSizeBucket(features),
		taskCount:         features.taskCount,
		constraintCount:   features.constraintCount,
		scopeCount:        features.scopeCount,
		dependencyDepth:   features.dependencyDepth,
	}
	result := DifficultyFeatures{
		category:                 category,
		common:                   common,
		semanticInstructionEmpty: !semanticInputAvailable,
	}

	switch category {
	case CategoryCode:
		value := extractCodeDifficultyFeatures(features, common)
		result.code = &value
	case CategoryTranslation:
		value := extractTranslationDifficultyFeatures(features, common)
		result.translation = &value
	case CategorySummarization:
		value := extractSummarizationDifficultyFeatures(features, common)
		result.summarization = &value
	case CategoryReasoning:
		value := extractReasoningDifficultyFeatures(features, common)
		result.reasoning = &value
	default:
		value := extractGeneralDifficultyFeatures(features, common)
		result.general = &value
	}

	return result
}

type RuleBasedDifficultyClassifier struct{}

func NewRuleBasedDifficultyClassifier() RuleBasedDifficultyClassifier {
	return RuleBasedDifficultyClassifier{}
}

func (RuleBasedDifficultyClassifier) ClassifyFeatures(features DifficultyFeatures) DifficultyResult {
	if isMeaninglessDifficultyInput(features) {
		return DifficultyResult{Difficulty: DifficultySimple}
	}
	if hasSingleProxyBoundedSimpleEvidence(features) {
		return DifficultyResult{Difficulty: DifficultySimple}
	}
	if hasRuleComplexEvidence(features) {
		return DifficultyResult{Difficulty: DifficultyComplex}
	}
	if hasBoundedSimpleEvidence(features) {
		return DifficultyResult{Difficulty: DifficultySimple}
	}

	// Ambiguous requests still fail closed to complex. The bounded single-proxy
	// exception above prevents payload size or operation kind from forcing an
	// otherwise simple request to complex by itself.
	return DifficultyResult{Difficulty: DifficultyComplex}
}

// Classify is a compatibility wrapper.
//
// Deprecated: new runtime and evaluation code must pass PromptFeatures through
// ExtractDifficultyFeatures and ClassifyFeatures.
func (classifier RuleBasedDifficultyClassifier) Classify(prompt string, category string) string {
	features := ExtractPromptFeatures(prompt)
	difficultyFeatures := ExtractDifficultyFeatures(features, category)
	return classifier.ClassifyFeatures(difficultyFeatures).Difficulty
}

func routingPayloadSizeBucket(features PromptFeatures) string {
	if features.isMeaningless {
		return "empty"
	}
	payload := features.payloadText
	if payload == "" {
		payload = features.normalizedText
	}
	switch runeLength := utf8.RuneCountInString(payload); {
	case runeLength == 0:
		return "empty"
	case runeLength <= 120:
		return "small"
	case runeLength <= 800:
		return "medium"
	default:
		return "large"
	}
}

func extractGeneralDifficultyFeatures(features PromptFeatures, common CommonDifficultyFeatures) GeneralDifficultyFeatures {
	text := difficultyInstructionText(features)
	workflowDepth := maxInt(common.dependencyDepth, countMatchedRoutingPhraseFamilies(text, [][]string{
		{"step by step", "workflow", "procedure", "rollout", "단계별", "절차", "처리 순서", "전환안", "운영 흐름"},
		{"preparation", "prepare", "prerequisite", "준비", "준비 조건", "선행 조건"},
		{"execution", "execute", "실행", "수행"},
		{"verification", "verify", "completion check", "completion verification", "확인 단계", "완료 여부", "완료 조건", "완료 검증"},
		{"owner for each stage", "each stage", "각 단계", "단계의 담당자"},
	}))
	return GeneralDifficultyFeatures{
		workflowDepth: workflowDepth,
		branchOrExceptionCount: minInt(countMatchedRoutingPhraseFamilies(text, [][]string{
			{"if", "unless", "otherwise", "경우", "이면", "라면"},
			{"normal path", "happy path", "정상 경로"},
			{"exception", "exception path", "exception situation", "예외", "예외 상황", "예외별"},
			{"failure", "failure path", "실패", "실패 시"},
			{"fallback", "fallback path", "alternative path", "대체 경로", "복구 경로"},
			{"stop condition", "stop conditions", "중단 기준"},
			{"before approval", "승인 전이면", "승인 전"},
			{"after approval", "승인 후면", "승인 후"},
			{"when delayed", "delayed", "지연 중이면", "지연 중"},
		}), 5),
		extractionBreadth: minInt(countDistinctPhrases(text, []string{
			"field", "column", "key/value", "status", "owner", "deadline", "date", "priority",
			"필드", "열", "상태", "담당자", "마감일", "날짜", "우선순위", "요청사항",
		}), 6),
		hasCrossSourceSynthesis: hasAnyPhrase(text, []string{
			"across sources", "multiple sources", "several teams", "multiple teams", "combine information", "combine the policies", "identify missing items",
			"여러 자료", "여러 정책", "여러 부서", "여러 팀", "자료에서 모아", "자료를 종합", "정보를 합치", "누락 항목", "문의들을 종합",
		}),
	}
}

func extractCodeDifficultyFeatures(features PromptFeatures, common CommonDifficultyFeatures) CodeDifficultyFeatures {
	text := difficultyInstructionText(features)
	scope := common.scopeCount
	if hasAnyPhrase(text, []string{"multi-file", "multiple files", "여러 파일"}) {
		scope = maxInt(scope, 2)
	}
	if hasAnyPhrase(text, []string{"distributed system", "cross-service", "multiple services", "분산 시스템", "여러 서비스"}) {
		scope = maxInt(scope, 3)
	}
	return CodeDifficultyFeatures{
		codeOperationKind: codeOperationKind(text),
		codeScopeBreadth:  scope,
		causalComplexity: minInt(countMatchedRoutingPhraseFamilies(text, [][]string{
			{"reproduction condition", "reproduce condition", "reproduce", "재현 조건", "재현"},
			{"root cause", "likely cause", "narrow the cause", "possible cause", "원인", "가능한 원인", "원인을 좁"},
			{"race condition", "deadlock", "concurrency", "경쟁 조건", "경쟁 상태", "교착", "동시성"},
			{"intermittent", "occasionally", "fails intermittently", "간헐적", "가끔만 실패", "가끔 실패"},
			{"state transition", "state interaction", "상태 전이", "상태 상호작용"},
			{"instrumentation", "observability", "hypothesis", "log location", "계측", "관측", "가설 검증", "로그를 늘릴 위치", "로그 위치"},
		}), 4),
		engineeringConstraintCount: minInt(countMatchedRoutingPhraseFamilies(text, [][]string{
			{"preserve behavior", "preserving behavior", "existing behavior", "기존 동작", "동작 유지"},
			{"error handling", "failure handling", "오류 처리", "실패 처리"},
			{"performance", "performance limit", "performance budget", "성능", "성능 한도"},
			{"security", "보안"},
			{"compatibility", "backward compatible", "version compatibility", "호환", "버전 호환"},
			{"test boundary", "regression test", "테스트 경계", "회귀 테스트"},
			{"zero downtime", "rolling deployment", "무중단", "롤링 배포"},
			{"preserve ordering", "ordering", "순서 보장"},
			{"duplicate prevention", "deduplication", "중복 처리 방지", "중복 방지"},
			{"safe rollback", "rollback condition", "안전한 롤백", "롤백 조건"},
			{"rollout", "migration safety", "배포", "마이그레이션 안전"},
		}), 6),
	}
}

func codeOperationKind(text string) string {
	switch {
	case hasAnyPhrase(text, []string{"valid syntax", "exact syntax", "정확한 문법", "올바른 문법"}):
		return "syntax"
	case hasAnyPhrase(text, []string{"architecture", "system design", "아키텍처", "시스템 설계"}):
		return "design"
	case hasAnyPhrase(text, []string{"migration", "마이그레이션"}):
		return "migration"
	case hasAnyPhrase(text, []string{"race condition", "deadlock", "concurrency", "경쟁 조건", "경쟁 상태", "교착", "동시성"}):
		return "concurrency"
	case hasAnyPhrase(text, []string{"refactor", "리팩터", "리팩토링"}):
		return "refactor"
	case hasAnyPhrase(text, []string{"performance", "optimize", "성능", "최적화"}):
		return "performance"
	case hasAnyPhrase(text, []string{"syntax", "문법"}):
		return "syntax"
	case hasAnyPhrase(text, []string{"example", "예시"}):
		return "example"
	case hasAnyPhrase(text, []string{"one function", "small edit", "single api", "함수 하나", "작은 수정", "단일 api"}):
		return "small_edit"
	case hasAnyPhrase(text, []string{
		"debug", "root cause", "likely cause", "reproduce", "diagnose", "intermittent", "test failure",
		"디버깅", "버그", "원인을 좁", "재현", "진단", "간헐적", "가끔만 실패", "테스트 실패",
	}):
		return "debug"
	default:
		return "unknown"
	}
}

func extractTranslationDifficultyFeatures(features PromptFeatures, common CommonDifficultyFeatures) TranslationDifficultyFeatures {
	text := difficultyInstructionText(features)
	targetCount := translationTargetLanguageCount(text)
	translationScope := maxInt(targetCount, 1)
	if hasAnyPhrase(text, []string{
		"multiple sentences", "multiple paragraphs", "multiple documents", "multiple files", "여러 문장", "여러 문단", "여러 문서", "여러 파일",
	}) {
		translationScope = maxInt(translationScope, maxInt(common.scopeCount, 2))
	}
	return TranslationDifficultyFeatures{
		translationScopeCount: translationScope,
		preservationConstraintCount: minInt(countMatchedRoutingPhraseFamilies(text, [][]string{
			{"defined term", "defined terms", "정의된 용어", "정의 용어"},
			{"terminology", "glossary", "standardize terminology", "전문 용어", "전문용어", "법률 용어", "용어집", "용어 통일"},
			{"modal verb", "regulatory meaning", "legal meaning", "의무 표현", "규제 의미", "법적 의미"},
			{"cross-reference", "cross reference", "internal reference", "상호 참조", "내부 참조"},
			{"numbering", "numbering system", "번호 체계", "번호 유지"},
			{"unit", "dosage unit", "단위"},
			{"placeholder", "substitution variable", "variable", "플레이스홀더", "치환 변수", "변수 보존"},
			{"formatting", "format", "table", "markdown", "서식", "형식", "표", "마크다운"},
			{"formal tone", "informal tone", "preserve tone", "brand voice", "말투", "존댓말", "반말", "톤 유지", "브랜드 말투"},
			{"flag ambiguities", "ambiguous expression", "애매한 표현", "모호한 표현"},
		}), 7),
		domainTerminologyLevel: translationDomainTerminologyLevel(text),
		localizationDegree:     translationLocalizationDegree(text),
	}
}

func translationTargetLanguageCount(text string) int {
	count := 0
	for _, languagePhrases := range [][]string{
		{"to korean", "into korean", "한국어로", "한글로"},
		{"to english", "into english", "영어로", "영문으로", "영문화"},
		{"to japanese", "into japanese", "일본어로"},
		{"to chinese", "into chinese", "중국어로"},
		{"to spanish", "into spanish", "스페인어로"},
		{"to french", "into french", "프랑스어로"},
		{"to german", "into german", "독일어로"},
	} {
		if hasAnyPhrase(text, languagePhrases) {
			count++
		}
	}
	return count
}

func translationDomainTerminologyLevel(text string) int {
	if hasAnyPhrase(text, []string{"legal", "medical", "contract", "regulatory", "법률", "의료", "계약", "규제"}) {
		return 2
	}
	if hasAnyPhrase(text, []string{"technical", "developer", "business", "product terminology", "기술", "개발자", "비즈니스", "제품 용어"}) {
		return 1
	}
	return 0
}

func translationLocalizationDegree(text string) int {
	if hasAnyPhrase(text, []string{"no localization", "without localization", "localization is not needed", "현지화는 필요 없어", "현지화 없이", "별도 현지화는 필요 없"}) {
		return 0
	}
	if hasAnyPhrase(text, []string{"localize", "localization", "cultural adaptation", "현지화", "문화에 맞게"}) {
		return 2
	}
	if hasAnyPhrase(text, []string{"naturally", "product tone", "audience", "자연스럽게", "제품 톤", "고객에게 맞게"}) {
		return 1
	}
	return 0
}

func extractSummarizationDifficultyFeatures(features PromptFeatures, common CommonDifficultyFeatures) SummarizationDifficultyFeatures {
	text := difficultyInstructionText(features)
	sourceBreadth := payloadBucketRank(common.payloadSizeBucket)
	if hasAnyPhrase(text, []string{"long report", "long document", "긴 보고서", "긴 문서"}) {
		sourceBreadth = maxInt(sourceBreadth, 3)
	}
	if hasAnyPhrase(text, []string{
		"multiple documents", "three documents", "multi-document", "three teams", "several teams", "multiple teams", "multiple interviews", "several meetings", "three regions", "multiple research notes", "quarter of meeting notes", "multiple sprint retros",
		"여러 문서", "세 문서", "다중 문서", "세 팀", "여러 팀", "여러 부서", "여러 인터뷰", "여러 회의", "여러 지역", "장기간 프로젝트 기록", "여러 sprint retro",
	}) {
		sourceBreadth = maxInt(sourceBreadth, maxInt(common.scopeCount, 2))
	}
	return SummarizationDifficultyFeatures{
		sourceBreadth:  sourceBreadth,
		synthesisLevel: summarizationSynthesisLevel(text),
		facetCount: minInt(countMatchedRoutingPhraseFamilies(text, [][]string{
			{"decision", "decisions", "결정 사항", "결정사항", "의사결정"},
			{"evidence", "grounds", "근거"},
			{"unresolved", "unresolved item", "미해결", "미완료"},
			{"agreement", "consensus", "합의점", "합의"},
			{"conflict", "contradiction", "disagreement", "충돌", "모순", "상충"},
			{"action item", "follow-up", "후속 조치", "액션아이템"},
			{"owner", "unowned action", "담당자", "주인 없는 작업", "담당자 없는 작업"},
			{"date", "schedule", "timeline", "날짜", "일정", "시간 순서"},
			{"risk", "uncertainty", "위험", "불확실성"},
			{"trend", "trends", "change trend", "추세", "변화 추세"},
			{"exception", "key exception", "예외", "핵심 예외"},
		}), 7),
		hasTraceabilityConstraints: hasAnyPhrase(text, []string{
			"citation", "citations", "source mapping", "source link", "evidence source", "evidence reference", "traceability",
			"인용", "출처", "출처 연결", "근거 출처", "근거 연결", "근거 목록", "문서별 근거",
		}),
	}
}

func summarizationSynthesisLevel(text string) int {
	if hasAnyPhrase(text, []string{"trend", "trends", "change trend", "추세", "변화 추세"}) &&
		hasAnyPhrase(text, []string{"exception", "uncertainty", "예외", "불확실성"}) {
		return 2
	}
	if hasAnyPhrase(text, []string{"timeline", "time order", "시간 순서"}) &&
		hasAnyPhrase(text, []string{"contradiction", "contradictory", "모순", "상충"}) {
		return 2
	}
	if hasAnyPhrase(text, []string{
		"comparative", "compare and summarize", "synthesize", "common pattern", "common patterns", "disagreement", "unresolved conflict", "deduplicate", "consolidate",
		"비교 요약", "공통 흐름", "종합", "충돌점", "충돌 지점", "중복 제거", "중복 없이", "의견 차이", "합의되지 않은",
	}) {
		return 2
	}
	if hasAnyPhrase(text, []string{"group by", "structured table", "by decisions", "구분해", "표로", "항목별", "결정 사항별"}) {
		return 1
	}
	return 0
}

func extractReasoningDifficultyFeatures(features PromptFeatures, common CommonDifficultyFeatures) ReasoningDifficultyFeatures {
	text := difficultyInstructionText(features)
	alternativeCount := 1
	if hasAnyPhrase(text, []string{"option", "alternative", "candidate", "plan", "strategy", "대안", "후보", "방식", "계획", "전략"}) {
		alternativeCount = maxInt(alternativeCount, common.scopeCount)
	}
	if hasAnyPhrase(text, []string{"option and backup", "choice and backup", "primary and fallback", "선택과 차선책", "기본값과 대체값"}) {
		alternativeCount = maxInt(alternativeCount, 2)
	}
	criteriaCount := countMatchedRoutingPhraseFamilies(text, [][]string{
		{"criteria", "preference", "기준", "선호 기준"},
		{"constraint", "hard constraint", "제약", "필수 제약"},
		{"cost", "budget", "budget limit", "비용", "예산", "예산 제한"},
		{"risk", "failure cost", "위험", "실패 비용"},
		{"schedule", "일정"},
		{"quality", "accuracy", "품질", "정확도"},
		{"latency", "response time", "지연", "응답 시간"},
		{"security", "보안"},
		{"prerequisite", "dependency", "선행 조건", "의존 관계"},
	})
	reasoningDepth := common.dependencyDepth
	if hasAnyPhrase(text, []string{"multi-step", "step by step", "justify", "failure path", "단계적으로", "단계별", "근거를 설명", "실패 경로", "복구 경로"}) {
		reasoningDepth = maxInt(reasoningDepth, 2)
	}
	return ReasoningDifficultyFeatures{
		alternativeCount:           alternativeCount,
		criteriaAndConstraintCount: maxInt(common.constraintCount, criteriaCount),
		reasoningDepth:             reasoningDepth,
		uncertaintyScenarioCount: minInt(countMatchedRoutingPhraseFamilies(text, [][]string{
			{"uncertain", "uncertainty", "불확실", "불확실성"},
			{"scenario", "optimistic", "baseline scenario", "pessimistic", "시나리오", "낙관", "기준 시나리오", "비관"},
			{"tradeoff", "trade-off", "conflicting", "트레이드오프", "상충"},
			{"failure path", "failure probability", "risk", "실패 경로", "실패 확률", "위험"},
			{"assumption", "sensitive assumption", "가정", "민감한 가정"},
			{"change the conclusion", "reversing", "reverse", "결론이 바뀌", "결론을 바꾸", "뒤집힐 때", "결론 변화"},
		}), 6),
	}
}

func difficultyInstructionText(features PromptFeatures) string {
	if features.instructionText != "" {
		return features.instructionText
	}
	if features.roleStructured {
		return ""
	}
	return features.normalizedText
}

const (
	DifficultyDecisionBoundaryVersion    = "difficulty-decision-boundary.semantic-empty-combined-8.2026-07-15.v2"
	hardComplexCombinedEvidenceThreshold = 8
)

func hasHardComplexEvidence(features DifficultyFeatures) bool {
	return commonComplexityEvidenceScore(features.common)+categoryComplexityEvidenceScore(features) >=
		hardComplexCombinedEvidenceThreshold
}

func hasRuleComplexEvidence(features DifficultyFeatures) bool {
	return hasCommonComplexity(features.common) || hasCategoryComplexity(features)
}

func commonComplexityEvidenceScore(features CommonDifficultyFeatures) int {
	score := 0
	if features.payloadSizeBucket == "medium" || features.payloadSizeBucket == "large" {
		score++
	}
	score += boundedComplexityEvidence(features.taskCount, 2, 3)
	score += boundedComplexityEvidence(features.constraintCount, 2, 3)
	score += boundedComplexityEvidence(features.scopeCount, 2, 4)
	score += boundedComplexityEvidence(features.dependencyDepth, 2, 3)
	return score
}

func boundedComplexityEvidence(value int, moderateThreshold int, strongThreshold int) int {
	switch {
	case value >= strongThreshold:
		return 2
	case value >= moderateThreshold:
		return 1
	default:
		return 0
	}
}

func categoryComplexityEvidenceScore(features DifficultyFeatures) int {
	score := 0
	switch features.category {
	case CategoryCode:
		if features.code == nil {
			return 0
		}
		if isComplexCodeOperation(features.code.codeOperationKind) {
			score++
		}
		if features.code.codeScopeBreadth >= 3 {
			score += 2
		}
		if features.code.causalComplexity >= 1 {
			score += 2
		}
		if features.code.engineeringConstraintCount >= 2 {
			score += 2
		}
	case CategoryTranslation:
		if features.translation == nil {
			return 0
		}
		if features.translation.translationScopeCount >= 2 {
			score += 2
		}
		if features.translation.preservationConstraintCount >= 2 {
			score += 2
		}
		if features.translation.domainTerminologyLevel >= 2 {
			score += 2
		}
		if features.translation.localizationDegree >= 2 {
			score += 2
		}
	case CategorySummarization:
		if features.summarization == nil {
			return 0
		}
		if features.summarization.sourceBreadth >= 3 {
			// Source breadth may be derived from payload length alone, so it is
			// deliberately a weak proxy rather than a decisive signal.
			score++
		}
		if features.summarization.synthesisLevel >= 2 {
			score += 2
		}
		if features.summarization.facetCount >= 3 {
			score += 2
		}
		if features.summarization.hasTraceabilityConstraints {
			score++
		}
	case CategoryReasoning:
		if features.reasoning == nil {
			return 0
		}
		if features.reasoning.alternativeCount >= 3 {
			score += 2
		}
		if features.reasoning.criteriaAndConstraintCount >= 3 {
			score += 2
		}
		if features.reasoning.reasoningDepth >= 2 {
			score += 2
		}
		if features.reasoning.uncertaintyScenarioCount >= 2 {
			score += 2
		}
	default:
		if features.general == nil {
			return 0
		}
		if features.general.workflowDepth >= 2 {
			score += 2
		}
		if features.general.branchOrExceptionCount >= 2 {
			score += 2
		}
		if features.general.extractionBreadth >= 4 {
			score += 2
		}
		if features.general.hasCrossSourceSynthesis {
			score += 2
		}
	}
	return score
}

func hasCommonComplexity(features CommonDifficultyFeatures) bool {
	if features.payloadSizeBucket == "large" || features.taskCount >= 3 || features.constraintCount >= 3 || features.scopeCount >= 4 || features.dependencyDepth >= 3 {
		return true
	}
	moderateSignals := 0
	if features.payloadSizeBucket == "medium" {
		moderateSignals++
	}
	if features.taskCount >= 2 {
		moderateSignals++
	}
	if features.constraintCount >= 2 {
		moderateSignals++
	}
	if features.scopeCount >= 2 {
		moderateSignals++
	}
	if features.dependencyDepth >= 2 {
		moderateSignals++
	}
	return moderateSignals >= 2
}

func hasCategoryComplexity(features DifficultyFeatures) bool {
	switch features.category {
	case CategoryCode:
		if features.code == nil {
			return false
		}
		return isComplexCodeOperation(features.code.codeOperationKind) ||
			features.code.codeScopeBreadth >= 3 || features.code.causalComplexity >= 1 ||
			features.code.engineeringConstraintCount >= 2
	case CategoryTranslation:
		if features.translation == nil {
			return false
		}
		return features.translation.translationScopeCount >= 2 ||
			features.translation.preservationConstraintCount >= 2 ||
			features.translation.domainTerminologyLevel >= 2 ||
			features.translation.localizationDegree >= 2
	case CategorySummarization:
		if features.summarization == nil {
			return false
		}
		return features.summarization.sourceBreadth >= 3 ||
			features.summarization.synthesisLevel >= 2 ||
			features.summarization.facetCount >= 3 ||
			features.summarization.hasTraceabilityConstraints
	case CategoryReasoning:
		if features.reasoning == nil {
			return false
		}
		return features.reasoning.alternativeCount >= 3 ||
			features.reasoning.criteriaAndConstraintCount >= 3 ||
			features.reasoning.reasoningDepth >= 2 ||
			features.reasoning.uncertaintyScenarioCount >= 2
	default:
		if features.general == nil {
			return false
		}
		return features.general.workflowDepth >= 2 ||
			features.general.branchOrExceptionCount >= 2 ||
			features.general.extractionBreadth >= 4 ||
			features.general.hasCrossSourceSynthesis
	}
}

func hasSingleProxyBoundedSimpleEvidence(features DifficultyFeatures) bool {
	common := features.common
	if common.taskCount > 1 || common.constraintCount > 1 || common.scopeCount > 1 || common.dependencyDepth > 1 {
		return false
	}

	lengthProxy := common.payloadSizeBucket == "medium" || common.payloadSizeBucket == "large"
	operationProxy := features.category == CategoryCode && features.code != nil &&
		(features.code.codeOperationKind == "debug" || features.code.codeOperationKind == "refactor")
	if !lengthProxy && !operationProxy {
		return false
	}

	combinedScore := commonComplexityEvidenceScore(common) + categoryComplexityEvidenceScore(features)
	if features.category == CategorySummarization && features.summarization != nil && lengthProxy &&
		features.summarization.sourceBreadth == payloadBucketRank(common.payloadSizeBucket) {
		// sourceBreadth and payload bucket describe the same length proxy here.
		combinedScore--
	}
	return combinedScore <= 1
}

func hasBoundedSimpleEvidence(features DifficultyFeatures) bool {
	common := features.common
	if common.payloadSizeBucket != "small" || common.taskCount > 1 || common.constraintCount > 1 || common.scopeCount > 1 || common.dependencyDepth > 1 {
		return false
	}

	switch features.category {
	case CategoryCode:
		return features.code != nil && (features.code.codeOperationKind == "syntax" || features.code.codeOperationKind == "example" || features.code.codeOperationKind == "small_edit" || features.code.codeOperationKind == "unknown")
	case CategoryTranslation:
		return features.translation != nil && features.translation.preservationConstraintCount <= 1 && features.translation.domainTerminologyLevel <= 1 && features.translation.localizationDegree <= 1
	case CategorySummarization:
		return features.summarization != nil && features.summarization.sourceBreadth <= 1 && features.summarization.synthesisLevel <= 1 && features.summarization.facetCount <= 2 && !features.summarization.hasTraceabilityConstraints
	case CategoryReasoning:
		return features.reasoning != nil && features.reasoning.alternativeCount <= 2 && features.reasoning.criteriaAndConstraintCount <= 1 && features.reasoning.reasoningDepth <= 1 && features.reasoning.uncertaintyScenarioCount <= 1
	default:
		return features.general != nil && features.general.workflowDepth <= 1 && features.general.branchOrExceptionCount <= 1 && features.general.extractionBreadth <= 3 && !features.general.hasCrossSourceSynthesis
	}
}

func isComplexCodeOperation(operation string) bool {
	switch operation {
	case "debug", "design", "refactor", "performance", "migration", "concurrency":
		return true
	default:
		return false
	}
}

func payloadBucketRank(bucket string) int {
	switch bucket {
	case "large":
		return 3
	case "medium":
		return 2
	case "small":
		return 1
	default:
		return 0
	}
}

func maxInt(left int, right int) int {
	if left > right {
		return left
	}
	return right
}
