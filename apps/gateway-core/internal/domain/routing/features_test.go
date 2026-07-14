package routing

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"
)

func TestPromptClassificationPipelineMatchesCompatibilityWrappers(t *testing.T) {
	t.Parallel()

	pipeline := NewRuleBasedPromptClassifier()
	categoryClassifier := NewRuleBasedCategoryClassifier()
	difficultyClassifier := NewRuleBasedDifficultyClassifier()
	tests := []string{
		"",
		"Explain OAuth briefly.",
		"Fix the syntax error in this one function.",
		"Debug a race condition across multiple files, refactor the architecture, and preserve performance.",
		"Translate this sentence to Korean.",
		"Summarize this report into key points.",
		"Compare these options and recommend one with tradeoffs.",
	}

	for _, prompt := range tests {
		prompt := prompt
		t.Run(prompt, func(t *testing.T) {
			result := pipeline.Classify(prompt)
			legacyCategory := categoryClassifier.Classify(prompt)
			legacyDifficulty := difficultyClassifier.Classify(prompt, legacyCategory)

			if result.Category.Category != legacyCategory {
				t.Fatalf("category mismatch: pipeline=%q compatibility=%q", result.Category.Category, legacyCategory)
			}
			if result.Difficulty.Difficulty != legacyDifficulty {
				t.Fatalf("difficulty mismatch: pipeline=%q compatibility=%q", result.Difficulty.Difficulty, legacyDifficulty)
			}
			legacySignals := categoryClassifier.ExtractRoutingSignals(prompt)
			if !reflect.DeepEqual(result.Category.Diagnostics, legacySignals.CategoryDiagnostics) {
				t.Fatalf("diagnostics mismatch: pipeline=%#v compatibility=%#v", result.Category.Diagnostics, legacySignals.CategoryDiagnostics)
			}
		})
	}
}

func TestPromptFeaturesDoNotExposePromptMaterialOrClassificationResults(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("secret-like synthetic prompt: translate this")
	payload, err := json.Marshal(features)
	if err != nil {
		t.Fatalf("json.Marshal(PromptFeatures) error = %v", err)
	}
	if string(payload) != "{}" {
		t.Fatalf("PromptFeatures must remain opaque to JSON, got %s", payload)
	}

	typeOfFeatures := reflect.TypeOf(features)
	for index := 0; index < typeOfFeatures.NumField(); index++ {
		fieldName := strings.ToLower(typeOfFeatures.Field(index).Name)
		for _, forbidden := range []string{"category", "diagnostic", "difficulty", "complexity", "score"} {
			if strings.Contains(fieldName, forbidden) {
				t.Fatalf("PromptFeatures must not contain classification result field %q", typeOfFeatures.Field(index).Name)
			}
		}
	}

	difficultyPayload, err := json.Marshal(ExtractDifficultyFeatures(features, CategoryTranslation))
	if err != nil {
		t.Fatalf("json.Marshal(DifficultyFeatures) error = %v", err)
	}
	if string(difficultyPayload) != "{}" {
		t.Fatalf("DifficultyFeatures must remain opaque to JSON, got %s", difficultyPayload)
	}

	categoryPayload, err := json.Marshal(extractCategoryFeatures(features))
	if err != nil {
		t.Fatalf("json.Marshal(CategoryFeatures) error = %v", err)
	}
	if string(categoryPayload) != "{}" {
		t.Fatalf("CategoryFeatures must remain opaque to JSON, got %s", categoryPayload)
	}

	capabilityPayload, err := json.Marshal(ExtractModelCapabilityFeatures(features))
	if err != nil {
		t.Fatalf("json.Marshal(ModelCapabilityFeatures) error = %v", err)
	}
	if string(capabilityPayload) != "{}" {
		t.Fatalf("ModelCapabilityFeatures must remain opaque to JSON, got %s", capabilityPayload)
	}
}

