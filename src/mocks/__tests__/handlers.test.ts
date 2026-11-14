// Handler tests: msw/node + the REAL client + a recording fake runtime.
// Every RouteKey must be reached (exactly once in the table) with the right method, path, token, params, body and
// X-Demo-MFA. Method + path are asserted against literals copied from spec 7.10 / plan 3.5, not derived from the code under test.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import type { EngineRequest, EngineResponse } from '../../contracts/engine';
import { API_ROUTES } from '../../contracts/routes';
import type { RouteKey } from '../../contracts/routes';
import type { ApiClient, DemoApi } from '../../contracts/api-client';
import { createDemoApi } from '../../api/demo';
import { createHttp } from '../../api/http';
import { createApiClient } from '../../api/real';
import { createHandlers } from '../handlers';
import { API_HANDLER_KEYS } from '../api';
import { DEMO_ONLY_HANDLER_KEYS } from '../demo-only';

const BASE = 'http://localhost:3999';
const TOKEN = 'demo-token-u-somchai-1';
const MFA = '246810';
const SERIAL = 'DE:M0:4F:2A:91:01';

// --- recording fake runtime -------------------------------------------------------------------------------------
const received: EngineRequest[] = [];
let nextResponse: EngineResponse = { status: 200, body: { ok: true } };
const runtime = {
  run: async (req: EngineRequest): Promise<EngineResponse> => {
    received.push(req);
    return nextResponse;
  },
};

const server = setupServer(...createHandlers(runtime));
const seenHttp: { method: string; path: string }[] = [];
server.events.on('request:start', (event) => {
  const { request } = event as unknown as { request: Request };
  seenHttp.push({ method: request.method, path: new URL(request.url).pathname });
});

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterEach(() => {
  server.resetHandlers();
  received.length = 0;
  seenHttp.length = 0;
  nextResponse = { status: 200, body: { ok: true } };
});
afterAll(() => server.close());

let token: string | null = TOKEN;
const http = createHttp({ baseUrl: BASE, getToken: () => token });
const api: ApiClient = createApiClient(http);
const demoApi: DemoApi = createDemoApi(http);

// --- the table: one row per RouteKey ------------------------------------------------------------------------------
interface Row {
  key: RouteKey;
  method: 'GET' | 'POST';
  /** Literal path as the browser sends it (":" in serials is percent-encoded by the client). */
  path: string;
  call: () => Promise<unknown>;
  params?: Record<string, string>;
  body?: unknown;
  mfa?: string;
}

const csr = { csr_pem: '-----DEMO CSR-----', appointment_id: 'slot-1' };
const ENC_SERIAL = encodeURIComponent(SERIAL);

