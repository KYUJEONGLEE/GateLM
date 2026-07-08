import { Switch } from "@/components/ui/switch";
import type {
  RuntimePolicyDetector,
  RuntimePolicyDraftValues
} from "@/lib/control-plane/runtime-policy-types";

import type {
  RuntimePolicyDraftValuesSetter,
  RuntimePolicyEditorText
} from "../runtime-policy-editor-types";
import { isMandatorySafetyDetector } from "../runtime-policy-editor-utils";
import { PolicyNumberField } from "./shared";

export type SafetyPolicyPanelProps = {
  draftValues: RuntimePolicyDraftValues;
  onDraftValuesChange: RuntimePolicyDraftValuesSetter;
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

function DetectorEditor({
  detector,
  labels,
  onChange
}: {
  detector: RuntimePolicyDetector;
  labels: RuntimePolicyEditorText;
  onChange: (detector: RuntimePolicyDetector) => void;
}) {
  const isMandatory = isMandatorySafetyDetector(detector.type);
  const actionValue = isMandatory ? "block" : detector.action;

  return (
    <div
      className="policy-detector-row"
      data-detector-type={detector.type}
      data-mandatory={isMandatory}
    >
      <label className="policy-toggle-row">
        <Switch
          aria-label={`${detector.type} ${labels.enabled}`}
          checked={isMandatory || detector.enabled}
          disabled={isMandatory}
          onCheckedChange={(checked) =>
            onChange({
              ...detector,
              enabled: checked
            })
          }
        />
        <span>{labels.enabled}</span>
      </label>
      <div className="policy-detector-name">
        <span>{labels.detectorType}</span>
        <strong>{detector.type}</strong>
      </div>
      <label className="policy-field">
        <span>{labels.mode}</span>
        <select
          disabled={isMandatory}
          onChange={(event) =>
            onChange({
              ...detector,
              action: event.target.value === "block" ? "block" : "redact"
            })
          }
          value={actionValue}
        >
          <option value="redact">redact</option>
          <option value="block">block</option>
        </select>
      </label>
      <label className="policy-field">
        <span>{labels.placeholder}</span>
        <input
          onChange={(event) =>
            onChange({
              ...detector,
              placeholder: event.target.value
            })
          }
          value={detector.placeholder}
        />
      </label>
    </div>
  );
}
