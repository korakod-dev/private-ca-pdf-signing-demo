// R14 logic table (spec 7.4): OCSP says revoked, the CRL does not list the serial yet.
import { describe, expect, it } from 'vitest';
import type { CrlDto, OcspDto } from '../../../contracts/api';
import { isR14Window, r14NotComparable } from '../r14';

const SERIAL = 'DE:M0:4F:2A:91:01';
const ocsp = (status: OcspDto['status'], serial = SERIAL) => ({ status, serial });
const crl = (...serials: string[]): Pick<CrlDto, 'entries'> => ({
  entries: serials.map((serial) => ({ serial, revoked_at: '2026-11-12T09:00:00+07:00', reason: 'cessationOfOperation', invalidity_date: null })),
});

describe('isR14Window', () => {
  it.each([
    ['revoked, CRL does not list the serial -> warning', ocsp('revoked'), crl(), true],
    ['revoked, CRL lists another serial only -> warning', ocsp('revoked'), crl('DE:M0:6B:D0:22:01'), true],
    ['revoked, CRL lists the serial -> no warning', ocsp('revoked'), crl(SERIAL), false],
    ['good, CRL empty -> no warning', ocsp('good'), crl(), false],
    ['unknown, CRL empty -> no warning', ocsp('unknown'), crl(), false],
    ['revoked, CRL could not be fetched -> no warning', ocsp('revoked'), null, false],
    ['no OCSP answer yet -> no warning', null, crl(), false],
    ['no answers at all -> no warning', null, null, false],
  ] as const)('%s', (_name, o, c, expected) => {
    expect(isR14Window(o, c)).toBe(expected);
  });
});

describe('r14NotComparable', () => {
  it('is true only for a revoked OCSP answer with no CRL', () => {
    expect(r14NotComparable(ocsp('revoked'), null)).toBe(true);
    expect(r14NotComparable(ocsp('revoked'), crl())).toBe(false);
    expect(r14NotComparable(ocsp('good'), null)).toBe(false);
    expect(r14NotComparable(null, null)).toBe(false);
  });
});
