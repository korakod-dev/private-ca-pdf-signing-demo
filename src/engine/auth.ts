// Authentication: two-step login (password -> MFA ticket -> token), lockout, sessions, role and MFA checks.
// Assumption A5: 3 failed password attempts lock the account for 5 SIMULATED minutes (423 ACCOUNT_LOCKED).
import type { LoginResponse, SessionDto } from '../contracts/api';
import type { EngineRequest, EngineResponse } from '../contracts/engine';
import type { Persona, PersonaId, Role } from '../contracts/fixtures';
import { addDuration, diffMs, isBefore } from './clock';
import { asObject, fail, ok, reqString } from './http';
import { emit, findPersona, isAdminRole, nextId, toUserSummary } from './state';
import type { Ctx, EngineState } from './types';

/** Persona behind the bearer token, or null (no token / unknown token). */
export function actorOf(state: EngineState, req: EngineRequest): Persona | null {
  if (!req.token) return null;
  const session = state.sessions[req.token];
  if (!session) return null;
  return findPersona(state, session.user);
}

/** 401 when not signed in, 403 when the role is not allowed. `roles` omitted = any signed-in persona. */
export function requireActor(state: EngineState, req: EngineRequest, roles?: readonly Role[]): Persona {
  const actor = actorOf(state, req);
  if (!actor) fail(401, 'UNAUTHENTICATED', 'ต้องเข้าสู่ระบบก่อน');
  if (roles && !roles.includes(actor.role)) fail(403, 'FORBIDDEN', 'บทบาทนี้ไม่มีสิทธิ์ทำรายการนี้');
  return actor;
}

/** Checks the X-Demo-MFA header. `mode` comes from API_ROUTES[route].mfa. */
export function requireMfa(state: EngineState, req: EngineRequest, actor: Persona | null, mode: 'always' | 'admin' | 'none'): void {
  const needed = mode === 'always' || (mode === 'admin' && actor !== null && isAdminRole(actor.role));
  if (!needed) return;
  if (!req.mfa) fail(403, 'MFA_REQUIRED', 'ต้องยืนยันรหัส MFA (header X-Demo-MFA)');
  if (req.mfa !== state.system.demo_mfa) fail(403, 'MFA_INVALID', 'รหัส MFA ไม่ถูกต้อง');
}

export function createSession(ctx: Ctx, persona: Persona): SessionDto {
  const n = nextId(ctx.state, 'token');
  const token = `demo-token-${persona.id}-${n}`;
  ctx.state.sessions[token] = { user: persona.id, created_at: ctx.now };
  return { token, user: toUserSummary(persona) };
}

/** POST auth.login: {email,password} -> {mfa_ticket} | 401 | 423. */
export function login(ctx: Ctx, body: unknown): EngineResponse {
  const b = asObject(body);
  const email = reqString(b, 'email').trim().toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  const s = ctx.state;
  const persona = s.personas.find((p) => p.email.toLowerCase() === email);
  const rec = persona ? s.users[persona.id] : undefined;
  if (!persona || !rec) fail(401, 'INVALID_CREDENTIALS', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');

  // An expired lock clears itself on the next attempt.
  if (rec.locked_until && !isBefore(ctx.now, rec.locked_until)) {
    rec.locked_until = null;
    rec.failures = 0;
  }
  if (rec.locked_until) {
    const wait = Math.max(1, Math.ceil(diffMs(rec.locked_until, ctx.now) / 1000));
    fail(423, 'ACCOUNT_LOCKED', 'บัญชีถูกล็อกชั่วคราว', { locked_until: rec.locked_until, retry_after_s: wait });
  }
  if (password !== s.system.demo_password) {
    rec.failures += 1;
    emit(ctx, persona.id, 'auth.login_failed', persona.id, { failures: rec.failures });
    if (rec.failures >= s.system.lockout.max_failures) {
      rec.locked_until = addDuration(ctx.now, `PT${s.system.lockout.minutes}M`);
      emit(ctx, persona.id, 'auth.locked', persona.id, { locked_until: rec.locked_until });
      fail(423, 'ACCOUNT_LOCKED', 'ใส่รหัสผิดครบ 3 ครั้ง บัญชีถูกล็อกชั่วคราว', {
        locked_until: rec.locked_until,
        retry_after_s: s.system.lockout.minutes * 60,
      });
    }
    fail(401, 'INVALID_CREDENTIALS', 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  }
  rec.failures = 0;
  const ticket = `mfa-${nextId(s, 'ticket')}`;
  s.mfa_tickets[ticket] = { user: persona.id, created_at: ctx.now };
  const res: LoginResponse = { mfa_ticket: ticket };
  return ok(res);
}

/** POST auth.mfa: {mfa_ticket, code} -> {token,user}. A ticket is single-use; a wrong code keeps it valid. */
export function mfaStep(ctx: Ctx, body: unknown): EngineResponse {
  const b = asObject(body);
  const ticket = reqString(b, 'mfa_ticket');
  const code = typeof b.code === 'string' ? b.code : '';
  const entry = ctx.state.mfa_tickets[ticket];
  if (!entry) fail(401, 'INVALID_CREDENTIALS', 'MFA ticket ไม่ถูกต้องหรือถูกใช้แล้ว');
  if (code !== ctx.state.system.demo_mfa) fail(401, 'MFA_INVALID', 'รหัส MFA ไม่ถูกต้อง');
  delete ctx.state.mfa_tickets[ticket];
  const persona = findPersona(ctx.state, entry.user);
  const session = createSession(ctx, persona);
  emit(ctx, persona.id, 'auth.login', persona.id, {});
  return ok(session);
}

export function logout(ctx: Ctx, req: EngineRequest): EngineResponse {
  if (req.token) delete ctx.state.sessions[req.token];
  return { status: 204, body: null };
}

export function personaById(state: EngineState, id: PersonaId): Persona | undefined {
  return state.personas.find((p) => p.id === id);
}
