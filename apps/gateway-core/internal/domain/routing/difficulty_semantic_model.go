package routing

import (
	"errors"
	"math"
)

const (
	difficultySemanticPooledDimension          = 384
	difficultySemanticProjectionDimension      = 64
	difficultySemanticHeadCount                = 4
	difficultySemanticHeadClassCount           = 3
	difficultySemanticHeadProbabilityDimension = difficultySemanticHeadCount * difficultySemanticHeadClassCount
	difficultySemanticTotalDimension           = DifficultyFeatureVectorDimensionV1 + difficultySemanticProjectionDimension + difficultySemanticHeadProbabilityDimension
)

var (
	errDifficultySemanticModelPathRequired = errors.New("difficulty semantic model path is required")
	errDifficultySemanticInputInvalid      = errors.New("difficulty semantic pooled input is invalid")
	errDifficultySemanticProjectionInvalid = errors.New("difficulty semantic projection is invalid")
	errDifficultySemanticHeadInvalid       = errors.New("difficulty semantic head inference is invalid")
	errDifficultySemanticScoreInvalid      = errors.New("difficulty semantic calibrated score is invalid")
)

type difficultySemanticModelIdentity struct {
	artifactVersion        string
	candidateName          string
	ruleVectorVersion      string
	preprocessingVersion   string
	tokenizerVersion       string
	encoderVersion         string
	poolingVersion         string
	projectionVersion      string
	semanticHeadsVersion   string
	calibrationVersion     string
	thresholdPolicyVersion string
	thresholdEquality      string
	ruleVectorHash         string
	tokenizerHash          string
	encoderHash            string
	projectionHash         string
	semanticHeadsHash      string
	bundleVersion          string
	bundleHash             string
	contentHash            string
}

type difficultySemanticModelMaterial struct {
	identity                 difficultySemanticModelIdentity
	featureNames             [difficultySemanticTotalDimension]string
	semanticHeadNames        [difficultySemanticHeadCount]string
	semanticHeadClasses      [difficultySemanticHeadCount][difficultySemanticHeadClassCount]string
	pcaMean                  [difficultySemanticPooledDimension]float32
	pcaComponents            [difficultySemanticProjectionDimension][difficultySemanticPooledDimension]float32
	l2Epsilon                float32
	semanticHeadCoefficients [difficultySemanticHeadCount][difficultySemanticHeadClassCount][difficultySemanticProjectionDimension]float64
	semanticHeadIntercepts   [difficultySemanticHeadCount][difficultySemanticHeadClassCount]float64
	finalWeights             [difficultySemanticTotalDimension]float64
	finalBias                float64
	plattCoefficient         float64
	plattIntercept           float64
	threshold                float64
}

func (material *difficultySemanticModelMaterial) inferModelPath(
	features DifficultyFeatures,
	pooled [difficultySemanticPooledDimension]float32,
) (DifficultyResult, error) {
	if material == nil || !UsesDifficultyModelPath(features) {
		return DifficultyResult{}, errDifficultySemanticModelPathRequired
	}
	projection, err := material.projectPooled(pooled)
	if err != nil {
		return DifficultyResult{}, err
	}
	heads, err := material.predictSemanticHeads(projection)
	if err != nil {
		return DifficultyResult{}, err
	}
	rule := vectorizeDifficultyFeaturesV1Fixed(features)
	var vector [difficultySemanticTotalDimension]float64
	for index, value := range rule {
		vector[index] = value
	}
	projectionOffset := DifficultyFeatureVectorDimensionV1
	for index, value := range projection {
		vector[projectionOffset+index] = float64(value)
	}
	headOffset := projectionOffset + difficultySemanticProjectionDimension
	for index, value := range heads {
		vector[headOffset+index] = value
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

func (material *difficultySemanticModelMaterial) predictSemanticHeads(
	projection [difficultySemanticProjectionDimension]float32,
) ([difficultySemanticHeadProbabilityDimension]float64, error) {
	var probabilities [difficultySemanticHeadProbabilityDimension]float64
	if material == nil {
		return probabilities, errDifficultySemanticHeadInvalid
	}
	for head := 0; head < difficultySemanticHeadCount; head++ {
		var logits [difficultySemanticHeadClassCount]float64
		for class := 0; class < difficultySemanticHeadClassCount; class++ {
			logit := material.semanticHeadIntercepts[head][class]
			for index, value := range projection {
				logit += float64(value) * material.semanticHeadCoefficients[head][class][index]
			}
			if !finiteDifficultyFloat(logit) {
				return probabilities, errDifficultySemanticHeadInvalid
			}
			logits[class] = logit
		}
		maximum := logits[0]
		for class := 1; class < difficultySemanticHeadClassCount; class++ {
			if logits[class] > maximum {
				maximum = logits[class]
			}
		}
		sum := 0.0
		for class := 0; class < difficultySemanticHeadClassCount; class++ {
			value := math.Exp(logits[class] - maximum)
			probabilities[head*difficultySemanticHeadClassCount+class] = value
			sum += value
		}
		if !finiteDifficultyFloat(sum) || sum <= 0 {
			return [difficultySemanticHeadProbabilityDimension]float64{}, errDifficultySemanticHeadInvalid
		}
		for class := 0; class < difficultySemanticHeadClassCount; class++ {
			index := head*difficultySemanticHeadClassCount + class
			probabilities[index] /= sum
			if !finiteDifficultyFloat(probabilities[index]) || probabilities[index] < 0 || probabilities[index] > 1 {
				return [difficultySemanticHeadProbabilityDimension]float64{}, errDifficultySemanticHeadInvalid
			}
		}
	}
	return probabilities, nil
}

func finiteDifficultyFloat32(value float32) bool {
	converted := float64(value)
	return !math.IsNaN(converted) && !math.IsInf(converted, 0)
}
