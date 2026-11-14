// Shared UI kit tests: Explain collapsed by default, downloads always .txt with the DEMO first line,
// MFA dialog keyboard behaviour, ContentBlock (no raw HTML), badges, useApi.
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { DEMO_WATERMARK_TEXT } from '../../config/demo';
import { TID } from '../../contracts/testids';
import { ok } from '../../store/__tests__/fakes';

vi.mock('../../api', () => ({ configureApi: vi.fn(), api: {}, demoApi: {} }));

import { useAppStore } from '../../store';
import { ContentBlock } from '../ContentBlock';
import { DownloadDemoFile, toDemoFileContent, toDemoFileName } from '../DownloadDemoFile';
import { Explain } from '../Explain';
import { IndicationBadge } from '../IndicationBadge';
import { LayeredContent } from '../LayeredContent';
import { Watermark } from '../Watermark';
import { MfaDialog } from '../MfaDialog';
import { StateBadge } from '../StateBadge';
import { useApi } from '../useApi';
import { faultPatch, isFaultOn } from '../faultToggle';

describe('Watermark (F25)', () => {
  it('draws the full DEMO text and fits the whole drawing into the block ("meet", never "slice")', () => {
    const { container } = render(<Watermark>เนื้อหา</Watermark>);
    expect(screen.getByTestId('watermark-text')).toHaveTextContent(DEMO_WATERMARK_TEXT);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg?.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
  });

  it('fixes the drawn text width (textLength) so a wider fallback font (Linux CI) cannot overflow the viewBox', () => {
    render(<Watermark>เนื้อหา</Watermark>);
    const text = screen.getByTestId('watermark-text');
    expect(Number(text.getAttribute('textLength'))).toBeGreaterThan(0);
    expect(Number(text.getAttribute('textLength'))).toBeLessThan(400); // viewBox width
    expect(text.getAttribute('lengthAdjust')).toBe('spacingAndGlyphs');
  });
});

describe('LayeredContent (F29)', () => {
  const FILE = '<!-- refs: L4, R14 -->\nข้อความง่าย\n\n## รายละเอียดทางเทคนิค\n- รายละเอียดลึก\n';

  it('shows the simple text and the refs always, and keeps the technical layer collapsed', () => {
    const { container } = render(
      <MemoryRouter>
        <LayeredContent markdown={FILE} testId="lc" />
      </MemoryRouter>,
    );
    expect(screen.getByText('ข้อความง่าย')).toBeInTheDocument();
    // The refs are outside the collapsed <details>, so they are visible without opening anything.
    const refs = screen.getByTestId('content-refs');
    expect(refs).toHaveTextContent('อ้างอิงรหัสข้อใน spec หลัก: L4, R14');
    expect(refs.closest('details')).toBeNull();
    const details = container.querySelector('details');
    expect(details).not.toBeNull();
    expect(details).not.toHaveAttribute('open');
  });

  it('shows the refs even when the file has no technical layer, and a neutral fallback for a missing file', () => {
    const { rerender } = render(
      <MemoryRouter>
        <LayeredContent markdown={'<!-- refs: V5 -->\nเฉพาะข้อความง่าย'} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('content-refs')).toHaveTextContent('V5');
    expect(document.querySelector('details')).toBeNull();
    rerender(
      <MemoryRouter>
        <LayeredContent markdown={null} />
      </MemoryRouter>,
    );
    expect(screen.getByText('ยังไม่มีคำอธิบายสำหรับหัวข้อนี้')).toBeInTheDocument();
  });
});

describe('Explain', () => {
  it('shows the simple text and keeps the technical details collapsed by default', () => {
    render(<Explain technical={<span>sha256 detail</span>}>คำอธิบายง่าย</Explain>);
    expect(screen.getByText('คำอธิบายง่าย')).toBeVisible();
    const details = screen.getByText('รายละเอียดทางเทคนิค').closest('details')!;
    expect(details).not.toHaveAttribute('open');
  });

  it('opens on click', async () => {
    render(<Explain technical={<span>sha256 detail</span>}>x</Explain>);
    await userEvent.setup().click(screen.getByText('รายละเอียดทางเทคนิค'));
    expect(screen.getByText('รายละเอียดทางเทคนิค').closest('details')).toHaveAttribute('open');
  });

  it('renders no details block without technical content', () => {
    render(<Explain>only simple</Explain>);
    expect(screen.queryByText('รายละเอียดทางเทคนิค')).toBeNull();
  });
});

