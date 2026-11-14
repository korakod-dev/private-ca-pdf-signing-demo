// Audit hash chain (plan section 3.6).
//   hash = hex(SHA-256(prev_hash + "\n" + canonicalJSON({seq, at, actor, action, target, details})))
// canonicalJSON = sorted keys, no whitespace, UTF-8. The genesis prev_hash is 64 zeros.
// Used by the mock runtime (to chain engine drafts) and by the admin status page (to verify in the browser).
// Browser-safe: only WebCrypto (`crypto.subtle`); a Hasher can be injected for tests.
import type { AuditDraft, AuditEntry } from '../contracts/engine';
import type { Hasher } from '../contracts/runtime';

/** prev_hash of the first entry. */
export const GENESIS_HASH = '0'.repeat(64);

/** Hasher backed by WebCrypto (`globalThis.crypto.subtle`). */
export const webCryptoHasher: Hasher = {
  async sha256Hex(text: string): Promise<string> {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('WebCrypto (crypto.subtle) is not available in this context');
    const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  },
};

/** Recursively sorts object keys and drops `undefined` object members (like JSON.stringify would). */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}

/** Canonical JSON: sorted keys at every depth, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

type HashedFields = Pick<AuditEntry, 'seq' | 'at' | 'actor' | 'action' | 'target' | 'details'>;

/** Hash of one entry given the previous hash (covers every field except `prev_hash` and `hash`). */
export function computeEntryHash(prevHash: string, e: HashedFields, hasher: Hasher = webCryptoHasher): Promise<string> {
  const { seq, at, actor, action, target, details } = e;
  return hasher.sha256Hex(`${prevHash}\n${canonicalJson({ seq, at, actor, action, target, details })}`);
}

/**
 * Turns drafts into chained entries. `prev` is the last existing entry (null for an empty chain).
 * Sequence numbers start at 1 and increase by 1.
 */
export async function chainEntries(
  drafts: readonly AuditDraft[],
  prev: Pick<AuditEntry, 'seq' | 'hash'> | null,
  hasher: Hasher = webCryptoHasher,
): Promise<AuditEntry[]> {
  const out: AuditEntry[] = [];
  let prevSeq = prev?.seq ?? 0;
  let prevHash = prev?.hash ?? GENESIS_HASH;
  for (const draft of drafts) {
    const seq = prevSeq + 1;
    const hash = await computeEntryHash(prevHash, { ...draft, seq }, hasher);
    out.push({ ...draft, seq, prev_hash: prevHash, hash });
    prevSeq = seq;
    prevHash = hash;
  }
  return out;
}

export type ChainVerdict = { valid: true } | { valid: false; first_bad_seq: number };

/**
 * Verifies the chain from the first entry. Reports the `seq` of the first entry that breaks it:
 * wrong link (`prev_hash` != previous hash / genesis), non-contiguous `seq`, or a `hash` that does not match the content.
 * An empty chain is valid. The first entry's own `seq` is not constrained (only that it links to the genesis hash).
 */
export async function verifyChain(entries: readonly AuditEntry[], hasher: Hasher = webCryptoHasher): Promise<ChainVerdict> {
  let prevHash = GENESIS_HASH;
  let prevSeq: number | null = null;
  for (const entry of entries) {
    const linked = entry.prev_hash === prevHash;
    const contiguous = prevSeq === null || entry.seq === prevSeq + 1;
    if (!linked || !contiguous) return { valid: false, first_bad_seq: entry.seq };
    const expected = await computeEntryHash(prevHash, entry, hasher);
    if (expected !== entry.hash) return { valid: false, first_bad_seq: entry.seq };
    prevHash = entry.hash;
    prevSeq = entry.seq;
  }
  return { valid: true };
}
