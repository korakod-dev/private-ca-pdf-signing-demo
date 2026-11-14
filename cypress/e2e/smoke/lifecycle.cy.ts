// Lifecycle smoke (sub-task F): /certs/request, /certs, /admin/requests, /admin/certs, /login, /mailbox at both viewports,
// with axe on every page visited. Selectors come from TID, paths from ROUTES.
//
// Every viewport iteration starts from a clean browser state (`fresh`): the demo state lives in localStorage and would
// otherwise carry over from the 1280 px run into the 390 px run of the same test.
import { ROUTES } from '../../../src/contracts/routes';
import { TID } from '../../../src/contracts/testids';
import { answerPrompt } from '../../support/missions';

const PASSPHRASE_11 = 'elevenchars';
const PASSPHRASE_12 = 'twelve-chars';

/** Clean state, then open `path` in test mode (no latency, frozen clock). */
function fresh(path: string) {
  cy.clearLocalStorage();
  cy.visitDemo(path);
}

/** Opens a page of the main nav by its link text (the persona switch navigates to the role home only). */
function goTo(label: string) {
  cy.get('nav[aria-label="เมนูหลัก"]').contains('a', label).click();
}

describe('lifecycle: role gate (F15)', () => {
  it('shows the explanation, not an error, to a wrong persona on every restricted lifecycle page', () => {
    cy.forEachViewport(() => {
      fresh(ROUTES.home);
      // Nobody signed in yet.
      cy.visitDemo(ROUTES.certs);
      cy.tid(TID.requireRole.mismatch).should('be.visible');
      cy.a11y();

      cy.switchPersona('a-admin-b'); // read-only auditor: no approve/reject/revoke (A12)
      goTo('Admin — คำขอ');
      cy.tid(TID.requireRole.mismatch).should('be.visible').and('have.attr', 'data-required-roles', 'admin-a');
      goTo('Admin — ใบรับรอง');
      cy.tid(TID.requireRole.mismatch).should('be.visible');
      goTo('ใบรับรองของฉัน');
      cy.tid(TID.requireRole.mismatch).should('be.visible');

      cy.switchPersona('u-guest');
      goTo('ขอใบรับรอง');
      cy.tid(TID.requireRole.mismatch).should('be.visible');
      cy.a11y();
    });
  });
});

describe('lifecycle: login', () => {
  it('shows the demo credentials, locks after 3 wrong passwords, unlocks with the simulated clock, then logs in (2 steps)', () => {
    cy.forEachViewport(() => {
      fresh(ROUTES.login);
      cy.tid(TID.login.demoCreds).should('contain', '246810').and('contain', 'demo-password');
      cy.a11y();

      for (let i = 0; i < 3; i++) {
        cy.tid(TID.login.email).clear().type('somchai@lab.korakod.dev');
        cy.tid(TID.login.password).clear().type('wrong-password');
        cy.tid(TID.login.submit).click();
      }
      cy.tid(TID.login.lockMessage).should('be.visible').and('contain', 'เวลาจำลอง');
      cy.a11y();

      cy.advanceClock('PT5M'); // simulated time, not waiting
      cy.tid(TID.login.email).clear().type('somchai@lab.korakod.dev');
      cy.tid(TID.login.password).clear().type('demo-password');
      cy.tid(TID.login.submit).click();
      cy.tid(TID.login.mfaInput).type('246810');
      cy.tid(TID.login.mfaSubmit).click();
      cy.location('pathname').should('eq', ROUTES.certs);
      cy.get('[data-testid^="certs-row-"]').should('have.length.at.least', 1);
    });
  });
});

