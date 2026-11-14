/// <reference types="node" />
// (tsconfig.json only lists vite/client types; this test file needs node:* modules.)
// Test doubles for the mock runtime: a fake engine, an in-memory storage and a node:crypto hasher.
// (Not a test file itself; imported by the *.test.ts files in this folder.)
import { createHash } from 'node:crypto';
import type {
  AuditDraft,
  Clock,
  EngineApi,
  EngineOptions,
  EngineRequest,
  EngineResult,
  EngineStateEnvelope,
} from '../../contracts/engine';
import type { RouteKey } from '../../contracts/routes';
import type { Hasher, KeyValueStorage } from '../../contracts/runtime';
import type { FixtureBundle } from '../../contracts/fixtures';

export const EPOCH = '2026-11-12T09:00:00+07:00';

export interface FakeState extends EngineStateEnvelope {
  counter: number;
  options: EngineOptions;
}

export interface FakeEngine extends EngineApi<FakeState> {
  initCalls: { options: EngineOptions; wallMs: number }[];
  clockCalls: number[];
  requests: EngineRequest[];
}

/** Token -> persona used by the fake `auth.me`. */
export const FAKE_TOKENS: Record<string, string> = { 'tok-admin-b': 'a-admin-b', 'tok-somchai': 'u-somchai' };

/** Minimal engine: counts dispatches, emits one audit draft per request, understands auth.me and demo.progress. */
export function createFakeEngine(version = 1): FakeEngine {
  const engine: FakeEngine = {
    STATE_VERSION: version,
    initCalls: [],
    clockCalls: [],
    requests: [],
    createInitialState(_fx, options, wallMs) {
      engine.initCalls.push({ options, wallMs });
      return { version, clock: { sim_base: EPOCH, wall_base: wallMs, mode: options.clock_mode }, audit: [], counter: 0, options };
    },
    clockFrom(state, wallMs): Clock {
      engine.clockCalls.push(wallMs);
      if (state.clock.mode === 'frozen') return { now: state.clock.sim_base, wallMs };
      const now = new Date(Date.parse(state.clock.sim_base) + (wallMs - state.clock.wall_base)).toISOString();
      return { now, wallMs };
    },
    tick: (state) => ({ state, audit: [] }),
    dispatch(state, req, clock): EngineResult<FakeState> {
      engine.requests.push(req);
      if ((req.route as string) === 'boom') throw new Error('engine exploded');
      const next: FakeState = { ...state, counter: state.counter + 1 };
      const audit: AuditDraft[] = [{ at: clock.now, actor: 'system', action: `fake.${req.route}`, target: null, details: { counter: next.counter } }];
      if (req.route === 'auth.me') {
        const id = req.token ? FAKE_TOKENS[req.token] : undefined;
        if (!id) return { state: next, audit, response: { status: 401, body: { title: 'Unauthenticated', status: 401, code: 'UNAUTHENTICATED' } } };
        return { state: next, audit, response: { status: 200, body: { id, display_name: id, email: `${id}@x`, role: 'admin-b' } } };
      }
      return { state: next, audit, response: { status: 200, body: { route: req.route, counter: next.counter } } };
    },
    evaluateMissions: () => [],
  };
  return engine;
}

/** In-memory Web Storage subset. `failWrites` simulates a full quota. */
export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Map<string, string>; failWrites: boolean } {
  const data = new Map(Object.entries(initial));
  const storage = {
    data,
    failWrites: false,
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem(k: string, v: string) {
      if (storage.failWrites) throw new DOMException('quota', 'QuotaExceededError');
      data.set(k, v);
    },
    removeItem: (k: string) => void data.delete(k),
  };
  return storage;
}

export const nodeHasher: Hasher = {
  sha256Hex: async (text) => createHash('sha256').update(text, 'utf8').digest('hex'),
};

/** Fixtures are opaque to the fake engine. */
export const FAKE_FIXTURES = {} as FixtureBundle;

export const req = (route: RouteKey, extra: Partial<EngineRequest> = {}): EngineRequest => ({
  route,
  token: null,
  params: {},
  query: {},
  body: null,
  mfa: null,
  ...extra,
});
