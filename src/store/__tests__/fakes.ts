// Shared test fakes for D's unit tests (API results, personas, demo status). Not production code.
import type { ApiResult } from '../../contracts/api-client';
import type { Persona, Role } from '../../contracts/fixtures';
import type { DemoStatusDto, UserSummary } from '../../contracts/store';

export const ok = <T>(data: T, status = 200): ApiResult<T> => ({ ok: true, status, data });
export const fail = (status: number, title: string, code = 'ERR'): ApiResult<never> => ({
  ok: false,
  error: { status, code, title, problem: null },
});

const p = (id: Persona['id'], display_name: string, role: Role, home_route: string): Persona => ({
  id,
  display_name,
  email: `${id}@lab.korakod.dev`,
  role,
  email_verified: true,
  last_in_person_proofing: null,
  home_route,
});

export const PERSONAS: Persona[] = [
  p('u-somchai', 'สมชาย ใจดี', 'signer', '/certs'),
  p('u-nattapon', 'ณัฐพล ทองดี', 'new_user', '/certs/request'),
  p('u-manop', 'มานพ รักงาน', 'user', '/certs'),
  p('u-guest', 'ผู้ตรวจทั่วไป', 'verifier', '/verify'),
  p('a-admin-a', 'ผู้ดูแล A', 'admin-a', '/admin/requests'),
  p('a-admin-b', 'ผู้ดูแล B', 'admin-b', '/admin/status'),
];

export const toUser = (persona: Persona): UserSummary => ({
  id: persona.id,
  display_name: persona.display_name,
  email: persona.email,
  role: persona.role,
});

export const status = (over: Partial<DemoStatusDto> = {}): DemoStatusDto => ({
  now: '2026-11-12T09:00:00+07:00',
  clock_mode: 'frozen',
  faults: { ocsp_down: false, crl_down: false, tsa_drift_ms: 0, queue_full: false },
  actor: null,
  missions: [],
  unread_mail: 0,
  tsa_offset_ms: 0,
  ...over,
});
