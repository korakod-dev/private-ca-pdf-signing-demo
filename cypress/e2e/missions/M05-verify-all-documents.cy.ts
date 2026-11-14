// M5: the guest opens every sample D01..D11. Results match the spec 7.5 golden table, D10 -> 422, D11 -> 413, and the
// 12th request in the same simulated minute -> 429 until the clock moves 5 minutes (A30, A36).
// Pages used: /verify, /verify/:jobId (sub-task E), /missions (G).
import { ROUTES } from '../../../src/contracts/routes';
import { TID } from '../../../src/contracts/testids';
import {
  ERROR_SAMPLES,
  GOLDEN,
  GOLDEN_DOC_IDS,
  RATE_LIMIT_MESSAGE,
  clickSample,
  expectMissionDone,
  expectPage,
  expectResult,
  gotoPage,
  missionAtEachViewport,
  openResultOf,
  startAs,
  verifyAndExpect,
} from '../../support/missions';

/** The error shown on /verify (no job is created, the page stays on /verify). */
function expectVerifyError(message: RegExp): void {
  cy.tid(TID.verify.error)
    .should('be.visible')
    .and(($error) => {
      expect($error.text(), 'problem message').to.match(message);
    });
  cy.location('pathname').should('eq', ROUTES.verify);
}

describe('M5: verify every kind of document', () => {
  missionAtEachViewport('D01-D09 match the golden table, D10 is 422, D11 is 413, then 429 and recovery after PT5M', () => {
    startAs('u-guest');
    expectMissionDone('M5', false);

    gotoPage('verify', ROUTES.verify);
    // The upload path is a notice only (the demo never reads files); the 12 sample cards are the real input.
    cy.tid(TID.verify.upload).should('exist');

    // D01..D09: one report each, with the expected indication / sub-indication / code.
    GOLDEN_DOC_IDS.forEach((id) => verifyAndExpect(id, GOLDEN[id]));

    // Open the explanations once on a failing document: "why" panel and the raw JSON.
    openResultOf('D04');
    expectResult(GOLDEN.D04);
    cy.tid(TID.result.why).should('be.visible');
    cy.tid(TID.result.rawToggle).click();
    cy.tid(TID.result.raw).should('be.visible').and('contain.text', 'TOTAL-FAILED');
    cy.a11y();

    // D10 (encrypted PDF) and D11 (too many pages) are refused before a job exists (A4).
    cy.visitDemo(ROUTES.verify);
    clickSample('D10');
    expectVerifyError(ERROR_SAMPLES.D10);
    cy.a11y();
    cy.visitDemo(ROUTES.verify);
    clickSample('D11');
    expectVerifyError(ERROR_SAMPLES.D11);

    // 10 report POSTs (D01-D09 + the extra D04) + D10 + D11 already went out in this simulated minute (limit 10, A30).
    // D10 and D11 were still answered 422/413 because the pre-checks run before the rate limit (A36); the next POST is 429.
    cy.visitDemo(ROUTES.verify);
    clickSample('D01');
    expectVerifyError(RATE_LIMIT_MESSAGE);
    cy.a11y();

    // 5 simulated minutes later the window is clear and the same request succeeds.
    cy.advanceClock('PT5M');
    clickSample('D01');
    cy.location('pathname').should('match', /^\/verify\/[^/]+$/);
    expectPage('verifyResult');
    expectResult(GOLDEN.D01);

    expectMissionDone('M5', true);
  });
});
