// Component tests for /certs/request and /certs (sub-task F). The API is mocked; the store is the real one.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { TID } from '../../../contracts/testids';
import { ok, PERSONAS, status, toUser } from '../../../store/__tests__/fakes';

const m = vi.hoisted(() => ({
  appointments: vi.fn(),
  create: vi.fn(),
  requestList: vi.fn(),
  certList: vi.fn(),
  renew: vi.fn(),
  finalize: vi.fn(),
  revoke: vi.fn(),
  keygen: vi.fn(),
  workstation: vi.fn(),
  demoStatus: vi.fn(),
}));

vi.mock('../../../api', () => ({
  configureApi: vi.fn(),
  api: {
    certRequests: { appointments: m.appointments, create: m.create, list: m.requestList },
    certs: { list: m.certList, renew: m.renew, finalize: m.finalize, revoke: m.revoke },
  },
  demoApi: { keygen: m.keygen, workstation: m.workstation, status: m.demoStatus },
}));

import { useAppStore } from '../../../store';
import { setLatestCsr } from '../../../terminal/commands/pkiTool';
import { CertRequestPage } from '../../CertRequestPage';
import { MyCertsPage } from '../../MyCertsPage';

const [SOMCHAI, NATTAPON, , GUEST, ADMIN_A] = PERSONAS.map(toUser) as [
  ReturnType<typeof toUser>, ReturnType<typeof toUser>, ReturnType<typeof toUser>, ReturnType<typeof toUser>, ReturnType<typeof toUser>,
];

// The store's status refresh asks the (mocked) server who the token belongs to, so the mock must answer with the same persona.
const signIn = (user: ReturnType<typeof toUser>) => {
  m.demoStatus.mockResolvedValue(ok(status({ actor: user })));
  useAppStore.setState({ token: 't', user, demo: status({ actor: user }), dataVersion: 0 });
};
const page = (el: React.ReactElement) => render(<MemoryRouter>{el}</MemoryRouter>);

const SLOTS = [
  { id: 'slot-20261113', at: '2026-11-13T10:00:00+07:00', location_th: 'จุดพบตัวสมมติ ห้อง A (DEMO)' },
  { id: 'slot-20261114', at: '2026-11-14T10:00:00+07:00', location_th: 'จุดพบตัวสมมติ ห้อง A (DEMO)' },
];
const CSR = { subject_cn: 'ณัฐพล ทองดี', email: 'nattapon@lab.korakod.dev', key_alg: 'ECDSA-P256', key_size: 256, pop_valid: true, extra_extensions: [], key_previously_used: false };
const REQUEST = {
  id: 'req-0001', requester: 'u-nattapon', state: 'awaitingInPerson', kind: 'new', created_at: '2026-11-12T09:00:00+07:00',
  expires_at: '2026-11-26T09:00:00+07:00', csr: CSR, csr_checks: [], appointment: SLOTS[1],
};

const cert = (over: Record<string, unknown>) => ({
  serial: 'DE:M0:4F:2A:91:01', holder: 'u-somchai', subject: 'CN=สมชาย ใจดี', issuer_ca: 'doc-signing-2026',
  not_before: '2026-10-07T09:00:00+07:00', not_after: '2027-10-07T09:00:00+07:00', state: 'Active',
  revoked_at: null, revocation_reason: null, invalidity_date: null, superseded_by: null, days_left: 329, superseded: false, ...over,
});

beforeEach(() => {
  localStorage.clear();
  Object.values(m).forEach((f) => f.mockReset());
  setLatestCsr(null);
  m.demoStatus.mockResolvedValue(ok(status()));
  m.appointments.mockResolvedValue(ok(SLOTS));
  m.requestList.mockResolvedValue(ok([]));
  m.certList.mockResolvedValue(ok([]));
  m.workstation.mockResolvedValue(ok({ documents: [], private_ca: [] }));
});

