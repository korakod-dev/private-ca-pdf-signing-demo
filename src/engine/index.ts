// Engine entry point (sub-task B1). Pure: (state, event, clock) -> (state', response, auditEvents).
//
// Every public call works on a private structured clone of the incoming state and never mutates its input, so the same
// input always yields a deep-equal output (determinism test) and frozen inputs are fine. No wall clock, randomness or
// browser globals are used here: time comes only from the injected Clock (ESLint enforces this under src/engine/**).
import type {
  AuditDraft,
  Clock,
  EngineApi,
  EngineOptions,
  EngineRequest,
  EngineResult,
  MissionProgress,
  ResolveFn,
} from '../contracts/engine';
import type { FixtureBundle } from '../contracts/fixtures';
import { clockAt } from './clock';
import { ProblemError } from './http';
import { evaluateMissionState, recordMissions } from './missions';
import { resolveVerification } from './resolver';
import { handleRoute } from './routes';
import { runScheduler } from './scheduler';
import { cloneJson, createState } from './state';
import type { Ctx, EngineState } from './types';
import { STATE_VERSION } from './types';

export interface EngineDeps {
  /** Verification resolver (sub-task B2); defaults to ./resolver. */
  resolve?: ResolveFn;
}

export type { EngineState } from './types';

/** The engine API typed with the concrete state; assignable to EngineApi<EngineStateEnvelope> by the runtime. */
export type DemoEngine = EngineApi<EngineState>;

export function createEngine(deps: EngineDeps = {}): DemoEngine {
  // Resolved lazily so a missing resolver implementation only fails when a verification is actually needed.
  const resolve: ResolveFn = deps.resolve ?? ((input) => resolveVerification(input));

  const makeCtx = (state: EngineState, clock: Clock): Ctx => ({
    state: cloneJson(state),
    now: clock.now,
    wallMs: clock.wallMs,
    audit: [],
    resolve,
  });

  return {
    STATE_VERSION,

    createInitialState(fx: FixtureBundle, options: EngineOptions, wallMs: number): EngineState {
      return createState(fx, options, wallMs);
    },

    clockFrom(state: EngineState, wallMs: number): Clock {
      return clockAt(state.clock, wallMs, state.last_tick);
    },

    tick(state: EngineState, clock: Clock): { state: EngineState; audit: AuditDraft[] } {
      const ctx = makeCtx(state, clock);
      runScheduler(ctx);
      recordMissions(ctx);
      return { state: ctx.state, audit: ctx.audit };
    },

    dispatch(state: EngineState, req: EngineRequest, clock: Clock): EngineResult<EngineState> {
      const ctx = makeCtx(state, clock);
      runScheduler(ctx); // scheduled jobs and job progression first (contract: dispatch calls tick first)
      let response;
      try {
        response = handleRoute(ctx, req);
      } catch (e) {
        // Problems are normal responses; state changes made before the problem (counters, audit) are kept.
        if (!(e instanceof ProblemError)) throw e;
        response = e.response;
      }
      recordMissions(ctx);
      return { state: ctx.state, response, audit: ctx.audit };
    },

    evaluateMissions(state: EngineState): MissionProgress[] {
      return evaluateMissionState(state);
    },
  };
}
