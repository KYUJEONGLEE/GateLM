//go:build difficulty_e5_onnx && linux && cgo

package e5onnx

import (
	"context"
	"os"
	"sync"

	"gatelm/apps/gateway-core/internal/domain/routing"

	"github.com/daulet/tokenizers"
	ort "github.com/yalue/onnxruntime_go"
)

const (
	inputPrefix              = "query: "
	maximumTokenLength       = 128
	nativeEmbeddingDimension = 384
)

var environmentState struct {
	sync.Mutex
	initialized bool
	libraryPath string
	references  int
}

type nativeEncoder struct {
	mu              sync.Mutex
	tokenizer       *tokenizers.Tokenizer
	session         *ort.DynamicAdvancedSession
	inputNames      []string
	hasTokenTypeIDs bool
	closed          bool
}

func NewEncoder(config BundleConfig) (routing.DifficultySemanticPooledEncoder, error) {
	bundle, err := VerifyBundle(config)
	if err != nil {
		return nil, ErrUnavailable
	}
	if err := acquireEnvironment(bundle.ONNXRuntimeLibraryPath); err != nil {
		return nil, ErrUnavailable
	}
	cleanupEnvironment := true
	defer func() {
		if cleanupEnvironment {
			_ = releaseEnvironment()
		}
	}()

	tokenizerPayload, err := os.ReadFile(bundle.TokenizerPath)
	if err != nil || len(tokenizerPayload) == 0 || len(tokenizerPayload) > 32<<20 {
		return nil, ErrUnavailable
	}
	tokenizer, err := tokenizers.FromBytesWithTruncation(
		tokenizerPayload,
		maximumTokenLength,
		tokenizers.TruncationDirectionRight,
	)
	if err != nil {
		return nil, ErrUnavailable
	}
	cleanupTokenizer := true
	defer func() {
		if cleanupTokenizer {
			_ = tokenizer.Close()
		}
	}()

	options, err := newSessionOptions()
	if err != nil {
		return nil, ErrUnavailable
	}
	defer options.Destroy()
	inputs, outputs, err := ort.GetInputOutputInfoWithOptions(bundle.ModelPath, options)
	if err != nil {
		return nil, ErrUnavailable
	}
	inputNames, hasTokenTypeIDs, err := validateModelContract(inputs, outputs)
	if err != nil {
		return nil, err
	}
	session, err := ort.NewDynamicAdvancedSession(
		bundle.ModelPath,
		inputNames,
		[]string{"last_hidden_state"},
		options,
	)
	if err != nil {
		return nil, ErrUnavailable
	}

	cleanupEnvironment = false
	cleanupTokenizer = false
	return &nativeEncoder{
		tokenizer:       tokenizer,
		session:         session,
		inputNames:      inputNames,
		hasTokenTypeIDs: hasTokenTypeIDs,
	}, nil
}

func (encoder *nativeEncoder) EncodePooled(
	ctx context.Context,
	instructionText string,
) (routing.DifficultySemanticPooled, error) {
	var empty routing.DifficultySemanticPooled
	if encoder == nil || instructionText == "" {
		return empty, ErrInvalidInput
	}
	if err := ctx.Err(); err != nil {
		return empty, ErrInferenceFailed
	}
	encoder.mu.Lock()
	defer encoder.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return empty, ErrInferenceFailed
	}
	if encoder.closed || encoder.tokenizer == nil || encoder.session == nil {
		return empty, ErrUnavailable
	}
	encoded := encoder.tokenizer.EncodeWithOptions(
		inputPrefix+instructionText,
		true,
		tokenizers.WithReturnTypeIDs(),
		tokenizers.WithReturnAttentionMask(),
	)
	sequenceLength := len(encoded.IDs)
	if sequenceLength == 0 || sequenceLength > maximumTokenLength || len(encoded.AttentionMask) != sequenceLength {
		return empty, ErrInvalidInput
	}
	inputIDs := make([]int64, sequenceLength)
	attentionMask := make([]int64, sequenceLength)
	tokenTypeIDs := make([]int64, sequenceLength)
	for index := 0; index < sequenceLength; index++ {
		inputIDs[index] = int64(encoded.IDs[index])
		attentionMask[index] = int64(encoded.AttentionMask[index])
		if len(encoded.TypeIDs) == sequenceLength {
			tokenTypeIDs[index] = int64(encoded.TypeIDs[index])
		}
	}
	shape := ort.NewShape(1, int64(sequenceLength))
	inputByName := make(map[string]ort.Value, len(encoder.inputNames))
	inputIDTensor, err := ort.NewTensor(shape, inputIDs)
	if err != nil {
		return empty, ErrInferenceFailed
	}
	defer inputIDTensor.Destroy()
	inputByName["input_ids"] = inputIDTensor
	attentionTensor, err := ort.NewTensor(shape, attentionMask)
	if err != nil {
		return empty, ErrInferenceFailed
	}
	defer attentionTensor.Destroy()
	inputByName["attention_mask"] = attentionTensor
	if encoder.hasTokenTypeIDs {
		tokenTypeTensor, err := ort.NewTensor(shape, tokenTypeIDs)
		if err != nil {
			return empty, ErrInferenceFailed
		}
		defer tokenTypeTensor.Destroy()
		inputByName["token_type_ids"] = tokenTypeTensor
	}
	inputs := make([]ort.Value, len(encoder.inputNames))
	for index, name := range encoder.inputNames {
		inputs[index] = inputByName[name]
	}
	outputs := []ort.Value{nil}
	if err := ctx.Err(); err != nil {
		return empty, ErrInferenceFailed
	}
	if err := encoder.session.Run(inputs, outputs); err != nil {
		if outputs[0] != nil {
			outputs[0].Destroy()
		}
		return empty, ErrInferenceFailed
	}
	if err := ctx.Err(); err != nil {
		if outputs[0] != nil {
			outputs[0].Destroy()
		}
		return empty, ErrInferenceFailed
	}
	if outputs[0] == nil {
		return empty, ErrInvalidEmbedding
	}
	defer outputs[0].Destroy()
	hidden, ok := outputs[0].(*ort.Tensor[float32])
	if !ok {
		return empty, ErrInvalidEmbedding
	}
	outputShape := hidden.GetShape()
	if len(outputShape) != 3 || outputShape[0] != 1 ||
		outputShape[1] != int64(sequenceLength) || outputShape[2] != nativeEmbeddingDimension {
		return empty, ErrInvalidEmbedding
	}
	pooled, err := attentionMaskMeanPooling(
		hidden.GetData(),
		attentionMask,
		sequenceLength,
		nativeEmbeddingDimension,
	)
	if err != nil {
		return empty, err
	}
	copy(empty[:], pooled)
	return empty, nil
}

