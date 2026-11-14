// Sign desk "button mode" (spec 7.6 row 7): a form for people who prefer not to type commands.
//
// ONE code path: the form builds the very same command line a person would type (`pdfsign sign <file> --field "<f>"
// [--certify]`) and runs it through `runLine` with the real `pdfsign` command. The command's questions (purpose, last
// 4 characters of the SHA-256, .p12 password) are answered from the form fields through a form-backed TerminalIO, so
// the API calls are identical to the terminal's (demoApi.signReview, then demoApi.sign), and so are the refusals.
//
// How the submit button works (one button, label follows the step):
//   idle / finished  -> starts the command (review step)
//   a question open  -> answers it with the matching field and lets the command continue
// Later-step fields are always enabled so a keyboard user can fill them before the question appears; each one is read
// only when its question is asked. The .p12 password field is emptied as soon as it is submitted.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { demoApi } from '../../api';
import type { TerminalIO, TerminalLineKind } from '../../contracts/terminal';
import { TID } from '../../contracts/testids';
import { Button, Card, useApi } from '../../components';
import { useAppStore } from '../../store';
import { PDFSIGN_PROMPTS, pdfsign } from '../../terminal/commands/pdfsign';
import { PromptAborted, runLine } from '../../terminal';

type PromptKind = keyof typeof PDFSIGN_PROMPTS;

interface WizardLine {
  id: number;
  kind: TerminalLineKind;
  text: string;
  to?: string;
  /** 'review' = printed before the first question; 'after' = everything later. */
  phase: 'review' | 'after';
}

const LINE_CLASS: Record<TerminalLineKind, string> = {
  out: 'text-slate-900',
  err: 'text-red-900 font-medium',
  ok: 'text-green-900 font-medium',
  info: 'text-blue-900',
  prompt: 'text-slate-700',
};

const PURPOSES = [
  { value: '1', label: '1 อนุมัติ' },
  { value: '2', label: '2 รับทราบ' },
  { value: '3', label: '3 ผู้จัดทำ' },
  { value: '4', label: '4 พยาน' },
] as const;

const SUBMIT_LABEL: Record<PromptKind | 'idle' | 'busy', string> = {
  idle: 'ทบทวนเอกสาร',
  busy: 'กำลังทำงาน…',
  purpose: 'ยืนยันวัตถุประสงค์',
  sha: 'ยืนยัน 4 ตัวท้ายของ SHA-256',
  p12: 'เซ็นเอกสาร',
};

/** Quotes a word for the command line (the parser honours "double quotes" with \" and \\ escapes). */
const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

function promptKindOf(label: string): PromptKind | null {
  return (Object.keys(PDFSIGN_PROMPTS) as PromptKind[]).find((k) => PDFSIGN_PROMPTS[k] === label) ?? null;
}

