// Headless command dispatcher: line -> parse -> built-in or registered command. No React in here, so it is unit-testable
// with a scripted TerminalIO, and the sign desk "button mode" (sub-task G) can drive the very same command code.
import { demoApi } from '../../api';
import type { CommandContext, TerminalCommand, TerminalIO } from '../../contracts/terminal';
import type { UserSummary } from '../../contracts/store';
import { ParseError, parseArgs } from './parseArgs';

/** Flags that never take a value (see ParseOptions.booleanFlags). `yes` is parsed so pdfsign can refuse it (rule S2). */
export const BOOLEAN_FLAGS: readonly string[] = ['certify', 'yes', 'help'];

/** Exit code printed for an unknown command (POSIX "command not found"). */
export const EXIT_NOT_FOUND = 127;

const dirOf = (path: string) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '.');
const baseOf = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/** Built-ins: help, clear, ls. `registered` is only used to build the help text. */
export function builtinCommands(registered: readonly TerminalCommand[]): TerminalCommand[] {
  const help: TerminalCommand = {
    name: 'help',
    summary: 'แสดงรายการคำสั่ง',
    async run({ io }) {
      io.print('คำสั่งที่ใช้ได้ในเทอร์มินัลจำลอง:', 'info');
      const all = [...builtinCommands([]), ...registered];
      const width = Math.max(...all.map((c) => c.name.length));
      for (const c of all) io.print(`  ${c.name.padEnd(width)}  ${c.summary}`);
      return 0;
    },
  };

  const clear: TerminalCommand = {
    name: 'clear',
    summary: 'ล้างหน้าจอ',
    async run({ io }) {
      io.clear();
      return 0;
    },
  };

  const ls: TerminalCommand = {
    name: 'ls',
    summary: 'แสดงไฟล์ในเครื่องจำลอง (~/Documents และ ~/.private-ca)',
    async run({ io, args }) {
      const result = await demoApi.workstation();
      if (!result.ok) {
        io.print(`ls: ${result.error.title}`, 'err');
        return 2;
      }
      const files = [...result.data.documents.map((d) => d.path), ...result.data.private_ca.map((f) => f.path)];
      const target = args.positional[0]?.replace(/\/+$/, '');
      if (target !== undefined) {
        const inDir = files.filter((p) => dirOf(p) === target);
        if (inDir.length === 0) {
          io.print(`ls: cannot access '${target}': No such file or directory (demo)`, 'err');
          return 2;
        }
        for (const p of inDir) io.print(baseOf(p));
        return 0;
      }
      // No argument: every directory with its files (like `ls` on several directories).
      const dirs = [...new Set(files.map(dirOf))];
      for (const dir of dirs) {
        io.print(`${dir}:`, 'info');
        for (const p of files.filter((f) => dirOf(f) === dir)) io.print(`  ${baseOf(p)}`);
      }
      if (dirs.length === 0) io.print('(ว่าง)');
      return 0;
    },
  };

  return [help, clear, ls];
}

export interface RunLineDeps {
  io: TerminalIO;
  user: UserSummary | null;
  /** Commands from the registry (pki-tool, pdfsign, ...). Built-ins are added here. */
  commands: readonly TerminalCommand[];
}

/** Runs one command line and resolves with its exit code. Never throws (errors are printed through `io`). */
export async function runLine(line: string, { io, user, commands }: RunLineDeps): Promise<number> {
  const trimmed = line.trim();
  if (trimmed === '') return 0;

  let args;
  try {
    args = parseArgs(trimmed, { booleanFlags: BOOLEAN_FLAGS });
  } catch (error) {
    if (error instanceof ParseError) {
      io.print(`parse error: ${error.message}`, 'err');
      return 2;
    }
    throw error;
  }

  const name = args.argv[0];
  const command = [...builtinCommands(commands), ...commands].find((c) => c.name === name);
  if (!command) {
    io.print(`${name}: command not found (demo)`, 'err');
    return EXIT_NOT_FOUND;
  }

  const ctx: CommandContext = { io, args, user };
  try {
    return await command.run(ctx);
  } catch (error) {
    // A Ctrl+C on a prompt rejects with PromptAborted; anything else is a bug in the command.
    if (error instanceof PromptAborted) {
      io.print('^C', 'info');
      return 130;
    }
    io.print(`${name}: internal error (demo)`, 'err');
    return 1;
  }
}

/** Rejection reason of `io.prompt` when the learner presses Ctrl+C at a question. */
export class PromptAborted extends Error {
  constructor() {
    super('prompt aborted');
  }
}
