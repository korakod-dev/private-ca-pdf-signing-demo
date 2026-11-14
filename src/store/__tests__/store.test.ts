// Store tests: token persistence (only the token, under pcpsd.session.v1), configureApi wiring, data version bumps,
// and how refreshDemoStatus treats the session (API mocked with vi.mock).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SESSION_STORAGE_KEY } from '../../contracts/store';
import { PERSONAS, fail, ok, status, toUser } from './fakes';

const mocks = vi.hoisted(() => ({ configureApi: vi.fn(), demoStatus: vi.fn() }));
vi.mock('../../api', () => ({ configureApi: mocks.configureApi, demoApi: { status: mocks.demoStatus }, api: {} }));

import { useAppStore } from '../index';

const somchai = toUser(PERSONAS[0]!);
// configureApi is called once while the store module loads; keep that argument before any test resets mocks.
const wiredConfig = mocks.configureApi.mock.calls[0]?.[0] as { getToken: () => string | null } | undefined;

beforeEach(() => {
  localStorage.clear();
  mocks.demoStatus.mockReset();
  useAppStore.setState({ token: null, user: null, demo: null, dataVersion: 0 });
});

describe('store', () => {
  it('wires the API token getter to the store', () => {
    // Its getter must read the live token.
    expect(wiredConfig).toBeDefined();
    expect(wiredConfig!.getToken()).toBeNull();
    useAppStore.getState().setSession('tok-1', somchai);
    expect(wiredConfig!.getToken()).toBe('tok-1');
  });

  it('persists ONLY the token, under pcpsd.session.v1', () => {
    useAppStore.getState().setSession('tok-1', somchai);
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBe('tok-1');
    expect(localStorage.length).toBe(1);
    expect(useAppStore.getState().user).toEqual(somchai);
    useAppStore.getState().clearSession();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(useAppStore.getState().token).toBeNull();
    expect(useAppStore.getState().user).toBeNull();
  });

  it('bumps the data version on login, logout and explicit bump', () => {
    const v = () => useAppStore.getState().dataVersion;
    useAppStore.getState().setSession('t', somchai);
    expect(v()).toBe(1);
    useAppStore.getState().clearSession();
    expect(v()).toBe(2);
    useAppStore.getState().bumpDataVersion();
    expect(v()).toBe(3);
  });

  it('refreshDemoStatus stores the status and takes the user from the actor when a token exists', async () => {
    useAppStore.getState().setSession('t', somchai);
    useAppStore.setState({ user: null }); // as after a page reload: token only
    mocks.demoStatus.mockResolvedValue(ok(status({ actor: somchai })));
    await useAppStore.getState().refreshDemoStatus();
    expect(useAppStore.getState().demo?.actor).toEqual(somchai);
    expect(useAppStore.getState().user).toEqual(somchai);
  });

  it('refreshDemoStatus drops a token the server no longer knows (actor null)', async () => {
    useAppStore.getState().setSession('stale', somchai);
    mocks.demoStatus.mockResolvedValue(ok(status({ actor: null })));
    await useAppStore.getState().refreshDemoStatus();
    expect(useAppStore.getState().token).toBeNull();
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
  });

  it('refreshDemoStatus ignores an answer that arrives after the session changed', async () => {
    let release: (v: unknown) => void = () => {};
    mocks.demoStatus.mockReturnValue(new Promise((r) => (release = r)));
    const pending = useAppStore.getState().refreshDemoStatus(); // started without a token
    useAppStore.getState().setSession('new', somchai); // persona switch while in flight
    release(ok(status({ actor: null })));
    await pending;
    expect(useAppStore.getState().token).toBe('new'); // not cleared by the stale answer
    expect(useAppStore.getState().demo).toBeNull();
  });

  it('refreshDemoStatus keeps the last status when the call fails', async () => {
    useAppStore.setState({ demo: status() });
    mocks.demoStatus.mockResolvedValue(fail(500, 'boom'));
    await useAppStore.getState().refreshDemoStatus();
    expect(useAppStore.getState().demo).toEqual(status());
  });
});
