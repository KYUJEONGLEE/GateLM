package difficultymodel

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"go/format"
	"io"
	"math"
	"regexp"
	"strconv"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	OfflineArtifactSchemaVersion = "gatelm.difficulty-offline-model-artifact.v1"
	OfflineFeatureShapeVersion   = "difficulty-offline-feature-shape.v1"
	OfflineBundleHashAlgorithm   = "difficulty-feature-bundle-material.v1"
	OfflineContentHashAlgorithm  = "difficulty-offline-model-inference-material.v1"
	OfflineGeneratedVariableName = "generatedDifficultyLogisticOfflineModel"
	OfflineThresholdEquality     = "greater_than_or_equal"
	OfflineHeadProbabilityRule   = "multinomial_linear_softmax.v1"

	OfflineCandidateRuleOnly           = "42d-rule-vector-v1"
	OfflineCandidateProjection         = "42d-rule-vector-v1-plus-projection"
	OfflineCandidateProjectionAndHeads = "42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities"

	GatewayShadow118DProfileName             = "gateway-shadow-118d"
	GatewayShadow118DArtifactVersion         = "difficulty-offline.owner-approved-500.single-request.2026-07-15.42d-rule-vector-v1-plus-projection-plus-semantic-head-probabilities.v3"
	GatewayShadow118DBundleHash              = "sha256:4209fbc2ea2a3a222bb8eae2b1003f8c358939c7f4a66ae2b2ef187972351220"
	GatewayShadow118DContentHash             = "sha256:72eb5171c30b191716553cb24cdf25cf314c2a53c9085542619de2283f6d1bdd"
	GatewayShadow118DProjectionHash          = "sha256:a9a2258d9d68724af3a1edc4b063d671e42d4d2e68c430e4aa3f668371aadafa"
	GatewayShadow118DSemanticHeadsHash       = "sha256:531bb72d1d22f134a11da76649cfde9102af5c116cf46765e03b8f2550d27386"
	GatewayShadow118DTrainingPolicyVersion   = "difficulty-logistic-training.semantic-candidates.single-request.2026-07-15.v3"
	GatewayShadow118DDecisionBoundaryVersion = "difficulty-decision-boundary.payload-empty-separate-score-3.2026-07-15.v1"
	GatewayShadow118DGeneratedName           = "generatedDifficultySemanticModel118D"

	GatewayShadow106DProfileName             = "gateway-shadow-106d-model-path-5000"
	GatewayShadow106DArtifactVersion         = "difficulty-offline.model-path-5000.2026-07-16.42d-rule-vector-v1-plus-projection.shadow.v1"
	GatewayShadow106DBundleHash              = "sha256:1a755c3bca16f76a43f86696e9b2028e805eb7536161245a8683adf78b118ebd"
	GatewayShadow106DContentHash             = "sha256:4c2c4f516206530d3b3f9c393b0633b7694a2e0aa5e20400d65faf088a184f5d"
	GatewayShadow106DProjectionHash          = "sha256:4800637a5aa82e3184cdb86052acbe973ba91aeb8119684ecba5baef4e1afc3d"
	GatewayShadow106DSemanticHeadsHash       = "sha256:8f835ce1799c18c32a7751a159fbd84a20bd970c39a7e13c41cf4ccca4790eef"
	GatewayShadow106DTrainingPolicyVersion   = "difficulty-logistic-training.semantic-candidates.single-request.2026-07-15.v3"
	GatewayShadow106DThresholdPolicyVersion  = "difficulty-threshold.model-path-5000.2026-07-16.v1"
	GatewayShadow106DDecisionBoundaryVersion = "difficulty-decision-boundary.semantic-empty-combined-8.2026-07-15.v2"
	GatewayShadow106DTrainingDatasetVersion  = "difficulty_model_path_5000_2026_07_16_owner_approved_v1"
	GatewayShadow106DTrainingDatasetHash     = "b29f2de446f540266572acd84b44ace5cf2084a3321a1f542d928abeadce45cf"
	GatewayShadow106DSplitPolicyVersion      = "difficulty-model-path-four-role-split.2026-07-16.v1"
	GatewayShadow106DSplitManifestHash       = "2066c1d46e6b2b6644bd100e53436c6b5ce3f12309eadb49cc174889a7b3afcd"
	GatewayShadow106DGeneratedName           = "generatedDifficultySemanticModel106D"
)

type OfflineSemanticHeadSpec struct {
	Name    string   `json:"name"`
	Classes []string `json:"classes"`
}

type OfflineProjectionParameters struct {
	Kind            string      `json:"kind"`
	InputDimension  int         `json:"inputDimension"`
	OutputDimension int         `json:"outputDimension"`
	DType           string      `json:"dtype"`
	FitSplit        string      `json:"fitSplit"`
	RandomSeed      int         `json:"randomSeed"`
	Whiten          bool        `json:"whiten"`
	L2Position      string      `json:"l2Position"`
	L2Epsilon       float64     `json:"l2Epsilon"`
	Mean            []float64   `json:"mean"`
	Components      [][]float64 `json:"components"`
}

type OfflineSemanticHeadParameters struct {
	Name        string      `json:"name"`
	Classes     []string    `json:"classes"`
	Coefficient [][]float64 `json:"coefficient"`
	Intercept   []float64   `json:"intercept"`
}

type OfflineComponentHashes struct {
	RuleVector    string `json:"ruleVector"`
	Tokenizer     string `json:"tokenizer"`
	Encoder       string `json:"encoder"`
	Projection    string `json:"projection"`
	SemanticHeads string `json:"semanticHeads"`
}

