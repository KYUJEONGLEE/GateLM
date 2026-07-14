package difficultymodel

import (
	"encoding/json"
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"math"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestValidateOfflineArtifactSupportsFixedCandidates(t *testing.T) {
	t.Parallel()
	for candidate, expectedDimension := range map[string]int{
		OfflineCandidateRuleOnly:           42,
		OfflineCandidateProjection:         45,
		OfflineCandidateProjectionAndHeads: 57,
	} {
		candidate := candidate
		expectedDimension := expectedDimension
		t.Run(candidate, func(t *testing.T) {
			t.Parallel()
			artifact := validOfflineArtifact(t, candidate, 3)
			if artifact.TotalDimension != expectedDimension {
				t.Fatalf("totalDimension = %d, want %d", artifact.TotalDimension, expectedDimension)
			}
			if err := ValidateOfflineArtifact(artifact); err != nil {
				t.Fatal(err)
			}
			generated, err := RenderOfflineGo(artifact, "routing")
			if err != nil {
				t.Fatal(err)
			}
			text := string(generated)
			for _, marker := range []string{
				"Offline/shadow candidate only",
				OfflineGeneratedVariableName,
				candidate,
				artifact.ContentHash,
			} {
				if !strings.Contains(text, marker) {
					t.Fatalf("generated Go is missing %q:\n%s", marker, text)
				}
			}
			if !regexp.MustCompile(`totalDimension:\s+` + strconv.Itoa(expectedDimension)).MatchString(text) {
				t.Fatalf("generated Go does not preserve total dimension %d:\n%s", expectedDimension, text)
			}
			typeCheckOfflineGeneratedGo(t, generated)
		})
	}
}

func TestOfflineArtifactHashBindsProjectionDimensionAndProvenance(t *testing.T) {
	t.Parallel()
	first := validOfflineArtifact(t, OfflineCandidateProjection, 3)
	second := validOfflineArtifact(t, OfflineCandidateProjection, 4)
	if first.ContentHash == second.ContentHash {
		t.Fatal("projection dimension did not change offline content hash")
	}
	mutated := first
	mutated.SplitManifestSHA256 = strings.Repeat("9", 64)
	if OfflineContentHash(mutated) == first.ContentHash {
		t.Fatal("split provenance did not change offline content hash")
	}
	mutated = first
	mutated.ProjectionParameters.Components[0][0] += 0.25
	if OfflineBundleHash(mutated) == first.BundleHash {
		t.Fatal("projection parameters did not change bundle hash")
	}
}

func TestValidateOfflineArtifactRejectsShapeAndNumericDrift(t *testing.T) {
	t.Parallel()
	tests := map[string]func(*OfflineArtifact){
		"unsupported candidate": func(artifact *OfflineArtifact) { artifact.CandidateName = "unknown" },
		"dimension":             func(artifact *OfflineArtifact) { artifact.TotalDimension++ },
		"feature order": func(artifact *OfflineArtifact) {
			artifact.FeatureNames[0], artifact.FeatureNames[1] = artifact.FeatureNames[1], artifact.FeatureNames[0]
		},
		"weight dimension":  func(artifact *OfflineArtifact) { artifact.Weights = artifact.Weights[:len(artifact.Weights)-1] },
		"non-finite weight": func(artifact *OfflineArtifact) { artifact.Weights[0] = math.NaN() },
		"head order": func(artifact *OfflineArtifact) {
			artifact.SemanticHeadClassOrder[0].Classes[0], artifact.SemanticHeadClassOrder[0].Classes[1] =
				artifact.SemanticHeadClassOrder[0].Classes[1], artifact.SemanticHeadClassOrder[0].Classes[0]
		},
		"mutable version": func(artifact *OfflineArtifact) { artifact.ProjectionVersion = "latest" },
		"split hash":      func(artifact *OfflineArtifact) { artifact.SplitManifestSHA256 = "not-a-hash" },
		"bundle hash":     func(artifact *OfflineArtifact) { artifact.BundleHash = "sha256:" + strings.Repeat("9", 64) },
		"head parameter": func(artifact *OfflineArtifact) {
			artifact.SemanticHeadParameters[0].Coefficient[0] = artifact.SemanticHeadParameters[0].Coefficient[0][:3]
		},
		"threshold equality": func(artifact *OfflineArtifact) { artifact.ThresholdEquality = "greater_than" },
	}
	for name, mutate := range tests {
		name := name
		mutate := mutate
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			artifact := validOfflineArtifact(t, OfflineCandidateProjectionAndHeads, 3)
			mutate(&artifact)
			if name != "bundle hash" {
				artifact.BundleHash = OfflineBundleHash(artifact)
			}
			artifact.ContentHash = OfflineContentHash(artifact)
			if err := ValidateOfflineArtifact(artifact); err == nil {
				t.Fatal("invalid offline artifact was accepted")
			}
		})
	}
}

