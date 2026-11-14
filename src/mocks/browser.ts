// MSW browser worker: wires fixtures + engine + localStorage into a runtime and starts the Service Worker.
// Imported dynamically by src/main.tsx in mock mode only (never in a live build).
import { setupWorker } from 'msw/browser';
import { createEngine } from '../engine';
import { fixtures } from '../fixtures';
import { webCryptoHasher } from '../lib/hashChain';
import { createHandlers } from './handlers';
import { createRuntime } from './runtime';
import { unhandledApiGuard } from './unhandled';

/** URL of the msw worker script (generated into public/ by `npx msw init public`). */
export const WORKER_URL = '/mockServiceWorker.js';

/**
 * Creates the runtime and starts the worker. Resolves when the worker controls the page, so the first fetch is
 * already answered by the mock. Rejects when Service Workers or localStorage are unavailable (main.tsx shows a notice).
 */
export async function startMockWorker(): Promise<void> {
  const runtime = createRuntime({
    engine: createEngine(), // created here (not at import time) so a failure surfaces in the notice path
    storage: window.localStorage,
    wallNow: () => Date.now(),
    hasher: webCryptoHasher,
    fixtures,
  });
  const worker = setupWorker(...createHandlers(runtime));
  await worker.start({
    serviceWorker: { url: WORKER_URL },
    onUnhandledFrame: unhandledApiGuard, // error for /api/*, bypass for everything else
    quiet: true,
  });
}
