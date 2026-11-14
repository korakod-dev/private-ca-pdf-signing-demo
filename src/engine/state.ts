// Initial state construction, id generation, lookups and the audit-draft helper.
import type { AuditDraft, EngineOptions, JsonValue } from '../contracts/engine';
import type { UserSummary } from '../contracts/store';
import type { CaFixture, CertFixture, FixtureBundle, FixtureDocument, Persona, PersonaId } from '../contracts/fixtures';
import { addDays, atHour, isOnOrBefore } from './clock';
import type { ArchiveRecord, Counters, Ctx, EngineState, JobRecord, RequestRecord } from './types';
import { STATE_VERSION } from './types';

/** Thresholds (days before expiry) for certificate expiry notices (A27). */
export const NOTICE_DAYS = [30, 7, 1] as const;

/** Deep copy of JSON-like data. Used to detach fixture data from the state and to copy states per call. */
export function cloneJson<T>(v: T): T {
  return structuredClone(v);
}

export function createState(fx: FixtureBundle, options: EngineOptions, wallMs: number): EngineState {
  const f = cloneJson(fx);
  const epoch = f.system.epoch;
  const users: EngineState['users'] = {};
  for (const p of f.personas) {
    users[p.id] = { failures: 0, locked_until: null, last_in_person_proofing: p.last_in_person_proofing };
  }

  const ocsp = f.pki.find((c) => c.id === 'ocsp-signer');
  if (!ocsp) throw new Error('fixtures: ocsp-signer missing');

  const requests: RequestRecord[] = f.requests.requests.map((r) => ({
    id: r.id,
    requester: r.requester,
    state: r.state,
    kind: r.kind,
    created_at: r.created_at,
    expires_at: addDays(r.created_at, f.system.lifetimes.request_days),
    csr: r.csr,
    appointment: f.requests.appointment_slots.find((s) => s.id === r.appointment_id) ?? null,
    cert_serial: null,
    renews: null,
    decided_at: null,
    decision_code: null,
  }));

  // Notices whose trigger time already lies in the past at the epoch count as sent (mail seed: aree 30-day notice).
  const cert_notices: EngineState['cert_notices'] = {};
  for (const c of f.certs) {
    if (c.state !== 'Active') continue;
    cert_notices[c.serial] = NOTICE_DAYS.filter((d) => isOnOrBefore(addDays(c.not_after, -d), epoch));
  }

  const state: EngineState = {
    version: STATE_VERSION,
    clock: { sim_base: epoch, wall_base: wallMs, mode: options.clock_mode },
    audit: [],
    options: { latency: options.latency, clock_mode: options.clock_mode },
    system: f.system,
    pki: f.pki,
    personas: f.personas,
    users,
    last_tick: epoch,
    faults: { ocsp_down: false, crl_down: false, tsa_drift_ms: 0, queue_full: false },
    counters: { job: 0, request: 0, token: 0, ticket: 0, mail: 0, archive: 0, cert: 0 },
    sessions: {},
    mfa_tickets: {},
    certs: f.certs,
    cert_notices,
    requests,
    appointment_slots: f.requests.appointment_slots,
    workstation: {},
    documents: f.documents,
    jobs: [],
    archive: [],
    crl: {
      ca: 'doc-signing-2026',
      number: 1,
      this_update: atHour(epoch, f.system.schedule.crl_hour),
      next_update: addDays(atHour(epoch, f.system.schedule.crl_hour), f.system.schedule.crl_next_update_days),
      entries: [],
    },
    ocsp_signer: { serial: ocsp.serial, not_before: ocsp.not_before, not_after: ocsp.not_after, index: 0 },
    tsa: { stopped_at: null },
    mail: f.mail.map((m) => ({ ...m, read: false })),
    rate: { verify_posts: [] },
    learning: {
      verified_docs: [],
      progress_keys: [],
      r14_observed_at: null,
      r14_after_job: null,
      sign_refused_codes: [],
      archive_deleted_hashes: [],
    },
    mission_done: {},
  };
  // Initial CRL = every certificate revoked at or before the epoch.
  state.crl.entries = state.certs
    .filter((c) => c.issuer_ca === 'doc-signing-2026' && c.state === 'Revoked' && c.revoked_at && isOnOrBefore(c.revoked_at, epoch))
    .map((c) => ({
      serial: c.serial,
      revoked_at: c.revoked_at as string,
      reason: c.revocation_reason ?? 'unspecified',
      invalidity_date: c.invalidity_date,
    }));
  return state;
}

