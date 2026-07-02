package masking

import (
	"context"
	"sort"
	"strings"
)

const DefaultSecurityPolicyVersionID = "security_policy_p0_v1"
const RedactedPromptPreviewMaxRunes = 120

type Engine struct {
	registry                Registry
	securityPolicyVersionID string
}

type ApplyRequest struct {
	Prompt                  string
	SecurityPolicyVersionID string
	EntityScope             *EntityScope
}

func NewEngine(registry Registry, securityPolicyVersionID string) Engine {
	if strings.TrimSpace(securityPolicyVersionID) == "" {
		securityPolicyVersionID = DefaultSecurityPolicyVersionID
	}
	return Engine{
		registry:                registry,
		securityPolicyVersionID: securityPolicyVersionID,
	}
}

func NewP0Engine() Engine {
	return NewEngine(NewP0Registry(), DefaultSecurityPolicyVersionID)
}

func (e Engine) Apply(_ context.Context, req ApplyRequest) (Result, error) {
	securityPolicyVersionID := strings.TrimSpace(req.SecurityPolicyVersionID)
	if securityPolicyVersionID == "" {
		securityPolicyVersionID = e.securityPolicyVersionID
	}
	if securityPolicyVersionID == "" {
		securityPolicyVersionID = DefaultSecurityPolicyVersionID
	}

	effective := effectiveDetections(e.registry.Detect(req.Prompt))
	if len(effective) == 0 {
		return Result{
			Action:                  ActionNone,
			RedactedPrompt:          req.Prompt,
			RedactedPromptPreview:   PreviewRedactedPrompt(req.Prompt),
			SecurityPolicyVersionID: securityPolicyVersionID,
		}, nil
	}

	action := ActionNone
	for _, detection := range effective {
		if detection.Action == ActionBlocked {
			action = ActionBlocked
			break
		}
		if detection.Action == ActionRedacted {
			action = ActionRedacted
		}
	}

	entityScope := req.EntityScope
	if entityScope == nil {
		entityScope = NewEntityScope()
	}
	effective = detectionsWithEntityPlaceholders(req.Prompt, effective, entityScope)
	redactedPrompt := redact(req.Prompt, effective)
	return Result{
		Action:                  action,
		DetectedTypes:           detectedTypes(effective),
		DetectedCount:           len(effective),
		RedactedPrompt:          redactedPrompt,
		RedactedPromptPreview:   PreviewRedactedPrompt(redactedPrompt),
		SecurityPolicyVersionID: securityPolicyVersionID,
	}, nil
}

func detectionsWithEntityPlaceholders(input string, detections []Detection, entityScope *EntityScope) []Detection {
	if len(detections) == 0 || entityScope == nil {
		return detections
	}

	withPlaceholders := make([]Detection, len(detections))
	copy(withPlaceholders, detections)
	for index, detection := range withPlaceholders {
		if detection.Action != ActionRedacted || detection.Start < 0 || detection.End > len(input) || detection.End <= detection.Start {
			continue
		}
		rawValue := input[detection.Start:detection.End]
		roleContext := personRoleContext{}
		if DetectorType(detection.Type) == DetectorPersonName {
			roleContext = inferPersonRoleContext(input, detection.Start)
		}
		withPlaceholders[index].Placeholder = entityScope.PlaceholderForRole(detection.Type, rawValue, roleContext.prefix, detection.Placeholder)
		if roleContext.consumeLabel {
			withPlaceholders[index].Start = roleContext.redactStart
		}
	}
	return withPlaceholders
}

func PreviewRedactedPrompt(prompt string) string {
	normalized := strings.Join(strings.Fields(strings.TrimSpace(prompt)), " ")
	runes := []rune(normalized)
	if len(runes) <= RedactedPromptPreviewMaxRunes {
		return normalized
	}
	return string(runes[:RedactedPromptPreviewMaxRunes]) + "..."
}

func effectiveDetections(detections []Detection) []Detection {
	candidates := make([]Detection, 0, len(detections))
	for _, detection := range detections {
		if detection.Start < 0 || detection.End <= detection.Start {
			continue
		}
		candidates = append(candidates, detection)
	}

	sort.SliceStable(candidates, func(i int, j int) bool {
		left := candidates[i]
		right := candidates[j]
		if actionRank(left.Action) != actionRank(right.Action) {
			return actionRank(left.Action) > actionRank(right.Action)
		}
		if left.Priority != right.Priority {
			return left.Priority < right.Priority
		}
		if detectionLength(left) != detectionLength(right) {
			return detectionLength(left) > detectionLength(right)
		}
		return left.Start < right.Start
	})

	selected := make([]Detection, 0, len(candidates))
	for _, candidate := range candidates {
		if overlapsAny(candidate, selected) {
			continue
		}
		selected = append(selected, candidate)
	}

	sort.SliceStable(selected, func(i int, j int) bool {
		if selected[i].Start != selected[j].Start {
			return selected[i].Start < selected[j].Start
		}
		return selected[i].End < selected[j].End
	})

	return selected
}

func actionRank(action Action) int {
	switch action {
	case ActionBlocked:
		return 2
	case ActionRedacted:
		return 1
	default:
		return 0
	}
}

func detectionLength(detection Detection) int {
	return detection.End - detection.Start
}

func overlapsAny(candidate Detection, selected []Detection) bool {
	for _, existing := range selected {
		if candidate.Start < existing.End && existing.Start < candidate.End {
			return true
		}
	}
	return false
}

func detectedTypes(detections []Detection) []string {
	seen := map[string]struct{}{}
	for _, detection := range detections {
		if detection.Type == "" {
			continue
		}
		seen[detection.Type] = struct{}{}
	}

	types := make([]string, 0, len(seen))
	for detectorType := range seen {
		types = append(types, detectorType)
	}
	sort.Strings(types)
	return types
}

func redact(input string, detections []Detection) string {
	if len(detections) == 0 {
		return input
	}

	var builder strings.Builder
	offset := 0
	for _, detection := range detections {
		if detection.Start < offset || detection.End > len(input) {
			continue
		}
		builder.WriteString(input[offset:detection.Start])
		builder.WriteString(detection.Placeholder)
		offset = detection.End
	}
	builder.WriteString(input[offset:])
	return builder.String()
}
