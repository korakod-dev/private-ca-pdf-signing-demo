// Test helpers for the engine suite: a small fake resolver (B2 is developed in parallel) and a "Sim" driver that holds
// the state, plays the runtime's part (appends audit drafts to state.audit) and offers short call helpers.
import { fixtures } from '../../fixtures';
import type { AuditDraft, EngineOptions, EngineRequest, EngineResponse, ResolveFn, ResolverInput, ResolverOutput } from '../../contracts/engine';
import type { AdvanceDuration, SignatureResult } from '../../contracts/api';
import type { PersonaId } from '../../contracts/fixtures';
import { createEngine } from '../index';
import type { EngineState } from '../types';
import { toMs } from '../clock';

/** Recorded resolver inputs, so tests can assert what the engine passes in. */
export const resolverCalls: ResolverInput[] = [];

/**
 * Minimal stand-in for the real resolver. It is NOT the golden table: it only reacts to the things the engine controls
 * (fixture expectations, faults, revocation before the signature timestamp) so engine behaviour can be tested alone.
 */
export const fakeResolve: ResolveFn = (input): ResolverOutput => {
  resolverCalls.push(input);
  const doc = input.document;
  let indication = doc.expected.indication ?? 'TOTAL-PASSED';
  let sub = doc.expected.sub_indication;
  let code = doc.expected.code ?? 'VALID';
  const warnings = [...doc.expected.warnings];

  const bothDown = input.faults.ocsp_down && input.faults.crl_down;
  if (doc.signatures.length > 0 && bothDown) {
    indication = 'INDETERMINATE';
    sub = 'TRY_LATER';
    code = 'TRY_LATER';
  } else {
    for (const sig of doc.signatures) {
      const view = input.certs[sig.signer_cert_serial];
      const ocsp = view?.ocsp;
      if (!input.faults.ocsp_down && ocsp?.status === 'revoked' && ocsp.revoked_at && sig.signature_timestamp) {
        const effective = ocsp.invalidity_date ?? ocsp.revoked_at;
        if (toMs(effective) <= toMs(sig.signature_timestamp.time)) {
          indication = 'TOTAL-FAILED';
          sub = 'REVOKED';
          code = 'REVOKED';
        }
      }
    }
  }
  const signatures: SignatureResult[] = doc.signatures.map((sig) => ({
    id: sig.id,
    field: sig.field,
    type: sig.type,
    signer: { subject: input.certs[sig.signer_cert_serial]?.subject ?? 'unknown', serial: sig.signer_cert_serial },
    signing_time: sig.claimed_signing_time,
    timestamp: sig.signature_timestamp,
    level: sig.level,
    indication,
    sub_indication: sub,
    code,
    checks: [],
    warnings: [],
  }));
  return {
    policy: 'strict-v1',
    validation_time: input.now,
    document: { id: doc.id, file_name: doc.file_name, sha256: doc.sha256, pages: doc.pages, size_bytes: doc.size_bytes },
    indication,
    sub_indication: sub,
    code,
    questions: { modified: 'no', signer_trusted: 'yes', valid_at_signing: 'yes' },
    signatures,
    doc_timestamps: doc.doc_timestamps,
    warnings,
    refs: doc.refs,
  };
};

export function deepFreeze<T>(v: T): T {
  if (v && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v);
    for (const child of Object.values(v as Record<string, unknown>)) deepFreeze(child);
  }
  return v;
}

export interface CallOpts {
  token?: string | null;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
  mfa?: string | null;
}

/** Drives the engine like the runtime does: state in, state out, audit drafts chained into state.audit. */
export class Sim {
  readonly engine = createEngine({ resolve: fakeResolve });
  state: EngineState;
  wall = 5_000_000;
  /** Every audit draft emitted so far (also mirrored into state.audit as fake chain entries). */
  drafts: AuditDraft[] = [];
  readonly tokens: Partial<Record<PersonaId, string>> = {};

  constructor(options: Partial<EngineOptions> = {}) {
    const opts: EngineOptions = { latency: false, clock_mode: 'frozen', ...options };
    this.state = this.engine.createInitialState(fixtures, opts, this.wall);
  }

  get now(): string {
    return this.engine.clockFrom(this.state, this.wall).now;
  }

  private absorb(next: EngineState, audit: AuditDraft[]): void {
    const entries = audit.map((d, i) => ({ ...d, seq: next.audit.length + i + 1, prev_hash: '0', hash: `h${next.audit.length + i + 1}` }));
    this.drafts.push(...audit);
    this.state = { ...next, audit: [...next.audit, ...entries] };
  }

  call(route: EngineRequest['route'], o: CallOpts = {}): EngineResponse {
    const clock = this.engine.clockFrom(this.state, this.wall);
    const req: EngineRequest = {
      route,
      token: o.token ?? null,
      params: o.params ?? {},
      query: o.query ?? {},
      body: o.body ?? null,
      mfa: o.mfa ?? null,
    };
    const res = this.engine.dispatch(this.state, req, clock);
    this.absorb(res.state, res.audit);
    return res.response;
  }

  /** Switches persona (demo.persona) and remembers the token. */
  as(id: PersonaId): string {
    const res = this.call('demo.persona', { body: { user_id: id } });
    const token = (res.body as { token: string }).token;
    this.tokens[id] = token;
    return token;
  }

  tokenOf(id: PersonaId): string {
    return this.tokens[id] ?? this.as(id);
  }

  /** Shortcut: call a route as a persona. */
  by(id: PersonaId, route: EngineRequest['route'], o: CallOpts = {}): EngineResponse {
    return this.call(route, { token: this.tokenOf(id), ...o });
  }

  /** Admin-a call with the demo MFA code. */
  admin(route: EngineRequest['route'], o: CallOpts = {}): EngineResponse {
    return this.call(route, { token: this.tokenOf('a-admin-a'), mfa: '246810', ...o });
  }

  advance(d: AdvanceDuration): EngineResponse {
    return this.call('demo.clock', { body: { advance: d } });
  }

  advanceDays(n: number): void {
    for (let i = 0; i < n; i++) this.advance('P1D');
  }

  setFaults(f: Record<string, unknown>): EngineResponse {
    return this.call('demo.faults', { body: f });
  }

  /** POST /verify then GET the job (first observation completes it when latency is off). */
  verify(id: PersonaId | null, fixtureId: string): { create: EngineResponse; job?: { status: string; result: { indication: string; sub_indication: string | null; code: string } | null } } {
    const token = id ? this.tokenOf(id) : null;
    const create = this.call('verify.create', { token, body: { fixture_id: fixtureId } });
    if (create.status !== 202) return { create };
    const jobId = (create.body as { job_id: string }).job_id;
    const got = this.call('verify.get', { token, params: { job_id: jobId } });
    return { create, job: got.body as never };
  }

  actions(): string[] {
    return this.drafts.map((d) => d.action);
  }
}

export const body = <T = Record<string, unknown>>(r: EngineResponse): T => r.body as T;
