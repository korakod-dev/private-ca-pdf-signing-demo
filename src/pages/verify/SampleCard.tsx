// One of the 12 sample documents on /verify. The button carries TID.verify.sample(id).
import type { SampleDto } from '../../contracts/api';
import { TID } from '../../contracts/testids';
import { Button } from '../../components';

export interface SampleCardProps {
  sample: SampleDto;
  /** True while any verify request is in flight (all buttons wait). */
  busy: boolean;
  /** True when THIS sample is the one being submitted or polled. */
  active: boolean;
  onVerify: (id: string) => void;
}

export function SampleCard({ sample, busy, active, onVerify }: SampleCardProps) {
  const preview = sample.previews[0];
  return (
    <li className="flex flex-col rounded-lg border border-slate-300 bg-white p-3 shadow-sm">
      {preview ? (
        // Decorative thumbnail (the title below already names the document), so the alt is empty. Previews carry the DEMO watermark.
        <img src={preview} alt="" loading="lazy" className="mb-2 h-40 w-full rounded border border-slate-200 bg-slate-50 object-contain" />
      ) : null}
      <h3 className="font-semibold text-slate-900">
        <span className="font-mono text-sm">{sample.id}</span> {sample.title_th}
      </h3>
      <p className="mt-1 text-sm text-slate-700">{sample.scenario_th}</p>
      <p className="mt-1 break-all font-mono text-xs text-slate-700">
        {sample.file_name} · {sample.pages} หน้า
      </p>
      <div className="mt-3">
        <Button data-testid={TID.verify.sample(sample.id)} disabled={busy} aria-busy={active} onClick={() => onVerify(sample.id)}>
          {active ? 'กำลังตรวจ…' : `ตรวจ ${sample.id}`}
        </Button>
      </div>
    </li>
  );
}
