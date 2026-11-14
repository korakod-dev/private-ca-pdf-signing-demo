// /guide: fingerprint practice (match / mismatch, M1 progress reported only on a match) and the illustrated steps.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { CaFixture } from '../../../contracts/fixtures';
import { TID } from '../../../contracts/testids';
import { ok } from '../../info/__tests__/helpers';

const mocks = vi.hoisted(() => ({ cas: vi.fn(), progress: vi.fn() }));

vi.mock('../../../api', () => ({
  configureApi: vi.fn(),
  api: { pki: { cas: mocks.cas } },
  demoApi: { progress: mocks.progress },
}));

import { GuidePage } from '../../GuidePage';
import { fingerprintMatches, normalizeFingerprint } from '../fingerprint';
import { ADOBE_STEPS, KEYCHAIN_STEPS } from '../StepCards';

const ROOT_FP = 'DE:M0:7A:C3:A1:0F:B4:EA:03:30:05:C8:F7:9E:73:5C:FA:09:C5:EC:BB:44:09:85:EC:D9:56:95:FF:45:19:BE';
const ROOT = { id: 'root-2026', subject: 'CN=Korakod Lab DEMO Root CA 2026', fingerprint_sha256: ROOT_FP } as CaFixture;

function renderGuide() {
  return render(
    <MemoryRouter>
      <GuidePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mocks.cas.mockReset().mockResolvedValue(ok([{ ...ROOT, id: 'doc-signing-2026', fingerprint_sha256: 'DE:M0:00' } as CaFixture, ROOT]));
  mocks.progress.mockReset().mockResolvedValue(ok(null));
});

describe('fingerprint helpers', () => {
  it('ignores case, spaces and separators but nothing else', () => {
    expect(normalizeFingerprint('de:m0 7a-c3')).toBe('DEM07AC3');
    expect(fingerprintMatches(ROOT_FP.toLowerCase(), ROOT_FP)).toBe(true);
    expect(fingerprintMatches(ROOT_FP.replaceAll(':', ' '), ROOT_FP)).toBe(true);
    expect(fingerprintMatches(`${ROOT_FP.slice(0, -1)}F`, ROOT_FP)).toBe(false);
    expect(fingerprintMatches('', ROOT_FP)).toBe(false);
  });
});

describe('/guide fingerprint practice', () => {
  it('says "match" for the right fingerprint and reports the M1 progress key', async () => {
    renderGuide();
    const user = userEvent.setup();
    const check = await screen.findByTestId(TID.guide.fpCheck);
    await screen.findByText(ROOT_FP); // the announced value comes from the API (root-2026)
    await user.type(screen.getByTestId(TID.guide.fpInput), ROOT_FP);
    await user.click(check);
    expect(await screen.findByTestId(TID.guide.fpResult)).toHaveAttribute('data-match', 'true');
    expect(mocks.progress).toHaveBeenCalledTimes(1);
    expect(mocks.progress).toHaveBeenCalledWith('M1.fingerprint_matched');
  });

  it('says "mismatch" for a wrong fingerprint, even one character off, and reports nothing', async () => {
    renderGuide();
    const user = userEvent.setup();
    await screen.findByText(ROOT_FP);
    await user.type(screen.getByTestId(TID.guide.fpInput), `${ROOT_FP.slice(0, -1)}F`);
    await user.click(screen.getByTestId(TID.guide.fpCheck));
    expect(screen.getByTestId(TID.guide.fpResult)).toHaveAttribute('data-match', 'false');
    expect(mocks.progress).not.toHaveBeenCalled();
  });

  it('clears the previous verdict when the input changes', async () => {
    renderGuide();
    const user = userEvent.setup();
    await screen.findByText(ROOT_FP);
    await user.type(screen.getByTestId(TID.guide.fpInput), 'wrong');
    await user.click(screen.getByTestId(TID.guide.fpCheck));
    expect(screen.getByTestId(TID.guide.fpResult)).toHaveAttribute('data-match', 'false');
    await user.type(screen.getByTestId(TID.guide.fpInput), '!');
    expect(screen.queryByTestId(TID.guide.fpResult)).toBeNull();
  });

  it('keeps the check button disabled until the reference value has loaded', async () => {
    mocks.cas.mockReturnValue(new Promise(() => undefined));
    renderGuide();
    expect(screen.getByTestId(TID.guide.fpCheck)).toBeDisabled();
  });
});

describe('/guide illustrated steps', () => {
  it('renders the Keychain and Adobe step cards as numbered lists with drawings', () => {
    renderGuide();
    expect(screen.getByRole('list', { name: 'ขั้นตอนติดตั้งใน Keychain' }).querySelectorAll('li')).toHaveLength(KEYCHAIN_STEPS.length);
    expect(screen.getByRole('list', { name: 'ขั้นตอนติดตั้งใน Adobe' }).querySelectorAll('li')).toHaveLength(ADOBE_STEPS.length);
    expect(screen.getAllByRole('img').length).toBe(KEYCHAIN_STEPS.length + ADOBE_STEPS.length);
  });

  it('has one h1 and the explanations keep technical details collapsed', () => {
    renderGuide();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    document.querySelectorAll('details').forEach((d) => expect(d).not.toHaveAttribute('open'));
    expect(screen.getByTestId(TID.page('guide'))).toBeInTheDocument();
  });
});
