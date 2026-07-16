package e5onnx

import (
	"errors"
	"math"
)

var (
	ErrUnavailable      = errors.New("unavailable")
	ErrInvalidInput     = errors.New("invalid_input")
	ErrInvalidEmbedding = errors.New("invalid_embedding")
	ErrInferenceFailed  = errors.New("inference_failed")
)

func attentionMaskMeanPooling(
	hidden []float32,
	attentionMask []int64,
	sequenceLength int,
	hiddenDimension int,
) ([]float32, error) {
	if sequenceLength <= 0 || hiddenDimension <= 0 ||
		len(attentionMask) != sequenceLength || len(hidden) != sequenceLength*hiddenDimension {
		return nil, ErrInvalidEmbedding
	}
	pooled := make([]float32, hiddenDimension)
	readable := float32(0)
	for token := 0; token < sequenceLength; token++ {
		mask := attentionMask[token]
		if mask != 0 && mask != 1 {
			return nil, ErrInvalidEmbedding
		}
		offset := token * hiddenDimension
		for dimension := 0; dimension < hiddenDimension; dimension++ {
			if !finiteFloat32(hidden[offset+dimension]) {
				return nil, ErrInvalidEmbedding
			}
		}
		if mask == 0 {
			continue
		}
		readable++
		for dimension := 0; dimension < hiddenDimension; dimension++ {
			value := hidden[offset+dimension]
			pooled[dimension] += value
		}
	}
	if readable <= 0 {
		return nil, ErrInvalidEmbedding
	}
	for index := range pooled {
		pooled[index] /= readable
		if !finiteFloat32(pooled[index]) {
			return nil, ErrInvalidEmbedding
		}
	}
	return pooled, nil
}

func finiteFloat32(value float32) bool {
	converted := float64(value)
	return !math.IsNaN(converted) && !math.IsInf(converted, 0)
}
