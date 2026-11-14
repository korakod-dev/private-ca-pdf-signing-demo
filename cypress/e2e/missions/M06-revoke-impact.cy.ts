// M6: somchai revokes his own certificate. OCSP answers "revoked" at once but the CRL does not list it until the next
// issue, so /pki/status shows the R14 warning. D01 (signed before) still passes, D04 (revoked before signing) fails.
// Pages used: /certs (sub-task F), /pki/status + /verify (E), /missions (G).
import { ROUTES } from '../../../src/contracts/routes';
import { TID } from '../../../src/contracts/testids';
import {
  GOLDEN,
  SOMCHAI_CERT,
  expectMissionDone,
  gotoPage,
  missionAtEachViewport,
  pickValue,
  startAs,
  verifyAndExpect,
} from '../../support/missions';

describe('M6: revoke and look at the consequences', () => {
  missionAtEachViewport('self-revoke -> OCSP revoked + R14, serial absent from CRL -> D01 passes, D04 fails', () => {
    startAs('u-somchai');
    expectMissionDone('M6', false);

    // --- self-revoke with a user reason (A11: cessationOfOperation); users need no MFA (only admins do) ---
    gotoPage('certs', ROUTES.certs);
    cy.tid(TID.certs.row(SOMCHAI_CERT)).should('have.attr', 'data-state', 'Active');
    cy.tid(TID.certs.revoke(SOMCHAI_CERT)).click();
    pickValue(TID.certs.revokeReason, 'cessationOfOperation');
    cy.tid(TID.certs.revokeSubmit).click();
    cy.tid(TID.certs.row(SOMCHAI_CERT)).should('have.attr', 'data-state', 'Revoked');
    cy.a11y();

    // --- /pki/status: OCSP knows already, the CRL has not been re-issued yet (R14) ---
    gotoPage('pkiStatus', ROUTES.pkiStatus);
    cy.tid(TID.pki.ocspInput).clear().type(SOMCHAI_CERT);
    cy.tid(TID.pki.ocspQuery).click();
    cy.tid(TID.pki.ocspResult).should('contain.text', SOMCHAI_CERT).and(($result) => {
      expect($result.text(), 'OCSP answer').to.match(/revoked|เพิกถอน/i);
    });
    cy.tid(TID.pki.r14Warning).should('be.visible');
    cy.tid(TID.pki.crlEntries).should('not.contain.text', SOMCHAI_CERT);
    cy.a11y();

    // --- verify: the old document keeps its result, the one signed with a revoked cert fails ---
    verifyAndExpect('D01', GOLDEN.D01);
    verifyAndExpect('D04', GOLDEN.D04);

    expectMissionDone('M6', true);
  });
});
