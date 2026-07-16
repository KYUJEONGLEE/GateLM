"use client";

import { ChevronDown, LockKeyhole } from "lucide-react";
import { useState } from "react";
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

export type SafetyDetectorPolicyText = Pick<
  RuntimePolicyEditorText,
  | "blockAction"
  | "close"
  | "detectorNames"
  | "detectors"
  | "edit"
  | "enabled"
  | "mandatoryProtection"
  | "mandatoryProtectionHint"
  | "mode"
  | "placeholder"
  | "privacyMasking"
  | "redactAction"
>;

export function SafetyPolicyPanel({
  draftValues,
  onDraftValuesChange,
  text
}: SafetyPolicyPanelProps) {
  const updateDetector = (nextDetector: RuntimePolicyDetector) =>
    onDraftValuesChange((current) => ({
      ...current,
      detectors: current.detectors.map((detector) =>
        detector.type === nextDetector.type ? nextDetector : detector
      )
    }));

  return (
    <>
      <SafetyDetectorPolicyControls
        detectors={draftValues.detectors}
        onDetectorChange={updateDetector}
        showAllActionOptions
        text={text}
      />

      <article className="console-panel policy-editor-panel">
        <div className="panel-heading">
          <div className="policy-heading-with-info">
            <h3>{text.promptCapture}</h3>
            <span className="policy-info-tooltip">
              <button
                aria-label={text.logSafeCaptureHint}
                className="policy-info-trigger"
                type="button"
              >
                i
              </button>
              <span className="policy-info-content">
                {text.logSafeCaptureHint}
              </span>
            </span>
          </div>
        </div>
        <div
          className="policy-prompt-capture-card"
          data-enabled={draftValues.promptCaptureEnabled}
        >
          <div className="policy-prompt-capture-summary">
            <Switch
              aria-label={text.promptCapture}
              checked={draftValues.promptCaptureEnabled}
              id="runtime-policy-prompt-capture-enabled"
              onCheckedChange={(checked) =>
                onDraftValuesChange((current) => ({
                  ...current,
                  promptCaptureEnabled: checked
                }))
              }
            />
            <span className="policy-prompt-capture-title">
              <strong>{text.promptCapture}</strong>
            </span>
          </div>
          {draftValues.promptCaptureEnabled ? (
            <div className="policy-prompt-capture-limit">
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
            </div>
          ) : null}
        </div>
      </article>
    </>
  );
}

export function SafetyDetectorPolicyControls({
  allowPlaceholderEditing = true,
  detectors,
  onDetectorChange,
  showAllActionOptions = false,
  text
}: {
  allowPlaceholderEditing?: boolean;
  detectors: RuntimePolicyDetector[];
  onDetectorChange: (detector: RuntimePolicyDetector) => void;
  showAllActionOptions?: boolean;
  text: SafetyDetectorPolicyText;
}) {
  const [isMandatoryExpanded, setIsMandatoryExpanded] = useState(false);
  const optionalDetectors = detectors.filter(
    (detector) => !isMandatorySafetyDetector(detector.type)
  );
  const mandatoryDetectors = detectors.filter((detector) =>
    isMandatorySafetyDetector(detector.type)
  );

  return (
    <article className="console-panel policy-editor-panel wide-panel">
      <div className="panel-heading">
        <h3>{text.detectors}</h3>
      </div>
      <div className="policy-safety-detector-content">
        <section className="policy-safety-detector-group">
          <h4>{text.privacyMasking}</h4>
          <div className="policy-detector-card-list">
            {optionalDetectors.map((detector) => (
              <DetectorEditor
                allowPlaceholderEditing={allowPlaceholderEditing}
                detector={detector}
                key={detector.type}
                labels={text}
                onChange={onDetectorChange}
                showAllActionOptions={showAllActionOptions}
              />
            ))}
          </div>
        </section>

        <section className="policy-safety-detector-group">
          <button
            aria-expanded={isMandatoryExpanded}
            className="policy-safety-mandatory-toggle"
            onClick={() => setIsMandatoryExpanded((current) => !current)}
            type="button"
          >
            <span>
              <strong>{text.mandatoryProtection}</strong>
              <small>{text.mandatoryProtectionHint}</small>
            </span>
            <ChevronDown aria-hidden="true" size={18} />
          </button>
          {isMandatoryExpanded ? (
            <div className="policy-detector-card-list">
              {mandatoryDetectors.map((detector) => (
                <DetectorEditor
                  allowPlaceholderEditing={allowPlaceholderEditing}
                  detector={detector}
                  key={detector.type}
                  labels={text}
                  onChange={onDetectorChange}
                  showAllActionOptions={showAllActionOptions}
                />
              ))}
            </div>
          ) : null}
        </section>
      </div>
    </article>
  );
}

function DetectorEditor({
  allowPlaceholderEditing,
  detector,
  labels,
  onChange,
  showAllActionOptions
}: {
  allowPlaceholderEditing: boolean;
  detector: RuntimePolicyDetector;
  labels: SafetyDetectorPolicyText;
  onChange: (detector: RuntimePolicyDetector) => void;
  showAllActionOptions: boolean;
}) {
  const isMandatory = isMandatorySafetyDetector(detector.type);
  const actionValue = detector.action;
  const showPlaceholder = allowPlaceholderEditing;
  const detectorName = labels.detectorNames[detector.type];
  const actionLabel =
    actionValue === "block" ? labels.blockAction : labels.redactAction;

  return (
    <div
      className="policy-detector-card"
      data-detector-type={detector.type}
      data-action={actionValue}
      data-mandatory={isMandatory}
    >
      <div className="policy-detector-card-summary">
        <div className="policy-detector-state" aria-hidden={isMandatory}>
          {isMandatory ? (
            <LockKeyhole aria-label={labels.mandatoryProtection} size={20} />
          ) : (
            <Switch
              aria-label={`${detectorName} ${labels.enabled}`}
              checked={detector.enabled}
              id={`runtime-policy-detector-${detector.type}-enabled`}
              onCheckedChange={(checked) =>
                onChange({
                  ...detector,
                  enabled: checked
                })
              }
            />
          )}
        </div>
        <div className="policy-detector-card-name">
          <strong>{detectorName}</strong>
          {showPlaceholder ? (
            <span>{detector.placeholder}</span>
          ) : null}
        </div>
        {showAllActionOptions ? (
          <fieldset
            className="policy-detector-action-group"
            data-action={actionValue}
          >
            <legend className="sr-only">{`${detectorName} ${labels.mode}`}</legend>
            <span
              aria-hidden="true"
              className="policy-detector-action-indicator"
            />
            {(["redact", "block"] as const).map((nextAction) => {
              const isSelected = actionValue === nextAction;

              return (
                <label
                  className="policy-detector-mode-button"
                  data-action={nextAction}
                  data-selected={isSelected}
                  key={nextAction}
                >
                  <input
                    checked={isSelected}
                    className="sr-only"
                    name={`runtime-policy-detector-${detector.type}-action`}
                    onChange={() =>
                      onChange({
                        ...detector,
                        action: nextAction
                      })
                    }
                    type="radio"
                    value={nextAction}
                  />
                  <span>
                    {nextAction === "block" ? labels.blockAction : labels.redactAction}
                  </span>
                </label>
              );
            })}
          </fieldset>
        ) : (
          <button
            aria-label={`${detectorName} ${labels.mode}`}
            className="policy-detector-mode-button"
            data-action={actionValue}
            onClick={() =>
              onChange({
                ...detector,
                action: actionValue === "block" ? "redact" : "block"
              })
            }
            type="button"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </div>
  );
}
