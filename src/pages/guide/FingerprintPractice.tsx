// Fingerprint practice (mission M1): the learner types the fingerprint of the Root CA and the page says whether it matches.
// On a match it reports progress `M1.fingerprint_matched` (demo-only API). The reference value comes from the API
// (GET /pki/cas, the root-2026 entry), never from a bundled fixture.
import { useState, type FormEvent } from 'react';
import { api, demoApi } from '../../api';
import { Button, Card, useApi } from '../../components';
import { TID } from '../../contracts/testids';
import { fingerprintMatches } from './fingerprint';

type Outcome = 'none' | 'match' | 'mismatch';

export function FingerprintPractice() {
  const cas = useApi(() => api.pki.cas(), []);
  const root = cas.data?.find((c) => c.id === 'root-2026') ?? null;

  const [typed, setTyped] = useState('');
  const [outcome, setOutcome] = useState<Outcome>('none');
  const [progressSaved, setProgressSaved] = useState(false);

  const check = async (event: FormEvent) => {
    event.preventDefault();
    if (!root) return;
    if (fingerprintMatches(typed, root.fingerprint_sha256)) {
      setOutcome('match');
      const result = await demoApi.progress('M1.fingerprint_matched');
      setProgressSaved(result.ok);
    } else {
      setOutcome('mismatch');
      setProgressSaved(false);
    }
  };

  return (
    <Card title="ฝึกเทียบ fingerprint ของ Root" headingLevel={2}>
      <div className="mb-3 rounded border border-slate-300 bg-slate-50 p-3">
        <p className="text-sm font-medium">ค่าที่ประกาศผ่านอีกช่องทางหนึ่ง (จำลองเป็นบัตรประกาศของผู้ดูแล)</p>
        {root ? (
          <>
            <p className="mt-1 text-sm">{root.subject}</p>
            <p className="mt-1 break-all font-mono text-sm">{root.fingerprint_sha256}</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-slate-700">{cas.error ? 'โหลดค่าที่ประกาศไม่ได้ ลองโหลดหน้านี้ใหม่' : 'กำลังโหลด…'}</p>
        )}
      </div>

      <form onSubmit={(e) => void check(e)} className="space-y-3">
        <div>
          <label htmlFor="guide-fp-input" className="block font-medium">
            พิมพ์ fingerprint ที่คุณอ่านได้จากไฟล์ Root ที่ดาวน์โหลดมา
          </label>
          <input
            id="guide-fp-input"
            data-testid={TID.guide.fpInput}
            type="text"
            value={typed}
            onChange={(e) => {
              setTyped(e.target.value);
              setOutcome('none');
            }}
            autoComplete="off"
            spellCheck={false}
            className="mt-1 w-full rounded border border-slate-500 bg-white px-3 py-2 font-mono text-sm text-slate-900"
          />
          <p className="mt-1 text-sm text-slate-700">
            ในเดโมไม่มีไฟล์จริงให้อ่าน ให้พิมพ์ค่าที่ประกาศไว้ด้านบนให้ตรง แล้วลองแก้ตัวอักษรเดียวดูว่าผลเปลี่ยนอย่างไร (ไม่สนตัวพิมพ์เล็กใหญ่ และเครื่องหมาย :)
          </p>
        </div>
        <Button type="submit" data-testid={TID.guide.fpCheck} disabled={!root}>
          เทียบ fingerprint
        </Button>
      </form>

      <div role="status" aria-live="polite" className="mt-3">
        {outcome !== 'none' ? (
          <p
            data-testid={TID.guide.fpResult}
            data-match={outcome === 'match' ? 'true' : 'false'}
            className={`rounded border p-3 font-medium ${
              outcome === 'match' ? 'border-green-700 bg-green-50 text-green-900' : 'border-red-700 bg-red-50 text-red-900'
            }`}
          >
            {outcome === 'match' ? (
              <>
                <span aria-hidden="true">✓ </span>ตรงกันทุกตัว ติดตั้ง Root นี้ได้
                {progressSaved ? ' (บันทึกความคืบหน้าภารกิจ M1 แล้ว)' : ''}
              </>
            ) : (
              <>
                <span aria-hidden="true">✗ </span>ไม่ตรง ห้ามติดตั้ง Root นี้ แม้จะต่างกันแค่ตัวเดียว
              </>
            )}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
