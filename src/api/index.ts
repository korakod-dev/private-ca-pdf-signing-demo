// API client entry point (contract: src/contracts/api-client.ts).
// UI code imports `api`, `demoApi` and `configureApi` from here and never knows whether the answers come from the
// MSW mock (VITE_API_MODE=mock, default) or from a real backend (VITE_API_MODE=live). Only VITE_API_BASE differs.
import type { ApiClientConfig, ApiClient, DemoApi } from '../contracts/api-client';
import { API_BASE } from '../config/env';
import { createDemoApi } from './demo';
import { createHttp } from './http';
import { createApiClient } from './real';

let config: ApiClientConfig = { getToken: () => null };

/** Wires the token getter (called by the store). */
export function configureApi(next: ApiClientConfig): void {
  config = next;
}

/** Current config (read-only helper, kept from the Stage 0 stub). */
export function currentApiConfig(): ApiClientConfig {
  return config;
}

// The token getter is resolved on every call, so `configureApi` can be called after module load.
const http = createHttp({ baseUrl: API_BASE, getToken: () => config.getToken() });

export const api: ApiClient = createApiClient(http);
export const demoApi: DemoApi = createDemoApi(http);

// Building blocks for tests and alternative wiring.
export { createHttp } from './http';
export type { Http, HttpConfig, CallOptions } from './http';
export { createApiClient } from './real';
export { createDemoApi } from './demo';