const rows: Row[] = [
  { key: 'auth.login', method: 'POST', path: '/api/v1/auth/login', body: { email: 'somchai@lab.korakod.dev', password: 'demo-password' }, call: () => api.auth.login({ email: 'somchai@lab.korakod.dev', password: 'demo-password' }) },
  { key: 'auth.mfa', method: 'POST', path: '/api/v1/auth/mfa', body: { mfa_ticket: 't-1', code: MFA }, call: () => api.auth.mfa({ mfa_ticket: 't-1', code: MFA }) },
  { key: 'auth.me', method: 'GET', path: '/api/v1/auth/me', call: () => api.auth.me() },
  { key: 'auth.logout', method: 'POST', path: '/api/v1/auth/logout', call: () => api.auth.logout() },
  { key: 'status.public', method: 'GET', path: '/api/v1/status', call: () => api.status.get() },
  { key: 'verify.create', method: 'POST', path: '/api/v1/verify', body: { fixture_id: 'D01' }, call: () => api.verify.create({ fixture_id: 'D01' }) },
  { key: 'verify.get', method: 'GET', path: '/api/v1/verify/job-0001', params: { job_id: 'job-0001' }, call: () => api.verify.get('job-0001') },
  { key: 'certRequests.appointments', method: 'GET', path: '/api/v1/cert-requests/appointments', call: () => api.certRequests.appointments() },
  { key: 'certRequests.create', method: 'POST', path: '/api/v1/cert-requests', body: csr, call: () => api.certRequests.create(csr) },
  { key: 'certRequests.list', method: 'GET', path: '/api/v1/cert-requests', call: () => api.certRequests.list() },
  { key: 'certRequests.get', method: 'GET', path: '/api/v1/cert-requests/req-manop-01', params: { id: 'req-manop-01' }, call: () => api.certRequests.get('req-manop-01') },
  { key: 'certRequests.approve', method: 'POST', path: '/api/v1/cert-requests/req-0001/approve', params: { id: 'req-0001' }, body: { checklist: [true, true, true, true, true] }, mfa: MFA, call: () => api.certRequests.approve('req-0001', { checklist: [true, true, true, true, true] }, MFA) },
  { key: 'certRequests.reject', method: 'POST', path: '/api/v1/cert-requests/req-manop-01/reject', params: { id: 'req-manop-01' }, body: { reason_code: 'csr_check_failed', note: 'wrong name' }, mfa: MFA, call: () => api.certRequests.reject('req-manop-01', { reason_code: 'csr_check_failed', note: 'wrong name' }, MFA) },
  { key: 'certs.list', method: 'GET', path: '/api/v1/certs', call: () => api.certs.list() },
  { key: 'certs.get', method: 'GET', path: `/api/v1/certs/${ENC_SERIAL}`, params: { serial: SERIAL }, call: () => api.certs.get(SERIAL) },
  { key: 'certs.revoke', method: 'POST', path: `/api/v1/certs/${ENC_SERIAL}/revoke`, params: { serial: SERIAL }, body: { reason: 'keyCompromise', invalidity_date: '2026-10-15T09:00:00+07:00' }, mfa: MFA, call: () => api.certs.revoke(SERIAL, { reason: 'keyCompromise', invalidity_date: '2026-10-15T09:00:00+07:00' }, MFA) },
  { key: 'certs.renew', method: 'POST', path: `/api/v1/certs/${ENC_SERIAL}/renew`, params: { serial: SERIAL }, body: { csr_pem: 'csr' }, call: () => api.certs.renew(SERIAL, { csr_pem: 'csr' }) },
  { key: 'certs.finalize', method: 'POST', path: `/api/v1/certs/${ENC_SERIAL}/finalize`, params: { serial: SERIAL }, call: () => api.certs.finalize(SERIAL) },
  { key: 'pki.cas', method: 'GET', path: '/api/v1/pki/cas', call: () => api.pki.cas() },
  { key: 'pki.crl', method: 'GET', path: '/api/v1/pki/crl/doc-signing-2026', params: { ca: 'doc-signing-2026' }, call: () => api.pki.crl('doc-signing-2026') },
  { key: 'pki.ocsp', method: 'GET', path: `/api/v1/pki/ocsp/${ENC_SERIAL}`, params: { serial: SERIAL }, call: () => api.pki.ocsp(SERIAL) },
  { key: 'archive.list', method: 'GET', path: '/api/v1/archive', call: () => api.archive.list() },
  { key: 'archive.add', method: 'POST', path: '/api/v1/archive', body: { document_id: 'D01', verify_job_id: 'job-0001' }, call: () => api.archive.add({ document_id: 'D01', verify_job_id: 'job-0001' }) },
  { key: 'archive.share', method: 'POST', path: '/api/v1/archive/arc-0001/share', params: { id: 'arc-0001' }, body: { user_id: 'u-wipawan' }, call: () => api.archive.share('arc-0001', { user_id: 'u-wipawan' }) },
  { key: 'users.directory', method: 'GET', path: '/api/v1/users', call: () => api.users.directory() },
  { key: 'admin.status', method: 'GET', path: '/api/v1/admin/status', call: () => api.admin.status() },
  { key: 'admin.audit', method: 'GET', path: '/api/v1/admin/audit', call: () => api.admin.audit() },
  { key: 'admin.crlIssue', method: 'POST', path: '/api/v1/admin/crl/issue', mfa: MFA, call: () => api.admin.crlIssue(MFA) },
  { key: 'admin.closeAccount', method: 'POST', path: '/api/v1/admin/users/u-somchai/close', params: { user_id: 'u-somchai' }, mfa: MFA, call: () => api.admin.closeAccount('u-somchai', MFA) },
  { key: 'demo.status', method: 'GET', path: '/api/v1/demo/status', call: () => demoApi.status() },
  { key: 'demo.clock', method: 'POST', path: '/api/v1/demo/clock', body: { advance: 'P1D' }, call: () => demoApi.setClock('P1D') },
  { key: 'demo.faults', method: 'POST', path: '/api/v1/demo/faults', body: { ocsp_down: true }, call: () => demoApi.setFaults({ ocsp_down: true }) },
  { key: 'demo.reset', method: 'POST', path: '/api/v1/demo/reset', call: () => demoApi.reset() },
  { key: 'demo.personas', method: 'GET', path: '/api/v1/demo/personas', call: () => demoApi.personas() },
  { key: 'demo.persona', method: 'POST', path: '/api/v1/demo/persona', body: { user_id: 'u-guest' }, call: () => demoApi.switchPersona('u-guest') },
  { key: 'demo.samples', method: 'GET', path: '/api/v1/demo/samples', call: () => demoApi.samples() },
  { key: 'demo.mailbox', method: 'GET', path: '/api/v1/demo/mailbox', call: () => demoApi.mailbox() },
  { key: 'demo.progress', method: 'POST', path: '/api/v1/demo/progress', body: { key: 'M1.fingerprint_matched' }, call: () => demoApi.progress('M1.fingerprint_matched') },
  { key: 'demo.workstation', method: 'GET', path: '/api/v1/demo/workstation', call: () => demoApi.workstation() },
  { key: 'demo.keygen', method: 'POST', path: '/api/v1/demo/workstation/keygen', body: { name: 'ณัฐพล ทองดี', email: 'nattapon@lab.korakod.dev' }, call: () => demoApi.keygen({ name: 'ณัฐพล ทองดี', email: 'nattapon@lab.korakod.dev' }) },
  { key: 'sign.review', method: 'POST', path: '/api/v1/sign/review', body: { document_id: 'D12', field: 'approver-1', certify: true }, call: () => demoApi.signReview({ document_id: 'D12', field: 'approver-1', certify: true }) },
  { key: 'sign.commit', method: 'POST', path: '/api/v1/sign', body: { document_id: 'D12', field: 'approver-1', certify: true, purpose: 1, sha256_suffix: 'abcd', p12_password: 'demo-p12-password' }, call: () => demoApi.sign({ document_id: 'D12', field: 'approver-1', certify: true, purpose: 1, sha256_suffix: 'abcd', p12_password: 'demo-p12-password' }) },
];

