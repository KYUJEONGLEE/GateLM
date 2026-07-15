package e5onnx

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	encoderManifestSchema                       = "gatelm.difficulty-e5-encoder-manifest.v1"
	runtimeLockSchema                           = "gatelm.difficulty-e5-gateway-runtime-lock.v1"
	canonicalEncoderBundleVersion               = "difficulty-e5-encoder-pca64.2026-07-15.v1"
	canonicalEncoderBundleSHA256                = "8282e6f9475edcd6b9f8a87b4fd1e627fe7ee17d568ad038090f2e7a80487413"
	canonicalGatewayRuntimeVersion              = "difficulty-e5-gateway-runtime.linux-amd64.2026-07-15.v1"
	pinnedTokenizerBindingModule                = "github.com/daulet/tokenizers"
	pinnedTokenizerBindingVersion               = "v1.23.0"
	pinnedTokenizerCoreVersion                  = "0.22.0"
	pinnedTokenizerNativeArchiveSHA256          = "c31e13e0840ca01f8064490a73ae2198979ae3ea48f606171616e2901fe6d3b0"
	pinnedTokenizerNativeArchiveSizeBytes int64 = 14300699
	pinnedTokenizerNativeLibrarySHA256          = "0b968ecbb84eb12a02c9cd51fd80d2b57a6f3fec0f78090d1fe8f347e6cc6845"
	pinnedTokenizerNativeLibrarySizeBytes int64 = 50013964
	pinnedONNXRuntimeBindingModule              = "github.com/yalue/onnxruntime_go"
	pinnedONNXRuntimeBindingVersion             = "v1.22.0"
	pinnedONNXRuntimeVersion                    = "1.22.1"
	pinnedONNXRuntimePackageSHA256              = "2ee0ed327f6cf2b860182bc4f2feb905c44a596cd120a05c510da6e4044a3e58"
	pinnedONNXRuntimePackageSizeBytes     int64 = 121484102

	FailureArtifactReadFailed  = "artifact_read_failed"
	FailureArtifactInvalid     = "artifact_invalid"
	FailureArtifactMismatch    = "artifact_mismatch"
	FailureUnsupportedPlatform = "unsupported_platform"
)

type validationError struct {
	code string
}

func (err validationError) Error() string { return err.code }

func FailureCodeOf(err error) string {
	var target validationError
	if errors.As(err, &target) {
		return target.code
	}
	return ""
}

type BundleConfig struct {
	ArtifactRoot        string
	EncoderManifestPath string
	RuntimeLockPath     string
	Platform            string
}

type VerifiedBundle struct {
	ArtifactRoot           string
	ModelDirectory         string
	TokenizerPath          string
	ModelPath              string
	ONNXRuntimeLibraryPath string
	RuntimeVersion         string
	EncoderBundleVersion   string
	EncoderBundleSHA256    string
}

type runtimeArtifact struct {
	Role         string `json:"role"`
	RelativePath string `json:"relativePath"`
	SHA256       string `json:"sha256"`
	SizeBytes    int64  `json:"sizeBytes"`
}

type encoderManifest struct {
	SchemaVersion     string            `json:"schemaVersion"`
	BundleVersion     string            `json:"bundleVersion"`
	ArtifactDirectory string            `json:"artifactDirectory"`
	RuntimeArtifacts  []runtimeArtifact `json:"runtimeArtifacts"`
	BundleSHA256      string            `json:"bundleSha256"`
}

type nativeArtifact struct {
	RelativePath string `json:"relativePath"`
	SHA256       string `json:"sha256"`
	SizeBytes    int64  `json:"sizeBytes"`
}

