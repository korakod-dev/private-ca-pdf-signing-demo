// Real-contract handlers: CA list, CRL and OCSP views (stand-ins for /crl/*.crl and /ocsp).
import type { RouteKey } from '../../contracts/routes';
import { handlersFor } from '../engineHandler';
import type { RuntimeLike } from '../engineHandler';

export const PKI_KEYS = ['pki.cas', 'pki.crl', 'pki.ocsp'] as const satisfies readonly RouteKey[];

export const pkiHandlers = (runtime: RuntimeLike) => handlersFor(PKI_KEYS, runtime);