describe('coverage of the route table', () => {
  it('the test table has exactly one row per RouteKey', () => {
    expect(rows.map((r) => r.key).sort()).toEqual(Object.keys(API_ROUTES).sort());
  });

  it('every RouteKey has exactly one handler folder (api XOR demo-only), matching its demoOnly flag', () => {
    const all = [...API_HANDLER_KEYS, ...DEMO_ONLY_HANDLER_KEYS];
    expect([...all].sort()).toEqual(Object.keys(API_ROUTES).sort()); // complete and no duplicates
    API_HANDLER_KEYS.forEach((k) => expect(API_ROUTES[k].demoOnly).toBe(false));
    DEMO_ONLY_HANDLER_KEYS.forEach((k) => expect(API_ROUTES[k].demoOnly).toBe(true));
  });

  it('createHandlers registers one handler per RouteKey', () => {
    expect(createHandlers(runtime)).toHaveLength(Object.keys(API_ROUTES).length);
  });

  it('table method/path literals agree with the frozen route table (templates)', () => {
    rows.forEach((r) => expect(API_ROUTES[r.key].method).toBe(r.method));
  });
});

describe.each(rows)('$key', (row) => {
  it(`reaches the engine as ${row.method} ${row.path} with token, params, body and MFA`, async () => {
    token = TOKEN;
    const result = (await row.call()) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(seenHttp).toEqual([{ method: row.method, path: row.path }]);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      route: row.key,
      token: TOKEN,
      params: row.params ?? {},
      query: {},
      body: row.body ?? null,
      mfa: row.mfa ?? null,
    });
  });
});

describe('request building', () => {
  it('sends no token when the client has none', async () => {
    token = null;
    await api.status.get();
    expect(received[0]!.token).toBeNull();
    token = TOKEN;
  });

  it('only sends X-Demo-MFA when given (certs.revoke by the owner)', async () => {
    await api.certs.revoke(SERIAL, { reason: 'cessationOfOperation' });
    expect(received[0]!.mfa).toBeNull();
    expect(received[0]!.body).toEqual({ reason: 'cessationOfOperation' });
  });

  it('forwards the query string to the engine', async () => {
    await fetch(`${BASE}/api/v1/status?foo=bar&x=1`);
    expect(received[0]!.query).toEqual({ foo: 'bar', x: '1' });
  });

  it('matches the static /cert-requests/appointments before /cert-requests/:id', async () => {
    await api.certRequests.appointments();
    expect(received[0]!.route).toBe('certRequests.appointments');
    expect(received[0]!.params).toEqual({});
  });

  it('answers 400 problem+json for a malformed JSON body without calling the runtime', async () => {
    const res = await fetch(`${BASE}/api/v1/verify`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{nope' });
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect(await res.json()).toMatchObject({ code: 'INVALID_REQUEST', status: 400 });
    expect(received).toHaveLength(0);
  });

  it('treats an empty POST body as null', async () => {
    await fetch(`${BASE}/api/v1/auth/logout`, { method: 'POST' });
    expect(received[0]!.body).toBeNull();
  });

  it('does not match a non-contract path', async () => {
    await expect(fetch(`${BASE}/api/v1/nope`)).rejects.toThrow();
    expect(received).toHaveLength(0);
  });
});

describe('response mapping', () => {
  it('maps status, body and headers; error bodies become application/problem+json', async () => {
    nextResponse = { status: 429, body: { type: 'about:blank', title: 'Too many', status: 429, code: 'RATE_LIMITED', retry_after_s: 12 }, headers: { 'Retry-After': '12' } };
    const res = await fetch(`${BASE}/api/v1/verify`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('12');
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('adds Retry-After from retry_after_s on 429/503 when the engine did not set the header', async () => {
    nextResponse = { status: 503, body: { title: 'Queue full', status: 503, code: 'QUEUE_FULL', retry_after_s: 7.2 } };
    const res = await fetch(`${BASE}/api/v1/verify`, { method: 'POST', body: '{}' });
    expect(res.headers.get('retry-after')).toBe('8');
  });

  it('sends 204 without a body', async () => {
    nextResponse = { status: 204, body: null };
    const res = await fetch(`${BASE}/api/v1/auth/logout`, { method: 'POST' });
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
  });

  it('turns a throwing runtime into a 500 problem', async () => {
    const boom = setupServer(...createHandlers({ run: async () => Promise.reject(new Error('kaput')) }));
    server.use(...boom.listHandlers());
    const res = await fetch(`${BASE}/api/v1/status`);
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'INTERNAL_ERROR', detail: 'kaput' });
  });
});