export function SignWizard() {
  const user = useAppStore((s) => s.user);
  const workstation = useApi(() => demoApi.workstation());
  const documents = useMemo(() => workstation.data?.documents ?? [], [workstation.data]);

  const [docPath, setDocPath] = useState('');
  const [field, setField] = useState('approver-1');
  const [certify, setCertify] = useState(false);
  const [purpose, setPurpose] = useState('1');
  const [sha, setSha] = useState('');
  const [p12, setP12] = useState('');

  const [lines, setLines] = useState<WizardLine[]>([]);
  const [pending, setPending] = useState<PromptKind | null>(null);
  const [running, setRunning] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [promptIssued, setPromptIssued] = useState(false);

  const nextId = useRef(0);
  const phase = useRef<'review' | 'after'>('review');
  const waiting = useRef<{ kind: PromptKind; resolve: (answer: string) => void; reject: (e: Error) => void } | null>(null);
  // The latest field values, read when a question is answered (the IO object outlives the render that created it).
  const values = useRef({ purpose, sha, p12 });
  useEffect(() => {
    values.current = { purpose, sha, p12 };
  });

  // Default document: the unsigned original (first in the list otherwise).
  const effectiveDoc = docPath || documents.find((d) => d.document_id === 'D12')?.path || documents[0]?.path || '';

  const append = useCallback((kind: TerminalLineKind, text: string, to?: string) => {
    // Read the phase and the id NOW: a state updater runs later (after the next prompt may have switched the phase).
    const line: WizardLine = { id: nextId.current++, kind, text, ...(to ? { to } : {}), phase: phase.current };
    setLines((prev) => [...prev, line]);
  }, []);

  // The form-backed IO handed to the command.
  const io = useMemo<TerminalIO>(
    () => ({
      print(text, kind = 'out') {
        for (const t of text.split('\n')) append(kind, t);
      },
      prompt(label) {
        const kind = promptKindOf(label);
        return new Promise<string>((resolve, reject) => {
          if (kind === null) {
            // The command asked something this form has no field for: stop instead of hanging.
            reject(new PromptAborted());
            return;
          }
          phase.current = 'after';
          setPromptIssued(true);
          waiting.current = { kind, resolve, reject };
          setPending(kind);
        });
      },
      clear() {
        setLines([]);
      },
      link(label, to) {
        append('info', label, to);
      },
    }),
    [append],
  );

  // Leaving the page with a question open must not leave the command hanging.
  useEffect(
    () => () => {
      waiting.current?.reject(new PromptAborted());
      waiting.current = null;
    },
    [],
  );

  const start = () => {
    setLines([]);
    setExitCode(null);
    setPromptIssued(false);
    phase.current = 'review';
    setRunning(true);
    const line = `pdfsign sign ${quote(effectiveDoc)} --field ${quote(field)}${certify ? ' --certify' : ''}`;
    void runLine(line, { io, user, commands: [pdfsign] }).then((code) => {
      setPending(null);
      setRunning(false);
      setExitCode(code);
    });
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const w = waiting.current;
    if (w) {
      waiting.current = null;
      setPending(null);
      const v = values.current;
      if (w.kind === 'p12') setP12(''); // the secret never stays in state
      w.resolve(w.kind === 'purpose' ? v.purpose : w.kind === 'sha' ? v.sha : v.p12);
      return;
    }
    if (!running) start();
  };

  const submitKey: PromptKind | 'idle' | 'busy' = pending ?? (running ? 'busy' : 'idle');
  const reviewLines = promptIssued ? lines.filter((l) => l.phase === 'review') : [];
  const resultLines = promptIssued ? lines.filter((l) => l.phase === 'after') : lines;
  const state = running ? 'running' : exitCode === null ? 'idle' : exitCode === 0 ? 'ok' : 'failed';
  const locked = running || pending !== null;

  const renderLines = (list: WizardLine[]) => (
    <ul className="space-y-0.5 font-mono text-sm">
      {list.map((l) => (
        <li key={l.id} data-kind={l.kind} className={`break-words ${LINE_CLASS[l.kind]}`}>
          {l.to ? (
            <Link to={l.to} className="underline">
              {l.text}
            </Link>
          ) : (
            l.text
          )}
        </li>
      ))}
    </ul>
  );

  const inputCls = 'mt-1 block w-full rounded border border-slate-500 bg-white px-3 py-2 text-base text-slate-900';

  return (
    <Card title="เซ็นด้วยแบบฟอร์ม (โหมดปุ่มกด)" headingLevel={2}>
      <p className="mb-3 text-sm text-slate-700">
        แบบฟอร์มนี้ทำงานเหมือนการพิมพ์ <code>pdfsign sign</code> ทุกอย่าง และเรียกระบบจำลองด้วยลำดับเดียวกัน
      </p>
      <form onSubmit={onSubmit} noValidate className="space-y-3">
        <div>
          <label htmlFor="wiz-doc" className="block text-sm font-medium">
            เอกสาร (ใน ~/Documents)
          </label>
          <select
            id="wiz-doc"
            data-testid={TID.sign.wizardDocument}
            value={effectiveDoc}
            disabled={locked}
            onChange={(e) => setDocPath(e.target.value)}
            className={inputCls}
          >
            {documents.map((d) => (
              <option key={d.path} value={d.path}>
                {d.path.replace('~/Documents/', '')}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="wiz-field" className="block text-sm font-medium">
            ช่องลายเซ็น
          </label>
          <input
            id="wiz-field"
            data-testid={TID.sign.wizardField}
            type="text"
            value={field}
            disabled={locked}
            onChange={(e) => setField(e.target.value)}
            aria-describedby="wiz-field-hint"
            className={inputCls}
          />
          <p id="wiz-field-hint" className="mt-1 text-xs text-slate-700">
            เอกสาร memo-130 มีช่อง approver-1 (คนแรก) และ approver-2 (คนที่สอง)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            id="wiz-certify"
            data-testid={TID.sign.wizardCertify}
            type="checkbox"
            checked={certify}
            disabled={locked}
            onChange={(e) => setCertify(e.target.checked)}
            className="h-5 w-5"
          />
          <label htmlFor="wiz-certify" className="text-sm font-medium">
            เซ็นแบบ certification (ลายเซ็นแรกของเอกสารเท่านั้น)
          </label>
        </div>
        <div>
          <label htmlFor="wiz-purpose" className="block text-sm font-medium">
            วัตถุประสงค์ของการเซ็น
          </label>
          <select id="wiz-purpose" data-testid={TID.sign.wizardPurpose} value={purpose} onChange={(e) => setPurpose(e.target.value)} className={inputCls}>
            {PURPOSES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="wiz-sha" className="block text-sm font-medium">
            อักขระ 4 ตัวสุดท้ายของ SHA-256 (ดูจากผลทบทวนด้านล่าง)
          </label>
          <input
            id="wiz-sha"
            data-testid={TID.sign.wizardSha}
            type="text"
            value={sha}
            maxLength={4}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setSha(e.target.value)}
            className={`${inputCls} font-mono`}
          />
        </div>
        <div>
          <label htmlFor="wiz-p12" className="block text-sm font-medium">
            รหัสผ่านไฟล์ .p12
          </label>
          <input
            id="wiz-p12"
            data-testid={TID.sign.wizardP12}
            type="password"
            value={p12}
            autoComplete="off"
            onChange={(e) => setP12(e.target.value)}
            className={inputCls}
          />
        </div>
        <p role="status" className="text-sm text-slate-800">
          {pending
            ? `ขั้นตอนตอนนี้: ${PDFSIGN_PROMPTS[pending]} กรอกช่องที่เกี่ยวข้องแล้วกดปุ่มด้านล่าง`
            : running
              ? 'กำลังทบทวนเอกสาร…'
              : 'เริ่มจากเลือกเอกสารและช่องลายเซ็น แล้วกด "ทบทวนเอกสาร"'}
        </p>
        <Button type="submit" data-testid={TID.sign.wizardSubmit} data-step={submitKey} disabled={submitKey === 'busy'}>
          {SUBMIT_LABEL[submitKey]}
        </Button>
      </form>

      {reviewLines.length > 0 ? (
        <div data-testid={TID.sign.review} className="mt-4 rounded border border-slate-300 bg-slate-50 p-3">
          <h3 className="mb-1 font-semibold">ผลทบทวนก่อนเซ็น</h3>
          {renderLines(reviewLines)}
        </div>
      ) : null}
      {resultLines.length > 0 ? (
        <div data-testid={TID.sign.result} data-state={state} className="mt-4 rounded border border-slate-300 bg-slate-50 p-3">
          <h3 className="mb-1 font-semibold">ผลลัพธ์</h3>
          {renderLines(resultLines)}
        </div>
      ) : null}
    </Card>
  );
}
