// Feedback link (spec question 5). The URL is the FEEDBACK_URL constant in src/config/demo.ts (an external Google Form).
// While it is empty the page says feedback is not open; no link is rendered.
export function FeedbackLink({ url }: { url: string }) {
  if (url.trim() === '') {
    return <p>ยังไม่เปิดรับความเห็น</p>;
  }
  return (
    <>
      <p>
        <a className="text-blue-800 underline" href={url} target="_blank" rel="noopener noreferrer">
          ส่งความเห็นเกี่ยวกับเดโมนี้ (Google Form · เปิดในแท็บใหม่)
        </a>
      </p>
      <p className="mt-2 text-sm text-slate-700">
        ลิงก์นี้พาไปที่ Google Form ซึ่งอยู่นอกเดโมและเป็นไปตามนโยบายของ Google ไม่ต้องกรอกชื่อจริง อีเมล หรือข้อมูลส่วนตัวใด ๆ ในคำตอบ เดโมไม่ส่งข้อมูลของคุณไปที่ไหน (สถานะเก็บเฉพาะในเบราว์เซอร์ของคุณ)
      </p>
    </>
  );
}