type OfflineArtifact struct {
	SchemaVersion               string                          `json:"schemaVersion"`
	ArtifactVersion             string                          `json:"artifactVersion"`
	ModelVersion                string                          `json:"modelVersion"`
	OfflineFeatureShapeVersion  string                          `json:"offlineFeatureShapeVersion"`
	CandidateName               string                          `json:"candidateName"`
	RuleVectorVersion           string                          `json:"ruleVectorVersion"`
	PreprocessingVersion        string                          `json:"preprocessingVersion"`
	TokenizerVersion            string                          `json:"tokenizerVersion"`
	EncoderVersion              string                          `json:"encoderVersion"`
	PoolingVersion              string                          `json:"poolingVersion"`
	ProjectionVersion           string                          `json:"projectionVersion"`
	ProjectionDimension         int                             `json:"projectionDimension"`
	ProjectionParameters        OfflineProjectionParameters     `json:"projectionParameters"`
	SemanticHeadsVersion        string                          `json:"semanticHeadsVersion"`
	SemanticHeadClassOrder      []OfflineSemanticHeadSpec       `json:"semanticHeadClassOrder"`
	SemanticHeadInputDimension  int                             `json:"semanticHeadInputDimension"`
	SemanticHeadParameters      []OfflineSemanticHeadParameters `json:"semanticHeadParameters"`
	SemanticHeadProbabilityRule string                          `json:"semanticHeadProbabilityRule"`
	TotalDimension              int                             `json:"totalDimension"`
	FeatureNames                []string                        `json:"featureNames"`
	Weights                     []float64                       `json:"weights"`
	Bias                        float64                         `json:"bias"`
	CalibrationVersion          string                          `json:"calibrationVersion"`
	Calibrator                  Calibrator                      `json:"calibrator"`
	ThresholdPolicyVersion      string                          `json:"thresholdPolicyVersion"`
	Threshold                   float64                         `json:"threshold"`
	ThresholdEquality           string                          `json:"thresholdEquality"`
	TrainingDatasetVersion      string                          `json:"trainingDatasetVersion"`
	TrainingDatasetSHA256       string                          `json:"trainingDatasetSha256"`
	SplitPolicyVersion          string                          `json:"splitPolicyVersion"`
	SplitManifestSHA256         string                          `json:"splitManifestSha256"`
	TrainingPolicyVersion       string                          `json:"trainingPolicyVersion"`
	Regularization              Regularization                  `json:"regularization"`
	ComponentHashes             OfflineComponentHashes          `json:"componentHashes"`
	BundleVersion               string                          `json:"bundleVersion"`
	BundleHashAlgorithm         string                          `json:"bundleHashAlgorithm"`
	BundleHash                  string                          `json:"bundleHash"`
	ContentHashAlgorithm        string                          `json:"contentHashAlgorithm"`
	ContentHash                 string                          `json:"contentHash"`
}

var canonicalOfflineSemanticHeadClassOrder = []OfflineSemanticHeadSpec{
	{Name: "semanticTaskBucket", Classes: []string{"count_1", "count_2", "count_3_plus"}},
	{Name: "semanticConstraintBucket", Classes: []string{"count_0_to_1", "count_2", "count_3_plus"}},
	{Name: "semanticScopeBucket", Classes: []string{"count_1", "count_2_to_3", "count_4_plus"}},
	{Name: "semanticDependencyBucket", Classes: []string{"depth_0_to_1", "depth_2", "depth_3_plus"}},
}

