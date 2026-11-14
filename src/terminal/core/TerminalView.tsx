// Accessible simulated terminal: an output area (role="log", focusable so it can be scrolled by keyboard) and one text
// input. The input is also the answer field for questions; a SECRET question switches it to type="password" (masked)
// and nothing typed there is echoed. Up/Down browse history, Ctrl+C cancels a question.
import { useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type Ref } from 'react';
import { Link } from 'react-router';
import type { TerminalCommand, TerminalLineKind } from '../../contracts/terminal';
import type { UserSummary } from '../../contracts/store';
import { TID } from '../../contracts/testids';
import { useAppStore } from '../../store';
import { COMMANDS } from '../registry';
import { useTerminal } from './useTerminal';

const KIND_CLASS: Record<TerminalLineKind, string> = {
  out: 'text-slate-100',
  err: 'text-red-300',
  ok: 'text-green-300',
  info: 'text-sky-300',
  prompt: 'text-slate-300',
};

export const TERMINAL_WELCOME = ['เทอร์มินัลจำลอง (demo) — ไม่ได้รันคำสั่งจริงบนเครื่องของคุณ', 'พิมพ์ help เพื่อดูคำสั่งที่ใช้ได้'];

/** Small handle a host page can use to drive the terminal (e.g. a "run pki-tool init" button, spec 7.6 no. 5). */
export interface TerminalHandle {
  /** Runs a line exactly as if typed: echoed with the prompt, added to history, secret questions still masked. */
  runCommand: (line: string) => void;
}

export interface TerminalViewProps {
  /** Commands to register next to the built-ins. Defaults to the registry (pki-tool, pdfsign). */
  commands?: readonly TerminalCommand[];
  /** Acting persona. Defaults to the one in the store. */
  user?: UserSummary | null;
  welcome?: string[];
  className?: string;
  /** Receives the handle above (React 19 ref-as-prop). */
  handleRef?: Ref<TerminalHandle>;
}

export function TerminalView({ commands = COMMANDS, user, welcome = TERMINAL_WELCOME, className = '', handleRef }: TerminalViewProps) {
  const storeUser = useAppStore((s) => s.user);
  const term = useTerminal({ commands, user: user === undefined ? storeUser : user, welcome });
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  // Host-driven command: same path as typing it (echo + history + running guard), see `submit` in useTerminal.
  // Ignored while a command runs or a question waits (otherwise the line would answer that question); focus goes to the field.
  const { submit: submitLine, pending: pendingQuestion, running: busy } = term;
  useImperativeHandle(
    handleRef,
    () => ({
      runCommand: (line: string) => {
        if (busy || pendingQuestion) inputRef.current?.focus();
        else submitLine(line);
      },
    }),
    [submitLine, pendingQuestion, busy],
  );

  // Keep the newest output in view.
  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [term.lines]);

  // The field is disabled while a command runs (focus drops to <body>); take focus back when it can be typed in again.
  const inputDisabled = term.running && !term.pending;
  useEffect(() => {
    if (!inputDisabled && document.activeElement === document.body) inputRef.current?.focus();
  }, [inputDisabled, term.pending]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (term.pending) return; // no history for answers (secret ones must never come back)
      event.preventDefault();
      setValue(term.navigateHistory(event.key === 'ArrowUp' ? 'up' : 'down', value));
    } else if (event.key === 'c' && event.ctrlKey) {
      event.preventDefault();
      if (!term.abort()) setValue('');
    }
  };

  const secret = term.pending?.secret === true;

  return (
    <div
      data-testid={TID.terminal.root}
      className={`rounded-lg border border-slate-700 bg-slate-900 p-3 font-mono text-sm ${className}`}
    >
      <div
        ref={outputRef}
        data-testid={TID.terminal.output}
        role="log"
        aria-label="ผลลัพธ์ของเทอร์มินัลจำลอง"
        // role="log" is a live region; tabIndex makes the scrollable output reachable and scrollable by keyboard.
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="h-64 overflow-y-auto whitespace-pre-wrap break-words"
      >
        {term.lines.map((line) => (
          <div key={line.id} data-kind={line.kind} className={KIND_CLASS[line.kind]}>
            {line.to ? (
              <Link to={line.to} className="underline">
                {line.text}
              </Link>
            ) : (
              line.text
            )}
          </div>
        ))}
      </div>
      <form
        className="mt-2 flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (inputDisabled) return;
          const submitted = value;
          setValue(''); // clear first: a secret answer must not stay in component state
          term.submit(submitted);
        }}
      >
        <span aria-hidden="true" className="shrink-0 text-slate-300">
          {term.pending ? term.pending.label : '$'}
        </span>
        <input
          ref={inputRef}
          data-testid={TID.terminal.input}
          type={secret ? 'password' : 'text'}
          value={value}
          disabled={inputDisabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label={term.pending ? term.pending.label : 'พิมพ์คำสั่ง'}
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100 focus-visible:outline-2 focus-visible:outline-sky-400"
        />
      </form>
    </div>
  );
}
