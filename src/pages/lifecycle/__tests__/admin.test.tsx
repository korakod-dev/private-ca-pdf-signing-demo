// Component tests for /admin/requests and /admin/certs (sub-task F): role gate (F15), checklist rules, MFA header.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { TID } from '../../../contracts/testids';
import { ok, PERSONAS, status, toUser } from '../../../store/__tests__/fakes';

const m = vi.hoisted(() => ({
  requestList: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  certList: vi.fn(),
  revoke: vi.fn(),
  closeAccount: vi.fn(),
  personas: vi.fn(),
  demoStatus: vi.fn(),
}));

vi.mock('../../../api', () => ({
  configureApi: vi.fn(),
  api: {
    certRequests: { list: m.requestList, approve: m.approve, reject: m.reject },
    certs: { list: m.certList, revoke: m.revoke },
    admin: { closeAccount: m.closeAccount },
  },
  demoApi: { personas: m.personas, status: m.demoStatus },
}));

import { useAppStore } from '../../../store';
import { AdminCertsPage } from '../../AdminCertsPage';
import { AdminRequestsPage } from '../../AdminRequestsPage';

const [SOMCHAI, , , GUEST, ADMIN_A, ADMIN_B] = PERSONAS.map(toUser) as [
  ReturnType<typeof toUser>, ReturnType<typeof toUser>, ReturnType<typeof toUser>, ReturnType<typeof toUser>, ReturnType<typeof toUser>, ReturnType<typeof toUser>,
];
const signIn = (user: ReturnType<typeof toUser>) => {
  m.demoStatus.mockResolvedValue(ok(status({ actor: user })));
  useAppStore.setState({ token: 't', user, demo: status({ actor: user }), dataVersion: 0 });
};
const page = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

const CSR = { subject_cn: 'x', email: 'y', key_alg: 'ECDSA-P256', key_size: 256, pop_valid: true, extra_extensions: [], key_previously_used: false };
const checks = (failed: number[]) =>
  [1, 2, 3, 4, 5, 6].map((id) => ({ id, passed: !failed.includes(id), label_th: `ตรวจข้อที่ ${id}`, ref: 'L3' }));
const request = (id: string, failed: number[], state = 'awaitingInPerson') => ({
  id, requester: 'u-nattapon', state, kind: 'new', created_at: '2026-11-12T09:00:00+07:00', expires_at: '2026-11-26T09:00:00+07:00',
  csr: CSR, csr_checks: checks(failed), appointment: null,
});

const cert = (serial: string, over: Record<string, unknown> = {}) => ({
  serial, holder: 'u-somchai', subject: 'CN=สมชาย ใจดี', issuer_ca: 'doc-signing-2026', not_before: '2026-10-07T09:00:00+07:00',
  not_after: '2027-10-07T09:00:00+07:00', state: 'Active', revoked_at: null, revocation_reason: null, invalidity_date: null,
  superseded_by: null, days_left: 329, superseded: false, ...over,
});

const PEOPLE = [
  { id: 'u-somchai', display_name: 'สมชาย ใจดี', role: 'signer', email: 'a@lab.korakod.dev' },
  { id: 'u-nattapon', display_name: 'ณัฐพล ทองดี', role: 'new_user', email: 'b@lab.korakod.dev' },
  { id: 'a-admin-a', display_name: 'ผู้ดูแล A', role: 'admin-a', email: 'c@lab.korakod.dev' },
];

beforeEach(() => {
  localStorage.clear();
  Object.values(m).forEach((f) => f.mockReset());
  m.personas.mockResolvedValue(ok(PEOPLE));
  m.requestList.mockResolvedValue(ok([]));
  m.certList.mockResolvedValue(ok([]));
});

/** Types the demo MFA code into the open dialog and submits it. */
async function typeMfa(user: ReturnType<typeof userEvent.setup>, code = '246810') {
  const dialog = await screen.findByTestId(TID.mfa.dialog);
  await user.type(within(dialog).getByTestId(TID.mfa.input), code);
  await user.click(within(dialog).getByTestId(TID.mfa.submit));
}

describe('role gate (F15)', () => {
  it.each([
    ['guest', GUEST],
    ['signer', SOMCHAI],
    ['admin-b (read-only auditor, A12)', ADMIN_B],
  ])('/admin/requests and /admin/certs show the explanation to %s and load nothing', (_name, who) => {
    signIn(who);
    const a = page(<AdminRequestsPage />);
    expect(screen.getByTestId(TID.requireRole.mismatch)).toHaveAttribute('data-required-roles', 'admin-a');
    a.unmount();
    page(<AdminCertsPage />);
    expect(screen.getByTestId(TID.requireRole.mismatch)).toHaveAttribute('data-required-roles', 'admin-a');
    expect(m.requestList).not.toHaveBeenCalled();
    expect(m.certList).not.toHaveBeenCalled();
  });
});

