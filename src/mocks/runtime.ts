// Mock runtime: glues the pure engine to browser storage (contract: src/contracts/runtime.ts).
//
// One `run(req)`:  load state (or initialise) -> clockFrom -> dispatch -> chain audit drafts -> persist -> response.
//
// Design notes
// - State lives only in storage (localStorage `pcpsd.state.v1` in the browser). It is re-read on every call, so a failed
//   write can never leave an in-memory state that differs from what is persisted.
// - Calls are serialised (one at a time): chaining audit entries hashes asynchronously, so two overlapping requests
//   would otherwise read the same state and one of them would be lost.
// - Time: the runtime never fakes `wallMs`. Frozen/running is the engine's `ClockState.mode`, set from TestMode.clock
//   through `EngineOptions.clock_mode` when the state is created.
// - `demo.reset` is handled here (it is not an engine route) and `demo.progress` with `M11.chain_verified` is guarded
//   here (the chain is verified for real and the caller must be a-admin-b) before it is forwarded to the engine.
import type { AuditDraft, EngineOptions, EngineRequest, EngineResponse, EngineStateEnvelope } from '../contracts/engine';
import type { MockRuntime, RuntimeDeps } from '../contracts/runtime';
import { STORAGE_KEYS, parseTestMode } from '../contracts/runtime';
import type { UserSummary } from '../contracts/store';
import { problemBody } from '../engine/http';
import { chainEntries, verifyChain } from '../lib/hashChain';

/** The only persona allowed to complete mission M11 (verify the audit chain). */
const M11_ACTOR = 'a-admin-b';

/**
 * Builds an RFC 9457 problem response. It reuses the engine's `problemBody` (F21) so runtime-made errors have exactly the
 * same shape as engine-made ones: `type` is `/problems/<code>` and `title` comes from the status, not from the caller.
 */
function problem(status: number, code: string, detail?: string): EngineResponse {
  return { status, body: problemBody(status, code, detail) };
}

function isM11Progress(body: unknown): boolean {
  return typeof body === 'object' && body !== null && (body as { key?: unknown }).key === 'M11.chain_verified';
}

export function createRuntime<S extends EngineStateEnvelope>(deps: RuntimeDeps<S>): MockRuntime {
  const { engine, storage, wallNow, hasher, fixtures } = deps;

  /** F5 mapping: TestMode -> EngineOptions (no test mode => latency on, running clock). */
  function engineOptions(): EngineOptions {
    const tm = parseTestMode(storage.getItem(STORAGE_KEYS.testMode));
    return { latency: tm ? tm.latency : true, clock_mode: tm ? tm.clock : 'running' };
  }

  /** Loads the persisted state; null when missing, unreadable, malformed or from another STATE_VERSION. */
  function load(): S | null {
    const raw = storage.getItem(STORAGE_KEYS.state);
    if (raw === null) return null;
    try {
      const v = JSON.parse(raw) as Partial<EngineStateEnvelope> | null;
      if (!v || typeof v !== 'object') return null;
      if (v.version !== engine.STATE_VERSION) return null;
      if (!v.clock || typeof v.clock !== 'object' || !Array.isArray(v.audit)) return null;
      return v as S;
    } catch {
      return null;
    }
  }

  function persist(state: S): void {
    const next = JSON.stringify(state);
    if (storage.getItem(STORAGE_KEYS.state) !== next) storage.setItem(STORAGE_KEYS.state, next);
  }

  /** Chains drafts after the last audit entry and returns the state with the new entries appended. */
  async function withAudit(state: S, drafts: readonly AuditDraft[]): Promise<S> {
    if (drafts.length === 0) return state;
    const last = state.audit[state.audit.length - 1] ?? null;
    const entries = await chainEntries(drafts, last, hasher);
    return { ...state, audit: [...state.audit, ...entries] };
  }

  async function execute(req: EngineRequest): Promise<EngineResponse> {
    if (req.route === 'demo.reset') {
      await doReset();
      return { status: 204, body: null };
    }

    let state: S;
    let response: EngineResponse;
    try {
      const wall = wallNow();
      state = load() ?? engine.createInitialState(fixtures, engineOptions(), wall);
      const clock = engine.clockFrom(state, wall);

      if (req.route === 'demo.progress' && isM11Progress(req.body)) {
        // Guard (contract): re-verify the chain and require a-admin-b before the engine marks M11 done.
        // The actor is resolved through the engine itself (auth.me), so the runtime needs no token format knowledge.
        const me = engine.dispatch(state, { route: 'auth.me', token: req.token, params: {}, query: {}, body: null, mfa: null }, clock);
        state = await withAudit(me.state, me.audit);
        const actor = me.response.status === 200 ? (me.response.body as UserSummary).id : null;
        if (me.response.status !== 200) {
          response = me.response;
        } else if (actor !== M11_ACTOR) {
          response = problem(403, 'FORBIDDEN', 'Only admin-b can complete the audit chain mission.');
        } else if (!(await verifyChain(state.audit, hasher)).valid) {
          response = problem(409, 'INVALID_STATE', 'The hash chain does not verify.');
        } else {
          const r = engine.dispatch(state, req, clock);
          state = await withAudit(r.state, r.audit);
          response = r.response;
        }
      } else {
        const r = engine.dispatch(state, req, clock);
        state = await withAudit(r.state, r.audit);
        response = r.response;
      }
    } catch (e) {
      return problem(500, 'INTERNAL_ERROR', e instanceof Error ? e.message : String(e));
    }

    try {
      persist(state);
    } catch (e) {
      // e.g. quota exceeded: the response is NOT returned as if the change had been saved.
      return problem(507, 'STORAGE_ERROR', e instanceof Error ? e.message : String(e));
    }
    return response;
  }

  /**
   * Removes every `pcpsd.*` key and re-initialises with a genesis `system.reset` audit entry.
   * Deviation to note: the TestMode switch (`pcpsd.test-mode`) is an environment setting, not learner state, so it is
   * written back after the wipe. Otherwise a reset inside Cypress would silently turn latency and the running clock back on.
   */
  async function doReset(): Promise<void> {
    const testModeRaw = storage.getItem(STORAGE_KEYS.testMode);
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k !== null && k.startsWith(STORAGE_KEYS.prefix)) keys.push(k);
    }
    keys.forEach((k) => storage.removeItem(k));
    if (testModeRaw !== null) storage.setItem(STORAGE_KEYS.testMode, testModeRaw);

    const wall = wallNow();
    const fresh = engine.createInitialState(fixtures, engineOptions(), wall);
    const clock = engine.clockFrom(fresh, wall);
    const genesis: AuditDraft = { at: clock.now, actor: 'system', action: 'system.reset', target: null, details: {} };
    persist(await withAudit(fresh, [genesis]));
  }

  // Serialise all calls (see the design notes at the top).
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(task: () => Promise<T>): Promise<T> {
    const result = queue.then(task, task);
    queue = result.catch(() => undefined);
    return result;
  }

  return {
    run: (req) => serial(() => execute(req)),
    reset: () => serial(doReset),
  };
}
