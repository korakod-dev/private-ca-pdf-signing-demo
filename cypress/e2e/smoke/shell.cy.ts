// Shell smoke: exercises every Cypress support command at both viewports, plus the F9 pinned-bar proof, with axe.
//
// QA F16: this spec used to run on a test-only harness page (/__shell-test with a fake `ask` command). It now runs on the
// REAL pages, so the harness, its route and the `ask` command are gone:
//  - demo bar, collapse at 390 px, reset dialog, persona/clock/fault commands: home page (every page has the bar);
//  - pinned bar (F9): a long real page (/policy) scrolled to the bottom;
//  - MFA dialog (cy.mfa): "ออก CRL ทันที" on /admin/status as admin-a;
//  - terminal (cy.terminalRun / cy.terminalAnswer, masked secret, history): /sign (help, errors, Thai quoting) and
//    /certs/request (`pki-tool init` asks a secret passphrase).
// Everything needs the demo API: the MSW Service Worker answers /api/* in the mock build that Cypress runs against.
import { ADVANCE_DURATIONS } from '../../../src/contracts/api';
import type { PersonaId } from '../../../src/contracts/fixtures';
import { ROLE_HOME } from '../../../src/contracts/routes';
import { TID } from '../../../src/contracts/testids';
import { DEMO_BANNER_TEXT } from '../../../src/config/demo';
import { ROUTES } from '../../../src/contracts/routes';
import { answerPrompt, gotoPage, startAs, waitForIdle } from '../../support/missions';

/** Host page of the demo bar tests (public, every page has the bar). */
const HOST = ROUTES.home;
/** A long real page: the pinned-bar proof scrolls it to the bottom. */
const LONG_PAGE = ROUTES.policy;

describe('shell: demo bar', () => {
  it('shows the banner on both viewports, with no close control, and passes axe', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(HOST);
      cy.tid(TID.demoBar.banner).should('be.visible').and('have.text', DEMO_BANNER_TEXT);
      cy.tid(TID.demoBar.banner).find('button').should('not.exist');
      cy.tid(TID.demoBar.root).contains('button', /ปิด|close|dismiss/i).should('not.exist');
      cy.tid(TID.demoBar.clockNow).should('be.visible');
      cy.a11y();
    });
  });

  it('F9: stays pinned to the top (opaque) while a long page is scrolled to the bottom', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(LONG_PAGE);
      cy.tid(TID.page('policy')).should('exist');
      cy.scrollTo('bottom');
      cy.window().its('scrollY').should('be.greaterThan', 400); // the page really scrolled, so "pinned" means something
      cy.tid(TID.demoBar.root).should(($bar) => {
        const bar = $bar[0] as HTMLElement;
        const win = bar.ownerDocument.defaultView as Window;
        const style = win.getComputedStyle(bar);
        const rect = bar.getBoundingClientRect();
        expect(style.position, 'position').to.eq('sticky');
        expect(rect.top, 'bar top edge').to.eq(0);
        // Opaque: a solid colour (no alpha channel / transparent), so page text never shows through the bar.
        expect(style.backgroundColor, 'background').to.match(/^rgb\(/);
        // The notice itself is inside the viewport, and the bar is what is actually on top at that spot
        // (nothing from the long page paints over it).
        const banner = bar.querySelector(`[data-testid="${TID.demoBar.banner}"]`) as HTMLElement;
        const b = banner.getBoundingClientRect();
        expect(b.top).to.be.gte(0);
        expect(b.bottom).to.be.lte(win.innerHeight);
        const topmost = bar.ownerDocument.elementFromPoint(win.innerWidth / 2, b.top + b.height / 2);
        expect(bar.contains(topmost), 'topmost element at the banner').to.eq(true);
      });
      cy.tid(TID.demoBar.banner).should('have.text', DEMO_BANNER_TEXT);
    });
  });

  it('collapses the controls behind the menu toggle at 390 px and shows them at 1280 px', () => {
    cy.viewport(390, 844);
    cy.visitDemo(HOST);
    cy.tid(TID.demoBar.menuToggle).should('be.visible').and('have.attr', 'aria-expanded', 'false');
    cy.tid(TID.demoBar.personaSelect).should('not.be.visible');
    cy.tid(TID.demoBar.clockNow).should('be.visible'); // the clock is always visible
    cy.openDemoBar();
    cy.tid(TID.demoBar.menuToggle).should('have.attr', 'aria-expanded', 'true');
    cy.tid(TID.demoBar.personaSelect).should('be.visible');
    cy.tid(TID.demoBar.reset).should('be.visible');
    cy.tid(TID.demoBar.missionsLink).should('be.visible');
    cy.a11y();

    cy.viewport(1280, 800);
    cy.visitDemo(HOST);
    cy.tid(TID.demoBar.menuToggle).should('not.be.visible');
    cy.tid(TID.demoBar.personaSelect).should('be.visible');
    cy.openDemoBar(); // no-op when the toggle is not shown
    ADVANCE_DURATIONS.forEach((d) => cy.tid(TID.demoBar.clockAdvance(d)).should('be.visible'));
    (['ocsp', 'crl', 'ocsp-crl', 'tsa-drift', 'queue-full'] as const).forEach((f) =>
      cy.tid(TID.demoBar.fault(f)).should('be.visible').and('have.attr', 'aria-pressed'),
    );
  });

  it('missions link goes to /missions', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(HOST);
      cy.openDemoBar();
      cy.tid(TID.demoBar.missionsLink).click();
      cy.location('pathname').should('eq', '/missions');
      cy.tid(TID.page('missions')).should('exist');
    });
  });

  it('reset asks for confirmation (Esc and cancel keep everything), dialog passes axe', () => {
    cy.forEachViewport(() => {
      cy.visitDemo(HOST);
      cy.openDemoBar();
      cy.tid(TID.demoBar.reset).click();
      cy.get('[role="dialog"]').should('be.visible').and('contain.text', 'รีเซ็ต');
      cy.tid(TID.demoBar.resetConfirm).should('be.visible');
      cy.a11y();
      cy.get('body').type('{esc}');
      cy.get('[role="dialog"]').should('not.exist');
      cy.tid(TID.demoBar.reset).should('have.focus'); // focus returns to the opener
    });
  });
});

