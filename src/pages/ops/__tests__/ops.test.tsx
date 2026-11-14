// Component tests for sub-task G pages: /sign (terminal + button mode), /admin/status, /archive, /missions.
// The API client is mocked with vi.mock (pages talk only to `api` / `demoApi`); the store and the hash chain are real.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { MISSIONS } from '../../../contracts/missions';
import type { AdminStatusDto, ArchiveDto, SignReviewDto } from '../../../contracts/api';
import type { AuditDraft, AuditEntry, MissionProgress } from '../../../contracts/engine';
import type { Persona } from '../../../contracts/fixtures';
import { TID } from '../../../contracts/testids';
import { PERSONAS, ok, status, toUser } from '../../../store/__tests__/fakes';

const m = vi.hoisted(() => ({
  adminStatus: vi.fn(),
  adminAudit: vi.fn(),
  crlIssue: vi.fn(),
  archiveList: vi.fn(),
  archiveShare: vi.fn(),
  directory: vi.fn(),
  workstation: vi.fn(),
  signReview: vi.fn(),
  sign: vi.fn(),
  setFaults: vi.fn(),
  progress: vi.fn(),
  demoStatus: vi.fn(),
  verifyCreate: vi.fn(),
  verifyGet: vi.fn(),
}));
vi.mock('../../../api', () => ({
  configureApi: vi.fn(),
  api: {
    admin: { status: m.adminStatus, audit: m.adminAudit, crlIssue: m.crlIssue },
    archive: { list: m.archiveList, share: m.archiveShare },
    users: { directory: m.directory },
    verify: { create: m.verifyCreate, get: m.verifyGet },
  },
  demoApi: { workstation: m.workstation, signReview: m.signReview, sign: m.sign, setFaults: m.setFaults, progress: m.progress, status: m.demoStatus },
}));

import { chainEntries } from '../../../lib/hashChain';
import { useAppStore } from '../../../store';
import { AdminStatusPage } from '../../AdminStatusPage';
import { ArchivePage } from '../../ArchivePage';
import { MissionsPage } from '../../MissionsPage';
import { SignPage } from '../../SignPage';
import { detailsText } from '../AuditTable';
import { parseContent } from '../content';

const byId = (id: Persona['id']) => PERSONAS.find((p) => p.id === id) as Persona;
const SOMCHAI = byId('u-somchai');
const GUEST = byId('u-guest');
const ADMIN_A = byId('a-admin-a');
const ADMIN_B = byId('a-admin-b');

/** Signs a persona in (store + the status the demo API would answer). */
function loginAs(persona: Persona, over: Parameters<typeof status>[0] = {}) {
  const demo = status({ actor: toUser(persona), ...over });
  useAppStore.setState({ token: 't', user: toUser(persona), demo, dataVersion: 0 });
  m.demoStatus.mockResolvedValue(ok(demo));
}

const renderAt = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  localStorage.clear();
  useAppStore.setState({ token: null, user: null, demo: null, dataVersion: 0 });
  m.workstation.mockResolvedValue(
    ok({
      documents: [
        { path: '~/Documents/memo-130-unsigned.pdf', document_id: 'D12', sha256: `de00${'0'.repeat(55)}a1b2` },
        { path: '~/Documents/memo-130-s1.signed.pdf', document_id: 'D12-s1', sha256: `de00${'1'.repeat(60)}` },
      ],
      private_ca: [],
    }),
  );
});

