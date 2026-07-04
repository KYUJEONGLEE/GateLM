package stagetiming

import (
	"sort"
	"strings"
	"time"
)

const (
	StagePolicyChecksTotal = "policy_checks_total"
	StagePIIMasking        = "pii_masking"
	StageCacheExactLookup  = "cache_exact_lookup"
	StageCacheSemantic     = "cache_semantic_check"
	StageProviderResponse  = "provider_response_wait"
)

type Timing struct {
	DurationMs float64 `json:"durationMs"`
	Count      int     `json:"count,omitempty"`
}

type Timings map[string]Timing

func Record(timings *Timings, stage string, duration time.Duration) {
	stage = strings.TrimSpace(stage)
	if timings == nil || stage == "" {
		return
	}
	if *timings == nil {
		*timings = Timings{}
	}

	durationMs := float64(duration) / float64(time.Millisecond)

	current := (*timings)[stage]
	current.DurationMs += durationMs
	current.Count++
	(*timings)[stage] = current
}

func Clone(timings Timings) Timings {
	if len(timings) == 0 {
		return nil
	}
	clone := make(Timings, len(timings))
	for stage, timing := range timings {
		stage = strings.TrimSpace(stage)
		if stage == "" {
			continue
		}
		clone[stage] = timing
	}
	return clone
}

func Merge(dst *Timings, src Timings) {
	if dst == nil || len(src) == 0 {
		return
	}
	if *dst == nil {
		*dst = Timings{}
	}
	for stage, timing := range src {
		stage = strings.TrimSpace(stage)
		if stage == "" {
			continue
		}
		current := (*dst)[stage]
		current.DurationMs += timing.DurationMs
		current.Count += timing.Count
		(*dst)[stage] = current
	}
}

func OrderedStages(timings Timings) []string {
	if len(timings) == 0 {
		return nil
	}
	stages := make([]string, 0, len(timings))
	for stage := range timings {
		if strings.TrimSpace(stage) != "" {
			stages = append(stages, stage)
		}
	}
	sort.Strings(stages)
	return stages
}