func TestExtractPromptFeaturesDerivesExpandedCommonSignals(t *testing.T) {
	t.Parallel()

	prompt := "먼저 두 문서를 비교하고 보안 조건과 표 형식을 유지한 뒤 단계별 요약을 제안해줘."
	features := ExtractPromptFeatures(prompt)

	if features.promptRuneLength == 0 || features.wordCount == 0 || features.clauseCount < 2 {
		t.Fatalf("length and clause features were not derived: %#v", features)
	}
	if features.taskCount < 2 || features.constraintCount < 2 || features.scopeCount != 2 || features.dependencyDepth < 2 {
		t.Fatalf("workload features were not derived: %#v", features)
	}
	if features.languageBucket != "ko" || features.hasCodeFence || features.isMeaningless {
		t.Fatalf("language/shape features were not derived: %#v", features)
	}
}

func TestRoutingPhraseMatchingUsesLatinWordBoundaries(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("Show information so readers understand the result.")
	if features.taskCount != 1 {
		t.Fatalf("taskCount = %d, want 1: %#v", features.taskCount, features)
	}
	if features.constraintCount != 0 {
		t.Fatalf("constraintCount matched format/under substrings: %#v", features)
	}
	if containsRoutingPhrase("showcase the result", "show") {
		t.Fatal("show must not match inside showcase")
	}
	if !containsRoutingPhrase("show the result", "show") {
		t.Fatal("show must match at word boundaries")
	}
}

func TestTaskCountUsesInstructionUnitsInsteadOfDistinctVerbKinds(t *testing.T) {
	t.Parallel()

	repeatedAction := ExtractPromptFeatures("A를 수정하고 B를 수정해줘.")
	if repeatedAction.taskCount != 2 {
		t.Fatalf("repeated action taskCount = %d, want 2: %#v", repeatedAction.taskCount, repeatedAction)
	}

	aliasedAction := ExtractPromptFeatures("Refactor(리팩터링) this function.")
	if aliasedAction.taskCount != 1 {
		t.Fatalf("aliased action taskCount = %d, want 1: %#v", aliasedAction.taskCount, aliasedAction)
	}

	repeatedIdentical := ExtractPromptFeatures(strings.Repeat("Summarize this note. ", 5))
	if repeatedIdentical.taskCount != 1 {
		t.Fatalf("identical repeated taskCount = %d, want 1: %#v", repeatedIdentical.taskCount, repeatedIdentical)
	}
}

func TestConstraintCountDeduplicatesSemanticFamilies(t *testing.T) {
	t.Parallel()

	formatAliases := ExtractPromptFeatures("Preserve format, 포맷, 형식.")
	if formatAliases.constraintCount != 1 {
		t.Fatalf("format alias constraintCount = %d, want 1: %#v", formatAliases.constraintCount, formatAliases)
	}

	twoTargets := ExtractPromptFeatures("Preserve tone and format.")
	if twoTargets.constraintCount != 2 {
		t.Fatalf("two target constraintCount = %d, want 2: %#v", twoTargets.constraintCount, twoTargets)
	}
}

func TestDependencyDepthDeduplicatesAliasesWithinOneUnit(t *testing.T) {
	t.Parallel()

	aliased := ExtractPromptFeatures("Then(그다음) continue.")
	if aliased.dependencyDepth != 1 {
		t.Fatalf("aliased dependencyDepth = %d, want 1: %#v", aliased.dependencyDepth, aliased)
	}

	separateBranches := ExtractPromptFeatures("If ready, otherwise stop.")
	if separateBranches.dependencyDepth != 2 {
		t.Fatalf("separate dependencyDepth = %d, want 2: %#v", separateBranches.dependencyDepth, separateBranches)
	}
}

func TestExtractPromptFeaturesParsesEveryCodeFence(t *testing.T) {
	t.Parallel()

	prompt := "Fix the first example. ```go\nfunc first() {}\n``` Then explain the second. ```sql\nselect * from items\n``` Finally summarize the changes."
	features := ExtractPromptFeatures(prompt)
	if features.payloadBlockCount != 2 || features.scopeCount != 2 {
		t.Fatalf("multi-fence source counts were not preserved: %#v", features)
	}
	if strings.Contains(features.instructionText, "func first") || strings.Contains(features.instructionText, "select *") {
		t.Fatalf("payload leaked into instruction: %q", features.instructionText)
	}
	if !strings.Contains(features.payloadText, "func first") || !strings.Contains(features.payloadText, "select *") {
		t.Fatalf("payload blocks were not retained: %q", features.payloadText)
	}
	if features.taskCount != 3 {
		t.Fatalf("multi-fence taskCount = %d, want 3: %#v", features.taskCount, features)
	}
}

