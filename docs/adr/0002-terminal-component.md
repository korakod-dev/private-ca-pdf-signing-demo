# ADR 0002: Terminal component

Status: accepted (project plan, Stage 0). Source: demo spec 7.7 allows "xterm.js or an equivalent component".

## Decision
A custom accessible terminal: an output area with `role="log"` plus a text input. Not xterm.js.

## Why
- xterm.js injects `<style>` elements, which would need CSP `style-src 'unsafe-inline'`. Our CSP is
  `style-src 'self'` (see `vite.config.ts`).
- xterm's hidden textarea and canvas tend to cause axe violations.
- Typing into xterm from Cypress is brittle; a plain input is stable (`cy.terminalRun`, `cy.terminalAnswer`).

## Contract
`src/contracts/terminal.ts` (`TerminalIO`, `TerminalCommand`). Commands talk to the app only through `api`/`demoApi`
and a `TerminalIO`, so they are unit-testable with scripted IO and the sign desk "button mode" reuses the same code.
