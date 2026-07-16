package employeecost

import (
	"errors"
	"math"
	"math/bits"
)

var (
	ErrInvalidArithmeticInput = errors.New("employee cost arithmetic input must be non-negative")
	ErrArithmeticOverflow     = errors.New("employee cost arithmetic overflow")
)

// CeilMulDiv returns ceil(multiplicand * multiplier / divisor) without
// overflowing an intermediate int64 product.
func CeilMulDiv(multiplicand, multiplier, divisor int64) (int64, error) {
	if multiplicand < 0 || multiplier < 0 || divisor <= 0 {
		return 0, ErrInvalidArithmeticInput
	}
	if multiplicand == 0 || multiplier == 0 {
		return 0, nil
	}

	high, low := bits.Mul64(uint64(multiplicand), uint64(multiplier))
	unsignedDivisor := uint64(divisor)
	if high >= unsignedDivisor {
		return 0, ErrArithmeticOverflow
	}

	quotient, remainder := bits.Div64(high, low, unsignedDivisor)
	if quotient > math.MaxInt64 {
		return 0, ErrArithmeticOverflow
	}
	if remainder != 0 {
		if quotient == math.MaxInt64 {
			return 0, ErrArithmeticOverflow
		}
		quotient++
	}
	return int64(quotient), nil
}

func addNonNegative(values ...int64) (int64, error) {
	total := int64(0)
	for _, value := range values {
		if value < 0 {
			return 0, ErrInvalidArithmeticInput
		}
		if value > math.MaxInt64-total {
			return 0, ErrArithmeticOverflow
		}
		total += value
	}
	return total, nil
}

func Exposure(balance PeriodBalance) (int64, error) {
	return addNonNegative(
		balance.ConfirmedCostMicroUSD,
		balance.ReservedCostMicroUSD,
		balance.UnconfirmedCostMicroUSD,
	)
}

func WarningThreshold(limitMicroUSD int64, warningThresholdPercent int) (int64, error) {
	if limitMicroUSD <= 0 || warningThresholdPercent < 1 || warningThresholdPercent > 99 {
		return 0, ErrInvalidArithmeticInput
	}
	return CeilMulDiv(limitMicroUSD, int64(warningThresholdPercent), 100)
}

func CalculateUsageCost(inputTokens, outputTokens, inputMicroUSDPerMillion, outputMicroUSDPerMillion int64) (int64, error) {
	inputCost, err := CeilMulDiv(inputTokens, inputMicroUSDPerMillion, TokensPerPricingUnit)
	if err != nil {
		return 0, err
	}
	outputCost, err := CeilMulDiv(outputTokens, outputMicroUSDPerMillion, TokensPerPricingUnit)
	if err != nil {
		return 0, err
	}
	return addNonNegative(inputCost, outputCost)
}

func (pin PricingPin) EstimatedCostMicroUSD() (int64, error) {
	if err := pin.Validate(); err != nil {
		return 0, err
	}
	return CalculateUsageCost(
		pin.EstimatedInputTokens,
		pin.MaxOutputTokens,
		pin.InputMicroUSDPerMillion,
		pin.OutputMicroUSDPerMillion,
	)
}

func (pin PricingPin) ConfirmedCostMicroUSD(inputTokens, outputTokens, cacheReadInputTokens int64) (int64, error) {
	if err := pin.Validate(); err != nil {
		return 0, err
	}
	if cacheReadInputTokens < 0 || cacheReadInputTokens > inputTokens {
		return 0, ErrInvalidArithmeticInput
	}
	if pin.CacheReadInputMicroUSDPerMillion == nil {
		return CalculateUsageCost(
			inputTokens,
			outputTokens,
			pin.InputMicroUSDPerMillion,
			pin.OutputMicroUSDPerMillion,
		)
	}

	regularInputCost, err := CeilMulDiv(
		inputTokens-cacheReadInputTokens,
		pin.InputMicroUSDPerMillion,
		TokensPerPricingUnit,
	)
	if err != nil {
		return 0, err
	}
	cacheReadInputCost, err := CeilMulDiv(
		cacheReadInputTokens,
		*pin.CacheReadInputMicroUSDPerMillion,
		TokensPerPricingUnit,
	)
	if err != nil {
		return 0, err
	}
	outputCost, err := CeilMulDiv(
		outputTokens,
		pin.OutputMicroUSDPerMillion,
		TokensPerPricingUnit,
	)
	if err != nil {
		return 0, err
	}
	return addNonNegative(regularInputCost, cacheReadInputCost, outputCost)
}
