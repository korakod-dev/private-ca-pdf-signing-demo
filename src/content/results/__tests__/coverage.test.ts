// Content coverage: every code the resolver can emit has an explanation file, and every file follows the two-layer convention.
// (Lives under src/content because it needs the engine's code list, which UI code under src/pages may not import.)
// Keys follow src/pages/info/content.ts: results/<CHECK_CODE>, results/overall/<RESULT_CODE>, results/warnings/<WARNING>.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHECK_CODES, SKIPPED_CODE } from '../../../engine/resolver/codes';
import { contentKeys, getContent, splitLayers } from '../../../pages/info/content';

const RESULT_CODES = ['VALID', 'MODIFIED', 'REVOKED', 'UNTRUSTED', 'NO_POE', 'TRY_LATER'] as const;
// Warnings the resolver can emit (A41 adds TSA_STATUS_UNAVAILABLE).
const WARNING_CODES = ['MIXED_TRUST', 'NO_SIGNER', 'TSA_STATUS_UNAVAILABLE'] as const;

const CONTENT_DIR = join(import.meta.dirname, '..', '..');
const E_FOLDERS = ['results', 'verify', 'guide', 'pki', 'about', 'policy'];

describe('result explanations cover every resolver code', () => {
  const checkCodes = [...Object.values(CHECK_CODES).flat(), SKIPPED_CODE];

  it.each(checkCodes)('check code %s has results/<CODE>.md', (code) => {
    expect(getContent(`results/${code}`), `missing src/content/results/${code}.md`).not.toBeNull();
  });

  it.each(RESULT_CODES)('result code %s has results/overall/<CODE>.md', (code) => {
    expect(getContent(`results/overall/${code}`)).not.toBeNull();
  });

  it.each(WARNING_CODES)('warning %s has results/warnings/<CODE>.md', (code) => {
    expect(getContent(`results/warnings/${code}`)).not.toBeNull();
  });
});

describe('every content file of sub-task E follows the two-layer convention', () => {
  it('is bundled by the loader (loader keys = files on disk)', () => {
    const onDisk: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) walk(join(dir, entry.name), `${prefix}${entry.name}/`);
        else if (entry.name.endsWith('.md')) onDisk.push(`${prefix}${entry.name.replace(/\.md$/, '')}`);
      }
    };
    for (const folder of E_FOLDERS) walk(join(CONTENT_DIR, folder), `${folder}/`);
    expect(contentKeys()).toEqual(onDisk.sort());
  });

  it.each(E_FOLDERS)('%s: refs header, simple text, technical layer', (folder) => {
    const keys = contentKeys().filter((k) => k.startsWith(`${folder}/`));
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      const layers = splitLayers(readFileSync(join(CONTENT_DIR, `${key}.md`), 'utf8'));
      expect(layers.refs.length, `${key}: refs`).toBeGreaterThan(0);
      expect(layers.simple.length, `${key}: simple text`).toBeGreaterThan(0);
      expect(layers.technical, `${key}: technical layer`).not.toBeNull();
    }
  });
});
