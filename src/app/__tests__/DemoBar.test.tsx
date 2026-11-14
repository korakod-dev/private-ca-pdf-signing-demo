// Demo bar tests (API mocked with vi.mock): banner not dismissible, F9 pinned classes, persona -> route map,
// exact durations sent, fault toggles, reset needs confirmation, polling, menu toggle, "try login yourself".
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { ADVANCE_DURATIONS } from '../../contracts/api';
import { ROLE_HOME } from '../../contracts/routes';
import { TID } from '../../contracts/testids';
import { DEMO_BANNER_TEXT } from '../../config/demo';
import { PERSONAS, fail, ok, status, toUser } from '../../store/__tests__/fakes';

const mocks = vi.hoisted(() => ({
  configureApi: vi.fn(),
  status: vi.fn(),
  personas: vi.fn(),
  switchPersona: vi.fn(),
  setClock: vi.fn(),
  setFaults: vi.fn(),
  reset: vi.fn(),
  logout: vi.fn(),
}));
vi.mock('../../api', () => ({
  configureApi: mocks.configureApi,
  api: { auth: { logout: mocks.logout } },
  demoApi: {
    status: mocks.status,
    personas: mocks.personas,
    switchPersona: mocks.switchPersona,
    setClock: mocks.setClock,
    setFaults: mocks.setFaults,
    reset: mocks.reset,
  },
}));

import { useAppStore } from '../../store';
import { DemoBar, STATUS_POLL_MS } from '../DemoBar';
import { Layout } from '../Layout';

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderBar() {
  return render(
    <MemoryRouter initialEntries={['/verify']}>
      <DemoBar />
      <Where />
    </MemoryRouter>,
  );
}

/** What the fake server currently reports; tests change it to mimic a real backend that remembers state. */
let server = status();

beforeEach(() => {
  localStorage.clear();
  Object.values(mocks).forEach((m) => m.mockReset());
  server = status();
  mocks.status.mockImplementation(async () => ok(server));
  mocks.personas.mockResolvedValue(ok(PERSONAS));
  mocks.logout.mockResolvedValue(ok(null, 204));
  useAppStore.setState({ token: null, user: null, demo: null, dataVersion: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('banner (spec section 5)', () => {
  it('shows the notice and has no close control inside it', async () => {
    renderBar();
    const banner = screen.getByTestId(TID.demoBar.banner);
    expect(banner).toHaveTextContent(DEMO_BANNER_TEXT);
    expect(within(banner).queryAllByRole('button')).toHaveLength(0);
    // Nothing anywhere in the bar offers to close/dismiss/hide the notice.
    const bar = screen.getByTestId(TID.demoBar.root);
    expect(within(bar).queryByRole('button', { name: /ปิด|close|dismiss/i })).toBeNull();
    await screen.findByText('2026-11-12 09:00:00 +07:00'); // let the initial status settle
  });
});

describe('F9: the bar stays pinned to the top on long pages', () => {
  it('uses sticky top-0 z-50 and an opaque background', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/" element={<div style={{ height: 5000 }}>long page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    const bar = screen.getByTestId(TID.demoBar.root);
    expect(bar.tagName).toBe('HEADER');
    const classes = bar.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['sticky', 'top-0', 'z-50']));
    // Opaque: a solid background class without an alpha modifier (bg-white, not bg-white/90 or bg-transparent).
    const bg = classes.filter((c) => c.startsWith('bg-'));
    expect(bg).toEqual(['bg-white']);
    // The banner lives inside the pinned element, so scrolling cannot separate them.
    expect(bar).toContainElement(screen.getByTestId(TID.demoBar.banner));
  });
});

describe('clock', () => {
  it('shows the simulated time and polls the status every second', async () => {
    vi.useFakeTimers();
    renderBar();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByTestId(TID.demoBar.clockNow)).toHaveTextContent('2026-11-12 09:00:00 +07:00');
    const before = mocks.status.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STATUS_POLL_MS * 3);
    });
    expect(mocks.status.mock.calls.length - before).toBe(3);
  });

  it.each(ADVANCE_DURATIONS)('advance button %s sends exactly that duration', async (d) => {
    const user = userEvent.setup();
    mocks.setClock.mockImplementation(async () => {
      server = status({ now: '2026-11-13T09:00:00+07:00' });
      return ok(server);
    });
    renderBar();
    await user.click(screen.getByTestId(TID.demoBar.clockAdvance(d)));
    expect(mocks.setClock).toHaveBeenCalledTimes(1);
    expect(mocks.setClock).toHaveBeenCalledWith(d);
    expect(await screen.findByText('2026-11-13 09:00:00 +07:00')).toBeInTheDocument();
  });

  it('bumps the data version after an advance so pages reload', async () => {
    const user = userEvent.setup();
    mocks.setClock.mockResolvedValue(ok(status()));
    renderBar();
    await user.click(screen.getByTestId(TID.demoBar.clockAdvance('P1D')));
    await waitFor(() => expect(useAppStore.getState().dataVersion).toBeGreaterThan(0));
  });

  it('shows a Thai error when the advance fails', async () => {
    const user = userEvent.setup();
    mocks.setClock.mockResolvedValue(fail(500, 'boom'));
    renderBar();
    await user.click(screen.getByTestId(TID.demoBar.clockAdvance('P1D')));
    expect(await screen.findByText(/เลื่อนเวลาไม่สำเร็จ: boom/)).toBeInTheDocument();
  });
});

