package runtimeconfig

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"gatelm/apps/gateway-core/internal/domain/budget"
	"gatelm/apps/gateway-core/internal/domain/providercatalog"
	"gatelm/apps/gateway-core/internal/domain/ratelimit"
	"gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	PublishStateActive = "active"
	StatusActive       = "active"

	CacheTypeExact = "exact"

	RuntimeStateSnapshotActive     = "snapshot_active"
	RuntimeStateLastKnownSafeUsed  = "last_known_safe_used"
	RuntimeStateStaleSnapshotUsed  = "stale_snapshot_used"
	DefaultGatewayInstanceIDCompat = "gateway_core_static"
	DefaultPublishedByCompat       = "runtime_config_compat"

	PromptCaptureModeDisabled    = "disabled"
	PromptCaptureModeLogSafeFull = "log_safe_full"
	PromptCaptureDefaultMaxChars = 8000

	ResponseCaptureModeDisabled    = "disabled"
	ResponseCaptureModeRawFull     = "raw_full"
	ResponseCaptureDefaultMaxChars = 8000
)

var (
	ErrMissingScope              = errors.New("runtime config scope is missing")
	ErrScopeMismatch             = errors.New("runtime config scope mismatch")
	ErrMissingCredentialBinding  = errors.New("runtime config credential binding is missing")
	ErrInactiveConfig            = errors.New("runtime config is not active")
	ErrMissingRuntimeHash        = errors.New("runtime config hash is missing")
	ErrInvalidPromptCapture      = errors.New("runtime config prompt capture policy is invalid")
	ErrInvalidResponseCapture    = errors.New("runtime config response capture policy is invalid")
	ErrInvalidSafetyPolicy       = errors.New("runtime config safety policy is invalid")
	ErrInvalidRoutingPolicy      = errors.New("runtime config routing policy is invalid")
	ErrUnsupportedSnapshotSchema = errors.New("runtime snapshot schema is not supported")
)

type Provider interface {
	GetActiveConfig(ctx context.Context, tenantID string, projectID string, applicationID string) (ActiveConfig, error)
}

type SnapshotProvider interface {
	GetExecutionSnapshot(ctx context.Context, tenantID string, projectID string, applicationID string) (ExecutionSnapshot, error)
}

type ActiveConfig struct {
	ConfigVersion string
	ConfigHash    string
	PublishState  string
	Snapshot      RuntimeSnapshotProvenance

	TenantID          string
	TenantStatus      string
	ProjectID         string
	ProjectStatus     string
	ApplicationID     string
	ApplicationStatus string
	APIKeyID          string
	APIKeyStatus      string
	AppTokenID        string
	AppTokenStatus    string

	RateLimit       ratelimit.Config
	BudgetPolicy    budget.Policy
	SafetyPolicy    SafetyPolicy
	RoutingPolicy   RoutingPolicy
	CachePolicy     CachePolicy
	PromptCapture   PromptCapturePolicy
	ResponseCapture ResponseCapturePolicy
}

type ExecutionSnapshot struct {
	ConfigHash    string
	TenantID      string
	ProjectID     string
	ApplicationID string
	BudgetScope   budget.Scope
	Snapshot      RuntimeSnapshotProvenance

	RateLimit       ratelimit.Config
	BudgetPolicy    budget.Policy
	SafetyPolicy    SafetyPolicy
	RoutingPolicy   RoutingPolicy
	CachePolicy     CachePolicy
	PromptCapture   PromptCapturePolicy
	ResponseCapture ResponseCapturePolicy
}

type RuntimeSnapshotProvenance struct {
	RuntimeSnapshotID      string
	RuntimeSnapshotVersion int
	ContentHash            string
	RuntimeState           string
	PublishedAt            time.Time
	PublishedBy            string
	GatewayInstanceID      string
	ProviderCatalogRef     providercatalog.Reference
	LegacyHashes           LegacyHashes
}

