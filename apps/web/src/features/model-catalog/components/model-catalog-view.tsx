"use client";

import { Boxes, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ModelCatalogItem, ModelCatalogModel } from "@/lib/gateway/model-catalog-types";
import { formatDateTime, nullableText } from "@/lib/formatting/formatters";
import type { Locale } from "@/lib/i18n/locale";

type ModelCatalogViewProps = {
  locale: Locale;
  model: ModelCatalogModel;
};

const catalogText: Record<
  Locale,
  {
    alias: string;
    allowed: string;
    capabilities: string;
    clear: string;
    created: string;
    credential: string;
    empty: string;
    execution: string;
    fallback: string;
    gateway: string;
    gatewayUnavailable: string;
    httpStatus: string;
    management: string;
    meta: string;
    model: string;
    modelCount: string;
    noCapability: string;
    noProvider: string;
    object: string;
    ownedBy: string;
    provider: string;
    refresh: string;
    requestId: string;
    routing: string;
    route: string;
    source: string;
    title: string;
  }
> = {
  en: {
    alias: "Alias",
    allowed: "Allowed",
    capabilities: "Capabilities",
    clear: "Clear",
    created: "Created",
    credential: "Credential",
    empty: "No models returned from Gateway.",
    execution: "Execution",
    fallback: "Fallback",
    gateway: "Gateway",
    gatewayUnavailable: "Gateway unavailable",
    httpStatus: "HTTP status",
    management: "management",
    meta: "Gateway metadata",
    model: "Model",
    modelCount: "Models",
    noCapability: "No capability metadata",
    noProvider: "No provider metadata",
    object: "Object",
    ownedBy: "Owned by",
    provider: "Provider",
    refresh: "Refresh",
    requestId: "Request ID",
    routing: "Routing",
    route: "Route",
    source: "Source",
    title: "Model Catalog"
  },
  ko: {
    alias: "Alias",
    allowed: "허용",
    capabilities: "Capabilities",
    clear: "초기화",
    created: "생성",
    credential: "Credential",
    empty: "Gateway에서 반환된 모델이 없습니다.",
    execution: "Execution",
    fallback: "Fallback",
    gateway: "Gateway",
    gatewayUnavailable: "Gateway unavailable",
    httpStatus: "HTTP status",
    management: "관리",
    meta: "Gateway metadata",
    model: "Model",
    modelCount: "모델",
    noCapability: "Capability metadata 없음",
    noProvider: "Provider metadata 없음",
    object: "Object",
    ownedBy: "Owned by",
    provider: "Provider",
    refresh: "새로고침",
    requestId: "Request ID",
    routing: "Routing",
    route: "Route",
    source: "출처",
    title: "Model Catalog"
  }
};

