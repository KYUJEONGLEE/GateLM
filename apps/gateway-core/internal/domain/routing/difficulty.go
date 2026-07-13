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
	category string
	common   CommonDifficultyFeatures

	general       *GeneralDifficultyFeatures
	code          *CodeDifficultyFeatures
	translation   *TranslationDifficultyFeatures
	summarization *SummarizationDifficultyFeatures
	reasoning     *ReasoningDifficultyFeatures
}

type DifficultyResult struct {
	Difficulty string
}

func ExtractDifficultyFeatures(features PromptFeatures, category string) DifficultyFeatures {
	category = canonicalCategory(category)
	common := CommonDifficultyFeatures{
		payloadSizeBucket: routingPayloadSizeBucket(features),
		taskCount:         features.taskCount,
		constraintCount:   features.constraintCount,
		scopeCount:        features.scopeCount,
		dependencyDepth:   features.dependencyDepth,
	}
	result := DifficultyFeatures{category: category, common: common}

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
	if features.common.payloadSizeBucket == "empty" {
		return DifficultyResult{Difficulty: DifficultySimple}
	}
	if hasCommonComplexity(features.common) || hasCategoryComplexity(features) {
		return DifficultyResult{Difficulty: DifficultyComplex}
	}
	if hasBoundedSimpleEvidence(features) {
		return DifficultyResult{Difficulty: DifficultySimple}
	}

	// Meaningful but insufficiently bounded requests fail closed to complex.
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
	text := features.normalizedText
	workflowDepth := maxInt(common.dependencyDepth, countDistinctPhrases(text, []string{
		"step by step", "workflow", "procedure", "rollout", "단계별", "절차", "처리 순서", "전환안", "운영 흐름",
	}))
	return GeneralDifficultyFeatures{
		workflowDepth: workflowDepth,
		branchOrExceptionCount: minInt(countDistinctPhrasesIncludingBoundaries(text, []string{
			" if ", "unless", "otherwise", "exception", "failure", "fallback", "경우", "실패 시", "예외", "대체 경로", "복구",
		}), 5),
		extractionBreadth: minInt(countDistinctPhrases(text, []string{
			"field", "column", "key/value", "status", "owner", "deadline", "date", "priority",
			"필드", "열", "상태", "담당자", "마감일", "날짜", "우선순위", "요청사항",
		}), 6),
		hasCrossSourceSynthesis: hasAnyPhrase(text, []string{
			"across sources", "multiple sources", "combine the policies", "여러 자료", "여러 정책", "자료를 종합", "문의들을 종합",
		}),
	}
}

func extractCodeDifficultyFeatures(features PromptFeatures, common CommonDifficultyFeatures) CodeDifficultyFeatures {
	text := features.normalizedText
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
		causalComplexity: minInt(countDistinctPhrases(text, []string{
			"root cause", "race condition", "deadlock", "concurrency", "intermittent", "state interaction",
			"경쟁 조건", "경쟁 상태", "교착", "동시성", "간헐적", "상태 상호작용",
		}), 4),
		engineeringConstraintCount: minInt(countDistinctPhrases(text, []string{
			"performance", "security", "compatibility", "backward compatible", "test boundary", "rollout", "migration safety",
			"성능", "보안", "호환", "테스트 경계", "배포", "마이그레이션 안전",
		}), 6),
	}
}

func codeOperationKind(text string) string {
	switch {
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
	case hasAnyPhrase(text, []string{"debug", "root cause", "test failure", "디버깅", "버그", "테스트 실패"}):
		return "debug"
	default:
		return "unknown"
	}
}

