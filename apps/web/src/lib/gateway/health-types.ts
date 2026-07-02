export type GatewayEndpointStatus = "error" | "ok" | "ready" | "unknown";

export type GatewayDependencyStatus = {
  message: string | null;
  name: string;
  required: boolean | null;
  status: string;
};

export type GatewayHealthEndpoint = {
  checkedAt: string;
  httpStatus: number | null;
  loadError: string | null;
  service: string | null;
  status: GatewayEndpointStatus;
  time: string | null;
};

export type GatewayHealthModel = {
  checkedAt: string;
  controlPlane: {
    baseUrl: string;
    healthz: GatewayHealthEndpoint;
    readyz: GatewayHealthEndpoint & {
      dependencies: GatewayDependencyStatus[];
    };
  };
  healthz: GatewayHealthEndpoint;
  readyz: GatewayHealthEndpoint & {
    dependencies: GatewayDependencyStatus[];
  };
  routeTenantId: string;
  summary: {
    dependencyCount: number;
    failingDependencyCount: number;
    isControlPlaneAlive: boolean;
    isControlPlaneReady: boolean;
    isAlive: boolean;
    isReady: boolean;
    requiredDependencyCount: number;
  };
};
