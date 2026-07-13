package routing

import (
	"context"
	"errors"
	"math"
	"reflect"
	"testing"
)

func TestRuleBasedCategoryClassifierV2UsesOnlyFiveCategories(t *testing.T) {
	t.Parallel()

	classifier := NewRuleBasedCategoryClassifier()
	tests := []struct {
		name     string
		prompt   string
		expected string
	}{
		{name: "general", prompt: "Explain how onboarding works.", expected: CategoryGeneral},
		{name: "code", prompt: "Fix this TypeScript function error.", expected: CategoryCode},
		{name: "translation", prompt: "Translate this sentence to Korean.", expected: CategoryTranslation},
		{name: "summarization", prompt: "Summarize this report into key points.", expected: CategorySummarization},
		{name: "reasoning", prompt: "Compare these options and recommend one with tradeoffs.", expected: CategoryReasoning},
		{name: "deleted extraction category merges to general", prompt: "Extract the invoice id as JSON.", expected: CategoryGeneral},
		{name: "deleted refund category merges to general", prompt: "I need a refund for my order.", expected: CategoryGeneral},
		{name: "unknown merges to general", prompt: "something entirely unmatched", expected: CategoryGeneral},
		{name: "empty merges to general", prompt: "", expected: CategoryGeneral},
	}

	allowed := map[string]bool{
		CategoryGeneral:       true,
		CategoryCode:          true,
		CategoryTranslation:   true,
		CategorySummarization: true,
		CategoryReasoning:     true,
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			features := ExtractPromptFeatures(test.prompt)
			actual := classifier.ClassifyFeatures(features).Category
			if !allowed[actual] {
				t.Fatalf("classifier returned category outside v2 contract: %q", actual)
			}
			if actual != test.expected {
				t.Fatalf("Classify(%q) = %q, want %q", test.prompt, actual, test.expected)
			}
		})
	}
}

func TestRuleBasedDifficultyClassifierIsCategoryAware(t *testing.T) {
	t.Parallel()

	classifier := NewRuleBasedDifficultyClassifier()
	tests := []struct {
		name       string
		prompt     string
		category   string
		difficulty string
	}{
		{name: "empty is simple", prompt: "", category: CategoryGeneral, difficulty: DifficultySimple},
		{name: "meaningless is simple", prompt: "???", category: CategoryGeneral, difficulty: DifficultySimple},
		{name: "general short explanation", prompt: "Explain OAuth briefly.", category: CategoryGeneral, difficulty: DifficultySimple},
		{name: "general multiple constraints", prompt: "Compare three plans, explain tradeoffs, and produce a rollout plan with five constraints.", category: CategoryGeneral, difficulty: DifficultyComplex},
		{name: "code small syntax", prompt: "Fix the syntax error in this one function.", category: CategoryCode, difficulty: DifficultySimple},
		{name: "code architecture", prompt: "Debug a race condition across multiple files, refactor the architecture, and preserve performance.", category: CategoryCode, difficulty: DifficultyComplex},
		{name: "code korean distributed deadlock", prompt: "분산 시스템 교착 원인과 수정안을 제시해줘", category: CategoryCode, difficulty: DifficultyComplex},
		{name: "translation direct", prompt: "Translate this sentence to Korean.", category: CategoryTranslation, difficulty: DifficultySimple},
		{name: "translation constrained", prompt: "Translate to Korean while preserving legal terminology, formal tone, tables, and markdown formatting.", category: CategoryTranslation, difficulty: DifficultyComplex},
		{name: "translation korean constrained", prompt: "법률 용어와 표 형식을 유지해 존댓말로 번역해줘", category: CategoryTranslation, difficulty: DifficultyComplex},
		{name: "summary key points", prompt: "Summarize this note into key points.", category: CategorySummarization, difficulty: DifficultySimple},
		{name: "summary multi document", prompt: "Compare and summarize three documents with disagreements, citations, and a structured table.", category: CategorySummarization, difficulty: DifficultyComplex},
		{name: "summarization korean multi document", prompt: "세 문서의 충돌점과 근거를 표로 요약해줘", category: CategorySummarization, difficulty: DifficultyComplex},
		{name: "reasoning few conditions", prompt: "If the switch is on, should I restart it?", category: CategoryReasoning, difficulty: DifficultySimple},
		{name: "reasoning tradeoffs", prompt: "Evaluate four options under six constraints, identify tradeoffs, and justify a multi-step recommendation.", category: CategoryReasoning, difficulty: DifficultyComplex},
		{name: "reasoning korean constrained comparison", prompt: "세 대안을 비용·위험·일정 제약으로 비교해줘", category: CategoryReasoning, difficulty: DifficultyComplex},
		{name: "meaningful uncertain is complex", prompt: "Investigate the situation and decide the best approach.", category: CategoryGeneral, difficulty: DifficultyComplex},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			features := ExtractPromptFeatures(test.prompt)
			difficultyFeatures := ExtractDifficultyFeatures(features, test.category)
			result := classifier.ClassifyFeatures(difficultyFeatures)
			if result.Difficulty != test.difficulty {
				t.Fatalf("Classify(%q, %q) = %q, want %q", test.prompt, test.category, result.Difficulty, test.difficulty)
			}
			if math.IsNaN(result.ComplexityScore) || math.IsInf(result.ComplexityScore, 0) || result.ComplexityScore < 0 || result.ComplexityScore > 1 {
				t.Fatalf("Classify(%q, %q) score = %v, want finite [0,1]", test.prompt, test.category, result.ComplexityScore)
			}
			if (result.ComplexityScore >= DifficultyScoreThreshold()) != (result.Difficulty == DifficultyComplex) {
				t.Fatalf("Classify(%q, %q) score/difficulty disagree: %#v threshold=%v", test.prompt, test.category, result, DifficultyScoreThreshold())
			}
			if features.isMeaningless && result.ComplexityScore != 0 {
				t.Fatalf("meaningless prompt score = %v, want 0", result.ComplexityScore)
			}
		})
	}
}