func ParseOfflineArtifact(payload []byte) (OfflineArtifact, error) {
	var topLevel map[string]json.RawMessage
	if err := json.Unmarshal(payload, &topLevel); err != nil {
		return OfflineArtifact{}, fmt.Errorf("decode offline model artifact: %w", err)
	}
	if err := requireOfflineArtifactFields(topLevel); err != nil {
		return OfflineArtifact{}, err
	}
	if _, exists := topLevel["calibratorType"]; exists {
		return OfflineArtifact{}, errors.New("offline model artifact must use nested calibrator.type, not calibratorType")
	}
	if err := validateCalibratorJSONShape(topLevel["calibrator"]); err != nil {
		return OfflineArtifact{}, err
	}

	decoder := json.NewDecoder(bytes.NewReader(payload))
	decoder.DisallowUnknownFields()
	var artifact OfflineArtifact
	if err := decoder.Decode(&artifact); err != nil {
		return OfflineArtifact{}, fmt.Errorf("decode offline model artifact: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return OfflineArtifact{}, errors.New("offline model artifact must contain exactly one JSON object")
	}
	if err := ValidateOfflineArtifact(artifact); err != nil {
		return OfflineArtifact{}, err
	}
	return artifact, nil
}

func requireOfflineArtifactFields(fields map[string]json.RawMessage) error {
	required := []string{
		"schemaVersion", "artifactVersion", "modelVersion", "offlineFeatureShapeVersion",
		"candidateName", "ruleVectorVersion", "preprocessingVersion", "tokenizerVersion",
		"encoderVersion", "poolingVersion", "projectionVersion", "projectionDimension",
		"projectionParameters", "semanticHeadsVersion", "semanticHeadClassOrder",
		"semanticHeadInputDimension", "semanticHeadParameters", "semanticHeadProbabilityRule",
		"totalDimension", "featureNames",
		"weights", "bias", "calibrationVersion", "calibrator", "thresholdPolicyVersion",
		"threshold", "thresholdEquality", "trainingDatasetVersion", "trainingDatasetSha256",
		"splitPolicyVersion", "splitManifestSha256", "trainingPolicyVersion",
		"regularization", "componentHashes", "bundleVersion", "bundleHashAlgorithm", "bundleHash",
		"contentHashAlgorithm", "contentHash",
	}
	for _, name := range required {
		if _, exists := fields[name]; !exists {
			return fmt.Errorf("offline model artifact field %s is required", name)
		}
	}
	return nil
}

func ValidateOfflineArtifact(artifact OfflineArtifact) error {
	if artifact.SchemaVersion != OfflineArtifactSchemaVersion || artifact.ModelVersion != ModelVersion {
		return errors.New("offline model artifact identity mismatch")
	}
	if artifact.OfflineFeatureShapeVersion != OfflineFeatureShapeVersion ||
		artifact.RuleVectorVersion != routing.DifficultyFeatureVectorVersionV1 {
		return errors.New("offline model artifact feature shape identity mismatch")
	}
	for field, value := range map[string]string{
		"artifactVersion":        artifact.ArtifactVersion,
		"preprocessingVersion":   artifact.PreprocessingVersion,
		"tokenizerVersion":       artifact.TokenizerVersion,
		"encoderVersion":         artifact.EncoderVersion,
		"poolingVersion":         artifact.PoolingVersion,
		"projectionVersion":      artifact.ProjectionVersion,
		"semanticHeadsVersion":   artifact.SemanticHeadsVersion,
		"thresholdPolicyVersion": artifact.ThresholdPolicyVersion,
		"trainingDatasetVersion": artifact.TrainingDatasetVersion,
		"splitPolicyVersion":     artifact.SplitPolicyVersion,
		"trainingPolicyVersion":  artifact.TrainingPolicyVersion,
		"bundleVersion":          artifact.BundleVersion,
	} {
		if !immutableOfflineVersion(value) {
			return fmt.Errorf("offline model artifact %s must be immutable and non-empty", field)
		}
	}
	if artifact.ProjectionDimension <= 0 {
		return errors.New("offline model artifact projectionDimension must be positive")
	}
	if !equalOfflineHeadOrder(artifact.SemanticHeadClassOrder, canonicalOfflineSemanticHeadClassOrder) {
		return errors.New("offline model artifact semantic head class order mismatch")
	}
	if err := validateOfflineProjectionParameters(artifact); err != nil {
		return err
	}
	if err := validateOfflineSemanticHeadParameters(artifact); err != nil {
		return err
	}

	expectedNames, err := offlineFeatureNames(artifact.CandidateName, artifact.ProjectionDimension)
	if err != nil {
		return err
	}
	expectedDimension := len(expectedNames)
	if artifact.TotalDimension != expectedDimension ||
		len(artifact.FeatureNames) != expectedDimension ||
		len(artifact.Weights) != expectedDimension {
		return fmt.Errorf(
			"offline model artifact shape mismatch: totalDimension=%d featureNames=%d weights=%d expected=%d",
			artifact.TotalDimension,
			len(artifact.FeatureNames),
			len(artifact.Weights),
			expectedDimension,
		)
	}
	for index, expectedName := range expectedNames {
		if artifact.FeatureNames[index] != expectedName {
			return fmt.Errorf("offline model artifact feature order mismatch at index %d", index)
		}
		if !finite(artifact.Weights[index]) {
			return fmt.Errorf("offline model artifact weight %d is not finite", index)
		}
	}
	if !finite(artifact.Bias) {
		return errors.New("offline model artifact bias is not finite")
	}
	if artifact.CalibrationVersion != CalibrationVersion || artifact.Calibrator.Input != "raw_probability" {
		return errors.New("offline model artifact calibration version or input mismatch")
	}
	if err := validateCalibrator(artifact.Calibrator); err != nil {
		return err
	}
	if !finite(artifact.Threshold) || artifact.Threshold < 0 || artifact.Threshold > 1 {
		return errors.New("offline model artifact threshold must be a finite inclusive probability")
	}
	if artifact.ThresholdEquality != OfflineThresholdEquality {
		return errors.New("offline model artifact threshold equality rule mismatch")
	}
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(artifact.TrainingDatasetSHA256) {
		return errors.New("offline model artifact training dataset hash is invalid")
	}
	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(artifact.SplitManifestSHA256) {
		return errors.New("offline model artifact split manifest hash is invalid")
	}
	for field, value := range map[string]string{
		"ruleVector":    artifact.ComponentHashes.RuleVector,
		"tokenizer":     artifact.ComponentHashes.Tokenizer,
		"encoder":       artifact.ComponentHashes.Encoder,
		"projection":    artifact.ComponentHashes.Projection,
		"semanticHeads": artifact.ComponentHashes.SemanticHeads,
		"bundleHash":    artifact.BundleHash,
	} {
		if !regexp.MustCompile(`^sha256:[0-9a-f]{64}$`).MatchString(value) {
			return fmt.Errorf("offline model artifact %s is not a sha256 content hash", field)
		}
	}
	if artifact.TrainingPolicyVersion != artifact.Regularization.PolicyVersion ||
		artifact.Regularization.PolicyVersion == "" || artifact.Regularization.Penalty != "l2" ||
		artifact.Regularization.Solver == "" || !finite(artifact.Regularization.SelectedC) ||
		artifact.Regularization.SelectedC <= 0 || artifact.Regularization.GroupFolds < 2 {
		return errors.New("offline model artifact regularization provenance is invalid")
	}
	if artifact.BundleHashAlgorithm != OfflineBundleHashAlgorithm {
		return errors.New("offline model artifact bundle hash algorithm mismatch")
	}
	if artifact.BundleHash != OfflineBundleHash(artifact) {
		return errors.New("offline model artifact bundle hash mismatch")
	}
	if artifact.ContentHashAlgorithm != OfflineContentHashAlgorithm {
		return errors.New("offline model artifact content hash algorithm mismatch")
	}
	if artifact.ContentHash != OfflineContentHash(artifact) {
		return errors.New("offline model artifact content hash mismatch")
	}
	return nil
}

// ValidateGatewayShadow118DArtifact applies the owner-approved, non-generated
// identity pin used by the checked-in Gateway shadow preparation bundle. It is
// intentionally stricter than the generic offline A/B/C verifier.
func ValidateGatewayShadow118DArtifact(artifact OfflineArtifact) error {
	if err := ValidateOfflineArtifact(artifact); err != nil {
		return err
	}
	if artifact.ArtifactVersion != GatewayShadow118DArtifactVersion ||
		artifact.TrainingPolicyVersion != GatewayShadow118DTrainingPolicyVersion ||
		artifact.CandidateName != OfflineCandidateProjectionAndHeads ||
		artifact.TotalDimension != 118 || len(artifact.FeatureNames) != 118 || len(artifact.Weights) != 118 {
		return errors.New("Gateway shadow 118D artifact identity mismatch")
	}
	projection := artifact.ProjectionParameters
	if artifact.ProjectionDimension != 64 || artifact.SemanticHeadInputDimension != 64 ||
		projection.Kind != "pca_full_svd" || projection.InputDimension != 384 || projection.OutputDimension != 64 ||
		projection.DType != "float32_le" || projection.L2Position != "after_projection" ||
		projection.L2Epsilon != 1e-12 || len(projection.Mean) != 384 || len(projection.Components) != 64 {
		return errors.New("Gateway shadow 118D projection contract mismatch")
	}
	if len(artifact.SemanticHeadParameters) != 4 || len(artifact.SemanticHeadClassOrder) != 4 ||
		artifact.SemanticHeadProbabilityRule != OfflineHeadProbabilityRule {
		return errors.New("Gateway shadow 118D semantic head contract mismatch")
	}
	for index := range artifact.SemanticHeadParameters {
		if len(artifact.SemanticHeadParameters[index].Classes) != 3 ||
			len(artifact.SemanticHeadParameters[index].Coefficient) != 3 ||
			len(artifact.SemanticHeadParameters[index].Intercept) != 3 {
			return errors.New("Gateway shadow 118D semantic head shape mismatch")
		}
	}
	if artifact.Calibrator.Type != "platt" || artifact.Calibrator.Input != "raw_probability" ||
		artifact.Calibrator.Coefficient == nil || artifact.Calibrator.Intercept == nil ||
		artifact.ThresholdPolicyVersion != ThresholdPolicyVersion || artifact.Threshold != ThresholdValue ||
		artifact.ThresholdEquality != OfflineThresholdEquality {
		return errors.New("Gateway shadow 118D calibration contract mismatch")
	}
	if artifact.BundleHash != GatewayShadow118DBundleHash || artifact.ContentHash != GatewayShadow118DContentHash ||
		artifact.ComponentHashes.Projection != GatewayShadow118DProjectionHash ||
		artifact.ComponentHashes.SemanticHeads != GatewayShadow118DSemanticHeadsHash {
		return errors.New("Gateway shadow 118D pinned hash mismatch")
	}
	if projectionFloat32Hash(projection) != GatewayShadow118DProjectionHash {
		return errors.New("Gateway shadow 118D PCA float32 material hash mismatch")
	}
	return nil
}

// ValidateGatewayShadow106DArtifact pins the frozen 3,000 train / 1,000
// calibration model-path selection. The final-test outcomes are evidence only
// and are deliberately absent from this artifact identity.
func ValidateGatewayShadow106DArtifact(artifact OfflineArtifact) error {
	if err := ValidateOfflineArtifact(artifact); err != nil {
		return err
	}
	if artifact.ArtifactVersion != GatewayShadow106DArtifactVersion ||
		artifact.TrainingPolicyVersion != GatewayShadow106DTrainingPolicyVersion ||
		artifact.CandidateName != OfflineCandidateProjection ||
		artifact.TotalDimension != 106 || len(artifact.FeatureNames) != 106 || len(artifact.Weights) != 106 {
		return errors.New("Gateway shadow 106D artifact identity mismatch")
	}
	if artifact.TrainingDatasetVersion != GatewayShadow106DTrainingDatasetVersion ||
		artifact.TrainingDatasetSHA256 != GatewayShadow106DTrainingDatasetHash ||
		artifact.SplitPolicyVersion != GatewayShadow106DSplitPolicyVersion ||
		artifact.SplitManifestSHA256 != GatewayShadow106DSplitManifestHash {
		return errors.New("Gateway shadow 106D training population mismatch")
	}
	projection := artifact.ProjectionParameters
	if artifact.ProjectionDimension != 64 || artifact.SemanticHeadInputDimension != 64 ||
		projection.Kind != "pca_full_svd" || projection.InputDimension != 384 || projection.OutputDimension != 64 ||
		projection.DType != "float32_le" || projection.FitSplit != "train" || projection.L2Position != "after_projection" ||
		projection.L2Epsilon != 1e-12 || len(projection.Mean) != 384 || len(projection.Components) != 64 {
		return errors.New("Gateway shadow 106D projection contract mismatch")
	}
	if len(artifact.SemanticHeadParameters) != 4 || len(artifact.SemanticHeadClassOrder) != 4 ||
		artifact.SemanticHeadProbabilityRule != OfflineHeadProbabilityRule {
		return errors.New("Gateway shadow 106D semantic-head provenance mismatch")
	}
	if artifact.Calibrator.Type != "platt" || artifact.Calibrator.Input != "raw_probability" ||
		artifact.Calibrator.Coefficient == nil || artifact.Calibrator.Intercept == nil ||
		artifact.ThresholdPolicyVersion != GatewayShadow106DThresholdPolicyVersion || artifact.Threshold != 0.096 ||
		artifact.ThresholdEquality != OfflineThresholdEquality || artifact.Regularization.SelectedC != 10 {
		return errors.New("Gateway shadow 106D calibration contract mismatch")
	}
	if artifact.BundleHash != GatewayShadow106DBundleHash || artifact.ContentHash != GatewayShadow106DContentHash ||
		artifact.ComponentHashes.Projection != GatewayShadow106DProjectionHash ||
		artifact.ComponentHashes.SemanticHeads != GatewayShadow106DSemanticHeadsHash {
		return errors.New("Gateway shadow 106D pinned hash mismatch")
	}
	if projectionFloat32Hash(projection) != GatewayShadow106DProjectionHash {
		return errors.New("Gateway shadow 106D PCA float32 material hash mismatch")
	}
	return nil
}

func projectionFloat32Hash(parameters OfflineProjectionParameters) string {
	digest := sha256.New()
	var encoded [4]byte
	write := func(value float64) {
		binary.LittleEndian.PutUint32(encoded[:], math.Float32bits(float32(value)))
		_, _ = digest.Write(encoded[:])
	}
	for _, value := range parameters.Mean {
		write(value)
	}
	for _, row := range parameters.Components {
		for _, value := range row {
			write(value)
		}
	}
	return "sha256:" + hex.EncodeToString(digest.Sum(nil))
}

func immutableOfflineVersion(value string) bool {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return false
	}
	lower := strings.ToLower(trimmed)
	return lower != "latest" && !strings.HasSuffix(lower, ".latest") && !strings.HasSuffix(lower, "-latest")
}