// ====================== role gates (QA F15) ======================
describe('RequireRole on the ops pages', () => {
  it('/sign: guest sees the mismatch message, no terminal, no API call', () => {
    loginAs(GUEST);
    renderAt(<SignPage />);
    expect(screen.getByTestId(TID.requireRole.mismatch)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.terminal.root)).toBeNull();
    expect(screen.getByTestId(TID.page('sign'))).toBeInTheDocument(); // page root + h1 stay (shell smoke relies on it)
  });

  it('/admin/status: a signer sees the mismatch message and the admin API is not called', () => {
    loginAs(SOMCHAI);
    renderAt(<AdminStatusPage />);
    expect(screen.getByTestId(TID.requireRole.mismatch)).toBeInTheDocument();
    expect(m.adminStatus).not.toHaveBeenCalled();
    expect(m.adminAudit).not.toHaveBeenCalled();
  });

  it('/archive: an admin sees the mismatch message', () => {
    loginAs(ADMIN_A);
    renderAt(<ArchivePage />);
    expect(screen.getByTestId(TID.requireRole.mismatch)).toBeInTheDocument();
    expect(m.archiveList).not.toHaveBeenCalled();
  });

  it('/sign: a signer gets the terminal', () => {
    loginAs(SOMCHAI);
    renderAt(<SignPage />);
    expect(screen.queryByTestId(TID.requireRole.mismatch)).toBeNull();
    expect(screen.getByTestId(TID.terminal.root)).toBeInTheDocument();
  });
});

