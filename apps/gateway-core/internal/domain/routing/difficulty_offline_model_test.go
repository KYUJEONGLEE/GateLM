package routing

import (
	"fmt"
	"math"
	"strings"
	"testing"
)

type testDifficultyOfflineVectorizer struct {
	descriptor difficultyFeatureShapeDescriptor
	vector     []float64
	err        error
	calls      *int
}

func (vectorizer testDifficultyOfflineVectorizer) difficultyFeatureShape() difficultyFeatureShapeDescriptor {
	return vectorizer.descriptor
}

func (vectorizer testDifficultyOfflineVectorizer) vectorizeDifficultyFeatures(DifficultyFeatures) ([]float64, error) {
	if vectorizer.calls != nil {
		*vectorizer.calls++
	}
	return append([]float64(nil), vectorizer.vector...), vectorizer.err
}

func TestOfflineDifficultyClassifierRequiresExactModelVectorizerShape(t *testing.T) {
	t.Parallel()
	descriptor := testOfflineDescriptor(t, 47)
	model := testOfflineModel(t, descriptor)
	vectorizer := testDifficultyOfflineVectorizer{descriptor: descriptor, vector: make([]float64, 47)}
	if _, err := newDifficultyOfflineClassifier(model, vectorizer); err != nil {
		t.Fatal(err)
	}

	wrongNames := append([]string(nil), descriptor.featureNames...)
	wrongNames[0], wrongNames[1] = wrongNames[1], wrongNames[0]
	mismatch, err := newDifficultyFeatureShapeDescriptor(
		descriptor.offlineFeatureShapeVersion,
		descriptor.candidateName,
		descriptor.totalDimension,
		wrongNames,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := newDifficultyOfflineClassifier(model, testDifficultyOfflineVectorizer{descriptor: mismatch}); err == nil || !strings.Contains(err.Error(), "do not match") {
		t.Fatalf("shape mismatch error = %v", err)
	}
}

func TestOfflineDifficultyClassifierAppliesSentinelsBeforeVectorization(t *testing.T) {
	t.Parallel()
	descriptor := testOfflineDescriptor(t, 42)
	model := testOfflineModel(t, descriptor)
	calls := 0
	classifier, err := newDifficultyOfflineClassifier(model, testDifficultyOfflineVectorizer{
		descriptor: descriptor,
		vector:     make([]float64, 42),
		calls:      &calls,
	})
	if err != nil {
		t.Fatal(err)
	}
	result, err := classifier.ClassifyFeatures(DifficultyFeatures{
		category: CategoryGeneral,
		common:   CommonDifficultyFeatures{payloadSizeBucket: "empty"},
		general:  &GeneralDifficultyFeatures{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 0 || result.ComplexityScore != 0 || result.Difficulty != DifficultySimple {
		t.Fatalf("empty sentinel result=%#v calls=%d", result, calls)
	}

	result, err = classifier.ClassifyFeatures(DifficultyFeatures{
		category: CategoryGeneral,
		common: CommonDifficultyFeatures{
			payloadSizeBucket: "large",
			taskCount:         3,
			constraintCount:   3,
		},
		general: &GeneralDifficultyFeatures{workflowDepth: 5},
	})
	if err != nil {
		t.Fatal(err)
	}
	if calls != 0 || result.ComplexityScore != 1 || result.Difficulty != DifficultyComplex {
		t.Fatalf("hard sentinel result=%#v calls=%d", result, calls)
	}
}

func TestOfflineDifficultyClassifierRejectsInvalidVectorWithoutAffectingV1(t *testing.T) {
	t.Parallel()
	descriptor := testOfflineDescriptor(t, 47)
	model := testOfflineModel(t, descriptor)
	classifier, err := newDifficultyOfflineClassifier(model, testDifficultyOfflineVectorizer{
		descriptor: descriptor,
		vector:     []float64{math.NaN()},
	})
	if err != nil {
		t.Fatal(err)
	}
	features := DifficultyFeatures{
		category: CategoryGeneral,
		common:   CommonDifficultyFeatures{payloadSizeBucket: "small"},
		general:  &GeneralDifficultyFeatures{},
	}
	if _, err := classifier.ClassifyFeatures(features); err == nil {
		t.Fatal("invalid offline vector was accepted")
	}
	if baseline := NewRuleBasedDifficultyClassifier().ClassifyFeatures(features); baseline.Difficulty != DifficultySimple {
		t.Fatalf("offline failure changed rule-based result: %#v", baseline)
	}
}

func testOfflineDescriptor(t *testing.T, dimension int) difficultyFeatureShapeDescriptor {
	t.Helper()
	names := make([]string, dimension)
	for index := range names {
		names[index] = fmt.Sprintf("feature[%d]", index)
	}
	descriptor, err := newDifficultyFeatureShapeDescriptor(
		"difficulty-offline-feature-shape.v1",
		"synthetic-test-candidate",
		dimension,
		names,
	)
	if err != nil {
		t.Fatal(err)
	}
	return descriptor
}

func testOfflineModel(t *testing.T, descriptor difficultyFeatureShapeDescriptor) difficultyOfflineLogisticModel {
	t.Helper()
	coefficient := 1.0
	intercept := 0.0
	model, err := newDifficultyOfflineLogisticModel(difficultyOfflineModelMaterial{
		artifactVersion: "difficulty-offline.synthetic-test-v1",
		contentHash:     "sha256:synthetic-test",
		descriptor:      descriptor,
		weights:         make([]float64, descriptor.totalDimension),
		calibrator: DifficultyCalibratorMaterial{
			Kind:             string(difficultyCalibratorPlatt),
			PlattCoefficient: &coefficient,
			PlattIntercept:   &intercept,
		},
		threshold: 0.45,
	})
	if err != nil {
		t.Fatal(err)
	}
	return model
}
