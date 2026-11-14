// Shell layout: demo bar (banner + controls, ALWAYS visible, no close control) + navigation + page outlet.
//
// F9 / ADR P0-16: the demo bar (<header data-testid=TID.demoBar.root>, rendered by DemoBar) is pinned to the top of the
// viewport with `sticky top-0 z-50` and an opaque background, so a screenshot of the lower part of a long page still
// shows the demo notice (spec section 5). Tests: src/app/__tests__/DemoBar.test.tsx (classes) and
// cypress/e2e/smoke/shell.cy.ts (computed position while scrolled).
import { useEffect } from 'react';
import { Outlet } from 'react-router';
import { TID } from '../contracts/testids';
import { DemoBar } from './DemoBar';
import { Nav } from './Nav';

/** Keeps in-page focus/anchor scrolling from landing underneath the pinned bar (WCAG 2.2 "focus not obscured"). */
function useScrollPaddingForPinnedBar() {
  useEffect(() => {
    const bar = document.querySelector<HTMLElement>(`[data-testid="${TID.demoBar.root}"]`);
    if (!bar) return;
    const apply = () => {
      document.documentElement.style.scrollPaddingTop = `${bar.offsetHeight}px`;
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(apply);
    observer.observe(bar);
    return () => {
      observer.disconnect();
      document.documentElement.style.scrollPaddingTop = '';
    };
  }, []);
}

export function Layout() {
  useScrollPaddingForPinnedBar();
  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-[70] focus:rounded focus:bg-white focus:px-3 focus:py-2 focus:text-blue-900"
      >
        ข้ามไปยังเนื้อหาหลัก
      </a>
      <DemoBar />
      <Nav />
      <main id="main-content" tabIndex={-1} className="mx-auto max-w-5xl p-4 focus:outline-none">
        <Outlet />
      </main>
    </div>
  );
}