// ====================== /sign button mode ======================
describe('/sign button mode drives the same pdfsign code path', () => {
  const REVIEW: SignReviewDto = {
    document_id: 'D12',
    file_name: 'memo-130-unsigned.pdf',
    sha256: `de00${'0'.repeat(55)}a1b2`,
    pages: 2,
    field: 'approver-1',
    certify: true,
    existing_signatures: [],
  };

  beforeEach(() => {
    m.signReview.mockResolvedValue(ok(REVIEW));
    m.sign.mockResolvedValue(ok({ document_id: 'D12-s1', file_name: 'memo-130-s1.signed.pdf', levels: ['B-T', 'B-LT', 'B-LTA'] }, 201));
  });

  it('makes the same API calls as the CLI for the same input (review, then sign with the typed values)', async () => {
    const user = userEvent.setup();
    loginAs(SOMCHAI);
    renderAt(<SignPage />);

    // --- CLI run in the terminal ---
    const input = screen.getByTestId(TID.terminal.input);
    await user.type(input, 'pdfsign sign ~/Documents/memo-130-unsigned.pdf --field "approver-1" --certify{Enter}');
    await waitFor(() => expect(input).toHaveAttribute('aria-label', expect.stringContaining('วัตถุประสงค์')));
    await user.type(input, '1{Enter}');
    await waitFor(() => expect(input).toHaveAttribute('aria-label', expect.stringContaining('4 ตัวสุดท้าย')));
    await user.type(input, 'a1b2{Enter}');
    await waitFor(() => expect(input).toHaveAttribute('aria-label', expect.stringContaining('.p12')));
    await user.type(input, 'demo-p12-password{Enter}');
    await waitFor(() => expect(m.sign).toHaveBeenCalledTimes(1));
    const cli = { review: m.signReview.mock.calls.map((c) => c[0]), sign: m.sign.mock.calls.map((c) => c[0]) };

    // --- button mode, same inputs ---
    m.signReview.mockClear();
    m.sign.mockClear();
    await user.click(screen.getByTestId(TID.sign.modeToggle));
    expect(screen.getByTestId(TID.sign.modeToggle)).toHaveAttribute('data-mode', 'buttons');
    await screen.findByTestId(TID.sign.wizardDocument);
    await waitFor(() => expect(screen.getByTestId(TID.sign.wizardDocument)).toHaveValue('~/Documents/memo-130-unsigned.pdf'));
    const field = screen.getByTestId(TID.sign.wizardField);
    await user.clear(field);
    await user.type(field, 'approver-1');
    await user.click(screen.getByTestId(TID.sign.wizardCertify));
    await user.click(screen.getByTestId(TID.sign.wizardSubmit)); // review

    const review = await screen.findByTestId(TID.sign.review);
    expect(review).toHaveTextContent(REVIEW.sha256); // the form shows the SHA-256 to read the last 4 characters from
    await waitFor(() => expect(screen.getByTestId(TID.sign.wizardSubmit)).toHaveAttribute('data-step', 'purpose'));
    await user.selectOptions(screen.getByTestId(TID.sign.wizardPurpose), '1');
    await user.click(screen.getByTestId(TID.sign.wizardSubmit)); // purpose

    await waitFor(() => expect(screen.getByTestId(TID.sign.wizardSubmit)).toHaveAttribute('data-step', 'sha'));
    await user.type(screen.getByTestId(TID.sign.wizardSha), 'ffff'); // wrong first
    await user.click(screen.getByTestId(TID.sign.wizardSubmit));
    await waitFor(() => expect(screen.getByTestId(TID.sign.result)).toHaveTextContent('4 ตัวท้ายไม่ตรง'));
    expect(m.sign).not.toHaveBeenCalled(); // re-asked, nothing sent
    await waitFor(() => expect(screen.getByTestId(TID.sign.wizardSubmit)).toHaveAttribute('data-step', 'sha'));
    await user.clear(screen.getByTestId(TID.sign.wizardSha));
    await user.type(screen.getByTestId(TID.sign.wizardSha), 'a1b2');
    await user.click(screen.getByTestId(TID.sign.wizardSubmit));

    await waitFor(() => expect(screen.getByTestId(TID.sign.wizardSubmit)).toHaveAttribute('data-step', 'p12'));
    await user.type(screen.getByTestId(TID.sign.wizardP12), 'demo-p12-password');
    await user.click(screen.getByTestId(TID.sign.wizardSubmit));

    await waitFor(() => expect(screen.getByTestId(TID.sign.result)).toHaveAttribute('data-state', 'ok'));
    expect(screen.getByTestId(TID.sign.result)).toHaveTextContent('memo-130-s1.signed.pdf');
    expect(screen.getByTestId(TID.sign.result)).toHaveTextContent('B-LTA');
    // The secret is not kept in the form after sending.
    expect(screen.getByTestId(TID.sign.wizardP12)).toHaveValue('');

    const button = { review: m.signReview.mock.calls.map((c) => c[0]), sign: m.sign.mock.calls.map((c) => c[0]) };
    expect(button).toEqual(cli);
  });

  it('renders a refusal (TSA_DRIFT with its ref) in the result block', async () => {
    const user = userEvent.setup();
    m.sign.mockResolvedValue({
      ok: false,
      error: {
        status: 503,
        code: 'TSA_DRIFT',
        title: 'TSA หยุด',
        detail: 'TSA หยุดออกตราประทับเวลา เพราะเวลาเพี้ยนเกินกำหนด',
        problem: { type: '/problems/TSA_DRIFT', title: 'TSA หยุด', status: 503, code: 'TSA_DRIFT', ref: 'T9' },
      },
    });
    loginAs(SOMCHAI);
    renderAt(<SignPage />);
    await user.click(screen.getByTestId(TID.sign.modeToggle));
    await waitFor(() => expect(screen.getByTestId(TID.sign.wizardDocument)).toHaveValue('~/Documents/memo-130-unsigned.pdf'));
    await user.click(screen.getByTestId(TID.sign.wizardSubmit));
    await waitFor(() => expect(screen.getByTestId(TID.sign.wizardSubmit)).toHaveAttribute('data-step', 'purpose'));
    await user.click(screen.getByTestId(TID.sign.wizardSubmit));
    await waitFor(() => expect(screen.getByTestId(TID.sign.wizardSubmit)).toHaveAttribute('data-step', 'sha'));
    await user.type(screen.getByTestId(TID.sign.wizardSha), 'a1b2');
    await user.click(screen.getByTestId(TID.sign.wizardSubmit));
    await waitFor(() => expect(screen.getByTestId(TID.sign.wizardSubmit)).toHaveAttribute('data-step', 'p12'));
    await user.type(screen.getByTestId(TID.sign.wizardP12), 'demo-p12-password');
    await user.click(screen.getByTestId(TID.sign.wizardSubmit));
    const result = await screen.findByTestId(TID.sign.result);
    await waitFor(() => expect(result).toHaveAttribute('data-state', 'failed'));
    expect(result).toHaveTextContent('[TSA_DRIFT]');
    expect(result).toHaveTextContent('อ้างอิง T9');
  });

  it('a refusal at the review step (no questions) is shown as the result', async () => {
    const user = userEvent.setup();
    m.signReview.mockResolvedValue({
      ok: false,
      error: { status: 403, code: 'CERT_NOT_ACTIVE', title: 'x', detail: 'คุณไม่มีใบรับรองที่ใช้งานได้ (Active) จึงเซ็นไม่ได้', problem: null },
    });
    loginAs(SOMCHAI);
    renderAt(<SignPage />);
    await user.click(screen.getByTestId(TID.sign.modeToggle));
    await waitFor(() => expect(screen.getByTestId(TID.sign.wizardDocument)).toHaveValue('~/Documents/memo-130-unsigned.pdf'));
    await user.click(screen.getByTestId(TID.sign.wizardSubmit));
    const result = await screen.findByTestId(TID.sign.result);
    expect(result).toHaveTextContent('CERT_NOT_ACTIVE');
    await waitFor(() => expect(result).toHaveAttribute('data-state', 'failed'));
    expect(screen.queryByTestId(TID.sign.review)).toBeNull();
  });
});

