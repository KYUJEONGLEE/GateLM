package envmap

import (
	"context"
	"fmt"
	"os"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/credentials"
)

type Resolver struct {
	bindings map[string]string
	lookup   func(string) (string, bool)
}

func NewResolver(bindings map[string]string) *Resolver {
	normalized := make(map[string]string, len(bindings))
	for refID, envName := range bindings {
		refID = strings.TrimSpace(refID)
		envName = strings.TrimSpace(envName)
		if refID == "" || envName == "" {
			continue
		}
		normalized[refID] = envName
	}
	return &Resolver{
		bindings: normalized,
		lookup:   os.LookupEnv,
	}
}

func (r *Resolver) Resolve(ctx context.Context, ref credentials.Ref) (credentials.Resolved, error) {
	if err := ctx.Err(); err != nil {
		return credentials.Resolved{}, err
	}
	ref = ref.Normalize()
	if err := ref.ValidateActive(); err != nil {
		return credentials.Resolved{}, err
	}
	if r == nil || r.lookup == nil {
		return credentials.Resolved{}, credentials.ErrUnavailable
	}

	envName := strings.TrimSpace(r.bindings[ref.CredentialRefID])
	if envName == "" {
		return credentials.Resolved{}, fmt.Errorf("%w: credential reference has no env binding", credentials.ErrUnavailable)
	}

	value, ok := r.lookup(envName)
	if !ok || strings.TrimSpace(value) == "" {
		return credentials.Resolved{}, fmt.Errorf("%w: credential env binding is empty", credentials.ErrUnavailable)
	}

	return credentials.Resolved{Value: value}, nil
}

func ParseBindings(raw string) map[string]string {
	bindings := map[string]string{}
	for _, entry := range strings.Split(raw, ",") {
		entry = strings.TrimSpace(entry)
		if entry == "" {
			continue
		}
		parts := strings.SplitN(entry, "=", 2)
		if len(parts) != 2 {
			continue
		}
		refID := strings.TrimSpace(parts[0])
		envName := strings.TrimSpace(parts[1])
		if refID == "" || envName == "" {
			continue
		}
		bindings[refID] = envName
	}
	return bindings
}