describe('downloads are always .txt with the DEMO first line', () => {
  it.each([
    ['DEMO-certificate.crt', 'DEMO-certificate.txt'],
    ['cert.crt', 'DEMO-cert.txt'],
    ['id.p12', 'DEMO-id.txt'],
    ['memo-130-s2.signed.pdf', 'DEMO-memo-130-s2.signed.txt'],
    ['../../etc/passwd', 'DEMO-passwd.txt'],
    ['C:\\x\\evil.exe', 'DEMO-evil.txt'],
    ['noext', 'DEMO-noext.txt'],
    ['', 'DEMO-file.txt'],
    ['.pdf', 'DEMO-file.txt'],
  ])('toDemoFileName(%j) = %s', (input, expected) => {
    const out = toDemoFileName(input);
    expect(out).toBe(expected);
    expect(out.endsWith('.txt')).toBe(true);
  });

  it('prefixes the watermark line exactly once', () => {
    expect(toDemoFileContent('abc')).toBe(`${DEMO_WATERMARK_TEXT}\n\nabc`);
    expect(toDemoFileContent(`${DEMO_WATERMARK_TEXT}\nabc`)).toBe(`${DEMO_WATERMARK_TEXT}\nabc`);
  });

  describe('the button', () => {
    const created: Blob[] = [];
    const clicked: { download: string; href: string }[] = [];
    beforeEach(() => {
      created.length = 0;
      clicked.length = 0;
      URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
        created.push(b as Blob);
        return 'blob:demo';
      });
      URL.revokeObjectURL = vi.fn();
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ download: this.download, href: this.href });
      });
    });
    afterEach(() => vi.restoreAllMocks());

    it('downloads a .txt named file whose text starts with the DEMO line, even for a .p12 request', async () => {
      render(<DownloadDemoFile fileName="somchai.p12" content="อธิบายไฟล์" testId="dl" />);
      const button = screen.getByTestId('dl');
      expect(button).toHaveAttribute('data-file-name', 'DEMO-somchai.txt');
      await userEvent.setup().click(button);
      expect(clicked).toEqual([{ download: 'DEMO-somchai.txt', href: 'blob:demo' }]);
      expect(created).toHaveLength(1);
      const blob = created[0]!;
      expect(blob.type).toMatch(/^text\/plain/);
      expect(await blob.text()).toBe(`${DEMO_WATERMARK_TEXT}\n\nอธิบายไฟล์`);
    });
  });
});

