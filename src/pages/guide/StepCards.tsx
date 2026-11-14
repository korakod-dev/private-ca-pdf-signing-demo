// Illustrated step cards for installing the Root in Keychain and Adobe (spec 7.6 page 4). Each card is a numbered caption
// plus a small drawn window (inline SVG, no screenshots, no OS or vendor logos). The drawings are schematic: menu names in a
// real program may differ by version, which the page says out loud.
// Safe for the CSP: only SVG elements and classes, no inline style attributes.

export interface Step {
  /** Short instruction (Thai). */
  caption: string;
  /** Title bar text of the drawn window. */
  windowTitle: string;
  /** Lines inside the window; the highlighted one is what the learner should click. */
  lines: string[];
  highlight: number;
}

export const KEYCHAIN_STEPS: readonly Step[] = [
  { caption: 'เปิดโปรแกรม Keychain Access แล้วเลือกเมนู File > Import Items', windowTitle: 'Keychain Access', lines: ['File', 'Import Items…', 'Export Items…'], highlight: 1 },
  { caption: 'เลือกไฟล์ Root ที่ดาวน์โหลดมา (หลังเทียบ fingerprint ตรงแล้ว)', windowTitle: 'เลือกไฟล์', lines: ['DEMO-root-ca.cer', 'DEMO-other.txt'], highlight: 0 },
  { caption: 'ดับเบิลคลิกใบรับรอง แล้วเปิดหัวข้อ Trust', windowTitle: 'DEMO Root CA', lines: ['รายละเอียด', 'Trust', 'ชื่อผู้ออก'], highlight: 1 },
  { caption: 'ตั้งค่า "เมื่อใช้ใบรับรองนี้" เป็น Always Trust แล้วยืนยันด้วยรหัสผ่านเครื่อง', windowTitle: 'Trust', lines: ['Never Trust', 'Use System Defaults', 'Always Trust'], highlight: 2 },
];

export const ADOBE_STEPS: readonly Step[] = [
  { caption: 'เปิด Preferences แล้วเลือกหมวด Signatures', windowTitle: 'Preferences', lines: ['Documents', 'Signatures', 'Security'], highlight: 1 },
  { caption: 'ที่ Identities & Trusted Certificates กดปุ่ม More', windowTitle: 'Signatures', lines: ['Creation & Appearance', 'Verification', 'Identities & Trusted Certificates  [More…]'], highlight: 2 },
  { caption: 'เลือก Trusted Certificates แล้วกด Import เพื่อเลือกไฟล์ Root', windowTitle: 'Digital ID and Trusted Certificate Settings', lines: ['Digital IDs', 'Trusted Certificates  [Import]'], highlight: 1 },
  { caption: 'เลือกใบรับรอง แล้วกด Edit Trust ติ๊ก "Use this certificate as a trusted root"', windowTitle: 'Edit Trust', lines: ['Signing  Certified documents', '[x] Use this certificate as a trusted root'], highlight: 1 },
];

function MockWindow({ step }: { step: Step }) {
  const lineHeight = 22;
  const height = 56 + step.lines.length * lineHeight;
  return (
    <svg viewBox={`0 0 320 ${height}`} role="img" aria-label={`ภาพจำลอง: หน้าต่าง ${step.windowTitle} เลือกรายการ ${step.lines[step.highlight] ?? ''}`} className="h-auto w-full">
      <rect x="1" y="1" width="318" height={height - 2} rx="6" className="fill-white stroke-slate-500" strokeWidth="1.5" />
      <rect x="1" y="1" width="318" height="26" rx="6" className="fill-slate-200 stroke-slate-500" strokeWidth="1.5" />
      <text x="12" y="19" className="fill-slate-900" fontSize="12" fontWeight="600">
        {step.windowTitle}
      </text>
      {step.lines.map((line, i) => (
        <g key={line}>
          {i === step.highlight ? <rect x="8" y={36 + i * lineHeight} width="304" height="20" rx="3" className="fill-blue-100 stroke-blue-800" strokeWidth="1.5" /> : null}
          <text x="16" y={51 + i * lineHeight} className="fill-slate-900" fontSize="12">
            {line}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function StepCards({ steps, label }: { steps: readonly Step[]; label: string }) {
  return (
    <>
      <ol aria-label={label} className="grid gap-3 sm:grid-cols-2">
        {steps.map((step, i) => (
          <li key={step.caption} className="rounded-lg border border-slate-300 bg-white p-3">
            <p className="mb-2 font-medium">
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-800 text-sm text-white" aria-hidden="true">
                {i + 1}
              </span>
              <span className="sr-only">ขั้นที่ {i + 1}: </span>
              {step.caption}
            </p>
            <MockWindow step={step} />
          </li>
        ))}
      </ol>
      <p className="mt-2 text-sm text-slate-700">ภาพเป็นภาพวาดจำลองอย่างง่าย ชื่อเมนูในโปรแกรมจริงอาจต่างไปตามเวอร์ชัน</p>
    </>
  );
}
