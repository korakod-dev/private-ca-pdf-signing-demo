// Contract: mock runtime that glues the pure engine to browser storage. FROZEN: change only deliberately.
import type { EngineApi, EngineRequest, EngineResponse, EngineStateEnvelope } from './engine';
import type { FixtureBundle } from './fixtures';
import { SESSION_STORAGE_KEY } from './store';

/** localStorage keys. Everything the demo stores starts with "pcpsd.". */
export const STORAGE_KEYS = {
  /** Whole engine state (JSON). Dropped and re-initialised when `version` differs. */
  state: 'pcpsd.state.v1',
  /** Cypress/test switches: TestMode JSON. */
  testMode: 'pcpsd.test-mode',
  /** Session token only (single source: SESSION_STORAGE_KEY in store.ts). */
  session: SESSION_STORAGE_KEY,
  prefix: 'pcpsd.',
} as const;

/**
 * Written by `cy.visitDemo` before load: no latency, frozen clock => deterministic missions.
 * Mapping (F5): the runtime builds `EngineOptions { latency: testMode.latency, clock_mode: testMode.clock }`
 * (absent test mode => `{ latency: true, clock_mode: 'running' }`) and passes it to `createInitialState`.
 * The runtime must not freeze time by faking `wallMs`.
 */
export interface TestMode {
  latency: boolean;
  clock: 'running' | 'frozen';
}

/**
 * Parses the `pcpsd.test-mode` value; anything missing or malformed counts as "no test mode" (null).
 * Single parser for the mock runtime (the ShellTestPage harness that shared it was removed, review F16).
 */
export function parseTestMode(raw: string | null): TestMode | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null) return null;
    const { latency, clock } = v as Record<string, unknown>;
    if (typeof latency !== 'boolean' || (clock !== 'running' && clock !== 'frozen')) return null;
    return { latency, clock };
  } catch {
    return null;
  }
}

/** The subset of Web Storage the runtime needs (in-memory fake in tests). */
export interface KeyValueStorage {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** WebCrypto wrapper so tests can inject a deterministic hasher. */
export interface Hasher {
  /** Lower-case hex SHA-256 of the UTF-8 text. */
  sha256Hex(text: string): Promise<string>;
}

export interface RuntimeDeps<S extends EngineStateEnvelope = EngineStateEnvelope> {
  engine: EngineApi<S>;
  storage: KeyValueStorage;
  /** Wall clock in ms (Date.now in the browser; injected so tests control it). */
  wallNow: () => number;
  hasher: Hasher;
  fixtures: FixtureBundle;
}

export interface MockRuntime {
  /** Load state -> clockFrom -> dispatch -> chain audit drafts -> persist -> response. */
  run(req: EngineRequest): Promise<EngineResponse>;
  /** Removes all pcpsd.* keys and re-initialises with a genesis `system.reset` audit entry. */
  reset(): Promise<void>;
}

export type CreateRuntime = <S extends EngineStateEnvelope>(deps: RuntimeDeps<S>) => MockRuntime;
