// M1 (spec 7.8, journey plan 3.9): guest -> /guide -> wrong fingerprint (data-match=false) -> the Root fingerprint
// (data-match=true) -> /missions shows M1 done. Pages used: /guide (sub-task E), /missions (sub-task G).
import { ROUTES } from '../../../src/contracts/routes';
import { TID } from '../../../src/contracts/testids';
import { ROOT_FINGERPRINT, WRONG_FINGERPRINT, expectMissionDone, gotoPage, missionAtEachViewport, startAs } from '../../support/missions';

describe('M1: install and compare the Root fingerprint', () => {
  missionAtEachViewport('a wrong fingerprint does not match, the right one does and completes the mission', () => {
    startAs('u-guest');
    expectMissionDone('M1', false);

    gotoPage('guide', ROUTES.guide);

    // Wrong value first: the practice must say "no match" and must not complete the mission.
    cy.tid(TID.guide.fpInput).clear().type(WRONG_FINGERPRINT);
    cy.tid(TID.guide.fpCheck).click();
    cy.tid(TID.guide.fpResult).should('have.attr', 'data-match', 'false');
    cy.a11y();

    // The real Root fingerprint (spec 7.3, starts DE:M0:7A:C3, ends 19:BE).
    cy.tid(TID.guide.fpInput).clear().type(ROOT_FINGERPRINT);
    cy.tid(TID.guide.fpCheck).click();
    cy.tid(TID.guide.fpResult).should('have.attr', 'data-match', 'true');
    cy.a11y();

    expectMissionDone('M1', true);
  });
});
