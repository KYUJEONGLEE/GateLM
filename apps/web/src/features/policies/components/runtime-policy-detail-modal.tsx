import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  getRateLimitRefillTokensPerSecond,
  type RuntimePolicyConfig,
  type RuntimePolicyHistoryItem,
  type RuntimePolicyModel,
  type RuntimePolicySnapshot
} from "@/lib/control-plane/runtime-policy-types";
import { formatDateTime } from "@/lib/formatting/formatters";

import type { RuntimePolicyEditorText } from "./runtime-policy-editor-types";
import { formatEnabled } from "./runtime-policy-panels/shared";

export type RuntimePolicyDetailModalProps = {
  displayConfig: RuntimePolicyConfig;
  isSubmitting: boolean;
  model: RuntimePolicyModel;
  onClose: () => void;
  onRollback: (configVersion: string) => void;
  rollbackTarget: string | null;
  text: RuntimePolicyEditorText;
};

type RuntimeSnapshotDetailProps = {
  snapshot: RuntimePolicySnapshot;
  text: RuntimePolicyEditorText;
};

type RuntimeHistoryTableProps = {
  activeConfigVersion: string;
  isSubmitting: boolean;
  items: RuntimePolicyHistoryItem[];
  onRollback: (configVersion: string) => void;
  rollbackTarget: string | null;
  text: RuntimePolicyEditorText;
};