describe('/certs/request', () => {
  it('shows the role explanation (F15) to a persona that cannot request certificates', async () => {
    signIn(GUEST);
    page(<CertRequestPage />);
    expect(screen.getByTestId(TID.requireRole.mismatch)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.terminal.root)).toBeNull();
    expect(m.appointments).not.toHaveBeenCalled();
  });

  it('the "รัน pki-tool init" button runs the example command in the terminal (spec 7.6 no. 5) and asks for the passphrase', async () => {
    signIn(NATTAPON);
    const user = userEvent.setup();
    page(<CertRequestPage />);
    await user.click(await screen.findByTestId(TID.request.runInit));
    const output = screen.getByTestId(TID.terminal.output);
    expect(output).toHaveTextContent(`$ pki-tool init --name "${NATTAPON.display_name}" --email ${NATTAPON.email}`);
    // pki-tool init asks for the (secret) passphrase next: the input becomes a masked field.
    await waitFor(() => expect(screen.getByTestId(TID.terminal.input)).toHaveAttribute('type', 'password'));
  });

  it('keeps "ส่งคำขอ" disabled until there is a CSR and an appointment, then submits the CSR from the terminal', async () => {
    signIn(NATTAPON);
    m.create.mockResolvedValue(ok(REQUEST, 201));
    const user = userEvent.setup();
    page(<CertRequestPage />);

    expect(await screen.findByTestId(TID.terminal.root)).toBeInTheDocument();
    const submit = screen.getByTestId(TID.request.submit);
    expect(submit).toBeDisabled();
    expect(screen.getByText(/ยังไม่มี CSR/)).toBeInTheDocument();

    // What `pki-tool init` does when it finishes.
    act(() => setLatestCsr({ persona: 'u-nattapon', name: 'ณัฐพล ทองดี', email: 'nattapon@lab.korakod.dev', csr_pem: 'PEM-1', csr: CSR as never }));
    expect(await screen.findByText('PEM-1')).toBeInTheDocument();
    expect(submit).toBeDisabled(); // no appointment yet

    await user.selectOptions(screen.getByTestId(TID.request.appointmentSelect), 'slot-20261114');
    expect(submit).toBeEnabled();

    m.requestList.mockResolvedValue(ok([REQUEST]));
    await user.click(submit);
    expect(m.create).toHaveBeenCalledWith({ csr_pem: 'PEM-1', appointment_id: 'slot-20261114' });

    const statusBox = await screen.findByTestId(TID.request.status);
    expect(statusBox).toHaveAttribute('data-state', 'awaitingInPerson');
    // A pending request replaces the form (the engine allows only one).
    expect(screen.queryByTestId(TID.request.submit)).toBeNull();
  });

  it('ignores a CSR that was created by another persona', async () => {
    signIn(NATTAPON);
    page(<CertRequestPage />);
    await screen.findByTestId(TID.terminal.root);
    act(() => setLatestCsr({ persona: 'u-somchai', name: 'x', email: 'y', csr_pem: 'OTHER-PEM', csr: CSR as never }));
    expect(screen.queryByText('OTHER-PEM')).toBeNull();
    expect(screen.getByTestId(TID.request.submit)).toBeDisabled();
  });

  it('shows the engine problem when the request is refused', async () => {
    signIn(NATTAPON);
    m.create.mockResolvedValue({ ok: false, error: { status: 409, code: 'INVALID_STATE', title: 'Conflict', detail: 'คุณมีใบรับรองที่ใช้งานอยู่แล้ว', problem: null } });
    const user = userEvent.setup();
    page(<CertRequestPage />);
    await screen.findByTestId(TID.terminal.root);
    act(() => setLatestCsr({ persona: 'u-nattapon', name: 'n', email: 'e', csr_pem: 'PEM-2', csr: CSR as never }));
    await user.selectOptions(screen.getByTestId(TID.request.appointmentSelect), 'slot-20261113');
    await user.click(screen.getByTestId(TID.request.submit));
    expect(await screen.findByRole('alert')).toHaveTextContent('คุณมีใบรับรองที่ใช้งานอยู่แล้ว');
  });

  it('explains the next step for an approved request and links to /certs', async () => {
    signIn(NATTAPON);
    m.requestList.mockResolvedValue(ok([{ ...REQUEST, state: 'approved' }]));
    page(<CertRequestPage />);
    const box = await screen.findByTestId(TID.request.status);
    expect(box).toHaveAttribute('data-state', 'approved');
    expect(within(box).getByRole('link', { name: 'ไปที่ใบรับรองของฉัน' })).toHaveAttribute('href', '/certs');
  });
});

