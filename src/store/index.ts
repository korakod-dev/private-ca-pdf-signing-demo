// Client-side store (plan section 3.4, contract: src/contracts/store.ts).
//  - Only the session TOKEN is persisted, as a raw string under SESSION_STORAGE_KEY ("pcpsd.session.v1").
//    The user summary and demo status always come from the API, so a reload never shows stale identity.
//  - Importing this module wires the API client's token getter (configureApi), so every request carries the bearer token.
import { create } from 'zustand';
import { configureApi, demoApi } from '../api';
import { SESSION_STORAGE_KEY, type AppStore } from '../contracts/store';

/** Reads the persisted token; storage may be unavailable (privacy modes), so never throw. */
function readToken(): string | null {
  try {
    return globalThis.localStorage?.getItem(SESSION_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

function writeToken(token: string | null): void {
  try {
    if (token === null) globalThis.localStorage?.removeItem(SESSION_STORAGE_KEY);
    else globalThis.localStorage?.setItem(SESSION_STORAGE_KEY, token);
  } catch {
    // Storage full or blocked: the session then lives only in memory, which is acceptable for a demo.
  }
}

export const useAppStore = create<AppStore>()((set, get) => ({
  token: readToken(),
  user: null,
  demo: null,
  dataVersion: 0,

  setSession(token, user) {
    writeToken(token);
    // Login/logout and persona switches change what every page may show: bump the data version too.
    set((s) => ({ token, user, dataVersion: s.dataVersion + 1 }));
  },

  clearSession() {
    writeToken(null);
    set((s) => ({ token: null, user: null, dataVersion: s.dataVersion + 1 }));
  },

  bumpDataVersion() {
    set((s) => ({ dataVersion: s.dataVersion + 1 }));
  },

  async refreshDemoStatus() {
    const tokenAtRequest = get().token;
    let result;
    try {
      result = await demoApi.status();
    } catch {
      return; // the client should return failures as results; if it throws anyway, keep the last status
    }
    if (!result.ok) return; // keep the last known status; the bar shows its own error state
    // The session changed while the request was in flight (persona switch, logout): this answer is stale.
    if (get().token !== tokenAtRequest) return;
    const status = result.data;
    if (tokenAtRequest !== null && status.actor === null) {
      // The server no longer knows this token (reset, expired): drop it so the UI does not pretend to be signed in.
      writeToken(null);
      set((s) => ({ demo: status, token: null, user: null, dataVersion: s.dataVersion + 1 }));
      return;
    }
    set({ demo: status, user: tokenAtRequest === null ? null : status.actor });
  },
}));

// Wire the token getter once. Reading from the store keeps it current after setSession/clearSession.
configureApi({ getToken: () => useAppStore.getState().token });
