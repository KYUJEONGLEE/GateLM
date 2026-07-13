package difficultymodel

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"go/format"
	"math"
	"regexp"
	"strconv"
	"strings"

	"gatelm/apps/gateway-core/internal/domain/routing"
)

const (
	ArtifactSchemaVersion  = "gatelm.difficulty-model-artifact.v1"
	ModelVersion           = "difficulty-logistic-v1"
	CalibrationVersion     = "difficulty-calibration-v1"
	ThresholdPolicyVersion = "difficulty-threshold-v1"
	ContentHashAlgorithm   = "difficulty-model-inference-material.v1"
	GeneratedVariableName  = "generatedDifficultyLogisticModelV1"
)

type Artifact struct {
	SchemaVersion          string         `json:"schemaVersion"`
	ArtifactVersion        string         `json:"artifactVersion"`
	ModelVersion           string         `json:"modelVersion"`
	FeatureVersion         string         `json:"featureVersion"`
	TrainingDatasetVersion string         `json:"trainingDatasetVersion"`
	TrainingDatasetSHA256  string         `json:"trainingDatasetSha256"`
	SplitPolicyVersion     string         `json:"splitPolicyVersion"`
	Regularization         Regularization `json:"regularization"`
	Bias                   float64        `json:"bias"`
	FeatureNames           []string       `json:"featureNames"`
	Weights                []float64      `json:"weights"`
	CalibrationVersion     string         `json:"calibrationVersion"`
	Calibrator             Calibrator     `json:"calibrator"`
	ThresholdPolicyVersion string         `json:"thresholdPolicyVersion"`
	Threshold              float64        `json:"threshold"`
	ContentHashAlgorithm   string         `json:"contentHashAlgorithm"`
	ContentHash            string         `json:"contentHash"`
}

type Regularization struct {
	PolicyVersion string  `json:"policyVersion"`
	Penalty       string  `json:"penalty"`
	Solver        string  `json:"solver"`
	SelectedC     float64 `json:"selectedC"`
	GroupFolds    int     `json:"groupFolds"`
	RandomSeed    int     `json:"randomSeed"`
}

type Calibrator struct {
	Type        string    `json:"type"`
	Input       string    `json:"input"`
	Coefficient *float64  `json:"coefficient,omitempty"`
	Intercept   *float64  `json:"intercept,omitempty"`
	XThresholds []float64 `json:"xThresholds,omitempty"`
	YThresholds []float64 `json:"yThresholds,omitempty"`
}

func ParseArtifact(payload []byte) (Artifact, error) {
	var artifact Artifact
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	if err := decoder.Decode(&artifact); err != nil {
		return Artifact{}, fmt.Errorf("decode model artifact: %w", err)
	}
	if err := ValidateArtifact(artifact); err != nil {
		return Artifact{}, err
	}
	return artifact, nil
}

func ValidateArtifact(artifact Artifact) error {
	if artifact.SchemaVersion != ArtifactSchemaVersion || artifact.ModelVersion != ModelVersion {
		return errors.New("model artifact identity mismatch")
	}
	if artifact.FeatureVersion != routing.DifficultyFeatureVectorVersionV1 {
		return errors.New("model artifact featureVersion mismatch")
	}
	expectedNames := routing.DifficultyFeatureNamesV1()
	if len(artifact.FeatureNames) != len(expectedNames) || len(artifact.Weights) != len(expectedNames) {
		return fmt.Errorf("model artifact must contain exactly %d feature names and weights", len(expectedNames))
	}
	for index, expected := range expectedNames {
		if artifact.FeatureNames[index] != expected {
			return fmt.Errorf("model artifact feature order mismatch at index %d", index)
		}
		if !finite(artifact.Weights[index]) {
			return fmt.Errorf("model artifact weight %d is not finite", index)
		}
	}
	if !finite(artifact.Bias) {
		return errors.New("model artifact bias is not finite")
	}
	if artifact.CalibrationVersion != CalibrationVersion || artifact.Calibrator.Input != "raw_probability" {
		return errors.New("model artifact calibration identity mismatch")
	}
	if err := validateCalibrator(artifact.Calibrator); err != nil {
		return err
	}
	if artifact.ThresholdPolicyVersion != ThresholdPolicyVersion || artifact.Threshold != 0.5 {
		return errors.New("model artifact threshold policy must remain global 0.5")
	}
	if artifact.ContentHashAlgorithm != ContentHashAlgorithm {
		return errors.New("model artifact content hash algorithm mismatch")
	}
	expectedHash := ContentHash(artifact)
	if artifact.ContentHash != expectedHash {
		return errors.New("model artifact content hash mismatch")
	}
	return nil
}

func validateCalibrator(calibrator Calibrator) error {
	switch calibrator.Type {
	case "identity":
		if calibrator.Coefficient != nil || calibrator.Intercept != nil || len(calibrator.XThresholds) != 0 || len(calibrator.YThresholds) != 0 {
			return errors.New("identity calibrator must not contain parameters")
		}
	case "platt":
		if calibrator.Coefficient == nil || calibrator.Intercept == nil || !finite(*calibrator.Coefficient) || !finite(*calibrator.Intercept) {
			return errors.New("platt calibrator parameters are invalid")
		}
		if len(calibrator.XThresholds) != 0 || len(calibrator.YThresholds) != 0 {
			return errors.New("platt calibrator must not contain isotonic thresholds")
		}
	case "isotonic":
		if calibrator.Coefficient != nil || calibrator.Intercept != nil || len(calibrator.XThresholds) < 2 || len(calibrator.XThresholds) != len(calibrator.YThresholds) {
			return errors.New("isotonic calibrator thresholds are invalid")
		}
		for index := range calibrator.XThresholds {
			x := calibrator.XThresholds[index]
			y := calibrator.YThresholds[index]
			if !finite(x) || !finite(y) || x < 0 || x > 1 || y < 0 || y > 1 {
				return errors.New("isotonic calibrator thresholds must be finite probabilities")
			}
			if index > 0 && (x <= calibrator.XThresholds[index-1] || y < calibrator.YThresholds[index-1]) {
				return errors.New("isotonic calibrator thresholds must be strictly ordered and monotonic")
			}
		}
	default:
		return fmt.Errorf("unsupported calibrator type %q", calibrator.Type)
	}
	return nil
}

