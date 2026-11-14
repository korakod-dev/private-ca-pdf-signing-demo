// Mission helpers shared by cypress/e2e/missions/*.cy.ts and cypress/e2e/a11y/*.cy.ts (sub-task H).
// Rules: selectors come only from TID (src/contracts/testids.ts), routes only from ROUTES (src/contracts/routes.ts).
// Anything the contract does not pin down (button wording, whether a field is a <select> or a radio group, the exact
// text of a problem message) is matched tolerantly and the assumption is written next to the helper.
import type { Indication, PersonaId, ResultCode, Role, SubIndication } from '../../src/contracts/fixtures';
import type { MissionId } from '../../src/contracts/missions';
import { ROLE_HOME, ROUTES, type PageKey } from '../../src/contracts/routes';
import { TID } from '../../src/contracts/testids';
import { VIEWPORTS } from './commands';

// ---------------------------------------------------------------------------------------------------------------------
// Constants (golden values come from the demo spec, NOT from src/fixtures, so a wrong fixture cannot make a test pass).

/** Demo MFA code (spec 7.2). Same value as `cy.mfa()` types. */
export const DEMO_MFA = '246810';
/** Password of every simulated .p12 file (spec 7.1). */
export const DEMO_P12_PASSWORD = 'demo-p12-password';
/** Root CA SHA-256 fingerprint (spec 7.3): the only value the M1 fingerprint practice accepts. */
export const ROOT_FINGERPRINT = 'DE:M0:7A:C3:A1:0F:B4:EA:03:30:05:C8:F7:9E:73:5C:FA:09:C5:EC:BB:44:09:85:EC:D9:56:95:FF:45:19:BE';
/** Same fingerprint with the last pair changed (a plausible typo / forged value). */
export const WRONG_FINGERPRINT = 'DE:M0:7A:C3:A1:0F:B4:EA:03:30:05:C8:F7:9E:73:5C:FA:09:C5:EC:BB:44:09:85:EC:D9:56:95:FF:45:19:BF';
/** Serial of u-somchai's active certificate (spec 7.2). */
export const SOMCHAI_CERT = 'DE:M0:4F:2A:91:01';
/** Serial of u-aree's certificate that expires in 21 days (spec 7.2). */
export const AREE_CERT = 'DE:M0:22:91:AF:03';
/** Request id of u-manop's request with two wrong CSR checks (fixture `requests.json`, spec 7.2). */
export const MANOP_REQUEST = 'req-manop-01';

/** The persona's role, used to wait for the role-home page after a persona switch. */
const PERSONA_ROLE: Record<PersonaId, Role> = {
  'u-somchai': 'signer',
  'u-wipawan': 'signer',
  'u-nattapon': 'new_user',
  'u-aree': 'signer',
  'u-manop': 'user',
  'u-guest': 'verifier',
  'a-admin-a': 'admin-a',
  'a-admin-b': 'admin-b',
};

/** Expected result of a verification (spec 7.5). `sub` null = no sub-indication. */
export interface GoldenResult {
  indication: Indication;
  sub: SubIndication | null;
  code: ResultCode;
}

/** Spec 7.5 golden table for the documents that produce a report (D10 and D11 are errors, see ERROR_SAMPLES). */
export const GOLDEN = {
  D01: { indication: 'TOTAL-PASSED', sub: null, code: 'VALID' },
  D02: { indication: 'TOTAL-FAILED', sub: null, code: 'MODIFIED' },
  D03: { indication: 'TOTAL-FAILED', sub: null, code: 'MODIFIED' },
  D04: { indication: 'TOTAL-FAILED', sub: 'REVOKED', code: 'REVOKED' },
  D05: { indication: 'TOTAL-PASSED', sub: null, code: 'VALID' },
  D06: { indication: 'TOTAL-FAILED', sub: 'NO_CERTIFICATE_CHAIN_FOUND', code: 'UNTRUSTED' },
  D07: { indication: 'TOTAL-PASSED', sub: null, code: 'VALID' },
  D08: { indication: 'INDETERMINATE', sub: 'NO_POE', code: 'NO_POE' },
  D09: { indication: 'TOTAL-PASSED', sub: null, code: 'VALID' },
} as const satisfies Record<string, GoldenResult>;
export type GoldenDocId = keyof typeof GOLDEN;
export const GOLDEN_DOC_IDS = Object.keys(GOLDEN) as GoldenDocId[];

