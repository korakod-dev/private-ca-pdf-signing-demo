// Component tests for /login (two steps, lockout message) and /mailbox (QA F13: one fetch per visit, also in StrictMode).
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { TID } from '../../../contracts/testids';
import { ok, PERSONAS, status, toUser } from '../../../store/__tests__/fakes';

const m = vi.hoisted(() => ({ login: vi.fn(), mfa: vi.fn(), logout: vi.fn(), personas: vi.fn(), mailbox: vi.fn(), demoStatus: vi.fn() }));

vi.mock('../../../api', () => ({
  configureApi: vi.fn(),
  api: { auth: { login: m.login, mfa: m.mfa, logout: m.logout } },
  demoApi: { personas: m.personas, mailbox: m.mailbox, status: m.demoStatus },
}));

import { useAppStore } from '../../../store';
import { LoginPage } from '../../LoginPage';
import { MailboxPage } from '../../MailboxPage';

const [SOMCHAI, NATTAPON] = PERSONAS.map(toUser) as [ReturnType<typeof toUser>, ReturnType<typeof toUser>];

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

beforeEach(() => {
  localStorage.clear();
  Object.values(m).forEach((f) => f.mockReset());
  m.personas.mockResolvedValue(ok(PERSONAS));
  m.demoStatus.mockResolvedValue(ok(status()));
  useAppStore.setState({ token: null, user: null, demo: status(), dataVersion: 0 });
});

describe('/login', () => {
  const renderLogin = () =>
    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
        <Where />
      </MemoryRouter>,
    );

  it('shows the demo password and MFA code and the accounts', async () => {
    renderLogin();
    const box = screen.getByTestId(TID.login.demoCreds);
    expect(box).toHaveTextContent('demo-password');
    expect(box).toHaveTextContent('246810');
    expect(await screen.findByText(/u-somchai@lab\.korakod\.dev/)).toBeInTheDocument();
  });

  it('two steps: password -> MFA code -> session stored and the persona home opens', async () => {
    m.login.mockResolvedValue(ok({ mfa_ticket: 'mfa-1' }));
    m.mfa.mockResolvedValue(ok({ token: 'demo-token-1', user: SOMCHAI }));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByTestId(TID.login.email), 'somchai@lab.korakod.dev');
    await user.type(screen.getByTestId(TID.login.password), 'demo-password');
    await user.click(screen.getByTestId(TID.login.submit));
    expect(m.login).toHaveBeenCalledWith({ email: 'somchai@lab.korakod.dev', password: 'demo-password' });

    // Step 2 replaces step 1 and the password field is gone.
    await user.type(await screen.findByTestId(TID.login.mfaInput), '246810');
    expect(screen.queryByTestId(TID.login.password)).toBeNull();
    await user.click(screen.getByTestId(TID.login.mfaSubmit));
    expect(m.mfa).toHaveBeenCalledWith({ mfa_ticket: 'mfa-1', code: '246810' });

    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/certs'));
    expect(useAppStore.getState().token).toBe('demo-token-1');
    expect(useAppStore.getState().user?.id).toBe('u-somchai');
  });

  it('a new user lands on /certs/request (role home)', async () => {
    m.login.mockResolvedValue(ok({ mfa_ticket: 'mfa-2' }));
    m.mfa.mockResolvedValue(ok({ token: 'demo-token-2', user: NATTAPON }));
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByTestId(TID.login.email), 'nattapon@lab.korakod.dev');
    await user.type(screen.getByTestId(TID.login.password), 'demo-password');
    await user.click(screen.getByTestId(TID.login.submit));
    await user.type(await screen.findByTestId(TID.login.mfaInput), '246810');
    await user.click(screen.getByTestId(TID.login.mfaSubmit));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/certs/request'));
  });

  it('wrong password shows a Thai error and stays on step 1', async () => {
    m.login.mockResolvedValue({ ok: false, error: { status: 401, code: 'INVALID_CREDENTIALS', title: 'Unauthorized', detail: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง', problem: null } });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByTestId(TID.login.email), 'somchai@lab.korakod.dev');
    await user.type(screen.getByTestId(TID.login.password), 'wrong');
    await user.click(screen.getByTestId(TID.login.submit));
    expect(await screen.findByText('อีเมลหรือรหัสผ่านไม่ถูกต้อง')).toBeInTheDocument();
    expect(screen.getByTestId(TID.login.password)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.login.lockMessage)).toBeNull();
  });

  it('lockout: shows the lock message with the simulated unlock time', async () => {
    m.login.mockResolvedValue({
      ok: false,
      error: { status: 423, code: 'ACCOUNT_LOCKED', title: 'Locked', locked_until: '2026-11-12T09:05:00+07:00', retry_after_s: 300, problem: null },
    });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByTestId(TID.login.email), 'somchai@lab.korakod.dev');
    await user.type(screen.getByTestId(TID.login.password), 'wrong');
    await user.click(screen.getByTestId(TID.login.submit));
    const lock = await screen.findByTestId(TID.login.lockMessage);
    expect(lock).toHaveTextContent('2026-11-12 09:05:00 +07:00');
    expect(lock).toHaveTextContent('เวลาจำลอง');
  });

  it('a wrong MFA code shows the error and keeps step 2', async () => {
    m.login.mockResolvedValue(ok({ mfa_ticket: 'mfa-3' }));
    m.mfa.mockResolvedValue({ ok: false, error: { status: 401, code: 'MFA_INVALID', title: 'Unauthorized', detail: 'รหัส MFA ไม่ถูกต้อง', problem: null } });
    const user = userEvent.setup();
    renderLogin();
    await user.type(screen.getByTestId(TID.login.email), 'somchai@lab.korakod.dev');
    await user.type(screen.getByTestId(TID.login.password), 'demo-password');
    await user.click(screen.getByTestId(TID.login.submit));
    await user.type(await screen.findByTestId(TID.login.mfaInput), '111111');
    await user.click(screen.getByTestId(TID.login.mfaSubmit));
    expect(await screen.findByText('รหัส MFA ไม่ถูกต้อง')).toBeInTheDocument();
    expect(useAppStore.getState().token).toBeNull();
  });
});