type LegacyHashes struct {
	ConfigHash         string
	SecurityPolicyHash string
	RoutingPolicyHash  string
}

type SafetyPolicy struct {
	SecurityPolicyHash string
	DetectorSet        []DetectorPolicy
}

type DetectorPolicy struct {
	DetectorType string
	Action       string
}

const (
	DetectorActionAllow  = "allow"
	DetectorActionRedact = "redact"
	DetectorActionBlock  = "block"
)

type RoutingPolicy struct {
	Mode              string
	BootstrapState    string
	Routes            routing.RoutingMatrix
	RoutingPolicyHash string
}

type CachePolicy struct {
	Enabled         bool
	Type            string
	TTLSeconds      int
	CachePolicyHash string
}

type PromptCapturePolicy struct {
	Enabled  bool
	Mode     string
	MaxChars int
}

type ResponseCapturePolicy struct {
	Enabled  bool
	Mode     string
	MaxChars int
}

func (c ActiveConfig) Normalize() ActiveConfig {
	c.ConfigVersion = strings.TrimSpace(c.ConfigVersion)
	c.ConfigHash = strings.TrimSpace(c.ConfigHash)
	c.PublishState = strings.TrimSpace(c.PublishState)
	c.TenantID = strings.TrimSpace(c.TenantID)
	c.TenantStatus = strings.TrimSpace(c.TenantStatus)
	c.ProjectID = strings.TrimSpace(c.ProjectID)
	c.ProjectStatus = strings.TrimSpace(c.ProjectStatus)
	c.ApplicationID = strings.TrimSpace(c.ApplicationID)
	c.ApplicationStatus = strings.TrimSpace(c.ApplicationStatus)
	c.APIKeyID = strings.TrimSpace(c.APIKeyID)
	c.APIKeyStatus = strings.TrimSpace(c.APIKeyStatus)
	c.AppTokenID = strings.TrimSpace(c.AppTokenID)
	c.AppTokenStatus = strings.TrimSpace(c.AppTokenStatus)
	c.RateLimit = ratelimit.NormalizeConfig(c.RateLimit)
	c.BudgetPolicy = budget.NormalizePolicy(c.BudgetPolicy)
	c.SafetyPolicy = c.SafetyPolicy.Normalize()
	c.RoutingPolicy = NormalizeRoutingPolicy(c.RoutingPolicy)
	c.CachePolicy.Type = strings.TrimSpace(c.CachePolicy.Type)
	c.CachePolicy.CachePolicyHash = strings.TrimSpace(c.CachePolicy.CachePolicyHash)
	c.PromptCapture = NormalizePromptCapturePolicy(c.PromptCapture)
	c.ResponseCapture = NormalizeResponseCapturePolicy(c.ResponseCapture)
	return c
}

func (c ActiveConfig) ValidateActive() error {
	c = c.Normalize()
	if c.TenantID == "" || c.ProjectID == "" || c.ApplicationID == "" {
		return ErrMissingScope
	}
	if c.APIKeyID == "" {
		return ErrMissingCredentialBinding
	}
	if c.ConfigHash == "" || c.SafetyPolicy.SecurityPolicyHash == "" || c.RoutingPolicy.RoutingPolicyHash == "" {
		return ErrMissingRuntimeHash
	}
	if err := c.SafetyPolicy.Validate(); err != nil {
		return err
	}
	if !IsValidRoutingPolicy(c.RoutingPolicy) {
		return ErrInvalidRoutingPolicy
	}
	if c.PublishState != PublishStateActive ||
		c.TenantStatus != StatusActive ||
		c.ProjectStatus != StatusActive ||
		c.ApplicationStatus != StatusActive ||
		c.APIKeyStatus != StatusActive {
		return ErrInactiveConfig
	}
	if c.AppTokenID != "" && c.AppTokenStatus != StatusActive {
		return ErrInactiveConfig
	}
	if !IsValidPromptCapturePolicy(c.PromptCapture) {
		return ErrInvalidPromptCapture
	}
	if !IsValidResponseCapturePolicy(c.ResponseCapture) {
		return ErrInvalidResponseCapture
	}
	return nil
}

