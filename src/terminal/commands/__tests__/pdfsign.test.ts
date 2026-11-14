// pdfsign (sub-task G): scripted fake IO, API mocked with vi.mock. Covers S2 (--yes rejected), SHA-4 re-ask,
// every refusal rendered with code + ref, the secret p12 prompt, and `verify` (poll + link).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiError } from '../../../contracts/api-client';
import type { SignReviewDto } from '../../../contracts/api';
import type { TerminalIO, TerminalLineKind } from '../../../contracts/terminal';
import { fail as plainFail, ok } from '../../../store/__tests__/fakes';

const mocks = vi.hoisted(() => ({
  workstation: vi.fn(),
  signReview: vi.fn(),
  sign: vi.fn(),
  verifyCreate: vi.fn(),
  verifyGet: vi.fn(),
}));
vi.mock('../../../api', () => ({
  configureApi: vi.fn(),
  api: { verify: { create: mocks.verifyCreate, get: mocks.verifyGet } },
  demoApi: { workstation: mocks.workstation, signReview: mocks.signReview, sign: mocks.sign },
}));

import { runLine } from '../../core/dispatch';
import { PDFSIGN_PROMPTS, createPdfsign, pdfsign } from '../pdfsign';

const SHA = `de00${'0'.repeat(55)}a1b2`; // ends with a1b2
const WS = {
  documents: [
    { path: '~/Documents/memo-130-unsigned.pdf', document_id: 'D12', sha256: SHA },
    { path: '~/Documents/memo-130-s1.signed.pdf', document_id: 'D12-s1', sha256: `de00${'1'.repeat(60)}` },
  ],
  private_ca: [],
};
const REVIEW: SignReviewDto = {
  document_id: 'D12',
  file_name: 'memo-130-unsigned.pdf',
  sha256: SHA,
  pages: 2,
  field: 'approver-1',
  certify: true,
  existing_signatures: [],
};

/** A problem result like the real client returns (code, detail and the main-spec ref). */
function problem(status: number, code: string, detail: string, ref?: string) {
  const error: ApiError = {
    status,
    code,
    title: detail,
    detail,
    problem: { type: `/problems/${code}`, title: detail, status, detail, code, ...(ref ? { ref } : {}) },
  };
  return { ok: false as const, error };
}

/** Scripted IO: answers prompts from a queue and records everything. */
function fakeIo(answers: string[]) {
  const out: { text: string; kind: TerminalLineKind }[] = [];
  const asked: { label: string; secret: boolean }[] = [];
  const io: TerminalIO = {
    print: (text, kind = 'out') => void out.push({ text, kind }),
    prompt: async (label, opts) => {
      asked.push({ label, secret: opts?.secret === true });
      return answers.shift() ?? '';
    },
    clear: () => undefined,
    link: (label, to) => void out.push({ text: `${label} -> ${to}`, kind: 'info' }),
  };
  return { io, out, asked, text: () => out.map((o) => o.text).join('\n') };
}

const run = (line: string, f: ReturnType<typeof fakeIo>) => runLine(line, { io: f.io, user: null, commands: [pdfsign] });

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.workstation.mockResolvedValue(ok(WS));
  mocks.signReview.mockResolvedValue(ok(REVIEW));
  mocks.sign.mockResolvedValue(ok({ document_id: 'D12-s1', file_name: 'memo-130-s1.signed.pdf', levels: ['B-T', 'B-LT', 'B-LTA'] }, 201));
});

