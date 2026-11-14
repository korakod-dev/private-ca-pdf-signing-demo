// Real-contract handlers (valid against a real backend too). Demo-only routes live in ../demo-only and must never
// appear here (enforced by src/mocks/__tests__/separation.test.ts).
import type { RouteKey } from '../../contracts/routes';
import type { RuntimeLike } from '../engineHandler';
import { ADMIN_KEYS, adminHandlers } from './admin';
import { ARCHIVE_KEYS, archiveHandlers } from './archive';
import { AUTH_KEYS, authHandlers } from './auth';
import { CERT_KEYS, certHandlers } from './certs';
import { CERT_REQUEST_KEYS, certRequestHandlers } from './certRequests';
import { PKI_KEYS, pkiHandlers } from './pki';
import { STATUS_KEYS, statusHandlers } from './status';
import { VERIFY_KEYS, verifyHandlers } from './verify';

/** Every route key served by this folder (used by the coverage test). */
export const API_HANDLER_KEYS: readonly RouteKey[] = [
  ...AUTH_KEYS,
  ...STATUS_KEYS,
  ...VERIFY_KEYS,
  ...CERT_REQUEST_KEYS,
  ...CERT_KEYS,
  ...PKI_KEYS,
  ...ARCHIVE_KEYS,
  ...ADMIN_KEYS,
];

export function createApiHandlers(runtime: RuntimeLike) {
  return [
    ...authHandlers(runtime),
    ...statusHandlers(runtime),
    ...verifyHandlers(runtime),
    ...certRequestHandlers(runtime),
    ...certHandlers(runtime),
    ...pkiHandlers(runtime),
    ...archiveHandlers(runtime),
    ...adminHandlers(runtime),
  ];
}
