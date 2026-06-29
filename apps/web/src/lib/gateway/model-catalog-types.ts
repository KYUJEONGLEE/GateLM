export type ModelCatalogSource = "gateway";

export type ModelCatalogItem = {
  alias: string | null;
  allowed: boolean | null;
  capabilities: string[];
  createdAt: string | null;
  id: string;
  object: string;
  ownedBy: string;
  provider: string | null;
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
  loadError: string | null;
  meta: ModelCatalogGatewayMeta;
  models: ModelCatalogItem[];
  routeTenantId: string;
  source: ModelCatalogSource;
};
