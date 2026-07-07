import { NextResponse } from "next/server";
import {
  createDashboardAiInsights,
  normalizeAiInsightsRequest
} from "@/lib/dashboard/ai-insights-service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const insightRequest = normalizeAiInsightsRequest(body);

  if (!insightRequest) {
    return NextResponse.json(
      { error: "Invalid AI insights request" },
      { status: 400 }
    );
  }

  const insight = await createDashboardAiInsights(insightRequest);

  return NextResponse.json(insight);
}
