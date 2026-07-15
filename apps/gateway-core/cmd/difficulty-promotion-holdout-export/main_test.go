package main

import (
	"encoding/json"
	"path/filepath"
	"runtime"
	"testing"
)

func TestBuildPromotionHoldoutInputCanonical(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test path")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "..", "..", ".."))
	result, err := buildPromotionHoldoutInput(
		filepath.Join(root, "docs", "v2.1.0", "training", "difficulty-training-candidate-expansion-2000.owner-approved.jsonl"),
		filepath.Join(root, "docs", "v2.1.0", "training", "difficulty-training-candidate-expansion-2000.owner-approved.manifest.json"),
		filepath.Join(root, "docs", "v2.1.0", "evaluation", "difficulty-promotion-holdout-100.v1.json"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.SchemaVersion != promotionHoldoutInputSchema || result.HoldoutRecords != 100 ||
		result.HoldoutFamilies != 10 || len(result.Samples) != 100 || result.ModelPathRecords <= 0 {
		t.Fatalf("unexpected canonical promotion export: %+v", result)
	}
	payload, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"redactedPrompt", "embedding", "rawProbability", "logit"} {
		if stringContains(string(payload), forbidden) {
			t.Fatalf("promotion export contains forbidden field %q", forbidden)
		}
	}
}

func stringContains(value, fragment string) bool {
	for index := 0; index+len(fragment) <= len(value); index++ {
		if value[index:index+len(fragment)] == fragment {
			return true
		}
	}
	return false
}
