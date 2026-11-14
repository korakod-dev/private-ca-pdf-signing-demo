// `pdfsign` for the simulated terminal (sub-task G, spec 7.7).
//
//   pdfsign sign <file> --field "<field>" [--certify]
//   pdfsign verify <file>
//
// `sign` flow (spec 7.7): review (document, SHA-256, existing signatures) -> purpose 1-4 (A13) -> type the LAST 4 hex
// characters of the SHA-256 (asked again on a mismatch) -> .p12 password (secret prompt: masked, never echoed) ->
// demoApi.sign -> print the B-T / B-LT / B-LTA lines -> "write" the new file (a record in the simulated state).
//
// Rules enforced here (the engine enforces them too, this is the visible first line of defence):
//   S2  there is NO `--yes`; it and any other unknown flag are rejected. The signer must confirm intent every time.
// Refusals from the engine (S5 existing signatures invalid, encrypted / too large, own cert not active, certify not first,
// TSA drift T9, ...) are printed with their problem code and main-spec ref.
//
// The command only talks to the app through `demoApi`/`api` and the TerminalIO it is given, so it is unit-testable with
// scripted IO and the sign desk "button mode" drives this very same code through a form-backed TerminalIO.
import { api, demoApi } from '../../api';
import type { SignReviewDto } from '../../contracts/api';
import type { ApiError } from '../../contracts/api-client';
import type { SigLevel } from '../../contracts/fixtures';
import { ROUTES } from '../../contracts/routes';
import type { CommandContext, TerminalCommand, TerminalIO } from '../../contracts/terminal';

/** Question texts. Exported so the button-mode form can tell which question is being asked (it answers by label). */
export const PDFSIGN_PROMPTS = {
  purpose: 'วัตถุประสงค์ของการเซ็น (1 อนุมัติ, 2 รับทราบ, 3 ผู้จัดทำ, 4 พยาน):',
  sha: 'พิมพ์อักขระ 4 ตัวสุดท้ายของ SHA-256 เพื่อยืนยัน:',
  p12: 'รหัสผ่านไฟล์ .p12:',
} as const;

/** How many times a question is asked again before the command gives up (keeps a scripted IO from looping forever). */
export const MAX_ATTEMPTS = 5;
/** The .p12 password may be retried a few times (the server checks it). */
export const MAX_P12_ATTEMPTS = 3;
/** Verify poll: up to POLL_LIMIT reads, POLL_MS apart (the UI polls jobs every 500 ms, A2). */
export const POLL_MS = 500;
export const POLL_LIMIT = 120;

const USAGE = [
  'การใช้งาน:',
  '  pdfsign sign <ไฟล์> --field "<ช่อง>" [--certify]',
  '  pdfsign verify <ไฟล์>',
  'ตัวอย่าง: pdfsign sign ~/Documents/memo-130-unsigned.pdf --field "approver-1" --certify',
  'ดูรายชื่อไฟล์ด้วย: ls ~/Documents',
];

// Wording of the simulated steps (F32): these are the demo's own plain-language labels, NOT a restatement of the
// PAdES standard (not checked against ETSI EN 319 142-1). Every line is prefixed with "(จำลอง)" for that reason, and
// desk.md ("ระดับลายเซ็น") says the same.
const LEVEL_TH: Record<SigLevel, string> = {
  'B-B': '(จำลอง) ลายเซ็นพื้นฐาน',
  'B-T': '(จำลอง) ตราประทับเวลาของลายเซ็น',
  'B-LT': '(จำลอง) ฝังข้อมูลตรวจสถานะใบรับรอง (OCSP/CRL) ไว้ในไฟล์',
  'B-LTA': '(จำลอง) ตราประทับเวลาของเอกสาร สำหรับเก็บระยะยาว',
};

export interface PdfsignDeps {
  /** Waits between verify polls. Tests inject an immediate one. */
  sleep: (ms: number) => Promise<void>;
}

const defaultDeps: PdfsignDeps = { sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)) };

/** Prints a refusal / problem with its code and main-spec ref (when the engine sent one). */
function printProblem(io: TerminalIO, error: ApiError): void {
  const ref = error.problem?.ref;
  io.print(`✗ ปฏิเสธ [${error.code}] ${error.detail ?? error.title}${ref ? ` (อ้างอิง ${ref})` : ''}`, 'err');
  if (error.retry_after_s !== undefined) io.print(`  ลองใหม่ได้ใน ${error.retry_after_s} วินาที`, 'err');
}

