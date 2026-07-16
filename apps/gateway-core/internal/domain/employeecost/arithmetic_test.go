package employeecost

import (
	"errors"
	"math"
	"testing"
)

func TestCeilMulDiv(t *testing.T) {
	tests := []struct {
		name    string
		a       int64
		b       int64
		divisor int64
		want    int64
		wantErr error
	}{
		{name: "zero", a: 0, b: math.MaxInt64, divisor: 1, want: 0},
		{name: "exact", a: 25, b: 80, divisor: 100, want: 20},
		{name: "ceiling", a: 101, b: 80, divisor: 100, want: 81},
		{name: "wide product with bounded quotient", a: math.MaxInt64, b: math.MaxInt64, divisor: math.MaxInt64, want: math.MaxInt64},
		{name: "negative multiplicand", a: -1, b: 1, divisor: 1, wantErr: ErrInvalidArithmeticInput},
		{name: "zero divisor", a: 1, b: 1, divisor: 0, wantErr: ErrInvalidArithmeticInput},
		{name: "result overflow", a: math.MaxInt64, b: math.MaxInt64, divisor: 1, wantErr: ErrArithmeticOverflow},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := CeilMulDiv(tt.a, tt.b, tt.divisor)
			if !errors.Is(err, tt.wantErr) {
				t.Fatalf("CeilMulDiv() error = %v, want %v", err, tt.wantErr)
			}
			if got != tt.want {
				t.Fatalf("CeilMulDiv() = %d, want %d", got, tt.want)
			}
		})
	}
}

func TestExposureChecksAmountsAndOverflow(t *testing.T) {
	got, err := Exposure(PeriodBalance{
		ConfirmedCostMicroUSD:   10,
		ReservedCostMicroUSD:    20,
		UnconfirmedCostMicroUSD: 30,
	})
	if err != nil || got != 60 {
		t.Fatalf("Exposure() = %d, %v, want 60, nil", got, err)
	}

	if _, err := Exposure(PeriodBalance{ConfirmedCostMicroUSD: -1}); !errors.Is(err, ErrInvalidArithmeticInput) {
		t.Fatalf("negative exposure error = %v, want ErrInvalidArithmeticInput", err)
	}
	if _, err := Exposure(PeriodBalance{ConfirmedCostMicroUSD: math.MaxInt64, ReservedCostMicroUSD: 1}); !errors.Is(err, ErrArithmeticOverflow) {
		t.Fatalf("overflow exposure error = %v, want ErrArithmeticOverflow", err)
	}
}

func TestWarningThresholdUsesCeiling(t *testing.T) {
	got, err := WarningThreshold(101, 80)
	if err != nil || got != 81 {
		t.Fatalf("WarningThreshold() = %d, %v, want 81, nil", got, err)
	}
	if _, err := WarningThreshold(100, 100); !errors.Is(err, ErrInvalidArithmeticInput) {
		t.Fatalf("invalid threshold error = %v, want ErrInvalidArithmeticInput", err)
	}
}

func TestPricingPinCostsEachUsageComponentWithCeiling(t *testing.T) {
	pin := validPricingPin()
	pin.EstimatedInputTokens = 1
	pin.MaxOutputTokens = 1
	pin.InputMicroUSDPerMillion = 1
	pin.OutputMicroUSDPerMillion = 1

	estimated, err := pin.EstimatedCostMicroUSD()
	if err != nil || estimated != 2 {
		t.Fatalf("EstimatedCostMicroUSD() = %d, %v, want 2, nil", estimated, err)
	}
	confirmed, err := pin.ConfirmedCostMicroUSD(1_000_000, 500_000, 0)
	if err != nil || confirmed != 2 {
		t.Fatalf("ConfirmedCostMicroUSD() = %d, %v, want 2, nil", confirmed, err)
	}
}

func TestPricingPinConfirmedCostUsesPinnedProviderCacheReadPrice(t *testing.T) {
	cacheReadPrice := int64(500)
	pin := validPricingPin()
	pin.InputMicroUSDPerMillion = 1_000
	pin.OutputMicroUSDPerMillion = 2_000
	pin.CacheReadInputMicroUSDPerMillion = &cacheReadPrice

	confirmed, err := pin.ConfirmedCostMicroUSD(1_000_000, 500_000, 400_000)
	if err != nil || confirmed != 1_800 {
		t.Fatalf("ConfirmedCostMicroUSD() = %d, %v, want 1800, nil", confirmed, err)
	}
	if _, err := pin.ConfirmedCostMicroUSD(10, 0, 11); !errors.Is(err, ErrInvalidArithmeticInput) {
		t.Fatalf("cache-read token validation error = %v, want ErrInvalidArithmeticInput", err)
	}

	tooExpensive := int64(1_001)
	pin.CacheReadInputMicroUSDPerMillion = &tooExpensive
	if err := pin.Validate(); !errors.Is(err, ErrInvalidPricingPin) {
		t.Fatalf("cache-read price validation error = %v, want ErrInvalidPricingPin", err)
	}
}

func TestCalculateUsageCostRejectsOverflow(t *testing.T) {
	if _, err := CalculateUsageCost(math.MaxInt64, 0, math.MaxInt64, 0); !errors.Is(err, ErrArithmeticOverflow) {
		t.Fatalf("CalculateUsageCost() error = %v, want ErrArithmeticOverflow", err)
	}
}

func validPricingPin() PricingPin {
	return PricingPin{
		RuleID:                   "rule-1",
		Version:                  "version-1",
		Currency:                 CurrencyUSD,
		InputMicroUSDPerMillion:  1_000,
		OutputMicroUSDPerMillion: 2_000,
		EstimateVersion:          "utf8_message_bytes_v1",
		EstimatedInputTokens:     100,
		MaxOutputTokens:          200,
	}
}
