package routing

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

const (
	DifficultySemanticShadowComparisonMatch                   = "match"
	DifficultySemanticShadowComparisonRuleSimpleShadowComplex = "rule_simple_shadow_complex"
	DifficultySemanticShadowComparisonRuleComplexShadowSimple = "rule_complex_shadow_simple"
	DifficultySemanticShadowComparisonNotCompared             = "not_compared"

	DifficultySemanticShadowPanicRecovered = "panic_recovered"
)

const defaultDifficultySemanticShadowTimeout = 100 * time.Millisecond

// DifficultySemanticShadowObservation is deliberately limited to bounded,
// low-cardinality comparison material. Request text, embeddings, vectors,
// model parameters and per-request scores must never cross this boundary.
type DifficultySemanticShadowObservation struct {
	Status     string
	Category   string
	Comparison string
	Duration   time.Duration
}

type DifficultySemanticShadowObserver interface {
	ObserveDifficultySemanticShadow(DifficultySemanticShadowObservation)
}

type DifficultySemanticShadowObserverFunc func(DifficultySemanticShadowObservation)

func (observe DifficultySemanticShadowObserverFunc) ObserveDifficultySemanticShadow(
	observation DifficultySemanticShadowObservation,
) {
	if observe != nil {
		observe(observation)
	}
}

type difficultySemanticShadowJob struct {
	features       PromptFeatures
	category       string
	ruleDifficulty string
}

type DifficultySemanticShadowEvaluation interface {
	Evaluate(context.Context, PromptFeatures, string) DifficultySemanticShadowResult
	Close() error
}

// DifficultySemanticShadowRunner owns one worker and one buffered waiting job.
// Submit is non-blocking so shadow inference can never delay route selection or
// provider execution.
type DifficultySemanticShadowRunner struct {
	evaluator DifficultySemanticShadowEvaluation
	timeout   time.Duration
	observer  DifficultySemanticShadowObserver
	jobs      chan difficultySemanticShadowJob
	ctx       context.Context
	cancel    context.CancelFunc
	done      chan struct{}
	closed    atomic.Bool
	closeOnce sync.Once
}

func NewDifficultySemanticShadowRunner(
	evaluator DifficultySemanticShadowEvaluation,
	timeout time.Duration,
	observer DifficultySemanticShadowObserver,
) *DifficultySemanticShadowRunner {
	if evaluator == nil {
		return nil
	}
	if timeout <= 0 {
		timeout = defaultDifficultySemanticShadowTimeout
	}
	ctx, cancel := context.WithCancel(context.Background())
	runner := &DifficultySemanticShadowRunner{
		evaluator: evaluator,
		timeout:   timeout,
		observer:  observer,
		jobs:      make(chan difficultySemanticShadowJob, 1),
		ctx:       ctx,
		cancel:    cancel,
		done:      make(chan struct{}),
	}
	go runner.run()
	return runner
}

func (runner *DifficultySemanticShadowRunner) Submit(
	features PromptFeatures,
	category string,
	ruleDifficulty string,
) bool {
	if runner == nil || runner.closed.Load() {
		return false
	}
	job := difficultySemanticShadowJob{
		features:       features,
		category:       canonicalCategory(category),
		ruleDifficulty: canonicalDifficulty(ruleDifficulty),
	}
	select {
	case <-runner.ctx.Done():
		return false
	case runner.jobs <- job:
		return true
	default:
		runner.notify(DifficultySemanticShadowObservation{
			Status:     DifficultySemanticShadowBusy,
			Category:   job.category,
			Comparison: DifficultySemanticShadowComparisonNotCompared,
		})
		return false
	}
}

func (runner *DifficultySemanticShadowRunner) run() {
	defer close(runner.done)
	for {
		select {
		case <-runner.ctx.Done():
			return
		case job := <-runner.jobs:
			runner.evaluate(job)
		}
	}
}

func (runner *DifficultySemanticShadowRunner) evaluate(job difficultySemanticShadowJob) {
	startedAt := time.Now()
	ctx, cancel := context.WithTimeout(runner.ctx, runner.timeout)
	defer cancel()

	status := DifficultySemanticShadowPanicRecovered
	shadowDifficulty := ""
	func() {
		defer func() {
			_ = recover()
		}()
		result := runner.evaluator.Evaluate(ctx, job.features, job.category)
		status = canonicalDifficultySemanticShadowStatus(result.Status)
		shadowDifficulty = result.Difficulty.Difficulty
	}()
	if ctx.Err() == context.DeadlineExceeded {
		status = DifficultySemanticShadowTimeout
		shadowDifficulty = ""
	}
	if status == DifficultySemanticShadowReady &&
		shadowDifficulty != DifficultySimple && shadowDifficulty != DifficultyComplex {
		status = DifficultySemanticShadowInvalidEmbedding
		shadowDifficulty = ""
	}

	comparison := DifficultySemanticShadowComparisonNotCompared
	if status == DifficultySemanticShadowReady {
		comparison = difficultySemanticShadowComparison(job.ruleDifficulty, shadowDifficulty)
	}
	runner.notify(DifficultySemanticShadowObservation{
		Status:     status,
		Category:   job.category,
		Comparison: comparison,
		Duration:   time.Since(startedAt),
	})
}

func canonicalDifficultySemanticShadowStatus(value string) string {
	switch value {
	case DifficultySemanticShadowReady,
		DifficultySemanticShadowNotApplicable,
		DifficultySemanticShadowUnavailable,
		DifficultySemanticShadowBusy,
		DifficultySemanticShadowTimeout,
		DifficultySemanticShadowInvalidEmbedding,
		DifficultySemanticShadowInferenceFailed,
		DifficultySemanticShadowPanicRecovered:
		return value
	default:
		return DifficultySemanticShadowUnavailable
	}
}

func difficultySemanticShadowComparison(ruleDifficulty string, shadowDifficulty string) string {
	ruleDifficulty = canonicalDifficulty(ruleDifficulty)
	shadowDifficulty = canonicalDifficulty(shadowDifficulty)
	if ruleDifficulty == shadowDifficulty {
		return DifficultySemanticShadowComparisonMatch
	}
	if ruleDifficulty == DifficultySimple {
		return DifficultySemanticShadowComparisonRuleSimpleShadowComplex
	}
	return DifficultySemanticShadowComparisonRuleComplexShadowSimple
}

func (runner *DifficultySemanticShadowRunner) notify(observation DifficultySemanticShadowObservation) {
	if runner == nil || runner.observer == nil {
		return
	}
	defer func() {
		_ = recover()
	}()
	runner.observer.ObserveDifficultySemanticShadow(observation)
}

func (runner *DifficultySemanticShadowRunner) Close(ctx context.Context) error {
	if runner == nil {
		return nil
	}
	runner.closeOnce.Do(func() {
		runner.closed.Store(true)
		runner.cancel()
	})
	select {
	case <-runner.done:
		return runner.evaluator.Close()
	case <-ctx.Done():
		return ctx.Err()
	}
}