func (c ActiveConfig) MatchesScope(tenantID string, projectID string, applicationID string) bool {
	c = c.Normalize()
	return c.TenantID == strings.TrimSpace(tenantID) &&
		c.ProjectID == strings.TrimSpace(projectID) &&
		c.ApplicationID == strings.TrimSpace(applicationID)
}

func (c ActiveConfig) ExecutionSnapshot() ExecutionSnapshot {
	c = c.Normalize()
	return ExecutionSnapshot{
		ConfigHash:      c.ConfigHash,
		TenantID:        c.TenantID,
		ProjectID:       c.ProjectID,
		ApplicationID:   c.ApplicationID,
		BudgetScope:     budget.DefaultScope(c.ApplicationID),
		Snapshot:        c.Snapshot,
		RateLimit:       c.RateLimit,
		BudgetPolicy:    c.BudgetPolicy,
		SafetyPolicy:    c.SafetyPolicy,
		RoutingPolicy:   c.RoutingPolicy,
		CachePolicy:     c.CachePolicy,
		PromptCapture:   c.PromptCapture,
		ResponseCapture: c.ResponseCapture,
	}
}

func (s ExecutionSnapshot) Normalize(publishedAt time.Time, gatewayInstanceID string) ExecutionSnapshot {
	s.ConfigHash = strings.TrimSpace(s.ConfigHash)
	s.TenantID = strings.TrimSpace(s.TenantID)
	s.ProjectID = strings.TrimSpace(s.ProjectID)
	s.ApplicationID = strings.TrimSpace(s.ApplicationID)
	s.BudgetScope = budget.NormalizeScope(s.BudgetScope, s.ApplicationID)
	s.RateLimit = ratelimit.NormalizeConfig(s.RateLimit)
	s.BudgetPolicy = budget.NormalizePolicy(s.BudgetPolicy)
	s.SafetyPolicy = s.SafetyPolicy.Normalize()
	s.RoutingPolicy = NormalizeRoutingPolicy(s.RoutingPolicy)
	s.CachePolicy.Type = strings.TrimSpace(s.CachePolicy.Type)
	s.CachePolicy.CachePolicyHash = strings.TrimSpace(s.CachePolicy.CachePolicyHash)
	s.PromptCapture = NormalizePromptCapturePolicy(s.PromptCapture)
	s.ResponseCapture = NormalizeResponseCapturePolicy(s.ResponseCapture)
	s.Snapshot = s.Snapshot.Normalize(ActiveConfig{
		ConfigHash:    s.ConfigHash,
		SafetyPolicy:  s.SafetyPolicy,
		RoutingPolicy: s.RoutingPolicy,
	}, publishedAt, gatewayInstanceID)
	return s
}

func DefaultPromptCapturePolicy() PromptCapturePolicy {
	return PromptCapturePolicy{
		Enabled:  false,
		Mode:     PromptCaptureModeDisabled,
		MaxChars: PromptCaptureDefaultMaxChars,
	}
}

func NormalizePromptCapturePolicy(policy PromptCapturePolicy) PromptCapturePolicy {
	policy.Mode = strings.TrimSpace(policy.Mode)
	if policy.MaxChars <= 0 {
		policy.MaxChars = PromptCaptureDefaultMaxChars
	}
	if !policy.Enabled {
		policy.Mode = PromptCaptureModeDisabled
		return policy
	}
	if policy.Mode == "" {
		policy.Mode = PromptCaptureModeLogSafeFull
	}
	return policy
}

func PromptCaptureAllowsLogSafeCapture(policy PromptCapturePolicy) bool {
	policy = NormalizePromptCapturePolicy(policy)
	return policy.Enabled && policy.Mode == PromptCaptureModeLogSafeFull
}

