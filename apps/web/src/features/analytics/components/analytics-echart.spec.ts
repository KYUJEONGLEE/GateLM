import { expect, test } from "@playwright/test";
import { formatAnalyticsRps } from "@/features/analytics/components/analytics-echart";

test("희소한 정적 요청의 RPS를 0으로 반올림하지 않는다", () => {
  expect(formatAnalyticsRps(1 / 60)).toBe("0.0167");
  expect(formatAnalyticsRps(1 / 300)).toBe("0.00333");
  expect(formatAnalyticsRps(1 / 3_600)).toBe("0.000278");
});

test("RPS 0과 큰 값을 간결하게 표시한다", () => {
  expect(formatAnalyticsRps(0)).toBe("0");
  expect(formatAnalyticsRps(14.4)).toBe("14.4");
  expect(formatAnalyticsRps(1_250)).toBe("1.3K");
});
