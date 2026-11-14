// Role gate on every role-restricted page (QA F15, plan P3): rendered through the real route table, a wrong persona sees
// TID.requireRole.mismatch (and the page content never mounts, so it never calls the API); an allowed persona does not.
// No session at all gets the same explanation. The role lists are the ones in spec 7.2 / the engine access policy
// (src/engine/routes.ts ACCESS): requesters = signer/new_user/user, /admin/requests + /admin/certs = admin-a only,
// /admin/status = both admins, /archive = everyone who can hold or check documents (not admins).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { Role } from '../../contracts/fixtures';
import { TID } from '../../contracts/testids';
import { PERSONAS, status, toUser } from '../../store/__tests__/fakes';

// Calls made to any API method other than the demo bar's own (status/personas). A gated page must make none.
const pageCalls = vi.hoisted(() => [] as string[]);
vi.mock('../../api', () => {
  // Every unknown method records its name and returns a promise that never settles (content stays in its loading state).
  const recorder = (group: string) =>
    new Proxy(
      {},
      {
        get: (_t, name: string) => {
          // The shell's own polling (status/personas) stays pending: the store is set up by the test, not by the API.
          if (group === 'demoApi' && (name === 'status' || name === 'personas')) return () => new Promise(() => {});
          return (..._args: unknown[]) => {
            pageCalls.push(`${group}.${name}`);
            return new Promise(() => {});
          };
        },
      },
    );
  const nested = new Proxy(
    {},
    {
      get: (_t, group: string) => recorder(`api.${group}`),
    },
  );
  return { configureApi: vi.fn(), api: nested, demoApi: recorder('demoApi') };
});

import { useAppStore } from '../../store';
import { AppRoutes } from '../routes';

const REQUESTERS: Role[] = ['signer', 'new_user', 'user'];
const ALL_ROLES: Role[] = ['signer', 'new_user', 'user', 'verifier', 'admin-a', 'admin-b'];

/** path -> roles allowed to see the content. */
const RESTRICTED: Array<[string, Role[]]> = [
  ['/certs/request', REQUESTERS],
  ['/certs', REQUESTERS],
  ['/sign', REQUESTERS],
  ['/archive', [...REQUESTERS, 'verifier']],
  ['/admin/requests', ['admin-a']],
  ['/admin/certs', ['admin-a']],
  ['/admin/status', ['admin-a', 'admin-b']],
];

const personaOf = (role: Role) => PERSONAS.find((p) => p.role === role)!;

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  pageCalls.length = 0;
  useAppStore.setState({ token: null, user: null, demo: status(), dataVersion: 0 });
});

describe('restricted pages: wrong persona', () => {
  const wrong = RESTRICTED.flatMap(([path, allowed]) =>
    ALL_ROLES.filter((r) => !allowed.includes(r)).map((role) => [path, role] as const),
  );

  it.each(wrong)('%s as %s shows the role explanation and loads nothing', (path, role) => {
    useAppStore.setState({ token: 't', user: toUser(personaOf(role)) });
    renderAt(path);
    const box = screen.getByTestId(TID.requireRole.mismatch);
    expect(box).toHaveAttribute('data-required-roles');
    expect(box).toHaveTextContent('สลับบทบาท');
    expect(pageCalls).toEqual([]);
  });
});

describe('restricted pages: allowed persona', () => {
  const allowed = RESTRICTED.flatMap(([path, roles]) => roles.map((role) => [path, role] as const));

  it.each(allowed)('%s as %s is not blocked', (path, role) => {
    useAppStore.setState({ token: 't', user: toUser(personaOf(role)) });
    renderAt(path);
    expect(screen.queryByTestId(TID.requireRole.mismatch)).toBeNull();
  });
});

describe('API recorder sanity', () => {
  it('an allowed persona on /certs does call the API (so "loads nothing" above is a real check)', () => {
    useAppStore.setState({ token: 't', user: toUser(personaOf('signer')) });
    renderAt('/certs');
    expect(pageCalls.length).toBeGreaterThan(0);
  });
});

describe('restricted pages: no session', () => {
  it.each(RESTRICTED.map(([path]) => [path] as const))('%s without a persona shows the role explanation', (path) => {
    renderAt(path);
    const box = screen.getByTestId(TID.requireRole.mismatch);
    expect(box).toHaveTextContent('ยังไม่ได้เลือกบทบาทหรือเข้าสู่ระบบ');
    expect(pageCalls).toEqual([]);
  });

  it('a stored token whose identity is still loading shows the waiting note, not the mismatch box', () => {
    useAppStore.setState({ token: 't', user: null, demo: null });
    renderAt('/admin/requests');
    expect(screen.queryByTestId(TID.requireRole.mismatch)).toBeNull();
    expect(screen.getByText('กำลังตรวจสอบสิทธิ์…')).toBeInTheDocument();
  });
});