describe('pdfsign sign: rule S2', () => {
  it('rejects --yes, cites S2 and calls no API', async () => {
    const f = fakeIo([]);
    const code = await run('pdfsign sign ~/Documents/memo-130-unsigned.pdf --field "approver-1" --certify --yes', f);
    expect(code).toBe(2);
    expect(f.text()).toContain('--yes');
    expect(f.text()).toContain('S2');
    expect(mocks.workstation).not.toHaveBeenCalled();
    expect(mocks.signReview).not.toHaveBeenCalled();
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  it('rejects any unknown flag with the same reason', async () => {
    const f = fakeIo([]);
    expect(await run('pdfsign sign x.pdf --field a --force', f)).toBe(2);
    expect(f.text()).toContain('--force');
    expect(f.text()).toContain('S2');
    expect(mocks.signReview).not.toHaveBeenCalled();
  });

  it('needs --field and a file', async () => {
    const f = fakeIo([]);
    expect(await run('pdfsign sign ~/Documents/memo-130-unsigned.pdf', f)).toBe(2);
    expect(await run('pdfsign sign --field a', f)).toBe(2);
    expect(mocks.signReview).not.toHaveBeenCalled();
  });
});

describe('pdfsign sign: happy path', () => {
  it('review, purpose, SHA-4 (re-asked on a mismatch), secret p12, then B-T/B-LT/B-LTA and the new file', async () => {
    const f = fakeIo(['9', '2', 'ffff', 'A1B2', 'demo-p12-password']);
    const code = await run('pdfsign sign ~/Documents/memo-130-unsigned.pdf --field "approver-1" --certify', f);
    expect(code).toBe(0);

    // Review printed with the full SHA-256.
    expect(f.text()).toContain(SHA);
    expect(mocks.signReview).toHaveBeenCalledWith({ document_id: 'D12', field: 'approver-1', certify: true });

    // Questions in order; invalid purpose and wrong SHA-4 were asked again; only the p12 one is secret.
    expect(f.asked.map((a) => a.label)).toEqual([
      PDFSIGN_PROMPTS.purpose,
      PDFSIGN_PROMPTS.purpose,
      PDFSIGN_PROMPTS.sha,
      PDFSIGN_PROMPTS.sha,
      PDFSIGN_PROMPTS.p12,
    ]);
    expect(f.asked.filter((a) => a.secret).map((a) => a.label)).toEqual([PDFSIGN_PROMPTS.p12]);
    expect(f.out.filter((o) => o.kind === 'err').map((o) => o.text).join('\n')).toContain('เลือกได้เฉพาะ');
    expect(f.text()).toContain('4 ตัวท้ายไม่ตรง');

    // A wrong SHA-4 never reaches the server; the right one is sent in lower case with the chosen purpose.
    expect(mocks.sign).toHaveBeenCalledTimes(1);
    expect(mocks.sign).toHaveBeenCalledWith({
      document_id: 'D12',
      field: 'approver-1',
      certify: true,
      purpose: 2,
      sha256_suffix: 'a1b2',
      p12_password: 'demo-p12-password',
    });

    for (const level of ['B-T', 'B-LT', 'B-LTA']) expect(f.text()).toContain(level);
    expect(f.text()).toContain('memo-130-s1.signed.pdf');
    // The password is never echoed.
    expect(f.text()).not.toContain('demo-p12-password');
  });

  it('accepts a bare file name as a file in ~/Documents and omits certify when the flag is absent', async () => {
    const f = fakeIo(['1', 'a1b2', 'pw']);
    await run('pdfsign sign memo-130-unsigned.pdf --field "approver-2"', f);
    expect(mocks.signReview).toHaveBeenCalledWith({ document_id: 'D12', field: 'approver-2', certify: false });
  });

  it('says so when the file does not exist in the simulated ~/Documents', async () => {
    const f = fakeIo([]);
    expect(await run('pdfsign sign ~/Desktop/real.pdf --field a', f)).toBe(1);
    expect(f.text()).toContain('ไม่พบไฟล์');
    expect(mocks.signReview).not.toHaveBeenCalled();
  });

  it('gives up after repeated wrong SHA-4 answers', async () => {
    const f = fakeIo(['1', 'x1', 'x2', 'x3', 'x4', 'x5']);
    expect(await run('pdfsign sign memo-130-unsigned.pdf --field a', f)).toBe(1);
    expect(mocks.sign).not.toHaveBeenCalled();
    expect(f.text()).toContain('ยกเลิก');
  });

  it('asks for the .p12 password again after P12_PASSWORD_INVALID, then gives up after 3 tries', async () => {
    mocks.sign.mockResolvedValue(problem(400, 'P12_PASSWORD_INVALID', 'รหัสผ่านไฟล์ .p12 ไม่ถูกต้อง'));
    const f = fakeIo(['1', 'a1b2', 'p1', 'p2', 'p3']);
    expect(await run('pdfsign sign memo-130-unsigned.pdf --field a', f)).toBe(1);
    expect(mocks.sign).toHaveBeenCalledTimes(3);
    expect(f.asked.filter((a) => a.label === PDFSIGN_PROMPTS.p12 && a.secret)).toHaveLength(3);
    expect(f.text()).toContain('P12_PASSWORD_INVALID');
  });
});

describe('pdfsign sign: every refusal is rendered with its code and ref', () => {
  // Refusals that stop the review step (nothing is asked) ...
  const atReview: [string, number, string, string | undefined][] = [
    ['EXISTING_SIGNATURE_INVALID', 422, 'ลายเซ็นเดิมในเอกสารยังไม่ผ่านการตรวจ จึงเซ็นต่อไม่ได้', 'S5'],
    ['ENCRYPTED_PDF', 422, 'ระบบไม่รับ PDF ที่เข้ารหัส', 'V10'],
    ['PDF_TOO_LARGE', 413, 'เอกสารเกิน 200 หน้า หรือเกิน 20 MB', 'V10'],
    ['CERT_NOT_ACTIVE', 403, 'คุณไม่มีใบรับรองที่ใช้งานได้ (Active) จึงเซ็นไม่ได้', undefined],
    ['CERTIFY_NOT_FIRST', 409, 'ลายเซ็นแบบ certification ทำได้เฉพาะลายเซ็นแรกของเอกสาร', undefined],
    ['INVALID_STATE', 409, 'ช่องลายเซ็น "approver-1" มีลายเซ็นอยู่แล้ว', undefined],
    ['UNAUTHENTICATED', 401, 'ต้องเข้าสู่ระบบก่อน', undefined],
  ];
  it.each(atReview)('%s at review', async (code, status, detail, ref) => {
    mocks.signReview.mockResolvedValue(problem(status, code, detail, ref));
    const f = fakeIo([]);
    expect(await run('pdfsign sign memo-130-unsigned.pdf --field approver-1', f)).toBe(1);
    expect(f.text()).toContain(`[${code}]`);
    expect(f.text()).toContain(detail);
    if (ref) expect(f.text()).toContain(`อ้างอิง ${ref}`);
    expect(f.asked).toHaveLength(0);
    expect(mocks.sign).not.toHaveBeenCalled();
  });

  // ... and refusals of the commit step (TSA stops stamping; server-side SHA/p12 checks).
  const atCommit: [string, number, string, string | undefined][] = [
    ['TSA_DRIFT', 503, 'TSA หยุดออกตราประทับเวลา เพราะเวลาเพี้ยนเกินกำหนด', 'T9'],
    ['TSA_UNAVAILABLE', 503, 'ไม่มี TSA ที่ใช้งานได้ ณ เวลานี้', undefined],
    ['SHA_SUFFIX_MISMATCH', 400, 'อักขระ 4 ตัวท้ายของ SHA-256 ไม่ตรงกับเอกสาร', 'S2'],
  ];
  it.each(atCommit)('%s at commit', async (code, status, detail, ref) => {
    mocks.sign.mockResolvedValue(problem(status, code, detail, ref));
    const f = fakeIo(['1', 'a1b2', 'demo-p12-password']);
    expect(await run('pdfsign sign memo-130-unsigned.pdf --field approver-1', f)).toBe(1);
    expect(f.text()).toContain(`[${code}]`);
    expect(f.text()).toContain(detail);
    if (ref) expect(f.text()).toContain(`อ้างอิง ${ref}`);
    expect(f.text()).not.toContain('เซ็นสำเร็จ');
  });
});

describe('pdfsign verify', () => {
  const report = (indication: string, code: string) => ({
    job_id: 'job-0007',
    status: 'done',
    created_at: 'x',
    error: null,
    result: {
      indication,
      sub_indication: null,
      code,
      signatures: [{ field: 'approver-1', indication, code, signer: { subject: 'CN=สมชาย ใจดี' } }],
      warnings: [],
    },
  });

  it('creates a job, polls until done, prints the short result and links to /verify/:jobId', async () => {
    mocks.verifyCreate.mockResolvedValue(ok({ job_id: 'job-0007', status: 'queued' }, 202));
    mocks.verifyGet
      .mockResolvedValueOnce(ok({ job_id: 'job-0007', status: 'running', created_at: 'x', result: null, error: null }))
      .mockResolvedValueOnce(ok(report('TOTAL-PASSED', 'VALID')));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const cmd = createPdfsign({ sleep });
    const f = fakeIo([]);
    const code = await runLine('pdfsign verify ~/Documents/memo-130-s1.signed.pdf', { io: f.io, user: null, commands: [cmd] });
    expect(code).toBe(0);
    expect(mocks.verifyCreate).toHaveBeenCalledWith({ fixture_id: 'D12-s1' });
    expect(mocks.verifyGet).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(f.text()).toContain('TOTAL-PASSED');
    expect(f.text()).toContain('-> /verify/job-0007');
  });

  it('a failed result gives a non-zero exit code', async () => {
    mocks.verifyCreate.mockResolvedValue(ok({ job_id: 'job-0007', status: 'queued' }, 202));
    mocks.verifyGet.mockResolvedValue(ok(report('TOTAL-FAILED', 'MODIFIED')));
    const f = fakeIo([]);
    expect(await runLine('pdfsign verify memo-130-s1.signed.pdf', { io: f.io, user: null, commands: [createPdfsign({ sleep: async () => undefined })] })).toBe(1);
    expect(f.text()).toContain('TOTAL-FAILED');
  });

  it('prints a problem from verify.create (429 with Retry-After)', async () => {
    mocks.verifyCreate.mockResolvedValue({
      ...problem(429, 'RATE_LIMITED', 'ส่งคำขอตรวจถี่เกินไป'),
      error: { ...problem(429, 'RATE_LIMITED', 'ส่งคำขอตรวจถี่เกินไป').error, retry_after_s: 30 },
    });
    const f = fakeIo([]);
    expect(await run('pdfsign verify memo-130-s1.signed.pdf', f)).toBe(1);
    expect(f.text()).toContain('RATE_LIMITED');
    expect(f.text()).toContain('30 วินาที');
  });

  it('needs a file', async () => {
    const f = fakeIo([]);
    expect(await run('pdfsign verify', f)).toBe(2);
  });
});

describe('pdfsign usage', () => {
  it('no sub-command prints usage; unknown sub-command is an error', async () => {
    const a = fakeIo([]);
    expect(await run('pdfsign', a)).toBe(2);
    expect(a.text()).toContain('pdfsign sign');
    const b = fakeIo([]);
    expect(await run('pdfsign frobnicate', b)).toBe(2);
    expect(b.text()).toContain('ไม่รู้จักคำสั่งย่อย');
  });

  it('a transport failure on workstation() is reported, not thrown', async () => {
    mocks.workstation.mockResolvedValue(plainFail(0, 'ติดต่อระบบไม่ได้', 'NETWORK_ERROR'));
    const f = fakeIo([]);
    expect(await run('pdfsign sign a.pdf --field a', f)).toBe(1);
    expect(f.text()).toContain('NETWORK_ERROR');
  });
});