func TestExtractPromptFeaturesSeparatesPairedPayloadTag(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures(`<instruction>Summarize in three lines.</instruction><document id="meeting-1">security risk and deadline</document>`)
	if features.instructionText != "summarize in three lines." {
		t.Fatalf("tagged instruction = %q, want instruction body only", features.instructionText)
	}
	if features.payloadText != "security risk and deadline" || features.payloadBlockCount != 1 {
		t.Fatalf("tagged payload was not separated: %#v", features)
	}
	if features.payloadBoundaryEvidence&payloadBoundaryTag == 0 || features.payloadSplitConfidence != payloadSplitConfidenceHigh {
		t.Fatalf("tagged payload evidence/confidence = (%d, %d), want tag/high", features.payloadBoundaryEvidence, features.payloadSplitConfidence)
	}
}

func TestExtractPromptFeaturesKeepsUndelimitedTextAsInstruction(t *testing.T) {
	t.Parallel()

	prompt := "Summarize the release notes in three bullets without changing product names."
	features := ExtractPromptFeatures(prompt)
	if features.instructionText != strings.ToLower(prompt) {
		t.Fatalf("undelimited instruction = %q, want entire prompt", features.instructionText)
	}
	if features.payloadText != "" || features.payloadBlockCount != 0 || features.payloadSplitConfidence != payloadSplitConfidenceNone {
		t.Fatalf("undelimited prompt created payload: %#v", features)
	}
}

func TestExtractPromptFeaturesFromMessagesPreservesRoleBoundary(t *testing.T) {
	t.Parallel()

	messages := []PromptMessage{
		{Role: "system", Text: "Follow the response policy."},
		{Role: "developer", Text: "Preserve the headings."},
		{Role: "assistant", Text: "<instruction>Translate this payload to French.</instruction>"},
		{Role: "user", Text: "Summarize the previous answer."},
	}
	features := ExtractPromptFeaturesFromMessages(messages)
	if features.instructionText != "follow the response policy. preserve the headings. summarize the previous answer." {
		t.Fatalf("role-aware instruction = %q", features.instructionText)
	}
	if features.instructionContextText != "follow the response policy. preserve the headings." {
		t.Fatalf("system/developer instruction context = %q", features.instructionContextText)
	}
	if features.payloadText != "<instruction>translate this payload to french.</instruction>" || features.payloadBlockCount != 1 {
		t.Fatalf("assistant context was not isolated as payload: %#v", features)
	}
	if features.payloadBoundaryEvidence&payloadBoundaryMessageRole == 0 || features.payloadSplitConfidence != payloadSplitConfidenceHigh {
		t.Fatalf("message role evidence/confidence was not retained: %#v", features)
	}

	classification := NewRuleBasedPromptClassifier().ClassifyMessages(messages)
	if classification.Category.Category != CategorySummarization {
		t.Fatalf("assistant payload contaminated category = %q, want summarization", classification.Category.Category)
	}
}

func TestExtractPromptFeaturesFromMessagesKeepsBoundedTailAndUnknownRoleInstruction(t *testing.T) {
	t.Parallel()

	messages := []PromptMessage{
		{Role: "assistant", Text: strings.Repeat("context ", maxCategoryScanBytes)},
		{Role: "custom", Text: "Summarize the final answer."},
	}
	features := ExtractPromptFeaturesFromMessages(messages)
	if !features.wasTruncated {
		t.Fatal("long role-aware prompt must use bounded head and tail scan")
	}
	if !strings.Contains(features.instructionText, "summarize the final answer") {
		t.Fatalf("tail instruction was not retained: %q", features.instructionText)
	}
	if features.payloadBlockCount != 1 || features.payloadBoundaryEvidence&payloadBoundaryMessageRole == 0 {
		t.Fatalf("one assistant message must remain one context payload block: %#v", features)
	}
}

