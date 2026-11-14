// Real-contract handlers: certificates (list/get/revoke/renew/finalize).
import type { RouteKey } from '../../contracts/routes';
import { handlersFor } from '../engineHandler';
import type { RuntimeLike } from '../engineHandler';

export const CERT_KEYS = [
  'certs.list',
  'certs.get',
  'certs.revoke',
  'certs.renew',
  'certs.finalize',
] as const satisfies readonly RouteKey[];

export const certHandlers = (runtime: RuntimeLike) => handlersFor(CERT_KEYS, runtime);
