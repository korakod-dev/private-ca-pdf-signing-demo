// M10: the guest verifies D01 while only OCSP is down (CRL fallback, still TOTAL-PASSED, A14), then while OCSP and CRL
// are both down (hard-fail: INDETERMINATE / TRY_LATER).
// Pages used: /verify, /verify/:jobId (sub-task E), /missions (G). Fault switches live in the demo bar (D).
import { ROUTES } from '../../../src/contracts/routes';
import {
  GOLDEN,
  expectMissionDone,
  gotoPage,
  missionAtEachViewport,
  startAs,
  verifyAndExpect,
} from '../../support/missions';

describe('M10: status services down', () => {
  missionAtEachViewport('OCSP only down: D01 still passes; OCSP + CRL down: INDETERMINATE / TRY_LATER', () => {
    startAs('u-guest');
    expectMissionDone('M10', false);
    gotoPage('verify', ROUTES.verify);

    // --- one source down: the other one answers (R15 order: OCSP first, CRL fallback) ---
    cy.setFault('ocsp', true);
    verifyAndExpect('D01', GOLDEN.D01);

    // --- both down: no revocation status can be obtained, strict-v1 hard-fails ---
    cy.setFault('ocsp', false);
    cy.setFault('ocsp-crl', true);
    verifyAndExpect('D01', { indication: 'INDETERMINATE', sub: 'TRY_LATER', code: 'TRY_LATER' });

    expectMissionDone('M10', true);
  });
});
