import type { Dispatch, SetStateAction } from "react";

import { Switch } from "@/components/ui/switch";
import type { RuntimePolicyDraftValues } from "@/lib/control-plane/runtime-policy-types";

import { DetectorEditor, PolicyNumberField } from "../runtime-policy-editor-controls";
import type { RuntimePolicyEditorText } from "../runtime-policy-editor";

type SafetyPolicyPanelProps = {
  draftValues: RuntimePolicyDraftValues;
  onDraftValuesChange: Dispatch<SetStateAction<RuntimePolicyDraftValues>>;
  text: RuntimePolicyEditorText;
};

export function SafetyPolicyPanel({
  draftValues,
  onDraftValuesChange,
  text
}: SafetyPolicyPanelProps) {
  return (
    <>
      <article className="console-panel policy-editor-panel wide-panel">
        <div className="panel-heading">
          <h3>{text.detectors}</h3>
        </div>
        <div className="policy-alert" data-status="warning">
          <strong>{text.mandatoryProtection}</strong>{" "}
          <span>{text.mandatoryProtectionHint}</span>
        </div>
        <div className="policy-detector-list">
          {draftValues.detectors.map((detector, index) => (
            <DetectorEditor
              detector={detector}
              key={detector.type}
              labels={text}
              onChange={(nextDetector) =>
                onDraftValuesChange((current) => ({
                  ...current,
                  detectors: current.detectors.map((item, itemIndex) =>
                    itemIndex === index ? nextDetector : item
                  )
                }))
              }
            />
          ))}
        </div>
      </article>

      <article className="console-panel policy-editor-panel">
        <div className="panel-heading">
          <h3>{text.promptCapture}</h3>
        </div>
        <label className="policy-toggle-row">
          <Switch
            checked={draftValues.promptCaptureEnabled}
            onCheckedChange={(checked) =>
              onDraftValuesChange((current) => ({
                ...current,
                promptCaptureEnabled: checked
              }))
            }
          />
          <span>{text.promptCaptureEnabled}</span>
        </label>
        <p className="project-muted">{text.logSafeCaptureHint}</p>
        <PolicyNumberField
          label={text.promptCaptureMaxChars}
          max={20000}
          min={1}
          onChange={(value) =>
            onDraftValuesChange((current) => ({
              ...current,
              promptCaptureMaxChars: value
            }))
          }
          value={draftValues.promptCaptureMaxChars}
        />
      </article>

      <article className="console-panel policy-editor-panel">
        <div className="panel-heading">
          <h3>{text.responseCapture}</h3>
        </div>
        <label aria-disabled="true" className="policy-toggle-row">
          <Switch checked={draftValues.responseCaptureEnabled} disabled readOnly />
          <span>
            {draftValues.responseCaptureEnabled ? text.enabled : text.disabled}
          </span>
        </label>
        <p className="project-muted">{text.responseCaptureHint}</p>
        <dl className="policy-summary-list">
          <div>
            <dt>{text.responseCaptureMaxChars}</dt>
            <dd>{draftValues.responseCaptureMaxChars}</dd>
          </div>
        </dl>
      </article>
    </>
  );
}
