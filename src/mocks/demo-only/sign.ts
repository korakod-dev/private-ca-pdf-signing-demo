// Demo-only handlers: the sign desk (/api/v1/sign/review and /api/v1/sign). A real system signs on the user's machine,
// so these routes must not exist in a real backend.
import type { RouteKey } from '../../contracts/routes';
import { handlersFor } from '../engineHandler';
import type { RuntimeLike } from '../engineHandler';

// Order matters: `/sign/review` before `/sign` is not required (exact paths) but keeps the list readable.
export const SIGN_KEYS = ['sign.review', 'sign.commit'] as const satisfies readonly RouteKey[];

export const signHandlers = (runtime: RuntimeLike) => handlersFor(SIGN_KEYS, runtime);
