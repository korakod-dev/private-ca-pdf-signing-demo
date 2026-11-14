// Custom Cypress commands (plan section 3.8). Stage 0 wrote them against the contract; sub-task D makes them
// work against the real demo bar. All selectors come from TID so a rename is a compile error.
import { TID } from '../../src/contracts/testids';
import type { AdvanceDuration, FaultToggleKey } from '../../src/contracts/api';
import type { PersonaId } from '../../src/contracts/fixtures';
import { STORAGE_KEYS, type TestMode } from '../../src/contracts/runtime';

/** Desktop and mobile viewports used by every spec (spec section 3). */
export const VIEWPORTS: readonly [number, number][] = [
  [1280, 800],
  [390, 844],
];

const DEMO_MFA_CODE = '246810';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Cypress {
    interface Chainable {
      /** Visits a path with test mode on (no latency, frozen clock). */
      visitDemo(path: string, opts?: Partial<Cypress.VisitOptions>): Chainable<unknown>;
      /** `cy.get('[data-testid="<id>"]')`. */
      tid(id: string): Chainable<JQuery<HTMLElement>>;
      /** Expands the demo bar menu when it is collapsed (390 px). */
      openDemoBar(): Chainable<unknown>;
      switchPersona(id: PersonaId): Chainable<unknown>;
      advanceClock(d: AdvanceDuration): Chainable<unknown>;
      setFault(f: FaultToggleKey, on: boolean): Chainable<unknown>;
      /** Fills the MFA dialog with the demo code and submits it. */
      mfa(): Chainable<unknown>;
      terminalRun(line: string): Chainable<unknown>;
      /** Answers a terminal prompt (same mechanics as terminalRun). */
      terminalAnswer(text: string): Chainable<unknown>;
      /** axe check: serious and critical impacts only. */
      a11y(): Chainable<unknown>;
      /** Runs `fn` once per viewport (1280x800, 390x844). `fn` should start with cy.visitDemo. */
      forEachViewport(fn: (viewport: { width: number; height: number }) => void): Chainable<unknown>;
    }
  }
}

Cypress.Commands.add('visitDemo', (path, opts = {}) => {
  const testMode: TestMode = { latency: false, clock: 'frozen' };
  cy.visit(path, {
    ...opts,
    onBeforeLoad(win) {
      win.localStorage.setItem(STORAGE_KEYS.testMode, JSON.stringify(testMode));
      opts.onBeforeLoad?.(win);
    },
  });
});

Cypress.Commands.add('tid', (id) => cy.get(`[data-testid="${id}"]`));

Cypress.Commands.add('openDemoBar', () => {
  // React renders asynchronously after the load event: wait until the bar is in the DOM before inspecting it.
  cy.tid(TID.demoBar.menuToggle).should('exist');
  // The toggle is displayed only when the bar collapses (narrow screens); open it when the controls are hidden.
  cy.get('body').then(($body) => {
    const toggle = $body.find(`[data-testid="${TID.demoBar.menuToggle}"]:visible`);
    if (toggle.length > 0 && toggle.attr('aria-expanded') !== 'true') {
      cy.tid(TID.demoBar.menuToggle).click();
    }
  });
});

Cypress.Commands.add('switchPersona', (id) => {
  cy.openDemoBar();
  cy.tid(TID.demoBar.personaSelect).select(id);
  // The select is controlled by the signed-in persona, so it only shows `id` once the switch has completed
  // (session stored, navigation to the role home started). Waiting here keeps the next step deterministic.
  cy.tid(TID.demoBar.personaSelect).should('have.value', id);
});

Cypress.Commands.add('advanceClock', (d) => {
  cy.openDemoBar();
  cy.tid(TID.demoBar.clockAdvance(d)).click();
  // The bar disables its controls while a request is in flight; enabled again = the advance has been applied.
  cy.tid(TID.demoBar.clockAdvance(d)).should('not.be.disabled');
});

Cypress.Commands.add('setFault', (f, on) => {
  cy.openDemoBar();
  // Toggles are disabled until the fault state has loaded; wait for that before reading aria-pressed.
  cy.tid(TID.demoBar.fault(f)).should('not.be.disabled');
  // Fault toggles expose aria-pressed; click only when the current state differs.
  cy.tid(TID.demoBar.fault(f)).then(($btn) => {
    const pressed = $btn.attr('aria-pressed') === 'true';
    if (pressed !== on) cy.wrap($btn).click();
  });
  cy.tid(TID.demoBar.fault(f)).should('have.attr', 'aria-pressed', String(on));
});

Cypress.Commands.add('mfa', () => {
  cy.tid(TID.mfa.input).type(DEMO_MFA_CODE);
  cy.tid(TID.mfa.submit).click();
});

Cypress.Commands.add('terminalRun', (line) => {
  cy.tid(TID.terminal.input).type(`${line}{enter}`);
});

Cypress.Commands.add('terminalAnswer', (text) => {
  cy.tid(TID.terminal.input).type(`${text}{enter}`);
});

// cypress-axe's injectAxe() evaluates axe-core with eval(), which our production CSP (script-src 'self') blocks.
// Instead of weakening the CSP in tests, serve axe-core from a same-origin URL (intercepted by Cypress) and
// load it with <script src>, which the CSP allows. cy.checkA11y then works as usual (it only needs window.axe).
const AXE_PATH = '/__cypress-axe-core.js';

Cypress.Commands.add('a11y', () => {
  cy.readFile<string>('node_modules/axe-core/axe.min.js', 'utf8', { log: false }).then((source) => {
    cy.intercept({ method: 'GET', pathname: AXE_PATH }, { body: source, headers: { 'content-type': 'text/javascript' } });
  });
  cy.window({ log: false }).then(
    (win) =>
      new Promise<void>((resolve, reject) => {
        if ((win as unknown as { axe?: unknown }).axe) {
          resolve();
          return;
        }
        const script = win.document.createElement('script');
        script.src = AXE_PATH;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('could not load axe-core from the intercepted URL'));
        win.document.head.appendChild(script);
      }),
  );
  cy.checkA11y(undefined, { includedImpacts: ['serious', 'critical'] });
});

Cypress.Commands.add('forEachViewport', (fn) => {
  VIEWPORTS.forEach(([width, height]) => {
    cy.viewport(width, height);
    fn({ width, height });
  });
});

export {};
