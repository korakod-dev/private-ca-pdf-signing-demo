// R14 window: OCSP already says "revoked" for a serial that the published CRL does not list yet (spec 7.4).
// Computed in the UI from the two answers (spec 7.6 page 13 / plan: "computed in the UI").
//
// Truth table (CRL = the CRL answer, null when it could not be fetched):
//   OCSP status    CRL fetched?   serial in CRL entries?   -> warning
//   revoked        yes            no                       -> true   (the R14 window)
//   revoked        yes            yes                      -> false  (both agree)
//   revoked        no (CRL down)  -                        -> false  (cannot compare; the page says so separately)
//   good/unknown   any            any                      -> false
//   no OCSP answer any            any                      -> false
import type { CrlDto, OcspDto } from '../../contracts/api';

export function isR14Window(ocsp: Pick<OcspDto, 'status' | 'serial'> | null, crl: Pick<CrlDto, 'entries'> | null): boolean {
  if (!ocsp || ocsp.status !== 'revoked' || !crl) return false;
  return !crl.entries.some((entry) => entry.serial === ocsp.serial);
}

/** OCSP says revoked but the CRL could not be fetched, so R14 cannot be judged. */
export function r14NotComparable(ocsp: Pick<OcspDto, 'status'> | null, crl: unknown | null): boolean {
  return ocsp?.status === 'revoked' && crl === null;
}
