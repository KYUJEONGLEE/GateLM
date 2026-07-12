package postgres

import (
	"crypto/rand"
	"errors"
	"fmt"
	"math"
	"time"

	"gatelm/apps/gateway-core/internal/domain/tenantchat"
	tenantruntime "gatelm/apps/gateway-core/internal/domain/tenantchat/runtime"
)

func selectRoute(snapshot tenantruntime.Snapshot, requestedTier, quotaState, budgetState string) (tenantchat.SelectedRoute, error) {
	for _, tier := range routeOrder(requestedTier) {
		if tier == "high_quality" && (quotaState == "economy" || budgetState == "economy") {
			continue
		}
		for _, route := range snapshot.Policies.Routing.Routes {
			if !route.Enabled || route.Tier != tier {
				continue
			}
			for _, price := range snapshot.Pricing.Routes {
				if price.RouteID != route.RouteID || price.ProviderID != route.ProviderID || price.ModelKey != route.ModelKey {
					continue
				}
				return tenantchat.SelectedRoute{
					RouteID: route.RouteID, Tier: route.Tier, ProviderID: route.ProviderID, ModelKey: route.ModelKey,
					PricingVersion:                         snapshot.Pricing.Version,
					InputMicroUSDPerMillionTokens:          price.InputMicroUSDPerMillionTokens,
					OutputMicroUSDPerMillionTokens:         price.OutputMicroUSDPerMillionTokens,
					CacheReadInputMicroUSDPerMillionTokens: price.CacheReadInputMicroUSDPerMillionTokens,
				}, nil
			}
		}
	}
	return tenantchat.SelectedRoute{}, tenantchat.ErrNoEligibleRoute
}

func routeOrder(requested string) []string {
	switch requested {
	case "high_quality":
		return []string{"high_quality", "standard", "economy"}
	case "standard":
		return []string{"standard", "economy"}
	case "economy":
		return []string{"economy"}
	default:
		return []string{"standard", "economy", "high_quality"}
	}
}

func reservationCost(inputTokens, outputTokens, inputPrice, outputPrice int64) (int64, error) {
	inputCost, err := ceilMulDiv(inputTokens, inputPrice, 1_000_000)
	if err != nil {
		return 0, err
	}
	outputCost, err := ceilMulDiv(outputTokens, outputPrice, 1_000_000)
	if err != nil || inputCost > math.MaxInt64-outputCost {
		return 0, errors.New("reservation cost overflow")
	}
	return inputCost + outputCost, nil
}

func ceilMulDiv(value, multiplier, divisor int64) (int64, error) {
	if value < 0 || multiplier < 0 || divisor <= 0 {
		return 0, errors.New("invalid pricing values")
	}
	quotient := value / divisor
	remainder := value % divisor
	if quotient != 0 && multiplier > math.MaxInt64/quotient {
		return 0, errors.New("pricing overflow")
	}
	result := quotient * multiplier
	if remainder == 0 || multiplier == 0 {
		return result, nil
	}
	if remainder > math.MaxInt64/multiplier {
		return 0, errors.New("pricing overflow")
	}
	fraction := remainder * multiplier
	if fraction > math.MaxInt64-(divisor-1) {
		return 0, errors.New("pricing overflow")
	}
	ceiling := (fraction + divisor - 1) / divisor
	if result > math.MaxInt64-ceiling {
		return 0, errors.New("pricing overflow")
	}
	return result + ceiling, nil
}

func calendarMonth(now time.Time, timezone string) (time.Time, time.Time, error) {
	location, err := time.LoadLocation(timezone)
	if err != nil {
		return time.Time{}, time.Time{}, err
	}
	local := now.In(location)
	start := time.Date(local.Year(), local.Month(), 1, 0, 0, 0, 0, location)
	return start.UTC(), start.AddDate(0, 1, 0).UTC(), nil
}

func thresholds(limit int64, warningPercent, economyPercent, hardStopPercent int) (int64, int64, int64) {
	if limit == 0 {
		return 0, 0, 0
	}
	return percentCeil(limit, warningPercent), percentCeil(limit, economyPercent), percentCeil(limit, hardStopPercent)
}

func percentCeil(value int64, percent int) int64 {
	return (value/100)*int64(percent) + ((value%100)*int64(percent)+99)/100
}

func usageState(value, warning, economy, hardStop int64) string {
	switch {
	case value >= hardStop:
		return "blocked"
	case value >= economy:
		return "economy"
	case value >= warning:
		return "warning"
	default:
		return "normal"
	}
}

func newUUID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", fmt.Errorf("generate tenant chat usage id: %w", err)
	}
	value[6] = (value[6] & 0x0f) | 0x40
	value[8] = (value[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16],
	), nil
}