describe('/mailbox (F13)', () => {
  const MAIL = [
    { id: 'mail-2', to: 'u-somchai', at: '2026-11-12T08:00:00+07:00', kind: 'approved', subject_th: 'ใบรับรองของคุณได้รับอนุมัติแล้ว', body_th: 'เนื้อหาจดหมายฉบับที่สอง', read: false },
    { id: 'mail-1', to: 'u-somchai', at: '2026-11-03T08:00:00+07:00', kind: 'expiry_notice', subject_th: 'ใกล้หมดอายุ', body_th: 'เนื้อหาฉบับแรก', read: true },
  ];

  beforeEach(() => {
    useAppStore.setState({ token: 't', user: SOMCHAI, demo: status({ actor: SOMCHAI }), dataVersion: 0 });
    m.demoStatus.mockResolvedValue(ok(status({ actor: SOMCHAI })));
  });

  it('fetches ONCE under StrictMode (double effects) and keeps the unread flag from the first response', async () => {
    m.mailbox.mockResolvedValue(ok(MAIL));
    render(
      <StrictMode>
        <MemoryRouter>
          <MailboxPage />
        </MemoryRouter>
      </StrictMode>,
    );
    const first = await screen.findByTestId(TID.mailbox.message(0));
    expect(m.mailbox).toHaveBeenCalledTimes(1);
    expect(first).toHaveAttribute('data-read', 'false');
    expect(first).toHaveTextContent('ใหม่');
    expect(screen.getByTestId(TID.mailbox.message(1))).toHaveAttribute('data-read', 'true');
  });

  it('does not fetch again on re-render or a data refresh, and a real engine-like second answer cannot erase "unread"', async () => {
    // First call: unread. A second call (what a naive refetch would do) would answer read:true.
    m.mailbox.mockResolvedValueOnce(ok(MAIL)).mockResolvedValue(ok(MAIL.map((x) => ({ ...x, read: true }))));
    const { rerender } = render(
      <MemoryRouter>
        <MailboxPage />
      </MemoryRouter>,
    );
    await screen.findByTestId(TID.mailbox.message(0));
    useAppStore.getState().bumpDataVersion();
    rerender(
      <MemoryRouter>
        <MailboxPage />
      </MemoryRouter>,
    );
    expect(m.mailbox).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(TID.mailbox.message(0))).toHaveAttribute('data-read', 'false');
  });

  it('list + detail: the newest message is open first and a click opens another', async () => {
    m.mailbox.mockResolvedValue(ok(MAIL));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <MailboxPage />
      </MemoryRouter>,
    );
    await screen.findByTestId(TID.mailbox.list);
    expect(screen.getByText('เนื้อหาจดหมายฉบับที่สอง')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /ใกล้หมดอายุ/ }));
    expect(screen.getByText('เนื้อหาฉบับแรก')).toBeInTheDocument();
  });

  it('asks the signed-out visitor to pick a persona and makes no request', () => {
    useAppStore.setState({ token: null, user: null, demo: status(), dataVersion: 0 });
    render(
      <MemoryRouter>
        <MailboxPage />
      </MemoryRouter>,
    );
    expect(screen.getByText(/ยังไม่ได้เลือกบทบาท/)).toBeInTheDocument();
    expect(m.mailbox).not.toHaveBeenCalled();
  });

  it('refreshes the demo status after loading so the unread badge drops', async () => {
    m.mailbox.mockResolvedValue(ok(MAIL));
    render(
      <MemoryRouter>
        <MailboxPage />
      </MemoryRouter>,
    );
    await screen.findByTestId(TID.mailbox.list);
    await waitFor(() => expect(m.demoStatus).toHaveBeenCalled());
  });
});