func TestExtractPromptFeaturesTreatsUnclosedPayloadTagAsLowConfidence(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("Summarize in three lines. <document>security risk and deadline")
	if features.instructionText != "summarize in three lines." || features.payloadText != "security risk and deadline" {
		t.Fatalf("unclosed tagged payload was not separated: %#v", features)
	}
	if features.payloadBlockCount != 1 || features.payloadSplitConfidence != payloadSplitConfidenceLow {
		t.Fatalf("unclosed tagged payload block/confidence = (%d, %d), want (1, low)", features.payloadBlockCount, features.payloadSplitConfidence)
	}
}

func TestExtractPromptFeaturesAlternatesRoleHeadingSections(t *testing.T) {
	t.Parallel()

	prompt := "[명령]\n세 줄로 요약해줘.\n[원문]\n첫 번째 회의록\n[request]\nInclude the decision.\n[payload]\nsecond source"
	features := ExtractPromptFeatures(prompt)
	if features.instructionText != "세 줄로 요약해줘. include the decision." {
		t.Fatalf("heading instruction = %q, want only instruction sections", features.instructionText)
	}
	if features.payloadText != "첫 번째 회의록\nsecond source" || features.payloadBlockCount != 2 {
		t.Fatalf("heading payload sections were not separated: %#v", features)
	}
	if features.payloadBoundaryEvidence&payloadBoundaryHeading == 0 || features.payloadSplitConfidence != payloadSplitConfidenceHigh {
		t.Fatalf("heading payload evidence/confidence = (%d, %d), want heading/high", features.payloadBoundaryEvidence, features.payloadSplitConfidence)
	}
}

func TestExtractPromptFeaturesSeparatesBeginEndPayloadBlock(t *testing.T) {
	t.Parallel()

	prompt := "Analyze the differences.\n--- BEGIN SOURCE ---\nfirst fact\nsecond fact\n--- END SOURCE ---\nThen summarize the result."
	features := ExtractPromptFeatures(prompt)
	if features.instructionText != "analyze the differences. then summarize the result." {
		t.Fatalf("begin/end instruction = %q, want surrounding instructions", features.instructionText)
	}
	if features.payloadText != "first fact second fact" || features.payloadBlockCount != 1 {
		t.Fatalf("begin/end payload was not separated: %#v", features)
	}
	if features.payloadBoundaryEvidence&payloadBoundaryBeginEnd == 0 || features.payloadSplitConfidence != payloadSplitConfidenceHigh {
		t.Fatalf("begin/end evidence/confidence = (%d, %d), want begin-end/high", features.payloadBoundaryEvidence, features.payloadSplitConfidence)
	}
}

func TestExtractPromptFeaturesSeparatesGuardedBlockQuote(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("Summarize this passage:\n> first fact\n> second fact")
	if features.instructionText != "summarize this passage:" || features.payloadText != "first fact second fact" {
		t.Fatalf("guarded blockquote was not separated: %#v", features)
	}
	if features.payloadBlockCount != 1 || features.payloadBoundaryEvidence&payloadBoundaryBlockQuote == 0 || features.payloadSplitConfidence != payloadSplitConfidenceHigh {
		t.Fatalf("blockquote count/evidence/confidence were not preserved: %#v", features)
	}

	unguarded := ExtractPromptFeatures("A quoted note:\n> summarize this someday")
	if unguarded.payloadBlockCount != 0 || unguarded.payloadText != "" {
		t.Fatalf("unguarded blockquote became payload: %#v", unguarded)
	}
	if !strings.Contains(unguarded.instructionText, "summarize this someday") {
		t.Fatalf("unguarded blockquote was removed from instruction: %q", unguarded.instructionText)
	}

	payloadActionOnly := ExtractPromptFeatures("```text\nsummarize this source\n```\n> quoted note")
	if payloadActionOnly.payloadBlockCount != 1 || payloadActionOnly.payloadBoundaryEvidence != payloadBoundaryCodeFence {
		t.Fatalf("action inside an earlier payload guarded a later blockquote: %#v", payloadActionOnly)
	}
	if !strings.Contains(payloadActionOnly.instructionText, "quoted note") {
		t.Fatalf("blockquote without instruction action was removed: %q", payloadActionOnly.instructionText)
	}
}

