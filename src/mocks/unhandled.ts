// Unhandled-request policy for the mock worker: a request to /api/* that no handler answers is an error (it means the
// UI calls a route the contract does not have); everything else (assets, fonts, previews, the SW script) is bypassed.
// msw 3 API: `onUnhandledFrame` callback. Note that `defaults.error()` only prints; to actually fail the request the
// callback must throw.

/** Minimal structural view of msw's callback argument (keeps this file unit-testable without msw internals). */
export interface UnhandledFrameArgs {
  frame: { protocol: string; data: unknown };
  defaults: { error: () => void | Promise<void> };
}

export async function unhandledApiGuard({ frame, defaults }: UnhandledFrameArgs): Promise<void> {
  if (frame.protocol !== 'http') return;
  const request = (frame.data as { request?: Request }).request;
  if (!request) return;
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith('/api/')) return; // bypass
  await defaults.error();
  throw new Error(`Unhandled mock API request: ${request.method} ${pathname}`);
}
