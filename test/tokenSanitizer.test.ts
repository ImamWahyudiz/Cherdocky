import { describe, it, expect } from 'vitest';
import {
  filterGarbage,
  suppressConflicts,
  sanitizeTokens,
  GENERIC_PATTERNS,
  type SanitizableToken,
} from '~/utils/tokenSanitizer';

function tok(
  text: string,
  x: number,
  y: number,
  w = text.length * 8,
  h = 16,
  conf = 90
): SanitizableToken {
  return { text, x, y, width: w, height: h, confidence: conf };
}

describe('filterGarbage', () => {
  it('drops extreme aspect-ratio punctuation artifacts', () => {
    const out = filterGarbage([tok('_____', 0, 0, 200, 8), tok('Budi', 0, 40)]);
    expect(out.map((t) => t.text)).toEqual(['Budi']);
  });

  it('keeps extreme aspect-ratio tokens that contain real content', () => {
    const out = filterGarbage([tok('1/500', 0, 0, 240, 12)]);
    expect(out).toHaveLength(1);
  });

  it('drops short pure-punctuation residue regardless of shape', () => {
    const out = filterGarbage([tok('-', 10, 10, 8, 16), tok('..', 30, 30), tok('Rp', 50, 50)]);
    expect(out.map((t) => t.text)).toEqual(['Rp']);
  });

  it('drops isolated low-conf single characters', () => {
    const out = filterGarbage([tok('7', 500, 400, 6, 14, 55)]);
    expect(out).toHaveLength(0);
  });

  it('protects single characters with neighbors nearby', () => {
    const out = filterGarbage([tok('7', 100, 100, 6, 14, 55), tok('jam', 60, 100, 24, 14, 90)]);
    expect(out).toHaveLength(2);
  });

  it('keeps high-conf single characters even when alone', () => {
    const out = filterGarbage([tok('7', 500, 400, 6, 14, 95)]);
    expect(out).toHaveLength(1);
  });
});

describe('suppressConflicts', () => {
  it('drops a short read contained in a longer overlapping read', () => {
    const full = tok('19.02', 100, 50, 40, 14, 60);
    const frag = tok('19.', 100, 50, 12, 14, 95);
    const out = suppressConflicts([frag, full]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('19.02');
  });

  it('never suppresses equal-length rivals, even lower confidence', () => {
    // Confident misread vs correct read: both survive — choosing by
    // confidence measurably deleted correct words on degraded text.
    const good = tok('19.02', 100, 50, 40, 14, 45);
    const bad = tok('18.02', 101, 51, 40, 14, 85);
    const out = suppressConflicts([bad, good]);
    expect(out).toHaveLength(2);
  });

  it('a high-conf short fragment never deletes its fuller read', () => {
    const long = tok('0812345678', 100, 50, 80, 14, 70);
    const short = tok('0812', 100, 50, 32, 14, 90);
    const out = suppressConflicts([short, long]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('0812345678');
  });

  it('never lets a multi-word row read eat its own words', () => {
    // One pass read the whole row as one box; the other pass read the words.
    // The row concatenation is much longer than each word — ratio cap must
    // protect the real word boxes from containment suppression.
    const row = tok('Gula Pasir 1kg 14.500', 40, 100, 170, 14, 75);
    const word1 = tok('Gula', 40, 101, 30, 13, 88);
    const word2 = tok('14.500', 150, 101, 44, 13, 82);
    const out = suppressConflicts([row, word1, word2]);
    expect(out.map((t) => t.text).sort()).toEqual(['14.500', 'Gula', 'Gula Pasir 1kg 14.500'].sort());
  });

  it('keeps single-char tokens out of containment logic', () => {
    const full = tok('Total7', 100, 50, 48, 14, 60);
    const one = tok('7', 140, 52, 6, 14, 95);
    const out = suppressConflicts([one, full]);
    expect(out).toHaveLength(2);
  });

  it('never suppresses adjacent non-overlapping words', () => {
    const a = tok('Jalan', 100, 50, 38, 14);
    const b = tok('Kenanga', 142, 50, 56, 14);
    expect(suppressConflicts([a, b])).toHaveLength(2);
  });

  it('ignores identical text on different lines', () => {
    const a = tok('TOTAL', 100, 50, 40, 14);
    const b = tok('TOTALS', 100, 200, 48, 14);
    expect(suppressConflicts([a, b])).toHaveLength(2);
  });

  it('respects page boundaries', () => {
    const a = { ...tok('07', 100, 50, 20, 14), pageIndex: 0 };
    const b = { ...tok('077', 100, 50, 24, 14), pageIndex: 1 };
    expect(suppressConflicts([a, b])).toHaveLength(2);
  });
});

describe('lowConf hard floor', () => {
  it('drops flagged tokens below the absolute floor', () => {
    const junk = { ...tok('xqz', 10, 10, 24, 12, 20), lowConf: true };
    const keep = { ...tok('kata', 50, 10, 32, 12, 42), lowConf: true };
    const out = filterGarbage([junk, keep]);
    expect(out.map((t) => t.text)).toEqual(['kata']);
  });

  it('never touches unflagged low-confidence tokens', () => {
    const word = tok('kata', 10, 10, 32, 12, 20);
    expect(filterGarbage([word])).toHaveLength(1);
  });
});

describe('sanitizeTokens (combined)', () => {
  it('runs garbage filters before suppression', () => {
    const out = sanitizeTokens([
      tok('19.02', 100, 50, 40, 14, 85),
      tok('19.', 100, 50, 10, 14, 60),
      tok('___', 300, 300, 120, 8, 70),
    ]);
    expect(out.map((t) => t.text)).toEqual(['19.02']);
  });
});

describe('GENERIC_PATTERNS', () => {
  it('validates rescue-eligible shapes', () => {
    expect(GENERIC_PATTERNS.STRICT_NUMERIC_SEQUENCE.test('3201024501970001')).toBe(true);
    expect(GENERIC_PATTERNS.NUMERIC_CURRENCY_OR_DECIMAL.test('1.500.000')).toBe(true);
    expect(GENERIC_PATTERNS.NUMERIC_CURRENCY_OR_DECIMAL.test('1,000.00')).toBe(true);
    expect(GENERIC_PATTERNS.GENERIC_DATE.test('24/08/2026')).toBe(true);
    expect(GENERIC_PATTERNS.GENERIC_DATE.test('2026-08-24')).toBe(true);
    expect(GENERIC_PATTERNS.ALPHANUMERIC_CODE.test('SK-1234/AB')).toBe(true);
    expect(GENERIC_PATTERNS.JUNK_NOISE_TOKEN.test('--')).toBe(true);
  });

  it('rejects prose and malformed shapes', () => {
    expect(GENERIC_PATTERNS.STRICT_NUMERIC_SEQUENCE.test('jalan')).toBe(false);
    expect(GENERIC_PATTERNS.GENERIC_DATE.test('99/99/9999')).toBe(false);
    expect(GENERIC_PATTERNS.NUMERIC_CURRENCY_OR_DECIMAL.test('12.34.567')).toBe(false);
    expect(GENERIC_PATTERNS.JUNK_NOISE_TOKEN.test('Budi')).toBe(false);
  });
});
