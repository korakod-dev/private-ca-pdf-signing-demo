// /pki/status: CRL view, OCSP query by serial, R14 warning (computed in the UI), and the CRL/OCSP-down cases.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { CrlDto, OcspDto } from '../../../contracts/api';
import { TID } from '../../../contracts/testids';
import { fail, ok } from '../../info/__tests__/helpers';

const mocks = vi.hoisted(() => ({ crl: vi.fn(), ocsp: vi.fn() }));

vi.mock('../../../api', () => ({
  configureApi: vi.fn(),
  api: { pki: { crl: mocks.crl, ocsp: mocks.ocsp } },
  demoApi: {},
}));

import { PkiStatusPage } from '../../PkiStatusPage';

const SERIAL = 'DE:M0:4F:2A:91:01';
const CRL_EMPTY: CrlDto = { ca: 'doc-signing-2026', number: 3, this_update: '2026-11-12T06:00:00+07:00', next_update: '2026-11-19T06:00:00+07:00', entries: [] };
const CRL_WITH: CrlDto = {
  ...CRL_EMPTY,
  entries: [{ serial: SERIAL, revoked_at: '2026-11-12T09:30:00+07:00', reason: 'cessationOfOperation', invalidity_date: null }],
};
const ocsp = (status: OcspDto['status'], serial = SERIAL): OcspDto => ({
  serial,
  status,
  revoked_at: status === 'revoked' ? '2026-11-12T09:30:00+07:00' : null,
  reason: status === 'revoked' ? 'cessationOfOperation' : null,
  produced_at: '2026-11-12T09:31:00+07:00',
  responder_serial: 'DE:M0:0C:SP:01',
});

function renderPage() {
  return render(
    <MemoryRouter>
      <PkiStatusPage />
    </MemoryRouter>,
  );
}

async function ask(serial = SERIAL) {
  const user = userEvent.setup();
  await user.type(screen.getByTestId(TID.pki.ocspInput), serial);
  await user.click(screen.getByTestId(TID.pki.ocspQuery));
}

beforeEach(() => {
  mocks.crl.mockReset().mockResolvedValue(ok(CRL_EMPTY));
  mocks.ocsp.mockReset();
});

describe('/pki/status CRL view', () => {
  it('shows number, nextUpdate and an empty list', async () => {
    renderPage();
    expect(await screen.findByTestId(TID.pki.crlNumber)).toHaveTextContent('3');
    expect(screen.getByTestId(TID.pki.crlNextUpdate)).toHaveTextContent('2026-11-19 06:00:00 +07:00');
    expect(screen.getByTestId(TID.pki.crlEntries)).toHaveAttribute('data-count', '0');
    expect(mocks.crl).toHaveBeenCalledWith('doc-signing-2026');
  });

  it('lists revoked entries with a Thai reason', async () => {
    mocks.crl.mockResolvedValue(ok(CRL_WITH));
    renderPage();
    const entries = await screen.findByTestId(TID.pki.crlEntries);
    expect(entries).toHaveAttribute('data-count', '1');
    expect(entries).toHaveTextContent(SERIAL);
    expect(entries).toHaveTextContent('เลิกใช้งาน');
  });

  it('explains a CRL outage (503) instead of an empty list', async () => {
    mocks.crl.mockResolvedValue(fail(503, 'CRL_UNAVAILABLE', { retry_after_s: 60 }));
    renderPage();
    expect(await screen.findByText(/บริการ CRL ล่ม/)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.pki.crlNumber)).toBeNull();
  });
});

describe('/pki/status OCSP query and R14', () => {
  it('shows R14 when OCSP says revoked and the serial is not in the CRL', async () => {
    mocks.ocsp.mockResolvedValue(ok(ocsp('revoked')));
    renderPage();
    await screen.findByTestId(TID.pki.crlNumber);
    await ask();
    expect(await screen.findByTestId(TID.pki.ocspResult)).toHaveAttribute('data-status', 'revoked');
    expect(await screen.findByTestId(TID.pki.r14Warning)).toBeInTheDocument();
    expect(mocks.ocsp).toHaveBeenCalledWith(SERIAL);
  });

  it('shows no R14 once the CRL lists the serial', async () => {
    mocks.crl.mockResolvedValue(ok(CRL_WITH));
    mocks.ocsp.mockResolvedValue(ok(ocsp('revoked')));
    renderPage();
    await screen.findByTestId(TID.pki.crlNumber);
    await ask();
    expect(await screen.findByTestId(TID.pki.ocspResult)).toHaveAttribute('data-status', 'revoked');
    expect(screen.queryByTestId(TID.pki.r14Warning)).toBeNull();
  });

  it('shows no R14 for good and unknown answers', async () => {
    mocks.ocsp.mockResolvedValueOnce(ok(ocsp('good'))).mockResolvedValueOnce(ok(ocsp('unknown', '01')));
    renderPage();
    await screen.findByTestId(TID.pki.crlNumber);
    await ask();
    expect(await screen.findByTestId(TID.pki.ocspResult)).toHaveAttribute('data-status', 'good');
    expect(screen.queryByTestId(TID.pki.r14Warning)).toBeNull();
    const user = userEvent.setup();
    await user.clear(screen.getByTestId(TID.pki.ocspInput));
    await user.type(screen.getByTestId(TID.pki.ocspInput), '01');
    await user.click(screen.getByTestId(TID.pki.ocspQuery));
    expect(await screen.findByText(/ไม่รู้จักใบรับรองนี้/)).toBeInTheDocument();
    expect(screen.getByTestId(TID.pki.ocspResult)).toHaveAttribute('data-status', 'unknown');
    expect(screen.queryByTestId(TID.pki.r14Warning)).toBeNull();
  });

  it('says R14 cannot be judged when OCSP says revoked but the CRL is down', async () => {
    mocks.crl.mockResolvedValue(fail(503, 'CRL_UNAVAILABLE'));
    mocks.ocsp.mockResolvedValue(ok(ocsp('revoked')));
    renderPage();
    await screen.findByText(/บริการ CRL ล่ม/);
    await ask();
    expect(await screen.findByText(/เทียบหน้าต่าง R14 ไม่ได้/)).toBeInTheDocument();
    expect(screen.queryByTestId(TID.pki.r14Warning)).toBeNull();
  });

  it('explains an OCSP outage (503)', async () => {
    mocks.ocsp.mockResolvedValue(fail(503, 'OCSP_UNAVAILABLE'));
    renderPage();
    await screen.findByTestId(TID.pki.crlNumber);
    await ask();
    expect(await screen.findByTestId(TID.pki.ocspResult)).toHaveAttribute('data-status', 'unavailable');
    expect(screen.getByText(/บริการ OCSP ล่ม/)).toBeInTheDocument();
  });

  it('keeps the query button disabled while the serial field is empty', async () => {
    renderPage();
    await screen.findByTestId(TID.pki.crlNumber);
    expect(screen.getByTestId(TID.pki.ocspQuery)).toBeDisabled();
    expect(mocks.ocsp).not.toHaveBeenCalled();
  });
});
