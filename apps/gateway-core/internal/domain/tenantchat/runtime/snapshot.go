package runtime

import (
	"bytes"
	_ "embed"
	"encoding/json"
	"fmt"
	"sync"

	"gatelm/apps/gateway-core/internal/domain/masking"

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
	PricingStatus                          string `json:"pricingStatus,omitempty"`
	PricingSource                          string `json:"pricingSource,omitempty"`
	InputMicroUSDPerMillionTokens          int64  `json:"inputMicroUsdPerMillionTokens"`
	OutputMicroUSDPerMillionTokens         int64  `json:"outputMicroUsdPerMillionTokens"`
	CacheReadInputMicroUSDPerMillionTokens *int64 `json:"cacheReadInputMicroUsdPerMillionTokens,omitempty"`
}

type Policies struct {
	RateLimit         RateLimitPolicy         `json:"rateLimit"`
	Concurrency       ConcurrencyPolicy       `json:"concurrency"`
	Quota             QuotaPolicy             `json:"quota"`
	Budget            BudgetPolicy            `json:"budget"`
	Routing           RoutingPolicy           `json:"routing"`
	Fallback          FallbackPolicy          `json:"fallback"`
	ProviderTokenRate ProviderTokenRatePolicy `json:"providerTokenRate"`
	Cache             CachePolicy             `json:"cache"`
	Safety            SafetyPolicy            `json:"safety"`
	Streaming         StreamingPolicy         `json:"streaming"`
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
	Routes         []RuntimeRoute         `json:"routes"`
	Policy         *RoutingPolicyV2Bridge `json:"policy,omitempty"`
	ManualModelRef string                 `json:"manualModelRef,omitempty"`
}

type RuntimeRoute struct {
	RouteID    string `json:"routeId"`
	Tier       string `json:"tier,omitempty"`
	ModelRef   string `json:"modelRef,omitempty"`
	ProviderID string `json:"providerId"`
	ModelKey   string `json:"modelKey"`
	Enabled    bool   `json:"enabled"`
}

type RoutingPolicyV2Bridge struct {
	SchemaVersion     string        `json:"schemaVersion"`
	Mode              string        `json:"mode"`
	BootstrapState    string        `json:"bootstrapState"`
	RoutingPolicyHash string        `json:"routingPolicyHash"`
	Routes            RoutingMatrix `json:"routes"`
}

type RoutingCell struct {
	ModelRefs []string `json:"modelRefs"`
}

type RoutingDifficulty struct {
	Simple  RoutingCell `json:"simple"`
	Complex RoutingCell `json:"complex"`
}

type RoutingMatrix struct {
	General       RoutingDifficulty `json:"general"`
	Code          RoutingDifficulty `json:"code"`
	Translation   RoutingDifficulty `json:"translation"`
	Summarization RoutingDifficulty `json:"summarization"`
	Reasoning     RoutingDifficulty `json:"reasoning"`
}

func (m RoutingMatrix) Cells() []RoutingCell {
	return []RoutingCell{
		m.General.Simple, m.General.Complex,
		m.Code.Simple, m.Code.Complex,
		m.Translation.Simple, m.Translation.Complex,
		m.Summarization.Simple, m.Summarization.Complex,
		m.Reasoning.Simple, m.Reasoning.Complex,
	}
}

type FallbackPolicy struct {
	Enabled        bool     `json:"enabled"`
	RouteIDs       []string `json:"routeIds"`
	MaxAttempts    int      `json:"maxAttempts"`
	AllowedReasons []string `json:"allowedReasons"`
}

type ProviderTokenRatePolicy struct {
	Providers []ProviderTokenWindow `json:"providers"`
}

type ProviderTokenWindow struct {
	ProviderID    string `json:"providerId"`
	LimitTokens   int64  `json:"limitTokens"`
	WindowSeconds int    `json:"windowSeconds"`
}

type CachePolicy struct {
	Strategy          string `json:"strategy"`
	Enabled           bool   `json:"enabled"`
	TTLSeconds        int    `json:"ttlSeconds"`
	MaxEntriesPerUser int    `json:"maxEntriesPerUser"`
	KeySetID          string `json:"keySetId"`
}

type SafetyPolicy struct {
	Enabled      bool             `json:"enabled"`
	PolicyDigest string           `json:"policyDigest"`
	DetectorSet  []SafetyDetector `json:"detectorSet"`
}