/**
 * Samples rejected before a job exists (A4, A36): the error is shown on /verify. The pattern accepts the HTTP status,
 * the problem code or a Thai keyword, because the contract fixes the test id but not the wording of the message.
 */
export const ERROR_SAMPLES = {
  D10: /422|ENCRYPTED_PDF|เข้ารหัส/,
  D11: /413|PDF_TOO_LARGE|ใหญ่|200\s*หน้า/,
} as const;
/** Message shown for a verify POST beyond the per-minute limit (A30, 429). */
export const RATE_LIMIT_MESSAGE = /429|RATE_LIMITED|บ่อย|เกินกำหนด|รอ/;

// ---------------------------------------------------------------------------------------------------------------------
// Structure helpers

/**
 * One `it` per viewport (1280x800, 390x844). Missions change state (a request gets approved, a cert gets revoked), so the
 * two viewport runs must not share a test: Cypress clears localStorage (= the whole demo state) between tests, which
 * gives each viewport a fresh epoch. `cy.forEachViewport` inside one test would run the 2nd viewport on the leftovers
 * of the 1st. (cy.forEachViewport is still used by the read-only a11y sweep.)
 */
export function missionAtEachViewport(title: string, journey: () => void): void {
  VIEWPORTS.forEach(([width, height]) => {
    it(`${title} @${width}`, () => {
      cy.viewport(width, height);
      journey();
    });
  });
}

/** Visits `path` with test mode on, waits for the page root of `key`, and runs axe (serious/critical). */
export function gotoPage(key: PageKey, path: string): void {
  cy.visitDemo(path);
  expectPage(key);
}

/** Asserts the page root of `key` rendered and runs axe on it. Use after an in-app navigation (no reload). */
export function expectPage(key: PageKey): void {
  cy.tid(TID.page(key)).should('exist');
  cy.a11y();
}

/**
 * Signs in as `persona` through the demo bar and waits until the role home page is the current location
 * (ROLE_HOME, plan section 2). Needs a page with the demo bar loaded (every page has it).
 */
export function switchTo(persona: PersonaId): void {
  cy.switchPersona(persona);
  cy.location('pathname').should('eq', ROLE_HOME[PERSONA_ROLE[persona]]);
}

/** First page load of a journey: open the demo home, then act as `persona`. */
export function startAs(persona: PersonaId): void {
  cy.visitDemo(ROUTES.home);
  switchTo(persona);
}

/** Asserts the done flag of a mission on /missions (visits the page, runs axe on it). */
export function expectMissionDone(mission: MissionId, done: boolean): void {
  gotoPage('missions', ROUTES.missions);
  cy.tid(TID.missions.item(mission)).should('have.attr', 'data-done', String(done));
}

// ---------------------------------------------------------------------------------------------------------------------
// Form helpers (the contract does not say which control a test id sits on)

/** Passes when the element is disabled natively or through aria-disabled. */
export function shouldBeDisabled($el: JQuery<HTMLElement>): void {
  const disabled = $el.is(':disabled') || $el.attr('aria-disabled') === 'true';
  expect(disabled, 'element is disabled').to.eq(true);
}

/**
 * Chooses `value` in the control with test id `id`. Supports a <select> (by option value) and a group of radio inputs
 * inside the element (by input value). Used for the revoke reason and the reject reason.
 */
export function pickValue(id: string, value: string): void {
  cy.tid(id).then(($el) => {
    if ($el.is('select')) {
      cy.wrap($el).select(value);
    } else {
      cy.wrap($el).find(`input[type="radio"][value="${value}"]`).check();
    }
  });
}

