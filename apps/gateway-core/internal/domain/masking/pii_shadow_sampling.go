package masking

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"strings"
)

const PIIShadowSampleScale = 10_000

type piiShadowScope struct {
	tenantID  string
	requestID string
}

type piiShadowScopeKey struct{}

// WithPIIShadowScope keeps tenant and request identifiers inside the trusted
// Gateway process. The sidecar receives only the resulting capture decision.
func WithPIIShadowScope(ctx context.Context, tenantID string, requestID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, piiShadowScopeKey{}, piiShadowScope{
		tenantID:  strings.TrimSpace(tenantID),
		requestID: strings.TrimSpace(requestID),
	})
}

type PIIShadowSampler struct {
	enabled           bool
	allowedTenantIDs  map[string]struct{}
	sampleBasisPoints uint64
}

func NewPIIShadowSampler(enabled bool, allowedTenantIDs []string, sampleBasisPoints int) PIIShadowSampler {
	allowed := make(map[string]struct{}, len(allowedTenantIDs))
	for _, tenantID := range allowedTenantIDs {
		if normalized := strings.TrimSpace(tenantID); normalized != "" {
			allowed[normalized] = struct{}{}
		}
	}
	return PIIShadowSampler{
		enabled:           enabled,
		allowedTenantIDs:  allowed,
		sampleBasisPoints: uint64(sampleBasisPoints),
	}
}

func (s PIIShadowSampler) ShouldCapture(ctx context.Context) bool {
	if !s.enabled || s.sampleBasisPoints == 0 || len(s.allowedTenantIDs) == 0 || ctx == nil {
		return false
	}
	scope, ok := ctx.Value(piiShadowScopeKey{}).(piiShadowScope)
	if !ok || scope.tenantID == "" || scope.requestID == "" {
		return false
	}
	if _, allowed := s.allowedTenantIDs[scope.tenantID]; !allowed {
		return false
	}
	if s.sampleBasisPoints >= PIIShadowSampleScale {
		return true
	}
	digest := sha256.Sum256([]byte(scope.tenantID + "\x00" + scope.requestID))
	bucket := binary.BigEndian.Uint64(digest[:8]) % PIIShadowSampleScale
	return bucket < s.sampleBasisPoints
}