func TestDifficultyScoreUsesOneThresholdAndIsContinuous(t *testing.T) {
	t.Parallel()

	policy := defaultDifficultyScorePolicy
	below := DifficultyFeatures{
		category: CategoryGeneral,
		common:   CommonDifficultyFeatures{payloadSizeBucket: "small", taskCount: 1},
		general:  &GeneralDifficultyFeatures{},
	}
	at := DifficultyFeatures{
		category: CategoryGeneral,
		common:   CommonDifficultyFeatures{payloadSizeBucket: "small", taskCount: 2},
		general:  &GeneralDifficultyFeatures{},
	}
	above := DifficultyFeatures{
		category: CategoryGeneral,
		common:   CommonDifficultyFeatures{payloadSizeBucket: "small", taskCount: 3},
		general:  &GeneralDifficultyFeatures{},
	}

	belowResult := classifyDifficultyWithPolicy(below, policy)
	atResult := classifyDifficultyWithPolicy(at, policy)
	aboveResult := classifyDifficultyWithPolicy(above, policy)
	if belowResult.ComplexityScore >= DifficultyScoreThreshold() || belowResult.Difficulty != DifficultySimple {
		t.Fatalf("below-threshold result = %#v", belowResult)
	}
	if atResult.ComplexityScore != DifficultyScoreThreshold() || atResult.Difficulty != DifficultyComplex {
		t.Fatalf("at-threshold result = %#v threshold=%v", atResult, DifficultyScoreThreshold())
	}
	if aboveResult.ComplexityScore <= DifficultyScoreThreshold() || aboveResult.ComplexityScore >= 1 || aboveResult.Difficulty != DifficultyComplex {
		t.Fatalf("above-threshold result = %#v", aboveResult)
	}
}

func TestDifficultyScoreContrastPairsAreMonotonic(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name        string
		category    string
		simple      string
		moreComplex string
	}{
		{
			name: "general added task", category: CategoryGeneral,
			simple:      "비밀번호 최소 길이는 8자이고 입력값은 6자야. 가입이 거절된 이유를 한 문장으로 알려줘.",
			moreComplex: "비밀번호 최소 길이는 8자이고 입력값은 6자야. 가입이 거절된 이유를 한 문장으로 알려줘. 그리고 가입 복구 절차를 작성해줘.",
		},
		{
			name: "code added scope", category: CategoryCode,
			simple:      "Go 함수의 변수 이름 userNmae를 userName으로 바꿔줘.",
			moreComplex: "Go 함수의 변수 이름 userNmae를 userName으로 바꿔줘. 그리고 이 함수를 호출하는 부분도 수정해줘.",
		},
		{
			name: "translation added explanation", category: CategoryTranslation,
			simple:      "'빌드가 통과했습니다'를 영어로 번역해줘.",
			moreComplex: "'빌드가 통과했습니다'를 영어로 번역해줘. 그리고 용어 선택 이유를 설명해줘.",
		},
		{
			name: "summarization added facet", category: CategorySummarization,
			simple:      "'배포일은 금요일이고 담당자는 아직 정해지지 않았다'를 한 문장으로 요약해줘.",
			moreComplex: "'배포일은 금요일이고 담당자는 아직 정해지지 않았다'를 한 문장으로 요약해줘. 그리고 미해결 항목을 따로 적어줘.",
		},
		{
			name: "reasoning added fallback", category: CategoryReasoning,
			simple:      "월 비용만 보면 A는 10만 원, B는 12만 원, C는 11만 원이야. 가장 저렴한 것을 골라줘.",
			moreComplex: "월 비용만 보면 A는 10만 원, B는 12만 원, C는 11만 원이야. 가장 저렴한 것을 골라줘. 그리고 사용할 수 없을 때의 차선책도 정해줘.",
		},
	}

	classifier := NewRuleBasedDifficultyClassifier()
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			simple := classifier.ClassifyFeatures(ExtractDifficultyFeatures(ExtractPromptFeatures(test.simple), test.category))
			moreComplex := classifier.ClassifyFeatures(ExtractDifficultyFeatures(ExtractPromptFeatures(test.moreComplex), test.category))
			if moreComplex.ComplexityScore < simple.ComplexityScore {
				t.Fatalf("score decreased after adding complexity: simple=%#v moreComplex=%#v", simple, moreComplex)
			}
		})
	}
}

