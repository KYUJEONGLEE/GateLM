package tenantchat

import (
	"fmt"
	"strings"
)

const (
	CompletionEventDelta         = "tenant_chat.delta"
	CompletionEventFinal         = "tenant_chat.final"
	ProviderCallNotStarted       = "not_started"
	ProviderCallStartedOrUnknown = "started_or_unknown"
	maxEphemeralMessageRunes     = 20_000
	maxRAGContextMessageRunes    = 65_536
)

type ProviderCallStartStatus string

type CompletionUsage struct {
	InputTokens  int64  `json:"inputTokens"`
	OutputTokens int64  `json:"outputTokens"`
	TotalTokens  int64  `json:"totalTokens"`
	UsageQuality string `json:"usageQuality"`
}

type CompletionError struct {
	Code              string `json:"code"`
	Message           string `json:"message"`
	RetryAfterSeconds int    `json:"retryAfterSeconds,omitempty"`
}

type SafetyEvaluation struct {
	Input   CompletionInput
	Blocked bool
	Summary *SafetySummary
}

type SanitizationEvaluation struct {
	Messages     []SanitizedMessage
	PolicyDigest string
	Blocked      bool
	Summary      SafetySummary
}

type ExactCacheEntry struct {
	ResponseText        string `json:"responseText"`
	EffectiveProviderID string `json:"effectiveProviderId"`
	EffectiveModelKey   string `json:"effectiveModelKey"`
	EffectiveRouteTier  string `json:"effectiveRouteTier"`
	SourceCostMicroUSD  int64  `json:"sourceCostMicroUsd"`
}

type LedgerlessObservability struct {
	EffectiveProviderID string
	EffectiveModelKey   string
	EffectiveRouteTier  string
	SavedCostMicroUSD   int64
	MaskingAction       string
}

type ProviderTokenRateDecision struct {
	Allowed           bool
	RetryAfterSeconds int
}

type UsageReceipt struct {
	RequestID            string `json:"requestId"`
	AttemptNo            int    `json:"attemptNo"`
	ProviderID           string `json:"providerId"`
	InputTokens          int64  `json:"inputTokens"`
	OutputTokens         int64  `json:"outputTokens"`
	CacheReadInputTokens int64  `json:"cacheReadInputTokens"`
}

type UsageReceiptResult struct {
	RequestID string `json:"requestId"`
	AttemptNo int    `json:"attemptNo"`
	State     string `json:"state"`
	Replayed  bool   `json:"replayed"`
}

type CompletionEvent struct {
	Type              string           `json:"type"`
	SchemaVersion     int              `json:"schemaVersion"`
	RequestID         string           `json:"requestId"`
	TurnID            string           `json:"turnId"`
	Sequence          int              `json:"sequence"`
	Delta             string           `json:"delta,omitempty"`
	TerminalOutcome   string           `json:"terminalOutcome,omitempty"`
	EffectiveModelKey *string          `json:"effectiveModelKey"`
	Usage             *CompletionUsage `json:"usage,omitempty"`
	QuotaState        string           `json:"quotaState,omitempty"`
	BudgetState       string           `json:"budgetState,omitempty"`
	CacheOutcome      string           `json:"cacheOutcome,omitempty"`
	Replayed          *bool            `json:"replayed,omitempty"`
	Error             *CompletionError `json:"error,omitempty"`
}

func ValidateCompletionInput(input CompletionInput) error {
	if !input.Stream {
		return fmt.Errorf("tenant chat completion must stream")
	}
	if len(input.Messages) < 1 || len(input.Messages) > 64 {
		return fmt.Errorf("tenant chat messages must contain between 1 and 64 items")
	}
	for index, message := range input.Messages {
		if message.Role != "system" && message.Role != "user" && message.Role != "assistant" {
			return fmt.Errorf("tenant chat message %d has an invalid role", index)
		}
		if message.Purpose != "" && (message.Role != "system" || message.Purpose != "rag_context") {
			return fmt.Errorf("tenant chat message %d has invalid purpose", index)
		}
		maximumRunes := maxEphemeralMessageRunes
		if message.Role == "system" && message.Purpose == "rag_context" {
			maximumRunes = maxRAGContextMessageRunes
		}
		if strings.TrimSpace(message.Content) == "" || len([]rune(message.Content)) > maximumRunes {
			return fmt.Errorf("tenant chat message %d has invalid content", index)
		}
	}
	return nil
}

func ValidateSanitizationInput(input SanitizationInput) error {
	if len(input.Messages) < 1 || len(input.Messages) > 64 {
		return fmt.Errorf("tenant chat sanitization messages must contain between 1 and 64 items")
	}
	for index, message := range input.Messages {
		if message.Role != "user" || message.Safety != nil {
			return fmt.Errorf("tenant chat sanitization message %d must be an untrusted user message", index)
		}
		if strings.TrimSpace(message.Content) == "" || len([]rune(message.Content)) > 20_000 {
			return fmt.Errorf("tenant chat sanitization message %d has invalid content", index)
		}
	}
	if len(input.PlaceholderCounters) > len(allowedPlaceholderCounterPrefixes) {
		return fmt.Errorf("tenant chat sanitization has too many placeholder counters")
	}
	for prefix, count := range input.PlaceholderCounters {
		if _, ok := allowedPlaceholderCounterPrefixes[prefix]; !ok || count < 0 || count > 1_000_000 {
			return fmt.Errorf("tenant chat sanitization placeholder counter is invalid")
		}
	}
	return nil
}

var allowedPlaceholderCounterPrefixes = map[string]struct{}{
	"PERSON": {}, "ORGANIZATION": {}, "ADDRESS": {}, "EMAIL": {}, "PHONE_NUMBER": {},
	"CUSTOMER": {}, "AGENT": {}, "DOCTOR": {}, "PATIENT": {}, "APPLICANT": {}, "INTERVIEWER": {},
}
