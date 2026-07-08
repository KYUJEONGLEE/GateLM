import { Switch } from "@/components/ui/switch";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import type {
  RuntimePolicyDetector,
  RuntimePolicyModelConfig
} from "@/lib/control-plane/runtime-policy-types";

import type {
  RoutingPriorityRoute,
  RoutingProviderOption,
  RuntimePolicyEditorText
} from "./runtime-policy-editor";

type PolicyNumberFieldProps = {
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  readOnly?: boolean;
  value: number;
};

type DetectorEditorProps = {
  detector: RuntimePolicyDetector;
  labels: RuntimePolicyEditorText;
  onChange: (detector: RuntimePolicyDetector) => void;
};

type RoutingPriorityTableProps = {
  modelOptionsByProvider: Map<string, RuntimePolicyModelConfig[]>;
  onModelChange: (route: RoutingPriorityRoute, model: string) => void;
  onProviderChange: (route: RoutingPriorityRoute, provider: string) => void;
  providerOptions: RoutingProviderOption[];
  rows: Array<{
    priority: string;
    provider: string;
    route: RoutingPriorityRoute;
    selectedModel: string;
  }>;
  text: {
    model: string;
    noProviderModels: string;
    provider: string;
  };
};

type RoutingPriorityRowProps = {
  modelOptionsByProvider: Map<string, RuntimePolicyModelConfig[]>;
  onModelChange: (route: RoutingPriorityRoute, model: string) => void;
  onProviderChange: (route: RoutingPriorityRoute, provider: string) => void;
  providerOptions: RoutingProviderOption[];
  row: {
    priority: string;
    provider: string;
    route: RoutingPriorityRoute;
    selectedModel: string;
  };
  text: {
    model: string;
    noProviderModels: string;
    provider: string;
  };
};

export function PolicyNumberField({
  label,
  max,
  min,
  onChange,
  readOnly = false,
  value
}: PolicyNumberFieldProps) {
  return (
    <label className="policy-field">
      <span>{label}</span>
      <input
        max={max}
        min={min}
        onChange={(event) => onChange(parseBoundedInteger(event.target.value, min, max))}
        readOnly={readOnly}
        type="number"
        value={value}
      />
    </label>
  );
}

export function DetectorEditor({ detector, labels, onChange }: DetectorEditorProps) {
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

export function RoutingPriorityTable({
  modelOptionsByProvider,
  onModelChange,
  onProviderChange,
  providerOptions,
  rows,
  text
}: RoutingPriorityTableProps) {
  return (
    <div className="policy-routing-table" role="table" aria-label="Routing priority">
      <div className="policy-routing-table-head" role="row">
        <span role="columnheader">Priority</span>
        <span role="columnheader">{text.provider}</span>
        <span role="columnheader">{text.model}</span>
      </div>
      {rows.map((row) => (
        <RoutingPriorityRow
          key={row.route}
          modelOptionsByProvider={modelOptionsByProvider}
          onModelChange={onModelChange}
          onProviderChange={onProviderChange}
          providerOptions={providerOptions}
          row={row}
          text={text}
        />
      ))}
    </div>
  );
}

export function formatEnabled(value?: boolean | null) {
  return value ? "enabled" : "disabled";
}

function RoutingPriorityRow({
  modelOptionsByProvider,
  onModelChange,
  onProviderChange,
  providerOptions,
  row,
  text
}: RoutingPriorityRowProps) {
  const selectedProvider = getRoutingProviderOption(providerOptions, row.provider);
  const modelOptions = modelOptionsByProvider.get(row.provider) ?? [];
  const hasProviderOptions = providerOptions.length > 0;
  const selectedModelAvailable = modelOptions.some((option) => option.model === row.selectedModel);

  return (
    <div className="policy-routing-table-row" role="row">
      <div className="policy-routing-priority" role="cell">
        {row.priority}
      </div>
      <label className="policy-routing-provider-cell">
        <span className="sr-only">{row.priority} {text.provider}</span>
        {selectedProvider ? (
          <ProviderFamilyIcon
            className="policy-routing-provider-icon"
            family={selectedProvider.family}
            size={26}
          />
        ) : (
          <span className="policy-routing-provider-icon" aria-hidden="true">
            -
          </span>
        )}
        <select
          aria-label={`${row.priority} ${text.provider}`}
          disabled={!hasProviderOptions}
          onChange={(event) => onProviderChange(row.route, event.target.value)}
          value={hasProviderOptions ? row.provider : ""}
        >
          {!hasProviderOptions ? <option value="">{text.noProviderModels}</option> : null}
          {providerOptions.map((option) => (
            <option key={option.providerId} value={option.provider}>
              {option.displayName}
            </option>
          ))}
        </select>
      </label>
      <label className="policy-routing-model-cell">
        <span className="sr-only">{row.priority} {text.model}</span>
        <select
          aria-label={`${row.priority} ${text.model}`}
          disabled={modelOptions.length === 0}
          onChange={(event) => onModelChange(row.route, event.target.value)}
          value={modelOptions.length === 0 || !selectedModelAvailable ? "" : row.selectedModel}
        >
          {modelOptions.length === 0 ? <option value="">{text.noProviderModels}</option> : null}
          {modelOptions.length > 0 && !selectedModelAvailable ? (
            <option value="">Select a registered model</option>
          ) : null}
          {modelOptions.map((option) => (
            <option key={`${option.provider}:${option.model}`} value={option.model}>
              {option.displayName || option.model}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function getRoutingProviderOption(
  providerOptions: RoutingProviderOption[],
  provider: string
) {
  return providerOptions.find((option) => option.provider === provider) ?? null;
}

function isMandatorySafetyDetector(detectorType: RuntimePolicyDetector["type"]) {
  return (
    detectorType === "resident_registration_number" ||
    detectorType === "api_key" ||
    detectorType === "authorization_header" ||
    detectorType === "jwt" ||
    detectorType === "private_key"
  );
}

function parseBoundedInteger(value: string, min: number, max: number) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return min;
  }

  return Math.min(Math.max(parsed, min), max);
}