// ====================== /admin/status ======================
const DRAFTS: AuditDraft[] = [
  { at: '2026-11-12T09:00:00+07:00', actor: 'system', action: 'system.reset', target: null, details: {} },
  { at: '2026-11-12T09:05:00+07:00', actor: 'u-somchai', action: 'sign.refused', target: 'D12', details: { code: 'TSA_DRIFT', field: 'approver-1' } },
  { at: '2026-11-12T09:10:00+07:00', actor: 'system', action: 'archive.deleted', target: 'arc-0001', details: { sha256: `de00${'a'.repeat(60)}` } },
];

const STATUS: AdminStatusDto = {
  services: [
    { id: 'ca', label_th: 'ผู้ออกใบรับรอง (CA)', state: 'up' },
    { id: 'tsa', label_th: 'บริการตราประทับเวลา (TSA)', state: 'down', detail_th: 'เวลาเพี้ยน 1400 ms' },
    { id: 'ocsp', label_th: 'OCSP', state: 'up' },
    { id: 'crl', label_th: 'CRL', state: 'up' },
    { id: 'verify-queue', label_th: 'คิว', state: 'up' },
  ],
  tsa: { offset_ms: 1400, limit_ms: 1000, state: 'stopped' },
  queue: { active: 3, max: 20 },
  crl: { number: 5, next_update: '2026-11-19T06:00:00+07:00' },
  ocsp_signer: { serial: 'DE:M0:0C:SP:01', not_after: '2026-12-12T09:00:00+07:00' },
  not_simulated: [{ id: 'deploy', label_th: 'การ deploy ระบบจริง ไม่ได้จำลอง' }],
};