func IsValidPromptCapturePolicy(policy PromptCapturePolicy) bool {
	policy = NormalizePromptCapturePolicy(policy)
	if policy.MaxChars <= 0 {
		return false
	}
	if !policy.Enabled {
		return policy.Mode == PromptCaptureModeDisabled
	}
	return policy.Mode == PromptCaptureModeLogSafeFull
}

func DefaultResponseCapturePolicy() ResponseCapturePolicy {
	return ResponseCapturePolicy{
		Enabled:  false,
		Mode:     ResponseCaptureModeDisabled,
		MaxChars: ResponseCaptureDefaultMaxChars,
	}
}

func NormalizeResponseCapturePolicy(policy ResponseCapturePolicy) ResponseCapturePolicy {
	policy.Mode = strings.TrimSpace(policy.Mode)
	if policy.MaxChars <= 0 {
		policy.MaxChars = ResponseCaptureDefaultMaxChars
	}
	if !policy.Enabled {
		policy.Mode = ResponseCaptureModeDisabled
		return policy
	}
	if policy.Mode == "" {
		policy.Mode = ResponseCaptureModeRawFull
	}
	return policy
}

func ResponseCaptureAllowsRawCapture(policy ResponseCapturePolicy) bool {
	policy = NormalizeResponseCapturePolicy(policy)
	return policy.Enabled && policy.Mode == ResponseCaptureModeRawFull
}

func IsValidResponseCapturePolicy(policy ResponseCapturePolicy) bool {
	policy = NormalizeResponseCapturePolicy(policy)
	if policy.MaxChars <= 0 {
		return false
	}
	if !policy.Enabled {
		return policy.Mode == ResponseCaptureModeDisabled
	}
	return policy.Mode == ResponseCaptureModeRawFull
}

func (s ExecutionSnapshot) Validate() error {
	if s.Snapshot.RuntimeSnapshotVersion <= 0 {
		return ErrUnsupportedSnapshotSchema
	}
	s = s.Normalize(time.Time{}, "")
	if s.TenantID == "" || s.ProjectID == "" || s.ApplicationID == "" {
		return ErrMissingScope
	}
	if s.ConfigHash == "" || s.SafetyPolicy.SecurityPolicyHash == "" || s.RoutingPolicy.RoutingPolicyHash == "" {
		return ErrMissingRuntimeHash
	}
	if err := s.SafetyPolicy.Validate(); err != nil {
		return err
	}
	if !IsValidRoutingPolicy(s.RoutingPolicy) {
		return ErrInvalidRoutingPolicy
	}
	if !IsValidPromptCapturePolicy(s.PromptCapture) {
		return ErrInvalidPromptCapture
	}
	if !IsValidResponseCapturePolicy(s.ResponseCapture) {
		return ErrInvalidResponseCapture
	}
	return nil
}

func (p SafetyPolicy) Normalize() SafetyPolicy {
	p.SecurityPolicyHash = strings.TrimSpace(p.SecurityPolicyHash)
	if len(p.DetectorSet) == 0 {
		p.DetectorSet = nil
		return p
	}
	normalized := make([]DetectorPolicy, 0, len(p.DetectorSet))
	for _, detector := range p.DetectorSet {
		detectorType := strings.TrimSpace(detector.DetectorType)
		action := strings.TrimSpace(detector.Action)
		if detectorType == "" && action == "" {
			continue
		}
		normalized = append(normalized, DetectorPolicy{
			DetectorType: detectorType,
			Action:       action,
		})
	}
	p.DetectorSet = normalized
	return p
}

func (p SafetyPolicy) Validate() error {
	p = p.Normalize()
	seen := map[string]struct{}{}
	for _, detector := range p.DetectorSet {
		if !IsKnownSafetyDetectorType(detector.DetectorType) {
			return ErrInvalidSafetyPolicy
		}
		if !IsKnownSafetyDetectorAction(detector.Action) {
			return ErrInvalidSafetyPolicy
		}
		if IsMandatorySafetyDetectorType(detector.DetectorType) && detector.Action == DetectorActionAllow {
			return ErrInvalidSafetyPolicy
		}
		if _, exists := seen[detector.DetectorType]; exists {
			return ErrInvalidSafetyPolicy
		}
		seen[detector.DetectorType] = struct{}{}
	}
	return nil
}

