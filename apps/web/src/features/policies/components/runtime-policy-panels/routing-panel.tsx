import { Alert, AlertDescription } from "@/components/ui/alert";
import { ProviderFamilyIcon } from "@/features/provider-connections/components/provider-family-icon";
import type {
  RuntimePolicyDraftValues,
  RuntimePolicyModel,
  RuntimePolicyModelConfig,
  RuntimePolicyProvider
} from "@/lib/control-plane/runtime-policy-types";

import type {
  RoutingPriorityRoute,
  RoutingPriorityRow,
  RoutingPriorityTableText,
  RoutingProviderOption,
  RuntimePolicyEditorText
} from "../runtime-policy-editor-types";
import { PolicyNumberField } from "./shared";

export type RoutingPolicyPanelProps = {
  draftValues: RuntimePolicyDraftValues;
  modelOptionsByProvider: Map<string, RuntimePolicyModelConfig[]>;
  onModelChange: (route: RoutingPriorityRoute, model: string) => void;
  onProviderChange: (route: RoutingPriorityRoute, provider: string) => void;
  onShortPromptChange: (value: number) => void;
  providerCatalog: RuntimePolicyModel["providerCatalog"];
  providerOptions: RoutingProviderOption[];
  providers: RuntimePolicyProvider[];
  text: RuntimePolicyEditorText;
};

export function RoutingPolicyPanel({
  draftValues,
  modelOptionsByProvider,
  onModelChange,
  onProviderChange,
  onShortPromptChange,
  providerCatalog,
  providerOptions,
  providers,
  text
}: RoutingPolicyPanelProps) {
  return (
    <>
      <article className="console-panel policy-editor-panel">
        <div className="panel-heading">
          <h3>{text.routing}</h3>
        </div>
        <RoutingPriorityTable
          modelOptionsByProvider={modelOptionsByProvider}
          onModelChange={onModelChange}
          onProviderChange={onProviderChange}
          providerOptions={providerOptions}
          rows={[
            {
              priority: text.highQualityRoute,
              provider: draftValues.routingHighQualityProvider,
              route: "highQuality",
              selectedModel: draftValues.routingHighQualityModel
            },
            {
              priority: text.defaultRoute,
              provider: draftValues.routingDefaultProvider,
              route: "default",
              selectedModel: draftValues.routingDefaultModel
            },
            {
              priority: text.lowCostRoute,
              provider: draftValues.routingLowCostProvider,
              route: "lowCost",
              selectedModel: draftValues.routingLowCostModel
            },
            {
              priority: text.fallbackRoute,
              provider: draftValues.routingFallbackProvider,
              route: "fallback",
              selectedModel: draftValues.routingFallbackModel
            }
          ]}
          text={{
            model: text.model,
            noProviderModels: text.noProviderModels,
            provider: text.provider
          }}
        />
      </article>

      <article className="console-panel policy-editor-panel">
        <div className="panel-heading">
          <h3>{text.routingAdvanced}</h3>
        </div>
        <PolicyNumberField
          label={text.shortPrompt}
          max={100000}
          min={1}
          onChange={onShortPromptChange}
          value={draftValues.routingShortPromptMaxChars}
        />
      </article>

      <article className="console-panel policy-editor-panel">
        <div className="panel-heading">
          <h3>{text.providerCatalog}</h3>
        </div>
        {providerCatalog.loadError ? (
          <Alert variant="warning">
            <AlertDescription>{providerCatalog.loadError}</AlertDescription>
          </Alert>
        ) : null}
        {providerCatalog.canonicalLoadError ? (
          <Alert variant="warning">
            <AlertDescription>{providerCatalog.canonicalLoadError}</AlertDescription>
          </Alert>
        ) : null}
        {providerCatalog.summary ? (
          <dl className="policy-summary-list">
            <div>
              <dt>{text.catalogVersion}</dt>
              <dd>{providerCatalog.summary.catalogVersion}</dd>
            </div>
            <div>
              <dt>{text.providerCount}</dt>
              <dd>
                {providerCatalog.summary.providerCount} / {text.models}:{" "}
                {providerCatalog.summary.modelCount}
              </dd>
            </div>
            <div>
              <dt>canonical by-id</dt>
              <dd>
                {providerCatalog.canonicalVerified === null
                  ? "not_checked"
                  : providerCatalog.canonicalVerified
                    ? "verified"
                    : "mismatch"}
              </dd>
            </div>
          </dl>
        ) : null}
        <dl className="policy-summary-list">
          {providers.map((provider) => (
            <div key={provider.providerId}>
              <dt>
                {provider.displayName} / {provider.provider}
              </dt>
              <dd>
                {provider.status} / {provider.resolver} / {provider.models.join(", ")}
              </dd>
            </div>
          ))}
        </dl>
      </article>
    </>
  );
}

function RoutingPriorityTable({
  modelOptionsByProvider,
  onModelChange,
  onProviderChange,
  providerOptions,
  rows,
  text
}: {
  modelOptionsByProvider: Map<string, RuntimePolicyModelConfig[]>;
  onModelChange: (route: RoutingPriorityRoute, model: string) => void;
  onProviderChange: (route: RoutingPriorityRoute, provider: string) => void;
  providerOptions: RoutingProviderOption[];
  rows: RoutingPriorityRow[];
  text: RoutingPriorityTableText;
}) {
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

function RoutingPriorityRow({
  modelOptionsByProvider,
  onModelChange,
  onProviderChange,
  providerOptions,
  row,
  text
}: {
  modelOptionsByProvider: Map<string, RuntimePolicyModelConfig[]>;
  onModelChange: (route: RoutingPriorityRoute, model: string) => void;
  onProviderChange: (route: RoutingPriorityRoute, provider: string) => void;
  providerOptions: RoutingProviderOption[];
  row: RoutingPriorityRow;
  text: RoutingPriorityTableText;
}) {
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
