// Demo-wide constants shared by UI code AND Cypress specs.
// Keep this file free of Vite-only APIs (import.meta.env): Cypress bundles it with webpack. Env flags live in ./env.ts.

/** Always-visible, non-dismissible notice (spec section 5). Cypress asserts this exact text. */
export const DEMO_BANNER_TEXT = 'โหมดสาธิต · ข้อมูลจำลองทั้งหมด · ไม่มีการลงลายมือชื่อหรือตรวจเอกสารจริง';

/** Watermark / first line of downloadable demo files (spec section 5). */
export const DEMO_WATERMARK_TEXT = 'DEMO — ไม่ใช่ผลตรวจจริง';

/** Feedback form link (spec question 5). Empty until the maintainer decides; the About page then shows "ยังไม่เปิดรับความเห็น". */
export const FEEDBACK_URL = '';