type SafetyDetector struct {
	DetectorType string `json:"detectorType"`
	Action       string `json:"action"`
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
	pricingByRoute := make(map[string]PriceRoute, len(snapshot.Pricing.Routes))
	for index, route := range snapshot.Pricing.Routes {
		if route.CacheReadInputMicroUSDPerMillionTokens != nil &&
			*route.CacheReadInputMicroUSDPerMillionTokens > route.InputMicroUSDPerMillionTokens {
			return Snapshot{}, fmt.Errorf(
				"validate tenant chat runtime snapshot: pricing.routes[%d] cache-read input price exceeds regular input price",
				index,
			)
		}
		if route.PricingStatus == "unavailable" &&
			(route.PricingSource != "unavailable" ||
				route.InputMicroUSDPerMillionTokens != 0 ||
				route.OutputMicroUSDPerMillionTokens != 0 ||
				(route.CacheReadInputMicroUSDPerMillionTokens != nil && *route.CacheReadInputMicroUSDPerMillionTokens != 0)) {
			return Snapshot{}, fmt.Errorf(
				"validate tenant chat runtime snapshot: pricing.routes[%d] unavailable pricing must have zero monetary rates",
				index,
			)
		}
		pricingByRoute[route.RouteID] = route
	}
	providerPolicies := make(map[string]struct{}, len(snapshot.Policies.ProviderTokenRate.Providers))
	for index, policy := range snapshot.Policies.ProviderTokenRate.Providers {
		if _, exists := providerPolicies[policy.ProviderID]; exists {
			return Snapshot{}, fmt.Errorf("validate tenant chat runtime snapshot: duplicate provider token policy at index %d", index)
		}
		providerPolicies[policy.ProviderID] = struct{}{}
	}
	routesByModelRef := make(map[string]RuntimeRoute, len(snapshot.Policies.Routing.Routes))
	for index, route := range snapshot.Policies.Routing.Routes {
		if route.Enabled {
			if _, exists := providerPolicies[route.ProviderID]; !exists {
				return Snapshot{}, fmt.Errorf("validate tenant chat runtime snapshot: routing route %d lacks provider token policy", index)
			}
		}
		price, priced := pricingByRoute[route.RouteID]
		if !priced || price.ProviderID != route.ProviderID || price.ModelKey != route.ModelKey {
			return Snapshot{}, fmt.Errorf("validate tenant chat runtime snapshot: routing route %d lacks matching pricing provenance", index)
		}
		if snapshot.Policies.Routing.Policy != nil {
			if route.ModelRef == "" {
				return Snapshot{}, fmt.Errorf("validate tenant chat runtime snapshot: routing route %d lacks modelRef", index)
			}
			if _, exists := routesByModelRef[route.ModelRef]; exists {
				return Snapshot{}, fmt.Errorf("validate tenant chat runtime snapshot: duplicate routing modelRef at index %d", index)
			}
			if price.PricingStatus == "" || price.PricingSource == "" {
				return Snapshot{}, fmt.Errorf("validate tenant chat runtime snapshot: routing route %d lacks explicit pricing status", index)
			}
			routesByModelRef[route.ModelRef] = route
		}
	}
	if snapshot.Policies.Routing.Policy != nil {
		manualRoute, exists := routesByModelRef[snapshot.Policies.Routing.ManualModelRef]
		if !exists || !manualRoute.Enabled {
			return Snapshot{}, fmt.Errorf("validate tenant chat runtime snapshot: manualModelRef must reference an enabled route")
		}
		for cellIndex, cell := range snapshot.Policies.Routing.Policy.Routes.Cells() {
			for _, modelRef := range cell.ModelRefs {
				route, exists := routesByModelRef[modelRef]
				if !exists || !route.Enabled {
					return Snapshot{}, fmt.Errorf("validate tenant chat runtime snapshot: routing cell %d references an unavailable modelRef", cellIndex)
				}
			}
		}
	}
	detectors := make(map[string]struct{}, len(snapshot.Policies.Safety.DetectorSet))
	for index, detector := range snapshot.Policies.Safety.DetectorSet {
		if _, exists := detectors[detector.DetectorType]; exists {
			return Snapshot{}, fmt.Errorf("validate tenant chat runtime snapshot: duplicate safety detector at index %d", index)
		}
		detectors[detector.DetectorType] = struct{}{}
		if masking.IsMandatoryDetector(detector.DetectorType) && detector.Action == string(masking.PolicyActionAllow) {
			return Snapshot{}, fmt.Errorf("validate tenant chat runtime snapshot: mandatory detector %d cannot allow", index)
		}
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
