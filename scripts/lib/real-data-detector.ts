// "Looks-like-real-data" detector for the fixture files (spec section 3: no real ID numbers, no real names,
// no fingerprints that do not start with DE:M0). Pure functions: input is the parsed JSON of each fixture
// file, output is a list of findings. No file system access here, so it is easy to unit test.
//
// Design rules:
//  - Findings never contain the matched value (it could be the real data we are trying to keep out of logs).
//  - Hex-like fields (sha256, fingerprint, serial and references to a serial) are SKIPPED by the generic
//    text rules (Thai ID, phone, email, URL). A 64-char hash or a serial can contain a digit run that looks
//    like a phone number or an ID by accident (ADR P0-11). Those fields have their own checks instead:
//    serial/fingerprint must start with DE:M0 (here), and the JSON Schemas pin their exact pattern.
//  - Thai digits are normalised to ASCII before matching, so Thai-digit phone/ID numbers are caught as well.
import type { Finding } from './types';

/** Parsed fixture files keyed by base name without extension: system, personas, pki, certs, requests, documents, mail. */
export type FixtureFiles = Record<string, unknown>;

// ---- Allow-lists --------------------------------------------------------------------------------------------------

/** Hosts that may appear in an absolute URL or in a `host` field. */
export const ALLOWED_URL_HOSTS: readonly string[] = ['pki-demo.korakod.dev'];
/** The only e-mail domain allowed in fixtures. */
export const ALLOWED_EMAIL_DOMAIN = 'lab.korakod.dev';
/** Required prefix of every serial / fingerprint (the "fake" marker). */
export const FAKE_PREFIX = 'DE:M0';
/** The one serial allowed to NOT start with DE:M0: the D06 self-signed cert, which must carry untrusted_fixture: true. */
export const UNTRUSTED_SERIAL = '01';

// ---- Field classification -----------------------------------------------------------------------------------------

/** Keys holding a serial or a fingerprint: checked for the DE:M0 prefix. */
const SERIAL_OR_FINGERPRINT_KEY = /(^|_)(fingerprint|serial)(_|$)/;
/** `superseded_by` holds the serial of another cert. */
const SERIAL_REFERENCE_KEYS = new Set(['superseded_by']);
/** Keys holding hash-like hex data. */
const HASH_KEY = /(^|_)sha256(_|$)/;
/** Keys that hold a person name (must be a persona name from personas.json). */
const PERSON_NAME_KEY = /^(display_name|subject_cn|signer_name|requester_name|holder_name)$/;

function isSerialOrFingerprintField(key: string | null): boolean {
  if (key === null) return false;
  return SERIAL_OR_FINGERPRINT_KEY.test(key) || SERIAL_REFERENCE_KEYS.has(key);
}

/** True for fields that are hex data (hash / fingerprint / serial / serial reference). */
export function isHexField(key: string | null): boolean {
  if (key === null) return false;
  return isSerialOrFingerprintField(key) || HASH_KEY.test(key);
}

// ---- Text rules ---------------------------------------------------------------------------------------------------

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';
/** Replaces Thai digits with ASCII digits so the numeric rules see them. */
export function normalizeDigits(s: string): string {
  return s.replace(/[๐-๙]/g, (d) => String(THAI_DIGITS.indexOf(d)));
}

/** 13-digit Thai national ID: plain or X-XXXX-XXXXX-XX-X (also space separated). Checksum is NOT checked on purpose. */
const THAI_ID = /(?<!\d)\d[ -]?\d{4}[ -]?\d{5}[ -]?\d{2}[ -]?\d(?!\d)/;

/**
 * Thai phone numbers:
 *  - plain 9-10 digits starting with 0 (landline 0X-XXX-XXXX / mobile 0XX-XXX-XXXX)
 *  - separated forms (0XX-XXX-XXXX, 0X XXX XXXX)
 *  - international +66 / 0066 (optionally with a (0) trunk digit)
 */
const THAI_PHONE_PLAIN = /(?<![\d+])0\d{8,9}(?!\d)/;
const THAI_PHONE_SEPARATED = /(?<!\d)0\d{1,2}[ .-]\d{3}[ .-]\d{3,4}(?!\d)/;
const THAI_PHONE_INTL = /(?<!\d)(?:\+|00)66[ -]?(?:\(0\))?\d[\d -]{6,11}\d/;