func extractTranslationDifficultyFeatures(features PromptFeatures, common CommonDifficultyFeatures) TranslationDifficultyFeatures {
	text := features.normalizedText
	targetCount := translationTargetLanguageCount(text)
	return TranslationDifficultyFeatures{
		translationScopeCount: maxInt(common.scopeCount, maxInt(targetCount, 1)),
		preservationConstraintCount: minInt(countDistinctPhrases(text, []string{
			"defined terms", "terminology", "modal verb", "cross-reference", "cross reference", "internal reference",
			"formal tone", "informal tone", "formatting", "table", "placeholder", "preserve tone",
			"전문 용어", "전문용어", "정의된 용어", "법률 용어", "말투", "존댓말", "반말", "형식", "표", "플레이스홀더", "참조",
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
	if hasAnyPhrase(text, []string{"localize", "localization", "cultural adaptation", "현지화", "문화에 맞게"}) {
		return 2
	}
	if hasAnyPhrase(text, []string{"naturally", "product tone", "audience", "자연스럽게", "제품 톤", "고객에게 맞게"}) {
		return 1
	}
	return 0
}

func extractSummarizationDifficultyFeatures(features PromptFeatures, common CommonDifficultyFeatures) SummarizationDifficultyFeatures {
	text := features.normalizedText
	sourceBreadth := payloadBucketRank(common.payloadSizeBucket)
	if hasAnyPhrase(text, []string{"long report", "long document", "긴 보고서", "긴 문서"}) {
		sourceBreadth = maxInt(sourceBreadth, 3)
	}
	if hasAnyPhrase(text, []string{"multiple documents", "three documents", "multi-document", "여러 문서", "세 문서", "다중 문서", "여러 팀의 회의 기록"}) {
		sourceBreadth = maxInt(sourceBreadth, maxInt(common.scopeCount, 2))
	}
	return SummarizationDifficultyFeatures{
		sourceBreadth:  sourceBreadth,
		synthesisLevel: summarizationSynthesisLevel(text),
		facetCount: minInt(countDistinctPhrases(text, []string{
			"decision", "action item", "owner", "date", "risk", "conflict", "follow-up",
			"결정 사항", "결정사항", "후속 조치", "담당자", "날짜", "위험", "충돌", "액션아이템",
		}), 7),
		hasTraceabilityConstraints: hasAnyPhrase(text, []string{
			"citation", "citations", "source mapping", "traceability", "인용", "출처", "근거 연결", "문서별 근거",
		}),
	}
}

func summarizationSynthesisLevel(text string) int {
	if hasAnyPhrase(text, []string{
		"comparative", "compare and summarize", "disagreement", "unresolved conflict", "deduplicate",
		"비교 요약", "충돌점", "충돌 지점", "중복 없이", "의견 차이", "합의되지 않은",
	}) {
		return 2
	}
	if hasAnyPhrase(text, []string{"group by", "structured table", "by decisions", "구분해", "표로", "항목별", "결정 사항별"}) {
		return 1
	}
	return 0
}

func extractReasoningDifficultyFeatures(features PromptFeatures, common CommonDifficultyFeatures) ReasoningDifficultyFeatures {
	text := features.normalizedText
	alternativeCount := 1
	if hasAnyPhrase(text, []string{"option", "alternative", "plan", "strategy", "대안", "방식", "계획", "전략"}) {
		alternativeCount = maxInt(alternativeCount, common.scopeCount)
	}
	criteriaCount := countDistinctPhrases(text, []string{
		"criteria", "constraint", "cost", "risk", "schedule", "quality", "latency", "security",
		"기준", "제약", "비용", "위험", "일정", "품질", "지연", "보안",
	})
	reasoningDepth := common.dependencyDepth
	if hasAnyPhrase(text, []string{"multi-step", "step by step", "justify", "failure path", "단계적으로", "단계별", "근거를 설명", "실패 경로", "복구 경로"}) {
		reasoningDepth = maxInt(reasoningDepth, 2)
	}
	return ReasoningDifficultyFeatures{
		alternativeCount:           alternativeCount,
		criteriaAndConstraintCount: maxInt(common.constraintCount, criteriaCount),
		reasoningDepth:             reasoningDepth,
		uncertaintyScenarioCount: minInt(countDistinctPhrases(text, []string{
			"uncertain", "scenario", "tradeoff", "trade-off", "conflicting", "failure path", "risk",
			"불확실", "시나리오", "트레이드오프", "상충", "실패 경로", "위험",
		}), 6),
	}
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
