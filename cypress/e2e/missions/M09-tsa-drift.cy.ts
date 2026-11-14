// M9: admin-a switches on "TSA drift", the TSA card shows 1.4 s, somchai's signing is refused at commit (503 TSA_DRIFT,
// rule T9) and the audit log has a `sign.refused` event with TSA_DRIFT.
// Pages used: /admin/status + /sign + pdfsign (sub-task G), /missions (G). Terminal core from D.
import { ROUTES } from '../../../src/contracts/routes';
import { TID } from '../../../src/contracts/testids';
import {
  expectMissionDone,
  gotoPage,
  missionAtEachViewport,
  runSign,
  startAs,
  switchTo,
  waitForIdle,
} from '../../support/missions';

describe('M9: TSA clock drift stops signing', () => {
  missionAtEachViewport('drift on -> TSA card shows 1.4 s -> sign is refused with TSA_DRIFT -> audit has sign.refused', () => {
    startAs('a-admin-a');
    expectMissionDone('M9', false);

    // --- admin-a: the fault toggle on the status page ---
    gotoPage('adminStatus', ROUTES.adminStatus);
    cy.tid(TID.adminStatus.fault('tsa-drift')).click();
    cy.tid(TID.adminStatus.fault('tsa-drift')).should('have.attr', 'aria-pressed', 'true');
    // Offset 1400 ms (A15) shown as seconds or milliseconds; the card for the `tsa` service id carries it.
    cy.tid(TID.adminStatus.service('tsa')).should('contain.text', '1.4');
    cy.a11y();

    // --- somchai: the sign desk refuses; the answers up to the .p12 password are valid, the refusal comes at commit ---
    switchTo('u-somchai');
    gotoPage('sign', ROUTES.sign);
    runSign({ file: '~/Documents/memo-130-unsigned.pdf', field: 'approver-1', certify: true });
    cy.tid(TID.terminal.output).should('contain.text', 'TSA_DRIFT').and('contain.text', 'T9');
    waitForIdle();
    cy.a11y();

    // --- admin-a: the refusal is audited ---
    switchTo('a-admin-a');
    gotoPage('adminStatus', ROUTES.adminStatus);
    cy.tid(TID.adminStatus.auditTable).should('contain.text', 'sign.refused').and('contain.text', 'TSA_DRIFT');

    expectMissionDone('M9', true);
  });
});