func IsKnownSafetyDetectorType(detectorType string) bool {
	switch strings.TrimSpace(detectorType) {
	case "email",
		"phone_number",
		"person_name",
		"postal_address",
		"organization_name",
		"resident_registration_number",
		"api_key",
		"authorization_header",
		"jwt",
		"private_key":
		return true
	default:
		return false
	}
}

func IsMandatorySafetyDetectorType(detectorType string) bool {
	switch strings.TrimSpace(detectorType) {
	case "resident_registration_number", "api_key", "authorization_header", "jwt", "private_key":
		return true
	default:
		return false
	}
}

func IsKnownSafetyDetectorAction(action string) bool {
	switch strings.TrimSpace(action) {
	case DetectorActionAllow, DetectorActionRedact, DetectorActionBlock:
		return true
	default:
		return false
	}
}

func (s ExecutionSnapshot) MatchesScope(tenantID string, projectID string, applicationID string) bool {
	s = s.Normalize(time.Time{}, "")
	return s.TenantID == strings.TrimSpace(tenantID) &&
		s.ProjectID == strings.TrimSpace(projectID) &&
		s.ApplicationID == strings.TrimSpace(applicationID)
}

func (p RoutingPolicy) SimpleRouterConfig() routing.SimpleRouterConfig {
	return routing.SimpleRouterConfig{
		Mode:           p.Mode,
		BootstrapState: p.BootstrapState,
		Routes:         p.Routes,
		PolicyHash:     p.RoutingPolicyHash,
	}
}

func BootstrapRoutingPolicy(policyHash string) RoutingPolicy {
	cell := routing.RouteCell{ModelRefs: []string{routing.MockBootstrapRef}}
	difficulties := routing.DifficultyRoutes{Simple: cell, Complex: cell}
	return RoutingPolicy{
		Mode:           routing.RoutingPolicyModeAuto,
		BootstrapState: routing.BootstrapStateMock,
		Routes: routing.RoutingMatrix{
			General: difficulties, Code: difficulties, Translation: difficulties,
			Summarization: difficulties, Reasoning: difficulties,
		},
		RoutingPolicyHash: strings.TrimSpace(policyHash),
	}
}

func NormalizeRoutingPolicy(policy RoutingPolicy) RoutingPolicy {
	policy.Mode = strings.TrimSpace(strings.ToLower(policy.Mode))
	policy.BootstrapState = strings.TrimSpace(policy.BootstrapState)
	policy.RoutingPolicyHash = strings.TrimSpace(policy.RoutingPolicyHash)
	policy.Routes = normalizeRoutingMatrix(policy.Routes)
	return policy
}

func IsValidRoutingPolicy(policy RoutingPolicy) bool {
	mode := strings.TrimSpace(strings.ToLower(policy.Mode))
	bootstrapState := strings.TrimSpace(policy.BootstrapState)
	if mode != routing.RoutingPolicyModeAuto && mode != routing.RoutingPolicyModeManual {
		return false
	}
	if strings.TrimSpace(policy.RoutingPolicyHash) == "" {
		return false
	}
	hasMockRef := false
	for _, category := range routing.Categories {
		for _, difficulty := range []string{routing.DifficultySimple, routing.DifficultyComplex} {
			cell := policy.Routes.Cell(category, difficulty)
			if len(cell.ModelRefs) == 0 {
				return false
			}
			seen := make(map[string]struct{}, len(cell.ModelRefs))
			for _, modelRef := range cell.ModelRefs {
				trimmed := strings.TrimSpace(modelRef)
				if trimmed == "" || trimmed != modelRef || utf8.RuneCountInString(trimmed) > 240 {
					return false
				}
				if _, exists := seen[trimmed]; exists {
					return false
				}
				seen[trimmed] = struct{}{}
				if trimmed == routing.MockBootstrapRef {
					hasMockRef = true
				}
			}
		}
	}
	if hasMockRef {
		return bootstrapState == routing.BootstrapStateMock
	}
	return bootstrapState == routing.BootstrapStateConfigured
}

