export type ModelCatalogSource = "control-plane" | "gateway" | "gateway+control-plane";

export type ModelCatalogItem = {
  alias: string | null;
  allowed: boolean | null;
  apiVersion: string | null;
  adapterType: string | null;
  autoRoutingEligible: boolean | null;
  costTier: string | null;
  capabilities: string[];
  createdAt: string | null;
  credentialRequired: boolean | null;
  credentialState: string | null;
  fallbackEligible: boolean | null;
  fallbackPriority: number | null;
  id: string;
  object: string;
  ownedBy: string;
  provider: string | null;
  requestFormat: string | null;
  source: ModelCatalogSource;
  timeoutMs: number | null;
};

export type ModelCatalogGatewayMeta = {
  cacheStatus: string | null;
  httpStatus: number | null;
  maskingAction: string | null;
  requestId: string | null;
  routedModel: string | null;
  routedProvider: string | null;
};

export type ModelCatalogModel = {
  controlPlaneLoadError: string | null;
  loadError: string | null;
  meta: ModelCatalogGatewayMeta;
  models: ModelCatalogItem[];
  routeTenantId: string;
  source: ModelCatalogSource;
};