describe('MfaDialog keyboard behaviour', () => {
  function setup(onSubmit = vi.fn(), onCancel = vi.fn()) {
    const user = userEvent.setup();
    const view = render(
      <>
        <button>opener</button>
        <MfaDialog open onSubmit={onSubmit} onCancel={onCancel} />
      </>,
    );
    return { user, onSubmit, onCancel, ...view };
  }

  it('is a labelled modal dialog and puts focus in the input', () => {
    setup();
    const dialog = screen.getByRole('dialog', { name: /MFA/ });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByLabelText('รหัสยืนยัน 6 หลัก')).toHaveFocus();
    expect(screen.getByTestId(TID.mfa.input)).toBe(screen.getByLabelText('รหัสยืนยัน 6 หลัก'));
  });

  it('Enter submits the typed code', async () => {
    const { user, onSubmit } = setup();
    await user.keyboard('246810{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('246810');
  });

  it('does not submit an empty code (button disabled, Enter ignored)', async () => {
    const { user, onSubmit } = setup();
    expect(screen.getByTestId(TID.mfa.submit)).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Esc cancels', async () => {
    const { user, onCancel } = setup();
    await user.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('Tab and Shift+Tab stay inside the dialog', async () => {
    const { user } = setup();
    await user.keyboard('1'); // enables the submit button so it is focusable
    const input = screen.getByTestId(TID.mfa.input);
    const cancel = screen.getByRole('button', { name: 'ยกเลิก' });
    const submit = screen.getByTestId(TID.mfa.submit);
    expect(input).toHaveFocus();
    await user.tab();
    expect(cancel).toHaveFocus();
    await user.tab();
    expect(submit).toHaveFocus();
    await user.tab(); // wraps to the first control, not to the page behind
    expect(input).toHaveFocus();
    await user.tab({ shift: true }); // wraps backwards to the last control
    expect(submit).toHaveFocus();
  });

  it('shows an error message as an alert and links it to the input', () => {
    render(<MfaDialog open onSubmit={vi.fn()} onCancel={vi.fn()} error="รหัสไม่ถูกต้อง" />);
    expect(screen.getByRole('alert')).toHaveTextContent('รหัสไม่ถูกต้อง');
    expect(screen.getByTestId(TID.mfa.input)).toHaveAttribute('aria-invalid', 'true');
  });

  it('returns focus to the opener when closed', async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>opener</button>
          <MfaDialog open={open} onSubmit={() => setOpen(false)} onCancel={() => setOpen(false)} />
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'opener' });
    await user.click(opener);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe('ContentBlock', () => {
  it('renders markdown but never raw HTML, and shifts headings below the page h1', () => {
    const md = '<!-- refs: V3 -->\n# หัวข้อ\n\nข้อความ **หนา**\n\n<script>window.__pwned = 1</script>\n<img src=x onerror="window.__pwned=1">\n\n- รายการ';
    const { container } = render(
      <MemoryRouter>
        <ContentBlock markdown={md} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'หัวข้อ' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(container.querySelector('script, img')).toBeNull();
    expect(container.innerHTML).not.toContain('refs:');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(screen.getByText('หนา').tagName).toBe('STRONG');
  });

  it('links only to in-app paths; external links render as plain text', () => {
    render(
      <MemoryRouter>
        <ContentBlock markdown="[ใน](/verify) [นอก](https://example.com)" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'ใน' })).toHaveAttribute('href', '/verify');
    expect(screen.queryByRole('link', { name: 'นอก' })).toBeNull();
    expect(screen.getByText('นอก')).toBeInTheDocument();
  });
});

describe('badges', () => {
  it('IndicationBadge shows Thai word + code and carries data-indication', () => {
    render(<IndicationBadge indication="TOTAL-FAILED" testId={TID.result.indication} />);
    const badge = screen.getByTestId(TID.result.indication);
    expect(badge).toHaveAttribute('data-indication', 'TOTAL-FAILED');
    expect(badge).toHaveTextContent('ไม่ผ่าน');
    expect(badge).toHaveTextContent('TOTAL-FAILED');
  });

  it('StateBadge carries data-state, translates known states and tolerates unknown ones', () => {
    render(
      <>
        <StateBadge state="Active" testId="a" />
        <StateBadge state="Revoked" label="ถูกแทนที่" testId="b" />
        <StateBadge state="brand-new" testId="c" />
      </>,
    );
    expect(screen.getByTestId('a')).toHaveAttribute('data-state', 'Active');
    expect(screen.getByTestId('a')).toHaveTextContent('ใช้งานได้');
    expect(screen.getByTestId('b')).toHaveTextContent('ถูกแทนที่');
    expect(screen.getByTestId('c')).toHaveTextContent('brand-new');
  });
});

describe('faultToggle', () => {
  const off = { ocsp_down: false, crl_down: false, tsa_drift_ms: 0, queue_full: false };
  it('presets are exclusive and exact', () => {
    expect(isFaultOn('ocsp', { ...off, ocsp_down: true })).toBe(true);
    expect(isFaultOn('ocsp', { ...off, ocsp_down: true, crl_down: true })).toBe(false);
    expect(isFaultOn('ocsp-crl', { ...off, ocsp_down: true, crl_down: true })).toBe(true);
    expect(isFaultOn('crl', { ...off, crl_down: true })).toBe(true);
    expect(isFaultOn('tsa-drift', { ...off, tsa_drift_ms: 1400 })).toBe(true);
    expect(isFaultOn('queue-full', off)).toBe(false);
  });
  it('patch off clears both flags', () => {
    expect(faultPatch('ocsp-crl', false)).toEqual({ ocsp_down: false, crl_down: false });
    expect(faultPatch('tsa-drift', false)).toEqual({ tsa_drift_ms: 0 });
  });
});

describe('useApi', () => {
  beforeEach(() => useAppStore.setState({ dataVersion: 0 }));

  it('loads data, reloads when dataVersion changes, and ignores stale answers', async () => {
    const calls: ((v: string) => void)[] = [];
    const fn = vi.fn(() => new Promise<ReturnType<typeof ok<string>>>((resolve) => calls.push((v) => resolve(ok(v)))));
    const { result } = renderHook(() => useApi(fn, []));
    expect(result.current.loading).toBe(true);
    await act(async () => calls[0]!('first'));
    await waitFor(() => expect(result.current.data).toBe('first'));
    expect(result.current.loading).toBe(false);

    // Bump twice quickly: the answer of the older call must not win.
    act(() => useAppStore.getState().bumpDataVersion());
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
    act(() => useAppStore.getState().bumpDataVersion());
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(3));
    await act(async () => calls[2]!('newest'));
    await act(async () => calls[1]!('stale'));
    expect(result.current.data).toBe('newest');
  });

  it('exposes API errors', async () => {
    const fn = vi.fn(async () => ({ ok: false as const, error: { status: 500, code: 'X', title: 'bad', problem: null } }));
    const { result } = renderHook(() => useApi(fn, []));
    await waitFor(() => expect(result.current.error?.title).toBe('bad'));
    expect(result.current.data).toBeNull();
  });

  it('reload() runs the call again', async () => {
    const fn = vi.fn(async () => ok(1));
    const { result } = renderHook(() => useApi(fn, []));
    await waitFor(() => expect(result.current.data).toBe(1));
    act(() => result.current.reload());
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });

  it('re-runs when caller deps change', async () => {
    const fn = vi.fn(async () => ok(1));
    const { rerender } = renderHook(({ id }) => useApi(fn, [id]), { initialProps: { id: 'a' } });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    rerender({ id: 'b' });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });
});
