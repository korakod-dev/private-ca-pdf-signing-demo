# ADR 0003: Assumption register

Status: open. The main spec (`spec-discussion-summary.md`) was not available when the demo was planned (2026-11-13). The assumptions below stand in for it. Compare them with the main spec when it
is available, and mark every assumption that changes during the build.

Source: the demo spec (2026-11-12). The spec, the main spec and the project plan are internal documents and are not published in this repo.

| # | Depends on main spec | Assumption |
|---|---|---|
| A1 | V3 report schema | Shape in `src/contracts/api.ts` (snake_case; ETSI EN 319 102-1 terms; hyphenated indications as written in the demo spec, not DSS underscores) |
| A2 | V1 async job | 202 `{job_id,status}`; GET returns `status` + `result` when done; UI polls every 500 ms; latency 1-3 s, deterministic from the job id |
| A3 | V11 error format | RFC 9457 problem+json with `code` |
| A4 | V10 limits / unsigned input | Rejected synchronously on POST: 413 `PDF_TOO_LARGE`, 422 `ENCRYPTED_PDF`, 422 `NOT_SIGNED` (D12) |
| A5 | E3 / 7.1 B login API | Two-step login -> MFA ticket -> token. Lockout 3 tries / 5 simulated minutes (temporary value, approved by the project maintainer on 2026-11-13; still to be checked against มธอ. 11 เล่ม 3 ข้อ 4.2, spec 9.8) -> 423 `ACCOUNT_LOCKED` |
| A6 | API paths not in 7.10 | Additions marked (+) in the route table of the demo spec; demo-only additions stay under `/api/v1/demo/*` or `/api/v1/sign*` |
| A7 | L3 CSR checks (6) | 1 proof of possession, 2 CN = verified name, 3 email = account, 4 key ECDSA P-256/P-384 or RSA >= 3072, 5 no extra extensions, 6 key not previously used |
| A8 | 7.1 A / 6.5 in-person checklist (5) | Person matches ID photo; ID not expired; ID name = request name; requester confirms the CSR fingerprint on their own device; user agreement acknowledged. Checkboxes only |
| A9 | L4 renewal | No in-person step if proofing <= 3 years -> auto-approved -> Issued; on finalize of the new cert, the old cert is revoked with reason `superseded` |
| A10 | "superseded" state | Revoked + reason superseded, labelled "superseded" in the UI |
| A11 | User self-revocation reasons (3) | keyCompromise, affiliationChanged, cessationOfOperation; admins may also use superseded and privilegeWithdrawn, plus `invalidity_date` |
| A12 | Dual control duties | admin-a approves, rejects, revokes, issues CRLs (MFA each); admin-b is a read-only auditor (status, audit, chain verify). No dual approval in v1 |
| A13 | S purposes 1-4 | 1 approve (อนุมัติ), 2 acknowledge (รับทราบ), 3 author (ผู้จัดทำ), 4 witness (พยาน) |
| A14 | R15 order and fault effects | OCSP first, CRL fallback; only both down -> INDETERMINATE/TRY_LATER; strict-v1 hard-fails and ignores embedded LTV for current status (needed for M10) |
| A15 | T4 / NIMT display | Offset shown in ms; drift fault = 1400 ms; threshold 1000 ms |
| A16 | V12 / E2 archive | Add requires a TOTAL-PASSED job of that document; quotas enforced; share = read access for the target persona |
| A17 | Indication aggregation | Document result = worst signature |
| A18 | D06 TOTAL-FAILED vs ETSI INDETERMINATE for NO_CERTIFICATE_CHAIN_FOUND | Follow the demo spec (policy strict-v1); mention it in the technical layer |
| A19 | M2-M8 guide / result meanings, P1-P6 policies | Short demo texts, labelled "ฉบับย่อ"; refs by main-spec code + standard name; no clause numbers until verified |
| A20 | Mockup visuals | Not accessible to the project; designed from the spec text; to be reviewed against the mockup later |
| A21 | Clock | Runs 1:1 with wall time from the epoch; frozen in Cypress; forward-only advances |
| A22 | Workstation | `~/Documents` is shared across personas (one simulated office machine); `~/.private-ca` is per persona |
| A23 | M6 interpretation | R14 seen, then a REVOKED result (e.g. D04); the sign desk refuses signing after own revocation |
| A24 | Document SHA-256 marker | `de00` + 60 hex; derived documents use deterministic fake hashes |
| A25 | Historical certs for D04/D05/D07/D08 | Values in `src/fixtures/certs.json` (fictional; personas only) |
| A26 | Passwords | Init passphrase is checked locally and never sent; p12 password is sent only to demo-only `/api/v1/sign` |
| A27 | Mail | Approval, rejection, cert expiry 30/7/1, archive 30-day notice and deletion, email verification seed |
| A28 | Home status | Public `GET /api/v1/status` |
| A29 | Signed file naming | `<stem>-s<n>.signed.pdf` (stem drops `-unsigned` / `.signed`); ids `D12-s<n>` |
| A30 | Rate limit | Counts every `POST /verify` per rolling simulated minute, across the whole browser state |
| A31 | T11 re-timestamp trigger | The daily 03:00 job re-stamps an archived doc when the newest timestamp's TSA usage period ends within 30 days; successor TSAs come from `pki.json` (2 re-stamps over 5 years) |
| A32 | R15 revocation status unknown | OCSP is up but answers `unknown` for a serial (the CRL is not consulted while OCSP answers) -> INDETERMINATE/TRY_LATER (check `REVOCATION_UNKNOWN`). Resolver: `src/engine/resolver/index.ts` |
| A33 | Q3 / R15 revoked cert, no timestamp | A revoked certificate on a signature without a timestamp resolves TOTAL-FAILED/REVOKED, because the only POE is "now" (validation time), which is after the revocation |
| A34 | V4 POE outside cert validity | POE (timestamp, or "now" when there is none) outside the signer certificate's validity period -> INDETERMINATE/NO_POE (`CERT_NOT_VALID_AT_POE`); revocation is then `skipped` |
| A35 | Document result tie-break | Worst signature wins (FAILED > INDETERMINATE > PASSED). Ties between result codes: MODIFIED > UNTRUSTED > REVOKED > NO_POE > TRY_LATER, then signature order |
| A36 | Order of verify-POST checks | 413/422 pre-checks (A4) come before the 429 rate limit, and the POST still counts toward the rate window (A30); the 503 queue check comes after 429. A recorded 413/422 counts as "opened" for M5 |
| A37 | MFA error status | Missing or wrong `X-Demo-MFA` -> 403 `MFA_REQUIRED` / `MFA_INVALID` (not 401: the caller is authenticated, only the step-up is missing). Wrong code at the login MFA step (A5) is 401 `MFA_INVALID` |
| A38 | 503 `QUEUE_FULL` reachability | The 20-job cap exists, but the rate limit (10 verify POSTs per simulated minute, A30) and the 1-3 s job latency keep the queue below it, so in practice the 503 appears only through the `queue-full` fault toggle |
| A39 | Extra problem codes | `TSA_UNAVAILABLE` (503, no TSA usable at the simulated time, sign desk), `INTERNAL_ERROR` (500) and `STORAGE_ERROR` (507) raised by the mock runtime. All are in `ProblemCode`; runtime errors use the same problem shape as engine errors (`type` = `/problems/<code>`) |
| A40 | Problem `ref` member | Problem objects may carry `ref` (main-spec reference of the violated rule, e.g. `V10`); `ProblemDto.ref?: MainSpecRef` |
| A41 | Doc-timestamp-only document under OCSP + CRL down (review F18) | INDETERMINATE / TRY_LATER + warning `TSA_STATUS_UNAVAILABLE` (D09). The TSA certificate status cannot be obtained under strict-v1 hard-fail. Fault-driven only: the demo does not model TSA revocation, and the F1 rule (no TSA validity-date check) still holds. Single source down -> VALID (A14). Limited to documents with no signature (D01 has a doc timestamp but its signatures decide the result). Learner-facing technical explanation should key off this warning code once result content pages exist |
| A42 | Renewal passphrase (review F27) | `pki-tool renew` and the `/certs` renew button create a NEW key, so both ask the key passphrase like `init` (secret input, >= 12 characters; terminal: 5 attempts). The button asks it in a page dialog (`PassphraseDialog`, `TID.certs.passphrase*`). The value is only measured: `renewCertificate` and the API never receive it and nothing stores it (A26). Locked by `pkiTool.test.ts`, `requestAndCerts.test.tsx`, `src/__integration__/secrets.test.ts` and mission M7 |
| A43 | Two-layer content renderer (review F29) | One shared `LayeredContent` (`src/components`) renders every content file: simple text, the refs from the file header (always visible, under the text), technical layer collapsed. Parser: `src/lib/layers.ts`. Page groups only look the file up (`getMarkdown` in `pages/info/content.ts`, `pages/ops/content.ts`) |
| A44 | Shell test harness removed (review F16) | `/__shell-test`, `ShellTestPage` and the test-only `ask` command are gone. `shell.cy.ts` runs on real pages: demo bar and terminal on `/certs/request` and `/sign`, MFA dialog on `/admin/status`, pinned-bar proof on a long real page |
| A45 | Level wording in the terminal (review F32) | The `pdfsign` result lines for B-T / B-LT / B-LTA (`LEVEL_TH` in `src/terminal/commands/pdfsign.ts`) start with "(จำลอง)": they are the demo's own plain-language labels, not text from PAdES / ETSI EN 319 142-1 (not checked against the standard). `content/sign/desk.md` says so. If someone verifies the standard, a clause citation with `[verified]` can replace the label |
| A46 | `minimatch` override (review F31) | `package.json` `overrides` pins `@typescript-eslint/typescript-estree` -> `minimatch ^11.0.1` (dev tooling only) to clear the moderate `npm audit` findings. Remove when typescript-eslint ships with a fixed minimatch |
| A47 | Feedback link (spec 9 item 5) | `FEEDBACK_URL` in `src/config/demo.ts` is empty on purpose: `/about` shows "ยังไม่เปิดรับความเห็น". The maintainer will supply a Google Form URL; no value is invented |