func validateOfflineProjectionParameters(artifact OfflineArtifact) error {
	parameters := artifact.ProjectionParameters
	if parameters.InputDimension <= 0 || parameters.OutputDimension != artifact.ProjectionDimension ||
		parameters.OutputDimension != artifact.SemanticHeadInputDimension {
		return errors.New("offline model artifact projection parameter dimensions are invalid")
	}
	if parameters.DType != "float32_le" || parameters.FitSplit != "train" || parameters.Whiten ||
		parameters.L2Position != "after_projection" || !finite(parameters.L2Epsilon) || parameters.L2Epsilon <= 0 {
		return errors.New("offline model artifact projection numeric policy is invalid")
	}
	switch parameters.Kind {
	case "identity":
		if parameters.InputDimension != parameters.OutputDimension || len(parameters.Mean) != 0 || len(parameters.Components) != 0 {
			return errors.New("offline model artifact identity projection parameters are invalid")
		}
	case "pca_full_svd":
		if len(parameters.Mean) != parameters.InputDimension || len(parameters.Components) != parameters.OutputDimension {
			return errors.New("offline model artifact PCA projection parameter shape is invalid")
		}
		for _, value := range parameters.Mean {
			if !finite(value) {
				return errors.New("offline model artifact projection parameters must be finite")
			}
		}
		for _, row := range parameters.Components {
			if len(row) != parameters.InputDimension {
				return errors.New("offline model artifact PCA projection parameter shape is invalid")
			}
			for _, value := range row {
				if !finite(value) {
					return errors.New("offline model artifact projection parameters must be finite")
				}
			}
		}
	default:
		return errors.New("offline model artifact projection kind is unsupported")
	}
	return nil
}

