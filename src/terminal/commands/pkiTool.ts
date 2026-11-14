// pki-tool (sub-task F). Spec 7.7:
//   pki-tool init --name "<name>" --email <email>   asks for a passphrase (>= 12 chars), creates a simulated key + CSR
//   pki-tool finalize --cert <file>                 certificate Issued -> Active
//   pki-tool renew [--cert <serial|file>]           asks a passphrase (>= 12 chars) for the NEW key, then renewal request (L4, QA F27)
//
// Rules enforced here:
//   - the passphrase is read as a SECRET prompt, checked locally and NEVER sent anywhere (assumption A26): the only API
//     call of `init` is demoApi.keygen({ name, email });
//   - unknown flags are errors (no hidden bypass flags);
//   - user errors are printed through `io`, the command never throws for them.
//
// The command also publishes the CSR it just created (module-level store below) so /certs/request can submit it:
// the CSR PEM is not part of any "list" API, and a terminal command cannot return data to the page otherwise.
// renewCertificate / finalizeCertificate are exported so the buttons on /certs run the very same code as the commands.
import { api, demoApi } from '../../api';
import type { CertRequestDto, CertDto } from '../../contracts/api';
import type { ApiError, ApiResult } from '../../contracts/api-client';
import type { CsrModel, PersonaId } from '../../contracts/fixtures';
import type { UserSummary } from '../../contracts/store';
import type { CommandContext, TerminalCommand, TerminalIO } from '../../contracts/terminal';

/** Minimum passphrase length in characters (spec 7.7). */
export const MIN_PASSPHRASE_LENGTH = 12;
/** How many times the passphrase question is repeated before the command gives up. */
export const MAX_PASSPHRASE_ATTEMPTS = 5;

// ---------- latest CSR (shared with the /certs/request page) ----------
export interface CreatedCsr {
  persona: PersonaId;
  name: string;
  email: string;
  csr_pem: string;
  csr: CsrModel;
}

let latestCsr: CreatedCsr | null = null;
const listeners = new Set<() => void>();

/** Snapshot for useSyncExternalStore: the same object until the CSR changes. */
export function getLatestCsr(): CreatedCsr | null {
  return latestCsr;
}

export function subscribeLatestCsr(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Sets (or clears, with null) the latest CSR and notifies subscribers. */
export function setLatestCsr(csr: CreatedCsr | null): void {
  latestCsr = csr;
  for (const l of [...listeners]) l();
}

// ---------- API steps shared by the commands and the page buttons ----------
const errText = (e: ApiError): string => e.detail ?? e.title;

/** Serial of a certificate file name: "~/.private-ca/DE-M0-A0-00-00-01.crt" -> "DE:M0:A0:00:00:01". */
export function serialFromCertFile(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1).replace(/\.crt$/i, '');
  return base.replace(/-/g, ':');
}

/**
 * Renewal (L4): generate a NEW key + CSR for the signed-in persona, then ask for the renewal.
 * The caller has already asked the key passphrase (terminal: askPassphrase, /certs: PassphraseDialog); it is not an argument
 * here on purpose, so it cannot reach the API or any state (assumption A26, A42).
 */
export async function renewCertificate(serial: string, user: UserSummary): Promise<ApiResult<CertRequestDto>> {
  const key = await demoApi.keygen({ name: user.display_name, email: user.email });
  if (!key.ok) return key;
  return api.certs.renew(serial, { csr_pem: key.data.csr_pem });
}

/** Issued -> Active. */
export function finalizeCertificate(serial: string): Promise<ApiResult<CertDto>> {
  return api.certs.finalize(serial);
}

// ---------- the command ----------
const USAGE = [
  'วิธีใช้:',
  '  pki-tool init --name "<ชื่อ>" --email <อีเมล>   สร้างกุญแจและคำขอใบรับรอง (CSR)',
  '  pki-tool finalize --cert <ไฟล์>                  ยืนยันติดตั้งใบรับรองที่ออกแล้ว',
  '  pki-tool renew [--cert <serial หรือไฟล์>]        ขอต่ออายุ (สร้างกุญแจใหม่)',
];
const KNOWN_FLAGS: Record<string, readonly string[]> = {
  init: ['name', 'email', 'help'],
  finalize: ['cert', 'help'],
  renew: ['cert', 'help'],
};

