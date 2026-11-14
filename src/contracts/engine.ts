// Contract: pure simulation engine. FROZEN: change only deliberately.
// B1 implements EngineApi in src/engine; B2 implements ResolveFn in src/engine/resolver.
import type { FaultState, FixtureBundle, FixtureDocument, Instant, PersonaId, RevocationReason } from './fixtures';
import type { VerifyReport } from './api';
import type { RouteKey } from './routes';

export type { RouteKey } from './routes';

export interface Clock {
  now: Instant;
  wallMs: number;
}
export interface ClockState {
  sim_base: Instant;
  wall_base: number;
  mode: 'running' | 'frozen';
}
export interface EngineOptions {
  /** false => verification jobs go done on first observation (Cypress test mode). */
  latency: boolean;
  /**
   * Initial `ClockState.mode` (F5 contract, fixed up front). The runtime passes `TestMode.clock` here
   * (default 'running' when no test mode is set).
   * 'frozen' => `clockFrom(state, wallMs)` returns `now = sim_base` regardless of `wallMs`; only forward-only clock
   * advances (demo.clock) move `sim_base`. 'running' => `now = sim_base + (wallMs - wall_base)`.
   * B1 implements this in createInitialState/clockFrom; C only forwards the value. Nobody freezes time by passing a
   * fixed `wallMs`.
   */
  clock_mode: ClockState['mode'];
}

export interface EngineRequest {
  route: RouteKey;
  token: string | null;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  /** Value of the X-Demo-MFA header. */
  mfa: string | null;
}
export interface EngineResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

/** What the engine emits; the runtime turns drafts into hash-chained AuditEntry values (section 3.6). */
export interface AuditDraft {
  at: Instant;
  actor: PersonaId | 'system';
  /** e.g. "cert.revoked", "sign.refused". */
  action: string;
  target: string | null;
  details: Record<string, JsonValue>;
}
export interface AuditEntry extends AuditDraft {
  seq: number;
  prev_hash: string;
  hash: string;
}

/** The runtime-visible part of the engine state. B1 owns and extends it (JSON-serialisable: no Date/Map). */
export interface EngineStateEnvelope {
  version: number;
  clock: ClockState;
  audit: AuditEntry[];
}
export interface EngineResult<S extends EngineStateEnvelope> {
  state: S;
  response: EngineResponse;
  audit: AuditDraft[];
}

export interface MissionProgress {
  id: `M${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11}`;
  done: boolean;
  done_at: Instant | null;
}

export interface EngineApi<S extends EngineStateEnvelope = EngineStateEnvelope> {
  STATE_VERSION: number;
  createInitialState(fx: FixtureBundle, options: EngineOptions, wallMs: number): S;
  clockFrom(state: S, wallMs: number): Clock;
  /** Scheduled jobs + job progression. */
  tick(state: S, clock: Clock): { state: S; audit: AuditDraft[] };
  /** The spec's (state, event, clock) -> (state', response, auditEvents). Calls tick first. */
  dispatch(state: S, req: EngineRequest, clock: Clock): EngineResult<S>;
  evaluateMissions(state: S): MissionProgress[];
}

// ---------- resolver (B2), injected into B1 ----------
export interface CertView {
  serial: string;
  subject: string;
  trusted_chain: boolean;
  not_before: Instant;
  not_after: Instant;
  ocsp: {
    status: 'good' | 'revoked' | 'unknown';
    revoked_at: Instant | null;
    reason: RevocationReason | null;
    invalidity_date: Instant | null;
  };
}
export interface CrlEntry {
  serial: string;
  revoked_at: Instant;
  reason: RevocationReason;
  invalidity_date: Instant | null;
}
export interface ResolverInput {
  document: FixtureDocument;
  now: Instant;
  certs: Record<string, CertView>;
  crl_entries: CrlEntry[];
  faults: FaultState;
  policy: 'strict-v1';
}
export type ResolverOutput = Omit<VerifyReport, 'job_id' | 'created_at' | 'finished_at'>;
export type ResolveFn = (input: ResolverInput) => ResolverOutput;
