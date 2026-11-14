/// <reference types="node" />
// (tsconfig.json only lists vite/client types; this test needs node:* modules for the hasher.)
//
// Platform integration test (MS1): msw/node + REAL runtime (in-memory storage) + REAL engine (default resolver = B2)
// + REAL fixtures + REAL API client. No UI. Expected values are literals from spec 7.5 / plan 3.2, not read back from
// the fixtures, so a drifting fixture or engine fails here.
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import type { ApiResult } from '../contracts/api-client';
import type { VerifyJobDto } from '../contracts/api';
import type { PersonaId } from '../contracts/fixtures';
import type { Hasher, KeyValueStorage } from '../contracts/runtime';
import { STORAGE_KEYS } from '../contracts/runtime';
import { createDemoApi } from '../api/demo';
import { createHttp } from '../api/http';
import { createApiClient } from '../api/real';
import { createEngine } from '../engine';
import { fixtures } from '../fixtures';
import { verifyChain } from '../lib/hashChain';
import { createHandlers } from '../mocks/handlers';
import { createRuntime } from '../mocks/runtime';

const BASE = 'http://localhost:3999';
const WALL_MS = Date.parse('2030-01-01T00:00:00Z'); // frozen wall clock: the sim clock must not depend on it

/** In-memory Web Storage stand-in. */
function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

const nodeHasher: Hasher = { sha256Hex: async (text) => createHash('sha256').update(text, 'utf8').digest('hex') };

const storage = memoryStorage();
const runtime = createRuntime({ engine: createEngine(), storage, wallNow: () => WALL_MS, hasher: nodeHasher, fixtures });

const server = setupServer(...createHandlers(runtime));
let token: string | null = null;
const http = createHttp({ baseUrl: BASE, getToken: () => token });
const api = createApiClient(http);
const demoApi = createDemoApi(http);

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

beforeEach(async () => {
  // Same as `cy.visitDemo`: no latency, frozen clock. Written before the state exists, then reset => genesis state.
  storage.setItem(STORAGE_KEYS.testMode, JSON.stringify({ latency: false, clock: 'frozen' }));
  token = null;
  await runtime.reset();
});

function ok<T>(r: ApiResult<T>): T {
  if (!r.ok) throw new Error(`API call failed: ${r.error.status} ${r.error.code} ${r.error.detail ?? ''}`);
  return r.data;
}

async function switchTo(id: PersonaId): Promise<void> {
  token = ok(await demoApi.switchPersona(id)).token;
}

/** POST /verify then GET until the job is finished (frozen clock + no latency => done on first observation). */
async function verifyDoc(fixtureId: string): Promise<VerifyJobDto> {
  const created = ok(await api.verify.create({ fixture_id: fixtureId }));
  const job = ok(await api.verify.get(created.job_id));
  expect(job.status).toBe('done');
  return job;
}

// Spec 7.5 / plan 3.2 golden table (literals).
const GOLDEN: [string, string, string | null, string][] = [
  ['D01', 'TOTAL-PASSED', null, 'VALID'],
  ['D02', 'TOTAL-FAILED', null, 'MODIFIED'],
  ['D03', 'TOTAL-FAILED', null, 'MODIFIED'],
  ['D04', 'TOTAL-FAILED', 'REVOKED', 'REVOKED'],
  ['D05', 'TOTAL-PASSED', null, 'VALID'],
  ['D06', 'TOTAL-FAILED', 'NO_CERTIFICATE_CHAIN_FOUND', 'UNTRUSTED'],
  ['D07', 'TOTAL-PASSED', null, 'VALID'],
  ['D08', 'INDETERMINATE', 'NO_POE', 'NO_POE'],
  ['D09', 'TOTAL-PASSED', null, 'VALID'],
];