func TestExtractPromptFeaturesSeparatesLimitedPayloadCue(t *testing.T) {
	t.Parallel()

	for _, test := range []struct {
		name        string
		prompt      string
		instruction string
		payload     string
	}{
		{
			name:        "english",
			prompt:      "Summarize the following content:\nsecurity risk and deadline",
			instruction: "summarize the following content:",
			payload:     "security risk and deadline",
		},
		{
			name:        "korean",
			prompt:      "다음 내용을 세 줄로 요약해줘:\n보안 위험과 마감 일정",
			instruction: "다음 내용을 세 줄로 요약해줘:",
			payload:     "보안 위험과 마감 일정",
		},
	} {
		test := test
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			features := ExtractPromptFeatures(test.prompt)
			if features.instructionText != test.instruction || features.payloadText != test.payload {
				t.Fatalf("limited cue was not separated: %#v", features)
			}
			if features.payloadBlockCount != 1 || features.payloadBoundaryEvidence&payloadBoundaryCue == 0 || features.payloadSplitConfidence != payloadSplitConfidenceHigh {
				t.Fatalf("cue count/evidence/confidence were not preserved: %#v", features)
			}
		})
	}

	unguarded := ExtractPromptFeatures("Summarize content when ready: security risk and deadline")
	if unguarded.payloadBlockCount != 0 || unguarded.payloadText != "" {
		t.Fatalf("non-whitelisted cue became payload: %#v", unguarded)
	}
}

func TestExtractPromptFeaturesLetsOutermostPayloadBoundaryOwnNestedMarkers(t *testing.T) {
	t.Parallel()

	prompt := "Summarize this source.\n<document>\n[payload]\n```text\nnested content\n```\n</document>\nThen explain the result."
	features := ExtractPromptFeatures(prompt)
	if features.payloadBlockCount != 1 {
		t.Fatalf("nested payload markers created extra blocks: %#v", features)
	}
	if features.payloadBoundaryEvidence != payloadBoundaryTag {
		t.Fatalf("nested payload evidence = %d, want outer tag only", features.payloadBoundaryEvidence)
	}
	if strings.Contains(features.instructionText, "nested content") || !strings.Contains(features.payloadText, "nested content") {
		t.Fatalf("nested payload ownership was not preserved: %#v", features)
	}
}

func TestExtractPromptFeaturesCombinesIndependentBoundaryEvidence(t *testing.T) {
	t.Parallel()

	prompt := "[request]\nSummarize the sources.\n[payload]\nfirst source\n[instruction]\nCompare the decisions.\n<document>second source</document>"
	features := ExtractPromptFeatures(prompt)
	if features.payloadBlockCount != 2 {
		t.Fatalf("independent payload block count = %d, want 2: %#v", features.payloadBlockCount, features)
	}
	wantEvidence := payloadBoundaryHeading | payloadBoundaryTag
	if features.payloadBoundaryEvidence != wantEvidence || features.payloadSplitConfidence != payloadSplitConfidenceHigh {
		t.Fatalf("independent evidence/confidence = (%d, %d), want (%d, high)", features.payloadBoundaryEvidence, features.payloadSplitConfidence, wantEvidence)
	}
	if features.instructionText != "summarize the sources. compare the decisions." || features.payloadText != "first source\nsecond source" {
		t.Fatalf("independent boundaries were not separated: %#v", features)
	}
}

func TestExtractPromptFeaturesKeepsUnsupportedAndUnmatchedMarkersInInstruction(t *testing.T) {
	t.Parallel()

	prompt := "Summarize this input.\n[output]\ncontext:\n</document>\n<document />"
	features := ExtractPromptFeatures(prompt)
	if features.payloadBlockCount != 0 || features.payloadText != "" || features.payloadSplitConfidence != payloadSplitConfidenceNone {
		t.Fatalf("unsupported or unmatched markers created payload: %#v", features)
	}
	for _, marker := range []string{"[output]", "context:", "</document>", "<document />"} {
		if !strings.Contains(features.instructionText, marker) {
			t.Fatalf("marker %q was removed from instruction: %q", marker, features.instructionText)
		}
	}
}

