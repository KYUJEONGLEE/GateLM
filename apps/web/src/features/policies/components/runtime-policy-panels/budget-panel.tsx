import type { Dispatch, SetStateAction } from "react";

import { Switch } from "@/components/ui/switch";
import type { RuntimePolicyDraftValues } from "@/lib/control-plane/runtime-policy-types";

import type { RuntimePolicyEditorText } from "../runtime-policy-editor-types";
import { PolicyNumberField } from "./shared";

export type BudgetPolicyPanelProps = {
  draftValues: RuntimePolicyDraftValues;
  onDraftValuesChange: Dispatch<SetStateAction<RuntimePolicyDraftValues>>;
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
      <label className="policy-toggle-row">
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
        <span>{text.enabled}</span>
      </label>
      <label className="policy-field">
        <span>{text.budgetEnforcement}</span>
        <select
          disabled={!draftValues.budgetEnabled}
          onChange={(event) =>
            onDraftValuesChange((current) => ({
              ...current,
              budgetEnforcementMode:
                event.target.value === "block" || event.target.value === "warn"
                  ? event.target.value
                  : "disabled"
            }))
          }
          value={draftValues.budgetEnforcementMode}
        >
          <option value="warn">warn</option>
          <option value="block">block</option>
          <option value="disabled">disabled</option>
        </select>
      </label>
      <PolicyNumberField
        label={text.budgetWarning}
        max={100}
        min={0}
        onChange={(value) =>
          onDraftValuesChange((current) => ({
            ...current,
            budgetWarningThresholdPercent: value
          }))
        }
        value={draftValues.budgetWarningThresholdPercent}
      />
    </article>
  );
}
