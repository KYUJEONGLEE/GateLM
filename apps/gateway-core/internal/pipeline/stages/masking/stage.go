package masking

import (
	"context"
	"errors"
)

const (
	StageName                     = "mask_or_block"
	ErrorCodeSensitiveDataBlocked = "sensitive_data_blocked"
)

type Request struct {
	Prompt                  string
	SecurityPolicyVersionID string
}

type Result struct {
	RedactedPrompt          string
	RedactedPromptPreview   string
	MaskingAction           string
	MaskingDetectedTypes    []string
	MaskingDetectedCount    int
	SecurityPolicyVersionID string
	Blocked                 bool
	ErrorCode               string
	ErrorStage              string
}

type Engine interface {
	Apply(ctx context.Context, req Request) (Result, error)
}

type Stage struct {
	engine Engine
}

func NewStage(engine Engine) *Stage {
	return &Stage{engine: engine}
}

func (s *Stage) Name() string {
	return StageName
}

func (s *Stage) Execute(ctx context.Context, req Request) (Result, error) {
	if s == nil || s.engine == nil {
		return Result{}, errors.New("masking stage requires an engine")
	}

	result, err := s.engine.Apply(ctx, req)
	if err != nil {
		return Result{}, err
	}

	if result.Blocked {
		result.MaskingAction = "blocked"
		result.ErrorCode = ErrorCodeSensitiveDataBlocked
		result.ErrorStage = StageName
	}

	return result, nil
}