export function RuntimePolicyDetailModal({
  displayConfig,
  isSubmitting,
  model,
  onClose,
  onRollback,
  rollbackTarget,
  text
}: RuntimePolicyDetailModalProps) {
  const providerOptions = model.activeConfig.providers;

  return (
    <section
      aria-labelledby="policy-detail-title"
      aria-modal="true"
      className="modal-panel policy-detail-modal"
      onClick={(event) => event.stopPropagation()}
      role="dialog"
    >
      <div className="panel-heading">
        <h3 id="policy-detail-title">{text.policyDetails}</h3>
        <Button onClick={onClose} type="button" variant="outline">
          {text.close}
        </Button>
      </div>

      <div className="policy-detail-layout">
        <article className="console-panel policy-editor-panel">
          <div className="panel-heading">
            <h3>{text.runtimeSnapshot}</h3>
          </div>
          {model.runtimeSnapshot.loadError ? (
            <Alert variant="warning">
              <AlertDescription>{model.runtimeSnapshot.loadError}</AlertDescription>
            </Alert>
          ) : null}
          {model.runtimeSnapshot.snapshot ? (
            <RuntimeSnapshotDetail snapshot={model.runtimeSnapshot.snapshot} text={text} />
          ) : (
            <dl className="policy-summary-list">
              <div>
                <dt>{text.snapshotState}</dt>
                <dd>unavailable</dd>
              </div>
            </dl>
          )}
        </article>

        <article className="console-panel policy-editor-panel">
          <div className="panel-heading">
            <h3>{text.providerCatalog}</h3>
          </div>
          {model.providerCatalog.loadError ? (
            <Alert variant="warning">
              <AlertDescription>{model.providerCatalog.loadError}</AlertDescription>
            </Alert>
          ) : null}
          {model.providerCatalog.canonicalLoadError ? (
            <Alert variant="warning">
              <AlertDescription>{model.providerCatalog.canonicalLoadError}</AlertDescription>
            </Alert>
          ) : null}
          {model.providerCatalog.summary ? (
            <dl className="policy-summary-list">
              <div>
                <dt>{text.catalogVersion}</dt>
                <dd>{model.providerCatalog.summary.catalogVersion}</dd>
              </div>
              <div>
                <dt>{text.providerCount}</dt>
                <dd>
                  {model.providerCatalog.summary.providerCount} / {text.models}:{" "}
                  {model.providerCatalog.summary.modelCount}
                </dd>
              </div>
              <div>
                <dt>canonical by-id</dt>
                <dd>
                  {model.providerCatalog.canonicalVerified === null
                    ? "not_checked"
                    : model.providerCatalog.canonicalVerified
                      ? "verified"
                      : "mismatch"}
                </dd>
              </div>
            </dl>
          ) : (
            <dl className="policy-summary-list">
              <div>
                <dt>active catalog</dt>
                <dd>unavailable</dd>
              </div>
              <div>
                <dt>canonical by-id</dt>
                <dd>not_checked</dd>
              </div>
            </dl>
          )}
          <dl className="policy-summary-list">
            {providerOptions.map((provider) => (
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

        <article className="console-panel policy-editor-panel wide-panel">
          <div className="panel-heading">
            <h3>{text.history}</h3>
          </div>
          {model.history.loadError ? (
            <Alert variant="warning">
              <AlertDescription>{model.history.loadError}</AlertDescription>
            </Alert>
          ) : null}
          {model.history.items.length > 0 ? (
            <RuntimeHistoryTable
              activeConfigVersion={displayConfig.configVersion}
              isSubmitting={isSubmitting || rollbackTarget !== null}
              items={model.history.items}
              onRollback={onRollback}
              rollbackTarget={rollbackTarget}
              text={text}
            />
          ) : (
            <p className="empty-state">No runtime config history returned.</p>
          )}
        </article>
      </div>
    </section>
  );
}
function RuntimeSnapshotDetail({ snapshot, text }: RuntimeSnapshotDetailProps) {
  return (
    <div className="runtime-snapshot-detail">
      <dl className="policy-summary-list">
        <div>
          <dt>{text.snapshotState}</dt>
          <dd>{snapshot.runtimeState}</dd>
        </div>
        <div>
          <dt>{text.snapshotVersion}</dt>
          <dd>{snapshot.runtimeSnapshotVersion}</dd>
        </div>
        <div>
          <dt>lookup key</dt>
          <dd>
            {snapshot.lookupKey.tenantId} / {snapshot.lookupKey.projectId} /{" "}
            {snapshot.lookupKey.applicationId}
          </dd>
        </div>
        <div>
          <dt>budget scope</dt>
          <dd>
            {snapshot.budgetResolution.budgetScopeType}:{snapshot.budgetResolution.budgetScopeId} /{" "}
            {snapshot.budgetResolution.resolvedBy}
          </dd>
        </div>
        <div>
          <dt>{text.providerCatalog}</dt>
          <dd>
            {snapshot.providerCatalogRef.catalogId} / v
            {snapshot.providerCatalogRef.catalogVersion}
          </dd>
        </div>
      </dl>

      <dl className="policy-summary-list">
        <div>
          <dt>{text.budget}</dt>
          <dd>
            {formatEnabled(snapshot.policies.budget.enabled)} /{" "}
            {snapshot.policies.budget.enforcementMode} / warning{" "}
            {snapshot.policies.budget.warningThresholdPercent}%
          </dd>
        </div>
        <div>
          <dt>{text.rateLimit}</dt>
          <dd>
            {formatEnabled(snapshot.policies.rateLimit.enabled)} /{" "}
            {snapshot.policies.rateLimit.scope} / {text.maxBucketTokens}:{" "}
            {snapshot.policies.rateLimit.limit} / {text.refillRate}:{" "}
            {getRateLimitRefillTokensPerSecond(
              snapshot.policies.rateLimit.limit,
              snapshot.policies.rateLimit.windowSeconds
            )}
          </dd>
        </div>
        <div>
          <dt>{text.routing}</dt>
          <dd>
            {snapshot.policies.routing.mode} / {snapshot.policies.routing.bootstrapState} / 10{" "}
            category-difficulty cells
          </dd>
        </div>
        <div>
          <dt>{text.cache}</dt>
          <dd>
            exact {formatEnabled(snapshot.policies.cache.exactCacheEnabled)} / semantic{" "}
            {snapshot.policies.cache.semanticCacheMode}
          </dd>
        </div>
        <div>
          <dt>{text.promptCapture}</dt>
          <dd>
            {formatEnabled(snapshot.policies.promptCapture?.enabled ?? false)} /{" "}
            {snapshot.policies.promptCapture?.mode ?? "disabled"} / max{" "}
            {snapshot.policies.promptCapture?.maxChars ?? 8000}
          </dd>
        </div>
        <div>
          <dt>{text.detectors}</dt>
          <dd>
            {formatEnabled(snapshot.policies.safety.enabled)} / {snapshot.policies.safety.mode} / request-side{" "}
            {formatEnabled(snapshot.policies.safety.requestSideRequired)} / detectors{" "}
            {formatDetectorSet(snapshot.policies.safety.detectorSet)}
          </dd>
        </div>
        <div>
          <dt>{text.streaming}</dt>
          <dd>
            {formatEnabled(snapshot.policies?.streaming?.enabled)} / thin slice{" "}
            {formatEnabled(snapshot.policies?.streaming?.thinSliceOnly)}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function RuntimeHistoryTable({
  activeConfigVersion,
  isSubmitting,
  items,
  onRollback,
  rollbackTarget,
  text
}: RuntimeHistoryTableProps) {
  return (
    <div className="table-wrap">
      <table className="data-table policy-config-table">
        <thead>
          <tr>
            <th>{text.configVersion}</th>
            <th>{text.mode}</th>
            <th>{text.publishedAt}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const isActive = item.configVersion === activeConfigVersion;
            const isRollingBack = rollbackTarget === item.configVersion;

            return (
              <tr key={item.id}>
                <td>
                  <strong className="provider-name">{item.configVersion}</strong>
                  <span className="project-muted">
                    {item.effectiveAt ? formatDateTime(item.effectiveAt) : "-"}
                  </span>
                </td>
                <td>{item.publishState}</td>
                <td>{item.publishedAt ? formatDateTime(item.publishedAt) : "-"}</td>
                <td>
                  <div className="project-row-actions">
                    <Button
                      disabled={isSubmitting || isActive || !item.canRollback}
                      onClick={() => onRollback(item.configVersion)}
                      type="button"
                      variant="outline"
                    >
                      {isRollingBack ? "..." : text.rollback}
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function formatDetectorSet(detectorSet: RuntimePolicySnapshot["policies"]["safety"]["detectorSet"]) {
  if (!detectorSet || detectorSet.length === 0) {
    return "none";
  }

  return detectorSet
    .map((detector) => `${detector.detectorType}:${detector.action}`)
    .join(", ");
}