/** Selects the first real option (non-empty value, not disabled) of the <select> with test id `id`. */
export function selectFirstOption(id: string): void {
  cy.tid(id).then(($select) => {
    const value = $select
      .find('option')
      .filter((_i, option) => !(option as HTMLOptionElement).disabled && (option as HTMLOptionElement).value !== '')
      .first()
      .val();
    expect(value, 'a selectable option').to.be.a('string');
    cy.wrap($select).select(value as string);
  });
}

/** Rows of a list are found by test-id prefix: `rowSelector(TID.certs.row)` matches every certs row. */
export function rowSelector(builder: (id: string) => string, stateFilter = ''): string {
  return `[data-testid^="${builder('')}"]${stateFilter}`;
}

/** Extracts the id part of a row's test id, given the builder that made it. */
export function rowId(builder: (id: string) => string, $row: JQuery<HTMLElement>): string {
  return String($row.attr('data-testid')).slice(builder('').length);
}

// ---------------------------------------------------------------------------------------------------------------------
// Verify flow

/** Clicks a sample card on /verify (the page must be loaded). */
export function clickSample(id: string): void {
  cy.tid(TID.verify.sample(id)).click();
}

/** Opens /verify, runs a sample, and lands on /verify/:jobId (no axe; callers decide). */
export function openResultOf(id: string): void {
  cy.visitDemo(ROUTES.verify);
  clickSample(id);
  cy.location('pathname').should('match', /^\/verify\/[^/]+$/);
}

/** Asserts the report on the result page: indication (attribute), sub-indication and code (text). */
export function expectResult(expected: GoldenResult): void {
  cy.tid(TID.result.indication).should('have.attr', 'data-indication', expected.indication);
  if (expected.sub !== null) cy.tid(TID.result.subIndication).should('contain.text', expected.sub);
  cy.tid(TID.result.code).should('contain.text', expected.code);
}

/** Opens a sample as the current persona, checks the golden result and runs axe on the result page. */
export function verifyAndExpect(id: string, expected: GoldenResult): void {
  openResultOf(id);
  expectResult(expected);
  cy.a11y();
}

// ---------------------------------------------------------------------------------------------------------------------
// Terminal helpers (src/terminal/core/TerminalView.tsx)

/** aria-label of the terminal input while no question is pending (TerminalView). A pending question changes the label. */
export const TERMINAL_IDLE_LABEL = 'พิมพ์คำสั่ง';

/** Waits until the terminal asks a question: the input is enabled and its label is the question, not the idle label. */
export function waitForPrompt(): void {
  cy.tid(TID.terminal.input).should(($input) => {
    expect($input.is(':disabled'), 'input enabled').to.eq(false);
    expect($input.attr('aria-label'), 'a question is pending').not.to.eq(TERMINAL_IDLE_LABEL);
  });
}

/** Waits until the terminal is idle again (the running command has finished and nothing is asked). */
export function waitForIdle(): void {
  cy.tid(TID.terminal.input).should(($input) => {
    expect($input.is(':disabled'), 'input enabled').to.eq(false);
    expect($input.attr('aria-label'), 'no question pending').to.eq(TERMINAL_IDLE_LABEL);
  });
}

/**
 * Answers the next question. Waiting first matters: an answer typed before the question exists would be run as a command.
 * `secret` also asserts the field is masked (type=password), which is how the sign desk asks for the .p12 password.
 */
export function answerPrompt(answer: string, opts: { secret?: boolean } = {}): void {
  waitForPrompt();
  if (opts.secret) cy.tid(TID.terminal.input).should('have.attr', 'type', 'password');
  cy.terminalAnswer(answer);
}

/** Last four characters of the newest full document SHA-256 (A24: `de00` + 60 hex) printed in the terminal output. */
export function shaSuffixFromOutput(): Cypress.Chainable<string> {
  return cy
    .tid(TID.terminal.output)
    .should(($out) => {
      expect($out.text(), 'a document SHA-256 printed by the review step').to.match(/de00[0-9a-f]{60}/);
    })
    .then(($out) => {
      const all = $out.text().match(/de00[0-9a-f]{60}/g) ?? [];
      return (all[all.length - 1] as string).slice(-4);
    });
}

