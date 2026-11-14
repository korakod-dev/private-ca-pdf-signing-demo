// Contract: test ids. FROZEN (additions only, deliberately).
// Pages and Cypress both import TID, so drift becomes a compile error. Use as `data-testid={TID.x.y}`.
//
// State is exposed through data attributes on the element carrying the test id:
//   data-state, data-done, data-valid, data-match, data-indication
import type { AdvanceDuration, FaultToggleKey, ServiceId } from './api';
import type { DocumentId } from './fixtures';
import type { MissionId } from './missions';
import type { PageKey } from './routes';

type Id = string | number;

export const TID = {
  /** One root element per page: `page-<key>`. Lets smoke specs assert that the right page rendered. */
  page: (key: PageKey) => `page-${key}`,

  demoBar: {
    root: 'demo-bar',
    /** Non-dismissible banner with the demo notice text. */
    banner: 'demo-banner',
    /** Collapses/expands the controls at 390 px. */
    menuToggle: 'demo-bar-menu-toggle',
    personaSelect: 'demo-persona-select',
    clockNow: 'demo-clock-now',
    clockAdvance: (d: AdvanceDuration) => `demo-clock-advance-${d}`,
    /** Toggle button; exposes aria-pressed. */
    fault: (f: FaultToggleKey) => `demo-fault-${f}`,
    reset: 'demo-reset',
    resetConfirm: 'demo-reset-confirm',
    missionsLink: 'demo-missions-link',
  },

  mfa: { dialog: 'mfa-dialog', input: 'mfa-input', submit: 'mfa-submit' },

  verify: {
    sample: (id: DocumentId | string) => `verify-sample-${id}`,
    upload: 'verify-upload',
    uploadNotice: 'verify-upload-notice',
    jobProgress: 'verify-job-progress',
    error: 'verify-error',
  },

  result: {
    /** Carries data-indication. */
    indication: 'result-indication',
    subIndication: 'result-sub-indication',
    code: 'result-code',
    questions: 'result-questions',
    warnings: 'result-warnings',
    why: 'result-why',
    rawToggle: 'result-raw-toggle',
    raw: 'result-raw',
    reportPreview: 'result-report-preview',
    download: 'result-download',
    archiveAdd: 'result-archive-add',
  },

  guide: {
    fpInput: 'guide-fp-input',
    fpCheck: 'guide-fp-check',
    /** Carries data-match="true|false". */
    fpResult: 'guide-fp-result',
  },

  terminal: { root: 'terminal', input: 'terminal-input', output: 'terminal-output' },

  sign: {
    modeToggle: 'sign-mode-toggle',
    wizardDocument: 'sign-wizard-document',
    wizardField: 'sign-wizard-field',
    wizardCertify: 'sign-wizard-certify',
    wizardPurpose: 'sign-wizard-purpose',
    wizardSha: 'sign-wizard-sha',
    wizardP12: 'sign-wizard-p12',
    wizardSubmit: 'sign-wizard-submit',
    /** Review step shown in button mode (document, sha256, existing signatures). */
    review: 'sign-review',
    /** Result block in button mode (signed file name + levels). */
    result: 'sign-result',
  },

  /** Message shown by RequireRole when the persona has the wrong role. */
  requireRole: { mismatch: 'require-role-mismatch' },

  request: { runInit: 'request-run-init', appointmentSelect: 'request-appointment-select', submit: 'request-submit', status: 'request-status' },

  certs: {
    /** Carries data-state. */
    row: (serial: string) => `certs-row-${serial}`,
    finalize: (serial: string) => `certs-finalize-${serial}`,
    renew: (serial: string) => `certs-renew-${serial}`,
    revoke: (serial: string) => `certs-revoke-${serial}`,
    revokeReason: 'certs-revoke-reason',
    revokeInvalidity: 'certs-revoke-invalidity',
    revokeSubmit: 'certs-revoke-submit',
    download: (serial: string) => `certs-download-${serial}`,
    /** Passphrase dialog of the renew button (review F27): same >= 12 characters rule as `pki-tool init`. The value is never sent or stored. */
    passphraseDialog: 'certs-passphrase-dialog',
    passphraseInput: 'certs-passphrase-input',
    passphraseSubmit: 'certs-passphrase-submit',
    passphraseError: 'certs-passphrase-error',
  },

  adminRequests: {
    /** Carries data-state. */
    row: (id: string) => `admin-requests-row-${id}`,
    /** n = 1..6 (the six CSR checks); carries data-state="passed|failed". */
    csrCheck: (id: string, n: number) => `admin-requests-csr-${id}-${n}`,
    /** n = 1..5 (the five in-person checkboxes). */
    checklist: (id: string, n: number) => `admin-requests-check-${id}-${n}`,
    approve: (id: string) => `admin-requests-approve-${id}`,
    reject: (id: string) => `admin-requests-reject-${id}`,
    rejectReason: 'admin-requests-reject-reason',
    /** Free-text note (RejectBody.note). */
    rejectNote: 'admin-requests-reject-note',
    rejectSubmit: 'admin-requests-reject-submit',
  },

  adminCerts: {
    row: (serial: string) => `admin-certs-row-${serial}`,
    revoke: (serial: string) => `admin-certs-revoke-${serial}`,
    closeAccount: (userId: string) => `admin-certs-close-${userId}`,
  },

  adminStatus: {
    /** One card per ServiceId (see SERVICE_IDS in api.ts). */
    service: (id: ServiceId) => `admin-status-service-${id}`,
    /** Fault toggle buttons on /admin/status (aria-pressed). Distinct from demoBar.fault so ids stay unique per page. */
    fault: (f: FaultToggleKey) => `admin-status-fault-${f}`,
    issueCrl: 'admin-status-issue-crl',
    auditTable: 'admin-status-audit-table',
    verifyChain: 'admin-status-verify-chain',
    /** Carries data-valid="true|false". */
    chainResult: 'admin-status-chain-result',
  },

  archive: {
    /** Carries data-state. */
    row: (id: Id) => `archive-row-${id}`,
    share: (id: Id) => `archive-share-${id}`,
    shareTarget: 'archive-share-target',
    shareSubmit: 'archive-share-submit',
  },

  pki: {
    crlNumber: 'pki-crl-number',
    crlNextUpdate: 'pki-crl-next-update',
    crlEntries: 'pki-crl-entries',
    ocspInput: 'pki-ocsp-input',
    ocspQuery: 'pki-ocsp-query',
    ocspResult: 'pki-ocsp-result',
    /** Visible when OCSP says revoked but the serial is not among the CRL entries (R14). */
    r14Warning: 'pki-r14-warning',
  },

  missions: {
    /** Carries data-done="true|false". */
    item: (m: MissionId) => `missions-item-${m}`,
  },

  login: {
    email: 'login-email',
    password: 'login-password',
    submit: 'login-submit',
    mfaInput: 'login-mfa-input',
    mfaSubmit: 'login-mfa-submit',
    lockMessage: 'login-lock-message',
    demoCreds: 'login-demo-creds',
  },

  mailbox: { list: 'mailbox-list', message: (i: Id) => `mailbox-message-${i}` },
} as const;
