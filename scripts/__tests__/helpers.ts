// Test helpers shared by the scripts tests (not collected as a test file: no .test suffix).
import { execFile } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { FIXTURE_NAMES, loadFixtureFiles } from '../lib/fixture-checks';
import type { FixtureFiles } from '../lib/real-data-detector';

const execFileAsync = promisify(execFile);

/** App root = the folder with package.json. */
export const APP_ROOT = resolve(import.meta.dirname, '..', '..');
export const REAL_FIXTURES_DIR = join(APP_ROOT, 'src', 'fixtures');
export const REAL_PUBLIC_DIR = join(APP_ROOT, 'public');

/** Deep copy of the real fixture files (parsed JSON), safe to mutate in a test. */
export function loadRealFixtures(): FixtureFiles {
  const { files, findings } = loadFixtureFiles(REAL_FIXTURES_DIR);
  if (findings.length > 0) throw new Error('real fixtures are not loadable');
  return structuredClone(files);
}

/** Result of running a script as a child process. */
export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

/** Runs `tsx scripts/<name>` in a child process (real exit code), never throws on a non-zero exit. */
export async function runScript(script: string, args: string[]): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, ['--import', 'tsx', join(APP_ROOT, 'scripts', script), ...args], {
      cwd: APP_ROOT,
      encoding: 'utf8',
    });
    return { status: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { status: typeof e.code === 'number' ? e.code : 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

/** A throw-away copy of the fixtures + previews that a test can corrupt; call cleanup() afterwards. */
export interface Sandbox {
  fixturesDir: string;
  publicDir: string;
  /** Applies `edit` to the parsed JSON of one fixture file and writes it back. */
  mutate: (name: (typeof FIXTURE_NAMES)[number], edit: (data: any) => void) => void; // eslint-disable-line @typescript-eslint/no-explicit-any
  cleanup: () => void;
  /** CLI args pointing a script at this sandbox. */
  args: () => string[];
}

export function makeSandbox(): Sandbox {
  const root = mkdtempSync(join(tmpdir(), 'pcpsd-fixtures-'));
  const fixturesDir = join(root, 'fixtures');
  const publicDir = join(root, 'public');
  mkdirSync(fixturesDir, { recursive: true });
  for (const name of FIXTURE_NAMES) cpSync(join(REAL_FIXTURES_DIR, `${name}.json`), join(fixturesDir, `${name}.json`));
  cpSync(join(REAL_PUBLIC_DIR, 'previews'), join(publicDir, 'previews'), { recursive: true });
  return {
    fixturesDir,
    publicDir,
    mutate: (name, edit) => {
      const path = join(fixturesDir, `${name}.json`);
      const data = JSON.parse(readFileSync(path, 'utf8')) as unknown;
      edit(data);
      writeFileSync(path, JSON.stringify(data, null, 2));
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
    args: () => ['--fixtures-dir', fixturesDir, '--public-dir', publicDir],
  };
}

// ---- Run-time generated sample values ------------------------------------------------------------------------------
// The tests need Thai-ID-like and phone-like strings, but no such literal may live in the repo (a literal could match a
// real person or a dialable number). They are generated per test run instead. The detector matches by pattern, so any
// random digits work.

/** Random string of `n` ASCII digits. */
function randomDigits(n: number): string {
  return Array.from({ length: n }, () => Math.floor(Math.random() * 10)).join('');
}

/** Thai national ID checksum digit (13th) for the first 12 digits: (11 - sum(d_i * (13 - i)) mod 11) mod 10. */
export function thaiIdCheckDigit(first12: string): number {
  const sum = [...first12].reduce((acc, d, i) => acc + Number(d) * (13 - i), 0);
  return (11 - (sum % 11)) % 10;
}

/** A random 13-digit string with a VALID Thai ID checksum (first digit 1-8, like real IDs). */
export function randomValidThaiId(): string {
  const first12 = String(1 + Math.floor(Math.random() * 8)) + randomDigits(11);
  return first12 + thaiIdCheckDigit(first12);
}

/** The same 12 digits with a deliberately WRONG checksum digit. */
export function withInvalidChecksum(id13: string): string {
  return id13.slice(0, 12) + String((Number(id13[12]) + 1) % 10);
}

/** Formats 13 digits as X-XXXX-XXXXX-XX-X using `sep`. */
export function formatThaiId(id13: string, sep: string): string {
  return [id13.slice(0, 1), id13.slice(1, 5), id13.slice(5, 10), id13.slice(10, 12), id13.slice(12)].join(sep);
}

/** Maps ASCII digits to Thai digits. */
export function toThaiDigits(s: string): string {
  return s.replace(/\d/g, (d) => '๐๑๒๓๔๕๖๗๘๙'[Number(d)] ?? d);
}

/** Random Thai-style mobile number as 10 plain digits (08 + 8 random digits). */
export function randomMobile(): string {
  return `08${randomDigits(8)}`;
}

/** Random Thai-style Bangkok landline as 9 plain digits (02 + 7 random digits). */
export function randomLandline(): string {
  return `02${randomDigits(7)}`;
}