// IsCanonicalRoutingPolicyHash validates the active v2 contract form. Legacy
// compatibility hashes remain opaque elsewhere and are intentionally not
// passed through this validator.
func IsCanonicalRoutingPolicyHash(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != len("sha256:")+64 || !strings.HasPrefix(value, "sha256:") {
		return false
	}
	for _, char := range value[len("sha256:"):] {
		if (char < '0' || char > '9') && (char < 'a' || char > 'f') {
			return false
		}
	}
	return true
}

func normalizeRoutingMatrix(matrix routing.RoutingMatrix) routing.RoutingMatrix {
	return routing.RoutingMatrix{
		General: normalizeDifficultyRoutes(matrix.General), Code: normalizeDifficultyRoutes(matrix.Code),
		Translation: normalizeDifficultyRoutes(matrix.Translation), Summarization: normalizeDifficultyRoutes(matrix.Summarization),
		Reasoning: normalizeDifficultyRoutes(matrix.Reasoning),
	}
}

func normalizeDifficultyRoutes(routes routing.DifficultyRoutes) routing.DifficultyRoutes {
	return routing.DifficultyRoutes{Simple: normalizeRouteCell(routes.Simple), Complex: normalizeRouteCell(routes.Complex)}
}

func normalizeRouteCell(cell routing.RouteCell) routing.RouteCell {
	refs := make([]string, len(cell.ModelRefs))
	for i, ref := range cell.ModelRefs {
		refs[i] = strings.TrimSpace(ref)
	}
	return routing.RouteCell{ModelRefs: refs}
}

func (c ActiveConfig) RuntimeSnapshotProvenance(publishedAt time.Time, gatewayInstanceID string) RuntimeSnapshotProvenance {
	return c.Snapshot.Normalize(c, publishedAt, gatewayInstanceID)
}

func (p RuntimeSnapshotProvenance) Normalize(config ActiveConfig, publishedAt time.Time, gatewayInstanceID string) RuntimeSnapshotProvenance {
	p.RuntimeSnapshotID = strings.TrimSpace(p.RuntimeSnapshotID)
	p.ContentHash = strings.TrimSpace(p.ContentHash)
	p.RuntimeState = strings.TrimSpace(p.RuntimeState)
	p.PublishedBy = strings.TrimSpace(p.PublishedBy)
	p.GatewayInstanceID = strings.TrimSpace(p.GatewayInstanceID)
	p.ProviderCatalogRef = p.ProviderCatalogRef.Normalize()
	p.LegacyHashes = p.LegacyHashes.Normalize()

	if p.RuntimeSnapshotID == "" {
		p.RuntimeSnapshotID = firstNonEmptyString(config.ConfigVersion, "runtime_snapshot_compat")
	}
	if p.RuntimeSnapshotVersion <= 0 {
		p.RuntimeSnapshotVersion = 2
	}
	if p.ContentHash == "" {
		p.ContentHash = firstNonEmptyString(config.ConfigHash, p.LegacyHashes.ConfigHash)
	}
	if !IsActualRuntimeState(p.RuntimeState) {
		p.RuntimeState = RuntimeStateSnapshotActive
	}
	if p.PublishedAt.IsZero() {
		p.PublishedAt = publishedAt
	}
	if p.PublishedAt.IsZero() {
		p.PublishedAt = time.Unix(0, 0).UTC()
	} else {
		p.PublishedAt = p.PublishedAt.UTC()
	}
	if p.PublishedBy == "" {
		p.PublishedBy = DefaultPublishedByCompat
	}
	if p.GatewayInstanceID == "" {
		p.GatewayInstanceID = firstNonEmptyString(gatewayInstanceID, DefaultGatewayInstanceIDCompat)
	}
	if p.LegacyHashes.ConfigHash == "" {
		p.LegacyHashes.ConfigHash = strings.TrimSpace(config.ConfigHash)
	}
	if p.LegacyHashes.SecurityPolicyHash == "" {
		p.LegacyHashes.SecurityPolicyHash = strings.TrimSpace(config.SafetyPolicy.SecurityPolicyHash)
	}
	if p.LegacyHashes.RoutingPolicyHash == "" {
		p.LegacyHashes.RoutingPolicyHash = strings.TrimSpace(config.RoutingPolicy.RoutingPolicyHash)
	}
	return p
}

