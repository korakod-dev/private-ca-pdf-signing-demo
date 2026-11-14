// M11: admin-b (read-only auditor, A12) checks the audit hash chain in the browser: data-valid=true completes the mission.
// Pages used: /admin/status (sub-task G), /missions (G).
import { ROUTES } from '../../../src/contracts/routes';
import { TID } from '../../../src/contracts/testids';
import { expectMissionDone, gotoPage, missionAtEachViewport, startAs } from '../../support/missions';

describe('M11: check the audit log', () => {
  missionAtEachViewport('verify the hash chain -> valid -> mission done', () => {
    startAs('a-admin-b');
    expectMissionDone('M11', false);

    gotoPage('adminStatus', ROUTES.adminStatus);
    cy.tid(TID.adminStatus.auditTable).should('exist');
    cy.tid(TID.adminStatus.verifyChain).click();
    cy.tid(TID.adminStatus.chainResult).should('have.attr', 'data-valid', 'true');
    cy.a11y();

    expectMissionDone('M11', true);
  });
});