describe('/admin/status', () => {
  let chain: AuditEntry[];

  beforeEach(async () => {
    chain = await chainEntries(DRAFTS, null);
    m.adminStatus.mockResolvedValue(ok(STATUS));
    m.adminAudit.mockImplementation(async () => ok(chain));
    m.progress.mockResolvedValue(ok(null));
  });

  it('shows one card per service, the TSA offset in seconds, the queue, and the not-simulated list', async () => {
    loginAs(ADMIN_A);
    renderAt(<AdminStatusPage />);
    for (const id of ['ca', 'tsa', 'ocsp', 'crl', 'verify-queue'] as const) {
      expect(await screen.findByTestId(TID.adminStatus.service(id))).toBeInTheDocument();
    }
    expect(screen.getByTestId(TID.adminStatus.service('tsa'))).toHaveAttribute('data-state', 'down');
    expect(screen.getByTestId(TID.adminStatus.service('tsa'))).toHaveTextContent('1.4 วินาที');
    expect(screen.getByTestId(TID.adminStatus.service('verify-queue'))).toHaveTextContent('3 จาก 20');
    expect(screen.getByText('การ deploy ระบบจริง ไม่ได้จำลอง')).toBeInTheDocument();
  });

  it('lists the audit log newest first, with the sha256 of an archive.deleted entry in full', async () => {
    loginAs(ADMIN_A);
    renderAt(<AdminStatusPage />);
    const table = await screen.findByTestId(TID.adminStatus.auditTable);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute('data-action', 'archive.deleted');
    expect(rows[0]).toHaveTextContent(`de00${'a'.repeat(60)}`);
    expect(rows[1]).toHaveTextContent('code=TSA_DRIFT');
  });

  it('fault toggles use the shared mapping: tsa-drift sends tsa_drift_ms 1400 and reflects aria-pressed', async () => {
    const user = userEvent.setup();
    loginAs(ADMIN_A);
    m.setFaults.mockResolvedValue(ok(status({ actor: toUser(ADMIN_A), faults: { ocsp_down: false, crl_down: false, tsa_drift_ms: 1400, queue_full: false } })));
    renderAt(<AdminStatusPage />);
    const toggle = await screen.findByTestId(TID.adminStatus.fault('tsa-drift'));
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(m.setFaults).toHaveBeenCalledWith({ tsa_drift_ms: 1400 });
    await waitFor(() => expect(screen.getByTestId(TID.adminStatus.fault('tsa-drift'))).toHaveAttribute('aria-pressed', 'true'));
    // 'ocsp-crl' sends both flags.
    await user.click(screen.getByTestId(TID.adminStatus.fault('ocsp-crl')));
    expect(m.setFaults).toHaveBeenLastCalledWith({ ocsp_down: true, crl_down: true });
  });

  it('admin-a issues a CRL through the MFA dialog; the code is sent to the API', async () => {
    const user = userEvent.setup();
    loginAs(ADMIN_A);
    m.crlIssue.mockResolvedValue(ok({ ca: 'doc-signing-2026', number: 6, this_update: 'x', next_update: 'y', entries: [] }));
    renderAt(<AdminStatusPage />);
    await user.click(await screen.findByTestId(TID.adminStatus.issueCrl));
    await user.type(screen.getByTestId(TID.mfa.input), '246810');
    await user.click(screen.getByTestId(TID.mfa.submit));
    await waitFor(() => expect(m.crlIssue).toHaveBeenCalledWith('246810'));
    expect(await screen.findByText(/ออก CRL หมายเลข 6 แล้ว/)).toBeInTheDocument();
  });

  it('a wrong MFA code keeps the dialog open with an error', async () => {
    const user = userEvent.setup();
    loginAs(ADMIN_A);
    m.crlIssue.mockResolvedValue({ ok: false, error: { status: 403, code: 'MFA_INVALID', title: 'x', problem: null } });
    renderAt(<AdminStatusPage />);
    await user.click(await screen.findByTestId(TID.adminStatus.issueCrl));
    await user.type(screen.getByTestId(TID.mfa.input), '000000');
    await user.click(screen.getByTestId(TID.mfa.submit));
    expect(await screen.findByText(/รหัสยืนยันไม่ถูกต้อง/)).toBeInTheDocument();
    expect(screen.getByTestId(TID.mfa.dialog)).toBeInTheDocument();
  });

  it('admin-b is a read-only auditor: no issue-CRL button', async () => {
    loginAs(ADMIN_B);
    renderAt(<AdminStatusPage />);
    await screen.findByTestId(TID.adminStatus.auditTable);
    expect(screen.queryByTestId(TID.adminStatus.issueCrl)).toBeNull();
  });

  it('hash chain check: valid chain -> data-valid=true and M11 is recorded', async () => {
    const user = userEvent.setup();
    loginAs(ADMIN_B);
    renderAt(<AdminStatusPage />);
    await user.click(await screen.findByTestId(TID.adminStatus.verifyChain));
    const result = await screen.findByTestId(TID.adminStatus.chainResult);
    expect(result).toHaveAttribute('data-valid', 'true');
    expect(result).toHaveTextContent('3 รายการ');
    expect(m.progress).toHaveBeenCalledWith('M11.chain_verified');
  });

  it('hash chain check: a tampered log -> data-valid=false, names the first bad seq, M11 is NOT recorded', async () => {
    const user = userEvent.setup();
    // Edit entry 2 after it was chained (hash no longer matches its content).
    chain = chain.map((e) => (e.seq === 2 ? { ...e, details: { code: 'NOTHING_HAPPENED', field: 'approver-1' } } : e));
    loginAs(ADMIN_B);
    renderAt(<AdminStatusPage />);
    await user.click(await screen.findByTestId(TID.adminStatus.verifyChain));
    const result = await screen.findByTestId(TID.adminStatus.chainResult);
    expect(result).toHaveAttribute('data-valid', 'false');
    expect(result).toHaveTextContent('ลำดับ 2');
    expect(m.progress).not.toHaveBeenCalled();
  });

  it('hash chain check by admin-a still reports valid but says M11 needs admin-b when the API refuses', async () => {
    const user = userEvent.setup();
    m.progress.mockResolvedValue({ ok: false, error: { status: 403, code: 'FORBIDDEN', title: 'x', problem: null } });
    loginAs(ADMIN_A);
    renderAt(<AdminStatusPage />);
    await user.click(await screen.findByTestId(TID.adminStatus.verifyChain));
    const result = await screen.findByTestId(TID.adminStatus.chainResult);
    expect(result).toHaveAttribute('data-valid', 'true');
    expect(result).toHaveTextContent('ผู้ดูแล B');
  });

  it('detailsText prints key=value pairs', () => {
    expect(detailsText({ a: 'x', n: 1, o: { k: true } })).toBe('a=x · n=1 · o={"k":true}');
  });
});