func (encoder *nativeEncoder) Close() error {
	if encoder == nil {
		return nil
	}
	encoder.mu.Lock()
	defer encoder.mu.Unlock()
	if encoder.closed {
		return nil
	}
	encoder.closed = true
	if encoder.session != nil {
		_ = encoder.session.Destroy()
		encoder.session = nil
	}
	if encoder.tokenizer != nil {
		_ = encoder.tokenizer.Close()
		encoder.tokenizer = nil
	}
	return releaseEnvironment()
}

func newSessionOptions() (*ort.SessionOptions, error) {
	options, err := ort.NewSessionOptions()
	if err != nil {
		return nil, ErrUnavailable
	}
	if options.SetIntraOpNumThreads(4) != nil ||
		options.SetInterOpNumThreads(1) != nil ||
		options.SetExecutionMode(ort.ExecutionModeSequential) != nil ||
		options.SetGraphOptimizationLevel(ort.GraphOptimizationLevelEnableAll) != nil {
		_ = options.Destroy()
		return nil, ErrUnavailable
	}
	return options, nil
}

func validateModelContract(inputs, outputs []ort.InputOutputInfo) ([]string, bool, error) {
	if len(outputs) != 1 || outputs[0].Name != "last_hidden_state" ||
		outputs[0].OrtValueType != ort.ONNXTypeTensor ||
		outputs[0].DataType != ort.TensorElementDataTypeFloat ||
		len(outputs[0].Dimensions) != 3 || outputs[0].Dimensions[2] != nativeEmbeddingDimension {
		return nil, false, ErrUnavailable
	}
	inputByName := make(map[string]ort.InputOutputInfo, len(inputs))
	for _, input := range inputs {
		if _, duplicate := inputByName[input.Name]; duplicate {
			return nil, false, ErrUnavailable
		}
		inputByName[input.Name] = input
	}
	for _, required := range []string{"input_ids", "attention_mask"} {
		input, ok := inputByName[required]
		if !ok || input.OrtValueType != ort.ONNXTypeTensor ||
			input.DataType != ort.TensorElementDataTypeInt64 || len(input.Dimensions) != 2 {
			return nil, false, ErrUnavailable
		}
	}
	if len(inputByName) != 2 && len(inputByName) != 3 {
		return nil, false, ErrUnavailable
	}
	_, hasTokenTypeIDs := inputByName["token_type_ids"]
	if len(inputByName) == 3 && !hasTokenTypeIDs {
		return nil, false, ErrUnavailable
	}
	if hasTokenTypeIDs {
		input := inputByName["token_type_ids"]
		if input.OrtValueType != ort.ONNXTypeTensor ||
			input.DataType != ort.TensorElementDataTypeInt64 || len(input.Dimensions) != 2 {
			return nil, false, ErrUnavailable
		}
		return []string{"input_ids", "attention_mask", "token_type_ids"}, true, nil
	}
	return []string{"input_ids", "attention_mask"}, false, nil
}

func acquireEnvironment(libraryPath string) error {
	environmentState.Lock()
	defer environmentState.Unlock()
	if environmentState.initialized {
		if environmentState.libraryPath != libraryPath {
			return ErrUnavailable
		}
		environmentState.references++
		return nil
	}
	ort.SetSharedLibraryPath(libraryPath)
	if err := ort.InitializeEnvironment(); err != nil {
		return ErrUnavailable
	}
	if ort.GetVersion() != pinnedONNXRuntimeVersion {
		_ = ort.DestroyEnvironment()
		return ErrUnavailable
	}
	environmentState.initialized = true
	environmentState.libraryPath = libraryPath
	environmentState.references = 1
	return nil
}

func releaseEnvironment() error {
	environmentState.Lock()
	defer environmentState.Unlock()
	if !environmentState.initialized || environmentState.references <= 0 {
		return nil
	}
	environmentState.references--
	if environmentState.references > 0 {
		return nil
	}
	if err := ort.DestroyEnvironment(); err != nil {
		return ErrUnavailable
	}
	environmentState.initialized = false
	environmentState.libraryPath = ""
	return nil
}