func validateOfflineSemanticHeadParameters(artifact OfflineArtifact) error {
	if artifact.SemanticHeadInputDimension <= 0 || artifact.SemanticHeadProbabilityRule != OfflineHeadProbabilityRule ||
		len(artifact.SemanticHeadParameters) != len(canonicalOfflineSemanticHeadClassOrder) {
		return errors.New("offline model artifact semantic head parameter contract mismatch")
	}
	for index, expected := range canonicalOfflineSemanticHeadClassOrder {
		actual := artifact.SemanticHeadParameters[index]
		if actual.Name != expected.Name || len(actual.Classes) != len(expected.Classes) ||
			len(actual.Coefficient) != len(expected.Classes) || len(actual.Intercept) != len(expected.Classes) {
			return errors.New("offline model artifact semantic head parameter contract mismatch")
		}
		for classIndex, className := range expected.Classes {
			if actual.Classes[classIndex] != className || len(actual.Coefficient[classIndex]) != artifact.SemanticHeadInputDimension ||
				!finite(actual.Intercept[classIndex]) {
				return errors.New("offline model artifact semantic head parameter shape mismatch")
			}
			for _, value := range actual.Coefficient[classIndex] {
				if !finite(value) {
					return errors.New("offline model artifact semantic head parameters must be finite")
				}
			}
		}
	}
	return nil
}

func offlineFeatureNames(candidate string, projectionDimension int) ([]string, error) {
	names := routing.DifficultyFeatureNamesV1()
	for index, name := range names {
		names[index] = "ruleVectorV1." + name
	}
	switch candidate {
	case OfflineCandidateRuleOnly:
		return names, nil
	case OfflineCandidateProjection, OfflineCandidateProjectionAndHeads:
		for index := 0; index < projectionDimension; index++ {
			names = append(names, fmt.Sprintf("semanticProjection[%d]", index))
		}
	default:
		return nil, fmt.Errorf("unsupported offline difficulty candidate %q", candidate)
	}
	if candidate == OfflineCandidateProjection {
		return names, nil
	}
	for _, head := range canonicalOfflineSemanticHeadClassOrder {
		for _, className := range head.Classes {
			names = append(names, fmt.Sprintf("semanticHeads.%s.%s.probability", head.Name, className))
		}
	}
	return names, nil
}

func equalOfflineHeadOrder(actual []OfflineSemanticHeadSpec, expected []OfflineSemanticHeadSpec) bool {
	if len(actual) != len(expected) {
		return false
	}
	for index := range actual {
		if actual[index].Name != expected[index].Name || len(actual[index].Classes) != len(expected[index].Classes) {
			return false
		}
		for classIndex := range actual[index].Classes {
			if actual[index].Classes[classIndex] != expected[index].Classes[classIndex] {
				return false
			}
		}
	}
	return true
}

func OfflineBundleHash(artifact OfflineArtifact) string {
	parts := []string{
		artifact.BundleHashAlgorithm,
		artifact.BundleVersion,
		artifact.OfflineFeatureShapeVersion,
		artifact.CandidateName,
		artifact.RuleVectorVersion,
		artifact.PreprocessingVersion,
		artifact.TokenizerVersion,
		artifact.EncoderVersion,
		artifact.PoolingVersion,
		artifact.ProjectionVersion,
		strconv.Itoa(artifact.ProjectionDimension),
		artifact.ProjectionParameters.Kind,
		strconv.Itoa(artifact.ProjectionParameters.InputDimension),
		strconv.Itoa(artifact.ProjectionParameters.OutputDimension),
		artifact.ProjectionParameters.DType,
		artifact.ProjectionParameters.FitSplit,
		strconv.Itoa(artifact.ProjectionParameters.RandomSeed),
		strconv.FormatBool(artifact.ProjectionParameters.Whiten),
		artifact.ProjectionParameters.L2Position,
		floatBits(artifact.ProjectionParameters.L2Epsilon),
		artifact.SemanticHeadsVersion,
		strconv.Itoa(artifact.SemanticHeadInputDimension),
		artifact.SemanticHeadProbabilityRule,
	}
	for _, value := range artifact.ProjectionParameters.Mean {
		parts = append(parts, floatBits(value))
	}
	for _, row := range artifact.ProjectionParameters.Components {
		parts = append(parts, strconv.Itoa(len(row)))
		for _, value := range row {
			parts = append(parts, floatBits(value))
		}
	}
	for _, head := range artifact.SemanticHeadClassOrder {
		parts = append(parts, head.Name)
		parts = append(parts, head.Classes...)
	}
	for _, head := range artifact.SemanticHeadParameters {
		parts = append(parts, head.Name)
		parts = append(parts, head.Classes...)
		for _, row := range head.Coefficient {
			parts = append(parts, strconv.Itoa(len(row)))
			for _, value := range row {
				parts = append(parts, floatBits(value))
			}
		}
		for _, value := range head.Intercept {
			parts = append(parts, floatBits(value))
		}
	}
	parts = append(parts, strconv.Itoa(artifact.TotalDimension))
	parts = append(parts, artifact.FeatureNames...)
	parts = append(
		parts,
		artifact.ComponentHashes.RuleVector,
		artifact.ComponentHashes.Tokenizer,
		artifact.ComponentHashes.Encoder,
		artifact.ComponentHashes.Projection,
		artifact.ComponentHashes.SemanticHeads,
	)
	return lengthPrefixedContentHash(parts)
}

