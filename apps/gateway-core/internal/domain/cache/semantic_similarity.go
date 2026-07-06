package cache

import (
	"errors"
	"math"
)

var (
	ErrSemanticVectorEmpty             = errors.New("semantic vector is empty")
	ErrSemanticVectorDimensionMismatch = errors.New("semantic vector dimensions do not match")
	ErrSemanticVectorZero              = errors.New("semantic vector has zero magnitude")
)

func CosineSimilarity(left []float64, right []float64) (float64, error) {
	if len(left) == 0 || len(right) == 0 {
		return 0, ErrSemanticVectorEmpty
	}
	if len(left) != len(right) {
		return 0, ErrSemanticVectorDimensionMismatch
	}

	var dot float64
	var leftSquares float64
	var rightSquares float64
	for i := range left {
		dot += left[i] * right[i]
		leftSquares += left[i] * left[i]
		rightSquares += right[i] * right[i]
	}
	if leftSquares == 0 || rightSquares == 0 {
		return 0, ErrSemanticVectorZero
	}

	similarity := dot / math.Sqrt(leftSquares*rightSquares)
	if similarity > 1 {
		return 1, nil
	}
	if similarity < -1 {
		return -1, nil
	}
	return similarity, nil
}
