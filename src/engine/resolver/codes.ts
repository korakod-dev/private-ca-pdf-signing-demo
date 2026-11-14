// Stable check codes emitted by the verification resolver (VerifyCheck.code).
// UI content is keyed by these (src/content/results/<CODE>.md), so they are part of the public surface:
// add new codes freely, but never rename or remove one without telling the content owners.
//
// Signature/document-level result codes (VALID, MODIFIED, REVOKED, UNTRUSTED, NO_POE, TRY_LATER) live in
// the frozen contract (ResultCode); the codes below are the per-check codes inside `SignatureResult.checks[]`.
import type { VerifyCheck } from '../../contracts/api';

export const CHECK_CODES = {
  integrity: ['INTEGRITY_OK'],
  modification: ['NOT_MODIFIED', 'MODIFIED_CONTENT', 'MODIFIED_FORM_FILL'],
  chain: ['CHAIN_TRUSTED', 'CHAIN_UNTRUSTED'],
  poe: ['POE_TIMESTAMP', 'POE_VALIDATION_TIME', 'NO_POE'],
  validity: ['CERT_VALID_AT_POE', 'CERT_NOT_VALID_AT_POE'],
  revocation: [
    'REVOCATION_GOOD_OCSP',
    'REVOCATION_GOOD_CRL',
    'REVOKED_BEFORE_POE',
    'REVOKED_AFTER_POE',
    'REVOCATION_UNAVAILABLE',
    'REVOCATION_UNKNOWN',
  ],
  policy: ['POLICY_STRICT_V1_OK', 'POLICY_FORM_FILL_REJECTED', 'POLICY_LTV_IGNORED'],
} as const satisfies Record<VerifyCheck['id'], readonly string[]>;

/** Used by every check that was not evaluated because an earlier check already ruled the signature out. */
export const SKIPPED_CODE = 'SKIPPED';

export type CheckCode = (typeof CHECK_CODES)[VerifyCheck['id']][number] | typeof SKIPPED_CODE;
