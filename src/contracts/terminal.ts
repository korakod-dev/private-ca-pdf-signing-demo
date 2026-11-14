// Contract: simulated terminal. FROZEN: change only deliberately.
// The terminal is a custom accessible component (role="log" + text input), not xterm.js (docs/adr/0002).
// Commands talk to the app only through the `api`/`demoApi` clients and a TerminalIO, so they are unit-testable
// with scripted fake IO, and the sign-desk "button mode" can drive the very same command code.
import type { UserSummary } from './store';

export type TerminalLineKind = 'out' | 'err' | 'ok' | 'info' | 'prompt';

export interface TerminalIO {
  print(text: string, kind?: TerminalLineKind): void;
  /** Asks one question. `secret` prompts are masked and never echoed or stored in history. */
  prompt(label: string, opts?: { secret?: boolean }): Promise<string>;
  clear(): void;
  /** Prints an in-app link (e.g. to /verify/:jobId). */
  link(label: string, to: string): void;
}

/** Result of parseArgs: `argv[0]` is the command name. Quotes (incl. Thai text) and backslash escapes are honoured. */
export interface ParsedArgs {
  argv: string[];
  /** --flag value / --flag=value / --flag (true). */
  flags: Record<string, string | true>;
  /** Non-flag arguments after the command name. */
  positional: string[];
}

export interface CommandContext {
  io: TerminalIO;
  args: ParsedArgs;
  /** Persona currently acting (null when nobody is signed in). */
  user: UserSummary | null;
}

export interface TerminalCommand {
  name: string;
  summary: string;
  /** Resolves with the exit code (0 = success). Must not throw for user errors; print them via io. */
  run(ctx: CommandContext): Promise<number>;
}