func finite(value float64) bool {
	return !math.IsNaN(value) && !math.IsInf(value, 0)
}

// ContentHash uses versioned length-prefixed strings and IEEE-754 bits, so
// Python and Go can reproduce the same material without JSON float ambiguity.
func ContentHash(artifact Artifact) string {
	parts := []string{
		artifact.SchemaVersion,
		artifact.ModelVersion,
		artifact.FeatureVersion,
		floatBits(artifact.Bias),
	}
	parts = append(parts, artifact.FeatureNames...)
	for _, weight := range artifact.Weights {
		parts = append(parts, floatBits(weight))
	}
	parts = append(parts, artifact.CalibrationVersion, artifact.Calibrator.Type, artifact.Calibrator.Input)
	if artifact.Calibrator.Coefficient != nil {
		parts = append(parts, floatBits(*artifact.Calibrator.Coefficient))
	}
	if artifact.Calibrator.Intercept != nil {
		parts = append(parts, floatBits(*artifact.Calibrator.Intercept))
	}
	for _, value := range artifact.Calibrator.XThresholds {
		parts = append(parts, floatBits(value))
	}
	for _, value := range artifact.Calibrator.YThresholds {
		parts = append(parts, floatBits(value))
	}
	parts = append(parts, artifact.ThresholdPolicyVersion, floatBits(artifact.Threshold), artifact.ContentHashAlgorithm)
	var material strings.Builder
	for _, part := range parts {
		material.WriteString(strconv.Itoa(len([]byte(part))))
		material.WriteByte(':')
		material.WriteString(part)
		material.WriteByte('\n')
	}
	digest := sha256.Sum256([]byte(material.String()))
	return "sha256:" + hex.EncodeToString(digest[:])
}

func floatBits(value float64) string {
	return fmt.Sprintf("%016x", math.Float64bits(value))
}

func RenderGo(artifact Artifact, packageName string) ([]byte, error) {
	if err := ValidateArtifact(artifact); err != nil {
		return nil, err
	}
	if matched, _ := regexp.MatchString(`^[a-z][a-z0-9_]*$`, packageName); !matched {
		return nil, errors.New("invalid generated Go package name")
	}
	var builder strings.Builder
	builder.WriteString("// Code generated by difficulty-model-codegen; DO NOT EDIT.\n")
	builder.WriteString("package " + packageName + "\n\n")
	builder.WriteString("var " + GeneratedVariableName + " = difficultyLogisticModel{\n")
	builder.WriteString("\tartifactVersion: " + strconv.Quote(artifact.ArtifactVersion) + ",\n")
	builder.WriteString("\tcontentHash: " + strconv.Quote(artifact.ContentHash) + ",\n")
	builder.WriteString("\tbias: " + goFloat(artifact.Bias) + ",\n")
	builder.WriteString("\tweights: [DifficultyFeatureVectorDimensionV1]float64{\n")
	for index, weight := range artifact.Weights {
		builder.WriteString("\t\t" + goFloat(weight) + ", // " + artifact.FeatureNames[index] + "\n")
	}
	builder.WriteString("\t},\n")
	builder.WriteString("\tcalibrator: difficultyCalibrator{\n")
	builder.WriteString("\t\tkind: " + calibratorConstant(artifact.Calibrator.Type) + ",\n")
	if artifact.Calibrator.Coefficient != nil {
		builder.WriteString("\t\tplattCoefficient: " + goFloat(*artifact.Calibrator.Coefficient) + ",\n")
	}
	if artifact.Calibrator.Intercept != nil {
		builder.WriteString("\t\tplattIntercept: " + goFloat(*artifact.Calibrator.Intercept) + ",\n")
	}
	writeFloatSlice(&builder, "isotonicX", artifact.Calibrator.XThresholds)
	writeFloatSlice(&builder, "isotonicY", artifact.Calibrator.YThresholds)
	builder.WriteString("\t},\n")
	builder.WriteString("\tthreshold: " + goFloat(artifact.Threshold) + ",\n")
	builder.WriteString("}\n")
	return format.Source([]byte(builder.String()))
}

func calibratorConstant(kind string) string {
	switch kind {
	case "identity":
		return "difficultyCalibratorIdentity"
	case "platt":
		return "difficultyCalibratorPlatt"
	case "isotonic":
		return "difficultyCalibratorIsotonic"
	default:
		panic("calibrator kind must be validated before rendering")
	}
}

func goFloat(value float64) string {
	formatted := strconv.FormatFloat(value, 'g', 17, 64)
	if !strings.ContainsAny(formatted, ".eE") {
		formatted += ".0"
	}
	return formatted
}

func writeFloatSlice(builder *strings.Builder, name string, values []float64) {
	if len(values) == 0 {
		return
	}
	builder.WriteString("\t\t" + name + ": []float64{")
	formatted := make([]string, len(values))
	for index, value := range values {
		formatted[index] = goFloat(value)
	}
	builder.WriteString(strings.Join(formatted, ", "))
	builder.WriteString("},\n")
}
