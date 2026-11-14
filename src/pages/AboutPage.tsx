// /about (spec 7.6 page 16, spec 7.9): what is simulated and how it differs from a real system, the data/privacy promise,
// the main-spec reference (by name only, no link target) and the feedback link.
import { Card, LayeredContent } from '../components';
import { getMarkdown as getInfoMarkdown } from './info/content';
import { FEEDBACK_URL } from '../config/demo';
import { TID } from '../contracts/testids';
import { FeedbackLink } from './info/FeedbackLink';

export function AboutPage() {
  return (
    <section data-testid={TID.page('about')} className="space-y-6">
      <h1 className="text-2xl font-bold">เกี่ยวกับการสาธิต</h1>

      <Card title="เดโมนี้ต่างจากระบบจริงอย่างไร" headingLevel={2}>
        <LayeredContent markdown={getInfoMarkdown('about/differences')} />
      </Card>

      <Card title="ข้อมูลของคุณ" headingLevel={2}>
        <LayeredContent markdown={getInfoMarkdown('about/data-and-privacy')} />
      </Card>

      <Card title="เอกสารอ้างอิง" headingLevel={2}>
        <p>
          พฤติกรรมของเดโมอ้างอิง spec หลักชื่อ <span className="font-mono">spec-discussion-summary</span> (ฉบับสรุปอัปเดต 2026-11-11) ตามรหัสข้อ เช่น V3, R14 ที่แสดงในส่วนรายละเอียดทางเทคนิค
        </p>
        <p className="mt-2 text-sm text-slate-700">
          ตอนสร้างเดโม ยังไม่ได้เทียบกับ spec หลักโดยตรง จึงใช้สมมติฐานแทนและระบุไว้ในแต่ละคำอธิบาย
        </p>
      </Card>

      <Card title="ส่งความเห็น" headingLevel={2}>
        <FeedbackLink url={FEEDBACK_URL} />
      </Card>
    </section>
  );
}
