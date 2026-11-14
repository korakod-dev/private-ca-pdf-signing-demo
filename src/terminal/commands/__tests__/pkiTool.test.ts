// pki-tool tests with scripted fake IO and a mocked API (no network, no mock runtime).
// Key properties: the passphrase is checked locally and never appears in any API call or output; unknown flags are
// errors; finalize/renew call the right endpoints.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiResult } from '../../../contracts/api-client';
import type { TerminalIO, TerminalLineKind } from '../../../contracts/terminal';
import type { UserSummary } from '../../../contracts/store';

const mocks = vi.hoisted(() => ({
  keygen: vi.fn(),
  workstation: vi.fn(),
  list: vi.fn(),
  renew: vi.fn(),
  finalize: vi.fn(),
}));

vi.mock('../../../api', () => ({
  configureApi: vi.fn(),
  api: { certs: { list: mocks.list, renew: mocks.renew, finalize: mocks.finalize } },
  demoApi: { keygen: mocks.keygen, workstation: mocks.workstation },
}));

import { runLine } from '../../core/dispatch';
import { getLatestCsr, MAX_PASSPHRASE_ATTEMPTS, pkiTool, serialFromCertFile, setLatestCsr } from '../pkiTool';

const ok = <T>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data });
const fail = (status: number, code: string, detail: string): ApiResult<never> => ({
  ok: false,
  error: { status, code, title: code, detail, problem: null },
});

const USER: UserSummary = { id: 'u-nattapon', display_name: 'ณัฐพล ทองดี', email: 'nattapon@lab.korakod.dev', role: 'new_user' };
const CSR = { subject_cn: 'ณัฐพล ทองดี', email: 'nattapon@lab.korakod.dev', key_alg: 'ECDSA-P256', key_size: 256, pop_valid: true, extra_extensions: [], key_previously_used: false };
const KEYGEN_OK = ok({ csr_pem: '-----BEGIN DEMO CSR-----\nu-nattapon-key-1\n-----END DEMO CSR-----', csr: CSR });

/** Scripted IO: `answers` are consumed by prompt() in order; everything printed is recorded. */
function fakeIo(answers: string[] = []) {
  const lines: { text: string; kind: TerminalLineKind }[] = [];
  const prompts: { label: string; secret: boolean }[] = [];
  const io: TerminalIO = {
    print: (text, kind = 'out') => void lines.push({ text, kind }),
    prompt: async (label, opts) => {
      prompts.push({ label, secret: opts?.secret === true });
      const next = answers.shift();
      if (next === undefined) throw new Error('no scripted answer left');
      return next;
    },
    clear: () => undefined,
    link: (label) => void lines.push({ text: label, kind: 'info' }),
  };
  return { io, lines, prompts, text: () => lines.map((l) => l.text).join('\n') };
}

const run = (line: string, io: TerminalIO, user: UserSummary | null = USER) => runLine(line, { io, user, commands: [pkiTool] });

/** Everything that was sent to any mocked API function, as one string. */
const allApiCalls = () => JSON.stringify(Object.values(mocks).map((m) => m.mock.calls));

beforeEach(() => {
  Object.values(mocks).forEach((m) => m.mockReset());
  setLatestCsr(null);
  mocks.keygen.mockResolvedValue(KEYGEN_OK);
  mocks.workstation.mockResolvedValue(
    ok({ documents: [], private_ca: [{ path: '~/.private-ca/key-1.pem', kind: 'private_key' }, { path: '~/.private-ca/key-1.csr', kind: 'csr' }] }),
  );
});