describe('shell: cy.mfa (admin page)', () => {
  it('MFA dialog on /admin/status: Esc cancels and returns focus, cy.mfa() submits the demo code; axe clean', () => {
    cy.forEachViewport(() => {
      cy.clearLocalStorage();
      startAs('a-admin-a');
      gotoPage('adminStatus', ROUTES.adminStatus);

      cy.tid(TID.adminStatus.issueCrl).click();
      cy.tid(TID.mfa.dialog).should('be.visible');
      cy.tid(TID.mfa.input).should('have.focus');
      cy.a11y();
      cy.get('body').type('{esc}');
      cy.tid(TID.mfa.dialog).should('not.exist');
      cy.tid(TID.adminStatus.issueCrl).should('have.focus'); // focus returns to the opener
      cy.contains('ออก CRL หมายเลข').should('not.exist'); // cancelled: nothing was issued

      cy.tid(TID.adminStatus.issueCrl).click();
      cy.mfa();
      cy.tid(TID.mfa.dialog).should('not.exist');
      cy.contains('ออก CRL หมายเลข').should('be.visible');
    });
  });
});

describe('shell: cy.terminalRun / cy.terminalAnswer (real terminals)', () => {
  it('/sign: help, unknown command, quoted Thai arguments, clear; axe clean', () => {
    cy.forEachViewport(() => {
      cy.clearLocalStorage();
      startAs('u-somchai');
      gotoPage('sign', ROUTES.sign);
      cy.tid(TID.terminal.root).scrollIntoView();

      cy.terminalRun('help');
      cy.tid(TID.terminal.output).should('contain.text', 'pdfsign').and('contain.text', 'pki-tool').and('contain.text', 'clear');

      cy.terminalRun('format-everything');
      cy.tid(TID.terminal.output).should('contain.text', 'format-everything: command not found (demo)');

      // Quoted Thai text with a space goes through the parser as ONE argument (the real pdfsign command runs here; a file
      // that is not on the demo workstation gets "pdfsign: ไม่พบไฟล์ '<file>' ..."). Asserting the full file name (F33)
      // fails if the parser splits the quoted text, unlike a bare `pdfsign:` prefix that every error line has.
      cy.terminalRun('pdfsign sign "~/Documents/ไฟล์ ทดสอบ.pdf" --field "approver-1" --certify');
      cy.tid(TID.terminal.output).should('contain.text', "ไม่พบไฟล์ '~/Documents/ไฟล์ ทดสอบ.pdf'");
      waitForIdle();

      cy.terminalRun('clear');
      cy.tid(TID.terminal.output).should('not.contain.text', 'command not found');
      cy.a11y();
    });
  });

  it('/certs/request: `pki-tool init` asks a masked secret, never echoes it, and ArrowUp recalls the command (not the secret)', () => {
    const SECRET = 'S3cretPassphrase!';
    const INIT = 'pki-tool init --name "ณัฐพล ทองดี" --email nattapon@lab.korakod.dev';
    cy.forEachViewport(() => {
      cy.clearLocalStorage();
      startAs('u-nattapon');
      gotoPage('certRequest', ROUTES.certRequest);
      cy.tid(TID.terminal.root).scrollIntoView();

      cy.terminalRun(INIT);
      answerPrompt(SECRET, { secret: true }); // asserts type=password before typing
      cy.tid(TID.terminal.output).should('contain.text', 'BEGIN DEMO CSR');
      waitForIdle();
      cy.get('body').should('not.contain.text', SECRET);
      cy.tid(TID.terminal.input).should('have.attr', 'type', 'text').and('have.value', '');

      // History: ArrowUp brings back the last command (not the secret answer).
      cy.tid(TID.terminal.input).type('{uparrow}').should('have.value', INIT);
      cy.tid(TID.terminal.input).clear();
      cy.a11y();
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Persona / clock / fault commands against the demo API.

/** The placeholder option is disabled, which makes jQuery's .val() return null; read the DOM property instead. */
function expectNoPersonaSelected() {
  cy.tid(TID.demoBar.personaSelect).should(($select) => {
    expect(($select[0] as HTMLSelectElement).value).to.eq('');
  });
}

describe('shell: support commands against the demo API', () => {
  /**
   * Visits the home page and requires the demo API: the MSW Service Worker answers /api/*, so a page that is not
   * controlled by the worker is a real failure (the tests never skip).
   */
  function visitWithApi() {
    cy.visitDemo(HOST);
    cy.window().then((win) => {
      expect(Boolean(win.navigator.serviceWorker?.controller), 'demo API available (MSW Service Worker controls the page)').to.eq(true);
    });
  }

  it('cy.switchPersona goes to the role home for every role', () => {
    const personas: [PersonaId, keyof typeof ROLE_HOME][] = [
      ['u-somchai', 'signer'],
      ['u-nattapon', 'new_user'],
      ['u-manop', 'user'],
      ['u-guest', 'verifier'],
      ['a-admin-a', 'admin-a'],
      ['a-admin-b', 'admin-b'],
    ];
    cy.forEachViewport(() => {
      visitWithApi();
      personas.forEach(([id, role]) => {
        cy.switchPersona(id);
        cy.location('pathname').should('eq', ROLE_HOME[role]);
      });
      cy.a11y();
    });
  });

  it('"ลองล็อกอินเอง" signs out and opens /login', () => {
    visitWithApi();
    cy.switchPersona('u-somchai');
    cy.openDemoBar();
    cy.tid(TID.demoBar.personaSelect).select('ลองล็อกอินเอง');
    cy.location('pathname').should('eq', '/login');
    expectNoPersonaSelected();
  });

  it('cy.advanceClock moves the simulated clock forward by exactly the chosen step', () => {
    visitWithApi();
    // Wait until the first /demo/status answer is rendered (the attribute is absent until then); `invoke` alone would
    // yield undefined and not retry, which made this test race against the Service Worker round trip.
    cy.tid(TID.demoBar.clockNow).should('have.attr', 'data-now');
    cy.tid(TID.demoBar.clockNow).invoke('attr', 'data-now').then((before) => {
      cy.advanceClock('P1D');
      cy.tid(TID.demoBar.clockNow).should(($t) => {
        const after = Date.parse($t.attr('data-now') as string);
        expect(after - Date.parse(before as string)).to.eq(86_400_000);
      });
    });
  });

  it('cy.setFault toggles each fault switch on and off (aria-pressed)', () => {
    visitWithApi();
    (['ocsp', 'crl', 'ocsp-crl', 'tsa-drift', 'queue-full'] as const).forEach((f) => {
      cy.setFault(f, true);
      cy.tid(TID.demoBar.fault(f)).should('have.attr', 'aria-pressed', 'true');
      cy.setFault(f, false);
      cy.tid(TID.demoBar.fault(f)).should('have.attr', 'aria-pressed', 'false');
    });
  });

  it('reset (after confirming) signs out and restores the epoch clock', () => {
    visitWithApi();
    cy.switchPersona('u-somchai');
    cy.advanceClock('P30D');
    cy.openDemoBar();
    cy.tid(TID.demoBar.reset).click();
    cy.tid(TID.demoBar.resetConfirm).click();
    expectNoPersonaSelected();
    cy.tid(TID.demoBar.clockNow).should('have.attr', 'data-now').and('match', /^2026-11-12T09:00:00\+07:00$/);
  });
});
