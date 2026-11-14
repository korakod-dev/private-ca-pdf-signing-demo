// @vitest-environment node
// Previews: every documents[].previews[] entry exists, is an SVG with the DEMO watermark, and matches a fresh
// run of the generator (so the committed files cannot drift from documents.json / certs.json).
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { FixtureBundle } from '../../src/contracts/fixtures';
import { checkPreviews } from '../lib/fixture-checks';
import { renderAllPreviews } from '../lib/previews';
import { loadRealFixtures, makeSandbox, REAL_PUBLIC_DIR, runScript } from './helpers';

const bundle = loadRealFixtures() as unknown as FixtureBundle;

describe('committed previews', () => {
  it('exist for every documents[].previews[] entry and contain the DEMO watermark', () => {
    let count = 0;
    for (const doc of bundle.documents) {
      expect(doc.previews.length).toBeGreaterThanOrEqual(1);
      expect(doc.previews.length).toBeLessThanOrEqual(3);
      for (const p of doc.previews) {
        const full = join(REAL_PUBLIC_DIR, p);
        expect(existsSync(full), `${p} exists`).toBe(true);
        const svg = readFileSync(full, 'utf8');
        expect(svg).toContain('<svg');
        expect(svg).toContain('>DEMO</text>');
        count += 1;
      }
    }
    expect(count).toBe(20);
    expect(checkPreviews(bundle, REAL_PUBLIC_DIR)).toEqual([]);
  });

  it('are byte-identical to a fresh generator run', () => {
    for (const [path, svg] of renderAllPreviews(bundle)) {
      expect(readFileSync(join(REAL_PUBLIC_DIR, path), 'utf8'), `${path} is up to date (run scripts/gen-previews.ts)`).toBe(svg);
    }
  });

  it('are safe to serve under the production CSP: no scripts, styles, external references or event handlers', () => {
    for (const path of renderAllPreviews(bundle).keys()) {
      const svg = readFileSync(join(REAL_PUBLIC_DIR, path), 'utf8');
      expect(svg).not.toMatch(/<script|<style|<foreignObject|<image|<use|href=|url\(|\son[a-z]+=/i);
    }
  });

  it('show only fictional names (persona names or the DEMO self-signed subject)', () => {
    const allowed = new Set(['สมชาย ใจดี', 'วิภาวรรณ ศรีสุข', 'อารีย์ มีสุข', 'Wipawan S. (self-signed)', 'ผู้ลงนาม (สมมติ)', '(ยังไม่ได้ลงนาม)']);
    for (const svg of renderAllPreviews(bundle).values()) {
      for (const m of svg.matchAll(/font-size="13" fill="#222222" font-weight="bold">([^<]+)<\/text>/g)) {
        const name = m[1] ?? '';
        expect(allowed.has(name), 'signature box shows a fictional signer name').toBe(true);
      }
    }
  });
});

describe('gen-previews.ts', () => {
  it('--check passes on the committed files and fails when one is stale or missing', async () => {
    expect((await runScript('gen-previews.ts', ['--check'])).status).toBe(0);

    const sb = makeSandbox();
    try {
      const args = ['--check', ...sb.args()];
      expect((await runScript('gen-previews.ts', args)).status).toBe(0);
      writeFileSync(join(sb.publicDir, 'previews', 'D01-p1.svg'), '<svg>DEMO</svg>');
      const stale = await runScript('gen-previews.ts', args);
      expect(stale.status).toBe(1);
      expect(stale.stderr).toContain('/previews/D01-p1.svg');
      rmSync(join(sb.publicDir, 'previews', 'D02-p1.svg'));
      expect((await runScript('gen-previews.ts', args)).stderr).toContain('/previews/D02-p1.svg');
    } finally {
      sb.cleanup();
    }
  }, 60_000);

  it('writes the files into a fresh public folder', async () => {
    const sb = makeSandbox();
    try {
      rmSync(join(sb.publicDir, 'previews'), { recursive: true });
      const r = await runScript('gen-previews.ts', sb.args());
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('wrote 20 previews');
      expect((await runScript('gen-previews.ts', ['--check', ...sb.args()])).status).toBe(0);
    } finally {
      sb.cleanup();
    }
  }, 60_000);
});
