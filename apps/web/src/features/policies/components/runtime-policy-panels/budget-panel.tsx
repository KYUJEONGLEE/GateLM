import type { CSSProperties } from "react";

import { Switch } from "@/components/ui/switch";
import type { RuntimePolicyDraftValues } from "@/lib/control-plane/runtime-policy-types";

import type {
  RuntimePolicyDraftValuesSetter,
  RuntimePolicyEditorText
} from "../runtime-policy-editor-types";

export type BudgetPolicyPanelProps = {
  draftValues: RuntimePolicyDraftValues;
  onDraftValuesChange: RuntimePolicyDraftValuesSetter;
  projectPanel?: boolean;
  text: RuntimePolicyEditorText;
};

export function BudgetPolicyPanel({
  draftValues,
  onDraftValuesChange,
  projectPanel = false,
  text
}: BudgetPolicyPanelProps) {
  return (
    <article
      className={
        projectPanel
          ? "console-panel policy-editor-panel project-policy-budget-panel"
          : "console-panel policy-editor-panel"
      }
    >
      <div className="panel-heading">
        <h3>{text.budget}</h3>
      </div>
      <div className="budget-policy-card" data-enabled={draftValues.budgetEnabled}>
        <div className="budget-policy-card-header">
          <div>
            <strong>{text.budgetPolicyEnabled}</strong>
            <p>{text.budgetPolicyHint}</p>
          </div>
          <Switch
            checked={draftValues.budgetEnabled}
            onCheckedChange={(checked) =>
              onDraftValuesChange((current) => ({
                ...current,
                budgetEnabled: checked,
                budgetEnforcementMode: checked
                  ? current.budgetEnforcementMode === "disabled"
                    ? "warn"
                    : current.budgetEnforcementMode
                  : "disabled"
              }))
            }
          />
        </div>

        <div className="budget-policy-card-body">
          <div className="budget-policy-control">
            <span>{text.budgetEnforcement}</span>
            <div
              aria-disabled={!draftValues.budgetEnabled}
              className="budget-enforcement-options"
            >
              {(["disabled", "warn", "block"] as const).map((mode) => (
                <button
                  data-active={draftValues.budgetEnforcementMode === mode}
                  data-mode={mode}
                  disabled={!draftValues.budgetEnabled && mode !== "disabled"}
                  key={mode}
                  onClick={() =>
                    onDraftValuesChange((current) => ({
                      ...current,
                      budgetEnabled: mode !== "disabled",
                      budgetEnforcementMode: mode
                    }))
                  }
                  type="button"
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <label className="budget-warning-control">
            <span>
              <span>{text.budgetWarning}</span>
              <span className="budget-warning-value">
                <input
                  aria-label={`${text.budgetWarning} (%)`}
                  disabled={!draftValues.budgetEnabled}
                  inputMode="numeric"
                  max={100}
                  min={0}
                  onChange={(event) => {
                    const value = Number(event.target.value);

                    onDraftValuesChange((current) => ({
                      ...current,
                      budgetWarningThresholdPercent: Number.isFinite(value)
                        ? Math.min(100, Math.max(0, Math.trunc(value)))
                        : 0
                    }));
                  }}
                  onFocus={(event) => event.currentTarget.select()}
                  onKeyDown={(event) => {
                    if (["e", "E", "+", "-", ".", ","].includes(event.key)) {
                      event.preventDefault();
                    }
                  }}
                  step={1}
                  type="number"
                  value={draftValues.budgetWarningThresholdPercent}
                />
                <span aria-hidden="true">%</span>
              </span>
            </span>
            <input
              disabled={!draftValues.budgetEnabled}
              max={100}
              min={0}
              onChange={(event) =>
                onDraftValuesChange((current) => ({
                  ...current,
                  budgetWarningThresholdPercent: Number(event.target.value)
                }))
              }
              style={{
                "--budget-threshold": `${draftValues.budgetWarningThresholdPercent}%`
              } as CSSProperties}
              type="range"
              value={draftValues.budgetWarningThresholdPercent}
            />
            <span className="budget-warning-range-labels">
              <span>0%</span>
              <span>100%</span>
            </span>
          </label>
        </div>
      </div>
    </article>
  );
}