func TestParseOfflineArtifactRejectsMissingProvenanceAndUnknownFields(t *testing.T) {
	t.Parallel()
	artifact := validOfflineArtifact(t, OfflineCandidateProjectionAndHeads, 3)
	payload, err := json.Marshal(artifact)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(payload, &fields); err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{
		"offlineFeatureShapeVersion", "preprocessingVersion", "tokenizerVersion", "encoderVersion",
		"projectionParameters", "semanticHeadParameters", "weights", "calibrator", "threshold",
		"trainingDatasetSha256", "splitManifestSha256", "trainingPolicyVersion", "bundleHash", "contentHash",
	} {
		field := field
		t.Run(field, func(t *testing.T) {
			candidate := make(map[string]any, len(fields))
			for key, value := range fields {
				candidate[key] = value
			}
			delete(candidate, field)
			candidatePayload, err := json.Marshal(candidate)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := ParseOfflineArtifact(candidatePayload); err == nil {
				t.Fatalf("artifact without %s was accepted", field)
			}
		})
	}
	fields["rawPrompt"] = "must-not-be-accepted"
	unknownPayload, err := json.Marshal(fields)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseOfflineArtifact(unknownPayload); err == nil {
		t.Fatal("artifact with an unknown sensitive field was accepted")
	}
}

func TestV1AndOfflineArtifactParsersRejectCrossSchemaInput(t *testing.T) {
	t.Parallel()
	offlinePayload, err := json.Marshal(validOfflineArtifact(t, OfflineCandidateRuleOnly, 3))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseArtifact(offlinePayload); err == nil {
		t.Fatal("v1 parser accepted offline artifact")
	}
	if _, err := RenderArtifactPayload(offlinePayload, "routing"); err != nil {
		t.Fatalf("version-aware codegen rejected offline artifact: %v", err)
	}

	v1Payload, err := json.Marshal(validArtifact())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ParseOfflineArtifact(v1Payload); err == nil {
		t.Fatal("offline parser accepted v1 artifact")
	}
	if _, err := RenderArtifactPayload(v1Payload, "routing"); err != nil {
		t.Fatalf("version-aware codegen rejected v1 artifact: %v", err)
	}
}

func TestVerifyOfflineArtifactPayloadReturnsSafeProvenanceOnly(t *testing.T) {
	t.Parallel()
	artifact := validOfflineArtifact(t, OfflineCandidateProjectionAndHeads, 3)
	payload, err := json.Marshal(artifact)
	if err != nil {
		t.Fatal(err)
	}
	report := VerifyOfflineArtifactPayload(payload)
	if report.Status != "valid" || report.TotalDimension != 57 || report.Components == nil {
		t.Fatalf("unexpected validation report: %#v", report)
	}
	reportPayload, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	text := string(reportPayload)
	for _, forbidden := range []string{
		"weights", "projectionParameters", "semanticHeadParameters", "calibrator", "coefficient", "intercept",
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("validation report exposed %q: %s", forbidden, text)
		}
	}
}

func validOfflineArtifact(t *testing.T, candidate string, projectionDimension int) OfflineArtifact {
	t.Helper()
	names, err := offlineFeatureNames(candidate, projectionDimension)
	if err != nil {
		t.Fatal(err)
	}
	coefficient := 1.25
	intercept := -0.1
	artifact := OfflineArtifact{
		SchemaVersion:               OfflineArtifactSchemaVersion,
		ArtifactVersion:             "difficulty-offline.synthetic-test-v1",
		ModelVersion:                ModelVersion,
		OfflineFeatureShapeVersion:  OfflineFeatureShapeVersion,
		CandidateName:               candidate,
		RuleVectorVersion:           "difficulty-feature-vector.v1",
		PreprocessingVersion:        "difficulty-preprocessing.synthetic-test-v1",
		TokenizerVersion:            "difficulty-tokenizer.synthetic-test-v1",
		EncoderVersion:              "difficulty-encoder.synthetic-test-v1",
		PoolingVersion:              "difficulty-pooling.synthetic-test-v1",
		ProjectionVersion:           "difficulty-projection.synthetic-test-v1",
		ProjectionDimension:         projectionDimension,
		ProjectionParameters:        validOfflineProjectionParameters(projectionDimension),
		SemanticHeadsVersion:        "difficulty-semantic-heads.synthetic-test-v1",
		SemanticHeadClassOrder:      cloneOfflineHeadOrder(canonicalOfflineSemanticHeadClassOrder),
		SemanticHeadInputDimension:  4,
		SemanticHeadParameters:      validOfflineSemanticHeadParameters(4),
		SemanticHeadProbabilityRule: OfflineHeadProbabilityRule,
		TotalDimension:              len(names),
		FeatureNames:                names,
		Weights:                     make([]float64, len(names)),
		Bias:                        -0.25,
		CalibrationVersion:          CalibrationVersion,
		Calibrator: Calibrator{
			Type:        "platt",
			Input:       "raw_probability",
			Coefficient: &coefficient,
			Intercept:   &intercept,
		},
		ThresholdPolicyVersion: "difficulty-threshold.synthetic-test-v1",
		Threshold:              0.45,
		ThresholdEquality:      OfflineThresholdEquality,
		TrainingDatasetVersion: "difficulty-dataset.synthetic-test-v1",
		TrainingDatasetSHA256:  strings.Repeat("a", 64),
		SplitPolicyVersion:     "difficulty-family-split.synthetic-test-v1",
		SplitManifestSHA256:    strings.Repeat("b", 64),
		TrainingPolicyVersion:  "difficulty-logistic-training.v1",
		Regularization: Regularization{
			PolicyVersion: "difficulty-logistic-training.v1",
			Penalty:       "l2",
			Solver:        "liblinear",
			SelectedC:     1,
			GroupFolds:    2,
			RandomSeed:    1729,
		},
		ComponentHashes: OfflineComponentHashes{
			RuleVector:    "sha256:" + strings.Repeat("1", 64),
			Tokenizer:     "sha256:" + strings.Repeat("2", 64),
			Encoder:       "sha256:" + strings.Repeat("3", 64),
			Projection:    "sha256:" + strings.Repeat("4", 64),
			SemanticHeads: "sha256:" + strings.Repeat("5", 64),
		},
		BundleVersion:        "difficulty-feature-bundle.synthetic-test-v1",
		BundleHashAlgorithm:  OfflineBundleHashAlgorithm,
		ContentHashAlgorithm: OfflineContentHashAlgorithm,
	}
	for index := range artifact.Weights {
		artifact.Weights[index] = float64(index-20) / 100
	}
	artifact.BundleHash = OfflineBundleHash(artifact)
	artifact.ContentHash = OfflineContentHash(artifact)
	return artifact
}

