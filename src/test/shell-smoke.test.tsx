// Stage 0 shell smoke (jsdom): every route renders its page inside the shell with the demo banner,
// and the banner has no close control.
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { AppRoutes } from '../app/routes';
import { PAGE_ROUTES } from '../contracts/routes';
import { TID } from '../contracts/testids';
import { DEMO_BANNER_TEXT } from '../config/demo';

describe('shell: banner on every route', () => {
  it.each(PAGE_ROUTES.map((r) => [r.key, r.sample] as const))('%s (%s)', (key, sample) => {
    render(
      <MemoryRouter initialEntries={[sample]}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(screen.getByTestId(TID.demoBar.banner)).toHaveTextContent(DEMO_BANNER_TEXT);
    expect(screen.getByTestId(TID.page(key))).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
  });

  it('banner is not dismissible (no controls inside the banner element)', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <AppRoutes />
      </MemoryRouter>,
    );
    expect(within(screen.getByTestId(TID.demoBar.banner)).queryAllByRole('button')).toHaveLength(0);
  });
});
