package routing

import (
	"errors"
	"fmt"
)

// difficultyFeatureShapeDescriptor is an offline-only identity boundary. It
// deliberately contains no request feature values or semantic intermediates.
type difficultyFeatureShapeDescriptor struct {
	offlineFeatureShapeVersion string
	candidateName              string
	totalDimension             int
	featureNames               []string
}

func newDifficultyFeatureShapeDescriptor(
	offlineFeatureShapeVersion string,
	candidateName string,
	totalDimension int,
	featureNames []string,
) (difficultyFeatureShapeDescriptor, error) {
	descriptor := difficultyFeatureShapeDescriptor{
		offlineFeatureShapeVersion: offlineFeatureShapeVersion,
		candidateName:              candidateName,
		totalDimension:             totalDimension,
		featureNames:               append([]string(nil), featureNames...),
	}
	if err := descriptor.validate(); err != nil {
		return difficultyFeatureShapeDescriptor{}, err
	}
	return descriptor, nil
}

func (descriptor difficultyFeatureShapeDescriptor) validate() error {
	if descriptor.offlineFeatureShapeVersion == "" || descriptor.candidateName == "" {
		return errors.New("offline difficulty feature shape identity is required")
	}
	if descriptor.totalDimension <= 0 {
		return errors.New("offline difficulty feature shape dimension must be positive")
	}
	if len(descriptor.featureNames) != descriptor.totalDimension {
		return fmt.Errorf(
			"offline difficulty feature names=%d totalDimension=%d",
			len(descriptor.featureNames),
			descriptor.totalDimension,
		)
	}
	seen := make(map[string]struct{}, len(descriptor.featureNames))
	for index, name := range descriptor.featureNames {
		if name == "" {
			return fmt.Errorf("offline difficulty feature name %d is empty", index)
		}
		if _, exists := seen[name]; exists {
			return fmt.Errorf("offline difficulty feature name %q is duplicated", name)
		}
		seen[name] = struct{}{}
	}
	return nil
}

func (descriptor difficultyFeatureShapeDescriptor) equal(other difficultyFeatureShapeDescriptor) bool {
	if descriptor.offlineFeatureShapeVersion != other.offlineFeatureShapeVersion ||
		descriptor.candidateName != other.candidateName ||
		descriptor.totalDimension != other.totalDimension ||
		len(descriptor.featureNames) != len(other.featureNames) {
		return false
	}
	for index := range descriptor.featureNames {
		if descriptor.featureNames[index] != other.featureNames[index] {
			return false
		}
	}
	return true
}

type difficultyOfflineModelMaterial struct {
	artifactVersion string
	contentHash     string
	descriptor      difficultyFeatureShapeDescriptor
	bias            float64
	weights         []float64
	calibrator      DifficultyCalibratorMaterial
	threshold       float64
}

// difficultyOfflineLogisticModel is codegen-compatible inference material for
// explicit offline/shadow candidates. No product runtime registration exists.
type difficultyOfflineLogisticModel struct {
	artifactVersion string
	contentHash     string
	descriptor      difficultyFeatureShapeDescriptor
	scorer          difficultyLinearScorer
	calibrator      difficultyCalibrator
	threshold       float64
}

func newDifficultyOfflineLogisticModel(material difficultyOfflineModelMaterial) (difficultyOfflineLogisticModel, error) {
	if material.artifactVersion == "" || material.contentHash == "" {
		return difficultyOfflineLogisticModel{}, errors.New("offline difficulty model provenance is required")
	}
	if err := material.descriptor.validate(); err != nil {
		return difficultyOfflineLogisticModel{}, err
	}
	if len(material.weights) != material.descriptor.totalDimension {
		return difficultyOfflineLogisticModel{}, fmt.Errorf(
			"offline difficulty model weights=%d totalDimension=%d",
			len(material.weights),
			material.descriptor.totalDimension,
		)
	}
	scorer, err := newDifficultyLinearScorer(material.bias, material.weights)
	if err != nil {
		return difficultyOfflineLogisticModel{}, err
	}
	calibrator, err := newDifficultyCalibrator(material.calibrator)
	if err != nil {
		return difficultyOfflineLogisticModel{}, err
	}
	if !finiteDifficultyFloat(material.threshold) || material.threshold < 0 || material.threshold > 1 {
		return difficultyOfflineLogisticModel{}, errors.New("offline difficulty threshold must be a finite inclusive probability")
	}
	return difficultyOfflineLogisticModel{
		artifactVersion: material.artifactVersion,
		contentHash:     material.contentHash,
		descriptor: difficultyFeatureShapeDescriptor{
			offlineFeatureShapeVersion: material.descriptor.offlineFeatureShapeVersion,
			candidateName:              material.descriptor.candidateName,
			totalDimension:             material.descriptor.totalDimension,
			featureNames:               append([]string(nil), material.descriptor.featureNames...),
		},
		scorer:     scorer,
		calibrator: calibrator,
		threshold:  material.threshold,
	}, nil
}

type difficultyOfflineVectorizer interface {
	difficultyFeatureShape() difficultyFeatureShapeDescriptor
	vectorizeDifficultyFeatures(DifficultyFeatures) ([]float64, error)
}

type difficultyOfflineClassifier struct {
	model      difficultyOfflineLogisticModel
	vectorizer difficultyOfflineVectorizer
}

func newDifficultyOfflineClassifier(
	model difficultyOfflineLogisticModel,
	vectorizer difficultyOfflineVectorizer,
) (difficultyOfflineClassifier, error) {
	if vectorizer == nil {
		return difficultyOfflineClassifier{}, errors.New("offline difficulty vectorizer is required")
	}
	vectorizerDescriptor := vectorizer.difficultyFeatureShape()
	if err := vectorizerDescriptor.validate(); err != nil {
		return difficultyOfflineClassifier{}, err
	}
	if !model.descriptor.equal(vectorizerDescriptor) {
		return difficultyOfflineClassifier{}, errors.New("offline difficulty model and vectorizer feature shapes do not match")
	}
	return difficultyOfflineClassifier{model: model, vectorizer: vectorizer}, nil
}

func (classifier difficultyOfflineClassifier) ClassifyFeatures(features DifficultyFeatures) (DifficultyResult, error) {
	if isMeaninglessDifficultyInput(features) {
		return DifficultyResult{ComplexityScore: 0, Difficulty: DifficultySimple}, nil
	}
	if hasHardComplexEvidence(features) {
		return DifficultyResult{ComplexityScore: 1, Difficulty: DifficultyComplex}, nil
	}
	vector, err := classifier.vectorizer.vectorizeDifficultyFeatures(features)
	if err != nil {
		return DifficultyResult{}, err
	}
	rawProbability, err := classifier.model.scorer.score(vector)
	if err != nil {
		return DifficultyResult{}, err
	}
	calibratedScore := classifier.model.calibrator.calibrate(rawProbability)
	if !finiteDifficultyFloat(calibratedScore) || calibratedScore < 0 || calibratedScore > 1 {
		return DifficultyResult{}, errors.New("offline difficulty calibrator returned an invalid score")
	}
	return DifficultyResult{
		ComplexityScore: calibratedScore,
		Difficulty:      difficultyFromScore(calibratedScore, classifier.model.threshold),
	}, nil
}
