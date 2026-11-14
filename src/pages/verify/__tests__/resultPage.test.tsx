// /verify/:jobId: every indication renders, the "why" panel explains each check from content keyed by check.code,
// warnings are explained, raw JSON toggles, the download is a .txt, and "เก็บเข้าคลัง" follows the TOTAL-PASSED rule.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { VerifyJobDto, VerifyReport } from '../../../contracts/api';
import { TID } from '../../../contracts/testids';
import { check, cleanChecks, doneJob, fail, makeReport, ok, signature, userSummary } from '../../info/__tests__/helpers';

const mocks = vi.hoisted(() => ({ get: vi.fn(), archiveAdd: vi.fn() }));

vi.mock('../../../api', () => ({
  configureApi: vi.fn(),
  api: { verify: { get: mocks.get }, archive: { add: mocks.archiveAdd } },
  demoApi: {},
}));

import { useAppStore } from '../../../store';
import { VerifyResultPage } from '../../VerifyResultPage';
import { REPORT_FILE_NAME, buildReportText } from '../reportText';

function renderResult(jobId = 'job-0001') {
  return render(
    <MemoryRouter initialEntries={[`/verify/${jobId}`]}>
      <Routes>
        <Route path="/verify/:jobId" element={<VerifyResultPage />} />
        <Route path="/archive" element={<p>archive page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const withJob = (report: VerifyReport) => mocks.get.mockResolvedValue(ok(doneJob(report)));

// ---- one report per indication (shapes follow the resolver output) ----
const PASSED = makeReport();
const FAILED = makeReport({
  indication: 'TOTAL-FAILED',
  code: 'MODIFIED',
  questions: { modified: 'yes', signer_trusted: 'yes', valid_at_signing: 'yes' },
  document: { id: 'D02', file_name: 'memo-118-tampered.pdf', sha256: `de00${'b'.repeat(60)}`, pages: 2, size_bytes: 1 },
  signatures: [
    signature({
      indication: 'TOTAL-FAILED',
      code: 'MODIFIED',
      checks: cleanChecks().map((c) => (c.id === 'modification' ? check('modification', 'failed', 'MODIFIED_CONTENT') : c)),
    }),
  ],
});
const INDETERMINATE = makeReport({
  indication: 'INDETERMINATE',
  sub_indication: 'TRY_LATER',
  code: 'TRY_LATER',
  questions: { modified: 'no', signer_trusted: 'yes', valid_at_signing: 'unknown' },
  signatures: [
    signature({
      indication: 'INDETERMINATE',
      sub_indication: 'TRY_LATER',
      code: 'TRY_LATER',
      checks: cleanChecks().map((c) =>
        c.id === 'revocation'
          ? check('revocation', 'indeterminate', 'REVOCATION_UNAVAILABLE', ['R15'])
          : c.id === 'policy'
            ? check('policy', 'indeterminate', 'POLICY_LTV_IGNORED', ['R15'])
            : c,
      ),
    }),
  ],
});
const UNTRUSTED_MIXED = makeReport({
  indication: 'TOTAL-FAILED',
  sub_indication: 'NO_CERTIFICATE_CHAIN_FOUND',
  code: 'UNTRUSTED',
  questions: { modified: 'no', signer_trusted: 'no', valid_at_signing: 'unknown' },
  warnings: ['MIXED_TRUST'],
  signatures: [
    signature(),
    signature({
      id: 'D06-sig2',
      indication: 'TOTAL-FAILED',
      sub_indication: 'NO_CERTIFICATE_CHAIN_FOUND',
      code: 'UNTRUSTED',
      timestamp: null,
      checks: [
        check('integrity', 'passed', 'INTEGRITY_OK'),
        check('modification', 'passed', 'NOT_MODIFIED'),
        check('chain', 'failed', 'CHAIN_UNTRUSTED', ['V6']),
        check('poe', 'skipped', 'SKIPPED', ['V4']),
        check('validity', 'skipped', 'SKIPPED', ['V4']),
        check('revocation', 'skipped', 'SKIPPED', ['R15']),
        check('policy', 'passed', 'POLICY_STRICT_V1_OK'),
      ],
    }),
  ],
});
const NO_SIGNER = makeReport({
  document: { id: 'D09', file_name: 'notice-doc-timestamp-only.pdf', sha256: `de00${'c'.repeat(60)}`, pages: 1, size_bytes: 1 },
  questions: { modified: 'no', signer_trusted: 'unknown', valid_at_signing: 'unknown' },
  warnings: ['NO_SIGNER'],
  signatures: [],
  doc_timestamps: [{ time: '2026-11-01T08:00:00+07:00', tsa_serial: 'DE:M0:00:00:00:03' }],
});
const TSA_UNAVAILABLE = makeReport({
  indication: 'INDETERMINATE',
  sub_indication: 'TRY_LATER',
  code: 'TRY_LATER',
  warnings: ['NO_SIGNER', 'TSA_STATUS_UNAVAILABLE'],
  signatures: [],
  doc_timestamps: [{ time: '2026-11-01T08:00:00+07:00', tsa_serial: 'DE:M0:00:00:00:03' }],
});

beforeEach(() => {
  mocks.get.mockReset();
  mocks.archiveAdd.mockReset();
  localStorage.clear();
  useAppStore.setState({ token: null, user: null, demo: null, dataVersion: 0 });
});

describe('/verify/:jobId renders each indication', () => {
  it.each([
    ['TOTAL-PASSED', PASSED, '', 'VALID'],
    ['TOTAL-FAILED', FAILED, '', 'MODIFIED'],
    ['INDETERMINATE', INDETERMINATE, 'TRY_LATER', 'TRY_LATER'],
  ] as const)('%s', async (indication, report, sub, code) => {
    withJob(report);
    renderResult();
    const badge = await screen.findByTestId(TID.result.indication);
    expect(badge).toHaveAttribute('data-indication', indication);
    expect(screen.getByTestId(TID.result.subIndication)).toHaveAttribute('data-value', sub);
    expect(screen.getByTestId(TID.result.code)).toHaveAttribute('data-value', code);
    expect(screen.getByTestId(TID.result.questions)).toBeInTheDocument();
    expect(screen.getByTestId(TID.result.reportPreview)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ผลตรวจเอกสาร');
  });

  it('answers the three questions in words', async () => {
    withJob(INDETERMINATE);
    renderResult();
    const q = await screen.findByTestId(TID.result.questions);
    expect(q.querySelector('[data-question="modified"]')).toHaveAttribute('data-tone', 'good');
    expect(q.querySelector('[data-question="valid_at_signing"]')).toHaveAttribute('data-tone', 'unknown');
    expect(q.querySelector('[data-question="valid_at_signing"]')).toHaveTextContent('ตอบไม่ได้');
  });
});

describe('"ทำไมได้ผลนี้" is keyed by check.code', () => {
  it('shows the content of each check code, with technical details collapsed', async () => {
    withJob(FAILED);
    renderResult();
    const why = await screen.findByTestId(TID.result.why);
    const failedRow = why.querySelector('[data-check-code="MODIFIED_CONTENT"]') as HTMLElement;
    expect(failedRow).toHaveAttribute('data-check-result', 'failed');
    expect(failedRow).toHaveTextContent('ถูกแก้เนื้อหา');
    expect(why.querySelector('[data-check-code="INTEGRITY_OK"]')).toHaveTextContent('ตรงกับข้อมูลที่ถูกเซ็น');
    // Every technical layer is a collapsed <details>.
    const details = why.querySelectorAll('details');
    expect(details.length).toBeGreaterThan(0);
    details.forEach((d) => expect(d).not.toHaveAttribute('open'));
    // The document-level explanation is there too.
    expect(why).toHaveTextContent('ไม่ผ่าน เพราะเอกสารถูกแก้ไขหลังมีลายเซ็น');
  });

  it('explains skipped checks and shows the check codes of the unavailable-status case', async () => {
    withJob(INDETERMINATE);
    renderResult();
    const why = await screen.findByTestId(TID.result.why);
    expect(why.querySelector('[data-check-code="REVOCATION_UNAVAILABLE"]')).toHaveTextContent('OCSP และ CRL ใช้ไม่ได้');
    expect(why.querySelector('[data-check-code="POLICY_LTV_IGNORED"]')).toBeInTheDocument();
  });

  it('marks skipped checks (untrusted chain) and explains MIXED_TRUST', async () => {
    withJob(UNTRUSTED_MIXED);
    renderResult();
    const why = await screen.findByTestId(TID.result.why);
    expect(why.querySelectorAll('[data-check-code="SKIPPED"]')).toHaveLength(3);
    expect(screen.getByTestId(TID.result.warnings)).toHaveTextContent('MIXED_TRUST');
    expect(why).toHaveTextContent('ปนกัน');
  });

  it('explains NO_SIGNER for a document-timestamp-only document', async () => {
    withJob(NO_SIGNER);
    renderResult();
    const why = await screen.findByTestId(TID.result.why);
    expect(screen.getByTestId(TID.result.warnings)).toHaveTextContent('NO_SIGNER');
    expect(why).toHaveTextContent('ไม่มีผู้ลงนาม');
  });

  it('explains TSA_STATUS_UNAVAILABLE (A41)', async () => {
    withJob(TSA_UNAVAILABLE);
    renderResult();
    await screen.findByTestId(TID.result.indication);
    expect(screen.getByTestId(TID.result.warnings)).toHaveTextContent('TSA_STATUS_UNAVAILABLE');
    expect(screen.getByTestId(TID.result.why)).toHaveTextContent('เช็กสถานะใบรับรองของ TSA ไม่ได้');
  });

  it('shows "no warnings" when there are none', async () => {
    withJob(PASSED);
    renderResult();
    expect(await screen.findByTestId(TID.result.warnings)).toHaveTextContent('ไม่มีคำเตือน');
  });
});

describe('raw JSON and download', () => {
  it('toggles the raw JSON', async () => {
    withJob(PASSED);
    renderResult();
    const toggle = await screen.findByTestId(TID.result.rawToggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId(TID.result.raw)).toBeNull();
    await userEvent.setup().click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(JSON.parse(screen.getByTestId(TID.result.raw).textContent ?? '')).toMatchObject({ job_id: 'job-0001', indication: 'TOTAL-PASSED' });
  });

  it('offers DEMO-report.txt (never a PDF) and the text starts with the report heading', async () => {
    withJob(PASSED);
    renderResult();
    const button = await screen.findByTestId(TID.result.download);
    expect(button).toHaveAttribute('data-file-name', REPORT_FILE_NAME);
    expect(REPORT_FILE_NAME.endsWith('.txt')).toBe(true);
    const text = buildReportText(PASSED);
    expect(text).toContain('job-0001');
    expect(text).toContain('TOTAL-PASSED / - / VALID');
    expect(text).toContain('ไม่ใช่ผลตรวจจริง');
  });

  it('puts the watermark on the report preview', async () => {
    withJob(PASSED);
    renderResult();
    const preview = await screen.findByTestId(TID.result.reportPreview);
    const mark = preview.querySelector('svg[aria-hidden="true"]');
    expect(mark).toHaveTextContent('DEMO — ไม่ใช่ผลตรวจจริง');
    expect(within(preview).getByText(/ไม่ใช่รายงานจริง/)).toBeInTheDocument();
  });
});

describe('archive add', () => {
  it('is disabled for a failed result even when signed in', async () => {
    useAppStore.setState({ token: 't', user: userSummary() });
    withJob(FAILED);
    renderResult();
    expect(await screen.findByTestId(TID.result.archiveAdd)).toBeDisabled();
  });

  it('is disabled for a TOTAL-PASSED result when nobody is signed in', async () => {
    withJob(PASSED);
    renderResult();
    expect(await screen.findByTestId(TID.result.archiveAdd)).toBeDisabled();
  });

  it('adds a TOTAL-PASSED result for the signed-in user and then locks the button', async () => {
    useAppStore.setState({ token: 't', user: userSummary() });
    withJob(PASSED);
    mocks.archiveAdd.mockResolvedValue(ok({ id: 'arc-0001' }, 201));
    renderResult();
    const button = await screen.findByTestId(TID.result.archiveAdd);
    expect(button).toBeEnabled();
    await userEvent.setup().click(button);
    expect(mocks.archiveAdd).toHaveBeenCalledWith({ document_id: 'D01', verify_job_id: 'job-0001' });
    expect(await screen.findByText(/เก็บเข้าคลังแล้ว/)).toBeInTheDocument();
    expect(button).toBeDisabled();
  });

  it('explains a refusal (already archived) and keeps the button usable', async () => {
    useAppStore.setState({ token: 't', user: userSummary() });
    withJob(PASSED);
    mocks.archiveAdd.mockResolvedValue(fail(409, 'INVALID_STATE'));
    renderResult();
    await userEvent.setup().click(await screen.findByTestId(TID.result.archiveAdd));
    expect(await screen.findByText('เอกสารนี้อยู่ในคลังของคุณแล้ว')).toBeInTheDocument();
    expect(screen.getByTestId(TID.result.archiveAdd)).toBeEnabled();
  });
});

describe('job states', () => {
  it('polls a running job until it is done', async () => {
    const running: VerifyJobDto = { job_id: 'job-0001', status: 'running', created_at: PASSED.created_at, result: null, error: null };
    mocks.get.mockResolvedValueOnce(ok(running)).mockResolvedValue(ok(doneJob(PASSED)));
    renderResult();
    expect(await screen.findByTestId(TID.verify.jobProgress)).toHaveAttribute('data-state', 'running');
    expect(await screen.findByTestId(TID.result.indication, undefined, { timeout: 2500 })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId(TID.verify.jobProgress)).toBeNull());
  });

  it('explains an unknown job id (404) instead of crashing', async () => {
    mocks.get.mockResolvedValue(fail(404, 'NOT_FOUND'));
    renderResult('job-9999');
    const box = await screen.findByTestId(TID.verify.error);
    expect(box).toHaveAttribute('data-status', '404');
    expect(box).toHaveTextContent('ไม่พบ');
    expect(screen.queryByTestId(TID.result.indication)).toBeNull();
  });
});
