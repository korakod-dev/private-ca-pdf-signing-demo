// 404 page: shown for any path that is not a route.
import { Link } from 'react-router';
import { ROUTES } from '../contracts/routes';
import { TID } from '../contracts/testids';

export function NotFoundPage() {
  return (
    <section data-testid={TID.page('notFound')}>
      <h1 className="text-2xl font-bold">ไม่พบหน้านี้</h1>
      <p className="mt-2 text-slate-800">ลิงก์นี้ไม่มีอยู่ในเดโม อาจพิมพ์ที่อยู่ผิด ลองเลือกจากเมนูด้านบน หรือกลับไปหน้าแรก</p>
      <p className="mt-3">
        <Link className="text-blue-800 underline" to={ROUTES.home}>
          กลับหน้าแรก
        </Link>
      </p>
    </section>
  );
}
