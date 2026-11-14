// /policy (spec 7.6 page 17): short demo versions of the CP/CPS, the TSA policy statement, the user agreement and the
// verifier notice. Each is labelled "ฉบับย่อสำหรับ demo" and has no legal effect (assumption A19).
import { Card, LayeredContent } from '../components';
import { getMarkdown as getInfoMarkdown } from './info/content';
import { TID } from '../contracts/testids';

const DOCS = [
  { key: 'policy/cp-cps', title: 'นโยบายและแนวปฏิบัติของ CA (CP/CPS)' },
  { key: 'policy/tsa-ps', title: 'ข้อกำหนดของบริการตราประทับเวลา (TSA PS)' },
  { key: 'policy/user-agreement', title: 'ข้อตกลงผู้ใช้ (ผู้ถือใบรับรอง)' },
  { key: 'policy/verifier-notice', title: 'ประกาศสำหรับผู้ตรวจเอกสาร' },
] as const;

export function PolicyPage() {
  return (
    <section data-testid={TID.page('policy')} className="space-y-6">
      <h1 className="text-2xl font-bold">นโยบาย</h1>
      <p className="text-slate-800">ทุกฉบับเป็น "ฉบับย่อสำหรับ demo" เพื่อการเรียนรู้เท่านั้น ไม่มีผลทางกฎหมาย</p>
      {DOCS.map((d) => (
        <Card key={d.key} title={`${d.title} (ฉบับย่อสำหรับ demo)`} headingLevel={2}>
          <LayeredContent markdown={getInfoMarkdown(d.key)} />
        </Card>
      ))}
    </section>
  );
}
