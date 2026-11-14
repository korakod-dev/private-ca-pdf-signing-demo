# private-ca-pdf-signing-demo

- Public repo: https://github.com/korakod-dev/private-ca-pdf-signing-demo
- Live demo: https://pki-demo.korakod.dev

## ภาษาไทย

**สถานะ: พัฒนาครบทุกขั้นแล้ว (ขั้น 0 ถึงขั้น 3) เหลือคำถามปลายเปิดของโครงการ 7 ข้อด้านล่างที่ผู้ดูแลโครงการต้องตัดสินใจหรือตรวจ** เดโมนี้เป็นเว็บจำลองระบบเซ็น PDF ด้วย CA ส่วนตัว ทุกอย่างทำงานในเบราว์เซอร์ ไม่มี server ไม่มีกุญแจหรือลายเซ็นจริง (ยกเว้นจุดเดียว: hash chain ของ audit log คำนวณ SHA-256 จริงด้วย WebCrypto ในเบราว์เซอร์ ดูหัวข้อ "อะไรจำลอง อะไรไม่จำลอง")

สิ่งที่ทำเสร็จแล้ว:
- 17 หน้าตาม spec บวกหน้า "ไม่พบหน้านี้" ทุกหน้ามีแถบ "โหมดสาธิต" ที่ปิดไม่ได้
- ระบบจำลอง (engine) ที่คำนวณผลตรวจเอกสารตัวอย่าง D01-D12 ตามตารางใน spec 7.5
- เทอร์มินัลจำลอง 2 ตัว: `pki-tool` (ขอใบรับรอง) และ `pdfsign` (เซ็นและตรวจ PDF)
- ภารกิจ M1-M11 ทุกข้อมีการทดสอบอัตโนมัติ (Cypress) ที่หน้าจอกว้าง 1280 และจอมือถือ 390
- ทดสอบการเข้าถึง (axe) ทุกหน้า และทดสอบการใช้ด้วยคีย์บอร์ดล้วน
- ตัวกันข้อมูลที่ดูเหมือนของจริงในไฟล์ข้อมูลจำลอง (เช็กตอน build)
- build แบบ "live" (ไม่มีของจำลอง) ผ่าน และตรวจแล้วว่าไม่มีข้อมูลจำลองหลุดเข้าไป

