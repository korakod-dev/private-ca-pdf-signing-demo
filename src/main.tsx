// App entry.
// Mock mode (default): dynamic-import ./mocks/browser and await the Service Worker BEFORE rendering, so the very first
// fetch is already answered by the mock. If no Service Worker can be started, a Thai notice is shown instead of the app.
// Live mode (VITE_API_MODE=live): the mocks are never imported. The condition below must stay a direct comparison with
// `import.meta.env.VITE_API_MODE` (a build-time constant) so the bundler removes the whole mock branch from live builds.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './app/App';

const container = document.getElementById('root');
if (!container) throw new Error('#root not found');
const root = container;

/** Plain DOM notice (no React/mocks needed). Thai text; shown when the mock API cannot start. */
function showServiceWorkerNotice(reason: string): void {
  const box = document.createElement('div');
  box.setAttribute('role', 'alert');
  box.className = 'm-4 rounded border border-amber-600 bg-amber-50 p-4 text-amber-900';
  const title = document.createElement('p');
  title.className = 'font-bold';
  title.textContent = 'เปิดการสาธิตไม่ได้ในเบราว์เซอร์นี้';
  const body = document.createElement('p');
  body.textContent =
    'หน้านี้ต้องใช้ Service Worker และพื้นที่เก็บข้อมูลของเบราว์เซอร์เพื่อจำลองระบบ แต่เริ่มไม่สำเร็จ ' +
    '(เช่น โหมดส่วนตัวบางแบบ หรือปิดการเก็บข้อมูลไว้) ลองเปิดในหน้าต่างปกติ หรือเปลี่ยนเบราว์เซอร์';
  const detail = document.createElement('p');
  detail.className = 'mt-2 text-sm';
  detail.textContent = `รายละเอียดทางเทคนิค: ${reason}`;
  box.append(title, body, detail);
  root.replaceChildren(box);
}

function render(): void {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

async function bootstrap(): Promise<void> {
  if (import.meta.env.VITE_API_MODE !== 'live') {
    if (!('serviceWorker' in navigator)) {
      showServiceWorkerNotice('navigator.serviceWorker is not available');
      return;
    }
    try {
      const { startMockWorker } = await import('./mocks/browser');
      await startMockWorker();
    } catch (e) {
      showServiceWorkerNotice(e instanceof Error ? e.message : String(e));
      return;
    }
  }
  render();
}

void bootstrap();
