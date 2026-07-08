import type { Dispatch, SetStateAction } from "react";

import { Switch } from "@/components/ui/switch";
import type { RuntimePolicyDraftValues } from "@/lib/control-plane/runtime-policy-types";

import { PolicyNumberField } from "../runtime-policy-editor-controls";
import type { RuntimePolicyEditorText } from "../runtime-policy-editor";

type CachePolicyPanelProps = {
  draftValues: RuntimePolicyDraftValues;
  onDraftValuesChange: Dispatch<SetStateAction<RuntimePolicyDraftValues>>;
  text: RuntimePolicyEditorText;
};

export function CachePolicyPanel({
  draftValues,
  onDraftValuesChange,
  text
}: CachePolicyPanelProps) {
  return (
    <>
      <article className="console-panel policy-editor-panel">
        <div className="panel-heading">
          <h3>{text.cache}</h3>
        </div>
        <label className="policy-toggle-row">
          <Switch
            checked={draftValues.cacheEnabled}
            onCheckedChange={(checked) =>
              onDraftValuesChange((current) => ({
                ...current,
                cacheEnabled: checked
              }))
            }
          />
          <span>{text.cacheEnabled}</span>
        </label>
        <PolicyNumberField
          label={text.cacheTtl}
          max={86400}
          min={1}
          onChange={(value) =>
            onDraftValuesChange((current) => ({
              ...current,
              cacheTtlSeconds: value
            }))
          }
          value={draftValues.cacheTtlSeconds}
        />
      </article>

      <article className="console-panel policy-editor-panel">
        <div className="panel-heading">
          <h3>{text.semanticCache}</h3>
        </div>
        <label aria-disabled="true" className="policy-toggle-row">
          <Switch checked={draftValues.cacheEnabled} disabled readOnly />
          <span>
            {draftValues.cacheEnabled
              ? text.semanticCacheEvidenceOnly
              : text.semanticCacheDisabled}
          </span>
        </label>
        <dl className="policy-summary-list">
          <div>
            <dt>{text.mode}</dt>
            <dd>
              {draftValues.cacheEnabled
                ? text.semanticCacheEvidenceOnly
                : text.semanticCacheDisabled}
            </dd>
          </div>
        </dl>
        <p className="project-muted">{text.semanticCacheNote}</p>
      </article>
    </>
  );
}