func TestExtractPromptFeaturesMarksTruncatedPayloadBoundaryLowConfidence(t *testing.T) {
	t.Parallel()

	prompt := "Review this source. <document>" + strings.Repeat("x", maxCategoryScanBytes*2) + "</document> Summarize the result."
	features := ExtractPromptFeatures(prompt)
	if features.payloadBlockCount != 1 || features.payloadSplitConfidence != payloadSplitConfidenceLow {
		t.Fatalf("truncated cross-gap boundary count/confidence = (%d, %d), want (1, low)", features.payloadBlockCount, features.payloadSplitConfidence)
	}
	if strings.Contains(features.instructionText, strings.Repeat("x", 32)) || !strings.Contains(features.instructionText, "summarize the result") {
		t.Fatalf("truncated payload contaminated or removed instruction: %#v", features)
	}
}

func TestExtractPromptFeaturesInfersPayloadOpeningInsideTruncatedGap(t *testing.T) {
	t.Parallel()

	prompt := "Review this source. " + strings.Repeat("a", maxCategoryScanBytes) + "<document>" + strings.Repeat("z", maxCategoryScanBytes) + "</document> Summarize the result."
	features := ExtractPromptFeatures(prompt)
	if features.payloadBlockCount != 1 || features.payloadSplitConfidence != payloadSplitConfidenceLow {
		t.Fatalf("gap-inferred payload count/confidence = (%d, %d), want (1, low)", features.payloadBlockCount, features.payloadSplitConfidence)
	}
	if strings.Contains(features.instructionText, strings.Repeat("z", 32)) || !strings.Contains(features.payloadText, strings.Repeat("z", 32)) {
		t.Fatalf("gap-inferred payload was not kept out of instruction: %#v", features)
	}
	if !strings.Contains(features.instructionText, "summarize the result") {
		t.Fatalf("tail instruction after inferred close was lost: %q", features.instructionText)
	}
}

func TestExtractPromptFeaturesUsesBoundedHeadAndTailScan(t *testing.T) {
	t.Parallel()

	prompt := strings.Repeat("x", maxCategoryScanBytes*2) + " Summarize the result."
	features := ExtractPromptFeatures(prompt)
	if !features.wasTruncated {
		t.Fatal("long prompt must record bounded truncation")
	}
	if !strings.Contains(features.instructionText, "summarize the result") {
		t.Fatalf("tail instruction was not retained: %q", features.instructionText)
	}
	if actual := NewRuleBasedCategoryClassifier().ClassifyFeatures(features).Category; actual != CategorySummarization {
		t.Fatalf("tail instruction category = %q, want summarization", actual)
	}

	fencedPrompt := "Review this source. ```text\n" + strings.Repeat("x", maxCategoryScanBytes*2) + "\n``` Summarize the result."
	fencedFeatures := ExtractPromptFeatures(fencedPrompt)
	if fencedFeatures.payloadBlockCount != 1 || !strings.Contains(fencedFeatures.instructionText, "summarize the result") {
		t.Fatalf("truncated fenced tail boundary was not retained: %#v", fencedFeatures)
	}
	if strings.Contains(fencedFeatures.instructionText, strings.Repeat("x", 32)) {
		t.Fatalf("truncated fenced payload leaked into instruction: %q", fencedFeatures.instructionText)
	}
}

func TestExtractPromptFeaturesPreservesListStructure(t *testing.T) {
	t.Parallel()

	prompt := "Handle these items:\n1. Explain A\n2. Explain B\n3. Explain C"
	features := ExtractPromptFeatures(prompt)
	if features.listItemCount != 3 || features.scopeCount != 3 {
		t.Fatalf("list scope was not derived: %#v", features)
	}
	if features.taskCount != 3 || features.clauseCount < 3 {
		t.Fatalf("list task units were not derived: %#v", features)
	}
}

