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

export function SafetyPolicyPanel({
  draftValues,
  onDraftValuesChange,
  text
}: SafetyPolicyPanelProps) {
  const [isMandatoryExpanded, setIsMandatoryExpanded] = useState(false);
  const optionalDetectors = draftValues.detectors.filter(
    (detector) => !isMandatorySafetyDetector(detector.type)
  );
  const mandatoryDetectors = draftValues.detectors.filter((detector) =>
    isMandatorySafetyDetector(detector.type)
  );

  const updateDetector = (nextDetector: RuntimePolicyDetector) =>
    onDraftValuesChange((current) => ({
      ...current,
      detectors: current.detectors.map((detector) =>
        detector.type === nextDetector.type ? nextDetector : detector
      )
    }));

  return (
    <>
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
                  detector={detector}
                  key={detector.type}
                  labels={text}
                  onChange={updateDetector}
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
                    detector={detector}
                    key={detector.type}
                    labels={text}
                    onChange={updateDetector}
                  />
                ))}
              </div>
            ) : null}
          </section>
        </div>
      </article>

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

function DetectorEditor({
  detector,
  labels,
  onChange
}: {
  detector: RuntimePolicyDetector;
  labels: RuntimePolicyEditorText;
  onChange: (detector: RuntimePolicyDetector) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const isMandatory = isMandatorySafetyDetector(detector.type);
  const actionValue = detector.action;
  const canEditPlaceholder = actionValue === "redact";
  const detectorName = labels.detectorNames[detector.type];
  const actionLabel =
    actionValue === "block" ? labels.blockAction : labels.redactAction;

  return (
    <div
      className="policy-detector-card"
      data-detector-type={detector.type}
      data-action={actionValue}
      data-expanded={isEditing && canEditPlaceholder}
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
          {canEditPlaceholder && !isEditing ? (
            <span>{detector.placeholder}</span>
          ) : null}
        </div>
        {isEditing && canEditPlaceholder ? (
          <input
            aria-label={`${detectorName} ${labels.placeholder}`}
            className="policy-detector-placeholder-inline"
            onChange={(event) =>
              onChange({
                ...detector,
                placeholder: event.target.value
              })
            }
            value={detector.placeholder}
          />
        ) : null}
        {canEditPlaceholder ? (
          <button
            aria-expanded={isEditing}
            className="policy-detector-edit-button"
            onClick={() => setIsEditing((current) => !current)}
            type="button"
          >
            <span>{isEditing ? labels.close : labels.edit}</span>
            <ChevronDown aria-hidden="true" size={16} />
          </button>
        ) : null}
        <button
          aria-label={`${detectorName} ${labels.mode}`}
          className="policy-detector-mode-button"
          data-action={actionValue}
          onClick={() => {
            setIsEditing(false);
            onChange({
              ...detector,
              action: actionValue === "block" ? "redact" : "block"
            });
          }}
          type="button"
        >
          {actionLabel}
        </button>
      </div>
    </div>
  );
}
