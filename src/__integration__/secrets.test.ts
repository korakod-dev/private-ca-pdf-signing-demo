/// <reference types="node" />
// (tsconfig.json only lists vite/client types; this test needs node:* modules for the hasher.)
//
// Secrets never leave the "machine" (QA F30, assumptions A26 / A42). Real terminal commands (`pdfsign sign`, `pki-tool init`,
// `pki-tool renew`) -> real API client -> msw/node -> REAL runtime + engine. After the flows, the persisted state (the
// whole of `localStorage` in the browser), the audit entries and every other storage key must not contain what was typed:
// the .p12 password (wrong tries included) and the key passphrases.
//
// One subtlety: the CORRECT .p12 password is a configured constant of the demo (`system.demo_p12_password`, spec 7.1), so it
// legitimately appears in the state once. To tell "the configured value" from "the typed request was stored", this test
// swaps the constant for a unique sentinel and requires exactly one occurrence, located at `system.demo_p12_password`.
// A future change that saves the whole sign request (or an audit `details` with it) adds a second occurrence and fails.
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupServer } from 'msw/node';
import type { ApiResult } from '../contracts/api-client';
import type { FixtureBundle } from '../contracts/fixtures';
import type { Hasher, KeyValueStorage } from '../contracts/runtime';
import { STORAGE_KEYS } from '../contracts/runtime';
import type { UserSummary } from '../contracts/store';
import type { TerminalIO } from '../contracts/terminal';

// The terminal commands import the `api` / `demoApi` singletons. Point them at the clients built below (same wiring as the app,
// only the HTTP base differs) so the commands run unchanged.
const holder = vi.hoisted(() => ({ api: undefined as unknown, demoApi: undefined as unknown }));
vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>();
  return {
    ...actual,
    get api() {
      return holder.api;
    },
    get demoApi() {
      return holder.demoApi;
    },
  };
});

import { createDemoApi } from '../api/demo';
import { createHttp } from '../api/http';
import { createApiClient } from '../api/real';
import { createEngine } from '../engine';
import { fixtures } from '../fixtures';
import { createHandlers } from '../mocks/handlers';
import { createRuntime } from '../mocks/runtime';
import { runLine } from '../terminal/core/dispatch';
import { PDFSIGN_PROMPTS, pdfsign } from '../terminal/commands/pdfsign';
import { pkiTool } from '../terminal/commands/pkiTool';

const BASE = 'http://localhost:3998';
const WALL_MS = Date.parse('2030-01-01T00:00:00Z');

// Unique strings, so a plain substring count is meaningful.
const P12_OK = 'sentinel-p12-ok-7c1d9a40';
const P12_WRONG = 'sentinel-p12-wrong-5e22b7f1';
const PASS_INIT = 'sentinel-init-passphrase-3b8e6d02';
const PASS_RENEW = 'sentinel-renew-passphrase-91af44c7';
const SECRETS_NEVER_STORED = [P12_WRONG, PASS_INIT, PASS_RENEW] as const;

/** Fixture bundle whose configured .p12 password is the sentinel (the schema pins the real value; this is test-only). */
const testFixtures = {
  ...fixtures,
  system: { ...fixtures.system, demo_p12_password: P12_OK },
} as unknown as FixtureBundle;

function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

const nodeHasher: Hasher = { sha256Hex: async (text) => createHash('sha256').update(text, 'utf8').digest('hex') };

const storage = memoryStorage();
const runtime = createRuntime({ engine: createEngine(), storage, wallNow: () => WALL_MS, hasher: nodeHasher, fixtures: testFixtures });
const server = setupServer(...createHandlers(runtime));
let token: string | null = null;
const http = createHttp({ baseUrl: BASE, getToken: () => token });
const api = createApiClient(http);
const demoApi = createDemoApi(http);
holder.api = api;
holder.demoApi = demoApi;

