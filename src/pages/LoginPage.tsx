// /login (spec 7.6 no. 11): two-step login (password -> MFA code), demo credentials shown on the page (spec 7.1),
// lockout message with the simulated unlock time (A5: 3 wrong passwords lock the account for 5 simulated minutes).
// Public page (no RequireRole). Persona switching in the demo bar does not need this page; it is for trying the real flow.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { api, demoApi } from '../api';
import { formatSimTime } from '../app/DemoBar/format';
import { Button, Card, useApi, LayeredContent } from '../components';
import { ROLE_HOME } from '../contracts/routes';
import { TID } from '../contracts/testids';
import { ROLE_LABEL_TH } from '../components/roles';
import { useAppStore } from '../store';
import loginContent from '../content/certs/login.md?raw';
import { describeError } from './lifecycle/problem';

// Shown on screen so the learner can log in (spec 7.1). Same values as the fixture constants demo_password / demo_mfa;
// UI code may not import src/fixtures, so they are repeated here. A mismatch would show up as a failing login in the e2e spec.
const DEMO_PASSWORD = 'demo-password';
const DEMO_MFA_CODE = '246810';

export function LoginPage() {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const setSession = useAppStore((s) => s.setSession);
  const clearSession = useAppStore((s) => s.clearSession);
  const personas = useApi(() => demoApi.personas());

  const [step, setStep] = useState<'password' | 'mfa'>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [ticket, setTicket] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setLockedUntil(null);
    try {
      const result = await api.auth.login({ email: email.trim(), password });
      if (!result.ok) {
        if (result.error.code === 'ACCOUNT_LOCKED') setLockedUntil(result.error.locked_until ?? result.error.problem?.locked_until ?? '');
        else setError(describeError(result.error));
        return;
      }
      setTicket(result.data.mfa_ticket);
      setPassword(''); // the password is not needed after step 1
      setStep('mfa');
    } finally {
      setBusy(false);
    }
  };

  const submitMfa = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await api.auth.mfa({ mfa_ticket: ticket, code: code.trim() });
      if (!result.ok) {
        setError(describeError(result.error));
        return;
      }
      setSession(result.data.token, result.data.user);
      navigate(ROLE_HOME[result.data.user.role]);
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await api.auth.logout().catch(() => undefined);
    clearSession();
  };

  return (
    <section data-testid={TID.page('login')}>
      <h1 className="text-2xl font-bold">เข้าสู่ระบบ</h1>

      <div className="mt-3 space-y-4">
        <Card title="บัญชีและรหัสสำหรับสาธิต" testId={TID.login.demoCreds}>
          <p className="text-sm">
            ทุกบัญชีใช้รหัสผ่านเดียวกัน: <code className="rounded bg-slate-100 px-1">{DEMO_PASSWORD}</code> และรหัส MFA:{' '}
            <code className="rounded bg-slate-100 px-1">{DEMO_MFA_CODE}</code>
          </p>
          {personas.data ? (
            <ul className="mt-2 space-y-1 text-sm">
              {personas.data.map((p) => (
                <li key={p.id}>
                  <span className="font-mono">{p.email}</span> · {p.display_name} ({ROLE_LABEL_TH[p.role]})
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        {user ? (
          <div role="status" className="rounded border border-slate-300 bg-white p-3 text-sm">
            ตอนนี้คุณใช้บทบาท <strong>{ROLE_LABEL_TH[user.role]}</strong> ({user.display_name}){' '}
            <Button variant="secondary" size="sm" onClick={() => void signOut()}>
              ออกจากระบบ
            </Button>
          </div>
        ) : null}

        <Card title={step === 'password' ? 'ขั้นที่ 1: อีเมลและรหัสผ่าน' : 'ขั้นที่ 2: รหัส MFA'}>
          {step === 'password' ? (
            <form onSubmit={(e) => void submitPassword(e)} noValidate>
              <label htmlFor="login-email" className="block text-sm font-medium">
                อีเมล
              </label>
              <input
                id="login-email"
                data-testid={TID.login.email}
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded border border-slate-500 px-3 py-2 text-base"
              />
              <label htmlFor="login-password" className="mt-3 block text-sm font-medium">
                รหัสผ่าน
              </label>
              <input
                id="login-password"
                data-testid={TID.login.password}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded border border-slate-500 px-3 py-2 text-base"
              />
              <div className="mt-3">
                <Button type="submit" data-testid={TID.login.submit} disabled={busy || email.trim() === '' || password === ''}>
                  ต่อไป
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={(e) => void submitMfa(e)} noValidate>
              <p className="mb-2 text-sm">รหัสผ่านถูกต้อง ใส่รหัส MFA 6 หลักเพื่อเข้าสู่ระบบ</p>
              <label htmlFor="login-mfa" className="block text-sm font-medium">
                รหัส MFA
              </label>
              <input
                id="login-mfa"
                data-testid={TID.login.mfaInput}
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={12}
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1 block w-full rounded border border-slate-500 px-3 py-2 text-base"
              />
              <div className="mt-3 flex gap-2">
                <Button type="submit" data-testid={TID.login.mfaSubmit} disabled={busy || code.trim() === ''}>
                  เข้าสู่ระบบ
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setStep('password');
                    setCode('');
                    setError(null);
                  }}
                >
                  กลับไปขั้นที่ 1
                </Button>
              </div>
            </form>
          )}

          {lockedUntil !== null ? (
            <p role="alert" data-testid={TID.login.lockMessage} className="mt-3 rounded border border-red-700 bg-red-50 p-3 text-sm font-medium text-red-900">
              ใส่รหัสผ่านผิดครบ 3 ครั้ง บัญชีถูกล็อก
              {lockedUntil ? ` จะปลดล็อกเมื่อ ${formatSimTime(lockedUntil)} (เวลาจำลอง)` : ' ชั่วคราว'} กดปุ่ม "+5 นาที" ที่แถบสาธิตเพื่อรอเวลาจำลอง
            </p>
          ) : null}
          {error ? (
            <p role="alert" className="mt-3 text-sm font-medium text-red-800">
              {error}
            </p>
          ) : null}
        </Card>

        <Card title="เกี่ยวกับการเข้าสู่ระบบ">
          <LayeredContent markdown={loginContent} />
        </Card>
      </div>
    </section>
  );
}
