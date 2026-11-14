// @vitest-environment node
/// <reference types="node" />
// (tsconfig.json only lists vite/client types; this test file needs node:* modules.)
// hashChain tests. Runs in the node environment so the default WebCrypto hasher (crypto.subtle) is exercised for real;
// the expected values are computed independently with node:crypto.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AuditDraft, AuditEntry } from '../../contracts/engine';
import { GENESIS_HASH, canonicalJson, chainEntries, computeEntryHash, verifyChain, webCryptoHasher } from '../hashChain';

const sha = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

const drafts: AuditDraft[] = [
  { at: '2026-11-12T09:00:00+07:00', actor: 'system', action: 'system.reset', target: null, details: {} },
  {
    at: '2026-11-12T09:05:00+07:00',
    actor: 'a-admin-a',
    action: 'cert.revoked',
    target: 'DE:M0:4F:2A:91:01',
    details: { reason: 'keyCompromise', b: 1, a: [2, { z: 1, y: 'ไทย' }] },
  },
  { at: '2026-11-12T09:06:00+07:00', actor: 'system', action: 'crl.issued', target: null, details: { number: 2 } },
];

describe('canonicalJson', () => {
  it('sorts keys at every depth and emits no whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe('{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
  });
  it('drops undefined members', () => {
    expect(canonicalJson({ a: undefined, b: 1 })).toBe('{"b":1}');
  });
});

describe('chainEntries', () => {
  it('matches a known vector computed with node:crypto', async () => {
    const [first] = await chainEntries([drafts[0]!], null);
    const expected = sha(
      `${GENESIS_HASH}\n{"action":"system.reset","actor":"system","at":"2026-11-12T09:00:00+07:00","details":{},"seq":1,"target":null}`,
    );
    expect(first).toEqual({ ...drafts[0], seq: 1, prev_hash: GENESIS_HASH, hash: expected });
  });

  it('links entries (prev_hash = previous hash) with contiguous seq starting at 1', async () => {
    const entries = await chainEntries(drafts, null);
    expect(entries.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(entries[0]!.prev_hash).toBe(GENESIS_HASH);
    expect(entries[1]!.prev_hash).toBe(entries[0]!.hash);
    expect(entries[2]!.prev_hash).toBe(entries[1]!.hash);
    // Entry 2 recomputed independently (nested keys sorted, Thai text hashed as UTF-8).
    const pre =
      `${entries[0]!.hash}\n` +
      '{"action":"cert.revoked","actor":"a-admin-a","at":"2026-11-12T09:05:00+07:00",' +
      '"details":{"a":[2,{"y":"ไทย","z":1}],"b":1,"reason":"keyCompromise"},"seq":2,"target":"DE:M0:4F:2A:91:01"}';
    expect(entries[1]!.hash).toBe(sha(pre));
  });

  it('continues an existing chain from its last entry', async () => {
    const head = await chainEntries(drafts.slice(0, 2), null);
    const tail = await chainEntries(drafts.slice(2), head[1]!);
    expect([...head, ...tail]).toEqual(await chainEntries(drafts, null));
  });

  it('returns [] for no drafts', async () => {
    expect(await chainEntries([], null)).toEqual([]);
  });

  it('uses an injected hasher', async () => {
    const entries = await chainEntries([drafts[0]!], null, { sha256Hex: async () => 'f'.repeat(64) });
    expect(entries[0]!.hash).toBe('f'.repeat(64));
  });
});

describe('webCryptoHasher / computeEntryHash', () => {
  it('computes SHA-256 hex of UTF-8 text', async () => {
    expect(await webCryptoHasher.sha256Hex('abc')).toBe(sha('abc'));
    expect(await webCryptoHasher.sha256Hex('สวัสดี')).toBe(sha('สวัสดี'));
  });
  it('computeEntryHash agrees with chainEntries', async () => {
    const [e] = await chainEntries([drafts[0]!], null);
    expect(await computeEntryHash(GENESIS_HASH, e!)).toBe(e!.hash);
  });
});

describe('verifyChain', () => {
  const build = (): Promise<AuditEntry[]> => chainEntries(drafts, null);

  it('accepts an empty and an intact chain', async () => {
    expect(await verifyChain([])).toEqual({ valid: true });
    expect(await verifyChain(await build())).toEqual({ valid: true });
  });

  it('reports the first bad seq when content is tampered', async () => {
    const entries = await build();
    entries[1] = { ...entries[1]!, details: { reason: 'unspecified' } };
    expect(await verifyChain(entries)).toEqual({ valid: false, first_bad_seq: 2 });
  });

  it('reports the first of several tampered entries', async () => {
    const entries = await build();
    entries[2] = { ...entries[2]!, action: 'x' };
    entries[1] = { ...entries[1]!, action: 'y' };
    expect(await verifyChain(entries)).toEqual({ valid: false, first_bad_seq: 2 });
  });

  it('detects a rewritten hash', async () => {
    const entries = await build();
    entries[0] = { ...entries[0]!, hash: 'a'.repeat(64) };
    expect(await verifyChain(entries)).toEqual({ valid: false, first_bad_seq: 1 });
  });

  it('detects a removed middle entry (broken link)', async () => {
    const entries = await build();
    entries.splice(1, 1);
    expect(await verifyChain(entries)).toEqual({ valid: false, first_bad_seq: 3 });
  });

  it('detects a removed first entry (does not link to genesis)', async () => {
    const entries = await build();
    entries.shift();
    expect(await verifyChain(entries)).toEqual({ valid: false, first_bad_seq: 2 });
  });

  it('detects a seq gap even when links and hashes are consistent', async () => {
    const entries = await build();
    // Entry 3 re-hashed with seq 5: link ok, hash ok, but seq is not contiguous.
    const bad = { ...entries[2]!, seq: 5 };
    bad.hash = await computeEntryHash(bad.prev_hash, bad);
    expect(await verifyChain([entries[0]!, entries[1]!, bad])).toEqual({ valid: false, first_bad_seq: 5 });
  });
});