## Spec issue for the project maintainer (not blocking)
Spec 7.2 has wipawan's cert starting 2026-09-12, and aree's cert (21 days left at the epoch) must have been issued around
2025-12-03. Both predate the Root and Intermediate validity start of 2026-10-01 in 7.3. D07 and D08 also need certs that
expired before the epoch. The demo keeps the spec values, adds historical certs in the same style, and the engine does not
check issuer-validity nesting. A learner who inspects dates could notice. Fix options (fixture-only change):
(a) move the CA start dates earlier (conflicts with the "2026" in the CA names), or (b) move the persona cert dates later.

The same gap exists for the TSA (found in review, F1): the TSA `DE:M0:00:00:00:03` (`tsa-2026` in `pki.json`) is valid from
2026-10-01, yet the timestamps in D04 (2026-09-11, two signatures), D05 (2026-09-20, signature and document timestamp)
and D07 (2025-06-10, signature and document timestamp) predate it. These values come from the demo spec value tables and are
NOT changed in the initial fixture set. Only the project maintainer may decide to change them (options: earlier TSA `not_before`, which
conflicts with the "2026" in its name, or a historical predecessor TSA entry for those documents).
**Rule for the resolver:** the resolver does not check that a timestamp's time lies inside the TSA's validity,
nor that issuer and subject validity periods nest. It treats a timestamp as present and valid when the fixture says so.
Doing more makes D04/D05/D07 differ from the golden table 7.5. The resolver must not "fix" this and must not add such checks.