describe('/certs', () => {
  it('shows the role explanation (F15) to an admin', () => {
    signIn(ADMIN_A);
    page(<MyCertsPage />);
    expect(screen.getByTestId(TID.requireRole.mismatch)).toBeInTheDocument();
    expect(m.certList).not.toHaveBeenCalled();
  });

  it('lists certificates with data-state, only the buttons that fit the state, and a .txt download', async () => {
    signIn(SOMCHAI);
    m.certList.mockResolvedValue(
      ok([
        cert({ serial: 'DE:M0:A0:00:00:01', state: 'Issued' }),
        cert({ serial: 'DE:M0:4F:2A:91:01', state: 'Active' }),
        cert({ serial: 'DE:M0:4F:2A:91:00', state: 'Revoked', revoked_at: '2026-10-05T10:00:00+07:00', revocation_reason: 'superseded', superseded: true }),
        cert({ serial: 'DE:M0:4F:2A:90:99', state: 'Expired' }),
      ]),
    );
    page(<MyCertsPage />);

    const issued = await screen.findByTestId(TID.certs.row('DE:M0:A0:00:00:01'));
    expect(issued).toHaveAttribute('data-state', 'Issued');
    expect(within(issued).getByTestId(TID.certs.finalize('DE:M0:A0:00:00:01'))).toBeInTheDocument();
    expect(within(issued).queryByTestId(TID.certs.renew('DE:M0:A0:00:00:01'))).toBeNull();

    const active = screen.getByTestId(TID.certs.row('DE:M0:4F:2A:91:01'));
    expect(within(active).getByTestId(TID.certs.renew('DE:M0:4F:2A:91:01'))).toBeInTheDocument();
    expect(within(active).getByTestId(TID.certs.revoke('DE:M0:4F:2A:91:01'))).toBeInTheDocument();
    expect(within(active).queryByTestId(TID.certs.finalize('DE:M0:4F:2A:91:01'))).toBeNull();

    // Revoked + superseded keeps data-state "Revoked" but is labelled "superseded" (A10); no action buttons.
    const old = screen.getByTestId(TID.certs.row('DE:M0:4F:2A:91:00'));
    expect(old).toHaveAttribute('data-state', 'Revoked');
    expect(old).toHaveAttribute('data-superseded', 'true');
    expect(old).toHaveTextContent('superseded');
    expect(within(old).queryByTestId(TID.certs.revoke('DE:M0:4F:2A:91:00'))).toBeNull();

    expect(screen.getByTestId(TID.certs.download('DE:M0:4F:2A:91:01'))).toHaveAttribute('data-file-name', 'DEMO-certificate.txt');
  });

  it('finalize calls the API for that serial and reloads', async () => {
    signIn(SOMCHAI);
    m.certList.mockResolvedValue(ok([cert({ serial: 'DE:M0:A0:00:00:01', state: 'Issued' })]));
    m.finalize.mockResolvedValue(ok(cert({ serial: 'DE:M0:A0:00:00:01', state: 'Active' })));
    page(<MyCertsPage />);
    await userEvent.setup().click(await screen.findByTestId(TID.certs.finalize('DE:M0:A0:00:00:01')));
    expect(m.finalize).toHaveBeenCalledWith('DE:M0:A0:00:00:01');
    expect(await screen.findByText(/ยืนยันติดตั้งแล้ว/)).toBeInTheDocument();
    await waitFor(() => expect(m.certList).toHaveBeenCalledTimes(2));
  });

  it('the explanation block names the main-spec refs (F29: shared two-layer renderer)', async () => {
    signIn(SOMCHAI);
    m.certList.mockResolvedValue(ok([]));
    page(<MyCertsPage />);
    expect(await screen.findByTestId('content-refs')).toHaveTextContent('L4');
  });

  it('renew generates a new key (keygen) and then sends only the CSR to the renew endpoint', async () => {
    signIn(SOMCHAI);
    m.certList.mockResolvedValue(ok([cert({ serial: 'DE:M0:22:91:AF:03' })]));
    m.keygen.mockResolvedValue(ok({ csr_pem: 'NEW-PEM', csr: CSR }));
    m.renew.mockResolvedValue(ok({ ...REQUEST, kind: 'renewal', state: 'approved' }, 201));
    page(<MyCertsPage />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId(TID.certs.renew('DE:M0:22:91:AF:03')));
    // F27: the button asks the new key's passphrase first (secret input); nothing is generated or sent before it is accepted.
    const input = await screen.findByTestId(TID.certs.passphraseInput);
    expect(input).toHaveAttribute('type', 'password');
    expect(m.keygen).not.toHaveBeenCalled();
    await user.type(input, 'elevenchar1');
    await user.click(screen.getByTestId(TID.certs.passphraseSubmit));
    expect(await screen.findByTestId(TID.certs.passphraseError)).toHaveTextContent('อย่างน้อย 12');
    expect(m.keygen).not.toHaveBeenCalled();
    await user.clear(input);
    await user.type(input, 'twelve-chars-or-more!');
    await user.click(screen.getByTestId(TID.certs.passphraseSubmit));
    await waitFor(() => expect(m.renew).toHaveBeenCalled());
    expect(m.keygen).toHaveBeenCalledWith({ name: 'สมชาย ใจดี', email: 'u-somchai@lab.korakod.dev' });
    expect(m.renew).toHaveBeenCalledWith('DE:M0:22:91:AF:03', { csr_pem: 'NEW-PEM' });
    // The passphrase is only measured: it appears in no API call.
    expect(JSON.stringify([m.keygen.mock.calls, m.renew.mock.calls])).not.toContain('twelve-chars-or-more!');
    expect(await screen.findByText(/พบตัวไม่เกิน 3 ปีจึงอนุมัติอัตโนมัติ/)).toBeInTheDocument();
  });

  it('cancelling the renew passphrase dialog renews nothing (F27)', async () => {
    signIn(SOMCHAI);
    m.certList.mockResolvedValue(ok([cert({ serial: 'DE:M0:22:91:AF:03' })]));
    const user = userEvent.setup();
    page(<MyCertsPage />);
    await user.click(await screen.findByTestId(TID.certs.renew('DE:M0:22:91:AF:03')));
    await user.click(await screen.findByRole('button', { name: 'ยกเลิก' }));
    expect(screen.queryByTestId(TID.certs.passphraseDialog)).toBeNull();
    expect(m.keygen).not.toHaveBeenCalled();
    expect(m.renew).not.toHaveBeenCalled();
  });

  it('self-revocation offers exactly the 3 user reasons, no invalidity date, and sends no MFA', async () => {
    signIn(SOMCHAI);
    m.certList.mockResolvedValue(ok([cert({})]));
    m.revoke.mockResolvedValue(ok(cert({ state: 'Revoked', revocation_reason: 'cessationOfOperation' })));
    const user = userEvent.setup();
    page(<MyCertsPage />);
    await user.click(await screen.findByTestId(TID.certs.revoke('DE:M0:4F:2A:91:01')));

    const select = screen.getByTestId(TID.certs.revokeReason);
    const values = within(select).getAllByRole('option').map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(['', 'keyCompromise', 'affiliationChanged', 'cessationOfOperation']);
    expect(screen.queryByTestId(TID.certs.revokeInvalidity)).toBeNull();
    expect(screen.getByTestId(TID.certs.revokeSubmit)).toBeDisabled(); // a reason must be chosen first

    await user.selectOptions(select, 'cessationOfOperation');
    await user.click(screen.getByTestId(TID.certs.revokeSubmit));
    expect(m.revoke).toHaveBeenCalledTimes(1);
    expect(m.revoke.mock.calls[0]).toEqual(['DE:M0:4F:2A:91:01', { reason: 'cessationOfOperation' }]); // no third (MFA) argument
    expect(await screen.findByText(/เพิกถอนใบ DE:M0:4F:2A:91:01 แล้ว/)).toBeInTheDocument();
  });

  it('shows the problem inside the dialog when revocation fails', async () => {
    signIn(SOMCHAI);
    m.certList.mockResolvedValue(ok([cert({})]));
    m.revoke.mockResolvedValue({ ok: false, error: { status: 409, code: 'INVALID_STATE', title: 'Conflict', detail: 'เพิกถอนได้เฉพาะใบที่ Active', problem: null } });
    const user = userEvent.setup();
    page(<MyCertsPage />);
    await user.click(await screen.findByTestId(TID.certs.revoke('DE:M0:4F:2A:91:01')));
    await user.selectOptions(screen.getByTestId(TID.certs.revokeReason), 'keyCompromise');
    await user.click(screen.getByTestId(TID.certs.revokeSubmit));
    expect(await screen.findByText('เพิกถอนได้เฉพาะใบที่ Active')).toBeInTheDocument();
    expect(screen.getByTestId(TID.certs.revokeReason)).toBeInTheDocument(); // dialog stays open
  });
});