describe('persona switcher', () => {
  it.each(PERSONAS.map((p) => [p.id, p.role] as const))('%s (%s) goes to the role home', async (id, role) => {
    const user = userEvent.setup();
    const persona = PERSONAS.find((p) => p.id === id)!;
    mocks.switchPersona.mockImplementation(async () => {
      server = status({ actor: toUser(persona) });
      return ok({ token: `tok-${id}`, user: toUser(persona) });
    });
    renderBar();
    await screen.findByRole('option', { name: /สมชาย/ }); // personas loaded
    await user.selectOptions(screen.getByTestId(TID.demoBar.personaSelect), id);
    expect(mocks.switchPersona).toHaveBeenCalledWith(id);
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(ROLE_HOME[role]));
    expect(useAppStore.getState().token).toBe(`tok-${id}`);
    expect(useAppStore.getState().user?.id).toBe(id);
  });

  it('maps every role to the documented home route', () => {
    expect(ROLE_HOME).toEqual({
      signer: '/certs',
      new_user: '/certs/request',
      user: '/certs',
      verifier: '/verify',
      'admin-a': '/admin/requests',
      'admin-b': '/admin/status',
    });
  });

  it('"ลองล็อกอินเอง" ends the session and opens /login', async () => {
    const user = userEvent.setup();
    useAppStore.getState().setSession('tok', toUser(PERSONAS[0]!));
    server = status({ actor: toUser(PERSONAS[0]!) });
    renderBar();
    await screen.findByRole('option', { name: 'ลองล็อกอินเอง' });
    await user.selectOptions(screen.getByTestId(TID.demoBar.personaSelect), 'ลองล็อกอินเอง');
    expect(mocks.logout).toHaveBeenCalled();
    expect(useAppStore.getState().token).toBeNull();
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/login'));
    expect(mocks.switchPersona).not.toHaveBeenCalled();
  });

  it('keeps the current page and shows an error when the switch fails', async () => {
    const user = userEvent.setup();
    mocks.switchPersona.mockResolvedValue(fail(500, 'nope'));
    renderBar();
    await screen.findByRole('option', { name: /สมชาย/ });
    await user.selectOptions(screen.getByTestId(TID.demoBar.personaSelect), 'u-somchai');
    expect(await screen.findByText(/สลับบทบาทไม่สำเร็จ: nope/)).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/verify');
    expect(useAppStore.getState().token).toBeNull();
  });
});