describe('pki-tool init', () => {
  const INIT = 'pki-tool init --name "ณัฐพล ทองดี" --email nattapon@lab.korakod.dev';

  it('rejects an 11-character passphrase, accepts 12, and sends only name + email to the API', async () => {
    const t = fakeIo(['elevenchars', 'twelve-chars']); // 11 then 12 characters
    expect(await run(INIT, t.io)).toBe(0);

    expect(t.prompts).toHaveLength(2);
    expect(t.prompts.every((p) => p.secret)).toBe(true); // masked prompts
    expect(t.text()).toContain('สั้นเกินไป (11 ตัวอักษร)');
    expect(mocks.keygen).toHaveBeenCalledTimes(1);
    expect(mocks.keygen).toHaveBeenCalledWith({ name: 'ณัฐพล ทองดี', email: 'nattapon@lab.korakod.dev' });
  });

  it('never lets the passphrase reach any API call, the output or the published CSR', async () => {
    const secret = 'correct-horse-battery';
    const t = fakeIo([secret]);
    expect(await run(INIT, t.io)).toBe(0);
    expect(allApiCalls()).not.toContain(secret);
    expect(t.text()).not.toContain(secret);
    expect(JSON.stringify(getLatestCsr())).not.toContain(secret);
  });

  it('publishes the CSR for the signed-in persona and prints it', async () => {
    const t = fakeIo(['twelve-chars']);
    await run(INIT, t.io);
    expect(getLatestCsr()).toMatchObject({ persona: 'u-nattapon', name: 'ณัฐพล ทองดี', email: 'nattapon@lab.korakod.dev' });
    expect(t.text()).toContain('BEGIN DEMO CSR');
    expect(t.text()).toContain('~/.private-ca/key-1.csr');
  });

  it('counts characters, not UTF-16 units (Thai text and emoji)', async () => {
    const t = fakeIo(['รหัสผ่านไทยยาวพอ']); // 16 Thai characters (combining marks included)
    expect(await run(INIT, t.io)).toBe(0);
    const emoji = fakeIo(['😀😀😀😀😀😀😀😀😀😀😀', 'twelve-chars']); // 11 emoji = 22 UTF-16 units, still too short
    expect(await run(INIT, emoji.io)).toBe(0);
    expect(emoji.text()).toContain('สั้นเกินไป (11 ตัวอักษร)');
  });

  it('gives up after too many short passphrases and never calls keygen', async () => {
    const t = fakeIo(Array.from({ length: MAX_PASSPHRASE_ATTEMPTS }, () => 'short'));
    expect(await run(INIT, t.io)).toBe(1);
    expect(t.prompts).toHaveLength(MAX_PASSPHRASE_ATTEMPTS);
    expect(mocks.keygen).not.toHaveBeenCalled();
  });

  it('needs both --name and --email (usage error, no prompt, no API call)', async () => {
    const t = fakeIo();
    expect(await run('pki-tool init --name "x"', t.io)).toBe(2);
    expect(t.prompts).toHaveLength(0);
    expect(mocks.keygen).not.toHaveBeenCalled();
  });

  it('needs a signed-in persona', async () => {
    const t = fakeIo();
    expect(await run(INIT, t.io, null)).toBe(1);
    expect(t.text()).toContain('ต้องเลือกบทบาทก่อน');
  });

  it('prints the API problem when keygen fails', async () => {
    mocks.keygen.mockResolvedValue(fail(401, 'UNAUTHENTICATED', 'ต้องเข้าสู่ระบบก่อน'));
    const t = fakeIo(['twelve-chars']);
    expect(await run(INIT, t.io)).toBe(1);
    expect(t.text()).toContain('ต้องเข้าสู่ระบบก่อน');
    expect(getLatestCsr()).toBeNull();
  });
});

describe('pki-tool flags and usage', () => {
  it.each(['pki-tool init --name a --email b --yes', 'pki-tool init --name a --email b --force', 'pki-tool renew --yes'])(
    'rejects unknown flags without any prompt or API call: %s',
    async (line) => {
      const t = fakeIo();
      expect(await run(line, t.io)).toBe(2);
      expect(t.text()).toContain('ไม่รู้จักตัวเลือก');
      expect(t.prompts).toHaveLength(0);
      expect(Object.values(mocks).every((m) => m.mock.calls.length === 0)).toBe(true);
    },
  );

  it('prints usage for no sub-command (exit 2), an unknown sub-command (exit 2) and --help (exit 0)', async () => {
    expect(await run('pki-tool', fakeIo().io)).toBe(2);
    expect(await run('pki-tool bogus', fakeIo().io)).toBe(2);
    const help = fakeIo();
    expect(await run('pki-tool --help', help.io)).toBe(0);
    expect(help.text()).toContain('pki-tool init');
  });
});

describe('pki-tool finalize', () => {
  beforeEach(() => {
    mocks.workstation.mockResolvedValue(
      ok({ documents: [], private_ca: [{ path: '~/.private-ca/DE-M0-A0-00-00-01.crt', kind: 'certificate' }] }),
    );
    mocks.finalize.mockResolvedValue(ok({ serial: 'DE:M0:A0:00:00:01', state: 'Active' }));
  });

  it('turns the file name into the serial and finalizes it', async () => {
    const t = fakeIo();
    expect(await run('pki-tool finalize --cert ~/.private-ca/DE-M0-A0-00-00-01.crt', t.io)).toBe(0);
    expect(mocks.finalize).toHaveBeenCalledWith('DE:M0:A0:00:00:01');
    expect(t.text()).toContain('Active');
  });

  it('accepts the bare file name too', async () => {
    expect(await run('pki-tool finalize --cert DE-M0-A0-00-00-01.crt', fakeIo().io)).toBe(0);
    expect(mocks.finalize).toHaveBeenCalledWith('DE:M0:A0:00:00:01');
  });

  it('says "No such file" for a file that is not on the workstation', async () => {
    const t = fakeIo();
    expect(await run('pki-tool finalize --cert nothing.crt', t.io)).toBe(1);
    expect(t.text()).toContain('No such file (demo)');
    expect(mocks.finalize).not.toHaveBeenCalled();
  });

  it('without --cert lists the certificate files (exit 2)', async () => {
    const t = fakeIo();
    expect(await run('pki-tool finalize', t.io)).toBe(2);
    expect(t.text()).toContain('DE-M0-A0-00-00-01.crt');
  });

  it('prints the API problem (e.g. certificate not in state Issued)', async () => {
    mocks.finalize.mockResolvedValue(fail(409, 'INVALID_STATE', 'ยืนยันติดตั้งได้เฉพาะใบที่ออกแล้ว'));
    const t = fakeIo();
    expect(await run('pki-tool finalize --cert DE-M0-A0-00-00-01.crt', t.io)).toBe(1);
    expect(t.text()).toContain('ยืนยันติดตั้งได้เฉพาะใบที่ออกแล้ว');
  });
});