describe('/admin/requests', () => {
  beforeEach(() => signIn(ADMIN_A));

  it('shows the six CSR checks with data-state and failed ones in red text "ไม่ผ่าน"', async () => {
    m.requestList.mockResolvedValue(ok([request('req-manop-01', [2, 4])]));
    page(<AdminRequestsPage />);
    const row = await screen.findByTestId(TID.adminRequests.row('req-manop-01'));
    expect(row).toHaveAttribute('data-state', 'awaitingInPerson');
    const states = [1, 2, 3, 4, 5, 6].map((n) => within(row).getByTestId(TID.adminRequests.csrCheck('req-manop-01', n)).getAttribute('data-state'));
    expect(states).toEqual(['passed', 'failed', 'passed', 'failed', 'passed', 'passed']);
  });

  it('has exactly five checkboxes and no other data inputs (spec section 5: no ID number / photo / laser code)', async () => {
    m.requestList.mockResolvedValue(ok([request('req-1', [])]));
    page(<AdminRequestsPage />);
    const row = await screen.findByTestId(TID.adminRequests.row('req-1'));
    const inputs = Array.from(row.querySelectorAll('input, textarea, select'));
    expect(inputs).toHaveLength(5);
    expect(inputs.every((i) => (i as HTMLInputElement).type === 'checkbox')).toBe(true);
    expect(row.querySelector('input[type="file"]')).toBeNull();
  });

  it('approve stays disabled until all five boxes are ticked', async () => {
    m.requestList.mockResolvedValue(ok([request('req-1', [])]));
    const user = userEvent.setup();
    page(<AdminRequestsPage />);
    const approve = await screen.findByTestId(TID.adminRequests.approve('req-1'));
    expect(approve).toBeDisabled();
    for (let n = 1; n <= 4; n++) await user.click(screen.getByTestId(TID.adminRequests.checklist('req-1', n)));
    expect(approve).toBeDisabled(); // 4 of 5
    await user.click(screen.getByTestId(TID.adminRequests.checklist('req-1', 5)));
    expect(approve).toBeEnabled();
    await user.click(screen.getByTestId(TID.adminRequests.checklist('req-1', 3))); // untick one again
    expect(approve).toBeDisabled();
  });

  it('approve stays disabled when a CSR check failed, even with all five boxes ticked', async () => {
    m.requestList.mockResolvedValue(ok([request('req-manop-01', [2, 4])]));
    const user = userEvent.setup();
    page(<AdminRequestsPage />);
    await screen.findByTestId(TID.adminRequests.row('req-manop-01'));
    for (let n = 1; n <= 5; n++) await user.click(screen.getByTestId(TID.adminRequests.checklist('req-manop-01', n)));
    expect(screen.getByTestId(TID.adminRequests.approve('req-manop-01'))).toBeDisabled();
    expect(screen.getByText(/CSR ไม่ผ่านการตรวจ จึงอนุมัติไม่ได้/)).toBeInTheDocument();
  });

  it('approve asks for MFA and sends the ticks with the X-Demo-MFA code', async () => {
    m.requestList.mockResolvedValue(ok([request('req-1', [])]));
    m.approve.mockResolvedValue(ok({ ...request('req-1', []), state: 'approved' }));
    const user = userEvent.setup();
    page(<AdminRequestsPage />);
    await screen.findByTestId(TID.adminRequests.row('req-1'));
    for (let n = 1; n <= 5; n++) await user.click(screen.getByTestId(TID.adminRequests.checklist('req-1', n)));
    await user.click(screen.getByTestId(TID.adminRequests.approve('req-1')));
    expect(m.approve).not.toHaveBeenCalled(); // nothing is sent before the code is typed
    await typeMfa(user);
    expect(m.approve).toHaveBeenCalledWith('req-1', { checklist: [true, true, true, true, true] }, '246810');
    expect(await screen.findByText(/อนุมัติคำขอ req-1 แล้ว/)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.mfa.dialog)).toBeNull();
  });

  it('a wrong MFA code keeps the dialog open with the error', async () => {
    m.requestList.mockResolvedValue(ok([request('req-1', [])]));
    m.approve.mockResolvedValue({ ok: false, error: { status: 403, code: 'MFA_INVALID', title: 'Forbidden', detail: 'รหัส MFA ไม่ถูกต้อง', problem: null } });
    const user = userEvent.setup();
    page(<AdminRequestsPage />);
    await screen.findByTestId(TID.adminRequests.row('req-1'));
    for (let n = 1; n <= 5; n++) await user.click(screen.getByTestId(TID.adminRequests.checklist('req-1', n)));
    await user.click(screen.getByTestId(TID.adminRequests.approve('req-1')));
    await typeMfa(user, '000000');
    expect(await screen.findByText('รหัส MFA ไม่ถูกต้อง')).toBeInTheDocument();
    expect(screen.getByTestId(TID.mfa.dialog)).toBeInTheDocument();
  });

  it('reject sends reason + note with the MFA code (M3)', async () => {
    m.requestList.mockResolvedValue(ok([request('req-manop-01', [2, 4])]));
    m.reject.mockResolvedValue(ok({ ...request('req-manop-01', [2, 4]), state: 'rejected' }));
    const user = userEvent.setup();
    page(<AdminRequestsPage />);
    await user.click(await screen.findByTestId(TID.adminRequests.reject('req-manop-01')));
    await user.selectOptions(screen.getByTestId(TID.adminRequests.rejectReason), 'identity_mismatch');
    await user.type(screen.getByTestId(TID.adminRequests.rejectNote), 'ชื่อในคำขอไม่ตรง');
    await user.click(screen.getByTestId(TID.adminRequests.rejectSubmit));
    expect(m.reject).not.toHaveBeenCalled();
    await typeMfa(user);
    expect(m.reject).toHaveBeenCalledWith('req-manop-01', { reason_code: 'identity_mismatch', note: 'ชื่อในคำขอไม่ตรง' }, '246810');
  });

  it('decided requests show no checklist and no buttons', async () => {
    m.requestList.mockResolvedValue(ok([request('req-9', [], 'rejected')]));
    page(<AdminRequestsPage />);
    const row = await screen.findByTestId(TID.adminRequests.row('req-9'));
    expect(row).toHaveAttribute('data-state', 'rejected');
    expect(screen.queryByTestId(TID.adminRequests.approve('req-9'))).toBeNull();
    expect(screen.queryByTestId(TID.adminRequests.reject('req-9'))).toBeNull();
  });
});

