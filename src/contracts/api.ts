// Contract: wire shapes of the mock/real API. FROZEN: change only deliberately.
// Errors are RFC 9457 problem+json with an extra `code` (assumption A3).
import type {
  ArchiveState,
  AppointmentSlot,
  CaFixture,
  CertFixture,
  CsrModel,
  DocumentId,
  FaultState,
  FixtureTimestamp,
  Indication,
  Instant,
  JobStatus,
  MailFixture,
  MainSpecRef,
  PersonaId,
  RequestState,
  ResultCode,
  RevocationReason,
  SigLevel,
  SubIndication,
} from './fixtures';
import type { CrlEntry } from './engine';
import type { UserSummary } from './store';

// ---------- errors ----------
export interface ProblemDto {
  type: string;
  title: string;
  status: number;
  detail?: string;
  code: string;
  retry_after_s?: number;
  /** Simulated time at which a locked account unlocks (423 ACCOUNT_LOCKED). */
  locked_until?: Instant;
  /** Main-spec reference of the violated rule (extension member of the problem object; set by the engine, e.g. 'V10'). */
  ref?: MainSpecRef;
}

/** Known problem codes. The set is open: B1 may add codes; report them in the handoff. */
export type ProblemCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_CREDENTIALS'
  | 'ACCOUNT_LOCKED'
  | 'MFA_REQUIRED'
  | 'MFA_INVALID'
  | 'PDF_TOO_LARGE'
  | 'ENCRYPTED_PDF'
  | 'NOT_SIGNED'
  | 'RATE_LIMITED'
  | 'QUEUE_FULL'
  | 'NOT_TOTAL_PASSED'
  | 'QUOTA_EXCEEDED'
  | 'INVALID_STATE'
  | 'INVALID_REQUEST'
  | 'TSA_DRIFT'
  | 'TSA_UNAVAILABLE'
  | 'CERT_NOT_ACTIVE'
  | 'EXISTING_SIGNATURE_INVALID'
  | 'CERTIFY_NOT_FIRST'
  | 'SHA_SUFFIX_MISMATCH'
  | 'P12_PASSWORD_INVALID'
  | 'CRL_UNAVAILABLE'
  | 'OCSP_UNAVAILABLE'
  // Added in the Stage 1 integration (F17): raised by the mock runtime, not the engine.
  | 'INTERNAL_ERROR'
  | 'STORAGE_ERROR';

// ---------- demo clock / faults ----------
export type AdvanceDuration = 'PT5M' | 'PT1H' | 'P1D' | 'P30D' | 'P1Y' | 'P5Y';
export const ADVANCE_DURATIONS: readonly AdvanceDuration[] = ['PT5M', 'PT1H', 'P1D', 'P30D', 'P1Y', 'P5Y'];
/** Fault toggles shown in the demo bar and on /admin/status. */
export type FaultToggleKey = 'ocsp' | 'crl' | 'ocsp-crl' | 'tsa-drift' | 'queue-full';
/** The TSA drift toggle sets tsa_drift_ms to this value; the sign desk refuses above TSA_DRIFT_LIMIT_MS. */
export const TSA_DRIFT_FAULT_MS = 1400;
export const TSA_DRIFT_LIMIT_MS = 1000;

// ---------- auth ----------
export interface LoginBody { email: string; password: string }
export interface LoginResponse { mfa_ticket: string }
export interface MfaBody { mfa_ticket: string; code: string }
export interface SessionDto { token: string; user: UserSummary }

// ---------- public status ----------
/**
 * Central list of service ids (F6 contract, fixed up front). `TID.adminStatus.service(id)` takes a ServiceId.
 * B1 builds one entry per id (public status uses all of them; admin status the same list, in this order);
 * G renders one card per entry; H selects cards by these ids (e.g. the M9 TSA card is `tsa`).
 * Additions only, deliberately.
 */
export const SERVICE_IDS = ['ca', 'tsa', 'ocsp', 'crl', 'verify-queue'] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export interface ServiceStatusDto {
  services: { id: ServiceId; label_th: string; state: 'up' | 'down' | 'degraded' }[];
}

// ---------- verification (V3 report, assumption A1) ----------
export interface VerifyCheck {
  id: 'integrity' | 'modification' | 'chain' | 'validity' | 'revocation' | 'poe' | 'policy';
  result: 'passed' | 'failed' | 'indeterminate' | 'skipped';
  /** Stable code; UI content is keyed by it (src/content/results/<CODE>.md). */
  code: string;
  refs: MainSpecRef[];
}

export interface SignatureResult {
  id: string;
  field: string;
  type: 'certification' | 'approval';
  signer: { subject: string; serial: string };
  signing_time: Instant;
  timestamp: FixtureTimestamp | null;
  level: SigLevel;
  indication: Indication;
  sub_indication: SubIndication | null;
  code: ResultCode;
  checks: VerifyCheck[];
  warnings: string[];
}

export interface VerifyReport {
  job_id: string;
  created_at: Instant;
  finished_at: Instant;
  policy: 'strict-v1';
  validation_time: Instant;
  document: { id: string; file_name: string; sha256: string; pages: number; size_bytes: number };
  indication: Indication;
  sub_indication: SubIndication | null;
  code: ResultCode;
  questions: {
    modified: 'no' | 'yes' | 'unknown';
    signer_trusted: 'yes' | 'no' | 'unknown';
    valid_at_signing: 'yes' | 'no' | 'unknown';
  };
  signatures: SignatureResult[];
  doc_timestamps: FixtureTimestamp[];
  warnings: string[];
  refs: MainSpecRef[];
}

