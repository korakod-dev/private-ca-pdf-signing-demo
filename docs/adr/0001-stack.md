# ADR 0001: Stack

Status: accepted (project maintainer decision, Stage 0). Source: demo spec section 2.

## Decision
Static SPA built with Vite + React + TypeScript, React Router, Zustand, Tailwind CSS v4 (`@tailwindcss/vite`),
MSW (Mock Service Worker) for the mock API, Vitest + Testing Library for unit tests, Cypress + axe for E2E and accessibility.

## Why
- Builds to plain static files: no server, no cost, opens anywhere.
- The UI calls `fetch('/api/v1/...')` like the real system; MSW answers in the browser. `VITE_API_MODE=live` switches
  to a real backend without UI changes (mocks are never imported in live mode).
- The simulation engine is a pure function `(state, request, clock) -> (state', response, audit)` so Vitest tests it
  without a UI.

## Versions installed at Stage 0 (2026-11-13)
react 19.3, react-router 8.5, vite 8.3, vitest 5.1, typescript 6.0, tailwindcss 4.3, msw 3.0, cypress 15.21,
eslint 9.39. Notes:
- ESLint is pinned to 9.x because `eslint-plugin-jsx-a11y` 6.10 declares peer support only up to ESLint 9.
- `npm audit` reported 7 moderate findings (all via a `minimatch` ReDoS, GHSA-g3hv-75wg-m249, affected range
  >=7.0.0 <11.0.1, in `typescript-eslint`'s dev-only dependency tree). Stage 3 (QA F31) added
  `overrides: { "@typescript-eslint/typescript-estree": { "minimatch": "^11.0.1" } }` in `package.json` (resolves to
  11.0.8). `npm audit` is now clean (0 vulnerabilities); lint, typecheck and tests were re-run on that tree. Drop the
  override once typescript-eslint itself depends on minimatch >= 11.0.1.

## Quality gate
`npm run check` = lint, typecheck, unit tests, fixture check, content check, build, E2E.
