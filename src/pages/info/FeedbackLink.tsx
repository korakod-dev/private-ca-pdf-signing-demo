// Feedback link (spec question 5). The URL is a constant the maintainer fills in later (FEEDBACK_URL in src/config/demo.ts).
// While it is empty the page says feedback is not open yet; no link is rendered.
export function FeedbackLink({ url }: { url: string }) {
  if (url.trim() === '') {
    return <p>ยังไม่เปิดรับความเห็น</p>;
  }
  return (
    <p>
      <a className="text-blue-800 underline" href={url} target="_blank" rel="noopener noreferrer">
        ส่งความเห็นเกี่ยวกับเดโมนี้ (เปิดในแท็บใหม่)
      </a>
    </p>
  );
}
