package runtime

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

const snapshotSchemaID = "https://gatelm.local/schemas/tenant-chat/v1/tenant-runtime-snapshot.schema.json"

//go:embed schema/tenant-runtime-snapshot.schema.json
var snapshotSchemaDocument []byte

var (
	compiledSnapshotSchema *jsonschema.Schema
	compileSnapshotOnce    sync.Once
	compileSnapshotErr     error
)

type Snapshot struct {
	SnapshotID            string   `json:"snapshotId"`
	Version               int64    `json:"version"`
	Digest                string   `json:"digest"`
	TenantID              string   `json:"tenantId"`
	PolicyVersion         int64    `json:"policyVersion"`
	EmployeeNoticeVersion int64    `json:"employeeNoticeVersion"`
	Pricing               Pricing  `json:"pricing"`
	Policies              Policies `json:"policies"`
	PublishedAt           string   `json:"publishedAt"`
	PublishedBy           string   `json:"publishedBy"`
}

type Pricing struct {
	Version     int64        `json:"version"`
	Digest      string       `json:"digest"`
	Currency    string       `json:"currency"`
	Unit        string       `json:"unit"`
	EffectiveAt string       `json:"effectiveAt"`
	Routes      []PriceRoute `json:"routes"`
}

type PriceRoute struct {
	RouteID                                string `json:"routeId"`
	ProviderID                             string `json:"providerId"`
	ModelKey                               string `json:"modelKey"`
	InputMicroUSDPerMillionTokens          int64  `json:"inputMicroUsdPerMillionTokens"`
	OutputMicroUSDPerMillionTokens         int64  `json:"outputMicroUsdPerMillionTokens"`
	CacheReadInputMicroUSDPerMillionTokens *int64 `json:"cacheReadInputMicroUsdPerMillionTokens,omitempty"`
}

type Policies struct {
	RateLimit   RateLimitPolicy   `json:"rateLimit"`
	Concurrency ConcurrencyPolicy `json:"concurrency"`
	Quota       QuotaPolicy       `json:"quota"`
	Budget      BudgetPolicy      `json:"budget"`
	Routing     RoutingPolicy     `json:"routing"`
	Fallback    FallbackPolicy    `json:"fallback"`
	Cache       CachePolicy       `json:"cache"`
	Safety      SafetyPolicy      `json:"safety"`
	Streaming   StreamingPolicy   `json:"streaming"`
}

type RateLimitPolicy struct {
	Requests      int `json:"requests"`
	WindowSeconds int `json:"windowSeconds"`
}

type ConcurrencyPolicy struct {
	MaxActiveAdmissionsPerUser int `json:"maxActiveAdmissionsPerUser"`
	AdmissionTTLSeconds        int `json:"admissionTtlSeconds"`
}

type QuotaPolicy struct {
	Period                   string `json:"period"`
	Timezone                 string `json:"timezone"`
	DefaultMonthlyTokenLimit int64  `json:"defaultMonthlyTokenLimit"`
	WarningPercent           int    `json:"warningPercent"`
	EconomyPercent           int    `json:"economyPercent"`
	HardStopPercent          int    `json:"hardStopPercent"`
}

type BudgetPolicy struct {
	Period               string `json:"period"`
	Timezone             string `json:"timezone"`
	Currency             string `json:"currency"`
	MonthlyLimitMicroUSD int64  `json:"monthlyLimitMicroUsd"`
	WarningPercent       int    `json:"warningPercent"`
	EconomyPercent       int    `json:"economyPercent"`
	HardStopPercent      int    `json:"hardStopPercent"`
}

type RoutingPolicy struct {
	Routes []RuntimeRoute `json:"routes"`
}

type RuntimeRoute struct {
	RouteID    string `json:"routeId"`
	Tier       string `json:"tier"`
	ProviderID string `json:"providerId"`
	ModelKey   string `json:"modelKey"`
	Enabled    bool   `json:"enabled"`
}

type FallbackPolicy struct {
	Enabled        bool     `json:"enabled"`
	RouteIDs       []string `json:"routeIds"`
	MaxAttempts    int      `json:"maxAttempts"`
	AllowedReasons []string `json:"allowedReasons"`
}

type CachePolicy struct {
	Strategy          string `json:"strategy"`
	Enabled           bool   `json:"enabled"`
	TTLSeconds        int    `json:"ttlSeconds"`
	MaxEntriesPerUser int    `json:"maxEntriesPerUser"`
}

type SafetyPolicy struct {
	Enabled      bool   `json:"enabled"`
	PolicyDigest string `json:"policyDigest"`
}

type StreamingPolicy struct {
	Enabled            bool `json:"enabled"`
	MaxDurationSeconds int  `json:"maxDurationSeconds"`
	FinalEventRequired bool `json:"finalEventRequired"`
}

func ParseSnapshot(document []byte) (Snapshot, error) {
	schema, err := snapshotSchema()
	if err != nil {
		return Snapshot{}, err
	}
	decoder := json.NewDecoder(bytes.NewReader(document))
	decoder.UseNumber()
	var generic any
	if err := decoder.Decode(&generic); err != nil {
		return Snapshot{}, fmt.Errorf("decode tenant chat runtime snapshot: %w", err)
	}
	if err := schema.Validate(generic); err != nil {
		return Snapshot{}, fmt.Errorf("validate tenant chat runtime snapshot: %w", err)
	}
	var snapshot Snapshot
	if err := json.Unmarshal(document, &snapshot); err != nil {
		return Snapshot{}, fmt.Errorf("decode typed tenant chat runtime snapshot: %w", err)
	}
	return snapshot, nil
}

func snapshotSchema() (*jsonschema.Schema, error) {
	compileSnapshotOnce.Do(func() {
		var document any
		decoder := json.NewDecoder(bytes.NewReader(snapshotSchemaDocument))
		decoder.UseNumber()
		if err := decoder.Decode(&document); err != nil {
			compileSnapshotErr = fmt.Errorf("decode embedded runtime snapshot schema: %w", err)
			return
		}
		compiler := jsonschema.NewCompiler()
		compiler.AssertFormat()
		if err := compiler.AddResource(snapshotSchemaID, document); err != nil {
			compileSnapshotErr = fmt.Errorf("register runtime snapshot schema: %w", err)
			return
		}
		compiledSnapshotSchema, compileSnapshotErr = compiler.Compile(snapshotSchemaID)
	})
	return compiledSnapshotSchema, compileSnapshotErr
}
