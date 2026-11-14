// Runtime tests: fake engine + in-memory storage (no msw, no real engine).
import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '../../contracts/runtime';
import type { AuditEntry } from '../../contracts/engine';
import { verifyChain } from '../../lib/hashChain';
import { createRuntime } from '../runtime';
import { EPOCH, FAKE_FIXTURES, createFakeEngine, createMemoryStorage, nodeHasher, req } from './fakes';
import type { FakeState } from './fakes';

function setup(opts: { version?: number; storage?: Record<string, string>; wall?: { now: number } } = {}) {
  const engine = createFakeEngine(opts.version);
  const storage = createMemoryStorage(opts.storage);
  const wall = opts.wall ?? { now: 1_000_000 };
  const runtime = createRuntime<FakeState>({ engine, storage, wallNow: () => wall.now, hasher: nodeHasher, fixtures: FAKE_FIXTURES });
  const stored = (): FakeState => JSON.parse(storage.getItem(STORAGE_KEYS.state) ?? 'null') as FakeState;
  return { engine, storage, wall, runtime, stored };
}

describe('init and persistence', () => {
  it('initialises state on the first run and persists it under pcpsd.state.v1', async () => {
    const { engine, runtime, stored } = setup();
    const res = await runtime.run(req('status.public'));
    expect(res).toEqual({ status: 200, body: { route: 'status.public', counter: 1 } });
    expect(engine.initCalls).toHaveLength(1);
    expect(stored().counter).toBe(1);
    expect(stored().version).toBe(1);
  });

  it('reuses the persisted state (also across runtime instances) instead of re-initialising', async () => {
    const a = setup();
    await a.runtime.run(req('status.public'));
    await a.runtime.run(req('status.public'));
    expect(a.engine.initCalls).toHaveLength(1);
    // A second runtime over the same storage (e.g. after a page reload) continues the counter.
    const engine2 = createFakeEngine();
    const runtime2 = createRuntime<FakeState>({ engine: engine2, storage: a.storage, wallNow: () => 5, hasher: nodeHasher, fixtures: FAKE_FIXTURES });
    const res = await runtime2.run(req('status.public'));
    expect((res.body as { counter: number }).counter).toBe(3);
    expect(engine2.initCalls).toHaveLength(0);
  });

  it('re-initialises when the stored version differs from STATE_VERSION', async () => {
    const old = JSON.stringify({ version: 0, clock: { sim_base: EPOCH, wall_base: 0, mode: 'running' }, audit: [], counter: 41 });
    const { engine, runtime, stored } = setup({ storage: { [STORAGE_KEYS.state]: old } });
    const res = await runtime.run(req('status.public'));
    expect(engine.initCalls).toHaveLength(1);
    expect((res.body as { counter: number }).counter).toBe(1);
    expect(stored().version).toBe(1);
  });

  it.each([['not json {'], ['null'], ['{"version":1}'], ['{"version":1,"clock":{},"audit":"x"}']])(
    're-initialises from unreadable or malformed state %j',
    async (raw) => {
      const { engine, runtime } = setup({ storage: { [STORAGE_KEYS.state]: raw } });
      expect((await runtime.run(req('status.public'))).status).toBe(200);
      expect(engine.initCalls).toHaveLength(1);
    },
  );

  it('passes the real wall clock reading to clockFrom (time is never faked)', async () => {
    const { engine, runtime, wall } = setup();
    wall.now = 123_456;
    await runtime.run(req('status.public'));
    expect(engine.clockCalls.at(-1)).toBe(123_456);
    wall.now = 999_999;
    await runtime.run(req('status.public'));
    expect(engine.clockCalls.at(-1)).toBe(999_999);
  });

  it('answers 500 problem+json when the engine throws and persists nothing', async () => {
    const { runtime, storage } = setup();
    const res = await runtime.run(req('boom' as never));
    expect(res.status).toBe(500);
    // F21: same problem shape as the engine (`type` = /problems/<code>, title from the status).
    expect(res.body).toMatchObject({ type: '/problems/INTERNAL_ERROR', title: 'Internal Server Error', code: 'INTERNAL_ERROR', status: 500 });
    expect(storage.getItem(STORAGE_KEYS.state)).toBeNull();
  });

  it('answers 507 when storage rejects the write', async () => {
    const { runtime, storage } = setup();
    storage.failWrites = true;
    const res = await runtime.run(req('status.public'));
    expect(res.status).toBe(507);
    expect(res.body).toMatchObject({ type: '/problems/STORAGE_ERROR', title: 'Insufficient Storage', code: 'STORAGE_ERROR' });
  });

  it('serialises overlapping runs (no lost updates)', async () => {
    const { runtime, stored } = setup();
    await Promise.all(Array.from({ length: 12 }, () => runtime.run(req('status.public'))));
    expect(stored().counter).toBe(12);
    expect(stored().audit.map((e) => e.seq)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(await verifyChain(stored().audit, nodeHasher)).toEqual({ valid: true });
  });
});

describe('audit chaining', () => {
  it('chains drafts into contiguous, verifiable entries', async () => {
    const { runtime, stored } = setup();
    for (let i = 0; i < 5; i += 1) await runtime.run(req('status.public'));
    const audit = stored().audit;
    expect(audit.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
    audit.slice(1).forEach((e, i) => expect(e.prev_hash).toBe(audit[i]!.hash));
    expect(await verifyChain(audit, nodeHasher)).toEqual({ valid: true });
  });
});

describe('test mode (F5 mapping)', () => {
  it('defaults to latency on + running clock without pcpsd.test-mode', async () => {
    const { engine, runtime } = setup();
    await runtime.run(req('status.public'));
    expect(engine.initCalls[0]!.options).toEqual({ latency: true, clock_mode: 'running' });
  });

  it('maps TestMode.latency/clock to EngineOptions.latency/clock_mode', async () => {
    const { engine, runtime, stored } = setup({ storage: { [STORAGE_KEYS.testMode]: JSON.stringify({ latency: false, clock: 'frozen' }) } });
    await runtime.run(req('status.public'));
    expect(engine.initCalls[0]!.options).toEqual({ latency: false, clock_mode: 'frozen' });
    expect(stored().clock.mode).toBe('frozen');
  });

  it('ignores a malformed test mode value', async () => {
    const { engine, runtime } = setup({ storage: { [STORAGE_KEYS.testMode]: '{"latency":"no"}' } });
    await runtime.run(req('status.public'));
    expect(engine.initCalls[0]!.options).toEqual({ latency: true, clock_mode: 'running' });
  });
});

describe('reset', () => {
  it('removes all pcpsd.* keys, keeps foreign keys, and writes a genesis system.reset entry', async () => {
    const { runtime, storage, stored } = setup({
      storage: { 'other.key': 'keep', [STORAGE_KEYS.session]: 'tok', [STORAGE_KEYS.testMode]: JSON.stringify({ latency: false, clock: 'frozen' }) },
    });
    await runtime.run(req('status.public'));
    await runtime.run(req('status.public'));
    await runtime.reset();
    expect(storage.getItem('other.key')).toBe('keep');
    expect(storage.getItem(STORAGE_KEYS.session)).toBeNull();
    const s = stored();
    expect(s.counter).toBe(0);
    expect(s.audit).toHaveLength(1);
    expect(s.audit[0]).toMatchObject({ seq: 1, actor: 'system', action: 'system.reset', target: null, at: EPOCH });
    expect(await verifyChain(s.audit, nodeHasher)).toEqual({ valid: true });
  });

  it('keeps the test-mode switch and re-initialises with it (no faked wall clock)', async () => {
    const mode = JSON.stringify({ latency: false, clock: 'frozen' });
    const { engine, runtime, storage, wall } = setup({ storage: { [STORAGE_KEYS.testMode]: mode } });
    await runtime.run(req('status.public'));
    wall.now = 777;
    await runtime.reset();
    expect(storage.getItem(STORAGE_KEYS.testMode)).toBe(mode);
    expect(engine.initCalls.at(-1)).toEqual({ options: { latency: false, clock_mode: 'frozen' }, wallMs: 777 });
  });

  it('is reachable through the demo.reset route (204, null body)', async () => {
    const { runtime, stored } = setup();
    await runtime.run(req('status.public'));
    const res = await runtime.run(req('demo.reset'));
    expect(res).toEqual({ status: 204, body: null });
    expect(stored().audit.map((e) => e.action)).toEqual(['system.reset']);
  });

  it('does not forward demo.reset to the engine', async () => {
    const { engine, runtime } = setup();
    await runtime.run(req('demo.reset'));
    expect(engine.requests).toHaveLength(0);
  });
});

describe('M11 guard (demo.progress M11.chain_verified)', () => {
  const m11 = (token: string | null) => req('demo.progress', { token, body: { key: 'M11.chain_verified' } });

  it('forwards for a-admin-b when the chain verifies', async () => {
    const { engine, runtime } = setup();
    await runtime.run(req('status.public')); // some history to verify
    const res = await runtime.run(m11('tok-admin-b'));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ route: 'demo.progress' });
    expect(engine.requests.at(-1)!.route).toBe('demo.progress');
  });

  it('refuses another persona with 403 and does not forward', async () => {
    const { engine, runtime } = setup();
    const res = await runtime.run(m11('tok-somchai'));
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: 'FORBIDDEN' });
    expect(engine.requests.some((r) => r.route === 'demo.progress')).toBe(false);
  });

  it('returns the engine 401 for a missing/unknown token', async () => {
    const { engine, runtime } = setup();
    const res = await runtime.run(m11(null));
    expect(res.status).toBe(401);
    expect(engine.requests.some((r) => r.route === 'demo.progress')).toBe(false);
  });

  it('refuses with 409 when the stored chain was tampered with', async () => {
    const { engine, runtime, storage, stored } = setup();
    await runtime.run(req('status.public'));
    await runtime.run(req('status.public'));
    const s = stored();
    const tampered: AuditEntry[] = s.audit.map((e, i) => (i === 0 ? { ...e, action: 'cert.revoked' } : e));
    storage.setItem(STORAGE_KEYS.state, JSON.stringify({ ...s, audit: tampered }));
    const res = await runtime.run(m11('tok-admin-b'));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'INVALID_STATE' });
    expect(engine.requests.some((r) => r.route === 'demo.progress')).toBe(false);
  });

  it('does not guard other progress keys', async () => {
    const { engine, runtime } = setup();
    const res = await runtime.run(req('demo.progress', { body: { key: 'M1.fingerprint_matched' } }));
    expect(res.status).toBe(200);
    expect(engine.requests.map((r) => r.route)).toEqual(['demo.progress']);
  });
});
