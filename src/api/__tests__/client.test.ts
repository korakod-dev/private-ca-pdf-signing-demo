// Client tests: problem+json -> ApiError, Retry-After parsing, token header, network errors, 204 handling.
// Uses msw/node with ad-hoc handlers (no runtime involved).
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { createHttp } from '../http';
import { createApiClient } from '../real';
import { createDemoApi } from '../demo';
import { api as defaultApi, configureApi, currentApiConfig, demoApi as defaultDemoApi } from '../index';

const BASE = 'http://localhost:3998';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const problem = (status: number, code: string, extra: Record<string, unknown> = {}) => ({ type: 'about:blank', title: `T-${code}`, status, code, ...extra });
const client = (getToken: () => string | null = () => null) => {
  const h = createHttp({ baseUrl: BASE, getToken });
  return { api: createApiClient(h), demo: createDemoApi(h) };
};

describe('success results', () => {
  it('returns ok + status + parsed data', async () => {
    server.use(http.post(`${BASE}/api/v1/verify`, () => HttpResponse.json({ job_id: 'job-0001', status: 'queued' }, { status: 202 })));
    const r = await client().api.verify.create({ fixture_id: 'D01' });
    expect(r).toEqual({ ok: true, status: 202, data: { job_id: 'job-0001', status: 'queued' } });
  });

  it('maps an empty 204 to data null', async () => {
    server.use(http.post(`${BASE}/api/v1/auth/logout`, () => new HttpResponse(null, { status: 204 })));
    expect(await client().api.auth.logout()).toEqual({ ok: true, status: 204, data: null });
  });

  it('reports INVALID_RESPONSE for a 2xx that is not JSON', async () => {
    server.use(http.get(`${BASE}/api/v1/status`, () => new HttpResponse('<html>', { status: 200 })));
    const r = await client().api.status.get();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('INVALID_RESPONSE');
  });
});

describe('errors', () => {
  it('parses problem+json into ApiError (status, code, title, detail, problem)', async () => {
    const body = problem(422, 'ENCRYPTED_PDF', { detail: 'encrypted' });
    server.use(http.post(`${BASE}/api/v1/verify`, () => HttpResponse.json(body, { status: 422, headers: { 'Content-Type': 'application/problem+json' } })));
    const r = await client().api.verify.create({ fixture_id: 'D10' });
    expect(r).toEqual({ ok: false, error: { status: 422, code: 'ENCRYPTED_PDF', title: 'T-ENCRYPTED_PDF', detail: 'encrypted', problem: body } });
  });

  it('prefers the Retry-After header over retry_after_s in the body', async () => {
    server.use(http.post(`${BASE}/api/v1/verify`, () => HttpResponse.json(problem(429, 'RATE_LIMITED', { retry_after_s: 60 }), { status: 429, headers: { 'Retry-After': '17' } })));
    const r = await client().api.verify.create({ fixture_id: 'D01' });
    expect(!r.ok && r.error.retry_after_s).toBe(17);
  });

  it('falls back to retry_after_s from the body, and ignores an HTTP-date Retry-After', async () => {
    server.use(http.post(`${BASE}/api/v1/verify`, () => HttpResponse.json(problem(503, 'QUEUE_FULL', { retry_after_s: 5 }), { status: 503, headers: { 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' } })));
    const r = await client().api.verify.create({ fixture_id: 'D01' });
    expect(!r.ok && r.error.retry_after_s).toBe(5);
  });

  it('keeps locked_until from 423 ACCOUNT_LOCKED', async () => {
    server.use(http.post(`${BASE}/api/v1/auth/login`, () => HttpResponse.json(problem(423, 'ACCOUNT_LOCKED', { locked_until: '2026-11-12T09:05:00+07:00' }), { status: 423 })));
    const r = await client().api.auth.login({ email: 'a', password: 'b' });
    expect(!r.ok && r.error.locked_until).toBe('2026-11-12T09:05:00+07:00');
    expect(!r.ok && r.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('builds a generic ApiError when the error body is not problem+json', async () => {
    server.use(http.get(`${BASE}/api/v1/status`, () => new HttpResponse('boom', { status: 502, statusText: 'Bad Gateway' })));
    const r = await client().api.status.get();
    expect(r).toMatchObject({ ok: false, error: { status: 502, code: 'HTTP_ERROR', problem: null } });
  });

  it('reports NETWORK_ERROR (status 0) when there is no response', async () => {
    server.use(http.get(`${BASE}/api/v1/status`, () => HttpResponse.error()));
    const r = await client().api.status.get();
    expect(r).toMatchObject({ ok: false, error: { status: 0, code: 'NETWORK_ERROR', problem: null } });
  });
});

describe('request headers', () => {
  it('sends Authorization: Bearer only when a token exists, read on every call', async () => {
    const seen: (string | null)[] = [];
    server.use(http.get(`${BASE}/api/v1/auth/me`, ({ request }) => {
      seen.push(request.headers.get('Authorization'));
      return HttpResponse.json({});
    }));
    let token: string | null = null;
    const c = client(() => token).api;
    await c.auth.me();
    token = 'tok-1';
    await c.auth.me();
    expect(seen).toEqual([null, 'Bearer tok-1']);
  });

  it('sends X-Demo-MFA and a JSON content type on a POST with body', async () => {
    let headers: Headers | undefined;
    server.use(http.post(`${BASE}/api/v1/admin/crl/issue`, ({ request }) => {
      headers = request.headers;
      return HttpResponse.json({});
    }));
    await client().api.admin.crlIssue('246810');
    expect(headers?.get('X-Demo-MFA')).toBe('246810');
  });

  it('URL-encodes path params (serial with colons) and decodes them on the other side', async () => {
    let seenParam: unknown;
    server.use(http.get(`${BASE}/api/v1/certs/:serial`, ({ params }) => {
      seenParam = params.serial;
      return HttpResponse.json({});
    }));
    await client().api.certs.get('DE:M0:4F:2A:91:01');
    expect(seenParam).toBe('DE:M0:4F:2A:91:01');
  });
});

describe('default instances and configureApi', () => {
  it('exposes api and demoApi with every namespace/method from the contract', () => {
    expect(Object.keys(defaultApi).sort()).toEqual(['admin', 'archive', 'auth', 'certRequests', 'certs', 'pki', 'status', 'users', 'verify']);
    expect(Object.keys(defaultDemoApi).sort()).toEqual(
      ['keygen', 'mailbox', 'personas', 'progress', 'reset', 'samples', 'setClock', 'setFaults', 'sign', 'signReview', 'status', 'switchPersona', 'workstation'],
    );
  });

  it('configureApi swaps the token getter used by the default client', () => {
    const getToken = () => 'abc';
    configureApi({ getToken });
    expect(currentApiConfig().getToken()).toBe('abc');
    configureApi({ getToken: () => null });
  });

  it('is not a thenable (await api resolves immediately)', async () => {
    expect(await Promise.resolve(defaultApi)).toBe(defaultApi);
  });
});
