// /missions - the eleven learning missions M1-M11 (spec 7.8). Static labels come from src/contracts/missions.ts, the long
// text from src/content/missions/M*.md (intro / "สิ่งที่เพิ่งเกิดขึ้น" / technical details), and `data-done` from the demo
// status (store `demo.missions`, evaluated by the engine). Public page: no role gate.
import { useEffect } from 'react';
import { Link } from 'react-router';
import { ContentBlock, Explain, LayeredContent } from '../components';
import { getMarkdown as getOpsMarkdown } from './ops/content';
import { MISSIONS } from '../contracts/missions';
import { TID } from '../contracts/testids';
import { useAppStore } from '../store';
import { SECTION, loadContent } from './ops/content';
import { formatTime } from './ops/format';

export function MissionsPage() {
  const progress = useAppStore((s) => s.demo?.missions);
  const dataVersion = useAppStore((s) => s.dataVersion);

  // Fresh status on arrival: the demo bar polls once a second, but a mission finished a moment ago should show at once.
  useEffect(() => {
    void useAppStore.getState().refreshDemoStatus();
  }, [dataVersion]);

  const doneCount = progress?.filter((m) => m.done).length ?? 0;

  return (
    <section data-testid={TID.page('missions')}>
      <h1 className="text-2xl font-bold">ภารกิจ</h1>
      <div className="mt-3 space-y-4">
        <LayeredContent markdown={getOpsMarkdown('missions', 'overview')} />
        <p role="status" className="font-medium">
          {progress ? `สำเร็จแล้ว ${doneCount} จาก ${MISSIONS.length} ภารกิจ` : 'กำลังโหลดความคืบหน้า…'}
        </p>

        <ol className="space-y-4">
          {MISSIONS.map((m) => {
            const state = progress?.find((p) => p.id === m.id);
            const done = state?.done === true;
            const { refs, sections } = loadContent('missions', m.id);
            const intro = sections[SECTION.intro];
            const happened = sections[SECTION.happened];
            const technical = sections[SECTION.technical];
            return (
              <li key={m.id} data-testid={TID.missions.item(m.id)} data-done={String(done)} className="rounded-lg border border-slate-300 bg-white p-4 shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-lg font-semibold">
                    {m.id} · {m.title_th}
                  </h2>
                  <span
                    className={`rounded border px-2 py-0.5 text-sm font-medium ${done ? 'border-green-700 bg-green-100 text-green-900' : 'border-slate-500 bg-slate-100 text-slate-900'}`}
                  >
                    {done ? '✓ สำเร็จ' : '○ ยังไม่ได้ทำ'}
                  </span>
                </div>
                <dl className="mt-2 space-y-1 text-sm">
                  <div>
                    <dt className="inline font-medium">บทบาท: </dt>
                    <dd className="inline">{m.role_th}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">สิ่งที่ได้เรียน: </dt>
                    <dd className="inline">{m.learns_th}</dd>
                  </div>
                  <div>
                    <dt className="inline font-medium">สำเร็จเมื่อ: </dt>
                    <dd className="inline">{m.done_when_th}</dd>
                  </div>
                  {done && state?.done_at ? (
                    <div>
                      <dt className="inline font-medium">ทำสำเร็จเมื่อ (เวลาจำลอง): </dt>
                      <dd className="inline font-mono">{formatTime(state.done_at)}</dd>
                    </div>
                  ) : null}
                </dl>

                {intro ? (
                  <div className="mt-3">
                    <Explain technical={technical ? <ContentBlock markdown={technical} /> : undefined}>
                      <ContentBlock markdown={intro} />
                    </Explain>
                  </div>
                ) : null}

                <p className="mt-2 text-sm">
                  <Link className="text-blue-800 underline" to={m.start_route}>
                    เริ่มที่หน้านี้
                  </Link>
                </p>

                <div className="mt-3 rounded border border-slate-300 bg-slate-50 p-3">
                  <h3 className="font-semibold">สิ่งที่เพิ่งเกิดขึ้น</h3>
                  {done && happened ? (
                    <>
                      <ContentBlock markdown={happened} />
                      {refs.length > 0 ? <p className="text-xs text-slate-700">อ้างอิงรหัสข้อใน spec หลัก: {refs.join(', ')}</p> : null}
                    </>
                  ) : (
                    <p className="text-sm text-slate-700">สรุปจะแสดงที่นี่เมื่อคุณทำภารกิจนี้สำเร็จ</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