func OfflineContentHash(artifact OfflineArtifact) string {
	parts := []string{
		artifact.SchemaVersion,
		artifact.ArtifactVersion,
		artifact.ModelVersion,
		artifact.BundleVersion,
		artifact.BundleHashAlgorithm,
		artifact.BundleHash,
	}
	for _, weight := range artifact.Weights {
		parts = append(parts, floatBits(weight))
	}
	parts = append(parts, floatBits(artifact.Bias), artifact.CalibrationVersion)
	parts = appendCalibratorHashParts(parts, artifact.Calibrator)
	parts = append(
		parts,
		artifact.ThresholdPolicyVersion,
		floatBits(artifact.Threshold),
		artifact.ThresholdEquality,
		artifact.TrainingDatasetVersion,
		artifact.TrainingDatasetSHA256,
		artifact.SplitPolicyVersion,
		artifact.SplitManifestSHA256,
		artifact.TrainingPolicyVersion,
		artifact.Regularization.PolicyVersion,
		artifact.Regularization.Penalty,
		artifact.Regularization.Solver,
		floatBits(artifact.Regularization.SelectedC),
		strconv.Itoa(artifact.Regularization.GroupFolds),
		strconv.Itoa(artifact.Regularization.RandomSeed),
		artifact.ContentHashAlgorithm,
	)
	return lengthPrefixedContentHash(parts)
}

func RenderOfflineGo(artifact OfflineArtifact, packageName string) ([]byte, error) {
	if err := ValidateOfflineArtifact(artifact); err != nil {
		return nil, err
	}
	if matched, _ := regexp.MatchString(`^[a-z][a-z0-9_]*$`, packageName); !matched {
		return nil, errors.New("invalid generated Go package name")
	}
	var builder strings.Builder
	builder.WriteString("// Code generated by difficulty-model-codegen; DO NOT EDIT.\n")
	builder.WriteString("// Offline/shadow candidate only; this variable is not registered with product routing.\n")
	builder.WriteString("package " + packageName + "\n\n")
	builder.WriteString("var " + OfflineGeneratedVariableName + " = difficultyOfflineLogisticModel{\n")
	builder.WriteString("\tartifactVersion: " + strconv.Quote(artifact.ArtifactVersion) + ",\n")
	builder.WriteString("\tcontentHash: " + strconv.Quote(artifact.ContentHash) + ",\n")
	builder.WriteString("\tdescriptor: difficultyFeatureShapeDescriptor{\n")
	builder.WriteString("\t\tofflineFeatureShapeVersion: " + strconv.Quote(artifact.OfflineFeatureShapeVersion) + ",\n")
	builder.WriteString("\t\tcandidateName: " + strconv.Quote(artifact.CandidateName) + ",\n")
	builder.WriteString("\t\ttotalDimension: " + strconv.Itoa(artifact.TotalDimension) + ",\n")
	builder.WriteString("\t\tfeatureNames: []string{\n")
	for _, name := range artifact.FeatureNames {
		builder.WriteString("\t\t\t" + strconv.Quote(name) + ",\n")
	}
	builder.WriteString("\t\t},\n\t},\n")
	builder.WriteString("\tscorer: difficultyLinearScorer{\n")
	builder.WriteString("\t\tbias: " + goFloat(artifact.Bias) + ",\n")
	builder.WriteString("\t\tweights: []float64{\n")
	for index, weight := range artifact.Weights {
		builder.WriteString("\t\t\t" + goFloat(weight) + ", // " + artifact.FeatureNames[index] + "\n")
	}
	builder.WriteString("\t\t},\n\t},\n")
	writeGeneratedCalibrator(&builder, artifact.Calibrator)
	builder.WriteString("\tthreshold: " + goFloat(artifact.Threshold) + ",\n")
	builder.WriteString("}\n")
	return format.Source([]byte(builder.String()))
}

