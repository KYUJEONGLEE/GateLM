import { NextResponse } from "next/server";
import {
  createApplication,
  updateApplication
} from "@/lib/control-plane/applications-client";
import type {
  ApplicationBudgetLimitMode,
  ApplicationFormValues,
  ApplicationStatus,
  ApplicationUpdateValues
} from "@/lib/control-plane/applications-types";

type RequestPayload = {
  action?: unknown;
  values?: unknown;
};

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as RequestPayload;

  if (payload.action !== "create" && payload.action !== "update") {
    return NextResponse.json({ error: "Unknown application action." }, { status: 400 });
  }

  const result =
    payload.action === "create"
      ? isApplicationFormValues(payload.values)
        ? await createApplication(payload.values)
        : null
      : isApplicationUpdateValues(payload.values)
        ? await updateApplication(payload.values)
        : null;

  if (!result) {
    return NextResponse.json({ error: "Invalid application payload." }, { status: 400 });
  }

  if (!result.ok) {
    return NextResponse.json(
      {
        error: result.error,
        status: result.status
      },
      { status: result.status > 0 ? result.status : 502 }
    );
  }

  return NextResponse.json({
    application: result.data,
    policyError: "policyError" in result ? result.policyError : undefined,
    status: result.status
  });
}

function isApplicationFormValues(value: unknown): value is ApplicationFormValues {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ApplicationFormValues>;

  return (
    typeof record.name === "string"
    && typeof record.description === "string"
    && isApplicationBudgetLimitMode(record.budgetLimitMode)
    && isBudgetNumber(record.budgetLimitUsd, 100000000)
    && isBudgetNumber(record.budgetLimitPercent, 100)
    && (record.projectId === undefined || typeof record.projectId === "string")
    && (record.selectedModelKey === undefined || typeof record.selectedModelKey === "string")
  );
}

function isApplicationUpdateValues(value: unknown): value is ApplicationUpdateValues {
  if (!isApplicationFormValues(value)) {
    return false;
  }

  const record = value as Partial<ApplicationUpdateValues>;

  return typeof record.applicationId === "string" && isApplicationStatus(record.status);
}

function isApplicationStatus(value: unknown): value is ApplicationStatus {
  return value === "ACTIVE" || value === "ARCHIVED" || value === "DISABLED";
}

function isApplicationBudgetLimitMode(
  value: unknown
): value is ApplicationBudgetLimitMode {
  return value === "FIXED" || value === "PERCENT";
}

function isBudgetNumber(value: unknown, max: number) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max
  );
}