func TestExtractPromptFeaturesCountsNumericAndNamedScope(t *testing.T) {
	t.Parallel()

	tests := []struct {
		prompt string
		want   int
	}{
		{prompt: "Compare 5 documents.", want: 5},
		{prompt: "2개 파일을 분석해줘.", want: 2},
		{prompt: "A와 B를 비교해줘.", want: 2},
	}
	for _, test := range tests {
		test := test
		t.Run(test.prompt, func(t *testing.T) {
			t.Parallel()
			if actual := ExtractPromptFeatures(test.prompt).scopeCount; actual != test.want {
				t.Fatalf("scopeCount = %d, want %d", actual, test.want)
			}
		})
	}
}

func TestCategoryIntentIgnoresNonCodeFencedPayload(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("Summarize this source. ```translate the notice to korean```")
	if actual := NewRuleBasedCategoryClassifier().ClassifyFeatures(features).Category; actual != CategorySummarization {
		t.Fatalf("category = %q, want summarization", actual)
	}

	codeFeatures := ExtractPromptFeatures("```go\nfunc main() {}\n```")
	if codeFeatures.scopeCount != 1 {
		t.Fatalf("fenced code scopeCount = %d, want 1", codeFeatures.scopeCount)
	}
	if actual := NewRuleBasedCategoryClassifier().ClassifyFeatures(codeFeatures).Category; actual != CategoryCode {
		t.Fatalf("fenced code category = %q, want code", actual)
	}
}

func TestExtractPromptFeaturesCountsLeadingDependencyKeywords(t *testing.T) {
	t.Parallel()

	for _, prompt := range []string{
		"if ready",
		"then continue",
		"after review",
		"before release",
		"otherwise stop",
	} {
		prompt := prompt
		t.Run(prompt, func(t *testing.T) {
			t.Parallel()
			if actual := ExtractPromptFeatures(prompt).dependencyDepth; actual != 1 {
				t.Fatalf("dependencyDepth for %q = %d, want 1", prompt, actual)
			}
		})
	}
}

func TestGeneralDifficultyFeaturesCountLeadingIfOnce(t *testing.T) {
	t.Parallel()

	for _, prompt := range []string{
		"if ready",
		"if ready, reconsider if needed",
	} {
		prompt := prompt
		t.Run(prompt, func(t *testing.T) {
			t.Parallel()
			features := ExtractDifficultyFeatures(ExtractPromptFeatures(prompt), CategoryGeneral)
			if features.general == nil {
				t.Fatal("general difficulty features are nil")
			}
			if actual := features.general.branchOrExceptionCount; actual != 1 {
				t.Fatalf("branchOrExceptionCount for %q = %d, want 1", prompt, actual)
			}
		})
	}
}

func TestExtractPromptFeaturesSeparatesCodeFencePayload(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("Fix and explain this code. ```go func main() {}``` Preserve the output format.")
	if !features.hasCodeFence || features.payloadText == "" {
		t.Fatalf("code payload was not separated: %#v", features)
	}
	if strings.Contains(features.instructionText, "func main") {
		t.Fatalf("instruction text retained code payload: %q", features.instructionText)
	}
}

func TestCategoryFeaturesRequireIntentAndSuppressNegativeContext(t *testing.T) {
	t.Parallel()

	codeFeatures := extractCategoryFeatures(ExtractPromptFeatures("Fix this TypeScript function error."))
	if codeFeatures.code.actionScore == 0 || codeFeatures.code.objectFitScore == 0 || codeFeatures.code.intentPairScore == 0 {
		t.Fatalf("code intent pair was not derived: %#v", codeFeatures.code)
	}

	menuFeatures := extractCategoryFeatures(ExtractPromptFeatures("API 키 목록이 안 보일 때 확인할 순서를 알려줘."))
	if menuFeatures.code.negativeContextScore == 0 {
		t.Fatalf("API key navigation context was not suppressed: %#v", menuFeatures.code)
	}
	if actual := NewRuleBasedCategoryClassifier().ClassifyFeatures(ExtractPromptFeatures("API 키 목록이 안 보일 때 확인할 순서를 알려줘.")).Category; actual != CategoryGeneral {
		t.Fatalf("API key navigation category = %q, want general", actual)
	}
}