describe('/admin/certs', () => {
  beforeEach(() => signIn(ADMIN_A));

  it('revoke offers all six reasons and the invalidity date; MFA is asked and the header is sent', async () => {
    m.certList.mockResolvedValue(ok([cert('DE:M0:4F:2A:91:01')]));
    m.revoke.mockResolvedValue(ok(cert('DE:M0:4F:2A:91:01', { state: 'Revoked' })));
    const user = userEvent.setup();
    page(<AdminCertsPage />);
    await user.click(await screen.findByTestId(TID.adminCerts.revoke('DE:M0:4F:2A:91:01')));

    const select = screen.getByTestId(TID.certs.revokeReason);
    expect(within(select).getAllByRole('option')).toHaveLength(7); // placeholder + 6 reasons
    await user.selectOptions(select, 'keyCompromise');
    await user.type(screen.getByTestId(TID.certs.revokeInvalidity), '2026-10-15T09:00');
    await user.click(screen.getByTestId(TID.certs.revokeSubmit));
    expect(m.revoke).not.toHaveBeenCalled();
    await typeMfa(user);
    expect(m.revoke).toHaveBeenCalledWith(
      'DE:M0:4F:2A:91:01',
      { reason: 'keyCompromise', invalidity_date: '2026-10-15T09:00:00+07:00' },
      '246810',
    );
  });

  it('revoke without an invalidity date sends none', async () => {
    m.certList.mockResolvedValue(ok([cert('DE:M0:4F:2A:91:01')]));
    m.revoke.mockResolvedValue(ok(cert('DE:M0:4F:2A:91:01', { state: 'Revoked' })));
    const user = userEvent.setup();
    page(<AdminCertsPage />);
    await user.click(await screen.findByTestId(TID.adminCerts.revoke('DE:M0:4F:2A:91:01')));
    await user.selectOptions(screen.getByTestId(TID.certs.revokeReason), 'superseded');
    await user.click(screen.getByTestId(TID.certs.revokeSubmit));
    await typeMfa(user);
    expect(m.revoke).toHaveBeenCalledWith('DE:M0:4F:2A:91:01', { reason: 'superseded' }, '246810');
  });

  it('shows data-state on rows and offers revoke only for live certificates', async () => {
    m.certList.mockResolvedValue(ok([cert('A', { state: 'Active' }), cert('B', { state: 'Revoked', revoked_at: '2026-10-05T10:00:00+07:00', revocation_reason: 'superseded', superseded: true })]));
    page(<AdminCertsPage />);
    expect(await screen.findByTestId(TID.adminCerts.row('A'))).toHaveAttribute('data-state', 'Active');
    expect(screen.getByTestId(TID.adminCerts.row('B'))).toHaveAttribute('data-state', 'Revoked');
    expect(screen.getByTestId(TID.adminCerts.revoke('A'))).toBeInTheDocument();
    expect(screen.queryByTestId(TID.adminCerts.revoke('B'))).toBeNull();
  });

  it('close account asks for MFA and calls closeAccount; admins cannot be closed', async () => {
    m.closeAccount.mockResolvedValue(ok({ revoked: ['DE:M0:4F:2A:91:01'] }));
    const user = userEvent.setup();
    page(<AdminCertsPage />);
    await screen.findByTestId(TID.adminCerts.closeAccount('u-somchai'));
    expect(screen.queryByTestId(TID.adminCerts.closeAccount('a-admin-a'))).toBeNull();
    await user.click(screen.getByTestId(TID.adminCerts.closeAccount('u-somchai')));
    expect(m.closeAccount).not.toHaveBeenCalled();
    await typeMfa(user);
    expect(m.closeAccount).toHaveBeenCalledWith('u-somchai', '246810');
    await waitFor(() => expect(screen.getByText(/ปิดบัญชีของ สมชาย ใจดี แล้ว/)).toBeInTheDocument());
  });
});
