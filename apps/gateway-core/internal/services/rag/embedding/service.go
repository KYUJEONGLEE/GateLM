package embedding

import (
	"context"
	"errors"
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	embeddingdomain "gatelm/apps/gateway-core/internal/domain/embedding"
	"gatelm/apps/gateway-core/internal/domain/ragembedding"
)

var (
	ErrInvalidRequest     = errors.New("rag embedding request is invalid")
	ErrInvalidResponse    = errors.New("rag embedding provider response is invalid")
	ErrServiceUnavailable = errors.New("rag embedding service is unavailable")
)

type Config struct {
	Provider          string
	Model             string
	Dimensions        int
	ProfileVersion    int
	MaxInputs         int
	MaxTokensPerInput int
	MaxBatchTokens    int
}

type Usage struct {
	InputCount   int `json:"inputCount"`
	PromptTokens int `json:"promptTokens"`
	TotalTokens  int `json:"totalTokens"`
}

type Response struct {
	RequestID      string               `json:"requestId"`
	Purpose        ragembedding.Purpose `json:"purpose"`
	Provider       string               `json:"provider"`
	Model          string               `json:"model"`
	Dimensions     int                  `json:"dimensions"`
	ProfileVersion int                  `json:"profileVersion"`
	Embeddings     [][]float64          `json:"embeddings"`
	Usage          Usage                `json:"usage"`
}

type Service struct {
	provider embeddingdomain.Provider
	config   Config
}

func New(provider embeddingdomain.Provider, config Config) (*Service, error) {
	config.Provider = strings.TrimSpace(config.Provider)
	config.Model = strings.TrimSpace(config.Model)
	if provider == nil || config.Provider == "" || config.Model == "" ||
		config.Dimensions <= 0 || config.ProfileVersion != ragembedding.ProfileVersion ||
		config.MaxInputs <= 0 || config.MaxTokensPerInput <= 0 || config.MaxBatchTokens <= 0 {
		return nil, ErrServiceUnavailable
	}
	if provider.ProviderName() != config.Provider {
		return nil, ErrServiceUnavailable
	}
	return &Service{provider: provider, config: config}, nil
}

func (s *Service) Embed(
	ctx context.Context,
	scope ragembedding.VerifiedScope,
	request ragembedding.Request,
) (Response, error) {
	if s == nil || s.provider == nil {
		return Response{}, ErrServiceUnavailable
	}
	if err := s.validateRequest(scope, request); err != nil {
		return Response{}, err
	}

	result, err := s.provider.Embed(ctx, embeddingdomain.Request{
		Inputs:     append([]string(nil), request.Inputs...),
		Model:      s.config.Model,
		Dimensions: s.config.Dimensions,
	})
	if err != nil {
		return Response{}, err
	}
	if err := s.validateResult(result, len(request.Inputs)); err != nil {
		return Response{}, err
	}

	vectors := make([][]float64, len(result.Vectors))
	for index, vector := range result.Vectors {
		vectors[index] = append([]float64(nil), vector...)
	}
	return Response{
		RequestID:      scope.RequestID(),
		Purpose:        scope.Purpose(),
		Provider:       s.config.Provider,
		Model:          s.config.Model,
		Dimensions:     s.config.Dimensions,
		ProfileVersion: s.config.ProfileVersion,
		Embeddings:     vectors,
		Usage: Usage{
			InputCount:   len(request.Inputs),
			PromptTokens: result.Usage.PromptTokens,
			TotalTokens:  result.Usage.TotalTokens,
		},
	}, nil
}

func (s *Service) validateRequest(scope ragembedding.VerifiedScope, request ragembedding.Request) error {
	if ragembedding.ValidateRequest(request) != nil ||
		scope.TenantID() == "" || scope.RequestID() == "" || scope.OperationID() == "" ||
		scope.Purpose() != request.Purpose || scope.ProfileVersion() != request.ProfileVersion ||
		len(request.Inputs) > s.config.MaxInputs {
		return ErrInvalidRequest
	}
	totalUpperBound := 0
	for _, input := range request.Inputs {
		if !utf8.ValidString(input) || strings.TrimSpace(input) == "" {
			return ErrInvalidRequest
		}
		// A UTF-8 byte count is a conservative dependency-free upper bound for
		// tokenizer output: a token cannot encode fewer than one input byte.
		upperBound := len([]byte(input))
		if upperBound < 1 || upperBound > s.config.MaxTokensPerInput ||
			totalUpperBound > s.config.MaxBatchTokens-upperBound {
			return ErrInvalidRequest
		}
		totalUpperBound += upperBound
	}
	if totalUpperBound > s.config.MaxBatchTokens {
		return ErrInvalidRequest
	}
	return nil
}

func (s *Service) validateResult(result embeddingdomain.Result, inputCount int) error {
	if strings.TrimSpace(result.Model) != s.config.Model || len(result.Vectors) != inputCount ||
		result.Usage.PromptTokens <= 0 || result.Usage.TotalTokens < result.Usage.PromptTokens ||
		result.Usage.PromptTokens > s.config.MaxBatchTokens || result.Usage.TotalTokens > s.config.MaxBatchTokens {
		return fmt.Errorf("%w: shape", ErrInvalidResponse)
	}
	for _, vector := range result.Vectors {
		if len(vector) != s.config.Dimensions {
			return fmt.Errorf("%w: dimensions", ErrInvalidResponse)
		}
		for _, value := range vector {
			if math.IsNaN(value) || math.IsInf(value, 0) {
				return fmt.Errorf("%w: numeric value", ErrInvalidResponse)
			}
		}
	}
	return nil
}
