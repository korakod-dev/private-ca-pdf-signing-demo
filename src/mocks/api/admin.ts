// Real-contract handlers: admin status/audit, CRL issuance and account closing (MFA header forwarded to the engine).
import type { RouteKey } from '../../contracts/routes';
import { handlersFor } from '../engineHandler';
import type { RuntimeLike } from '../engineHandler';

export const ADMIN_KEYS = [
  'admin.status',
  'admin.audit',
  'admin.crlIssue',
  'admin.closeAccount',
] as const satisfies readonly RouteKey[];

export const adminHandlers = (runtime: RuntimeLike) => handlersFor(ADMIN_KEYS, runtime);
