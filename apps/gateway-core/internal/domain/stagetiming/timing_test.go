package stagetiming

import (
	"reflect"
	"testing"
	"time"
)

func TestRecordAccumulatesDurationAndCount(t *testing.T) {
	var timings Timings

	Record(&timings, "  pii_masking  ", 10*time.Millisecond)
	Record(&timings, "pii_masking", 5*time.Millisecond)
	Record(&timings, " ", 3*time.Millisecond)
	Record(nil, "ignored", 3*time.Millisecond)

	timing := timings["pii_masking"]
	if timing.DurationMs != 15 {
		t.Fatalf("expected accumulated duration 15ms, got %f", timing.DurationMs)
	}
	if timing.Count != 2 {
		t.Fatalf("expected count 2, got %d", timing.Count)
	}
	if _, exists := timings[""]; exists {
		t.Fatal("blank stage should be ignored")
	}
}

func TestCloneTrimsStagesAndDoesNotAliasSource(t *testing.T) {
	source := Timings{
		" provider_response_wait ": {DurationMs: 120, Count: 1},
		" ":                        {DurationMs: 3, Count: 1},
	}

	clone := Clone(source)
	if len(clone) != 1 {
		t.Fatalf("expected one non-empty stage, got %#v", clone)
	}
	if clone["provider_response_wait"].DurationMs != 120 {
		t.Fatalf("unexpected cloned timing: %#v", clone["provider_response_wait"])
	}

	source[" provider_response_wait "] = Timing{DurationMs: 1, Count: 9}
	if clone["provider_response_wait"].DurationMs != 120 {
		t.Fatalf("clone should not change when source changes: %#v", clone["provider_response_wait"])
	}
}

func TestCloneReturnsNilForEmptyTimings(t *testing.T) {
	if Clone(nil) != nil {
		t.Fatal("nil timings should clone to nil")
	}
	if Clone(Timings{}) != nil {
		t.Fatal("empty timings should clone to nil")
	}
}

func TestMergeAccumulatesTimings(t *testing.T) {
	dst := Timings{
		"policy_checks_total": {DurationMs: 8, Count: 1},
	}
	src := Timings{
		"policy_checks_total": {DurationMs: 2, Count: 1},
		" pii_masking ":       {DurationMs: 4, Count: 1},
		" ":                   {DurationMs: 99, Count: 1},
	}

	Merge(&dst, src)

	if got := dst["policy_checks_total"]; got.DurationMs != 10 || got.Count != 2 {
		t.Fatalf("unexpected accumulated policy timing: %#v", got)
	}
	if got := dst["pii_masking"]; got.DurationMs != 4 || got.Count != 1 {
		t.Fatalf("unexpected merged PII timing: %#v", got)
	}
	if _, exists := dst[""]; exists {
		t.Fatal("blank stage should be ignored")
	}
}

func TestMergeInitializesNilDestination(t *testing.T) {
	var dst Timings

	Merge(&dst, Timings{"cache_exact_lookup": {DurationMs: 3, Count: 1}})

	if got := dst["cache_exact_lookup"]; got.DurationMs != 3 || got.Count != 1 {
		t.Fatalf("unexpected initialized merge result: %#v", got)
	}
}

func TestMergeIgnoresNilDestinationPointer(t *testing.T) {
	Merge(nil, Timings{"cache_exact_lookup": {DurationMs: 3, Count: 1}})
}

func TestOrderedStagesSortsAndSkipsBlankStages(t *testing.T) {
	stages := OrderedStages(Timings{
		"provider_response_wait": {DurationMs: 120, Count: 1},
		" ":                      {DurationMs: 1, Count: 1},
		"cache_exact_lookup":     {DurationMs: 2, Count: 1},
	})

	expected := []string{"cache_exact_lookup", "provider_response_wait"}
	if !reflect.DeepEqual(stages, expected) {
		t.Fatalf("expected ordered stages %#v, got %#v", expected, stages)
	}
}
