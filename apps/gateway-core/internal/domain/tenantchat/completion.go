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
}

type ExactCacheEntry struct {
	ResponseText      string `json:"responseText"`
	EffectiveModelKey string `json:"effectiveModelKey"`
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