func validOfflineProjectionParameters(projectionDimension int) OfflineProjectionParameters {
	components := make([][]float64, projectionDimension)
	for row := range components {
		components[row] = []float64{float64(row) / 10, 0.2, -0.1, 0.4}
	}
	return OfflineProjectionParameters{
		Kind:            "pca_full_svd",
		InputDimension:  4,
		OutputDimension: projectionDimension,
		DType:           "float32_le",
		FitSplit:        "train",
		RandomSeed:      20260714,
		Whiten:          false,
		L2Position:      "after_projection",
		L2Epsilon:       1e-12,
		Mean:            []float64{0.1, 0.2, 0.3, 0.4},
		Components:      components,
	}
}

func validOfflineSemanticHeadParameters(inputDimension int) []OfflineSemanticHeadParameters {
	result := make([]OfflineSemanticHeadParameters, len(canonicalOfflineSemanticHeadClassOrder))
	for index, spec := range canonicalOfflineSemanticHeadClassOrder {
		coefficient := make([][]float64, len(spec.Classes))
		intercept := make([]float64, len(spec.Classes))
		for classIndex := range coefficient {
			coefficient[classIndex] = make([]float64, inputDimension)
			for inputIndex := range coefficient[classIndex] {
				coefficient[classIndex][inputIndex] = float64(index+classIndex+inputIndex) / 100
			}
			intercept[classIndex] = float64(classIndex-index) / 10
		}
		result[index] = OfflineSemanticHeadParameters{
			Name:        spec.Name,
			Classes:     append([]string(nil), spec.Classes...),
			Coefficient: coefficient,
			Intercept:   intercept,
		}
	}
	return result
}

func cloneOfflineHeadOrder(source []OfflineSemanticHeadSpec) []OfflineSemanticHeadSpec {
	result := make([]OfflineSemanticHeadSpec, len(source))
	for index, head := range source {
		result[index] = OfflineSemanticHeadSpec{
			Name:    head.Name,
			Classes: append([]string(nil), head.Classes...),
		}
	}
	return result
}

func typeCheckOfflineGeneratedGo(t *testing.T, generated []byte) {
	t.Helper()
	stub := []byte(`package routing
type difficultyFeatureShapeDescriptor struct {
    offlineFeatureShapeVersion string
    candidateName string
    totalDimension int
    featureNames []string
}
type difficultyLinearScorer struct { bias float64; weights []float64 }
type difficultyCalibratorKind string
const difficultyCalibratorPlatt difficultyCalibratorKind = "platt"
const difficultyCalibratorIsotonic difficultyCalibratorKind = "isotonic"
type difficultyCalibrator struct {
    kind difficultyCalibratorKind
    plattCoefficient float64
    plattIntercept float64
    isotonicX []float64
    isotonicY []float64
}
type difficultyOfflineLogisticModel struct {
    artifactVersion string
    contentHash string
    descriptor difficultyFeatureShapeDescriptor
    scorer difficultyLinearScorer
    calibrator difficultyCalibrator
    threshold float64
}`)
	fileSet := token.NewFileSet()
	files := make([]*ast.File, 0, 2)
	for name, source := range map[string][]byte{"stub.go": stub, "generated.go": generated} {
		file, err := parser.ParseFile(fileSet, name, source, parser.AllErrors)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		files = append(files, file)
	}
	if _, err := (&types.Config{}).Check("routing", fileSet, files, nil); err != nil {
		t.Fatalf("generated Go did not type-check: %v\n%s", err, generated)
	}
}
