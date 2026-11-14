// Role lists for the lifecycle pages. They mirror the engine access policy (src/engine/routes.ts ACCESS table):
//   certRequests.create / certs.renew / certs.finalize -> signer, new_user, user (REQUESTERS)
//   certRequests.approve / reject, certs.revoke by an admin, admin.closeAccount -> admin-a only (A12: admin-b is a read-only auditor)
import type { Role } from '../../contracts/fixtures';

/** Personas that can hold a certificate and request/renew/finalize one. */
export const REQUESTER_ROLES: readonly Role[] = ['signer', 'new_user', 'user'];

/** The only role that approves, rejects and revokes (spec 7.2, A12). */
export const ADMIN_A_ROLES: readonly Role[] = ['admin-a'];