describe('platform integration (msw/node + runtime + engine + fixtures + client)', () => {
  it('uses the real B2 resolver by default: guest verifies D01 end-to-end', async () => {
    await switchTo('u-guest');
    const job = await verifyDoc('D01');
    expect(job.result?.indication).toBe('TOTAL-PASSED');
    expect(job.result?.code).toBe('VALID');
    expect(job.result?.signatures).toHaveLength(2); // a stub resolver would not produce per-signature results
  });

  it('D01-D09 match the golden table through the API', async () => {
    await switchTo('u-guest');
    for (const [id, indication, sub, code] of GOLDEN) {
      const r = (await verifyDoc(id)).result;
      expect([id, r?.indication, r?.sub_indication, r?.code]).toEqual([id, indication, sub, code]);
      if (id === 'D06') expect(r?.warnings).toContain('MIXED_TRUST');
      if (id === 'D09') expect(r?.warnings).toContain('NO_SIGNER');
    }
  });

  it('D10 -> 422, D11 -> 413, D12 -> 422 (pre-checks run before the resolver, even over the rate limit)', async () => {
    await switchTo('u-guest');
    for (const id of ['D01', 'D02', 'D03', 'D04', 'D05', 'D06', 'D07', 'D08', 'D09']) await verifyDoc(id); // 9 POSTs
    const expectProblem = async (id: string, status: number, code: string): Promise<void> => {
      const r = await api.verify.create({ fixture_id: id });
      expect(r.ok).toBe(false);
      if (!r.ok) expect([r.error.status, r.error.code]).toEqual([status, code]);
    };
    await expectProblem('D10', 422, 'ENCRYPTED_PDF'); // 10th POST
    await expectProblem('D11', 413, 'PDF_TOO_LARGE'); // 11th POST: pre-check wins over 429
    await expectProblem('D12', 422, 'NOT_SIGNED');
    // A normal document is now rate limited, and passes again after the simulated minute has elapsed.
    const limited = await api.verify.create({ fixture_id: 'D01' });
    expect(limited.ok).toBe(false);
    if (!limited.ok) {
      expect(limited.error.status).toBe(429);
      expect(limited.error.retry_after_s).toBeGreaterThan(0); // Retry-After survives the whole stack
    }
    ok(await demoApi.setClock('PT5M'));
    expect((await verifyDoc('D01')).result?.indication).toBe('TOTAL-PASSED');
  });

  it('OCSP only down: D01 still passes (CRL fallback); OCSP + CRL down: INDETERMINATE / TRY_LATER', async () => {
    await switchTo('u-guest');
    ok(await demoApi.setFaults({ ocsp_down: true }));
    expect((await verifyDoc('D01')).result?.indication).toBe('TOTAL-PASSED');
    ok(await demoApi.setFaults({ ocsp_down: true, crl_down: true }));
    const r = (await verifyDoc('D01')).result;
    expect([r?.indication, r?.sub_indication, r?.code]).toEqual(['INDETERMINATE', 'TRY_LATER', 'TRY_LATER']);
  });

  it('OCSP + CRL down: D09 (document timestamp only) is INDETERMINATE / TRY_LATER with TSA_STATUS_UNAVAILABLE (F18)', async () => {
    await switchTo('u-guest');
    ok(await demoApi.setFaults({ ocsp_down: true, crl_down: true }));
    const r = (await verifyDoc('D09')).result;
    expect([r?.indication, r?.sub_indication, r?.code]).toEqual(['INDETERMINATE', 'TRY_LATER', 'TRY_LATER']);
    expect(r?.warnings).toEqual(['NO_SIGNER', 'TSA_STATUS_UNAVAILABLE']);
  });

  it('advance P1D moves `now` by exactly one day (forward only)', async () => {
    await switchTo('u-guest');
    const before = ok(await demoApi.status()).now;
    expect(before).toBe('2026-11-12T09:00:00+07:00'); // epoch (frozen clock)
    const after = ok(await demoApi.setClock('P1D')).now;
    expect(after).toBe('2026-11-13T09:00:00+07:00');
  });

  it('reset restores the epoch, drops progress and keeps the test-mode switch', async () => {
    await switchTo('u-guest');
    ok(await demoApi.setClock('P30D'));
    ok(await demoApi.reset());
    expect(storage.getItem(STORAGE_KEYS.testMode)).toBe(JSON.stringify({ latency: false, clock: 'frozen' }));
    token = null;
    await switchTo('u-guest');
    expect(ok(await demoApi.status()).now).toBe('2026-11-12T09:00:00+07:00');
  });

  it('audit chain: seq starts at 1 (genesis = system.reset), is contiguous and verifies; admin-b completes M11', async () => {
    await switchTo('u-somchai');
    await verifyDoc('D01');
    ok(await demoApi.setClock('P1D'));

    await switchTo('a-admin-b');
    const audit = ok(await api.admin.audit());
    expect(audit.length).toBeGreaterThan(1);
    expect(audit[0]?.seq).toBe(1);
    expect(audit[0]?.action).toBe('system.reset');
    expect(audit.map((e) => e.seq)).toEqual(audit.map((_e, i) => i + 1));
    expect(await verifyChain(audit, nodeHasher)).toEqual({ valid: true });

    // M11 guard: only admin-b; the runtime verifies the chain itself before forwarding to the engine.
    ok(await demoApi.progress('M11.chain_verified'));
    const m11 = ok(await demoApi.status()).missions.find((m) => m.id === 'M11');
    expect(m11?.done).toBe(true);
  });

  it('M4 flow: somchai signs D12 (certify) -> wipawan signs D12-s1 -> D12-s2 verifies TOTAL-PASSED', async () => {
    const signAs = async (persona: PersonaId, docId: 'D12' | 'D12-s1', field: string, certify: boolean) => {
      await switchTo(persona);
      const review = ok(await demoApi.signReview({ document_id: docId, field, certify }));
      return ok(
        await demoApi.sign({
          document_id: docId,
          field,
          certify,
          purpose: 1,
          sha256_suffix: review.sha256.slice(-4),
          p12_password: 'demo-p12-password',
        }),
      );
    };
    const s1 = await signAs('u-somchai', 'D12', 'approver-1', true);
    expect(s1.file_name).toBe('memo-130-s1.signed.pdf');
    expect(s1.levels).toEqual(['B-T', 'B-LT', 'B-LTA']);
    const s2 = await signAs('u-wipawan', 'D12-s1', 'approver-2', false);
    expect(s2.file_name).toBe('memo-130-s2.signed.pdf');
    const r = (await verifyDoc('D12-s2')).result;
    expect([r?.indication, r?.code]).toEqual(['TOTAL-PASSED', 'VALID']);
    expect(r?.signatures).toHaveLength(2);
  });

  it('M9 flow: TSA drift refuses signing (TSA_DRIFT audit entry) and completes M9', async () => {
    await switchTo('u-somchai');
    ok(await demoApi.setFaults({ tsa_drift_ms: 1400 }));
    const review = ok(await demoApi.signReview({ document_id: 'D12', field: 'approver-1', certify: false }));
    const r = await demoApi.sign({
      document_id: 'D12',
      field: 'approver-1',
      certify: false,
      purpose: 1,
      sha256_suffix: review.sha256.slice(-4),
      p12_password: 'demo-p12-password',
    });
    expect(r.ok).toBe(false);
    await switchTo('a-admin-a');
    const audit = ok(await api.admin.audit());
    expect(audit.some((e) => e.action === 'sign.refused' && e.details.code === 'TSA_DRIFT')).toBe(true);
    expect(ok(await demoApi.status()).missions.find((m) => m.id === 'M9')?.done).toBe(true);
  });

  it('M11 guard rejects non-admin-b actors', async () => {
    await switchTo('u-somchai');
    const r = await demoApi.progress('M11.chain_verified');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.status).toBe(403);
    expect(ok(await demoApi.status()).missions.find((m) => m.id === 'M11')?.done).toBe(false);
  });
});