describe('lifecycle: M2 request -> approve -> finalize -> mail', () => {
  it('walks a new user through the whole certificate request', () => {
    cy.forEachViewport(() => {
      fresh(ROUTES.home);
      cy.switchPersona('u-nattapon');
      cy.location('pathname').should('eq', ROUTES.certRequest);
      cy.a11y();

      // Spec 7.6 no. 5: the "รัน pki-tool init" button types the command for the learner (the mission specs type it by hand).
      cy.tid(TID.request.runInit).click();
      cy.tid(TID.terminal.output).should('contain', '$ pki-tool init --name "ณัฐพล ทองดี" --email nattapon@lab.korakod.dev');
      cy.terminalAnswer(PASSPHRASE_11);
      cy.tid(TID.terminal.output).should('contain', 'สั้นเกินไป');
      cy.terminalAnswer(PASSPHRASE_12);
      cy.tid(TID.terminal.output).should('contain', 'BEGIN DEMO CSR');
      // The passphrase is never echoed.
      cy.tid(TID.terminal.output).should('not.contain', PASSPHRASE_12).and('not.contain', PASSPHRASE_11);

      cy.tid(TID.request.submit).should('be.disabled');
      cy.tid(TID.request.appointmentSelect).select('slot-20261114');
      cy.tid(TID.request.submit).should('be.enabled').click();
      cy.tid(TID.request.status).should('have.attr', 'data-state', 'awaitingInPerson');
      cy.a11y();

      // Admin A: tick all five, approve with MFA.
      cy.switchPersona('a-admin-a');
      cy.location('pathname').should('eq', ROUTES.adminRequests);
      cy.tid(TID.adminRequests.row('req-0001')).should('have.attr', 'data-state', 'awaitingInPerson');
      cy.tid(TID.adminRequests.approve('req-0001')).should('be.disabled');
      [1, 2, 3, 4, 5].forEach((n) => cy.tid(TID.adminRequests.checklist('req-0001', n)).check());
      cy.tid(TID.adminRequests.approve('req-0001')).should('be.enabled').click();
      cy.tid(TID.mfa.dialog).should('be.visible');
      cy.a11y();
      cy.mfa();
      cy.tid(TID.adminRequests.row('req-0001')).should('have.attr', 'data-state', 'approved');

      // Nattapon: the certificate is Issued; finalize makes it Active.
      cy.switchPersona('u-nattapon');
      goTo('ใบรับรองของฉัน');
      cy.get('[data-testid^="certs-row-"]').should('have.attr', 'data-state', 'Issued');
      cy.get('[data-testid^="certs-finalize-"]').click();
      cy.get('[data-testid^="certs-row-"]').should('have.attr', 'data-state', 'Active');
      cy.a11y();

      // The approval mail is in the mailbox (unread on the first visit).
      goTo('อีเมลจำลอง');
      cy.tid(TID.mailbox.message(0)).should('contain', 'อนุมัติ');
      cy.a11y();
    });
  });
});

describe('lifecycle: M3 reject a wrong request', () => {
  it('shows the failed CSR checks, keeps approve disabled, rejects with reason + MFA', () => {
    cy.forEachViewport(() => {
      fresh(ROUTES.home);
      cy.switchPersona('a-admin-a');
      const id = 'req-manop-01';
      cy.tid(TID.adminRequests.row(id)).should('have.attr', 'data-state', 'awaitingInPerson');
      cy.tid(TID.adminRequests.csrCheck(id, 2)).should('have.attr', 'data-state', 'failed');
      cy.tid(TID.adminRequests.csrCheck(id, 4)).should('have.attr', 'data-state', 'failed');
      cy.tid(TID.adminRequests.csrCheck(id, 1)).should('have.attr', 'data-state', 'passed');
      cy.a11y();

      // Even with all five boxes ticked the failed CSR keeps approve disabled.
      [1, 2, 3, 4, 5].forEach((n) => cy.tid(TID.adminRequests.checklist(id, n)).check());
      cy.tid(TID.adminRequests.approve(id)).should('be.disabled');

      cy.tid(TID.adminRequests.reject(id)).click();
      cy.tid(TID.adminRequests.rejectReason).select('csr_check_failed');
      cy.tid(TID.adminRequests.rejectNote).type('ชื่อใน CSR ไม่ใช่ชื่อผู้ขอ');
      cy.tid(TID.adminRequests.rejectSubmit).click();
      cy.mfa();
      cy.tid(TID.adminRequests.row(id)).should('have.attr', 'data-state', 'rejected');
      cy.a11y();
    });
  });
});