describe('fault toggles', () => {
  const faultsOff = { ocsp_down: false, crl_down: false, tsa_drift_ms: 0, queue_full: false };

  it.each([
    ['ocsp', { ocsp_down: true, crl_down: false }],
    ['crl', { ocsp_down: false, crl_down: true }],
    ['ocsp-crl', { ocsp_down: true, crl_down: true }],
    ['tsa-drift', { tsa_drift_ms: 1400 }],
    ['queue-full', { queue_full: true }],
  ] as const)('%s turns on with the documented patch', async (key, patch) => {
    const user = userEvent.setup();
    mocks.setFaults.mockResolvedValue(ok(status()));
    renderBar();
    const button = await screen.findByTestId(TID.demoBar.fault(key));
    await waitFor(() => expect(button).toBeEnabled());
    expect(button).toHaveAttribute('aria-pressed', 'false');
    await user.click(button);
    expect(mocks.setFaults).toHaveBeenCalledWith(patch);
  });

  it('reflects the server state in aria-pressed and turns the toggle off again', async () => {
    const user = userEvent.setup();
    server = status({ faults: { ...faultsOff, ocsp_down: true, crl_down: true } });
    mocks.setFaults.mockResolvedValue(ok(status()));
    renderBar();
    const both = await screen.findByTestId(TID.demoBar.fault('ocsp-crl'));
    await waitFor(() => expect(both).toHaveAttribute('aria-pressed', 'true'));
    // The single-service presets are NOT pressed when both are down.
    expect(screen.getByTestId(TID.demoBar.fault('ocsp'))).toHaveAttribute('aria-pressed', 'false');
    await user.click(both);
    expect(mocks.setFaults).toHaveBeenCalledWith({ ocsp_down: false, crl_down: false });
  });
});

describe('reset', () => {
  it('needs confirmation: opening the dialog does not call the API; cancel and Esc keep the data', async () => {
    const user = userEvent.setup();
    renderBar();
    await user.click(screen.getByTestId(TID.demoBar.reset));
    expect(screen.getByRole('dialog', { name: /รีเซ็ต/ })).toBeInTheDocument();
    expect(mocks.reset).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByTestId(TID.demoBar.reset));
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it('confirm resets, clears the session and bumps the data version', async () => {
    const user = userEvent.setup();
    useAppStore.getState().setSession('tok', toUser(PERSONAS[0]!));
    server = status({ actor: toUser(PERSONAS[0]!) });
    mocks.reset.mockResolvedValue(ok(null, 204));
    renderBar();
    const versionBefore = useAppStore.getState().dataVersion;
    await user.click(screen.getByTestId(TID.demoBar.reset));
    await user.click(screen.getByTestId(TID.demoBar.resetConfirm));
    expect(mocks.reset).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(useAppStore.getState().token).toBeNull());
    expect(useAppStore.getState().dataVersion).toBeGreaterThan(versionBefore);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a failed reset keeps the session', async () => {
    const user = userEvent.setup();
    useAppStore.getState().setSession('tok', toUser(PERSONAS[0]!));
    server = status({ actor: toUser(PERSONAS[0]!) });
    mocks.reset.mockResolvedValue(fail(500, 'broken'));
    renderBar();
    await user.click(screen.getByTestId(TID.demoBar.reset));
    await user.click(screen.getByTestId(TID.demoBar.resetConfirm));
    expect(await screen.findByText(/รีเซ็ตไม่สำเร็จ: broken/)).toBeInTheDocument();
    expect(useAppStore.getState().token).toBe('tok');
  });
});

describe('missions link and narrow-screen menu', () => {
  it('links to /missions and shows progress', async () => {
    server = status({ missions: [{ id: 'M1', done: true, done_at: '2026-11-12T10:00:00+07:00' }, { id: 'M2', done: false, done_at: null }] });
    renderBar();
    const link = screen.getByTestId(TID.demoBar.missionsLink);
    expect(link).toHaveAttribute('href', '/missions');
    await waitFor(() => expect(link).toHaveTextContent('1/11'));
  });

  it('menu toggle controls the collapsed group (aria-expanded, hidden class on narrow screens)', async () => {
    const user = userEvent.setup();
    renderBar();
    const toggle = screen.getByTestId(TID.demoBar.menuToggle);
    const controls = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Collapsed below md (display:none via Tailwind `hidden`), always shown from md up.
    expect(controls.className).toMatch(/\bhidden\b/);
    expect(controls.className).toMatch(/md:flex/);
    expect(toggle.className).toMatch(/md:hidden/);
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(controls.className).not.toMatch(/\bhidden\b/);
    // The persona select, advance and fault controls are all inside the collapsible group.
    expect(controls).toContainElement(screen.getByTestId(TID.demoBar.personaSelect));
    expect(controls).toContainElement(screen.getByTestId(TID.demoBar.clockAdvance('P1D')));
    expect(controls).toContainElement(screen.getByTestId(TID.demoBar.fault('ocsp')));
    // The clock stays outside it (always visible).
    expect(controls).not.toContainElement(screen.getByTestId(TID.demoBar.clockNow));
  });
});
