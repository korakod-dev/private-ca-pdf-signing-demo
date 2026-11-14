// Smoke for the ops cluster (sub-task G): /sign, /admin/status, /archive, /missions, each at 1280 and 390 with axe.
// Only light interactions here; the full mission journeys (M4, M8, M9, M11) live in cypress/e2e/missions (sub-task H).
// A persona is chosen with the demo bar and the page is then opened by URL: the session token and the simulated state
// are stored in localStorage, so they survive the reload that cy.visitDemo performs.
import type { PersonaId } from '../../../src/contracts/fixtures';
import { SERVICE_IDS } from '../../../src/contracts/api';
import { MISSIONS } from '../../../src/contracts/missions';
import { ROUTES } from '../../../src/contracts/routes';
import { TID } from '../../../src/contracts/testids';

/** Starts as `persona` on `path` (fresh state per test: Cypress clears localStorage between tests). */
function openAs(persona: PersonaId, path: string) {
  cy.visitDemo(ROUTES.home);
  cy.switchPersona(persona);
  cy.visitDemo(path);
}

describe('ops smoke: /missions', () => {
  it('lists M1-M11 (none done yet), public page, axe clean', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(ROUTES.missions);
      cy.tid(TID.page('missions')).should('exist');
      MISSIONS.forEach((m) => cy.tid(TID.missions.item(m.id)).should('exist').and('have.attr', 'data-done', 'false'));
      cy.tid(TID.missions.item('M9')).find('details').should('not.have.attr', 'open');
      cy.a11y();
    });
  });
});

describe('ops smoke: /sign', () => {
  it('a verifier is told this page is for another role (RequireRole), axe clean', () => {
    cy.forEachViewport(() => {
      openAs('u-guest', ROUTES.sign);
      cy.tid(TID.requireRole.mismatch).should('be.visible');
      cy.tid(TID.terminal.root).should('not.exist');
      cy.a11y();
    });
  });

  it('a signer gets the terminal; --yes is refused (S2); button mode shows the review', () => {
    cy.forEachViewport(() => {
      openAs('u-somchai', ROUTES.sign);
      cy.tid(TID.terminal.root).should('be.visible');
      cy.terminalRun('ls ~/Documents');
      cy.tid(TID.terminal.output).should('contain.text', 'memo-130-unsigned.pdf');
      cy.terminalRun('pdfsign sign ~/Documents/memo-130-unsigned.pdf --field "approver-1" --certify --yes');
      cy.tid(TID.terminal.output).should('contain.text', 'S2');
      cy.a11y();

      // Button mode: same command underneath; the review (with the SHA-256) appears after the first submit.
      cy.tid(TID.sign.modeToggle).click().should('have.attr', 'aria-pressed', 'true');
      cy.tid(TID.sign.wizardDocument).should('have.value', '~/Documents/memo-130-unsigned.pdf');
      cy.tid(TID.sign.wizardField).clear().type('approver-1');
      cy.tid(TID.sign.wizardCertify).check();
      cy.tid(TID.sign.wizardSubmit).click();
      cy.tid(TID.sign.review).should('be.visible').and('contain.text', 'SHA-256');
      cy.tid(TID.sign.wizardSubmit).should('have.attr', 'data-step', 'purpose');
      cy.a11y();
    });
  });
});

describe('ops smoke: /admin/status', () => {
  it('a signer is told this page is for admins (RequireRole)', () => {
    cy.forEachViewport(() => {
      openAs('u-somchai', ROUTES.adminStatus);
      cy.tid(TID.requireRole.mismatch).should('be.visible');
      cy.tid(TID.adminStatus.auditTable).should('not.exist');
      cy.a11y();
    });
  });

  it('admin-a: service cards, TSA drift toggle shows 1.4 s, issue CRL with MFA, audit table, axe clean', () => {
    cy.forEachViewport(() => {
      openAs('a-admin-a', ROUTES.adminStatus);
      SERVICE_IDS.forEach((id) => cy.tid(TID.adminStatus.service(id)).should('exist'));
      cy.tid(TID.adminStatus.auditTable).should('exist');

      cy.tid(TID.adminStatus.fault('tsa-drift')).should('not.be.disabled').click();
      cy.tid(TID.adminStatus.fault('tsa-drift')).should('have.attr', 'aria-pressed', 'true');
      cy.tid(TID.adminStatus.service('tsa')).should('have.attr', 'data-state', 'down').and('contain.text', '1.4');
      cy.tid(TID.adminStatus.fault('tsa-drift')).click();
      cy.tid(TID.adminStatus.fault('tsa-drift')).should('have.attr', 'aria-pressed', 'false');

      cy.tid(TID.adminStatus.issueCrl).click();
      cy.tid(TID.mfa.dialog).should('be.visible');
      cy.a11y();
      cy.mfa();
      cy.contains('ออก CRL หมายเลข').should('be.visible');
      cy.a11y();
    });
  });

  it('admin-b: verify hash chain -> valid (and no issue-CRL button)', () => {
    cy.forEachViewport(() => {
      openAs('a-admin-b', ROUTES.adminStatus);
      cy.tid(TID.adminStatus.issueCrl).should('not.exist');
      cy.tid(TID.adminStatus.verifyChain).click();
      cy.tid(TID.adminStatus.chainResult).should('have.attr', 'data-valid', 'true');
      cy.a11y();
      // The check recorded mission M11.
      cy.visitDemo(ROUTES.missions);
      cy.tid(TID.missions.item('M11')).should('have.attr', 'data-done', 'true');
    });
  });
});

describe('ops smoke: /archive', () => {
  it('an admin is told this page is for other roles (RequireRole)', () => {
    cy.forEachViewport(() => {
      openAs('a-admin-a', ROUTES.archive);
      cy.tid(TID.requireRole.mismatch).should('be.visible');
      cy.a11y();
    });
  });

  it('a signer sees the (empty) archive with the explanation, axe clean', () => {
    cy.forEachViewport(() => {
      openAs('u-somchai', ROUTES.archive);
      cy.tid(TID.page('archive')).should('exist');
      cy.contains('ยังไม่มีรายการในคลัง').should('be.visible');
      cy.get('details').first().should('not.have.attr', 'open');
      cy.a11y();
    });
  });
});
