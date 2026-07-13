package tenantchat

type Phase string

const (
	PhaseAdmission  Phase = "admission"
	PhaseCompletion Phase = "completion"
	PhaseCancel     Phase = "cancel"
)

type Actor struct {
	UserID     string `json:"userId"`
	ActorKind  string `json:"actorKind"`
	EmployeeID string `json:"employeeId,omitempty"`
}

type ScopeReference struct {
	Type string `json:"type"`
	ID   string `json:"id"`
}

type ExecutionScope struct {
	Kind        string         `json:"kind"`
	TenantID    string         `json:"tenantId"`
	Actor       Actor          `json:"actor"`
	QuotaScope  ScopeReference `json:"quotaScope"`
	BudgetScope ScopeReference `json:"budgetScope"`
}

type SnapshotReference struct {
	Version               int64  `json:"version"`
	Digest                string `json:"digest"`
	PolicyVersion         int64  `json:"policyVersion"`
	EmployeeNoticeVersion int64  `json:"employeeNoticeVersion"`
	PricingVersion        int64  `json:"pricingVersion"`
}

type UsageIntent struct {
	EstimatedInputTokens int64  `json:"estimatedInputTokens"`
	MaxOutputTokens      int64  `json:"maxOutputTokens"`
	RequestedTier        string `json:"requestedTier"`
	CacheStrategy        string `json:"cacheStrategy"`
}

type RequestContext struct {
	Surface        string            `json:"surface"`
	Phase          Phase             `json:"phase"`
	RequestID      string            `json:"requestId"`
	TurnID         string            `json:"turnId"`
	IdempotencyKey string            `json:"idempotencyKey"`
	AdmissionID    string            `json:"admissionId,omitempty"`
	ExecutionScope ExecutionScope    `json:"executionScope"`
	Snapshot       SnapshotReference `json:"snapshot"`
	BindingDigest  string            `json:"bindingDigest"`
	UsageIntent    *UsageIntent      `json:"usageIntent,omitempty"`
}

type EphemeralMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type CompletionInput struct {
	Messages []EphemeralMessage `json:"messages"`
	Stream   bool               `json:"stream"`
}

type AdmissionRequest struct {
	Context RequestContext `json:"context"`
}

type CancelRequest struct {
	Context RequestContext `json:"context"`
}

type CompletionRequest struct {
	Context RequestContext  `json:"context"`
	Input   CompletionInput `json:"input"`
}

type AdmissionResponse struct {
	AdmissionID string `json:"admissionId"`
	RequestID   string `json:"requestId"`
	State       string `json:"state"`
	ExpiresAt   string `json:"expiresAt"`
	Replayed    bool   `json:"replayed"`
}

type CancelResponse struct {
	AdmissionID  string `json:"admissionId"`
	RequestID    string `json:"requestId"`
	State        string `json:"state"`
	SlotReleased bool   `json:"slotReleased"`
	Replayed     bool   `json:"replayed"`
}

type ErrorResponse struct {
	Code              string `json:"code"`
	Message           string `json:"message"`
	RetryAfterSeconds int    `json:"retryAfterSeconds,omitempty"`
}
