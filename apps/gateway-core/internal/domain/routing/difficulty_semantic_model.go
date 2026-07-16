package routing

import (
	"errors"
	"math"
)

const (
	difficultySemanticPooledDimension           = 384
	difficultySemanticProjectionDimension       = 64
	difficultySemanticTotalDimension            = DifficultyFeatureVectorDimensionV1 + difficultySemanticProjectionDimension
	DifficultySemanticShadowBaselineE2EWaiverV3 = "difficulty-shadow-baseline-e2e-v3.2026-07-15.v1"
)

var (
	errDifficultySemanticModelPathRequired = errors.New("difficulty semantic model path is required")
	errDifficultySemanticInputInvalid      = errors.New("difficulty semantic pooled input is invalid")
	errDifficultySemanticProjectionInvalid = errors.New("difficulty semantic projection is invalid")
	errDifficultySemanticScoreInvalid      = errors.New("difficulty semantic calibrated score is invalid")
)

type difficultySemanticModelIdentity struct {
	artifactVersion         string
	decisionBoundaryVersion string
	candidateName           string
	ruleVectorVersion       string
	preprocessingVersion    string
	tokenizerVersion        string
	encoderVersion          string
	poolingVersion          string
	projectionVersion       string
	semanticHeadsVersion    string
	calibrationVersion      string
	thresholdPolicyVersion  string
	thresholdEquality       string
	ruleVectorHash          string
	tokenizerHash           string
	encoderHash             string
	projectionHash          string
	semanticHeadsHash       string
	bundleVersion           string
	bundleHash              string
	contentHash             string
}

// DifficultySemanticShadowModelCompatible reports whether the checked-in
// shadow material was trained for the exact deterministic sentinel boundary
// used by the current Gateway. A mismatch disables shadow only; rule routing
// remains authoritative.
func DifficultySemanticShadowModelCompatible() bool {
	return generatedDifficultySemanticModel106D.identity.decisionBoundaryVersion != "" &&
		generatedDifficultySemanticModel106D.identity.decisionBoundaryVersion == DifficultyDecisionBoundaryVersion
}

// DifficultySemanticShadowBaselineWaiverAccepted is retained as a config
// compatibility bridge. The historical 118D exception is closed now that the
// checked-in 106D model matches the current decision boundary.
func DifficultySemanticShadowBaselineWaiverAccepted(waiver string) bool {
	_ = waiver
	return false
}

type difficultySemanticModelMaterial struct {
	identity         difficultySemanticModelIdentity
	featureNames     [difficultySemanticTotalDimension]string
	pcaMean          [difficultySemanticPooledDimension]float32
	pcaComponents    [difficultySemanticProjectionDimension][difficultySemanticPooledDimension]float32
	l2Epsilon        float32
	finalWeights     [difficultySemanticTotalDimension]float64
	finalBias        float64
	plattCoefficient float64
	plattIntercept   float64
	threshold        float64
}

func (material *difficultySemanticModelMaterial) inferModelPath(
	features DifficultyFeatures,
	pooled [difficultySemanticPooledDimension]float32,
) (DifficultyResult, error) {
	if material == nil || !UsesDifficultyModelPath(features) {
		return DifficultyResult{}, errDifficultySemanticModelPathRequired
	}
	vector, err := material.assembleModelVector(features, pooled)
	if err != nil {
		return DifficultyResult{}, err
	}

	logit := material.finalBias
	for index, value := range vector {
		logit += value * material.finalWeights[index]
		if !finiteDifficultyFloat(logit) {
			return DifficultyResult{}, errDifficultySemanticScoreInvalid
		}
	}
	rawProbability := stableSigmoid(logit)
	calibratedScore := stableSigmoid(material.plattCoefficient*rawProbability + material.plattIntercept)
	if !finiteDifficultyFloat(calibratedScore) || calibratedScore < 0 || calibratedScore > 1 {
		return DifficultyResult{}, errDifficultySemanticScoreInvalid
	}
	return DifficultyResult{
		ComplexityScore: calibratedScore,
		Difficulty:      difficultyFromScore(calibratedScore, material.threshold),
	}, nil
}

func (material *difficultySemanticModelMaterial) assembleModelVector(
	features DifficultyFeatures,
	pooled [difficultySemanticPooledDimension]float32,
) ([difficultySemanticTotalDimension]float64, error) {
	var vector [difficultySemanticTotalDimension]float64
	if material == nil || !UsesDifficultyModelPath(features) {
		return vector, errDifficultySemanticModelPathRequired
	}
	projection, err := material.projectPooled(pooled)
	if err != nil {
		return vector, err
	}
	rule := vectorizeDifficultyFeaturesV1Fixed(features)
	for index, value := range rule {
		vector[index] = value
	}
	projectionOffset := DifficultyFeatureVectorDimensionV1
	for index, value := range projection {
		vector[projectionOffset+index] = float64(value)
	}
	return vector, nil
}

func (material *difficultySemanticModelMaterial) projectPooled(
	pooled [difficultySemanticPooledDimension]float32,
) ([difficultySemanticProjectionDimension]float32, error) {
	var projection [difficultySemanticProjectionDimension]float32
	if material == nil {
		return projection, errDifficultySemanticInputInvalid
	}
	for _, value := range pooled {
		if !finiteDifficultyFloat32(value) {
			return projection, errDifficultySemanticInputInvalid
		}
	}
	for row := 0; row < difficultySemanticProjectionDimension; row++ {
		sum := float32(0)
		for column := 0; column < difficultySemanticPooledDimension; column++ {
			sum += (pooled[column] - material.pcaMean[column]) * material.pcaComponents[row][column]
		}
		if !finiteDifficultyFloat32(sum) {
			return projection, errDifficultySemanticProjectionInvalid
		}
		projection[row] = sum
	}
	normSquared := float32(0)
	for _, value := range projection {
		normSquared += value * value
	}
	norm := float32(math.Sqrt(float64(normSquared)))
	if !finiteDifficultyFloat32(norm) || norm <= material.l2Epsilon {
		return [difficultySemanticProjectionDimension]float32{}, errDifficultySemanticProjectionInvalid
	}
	for index := range projection {
		projection[index] /= norm
		if !finiteDifficultyFloat32(projection[index]) {
			return [difficultySemanticProjectionDimension]float32{}, errDifficultySemanticProjectionInvalid
		}
	}
	return projection, nil
}

func finiteDifficultyFloat32(value float32) bool {
	converted := float64(value)
	return !math.IsNaN(converted) && !math.IsInf(converted, 0)
}
