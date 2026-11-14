// Terminal state machine (React hook): output lines, the pending question (prompt engine), command history, busy flag.
// Rules enforced here:
//   - a SECRET answer is never echoed into the output, never stored in history and never kept in state after it is sent;
//   - only commands (not answers to questions) go into the up/down history;
//   - a command line is ignored while another command is running (answers to a pending question are not).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TerminalCommand, TerminalIO, TerminalLineKind } from '../../contracts/terminal';
import type { UserSummary } from '../../contracts/store';
import { PromptAborted, runLine } from './dispatch';

export interface TerminalLine {
  id: number;
  kind: TerminalLineKind;
  text: string;
  /** In-app link target (io.link). The line renders `text` as a router link. */
  to?: string;
}

export interface PendingPrompt {
  label: string;
  secret: boolean;
}

/** Output is capped so a long session cannot grow the DOM without bound. */
export const MAX_LINES = 500;
export const MAX_HISTORY = 100;

interface PendingInternal extends PendingPrompt {
  resolve: (answer: string) => void;
  reject: (reason: Error) => void;
}

export interface TerminalController {
  lines: TerminalLine[];
  pending: PendingPrompt | null;
  running: boolean;
  /** Handles Enter: answers the pending question, or runs the line as a command. */
  submit: (value: string) => void;
  /** Ctrl+C: aborts the pending question (if any). Returns true when something was aborted. */
  abort: () => boolean;
  /** Up/down through earlier commands. `current` is what is in the field now (kept as a draft). Returns the new text. */
  navigateHistory: (direction: 'up' | 'down', current: string) => string;
  /** The IO handed to commands (also usable by a host component to run commands programmatically). */
  io: TerminalIO;
  /** Runs a line as if typed (used by the "button mode" hosts). */
  run: (line: string) => Promise<number>;
}

export function useTerminal(opts: { commands: readonly TerminalCommand[]; user: UserSummary | null; welcome?: string[] }): TerminalController {
  const { commands, user } = opts;
  const welcome = opts.welcome ?? [];
  const nextId = useRef(welcome.length);
  const [lines, setLines] = useState<TerminalLine[]>(() => welcome.map((text, id) => ({ id, kind: 'info' as const, text })));
  const [pending, setPending] = useState<PendingPrompt | null>(null);
  const [running, setRunning] = useState(false);

  const pendingRef = useRef<PendingInternal | null>(null);
  const runningRef = useRef(false);
  const history = useRef<string[]>([]);
  const historyPos = useRef<number | null>(null); // null = not browsing history
  const draft = useRef('');

  // Always use the latest commands/user without rebuilding `io` (a running command keeps its io object).
  const latest = useRef({ commands, user });
  useEffect(() => {
    latest.current = { commands, user };
  });

  const append = useCallback((entries: Omit<TerminalLine, 'id'>[]) => {
    setLines((prev) => [...prev, ...entries.map((e) => ({ ...e, id: nextId.current++ }))].slice(-MAX_LINES));
  }, []);

  const io = useMemo<TerminalIO>(
    () => ({
      print(text, kind = 'out') {
        append(text.split('\n').map((t) => ({ kind, text: t })));
      },
      prompt(label, options) {
        const secret = options?.secret === true;
        return new Promise<string>((resolve, reject) => {
          pendingRef.current = { label, secret, resolve, reject };
          setPending({ label, secret });
        });
      },
      clear() {
        setLines([]);
      },
      link(label, to) {
        append([{ kind: 'info', text: label, to }]);
      },
    }),
    [append],
  );

  const run = useCallback(
    async (line: string): Promise<number> => {
      runningRef.current = true;
      setRunning(true);
      try {
        return await runLine(line, { io, user: latest.current.user, commands: latest.current.commands });
      } finally {
        runningRef.current = false;
        setRunning(false);
      }
    },
    [io],
  );

  const submit = useCallback(
    (value: string) => {
      const waiting = pendingRef.current;
      if (waiting) {
        pendingRef.current = null;
        setPending(null);
        // Echo the question and (unless secret) the answer. A secret answer goes straight to the command and nowhere else.
        append([{ kind: 'prompt', text: waiting.secret ? waiting.label : `${waiting.label} ${value}` }]);
        waiting.resolve(value);
        return;
      }
      if (runningRef.current) return;
      historyPos.current = null;
      draft.current = '';
      append([{ kind: 'prompt', text: `$ ${value}` }]);
      const line = value.trim();
      if (line === '') return;
      if (history.current[history.current.length - 1] !== line) history.current = [...history.current, line].slice(-MAX_HISTORY);
      void run(line);
    },
    [append, run],
  );

  const abort = useCallback(() => {
    const waiting = pendingRef.current;
    if (!waiting) return false;
    pendingRef.current = null;
    setPending(null);
    waiting.reject(new PromptAborted());
    return true;
  }, []);

  const navigateHistory = useCallback((direction: 'up' | 'down', current: string) => {
    const items = history.current;
    if (items.length === 0) return current;
    if (direction === 'up') {
      if (historyPos.current === null) {
        draft.current = current;
        historyPos.current = items.length - 1;
      } else {
        historyPos.current = Math.max(0, historyPos.current - 1);
      }
      return items[historyPos.current] as string;
    }
    if (historyPos.current === null) return current;
    if (historyPos.current >= items.length - 1) {
      historyPos.current = null;
      return draft.current;
    }
    historyPos.current += 1;
    return items[historyPos.current] as string;
  }, []);

  // Leaving the page with a question open must not leave the command hanging forever.
  useEffect(
    () => () => {
      pendingRef.current?.reject(new PromptAborted());
      pendingRef.current = null;
    },
    [],
  );

  return { lines, pending, running, submit, abort, navigateHistory, io, run };
}
