"use client";

import { useEffect, useMemo, useState } from "react";
import {
  formatBudgetScopeDisplayName,
  formatBudgetScopeTypeDisplayName
} from "@/lib/formatting/display-identifiers";
import type { RequestLogBudgetScopeOption, RequestLogFilterState } from "./request-log-table";

type RequestLogScopeFilterControlsProps = {
  allBudgetScopeIds: string;
  allBudgetScopeTypes: string;
  budgetScopeId: string;
  budgetScopeIdLabel: string;
  budgetScopeOptions: RequestLogBudgetScopeOption[];
  budgetScopeType: RequestLogFilterState["budgetScopeType"];
  budgetScopeTypeLabel: string;
  scopeTypeOptions: readonly RequestLogBudgetScopeOption["budgetScopeType"][];
};

export function RequestLogScopeFilterControls({
  allBudgetScopeIds,
  allBudgetScopeTypes,
  budgetScopeId,
  budgetScopeIdLabel,
  budgetScopeOptions,
  budgetScopeType,
  budgetScopeTypeLabel,
  scopeTypeOptions
}: RequestLogScopeFilterControlsProps) {
  const [selectedScopeType, setSelectedScopeType] =
    useState<RequestLogFilterState["budgetScopeType"]>(budgetScopeType);
  const [selectedScopeId, setSelectedScopeId] = useState(budgetScopeId);

  useEffect(() => {
    setSelectedScopeType(budgetScopeType);
  }, [budgetScopeType]);

  useEffect(() => {
    setSelectedScopeId(budgetScopeId);
  }, [budgetScopeId]);

  const visibleScopeOptions = useMemo(
    () =>
      budgetScopeOptions.filter(
        (scope) => !selectedScopeType || scope.budgetScopeType === selectedScopeType
      ),
    [budgetScopeOptions, selectedScopeType]
  );

  return (
    <>
      <label className="request-log-filter-control">
        <span>{budgetScopeTypeLabel}</span>
        <select
          name="budgetScopeType"
          onChange={(event) => {
            const nextScopeType = event.target.value as RequestLogFilterState["budgetScopeType"];
            setSelectedScopeType(nextScopeType);
            setSelectedScopeId("");
          }}
          value={selectedScopeType}
        >
          <option value="">{allBudgetScopeTypes}</option>
          {scopeTypeOptions.map((scopeType) => (
            <option key={scopeType} value={scopeType}>
              {formatBudgetScopeTypeDisplayName(scopeType)}
            </option>
          ))}
        </select>
      </label>

      <label className="request-log-filter-control request-log-filter-control-wide">
        <span>{budgetScopeIdLabel}</span>
        <select
          name="budgetScopeId"
          onChange={(event) => setSelectedScopeId(event.target.value)}
          value={selectedScopeId}
        >
          <option value="">{allBudgetScopeIds}</option>
          {visibleScopeOptions.map((scope) => (
            <option key={`${scope.budgetScopeType}:${scope.budgetScopeId}`} value={scope.budgetScopeId}>
              {formatBudgetScopeOption(scope)}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}

function formatBudgetScopeOption(scope: RequestLogBudgetScopeOption) {
  return formatBudgetScopeDisplayName(scope);
}
