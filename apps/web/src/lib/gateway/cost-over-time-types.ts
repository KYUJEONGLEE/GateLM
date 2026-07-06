export type CostOverTimePoint = {
  bucket: string;
  label: string;
  spendUsd: number;
};

export type CostOverTimeSummary = {
  averageSpendUsd: number;
  generatedAt: string;
  period: "hour" | "day";
  points: CostOverTimePoint[];
};
