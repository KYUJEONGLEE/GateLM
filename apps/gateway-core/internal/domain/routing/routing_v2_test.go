package routing

import (
	"context"
	"errors"
	"reflect"
	"strings"
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
		{name: "code causal workflow", prompt: "이 서비스가 가끔 실패한다. 로그 위치와 가설 검증 순서, 안전한 롤백 조건을 제시해줘.", expected: CategoryCode},
		{name: "translation of code content", prompt: "API migration guide의 code token을 보존해 한국어로 번역해줘.", expected: CategoryTranslation},
		{name: "summary synthesis", prompt: "세 팀 기록의 변화 추세와 핵심 예외, 미해결 항목을 세 문장으로 종합해줘.", expected: CategorySummarization},
		{name: "reasoning choice and backup", prompt: "세 지역 중 예산 제한과 실패 비용을 고려해 최종 선택과 차선책을 정해줘.", expected: CategoryReasoning},
		{name: "translation editing is not code", prompt: "실패 안내를 영어 메일 첫 문단으로 어색하지 않게 고쳐줘.", expected: CategoryTranslation},
		{name: "code object alone is general", prompt: "로그 위치만 알려줘.", expected: CategoryGeneral},
		{name: "negated analysis is general", prompt: "전문 용어가 있어도 분석하지 말고 위치만 알려줘.", expected: CategoryGeneral},
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
		{name: "general staged workflow", prompt: "업무를 준비, 실행, 확인 단계로 나누고 각 단계의 담당자와 완료 조건을 정해줘.", category: CategoryGeneral, difficulty: DifficultyComplex},
		{name: "general exception paths", prompt: "정상 경로와 두 가지 예외 상황을 구분하고 예외별 대응 순서와 중단 기준을 만들어줘.", category: CategoryGeneral, difficulty: DifficultyComplex},
		{name: "code small syntax", prompt: "Fix the syntax error in this one function.", category: CategoryCode, difficulty: DifficultySimple},
		{name: "code architecture", prompt: "Debug a race condition across multiple files, refactor the architecture, and preserve performance.", category: CategoryCode, difficulty: DifficultyComplex},
		{name: "code korean distributed deadlock", prompt: "분산 시스템 교착 원인과 수정안을 제시해줘", category: CategoryCode, difficulty: DifficultyComplex},
		{name: "code reproduction and regression", prompt: "재현 조건과 가능한 원인을 좁히고 수정안과 회귀 테스트를 설계해줘.", category: CategoryCode, difficulty: DifficultyComplex},
		{name: "code refactor constraints", prompt: "리팩터링하되 기존 동작, 오류 처리, 성능 한도를 유지해줘.", category: CategoryCode, difficulty: DifficultyComplex},
		{name: "code intermittent rollback", prompt: "가끔만 실패한다. 로그 위치, 가설 검증 순서, 안전한 롤백 조건을 제시해줘.", category: CategoryCode, difficulty: DifficultyComplex},
		{name: "translation direct", prompt: "Translate this sentence to Korean.", category: CategoryTranslation, difficulty: DifficultySimple},
		{name: "translation no localization is simple", prompt: "따옴표와 문장부호는 그대로 두되 별도 현지화 없이 번역해줘.", category: CategoryTranslation, difficulty: DifficultySimple},
		{name: "translation constrained", prompt: "Translate to Korean while preserving legal terminology, formal tone, tables, and markdown formatting.", category: CategoryTranslation, difficulty: DifficultyComplex},
		{name: "translation korean constrained", prompt: "법률 용어와 표 형식을 유지해 존댓말로 번역해줘", category: CategoryTranslation, difficulty: DifficultyComplex},
		{name: "translation glossary placeholders", prompt: "용어집을 적용하고 번호 체계, 치환 변수, 서식을 유지해 독일어로 번역해줘.", category: CategoryTranslation, difficulty: DifficultyComplex},
		{name: "summary key points", prompt: "Summarize this note into key points.", category: CategorySummarization, difficulty: DifficultySimple},
		{name: "summary multi document", prompt: "Compare and summarize three documents with disagreements, citations, and a structured table.", category: CategorySummarization, difficulty: DifficultyComplex},
		{name: "summarization korean multi document", prompt: "세 문서의 충돌점과 근거를 표로 요약해줘", category: CategorySummarization, difficulty: DifficultyComplex},
		{name: "summary common flow and exceptions", prompt: "여러 팀 기록의 공통 흐름과 예외를 종합하고 담당자, 일정, 위험, 후속 조치를 정리해줘.", category: CategorySummarization, difficulty: DifficultyComplex},
		{name: "summary trends exceptions uncertainty", prompt: "세 문장만 쓰되 변화 추세, 핵심 예외, 의사결정에 필요한 불확실성을 보존해줘.", category: CategorySummarization, difficulty: DifficultyComplex},
		{name: "reasoning few conditions", prompt: "If the switch is on, should I restart it?", category: CategoryReasoning, difficulty: DifficultySimple},
		{name: "reasoning tradeoffs", prompt: "Evaluate four options under six constraints, identify tradeoffs, and justify a multi-step recommendation.", category: CategoryReasoning, difficulty: DifficultyComplex},
		{name: "reasoning korean constrained comparison", prompt: "세 대안을 비용·위험·일정 제약으로 비교해줘", category: CategoryReasoning, difficulty: DifficultyComplex},
		{name: "reasoning choice with backup", prompt: "예산 제한, 선행 조건, 실패 비용을 만족하는 선택과 차선책을 정해줘.", category: CategoryReasoning, difficulty: DifficultyComplex},
		{name: "reasoning uncertain variables", prompt: "불확실한 변수 두 개와 그 변수가 뒤집힐 때의 결론까지 검토해줘.", category: CategoryReasoning, difficulty: DifficultyComplex},
		{name: "medium payload alone is simple", prompt: strings.Repeat("background context ", 10) + "state the service window", category: CategoryGeneral, difficulty: DifficultySimple},
		{name: "large payload alone is simple", prompt: strings.Repeat("background context ", 60) + "state the service window", category: CategoryGeneral, difficulty: DifficultySimple},
		{name: "single debug operation is simple", prompt: "Debug this function.", category: CategoryCode, difficulty: DifficultySimple},
		{name: "single refactor operation is simple", prompt: "Refactor this function.", category: CategoryCode, difficulty: DifficultySimple},
		{name: "debug plus causal and regression evidence is complex", prompt: "Debug this function, identify its reproduction conditions, and add a regression test.", category: CategoryCode, difficulty: DifficultyComplex},
		{name: "large debug request has corroborating proxies", prompt: strings.Repeat("background context ", 60) + "Debug this function.", category: CategoryCode, difficulty: DifficultyComplex},
		{name: "meaningful uncertain stays complex", prompt: "Investigate the situation and decide the best approach.", category: CategoryGeneral, difficulty: DifficultyComplex},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			features := ExtractPromptFeatures(test.prompt)
			difficultyFeatures := ExtractDifficultyFeatures(features, test.category)
			if actual := classifier.ClassifyFeatures(difficultyFeatures).Difficulty; actual != test.difficulty {
				t.Fatalf("Classify(%q, %q) = %q, want %q; features=%#v", test.prompt, test.category, actual, test.difficulty, difficultyFeatures)
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
