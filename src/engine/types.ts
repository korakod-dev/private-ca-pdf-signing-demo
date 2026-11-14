// Engine-internal state shape. EngineState extends the runtime-visible EngineStateEnvelope (contracts/engine.ts).
// Everything is plain JSON (no Date/Map/Set) so the runtime can persist it in localStorage as-is.
import type {
  AuditDraft,
  CrlEntry,
  EngineOptions,
  EngineStateEnvelope,
  ResolveFn,
} from '../contracts/engine';
import type { AppointmentSlot, ArchiveState, CaFixture, CertFixture, CsrModel, DocumentId, FaultState, FixtureDocument, Instant, JobStatus, MailFixture, Persona, PersonaId, RequestState, SystemConstants } from '../contracts/fixtures';
import type { ArchiveDto, ProblemDto, VerifyReport } from '../contracts/api';

/** Bump when the shape below changes; the runtime drops stored state with a different version. */
export const STATE_VERSION = 1;

export interface UserRecord {
  /** Consecutive failed password attempts (reset on success or after the lock expires). */
  failures: number;
  locked_until: Instant | null;
  last_in_person_proofing: Instant | null;
}

export interface RequestRecord {
  id: string;
  requester: PersonaId;
  state: RequestState;
  kind: 'new' | 'renewal';
  created_at: Instant;
  expires_at: Instant;
  csr: CsrModel;
  appointment: AppointmentSlot | null;
  /** Serial of the certificate this request produces (null for fixture requests until approved). */
  cert_serial: string | null;
  /** For renewals: the serial being replaced. */
  renews: string | null;
  decided_at: Instant | null;
  decision_code: string | null;
}

export interface JobRecord {
  job_id: string;
  /** Sequence number (the numeric part of job_id). */
  n: number;
  document_id: DocumentId;
  status: JobStatus;
  created_at: Instant;
  /** When a latency-enabled job turns 'running' / 'done'. */
  running_at: Instant;
  ready_at: Instant;
  requested_by: PersonaId | null;
  result: VerifyReport | null;
  error: ProblemDto | null;
}

export type ArchiveRecord = ArchiveDto & {
  /** CA id of the TSA that issued the newest timestamp (drives the A31 re-timestamp rule). */
  tsa: CaFixture['id'];
};

export type MailRecord = MailFixture & { read: boolean };

export interface WorkstationRecord {
  /** Number of key pairs generated on this persona's simulated machine. */
  keys: number;
  csrs: { pem: string; csr: CsrModel }[];
}

export interface Counters {
  job: number;
  request: number;
  token: number;
  ticket: number;
  mail: number;
  archive: number;
  cert: number;
}

export interface CrlState {
  ca: CaFixture['id'];
  number: number;
  this_update: Instant;
  next_update: Instant;
  entries: CrlEntry[];
}

export interface OcspSignerState {
  serial: string;
  not_before: Instant;
  not_after: Instant;
  /** Number of rotations done since the epoch (0 = the fixture signer). */
  index: number;
}

export interface LearningState {
  /** Documents the learner has "opened": job done (D01-D09) or a 413/422 rejection recorded (D10, D11, D12). */
  verified_docs: string[];
  progress_keys: { key: string; at: Instant }[];
  /** First time an OCSP query answered revoked for a serial that was absent from the current CRL (R14). */
  r14_observed_at: Instant | null;
  /** counters.job at that moment: M6 needs a REVOKED job created afterwards. */
  r14_after_job: number | null;
  /** Audit facts, kept here too because state.audit is written by the runtime after the dispatch returns. */
  sign_refused_codes: string[];
  archive_deleted_hashes: string[];
}

export interface EngineState extends EngineStateEnvelope {
  options: EngineOptions;
  system: SystemConstants;
  pki: CaFixture[];
  personas: Persona[];
  users: Partial<Record<PersonaId, UserRecord>>;
  last_tick: Instant;
  faults: FaultState;
  counters: Counters;
  sessions: Record<string, { user: PersonaId; created_at: Instant }>;
  mfa_tickets: Record<string, { user: PersonaId; created_at: Instant }>;
  certs: CertFixture[];
  /** Expiry notice thresholds (days) already sent per cert serial. */
  cert_notices: Record<string, number[]>;
  requests: RequestRecord[];
  appointment_slots: AppointmentSlot[];
  workstation: Partial<Record<PersonaId, WorkstationRecord>>;
  documents: FixtureDocument[];
  jobs: JobRecord[];
  archive: ArchiveRecord[];
  crl: CrlState;
  ocsp_signer: OcspSignerState;
  /** Set when the TSA stopped stamping because of clock drift (T4/T9). */
  tsa: { stopped_at: Instant | null };
  mail: MailRecord[];
  rate: { verify_posts: Instant[] };
  learning: LearningState;
  /** First time each mission was seen done (missions are sticky). */
  mission_done: Record<string, Instant>;
}

/** Per-call working context: a private clone of the state, the clock, and the audit drafts collected so far. */
export interface Ctx {
  state: EngineState;
  now: Instant;
  wallMs: number;
  audit: AuditDraft[];
  resolve: ResolveFn;
}

export type { ArchiveState };