// RenderGatewayShadow118DGo renders the complete selected inference material.
// The generated file remains package-private data and does not register the
// model with product routing.
func RenderGatewayShadow118DGo(artifact OfflineArtifact, packageName string) ([]byte, error) {
	if err := ValidateGatewayShadow118DArtifact(artifact); err != nil {
		return nil, err
	}
	if matched, _ := regexp.MatchString(`^[a-z][a-z0-9_]*$`, packageName); !matched {
		return nil, errors.New("invalid generated Go package name")
	}
	var builder strings.Builder
	builder.WriteString("// Code generated by difficulty-model-codegen; DO NOT EDIT.\n")
	builder.WriteString("// Gateway shadow preparation only; this material is not registered with product routing.\n")
	builder.WriteString("package " + packageName + "\n\n")
	builder.WriteString("var " + GatewayShadow118DGeneratedName + " = difficultySemanticModelMaterial{\n")
	builder.WriteString("\tidentity: difficultySemanticModelIdentity{\n")
	writeGeneratedStringField(&builder, "artifactVersion", artifact.ArtifactVersion)
	writeGeneratedStringField(&builder, "decisionBoundaryVersion", GatewayShadow118DDecisionBoundaryVersion)
	writeGeneratedStringField(&builder, "candidateName", artifact.CandidateName)
	writeGeneratedStringField(&builder, "ruleVectorVersion", artifact.RuleVectorVersion)
	writeGeneratedStringField(&builder, "preprocessingVersion", artifact.PreprocessingVersion)
	writeGeneratedStringField(&builder, "tokenizerVersion", artifact.TokenizerVersion)
	writeGeneratedStringField(&builder, "encoderVersion", artifact.EncoderVersion)
	writeGeneratedStringField(&builder, "poolingVersion", artifact.PoolingVersion)
	writeGeneratedStringField(&builder, "projectionVersion", artifact.ProjectionVersion)
	writeGeneratedStringField(&builder, "semanticHeadsVersion", artifact.SemanticHeadsVersion)
	writeGeneratedStringField(&builder, "calibrationVersion", artifact.CalibrationVersion)
	writeGeneratedStringField(&builder, "thresholdPolicyVersion", artifact.ThresholdPolicyVersion)
	writeGeneratedStringField(&builder, "thresholdEquality", artifact.ThresholdEquality)
	writeGeneratedStringField(&builder, "ruleVectorHash", artifact.ComponentHashes.RuleVector)
	writeGeneratedStringField(&builder, "tokenizerHash", artifact.ComponentHashes.Tokenizer)
	writeGeneratedStringField(&builder, "encoderHash", artifact.ComponentHashes.Encoder)
	writeGeneratedStringField(&builder, "projectionHash", artifact.ComponentHashes.Projection)
	writeGeneratedStringField(&builder, "semanticHeadsHash", artifact.ComponentHashes.SemanticHeads)
	writeGeneratedStringField(&builder, "bundleVersion", artifact.BundleVersion)
	writeGeneratedStringField(&builder, "bundleHash", artifact.BundleHash)
	writeGeneratedStringField(&builder, "contentHash", artifact.ContentHash)
	builder.WriteString("\t},\n")

	builder.WriteString("\tfeatureNames: [difficultySemanticTotalDimension]string{\n")
	for _, name := range artifact.FeatureNames {
		builder.WriteString("\t\t" + strconv.Quote(name) + ",\n")
	}
	builder.WriteString("\t},\n")
	builder.WriteString("\tsemanticHeadNames: [difficultySemanticHeadCount]string{\n")
	for _, head := range artifact.SemanticHeadClassOrder {
		builder.WriteString("\t\t" + strconv.Quote(head.Name) + ",\n")
	}
	builder.WriteString("\t},\n")
	builder.WriteString("\tsemanticHeadClasses: [difficultySemanticHeadCount][difficultySemanticHeadClassCount]string{\n")
	for _, head := range artifact.SemanticHeadClassOrder {
		builder.WriteString("\t\t{")
		for _, className := range head.Classes {
			builder.WriteString(strconv.Quote(className) + ", ")
		}
		builder.WriteString("},\n")
	}
	builder.WriteString("\t},\n")

	builder.WriteString("\tpcaMean: [difficultySemanticPooledDimension]float32{\n")
	for _, value := range artifact.ProjectionParameters.Mean {
		builder.WriteString("\t\t" + goFloat32(value) + ",\n")
	}
	builder.WriteString("\t},\n")
	builder.WriteString("\tpcaComponents: [difficultySemanticProjectionDimension][difficultySemanticPooledDimension]float32{\n")
	for _, row := range artifact.ProjectionParameters.Components {
		builder.WriteString("\t\t{\n")
		for _, value := range row {
			builder.WriteString("\t\t\t" + goFloat32(value) + ",\n")
		}
		builder.WriteString("\t\t},\n")
	}
	builder.WriteString("\t},\n")
	builder.WriteString("\tl2Epsilon: " + goFloat32(artifact.ProjectionParameters.L2Epsilon) + ",\n")

	builder.WriteString("\tsemanticHeadCoefficients: [difficultySemanticHeadCount][difficultySemanticHeadClassCount][difficultySemanticProjectionDimension]float64{\n")
	for _, head := range artifact.SemanticHeadParameters {
		builder.WriteString("\t\t{\n")
		for _, row := range head.Coefficient {
			builder.WriteString("\t\t\t{\n")
			for _, value := range row {
				builder.WriteString("\t\t\t\t" + goFloat(value) + ",\n")
			}
			builder.WriteString("\t\t\t},\n")
		}
		builder.WriteString("\t\t},\n")
	}
	builder.WriteString("\t},\n")
	builder.WriteString("\tsemanticHeadIntercepts: [difficultySemanticHeadCount][difficultySemanticHeadClassCount]float64{\n")
	for _, head := range artifact.SemanticHeadParameters {
		builder.WriteString("\t\t{")
		for _, value := range head.Intercept {
			builder.WriteString(goFloat(value) + ", ")
		}
		builder.WriteString("},\n")
	}
	builder.WriteString("\t},\n")

	builder.WriteString("\tfinalWeights: [difficultySemanticTotalDimension]float64{\n")
	for index, weight := range artifact.Weights {
		builder.WriteString("\t\t" + goFloat(weight) + ", // " + artifact.FeatureNames[index] + "\n")
	}
	builder.WriteString("\t},\n")
	builder.WriteString("\tfinalBias: " + goFloat(artifact.Bias) + ",\n")
	builder.WriteString("\tplattCoefficient: " + goFloat(*artifact.Calibrator.Coefficient) + ",\n")
	builder.WriteString("\tplattIntercept: " + goFloat(*artifact.Calibrator.Intercept) + ",\n")
	builder.WriteString("\tthreshold: " + goFloat(artifact.Threshold) + ",\n")
	builder.WriteString("}\n")
	return format.Source([]byte(builder.String()))
}

func RenderGatewayShadow118DPayload(payload []byte, packageName string) ([]byte, error) {
	artifact, err := ParseOfflineArtifact(payload)
	if err != nil {
		return nil, err
	}
	return RenderGatewayShadow118DGo(artifact, packageName)
}