## Initial setup additions (values the spec left open; chosen during the initial setup)
These are not in the spec tables. If one is wrong, change it in the shared contracts and fixtures.

| # | Item | Choice |
|---|---|---|
| P0-1 | Fixture dates without a time | 09:00:00+07:00 (same as the epoch) |
| P0-2 | `key_alg` of CAs besides the Root | Root and Intermediate ECDSA P-384, TSA / OCSP signer / Validation Service ECDSA P-256 (spec fixes only the Root) |
| P0-3 | OCSP signer `DE:M0:0C:SP:01` validity | 2026-11-12 09:00 -> 2026-12-12 09:00 (30 days from the epoch) |
| P0-4 | `req-manop-01` appointment | `slot-20261114` (the 2026-11-14 slot); location text "จุดพบตัวสมมติ ห้อง A (DEMO)" |
| P0-5 | Document sizes, page counts, signing times of day, `purpose` per signature | Invented plausible values (certification = purpose 3, approval = purpose 1); signing time 5 minutes before its timestamp |
| P0-6 | Reject reason codes | `csr_check_failed`, `identity_mismatch`, `other` (`REJECT_REASON_CODES` in `src/contracts/api.ts`) |
| P0-7 | Problem code list | `ProblemCode` in `src/contracts/api.ts` (open set; the engine may add codes) |
| P0-8 | "18 pages" | 17 spec pages (7.6 numbers 1-17) + `NotFoundPage`; the demo bar (number 0) is part of the layout, not a page |
| P0-9 | API route key type | `RouteKey` is the union of `API_ROUTES` keys in `src/contracts/routes.ts` (re-exported from `engine.ts`) |
| P0-10 | Test-only axe loading | `cy.a11y` serves axe-core from an intercepted same-origin URL because cypress-axe's `injectAxe` uses `eval`, which the CSP blocks |
| P0-11 | Fixture ids and values fixed after review (F2, F3, F4) | D02/D03 signature ids are `D02-sig1/2`, `D03-sig1/2`. D06 sig2 (self-signed `01`) has `purpose: null`. The D07 `sha256` was regenerated (it contained a 10-digit run that looks like a Thai phone number); it appeared only in `documents.json`, nothing else references it. The real-data detector skips hex fields (`sha256`, `fingerprint*`, `serial`), which have their own patterns, and apply the phone rule to text fields only |
| P0-12 | `EngineOptions.clock_mode` (F5) | Frozen clock is passed explicitly: `createInitialState(fx, {latency, clock_mode}, wallMs)`; the runtime maps `TestMode.clock` to it. See `engine.ts` / `runtime.ts` comments |
| P0-13 | `ServiceId` / `SERVICE_IDS` (F6) | `'ca' \| 'tsa' \| 'ocsp' \| 'crl' \| 'verify-queue'` in `src/contracts/api.ts`; `TID.adminStatus.service` takes a `ServiceId` |
| P0-14 | Mailbox read (F8) | No new route: GET `demo.mailbox` marks the actor's messages read after building the response (`MailDto` comment) |
| P0-15 | Extra test ids (F7) | `adminStatus.fault(f)`, `adminRequests.rejectNote`, `requireRole.mismatch`, `sign.review`, `sign.result` |
| P0-16 | Sticky demo bar (F9) | Requirement (also a comment in `Layout.tsx`): demo bar header is `sticky top-0 z-50` with an opaque background, plus a test |
