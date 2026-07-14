package postgres

import "math"

const dashboardHistogramVersion = 1

var dashboardHistogramUpperBoundsMs = [...]float64{
	25,
	50,
	100,
	200,
	300,
	500,
	750,
	1000,
	1500,
	2000,
	3000,
	5000,
	7500,
	10000,
	15000,
	30000,
	60000,
	math.Inf(1),
}

// dashboardHistogramPercentile returns the upper bound of the first histogram
// bucket whose cumulative population reaches the requested percentile. Bucket
// counts are non-cumulative and must use dashboardHistogramVersion.
//
// A percentile that lands in the final +Inf bucket is returned as unavailable.
// Reporting the largest finite bound would understate an actual latency above
// that bound, while infinity cannot be represented in the JSON contract.
func dashboardHistogramPercentile(bucketCounts []int64, percentile float64) *float64 {
	if len(bucketCounts) != len(dashboardHistogramUpperBoundsMs) || percentile <= 0 || percentile > 1 {
		return nil
	}

	var total int64
	for _, count := range bucketCounts {
		if count < 0 {
			return nil
		}
		total += count
	}
	if total == 0 {
		return nil
	}

	target := int64(math.Ceil(float64(total) * percentile))
	var cumulative int64
	for index, count := range bucketCounts {
		cumulative += count
		if cumulative < target {
			continue
		}

		bound := dashboardHistogramUpperBoundsMs[index]
		if math.IsInf(bound, 1) {
			return nil
		}
		return &bound
	}

	return nil
}

func addDashboardHistograms(destination []int64, source []int64) bool {
	if len(destination) != len(dashboardHistogramUpperBoundsMs) || len(source) != len(dashboardHistogramUpperBoundsMs) {
		return false
	}
	for index, count := range source {
		if count < 0 {
			return false
		}
		destination[index] += count
	}
	return true
}
