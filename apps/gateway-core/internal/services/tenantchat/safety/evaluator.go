package safety

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

var ErrUnavailable = errors.New("tenant chat safety unavailable")

var policyDigestPattern = regexp.MustCompile(`^sha256:[A-Za-z0-9_-]{43}$`)

type MaskingEngine interface {
	Apply(ctx context.Context, req masking.ApplyRequest) (masking.Result, error)
}

type BatchMaskingEngine interface {
	ApplyBatch(ctx context.Context, requests []masking.ApplyRequest) ([]masking.Result, error)
}

type Evaluator struct {
	engine MaskingEngine
}

func NewEvaluator() *Evaluator {
	local := masking.NewP0Engine()
	return &Evaluator{engine: local}
}

func NewEvaluatorWithEngine(engine MaskingEngine) *Evaluator {
	if engine == nil {
		return NewEvaluator()
	}
	return &Evaluator{engine: engine}
}

func (e *Evaluator) Evaluate(
	ctx context.Context,
	snapshot tenantruntime.Snapshot,
	input tenantchat.CompletionInput,
) (tenantchat.SafetyEvaluation, error) {
	if !snapshot.Policies.Safety.Enabled {
		return tenantchat.SafetyEvaluation{Input: cloneInput(input)}, nil
	}
	if e == nil || e.engine == nil || len(snapshot.Policies.Safety.DetectorSet) == 0 {
		return tenantchat.SafetyEvaluation{}, ErrUnavailable
	}
	policies := detectorPolicies(snapshot)
	result := cloneInput(input)
	entityScope := masking.NewEntityScope()
	requests := make([]masking.ApplyRequest, 0, len(result.Messages))
	requestIndexes := make([]int, 0, len(result.Messages))
	for index, message := range result.Messages {
		if trustedSafetyProvenance(message) {
			entityScope.SeedFromRedactedText(message.Content)
			continue
		}
		requests = append(requests, masking.ApplyRequest{
			Prompt:                  message.Content,
			SecurityPolicyVersionID: snapshot.Policies.Safety.PolicyDigest,
			EntityScope:             entityScope,
			DetectorPolicies:        policies,
		})
		requestIndexes = append(requestIndexes, index)
	}
	if len(requests) == 0 {
		return tenantchat.SafetyEvaluation{Input: result}, nil
	}
	maskedResults, err := e.applyRequests(ctx, requests)
	if err != nil || len(maskedResults) != len(requestIndexes) {
		return tenantchat.SafetyEvaluation{}, ErrUnavailable
	}
	for resultIndex, masked := range maskedResults {
		if masked.Action == masking.ActionBlocked {
			return tenantchat.SafetyEvaluation{Blocked: true}, nil
		}
		result.Messages[requestIndexes[resultIndex]].Content = masked.RedactedPrompt
	}
	return tenantchat.SafetyEvaluation{Input: result}, nil
}

func (e *Evaluator) Sanitize(
	ctx context.Context,
	snapshot tenantruntime.Snapshot,
	input tenantchat.SanitizationInput,
) (tenantchat.SanitizationEvaluation, error) {
	if tenantchat.ValidateSanitizationInput(input) != nil ||
		!policyDigestPattern.MatchString(snapshot.Policies.Safety.PolicyDigest) {
		return tenantchat.SanitizationEvaluation{}, ErrUnavailable
	}
	// A storage sanitization may never certify unchanged raw input as safe.
	// Tenants without an enabled detector policy therefore fail closed before
	// Chat API persists the user message.
	if !snapshot.Policies.Safety.Enabled || e == nil || e.engine == nil || len(snapshot.Policies.Safety.DetectorSet) == 0 {
		return tenantchat.SanitizationEvaluation{}, ErrUnavailable
	}
	entityScope := masking.NewEntityScope()
	entityScope.SeedPlaceholderCounters(input.PlaceholderCounters)
	policies := detectorPolicies(snapshot)
	requests := make([]masking.ApplyRequest, 0, len(input.Messages))
	for _, message := range input.Messages {
		requests = append(requests, masking.ApplyRequest{
			Prompt:                  message.Content,
			SecurityPolicyVersionID: snapshot.Policies.Safety.PolicyDigest,
			EntityScope:             entityScope,
			DetectorPolicies:        policies,
		})
	}
	maskedResults, err := e.applyRequests(ctx, requests)
	if err != nil || len(maskedResults) != len(input.Messages) {
		return tenantchat.SanitizationEvaluation{}, ErrUnavailable
	}
	messages := make([]tenantchat.SanitizedMessage, 0, len(maskedResults))
	for index, masked := range maskedResults {
		if masked.Action == masking.ActionBlocked {
			return tenantchat.SanitizationEvaluation{
				PolicyDigest: snapshot.Policies.Safety.PolicyDigest,
				Blocked:      true,
			}, nil
		}
		if strings.TrimSpace(masked.LogSafePrompt) == "" {
			return tenantchat.SanitizationEvaluation{}, ErrUnavailable
		}
		messages = append(messages, tenantchat.SanitizedMessage{
			ItemIndex: index,
			Content:   masked.LogSafePrompt,
		})
	}
	return tenantchat.SanitizationEvaluation{
		Messages:     messages,
		PolicyDigest: snapshot.Policies.Safety.PolicyDigest,
	}, nil
}

func (e *Evaluator) applyRequests(
	ctx context.Context,
	requests []masking.ApplyRequest,
) ([]masking.Result, error) {
	if batchEngine, ok := e.engine.(BatchMaskingEngine); ok {
		return batchEngine.ApplyBatch(ctx, requests)
	}
	results := make([]masking.Result, 0, len(requests))
	for _, request := range requests {
		result, err := e.engine.Apply(ctx, request)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	return results, nil
}

func detectorPolicies(snapshot tenantruntime.Snapshot) []masking.DetectorPolicy {
	policies := make([]masking.DetectorPolicy, 0, len(snapshot.Policies.Safety.DetectorSet))
	for _, detector := range snapshot.Policies.Safety.DetectorSet {
		policies = append(policies, masking.DetectorPolicy{
			DetectorType: detector.DetectorType,
			Action:       masking.PolicyAction(detector.Action),
		})
	}
	return policies
}

func trustedSafetyProvenance(message tenantchat.EphemeralMessage) bool {
	if message.Safety == nil {
		return false
	}
	switch {
	case message.Role == "user" && message.Safety.Status == "sanitized":
		return policyDigestPattern.MatchString(message.Safety.PolicyDigest)
	case message.Role == "assistant" && message.Safety.Status == "provider_generated":
		return message.Safety.PolicyDigest == ""
	default:
		return false
	}
}

func cloneInput(input tenantchat.CompletionInput) tenantchat.CompletionInput {
	cloned := input
	cloned.Messages = append([]tenantchat.EphemeralMessage(nil), input.Messages...)
	return cloned
}
