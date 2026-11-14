// Contract: shared primitives and fixture shapes.
// FROZEN: change only deliberately, in one place (see docs/adr/0003-assumptions.md).
// All fixture JSON files in src/fixtures/*.json must match these types.

/** ISO 8601 instant with the fixed +07:00 offset, e.g. "2026-11-12T09:00:00+07:00". */
export type Instant = string;

export type PersonaId =
  | 'u-somchai'
  | 'u-wipawan'
  | 'u-nattapon'
  | 'u-aree'
  | 'u-manop'
  | 'u-guest'
  | 'a-admin-a'
  | 'a-admin-b';
export type Role = 'signer' | 'new_user' | 'user' | 'verifier' | 'admin-a' | 'admin-b';

/** Fixture documents D01-D12 plus documents the user signs in the sign desk (D12-s1, D12-s2, ...). */
export type DocumentId =
  | 'D01'
  | 'D02'
  | 'D03'
  | 'D04'
  | 'D05'
  | 'D06'
  | 'D07'
  | 'D08'
  | 'D09'
  | 'D10'
  | 'D11'
  | 'D12'
  | `D12-s${number}`;

export type CertState = 'Requested' | 'Issued' | 'Active' | 'Revoked' | 'Expired' | 'Rejected' | 'ExpiredRequest';
export type RequestState = 'draft' | 'submitted' | 'awaitingInPerson' | 'approved' | 'rejected' | 'expired';
export type JobStatus = 'queued' | 'running' | 'done' | 'error';
export type ArchiveState = 'archived' | 'retimestamped' | 'expiryNotified' | 'deleted';
export type RevocationReason =
  | 'unspecified'
  | 'keyCompromise'
  | 'affiliationChanged'
  | 'superseded'
  | 'cessationOfOperation'
  | 'privilegeWithdrawn';

/** Hyphenated as written in the demo spec (not the DSS underscore form, assumption A1). */
export type Indication = 'TOTAL-PASSED' | 'TOTAL-FAILED' | 'INDETERMINATE';
export type SubIndication = 'REVOKED' | 'NO_CERTIFICATE_CHAIN_FOUND' | 'NO_POE' | 'TRY_LATER' | 'HASH_FAILURE';
export type ResultCode = 'VALID' | 'MODIFIED' | 'REVOKED' | 'UNTRUSTED' | 'NO_POE' | 'TRY_LATER';
export type SigLevel = 'B-B' | 'B-T' | 'B-LT' | 'B-LTA';

/** Fault switches. The "TSA drift" toggle sets tsa_drift_ms to 1400 (assumption A15). */
export interface FaultState {
  ocsp_down: boolean;
  crl_down: boolean;
  tsa_drift_ms: number;
  queue_full: boolean;
}

/** Main-spec reference code, e.g. "V3", "R14". Names the main spec item only; no clause numbers (assumption A19). */
export type MainSpecRef = string;

export interface SystemConstants {
  epoch: Instant;
  site_name: string;
  org: string;
  host: string;
  limits: {
    pdf_max_bytes: number;
    pdf_max_pages: number;
    queue_max: number;
    verify_rate_per_min: number;
    archive_quota_bytes_user: number;
    archive_quota_bytes_total: number;
  };
  lifetimes: {
    user_cert_days: 365;
    request_days: 14;
    archive_years: 5;
    ocsp_signer_days: 30;
    ocsp_rotate_days: 14;
  };
  schedule: { crl_hour: 6; crl_next_update_days: 7; retimestamp_hour: 3; backup_hour: 2 };
  demo_mfa: '246810';
  demo_password: 'demo-password';
  demo_p12_password: 'demo-p12-password';
  lockout: { max_failures: 3; minutes: 5 };
}

export interface Persona {
  id: PersonaId;
  display_name: string;
  email: string;
  role: Role;
  email_verified: boolean;
  last_in_person_proofing: Instant | null;
  home_route: string;
}

