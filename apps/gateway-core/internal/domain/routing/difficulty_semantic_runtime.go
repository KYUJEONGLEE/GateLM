package routing

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

const (
	defaultDifficultySemanticRuntimeTimeout   = 100 * time.Millisecond
	defaultDifficultySemanticRuntimeQueueSize = 4
)

type difficultySemanticRuntimeJob struct {
	ctx      context.Context
	features PromptFeatures
	category string
	result   chan DifficultySemanticShadowResult
}

// DifficultySemanticClassifier is the hot-path boundary shared by the
// process-local E5 runtime and contract-gated experimental remote runtimes.
// Any non-ready result keeps the existing rule-based difficulty authoritative.
type DifficultySemanticClassifier interface {
	Classify(context.Context, PromptFeatures, string) DifficultySemanticShadowResult
	Close(context.Context) error
}

// DifficultySemanticRuntime serializes access to the native encoder while
// bounding how long an auto-routing request can wait. A non-ready result is a
// fail-safe signal to retain the rule-based difficulty for that request.
type DifficultySemanticRuntime struct {
	evaluator DifficultySemanticShadowEvaluation
	timeout   time.Duration
	jobs      chan difficultySemanticRuntimeJob
	ctx       context.Context
	cancel    context.CancelFunc
	done      chan struct{}
	closed    atomic.Bool
	closeOnce sync.Once
}

func NewDifficultySemanticRuntime(
	evaluator DifficultySemanticShadowEvaluation,
	timeout time.Duration,
) *DifficultySemanticRuntime {
	if evaluator == nil {
		return nil
	}
	if timeout <= 0 {
		timeout = defaultDifficultySemanticRuntimeTimeout
	}
	ctx, cancel := context.WithCancel(context.Background())
	runtime := &DifficultySemanticRuntime{
		evaluator: evaluator,
		timeout:   timeout,
		jobs:      make(chan difficultySemanticRuntimeJob, defaultDifficultySemanticRuntimeQueueSize),
		ctx:       ctx,
		cancel:    cancel,
		done:      make(chan struct{}),
	}
	go runtime.run()
	return runtime
}

func (runtime *DifficultySemanticRuntime) Classify(
	ctx context.Context,
	features PromptFeatures,
	category string,
) DifficultySemanticShadowResult {
	if runtime == nil || runtime.closed.Load() {
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowUnavailable}
	}
	if ctx == nil {
		ctx = context.Background()
	}
	requestCtx, cancel := context.WithTimeout(ctx, runtime.timeout)
	defer cancel()
	job := difficultySemanticRuntimeJob{
		ctx:      requestCtx,
		features: features,
		category: canonicalCategory(category),
		result:   make(chan DifficultySemanticShadowResult, 1),
	}
	select {
	case <-runtime.ctx.Done():
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowUnavailable}
	case <-requestCtx.Done():
		return difficultySemanticRuntimeContextResult(requestCtx)
	case runtime.jobs <- job:
	default:
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowBusy}
	}
	select {
	case <-runtime.ctx.Done():
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowUnavailable}
	case <-requestCtx.Done():
		return difficultySemanticRuntimeContextResult(requestCtx)
	case result := <-job.result:
		result.Status = canonicalDifficultySemanticShadowStatus(result.Status)
		if result.Status == DifficultySemanticShadowReady &&
			result.Difficulty.Difficulty != DifficultySimple &&
			result.Difficulty.Difficulty != DifficultyComplex {
			return DifficultySemanticShadowResult{Status: DifficultySemanticShadowInvalidEmbedding}
		}
		return result
	}
}

func (runtime *DifficultySemanticRuntime) run() {
	defer close(runtime.done)
	for {
		select {
		case <-runtime.ctx.Done():
			return
		case job := <-runtime.jobs:
			if job.ctx.Err() != nil {
				continue
			}
			result := runtime.evaluate(job)
			select {
			case job.result <- result:
			default:
			}
		}
	}
}

func (runtime *DifficultySemanticRuntime) evaluate(job difficultySemanticRuntimeJob) (
	result DifficultySemanticShadowResult,
) {
	result = DifficultySemanticShadowResult{Status: DifficultySemanticShadowPanicRecovered}
	defer func() {
		if recover() != nil {
			result = DifficultySemanticShadowResult{Status: DifficultySemanticShadowPanicRecovered}
		}
	}()
	result = runtime.evaluator.Evaluate(job.ctx, job.features, job.category)
	if job.ctx.Err() != nil {
		return difficultySemanticRuntimeContextResult(job.ctx)
	}
	return result
}

func difficultySemanticRuntimeContextResult(ctx context.Context) DifficultySemanticShadowResult {
	if ctx != nil && ctx.Err() == context.DeadlineExceeded {
		return DifficultySemanticShadowResult{Status: DifficultySemanticShadowTimeout}
	}
	return DifficultySemanticShadowResult{Status: DifficultySemanticShadowUnavailable}
}

func (runtime *DifficultySemanticRuntime) Close(ctx context.Context) error {
	if runtime == nil {
		return nil
	}
	runtime.closeOnce.Do(func() {
		runtime.closed.Store(true)
		runtime.cancel()
	})
	select {
	case <-runtime.done:
		return runtime.evaluator.Close()
	case <-ctx.Done():
		return ctx.Err()
	}
}
