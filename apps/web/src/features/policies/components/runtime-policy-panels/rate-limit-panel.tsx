import { Switch } from "@/components/ui/switch";
import {
  getRateLimitWindowSeconds,
  type RuntimePolicyDraftValues
} from "@/lib/control-plane/runtime-policy-types";

import type {
  RuntimePolicyDraftValuesSetter,
  RuntimePolicyEditorText
} from "../runtime-policy-editor-types";
import { PolicyNumberField } from "./shared";

export type RateLimitPolicyPanelProps = {
  draftValues: RuntimePolicyDraftValues;
  onDraftValuesChange: RuntimePolicyDraftValuesSetter;
  text: RuntimePolicyEditorText;
};

export function RateLimitPolicyPanel({
  draftValues,
  onDraftValuesChange,
  text
}: RateLimitPolicyPanelProps) {
  return (
    <article className="console-panel policy-editor-panel rate-limit-policy-panel">
      <div className="panel-heading rate-limit-policy-heading">
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
      <div className="rate-limit-policy-content">
        <section
          className="rate-limit-enable-card"
          data-enabled={draftValues.rateLimitEnabled}
        >
          <div className="rate-limit-enable-copy">
            <span aria-hidden="true" className="rate-limit-enable-icon">
              i
            </span>
            <div>
              <strong>{text.rateLimitEnabledTitle}</strong>
            </div>
          </div>
          <div className="rate-limit-enable-control">
            <span>
              {draftValues.rateLimitEnabled ? text.enabled : text.disabled}
            </span>
            <Switch
              aria-label={text.rateLimitEnabledTitle}
              checked={draftValues.rateLimitEnabled}
              id="runtime-policy-rate-limit-enabled"
              onCheckedChange={(checked) =>
                onDraftValuesChange((current) => ({
                  ...current,
                  rateLimitEnabled: checked
                }))
              }
            />
          </div>
        </section>

        <div className="rate-limit-setting-list">
          <section className="rate-limit-setting-card">
            <header>
              <h4>{text.refillRate}</h4>
            </header>
            <div className="rate-limit-setting-body">
              <div className="rate-limit-setting-input-row">
                <PolicyNumberField
                  className="rate-limit-setting-control"
                  label={text.refillRate}
                  labelClassName="sr-only"
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
                <span>{text.requestsPerSecondUnit}</span>
              </div>
            </div>
          </section>

          <section className="rate-limit-setting-card">
            <header>
              <h4>{text.maxBucketTokens}</h4>
            </header>
            <div className="rate-limit-setting-body">
              <div className="rate-limit-setting-input-row">
                <PolicyNumberField
                  className="rate-limit-setting-control"
                  label={text.maxBucketTokens}
                  labelClassName="sr-only"
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
                <span>{text.requestsUnit}</span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}