// RenderGatewayShadow106DGo emits only the selected 42D rule + 64D PCA hot
// path. Semantic-head parameters remain artifact provenance and are not
// compiled because the selected Logistic Regression does not consume them.
func RenderGatewayShadow106DGo(artifact OfflineArtifact, packageName string) ([]byte, error) {
	if err := ValidateGatewayShadow106DArtifact(artifact); err != nil {
		return nil, err
	}
	if matched, _ := regexp.MatchString(`^[a-z][a-z0-9_]*$`, packageName); !matched {
		return nil, errors.New("invalid generated Go package name")
	}
	var builder strings.Builder
	builder.WriteString("// Code generated by difficulty-model-codegen; DO NOT EDIT.\n")
	builder.WriteString("// Gateway shadow only; rule routing remains authoritative.\n")
	builder.WriteString("package " + packageName + "\n\n")
	builder.WriteString("var " + GatewayShadow106DGeneratedName + " = difficultySemanticModelMaterial{\n")
	builder.WriteString("\tidentity: difficultySemanticModelIdentity{\n")
	writeGeneratedStringField(&builder, "artifactVersion", artifact.ArtifactVersion)
	writeGeneratedStringField(&builder, "decisionBoundaryVersion", GatewayShadow106DDecisionBoundaryVersion)
	writeGeneratedStringField(&builder, "candidateName", artifact.CandidateName)
	writeGeneratedStringField(&builder, "ruleVectorVersion", artifact.RuleVectorVersion)
	writeGeneratedStringField(&builder, "preprocessingVersion", artifact.PreprocessingVersion)
	writeGeneratedStringField(&builder, "tokenizerVersion", artifact.TokenizerVersion)
	writeGeneratedStringField(&builder, "encoderVersion", artifact.EncoderVersion)
	writeGeneratedStringField(&builder, "poolingVersion", artifact.PoolingVersion)
	writeGeneratedStringField(&builder, "projectionVersion", artifact.ProjectionVersion)
	writeGeneratedStringField(&builder, "semanticHeadsVersion", artifact.SemanticHeadsVersion)
	writeGeneratedStringField(&builder, "calibrationVersion", artifact.CalibrationVersion)
	writeGeneratedStringField(&builder, "thresholdPolicyVersion", artifact.ThresholdPolicyVersion)
	writeGeneratedStringField(&builder, "thresholdEquality", artifact.ThresholdEquality)
	writeGeneratedStringField(&builder, "ruleVectorHash", artifact.ComponentHashes.RuleVector)
	writeGeneratedStringField(&builder, "tokenizerHash", artifact.ComponentHashes.Tokenizer)
	writeGeneratedStringField(&builder, "encoderHash", artifact.ComponentHashes.Encoder)
	writeGeneratedStringField(&builder, "projectionHash", artifact.ComponentHashes.Projection)
	writeGeneratedStringField(&builder, "semanticHeadsHash", artifact.ComponentHashes.SemanticHeads)
	writeGeneratedStringField(&builder, "bundleVersion", artifact.BundleVersion)
	writeGeneratedStringField(&builder, "bundleHash", artifact.BundleHash)
	writeGeneratedStringField(&builder, "contentHash", artifact.ContentHash)
	builder.WriteString("\t},\n")
	builder.WriteString("\tfeatureNames: [difficultySemanticTotalDimension]string{\n")
	for _, name := range artifact.FeatureNames {
		builder.WriteString("\t\t" + strconv.Quote(name) + ",\n")
	}
	builder.WriteString("\t},\n")
	builder.WriteString("\tpcaMean: [difficultySemanticPooledDimension]float32{\n")
	for _, value := range artifact.ProjectionParameters.Mean {
		builder.WriteString("\t\t" + goFloat32(value) + ",\n")
	}
	builder.WriteString("\t},\n")
	builder.WriteString("\tpcaComponents: [difficultySemanticProjectionDimension][difficultySemanticPooledDimension]float32{\n")
	for _, row := range artifact.ProjectionParameters.Components {
		builder.WriteString("\t\t{\n")
		for _, value := range row {
			builder.WriteString("\t\t\t" + goFloat32(value) + ",\n")
		}
		builder.WriteString("\t\t},\n")
	}
	builder.WriteString("\t},\n")
	builder.WriteString("\tl2Epsilon: " + goFloat32(artifact.ProjectionParameters.L2Epsilon) + ",\n")
	builder.WriteString("\tfinalWeights: [difficultySemanticTotalDimension]float64{\n")
	for index, weight := range artifact.Weights {
		builder.WriteString("\t\t" + goFloat(weight) + ", // " + artifact.FeatureNames[index] + "\n")
	}
	builder.WriteString("\t},\n")
	builder.WriteString("\tfinalBias: " + goFloat(artifact.Bias) + ",\n")
	builder.WriteString("\tplattCoefficient: " + goFloat(*artifact.Calibrator.Coefficient) + ",\n")
	builder.WriteString("\tplattIntercept: " + goFloat(*artifact.Calibrator.Intercept) + ",\n")
	builder.WriteString("\tthreshold: " + goFloat(artifact.Threshold) + ",\n")
	builder.WriteString("}\n")
	return format.Source([]byte(builder.String()))
}

func RenderGatewayShadow106DPayload(payload []byte, packageName string) ([]byte, error) {
	artifact, err := ParseOfflineArtifact(payload)
	if err != nil {
		return nil, err
	}
	return RenderGatewayShadow106DGo(artifact, packageName)
}

func writeGeneratedStringField(builder *strings.Builder, name string, value string) {
	builder.WriteString("\t\t" + name + ": " + strconv.Quote(value) + ",\n")
}

func goFloat32(value float64) string {
	formatted := strconv.FormatFloat(float64(float32(value)), 'g', -1, 32)
	if !strings.ContainsAny(formatted, ".eE") {
		formatted += ".0"
	}
	return formatted
}

func writeGeneratedCalibrator(builder *strings.Builder, calibrator Calibrator) {
	builder.WriteString("\tcalibrator: difficultyCalibrator{\n")
	builder.WriteString("\t\tkind: " + calibratorConstant(calibrator.Type) + ",\n")
	if calibrator.Coefficient != nil {
		builder.WriteString("\t\tplattCoefficient: " + goFloat(*calibrator.Coefficient) + ",\n")
	}
	if calibrator.Intercept != nil {
		builder.WriteString("\t\tplattIntercept: " + goFloat(*calibrator.Intercept) + ",\n")
	}
	writeFloatSlice(builder, "isotonicX", calibrator.XThresholds)
	writeFloatSlice(builder, "isotonicY", calibrator.YThresholds)
	builder.WriteString("\t},\n")
}

func RenderArtifactPayload(payload []byte, packageName string) ([]byte, error) {
	var identity struct {
		SchemaVersion string `json:"schemaVersion"`
	}
	if err := json.Unmarshal(payload, &identity); err != nil {
		return nil, fmt.Errorf("decode model artifact identity: %w", err)
	}
	switch identity.SchemaVersion {
	case ArtifactSchemaVersion:
		artifact, err := ParseArtifact(payload)
		if err != nil {
			return nil, err
		}
		return RenderGo(artifact, packageName)
	case OfflineArtifactSchemaVersion:
		artifact, err := ParseOfflineArtifact(payload)
		if err != nil {
			return nil, err
		}
		return RenderOfflineGo(artifact, packageName)
	default:
		return nil, fmt.Errorf("unsupported difficulty model artifact schema %q", identity.SchemaVersion)
	}
}
