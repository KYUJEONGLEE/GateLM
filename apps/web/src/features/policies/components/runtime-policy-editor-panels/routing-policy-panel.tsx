import { Alert, AlertDescription } from "@/components/ui/alert";
import type {
  RuntimePolicyDraftValues,
  RuntimePolicyModel,
  RuntimePolicyModelConfig,
  RuntimePolicyProvider
} from "@/lib/control-plane/runtime-policy-types";

import { PolicyNumberField, RoutingPriorityTable } from "../runtime-policy-editor-controls";
import type {
  RoutingPriorityRoute,
  RoutingProviderOption,
  RuntimePolicyEditorText
} from "../runtime-policy-editor";

type RoutingPolicyPanelProps = {
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
              priority: "High",
              provider: draftValues.routingLowCostProvider,
              route: "lowCost",
              selectedModel: draftValues.routingLowCostModel
            },
            {
              priority: "Default",
              provider: draftValues.routingDefaultProvider,
              route: "default",
              selectedModel: draftValues.routingDefaultModel
            },
            {
              priority: "Fallback",
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
