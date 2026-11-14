// Response helpers: RFC 9457 problem+json bodies and a throwable wrapper for early exits in handlers.
import type { ProblemDto } from '../contracts/api';
import type { EngineResponse } from '../contracts/engine';
import type { Instant, MainSpecRef } from '../contracts/fixtures';

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  422: 'Unprocessable Content',
  423: 'Locked',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  501: 'Not Implemented',
  503: 'Service Unavailable',
  507: 'Insufficient Storage',
};

export interface ProblemExtras {
  retry_after_s?: number;
  locked_until?: Instant;
  /** Main-spec reference of the violated rule (extension member of the problem object). */
  ref?: MainSpecRef;
}

/** The problem object as the contract defines it (`ref` is already a member of ProblemDto). */
export type ProblemBody = ProblemDto;

export function ok(body: unknown, status = 200, headers?: Record<string, string>): EngineResponse {
  return headers ? { status, body, headers } : { status, body };
}

export function problemBody(status: number, code: string, detail?: string, extras: ProblemExtras = {}): ProblemBody {
  const body: ProblemBody = {
    type: `/problems/${code}`,
    title: TITLES[status] ?? 'Error',
    status,
    code,
  };
  if (detail !== undefined) body.detail = detail;
  if (extras.retry_after_s !== undefined) body.retry_after_s = extras.retry_after_s;
  if (extras.locked_until !== undefined) body.locked_until = extras.locked_until;
  if (extras.ref !== undefined) body.ref = extras.ref;
  return body;
}

export function problem(status: number, code: string, detail?: string, extras: ProblemExtras = {}): EngineResponse {
  const res: EngineResponse = { status, body: problemBody(status, code, detail, extras) };
  if (extras.retry_after_s !== undefined) res.headers = { 'Retry-After': String(extras.retry_after_s) };
  return res;
}

/** Thrown by handlers to stop with a problem response; dispatch catches it and still returns the mutated state. */
export class ProblemError extends Error {
  readonly response: EngineResponse;
  constructor(response: EngineResponse) {
    super(`problem ${response.status}`);
    this.response = response;
  }
}

export function fail(status: number, code: string, detail?: string, extras: ProblemExtras = {}): never {
  throw new ProblemError(problem(status, code, detail, extras));
}

// ---------- tiny body validators (400 INVALID_REQUEST on shape errors) ----------
export function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    fail(400, 'INVALID_REQUEST', 'ต้องส่งข้อมูลแบบ JSON object');
  }
  return body as Record<string, unknown>;
}

export function reqString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  if (typeof v !== 'string' || v.length === 0) fail(400, 'INVALID_REQUEST', `ต้องระบุ ${key} (ข้อความ)`);
  return v;
}