func TestExtractDifficultyFeaturesUsesOnlySelectedCategoryRules(t *testing.T) {
	t.Parallel()

	features := ExtractPromptFeatures("Translate this while preserving formal tone and legal terminology.")
	translation := ExtractDifficultyFeatures(features, CategoryTranslation)
	code := ExtractDifficultyFeatures(features, CategoryCode)

	if translation.translation == nil || translation.translation.preservationConstraintCount < 2 {
		t.Fatalf("translation-specific features were not extracted: %#v", translation.translation)
	}
	if translation.code != nil || translation.general != nil || translation.summarization != nil || translation.reasoning != nil {
		t.Fatalf("non-selected category features were populated: %#v", translation)
	}
	if code.code == nil || code.translation != nil || code.general != nil || code.summarization != nil || code.reasoning != nil {
		t.Fatalf("selected code feature boundary was not preserved: %#v", code)
	}
	if translation.category != CategoryTranslation || code.category != CategoryCode {
		t.Fatalf("selected category was not preserved: translation=%q code=%q", translation.category, code.category)
	}
}

func TestCategorySpecificDifficultyFeaturesAreDerived(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		prompt   string
		category string
		check    func(DifficultyFeatures) bool
	}{
		{
			name: "general workflow", prompt: "여러 정책을 종합하고 실패 시 복구 절차를 단계별로 알려줘.", category: CategoryGeneral,
			check: func(features DifficultyFeatures) bool {
				return features.general != nil && features.general.workflowDepth >= 2 && features.general.hasCrossSourceSynthesis
			},
		},
		{
			name: "code concurrency", prompt: "여러 서비스의 경쟁 조건을 분석하고 성능 테스트 경계를 제시해줘.", category: CategoryCode,
			check: func(features DifficultyFeatures) bool {
				return features.code != nil && features.code.codeOperationKind == "concurrency" && features.code.causalComplexity > 0
			},
		},
		{
			name: "translation preservation", prompt: "법률 용어와 표 형식을 유지해 존댓말로 번역해줘.", category: CategoryTranslation,
			check: func(features DifficultyFeatures) bool {
				return features.translation != nil && features.translation.preservationConstraintCount >= 2 && features.translation.domainTerminologyLevel == 2
			},
		},
		{
			name: "summary synthesis", prompt: "세 문서의 충돌점과 결정 사항, 담당자를 근거와 함께 중복 없이 요약해줘.", category: CategorySummarization,
			check: func(features DifficultyFeatures) bool {
				return features.summarization != nil && features.summarization.sourceBreadth >= 3 && features.summarization.synthesisLevel == 2
			},
		},
		{
			name: "reasoning scenarios", prompt: "세 대안을 비용, 위험, 일정 기준으로 비교하고 실패 경로까지 단계별로 설명해줘.", category: CategoryReasoning,
			check: func(features DifficultyFeatures) bool {
				return features.reasoning != nil && features.reasoning.alternativeCount >= 3 && features.reasoning.criteriaAndConstraintCount >= 3
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			features := ExtractDifficultyFeatures(ExtractPromptFeatures(test.prompt), test.category)
			if !test.check(features) {
				t.Fatalf("category-specific difficulty features were not derived: %#v", features)
			}
		})
	}
}

func TestModelCapabilityFeaturesRemainOutsideClassification(t *testing.T) {
	t.Parallel()

	promptFeatures := ExtractPromptFeatures("Search the web and compare these two plans.")
	capabilityFeatures := ExtractModelCapabilityFeatures(promptFeatures)
	if capabilityFeatures.inputTokenEstimate <= 0 || !capabilityFeatures.toolIntent {
		t.Fatalf("capability features were not derived: %#v", capabilityFeatures)
	}

	typeOfPromptFeatures := reflect.TypeOf(promptFeatures)
	for _, forbidden := range []string{"inputTokenEstimate", "toolIntent"} {
		if _, exists := typeOfPromptFeatures.FieldByName(forbidden); exists {
			t.Fatalf("capability field leaked into PromptFeatures: %q", forbidden)
		}
	}
}

func BenchmarkRuleBasedPromptClassifier(b *testing.B) {
	classifier := NewRuleBasedPromptClassifier()
	prompt := "Compare these API implementation options and recommend one with tradeoffs."
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		_ = classifier.Classify(prompt)
	}
}
