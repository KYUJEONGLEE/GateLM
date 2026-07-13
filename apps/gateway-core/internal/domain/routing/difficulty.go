package routing

// DifficultyFeatures contains only the predicates needed by the selected
// category's difficulty rules. It never computes rules for other categories.
type DifficultyFeatures struct {
	category                 string
	meaningless              bool
	wordCount                int
	singleClause             bool
	hasGenericComplexSignal  bool
	hasCategoryComplexSignal bool
	hasCategorySimpleSignal  bool
}

type DifficultyResult struct {
	Difficulty string
}

func ExtractDifficultyFeatures(features PromptFeatures, category string) DifficultyFeatures {
	category = canonicalCategory(category)
	text := features.normalizedText
	return DifficultyFeatures{
		category:                 category,
		meaningless:              features.meaningless,
		wordCount:                features.wordCount,
		singleClause:             features.singleClause,
		hasGenericComplexSignal:  hasAnyPhrase(text, genericComplexSignals()),
		hasCategoryComplexSignal: hasAnyPhrase(text, categoryComplexSignals(category)),
		hasCategorySimpleSignal:  hasAnyPhrase(text, categorySimpleSignals(category)),
	}
}

type RuleBasedDifficultyClassifier struct{}

func NewRuleBasedDifficultyClassifier() RuleBasedDifficultyClassifier {
	return RuleBasedDifficultyClassifier{}
}

func (RuleBasedDifficultyClassifier) ClassifyFeatures(features DifficultyFeatures) DifficultyResult {
	if features.meaningless {
		return DifficultyResult{Difficulty: DifficultySimple}
	}
	if features.hasGenericComplexSignal || features.hasCategoryComplexSignal {
		return DifficultyResult{Difficulty: DifficultyComplex}
	}
	if features.hasCategorySimpleSignal {
		return DifficultyResult{Difficulty: DifficultySimple}
	}

	// Short, single-clause questions are clear enough to be simple. Meaningful
	// but otherwise uncertain requests deliberately fail closed to complex.
	if features.wordCount <= 9 && features.singleClause {
		return DifficultyResult{Difficulty: DifficultySimple}
	}
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

func genericComplexSignals() []string {
	return []string{
		"multiple constraints", "several constraints", "tradeoff", "trade-off",
		"compare three", "compare four", "multi-step", "multiple steps",
		"across multiple", "end-to-end", "root cause", "rollout plan",
		"five constraints", "six constraints", "four options", "three plans",
		"investigate", "best approach",
	}
}

func categoryComplexSignals(category string) []string {
	switch category {
	case CategoryCode:
		return []string{"debug", "architecture", "refactor", "performance", "race condition", "multi-file", "multiple files", "distributed", "migration", "디버깅", "아키텍처", "리팩터링", "성능", "경쟁 상태", "여러 파일", "분산 시스템", "마이그레이션", "교착", "원인", "수정안"}
	case CategoryTranslation:
		return []string{"terminology", "defined terms", "modal verb", "cross-reference", "cross reference", "internal reference", "formal tone", "informal tone", "preserving tone", "preserve tone", "formatting", "table", "legal", "localize", "전문 용어", "전문용어", "법률 용어", "존댓말", "반말", "말투", "형식", "표", "현지화"}
	case CategorySummarization:
		return []string{"multiple documents", "three documents", "multi-document", "comparative", "disagreement", "unresolved conflict", "unassigned follow-up", "citations", "structured table", "long report", "여러 문서", "세 문서", "다중 문서", "비교 요약", "충돌점", "충돌 지점", "담당자 없는 후속 조치", "인용", "근거", "구조화된 표", "표로", "긴 보고서"}
	case CategoryReasoning:
		return []string{"evaluate", "options", "constraints", "tradeoff", "justify", "recommendation", "scenario", "prioritize", "평가", "대안", "제약", "트레이드오프", "근거", "추천안", "시나리오", "우선순위", "비용", "위험", "일정"}
	default:
		return []string{"compare", "plan", "constraints", "tradeoff", "alternatives", "strategy"}
	}
}

func categorySimpleSignals(category string) []string {
	switch category {
	case CategoryCode:
		return []string{"syntax", "one function", "small edit", "single api", "what does", "example"}
	case CategoryTranslation:
		return []string{"translate", "번역"}
	case CategorySummarization:
		return []string{"key points", "brief summary", "summarize", "요약"}
	case CategoryReasoning:
		return []string{"should i", "if ", "which one"}
	default:
		return []string{"explain", "what is", "how do i", "briefly", "single"}
	}
}