// ====================== /archive ======================
describe('/archive', () => {
  const base: ArchiveDto = {
    id: 'arc-0001',
    document_id: 'D01',
    file_name: 'memo-118.signed.pdf',
    owner: 'u-somchai',
    state: 'archived',
    added_at: '2026-11-12T09:00:00+07:00',
    expires_at: '2031-11-12T09:00:00+07:00',
    size_bytes: 300 * 1024,
    sha256: `de00${'b'.repeat(60)}`,
    retimestamp_count: 0,
    shared_with: [],
    deleted_at: null,
  };
  const deleted: ArchiveDto = { ...base, id: 'arc-0002', document_id: 'D05', file_name: 'memo-122.signed.pdf', state: 'deleted', deleted_at: '2031-11-12T09:00:00+07:00', sha256: `de00${'c'.repeat(60)}` };
  const sharedWithMe: ArchiveDto = { ...base, id: 'arc-0003', owner: 'u-wipawan', file_name: 'memo-121.signed.pdf', shared_with: ['u-somchai'] };

  beforeEach(() => {
    m.archiveList.mockResolvedValue(ok([base, deleted, sharedWithMe]));
    m.directory.mockResolvedValue(
      ok([
        { id: 'u-wipawan', display_name: 'วิภาวรรณ ศรีสุข' },
        { id: 'u-guest', display_name: 'ผู้ตรวจทั่วไป' },
      ]),
    );
  });

  it('lists rows with states; a deleted row shows its SHA-256 and has no share button', async () => {
    loginAs(SOMCHAI);
    renderAt(<ArchivePage />);
    const live = await screen.findByTestId(TID.archive.row('arc-0001'));
    expect(live).toHaveAttribute('data-state', 'archived');
    expect(within(live).getByTestId(TID.archive.share('arc-0001'))).toBeInTheDocument();

    const gone = screen.getByTestId(TID.archive.row('arc-0002'));
    expect(gone).toHaveAttribute('data-state', 'deleted');
    expect(gone).toHaveTextContent(`de00${'c'.repeat(60)}`);
    expect(gone).toHaveTextContent('เหลือเฉพาะค่า SHA-256');
    expect(within(gone).queryByTestId(TID.archive.share('arc-0002'))).toBeNull();
  });

  it('an item shared with me names the owner and cannot be re-shared', async () => {
    loginAs(SOMCHAI);
    renderAt(<ArchivePage />);
    const row = await screen.findByTestId(TID.archive.row('arc-0003'));
    expect(row).toHaveTextContent('วิภาวรรณ ศรีสุข (แชร์ให้คุณ)');
    expect(within(row).queryByTestId(TID.archive.share('arc-0003'))).toBeNull();
  });

  it('share: pick a user in the dialog and send {user_id}', async () => {
    const user = userEvent.setup();
    m.archiveShare.mockResolvedValue(ok({ ...base, shared_with: ['u-guest'] }));
    loginAs(SOMCHAI);
    renderAt(<ArchivePage />);
    await user.click(await screen.findByTestId(TID.archive.share('arc-0001')));
    await user.selectOptions(screen.getByTestId(TID.archive.shareTarget), 'u-guest');
    await user.click(screen.getByTestId(TID.archive.shareSubmit));
    await waitFor(() => expect(m.archiveShare).toHaveBeenCalledWith('arc-0001', { user_id: 'u-guest' }));
    expect(await screen.findByText(/แชร์ memo-118.signed.pdf ให้ ผู้ตรวจทั่วไป แล้ว/)).toBeInTheDocument();
  });

  it('a share problem is shown in the dialog with its code', async () => {
    const user = userEvent.setup();
    m.archiveShare.mockResolvedValue({ ok: false, error: { status: 409, code: 'INVALID_STATE', title: 'x', detail: 'เอกสารนี้ถูกลบจากคลังแล้ว', problem: null } });
    loginAs(SOMCHAI);
    renderAt(<ArchivePage />);
    await user.click(await screen.findByTestId(TID.archive.share('arc-0001')));
    await user.click(screen.getByTestId(TID.archive.shareSubmit));
    expect(await screen.findByText('INVALID_STATE')).toBeInTheDocument();
  });
});

