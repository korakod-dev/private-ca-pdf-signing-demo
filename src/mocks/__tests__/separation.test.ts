/// <reference types="node" />
// (tsconfig.json only lists vite/client types; this test file needs node:* modules.)
// Separation test (plan acceptance): demo-only routes must not leak into the real-contract code.
//  - src/mocks/api/**: no `/demo/` or `/api/v1/sign` path, no demo/sign route keys.
//  - src/api/** (except demo.ts and tests): same rule for the client.
//  - the demo-only folders contain ONLY demo-only keys.
// Scans source text on purpose: it also catches a path that is written in a comment or a string literal.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_ROUTES } from '../../contracts/routes';
import { API_HANDLER_KEYS } from '../api';
import { DEMO_ONLY_HANDLER_KEYS } from '../demo-only';

const SRC = join(import.meta.dirname, '..', '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === '__tests__' ? [] : sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

/** Patterns that identify demo-only routes in source text. */
const DEMO_PATH = /\/demo\/|\/api\/v1\/sign/;
const DEMO_KEY = /['"`](demo|sign)\.[A-Za-z]+['"`]/;

const offenders = (files: string[]): string[] =>
  files.filter((f) => {
    const text = readFileSync(f, 'utf8');
    return DEMO_PATH.test(text) || DEMO_KEY.test(text);
  }).map((f) => relative(SRC, f));

describe('demo-only separation', () => {
  it('src/mocks/api/** contains no demo-only path or route key', () => {
    const files = sourceFiles(join(SRC, 'mocks', 'api'));
    expect(files.length).toBeGreaterThan(0);
    expect(offenders(files)).toEqual([]);
  });

  it('src/api/** names demo-only routes only in demo.ts', () => {
    const files = sourceFiles(join(SRC, 'api')).filter((f) => !f.endsWith(`${join('api', 'demo.ts')}`));
    expect(files.length).toBeGreaterThan(0);
    expect(offenders(files)).toEqual([]);
    // ...and demo.ts really is where they live.
    expect(readFileSync(join(SRC, 'api', 'demo.ts'), 'utf8')).toMatch(DEMO_KEY);
  });

  it('src/mocks/demo-only/** serves only demo-only route keys', () => {
    for (const key of DEMO_ONLY_HANDLER_KEYS) expect(API_ROUTES[key].demoOnly).toBe(true);
    for (const key of API_HANDLER_KEYS) expect(API_ROUTES[key].demoOnly).toBe(false);
  });

  it('the demo-only key set is exactly /api/v1/demo/* plus /api/v1/sign*', () => {
    const byPath = Object.entries(API_ROUTES)
      .filter(([, d]) => /^\/api\/v1\/(demo\/|sign)/.test(d.path))
      .map(([k]) => k)
      .sort();
    expect([...DEMO_ONLY_HANDLER_KEYS].sort()).toEqual(byPath);
  });

  it('the offender scan itself detects a leak (self-test)', () => {
    expect(DEMO_PATH.test("http.get('/api/v1/demo/status')")).toBe(true);
    expect(DEMO_PATH.test("path: '/api/v1/sign/review'")).toBe(true);
    expect(DEMO_KEY.test("http.call('sign.commit')")).toBe(true);
    expect(DEMO_PATH.test("'/api/v1/verify'")).toBe(false);
  });
});
