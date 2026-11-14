// Demo bar (spec 7.6 row 0): the non-dismissible demo banner + persona switcher, simulated clock with time advance,
// fault switches, reset and a missions link. It is the page's <header> landmark.
//
// F9 / ADR P0-16: the bar is PINNED to the top of the viewport (`sticky top-0 z-50`, opaque background) so a screenshot of
// the lower part of a long page still shows the demo notice (spec section 5). The bar has no close button.
//
// At 390 px the controls collapse behind a menu toggle (the banner and the clock stay visible). From `md` up they are
// always shown. The collapsing is CSS only (Tailwind `hidden md:flex`), so nothing is unmounted.
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api, demoApi } from '../../api';
import { ADVANCE_DURATIONS, type AdvanceDuration, type FaultToggleKey } from '../../contracts/api';
import type { ApiResult } from '../../contracts/api-client';
import type { Persona, PersonaId } from '../../contracts/fixtures';
import { MISSIONS } from '../../contracts/missions';
import { ROLE_HOME, ROUTES } from '../../contracts/routes';
import { TID } from '../../contracts/testids';
import { DEMO_BANNER_TEXT } from '../../config/demo';
import { Button } from '../../components/Button';
import { Dialog } from '../../components/Dialog';
import { FAULT_LABEL_TH, FAULT_TOGGLE_KEYS, faultPatch, isFaultOn } from '../../components/faultToggle';
import { ROLE_LABEL_TH } from '../../components/roles';
import { useAppStore } from '../../store';
import { ADVANCE_LABEL_TH, formatSimTime } from './format';

/** Value of the persona <select> option that signs out and opens /login instead of switching persona. */
export const SELF_LOGIN_VALUE = 'self-login';
/** The clock/status poll interval (plan: poll demoApi.status() every 1000 ms). */
export const STATUS_POLL_MS = 1000;

const CONTROLS_ID = 'demo-bar-controls';

