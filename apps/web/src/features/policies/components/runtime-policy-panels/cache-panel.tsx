"use client";

import { ChevronDown, FlaskConical } from "lucide-react";
import { useState } from "react";

import { ExactCacheToggleCard } from "@/features/policies/components/exact-cache-toggle-card";
import type { RuntimePolicyDraftValues } from "@/lib/control-plane/runtime-policy-types";

import type {
  RuntimePolicyDraftValuesSetter,
  RuntimePolicyEditorText
} from "../runtime-policy-editor-types";

export type CachePolicyPanelProps = {
  draftValues: RuntimePolicyDraftValues;
  onDraftValuesChange: RuntimePolicyDraftValuesSetter;
  text: RuntimePolicyEditorText;
};

export type CachePolicyControlsText = Pick<
  RuntimePolicyEditorText,
  | "cacheEnabled"
  | "cacheEnabledHint"
  | "cacheSection"
  | "cacheSettings"
  | "mode"
  | "semanticCache"
  | "semanticCacheDisabled"
  | "semanticCacheEvidenceOnly"
>;

export function CachePolicyPanel({
  draftValues,
  onDraftValuesChange,
  text
}: CachePolicyPanelProps) {
  return (
    <CachePolicyControls
      enabled={draftValues.cacheEnabled}
      onEnabledChange={(checked) =>
        onDraftValuesChange((current) => ({
          ...current,
          cacheEnabled: checked
        }))
      }
      text={text}
    />
  );
}

export function CachePolicyControls({
  enabled,
  onEnabledChange,
  showSemanticCache = true,
  text
}: {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  showSemanticCache?: boolean;
  text: CachePolicyControlsText;
}) {
  const [isSemanticExpanded, setIsSemanticExpanded] = useState(false);

  return (
    <article className="console-panel policy-editor-panel policy-cache-panel">
      <div className="panel-heading">
        <h3>{text.cacheSection}</h3>
      </div>
      <div className="policy-cache-content">
        <section className="policy-cache-group">
          <h4>{text.cacheSettings}</h4>
          <ExactCacheToggleCard
            enabled={enabled}
            hint={text.cacheEnabledHint}
            id="runtime-policy-cache-enabled"
            onEnabledChange={onEnabledChange}
            title={text.cacheEnabled}
          />
          {showSemanticCache ? (
            <>
              <button
                aria-expanded={isSemanticExpanded}
                className="policy-cache-semantic-toggle"
                onClick={() => setIsSemanticExpanded((current) => !current)}
                type="button"
              >
                <span className="policy-cache-card-icon" aria-hidden="true">
                  <FlaskConical size={19} />
                </span>
                <span className="policy-cache-card-copy">
                  <strong>{text.semanticCache}</strong>
                </span>
                <ChevronDown aria-hidden="true" size={18} />
              </button>
              {isSemanticExpanded ? (
                <div className="policy-cache-semantic-state">
                  <span>{text.mode}</span>
                  <em data-enabled={enabled}>
                    {enabled
                      ? text.semanticCacheEvidenceOnly
                      : text.semanticCacheDisabled}
                  </em>
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </article>
  );
}
