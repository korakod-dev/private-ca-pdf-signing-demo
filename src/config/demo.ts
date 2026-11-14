// Demo-wide constants shared by UI code AND Cypress specs.
// Keep this file free of Vite-only APIs (import.meta.env): Cypress bundles it with webpack. Env flags live in ./env.ts.

/** Always-visible, non-dismissible notice (spec section 5). Cypress asserts this exact text. */
export const DEMO_BANNER_TEXT = 'โหมดสาธิต · ข้อมูลจำลองทั้งหมด · ไม่มีการลงลายมือชื่อหรือตรวจเอกสารจริง';

/** Watermark / first line of downloadable demo files (spec section 5). */
export const DEMO_WATERMARK_TEXT = 'DEMO — ไม่ใช่ผลตรวจจริง';

/**
 * Feedback form link (spec question 5, ADR 0003 A47): external Google Form. The project does not control or verify the form's settings (e.g. e-mail collection); the page asks respondents not to enter personal data.
 * Clean form URL only: no account / tracking query parameters. Set to '' to switch the About page back to "ยังไม่เปิดรับความเห็น".
 */
export const FEEDBACK_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSfzm3-fWcg5fpDFwOJQPU5vmN4s5egH7rEbKjQEXqFPzWKA9g/viewform';