export function DemoBar() {
  const navigate = useNavigate();
  const user = useAppStore((s) => s.user);
  const demo = useAppStore((s) => s.demo);
  const dataVersion = useAppStore((s) => s.dataVersion);
  const [menuOpen, setMenuOpen] = useState(false);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  // Clock + status: one call now, again whenever the data version changes, and then every second.
  useEffect(() => {
    void useAppStore.getState().refreshDemoStatus();
  }, [dataVersion]);
  useEffect(() => {
    const timer = setInterval(() => void useAppStore.getState().refreshDemoStatus(), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, []);

  // Persona list for the switcher (static fixture data, loaded once).
  useEffect(() => {
    let cancelled = false;
    demoApi
      .personas()
      .then((r) => {
        if (!cancelled && r.ok) setPersonas(r.data);
      })
      .catch(() => {}); // the client reports failures as results; a throw is a transport bug we can only ignore here
    return () => {
      cancelled = true;
    };
  }, []);

  /** Runs one demo action: resolves with the response data, or null after showing a Thai error. Always releases the busy flag. */
  const act = useCallback(async <T,>(call: () => Promise<ApiResult<T>>, failText: string): Promise<T | null> => {
    setBusy(true);
    setMessage(null);
    try {
      const result = await call();
      if (!result.ok) {
        setMessage(`${failText}: ${result.error.title}`);
        return null;
      }
      return result.data;
    } catch {
      setMessage(`${failText}: ติดต่อระบบจำลองไม่ได้`);
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const onPersonaChange = async (value: string) => {
    if (value === SELF_LOGIN_VALUE) {
      // "Try logging in yourself": end the server-side session (best effort), clear ours, go to the login page.
      await api.auth.logout().catch(() => undefined);
      useAppStore.getState().clearSession();
      navigate(ROUTES.login);
      return;
    }
    const session = await act(() => demoApi.switchPersona(value as PersonaId), 'สลับบทบาทไม่สำเร็จ');
    if (!session) return;
    useAppStore.getState().setSession(session.token, session.user);
    navigate(ROLE_HOME[session.user.role]);
    // setSession bumped the data version, which re-fetches the status (see the effect above).
  };

  const onAdvance = async (d: AdvanceDuration) => {
    const status = await act(() => demoApi.setClock(d), 'เลื่อนเวลาไม่สำเร็จ');
    if (!status) return;
    useAppStore.setState({ demo: status }); // show the new time at once; the bump below re-fetches anyway
    useAppStore.getState().bumpDataVersion();
  };

  const onFault = async (key: FaultToggleKey) => {
    const faults = useAppStore.getState().demo?.faults;
    if (!faults) return;
    const status = await act(() => demoApi.setFaults(faultPatch(key, !isFaultOn(key, faults))), 'เปลี่ยนสวิตช์ไม่สำเร็จ');
    if (!status) return;
    useAppStore.setState({ demo: status });
    useAppStore.getState().bumpDataVersion();
  };

  const onResetConfirmed = async () => {
    setConfirmingReset(false);
    // reset() resolves with null data on success, so test `ok` through a wrapper instead of the data.
    const ok = await act(async () => {
      const r = await demoApi.reset();
      return r.ok ? { ok: true as const, status: r.status, data: true as const } : r;
    }, 'รีเซ็ตไม่สำเร็จ');
    if (!ok) return;
    // The runtime removed every pcpsd.* key (including the session token): drop the in-memory session too.
    useAppStore.getState().clearSession();
    useAppStore.getState().bumpDataVersion(); // pages and the status poll reload against the fresh state
  };

  const faults = demo?.faults;
  const missionsDone = demo?.missions.filter((m) => m.done).length ?? 0;

  return (
    <header data-testid={TID.demoBar.root} className="sticky top-0 z-50 border-b border-slate-300 bg-white shadow-sm">
      <p data-testid={TID.demoBar.banner} className="bg-amber-300 px-4 py-2 text-center text-sm font-semibold text-slate-900">
        {DEMO_BANNER_TEXT}
      </p>

      <div className="mx-auto max-w-5xl px-4 py-2">
        {/* Always visible row: simulated time + (narrow screens only) the menu toggle. */}
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm text-slate-900">
            <span className="text-slate-700">เวลาจำลอง: </span>
            <time data-testid={TID.demoBar.clockNow} dateTime={demo?.now} data-now={demo?.now} className="font-mono font-semibold">
              {demo ? formatSimTime(demo.now) : '—'}
            </time>
            {demo?.clock_mode === 'frozen' ? <span className="ml-1 text-xs text-slate-700">(หยุดเวลา)</span> : null}
          </p>
          <Button
            variant="secondary"
            size="sm"
            className="md:hidden"
            data-testid={TID.demoBar.menuToggle}
            aria-expanded={menuOpen}
            aria-controls={CONTROLS_ID}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? 'ซ่อนเมนูสาธิต' : 'เมนูสาธิต'}
          </Button>
        </div>

        <div
          id={CONTROLS_ID}
          role="group"
          aria-label="ตัวควบคุมโหมดสาธิต"
          className={menuOpen ? 'mt-2 flex flex-col gap-3' : 'hidden md:mt-2 md:flex md:flex-wrap md:items-end md:gap-x-6 md:gap-y-2'}
        >
          <div>
            <label htmlFor="demo-persona-select" className="block text-xs font-medium text-slate-700">
              สลับบทบาท
            </label>
            <select
              id="demo-persona-select"
              data-testid={TID.demoBar.personaSelect}
              value={user?.id ?? ''}
              disabled={busy}
              onChange={(e) => void onPersonaChange(e.target.value)}
              className="mt-0.5 block min-h-8 w-full rounded border border-slate-500 bg-white px-2 py-1 text-sm text-slate-900"
            >
              <option value="" disabled>
                — ยังไม่ได้เลือกบทบาท —
              </option>
              {personas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} · {ROLE_LABEL_TH[p.role]}
                </option>
              ))}
              <option value={SELF_LOGIN_VALUE}>ลองล็อกอินเอง</option>
            </select>
          </div>

          <div role="group" aria-label="เลื่อนเวลาจำลอง">
            <span className="block text-xs font-medium text-slate-700">เลื่อนเวลา</span>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {ADVANCE_DURATIONS.map((d) => (
                <Button key={d} variant="secondary" size="sm" data-testid={TID.demoBar.clockAdvance(d)} disabled={busy} onClick={() => void onAdvance(d)}>
                  {ADVANCE_LABEL_TH[d]}
                </Button>
              ))}
            </div>
          </div>

          <div role="group" aria-label="สวิตช์ความผิดพลาด">
            <span className="block text-xs font-medium text-slate-700">จำลองระบบขัดข้อง</span>
            <div className="mt-0.5 flex flex-wrap gap-1">
              {FAULT_TOGGLE_KEYS.map((key) => {
                const on = faults ? isFaultOn(key, faults) : false;
                return (
                  <Button
                    key={key}
                    variant={on ? 'danger' : 'secondary'}
                    size="sm"
                    data-testid={TID.demoBar.fault(key)}
                    aria-pressed={on}
                    disabled={busy || !faults}
                    onClick={() => void onFault(key)}
                  >
                    {FAULT_LABEL_TH[key]}
                  </Button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 md:self-end">
            <Button variant="secondary" size="sm" data-testid={TID.demoBar.reset} disabled={busy} onClick={() => setConfirmingReset(true)}>
              รีเซ็ตข้อมูลสาธิต
            </Button>
            <Link
              to={ROUTES.missions}
              data-testid={TID.demoBar.missionsLink}
              className="inline-flex min-h-8 items-center rounded border border-blue-800 px-2 py-1 text-xs font-medium text-blue-900 hover:bg-blue-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
            >
              ภารกิจ ({missionsDone}/{MISSIONS.length})
            </Link>
          </div>
        </div>

        {message ? (
          <p role="status" data-testid="demo-bar-message" className="mt-1 text-sm font-medium text-red-800">
            {message}
          </p>
        ) : null}
      </div>

      <Dialog open={confirmingReset} title="รีเซ็ตข้อมูลสาธิตทั้งหมด?" onClose={() => setConfirmingReset(false)}>
        <p className="mb-4 text-sm text-slate-800">
          เวลาจำลอง ใบรับรอง เอกสาร และความคืบหน้าภารกิจจะกลับไปเป็นค่าเริ่มต้น และจะออกจากระบบด้วย ย้อนกลับไม่ได้
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setConfirmingReset(false)}>
            ยกเลิก
          </Button>
          <Button variant="danger" data-testid={TID.demoBar.resetConfirm} onClick={() => void onResetConfirmed()}>
            รีเซ็ตทั้งหมด
          </Button>
        </div>
      </Dialog>
    </header>
  );
}
