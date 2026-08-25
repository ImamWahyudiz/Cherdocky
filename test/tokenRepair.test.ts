import { describe, it, expect } from 'vitest';
import {
  repairMajorityNumeric,
  repairMajorityAlpha,
  stitchNumericFragments,
  repairTokens,
  type RepairableToken,
  type RepairMeta,
} from '~/utils/tokenRepair';

type Tok = RepairableToken & Partial<RepairMeta>;

function tok(text: string, x: number, y: number, w = text.length * 8, h = 14): Tok {
  return { text, x, y, width: w, height: h };
}

describe('repairMajorityNumeric', () => {
  it('repairs digit-majority tokens with lookalike contamination', () => {
    expect(repairMajorityNumeric('198O02')?.text).toBe('198002');
    expect(repairMajorityNumeric('198O02')?.kind).toBe('numeric');
    expect(repairMajorityNumeric('980O25')?.text).toBe('980025');
    expect(repairMajorityNumeric('320l0245!')?.text).toBe('320102451');
  });

  it('leaves well-formed numbers with separators untouched', () => {
    // '.' is not a confusable char → disqualified
    expect(repairMajorityNumeric('12.345')).toBeNull();
    expect(repairMajorityNumeric('1.500.000')).toBeNull();
  });

  it('requires at least 75% digits', () => {
    // 2 digits / 4 chars = 50%
    expect(repairMajorityNumeric('12OD')).toBeNull();
  });

  it('rejects short tokens and pure-alpha words', () => {
    expect(repairMajorityNumeric('19O')).toBeNull();
    expect(repairMajorityNumeric('ODoQ')).toBeNull(); // 0 digits
  });

  it('returns null when nothing to replace', () => {
    expect(repairMajorityNumeric('123456')).toBeNull();
  });
});

describe('repairMajorityAlpha', () => {
  it('restores letters from digit substitutions', () => {
    const r = repairMajorityAlpha('IND0NESIA');
    expect(r?.kind).toBe('alpha');
    expect(r?.text).toBe('INDONESIA');
  });

  it('handles leetspeak per the spec example', () => {
    expect(repairMajorityAlpha('J4K4RT4')?.text).toBe('JAKARTA');
    expect(repairMajorityAlpha('IND0NESIA')?.text).toBe('INDONESIA');
  });

  it('follows lowercase majority', () => {
    expect(repairMajorityAlpha('b4di')?.text).toBe('badi');
  });

  it('never touches pure numbers', () => {
    expect(repairMajorityAlpha('2024')).toBeNull();
    expect(repairMajorityAlpha('081234567890')).toBeNull();
  });

  it('disqualifies on separators or unmapped digits', () => {
    expect(repairMajorityAlpha('Rp32.000')).toBeNull(); // '.'
    expect(repairMajorityAlpha('abc7de')).toBeNull(); // '7' unmapped
  });

  it('requires letter dominance', () => {
    // letters 2/6 = 33%
    expect(repairMajorityAlpha('12ab34')).toBeNull();
  });
});

describe('stitchNumericFragments', () => {
  it('joins phone fragments on the same line', () => {
    const out = stitchNumericFragments([
      tok('0812', 100, 50, 30, 20),
      tok('3456', 134, 50, 30, 20),
      tok('7890', 168, 50, 30, 20),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('081234567890');
    expect(out[0].repaired).toBe('stitched');
    expect(out[0].repairedFrom).toBe('0812|3456|7890');
  });

  it('joins currency split across a dropped separator', () => {
    const out = stitchNumericFragments([tok('1.', 40, 10, 14, 16), tok('500.000', 52, 10, 56, 16)]);
    expect(out[0].text).toBe('1.500.000');
  });

  it('breaks chains at non-numeric neighbors', () => {
    const out = stitchNumericFragments([
      tok('Rp', 20, 50, 16, 20),
      tok('32.', 40, 50, 24, 20),
      tok('000', 68, 50, 24, 20),
    ]);
    expect(out.map((t) => t.text)).toEqual(['Rp', '32.000']);
  });

  it('does not join tokens separated by a column gap', () => {
    const out = stitchNumericFragments([
      tok('1234', 100, 50, 28, 20),
      tok('5678', 400, 50, 28, 20),
    ]);
    expect(out).toHaveLength(2);
  });

  it('does not join different lines', () => {
    const out = stitchNumericFragments([tok('1234', 100, 50), tok('5678', 110, 90)]);
    expect(out).toHaveLength(2);
  });

  it('ignores non-numeric tokens entirely', () => {
    const out = stitchNumericFragments([tok('Jalan', 100, 50), tok('Kenanga', 140, 50)]);
    expect(out).toHaveLength(2);
    expect(out[0].repaired).toBeUndefined();
  });
});

describe('repairTokens (combined)', () => {
  it('stitches first, then applies majority rules to stitched text', () => {
    const out = repairTokens([
      tok('198', 100, 50, 21, 20),
      tok('O02', 125, 50, 24, 20),
      tok('Budi', 300, 50, 32, 20),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].text).toBe('198002');
    expect(out[0].repaired).toBe('stitched');
  });

  it('flags numeric majority repairs without geometry changes', () => {
    const out = repairTokens([tok('198O02', 10, 10)]);
    expect(out[0].text).toBe('198002');
    expect(out[0].repaired).toBe('numeric');
    expect(out[0].repairedFrom).toBe('198O02');
    expect((out[0] as RepairableToken).x).toBe(10);
  });

  it('passes verbatim reads through unflagged', () => {
    const out = repairTokens([tok('Budi', 0, 0), tok('Santoso', 50, 0)]);
    expect(out.every((t) => t.repaired === undefined)).toBe(true);
  });
});
