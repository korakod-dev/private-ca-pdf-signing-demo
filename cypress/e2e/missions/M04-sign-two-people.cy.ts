// M4: somchai signs (certification), wipawan signs (approval), the result verifies TOTAL-PASSED.
// Pages used: /sign + `pdfsign` (sub-task G), /verify/:jobId (E), /missions (G). Terminal core from D.
// Question order of `pdfsign sign` (spec 7.7): purpose 1-4 -> last 4 hex characters of the SHA-256 -> .p12 password.
import { ROUTES } from '../../../src/contracts/routes';
import { TID } from '../../../src/contracts/testids';
import {
  expectMissionDone,
  expectPage,
  expectResult,
  gotoPage,
  missionAtEachViewport,
  runSign,
  startAs,
  switchTo,
  waitForIdle,
} from '../../support/missions';

describe('M4: sign a document with two people', () => {
  missionAtEachViewport('S2 error for --yes, wrong SHA-4 is re-asked, s1 then s2, verify is TOTAL-PASSED', () => {
    startAs('u-somchai');
    expectMissionDone('M4', false);

    // --- somchai: first signature (certification) ---
    gotoPage('sign', ROUTES.sign);

    // There is no --yes (rule S2): the command refuses and names the rule.
    cy.terminalRun('pdfsign sign ~/Documents/memo-130-unsigned.pdf --field "approver-1" --certify --yes');
    cy.tid(TID.terminal.output).should('contain.text', 'S2');
    waitForIdle();

    runSign({ file: '~/Documents/memo-130-unsigned.pdf', field: 'approver-1', certify: true, wrongShaFirst: true });
    cy.tid(TID.terminal.output)
      .should('contain.text', 'B-T')
      .and('contain.text', 'B-LT')
      .and('contain.text', 'B-LTA')
      .and('contain.text', 'memo-130-s1.signed.pdf');
    waitForIdle();
    cy.a11y();

    // --- wipawan: second signature (approval) on the file somchai produced (~/Documents is shared, A22) ---
    switchTo('u-wipawan');
    gotoPage('sign', ROUTES.sign);
    runSign({ file: '~/Documents/memo-130-s1.signed.pdf', field: 'approver-2' });
    cy.tid(TID.terminal.output).should('contain.text', 'memo-130-s2.signed.pdf');
    waitForIdle();

    // --- verify from the terminal: it prints a short result and a link to the full report ---
    cy.terminalRun('pdfsign verify ~/Documents/memo-130-s2.signed.pdf');
    cy.tid(TID.terminal.output).find(`a[href^="${ROUTES.verify}/"]`).should('exist').click();
    cy.location('pathname').should('match', /^\/verify\/[^/]+$/);
    expectPage('verifyResult');
    expectResult({ indication: 'TOTAL-PASSED', sub: null, code: 'VALID' });

    expectMissionDone('M4', true);
  });
});
