// parseArgs / tokenize: quotes (incl. Thai), backslash escapes, flag forms, boolean flags, errors.
import { describe, expect, it } from 'vitest';
import { ParseError, parseArgs, tokenize } from '../core/parseArgs';

describe('tokenize', () => {
  it.each([
    ['ls', ['ls']],
    ['  ls   -l  ', ['ls', '-l']],
    ['', []],
    ['pki-tool init --name "ณัฐพล ทองดี" --email a@b', ['pki-tool', 'init', '--name', 'ณัฐพล ทองดี', '--email', 'a@b']],
    ["say 'a b' c", ['say', 'a b', 'c']],
    ['say "a\\"b"', ['say', 'a"b']],
    ['say "a\\\\b"', ['say', 'a\\b']],
    ['say "a\\nb"', ['say', 'a\\nb']], // other backslashes stay literal inside double quotes
    ["say 'a\\b'", ['say', 'a\\b']], // everything literal inside single quotes
    ['say a\\ b', ['say', 'a b']],
    ['say a\\"b', ['say', 'a"b']],
    ['say ""', ['say', '']], // an empty quoted word is still a word
    ['say a"b c"d', ['say', 'ab cd']], // quotes can sit in the middle of a word
    ['say "ไฟล์ ชื่อ ไทย.pdf"', ['say', 'ไฟล์ ชื่อ ไทย.pdf']],
    ['say\ta\tb', ['say', 'a', 'b']],
  ])('%j', (line, expected) => {
    expect(tokenize(line)).toEqual(expected);
  });

  it.each(['say "unterminated', "say 'unterminated", 'say trailing\\', 'say "x\\'])('rejects %j', (line) => {
    expect(() => tokenize(line)).toThrow(ParseError);
  });
});

describe('parseArgs', () => {
  it('splits command, positionals and flags', () => {
    const a = parseArgs('pdfsign sign ~/Documents/memo-130-unsigned.pdf --field "approver-1" --certify --yes', {
      booleanFlags: ['certify', 'yes'],
    });
    expect(a.argv[0]).toBe('pdfsign');
    expect(a.positional).toEqual(['sign', '~/Documents/memo-130-unsigned.pdf']);
    expect(a.flags).toEqual({ field: 'approver-1', certify: true, yes: true });
  });

  it('supports --flag=value, including values with = and spaces', () => {
    const a = parseArgs('cmd --name="สมชาย ใจดี" --expr=a=b');
    expect(a.flags).toEqual({ name: 'สมชาย ใจดี', expr: 'a=b' });
  });

  it('a boolean flag does not swallow the next positional', () => {
    const a = parseArgs('pdfsign sign --certify file.pdf', { booleanFlags: ['certify'] });
    expect(a.flags).toEqual({ certify: true });
    expect(a.positional).toEqual(['sign', 'file.pdf']);
  });

  it('without the boolean hint a flag takes the next word (contract: --flag value)', () => {
    const a = parseArgs('cmd --opt value rest');
    expect(a.flags).toEqual({ opt: 'value' });
    expect(a.positional).toEqual(['rest']);
  });

  it('a flag followed by another flag, or by nothing, is true', () => {
    expect(parseArgs('cmd --a --b').flags).toEqual({ a: true, b: true });
    expect(parseArgs('cmd --a').flags).toEqual({ a: true });
  });

  it('handles short flags, "-" and negative numbers as words', () => {
    const a = parseArgs('cmd -v - -5', { booleanFlags: ['v'] });
    expect(a.flags).toEqual({ v: true });
    expect(a.positional).toEqual(['-', '-5']);
  });

  it('"--" ends option parsing', () => {
    const a = parseArgs('cmd --a x -- --not-a-flag y');
    expect(a.flags).toEqual({ a: 'x' });
    expect(a.positional).toEqual(['--not-a-flag', 'y']);
  });

  it('keeps an empty quoted value', () => {
    expect(parseArgs('cmd --name ""').flags).toEqual({ name: '' });
  });

  it('empty input has an empty argv', () => {
    expect(parseArgs('   ')).toEqual({ argv: [], flags: {}, positional: [] });
  });

  it('propagates ParseError', () => {
    expect(() => parseArgs('cmd "oops')).toThrow(ParseError);
  });
});
