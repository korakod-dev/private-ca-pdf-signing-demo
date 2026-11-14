// /pki/status (spec 7.6 page 13, used by mission M6): the current CRL of the document-signing CA, an OCSP query by serial,
// and the R14 warning when OCSP says "revoked" for a serial that the CRL does not list yet (computed here, see pki/r14.ts).
//
// Both answers are re-fetched when the demo data version changes (clock advance, fault toggle, persona switch), so the
// R14 comparison never mixes an old OCSP answer with a new CRL.
import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { Button, Card, useApi, LayeredContent } from '../components';
import { getMarkdown as getInfoMarkdown } from './info/content';
import type { OcspDto } from '../contracts/api';
import type { ApiResult } from '../contracts/api-client';
import { TID } from '../contracts/testids';
import { formatSimTime } from './info/format';
import { OCSP_STATUS_TH, REASON_TH } from './pki/labels';
import { isR14Window, r14NotComparable } from './pki/r14';
import { ProblemBox } from './verify/ProblemBox';

const DOC_SIGNING_CA = 'doc-signing-2026';
const NO_QUERY: ApiResult<OcspDto | null> = { ok: true, status: 200, data: null };

export function PkiStatusPage() {
  const crl = useApi(() => api.pki.crl(DOC_SIGNING_CA), []);

  const [serialInput, setSerialInput] = useState('');
  const [queried, setQueried] = useState<string | null>(null);
  const ocsp = useApi<OcspDto | null>(() => (queried === null ? Promise.resolve(NO_QUERY) : api.pki.ocsp(queried)), [queried]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const serial = serialInput.trim();
    if (serial === '') return;
    if (serial === queried) ocsp.reload();
    else setQueried(serial);
  };

  // Only judge R14 when the OCSP answer is for the serial that was asked (the hook keeps the previous answer while loading).
  const ocspAnswer = ocsp.data && ocsp.data.serial === queried ? ocsp.data : null;
  const crlData = crl.data ?? null;
  const r14 = isR14Window(ocspAnswer, crlData);
  const notComparable = r14NotComparable(ocspAnswer, crlData);

  return (
    <section data-testid={TID.page('pkiStatus')} className="space-y-6">
      <h1 className="text-2xl font-bold">สถานะใบรับรอง (CRL / OCSP)</h1>

      <Card title="CRL ปัจจุบัน" headingLevel={2}>
        {crl.error ? (
          <ProblemBox error={crl.error} />
        ) : crlData ? (
          <>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              <div>
                <dt className="inline font-medium">หมายเลข CRL: </dt>
                <dd className="inline font-mono" data-testid={TID.pki.crlNumber}>
                  {crlData.number}
                </dd>
              </div>
              <div>
                <dt className="inline font-medium">ออกเมื่อ: </dt>
                <dd className="inline">{formatSimTime(crlData.this_update)}</dd>
              </div>
              <div>
                <dt className="inline font-medium">ฉบับถัดไปไม่เกิน: </dt>
                <dd className="inline" data-testid={TID.pki.crlNextUpdate}>
                  {formatSimTime(crlData.next_update)}
                </dd>
              </div>
            </dl>
            <div className="mt-3" data-testid={TID.pki.crlEntries} data-count={crlData.entries.length}>
              {crlData.entries.length === 0 ? (
                <p>ยังไม่มีใบรับรองในรายการเพิกถอน</p>
              ) : (
                // tabIndex: the table scrolls sideways on a phone, so the region must be reachable by keyboard.
                // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
                <div className="overflow-x-auto" role="region" aria-label="รายการเพิกถอนใน CRL" tabIndex={0}>
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">รายการใบรับรองที่ถูกเพิกถอนใน CRL</caption>
                    <thead>
                      <tr className="border-b border-slate-300">
                        <th scope="col" className="py-1 pr-3">เลขซีเรียล</th>
                        <th scope="col" className="py-1 pr-3">เพิกถอนเมื่อ</th>
                        <th scope="col" className="py-1 pr-3">เหตุผล</th>
                        <th scope="col" className="py-1">มีผลย้อนหลังถึง (invalidity)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {crlData.entries.map((e) => (
                        <tr key={e.serial} className="border-b border-slate-200">
                          <td className="py-1 pr-3 font-mono">{e.serial}</td>
                          <td className="py-1 pr-3">{formatSimTime(e.revoked_at)}</td>
                          <td className="py-1 pr-3">{REASON_TH[e.reason]}</td>
                          <td className="py-1">{e.invalidity_date ? formatSimTime(e.invalidity_date) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        ) : (
          <p className="text-slate-700">กำลังโหลด CRL…</p>
        )}
        <div className="mt-3">
          <LayeredContent markdown={getInfoMarkdown('pki/crl-ocsp')} />
        </div>
      </Card>

      <Card title="ถามสถานะผ่าน OCSP" headingLevel={2}>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label htmlFor="pki-ocsp-input" className="block font-medium">
              เลขซีเรียลของใบรับรอง
            </label>
            <input
              id="pki-ocsp-input"
              data-testid={TID.pki.ocspInput}
              type="text"
              value={serialInput}
              onChange={(e) => setSerialInput(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              placeholder="เช่น DE:M0:xx:xx:xx:xx"
              className="mt-1 w-full rounded border border-slate-500 bg-white px-3 py-2 font-mono text-sm text-slate-900"
            />
          </div>
          <Button type="submit" data-testid={TID.pki.ocspQuery} disabled={serialInput.trim() === ''}>
            ถามสถานะ
          </Button>
        </form>

        <div role="status" aria-live="polite" className="mt-3">
          {queried !== null && ocsp.error ? (
            <div data-testid={TID.pki.ocspResult} data-status="unavailable">
              <ProblemBox error={ocsp.error} />
            </div>
          ) : null}
          {ocspAnswer ? (
            <div
              data-testid={TID.pki.ocspResult}
              data-status={ocspAnswer.status}
              className={`rounded border p-3 ${OCSP_STATUS_TH[ocspAnswer.status].cls}`}
            >
              <p className="font-semibold">
                <span aria-hidden="true">{OCSP_STATUS_TH[ocspAnswer.status].symbol} </span>
                <span className="font-mono">{ocspAnswer.serial}</span>: {OCSP_STATUS_TH[ocspAnswer.status].th}
              </p>
              {ocspAnswer.status === 'revoked' ? (
                <p className="mt-1 text-sm">
                  เพิกถอนเมื่อ {ocspAnswer.revoked_at ? formatSimTime(ocspAnswer.revoked_at) : '—'}
                  {ocspAnswer.reason ? ` · เหตุผล: ${REASON_TH[ocspAnswer.reason]}` : ''}
                </p>
              ) : null}
              <p className="mt-1 text-sm">
                คำตอบสร้างเมื่อ {formatSimTime(ocspAnswer.produced_at)} · ผู้ตอบ <span className="font-mono">{ocspAnswer.responder_serial}</span>
              </p>
            </div>
          ) : null}
        </div>

        {r14 ? (
          <div role="alert" data-testid={TID.pki.r14Warning} className="mt-3 rounded border border-amber-700 bg-amber-50 p-3 text-slate-900">
            <p className="font-semibold">คำเตือน R14: OCSP กับ CRL ไม่ตรงกันตอนนี้</p>
            <p className="mt-1">OCSP บอกว่าใบรับรองนี้ถูกเพิกถอนแล้ว แต่ CRL ยังไม่มีเลขซีเรียลนี้ ต้องรอ CRL ออกรอบถัดไป</p>
            <div className="mt-2">
              <LayeredContent markdown={getInfoMarkdown('pki/r14')} />
            </div>
          </div>
        ) : null}
        {notComparable ? (
          <p className="mt-3 rounded border border-amber-700 bg-amber-50 p-3 text-slate-900">
            OCSP บอกว่าถูกเพิกถอนแล้ว แต่ดึง CRL ไม่ได้ในตอนนี้ จึงเทียบหน้าต่าง R14 ไม่ได้
          </p>
        ) : null}
      </Card>
    </section>
  );
}