/** Finds a file of the simulated `~/Documents` by its path (a bare file name is taken as being in ~/Documents). */
async function findDocument(io: TerminalIO, file: string) {
  const ws = await demoApi.workstation();
  if (!ws.ok) {
    // Prefixed like the other command-level errors ("pdfsign: ..."): this is the first call, e.g. nobody is signed in.
    io.print('pdfsign: อ่านรายการไฟล์ในเครื่องจำลองไม่ได้', 'err');
    printProblem(io, ws.error);
    return null;
  }
  const wanted = file.startsWith('~/') || file.startsWith('/') ? file : `~/Documents/${file.replace(/^\.\//, '')}`;
  const doc = ws.data.documents.find((d) => d.path === wanted);
  if (!doc) {
    io.print(`pdfsign: ไม่พบไฟล์ '${file}' (ในเครื่องจำลองมีไฟล์ใน ~/Documents เท่านั้น ลอง: ls ~/Documents)`, 'err');
    return null;
  }
  return doc;
}

function printReview(io: TerminalIO, review: SignReviewDto): void {
  io.print('--- ทบทวนก่อนเซ็น ---', 'info');
  io.print(`เอกสาร:   ${review.file_name} (${review.pages} หน้า)`);
  io.print(`SHA-256:  ${review.sha256}`);
  io.print(`ช่องลายเซ็น: ${review.field}   ประเภท: ${review.certify ? 'certification (ลายเซ็นแรกของเอกสาร)' : 'approval'}`);
  if (review.existing_signatures.length === 0) {
    io.print('ลายเซ็นเดิม: ไม่มี');
  } else {
    io.print('ลายเซ็นเดิมในเอกสาร:');
    for (const s of review.existing_signatures) io.print(`  - ${s.field}: ${s.signer_subject} (${s.indication})`);
  }
}

async function runSign(ctx: CommandContext): Promise<number> {
  const { io, args } = ctx;
  const file = args.positional[1];
  const field = args.flags.field;
  if (file === undefined) {
    io.print('pdfsign sign: ต้องระบุไฟล์ เช่น pdfsign sign ~/Documents/memo-130-unsigned.pdf --field "approver-1"', 'err');
    return 2;
  }
  if (typeof field !== 'string' || field.trim() === '') {
    io.print('pdfsign sign: ต้องระบุ --field "<ช่องลายเซ็น>" เช่น --field "approver-1"', 'err');
    return 2;
  }
  const certify = args.flags.certify === true;

  const doc = await findDocument(io, file);
  if (!doc) return 1;

  // 1. Review.
  const reviewResult = await demoApi.signReview({ document_id: doc.document_id, field, certify });
  if (!reviewResult.ok) {
    printProblem(io, reviewResult.error);
    return 1;
  }
  const review = reviewResult.data;
  printReview(io, review);

  // 2. Purpose 1-4 (A13).
  let purpose: 1 | 2 | 3 | 4 | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && purpose === null; attempt++) {
    const answer = (await io.prompt(PDFSIGN_PROMPTS.purpose)).trim();
    if (answer === '1' || answer === '2' || answer === '3' || answer === '4') purpose = Number(answer) as 1 | 2 | 3 | 4;
    else io.print('เลือกได้เฉพาะ 1, 2, 3 หรือ 4', 'err');
  }
  if (purpose === null) {
    io.print('ยกเลิก: เลือกวัตถุประสงค์ไม่ถูกต้องหลายครั้ง', 'err');
    return 1;
  }

  // 3. The last 4 hex characters of the SHA-256: proves the signer looked at the document being signed (S2).
  const expectedSuffix = review.sha256.slice(-4).toLowerCase();
  let suffix: string | null = null;
  for (let attempt = 0; attempt < MAX_ATTEMPTS && suffix === null; attempt++) {
    const answer = (await io.prompt(PDFSIGN_PROMPTS.sha)).trim().toLowerCase();
    if (answer === expectedSuffix) suffix = answer;
    else io.print('4 ตัวท้ายไม่ตรงกับ SHA-256 ของเอกสาร ตรวจจากบรรทัด SHA-256 ด้านบนแล้วพิมพ์ใหม่', 'err');
  }
  if (suffix === null) {
    io.print('ยกเลิก: ยืนยัน SHA-256 ไม่ผ่านหลายครั้ง', 'err');
    return 1;
  }

  // 4. .p12 password (secret) and the signing call. A wrong password is asked again a few times.
  for (let attempt = 0; attempt < MAX_P12_ATTEMPTS; attempt++) {
    const password = await io.prompt(PDFSIGN_PROMPTS.p12, { secret: true });
    const result = await demoApi.sign({
      document_id: doc.document_id,
      field,
      certify,
      purpose,
      sha256_suffix: suffix,
      p12_password: password,
    });
    if (result.ok) {
      io.print('เซ็นสำเร็จ (จำลอง) ระดับลายเซ็นที่ได้:', 'ok');
      for (const level of result.data.levels) io.print(`  ${level.padEnd(5)} ${LEVEL_TH[level]}`, 'ok');
      io.print(`✓ เขียนไฟล์ ~/Documents/${result.data.file_name} แล้ว (เป็นรายการในระบบจำลอง ไม่ใช่ PDF จริง)`, 'ok');
      io.print(`ตรวจผลต่อด้วย: pdfsign verify ~/Documents/${result.data.file_name}`, 'info');
      return 0;
    }
    printProblem(io, result.error);
    if (result.error.code !== 'P12_PASSWORD_INVALID') return 1;
  }
  io.print('ยกเลิก: ใส่รหัสผ่าน .p12 ผิดหลายครั้ง', 'err');
  return 1;
}