/** A syntactically valid suffix that is different from `suffix` (for the "wrong last 4 characters" step). */
export function wrongSuffixFor(suffix: string): string {
  return suffix === '0000' ? '1111' : '0000';
}

export interface SignOptions {
  /** File path as typed in the terminal, e.g. `~/Documents/memo-130-unsigned.pdf`. */
  file: string;
  field: string;
  certify?: boolean;
  /** Type a wrong SHA suffix first and expect the question again (A13 / spec 7.7 re-ask). */
  wrongShaFirst?: boolean;
}

/**
 * Drives `pdfsign sign` up to and including the .p12 password (the question order of spec 7.7:
 * purpose -> last 4 of the SHA-256 -> .p12 password). The caller asserts what the command prints afterwards.
 */
export function runSign(opts: SignOptions): void {
  cy.terminalRun(`pdfsign sign ${opts.file} --field "${opts.field}"${opts.certify ? ' --certify' : ''}`);
  answerPrompt('1'); // purpose 1 = approve (A13)
  shaSuffixFromOutput().then((suffix) => {
    if (opts.wrongShaFirst) {
      answerPrompt(wrongSuffixFor(suffix));
      // The command must ask again; the right suffix is accepted on the next try.
    }
    answerPrompt(suffix);
  });
  answerPrompt(DEMO_P12_PASSWORD, { secret: true });
}

// ---------------------------------------------------------------------------------------------------------------------
// Keyboard helpers (cypress/e2e/a11y/keyboard.cy.ts)

/** Upper bound of Tab presses to reach a control (demo bar + nav come first). A page with more stops fails loudly. */
const MAX_TABS = 150;

const byTid = (id: string): string => `[data-testid="${id}"]`;

/**
 * Native Enter key. `cy.press(Cypress.Keyboard.Keys.ENTER)` (Cypress 15.21, Electron 138) sends keydown/keyup without a
 * character, so a focused button or link is NOT activated and a form is NOT submitted (probed on 2026-11-13; Space and
 * Tab work). Dispatching the event through the Chrome DevTools Protocol with `text: "\r"` produces the full native
 * sequence (keydown, keypress, click/submit). Chromium-based browsers only (Electron, Chrome, Edge), which is what the
 * `cypress run` default uses.
 */
export function pressEnter(): void {
  const key = { key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  cy.wrap(null, { log: false })
    .then(() =>
      Cypress.automation('remote:debugger:protocol', {
        command: 'Input.dispatchKeyEvent',
        params: { type: 'keyDown', text: '\r', ...key },
      }),
    )
    .then(() =>
      Cypress.automation('remote:debugger:protocol', {
        command: 'Input.dispatchKeyEvent',
        params: { type: 'keyUp', ...key },
      }),
    );
}

/** Presses Tab until the focus is on (or inside) the element with test id `id`. Fails after MAX_TABS presses. */
export function tabTo(id: string, remaining: number = MAX_TABS): void {
  cy.document({ log: false }).then((doc) => {
    const active = doc.activeElement;
    // `closest` accepts the control itself or any element inside the tagged card/button.
    if (active && active.closest(byTid(id))) return;
    if (remaining <= 0) throw new Error(`Tab never reached [data-testid="${id}"] within ${MAX_TABS} presses`);
    cy.press(Cypress.Keyboard.Keys.TAB);
    tabTo(id, remaining - 1);
  });
}

/** Asserts (with retry) that the keyboard focus is inside the element with test id `id`. */
export function focusIsInside(id: string): void {
  cy.document({ log: false }).should((doc) => {
    expect(doc.activeElement?.closest(byTid(id)) ?? null, `focus inside ${id}`).not.to.eq(null);
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Admin helpers

/** Opens the MFA dialog's expectation: the dialog is visible, then the demo code is submitted (cy.mfa) and the dialog closes. */
export function confirmMfa(): void {
  cy.tid(TID.mfa.dialog).should('be.visible');
  cy.mfa();
  cy.tid(TID.mfa.dialog).should('not.exist');
}
