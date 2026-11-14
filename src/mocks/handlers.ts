// MSW handler aggregator.
// Real-contract handlers live in ./api, demo-only handlers (/api/v1/demo/*, /api/v1/sign*) in ./demo-only.
import type { HttpHandler } from 'msw';
import { createApiHandlers } from './api';
import { createDemoOnlyHandlers } from './demo-only';
import type { RuntimeLike } from './engineHandler';

export function createHandlers(runtime: RuntimeLike): HttpHandler[] {
  return [...createApiHandlers(runtime), ...createDemoOnlyHandlers(runtime)];
}