// ---------- ids ----------
const pad = (n: number, width: number): string => String(n).padStart(width, '0');

export function nextId(state: EngineState, key: keyof Counters): number {
  state.counters[key] += 1;
  return state.counters[key];
}
export const jobId = (n: number): string => `job-${pad(n, 4)}`;
export const requestId = (n: number): string => `req-${pad(n, 4)}`;
export const archiveId = (n: number): string => `arc-${pad(n, 4)}`;
export const mailId = (n: number): string => `mail-${pad(n, 4)}`;
/** "DE:M0:A0:00:00:nn": nn = counter in base 36, at least 2 characters, upper case (matches /^DE:M0(:[0-9A-Z]{2})+$/). */
export const certSerial = (n: number): string => `DE:M0:A0:00:00:${n.toString(36).toUpperCase().padStart(2, '0')}`;
/** "DE:M0:0C:SP:nn" for the n-th OCSP signer (1-based). */
export const ocspSerial = (n: number): string => `DE:M0:0C:SP:${pad(n, 2)}`;

// ---------- lookups ----------
export function findPersona(state: EngineState, id: PersonaId): Persona {
  const p = state.personas.find((x) => x.id === id);
  if (!p) throw new Error(`unknown persona ${id}`);
  return p;
}
export function findCert(state: EngineState, serial: string): CertFixture | undefined {
  return state.certs.find((c) => c.serial === serial);
}
export function findRequest(state: EngineState, id: string): RequestRecord | undefined {
  return state.requests.find((r) => r.id === id);
}
export function findDocument(state: EngineState, id: string): FixtureDocument | undefined {
  return state.documents.find((d) => d.id === id);
}
export function findJob(state: EngineState, id: string): JobRecord | undefined {
  return state.jobs.find((j) => j.job_id === id);
}
export function findCa(state: EngineState, id: string): CaFixture | undefined {
  return state.pki.find((c) => c.id === id);
}
export function findArchive(state: EngineState, id: string): ArchiveRecord | undefined {
  return state.archive.find((a) => a.id === id);
}

export function toUserSummary(p: Persona): UserSummary {
  return { id: p.id, display_name: p.display_name, email: p.email, role: p.role };
}

export const isAdminRole = (role: Persona['role']): boolean => role === 'admin-a' || role === 'admin-b';

// ---------- audit ----------
export function emit(
  ctx: Ctx,
  actor: AuditDraft['actor'],
  action: string,
  target: string | null,
  details: Record<string, JsonValue> = {},
  at: string = ctx.now,
): void {
  ctx.audit.push({ at, actor, action, target, details });
}

/** The CA currently used by the TSA: the earliest-ending TSA that is already valid and not past its usage period. */
export function activeTsa(state: EngineState, at: string): CaFixture | undefined {
  const usageEnd = (c: CaFixture): string => c.usage_until ?? c.not_after;
  return state.pki
    .filter((c) => c.id.startsWith('tsa-') && isOnOrBefore(c.not_before, at) && !isOnOrBefore(usageEnd(c), at))
    .sort((a, b) => Date.parse(usageEnd(a)) - Date.parse(usageEnd(b)))[0];
}

export function usageEnd(c: CaFixture): string {
  return c.usage_until ?? c.not_after;
}

/** Validity end of a freshly issued user certificate. */
export function userCertEnd(state: EngineState, from: string): string {
  return addDays(from, state.system.lifetimes.user_cert_days);
}
