package e5onnx

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestVerifyBundleAcceptsPinnedLocalArtifacts(t *testing.T) {
	config := writeTestBundle(t, "tokenizer.json")

	bundle, err := VerifyBundle(config)
	if err != nil {
		t.Fatal(err)
	}
	if bundle.TokenizerPath == "" || bundle.ModelPath == "" || bundle.ONNXRuntimeLibraryPath == "" {
		t.Fatalf("verified bundle omitted required local paths")
	}
}

func TestVerifyBundleRejectsArtifactHashMismatchWithoutPathDetail(t *testing.T) {
	config := writeTestBundle(t, "tokenizer.json")
	modelPath := filepath.Join(config.ArtifactRoot, "model", "generated", "model.onnx")
	if err := os.WriteFile(modelPath, []byte("tampered-secret"), 0o600); err != nil {
		t.Fatal(err)
	}

	_, err := VerifyBundle(config)
	if FailureCodeOf(err) != FailureArtifactMismatch {
		t.Fatalf("failure code=%q, want %q", FailureCodeOf(err), FailureArtifactMismatch)
	}
	if strings.Contains(err.Error(), "model.onnx") || strings.Contains(err.Error(), "tampered") {
		t.Fatalf("validation error exposed artifact detail: %q", err)
	}
}

func TestVerifyBundleRejectsArtifactPathTraversal(t *testing.T) {
	config := writeTestBundle(t, "../tokenizer.json")

	_, err := VerifyBundle(config)
	if FailureCodeOf(err) != FailureArtifactInvalid {
		t.Fatalf("failure code=%q, want %q", FailureCodeOf(err), FailureArtifactInvalid)
	}
}

func TestVerifyBundleRejectsUnpinnedNativeTokenizerMaterial(t *testing.T) {
	config := writeTestBundle(t, "tokenizer.json")
	payload, err := os.ReadFile(config.RuntimeLockPath)
	if err != nil {
		t.Fatal(err)
	}
	var lock runtimeLock
	if err := json.Unmarshal(payload, &lock); err != nil {
		t.Fatal(err)
	}
	lock.TokenizerNativeLibrarySHA256 = strings.Repeat("0", sha256.Size*2)
	payload, err = json.Marshal(lock)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config.RuntimeLockPath, payload, 0o600); err != nil {
		t.Fatal(err)
	}

	_, err = VerifyBundle(config)
	if FailureCodeOf(err) != FailureArtifactMismatch {
		t.Fatalf("failure code=%q, want %q", FailureCodeOf(err), FailureArtifactMismatch)
	}
}

func writeTestBundle(t *testing.T, tokenizerRelativePath string) BundleConfig {
	t.Helper()
	root := t.TempDir()
	modelDirectory := filepath.Join(root, "model")
	modelPath := filepath.Join(modelDirectory, "generated", "model.onnx")
	tokenizerPath := filepath.Join(modelDirectory, "tokenizer.json")
	libraryPath := filepath.Join(root, "native", "libonnxruntime.so")
	for _, directory := range []string{filepath.Dir(modelPath), filepath.Dir(libraryPath)} {
		if err := os.MkdirAll(directory, 0o700); err != nil {
			t.Fatal(err)
		}
	}
	files := map[string][]byte{
		tokenizerPath: []byte("tokenizer"),
		modelPath:     []byte("model"),
		libraryPath:   []byte("onnxruntime"),
	}
	for path, payload := range files {
		if err := os.WriteFile(path, payload, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	manifest := encoderManifest{
		SchemaVersion:     encoderManifestSchema,
		BundleVersion:     canonicalEncoderBundleVersion,
		BundleSHA256:      canonicalEncoderBundleSHA256,
		ArtifactDirectory: "model",
		RuntimeArtifacts: []runtimeArtifact{
			{Role: "tokenizer_json", RelativePath: tokenizerRelativePath, SHA256: hashBytes(files[tokenizerPath]), SizeBytes: int64(len(files[tokenizerPath]))},
			{Role: "encoder_onnx_dynamic_qint8", RelativePath: "generated/model.onnx", SHA256: hashBytes(files[modelPath]), SizeBytes: int64(len(files[modelPath]))},
		},
	}
	manifestPayload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	manifestPath := filepath.Join(root, "encoder-manifest.json")
	if err := os.WriteFile(manifestPath, manifestPayload, 0o600); err != nil {
		t.Fatal(err)
	}
	lock := runtimeLock{
		SchemaVersion:                   runtimeLockSchema,
		RuntimeVersion:                  canonicalGatewayRuntimeVersion,
		Platform:                        runtime.GOOS + "-" + runtime.GOARCH,
		EncoderManifestSHA256:           hashBytes(manifestPayload),
		EncoderBundleVersion:            canonicalEncoderBundleVersion,
		EncoderBundleSHA256:             canonicalEncoderBundleSHA256,
		TokenizerBindingModule:          pinnedTokenizerBindingModule,
		TokenizerBindingVersion:         pinnedTokenizerBindingVersion,
		TokenizerCoreVersion:            pinnedTokenizerCoreVersion,
		TokenizerNativeArchiveSHA256:    pinnedTokenizerNativeArchiveSHA256,
		TokenizerNativeArchiveSizeBytes: pinnedTokenizerNativeArchiveSizeBytes,
		TokenizerNativeLibrarySHA256:    pinnedTokenizerNativeLibrarySHA256,
		TokenizerNativeLibrarySizeBytes: pinnedTokenizerNativeLibrarySizeBytes,
		ONNXRuntimeBindingModule:        pinnedONNXRuntimeBindingModule,
		ONNXRuntimeBindingVersion:       pinnedONNXRuntimeBindingVersion,
		ONNXRuntimeVersion:              pinnedONNXRuntimeVersion,
		ONNXRuntimePackageSHA256:        pinnedONNXRuntimePackageSHA256,
		ONNXRuntimePackageSizeBytes:     pinnedONNXRuntimePackageSizeBytes,
		ONNXRuntime: nativeArtifact{
			RelativePath: "native/libonnxruntime.so",
			SHA256:       hashBytes(files[libraryPath]),
			SizeBytes:    int64(len(files[libraryPath])),
		},
	}
	lockPayload, err := json.Marshal(lock)
	if err != nil {
		t.Fatal(err)
	}
	lockPath := filepath.Join(root, "runtime-lock.json")
	if err := os.WriteFile(lockPath, lockPayload, 0o600); err != nil {
		t.Fatal(err)
	}
	return BundleConfig{
		ArtifactRoot:        root,
		EncoderManifestPath: manifestPath,
		RuntimeLockPath:     lockPath,
		Platform:            runtime.GOOS + "-" + runtime.GOARCH,
	}
}

func hashBytes(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}