export interface VerifyJobDto {
  job_id: string;
  status: JobStatus;
  created_at: Instant;
  result: VerifyReport | null;
  error: ProblemDto | null;
}

/** `fixture_id` is a fixture or derived document id (e.g. "D01", "D12-s2"). */
export interface VerifyCreateBody { fixture_id: string }
export interface VerifyCreateResponse { job_id: string; status: 'queued' }

// ---------- certificate requests ----------
export interface CsrCheckDto {
  /** 1 proof of possession, 2 CN = verified name, 3 email = account, 4 key strength, 5 no extra extensions, 6 key not reused (A7). */
  id: 1 | 2 | 3 | 4 | 5 | 6;
  passed: boolean;
  label_th: string;
  ref: MainSpecRef;
}

export interface CertRequestDto {
  id: string;
  requester: PersonaId;
  state: RequestState;
  kind: 'new' | 'renewal';
  created_at: Instant;
  expires_at: Instant;
  csr: CsrModel;
  csr_checks: CsrCheckDto[];
  appointment: AppointmentSlot | null;
}

export interface CreateCertRequestBody { csr_pem: string; appointment_id: string }
/** The five in-person checkboxes (A8); no data fields. */
export interface ApproveBody { checklist: [boolean, boolean, boolean, boolean, boolean] }
export const REJECT_REASON_CODES = ['csr_check_failed', 'identity_mismatch', 'other'] as const;
export type RejectReasonCode = (typeof REJECT_REASON_CODES)[number];
export interface RejectBody { reason_code: RejectReasonCode; note: string }

// ---------- certificates ----------
export type CertDto = CertFixture & { days_left: number; superseded: boolean };
export interface RevokeBody { reason: RevocationReason; invalidity_date?: Instant }
export interface RenewBody { csr_pem: string }

// ---------- PKI status ----------
export interface CrlDto {
  ca: CaFixture['id'];
  number: number;
  this_update: Instant;
  next_update: Instant;
  entries: CrlEntry[];
}
export interface OcspDto {
  serial: string;
  status: 'good' | 'revoked' | 'unknown';
  revoked_at: Instant | null;
  reason: RevocationReason | null;
  produced_at: Instant;
  responder_serial: string;
}

// ---------- archive ----------
export interface ArchiveDto {
  id: string;
  document_id: DocumentId;
  file_name: string;
  owner: PersonaId;
  state: ArchiveState;
  added_at: Instant;
  expires_at: Instant;
  size_bytes: number;
  /** For deleted rows only the hash and metadata remain. */
  sha256: string;
  retimestamp_count: number;
  shared_with: PersonaId[];
  deleted_at: Instant | null;
}
export interface ArchiveAddBody { document_id: DocumentId; verify_job_id: string }
export interface ArchiveShareBody { user_id: PersonaId }
export interface UserDirectoryEntry { id: PersonaId; display_name: string }

// ---------- admin ----------
export interface AdminStatusDto {
  services: { id: ServiceId; label_th: string; state: 'up' | 'down' | 'degraded'; detail_th?: string }[];
  tsa: { offset_ms: number; limit_ms: number; state: 'ok' | 'stopped' };
  queue: { active: number; max: number };
  crl: { number: number; next_update: Instant };
  ocsp_signer: { serial: string; not_after: Instant };
  /** Static cards for what the demo does not simulate (spec 6: D/C/X items). */
  not_simulated: { id: string; label_th: string }[];
}
export interface CloseAccountResponse { revoked: string[] }

// ---------- demo-only ----------
export interface DemoClockBody { advance: AdvanceDuration }
export type DemoFaultsBody = Partial<FaultState>;
export interface DemoPersonaBody { user_id: PersonaId }
export type ProgressKey = 'M1.fingerprint_matched' | 'M11.chain_verified';
export interface DemoProgressBody { key: ProgressKey }

export interface SampleDto {
  id: DocumentId;
  file_name: string;
  title_th: string;
  scenario_th: string;
  pages: number;
  previews: string[];
}
/**
 * F8 contract: there is no "mark read" route. A GET `demo.mailbox` marks every message of the acting persona as read
 * AFTER building the response, so the response still carries `read: false` for the messages that were unread before
 * this call; the next `demo.status` then reports a lower `unread_mail`. B1 implements it (the mailbox read counts
 * as a state change); G's MailboxPage only calls `demoApi.mailbox()`.
 */
export type MailDto = MailFixture & { read: boolean };

export interface WorkstationDto {
  documents: { path: string; document_id: DocumentId; sha256: string }[];
  private_ca: { path: string; kind: 'private_key' | 'csr' | 'certificate' }[];
}
export interface KeygenBody { name: string; email: string }
export interface KeygenResponse { csr_pem: string; csr: CsrModel }

export interface SignReviewBody { document_id: DocumentId; field: string; certify: boolean }
export interface SignReviewDto {
  document_id: DocumentId;
  file_name: string;
  sha256: string;
  pages: number;
  field: string;
  certify: boolean;
  existing_signatures: { field: string; signer_subject: string; indication: Indication }[];
}
export interface SignCommitBody {
  document_id: DocumentId;
  field: string;
  certify: boolean;
  /** 1 อนุมัติ, 2 รับทราบ, 3 ผู้จัดทำ, 4 พยาน (A13). */
  purpose: 1 | 2 | 3 | 4;
  /** The last 4 hex characters of the document SHA-256, typed by the user. */
  sha256_suffix: string;
  p12_password: string;
}
export interface SignResultDto {
  document_id: DocumentId;
  file_name: string;
  levels: SigLevel[];
}
