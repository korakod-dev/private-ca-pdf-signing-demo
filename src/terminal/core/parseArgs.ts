// Command-line parser for the simulated terminal (spec 7.7). Supports:
//   - whitespace separated words;
//   - 'single quotes' (everything literal) and "double quotes" (a backslash escapes only " and \), Thai text included;
//   - backslash escapes outside quotes (\<space>, \", \\ ...);
//   - flags: --name value, --name=value, --name (true), -x; "--" ends option parsing.
import type { ParsedArgs } from '../../contracts/terminal';

/** Thrown for input that cannot be tokenised (unterminated quote, trailing backslash). */
export class ParseError extends Error {}

export interface ParseOptions {
  /**
   * Flags that never take a value, so `--certify file.pdf` keeps `file.pdf` as a positional argument.
   * Without this a flag would swallow the next word (the contract only knows `--flag value`).
   */
  booleanFlags?: ReadonlySet<string> | readonly string[];
}

/** Splits a line into words. A quoted empty string ("") yields an empty word. */
export function tokenize(line: string): string[] {
  const words: string[] = [];
  let current = '';
  let inWord = false; // true once the current word has any character or any quotes (so "" counts)
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
    } else if (quote === '"') {
      if (ch === '"') {
        quote = null;
      } else if (ch === '\\') {
        const next = line[i + 1];
        if (next === undefined) throw new ParseError('trailing backslash');
        // Inside double quotes a backslash only escapes " and \ (like a POSIX shell); otherwise it stays literal.
        if (next === '"' || next === '\\') {
          current += next;
          i++;
        } else {
          current += ch;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      inWord = true;
    } else if (ch === '\\') {
      const next = line[i + 1];
      if (next === undefined) throw new ParseError('trailing backslash');
      current += next;
      inWord = true;
      i++;
    } else if (/\s/.test(ch)) {
      if (inWord) {
        words.push(current);
        current = '';
        inWord = false;
      }
    } else {
      current += ch;
      inWord = true;
    }
  }
  if (quote) throw new ParseError(`unterminated ${quote === '"' ? 'double' : 'single'} quote`);
  if (inWord) words.push(current);
  return words;
}

/**
 * Parses a command line. `argv` is every word in order (command name first, flags and their values included);
 * `positional` are the non-flag words after the command name.
 */
export function parseArgs(line: string, options: ParseOptions = {}): ParsedArgs {
  const booleans = new Set(options.booleanFlags ?? []);
  const argv = tokenize(line);
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];

  let optionsEnded = false;
  for (let i = 1; i < argv.length; i++) {
    const word = argv[i] as string;
    if (optionsEnded || !isFlagWord(word)) {
      positional.push(word);
      continue;
    }
    if (word === '--') {
      optionsEnded = true;
      continue;
    }
    const name = word.replace(/^--?/, '');
    const eq = name.indexOf('=');
    if (word.startsWith('--') && eq > 0) {
      flags[name.slice(0, eq)] = name.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (!booleans.has(name) && next !== undefined && !isFlagWord(next)) {
      flags[name] = next;
      i++;
    } else {
      flags[name] = true;
    }
  }
  return { argv, flags, positional };
}

/** "--x", "-x" and "--" are flags; "-" and negative numbers are ordinary words. */
function isFlagWord(word: string): boolean {
  return word === '--' || (/^--?[^-\d\s]/.test(word) && word.length > 1) || /^--\S/.test(word);
}