type runtimeLock struct {
	SchemaVersion                   string         `json:"schemaVersion"`
	RuntimeVersion                  string         `json:"runtimeVersion"`
	Platform                        string         `json:"platform"`
	EncoderManifestSHA256           string         `json:"encoderManifestSha256"`
	EncoderBundleVersion            string         `json:"encoderBundleVersion"`
	EncoderBundleSHA256             string         `json:"encoderBundleSha256"`
	TokenizerBindingModule          string         `json:"tokenizerBindingModule"`
	TokenizerBindingVersion         string         `json:"tokenizerBindingVersion"`
	TokenizerCoreVersion            string         `json:"tokenizerCoreVersion"`
	TokenizerNativeArchiveSHA256    string         `json:"tokenizerNativeArchiveSha256"`
	TokenizerNativeArchiveSizeBytes int64          `json:"tokenizerNativeArchiveSizeBytes"`
	TokenizerNativeLibrarySHA256    string         `json:"tokenizerNativeLibrarySha256"`
	TokenizerNativeLibrarySizeBytes int64          `json:"tokenizerNativeLibrarySizeBytes"`
	ONNXRuntimeBindingModule        string         `json:"onnxRuntimeBindingModule"`
	ONNXRuntimeBindingVersion       string         `json:"onnxRuntimeBindingVersion"`
	ONNXRuntimeVersion              string         `json:"onnxRuntimeVersion"`
	ONNXRuntimePackageSHA256        string         `json:"onnxRuntimePackageSha256"`
	ONNXRuntimePackageSizeBytes     int64          `json:"onnxRuntimePackageSizeBytes"`
	ONNXRuntime                     nativeArtifact `json:"onnxRuntime"`
}

func VerifyBundle(config BundleConfig) (VerifiedBundle, error) {
	root, err := verifiedRoot(config.ArtifactRoot)
	if err != nil {
		return VerifiedBundle{}, err
	}
	manifestPayload, err := readBoundedFile(config.EncoderManifestPath, 1<<20)
	if err != nil {
		return VerifiedBundle{}, err
	}
	lockPayload, err := readBoundedFile(config.RuntimeLockPath, 64<<10)
	if err != nil {
		return VerifiedBundle{}, err
	}
	var manifest encoderManifest
	if json.Unmarshal(manifestPayload, &manifest) != nil {
		return VerifiedBundle{}, validationError{code: FailureArtifactInvalid}
	}
	var lock runtimeLock
	decoder := json.NewDecoder(bytes.NewReader(lockPayload))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&lock) != nil || decoder.Decode(&struct{}{}) != io.EOF {
		return VerifiedBundle{}, validationError{code: FailureArtifactInvalid}
	}
	platform := strings.TrimSpace(config.Platform)
	if platform == "" {
		platform = runtime.GOOS + "-" + runtime.GOARCH
	}
	if lock.SchemaVersion != runtimeLockSchema || lock.Platform != platform {
		return VerifiedBundle{}, validationError{code: FailureUnsupportedPlatform}
	}
	if manifest.SchemaVersion != encoderManifestSchema ||
		manifest.BundleVersion != canonicalEncoderBundleVersion ||
		manifest.BundleSHA256 != canonicalEncoderBundleSHA256 ||
		lock.RuntimeVersion != canonicalGatewayRuntimeVersion ||
		lock.EncoderBundleVersion != manifest.BundleVersion ||
		lock.EncoderBundleSHA256 != manifest.BundleSHA256 ||
		lock.EncoderManifestSHA256 != sha256Hex(manifestPayload) ||
		lock.TokenizerBindingModule != pinnedTokenizerBindingModule ||
		lock.TokenizerBindingVersion != pinnedTokenizerBindingVersion ||
		lock.TokenizerCoreVersion != pinnedTokenizerCoreVersion ||
		lock.TokenizerNativeArchiveSHA256 != pinnedTokenizerNativeArchiveSHA256 ||
		lock.TokenizerNativeArchiveSizeBytes != pinnedTokenizerNativeArchiveSizeBytes ||
		lock.TokenizerNativeLibrarySHA256 != pinnedTokenizerNativeLibrarySHA256 ||
		lock.TokenizerNativeLibrarySizeBytes != pinnedTokenizerNativeLibrarySizeBytes ||
		lock.ONNXRuntimeBindingModule != pinnedONNXRuntimeBindingModule ||
		lock.ONNXRuntimeBindingVersion != pinnedONNXRuntimeBindingVersion ||
		lock.ONNXRuntimeVersion != pinnedONNXRuntimeVersion ||
		lock.ONNXRuntimePackageSHA256 != pinnedONNXRuntimePackageSHA256 ||
		lock.ONNXRuntimePackageSizeBytes != pinnedONNXRuntimePackageSizeBytes {
		return VerifiedBundle{}, validationError{code: FailureArtifactMismatch}
	}
	modelDirectory, err := resolveWithinRoot(root, manifest.ArtifactDirectory)
	if err != nil {
		return VerifiedBundle{}, err
	}
	roles := make(map[string]string, len(manifest.RuntimeArtifacts))
	for _, artifact := range manifest.RuntimeArtifacts {
		if artifact.Role == "" || roles[artifact.Role] != "" || !validDigest(artifact.SHA256) || artifact.SizeBytes <= 0 {
			return VerifiedBundle{}, validationError{code: FailureArtifactInvalid}
		}
		path, err := resolveWithinRoot(modelDirectory, artifact.RelativePath)
		if err != nil {
			return VerifiedBundle{}, err
		}
		if err := verifyFile(path, artifact.SizeBytes, artifact.SHA256); err != nil {
			return VerifiedBundle{}, err
		}
		roles[artifact.Role] = path
	}
	tokenizerPath := roles["tokenizer_json"]
	modelPath := roles["encoder_onnx_dynamic_qint8"]
	if tokenizerPath == "" || modelPath == "" {
		return VerifiedBundle{}, validationError{code: FailureArtifactInvalid}
	}
	if !validDigest(lock.ONNXRuntime.SHA256) || lock.ONNXRuntime.SizeBytes <= 0 {
		return VerifiedBundle{}, validationError{code: FailureArtifactInvalid}
	}
	libraryPath, err := resolveWithinRoot(root, lock.ONNXRuntime.RelativePath)
	if err != nil {
		return VerifiedBundle{}, err
	}
	if err := verifyFile(libraryPath, lock.ONNXRuntime.SizeBytes, lock.ONNXRuntime.SHA256); err != nil {
		return VerifiedBundle{}, err
	}
	return VerifiedBundle{
		ArtifactRoot:           root,
		ModelDirectory:         modelDirectory,
		TokenizerPath:          tokenizerPath,
		ModelPath:              modelPath,
		ONNXRuntimeLibraryPath: libraryPath,
		RuntimeVersion:         lock.RuntimeVersion,
		EncoderBundleVersion:   manifest.BundleVersion,
		EncoderBundleSHA256:    manifest.BundleSHA256,
	}, nil
}