describe('pki-tool renew', () => {
  const GOOD = 'twelve-chars-or-more!';
  const ACTIVE = { serial: 'DE:M0:22:91:AF:03', state: 'Active' };
  beforeEach(() => {
    mocks.list.mockResolvedValue(ok([{ serial: 'DE:M0:22:91:AF:02', state: 'Expired' }, ACTIVE]));
    mocks.renew.mockResolvedValue(ok({ id: 'req-0001', state: 'approved' }, 201));
  });

  it('generates a new key for the persona and renews the Active certificate', async () => {
    const aree: UserSummary = { id: 'u-aree', display_name: 'อารีย์ มีสุข', email: 'aree@lab.korakod.dev', role: 'signer' };
    const t = fakeIo([GOOD]);
    expect(await run('pki-tool renew', t.io, aree)).toBe(0);
    expect(mocks.keygen).toHaveBeenCalledWith({ name: 'อารีย์ มีสุข', email: 'aree@lab.korakod.dev' });
    expect(mocks.renew).toHaveBeenCalledWith('DE:M0:22:91:AF:03', { csr_pem: expect.stringContaining('BEGIN DEMO CSR') });
    expect(t.text()).toContain('ไม่ต้องพบตัวอีก');
  });

  it('asks a secret passphrase of >= 12 characters before the new key (F27): short is re-asked, and it never reaches the API or the output', async () => {
    const t = fakeIo(['elevenchars', GOOD]); // 11 then 21 characters
    expect(await run('pki-tool renew', t.io)).toBe(0);
    expect(t.prompts).toHaveLength(2);
    expect(t.prompts.every((p) => p.secret)).toBe(true);
    expect(t.text()).toContain('สั้นเกินไป');
    expect(mocks.keygen).toHaveBeenCalledTimes(1); // the key is generated only after an accepted passphrase
    expect(allApiCalls()).not.toContain(GOOD);
    expect(allApiCalls()).not.toContain('elevenchars');
    expect(t.text()).not.toContain(GOOD);
  });

  it('gives up after repeated short passphrases without generating a key (F27)', async () => {
    const t = fakeIo(Array.from({ length: MAX_PASSPHRASE_ATTEMPTS }, () => 'short'));
    expect(await run('pki-tool renew', t.io)).toBe(1);
    expect(mocks.keygen).not.toHaveBeenCalled();
    expect(mocks.renew).not.toHaveBeenCalled();
  });

  it('says in-person proofing is needed when the request is not auto-approved', async () => {
    mocks.renew.mockResolvedValue(ok({ id: 'req-0002', state: 'awaitingInPerson' }, 201));
    const t = fakeIo([GOOD]);
    expect(await run('pki-tool renew', t.io)).toBe(0);
    expect(t.text()).toContain('ต้องพบตัวกับผู้ดูแล');
  });

  it('accepts --cert as a serial or as a file name', async () => {
    expect(await run('pki-tool renew --cert DE:M0:22:91:AF:03', fakeIo([GOOD]).io)).toBe(0);
    expect(await run('pki-tool renew --cert ~/.private-ca/DE-M0-22-91-AF-03.crt', fakeIo([GOOD]).io)).toBe(0);
    expect(mocks.renew).toHaveBeenCalledTimes(2);
  });

  it('refuses when there is no Active certificate (and generates no key)', async () => {
    mocks.list.mockResolvedValue(ok([{ serial: 'DE:M0:22:91:AF:02', state: 'Expired' }]));
    const t = fakeIo();
    expect(await run('pki-tool renew', t.io)).toBe(1);
    expect(t.prompts).toHaveLength(0); // nothing to renew: no passphrase question either
    expect(mocks.keygen).not.toHaveBeenCalled();
  });

  it('stops when the renewal request itself fails', async () => {
    mocks.renew.mockResolvedValue(fail(409, 'INVALID_STATE', 'ใบนี้มีคำขอต่ออายุที่ค้างอยู่แล้ว'));
    const t = fakeIo([GOOD]);
    expect(await run('pki-tool renew', t.io)).toBe(1);
    expect(t.text()).toContain('ค้างอยู่แล้ว');
  });
});

describe('serialFromCertFile', () => {
  it('maps file names to serials', () => {
    expect(serialFromCertFile('~/.private-ca/DE-M0-4F-2A-91-01.crt')).toBe('DE:M0:4F:2A:91:01');
    expect(serialFromCertFile('DE-M0-A0-00-00-01.crt')).toBe('DE:M0:A0:00:00:01');
  });
});
