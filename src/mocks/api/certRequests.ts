// Real-contract handlers: certificate requests. approve/reject need the `X-Demo-MFA` header (forwarded to the engine).
import type { RouteKey } from '../../contracts/routes';
import { handlersFor } from '../engineHandler';
import type { RuntimeLike } from '../engineHandler';

// Order matters: the static `/cert-requests/appointments` must be registered before `/cert-requests/:id`.
export const CERT_REQUEST_KEYS = [
  'certRequests.appointments',
  'certRequests.create',
  'certRequests.list',
  'certRequests.get',
  'certRequests.approve',
  'certRequests.reject',
] as const satisfies readonly RouteKey[];

export const certRequestHandlers = (runtime: RuntimeLike) => handlersFor(CERT_REQUEST_KEYS, runtime);