const EMAIL = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

/** Absolute URLs with any scheme (https://, ftp://, ldap://, ...). */
const ABSOLUTE_URL = /\b([A-Za-z][A-Za-z0-9+.-]*):\/\/([^\s/?#"'<>)\]]*)/g;
/** Protocol-relative URL ("//host/path") at the start or after a delimiter. */
const PROTOCOL_RELATIVE_URL = /(?:^|[\s"'(=])\/\/([A-Za-z0-9][^\s/?#"'<>)\]]*)/g;
/** Bare "www." host. */
const WWW_HOST = /(?<![A-Za-z0-9.@-])www\.[A-Za-z0-9-]+\.[A-Za-z]{2,}/i;

/** Extracts the host of a "user:pw@host:port" authority string (user-info tricks like a@evil.com are resolved). */
function hostOf(authority: string): string {
  const afterUserInfo = authority.slice(authority.lastIndexOf('@') + 1);
  return afterUserInfo.replace(/:\d*$/, '').toLowerCase();
}

function urlProblem(text: string): boolean {
  for (const m of text.matchAll(ABSOLUTE_URL)) {
    const scheme = (m[1] ?? '').toLowerCase();
    const host = hostOf(m[2] ?? '');
    const httpOk = scheme === 'http' || scheme === 'https';
    if (!httpOk || !ALLOWED_URL_HOSTS.includes(host)) return true;
  }
  for (const m of text.matchAll(PROTOCOL_RELATIVE_URL)) {
    if (!ALLOWED_URL_HOSTS.includes(hostOf(m[1] ?? ''))) return true;
  }
  return WWW_HOST.test(text);
}

function emailProblem(text: string): boolean {
  for (const m of text.matchAll(EMAIL)) {
    if ((m[1] ?? '').toLowerCase() !== ALLOWED_EMAIL_DOMAIN) return true;
  }
  return false;
}

// ---- Walker -------------------------------------------------------------------------------------------------------

function escapePointer(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

interface Context {
  file: string;
  /** Persona display names from personas.json (the only person names allowed anywhere). */
  personaNames: Set<string>;
  /** True when certs.json declares the allow-listed untrusted fixture (serial "01" + untrusted_fixture: true). */
  untrustedSerialDeclared: boolean;
  /** Shared output list (contexts for different files push into the same array). */
  findings: Finding[];
}

function add(ctx: Context, pointer: string, rule: string, message: string): void {
  ctx.findings.push({ file: ctx.file, pointer, rule, message });
}

/** Generic text rules for a string value of a NON-hex field. */
function checkText(ctx: Context, pointer: string, raw: string): void {
  const text = normalizeDigits(raw);
  if (THAI_ID.test(text)) add(ctx, pointer, 'real-data/thai-id', 'looks like a 13-digit Thai national ID number');
  if (THAI_PHONE_PLAIN.test(text) || THAI_PHONE_SEPARATED.test(text) || THAI_PHONE_INTL.test(text)) {
    add(ctx, pointer, 'real-data/phone', 'looks like a Thai phone number');
  }
  if (emailProblem(text)) add(ctx, pointer, 'real-data/email', `e-mail address outside @${ALLOWED_EMAIL_DOMAIN}`);
  if (urlProblem(text)) {
    add(ctx, pointer, 'real-data/url', `URL outside the allow-list (${ALLOWED_URL_HOSTS.join(', ')}; relative paths are fine)`);
  }
}

/** Serial / fingerprint prefix rule. "01" is allowed only when certs.json declares it as the untrusted fixture. */
function checkSerialOrFingerprint(ctx: Context, pointer: string, value: string): void {
  if (value.startsWith(`${FAKE_PREFIX}:`)) return;
  if (value === UNTRUSTED_SERIAL && ctx.untrustedSerialDeclared) return;
  add(ctx, pointer, 'real-data/fingerprint-prefix', `serial/fingerprint does not start with ${FAKE_PREFIX}`);
}

function walk(ctx: Context, node: unknown, pointer: string, key: string | null): void {
  if (typeof node === 'string') {
    if (isSerialOrFingerprintField(key)) checkSerialOrFingerprint(ctx, pointer, node);
    // Hex fields skip the generic text rules (ADR P0-11); everything else gets them.
    if (!isHexField(key)) checkText(ctx, pointer, node);
    if (key !== null && PERSON_NAME_KEY.test(key) && !ctx.personaNames.has(node)) {
      add(ctx, pointer, 'real-data/person-name', 'person name is not in the persona allow-list (personas.json)');
    }
    if (key === 'host' && !ALLOWED_URL_HOSTS.includes(node.toLowerCase())) {
      add(ctx, pointer, 'real-data/url', 'host is not in the allow-list');
    }
    return;
  }
  if (typeof node === 'number') {
    // A bare JSON number must not be a 13-digit ID either.
    if (Number.isInteger(node) && /^\d{13}$/.test(String(Math.abs(node)))) {
      add(ctx, pointer, 'real-data/thai-id', 'number has 13 digits (looks like a Thai national ID)');
    }
    return;
  }
  if (Array.isArray(node)) {
    // Array elements inherit the key of the array (e.g. previews[] or warnings[]).
    node.forEach((child, i) => walk(ctx, child, `${pointer}/${i}`, key));
    return;
  }
  if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) walk(ctx, v, `${pointer}/${escapePointer(k)}`, k);
  }
}

// ---- Subject rules (certs.json, pki.json) -------------------------------------------------------------------------

/** Extracts the CN value of a DN like "CN=Foo Bar, O=X, C=TH". Returns null if there is none. */
export function commonName(subject: string): string | null {
  const m = /(?:^|,\s*)CN=([^,]+)/.exec(subject);
  return m ? (m[1] ?? '').trim() : null;
}

function asObjectArray(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => x !== null && typeof x === 'object') : [];
}

/** CA/TSA subjects must contain DEMO; user cert CNs must be persona names (except the allow-listed untrusted cert). */
function checkSubjects(base: Context, files: FixtureFiles): void {
  const pki: Context = { ...base, file: 'pki.json' };
  asObjectArray(files['pki']).forEach((ca, i) => {
    const subject = ca['subject'];
    if (typeof subject !== 'string' || !subject.includes('DEMO')) {
      add(pki, `/${i}/subject`, 'real-data/ca-subject-demo', 'CA/TSA subject must contain DEMO');
    }
  });

  const certs: Context = { ...base, file: 'certs.json' };
  asObjectArray(files['certs']).forEach((cert, i) => {
    // The single allow-listed self-signed subject (D06).
    if (cert['untrusted_fixture'] === true && cert['serial'] === UNTRUSTED_SERIAL) return;
    const subject = cert['subject'];
    if (typeof subject !== 'string' || !subject.includes('DEMO')) {
      add(certs, `/${i}/subject`, 'real-data/cert-subject-demo', 'certificate subject must contain DEMO');
      return;
    }
    const cn = commonName(subject);
    if (cn !== null && !base.personaNames.has(cn) && !cn.includes('DEMO')) {
      add(certs, `/${i}/subject`, 'real-data/person-name', 'subject CN is not in the persona allow-list (personas.json)');
    }
  });
}

// ---- Public entry point -------------------------------------------------------------------------------------------

/** Runs every detector rule over all fixture files. */
export function detectRealData(files: FixtureFiles): Finding[] {
  const personaNames = new Set<string>();
  for (const p of asObjectArray(files['personas'])) {
    if (typeof p['display_name'] === 'string') personaNames.add(p['display_name']);
  }
  const untrustedSerialDeclared = asObjectArray(files['certs']).some(
    (c) => c['serial'] === UNTRUSTED_SERIAL && c['untrusted_fixture'] === true,
  );

  const findings: Finding[] = [];
  for (const [name, content] of Object.entries(files)) {
    walk({ file: `${name}.json`, personaNames, untrustedSerialDeclared, findings }, content, '', null);
  }
  checkSubjects({ file: '', personaNames, untrustedSerialDeclared, findings }, files);
  return findings;
}
