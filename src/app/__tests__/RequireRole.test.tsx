// RequireRole: shows the children for an allowed role; otherwise a Thai explanation + switch-role hint, NO redirect.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { TID } from '../../contracts/testids';
import { PERSONAS, status, toUser } from '../../store/__tests__/fakes';

vi.mock('../../api', () => ({ configureApi: vi.fn(), api: {}, demoApi: {} }));

import { useAppStore } from '../../store';
import { RequireRole } from '../RequireRole';

function Where() {
  return <span data-testid="where">{useLocation().pathname}</span>;
}

function renderGate(roles: Parameters<typeof RequireRole>[0]['roles']) {
  return render(
    <MemoryRouter initialEntries={['/admin/requests']}>
      <RequireRole roles={roles}>
        <p>secret admin content</p>
      </RequireRole>
      <Where />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ token: null, user: null, demo: null, dataVersion: 0 });
});

describe('RequireRole', () => {
  it('renders the children for an allowed role', () => {
    useAppStore.setState({ token: 't', user: toUser(PERSONAS[4]!), demo: status() }); // admin-a
    renderGate(['admin-a']);
    expect(screen.getByText('secret admin content')).toBeInTheDocument();
    expect(screen.queryByTestId(TID.requireRole.mismatch)).toBeNull();
  });

  it('explains a wrong role in Thai, names the current role and hints at the role switcher; no redirect', () => {
    useAppStore.setState({ token: 't', user: toUser(PERSONAS[0]!), demo: status() }); // signer
    renderGate(['admin-a']);
    const box = screen.getByTestId(TID.requireRole.mismatch);
    expect(box).toHaveTextContent('ผู้ดูแล A');
    expect(box).toHaveTextContent('ผู้ลงนาม');
    expect(box).toHaveTextContent('สลับบทบาท');
    expect(box).toHaveAttribute('data-required-roles', 'admin-a');
    expect(screen.queryByText('secret admin content')).toBeNull();
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/requests'); // still on the same URL
  });

  it('lists several allowed roles', () => {
    useAppStore.setState({ token: null, user: null, demo: status() });
    renderGate(['signer', 'user']);
    expect(screen.getByTestId(TID.requireRole.mismatch)).toHaveTextContent('ผู้ลงนาม หรือ ผู้ใช้');
  });

  it('nobody signed in: same explanation, says no role is chosen yet', () => {
    useAppStore.setState({ token: null, user: null, demo: status() });
    renderGate(['admin-a']);
    expect(screen.getByTestId(TID.requireRole.mismatch)).toHaveTextContent('ยังไม่ได้เลือกบทบาท');
  });

  it('waits (no warning flash) while a stored token has not been resolved to a user yet', () => {
    useAppStore.setState({ token: 't', user: null, demo: null });
    renderGate(['admin-a']);
    expect(screen.queryByTestId(TID.requireRole.mismatch)).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('กำลังตรวจสอบสิทธิ์');
  });
});
