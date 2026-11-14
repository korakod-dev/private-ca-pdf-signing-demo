// Demo-only handlers: everything under /api/v1/demo/*. These do not exist in a real backend.
// `demo.reset` is answered by the runtime itself (it wipes storage); the handler is still the same thin forwarder.
import type { RouteKey } from '../../contracts/routes';
import { handlersFor } from '../engineHandler';
import type { RuntimeLike } from '../engineHandler';

export const DEMO_KEYS = [
  'demo.status',
  'demo.clock',
  'demo.faults',
  'demo.reset',
  'demo.personas',
  'demo.persona',
  'demo.samples',
  'demo.mailbox',
  'demo.progress',
  'demo.workstation',
  'demo.keygen',
] as const satisfies readonly RouteKey[];

export const demoHandlers = (runtime: RuntimeLike) => handlersFor(DEMO_KEYS, runtime);
