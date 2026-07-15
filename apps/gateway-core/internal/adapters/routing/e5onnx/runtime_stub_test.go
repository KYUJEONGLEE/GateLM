//go:build !difficulty_e5_onnx || !linux || !cgo

package e5onnx

import (
	"errors"
	"testing"
)

func TestNativeEncoderIsUnavailableOutsideLinuxShadowProfile(t *testing.T) {
	encoder, err := NewEncoder(BundleConfig{})
	if encoder != nil || !errors.Is(err, ErrUnavailable) {
		t.Fatalf("encoder=%v error=%v, want unavailable stub", encoder, err)
	}
}
