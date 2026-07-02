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
	DetectorPolicies        []DetectorPolicy
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

	effectiveAll := effectiveDetections(applyDetectorPolicies(e.registry.Detect(req.Prompt), req.DetectorPolicies))
	protected := detectionsWithProtection(effectiveAll)
	allowed := detectionsAllowedByPolicy(effectiveAll)
	if len(effectiveAll) == 0 {
		return Result{
			Action:                  ActionNone,
			RedactedPrompt:          req.Prompt,
			LogSafePrompt:           req.Prompt,
			RedactedPromptPreview:   PreviewRedactedPrompt(req.Prompt),
			SecurityPolicyVersionID: securityPolicyVersionID,
		}, nil
	}

	action := ActionNone
	for _, detection := range protected {
		if detection.Action == ActionBlocked {
			action = ActionBlocked
			break
		}
		if detection.Action == ActionRedacted {
			action = ActionRedacted
		}
	}

	redactedPrompt := redact(req.Prompt, protected)
	logSafePrompt := redact(req.Prompt, effectiveAll)
	return Result{
		Action:                  action,
		DetectedTypes:           detectedTypes(protected),
		DetectedCount:           len(protected),
		PolicyAllowedTypes:      detectedTypes(allowed),
		PolicyAllowedCount:      len(allowed),
		MandatoryProtectedTypes: mandatoryProtectedTypes(protected),
		RedactedPrompt:          redactedPrompt,
		LogSafePrompt:           logSafePrompt,
		RedactedPromptPreview:   PreviewRedactedPrompt(logSafePrompt),
		SecurityPolicyVersionID: securityPolicyVersionID,
	}, nil
}

func applyDetectorPolicies(detections []Detection, policies []DetectorPolicy) []Detection {
	if len(detections) == 0 {
		return nil
	}
	overrides := detectorPolicyMap(policies)
	applied := make([]Detection, 0, len(detections))
	for _, detection := range detections {
		if detection.Start < 0 || detection.End <= detection.Start {
			continue
		}
		detection.Type = strings.TrimSpace(detection.Type)
		if detection.Placeholder == "" {
			placeholder, _ := PlaceholderForDetector(detection.Type)
			detection.Placeholder = placeholder
		}
		if override, ok := overrides[detection.Type]; ok {
			switch override {
			case PolicyActionAllow:
				if !IsMandatoryDetector(detection.Type) {
					detection.Action = ActionNone
				}
			case PolicyActionRedact:
				detection.Action = ActionRedacted
			case PolicyActionBlock:
				detection.Action = ActionBlocked
			}
		}
		applied = append(applied, detection)
	}
	return applied
}

func detectorPolicyMap(policies []DetectorPolicy) map[string]PolicyAction {
	if len(policies) == 0 {
		return nil
	}
	overrides := make(map[string]PolicyAction, len(policies))
	for _, policy := range policies {
		detectorType := strings.TrimSpace(policy.DetectorType)
		action := PolicyAction(strings.TrimSpace(string(policy.Action)))
		switch action {
		case PolicyActionAllow, PolicyActionRedact, PolicyActionBlock:
			if detectorType != "" {
				overrides[detectorType] = action
			}
		}
	}
	return overrides
}

func detectionsWithProtection(detections []Detection) []Detection {
	protected := make([]Detection, 0, len(detections))
	for _, detection := range detections {
		if detection.Action == ActionRedacted || detection.Action == ActionBlocked {
			protected = append(protected, detection)
		}
	}
	return protected
}

func detectionsAllowedByPolicy(detections []Detection) []Detection {
	allowed := make([]Detection, 0, len(detections))
	for _, detection := range detections {
		if detection.Action == ActionNone {
			allowed = append(allowed, detection)
		}
	}
	return allowed
}

func mandatoryProtectedTypes(detections []Detection) []string {
	seen := map[string]struct{}{}
	for _, detection := range detections {
		detectorType := strings.TrimSpace(detection.Type)
		if !IsMandatoryDetector(detectorType) {
			continue
		}
		seen[detectorType] = struct{}{}
	}
	types := make([]string, 0, len(seen))
	for detectorType := range seen {
		types = append(types, detectorType)
	}
	sort.Strings(types)
	return types
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
