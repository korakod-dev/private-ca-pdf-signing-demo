// Low-level HTTP helper shared by the real-contract client and the demo client.
// It resolves method + path from the frozen route table (API_ROUTES), so client modules only name route KEYS.
// It knows nothing about mocks: the same code talks to MSW (mock mode) or a real backend (live mode).
import type { ApiError, ApiResult } from '../contracts/api-client';
import type { ProblemDto } from '../contracts/api';
import { API_ROUTES } from '../contracts/routes';
import type { RouteKey } from '../contracts/routes';

export interface HttpConfig {
  /** Prepended to every path (VITE_API_BASE, default ''). */
  baseUrl: string;
  /** Bearer token for `Authorization`, or null. Read on every call. */
  getToken: () => string | null;
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface CallOptions {
  /** Values for `:param` segments in the path (URL-encoded here). */
  params?: Record<string, string>;
  query?: Record<string, string>;
  /** JSON body (POST). */
  body?: unknown;
  /** Sent as `X-Demo-MFA`. */
  mfa?: string;
}

export interface Http {
  call<T>(key: RouteKey, options?: CallOptions): Promise<ApiResult<T>>;
}

/** Substitutes `:name` segments. A missing param is a programming error, not a runtime condition. */
function fillPath(path: string, params: Record<string, string> = {}): string {
  return path.replace(/:([A-Za-z_]+)/g, (_m, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing path parameter "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
}

function isProblem(v: unknown): v is ProblemDto {
  if (typeof v !== 'object' || v === null) return false;
  const p = v as Record<string, unknown>;
  return typeof p.code === 'string' && typeof p.title === 'string' && typeof p.status === 'number';
}

/** `Retry-After` is either delay-seconds or an HTTP date; only the seconds form is used (the demo clock is simulated). */
function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const s = Number(header.trim());
  return Number.isFinite(s) && s >= 0 ? s : undefined;
}

function networkError(e: unknown): ApiResult<never> {
  const error: ApiError = {
    status: 0,
    code: 'NETWORK_ERROR',
    title: 'No response from the server',
    detail: e instanceof Error ? e.message : String(e),
    problem: null,
  };
  return { ok: false, error };
}

export function createHttp(config: HttpConfig): Http {
  return {
    async call<T>(key: RouteKey, options: CallOptions = {}): Promise<ApiResult<T>> {
      const def = API_ROUTES[key];
      // baseUrl '' => relative URL (same origin), which is what the browser needs.
      const query = options.query && Object.keys(options.query).length > 0 ? `?${new URLSearchParams(options.query)}` : '';
      const target = config.baseUrl + fillPath(def.path, options.params) + query;

      const headers: Record<string, string> = { Accept: 'application/json, application/problem+json' };
      const token = config.getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      if (options.mfa !== undefined) headers['X-Demo-MFA'] = options.mfa;
      const init: RequestInit = { method: def.method, headers };
      if (def.method === 'POST' && options.body !== undefined) {
        headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(options.body);
      }

      let res: Response;
      try {
        res = await (config.fetchImpl ?? fetch)(target, init);
      } catch (e) {
        return networkError(e);
      }

      // Body: empty (204 etc.) => null; otherwise JSON.
      const text = await res.text();
      let parsed: unknown = null;
      if (text.trim() !== '') {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = undefined; // marks "unparseable"
        }
      }

      if (res.ok) {
        if (parsed === undefined) {
          return {
            ok: false,
            error: { status: res.status, code: 'INVALID_RESPONSE', title: 'Response is not valid JSON', problem: null },
          };
        }
        return { ok: true, status: res.status, data: parsed as T };
      }

      const problem = isProblem(parsed) ? parsed : null;
      const retryAfter = parseRetryAfter(res.headers.get('Retry-After')) ?? problem?.retry_after_s;
      const error: ApiError = {
        status: res.status,
        code: problem?.code ?? 'HTTP_ERROR',
        title: problem?.title ?? (res.statusText || `HTTP ${res.status}`),
        ...(problem?.detail !== undefined ? { detail: problem.detail } : {}),
        ...(retryAfter !== undefined ? { retry_after_s: retryAfter } : {}),
        ...(problem?.locked_until !== undefined ? { locked_until: problem.locked_until } : {}),
        problem,
      };
      return { ok: false, error };
    },
  };
}
