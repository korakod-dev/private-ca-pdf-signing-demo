// Upload control of /verify (spec section 5): the demo CANNOT check real files, and an uploaded file is never read.
// The change handler does exactly two things: show the notice and clear the input. It never touches the file object
// (no name, no size, no content), never calls the API, and ESLint bans FileReader / arrayBuffer / text / stream here.
import { useRef, useState, type ChangeEvent } from 'react';
import { TID } from '../../contracts/testids';

export const UPLOAD_NOTICE_TH = 'ระบบจำลองตรวจไฟล์จริงไม่ได้ เลือกเอกสารตัวอย่างแทน';

export function UploadBox() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [showNotice, setShowNotice] = useState(false);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    // Reset first so the same file can be picked again and nothing keeps a reference to the selection.
    event.target.value = '';
    setShowNotice(true);
  };

  return (
    <div className="rounded-lg border border-dashed border-slate-500 bg-white p-4">
      <label htmlFor="verify-upload-input" className="block font-medium">
        หรืออัปโหลดไฟล์ PDF ของคุณเอง
      </label>
      <p className="mt-1 text-sm text-slate-700">เดโมนี้ไม่อ่านไฟล์ที่คุณเลือก และไม่ส่งไฟล์ไปที่ใด</p>
      <input
        id="verify-upload-input"
        ref={inputRef}
        type="file"
        accept="application/pdf"
        data-testid={TID.verify.upload}
        onChange={onChange}
        className="mt-2 block w-full text-sm text-slate-900 file:mr-3 file:rounded file:border file:border-slate-500 file:bg-white file:px-3 file:py-1.5"
      />
      {showNotice ? (
        <p role="status" data-testid={TID.verify.uploadNotice} className="mt-3 rounded border border-amber-700 bg-amber-50 p-3 text-slate-900">
          {UPLOAD_NOTICE_TH}
        </p>
      ) : null}
    </div>
  );
}
