// Shared "thin handler" builder: HTTP request -> EngineRequest -> runtime.run -> HTTP response.
// Handlers contain no business logic; every decision (auth, MFA, validation, limits) is made by the engine.
// The path and method of each handler come from the frozen route table (API_ROUTES).
import { HttpResponse, http } from 'msw';
import type { HttpHandler } from 'msw';
import type { EngineRequest, EngineResponse } from '../contracts/engine';
import type { MockRuntime } from '../contracts/runtime';
import { API_ROUTES } from '../contracts/routes';
import type { RouteKey } from '../contracts/routes';
import { problemBody } from '../engine/http';

/** Only `run` is needed, so tests can pass a recording fake. */
export type RuntimeLike = Pick<MockRuntime, 'run'>;

/** Handler-level errors use the engine's problem shape too (F21): `type` = `/problems/<code>`, title from the status. */
function problemResponse(status: number, code: string, detail?: string): Response {
  return HttpResponse.json(problemBody(status, code, detail), {
    status,
    headers: { 'Content-Type': 'application/problem+json' },
  });
}

/** `Authorization: Bearer <token>` -> token, else null. */
function bearerToken(request: Request): string | null {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') ?? '');
  return m ? (m[1] ?? '').trim() || null : null;
}

/**
 * msw path params can be string or string[]; the engine contract wants strings.
 * Only the named `:param` segments of the route are kept (the `*` origin wildcard shows up as param "0" and is dropped).
 */
function flattenParams(path: string, params: Record<string, string | readonly string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name] of path.matchAll(/:([A-Za-z_]+)/g)) {
    const v = name === undefined ? undefined : params[name];
    if (name !== undefined && v !== undefined) out[name] = typeof v === 'string' ? v : v.join('/');
  }
  return out;
}

function toHttpResponse(res: EngineResponse): Response {
  const headers = new Headers(res.headers);
  // 204/205 must not carry a body.
  if (res.status === 204 || res.status === 205 || res.body === null || res.body === undefined) {
    return new HttpResponse(null, { status: res.status, headers });
  }
  if (res.status >= 400 && !headers.has('Content-Type')) headers.set('Content-Type', 'application/problem+json');
  // Make Retry-After available as a real header when the engine only put it in the problem body.
  const retryAfter = (res.body as { retry_after_s?: unknown }).retry_after_s;
  if ((res.status === 429 || res.status === 503) && typeof retryAfter === 'number' && !headers.has('Retry-After')) {
    headers.set('Retry-After', String(Math.ceil(retryAfter)));
  }
  return HttpResponse.json(res.body as Parameters<typeof HttpResponse.json>[0], { status: res.status, headers });
}

/** Builds the msw handler for one route key. The `*` prefix makes it independent of the page origin / API base. */
export function engineHandler(key: RouteKey, runtime: RuntimeLike): HttpHandler {
  const def = API_ROUTES[key];
  const register = def.method === 'GET' ? http.get : http.post;
  return register(`*${def.path}`, async ({ request, params }) => {
    let body: unknown = null;
    if (def.method === 'POST') {
      const text = await request.text();
      if (text.trim() !== '') {
        try {
          body = JSON.parse(text);
        } catch {
          return problemResponse(400, 'INVALID_REQUEST', 'Request body is not valid JSON.');
        }
      }
    }
    const req: EngineRequest = {
      route: key,
      token: bearerToken(request),
      params: flattenParams(def.path, params),
      query: Object.fromEntries(new URL(request.url).searchParams),
      body,
      mfa: request.headers.get('X-Demo-MFA'),
    };
    try {
      return toHttpResponse(await runtime.run(req));
    } catch (e) {
      return problemResponse(500, 'INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
    }
  });
}

/** Handlers for a list of keys, in the given order (register static paths before parameterised ones). */
export function handlersFor(keys: readonly RouteKey[], runtime: RuntimeLike): HttpHandler[] {
  return keys.map((k) => engineHandler(k, runtime));
}
