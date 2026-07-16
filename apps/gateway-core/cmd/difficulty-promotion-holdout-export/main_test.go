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

func TestBuildPromotionHoldoutInputSecondUntouchedFreeze(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve test path")
	}
	root := filepath.Clean(filepath.Join(filepath.Dir(filename), "..", "..", "..", ".."))
	result, err := buildPromotionHoldoutInput(
		filepath.Join(root, "docs", "v2.1.0", "training", "difficulty-training-candidate-expansion-2000.owner-approved.jsonl"),
		filepath.Join(root, "docs", "v2.1.0", "training", "difficulty-training-candidate-expansion-2000.owner-approved.manifest.json"),
		filepath.Join(root, "docs", "v2.1.0", "evaluation", "difficulty-promotion-holdout-100.v2.json"),
	)
	if err != nil {
		t.Fatal(err)
	}
	artifactBytes, err := json.Marshal(result.Artifact)
	if err != nil {
		t.Fatal(err)
	}
	var artifact map[string]any
	if err := json.Unmarshal(artifactBytes, &artifact); err != nil {
		t.Fatal(err)
	}
	if artifact["thresholdPolicyVersion"] != "difficulty-threshold-v2" || artifact["threshold"] != 0.06 {
		t.Fatalf("second freeze artifact = %#v", artifact)
	}
	if result.HoldoutRecords != 100 || result.HoldoutFamilies != 10 || len(result.Samples) != 100 {
		t.Fatalf("unexpected second promotion export: %+v", result)
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