export function ModelCatalogView({ locale, model }: ModelCatalogViewProps) {
  const router = useRouter();
  const text = catalogText[locale];
  const [providerFilter, setProviderFilter] = useState("all");
  const [capabilityFilter, setCapabilityFilter] = useState("all");
  const providerOptions = useMemo(() => getProviderOptions(model.models), [model.models]);
  const capabilityOptions = useMemo(() => getCapabilityOptions(model.models), [model.models]);
  const visibleModels = useMemo(
    () =>
      model.models.filter((item) => {
        const providerMatches = providerFilter === "all" || getEffectiveProvider(item) === providerFilter;
        const capabilityMatches =
          capabilityFilter === "all" || item.capabilities.includes(capabilityFilter);

        return providerMatches && capabilityMatches;
      }),
    [capabilityFilter, model.models, providerFilter]
  );
  const hasFilters = providerFilter !== "all" || capabilityFilter !== "all";

  function clearFilters() {
    setProviderFilter("all");
    setCapabilityFilter("all");
  }

  return (
    <main className="console-content">
      <section className="dashboard-hero">
        <div>
          <p className="console-kicker">{text.management}</p>
          <h2>{text.title}</h2>
        </div>
      </section>

      {model.loadError ? (
        <p className="policy-alert" data-status="error">
          {text.gatewayUnavailable}: {model.loadError}
        </p>
      ) : null}
      {model.controlPlaneLoadError ? (
        <p className="policy-alert" data-status="warning">
          Control Plane catalog: {model.controlPlaneLoadError}
        </p>
      ) : null}

      <section className="metric-grid model-catalog-metrics">
        <article className="metric-card">
          <span>{text.modelCount}</span>
          <strong>{model.models.length}</strong>
        </article>
        <article className="metric-card">
          <span>{text.provider}</span>
          <strong>{providerOptions.length}</strong>
        </article>
        <article className="metric-card">
          <span>{text.httpStatus}</span>
          <strong>{nullableText(model.meta.httpStatus?.toString() ?? null)}</strong>
        </article>
        <article className="metric-card">
          <span>{text.route}</span>
          <strong>{nullableText(model.meta.routedProvider)}</strong>
        </article>
      </section>

      <section className="console-panel">
        <div className="model-catalog-toolbar">
          <div className="panel-heading">
            <h3>{text.title}</h3>
            <p>/v1/models</p>
          </div>
          <div className="model-catalog-actions">
            <label className="policy-field">
              <span>{text.provider}</span>
              <select
                onChange={(event) => setProviderFilter(event.target.value)}
                value={providerFilter}
              >
                <option value="all">All</option>
                {providerOptions.map((provider) => (
                  <option key={provider} value={provider}>
                    {provider}
                  </option>
                ))}
              </select>
            </label>
            <label className="policy-field">
              <span>{text.capabilities}</span>
              <select
                onChange={(event) => setCapabilityFilter(event.target.value)}
                value={capabilityFilter}
              >
                <option value="all">All</option>
                {capabilityOptions.map((capability) => (
                  <option key={capability} value={capability}>
                    {capability}
                  </option>
                ))}
              </select>
            </label>
            <Button disabled={!hasFilters} onClick={clearFilters} type="button" variant="outline">
              {text.clear}
            </Button>
            <Button onClick={() => router.refresh()} type="button">
              <RefreshCw aria-hidden="true" />
              {text.refresh}
            </Button>
          </div>
        </div>

        {visibleModels.length > 0 ? (
          <div className="table-wrap">
            <table className="data-table model-catalog-table">
              <thead>
                <tr>
                  <th>{text.model}</th>
                  <th>{text.provider}</th>
                  <th>{text.execution}</th>
                  <th>{text.capabilities}</th>
                  <th>{text.routing}</th>
                  <th>{text.allowed}</th>
                  <th>{text.source}</th>
                  <th>{text.created}</th>
                </tr>
              </thead>
              <tbody>
                {visibleModels.map((item) => (
                  <tr key={`${getEffectiveProvider(item)}:${item.id}`}>
                    <td>
                      <strong className="provider-name">{item.id}</strong>
                      <span className="project-muted">
                        {text.object}: {item.object} / {text.ownedBy}: {item.ownedBy}
                      </span>
                    </td>
                    <td>{nullableText(getEffectiveProvider(item) || text.noProvider)}</td>
                    <td>
                      <ExecutionMetadata item={item} labels={text} />
                    </td>
                    <td>
                      <CapabilityList item={item} noCapabilityText={text.noCapability} />
                      {item.alias ? <span className="project-muted">{text.alias}: {item.alias}</span> : null}
                    </td>
                    <td>
                      <RoutingMetadata item={item} labels={text} />
                    </td>
                    <td>
                      <Badge
                        className="project-status-badge"
                        data-status={
                          item.allowed === false
                            ? "DISABLED"
                            : item.allowed === true
                              ? "ACTIVE"
                              : "ARCHIVED"
                        }
                        variant="outline"
                      >
                        {item.allowed === false ? "false" : item.allowed === true ? "true" : "-"}
                      </Badge>
                    </td>
                    <td>{item.source}</td>
                    <td>{item.createdAt ? formatDateTime(item.createdAt) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-state">
            <Boxes aria-hidden="true" size={18} /> {text.empty}
          </p>
        )}
      </section>

      <section className="console-panel">
        <div className="panel-heading">
          <h3>{text.meta}</h3>
        </div>
        <dl className="policy-summary-list">
          {[
            [text.requestId, nullableText(model.meta.requestId)],
            [text.httpStatus, nullableText(model.meta.httpStatus?.toString() ?? null)],
            ["cacheStatus", nullableText(model.meta.cacheStatus)],
            ["maskingAction", nullableText(model.meta.maskingAction)],
            ["routedProvider", nullableText(model.meta.routedProvider)],
            ["routedModel", nullableText(model.meta.routedModel)]
          ].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}

function CapabilityList({
  item,
  noCapabilityText
}: {
  item: ModelCatalogItem;
  noCapabilityText: string;
}) {
  if (item.capabilities.length === 0) {
    return <span className="project-muted">{noCapabilityText}</span>;
  }

  return (
    <div className="model-capability-list">
      {item.capabilities.map((capability) => (
        <Badge key={capability} variant="secondary">
          {capability}
        </Badge>
      ))}
    </div>
  );
}

function ExecutionMetadata({
  item,
  labels
}: {
  item: ModelCatalogItem;
  labels: (typeof catalogText)[Locale];
}) {
  return (
    <div className="model-catalog-metadata">
      <span>{nullableText(item.adapterType, "adapter default")}</span>
      <small className="project-muted">
        format: {nullableText(item.requestFormat, "default")}
      </small>
      <small className="project-muted">
        timeout: {item.timeoutMs === null ? "-" : `${item.timeoutMs}ms`}
      </small>
      <small className="project-muted">
        {labels.credential}: {formatCredentialState(item)}
      </small>
      <small className="project-muted">
        {labels.fallback}: {item.fallbackEligible === null ? "-" : String(item.fallbackEligible)}
      </small>
      {item.apiVersion ? (
        <small className="project-muted">apiVersion: {item.apiVersion}</small>
      ) : null}
    </div>
  );
}

function RoutingMetadata({
  item,
  labels
}: {
  item: ModelCatalogItem;
  labels: (typeof catalogText)[Locale];
}) {
  return (
    <div className="model-catalog-metadata">
      <span>
        auto: {item.autoRoutingEligible === null ? "-" : String(item.autoRoutingEligible)}
      </span>
      <small className="project-muted">
        costTier: {nullableText(item.costTier, "-")}
      </small>
      <small className="project-muted">
        {labels.fallback}:{" "}
        {item.fallbackPriority === null ? "-" : item.fallbackPriority.toString()}
      </small>
    </div>
  );
}

function formatCredentialState(item: ModelCatalogItem) {
  if (item.credentialRequired === false) {
    return "not_required";
  }

  if (item.credentialRequired === true) {
    return item.credentialState ?? "required";
  }

  return item.credentialState ?? "-";
}

function getProviderOptions(models: ModelCatalogItem[]) {
  return Array.from(new Set(models.map(getEffectiveProvider).filter(Boolean))).sort();
}

function getCapabilityOptions(models: ModelCatalogItem[]) {
  return Array.from(new Set(models.flatMap((model) => model.capabilities))).sort();
}

function getEffectiveProvider(model: ModelCatalogItem) {
  return model.provider ?? model.ownedBy;
}
