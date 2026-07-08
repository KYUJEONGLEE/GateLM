import type { Dispatch, SetStateAction } from "react";

import { Switch } from "@/components/ui/switch";
import {
  getRateLimitWindowSeconds,
  type RuntimePolicyDraftValues
} from "@/lib/control-plane/runtime-policy-types";

import { PolicyNumberField } from "../runtime-policy-editor-controls";
import type { RuntimePolicyEditorText } from "../runtime-policy-editor";

type RateLimitPolicyPanelProps = {
  draftValues: RuntimePolicyDraftValues;
  onDraftValuesChange: Dispatch<SetStateAction<RuntimePolicyDraftValues>>;
  text: RuntimePolicyEditorText;
};

export function RateLimitPolicyPanel({
  draftValues,
  onDraftValuesChange,
  text
}: RateLimitPolicyPanelProps) {
  return (
    <article className="console-panel policy-editor-panel">
      <div className="panel-heading">
        <div className="policy-heading-with-info">
          <h3>{text.rateLimit}</h3>
          <span className="policy-info-tooltip">
            <button
              aria-label={text.rateLimitInfo}
              className="policy-info-trigger"
              title={text.rateLimitInfo}
              type="button"
            >
              i
            </button>
            <span className="policy-info-content" role="tooltip">
              {text.rateLimitInfo}
            </span>
          </span>
        </div>
      </div>
      <label className="policy-toggle-row">
        <Switch
          checked={draftValues.rateLimitEnabled}
          onCheckedChange={(checked) =>
            onDraftValuesChange((current) => ({
              ...current,
              rateLimitEnabled: checked
            }))
          }
        />
        <span>{text.enabled}</span>
      </label>
      <PolicyNumberField
        label={text.refillRate}
        max={100000}
        min={1}
        onChange={(value) =>
          onDraftValuesChange((current) => ({
            ...current,
            rateLimitRefillTokensPerSecond: value,
            rateLimitWindowSeconds: getRateLimitWindowSeconds(
              current.rateLimitLimit,
              value
            )
          }))
        }
        value={draftValues.rateLimitRefillTokensPerSecond}
      />
      <PolicyNumberField
        label={text.maxBucketTokens}
        max={100000}
        min={1}
        onChange={(value) =>
          onDraftValuesChange((current) => ({
            ...current,
            rateLimitLimit: value,
            rateLimitWindowSeconds: getRateLimitWindowSeconds(
              value,
              current.rateLimitRefillTokensPerSecond
            )
          }))
        }
        value={draftValues.rateLimitLimit}
      />
    </article>
  );
}
