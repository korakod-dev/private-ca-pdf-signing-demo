// /verify: sample cards, job polling + navigation to the result, Thai problem messages (413/422/429/503),
// and the upload control, which must never read the file or call the API (spec section 5).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { SampleDto, VerifyJobDto } from '../../../contracts/api';
import { TID } from '../../../contracts/testids';
import { doneJob, fail, makeReport, ok } from '../../info/__tests__/helpers';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  get: vi.fn(),
  samples: vi.fn(),
}));

vi.mock('../../../api', () => ({
  configureApi: vi.fn(),
  api: { verify: { create: mocks.create, get: mocks.get } },
  demoApi: { samples: mocks.samples },
}));

import { VerifyPage } from '../../VerifyPage';
import { UPLOAD_NOTICE_TH } from '../UploadBox';

const SAMPLES: SampleDto[] = [
  { id: 'D01', file_name: 'memo-118.signed.pdf', title_th: 'บันทึกข้อความ 118 (เซ็นครบ 2 คน)', scenario_th: 'เซ็น 2 คน B-LTA ครบ', pages: 2, previews: ['/previews/D01-p1.svg'] },
  { id: 'D10', file_name: 'encrypted.pdf', title_th: 'PDF เข้ารหัส', scenario_th: 'ระบบปฏิเสธ', pages: 1, previews: [] },
];

const queued = (): VerifyJobDto => ({ job_id: 'job-0001', status: 'queued', created_at: '2026-11-12T09:00:00+07:00', result: null, error: null });

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/verify']}>
      <Routes>
        <Route path="/verify" element={<VerifyPage />} />
        <Route path="/verify/:jobId" element={<p data-testid="at-result">result page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.create.mockReset();
  mocks.get.mockReset();
  mocks.samples.mockReset();
  mocks.samples.mockResolvedValue(ok(SAMPLES));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('/verify sample cards', () => {
  it('renders one verify button per sample', async () => {
    renderPage();
    expect(await screen.findByTestId(TID.verify.sample('D01'))).toBeEnabled();
    expect(screen.getByTestId(TID.verify.sample('D10'))).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ตรวจเอกสาร');
  });

  it('creates the job, polls until done and goes to the result page', async () => {
    mocks.create.mockResolvedValue(ok({ job_id: 'job-0001', status: 'queued' }, 202));
    mocks.get.mockResolvedValueOnce(ok(queued())).mockResolvedValue(ok(doneJob(makeReport())));
    renderPage();
    await userEvent.setup().click(await screen.findByTestId(TID.verify.sample('D01')));
    expect(mocks.create).toHaveBeenCalledWith({ fixture_id: 'D01' });
    expect(await screen.findByTestId(TID.verify.jobProgress)).toHaveAttribute('data-state', 'queued');
    expect(await screen.findByTestId('at-result', undefined, { timeout: 2500 })).toBeInTheDocument();
    expect(mocks.get).toHaveBeenCalledWith('job-0001');
  });

  it('disables every sample button while a job is running', async () => {
    mocks.create.mockResolvedValue(ok({ job_id: 'job-0001', status: 'queued' }, 202));
    mocks.get.mockResolvedValue(ok(queued()));
    renderPage();
    await userEvent.setup().click(await screen.findByTestId(TID.verify.sample('D01')));
    await screen.findByTestId(TID.verify.jobProgress);
    expect(screen.getByTestId(TID.verify.sample('D10'))).toBeDisabled();
  });

  it('shows a failed job as a problem and re-enables the buttons', async () => {
    mocks.create.mockResolvedValue(ok({ job_id: 'job-0001', status: 'queued' }, 202));
    mocks.get.mockResolvedValue(
      ok({ ...queued(), status: 'error', error: { type: '/problems/INTERNAL_ERROR', title: 'x', status: 500, code: 'INTERNAL_ERROR' } }),
    );
    renderPage();
    await userEvent.setup().click(await screen.findByTestId(TID.verify.sample('D01')));
    expect(await screen.findByTestId(TID.verify.error)).toHaveAttribute('data-code', 'INTERNAL_ERROR');
    await waitFor(() => expect(screen.getByTestId(TID.verify.sample('D01'))).toBeEnabled());
  });
});

describe('/verify problem messages', () => {
  it.each([
    [413, 'PDF_TOO_LARGE', 'เกินกำหนด', undefined],
    [422, 'ENCRYPTED_PDF', 'เข้ารหัส', undefined],
    [422, 'NOT_SIGNED', 'ยังไม่มีลายเซ็น', undefined],
    [429, 'RATE_LIMITED', 'ถี่เกินไป', 42],
    [503, 'QUEUE_FULL', 'คิวตรวจเต็ม', 30],
  ] as const)('%i %s is explained in Thai', async (status, code, text, retry) => {
    mocks.create.mockResolvedValue(fail(status, code, { retry_after_s: retry, ref: 'V10' }));
    renderPage();
    await userEvent.setup().click(await screen.findByTestId(TID.verify.sample('D10')));
    const box = await screen.findByTestId(TID.verify.error);
    expect(box).toHaveAttribute('data-status', String(status));
    expect(box).toHaveAttribute('data-code', code);
    expect(box).toHaveTextContent(text);
    expect(box).toHaveTextContent('V10');
    if (retry !== undefined) expect(box).toHaveTextContent(`ลองใหม่ได้ในอีก ${retry} วินาที`);
    // The page stays usable: no job is polled and the buttons are enabled again.
    expect(mocks.get).not.toHaveBeenCalled();
    expect(screen.getByTestId(TID.verify.sample('D10'))).toBeEnabled();
  });
});

describe('/verify upload (spec section 5)', () => {
  it('shows the notice, clears the input, never reads the file and never calls the API', async () => {
    // Any use of FileReader or of the file content readers would throw / be recorded.
    vi.stubGlobal(
      'FileReader',
      class {
        constructor() {
          throw new Error('FileReader must not be used');
        }
      },
    );
    renderPage();
    await screen.findByTestId(TID.verify.sample('D01'));
    mocks.create.mockClear();
    mocks.get.mockClear();
    mocks.samples.mockClear();

    const file = new File(['%PDF-1.7 pretend'], 'mine.pdf', { type: 'application/pdf' });
    const readers = { arrayBuffer: vi.fn(), text: vi.fn(), stream: vi.fn() };
    for (const [name, spy] of Object.entries(readers)) Object.defineProperty(file, name, { value: spy });

    const input = screen.getByTestId(TID.verify.upload) as HTMLInputElement;
    expect(screen.queryByTestId(TID.verify.uploadNotice)).toBeNull();
    await userEvent.setup().upload(input, file);

    expect(screen.getByTestId(TID.verify.uploadNotice)).toHaveTextContent(UPLOAD_NOTICE_TH);
    expect(input.value).toBe('');
    expect(input.files).toHaveLength(0);
    expect(readers.arrayBuffer).not.toHaveBeenCalled();
    expect(readers.text).not.toHaveBeenCalled();
    expect(readers.stream).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('handles a non-PDF selection the same way (the accept attribute is only a hint)', async () => {
    renderPage();
    await screen.findByTestId(TID.verify.sample('D01'));
    const input = screen.getByTestId(TID.verify.upload) as HTMLInputElement;
    const file = new File(['not a pdf'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByTestId(TID.verify.uploadNotice)).toHaveTextContent('ระบบจำลองตรวจไฟล์จริงไม่ได้ เลือกเอกสารตัวอย่างแทน');
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
