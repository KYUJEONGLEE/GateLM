export type CostOverTimePoint = {
  bucket: string;
  label: string;
  spendUsd: number;
};

export type CostOverTimeSummary = {
  averageSpendUsd: number;
  bucketInterval?: string;
  expectedBucketCount?: number;
  generatedAt: string;
  period: "hour" | "day";
  points: CostOverTimePoint[];
};
