// Two-layer content loader: splitLayers and getContent.
import { describe, expect, it } from 'vitest';
import { getContent, splitLayers } from '../content';
import { retryAfterText } from '../format';

describe('splitLayers', () => {
  it('splits the simple and technical layers and reads the refs header', () => {
    const out = splitLayers('<!-- refs: V5, R15 -->\nข้อความง่าย\n\n## รายละเอียดทางเทคนิค\n- รายละเอียด\n');
    expect(out.refs).toEqual(['V5', 'R15']);
    expect(out.simple).toBe('ข้อความง่าย');
    expect(out.technical).toBe('- รายละเอียด');
  });

  it('has no technical layer when the marker is missing or empty', () => {
    expect(splitLayers('<!-- refs: V5 -->\nเฉพาะข้อความง่าย').technical).toBeNull();
    expect(splitLayers('<!-- refs: V5 -->\nx\n\n## รายละเอียดทางเทคนิค\n').technical).toBeNull();
  });

  it('keeps the whole text when there is no refs header', () => {
    const out = splitLayers('ไม่มีหัว');
    expect(out.refs).toEqual([]);
    expect(out.simple).toBe('ไม่มีหัว');
  });

  it('ignores a byte-order mark and CRLF line endings', () => {
    const out = splitLayers('﻿<!-- refs: V5 -->\r\nง่าย\r\n\r\n## รายละเอียดทางเทคนิค\r\nลึก');
    expect(out.refs).toEqual(['V5']);
    expect(out.simple).toBe('ง่าย');
    expect(out.technical).toBe('ลึก');
  });
});

describe('getContent', () => {
  it('loads a bundled file by key', () => {
    const c = getContent('results/MODIFIED_CONTENT');
    expect(c).not.toBeNull();
    expect(c?.refs).toContain('V5');
    expect(c?.simple).toContain('แก้เนื้อหา');
  });

  it('returns null for an unknown key', () => {
    expect(getContent('results/NOPE')).toBeNull();
  });
});

describe('retryAfterText', () => {
  it('rounds up seconds and stays empty without a value', () => {
    expect(retryAfterText({ retry_after_s: 12.2 })).toContain('13 วินาที');
    expect(retryAfterText({})).toBe('');
    expect(retryAfterText({ retry_after_s: Number.NaN })).toBe('');
  });
});
