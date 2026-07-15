package safety

import (
	"context"
	"errors"

	"gatelm/apps/gateway-core/internal/domain/masking"
	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

var ErrUnavailable = errors.New("tenant chat safety unavailable")

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
	policies := make([]masking.DetectorPolicy, 0, len(snapshot.Policies.Safety.DetectorSet))
	for _, detector := range snapshot.Policies.Safety.DetectorSet {
		policies = append(policies, masking.DetectorPolicy{
			DetectorType: detector.DetectorType,
			Action:       masking.PolicyAction(detector.Action),
		})
	}
	result := cloneInput(input)
	entityScope := masking.NewEntityScope()
	requests := make([]masking.ApplyRequest, 0, len(result.Messages))
	for _, message := range result.Messages {
		requests = append(requests, masking.ApplyRequest{
			Prompt:                  message.Content,
			SecurityPolicyVersionID: snapshot.Policies.Safety.PolicyDigest,
			EntityScope:             entityScope,
			DetectorPolicies:        policies,
		})
	}
	if batchEngine, ok := e.engine.(BatchMaskingEngine); ok {
		maskedResults, err := batchEngine.ApplyBatch(ctx, requests)
		if err != nil {
			return tenantchat.SafetyEvaluation{}, ErrUnavailable
		}
		if len(maskedResults) != len(result.Messages) {
			return tenantchat.SafetyEvaluation{}, ErrUnavailable
		}
		for index, masked := range maskedResults {
			if masked.Action == masking.ActionBlocked {
				return tenantchat.SafetyEvaluation{Blocked: true}, nil
			}
			result.Messages[index].Content = masked.RedactedPrompt
		}
		return tenantchat.SafetyEvaluation{Input: result}, nil
	}
	for index, request := range requests {
		masked, err := e.engine.Apply(ctx, request)
		if err != nil {
			return tenantchat.SafetyEvaluation{}, ErrUnavailable
		}
		if masked.Action == masking.ActionBlocked {
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
