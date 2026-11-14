// Command registry: the commands available next to the built-ins (help, clear, ls, which live in core/dispatch.ts).
// The command modules may be replaced but must keep their export names (`pkiTool`, `pdfsign`).
import type { TerminalCommand } from '../contracts/terminal';
import { pdfsign } from './commands/pdfsign';
import { pkiTool } from './commands/pkiTool';

export const COMMANDS: readonly TerminalCommand[] = [pkiTool, pdfsign];
