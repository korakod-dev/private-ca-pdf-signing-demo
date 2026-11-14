// Stage 0 smoke: every route renders the always-on demo banner at both viewports, with no serious/critical axe issues.
import { PAGE_ROUTES } from '../../../src/contracts/routes';
import { TID } from '../../../src/contracts/testids';
import { DEMO_BANNER_TEXT } from '../../../src/config/demo';

describe('smoke: all routes show the demo banner', () => {
  PAGE_ROUTES.forEach((route) => {
    it(`${route.key} (${route.sample})`, () => {
      cy.forEachViewport(() => {
        cy.visitDemo(route.sample);
        cy.tid(TID.demoBar.banner).should('be.visible').and('have.text', DEMO_BANNER_TEXT);
        cy.tid(TID.page(route.key)).should('exist');
        cy.a11y();
      });
    });
  });
});
