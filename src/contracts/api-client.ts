// Contract: the client used by the UI. FROZEN: change only deliberately.
// Implemented in src/api/*; real-contract modules are separate from src/api/demo.ts (demo-only calls).
// UI code must not know whether it talks to the mock (MSW) or a real backend.
import type {
  AdminStatusDto,
  ApproveBody,
  ArchiveAddBody,
  ArchiveDto,
  ArchiveShareBody,
  CertDto,
  CertRequestDto,
  CloseAccountResponse,
  CrlDto,
  CreateCertRequestBody,
  DemoFaultsBody,
  DemoProgressBody,
  KeygenBody,
  KeygenResponse,
  LoginBody,
  LoginResponse,
  MailDto,
  MfaBody,
  OcspDto,
  ProblemDto,
  RejectBody,
  RenewBody,
  RevokeBody,
  SampleDto,
  ServiceStatusDto,
  SessionDto,
  SignCommitBody,
  SignResultDto,
  SignReviewBody,
  SignReviewDto,
  UserDirectoryEntry,
  VerifyCreateBody,
  VerifyCreateResponse,
  VerifyJobDto,
  WorkstationDto,
  AdvanceDuration,
} from './api';
import type { AppointmentSlot, CaFixture, Instant, Persona, PersonaId } from './fixtures';
import type { AuditEntry } from './engine';
import type { DemoStatusDto, UserSummary } from './store';

export interface ApiError {
  status: number;
  /** problem+json `code`, or "NETWORK_ERROR" when no response was received. */
  code: string;
  title: string;
  detail?: string;
  /** Parsed from `Retry-After` (seconds) or the problem body. */
  retry_after_s?: number;
  locked_until?: Instant;
  problem: ProblemDto | null;
}

export type ApiResult<T> = { ok: true; status: number; data: T } | { ok: false; error: ApiError };

export interface ApiClientConfig {
  /** Returns the bearer token for the `Authorization` header, or null. */
  getToken: () => string | null;
}
export type ConfigureApi = (config: ApiClientConfig) => void;

type R<T> = Promise<ApiResult<T>>;

/** Real-contract API (also valid against a real backend). `mfa` is sent as the `X-Demo-MFA` header. */
export interface ApiClient {
  auth: {
    login(body: LoginBody): R<LoginResponse>;
    mfa(body: MfaBody): R<SessionDto>;
    me(): R<UserSummary>;
    logout(): R<null>;
  };
  status: { get(): R<ServiceStatusDto> };
  verify: {
    create(body: VerifyCreateBody): R<VerifyCreateResponse>;
    get(jobId: string): R<VerifyJobDto>;
  };
  certRequests: {
    appointments(): R<AppointmentSlot[]>;
    create(body: CreateCertRequestBody): R<CertRequestDto>;
    list(): R<CertRequestDto[]>;
    get(id: string): R<CertRequestDto>;
    approve(id: string, body: ApproveBody, mfa: string): R<CertRequestDto>;
    reject(id: string, body: RejectBody, mfa: string): R<CertRequestDto>;
  };
  certs: {
    list(): R<CertDto[]>;
    get(serial: string): R<CertDto>;
    /** `mfa` required when the caller is an admin. */
    revoke(serial: string, body: RevokeBody, mfa?: string): R<CertDto>;
    renew(serial: string, body: RenewBody): R<CertRequestDto>;
    finalize(serial: string): R<CertDto>;
  };
  pki: {
    cas(): R<CaFixture[]>;
    crl(ca: CaFixture['id']): R<CrlDto>;
    ocsp(serial: string): R<OcspDto>;
  };
  archive: {
    list(): R<ArchiveDto[]>;
    add(body: ArchiveAddBody): R<ArchiveDto>;
    share(id: string, body: ArchiveShareBody): R<ArchiveDto>;
  };
  users: { directory(): R<UserDirectoryEntry[]> };
  admin: {
    status(): R<AdminStatusDto>;
    audit(): R<AuditEntry[]>;
    crlIssue(mfa: string): R<CrlDto>;
    closeAccount(userId: PersonaId, mfa: string): R<CloseAccountResponse>;
  };
}

/** Demo-only calls (/api/v1/demo/*, /api/v1/sign*). Never present against a real backend. */
export interface DemoApi {
  status(): R<DemoStatusDto>;
  /** Forward-only clock advance. */
  setClock(advance: AdvanceDuration): R<DemoStatusDto>;
  setFaults(faults: DemoFaultsBody): R<DemoStatusDto>;
  /** Handled by the runtime (clears all pcpsd.* keys and re-initialises state). */
  reset(): R<null>;
  personas(): R<Persona[]>;
  switchPersona(userId: PersonaId): R<SessionDto>;
  samples(): R<SampleDto[]>;
  mailbox(): R<MailDto[]>;
  progress(key: DemoProgressBody['key']): R<null>;
  workstation(): R<WorkstationDto>;
  keygen(body: KeygenBody): R<KeygenResponse>;
  signReview(body: SignReviewBody): R<SignReviewDto>;
  sign(body: SignCommitBody): R<SignResultDto>;
}