beforeAll(() => server.listen({ onUnhandledFrame: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());
beforeEach(async () => {
  storage.setItem(STORAGE_KEYS.testMode, JSON.stringify({ latency: false, clock: 'frozen' }));
  token = null;
  await runtime.reset();
});

function ok<T>(r: ApiResult<T>): T {
  if (!r.ok) throw new Error(`API call failed: ${r.error.status} ${r.error.code} ${r.error.detail ?? ''}`);
  return r.data;
}

/** Signs in as a persona and returns the user the terminal commands receive. */
async function signIn(id: Parameters<typeof demoApi.switchPersona>[0]): Promise<UserSummary> {
  const session = ok(await demoApi.switchPersona(id));
  token = session.token;
  return session.user;
}

/** Scripted terminal: answers each question from `answer(label)`, records everything printed. */
function scriptedIo(answer: (label: string) => string) {
  const printed: string[] = [];
  const secretLabels: string[] = [];
  const io: TerminalIO = {
    print: (text) => void printed.push(text),
    prompt: async (label, opts) => {
      if (opts?.secret === true) secretLabels.push(label);
      return answer(label);
    },
    clear: () => undefined,
    link: (label) => void printed.push(label),
  };
  return { io, printed, secretLabels };
}

const count = (haystack: string, needle: string): number => haystack.split(needle).length - 1;

/** Every storage entry as [key, value]. */
function storageEntries(): [string, string][] {
  const out: [string, string][] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (k !== null) out.push([k, storage.getItem(k) ?? '']);
  }
  return out;
}

describe('typed secrets are never stored (state, audit, localStorage)', () => {
  it('.p12 password (wrong and right) and init/renew passphrases appear nowhere in the persisted data', async () => {
    // --- somchai signs once with wrong passwords (refused, audited), then with the right one ---
    const somchai = await signIn('u-somchai');
    const docs = ok(await demoApi.workstation()).documents;
    const memo = docs.find((d) => d.path === '~/Documents/memo-130-unsigned.pdf');
    expect(memo, 'sample document on the simulated workstation').toBeDefined();
    const suffix = (memo?.sha256 ?? '').slice(-4);

    const sign = (password: string) =>
      scriptedIo((label) => (label === PDFSIGN_PROMPTS.purpose ? '1' : label === PDFSIGN_PROMPTS.sha ? suffix : password));
    const refused = sign(P12_WRONG);
    expect(await runLine('pdfsign sign ~/Documents/memo-130-unsigned.pdf --field "approver-1" --certify', { io: refused.io, user: somchai, commands: [pdfsign] })).toBe(1);
    const signed = sign(P12_OK);
    expect(await runLine('pdfsign sign ~/Documents/memo-130-unsigned.pdf --field "approver-1" --certify', { io: signed.io, user: somchai, commands: [pdfsign] })).toBe(0);
    expect(signed.printed.join('\n')).toContain('memo-130-s1.signed.pdf'); // the flow really finished
    expect(signed.secretLabels).toEqual([PDFSIGN_PROMPTS.p12]); // asked as a secret

    // --- nattapon creates a key (init), aree renews (renew): both ask a passphrase ---
    const nattapon = await signIn('u-nattapon');
    const init = scriptedIo(() => PASS_INIT);
    expect(await runLine('pki-tool init --name "ณัฐพล ทองดี" --email nattapon@lab.korakod.dev', { io: init.io, user: nattapon, commands: [pkiTool] })).toBe(0);
    expect(init.secretLabels).toHaveLength(1);

    const aree = await signIn('u-aree');
    const renew = scriptedIo(() => PASS_RENEW);
    expect(await runLine('pki-tool renew', { io: renew.io, user: aree, commands: [pkiTool] })).toBe(0);
    expect(renew.secretLabels).toHaveLength(1);
    // Never echoed back by the terminal either.
    for (const io of [refused, signed, init, renew]) {
      for (const secret of [P12_OK, P12_WRONG, PASS_INIT, PASS_RENEW]) expect(io.printed.join('\n')).not.toContain(secret);
    }

    // --- the persisted state (= localStorage in the browser) ---
    const rawState = storage.getItem(STORAGE_KEYS.state) ?? '';
    expect(rawState.length).toBeGreaterThan(1000);
    const state = JSON.parse(rawState) as { audit: unknown[]; system: { demo_p12_password: string } };
    const audit = JSON.stringify(state.audit);
    expect(state.audit.length).toBeGreaterThan(3); // sign.refused, sign.commit, ... really recorded

    for (const secret of SECRETS_NEVER_STORED) {
      expect(count(rawState, secret), `state contains ${secret}`).toBe(0);
      expect(count(audit, secret), `audit contains ${secret}`).toBe(0);
      for (const [key, value] of storageEntries()) expect(count(value, secret), `storage key ${key} contains ${secret}`).toBe(0);
    }

    // The configured (correct) .p12 password: exactly once in the state, at its configuration field; never in the audit
    // and never in any other key.
    expect(state.system.demo_p12_password).toBe(P12_OK);
    expect(count(rawState, P12_OK), 'typed .p12 password stored beyond the configured value').toBe(1);
    expect(count(audit, P12_OK)).toBe(0);
    for (const [key, value] of storageEntries()) {
      if (key !== STORAGE_KEYS.state) expect(count(value, P12_OK), `storage key ${key}`).toBe(0);
    }
  });
});
