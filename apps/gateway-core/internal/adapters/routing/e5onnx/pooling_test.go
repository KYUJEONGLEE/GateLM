package e5onnx

import (
	"errors"
	"math"
	"testing"
)

func TestAttentionMaskMeanPoolingExcludesPadding(t *testing.T) {
	hidden := []float32{
		1, 3,
		99, 101,
		5, 7,
	}
	pooled, err := attentionMaskMeanPooling(hidden, []int64{1, 0, 1}, 3, 2)
	if err != nil {
		t.Fatal(err)
	}
	if pooled[0] != 3 || pooled[1] != 5 {
		t.Fatalf("masked mean=%v, want [3 5]", pooled)
	}
}

func TestAttentionMaskMeanPoolingRejectsInvalidMaterial(t *testing.T) {
	tests := []struct {
		name   string
		hidden []float32
		mask   []int64
	}{
		{name: "empty mask", hidden: []float32{1, 2}, mask: []int64{0}},
		{name: "invalid mask", hidden: []float32{1, 2}, mask: []int64{2}},
		{name: "non finite", hidden: []float32{float32(math.NaN()), 2}, mask: []int64{1}},
		{name: "non finite padding", hidden: []float32{1, float32(math.Inf(1))}, mask: []int64{0}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := attentionMaskMeanPooling(test.hidden, test.mask, 1, 2)
			if !errors.Is(err, ErrInvalidEmbedding) {
				t.Fatalf("error=%v, want invalid embedding", err)
			}
		})
	}
}