export interface CaFixture {
  id: 'root-2026' | 'doc-signing-2026' | 'tsa-2026' | 'ocsp-signer' | 'validation-2026' | 'tsa-2028' | 'tsa-2030';
  subject: string;
  serial: string;
  not_before: Instant;
  not_after: Instant;
  /** End of the period in which the CA/TSA may still issue/stamp (null = same as not_after). */
  usage_until: Instant | null;
  key_alg: string;
  status_note_th: string;
  /** "DE:M0:..." with 32 colon-separated pairs. */
  fingerprint_sha256: string;
  extensions: string[];
}

export interface CertFixture {
  serial: string;
  holder: PersonaId | null;
  subject: string;
  issuer_ca: CaFixture['id'] | null;
  /** Only the D06 self-signed cert carries this marker (allow-listed by the real-data detector). */
  untrusted_fixture?: true;
  not_before: Instant;
  not_after: Instant;
  state: CertState;
  revoked_at: Instant | null;
  revocation_reason: RevocationReason | null;
  invalidity_date: Instant | null;
  superseded_by: string | null;
}

/** What the simulated CSR contains (the six CSR checks are computed from this, assumption A7). */
export interface CsrModel {
  subject_cn: string;
  email: string;
  key_alg: 'ECDSA-P256' | 'ECDSA-P384' | 'RSA';
  key_size: number;
  pop_valid: boolean;
  extra_extensions: string[];
  key_previously_used: boolean;
}

export interface RequestFixture {
  id: string;
  requester: PersonaId;
  state: RequestState;
  created_at: Instant;
  csr: CsrModel;
  appointment_id: string | null;
  kind: 'new' | 'renewal';
}

export interface AppointmentSlot {
  id: string;
  at: Instant;
  location_th: string;
}

export interface FixtureTimestamp {
  time: Instant;
  tsa_serial: string;
}

export interface FixtureSignature {
  id: string;
  field: string;
  type: 'certification' | 'approval';
  signer_cert_serial: string;
  claimed_signing_time: Instant;
  signature_timestamp: FixtureTimestamp | null;
  level: SigLevel;
  /** Intent purpose 1-4 (assumption A13); null for unknown/self-signed. */
  purpose: 1 | 2 | 3 | 4 | null;
}

export interface ExpectedResult {
  http_status: 200 | 413 | 422;
  indication: Indication | null;
  sub_indication: SubIndication | null;
  code: ResultCode | null;
  problem_code: string | null;
  warnings: string[];
}

export interface FixtureDocument {
  id: DocumentId;
  file_name: string;
  title_th: string;
  scenario_th: string;
  pages: number;
  size_bytes: number;
  encrypted: boolean;
  /** Fake hash: /^de00[0-9a-f]{60}$/ (assumption A24). */
  sha256: string;
  /** Paths under public/, e.g. "/previews/D01-p1.svg". */
  previews: string[];
  signature_fields: string[];
  signatures: FixtureSignature[];
  doc_timestamps: FixtureTimestamp[];
  modification_after_last_signature: null | { kind: 'content_stream' | 'form_fill'; docmdp_permitted: boolean };
  expected: ExpectedResult;
  refs: MainSpecRef[];
}

export interface MailFixture {
  id: string;
  to: PersonaId;
  at: Instant;
  kind: 'email_verify' | 'approved' | 'rejected' | 'expiry_notice' | 'archive_notice' | 'archive_deleted';
  subject_th: string;
  body_th: string;
}

/** Everything src/fixtures/index.ts exports as `fixtures`. */
export interface FixtureBundle {
  system: SystemConstants;
  personas: Persona[];
  pki: CaFixture[];
  certs: CertFixture[];
  requests: { requests: RequestFixture[]; appointment_slots: AppointmentSlot[] };
  documents: FixtureDocument[];
  mail: MailFixture[];
}
