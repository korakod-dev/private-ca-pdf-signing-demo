// Real-contract handlers: authentication (assumptions A5/A6: two-step login, then MFA ticket -> token).
import type { RouteKey } from '../../contracts/routes';
import { handlersFor } from '../engineHandler';
import type { RuntimeLike } from '../engineHandler';

export const AUTH_KEYS = ['auth.login', 'auth.mfa', 'auth.me', 'auth.logout'] as const satisfies readonly RouteKey[];

export const authHandlers = (runtime: RuntimeLike) => handlersFor(AUTH_KEYS, runtime);