function printUsage(io: TerminalIO): void {
  for (const line of USAGE) io.print(line, 'info');
}

/** Reads a flag that must carry a text value (`--name` alone parses as `true`). */
function textFlag(flags: CommandContext['args']['flags'], name: string): string | null {
  const v = flags[name];
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** True when a typed passphrase meets the minimum length (counted in characters, not UTF-16 units). */
export function isPassphraseLongEnough(answer: string): boolean {
  return Array.from(answer).length >= MIN_PASSPHRASE_LENGTH;
}

/** Asks for the passphrase until it is long enough. The answer is only measured, never stored or printed. */
async function askPassphrase(io: TerminalIO): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_PASSPHRASE_ATTEMPTS; attempt++) {
    const answer = await io.prompt(`ตั้งรหัสผ่านปกป้องกุญแจส่วนตัว (อย่างน้อย ${MIN_PASSPHRASE_LENGTH} ตัวอักษร):`, { secret: true });
    const length = Array.from(answer).length;
    if (isPassphraseLongEnough(answer)) return true;
    io.print(`รหัสผ่านสั้นเกินไป (${length} ตัวอักษร) ต้องมีอย่างน้อย ${MIN_PASSPHRASE_LENGTH} ตัวอักษร ลองใหม่`, 'err');
  }
  io.print(`ใส่รหัสผ่านสั้นเกินไปครบ ${MAX_PASSPHRASE_ATTEMPTS} ครั้ง ยกเลิกการสร้างกุญแจ`, 'err');
  return false;
}

async function runInit({ io, args, user }: CommandContext): Promise<number> {
  if (!user) {
    io.print('ต้องเลือกบทบาทก่อน (สลับบทบาทที่แถบสาธิต หรือเข้าสู่ระบบ)', 'err');
    return 1;
  }
  const name = textFlag(args.flags, 'name');
  const email = textFlag(args.flags, 'email');
  if (!name || !email) {
    io.print('pki-tool init: ต้องระบุทั้ง --name และ --email', 'err');
    printUsage(io);
    return 2;
  }

  if (!(await askPassphrase(io))) return 1;

  // Only name and email leave the "machine". The passphrase went out of scope above.
  const key = await demoApi.keygen({ name, email });
  if (!key.ok) {
    io.print(`pki-tool init: ${errText(key.error)}`, 'err');
    return 1;
  }

  const { csr_pem, csr } = key.data;
  setLatestCsr({ persona: user.id, name, email, csr_pem, csr });
  io.print('สร้างกุญแจส่วนตัวแล้ว เก็บไว้ในเครื่องนี้เท่านั้น (จำลอง กุญแจจริงไม่มี)', 'ok');
  const files = await demoApi.workstation();
  if (files.ok) {
    // The newest key pair (key + CSR) is the last two non-certificate files.
    for (const f of files.data.private_ca.filter((x) => x.kind !== 'certificate').slice(-2)) io.print(`  ${f.path}`);
  }
  io.print('คำขอใบรับรอง (CSR) ที่จะส่งให้ผู้ดูแล:', 'info');
  io.print(csr_pem);
  io.print(`ชื่อ: ${csr.subject_cn} · อีเมล: ${csr.email} · กุญแจ: ${csr.key_alg} ${csr.key_size} บิต`);
  io.print('ขั้นต่อไป: เลือกช่วงนัดหมายพบตัวและกด "ส่งคำขอ" ที่หน้านี้', 'info');
  return 0;
}

