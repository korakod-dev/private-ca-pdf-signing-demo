// Axe sweep (spec section 3: no serious/critical violations): every page route x the persona(s) that may use it x both
// viewports. `cy.a11y()` checks serious and critical impacts only. Read-only visits, so one test can cover both
// viewports (cy.forEachViewport); the persona is signed in once at 1280 px, before the first viewport change.
//
// Public pages are swept twice: anonymous (nobody signed in) and as the guest/verifier.
// Restricted pages are swept as the role that may use them, and must NOT show the wrong-role message.
import { PAGE_ROUTES, type PageKey } from '../../../src/contracts/routes';
import type { PersonaId } from '../../../src/contracts/fixtures';
import { TID } from '../../../src/contracts/testids';

/** Personas allowed on each restricted page (spec 7.2, engine access policy in src/engine/routes.ts). */
const RESTRICTED: Partial<Record<PageKey, PersonaId[]>> = {
  certRequest: ['u-nattapon'],
  certs: ['u-somchai', 'u-aree'],
  sign: ['u-somchai'],
  adminRequests: ['a-admin-a'],
  adminCerts: ['a-admin-a'],
  adminStatus: ['a-admin-a', 'a-admin-b'],
  archive: ['u-somchai'],
};

describe('a11y: every route, appropriate role, both viewports', () => {
  PAGE_ROUTES.forEach((route) => {
    const personas = RESTRICTED[route.key];
    // `null` = anonymous visit.
    const actors: (PersonaId | null)[] = personas ?? [null, 'u-guest'];

    actors.forEach((persona) => {
      it(`${route.key} (${route.sample}) as ${persona ?? 'anonymous'}`, () => {
        if (persona) {
          cy.visitDemo('/');
          cy.switchPersona(persona);
        }
        cy.forEachViewport(() => {
          cy.visitDemo(route.sample);
          cy.tid(TID.page(route.key)).should('exist');
          if (personas) {
            // Wait until the demo status (and so the signed-in user) is loaded, then the gate must be open.
            cy.tid(TID.demoBar.clockNow).should('have.attr', 'data-now');
            cy.tid(TID.requireRole.mismatch).should('not.exist');
          }
          cy.a11y();
        });
      });
    });
  });
});
