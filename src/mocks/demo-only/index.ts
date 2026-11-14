// Demo-only handlers: /api/v1/demo/* and /api/v1/sign*. Kept apart from ../api so a real backend can be swapped in.
import type { RouteKey } from '../../contracts/routes';
import type { RuntimeLike } from '../engineHandler';
import { DEMO_KEYS, demoHandlers } from './demo';
import { SIGN_KEYS, signHandlers } from './sign';

/** Every route key served by this folder (used by the coverage test). */
export const DEMO_ONLY_HANDLER_KEYS: readonly RouteKey[] = [...DEMO_KEYS, ...SIGN_KEYS];

export function createDemoOnlyHandlers(runtime: RuntimeLike) {
  return [...demoHandlers(runtime), ...signHandlers(runtime)];
}