async function runVerify(ctx: CommandContext, deps: PdfsignDeps): Promise<number> {
  const { io, args } = ctx;
  const file = args.positional[1];
  if (file === undefined) {
    io.print('pdfsign verify: ต้องระบุไฟล์ เช่น pdfsign verify ~/Documents/memo-130-s2.signed.pdf', 'err');
    return 2;
  }
  const doc = await findDocument(io, file);
  if (!doc) return 1;

  const created = await api.verify.create({ fixture_id: doc.document_id });
  if (!created.ok) {
    printProblem(io, created.error);
    return 1;
  }
  const jobId = created.data.job_id;
  io.print(`ส่งตรวจแล้ว (${jobId}) กำลังรอผล…`, 'info');

  for (let i = 0; i < POLL_LIMIT; i++) {
    const job = await api.verify.get(jobId);
    if (!job.ok) {
      printProblem(io, job.error);
      return 1;
    }
    if (job.data.status === 'error') {
      io.print(`✗ งานตรวจผิดพลาด [${job.data.error?.code ?? 'ERROR'}] ${job.data.error?.detail ?? job.data.error?.title ?? ''}`.trimEnd(), 'err');
      return 1;
    }
    const report = job.data.result;
    if (job.data.status === 'done' && report) {
      const sub = report.sub_indication ? ` / ${report.sub_indication}` : '';
      io.print(`ผลตรวจ: ${report.indication}${sub} (${report.code})`, report.indication === 'TOTAL-PASSED' ? 'ok' : report.indication === 'TOTAL-FAILED' ? 'err' : 'info');
      for (const s of report.signatures) io.print(`  ${s.field}: ${s.indication} ${s.code} (${s.signer.subject})`);
      for (const w of report.warnings) io.print(`  คำเตือน: ${w}`, 'info');
      io.link(`เปิดผลตรวจเต็ม (${jobId})`, ROUTES.verifyResult(jobId));
      return report.indication === 'TOTAL-PASSED' ? 0 : 1;
    }
    await deps.sleep(POLL_MS);
  }
  io.print('หมดเวลารอผลตรวจ ลองเปิดผลจากหน้าตรวจเอกสารอีกครั้ง', 'err');
  return 1;
}

/** Builds the command. `deps` is for tests; the app uses the default `pdfsign`. */
export function createPdfsign(deps: PdfsignDeps = defaultDeps): TerminalCommand {
  return {
    name: 'pdfsign',
    summary: 'เซ็นและตรวจ PDF (sign, verify)',
    async run(ctx) {
      const { io, args } = ctx;
      const sub = args.positional[0];

      // S2: no `--yes`, and no other flag that could skip a confirmation step.
      if (args.flags.yes !== undefined) {
        io.print('pdfsign: ไม่รองรับ --yes (S2) ผู้เซ็นต้องยืนยันเจตนาด้วยตัวเองทุกครั้ง ลองสั่งใหม่โดยไม่ใส่ --yes', 'err');
        return 2;
      }
      const allowed = sub === 'sign' ? ['field', 'certify', 'help'] : ['help'];
      const unknown = Object.keys(args.flags).find((f) => !allowed.includes(f));
      if (unknown !== undefined) {
        io.print(`pdfsign: ไม่รู้จัก flag --${unknown} (ไม่มีทางลัดข้ามขั้นยืนยัน ตาม S2)`, 'err');
        return 2;
      }

      if (sub === undefined || sub === 'help' || args.flags.help !== undefined) {
        for (const line of USAGE) io.print(line, 'info');
        return sub === undefined ? 2 : 0;
      }
      if (sub === 'sign') return runSign(ctx);
      if (sub === 'verify') return runVerify(ctx, deps);
      io.print(`pdfsign: ไม่รู้จักคำสั่งย่อย '${sub}'`, 'err');
      for (const line of USAGE) io.print(line, 'info');
      return 2;
    },
  };
}

/** The registered command (src/terminal/registry.ts imports this name). */
export const pdfsign: TerminalCommand = createPdfsign();
/** Alias used by the sign desk button mode. */
export const pdfsignCommand = pdfsign;
