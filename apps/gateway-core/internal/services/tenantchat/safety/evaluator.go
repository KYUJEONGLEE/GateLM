package safety

import (
	"context"
	"errors"

	"gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

var ErrUnavailable = errors.New("tenant chat safety unavailable")

type engine interface {
	Apply(ctx context.Context, req masking.ApplyRequest) (masking.Result, error)
}

type Evaluator struct {
	engine engine
}

func NewEvaluator() *Evaluator {
	local := masking.NewP0Engine()
	return &Evaluator{engine: local}
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
	policies := make([]masking.DetectorPolicy, 0, len(snapshot.Policies.Safety.DetectorSet))
	for _, detector := range snapshot.Policies.Safety.DetectorSet {
		policies = append(policies, masking.DetectorPolicy{
			DetectorType: detector.DetectorType,
			Action:       masking.PolicyAction(detector.Action),
		})
	}
	result := cloneInput(input)
	entityScope := masking.NewEntityScope()
	currentUserMessageIndex := latestUserMessageIndex(result.Messages)
	for index, message := range result.Messages {
		masked, err := e.engine.Apply(ctx, masking.ApplyRequest{
			Prompt:                  message.Content,
			SecurityPolicyVersionID: snapshot.Policies.Safety.PolicyDigest,
			EntityScope:             entityScope,
			DetectorPolicies:        policies,
		})
		if err != nil {
			return tenantchat.SafetyEvaluation{}, ErrUnavailable
		}
		if masked.Action == masking.ActionBlocked &&
			(currentUserMessageIndex < 0 || index == currentUserMessageIndex) {
			return tenantchat.SafetyEvaluation{Blocked: true}, nil
		}
		result.Messages[index].Content = masked.RedactedPrompt
	}
	return tenantchat.SafetyEvaluation{Input: result}, nil
}

func cloneInput(input tenantchat.CompletionInput) tenantchat.CompletionInput {
	cloned := input
	cloned.Messages = append([]tenantchat.EphemeralMessage(nil), input.Messages...)
	return cloned
}

func latestUserMessageIndex(messages []tenantchat.EphemeralMessage) int {
	for index := len(messages) - 1; index >= 0; index-- {
		if messages[index].Role == "user" {
			return index
		}
	}
	return -1
}
