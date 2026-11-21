# Private CA PDF Signing — Interactive Demo

**Try it now → [pki-demo.korakod.dev](https://pki-demo.korakod.dev)** · no sign-up, runs entirely in your browser

![Short tour of the demo: demo bar, missions, certificate request, signing terminal, verification result, audit log](docs/media/short-tour.gif)

*Short tour at 1.5× speed (on-screen guidance is in Thai). Re-record with `npm run tutorials:record -- short-tour`.*

A clickable, end-to-end simulation of an organisation running its **own Certificate Authority** to sign and verify PDF documents. It lets people *feel* the whole lifecycle — requesting a certificate, identity proofing, signing, timestamping, verifying, revocation, expiry — without touching a single real key.

Built for the moment before a team commits to a PKI rollout: stakeholders, admins and end users can walk through the real workflow, break things on purpose, and see why a signature turns valid, invalid or "unknown".

> Full developer notes (Thai + English): [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)

---

## What you can do in the demo

| | |
|---|---|
| **Request & receive a certificate** | As an employee: submit a request, wait for admin approval, collect it from a simulated mailbox |
| **Approve as an admin** | Identity-proofing checklist, issue / revoke certificates, watch the audit log grow |
| **Sign a PDF** | Through the UI, or in a simulated terminal with `pki-tool` and `pdfsign` |
| **Verify documents** | 12 sample documents (D01–D12) covering valid, tampered, revoked, expired and untrusted cases — each result explains *why* |
| **Fast-forward time** | A simulated clock jumps up to 5 years ahead so you can watch certificates expire and long-term validation matter |
| **Follow guided missions** | 11 missions (M1–M11) that teach the concepts step by step |

## Engineering highlights

- **Pure simulation engine.** All PKI behaviour is one pure function — `(state, request, clock) → (state', response, audit)`. No `Date.now`, `Math.random` or browser globals allowed (enforced by lint), so it is fully unit-testable without a UI.
- **Real API shape, swappable backend.** The UI calls `fetch('/api/v1/...')` exactly like a production client; Mock Service Worker answers in the browser. `VITE_API_MODE=live` builds without any mocks — verified that no fixture data leaks into that bundle.
- **Verification rules are real code.** The resolver runs a golden table of expected outcomes against the sample documents; only the crypto is faked.
- **One real cryptographic piece.** The audit log is a hash chain computed with real SHA-256 via WebCrypto — press *"Verify hash chain"* and it actually recomputes.
- **Honest by design.** A permanent "demo mode" banner, fake-looking serials (`DE:M0…`), downloads are explanatory text files, uploads are never read, and a fixture checker fails the build if sample data starts to look like real personal data.
- **Tested like a product.** Every mission is a Cypress spec at desktop (1280) and mobile (390) width, axe accessibility checks on every route, a keyboard-only spec, coverage thresholds in Vitest, strict CSP (no `eval`), CI on every push.
- **Decisions written down.** Architecture Decision Records and an explicit register of 47 working assumptions in [`docs/adr/`](docs/adr/).

## Stack

React 19 · TypeScript · Vite · React Router · Zustand · Tailwind CSS v4 · MSW · Vitest + Testing Library · Cypress + axe · GitHub Actions · Cloudflare Workers (static assets)

## Architecture at a glance

```
UI (pages, components, terminal)
        │  fetch('/api/v1/...')
        ▼
API client ──► MSW handlers (mock mode) ──► Simulation engine (pure) ◄── fixtures (JSON, schema-checked)
          └──► real backend (live mode, no mocks bundled)
```

```
src/contracts/  frozen interfaces shared by every layer
src/engine/     pure simulation engine + verification resolver
src/mocks/      MSW handlers
src/api/        API client (same calls in mock and live mode)
src/pages, src/components, src/terminal, src/store, src/content
cypress/        missions, smoke, accessibility specs
docs/adr/       stack, terminal component, assumption register
```

## Run locally

Requires Node 22+.

```bash
npm ci
npm run dev        # http://localhost:5173
npm run check      # full gate: lint, typecheck, tests, fixture & content checks, build, e2e
```

More commands and project rules: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## What's simulated vs. real

**Simulated:** keys, signatures, certificates, TSA/OCSP/CRL, the clock, identity proofing, downloads, per-browser state (each visitor has their own data in localStorage).
**Real:** the UI, the state machines, the verification rules, and the SHA-256 audit hash chain.

This is a learning and alignment tool, **not** a signing service. Don't use it to sign anything that matters.

## Author

Built by **Korakod** — [korakod.dev](https://korakod.dev) · [GitHub](https://github.com/korakod-dev)

MIT licensed — see [LICENSE](LICENSE).