func TestDifficultyClassifierTreatsContractPreservingTranslationAsComplex(t *testing.T) {
	t.Parallel()

	classifier := NewRuleBasedDifficultyClassifier()
	prompt := "Translate the contract while preserving defined terms and internal references."
	features := ExtractPromptFeatures(prompt)
	difficultyFeatures := ExtractDifficultyFeatures(features, CategoryTranslation)
	if actual := classifier.ClassifyFeatures(difficultyFeatures).Difficulty; actual != DifficultyComplex {
		t.Fatalf("Classify(%q, %q) = %q, want %q", prompt, CategoryTranslation, actual, DifficultyComplex)
	}
}

func TestDifficultyClassifierTreatsUnresolvedMeetingActionSummaryAsComplex(t *testing.T) {
	t.Parallel()

	classifier := NewRuleBasedDifficultyClassifier()
	prompt := "Summarize the meeting notes by decisions, unresolved conflicts, and unassigned follow-up actions."
	features := ExtractPromptFeatures(prompt)
	difficultyFeatures := ExtractDifficultyFeatures(features, CategorySummarization)
	if actual := classifier.ClassifyFeatures(difficultyFeatures).Difficulty; actual != DifficultyComplex {
		t.Fatalf("Classify(%q, %q) = %q, want %q", prompt, CategorySummarization, actual, DifficultyComplex)
	}
}

func TestSimpleRouterV2AutoUsesCategoryDifficultyMatrixAndOrderedFallbacks(t *testing.T) {
	t.Parallel()

	config := validV2RouterConfig(RoutingPolicyModeAuto)
	config.Routes.Code.Complex.ModelRefs = []string{"model-code-primary", "model-code-fallback-1", "model-code-fallback-2"}
	router := NewSimpleRouter(config)

	decision, err := router.DecideRoute(context.Background(), Request{
		RequestedModel: "auto",
		PromptText:     "Debug a race condition across multiple files, refactor the architecture, and preserve performance.",
	})
	if err != nil {
		t.Fatalf("DecideRoute() error = %v", err)
	}

	if decision.ModelRef != "model-code-primary" {
		t.Fatalf("ModelRef = %q, want model-code-primary", decision.ModelRef)
	}
	if !reflect.DeepEqual(decision.CandidateModelRefs, []string{"model-code-primary", "model-code-fallback-1", "model-code-fallback-2"}) {
		t.Fatalf("CandidateModelRefs = %#v", decision.CandidateModelRefs)
	}
	if decision.RoutingDecisionMaterial.Category != CategoryCode || decision.RoutingDecisionMaterial.Difficulty != DifficultyComplex {
		t.Fatalf("unexpected decision material: %#v", decision.RoutingDecisionMaterial)
	}
}

func TestSimpleRouterV2ManualRejectsAutoAndAllowsExplicitModelRef(t *testing.T) {
	t.Parallel()

	router := NewSimpleRouter(validV2RouterConfig(RoutingPolicyModeManual))
	_, err := router.DecideRoute(context.Background(), Request{RequestedModel: "auto", PromptText: "Hello"})
	if !errors.Is(err, ErrAutoRoutingDisabled) {
		t.Fatalf("DecideRoute(auto) error = %v, want ErrAutoRoutingDisabled", err)
	}

	decision, err := router.DecideRoute(context.Background(), Request{RequestedModel: "opaque-model-ref", PromptText: "Hello"})
	if err != nil {
		t.Fatalf("DecideRoute(explicit) error = %v", err)
	}
	if decision.ModelRef != "opaque-model-ref" || !reflect.DeepEqual(decision.CandidateModelRefs, []string{"opaque-model-ref"}) {
		t.Fatalf("unexpected manual decision: %#v", decision)
	}
}

func validV2RouterConfig(mode string) SimpleRouterConfig {
	cell := func(modelRef string) RouteCell { return RouteCell{ModelRefs: []string{modelRef}} }
	return SimpleRouterConfig{
		Mode:       mode,
		PolicyHash: "route_policy_v2_test",
		Routes: RoutingMatrix{
			General:       DifficultyRoutes{Simple: cell("model-general-simple"), Complex: cell("model-general-complex")},
			Code:          DifficultyRoutes{Simple: cell("model-code-simple"), Complex: cell("model-code-complex")},
			Translation:   DifficultyRoutes{Simple: cell("model-translation-simple"), Complex: cell("model-translation-complex")},
			Summarization: DifficultyRoutes{Simple: cell("model-summary-simple"), Complex: cell("model-summary-complex")},
			Reasoning:     DifficultyRoutes{Simple: cell("model-reasoning-simple"), Complex: cell("model-reasoning-complex")},
		},
	}
}