async function runFinalize({ io, args }: CommandContext): Promise<number> {
  const files = await demoApi.workstation();
  if (!files.ok) {
    io.print(`pki-tool finalize: ${errText(files.error)}`, 'err');
    return 1;
  }
  const certFiles = files.data.private_ca.filter((f) => f.kind === 'certificate').map((f) => f.path);
  const file = textFlag(args.flags, 'cert');
  if (!file) {
    io.print('pki-tool finalize: ต้องระบุ --cert <ไฟล์>', 'err');
    io.print(certFiles.length > 0 ? `ไฟล์ใบรับรองในเครื่อง: ${certFiles.join(', ')}` : 'ยังไม่มีไฟล์ใบรับรองในเครื่อง (รอผู้ดูแลอนุมัติก่อน)', 'info');
    return 2;
  }
  // Accept "~/.private-ca/<name>.crt" and a bare "<name>.crt".
  const match = certFiles.find((p) => p === file || p.slice(p.lastIndexOf('/') + 1) === file);
  if (!match) {
    io.print(`pki-tool finalize: ${file}: No such file (demo)`, 'err');
    if (certFiles.length > 0) io.print(`ไฟล์ใบรับรองในเครื่อง: ${certFiles.join(', ')}`, 'info');
    return 1;
  }
  const result = await finalizeCertificate(serialFromCertFile(match));
  if (!result.ok) {
    io.print(`pki-tool finalize: ${errText(result.error)}`, 'err');
    return 1;
  }
  io.print(`ยืนยันติดตั้งแล้ว ใบรับรอง ${result.data.serial} สถานะ: ${result.data.state}`, 'ok');
  return 0;
}

async function runRenew({ io, args, user }: CommandContext): Promise<number> {
  if (!user) {
    io.print('ต้องเลือกบทบาทก่อน (สลับบทบาทที่แถบสาธิต หรือเข้าสู่ระบบ)', 'err');
    return 1;
  }
  const certs = await api.certs.list();
  if (!certs.ok) {
    io.print(`pki-tool renew: ${errText(certs.error)}`, 'err');
    return 1;
  }
  const wanted = textFlag(args.flags, 'cert');
  // --cert takes a certificate file name (…/DE-M0-A0-00-00-01.crt) or the serial itself (DE:M0:A0:00:00:01).
  const serial = wanted ? (/\.crt$/i.test(wanted) ? serialFromCertFile(wanted) : wanted) : null;
  const target = certs.data.find((c) => (serial ? c.serial === serial : c.state === 'Active'));
  if (!target || target.state !== 'Active') {
    io.print('pki-tool renew: ไม่พบใบรับรองที่ใช้งานอยู่ (Active) ให้ต่ออายุ', 'err');
    return 1;
  }
  // Renewal creates a NEW key, so it needs a passphrase like `init` (spec 7.7, policy/user-agreement). Only measured, never stored or sent.
  if (!(await askPassphrase(io))) return 1;
  const result = await renewCertificate(target.serial, user);
  if (!result.ok) {
    io.print(`pki-tool renew: ${errText(result.error)}`, 'err');
    return 1;
  }
  io.print(`สร้างกุญแจใหม่และส่งคำขอต่ออายุแล้ว (คำขอ ${result.data.id})`, 'ok');
  if (result.data.state === 'approved') {
    io.print('พบตัวล่าสุดไม่เกิน 3 ปี จึงไม่ต้องพบตัวอีก ใบใหม่ออกแล้ว ใช้ pki-tool finalize --cert <ไฟล์> เพื่อยืนยันติดตั้ง', 'info');
  } else {
    io.print('ต้องพบตัวกับผู้ดูแลก่อนจึงจะออกใบใหม่', 'info');
  }
  return 0;
}

export const pkiTool: TerminalCommand = {
  name: 'pki-tool',
  summary: 'ขอ/ยืนยัน/ต่ออายุใบรับรอง (init, finalize, renew)',
  async run(ctx) {
    const { io, args } = ctx;
    const sub = args.positional[0];
    if (args.flags.help === true) {
      printUsage(io);
      return 0;
    }
    if (sub === undefined) {
      printUsage(io);
      return 2;
    }
    const allowed = KNOWN_FLAGS[sub];
    if (!allowed) {
      io.print(`pki-tool: คำสั่งย่อย "${sub}" ไม่มี`, 'err');
      printUsage(io);
      return 2;
    }
    const unknown = Object.keys(args.flags).filter((f) => !allowed.includes(f));
    if (unknown.length > 0) {
      io.print(`pki-tool ${sub}: ไม่รู้จักตัวเลือก ${unknown.map((f) => `--${f}`).join(', ')}`, 'err');
      printUsage(io);
      return 2;
    }
    if (args.positional.length > 1) {
      io.print(`pki-tool ${sub}: มีคำเกินมา "${args.positional.slice(1).join(' ')}"`, 'err');
      printUsage(io);
      return 2;
    }
    if (sub === 'init') return runInit(ctx);
    if (sub === 'finalize') return runFinalize(ctx);
    return runRenew(ctx);
  },
};
