// Shared test helpers for the E pages (API result builders, report/job factories). Not production code.
import type { SignatureResult, VerifyCheck, VerifyJobDto, VerifyReport } from '../../../contracts/api';
import type { ApiResult } from '../../../contracts/api-client';
import type { DemoStatusDto, UserSummary } from '../../../contracts/store';

export const ok = <T>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data });

export const fail = (
  status: number,
  code: string,
  extra: { title?: string; detail?: string; retry_after_s?: number; ref?: string } = {},
): ApiResult<never> => ({
  ok: false,
  error: {
    status,
    code,
    title: extra.title ?? code,
    detail: extra.detail,
    retry_after_s: extra.retry_after_s,
    problem: {
      type: `/problems/${code}`,
      title: extra.title ?? code,
      status,
      code,
      detail: extra.detail,
      retry_after_s: extra.retry_after_s,
      ref: extra.ref,
    },
  },
});

export const check = (id: VerifyCheck['id'], result: VerifyCheck['result'], code: string, refs: string[] = ['V5']): VerifyCheck => ({
  id,
  result,
  code,
  refs,
});

/** The seven checks of a clean signature, in resolver order. */
export const cleanChecks = (): VerifyCheck[] => [
  check('integrity', 'passed', 'INTEGRITY_OK'),
  check('modification', 'passed', 'NOT_MODIFIED'),
  check('chain', 'passed', 'CHAIN_TRUSTED', ['V6']),
  check('poe', 'passed', 'POE_TIMESTAMP', ['V4']),
  check('validity', 'passed', 'CERT_VALID_AT_POE', ['V4']),
  check('revocation', 'passed', 'REVOCATION_GOOD_OCSP', ['R15']),
  check('policy', 'passed', 'POLICY_STRICT_V1_OK'),
];

export const signature = (over: Partial<SignatureResult> = {}): SignatureResult => ({
  id: 'D01-sig1',
  field: 'approver-1',
  type: 'certification',
  signer: { subject: 'CN=สมชาย ใจดี', serial: 'DE:M0:4F:2A:91:01' },
  signing_time: '2026-10-20T09:55:00+07:00',
  timestamp: { time: '2026-10-20T10:00:00+07:00', tsa_serial: 'DE:M0:00:00:00:03' },
  level: 'B-LTA',
  indication: 'TOTAL-PASSED',
  sub_indication: null,
  code: 'VALID',
  checks: cleanChecks(),
  warnings: [],
  ...over,
});

export const makeReport = (over: Partial<VerifyReport> = {}): VerifyReport => ({
  job_id: 'job-0001',
  created_at: '2026-11-12T09:00:00+07:00',
  finished_at: '2026-11-12T09:00:01+07:00',
  policy: 'strict-v1',
  validation_time: '2026-11-12T09:00:01+07:00',
  document: { id: 'D01', file_name: 'memo-118.signed.pdf', sha256: `de00${'a'.repeat(60)}`, pages: 2, size_bytes: 120000 },
  indication: 'TOTAL-PASSED',
  sub_indication: null,
  code: 'VALID',
  questions: { modified: 'no', signer_trusted: 'yes', valid_at_signing: 'yes' },
  signatures: [signature()],
  doc_timestamps: [],
  warnings: [],
  refs: ['V3'],
  ...over,
});

export const doneJob = (report: VerifyReport): VerifyJobDto => ({
  job_id: report.job_id,
  status: 'done',
  created_at: report.created_at,
  result: report,
  error: null,
});

export const userSummary = (over: Partial<UserSummary> = {}): UserSummary => ({
  id: 'u-somchai',
  display_name: 'สมชาย ใจดี',
  email: 'somchai@lab.korakod.dev',
  role: 'signer',
  ...over,
});

export const demoStatus = (over: Partial<DemoStatusDto> = {}): DemoStatusDto => ({
  now: '2026-11-12T09:00:00+07:00',
  clock_mode: 'frozen',
  faults: { ocsp_down: false, crl_down: false, tsa_drift_ms: 0, queue_full: false },
  actor: null,
  missions: [],
  unread_mail: 0,
  tsa_offset_ms: 0,
  ...over,
});

