//go:build difficulty_e5_onnx && linux && cgo

package e5onnx

import (
	"bytes"
	"context"
	"encoding/binary"
	"math"
	"os"
	"strings"
	"testing"

	"github.com/daulet/tokenizers"
)

var nativePythonParityInstructions = []string{
	"explain one bounded workflow step.",
	"하나의 제한된 작업 단계를 설명하세요.",
	strings.Repeat("bounded ", 160) + "finish",
}

func TestNativeEncoderMatchesCanonicalPythonPooledOutput(t *testing.T) {
	root := os.Getenv("GATELM_E5_INTEGRATION_BUNDLE_ROOT")
	expectedPath := os.Getenv("GATELM_E5_INTEGRATION_EXPECTED_POOLED")
	expectedTokensPath := os.Getenv("GATELM_E5_INTEGRATION_EXPECTED_TOKENS")
	if root == "" || expectedPath == "" || expectedTokensPath == "" {
		t.Skip("native Python parity inputs are not configured")
	}
	expectedPayload, err := os.ReadFile(expectedPath)
	if err != nil {
		t.Fatal("read ephemeral Python parity output")
	}
	if len(expectedPayload) != len(nativePythonParityInstructions)*nativeEmbeddingDimension*4 {
		t.Fatalf("unexpected Python parity output size: %d", len(expectedPayload))
	}
	expectedTokenPayload, err := os.ReadFile(expectedTokensPath)
	if err != nil {
		t.Fatal("read ephemeral Python tokenizer parity output")
	}
	expectedTokens := bytes.NewReader(expectedTokenPayload)

	encoder, err := NewEncoder(BundleConfig{
		ArtifactRoot:        root,
		EncoderManifestPath: root + "/difficulty-e5-encoder-manifest.v2.json",
		RuntimeLockPath:     root + "/difficulty-e5-gateway-runtime-lock.linux-amd64.v2.json",
	})
	if err != nil {
		t.Fatal("initialize native encoder")
	}
	defer encoder.Close()
	native, ok := encoder.(*nativeEncoder)
	if !ok {
		t.Fatal("native encoder implementation is unavailable")
	}
	for sample, instruction := range nativePythonParityInstructions {
		encoded := native.tokenizer.EncodeWithOptions(
			inputPrefix+instruction,
			true,
			tokenizers.WithReturnAttentionMask(),
		)
		expectedIDs, expectedMask := readExpectedTokenEncoding(t, expectedTokens)
		if len(encoded.IDs) != len(expectedIDs) || len(encoded.AttentionMask) != len(expectedMask) {
			t.Fatalf("native/Python tokenizer length mismatch at sample %d", sample)
		}
		for index := range encoded.IDs {
			if encoded.IDs[index] != expectedIDs[index] || encoded.AttentionMask[index] != expectedMask[index] {
				t.Fatalf("native/Python tokenizer mismatch at sample %d token %d", sample, index)
			}
		}
		actual, err := encoder.EncodePooled(context.Background(), instruction)
		if err != nil {
			t.Fatalf("run native encoder for parity sample %d", sample)
		}
		maximumDelta := 0.0
		for index := range actual {
			offset := (sample*nativeEmbeddingDimension + index) * 4
			expectedBits := binary.LittleEndian.Uint32(expectedPayload[offset : offset+4])
			expected := math.Float32frombits(expectedBits)
			delta := math.Abs(float64(actual[index] - expected))
			if math.IsNaN(float64(expected)) || math.IsInf(float64(expected), 0) {
				t.Fatalf("canonical Python parity output was non-finite at sample %d", sample)
			}
			if delta > maximumDelta {
				maximumDelta = delta
			}
		}
		if maximumDelta > 1e-5 {
			t.Fatalf("native/Python pooled parity maximum delta=%g exceeded tolerance at sample %d", maximumDelta, sample)
		}
	}
	if expectedTokens.Len() != 0 {
		t.Fatal("canonical Python tokenizer parity output had trailing material")
	}
}

func readExpectedTokenEncoding(t *testing.T, reader *bytes.Reader) ([]uint32, []uint32) {
	t.Helper()
	var length uint32
	if err := binary.Read(reader, binary.LittleEndian, &length); err != nil || length == 0 || length > maximumTokenLength {
		t.Fatal("canonical Python tokenizer parity output had invalid length")
	}
	ids := make([]uint32, length)
	mask := make([]uint32, length)
	if err := binary.Read(reader, binary.LittleEndian, ids); err != nil {
		t.Fatal("read canonical Python token IDs")
	}
	if err := binary.Read(reader, binary.LittleEndian, mask); err != nil {
		t.Fatal("read canonical Python attention mask")
	}
	return ids, mask
}
