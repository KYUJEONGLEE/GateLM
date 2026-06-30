package provider

import "fmt"

type Registry struct {
	defaultAdapterType string
	adapters           map[string]Adapter
}

func NewRegistry(defaultAdapterType string, adapters ...Adapter) *Registry {
	registry := &Registry{
		defaultAdapterType: defaultAdapterType,
		adapters:           make(map[string]Adapter, len(adapters)),
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
	if r.adapters == nil {
		r.adapters = make(map[string]Adapter)
	}
	r.adapters[adapter.AdapterType()] = adapter
}

func (r *Registry) Get(adapterType string) (Adapter, error) {
	if adapterType == "" {
		adapterType = r.defaultAdapterType
	}

	adapter, ok := r.adapters[adapterType]
	if !ok {
		return nil, fmt.Errorf("provider adapter %q is not registered", adapterType)
	}

	return adapter, nil
}

func (r *Registry) DefaultAdapterType() string {
	return r.defaultAdapterType
}
