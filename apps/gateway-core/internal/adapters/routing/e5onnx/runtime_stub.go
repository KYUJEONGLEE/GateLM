//go:build !difficulty_e5_onnx || !linux || !cgo

package e5onnx

import "gatelm/apps/gateway-core/internal/domain/routing"

func NewEncoder(BundleConfig) (routing.DifficultySemanticPooledEncoder, error) {
	return nil, ErrUnavailable
}