describe('lifecycle: /certs self-service', () => {
  it('M6: a user revokes their own certificate with one of 3 reasons', () => {
    cy.forEachViewport(() => {
      fresh(ROUTES.home);
      cy.switchPersona('u-somchai');
      const serial = 'DE:M0:4F:2A:91:01';
      cy.tid(TID.certs.row(serial)).should('have.attr', 'data-state', 'Active');
      cy.a11y();
      cy.tid(TID.certs.revoke(serial)).click();
      cy.tid(TID.certs.revokeReason).find('option').should('have.length', 4); // placeholder + the 3 user reasons (A11)
      cy.tid(TID.certs.revokeInvalidity).should('not.exist');
      cy.a11y();
      cy.tid(TID.certs.revokeReason).select('cessationOfOperation');
      cy.tid(TID.certs.revokeSubmit).click();
      cy.tid(TID.certs.row(serial)).should('have.attr', 'data-state', 'Revoked');
    });
  });

  it('M7: renewal creates a new Issued certificate; finalize activates it and marks the old one superseded', () => {
    cy.forEachViewport(() => {
      fresh(ROUTES.home);
      cy.switchPersona('u-aree');
      const old = 'DE:M0:22:91:AF:03';
      cy.tid(TID.certs.row(old)).should('have.attr', 'data-state', 'Active');
      cy.tid(TID.certs.renew(old)).click();
      // F27: the new key needs a passphrase (>= 12 characters), asked in a dialog; it is never shown again.
      cy.tid(TID.certs.passphraseInput).should('have.attr', 'type', 'password').type(PASSPHRASE_12);
      cy.tid(TID.certs.passphraseSubmit).click();
      cy.get('body').should('not.contain.text', PASSPHRASE_12);
      cy.get('[data-testid^="certs-row-"][data-state="Issued"]').should('have.length', 1);
      cy.get('[data-testid^="certs-finalize-"]').click();
      cy.get('[data-testid^="certs-row-"][data-state="Active"]').should('have.length', 1);
      cy.tid(TID.certs.row(old)).should('have.attr', 'data-state', 'Revoked').and('contain', 'superseded');
      cy.tid(TID.certs.download(old)).should('have.attr', 'data-file-name', 'DEMO-certificate.txt');
      cy.a11y();
    });
  });

  it('the pki-tool commands do the same as the buttons (renew, then finalize by file name)', () => {
    cy.forEachViewport(() => {
      fresh(ROUTES.home);
      cy.switchPersona('u-aree');
      // The terminal lives on /certs/request; aree has no pending request, so the page offers it.
      cy.visitDemo(ROUTES.certRequest);
      cy.terminalRun('pki-tool renew');
      // F27: renew asks the same secret passphrase as init (short one is asked again).
      answerPrompt(PASSPHRASE_11, { secret: true });
      cy.tid(TID.terminal.output).should('contain', 'สั้นเกินไป');
      answerPrompt(PASSPHRASE_12, { secret: true });
      cy.tid(TID.terminal.output).should('contain', 'สร้างกุญแจใหม่และส่งคำขอต่ออายุแล้ว');
      cy.terminalRun('ls');
      cy.tid(TID.terminal.output).should('contain', '.crt');
      cy.terminalRun('pki-tool finalize --cert DE-M0-A0-00-00-01.crt');
      cy.tid(TID.terminal.output).should('contain', 'สถานะ: Active');
      cy.terminalRun('pki-tool init --name a --email b --yes');
      cy.tid(TID.terminal.output).should('contain', 'ไม่รู้จักตัวเลือก');
    });
  });
});

describe('lifecycle: /admin/certs', () => {
  it('revokes with a reason and an invalidity date after MFA', () => {
    cy.forEachViewport(() => {
      fresh(ROUTES.home);
      cy.switchPersona('a-admin-a');
      goTo('Admin — ใบรับรอง');
      const serial = 'DE:M0:6B:D0:22:02';
      cy.tid(TID.adminCerts.row(serial)).should('have.attr', 'data-state', 'Active');
      cy.a11y();
      cy.tid(TID.adminCerts.revoke(serial)).click();
      cy.tid(TID.certs.revokeReason).find('option').should('have.length', 7); // placeholder + 6 reasons
      cy.tid(TID.certs.revokeReason).select('keyCompromise');
      cy.tid(TID.certs.revokeInvalidity).type('2026-10-15T09:00');
      cy.tid(TID.certs.revokeSubmit).click();
      cy.mfa();
      cy.tid(TID.adminCerts.row(serial)).should('have.attr', 'data-state', 'Revoked').and('contain', '2026-10-15');
    });
  });

  it('closing an account revokes its live certificates (affiliationChanged)', () => {
    cy.forEachViewport(() => {
      fresh(ROUTES.home);
      cy.switchPersona('a-admin-a');
      goTo('Admin — ใบรับรอง');
      cy.tid(TID.adminCerts.closeAccount('u-somchai')).click();
      cy.mfa();
      cy.tid(TID.adminCerts.row('DE:M0:4F:2A:91:01')).should('have.attr', 'data-state', 'Revoked').and('contain', 'affiliationChanged');
    });
  });
});

describe('lifecycle: /mailbox', () => {
  it('shows the unread 30-day notice once, then the mail is read on the next visit', () => {
    cy.forEachViewport(() => {
      fresh(ROUTES.home);
      cy.switchPersona('u-aree');
      goTo('อีเมลจำลอง');
      cy.tid(TID.mailbox.message(0)).should('have.attr', 'data-read', 'false').and('contain', 'ใกล้หมดอายุ');
      cy.a11y();
      goTo('หน้าแรก');
      goTo('อีเมลจำลอง');
      cy.tid(TID.mailbox.message(0)).should('have.attr', 'data-read', 'true');
    });
  });
});
