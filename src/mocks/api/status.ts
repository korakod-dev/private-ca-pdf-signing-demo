// Real-contract handlers: public service status for the home page (A28).
import type { RouteKey } from '../../contracts/routes';
import { handlersFor } from '../engineHandler';
import type { RuntimeLike } from '../engineHandler';

export const STATUS_KEYS = ['status.public'] as const satisfies readonly RouteKey[];

export const statusHandlers = (runtime: RuntimeLike) => handlersFor(STATUS_KEYS, runtime);
