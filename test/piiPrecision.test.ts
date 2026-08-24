import { describe, it, expect } from 'vitest';
import {
  isValidNik,
  analyzeWords,
  findContextualPIIWordIndices,
  type OcrWord,
} from '../src/utils/piiDetector';

function w(text: string, x: number, y: number, extra: Partial<OcrWord> = {}): OcrWord {
  return { text, x, y, width: 40, height: 16, confidence: 90, ...extra };
}

describe('isValidNik', () => {
  it('accepts a valid male NIK', () => {
    expect(isValidNik('3201010101900001')).toBe(true);
  });

  it('accepts a female NIK (day + 40 encoding)', () => {
    expect(isValidNik('3201014112890001')).toBe(true);
  });

  it('rejects an invalid province prefix', () => {
    expect(isValidNik('9912310112900001')).toBe(false);
  });

  it('rejects an impossible day', () => {
    expect(isValidNik('3201013212900001')).toBe(false);
  });

  it('rejects wrong length', () => {
    expect(isValidNik('3201010101')).toBe(false);
  });
});

describe('analyzeWords precision', () => {
  it('auto-redacts a valid NIK', () => {
    const words = [w('3201010101900001', 10, 10)];
    const m = analyzeWords(words, ['nik']);
    expect(m.length).toBe(1);
    expect(m[0].autoRedact).toBe(true);
  });

  it('does NOT auto-redact a bare 10-16 digit number (bank gated, no context)', () => {
    const words = [w('1234567890', 10, 10)];
    const m = analyzeWords(words, ['bank']);
    expect(m.length).toBe(1);
    expect(m[0].autoRedact).toBe(false); // flagged for review, not auto
  });

  it('auto-redacts the same number when a "Rekening" label is nearby', () => {
    const words = [w('Rekening', 10, 10), w('1234567890', 200, 10)];
    const m = analyzeWords(words, ['bank']);
    expect(m.length).toBe(1);
    expect(m[0].autoRedact).toBe(true);
  });

  it('detects a name by label proximity (Nama -> value)', () => {
    // Same y = same line in real OCR output
    const words = [w('Nama', 10, 100), w('BUDI', 100, 100), w('SANTOSO', 200, 100)];
    const m = analyzeWords(words, ['name']);
    const types = m.map((x) => x.type);
    expect(types).toContain('name');
    expect(m.every((x) => x.autoRedact)).toBe(true);
  });

  it('does not mark the label word itself as a name value', () => {
    const words = [w('Nama', 10, 100), w('BUDI', 100, 100)];
    const m = analyzeWords(words, ['name']);
    expect(m.some((x) => x.text === 'Nama')).toBe(false);
  });

  it('auto-redacts a phone number', () => {
    const words = [w('08123456789', 10, 10)];
    const m = analyzeWords(words, ['phone']);
    expect(m.length).toBe(1);
    expect(m[0].autoRedact).toBe(true);
  });

  it('does NOT corrupt normal words via normalization', () => {
    // Regression: old fuzzyNormalizeDigits turned these into garbage.
    const words = [w('OKTOBER', 10, 10), w('BANK', 10, 30), w('JAKARTA', 10, 50)];
    const m = analyzeWords(words, ['nik', 'bank', 'name', 'address']);
    // None of these should be auto-redacted as sensitive.
    expect(m.filter((x) => x.autoRedact).length).toBe(0);
  });
});

describe('findContextualPIIWordIndices', () => {
  it('returns a Set of auto-redact indices only', () => {
    const words = [w('3201010101900001', 10, 10), w('1234567890', 400, 400)];
    const set = findContextualPIIWordIndices(words, ['nik', 'bank']);
    expect(set.has(0)).toBe(true); // nik auto
    expect(set.has(1)).toBe(false); // bank requires context
  });
});
