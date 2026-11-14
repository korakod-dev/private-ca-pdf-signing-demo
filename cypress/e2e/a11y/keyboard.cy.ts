// Keyboard-only checks (spec section 3: everything usable with the keyboard).
//   1. The M5 flow for D01: reach the sample card with Tab, open it with Enter, reach the raw-JSON toggle, open it.
//   2. The MFA dialog: opened with Enter, focus lands in the code field, Tab stays inside the dialog, Esc closes it and
//      focus returns to the opener, and Enter submits the demo code.
// Tab and Esc are real key presses through `cy.press` (Cypress >= 14.3; the installed 15.21 has it). Enter goes through
// `pressEnter` (support/missions.ts) because `cy.press(ENTER)` does not activate buttons in this Cypress version.
// Only the digits of the MFA code are entered with `type`: `cy.press` sends named keys, not characters.
import { ROUTES } from '../../../src/contracts/routes';
import { TID } from '../../../src/contracts/testids';
import { VIEWPORTS } from '../../support/commands';
import { DEMO_MFA, focusIsInside, pressEnter, startAs, tabTo } from '../../support/missions';

const { TAB, ESC } = Cypress.Keyboard.Keys;

describe('keyboard: M5 D01 flow', () => {
  VIEWPORTS.forEach(([width, height]) => {
    it(`Tab to the D01 card, Enter opens the report, Tab + Enter opens the raw JSON @${width}`, () => {
      cy.viewport(width, height);
      startAs('u-guest');
      cy.visitDemo(ROUTES.verify);
      cy.tid(TID.page('verify')).should('exist');

      tabTo(TID.verify.sample('D01'));
      cy.a11y(); // focus ring state, nothing opened yet
      pressEnter();

      cy.location('pathname').should('match', /^\/verify\/[^/]+$/);
      cy.tid(TID.result.indication).should('have.attr', 'data-indication', 'TOTAL-PASSED');

      tabTo(TID.result.rawToggle);
      pressEnter();
      cy.tid(TID.result.raw).should('be.visible').and('contain.text', 'TOTAL-PASSED');
      cy.a11y();
    });
  });
});

describe('keyboard: MFA dialog', () => {
  VIEWPORTS.forEach(([width, height]) => {
    it(`Enter opens it, focus is trapped, Esc closes and restores focus, Enter submits @${width}`, () => {
      cy.viewport(width, height);
      startAs('a-admin-a');
      cy.visitDemo(ROUTES.adminStatus);
      cy.tid(TID.page('adminStatus')).should('exist');

      // Open with the keyboard on "issue CRL now" (an MFA action, spec 7.2).
      tabTo(TID.adminStatus.issueCrl);
      pressEnter();
      cy.tid(TID.mfa.dialog).should('be.visible');
      cy.tid(TID.mfa.input).should('have.focus');
      cy.a11y();

      // Tab (forwards) must never leave the dialog.
      for (let i = 0; i < 6; i += 1) {
        cy.press(TAB);
        focusIsInside(TID.mfa.dialog);
      }

      // Esc cancels and gives the focus back to the control that opened it.
      cy.press(ESC);
      cy.tid(TID.mfa.dialog).should('not.exist');
      focusIsInside(TID.adminStatus.issueCrl);

      // Open again; the code is typed into the focused field and Enter submits the form.
      pressEnter();
      cy.tid(TID.mfa.input).should('have.focus').type(DEMO_MFA);
      pressEnter();
      cy.tid(TID.mfa.dialog).should('not.exist');
    });
  });
});