// ====================== /missions ======================
describe('/missions', () => {
  const progress = (doneIds: string[]): MissionProgress[] =>
    MISSIONS.map((mm) => ({ id: mm.id, done: doneIds.includes(mm.id), done_at: doneIds.includes(mm.id) ? '2026-11-12T10:00:00+07:00' : null }));

  it('lists M1-M11 with data-done from the demo status and shows the recap only for finished missions', async () => {
    loginAs(GUEST, { missions: progress(['M2']) });
    renderAt(<MissionsPage />);
    for (const mm of MISSIONS) expect(screen.getByTestId(TID.missions.item(mm.id))).toBeInTheDocument();
    expect(screen.getByTestId(TID.missions.item('M2'))).toHaveAttribute('data-done', 'true');
    expect(screen.getByTestId(TID.missions.item('M1'))).toHaveAttribute('data-done', 'false');
    expect(screen.getByTestId(TID.missions.item('M2'))).toHaveTextContent('✓ สำเร็จ');
    expect(screen.getByTestId(TID.missions.item('M2'))).toHaveTextContent('คำขอของคุณผ่านการตรวจ CSR');
    expect(screen.getByTestId(TID.missions.item('M1'))).toHaveTextContent('สรุปจะแสดงที่นี่เมื่อคุณทำภารกิจนี้สำเร็จ');
    expect(screen.getByRole('status')).toHaveTextContent('สำเร็จแล้ว 1 จาก 11');
  });

  it('technical details are collapsed by default (two-layer text)', () => {
    loginAs(GUEST, { missions: progress([]) });
    renderAt(<MissionsPage />);
    const details = screen.getByTestId(TID.missions.item('M9')).querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
    expect(within(details as HTMLElement).getByText('รายละเอียดทางเทคนิค')).toBeInTheDocument();
  });
});

// ====================== content loader ======================
describe('parseContent', () => {
  it('reads refs and splits on second-level headings', () => {
    const parsed = parseContent('<!-- refs: S1, S2 -->\n## อธิบายสั้น\nA\n\nB\n## รายละเอียดทางเทคนิค\nC\n');
    expect(parsed.refs).toEqual(['S1', 'S2']);
    expect(parsed.sections).toEqual({ อธิบายสั้น: 'A\n\nB', รายละเอียดทางเทคนิค: 'C' });
  });
  it('a file without the refs header has no refs (check:content rejects it separately)', () => {
    expect(parseContent('## x\ny').refs).toEqual([]);
  });
});