func verifiedRoot(path string) (string, error) {
	if strings.TrimSpace(path) == "" {
		return "", validationError{code: FailureArtifactInvalid}
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", validationError{code: FailureArtifactInvalid}
	}
	resolved, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", validationError{code: FailureArtifactReadFailed}
	}
	info, err := os.Stat(resolved)
	if err != nil || !info.IsDir() {
		return "", validationError{code: FailureArtifactReadFailed}
	}
	return filepath.Clean(resolved), nil
}

func resolveWithinRoot(root string, relative string) (string, error) {
	if relative == "" || filepath.IsAbs(relative) {
		return "", validationError{code: FailureArtifactInvalid}
	}
	clean := filepath.Clean(filepath.FromSlash(relative))
	if clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", validationError{code: FailureArtifactInvalid}
	}
	joined := filepath.Join(root, clean)
	resolved, err := filepath.EvalSymlinks(joined)
	if err != nil {
		return "", validationError{code: FailureArtifactReadFailed}
	}
	if resolved != root && !strings.HasPrefix(resolved, root+string(filepath.Separator)) {
		return "", validationError{code: FailureArtifactInvalid}
	}
	return resolved, nil
}

func readBoundedFile(path string, limit int64) ([]byte, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, validationError{code: FailureArtifactReadFailed}
	}
	defer file.Close()
	payload, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return nil, validationError{code: FailureArtifactReadFailed}
	}
	if int64(len(payload)) > limit {
		return nil, validationError{code: FailureArtifactInvalid}
	}
	return payload, nil
}

func verifyFile(path string, size int64, digest string) error {
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() {
		return validationError{code: FailureArtifactReadFailed}
	}
	if info.Size() != size {
		return validationError{code: FailureArtifactMismatch}
	}
	file, err := os.Open(path)
	if err != nil {
		return validationError{code: FailureArtifactReadFailed}
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return validationError{code: FailureArtifactReadFailed}
	}
	if hex.EncodeToString(hash.Sum(nil)) != digest {
		return validationError{code: FailureArtifactMismatch}
	}
	return nil
}

func validDigest(value string) bool {
	if len(value) != sha256.Size*2 || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func sha256Hex(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}
