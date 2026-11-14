// M3: admin-a rejects manop's request (CSR checks 2 and 4 fail, so approve is disabled).
// Pages used: /admin/requests (sub-task F), /missions (G).
import { ROUTES } from '../../../src/contracts/routes';
import { TID } from '../../../src/contracts/testids';
import {
  MANOP_REQUEST,
  confirmMfa,
  expectMissionDone,
  gotoPage,
  missionAtEachViewport,
  pickValue,
  shouldBeDisabled,
  startAs,
} from '../../support/missions';

describe('M3: reject a wrong request', () => {
  missionAtEachViewport('CSR checks 2 and 4 fail, approve is disabled, reject with a reason and MFA', () => {
    startAs('a-admin-a');
    expectMissionDone('M3', false);

    gotoPage('adminRequests', ROUTES.adminRequests);
    cy.tid(TID.adminRequests.row(MANOP_REQUEST)).should('have.attr', 'data-state', 'awaitingInPerson');

    // Spec 7.2 / A7: manop's CSR has someone else's name (check 2) and an RSA 1024 key (check 4). The others pass.
    [1, 3, 5, 6].forEach((n) => cy.tid(TID.adminRequests.csrCheck(MANOP_REQUEST, n)).should('have.attr', 'data-state', 'passed'));
    [2, 4].forEach((n) => cy.tid(TID.adminRequests.csrCheck(MANOP_REQUEST, n)).should('have.attr', 'data-state', 'failed'));
    cy.tid(TID.adminRequests.approve(MANOP_REQUEST)).should(shouldBeDisabled);
    cy.a11y();

    // Reject: reason code + note, then the MFA dialog.
    cy.tid(TID.adminRequests.reject(MANOP_REQUEST)).click();
    pickValue(TID.adminRequests.rejectReason, 'csr_check_failed');
    cy.tid(TID.adminRequests.rejectNote).type('CSR ไม่ผ่านข้อ 2 และ 4 (ชื่อไม่ตรง, คีย์ RSA 1024)');
    cy.tid(TID.adminRequests.rejectSubmit).click();
    confirmMfa();
    cy.tid(TID.adminRequests.row(MANOP_REQUEST)).should('have.attr', 'data-state', 'rejected');
    cy.a11y();

    expectMissionDone('M3', true);
  });
});