func (p RuntimeSnapshotProvenance) Metadata() map[string]any {
	metadata := map[string]any{
		"runtimeSnapshotId":      p.RuntimeSnapshotID,
		"runtimeSnapshotVersion": p.RuntimeSnapshotVersion,
		"contentHash":            p.ContentHash,
		"runtimeState":           p.RuntimeState,
		"publishedAt":            p.PublishedAt.UTC().Format(time.RFC3339Nano),
		"publishedBy":            p.PublishedBy,
		"gatewayInstanceId":      p.GatewayInstanceID,
	}
	if !p.LegacyHashes.IsZero() {
		metadata["legacyHashes"] = p.LegacyHashes.Metadata()
	}
	if !p.ProviderCatalogRef.IsZero() {
		metadata["providerCatalogRef"] = map[string]any{
			"catalogId":      p.ProviderCatalogRef.CatalogID,
			"catalogVersion": p.ProviderCatalogRef.CatalogVersion,
			"contentHash":    p.ProviderCatalogRef.ContentHash,
		}
	}
	return metadata
}

func (p RuntimeSnapshotProvenance) IsZero() bool {
	p.RuntimeSnapshotID = strings.TrimSpace(p.RuntimeSnapshotID)
	p.ContentHash = strings.TrimSpace(p.ContentHash)
	p.RuntimeState = strings.TrimSpace(p.RuntimeState)
	p.PublishedBy = strings.TrimSpace(p.PublishedBy)
	p.GatewayInstanceID = strings.TrimSpace(p.GatewayInstanceID)
	p.ProviderCatalogRef = p.ProviderCatalogRef.Normalize()
	return p.RuntimeSnapshotID == "" &&
		p.RuntimeSnapshotVersion == 0 &&
		p.ContentHash == "" &&
		p.RuntimeState == "" &&
		p.PublishedAt.IsZero() &&
		p.PublishedBy == "" &&
		p.GatewayInstanceID == "" &&
		p.ProviderCatalogRef.IsZero() &&
		p.LegacyHashes.IsZero()
}

func (h LegacyHashes) Normalize() LegacyHashes {
	return LegacyHashes{
		ConfigHash:         strings.TrimSpace(h.ConfigHash),
		SecurityPolicyHash: strings.TrimSpace(h.SecurityPolicyHash),
		RoutingPolicyHash:  strings.TrimSpace(h.RoutingPolicyHash),
	}
}

func (h LegacyHashes) IsZero() bool {
	h = h.Normalize()
	return h.ConfigHash == "" && h.SecurityPolicyHash == "" && h.RoutingPolicyHash == ""
}

func (h LegacyHashes) Metadata() map[string]string {
	h = h.Normalize()
	return map[string]string{
		"configHash":         h.ConfigHash,
		"securityPolicyHash": h.SecurityPolicyHash,
		"routingPolicyHash":  h.RoutingPolicyHash,
	}
}

func IsActualRuntimeState(value string) bool {
	switch strings.TrimSpace(value) {
	case RuntimeStateSnapshotActive, RuntimeStateLastKnownSafeUsed, RuntimeStateStaleSnapshotUsed:
		return true
	default:
		return false
	}
}

func firstNonEmptyString(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}
