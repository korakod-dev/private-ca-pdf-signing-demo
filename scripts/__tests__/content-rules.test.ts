// @vitest-environment node
// Tests for scripts/check-content.ts: the rule function (one positive + one negative per rule) and the CLI.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkContentFile, parseRefs } from '../lib/content-rules';
import { runScript } from './helpers';

const rules = (md: string): string[] => checkContentFile('x.md', md).map((f) => f.rule);

describe('refs header', () => {
  it('accepts a header with one or more refs', () => {
    expect(parseRefs('<!-- refs: V3 -->')).toEqual(['V3']);
    expect(parseRefs('<!--refs:V3, R14 ,5-->')).toEqual(['V3', 'R14', '5']);
    expect(rules('<!-- refs: V3, R14 -->\n\nข้อความ')).toEqual([]);
  });

  it('rejects a missing header, an empty list, an empty entry, or a header that is not on line 1', () => {
    expect(rules('ข้อความ\n')).toEqual(['content/refs-header']);
    expect(rules('<!-- refs: -->\nx')).toEqual(['content/refs-header']);
    expect(rules('<!-- refs: V3,, R14 -->\nx')).toEqual(['content/refs-header']);
    expect(rules('\n<!-- refs: V3 -->\nx')).toEqual(['content/refs-header']);
    expect(rules('')).toEqual(['content/refs-header']);
  });

  it('is exempt from the clause rule (refs may look like clause numbers)', () => {
    expect(rules('<!-- refs: 7.6.1, §4 -->\nข้อความ')).toEqual([]);
  });
});

describe('clause-level citations', () => {
  const H = '<!-- refs: V3 -->\n';

  it.each(['ตามข้อ 7 ของมาตรฐาน', 'ตามข้อ๗', 'see clause 5 here', 'per Clause 12', 'see § 4', 'ดูหัวข้อ 7.6.1', 'version 1.2.3'])('flags: %s', (line) => {
    expect(rules(H + line)).toEqual(['content/clause-citation']);
  });

  it('allows a citation on a line marked [verified]', () => {
    expect(rules(`${H}ตามข้อ 7 ของมาตรฐาน [verified]`)).toEqual([]);
  });

  it('[verified] only covers its own line', () => {
    expect(rules(`${H}ตามข้อ 7 [verified]\nตามข้อ 8`)).toEqual(['content/clause-citation']);
  });

  it('does not flag plain prose, ref ids or 2-part numbers', () => {
    expect(rules(`${H}ใบรับรองมีอายุ 1.5 ปี ดูอ้างอิง V3 และ R14\nข้อดีของวิธีนี้คือเร็ว`)).toEqual([]);
  });

  it('reports the line number', () => {
    const f = checkContentFile('x.md', `${H}\nตามข้อ 7`);
    expect(f[0]).toMatchObject({ file: 'x.md', pointer: 'line:3', rule: 'content/clause-citation' });
  });
});

describe('external URLs', () => {
  const H = '<!-- refs: V3 -->\n';

  it.each(['[มาตรฐาน](https://example.com/spec)', '<http://example.com>', 'ftp://host/file', '![x](//cdn.example.com/a.png)', 'ดู www.example.com', 'https://pki-demo.korakod.dev/'])(
    'flags: %s',
    (line) => {
      expect(rules(H + line)).toEqual(['content/external-url']);
    },
  );

  it('allows relative links and plain text mentioning a host-less word', () => {
    expect(rules(`${H}[ไปหน้าตรวจ](/verify) และ [คู่มือ](./guide) กับ somchai@lab.korakod.dev`)).toEqual([]);
  });
});

describe('check-content.ts CLI', () => {
  function withDir(files: Record<string, string>, run: (dir: string) => Promise<void>): Promise<void> {
    const dir = mkdtempSync(join(tmpdir(), 'pcpsd-content-'));
    for (const [name, body] of Object.entries(files)) {
      mkdirSync(join(dir, name, '..'), { recursive: true });
      writeFileSync(join(dir, name), body);
    }
    return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
  }

  it('passes vacuously for an empty folder and for a missing folder', async () => {
    await withDir({}, async (dir) => {
      expect((await runScript('check-content.ts', ['--content-dir', dir])).status).toBe(0);
    });
    expect((await runScript('check-content.ts', ['--content-dir', join(tmpdir(), 'pcpsd-does-not-exist')])).status).toBe(0);
  }, 60_000);

  it('passes for good files in nested folders and ignores non-Markdown files', async () => {
    await withDir({ 'a/good.md': '<!-- refs: V3 -->\nข้อความ', 'b/c/also.md': '<!-- refs: R14 -->\nข้อความ', 'notes.txt': 'ตามข้อ 7 https://x.com' }, async (dir) => {
      const r = await runScript('check-content.ts', ['--content-dir', dir]);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('2 Markdown file(s)');
    });
  }, 60_000);

  it('exits 1 and prints file + line + rule for each problem', async () => {
    await withDir({ 'a/bad.md': 'no header\nตามข้อ 7\nดู https://example.com' }, async (dir) => {
      const r = await runScript('check-content.ts', ['--content-dir', dir]);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('a/bad.md line:1 [content/refs-header]');
      expect(r.stderr).toContain('a/bad.md line:2 [content/clause-citation]');
      expect(r.stderr).toContain('a/bad.md line:3 [content/external-url]');
    });
  }, 60_000);

  it('passes on the real src/content folder', async () => {
    expect((await runScript('check-content.ts', [])).status).toBe(0);
  }, 60_000);
});
