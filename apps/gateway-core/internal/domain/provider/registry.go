package provider

import "fmt"

type Registry struct {
	defaultProvider string
	adapters        map[string]Adapter
}

func NewRegistry(defaultProvider string, adapters ...Adapter) *Registry {
	registry := &Registry{
		defaultProvider: defaultProvider,
		adapters:        make(map[string]Adapter, len(adapters)),
	}

	for _, adapter := range adapters {
		registry.Register(adapter)
	}

	return registry
}

func (r *Registry) Register(adapter Adapter) {
	if adapter == nil {
		return
	}
	r.adapters[adapter.Name()] = adapter
}

func (r *Registry) Get(providerName string) (Adapter, error) {
	if providerName == "" {
		providerName = r.defaultProvider
	}

	adapter, ok := r.adapters[providerName]
	if !ok {
		return nil, fmt.Errorf("provider adapter %q is not registered", providerName)
	}

	return adapter, nil
}

func (r *Registry) DefaultProvider() string {
	return r.defaultProvider
}
