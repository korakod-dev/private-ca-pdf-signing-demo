// Home, About, Policy and NotFound pages, plus the feedback link rule (empty url -> "ยังไม่เปิดรับความเห็น", configured url -> external link).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ServiceStatusDto } from '../../../contracts/api';
import { TID } from '../../../contracts/testids';
import { fail, ok } from './helpers';

const mocks = vi.hoisted(() => ({ status: vi.fn() }));

vi.mock('../../../api', () => ({
  configureApi: vi.fn(),
  api: { status: { get: mocks.status } },
  demoApi: {},
}));

import { AboutPage } from '../../AboutPage';
import { HomePage } from '../../HomePage';
import { NotFoundPage } from '../../NotFoundPage';
import { PolicyPage } from '../../PolicyPage';
import { FeedbackLink } from '../FeedbackLink';
import { FEEDBACK_URL } from '../../../config/demo';

const STATUS: ServiceStatusDto = {
  services: [
    { id: 'ca', label_th: 'ผู้ออกใบรับรอง (CA)', state: 'up' },
    { id: 'ocsp', label_th: 'บริการตรวจสถานะใบรับรอง (OCSP)', state: 'down' },
    { id: 'verify-queue', label_th: 'คิวตรวจเอกสาร', state: 'degraded' },
  ],
};

const inRouter = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

beforeEach(() => {
  mocks.status.mockReset().mockResolvedValue(ok(STATUS));
});

describe('HomePage', () => {
  it('shows each service with a word and a symbol, not color alone', async () => {
    inRouter(<HomePage />);
    expect(screen.getByTestId(TID.page('home'))).toBeInTheDocument();
    const ocspRow = (await screen.findByText('บริการตรวจสถานะใบรับรอง (OCSP)')).closest('li') as HTMLElement;
    expect(ocspRow).toHaveAttribute('data-state', 'down');
    expect(ocspRow).toHaveTextContent('ล่ม');
    expect(screen.getByText('คิวตรวจเอกสาร').closest('li')).toHaveTextContent('ทำงานบางส่วน');
    expect(screen.getByText('ผู้ออกใบรับรอง (CA)').closest('li')).toHaveTextContent('ปกติ');
  });

  it('links to the starting points', async () => {
    inRouter(<HomePage />);
    await screen.findByText('คิวตรวจเอกสาร');
    expect(screen.getByRole('link', { name: 'ตรวจเอกสาร' })).toHaveAttribute('href', '/verify');
    expect(screen.getByRole('link', { name: 'เริ่มจากคู่มือ' })).toHaveAttribute('href', '/guide');
  });

  it('explains a status failure instead of an empty list', async () => {
    mocks.status.mockResolvedValue(fail(500, 'INTERNAL_ERROR', { title: 'ขัดข้อง' }));
    inRouter(<HomePage />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('AboutPage', () => {
  it('lists what differs from a real system and names the main spec without a link target', () => {
    inRouter(<AboutPage />);
    expect(screen.getByTestId(TID.page('about'))).toBeInTheDocument();
    expect(screen.getByText(/ไม่มีกุญแจหรือลายเซ็นจริง/)).toBeInTheDocument();
    expect(screen.getByText('spec-discussion-summary')).toBeInTheDocument();
    expect(screen.getByText(/ไม่มี analytics/)).toBeInTheDocument();
  });

  it('shows the configured feedback form link (external Google Form, new tab)', () => {
    inRouter(<AboutPage />);
    expect(FEEDBACK_URL).toMatch(/^https:\/\/docs\.google\.com\/forms\/d\/e\/[\w-]+\/viewform$/); // clean URL, no query string
    const link = screen.getByRole('link', { name: /ส่งความเห็น/ });
    expect(link).toHaveAttribute('href', FEEDBACK_URL);
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByText(/ลิงก์นี้พาไปที่ Google Form/)).toBeInTheDocument();
    expect(screen.queryByText('ยังไม่เปิดรับความเห็น')).toBeNull();
  });
});

describe('FeedbackLink', () => {
  it('renders no link for an empty or blank url', () => {
    const { rerender } = render(<FeedbackLink url="" />);
    expect(screen.getByText('ยังไม่เปิดรับความเห็น')).toBeInTheDocument();
    rerender(<FeedbackLink url="   " />);
    expect(screen.getByText('ยังไม่เปิดรับความเห็น')).toBeInTheDocument();
  });

  it('renders a safe external link for a real url', () => {
    render(<FeedbackLink url="https://forms.example/demo" />);
    const link = screen.getByRole('link', { name: /ส่งความเห็น/ });
    expect(link).toHaveAttribute('href', 'https://forms.example/demo');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText(/ลิงก์นี้พาไปที่ Google Form/)).toBeInTheDocument();
  });
});

describe('PolicyPage', () => {
  it('shows the four documents, each labelled "ฉบับย่อสำหรับ demo"', () => {
    inRouter(<PolicyPage />);
    expect(screen.getByTestId(TID.page('policy'))).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings).toHaveLength(4);
    headings.forEach((h) => expect(h).toHaveTextContent('ฉบับย่อสำหรับ demo'));
    expect(headings[0]).toHaveTextContent('CP/CPS');
    expect(headings[1]).toHaveTextContent('TSA');
  });

  it('keeps technical details collapsed', () => {
    inRouter(<PolicyPage />);
    document.querySelectorAll('details').forEach((d) => expect(d).not.toHaveAttribute('open'));
    expect(document.querySelectorAll('details')).toHaveLength(4);
  });
});

describe('NotFoundPage', () => {
  it('has a heading and a way home', () => {
    inRouter(<NotFoundPage />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('ไม่พบหน้านี้');
    expect(screen.getByRole('link', { name: 'กลับหน้าแรก' })).toHaveAttribute('href', '/');
  });
});