### วิธีลองเปิดดู
ต้องการ Node 22 ขึ้นไป รันในโฟลเดอร์นี้:
1. `npm ci` (ติดตั้งแพ็กเกจตามไฟล์ล็อก)
2. `npm run dev` แล้วเปิดลิงก์ที่ขึ้นในเทอร์มินัล (ปกติ http://localhost:5173)
3. ตรวจครบทั้งชุดก่อน commit: `npm run check` (ใช้เวลานาน เพราะรัน Cypress ทุกไฟล์ และ build ให้เองก่อนรัน Cypress)
4. รันเฉพาะ Cypress: `npm run build` ก่อน แล้วค่อย `npm run e2e` (ทุกไฟล์) หรือ `npm run e2e:smoke` (เฉพาะชุดเร็ว) เหตุผล: สองคำสั่งนี้เปิดโฟลเดอร์ `dist/` ที่ build ไว้แล้วโดยไม่ build ให้ ถ้ายังไม่เคย build test จะล้ม ถ้าแก้โค้ดแล้วไม่ build ใหม่ test จะรันกับโค้ดเก่า

หมายเหตุ: เดโมใช้ Service Worker เพื่อจำลอง API บางโหมดการท่องเว็บส่วนตัว (private browsing) ปิดมันไว้ ถ้าเป็นแบบนั้นหน้าเว็บจะขึ้นข้อความภาษาไทยบอกให้เปิดด้วยโหมดปกติ

### อะไรจำลอง อะไรไม่จำลอง (ตาม spec 7.9 และหน้า `/about`)
จำลองทั้งหมด:
- ไม่มีกุญแจหรือลายเซ็นจริง ค่า SHA-256 และ serial เป็นค่าคงที่ที่ขึ้นต้นให้ดูออกว่าปลอม (เช่น `de00`, `DE:M0`)
- เวลาเป็นนาฬิกาจำลอง (ย่นเวลาได้ถึง 5 ปี) ไม่ใช่เวลาจริงจาก NIMT
- การพิสูจน์ตัวตนแบบพบตัวเป็น checklist ที่ใครก็ติ๊กได้ ไม่มีช่องกรอกเลขบัตร
- ไฟล์ที่ผู้ทดลองอัปโหลดไม่ถูกอ่านและไม่ออกจากเครื่อง
- ปุ่มดาวน์โหลดให้ไฟล์ข้อความอธิบาย (เช่น `DEMO-certificate.txt`) ไม่ใช่ใบรับรองหรือ PDF จริง
- ผู้ทดลองแต่ละคนมีข้อมูลของตัวเองในเบราว์เซอร์ ไม่เห็นของกันและกัน
- deploy, backup, CI และ pentest ของระบบจริง แสดงเป็นข้อความบนหน้าสถานะเท่านั้น

ที่เป็นของจริง: หน้าจอ ลำดับขั้นตอน (state machine) และกติกาตัดสินผลตรวจเป็นโค้ดที่ทำงานจริง แค่ข้อมูลและ crypto เป็นของปลอม

ยกเว้น: hash chain ของ audit log คำนวณ SHA-256 จริงด้วย WebCrypto ในเบราว์เซอร์ (ปุ่ม "ตรวจ hash chain" คำนวณจริงหนึ่งจุด หน้า `/about` ของเดโมบอกไว้แล้ว ดู `src/lib/hashChain.ts`)

### คำถามปลายเปิดของโครงการ (ยังไม่ได้ทำ และไม่ได้เดาค่าแทน ยกเว้นข้อ 7 ที่ผู้ดูแลโครงการอนุมัติค่าชั่วคราวไว้แล้ว)
1. **spec หลักไม่ได้เผยแพร่ใน repo นี้** (เป็นเอกสารภายในของผู้ดูแลโครงการ) และตอนวางแผนเดโมยังไม่มีให้ใช้ เดโมจึงใช้ "สมมติฐาน" 47 ข้อแทน (A1-A47 ใน `docs/adr/0003-assumptions.md`) ผู้ดูแลโครงการต้องเทียบกับ spec หลักเมื่อมี ข้อความที่ไม่ได้ตรวจกับมาตรฐานถูกทำเครื่องหมายไว้แล้ว (เช่น คำว่า "(จำลอง)" ในผลของ `pdfsign`)
2. **วันที่ในข้อมูลจำลองขัดกันเอง (1):** ใบรับรองของวิภาวรรณและอารีย์เริ่มใช้ก่อนวันที่ CA เริ่มทำงาน (1 ต.ค. 2026) ตอนนี้ใช้ค่าตาม spec ไปก่อน ผู้ดูวันที่อย่างละเอียดอาจสังเกตเห็น
3. **วันที่ในข้อมูลจำลองขัดกันเอง (2):** ตราประทับเวลาของเอกสาร D04, D05 และ D07 ลงวันที่ก่อน TSA เริ่มใช้งาน (TSA เริ่ม 1 ต.ค. 2026) ตอนนี้ engine ไม่ตรวจเรื่องนี้โดยตั้งใจ เพื่อให้ผลตรงตารางใน spec ทางแก้ (ย้ายวันเริ่มของ TSA หรือเพิ่ม TSA รุ่นก่อน) ผู้ดูแลโครงการต้องเลือก
4. **ลิงก์ฟอร์มรับความเห็น** (spec ข้อ 9.5): ยังว่างอยู่ หน้า `/about` ขึ้นว่า "ยังไม่เปิดรับความเห็น" เมื่อได้ลิงก์ Google Form ให้ใส่ที่ `FEEDBACK_URL` ใน `src/config/demo.ts` (บรรทัดเดียว) แล้ว build ใหม่
5. **การ deploy:** repo สาธารณะอยู่ที่ https://github.com/korakod-dev/private-ca-pdf-signing-demo และเดโมออนไลน์อยู่ที่ https://pki-demo.korakod.dev (Cloudflare Pages) ไฟล์ CI (`.github/workflows/ci.yml`) รัน lint, typecheck, test, build และ e2e เท่านั้น ไม่มีงาน deploy ใน CI การ deploy ทำผ่าน Cloudflare Pages นอก CI
6. **ตรวจหน้าจอเทียบ mockup** (A20): ผู้พัฒนาเข้าถึงภาพ mockup ไม่ได้ จึงออกแบบหน้าจอจากข้อความใน spec อย่างเดียว ผู้ดูแลโครงการต้องเปิดดูเทียบกับ mockup แล้วระบุว่าตรงไหนต้องแก้
7. **ค่าล็อกอินผิด 3 ครั้ง / 5 นาที** (spec ข้อ 9.8, A5): เป็นค่าชั่วคราวที่ผู้ดูแลโครงการอนุมัติแล้ว (13 พ.ย. 2026) ยังรอเทียบกับ มธอ. 11 เล่ม 3 ข้อ 4.2 ถ้าเอกสารนั้นกำหนดค่าอื่น ต้องแก้ค่าในเดโม

เรื่องเล็กที่ทราบแล้ว:
- ช่องโหว่ระดับกลาง 7 รายการใน `typescript-eslint` (เครื่องมือตรวจโค้ดฝั่งนักพัฒนา ไม่ติดไปกับเว็บที่ผู้ใช้เปิด) แก้แล้วด้วยการบังคับเวอร์ชัน `minimatch` ใน `package.json` (`overrides`) ตอนนี้ `npm audit` ได้ 0 รายการ เมื่อ typescript-eslint ออกรุ่นที่แก้เองแล้ว ให้ลบ `overrides` ออก (ดู A46)

### สัญญาอนุญาต (License)
ใช้สัญญาอนุญาต MIT ดูไฟล์ `LICENSE` (ใครก็นำไปใช้ แก้ไข และแจกจ่ายต่อได้ โดยต้องเก็บข้อความลิขสิทธิ์ไว้)

---

## For developers (English)

Static demo SPA: clickable POC of a private-CA PDF signing system. Everything is simulated; no server, no real keys or signatures. One exception: the audit-log hash chain computes real SHA-256 with WebCrypto in the browser (`src/lib/hashChain.ts`, stated on `/about`).
The demo spec and the project plan are internal documents and are not published in this repo. Stack decisions: `docs/adr/0001-stack.md`, terminal: `docs/adr/0002-terminal-component.md`,
assumptions: `docs/adr/0003-assumptions.md` (A1-A47 plus initial-setup items P0-x).

### Status
Stage 3 (final hardening) done. All 17 spec pages + `NotFoundPage`, engine + resolver, mock API (MSW), `pki-tool` and
`pdfsign` terminals, missions M01-M11 as Cypress specs at 1280 and 390, axe on every route, keyboard spec.
Open items are open project questions only (see the Thai section and ADR 0003).
Public repo: https://github.com/korakod-dev/private-ca-pdf-signing-demo. Live demo: https://pki-demo.korakod.dev.

### Run locally (Node >= 22; run in this folder)
```
npm ci            # install exactly as locked
npm run dev       # Vite dev server (mock API via MSW; no CSP meta in dev)
npm run check     # full gate: lint, typecheck, test:coverage, check:fixtures, check:content, build, e2e
npm run build     # required before e2e: e2e does NOT build, it serves the existing dist/
npm run e2e       # Cypress (all specs) against `vite preview` of the existing dist/, port 4173
```

| Command | What it does |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | `check:fixtures` + `tsc` + `vite build` (adds the CSP meta tag to `dist/index.html`) |
| `VITE_API_MODE=live npm run build` | Build without the mocks (no MSW worker, no fixtures in the bundle) |
| `npm run preview` | Serves `dist/` on port 4173 (what Cypress tests) |
| `npm run lint` / `npm run typecheck` | ESLint / tsc for app, node tooling and cypress |
| `npm test` / `npm run test:coverage` | Vitest / Vitest with coverage thresholds |
| `npm run check:fixtures` | JSON Schema + "looks like real data" detector for `src/fixtures/*.json` |
| `npm run check:content` | Content rules (no clause-level citation without `[verified]`, etc.) |
| `npm run e2e` / `npm run e2e:smoke` | Cypress all specs / smoke only. Does not build: run `npm run build` first (stale or missing `dist/` = stale or failing tests); `npm run check` builds for you |
| `npm run audit` | `npm audit --audit-level=high` |

Cypress specs: `cypress/e2e/smoke` (routes, shell, lifecycle, ops, verify-learn), `cypress/e2e/a11y` (axe on all routes,
keyboard), `cypress/e2e/missions` (M01-M11, each at 1280 and 390). Selectors come from `TID`
(`src/contracts/testids.ts`), paths from `ROUTES`.

### Simulated vs real (spec 7.9)
Simulated: keys, signatures, certificates (constant fake serials/SHA-256, `DE:M0` prefix), the clock (simulated, up to
P5Y advance), in-person identity proofing (admin checklist), TSA/OCSP/CRL, per-browser state (localStorage; users do not
see each other), downloads (text files, never certificate or PDF formats), uploads (never read), deploy/backup/CI/pentest
(text on the status page). Real: the UI, the state machines and the verification rules (`resolveVerification` runs the
7.5 golden table against the real fixtures), and the audit-log hash chain (real SHA-256 via WebCrypto, `src/lib/hashChain.ts`).

### Layout
```
src/contracts/   frozen interfaces: fixtures, api, api-client, engine, runtime, store, terminal, missions, routes, testids
src/fixtures/    *.json data (+ index.ts loader). UI code must not import it (lint rule)
src/engine/      pure simulation engine + verification resolver. No Date.now / Math.random / browser globals (lint rule)
src/mocks/       MSW handlers; demo-only handlers in mocks/demo-only
src/api/         API client (same calls for mock and live)
src/app, src/pages, src/components, src/store, src/terminal, src/content   UI and Thai learner content (markdown)
src/config/demo.ts   FEEDBACK_URL (empty until the maintainer supplies the form link)
cypress/         support commands (cy.visitDemo, cy.tid, cy.a11y, ...) and specs
scripts/         check-fixtures, check-content, preview generation
docs/adr/        stack, terminal component, assumption register
```

### Rules worth knowing
- `src/contracts/**`, `eslint.config.js`, `vitest.config.ts`, `cypress.config.ts`, `package.json` are shared, frozen contracts and config:
  change them deliberately and re-run the full check set, because every page and test depends on them.
- The CSP (`vite.config.ts`) blocks `eval`, so `cy.a11y` loads axe-core from an intercepted same-origin URL instead of
  cypress-axe's `injectAxe`.
- Mock mode needs a Service Worker (MSW); `main.tsx` shows a Thai notice when none can start (some private-browsing modes).
- Live mode (`VITE_API_MODE=live`) never imports `src/mocks`; `vite.config.ts` also deletes `mockServiceWorker.js` from `dist/`.
- `package.json` `overrides` pins `minimatch ^11.0.1` under `@typescript-eslint/typescript-estree` (ADR 0003 A46);
  remove it when typescript-eslint ships a fixed dependency.
- Deploy: the live demo is served from Cloudflare Pages at https://pki-demo.korakod.dev. CI (`.github/workflows/ci.yml`) has no deploy job; deploy happens outside CI.

### License
MIT, see `LICENSE`.
