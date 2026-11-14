// Real-contract handlers: verification jobs (spec 7.10: POST /verify -> 202, GET /verify/{job_id}).
import type { RouteKey } from '../../contracts/routes';
import { handlersFor } from '../engineHandler';
import type { RuntimeLike } from '../engineHandler';

export const VERIFY_KEYS = ['verify.create', 'verify.get'] as const satisfies readonly RouteKey[];

export const verifyHandlers = (runtime: RuntimeLike) => handlersFor(VERIFY_KEYS, runtime);
